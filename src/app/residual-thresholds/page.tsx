/**
 * /residual-thresholds — Anomaly thresholds derived from
 * the trained PBNN model's residual variance.
 */
import Link from "next/link";
import { residualThresholds, classifyResidual, type ResidualThresholds } from "@/core/learning/residual-thresholds";
import { getUserId } from "@/lib/user";
import { listTwins } from "@/core/twins/twins";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEVERITY_COLOUR: Record<string, string> = { ok: "#4ade80", watch: "#facc15", warning: "#fb923c", critical: "#f87171" };

export default async function ResidualThresholdsPage({ searchParams }: { searchParams: Promise<{ twinId?: string; kWatch?: string; kWarn?: string; kCrit?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId({ allowAnonymous: true });
  const twins = await listTwins(uid);
  const twinId = sp.twinId ?? twins[0]?.id;
  const k = {
    watch: Number(sp.kWatch ?? 1.5),
    warning: Number(sp.kWarn ?? 2.5),
    critical: Number(sp.kCrit ?? 3.5),
  };
  const r: ResidualThresholds = twinId ? await residualThresholds(uid, twinId, { k }) : { ok: false, reason: "no twin", twinId: "(none)", generatedAt: Date.now(), k, channels: [] };
  return (
    <div className="rt-page">
      <header className="rt-head">
        <h1>📊 Residual Thresholds</h1>
        <p>Anomaly thresholds derived from the trained PBNN model&apos;s residual variance. With a trained model, the residual standard deviation is <code>sqrt(sigma2)</code> and the bands are <code>mean ± k·sigma</code>. With no model, the function returns <code>ok=false</code> and reports the reason — we do not invent a sigma.</p>
        <form className="rt-form" method="get">
          <label>Twin <select name="twinId" defaultValue={twinId ?? ""}>
            <option value="">(none)</option>
            {twins.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
          </select></label>
          <label>k watch <input type="number" name="kWatch" step="0.1" min={0.1} max={10} defaultValue={k.watch} /></label>
          <label>k warning <input type="number" name="kWarn" step="0.1" min={0.1} max={10} defaultValue={k.warning} /></label>
          <label>k critical <input type="number" name="kCrit" step="0.1" min={0.1} max={10} defaultValue={k.critical} /></label>
          <button type="submit">Compute</button>
        </form>
        <div className="rt-meta">
          <span>twin: <code>{r.twinId}</code></span>
          <span>· ok: <strong style={{ color: r.ok ? "#4ade80" : "#f87171" }}>{r.ok ? "✓" : "✗"}</strong></span>
          {!r.ok && r.reason && <span>· reason: <code>{r.reason}</code></span>}
        </div>
      </header>

      {r.ok && (
        <section className="rt-table-wrap">
          <table className="rt-table">
            <thead>
              <tr><th>Channel</th><th>mean</th><th>sigma</th><th>sigma²</th><th>trainedOn</th><th>watch</th><th>warning</th><th>critical</th></tr>
            </thead>
            <tbody>
              {r.channels.map((c) => (
                <tr key={c.channel}>
                  <td><code>{c.channel}</code></td>
                  <td>{c.mean.toFixed(3)}</td>
                  <td>{c.sigma.toFixed(3)}</td>
                  <td>{c.sigma2.toFixed(4)}</td>
                  <td>{c.trainedOn}</td>
                  <td><ResidualBand t={c} level="watch" /></td>
                  <td><ResidualBand t={c} level="warning" /></td>
                  <td><ResidualBand t={c} level="critical" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rt-hint">Use <code>classifyResidual(threshold, value)</code> to label a reading. The threshold comes from the trained model; the bands come from the user&apos;s choice of k.</p>
        </section>
      )}

      <footer className="rt-foot">
        <p><Link href="/learning">/learning</Link> · <Link href="/thresholds">/thresholds</Link> · <Link href="/anomaly">/anomaly</Link></p>
      </footer>
    </div>
  );
}

function ResidualBand({ t, level }: { t: { mean: number; sigma: number; k: { watch: number; warning: number; critical: number }; watch: number; warning: number; critical: number }; level: "watch" | "warning" | "critical" }) {
  const v = t[level];
  const sample = classifyResidual({ ...t, channel: "x", target: "x", twinId: "t", sigma2: t.sigma ** 2, trainedOn: 0, n: 0 } as never, v);
  return <span style={{ color: SEVERITY_COLOUR[sample] }}>{v.toFixed(3)} <small>({sample})</small></span>;
}
