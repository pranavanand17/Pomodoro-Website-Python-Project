@echo off
cd /d "%~dp0.."
if not exist "start_pair.py" (
  echo Extract the complete AuraCards_Pomodoro_Connected ZIP first.
  pause
  exit /b 1
)
py start_pair.py
