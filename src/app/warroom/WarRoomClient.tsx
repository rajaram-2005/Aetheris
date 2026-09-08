"use client";
/**
 * War Room — the start-a-new-debate form. The streaming SSE shows each
 * turn as it arrives. The form submits to /api/debate, which persists the
 * completed debate; on success the page navigates to /warroom?id=… so
 * the user sees the canonical transcript.
 */
import { useState } from "react";

const PROS = ["strategist", "hermes", "metis", "engineer"];
const CONS = ["decision", "hermes", "metis", "engineer"];

export default function WarRoomClient() {
  const [motion, setMotion] = useState("");
  const [pro, setPro] = useState("strategist");
  const [con, setCon] = useState("decision");
  const [rounds, setRounds] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<string>("");

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStream("");
    if (!motion.trim()) { setError("Motion is required."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motion: motion.trim(), pro, con, rounds }),
      });
      if (!r.ok || !r.body) { setError(`Request failed (${r.status})`); setBusy(false); return; }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let bufText = "";
      let savedId: string | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let ev: { type: string; side?: string; round?: number; text?: string; name?: string; icon?: string; id?: string; error?: string };
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.type === "turn" && ev.side !== "judge") {
            bufText += `\n\n### ${ev.icon ?? ""} ${ev.name ?? ev.side} · ${ev.side === "pro" ? "FOR" : "AGAINST"} · round ${ev.round}\n\n`;
            setStream((s) => s + bufText); bufText = "";
          } else if (ev.type === "turn" && ev.side === "judge") {
            bufText += `\n\n---\n\n### 🦉 Metis — verdict\n\n`;
            setStream((s) => s + bufText); bufText = "";
          } else if (ev.type === "delta" && ev.text) {
            bufText += ev.text;
            // Update stream in small chunks; flush at newline boundaries
            if (ev.text.includes("\n")) {
              setStream((s) => s + bufText); bufText = "";
            }
          } else if (ev.type === "saved" && ev.id) {
            savedId = ev.id;
          } else if (ev.type === "error") {
            setError(ev.error ?? "Stream error");
          } else if (ev.type === "done") {
            // flush remaining
            if (bufText) { setStream((s) => s + bufText); bufText = ""; }
            if (savedId) {
              window.location.href = `/warroom?id=${encodeURIComponent(savedId)}`;
            }
          }
        }
      }
      if (bufText) setStream((s) => s + bufText);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="warroom-form" onSubmit={start}>
      <label className="warroom-field">
        <span>Motion</span>
        <textarea
          rows={3}
          value={motion}
          onChange={(e) => setMotion(e.target.value)}
          placeholder="e.g. AI safety work should pause frontier training until interpretability catches up."
          maxLength={2000}
          required
        />
      </label>
      <div className="warroom-row">
        <label className="warroom-field">
          <span>🥊 PRO (FOR)</span>
          <select value={pro} onChange={(e) => setPro(e.target.value)}>
            {PROS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="warroom-field">
          <span>🥊 CON (AGAINST)</span>
          <select value={con} onChange={(e) => setCon(e.target.value)}>
            {CONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="warroom-field">
          <span>Rounds</span>
          <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
        <button className="warroom-btn" type="submit" disabled={busy}>{busy ? "Debating…" : "Start debate"}</button>
      </div>
      {error && <div className="warroom-err">{error}</div>}
      {stream && <pre className="warroom-stream">{stream}</pre>}
    </form>
  );
}
