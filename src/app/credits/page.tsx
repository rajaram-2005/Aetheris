/**
 * /credits — Cost / Credit Ledger page.
 *
 *   Server-rendered. Shows the user's plan, today's usage, a
 *   per-kind breakdown (chat, agents, research, arena, factory,
 *   media, api), and the 30-day history of daily totals.
 *   Backed by the production `usage:<uid>` store and the
 *   planFor() function.
 *
 *   URL: /credits
 */
import Link from "next/link";
import { creditLedger, KINDS } from "@/core/credits/ledger";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fmtDay(s: string): string {
  return s;
}

function bar(value: number, max: number, colour: string) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="cr-bar-track">
      <div className="cr-bar-fill" style={{ width: `${Math.min(100, pct)}%`, background: colour }} />
    </div>
  );
}

export default async function CreditsPage() {
  const { uid } = await getUserId({ allowAnonymous: true });
  const l = await creditLedger(uid);
  const maxByKind = Math.max(1, ...KINDS.map((k) => l.today.byKind[k.kind] ?? 0));
  return (
    <div className="cr-page">
      <header className="cr-head">
        <h1>💳 Cost & Credit Ledger</h1>
        <p>Today's usage, the per-kind breakdown, and the 30-day history of daily totals. Every number comes from the production <code>usage:&lt;uid&gt;</code> store, which is updated by <code>consumeChat()</code> on every request. The page is read-only — it never mutates the ledger.</p>
        <div className="cr-meta">
          <span>Plan: <strong>{l.plan.name}</strong> ({l.plan.id})</span>
          <span>·</span>
          <span>maxModel: <code>{l.plan.maxModel}</code></span>
          <span>·</span>
          <span>daily credits: <strong>{l.plan.dailyCredits === null ? "∞" : l.plan.dailyCredits}</strong></span>
          <span>·</span>
          <span>free-for-all: <strong>{l.isFreeForAll ? "yes" : "no"}</strong></span>
        </div>
      </header>

      <section className="cr-today">
        <h2>Today ({fmtDay(l.today.day)})</h2>
        <div className="cr-stat">
          <span className="cr-stat-num">{l.today.count}</span>
          <span className="cr-stat-label">credits used</span>
        </div>
        <div className="cr-bykind">
          {KINDS.map((k) => {
            const v = l.today.byKind[k.kind] ?? 0;
            const colour = v > 0 ? "#38bdf8" : "var(--muted)";
            return (
              <div key={k.kind} className="cr-bykind-row">
                <span className="cr-bykind-label">{k.label}</span>
                <span className="cr-bykind-val">{v}</span>
                {bar(v, maxByKind, colour)}
              </div>
            );
          })}
        </div>
      </section>

      <section className="cr-history">
        <h2>Last 30 days</h2>
        <p className="cr-history-total">Total: <strong>{l.last30Total}</strong> credits</p>
        {l.history.length === 0 ? <p className="hint">No history yet.</p> : (
          <table className="cr-table">
            <thead><tr><th>Day</th><th>Count</th><th></th></tr></thead>
            <tbody>
              {[...l.history].reverse().map((row) => (
                <tr key={row.day}>
                  <td><code>{row.day}</code></td>
                  <td>{row.count}</td>
                  <td>{bar(row.count, Math.max(...l.history.map((h) => h.count), 1), "#38bdf8")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="cr-foot">
        <p>
          <Link href="/dashboard">/dashboard</Link>{" "}
          <Link href="/trust">/trust</Link>{" "}
          <Link href="/autonomy">/autonomy</Link>
        </p>
      </footer>
    </div>
  );
}
