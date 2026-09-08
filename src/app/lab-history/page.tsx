/**
 * /lab-history — Lab Experiment History page.
 *
 *   Server-rendered. Lists every lab run the user has done
 *   (newest first), with a per-experiment detail view. The
 *   data comes from the production 'lab-history' collection.
 */
import Link from "next/link";
import { listExperiments, summarise, type LabExperiment } from "@/core/lab/history";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_COLOUR: Record<string, string> = {
  passed: "#4ade80",
  compile_failed: "#f87171",
  test_failed: "#f87171",
  run_failed: "#f87171",
  policy_denied: "#fb923c",
  docker_unavailable: "#9ca3af",
  timeout: "#facc15",
  runtime_error: "#f87171",
};

function fmtTime(t: number): string {
  return new Date(t).toISOString().replace("T", " ").slice(0, 19);
}

export default async function LabHistoryPage({ searchParams }: { searchParams: Promise<{ id?: string; language?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId({ allowAnonymous: true });
  const exps = await listExperiments(uid, { limit: 100 });
  const summary = summarise(exps);
  const selected: LabExperiment | null = sp.id ? exps.find((e) => e.id === sp.id) ?? null : exps[0] ?? null;
  return (
    <div className="lh-page">
      <header className="lh-head">
        <h1>🧪 Lab Experiment History</h1>
        <p>Every lab run the user has performed. The page reads the production <code>lab-history</code> collection; nothing is fabricated. Newest first.</p>
        <div className="lh-meta">
          <span>Total: <strong>{summary.total}</strong></span>
          <span>·</span>
          <span>OK: <strong style={{ color: "#4ade80" }}>{summary.okCount}</strong></span>
          <span>·</span>
          <span>Failed: <strong style={{ color: "#f87171" }}>{summary.failCount}</strong></span>
          <span>·</span>
          <span>p50: <strong>{summary.durationP50} ms</strong></span>
          <span>·</span>
          <span>p95: <strong>{summary.durationP95} ms</strong></span>
        </div>
      </header>

      {exps.length === 0 ? <p className="hint">No lab experiments yet for this user. <Link href="/api/lab">Run one via /api/lab</Link></p> : (
        <section className="lh-cols">
          <div>
            <h2>Experiments</h2>
            <table className="lh-table">
              <thead>
                <tr><th>Time</th><th>Lang</th><th>Description</th><th>Status</th><th>ms</th></tr>
              </thead>
              <tbody>
                {exps.map((e) => (
                  <tr key={e.id} className={e.id === selected?.id ? "lh-current" : ""}>
                    <td><Link href={`/lab-history?id=${e.id}`}>{fmtTime(e.at)}</Link></td>
                    <td>{e.language}</td>
                    <td>{e.description}</td>
                    <td style={{ color: STATUS_COLOUR[e.stoppedBecause] ?? "var(--muted)" }}>{e.stoppedBecause}</td>
                    <td>{e.durationMs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <div>
              <h2>Detail</h2>
              <div className="lh-detail">
                <p><strong>id:</strong> <code>{selected.id}</code></p>
                <p><strong>at:</strong> {fmtTime(selected.at)}</p>
                <p><strong>language:</strong> {selected.language}</p>
                <p><strong>status:</strong> <span style={{ color: STATUS_COLOUR[selected.stoppedBecause] }}>{selected.stoppedBecause}</span> · <strong>ok:</strong> {String(selected.ok)}</p>
                <p><strong>duration:</strong> {selected.durationMs} ms</p>
                <h3>Source</h3>
                <pre className="lh-code">{selected.source}</pre>
                <h3>Output</h3>
                <pre className="lh-code">{selected.outputSnippet}</pre>
              </div>
            </div>
          )}
        </section>
      )}

      <footer className="lh-foot">
        <p>
          <Link href="/api/lab">/api/lab</Link>{" "}
          <Link href="/dashboard">/dashboard</Link>{" "}
          <Link href="/trace">/trace</Link>
        </p>
      </footer>
    </div>
  );
}
