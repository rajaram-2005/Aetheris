/**
 * /terminal — Sandboxed Terminal page.
 *
 *   Reads-only commands (pwd, date, env, true, ls, cat, head,
 *   tail, grep, wc, find, diff) require read_only and run
 *   with no confirmation. Anything else requires safe_write
 *   AND a confirmation token. The client posts the command
 *   to /api/terminal and renders stdout, stderr, exit code,
 *   timing, and the list of fs changes.
 */
"use client";
import { useState } from "react";
import Link from "next/link";

interface TerminalResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  policyReason: string | null;
  policyOk: boolean;
  binary: string | null;
  command: string;
  ranAt: number;
  fsChanges: string[];
  capability: string;
  needsConfirmation?: boolean;
  token?: string;
  error?: string;
  code?: string;
}

const READ_ONLY_BIN = new Set(["pwd", "date", "env", "true", "ls", "cat", "head", "tail", "grep", "wc", "find", "diff"]);

export default function TerminalPage() {
  const [command, setCommand] = useState("pwd");
  const [confirmationToken, setConfirmationToken] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [result, setResult] = useState<TerminalResult | null>(null);
  const [busy, setBusy] = useState(false);

  const isReadOnly = (() => {
    const trimmed = command.trim();
    if (!trimmed) return false;
    const first = (trimmed.split(/\s+/)[0] ?? "").split("/").pop() ?? "";
    return READ_ONLY_BIN.has(first);
  })();

  async function send(token?: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/terminal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command, confirmationToken: token ?? "" }) });
      const j = (await r.json()) as TerminalResult;
      if (j.needsConfirmation && j.token) {
        setPendingToken(j.token);
        setResult(j);
      } else {
        setPendingToken(null);
        setResult(j);
      }
    } catch (err) {
      setResult({ ok: false, exitCode: null, stdout: "", stderr: (err as Error).message, ms: 0, policyReason: null, policyOk: true, binary: null, command, ranAt: Date.now(), fsChanges: [], capability: "tool:terminal.run" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="term-page">
      <header className="term-head">
        <h1>⌨️ Sandboxed Terminal</h1>
        <p>One command per request. Runs in a fresh temp workspace, env-scrubbed, SIGKILL timeout, output cap. The production policy enforces the allowlist and blocks path traversal. Read-only commands run with <code>read_only</code>; everything else needs <code>safe_write</code> plus a confirmation token.</p>
      </header>

      <form className="term-form" onSubmit={(e) => { e.preventDefault(); if (!pendingToken) send(); else send(pendingToken); }}>
        <label>
          <span>Command</span>
          <input type="text" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="pwd / ls / cat / head / echo / mkdir …" />
        </label>
        {pendingToken && (
          <label>
            <span>Confirmation token</span>
            <input type="text" value={confirmationToken} onChange={(e) => setConfirmationToken(e.target.value)} placeholder={pendingToken} />
          </label>
        )}
        <button type="submit" disabled={busy || !command.trim()}>{busy ? "Running…" : pendingToken ? "Confirm + Run" : isReadOnly ? "Run" : "Run (needs confirmation)"}</button>
      </form>

      {pendingToken && (
        <div className="term-confirm">
          <p>Sandbox needs <code>safe_write</code> and a one-time confirmation token. We've issued one for you — paste it into the field above and re-submit, or open the issuing page <Link href="/confirm">/confirm</Link>.</p>
          <code className="term-token">{pendingToken}</code>
        </div>
      )}

      {result && (
        <section className="term-result">
          <div className="term-meta">
            <span>binary: <code>{result.binary ?? "—"}</code></span>
            <span>exit: <strong style={{ color: result.ok ? "#4ade80" : "#f87171" }}>{result.exitCode ?? "—"}</strong></span>
            <span>ms: <code>{result.ms}</code></span>
            <span>policy: {result.policyOk ? "✓" : `✗ ${result.policyReason ?? ""}`}</span>
            <span>cap: <code>{result.capability}</code></span>
            {result.fsChanges.length > 0 && <span>fs-changes: <code>{result.fsChanges.length}</code></span>}
          </div>
          {result.error && <div className="term-err">error: {result.error} ({result.code})</div>}
          {result.stdout && <pre className="term-stdout">$ {command}\n{result.stdout}</pre>}
          {result.stderr && <pre className="term-stderr">{result.stderr}</pre>}
          {result.fsChanges.length > 0 && (
            <details className="term-fs">
              <summary>fs changes ({result.fsChanges.length})</summary>
              <ul>{result.fsChanges.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
            </details>
          )}
        </section>
      )}

      <footer className="term-foot">
        <p><Link href="/audit">/audit</Link> <Link href="/trace">/trace</Link></p>
      </footer>
    </div>
  );
}
