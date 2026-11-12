param()

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path -Path $PSScriptRoot -ChildPath 'run_network.bat'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw "run_network.bat was not found beside this installer: $scriptPath"
}

$startupFolder = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
if ([string]::IsNullOrWhiteSpace($startupFolder)) {
    throw 'Could not locate the current user Startup folder.'
}

$shortcutPath = Join-Path -Path $startupFolder -ChildPath 'Mohaseb Network Server.lnk'
$commandProcessor = $env:ComSpec
if ([string]::IsNullOrWhiteSpace($commandProcessor)) {
    $commandProcessor = Join-Path -Path $env:SystemRoot -ChildPath 'System32\cmd.exe'
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $commandProcessor
$shortcut.Arguments = '/c ""{0}""' -f $scriptPath
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = 'Start the Mohaseb network server when you sign in to Windows.'
$shortcut.WindowStyle = 7
$shortcut.Save()

Write-Output "Startup shortcut created: $shortcutPath"
Write-Output 'run_network.bat will run when this Windows user signs in.'
