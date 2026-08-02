#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
STADIO 2a - Applica la rinomina in LOCALE: file su disco + catasto_ricerca.db.
Legge Database_Normalizzato/rinomina_map.csv. NON tocca R2/Turso/D1.

  python scripts/applica_rinomina_locale.py            # DRY-RUN (nessuna modifica)
  python scripts/applica_rinomina_locale.py --apply    # applica (fa backup del .db)

Idempotente: se il file e' gia' rinominato (vecchio assente, nuovo presente) salta.
"""
from __future__ import annotations
import argparse, csv, shutil, sqlite3, sys, time
from pathlib import Path
from typing import Optional, Sequence


def parse_args(argv: Optional[Sequence[str]] = None):
    here = Path(__file__).resolve().parent
    root = here.parent.parent
    p = argparse.ArgumentParser()
    p.add_argument("--base", type=Path, default=root / "Database_Normalizzato")
    p.add_argument("--db", type=Path,
                   default=root / "Database_Normalizzato" / "catasto_ricerca.db")
    p.add_argument("--map", type=Path,
                   default=root / "Database_Normalizzato" / "rinomina_map.csv")
    p.add_argument("--apply", action="store_true")
    return p.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    a = parse_args(argv)
    rows = list(csv.DictReader(a.map.open(encoding="utf-8")))
    to_rename = already = missing = collide = 0
    plan = []
    for r in rows:
        old = a.base / r["cartella"] / r["vecchio"]
        new = a.base / r["cartella"] / r["nuovo"]
        if r["vecchio"] == r["nuovo"]:
            continue
        if old.is_file():
            if new.exists():
                collide += 1
            else:
                to_rename += 1
                plan.append((int(r["id"]), old, new, r["nuovo"], r["oggetto"]))
        elif new.is_file():
            already += 1
            plan.append((int(r["id"]), None, new, r["nuovo"], r["oggetto"]))  # solo DB
        else:
            missing += 1
    print(f"righe: {len(rows)}  da_rinominare: {to_rename}  gia_fatti: {already}"
          f"  mancanti: {missing}  collisioni: {collide}")

    if not a.apply:
        print("[DRY-RUN] nessuna modifica. Rilancia con --apply per eseguire.")
        for _, old, new, _, _ in plan[:5]:
            print("  ", (old.name if old else "(gia')"), "->", new.name)
        return 0
    if collide:
        sys.stderr.write("STOP: collisioni presenti, risolvi prima.\n"); return 1

    # backup DB
    bak = a.db.with_suffix(f".db.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(a.db, bak)
    print(f"backup DB -> {bak.name}")

    # 1) rinomina file su disco
    done = 0
    for _id, old, new, _, _ in plan:
        if old is not None:
            old.rename(new)
            done += 1
    print(f"file rinominati: {done}")

    # 2) aggiorna sqlite (nuovo_nome_file + oggetto)
    conn = sqlite3.connect(a.db)
    try:
        conn.executemany(
            "UPDATE documenti SET nuovo_nome_file=?, oggetto=? WHERE id=?",
            [(nuovo, ogg, _id) for _id, _o, _n, nuovo, ogg in plan])
        conn.commit()
        n = conn.total_changes
    finally:
        conn.close()
    print(f"righe DB aggiornate: {n}")
    print("OK locale.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
