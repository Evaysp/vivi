Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$distRoot = Join-Path $projectRoot 'dist'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$packageName = "remotion-ai-portable-$timestamp"
$stagingRoot = Join-Path $distRoot $packageName
$zipPath = Join-Path $distRoot "$packageName.zip"

$excludedDirectories = @(
  'node_modules',
  'dist',
  '.git'
)

$excludedFiles = @(
  'server.out.log',
  'server.err.log'
)

function Copy-ProjectItem {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath
  )

  Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Recurse -Force
}

Write-Host "Preparing portable package in $distRoot" -ForegroundColor Cyan

if (Test-Path $stagingRoot) {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

Get-ChildItem -LiteralPath $projectRoot -Force | ForEach-Object {
  if ($excludedDirectories -contains $_.Name) {
    return
  }

  if ($excludedFiles -contains $_.Name) {
    return
  }

  if ($_.Name -like '*.zip') {
    return
  }

  $destination = Join-Path $stagingRoot $_.Name
  Copy-ProjectItem -SourcePath $_.FullName -DestinationPath $destination
}

Compress-Archive -Path (Join-Path $stagingRoot '*') -DestinationPath $zipPath -Force

Write-Host ""
Write-Host "Portable package created:" -ForegroundColor Green
Write-Host $zipPath
