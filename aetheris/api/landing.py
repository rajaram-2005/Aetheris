"""Render the public Aetheris product experience.

The landing page is intentionally framework-free: FastAPI serves one small HTML
shell and the browser progressively enhances it with the live API playground,
health state, code samples, and navigation interactions. Product data remains
owned by the Python registries, then gets safely interpolated into the template.
"""

from __future__ import annotations

from html import escape
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import RedirectResponse

from .. import __version__
from ..core import branding as b
from ..core.config import settings
from ..core.modes import available_modes
from ..core.spec import get_spec
from ..core.tiers import TIERS

router = APIRouter()
_TEMPLATE = (Path(__file__).with_name("landing.html")).read_text(encoding="utf-8")


_ICONS = {
    "spark": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.35 4.15a5.5 5.5 0 0 0 3.5 3.5L21 12l-4.15 1.35a5.5 5.5 0 0 0-3.5 3.5L12 21l-1.35-4.15a5.5 5.5 0 0 0-3.5-3.5L3 12l4.15-1.35a5.5 5.5 0 0 0 3.5-3.5L12 3Z"/></svg>',
    "bolt": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h8l-1 8 9-12h-8l1-8Z"/></svg>',
    "code": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/></svg>',
    "pen": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M13 7l4 4M4 20l2.5-6.5L16 4a2.12 2.12 0 0 1 3 3l-9.5 9.5L4 20Z"/></svg>',
    "braces": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/></svg>',
    "layers": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 17l9 5 9-5"/></svg>',
    "brain": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 4.5A3 3 0 0 0 4 6v1a3 3 0 0 0-1 5.24V14a3 3 0 0 0 3 3 3 3 0 0 0 3.5 2.5V4.5ZM14.5 4.5A3 3 0 0 1 20 6v1a3 3 0 0 1 1 5.24V14a3 3 0 0 1-3 3 3 3 0 0 1-3.5 2.5V4.5ZM9.5 9H7M14.5 9H17M9.5 14H6M14.5 14H18"/></svg>',
    "shield": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.65 3.2 8.35 7.5 9.5 4.3-1.15 7.5-4.85 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/></svg>',
}


def _esc(value: object) -> str:
    """Escape any value before placing it in HTML."""
    return escape(str(value), quote=True)


def _icon(name: str) -> str:
    return _ICONS.get(name, _ICONS["spark"])


def _tier_cards() -> str:
    symbols = {"flash": "bolt", "pro": "layers", "ultra": "brain"}
    max_context = max(t.context_window for t in TIERS)
    cards: list[str] = []
    for index, tier in enumerate(TIERS, start=1):
        context_label = f"{tier.context_window // 1024}K"
        output_label = f"{tier.max_output_tokens // 1024}K"
        width = max(18, round(tier.context_window / max_context * 100))
        featured = " is-featured" if tier.alias == "pro" else ""
        reasoning = "Extended reasoning" if tier.reasoning else "Direct inference"
        cards.append(
            f"""
            <article class="tier-card{featured}" data-reveal>
              <div class="tier-card__top">
                <span class="index">0{index}</span>
                <span class="tier-icon">{_icon(symbols.get(tier.alias, 'spark'))}</span>
                {'<span class="recommended">Recommended</span>' if tier.alias == 'pro' else ''}
              </div>
              <div class="tier-card__name">
                <div><span>Aetheris</span><h3>{_esc(tier.display_name.removeprefix('Aetheris '))}</h3></div>
                <code>{_esc(tier.alias)}</code>
              </div>
              <p>{_esc(tier.tagline)}</p>
              <div class="context-meter" aria-label="{context_label} token context window">
                <span style="--meter:{width}%"></span>
              </div>
              <dl>
                <div><dt>Context</dt><dd>{context_label}</dd></div>
                <div><dt>Max output</dt><dd>{output_label}</dd></div>
                <div><dt>Response</dt><dd>{_esc(tier.latency_class.title())}</dd></div>
                <div><dt>Inference</dt><dd>{reasoning}</dd></div>
              </dl>
              <button class="text-action choose-model" type="button" data-model="{_esc(tier.id)}">
                Try this model <span aria-hidden="true">↗</span>
              </button>
            </article>
            """
        )
    return "\n".join(cards)


def _mode_cards() -> str:
    icon_names = {
        "general": "spark",
        "engineering": "code",
        "editorial": "pen",
        "structured": "braces",
        "sovereign": "shield",
    }
    labels = {
        "general": "Think",
        "engineering": "Build",
        "editorial": "Refine",
        "structured": "Structure",
        "sovereign": "Unrestricted",
    }
    cards: list[str] = []
    for mode in available_modes():
        cards.append(
            f"""
            <button class="mode-card" type="button" data-mode-jump="{_esc(mode.id)}" data-reveal>
              <span class="mode-card__icon">{_icon(icon_names.get(mode.id, 'spark'))}</span>
              <span class="mode-card__content">
                <span class="eyebrow">{_esc(labels.get(mode.id, mode.id))}</span>
                <strong>{_esc(mode.display_name.split(' (')[0])}</strong>
                <span>{_esc(mode.description)}</span>
              </span>
              <span class="mode-card__arrow" aria-hidden="true">↗</span>
            </button>
            """
        )
    return "\n".join(cards)


def _playground_modes() -> str:
    return "\n".join(
        f'<button class="segment{" active" if mode.id == "general" else ""}" '
        f'type="button" role="radio" aria-checked="{"true" if mode.id == "general" else "false"}" '
        f'data-mode="{_esc(mode.id)}">{_esc(mode.id.title())}</button>'
        for mode in available_modes()
    )


def _playground_models() -> str:
    return "\n".join(
        f'<option value="{_esc(tier.id)}"{" selected" if tier.alias == "pro" else ""}>'
        f'{_esc(tier.display_name)}</option>'
        for tier in TIERS
    )


def _capability_cards() -> str:
    icon_names = ("layers", "spark", "brain", "code")
    labels = ("01 / Context", "02 / Multimodal", "03 / Agency", "04 / Precision")
    classes = ("wide", "", "", "wide")
    return "\n".join(
        f"""
        <article class="cap-card {classes[index]}" data-reveal>
          <div class="cap-card__icon">{_icon(icon_names[index])}</div>
          <span class="eyebrow">{labels[index]}</span>
          <h3>{_esc(capability['name'])}</h3>
          <p>{_esc(capability['description'])}</p>
        </article>
        """
        for index, capability in enumerate(b.CAPABILITIES)
    )


def _architecture_content() -> tuple[str, str, str]:
    architecture = get_spec().architecture
    modalities = (
        ("Text", architecture.modalities.text),
        ("Code", architecture.modalities.code),
        ("Structured data", architecture.modalities.structured_data),
        ("UI schematics", architecture.modalities.ui_schematics),
        ("Image", architecture.modalities.image),
        ("Logic diagrams", architecture.modalities.logical_diagrams),
    )
    modality_html = "\n".join(
        f'<span class="modality {"active" if enabled else "inactive"}">'
        f'<span></span>{_esc(name)}</span>'
        for name, enabled in modalities
    )
    optimization_html = "\n".join(
        f'<li><span>{index:02d}</span>{_esc(item)}</li>'
        for index, item in enumerate(architecture.optimizations, start=1)
    )
    contexts_html = "\n".join(
        f'<div><dt>{_esc(name.removeprefix("aetheris-").title())}</dt>'
        f'<dd>{value // 1024}K</dd></div>'
        for name, value in architecture.context_windows.items()
    )
    return modality_html, optimization_html, contexts_html


def _training_stages() -> str:
    stages = get_spec().training.stages
    return "\n".join(
        f"""
        <li class="training-stage" data-reveal>
          <span class="training-stage__line" aria-hidden="true"></span>
          <span class="training-stage__number">{index:02d}</span>
          <div>
            <span class="eyebrow">{_esc(stage.phase)} · {_esc(stage.evidence)}</span>
            <h3>{_esc(stage.name)}</h3>
            <p>{_esc(stage.objective)}</p>
          </div>
          <span class="stage-status {'verified' if stage.evidence == 'blueprint' else ''}">
            {_esc(stage.evidence)}
          </span>
        </li>
        """
        for index, stage in enumerate(stages, start=1)
    )


def _gallery_showcase() -> str:
    images = [
        {
            "url": "/images/hero-neural-core.png",
            "title": "Sovereign Neural Core v4.0",
            "tagline": "Quantum Synaptic Crystal Lattice",
            "badge": "Core Architecture",
            "prompt": "A breathtaking ultra-high-definition 8k futuristic neural quantum AI core, glowing cybernetic crystal lattice with intricate luminous synaptic connections, neon cyan, electric teal, and deep cosmic indigo filaments pulsing with energy.",
        },
        {
            "url": "/images/multi-agent-nexus.png",
            "title": "Multi-Agent MoE Holographic Matrix",
            "tagline": "Decentralized Swarm Orchestration",
            "badge": "Agent Swarm",
            "prompt": "An extraordinary isometric 3D visualization of an autonomous multi-agent AI neural orchestrator, glowing holographic floating interface nodes, futuristic cybernetic data streams, iridescent purple and electric mint lasers connecting floating cognitive modules.",
        },
        {
            "url": "/images/neural-canvas-synthesis.png",
            "title": "Neural Canvas & Multimodal Synthesis",
            "tagline": "High-Dimensional Generative Flow",
            "badge": "Generative Media",
            "prompt": "A mind-blowing surreal generative AI visual synthesis art piece, iridescent liquid chrome and glowing neon particles morphing into futuristic digital geometry, vibrant teal, magenta and gold lighting.",
        },
        {
            "url": "/images/deep-reasoning-matrix.png",
            "title": "Aetheris Omni Deep Reasoning Matrix",
            "tagline": "Recursive Mathematical Proof Engine",
            "badge": "Reasoning Core",
            "prompt": "A stunning futuristic quantum reasoning matrix, glowing mathematical geometric mandalas and synaptic decision trees floating in dark space, electric blue and neon gold highlights.",
        },
        {
            "url": "/images/sovereign-shield-privacy.png",
            "title": "Cryptographic Sovereign Shield",
            "tagline": "Air-Gapped Private Intelligence",
            "badge": "Zero Cloud",
            "prompt": "A hyper-detailed futuristic cybernetic sovereign privacy shield, glowing cryptographic geometric rings, holographic data lock, neon mint and midnight indigo refraction.",
        },
        {
            "url": "/images/aetheris-banner.png",
            "title": "Aetheris Cosmic Intelligence Matrix",
            "tagline": "Infinite Knowledge · Refined Synthesis",
            "badge": "Neural Horizon",
            "prompt": "Cinematic wide cyberpunk banner of Aetheris sovereign intelligence matrix, glowing neural networks spreading across a dark cosmic horizon, neon teal and deep violet light trails.",
        },
    ]
    cards = []
    for img in images:
        cards.append(f"""
        <div class="gallery-card" data-reveal>
          <div class="gallery-card__image">
            <img src="{_esc(img['url'])}" alt="{_esc(img['title'])}" loading="lazy" />
            <span class="gallery-card__badge">{_esc(img['badge'])}</span>
          </div>
          <div class="gallery-card__body">
            <h3>{_esc(img['title'])}</h3>
            <p class="tagline">{_esc(img['tagline'])}</p>
            <p class="prompt">{_esc(img['prompt'])}</p>
          </div>
        </div>
        """)
    return "\n".join(cards)


def _research_evolution_showcase() -> str:
    from ..core.research_hub import RESEARCH_REGISTRY, ERAS_METADATA
    
    era_cards = []
    for era_id, meta in ERAS_METADATA.items():
        era_feats = [f for f in RESEARCH_REGISTRY.values() if f.era == era_id]
        highlights = ", ".join(f.name.split()[0] for f in era_feats[:4])
        era_cards.append(f"""
        <div class="cap-card" data-reveal>
          <div class="cap-card__icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14"/></svg>
          </div>
          <span class="eyebrow">{_esc(meta['time_span'])} · {len(era_feats)} Milestones</span>
          <h3>{_esc(meta['title'])}</h3>
          <p>{_esc(meta['paradigm'])}</p>
          <div style="margin-top: 0.75rem; font-family: monospace; font-size: 0.75rem; color: var(--teal);">
            Highlights: {_esc(highlights)}...
          </div>
        </div>
        """)
    return "\n".join(era_cards)


def _render() -> str:
    modality_html, optimization_html, contexts_html = _architecture_content()
    replacements = {
        "@@VERSION@@": _esc(__version__),
        "@@TITLE@@": _esc(f"{b.NAME} — Intelligence, refined"),
        "@@DESCRIPTION@@": _esc(b.ONE_LINER),
        "@@INDIGO@@": b.COLOR_COSMIC_INDIGO,
        "@@TEAL@@": b.COLOR_ELECTRIC_TEAL,
        "@@WHITE@@": b.COLOR_CRISP_WHITE,
        "@@TIER_CARDS@@": _tier_cards(),
        "@@MODE_CARDS@@": _mode_cards(),
        "@@PLAYGROUND_MODES@@": _playground_modes(),
        "@@PLAYGROUND_MODELS@@": _playground_models(),
        "@@CAPABILITY_CARDS@@": _capability_cards(),
        "@@RESEARCH_EVOLUTION_CARDS@@": _research_evolution_showcase(),
        "@@GALLERY_SHOWCASE@@": _gallery_showcase(),
        "@@MODALITIES@@": modality_html,
        "@@OPTIMIZATIONS@@": optimization_html,
        "@@CONTEXTS@@": contexts_html,
        "@@TRAINING_STAGES@@": _training_stages(),
        "@@FOUNDATION@@": _esc(get_spec().training.foundation),
    }
    html = _TEMPLATE
    for token, value in replacements.items():
        html = html.replace(token, value)
    return html


@router.get("/landing", include_in_schema=False)
async def landing() -> RedirectResponse:
    """Redirect the legacy landing route to the unified application.

    The marketing/architecture content now lives inside the web app as its
    *Home* view (served at ``/``), so ``/landing`` is kept only as a
    compatibility alias that forwards to the single application surface.
    """
    return RedirectResponse(url="/", status_code=307)


def render_landing() -> str:
    """Render the legacy landing page for reuse as the ``/`` fallback.

    Only shown when the web UI has not been built yet — a graceful degradation
    so the service is never broken by a missing build artifact.
    """
    return _render()


__all__ = ["router", "render_landing"]
