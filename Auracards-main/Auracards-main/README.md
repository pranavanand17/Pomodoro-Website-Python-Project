# Aura Cards

A complete localhost flashcard application. Upload PDF, DOCX or PPTX notes, generate cards, organize decks and study with an integrated Pomodoro timer. The Flask backend serves the frontend, extracts documents locally and records focus-session metadata. Offline generation needs no account or API key. Optional Cloud AI sends selected text to a hosted model for stronger question writing.

Run Aura Cards on port 5000 with its existing Windows or shell startup
command. In the combined project, leave **Settings → Connections → Timer
URL** blank to use the configured Pomodoro application at
`http://127.0.0.1:5001`. The timer handoff uses Aura's per-session capability
API; Pomodoro controls only the session created for that tab.

Pomodoro embeds Aura's main page in its side panel. Aura permits framing that
page only from the exact origin(s) in `AURA_FRAME_ORIGINS`; the default is
empty, which denies all embedding. The combined Windows launcher configures
the local Pomodoro origin. API and other Aura pages retain their frame-deny
policy.

For the optional progress exchange, configure `POMODORO_API_URL` and
`STUDY_INTEGRATION_TOKEN` in Aura's server environment. The token must be at
least 32 characters and match the value used by Pomodoro. Aura's overview
can then retrieve Pomodoro's aggregate session totals. See the repository
README and `docs/pomodoro-integration.md` for setup, API routes, and
cross-network requirements.
