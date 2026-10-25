# Original Pomodoro integration

This build is AuraCards_Flash_Mode_LATEST, with only two compatibility changes in `app.py`:

- `AURA_FRAME_ORIGINS` optionally permits the original Pomodoro sidebar to embed the Aura **home page**; all other routes remain unframeable. Default denies framing.
- `GET /api/integrations/summary` supplies legacy, token-protected aggregate session counts for the original Pomodoro Statistics panel. The timer, generator, themes and flashcards are otherwise unchanged.

Use it with the updated Pomodoro and the `start_pair.py` launcher from the combined bundle.
