@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

set "PORT=3000"
set "ROOT_URL=http://127.0.0.1:%PORT%"
set "HEALTH_URL=%ROOT_URL%/api/health"
set "SERVER_WINDOW_TITLE=Remotion AI Server"

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "NPM_EXE=C:\Program Files\nodejs\npm.cmd"

if exist "%NODE_EXE%" (
  set "NODE_CMD="%NODE_EXE%""
  set "NPM_CMD="%NPM_EXE%""
) else (
  where /q node
  if errorlevel 1 (
    echo Node.js not found.
    echo Install Node.js LTS first, then run this script again.
    pause
    exit /b 1
  )
  set "NODE_CMD=node"
  set "NPM_CMD=npm"
)

echo.
echo [1/6] Checking dependencies...
if not exist "node_modules" (
  call %NPM_CMD% install
  if errorlevel 1 goto :fail
) else (
  echo node_modules already exists.
)

echo.
echo [2/6] Ensuring required folders exist...
if not exist "renders" mkdir "renders"
if not exist "src" mkdir "src"
if not exist "src\compositions" mkdir "src\compositions"

echo.
echo [3/6] Checking Remotion browser...
if exist "node_modules\.bin\remotion.cmd" (
  call "node_modules\.bin\remotion.cmd" browser ensure
  if errorlevel 1 goto :fail
) else (
  echo Remotion CLI not found in node_modules\.bin
  goto :fail
)

echo.
echo [4/6] Building Next.js frontend...
call %NPM_CMD% run build
if errorlevel 1 goto :fail

echo.
echo [5/6] Checking for an existing local server...
set "PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  if not defined PID set "PID=%%p"
)

if defined PID (
  set "PROCESS_NAME="
  for /f "usebackq tokens=1 delims=," %%n in (`tasklist /FI "PID eq !PID!" /FO CSV /NH`) do (
    set "PROCESS_NAME=%%~n"
  )
  if /i "!PROCESS_NAME!"=="node.exe" (
    echo Existing Node server found on port %PORT% ^(PID !PID!^). Restarting it...
    call "%PROJECT_DIR%stop-web.cmd"
    if errorlevel 1 goto :fail
    timeout /t 1 /nobreak >nul
  ) else (
    echo Port %PORT% is already in use by !PROCESS_NAME! ^(PID !PID!^).
    echo Close that process or change the port before running this script again.
    goto :fail
  )
) else (
  echo No existing server detected on port %PORT%.
)

echo.
echo [6/6] Starting local server in a new window...
start "%SERVER_WINDOW_TITLE%" cmd /k "cd /d ""%PROJECT_DIR%"" && set NODE_ENV=production && set PORT=%PORT% && %NODE_CMD% server.js"

echo.
echo Waiting for the server to become ready...
set "READY="
for /l %%i in (1,1,30) do (
  powershell -ExecutionPolicy Bypass -NoLogo -NoProfile -Command ^
    "try { $resp = Invoke-WebRequest -UseBasicParsing '%HEALTH_URL%' -TimeoutSec 2; if ($resp.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
  if not errorlevel 1 (
    set "READY=1"
    goto :ready
  )
  timeout /t 1 /nobreak >nul
)

:ready
if not defined READY (
  echo Server did not pass the health check within 30 seconds.
  echo Check the "%SERVER_WINDOW_TITLE%" window for errors, then rerun this script.
  goto :fail
)

echo.
echo Server is ready: %ROOT_URL%
if not defined SKIP_OPEN_BROWSER start "" "%ROOT_URL%"
exit /b 0

:fail
echo.
echo Startup failed.
pause
exit /b 1
