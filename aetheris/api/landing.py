"""A self-contained branded landing page for the Aetheris service root.

The HTML is generated from the brand-identity constants in ``core.branding`` so
the live preview always reflects the canonical copy, palette, tiers, and modes.
No external assets are required — CSS and a small inline script are embedded.
"""

from __future__ import annotations

from html import escape

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from .. import __version__
from ..core import branding as b
from ..core.modes import MODES
from ..core.spec import get_spec
from ..core.tiers import TIERS

router = APIRouter()


def _esc(text: str) -> str:
    """HTML-escape brand copy for safe interpolation."""
    return escape(text)


@router.get("/", include_in_schema=False)
async def landing() -> HTMLResponse:
    """Render the Aetheris landing page."""
    indigo = b.COLOR_COSMIC_INDIGO
    teal = b.COLOR_ELECTRIC_TEAL
    white = b.COLOR_CRISP_WHITE

    tier_cards = "\n".join(
        f"""
        <article class="card tier {'featured' if t.alias == 'pro' else ''}">
          <div class="tier-head">
            <h3>{_esc(t.display_name)}</h3>
            <span class="badge">{_esc(t.alias)}</span>
          </div>
          <p class="tagline">{_esc(t.tagline)}</p>
          <p class="desc">{_esc(t.description)}</p>
          <ul class="meta">
            <li><span>Context</span><b>{t.context_window:,} tokens</b></li>
            <li><span>Max output</span><b>{t.max_output_tokens:,} tokens</b></li>
            <li><span>Latency</span><b>{_esc(t.latency_class)}</b></li>
            <li><span>Reasoning</span><b>{'yes' if t.reasoning else '—'}</b></li>
          </ul>
          <code class="model-id">{_esc(t.id)}</code>
        </article>
        """
        for t in TIERS
    )

    mode_cards = "\n".join(
        f"""
        <article class="card mode">
          <h3>{_esc(m.display_name)}</h3>
          <code class="mode-id">{_esc(m.id)}</code>
          <p>{_esc(m.description)}</p>
        </article>
        """
        for m in MODES
    )

    capability_items = "\n".join(
        f"<li><strong>{_esc(c['name'])}</strong><span>{_esc(c['description'])}</span></li>"
        for c in b.CAPABILITIES
    )

    audience_items = "\n".join(
        f"<li><strong>{_esc(a['audience'])}</strong><span>{_esc(a['positioning'])}</span></li>"
        for a in b.AUDIENCES
    )

    # Tagline pills for the hero.
    tagline_pills = "\n".join(
        f'<span class="pill">{_esc(t)}</span>' for t in b.TAGLINES
    )

    # Architecture & training spec (data-driven from core.spec).
    spec = get_spec()
    arch = spec.architecture
    tx = arch.transformer

    modality_labels = [
        ("Text", arch.modalities.text),
        ("Code", arch.modalities.code),
        ("Structured data", arch.modalities.structured_data),
        ("UI schematics", arch.modalities.ui_schematics),
        ("Image", arch.modalities.image),
        ("Logical diagrams", arch.modalities.logical_diagrams),
    ]
    modality_chips = " ".join(
        f'<span class="chip {"on" if on else "off"}">{_esc(label)}</span>'
        for label, on in modality_labels
    )

    tx_rows: list[tuple[str, object]] = [
        ("Architecture", tx.architecture),
        ("Layers", tx.num_layers),
        ("Hidden size", tx.hidden_size),
        ("Attention heads", tx.num_attention_heads),
        ("KV heads", tx.num_key_value_heads),
        ("Intermediate size", tx.intermediate_size),
        ("Vocab size", tx.vocab_size),
        ("Max positions", tx.max_position_embeddings),
        ("RoPE theta", tx.rope_theta),
        ("Activation", tx.activation),
        ("Normalization", tx.normalization),
        ("Tied embeddings", tx.tie_word_embeddings),
        ("Attention impl.", tx.attention_implementation),
    ]
    tx_rows_html = "\n".join(
        f"<li><span>{_esc(label)}</span><b>{'—' if val is None else _esc(str(val))}</b></li>"
        for label, val in tx_rows
    )

    def _ev_badge(evidence: str) -> str:
        cls = {"blueprint": "ev", "scaffold": "ev ev-scaffold", "pending": "ev ev-pending"}.get(
            evidence, "ev ev-pending"
        )
        return f'<span class="{cls}">{_esc(evidence)}</span>'

    arch_evidence = _ev_badge(arch.evidence.get("architecture_type", "blueprint"))
    tx_evidence = _ev_badge(tx.evidence)

    optimizations_html = "".join(
        f'<span class="pill">{_esc(o)}</span>' for o in arch.optimizations
    )
    fidelity_html = "".join(
        f'<span class="pill">{_esc(d)}</span>' for d in arch.output_fidelity_domains
    )

    # Training pipeline stages.
    stage_rows = "\n".join(
        f"""
        <li class="stage">
          <div class="stage-head">
            <span class="phase">{_esc(s.phase)}</span>
            <strong>{_esc(s.name)}</strong>
            {_ev_badge(s.evidence)}
          </div>
          <p class="stage-obj">{_esc(s.objective)}</p>
          {f'<p class="stage-notes">{_esc(s.notes)}</p>' if s.notes else ''}
        </li>
        """
        for s in spec.training.stages
    )
    alignment_html = "".join(
        f'<span class="pill">{_esc(m)}</span>' for m in spec.training.alignment_methods
    )
    meta_learning_html = "".join(
        f'<span class="pill">{_esc(m)}</span>' for m in spec.training.meta_learning_methods
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aetheris — {_esc(b.tagline())}</title>
<meta name="description" content="{_esc(b.ONE_LINER)}">
<style>
  :root {{
    --indigo: {indigo};
    --indigo-2: #1b2547;
    --teal: {teal};
    --white: {white};
    --muted: #9fb0d0;
    --radius: 16px;
  }}
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; padding: 0; }}
  body {{
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--white);
    background:
      radial-gradient(1200px 600px at 80% -10%, rgba(0,180,216,0.18), transparent 60%),
      radial-gradient(900px 500px at 0% 10%, rgba(11,19,43,0.9), transparent 55%),
      linear-gradient(180deg, #060a18 0%, var(--indigo) 100%);
    line-height: 1.6;
  }}
  a {{ color: var(--teal); text-decoration: none; }}
  .wrap {{ max-width: 1080px; margin: 0 auto; padding: 0 24px; }}

  /* Hero */
  header.hero {{ padding: 72px 0 40px; text-align: center; }}
  .logo {{ display: inline-flex; align-items: center; gap: 14px; font-weight: 800; letter-spacing: 0.5px; }}
  .logo .mark {{
    width: 42px; height: 42px; border-radius: 12px;
    background: linear-gradient(135deg, var(--teal), #7cf0ff);
    box-shadow: 0 0 24px rgba(0,180,216,0.45);
    display: grid; place-items: center; color: var(--indigo); font-size: 22px;
  }}
  .logo .name {{ font-size: 26px; }}
  h1 {{
    font-size: clamp(34px, 6vw, 60px); margin: 28px 0 14px; font-weight: 800;
    letter-spacing: -0.02em; line-height: 1.1;
    background: linear-gradient(120deg, #ffffff, #bfeaff 60%, var(--teal));
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  }}
  .lede {{ max-width: 720px; margin: 0 auto; color: var(--muted); font-size: 18px; }}
  .taglines {{ display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 22px; }}
  .pill {{
    border: 1px solid rgba(0,180,216,0.35); color: #cdeeff;
    padding: 6px 14px; border-radius: 999px; font-size: 13px; background: rgba(0,180,216,0.06);
  }}
  .cta {{ margin-top: 30px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }}
  .btn {{ padding: 12px 20px; border-radius: 10px; font-weight: 600; font-size: 15px; border: 1px solid transparent; }}
  .btn.primary {{ background: var(--teal); color: var(--indigo); }}
  .btn.ghost {{ border-color: rgba(159,176,208,0.4); color: var(--white); background: transparent; }}

  section {{ padding: 56px 0; border-top: 1px solid rgba(159,176,208,0.12); }}
  h2 {{ font-size: 28px; margin: 0 0 8px; }}
  .section-sub {{ color: var(--muted); margin: 0 0 28px; max-width: 640px; }}

  .grid {{ display: grid; gap: 18px; }}
  .grid.tiers {{ grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }}
  .grid.modes {{ grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }}
  .card {{
    background: linear-gradient(180deg, rgba(27,37,71,0.85), rgba(11,19,43,0.85));
    border: 1px solid rgba(159,176,208,0.16);
    border-radius: var(--radius); padding: 22px;
  }}
  .card.featured {{ border-color: rgba(0,180,216,0.5); box-shadow: 0 0 0 1px rgba(0,180,216,0.25), 0 10px 40px rgba(0,180,216,0.08); }}
  .card h3 {{ margin: 0 0 6px; font-size: 20px; }}
  .tier-head {{ display: flex; align-items: center; justify-content: space-between; }}
  .badge {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--teal); border:1px solid rgba(0,180,216,0.4); padding:3px 8px; border-radius:999px; }}
  .tagline {{ color: #cfe6ff; margin: 0 0 10px; font-weight: 600; }}
  .desc {{ color: var(--muted); margin: 0 0 14px; font-size: 14px; }}
  .meta {{ list-style: none; padding: 0; margin: 0 0 14px; display: grid; gap: 6px; font-size: 13px; }}
  .meta li {{ display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(159,176,208,0.18); padding-bottom: 6px; }}
  .meta span {{ color: var(--muted); }}
  .meta b {{ color: var(--white); font-weight: 600; }}
  code, .model-id, .mode-id {{
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px; color: #9fe9ff; background: rgba(0,0,0,0.25); padding: 4px 8px; border-radius: 8px;
  }}
  .model-id {{ display: inline-block; }}
  .mode-id {{ display: inline-block; margin-bottom: 10px; }}

  .two-col {{ display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }}
  @media (max-width: 760px) {{ .two-col {{ grid-template-columns: 1fr; }} }}
  ul.fancy {{ list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; }}
  ul.fancy li {{ display: grid; gap: 2px; }}
  ul.fancy strong {{ color: var(--white); }}
  ul.fancy span {{ color: var(--muted); font-size: 14px; }}

  pre {{
    background: rgba(0,0,0,0.35); border: 1px solid rgba(159,176,208,0.16);
    border-radius: 12px; padding: 18px; overflow: auto; font-size: 13px; color: #d7e6ff;
  }}
  pre code {{ background: none; padding: 0; color: inherit; }}

  /* Spec section: evidence badges, modality chips, training stages */
  .ev {{ font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 7px; border-radius: 999px; border: 1px solid rgba(0,180,216,0.45); color: #bfeaff; background: rgba(0,180,216,0.08); white-space: nowrap; }}
  .ev-scaffold {{ border-color: rgba(255,193,77,0.5); color: #ffd98a; background: rgba(255,193,77,0.07); }}
  .ev-pending {{ border-color: rgba(159,176,208,0.4); color: var(--muted); background: rgba(159,176,208,0.06); }}
  .chips {{ display: flex; flex-wrap: wrap; gap: 8px; }}
  .chip {{ font-size: 12px; padding: 4px 10px; border-radius: 8px; border: 1px solid rgba(159,176,208,0.25); }}
  .chip.on {{ color: #cfe6ff; border-color: rgba(0,180,216,0.5); background: rgba(0,180,216,0.08); }}
  .chip.off {{ color: #5b6b8a; text-decoration: line-through; }}
  .pills {{ display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 14px; }}
  .field-label {{ font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 16px 0 4px; }}
  ul.stages {{ list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }}
  ul.stages .stage {{ background: rgba(0,0,0,0.18); border: 1px solid rgba(159,176,208,0.14); border-radius: 12px; padding: 14px 16px; }}
  ul.stages .stage-head {{ display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }}
  ul.stages .phase {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--teal); border: 1px solid rgba(0,180,216,0.35); padding: 2px 8px; border-radius: 999px; }}
  ul.stages strong {{ font-size: 15px; }}
  ul.stages .stage-obj {{ margin: 8px 0 0; color: #cfe6ff; font-size: 14px; }}
  ul.stages .stage-notes {{ margin: 6px 0 0; color: var(--muted); font-size: 13px; }}
  .legend {{ display:flex; gap:14px; flex-wrap:wrap; margin-top:18px; font-size:12px; color: var(--muted); }}
  .legend span {{ display:inline-flex; align-items:center; gap:6px; }}

  footer {{ padding: 40px 0 60px; color: var(--muted); font-size: 13px; border-top: 1px solid rgba(159,176,208,0.12); }}
  footer .row {{ display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; }}
  .status-dot {{ display:inline-block; width:8px; height:8px; border-radius:50%; background: var(--teal); box-shadow: 0 0 10px var(--teal); margin-right:8px; }}
</style>
</head>
<body>
  <header class="hero">
    <div class="wrap">
      <div class="logo"><span class="mark">Æ</span><span class="name">Aetheris</span></div>
      <h1>Where Raw Intellect Meets Human Intuition</h1>
      <p class="lede">{_esc(b.ONE_LINER)}</p>
      <div class="taglines">{tagline_pills}</div>
      <div class="cta">
        <a class="btn primary" href="/docs">Open API docs</a>
        <a class="btn ghost" href="/v1/models">View models</a>
      </div>
    </div>
  </header>

  <section>
    <div class="wrap">
      <h2>Model tiers</h2>
      <p class="section-sub">A three-tier product family tuned for different compute and latency needs — from instant chat to extended reasoning workflows.</p>
      <div class="grid tiers">{tier_cards}</div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <h2>Inference modes</h2>
      <p class="section-sub">Each mode activates the official Aetheris identity via a production system prompt. Set <code>mode</code> on any chat request.</p>
      <div class="grid modes">{mode_cards}</div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <h2>Architecture <span class="ev" style="vertical-align:middle;margin-left:8px">blueprint-sourced</span></h2>
      <p class="section-sub">A decoder-only multimodal transformer optimized for long-context comprehension, structured code execution, and autonomous tool usage. {arch_evidence}</p>
      <div class="two-col">
        <div>
          <p class="field-label">Optimizations</p>
          <div class="pills">{optimizations_html}</div>
          <p class="field-label">Output fidelity domains</p>
          <div class="pills">{fidelity_html}</div>
          <p class="field-label">Native modalities</p>
          <div class="chips">{modality_chips}</div>
          <p class="field-label">Alignment</p>
          <div class="pills"><span class="pill">{_esc(arch.alignment)}</span></div>
          <p class="field-label">Context windows (per tier)</p>
          <ul class="meta">
            {''.join(f'<li><span>{_esc(k)}</span><b>{v:,} tokens</b></li>' for k, v in arch.context_windows.items())}
          </ul>
        </div>
        <div>
          <p class="field-label">Transformer configuration {tx_evidence}</p>
          <ul class="meta">{tx_rows_html}</ul>
          <p class="stage-notes" style="margin-top:10px">{_esc(tx.note)}</p>
        </div>
      </div>
      <div class="legend">
        <span><span class="ev">blueprint</span> from the identity blueprint</span>
        <span><span class="ev ev-scaffold">scaffold</span> structured placeholder</span>
        <span><span class="ev ev-pending">pending</span> awaiting Hermes blueprint</span>
      </div>
      <p class="section-sub" style="margin-top:18px"><a href="/v1/architecture">GET /v1/architecture</a> · <a href="/v1/spec">GET /v1/spec</a></p>
    </div>
  </section>

  <section>
    <div class="wrap">
      <h2>Training pipeline — {_esc(spec.training.foundation)}</h2>
      <p class="section-sub">{_esc(spec.training.foundation_status)}</p>
      <p class="field-label">Alignment methods</p>
      <div class="pills">{alignment_html}</div>
      <p class="field-label">Meta-learning methods</p>
      <div class="pills">{meta_learning_html}</div>
      <ul class="stages">{stage_rows}</ul>
      <p class="section-sub" style="margin-top:18px"><a href="/v1/training">GET /v1/training</a></p>
    </div>
  </section>

  <section>
    <div class="wrap">
      <h2>Capabilities &amp; audience</h2>
      <div class="two-col">
        <div>
          <p class="section-sub" style="margin-bottom:18px">Flagship strengths engineered into every tier.</p>
          <ul class="fancy">{capability_items}</ul>
        </div>
        <div>
          <p class="section-sub" style="margin-bottom:18px">Who Aetheris is built for, and how it shows up.</p>
          <ul class="fancy">{audience_items}</ul>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <h2>Get started in one request</h2>
      <p class="section-sub">Aetheris is OpenAI-compatible. Point any existing client at <code>/v1/chat/completions</code> and add the <code>mode</code> field.</p>
      <pre><code>curl -N https://&lt;your-host&gt;/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{{
    "model": "aetheris-pro",
    "mode": "engineering",
    "stream": true,
    "messages": [
      {{ "role": "user", "content": "Design a rate limiter for a public API." }}
    ]
  }}'</code></pre>
    </div>
  </section>

  <footer>
    <div class="wrap row">
      <span><span class="status-dot"></span>Aetheris v{__version__} · <a href="/v1/health">health</a> · <a href="/v1/identity">identity</a></span>
      <span>{_esc(b.ETYMOLOGY)}</span>
    </div>
  </footer>
</body>
</html>
"""
    return HTMLResponse(content=html)


__all__ = ["router"]
