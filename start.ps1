# RESQORA - start everything: database, backend, tunnel, app.
#
#   .\start.ps1          start it all
#   .\start.ps1 -Stop    stop it all
#   .\start.ps1 -NoTunnel   skip ngrok (same-WiFi testing only)
#
# The database needs no separate process - it is a SQLite file the backend
# opens on boot (server/database.db).

param(
    [switch]$Stop,
    [switch]$Tunnel,      # also expose the backend publicly through ngrok
    [switch]$ExpoTunnel   # serve the JS bundle over a tunnel too (Expo Go off-WiFi)
)

$ErrorActionPreference = 'Continue'
$Root      = $PSScriptRoot
$ServerDir = Join-Path $Root 'server'
$AppDir    = Join-Path $Root 'app'
$Port      = 3000
$MetroPort = 8081

function Write-Step($n, $text) { Write-Host "[$n] $text" -ForegroundColor Yellow }
function Write-Ok($text)       { Write-Host "    $text" -ForegroundColor Green }
function Write-Warn($text)     { Write-Host "    $text" -ForegroundColor Red }
function Write-Info($text)     { Write-Host "    $text" -ForegroundColor Gray }

# Kills whatever owns a port, leaving unrelated node processes alone.
function Stop-Port($port) {
    $lines = netstat -ano | Select-String ":$port\s.*LISTENING"
    foreach ($line in $lines) {
        $procId = ($line -split '\s+')[-1]
        if ($procId -match '^\d+$' -and $procId -ne '0' -and $procId -ne $PID) {
            try { Stop-Process -Id $procId -Force -ErrorAction Stop } catch {}
        }
    }
}

function Stop-All {
    # The supervisor would restart node, so close its window first.
    Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'RESQORA' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    Stop-Port $Port
    Stop-Port $MetroPort
    Stop-Port 4040
    Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Wait-For($url, $seconds = 25) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-RestMethod -Uri $url -TimeoutSec 3 -ErrorAction Stop
            return $r
        } catch { Start-Sleep -Milliseconds 500 }
    }
    return $null
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "              R E S Q O R A             " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($Stop) {
    Write-Step 1 "Stopping backend, tunnel and app..."
    Stop-All
    Write-Ok "All stopped."
    Write-Host ""
    exit 0
}

# --- 1. Clear old processes
Write-Step 1 "Clearing ports $Port / $MetroPort..."
Stop-All
Start-Sleep -Seconds 1
Write-Ok "Ports free."

# --- 2. Dependencies
Write-Step 2 "Checking dependencies..."
if (-not (Test-Path (Join-Path $ServerDir 'node_modules'))) {
    Write-Info "Installing backend packages (first run only)..."
    Push-Location $ServerDir; npm install --silent; Pop-Location
}
if (-not (Test-Path (Join-Path $AppDir 'node_modules'))) {
    Write-Info "Installing app packages (first run only)..."
    Push-Location $AppDir; npm install --silent; Pop-Location
}
Write-Ok "Dependencies present."

# --- 3. Network address
Write-Step 3 "Finding this machine's address on the WiFi..."
$netConfig = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } |
    Select-Object -First 1
$LanIp = $netConfig.IPv4Address.IPAddress

if (-not $LanIp) {
    Write-Warn "No active network adapter found. Connect to WiFi and run this again."
    exit 1
}

$LanUrl  = "http://" + $LanIp + ":3000"
$appJson = Join-Path $AppDir 'app.json'
$appCfg  = Get-Content $appJson -Raw | ConvertFrom-Json

if ($appCfg.expo.extra.serverUrl -ne $LanUrl) {
    # The address changes with the network, so keep the app pointed at it.
    $appCfg.expo.extra.serverUrl = $LanUrl
    $json = $appCfg | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($appJson, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "Updated the app to use $LanUrl"
} else {
    Write-Ok "App already points at $LanUrl"
}
Write-Info "Phones must be on this same WiFi."

# --- 4. Firewall
Write-Step 4 "Checking firewall rule for port $Port..."
$rule = Get-NetFirewallRule -DisplayName "RESQORA Backend Port $Port" -ErrorAction SilentlyContinue
if (-not $rule) {
    try {
        New-NetFirewallRule -DisplayName "RESQORA Backend Port $Port" -Direction Inbound `
            -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
        Write-Ok "Firewall rule added."
    } catch {
        Write-Warn "Could not add the rule. Run this script as Administrator once to fix it."
    }
} else {
    Write-Ok "Firewall rule already there."
}

# --- 5. Backend + database
Write-Step 5 "Starting backend and database..."
# Supervised: if node ever exits, it is restarted three seconds later. A dead
# backend is invisible from the outside - ngrok keeps answering, and hangs.
$backendCmd = '/k title RESQORA backend & cd /d "' + $ServerDir + '" & for /l %i in (0,0,1) do @(node index.js & echo. & echo [supervisor] backend stopped - restarting in 3s & timeout /t 3 /nobreak >nul)'
Start-Process -FilePath 'cmd.exe' -ArgumentList $backendCmd -WorkingDirectory $ServerDir

$health = Wait-For "http://localhost:$Port/" 25
if ($health) {
    Write-Ok "Backend live on http://localhost:$Port"
    $db = Join-Path $ServerDir 'database.db'
    if (Test-Path $db) {
        $size = [math]::Round((Get-Item $db).Length / 1KB, 1)
        Write-Info "Database: server\database.db ($size KB) - $($health.activeSOS) active SOS"
    } else {
        Write-Info "Database: created fresh on first write."
    }
} else {
    Write-Warn "Backend did not answer. Check the 'RESQORA backend' window for the error."
    Write-Host ""
    exit 1
}

# --- 6. Tunnel (optional)
$publicUrl = $null
if (-not $Tunnel) {
    Write-Step 6 "Same-WiFi mode. Pass -Tunnel to also expose the backend publicly."
} else {
    Write-Step 6 "Starting ngrok tunnel..."
    if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
        Write-Warn "ngrok is not installed. Same-WiFi mode does not need it."
    } else {
        $ngrokArgs = 'http --domain=unshirred-sherley-untorporific.ngrok-free.dev ' + $Port
        Start-Process -FilePath 'ngrok' -ArgumentList $ngrokArgs -WindowStyle Hidden

        $tunnels = Wait-For "http://localhost:4040/api/tunnels" 20
        if ($tunnels -and $tunnels.tunnels.Count -gt 0) {
            $publicUrl = $tunnels.tunnels[0].public_url
            Write-Ok "Tunnel live: $publicUrl"

            Write-Info "Public URL is up. The app itself still uses $LanUrl."
            Write-Info "To switch the app to it, set expo.extra.serverUrl in app/app.json."
        } else {
            Write-Warn "Could not confirm the tunnel. Check ngrok manually (http://localhost:4040)."
        }
    }
}

# --- 7. App
Write-Step 7 "Starting the Expo app..."
if ($ExpoTunnel) { Write-Info "Tunnel mode: Expo Go works on mobile data too (slower to start)." }
else { Write-Info "Expo Go: scan the QR from a phone on this same WiFi." }
$expoArgs = if ($ExpoTunnel) { 'npx expo start --tunnel' } else { 'npx expo start' }
$appCmd = '/k title RESQORA app & cd /d "' + $AppDir + '" & ' + $expoArgs
Start-Process -FilePath 'cmd.exe' -ArgumentList $appCmd -WorkingDirectory $AppDir

$metro = Wait-For "http://localhost:$MetroPort/status" 60
if ($metro -ne $null) {
    Write-Ok "Metro bundler live on http://localhost:$MetroPort"
} else {
    Write-Info "Metro is still starting - watch the 'RESQORA app' window for the QR code."
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RUNNING                               " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Database   server\database.db (SQLite, in the backend process)"
Write-Host "  Backend    $LanUrl   (this is what phones use)"
Write-Host "  Local      http://localhost:$Port"
if ($publicUrl) { Write-Host "  Tunnel     $publicUrl" }
Write-Host "  App        scan the QR code in the 'RESQORA app' window"
Write-Host ""
Write-Host "  Same-WiFi mode: every phone must be on this network." -ForegroundColor Gray
Write-Host "  The installed APK points at the old address - rebuild it to use this one." -ForegroundColor Gray
Write-Host ""
Write-Host "  Stop everything with:  .\start.ps1 -Stop" -ForegroundColor Gray
Write-Host ""
