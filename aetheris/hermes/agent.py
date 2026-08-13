"""Aetheris Hermes — the unified agent.

This is the single entry point that connects every previously-disconnected part
of the system into one pipeline:

    perceive → classify → adapt (meta-learning) → deliberate → ground
             → route (MoE) → recall (NOVA memory) → act (toolbelt)
             → synthesize → polish → learn

Every stage is real and runs offline. The two pillars of the foundation are both
live here rather than described in a spec file:

* **Hermes Agent** — the plan → act → observe → self-correct loop, with the
  toolbelt executed for real (sandboxed Python, BM25 retrieval, calculators,
  media synthesis) and every call traced.
* **Meta-Learning** — :mod:`aetheris.hermes.meta_learning` adapts the agent
  *before* each run (few-shot exemplars, intent priors, tool priors, strategy)
  and learns from the outcome *after* it.

The agent degrades gracefully: if an optional subsystem (NOVA memory, the MoE
router, an upstream LLM) is unavailable or disabled, that stage is skipped and
recorded as skipped rather than failing the request.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from ..core.config import settings
from .cognition import (
    Classification,
    Deliberation,
    GroundingHit,
    Perception,
    check_safety,
    classify,
    deliberate,
    ground,
    perceive,
    polish,
)
from .meta_learning import Adaptation, Strategy, get_meta_learner
from .synthesis import synthesize

logger = logging.getLogger("aetheris.hermes")

# Tools the agent may select autonomously, mapped from intent + signals.
_INTENT_TOOLS: dict[str, tuple[str, ...]] = {
    "math": ("calculator",),
    "convert": ("calculator",),
    "datetime": ("current_time",),
    "code_gen": ("code_interpreter",),
    "code_debug": ("code_interpreter",),
    "file_qa": ("document_search",),
    "explain": ("document_search",),
    "summarize": ("document_search",),
    "analyze": ("document_search",),
    "image": ("generate_image",),
    "diagram": ("generate_image",),
    "palette": ("generate_image",),
}


@dataclass
class StageTrace:
    """One observable stage of the cascade."""

    name: str
    summary: str
    duration_ms: float = 0.0
    detail: dict[str, Any] = field(default_factory=dict)
    skipped: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "stage": self.name,
            "summary": self.summary,
            "duration_ms": round(self.duration_ms, 3),
            "skipped": self.skipped,
            "detail": self.detail,
        }


@dataclass
class HermesResult:
    """The full outcome of one Hermes run."""

    answer: str
    intent: str
    confidence: float
    episode_id: str = ""
    stages: list[StageTrace] = field(default_factory=list)
    tool_trace: list[dict[str, Any]] = field(default_factory=list)
    grounded: bool = False
    solved_exactly: bool = False
    safety_flag: bool = False
    strategy: dict[str, float] = field(default_factory=dict)
    adaptation: dict[str, Any] = field(default_factory=dict)
    experts: list[dict[str, Any]] = field(default_factory=list)
    reward: float = 0.0
    duration_ms: float = 0.0
    mode: str = "general"

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "intent": self.intent,
            "confidence": round(self.confidence, 4),
            "episode_id": self.episode_id,
            "grounded": self.grounded,
            "solved_exactly": self.solved_exactly,
            "safety_flag": self.safety_flag,
            "reward": round(self.reward, 4),
            "duration_ms": round(self.duration_ms, 2),
            "strategy": self.strategy,
            "adaptation": self.adaptation,
            "experts": self.experts,
            "stages": [s.to_dict() for s in self.stages],
            "tool_trace": self.tool_trace,
            "mode": self.mode,
        }


class HermesAgent:
    """The unified offline agent: cognition + tools + memory + meta-learning."""

    def __init__(self) -> None:
        self.meta = get_meta_learner()

    # --- main entry point ---------------------------------------------------

    async def run(
        self,
        task: str,
        *,
        use_tools: bool | None = None,
        use_memory: bool = True,
        learn: bool = True,
        max_tools: int = 3,
        session_id: str = "",
        mode: str = "",
    ) -> HermesResult:
        """Execute the full cascade for one task."""
        started = time.perf_counter()
        stages: list[StageTrace] = []

        def stage(name: str, summary: str, t0: float, **detail: Any) -> None:
            stages.append(
                StageTrace(
                    name=name,
                    summary=summary,
                    duration_ms=(time.perf_counter() - t0) * 1000,
                    detail=detail,
                )
            )

        def skip(name: str, why: str) -> None:
            stages.append(StageTrace(name=name, summary=why, skipped=True))

        # 0. Safety gate — refuse before doing any work.
        blocked, reason = check_safety(task)
        if blocked:
            verdict = polish("", request=task)
            duration = (time.perf_counter() - started) * 1000
            skip("perceive", "bypassed: request refused at the safety gate")
            stages.append(
                StageTrace(name="polish", summary=f"refused ({reason})", detail={"reason": reason})
            )
            return HermesResult(
                answer=verdict.text,
                intent="refused",
                confidence=1.0,
                stages=stages,
                safety_flag=True,
                duration_ms=duration,
            )

        # 1. Perceive.
        t0 = time.perf_counter()
        perception = perceive(task)
        stage(
            "perceive",
            f"{len(perception.tokens)} tokens · {perception.language} · "
            f"sentiment {perception.sentiment:+.2f}",
            t0,
            **perception.to_dict(),
        )

        # 2. Classify.
        t0 = time.perf_counter()
        classification = classify(perception)
        stage(
            "classify",
            f"intent={classification.intent} ({classification.confidence:.0%})",
            t0,
            **classification.to_dict(),
        )

        # 3. Adapt — meta-learning inner loop, before any work is done.
        t0 = time.perf_counter()
        adaptation = self.meta.adapt(task, intent_hint=classification.intent)
        classification = self._apply_prior(classification, adaptation)
        strategy = adaptation.strategy
        skill_pack = self._match_skills(task)
        stage(
            "adapt",
            f"familiarity {adaptation.familiarity:.2f} · "
            f"{len(adaptation.exemplars)} exemplar(s) · "
            f"{adaptation.episodes_seen} episode(s) learned from"
            + (f" · skills {', '.join(s['name'] for s in skill_pack.get('skills', []))}" if skill_pack.get("skills") else ""),
            t0,
            **adaptation.to_dict(),
            skills=skill_pack.get("skills") or None,
        )

        # 4. Deliberate — exact symbolic computation.
        t0 = time.perf_counter()
        deliberation = deliberate(task)
        stage(
            "deliberate",
            f"{deliberation.type}: {deliberation.output}" if deliberation.solved else "no exact form",
            t0,
            **deliberation.to_dict(),
        )

        # 5. Ground — built-in corpus + any mounted documents + knowledge graph.
        t0 = time.perf_counter()
        hits = self._ground(task, strategy)
        mounted = self._search_mounted(task, strategy)
        graph_ctx = self._graph_ground(task)
        stage(
            "ground",
            f"{len(hits)} corpus hit(s), {len(mounted)} mounted-document hit(s)"
            + (f", {len(graph_ctx.get('linked', []))} graph entit(y/ies)" if graph_ctx else ""),
            t0,
            corpus=[h.to_dict() for h in hits],
            documents=mounted,
            graph=graph_ctx or None,
        )

        # 6. Route — NOVA sparse mixture-of-experts.
        t0 = time.perf_counter()
        experts = self._route(task)
        if experts:
            stage(
                "route",
                "experts: "
                + ", ".join(
                    str(e.get("name") or e.get("id") or "unknown") for e in experts
                ),
                t0,
                experts=experts,
            )
        else:
            skip("route", "MoE router unavailable or NOVA disabled")

        # 7. Recall — NOVA hierarchical memory.
        memory_context = ""
        if use_memory:
            t0 = time.perf_counter()
            memory_context = self._recall(task)
            stage(
                "recall",
                f"{len(memory_context)} chars of episodic/archival context"
                if memory_context
                else "no prior memory matched",
                t0,
                chars=len(memory_context),
            )
        else:
            skip("recall", "memory disabled for this request")

        # 8. Act — run the toolbelt for real.
        tool_trace: list[dict[str, Any]] = []
        tools_enabled = settings.tools_enabled if use_tools is None else use_tools
        if tools_enabled:
            t0 = time.perf_counter()
            tool_trace = await self._act(
                task, classification, deliberation, adaptation, strategy, max_tools,
                extra_tools=skill_pack.get("tools") or None,
            )
            stage(
                "act",
                f"{len(tool_trace)} tool call(s), "
                f"{sum(1 for t in tool_trace if t.get('ok'))} succeeded",
                t0,
                calls=tool_trace,
            )
        else:
            skip("act", "tools disabled for this request")

        # 9. Synthesize.
        t0 = time.perf_counter()
        draft = synthesize(
            task,
            perception,
            classification,
            deliberation,
            hits,
            strategy,
            tool_outputs=tool_trace or None,
        )
        draft = self._attach_context(draft, mounted, memory_context, strategy, graph_ctx)
        stage("synthesize", f"{len(draft)} chars composed", t0, length=len(draft))

        # 10. Polish — safety, vendor-voice stripping, honesty, constitution.
        t0 = time.perf_counter()
        grounded = bool(hits or mounted or tool_trace or (graph_ctx and graph_ctx.get("linked")))
        verdict = polish(draft, grounded=grounded, request=task)
        answer = verdict.text
        if verdict.honesty_note:
            answer = f"{answer}\n\n> {verdict.honesty_note}"
        constitution = self._apply_constitution(answer, request=task, grounded=grounded)
        if constitution and constitution.get("text"):
            answer = constitution["text"]
        if mode and not verdict.safety_flag:
            from ..core.mode_style import style_answer

            answer = style_answer(
                mode,
                answer,
                task=task,
                exact=deliberation.solved,
                refused=verdict.safety_flag,
            )
        stage(
            "polish",
            "safe" if not verdict.safety_flag else "gated",
            t0,
            **verdict.to_dict(),
            constitution=constitution,
            mode=mode or "general",
        )

        duration = (time.perf_counter() - started) * 1000

        # 11. Learn — meta-learning outer loop.
        episode_id = ""
        reward = 0.0
        if learn:
            t0 = time.perf_counter()
            episode = self.meta.record(
                task=task,
                intent=classification.intent,
                answer=answer,
                tools_used=[t["tool"] for t in tool_trace],
                tool_success={t["tool"]: bool(t.get("ok")) for t in tool_trace},
                strategy=strategy,
                grounded=grounded,
                solved_exactly=deliberation.solved,
                duration_ms=duration,
            )
            episode_id = episode.id
            reward = episode.reward
            stage(
                "learn",
                f"episode {episode.id} recorded · reward {episode.reward:.2f}",
                t0,
                episode=episode.to_dict(),
                strategy_after=self.meta.strategy.as_dict(),
            )
            self._remember(task, answer, session_id)
            self._record_provenance(
                task, answer, hits, mounted, tool_trace, graph_ctx, episode_id
            )
        else:
            skip("learn", "learning disabled for this request")

        return HermesResult(
            answer=answer,
            intent=classification.intent,
            confidence=classification.confidence,
            episode_id=episode_id,
            stages=stages,
            tool_trace=tool_trace,
            grounded=grounded,
            solved_exactly=deliberation.solved,
            safety_flag=verdict.safety_flag,
            strategy=strategy.as_dict(),
            adaptation=adaptation.to_dict(),
            experts=experts,
            reward=reward,
            duration_ms=duration,
            mode=mode or "general",
        )

    # --- stage helpers ------------------------------------------------------

    @staticmethod
    def _apply_prior(classification: Classification, adaptation: Adaptation) -> Classification:
        """Let the learned intent prior break low-confidence ties."""
        if classification.confidence >= 0.6 or not adaptation.intent_prior:
            return classification
        candidates = {classification.intent: classification.confidence}
        for name, score in classification.alternatives:
            candidates[name] = score
        best, best_score = classification.intent, -1.0
        for name, score in candidates.items():
            adjusted = score + 0.4 * adaptation.intent_prior.get(name, 0.0)
            if adjusted > best_score:
                best, best_score = name, adjusted
        if best != classification.intent:
            logger.debug("Meta prior reassigned intent %s → %s", classification.intent, best)
            return Classification(
                intent=best,
                confidence=min(1.0, best_score),
                alternatives=classification.alternatives,
            )
        return classification

    @staticmethod
    def _ground(task: str, strategy: Strategy) -> list[GroundingHit]:
        top_k = 1 + int(strategy.grounding_weight * 3)
        return ground(task, top_k=top_k)

    @staticmethod
    def _graph_ground(task: str) -> dict[str, Any]:
        """Multi-hop Graph RAG over the in-process knowledge graph."""
        if not getattr(settings, "knowledge_graph_enabled", False):
            return {}
        try:
            from ..core.knowledge_graph import GraphQuery, get_knowledge_graph

            result = get_knowledge_graph().query(GraphQuery(query=task, hops=2, limit=8))
            if not result.get("linked") and not result.get("neighborhood"):
                return {}
            return result
        except Exception:  # pragma: no cover - grounding is best-effort
            logger.debug("Knowledge-graph grounding failed", exc_info=True)
            return {}

    @staticmethod
    def _match_skills(task: str) -> dict[str, Any]:
        if not getattr(settings, "skills_enabled", False):
            return {}
        try:
            from ..core.skills import get_skill_registry

            return get_skill_registry().compose(task, top_k=2, threshold=0.35)
        except Exception:  # pragma: no cover
            logger.debug("Skill matching failed", exc_info=True)
            return {}

    @staticmethod
    def _apply_constitution(text: str, *, request: str, grounded: bool) -> dict[str, Any]:
        if not getattr(settings, "constitution_enabled", False):
            return {}
        try:
            from ..core.constitution import get_constitution_engine

            return get_constitution_engine().decide(text, request=request, grounded=grounded)
        except Exception:  # pragma: no cover
            logger.debug("Constitution pass failed", exc_info=True)
            return {}

    @staticmethod
    def _record_provenance(
        task: str,
        answer: str,
        hits: list[Any],
        mounted: list[dict[str, Any]],
        tool_trace: list[dict[str, Any]],
        graph_ctx: dict[str, Any],
        generation_id: str,
    ) -> None:
        if not getattr(settings, "provenance_enabled", False):
            return
        try:
            from ..core.provenance import ProvenanceRecordIn, SourceIn, get_provenance_store

            sources: list[SourceIn] = []
            for hit in hits[:4]:
                article = getattr(hit, "article", None)
                sources.append(
                    SourceIn(
                        kind="corpus",
                        ref=getattr(article, "id", ""),
                        title=getattr(article, "title", ""),
                        snippet=(getattr(article, "content", "") or "")[:800],
                        score=float(getattr(hit, "score", 0.0) or 0.0),
                    )
                )
            for doc in mounted[:4]:
                sources.append(
                    SourceIn(
                        kind="document",
                        ref=str(doc.get("doc_id") or doc.get("id") or ""),
                        title=str(doc.get("doc_title") or doc.get("title") or ""),
                        snippet=str(doc.get("text") or "")[:800],
                        score=float(doc.get("score") or 0.0),
                    )
                )
            for call in tool_trace[:4]:
                sources.append(
                    SourceIn(
                        kind="tool",
                        ref=str(call.get("tool") or ""),
                        title=str(call.get("tool") or "tool"),
                        snippet=str(call.get("output") or "")[:800],
                        score=1.0 if call.get("ok") else 0.0,
                    )
                )
            for node in (graph_ctx or {}).get("linked", [])[:4]:
                sources.append(
                    SourceIn(
                        kind="graph",
                        ref=str(node.get("id") or ""),
                        title=str(node.get("name") or ""),
                        snippet=str(node.get("name") or ""),
                        score=1.0,
                    )
                )
            if not sources:
                return
            get_provenance_store().record(
                ProvenanceRecordIn(
                    query=task,
                    answer=answer,
                    sources=sources,
                    generation_id=generation_id,
                )
            )
        except Exception:  # pragma: no cover
            logger.debug("Provenance record failed", exc_info=True)

    @staticmethod
    def _search_mounted(task: str, strategy: Strategy) -> list[dict[str, Any]]:
        """Query the operator-mounted RAG corpus, if any documents are loaded."""
        if not settings.rag_enabled:
            return []
        try:
            from ..tools.retrieval import get_index

            index = get_index()
            if not index.documents:
                return []
            hits = index.search(task, top_k=max(1, int(strategy.grounding_weight * 4)))
            return [h.to_dict() for h in hits]
        except Exception:  # pragma: no cover - retrieval is best-effort
            logger.debug("Mounted-document search failed", exc_info=True)
            return []

    @staticmethod
    def _route(task: str) -> list[dict[str, Any]]:
        if not getattr(settings, "nova_enabled", False):
            return []
        try:
            from ..services.moe import get_router

            _, report = get_router().compose_system_prompt(task)
            return report
        except Exception:  # pragma: no cover
            logger.debug("MoE routing failed", exc_info=True)
            return []

    @staticmethod
    def _recall(task: str) -> str:
        """Associative recall of *relevant* prior memories.

        Deliberately uses ``search`` rather than ``context_window``: the latter
        always prepends the standing core facts, which would attach boilerplate
        to every answer including one-word greetings. Only genuine matches above
        a score floor are surfaced.
        """
        if not getattr(settings, "nova_enabled", False):
            return ""
        try:
            from ..services.memory import get_memory

            hits = get_memory().search(task, top_k=3)
        except Exception:  # pragma: no cover
            logger.debug("Memory recall failed", exc_info=True)
            return ""

        lines: list[str] = []
        for hit in hits:
            if float(hit.get("score", 0)) < 3.0:
                continue
            snippet = " ".join(str(hit.get("text", "")).split())
            if len(snippet) > 240:
                snippet = snippet[:240] + "…"
            if snippet:
                lines.append(f"- [{hit.get('tier')}] {snippet}")
        return "\n".join(lines[:3])

    @staticmethod
    def _remember(task: str, answer: str, session_id: str) -> None:
        if not getattr(settings, "nova_enabled", False):
            return
        try:
            from ..services.memory import get_memory

            memory = get_memory()
            memory.remember_episode("user", task, metadata={"session": session_id})
            memory.remember_episode("assistant", answer[:2000], metadata={"session": session_id})
        except Exception:  # pragma: no cover
            logger.debug("Memory write failed", exc_info=True)

    async def _act(
        self,
        task: str,
        classification: Classification,
        deliberation: Deliberation,
        adaptation: Adaptation,
        strategy: Strategy,
        max_tools: int,
        extra_tools: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Select and execute tools — the act/observe half of the agent loop."""
        from ..tools import registry

        selected = self._select_tools(
            task, classification, deliberation, adaptation, strategy, extra_tools=extra_tools
        )
        if not selected:
            return []

        available = {tool.name for tool in registry.all_tools()}
        selected = [(name, args) for name, args in selected if name in available][:max_tools]
        if not selected:
            return []

        breaker = None
        if getattr(settings, "circuit_breakers_enabled", False):
            try:
                from ..core.circuit_breakers import get_breaker_registry

                breaker = get_breaker_registry()
            except Exception:  # pragma: no cover
                breaker = None

        runnable: list[tuple[str, dict[str, Any]]] = []
        blocked: list[dict[str, Any]] = []
        for name, args in selected:
            if breaker is not None:
                probe = breaker.allow(f"tool:{name}")
                if not probe.allowed:
                    blocked.append(
                        {
                            "tool": name,
                            "arguments": args,
                            "ok": False,
                            "output": "",
                            "error": f"circuit open: {probe.reason}",
                            "duration_ms": 0,
                        }
                    )
                    continue
            runnable.append((name, args))

        results = await asyncio.gather(
            *(registry.execute(name, args, step=index) for index, (name, args) in enumerate(runnable, 1)),
            return_exceptions=True,
        ) if runnable else []

        trace: list[dict[str, Any]] = list(blocked)
        for (name, args), outcome in zip(runnable, results):
            if isinstance(outcome, BaseException):
                if breaker is not None:
                    breaker.record_failure(f"tool:{name}")
                trace.append(
                    {"tool": name, "arguments": args, "ok": False, "output": "",
                     "error": f"{type(outcome).__name__}: {outcome}", "duration_ms": 0}
                )
                continue
            if breaker is not None:
                if outcome.ok:
                    breaker.record_success(f"tool:{name}")
                else:
                    breaker.record_failure(f"tool:{name}")
            trace.append(
                {
                    "tool": outcome.tool,
                    "arguments": outcome.arguments,
                    "ok": outcome.ok,
                    "output": outcome.output,
                    "error": outcome.error,
                    "duration_ms": outcome.duration_ms,
                }
            )
        return trace

    def _select_tools(
        self,
        task: str,
        classification: Classification,
        deliberation: Deliberation,
        adaptation: Adaptation,
        strategy: Strategy,
        extra_tools: list[str] | None = None,
    ) -> list[tuple[str, dict[str, Any]]]:
        """Decide which tools to call, informed by learned tool priors."""
        selected: list[tuple[str, dict[str, Any]]] = []
        intent = classification.intent
        lowered = task.lower()

        candidates = list(_INTENT_TOOLS.get(intent, ()))
        for extra in extra_tools or ():
            if extra not in candidates:
                candidates.append(extra)

        # A fenced code block is an intent-independent signal: the user pasted
        # code, so the sandbox is relevant no matter how the text classified.
        # (Without this, "run this: ```print(6*7)```" classifies as math because
        # of the arithmetic inside the block, and never gets executed.)
        if self._code_block(task) and "code_interpreter" not in candidates:
            candidates.insert(0, "code_interpreter")
        # Learned preferences get first refusal.
        for tool in adaptation.preferred_tools:
            if tool not in candidates:
                candidates.insert(0, tool)
        # Tools that keep failing for this intent are dropped.
        candidates = [c for c in candidates if c not in adaptation.discouraged_tools]

        # Eagerness gates optional tool use; an exact solution needs no calculator.
        threshold = 1.0 - strategy.tool_eagerness

        for tool in candidates:
            if tool == "calculator":
                if deliberation.solved:
                    continue  # already solved exactly and for free
                expression = self._expression(task)
                if expression:
                    selected.append(("calculator", {"expression": expression}))
            elif tool == "current_time":
                selected.append(("current_time", {}))
            elif tool == "document_search":
                # Only worth a call when documents are actually mounted —
                # otherwise it burns a step to report emptiness.
                if (
                    settings.rag_enabled
                    and strategy.grounding_weight >= threshold
                    and self._has_documents()
                ):
                    selected.append(("document_search", {"query": task, "top_k": 3}))
            elif tool == "code_interpreter":
                code = self._code_block(task)
                if code and settings.sandbox_enabled:
                    selected.append(("code_interpreter", {"code": code}))
            elif tool == "generate_image":
                if any(w in lowered for w in ("image", "picture", "poster", "art", "draw", "diagram", "palette")):
                    selected.append(("generate_image", {"prompt": task}))
            else:
                selected.append((tool, {"query": task} if "search" in tool else {}))

        # De-duplicate, preserving order.
        seen: set[str] = set()
        unique: list[tuple[str, dict[str, Any]]] = []
        for name, args in selected:
            if name not in seen:
                seen.add(name)
                unique.append((name, args))
        return unique

    @staticmethod
    def _has_documents() -> bool:
        """Whether the operator-mounted RAG corpus holds anything searchable."""
        try:
            from ..tools.retrieval import get_index

            return bool(get_index().documents)
        except Exception:  # pragma: no cover
            return False

    @staticmethod
    def _expression(task: str) -> str:
        import re

        match = re.search(r"[-+]?[\d.()\s]*[-+*/^%][\d.()\s+\-*/^%]*\d", task)
        return match.group(0).strip() if match else ""

    @staticmethod
    def _code_block(task: str) -> str:
        import re

        match = re.search(r"```(?:python|py)?\s*\n(.*?)```", task, re.DOTALL)
        return match.group(1).strip() if match else ""

    @staticmethod
    def _attach_context(
        draft: str,
        mounted: list[dict[str, Any]],
        memory_context: str,
        strategy: Strategy,
        graph_ctx: dict[str, Any] | None = None,
    ) -> str:
        """Append grounded material from mounted docs, memory, and the knowledge graph."""
        blocks = [draft]
        if mounted and strategy.grounding_weight > 0.35:
            blocks.append("")
            blocks.append("**From your mounted documents**")
            for hit in mounted[:3]:
                title = hit.get("doc_title") or hit.get("title") or hit.get("doc_id", "document")
                text = (hit.get("text") or "").strip().replace("\n", " ")
                if len(text) > 320:
                    text = text[:320] + "…"
                blocks.append(f"- *{title}* — {text}")
        if memory_context and strategy.grounding_weight > 0.5:
            blocks.append("")
            blocks.append("**Recalled from earlier sessions**")
            snippet = memory_context.strip()
            blocks.append(snippet[:600] + ("…" if len(snippet) > 600 else ""))
        grounding = (graph_ctx or {}).get("grounding") or ""
        if grounding and strategy.grounding_weight > 0.4 and (graph_ctx or {}).get("linked"):
            blocks.append("")
            blocks.append("**From the knowledge graph**")
            blocks.append(grounding[:700])
        return "\n".join(blocks)

    # --- feedback -----------------------------------------------------------

    def reinforce(self, episode_id: str, reward: float, feedback: str = "") -> dict[str, Any] | None:
        """Apply explicit user feedback to a past episode."""
        episode = self.meta.reinforce(episode_id, reward, feedback)
        return episode.to_dict() if episode else None

    def stats(self) -> dict[str, Any]:
        return self.meta.stats()


# --- Process-wide singleton ----------------------------------------------------

_agent: HermesAgent | None = None


def get_hermes() -> HermesAgent:
    """Return the process-wide Hermes agent."""
    global _agent
    if _agent is None:
        _agent = HermesAgent()
    return _agent


async def run_hermes(task: str, **kwargs: Any) -> HermesResult:
    """Convenience wrapper: run one task through the unified agent."""
    return await get_hermes().run(task, **kwargs)


__all__ = ["HermesAgent", "HermesResult", "StageTrace", "get_hermes", "run_hermes"]
