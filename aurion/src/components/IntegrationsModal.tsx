/* ─── Integrations — connect Gmail, Meet, Telegram, and more ─── */
"use client";

import { useState, useEffect } from 'react';
import { getIntegrations } from '@/lib/hermes';

interface Integration {
  service: string;
  name: string;
  description: string;
  auth_type: string;
  required_fields: string[];
  optional_fields: string[];
}

const ICONS: Record<string, string> = {
  gmail: '📧', 'google-meet': '📹', 'google-calendar': '📅', 'google-drive': '📁',
  'google-sheets': '📊', telegram: '✈️', whatsapp: '💬', linkedin: '💼',
  instagram: '📸', youtube: '▶️', slack: '💬', github: '🐙', discord: '🎮',
  notion: '📝', jira: '📋', pagerduty: '🚨', stripe: '💳', sendgrid: '✉️',
  twilio: '📞', 'slack-webhook': '🔗', custom: '🔧',
};

interface IntegrationsModalProps {
  onClose: () => void;
}

export function IntegrationsModal({ onClose }: IntegrationsModalProps) {
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Integration | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    getIntegrations()
      .then((res) => setItems(res.data || []))
      .catch(() => setError('Could not load integrations.'))
      .finally(() => setLoading(false));
  }, []);

  const connect = async () => {
    if (!selected) return;
    setStatus('Connecting…');
    try {
      const res = await fetch('/v1/integrations/' + selected.service + '/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Failed to connect.');
      setStatus('✅ Connected: ' + body?.name + ' (' + body?.service_type + ')');
    } catch (e) {
      setStatus('❌ ' + (e instanceof Error ? e.message : 'Connection failed.'));
    }
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
              🔌 Connect Apps
            </h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
              </svg>
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Gmail · Google Meet · Telegram · WhatsApp and more. Store credentials in the connection registry (never exposed).
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && <p className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>Loading integrations…</p>}
          {error && <p className="text-center py-10 text-sm" style={{ color: 'var(--accent-pink)' }}>{error}</p>}

          {!selected && !loading && !error && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {items.map((item) => (
                <button
                  key={item.service}
                  onClick={() => { setSelected(item); setCreds({}); setStatus(null); }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all hover:scale-[1.02]"
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
                >
                  <span className="text-xl">{ICONS[item.service] || '🔗'}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}>
                      {item.name}
                    </p>
                    <p className="text-[10px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                      {item.auth_type}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div>
              <button
                onClick={() => setSelected(null)}
                className="mb-3 text-xs font-mono"
                style={{ color: 'var(--accent-mint)' }}
              >
                ← Back to all apps
              </button>
              <h3 className="text-base font-semibold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                {ICONS[selected.service] || '🔗'} {selected.name}
              </h3>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{selected.description}</p>

              <div className="space-y-2 mb-4">
                {selected.required_fields.concat(selected.optional_fields).map((field) => (
                  <div key={field}>
                    <label className="block text-[11px] font-mono mb-1" style={{ color: 'var(--text-muted)' }}>
                      {field}
                    </label>
                    <input
                      type="password"
                      value={creds[field] || ''}
                      onChange={(e) => setCreds({ ...creds, [field]: e.target.value })}
                      placeholder={field}
                      className="w-full px-3 py-2 rounded-lg text-sm bg-transparent outline-none"
                      style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                ))}
              </div>

              {status && <p className="text-xs mb-3" style={{ color: status.startsWith('✅') ? 'var(--accent-mint)' : 'var(--accent-pink)' }}>{status}</p>}

              <button
                onClick={connect}
                className="px-4 py-2 rounded-xl text-xs font-bold shadow-md"
                style={{ background: 'var(--accent-mint)', color: '#0a0e1a', fontFamily: 'var(--font-ui)' }}
              >
                Connect {selected.name}
              </button>
            </div>
          )}
        </div>

        <div className="px-5 py-2 border-t text-center text-[10px]" style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {items.length} integrations available · credentials are stored locally and never returned
        </div>
      </div>
    </div>
  );
}
