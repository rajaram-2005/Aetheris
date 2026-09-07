/**
 * /demo — the Signature WTG-04 Anomaly Experience.
 *
 *   Server-rendered page. Composes the real Aetheris modules (FFT,
 *   bearing-fault matcher, diagnostic history, wind-turbine simulator,
 *   plan gate) into a deterministic 14-step walkthrough. The 10-core
 *   status rail at the top shows which core is acting in each step.
 *   No fake animations disconnected from state; every headline and
 *   verdict comes from the engine.
 *
 *   URL: /demo
 *   Renders: a 10-core status rail + 14 step cards (one per core actor)
 *     + the final FUSION paragraph.
 *   Honest: this is a real demo of real diagnostics, not a scripted
 *     slideshow. The numbers change if the underlying simulator's
 *     coefficients change.
 */
import { buildDemoSequence, CORE_LABELS, VERDICT_COLORS, loadDemoTwin, type DemoStep } from "@/core/demo/sequence";
import { getHistory } from "@/core/diagnostics/history";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DemoPage() {
  let twin;
  try {
    twin = await loadDemoTwin();
  } catch {
    twin = null;
  }
  const seq = twin ? await buildDemoSequence({ twin, rotorRpm: 1500 }) : null;
  const history = twin ? await getHistory(twin.id, { limit: 10 }).catch(() => []) : [];
  const cores = Array.from(new Set(seq?.steps.map((s) => s.core) ?? []));

  return (
    <div className="demo-page">
      <header className="demo-head">
        <h1>🌪️ Signature WTG-04 Anomaly Experience</h1>
        <p>
          A deterministic walkthrough of the Aetheris pipeline on the canonical
          2 MW wind-turbine gearbox. Every step is computed from the real FFT,
          bearing-fault matcher, diagnostic history, wind-turbine simulator,
          and plan gate. The 10-core status rail shows which core is acting
          in each step. The same engine powers the production diagnostics
          page; only the framing changes.
        </p>
        <div className="demo-head-meta">
          <span>Trigger: <strong>vibration 14.2 mm/s</strong> (ISO 10816 zone D)</span>
          <span>·</span>
          <span>Asset: <strong>{twin?.name ?? "WTG-04 (no demo twin)"}</strong></span>
          <span>·</span>
          <span>History on file: <strong>{history.length}</strong></span>
          <span>·</span>
          <span>Steps: <strong>{seq?.steps.length ?? 0}</strong></span>
        </div>
      </header>

      <section className="demo-rail" aria-label="10-core status">
        <h2>10-core status</h2>
        <ul>
          {(["PRAVAAH", "NIRIKSHAN", "SMRITI", "VAYU-1", "DRISHTI", "YANTRA", "WORLD_MODEL", "PLANNER", "NIRNAYA", "CHAKRA", "SETU", "FUSION"] as const).map((c) => {
            const used = cores.includes(c);
            const label = CORE_LABELS[c];
            return (
              <li key={c} className={used ? "demo-core on" : "demo-core"}>
                <span className="demo-core-dot" style={{ background: label.color }} />
                <span className="demo-core-name">{label.name}</span>
                <span className="demo-core-state">{used ? "ACTIVE" : "STANDBY"}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {seq ? (
        <section className="demo-steps">
          <h2>The 14-step sequence</h2>
          <ol className="demo-step-list">
            {seq.steps.map((s) => <DemoStepCard key={s.step} s={s} />)}
          </ol>
        </section>
      ) : (
        <p className="hint">Could not build the demo sequence. The DEMO seed may not have been applied yet; try refreshing after a moment.</p>
      )}

      {seq && (
        <section className="demo-fusion">
          <h2>🟣 FUSION · one unified Aetheris result</h2>
          <p>{seq.finalResult}</p>
        </section>
      )}

      <footer className="demo-foot">
        <p>
          Continue: <Link href={`/twin-3d?twinId=${twin?.id ?? "demo-turbine-1"}`}>open the 3D twin viewer</Link>,
          <Link href="/diagnostics?twinId=demo-turbine-1&injectBearingFault=1"> open the diagnostics panel</Link>, or
          <Link href="/warroom"> start a War Room debate on the recommendation</Link>.
        </p>
        <p className="demo-honest">
          Honest scope: this demo is built from the same engine code that runs in production.
          The DRISHTI step does not invent inspection imagery; it returns an honest "no visual evidence on file" note.
          The SETU step prepares a workflow ticket but does not execute any physical write — that requires the
          <code> physical</code> opt-in grant, which is off by default. The world-model and plan-gate steps
          use the first-order linearised simulator, not CFD/FEA.
        </p>
      </footer>
    </div>
  );
}

function DemoStepCard({ s }: { s: DemoStep }) {
  const label = CORE_LABELS[s.core];
  const verdict = s.verdict;
  return (
    <li className="demo-step" data-step={s.step}>
      <div className="demo-step-head">
        <span className="demo-step-num">{String(s.step).padStart(2, "0")}</span>
        <span className="demo-step-core" style={{ color: label.color }}>{label.name}</span>
        <span className="demo-step-headline">{s.headline.split(" · ").slice(1).join(" · ")}</span>
        {verdict && (
          <span className="demo-step-verdict" style={{ background: VERDICT_COLORS[verdict.kind] }} title={verdict.reason}>
            {verdict.kind.toUpperCase()}
          </span>
        )}
      </div>
      <p className="demo-step-summary">{s.summary}</p>
      <table className="demo-step-evidence">
        <tbody>
          {s.evidence.map((e, i) => (
            <tr key={i}>
              <td className="demo-ev-kind">{e.kind}</td>
              <td className="demo-ev-label">{e.label}</td>
              <td className="demo-ev-value">{e.value}{e.unit ? <span className="demo-ev-unit"> {e.unit}</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </li>
  );
}
