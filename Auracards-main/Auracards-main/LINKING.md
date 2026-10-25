> **Combined 2026 bundle:** use the root `README_START_HERE.md` and `start_pair.py`. It starts AuraCards on **5001** and Pomodoro on **8000**. The older examples below describe a different standalone configuration.

# Aura Cards + Pomodoro — start here

These are two separate Python apps. Run both on the same PC. They communicate over local HTTP APIs:

- Aura Cards: http://localhost:5000
- Pomodoro / Study Space: http://localhost:8000

No API key, Docker, account, CORS extension, or manual pairing is needed. Do not double-click index.html: open the URLs above after starting the servers.

## 1. Extract both ZIPs

Keep the two project folders anywhere on your PC. They do not need to be inside each other. Use Python 3.10 or newer. Keep both terminal windows running while studying.

## 2. Start Aura Cards

Open a terminal **inside Auracards-main**.

### macOS / Ubuntu / Linux — first time

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

If Ubuntu says the venv module is missing, install your distribution's `python3-venv` package first, then repeat these commands.

Next time, just run:

```bash
sh start.sh
```

### Windows — first time

```bat
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe app.py
```

Next time, double-click `start.bat` (or run it in a terminal).

## 3. Start Pomodoro in a second terminal

Open that terminal **inside Pomodoro-Website-Python-Project-main**.

macOS / Ubuntu / Linux:

```bash
python3 server.py
```

Windows:

```bat
py server.py
```

You can also use `sh start.sh` or double-click `start.bat` on Windows. The timer, flashcards, tasks, notes and statistics use only Python's standard library. Pomodoro's requirements.txt is needed only for its optional Gemini AI sidekick.

## 4. Open both websites

1. Open **http://localhost:5000** in your usual browser. Aura automatically shares its decks with the local API. Wait for “decks available in Pomodoro”.
2. Open **http://localhost:8000**. Click **Show flashcards** above the center-stage timer. Choose your Aura deck in the slide-out companion panel. Click **Hide flashcards**, the × button, or outside the panel to return to an unobstructed timer (Escape also closes the panel). Closing the drawer does not pause the timer or lose your card position.
3. Press **Start**. Click a flashcard to reveal its answer; use Previous / Next to move through the deck. At the last card, Again returns to the first card for another pass.
4. **Pause** freezes the timer and hides the card. **Start** resumes both. During a break, your place is kept and the cards stay covered. When the next focus round starts, they unlock.
5. In Aura, open a deck or start studying, then click the **Focus** button beside the top navigation, then **Link current deck** in the side companion. Press **Start** to study against the same timer. **Unlink deck** removes Aura's study lock without stopping the shared timer.
6. Change durations in Aura's **Timer preferences** or Pomodoro's **Settings**. Both UIs accept custom whole-minute durations: focus 1–180, short break 1–60, long break 1–90. Saving **resets and pauses the current interval**; previous completed sessions remain.

The clock controls work in either website. The Pomodoro flashcard drawer starts hidden (and remembers your last open/closed choice in this browser). Changes normally appear in the other within one second. This is one shared local timer, not two independent countdowns. A stale simultaneous command is rejected with a retry message rather than silently overwriting another tab's change.

## Focus and breaks

Defaults: 25 minutes focus, 5 minutes short break, 15 minutes long break. Every fourth completed focus round leads to a long break. Breaks and subsequent focus rounds wait for Start by default; enable Auto-start breaks / Auto-start focus if preferred.

Reset restarts only the current interval and pauses it. Manually selecting a mode also resets that interval and pauses. Neither action records an unfinished session as completed.

The Python server owns the deadline, so page refreshes, background tabs and pause/resume do not reset it. Timer state is saved in Pomodoro's database and survives a server restart. If all pages are closed, elapsed time is reconciled when a page reconnects: at most one elapsed phase completes, and the next phase starts from the reconnection time if auto-start is enabled. It does not invent a series of unattended completed sessions.

Completed focus rounds are recorded once in **Pomodoro's statistics**, including the selected Pomodoro task. Aura's existing focus-history counter still refers to its legacy standalone timer; it is separate from the linked timer's analytics.

## Where cards and progress live

- Aura remains the deck editor and keeps its original browser storage. Deck edits publish a question/answer snapshot to Aura's local `.aura-data/study-library.sqlite3` file. Original uploaded documents are not shared with Pomodoro.
- Open Aura once after creating/editing/importing decks so those changes are published. Pomodoro refreshes the deck list automatically, or you can click ↻.
- Once published, you can close the Aura browser tab; **leave its Python server running** so Pomodoro can load the shared decks.
- Aura study position is retained across reloads of the same tab. Pomodoro remembers its practice position in browser storage. Each UI keeps its own card position; Aura's mastery ratings are not changed by Pomodoro practice.
- Deck selection is shared through the timer: Link this deck in Aura selects it in Pomodoro. Choosing another deck in Pomodoro does not forcibly replace a study session already open in Aura.
- Keep using your original Aura URL, browser and profile to retain its existing decks. `localhost` and `127.0.0.1` have separate browser storage. If you used `http://localhost:5000` previously, continue using it. Moving to another origin/browser requires an Aura JSON export/import.
- The supplied Pomodoro database is retained. Back it up before replacing an older project folder with this one. To keep newer data from a different installed copy, stop the server and copy that copy's `pomodoro.db` into this project's folder.

## Offline use

Install Aura's Python dependencies once with internet access. After that, the two-app link, timer, flashcards and Aura's offline generator work without internet. Cloud AI and Gemini require their own configuration and internet; neither is required for this integration.

## Troubleshooting

- **Pomodoro offline in Aura:** leave `python server.py` running in the Pomodoro folder. The widget retries automatically.
- **No decks in Pomodoro:** open Aura at its usual URL, wait for the deck-sharing message, then press ↻ in Pomodoro. A deck with zero cards cannot be practised.
- **Cards are covered:** start a focus round. Pauses and breaks deliberately freeze study. In Aura you can choose Unlink deck.
- **Old UI after replacing files:** hard-refresh both pages (Ctrl+Shift+R; Cmd+Shift+R on macOS).
- **Address already in use:** stop the older server with Ctrl+C. Only one instance of each app should use its port.
- **Connection drops:** controls freeze until the timer reconnects. The server's saved deadline remains authoritative. Cards already loaded in Pomodoro can still be used while Aura is offline if the Pomodoro timer is running.
- **Multiple users:** this is a trusted, single-user PC setup. Shared deck snapshots and the timer are accessible to local programs/users on that PC. Both servers bind to loopback; this is not a public-hosting or multi-account design.

## Optional: different ports

Default ports are easiest. If you change one port, tell the other server where it is **before launching it**. Aura accepts `--port` or the `AURA_PORT` environment variable (CLI argument wins). Only local HTTP origins (`localhost` or `127.0.0.1`) are accepted; URLs must contain no path.

Example, macOS/Linux: Aura on 5001 and Pomodoro on 8001.

Aura terminal:

```bash
POMODORO_URL=http://127.0.0.1:8001 .venv/bin/python app.py --port 5001
```

Pomodoro terminal:

```bash
AURA_URL=http://127.0.0.1:5001 PORT=8001 python3 server.py
```

Open http://localhost:5001 and http://localhost:8001. If Pomodoro stays on port 8000, skip `PORT=8001` and open http://localhost:8000 instead. On Windows PowerShell, set `$env:POMODORO_URL`, `$env:AURA_URL` and `$env:PORT` in their respective terminals, then launch normally (Aura also needs `--port 5001`). The server-to-server bridge uses the environment variables above.

## API overview

| Owner | Endpoint | Purpose |
|---|---|---|
| Aura | POST /api/study-library | Publish the current browser's deck snapshot; requires existing Aura CSRF token |
| Aura | GET /api/integration/decks | Local server-to-server deck reading; browser-origin requests rejected |
| Aura | GET /api/linked/timer | Ask the Pomodoro API for its timer state |
| Aura | POST /api/linked/timer | Forward a timer action; requires Aura CSRF token |
| Pomodoro | GET /api/aura/decks | Ask the Aura API for shared flashcards |
| Pomodoro | GET /api/timer | Read/reconcile the durable timer |
| Pomodoro | POST /api/timer | Start, pause, reset, change mode/settings/task/deck |

All timer writes are JSON objects with `action` and the latest `revision` returned by GET. Additional fields: `mode`, `settings`, `task_id` or `deck_id`, depending on the action. Responses return `remaining_seconds`, `mode`, `running`, `round`, `settings`, `revision` and selected task/deck. Revision conflicts return HTTP 409; reload state before retrying. Peers are configured by environment variables and use bounded timeouts with no redirects/proxy inheritance. Browsers call only their own site's API; no cross-site cookie or CORS configuration is needed.

## Validation

Backend tests cover timer boundaries, pause/resume, rest cycles, custom settings, concurrent completion, stale commands, task attribution, and deck validation/CSRF. The original Aura tests are included too.

Aura: `python -m unittest discover -s tests -p 'test_*.py'`

Pomodoro: `python -m unittest discover -s tests -v`
