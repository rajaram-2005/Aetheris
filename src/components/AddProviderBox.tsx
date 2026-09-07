"use client";

/**
 * Add / edit a provider by link — any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp,
 * KoboldCpp, LocalAI, Jan, vLLM, or any hosted third-party gateway). Test the connection first
 * and the server's real models are offered as chips. Optional key is stored in the runtime key
 * store (Settings-managed). No .env, no restart.
 */
import { useEffect, useState } from "react";
import BrandTile from "./Brand";

export interface AddProviderDraft {
  id?: string;
  name: string;
  baseUrl: string;
  model: string;
  vision?: boolean;
  local?: boolean;
  notes?: string;
}

const TEMPLATES: { name: string; baseUrl: string; model: string; note: string }[] = [
  { name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1", note: "default port 11434" },
  { name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model", note: "Local Server in LM Studio" },
  { name: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1", model: "local-model", note: "llama-server" },
  { name: "KoboldCpp", baseUrl: "http://127.0.0.1:5001/v1", model: "koboldcpp/model", note: "OpenAI-compatible mode" },
  { name: "LocalAI", baseUrl: "http://127.0.0.1:8080/v1", model: "local-model", note: "any model you pulled" },
  { name: "Jan", baseUrl: "http://127.0.0.1:1337/v1", model: "local-model", note: "Jan local API server" },
  { name: "vLLM", baseUrl: "http://127.0.0.1:8000/v1", model: "default", note: "vllm serve" },
  { name: "text-gen WebUI", baseUrl: "http://127.0.0.1:5000/v1", model: "local-model", note: "oobabooga" },
];

export default function AddProviderBox({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: AddProviderDraft | null;
  onSaved?: (rec: AddProviderDraft) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [key, setKey] = useState("");
  const [vision, setVision] = useState(initial?.vision ?? false);
  const [local, setLocal] = useState(initial?.local ?? true);
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const editing = !!initial?.id;

  // Default "local" from the host when the URL changes.
  useEffect(() => {
    try {
      const host = new URL(baseUrl).hostname;
      setLocal(/^(127\.|localhost|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host));
    } catch { /* keep current */ }
  }, [baseUrl]);

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    setName(t.name); setBaseUrl(t.baseUrl); setModel(t.model); setLocal(true); setModels([]); setTestState("idle");
  };

  const test = async () => {
    setErr(null);
    if (!/^https?:\/\/[^\s]+$/i.test(baseUrl.trim())) { setTestState("fail"); setTestMsg("enter a valid http(s) URL first"); return; }
    setTestState("testing"); setTestMsg("");
    try {
      const r = await fetch("/api/providers/custom/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl: baseUrl.trim(), key: key.trim() || undefined }) });
      const j = await r.json();
      if (j.ok) {
        setTestState("ok"); setTestMsg(j.models?.length ? `connected · ${j.latencyMs}ms · ${j.models.length} models` : j.detail ?? "connected");
        setModels(j.models ?? []);
        if (j.models?.length && !model) setModel(j.models[0]);
      } else {
        setTestState("fail"); setTestMsg(j.detail ?? "connection failed");
      }
    } catch { setTestState("fail"); setTestMsg("could not reach the server"); }
  };

  const save = async () => {
    setErr(null);
    if (name.trim().length < 2) return setErr("Give it a name (e.g. “Ollama”, “My GPU box”).");
    if (!/^https?:\/\/[^\s]+$/i.test(baseUrl.trim())) return setErr("Base URL must be http(s), e.g. http://127.0.0.1:11434/v1");
    if (!model.trim()) return setErr("A default model is needed — test the connection to list the server's models.");
    setBusy(true);
    try {
      const body = { name: name.trim(), baseUrl: baseUrl.trim(), model: model.trim(), vision, local, key: key.trim() || undefined, notes: local ? "Added by link — local endpoint" : "Added by link" };
      const r = editing
        ? await fetch("/api/providers/custom", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: initial!.id, ...body }) })
        : await fetch("/api/providers/custom", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) return setErr(j.error ?? "save failed");
      if (key.trim()) setKey("");
      onSaved?.({ id: j.provider?.id ?? initial?.id, ...body });
      if (!editing) { setName(""); setBaseUrl(""); setModel(""); setVision(false); setTestState("idle"); setModels([]); }
      if (editing && onCancel) onCancel();
    } catch { setErr("could not reach the server"); } finally { setBusy(false); }
  };

  return (
    <div className="apb">
      <div className="apb-head">
        <b>{editing ? `Edit ${initial!.name}` : "Add a provider by link"}</b>
        <span className="hint">Any OpenAI-compatible endpoint — a local server or a third-party gateway. Applies instantly, no .env, no restart.</span>
      </div>

      {!editing && (
        <div className="apb-tpl">
          <span className="apb-tpl-label">Quick picks</span>
          <div className="apb-chips">
            {TEMPLATES.map((t) => (
              <button key={t.name} type="button" title={t.note} onClick={() => applyTemplate(t)}>
                <BrandTile name={t.name} id={t.name.toLowerCase().replace(/[^a-z0-9]+/g, "")} size={18} /> {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="apb-grid">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ollama, My GPU box…" autoFocus={!editing} />
        </label>
        <label className="field">
          <span>Base URL</span>
          <input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setTestState("idle"); }} placeholder="http://127.0.0.1:11434/v1" spellCheck={false} />
        </label>
        <label className="field apb-model">
          <span>Default model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="llama3.1" spellCheck={false} />
        </label>
      </div>

      <div className="apb-test">
        <button type="button" className="ghost" onClick={test} disabled={busy || testState === "testing"}>
          {testState === "testing" ? "Testing…" : "Test connection & list models"}
        </button>
        {testMsg && <span className={testState === "ok" ? "ok-text" : "err-text"}>{testMsg}</span>}
      </div>
      {testState === "ok" && models.length > 0 && (
        <div className="apb-models">
          <span className="apb-tpl-label">Served models</span>
          <div className="apb-chips models">
            {models.map((m) => (
              <button key={m} type="button" className={model === m ? "on" : ""} onClick={() => setModel(m)}>{m}</button>
            ))}
          </div>
        </div>
      )}

      <div className="apb-row">
        <label className="field" style={{ flex: 1 }}>
          <span>API key <em className="hint">(optional — many local servers need none)</em></span>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" autoComplete="off" spellCheck={false} />
        </label>
        <label className="field row" style={{ flex: "0 0 auto", alignSelf: "flex-end", paddingBottom: 8 }}>
          <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} />
          <span>Vision</span>
        </label>
        <label className="field row" style={{ flex: "0 0 auto", alignSelf: "flex-end", paddingBottom: 8 }}>
          <input type="checkbox" checked={local} onChange={(e) => { setLocal(e.target.checked); }} />
          <span>Local</span>
        </label>
      </div>

      {err && <div className="err-text">{err}</div>}
      <div className="apb-actions">
        <button type="button" className="send" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add provider"}</button>
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
