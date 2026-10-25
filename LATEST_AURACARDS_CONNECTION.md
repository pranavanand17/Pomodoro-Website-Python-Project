# Modern Aura Cards compatibility

The original Pomodoro interface remains in place. `aura-sync.js` connects its
timer controls to Pomodoro's `/api/timer` route so a compatible Aura focus
companion can share the same persisted timer state. The existing Aura
focus-session handoff and summary integration continue to work separately.

## Local setup

Use the Aura Cards source included in this repository. Follow the root
README's dependency setup, then run `.\start_both.bat` on Windows.

The local services use these ports:

- Aura Cards: `http://127.0.0.1:5001`
- Pomodoro: `http://127.0.0.1:8000`

The timer API is same-origin only. It recognizes Render's HTTPS service
hostname when deployed; other integration requests still use the configured
service URLs and shared integration token.
