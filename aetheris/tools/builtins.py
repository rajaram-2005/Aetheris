"""General-purpose built-in tools.

These are the small, always-safe capabilities that make the agent loop useful
without any external dependency: exact arithmetic, time, structured-data
validation, and a scratchpad for multi-step planning.
"""

from __future__ import annotations

import ast
import json
import math
import operator
from datetime import datetime, timezone
from typing import Any

from .registry import ToolError, register

# --- Safe arithmetic evaluator ------------------------------------------------
#
# Models are unreliable at arithmetic but excellent at writing the expression.
# Rather than eval() (arbitrary code execution), we walk the AST and permit only
# numeric literals, arithmetic operators, and a whitelist of math functions.

_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

_UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg}

_FUNCTIONS: dict[str, Any] = {
    "abs": abs, "round": round, "min": min, "max": max, "sum": sum,
    "pow": pow, "int": int, "float": float,
    "sqrt": math.sqrt, "log": math.log, "log2": math.log2, "log10": math.log10,
    "exp": math.exp, "sin": math.sin, "cos": math.cos, "tan": math.tan,
    "asin": math.asin, "acos": math.acos, "atan": math.atan, "atan2": math.atan2,
    "floor": math.floor, "ceil": math.ceil, "factorial": math.factorial,
    "gcd": math.gcd, "hypot": math.hypot, "degrees": math.degrees,
    "radians": math.radians, "fabs": math.fabs, "trunc": math.trunc,
}

_CONSTANTS = {"pi": math.pi, "e": math.e, "tau": math.tau, "inf": math.inf}

# Guard rails against expressions that are cheap to write and expensive to run.
_MAX_POW_EXPONENT = 1_000_000


def _eval_node(node: ast.AST) -> Any:
    """Recursively evaluate a whitelisted arithmetic AST node."""
    if isinstance(node, ast.Expression):
        return _eval_node(node.body)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float, complex)):
            return node.value
        raise ToolError(f"Unsupported literal: {node.value!r}")
    if isinstance(node, ast.BinOp):
        op = _BIN_OPS.get(type(node.op))
        if op is None:
            raise ToolError(f"Unsupported operator: {type(node.op).__name__}")
        left, right = _eval_node(node.left), _eval_node(node.right)
        if op is operator.pow and isinstance(right, (int, float)) and abs(right) > _MAX_POW_EXPONENT:
            raise ToolError("Exponent too large to evaluate safely.")
        return op(left, right)
    if isinstance(node, ast.UnaryOp):
        op = _UNARY_OPS.get(type(node.op))
        if op is None:
            raise ToolError(f"Unsupported unary operator: {type(node.op).__name__}")
        return op(_eval_node(node.operand))
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in _FUNCTIONS:
            name = getattr(node.func, "id", "?")
            raise ToolError(f"Unsupported function: {name}")
        args = [_eval_node(a) for a in node.args]
        return _FUNCTIONS[node.func.id](*args)
    if isinstance(node, ast.Name):
        if node.id in _CONSTANTS:
            return _CONSTANTS[node.id]
        raise ToolError(f"Unknown name: {node.id}")
    if isinstance(node, (ast.List, ast.Tuple)):
        return [_eval_node(e) for e in node.elts]
    if isinstance(node, ast.Compare):
        left = _eval_node(node.left)
        for op, comparator in zip(node.ops, node.comparators):
            right = _eval_node(comparator)
            comparison = {
                ast.Eq: operator.eq, ast.NotEq: operator.ne,
                ast.Lt: operator.lt, ast.LtE: operator.le,
                ast.Gt: operator.gt, ast.GtE: operator.ge,
            }.get(type(op))
            if comparison is None:
                raise ToolError(f"Unsupported comparison: {type(op).__name__}")
            if not comparison(left, right):
                return False
            left = right
        return True
    raise ToolError(f"Unsupported expression element: {type(node).__name__}")


@register(
    "calculator",
    (
        "Evaluate an exact arithmetic or mathematical expression. Use this for any "
        "non-trivial calculation instead of computing mentally — it is exact and "
        "cannot be off by a digit. Supports + - * / // % **, comparisons, and "
        "sqrt, log, exp, sin, cos, tan, floor, ceil, factorial, gcd, abs, round, "
        "min, max, sum, plus the constants pi, e, and tau."
    ),
    {
        "type": "object",
        "properties": {
            "expression": {
                "type": "string",
                "description": "The expression to evaluate, e.g. '(1.07 ** 30) * 2500'.",
            }
        },
        "required": ["expression"],
    },
    tags=("math",),
)
async def calculator(expression: str) -> str:
    """Evaluate a mathematical expression exactly and safely."""
    if not expression or not expression.strip():
        raise ToolError("No expression was provided.")
    if len(expression) > 2000:
        raise ToolError("Expression is too long (limit 2000 characters).")
    try:
        tree = ast.parse(expression.strip(), mode="eval")
    except SyntaxError as exc:
        raise ToolError(f"Could not parse the expression: {exc.msg}") from exc
    try:
        value = _eval_node(tree)
    except ZeroDivisionError as exc:
        raise ToolError("Division by zero.") from exc
    except (OverflowError, ValueError) as exc:
        raise ToolError(f"Arithmetic error: {exc}") from exc
    return f"{expression.strip()} = {value}"


@register(
    "current_time",
    (
        "Return the current UTC date and time. Use it whenever the answer depends on "
        "'today', 'now', or an elapsed duration — your training data has no clock."
    ),
    {
        "type": "object",
        "properties": {
            "timezone_offset_hours": {
                "type": "number",
                "description": "Optional offset from UTC, e.g. 5.5 for IST.",
            }
        },
    },
    tags=("context",),
)
async def current_time(timezone_offset_hours: float = 0.0) -> str:
    """Report the current time, optionally shifted to a fixed UTC offset."""
    now = datetime.now(timezone.utc)
    if timezone_offset_hours:
        from datetime import timedelta

        now = now + timedelta(hours=timezone_offset_hours)
        label = f"UTC{timezone_offset_hours:+g}"
    else:
        label = "UTC"
    return json.dumps(
        {
            "iso8601": now.isoformat(),
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M:%S"),
            "weekday": now.strftime("%A"),
            "zone": label,
            "unix": int(now.timestamp()),
        },
        indent=2,
    )


@register(
    "validate_json",
    (
        "Parse a JSON string and report whether it is valid, plus its inferred "
        "structure. Use it to check your own structured output before returning it, "
        "especially in structured mode."
    ),
    {
        "type": "object",
        "properties": {
            "payload": {"type": "string", "description": "The JSON text to validate."},
            "required_keys": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional top-level keys that must be present.",
            },
        },
        "required": ["payload"],
    },
    tags=("structured",),
)
async def validate_json(payload: str, required_keys: list[str] | None = None) -> str:
    """Validate JSON text and summarize its shape."""
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as exc:
        return json.dumps(
            {
                "valid": False,
                "error": exc.msg,
                "line": exc.lineno,
                "column": exc.colno,
                "hint": "Fix the syntax at the reported position and re-validate.",
            },
            indent=2,
        )

    report: dict[str, Any] = {"valid": True, "type": type(parsed).__name__}
    if isinstance(parsed, dict):
        report["keys"] = list(parsed.keys())[:50]
        report["schema"] = {k: type(v).__name__ for k, v in list(parsed.items())[:50]}
        missing = [k for k in (required_keys or []) if k not in parsed]
        if missing:
            report["valid"] = False
            report["missing_required_keys"] = missing
    elif isinstance(parsed, list):
        report["length"] = len(parsed)
        report["item_types"] = sorted({type(i).__name__ for i in parsed[:100]})
    return json.dumps(report, indent=2)


@register(
    "think",
    (
        "Record a private reasoning step, plan, or self-critique. It performs no "
        "action and returns nothing new — use it to decompose a hard problem, decide "
        "which tool to call next, or check your own work before answering."
    ),
    {
        "type": "object",
        "properties": {
            "thought": {"type": "string", "description": "The reasoning step to record."}
        },
        "required": ["thought"],
    },
    tags=("reasoning",),
)
async def think(thought: str) -> str:
    """A no-op scratchpad that gives the agent room to plan explicitly."""
    trimmed = " ".join((thought or "").split())
    if not trimmed:
        raise ToolError("An empty thought was recorded; state the reasoning step.")
    return "Noted. Continue: either call the next tool or give your final answer."


__all__ = ["calculator", "current_time", "validate_json", "think"]
