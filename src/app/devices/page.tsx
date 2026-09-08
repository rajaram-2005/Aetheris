/**
 * /devices — Device Registry page.
 *
 *   Lists every device the user has registered: id, name, kind,
 *   adapter, address, health state, twin binding, interlocks,
 *   capabilities, last update. All data comes from the production
 *   listDevices() / getDevice() pipeline.
 *
 *   URL: /devices
 */
import Link from "next/link";
import { listDevices } from "@/core/physical/devices";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEALTH_COLOUR: Record<string, string> = {
  online: "#4ade80",
  offline: "#9ca3af",
  error: "#f87171",
  unknown: "#facc15",
};

export default async function DevicesPage() {
  const { uid } = await getUserId({ allowAnonymous: true });
  const devices = await listDevices(uid);
  const byHealth: Record<string, number> = {};
  for (const d of devices) byHealth[d.health.state] = (byHealth[d.health.state] ?? 0) + 1;
  return (
    <div className="dev-page">
      <header className="dev-head">
        <h1>🔌 Device Registry</h1>
        <p>Every device the user has registered with Aetheris. Shows adapter, address, health state, twin binding, interlocks, capabilities, and last update. The data comes from the production device registry — no fabricated values.</p>
        <div className="dev-meta">
          <span>Total: <strong>{devices.length}</strong></span>
          {Object.entries(byHealth).map(([k, v]) => (
            <span key={k}>· <span style={{ color: HEALTH_COLOUR[k] ?? "var(--muted)" }}>{k}</span>: <strong>{v}</strong></span>
          ))}
        </div>
      </header>

      <section className="dev-table-wrap">
        {devices.length === 0 ? (
          <p className="hint">No devices yet. <Link href="/twins">Register one →</Link></p>
        ) : (
          <table className="dev-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Adapter</th>
                <th>Address</th>
                <th>Health</th>
                <th>Twin</th>
                <th>Interlocks</th>
                <th>Capabilities</th>
                <th>Last update</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong> <code>{d.id}</code><br /><span className="dev-kind">{d.kind}</span></td>
                  <td>{d.adapter}</td>
                  <td><code>{d.address}</code></td>
                  <td style={{ color: HEALTH_COLOUR[d.health.state] ?? "var(--muted)" }}>
                    {d.health.state}
                    {d.health.lastError && <div className="dev-err">{d.health.lastError}</div>}
                  </td>
                  <td>{d.twinId ? <Link href={`/compare?a=${d.twinId}`}><code>{d.twinId}</code></Link> : "—"}</td>
                  <td>{d.interlocks.length === 0 ? "—" : d.interlocks.join(", ")}</td>
                  <td>{d.capabilities.length === 0 ? "—" : d.capabilities.join(", ")}</td>
                  <td>{new Date(d.updatedAt).toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="dev-foot">
        <p>
          <Link href="/fleet">/fleet</Link>{" "}
          <Link href="/diagnostics">/diagnostics</Link>{" "}
          <Link href="/dashboard">/dashboard</Link>
        </p>
      </footer>
    </div>
  );
}
