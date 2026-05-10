@echo off
setlocal
set SCRIPT_DIR=%~dp0

powershell -ExecutionPolicy Bypass -NoLogo -NoProfile -File "%SCRIPT_DIR%scripts\restore-and-run.ps1"
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Restore failed with exit code %EXIT_CODE%.
  echo Press any key to close this window.
  pause >nul
)

exit /b %EXIT_CODE%
