/**
 * /fleet — Fleet Overview page.
 *
 *   Aggregates every twin in the user's fleet into a single
 *   rollup. Shows the count by health band, the worst twin, and
 *   a per-twin table. All numbers come from the production
 *   twinHealth / getHistory / checkBounds pipeline.
 */
import Link from "next/link";
import { fleetOverview, HEALTH_BAND_COLOUR, type HealthBand, type FleetTwinRow } from "@/core/fleet/overview";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bandCell(score: number) {
  if (score >= 80) return { band: "good" as HealthBand, color: HEALTH_BAND_COLOUR.good };
  if (score >= 60) return { band: "watch" as HealthBand, color: HEALTH_BAND_COLOUR.watch };
  if (score >= 30) return { band: "warning" as HealthBand, color: HEALTH_BAND_COLOUR.warning };
  return { band: "critical" as HealthBand, color: HEALTH_BAND_COLOUR.critical };
}

function fmtTime(t: number | undefined): string {
  if (!t) return "—";
  return new Date(t).toISOString();
}

export default async function FleetPage() {
  const { uid } = await getUserId({ allowAnonymous: true });
  const o = await fleetOverview(uid);
  return (
    <div className="fl-page">
      <header className="fl-head">
        <h1>🚢 Fleet Overview</h1>
        <p>Every twin in this user&apos;s fleet, with live health, last diagnostic, and overdue-maintenance count. All numbers come from the production twinHealth / getHistory / checkBounds pipeline — no fabricated values.</p>
        <div className="fl-meta">
          <span>Total: <strong>{o.total}</strong></span>
          <span>·</span>
          <span>Overdue maintenance: <strong>{o.withOverdueMaintenance}</strong></span>
          <span>·</span>
          <span>Critical diagnostics: <strong>{o.withCriticalDiagnostic}</strong></span>
          <span>·</span>
          <span>Assembled: <strong>{fmtTime(o.assembledAt)}</strong></span>
        </div>
      </header>

      <section className="fl-bands">
        {(["good", "watch", "warning", "critical"] as HealthBand[]).map((b) => (
          <div key={b} className="fl-band-card" style={{ borderTop: `3px solid ${HEALTH_BAND_COLOUR[b]}` }}>
            <span className="fl-band-label">{b.toUpperCase()}</span>
            <span className="fl-band-val" style={{ color: HEALTH_BAND_COLOUR[b] }}>{o.byBand[b]}</span>
            <span className="fl-band-sub">
              {b === "good" && "health ≥ 80"}
              {b === "watch" && "60 ≤ health < 80"}
              {b === "warning" && "30 ≤ health < 60"}
              {b === "critical" && "health < 30"}
            </span>
          </div>
        ))}
      </section>

      {o.worst && (
        <section className="fl-worst">
          <h2>Worst twin</h2>
          <p>
            <strong>{o.worst.twin.name}</strong> ({o.worst.twin.id}) — health <strong style={{ color: bandCell(o.worst.health).color }}>{o.worst.health}/100</strong>, {o.worst.criticalBreachCount} critical breach{o.worst.criticalBreachCount === 1 ? "" : "es"}, {o.worst.overdueMaintenance} overdue maintenance.
            {o.worst.lastDiagnostic && <span> Last diagnostic: <strong>{o.worst.lastDiagnostic.severity}</strong> at {fmtTime(o.worst.lastDiagnostic.tMs)}.</span>}
          </p>
        </section>
      )}

      <section className="fl-table-wrap">
        <h2>Twins</h2>
        {o.rows.length === 0 ? (
          <p className="hint">No twins yet. <Link href="/twins">Create one →</Link></p>
        ) : (
          <table className="fl-table">
            <thead>
              <tr>
                <th>Twin</th>
                <th>Kind</th>
                <th>Health</th>
                <th>Stale</th>
                <th>Breaches (critical)</th>
                <th>Overdue Mx</th>
                <th>Crit events / 24h</th>
                <th>Last diagnostic</th>
                <th>Last update</th>
              </tr>
            </thead>
            <tbody>
              {o.rows.map((r: FleetTwinRow) => {
                const bc = bandCell(r.health);
                return (
                  <tr key={r.twin.id}>
                    <td><Link href={`/compare?a=${r.twin.id}`}>{r.twin.name}</Link> <code>{r.twin.id}</code></td>
                    <td>{r.twin.kind}</td>
                    <td style={{ color: bc.color }}>{r.health} · {bc.band}</td>
                    <td>{r.stale ? "yes" : "no"}</td>
                    <td>{r.breachCount} ({r.criticalBreachCount})</td>
                    <td>{r.overdueMaintenance}</td>
                    <td>{r.criticalEvents24h}</td>
                    <td>{r.lastDiagnostic ? `${r.lastDiagnostic.severity} · ${r.lastDiagnostic.topFault ?? "no fault"}` : "—"}</td>
                    <td>{fmtTime(r.twin.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <footer className="fl-foot">
        <p>
          <Link href="/diagnostics">/diagnostics</Link>{" "}
          <Link href="/dashboard">/dashboard</Link>{" "}
          <Link href="/anomaly">/anomaly</Link>{" "}
          <Link href="/compare">/compare</Link>
        </p>
      </footer>
    </div>
  );
}
