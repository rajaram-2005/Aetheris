/**
 * /permissions-matrix — Capability × Security-level matrix.
 *
 *   Server-rendered. Renders a (category × security-level)
 *   count table from the production capability registry,
 *   plus a per-capability table. The matrix is honest: every
 *   cell is computed from the real registry.
 */
import Link from "next/link";
import { permissionMatrix, CATEGORIES, LEVELS } from "@/core/capabilities/matrix";
import type { SecurityLevel } from "@/core/capabilities/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LEVEL_COLOUR: Record<SecurityLevel, string> = {
  read_only: "#4ade80",
  safe_write: "#38bdf8",
  full_workspace: "#facc15",
  admin: "#fb923c",
  physical: "#f87171",
};

function heatColour(n: number, max: number): string {
  if (n === 0 || max === 0) return "transparent";
  const t = n / max;
  // Interpolate from a faint blue to a deeper blue.
  const a = 0.1 + 0.6 * t;
  return `rgba(56, 189, 248, ${a.toFixed(2)})`;
}

export default async function PermissionsMatrixPage() {
  const m = await permissionMatrix();
  const maxCell = LEVELS.reduce((mx, l) => Math.max(mx, ...CATEGORIES.map((c) => m.counts[c]?.[l] ?? 0)), 0);
  return (
    <div className="pm-page">
      <header className="pm-head">
        <h1>🗺 Capability × Permission Matrix</h1>
        <p>Counts of capabilities by (category, security_level). The matrix is computed from the live registry — every cell is a real capability card. Heat colour: deeper blue = more capabilities in that cell.</p>
        <div className="pm-meta">
          <span>Total capabilities: <strong>{m.total}</strong></span>
          {LEVELS.map((l) => (
            <span key={l}>· <span style={{ color: LEVEL_COLOUR[l] }}>{l}</span>: <strong>{m.levelTotals[l] ?? 0}</strong></span>
          ))}
        </div>
      </header>

      <section className="pm-table-wrap">
        <h2>Matrix (count per cell)</h2>
        <table className="pm-table">
          <thead>
            <tr>
              <th>category \\ level</th>
              {LEVELS.map((l) => <th key={l} style={{ color: LEVEL_COLOUR[l] }}>{l}</th>)}
              <th>total</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((c) => {
              const total = m.catTotals[c] ?? 0;
              if (total === 0) return null;
              return (
                <tr key={c}>
                  <td><strong>{c}</strong></td>
                  {LEVELS.map((l) => {
                    const v = m.counts[c]?.[l] ?? 0;
                    return (
                      <td key={l} className="pm-cell" style={{ background: heatColour(v, maxCell) }}>
                        {v > 0 ? v : "—"}
                      </td>
                    );
                  })}
                  <td><strong>{total}</strong></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th>total</th>
              {LEVELS.map((l) => <th key={l} style={{ color: LEVEL_COLOUR[l] }}>{m.levelTotals[l] ?? 0}</th>)}
              <th>{m.total}</th>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="pm-table-wrap">
        <h2>All capabilities ({m.total})</h2>
        <table className="pm-list">
          <thead>
            <tr><th>ID</th><th>Name</th><th>Category</th><th>Required level</th><th>Status</th><th>Latency</th><th>Cost</th></tr>
          </thead>
          <tbody>
            {m.rows.map((cap) => (
              <tr key={cap.id}>
                <td><code>{cap.id}</code></td>
                <td>{cap.name}</td>
                <td>{cap.category}</td>
                <td style={{ color: LEVEL_COLOUR[(cap.security_level ?? "read_only") as SecurityLevel] }}>{cap.security_level ?? "read_only"}</td>
                <td>{cap.status}</td>
                <td>{cap.latency}</td>
                <td>{cap.cost?.unit ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="pm-foot">
        <p>
          <Link href="/trust">/trust</Link>{" "}
          <Link href="/autonomy">/autonomy</Link>{" "}
          <Link href="/dashboard">/dashboard</Link>
        </p>
      </footer>
    </div>
  );
}
