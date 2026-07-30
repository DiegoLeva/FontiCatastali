#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prepara un DB SQLite locale per lo sviluppo (senza Turso):
  - copia ../Database_Normalizzato/catasto_ricerca.db -> fonticatastali/local.db
  - applica sql/fts5_setup.sql (indice FTS5 dell'app)

Uso (dalla cartella fonticatastali):
    python scripts/setup_local_db.py

Poi in .env.local:
    TURSO_DATABASE_URL=file:local.db
"""
from __future__ import annotations
import os
import shutil
import sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)                         # fonticatastali/
SRC = os.path.normpath(os.path.join(APP, "..", "Database_Normalizzato",
                                    "catasto_ricerca.db"))
DST = os.path.join(APP, "local.db")
FTS = os.path.join(APP, "sql", "fts5_setup.sql")


def main() -> None:
    if not os.path.exists(SRC):
        raise SystemExit(f"DB sorgente non trovato: {SRC}")
    shutil.copy(SRC, DST)
    conn = sqlite3.connect(DST)
    try:
        conn.executescript(open(FTS, encoding="utf-8").read())
        conn.commit()
        n = conn.execute("SELECT count(*) FROM documenti_fts").fetchone()[0]
    finally:
        conn.close()
    print(f"OK: {DST} pronto ({n} righe indicizzate in FTS5).")
    print("Imposta in .env.local:  TURSO_DATABASE_URL=file:local.db")


if __name__ == "__main__":
    main()
