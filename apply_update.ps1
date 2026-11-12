# Mohaseb Pro - in-app update applier.
#
# Spawned detached by the backend when the superuser approves an
# update inside the app (Settings -> Updates). It gives the HTTP
# response a few seconds to reach the browser, stops the running
# server processes of this install, runs the updater in forced mode
# (the approval already happened), and relaunches the app.
# Everything is logged to logs\update-apply.log.

param([Parameter(Mandatory = $true)][string]$RepoRoot)

$ErrorActionPreference = 'Continue'

$logDir = Join-Path $RepoRoot 'logs'
if (-not (Test-Path -LiteralPath $logDir -PathType Container)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}
$logFile = Join-Path $logDir 'update-apply.log'

function Write-Log([string]$Message) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

Write-Log 'Approved update application started.'
Start-Sleep -Seconds 4

# Stop this install's server processes: python hosts whose command
# line points at this repo and runs the app (daphne / ASGI / the
# production server script). This helper's own command line matches
# none of those markers, so it cannot stop itself.
$repoPattern = [regex]::Escape($RepoRoot)
$targets = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and
    ($_.CommandLine -match $repoPattern) -and
    ($_.CommandLine -match 'daphne|core\.asgi|run_production_server|runserver')
}
foreach ($proc in $targets) {
    Write-Log ('Stopping server process PID ' + $proc.ProcessId)
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

$updater = Join-Path $RepoRoot 'update_project.ps1'
Write-Log 'Running the updater (forced, already approved in-app).'
& powershell -NoProfile -ExecutionPolicy Bypass -File $updater -Force *>> $logFile
Write-Log ('Updater exit code: ' + $LASTEXITCODE)

$launcher = Join-Path $RepoRoot 'run_production.bat'
if (Test-Path -LiteralPath $launcher -PathType Leaf) {
    Write-Log 'Relaunching the app.'
    Start-Process -FilePath $launcher -WorkingDirectory $RepoRoot
} else {
    Write-Log 'run_production.bat not found; start the app manually.'
}
Write-Log 'Approved update application finished.'
