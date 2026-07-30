-- =============================================================================
-- FontiCatastali — configurazione FTS5 su Turso / libSQL
-- Da eseguire UNA VOLTA dopo aver importato catasto_ricerca.db su Turso:
--   turso db shell fonticatastali < sql/fts5_setup.sql
-- =============================================================================

-- La tabella dati `documenti` esiste gia' (creata dalla pipeline Python).
-- Ricreiamo l'indice FTS con tokenizer accent-insensitive (ricerca "attivita"
-- trova "attività") e prefissi.

DROP TABLE IF EXISTS documenti_fts;

CREATE VIRTUAL TABLE documenti_fts USING fts5(
    testo_estratto,          -- colonna 0: usata da snippet()
    titolo,                  -- colonna 1: peso alto nel ranking
    tema,                    -- colonna 2: peso medio nel ranking
    content='documenti',     -- external content: nessuna duplicazione del testo
    content_rowid='id',
    tokenize = 'unicode61 remove_diacritics 2'
);

-- Popola l'indice dai contenuti gia' presenti in `documenti`.
INSERT INTO documenti_fts(documenti_fts) VALUES('rebuild');

-- Trigger di sincronizzazione per inserimenti/modifiche/cancellazioni future.
CREATE TRIGGER IF NOT EXISTS documenti_ai AFTER INSERT ON documenti BEGIN
    INSERT INTO documenti_fts(rowid, testo_estratto, titolo, tema)
    VALUES (new.id, new.testo_estratto, new.titolo, new.tema);
END;

CREATE TRIGGER IF NOT EXISTS documenti_ad AFTER DELETE ON documenti BEGIN
    INSERT INTO documenti_fts(documenti_fts, rowid, testo_estratto, titolo, tema)
    VALUES ('delete', old.id, old.testo_estratto, old.titolo, old.tema);
END;

CREATE TRIGGER IF NOT EXISTS documenti_au AFTER UPDATE ON documenti BEGIN
    INSERT INTO documenti_fts(documenti_fts, rowid, testo_estratto, titolo, tema)
    VALUES ('delete', old.id, old.testo_estratto, old.titolo, old.tema);
    INSERT INTO documenti_fts(rowid, testo_estratto, titolo, tema)
    VALUES (new.id, new.testo_estratto, new.titolo, new.tema);
END;

-- =============================================================================
-- Query di ricerca usata dall'API (riferimento):
--
--   SELECT d.id, d.cartella_origine, d.nuovo_nome_file,
--          snippet(documenti_fts, 0, '<mark>', '</mark>', ' … ', 64) AS snippet,
--          bm25(documenti_fts, 1.0, 8.0, 4.0) AS rank
--   FROM documenti_fts
--   JOIN documenti d ON d.id = documenti_fts.rowid
--   WHERE documenti_fts MATCH 'fabbricati* rurali*'
--   ORDER BY rank
--   LIMIT 300;
-- =============================================================================
