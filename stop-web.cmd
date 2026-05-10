@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "PORT=3000"
set "FOUND_ANY="
set "SEEN_PIDS=;"

for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  set "FOUND_ANY=1"
  call :stop_pid %%p
)

if defined FOUND_ANY (
  echo.
  echo Service shutdown check completed.
) else (
  echo.
  echo No process is listening on port %PORT%.
)

exit /b 0

:stop_pid
set "PID=%~1"
set "PROCESS_NAME="

echo !SEEN_PIDS! | findstr /C:";%PID%;" >nul
if not errorlevel 1 goto :eof
set "SEEN_PIDS=!SEEN_PIDS!!PID!;"

for /f "usebackq tokens=1 delims=," %%n in (`tasklist /FI "PID eq %PID%" /FO CSV /NH`) do (
  set "PROCESS_NAME=%%~n"
  goto :have_name
)

:have_name
if /i "!PROCESS_NAME:~0,5!"=="INFO:" set "PROCESS_NAME="

if not defined PROCESS_NAME (
  echo.
  echo Process %PID% was already gone.
  goto :eof
)

if /i not "!PROCESS_NAME!"=="node.exe" (
  echo.
  echo Port %PORT% is occupied by !PROCESS_NAME! ^(PID %PID%^) instead of node.exe. Skipping.
  goto :eof
)

echo.
echo Stopping !PROCESS_NAME! ^(PID %PID%^) on port %PORT%...
taskkill /PID %PID% /T /F >nul

if errorlevel 1 (
  echo Failed to stop process %PID%.
  goto :eof
)

echo Service on port %PORT% stopped.

goto :eof
