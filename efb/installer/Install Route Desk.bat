@echo off
title Route Desk tablet app installer
if not exist "%~dp0routedesk-efb\manifest.json" (
  echo.
  echo  Please unzip the download first.
  echo  Right-click routedesk-efb.zip, choose "Extract All...", then run
  echo  "Install Route Desk" from the extracted folder.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
