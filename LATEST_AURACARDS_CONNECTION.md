# Modern AuraCards compatibility (no Pomodoro redesign)

The original Pomodoro `index.html` layout, `style.css`, `script.js`, and data
remain as uploaded. A second script `aura-sync.js` connects the timer to the
local `/api/timer` server route, which modern Aura's Focus Companion consumes.
`local_bridge.py` forwards deck snapshots via Aura's `/api/integration/decks`.

The older Aura focus-session handoff and authenticated statistics requests
are supported; use the updated `Auracards-main` from this same release.

To start both together, extract the full AuraCards_Pomodoro_Connected ZIP and
run `python3 start_pair.py` from its root after installing Aura dependencies.

## Current local ports

AuraCards: `http://127.0.0.1:5001`  
Pomodoro: `http://127.0.0.1:8000`  
Start both from the bundle root with `python3 start_pair.py`. Port 5000 is not used.
