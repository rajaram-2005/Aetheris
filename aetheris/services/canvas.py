"""Ætheris NOVA — Interactive Artifact Canvas.

A Claude-Artifacts-style system: the model produces *live, editable artifacts*
(documents, SVGs, React-like mini-apps, charts, Mermaid diagrams, dashboards)
that live in a canvas separate from chat, with diff-based versioning so each
edit is reversible.

Renderers:

* **document** — Markdown-rendered prose.
* **svg** — raw SVG, rendered inline.
* **react_like** — single-file HTML/JS (like React artifacts), sandboxed via an
  iframe srcdoc.
* **chart** — a simple JSON spec (chart.js-like) rendered with a tiny built-in
  canvas renderer so it works offline.
* **mermaid** — Mermaid diagram source (the client loads Mermaid from CDN if
  online; otherwise we render a plain-text outline).
* **dashboard** — a grid of other artifacts.

Every artifact has a stable id, a version history, and a CRUD + diff API.
"""

from __future__ import annotations

import copy
import difflib
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

SUPPORTED_KINDS = {"document", "svg", "react_like", "chart", "mermaid", "dashboard"}
MAX_VERSIONS = 100
MAX_ARTIFACTS = 200


@dataclass
class ArtifactVersion:
    version: int
    content: str
    timestamp: float = field(default_factory=time.time)
    author: str = "aetheris"
    note: str = ""


@dataclass
class CanvasArtifact:
    id: str
    title: str
    kind: str
    content: str
    versions: list[ArtifactVersion] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    metadata: dict[str, Any] = field(default_factory=dict)

    def current(self) -> ArtifactVersion:
        return self.versions[-1]

    def diff(self, from_version: int | None = None, to_version: int | None = None) -> dict[str, Any]:
        frm = self.versions[max(0, (from_version or 1) - 1)]
        to = self.versions[min(len(self.versions) - 1, (to_version or len(self.versions)) - 1)]
        a = frm.content.splitlines(keepends=True)
        b = to.content.splitlines(keepends=True)
        diff = "".join(difflib.unified_diff(a, b, fromfile=f"v{frm.version}", tofile=f"v{to.version}"))
        return {"from": frm.version, "to": to.version, "unified": diff}


class Canvas:
    def __init__(self, max_artifacts: int = MAX_ARTIFACTS, max_versions: int = MAX_VERSIONS):
        self.max_artifacts = max_artifacts
        self.max_versions = max_versions
        self._artifacts: dict[str, CanvasArtifact] = {}
        self._order: list[str] = []

    def create(self, title: str, kind: str, content: str, metadata: dict | None = None, author: str = "aetheris", note: str = "") -> CanvasArtifact:
        if kind not in SUPPORTED_KINDS:
            raise ValueError(f"Unsupported artifact kind: {kind!r}. Try one of {sorted(SUPPORTED_KINDS)}.")
        if len(self._artifacts) >= self.max_artifacts:
            oldest = self._order.pop(0)
            self._artifacts.pop(oldest, None)
        aid = f"art-{uuid.uuid4().hex[:10]}"
        art = CanvasArtifact(
            id=aid,
            title=title.strip() or "Untitled",
            kind=kind,
            content=content,
            versions=[ArtifactVersion(version=1, content=content, author=author, note=note or "initial")],
            metadata=metadata or {},
        )
        self._artifacts[aid] = art
        self._order.append(aid)
        return art

    def get(self, artifact_id: str) -> CanvasArtifact:
        if artifact_id not in self._artifacts:
            raise KeyError(artifact_id)
        return self._artifacts[artifact_id]

    def update(self, artifact_id: str, content: str, *, author: str = "aetheris", note: str = "") -> CanvasArtifact:
        art = self.get(artifact_id)
        if content == art.content:
            return art
        art.content = content
        art.updated_at = time.time()
        art.versions.append(
            ArtifactVersion(version=len(art.versions) + 1, content=content, author=author, note=note)
        )
        if len(art.versions) > self.max_versions:
            art.versions.pop(0)
            for i, v in enumerate(art.versions, start=1):
                v.version = i
        return art

    def revert(self, artifact_id: str, version: int) -> CanvasArtifact:
        art = self.get(artifact_id)
        if version < 1 or version > len(art.versions):
            raise ValueError(f"version {version} out of range for artifact {artifact_id}")
        target = art.versions[version - 1]
        return self.update(artifact_id, target.content, author="system", note=f"reverted to v{version}")

    def list(self) -> list[dict]:
        return [
            {
                "id": a.id,
                "title": a.title,
                "kind": a.kind,
                "version": len(a.versions),
                "created_at": a.created_at,
                "updated_at": a.updated_at,
                "metadata": a.metadata,
            }
            for a in (self._artifacts[i] for i in self._order)
        ]

    def delete(self, artifact_id: str) -> bool:
        if artifact_id in self._artifacts:
            self._artifacts.pop(artifact_id)
            try:
                self._order.remove(artifact_id)
            except ValueError:
                pass
            return True
        return False

    def render(self, artifact_id: str) -> dict[str, Any]:
        art = self.get(artifact_id)
        return {
            "id": art.id,
            "title": art.title,
            "kind": art.kind,
            "content": art.content,
            "version": len(art.versions),
            "versions": [
                {"version": v.version, "timestamp": v.timestamp, "author": v.author, "note": v.note}
                for v in art.versions
            ],
            "created_at": art.created_at,
            "updated_at": art.updated_at,
            "metadata": art.metadata,
            "html": self._to_html(art),
        }

    def _to_html(self, art: CanvasArtifact) -> str:
        if art.kind == "svg":
            return art.content
        if art.kind == "document":
            return _markdown_to_html(art.content)
        if art.kind == "mermaid":
            return (
                f'<pre class="mermaid">{_escape(art.content)}</pre>'
                f'<noscript><pre>{_escape(art.content)}</pre></noscript>'
            )
        if art.kind == "chart":
            return _chart_html(art)
        if art.kind == "react_like":
            return (
                '<iframe style="width:100%;height:480px;border:1px solid #223;border-radius:12px" '
                'sandbox="allow-scripts" srcdoc="' + _escape(_wrap_html(art.content)) + '"></iframe>'
            )
        if art.kind == "dashboard":
            return _dashboard_html(self, art)
        return f"<pre>{_escape(art.content)}</pre>"


# --- helpers --------------------------------------------------------------

def _escape(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;").replace("'", "&#39;"))


def _wrap_html(body: str) -> str:
    if "<html" in body.lower() or "<body" in body.lower():
        return body
    return (
        "<!doctype html><html><head><meta charset=utf-8><style>"
        "body{font:14px/1.5 system-ui,sans-serif;background:#0B132B;color:#F8F9FA;padding:16px}"
        "button{background:#00B4D8;color:#0B132B;border:0;padding:8px 14px;border-radius:8px;cursor:pointer}"
        "input,select{background:#112;padding:8px;border-radius:8px;border:1px solid #234;color:#F8F9FA}"
        "</style></head><body>" + body + "</body></html>"
    )


def _markdown_to_html(md: str) -> str:
    """Tiny markdown renderer: headings, bold, italics, code, lists, links."""
    import re as _re
    out = _escape(md)
    out = _re.sub(r"```(\w+)?\n(.*?)```", lambda m: f"<pre><code>{m.group(2)}</code></pre>", out, flags=_re.S)
    out = _re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = _re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    out = _re.sub(r"\*([^*]+)\*", r"<em>\1</em>", out)
    out = _re.sub(r"^######\s+(.*)$", r"<h6>\1</h6>", out, flags=_re.M)
    out = _re.sub(r"^#####\s+(.*)$", r"<h5>\1</h5>", out, flags=_re.M)
    out = _re.sub(r"^####\s+(.*)$", r"<h4>\1</h4>", out, flags=_re.M)
    out = _re.sub(r"^###\s+(.*)$", r"<h3>\1</h3>", out, flags=_re.M)
    out = _re.sub(r"^##\s+(.*)$", r"<h2>\1</h2>", out, flags=_re.M)
    out = _re.sub(r"^#\s+(.*)$", r"<h1>\1</h1>", out, flags=_re.M)
    out = _re.sub(r"^- (.*)$", r"<li>\1</li>", out, flags=_re.M)
    out = _re.sub(r"(<li>.*</li>)", r"<ul>\1</ul>", out, flags=_re.S)
    out = _re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2" target="_blank" rel="noopener">\1</a>', out)
    out = _re.sub(r"\n\n", "</p><p>", out)
    return f"<div>{out}</div>"


def _chart_html(art: CanvasArtifact) -> str:
    try:
        spec = json.loads(art.content)
    except Exception:
        return f"<pre>{_escape(art.content)}</pre>"
    # spec: {"type":"bar"|"line"|"pie", "labels":[...], "datasets":[{"label":"","data":[...], "color":"#00B4D8"}]}
    typ = spec.get("type", "bar")
    labels = spec.get("labels", [])
    datasets = spec.get("datasets", [])
    width = 640; height = 320
    pad = 40
    svg_parts = [f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" style="width:100%;background:#0B132B">']
    if typ in ("bar", "line"):
        max_v = max((v for ds in datasets for v in ds.get("data", [])), default=1) or 1
        # axes
        svg_parts.append(f'<line x1="{pad}" y1="{height-pad}" x2="{width-pad}" y2="{height-pad}" stroke="#00B4D8" />')
        svg_parts.append(f'<line x1="{pad}" y1="{pad}" x2="{pad}" y2="{height-pad}" stroke="#00B4D8" />')
        n = max(len(labels), 1)
        bw = (width - 2*pad) / n
        for i, lb in enumerate(labels):
            x = pad + i * bw + bw/2
            svg_parts.append(f'<text x="{x}" y="{height-pad+16}" fill="#F8F9FA" font-size="10" text-anchor="middle">{_escape(str(lb))}</text>')
            for di, ds in enumerate(datasets):
                color = ds.get("color", ["#00B4D8","#F72585","#80FFDB","#FFD166"][di % 4])
                vals = ds.get("data", [])
                v = vals[i] if i < len(vals) else 0
                bh = (v / max_v) * (height - 2*pad)
                if typ == "bar":
                    bw2 = bw / max(len(datasets),1) * 0.8
                    svg_parts.append(f'<rect x="{x - bw2*(len(datasets)-di)*0.5 :.1f}" y="{height-pad-bh:.1f}" width="{bw2:.1f}" height="{bh:.1f}" fill="{color}" opacity="0.85"/>')
                else:
                    px = pad + i*bw + bw/2
                    py = height - pad - bh
                    svg_parts.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="3" fill="{color}"/>')
        if typ == "line":
            for di, ds in enumerate(datasets):
                color = ds.get("color", ["#00B4D8","#F72585","#80FFDB","#FFD166"][di % 4])
                pts = []
                for i, v in enumerate(ds.get("data", [])):
                    x = pad + i*bw + bw/2
                    y = height - pad - (v/max_v)*(height-2*pad)
                    pts.append(f"{x:.1f},{y:.1f}")
                svg_parts.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="{color}" stroke-width="2"/>')
    elif typ == "pie":
        import math
        total = sum(float(v) for ds in datasets for v in ds.get("data", [])) or 1
        cx, cy, r = width/2, height/2, min(width,height)/2 - pad
        angle = -math.pi/2
        for di, ds in enumerate(datasets):
            color = ds.get("color", ["#00B4D8","#F72585","#80FFDB","#FFD166","#7B2CBF"][di % 5])
            for i, v in enumerate(ds.get("data", [])):
                frac = float(v)/total
                a2 = angle + frac*2*math.pi
                x1 = cx + r*math.cos(angle); y1 = cy + r*math.sin(angle)
                x2 = cx + r*math.cos(a2); y2 = cy + r*math.sin(a2)
                large = 1 if frac > 0.5 else 0
                svg_parts.append(f'<path d="M{cx},{cy} L{x1:.1f},{y1:.1f} A{r:.1f},{r:.1f} 0 {large} 1 {x2:.1f},{y2:.1f} Z" fill="{color}" opacity="0.85" stroke="#0B132B"/>')
                angle = a2
    svg_parts.append("</svg>")
    # legend
    for di, ds in enumerate(datasets):
        color = ds.get("color", ["#00B4D8","#F72585","#80FFDB","#FFD166"][di % 4])
        svg_parts.append(f'<div><span style="display:inline-block;width:10px;height:10px;background:{color};border-radius:2px;margin-right:6px"></span>{_escape(ds.get("label",""))}</div>')
    return "\n".join(svg_parts)


def _dashboard_html(canvas: Canvas, art: CanvasArtifact) -> str:
    try:
        spec = json.loads(art.content)
    except Exception:
        return f"<pre>{_escape(art.content)}</pre>"
    cells = spec.get("cells", [])
    parts = ['<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">']
    for cell in cells:
        ref = cell.get("artifact_id")
        try:
            sub = canvas.get(ref)
            parts.append(f'<div style="background:#0B132B;border:1px solid #234;border-radius:12px;padding:12px"><h4 style="margin:0 0 8px;color:#00B4D8">{_escape(sub.title)}</h4>{canvas._to_html(sub)}</div>')
        except Exception:
            parts.append(f'<div style="background:#1a1a2e;border:1px dashed #555;border-radius:12px;padding:12px;color:#888">Missing artifact: {_escape(str(ref))}</div>')
    parts.append("</div>")
    return "\n".join(parts)


_canvas: Canvas | None = None


def get_canvas() -> Canvas:
    global _canvas
    if _canvas is None:
        _canvas = Canvas()
    return _canvas


__all__ = ["Canvas", "CanvasArtifact", "ArtifactVersion", "get_canvas", "SUPPORTED_KINDS"]
