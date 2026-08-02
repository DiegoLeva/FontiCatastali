#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Allinea il `titolo` su D1 (chunks) a quello di catasto_ricerca.db (fonte).
Usato per i bottoni-fonte di Normie dopo aver ricomposto i titoli descrittivi.

  python scripts/push_titoli_d1.py            # DRY-RUN (conteggio)
  python scripts/push_titoli_d1.py --apply
Credenziali: CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID (da .env root).
"""
from __future__ import annotations
import argparse, http.client, json, os, sqlite3, sys, time
import urllib.error, urllib.request
from pathlib import Path
from typing import Optional, Sequence


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
        data=body, headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
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
    a = p.parse_args(argv)

    conn = sqlite3.connect(a.db)
    rows = conn.execute("SELECT id, titolo FROM documenti "
                        "WHERE titolo IS NOT NULL AND titolo != ''").fetchall()
    conn.close()
    print(f"documenti con titolo: {len(rows)}")
    if not a.apply:
        print("[DRY-RUN] --apply per scrivere su D1."); return 0

    load_dotenv(a.env)
    acc = os.environ.get("CF_ACCOUNT_ID"); tok = os.environ.get("CF_API_TOKEN")
    dbid = os.environ.get("CF_D1_DATABASE_ID")
    if not all([acc, tok, dbid]):
        sys.stderr.write("ERRORE: credenziali CF mancanti.\n"); return 1
    ok = fail = 0
    for i, (idv, tit) in enumerate(rows, 1):
        try:
            d1(acc, tok, dbid, "UPDATE chunks SET titolo=? WHERE doc_id=?", [tit, idv]); ok += 1
        except Exception as exc:  # noqa: BLE001
            fail += 1; sys.stderr.write(f"  ! id={idv}: {exc}\n")
        if i % 100 == 0:
            print(f"  {i}/{len(rows)} ok={ok} fail={fail}", flush=True)
    print(f"FINE. ok={ok} fail={fail}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
