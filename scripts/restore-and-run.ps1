Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeInstallDir = 'C:\Program Files\nodejs'
$nodeExe = Join-Path $nodeInstallDir 'node.exe'
$npmCmd = Join-Path $nodeInstallDir 'npm.cmd'

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Add-NodeToPath {
  if ((Test-Path $nodeInstallDir) -and ($env:Path -notlike "*$nodeInstallDir*")) {
    $env:Path = "$nodeInstallDir;$env:Path"
  }
}

function Ensure-NodeInstalled {
  Add-NodeToPath

  if (Get-Command node -ErrorAction SilentlyContinue) {
    return
  }

  Write-Step "Node.js not found. Installing Node.js LTS with winget"

  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Node.js is not installed and winget is unavailable. Install Node.js LTS manually, then run this script again."
  }

  & winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  Add-NodeToPath

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js installation finished but node is still not available in PATH. Try reopening the terminal and rerunning the script."
  }
}

Write-Step "Switching to project folder"
Set-Location $projectRoot

Ensure-NodeInstalled

Write-Step "Checking Node.js"
& $nodeExe --version

Write-Step "Installing npm dependencies"
& $npmCmd ci

Write-Step "Ensuring required folders exist"
New-Item -ItemType Directory -Force -Path 'src', 'src\compositions', 'renders' | Out-Null

$remotionCmd = Join-Path $projectRoot 'node_modules\.bin\remotion.cmd'
if (-not (Test-Path $remotionCmd)) {
  throw "Remotion CLI not found after npm install. Please inspect npm output and rerun."
}

Write-Step "Installing Chromium for Remotion"
& $remotionCmd browser ensure

Write-Step "Starting local server"
Write-Host "Open http://localhost:3000 after the server is ready." -ForegroundColor Green
Write-Host "You can enter Anthropic or MiniMax API keys directly in the page." -ForegroundColor Green
Write-Host ""

& $nodeExe server.js
