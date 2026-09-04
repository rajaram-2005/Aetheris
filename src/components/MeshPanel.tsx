"use client";

import { useState } from "react";

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
  keyless?: boolean;
  hasKey?: boolean;
  keyUrl?: string;
  freeTier?: string;
}

const KEY_URLS: Record<string, string> = {
  groq: "https://console.groq.com/keys", cerebras: "https://cloud.cerebras.ai", sambanova: "https://cloud.sambanova.ai", gemini: "https://aistudio.google.com/apikey",
  github: "https://github.com/settings/tokens", openrouter: "https://openrouter.ai/keys", mistral: "https://console.mistral.ai", together: "https://api.together.ai",
  cohere: "https://dashboard.cohere.com/api-keys", cloudflare: "https://dash.cloudflare.com/profile/api-tokens", huggingface: "https://huggingface.co/settings/tokens",
  nvidia: "https://build.nvidia.com", deepseek: "https://platform.deepseek.com", ai21: "https://studio.ai21.com", perplexity: "https://www.perplexity.ai/settings/api",
};

/**
 * Opens a URL in a new tab. Inside sandboxed iframes (e.g. hosted previews) popups are
 * blocked silently, so we fall back to copying the URL and telling the user.
 */
function KeyLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [state, setState] = useState<"idle" | "copied" | "blocked">("idle");
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    let w: Window | null = null;
    try { w = window.open(href, "_blank", "noopener,noreferrer"); } catch { w = null; }
    if (w) return;
    navigator.clipboard?.writeText(href).then(() => setState("copied")).catch(() => setState("blocked"));
    setTimeout(() => setState("idle"), 4000);
  };
  return (
    <span className="keylink">
      <a href={href} target="_blank" rel="noreferrer noopener" onClick={onClick}>{children}</a>
      {state !== "idle" && (
        <span className="keylink-note">
          {state === "copied" ? "popup blocked here — link copied, paste it in a new tab: " : "popup blocked — open this in a new tab: "}
          <code>{href}</code>
        </span>
      )}
    </span>
  );
}

export default function MeshPanel({
  providers,
  preferred,
  onSelect,
  full,
}: {
  providers: ProviderStatus[];
  preferred?: string;
  onSelect: (id: string) => void;
  /** Render as a full page (Providers tab) instead of an inline card. */
  full?: boolean;
}) {
  const configured = providers.filter((p) => p.configured);
  const unconfigured = providers.filter((p) => !p.configured);
  return (
    <div className={`mesh-panel ${full ? "mesh-full" : ""}`}>
      <div className="mesh-title">
        <h2>Provider mesh</h2>
        <span className="hint" style={{ margin: 0 }}>{configured.length}/{providers.length} configured · {providers.filter((p) => p.state === "ready").length} ready{preferred ? ` · pinned: ${providers.find((p) => p.id === preferred)?.name}` : ""}</span>
      </div>
      {configured.length === 0 ? (
        <div className="mesh-empty">
          <strong style={{ color: "var(--text)" }}>No keyed providers yet.</strong>
          <ol style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.8 }}>
            <li>Copy <code>.env.example</code> to <code>.env.local</code></li>
            <li>Add at least one key — the free ones below take under a minute (Groq, Cerebras, Gemini are the fastest)</li>
            <li>Restart <code>npm run dev</code></li>
          </ol>
          <p style={{ margin: "8px 0 0" }}>The router only uses providers whose key is present, tries them in priority order and fails over automatically on rate limits.</p>
        </div>
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
                <div className="name">{p.name}{p.keyless && !p.hasKey ? <span className="tag">keyless</span> : null}{p.state === "cooldown" ? ` · cooldown ${p.cooldownSecs}s` : ""}</div>
                <div className="meta">{p.model}</div>
                {p.freeTier && <div className="meta" style={{ fontFamily: "var(--font)" }}>{p.freeTier}</div>}
                {p.keyless && !p.hasKey && p.keyUrl && <div className="meta"><KeyLink href={p.keyUrl}>add a free token for higher limits ↗</KeyLink></div>}
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
          <h2 style={{ marginTop: 16 }}>Available — add a key to activate ({unconfigured.length})</h2>
          <div className="mesh-grid">
            {unconfigured.map((p) => (
              <div key={p.id} className="mesh-item off">
                <span className="dot" />
                <span style={{ minWidth: 0 }}>
                  <div className="name">{p.name} <span className="tag">P{p.priority}</span></div>
                  <div className="meta">{p.model}</div>
                  {p.notes && <div className="meta" style={{ fontFamily: "var(--font)" }}>{p.notes}</div>}
                  {p.freeTier && <div className="meta" style={{ fontFamily: "var(--font)", color: "var(--ok)" }}>{p.freeTier}</div>}
                  <div className="meta">env: <code>{p.envKey}</code>{(p.keyUrl ?? KEY_URLS[p.id]) && <> · <KeyLink href={p.keyUrl ?? KEY_URLS[p.id]}>get a free key ↗</KeyLink></>}</div>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
