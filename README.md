> **For this combined project**, use `../README_START_HERE.md` and run `python3 start_pair.py` from the combined project root. AuraCards runs on 5001 and Pomodoro on 8000.

# Pomodoro + Aura Cards

This folder contains two separate applications. Pomodoro is a Python
standard-library HTTP server; Aura Cards is a Flask application served by
Waitress. They keep their own dependencies, interfaces, and databases.

## Install dependencies

Install the optional Gemini dependency for Pomodoro's Study Sidekick:

```powershell
python -m pip install -r requirements.txt
```

Install Aura Cards into its own virtual environment:

```powershell
python -m venv ..\Auracards-main\.venv
..\Auracards-main\.venv\Scripts\python.exe -m pip install -r ..\Auracards-main\requirements.txt
```

No Node.js build step is needed: Aura Cards serves its existing frontend from
`..\Auracards-main\dist`.

## Start both on Windows

Run:

```powershell
.\start_both.bat
```

The script creates a random, temporary shared integration token in the
process environment and opens a separate terminal for each server:

- Pomodoro: <http://127.0.0.1:8000>
- Aura Cards: <http://127.0.0.1:5001>

Close each server's terminal window to stop it. You can also start either
application independently:

```powershell
$env:PORT = "8000"
python server.py
```

```powershell
Set-Location ..\Auracards-main
.venv\Scripts\python.exe app.py --port 5001
```

For integration while starting the apps separately, set the same
`STUDY_INTEGRATION_TOKEN` (at least 32 characters) in both server processes.
Set `POMODORO_URL` and `POMODORO_API_URL` in Aura's environment, and
`AURACARDS_URL` and `AURACARDS_API_URL` in Pomodoro's environment. The
defaults match the local URLs above. Set `POMODORO_DB` to use a different
Pomodoro SQLite file; otherwise the existing `pomodoro.db` is used. To use
the side panel, set `AURA_FRAME_ORIGINS=http://127.0.0.1:8000` in Aura's
environment.

Aura's interface opens in a slide-out panel inside Pomodoro. Its frame
permission is restricted to Pomodoro's exact origin; Aura denies framing by
default and on its API/other pages. The panel also offers a link to open Aura
separately. Aura's **Settings → Connections → Timer URL** can be left blank to use
`POMODORO_URL`. Its timer button opens Pomodoro with a short-lived,
session-specific Aura capability. Start, pause, resume, and completion are
sent directly to Aura's existing focus-session API. Pomodoro's **Aura Cards
progress** in Statistics fetches Aura's aggregate focus summary. Aura's
overview can fetch Pomodoro's daily and all-time totals.

## Integration APIs

Service-to-service summary endpoints require:

```http
Authorization: Bearer <STUDY_INTEGRATION_TOKEN>
```

- Pomodoro's `GET /api/integrations/summary` exposes only today's and
  all-time completed session counts and minutes. Aura's
  `GET /api/integrations/pomodoro` calls it and returns that summary.
- Aura's `GET /api/integrations/summary` exposes only aggregate completed
  focus-session counts and minutes. Pomodoro's
  `GET /api/integrations/auracards` calls it and returns that summary.
- Aura's existing `POST /api/focus-sessions` creates a per-session
  capability; `GET`/`POST /api/focus-sessions/<session_id>` lets the
  linked Pomodoro page control only that focus session. This token is
  separate from the service integration token.

Example local summary call from PowerShell after setting the token:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/integrations/summary `
  -Headers @{ Authorization = "Bearer $env:STUDY_INTEGRATION_TOKEN" }
```

The two proxy endpoints call only their counterpart's protected summary
route, so requests cannot recurse. Network failures return JSON errors with
HTTP 503; neither application exposes notes, deck contents, task titles, or
database files through these routes.

## Cross-computer access

`localhost` and `127.0.0.1` always refer to the computer making the request;
they do not reach another computer. The defaults above are for one PC only.
To use different machines, give each service a reachable HTTPS URL, set the
corresponding `*_URL` and `*_API_URL` environment variables, and configure
the same strong `STUDY_INTEGRATION_TOKEN` on both servers. Aura's focus
handoff also requires a reachable HTTPS Aura API URL and an HTTPS Pomodoro
timer URL.

Both servers bind to loopback by default and are not exposed to the internet.
For remote access, deploy behind an HTTPS reverse proxy with firewall rules,
authentication, and an explicit deployment/security configuration. Set
`AURA_FRAME_ORIGINS` to the exact HTTPS Pomodoro origin to allow the drawer;
Aura will otherwise deny framing. Do not use public tunnels or expose these
development servers without those protections.

The apps retain separate data stores: Pomodoro uses `pomodoro.db`; Aura keeps
its focus metadata in its own `.aura-data` directory and stores decks in the
browser. Integration sends only summary totals and session-control requests.

## Deploy both apps to Render

This repository includes a Render Blueprint (`render.yaml`) that creates two
Python web services: Pomodoro and Aura Cards. Each service has its own
persistent disk for SQLite data. Persistent disks require paid Render
instances; do not remove the disks if you need data to survive deploys and
restarts.

1. Push this repository to GitHub, then in Render choose **New → Blueprint**
   and connect the repository. Render reads `render.yaml` and creates both
   services and the shared integration-token environment group.
2. Wait for both services to finish their first deploy. Copy each public
   `onrender.com` URL from its service page; Render assigns these URLs when
   it creates the services.
3. In the **pomodoro-website** service's environment, set
   `AURACARDS_URL` and `AURACARDS_API_URL` to the full Aura Cards URL, for
   example `https://aura-cards-example.onrender.com`.
4. In the **aura-cards** service's environment, set `POMODORO_URL` and
   `POMODORO_API_URL` to the full Pomodoro URL, and set
   `AURA_FRAME_ORIGINS` to that same URL's origin (scheme and hostname only,
   with no trailing slash or path).
5. Keep `STUDY_INTEGRATION_TOKEN` from the shared environment group in both
   services. Render generates it once for the group; do not replace it with
   different values in the individual services. Save the changed variables
   and let Render redeploy.

Both apps should then load from their public URLs. The Blueprint binds each
server to Render's public interface, uses Render's assigned `PORT`, enables
secure Aura session cookies, and configures health checks. Aura automatically
trusts its Render-provided hostname. If you add a custom domain, add its
hostname (without `https://`) to Aura's comma-separated
`AURA_TRUSTED_HOSTS` environment variable as well.

Gemini Study Sidekick and Aura's optional Cloud AI are not required to run
the apps. To enable them, set `GEMINI_API_KEY` on **pomodoro-website** and
`OPENAI_API_KEY` on **aura-cards**, respectively. Decks remain in each
user's browser; Aura's disk stores focus-session metadata, and Pomodoro's
disk stores its timer data.
