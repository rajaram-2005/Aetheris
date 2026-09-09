/**
 * /capabilities — Honest Capabilities Statement.
 *
 *   A written page in the architecture document's voice.
 *   Each of the 10 cores gets a one-paragraph
 *   "what it does today" / "what it does not yet do"
 *   statement. Pure read-side. No fabrication.
 */
import Link from "next/link";
import { CORES } from "@/core/orchestration/cores";

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

export default function CapabilitiesPage() {
  return (
    <div className="cap-page">
      <header className="cap-head">
        <h1>📜 Honest Capabilities Statement</h1>
        <p>A written page in the architecture document's voice. Each of the 10 cores gets a one-paragraph "what it does today" / "what it does not yet do" statement, drawn from the same source as the <Link href="/cores">/cores</Link> registry. This is what Aetheris can legitimately say today. It is not what Aetheris will one day claim.</p>
      </header>

      <section className="cap-section">
        <h2>The boundary Aetheris can keep</h2>
        <p>Aetheris can legitimately say: <em>"This system can analyze, simulate, orchestrate, retrieve, reason, visualize, verify, and recommend."</em> It should not yet say: <em>"This is AGI," "This predicts all turbine failures," "This understands physics like a human engineer,"</em> or <em>"This autonomously controls real turbines safely."</em> Those are claims we would need experimental evidence to earn.</p>
      </section>

      <section className="cap-grid">
        {CORES.map((c) => (
          <article key={c.id} className="cap-card">
            <header className="cap-card-head">
              <h3>{c.id}</h3>
              <span className="cap-build" style={{ background: BUILD_COLOUR[c.buildCall] }}>{c.buildCall}</span>
            </header>
            <p className="cap-role">{c.role}</p>
            <div className="cap-row">
              <span className="cap-row-label">Can do today</span>
              <p>{c.canDo}</p>
            </div>
            <div className="cap-row">
              <span className="cap-row-label">Does not yet</span>
              <p>{c.cannotDo}</p>
            </div>
            <div className="cap-row">
              <span className="cap-row-label">Surface</span>
              <p>
                Pages: {c.surface.pages.map((p, i) => <span key={p}>{i > 0 && ", "}<Link href={p}>{p}</Link></span>)}
                <br />
                APIs: {c.surface.apis.map((a) => <code key={a}>{a}</code>).reduce((acc, el, i) => i === 0 ? [el] : [...acc, ", ", el], [] as React.ReactNode[])}
              </p>
            </div>
          </article>
        ))}
      </section>

      <section className="cap-section">
        <h2>What the architecture document labels as not buildable yet</h2>
        <ul className="cap-cant">
          <li>A genuinely trained VAYU-1 foundation model — would require a large licensed wind/aerodynamics dataset + training infrastructure + evaluation.</li>
          <li>A validated general causal world model — would require real system trajectories, intervention/outcome pairs, physical models, calibration and validation experiments.</li>
          <li>Real-time turbine fault diagnosis at production accuracy — would require real SCADA/vibration/temperature histories with confirmed failures and maintenance outcomes.</li>
          <li>Accurate remaining-useful-life prediction — would require longitudinal failure/degradation datasets with ground truth.</li>
          <li>Autonomous physical turbine control — would require actual controllable equipment, safety interlocks, HIL/simulation, commissioning and certification processes.</li>
          <li>A proprietary AGI-level reasoning model — would require major model-training effort, datasets, compute, evaluations, and research.</li>
          <li>Self-created industrial drivers that work on unknown hardware — would require protocol specifications, device access, test fixtures, and validation environments.</li>
          <li>Engineering-grade digital-twin simulation — would require validated geometry/material models, boundary conditions, calibration data, and domain solvers.</li>
          <li>Claims of real-world safety/operational superiority — would require controlled experiments, benchmark datasets, field trials, and independent validation.</li>
        </ul>
      </section>

      <footer className="cap-foot">
        <p><Link href="/runbook">/runbook</Link> · <Link href="/cores">/cores</Link> · <Link href="/">/</Link></p>
      </footer>
    </div>
  );
}
