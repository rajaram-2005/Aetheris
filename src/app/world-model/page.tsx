/**
 * /world-model — the counterfactual "What if?" surface.
 *
 *   Server-rendered. Runs 4 standard scenarios against the canonical
 *   WTG-04 state and lays them out side-by-side: per-scenario sparkline
 *   for vibration + temperature, predicted final state, first critical
 *   breach, and the recommended "best" scenario. The numbers come from
 *   the same simulator that powers the diagnostics page; the divergence
 *   between scenarios is real, not animated.
 *
 *   URL: /world-model
 *   Renders: header + scenario grid + bottom-line "best strategy" card.
 *   Honest: this uses the first-order linearised simulator, not CFD/FEA.
 */
import { runWorldModel, sparklinePath, type ScenarioResult } from "@/core/worldmodel/counterfactual";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function WorldModelPage({ searchParams }: { searchParams: Promise<{ horizon?: string }> }) {
  const sp = await searchParams;
  const horizon = Math.max(1, Math.min(60, Number(sp.horizon ?? 12)));
  const r = runWorldModel({ twinId: "wtg-04", twinName: "WTG-04", horizonSteps: horizon });

  return (
    <div className="wm-page">
      <header className="wm-head">
        <h1>🧠 World Model · What if?</h1>
        <p>
          Run the same initial state through 4 standard strategies and compare the predicted trajectories
          side-by-side. Numbers come from the production simulator (first-order linearised, not CFD/FEA).
          The 4 strategies are: do nothing, derate to 50%, immediate shutdown, and +15% cooling. Pick a
          horizon (1–60 steps) to see how far into the future you want to peek.
        </p>
        <form className="wm-horizon" method="get">
          <label>Horizon (steps)
            <input type="number" name="horizon" min={1} max={60} defaultValue={horizon} />
          </label>
          <button type="submit">Apply</button>
          <span className="wm-meta">
            <span>asset: <strong>{r.twinName}</strong></span>
            <span>·</span>
            <span>rotor: <strong>{r.rotorRpm} rpm</strong></span>
            <span>·</span>
            <span>horizon: <strong>{r.horizonSteps} steps × 1 h</strong></span>
          </span>
        </form>
      </header>

      <section className="wm-grid">
        {r.scenarios.map((s) => <ScenarioCard key={s.name} s={s} />)}
      </section>

      <section className="wm-best">
        <h2>🟢 Best strategy (according to the world model)</h2>
        {r.best ? (
          <p>
            <strong>{r.best.name}</strong>{" "}
            {r.best.stepsUntilBreach === null
              ? "completes the horizon with no critical breach."
              : `breaches at step ${r.best.stepsUntilBreach} (the latest of the 4 strategies).`}
          </p>
        ) : (
          <p>No strategy available.</p>
        )}
        <p className="wm-honest">
          The world model is the first-order linearised simulator. Numbers change if the underlying rules
          change. The plan gate (NIRNAYA) makes the final decision; this page is the comparison surface.
        </p>
      </section>
    </div>
  );
}

function ScenarioCard({ s }: { s: ScenarioResult }) {
  const verdictColor = s.accepted ? "#4ade80" : "#f87171";
  return (
    <article className="wm-scenario">
      <header className="wm-scenario-head">
        <h3>{s.name}</h3>
        <span className="wm-verdict" style={{ background: verdictColor, color: "#0b0d12" }}>{s.accepted ? "NO BREACH" : "BREACH"}</span>
      </header>
      <p className="wm-scenario-desc">{s.description}</p>
      <div className="wm-spark">
        <div className="wm-spark-label">
          <span>vibration (mm/s)</span>
          <span className="wm-spark-end">{s.vibSparkline.at(-1)?.toFixed(2) ?? "n/a"}</span>
        </div>
        <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="wm-spark-svg">
          <path d={sparklinePath(s.vibSparkline, 200, 40, 2)} fill="none" stroke="#fb923c" strokeWidth={1.5} />
        </svg>
      </div>
      <div className="wm-spark">
        <div className="wm-spark-label">
          <span>gearbox T (K)</span>
          <span className="wm-spark-end">{s.tempSparkline.at(-1)?.toFixed(1) ?? "n/a"}</span>
        </div>
        <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="wm-spark-svg">
          <path d={sparklinePath(s.tempSparkline, 200, 40, 2)} fill="none" stroke="#38bdf8" strokeWidth={1.5} />
        </svg>
      </div>
      <table className="wm-final">
        <tbody>
          <tr><td>rotor_rpm</td><td>{(s.finalState["rotor_rpm"] ?? 0).toFixed(1)}</td></tr>
          <tr><td>vib_bearing_mms</td><td>{(s.finalState["vib_bearing_mms"] ?? 0).toFixed(2)}</td></tr>
          <tr><td>T_gearbox_K</td><td>{(s.finalState["T_gearbox_K"] ?? 0).toFixed(1)}</td></tr>
          <tr><td>P_active_kW</td><td>{(s.finalState["P_active_kW"] ?? 0).toFixed(1)}</td></tr>
        </tbody>
      </table>
      {s.firstBreach ? (
        <div className="wm-breach">
          <strong>First critical breach:</strong> step {s.firstBreach.step} · {s.firstBreach.channel} · {s.firstBreach.detail}
        </div>
      ) : (
        <div className="wm-breach clean"><strong>No critical breach</strong> in the {s.steps}-step horizon.</div>
      )}
    </article>
  );
}
