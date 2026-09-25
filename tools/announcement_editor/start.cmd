@echo off
cd /d "%~dp0"
py -3 editor.py %*
if errorlevel 1 pause
