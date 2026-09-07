/**
 * /thresholds — Per-twin, per-channel fault-detection
 * thresholds fit from the user's own diagnostic history.
 */
import Link from "next/link";
import { fitThresholds, classify, type Thresholds, type ChannelThreshold } from "@/core/diagnostics/thresholds";
import { getUserId } from "@/lib/user";
import { listTwins } from "@/core/twins/twins";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEVERITY_COLOUR: Record<string, string> = { ok: "#4ade80", watch: "#facc15", warning: "#fb923c", critical: "#f87171" };

export default async function ThresholdsPage({ searchParams }: { searchParams: Promise<{ twinId?: string; limit?: string; kWatch?: string; kWarn?: string; kCrit?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId({ allowAnonymous: true });
  const twins = await listTwins(uid);
  const twinId = sp.twinId ?? twins[0]?.id;
  const limit = Math.max(5, Math.min(1000, Number(sp.limit ?? 50)));
  const k = {
    watch: Number(sp.kWatch ?? 1.5),
    warning: Number(sp.kWarn ?? 2.5),
    critical: Number(sp.kCrit ?? 3.5),
  };
  const r: Thresholds = twinId ? await fitThresholds(twinId, { limit, k }) : { ok: false, reason: "no twin", twinId: "(none)", generatedAt: Date.now(), k, channels: [] };

  return (
    <div className="thr-page">
      <header className="thr-head">
        <h1>📏 Thresholds</h1>
        <p>Per-twin, per-channel fault-detection thresholds fit from your own diagnostic history. With at least 5 history points, each channel gets a mean, a standard deviation, and three derived bands (watch / warning / critical) at <code>mean + k·sigma</code>. With fewer points, the function returns <code>ok=false</code> and reports the reason — we do not invent a threshold from nothing.</p>
        <form className="thr-form" method="get">
          <label>Twin <select name="twinId" defaultValue={twinId ?? ""}>
            <option value="">(none)</option>
            {twins.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
          </select></label>
          <label>History limit <input type="number" name="limit" min={5} max={1000} defaultValue={limit} /></label>
          <label>k watch <input type="number" name="kWatch" step="0.1" min={0.1} max={10} defaultValue={k.watch} /></label>
          <label>k warning <input type="number" name="kWarn" step="0.1" min={0.1} max={10} defaultValue={k.warning} /></label>
          <label>k critical <input type="number" name="kCrit" step="0.1" min={0.1} max={10} defaultValue={k.critical} /></label>
          <button type="submit">Fit</button>
        </form>
        <div className="thr-meta">
          <span>twin: <code>{r.twinId}</code></span>
          <span>· generatedAt: <code>{new Date(r.generatedAt).toISOString().slice(0, 19)}</code></span>
          <span>· k: <code>{r.k.watch} / {r.k.warning} / {r.k.critical}</code></span>
          <span>· ok: <strong style={{ color: r.ok ? "#4ade80" : "#f87171" }}>{r.ok ? "✓" : "✗"}</strong></span>
          {!r.ok && r.reason && <span>· reason: <code>{r.reason}</code></span>}
        </div>
      </header>

      {r.ok && (
        <section className="thr-table-wrap">
          <table className="thr-table">
            <thead>
              <tr><th>Channel</th><th>n</th><th>mean</th><th>stdev</th><th>median</th><th>MAD</th><th>watch</th><th>warning</th><th>critical</th></tr>
            </thead>
            <tbody>
              {r.channels.map((c) => (
                <tr key={c.channel}>
                  <td><code>{c.channel}</code></td>
                  <td>{c.n}</td>
                  <td>{c.mean.toFixed(3)}</td>
                  <td>{c.stdev.toFixed(3)}</td>
                  <td>{c.median.toFixed(3)}</td>
                  <td>{c.mad.toFixed(3)}</td>
                  <td><ThresholdBand c={c} level="watch" /></td>
                  <td><ThresholdBand c={c} level="warning" /></td>
                  <td><ThresholdBand c={c} level="critical" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="thr-hint">Tip: a freshly classified reading can be passed to <code>classify(threshold, value)</code> to get <code>ok / watch / warning / critical</code>. The function is exposed at <code>src/core/diagnostics/thresholds.ts</code>.</p>
        </section>
      )}

      <footer className="thr-foot">
        <p><Link href="/diagnostics">/diagnostics</Link> · <Link href="/anomaly">/anomaly</Link> · <Link href="/">/</Link></p>
      </footer>
    </div>
  );
}

function ThresholdBand({ c, level }: { c: ChannelThreshold; level: "watch" | "warning" | "critical" }) {
  const value = c[level];
  // Render the value and what classify() would say if a reading
  // matched it exactly.
  const sample = classify(c, value);
  return (
    <span style={{ color: SEVERITY_COLOUR[sample] }}>
      {value.toFixed(3)} <small>({sample})</small>
    </span>
  );
}
