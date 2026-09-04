"use client";

import { renderMarkdown } from "./markdown";

export type StepId = "generate" | "repo" | "commit" | "ci" | "logs" | "report";
export interface StepState { status: "pending" | "start" | "done" | "error"; detail?: string; url?: string }
export interface FactoryState {
  task: string;
  steps: Record<StepId, StepState>;
  files?: string[];
  result?: { ok: boolean; conclusion: string; report: string; runUrl?: string; commitUrl?: string; branch: string };
  error?: string;
}

export const STEP_LABELS: Record<StepId, string> = {
  generate: "Write code",
  repo: "Factory repo",
  commit: "Push to GitHub",
  ci: "GitHub Actions",
  logs: "Read CI logs",
  report: "Report",
};

export function emptyFactoryState(task: string): FactoryState {
  const steps = Object.fromEntries(
    (Object.keys(STEP_LABELS) as StepId[]).map((k) => [k, { status: "pending" }]),
  ) as Record<StepId, StepState>;
  return { task, steps };
}

export default function FactoryRun({ state }: { state: FactoryState }) {
  return (
    <div className="factory">
      <ol className="steps">
        {(Object.keys(STEP_LABELS) as StepId[]).map((id) => {
          const s = state.steps[id];
          return (
            <li key={id} className={`step ${s.status}`}>
              <span className="step-icon">
                {s.status === "done" ? "✓" : s.status === "error" ? "✕" : s.status === "start" ? <span className="spin" /> : "·"}
              </span>
              <span className="step-label">{STEP_LABELS[id]}</span>
              {s.detail && (
                <span className="step-detail">
                  {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.detail}</a> : s.detail}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {state.files && state.files.length > 0 && (
        <div className="files">{state.files.map((f) => <code key={f}>{f}</code>)}</div>
      )}
      {state.error && <div className="err-text" style={{ marginTop: 8 }}>{state.error}</div>}
      {state.result && (
        <div className={`verdict ${state.result.ok ? "ok" : "fail"}`}>
          <div className="verdict-head">
            {state.result.ok ? "✓ Tests passed" : `✕ CI ${state.result.conclusion}`}
            <span className="verdict-links">
              {state.result.runUrl && <a href={state.result.runUrl} target="_blank" rel="noopener noreferrer">run</a>}
              {state.result.commitUrl && <a href={state.result.commitUrl} target="_blank" rel="noopener noreferrer">commit</a>}
              <code>{state.result.branch}</code>
            </span>
          </div>
          <div className="bubble-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(state.result.report) }} />
        </div>
      )}
    </div>
  );
}
