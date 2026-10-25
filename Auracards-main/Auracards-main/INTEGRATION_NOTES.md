# Integration notes

The linked edition adds a local API bridge, durable shared Pomodoro state, a collapsible, theme-aware Focus companion in Aura, and a responsive flashcard panel in Study Space. Existing deck editors, file generation, tasks, notes, statistics and AI settings remain available.

## Validation performed

- Aura: 65 Python tests plus 30 parameterized subtests passed, including generation/extraction regressions and the new sharing endpoints.
- Existing JavaScript checks: 51 frontend checks and 23 standalone-timer checks passed.
- Shared timer: 6 new Python tests passed, covering pauses, persistence, four-round cycles, auto-start, input validation, concurrency, stale revisions and task attribution.
- Actual local HTTP calls verified both directions of the bridge, rejection of cross-origin requests, and blocking direct source/database downloads.

- Full page scripts were exercised with a DOM runtime against both live HTTP servers: deck publication/selection, controls in both directions, flip/next, saved card position, reload, custom settings and break locking passed without script errors. This is functional DOM testing, not a rendered browser test.

The Focus companion UI redesign was subsequently reviewed in a headless Chromium browser at desktop (1440px), tablet (960px), and mobile (390px) widths, using mocked local API responses. Opening/closing, Escape, backdrop dismissal, timer start/mode changes, adjusting durations, deck linking/unlinking, light/dark appearance, and absence of horizontal overflow all passed without page script errors. This is browser-rendered UI testing with mocked APIs, not an end-to-end test of two running Python services on the user’s machine.

See LINKING.md for setup, behavior, data locations and API details.

## Focus companion redesign

- The Focus button in Aura's top bar shows/hides a right-side companion. It starts closed on every page load.
- On desktop, the companion occupies a narrow side column and leaves the flashcards unobstructed. On mobile, it is a dismissible drawer.
- Controls and disclosure rows use Aura theme tokens for Obsidian, Pearl, Midnight and custom theme colors.
- Connection details and timer preferences are collapsed by default; only time, interval, and core actions are visible at first.
- The timer remains synchronized and study locking remains in effect even when the companion is closed.
- No integration endpoint, deck storage format, or Pomodoro server changes were made in this UI-only update.
