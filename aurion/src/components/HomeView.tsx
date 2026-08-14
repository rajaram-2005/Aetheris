/* ─── HomeView — the unified landing experience inside the single app shell ───
 *
 * This is the marketing/architecture content that used to live on a separate
 * `/landing` HTML page with its own duplicate playground. It is now one view of
 * the application: it shares the TopNav, theme system, and chat workspace, and
 * every call-to-action funnels into the same Hermes runtime the chat uses.
 *
 * Product data (models, modes, architecture, training, research eras, gallery)
 * is fetched live from the Python registries via `/v1/*`, so there is a single
 * source of truth and no second copy of the content.
 */
"use client";

import { useEffect, useState } from 'react';
import {
  ModelId,
  ModeId,
  ModelInfo,
  ModeInfo,
  ArchitectureModel,
  TrainingPipelineModel,
  GalleryImage,
  EraSummary,
} from '@/types';
import {
  getModels,
  getModes,
  getArchitecture,
  getTraining,
  getGalleryImages,
  getResearchEras,
} from '@/lib/hermes';
import { ConstellationHero } from '@/components/ConstellationHero';
import type { StudioChamber } from '@/types';

interface HomeViewProps {
  online: boolean;
  onLaunch: () => void;
  onTryModel: (model: ModelId) => void;
  onTryMode: (mode: ModeId) => void;
  onOpenResearch: () => void;
  onOpenStudio: (chamber?: StudioChamber) => void;
  onGenerateImage: (prompt: string) => void;
  onRunPrompt: (text: string) => void;
}

/* Tier alias → the workspace's model id, so "Try this model" selects the same
 * model the chat uses. */
const TIER_TO_MODEL: Record<string, ModelId> = {
  flash: 'aetheris-flash-v2',
  pro: 'aetheris-prime-v4',
  ultra: 'aetheris-omni-reasoner',
};

const CAPABILITIES = [
  {
    icon: 'layers',
    label: '01 / Context',
    name: 'Deep Context Synthesis',
    description:
      'Processes vast context windows — documents, codebases, transcripts — and distills key insights without losing nuance.',
    wide: true,
  },
  {
    icon: 'spark',
    label: '02 / Multimodal',
    name: 'Multimodal Fluidity',
    description:
      'Native understanding of text, code, structured data, UI schematics, image input, and logical diagrams.',
    wide: false,
  },
  {
    icon: 'brain',
    label: '03 / Agency',
    name: 'Autonomous Agentic Reasoning',
    description:
      'Multi-step planning, tool selection, and self-correction before returning a final answer.',
    wide: false,
  },
  {
    icon: 'code',
    label: '04 / Precision',
    name: 'Precision Code & Logic',
    description:
      'Clean, optimized, production-ready code with error handling and inline documentation.',
    wide: true,
  },
] as const;

const CODE_SAMPLES = [
  {
    language: 'cURL',
    footer: 'POST /v1/chat/completions · OpenAI compatible',
    code: `curl -N https://your-host/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "aetheris-pro",
    "mode": "engineering",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Design a rate limiter"}
    ]
  }'`,
  },
  {
    language: 'Python',
    footer: 'openai SDK pointed at Aetheris',
    code: `from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="local",  # offline — no key needed
)

stream = client.chat.completions.create(
    model="aetheris-ultra",
    mode="structured",
    stream=True,
    messages=[{"role": "user", "content": "Sketch a schema"}],
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`,
  },
  {
    language: 'Hermes',
    footer: 'POST /v1/hermes/run · full cascade',
    code: `fetch("/v1/hermes/run", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    task: "Explain the difference between correlation and causation",
    learn: true,
    mode: "general",
  }),
})`,
  },
];

function CapIcon({ name }: { name: string }) {
  switch (name) {
    case 'layers':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 17l9 5 9-5" /></svg>
      );
    case 'spark':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.35 4.15a5.5 5.5 0 0 0 3.5 3.5L21 12l-4.15 1.35a5.5 5.5 0 0 0-3.5 3.5L12 21l-1.35-4.15a5.5 5.5 0 0 0-3.5-3.5L3 12l4.15-1.35a5.5 5.5 0 0 0 3.5-3.5L12 3Z" /></svg>
      );
    case 'brain':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 4.5A3 3 0 0 0 4 6v1a3 3 0 0 0-1 5.24V14a3 3 0 0 0 3 3 3 3 0 0 0 3.5 2.5V4.5ZM14.5 4.5A3 3 0 0 1 20 6v1a3 3 0 0 1 1 5.24V14a3 3 0 0 1-3 3 3 3 0 0 1-3.5 2.5V4.5ZM9.5 9H7M14.5 9H17M9.5 14H6M14.5 14H18" /></svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14" /></svg>
      );
  }
}

export function HomeView({
  online,
  onLaunch,
  onTryModel,
  onTryMode,
  onOpenResearch,
  onOpenStudio,
  onGenerateImage,
  onRunPrompt,
}: HomeViewProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modes, setModes] = useState<ModeInfo[]>([]);
  const [architecture, setArchitecture] = useState<ArchitectureModel | null>(null);
  const [training, setTraining] = useState<TrainingPipelineModel | null>(null);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [eras, setEras] = useState<EraSummary[]>([]);

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      getModels(),
      getModes(),
      getArchitecture(),
      getTraining(),
      getGalleryImages(),
      getResearchEras(),
    ]).then((results) => {
      if (cancelled) return;
      const [mModels, mModes, mArch, mTrain, mGallery, mEras] = results;
      if (mModels.status === 'fulfilled') setModels(mModels.value.data);
      if (mModes.status === 'fulfilled') setModes(mModes.value.data);
      if (mArch.status === 'fulfilled') setArchitecture(mArch.value);
      if (mTrain.status === 'fulfilled') setTraining(mTrain.value);
      if (mGallery.status === 'fulfilled') setGallery(mGallery.value.images);
      if (mEras.status === 'fulfilled') setEras(mEras.value.eras);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-primary)' }}>
      <ConstellationHero
        online={online}
        onLaunch={onLaunch}
        onOpenStudio={onOpenStudio}
        onRunPrompt={onRunPrompt}
      />

      {/* Capabilities */}
      <Section id="capabilities" kicker="What it does" title={<>Engineered for <Gradient>clarity.</Gradient></>}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {CAPABILITIES.map((cap) => (
            <article
              key={cap.name}
              className={`rounded-2xl p-6 border transition-colors ${cap.wide ? 'md:col-span-1' : ''}`}
              style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--accent-mint)' }}
              >
                <span className="w-5 h-5 [&>svg]:w-full [&>svg]:h-full [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:stroke-[1.5]">
                  <CapIcon name={cap.icon} />
                </span>
              </div>
              <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {cap.label}
              </span>
              <h3 className="mt-2 text-base font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                {cap.name}
              </h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {cap.description}
              </p>
            </article>
          ))}
        </div>
      </Section>

      {/* Models */}
      <Section id="models" kicker="Model tiers" title={<>One family, <Gradient>three gears.</Gradient></>}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {models.length === 0
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-2xl border p-6 h-56 animate-pulse" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} />
              ))
            : models.map((tier, index) => {
                const featured = tier.alias === 'pro';
                return (
                  <article
                    key={tier.id}
                    className="rounded-2xl border p-6 flex flex-col"
                    style={{
                      background: 'var(--bg-secondary)',
                      borderColor: featured ? 'var(--border-hover)' : 'var(--border-color)',
                      boxShadow: featured ? '0 0 40px var(--shadow-glow)' : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        0{index + 1}
                      </span>
                      {featured && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(52,211,153,0.12)', color: 'var(--accent-mint)' }}
                        >
                          Recommended
                        </span>
                      )}
                    </div>
                    <h3 className="mt-3 text-lg font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                      {tier.display_name}
                    </h3>
                    <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {tier.alias}
                    </p>
                    <p className="mt-3 text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>
                      {tier.tagline}
                    </p>
                    <dl className="mt-5 grid grid-cols-2 gap-2 text-xs">
                      <Stat label="Context" value={`${(tier.context_window / 1024).toFixed(0)}K`} />
                      <Stat label="Output" value={`${(tier.max_output_tokens / 1024).toFixed(0)}K`} />
                      <Stat label="Latency" value={tier.latency_class} />
                      <Stat label="Inference" value={tier.reasoning ? 'Reasoning' : 'Direct'} />
                    </dl>
                    <button
                      onClick={() => onTryModel(TIER_TO_MODEL[tier.alias] || 'aetheris-prime-v4')}
                      className="btn btn-primary w-full justify-center mt-5"
                    >
                      Try this model ↗
                    </button>
                  </article>
                );
              })}
        </div>
      </Section>

      {/* Modes */}
      <Section id="modes" kicker="Inference modes" title={<>One engine, <Gradient>many voices.</Gradient></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {modes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => onTryMode(mode.id as ModeId)}
              className="flex items-start gap-3 text-left rounded-xl border p-4 transition-colors hover:border-cyan-400/50"
              style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
            >
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)' }}>
                  {mode.family}
                </span>
                <strong className="block mt-1 text-sm" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                  {mode.display_name.split(' (')[0]}
                </strong>
                <span className="block mt-1 text-xs leading-snug" style={{ color: 'var(--text-secondary)' }}>
                  {mode.description}
                </span>
              </div>
              <span className="text-sm shrink-0" style={{ color: 'var(--text-muted)' }}>↗</span>
            </button>
          ))}
        </div>
      </Section>

      {/* Visual Studio / Gallery */}
      <Section id="gallery" kicker="Visual studio" title={<>A gallery that <Gradient>generates itself.</Gradient></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {gallery.slice(0, 6).map((img) => (
            <article key={img.id} className="rounded-2xl overflow-hidden border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
              <div className="aspect-[4/3] overflow-hidden bg-black/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.title} loading="lazy" className="w-full h-full object-cover" />
              </div>
              <div className="p-4">
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-purple)', fontFamily: 'var(--font-mono)' }}>
                  {img.category}
                </span>
                <h3 className="mt-1 text-sm font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                  {img.title}
                </h3>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{img.tagline}</p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => onGenerateImage(img.prompt)}
                    className="btn btn-primary flex-1 justify-center text-xs py-2"
                  >
                    Generate this
                  </button>
                  <button
                    onClick={() => onOpenStudio('visuals')}
                    className="btn text-xs py-2"
                    title="Open visuals in the unified studio"
                  >
                    Studio
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </Section>

      {/* Architecture */}
      {architecture && (
        <Section id="architecture" kicker="Architecture" title={<>How it <Gradient>thinks.</Gradient></>}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border p-6" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                {architecture.name}
              </h3>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {architecture.architecture_type}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(architecture.modalities)
                  .filter(([k]) => k !== 'evidence')
                  .map(([key, enabled]) => (
                    <span
                      key={key}
                      className="text-[11px] px-2.5 py-1 rounded-full font-medium"
                      style={{
                        background: enabled ? 'rgba(52,211,153,0.1)' : 'var(--bg-tertiary)',
                        color: enabled ? 'var(--accent-mint)' : 'var(--text-muted)',
                        border: `1px solid ${enabled ? 'rgba(52,211,153,0.25)' : 'var(--border-color)'}`,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {key.replace(/_/g, ' ')}
                    </span>
                  ))}
              </div>
              <p className="mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {architecture.alignment}
              </p>
            </div>

            <div className="rounded-2xl border p-6" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                Optimizations
              </h3>
              <ol className="mt-4 space-y-2">
                {architecture.optimizations.map((item, i) => (
                  <li key={item} className="flex items-center gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <span className="text-[10px] font-bold w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--bg-tertiary)', color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {item}
                  </li>
                ))}
              </ol>
              <div className="mt-5 grid grid-cols-3 gap-2">
                {Object.entries(architecture.context_windows).map(([key, value]) => (
                  <div key={key} className="rounded-lg p-3 text-center" style={{ background: 'var(--bg-tertiary)' }}>
                    <dt className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                      {key.replace(/^aetheris-/, '').replace(/-/g, ' ')}
                    </dt>
                    <dd className="mt-1 text-sm font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                      {(value / 1024).toFixed(0)}K
                    </dd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* Training */}
      {training && (
        <Section id="training" kicker="Training" title={<>Provenance you can <Gradient>audit.</Gradient></>}>
          <div className="rounded-2xl border p-6 mb-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-mint)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {training.foundation_status}
                </span>
              </div>
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{training.foundation}</span>
              {training.runtime?.episodes_learned_from != null && (
                <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {training.runtime.episodes_learned_from} episode(s) learned from · {training.runtime.improving ? 'improving ↑' : 'stable'}
                </span>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {training.alignment_methods.map((m) => (
                <span key={m} className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: 'rgba(167,139,250,0.1)', color: 'var(--accent-purple)', fontFamily: 'var(--font-mono)' }}>
                  {m}
                </span>
              ))}
            </div>
          </div>

          <ol className="space-y-3">
            {training.stages.map((stage, i) => (
              <li key={stage.id} className="flex gap-4 rounded-xl border p-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                <span className="text-[10px] font-bold w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: 'var(--bg-tertiary)', color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {stage.phase}
                    </span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{
                        background: stage.evidence === 'blueprint' ? 'rgba(52,211,153,0.12)' : 'var(--bg-tertiary)',
                        color: stage.evidence === 'blueprint' ? 'var(--accent-mint)' : 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {stage.evidence}
                    </span>
                  </div>
                  <h3 className="mt-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{stage.name}</h3>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{stage.objective}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Research evolution */}
      {eras.length > 0 && (
        <Section id="research" kicker="Research hub" title={<>50 breakthroughs, <Gradient>one timeline.</Gradient></>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {eras.map((era) => (
              <article key={era.era_id} className="rounded-2xl border p-5 flex flex-col" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)' }}>
                  {era.time_span}
                </span>
                <h3 className="mt-2 text-sm font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                  {era.title}
                </h3>
                <p className="mt-2 text-xs flex-1" style={{ color: 'var(--text-secondary)' }}>{era.paradigm}</p>
                <span className="mt-3 text-[11px]" style={{ color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}>
                  {era.feature_count} milestones
                </span>
              </article>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button onClick={() => onOpenStudio('research')} className="btn btn-primary">
              Open in Studio ↗
            </button>
            <button onClick={onOpenResearch} className="btn">
              Full research hub
            </button>
          </div>
        </Section>
      )}

      {/* Developers */}
      <Section id="developers" kicker="Developers" title={<>Drop-in, <Gradient>offline.</Gradient></>}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {CODE_SAMPLES.map((sample) => (
            <div key={sample.language} className="rounded-2xl overflow-hidden border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{sample.language}</span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{sample.footer}</span>
              </div>
              <pre className="p-4 text-[11px] leading-relaxed overflow-x-auto" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {sample.code}
              </pre>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
          <LinkPill href="/docs">API docs</LinkPill>
          <LinkPill href="/v1/health">Health</LinkPill>
          <LinkPill href="/v1/spec">Model spec</LinkPill>
          <LinkPill href="/v1/training">Training</LinkPill>
          <button onClick={() => onRunPrompt('List the tools you can call, then demonstrate one.')} className="btn">
            Ask Aetheris what it can do →
          </button>
        </div>
      </Section>

      <footer className="px-6 pb-12 pt-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
        Aetheris · one app, one brain — Hermes agent + meta-learning, running entirely offline.
      </footer>
    </div>
  );
}

/* ── Presentational helpers ── */

function Section({
  id,
  kicker,
  title,
  children,
}: {
  id: string;
  kicker: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-b" style={{ borderColor: 'var(--border-color)' }}>
      <div className="max-w-6xl mx-auto px-6 py-16">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)' }}>
          {kicker}
        </span>
        <h2 className="mt-3 mb-8 text-2xl md:text-4xl font-bold tracking-tight" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

function Gradient({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-transparent bg-clip-text"
      style={{ backgroundImage: 'linear-gradient(90deg, var(--accent-mint), var(--accent-blue))' }}
    >
      {children}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: 'var(--bg-tertiary)' }}>
      <dt className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {label}
      </dt>
      <dd className="mt-0.5 text-xs font-bold capitalize" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
        {value}
      </dd>
    </div>
  );
}

function LinkPill({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
    >
      {children}
    </a>
  );
}
