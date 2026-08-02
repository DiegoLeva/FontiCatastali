#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
STADIO 2b - Rinomina gli oggetti su Cloudflare R2 (server-side, nessun download).
Zero-downtime: prima --copy (vecchio->nuovo, restano entrambi), poi si aggiornano
DB/D1/Turso, infine --delete-old (rimuove i vecchi).

  python scripts/rinomina_r2.py --dry-run
  python scripts/rinomina_r2.py --copy          # copia vecchio->nuovo
  python scripts/rinomina_r2.py --delete-old    # cancella i vecchi (a switch fatto)

Richiede rclone con remote 'R2:' configurato.
"""
from __future__ import annotations
import argparse, csv, subprocess, sys
from pathlib import Path
from typing import Optional, Sequence

BUCKET = "R2:fonticatastali-docs"


def run(cmd) -> bool:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(f"  ! {' '.join(cmd[:2])} fallito: {r.stderr.strip()[:120]}\n")
        return False
    return True


def main(argv: Optional[Sequence[str]] = None) -> int:
    here = Path(__file__).resolve().parent
    root = here.parent.parent
    p = argparse.ArgumentParser()
    p.add_argument("--map", type=Path,
                   default=root / "Database_Normalizzato" / "rinomina_map.csv")
    p.add_argument("--bucket", default=BUCKET)
    p.add_argument("--copy", action="store_true")
    p.add_argument("--delete-old", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args(argv)

    rows = [r for r in csv.DictReader(a.map.open(encoding="utf-8"))
            if r["vecchio"] != r["nuovo"]]
    print(f"oggetti da processare: {len(rows)}")
    if a.dry_run or not (a.copy or a.delete_old):
        for r in rows[:3]:
            print(f"  {a.bucket}/{r['cartella']}/{r['vecchio']}")
            print(f"    -> {a.bucket}/{r['cartella']}/{r['nuovo']}")
        print("[DRY-RUN] usa --copy oppure --delete-old.")
        return 0

    ok = fail = 0
    for i, r in enumerate(rows, 1):
        old = f"{a.bucket}/{r['cartella']}/{r['vecchio']}"
        new = f"{a.bucket}/{r['cartella']}/{r['nuovo']}"
        if a.copy:
            good = run(["rclone", "copyto", old, new, "--s3-no-check-bucket"])
        else:  # delete-old
            good = run(["rclone", "deletefile", old, "--s3-no-check-bucket"])
        ok += good
        fail += (not good)
        if i % 100 == 0:
            print(f"  {i}/{len(rows)}  ok={ok} fail={fail}", flush=True)
    print(f"FINE. ok={ok} fail={fail}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
