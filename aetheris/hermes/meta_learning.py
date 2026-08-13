"""Aetheris Hermes — the Meta-Learning engine (learning to learn).

This is the second pillar of the *Hermes Agent + Meta-Learning* foundation, and
it is a **live runtime component**, not a spec entry. Every episode the agent
runs is written here, and what is learned changes how the next episode behaves.

What actually adapts
--------------------
* **Intent priors** — a Dirichlet-smoothed prior over which intent the classifier
  should favour, corrected by observed outcomes. A weak or wrong classification
  that the user corrects shifts the prior for similar inputs.
* **Episodic exemplars** — successful episodes are stored as few-shot exemplars,
  keyed by a trigram signature. On a new task the nearest exemplars are injected
  into context. This is the in-context / few-shot adaptation path.
* **Tool priors** — per-intent success statistics for each tool, so the agent
  learns which tool tends to resolve which kind of task, and stops reaching for
  tools that keep failing.
* **Strategy weights** — a Reptile-style slow update over the *policy* knobs
  (reasoning depth, grounding aggressiveness, tool eagerness). Each episode
  computes a fast-adapted local optimum, and the global weights step toward it
  by a small meta learning rate, so the system converges on what works without
  overfitting to one conversation.

The algorithms are deliberately simple, online, and dependency-free: they run in
microseconds, need no gradients or GPU, and work fully offline. They are real
learning rules, just cheap ones.
"""

from __future__ import annotations

import json
import math
import re
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Iterable

_WORD_RE = re.compile(r"[A-Za-z0-9_]+")

# Reptile-style meta-update rate: how far the global strategy steps toward each
# episode's fast-adapted optimum. Small, so one bad episode cannot derail it.
META_LR = 0.12
# Exponential decay applied to older evidence, so the learner tracks drift.
DECAY = 0.995


def _tokens(text: str) -> list[str]:
    return [t.lower() for t in _WORD_RE.findall(text or "")]


def _signature(text: str) -> Counter[str]:
    """A trigram bag used for cheap fuzzy similarity between tasks."""
    s = (text or "").lower().strip()
    sig: Counter[str] = Counter()
    for i in range(max(len(s) - 2, 0)):
        sig[s[i : i + 3]] += 1
    return sig


def _cosine(a: Counter[str], b: Counter[str]) -> float:
    if not a or not b:
        return 0.0
    shared = a.keys() & b.keys()
    dot = sum(a[t] * b[t] for t in shared)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / max(na * nb, 1e-9)


# --- Strategy ----------------------------------------------------------------

@dataclass
class Strategy:
    """The adaptive policy knobs the meta-learner tunes.

    All values are in ``[0, 1]`` and are consumed by the Hermes agent to decide
    how hard to think, how much to ground, and how eagerly to reach for tools.
    """

    reasoning_depth: float = 0.45
    grounding_weight: float = 0.55
    tool_eagerness: float = 0.50
    verbosity: float = 0.50
    verification: float = 0.40

    def as_dict(self) -> dict[str, float]:
        return {k: round(v, 4) for k, v in asdict(self).items()}

    def blend(self, other: Strategy, rate: float) -> Strategy:
        """Interpolate toward ``other`` by ``rate`` (the Reptile meta-step)."""
        return Strategy(
            **{
                key: _clamp(value + rate * (getattr(other, key) - value))
                for key, value in asdict(self).items()
            }
        )


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


# --- Episodes ----------------------------------------------------------------

@dataclass
class Episode:
    """One recorded task the agent performed, with its outcome."""

    id: str
    task: str
    intent: str
    reward: float
    tools_used: list[str] = field(default_factory=list)
    strategy: dict[str, float] = field(default_factory=dict)
    answer_preview: str = ""
    grounded: bool = False
    solved_exactly: bool = False
    duration_ms: float = 0.0
    created_at: float = field(default_factory=time.time)
    feedback: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Exemplar:
    """A stored few-shot demonstration retrieved for similar future tasks."""

    task: str
    intent: str
    answer: str
    reward: float
    created_at: float = field(default_factory=time.time)


@dataclass
class Adaptation:
    """What the meta-learner recommends for the task about to be run."""

    intent_prior: dict[str, float] = field(default_factory=dict)
    exemplars: list[Exemplar] = field(default_factory=list)
    preferred_tools: list[str] = field(default_factory=list)
    discouraged_tools: list[str] = field(default_factory=list)
    strategy: Strategy = field(default_factory=Strategy)
    familiarity: float = 0.0
    episodes_seen: int = 0
    rationale: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent_prior": {k: round(v, 4) for k, v in self.intent_prior.items()},
            "exemplars": [
                {
                    "task": e.task[:200],
                    "intent": e.intent,
                    "reward": round(e.reward, 3),
                    "answer_preview": e.answer[:220],
                }
                for e in self.exemplars
            ],
            "preferred_tools": self.preferred_tools,
            "discouraged_tools": self.discouraged_tools,
            "strategy": self.strategy.as_dict(),
            "familiarity": round(self.familiarity, 4),
            "episodes_seen": self.episodes_seen,
            "rationale": self.rationale,
        }

    def prompt_block(self) -> str:
        """Render the adaptation as a system-context block for the model."""
        if not self.exemplars and self.familiarity < 0.2:
            return ""
        lines: list[str] = ["Meta-learned context from prior episodes (adapt, do not quote):"]
        if self.exemplars:
            lines.append("")
            lines.append("Similar tasks you handled well before:")
            for index, exemplar in enumerate(self.exemplars, start=1):
                answer = " ".join(exemplar.answer.split())[:280]
                lines.append(f"  [{index}] task: {' '.join(exemplar.task.split())[:160]}")
                lines.append(f"      approach that worked: {answer}")
        if self.preferred_tools:
            lines.append(f"Tools that have resolved this kind of task: {', '.join(self.preferred_tools)}.")
        if self.discouraged_tools:
            lines.append(f"Tools that repeatedly failed here: {', '.join(self.discouraged_tools)}.")
        return "\n".join(lines)


# --- The learner --------------------------------------------------------------

class MetaLearner:
    """Online learning-to-learn over the agent's own episodes.

    Thread-safe and bounded. All state is in-process by default; call
    :meth:`save` / :meth:`load` to persist across restarts.
    """

    def __init__(
        self,
        *,
        max_episodes: int = 2_000,
        max_exemplars: int = 400,
        exemplar_reward_floor: float = 0.6,
    ) -> None:
        self._lock = threading.RLock()
        self.max_episodes = max_episodes
        self.max_exemplars = max_exemplars
        self.exemplar_reward_floor = exemplar_reward_floor

        self.strategy = Strategy()
        self._episodes: deque[Episode] = deque(maxlen=max_episodes)
        self._exemplars: list[tuple[Counter[str], Exemplar]] = []
        # intent -> pseudo-count (Dirichlet prior, starts uniform-ish at 1.0)
        self._intent_counts: defaultdict[str, float] = defaultdict(lambda: 1.0)
        # (intent, tool) -> [successes, attempts]
        self._tool_stats: defaultdict[tuple[str, str], list[float]] = defaultdict(
            lambda: [0.0, 0.0]
        )
        # intent -> exponentially-weighted mean reward
        self._intent_reward: defaultdict[str, float] = defaultdict(lambda: 0.5)
        self._updates = 0

    # --- adaptation (the "inner loop" read path) ---------------------------

    def adapt(self, task: str, *, intent_hint: str = "", top_k: int = 3) -> Adaptation:
        """Produce a task-specific adaptation *before* the agent runs.

        This is the few-shot inner loop: find nearest prior episodes, derive an
        intent prior and tool preferences from them, and fast-adapt the strategy
        knobs to the local neighbourhood.
        """
        signature = _signature(task)
        with self._lock:
            neighbours = self._nearest(signature, top_k=max(top_k, 3))
            rationale: list[str] = []

            # Familiarity = how close the nearest prior task is.
            familiarity = neighbours[0][0] if neighbours else 0.0

            exemplars = [
                exemplar
                for score, exemplar in neighbours
                if score >= 0.28 and exemplar.reward >= self.exemplar_reward_floor
            ][:top_k]
            if exemplars:
                rationale.append(
                    f"{len(exemplars)} similar high-reward episode(s) retrieved "
                    f"(max similarity {familiarity:.2f})."
                )

            # Intent prior: Dirichlet-smoothed global counts, sharpened toward
            # the intents that neighbouring tasks actually resolved as.
            total = sum(self._intent_counts.values()) or 1.0
            prior: dict[str, float] = {}
            for intent, count in self._intent_counts.items():
                prior[intent] = count / total
            neighbour_intents = Counter(e.intent for _, e in neighbours if _ >= 0.28)
            if neighbour_intents:
                bump = sum(neighbour_intents.values())
                for intent, count in neighbour_intents.items():
                    prior[intent] = prior.get(intent, 0.0) + 0.35 * (count / bump)
                normaliser = sum(prior.values()) or 1.0
                prior = {k: v / normaliser for k, v in prior.items()}
                rationale.append(
                    "Intent prior sharpened toward "
                    + ", ".join(f"{i}" for i, _ in neighbour_intents.most_common(2))
                    + "."
                )

            # Tool priors for the hinted/likely intent.
            focus = intent_hint or (neighbours[0][1].intent if neighbours else "")
            preferred, discouraged = self._tool_preferences(focus)
            if preferred:
                rationale.append(f"Preferring tools: {', '.join(preferred)}.")
            if discouraged:
                rationale.append(f"Avoiding tools: {', '.join(discouraged)}.")

            # Fast adaptation: start from the global strategy and shift it
            # toward what worked on the neighbours (the "inner-loop" step).
            adapted = self._fast_adapt(task, neighbours, focus)
            if adapted.as_dict() != self.strategy.as_dict():
                rationale.append("Strategy fast-adapted to the local task neighbourhood.")

            return Adaptation(
                intent_prior=dict(sorted(prior.items(), key=lambda kv: -kv[1])[:8]),
                exemplars=exemplars,
                preferred_tools=preferred,
                discouraged_tools=discouraged,
                strategy=adapted,
                familiarity=familiarity,
                episodes_seen=len(self._episodes),
                rationale=rationale,
            )

    def _nearest(self, signature: Counter[str], top_k: int) -> list[tuple[float, Exemplar]]:
        scored = [
            (_cosine(signature, sig), exemplar) for sig, exemplar in self._exemplars
        ]
        scored.sort(key=lambda pair: -pair[0])
        return scored[:top_k]

    def _tool_preferences(self, intent: str) -> tuple[list[str], list[str]]:
        if not intent:
            return [], []
        preferred: list[tuple[float, str]] = []
        discouraged: list[tuple[float, str]] = []
        for (stat_intent, tool), (successes, attempts) in self._tool_stats.items():
            if stat_intent != intent or attempts < 2:
                continue
            # Laplace-smoothed success rate.
            rate = (successes + 1.0) / (attempts + 2.0)
            if rate >= 0.6:
                preferred.append((rate, tool))
            elif rate <= 0.34:
                discouraged.append((rate, tool))
        preferred.sort(key=lambda pair: -pair[0])
        discouraged.sort(key=lambda pair: pair[0])
        return [t for _, t in preferred[:4]], [t for _, t in discouraged[:3]]

    def _fast_adapt(
        self, task: str, neighbours: list[tuple[float, Exemplar]], intent: str
    ) -> Strategy:
        """One inner-loop gradient-free step from the global strategy."""
        strategy = Strategy(**asdict(self.strategy))

        # Task-surface heuristics (the "support set" signal).
        lowered = task.lower()
        length = len(_tokens(task))
        if length > 60 or any(
            w in lowered for w in ("prove", "derive", "why", "trade-off", "architecture", "design")
        ):
            strategy.reasoning_depth = _clamp(strategy.reasoning_depth + 0.2)
        if length <= 6:
            strategy.reasoning_depth = _clamp(strategy.reasoning_depth - 0.15)
            strategy.verbosity = _clamp(strategy.verbosity - 0.2)
        if re.search(r"\d", task) or any(
            w in lowered for w in ("calculate", "compute", "convert", "run", "execute")
        ):
            strategy.tool_eagerness = _clamp(strategy.tool_eagerness + 0.2)
            strategy.verification = _clamp(strategy.verification + 0.15)
        if any(w in lowered for w in ("cite", "source", "document", "according to", "paper")):
            strategy.grounding_weight = _clamp(strategy.grounding_weight + 0.2)

        # Neighbour signal: move toward the strategies that earned reward.
        weighted: list[tuple[float, dict[str, float]]] = []
        for score, exemplar in neighbours:
            if score < 0.28:
                continue
            episode = self._episode_for(exemplar)
            if episode and episode.strategy:
                weighted.append((score * max(episode.reward, 0.0), episode.strategy))
        if weighted:
            total_weight = sum(w for w, _ in weighted) or 1.0
            target = Strategy(
                **{
                    key: sum(w * s.get(key, getattr(strategy, key)) for w, s in weighted)
                    / total_weight
                    for key in asdict(strategy)
                }
            )
            strategy = strategy.blend(target, 0.5)

        # Intent-level reward memory: if this intent has been going badly, think
        # harder and verify more next time.
        if intent and self._intent_reward[intent] < 0.45:
            strategy.reasoning_depth = _clamp(strategy.reasoning_depth + 0.15)
            strategy.verification = _clamp(strategy.verification + 0.15)

        return strategy

    def _episode_for(self, exemplar: Exemplar) -> Episode | None:
        for episode in reversed(self._episodes):
            if episode.task == exemplar.task and episode.intent == exemplar.intent:
                return episode
        return None

    # --- learning (the "outer loop" write path) ----------------------------

    def record(
        self,
        *,
        task: str,
        intent: str,
        answer: str = "",
        reward: float | None = None,
        tools_used: Iterable[str] = (),
        tool_success: dict[str, bool] | None = None,
        strategy: Strategy | None = None,
        grounded: bool = False,
        solved_exactly: bool = False,
        duration_ms: float = 0.0,
        feedback: str = "",
    ) -> Episode:
        """Record a completed episode and take one meta-learning step.

        ``reward`` may be supplied explicitly (e.g. from user feedback); when
        omitted it is estimated from observable signals.
        """
        tools = list(tools_used)
        if reward is None:
            reward = self._estimate_reward(
                answer=answer,
                grounded=grounded,
                solved_exactly=solved_exactly,
                tool_success=tool_success or {},
            )
        reward = _clamp(reward)
        used_strategy = strategy or self.strategy

        episode = Episode(
            id=f"ep_{uuid.uuid4().hex[:10]}",
            task=task,
            intent=intent,
            reward=reward,
            tools_used=tools,
            strategy=used_strategy.as_dict(),
            answer_preview=answer[:400],
            grounded=grounded,
            solved_exactly=solved_exactly,
            duration_ms=duration_ms,
            feedback=feedback,
        )

        with self._lock:
            self._episodes.append(episode)
            self._updates += 1

            # 1. Intent prior update (decayed pseudo-counts).
            for key in list(self._intent_counts):
                self._intent_counts[key] *= DECAY
            self._intent_counts[intent] += 1.0 + reward

            # 2. Intent reward memory (exponential moving average).
            previous = self._intent_reward[intent]
            self._intent_reward[intent] = previous + 0.25 * (reward - previous)

            # 3. Tool statistics.
            successes = tool_success or {}
            for tool in tools:
                stats = self._tool_stats[(intent, tool)]
                stats[1] += 1.0
                if successes.get(tool, reward >= 0.6):
                    stats[0] += 1.0

            # 4. Reptile meta-step: nudge the global strategy toward this
            #    episode's strategy, scaled by how well it did. Rewards below
            #    0.5 push *away* from what was used.
            direction = (reward - 0.5) * 2.0  # [-1, 1]
            if direction != 0:
                target = used_strategy if direction > 0 else _invert(used_strategy)
                self.strategy = self.strategy.blend(target, META_LR * abs(direction))

            # 5. Store as a few-shot exemplar when it went well.
            if reward >= self.exemplar_reward_floor and answer.strip():
                self._exemplars.append(
                    (_signature(task), Exemplar(task=task, intent=intent, answer=answer, reward=reward))
                )
                if len(self._exemplars) > self.max_exemplars:
                    # Evict the lowest-reward, oldest exemplar.
                    worst = min(
                        range(len(self._exemplars)),
                        key=lambda i: (self._exemplars[i][1].reward, -self._exemplars[i][1].created_at),
                    )
                    self._exemplars.pop(worst)

        return episode

    @staticmethod
    def _estimate_reward(
        *, answer: str, grounded: bool, solved_exactly: bool, tool_success: dict[str, bool]
    ) -> float:
        """Estimate episode reward from observable signals (no human label)."""
        reward = 0.5
        if solved_exactly:
            reward += 0.25
        if grounded:
            reward += 0.12
        length = len(answer.split())
        if length >= 25:
            reward += 0.08
        if length < 5:
            reward -= 0.25
        if tool_success:
            rate = sum(1 for ok in tool_success.values() if ok) / len(tool_success)
            reward += 0.2 * (rate - 0.5)
        if re.search(r"\b(i cannot|i can't help|error|failed|traceback)\b", answer, re.I):
            reward -= 0.2
        return _clamp(reward)

    def reinforce(self, episode_id: str, reward: float, feedback: str = "") -> Episode | None:
        """Apply explicit (human) feedback to a past episode and re-learn from it."""
        reward = _clamp(reward)
        with self._lock:
            for episode in reversed(self._episodes):
                if episode.id != episode_id:
                    continue
                delta = reward - episode.reward
                episode.reward = reward
                episode.feedback = feedback or episode.feedback

                self._intent_counts[episode.intent] = max(
                    0.1, self._intent_counts[episode.intent] + delta
                )
                previous = self._intent_reward[episode.intent]
                self._intent_reward[episode.intent] = previous + 0.4 * (reward - previous)

                for tool in episode.tools_used:
                    stats = self._tool_stats[(episode.intent, tool)]
                    stats[0] = max(0.0, stats[0] + delta)

                target = Strategy(**{k: episode.strategy.get(k, v) for k, v in asdict(self.strategy).items()})
                direction = (reward - 0.5) * 2.0
                if direction != 0:
                    self.strategy = self.strategy.blend(
                        target if direction > 0 else _invert(target), META_LR * abs(direction)
                    )

                # Promote or demote the exemplar.
                if reward >= self.exemplar_reward_floor:
                    if not any(e.task == episode.task for _, e in self._exemplars):
                        self._exemplars.append(
                            (
                                _signature(episode.task),
                                Exemplar(
                                    task=episode.task,
                                    intent=episode.intent,
                                    answer=episode.answer_preview,
                                    reward=reward,
                                ),
                            )
                        )
                else:
                    self._exemplars = [
                        pair for pair in self._exemplars if pair[1].task != episode.task
                    ]
                return episode
        return None

    # --- introspection ------------------------------------------------------

    def stats(self) -> dict[str, Any]:
        """A snapshot of everything the learner currently believes."""
        with self._lock:
            episodes = list(self._episodes)
            total = sum(self._intent_counts.values()) or 1.0
            tool_table = [
                {
                    "intent": intent,
                    "tool": tool,
                    "attempts": int(attempts),
                    "successes": round(successes, 2),
                    "success_rate": round((successes + 1.0) / (attempts + 2.0), 4),
                }
                for (intent, tool), (successes, attempts) in sorted(
                    self._tool_stats.items(), key=lambda kv: -kv[1][1]
                )[:25]
            ]
            rewards = [e.reward for e in episodes]
            recent = rewards[-25:]
            return {
                "episodes": len(episodes),
                "updates": self._updates,
                "exemplars": len(self._exemplars),
                "strategy": self.strategy.as_dict(),
                "mean_reward": round(sum(rewards) / len(rewards), 4) if rewards else 0.0,
                "recent_mean_reward": round(sum(recent) / len(recent), 4) if recent else 0.0,
                "improving": (
                    len(rewards) >= 10
                    and (sum(recent) / len(recent)) > (sum(rewards) / len(rewards))
                ),
                "intent_prior": {
                    intent: round(count / total, 4)
                    for intent, count in sorted(self._intent_counts.items(), key=lambda kv: -kv[1])[:12]
                },
                "intent_reward": {
                    intent: round(value, 4)
                    for intent, value in sorted(self._intent_reward.items(), key=lambda kv: -kv[1])[:12]
                },
                "tool_priors": tool_table,
            }

    def recent_episodes(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            return [e.to_dict() for e in list(self._episodes)[-limit:][::-1]]

    def reset(self) -> None:
        """Forget everything (used by tests and the operator reset endpoint)."""
        with self._lock:
            self.strategy = Strategy()
            self._episodes.clear()
            self._exemplars.clear()
            self._intent_counts.clear()
            self._tool_stats.clear()
            self._intent_reward.clear()
            self._updates = 0

    # --- persistence --------------------------------------------------------

    def save(self, path: str | Path) -> Path:
        """Persist learned state as JSON so learning survives a restart."""
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            payload = {
                "version": 1,
                "strategy": asdict(self.strategy),
                "episodes": [e.to_dict() for e in self._episodes],
                "exemplars": [asdict(e) for _, e in self._exemplars],
                "intent_counts": dict(self._intent_counts),
                "intent_reward": dict(self._intent_reward),
                "tool_stats": {f"{i}\u0000{t}": v for (i, t), v in self._tool_stats.items()},
                "updates": self._updates,
            }
        target.write_text(json.dumps(payload, indent=1), encoding="utf-8")
        return target

    def load(self, path: str | Path) -> bool:
        """Restore learned state written by :meth:`save`. Returns success."""
        source = Path(path)
        if not source.exists():
            return False
        try:
            payload = json.loads(source.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return False
        if payload.get("version") != 1:
            return False

        with self._lock:
            self.strategy = Strategy(**payload.get("strategy", {}))
            self._episodes = deque(
                (Episode(**e) for e in payload.get("episodes", [])), maxlen=self.max_episodes
            )
            self._exemplars = [
                (_signature(e["task"]), Exemplar(**e)) for e in payload.get("exemplars", [])
            ]
            self._intent_counts = defaultdict(lambda: 1.0, payload.get("intent_counts", {}))
            self._intent_reward = defaultdict(lambda: 0.5, payload.get("intent_reward", {}))
            self._tool_stats = defaultdict(lambda: [0.0, 0.0])
            for key, value in payload.get("tool_stats", {}).items():
                intent, _, tool = key.partition("\u0000")
                self._tool_stats[(intent, tool)] = list(value)
            self._updates = int(payload.get("updates", 0))
        return True


def _invert(strategy: Strategy) -> Strategy:
    """The mirror of a strategy, used to step *away* from a failed policy."""
    return Strategy(**{key: _clamp(1.0 - value) for key, value in asdict(strategy).items()})


# --- Process-wide singleton ---------------------------------------------------

_learner: MetaLearner | None = None
_learner_lock = threading.Lock()


def get_meta_learner() -> MetaLearner:
    """Return the process-wide meta-learner, restoring persisted state once."""
    global _learner
    if _learner is not None:
        return _learner
    with _learner_lock:
        if _learner is None:
            learner = MetaLearner()
            try:
                from ..core.config import settings

                path = getattr(settings, "hermes_meta_state_path", "")
                if path:
                    learner.load(path)
            except Exception:  # pragma: no cover - persistence is best-effort
                pass
            _learner = learner
    return _learner


def reset_meta_learner() -> None:
    """Reset the singleton's learned state (tests / operator endpoint)."""
    get_meta_learner().reset()


__all__ = [
    "Strategy",
    "Episode",
    "Exemplar",
    "Adaptation",
    "MetaLearner",
    "get_meta_learner",
    "reset_meta_learner",
    "META_LR",
]
