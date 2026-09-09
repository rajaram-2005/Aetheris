/**
 * /accuracy — Diagnostic engine evaluation page.
 *
 *   Server-rendered. The page runs the NIRIKSHAN evaluation
 *   harness against a synthetic trial set. With no real
 *   benchmark (CWRU, Paderborn, or proprietary) wired in,
 *   the page is honest: it shows the harness plumbing, the
 *   per-class shape, and the document's boundary statement.
 *   It does not invent an accuracy number.
 *
 *   When a real benchmark is plugged in, the harness
 *   produces per-class precision/recall/F1, a confusion
 *   matrix, calibration error, and latency percentiles —
 *   each annotated with what the report proves and what
 *   it does not prove.
 */
import Link from "next/link";
import { runEval, type EvalReport, type LabelledTrial } from "@/core/diagnostics/eval";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Synthetic trial set so the harness plumbing is visible
 *  end-to-end. The trials are 1-second simulated signals
 *  with no fault content. The diagnostic engine will
 *  classify them as "no_fault" or "unmatched" depending on
 *  rotorRpm. This is NOT a benchmark; it is a smoke test
 *  that exercises the per-class / confusion-matrix /
 *  calibration code paths.
 *
 *  Real benchmarks: CWRU, Paderborn, IMS. See
 *  docs/SCOPE-FAULT-DIAGNOSIS.md for the plan. */
function syntheticTrials(): LabelledTrial[] {
  const trials: LabelledTrial[] = [];
  const sampleRateHz = 12000;
  for (let i = 0; i < 5; i++) {
    const signal = Array.from({ length: 12000 }, (_, k) => Math.sin(2 * Math.PI * 25 * (k / sampleRateHz)) * 1.0);
    trials.push({ id: `synthetic-no-fault-${i}`, trueClass: "no_fault", signal, sampleRateHz, rotorRpm: 1500, note: "synthetic 25 Hz tone at 1500 RPM (BPFI ≈ 0, BPFO ≈ 0)" });
  }
  return trials;
}

const SEVERITY_COLOUR: Record<string, string> = { ok: "#4ade80", watch: "#facc15", warning: "#fb923c", critical: "#f87171" };

export default async function AccuracyPage() {
  // Run a real harness pass against the synthetic trial set
  // so the page is honest about what the harness produces.
  // This is NOT a real benchmark.
  const r: EvalReport = await runEval(syntheticTrials(), { benchmark: "synthetic-fixture (not a real benchmark)", engineVersion: "test-runner" });
  return (
    <div className="acc-page">
      <header className="acc-head">
        <h1>📏 Engine Accuracy</h1>
        <p>The NIRIKSHAN evaluation harness. With a labelled benchmark (CWRU, Paderborn, IMS, or proprietary) wired in, this page would show per-class precision/recall/F1, a confusion matrix, calibration error, and latency percentiles. <strong>Right now no real benchmark is configured</strong>, so the page runs a synthetic trial set as a smoke test of the harness plumbing. <em>No accuracy claim is made on the basis of this run.</em></p>
        <div className="acc-meta">
          <span>benchmark: <code>{r.benchmark}</code></span>
          <span>· engine: <code>{r.engineVersion}</code></span>
          <span>· trials: <strong>{r.totalTrials}</strong></span>
          <span>· correct: <strong>{r.correct}</strong></span>
          <span>· accuracy: <strong>{r.accuracy === null ? "—" : r.accuracy.toFixed(3)}</strong></span>
          <span>· sample size: <strong>{r.notes.sampleSize}</strong></span>
        </div>
        <div className="acc-banner">
          <strong>What this page proves:</strong> {r.notes.proves}
          <br />
          <strong>What this page does NOT prove:</strong> {r.notes.doesNotProve}
        </div>
      </header>

      <section className="acc-section">
        <h2>Per-class metrics</h2>
        {r.perClass.length === 0 ? <p className="hint">No trials → no per-class metrics. The harness does not invent numbers.</p> : (
          <table className="acc-table">
            <thead><tr><th>Class</th><th>trials</th><th>TP</th><th>FP</th><th>FN</th><th>TN</th><th>precision</th><th>recall</th><th>F1</th></tr></thead>
            <tbody>
              {r.perClass.map((c) => (
                <tr key={c.class}>
                  <td><code>{c.class}</code></td>
                  <td>{c.trials}</td>
                  <td>{c.tp}</td>
                  <td>{c.fp}</td>
                  <td>{c.fn}</td>
                  <td>{c.tn}</td>
                  <td>{c.precision === null ? "—" : c.precision.toFixed(3)}</td>
                  <td>{c.recall === null ? "—" : c.recall.toFixed(3)}</td>
                  <td>{c.f1 === null ? "—" : c.f1.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="acc-section">
        <h2>Confusion matrix</h2>
        {r.confusion.classes.length === 0 ? <p className="hint">No trials.</p> : (
          <table className="acc-cm">
            <thead>
              <tr>
                <th></th>
                {r.confusion.classes.map((c) => <th key={`col-${c}`}><code>{c}</code></th>)}
              </tr>
            </thead>
            <tbody>
              {r.confusion.matrix.map((row, i) => (
                <tr key={`row-${i}`}>
                  <th><code>{r.confusion.classes[i]}</code></th>
                  {row.map((v, j) => (
                    <td key={`c-${i}-${j}`} style={{ background: i === j ? "rgba(74, 222, 128, 0.15)" : "transparent" }}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="acc-section">
        <h2>Latency</h2>
        <p>p50: <strong>{r.latencyP50 === null ? "—" : `${r.latencyP50}ms`}</strong> · p95: <strong>{r.latencyP95 === null ? "—" : `${r.latencyP95}ms`}</strong> · calibration error: <strong>{r.calibrationError === null ? "—" : r.calibrationError.toFixed(3)}</strong></p>
      </section>

      <section className="acc-section">
        <h2>Path to a real benchmark</h2>
        <p>The plan is in <Link href="/docs/SCOPE-FAULT-DIAGNOSIS.md">docs/SCOPE-FAULT-DIAGNOSIS.md</Link> and the live <Link href="/runbook">/runbook</Link>. The harness scaffolding is in <code>src/core/diagnostics/eval.ts</code>. To wire a real benchmark, replace <code>syntheticTrials()</code> in <code>src/app/accuracy/page.tsx</code> with a loader that returns the labelled trials from the chosen dataset. No harness code needs to change.</p>
      </section>

      <footer className="acc-foot">
        <p><Link href="/diagnostics">/diagnostics</Link> · <Link href="/runbook">/runbook</Link> · <Link href="/">/</Link></p>
      </footer>
    </div>
  );
}
