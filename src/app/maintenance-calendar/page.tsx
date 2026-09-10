/**
 * /maintenance-calendar — Maintenance Calendar page.
 *
 *   Server-rendered. Lists every maintenance entry across the
 *   user's fleet, bucketed by overdue / this week / this month
 *   / later / no-due-date, plus a forward 90-day projection.
 */
import Link from "next/link";
import { maintenanceCalendar } from "@/core/maintenance/calendar";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET_COLOUR: Record<string, string> = {
  overdue: "#f87171",
  today: "#facc15",
  this_week: "#facc15",
  this_month: "#fb923c",
  later: "#38bdf8",
  no_due_date: "#9ca3af",
};

function fmtDay(s: string): string { return s; }

export default async function MaintenanceCalendarPage() {
  const { uid } = await getUserId({ allowAnonymous: true });
  const r = await maintenanceCalendar(uid);
  return (
    <div className="mc-page">
      <header className="mc-head">
        <h1>📅 Maintenance Calendar</h1>
        <p>Every maintenance entry across the user&apos;s fleet, plus a forward 90-day projection of next-due dates. The data comes from the production <code>maintenance</code> array on each twin — nothing is fabricated.</p>
        <div className="mc-meta">
          <span>Total: <strong>{r.total}</strong></span>
          {(["overdue", "thisWeek", "thisMonth", "later", "noDueDate"] as const).map((b) => (
            <span key={b}>· <span style={{ color: BUCKET_COLOUR[b === "thisWeek" ? "this_week" : b === "thisMonth" ? "this_month" : b === "noDueDate" ? "no_due_date" : b] }}>{b.replace(/([A-Z])/g, " $1").toLowerCase().replace("_", " ")}</span>: <strong>{r[b]}</strong></span>
          ))}
        </div>
      </header>

      {r.entries.length === 0 ? <p className="hint">No maintenance entries for this user&apos;s fleet yet. <Link href="/twins/edit">Add one →</Link></p> : (
        <>
          <section className="mc-entries">
            <h2>Entries (sorted by next-due)</h2>
            <table className="mc-table">
              <thead>
                <tr><th>Twin</th><th>Note</th><th>Logged at</th><th>Next due</th><th>Days</th><th>Bucket</th></tr>
              </thead>
              <tbody>
                {r.entries.map((e, i) => (
                  <tr key={i}>
                    <td><Link href={`/maintenance?twinId=${e.twinId}`}>{e.twinName}</Link></td>
                    <td>{e.note}</td>
                    <td>{new Date(e.at).toISOString().slice(0, 10)}</td>
                    <td>{e.nextDue ? new Date(e.nextDue).toISOString().slice(0, 10) : "—"}</td>
                    <td>{e.daysUntilDue === null ? "—" : (e.daysUntilDue < 0 ? `${-e.daysUntilDue} d overdue` : `in ${e.daysUntilDue} d`)}</td>
                    <td style={{ color: BUCKET_COLOUR[e.bucket] }}>{e.bucket.replace("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="mc-projection">
            <h2>90-day projection</h2>
            <div className="mc-proj-grid">
              {r.projection.map((d) => (
                <div key={d.day} className={"mc-proj-day" + (d.entries.length > 0 ? " has" : "")}>
                  <span className="mc-proj-date">{fmtDay(d.day)}</span>
                  <span className="mc-proj-count">{d.entries.length}</span>
                </div>
              ))}
            </div>
            <p className="hint">Each cell is one day; the number is the count of entries due on that day. Overdue entries are placed on the first day of the window.</p>
          </section>
        </>
      )}

      <footer className="mc-foot">
        <p>
          <Link href="/maintenance">/maintenance</Link>{" "}
          <Link href="/fleet">/fleet</Link>{" "}
          <Link href="/dashboard">/dashboard</Link>
        </p>
      </footer>
    </div>
  );
}
