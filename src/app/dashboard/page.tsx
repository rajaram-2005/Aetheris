/**
 * /dashboard — the main landing surface.
 *
 *   Server-rendered. Renders the system-health summary from section
 *   65-66 of the original Aetheris vision: 10/10 cores status, mesh
 *   status (providers / readiness), recent diagnostic events, active
 *   assets, capabilities, and quick links to the deep pages.
 *
 *   No fake animations, no fabricated numbers. The data is whatever
 *   the underlying modules return: meshStatus() for the LLM mesh,
 *   getHistory() for diagnostics, listTwins() for assets,
 *   bootCapabilities() for the capability registry.
 */
import Link from "next/link";
import { meshStatus } from "@/lib/router/router";
import { bootCapabilities } from "@/core/capabilities/sources";
import { allCapabilities } from "@/core/capabilities/registry";
import { getUserId } from "@/lib/user";
import { listTwins } from "@/core/twins/twins";
import { getHistory } from "@/core/diagnostics/history";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 10 cores with stable visual identity (matches the demo / world-model pages)
const CORES: { name: string; color: string; status: "online" | "experimental" | "always-on" }[] = [
  { name: "RAVANA", color: "#a78bfa", status: "online" },
  { name: "VAYU-1", color: "#38bdf8", status: "experimental" },
  { name: "DRISHTI", color: "#60a5fa", status: "experimental" },
  { name: "YANTRA", color: "#2dd4bf", status: "online" },
  { name: "PRAVAAH", color: "#22d3ee", status: "online" },
  { name: "NIRIKSHAN", color: "#fb923c", status: "online" },
  { name: "CHAKRA", color: "#f59e0b", status: "online" },
  { name: "SMRITI", color: "#c084fc", status: "online" },
  { name: "SETU", color: "#3b82f6", status: "online" },
  { name: "NIRNAYA", color: "#e5e7eb", status: "online" },
];

const SEVERITY_COLORS: Record<string, string> = {
  ok: "#4ade80", watch: "#facc15", warning: "#fb923c", critical: "#f87171",
};

export default async function DashboardPage() {
  const { uid } = await getUserId();
  const mesh = meshStatus();
  const configuredProviders = mesh.filter((m) => m.configured);
  const readyProviders = mesh.filter((m) => m.configured && m.model);
  bootCapabilities();
  const caps = await allCapabilities();
  const twins = await listTwins(uid);
  const recentDiag = await getHistory("", { limit: 5 }).catch(() => []);
  const recentDebates: { id: string; motion: string; createdAt: number }[] = [];
  // Pull debates per twin if any (the engine stores per-uid).
  const allDebates = await store.all<{ uid: string; id: string; motion: string; createdAt: number }>("debates").catch(() => ({}));
  for (const d of Object.values(allDebates)) {
    if (d.uid === uid) recentDebates.push({ id: d.id, motion: d.motion, createdAt: d.createdAt });
  }
  recentDebates.sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="dash-page">
      <header className="dash-head">
        <h1>✦ Aetheris Command Center</h1>
        <p className="dash-tagline">Autonomous Engineering Intelligence · local-first · open source</p>
      </header>

      <section className="dash-section">
        <h2>10-core status</h2>
        <ul className="dash-cores">
          {CORES.map((c) => (
            <li key={c.name} className={`dash-core ${c.status}`}>
              <span className="dash-core-dot" style={{ background: c.color }} />
              <span className="dash-core-name">{c.name}</span>
              <span className="dash-core-state">{c.status === "always-on" ? "always on" : c.status}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="dash-grid">
        <article className="dash-card">
          <h3>LLM mesh</h3>
          <p><strong>{readyProviders.length}</strong> ready / <strong>{configuredProviders.length}</strong> configured / <strong>{mesh.length}</strong> total providers</p>
          <ul className="dash-mesh">
            {mesh.slice(0, 8).map((m) => (
              <li key={m.id} className={m.model ? "on" : ""}>
                <span>{m.name}</span>
                <span className="dash-mesh-state">{m.model ? "ready" : m.configured ? "key set" : "—"}</span>
              </li>
            ))}
          </ul>
          <p className="dash-link"><Link href="/api/mesh">→ inspect full mesh</Link></p>
        </article>

        <article className="dash-card">
          <h3>Active assets</h3>
          <p><strong>{twins.length}</strong> digital twin{twins.length === 1 ? "" : "s"}</p>
          <ul className="dash-twins">
            {twins.slice(0, 6).map((t) => (
              <li key={t.id}>
                <Link href={`/twin-3d?twinId=${encodeURIComponent(t.id)}`}>{t.name}</Link>
                <span className="dash-twins-kind">{t.kind}</span>
              </li>
            ))}
          </ul>
          <p className="dash-link"><Link href="/api/twins">→ list all twins</Link></p>
        </article>

        <article className="dash-card">
          <h3>Capability registry</h3>
          <p><strong>{caps.length}</strong> capability card{caps.length === 1 ? "" : "s"} registered</p>
          <ul className="dash-caps">
            {caps.slice(0, 8).map((c: { id: string; status: string }) => (
              <li key={c.id}>
                <span>{c.id}</span>
                <span className="dash-caps-status">{c.status}</span>
              </li>
            ))}
          </ul>
          <p className="dash-link"><Link href="/api/capabilities">→ inspect registry</Link></p>
        </article>

        <article className="dash-card">
          <h3>Recent diagnostics</h3>
          {recentDiag.length === 0 ? (
            <p className="hint">No diagnostic events yet. Run one to populate the timeline.</p>
          ) : (
            <ul className="dash-diag">
              {recentDiag.slice(0, 5).map((d) => (
                <li key={`${d.twinId}:${d.tMs}`}>
                  <span className="dash-diag-sev" style={{ background: SEVERITY_COLORS[d.severity], color: "#0b0d12" }}>{d.severity.toUpperCase()}</span>
                  <span className="dash-diag-meta">{d.twinId} · {new Date(d.tMs).toISOString().slice(0, 16).replace("T", " ")} · {d.peakMagnitude.toFixed(1)} mm/s</span>
                </li>
              ))}
            </ul>
          )}
          <p className="dash-link"><Link href="/diagnostics">→ open diagnostics</Link> · <Link href="/timeline">→ timeline</Link></p>
        </article>

        <article className="dash-card">
          <h3>War Room</h3>
          {recentDebates.length === 0 ? (
            <p className="hint">No debates yet. Start one at <Link href="/warroom">/warroom</Link>.</p>
          ) : (
            <ul className="dash-debates">
              {recentDebates.slice(0, 5).map((d) => (
                <li key={d.id}>
                  <Link href={`/warroom?id=${encodeURIComponent(d.id)}`}>{d.motion.length > 80 ? d.motion.slice(0, 80) + "…" : d.motion}</Link>
                </li>
              ))}
            </ul>
          )}
          <p className="dash-link"><Link href="/warroom">→ open war room</Link></p>
        </article>

        <article className="dash-card">
          <h3>Quick links</h3>
          <ul className="dash-quick">
            <li><Link href="/demo">🌪️ WTG-04 signature demo</Link></li>
            <li><Link href="/world-model">🧠 World model (counterfactual)</Link></li>
            <li><Link href="/timeline">⏱️ Timeline / causal replay</Link></li>
            <li><Link href="/diagnostics">📊 Diagnostics panel</Link></li>
            <li><Link href="/twin-3d">🌀 Twin viewer 3D</Link></li>
            <li><Link href="/warroom">🥊 War room</Link></li>
            <li><Link href="/api/capabilities">⚙️ Capability registry</Link></li>
            <li><Link href="/api/mesh">🌐 LLM mesh status</Link></li>
          </ul>
        </article>
      </section>
    </div>
  );
}
