"use client";

import { useEffect, useState } from "react";

type Kind = "image" | "audio" | "video";
interface MediaProvider { id: string; name: string; kind: Kind; byok: boolean; configured: boolean; envKey: string; notes?: string }
interface Result { provider: string; kind: Kind; url: string; mime: string; latencyMs: number; prompt: string; id: string }

const KEYS_STORAGE = "aetheris.byok.v1";

export function loadByok(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEYS_STORAGE) ?? "{}"); } catch { return {}; }
}

export default function Studio({ hasVideo, onUpgrade }: { hasVideo: boolean; onUpgrade: (reason: string) => void }) {
  const [kind, setKind] = useState<Kind>("image");
  const [prompt, setPrompt] = useState("");
  const [providers, setProviders] = useState<MediaProvider[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    setKeys(loadByok());
    fetch("/api/media/providers").then((r) => r.json()).then((j) => setProviders(j.providers)).catch(() => undefined);
  }, []);
  const saveKeys = (k: Record<string, string>) => { setKeys(k); localStorage.setItem(KEYS_STORAGE, JSON.stringify(k)); };

  const forKind = providers.filter((p) => p.kind === kind);
  const available = forKind.filter((p) => p.configured || keys[p.id]);
  const videoLocked = kind === "video" && !hasVideo && !keys.luma && !keys.runway;

  const generate = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    if (videoLocked) return onUpgrade("Pro Video Generation is an Aetheris Pro feature.");
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/media/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, prompt: text, keys }),
      });
      const j = await r.json();
      if (r.status === 402) return onUpgrade(j.error);
      if (!r.ok) { setErr(j.error + (j.attempts ? "\n" + j.attempts.map((a: { provider: string; error?: string }) => `• ${a.provider}: ${a.error}`).join("\n") : "")); return; }
      setResults((rs) => [{ ...j, prompt: text, id: crypto.randomUUID() }, ...rs]);
      setPrompt("");
    } catch { setErr("Network error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="studio">
      <div className="studio-head">
        <div className="mode-toggle">
          {(["image", "audio", "video"] as Kind[]).map((k) => (
            <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
              {k === "image" ? "Image" : k === "audio" ? "Speech" : "Video"}{k === "video" && !hasVideo ? " ✦" : ""}
            </button>
          ))}
        </div>
        <button className="link" onClick={() => setShowKeys((s) => !s)}>{showKeys ? "hide keys" : "your API keys"}</button>
      </div>

      <div className="studio-providers">
        {forKind.map((p) => (
          <span key={p.id} className={`chip ${p.configured || keys[p.id] ? "on" : ""}`} title={p.notes}>
            <span className={`dot ${p.configured || keys[p.id] ? "ok" : ""}`} />{p.name}{p.byok && !p.configured ? " · BYOK" : ""}
          </span>
        ))}
      </div>

      {showKeys && (
        <div className="keys-panel">
          <p>Bring your own keys. They stay in this browser and are sent only with your generation requests — never stored on the server.</p>
          {providers.filter((p) => p.byok || !p.configured).map((p) => (
            <label key={p.id}>
              <span>{p.name}</span>
              <input type="password" placeholder={p.envKey} value={keys[p.id] ?? ""} onChange={(e) => saveKeys({ ...keys, [p.id]: e.target.value })} autoComplete="off" />
            </label>
          ))}
        </div>
      )}

      {videoLocked && (
        <div className="upsell">
          <span className="badge">PRO</span> Video generation routes to Luma Dream Machine / Runway Gen-3.
          <button className="link" onClick={() => onUpgrade("Pro Video Generation is an Aetheris Pro feature.")}>Upgrade</button> or add your own Luma/Runway key.
        </div>
      )}
      {!videoLocked && available.length === 0 && (
        <div className="upsell">No {kind} provider configured. {forKind.map((p) => p.envKey).filter((v, i, a) => a.indexOf(v) === i).join(" / ")} on the server, or add a key above.</div>
      )}

      <div className="composer-box">
        <textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); } }}
          placeholder={kind === "image" ? "A cinematic photo of Chennai Marina beach at golden hour…" : kind === "audio" ? "Text to speak aloud…" : "A drone shot over Tamil Nadu's tea plantations at dawn…"}
          disabled={busy}
        />
        <button className="send" onClick={generate} disabled={busy || !prompt.trim()}>{busy ? "Generating…" : "Generate"}</button>
      </div>
      {err && <div className="err-text" style={{ whiteSpace: "pre-wrap" }}>{err}</div>}

      <div className="gallery">
        {results.map((r) => (
          <figure key={r.id} className="asset">
            {r.kind === "image" && <img src={r.url} alt={r.prompt} />}
            {r.kind === "audio" && <audio controls src={r.url} />}
            {r.kind === "video" && <video controls src={r.url} />}
            <figcaption>
              <span>{r.prompt}</span>
              <span className="meta-line"><span className="via">via {r.provider}</span><span>{r.latencyMs} ms</span>
                <a href={r.url} download={`aetheris-${r.id.slice(0, 8)}`} target="_blank" rel="noopener noreferrer">download</a></span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
