"""Composable skills — triggerable instruction packs + tool bindings.

A skill is a named capability Hermes can attach to a turn: a short
instruction block, the tools it wants, and the cues that should activate
it. Matching is keyword + regex scoring, fully offline.

This is closer to a Claude *skill* or a custom-GPT starter than a plugin:
skills do not execute code themselves. They shape the cascade (which
tools fire, what framing the synthesizer sees).
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field

_TOKEN = re.compile(r"[A-Za-z0-9_]+")


class SkillIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    instructions: str = Field(..., min_length=1, max_length=8_000)
    keywords: list[str] = Field(default_factory=list)
    patterns: list[str] = Field(default_factory=list, description="Regexes that boost the score.")
    tools: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    enabled: bool = True


class MatchRequest(BaseModel):
    task: str = Field(..., min_length=1, max_length=20_000)
    top_k: int = Field(default=3, ge=1, le=8)
    threshold: float = Field(default=0.22, ge=0.0, le=1.0)


@dataclass
class _Skill:
    id: str
    name: str
    description: str
    instructions: str
    keywords: list[str]
    patterns: list[re.Pattern[str]]
    tools: list[str]
    examples: list[str]
    enabled: bool
    builtin: bool
    created_at: float = field(default_factory=time.time)
    matches: int = 0

    def score(self, task: str) -> float:
        if not self.enabled:
            return 0.0
        lowered = task.lower()
        tokens = {t.lower() for t in _TOKEN.findall(task)}
        hits = 0
        for kw in self.keywords:
            if " " in kw:
                if kw.lower() in lowered:
                    hits += 2
            elif kw.lower() in tokens or kw.lower() in lowered:
                hits += 1
        for pattern in self.patterns:
            if pattern.search(task):
                hits += 3
        if not self.keywords and not self.patterns:
            return 0.0
        denom = max(len(self.keywords) + 2 * len(self.patterns), 1)
        return min(1.0, hits / denom)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "instructions": self.instructions,
            "keywords": list(self.keywords),
            "patterns": [p.pattern for p in self.patterns],
            "tools": list(self.tools),
            "examples": list(self.examples),
            "enabled": self.enabled,
            "builtin": self.builtin,
            "matches": self.matches,
        }


_BUILTINS: tuple[dict[str, Any], ...] = (
    {
        "id": "skill_code_review",
        "name": "Code review",
        "description": "Read a snippet, name defects, suggest a concrete patch.",
        "keywords": ["review", "code review", "lgtm", "pull request", "pr feedback", "nit"],
        "patterns": [r"\breview (this|my) (code|pr|diff)\b"],
        "tools": ["code_interpreter"],
        "instructions": (
            "Review the code. List defects by severity (blocker / major / nit). "
            "For each, cite the line of thought and propose a minimal patch. "
            "Do not rewrite the whole file unless asked."
        ),
    },
    {
        "id": "skill_debug",
        "name": "Debugger",
        "description": "Reproduce a failure, isolate the cause, verify the fix.",
        "keywords": ["debug", "traceback", "exception", "stack trace", "not working", "bug"],
        "patterns": [r"\b(error|exception|traceback)\b"],
        "tools": ["code_interpreter"],
        "instructions": (
            "Reproduce the failure if code is present. State the root cause in one "
            "sentence, then the smallest change that fixes it. Run the fix when a "
            "sandbox is available."
        ),
    },
    {
        "id": "skill_math_proof",
        "name": "Math proof",
        "description": "Formal, step-by-step reasoning with a checkable result.",
        "keywords": ["prove", "proof", "theorem", "lemma", "irrational", "induction"],
        "patterns": [r"\bprove (that|why)\b"],
        "tools": ["calculator"],
        "instructions": (
            "State assumptions. Write a numbered proof. End with a one-line QED "
            "and, when numeric, an independent check of the result."
        ),
    },
    {
        "id": "skill_research",
        "name": "Research brief",
        "description": "Decompose a question, retrieve, and cite.",
        "keywords": ["research", "sources", "cite", "literature", "survey", "deep dive"],
        "patterns": [r"\b(cite sources|with citations|literature review)\b"],
        "tools": ["document_search", "list_documents"],
        "instructions": (
            "Break the question into 2–4 sub-questions. Retrieve before answering. "
            "Every non-trivial claim should point at a retrieved passage. "
            "Close with open questions."
        ),
    },
    {
        "id": "skill_writing",
        "name": "Writing coach",
        "description": "Preserve the author's voice while tightening prose.",
        "keywords": ["rewrite", "edit", "tone", "voice", "copyedit", "tighten"],
        "patterns": [r"\b(rewrite|edit this|make this (shorter|clearer))\b"],
        "tools": [],
        "instructions": (
            "Keep the author's voice. Prefer cuts over additions. Return the "
            "revised text first, then a short bullet list of what changed and why."
        ),
    },
    {
        "id": "skill_architecture",
        "name": "Systems architect",
        "description": "Design a system with invariants, failure modes, and a sketch.",
        "keywords": ["architect", "architecture", "system design", "distributed", "scalability"],
        "patterns": [r"\b(design a|system design|architect)\b"],
        "tools": ["think"],
        "instructions": (
            "Start from requirements and constraints. Propose a shape (components + "
            "data flow). Call out failure modes and how they are contained. "
            "Finish with a build sequence."
        ),
    },
    {
        "id": "skill_security",
        "name": "Security audit",
        "description": "Threat-model a design or snippet without providing exploits.",
        "keywords": ["audit", "security", "threat model", "vulnerability", "owasp"],
        "patterns": [r"\b(security audit|threat model|owasp)\b"],
        "tools": ["think"],
        "instructions": (
            "Enumerate assets, actors, and trust boundaries. List findings by "
            "severity with a mitigation, not an exploit. Refuse anything that "
            "would produce working attack code."
        ),
    },
    {
        "id": "skill_data",
        "name": "Data analysis",
        "description": "Profile a table, compute the asked statistic, narrate the caveat.",
        "keywords": ["dataset", "csv", "mean", "correlation", "outlier", "dataframe"],
        "patterns": [r"\b(analyze (this|the) (data|csv|table))\b"],
        "tools": ["code_interpreter", "calculator"],
        "instructions": (
            "State the question, the columns used, the statistic, and one caveat "
            "(bias, missingness, leakage). Prefer exact computation over vibes."
        ),
    },
)


class SkillRegistry:
    def __init__(self) -> None:
        self._lock = Lock()
        self._skills: dict[str, _Skill] = {}
        self._seed()

    def _seed(self) -> None:
        for spec in _BUILTINS:
            patterns: list[re.Pattern[str]] = []
            for raw in spec.get("patterns", []):
                try:
                    patterns.append(re.compile(raw, re.I))
                except re.error:
                    continue
            skill = _Skill(
                id=spec["id"],
                name=spec["name"],
                description=spec["description"],
                instructions=spec["instructions"],
                keywords=list(spec.get("keywords", [])),
                patterns=patterns,
                tools=list(spec.get("tools", [])),
                examples=list(spec.get("examples", [])),
                enabled=True,
                builtin=True,
            )
            self._skills[skill.id] = skill

    def create(self, body: SkillIn) -> _Skill:
        patterns: list[re.Pattern[str]] = []
        for raw in body.patterns:
            try:
                patterns.append(re.compile(raw, re.I))
            except re.error as exc:
                raise ValueError(f"invalid pattern {raw!r}: {exc}") from exc
        skill = _Skill(
            id=f"skill_{uuid.uuid4().hex[:8]}",
            name=body.name,
            description=body.description,
            instructions=body.instructions,
            keywords=list(body.keywords),
            patterns=patterns,
            tools=list(body.tools),
            examples=list(body.examples),
            enabled=body.enabled,
            builtin=False,
        )
        with self._lock:
            self._skills[skill.id] = skill
        return skill

    def get(self, skill_id: str) -> _Skill | None:
        with self._lock:
            if skill_id in self._skills:
                return self._skills[skill_id]
            for s in self._skills.values():
                if s.name.lower() == skill_id.lower():
                    return s
            return None

    def delete(self, skill_id: str) -> bool:
        with self._lock:
            s = self._skills.get(skill_id)
            if s is None or s.builtin:
                return False
            del self._skills[skill_id]
            return True

    def list_skills(self, *, enabled: bool | None = None) -> list[dict[str, Any]]:
        with self._lock:
            items = list(self._skills.values())
        if enabled is not None:
            items = [s for s in items if s.enabled is enabled]
        return [s.to_dict() for s in items]

    def match(self, task: str, *, top_k: int = 3, threshold: float = 0.22) -> list[dict[str, Any]]:
        with self._lock:
            scored = [(s.score(task), s) for s in self._skills.values()]
        scored = [(sc, s) for sc, s in scored if sc >= threshold]
        scored.sort(key=lambda kv: -kv[0])
        out: list[dict[str, Any]] = []
        for sc, skill in scored[:top_k]:
            skill.matches += 1
            payload = skill.to_dict()
            payload["score"] = round(sc, 4)
            out.append(payload)
        return out

    def compose(self, task: str, *, top_k: int = 2, threshold: float = 0.28) -> dict[str, Any]:
        matched = self.match(task, top_k=top_k, threshold=threshold)
        if not matched:
            return {"skills": [], "tools": [], "prompt_block": ""}
        tools: list[str] = []
        blocks: list[str] = []
        for skill in matched:
            for t in skill["tools"]:
                if t not in tools:
                    tools.append(t)
            blocks.append(f"### Skill: {skill['name']}\n{skill['instructions']}")
        return {
            "skills": [{"id": s["id"], "name": s["name"], "score": s["score"]} for s in matched],
            "tools": tools,
            "prompt_block": "\n\n".join(blocks),
        }

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "skills": len(self._skills),
                "builtin": sum(1 for s in self._skills.values() if s.builtin),
                "enabled": sum(1 for s in self._skills.values() if s.enabled),
            }


_registry: SkillRegistry | None = None


# --- Curated skill catalog (Claude-style & Gemini-style packs) -----------------

def skill_catalog() -> dict[str, Any]:
    """A curated, browsable catalog of skill packs inspired by Claude and Gemini.

    Distinct from the live matching registry: this is a discoverable menu of
    capabilities (Claude-style artifacts/canvas, Gemini-style deep research /
    gems / multimodal), each mapping to prompts and tool hints the agent can run.
    """
    return {
        "label": "Aetheris skill catalog — Claude-style & Gemini-style packs",
        "families": [
            {
                "family": "Claude-style",
                "note": "Deep work surfaces: artifacts, canvas, code review, projects.",
                "skills": [
                    {
                        "id": "claude_artifacts",
                        "name": "Artifacts",
                        "icon": "🖼️",
                        "description": "Produce runnable code / documents as a live artifact you can preview and iterate on.",
                        "tools": ["create_project", "write_and_verify_code", "generate_image"],
                        "trigger": "Build a reusable artifact I can run and refine.",
                    },
                    {
                        "id": "claude_canvas",
                        "name": "Canvas",
                        "icon": "🎨",
                        "description": "Open a shared workspace to draft, edit, and visualise long-form work collaboratively.",
                        "tools": ["create_project", "think"],
                        "trigger": "Open a canvas and help me draft this iteratively.",
                    },
                    {
                        "id": "claude_code_review",
                        "name": "Code review & pair programming",
                        "icon": "💻",
                        "description": "Architecture-first pair programming with review, debugging, and verified fixes.",
                        "tools": ["code_interpreter", "write_and_verify_code"],
                        "trigger": "Pair-program with me and review my code.",
                    },
                    {
                        "id": "claude_projects",
                        "name": "Projects / context",
                        "icon": "🗂️",
                        "description": "Mount your own documents and grounding so answers are anchored in your material.",
                        "tools": ["document_search", "list_documents"],
                        "trigger": "Use my project files as context.",
                    },
                ],
            },
            {
                "family": "Gemini-style",
                "note": "Broad multimodal depth: research, image understanding, gem specialists.",
                "skills": [
                    {
                        "id": "gemini_deep_research",
                        "name": "Deep Research",
                        "icon": "🔬",
                        "description": "Multi-step agentic research that searches, grounds, and synthesises with citations.",
                        "tools": ["document_search", "web_fetch"],
                        "trigger": "Deep-research this topic with citations.",
                    },
                    {
                        "id": "gemini_image_understanding",
                        "name": "Vision & image understanding",
                        "icon": "👁️",
                        "description": "Attach an image and have it analysed, described, or turned into code / copy.",
                        "tools": ["generate_image"],
                        "trigger": "Analyse the image I attached.",
                    },
                    {
                        "id": "gemini_gems",
                        "name": "Gems (specialist personas)",
                        "icon": "💎",
                        "description": "Spin up a custom agent persona with a system prompt and tool set for a domain.",
                        "tools": ["think"],
                        "trigger": "Create a specialist 'gem' for [domain].",
                    },
                    {
                        "id": "gemini_multimodal",
                        "name": "Multimodal synthesis",
                        "icon": "🌐",
                        "description": "Combine text, images, audio, and code in one workflow — create then narrate.",
                        "tools": ["generate_image", "generate_audio"],
                        "trigger": "Create an image and compose matching audio.",
                    },
                ],
            },
        ],
    }


def get_skill_registry() -> SkillRegistry:
    global _registry
    if _registry is None:
        _registry = SkillRegistry()
    return _registry


__all__ = ["SkillRegistry", "SkillIn", "MatchRequest", "get_skill_registry", "skill_catalog"]
