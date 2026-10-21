"""Small, deterministic language-processing pipeline. No model or downloads.

Prefer a supported relation over a generic question. Rank candidates with
lexical salience, section coverage and novelty. Never pad a deck with filler.
This is intentionally an extractive baseline, not a semantic AI substitute.
"""
from collections import Counter
from dataclasses import dataclass, field
import math
import re

from .errors import UserError

STOP = set("a an the this that these those it its they their them is are was were be been being to of and or in on at for with from as by into can could may might should will would does do did not no use using used example examples document notes which what when where how why we you your our if else then than also such have has had some any each all more most only other same".split())
WORD = re.compile(r"[\w]+(?:[-'][\w]+)*", re.UNICODE)
PREDICATE = re.compile(r"\b(is|are|was|were|means|refers|consists|contains|includes|provides|allows|requires|returns|produces|stores|creates|causes|occurs|uses|used|has|have|can|will|must|should|because|while|whereas)\b", re.I)
JUNK = re.compile(r"^(?:page\s+\d+|copyright\b|all rights reserved\b|https?://|www\.|isbn\b|doi\b|table of contents$|contents$|references$|bibliography$|learning objectives$|learning outcomes$|chapter\s+\d+\s*$)", re.I)
VAGUE = re.compile(r"\b(?:what (?:do|does) (?:the )?(?:notes|source|passage) say|what is stated|explain the source statement|this (?:passage|statement|topic)|as described in (?:the )?(?:source|notes))\b", re.I)
PRONOUN = re.compile(r"^(?:it|its|they|their|these|those|this|that|he|she|we|you|there|which|such)\b", re.I)
KINDS = {"definition", "function", "cause", "comparison", "process", "fact", "cloze"}


def clean(text):
    return re.sub(r"\s+", " ", text).strip()


def words(text):
    return [w.casefold() for w in WORD.findall(text) if w.casefold() not in STOP and len(w) > 1]


def sentence_parts(text):
    """Retain decimals, common abbreviations and initials at sentence boundaries."""
    protected = re.sub(r"\b(?:e\.g|i\.e|Mr|Mrs|Ms|Dr|Prof|Fig|Eq|No|vs|etc)\.",
                       lambda m: m[0].replace('.', '\uE000'), text, flags=re.I)
    protected = re.sub(r"\b[A-Z]\.(?=\s+[A-Z])", lambda m: m[0].replace('.', '\uE000'), protected)
    return [p.replace('\uE000', '.') for p in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"“])", protected) if p.strip()]


def usable(text):
    return (12 <= len(text) <= 1400 and not JUNK.search(text)
            and not re.search(r"\.{3,}\s*\d+$", text)
            and not re.match(r"^(?:see|refer to) (?:figure|table|chapter|section)\b", text, re.I)
            and not re.match(r"^(?:in this (?:chapter|section)|after (?:reading|completing)|by the end of)\b", text, re.I)
            and len(re.findall(r"[A-Za-z]", text)) >= len(text) * .4)


def heading_line(text):
    return (2 <= len(text) <= 100 and len(text.split()) <= 12
            and not re.search(r"[.!?=|]", text) and not PREDICATE.search(text)
            and (':' not in text or text.endswith(':')))


def noun_subject(text):
    text = text.strip()
    return (2 <= len(text) <= 95 and 1 <= len(text.split()) <= 12
            and bool(words(text)) and not PRONOUN.search(text)
            and not re.search(r"[,;!?]|\b(?:is|are|was|were|means|refers|because|although|when|whereas|while|if|that|which)\b", text, re.I))


def lower_article(text):
    # Preserve proper names/acronyms; lower only a leading article.
    return re.sub(r"^(A|An|The)\b", lambda m: m[0].lower(), text.strip())


def answer_text(text):
    text = text.strip().rstrip('.;')
    if text and text[0].islower():
        text = text[0].upper() + text[1:]
    return text + '.' if text and not text.endswith(('?', '!', ':')) else text


@dataclass
class Passage:
    text: str
    label: str
    heading: str
    order: int
    kind: str = 'text'
    columns: tuple = ()
    raw: str = ''


@dataclass
class Candidate:
    question: str
    answer: str
    kind: str
    passage: Passage
    term: str = ''
    quality: float = 1.0
    tokens: set = field(default_factory=set)
    score: float = 0.0
    origin: str = 'generated'

    def card(self):
        return {"question": self.question, "answer": self.answer, "kind": self.kind, "origin": self.origin,
                "tags": list(dict.fromkeys([self.kind.title()] + ([self.passage.heading[:90]] if self.passage.heading else []))),
                "source": {"label": self.passage.label[:100], "excerpt": self.passage.text[:3000]}}


def passages(document):
    result, heading, seen = [], '', set()
    for unit in document.units:
        if getattr(unit, 'heading', ''):
            heading = unit.heading
        if getattr(unit, 'kind', '') == 'heading':
            heading = clean(unit.text)
            continue
        # Slide headings are local to their slide, not inherited from a prior slide.
        if re.fullmatch(r'Slide \d+', unit.label):
            heading = ''
        for raw in unit.text.splitlines():
            line = clean(re.sub(r"^\s*(?:[•▪●*–-]|\d+[.)])\s+", '', raw))
            if not line or JUNK.search(line) or re.search(r"\.{3,}\s*\d+$", line):
                continue
            if heading_line(line) and getattr(unit, 'kind', '') != 'table':
                heading = line.rstrip(':')
                continue
            for sentence in sentence_parts(line):
                sentence = clean(sentence)
                if not usable(sentence) or sentence.casefold() in seen:
                    continue
                seen.add(sentence.casefold())
                result.append(Passage(sentence, unit.label, heading, len(result),
                                      getattr(unit, 'kind', 'text'), getattr(unit, 'columns', ()), raw))
    return result


def _why(statement):
    m = re.match(r'^(.+?)\s+(is|are|was|were|can|will|must|should|has|have)\s+(.+)$', statement, re.I)
    if m and noun_subject(m[1]):
        if m[2].lower() in ('has','have'):
            return f'Why {"does" if m[2].lower()=="has" else "do"} {lower_article(m[1])} have {m[3]}?'
        return f'Why {m[2].lower()} {lower_article(m[1])} {m[3]}?'
    m = re.match(r'^(.+?)\s+(increases|decreases|expands|contracts|rises|falls|occurs|happens|changes|stops|fails)\b\s*(.*)$', statement, re.I)
    if m and noun_subject(m[1]):
        base = {'rises':'rise','decreases':'decrease','increases':'increase','changes':'change'}
        verb = base.get(m[2].lower(), m[2].lower()[:-1])
        return f"Why does {lower_article(m[1])} {verb}{(' ' + m[3]) if m[3] else ''}?"
    return None


def _relation(p):
    """One primary retrieval target per passage; never ask about a random word."""
    s = p.text.rstrip('.;')
    if re.match(r'^(?:Q|A|Ans|Question|Answer)\s*\d*\s*[.:)]', s, re.I) or s.endswith('?') or PRONOUN.search(s):
        return None
    def card(q, a, kind, term='', quality=1.0):
        return Candidate(q, answer_text(a), kind, p, term, quality)

    # Explicit contrasts retain BOTH clauses; do not infer a comparison from
    # unrelated sentences merely mentioning two terms.
    m = re.match(r'^(.+?)\s+(is|are)\s+(.+?)[,;]?\s+(?:whereas|while)\s+(.+?)\s+(is|are)\s+(.+)$', s, re.I)
    if m and noun_subject(m[1]) and noun_subject(m[4]):
        return card(f'How do {lower_article(m[1])} and {lower_article(m[4])} differ?', s, 'comparison', m[1], 1.3)
    m = re.match(r'^(?:The )?((?:stages|steps|phases) of .+?)\s+(?:are|include)\s+(.+)$', s, re.I)
    if m:
        return card(f'What are the {lower_article(m[1])}?', m[2], 'process', m[1], 1.25)
    m = re.match(r'^(.+?)\s+because\s+(.+)$', s, re.I)
    if m and (q := _why(m[1])) and len(m[2].split()) >= 3:
        return card(q, m[2], 'cause', m[1], 1.35)
    m = re.match(r'^(.+?)\s+(?:is|are)\s+caused by\s+(.+)$', s, re.I)
    if m and noun_subject(m[1]):
        return card(f'What causes {lower_article(m[1])}?', m[2], 'cause', m[1], 1.3)
    m = re.match(r'^(.+?)\s+(?:causes?|leads? to|results? in)\s+(.+)$', s, re.I)
    if m and noun_subject(m[1]):
        return card(f'What is a result of {lower_article(m[1])}?', m[2], 'cause', m[1], 1.2)

    # Tables retain column headers from DOCX/PPTX extraction.
    if p.kind == 'table' or ' | ' in s:
        cells = [c.strip() for c in s.split(' | ')]
        if 2 <= len(cells) <= 8 and noun_subject(cells[0]):
            headers = p.columns
            if len(cells) == 2 and (not headers or re.search(r'definition|meaning|description|function', headers[1], re.I)):
                if len(cells[1].split()) >= 2:
                    if headers and headers[1].casefold() == 'function':
                        return card(f'What does {lower_article(cells[0])} do?', cells[1], 'function', cells[0], 1.1)
                    return card(f'What is {lower_article(cells[0])}?', cells[1], 'definition', cells[0], 1.1)
            if headers and len(headers) == len(cells):
                # Single property per card; remaining properties are separate
                # candidates produced in build_candidates below.
                return None
        return None

    m = re.match(r'^([^:=]{2,80})\s*(?::|\s[–—]\s)\s+(.+)$', s)
    if m and noun_subject(m[1]) and len(m[2].split()) >= 2 and not m[1].lower().startswith(('example', 'note', 'warning', 'tip')):
        kind = 'process' if re.search(r'\b(?:steps|stages|phases)\b', m[1], re.I) else 'definition'
        q = f'What are the {lower_article(m[1])}?' if kind == 'process' else f'What is {lower_article(m[1])}?'
        return card(q, m[2], kind, m[1], 1.1)

    m = re.match(r'^(.+?)\s+(is|are|was|were)\s+(?:used to|designed to)\s+(.+)$', s, re.I)
    if m and noun_subject(m[1]):
        return card(f'What {m[2].lower()} {lower_article(m[1])} used to do?', m[3], 'function', m[1], 1.15)
    m = re.match(r'^(.+?)\s+(?:refers? to|means?|is defined as|are defined as)\s+(.+)$', s, re.I)
    if m and noun_subject(m[1]):
        return card(f'What does {lower_article(m[1])} mean?', m[2], 'definition', m[1], 1.25)
    m = re.match(r'^(.+?)\s+(is|are|was|were)\s+(.+)$', s, re.I)
    if m and noun_subject(m[1]):
        # Only noun-like definitions here. "Water is essential" is a property,
        # not a definition of water. Named places/dates get their own prompts.
        subj, verb, body = m[1], m[2].lower(), m[3]
        if re.match(r'^(?:a|an|the)\s+\S+', body, re.I) or (verb == 'are' and re.match(r'^[a-z]+s\s+(?:that|which|used|with|for)\b', body, re.I)):
            return card(f'What {"are" if verb in ("are", "were") else "is"} {lower_article(subj)}?', body, 'definition', subj, 1.2)
        if (loc := re.match(r'^(?:located|found) in\s+(.+)$', body, re.I)):
            return card(f'Where {verb} {lower_article(subj)} found?', loc[1], 'fact', subj, 1.1)
    m = re.match(r'^(.+?)\s+(iterates over|repeats)\s+(.+)$', s, re.I)
    if m and noun_subject(m[1]):
        stem = 'iterate over' if m[2].lower() == 'iterates over' else 'repeat'
        return card(f'What does {lower_article(m[1])} {stem}?', m[3], 'function', m[1], 1.1)
    verbs = r'returns|return|produces|produce|stores|store|contains|contain|requires|require|prevents|prevent|creates|create|measures|measure|converts|convert|transports|transport|carries|carry|protects|protect|absorbs|absorb|releases|release|provides|provide|sends|send|manages|manage|controls|control|removes|remove|uses|use|includes|include|represents|represent'
    for vm in re.finditer(rf'\s+({verbs})\s+', s, re.I):
        subj, verb, body = s[:vm.start()], vm[1].lower(), s[vm.end():]
        if not noun_subject(subj):
            continue
        if re.search(r'\band\s+(?:runs|returns|creates|provides|sends|manages|removes|stores|controls)\b', body, re.I):
            # A coordinated predicate is not a direct object of the first verb.
            return card(f'What does {lower_article(subj)} do?', verb + ' ' + body, 'function', subj, 1.0)
        base = {'carries':'carry','produces':'produce','requires':'require','creates':'create','measures':'measure','uses':'use','releases':'release','provides':'provide','manages':'manage','removes':'remove','includes':'include'}
        singular = verb.endswith('s')
        stem = base.get(verb, verb[:-1] if singular else verb)
        return card(f'What {"does" if singular else "do"} {lower_article(subj)} {stem}?', body, 'function', subj, 1.1)
    m = re.match(r'^(.+?)\s+(?:consists? of|is composed of|are composed of|is made up of|are made up of)\s+(.+)$', s, re.I)
    if m and noun_subject(m[1]):
        return card(f'What makes up {lower_article(m[1])}?', m[2], 'fact', m[1], 1.15)
    m = re.match(r'^(.+?)\s+(?:occurs?|happens?)\s+(when|during|at|in)\s+(.+)$', s, re.I)
    if m and noun_subject(m[1]):
        return card(f'When does {lower_article(m[1])} occur?', m[3], 'fact', m[1], 1.1)
    return None


def _cloze(p, candidate=None):
    s = p.text
    if len(s) > 320 or PRONOUN.search(s) or ' | ' in s or s.endswith('?'):
        return None
    # Blank a known concept, named quantity, date or acronym; never an arbitrary
    # high-frequency token such as "important" or "different".
    target = candidate.term if candidate and candidate.kind in ('definition', 'function', 'fact') else ''
    target = re.sub(r'^(?:A|An|The)\s+', '', target, flags=re.I)
    if not target:
        match = re.search(r'\b\d+(?:\.\d+)?\b', s)
        if match:
            target = match[0]
        else:
            match = re.search(r'\b[A-Z][A-Z0-9]{1,8}\b', s)
            target = match[0] if match else ''
    if not target or len(target.split()) > 8:
        return None
    pattern = re.compile(r'(?<!\w)' + re.escape(target) + r'(?!\w)', re.I)
    if len(pattern.findall(s)) != 1:
        return None
    question = pattern.sub('_____', s, count=1)
    if len(words(question.replace('_____', ''))) < 3:
        return None
    return Candidate(question, target, 'cloze', p, target, .72)


def sequence_candidates(document, offset):
    records = [(clean(line), unit.label, getattr(unit, 'kind', ''), getattr(unit, 'heading', ''))
               for unit in document.units for line in unit.text.splitlines() if line.strip()]
    result = []
    for i, (line, label, kind, heading) in enumerate(records):
        if not re.match(r'^(?:the\s+)?(?:steps|stages|phases)\b', line, re.I) or not (line.endswith(':') or kind == 'heading'):
            continue
        items, evidence, numbered = [], [line], True
        last_label = label
        for item, item_label, item_kind, _ in records[i+1:i+8]:
            numbered_item = bool(re.match(r'^\d+[.)]\s+', item))
            if not (numbered_item or item_kind == 'list' or re.match(r'^[•▪●*–-]\s+', item)):
                break
            value = re.sub(r'^(?:\d+[.)]|[•▪●*–-])\s+', '', item)
            if len(value) > 150:
                break
            items.append(value)
            evidence.append(item)
            numbered = numbered and numbered_item
            last_label = item_label
        if 2 <= len(items) <= 6:
            title = line.rstrip(':')
            p = Passage(' '.join(evidence), label + ' / ' + last_label, title, offset + i)
            q = f'What are the {lower_article(title)}' + (' in order?' if numbered else '?')
            answer = '\n'.join(f'{n}. {v}' for n, v in enumerate(items, 1)) if numbered else '\n'.join('• ' + v for v in items)
            result.append(Candidate(q, answer, 'process', p, title, 1.2))
    return result


def build_candidates(document, style='mixed', input_format='auto'):
    from .structures import detect
    pairs, remaining, notes = detect(document, input_format) if input_format != 'prose' else ([], document, [])
    ps = passages(remaining) if input_format in ('auto', 'prose') else []
    candidates = []
    for pair in pairs:
        p = Passage(pair.excerpt, pair.label, pair.topic, len(ps) + pair.order, 'structured')
        candidates.append(Candidate(pair.question, pair.answer, pair.kind, p, pair.topic, 3.5, origin=pair.origin))
    if style == 'cloze' and pairs:
        notes.append('Recognized Q&A and topic cards keep their original prompts. Fill-in-the-blank applies to unstructured passages.')
    if input_format in ('auto', 'prose') and style != 'cloze':
        candidates.extend(sequence_candidates(remaining, len(ps) + sum(len(u.text.splitlines()) for u in document.units)))
    for p in ps:
        candidate = _relation(p)
        if candidate and style != 'cloze':
            candidates.append(candidate)
        if p.kind == 'table' and p.columns:
            cells = [c.strip() for c in p.text.split(' | ')]
            if len(cells) == len(p.columns) and noun_subject(cells[0]) and not candidate and style != 'cloze':
                for h, value in zip(p.columns[1:], cells[1:]):
                    if value and len(h) <= 70:
                        candidates.append(Candidate(f'For {cells[0]}, what is the {h.lower()}?', answer_text(value), 'fact', p, cells[0], 1.0))
        if style == 'cloze' or (style == 'mixed' and not candidate):
            cloze = _cloze(p, candidate)
            if cloze:
                candidates.append(cloze)
    return candidates, notes


def similarity(a, b):
    return len(a & b) / max(1, len(a | b))


def choose(candidates, count, difficulty='mixed', focus=''):
    """Greedy relevance / novelty selection with section and card-type diversity."""
    if not candidates:
        return []
    df = Counter()
    for c in candidates:
        c.tokens = set(words(c.passage.text))
        df.update(c.tokens)
    focus_tokens = set(words(focus))
    for c in candidates:
        # Recurrent concepts carry document salience; IDF tempers generic terms.
        weight = sum(math.log1p(df[t]) * (math.log((1 + len(candidates)) / (1 + df[t])) + 1) for t in c.tokens)
        salience = weight / max(1, len(c.tokens))
        boost = .35 if difficulty == 'advanced' and c.kind in ('cause', 'comparison', 'process') else 0
        boost += .25 if difficulty == 'beginner' and c.kind in ('definition', 'fact', 'cloze') else 0
        topical = len(c.tokens & focus_tokens) / max(1, len(focus_tokens))
        c.score = c.quality + salience * .12 + boost + topical * 1.5
    # Keep bounded work even for many tiny table rows.
    pool = sorted(candidates, key=lambda c: (-c.score, c.passage.order))[:4000]
    selected, section_counts, type_counts, used_facts, seen_questions = [], Counter(), Counter(), set(), set()
    while pool and len(selected) < count:
        best, value = None, -math.inf
        for c in pool:
            qkey = clean(c.question).casefold()
            if qkey in seen_questions:
                continue
            # Multiple independent table properties may share an evidence row.
            fact_key = (c.passage.order, c.question if c.passage.kind == 'table' else '')
            if fact_key in used_facts:
                continue
            overlap = max((similarity(c.tokens, old.tokens) for old in selected), default=0)
            if overlap > .82 and c.passage.kind not in ('table', 'structured'):
                continue
            section = c.passage.heading or c.passage.label
            # A positional bucket prevents one repeated chapter heading from
            # hiding the final chapters in long PDFs.
            bucket = c.passage.order // max(1, (len(candidates) + 5) // 6)
            v = c.score - overlap * .65 - section_counts[section] * .18 - section_counts[('bucket', bucket)] * .08 - type_counts[c.kind] * .035
            if v > value:
                best, value = c, v
        if best is None:
            break
        pool.remove(best)
        selected.append(best)
        section_counts[best.passage.heading or best.passage.label] += 1
        section_counts[('bucket', best.passage.order // max(1, (len(candidates) + 5) // 6))] += 1
        type_counts[best.kind] += 1
        used_facts.add((best.passage.order, best.question if best.passage.kind == 'table' else ''))
        seen_questions.add(clean(best.question).casefold())
    return sorted(selected, key=lambda c: c.passage.order)


def generate_details(document, count=20, difficulty='mixed', style='mixed', focus='', input_format='auto'):
    candidates, notes = build_candidates(document, style, input_format)
    picked = choose(candidates, count, difficulty, focus)
    if not picked:
        detail = (' ' + ' '.join(notes)) if notes else ''
        raise UserError('No complete cards were found for this document format. Check the selected format and include an answer or explanation for each entry.' + detail, 422, 'no_cards')
    origins = Counter(c.origin for c in picked)
    detected = 'mixed' if len(origins) > 1 else {'qa': 'qa', 'topic': 'topics', 'generated': 'prose'}[next(iter(origins))]
    return [c.card() for c in picked], notes, {'detected_format': detected, 'structured_cards': origins['qa'] + origins['topic']}


def generate(document, count=20, difficulty='mixed', style='mixed', focus='', input_format='auto'):
    return generate_details(document, count, difficulty, style, focus, input_format)[0]
