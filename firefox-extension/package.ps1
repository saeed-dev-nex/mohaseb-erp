$ErrorActionPreference = 'Stop'

$extensionRoot = $PSScriptRoot
$releaseDirectory = Join-Path $extensionRoot 'release'
$manifestPath = Join-Path $extensionRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($manifest.version)) {
    throw 'manifest.json does not contain a valid version.'
}

$archivePath = Join-Path $releaseDirectory "mohaseb-pro-firefox-$($manifest.version).zip"
$packageFiles = @(
    'manifest.json',
    'background.js',
    'popup.html',
    'popup.js',
    'styles.css',
    'icons'
)

foreach ($file in $packageFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $extensionRoot $file))) {
        throw "Required extension package file is missing: $file"
    }
}

New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archiveStream = $null
$archive = $null
try {
    $archiveStream = [System.IO.File]::Open(
        $archivePath,
        [System.IO.FileMode]::Create,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
    $archive = [System.IO.Compression.ZipArchive]::new(
        $archiveStream,
        [System.IO.Compression.ZipArchiveMode]::Create
    )

    foreach ($packageFile in $packageFiles) {
        $sourcePath = Join-Path $extensionRoot $packageFile
        $sourceFiles = if (Test-Path -LiteralPath $sourcePath -PathType Container) {
            Get-ChildItem -LiteralPath $sourcePath -File -Recurse
        } else {
            Get-Item -LiteralPath $sourcePath
        }

        foreach ($sourceFile in $sourceFiles) {
            $entryName = $sourceFile.FullName.Substring($extensionRoot.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                $sourceFile.FullName,
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    }
} finally {
    if ($null -ne $archive) {
        $archive.Dispose()
    }
    if ($null -ne $archiveStream) {
        $archiveStream.Dispose()
    }
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $entryNames = @($archive.Entries | ForEach-Object { $_.FullName -replace '\\', '/' })
    if ($entryNames -notcontains 'manifest.json') {
        throw 'The generated ZIP must contain manifest.json at its root.'
    }

    foreach ($requiredEntry in @('background.js', 'popup.html', 'popup.js', 'styles.css')) {
        if ($entryNames -notcontains $requiredEntry) {
            throw "The generated ZIP is missing a required file: $requiredEntry"
        }
    }

    foreach ($icon in $manifest.icons.PSObject.Properties.Value) {
        if ($entryNames -notcontains $icon) {
            throw "The generated ZIP is missing a manifest icon: $icon"
        }
    }
} finally {
    $archive.Dispose()
}

Write-Output "AMO upload package created: $archivePath"
