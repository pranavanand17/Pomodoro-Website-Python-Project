# Pomodoro integration

Aura includes a working focus timer so both projects can be developed independently. In the combined local setup, its clock button opens the Pomodoro application at `http://127.0.0.1:5001` and keeps Aura's session tracking. Configure a different browser-facing timer URL in **Settings → Connections → Timer URL** if needed. When the field is blank, Aura uses its server's `POMODORO_URL` setting.

## Handoff

The clock button creates a pending session in the local Aura backend, then opens the configured timer in a new tab. It keeps existing URL query parameters and adds:

| Query parameter | Meaning |
| --- | --- |
| `deck_id` | Opaque identifier of the selected deck |
| `duration` | Desired duration in minutes |
| `return_url` | Aura URL with `?deck=<id>` for returning to the same deck |

The URL fragment carries the session connection:

| Fragment parameter | Meaning |
| --- | --- |
| `aura_session` | Server-issued session ID |
| `aura_token` | Capability authorizing this session only |
| `aura_api` | Base URL of the Aura backend |

Example shape, with placeholders rather than real tokens:

```text
http://127.0.0.1:5001/?deck_id=DECK_ID&duration=25&return_url=ENCODED_RETURN_URL#aura_session=SESSION_ID&aura_token=TOKEN&aura_api=ENCODED_API_URL
```

Fragments are read by the timer's JavaScript and are not sent as part of its initial HTTP request. Keep the token in tab-local sessionStorage for refresh, then remove the Aura fields from the address bar. Do not copy it to logs, analytics, query strings or shared links. The friend's page should avoid third-party scripts that could read the session capability.

The supplied adapter expects fragment key/value parameters. A timer that uses hash-based routing needs to adapt its routing so these fields can be read without breaking its route.

## Pomodoro support

The Pomodoro application consumes the handoff directly: it stores the
short-lived session capability in tab-local session storage, removes the
capability from the address bar, and calls Aura's focus-session status,
start, pause, cancel, and complete endpoints. No adapter copy or frontend
build is required. The token authorizes only the single session and is not
the shared service integration token.

Aura also exposes an authenticated aggregate endpoint at
`GET /api/integrations/summary`. Pomodoro requests it through
`GET /api/integrations/auracards`; Aura requests Pomodoro's equivalent
summary through `GET /api/integrations/pomodoro`. These summaries contain
only completed-session counts and minutes, not deck IDs, documents, notes,
or task names. The two servers use the same `STUDY_INTEGRATION_TOKEN` value,
which must contain at least 32 characters.

Aura's main page can be embedded only from the exact origins listed in
`AURA_FRAME_ORIGINS`. Without that explicit setting, Aura sends
`X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`. This exception
applies only to Aura's main page; API routes and other pages remain
non-embeddable. Pomodoro's drawer also provides a standalone link.

## Legacy adapter

`examples/aura-timer-adapter.js` remains available for third-party timer
projects that do not use this Pomodoro application.

Copy `examples/aura-timer-adapter.js` into the timer project and load it **before** the project's own timer JavaScript:

```html
<script src="aura-timer-adapter.js" defer></script>
<script src="timer.js" defer></script>
```

Initialize it in `timer.js`:

```javascript
const aura = createAuraTimerAdapter();
const initial = await aura.getStatus();
// Initialize the display from initial.remaining_seconds and initial.status.
// Set a Return to cards link to aura.returnUrl.
```

The adapter returns promises for each method. Handle errors in the timer UI; do not report completion when a request fails.

| Timer event | Method | Behavior |
| --- | --- | --- |
| Start / Resume pressed | `await aura.start()` | Starts or resumes active timing on the Aura server |
| Pause pressed | `await aura.pause()` | Records elapsed active time and pauses server timing |
| Countdown reaches zero | `await aura.complete()` | Saves one completion only after the full active duration |
| Cancel pressed | `await aura.cancel()` | Cancels; no completed minutes are recorded |
| Load / refresh / reconnect | `await aura.getStatus()` | Returns the authoritative state and remaining time |

For example, inside an asynchronous start-button event handler:

```javascript
try {
  const state = await aura.start();
  // Begin displaying a countdown from state.remaining_seconds.
} catch (error) {
  // Display error.message and keep the controls in their previous state.
}
```

A running visual countdown can derive its display from the most recent server `remaining_seconds` minus elapsed monotonic client time. Poll occasionally and refresh on reconnect. When it reaches zero, **await completion successfully** before showing a saved state. A 409 `session_incomplete` means the server has not measured the full active duration; get status and continue counting. A browser background tab may throttle intervals, so never depend on counting individual interval ticks.

The built-in `dist/pomodoro.js` demonstrates this flow, including pause/resume, periodic reconciliation, offline errors, tab refresh and starting a new session after completion.

## API behavior

The adapter sends the per-session token in the Authorization header and uses `credentials: "omit"`. No general API key, account or shared server secret is required. Aura binds the session to the selected timer origin and stores only a token hash.

Completed sessions are deduplicated. Paused time does not count. A return URL or client-supplied completion flag does not change statistics. When Aura regains focus, it requests completed minutes from its backend using its own browser-device cookie.

If the friend's timer implements only the query parameters and return link, navigation works, but completion statistics will not sync. It needs the method calls above for full integration.

## Local testing

1. Run Aura on `http://127.0.0.1:5000`.
2. Run Pomodoro on `http://127.0.0.1:5001` with the same integration token.
3. Leave Aura's Timer URL blank or set it to `http://127.0.0.1:5001`; choose a 1-minute duration for testing.
4. Open the timer from Aura. Verify Start, Pause, Resume, completion and return to the selected deck.
5. Attempt early completion: it should return 409 and add zero minutes. Repeat a valid completion: it should keep a single entry.

The timer-control endpoint handles CORS preflight and checks the actual request's token and bound origin. `AURA_ALLOWED_ORIGINS` is unnecessary for this per-session handoff. It is used only when hosting the Aura frontend separately.

Use one hostname consistently for the Aura UI. Keep its terminal running while the timer is active. A hosted HTTPS timer can face browser restrictions when contacting a localhost API; test both locally first. For future internet deployment both projects need a reachable HTTPS API and an appropriate deployment/authentication design.
