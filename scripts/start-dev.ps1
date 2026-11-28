$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Read-EnvValue([string]$key) {
  if (-not (Test-Path ".env")) { return $null }
  $pattern = "^\s*" + [regex]::Escape($key) + "\s*="
  $line = Get-Content ".env" -ErrorAction SilentlyContinue |
    Where-Object { $_ -match $pattern } |
    Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace $pattern, "").Trim().Trim([char]34).Trim([char]39)
}

function Get-Port([string]$value, [int]$fallback) {
  if (-not $value) { return $fallback }
  try {
    $uri = [uri]$value
    if ($uri.Port -gt 0 -and $uri.Port -ne 80 -and $uri.Port -ne 443) { return $uri.Port }
  } catch {}
  return $fallback
}

function Test-Url([string]$url) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200
  } catch {
    return $false
  }
}

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "[Choke!] pnpm was not found."
  Write-Host "Install Node.js and pnpm first, then run this file again."
  exit 1
}

if (-not (Test-Path "node_modules")) {
  Write-Host "[Choke!] Installing dependencies..."
  & pnpm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[Choke!] pnpm install failed."
    exit 1
  }
}

if (-not (Test-Path ".env")) {
  Write-Host "[Choke!] WARNING: .env not found."
  Write-Host "[Choke!] Copy .env.example to .env and fill OSU_CLIENT_SECRET / SESSION_SECRET,"
  Write-Host "[Choke!] otherwise osu! login will fail."
  Write-Host "[Choke!] WEB_BASE_URL will fall back to http://localhost:5207."
  Write-Host ""
} else {
  $osuId = Read-EnvValue "OSU_CLIENT_ID"
  $osuSecret = Read-EnvValue "OSU_CLIENT_SECRET"
  if (-not $osuId -or -not $osuSecret) {
    Write-Host "[Choke!] NOTE: OSU_CLIENT_ID or OSU_CLIENT_SECRET is empty in .env."
    Write-Host "[Choke!] osu! OAuth login will not work (guest/email login still works)."
    Write-Host ""
  }
}

$dbPort = Get-Port (Read-EnvValue "DATABASE_URL") 55432
if (-not (Test-Port $dbPort) -and (Test-Path "$PSScriptRoot\postgres.ps1")) {
  Write-Host "[Choke!] PostgreSQL is not listening on port $dbPort. Starting via scripts/postgres.ps1..."
  & "$PSScriptRoot\postgres.ps1" start
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[Choke!] Failed to start PostgreSQL."
    exit 1
  }
}

# Read ports from .env so the web server and the osu! redirect stay in sync.
$webBase = Read-EnvValue "WEB_BASE_URL"
$apiBase = Read-EnvValue "API_BASE_URL"
$webPort = Get-Port $webBase 5207
$apiPort = Get-Port $apiBase 3100
if (-not $apiBase) {
  $portValue = Read-EnvValue "PORT"
  if ($portValue -match "^\d+$") { $apiPort = [int]$portValue }
}

$apiUrl = "http://localhost:$apiPort"
$webUrl = "http://localhost:$webPort"

Write-Host "[Choke!] API : $apiUrl/health"
Write-Host "[Choke!] Web : $webUrl/"

if (-not (Test-Url "$apiUrl/health")) {
  if (Test-Port $apiPort) {
    Write-Host "[Choke!] Port $apiPort is occupied but /health is not responding."
    Write-Host "[Choke!] Stop the process using that port first."
    exit 1
  }
  Write-Host "[Choke!] Starting API in a new window..."
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "pnpm dev:api" -WorkingDirectory $root
} else {
  Write-Host "[Choke!] API is already running."
}

if (-not (Test-Url "$webUrl/")) {
  if (-not (Test-Port $webPort)) {
    Write-Host "[Choke!] Starting web in a new window..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "pnpm exec vite --host localhost" -WorkingDirectory $root
  } else {
    Write-Host "[Choke!] Port $webPort is occupied; web may already be running."
  }
} else {
  Write-Host "[Choke!] Web is already running."
}

Write-Host "[Choke!] Waiting for the web server..."
$deadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $deadline) {
  if (Test-Url "$webUrl/") {
    Start-Process $webUrl
    break
  }
  Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "[Choke!] API : $apiUrl/health"
Write-Host "[Choke!] Web : $webUrl/"
Write-Host "[Choke!] Close the API and Web windows to stop."
Write-Host ""
Start-Sleep -Seconds 2
