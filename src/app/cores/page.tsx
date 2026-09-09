/**
 * /cores — Core Registry page.
 *
 *   Reads the inventory from @/core/orchestration/cores and
 *   renders the 10 cores with their role, honest-scope call,
 *   can/cannot statement, and surface (pages + APIs + modules).
 *   Pure read-side. No fabrication.
 */
import Link from "next/link";
import { CORES, coreHealth } from "@/core/orchestration/cores";

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

const STATUS_COLOUR: Record<string, string> = { live: "#4ade80", scaffolded: "#facc15", degraded: "#f87171" };

export default function CoresPage() {
  const health = coreHealth();
  const healthById = new Map(health.map((h) => [h.id, h] as const));
  return (
    <div className="cores-page">
      <header className="cores-head">
        <h1>🧭 Cores</h1>
        <p>The 10 cores named in the Aetheris v1 architecture. Each entry is honest about what it can do today, what it does not yet do, and where its source code lives. This page is a read; nothing is fabricated.</p>
        <div className="cores-legend">
          {Object.entries(BUILD_COLOUR).map(([k, v]) => (
            <span key={k}><span className="dot" style={{ background: v }} /> {k}</span>
          ))}
        </div>
      </header>

      <section className="cores-grid">
        {CORES.map((c) => {
          const h = healthById.get(c.id)!;
          return (
            <article key={c.id} className="core-card">
              <header className="core-card-head">
                <h2>{c.id}</h2>
                <span className="core-build" style={{ background: BUILD_COLOUR[c.buildCall] }}>{c.buildCall}</span>
                <span className="core-status" style={{ color: STATUS_COLOUR[h.status] }}>● {h.status}</span>
              </header>
              <p className="core-role">{c.role}</p>
              <div className="core-row">
                <span className="core-row-label">Can do today</span>
                <p>{c.canDo}</p>
              </div>
              <div className="core-row">
                <span className="core-row-label">Does not yet</span>
                <p>{c.cannotDo}</p>
              </div>
              <div className="core-surface">
                <div className="core-surface-block">
                  <span className="core-row-label">Pages</span>
                  <ul>{c.surface.pages.map((p) => <li key={p}><Link href={p}>{p}</Link></li>)}</ul>
                </div>
                <div className="core-surface-block">
                  <span className="core-row-label">APIs</span>
                  <ul>{c.surface.apis.map((p) => <li key={p}><code>{p}</code></li>)}</ul>
                </div>
                <div className="core-surface-block">
                  <span className="core-row-label">Modules</span>
                  <ul>{c.surface.modules.map((m) => <li key={m}><code>{m}</code></li>)}</ul>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <footer className="cores-foot">
        <p><Link href="/capabilities">/capabilities</Link> · <Link href="/runbook">/runbook</Link> · <Link href="/">/</Link></p>
      </footer>
    </div>
  );
}
