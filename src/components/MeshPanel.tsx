"use client";

import { useState } from "react";
import BrandTile from "./Brand";
import AddProviderBox from "./AddProviderBox";

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
  baseUrl?: string;
  custom?: boolean;
  local?: boolean;
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
  const [blocked, setBlocked] = useState<false | "copied" | "manual">(false);
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Only ever open in a NEW tab. Never navigate this frame: provider key pages send
    // X-Frame-Options / CSP frame-ancestors and refuse to render inside an iframe.
    let w: Window | null = null;
    try { w = window.open(href, "_blank", "noopener,noreferrer"); } catch { w = null; }
    if (w) return;
    navigator.clipboard?.writeText(href).then(() => setBlocked("copied")).catch(() => setBlocked("manual"));
  };
  return (
    <span className="keylink">
      <a href={href} target="_blank" rel="noreferrer noopener" onClick={onClick}>{children}</a>
      {blocked && (
        <span className="keylink-note">
          {blocked === "copied" ? "Link copied. " : ""}This embedded preview can't open new tabs — paste this in a new tab:{" "}
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
  const [showAdd, setShowAdd] = useState(false);
  const configured = providers.filter((p) => p.configured);
  const unconfigured = providers.filter((p) => !p.configured);
  return (
    <div className={`mesh-panel ${full ? "mesh-full" : ""}`}>
      <div className="mesh-title">
        <h2>Provider mesh</h2>
        <span className="hint" style={{ margin: 0 }}>{configured.length}/{providers.length} configured · {providers.filter((p) => p.state === "ready").length} ready{preferred ? ` · pinned: ${providers.find((p) => p.id === preferred)?.name}` : ""}</span>
        {full && (
          <button className="send" style={{ marginLeft: "auto", padding: "5px 12px", fontSize: 12 }} onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? "Close" : "＋ Add provider by link"}
          </button>
        )}
      </div>
      {full && showAdd && (
        <div className="mesh-addbox">
          <AddProviderBox
            onCancel={() => setShowAdd(false)}
            onSaved={() => {
              setShowAdd(false);
              if (typeof window !== "undefined") window.dispatchEvent(new Event("aetheris:refresh-providers"));
            }}
          />
        </div>
      )}
      {configured.length === 0 ? (
        <div className="mesh-empty">
          <strong style={{ color: "var(--text)" }}>No keyed providers yet.</strong>
          <ol style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.8 }}>
            <li>Open <b>Settings → API keys</b> and paste a free key — Groq, Cerebras and Gemini take under a minute (no .env, no restart)</li>
            <li>Running something locally (Ollama, LM Studio, llama.cpp…)? Hit <b>＋ Add provider by link</b> above and point it at your server</li>
          </ol>
          <p style={{ margin: "8px 0 0" }}>The router tries providers in priority order and fails over automatically on rate limits.</p>
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
              <BrandTile name={p.name} id={p.custom ? undefined : p.id} category={p.custom ? "custom" : undefined} />
              <span style={{ minWidth: 0 }}>
                <div className="name">
                  {p.custom ? <span className="tag" style={{ color: "var(--ok)" }}>yours</span> : null}
                  {p.local ? <span className="tag">local</span> : null}
                  {p.name}{p.keyless && !p.hasKey ? <span className="tag">keyless</span> : null}{p.state === "cooldown" ? ` · cooldown ${p.cooldownSecs}s` : ""}
                </div>
                <div className="meta">{p.model}{p.custom && p.baseUrl ? ` · ${p.baseUrl}` : ""}</div>
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
                <BrandTile name={p.name} id={p.custom ? undefined : p.id} />
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
