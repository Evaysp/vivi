param(
  [string]$BackupPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$projectName = Split-Path -Leaf $projectRoot
$backupRoot = Join-Path $projectRoot 'backups'

function Write-Step {
  param([string]$Message)

  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-BackupToRestore {
  param([string]$RequestedPath)

  if ([string]::IsNullOrWhiteSpace($RequestedPath)) {
    $latestBackup = Get-ChildItem -LiteralPath $backupRoot -Filter "$projectName-full-backup-*.zip" -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1

    if (-not $latestBackup) {
      throw "No backup archive was found in $backupRoot."
    }

    return $latestBackup.FullName
  }

  $candidatePath = $RequestedPath
  if (-not [System.IO.Path]::IsPathRooted($candidatePath)) {
    $candidatePath = Join-Path $backupRoot $candidatePath
  }

  return (Resolve-Path -LiteralPath $candidatePath -ErrorAction Stop).Path
}

function Invoke-RobocopyMirror {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath
  )

  & robocopy $SourcePath $DestinationPath /MIR /R:1 /W:1 /XJ /XD backups
  $robocopyExitCode = $LASTEXITCODE

  if ($robocopyExitCode -gt 7) {
    throw "Robocopy failed with exit code $robocopyExitCode."
  }
}

$backupToRestore = Resolve-BackupToRestore -RequestedPath $BackupPath
$extractRoot = Join-Path ([System.IO.Path]::GetTempPath()) "$projectName-restore-$([guid]::NewGuid().ToString('N'))"

Write-Step "Selected backup"
Write-Host $backupToRestore -ForegroundColor Yellow
Write-Host "The backups folder will be preserved during restore." -ForegroundColor DarkGray

try {
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null

  Write-Step "Extracting backup"
  Expand-Archive -LiteralPath $backupToRestore -DestinationPath $extractRoot -Force

  $restoredItems = Get-ChildItem -LiteralPath $extractRoot -Force
  if (-not $restoredItems) {
    throw "The backup archive is empty."
  }

  Write-Step "Restoring project files"
  Invoke-RobocopyMirror -SourcePath $extractRoot -DestinationPath $projectRoot

  Write-Step "Restore completed"
  Write-Host "Project restored from $backupToRestore" -ForegroundColor Green
}
finally {
  if (Test-Path -LiteralPath $extractRoot) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
  }
}
