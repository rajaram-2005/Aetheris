/**
 * /learning — PBNN Prediction Graph page.
 *
 *   Server-rendered. Lists the user's learned models and
 *   renders the forecast for the chosen twin: the next N
 *   steps with a ±1.96σ band, alongside the recent history.
 *
 *   URL: /learning?twinId=…&steps=…
 */
import Link from "next/link";
import { predictNext, listLearnedModels } from "@/core/learning/predictions";
import { listTwins } from "@/core/twins/twins";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function buildPath(points: { x: number; y: number }[], width: number, height: number, padding = 4): string {
  if (points.length === 0) return "";
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1; const spanY = maxY - minY || 1;
  return points
    .map((p, i) => {
      const x = padding + ((p.x - minX) / spanX) * (width - padding * 2);
      const y = padding + (1 - (p.y - minY) / spanY) * (height - padding * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default async function LearningPage({ searchParams }: { searchParams: Promise<{ twinId?: string; steps?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId({ allowAnonymous: true });
  const twins = await listTwins(uid);
  const models = await listLearnedModels(uid);
  const twinId = sp.twinId ?? (models[0]?.twinId ?? twins[0]?.id ?? "");
  const steps = Math.min(50, Math.max(1, Number(sp.steps ?? "10")));
  const report = twinId ? await predictNext({ uid, twinId, steps }) : null;

  const allPoints = report ? [
    ...report.history.map((h, i) => ({ x: i, y: h.y })),
    ...report.forecast.map((f) => ({ x: f.step - report.history.length, y: f.yHat })),
  ] : [];

  return (
    <div className="lr-page">
      <header className="lr-head">
        <h1>🧠 PBNN Prediction Graph</h1>
        <p>Reads the production PBNN model stored in <code>learning:pbnn:&lt;twinId&gt;</code>, builds a feature vector from the twin&apos;s current state, and produces a forecast over the next N steps. The ±1.96σ band comes from the model&apos;s own noise estimate.</p>
        <form className="lr-form" method="get">
          <label>Twin <input type="text" name="twinId" defaultValue={twinId} list="lr-twin-ids" required /></label>
          <label>Steps <input type="number" name="steps" min={1} max={50} defaultValue={steps} /></label>
          <button type="submit">Forecast</button>
        </form>
        <datalist id="lr-twin-ids">
          {twins.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          {models.map((m) => <option key={m.twinId} value={m.twinId}>(model: {m.twinId})</option>)}
        </datalist>
        <div className="lr-meta">
          <span>Learned models: <strong>{models.length}</strong></span>
          {report?.model && <>
            <span>·</span>
            <span>model: <code>{report.model.kind}</code> · trained on <strong>{report.model.trainedOn}</strong> rows</span>
            <span>·</span>
            <span>recent divergence (|y - ŷ|): <strong>{report.recentDivergence === null ? "—" : report.recentDivergence.toFixed(2)}</strong></span>
          </>}
        </div>
      </header>

      {report && report.model && (
        <section className="lr-graph">
          <svg viewBox="0 0 800 240" className="lr-svg">
            {/* axes */}
            <line x1={4} y1={236} x2={796} y2={236} stroke="var(--border)" />
            <line x1={4} y1={4} x2={4} y2={236} stroke="var(--border)" />
            {/* band */}
            {report.forecast.length > 0 && (
              <path
                d={
                  buildPath(report.forecast.map((f) => ({ x: report.history.length - 1 + f.step - report.history.length + 1, y: f.hi })), 800, 240) +
                  " " +
                  buildPath([...report.forecast].reverse().map((f) => ({ x: report.history.length - 1 + f.step - report.history.length + 1, y: f.lo })), 800, 240).replace(/^M/, "L")
                }
                fill="rgba(56, 189, 248, 0.15)"
                stroke="none"
              />
            )}
            {/* history */}
            {report.history.length > 0 && (
              <path d={buildPath(report.history.map((h, i) => ({ x: i, y: h.y })), 800, 240)} fill="none" stroke="#4ade80" strokeWidth={1.5} />
            )}
            {/* forecast line */}
            {report.forecast.length > 0 && (
              <path d={buildPath(report.forecast.map((f) => ({ x: report.history.length - 1 + f.step - report.history.length + 1, y: f.yHat })), 800, 240)} fill="none" stroke="#38bdf8" strokeWidth={1.5} strokeDasharray="4,3" />
            )}
          </svg>
          <div className="lr-legend">
            <span><span className="lr-swatch" style={{ background: "#4ade80" }} /> history (peak mm/s)</span>
            <span><span className="lr-swatch" style={{ background: "#38bdf8" }} /> forecast ŷ</span>
            <span><span className="lr-swatch" style={{ background: "rgba(56, 189, 248, 0.3)" }} /> ±1.96σ band</span>
          </div>
        </section>
      )}

      <section className="lr-table-wrap">
        <h2>Learned models</h2>
        {models.length === 0 ? <p className="hint">No learned models for this user yet.</p> : (
          <table className="lr-table">
            <thead><tr><th>Twin</th><th>Features</th><th>Target</th><th>Trained on</th><th>Updated</th></tr></thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.twinId}>
                  <td><Link href={`/learning?twinId=${m.twinId}&steps=${steps}`}><code>{m.twinId}</code></Link></td>
                  <td>{m.features.join(", ")}</td>
                  <td><code>{m.target}</code></td>
                  <td>{m.trainedOn}</td>
                  <td>{new Date(m.updatedAt).toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="lr-foot">
        <p>
          <Link href="/dashboard">/dashboard</Link>{" "}
          <Link href="/anomaly">/anomaly</Link>{" "}
          <Link href="/compare">/compare</Link>
        </p>
      </footer>
    </div>
  );
}
