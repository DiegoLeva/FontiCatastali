#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
 genera_nomi_normie.py  -  STADIO 1 della rinomina: genera la mappa dei nomi
================================================================================
Per ogni documento in `catasto_ricerca.db` chiede al modello Workers AI (70B)
un OGGETTO conciso e corretto (accenti inclusi) a partire dal testo OCR, poi
costruisce il nuovo nome file secondo lo schema:

    {Anno} - {Tipo} {Numero} - {Oggetto}.{ext}
    (se manca il numero:  {Anno} - {Tipo} - {Oggetto}.{ext})
    (se manca anche il tipo:  {Anno} - {Oggetto}.{ext})
    (anno 0 -> "s.d.")

NON rinomina nulla: scrive solo la mappa CSV `Database_Normalizzato/rinomina_map.csv`
(colonne: id,cartella,vecchio,nuovo,oggetto). Idempotente/resumibile: al
re-run salta gli id gia' presenti nella mappa.

Uso:
  python scripts/genera_nomi_normie.py --limit 15 --sample   # anteprima a video
  python scripts/genera_nomi_normie.py                        # mappa completa
Credenziali: CF_ACCOUNT_ID, CF_API_TOKEN (+ opz. CF_LLM_MODEL) da .env root.
================================================================================
"""
from __future__ import annotations

import argparse
import csv
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
DEFAULT_LLM = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"

OGGETTO_MAX = 70          # lunghezza massima dell'oggetto (caratteri)
TESTO_MAX = 1800          # testo OCR inviato al modello
# Caratteri illegali in un nome file Windows.
ILLEGAL = re.compile(r'[\\/:*?"<>|]')

SYSTEM = ("Sei un archivista esperto di normativa e prassi catastale italiana. "
          "Assegni a ogni documento un oggetto sintetico e preciso.")

PROMPT = ("Dal testo seguente, scrivi UN SOLO oggetto conciso in italiano "
          "corretto, massimo 8 parole, che descriva il contenuto SPECIFICO del "
          "documento. NON includere il tipo di atto, il numero, la data o "
          "l'ente emittente. Niente virgolette, niente punto finale.\n"
          "IMPORTANTE: il testo proviene da OCR e puo' contenere caratteri "
          "corrotti (es. il simbolo �) o accenti mancanti. NON copiarli "
          "MAI: scrivi sempre italiano impeccabile con gli accenti corretti "
          "(a'->a con accento, es. 'utilita'->'utilità', 'pubblicita'->"
          "'pubblicità', 'ruralita'->'ruralità'). Rispondi con la sola frase."
          "\n\nTESTO:\n{testo}")


# ---- .env -------------------------------------------------------------------
def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# ---- Workers AI (chat) ------------------------------------------------------
class LLM:
    def __init__(self, account: str, token: str, model: str) -> None:
        self.account, self.token, self.model = account, token, model

    def oggetto(self, testo: str) -> str:
        body = json.dumps({
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": PROMPT.format(testo=testo[:TESTO_MAX])},
            ],
            "max_tokens": 40, "temperature": 0.1,
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{API_BASE}/accounts/{self.account}/ai/run/{self.model}", data=body,
            headers={"Authorization": f"Bearer {self.token}",
                     "Content-Type": "application/json"})
        for attempt in range(6):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    p = json.load(r)
                if not p.get("success"):
                    raise RuntimeError("; ".join(e.get("message", "")
                                                 for e in p.get("errors", [])))
                return p["result"]["response"]
            except urllib.error.HTTPError as e:
                if e.code in (408, 409, 429, 500, 502, 503, 504) and attempt < 5:
                    time.sleep(2 ** attempt); continue
                raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8','ignore')}")
            except (urllib.error.URLError, http.client.HTTPException,
                    ConnectionError, TimeoutError, OSError):
                if attempt < 5:
                    time.sleep(2 ** attempt); continue
                raise


# ---- normalizzazione nome ---------------------------------------------------
# Caratteri ammessi nell'oggetto (lettere latine + accentate, cifre, punteggiatura
# minima). Qualsiasi altro (incluso ogni variante di carattere corrotto) viene tolto.
_ALLOWED = re.compile(r"[^0-9A-Za-zÀ-ÿ ()\-_,.'&]")


def repair_mojibake(s: str) -> str:
    """Ripara i casi comuni di -ità/parole tronche, poi elimina QUALSIASI
    carattere non ammesso (garanzia: nessun carattere corrotto nel nome file)."""
    # 1) recupero dei finali accentati corrotti. Nel dominio catastale i finali
    #    tronchi sono quasi sempre '-tà' (proprietà, unità, utilità, città,
    #    ruralità, attività...): un carattere corrotto dopo 'lettera+t' a fine
    #    parola -> 'tà'.
    s = re.sub(r"([a-z]t)[^\x00-\x7F](?=\s|$)", r"\1à", s)
    s = s.replace("perch�", "perché").replace("cos�", "così").replace("pi�", "più")
    # 2) whitelist: via ogni carattere fuori dall'insieme ammesso.
    return _ALLOWED.sub("", s)


def clean_oggetto(raw: str) -> str:
    s = raw.strip().strip('"').strip("'").replace("\n", " ")
    # rimuovi eventuali prefissi tipo "Oggetto:" prodotti dal modello
    s = re.sub(r"^\s*oggetto\s*[:\-]\s*", "", s, flags=re.IGNORECASE)
    s = repair_mojibake(s)
    s = ILLEGAL.sub("", s)
    s = re.sub(r"\s+", " ", s).strip(" .-")
    if len(s) > OGGETTO_MAX:
        s = s[:OGGETTO_MAX].rsplit(" ", 1)[0].strip(" .-")
    return s


def fmt_anno(a: Any) -> str:
    n = int(a or 0)
    return str(n) if n > 0 else "s.d."


def build_name(anno: Any, tipo: str, num: str, oggetto: str, ext: str) -> str:
    tipo = (tipo or "").strip()
    num = (num or "").strip()
    if tipo and num:
        atto = f"{tipo} {num}"
    elif tipo:
        atto = tipo
    else:
        atto = ""
    parts = [fmt_anno(anno)] + ([atto] if atto else []) + [oggetto]
    base = " - ".join(p for p in parts if p)
    base = ILLEGAL.sub("", base).strip(" .")
    return f"{base}{ext}"


def dedup(name: str, used: set) -> str:
    if name.lower() not in used:
        used.add(name.lower()); return name
    stem, dot, ext = name.rpartition(".")
    stem = stem or name
    i = 2
    while True:
        cand = f"{stem} ({i}).{ext}" if dot else f"{name} ({i})"
        if cand.lower() not in used:
            used.add(cand.lower()); return cand
        i += 1


# ---- DB ---------------------------------------------------------------------
def read_docs(db: Path, limit: Optional[int], sample: bool) -> List[Dict[str, Any]]:
    conn = sqlite3.connect(db); conn.row_factory = sqlite3.Row
    try:
        sql = ("SELECT id, cartella_origine, nuovo_nome_file, anno, "
               "tipo_documento, numero_documento, testo_estratto "
               "FROM documenti WHERE testo_estratto IS NOT NULL "
               "AND length(testo_estratto) > 0")
        # nel sample prendi doc casuali (varieta' tra cartelle)
        if sample:
            sql += " ORDER BY RANDOM()"
        if limit:
            sql += f" LIMIT {int(limit)}"
        return [dict(r) for r in conn.execute(sql).fetchall()]
    finally:
        conn.close()


def load_existing(map_csv: Path) -> Dict[int, Dict[str, str]]:
    if not map_csv.exists():
        return {}
    out: Dict[int, Dict[str, str]] = {}
    with map_csv.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            out[int(row["id"])] = row
    return out


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    here = Path(__file__).resolve().parent
    root = here.parent.parent
    p = argparse.ArgumentParser(description="Genera la mappa di rinomina (LLM).")
    p.add_argument("--db", type=Path,
                   default=root / "Database_Normalizzato" / "catasto_ricerca.db")
    p.add_argument("--out", type=Path,
                   default=root / "Database_Normalizzato" / "rinomina_map.csv")
    p.add_argument("--env", type=Path, default=root / ".env")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--sample", action="store_true",
                   help="Solo anteprima a video (non scrive il CSV).")
    return p.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    load_dotenv(args.env)
    account = os.environ.get("CF_ACCOUNT_ID")
    token = os.environ.get("CF_API_TOKEN")
    model = os.environ.get("CF_LLM_MODEL", DEFAULT_LLM)
    if not account or not token:
        sys.stderr.write("ERRORE: CF_ACCOUNT_ID / CF_API_TOKEN mancanti.\n")
        return 1
    if not args.db.exists():
        sys.stderr.write(f"ERRORE: DB non trovato: {args.db}\n")
        return 1

    llm = LLM(account, token, model)
    docs = read_docs(args.db, args.limit, args.sample)
    existing = {} if args.sample else load_existing(args.out)

    # nomi gia' usati per cartella (per il dedup), inizializzati dalla mappa
    used_by_dir: Dict[str, set] = {}
    for row in existing.values():
        used_by_dir.setdefault(row["cartella"], set()).add(row["nuovo"].lower())

    rows_out: List[Dict[str, str]] = []
    for d in docs:
        if d["id"] in existing:
            continue
        ext = Path(str(d["nuovo_nome_file"])).suffix or ".pdf"
        try:
            ogg = clean_oggetto(llm.oggetto(str(d["testo_estratto"])))
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"\n[skip id={d['id']}] errore LLM: {exc}\n")
            continue
        if not ogg:
            ogg = "Documento"
        used = used_by_dir.setdefault(d["cartella_origine"], set())
        new = dedup(build_name(d["anno"], d["tipo_documento"],
                               d["numero_documento"], ogg, ext), used)
        rec = {"id": str(d["id"]), "cartella": d["cartella_origine"],
               "vecchio": d["nuovo_nome_file"], "nuovo": new, "oggetto": ogg}
        rows_out.append(rec)

        if args.sample:
            print(f"[{d['cartella_origine']}]")
            print(f"   VECCHIO: {d['nuovo_nome_file']}")
            print(f"   NUOVO:   {new}")
        else:
            print(f"  generati {len(rows_out)}", end="\r")

    if args.sample:
        print(f"\n[SAMPLE] {len(rows_out)} nomi generati (nessun file scritto).")
        return 0

    # append/merge nel CSV (resumibile)
    all_rows = list(existing.values()) + rows_out
    all_rows.sort(key=lambda r: int(r["id"]))
    with args.out.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "cartella", "vecchio", "nuovo", "oggetto"])
        w.writeheader(); w.writerows(all_rows)
    print(f"\nOK. Mappa: {args.out}  ({len(all_rows)} righe totali, "
          f"{len(rows_out)} nuove).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
