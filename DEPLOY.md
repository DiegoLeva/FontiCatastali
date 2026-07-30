# Deploy di FontiCatastali — runbook

Passi che richiedono i **tuoi account** (GitHub, Turso, Vercel). Copia-incolla in
ordine. La cartella di lavoro è `fonticatastali/` (già un repo git con 1 commit).

---

## 1. GitHub

Crea un repo vuoto su https://github.com/new (es. `fonticatastali`, **senza**
README), poi:

```bash
cd fonticatastali
git remote add origin https://github.com/<tuo-utente>/fonticatastali.git
git push -u origin main
```

---

## 2. Turso (database)

### 2.1 Installa la CLI

- **Windows con Git Bash / WSL**:
  ```bash
  curl -sSfL https://get.tur.so/install.sh | bash
  ```
- **oppure Scoop**:
  ```powershell
  scoop install turso
  ```

### 2.2 Login (apre il browser: usa il tuo account Turso)

```bash
turso auth login
```

### Alternativa senza CLI — Upload dal sito Turso

La dialog "Upload SQLite File" accetta **solo DB con `journal_mode=WAL`**
(altrimenti: *"Protocol error: upload works only for DBs with journal_mode=WAL"*).
Genera un file WAL già pronto (con l'FTS dell'app inclusa):

```bash
# dalla cartella fonticatastali
python scripts/make_turso_db.py
# -> Database_Normalizzato/catasto_ricerca_turso.db  (WAL, FTS5 inclusa)
```

Carica `catasto_ricerca_turso.db`. NON serve poi eseguire `fts5_setup.sql`
(è già dentro). Prendi URL + token dalla pagina del DB. Salta al punto 3.

### 2.3 Crea il DB dal file SQLite già prodotto dalla pipeline

```bash
# dalla cartella fonticatastali
turso db create fonticatastali --from-file ../Database_Normalizzato/catasto_ricerca.db
```

> Se la tua CLI non supporta `--from-file`:
> ```bash
> turso db create fonticatastali
> # crea un dump e caricalo (serve sqlite3, incluso in Git for Windows):
> sqlite3 ../Database_Normalizzato/catasto_ricerca.db .dump | turso db shell fonticatastali
> ```

### 2.4 (Ri)crea l'indice FTS5 ottimizzato per l'app

```bash
turso db shell fonticatastali < sql/fts5_setup.sql
```

### 2.5 Credenziali

```bash
turso db show fonticatastali --url        # -> TURSO_DATABASE_URL
turso db tokens create fonticatastali     # -> TURSO_AUTH_TOKEN
```

Verifica veloce:

```bash
turso db shell fonticatastali "SELECT count(*) FROM documenti_fts;"   # atteso: 1258
```

---

## 3. PDF su bucket (per aprire i file dall'app)

I ~1258 PDF (~1 GB) sono troppi per il bundle Vercel → object storage.

### Opzione A' — Vercel Blob (più semplice, stesso ecosistema)

1. Vercel → Storage → **Create** → Blob. Copia il `BLOB_READ_WRITE_TOKEN`.
2. Carica tutto mantenendo la struttura `<Cartella>/<file>`:
   ```powershell
   # dalla cartella fonticatastali (PowerShell)
   $env:BLOB_READ_WRITE_TOKEN="vercel_blob_rw_xxx"
   node scripts/upload-blob.mjs
   ```
   Lo script stampa a fine upload la **BASE URL** da usare al passo 4:
   `NEXT_PUBLIC_DOCS_BASE_URL = https://<store>.public.blob.vercel-storage.com`
3. Nota: il piano Hobby include ~1 GB Blob; se sfori, usa R2 (opzione A).

### Opzione A — Cloudflare R2 (10 GB gratis, meglio per ~1 GB)

1. Crea un bucket R2 e abilita l'accesso pubblico (dominio `pub-xxx.r2.dev`).
2. Carica la cartella mantenendo la struttura `<Cartella>/<file>.pdf`:
   ```bash
   # con rclone configurato su R2:
   rclone copy ../Database_Normalizzato remote:fonticatastali-docs \
     --include "*.pdf" --include "*.docx" --include "*.xlsx"
   ```
3. `NEXT_PUBLIC_DOCS_BASE_URL = https://pub-xxx.r2.dev`

### Opzione B — Vercel Blob

Carica i file con `@vercel/blob` (SDK) mantenendo i path `<Cartella>/<file>` e usa
la base URL pubblica dello store.

> I nomi contengono spazi e caratteri accentati: l'app li codifica già con
> `encodeURIComponent`. Mantieni **identica** la struttura cartella/nome.

---

## 4. Vercel

1. https://vercel.com/new → importa il repo GitHub. Root Directory = `fonticatastali`.
2. **Environment Variables** (Production + Preview):
   | Nome | Valore |
   |------|--------|
   | `TURSO_DATABASE_URL` | (da 2.5) |
   | `TURSO_AUTH_TOKEN` | (da 2.5) |
   | `NEXT_PUBLIC_DOCS_BASE_URL` | URL bucket (da 3) |
3. **Deploy**. Ogni `git push` su `main` = redeploy automatico (CI/CD).

Framework preset: Next.js (auto). Build: `next build` (default). Nessuna config
extra: l'API route gira già in runtime Node.

---

## 5. Check post-deploy

- Apri l'URL Vercel, cerca "fabbricati rurali" → albero con snippet.
- Clic su un file → PDF dal bucket in nuova scheda.
- Se la ricerca dà errore 500: controlla le env `TURSO_*` su Vercel.
- Se i PDF danno 404: controlla `NEXT_PUBLIC_DOCS_BASE_URL` e i path nel bucket.
