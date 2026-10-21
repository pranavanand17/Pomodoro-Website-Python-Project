# API reference

Base URL: `http://localhost:5000`. Responses use JSON except frontend/static files and CORS preflight. Error responses have `{"error":"Human-readable message","code":"machine_code"}` with an appropriate non-2xx status. A client should show the error, retain the selected file and allow a deliberate retry.

## Browser initialization

`GET /api/config` initializes an HttpOnly, SameSite=Strict signed browser-device cookie and returns:

```json
{
  "csrf_token": "opaque-value",
  "generators": ["extractive", "cloud", "ollama"],
  "cloud": {"configured": false, "provider": "OpenAI", "model": "gpt-4.1-mini"},
  "max_file_mb": 20,
  "ollama_model": "llama3.2:3b",
  "timer_url": "/pomodoro"
}
```

The UI keeps the CSRF value in memory. Send the same cookie and `X-Aura-CSRF` header on document generation, focus creation and focus-history deletion. Requests from unexpected origins are rejected. A same-origin browser client uses `credentials: "include"`.

`GET /api/health` returns app/version/status. `GET /api/models/status` returns `reachable`, `installed` and `model` for the configured Ollama service; failure to reach Ollama does not prevent offline generation.

## Generate cards

`POST /api/generate`, `multipart/form-data`.

| Field | Required | Accepted value |
| --- | --- | --- |
| `file` | Yes | PDF, DOCX or PPTX, up to 20 MB |
| `name` | Yes | Deck name, 1–100 characters |
| `category` | Yes | Category, 1–100 characters |
| `count` | No | Integer 1–50; default 20 |
| `difficulty` | No | `beginner`, `intermediate`, `advanced`, `mixed` (default) |
| `engine` | No | `extractive` (default), `cloud` or `ollama` |
| `style` | No | `mixed` (default), `qa`, or `cloze` |
| `focus` | No | Topic focus, up to 160 characters |
| `input_format` | No | Offline only: `auto` (default), `qa`, `topics`, `prose`; AI modes accept `auto` |
| `cloud_consent` | For cloud | Exactly `yes`; required per request before processing/sending text |

Do not set a multipart Content-Type manually when using browser `FormData`; let the browser add the boundary.

```json
{
  "cards": [
    {
      "question": "What is a list?",
      "answer": "An ordered mutable collection that can contain duplicate items.",
      "kind": "definition",
      "tags": ["Python Study Notes"],
      "source": {
        "label": "Page 1",
        "excerpt": "A list is an ordered mutable collection that can contain duplicate items."
      }
    }
  ],
  "engine": "extractive",
  "requested_count": 10,
  "generated_count": 1,
  "card_types": {"definition": 1},
  "warnings": ["Created 1 supported cards instead of 10; the source contained fewer usable facts."]
}
```

Offline responses additionally include `detected_format` (`qa`, `topics`, `prose`, or `mixed`) and `structured_cards` (the number of preserved Q&A/topic cards). Each card has `origin`: `qa`, `topic`, or `generated`. Structured cards retain their own answer blocks even when `style=cloze`, and a warning explains that choice.

The returned cards are drafts: the UI previews them before saving. `kind` is one of `definition`, `function`, `cause`, `comparison`, `process`, `fact` or `cloze`. `card_types` counts those types. A cloze answer contains only the missing phrase.

Cloud mode requires `OPENAI_API_KEY` on the server and explicit `cloud_consent=yes`. The key is never accepted in form data, returned in config, or saved in decks. Model selection is server-only. `/api/config` only checks whether a key is configured; it does not verify access or contact the provider. Cloud errors include `cloud_consent_required`, `cloud_not_configured`, `cloud_auth`, `cloud_limit`, `cloud_timeout`, `generation_refused`, `incomplete_generation` and `invalid_generation`. Do not silently retry a failed cloud request; the provider may have billed it.

A successful request returns 200 even when fewer cards can be supported. `generated_count` is the actual number. An invalid document, no usable text or no valid cards returns an error rather than fabricated content. AI errors never silently switch generation modes.

Common statuses: 400 invalid fields, 403 CSRF/origin, 413 size limit, 415 wrong/unsupported format, 422 unreadable/no text/no cards, 429 busy/rate limit, 502 invalid model output, 503 local model unavailable, 504 local model request timeout. Use the returned message/code, since a single status can cover multiple conditions.

## Focus-session collection

`POST /api/focus-sessions` requires browser cookie and CSRF header.

```json
{
  "deck_id": "opaque-browser-deck-id",
  "duration_minutes": 25,
  "timer_url": "http://localhost:5000/pomodoro"
}
```

`deck_id` is a non-empty string up to 100 characters; it is a reference to a browser-owned deck, not a server-side deck record. Duration is an integer from 1 to 120. Timer URLs must use HTTPS except loopback HTTP. The timer origin is bound to the created session.

Response 201:

```json
{
  "session_id": "uuid",
  "completion_token": "opaque-per-session-capability",
  "duration_seconds": 1500
}
```

The token is not a general API key. It can control only this session and expires 48 hours after creation. Only its hash is stored in SQLite. Do not put it in query parameters or logs.

`GET /api/focus-sessions` uses the browser-device cookie and returns only that device's completed session summary:

```json
{"completed_sessions": 1, "total_minutes": 25, "sessions": [{"session_id":"uuid","minutes":25,"completed_at":1790000000.0}]}
```

The list contains at most the last 1,000 records; totals cover all retained completions. Timestamps are Unix seconds. Records older than 90 days are pruned on app startup.

`DELETE /api/focus-sessions` requires cookie and CSRF; it deletes **all** sessions for this browser device, including open ones, and returns `{"status":"cleared"}`. Existing timer tokens for deleted sessions no longer work.

## Focus-session control

`GET /api/focus-sessions/<session_id>` returns the authoritative state. `POST` to the same endpoint applies `{"action":"start"}`, `pause`, `cancel` or `complete`.

Both routes require:

```http
Authorization: Bearer <completion_token>
```

The timer should omit cookie credentials. Browser requests must come from the timer origin chosen during creation. A server-to-server caller can use the per-session token without an Origin header. CORS preflight permits the necessary headers; it does not bypass the actual token/origin authorization.

```json
{
  "session_id": "uuid",
  "deck_id": "opaque-browser-deck-id",
  "status": "running",
  "duration_seconds": 1500,
  "elapsed_seconds": 100.25,
  "remaining_seconds": 1399.75
}
```

| Action | Accepted state | Result |
| --- | --- | --- |
| `start` | pending / paused | running; accumulates active time from the server clock |
| `pause` | running | paused; stops accumulation |
| `cancel` | pending / running / paused | cancelled; cannot resume |
| `complete` | running after full active duration | completed; contributes exactly one entry |

Repeating start while running, pause while paused, cancel while cancelled or complete after completed is idempotent. Other transitions return 409. Premature completion returns 409 `session_incomplete`. Wrong/missing token returns 401; wrong timer origin returns 403; a valid but expired session token returns 410.

Clients must not supply elapsed time, completion timestamps or a trusted `completed=true` query parameter. The backend computes time itself. This measures a running timer; it does not prove a person's attention or study activity.
