"use client";

export interface ProviderStatus {
  id: string;
  name: string;
  model: string;
  priority: number;
  envKey: string;
  notes?: string;
  configured: boolean;
  state: "ready" | "cooldown" | "unconfigured";
  cooldownSecs: number;
  successes: number;
  failures: number;
  avgLatencyMs: number;
  lastError?: string;
}

export default function MeshPanel({
  providers,
  preferred,
  onSelect,
}: {
  providers: ProviderStatus[];
  preferred?: string;
  onSelect: (id: string) => void;
}) {
  const configured = providers.filter((p) => p.configured);
  const unconfigured = providers.filter((p) => !p.configured);
  return (
    <div className="mesh-panel">
      <h2>Provider mesh</h2>
      {configured.length === 0 ? (
        <p className="mesh-empty">
          No providers are configured yet. Copy <code>.env.example</code> to <code>.env.local</code>, add at
          least one key (e.g. <code>GROQ_API_KEY</code>), and restart the dev server.
        </p>
      ) : (
        <div className="mesh-grid">
          {configured.map((p) => (
            <button
              key={p.id}
              className={`mesh-item ${preferred === p.id ? "selected" : ""}`}
              onClick={() => onSelect(p.id)}
              title={preferred === p.id ? "Unpin" : "Pin this provider first"}
            >
              <span className={`dot ${p.state === "ready" ? "ok" : "warn"}`} />
              <span>
                <div className="name">{p.name}{p.state === "cooldown" ? ` · cooldown ${p.cooldownSecs}s` : ""}</div>
                <div className="meta">{p.model}</div>
                <div className="meta">
                  P{p.priority} · ✓{p.successes} ✗{p.failures}{p.avgLatencyMs ? ` · ${p.avgLatencyMs}ms` : ""}
                </div>
                {p.lastError && <div className="err-text">{p.lastError.slice(0, 120)}</div>}
              </span>
            </button>
          ))}
        </div>
      )}
      {unconfigured.length > 0 && (
        <>
          <h2 style={{ marginTop: 12 }}>Not configured ({unconfigured.length})</h2>
          <div className="mesh-grid">
            {unconfigured.map((p) => (
              <div key={p.id} className="mesh-item" style={{ opacity: 0.6 }}>
                <span className="dot" />
                <span>
                  <div className="name">{p.name}</div>
                  <div className="meta">set {p.envKey}</div>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
