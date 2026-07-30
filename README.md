# FontiCatastali

Motore di ricerca full-text sulla normativa catastale italiana.
**Next.js (App Router) · Tailwind · Framer Motion · Turso (libSQL) · FTS5 · Vercel.**

Ricerca as-you-type con snippet contestuale (keyword evidenziata in `<mark>`) e
risultati in **diagramma ad albero** navigabile: keyword → cartelle (con
conteggio) → file (con anteprima). Click su un file = apre il PDF originale.

---

## 1. Struttura del progetto

```
fonticatastali/
├─ app/
│  ├─ api/
│  │  └─ search/
│  │     └─ route.ts          # API ricerca: FTS5 MATCH + snippet() + grouping
│  ├─ globals.css             # Tailwind + stile <mark> + scrollbar
│  ├─ layout.tsx              # root layout, font Inter, metadata, dark mode
│  └─ page.tsx                # pagina (server) -> monta <SearchApp/>
├─ components/
│  ├─ SearchApp.tsx           # orchestratore client: debounce, fetch, stati
│  ├─ SearchBar.tsx           # barra di ricerca (stile Google/Perplexity)
│  ├─ ResultsTree.tsx         # L1 radice (query) + connettore + rami
│  ├─ FolderNode.tsx          # L2 ramo: cartella + badge, accordion Framer
│  ├─ FileLeaf.tsx            # L3 foglia: file cliccabile + snippet
│  ├─ HighlightedSnippet.tsx  # render sicuro dell'HTML con <mark>
│  ├─ Skeletons.tsx           # skeleton loader (shimmer)
│  └─ icons.tsx               # icone SVG inline (zero dipendenze)
├─ lib/
│  ├─ db.ts                   # client Turso/libSQL (singleton)
│  ├─ fts.ts                  # query MATCH sicura + sanitizzazione snippet
│  ├─ types.ts                # tipi condivisi
│  └─ useDebouncedValue.ts    # hook debounce
├─ sql/
│  └─ fts5_setup.sql          # DDL FTS5 + trigger (da eseguire su Turso)
├─ scripts/
│  └─ copy-docs-locali.ps1    # copia i PDF in public/docs per il dev
├─ .env.example
├─ next.config.mjs
├─ tailwind.config.ts
├─ tsconfig.json
└─ package.json
```

---

## 2. Setup rapido

```bash
cd fonticatastali
npm install
cp .env.example .env.local        # poi compila le variabili (vedi sotto)
npm run dev                        # http://localhost:3000
```

### Test locale SENZA Turso (consigliato per provare subito)

Genera un DB SQLite locale dal DB già prodotto dalla pipeline e applica l'FTS:

```bash
python scripts/setup_local_db.py            # crea local.db (FTS5 dell'app)
```

`.env.local` (già impostato):
```
TURSO_DATABASE_URL=file:local.db
NEXT_PUBLIC_DOCS_BASE_URL=/docs
```

Poi `npm run dev`. Per aprire i PDF in locale:
`powershell -ExecutionPolicy Bypass -File scripts/copy-docs-locali.ps1`.

---

## 3. Migrazione del database su Turso

Il DB locale `../Database_Normalizzato/catasto_ricerca.db` (tabella `documenti`)
è già popolato dalla pipeline Python. Migrazione:

```bash
# 1. login (una tantum)
turso auth login

# 2. crea il DB Turso DIRETTAMENTE dal file SQLite locale (tabelle + dati)
turso db create fonticatastali --from-file ../Database_Normalizzato/catasto_ricerca.db

# 3. (ri)crea l'indice FTS5 ottimizzato per la ricerca dell'app
turso db shell fonticatastali < sql/fts5_setup.sql

# 4. credenziali per l'app
turso db show fonticatastali --url          # -> TURSO_DATABASE_URL
turso db tokens create fonticatastali       # -> TURSO_AUTH_TOKEN
```

> Se `--from-file` non fosse disponibile nella tua versione della CLI:
> ```bash
> sqlite3 ../Database_Normalizzato/catasto_ricerca.db .dump > dump.sql
> turso db create fonticatastali
> turso db shell fonticatastali < dump.sql
> turso db shell fonticatastali < sql/fts5_setup.sql
> ```

Metti i due valori in `.env.local` (e nelle Environment Variables di Vercel).

---

## 4. Come funziona la ricerca (FTS5 + snippet)

**Indice** (`sql/fts5_setup.sql`): tabella virtuale FTS5 *external-content* su
`documenti`, colonne `testo_estratto` (0), `titolo` (1), `tema` (2), tokenizer
`unicode61 remove_diacritics 2` → ricerca **accent-insensitive** (“attivita”
trova “attività”).

**Query** (`app/api/search/route.ts`):

```sql
SELECT d.id, d.cartella_origine, d.nuovo_nome_file,
       snippet(documenti_fts, 0, '<mark>', '</mark>', ' … ', 64) AS snip,
       bm25(documenti_fts, 1.0, 8.0, 4.0) AS rank
FROM documenti_fts
JOIN documenti d ON d.id = documenti_fts.rowid
WHERE documenti_fts MATCH ?          -- es. 'fabbricati* rurali*'
ORDER BY rank
LIMIT 300;
```

- `snippet(col=0, …, 64)`: estrae ~3 righe (max 64 token FTS5 ≈ 150-200 caratteri
  per lato) **centrate sulla keyword**, che viene avvolta nei marcatori.
- **Sicurezza XSS**: i marcatori sono caratteri Private-Use (U+E000/E001); il
  server fa l'escape completo dell'HTML e poi li converte in `<mark>`. L'unico
  tag iniettato è quindi `<mark>`, mai HTML dell'utente o del testo OCR.
- L'input utente è normalizzato in `token*` (prefisso, AND implicito): niente
  caratteri di sintassi FTS → nessuna query malformata.
- `bm25` pesa di più `titolo`/`tema` del corpo per una rilevanza migliore.

Il server raggruppa per `cartella_origine` (ordine per numero di risultati) →
struttura ad albero pronta per il client.

---

## 5. Hosting dei PDF (apertura file)

`FileLeaf` apre `NEXT_PUBLIC_DOCS_BASE_URL/<Cartella>/<nuovo_nome_file>` in una
nuova scheda.

- **Dev locale**: `NEXT_PUBLIC_DOCS_BASE_URL="/docs"` e copia i file:
  ```bash
  powershell -ExecutionPolicy Bypass -File scripts/copy-docs-locali.ps1
  ```
  (serviti staticamente da `public/docs/`).

- **Produzione (consigliato)**: i ~1258 PDF sono troppi/pesanti per il bundle
  Vercel → caricali su un bucket e punta lì la base URL:
  - **Cloudflare R2** (`rclone`/`wrangler`) → `NEXT_PUBLIC_DOCS_BASE_URL="https://pub-xxx.r2.dev"`
  - **Vercel Blob** → `NEXT_PUBLIC_DOCS_BASE_URL="https://<store>.public.blob.vercel-storage.com"`

  Mantieni la struttura `<Cartella>/<file>.pdf` per far combaciare gli URL.

---

## 6. Deploy su Vercel (CI/CD da GitHub)

1. `git init && git add . && git commit -m "init fonticatastali"` → push su GitHub.
2. Su Vercel: **New Project** → importa il repo.
3. **Environment Variables**: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
   `NEXT_PUBLIC_DOCS_BASE_URL`.
4. Deploy. Ogni push su `main` = redeploy automatico.

L'API route gira in runtime **Node** (`@libsql/client`), già dichiarato.

---

## 7. Note di design

- **Mobile-first**, `max-w-3xl` centrato; barra grande stile Perplexity/Google
  che “sale” quando arrivano i risultati (animazione `layout` di Framer).
- Palette neutra **zinc** + accento **brand (blu 600)** + **amber** per i `<mark>`;
  **dark mode automatica**. Contrasti alti per lettura prolungata.
- **Snappy**: debounce 250 ms, `AbortController` per annullare richieste
  superate, transizioni brevi (0.2-0.25s, ease-out), stagger sui risultati.
- **Stati gestiti**: idle (hero + suggerimenti), loading (skeleton shimmer),
  empty, error (con “Riprova”), done.
- **Tema chiaro/scuro**: toggle in alto a destra, persistito in localStorage,
  con script anti-FOUC (nessun lampeggio al caricamento). Default = sistema.
- **Filtro per decennio**: faccette multi-select sopra i risultati (con
  conteggi), ricalcolano l'albero lato client. “Senza data” (0000) in fondo.
