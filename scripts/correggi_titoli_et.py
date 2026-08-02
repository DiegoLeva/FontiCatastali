#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ricompone `titolo` preservando l'identificativo d'atto ORIGINALE (con suffisso
E/T), preso dal backup pre-titoli, + l'oggetto:  "{atto originale} - {oggetto}".
Aggiorna catasto_ricerca.db e (con --d1) D1. Poi lanciare sync_turso.py.

  python scripts/correggi_titoli_et.py --orig-db "<backup .db>"            # DRY-RUN
  python scripts/correggi_titoli_et.py --orig-db "<backup>" --apply --d1
"""
from __future__ import annotations
import argparse, http.client, json, os, shutil, sqlite3, sys, time
import urllib.error, urllib.request
from pathlib import Path
from typing import Optional, Sequence

MAX_ATTO = 22  # oltre questa lunghezza l'orig non e' un id d'atto (es. stem Sito Ade)


def compose(orig: str, ogg: str) -> str:
    orig = (orig or "").strip(); ogg = (ogg or "").strip()
    atto = orig if (orig and orig.lower() != "s.n." and len(orig) <= MAX_ATTO) else ""
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
    p.add_argument("--orig-db", type=Path, required=True,
                   help="backup con i titoli originali (con E/T) e l'oggetto")
    p.add_argument("--env", type=Path, default=root / ".env")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--d1", action="store_true")
    a = p.parse_args(argv)

    # atto originale + oggetto dal backup
    ob = sqlite3.connect(a.orig_db); ob.row_factory = sqlite3.Row
    orig = {r["id"]: (r["titolo"], r["oggetto"])
            for r in ob.execute("SELECT id, titolo, oggetto FROM documenti")}
    ob.close()

    conn = sqlite3.connect(a.db); conn.row_factory = sqlite3.Row
    cur = {r["id"]: r["titolo"] for r in conn.execute("SELECT id, titolo FROM documenti")}
    updates = []
    for _id, (otit, ogg) in orig.items():
        new = compose(otit, ogg)
        if new and new != cur.get(_id):
            updates.append((new, _id))
    print(f"titoli da correggere: {len(updates)}")
    for new, _ in updates[:6]:
        print("   ->", new)
    if not a.apply:
        print("[DRY-RUN] --apply per eseguire."); conn.close(); return 0

    bak = a.db.with_suffix(f".db.bak-etfix-{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(a.db, bak); print(f"backup -> {bak.name}")
    conn.executemany("UPDATE documenti SET titolo=? WHERE id=?", updates)
    conn.commit(); print(f"DB: {conn.total_changes} righe"); conn.close()

    if a.d1:
        load_dotenv(a.env)
        acc = os.environ.get("CF_ACCOUNT_ID"); tok = os.environ.get("CF_API_TOKEN")
        dbid = os.environ.get("CF_D1_DATABASE_ID")
        if not all([acc, tok, dbid]):
            sys.stderr.write("ERRORE: credenziali CF mancanti\n"); return 1
        ok = fail = 0
        for i, (new, _id) in enumerate(updates, 1):
            try:
                d1(acc, tok, dbid, "UPDATE chunks SET titolo=? WHERE doc_id=?", [new, _id]); ok += 1
            except Exception as exc:  # noqa: BLE001
                fail += 1; sys.stderr.write(f"  ! id={_id}: {exc}\n")
            if i % 100 == 0:
                print(f"  D1 {i}/{len(updates)} ok={ok} fail={fail}", flush=True)
        print(f"D1 FINE. ok={ok} fail={fail}")
    print("OK. Ora: python sync_turso.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
