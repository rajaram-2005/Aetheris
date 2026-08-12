/* ─── Boot Splash — Hermes cascade light animation ─── */
"use client";

import { useState, useEffect } from 'react';

const STAGES = ['SENSE', 'ALIGN', 'PLOT', 'RECALL', 'THINK', 'WEAVE', 'REFINE'];

export function SplashScreen() {
  const [activeIdx, setActiveIdx] = useState(-1);
  const [done, setDone] = useState(false);

  useEffect(() => {
    STAGES.forEach((_, i) => {
      setTimeout(() => setActiveIdx(i), 300 + i * 220);
    });
    setTimeout(() => setDone(true), 300 + STAGES.length * 220 + 400);
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center z-50" style={{ background: 'var(--bg-primary)' }}>
      {/* Logo */}
      <div className="mb-8 animate-fade-in">
        <h1
          className="text-5xl font-bold tracking-tight"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}
        >
          Aetheris
        </h1>
        <p className="text-center mt-2" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
          Sovereign Cognitive Engine
        </p>
      </div>

      {/* Hermes cascade dots */}
      <div className="flex items-center gap-3 mb-6">
        {STAGES.map((stage, i) => (
          <div key={stage} className="flex flex-col items-center gap-1.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300"
              style={{
                background: i <= activeIdx ? 'var(--accent-mint)' : 'var(--bg-tertiary)',
                color: i <= activeIdx ? '#0a0e1a' : 'var(--text-muted)',
                boxShadow: i === activeIdx ? '0 0 20px var(--shadow-glow)' : 'none',
                transform: i === activeIdx ? 'scale(1.2)' : 'scale(1)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {i + 1}
            </div>
            <span
              className="text-[10px] font-medium transition-all duration-300"
              style={{
                color: i <= activeIdx ? 'var(--accent-mint)' : 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {stage}
            </span>
          </div>
        ))}
      </div>

      {/* Status */}
      <div className="flex items-center gap-2" style={{ fontFamily: 'var(--font-ui)' }}>
        {!done ? (
          <>
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent-mint)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Initializing Hermes cascade…</span>
          </>
        ) : (
          <>
            <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-mint)' }} />
            <span style={{ color: 'var(--accent-mint)' }}>Ready — all processing on-device</span>
          </>
        )}
      </div>

      {/* Privacy badge */}
      <div
        className="absolute bottom-8 px-4 py-2 rounded-full text-xs"
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-ui)',
        }}
      >
        🔒 On-device · private · No OpenAI · No Gemini · No Claude
      </div>
    </div>
  );
}
