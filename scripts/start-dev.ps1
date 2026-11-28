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
    $fastUrl = $url -replace "://localhost:", "://127.0.0.1:"
    $req = [System.Net.WebRequest]::Create($fastUrl)
    $req.Method = "GET"
    $req.Proxy = $null
    $req.Timeout = 1000
    $resp = $req.GetResponse()
    $code = [int]([System.Net.HttpWebResponse]$resp).StatusCode
    $resp.Close()
    return $code -ge 200
  } catch {
    return $false
  }
}

function Test-Port([int]$port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect("127.0.0.1", $port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(200, $false)
    if ($ok) { $client.EndConnect($iar) }
    $client.Close()
    return $ok
  } catch {
    return $false
  }
}

Write-Host "[1/4] 检查运行环境与依赖..."

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
Write-Host "[2/4] 检查数据库 PostgreSQL (127.0.0.1:$dbPort)..."
if (-not (Test-Port $dbPort) -and (Test-Path "$PSScriptRoot\postgres.ps1")) {
  Write-Host "[2/4] 正在拉起 PostgreSQL（若上次直接关窗，会先做几秒日志恢复，请勿关闭）..."
  & "$PSScriptRoot\postgres.ps1" start
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[Choke!] Failed to start PostgreSQL."
    exit 1
  }
}
Write-Host "[2/4] PostgreSQL 已就绪。"

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

if (-not (Test-Url "$apiUrl/health")) {
  if (Test-Port $apiPort) {
    Write-Host "[Choke!] Port $apiPort is occupied but /health is not responding."
    Write-Host "[Choke!] Stop the process using that port first."
    exit 1
  }
  Write-Host "[3/4] 正在新窗口启动后端 API ($apiUrl/health)..."
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "pnpm dev:api" -WorkingDirectory $root
  $apiStart = Get-Date
  $apiDeadline = $apiStart.AddSeconds(90)
  while ((Get-Date) -lt $apiDeadline) {
    if (Test-Url "$apiUrl/health") { break }
    $elapsed = [int]((Get-Date) - $apiStart).TotalSeconds
    Write-Host -NoNewline ("`r[3/4] 等待后端 API 加载内容并监听端口... ({0}s)" -f $elapsed)
    Start-Sleep -Milliseconds 400
  }
  Write-Host ""
  if (Test-Url "$apiUrl/health") {
    Write-Host "[3/4] 后端 API 已就绪。"
  } else {
    Write-Host "[3/4] 后端 API 仍在启动中（请看 API 窗口日志），继续启动前端..."
  }
} else {
  Write-Host "[3/4] 后端 API 已在运行 ($apiUrl/health)。"
}

if (-not (Test-Url "$webUrl/")) {
  if (-not (Test-Port $webPort)) {
    Write-Host "[4/4] 正在新窗口启动前端 Web ($webUrl/)..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "pnpm exec vite --host localhost" -WorkingDirectory $root
  } else {
    Write-Host "[4/4] 端口 $webPort 已被占用，等待前端响应..."
  }
  $webStart = Get-Date
  $deadline = $webStart.AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    if (Test-Url "$webUrl/") {
      Write-Host ""
      Write-Host "[4/4] 前端 Web 已就绪，正在打开浏览器..."
      Start-Process $webUrl
      break
    }
    $elapsed = [int]((Get-Date) - $webStart).TotalSeconds
    Write-Host -NoNewline ("`r[4/4] 等待前端 Vite 编译就绪... ({0}s)" -f $elapsed)
    Start-Sleep -Milliseconds 400
  }
} else {
  Write-Host "[4/4] 前端 Web 已在运行 ($webUrl/)，正在打开浏览器..."
  Start-Process $webUrl
}

Write-Host ""
Write-Host "[Choke!] API : $apiUrl/health"
Write-Host "[Choke!] Web : $webUrl/"
Write-Host "[Choke!] Close the API and Web windows to stop."
Write-Host ""
Start-Sleep -Seconds 2
