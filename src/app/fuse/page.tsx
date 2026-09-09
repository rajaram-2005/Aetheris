/**
 * /fuse — Fusion Engine page.
 *
 *   Server-rendered form. Takes a question, optional demo
 *   flag, and an explicit VAYU include. Runs fuse() and
 *   renders the structured result: telemetry, twin,
 *   evidence, memory, verification, optional VAYU, summary.
 *   Every slice is shown with its source and ok/fail flag.
 */
import Link from "next/link";
import { fuse, type FusionResult } from "@/core/orchestration/fusion";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function FusePage({ searchParams }: { searchParams: Promise<{ q?: string; demo?: string; vayu?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId({ allowAnonymous: true });
  const question = sp.q ?? "what is the state of the system?";
  const demo = sp.demo === "1";
  const includeVayu = sp.vayu === "1";
  const result: FusionResult = await fuse({ uid, question, demo, includeVayu });
  return (
    <div className="fuse-page">
      <header className="fuse-head">
        <h1>🧠 Fusion Engine</h1>
        <p>The single entry point that takes a user question and composes a structured answer from real modules: telemetry, twin, evidence, memory, verification, and (when relevant) VAYU-1. No fabrication. Every slice is labelled with its source and ok/fail status.</p>
        <form className="fuse-form" method="get">
          <label>Question <input type="text" name="q" defaultValue={question} /></label>
          <label><input type="checkbox" name="demo" value="1" defaultChecked={demo} /> demo-seed</label>
          <label><input type="checkbox" name="vayu" value="1" defaultChecked={includeVayu} /> force include VAYU</label>
          <button type="submit">Fuse</button>
        </form>
        <div className="fuse-meta">
          <span>mode: <strong style={{ color: result.mode === "live" ? "#4ade80" : "#facc15" }}>{result.mode}</strong></span>
          <span>verifier: <strong>{result.verification.decision}</strong></span>
          <span>uncertainty: <strong>{result.verification.uncertainty.toFixed(2)}</strong></span>
          <span>cap: <code>{result.capability}</code></span>
        </div>
      </header>

      <section className="fuse-summary">
        <h2>Summary</h2>
        <p>{result.summary}</p>
      </section>

      <section className="fuse-grid">
        <article className="fuse-card">
          <h3>Telemetry</h3>
          <p className="f-meta">twins: <strong>{result.telemetry.twinCount}</strong> · agent-jobs: <strong>{result.telemetry.agentJobs}</strong></p>
          <p className="f-meta">source: <code>{result.telemetry.source}</code> · ok: <strong style={{ color: result.telemetry.ok ? "#4ade80" : "#f87171" }}>{result.telemetry.ok ? "✓" : "✗"}</strong></p>
          {!result.telemetry.ok && result.telemetry.reason && <p className="f-fail">{result.telemetry.reason}</p>}
        </article>

        <article className="fuse-card">
          <h3>Twin</h3>
          <p className="f-meta">id: <code>{result.twin.twinId}</code> · name: <strong>{result.twin.name}</strong></p>
          <p className="f-meta">state keys: <strong>{result.twin.stateKeys}</strong> · bounds: <strong>{result.twin.boundsCount}</strong> · rules: <strong>{result.twin.rulesCount}</strong></p>
          <p className="f-meta">source: <code>{result.twin.source}</code> · ok: <strong style={{ color: result.twin.ok ? "#4ade80" : "#f87171" }}>{result.twin.ok ? "✓" : "✗"}</strong></p>
          {!result.twin.ok && result.twin.reason && <p className="f-fail">{result.twin.reason}</p>}
        </article>

        <article className="fuse-card">
          <h3>Evidence</h3>
          <p className="f-meta">total: <strong>{result.evidence.total}</strong> · latest: <code>{result.evidence.latestAt ? new Date(result.evidence.latestAt).toISOString().slice(0, 19) : "—"}</code></p>
          <p className="f-meta">twin-event: <strong>{result.evidence.bySource["twin-event"]}</strong> · diagnostic: <strong>{result.evidence.bySource["diagnostic"]}</strong> · system-event: <strong>{result.evidence.bySource["system-event"]}</strong></p>
          <p className="f-meta">source: <code>{result.evidence.source}</code> · ok: <strong style={{ color: result.evidence.ok ? "#4ade80" : "#f87171" }}>{result.evidence.ok ? "✓" : "✗"}</strong></p>
        </article>

        <article className="fuse-card">
          <h3>Memory</h3>
          <p className="f-meta">recall hits: <strong>{result.memory.recall.length}</strong> · graph edges: <strong>{result.memory.graphNeighbours.length}</strong></p>
          <p className="f-meta">source: <code>{result.memory.source}</code> · ok: <strong style={{ color: result.memory.ok ? "#4ade80" : "#f87171" }}>{result.memory.ok ? "✓" : "✗"}</strong></p>
          {result.memory.recall.length > 0 && (
            <ul className="f-list">{result.memory.recall.map((m) => <li key={m.id}><code>{m.id}</code> — {m.text}</li>)}</ul>
          )}
        </article>

        <article className="fuse-card">
          <h3>Verification</h3>
          <p className="f-meta">decision: <strong style={{ color: result.verification.decision === "allow" ? "#4ade80" : result.verification.decision === "allow-with-caveat" ? "#facc15" : "#f87171" }}>{result.verification.decision}</strong></p>
          <p className="f-meta">tests passed: <strong>{result.verification.testsPassed}/{result.verification.testsRun}</strong> · uncertainty: <strong>{result.verification.uncertainty.toFixed(2)}</strong></p>
          <p className="f-reason">{result.verification.reason}</p>
        </article>

        <article className="fuse-card">
          <h3>VAYU-1</h3>
          {result.vayu ? (
            <>
              <p className="f-meta">mode: <strong>{result.vayu.mode}</strong> · twin: <code>{result.vayu.twinId}</code></p>
              <p className="f-meta">channel: <code>{result.vayu.channel}</code> · capability: <code>{result.vayu.capability}</code></p>
              <p className="f-reason">{result.vayu.summary}</p>
            </>
          ) : <p className="f-fail">not included (question did not trigger VAYU keywords and 'force include VAYU' was off)</p>}
        </article>
      </section>

      <footer className="fuse-foot">
        <p><Link href="/vayu">/vayu</Link> · <Link href="/cores">/cores</Link> · <Link href="/capabilities">/capabilities</Link></p>
      </footer>
    </div>
  );
}
