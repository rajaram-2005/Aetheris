"""Creation tools — image, video, audio, and code-project generation.

These wire the :mod:`aetheris.media` generators into the toolbelt, so the agent
loop can produce real artifacts as part of answering. Each tool stores its output
in the artifact store and returns a short description plus a fetchable URL,
rather than dumping binary data into the conversation.
"""

from __future__ import annotations

import json

from ..core.config import settings
from ..media.store import get_store
from .registry import ToolError, register


def _require(flag: str, label: str) -> None:
    """Raise a clear, actionable error when a capability is switched off."""
    if not getattr(settings, flag, False):
        raise ToolError(
            f"{label} is disabled on this deployment. "
            f"Set AETHERIS_{flag.upper()}=true to enable it."
        )


# --- Image --------------------------------------------------------------------

@register(
    "generate_image",
    (
        "Create an image from a text description and return a URL to the PNG. "
        "By default Aetheris renders procedurally (gradients, landscapes, "
        "starfields, geometric patterns, spirals, waveforms, and typographic "
        "posters). When an upstream image provider (OpenAI DALL-E/gpt-image, "
        "Google Imagen 3, or Stability) is configured with an API key, this uses "
        "that real generative model instead, so it can also produce "
        "photorealistic scenes, objects, and people."
    ),
    {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": "What to depict. Put text to render on a poster in \"quotes\".",
            },
            "style": {
                "type": "string",
                "enum": [
                    "landscape", "space", "waves", "particles",
                    "geometric", "spiral", "gradient", "poster",
                ],
                "description": "Composition to use. Omit to infer it from the prompt.",
            },
            "palette": {
                "type": "string",
                "description": (
                    "Colour scheme: aetheris, sunset, ocean, forest, ember, arctic, "
                    "neon, mono, sakura, gold — or comma-separated hex colours. "
                    "Omit to infer from the prompt."
                ),
            },
            "width": {"type": "integer", "minimum": 64, "maximum": 2048, "description": "Pixels wide (default 1024)."},
            "height": {"type": "integer", "minimum": 64, "maximum": 2048, "description": "Pixels tall (default 576)."},
            "seed": {"type": "integer", "description": "Seed for reproducibility."},
        },
        "required": ["prompt"],
    },
    requires_optin=True,
    optin_setting="image_generation_enabled",
    tags=("creation", "image"),
)
async def generate_image(
    prompt: str,
    style: str | None = None,
    palette: str | None = None,
    width: int = 1024,
    height: int = 576,
    seed: int | None = None,
) -> str:
    """Render a PNG (via the layered image provider) and return its artifact URL."""
    _require("image_generation_enabled", "Image generation")
    from ..media.image_providers import generate_image_bytes

    width = max(64, min(int(width or 1024), settings.media_max_image_dimension))
    height = max(64, min(int(height or 576), settings.media_max_image_dimension))
    try:
        results = await generate_image_bytes(
            prompt, width=width, height=height, n=1, seed=seed,
        )
    except (ValueError, RuntimeError) as exc:
        raise ToolError(str(exc)) from exc

    result = results[0]
    ext = "jpg" if result.media_type == "image/jpeg" else "png"
    kind_slug = str(result.meta.get("style") or result.model or "image")
    artifact = get_store().put(
        kind="image", media_type=result.media_type,
        filename=f"aetheris-{kind_slug}-{result.seed or 'gen'}.{ext}",
        data=result.data, prompt=prompt,
        metadata={
            **result.meta,
            "provider": result.provider,
            "model": result.model,
            "width": width, "height": height, "seed": result.seed,
        },
    )
    return json.dumps({
        "created": "image",
        "url": artifact.url,
        "markdown": f"![{prompt}]({artifact.url})",
        "provider": result.provider,
        "model": result.model,
        "style": result.meta.get("style"),
        "palette": result.meta.get("palette"),
        "dimensions": f"{width}x{height}",
        "seed": result.seed,
        "bytes": artifact.size,
        "note": result.meta.get("note", f"Generated via {result.provider}."),
    }, indent=2)


# --- Video --------------------------------------------------------------------

@register(
    "generate_video",
    (
        "Create a short looping animation from a text description and return a URL "
        "to the GIF. Motion styles include orbiting bodies, travelling waveforms, "
        "emission pulses, star flight, rotating spirals, animated bar charts, "
        "drifting gradients, and typewriter text reveals. Use it for loading loops, "
        "hero animations, data motion, and animated title cards."
    ),
    {
        "type": "object",
        "properties": {
            "prompt": {"type": "string", "description": "What to animate. Quote any on-screen text."},
            "motion": {
                "type": "string",
                "enum": ["orbit", "waveform", "pulse", "starfield", "spiral",
                         "bars", "gradient", "typewriter"],
                "description": "Motion style. Omit to infer from the prompt.",
            },
            "palette": {"type": "string", "description": "Colour scheme (see generate_image)."},
            "seconds": {"type": "number", "minimum": 0.5, "maximum": 10, "description": "Length (default 3)."},
            "fps": {"type": "integer", "minimum": 4, "maximum": 24, "description": "Frames per second (default 12)."},
            "width": {"type": "integer", "minimum": 64, "maximum": 960, "description": "Pixels wide (default 480)."},
            "height": {"type": "integer", "minimum": 64, "maximum": 720, "description": "Pixels tall (default 270)."},
            "seed": {"type": "integer", "description": "Seed for reproducibility."},
        },
        "required": ["prompt"],
    },
    requires_optin=True,
    optin_setting="video_generation_enabled",
    tags=("creation", "video"),
)
async def generate_video(
    prompt: str,
    motion: str | None = None,
    palette: str | None = None,
    seconds: float = 3.0,
    fps: int = 12,
    width: int = 480,
    height: int = 270,
    seed: int | None = None,
) -> str:
    """Render an animated GIF and return its artifact URL."""
    _require("video_generation_enabled", "Video generation")
    from ..media.video import generate

    width = max(64, min(int(width or 480), settings.media_max_video_dimension))
    height = max(64, min(int(height or 270), settings.media_max_video_dimension))
    seconds = max(0.5, min(float(seconds or 3.0), settings.media_max_video_seconds))
    try:
        gif, p = generate(prompt, width=width, height=height, seconds=seconds,
                          fps=fps, motion=motion, palette=palette, seed=seed)
    except ValueError as exc:
        raise ToolError(str(exc)) from exc

    artifact = get_store().put(
        kind="video", media_type="image/gif",
        filename=f"aetheris-{p.motion}-{p.seed}.gif", data=gif, prompt=prompt,
        metadata={"motion": p.motion, "palette": p.palette_name, "frames": p.frames,
                  "fps": p.fps, "duration": round(p.duration, 2), "seed": p.seed},
    )
    return json.dumps({
        "created": "video",
        "url": artifact.url,
        "markdown": f"![{p.caption or prompt}]({artifact.url})",
        "motion": p.motion,
        "frames": p.frames,
        "fps": p.fps,
        "duration_seconds": round(p.duration, 2),
        "dimensions": f"{width}x{height}",
        "bytes": artifact.size,
        "format": "animated GIF (loops forever, plays inline anywhere)",
    }, indent=2)


# --- Audio --------------------------------------------------------------------

@register(
    "generate_audio",
    (
        "Synthesise real audio and return a URL to a WAV file. Modes: 'melody' "
        "(note notation like 'C4:0.5 E4 G4 C5:2'), 'chords' (progression like "
        "'Cmaj7 Amin7 Fmaj7 G'), 'compose' (auto-generate a melody in a key and "
        "scale), or 'tone' (a single frequency). This is instrumental synthesis — "
        "Aetheris has no text-to-speech and cannot produce spoken words or singing."
    ),
    {
        "type": "object",
        "properties": {
            "mode": {
                "type": "string",
                "enum": ["melody", "chords", "compose", "tone"],
                "description": "What to synthesise.",
            },
            "notation": {
                "type": "string",
                "description": (
                    "For 'melody': notes like 'C4:0.5 E4 G4 R:0.5 C5:2' (R is a rest). "
                    "For 'chords': 'Cmaj7 Amin7 Fmaj7 G'."
                ),
            },
            "key": {"type": "string", "description": "For 'compose': tonic such as C4 or F#3."},
            "scale": {
                "type": "string",
                "enum": ["major", "minor", "pentatonic", "blues", "dorian", "lydian"],
                "description": "For 'compose': the scale to walk.",
            },
            "bars": {"type": "integer", "minimum": 1, "maximum": 16, "description": "For 'compose': bar count."},
            "frequency": {"type": "number", "description": "For 'tone': hertz (20-18000)."},
            "seconds": {"type": "number", "description": "For 'tone': duration."},
            "tempo": {"type": "integer", "minimum": 30, "maximum": 240, "description": "Beats per minute."},
            "timbre": {
                "type": "string",
                "enum": ["sine", "warm", "bright", "organ", "bell", "pluck"],
                "description": "Instrument character.",
            },
        },
        "required": ["mode"],
    },
    requires_optin=True,
    optin_setting="audio_generation_enabled",
    tags=("creation", "audio"),
)
async def generate_audio(
    mode: str = "compose",
    notation: str = "",
    key: str = "C4",
    scale: str = "major",
    bars: int = 4,
    frequency: float = 440.0,
    seconds: float = 1.0,
    tempo: int = 110,
    timbre: str = "warm",
) -> str:
    """Synthesise a WAV and return its artifact URL."""
    _require("audio_generation_enabled", "Audio generation")
    from ..media import audio as A

    mode = (mode or "compose").strip().lower()
    detail: dict[str, object] = {"mode": mode, "timbre": timbre}
    try:
        if mode == "melody":
            if not notation.strip():
                raise ToolError("Mode 'melody' needs a 'notation' string, e.g. 'C4:0.5 E4 G4'.")
            track = A.render_melody(notation, tempo=tempo, timbre=timbre)
            detail["notation"] = notation
        elif mode == "chords":
            chords = notation.split() if notation.strip() else ["Cmaj7", "Amin7", "Fmaj7", "G"]
            track = A.render_progression(chords, tempo=tempo, timbre=timbre)
            detail["progression"] = " ".join(chords)
        elif mode == "compose":
            bars = max(1, min(int(bars or 4), 16))
            track, generated = A.render_melody_from_scale(
                key, scale, bars=bars, tempo=tempo, timbre=timbre
            )
            detail.update({"key": key, "scale": scale, "bars": bars, "notation": generated})
        elif mode == "tone":
            track = A.render_tone(float(frequency), float(seconds), timbre)
            detail.update({"frequency_hz": frequency, "seconds": seconds})
        else:
            raise ToolError(f"Unknown mode '{mode}'. Use melody, chords, compose, or tone.")
    except ValueError as exc:
        raise ToolError(str(exc)) from exc

    if track.duration > settings.media_max_audio_seconds:
        raise ToolError(
            f"Requested audio is {track.duration:.1f}s, over the "
            f"{settings.media_max_audio_seconds}s limit."
        )

    wav = track.to_wav()
    artifact = get_store().put(
        kind="audio", media_type="audio/wav",
        filename=f"aetheris-{mode}.wav", data=wav,
        prompt=notation or f"{mode} {key} {scale}", metadata=detail,
    )
    return json.dumps({
        "created": "audio",
        "url": artifact.url,
        "duration_seconds": round(track.duration, 2),
        "format": "16-bit 44.1kHz mono WAV",
        "bytes": artifact.size,
        **detail,
        "note": "Instrumental synthesis — Aetheris cannot generate speech or singing.",
    }, indent=2)


# --- Code ---------------------------------------------------------------------

@register(
    "write_and_verify_code",
    (
        "Write Python to a file and RUN it in the sandbox to prove it works, "
        "returning the output plus a diagnosis if it fails. Use this whenever you "
        "present code that should actually run — verifying beats asserting. On "
        "failure you get a specific diagnosis so you can fix and re-verify."
    ),
    {
        "type": "object",
        "properties": {
            "code": {"type": "string", "description": "Complete, self-contained source. Print results."},
            "language": {"type": "string", "description": "Language (only 'python' is executable)."},
            "stdin": {"type": "string", "description": "Optional standard input."},
        },
        "required": ["code"],
    },
    requires_optin=True,
    optin_setting="sandbox_enabled",
    tags=("creation", "code", "execution"),
)
async def write_and_verify_code(code: str, language: str = "python", stdin: str = "") -> str:
    """Generate-then-execute: run the code and report a structured verdict."""
    from ..media.code import write_and_verify

    if not code or not code.strip():
        raise ToolError("No code was provided.")
    result = await write_and_verify(code, language, stdin)
    return result.render()


@register(
    "create_project",
    (
        "Scaffold a complete, runnable multi-file project and return a URL to a ZIP "
        "archive. Kinds: 'fastapi-service' (API with routes, models, and tests), "
        "'python-package' (installable library with pyproject and tests), "
        "'cli-tool' (argparse command with an entry point), or 'static-site' "
        "(HTML/CSS/JS). Every scaffold includes a README, tests, and .gitignore."
    ),
    {
        "type": "object",
        "properties": {
            "kind": {
                "type": "string",
                "enum": ["fastapi-service", "python-package", "cli-tool", "static-site"],
                "description": "The project type to scaffold.",
            },
            "name": {"type": "string", "description": "Project name, e.g. 'invoice-api'."},
            "description": {"type": "string", "description": "One-line description for the README."},
        },
        "required": ["kind", "name"],
    },
    requires_optin=True,
    optin_setting="code_generation_enabled",
    tags=("creation", "code", "scaffold"),
)
async def create_project(kind: str, name: str, description: str = "") -> str:
    """Build a project scaffold and return its ZIP artifact URL."""
    _require("code_generation_enabled", "Project scaffolding")
    from ..media.code import scaffold_project

    try:
        project = scaffold_project(kind, name, description)
    except ValueError as exc:
        raise ToolError(str(exc)) from exc

    archive = project.to_zip()
    artifact = get_store().put(
        kind="code", media_type="application/zip",
        filename=f"{project.name}.zip", data=archive,
        prompt=f"{kind}: {name}", metadata=project.summary(),
    )
    return json.dumps({
        "created": "project",
        "url": artifact.url,
        "name": project.name,
        "kind": project.kind,
        "files": sorted(project.files),
        "tree": project.tree(),
        "bytes": artifact.size,
    }, indent=2)


@register(
    "list_artifacts",
    (
        "List the images, videos, audio, and projects generated in this session, "
        "with their URLs. Use it to re-share something you created earlier."
    ),
    {
        "type": "object",
        "properties": {
            "kind": {
                "type": "string",
                "enum": ["image", "video", "audio", "code"],
                "description": "Optional filter by artifact kind.",
            }
        },
    },
    tags=("creation",),
)
async def list_artifacts(kind: str | None = None) -> str:
    """Enumerate generated artifacts."""
    items = get_store().list(kind)
    if not items:
        return "No artifacts have been generated in this session yet."
    return json.dumps(
        {"count": len(items), "artifacts": [a.summary() for a in items[:40]]}, indent=2
    )


__all__ = [
    "generate_image",
    "generate_video",
    "generate_audio",
    "write_and_verify_code",
    "create_project",
    "list_artifacts",
]
