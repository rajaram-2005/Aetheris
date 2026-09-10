/**
 * /audit — Audit Export page.
 *
 *   Server-rendered form for the production observability
 *   log. Includes download links for both JSON and CSV, plus
 *   a preview of the most recent events.
 */
import Link from "next/link";
import { exportJsonAsync, exportCsvAsync } from "@/core/observability/audit-export";
import { getUserId } from "@/lib/user";
import type { EventType } from "@/core/observability/events";

const EVENT_TYPES: EventType[] = ["model", "agent", "tool", "mcp", "permission", "execution", "schedule", "device", "knowledge", "memory", "auth", "error"];

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fmtTime(t: number): string {
  return new Date(t).toISOString().replace("T", " ").slice(0, 19);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ type?: string; since?: string; okOnly?: string; limit?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId({ allowAnonymous: true });
  const type = (sp.type ?? "") || undefined;
  const sinceMs = sp.since ? Number(sp.since) || Math.max(0, Date.now() - Number(sp.since) * 60_000) : undefined;
  const limit = Math.min(2000, Math.max(10, Number(sp.limit ?? "100")));
  const okOnly = sp.okOnly === "1";
  const opts = { type: type as never, sinceMs, limit, okOnly };
  const j = await exportJsonAsync(uid, opts);
  const c = await exportCsvAsync(uid, opts);
  return (
    <div className="ae-page">
      <header className="ae-head">
        <h1>📤 Audit Export</h1>
        <p>Download the production observability event log for the user. Filters: type, since (minutes-ago), limit, ok-only. The CSV is RFC-4180-ish (commas and quotes escaped). Nothing is fabricated.</p>
        <form className="ae-form" method="get">
          <label>Type <select name="type" defaultValue={sp.type ?? ""}>
            <option value="">(any)</option>
            {EVENT_TYPES.map((t: EventType) => <option key={t} value={t}>{t}</option>)}
          </select></label>
          <label>Since (min ago) <input type="number" name="since" min={1} max={525_600} defaultValue={sp.since ?? ""} placeholder="leave blank for all" /></label>
          <label>Limit <input type="number" name="limit" min={10} max={2000} defaultValue={limit} /></label>
          <label><input type="checkbox" name="okOnly" value="1" defaultChecked={okOnly} /> ok only</label>
          <button type="submit">Preview</button>
        </form>
        <div className="ae-meta">
          <span>Events: <strong>{j.total}</strong></span>
          {j.events[0] && <span>· first: <code>{fmtTime(j.events[j.events.length - 1]!.at)}</code></span>}
          {j.events[0] && <span>· last: <code>{fmtTime(j.events[0]!.at)}</code></span>}
          <a className="ae-dl" href={`/api/audit-export?format=json&type=${type ?? ""}&limit=${limit}&okOnly=${okOnly ? 1 : 0}${sinceMs ? `&sinceMs=${sinceMs}` : ""}`}>⇩ JSON</a>
          <a className="ae-dl" href={`/api/audit-export?format=csv&type=${type ?? ""}&limit=${limit}&okOnly=${okOnly ? 1 : 0}${sinceMs ? `&sinceMs=${sinceMs}` : ""}`}>⇩ CSV</a>
        </div>
      </header>

      <section className="ae-table-wrap">
        <table className="ae-table">
          <thead>
            <tr><th>Time</th><th>Type</th><th>Capability</th><th>ok</th><th>ms</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {j.events.map((e) => (
              <tr key={e.id}>
                <td><code>{fmtTime(e.at)}</code></td>
                <td>{e.type}</td>
                <td><code>{e.capability ?? "—"}</code></td>
                <td className={e.ok ? "ok" : "fail"}>{e.ok ? "✓" : "✗"}</td>
                <td>{e.ms ?? ""}</td>
                <td>{e.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <details className="ae-csv">
          <summary>CSV preview ({c.rows.length} rows)</summary>
          <pre>{[c.headers.join(","), ...c.rows.map((r) => r.join(","))].slice(0, 21).join("\n")}</pre>
        </details>
      </section>

      <footer className="ae-foot">
        <p><Link href="/trace">/trace</Link> <Link href="/evidence">/evidence</Link></p>
      </footer>
    </div>
  );
}
