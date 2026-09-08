/**
 * /timeline — the Causal Replay surface.
 *
 *   Server-rendered. Lists every diagnostic event for a given twin in
 *   chronological order, with a per-event causal note that links back
 *   to the previous reading. The user can answer "WHY DID THIS
 *   HAPPEN?" by reading top-to-bottom.
 *
 *   URL: /timeline?twinId=demo-turbine-1
 *   Renders: header + timeline events + bottom-line verdict.
 *   Honest: the causal notes are derived from the actual stored
 *   readings — peak magnitude, dominant frequency, severity — and
 *   from the production BPFO computation. They are not narratives.
 */
import Link from "next/link";
import { buildTimeline } from "@/core/timeline/replay";
import { listTwins } from "@/core/twins/twins";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEVERITY_COLORS: Record<string, string> = {
  ok: "#4ade80",
  watch: "#facc15",
  warning: "#fb923c",
  critical: "#f87171",
};

export default async function TimelinePage({ searchParams }: { searchParams: Promise<{ twinId?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId();
  const twins = await listTwins(uid);
  const selected = sp.twinId ? twins.find((t) => t.id === sp.twinId) : (twins[0] ?? null);
  const tl = selected ? await buildTimeline({ twinId: selected.id, twinName: selected.name }) : null;

  return (
    <div className="tl-page">
      <header className="tl-head">
        <h1>⏱️ Timeline · Causal Replay</h1>
        <p>
          Reconstruct the causal chain of diagnostic events for a single asset. Each event shows the
          severity, peak magnitude, and dominant frequency; the cause note links to the previous reading
          and explains what changed. Same data as the diagnostics history; only the framing changes.
        </p>
      </header>

      <aside className="tl-aside">
        <h2>Assets</h2>
        {twins.length === 0 ? (
          <p className="hint">No twins yet. Create one with <code>POST /api/windturbine op:canon</code>.</p>
        ) : (
          <ul>
            {twins.map((t) => (
              <li key={t.id}>
                <Link href={`/timeline?twinId=${encodeURIComponent(t.id)}`} className={selected?.id === t.id ? "on" : ""}>
                  {t.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="tl-main">
        {tl ? (
          <>
            <div className="tl-meta">
              <span>asset: <strong>{tl.twinName}</strong></span>
              <span>·</span>
              <span>events: <strong>{tl.events.length}</strong></span>
              <span>·</span>
              <span>progression: <strong>{tl.progression.join(" → ") || "none"}</strong></span>
              <span>·</span>
              <span>monotonic worsening: <strong>{tl.monotonicWorsening ? "yes" : "no"}</strong></span>
              <span>·</span>
              <span>BPFO at {tl.rotorRpm} rpm: <strong>{tl.bearingFreqs.outerRace.toFixed(1)} Hz</strong></span>
            </div>
            {tl.events.length === 0 ? (
              <p className="hint">No diagnostic events recorded for this asset yet. Run a diagnostic to populate the timeline.</p>
            ) : (
              <ol className="tl-events">
                {tl.events.map((e, i) => (
                  <li key={i} className={`tl-event sev-${e.severity}`}>
                    <div className="tl-event-head">
                      <span className="tl-event-step">#{i + 1}</span>
                      <span className="tl-event-time">{e.iso.replace("T", " ").slice(0, 16)}</span>
                      <span className="tl-event-sev" style={{ background: SEVERITY_COLORS[e.severity], color: "#0b0d12" }}>{e.severity.toUpperCase()}</span>
                      {e.deltaH !== null && <span className="tl-event-delta">+{e.deltaH.toFixed(1)} h</span>}
                    </div>
                    <div className="tl-event-readings">
                      <span>peak: <strong>{e.peakMagnitude.toFixed(2)} mm/s</strong></span>
                      <span>·</span>
                      <span>dominant: <strong>{e.dominantHz !== null ? `${e.dominantHz.toFixed(1)} Hz` : "n/a"}</strong></span>
                      <span>·</span>
                      <span>fault: <strong>{e.topFault ?? "—"}</strong></span>
                    </div>
                    <p className="tl-event-cause">{e.cause}</p>
                  </li>
                ))}
              </ol>
            )}
            <footer className="tl-foot">
              <p>
                Verdict:{" "}
                {tl.events.length === 0
                  ? "no data"
                  : tl.progression.at(-1) === "critical"
                  ? "the most recent reading is critical; treat as an active incident."
                  : tl.monotonicWorsening
                  ? "the severity is monotonically worsening; the failure progression is real."
                  : "the severity is not strictly worsening; this may be a transient excursion."}
              </p>
            </footer>
          </>
        ) : (
          <p className="hint">Select an asset to view its timeline.</p>
        )}
      </section>
    </div>
  );
}
