/**
 * /tasks — Operator tasks.
 *
 *   Server-rendered view of every maintenance entry
 *   across the user's fleet, partitioned into "open" and
 *   "done" by the `doneAt` field. The page is the
 *   operator's to-do list for the same data that drives
 *   /maintenance and /maintenance-calendar.
 *
 *   Open rows expose a "Mark done" action that goes
 *   through the standard safe_write + confirmation gate
 *   (mirroring /api/maintenance/dispatch). On success
 *   the row moves from "open" to "done" on the next
 *   page load.
 *
 *   Nothing here is fabricated. Every row is grounded in
 *   a real maintenance entry that the user has declared
 *   on a real twin.
 */
import Link from "next/link";
import { taskList, type TaskRow } from "@/core/maintenance/tasks";
import { getUserId } from "@/lib/user";
import TaskCloseButton from "@/components/TaskCloseButton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fmtDate(t: number | null): string {
  if (t === null) return "—";
  return new Date(t).toISOString().slice(0, 10);
}

function fmtRelativeDays(d: number | null): string {
  if (d === null) return "—";
  if (d < 0) return `${-d} day${-d === 1 ? "" : "s"} overdue`;
  if (d === 0) return "due today";
  return `due in ${d} day${d === 1 ? "" : "s"}`;
}

function fmtAge(d: number): string {
  if (d <= 0) return "today";
  if (d === 1) return "1 day old";
  return `${d} days old`;
}

const OVERDUE_COLOUR = "#f87171";
const SOON_COLOUR = "#fb923c";
const LATER_COLOUR = "#4ade80";
const DONE_COLOUR = "#9ca3af";

function dueColour(d: number | null): string {
  if (d === null) return LATER_COLOUR;
  if (d < 0) return OVERDUE_COLOUR;
  if (d <= 7) return SOON_COLOUR;
  return LATER_COLOUR;
}

export default async function TasksPage() {
  const { uid } = await getUserId({ allowAnonymous: true });
  const r = await taskList(uid);

  return (
    <div className="tasks-page">
      <header className="tasks-head">
        <h1>📝 Operator Tasks</h1>
        <p>
          Every maintenance entry across your fleet, partitioned into <strong>open</strong> and <strong>done</strong>.
          This is the operator-facing to-do view of the same data that drives <Link href="/maintenance">/maintenance</Link> and <Link href="/maintenance-calendar">/maintenance-calendar</Link>.
          {" "}No tasks are invented here — every row is grounded in a maintenance entry you declared on a real twin.
          Closing a task stamps <code>doneAt</code> on the entry, removes it from the dispatch list, and writes a <code>maintenance-close</code> event to the audit log.
        </p>
        <div className="tasks-meta">
          <span>Open: <strong>{r.open.length}</strong></span>
          <span>· Done: <strong>{r.done.length}</strong></span>
          <span>· Total: <strong>{r.total}</strong></span>
          <span>· Updated: <strong>{fmtDate(r.generatedAt)}</strong></span>
        </div>
      </header>

      <section className="tasks-section">
        <h2>Open</h2>
        {r.open.length === 0 ? (
          <p className="hint">No open tasks. <Link href="/twins/edit">Add a maintenance entry →</Link></p>
        ) : (
          <table className="tasks-table">
            <thead>
              <tr>
                <th>Twin</th>
                <th>Note</th>
                <th>Logged</th>
                <th>Next due</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {r.open.map((t) => (
                <tr key={t.id} className={t.overdue ? "tasks-row tasks-row-overdue" : "tasks-row"}>
                  <td><Link href={`/maintenance?twinId=${t.twinId}`}>{t.twinName}</Link> <code>{t.twinId}</code></td>
                  <td>{t.note}</td>
                  <td>{fmtDate(t.at)}</td>
                  <td>{fmtDate(t.nextDue)}</td>
                  <td style={{ color: dueColour(t.daysUntilDue) }}>{fmtRelativeDays(t.daysUntilDue)}</td>
                  <td>
                    <TaskCloseButton twinId={t.twinId} at={t.at} twinName={t.twinName} note={t.note} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="tasks-section">
        <h2>Done</h2>
        {r.done.length === 0 ? (
          <p className="hint">No completed tasks yet.</p>
        ) : (
          <table className="tasks-table">
            <thead>
              <tr>
                <th>Twin</th>
                <th>Note</th>
                <th>Logged</th>
                <th>Closed</th>
                <th>Close note</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {r.done.map((t) => (
                <tr key={t.id} className="tasks-row tasks-row-done">
                  <td><Link href={`/maintenance?twinId=${t.twinId}`}>{t.twinName}</Link> <code>{t.twinId}</code></td>
                  <td>{t.note}</td>
                  <td>{fmtDate(t.at)}</td>
                  <td style={{ color: DONE_COLOUR }}>{fmtDate(t.doneAt)}</td>
                  <td>{t.doneNote ?? "—"}</td>
                  <td>{fmtAge(t.daysOld)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="tasks-foot">
        <p>
          <Link href="/maintenance">/maintenance</Link>{" "}
          <Link href="/maintenance-calendar">/maintenance-calendar</Link>{" "}
          <Link href="/audit">/audit</Link>
        </p>
        <p className="hint">
          Tasks are scoped to a single user. Capability <code>maintenance:close</code> at <code>safe_write</code> with a single-use confirmation token. Closed entries are excluded from the dispatch list and the maintenance calendar's "overdue" bucket.
        </p>
      </footer>
    </div>
  );
}

// re-export TaskRow to silence "unused" lint if needed
export type { TaskRow };
