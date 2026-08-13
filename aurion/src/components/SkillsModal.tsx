/* ─── Skills — Claude-style & Gemini-style skill packs ─── */
"use client";

import { useState, useEffect } from 'react';
import { getSkillsCatalog } from '@/lib/hermes';

interface Skill {
  id: string;
  name: string;
  icon: string;
  description: string;
  tools: string[];
  trigger: string;
}

interface SkillFamily {
  family: string;
  note: string;
  skills: Skill[];
}

interface SkillsModalProps {
  onClose: () => void;
  onRun: (text: string) => void;
}

export function SkillsModal({ onClose, onRun }: SkillsModalProps) {
  const [families, setFamilies] = useState<SkillFamily[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSkillsCatalog()
      .then((catalog) => setFamilies(catalog.families || []))
      .catch(() => setError('Could not load the skill catalog.'))
      .finally(() => setLoading(false));
  }, []);

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
              🧩 Skills
            </h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
              </svg>
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Deep-work packs inspired by Claude and Gemini. Click one to run it in chat.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && <p className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>Loading skill catalog…</p>}
          {error && <p className="text-center py-10 text-sm" style={{ color: 'var(--accent-pink)' }}>{error}</p>}

          {!loading && !error && families.map((family) => (
            <div key={family.family}>
              <div className="mb-2">
                <h3 className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
                  {family.family}
                </h3>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{family.note}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {family.skills.map((skill) => (
                  <button
                    key={skill.id}
                    onClick={() => { onRun(skill.trigger); onClose(); }}
                    className="flex items-start gap-3 px-4 py-3 rounded-xl text-left transition-all hover:scale-[1.01]"
                    style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
                  >
                    <span className="text-xl mt-0.5">{skill.icon}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}>
                        {skill.name}
                      </p>
                      <p className="text-xs mt-0.5 leading-snug" style={{ color: 'var(--text-muted)' }}>
                        {skill.description}
                      </p>
                      <p className="text-[10px] mt-1.5 font-mono" style={{ color: 'var(--accent-mint)' }}>
                        {skill.tools.join(' · ')}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-2 border-t text-center text-[10px]" style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Skills map to the live toolbelt — code, images, audio, research, and more
        </div>
      </div>
    </div>
  );
}
