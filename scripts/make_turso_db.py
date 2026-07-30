#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prepara il DB per l'UPLOAD dal sito Turso ("Upload SQLite File"), che accetta
solo DB con journal_mode=WAL:
  - copia ../Database_Normalizzato/catasto_ricerca.db -> ..._turso.db
  - applica l'indice FTS5 dell'app (sql/fts5_setup.sql)
  - imposta journal_mode=WAL + checkpoint TRUNCATE
Risultato: un unico file .db WAL self-contained, con FTS gia' pronta.

Uso (dalla cartella fonticatastali):
    python scripts/make_turso_db.py
"""
from __future__ import annotations
import os
import shutil
import sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)  # fonticatastali/
SRC = os.path.normpath(os.path.join(APP, "..", "Database_Normalizzato",
                                    "catasto_ricerca.db"))
DST = os.path.normpath(os.path.join(APP, "..", "Database_Normalizzato",
                                    "catasto_ricerca_turso.db"))
FTS = os.path.join(APP, "sql", "fts5_setup.sql")


def main() -> None:
    if not os.path.exists(SRC):
        raise SystemExit(f"DB sorgente non trovato: {SRC}")

    for suffix in ("", "-wal", "-shm"):
        p = DST + suffix
        if os.path.exists(p):
            os.remove(p)

    shutil.copy(SRC, DST)
    conn = sqlite3.connect(DST)
    try:
        conn.executescript(open(FTS, encoding="utf-8").read())
        conn.commit()
        mode = conn.execute("PRAGMA journal_mode=WAL;").fetchone()[0]
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        conn.commit()
        fts_rows = conn.execute("SELECT count(*) FROM documenti_fts").fetchone()[0]
    finally:
        conn.close()

    size_mb = round(os.path.getsize(DST) / (1024 * 1024), 1)
    print(f"Creato: {DST}")
    print(f"  journal_mode: {mode} | documenti_fts: {fts_rows} | {size_mb} MB")
    print("Carica questo file nella dialog 'Upload SQLite File' di Turso.")


if __name__ == "__main__":
    main()
