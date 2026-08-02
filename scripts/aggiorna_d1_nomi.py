#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
STADIO 2c - Aggiorna il nome file (nome_file) su Cloudflare D1 dopo la rinomina.
D1 e' la fonte autoritativa dei nomi per Normie (vedi route refactor), quindi
questo e' cio' che fa puntare i bottoni-fonte ai PDF rinominati.

  python scripts/aggiorna_d1_nomi.py --dry-run
  python scripts/aggiorna_d1_nomi.py --apply

Credenziali: CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID (da .env root).
"""
from __future__ import annotations
import argparse, csv, http.client, json, os, sys, time, urllib.error, urllib.request
from pathlib import Path
from typing import Optional, Sequence

API_BASE = "https://api.cloudflare.com/client/v4"


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def d1(account: str, token: str, dbid: str, sql: str, params) -> None:
    body = json.dumps({"sql": sql, "params": params}).encode()
    req = urllib.request.Request(
        f"{API_BASE}/accounts/{account}/d1/database/{dbid}/query", data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
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
    here = Path(__file__).resolve().parent
    root = here.parent.parent
    p = argparse.ArgumentParser()
    p.add_argument("--map", type=Path,
                   default=root / "Database_Normalizzato" / "rinomina_map.csv")
    p.add_argument("--env", type=Path, default=root / ".env")
    p.add_argument("--apply", action="store_true")
    a = p.parse_args(argv)
    load_dotenv(a.env)
    acc = os.environ.get("CF_ACCOUNT_ID"); tok = os.environ.get("CF_API_TOKEN")
    dbid = os.environ.get("CF_D1_DATABASE_ID")
    if not all([acc, tok, dbid]):
        sys.stderr.write("ERRORE: CF_ACCOUNT_ID/CF_API_TOKEN/CF_D1_DATABASE_ID mancanti.\n")
        return 1

    rows = [r for r in csv.DictReader(a.map.open(encoding="utf-8"))
            if r["vecchio"] != r["nuovo"]]
    print(f"documenti da aggiornare su D1: {len(rows)}")
    if not a.apply:
        print("[DRY-RUN] usa --apply per eseguire.")
        return 0

    ok = fail = 0
    for i, r in enumerate(rows, 1):
        try:
            d1(acc, tok, dbid, "UPDATE chunks SET nome_file=? WHERE doc_id=?",
               [r["nuovo"], int(r["id"])])
            ok += 1
        except Exception as exc:  # noqa: BLE001
            fail += 1
            sys.stderr.write(f"  ! id={r['id']}: {exc}\n")
        if i % 100 == 0:
            print(f"  {i}/{len(rows)}  ok={ok} fail={fail}", flush=True)
    print(f"FINE. ok={ok} fail={fail}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
