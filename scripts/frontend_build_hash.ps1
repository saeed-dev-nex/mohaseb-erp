param(
    [Parameter(Mandatory = $true)]
    [string]$FrontendPath
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $FrontendPath).Path
$files = @()

foreach ($directory in @('src', 'public', 'build', '..\fonts')) {
    $path = Join-Path $root $directory
    if (Test-Path -LiteralPath $path) {
        $files += Get-ChildItem -LiteralPath $path -File -Recurse
    }
}

foreach ($name in @('index.html', 'package.json', 'package-lock.json', 'vite.config.js', 'postcss.config.js', 'tailwind.config.js', '..\VERSION')) {
    $path = Join-Path $root $name
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $files += Get-Item -LiteralPath $path
    }
}

$sha256 = [Security.Cryptography.SHA256]::Create()
$baseUri = [Uri]($root + [IO.Path]::DirectorySeparatorChar)
try {
    $parts = foreach ($file in ($files | Sort-Object FullName -Unique)) {
        $relativePath = [Uri]::UnescapeDataString($baseUri.MakeRelativeUri([Uri]$file.FullName).ToString())
        $fileHash = [BitConverter]::ToString($sha256.ComputeHash([IO.File]::ReadAllBytes($file.FullName))).Replace('-', '')
        "$relativePath`:$fileHash"
    }

    $content = [Text.Encoding]::UTF8.GetBytes([string]::Join("`n", $parts))
    $hash = [BitConverter]::ToString($sha256.ComputeHash($content)).Replace('-', '')
    Write-Output $hash
}
finally {
    $sha256.Dispose()
}
