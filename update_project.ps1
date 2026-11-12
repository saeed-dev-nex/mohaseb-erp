param([switch]$SkipBuild, [switch]$Force)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot

function Invoke-Git([string[]]$Arguments) {
    & git -C $projectRoot @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Git command failed: git $($Arguments -join ' ')" }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Output '[INFO] Automatic update skipped: Git is not installed. Starting with the local version.'
    exit 0
}
$gitRoot = & git -C $projectRoot rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($gitRoot | Out-String).Trim())) {
    Write-Output '[INFO] Automatic update skipped: this folder is not a Git checkout (release/archive installs cannot self-update). Starting with the local version.'
    exit 0
}
$gitRootPath = (Resolve-Path -LiteralPath ($gitRoot | Out-String).Trim()).Path
$projectRootPath = (Resolve-Path -LiteralPath $projectRoot).Path
if (-not [string]::Equals($gitRootPath.TrimEnd('\\'), $projectRootPath.TrimEnd('\\'), [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Output '[INFO] Automatic update skipped: run this script from the Git repository root. Starting with the local version.'
    exit 0
}
$changes = & git -C $projectRoot status --porcelain
if ($LASTEXITCODE -ne 0) { throw 'Could not read the Git working tree.' }
if ($changes) {
    Write-Warning 'Uncommitted local changes were found. Update stopped to avoid overwriting them.'
    Write-Output $changes
    exit 2
}

# Updates are approved inside the app by the superuser (Settings ->
# Updates). A launcher start without the approval flag must NOT pull
# new code: it starts the version that is already installed. The flag
# is written by the backend when the superuser approves an update, or
# the apply helper passes -Force after that same approval.
$approvalFlag = Join-Path $projectRoot 'update-approved.flag'
if (-not $Force -and -not (Test-Path -LiteralPath $approvalFlag -PathType Leaf)) {
    Write-Output '[INFO] No approved update pending. Starting the current version.'
    exit 0
}

Invoke-Git @('fetch', 'origin')
$branch = (& git -C $projectRoot branch --show-current).Trim()
if ([string]::IsNullOrWhiteSpace($branch)) { throw 'The current Git branch could not be determined.' }
$remoteBranch = "origin/$branch"
& git -C $projectRoot rev-parse --verify $remoteBranch 2>$null
if ($LASTEXITCODE -ne 0) { throw "Remote branch $remoteBranch was not found." }

$counts = (& git -C $projectRoot rev-list --left-right --count "HEAD...$remoteBranch").Trim().Split([char[]]" `t", [System.StringSplitOptions]::RemoveEmptyEntries)
$ahead = [int]$counts[0]
$behind = [int]$counts[1]
if ($behind -eq 0) {
    Write-Output 'This system is already synchronized with GitHub.'
    if (Test-Path -LiteralPath $approvalFlag -PathType Leaf) { Remove-Item -LiteralPath $approvalFlag -Force }
    exit 0
}
if ($ahead -gt 0) {
    Write-Output 'The local branch has commits; merging the GitHub update safely.'
    Invoke-Git @('merge', '--no-edit', $remoteBranch)
} else {
    Invoke-Git @('merge', '--ff-only', $remoteBranch)
}
Write-Output 'Project code updated from GitHub.'

if (-not $SkipBuild) {
    $backendSetup = Join-Path $projectRoot 'backend\first_run_setup.bat'
    if (-not (Test-Path -LiteralPath $backendSetup -PathType Leaf)) { throw 'backend\\first_run_setup.bat was not found.' }
    & $backendSetup
    if ($LASTEXITCODE -ne 0) { throw 'Backend setup or database migrations failed.' }
    Push-Location (Join-Path $projectRoot 'frontend')
    try {
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend production build failed.' }
    } finally {
        Pop-Location
    }
    Write-Output 'Dependencies, migrations, and the production build are ready.'
}

# The approved update is fully applied; consume the approval flag so
# later starts do not re-apply it. (On failure above, the script has
# already thrown and the flag stays for the next start to retry.)
if (Test-Path -LiteralPath $approvalFlag -PathType Leaf) { Remove-Item -LiteralPath $approvalFlag -Force }
