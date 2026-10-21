# Pomodoro-Website-Python-Project

## Run locally

Install the Python dependency and start the server:

```powershell
python -m pip install -r requirements.txt
python server.py
```

Open <http://127.0.0.1:8000> in your browser. The timer, notes, tasks,
subjects, settings, and statistics use a local SQLite database.

## Configure Study Sidekick

The AI assistant requires a Gemini API key. In PowerShell, set the key in
the same terminal before starting the server:

```powershell
$env:GEMINI_API_KEY = "your-gemini-api-key"
python server.py
```

The default model is `gemini-2.5-flash`. To use another available model, set
`GEMINI_MODEL` in that terminal before starting the server.
