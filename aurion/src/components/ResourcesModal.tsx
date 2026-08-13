/* ─── Resources — open-source runtimes & model families to plug in ─── */
"use client";

import { useState, useEffect } from 'react';
import { getResources } from '@/lib/hermes';

interface Resource {
  id: string;
  name: string;
  description?: string;
  setup?: string;
  offline?: boolean;
  license?: string;
  url?: string;
  kind?: string;
}

interface ResourcesModalProps {
  onClose: () => void;
}

export function ResourcesModal({ onClose }: ResourcesModalProps) {
  const [runtimes, setRuntimes] = useState<Resource[]>([]);
  const [hosted, setHosted] = useState<Resource[]>([]);
  const [models, setModels] = useState<Resource[]>([]);
  const [media, setMedia] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    getResources()
      .then((res) => {
        setRuntimes(res.runtimes || []);
        setHosted(res.hosted || []);
        setModels(res.model_families || []);
        setMedia(res.media || []);
      })
      .catch(() => setError('Could not load resources.'))
      .finally(() => setLoading(false));
  }, []);

  const copy = (setup: string, id: string) => {
    navigator.clipboard?.writeText(setup).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] rounded-2xl overflow-hidden animate-fade-in flex flex-col"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
              🧰 Open-Source Resources
            </h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
              </svg>
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Plug real open-weight models into Aetheris — local runtimes work with no key; hosted APIs need one in <span className="font-mono">.env</span>.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && <p className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>Loading resources…</p>}
          {error && <p className="text-center py-10 text-sm" style={{ color: 'var(--accent-pink)' }}>{error}</p>}

          {!loading && !error && (
            <>
              <Section title="Local runtimes (offline, no key)">
                {runtimes.map((r) => <ResourceCard key={r.id} r={r} copied={copied} onCopy={copy} />)}
              </Section>
              <Section title="Hosted open-weight APIs">
                {hosted.map((r) => <ResourceCard key={r.id} r={r} copied={copied} onCopy={copy} />)}
              </Section>
              <Section title="Open model families">
                <div className="flex flex-wrap gap-2">
                  {models.map((m) => (
                    <a
                      key={m.id}
                      href={m.url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg text-xs transition-all hover:scale-[1.02]"
                      style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--accent-mint)' }}
                    >
                      {m.name} <span className="opacity-60">· {m.license}</span>
                    </a>
                  ))}
                </div>
              </Section>
              <Section title="Open-source media models">
                <div className="flex flex-wrap gap-2">
                  {media.map((m) => (
                    <a
                      key={m.id}
                      href={m.url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg text-xs transition-all hover:scale-[1.02]"
                      style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
                    >
                      {m.name} <span className="opacity-60">· {m.kind}</span>
                    </a>
                  ))}
                </div>
              </Section>
            </>
          )}
        </div>

        <div className="px-5 py-2 border-t text-center text-[10px]" style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Set AETHERIS_LLM_PROVIDER=openai · AETHERIS_LLM_BASE_URL · AETHERIS_LLM_API_KEY to activate
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ResourceCard({ r, copied, onCopy }: { r: Resource; copied: string | null; onCopy: (setup: string, id: string) => void }) {
  return (
    <div className="px-4 py-3 rounded-xl" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}>{r.name}</span>
          {r.offline !== undefined && (
            <span
              className="px-1.5 py-0.5 rounded-full text-[9px] font-mono whitespace-nowrap"
              style={{ background: r.offline ? 'rgba(74,222,128,0.12)' : 'rgba(251,191,36,0.12)', color: r.offline ? '#4ade80' : '#fbbf24' }}
            >
              {r.offline ? 'offline' : 'needs key'}
            </span>
          )}
        </div>
        {r.setup && (
          <button
            onClick={() => onCopy(r.setup!, r.id)}
            className="px-2.5 py-1 rounded-lg text-[10px] font-mono whitespace-nowrap shrink-0"
            style={{ background: 'rgba(61,255,194,0.1)', border: '1px solid rgba(61,255,194,0.3)', color: 'var(--accent-mint)' }}
          >
            {copied === r.id ? '✓ Copied' : 'Copy setup'}
          </button>
        )}
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{r.description}</p>
      {r.setup && <p className="text-[10px] font-mono mt-1.5" style={{ color: 'var(--text-secondary)' }}>{r.setup}</p>}
    </div>
  );
}
