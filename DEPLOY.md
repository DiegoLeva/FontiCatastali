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

## 4-bis. Aggiornamento automatico e Studio Normativo

| Variabile | Obbligatoria | A cosa serve |
|-----------|--------------|--------------|
| `CRON_SECRET` | **sì** per il cron | autentica il cron del lunedì (`openssl rand -hex 32`) |
| `AGGIORNAMENTI_WEBHOOK_URL` | no | notifica Slack/Discord/Teams di novità ed errori |
| `CF_STUDIO_MAP_MODEL`, `CF_STUDIO_WRITE_MODEL` | no | modelli dello Studio (default `CF_LLM_MODEL` = Gemma 4 26B A4B) |
| `STUDIO_MAX_PER_IP`, `STUDIO_MAX_GIORNO`, `STUDIO_NEURONI_DOSSIER` | no | limiti dei dossier (default 4/10 min per IP, 4 nuovi al giorno, 2.500 neuroni l'uno) |
| `AI_NEURONI_GIORNO`, `AI_NEURONI_RISERVA` | no | tetto giornaliero di neuroni (default 8.800, max 9.500) e riserva per Normie e cron (2.000) |
| `AI_SYNC_REMOTA`, `VECTORIZE_OLTRE_QUOTA` | no | allineamento al consumo reale (default attivo) e guardiano Vectorize (default attivo) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | no | archivio dei PDF importati su R2 (vedi 4-ter); senza, l'archivio resta spento |
| `R2_ACCOUNT_ID`, `R2_URL_PUBBLICO`, `R2_PREFISSO`, `R2_MAX_GB` | no | account (default `CF_ACCOUNT_ID`), base pubblica, cartella (`aggiornamenti`) e tetto di spazio (2 GB, max 5) |

- Il token **Turso** deve poter scrivere (default di `turso db tokens create`):
  servono le tabelle `aggiornamenti_*` e `studio_dossier`, create al primo uso.
- Il token **Cloudflare** con soli permessi di lettura basta per Normie e lo
  Studio; per indicizzare in Normie anche gli atti importati dal cron servono
  **Vectorize Edit** e **D1 Edit** (senza, la ricerca, la mappa e lo Studio li
  vedono comunque; la pagina `/aggiornamenti` segnala l'arretrato).
- **Spesa AI a 0 € extra** (`lib/ai/budget.ts`): Cloudflare include 10.000
  neuroni al giorno per account (azzerati alle 00:00 UTC, 01:00 in Italia);
  sul piano Workers Paid il resto si paga. Ogni chiamata prenota su Turso il
  suo costo massimo PRIMA di partire e si salda sui token reali (+15%): oltre
  il tetto di 8.800 neuroni la chiamata non parte. 2.000 neuroni restano
  riservati a Normie e cron; lo Studio fa al massimo 4 nuovi dossier al giorno
  (~850 neuroni in media, ~1.350 nel caso peggiore, tetto 2.500). Il giorno in
  cui il contatore nasce la quota è considerata già consumata. Consumi su
  `/aggiornamenti` e `/api/risorse`. Con il permesso **Account Analytics:
  Read** sul token il contatore si allinea al consumo reale dell'account.
- **Vectorize** (`lib/ai/vectorize.ts`): Workers Paid include 50 M dimensioni
  interrogate e 10 M memorizzate al mese, e le interrogate contano anche i
  vettori memorizzati. Con l'indice oltre quota l'app non interroga né
  aggiunge vettori: Normie usa la ricerca testuale (FTS + estratti +
  reranker).
- `vercel.json` dichiara `"fluid": true`: con Fluid Compute le funzioni lunghe
  (cron e Studio, `maxDuration = 300`) sono ammesse anche sul piano Hobby.
- Verifica: Vercel → Project → Settings → **Cron Jobs** deve mostrare
  `/api/cron/aggiorna-normativa` con schedule `0 5 * * 1`; da lì il pulsante
  **Run** avvia un'esecuzione manuale. Esito su `/aggiornamenti`.

---

## 4-ter. Metadati, argomenti seguiti, archivio R2 e OCR locale (tutto gratuito)

### Metadati del corpus

Anni, tipologie (Circolare, Risoluzione, Decreto...), estremi ("Circolare n. 14
del 9 marzo 2007") e doppioni sono normalizzati in modo deterministico
(`lib/metadati/`, nessun modello AI) nella tabella `documenti_meta`, che
sopravvive alle reimportazioni del corpus. Il cron del lunedì tratta da solo
i documenti nuovi; per rieseguire tutto (idempotente):

```bash
npm run bonifica:metadati
```

```bash
npm run bonifica:metadati -- --applica
```

oppure, in produzione, `GET /api/manutenzione/metadati` (prova a secco) e
`?applica=1` con l'header `Authorization: Bearer <CRON_SECRET>`. Rapporto
dell'esecuzione del 26/11/2026: `docs/bonifica-metadati-2026-11-26.md`.

### Argomenti seguiti

Nessuna configurazione: i pulsanti **Segui** in Ricerca e nello Studio
salvano l'argomento nel browser (localStorage) e in un registro anonimo
(`watchlist_argomenti`). Il cron confronta gli atti nuovi con gli argomenti e
con i dossier in cache: badge «Novità sui tuoi argomenti» nell'header, badge
«Nuova normativa disponibile» sui dossier, elenco su `/aggiornamenti#seguiti`.
Il webhook (`AGGIORNAMENTI_WEBHOOK_URL`) riceve anche `argomenti` e `dossier`.

### Archivio dei PDF su Cloudflare R2 (opzionale)

Il cron copia su R2 ogni PDF importato (e le scansioni in coda OCR): se
l'Agenzia sposta o cancella il file, il documento mostra la «copia
d'archivio». Gratis entro le quote di R2 (10 GB e 1 milione di scritture al
mese, per l'intero account): l'app si ferma a `R2_MAX_GB` (2 GB di default,
mai oltre 5) e a 20.000 scritture al mese. A novembre 2026 l'account occupa
già 2,3 GB (1,46 GB di PDF del corpus e 0,84 GB di altri bucket): se gli altri
progetti crescono, abbassa `R2_MAX_GB` di conseguenza.

1. Cloudflare → **R2** → bucket esistente dei PDF (es. `fonticatastali-docs`),
   oppure **Create bucket** (gratis).
2. R2 → **Manage API tokens** → **Create API token** → permesso
   **Object Read & Write** limitato a quel bucket. Copia *Access Key ID* e
   *Secret Access Key* (non è il token di Workers AI).
3. Vercel → Settings → Environment Variables (Production): `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY` (come **Sensitive**), `R2_BUCKET`, e `R2_URL_PUBBLICO`
   = base pubblica del bucket (la stessa di `NEXT_PUBLIC_DOCS_BASE_URL` se il
   bucket è quello dei PDF). Redeploy.

Senza queste variabili l'archivio resta spento e nulla cambia.

### OCR locale dei PDF scansionati

I PDF senza testo selezionabile non finiscono più tra gli errori: restano in
coda «da OCR» (filtro su `/aggiornamenti`). Nessun OCR a pagamento: quando
vuoi, dal tuo PC:

```bash
brew install tesseract tesseract-lang poppler
```

(Ubuntu: `sudo apt install tesseract-ocr tesseract-ocr-ita poppler-utils`),
poi, con `TURSO_DATABASE_URL` e un `TURSO_AUTH_TOKEN` che può scrivere in
`.env.local`:

```bash
npm run ocr:locale -- --prova
```

```bash
npm run ocr:locale
```

Lo script scarica i PDF (dalla copia su R2 se c'è), estrae il testo con
tesseract (italiano), applica la stessa pertinenza e deduplica del cron e li
importa nel corpus con titolo e metadati normalizzati. Zero neuroni.

---

## 5. Check post-deploy

- Apri l'URL Vercel, cerca "fabbricati rurali" → albero con snippet.
- Clic su un file → PDF dal bucket in nuova scheda.
- Se la ricerca dà errore 500: controlla le env `TURSO_*` su Vercel.
- Se i PDF danno 404: controlla `NEXT_PUBLIC_DOCS_BASE_URL` e i path nel bucket.
