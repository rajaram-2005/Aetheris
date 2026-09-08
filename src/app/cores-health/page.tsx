/**
 * /cores-health — Per-core health view.
 *
 *   Reads the per-core health composer and renders the
 *   Section-3 build-call, capabilities owned, capabilities
 *   denied, the user's grants, and a missing-modules rollup
 *   per core. Pure read-side.
 */
import Link from "next/link";
import { coreHealthReport } from "@/core/orchestration/health";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUILD_COLOUR: Record<string, string> = {
  "Build now": "#4ade80",
  "Build as proxy": "#38bdf8",
  "Build initially as recommendation/optimization layer": "#facc15",
  "Build now, but don't claim": "#fb923c",
  "Build the integration now; train later": "#a78bfa",
  "Build as analytics/diagnostic engine": "#facc15",
  "Build as orchestration": "#4ade80",
};

export default async function CoresHealthPage() {
  const { uid } = await getUserId({ allowAnonymous: true });
  const r = await coreHealthReport(uid);
  return (
    <div className="ch-page">
      <header className="ch-head">
        <h1>🩺 Core Health</h1>
        <p>Live per-core health view. For each of the 10 cores: Section-3 build-call, capabilities owned, capabilities denied under your grants, and the per-core modules rollup. Read-side; never invents a connection.</p>
        <div className="ch-meta">
          <span>Total: <strong>{r.total}</strong></span>
          <span>· ok: <strong style={{ color: "#4ade80" }}>{r.ok}</strong></span>
          <span>· degraded: <strong style={{ color: "#f87171" }}>{r.degraded}</strong></span>
          <span>· user: <code>{r.uid}</code></span>
        </div>
      </header>
      <section className="ch-table-wrap">
        <table className="ch-table">
          <thead>
            <tr><th>Core</th><th>Build call</th><th>Capabilities</th><th>Denied</th><th>Modules</th><th>Missing</th></tr>
          </thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.id}>
                <td><Link href={`/cores#${row.id}`}>{row.id}</Link></td>
                <td><span className="ch-build" style={{ background: BUILD_COLOUR[row.buildCall] }}>{row.buildCall}</span></td>
                <td><strong>{row.capabilitiesOwned}</strong></td>
                <td><strong style={{ color: row.capabilitiesDenied > 0 ? "#f87171" : "#4ade80" }}>{row.capabilitiesDenied}</strong></td>
                <td>{row.modulesPresent}/{row.modulesDeclared}</td>
                <td>
                  {row.missingModules.length === 0 ? "—" : (
                    <ul className="ch-missing">
                      {row.missingModules.map((m) => <li key={m}><code>{m}</code></li>)}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <footer className="ch-foot">
        <p><Link href="/cores">/cores</Link> · <Link href="/capabilities">/capabilities</Link> · <Link href="/">/</Link></p>
      </footer>
    </div>
  );
}
