# Flashcard generation

Aura 2.2 improves the default offline engine and adds optional hosted generation.
The Python dependencies and native startup commands are unchanged. No GPU,
PyTorch, embedding service, vector database, NLP model download or Ollama
installation is required for the default engine or Cloud AI.

## Choose a mode

**Offline · lightweight** works immediately and keeps the document on your
computer. It uses deterministic language processing to recognize explicit
relationships and select a varied set of facts. It is useful for explanatory
notes, glossaries and simple English textbook statements. It does not have a
model's understanding of arbitrary prose.

**Cloud AI · API key** is the option for more varied phrasing and less structured
documents. The model runs at OpenAI, not on your laptop. Internet and an API key
with appropriate account access/billing are required. A ChatGPT conversation
does not supply an API key to the application.

**Local AI · Ollama** is retained for compatibility. It is optional and still
requires an installed model and sufficient local resources.

## What makes a useful card

- A specific question with one retrieval target.
- Enough context to answer it outside the original paragraph.
- A short answer that preserves qualifications, units and negation.
- Evidence that actually supports the answer.
- Coverage across relevant topics, without repeated or inverse duplicates.
- A question type supported by the document. A definition alone does not
  justify inventing an explanation of its mechanism.

Examples produced by the offline regression fixtures:

| Source | Question | Answer |
| --- | --- | --- |
| The len function returns the number of items in an object. | What does the len function return? | The number of items in an object. |
| The rate of diffusion increases because particles move faster at higher temperatures. | Why does the rate of diffusion increase? | Particles move faster at higher temperatures. |
| Mitosis is cell division, whereas meiosis is reduction division. | How do Mitosis and meiosis differ? | Mitosis is cell division, whereas meiosis is reduction division. |
| Normal human body temperature is 37 degrees Celsius. | Normal human body temperature is _____ degrees Celsius. | 37 |

These are narrow source-grounded examples, not a claim that all documents will
produce equivalent quality. No actual user textbook was provided for evaluation.

## Structure-first parsing

Before candidate generation, the offline engine detects complete Q&A pairs and
heading/explanation blocks. Authored questions and complete answers take
priority. Their consumed lines are removed from fallback sentence generation,
preventing duplicate or unrelated questions about the same answer. See
[document formats](document-formats.md) for supported layouts and overrides.

## Offline pipeline

1. Parse the document with existing bounded PDF, Word or PowerPoint readers.
   Preserve Word headings, recognized table column headers, and source locations.
2. Split text into candidate passages while retaining common abbreviations and
   decimals. Exclude obvious page furniture, contents entries and vague pronouns.
3. Recognize definitions, functions, explicit causes and comparisons, listed
   processes, Q&A pairs, glossary entries and simple table properties. Use
   meaningful cloze gaps for known concepts and quantities.
4. Rank candidates using lexical salience, optional topic matches, requested
   difficulty, section/position coverage, and diversity. Remove repeated prompts
   and highly overlapping candidates. Never add low-value cards just to reach a
   requested number.
5. Return cards with source excerpts. Open the browser's review screen before
   writing the deck to local storage.

This engine uses rules and lexical statistics, not a trained AI model. It has
limited English grammar coverage and deliberately skips unsupported structures.
Selecting Advanced changes priorities; it cannot manufacture supported reasoning
questions. A focus phrase changes ranking, not the set of facts in the document.

## Cloud setup on Ubuntu

Run the normal install commands once, inside `Aura_Cards`:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

In the terminal where you will start Aura, enter your own API key privately:

```bash
read -rsp 'OpenAI API key: ' OPENAI_API_KEY
printf '\n'
export OPENAI_API_KEY
.venv/bin/python app.py --port 5050
```

Open `http://127.0.0.1:5050`, choose **Cloud AI · API key**, confirm sending the
document text, then generate. Review and add the selected cards. To change the
model, set `AURA_CLOUD_MODEL` before starting the server. The default is
`gpt-4.1-mini`; choose a model supporting the Responses API and Structured
Outputs. Model access is account-dependent. There is no automatic `.env` loader.

On PowerShell, set `$env:OPENAI_API_KEY` in the server's environment before
running `.venv\Scripts\python.exe app.py --port 5050`. Keep the key out of shared
files, browser JavaScript, screenshots and version control.

Without a key or internet, choose **Offline · lightweight**. Configuring a key
never changes the default engine or automatically sends a document.

## Cloud pipeline and data handling

The server selects contextual passages, preserving complete paragraphs where
possible. At most 60,000 source characters are included. Larger documents are
sampled across positional sections, with a warning. A chapter at a time usually
provides better coverage than requesting 20 cards for an entire textbook.

One API call creates a draft with typed questions, concise answers, source IDs
and exact quotes. A second call reviews the surviving drafts against the same
source passages, removing or revising ambiguous, unsupported and overlapping
cards. Local validation runs after both calls. It checks quote membership,
source IDs, card shape, length, style and duplicates. The final review screen
lets the user inspect, edit or exclude each card.

Only the selected extracted text and card drafts are sent; Aura does not upload
the original document file. Source content is treated as untrusted data in the
prompt. The client uses a fixed HTTPS endpoint, disables redirects and system
proxies, and exposes no browsing or execution tools to the model. No API key or
document content is logged by Aura's error handler. The browser never receives
the API key. Both requests set `store: false` and do not create provider files,
vector stores or conversation objects.

**Cloud processing is not offline or zero-retention processing.** OpenAI's API
data controls and any applicable abuse-monitoring retention still apply. See
[OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).
Do not select Cloud AI if your document must remain entirely on your device.

There are at most two calls per generation, no automatic retries, and a
170-second total request budget. API charges may apply even if a later call,
validation check or browser connection fails. Failure does not silently fall
back to another engine. Source matching proves an excerpt exists; it does not
prove that the model's answer follows logically from it. The revision pass is
also model-generated and remains fallible.

## Advanced local llama.cpp generation

**Local AI · llama.cpp**, in Balanced/Thorough mode, uses a source-grounded study blueprint, coverage-aware
objective selection, drafting, editorial keep/revise/drop review, deterministic
validation and bounded gap-filling. Thorough/Balanced work budgets and
Expanded/Focused answer controls are available in the upload panel. Progress is
streamed to the browser, and the review shows the original generation's concept
coverage, omitted concepts and actual repairs. The model is selected from your
running llama-server; no Qwen-specific behavior or extra model is required.

**Flash** drafts directly from selected passages, retaining deterministic source,
format, numeric and duplicate checks. It skips concept mapping and separate model
review/repair, with a three-minute model-work budget. The result explicitly
reports these limits. Use Focused answers and a smaller card count for speed.

See [LLAMA_CPP.md](../LLAMA_CPP.md) for the full pipeline, work budgets, cancellation,
source limits, setup and the distinction between evidence checks and semantic
accuracy. The cloud two-call budget described above applies only to Cloud AI.

## Review workflow

- Expand a card to inspect or edit its question and answer.
- Open **Source** to compare against the extracted passage.
- Uncheck a card to exclude it, then select **Add cards**.
- Changing question/answer text removes that card's evidence attachment.
- **Back** returns to the upload options. Generating again is a new request.
- Drafts are held in browser memory until saved. Reloading loses unsaved drafts.

Existing card editing, decks, tags, categories, colors, study sessions, backups
and Pomodoro integration remain available.

## Limits and verification

Text-based English documents are the supported input. Scans, diagrams,
handwriting and image-only slides require OCR or another extraction workflow.
Equations, dense code, unusual PDF layouts and complex/merged tables can lose
structure during extraction. The card count is an upper bound, never a promise
that the document contains that many distinct facts.

The suite exercises real PDF/DOCX/PPTX extraction, curated question quality,
table headers, lists, source checking, duplicates, cloud consent and errors,
browser draft selection/editing, existing study behavior and timer behavior.
Cloud transport and model output are mocked: no API account was supplied, and
live hosted-model quality was not evaluated. Actual Ollama inference and
rendered browser layout are also unverified in this build environment.

Official integration references:
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), and
[data controls](https://developers.openai.com/api/docs/guides/your-data).
