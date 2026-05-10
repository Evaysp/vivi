Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = Split-Path -Parent $PSScriptRoot
$projectName = Split-Path -Leaf $projectRoot
$backupRoot = Join-Path $projectRoot 'backups'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $backupRoot "$projectName-full-backup-$timestamp.zip"

function Write-Step {
  param([string]$Message)

  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-RelativeArchivePath {
  param(
    [Parameter(Mandatory = $true)][string]$BasePath,
    [Parameter(Mandatory = $true)][string]$TargetPath
  )

  $resolvedBasePath = (Resolve-Path -LiteralPath $BasePath).Path.TrimEnd('\') + '\'
  $resolvedTargetPath = (Resolve-Path -LiteralPath $TargetPath).Path
  $baseUri = [System.Uri]$resolvedBasePath
  $targetUri = [System.Uri]$resolvedTargetPath

  return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()) -replace '/', '\'
}

function Add-FileToArchive {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$BasePath,
    [Parameter(Mandatory = $true)][System.IO.Compression.ZipArchive]$Archive
  )

  $relativePath = Get-RelativeArchivePath -BasePath $BasePath -TargetPath $FilePath
  $entryName = $relativePath -replace '\\', '/'
  $entry = $Archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
  $entry.LastWriteTime = [System.IO.File]::GetLastWriteTime($FilePath)

  $inputStream = [System.IO.File]::Open(
    $FilePath,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
  )

  try {
    $outputStream = $entry.Open()

    try {
      $inputStream.CopyTo($outputStream)
    }
    finally {
      $outputStream.Dispose()
    }
  }
  finally {
    $inputStream.Dispose()
  }
}

function Add-DirectoryToArchive {
  param(
    [Parameter(Mandatory = $true)][string]$DirectoryPath,
    [Parameter(Mandatory = $true)][string]$BasePath,
    [Parameter(Mandatory = $true)][System.IO.Compression.ZipArchive]$Archive
  )

  $children = Get-ChildItem -LiteralPath $DirectoryPath -Force | Sort-Object Name
  if (-not $children) {
    $relativePath = Get-RelativeArchivePath -BasePath $BasePath -TargetPath $DirectoryPath
    $entryName = ($relativePath -replace '\\', '/').TrimEnd('/') + '/'
    $entry = $Archive.CreateEntry($entryName)
    $entry.LastWriteTime = [System.IO.Directory]::GetLastWriteTime($DirectoryPath)
    return
  }

  foreach ($child in $children) {
    if ($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      continue
    }

    if ($child.PSIsContainer) {
      Add-DirectoryToArchive -DirectoryPath $child.FullName -BasePath $BasePath -Archive $Archive
      continue
    }

    Add-FileToArchive -FilePath $child.FullName -BasePath $BasePath -Archive $Archive
  }
}

Write-Step "Preparing backup folder"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

$itemsToArchive = Get-ChildItem -LiteralPath $projectRoot -Force |
  Where-Object { $_.Name -ne 'backups' } |
  Sort-Object Name

if (-not $itemsToArchive) {
  throw "No project files were found to back up."
}

Write-Step "Creating full project backup"
if (Test-Path -LiteralPath $backupPath) {
  Remove-Item -LiteralPath $backupPath -Force
}

$zipFileStream = [System.IO.File]::Open($backupPath, [System.IO.FileMode]::CreateNew)

try {
  $zipArchive = [System.IO.Compression.ZipArchive]::new($zipFileStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)

  try {
    foreach ($item in $itemsToArchive) {
      if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        continue
      }

      if ($item.PSIsContainer) {
        Add-DirectoryToArchive -DirectoryPath $item.FullName -BasePath $projectRoot -Archive $zipArchive
        continue
      }

      Add-FileToArchive -FilePath $item.FullName -BasePath $projectRoot -Archive $zipArchive
    }
  }
  finally {
    $zipArchive.Dispose()
  }
}
finally {
  $zipFileStream.Dispose()
}

Write-Step "Backup created successfully"
Write-Host $backupPath -ForegroundColor Green
