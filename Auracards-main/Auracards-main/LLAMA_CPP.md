# Local AI with llama.cpp

Aura can use the model already running in **llama-server**. It works with local
chat/instruct models supported by your llama.cpp build; there is no hardcoded
Qwen model name. Use a model with a working chat template and JSON generation.
Models and their generation quality differ, so review the draft cards.

## Use your running model

1. Start Aura as usual: `python app.py` (or your existing virtual environment).
2. Open **Upload notes**. Aura checks local ports **8080, 8081 and 8000**.
3. When found, **Local AI · llama.cpp** is selected automatically unless you have
   explicitly chosen a generator. The panel shows the detected model and context.
4. Choose a model if the server exposes multiple models. Upload a PDF, DOCX or
   PPTX, set the card count, difficulty, style and optional focus, then generate.
5. Review and edit the cards and their source excerpts before adding them.

**Detect again** refreshes the model list after you switch models. Your selected
model, server address and generator choice are remembered on this browser.
If a previously selected model disappears, detection chooses an available model.

For a custom port, expand **Server address**, enter (for example)
`http://127.0.0.1:9090` and choose **Detect again**. An optional `/v1` suffix is
accepted. All inference is routed through Aura's Python backend, so no llama.cpp
browser CORS configuration is required.

## If you are running llama-cli rather than llama-server

The CLI alone does not expose an HTTP API. Run the server using your existing
GGUF file, for example (adjust the executable and model paths):

```sh
llama-server -m /path/to/your-model.gguf --host 127.0.0.1 --port 8080 --ctx-size 8192
```

Keep your existing GPU/offloading flags if you use them. Aura connects to this
server; it does not install llama.cpp, download a GGUF or load a second model.
No new Python dependencies are required for this integration.

## The advanced study pipeline

Balanced and Thorough llama.cpp generation use a multi-stage curriculum pipeline:

1. **Structure and retrieve.** Preserve neighboring Word paragraphs, explicit Q&A,
   headings, table columns and source locations. Split long sections near natural
   boundaries. Select sections across the document, or rank a supplied Focus
   using lexical relevance and content diversity. Focus matching searches all
   extracted sections before selection; it does not search only an early sample.
2. **Build a study blueprint.** The selected model identifies distinct learning
   objectives, topics, importance and card types, each with an exact supporting
   excerpt. Objectives without real source evidence are discarded.
3. **Write to the blueprint.** Generate cards for specific uncovered objectives,
   prioritizing unrepresented source sections. Difficulty steers foundations,
   relationships, mechanisms, contrasts and conditions according to the notes.
4. **Audit and repair.** A separate request to the same model reviews every draft
   claim, its evidence, missing qualifications and answer sufficiency. It returns
   keep/revise/drop decisions and complete corrected cards. Only reviewed cards
   can enter a Balanced/Thorough deck.
5. **Validate and fill gaps.** Code checks source IDs, objective IDs, quote
   membership, card style, lengths, answer leakage, invented numeric claims and
   duplicates. Rejected objectives get targeted feedback and at most one retry.
   Underfilled/truncated batches shrink. If needed, another mapping pass seeks
   missed facts without repeating accepted cards. All work has bounded budgets.
6. **Review the result.** Inspect/edit/exclude cards and their source excerpts.
   The generated study map reports concepts covered, source sections represented,
   actual card repairs and mapped concepts omitted from the draft. It is a
   generation summary, not an accuracy score; later manual edits are not tracked
   in those original generation statistics.

### Generation controls

- **Flash**: direct drafting from up to four selected passages, with no concept-map
  request and no separate model audit/repair request. Keeps exact source excerpts,
  source IDs, format/style/length validation, numeric-claim and duplicate checks.
  These checks cannot prove factual correctness; review answers before saving.
  Uses a three-minute model-work budget, at most 12 drafting requests and three
  attempts per section. Two consecutive attempts adding no valid cards exhaust a
  section. Context/output limits can shrink the batch. Partial valid cards survive
  a later server failure or the budget expiring. Large requested decks may fall
  short; use Balanced/Thorough for broader coverage and refill work.
  Select **Flash + Focused answers + 10 cards** for a quicker starting point.
  Expanded explanations also work in Flash, with more tokens and processing time.
  No fixed completion time is promised: model speed and hardware still matter.

- **Thorough** (default): a broader source-selection cap, more follow-up work and
  a 15-minute total model-work budget. Mapping stops expanding after roughly 30%
  of that budget to reserve time for card writing and review.
- **Balanced**: the same planning/evidence/review stages with smaller coverage and
  follow-up caps and an eight-minute total model-work budget.
- **Expanded explanations** (default): direct answer followed by useful explanation,
  steps, conditions and supported examples; usually 35–110 words when justified,
  at most 1,400 characters / 180 words. Simple facts remain short.
- **Focused answers**: usually 15–55 words, retaining essential qualifications;
  at most 800 characters / 100 words. Cloze always returns just the missing phrase.

The browser shows real stage updates. Flash counts automatically checked cards;
Balanced/Thorough count model-reviewed cards. Flash results have their own summary
and do not claim a generated concept map, semantic review or repair.
**Stop generation** discards the unsaved run. The local server may finish its
current HTTP inference call (up to 150 seconds) before Aura can release the
processing slot. Aura starts no further stage after detecting the disconnect.
Generation that fails later can still return accepted cards and a warning. In
Balanced/Thorough, unreviewed cards never substitute for a failed review. Flash
explicitly skips that review and reports its automatic-check-only status. A stopped browser request
cannot receive partial cards.

Source matching proves an excerpt exists, not that every answer claim follows
from it. Semantic reviews use the same selected model and can share its mistakes.
The numeric and duplicate checks are conservative heuristics, not factual proof.
Ambiguous OCR, missing text, complex layouts and image-only scans still need
cleanup/OCR. No image input, embeddings service or second model is required.

Large documents are sampled, with explicit coverage limits shown in the review.
Upload a chapter at a time for fuller coverage. A small count (10–20) is a useful
starting point on slower hardware. Requested counts are pursued without padding:
model/source or time limits can still produce fewer cards. All inference stays
with the selected local model. A local failure never falls back to a cloud API.
These advanced controls apply to **Local AI · llama.cpp**; the other generators
retain their existing pipelines.

## Optional server configuration

Set these in the shell that starts Aura, if required:

```sh
export AURA_LLAMA_URL=http://127.0.0.1:9090
# Optional: a model ID/alias reported by your llama-server, not a guessed name.
export AURA_LLAMA_MODEL=your-model-alias
# Only if your llama-server requires an API key:
export AURA_LLAMA_API_KEY=your-existing-local-server-key
python app.py
```

The API key stays on the Python server and is not returned to the browser or
included in backups. User-entered addresses override the default server URL.
Only loopback HTTP addresses are accepted, and redirects and system HTTP proxies
are disabled for local inference.

If detection reports a loading model, wait and detect again. If the context is
too small, restart llama-server with at least `--ctx-size 8192`. A detected running
context below 4096 is rejected. Keep llama.cpp reasonably current for its
schema-constrained chat completion and chat-template support.

## Reference

[Official llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

Validation uses local HTTP server fixtures and DOM integration tests. It does not
benchmark, or establish accuracy for, a real Qwen or other model on your hardware.
