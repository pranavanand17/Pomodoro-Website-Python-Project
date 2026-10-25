# Linked study edition

**Start here: [LINKING.md](LINKING.md)** — run Aura on port 5001 and Pomodoro on port 8000. Both APIs connect automatically.

# Aura Cards

A complete localhost flashcard application. Upload PDF, DOCX or PPTX notes, generate cards, organize decks and study with an integrated Pomodoro timer. The Flask backend serves the frontend, extracts documents locally and records focus-session metadata. Offline generation needs no account or API key. Optional Cloud AI sends selected text to a hosted model for stronger question writing.


## Change the AuraCards port

Launch with `.venv/bin/python app.py --port 5001` (macOS/Linux), or `.venv\Scripts\python.exe app.py --port 5001` (Windows). You can also set `AURA_PORT=5001` on macOS/Linux before `sh start.sh`, or `$env:AURA_PORT="5001"` on Windows PowerShell before `start.bat`. The `--port` argument takes precedence.

If you change the Aura port, launch Pomodoro with `AURA_URL=http://127.0.0.1:5001` set in its terminal. See `LINKING.md` for commands for both operating systems.

## llama.cpp local models

Aura detects a running llama-server and uses its loaded local chat model to map
learning objectives, draft cards, audit/repair answers and fill coverage gaps.
Choose Flash for direct drafting with automatic source checks, or Balanced/Thorough
for concept mapping and separate model review/repair. Answer-detail controls, live
progress and mode-specific generation summaries are included. See [LLAMA_CPP.md](LLAMA_CPP.md) for
automatic detection, custom ports, model switching and setup.
