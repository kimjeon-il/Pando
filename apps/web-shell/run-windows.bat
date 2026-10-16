@echo off
set "taskPowerShell=powershell.exe"
where pwsh.exe >nul 2>&1
if not errorlevel 1 set "taskPowerShell=pwsh.exe"
if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "taskPowerShell=%ProgramFiles%\PowerShell\7\pwsh.exe"
"%taskPowerShell%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-windows.ps1"
if errorlevel 1 pause
