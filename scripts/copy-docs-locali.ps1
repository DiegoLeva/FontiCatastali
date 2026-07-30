# =============================================================================
# Copia i file rinominati (Database_Normalizzato) in public/docs per il dev
# locale, cosi' NEXT_PUBLIC_DOCS_BASE_URL="/docs" serve i PDF staticamente.
# In PRODUZIONE usa invece un bucket (R2 / Vercel Blob) — vedi README.
#
# Uso (dalla cartella fonticatastali):
#   powershell -ExecutionPolicy Bypass -File scripts/copy-docs-locali.ps1
# =============================================================================

$ErrorActionPreference = "Stop"

$src = Resolve-Path "..\Database_Normalizzato"
$dst = Join-Path $PSScriptRoot "..\public\docs"

if (-not (Test-Path $src)) {
    Write-Error "Sorgente non trovata: $src"
}

New-Item -ItemType Directory -Force -Path $dst | Out-Null

# Copia solo i file dei documenti (esclude CSV/DB).
Get-ChildItem $src -Directory | ForEach-Object {
    $target = Join-Path $dst $_.Name
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item "$($_.FullName)\*" $target -Include *.pdf, *.docx, *.xlsx -Force
    Write-Host ("Copiata cartella: {0}" -f $_.Name)
}

$count = (Get-ChildItem $dst -Recurse -File).Count
Write-Host "`nFatto. $count file in public/docs" -ForegroundColor Green
