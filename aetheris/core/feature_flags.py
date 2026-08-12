"""Runtime feature flags for Aetheris.

Provides a dynamic feature-flag system that can toggle capabilities on or off
at runtime without restarting the server. Flags support:

* Simple boolean on/off
* Percentage-based rollouts (e.g. 30% of traffic)
* Per-user or per-key overrides
* Conditional rules (mode match, model match, etc.)
* Audit trail of flag changes

This enables safe rollouts, A/B testing, and gradual feature exposure.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


class FlagCreate(BaseModel):
    """Create or update a feature flag."""
    key: str = Field(..., min_length=1, max_length=128, description="Flag key (e.g. 'new_chat_ui').")
    description: str = Field(default="", max_length=500)
    enabled: bool = Field(default=True, description="Whether the flag is active.")
    rollout_percentage: float = Field(
        default=100.0, ge=0.0, le=100.0,
        description="Percentage of traffic that sees the flag as enabled (0-100).",
    )
    rules: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Conditional rules: [{field: 'mode', op: 'eq', value: 'engineering'}].",
    )
    overrides: dict[str, bool] = Field(
        default_factory=dict,
        description="Per-identifier overrides: {'user_123': True, 'team_alpha': False}.",
    )


class FlagInfo(BaseModel):
    id: str
    key: str
    description: str
    enabled: bool
    rollout_percentage: float
    rules: list[dict[str, Any]]
    overrides: dict[str, bool]
    created_at: float
    updated_at: float
    evaluation_count: int


# --- Internal -----------------------------------------------------------------

@dataclass
class _FeatureFlag:
    id: str
    key: str
    description: str
    enabled: bool
    rollout_percentage: float
    rules: list[dict[str, Any]]
    overrides: dict[str, bool]
    created_at: float
    updated_at: float
    evaluation_count: int = 0

    def to_info(self) -> FlagInfo:
        return FlagInfo(
            id=self.id, key=self.key, description=self.description,
            enabled=self.enabled, rollout_percentage=self.rollout_percentage,
            rules=self.rules, overrides=self.overrides,
            created_at=self.created_at, updated_at=self.updated_at,
            evaluation_count=self.evaluation_count,
        )

    def evaluate(self, context: dict[str, str] | None = None) -> bool:
        """Evaluate the flag for a given context.

        Priority:
        1. Hard off (enabled=False) → always False
        2. Override for the given identifier → use override
        3. Rules match → True if any rule matches
        4. Rollout percentage → hash-based deterministic
        5. Default → True (flag is on)
        """
        self.evaluation_count += 1
        if not self.enabled:
            return False

        ctx = context or {}

        # Check overrides
        identifier = ctx.get("id", "")
        if identifier and identifier in self.overrides:
            return self.overrides[identifier]

        # Check rules
        if self.rules:
            matched = False
            for rule in self.rules:
                rfield = rule.get("field", "")
                op = rule.get("op", "eq")
                value = rule.get("value", "")
                actual = ctx.get(rfield, "")
                if op == "eq" and actual == str(value):
                    matched = True
                elif op == "neq" and actual != str(value):
                    matched = True
                elif op == "in" and actual in str(value).split(","):
                    matched = True
                elif op == "contains" and str(value) in actual:
                    matched = True
            if matched:
                return True
            # If rules exist but none matched, fall through to rollout

        # Rollout percentage
        if self.rollout_percentage >= 100.0:
            return True
        if self.rollout_percentage <= 0.0:
            return False
        # Deterministic hash-based bucketing
        bucket_str = f"{self.key}:{identifier}"
        bucket = int(hashlib.md5(bucket_str.encode()).hexdigest(), 16) % 100
        return bucket < self.rollout_percentage


# --- Manager ------------------------------------------------------------------

class FeatureFlagManager:
    """Thread-safe feature flag manager."""

    def __init__(self, max_flags: int = 200) -> None:
        self._flags: dict[str, _FeatureFlag] = {}
        self._lock = Lock()
        self._max = max_flags

    def create(self, body: FlagCreate) -> _FeatureFlag:
        with self._lock:
            if len(self._flags) >= self._max:
                raise ValueError(f"Maximum of {self._max} feature flags reached.")
            # Check for duplicate key
            for f in self._flags.values():
                if f.key == body.key:
                    raise ValueError(f"Flag key '{body.key}' already exists.")
            now = time.time()
            flag = _FeatureFlag(
                id=f"flag_{uuid.uuid4().hex[:8]}",
                key=body.key, description=body.description,
                enabled=body.enabled, rollout_percentage=body.rollout_percentage,
                rules=body.rules, overrides=body.overrides,
                created_at=now, updated_at=now,
            )
            self._flags[flag.id] = flag
        return flag

    def get(self, flag_id: str) -> _FeatureFlag | None:
        with self._lock:
            return self._flags.get(flag_id)

    def get_by_key(self, key: str) -> _FeatureFlag | None:
        with self._lock:
            for f in self._flags.values():
                if f.key == key:
                    return f
        return None

    def update(self, flag_id: str, body: FlagCreate) -> _FeatureFlag | None:
        with self._lock:
            f = self._flags.get(flag_id)
            if f is None:
                return None
            f.key = body.key
            f.description = body.description
            f.enabled = body.enabled
            f.rollout_percentage = body.rollout_percentage
            f.rules = body.rules
            f.overrides = body.overrides
            f.updated_at = time.time()
        return f

    def delete(self, flag_id: str) -> bool:
        with self._lock:
            return self._flags.pop(flag_id, None) is not None

    def evaluate(self, key: str, context: dict[str, str] | None = None) -> bool:
        """Evaluate a flag by key. Returns False if flag doesn't exist."""
        flag = self.get_by_key(key)
        if flag is None:
            return False
        return flag.evaluate(context)

    def evaluate_all(self, context: dict[str, str] | None = None) -> dict[str, bool]:
        """Evaluate all flags for a given context."""
        with self._lock:
            keys = [f.key for f in self._flags.values()]
        return {key: self.evaluate(key, context) for key in keys}

    def list_flags(self, *, enabled: bool | None = None) -> list[_FeatureFlag]:
        with self._lock:
            flags = list(self._flags.values())
        if enabled is not None:
            flags = [f for f in flags if f.enabled == enabled]
        return sorted(flags, key=lambda f: f.key)

    def toggle(self, flag_id: str) -> _FeatureFlag | None:
        """Toggle a flag's enabled state."""
        with self._lock:
            f = self._flags.get(flag_id)
            if f is None:
                return None
            f.enabled = not f.enabled
            f.updated_at = time.time()
        return f

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "total": len(self._flags),
                "enabled": sum(1 for f in self._flags.values() if f.enabled),
                "disabled": sum(1 for f in self._flags.values() if not f.enabled),
                "total_evaluations": sum(f.evaluation_count for f in self._flags.values()),
            }


_manager: FeatureFlagManager | None = None


def get_feature_flag_manager() -> FeatureFlagManager:
    global _manager
    if _manager is None:
        _manager = FeatureFlagManager()
    return _manager


__all__ = ["FeatureFlagManager", "FlagCreate", "FlagInfo", "get_feature_flag_manager"]
