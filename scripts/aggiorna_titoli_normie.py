#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Aggiorna il campo `titolo` (mostrato dal sito: albero + risultati) rendendolo
descrittivo: "{Tipo} {Numero} - {Oggetto}" (l'anno e' gia' in colonna a parte).
Aggiorna catasto_ricerca.db e, con --d1, anche D1 (bottoni-fonte di Normie).

  python scripts/aggiorna_titoli_normie.py                 # DRY-RUN
  python scripts/aggiorna_titoli_normie.py --apply         # aggiorna il .db (backup)
  python scripts/aggiorna_titoli_normie.py --apply --d1    # anche D1
Dopo --apply: lanciare `python sync_turso.py` per la ricerca online.
"""
from __future__ import annotations
import argparse, http.client, json, os, shutil, sqlite3, sys, time
import urllib.error, urllib.request
from pathlib import Path
from typing import Optional, Sequence


def compose(tipo: str, num: str, ogg: str) -> str:
    tipo = (tipo or "").strip(); num = (num or "").strip(); ogg = (ogg or "").strip()
    atto = f"{tipo} {num}".strip() if tipo else ""
    if atto and ogg:
        return f"{atto} - {ogg}"
    return ogg or atto


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def d1(acc, tok, dbid, sql, params) -> None:
    body = json.dumps({"sql": sql, "params": params}).encode()
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{acc}/d1/database/{dbid}/query",
        data=body, headers={"Authorization": f"Bearer {tok}",
                            "Content-Type": "application/json"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                p = json.load(r)
            if not p.get("success"):
                raise RuntimeError("; ".join(e.get("message", "") for e in p.get("errors", [])))
            return
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(2 ** attempt); continue
            raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8','ignore')}")
        except (urllib.error.URLError, http.client.HTTPException, ConnectionError,
                TimeoutError, OSError):
            if attempt < 5:
                time.sleep(2 ** attempt); continue
            raise


def main(argv: Optional[Sequence[str]] = None) -> int:
    here = Path(__file__).resolve().parent; root = here.parent.parent
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path,
                   default=root / "Database_Normalizzato" / "catasto_ricerca.db")
    p.add_argument("--env", type=Path, default=root / ".env")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--d1", action="store_true", help="propaga i titoli anche a D1")
    a = p.parse_args(argv)

    conn = sqlite3.connect(a.db); conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT id, tipo_documento t, numero_documento n, "
                        "oggetto o, titolo cur FROM documenti").fetchall()
    updates = []
    for r in rows:
        new = compose(r["t"], r["n"], r["o"])
        if new and new != r["cur"]:
            updates.append((new, r["id"]))
    print(f"documenti: {len(rows)}  titoli da aggiornare: {len(updates)}")
    for new, _id in updates[:5]:
        print("   ->", new)
    if not a.apply:
        print("[DRY-RUN] nessuna modifica. --apply per eseguire."); conn.close(); return 0

    bak = a.db.with_suffix(f".db.bak-titoli-{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(a.db, bak); print(f"backup -> {bak.name}")
    conn.executemany("UPDATE documenti SET titolo=? WHERE id=?", updates)
    conn.commit(); print(f"DB aggiornato: {conn.total_changes} righe")
    conn.close()

    if a.d1:
        load_dotenv(a.env)
        acc = os.environ.get("CF_ACCOUNT_ID"); tok = os.environ.get("CF_API_TOKEN")
        dbid = os.environ.get("CF_D1_DATABASE_ID")
        if not all([acc, tok, dbid]):
            sys.stderr.write("ERRORE: credenziali CF mancanti per --d1\n"); return 1
        ok = fail = 0
        for i, (new, _id) in enumerate(updates, 1):
            try:
                d1(acc, tok, dbid, "UPDATE chunks SET titolo=? WHERE doc_id=?", [new, _id]); ok += 1
            except Exception as exc:  # noqa: BLE001
                fail += 1; sys.stderr.write(f"  ! id={_id}: {exc}\n")
            if i % 100 == 0:
                print(f"  D1 {i}/{len(updates)} ok={ok} fail={fail}", flush=True)
        print(f"D1 FINE. ok={ok} fail={fail}")
    print("OK. Ora lancia: python sync_turso.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
