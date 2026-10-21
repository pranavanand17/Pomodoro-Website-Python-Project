"""Recognize author-written cards before any question generation.

Stateful block parsing, not independent sentence matching. An answered question
or a topic owns its explanation until the next structural boundary. Consumed
lines never become a second, unrelated generated question.
"""
from dataclasses import dataclass, replace
import re

from .extraction import DocumentText

Q_LABEL = re.compile(r'^\s*(?:\d+[.)]\s*)?(?:question|ques|q)\s*(?:\d+\s*)?[.:)\-–]\s*', re.I)
A_LABEL = re.compile(r'^\s*(?:answer|ans|a)\s*(?:\d+\s*)?[.:)\-–]\s*', re.I)
TOPIC_LABEL = re.compile(r'^\s*(?:topic|heading|concept|term)\s*:\s*', re.I)
EXPLANATION_LABEL = re.compile(r'^\s*(?:explanation|definition|description)\s*:\s*', re.I)
NUMBER = re.compile(r'^\s*(?:\d+(?:\.\d+)*[.)]?|[IVX]+[.)])\s+', re.I)
BULLET = re.compile(r'^\s*(?:[•▪●*–-]|\d+[.)])\s+')
QUESTION_START = re.compile(r'^(?:what|why|how|when|where|who|which|whose|can|could|does|do|did|is|are|was|were|will|would|should)\b', re.I)
VERB = re.compile(r'\b(?:is|are|was|were|can|could|must|should|will|would|has|have|means|refers|allows|contains|includes|uses|provides|returns|stores|creates|requires|because|consists)\b', re.I)
SKIP_HEADING = re.compile(r'^(?:contents|table of contents|references|bibliography|answers?|questions?|exercises?|review questions|learning objectives|learning outcomes|chapter\s+\d+)\s*$', re.I)
PLURAL_EXCEPTIONS = {'analysis','class','process','access','status','physics','mathematics','economics','news','series','basis','thesis','hypothesis','osmosis','mitosis','meiosis'}


def flat(s):
    return re.sub(r'\s+', ' ', s).strip()


@dataclass
class Line:
    text: str
    unit: int
    index: int
    label: str
    kind: str
    heading: str
    columns: tuple


@dataclass
class Pair:
    question: str
    answer: str
    origin: str
    kind: str
    topic: str
    label: str
    excerpt: str
    order: int


def question_text(text):
    s = flat(text)
    labelled = Q_LABEL.match(s)
    if labelled:
        return s[labelled.end():], True
    s = NUMBER.sub('', s)
    if '?' in s and QUESTION_START.match(s):
        return s, False
    return None, False


def topic_title(row, mode='auto'):
    s = flat(row.text)
    if re.match(r'^(?:def\s|class\s.+:|return\b|\w+\s*=|```)',s):
        return None
    if not s or question_text(s)[0] is not None or A_LABEL.match(s) or EXPLANATION_LABEL.match(s):
        return None
    explicit = TOPIC_LABEL.match(s)
    if explicit:
        return s[explicit.end():].strip() or None
    if row.kind == 'heading':
        return s.rstrip(':') if len(s) <= 120 else None
    if row.kind in ('list', 'table') or BULLET.match(s):
        return None
    markdown = re.match(r'^#{1,6}\s+(.+?)\s*#*$', s)
    if markdown:
        return markdown[1].strip().rstrip(':')
    s = re.sub(r'^\*\*(.+)\*\*$', r'\1', s)
    s = NUMBER.sub('', s)
    if SKIP_HEADING.match(s):
        return s
    if not (2 <= len(s) <= 100 and len(s.split()) <= 10) or re.search(r'[.!?=|]', s) or VERB.search(s):
        return None
    if ':' in s and not s.endswith(':'):
        return None
    # Unformatted text needs a strong heading cue. Explicit Topics mode also
    # accepts lower-case, short headings. Avoid mistaking short answer fragments
    # such as "An ordered mutable collection" for a new heading.
    if re.match(r'^(?:a|an|the|it|this|they|to|for|in|with)\b', s, re.I):
        return None
    tokens = s.rstrip(':').split()
    significant = [w for w in tokens if w.lower() not in {'of','and','or','in','to','for','the','a','an','vs','with'}]
    title_case = significant and all(w[0].isupper() for w in significant)
    if mode == 'topics' or s.endswith(':') or len(tokens) == 1 or title_case:
        return s.rstrip(':')
    return None


def topic_prompt(topic, answer=''):
    """Conservative, grammatical prompts; never fabricate an inferred why/how."""
    title = NUMBER.sub('', flat(topic)).strip(': .')
    # Match sentence case used by the author in the body if available.
    match = re.search(r'(?<!\w)' + re.escape(title) + r'(?!\w)', answer, re.I)
    term = match[0] if match else title
    if title.endswith('?'):
        return title
    if re.match(r'^how to\s+', title, re.I):
        return 'How do you ' + title[7:].rstrip('.') + '?'
    if re.match(r'^(?:what|why|how|when|where)\b', title, re.I):
        # A heading such as "How inheritance works" is a usable topic cue;
        # adding a question mark would create an ungrammatical question.
        return title
    m = re.match(r'^(?:the\s+)?(advantages|disadvantages|benefits|limitations|features|properties|stages|steps|phases|types|uses|applications)\s+(of|in|for)\s+(.+)$', title, re.I)
    if m:
        return f'What are the {m[1].lower()} {m[2].lower()} {m[3]}?'
    m = re.match(r'^(?:the\s+)?(difference|differences) between (.+)$', title, re.I)
    if m:
        return f'What {"are" if m[1].lower()=="differences" else "is"} the {m[1].lower()} between {m[2]}?'
    m = re.match(r'^(.+?)\s+(?:vs\.?|versus)\s+(.+)$', title, re.I)
    if m:
        return f'How do {m[1]} and {m[2]} differ?'
    # Definition statements supply more reliable number agreement than a suffix.
    definition = re.match(re.escape(title) + r'\s+(is|are)\b', flat(answer), re.I)
    last = title.split()[-1].casefold() if title else ''
    plural = definition[1].lower() == 'are' if definition else last.endswith('s') and last not in PLURAL_EXCEPTIONS and not last.isupper()
    if title.isupper():
        plural = False
    if re.match(r'^(?:a|an|the)\b', term):
        term = term[0].lower()+term[1:]
    return f'What {"are" if plural else "is"} {term}?'


def detect(document, mode='auto'):
    """Return structured pairs, the unconsumed document, and honest diagnostics."""
    rows = [Line(line, u, j, unit.label, unit.kind, unit.heading, unit.columns)
            for u, unit in enumerate(document.units) for j, line in enumerate(unit.text.splitlines()) if line.strip()]
    used, pairs, warnings = set(), [], []
    oversized, unanswered = 0, 0

    def add(question, body, origin, indices, topic=''):
        nonlocal oversized
        answer = '\n'.join(body).strip()
        # Never silently cut off an answer, its exceptions, list items or code.
        excerpt = '\n'.join(rows[k].text for k in indices)
        if not answer or not question:
            return False
        if len(answer) > 2400 or len(excerpt) > 3000 or len(question) > 500:
            oversized += 1
            used.update(indices)
            return False
        if len(question) < 5:
            return False
        labels = list(dict.fromkeys(rows[k].label for k in indices))
        label = labels[0] if len(labels)==1 else labels[0]+' → '+labels[-1]
        kind = 'process' if re.search(r'\b(?:steps|stages|phases)\b', question, re.I) else 'fact' if origin=='qa' else 'definition'
        if origin=='topic' and kind=='process' and len(body)>=2 and all(re.match(r'^\d+[.)]\s+',v.strip()) for v in body):
            question=question.rstrip('?')+' in order?'
        pairs.append(Pair(question, answer, origin, kind, topic, label, excerpt, indices[0]))
        used.update(indices)
        return True

    # Tables with explicit headers are unambiguous; keep every cell together.
    for i, row in enumerate(rows):
        if row.kind != 'table' or not row.columns:
            continue
        headers = [flat(c).lower() for c in row.columns]
        cells = [c.strip() for c in row.text.split(' | ')]
        if len(cells) != len(headers):
            continue
        qcol = next((j for j,h in enumerate(headers) if h in {'question','q','prompt'}),None)
        acol = next((j for j,h in enumerate(headers) if h in {'answer','ans','a','response'}),None)
        tcol = next((j for j,h in enumerate(headers) if h in {'topic','term','concept'}),None)
        ecol = next((j for j,h in enumerate(headers) if h in {'explanation','definition','description','meaning'}),None)
        if mode!='topics' and qcol is not None and acol is not None:
            q=Q_LABEL.sub('',cells[qcol]);a=A_LABEL.sub('',cells[acol])
            add(q,[a],'qa',[i])
        elif mode!='qa' and tcol is not None and ecol is not None:
            add(topic_prompt(cells[tcol],cells[ecol]),[cells[ecol]],'topic',[i],cells[tcol])

    # Q&A blocks are parsed first, including an unlabelled answer after a
    # question. A question without an answer is consumed, not turned into fact.
    if mode != 'topics':
        i=0
        while i<len(rows):
            row=rows[i]
            q,explicit=question_text(row.text)
            if i in used or row.kind=='table' or q is None:
                i+=1;continue
            indices=[i];body=[];j=i+1
            # Same-line "Q: ...? A: ..." and "What ...? Explanation ...".
            inline=re.search(r'\s+(?:answer|ans|a)\s*[.:)\-–]\s*',q,re.I)
            if inline:
                body=[q[inline.end():]];q=q[:inline.start()].strip()
            elif '?' in q:
                front,tail=q.split('?',1);q=front+'?'
                if tail.strip():body=[A_LABEL.sub('',tail.strip())]
            # A label-only or wrapped question continues until its question
            # mark / explicit answer label. Stop at another labelled question.
            while explicit and not body and (not q or (QUESTION_START.match(q) and not re.search(r'[.!?]$',q))) and j<len(rows) and not A_LABEL.match(flat(rows[j].text)):
                nxt=rows[j]
                if Q_LABEL.match(flat(nxt.text)) or nxt.kind in ('heading','table') or topic_title(nxt,mode):break
                if len(q)+len(nxt.text)>500:break
                q=flat(q+' '+nxt.text);indices.append(j);j+=1
                if '?' in q:break
            while j<len(rows):
                nxt=rows[j];s=flat(nxt.text)
                if j in used or nxt.kind=='table' or question_text(s)[0] is not None:break
                if re.fullmatch(r'Slide \d+',nxt.label) and nxt.label!=row.label:break
                # First short answer may resemble a heading (e.g. "None").
                # Once answer content exists, a real heading starts a new block.
                marker=A_LABEL.match(s)
                title=topic_title(nxt,mode)
                if nxt.kind=='heading' and not marker:break
                if title and body and not marker:break
                if title and not body and j+1<len(rows) and question_text(rows[j+1].text)[0] is None and not marker:break
                value=A_LABEL.sub('',nxt.text).strip() if marker else nxt.text.rstrip()
                if nxt.kind=='list' and not BULLET.match(value):value='• '+value
                if value:body.append(value)
                indices.append(j);j+=1
            if body:
                add(q,body,'qa',indices,row.heading)
            else:
                unanswered+=1;used.update(indices)
            i=max(i+1,j)

    if mode != 'qa':
        i=0
        while i<len(rows):
            row=rows[i]
            if i in used or row.kind=='table' or question_text(row.text)[0] is not None:
                i+=1;continue
            title=topic_title(row,mode);inline_body=None
            # Inline glossary / topic definitions, including multiple following
            # explanation sentences and paragraphs.
            if title is None:
                m=re.match(r'^([^:!?=|]{2,100})\s*(?::|\s[–—]\s)\s+(.+)$',flat(row.text))
                if m and not VERB.search(m[1]) and len(m[1].split())<=10 and not A_LABEL.match(row.text) and not EXPLANATION_LABEL.match(row.text):
                    title=m[1].strip();inline_body=m[2]
            if not title or SKIP_HEADING.match(title):
                i+=1;continue
            body=[inline_body] if inline_body else [];indices=[i];j=i+1
            while j<len(rows):
                nxt=rows[j]
                if j in used or nxt.kind=='table' or question_text(nxt.text)[0] is not None:break
                if re.fullmatch(r'Slide \d+',nxt.label) and nxt.label!=row.label:break
                if topic_title(nxt,mode) is not None:break
                # Another inline term begins its own entry. Labelled
                # Explanation/Definition belongs to the current entry.
                if re.match(r'^[^:!?=|]{2,80}:\s+\S',flat(nxt.text)) and not EXPLANATION_LABEL.match(nxt.text) and not BULLET.match(nxt.text):break
                # Inline glossary definitions are usually complete entries. Do
                # not absorb a new, independently stated fact from the next
                # paragraph; pronoun-led continuations stay with their term.
                if inline_body and body and re.match(r'^(?:A|An|The)\s+.+?\s+(?:is|are|requires|provides|returns|contains|stores)\b',flat(nxt.text)):
                    break
                value=EXPLANATION_LABEL.sub('',nxt.text).rstrip()
                if nxt.kind=='list' and not BULLET.match(value):value='• '+value
                if value.strip():body.append(value)
                indices.append(j);j+=1
            if body:
                answer='\n'.join(body)
                # General document titles followed by many independent complete
                # definitions should remain prose; don't turn a whole chapter
                # into one gigantic "What is Chapter X?" card.
                starts = sum(bool(re.match(r'^[A-Za-z][\w -]{1,70}\s+(?:is|are)\s+',flat(v))) for v in body)
                generic = bool(re.search(r'\b(?:notes|overview|introduction|chapter|study guide|basics)\b',title,re.I))
                code_only=all(re.match(r'^(?:\w+\s*=|def\s|class\s|return\b|print\(|for\s)',v.strip()) for v in body)
                if not code_only and not (mode=='auto' and (generic or starts>=3)):
                    add(topic_prompt(title,answer),body,'topic',indices,title)
            i=max(i+1,j)
    # An orphan answer label is not a glossary term named "Ans".
    for i,row in enumerate(rows):
        if i not in used and A_LABEL.match(flat(row.text)):
            used.add(i)
    if oversized:warnings.append(f'{oversized} structured block(s) exceeded the card length limit and were skipped intact. Split long answers into smaller topics.')
    if unanswered:warnings.append(f'{unanswered} question(s) had no detected answer and were skipped.')
    consumed={(rows[i].unit,rows[i].index) for i in used}
    remaining=[]
    for u,unit in enumerate(document.units):
        text='\n'.join(line for j,line in enumerate(unit.text.splitlines()) if (u,j) not in consumed)
        if text.strip():remaining.append(replace(unit,text=text))
    return pairs,DocumentText(remaining,document.warnings),warnings
