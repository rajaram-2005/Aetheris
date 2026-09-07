/**
 * /trust — Trust & Permissions panel.
 *
 *   Shows the 5-level permission ladder, the principal's current
 *   grants, and the per-capability allow/deny result for every
 *   registered capability card. Pure read-only — does not mutate
 *   any policy state. Backed by the production
 *   trustSummary() engine.
 */
import Link from "next/link";
import { trustSummary, LEVELS, type PermissionLevel } from "@/core/trust/summary";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LEVEL_COLOUR: Record<PermissionLevel, string> = {
  read_only: "#4ade80",
  safe_write: "#38bdf8",
  full_workspace: "#facc15",
  admin: "#fb923c",
  physical: "#f87171",
};

export default async function TrustPage() {
  const { uid } = await getUserId({ allowAnonymous: true });
  const s = await trustSummary(uid);
  return (
    <div className="tr-page">
      <header className="tr-head">
        <h1>🛡 Trust & Permissions</h1>
        <p>The 5-level permission ladder that gates every capability in Aetheris. The current principal's grants, the highest level they hold, and a per-capability allow/deny result. This page is read-only — it never mutates any policy state.</p>
        <div className="tr-meta">
          <span>uid: <code>{s.uid}</code></span>
          <span>·</span>
          <span>grants: <strong>{s.principal.grants.join(", ")}</strong></span>
          <span>·</span>
          <span>highest: <strong style={{ color: LEVEL_COLOUR[s.highestLevel] }}>{s.highestLevel}</strong></span>
          <span>·</span>
          <span>capabilities: <strong>{s.capabilitiesAllowed} allowed · {s.capabilitiesDenied} denied · {s.totalCapabilities} total</strong></span>
        </div>
      </header>

      <section className="tr-ladder">
        <h2>Permission ladder</h2>
        <ol className="tr-ladder-list">
          {LEVELS.map((def) => {
            const held = s.principal.grants.includes(def.level);
            const isHighest = def.level === s.highestLevel;
            return (
              <li key={def.level} className={"tr-ladder-item" + (held ? " held" : "") + (isHighest ? " highest" : "")}>
                <span className="tr-ladder-dot" style={{ background: LEVEL_COLOUR[def.level] }} />
                <div className="tr-ladder-body">
                  <header>
                    <strong>{def.name}</strong> <code>{def.level}</code>
                    {held && <span className="tr-held-badge">HELD</span>}
                    {isHighest && <span className="tr-highest-badge">HIGHEST</span>}
                    {def.needsConfirmation && <span className="tr-confirm-badge">CONFIRM</span>}
                  </header>
                  <p>{def.description}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="tr-table-wrap">
        <h2>Per-capability allow/deny</h2>
        <table className="tr-table">
          <thead>
            <tr>
              <th>Capability</th>
              <th>Status</th>
              <th>Required level</th>
              <th>Allowed?</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.id} className={r.allowed ? "row-allowed" : "row-denied"}>
                <td><strong>{r.name}</strong> <code>{r.id}</code></td>
                <td>{r.status}</td>
                <td style={{ color: LEVEL_COLOUR[r.required] }}>{r.required}</td>
                <td>{r.allowed ? "✓ allow" : "✗ deny"}</td>
                <td>{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="tr-foot">
        <p>
          <Link href="/autonomy">/autonomy</Link>{" "}
          <Link href="/dashboard">/dashboard</Link>{" "}
          <Link href="/warroom">/warroom</Link>
        </p>
      </footer>
    </div>
  );
}
