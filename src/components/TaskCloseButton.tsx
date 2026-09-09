"use client";
/**
 * TaskCloseButton — small client island for the
 * /tasks page. The server-rendered list owns the row;
 * this component only handles the close flow:
 *
 *   1. POST to /api/maintenance/close with no token.
 *   2. If needsConfirmation, show a confirm button.
 *   3. On second click, POST with the token, then
 *      reload to reflect the new state.
 *
 * The close is capability-gated at 'safe_write' with a
 * confirmation token, mirroring the dispatch route. The
 * server is the source of truth: on success, this
 * component reloads the page. On failure, it shows the
 * server's reason.
 */
import { useState } from "react";

interface Props {
  twinId: string;
  at: number;
  twinName: string;
  note: string;
}

export default function TaskCloseButton({ twinId, at, twinName, note }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "needs_confirm" | "done" | "error">("idle");
  const [token, setToken] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [doneNote, setDoneNote] = useState("");

  async function call(confirmToken: string | null) {
    setState("loading");
    setReason(null);
    try {
      const res = await fetch("/api/maintenance/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ twinId, at, doneNote: doneNote || undefined, confirmationToken: confirmToken ?? undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; needsConfirmation?: boolean; token?: string; error?: string; reason?: string };
      if (data.ok) {
        setState("done");
        // Reload after a short delay so the user sees the
        // "done" state land.
        setTimeout(() => window.location.reload(), 300);
        return;
      }
      if (data.needsConfirmation && data.token) {
        setToken(data.token);
        setState("needs_confirm");
        return;
      }
      setReason(data.error ?? data.reason ?? "unknown error");
      setState("error");
    } catch (e) {
      setReason((e as Error).message);
      setState("error");
    }
  }

  if (state === "done") {
    return <span className="task-done-flag">✓ closed</span>;
  }
  if (state === "needs_confirm") {
    return (
      <div className="task-confirm">
        <input
          type="text"
          placeholder="Optional: why is this closed? (e.g. 'oil changed')"
          value={doneNote}
          onChange={(e) => setDoneNote(e.target.value)}
          className="task-note"
          maxLength={300}
        />
        <button className="task-btn task-btn-confirm" onClick={() => call(token)}>
          Confirm close
        </button>
        <button className="task-btn task-btn-cancel" onClick={() => { setState("idle"); setToken(null); }}>
          Cancel
        </button>
        <p className="task-reason">Confirming will stamp <code>doneAt</code> on this entry for <strong>{twinName}</strong>: <em>{note}</em></p>
      </div>
    );
  }
  return (
    <div className="task-row-actions">
      <button className="task-btn task-btn-mark" disabled={state === "loading"} onClick={() => call(null)}>
        {state === "loading" ? "…" : "Mark done"}
      </button>
      {state === "error" && reason ? <span className="task-error">⚠ {reason}</span> : null}
    </div>
  );
}
