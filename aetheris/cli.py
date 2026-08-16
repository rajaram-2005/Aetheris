"""The Aetheris command-line interface.

A self-contained terminal client for every Aetheris tier and mode, plus a
``serve`` subcommand to launch the HTTP API. Inference runs in-process via the
shared provider layer, so the CLI works offline with the brand-aware mock engine
and transparently uses an OpenAI-compatible backend when configured.

Subcommands:
    aetheris chat                 interactive REPL (slash commands, live streaming)
    aetheris ask "<prompt>"       one-shot (streams live; --md renders markdown)
    aetheris stream "<prompt>"    one-shot, explicitly streamed
    aetheris models               list tiers (table, or --json)
    aetheris modes                list modes (table, or --json)
    aetheris info                 brand identity (or --json)
    aetheris spec                 architecture + training spec (or --json)
    aetheris health               provider/status (or --base-url to probe a server)
    aetheris serve                launch the HTTP API (--host/--port/--reload)

Common flags on chat/ask/stream:
    -m, --model TIER   aetheris-lite|flash|aetheris-pro|pro|aetheris-ultra|ultra
    -M, --mode  MODE   general|engineering|editorial|structured|myth|legendary|pro|lite|flash
    --md               buffer the response and render it as Markdown (non-streaming)
    --no-color         disable ANSI color
"""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any

from rich.box import ROUNDED
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from . import __version__
from .core import branding as b
from .core.modes import MODES, get_mode
from .core.tiers import TIERS, get_tier
from .core.config import settings

# Brand palette (hex) used for terminal styling.
TEAL = "#00B4D8"
INDIGO = "#0B132B"
WHITE = "#F8F9FA"
MUTED = "#9fb0d0"
AMBER = "#ffc14d"  # used for scaffold/pending evidence badges in the terminal


# ---------------------------------------------------------------------------
# Console factory
# ---------------------------------------------------------------------------

def _make_console(args: argparse.Namespace | None = None) -> Console:
    """Build a rich Console honoring a --no-color flag if present."""
    no_color = bool(getattr(args, "no_color", False)) if args else False
    return Console(no_color=no_color, highlight=False)


def _input_marker(no_color: bool) -> str:
    """The chat input prompt marker, with truecolor ANSI (teal) unless --no-color.

    Using ``input(marker)`` guarantees the marker is flushed to the terminal
    before reading, which rich's buffered output cannot reliably do mid-line.
    """
    if no_color:
        return "» "
    # truecolor teal (0,180,216) — rendered by modern terminals incl. Windows 10+.
    return "\033[38;2;0;180;216m»\033[0m "


# ---------------------------------------------------------------------------
# Shared renderers (used by subcommands and by chat slash commands)
# ---------------------------------------------------------------------------

def render_models(console: Console, as_json: bool = False) -> None:
    """Render the Aetheris tier registry."""
    if as_json:
        rows = [
            {
                "id": t.id,
                "alias": t.alias,
                "display_name": t.display_name,
                "tagline": t.tagline,
                "context_window": t.context_window,
                "max_output_tokens": t.max_output_tokens,
                "latency_class": t.latency_class,
                "reasoning": t.reasoning,
                "capabilities": list(t.capabilities),
            }
            for t in TIERS
        ]
        console.print_json(json.dumps(rows))
        return

    table = Table(title="Aetheris model tiers", box=ROUNDED, border_style=TEAL)
    table.add_column("ID", style=TEAL, no_wrap=True)
    table.add_column("Alias", style="dim")
    table.add_column("Display name")
    table.add_column("Context", justify="right")
    table.add_column("Max out", justify="right")
    table.add_column("Latency")
    table.add_column("Reasoning", justify="center")
    for t in TIERS:
        table.add_row(
            t.id,
            t.alias,
            t.display_name,
            f"{t.context_window:,}",
            f"{t.max_output_tokens:,}",
            t.latency_class,
            "✓" if t.reasoning else "—",
        )
    console.print(table)


def render_modes(console: Console, as_json: bool = False) -> None:
    """Render the Aetheris inference modes."""
    if as_json:
        rows = [
            {"id": m.id, "display_name": m.display_name, "description": m.description}
            for m in MODES
        ]
        console.print_json(json.dumps(rows))
        return

    table = Table(title="Aetheris inference modes", box=ROUNDED, border_style=TEAL)
    table.add_column("ID", style=TEAL, no_wrap=True)
    table.add_column("Display name")
    table.add_column("Description")
    for m in MODES:
        table.add_row(m.id, m.display_name, m.description)
    console.print(table)


def render_info(console: Console, as_json: bool = False) -> None:
    """Render the Aetheris brand identity."""
    if as_json:
        payload = {
            "name": b.NAME,
            "pronunciation": b.PRONUNCIATION,
            "etymology": b.ETYMOLOGY,
            "taglines": list(b.TAGLINES),
            "palette": b.PALETTE,
            "brand_vibe": b.BRAND_VIBE,
            "one_liner": b.ONE_LINER,
            "micro_copy": b.MICRO_COPY,
            "short_description": b.SHORT_DESCRIPTION,
            "full_overview": b.FULL_OVERVIEW,
            "technical_description": b.TECHNICAL_DESCRIPTION,
            "personality": b.PERSONALITY,
            "capabilities": b.CAPABILITIES,
            "audiences": b.AUDIENCES,
        }
        console.print_json(json.dumps(payload))
        return

    # Palette swatches: a couple of colored spaces followed by the hex code.
    def swatch(hex_code: str, label: str) -> Text:
        return Text.assemble(
            ("  ", f"on {hex_code}"),
            ("  ", ""),
            (f"{label} ", ""),
            (hex_code, TEAL),
        )

    body = Text()
    body.append(f"{b.NAME} ", style=f"bold {TEAL}")
    body.append(f"({b.PRONUNCIATION})\n", style="dim")
    body.append(b.ETYMOLOGY + "\n\n", style=MUTED)
    body.append("Taglines\n", style=f"bold {TEAL}")
    for t in b.TAGLINES:
        body.append(f"  • {t}\n")
    body.append("\nPalette\n", style=f"bold {TEAL}")
    for label, code in (("cosmic indigo", b.COLOR_COSMIC_INDIGO),
                        ("electric teal", b.COLOR_ELECTRIC_TEAL),
                        ("crisp white", b.COLOR_CRISP_WHITE)):
        body.append("  ")
        body.append(swatch(code, label))
        body.append("\n")
    body.append("\nOne-liner\n", style=f"bold {TEAL}")
    body.append(f"  {b.ONE_LINER}\n", style=WHITE)
    console.print(Panel(body, title="[bold]Aetheris — brand identity[/bold]",
                        border_style=TEAL, box=ROUNDED, padding=(1, 2)))

    # Personality + capabilities + audiences as compact tables.
    ptable = Table(title="Personality & voice", box=ROUNDED, border_style=TEAL, show_header=True)
    ptable.add_column("Trait", style=TEAL)
    ptable.add_column("Description")
    for p in b.PERSONALITY:
        ptable.add_row(p["trait"], p["description"])
    console.print(ptable)

    ctable = Table(title="Flagship capabilities", box=ROUNDED, border_style=TEAL, show_header=True)
    ctable.add_column("Capability", style=TEAL)
    ctable.add_column("Description")
    for c in b.CAPABILITIES:
        ctable.add_row(c["name"], c["description"])
    console.print(ctable)

    atable = Table(title="Target audiences", box=ROUNDED, border_style=TEAL, show_header=True)
    atable.add_column("Audience", style=TEAL)
    atable.add_column("Positioning")
    for a in b.AUDIENCES:
        atable.add_row(a["audience"], a["positioning"])
    console.print(atable)


def _ev_style(evidence: str) -> str:
    """rich style for an evidence badge."""
    return {
        "blueprint": TEAL,
        "scaffold": AMBER,
        "pending": MUTED,
    }.get(evidence, MUTED)


def render_spec(console: Console, as_json: bool = False) -> None:
    """Render the architecture + training specification."""
    # Local import keeps the CLI importable even if spec deps shift.
    from .core.spec import get_spec

    spec = get_spec()
    if as_json:
        console.print_json(json.dumps(spec.to_dict()))
        return

    arch = spec.architecture
    tx = arch.transformer

    # Architecture panel.
    body = Text()
    body.append(f"{arch.architecture_type}\n", style=f"bold {WHITE}")
    body.append(f"evidence: {arch.evidence.get('architecture_type', 'blueprint')}\n\n",
                style=MUTED)
    body.append("Optimizations\n", style=f"bold {TEAL}")
    for o in arch.optimizations:
        body.append(f"  • {o}\n")
    body.append("\nAlignment: ", style=f"bold {TEAL}")
    body.append(f"{arch.alignment}\n")
    body.append("Output fidelity: ", style=f"bold {TEAL}")
    body.append(", ".join(arch.output_fidelity_domains) + "\n")
    body.append("Hallucination policy: ", style=f"bold {TEAL}")
    body.append(f"{arch.hallucination_policy}\n")
    body.append("\nModalities\n", style=f"bold {TEAL}")
    mods = [
        ("text", arch.modalities.text), ("code", arch.modalities.code),
        ("structured_data", arch.modalities.structured_data),
        ("ui_schematics", arch.modalities.ui_schematics),
        ("image", arch.modalities.image), ("logical_diagrams", arch.modalities.logical_diagrams),
    ]
    body.append("  " + "  ".join(f"[{'on' if on else 'off'}] {n}" for n, on in mods) + "\n",
                style=WHITE)
    console.print(Panel(body, title=f"[bold]Architecture — {arch.name}[/bold]",
                        border_style=TEAL, box=ROUNDED, padding=(1, 2)))

    # Transformer config table.
    ttable = Table(title="Transformer configuration", box=ROUNDED, border_style=TEAL, show_header=True)
    ttable.add_column("Parameter", style=TEAL)
    ttable.add_column("Value")
    ttable.add_column("Evidence", justify="right")
    rows = [
        ("architecture", tx.architecture), ("num_layers", tx.num_layers),
        ("hidden_size", tx.hidden_size), ("num_attention_heads", tx.num_attention_heads),
        ("num_key_value_heads", tx.num_key_value_heads),
        ("intermediate_size", tx.intermediate_size), ("vocab_size", tx.vocab_size),
        ("max_position_embeddings", tx.max_position_embeddings),
        ("rope_theta", tx.rope_theta), ("activation", tx.activation),
        ("normalization", tx.normalization), ("tie_word_embeddings", tx.tie_word_embeddings),
        ("attention_implementation", tx.attention_implementation),
    ]
    for label, val in rows:
        ttable.add_row(label, "—" if val is None else str(val), tx.evidence)
    console.print(ttable)
    if tx.note:
        console.print(Text(f"  {tx.note}\n", style=f"italic {MUTED}"))

    # Context windows.
    cw = Table(title="Context windows (per tier)", box=ROUNDED, border_style=TEAL)
    cw.add_column("Tier", style=TEAL)
    cw.add_column("Tokens", justify="right")
    for k, v in arch.context_windows.items():
        cw.add_row(k, f"{v:,}")
    console.print(cw)

    # Training pipeline.
    tr = spec.training
    tbody = Text()
    tbody.append(f"Foundation: {tr.foundation}\n", style=f"bold {WHITE}")
    tbody.append(f"{tr.foundation_status}\n\n", style=MUTED)
    tbody.append("Alignment methods: " + ", ".join(tr.alignment_methods) + "\n", style=WHITE)
    if tr.meta_learning_methods:
        tbody.append(
            "Meta-learning methods: " + ", ".join(tr.meta_learning_methods) + "\n",
            style=WHITE,
        )
    console.print(Panel(tbody, title="[bold]Training pipeline[/bold]",
                        border_style=TEAL, box=ROUNDED, padding=(1, 2)))

    stable = Table(title="Training stages", box=ROUNDED, border_style=TEAL, show_header=True)
    stable.add_column("#", justify="right", style="dim")
    stable.add_column("ID", style=TEAL, no_wrap=True)
    stable.add_column("Phase")
    stable.add_column("Stage")
    stable.add_column("Evidence", justify="right")
    for i, s in enumerate(tr.stages, 1):
        stable.add_row(str(i), s.id, s.phase, s.name, Text(s.evidence, style=_ev_style(s.evidence)))
    console.print(stable)
    for s in tr.stages:
        if s.notes:
            console.print(Text(f"  • {s.id}: {s.notes}", style=f"italic {MUTED}"))


def render_tools(console: Console, as_json: bool = False) -> None:
    """Render the executable toolbelt."""
    from .tools import all_tools

    tools = all_tools(include_disabled=True)
    if as_json:
        console.print_json(json.dumps([
            {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
                "enabled": t.enabled,
                "tags": list(t.tags),
                "requires_optin": t.requires_optin,
            }
            for t in tools
        ]))
        return

    table = Table(title="Aetheris toolbelt", box=ROUNDED, border_style=TEAL)
    table.add_column("Tool", style=TEAL, no_wrap=True)
    table.add_column("Status", justify="center")
    table.add_column("Tags", style="dim")
    table.add_column("What it does")
    for tool in tools:
        table.add_row(
            tool.name,
            "[green]live[/green]" if tool.enabled else f"[{AMBER}]off[/{AMBER}]",
            ", ".join(tool.tags) or "—",
            tool.description.split(". ")[0] + ".",
        )
    console.print(table)


def render_capabilities(console: Console, as_json: bool = False) -> None:
    """Render which capabilities are live in this process."""
    from .core.modes import known_mode_ids
    from .tools import all_tools
    from .tools.retrieval import get_index

    report = settings.capability_report()
    if as_json:
        console.print_json(json.dumps({
            "capabilities": report,
            "tools": [t.name for t in all_tools()],
            "modes": list(known_mode_ids()),
            "documents_indexed": len(get_index().documents),
        }))
        return

    table = Table(title="Aetheris capabilities", box=ROUNDED, border_style=TEAL)
    table.add_column("Capability", style=TEAL, no_wrap=True)
    table.add_column("State", justify="center")
    table.add_column("Notes")
    notes = {
        "tools": "Executable toolbelt exposed to the model",
        "agent": "Plan → call tools → observe → self-correct loop",
        "agent_default_on": "Run every request through the agent loop",
        "agent_max_iterations": "Tool-calling rounds per request",
        "code_sandbox": "Isolated subprocess Python execution",
        "sandbox_network": "Outbound sockets from sandboxed code",
        "retrieval": "BM25 document search (RAG)",
        "retrieval_auto_context": "Auto-ground plain chat with mounted docs",
        "vision": "Image content parts accepted",
        "web_access": "Outbound HTTP via web_fetch",
        "sovereign_mode": "Unrestricted expert mode available",
    }
    for key, value in report.items():
        if isinstance(value, bool):
            state = "[green]on[/green]" if value else f"[{MUTED}]off[/{MUTED}]"
        else:
            state = f"[{TEAL}]{value}[/{TEAL}]"
        table.add_row(key, state, notes.get(key, ""))
    console.print(table)
    console.print(
        f"[{MUTED}]{len(all_tools())} tool(s) live · "
        f"{len(get_index().documents)} document(s) indexed · "
        f"modes: {', '.join(known_mode_ids())}[/{MUTED}]"
    )


def _save_artifact(console: Console, data: bytes, path: str, label: str) -> int:
    """Write generated bytes to disk and report the result."""
    from pathlib import Path

    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    console.print(
        f"[{TEAL}]{label} written[/{TEAL}] [bold]{target}[/bold] "
        f"[{MUTED}]({len(data):,} bytes)[/{MUTED}]"
    )
    return 0


def cmd_image(args: argparse.Namespace) -> int:
    """``aetheris image`` — layered offline/NVIDIA image generation."""
    console = _make_console(args)
    from .media.image_providers import close_image_provider, generate_image_bytes

    async def render(prompt: str):
        try:
            return (await generate_image_bytes(
                prompt, width=args.width, height=args.height,
                style=args.style, palette=args.palette, seed=args.seed,
            ))[0]
        finally:
            await close_image_provider()

    prompt = " ".join(args.prompt).strip()
    try:
        result = asyncio.run(render(prompt))
    except (ValueError, RuntimeError) as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2

    extension = "jpg" if result.media_type == "image/jpeg" else "png"
    console.print(
        f"[{MUTED}]provider [bold]{result.provider}[/bold] · model [bold]{result.model}[/bold]"
        f" · {result.meta.get('width', args.width)}x{result.meta.get('height', args.height)}"
        f" · seed [bold]{result.seed}[/bold][/{MUTED}]"
    )
    return _save_artifact(
        console, result.data, args.out or f"aetheris-image.{extension}", "Image"
    )


def cmd_video(args: argparse.Namespace) -> int:
    """``aetheris video`` — layered offline GIF/NVIDIA Cosmos generation."""
    console = _make_console(args)
    from .media.video_providers import close_video_provider, generate_video_bytes

    async def render(prompt: str):
        try:
            return await generate_video_bytes(
                prompt, width=args.width, height=args.height, seconds=args.seconds,
                fps=args.fps, motion=args.motion, palette=args.palette, seed=args.seed,
            )
        finally:
            await close_video_provider()

    prompt = " ".join(args.prompt).strip()
    try:
        result = asyncio.run(render(prompt))
    except (ValueError, RuntimeError) as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2

    extension = "mp4" if result.media_type.startswith("video/") else "gif"
    duration = float(result.meta.get("duration_seconds", args.seconds))
    console.print(
        f"[{MUTED}]provider [bold]{result.provider}[/bold] · model [bold]{result.model}[/bold]"
        f" · {result.meta.get('frames')} frames @ {result.meta.get('fps', args.fps)}fps"
        f" · {duration:.1f}s"
        f" · {result.meta.get('width', args.width)}x{result.meta.get('height', args.height)}[/{MUTED}]"
    )
    return _save_artifact(
        console, result.data, args.out or f"aetheris-video.{extension}", "Video"
    )


def cmd_audio(args: argparse.Namespace) -> int:
    """``aetheris audio`` — synthesise a WAV file."""
    console = _make_console(args)
    from .media import audio as A

    try:
        if args.mode == "melody":
            if not args.notation:
                console.print("[red]error:[/red] --notation is required for melody mode.")
                return 2
            track = A.render_melody(args.notation, tempo=args.tempo, timbre=args.timbre)
        elif args.mode == "chords":
            chords = (args.notation or "Cmaj7 Amin7 Fmaj7 G").split()
            track = A.render_progression(chords, tempo=args.tempo, timbre=args.timbre)
        elif args.mode == "tone":
            track = A.render_tone(args.frequency, args.seconds, args.timbre)
        else:
            track, notation = A.render_melody_from_scale(
                args.key, args.scale, bars=args.bars, tempo=args.tempo, timbre=args.timbre
            )
            console.print(f"[{MUTED}]composed: {notation}[/{MUTED}]")
    except ValueError as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2

    console.print(
        f"[{MUTED}]mode [bold]{args.mode}[/bold] · timbre [bold]{args.timbre}[/bold]"
        f" · {track.duration:.2f}s · 16-bit 44.1kHz mono[/{MUTED}]"
    )
    return _save_artifact(console, track.to_wav(), args.out or "aetheris-audio.wav", "Audio")


def cmd_speech(args: argparse.Namespace) -> int:
    """``aetheris speech`` — speak text aloud to a WAV file (offline TTS)."""
    console = _make_console(args)
    from .media.speech import synthesize

    text = " ".join(args.text).strip()
    if not text:
        console.print("[red]error:[/red] provide some text to speak.")
        return 2
    wav = synthesize(text, voice=args.voice, rate=args.rate, pitch=args.pitch)
    console.print(
        f"[{MUTED}]voice [bold]{args.voice}[/bold] · rate {args.rate}× · pitch {args.pitch}× · "
        f"{len(text)} chars · offline formant synthesis[/{MUTED}]"
    )
    return _save_artifact(console, wav, args.out or "aetheris-speech.wav", "Speech")


def cmd_project(args: argparse.Namespace) -> int:
    """``aetheris project`` — scaffold a runnable project."""
    console = _make_console(args)
    from pathlib import Path

    from .media.code import scaffold_project

    try:
        project = scaffold_project(args.kind, args.name, args.description or "")
    except ValueError as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2

    if args.zip:
        return _save_artifact(
            console, project.to_zip(), args.out or f"{project.name}.zip", "Archive"
        )

    root = Path(args.out or ".").expanduser() / project.name
    if root.exists() and any(root.iterdir()):
        console.print(f"[red]error:[/red] {root} already exists and is not empty.")
        return 2
    for relative, content in project.files.items():
        destination = root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content, encoding="utf-8")

    console.print(Panel(project.tree(), title=f"[bold]{project.name}[/bold]",
                        border_style=TEAL, box=ROUNDED))
    console.print(
        f"[{TEAL}]Project created[/{TEAL}] [bold]{root}[/bold] "
        f"[{MUTED}]({len(project.files)} files)[/{MUTED}]"
    )
    return 0


# --- Studio Pro commands -----------------------------------------------------

def _read_source(path: str) -> bytes:
    """Read a local PNG/WAV source for the Studio Pro commands."""
    from pathlib import Path

    target = Path(path).expanduser()
    if not target.is_file():
        raise ValueError(f"no such file: {path}")
    return target.read_bytes()


def cmd_qr(args: argparse.Namespace) -> int:
    """``aetheris qr`` — encode text as a styled QR code PNG."""
    console = _make_console(args)
    from .media.qr import generate

    try:
        png, meta = generate(
            args.data, ecl=args.ecl, width=args.width,
            foreground=args.foreground, background=args.background,
            rounded=args.rounded, letter=args.letter,
        )
    except ValueError as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2
    console.print(
        f"[{MUTED}]version {meta['version']} · {meta['modules']}×{meta['modules']} modules · "
        f"ECC {meta['ecc']} · mask {meta['mask']} · {meta['payload_bytes']}/{meta['capacity_bytes']} bytes[/{MUTED}]"
    )
    return _save_artifact(console, png, args.out or "aetheris-qr.png", "QR code")


def cmd_remix(args: argparse.Namespace) -> int:
    """``aetheris remix`` — reimagine/restyle a local image from its palette."""
    console = _make_console(args)
    from .media.remix import remix

    try:
        data = _read_source(args.image)
        png, meta = remix(
            data, " ".join(args.prompt), operation=args.operation,
            palette=args.palette, width=args.width, height=args.height,
            style=args.style, dither=not args.no_dither, seed=args.seed,
        )
    except (ValueError, RuntimeError) as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2
    if meta["operation"] == "reimagine":
        console.print(
            f"[{MUTED}]scene [bold]{meta['scene']}[/bold] · inherited palette "
            f"{', '.join(meta['inherited_palette'])}[/{MUTED}]"
        )
    else:
        console.print(f"[{MUTED}]palette [bold]{meta['palette']}[/bold] · "
                      f"{'dithered' if meta['dither'] else 'flat'}[/{MUTED}]")
    return _save_artifact(console, png, args.out or "aetheris-remix.png", "Remix")


def cmd_collage(args: argparse.Namespace) -> int:
    """``aetheris collage`` — compose local images into one sheet."""
    console = _make_console(args)
    from .media.collage import CollageItem, build

    items = []
    for path in args.images:
        try:
            items.append(CollageItem(data=_read_source(path)))
        except ValueError as exc:
            console.print(f"[red]error:[/red] {exc}")
            return 2
    try:
        png, meta = build(
            items, layout=args.layout, width=args.width, height=args.height,
            background=args.background, seed=args.seed,
        )
    except ValueError as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2
    console.print(f"[{MUTED}]{meta['images']} images · layout {meta['layout']} · "
                  f"{meta['width']}×{meta['height']}[/{MUTED}]")
    return _save_artifact(console, png, args.out or "aetheris-collage.png", "Collage")


def cmd_chart(args: argparse.Namespace) -> int:
    """``aetheris chart`` — render a chart from JSON or a CSV file."""
    console = _make_console(args)
    import json as _json
    from pathlib import Path

    from .media.charts import ChartSeries, ChartSpec, build

    try:
        raw = Path(args.data).expanduser().read_text() if Path(args.data).is_file() else args.data
        spec_json = _json.loads(raw)
        if not isinstance(spec_json, dict):
            raise ValueError("Chart data must be a JSON object.")
        series = [
            ChartSeries(name=s.get("name", ""), values=s.get("values", []))
            for s in spec_json.get("series", [])
        ]
        spec = ChartSpec(
            title=spec_json.get("title", ""),
            labels=spec_json.get("labels", []),
            series=series,
        )
        png, meta = build(spec, kind=args.kind, width=args.width, height=args.height)
    except (ValueError, _json.JSONDecodeError, OSError) as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2
    console.print(f"[{MUTED}]{meta['kind']} · {sum(meta['points'])} points · "
                  f"{meta['width']}×{meta['height']}[/{MUTED}]")
    return _save_artifact(console, png, args.out or f"aetheris-chart-{meta['kind']}.png", "Chart")


def cmd_slideshow(args: argparse.Namespace) -> int:
    """``aetheris slideshow`` — Ken Burns slideshow GIF from local images."""
    console = _make_console(args)
    from .media.slideshow import Slide, build

    slides = []
    for path in args.images:
        try:
            slides.append(Slide(data=_read_source(path)))
        except ValueError as exc:
            console.print(f"[red]error:[/red] {exc}")
            return 2
    try:
        gif, meta = build(
            slides, width=args.width, height=args.height,
            seconds_per_slide=args.seconds_per_slide,
            transition_seconds=args.transition_seconds, fps=args.fps,
            transition=args.transition, seed=args.seed,
        )
    except ValueError as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2
    console.print(
        f"[{MUTED}]{meta['slides']} slides · {meta['frames']} frames @ {meta['fps']}fps · "
        f"{meta['duration_seconds']}s · transition {meta['transition']}[/{MUTED}]"
    )
    return _save_artifact(console, gif, args.out or "aetheris-slideshow.gif", "Slideshow")


def cmd_visualize(args: argparse.Namespace) -> int:
    """``aetheris visualize`` — animate a WAV file into a visualizer GIF."""
    console = _make_console(args)
    from .media.visualizer import build

    try:
        wav = _read_source(args.audio)
        gif, meta = build(
            wav, mode=args.mode, width=args.width, height=args.height,
            bins=args.bins, label=args.label, max_seconds=args.max_seconds,
        )
    except (ValueError, RuntimeError) as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2
    console.print(
        f"[{MUTED}]mode {meta['mode']} · {meta['frames']} frames @ {meta['fps']}fps · "
        f"{meta['audio_seconds']}s of audio[/{MUTED}]"
    )
    return _save_artifact(console, gif, args.out or "aetheris-visualizer.gif", "Visualizer")


def cmd_song(args: argparse.Namespace) -> int:
    """``aetheris song`` — compose a structured stereo song."""
    console = _make_console(args)
    from .media.song import compose

    try:
        wav, meta = compose(
            args.mood, key=args.key, tempo=args.tempo,
            verse_bars=args.verse_bars, chorus_bars=args.chorus_bars,
            seed=args.seed,
        )
    except ValueError as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2
    console.print(
        f"[{MUTED}]mood [bold]{meta['mood']}[/bold] · key {meta['key']} · {meta['tempo']}bpm · "
        f"{meta['seconds']}s · {len(meta['sections'])} sections · chords {meta['chords']}[/{MUTED}]"
    )
    return _save_artifact(console, wav, args.out or f"aetheris-song-{meta['mood']}.wav", "Song")


def cmd_ambient(args: argparse.Namespace) -> int:
    """``aetheris ambient`` — synthesise a soundscape or sound effect."""
    console = _make_console(args)
    from .media.ambient import render

    try:
        wav, meta = render(args.kind, seconds=args.seconds, seed=args.seed)
    except ValueError as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2
    console.print(f"[{MUTED}]{meta['kind']} · {meta['seconds']}s · stereo 44.1kHz · "
                  f"seed {meta['seed']}[/{MUTED}]")
    return _save_artifact(console, wav, args.out or f"aetheris-{meta['kind']}.wav", "Ambient")


def cmd_podcast(args: argparse.Namespace) -> int:
    """``aetheris podcast`` — narration over a ducked music bed."""
    console = _make_console(args)
    from .media.podcast import build_intro

    text = " ".join(args.text).strip()
    if not text:
        console.print("[red]error:[/red] provide some narration text.")
        return 2
    try:
        wav, meta = build_intro(
            text, voice=args.voice, rate=args.rate, pitch=args.pitch,
            music=args.music, key=args.key, tempo=args.tempo,
            duck_depth=args.duck, jingle=not args.no_jingle, seed=args.seed,
        )
    except ValueError as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2
    console.print(
        f"[{MUTED}]voice {meta['voice']} @ {meta['rate']}× · music {meta['music']} "
        f"({meta['key']}) · duck {meta['duck_depth']} · {meta['seconds']}s[/{MUTED}]"
    )
    return _save_artifact(console, wav, args.out or "aetheris-podcast-intro.wav", "Podcast intro")


def cmd_code_agent(args: argparse.Namespace) -> int:
    """``aetheris code`` — Claude Code-style build agent (plan→write→verify→fix→ship)."""
    console = _make_console(args)
    from .services.coder import run_coder

    task = " ".join(args.task).strip()
    if not task:
        console.print("[red]error:[/red] provide a task description.")
        return 2
    try:
        result = asyncio.run(run_coder(
            task,
            name=args.name,
            kind=args.kind,
            push_repo=args.push,
            branch=args.branch,
            commit_message=args.commit_message,
            create_pr=not args.no_pr,
        ))
    except (ValueError, RuntimeError) as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2

    for record in result.steps:
        style = {"passed": TEAL, "failed": "red", "fixed": "yellow", "skipped": MUTED}.get(
            record.status, MUTED
        )
        console.print(
            f"  [bold]{record.step:9s}[/bold] [{style}]{record.status}[/{style}]"
            f" [{MUTED}]{record.detail[:100]}[/{MUTED}]"
        )
    console.print(
        f"[{TEAL}]Build complete[/{TEAL}] [bold]{result.name}[/bold] · engine {result.engine} · "
        f"{len(result.files)} files · artifact {result.artifact_url}"
    )
    if result.github and "error" not in result.github:
        console.print(
            f"[{TEAL}]Pushed to GitHub[/{TEAL}] https://github.com/{result.github['repo']}/tree/{result.github['branch']}"
            + (f"\n[{TEAL}]Pull request[/{TEAL}] {result.github['pr_url']}" if result.github.get("pr_url") else "")
        )
    if args.out:
        import io
        import zipfile
        from pathlib import Path

        with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED) as archive:
            for path, content in result.files.items():
                archive.writestr(path, content)
        console.print(f"[{TEAL}]ZIP written[/{TEAL}] [bold]{args.out}[/bold]")
    return 0


def cmd_github(args: argparse.Namespace) -> int:
    """``aetheris github`` — push code directly to GitHub."""
    console = _make_console(args)
    from .services.github_client import GitHubClient, GitHubError

    async def run():
        client = GitHubClient()
        try:
            if args.action == "status":
                return await client.status()
            if args.action == "repo-create":
                if not args.repo:
                    raise GitHubError("repo-create needs a repository as owner/name.")
                return await client.create_repo(args.repo, description=args.message, private=args.private)
            # push
            if not args.repo:
                raise GitHubError("push needs a repository as owner/name.")
            from pathlib import Path

            files: dict[str, str] = {}
            root = Path(args.dir).expanduser() if args.dir else None
            if root is not None and root.is_dir():
                for path in sorted(p for p in root.rglob("*") if p.is_file()):
                    if ".git" in path.parts:
                        continue
                    try:
                        files[str(path.relative_to(root))] = path.read_text(encoding="utf-8")
                    except (UnicodeDecodeError, OSError):
                        continue
            for token in (args.files or "").split(","):
                token = token.strip()
                if not token:
                    continue
                path = Path(token).expanduser()
                if not path.is_file():
                    raise GitHubError(f"no such file: {token}")
                files[path.name] = path.read_text(encoding="utf-8")
            if not files:
                raise GitHubError("nothing to push: pass --dir DIR or --files a,b,c.")
            return await client.push(
                args.repo, files,
                branch=args.branch,
                commit_message=args.message,
                create_pr=not args.no_pr,
                private=args.private,
            )
        finally:
            await client.aclose()

    try:
        result = asyncio.run(run())
    except (GitHubError, ValueError) as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2

    if args.action == "status":
        if result.get("connected"):
            console.print(
                f"[{TEAL}]GitHub connected[/{TEAL}] transport [bold]{result['transport']}[/bold] · "
                f"user [bold]{result.get('user') or 'unknown'}[/bold]"
            )
        else:
            console.print(f"[red]GitHub not connected[/red] {result.get('detail', '')}")
        return 0
    if args.action == "repo-create":
        console.print(
            f"[{TEAL}]{'Created' if result.get('created') else 'Already exists'}[/{TEAL}] "
            f"[bold]{result['repo']}[/bold] {result.get('html_url', '')}"
        )
        return 0
    console.print(
        f"[{TEAL}]Pushed {result['files']} file(s)[/{TEAL}] to [bold]{result['repo']}[/bold]@"
        f"[bold]{result['branch']}[/bold] · commit {result['commit']}"
    )
    if result.get("pr_url"):
        console.print(f"[{TEAL}]Pull request[/{TEAL}] {result['pr_url']}")
    if result.get("pr_note"):
        console.print(f"[yellow]PR note[/yellow] {result['pr_note']}")
    return 0


def cmd_keys(args: argparse.Namespace) -> int:
    """``aetheris keys`` — configure and verify provider API keys."""
    console = _make_console(args)
    from .services import keys as K

    if args.action == "set":
        try:
            result = K.set_key(args.slot, args.value)
        except ValueError as exc:
            console.print(f"[red]error:[/red] {exc}")
            return 2
        console.print(
            f"[{TEAL}]Key saved[/{TEAL}] [bold]{result['env']}[/bold] = {result['masked']} "
            f"→ {result['file']}"
        )
        console.print(f"[yellow]{result['note']}[/yellow]")
        return 0

    if args.action == "unset":
        try:
            result = K.unset_key(args.slot)
        except ValueError as exc:
            console.print(f"[red]error:[/red] {exc}")
            return 2
        console.print(f"[{TEAL}]Removed[/{TEAL}] {result['env']} from {result['file']}")
        return 0

    if args.action == "test":
        with console.status("[teal]Probing configured keys…[/teal]"):
            results = asyncio.run(K.probe_all())
        for row in results:
            if row["ok"] is True:
                style, note = TEAL, "· " + row.get("feeds", "")
            elif row["ok"] is False:
                style, note = "red", "· " + row.get("detail", "")
            else:
                style, note = MUTED, ""
            console.print(f"  [bold]{row['slot']:14s}[/bold] [{style}]{'ok' if row['ok'] else 'not configured' if row['ok'] is None else 'failed'}[/{style}]{note}")
        return 0

    # status
    rows = K.key_status()
    configured = sum(1 for r in rows if r["configured"])
    console.print(f"[{MUTED}]{configured}/{len(rows)} provider keys configured. "
                  f"Without keys Aetheris uses its offline engines; add a key to "
                  f"upgrade to real generative models.[/{MUTED}]\n")
    for row in rows:
        state = f"[{TEAL}]{row['masked']}[/{TEAL}]" if row["configured"] else "[red]—[/red]"
        fallback = " [yellow](via fallback env)[/yellow]" if row.get("uses_fallback_env") else ""
        console.print(
            f"  [bold]{row['slot']:14s}[/bold] {state}{fallback}  "
            f"[{MUTED}]{row['label']}[/{MUTED}]"
        )
        console.print(f"  {'':14s}  [{MUTED}]env {row['env']} · feeds: {', '.join(row['feeds'])}[/{MUTED}]")
    if args.json:
        import json as _json
        console.print(_json.dumps(rows, indent=2))
    console.print(
        f"\n[{MUTED}]Set one with:[/{MUTED}] [bold]aetheris keys set gemini-image <key>[/bold]"
        f"\n[{MUTED}]Free keys:[/{MUTED}] aistudio.google.com/apikey · platform.openai.com · build.nvidia.com"
    )
    return 0


# ---------------------------------------------------------------------------
# Inference helpers
# ---------------------------------------------------------------------------

def _mount_documents(console: Console, paths: list[str] | None) -> int:
    """Index local files so ``document_search`` can retrieve from them."""
    if not paths:
        return 0
    from pathlib import Path

    from .tools.retrieval import get_index

    index = get_index()
    mounted = 0
    for raw in paths:
        path = Path(raw).expanduser()
        if not path.is_file():
            console.print(f"[red]warning:[/red] no such file: {path}")
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            console.print(f"[red]warning:[/red] could not read {path}: {exc}")
            continue
        document = index.add(text, title=path.name, source="cli", metadata={"path": str(path)})
        console.print(
            f"[{MUTED}]mounted [bold]{document.title}[/bold] "
            f"({document.char_count:,} chars, {len(document.chunk_ids)} chunks)[/{MUTED}]"
        )
        mounted += 1
    return mounted


def _build_user_message(prompt: str, images: list[str] | None):
    """Build a user turn, attaching images as multimodal content parts."""
    from .schemas.chat import ChatMessage, ImagePart, ImageURL, TextPart

    if not images:
        return ChatMessage(role="user", content=prompt)

    import base64
    import mimetypes
    from pathlib import Path

    parts: list = [TextPart(text=prompt)]
    for raw in images:
        if raw.startswith(("http://", "https://", "data:")):
            parts.append(ImagePart(image_url=ImageURL(url=raw)))
            continue
        path = Path(raw).expanduser()
        if not path.is_file():
            raise ValueError(f"no such image: {path}")
        mime = mimetypes.guess_type(path.name)[0] or "image/png"
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        parts.append(ImagePart(image_url=ImageURL(url=f"data:{mime};base64,{encoded}")))
    return ChatMessage(role="user", content=parts)


def _inference_kwargs(args: argparse.Namespace) -> dict:
    """Translate CLI capability flags into ``prepare_conversation`` kwargs."""
    tools = getattr(args, "tools", None)
    agent = bool(getattr(args, "agent", False))
    if agent and tools is None:
        tools = "auto"
    return {
        "tools": tools,
        "agent": agent,
        "max_tool_iterations": getattr(args, "max_tool_iterations", None),
    }


async def _agent_to_console(console: Console, provider, prepared, *, markdown: bool) -> str:
    """Run the agent loop, printing each executed tool call as it happens."""
    from .services.agent import stream_agent

    parts: list[str] = []
    async for event, payload in stream_agent(prepared, provider):
        if event == "tool":
            status = "[green]✓[/green]" if payload.ok else "[red]✗[/red]"
            console.print(
                f"{status} [bold {TEAL}]{payload.tool}[/bold {TEAL}] "
                f"[{MUTED}]{payload.duration_ms}ms[/{MUTED}]"
            )
            body = payload.output if payload.ok else (payload.error or "failed")
            snippet = body if len(body) <= 600 else body[:600] + "\n… [truncated]"
            console.print(Panel(snippet, border_style=MUTED, box=ROUNDED, expand=False))
            continue
        parts.append(payload)
        if not markdown:
            console.out(payload, end="")
            console.file.flush()

    text = "".join(parts)
    if markdown:
        console.print(Markdown(text))
    else:
        console.out("\n")
    return text


async def _stream_to_console(console: Console, provider, prepared) -> str:
    """Stream deltas live to the console and return the full text."""
    parts: list[str] = []
    async for delta in provider.stream(prepared):
        if delta:
            parts.append(delta)
            # Raw output so markdown/code chars are not re-interpreted by rich.
            console.out(delta, end="")
            # Flush so each delta is visible immediately (live streaming feel).
            console.file.flush()
    console.out("\n")
    return "".join(parts)


async def _complete_to_console(console: Console, provider, prepared, *, markdown: bool) -> str:
    """Generate a full completion and print it (optionally as Markdown)."""
    result = await provider.complete(prepared)
    if markdown:
        console.print(Markdown(result.text))
    else:
        console.print(result.text)
    console.print()
    return result.text


# ---------------------------------------------------------------------------
# Subcommand: chat (interactive REPL)
# ---------------------------------------------------------------------------

HELP_TEXT = """\
[b]Aetheris chat[/b] — slash commands:

  [teal]/model[/teal] [TIER]   show or switch tier (lite|flash|pro|ultra|aetheris-*)
  [teal]/mode[/teal]   [MODE]   show or switch mode (general|engineering|editorial|myth|legendary|pro|lite|flash|sovereign)
  [teal]/models[/teal]          list all tiers
  [teal]/modes[/teal]           list all modes
  [teal]/agent[/teal] [on|off]  toggle agentic tool use (plan → call tools → self-correct)
  [teal]/tools[/teal]           list the executable toolbelt
  [teal]/mount[/teal] PATH      index a file so /agent can search it
  [teal]/docs[/teal]            list mounted documents
  [teal]/image[/teal] PATH|URL  attach an image to the next message
  [teal]/system[/teal]          print the active system prompt
  [teal]/info[/teal]            brand identity
  [teal]/spec[/teal]            architecture + training spec
  [teal]/md[/teal]   [on|off]   toggle Markdown rendering of responses
  [teal]/clear[/teal]           clear conversation history
  [teal]/help[/teal], [teal]/?[/teal]        this help
  [teal]/quit[/teal], [teal]/exit[/teal]     leave the chat

Anything else is sent to the active model. Type [teal]/quit[/teal] or press Ctrl+C/D to exit.\
"""


class _ChatSession:
    """State for an interactive chat session."""

    def __init__(
        self,
        console: Console,
        model: str | None,
        mode: str | None,
        markdown: bool,
        agent: bool = False,
    ):
        self.console = console
        self.history: list[Any] = []  # list[ChatMessage]
        self.markdown = markdown
        self.agent = agent
        self.pending_images: list[str] = []
        # Resolve + validate the starting tier/mode immediately.
        from .schemas.chat import ChatMessage  # noqa: F401  (used in _add)
        self._ChatMessage = ChatMessage
        self.tier = get_tier(model)
        self.mode = get_mode(mode)

    # -- display --
    def banner(self) -> None:
        head = Text()
        head.append("Æ  ", style=f"bold {TEAL}")
        head.append(f"{b.NAME}", style=f"bold {TEAL}")
        head.append(f"  v{__version__}\n", style="dim")
        head.append(b.tagline() + "\n\n", style=MUTED)
        head.append("model: ", style=MUTED)
        head.append(f"{self.tier.id}", style=TEAL)
        head.append("   mode: ", style=MUTED)
        head.append(f"{self.mode.id}", style=TEAL)
        head.append("   render: ", style=MUTED)
        head.append("markdown" if self.markdown else "stream", style=TEAL)
        head.append("   agent: ", style=MUTED)
        head.append("on" if self.agent else "off", style=TEAL if self.agent else MUTED)
        head.append("\n", style="")
        self.console.print(Panel(head, border_style=TEAL, box=ROUNDED, padding=(1, 2)))
        self.console.print(HELP_TEXT)
        self.console.print()

    def status_line(self) -> None:
        self.console.print(
            f"[{MUTED}]model [bold]{self.tier.id}[/bold] · mode [bold]{self.mode.id}[/bold]"
            f" · render [bold]{'md' if self.markdown else 'stream'}[/bold]"
            f" · agent [bold]{'on' if self.agent else 'off'}[/bold][/{MUTED}]"
        )

    # -- history --
    def _add(self, role: str, content: str) -> None:
        self.history.append(self._ChatMessage(role=role, content=content))

    # -- slash commands --
    def slash(self, line: str) -> bool:
        """Handle a slash command. Return True if handled, False to exit, None if not a command."""
        parts = line.strip().split()
        if not parts or not parts[0].startswith("/"):
            return None  # not a command
        cmd = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else None

        if cmd in ("/quit", "/exit"):
            return False
        if cmd in ("/help", "/?"):
            self.console.print(HELP_TEXT)
            return True
        if cmd == "/model":
            if not arg:
                self.console.print(f"[{MUTED}]current model: [bold]{self.tier.id}[/bold]"
                                   f" (alias {self.tier.alias})[/{MUTED}]")
            else:
                try:
                    self.tier = get_tier(arg)
                    self.console.print(f"[{TEAL}]model → {self.tier.id}[/{TEAL}]")
                except KeyError as exc:
                    self.console.print(f"[red]error:[/red] {exc.args[0] if exc.args else exc}")
            return True
        if cmd == "/mode":
            if not arg:
                self.console.print(f"[{MUTED}]current mode: [bold]{self.mode.id}[/bold][/{MUTED}]")
            else:
                try:
                    self.mode = get_mode(arg)
                    self.console.print(f"[{TEAL}]mode → {self.mode.id}[/{TEAL}]")
                except KeyError as exc:
                    self.console.print(f"[red]error:[/red] {exc.args[0] if exc.args else exc}")
            return True
        if cmd == "/models":
            render_models(self.console)
            return True
        if cmd == "/modes":
            render_modes(self.console)
            return True
        if cmd == "/agent":
            if arg in ("on", "true", "1"):
                self.agent = True
            elif arg in ("off", "false", "0"):
                self.agent = False
            elif arg is None:
                self.agent = not self.agent
            self.console.print(
                f"[{TEAL}]agentic tool use → {'on' if self.agent else 'off'}[/{TEAL}]"
            )
            if self.agent:
                from .tools import all_tools

                names = ", ".join(t.name for t in all_tools())
                self.console.print(f"[{MUTED}]toolbelt: {names}[/{MUTED}]")
            return True
        if cmd == "/tools":
            from .tools import all_tools

            table = Table(title="Aetheris toolbelt", box=ROUNDED, border_style=TEAL)
            table.add_column("Tool", style=TEAL, no_wrap=True)
            table.add_column("Status", justify="center")
            table.add_column("What it does")
            for tool in all_tools(include_disabled=True):
                table.add_row(
                    tool.name,
                    "[green]live[/green]" if tool.enabled else f"[{AMBER}]off[/{AMBER}]",
                    tool.description.split(". ")[0] + ".",
                )
            self.console.print(table)
            return True
        if cmd == "/mount":
            if not arg:
                self.console.print(f"[{MUTED}]usage: /mount <path>[/{MUTED}]")
            else:
                _mount_documents(self.console, [arg])
            return True
        if cmd == "/docs":
            from .tools.retrieval import get_index

            documents = get_index().documents
            if not documents:
                self.console.print(f"[{MUTED}]no documents mounted. use /mount <path>[/{MUTED}]")
                return True
            table = Table(title="Mounted documents", box=ROUNDED, border_style=TEAL)
            table.add_column("Title", style=TEAL)
            table.add_column("Chars", justify="right")
            table.add_column("Chunks", justify="right")
            table.add_column("ID", style="dim")
            for document in documents:
                table.add_row(
                    document.title,
                    f"{document.char_count:,}",
                    str(len(document.chunk_ids)),
                    document.id,
                )
            self.console.print(table)
            return True
        if cmd == "/image":
            if not arg:
                if self.pending_images:
                    self.console.print(
                        f"[{MUTED}]pending images: {', '.join(self.pending_images)}[/{MUTED}]"
                    )
                else:
                    self.console.print(f"[{MUTED}]usage: /image <path or url>[/{MUTED}]")
                return True
            from pathlib import Path

            if not arg.startswith(("http://", "https://", "data:")) and not Path(arg).expanduser().is_file():
                self.console.print(f"[red]error:[/red] no such image: {arg}")
                return True
            self.pending_images.append(arg)
            self.console.print(
                f"[{TEAL}]image attached → next message carries "
                f"{len(self.pending_images)} image(s)[/{TEAL}]"
            )
            return True
        if cmd == "/system":
            self.console.print(Panel(self.mode.system_prompt,
                                     title=f"[bold]system prompt · {self.mode.id}[/bold]",
                                     border_style=TEAL, box=ROUNDED))
            return True
        if cmd == "/info":
            render_info(self.console)
            return True
        if cmd == "/spec":
            render_spec(self.console)
            return True
        if cmd == "/md":
            if arg in ("on", "true", "1"):
                self.markdown = True
            elif arg in ("off", "false", "0"):
                self.markdown = False
            else:
                self.markdown = not self.markdown
            self.console.print(f"[{TEAL}]render → {'markdown' if self.markdown else 'stream'}[/{TEAL}]")
            return True
        if cmd == "/clear":
            self.history.clear()
            self.console.print(f"[{TEAL}]conversation cleared[/{TEAL}]")
            return True
        self.console.print(f"[red]unknown command:[/red] {cmd}  (try [teal]/help[/teal])")
        return True


async def _chat_async(args: argparse.Namespace) -> int:
    console = _make_console(args)
    from .services.llm import close_provider, get_provider, prepare_conversation

    try:
        session = _ChatSession(
            console, args.model, args.mode, args.markdown, agent=bool(getattr(args, "agent", False))
        )
    except KeyError as exc:
        console.print(f"[red]error:[/red] {exc.args[0] if exc.args else exc}")
        return 2
    _mount_documents(console, getattr(args, "doc", None))
    session.pending_images = list(getattr(args, "image", None) or [])
    session.banner()

    provider = get_provider()
    marker = _input_marker(args.no_color)
    try:
        while True:
            try:
                # input(marker) flushes the colored marker before reading.
                line = await asyncio.to_thread(input, marker)
            except (EOFError, KeyboardInterrupt):
                console.print("\n[dim]goodbye.[/dim]")
                break
            text = line.strip()
            if not text:
                continue

            handled = session.slash(text)
            if handled is False:  # /quit or /exit
                console.print("[dim]goodbye.[/dim]")
                break
            if handled is True:  # a slash command was handled
                continue
            # handled is None → it's a user message.
            try:
                session.history.append(_build_user_message(text, session.pending_images))
            except ValueError as exc:
                console.print(f"[red]error:[/red] {exc}")
                continue
            session.pending_images = []
            try:
                prepared = prepare_conversation(
                    list(session.history),
                    model=session.tier.id,
                    mode=session.mode.id,
                    tools="auto" if session.agent else None,
                    agent=session.agent,
                )
            except KeyError as exc:
                console.print(f"[red]error:[/red] {exc.args[0] if exc.args else exc}")
                continue
            except ValueError as exc:
                console.print(f"[red]error:[/red] {exc}")
                continue
            console.print()
            try:
                if prepared.agentic:
                    reply = await _agent_to_console(
                        console, provider, prepared, markdown=session.markdown
                    )
                elif session.markdown:
                    reply = await _complete_to_console(console, provider, prepared, markdown=True)
                else:
                    reply = await _stream_to_console(console, provider, prepared)
            except Exception as exc:  # noqa: BLE001 - surface provider errors inline
                console.print(f"[red]generation error:[/red] {exc}")
                continue
            session._add("assistant", reply)
            console.print()
    finally:
        await close_provider()
    return 0


# ---------------------------------------------------------------------------
# Subcommand: ask / stream (one-shot)
# ---------------------------------------------------------------------------

async def _ask_async(args: argparse.Namespace) -> int:
    console = _make_console(args)
    from .schemas.chat import ChatMessage
    from .services.llm import close_provider, get_provider, prepare_conversation

    prompt = " ".join(args.prompt).strip()
    if not prompt:
        console.print("[red]error:[/red] no prompt provided.")
        return 2

    _mount_documents(console, getattr(args, "doc", None))
    try:
        messages = [_build_user_message(prompt, getattr(args, "image", None))]
    except ValueError as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2

    try:
        prepared = prepare_conversation(
            messages, model=args.model, mode=args.mode,
            temperature=args.temperature, max_tokens=args.max_tokens, top_p=args.top_p,
            **_inference_kwargs(args),
        )
    except KeyError as exc:
        console.print(f"[red]error:[/red] {exc.args[0] if exc.args else exc}")
        return 2
    except ValueError as exc:
        console.print(f"[red]error:[/red] {exc}")
        return 2

    # Header line showing the resolved tier/mode and any active capabilities.
    extras = []
    if prepared.agentic:
        extras.append("agent")
    if prepared.tools:
        extras.append(f"{len(prepared.tools)} tools")
    if prepared.has_images:
        extras.append("vision")
    suffix = (" · " + " · ".join(f"[bold]{e}[/bold]" for e in extras)) if extras else ""
    console.print(
        f"[{MUTED}]model [bold]{prepared.tier.id}[/bold] · mode [bold]{prepared.mode.id}[/bold]"
        f" · render [bold]{'md' if args.markdown else 'stream'}[/bold]{suffix}[/{MUTED}]\n"
    )

    provider = get_provider()
    try:
        try:
            if prepared.agentic:
                await _agent_to_console(console, provider, prepared, markdown=args.markdown)
            elif args.markdown:
                await _complete_to_console(console, provider, prepared, markdown=True)
            else:
                await _stream_to_console(console, provider, prepared)
        except Exception as exc:  # noqa: BLE001
            console.print(f"[red]generation error:[/red] {exc}")
            return 1
    finally:
        await close_provider()
    return 0


# ---------------------------------------------------------------------------
# Subcommand: hermes
# ---------------------------------------------------------------------------

async def _hermes_async(args: argparse.Namespace) -> int:
    """Run a task through the unified Hermes cascade, or report learning state."""
    console = _make_console(args)
    from .hermes.agent import get_hermes
    from .hermes.meta_learning import get_meta_learner

    task = " ".join(args.task).strip()

    # No task: report what the meta-learner has learned so far.
    if not task:
        stats = get_meta_learner().stats()
        if args.json:
            console.print_json(json.dumps(stats))
            return 0

        table = Table(title="Hermes meta-learning state", box=ROUNDED, border_style=TEAL)
        table.add_column("Metric", style=TEAL, no_wrap=True)
        table.add_column("Value")
        table.add_row("Episodes learned from", str(stats["episodes"]))
        table.add_row("Meta-updates", str(stats["updates"]))
        table.add_row("Few-shot exemplars", str(stats["exemplars"]))
        table.add_row("Mean reward", f"{stats['mean_reward']:.3f}")
        table.add_row("Recent mean reward", f"{stats['recent_mean_reward']:.3f}")
        table.add_row("Trend", "improving" if stats["improving"] else "steady")
        console.print(table)

        strategy = Table(title="Adapted strategy", box=ROUNDED, border_style=TEAL)
        strategy.add_column("Knob", style=TEAL)
        strategy.add_column("Value", justify="right")
        for key, value in stats["strategy"].items():
            strategy.add_row(key.replace("_", " "), f"{value:.4f}")
        console.print(strategy)

        if stats["tool_priors"]:
            tools = Table(title="Learned tool priors", box=ROUNDED, border_style=TEAL)
            tools.add_column("Intent", style=TEAL)
            tools.add_column("Tool")
            tools.add_column("Success", justify="right")
            tools.add_column("Attempts", justify="right")
            for prior in stats["tool_priors"][:12]:
                tools.add_row(
                    prior["intent"], prior["tool"],
                    f"{prior['success_rate'] * 100:.0f}%", str(prior["attempts"]),
                )
            console.print(tools)
        return 0

    result = await get_hermes().run(task, learn=not args.no_learn)

    if args.json:
        console.print_json(json.dumps(result.to_dict()))
        return 0

    if args.trace:
        trace = Table(title="Hermes cascade", box=ROUNDED, border_style=TEAL)
        trace.add_column("Stage", style=TEAL, no_wrap=True)
        trace.add_column("Summary")
        trace.add_column("ms", justify="right")
        for stage in result.stages:
            trace.add_row(
                stage.name,
                stage.summary,
                "skipped" if stage.skipped else f"{stage.duration_ms:.1f}",
            )
        console.print(trace)

    console.print(Markdown(result.answer))
    console.print(
        f"\n[dim]intent={result.intent} · confidence={result.confidence:.0%} · "
        f"reward={result.reward:.2f} · {result.duration_ms:.0f}ms"
        + (f" · episode={result.episode_id}" if result.episode_id else "")
        + "[/dim]"
    )
    return 0


# ---------------------------------------------------------------------------
# Subcommand: health
# ---------------------------------------------------------------------------

async def _health_async(args: argparse.Namespace) -> int:
    console = _make_console(args)

    if args.base_url:
        import httpx
        url = args.base_url.rstrip("/") + "/v1/health"
        try:
            async with httpx.AsyncClient(timeout=args.timeout) as client:
                resp = await client.get(url)
                data = resp.json()
        except Exception as exc:  # noqa: BLE001
            console.print(f"[red]could not reach {url}:[/red] {exc}")
            return 1
        if args.json:
            console.print_json(json.dumps(data))
        else:
            console.print(f"[{TEAL}]server health — {url}[/{TEAL}]")
            for k, v in data.items():
                console.print(f"  [{MUTED}]{k:<20}[/]  {v}")
        return 0

    # In-process status (no server required).
    from .services.llm import close_provider, get_provider
    from .services.mock_provider import MockProvider

    provider = get_provider()
    name = getattr(provider, "provider_name", type(provider).__name__)
    data = {
        "status": "ok",
        "version": __version__,
        "provider": name,
        "is_mock": isinstance(provider, MockProvider),
        "configured_provider": settings.llm_provider,
        "default_model": "aetheris-pro",
        "default_mode": "general",
        "llm_base_url": settings.llm_base_url,
        "has_credentials": settings.has_credentials,
    }
    await close_provider()
    if args.json:
        console.print_json(json.dumps(data))
    else:
        console.print(f"[{TEAL}]Aetheris v{__version__} — in-process status[/{TEAL}]")
        for k, v in data.items():
            console.print(f"  [{MUTED}]{k:<20}[/]  {v}")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: serve
# ---------------------------------------------------------------------------

def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    host = args.host or settings.host
    port = args.port or settings.port
    print(f"Aetheris v{__version__} — serving HTTP API on http://{host}:{port}")
    uvicorn.run(
        "aetheris.main:app",
        host=host,
        port=port,
        reload=bool(args.reload),
        log_level=args.log_level,
    )
    return 0


# ---------------------------------------------------------------------------
# Argument parsing + dispatch
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="aetheris",
        description=(
            "Aetheris — a next-generation AI thought partner. "
            "Chat with every tier and mode from the command prompt."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--version", action="version", version=f"aetheris {__version__}")
    p.add_argument("--no-color", action="store_true", help="disable ANSI color output")
    sub = p.add_subparsers(dest="command", metavar="<command>")

    # chat
    chat = sub.add_parser("chat", help="interactive REPL with live streaming")
    _add_inference_flags(chat)
    chat.set_defaults(func=_chat_async, is_async=True)

    # ask
    ask = sub.add_parser("ask", help="one-shot prompt (streams live; --md renders markdown)")
    _add_inference_flags(ask)
    ask.add_argument("prompt", nargs="+", help="the prompt (quoted or space-joined)")
    ask.set_defaults(func=_ask_async, is_async=True)

    # stream (explicit alias)
    stream = sub.add_parser("stream", help="one-shot prompt, explicitly streamed")
    _add_inference_flags(stream)
    stream.add_argument("prompt", nargs="+", help="the prompt (quoted or space-joined)")
    stream.set_defaults(func=_ask_async, is_async=True, markdown=False)

    # models / modes / info / spec
    mp = sub.add_parser("models", help="list Aetheris tiers")
    mp.add_argument("--json", action="store_true", help="emit JSON")
    mp.set_defaults(func=lambda a: (render_models(_make_console(a), a.json), 0)[1], is_async=False)

    mp2 = sub.add_parser("modes", help="list inference modes")
    mp2.add_argument("--json", action="store_true", help="emit JSON")
    mp2.set_defaults(func=lambda a: (render_modes(_make_console(a), a.json), 0)[1], is_async=False)

    ip = sub.add_parser("info", help="show brand identity")
    ip.add_argument("--json", action="store_true", help="emit JSON")
    ip.set_defaults(func=lambda a: (render_info(_make_console(a), a.json), 0)[1], is_async=False)

    sp = sub.add_parser("spec", help="show architecture + training spec")
    sp.add_argument("--json", action="store_true", help="emit JSON")
    sp.set_defaults(func=lambda a: (render_spec(_make_console(a), a.json), 0)[1], is_async=False)

    tp = sub.add_parser("tools", help="list the executable toolbelt")
    tp.add_argument("--json", action="store_true", help="emit JSON")
    tp.set_defaults(func=lambda a: (render_tools(_make_console(a), a.json), 0)[1], is_async=False)

    # --- creative generation ---
    ip2 = sub.add_parser("image", help="generate an image (offline or NVIDIA NIM)")
    ip2.add_argument("prompt", nargs="+", help="what to depict")
    ip2.add_argument("-o", "--out", default=None, help="output path (extension follows active provider)")
    ip2.add_argument("--style", default=None,
                     help="landscape|space|waves|particles|geometric|spiral|gradient|poster")
    ip2.add_argument("--palette", default=None, help="palette name or comma-separated hex colours")
    ip2.add_argument("--width", type=int, default=1024)
    ip2.add_argument("--height", type=int, default=576)
    ip2.add_argument("--seed", type=int, default=None)
    ip2.set_defaults(func=cmd_image, is_async=False)

    vp = sub.add_parser("video", help="generate video (offline GIF or NVIDIA Cosmos MP4)")
    vp.add_argument("prompt", nargs="+", help="what to animate")
    vp.add_argument("-o", "--out", default=None, help="output path (extension follows active provider)")
    vp.add_argument("--motion", default=None,
                    help="orbit|waveform|pulse|starfield|spiral|bars|gradient|typewriter")
    vp.add_argument("--palette", default=None, help="palette name or hex colours")
    vp.add_argument("--seconds", type=float, default=3.0)
    vp.add_argument("--fps", type=int, default=12)
    vp.add_argument("--width", type=int, default=480)
    vp.add_argument("--height", type=int, default=270)
    vp.add_argument("--seed", type=int, default=None)
    vp.set_defaults(func=cmd_video, is_async=False)

    ap = sub.add_parser("audio", help="synthesise a WAV file")
    ap.add_argument("--mode", default="compose", choices=("compose", "melody", "chords", "tone"))
    ap.add_argument("-o", "--out", default=None, help="output path (default aetheris-audio.wav)")
    ap.add_argument("--notation", default="",
                    help="melody notes ('C4:0.5 E4 G4') or chords ('Cmaj7 Amin7')")
    ap.add_argument("--key", default="C4", help="tonic for compose mode")
    ap.add_argument("--scale", default="major",
                    choices=("major", "minor", "pentatonic", "blues", "dorian", "lydian"))
    ap.add_argument("--bars", type=int, default=4)
    ap.add_argument("--frequency", type=float, default=440.0, help="for tone mode")
    ap.add_argument("--seconds", type=float, default=1.0, help="for tone mode")
    ap.add_argument("--tempo", type=int, default=110)
    ap.add_argument("--timbre", default="warm",
                    choices=("sine", "warm", "bright", "organ", "bell", "pluck"))
    ap.set_defaults(func=cmd_audio, is_async=False)

    sp = sub.add_parser("speech", help="speak text aloud to a WAV file (offline TTS)")
    sp.add_argument("text", nargs="+", help="text to speak")
    sp.add_argument("-o", "--out", default=None, help="output path (default aetheris-speech.wav)")
    sp.add_argument("--voice", default="default",
                    choices=("default", "high", "low", "deep", "bright", "robot"),
                    help="offline voice pitch")
    sp.add_argument("--rate", type=float, default=1.0, help="speaking speed 0.5–2.0")
    sp.add_argument("--pitch", type=float, default=1.0, help="voice pitch 0.5–2.0")
    sp.set_defaults(func=cmd_speech, is_async=False)

    # --- Studio Pro: advanced image/video/audio generation ---
    qp = sub.add_parser("qr", help="encode text as a styled QR code PNG")
    qp.add_argument("data", help="text to encode (URL, Wi-Fi, contact, …)")
    qp.add_argument("-o", "--out", default=None, help="output path (default aetheris-qr.png)")
    qp.add_argument("--ecl", default="M", choices=("L", "M", "Q", "H"),
                    help="error-correction level")
    qp.add_argument("--width", type=int, default=420)
    qp.add_argument("--foreground", default="#0b132b")
    qp.add_argument("--background", default="#f8f9fa")
    qp.add_argument("--rounded", action="store_true", help="soften module corners")
    qp.add_argument("--letter", default="", help="centre letter (one character)")
    qp.set_defaults(func=cmd_qr, is_async=False)

    rp = sub.add_parser("remix", help="reimagine/restyle a local PNG from its palette")
    rp.add_argument("image", help="source PNG path")
    rp.add_argument("prompt", nargs="*", default=[], help="what to reimagine")
    rp.add_argument("-o", "--out", default=None, help="output path (default aetheris-remix.png)")
    rp.add_argument("--operation", default="reimagine", choices=("reimagine", "restyle"))
    rp.add_argument("--palette", default=None, help="for restyle: palette name or hex list")
    rp.add_argument("--style", default=None, help="for reimagine: explicit procedural style")
    rp.add_argument("--width", type=int, default=1024)
    rp.add_argument("--height", type=int, default=576)
    rp.add_argument("--no-dither", action="store_true", help="disable Floyd–Steinberg dithering")
    rp.add_argument("--seed", type=int, default=None)
    rp.set_defaults(func=cmd_remix, is_async=False)

    cp2 = sub.add_parser("collage", help="compose local images into one sheet")
    cp2.add_argument("images", nargs="+", help="PNG paths (2–16)")
    cp2.add_argument("-o", "--out", default=None, help="output path (default aetheris-collage.png)")
    cp2.add_argument("--layout", default="grid", choices=("grid", "polaroid", "filmstrip"))
    cp2.add_argument("--width", type=int, default=1280)
    cp2.add_argument("--height", type=int, default=720)
    cp2.add_argument("--background", default="#0b132b")
    cp2.add_argument("--seed", type=int, default=11)
    cp2.set_defaults(func=cmd_collage, is_async=False)

    chp = sub.add_parser("chart", help="render a chart from JSON data (or a JSON file)")
    chp.add_argument("data", help="JSON: {\"title\", \"labels\", \"series\":[{\"name\",\"values\"}]}")
    chp.add_argument("-o", "--out", default=None, help="output path (default aetheris-chart-<kind>.png)")
    chp.add_argument("--kind", default="line", choices=("line", "bar", "pie", "donut", "radar"))
    chp.add_argument("--width", type=int, default=960)
    chp.add_argument("--height", type=int, default=560)
    chp.set_defaults(func=cmd_chart, is_async=False)

    slp = sub.add_parser("slideshow", help="Ken Burns slideshow GIF from local images")
    slp.add_argument("images", nargs="+", help="PNG paths (1–16)")
    slp.add_argument("-o", "--out", default=None, help="output path (default aetheris-slideshow.gif)")
    slp.add_argument("--width", type=int, default=640)
    slp.add_argument("--height", type=int, default=360)
    slp.add_argument("--seconds-per-slide", type=float, default=2.5)
    slp.add_argument("--transition-seconds", type=float, default=0.8)
    slp.add_argument("--fps", type=int, default=12)
    slp.add_argument("--transition", default="crossfade",
                     choices=("crossfade", "pan", "zoom", "wipe"))
    slp.add_argument("--seed", type=int, default=5)
    slp.set_defaults(func=cmd_slideshow, is_async=False)

    vp2 = sub.add_parser("visualize", help="animate a WAV file into a synced visualizer GIF")
    vp2.add_argument("audio", help="WAV path")
    vp2.add_argument("-o", "--out", default=None, help="output path (default aetheris-visualizer.gif)")
    vp2.add_argument("--mode", default="bars", choices=("bars", "oscilloscope", "radial", "wave"))
    vp2.add_argument("--width", type=int, default=480)
    vp2.add_argument("--height", type=int, default=270)
    vp2.add_argument("--bins", type=int, default=20, help="spectrum bands (bars/radial)")
    vp2.add_argument("--label", default="", help="caption in the footer")
    vp2.add_argument("--max-seconds", type=float, default=30.0)
    vp2.set_defaults(func=cmd_visualize, is_async=False)

    sop = sub.add_parser("song", help="compose a structured stereo song")
    sop.add_argument("--mood", default="uplifting",
                     choices=("uplifting", "mellow", "epic", "noir", "sparkle"))
    sop.add_argument("-o", "--out", default=None, help="output path (default aetheris-song-<mood>.wav)")
    sop.add_argument("--key", default="C", help="key like C, Am, or F#m")
    sop.add_argument("--tempo", type=int, default=None)
    sop.add_argument("--verse-bars", type=int, default=4)
    sop.add_argument("--chorus-bars", type=int, default=4)
    sop.add_argument("--seed", type=int, default=None)
    sop.set_defaults(func=cmd_song, is_async=False)

    amp = sub.add_parser("ambient", help="synthesise an ambient soundscape or sound effect")
    amp.add_argument("kind", help="rain|wind|ocean|fire|forest|night|cafe|spaceship|laser|coin|…")
    amp.add_argument("-o", "--out", default=None, help="output path (default aetheris-<kind>.wav)")
    amp.add_argument("--seconds", type=float, default=12.0, help="duration (soundscapes only)")
    amp.add_argument("--seed", type=int, default=None)
    amp.set_defaults(func=cmd_ambient, is_async=False)

    pop = sub.add_parser("podcast", help="narration over a ducked music bed (podcast intro)")
    pop.add_argument("text", nargs="+", help="narration text")
    pop.add_argument("-o", "--out", default=None, help="output path (default aetheris-podcast-intro.wav)")
    pop.add_argument("--voice", default="default",
                     choices=("default", "high", "low", "deep", "bright", "robot"))
    pop.add_argument("--rate", type=float, default=1.0)
    pop.add_argument("--pitch", type=float, default=1.0)
    pop.add_argument("--music", default="pad", choices=("pad", "arp", "drone", "none"))
    pop.add_argument("--key", default="Cmaj7", help="music bed chord(s)")
    pop.add_argument("--tempo", type=int, default=96)
    pop.add_argument("--duck", type=float, default=0.35, help="music dip depth 0–0.9")
    pop.add_argument("--no-jingle", action="store_true")
    pop.add_argument("--seed", type=int, default=None)
    pop.set_defaults(func=cmd_podcast, is_async=False)

    cap = sub.add_parser("code", help="build a whole project from a task (Claude Code style)")
    cap.add_argument("task", nargs="+", help="what to build, in plain language")
    cap.add_argument("--name", default="", help="project name (default derived from task)")
    cap.add_argument("--kind", default=None,
                     choices=("fastapi-service", "python-package", "cli-tool", "static-site"))
    cap.add_argument("--push", default="", metavar="OWNER/NAME",
                     help="push the result to this GitHub repository")
    cap.add_argument("--branch", default="", help="branch to push")
    cap.add_argument("--commit-message", default="", help="commit message")
    cap.add_argument("--no-pr", action="store_true", help="do not open a pull request")
    cap.add_argument("-o", "--out", default=None, help="also write the ZIP locally")
    cap.set_defaults(func=cmd_code_agent, is_async=False)

    ghp = sub.add_parser("github", help="push code directly to GitHub")
    ghp.add_argument("action", choices=("status", "repo-create", "push"))
    ghp.add_argument("repo", nargs="?", default="", help="repository as owner/name")
    ghp.add_argument("--dir", default="", help="local directory to push (text files)")
    ghp.add_argument("--files", default="", help="comma-separated local files to push")
    ghp.add_argument("--message", default="Generated by Aetheris", help="commit message / repo description")
    ghp.add_argument("--branch", default="", help="branch to push")
    ghp.add_argument("--no-pr", action="store_true", help="do not open a pull request")
    ghp.add_argument("--private", action="store_true", help="create the repository private")
    ghp.set_defaults(func=cmd_github, is_async=False)

    kp = sub.add_parser("keys", help="configure and verify provider API keys")
    kp.add_argument("action", nargs="?", default="status",
                    choices=("status", "set", "unset", "test"))
    kp.add_argument("slot", nargs="?", default="",
                    help="gemini-image | openai-image | openai-video | gemini-video | nvidia | stability | openai-chat | github")
    kp.add_argument("value", nargs="?", default="", help="the key value (for 'set')")
    kp.add_argument("--json", action="store_true", help="emit the status table as JSON")
    kp.set_defaults(func=cmd_keys, is_async=False)

    pp = sub.add_parser("project", help="scaffold a runnable project")
    pp.add_argument("kind", choices=("fastapi-service", "python-package", "cli-tool", "static-site"))
    pp.add_argument("name", help="project name")
    pp.add_argument("-d", "--description", default="", help="one-line description")
    pp.add_argument("-o", "--out", default=None, help="destination directory (or zip path)")
    pp.add_argument("--zip", action="store_true", help="emit a ZIP archive instead of a tree")
    pp.set_defaults(func=cmd_project, is_async=False)

    cp = sub.add_parser("capabilities", help="show which capabilities are live")
    cp.add_argument("--json", action="store_true", help="emit JSON")
    cp.set_defaults(
        func=lambda a: (render_capabilities(_make_console(a), a.json), 0)[1], is_async=False
    )

    # hermes
    hm = sub.add_parser("hermes", help="run a task through the Hermes cascade, or show learning state")
    hm.add_argument("task", nargs="*", help="task to run (omit to show the learning state)")
    hm.add_argument("--trace", action="store_true", help="show every cascade stage")
    hm.add_argument("--no-learn", action="store_true", help="do not record this episode")
    hm.add_argument("--json", action="store_true", help="emit JSON")
    hm.set_defaults(func=_hermes_async, is_async=True)

    # health
    hp = sub.add_parser("health", help="provider/status, or probe a running server")
    hp.add_argument("--base-url", default=None, help="probe a running Aetheris server at this URL")
    hp.add_argument("--timeout", type=float, default=5.0, help="probe timeout (seconds)")
    hp.add_argument("--json", action="store_true", help="emit JSON")
    hp.set_defaults(func=_health_async, is_async=True)

    # serve
    sv = sub.add_parser("serve", help="launch the HTTP API")
    sv.add_argument("--host", default=None, help="bind host (default: from settings)")
    sv.add_argument("--port", type=int, default=None, help="bind port (default: from settings)")
    sv.add_argument("--reload", action="store_true", help="auto-reload on file changes")
    sv.add_argument("--log-level", default="info",
                    choices=["critical", "error", "warning", "info", "debug", "trace"])
    sv.set_defaults(func=_serve, is_async=False)

    return p


def _add_inference_flags(p: argparse.ArgumentParser) -> None:
    """Add the common model/mode/render flags to a subparser."""
    p.add_argument("-m", "--model", default=None,
                   help="tier: aetheris-lite|flash|aetheris-pro|pro|aetheris-ultra|ultra")
    p.add_argument("-M", "--mode", default=None,
                   help="mode: general|engineering|editorial|structured|myth|legendary|pro|lite|flash|sovereign")
    p.add_argument("--md", dest="markdown", action="store_true",
                   help="buffer and render the response as Markdown (non-streaming)")
    p.add_argument("--temperature", type=float, default=None)
    p.add_argument("--max-tokens", type=int, default=None)
    p.add_argument("--top-p", type=float, default=None)
    p.add_argument("-a", "--agent", action="store_true",
                   help="run the agent loop: call real tools and self-correct before answering")
    p.add_argument("--tools", default=None, metavar="SPEC",
                   help="expose the toolbelt: 'auto' for all built-ins, or 'none'")
    p.add_argument("--max-tool-iterations", type=int, default=None,
                   help="cap the agent's tool-calling rounds (default: server setting)")
    p.add_argument("--doc", action="append", default=None, metavar="PATH",
                   help="mount a file into the retrieval index (repeatable)")
    p.add_argument("--image", action="append", default=None, metavar="PATH_OR_URL",
                   help="attach an image for multimodal input (repeatable)")


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    parser = _build_parser()
    args = parser.parse_args(argv)

    if not getattr(args, "command", None):
        parser.print_help()
        return 0

    func = args.func
    if getattr(args, "is_async", False):
        return asyncio.run(func(args))
    result = func(args)
    return int(result or 0)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())


__all__ = ["main"]
