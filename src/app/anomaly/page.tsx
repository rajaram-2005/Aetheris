/**
 * /anomaly — Anomaly Detection page.
 *
 *   Real anomaly detection over the actual diagnostic history of a
 *   twin. Pick a twin, pick a channel, and the page shows the
 *   z-score for each point, flagged by severity (info / warn /
 *   critical). The model used is a constant + MAD-robust sigma;
 *   the page shows the bias and sigma so the user can audit it.
 *
 *   URL: /anomaly?twinId=…&channel=…&z=…
 */
import Link from "next/link";
import { detectChannel, type AnomalyPoint, type AnomalyReport } from "@/core/anomaly/detector";
import { listTwins } from "@/core/twins/twins";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEVERITY_COLOUR: Record<string, string> = {
  info: "#4ade80",
  warn: "#facc15",
  critical: "#f87171",
};

const CHANNELS: { id: "peakMagnitude" | "dominantHz" | "topFaultMagnitude" | "matchCount"; label: string; unit: string }[] = [
  { id: "peakMagnitude", label: "Peak magnitude (mm/s)", unit: "mm/s" },
  { id: "dominantHz", label: "Dominant frequency (Hz)", unit: "Hz" },
  { id: "topFaultMagnitude", label: "Top fault magnitude", unit: "mm/s" },
  { id: "matchCount", label: "Bearing-signature matches", unit: "count" },
];

function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function Sparkline({ points, width, height }: { points: AnomalyPoint[]; width: number; height: number }) {
  if (points.length === 0) return null;
  const ys = points.map((p) => p.observed);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="an-sparkline">
      {points.map((p, i) => {
        const x = pad + (i / Math.max(1, points.length - 1)) * w;
        const y = pad + (1 - (p.observed - min) / span) * h;
        return <circle key={i} cx={x} cy={y} r={2.5} fill={SEVERITY_COLOUR[p.severity]} />;
      })}
    </svg>
  );
}

export default async function AnomalyPage({ searchParams }: { searchParams: Promise<{ twinId?: string; channel?: string; z?: string }> }) {
  const sp = await searchParams;
  const twins = await listTwins("");
  const twinId = sp.twinId ?? (twins[0]?.id ?? "");
  const channel = (sp.channel as "peakMagnitude" | "dominantHz" | "topFaultMagnitude" | "matchCount" | undefined) ?? "peakMagnitude";
  const z = sp.z ? Number(sp.z) : 3.0;
  const report: AnomalyReport | null = twinId ? await detectChannel(twinId, channel, z, 100) : null;

  return (
    <div className="an-page">
      <header className="an-head">
        <h1>📈 Anomaly Detection</h1>
        <p>Real anomaly detection over a digital-twin channel. The detector fits a constant model to the data, calibrates a robust sigma from the Median Absolute Deviation, and flags points whose |z-score| exceeds the threshold. The worst-z point, the model bias, and the calibrated sigma are shown so the user can audit every call.</p>
        <form className="an-form" method="get">
          <label>Twin <input type="text" name="twinId" defaultValue={twinId} list="an-twin-ids" required /></label>
          <label>Channel <select name="channel" defaultValue={channel}>
            {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select></label>
          <label>z-threshold <input type="number" name="z" min={0.5} max={10} step={0.5} defaultValue={z} /></label>
          <button type="submit">Detect</button>
        </form>
        <datalist id="an-twin-ids">{twins.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</datalist>
      </header>

      {report && (
        <>
          <section className="an-summary">
            <div className="an-card">
              <span className="an-stat-label">Worst |z|</span>
              <span className="an-stat-val">{report.worst ? fmtNum(Math.abs(report.worst.zscore), 2) : "—"}</span>
              <span className="an-stat-sub">{report.worst ? `at ${new Date(report.worst.tMs).toISOString()}` : "no points"}</span>
            </div>
            <div className="an-card">
              <span className="an-stat-label">Critical</span>
              <span className="an-stat-val" style={{ color: SEVERITY_COLOUR.critical }}>{report.counts.critical}</span>
              <span className="an-stat-sub">≥ 2× z-threshold</span>
            </div>
            <div className="an-card">
              <span className="an-stat-label">Warn</span>
              <span className="an-stat-val" style={{ color: SEVERITY_COLOUR.warn }}>{report.counts.warn}</span>
              <span className="an-stat-sub">≥ z-threshold</span>
            </div>
            <div className="an-card">
              <span className="an-stat-label">Info</span>
              <span className="an-stat-val" style={{ color: SEVERITY_COLOUR.info }}>{report.counts.info}</span>
              <span className="an-stat-sub">within ±z</span>
            </div>
            <div className="an-card">
              <span className="an-stat-label">Model bias (mean)</span>
              <span className="an-stat-val">{fmtNum(report.model.bias, 3)}</span>
              <span className="an-stat-sub">constant model on n = {report.n}</span>
            </div>
            <div className="an-card">
              <span className="an-stat-label">Sigma (MAD × 1.4826)</span>
              <span className="an-stat-val">{fmtNum(report.worst?.sigma ?? 0, 3)}</span>
              <span className="an-stat-sub">robust scale</span>
            </div>
          </section>

          <section className="an-spark-section">
            <h2>Channel: {CHANNELS.find((c) => c.id === channel)?.label}</h2>
            <Sparkline points={report.points} width={800} height={120} />
          </section>

          <section className="an-table-wrap">
            <h2>All points</h2>
            <table className="an-table">
              <thead>
                <tr><th>Time</th><th>Observed</th><th>Predicted</th><th>Residual</th><th>Sigma</th><th>z</th><th>Severity</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {report.points.map((p) => (
                  <tr key={p.tMs}>
                    <td>{new Date(p.tMs).toISOString()}</td>
                    <td>{fmtNum(p.observed, 3)}</td>
                    <td>{fmtNum(p.predicted, 3)}</td>
                    <td>{fmtNum(p.residual, 3)}</td>
                    <td>{fmtNum(p.sigma, 3)}</td>
                    <td>{fmtNum(p.zscore, 2)}</td>
                    <td style={{ color: SEVERITY_COLOUR[p.severity] }}>{p.severity}</td>
                    <td>{p.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <footer className="an-foot">
        <p>
          <Link href="/diagnostics">/diagnostics</Link>{" "}
          <Link href="/timeline">/timeline</Link>{" "}
          <Link href="/abstain">/abstain</Link>{" "}
          <Link href="/dashboard">/dashboard</Link>
        </p>
      </footer>
    </div>
  );
}
