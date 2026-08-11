"""The Aetheris code sandbox — real, isolated Python execution.

This is the concrete implementation behind the blueprint's "code sandbox
execution" capability. Code runs in a **separate short-lived process**, never in
the API worker, under a defence-in-depth stack:

* a dedicated temporary working directory, destroyed after the run;
* POSIX resource limits (CPU seconds, address space, file size, no core dumps)
  applied in the child before ``exec`` via ``preexec_fn``;
* a hard wall-clock timeout enforced by the parent, which kills the entire
  process group so a runaway ``while True`` cannot outlive the request;
* a scrubbed environment (no inherited API keys) and network disabled by default
  through a socket guard injected ahead of user code;
* output truncation so a print-loop cannot exhaust memory upstream.

The sandbox is enabled by default because it is the safest useful configuration;
set ``AETHERIS_SANDBOX_ENABLED=false`` to remove it from the toolbelt entirely.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
import textwrap
from dataclasses import dataclass

from ..core.config import settings
from .registry import ToolError, register

# Injected ahead of user code: disables outbound sockets unless explicitly
# allowed, so sandboxed code cannot exfiltrate anything or call home.
_NETWORK_GUARD = """\
import socket as _socket


class _BlockedNetwork(OSError):
    pass


def _blocked(*_args, **_kwargs):
    raise _BlockedNetwork(
        "Network access is disabled in the Aetheris sandbox. "
        "Use the web_fetch tool for network calls."
    )


_socket.socket = _blocked
_socket.create_connection = _blocked
_socket.socketpair = _blocked
"""

_PRELUDE = """\
import sys
sys.setrecursionlimit(3000)
"""


@dataclass(frozen=True)
class SandboxResult:
    """The outcome of one sandboxed execution."""

    ok: bool
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool
    duration_ms: int

    def render(self) -> str:
        """Format the result as the observation string handed back to the model."""
        parts: list[str] = []
        if self.timed_out:
            parts.append(
                f"[timeout] Execution exceeded {settings.sandbox_timeout:g}s and was terminated."
            )
        parts.append(f"exit_code: {self.exit_code}")
        parts.append(f"duration_ms: {self.duration_ms}")
        parts.append("stdout:\n" + (self.stdout.rstrip() or "(empty)"))
        if self.stderr.strip():
            parts.append("stderr:\n" + self.stderr.rstrip())
        return "\n\n".join(parts)


def _limits():
    """Build the ``preexec_fn`` that sandboxes the child process (POSIX only)."""
    if os.name != "posix":  # pragma: no cover - Windows fallback
        return None

    import resource

    # Give the CPU limit a second of headroom over the wall clock so the parent's
    # timeout is normally what fires; RLIMIT_CPU is the backstop for a child that
    # somehow escapes it.
    cpu = max(1, int(settings.sandbox_timeout) + 1)
    mem_bytes = max(64, settings.sandbox_memory_mb) * 1024 * 1024
    file_bytes = 8 * 1024 * 1024

    def apply() -> None:  # pragma: no cover - runs in the forked child
        # New process group so the parent can kill the whole tree on timeout.
        os.setsid()
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu + 1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (file_bytes, file_bytes))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_NPROC, (256, 256))
        try:
            resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
        except (ValueError, OSError):
            # Some platforms (notably macOS) reject RLIMIT_AS; CPU + wall-clock
            # limits still bound the run.
            pass

    return apply


def _child_env(workdir: str) -> dict[str, str]:
    """A scrubbed environment: no inherited secrets, no user site-packages."""
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": workdir,
        "TMPDIR": workdir,
        "PWD": workdir,
        "LANG": "C.UTF-8",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
        "PYTHONHASHSEED": "0",
    }


async def run_python(code: str, *, stdin: str = "") -> SandboxResult:
    """Execute ``code`` in an isolated subprocess and capture its output."""
    if not settings.sandbox_enabled:
        raise ToolError(
            "The code sandbox is disabled. Set AETHERIS_SANDBOX_ENABLED=true to enable it."
        )
    if not code or not code.strip():
        raise ToolError("No code was provided to execute.")
    if len(code) > settings.sandbox_max_code_chars:
        raise ToolError(
            f"Code exceeds the {settings.sandbox_max_code_chars} character sandbox limit."
        )

    workdir = tempfile.mkdtemp(prefix="aetheris-sbx-")
    script = os.path.join(workdir, "main.py")
    guard = "" if settings.sandbox_allow_network else _NETWORK_GUARD
    with open(script, "w", encoding="utf-8") as handle:
        handle.write(guard + _PRELUDE + "\n" + textwrap.dedent(code))

    loop = asyncio.get_running_loop()
    started = loop.time()
    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-I",  # isolated mode: ignore PYTHON* env and user site dirs
            "-B",
            script,
            cwd=workdir,
            env=_child_env(workdir),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            preexec_fn=_limits(),  # noqa: PLW1509 - intentional child hardening
            start_new_session=False,  # _limits() already calls setsid()
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                process.communicate(stdin.encode("utf-8") if stdin else None),
                timeout=settings.sandbox_timeout,
            )
            timed_out = False
        except asyncio.TimeoutError:
            _kill_tree(process)
            try:
                stdout_b, stderr_b = await asyncio.wait_for(process.communicate(), timeout=5)
            except (asyncio.TimeoutError, ValueError):
                stdout_b, stderr_b = b"", b""
            timed_out = True

        duration_ms = int((loop.time() - started) * 1000)
        stdout = _truncate(stdout_b.decode("utf-8", "replace"))
        stderr = _truncate(stderr_b.decode("utf-8", "replace"))
        exit_code = process.returncode if process.returncode is not None else -1
        # SIGXCPU/SIGKILL from RLIMIT_CPU is also a limit breach, not a crash:
        # report it as a timeout so callers see one consistent signal.
        if not timed_out and exit_code in (-24, -9, 152, 137):
            timed_out = True
        return SandboxResult(
            ok=(exit_code == 0 and not timed_out),
            stdout=stdout,
            stderr=stderr,
            exit_code=exit_code,
            timed_out=timed_out,
            duration_ms=duration_ms,
        )
    finally:
        if process is not None and process.returncode is None:  # pragma: no cover
            _kill_tree(process)
        shutil.rmtree(workdir, ignore_errors=True)


def _kill_tree(process) -> None:
    """Kill the child's whole process group so nothing survives a timeout."""
    import signal

    try:
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            process.kill()
        except ProcessLookupError:  # pragma: no cover
            pass


def _truncate(text: str) -> str:
    limit = settings.sandbox_max_output_chars
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n… [truncated at {limit} characters]"


# --- Tool registration --------------------------------------------------------

@register(
    "code_interpreter",
    (
        "Execute Python 3 code in a secure, isolated sandbox and return its stdout, "
        "stderr, and exit code. Use it to compute exact results, verify logic, parse "
        "data, or test an implementation before presenting it. The Python standard "
        "library is available; there is no network access and no state is kept "
        "between calls, so each snippet must be self-contained and must print() "
        "whatever you need to read."
    ),
    {
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "description": "Self-contained Python 3 source to execute. Print results to stdout.",
            },
            "stdin": {
                "type": "string",
                "description": "Optional text piped to the program's standard input.",
            },
        },
        "required": ["code"],
    },
    requires_optin=True,
    optin_setting="sandbox_enabled",
    tags=("execution", "analysis"),
)
async def code_interpreter(code: str, stdin: str = "") -> str:
    """Run Python in the sandbox and render the result for the model."""
    result = await run_python(code, stdin=stdin)
    return result.render()


__all__ = ["run_python", "SandboxResult", "code_interpreter"]
