/**
 * /shell — Aetheris shell UI.
 *
 *   Implements the Section-5 layout from the architecture
 *   document:
 *     - left rail: the 10 cores (RAVANA / VAYU-1 / DRISHTI /
 *       YANTRA / PRAVAAH / NIRIKSHAN / CHAKRA / SMRITI /
 *       SETU / NIRNAYA), each with its build-call colour and
 *       a one-line honest-scope note
 *     - centre: 3D digital twin viewer (existing
 *       /twin-3d, embedded via iframe), with the canonical
 *       twin as the default
 *     - right rail: intelligence panel — diagnosis
 *       (NIRIKSHAN), evidence (SMRITI), uncertainty
 *       (NIRNAYA), memory, agents, simulation
 *     - bottom strip: telemetry / world-model / evidence /
 *       memory / agents / timeline
 *
 *   This is composition, not a new application. Every
 *   surface area points to a real existing module. The
 *   shell is read-side.
 */
import Link from "next/link";
import { CORES } from "@/core/orchestration/cores";
import { listTwins } from "@/core/twins/twins";
import { evidenceLedger } from "@/core/twins/evidence";
import { runtimeSummary } from "@/core/agents/runtime";
import { getUserId } from "@/lib/user";

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

export default async function ShellPage() {
  const { uid } = await getUserId({ allowAnonymous: true });
  const twins = await listTwins(uid);
  const evidence = await evidenceLedger(uid, { limit: 5 });
  const agent = await runtimeSummary(uid);
  return (
    <div className="shell-root">
      <header className="shell-topbar">
        <span className="shell-logo">AETHERIS</span>
        <span className="shell-tag">v1</span>
        <span className="shell-stats">cores: <strong>{CORES.length}</strong> · twins: <strong>{twins.length}</strong> · evidence: <strong>{evidence.total}</strong> · agent-jobs: <strong>{agent.total}</strong></span>
        <span className="shell-safe">SAFE</span>
      </header>

      <aside className="shell-rail-left">
        <h3>Core graph</h3>
        {CORES.map((c) => (
          <div key={c.id} className="shell-core">
            <span className="shell-core-id">{c.id}</span>
            <span className="shell-core-build" style={{ background: BUILD_COLOUR[c.buildCall] }}>{c.buildCall}</span>
            <Link href={c.surface.pages[0]!} className="shell-core-link">open</Link>
          </div>
        ))}
      </aside>

      <main className="shell-center">
        <h3>3D digital twin</h3>
        {twins.length > 0 ? (
          <iframe src="/twin-3d" className="shell-iframe" title="twin-3d" />
        ) : (
          <div className="shell-empty">
            <p>No twin yet.</p>
            <Link href="/twin-3d">/twin-3d</Link>
          </div>
        )}
        <div className="shell-twin-meta">
          {twins.length > 0 ? (
            <>
              <span>twin: <code>{twins[0]!.id}</code> · {twins[0]!.name}</span>
              <span>· state keys: <strong>{Object.keys(twins[0]!.state).length}</strong></span>
              <span>· bounds: <strong>{twins[0]!.bounds.length}</strong></span>
              <span>· rules: <strong>{twins[0]!.rules.length}</strong></span>
            </>
          ) : <span>nothing yet — create a twin in <Link href="/twins/edit">/twins/edit</Link></span>}
        </div>
      </main>

      <aside className="shell-rail-right">
        <h3>Intelligence</h3>
        <div className="shell-panel">
          <h4>Diagnosis</h4>
          <p>FFT, anomaly, PBNN predictions. Open <Link href="/diagnostics">/diagnostics</Link> · <Link href="/learning">/learning</Link> · <Link href="/anomaly">/anomaly</Link>.</p>
        </div>
        <div className="shell-panel">
          <h4>Evidence</h4>
          <p>{evidence.total} entries · latest at <code>{evidence.entries[0]?.at ? new Date(evidence.entries[0]!.at).toISOString().slice(0, 19) : "—"}</code></p>
          <p><Link href="/evidence">/evidence</Link></p>
        </div>
        <div className="shell-panel">
          <h4>Uncertainty</h4>
          <p>Verifier decides allow / allow-with-caveat / deny from the slice ok flags. <Link href="/fuse">/fuse</Link> · <Link href="/audit">/audit</Link></p>
        </div>
        <div className="shell-panel">
          <h4>Memory</h4>
          <p>Knowledge graph + semantic recall. <Link href="/knowledge-graph">/knowledge-graph</Link></p>
        </div>
        <div className="shell-panel">
          <h4>Agents</h4>
          <p>{agent.total} jobs · {agent.live} live. <Link href="/agents">/agents</Link></p>
        </div>
        <div className="shell-panel">
          <h4>Simulation</h4>
          <p>Counterfactual framework — model arena is the live surface. <Link href="/arena">/arena</Link> · <Link href="/world-model">/world-model</Link></p>
        </div>
      </aside>

      <nav className="shell-strip">
        <Link href="/fleet">📡 telemetry</Link>
        <Link href="/world-model">🌍 world model</Link>
        <Link href="/evidence">🔏 evidence</Link>
        <Link href="/knowledge-graph">🧠 memory</Link>
        <Link href="/agents">🤖 agents</Link>
        <Link href="/timeline">⏱ timeline</Link>
        <Link href="/warroom">🚨 war room</Link>
        <Link href="/fuse">🧠 fuse</Link>
        <Link href="/vayu">🌀 vayu</Link>
        <Link href="/cores">🧭 cores</Link>
        <Link href="/capabilities">📜 capabilities</Link>
        <Link href="/runbook">📖 runbook</Link>
      </nav>
    </div>
  );
}
