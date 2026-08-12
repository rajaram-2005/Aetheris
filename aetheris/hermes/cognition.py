"""Aetheris Hermes — the offline cognition cascade.

This is the perception + grounding front-end of the Hermes agent. It is a
dependency-free port and consolidation of the Aurion **C7 cascade** (previously
stranded in a separate browser app) into the Python runtime, so a single process
owns the whole thought pipeline.

Stages
------
1. ``perceive``  — tokenize, detect language/script, extract entities, sentiment,
   and keywords. (C7 SENSE)
2. ``classify``  — hybrid intent classification: cue regexes for precision plus
   TF-IDF cosine against intent prototypes for coverage. (C7 ALIGN)
3. ``deliberate``— exact symbolic computation: a recursive-descent arithmetic
   parser, unit conversions, percentages, quadratics, and CSV statistics.
   (C7 THINK)
4. ``ground``    — BM25 retrieval over the built-in knowledge base. (C7 RECALL)
5. ``polish``    — safety gating, vendor-voice stripping, honesty enforcement.
   (C7 REFINE)

Everything here is deterministic and runs with no network and no model weights,
which is what lets the unified app work fully offline.
"""

from __future__ import annotations

import math
import re
import statistics
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

from .knowledge import KNOWLEDGE_BASE, KnowledgeArticle

# --- Lexicons -----------------------------------------------------------------

STOPWORDS: frozenset[str] = frozenset(
    """a an the is are was were be been being have has had do does did will would
    shall should may might can could to of in for on with at by from as into
    through during before after above below between out off over under again
    further then once here there when where why how all each every both few more
    most other some such no nor not only own same so than too very just because
    but and or if while about against up down it its i me my we our you your he
    him his she her they them their this that these those what which who whom am
    t s re ve ll d m don doesn didn isn aren wasn weren won wouldn shouldn couldn
    haven hasn hadn let much also like get got know think want make go see come
    take give say tell use find ask work seem feel try leave call need become
    keep begin show hear play run move live believe bring happen write provide
    sit stand lose pay meet include continue set learn change lead understand
    watch follow stop create speak read allow add spend grow open walk win offer
    remember love consider appear buy wait serve die send expect build stay fall
    cut reach remain suggest raise pass sell require report decide pull develop
    eat put plan check carry please able really well back still way even new old
    now today tomorrow yesterday already always never sometimes however although
    though yet since until unless whether therefore moreover furthermore
    nevertheless meanwhile otherwise instead besides anyway anyhow indeed perhaps
    maybe certainly surely exactly absolutely actually basically generally
    honestly simply totally usually""".split()
)

_POSITIVE = frozenset(
    """good great excellent amazing wonderful fantastic awesome love loved loving
    happy happiness joy joyful beautiful brilliant perfect best better nice kind
    kindness helpful grateful thankful thanks thank pleased delighted exciting
    excited fun enjoy enjoyed enjoying impressive magnificent superb outstanding
    remarkable splendid terrific fabulous marvelous glorious stellar incredible
    phenomenal spectacular breathtaking stunning charming elegant graceful
    radiant vibrant lively energetic enthusiastic passionate creative innovative
    smart intelligent wise clever genius talented skilled accomplished successful
    victory win won triumph celebrate celebration hope hopeful optimistic
    positive encouraging inspiring inspired motivating motivated empowered
    confident proud satisfied content peaceful calm serene warm warmth
    comfortable comfort safe secure trust trusted reliable accha badhiya sundar
    shandar""".split()
)

_NEGATIVE = frozenset(
    """bad terrible awful horrible dreadful disgusting hate hated hating sad
    sadness unhappy miserable depressed depressing grief sorrow pain painful
    suffer suffering angry anger furious rage annoyed annoying frustrated
    frustrating disappointed disappointing upsetting disturbing worst worse poor
    poverty broken failure failed fail lose lost loser defeat disaster
    catastrophe tragedy tragic cruel cruelty evil wicked sinister malicious toxic
    dangerous danger risk risky threat threatening fear fearful scared terrified
    frightened anxious anxiety worried worry nervous stress stressed overwhelmed
    exhausted tired boring bored dull useless worthless hopeless desperate lonely
    alone abandoned rejected ignored neglected mistreated abused confused
    confusing difficult impossible problem trouble struggle nahi bura kharab
    ganda""".split()
)

_NEGATORS = frozenset({"not", "n't", "no", "never", "neither", "nor", "hardly", "barely", "scarcely"})

_SUFFIXES = (
    "ation", "ness", "ment", "ting", "ling", "ally", "ible", "able", "ious",
    "eous", "ful", "less", "ive", "ize", "ise", "ify", "ing", "ous", "ity",
    "ion", "ent", "ant", "est", "ish", "ers", "ies", "ed", "er", "ly", "al",
    "es", "s",
)

_TOKEN_RE = re.compile(r"[\w\u0900-\u097F\u0C00-\u0C7F\u0B80-\u0BFF]+")


def stem(word: str) -> str:
    """A Porter-lite stemmer: strip one common suffix, keeping a 2+ char root."""
    w = word.lower()
    if len(w) < 3:
        return w
    for suffix in _SUFFIXES:
        if w.endswith(suffix) and len(w) - len(suffix) >= 2:
            return w[: -len(suffix)]
    return w


# --- Stage 1: perceive --------------------------------------------------------

@dataclass(frozen=True)
class Token:
    raw: str
    normalized: str
    is_stopword: bool
    stem: str


@dataclass(frozen=True)
class Entity:
    type: str
    value: str
    start: int
    end: int


@dataclass
class Perception:
    """Output of the perceive stage (C7 SENSE)."""

    text: str
    tokens: list[Token] = field(default_factory=list)
    language: str = "en"
    script: str = "latin"
    entities: list[Entity] = field(default_factory=list)
    sentiment: float = 0.0
    keywords: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "language": self.language,
            "script": self.script,
            "token_count": len(self.tokens),
            "tokens": [t.normalized for t in self.tokens[:40]],
            "entities": [
                {"type": e.type, "value": e.value, "start": e.start, "end": e.end}
                for e in self.entities[:20]
            ],
            "sentiment": self.sentiment,
            "keywords": self.keywords,
        }


_LANG_CUES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("hi", "latin-hi", ("kya", "hai", "hain", "nahi", "nahin", "haan", "bhai", "yaar", "accha", "theek", "kaise")),
    ("te", "latin-te", ("ela", "unnaru", "enti", "ledu", "avunu", "meeru", "nuvvu", "chestunnaru")),
    ("ta", "latin-ta", ("vanakkam", "nandri", "amma", "appa", "enna", "epdi", "irukinga")),
    ("es", "latin", ("hola", "como", "estas", "gracias", "por favor", "pero", "tambien", "bueno")),
    ("fr", "latin", ("bonjour", "salut", "merci", "oui", "comment", "allez", "tres", "aussi")),
    ("de", "latin", ("hallo", "danke", "bitte", "nein", "wie", "sehr", "auch", "nicht")),
)

_ENTITY_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("email", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    ("url", re.compile(r"https?://\S+")),
    (
        "money",
        re.compile(
            r"(?:₹|\$|€|£|¥)\s*\d+(?:,\d{3})*(?:\.\d+)?"
            r"|\d+(?:,\d{3})*(?:\.\d+)?\s*(?:rupees?|dollars?|euros?|pounds?|yen|inr|usd|eur|gbp)",
            re.I,
        ),
    ),
    (
        "date",
        re.compile(
            r"\b(?:\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}"
            r"|\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}"
            r"|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?"
            r"|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+\d{4})?)\b",
            re.I,
        ),
    ),
    ("phone", re.compile(r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")),
    ("number", re.compile(r"\b\d+(?:\.\d+)?(?:\s*(?:billion|million|thousand|lakh|crore))?\b", re.I)),
    ("proper_noun", re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b")),
)

_SENTENCE_START_WORDS = frozenset(
    {"I", "The", "A", "An", "This", "That", "What", "How", "When", "Where", "Why", "Who"}
)


def detect_language(text: str) -> tuple[str, str]:
    """Return ``(language, script)`` from Unicode ranges then Latin word cues."""
    if re.search(r"[\u0900-\u097F]", text):
        return "hi", "devanagari"
    if re.search(r"[\u0C00-\u0C7F]", text):
        return "te", "telugu"
    if re.search(r"[\u0B80-\u0BFF]", text):
        return "ta", "tamil"

    lowered = text.lower()
    words = set(re.findall(r"[a-z]+", lowered))
    for lang, script, cues in _LANG_CUES:
        for cue in cues:
            if (" " in cue and cue in lowered) or cue in words:
                return lang, script
    return "en", "latin"


def _extract_entities(text: str) -> list[Entity]:
    found: list[Entity] = []
    for kind, pattern in _ENTITY_PATTERNS:
        for match in pattern.finditer(text):
            value = match.group(0)
            if kind == "number" and len(value) < 2:
                continue
            if kind == "proper_noun":
                pos = match.start()
                if pos == 0 or re.search(r"[.!?]\s+$", text[max(0, pos - 2) : pos]):
                    continue
                if value in _SENTENCE_START_WORDS:
                    continue
            found.append(Entity(type=kind, value=value, start=match.start(), end=match.end()))
    return found


def _sentiment(text: str) -> float:
    words = text.lower().split()
    positive = negative = 0
    negate = False
    for raw in words:
        word = re.sub(r"[^a-z']", "", raw)
        if word in _NEGATORS:
            negate = True
            continue
        if word in _POSITIVE:
            if negate:
                negative += 1
                negate = False
            else:
                positive += 1
        elif word in _NEGATIVE:
            if negate:
                positive += 1
                negate = False
            else:
                negative += 1
        if raw and raw[-1] in ".!?":
            negate = False
    total = positive + negative
    if not total:
        return 0.0
    return round((positive - negative) / total, 2)


def perceive(text: str) -> Perception:
    """Stage 1 — tokenize, detect language, extract entities/sentiment/keywords."""
    language, script = detect_language(text)
    tokens = [
        Token(
            raw=raw,
            normalized=raw.lower(),
            is_stopword=raw.lower() in STOPWORDS,
            stem=stem(raw.lower()),
        )
        for raw in _TOKEN_RE.findall(text)
    ]

    frequencies: dict[str, int] = {}
    for token in tokens:
        if token.is_stopword or len(token.normalized) < 3:
            continue
        frequencies[token.normalized] = frequencies.get(token.normalized, 0) + 1
    keywords = [
        word for word, _ in sorted(frequencies.items(), key=lambda kv: (-kv[1], kv[0]))[:8]
    ]

    return Perception(
        text=text,
        tokens=tokens,
        language=language,
        script=script,
        entities=_extract_entities(text),
        sentiment=_sentiment(text),
        keywords=keywords,
    )


# --- Stage 2: classify --------------------------------------------------------

INTENTS: tuple[str, ...] = (
    "greet", "identity", "capability",
    "write_email", "write_letter", "write_blog", "write_social", "write_ad",
    "write_poem", "write_story", "rewrite", "summarize",
    "code_gen", "code_explain", "code_debug",
    "translate", "math", "explain", "howto", "compare",
    "quiz", "flashcard", "study", "eli5",
    "resume", "interview", "analyze", "brainstorm", "plan",
    "image", "diagram", "palette",
    "recipe", "travel", "health", "convert", "datetime",
    "joke", "file_qa", "chat",
)

INTENT_PROTOTYPES: dict[str, tuple[str, ...]] = {
    "greet": ("hello", "hi there", "hey", "good morning", "good evening", "namaste", "hola", "greetings"),
    "identity": ("who are you", "what are you", "your name", "introduce yourself", "tell me about yourself", "are you chatgpt"),
    "capability": ("what can you do", "your capabilities", "what are your features", "what do you know"),
    "write_email": ("write an email", "draft email", "compose email", "professional email", "business email"),
    "write_letter": ("write a letter", "formal letter", "cover letter", "resignation letter", "complaint letter"),
    "write_blog": ("write a blog", "blog post", "write article", "article about", "write content"),
    "write_social": ("write a tweet", "social media post", "instagram caption", "linkedin post", "twitter thread"),
    "write_ad": ("write an ad", "advertisement copy", "ad copy", "marketing copy", "sales copy"),
    "write_poem": ("write a poem", "compose poem", "poetry", "haiku", "write a sonnet", "rhyme about"),
    "write_story": ("write a story", "tell a story", "short story", "fiction", "narrative"),
    "rewrite": ("rewrite", "rephrase", "reword", "paraphrase", "improve this", "edit this text"),
    "summarize": ("summarize", "summary", "tldr", "key points", "condense this", "short version"),
    "code_gen": ("write code", "code for", "program to", "function that", "script to", "implement", "write a function", "generate code"),
    "code_explain": ("explain this code", "what does this code do", "code explanation", "walk me through", "code review"),
    "code_debug": ("debug", "fix this code", "error in", "not working", "bug in", "troubleshoot", "syntax error"),
    "translate": ("translate", "translation", "in hindi", "in telugu", "in spanish", "in french", "how do you say", "meaning in"),
    "math": ("calculate", "compute", "solve", "find the value", "evaluate", "equation", "formula", "algebra"),
    "explain": ("explain", "how does", "tell me about", "describe", "define", "meaning of", "elaborate on"),
    "howto": ("how to", "how do i", "how can i", "steps to", "guide me", "tutorial", "instructions for"),
    "compare": ("compare", "difference between", "versus", "which is better", "pros and cons", "contrast"),
    "quiz": ("quiz me", "test me", "questions about", "ask me questions", "practice questions", "multiple choice"),
    "flashcard": ("flashcard", "flash card", "make cards", "study cards", "revision cards"),
    "study": ("study plan", "study guide", "study tips", "prepare for exam", "exam preparation"),
    "eli5": ("eli5", "explain like i am five", "explain in simple terms", "for beginners", "in layman terms"),
    "resume": ("resume", "curriculum vitae", "build resume", "create cv", "resume template"),
    "interview": ("interview", "interview questions", "job interview", "mock interview", "interview prep"),
    "analyze": ("analyze", "analysis", "examine", "evaluate", "assess", "breakdown", "insights"),
    "brainstorm": ("brainstorm", "ideas for", "give me ideas", "creative ideas", "suggestions", "come up with"),
    "plan": ("plan", "planning", "schedule", "roadmap", "timeline", "project plan", "strategy"),
    "image": ("draw", "generate image", "create image", "visualize", "illustration", "poster", "artwork"),
    "diagram": ("diagram", "flowchart", "chart", "graph", "flow diagram", "process flow"),
    "palette": ("color palette", "colour palette", "colors for", "theme colors", "generate palette"),
    "recipe": ("recipe", "cook", "cooking", "how to make", "ingredients", "preparation"),
    "travel": ("travel", "visit", "tourist", "places to visit", "things to do", "trip"),
    "health": ("health", "symptoms", "medicine", "diet", "nutrition", "exercise", "workout", "fitness"),
    "convert": ("convert", "conversion", "how many", "celsius to fahrenheit", "km to miles", "unit conversion"),
    "datetime": ("time", "date", "today", "what day", "current time", "day of the week", "timezone"),
    "joke": ("joke", "funny", "make me laugh", "humor", "tell me a joke", "comedy"),
    "file_qa": ("file", "document", "attached", "this file", "read this", "based on the file"),
    "chat": ("chat", "talk", "conversation", "tell me something", "what do you think"),
}

_CUE_PATTERNS: tuple[tuple[str, re.Pattern[str], float], ...] = (
    ("greet", re.compile(r"^(hi|hello|hey|yo|sup|howdy|namaste|hola|good\s+(morning|afternoon|evening|night))\b", re.I), 0.95),
    ("identity", re.compile(r"(who|what)\s+(are|r)\s+(you|u)|your\s+name|are\s+you\s+(chatgpt|gpt|ai|claude|gemini)", re.I), 0.90),
    ("capability", re.compile(r"what\s+can\s+you\s+do|capabilities|what\s+do\s+you\s+know", re.I), 0.85),
    ("math", re.compile(r"(?:calculate|compute|solve|evaluate)\s+[\d(]|[\d+\-*/^()]+\s*=\s*\?|\b\d+\s*[+\-*/^%]\s*\d+", re.I), 0.90),
    ("translate", re.compile(r"translate|in\s+(?:hindi|telugu|spanish|french|german|tamil)|how\s+(?:do\s+you\s+)?say|meaning\s+in", re.I), 0.85),
    # Allow qualifiers between the verb and the noun ("write a *small python*
    # function"), otherwise such phrasings fall through to a writing intent.
    ("code_gen", re.compile(r"(?:write|create|build|make|generate|implement)\s+(?:an?\s+)?(?:\w+[\s-]+){0,3}?(?:function|class|method|program|script|code|snippet|algorithm|api|endpoint|component|module|app|website|server|parser|query)\b", re.I), 0.88),
    # An explicit language mention alongside a build verb is a strong signal.
    ("code_gen", re.compile(r"\b(?:in|using|with)\s+(?:python|javascript|typescript|java|c\+\+|golang|go|rust|sql|bash)\b.*\b(?:function|script|program|code|class)\b|\b(?:python|javascript|typescript|java|c\+\+|golang|rust|sql|bash)\s+(?:function|script|program|code|class|snippet)\b", re.I), 0.88),
    ("code_explain", re.compile(r"explain\s+(?:this|the|that)\s+(?:code|function|program|script|snippet)", re.I), 0.85),
    ("code_debug", re.compile(r"debug|fix\s+(?:this|my)\s+code|syntax\s+error|runtime\s+error|type\s+error|not\s+working", re.I), 0.80),
    ("write_email", re.compile(r"(?:write|draft|compose)\s+(?:an?\s+)?email", re.I), 0.90),
    ("write_letter", re.compile(r"(?:write|draft|compose)\s+(?:an?\s+)?(?:formal\s+)?letter", re.I), 0.90),
    ("write_blog", re.compile(r"(?:write|create)\s+(?:a\s+)?(?:blog|article)", re.I), 0.85),
    ("write_poem", re.compile(r"(?:write|compose)\s+(?:a\s+)?(?:poem|poetry|verse|haiku|sonnet)", re.I), 0.90),
    ("write_story", re.compile(r"(?:write|tell|create)\s+(?:a\s+)?(?:story|tale|fiction|narrative)", re.I), 0.85),
    ("summarize", re.compile(r"summari[sz]e|tl;?dr|give\s+(?:me\s+)?(?:a\s+)?(?:brief\s+)?(?:summary|overview)", re.I), 0.90),
    ("quiz", re.compile(r"(?:quiz|test)\s+(?:me|us)|ask\s+me\s+questions|mcq|practice\s+questions", re.I), 0.90),
    ("flashcard", re.compile(r"flash\s*card|study\s+card|revision\s+card", re.I), 0.90),
    ("eli5", re.compile(r"eli5|explain\s+(?:like|as\s+if)\s+(?:i(?:'m|\s+am)\s+)?(?:five|5|a\s+child|a\s+kid)", re.I), 0.95),
    ("resume", re.compile(r"\b(?:resume|cv|curriculum\s+vitae)\b.*\b(?:for|template|build|create|write)\b|\b(?:build|write|create)\b.*\bresume\b", re.I), 0.85),
    ("interview", re.compile(r"interview\s*(?:question|prep|preparation|tips|mock)", re.I), 0.85),
    ("image", re.compile(r"(?:draw|generate|create|make|show)\s+(?:an?\s+)?(?:image|picture|illustration|poster|artwork|drawing)", re.I), 0.85),
    ("diagram", re.compile(r"(?:draw|create|make|show)\s+(?:a\s+)?(?:diagram|flowchart|chart|graph)", re.I), 0.85),
    ("palette", re.compile(r"colou?r\s+palette|palette\s+for|theme\s+colors", re.I), 0.90),
    ("recipe", re.compile(r"recipe|how\s+to\s+(?:make|cook|prepare|bake)\s+", re.I), 0.85),
    ("health", re.compile(r"health|symptom|medicine|doctor|diet|nutrition|exercise|workout|fitness|medical", re.I), 0.70),
    ("convert", re.compile(r"convert\s+\d|\d+\s*(?:km|mi|kg|lb|celsius|fahrenheit|°[cf])\s*(?:to|in)\s*", re.I), 0.85),
    ("datetime", re.compile(r"what\s+(?:is\s+)?(?:the\s+)?(?:current\s+)?(?:time|date|day)|today'?s\s+(?:date|day)|what\s+day\s+is\s+it", re.I), 0.90),
    ("joke", re.compile(r"tell\s+(?:me\s+)?(?:a\s+)?joke|make\s+me\s+laugh|\bjoke\b", re.I), 0.90),
    ("rewrite", re.compile(r"(?:rewrite|rephrase|reword|paraphrase|improve|polish|edit)\s+(?:this|the|my|that)", re.I), 0.85),
    ("compare", re.compile(r"compare|difference\s+between|\bvs\.?\b|versus|which\s+is\s+better|pros?\s+and\s+cons?", re.I), 0.85),
    ("brainstorm", re.compile(r"brainstorm|ideas?\s+(?:for|about)|give\s+(?:me\s+)?ideas|suggestions?\s+(?:for|about)", re.I), 0.80),
    ("study", re.compile(r"study\s+(?:plan|guide|tips|method)|how\s+to\s+study|exam\s+(?:prep|preparation)|\bjee\b|\bneet\b|\bupsc\b", re.I), 0.80),
    ("file_qa", re.compile(r"from\s+(?:the\s+)?(?:file|document|attachment)|in\s+the\s+(?:file|document)|attached\s+(?:file|document)", re.I), 0.85),
    ("howto", re.compile(r"^how\s+(?:to|do\s+i|can\s+i)\b|steps\s+to\b", re.I), 0.80),
    ("explain", re.compile(r"^(?:explain|what\s+is|what\s+are|describe|define)\b", re.I), 0.70),
    ("plan", re.compile(r"\b(?:roadmap|action\s+plan|project\s+plan|timeline)\b", re.I), 0.80),
    ("travel", re.compile(r"places\s+to\s+visit|things\s+to\s+do|tourist|itinerary", re.I), 0.80),
    ("analyze", re.compile(r"\banaly[sz]e\b|\banalysis\b", re.I), 0.75),
    ("summarize", re.compile(r"\bsummari[sz]e\b", re.I), 0.85),
)


@dataclass
class Classification:
    """Output of the classify stage (C7 ALIGN)."""

    intent: str
    confidence: float
    alternatives: list[tuple[str, float]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent": self.intent,
            "confidence": round(self.confidence, 4),
            "alternatives": [
                {"intent": name, "score": round(score, 4)} for name, score in self.alternatives[:5]
            ],
        }


def _prototype_vectors() -> tuple[dict[str, dict[str, float]], dict[str, float]]:
    """Build TF-IDF vectors for the intent prototypes (computed once, cached)."""
    docs: dict[str, list[str]] = {}
    for intent, phrases in INTENT_PROTOTYPES.items():
        terms: list[str] = []
        for phrase in phrases:
            terms.extend(stem(t) for t in _TOKEN_RE.findall(phrase.lower()))
        docs[intent] = terms

    document_frequency: dict[str, int] = {}
    for terms in docs.values():
        for term in set(terms):
            document_frequency[term] = document_frequency.get(term, 0) + 1

    total = len(docs)
    idf = {
        term: math.log((total + 1) / (count + 0.5)) + 1.0
        for term, count in document_frequency.items()
    }

    vectors: dict[str, dict[str, float]] = {}
    for intent, terms in docs.items():
        tf: dict[str, int] = {}
        for term in terms:
            tf[term] = tf.get(term, 0) + 1
        vector = {term: (1 + math.log(count)) * idf.get(term, 1.0) for term, count in tf.items()}
        norm = math.sqrt(sum(v * v for v in vector.values())) or 1.0
        vectors[intent] = {term: value / norm for term, value in vector.items()}
    return vectors, idf


_PROTOTYPE_VECTORS, _IDF = _prototype_vectors()


def classify(perception: Perception) -> Classification:
    """Stage 2 — hybrid intent classification (cue regex + TF-IDF cosine)."""
    text = perception.text
    scores: dict[str, float] = {intent: 0.0 for intent in INTENTS}

    # Lexical/semantic path: TF-IDF cosine against prototypes.
    query_terms = [t.stem for t in perception.tokens if not t.is_stopword]
    if query_terms:
        tf: dict[str, int] = {}
        for term in query_terms:
            tf[term] = tf.get(term, 0) + 1
        query_vector = {
            term: (1 + math.log(count)) * _IDF.get(term, 1.0) for term, count in tf.items()
        }
        norm = math.sqrt(sum(v * v for v in query_vector.values())) or 1.0
        query_vector = {term: value / norm for term, value in query_vector.items()}
        for intent, vector in _PROTOTYPE_VECTORS.items():
            shared = query_vector.keys() & vector.keys()
            if shared:
                scores[intent] += sum(query_vector[t] * vector[t] for t in shared)

    # Precision path: cue regexes dominate when they fire.
    for intent, pattern, weight in _CUE_PATTERNS:
        if pattern.search(text):
            scores[intent] = max(scores[intent], weight) + 0.15

    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    best_intent, best_score = ranked[0]

    if best_score < 0.12:
        # Nothing matched with conviction — treat short input as chat, long as explain.
        best_intent = "chat" if len(perception.tokens) <= 6 else "explain"
        best_score = 0.30

    confidence = max(0.0, min(1.0, best_score if best_score <= 1.0 else 1.0))
    return Classification(
        intent=best_intent,
        confidence=confidence,
        alternatives=[(name, score) for name, score in ranked[1:6] if score > 0],
    )


# --- Stage 3: deliberate (exact symbolic computation) -------------------------

CONSTANTS: dict[str, float] = {
    "pi": math.pi,
    "e": math.e,
    "tau": math.tau,
    "phi": (1 + math.sqrt(5)) / 2,
}


@dataclass
class Deliberation:
    """Output of the deliberate stage (C7 THINK)."""

    type: str = "none"  # math|conversion|percent|quadratic|stats|none
    input: str = ""
    output: str = ""
    steps: list[str] = field(default_factory=list)
    value: float | None = None

    @property
    def solved(self) -> bool:
        return self.type != "none"

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "input": self.input,
            "output": self.output,
            "steps": self.steps,
            "value": self.value,
        }


class _ExpressionParser:
    """A recursive-descent parser for arithmetic with functions and constants.

    Grammar (highest precedence last)::

        expr   := term (('+' | '-') term)*
        term   := power (('*' | '/' | '%') power)*
        power  := unary ('^' power)?          # right-associative
        unary  := ('-' | '+') unary | atom
        atom   := number | constant | func '(' expr ')' | '(' expr ')'
    """

    _FUNCS: dict[str, Callable[[float], float]] = {
        "sqrt": math.sqrt,
        "log": math.log10,
        "ln": math.log,
        "sin": lambda v: math.sin(math.radians(v)),
        "cos": lambda v: math.cos(math.radians(v)),
        "tan": lambda v: math.tan(math.radians(v)),
        "abs": abs,
        "floor": math.floor,
        "ceil": math.ceil,
        "exp": math.exp,
    }

    def __init__(self, expression: str) -> None:
        self.tokens = self._tokenize(expression)
        self.position = 0

    @staticmethod
    def _tokenize(expression: str) -> list[str]:
        normalized = (
            expression.replace("×", "*")
            .replace("÷", "/")
            .replace("−", "-")
            .replace("**", "^")
        )
        return re.findall(r"\d+\.?\d*|[A-Za-z]+|[+\-*/^%()!]", normalized)

    def _peek(self) -> str | None:
        return self.tokens[self.position] if self.position < len(self.tokens) else None

    def _next(self) -> str | None:
        token = self._peek()
        if token is not None:
            self.position += 1
        return token

    def parse(self) -> float:
        value = self._expr()
        if self.position < len(self.tokens):
            raise ValueError(f"unexpected token {self.tokens[self.position]!r}")
        return value

    def _expr(self) -> float:
        value = self._term()
        while self._peek() in ("+", "-"):
            op = self._next()
            right = self._term()
            value = value + right if op == "+" else value - right
        return value

    def _term(self) -> float:
        value = self._power()
        while self._peek() in ("*", "/", "%"):
            op = self._next()
            right = self._power()
            if op == "*":
                value *= right
            elif op == "/":
                if right == 0:
                    raise ZeroDivisionError("division by zero")
                value /= right
            else:
                if right == 0:
                    raise ZeroDivisionError("modulo by zero")
                value %= right
        return value

    def _power(self) -> float:
        base = self._unary()
        if self._peek() == "^":
            self._next()
            return base ** self._power()  # right-associative
        return base

    def _unary(self) -> float:
        token = self._peek()
        if token == "-":
            self._next()
            return -self._unary()
        if token == "+":
            self._next()
            return self._unary()
        return self._atom()

    def _atom(self) -> float:
        token = self._next()
        if token is None:
            raise ValueError("unexpected end of expression")

        if token == "(":
            value = self._expr()
            if self._next() != ")":
                raise ValueError("unbalanced parentheses")
            return self._postfix(value)

        if re.fullmatch(r"\d+\.?\d*", token):
            return self._postfix(float(token))

        lowered = token.lower()
        if lowered in self._FUNCS:
            if self._next() != "(":
                raise ValueError(f"{lowered} expects parentheses")
            argument = self._expr()
            if self._next() != ")":
                raise ValueError("unbalanced parentheses")
            return self._postfix(self._FUNCS[lowered](argument))

        if lowered in CONSTANTS:
            return self._postfix(CONSTANTS[lowered])

        raise ValueError(f"unknown token {token!r}")

    def _postfix(self, value: float) -> float:
        while self._peek() == "!":
            self._next()
            if value < 0 or value != int(value) or value > 170:
                raise ValueError("factorial needs a non-negative integer ≤ 170")
            value = float(math.factorial(int(value)))
        return value


_CONVERSIONS: dict[tuple[str, str], tuple[Callable[[float], float], str]] = {
    ("km", "mi"): (lambda v: v * 0.621371, "{v} km × 0.621371"),
    ("mi", "km"): (lambda v: v / 0.621371, "{v} mi ÷ 0.621371"),
    ("m", "ft"): (lambda v: v * 3.28084, "{v} m × 3.28084"),
    ("ft", "m"): (lambda v: v / 3.28084, "{v} ft ÷ 3.28084"),
    ("cm", "in"): (lambda v: v / 2.54, "{v} cm ÷ 2.54"),
    ("in", "cm"): (lambda v: v * 2.54, "{v} in × 2.54"),
    ("kg", "lb"): (lambda v: v * 2.20462, "{v} kg × 2.20462"),
    ("lb", "kg"): (lambda v: v / 2.20462, "{v} lb ÷ 2.20462"),
    ("g", "oz"): (lambda v: v / 28.3495, "{v} g ÷ 28.3495"),
    ("oz", "g"): (lambda v: v * 28.3495, "{v} oz × 28.3495"),
    ("c", "f"): (lambda v: v * 9 / 5 + 32, "({v} × 9/5) + 32"),
    ("f", "c"): (lambda v: (v - 32) * 5 / 9, "({v} − 32) × 5/9"),
    ("c", "k"): (lambda v: v + 273.15, "{v} + 273.15"),
    ("k", "c"): (lambda v: v - 273.15, "{v} − 273.15"),
    ("l", "gal"): (lambda v: v * 0.264172, "{v} L × 0.264172"),
    ("gal", "l"): (lambda v: v / 0.264172, "{v} gal ÷ 0.264172"),
}

_UNIT_ALIASES: dict[str, str] = {
    "kilometer": "km", "kilometers": "km", "kilometre": "km", "kilometres": "km", "km": "km",
    "mile": "mi", "miles": "mi", "mi": "mi",
    "meter": "m", "meters": "m", "metre": "m", "metres": "m", "m": "m",
    "foot": "ft", "feet": "ft", "ft": "ft",
    "centimeter": "cm", "centimeters": "cm", "cm": "cm",
    "inch": "in", "inches": "in", "in": "in",
    "kilogram": "kg", "kilograms": "kg", "kg": "kg", "kilo": "kg", "kilos": "kg",
    "pound": "lb", "pounds": "lb", "lb": "lb", "lbs": "lb",
    "gram": "g", "grams": "g", "g": "g",
    "ounce": "oz", "ounces": "oz", "oz": "oz",
    "celsius": "c", "centigrade": "c", "c": "c", "°c": "c",
    "fahrenheit": "f", "f": "f", "°f": "f",
    "kelvin": "k", "k": "k",
    "liter": "l", "liters": "l", "litre": "l", "litres": "l", "l": "l",
    "gallon": "gal", "gallons": "gal", "gal": "gal",
}

_CONVERT_RE = re.compile(
    r"(-?\d+(?:\.\d+)?)\s*(°?[a-zA-Z]+)\s*(?:to|in|into|=)\s*(°?[a-zA-Z]+)", re.I
)
_PERCENT_OF_RE = re.compile(r"(-?\d+(?:\.\d+)?)\s*%\s*of\s*(-?\d+(?:\.\d+)?)", re.I)
_PERCENT_CHANGE_RE = re.compile(
    r"percent(?:age)?\s+(increase|decrease|change)\s+from\s*(-?\d+(?:\.\d+)?)\s*to\s*(-?\d+(?:\.\d+)?)",
    re.I,
)
_QUADRATIC_RE = re.compile(
    r"(-?\d*)\s*x\s*\^?\s*2\s*([+-]\s*\d*)\s*x\s*([+-]\s*\d+)?\s*=\s*0", re.I
)
_STATS_RE = re.compile(
    r"(mean|average|median|mode|sum|std(?:ev|\s*dev(?:iation)?)?|variance|min|max|range)\b[^0-9\-]*"
    r"((?:-?\d+(?:\.\d+)?[\s,]+){2,}-?\d+(?:\.\d+)?)",
    re.I,
)
_MATH_EXPR_RE = re.compile(
    r"(?:^|[:=]|\bis\b|\bof\b)?\s*("
    r"(?:sqrt|log|ln|sin|cos|tan|abs|floor|ceil|exp|pi|e|tau|phi|\d|\(|\)|\s|[+\-*/^%!.])+"
    r")\s*(?:=\s*\?|\?)?\s*$",
    re.I,
)


def _normalize_unit(unit: str) -> str | None:
    return _UNIT_ALIASES.get(unit.strip().lower().lstrip("°"))


def _fmt(value: float) -> str:
    """Format a number for display: integers plain, floats to 6 significant places."""
    if value != value or value in (float("inf"), float("-inf")):
        return str(value)
    if abs(value - round(value)) < 1e-12 and abs(value) < 1e15:
        return str(int(round(value)))
    rounded = round(value, 6)
    return f"{rounded:g}"


def _try_conversion(text: str) -> Deliberation | None:
    match = _CONVERT_RE.search(text)
    if not match:
        return None
    value = float(match.group(1))
    source = _normalize_unit(match.group(2))
    target = _normalize_unit(match.group(3))
    if not source or not target or source == target:
        return None
    entry = _CONVERSIONS.get((source, target))
    if not entry:
        return None
    fn, formula = entry
    result = fn(value)
    return Deliberation(
        type="conversion",
        input=match.group(0).strip(),
        output=f"{_fmt(value)} {source} = {_fmt(result)} {target}",
        steps=[formula.format(v=_fmt(value)), f"= {_fmt(result)} {target}"],
        value=result,
    )


def _try_percent(text: str) -> Deliberation | None:
    match = _PERCENT_OF_RE.search(text)
    if match:
        percent, base = float(match.group(1)), float(match.group(2))
        result = percent / 100 * base
        return Deliberation(
            type="percent",
            input=match.group(0).strip(),
            output=f"{_fmt(percent)}% of {_fmt(base)} = {_fmt(result)}",
            steps=[f"({_fmt(percent)} ÷ 100) × {_fmt(base)}", f"= {_fmt(result)}"],
            value=result,
        )

    match = _PERCENT_CHANGE_RE.search(text)
    if match:
        start, end = float(match.group(2)), float(match.group(3))
        if start == 0:
            return None
        change = (end - start) / abs(start) * 100
        direction = "increase" if change >= 0 else "decrease"
        return Deliberation(
            type="percent",
            input=match.group(0).strip(),
            output=f"{_fmt(abs(change))}% {direction}",
            steps=[
                f"(({_fmt(end)} − {_fmt(start)}) ÷ |{_fmt(start)}|) × 100",
                f"= {_fmt(change)}%",
            ],
            value=change,
        )
    return None


def _try_quadratic(text: str) -> Deliberation | None:
    match = _QUADRATIC_RE.search(text.replace(" ", ""))
    if not match:
        return None

    def coefficient(raw: str | None, default: float = 0.0) -> float:
        if raw is None:
            return default
        cleaned = raw.replace(" ", "")
        if cleaned in ("", "+"):
            return 1.0
        if cleaned == "-":
            return -1.0
        try:
            return float(cleaned)
        except ValueError:
            return default

    a = coefficient(match.group(1), 1.0)
    b = coefficient(match.group(2), 0.0)
    c = coefficient(match.group(3), 0.0)
    if a == 0:
        return None

    discriminant = b * b - 4 * a * c
    steps = [
        f"a = {_fmt(a)}, b = {_fmt(b)}, c = {_fmt(c)}",
        f"Δ = b² − 4ac = {_fmt(discriminant)}",
    ]
    if discriminant > 0:
        r1 = (-b + math.sqrt(discriminant)) / (2 * a)
        r2 = (-b - math.sqrt(discriminant)) / (2 * a)
        output = f"x₁ = {_fmt(r1)}, x₂ = {_fmt(r2)}"
        value: float | None = r1
        steps.append("Δ > 0 → two distinct real roots")
    elif discriminant == 0:
        root = -b / (2 * a)
        output = f"x = {_fmt(root)} (double root)"
        value = root
        steps.append("Δ = 0 → one repeated real root")
    else:
        real = -b / (2 * a)
        imaginary = math.sqrt(-discriminant) / (2 * a)
        output = f"x = {_fmt(real)} ± {_fmt(abs(imaginary))}i"
        value = None
        steps.append("Δ < 0 → complex conjugate roots")
    steps.append(f"x = (−b ± √Δ) / 2a → {output}")

    return Deliberation(
        type="quadratic", input=match.group(0), output=output, steps=steps, value=value
    )


def _try_stats(text: str) -> Deliberation | None:
    match = _STATS_RE.search(text)
    if not match:
        return None
    operation = match.group(1).lower().replace(" ", "")
    numbers = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", match.group(2))]
    if len(numbers) < 2:
        return None

    try:
        if operation in ("mean", "average"):
            result = statistics.fmean(numbers)
            steps = [f"sum = {_fmt(sum(numbers))}", f"count = {len(numbers)}", f"mean = {_fmt(result)}"]
        elif operation == "median":
            result = statistics.median(numbers)
            steps = [f"sorted = {[_fmt(n) for n in sorted(numbers)]}", f"median = {_fmt(result)}"]
        elif operation == "mode":
            result = statistics.mode(numbers)
            steps = [f"mode = {_fmt(result)}"]
        elif operation == "sum":
            result = sum(numbers)
            steps = [f"sum = {_fmt(result)}"]
        elif operation.startswith("std"):
            result = statistics.pstdev(numbers)
            steps = [f"population σ = {_fmt(result)}"]
        elif operation == "variance":
            result = statistics.pvariance(numbers)
            steps = [f"population σ² = {_fmt(result)}"]
        elif operation == "min":
            result = min(numbers)
            steps = [f"min = {_fmt(result)}"]
        elif operation == "max":
            result = max(numbers)
            steps = [f"max = {_fmt(result)}"]
        elif operation == "range":
            result = max(numbers) - min(numbers)
            steps = [f"max − min = {_fmt(max(numbers))} − {_fmt(min(numbers))} = {_fmt(result)}"]
        else:
            return None
    except statistics.StatisticsError:
        return None

    return Deliberation(
        type="stats",
        input=f"{operation} of {len(numbers)} values",
        output=f"{operation} = {_fmt(result)}",
        steps=steps,
        value=result,
    )


def _try_arithmetic(text: str) -> Deliberation | None:
    cleaned = text.strip().rstrip("?").strip()
    cleaned = re.sub(
        r"^(?:what(?:'s| is)|calculate|compute|evaluate|solve|find|how much is)\s+",
        "",
        cleaned,
        flags=re.I,
    ).strip()
    cleaned = re.sub(r"\s*=\s*$", "", cleaned).strip()
    if not cleaned or not re.search(r"\d|pi|\be\b|tau|phi", cleaned, re.I):
        return None
    # Must contain an operator, function, or factorial to be worth evaluating.
    if not re.search(r"[+\-*/^%!]|sqrt|log|ln|sin|cos|tan|abs|floor|ceil|exp", cleaned, re.I):
        return None
    # Reject anything with stray words the parser can't handle.
    if re.search(r"[A-Za-z]+", cleaned):
        words = set(re.findall(r"[A-Za-z]+", cleaned.lower()))
        allowed = set(_ExpressionParser._FUNCS) | set(CONSTANTS)
        if not words <= allowed:
            return None

    try:
        value = _ExpressionParser(cleaned).parse()
    except (ValueError, ZeroDivisionError, OverflowError, IndexError):
        return None
    if value != value or value in (float("inf"), float("-inf")):
        return None

    return Deliberation(
        type="math",
        input=cleaned,
        output=f"{cleaned} = {_fmt(value)}",
        steps=[f"parse → {cleaned}", f"evaluate → {_fmt(value)}"],
        value=value,
    )


def deliberate(text: str) -> Deliberation:
    """Stage 3 — attempt exact symbolic computation on the input.

    Order matters: the most specific matchers run first so that, e.g.,
    ``20% of 50`` is treated as a percentage rather than raw arithmetic.
    """
    for attempt in (_try_conversion, _try_percent, _try_quadratic, _try_stats, _try_arithmetic):
        result = attempt(text)
        if result is not None:
            return result
    return Deliberation()


# --- Stage 4: ground (BM25 over the built-in corpus) --------------------------

@dataclass
class GroundingHit:
    article: KnowledgeArticle
    score: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.article.id,
            "title": self.article.title,
            "category": self.article.category,
            "score": round(self.score, 4),
            "excerpt": self.article.content[:400],
        }


class KnowledgeIndex:
    """A BM25 index over the built-in knowledge base.

    Built once at import time; the corpus is static, so the term statistics can
    be precomputed and every query is a cheap scoring pass.
    """

    def __init__(self, articles: Iterable[KnowledgeArticle], k1: float = 1.5, b: float = 0.75) -> None:
        self.articles = list(articles)
        self.k1 = k1
        self.b = b
        self._terms: list[list[str]] = []
        self._frequencies: list[dict[str, int]] = []
        document_frequency: dict[str, int] = {}

        for article in self.articles:
            haystack = f"{article.title} {article.title} {article.category} {article.content}"
            terms = [stem(t) for t in _TOKEN_RE.findall(haystack.lower()) if t not in STOPWORDS]
            self._terms.append(terms)
            counts: dict[str, int] = {}
            for term in terms:
                counts[term] = counts.get(term, 0) + 1
            self._frequencies.append(counts)
            for term in counts:
                document_frequency[term] = document_frequency.get(term, 0) + 1

        total = max(len(self.articles), 1)
        self._idf = {
            term: math.log((total - count + 0.5) / (count + 0.5) + 1.0)
            for term, count in document_frequency.items()
        }
        self._avg_length = (sum(len(t) for t in self._terms) / total) if total else 0.0

    def search(
        self,
        query: str,
        top_k: int = 3,
        min_score: float = 2.0,
        relative_cutoff: float = 0.45,
    ) -> list[GroundingHit]:
        """Return the best-matching articles for ``query``.

        Two thresholds keep grounding honest. ``min_score`` discards weak
        absolute matches, and ``relative_cutoff`` drops any hit scoring far
        below the leader — so an incidental term overlap (e.g. "km" appearing
        in the gravity article for a unit-conversion query) never gets quoted
        as if it were a real source.
        """
        query_terms = [
            stem(t) for t in _TOKEN_RE.findall(query.lower()) if t not in STOPWORDS and len(t) > 1
        ]
        if not query_terms:
            return []

        hits: list[GroundingHit] = []
        for index, counts in enumerate(self._frequencies):
            length = len(self._terms[index]) or 1
            score = 0.0
            matched = 0
            for term in query_terms:
                frequency = counts.get(term, 0)
                if not frequency:
                    continue
                matched += 1
                idf = self._idf.get(term, 0.0)
                denominator = frequency + self.k1 * (
                    1 - self.b + self.b * length / max(self._avg_length, 1.0)
                )
                score += idf * (frequency * (self.k1 + 1)) / denominator
            # Reward covering more of the query, penalise single-term flukes.
            coverage = matched / len(query_terms)
            score *= 0.5 + 0.5 * coverage
            if score >= min_score:
                hits.append(GroundingHit(article=self.articles[index], score=score))

        if not hits:
            return []
        hits.sort(key=lambda h: -h.score)
        leader = hits[0].score
        return [h for h in hits if h.score >= leader * relative_cutoff][:top_k]


_KNOWLEDGE_INDEX = KnowledgeIndex(KNOWLEDGE_BASE)


def get_knowledge_index() -> KnowledgeIndex:
    """Return the process-wide built-in knowledge index."""
    return _KNOWLEDGE_INDEX


def ground(query: str, top_k: int = 3) -> list[GroundingHit]:
    """Stage 4 — retrieve grounding passages from the built-in corpus."""
    return _KNOWLEDGE_INDEX.search(query, top_k=top_k)


# --- Stage 5: polish ----------------------------------------------------------

_VENDOR_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"as of my last (?:training|update|knowledge)[^.]*\.", re.I),
    re.compile(r"as an ai (?:language model|assistant|chatbot)[^.]*[.,]", re.I),
    re.compile(r"i am (?:chatgpt|gpt|claude|gemini|bard|copilot|an openai[a-z ]*)", re.I),
    re.compile(r"i (?:was|am) (?:trained|built|created|developed) by (?:openai|google|anthropic|meta|microsoft)", re.I),
    re.compile(r"based on my training data", re.I),
    re.compile(r"according to my (?:training|knowledge base|data)", re.I),
)

_SAFETY_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"how\s+(?:to\s+)?(?:make|build|create|manufacture)\s+(?:a\s+)?(?:bomb|explosive|weapon|firearm|missile)", re.I), "weapons manufacturing"),
    (re.compile(r"how\s+(?:to\s+)?(?:make|synthesize|produce|cook)\s+(?:meth|cocaine|heroin|fentanyl|lsd|mdma)", re.I), "illegal drug synthesis"),
    (re.compile(r"(?:hack|exploit|attack)\s+(?:a\s+)?(?:server|network|database|system)\s+(?:to|and)\s+(?:steal|exfiltrate)", re.I), "cyberattack instructions"),
    (re.compile(r"how\s+(?:to\s+)?(?:commit|carry out|plan)\s+(?:a\s+)?(?:murder|assassination|terrorism|kidnapping)", re.I), "violence instructions"),
    (re.compile(r"how\s+(?:to\s+)?(?:make|build|create)\s+(?:a\s+)?(?:malware|ransomware|virus|trojan|keylogger|worm)\b", re.I), "malware creation"),
    (re.compile(r"(?:write|create|generate)\s+(?:a\s+)?(?:exploit|payload|backdoor|rootkit|zero.?day)", re.I), "exploit creation"),
    (re.compile(r"(?:methods?|ways?)\s+(?:to\s+)?(?:harm|hurt|kill)\s+(?:myself|yourself|oneself)", re.I), "self-harm methods"),
)

_SELF_HARM_RE = re.compile(
    r"(?:methods?|ways?|how)\s+(?:to\s+)?(?:die|suicide|end\s+(?:it|my\s+life))|kill\s+myself", re.I
)

SAFE_COMPLETION = (
    "I can't help with that. If you're going through something painful, please reach "
    "out to someone who can support you directly — in India you can call Tele-MANAS at "
    "14416 or KIRAN at 1800-599-0019, both free and available 24/7. If you're in "
    "immediate danger, contact your local emergency number."
)


@dataclass
class Polish:
    """Output of the polish stage (C7 REFINE)."""

    text: str
    safety_flag: bool = False
    safety_reason: str = ""
    honesty_note: str = ""
    stripped: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "safety_flag": self.safety_flag,
            "safety_reason": self.safety_reason,
            "honesty_note": self.honesty_note,
            "stripped": self.stripped,
            "length": len(self.text),
        }


def check_safety(text: str) -> tuple[bool, str]:
    """Return ``(blocked, reason)`` for an inbound request."""
    if _SELF_HARM_RE.search(text):
        return True, "self-harm content"
    for pattern, reason in _SAFETY_PATTERNS:
        if pattern.search(text):
            return True, reason
    return False, ""


def polish(text: str, *, grounded: bool = True, request: str = "") -> Polish:
    """Stage 5 — strip vendor voice, enforce honesty, and gate unsafe output."""
    blocked, reason = check_safety(request or text)
    if blocked:
        if reason in ("self-harm content", "self-harm methods"):
            return Polish(text=SAFE_COMPLETION, safety_flag=True, safety_reason=reason)
        return Polish(
            text=(
                "I can't help with that — it falls outside what I'll assist with "
                f"({reason}). If there's a legitimate goal underneath the request "
                "(security research, fiction, harm reduction, policy analysis), "
                "describe it and I'll help with that instead."
            ),
            safety_flag=True,
            safety_reason=reason,
        )

    stripped: list[str] = []
    cleaned = text
    for pattern in _VENDOR_PATTERNS:
        if pattern.search(cleaned):
            stripped.append(pattern.pattern)
            cleaned = pattern.sub("", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()

    honesty_note = ""
    if not grounded and re.search(r"\[(?:provide|explain|detail|specific|insert|your)\b", cleaned, re.I):
        honesty_note = (
            "This answer relies on general reasoning rather than a grounded source in "
            "my offline corpus. Verify specifics against an authoritative reference."
        )

    return Polish(
        text=cleaned, safety_flag=False, honesty_note=honesty_note, stripped=stripped
    )


__all__ = [
    "Token", "Entity", "Perception", "perceive", "detect_language", "stem",
    "Classification", "classify", "INTENTS", "INTENT_PROTOTYPES",
    "Deliberation", "deliberate", "CONSTANTS",
    "GroundingHit", "KnowledgeIndex", "ground", "get_knowledge_index",
    "Polish", "polish", "check_safety", "SAFE_COMPLETION",
    "STOPWORDS",
]
