/**
 * /runbook — Operator Runbook.
 *
 *   A written page in the document's voice. Tells an
 *   operator what they can do today, what they cannot,
 *   what the system guarantees, and what it does not.
 *   Pure read-side. No fabrication. Every claim is tied
 *   to a real module or capability.
 */
import Link from "next/link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function RunbookPage() {
  return (
    <div className="rb-page">
      <header className="rb-head">
        <h1>📖 Operator Runbook</h1>
        <p>A written page in the architecture document&apos;s voice. It tells you what you can do today, what you cannot, what the system guarantees, and what it does not. Every claim is tied to a real module or capability.</p>
      </header>

      <section className="rb-section">
        <h2>What you can do today</h2>
        <ul>
          <li><strong>Inspect the fleet.</strong> <Link href="/fleet">/fleet</Link>, <Link href="/devices">/devices</Link>, <Link href="/twins">/twins</Link>, <Link href="/twins/edit">/twins/edit</Link>.</li>
          <li><strong>Run diagnostics.</strong> FFT, bearing-fault matching, anomaly detection, PBNN predictions on each twin&apos;s history. <Link href="/diagnostics">/diagnostics</Link>, <Link href="/learning">/learning</Link>, <Link href="/anomaly">/anomaly</Link>.</li>
          <li><strong>Compose a wind/aero query.</strong> VAYU-1 is a service that calls PBNN + Anomaly + Arena + FFT. <Link href="/vayu">/vayu</Link>, <Link href="/fuse">/fuse</Link>.</li>
          <li><strong>Run a single sandboxed command.</strong> Read-only commands run with <code>read_only</code>; writes need <code>safe_write</code> + a confirmation token. <Link href="/terminal">/terminal</Link>.</li>
          <li><strong>Inspect capability gates.</strong> The matrix, the trust panel, the audit export, the trace viewer. <Link href="/permissions-matrix">/permissions-matrix</Link>, <Link href="/trust">/trust</Link>, <Link href="/audit">/audit</Link>, <Link href="/trace">/trace</Link>.</li>
          <li><strong>Inspect memory.</strong> Knowledge graph, evidence ledger, handoff notes, lab experiment history. <Link href="/knowledge-graph">/knowledge-graph</Link>, <Link href="/evidence">/evidence</Link>, <Link href="/handoff">/handoff</Link>, <Link href="/lab-history">/lab-history</Link>.</li>
          <li><strong>Schedule maintenance.</strong> Read the maintenance calendar; dispatch is via the production write API at <code>POST /api/twins/edit</code> with <code>op=addMaintenance</code>. <Link href="/maintenance-calendar">/maintenance-calendar</Link>.</li>
          <li><strong>Compare models.</strong> The arena runs a real cross-provider comparison. <Link href="/arena">/arena</Link>.</li>
        </ul>
      </section>

      <section className="rb-section">
        <h2>What you cannot do today</h2>
        <ul className="rb-cant">
          <li><strong>You cannot actuate physical hardware.</strong> Hardware write-access is opt-in, behind the <code>physical</code> permission, OFF by default. <Link href="/permissions-matrix">/permissions-matrix</Link>.</li>
          <li><strong>You cannot claim production-accuracy fault diagnosis.</strong> NIRIKSHAN runs FFT, anomaly detection, and PBNN. The numbers are whatever the algorithms produce; do not claim &quot;X% accuracy&quot; without a labelled benchmark.</li>
          <li><strong>You cannot claim a trained VAYU-1 model.</strong> VAYU-1 is a service that calls existing modules. It is a proxy, not a fine-tuned domain model.</li>
          <li><strong>You cannot run unbounded shell commands.</strong> The terminal allowlist is enforced by the production sandbox. <Link href="/terminal">/terminal</Link>.</li>
          <li><strong>You cannot self-modify the system.</strong> Tool internalization is not yet enabled.</li>
        </ul>
      </section>

      <section className="rb-section">
        <h2>What the system guarantees</h2>
        <ul>
          <li><strong>Capability gates.</strong> Every write API runs <code>authorize()</code> from <code>src/core/policy/permissions.ts</code>. The grant is logged to the observability stream as a <code>permission</code> event.</li>
          <li><strong>Append-only evidence.</strong> The evidence ledger reads <code>twin.events</code>, <code>diagnostic-history</code>, and <code>system-events</code>. It is read-side; it never mutates.</li>
          <li><strong>Sandbox isolation.</strong> The terminal runs in a fresh temp workspace with env-scrubbing, SIGKILL timeout, and an output cap. Network is off by default.</li>
          <li><strong>Verifier honesty.</strong> The fusion engine&apos;s verifier returns <code>allow</code>, <code>allow-with-caveat</code>, or <code>deny</code> with an uncertainty number. It never claims more certainty than the inputs support.</li>
        </ul>
      </section>

      <section className="rb-section">
        <h2>What the system does not guarantee</h2>
        <ul className="rb-cant">
          <li><strong>Mathematical proof of correctness.</strong> NIRNAYA performs evidence checks, constraint checks, cross-model comparison, data-quality checks, test execution, uncertainty estimation, and policy enforcement. It does not provide a proof of correctness.</li>
          <li><strong>Validated engineering digital-twin simulation.</strong> The 3D twin is a visualisation with a software-only digital twin; it is not a validated engineering digital twin.</li>
          <li><strong>Real-time production-accuracy fault diagnosis.</strong> Until benchmarked on real SCADA/vibration data, accuracy is whatever the algorithms produce — engineering, not validated.</li>
        </ul>
      </section>

      <section className="rb-section">
        <h2>If something goes wrong</h2>
        <ol>
          <li>Open the audit export at <Link href="/audit">/audit</Link> and filter by the relevant capability.</li>
          <li>Open the trace at <Link href="/trace">/trace</Link> and find the failing group.</li>
          <li>If a permission denial, open <Link href="/trust">/trust</Link> to inspect the principal and grants.</li>
          <li>If a sandbox command failed, copy the output to the operator channel; the terminal records the exit code, ms, and fs changes.</li>
          <li>For physically-relevant decisions, require human approval. The system has no override over that.</li>
        </ol>
      </section>

      <footer className="rb-foot">
        <p><Link href="/capabilities">/capabilities</Link> · <Link href="/cores">/cores</Link> · <Link href="/">/</Link></p>
      </footer>
    </div>
  );
}
