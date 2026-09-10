/**
 * /trace — Reasoning Trace viewer.
 *
 *   Server-rendered. Reads the production observability log
 *   for the user and renders it as a reasoning trace: per
 *   capability (agent, twin, tool, …), the steps with their
 *   latency, ok/err status, and detail. Newest first.
 *
 *   URL: /trace?limit=…&since=…
 */
import Link from "next/link";
import { traceReport } from "@/core/observability/trace";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fmtTime(t: number): string {
  return new Date(t).toISOString().replace("T", " ").slice(0, 19);
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export default async function TracePage({ searchParams }: { searchParams: Promise<{ limit?: string; since?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId({ allowAnonymous: true });
  const limit = Math.min(500, Math.max(10, Number(sp.limit ?? "100")));
  const sinceMs = sp.since ? Number(sp.since) : Date.now() - 24 * 60 * 60_000;
  const r = traceReport(uid, { limit, sinceMs });
  return (
    <div className="trc-page">
      <header className="trc-head">
        <h1>🧵 Reasoning Trace</h1>
        <p>The production observability log, read as a reasoning trace. Every step is a real (capability, ok, ms, detail) tuple from the agent&apos;s work. Nothing is invented.</p>
        <form className="trc-form" method="get">
          <label>Limit <input type="number" name="limit" min={10} max={500} defaultValue={limit} /></label>
          <label>Since (ms) <input type="number" name="since" min={0} defaultValue={sinceMs} /></label>
          <button type="submit">Refresh</button>
        </form>
        <div className="trc-meta">
          <span>Total: <strong>{r.total}</strong></span>
          <span>·</span>
          <span>OK: <strong style={{ color: "#4ade80" }}>{r.okCount}</strong></span>
          <span>·</span>
          <span>Failed: <strong style={{ color: "#f87171" }}>{r.failCount}</strong></span>
          <span>·</span>
          <span>Total time: <strong>{fmtMs(r.totalMs)}</strong></span>
          <span>·</span>
          <span>Span: <strong>{fmtMs(r.spanMs)}</strong></span>
        </div>
      </header>

      <section className="trc-groups">
        <h2>By capability</h2>
        {r.groups.length === 0 ? <p className="hint">No events in the selected window.</p> : (
          r.groups.map((g) => (
            <article key={g.capability} className="trc-group">
              <header className="trc-group-head">
                <strong>{g.capability}</strong>
                <span>{g.steps.length} step{g.steps.length === 1 ? "" : "s"}</span>
                <span>·</span>
                <span>OK: <strong style={{ color: "#4ade80" }}>{g.okCount}</strong></span>
                <span>·</span>
                <span>Fail: <strong style={{ color: "#f87171" }}>{g.failCount}</strong></span>
                <span>·</span>
                <span>{fmtMs(g.totalMs)}</span>
              </header>
              <ol className="trc-steps">
                {g.steps.map((s) => (
                  <li key={s.id} className={`trc-step ${s.ok ? "ok" : "err"}`}>
                    <span className="trc-step-time">{fmtTime(s.at)}</span>
                    <span className="trc-step-cap"><code>{s.capability}</code></span>
                    <span className="trc-step-type">{s.type}</span>
                    <span className="trc-step-ms">{fmtMs(s.ms)}</span>
                    {s.detail && <span className="trc-step-detail">{s.detail}</span>}
                  </li>
                ))}
              </ol>
            </article>
          ))
        )}
      </section>

      <footer className="trc-foot">
        <p>
          <Link href="/dashboard">/dashboard</Link>{" "}
          <Link href="/audit">/audit</Link>{" "}
          <Link href="/telemetry">/telemetry</Link>
        </p>
      </footer>
    </div>
  );
}
