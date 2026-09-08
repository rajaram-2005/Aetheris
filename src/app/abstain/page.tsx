/**
 * /abstain — the "I don't know" surface from the original Aetheris
 * vision section 30.
 *
 *   Server-rendered. Shows the user exactly which evidence items
 *   are present and which are missing, and what action NIRNAYA
 *   recommends. If confidence is high, the page says so; if it's
 *   not, the page says it is abstaining and shows the path forward.
 *
 *   URL: /abstain?q=…&twinId=…&rotorRpm=…
 */
import { buildAbstainReport } from "@/core/abstain/inspector";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTION_COLOURS: Record<string, string> = {
  collect: "#38bdf8",
  escalate: "#facc15",
  safe_state: "#f87171",
};

const ACTION_LABEL: Record<string, string> = {
  collect: "COLLECT",
  escalate: "ESCALATE",
  safe_state: "SAFE STATE",
};

export default async function AbstainPage({ searchParams }: { searchParams: Promise<{ q?: string; twinId?: string; rotorRpm?: string }> }) {
  const sp = await searchParams;
  const question = sp.q ?? "Diagnose the current asset state";
  const twinId = sp.twinId ?? null;
  const rotorRpm = sp.rotorRpm ? Number(sp.rotorRpm) : 1500;
  const r = await buildAbstainReport({ question, twinId, rotorRpm });
  const present = r.items.filter((i) => i.present);
  const missing = r.items.filter((i) => !i.present);
  const confidenceColor = r.confidence === "high" ? "#4ade80" : r.confidence === "medium" ? "#facc15" : "#f87171";

  return (
    <div className="abs-page">
      <header className="abs-head">
        <h1>🦉 NIRNAYA · Insufficient-Evidence Inspector</h1>
        <p>
          The honest "I don't know" surface. Aetheris enumerates 8 standard evidence items, marks
          which are present, and recommends an action: <strong>COLLECT</strong> (gather more data),
          <strong> ESCALATE</strong> (hand to a human), or <strong>SAFE STATE</strong> (some
          safety-critical evidence is missing; do not act).
        </p>
        <form className="abs-form" method="get">
          <label>Question <input type="text" name="q" defaultValue={question} /></label>
          <label>Twin ID <input type="text" name="twinId" defaultValue={twinId ?? ""} placeholder="e.g. demo-turbine-1" /></label>
          <label>Rotor rpm <input type="number" name="rotorRpm" min={500} max={3000} defaultValue={rotorRpm} /></label>
          <button type="submit">Reassess</button>
        </form>
        <div className="abs-meta">
          <span>confidence: <strong style={{ color: confidenceColor }}>{r.confidence.toUpperCase()}</strong></span>
          <span>·</span>
          <span>verdict: <strong>{r.verdict.toUpperCase()}</strong></span>
          <span>·</span>
          <span>evidence: <strong>{r.presentCount} / {r.totalCount}</strong></span>
          <span>·</span>
          <span>action: <strong style={{ color: ACTION_COLOURS[r.recommendedAction] }}>{ACTION_LABEL[r.recommendedAction]}</strong></span>
        </div>
      </header>

      <section className="abs-columns">
        <div>
          <h2>✓ Present ({present.length})</h2>
          {present.length === 0 ? <p className="hint">No evidence items present.</p> : (
            <ul className="abs-items present">
              {present.map((i) => (
                <li key={i.kind} className="abs-item">
                  <span className="abs-item-kind">{i.kind}</span>
                  <span className="abs-item-label">{i.label}</span>
                  {i.detail && <span className="abs-item-detail">{i.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2>✗ Missing ({missing.length})</h2>
          {missing.length === 0 ? <p className="hint">All evidence items present.</p> : (
            <ul className="abs-items missing">
              {missing.map((i) => (
                <li key={i.kind} className="abs-item">
                  <span className="abs-item-kind">{i.kind}</span>
                  <span className="abs-item-label">{i.label}</span>
                  {i.detail && <span className="abs-item-detail">{i.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="abs-honesty">
        <h2>Honesty line</h2>
        <pre>{r.honestyLine}</pre>
      </section>

      <footer className="abs-foot">
        <p>
          <Link href="/diagnostics">/diagnostics</Link>{" "}
          <Link href="/timeline">/timeline</Link>{" "}
          <Link href="/world-model">/world-model</Link>{" "}
          <Link href="/warroom">/warroom</Link>
        </p>
      </footer>
    </div>
  );
}
