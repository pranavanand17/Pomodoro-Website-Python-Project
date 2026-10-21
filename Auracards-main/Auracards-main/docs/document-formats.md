# Document formats

Use **Offline · lightweight**. **Card options → Document format** defaults to
**Auto-detect** and recognizes explicit card structure before generating prompts
from prose. These features work without an API key, local model or internet.

## Questions and answers

The question becomes the front; its complete answer becomes the back. Aura
removes structural labels and numbering, but does not paraphrase authored Q&A.

```text
Q1: What is a Python list?
Ans: An ordered, mutable collection.
It can contain duplicate elements.

Q2: What does len return?
Answer: The number of items in an object.
```

Supported label forms include `Q:`, `Q1:`, `Q1.`, `Question 1:`, `A:`, `Ans:` and
`Answer:`. Labels may be on their own lines. Inline pairs also work:

```text
Q: What is a tuple? A: An immutable sequence.
```

Questions ending in `?` can be followed by unlabelled answers:

```text
1. What is a dictionary?
A mapping from unique keys to values.

2. What is a set?
A collection of distinct elements.
```

Multiline answers, bullets and code stay together. A question without a detected
answer is skipped rather than matched with the next question's answer. Short
explicit answers such as `None`, `0` and `Yes` are retained.

Word and PowerPoint tables with **Question / Answer** or **Prompt / Response**
column headers are supported. PDF table layout may not survive text extraction;
line-based pairs are more reliable in PDFs.

## Topics and explanations

```text
Topic: Inheritance
Explanation: A class can reuse behavior from a base class.
It can override inherited methods.

Topic: Python lists
Explanation: Lists are ordered, mutable collections.
They allow duplicate elements.
```

These become **What is Inheritance?** and **What are Python lists?** with the
corresponding explanation on the back. A topic does not borrow the explanation
of a following topic.

Other supported formats:

- Word heading styles or a standalone bold heading, followed by paragraphs.
- Short standalone headings such as `Inheritance` or `Exception Handling`.
- Markdown headings such as `## Inheritance`, or `**Inheritance**`.
- `Term: explanation` glossary entries.
- Tables with **Topic / Explanation**, **Term / Definition**, or equivalent
  recognized headers.
- Headings such as **Advantages of functions**, **Lists vs tuples**, or **Steps
  of the review process** receive appropriate plural, comparison or sequence
  prompts. Numbered steps retain their order.

## Format overrides

| Setting | Behavior |
| --- | --- |
| Auto-detect | Prefer complete Q&A/topic blocks; use the existing prose generator for unconsumed text. |
| Questions & answers | Only return detected Q&A pairs. Do not invent questions from other text. |
| Topics & explanations | Only return detected topic sections; allow short lower-case headings. |
| General prose | Use sentence-based generation without topic/Q&A block detection. |

These controls apply to Offline generation. AI modes keep their existing
provider requirements and use Auto-detect in their prompts; exact preservation
of authored pairs is an offline-parser feature.

Authored Q&A/topic cards retain their prompts even when Fill in the blank was
selected; a generation note explains this. Cloze conversion applies to remaining
prose, not to a card the author already wrote.

## Practical limits

- The parser uses document structure and explicit boundaries; it does not infer
  arbitrary meaning. Prefer labels or heading styles for ambiguous layouts.
- Keep one question or topic per block. Separate questions and answers in
  distant sections or a detached answer key are not matched automatically.
- Answers over 2,400 characters, questions over 500, or source blocks over 3,000
  are skipped with a note. Answers are never silently truncated. Split long
  explanations into smaller topics.
- General document titles such as “Python Study Notes” are not treated as a
  single topic in Auto-detect. Scanned documents still require OCR first.
- Plain headings that resemble short answers can be ambiguous. Add `Answer:`
  or `Topic:` to disambiguate them.
- Indentation is preserved where available in extracted text, but PDF layout
  does not reliably preserve code formatting.
- Review the draft cards before saving. Source references let you check which
  text was paired; they do not prove the author's facts are correct.

Try the included **Structured_Python_Notes.docx**, **.pdf**, and **.pptx** files.

