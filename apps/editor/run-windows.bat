@echo off
node "%~dp0dev.mjs" --native=windows --offline
if errorlevel 1 pause
