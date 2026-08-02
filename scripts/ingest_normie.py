#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
 ingest_normie.py  —  popola Vectorize + D1 per il chatbot RAG "Normie"
================================================================================
Legge il DB locale `Database_Normalizzato/catasto_ricerca.db` (prodotto dalla
pipeline), spezza il testo in chunk, genera gli embedding con Cloudflare Workers
AI e li carica su:
  - Cloudflare Vectorize  (embedding + metadati leggeri per il link al PDF)
  - Cloudflare D1         (testo integrale del chunk, store autoritativo)

ZERO dipendenze: sola libreria standard (urllib), come sync_turso.py.

Prerequisiti (una volta sola), via wrangler:
  wrangler vectorize create normie-catasto --dimensions=1024 --metric=cosine
  wrangler d1 create normie-catasto        # -> annota il database_id

Credenziali (env oppure file `.env` nella root del progetto):
  CF_ACCOUNT_ID, CF_API_TOKEN, CF_VECTORIZE_INDEX, CF_D1_DATABASE_ID
  (opz.) CF_EMBEDDING_MODEL = @cf/baai/bge-m3

Uso:
  python scripts/ingest_normie.py            # ingest completo
  python scripts/ingest_normie.py --dry-run  # solo chunking, nessuna chiamata
  python scripts/ingest_normie.py --limit 20 # prime 20 righe (test)
================================================================================
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

API_BASE = "https://api.cloudflare.com/client/v4"

# Deve combaciare con le dimensioni dell'indice Vectorize (bge-m3 = 1024).
DEFAULT_EMBED_MODEL = "@cf/baai/bge-m3"

CHUNK_CHARS = 1400      # dimensione target del chunk (caratteri)
CHUNK_OVERLAP = 200     # sovrapposizione tra chunk consecutivi
EMBED_BATCH = 50        # testi per chiamata embeddings
UPSERT_BATCH = 100      # vettori per upsert Vectorize
D1_BATCH = 10           # righe per INSERT su D1 (max 100 variabili/query -> 10*8=80)

DDL_CHUNKS = (
    "CREATE TABLE IF NOT EXISTS chunks ("
    "id TEXT PRIMARY KEY, doc_id INTEGER, titolo TEXT, cartella TEXT, "
    "nome_file TEXT, anno INTEGER, chunk_index INTEGER, testo TEXT)"
)


# ---- .env minimale (stesso formato di sync_turso.py) -----------------------
def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


# ---- lettura DB locale ------------------------------------------------------
def read_docs(db_path: Path, limit: Optional[int]) -> List[Dict[str, Any]]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        sql = ("SELECT id, cartella_origine, nuovo_nome_file, anno, titolo, "
               "testo_estratto FROM documenti WHERE testo_estratto IS NOT NULL "
               "AND length(testo_estratto) > 0")
        if limit:
            sql += f" LIMIT {int(limit)}"
        return [dict(r) for r in conn.execute(sql).fetchall()]
    finally:
        conn.close()


# ---- chunking (consapevole della struttura normativa) -----------------------
#
# Obiettivo: NON troncare a metà commi o elenchi puntati. Il testo OCR usa il
# singolo "\n" come a-capo tipografico (non semantico): va riunito. I veri
# confini sono le righe vuote (fine paragrafo) e i marcatori di inizio unità
# normativa (comma numerato "1)"/"1.", lettera "a)", trattino/bullet, "art. N",
# "comma N", "capo", "titolo"). Si impacchettano unità INTERE fino alla soglia;
# solo un'unità più lunga della soglia viene spezzata per frase e, in extremis,
# per parola.

# Inizio di un'unità normativa (riga già ripulita). Lettera con parentesi per
# non confondere abbreviazioni tipo "n." con voci di elenco "a)".
_UNIT_START = re.compile(
    r"^(?:"
    r"\d{1,3}[.)]\s"          # 1)  1.  12)
    r"|[a-zA-Z][)]\s"         # a)  b)  A)
    r"|[a-zA-Z]-?bis[).]\s"   # a-bis)  1bis)
    r"|[-–—•·*▪]\s"           # trattini / bullet
    r"|art(?:\.|icolo)\s*\d"  # art. 5 / articolo 5
    r"|comma\s+\d"            # comma 3
    r"|capo\s+[IVXLC0-9]"     # capo II
    r"|titolo\s+[IVXLC0-9]"   # titolo III
    r")",
    re.IGNORECASE,
)

_SENT_END = re.compile(r"(?<=[.;:])\s+(?=\S)")


def _segment_units(text: str) -> List[str]:
    """Riunisce gli a-capo OCR e spezza in unità (commi, voci di elenco, paragrafi)."""
    units: List[str] = []
    cur = ""
    for raw in text.splitlines():
        line = re.sub(r"[ \t]+", " ", raw).strip()
        if not line:  # riga vuota / solo spazi = confine di paragrafo
            if cur:
                units.append(cur)
                cur = ""
            continue
        if _UNIT_START.match(line) and cur:  # nuova voce di elenco / comma
            units.append(cur)
            cur = line
        else:  # continuazione: ricuci l'a-capo tipografico
            cur = f"{cur} {line}" if cur else line
    if cur:
        units.append(cur)
    return [u.strip() for u in units if u.strip()]


def _split_oversized(unit: str) -> List[str]:
    """Spezza un'unità più lunga della soglia: prima per frase, poi per parola."""
    if len(unit) <= CHUNK_CHARS:
        return [unit]
    out: List[str] = []
    buf = ""
    for sent in _SENT_END.split(unit):
        if len(sent) > CHUNK_CHARS:  # frase abnorme: a-capo su parola
            if buf:
                out.append(buf)
                buf = ""
            word_line = ""
            for word in sent.split(" "):
                if word_line and len(word_line) + len(word) + 1 > CHUNK_CHARS:
                    out.append(word_line)
                    word_line = word
                else:
                    word_line = f"{word_line} {word}".strip()
            buf = word_line
        elif buf and len(buf) + len(sent) + 1 > CHUNK_CHARS:
            out.append(buf)
            buf = sent
        else:
            buf = f"{buf} {sent}".strip()
    if buf:
        out.append(buf)
    return out


def _overlap_prefix(prev_units: List[str]) -> List[str]:
    """Ultime unità INTERE del chunk precedente, fino a ~CHUNK_OVERLAP caratteri.
    Salta un'unità che da sola supera l'overlap: mai gonfiare il chunk."""
    tail: List[str] = []
    tl = 0
    for u in reversed(prev_units):
        if len(u) > CHUNK_OVERLAP:
            break
        if tail and tl + len(u) > CHUNK_OVERLAP:
            break
        tail.insert(0, u)
        tl += len(u) + 1
    return tail


def chunk_text(text: str) -> List[str]:
    # 1) unità semantiche; le uniche spezzate sono quelle oltre soglia
    atoms: List[str] = []
    for unit in _segment_units(text):
        atoms.extend(_split_oversized(unit))
    if not atoms:
        return []

    # 2) impacchetta unità INTERE in chunk base (ognuno <= CHUNK_CHARS)
    base: List[List[str]] = []
    cur: List[str] = []
    cur_len = 0
    for atom in atoms:
        add = len(atom) + (1 if cur else 0)
        if cur and cur_len + add > CHUNK_CHARS:
            base.append(cur)
            cur, cur_len = [], 0
            add = len(atom)
        cur.append(atom)
        cur_len += add
    if cur:
        base.append(cur)

    # 3) overlap: anteponi la coda (unità intere) del chunk precedente.
    #    Dimensione finale garantita <= CHUNK_CHARS + CHUNK_OVERLAP.
    chunks: List[str] = []
    for i, units in enumerate(base):
        prefix = _overlap_prefix(base[i - 1]) if i > 0 else []
        chunks.append(" ".join(prefix + units).strip())
    return [c for c in chunks if c]


def build_chunks(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Ritorna record: {id, doc_id, titolo, cartella, nome_file, anno, idx, testo}."""
    records: List[Dict[str, Any]] = []
    for d in docs:
        pieces = chunk_text(str(d["testo_estratto"]))
        for i, piece in enumerate(pieces):
            records.append({
                "id": f"{d['id']}-{i}",
                "doc_id": int(d["id"]),
                "titolo": d.get("titolo") or d["nuovo_nome_file"],
                "cartella": d["cartella_origine"],
                "nome_file": d["nuovo_nome_file"],
                "anno": int(d.get("anno") or 0),
                "idx": i,
                "testo": piece,
            })
    return records


# ---- client REST Cloudflare -------------------------------------------------
class Cloudflare:
    def __init__(self, account_id: str, token: str) -> None:
        self.account = account_id
        self.token = token

    def _post(self, path: str, data: bytes, content_type: str) -> Dict[str, Any]:
        req = urllib.request.Request(
            f"{API_BASE}{path}", data=data,
            headers={"Authorization": f"Bearer {self.token}",
                     "Content-Type": content_type},
        )
        last_err = "sconosciuto"
        for attempt in range(6):
            try:
                with urllib.request.urlopen(req, timeout=180) as resp:
                    payload = json.load(resp)
                if not payload.get("success", False):
                    errs = "; ".join(e.get("message", "")
                                     for e in payload.get("errors", []))
                    raise RuntimeError(errs or "errore Cloudflare")
                return payload
            except urllib.error.HTTPError as e:
                # errori HTTP: ritenta solo quelli transitori
                if e.code in (408, 409, 429, 500, 502, 503, 504) and attempt < 5:
                    last_err = f"HTTP {e.code}"
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', 'ignore')}")
            except (urllib.error.URLError, http.client.HTTPException,
                    ConnectionError, TimeoutError, OSError) as e:
                # drop di connessione / timeout di rete: transitori, ritenta
                last_err = f"rete: {e}"
                if attempt < 5:
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError(f"errore di rete dopo i retry: {e}")
        raise RuntimeError(f"retry esauriti ({last_err})")

    def embed(self, texts: List[str], model: str) -> List[List[float]]:
        body = json.dumps({"text": texts}).encode("utf-8")
        res = self._post(f"/accounts/{self.account}/ai/run/{model}",
                         body, "application/json")
        return res["result"]["data"]

    def vectorize_upsert(self, index: str, vectors: List[Dict[str, Any]]) -> None:
        ndjson = "\n".join(json.dumps(v, ensure_ascii=False) for v in vectors)
        self._post(f"/accounts/{self.account}/vectorize/v2/indexes/{index}/upsert",
                   ndjson.encode("utf-8"), "application/x-ndjson")

    def d1_query(self, db_id: str, sql: str,
                 params: List[Any]) -> List[Dict[str, Any]]:
        body = json.dumps({"sql": sql, "params": params}).encode("utf-8")
        res = self._post(f"/accounts/{self.account}/d1/database/{db_id}/query",
                         body, "application/json")
        try:
            return res["result"][0]["results"]
        except (KeyError, IndexError, TypeError):
            return []

    def d1_loaded_counts(self, db_id: str) -> Dict[int, int]:
        """Mappa doc_id -> numero di chunk già presenti in D1 (per --resume)."""
        rows = self.d1_query(
            db_id, "SELECT doc_id, COUNT(*) c FROM chunks GROUP BY doc_id", []
        )
        return {int(r["doc_id"]): int(r["c"]) for r in rows}


def batched(seq: Sequence[Any], size: int):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def ingest(records: List[Dict[str, Any]], cf: Cloudflare, index: str,
           db_id: str, model: str) -> None:
    print(f"Chunk totali: {len(records)}")

    # 0) tabella D1
    cf.d1_query(db_id, DDL_CHUNKS, [])

    done = 0
    for batch in batched(records, EMBED_BATCH):
        # 1) embeddings
        vectors_raw = cf.embed([r["testo"] for r in batch], model)

        # 2) upsert Vectorize (metadati leggeri: NO testo -> resta in D1)
        vecs = [{
            "id": r["id"],
            "values": vec,
            "metadata": {
                "docId": r["doc_id"], "titolo": r["titolo"],
                "cartella": r["cartella"], "nomeFile": r["nome_file"],
                "anno": r["anno"], "chunkIndex": r["idx"],
            },
        } for r, vec in zip(batch, vectors_raw)]
        for vb in batched(vecs, UPSERT_BATCH):
            cf.vectorize_upsert(index, vb)

        # 3) testo integrale su D1 (INSERT multi-riga con UPSERT)
        for db in batched(batch, D1_BATCH):
            placeholders = ",".join(["(?,?,?,?,?,?,?,?)"] * len(db))
            sql = (f"INSERT OR REPLACE INTO chunks "
                   f"(id, doc_id, titolo, cartella, nome_file, anno, chunk_index, testo) "
                   f"VALUES {placeholders}")
            params: List[Any] = []
            for r in db:
                params += [r["id"], r["doc_id"], r["titolo"], r["cartella"],
                           r["nome_file"], r["anno"], r["idx"], r["testo"]]
            cf.d1_query(db_id, sql, params)

        done += len(batch)
        print(f"  caricati {done}/{len(records)}", end="\r")
    print("\nOK. Vectorize + D1 popolati. Normie e' pronto.")


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    here = Path(__file__).resolve().parent
    root = here.parent.parent  # scripts/ -> fonticatastali/ -> project root
    p = argparse.ArgumentParser(description="Ingest RAG per Normie (Vectorize+D1).")
    p.add_argument("--db", type=Path,
                   default=root / "Database_Normalizzato" / "catasto_ricerca.db")
    p.add_argument("--env", type=Path, default=root / ".env")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--dry-run", action="store_true",
                   help="Solo lettura+chunking, nessuna chiamata a Cloudflare.")
    p.add_argument("--resume", action="store_true",
                   help="Salta i documenti gia' completi in D1 (per riprendere "
                        "dopo un'interruzione senza sprecare la quota Workers AI).")
    return p.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    load_dotenv(args.env)

    if not args.db.exists():
        sys.stderr.write(f"ERRORE: DB locale non trovato: {args.db}\n")
        return 1

    docs = read_docs(args.db, args.limit)
    records = build_chunks(docs)

    if args.dry_run:
        avg = sum(len(r["testo"]) for r in records) / max(1, len(records))
        print(f"[DRY-RUN] documenti: {len(docs)}  chunk: {len(records)}")
        print(f"[DRY-RUN] lunghezza media chunk: {avg:.0f} caratteri")
        if records:
            print(f"[DRY-RUN] esempio id: {records[0]['id']}  "
                  f"({records[0]['titolo'][:60]}...)")
        return 0

    account = os.environ.get("CF_ACCOUNT_ID")
    token = os.environ.get("CF_API_TOKEN")
    index = os.environ.get("CF_VECTORIZE_INDEX")
    db_id = os.environ.get("CF_D1_DATABASE_ID")
    model = os.environ.get("CF_EMBEDDING_MODEL", DEFAULT_EMBED_MODEL)
    if not all([account, token, index, db_id]):
        sys.stderr.write("ERRORE: imposta CF_ACCOUNT_ID, CF_API_TOKEN, "
                         "CF_VECTORIZE_INDEX, CF_D1_DATABASE_ID (env o .env).\n")
        return 1

    cf = Cloudflare(account, token)

    if args.resume:
        from collections import Counter
        loaded = cf.d1_loaded_counts(db_id)
        expected = Counter(r["doc_id"] for r in records)
        done = {d for d, c in expected.items() if loaded.get(d, 0) >= c}
        before = len(records)
        records = [r for r in records if r["doc_id"] not in done]
        print(f"[RESUME] documenti completi saltati: {len(done)}; "
              f"chunk da caricare: {len(records)} (su {before})")
        if not records:
            print("Niente da fare: tutto gia' caricato.")
            return 0

    try:
        ingest(records, cf, index, db_id, model)
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"\nERRORE durante l'ingest: {exc}\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
