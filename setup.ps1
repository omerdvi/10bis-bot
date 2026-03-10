# 10bis-bot Setup Wizard

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host ''
Write-Host '=============================' -ForegroundColor Cyan
Write-Host '   10bis Bot - Setup Wizard  ' -ForegroundColor Cyan
Write-Host '=============================' -ForegroundColor Cyan
Write-Host ''

# Check / install Node.js
$nodeOk = $false
try {
    $nodeVer = & node --version 2>$null
    if ($nodeVer) { $nodeOk = $true; Write-Host "Node.js installed ($nodeVer)" -ForegroundColor Green }
} catch {}

if (-not $nodeOk) {
    Write-Host 'Node.js is not installed.' -ForegroundColor Red
    $install = Read-Host 'Install automatically? (Y/N)'
    if ($install -match '^[Yy]') {
        Write-Host 'Downloading Node.js...' -ForegroundColor Yellow
        $msiUrl  = 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi'
        $msiPath = "$env:TEMP\node-installer.msi"
        try {
            Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
            Write-Host 'Installing Node.js (this may take a minute)...' -ForegroundColor Yellow
            Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /quiet /norestart" -Wait
            $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
            $nodeVer = & node --version 2>$null
            if ($nodeVer) {
                Write-Host "Node.js installed ($nodeVer)" -ForegroundColor Green
            } else {
                Write-Host 'Installation failed. Install manually from https://nodejs.org' -ForegroundColor Red
                pause; exit 1
            }
        } catch {
            Write-Host "Download error: $_" -ForegroundColor Red
            Write-Host 'Install manually from https://nodejs.org' -ForegroundColor Yellow
            pause; exit 1
        }
    } else {
        Write-Host 'Install Node.js from https://nodejs.org and re-run setup.' -ForegroundColor Yellow
        pause; exit 0
    }
}

# npm install + playwright
Write-Host ''
Write-Host 'Installing packages...' -ForegroundColor Yellow
& npm install --silent
if ($LASTEXITCODE -ne 0) { Write-Host 'npm install failed.' -ForegroundColor Red; pause; exit 1 }

Write-Host 'Installing Chromium (Playwright)...' -ForegroundColor Yellow
& npx playwright install chromium
if ($LASTEXITCODE -ne 0) { Write-Host 'playwright install failed.' -ForegroundColor Red; pause; exit 1 }
Write-Host 'Packages installed.' -ForegroundColor Green

# Email
Write-Host ''
$email = ''
while ($true) {
    $email = Read-Host 'Your 10bis email address'
    if ($email -match '^[^\s@]+@[^\s@]+\.[^\s@]+$') { break }
    Write-Host 'Invalid email — try again.' -ForegroundColor Red
}

# Telegram bot token
Write-Host ''
Write-Host 'Create a Telegram bot:' -ForegroundColor Cyan
Write-Host '  1. Open Telegram and search for @BotFather'
Write-Host '  2. Send /newbot'
Write-Host '  3. Choose a name and username (must end with bot)'
Write-Host '  4. Copy the token you receive'
Write-Host ''
$token = ''
while ($true) {
    $token = Read-Host 'Paste your bot token here'
    if ($token -match '^\d+:[A-Za-z0-9_-]{35,}$') { break }
    Write-Host 'Token looks invalid — make sure you copied it correctly.' -ForegroundColor Red
}

# Days
Write-Host ''
Write-Host 'Which days should the loader run?' -ForegroundColor Cyan
Write-Host '  1 - Sunday to Thursday'
Write-Host '  2 - Monday to Friday'
Write-Host '  3 - Sunday to Friday'
$daysMap  = @{ '1' = '0-4'; '2' = '1-5'; '3' = '0-5' }
$daysLabel = @{ '1' = 'Sun-Thu'; '2' = 'Mon-Fri'; '3' = 'Sun-Fri' }
$daysPick = ''
while ($true) {
    $daysPick = Read-Host 'Enter number (1/2/3)'
    if ($daysMap.ContainsKey($daysPick)) { break }
    Write-Host 'Enter 1, 2 or 3 only.' -ForegroundColor Red
}
$scheduleDays = $daysMap[$daysPick]

# Time
Write-Host ''
$scheduleTime = ''
while ($true) {
    $scheduleTime = Read-Host 'At what time? (default: 16:00)'
    if ($scheduleTime -eq '') { $scheduleTime = '16:00' }
    if ($scheduleTime -match '^([01]?\d|2[0-3]):[0-5]\d$') { break }
    Write-Host 'Invalid format — use HH:MM (e.g. 16:00)' -ForegroundColor Red
}

# Write config.json
$config = [ordered]@{
    email            = $email
    telegramBotToken = $token
    telegramChatId   = $null
    scheduleDays     = $scheduleDays
    scheduleTime     = $scheduleTime
} | ConvertTo-Json
Set-Content -Path "$scriptDir\config.json" -Value $config -Encoding UTF8
Write-Host ''
Write-Host 'config.json saved.' -ForegroundColor Green

# Task Scheduler
Write-Host 'Creating Task Scheduler entry...' -ForegroundColor Yellow
$vbsPath  = "$scriptDir\launch.vbs"
$taskName = '10bis Bot'
schtasks /delete /tn $taskName /f 2>$null | Out-Null
schtasks /create /tn $taskName /tr ("wscript.exe `"" + $vbsPath + "`"") /sc ONLOGON /rl HIGHEST /f | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host 'Task Scheduler entry created.' -ForegroundColor Green
} else {
    Write-Host 'Task Scheduler failed — you can start manually with launch.vbs' -ForegroundColor Yellow
}

# Launch
Write-Host ''
Write-Host 'Starting the bot...' -ForegroundColor Yellow
Start-Process wscript.exe -ArgumentList "`"$vbsPath`""

Write-Host ''
Write-Host '=============================' -ForegroundColor Green
Write-Host '         Setup complete!      ' -ForegroundColor Green
Write-Host '=============================' -ForegroundColor Green
Write-Host ''
Write-Host 'Open Telegram and send /start to your bot to register.' -ForegroundColor Cyan
Write-Host 'Then send /balance to verify and /help for all commands.' -ForegroundColor Cyan
Write-Host ''
pause
