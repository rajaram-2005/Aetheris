"use client";

import { useState } from "react";
import { renderMarkdown } from "./markdown";
import type { ProviderStatus } from "./MeshPanel";

export interface Lane { i: number; provider: string; name: string; model: string; content: string; done?: boolean; error?: string; latencyMs?: number }
export interface ArenaRun { id: string; prompt: string; lanes: Lane[]; winner?: number; running: boolean }

export function ArenaPicker({ providers, selected, onChange }: { providers: ProviderStatus[]; selected: string[]; onChange: (s: string[]) => void }) {
  const ready = providers.filter((p) => p.configured);
  return (
    <div className="arena-picker">
      <span className="hint" style={{ margin: 0 }}>Compare {selected.length || "auto (3)"}:</span>
      {ready.map((p) => {
        const on = selected.includes(p.id);
        return <button key={p.id} className={`chip ${on ? "on" : ""}`} disabled={!on && selected.length >= 4} onClick={() => onChange(on ? selected.filter((x) => x !== p.id) : [...selected, p.id])}>{p.name}</button>;
      })}
      {ready.length < 2 && <span className="hint" style={{ margin: 0, color: "var(--warn)" }}>Add at least two provider keys to use the Arena.</span>}
    </div>
  );
}

export function ArenaResult({ run, onVote, onContinue }: { run: ArenaRun; onVote: (i: number) => void; onContinue: (i: number) => void }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <div className="arena">
      <div className="arena-grid" style={{ gridTemplateColumns: `repeat(${Math.min(run.lanes.length, expanded !== null ? 1 : 3)}, minmax(0, 1fr))` }}>
        {run.lanes.filter((l) => expanded === null || l.i === expanded).map((l) => (
          <div key={l.i} className={`lane ${run.winner === l.i ? "winner" : ""} ${l.error ? "error" : ""}`}>
            <div className="lane-head">
              <strong>{run.winner !== undefined || l.done ? l.name : `Model ${String.fromCharCode(65 + l.i)}`}</strong>
              {(run.winner !== undefined || l.done) && <span className="hint" style={{ margin: 0 }}>{l.model}</span>}
              <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                {l.latencyMs ? <span className="tag">{l.latencyMs} ms</span> : null}
                <button className="link" onClick={() => setExpanded(expanded === l.i ? null : l.i)}>{expanded === l.i ? "grid" : "expand"}</button>
              </span>
            </div>
            <div className="lane-body bubble" dangerouslySetInnerHTML={{ __html: l.error ? `<em style="color:var(--err)">${l.error}</em>` : renderMarkdown(l.content) + (l.done ? "" : '<span class="caret"/>') }} />
            {!run.running && !l.error && (
              <div className="lane-foot">
                {run.winner === undefined ? <button className="send" onClick={() => onVote(l.i)}>👍 Best</button> : run.winner === l.i ? <span className="ok-text">✓ Your pick</span> : null}
                <button className="ghost" onClick={() => onContinue(l.i)}>Continue with this</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Leaderboard from local votes. */
export function readVotes(): Record<string, { wins: number; runs: number }> {
  try { return JSON.parse(localStorage.getItem("aetheris.arena.votes") ?? "{}"); } catch { return {}; }
}
export function recordVote(lanes: Lane[], winner: number) {
  const v = readVotes();
  for (const l of lanes) { const e = (v[l.provider] ??= { wins: 0, runs: 0 }); e.runs++; if (l.i === winner) e.wins++; }
  localStorage.setItem("aetheris.arena.votes", JSON.stringify(v));
}
