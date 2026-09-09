/**
 * /evidence — Evidence Ledger page.
 *
 *   Server-rendered. Shows every evidence entry across the
 *   user's fleet: twin.events, diagnostic history, and system
 *   events. Newest-first. Filterable by twin and source.
 */
import Link from "next/link";
import { evidenceLedger, type EvidenceSource } from "@/core/twins/evidence";
import { getUserId } from "@/lib/user";
import { listTwins } from "@/core/twins/twins";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOURCE_COLOUR: Record<EvidenceSource, string> = {
  "twin-event": "#38bdf8",
  "diagnostic": "#facc15",
  "system-event": "#9ca3af",
};

function fmtTime(t: number): string {
  return new Date(t).toISOString().replace("T", " ").slice(0, 19);
}

export default async function EvidencePage({ searchParams }: { searchParams: Promise<{ twinId?: string; source?: string; limit?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId({ allowAnonymous: true });
  const twins = await listTwins(uid);
  const source = sp.source as EvidenceSource | undefined;
  const limit = Math.min(500, Math.max(10, Number(sp.limit ?? "100")));
  const r = await evidenceLedger(uid, { twinId: sp.twinId, source, limit });
  return (
    <div className="ev-page">
      <header className="ev-head">
        <h1>🔏 Evidence Ledger</h1>
        <p>Append-only evidence view across the user's fleet: every twin.events entry, every diagnostic-history row, and every system event. Newest-first. The ledger is a read; it never writes.</p>
        <form className="ev-form" method="get">
          <label>Twin <select name="twinId" defaultValue={sp.twinId ?? ""}>
            <option value="">(all)</option>
            {twins.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
          <label>Source <select name="source" defaultValue={sp.source ?? ""}>
            <option value="">(all)</option>
            <option value="twin-event">twin-event</option>
            <option value="diagnostic">diagnostic</option>
            <option value="system-event">system-event</option>
          </select></label>
          <label>Limit <input type="number" name="limit" min={10} max={500} defaultValue={limit} /></label>
          <button type="submit">Filter</button>
        </form>
        <div className="ev-meta">
          <span>Total: <strong>{r.total}</strong></span>
          {(["twin-event", "diagnostic", "system-event"] as EvidenceSource[]).map((s) => (
            <span key={s}>· <span style={{ color: SOURCE_COLOUR[s] }}>{s}</span>: <strong>{r.bySource[s]}</strong></span>
          ))}
        </div>
      </header>

      <section className="ev-table-wrap">
        <table className="ev-table">
          <thead>
            <tr><th>Time</th><th>Source</th><th>Twin</th><th>Kind</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {r.entries.map((e) => (
              <tr key={e.id}>
                <td><code>{fmtTime(e.at)}</code></td>
                <td style={{ color: SOURCE_COLOUR[e.source] }}>{e.source}</td>
                <td>{e.twinId ? <Link href={`/evidence?twinId=${e.twinId}`}><code>{e.twinId}</code></Link> : "—"}</td>
                <td>{e.kind}</td>
                <td>{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="ev-foot">
        <p>
          <Link href="/trace">/trace</Link>{" "}
          <Link href="/audit">/audit</Link>{" "}
          <Link href="/fleet">/fleet</Link>
        </p>
      </footer>
    </div>
  );
}
