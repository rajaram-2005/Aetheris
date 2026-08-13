/* ─── TopNav — the single, shared application navigation ───
 *
 * The unified shell has exactly one nav. Home holds the marketing/architecture
 * content; Workspace holds the chat. Everything else (God Deck, Settings,
 * theme, API docs) hangs off this bar so there is no second navigation surface.
 */
"use client";

import { AppView } from '@/types';

interface RuntimeInfo {
  online: boolean;
  version: string;
}

interface TopNavProps {
  view: AppView;
  onNavigate: (view: AppView) => void;
  runtime?: RuntimeInfo | null;
  onOpenGodDeck: () => void;
  onOpenSettings: () => void;
  onCycleTheme: () => void;
}

const VIEWS: { id: AppView; label: string; icon: React.ReactNode }[] = [
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M2 7.5 8 2.5l6 5" />
        <path d="M4 7v6h8V7" />
      </svg>
    ),
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M3 4.5h10M3 8h10M3 11.5h6" />
      </svg>
    ),
  },
];

export function TopNav({ view, onNavigate, runtime, onOpenGodDeck, onOpenSettings, onCycleTheme }: TopNavProps) {
  return (
    <header
      className="flex items-center justify-between px-3 sm:px-4 h-12 flex-shrink-0 border-b z-40"
      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
    >
      {/* Brand + primary navigation */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={() => onNavigate('home')}
          className="flex items-center gap-2 min-w-0 group"
          title="Aetheris — home"
        >
          <span
            className="w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center text-xs font-bold shrink-0"
            style={{ background: 'var(--accent-mint)', color: '#0a0e1a', fontFamily: 'var(--font-display)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/avatar-prime.png"
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <span>A</span>
          </span>
          <span
            className="font-semibold text-sm hidden sm:inline truncate"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
          >
            Aetheris
          </span>
        </button>

        <div className="w-px h-5" style={{ background: 'var(--border-color)' }} />

        <nav className="flex items-center gap-1" aria-label="Primary">
          {VIEWS.map((item) => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                aria-current={active ? 'page' : undefined}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: active ? 'var(--bg-hover)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: active ? '1px solid var(--border-hover)' : '1px solid transparent',
                  fontFamily: 'var(--font-ui)',
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Right cluster: status + actions */}
      <div className="flex items-center gap-1.5">
        <div
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold"
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
          title={runtime?.online ? 'Runtime reachable' : 'Runtime offline'}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: runtime?.online ? 'var(--accent-mint)' : 'var(--accent-pink)' }}
          />
          {runtime?.online ? `v${runtime.version}` : 'offline'}
        </div>

        <IconButton label="God Deck" title="God Deck orchestration" onClick={onOpenGodDeck}>
          <span style={{ fontSize: 14, lineHeight: 1, color: 'var(--accent-gold)' }}>Ω</span>
        </IconButton>

        <IconButton label="Theme" title="Cycle theme" onClick={onCycleTheme}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 2.5v11M2.5 8h11" />
          </svg>
        </IconButton>

        <IconButton label="Settings" title="Settings" onClick={onOpenSettings}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
          </svg>
        </IconButton>

        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
          title="Open API docs"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M6 3h7M6 8h7M6 13h7M3 3h.01M3 8h.01M3 13h.01" />
          </svg>
          <span>API</span>
        </a>
      </div>
    </header>
  );
}

function IconButton({
  label,
  title,
  onClick,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={label}
      className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
      style={{ color: 'var(--text-muted)', background: 'transparent' }}
    >
      {children}
    </button>
  );
}
