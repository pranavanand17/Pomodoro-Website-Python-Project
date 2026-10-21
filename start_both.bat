@echo off
setlocal
set "ROOT=%~dp0"
set "AURA=%ROOT%Auracards-main\Auracards-main"

if not exist "%AURA%\.venv\Scripts\python.exe" (
    echo Aura Cards dependencies are not installed.
    echo Create its virtual environment and install Auracards-main\Auracards-main\requirements.txt first.
    exit /b 1
)

for /f "usebackq delims=" %%T in (`python -c "import secrets; print(secrets.token_urlsafe(32))"`) do set "STUDY_INTEGRATION_TOKEN=%%T"
if not defined STUDY_INTEGRATION_TOKEN (
    echo Could not create a shared integration token. Check that Python is installed.
    exit /b 1
)

set "PORT=5001"
set "POMODORO_URL=http://127.0.0.1:5001"
set "POMODORO_API_URL=http://127.0.0.1:5001"
set "AURACARDS_URL=http://127.0.0.1:5000"
set "AURACARDS_API_URL=http://127.0.0.1:5000"
set "AURA_FRAME_ORIGINS=http://127.0.0.1:5001"

start "Pomodoro" cmd /k "cd /d ""%ROOT%"" && python server.py"
start "Aura Cards" cmd /k "cd /d ""%AURA%"" && .venv\Scripts\python.exe app.py --port 5000"

echo Pomodoro:  http://127.0.0.1:5001
echo Aura Cards: http://127.0.0.1:5000
echo Close each server window to stop that application.
