Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectName = Split-Path -Leaf $projectRoot
$distRoot = Join-Path $projectRoot 'dist'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$packageName = "$projectName-code-with-templates-$timestamp"
$stagingRoot = Join-Path $distRoot $packageName
$zipPath = Join-Path $distRoot "$packageName.zip"

$includeDirectories = @(
  'downloads',
  'pages',
  'scripts',
  'src',
  'styles',
  'public'
)

$includeFileExtensions = @(
  '.cjs',
  '.cmd',
  '.css',
  '.js',
  '.json',
  '.md',
  '.ps1',
  '.sh',
  '.ts',
  '.tsx'
)

function Write-Step {
  param([string]$Message)

  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Copy-ProjectItem {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath
  )

  Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Recurse -Force
}

Write-Step "Preparing code package staging folder"

if (Test-Path -LiteralPath $stagingRoot) {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

Write-Step "Copying source code and template assets"

foreach ($directoryName in $includeDirectories) {
  $sourceDirectory = Join-Path $projectRoot $directoryName
  if (-not (Test-Path -LiteralPath $sourceDirectory -PathType Container)) {
    continue
  }

  $destinationDirectory = Join-Path $stagingRoot $directoryName
  Copy-ProjectItem -SourcePath $sourceDirectory -DestinationPath $destinationDirectory
}

$rootFiles = Get-ChildItem -LiteralPath $projectRoot -File -Force |
  Where-Object { $includeFileExtensions -contains $_.Extension.ToLowerInvariant() } |
  Sort-Object Name

foreach ($file in $rootFiles) {
  $destinationFile = Join-Path $stagingRoot $file.Name
  Copy-ProjectItem -SourcePath $file.FullName -DestinationPath $destinationFile
}

Write-Step "Compressing package"
Compress-Archive -Path (Join-Path $stagingRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal -Force

Write-Step "Code package created successfully"
Write-Host $zipPath -ForegroundColor Green
Write-Host "Included: source files, scripts, config, and downloads/template assets." -ForegroundColor DarkGray
Write-Host "Excluded: node_modules, .next, renders, backups, dist staging artifacts, and temporary logs." -ForegroundColor DarkGray
