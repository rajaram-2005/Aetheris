/**
 * /vayu — VAYU-1 service page.
 *
 *   Server-rendered form. Takes a question, optional twin id,
 *   channel, and horizon. Runs the VAYU-1 service and shows
 *   the structured bundle: prediction, anomaly, arena, fft,
 *   summary, mode.
 */
import Link from "next/link";
import { vayuQuery, type VayuChannel, type VayuResult } from "@/core/vayu/service";
import { getUserId } from "@/lib/user";
import { listTwins } from "@/core/twins/twins";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHANNELS: VayuChannel[] = ["peakMagnitude", "dominantHz", "topFaultMagnitude", "matchCount", "vib_bearing_mms", "vib_shaft_mms"];

export default async function VayuPage({ searchParams }: { searchParams: Promise<{ q?: string; twinId?: string; channel?: string; horizon?: string; demo?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId({ allowAnonymous: true });
  const twins = await listTwins(uid);
  const question = sp.q ?? "what is the current state?";
  const channel = (sp.channel as VayuChannel) || "peakMagnitude";
  const horizon = Math.max(1, Math.min(20, Number(sp.horizon ?? 6)));
  const demo = sp.demo === "1" || twins.length === 0;
  const result: VayuResult = await vayuQuery({ uid, question, twinId: sp.twinId, channel, horizon, demo });
  return (
    <div className="vayu-page">
      <header className="vayu-head">
        <h1>🌀 VAYU-1 — Wind &amp; Aerodynamics Intelligence Service</h1>
        <p>Build as proxy. Composes PBNN + Anomaly + Model Arena + FFT behind a single named query. Mode is always labelled: <strong>live</strong> uses real telemetry, <strong>demo-seed</strong> uses the canonical turbine. <em>No fine-tuned model is invoked here — VAYU-1 is a service that routes to existing modules, not a trained domain model.</em></p>
        <form className="vayu-form" method="get">
          <label>Question <input type="text" name="q" defaultValue={question} /></label>
          <label>Twin <select name="twinId" defaultValue={sp.twinId ?? ""}>
            <option value="">(first available)</option>
            {twins.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
          </select></label>
          <label>Channel <select name="channel" defaultValue={channel}>
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
          <label>Horizon <input type="number" name="horizon" min={1} max={20} defaultValue={horizon} /></label>
          <label><input type="checkbox" name="demo" value="1" defaultChecked={demo} /> force demo-seed</label>
          <button type="submit">Query</button>
        </form>
        <div className="vayu-meta">
          <span>mode: <strong style={{ color: result.mode === "live" ? "#4ade80" : "#facc15" }}>{result.mode}</strong></span>
          <span>twin: <code>{result.twinId}</code></span>
          <span>channel: <code>{result.channel}</code></span>
          <span>capability: <code>{result.capability}</code></span>
        </div>
      </header>

      <section className="vayu-summary">
        <h2>Summary</h2>
        <p>{result.summary}</p>
      </section>

      <section className="vayu-grid">
        <article className="vayu-card">
          <h3>PBNN prediction</h3>
          {result.prediction.ok ? (
            <>
              <p className="v-card-meta">horizon: <strong>{result.prediction.horizon}</strong> · source: <code>{result.prediction.source}</code></p>
              <pre className="v-card-num">{result.prediction.predicted.map((v) => v.toFixed(3)).join("\n")}</pre>
            </>
          ) : <p className="v-card-fail">not available: {result.prediction.reason}</p>}
        </article>

        <article className="vayu-card">
          <h3>Anomaly detection</h3>
          {result.anomaly.ok ? (
            <>
              <p className="v-card-meta">points: <strong>{result.anomaly.points}</strong> · anomalies: <strong>{result.anomaly.anomalies}</strong> · z: <strong>{result.anomaly.z}</strong></p>
              <p className="v-card-meta">source: <code>{result.anomaly.source}</code></p>
            </>
          ) : <p className="v-card-fail">not available: {result.anomaly.reason}</p>}
        </article>

        <article className="vayu-card">
          <h3>Model arena</h3>
          {result.arena.ok ? (
            <>
              <p className="v-card-meta">baseline: <code>{result.arena.baselineTwin}</code> · candidate: <code>{result.arena.candidateTwin ?? "(none)"}</code></p>
              <table className="v-card-table">
                <thead><tr><th>provider</th><th>latency_ms</th></tr></thead>
                <tbody>{Object.entries(result.arena.baseline).map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td>{v}</td></tr>)}</tbody>
              </table>
            </>
          ) : <p className="v-card-fail">not available: {result.arena.reason}</p>}
        </article>

        <article className="vayu-card">
          <h3>FFT spectrum</h3>
          {result.fft.ok ? (
            <>
              <p className="v-card-meta">bins: <strong>{result.fft.bins}</strong> · sample_rate: <strong>{result.fft.sampleRate.toFixed(0)} Hz</strong></p>
              <p className="v-card-meta">peak: <strong>{result.fft.peakHz.toFixed(2)} Hz</strong> · source: <code>{result.fft.source}</code></p>
            </>
          ) : <p className="v-card-fail">not available: {result.fft.reason}</p>}
        </article>
      </section>

      <footer className="vayu-foot">
        <p><Link href="/cores">/cores</Link> · <Link href="/fuse">/fuse</Link> · <Link href="/">/</Link></p>
      </footer>
    </div>
  );
}
