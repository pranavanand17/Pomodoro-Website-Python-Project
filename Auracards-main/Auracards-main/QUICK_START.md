# QUICK START — AuraCards + Pomodoro

The two projects are separate Python servers on the **same computer**. Keep BOTH terminal windows open. Open the websites in your browser; do not double-click `index.html`.

## Example: Aura on port 5001, Pomodoro on port 8000

### Terminal 1 — in `Auracards-main`

macOS / Ubuntu / Linux, first run:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py --port 5001
```

For later runs, just `.venv/bin/python app.py --port 5001`. The optional `AURA_PORT=5001 sh start.sh` also works.

Windows PowerShell, first run:

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe app.py --port 5001
```

### Terminal 2 — in `Pomodoro-Website-Python-Project-main`

macOS / Ubuntu / Linux:

```sh
AURA_URL=http://127.0.0.1:5001 python3 server.py
```

Windows PowerShell:

```powershell
$env:AURA_URL = "http://127.0.0.1:5001"
py server.py
```

Open **http://localhost:5001** (AuraCards) FIRST to publish your decks, then **http://localhost:8000** (Pomodoro). Hit **Show flashcards** above the main clock, pick a deck, then **Start**. You can hide the flashcards anytime without pausing the timer.

## Other ports / manual API addresses

- Aura listens on `--port NUMBER` (or the `AURA_PORT` environment variable; CLI takes precedence). Its default is `5001` in this bundle.
- Pomodoro listens on `PORT=NUMBER` (default `8000`).
- Pomodoro calls Aura through `AURA_URL=http://127.0.0.1:AURA_PORT`, which must be set in the **Pomodoro** terminal.
- Aura calls Pomodoro through `POMODORO_URL=http://127.0.0.1:POMODORO_PORT`, which must be set in the **Aura** terminal if Pomodoro isn't on `8000`.

Example of changing both ports to 5001 and 8001 (macOS/Linux):

```sh
# Aura terminal
POMODORO_URL=http://127.0.0.1:8001 .venv/bin/python app.py --port 5001

# Pomodoro terminal
AURA_URL=http://127.0.0.1:5001 PORT=8001 python3 server.py
```

The two sites keep their own look. Timer state and duration settings are shared through the local APIs; the Pomodoro database lives in its project folder and deck data is edited in Aura. See `LINKING.md` for troubleshooting and privacy notes.

**Before replacing an older project folder:** back up your existing `pomodoro.db` and Aura browser deck export. Keep using the SAME Aura origin (hostname + port), or export/import your decks, since browser storage is per-origin.

## Focus companion in AuraCards

The Focus companion is hidden by default. Click the subtle **Focus** button in the
AuraCards top bar to show it alongside your flashcards. Click the button again,
the **×** in the companion, or press **Escape** to hide it. On smaller screens,
tap the dimmed area outside the drawer to close it.

The timer keeps running in Pomodoro even when the companion is hidden.
Use **Link current deck** to optionally lock study cards to a running focus
round; **Unlink deck** returns to normal studying. **Timer preferences**
contains focus/break durations and auto-start controls, and **Connection details**
is tucked away so it does not clutter your study space.

This companion uses AuraCards' active appearance theme (Obsidian, Pearl or
Midnight) and has no separate color/theme settings.
