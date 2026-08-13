"""Structured-output guardrails — JSON Schema subset + repair.

Aetheris structured mode already *asks* the model for JSON. This module
*checks* it: a small JSON Schema validator (type / properties / required
/ enum / min/max / pattern / items) plus a repair pass that pulls JSON
out of markdown fences, fixes trailing commas, and translates Python
literals.

Contracts name a schema and an on-fail policy (``reject`` or ``repair``).
"""

from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field

_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", re.S)
_TRAILING_COMMA = re.compile(r",\s*([}\]])")


class ContractIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    json_schema: dict[str, Any] = Field(..., description="JSON Schema subset.", alias="schema")
    on_fail: str = Field(default="repair", pattern="^(reject|repair)$")
    description: str = Field(default="", max_length=400)

    model_config = {"populate_by_name": True}


class ValidateRequest(BaseModel):
    payload: Any = None
    text: str = Field(default="", description="Raw text to parse if payload is omitted.")
    json_schema: dict[str, Any] | None = Field(default=None, alias="schema")
    contract_id: str | None = None
    repair: bool = True

    model_config = {"populate_by_name": True}


# --- Schema validator ---------------------------------------------------------

def _type_of(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int) and not isinstance(value, bool):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def validate_schema(instance: Any, schema: dict[str, Any], *, path: str = "$") -> list[str]:
    """Return a list of error strings (empty = valid)."""
    errors: list[str] = []
    expected = schema.get("type")
    if expected:
        kinds = expected if isinstance(expected, list) else [expected]
        actual = _type_of(instance)
        # integer is a number; number accepts integer.
        ok = actual in kinds or (actual == "integer" and "number" in kinds)
        if not ok:
            errors.append(f"{path}: expected type {kinds}, got {actual}")
            return errors

    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: {instance!r} not in enum {schema['enum']}")

    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        if "minimum" in schema and instance < schema["minimum"]:
            errors.append(f"{path}: {instance} < minimum {schema['minimum']}")
        if "maximum" in schema and instance > schema["maximum"]:
            errors.append(f"{path}: {instance} > maximum {schema['maximum']}")

    if isinstance(instance, str):
        if "minLength" in schema and len(instance) < schema["minLength"]:
            errors.append(f"{path}: string shorter than {schema['minLength']}")
        if "maxLength" in schema and len(instance) > schema["maxLength"]:
            errors.append(f"{path}: string longer than {schema['maxLength']}")
        if "pattern" in schema:
            try:
                if not re.search(schema["pattern"], instance):
                    errors.append(f"{path}: does not match /{schema['pattern']}/")
            except re.error as exc:
                errors.append(f"{path}: invalid pattern: {exc}")

    if isinstance(instance, list) and "items" in schema:
        item_schema = schema["items"]
        if isinstance(item_schema, dict):
            for i, item in enumerate(instance):
                errors.extend(validate_schema(item, item_schema, path=f"{path}[{i}]"))
        if "minItems" in schema and len(instance) < schema["minItems"]:
            errors.append(f"{path}: array shorter than {schema['minItems']}")
        if "maxItems" in schema and len(instance) > schema["maxItems"]:
            errors.append(f"{path}: array longer than {schema['maxItems']}")

    if isinstance(instance, dict):
        props = schema.get("properties") or {}
        required = schema.get("required") or []
        for key in required:
            if key not in instance:
                errors.append(f"{path}: missing required property {key!r}")
        additional = schema.get("additionalProperties", True)
        for key, value in instance.items():
            if key in props:
                errors.extend(validate_schema(value, props[key], path=f"{path}.{key}"))
            elif additional is False:
                errors.append(f"{path}: unexpected property {key!r}")
            elif isinstance(additional, dict):
                errors.extend(validate_schema(value, additional, path=f"{path}.{key}"))
    return errors


# --- Repair -------------------------------------------------------------------

def extract_json(text: str) -> Any:
    """Best-effort parse of JSON from raw model text."""
    if text is None:
        raise ValueError("empty text")
    raw = text.strip()
    if not raw:
        raise ValueError("empty text")

    fenced = _FENCE.search(raw)
    if fenced:
        raw = fenced.group(1).strip()

    # Already valid?
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Slice to the outermost object/array.
    start_obj, start_arr = raw.find("{"), raw.find("[")
    starts = [s for s in (start_obj, start_arr) if s >= 0]
    if starts:
        start = min(starts)
        end_ch = "}" if raw[start] == "{" else "]"
        end = raw.rfind(end_ch)
        if end > start:
            raw = raw[start : end + 1]

    py_literals = raw.replace("True", "true").replace("False", "false").replace("None", "null")
    both = py_literals.replace("'", '"')
    candidates = [
        raw,
        _TRAILING_COMMA.sub(r"\1", raw),
        py_literals,
        raw.replace("'", '"'),
        both,
        _TRAILING_COMMA.sub(r"\1", both),
    ]
    last_err: Exception | None = None
    for cand in candidates:
        try:
            return json.loads(cand)
        except (json.JSONDecodeError, ValueError) as exc:
            last_err = exc
            continue
    raise ValueError(f"could not parse JSON: {last_err}")


def repair_and_validate(text: str, schema: dict[str, Any]) -> dict[str, Any]:
    notes: list[str] = []
    try:
        payload = json.loads(text)
    except Exception:
        payload = extract_json(text)
        notes.append("repaired raw text into JSON")
    errors = validate_schema(payload, schema)
    return {
        "ok": not errors,
        "payload": payload,
        "errors": errors,
        "notes": notes,
    }


# --- Contracts ----------------------------------------------------------------

@dataclass
class _Contract:
    id: str
    name: str
    schema: dict[str, Any]
    on_fail: str
    description: str
    created_at: float = field(default_factory=time.time)
    checks: int = 0
    failures: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "schema": self.schema,
            "on_fail": self.on_fail,
            "description": self.description,
            "created_at": self.created_at,
            "checks": self.checks,
            "failures": self.failures,
        }


class GuardrailService:
    def __init__(self) -> None:
        self._lock = Lock()
        self._contracts: dict[str, _Contract] = {}
        self._seed()

    def _seed(self) -> None:
        defaults = [
            ContractIn(
                name="chat-summary",
                description="Structured recap of a conversation.",
                on_fail="repair",
                schema={
                    "type": "object",
                    "required": ["summary", "key_points"],
                    "properties": {
                        "summary": {"type": "string", "minLength": 1},
                        "key_points": {"type": "array", "items": {"type": "string"}},
                        "action_items": {"type": "array", "items": {"type": "string"}},
                    },
                    "additionalProperties": True,
                },
            ),
            ContractIn(
                name="tool-call",
                description="A single tool invocation.",
                on_fail="reject",
                schema={
                    "type": "object",
                    "required": ["name", "arguments"],
                    "properties": {
                        "name": {"type": "string", "minLength": 1},
                        "arguments": {"type": "object"},
                    },
                    "additionalProperties": False,
                },
            ),
        ]
        for body in defaults:
            self.create(body)

    def create(self, body: ContractIn) -> _Contract:
        contract = _Contract(
            id=f"gd_{uuid.uuid4().hex[:8]}",
            name=body.name,
            schema=dict(body.json_schema),
            on_fail=body.on_fail,
            description=body.description,
        )
        with self._lock:
            self._contracts[contract.id] = contract
        return contract

    def get(self, contract_id: str) -> _Contract | None:
        with self._lock:
            if contract_id in self._contracts:
                return self._contracts[contract_id]
            for c in self._contracts.values():
                if c.name == contract_id:
                    return c
            return None

    def list_contracts(self) -> list[dict[str, Any]]:
        with self._lock:
            return [c.to_dict() for c in self._contracts.values()]

    def delete(self, contract_id: str) -> bool:
        with self._lock:
            return self._contracts.pop(contract_id, None) is not None

    def check(self, body: ValidateRequest) -> dict[str, Any]:
        schema = body.json_schema
        contract: _Contract | None = None
        if body.contract_id:
            contract = self.get(body.contract_id)
            if contract is None:
                raise KeyError(body.contract_id)
            schema = contract.schema
        if schema is None:
            raise ValueError("provide a schema or contract_id")

        payload = body.payload
        notes: list[str] = []
        if payload is None:
            if not body.text:
                raise ValueError("provide payload or text")
            if body.repair or (contract and contract.on_fail == "repair"):
                try:
                    payload = extract_json(body.text)
                    notes.append("parsed/repaired text")
                except ValueError as exc:
                    if contract:
                        contract.checks += 1
                        contract.failures += 1
                    return {"ok": False, "payload": None, "errors": [str(exc)], "notes": notes}
            else:
                try:
                    payload = json.loads(body.text)
                except json.JSONDecodeError as exc:
                    if contract:
                        contract.checks += 1
                        contract.failures += 1
                    return {"ok": False, "payload": None, "errors": [f"invalid JSON: {exc}"], "notes": notes}

        errors = validate_schema(payload, schema)
        if contract:
            contract.checks += 1
            if errors:
                contract.failures += 1
        return {"ok": not errors, "payload": payload, "errors": errors, "notes": notes}

    def stats(self) -> dict[str, Any]:
        with self._lock:
            checks = sum(c.checks for c in self._contracts.values())
            failures = sum(c.failures for c in self._contracts.values())
            return {
                "contracts": len(self._contracts),
                "checks": checks,
                "failures": failures,
            }


_svc: GuardrailService | None = None


def get_guardrail_service() -> GuardrailService:
    global _svc
    if _svc is None:
        _svc = GuardrailService()
    return _svc


__all__ = [
    "GuardrailService",
    "ContractIn",
    "ValidateRequest",
    "validate_schema",
    "extract_json",
    "repair_and_validate",
    "get_guardrail_service",
]
