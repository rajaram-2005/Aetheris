/**
 * /fusion-trace — Fusion observability page.
 *
 *   Reads the fusion-runs collection and the
 *   observability log entries with capability =
 *   'fusion:orchestrate'. Surfaces the latest fusion
 *   calls, the decision distribution, and the mode
 *   distribution. Pure read-side.
 */
import Link from "next/link";
import { fusionTrace, type FusionRun } from "@/core/orchestration/trace";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fmtTime(t: number): string {
  return new Date(t).toISOString().replace("T", " ").slice(0, 19);
}

const DECISION_COLOUR: Record<FusionRun["decision"], string> = {
  allow: "#4ade80",
  "allow-with-caveat": "#facc15",
  deny: "#f87171",
};

export default async function FusionTracePage({ searchParams }: { searchParams: Promise<{ limit?: string; sinceMin?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId({ allowAnonymous: true });
  const limit = Math.min(500, Math.max(10, Number(sp.limit ?? "50")));
  const sinceMs = sp.sinceMin ? Math.max(0, Date.now() - Number(sp.sinceMin) * 60_000) : 0;
  const t = await fusionTrace(uid, { limit, sinceMs });
  return (
    <div className="ft-page">
      <header className="ft-head">
        <h1>🧠 Fusion Trace</h1>
        <p>Every recorded <code>fusion:orchestrate</code> call. The composer reads the <code>fusion-runs</code> collection (audit row per call) and the observability log entries with capability <code>fusion:orchestrate</code>. Pure read-side. The full per-event timeline is at <Link href="/trace">/trace</Link>.</p>
        <form className="ft-form" method="get">
          <label>Limit <input type="number" name="limit" min={10} max={500} defaultValue={limit} /></label>
          <label>Since (min ago) <input type="number" name="sinceMin" min={1} max={525_600} defaultValue={sp.sinceMin ?? ""} placeholder="leave blank for all" /></label>
          <button type="submit">Filter</button>
        </form>
        <div className="ft-meta">
          <span>Runs: <strong>{t.total}</strong></span>
          <span>· allow: <strong style={{ color: DECISION_COLOUR.allow }}>{t.byDecision.allow}</strong></span>
          <span>· caveat: <strong style={{ color: DECISION_COLOUR["allow-with-caveat"] }}>{t.byDecision["allow-with-caveat"]}</strong></span>
          <span>· deny: <strong style={{ color: DECISION_COLOUR.deny }}>{t.byDecision.deny}</strong></span>
          <span>· live: <strong>{t.byMode.live}</strong></span>
          <span>· demo-seed: <strong>{t.byMode["demo-seed"]}</strong></span>
        </div>
      </header>

      <section className="ft-table-wrap">
        <table className="ft-table">
          <thead>
            <tr><th>Time</th><th>Mode</th><th>Question</th><th>Decision</th><th>Uncertainty</th></tr>
          </thead>
          <tbody>
            {t.runs.map((r) => (
              <tr key={`${r.at}:${r.uid}`}>
                <td><code>{fmtTime(r.at)}</code></td>
                <td>{r.mode}</td>
                <td>{r.question}</td>
                <td style={{ color: DECISION_COLOUR[r.decision] }}>{r.decision}</td>
                <td><code>{r.uncertainty.toFixed(2)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="ft-events">
        <h2>Observability events</h2>
        <table className="ft-table">
          <thead>
            <tr><th>Time</th><th>Type</th><th>Capability</th><th>ok</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {t.events.slice(0, 20).map((e) => (
              <tr key={e.id}>
                <td><code>{fmtTime(e.at)}</code></td>
                <td>{e.type}</td>
                <td><code>{e.capability ?? "—"}</code></td>
                <td className={e.ok ? "ok" : "fail"}>{e.ok ? "✓" : "✗"}</td>
                <td>{e.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="ft-foot">
        <p><Link href="/fuse">/fuse</Link> · <Link href="/trace">/trace</Link> · <Link href="/audit">/audit</Link></p>
      </footer>
    </div>
  );
}
