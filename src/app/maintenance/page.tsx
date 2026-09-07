/**
 * /maintenance — Maintenance Dispatch page.
 *
 *   Shows the prioritised dispatch list for the user's fleet.
 *   Every row is grounded in the production twin state, the
 *   diagnostic history, and the user's own maintenance notes —
 *   no fabricated tasks.
 *
 *   URL: /maintenance
 */
import Link from "next/link";
import { dispatchList, type DispatchPriority } from "@/core/maintenance/dispatch";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIORITY_COLOUR: Record<DispatchPriority, string> = {
  CRITICAL: "#f87171",
  HIGH: "#fb923c",
  MEDIUM: "#facc15",
  LOW: "#4ade80",
};

function fmtRelative(t: number | null): string {
  if (t === null) return "—";
  const days = Math.round(t / 86_400_000);
  if (days < 0) return `${-days} day${-days === 1 ? "" : "s"} overdue`;
  if (days === 0) return "due today";
  return `due in ${days} day${days === 1 ? "" : "s"}`;
}

export default async function MaintenancePage() {
  const { uid } = await getUserId({ allowAnonymous: true });
  const r = await dispatchList(uid);
  return (
    <div className="mx-page">
      <header className="mx-head">
        <h1>🔧 Maintenance Dispatch</h1>
        <p>Prioritised dispatch list for the user's fleet. Every row is grounded in the production twin state, diagnostic history, and the user's own maintenance notes. The engine never invents a maintenance task — it only composes the ones the user has declared.</p>
        <div className="mx-meta">
          <span>Total: <strong>{r.total}</strong></span>
          {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as DispatchPriority[]).map((p) => (
            <span key={p}>· <span style={{ color: PRIORITY_COLOUR[p] }}>{p}</span>: <strong>{r.byPriority[p]}</strong></span>
          ))}
        </div>
      </header>

      <section className="mx-table-wrap">
        {r.rows.length === 0 ? (
          <p className="hint">No twins yet. <Link href="/twins">Create one →</Link></p>
        ) : (
          <table className="mx-table">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Twin</th>
                <th>Action</th>
                <th>Reason</th>
                <th>Maintenance</th>
                <th>Last diagnostic</th>
                <th>Breaches (crit)</th>
                <th>Next due</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row) => (
                <tr key={row.twinId} className={`mx-row mx-priority-${row.priority.toLowerCase()}`}>
                  <td style={{ color: PRIORITY_COLOUR[row.priority], fontWeight: 700 }}>{row.priority}</td>
                  <td><Link href={`/compare?a=${row.twinId}`}>{row.twinName}</Link> <code>{row.twinId}</code></td>
                  <td>{row.action}</td>
                  <td>{row.reason}</td>
                  <td>{row.maintenanceNote ?? "—"}</td>
                  <td>{row.lastDiagnostic ? `${row.lastDiagnostic.severity} · ${row.lastDiagnostic.topFault ?? "no fault"}` : "—"}</td>
                  <td>{row.boundBreaches.total} ({row.boundBreaches.critical})</td>
                  <td>{fmtRelative(row.nextDueIn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="mx-foot">
        <p>
          <Link href="/fleet">/fleet</Link>{" "}
          <Link href="/diagnostics">/diagnostics</Link>{" "}
          <Link href="/timeline">/timeline</Link>
        </p>
      </footer>
    </div>
  );
}
