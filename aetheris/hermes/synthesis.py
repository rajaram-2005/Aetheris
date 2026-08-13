"""Aetheris Hermes — offline response synthesis.

The composition stage of the Hermes cascade (the C7 WEAVE role). Given the
perception, classification, exact computation, and grounding produced upstream,
this module writes the actual answer — with no model weights and no network.

The synthesizer is *strategy-aware*: the meta-learner's ``Strategy`` controls
verbosity, how much grounded material is quoted, and whether reasoning is shown.
That is the visible channel through which meta-learning changes behaviour.
"""

from __future__ import annotations

import random
import re
from datetime import datetime, timezone
from typing import Any

from .cognition import Classification, Deliberation, GroundingHit, Perception
from .meta_learning import Strategy

_JOKES: tuple[str, ...] = (
    "Why do programmers prefer dark mode? Because light attracts bugs.",
    "There are only 10 types of people: those who understand binary and those who don't.",
    "A SQL query walks into a bar, walks up to two tables and asks: 'Can I join you?'",
    "What's the object-oriented way to become wealthy? Inheritance.",
    "How many programmers does it take to change a light bulb? None — that's a hardware problem.",
    "A QA engineer walks into a bar. Orders 1 beer. Orders 0 beers. Orders -1 beers. Orders a lizard.",
    "Why was the function sad? It never got any callbacks.",
    "Why did the developer go broke? He used up all his cache.",
)

_LANGUAGE_HINTS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("python", re.compile(r"\bpython|\bpy\b|pandas|numpy|flask|django|fastapi", re.I)),
    ("javascript", re.compile(r"\bjavascript|\bjs\b|node|react|typescript|\bts\b", re.I)),
    ("sql", re.compile(r"\bsql\b|query|select |postgres|mysql|sqlite", re.I)),
    ("java", re.compile(r"\bjava\b(?!script)|spring", re.I)),
    ("cpp", re.compile(r"\bc\+\+|\bcpp\b", re.I)),
    ("go", re.compile(r"\bgolang\b|\bgo\b(?=\s+(?:function|code|program))", re.I)),
    ("bash", re.compile(r"\bbash\b|\bshell\b|command.?line script", re.I)),
    ("html", re.compile(r"\bhtml\b|\bcss\b|web ?page|landing page", re.I)),
)


def _detect_language(text: str) -> str:
    for name, pattern in _LANGUAGE_HINTS:
        if pattern.search(text):
            return name
    return "python"


def _title_from(task: str, limit: int = 72) -> str:
    cleaned = " ".join(task.split())
    cleaned = re.sub(
        r"^(?:please\s+)?(?:can you\s+)?(?:write|create|make|generate|build|give me|show me|explain|tell me about)\s+",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = cleaned.rstrip("?.!")
    if len(cleaned) > limit:
        cleaned = cleaned[:limit].rsplit(" ", 1)[0] + "…"
    return cleaned or "your request"


def _sentences(text: str, count: int) -> str:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return " ".join(parts[:count]).strip()


def _budget(strategy: Strategy) -> int:
    """How many grounded sentences to quote, from the verbosity knob."""
    return max(2, int(2 + strategy.verbosity * 6))


# --- Grounded explanation ------------------------------------------------------

def _explain(task: str, hits: list[GroundingHit], strategy: Strategy) -> str:
    if not hits:
        return ""
    primary = hits[0]
    body = _sentences(primary.article.content, _budget(strategy))
    out = [f"**{primary.article.title}**", "", body]

    if strategy.verbosity > 0.5 and len(hits) > 1:
        out.append("")
        out.append("**Related context**")
        for hit in hits[1:3]:
            out.append(f"- *{hit.article.title}* — {_sentences(hit.article.content, 1)}")

    out.append("")
    out.append(
        "Source: built-in offline corpus ("
        + ", ".join(f"`{h.article.id}`" for h in hits)
        + ")."
    )
    return "\n".join(out)


# --- Code generation -----------------------------------------------------------

_CODE_TEMPLATES: dict[str, str] = {
    "python": '''def solve(data):
    """{title}

    Args:
        data: the input to process.

    Returns:
        The processed result.
    """
    if data is None:
        raise ValueError("data is required")
    return data


if __name__ == "__main__":
    print(solve("example"))
''',
    "javascript": '''/** {title} */
export function solve(data) {{
  if (data == null) throw new TypeError("data is required");
  return data;
}}

console.log(solve("example"));
''',
    "sql": '''-- {title}
SELECT
    t.id,
    t.name,
    COUNT(*) AS total
FROM your_table AS t
WHERE t.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY t.id, t.name
ORDER BY total DESC
LIMIT 100;
''',
    "java": '''/** {title} */
public final class Solution {{
    public static String solve(String data) {{
        if (data == null) throw new IllegalArgumentException("data is required");
        return data;
    }}

    public static void main(String[] args) {{
        System.out.println(solve("example"));
    }}
}}
''',
    "cpp": '''// {title}
#include <iostream>
#include <stdexcept>
#include <string>

std::string solve(const std::string& data) {{
    if (data.empty()) throw std::invalid_argument("data is required");
    return data;
}}

int main() {{
    std::cout << solve("example") << '\\n';
}}
''',
    "go": '''// {title}
package main

import (
	"errors"
	"fmt"
)

func Solve(data string) (string, error) {{
	if data == "" {{
		return "", errors.New("data is required")
	}}
	return data, nil
}}

func main() {{
	out, err := Solve("example")
	if err != nil {{
		panic(err)
	}}
	fmt.Println(out)
}}
''',
    "bash": '''#!/usr/bin/env bash
# {title}
set -euo pipefail

main() {{
  local input="${{1:?input required}}"
  printf '%s\\n' "$input"
}}

main "$@"
''',
    "html": '''<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
  </head>
  <body>
    <main><h1>{title}</h1></main>
  </body>
</html>
''',
}


def _code(task: str, strategy: Strategy) -> str:
    language = _detect_language(task)
    title = _title_from(task)
    template = _CODE_TEMPLATES.get(language, _CODE_TEMPLATES["python"])
    fence = {"cpp": "cpp", "html": "html", "bash": "bash"}.get(language, language)
    body = template.format(title=title)

    out = [
        f"Here's a working {language} starting point for **{title}**.",
        "",
        f"```{fence}",
        body.rstrip(),
        "```",
    ]
    if strategy.verbosity > 0.4:
        out += [
            "",
            "**How it's structured**",
            "- Input is validated first, so failures are loud and early.",
            "- The core transformation is isolated in one function, making it testable.",
            "- The entry point is separate from the logic, so it imports cleanly.",
        ]
    out += [
        "",
        "Tell me the exact input shape and expected output and I'll finish the "
        "implementation — or ask me to run it and I'll execute it in the sandbox.",
    ]
    return "\n".join(out)


# --- Writing -------------------------------------------------------------------

def _email(task: str, strategy: Strategy) -> str:
    topic = _title_from(task)
    return "\n".join(
        [
            f"**Subject:** {topic[:60]}",
            "",
            "Hi [Name],",
            "",
            f"I'm writing about {topic}. [One sentence of context — why this matters "
            "to the reader right now.]",
            "",
            "[The specific ask or update, stated plainly. If there are details, put "
            "them in two or three short bullets rather than a paragraph.]",
            "",
            "[Clear next step, with a date if one applies.]",
            "",
            "Best regards,",
            "[Your name]",
            "",
            "---",
            "Replace the bracketed parts and it's ready to send. Tell me the recipient, "
            "the tone, and the outcome you want, and I'll write the finished version.",
        ]
    )


def _poem(task: str, strategy: Strategy) -> str:
    subject = _title_from(task, 40) or "the quiet hour"
    subject = re.sub(r"^(?:a\s+poem\s+)?(?:about|on)\s+", "", subject, flags=re.I)
    return "\n".join(
        [
            f"**On {subject}**",
            "",
            f"There is a shape to {subject},",
            "the way light leans on an ordinary wall,",
            "patient as arithmetic, and as exact.",
            "",
            "I have been counting what does not need counting —",
            "the small hours, the returning, the almost-said —",
            "and still the sum arrives unfinished.",
            "",
            "Let it. Some things are truer left open,",
            "the way a door is more a door when it swings.",
            "",
            "---",
            "Want it shorter, rhymed, or in a fixed form (sonnet, haiku, villanelle)? Say the word.",
        ]
    )


def _story(task: str, strategy: Strategy) -> str:
    subject = _title_from(task, 50)
    return "\n".join(
        [
            f"**{subject.title()}**",
            "",
            "The message arrived at 3:14 in the morning, which was the first thing "
            "wrong with it. The second was that it was addressed correctly.",
            "",
            "She read it twice. Then she got up, made coffee she didn't want, and "
            "read it a third time, as though the words might have rearranged "
            "themselves into something she could dismiss.",
            "",
            "They hadn't.",
            "",
            "By sunrise she had packed a bag she'd been unpacking for two years, and "
            "the city outside had begun its long argument with the light.",
            "",
            "---",
            "That's the opening. Tell me the genre, length, and where you want it to "
            "land and I'll write the full piece.",
        ]
    )


def _summarize(task: str, hits: list[GroundingHit], strategy: Strategy) -> str:
    if hits:
        article = hits[0].article
        sentences = re.split(r"(?<=[.!?])\s+", article.content)
        points = [s.strip() for s in sentences if len(s.strip()) > 40][:5]
        lines = [f"**Summary — {article.title}**", ""]
        lines += [f"- {p}" for p in points]
        lines += ["", f"Source: built-in corpus (`{article.id}`)."]
        return "\n".join(lines)
    return (
        "Paste the text you want summarized (or attach the document) and I'll "
        "condense it — I'll give you the thesis in one line, then the supporting "
        "points as bullets, then anything the text leaves unresolved."
    )


def _compare(task: str, hits: list[GroundingHit], strategy: Strategy) -> str:
    lines = ["**Comparison**", ""]
    if len(hits) >= 2:
        a, b = hits[0].article, hits[1].article
        lines += [
            f"| | {a.title} | {b.title} |",
            "| --- | --- | --- |",
            f"| In brief | {_sentences(a.content, 1)[:160]} | {_sentences(b.content, 1)[:160]} |",
            f"| Domain | {a.category} | {b.category} |",
            "",
            f"Sources: `{a.id}`, `{b.id}`.",
        ]
    else:
        lines += [
            "Name the two things explicitly (e.g. *compare Python and Java*) and I'll "
            "put them side by side on the axes that actually matter: what each is "
            "optimized for, where each breaks down, and which to pick for a given job.",
        ]
    return "\n".join(lines)


def _quiz(task: str, hits: list[GroundingHit], strategy: Strategy) -> str:
    if not hits:
        return (
            "Tell me the topic and I'll build the quiz — multiple choice, short "
            "answer, or mixed, with an answer key."
        )
    article = hits[0].article
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", article.content) if len(s.strip()) > 50]
    lines = [f"**Quiz — {article.title}**", ""]
    for index, sentence in enumerate(sentences[:5], start=1):
        stem_text = sentence[:150].rstrip(".")
        lines.append(f"{index}. {stem_text}?")
    lines += ["", "**Answer key** — derived from the corpus entry:", ""]
    for index, sentence in enumerate(sentences[:5], start=1):
        lines.append(f"{index}. {sentence}")
    lines += ["", f"Source: `{article.id}`."]
    return "\n".join(lines)


def _plan(task: str, strategy: Strategy) -> str:
    goal = _title_from(task)
    return "\n".join(
        [
            f"**Plan — {goal}**",
            "",
            "1. **Define done.** Write the acceptance criteria first; if you can't "
            "state them, the goal is still too vague to schedule.",
            "2. **Find the constraint.** Time, money, skill, or dependency — one of "
            "them is binding. Plan around that one.",
            "3. **Sequence by risk.** Do the step most likely to invalidate the plan "
            "first, while changing course is still cheap.",
            "4. **Set a checkpoint.** Pick a date to compare reality against this plan.",
            "5. **Decide the fallback.** Know in advance what you cut if you slip.",
            "",
            "Give me the deadline and the resources you actually have and I'll turn "
            "this into a dated schedule.",
        ]
    )


def _identity(strategy: Strategy) -> str:
    return (
        "I'm **Aetheris**, running the **Hermes** agent on this machine.\n\n"
        "Concretely: a request goes through perception (tokens, language, entities), "
        "intent classification, exact computation where the question is computable, "
        "retrieval against a built-in corpus, tool use in a sandbox when needed, and "
        "a safety/honesty pass — then a meta-learner records how it went and adjusts "
        "how I approach the next one.\n\n"
        "I run fully offline. No vendor API, no API key, nothing leaves this process."
    )


def _capability() -> str:
    return "\n".join(
        [
            "Here's what I can actually do, offline:",
            "",
            "- **Compute exactly** — arithmetic, unit conversions, percentages, "
            "quadratics, and statistics, solved symbolically rather than guessed.",
            "- **Run code** — real Python execution in a resource-limited sandbox.",
            "- **Search documents** — BM25 retrieval over a built-in corpus and any "
            "documents you mount.",
            "- **Use tools autonomously** — plan, call tools, observe, self-correct.",
            "- **Create files** — PNG images, animated GIFs, WAV audio, and runnable "
            "project ZIPs, all encoded with the standard library.",
            "- **Write** — email, blog, story, poem, summaries, comparisons, quizzes.",
            "- **Learn** — every episode updates my intent priors, tool preferences, "
            "and strategy, so repeated kinds of work get handled better.",
            "",
            "Ask for any of it directly.",
        ]
    )


def _greeting() -> str:
    hour = datetime.now().hour
    if hour < 12:
        salutation = "Good morning"
    elif hour < 17:
        salutation = "Good afternoon"
    elif hour < 21:
        salutation = "Good evening"
    else:
        salutation = "Hello"
    return f"{salutation}. Aetheris here, running the Hermes agent locally. What are we working on?"


def _datetime_answer() -> str:
    now = datetime.now()
    utc = datetime.now(timezone.utc)
    return "\n".join(
        [
            f"**Local time:** {now.strftime('%A, %d %B %Y, %H:%M:%S')}",
            f"**UTC:** {utc.strftime('%Y-%m-%d %H:%M:%S')} UTC",
            "",
            "(Read from this machine's clock.)",
        ]
    )


def _computed(deliberation: Deliberation, strategy: Strategy) -> str:
    lines = [f"**{deliberation.output}**"]
    if deliberation.steps and strategy.reasoning_depth > 0.3:
        lines += ["", "**Working**"]
        lines += [f"- {step}" for step in deliberation.steps]
    lines += ["", f"Computed exactly ({deliberation.type}), not estimated."]
    return "\n".join(lines)


def _fallback(task: str, perception: Perception, strategy: Strategy) -> str:
    topic = _title_from(task)
    lines = [
        f"Here's how I'd approach **{topic}**.",
        "",
        "I don't have a grounded source for this in my offline corpus, so I'll be "
        "explicit about that rather than inventing specifics.",
        "",
        "**What I can say structurally**",
        "- The question turns on "
        + (", ".join(perception.keywords[:3]) if perception.keywords else "the specifics you've given")
        + ".",
        "- The useful next move is to narrow it: a concrete example, a constraint, "
        "or the decision you're actually trying to make.",
        "",
        "If you mount a document on the topic (`POST /v1/documents`) or paste the "
        "relevant text, I'll ground the answer in it properly. If it's computable, "
        "state it as a calculation and I'll solve it exactly.",
    ]
    return "\n".join(lines)


# --- Entry point ---------------------------------------------------------------

def synthesize(
    task: str,
    perception: Perception,
    classification: Classification,
    deliberation: Deliberation,
    hits: list[GroundingHit],
    strategy: Strategy,
    *,
    tool_outputs: list[dict[str, Any]] | None = None,
    seed: int | None = None,
) -> str:
    """Compose the final answer from everything the cascade produced."""
    intent = classification.intent

    # An exact computation always wins: it is the highest-confidence signal.
    if deliberation.solved and intent in (
        "math", "convert", "chat", "explain", "analyze", "howto", "capability",
    ):
        return _computed(deliberation, strategy)

    # Tool observations, when present, are the ground truth to report.
    if tool_outputs:
        return _from_tools(task, tool_outputs, deliberation, hits, strategy)

    if intent == "greet":
        return _greeting()
    if intent == "identity":
        return _identity(strategy)
    if intent == "capability":
        return _capability()
    if intent == "datetime":
        return _datetime_answer()
    if intent == "joke":
        rng = random.Random(seed if seed is not None else hash(task) & 0xFFFF)
        return rng.choice(_JOKES)
    if intent in ("code_gen", "code_debug", "code_explain"):
        return _code(task, strategy)
    if intent in ("write_email", "write_letter"):
        return _email(task, strategy)
    if intent == "write_poem":
        return _poem(task, strategy)
    if intent == "write_story":
        return _story(task, strategy)
    if intent == "summarize":
        return _summarize(task, hits, strategy)
    if intent == "compare":
        return _compare(task, hits, strategy)
    if intent in ("quiz", "flashcard"):
        return _quiz(task, hits, strategy)
    if intent in ("plan", "study", "brainstorm"):
        return _plan(task, strategy)
    if deliberation.solved:
        return _computed(deliberation, strategy)

    grounded = _explain(task, hits, strategy)
    if grounded:
        return grounded
    return _fallback(task, perception, strategy)


def _from_tools(
    task: str,
    tool_outputs: list[dict[str, Any]],
    deliberation: Deliberation,
    hits: list[GroundingHit],
    strategy: Strategy,
) -> str:
    """Report results the toolbelt actually produced."""
    lines: list[str] = []
    successes = [t for t in tool_outputs if t.get("ok")]
    failures = [t for t in tool_outputs if not t.get("ok")]

    if successes:
        lines.append(f"I ran {len(successes)} tool call(s) and here's what came back.")
        lines.append("")
        for entry in successes:
            output = str(entry.get("output", "")).strip()
            if len(output) > 1400:
                output = output[:1400] + "\n… (truncated)"
            lines.append(f"**`{entry.get('tool')}`**")
            lines.append("")
            lines.append("```")
            lines.append(output or "(no output)")
            lines.append("```")
            lines.append("")

    if failures:
        lines.append("**Tool failures** (reported, not hidden):")
        for entry in failures:
            lines.append(f"- `{entry.get('tool')}` — {entry.get('error', 'unknown error')}")
        lines.append("")

    if deliberation.solved:
        lines.append(f"Independently verified by exact computation: {deliberation.output}")
        lines.append("")
    if hits and strategy.grounding_weight > 0.5:
        lines.append("Related corpus context: " + ", ".join(f"`{h.article.id}`" for h in hits) + ".")

    return "\n".join(lines).strip() or "The tools returned no output."


__all__ = ["synthesize"]
