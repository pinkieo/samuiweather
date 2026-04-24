# Run Sammi SQL against your live Supabase Postgres (reads .env + .env.local, never prints password).
# Requires: SUPABASE_DB_URL in .env and/or .env.local, and `psql` on PATH.
# Load order: .env then .env.local (same as Next — later file overrides).
#
# Usage (from project root):
#   .\scripts\run-sammi-sql.ps1
#   .\scripts\run-sammi-sql.ps1 -SqlFile ".\PASTE_VIEWS_ONLY_sammi.sql"
#
param(
  [string]$SqlFile = "PASTE_IN_SUPABASE_sammi.sql"
)

$ErrorActionPreference = "Stop"
# scripts\ is one level below repo root
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envFile = Join-Path $root ".env"
$envLocal = Join-Path $root ".env.local"
$sqlPath = Join-Path $root $SqlFile

if (-not (Test-Path $envFile) -and -not (Test-Path $envLocal)) {
  Write-Error "Missing .env and .env.local in $root - copy .env.example and set SUPABASE_DB_URL."
}
if (-not (Test-Path $sqlPath)) {
  Write-Error "SQL file not found: $sqlPath"
}

function Import-DotEnvFile([string]$path) {
  if (-not (Test-Path $path)) { return }
  Get-Content $path -Encoding UTF8 | ForEach-Object {
    $line = $_
    if ($line -match '^\s*#' -or $line -match '^\s*$') { return }
    if ($line -match '^(?:\s*export\s+)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $key, $val = $matches[1], $matches[2].Trim()
      $val = $val -replace '^\s*\"|\"\s*$', ''
      [Environment]::SetEnvironmentVariable($key, $val, "Process")
    }
  }
}

Import-DotEnvFile $envFile
Import-DotEnvFile $envLocal

$dbUrl = $env:SUPABASE_DB_URL
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  Write-Error "Set SUPABASE_DB_URL in $envFile and/or $envLocal (Session pooler or db.*.supabase.co URI from Dashboard > Database)."
}

# Direct db.<project>.supabase.co: often IPv6-only in DNS; psql on Windows may fail (could not translate host name).
# Fix: Connect -> Session pooler + URI: host is *pooler*.supabase.com, user is postgres.<projectref>; keep port as shown (session is often 5432 on the pooler host).
if ($dbUrl -match 'postgresql://[^/]*@db\.[a-z0-9-]+\.supabase\.co(:\d+)?/') {
  Write-Host ""
  Write-Host "WARNING: SUPABASE_DB_URL points at the direct db. host (IPv6 on many projects)." -ForegroundColor Yellow
  Write-Host "  Fix: use Session pooler URI from Supabase: Connect -> Connection string -> method Session pooler, Type URI," -ForegroundColor Yellow
  Write-Host "  or: https://supabase.com/dashboard/project/YOUR_REF?showConnect=true&method=session" -ForegroundColor Yellow
  Write-Host "  Replace the whole SUPABASE_DB_URL line; do not keep db.... with a different port." -ForegroundColor Yellow
  Write-Host ""
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
  Write-Error "psql not on PATH. Install: winget install PostgreSQL.PostgreSQL.16 -e --accept-source-agreements --accept-package-agreements (or install PostgreSQL and add psql to PATH), then reopen terminal."
}

Write-Host "Running: $sqlPath" -ForegroundColor Cyan
# psql: connection string in env to avoid history echo (PG* not ideal with URI, pass as single arg)
$psqlOut = & psql -v "ON_ERROR_STOP=1" --single-transaction -f $sqlPath $dbUrl 2>&1
$psqlCode = $LASTEXITCODE
$psqlText = "$psqlOut"
$psqlOut | ForEach-Object { Write-Output $_ }
if ($psqlCode -ne 0) {
  if ($psqlText -match 'Tenant or user not found|tenant.*not found' -or $psqlText -match 'ENOTFOUND') {
    Write-Host ""
    $ref = "tftkciljzqbiozqfdziv"
    $su = $env:SUPABASE_URL
    if ($su -and $su -match 'https?://([a-z0-9]+)\.supabase\.co') { $ref = $matches[1] }
    $hint = "https://supabase.com/dashboard/project/${ref}?showConnect=true&method=session"
    Write-Host "Pooler URL must match your project region. Replace SUPABASE_DB_URL with Connect -> Session pooler -> URI" -ForegroundColor Yellow
    Write-Host "or open: $hint" -ForegroundColor Cyan
    Write-Host "Dashboard -> General -> Region must match the aws-0-*-pooler host." -ForegroundColor Yellow
  }
  exit $psqlCode
}
Write-Host "OK." -ForegroundColor Green
