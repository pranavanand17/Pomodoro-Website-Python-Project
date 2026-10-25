# Changelog

## Flash local generation

- Add a remembered Flash mode alongside Balanced and Thorough in Upload notes.
- Draft directly from selected passages with source/style/numeric/duplicate checks.
- Skip model mapping and separate review in Flash, explicitly reported in results.
- Bound Flash to three minutes of model work, with partial-result recovery.
- Preserve existing advanced modes, answer-detail choices and local-only inference.

## 2.2.0

- Parse complete Q&A and topic/explanation blocks before sentence generation.
- Preserve existing questions, multiline answers, lists and code indentation.
- Recognize Q/A/Ans labels, numbered questions, bare question lines, inline pairs,
  Word headings and bold headings, Markdown headings, and Q&A/topic tables.
- Keep answers within their question/topic boundary; exclude unanswered questions.
- Prioritize authored cards and prevent their answers becoming duplicate cards.
- Add Auto-detect, Questions & answers, Topics & explanations and General prose
  document formats for offline generation.
- Preserve complete supported blocks; skip oversized blocks with a diagnostic.
- Add source-format badges to card review and metadata to the generation API.
- Include structured Python example documents and GitHub Actions tests.

## 2.1.0

- Improve deterministic offline prompts and candidate ranking.
- Add optional OpenAI draft-and-review generation and per-upload cloud consent.
- Add editable card review before saving a deck.

