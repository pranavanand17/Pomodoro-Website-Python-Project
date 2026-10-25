"""Source-preserving curriculum planning and deterministic local quality checks.

No model, embeddings or downloads. Model judgments are never treated as proof.
"""
from collections import Counter
from difflib import SequenceMatcher
import math
import re

from .smart import clean, words, KINDS, VAGUE, JUNK


def object_schema(properties):
    return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}


TEXT = {'type': 'string'}
CARD = object_schema({**{k: TEXT for k in ('objective_id', 'source_id', 'question', 'answer', 'quote')},
                      'kind': {'type': 'string', 'enum': sorted(KINDS)}})
PLAN_SCHEMA = object_schema({'objectives': {'type': 'array', 'items': object_schema({
    **{k: TEXT for k in ('source_id', 'topic', 'objective', 'quote')},
    'kind': {'type': 'string', 'enum': sorted(KINDS - {'cloze'})},
    'importance': {'type': 'integer', 'enum': [1, 2, 3]}})}})
CARD_SCHEMA = object_schema({'cards': {'type': 'array', 'items': CARD}})
REVIEW_SCHEMA = object_schema({'reviews': {'type': 'array', 'items': object_schema({
    'objective_id': TEXT, 'verdict': {'type': 'string', 'enum': ['keep', 'revise', 'drop']},
    'issue': {'type': 'string', 'enum': ['none', 'unsupported', 'incomplete', 'ambiguous', 'duplicate', 'wrong_type']},
    'card': CARD})}})


def source_windows(document, context):
    """Keep neighboring DOCX paragraphs/Q&A and table rows in their context."""
    size = 900 if context < 8192 else 2000 if context < 16384 else 3200
    sections = []
    for unit in document.units:
        lines = [line for line in unit.text.splitlines()
                 if not JUNK.search(clean(line)) and not re.search(r'\.{3,}\s*\d+$', line)]
        text = '\n'.join(lines).strip()
        if not text:
            continue
        heading = clean(getattr(unit, 'heading', ''))[:100]
        columns = list(getattr(unit, 'columns', ()))[:12]
        # Extractors expose each Word paragraph/table row as a unit. Isolating
        # them would separate a question from its answer or a heading from prose.
        group = ('paragraph', heading) if re.fullmatch(r'Paragraph \d+', unit.label) else None
        if getattr(unit, 'kind', '') == 'table':
            group = ('table', re.sub(r' row \d+$', '', unit.label), heading, tuple(columns))
        if group and sections and sections[-1]['group'] == group:
            section = sections[-1]
            offset = len(section['text']) + 1
            section['text'] += '\n' + text
            section['locations'].append((offset, len(section['text']), unit.label))
        else:
            sections.append({'group': group, 'text': text, 'heading': heading, 'columns': columns,
                             'locations': [(0, len(text), unit.label)]})
    result = []
    for section in sections:
        text = section['text']; start = 0
        while start < len(text):
            end = min(len(text), start + size)
            if end < len(text):
                boundaries = list(re.finditer(r'[.!?](?=\s)|\n', text[start + size // 2:end]))
                if boundaries:
                    end = start + size // 2 + boundaries[-1].end()
                # Do not leave a short explicit question at the end of a chunk
                # while its Answer begins in the next one.
                tail = list(re.finditer(r'(?im)^(?:Q(?:uestion)?\s*\d*|Topic)\s*[:.)–-]', text[start:end]))
                if tail:
                    last = start + tail[-1].start()
                    has_answer = re.search(r'(?im)^(?:A(?:ns(?:wer)?)?\s*\d*|Explanation)\s*[:.)–-]', text[last:end])
                    if not has_answer and last > start + size // 3:
                        end = last
            part = text[start:end].strip()
            if len(part) >= 12:
                labels = list(dict.fromkeys(label for left, right, label in section['locations'] if left < end and right > start))
                label = labels[0] if len(labels) == 1 else labels[0] + ' – ' + labels[-1]
                result.append({'id': f'S{len(result)+1}', 'text': part, 'label': label[:100],
                               'heading': section['heading'], 'columns': section['columns'], 'position': len(result)})
            if end == len(text):
                break
            overlap = text[max(start + 1, end - 180):end]
            boundary = re.search(r'[.!?]\s+|\n', overlap)
            start = end - len(overlap) + boundary.end() if boundary else end
    return result


def select_sources(sources, count, focus, depth):
    """BM25 focus ranking or positional strata, followed by content novelty."""
    limit = min(len(sources), 18 if depth == 'thorough' else 4 if depth == 'flash' else 10, max(3, math.ceil(count / 3)))
    if not limit:
        return []
    query = set(words(focus))
    tokens = [Counter(words(s['heading'] + ' ' + s['text'])) for s in sources]
    if query:
        average = sum(sum(t.values()) for t in tokens) / max(1, len(tokens))
        df = {q: sum(q in t for t in tokens) for q in query}
        scores = []
        for source, token in zip(sources, tokens):
            score = 0
            for q in query:
                tf = token[q]
                if tf:
                    idf = math.log(1 + (len(sources) - df[q] + .5) / (df[q] + .5))
                    score += idf * tf * 2.2 / (tf + 1.2 * (.25 + .75 * sum(token.values()) / max(1, average)))
                    if q in words(source['heading']):
                        score += idf
            scores.append(score)
        candidates = [i for i, score in enumerate(scores) if score > 0]
        if candidates:
            selected = []
            while candidates and len(selected) < limit:
                def rank(i):
                    novelty = max((jaccard(set(tokens[i]), set(tokens[j])) for j in selected), default=0)
                    return scores[i] * (1 - .45 * novelty), -i
                best = max(candidates, key=rank)
                selected.append(best); candidates.remove(best)
            return [sources[i] for i in sorted(selected)]
    # Each stratum contributes its densest usable passage. Avoid first-page bias.
    chosen = []
    for i in range(limit):
        bucket = range(i * len(sources) // limit, (i + 1) * len(sources) // limit)
        best = max(bucket, key=lambda j: (min(len(tokens[j]), 140), -j))
        chosen.append(sources[best])
    return chosen


def jaccard(left, right):
    return len(left & right) / max(1, len(left | right))


def valid_objectives(raw, sources, limit):
    by_id = {s['id']: s for s in sources}
    result = []
    for item in raw[:100]:
        if not isinstance(item, dict) or not all(isinstance(item.get(k), str) for k in ('source_id', 'topic', 'objective', 'quote', 'kind')):
            continue
        item = {**item, **{k: clean(item[k]) for k in ('topic', 'objective', 'quote')}}
        source = by_id.get(item['source_id'])
        if (not source or item['kind'] not in KINDS - {'cloze'} or not 3 <= len(item['topic']) <= 100
                or not 10 <= len(item['objective']) <= 240 or not 12 <= len(item['quote']) <= 2400
                or item['quote'] not in clean(source['text']) or type(item.get('importance')) is not int
                or item['importance'] not in (1, 2, 3)):
            continue
        if any(jaccard(set(words(item['objective'])), set(words(old['objective']))) > .8
               or (item['quote'].casefold() == old['quote'].casefold() and item['kind'] == old['kind']
                   and jaccard(set(words(item['objective'])), set(words(old['objective']))) > .45) for old in result):
            continue
        result.append(item)
        if len(result) >= limit:
            break
    return result


def valid_drafts(raw, sources, objectives, style, detail):
    """Shape/citation/association checks only; a separate model review follows."""
    by_source = {s['id']: s for s in sources}; by_objective = {o['id']: o for o in objectives}
    accepted, rejected = [], Counter()
    for card in raw[:100]:
        if not isinstance(card, dict) or not all(isinstance(card.get(k), str) for k in CARD['required']):
            rejected['malformed'] += 1; continue
        card = {**card, **{k: clean(card[k]) for k in ('question', 'quote')}, 'answer': card['answer'].strip()}
        q, a, quote = card['question'], card['answer'], card['quote']
        objective = by_objective.get(card['objective_id']); source = by_source.get(card['source_id'])
        if not objective or not source or objective['source_id'] != source['id']:
            rejected['objective_mismatch'] += 1; continue
        if not 12 <= len(quote) <= 2400 or quote not in clean(source['text']):
            rejected['invalid_evidence'] += 1; continue
        maximum, word_limit = (1400, 180) if detail == 'expanded' else (800, 100)
        if not 10 <= len(q) <= 280 or not 1 <= len(a) <= maximum or len(a.split()) > word_limit:
            rejected['length'] += 1; continue
        kind = card['kind']
        if (kind not in KINDS or VAGUE.search(q)
                or re.match(r'^(?:What|Why|How) (?:is|are|does|do) (?:it|this|that|they)\b', q, re.I)):
            rejected['ambiguous'] += 1; continue
        if kind == 'cloze':
            if q.count('_____') != 1 or len(a.split()) > 12 or clean(a).casefold() not in quote.casefold():
                rejected['wrong_type'] += 1; continue
        elif '_____' in q or not q.endswith('?'):
            rejected['wrong_type'] += 1; continue
        if (style == 'qa' and kind == 'cloze') or (style == 'cloze' and kind != 'cloze'):
            rejected['wrong_type'] += 1; continue
        accepted.append({**card, 'topic': objective['topic'], 'importance': objective['importance'],
                         'source': {'label': source['label'], 'excerpt': quote}})
    return accepted, rejected


def quality_issue(card):
    """Conservative measurable defects; semantic entailment remains model-reviewed."""
    q, a, quote = card['question'], card['answer'], card['quote']
    # List ordinals are formatting, not facts. Reject invented numeric claims.
    content = re.sub(r'(?m)^\s*\d+[.)]\s+', '', a)
    numbers = lambda s: set(re.findall(r'(?<![\w])[-+]?\d+(?:[.,]\d+)*(?:%|\b)', s))
    if numbers(content) - numbers(quote):
        return 'unsupported_numbers'
    if q.count('?') > 1:
        return 'compound_question'
    if card['kind'] != 'cloze' and len(words(a)) >= 4:
        # Flag a complete verbatim answer in the question, not shared concept names.
        if clean(a).rstrip('.').casefold() in q.casefold():
            return 'answer_leakage'
    return ''


def duplicate(card, accepted):
    qt = set(words(card['question'])); at = set(words(card['answer']))
    def markers(c):
        text = c['question'] + ' ' + c['answer']
        return (set(re.findall(r'\b\d+(?:[.,]\d+)*\b', text)),
                set(re.findall(r'\b(?:not|never|except|without|increases|decreases|positive|negative)\b', text.casefold())))
    for old in accepted:
        if card['objective_id'] == old['objective_id']:
            return True
        if clean(card['question']).casefold() == clean(old['question']).casefold():
            return True
        if markers(card) != markers(old):
            continue
        oq = set(words(old['question'])); oa = set(words(old['answer']))
        if (clean(card['answer']).casefold() == clean(old['answer']).casefold()
                or (SequenceMatcher(None, card['question'].casefold(), old['question'].casefold()).ratio() > .9
                    and jaccard(at, oa) > .7)
                or (jaccard(at, oa) > .86 and jaccard(qt, oq) > .65)):
            return True
    return False


def choose_objectives(objectives, accepted, attempts, difficulty, limit, source_id=None):
    covered = {c['objective_id'] for c in accepted}
    source_counts = Counter(c['source_id'] for c in accepted)
    type_counts = Counter(c['kind'] for c in accepted)
    remaining = [o for o in objectives if o['id'] not in covered and attempts[o['id']] < 2
                 and (not source_id or o['source_id'] == source_id)]
    def rank(o):
        advanced = o['kind'] in ('cause', 'comparison', 'process')
        match = advanced if difficulty == 'advanced' else o['kind'] in ('definition', 'fact') if difficulty == 'beginner' else True
        return (attempts[o['id']] == 0, 1 / (1 + source_counts[o['source_id']]),
                o['importance'] + int(match), 1 / (1 + type_counts[o['kind']]), -objectives.index(o))
    return sorted(remaining, key=rank, reverse=True)[:limit]
