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

I ~1258 PDF sono troppi per il bundle Vercel → object storage.

### Opzione A — Cloudflare R2 (consigliata, ha un tier gratuito generoso)

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
