/**
 * /autonomy — Autonomy Level indicator.
 *
 *   Lists the 6 levels L0..L5, shows the current level, and lets
 *   the user request a level change. In this build, the level is
 *   advisory: the actual policy gate (planAndGate) still has the
 *   final say. The page makes that explicit.
 *
 *   URL: /autonomy
 *   POST /api/autonomy { level, note } writes the level.
 */
import Link from "next/link";
import { AUTONOMY_LEVELS, getAutonomyLevel, levelName, can, type AutonomyLevel } from "@/core/autonomy/levels";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AutonomyPage({ searchParams }: { searchParams: Promise<{ level?: string; note?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId({ allowAnonymous: true });
  const cfg = await getAutonomyLevel(uid);
  const message = sp.ok ? `Level changed to L${sp.level} (${levelName(Number(sp.level) as AutonomyLevel)}).` : sp.err ?? null;

  return (
    <div className="aut-page">
      <header className="aut-head">
        <h1>🛡 Autonomy Level</h1>
        <p>Six levels L0..L5. The current level determines what Aetheris is <em>allowed to do</em> under the user's authorisation. The actual policy gate (planAndGate) still has the final say — autonomy levels are advisory in this build.</p>
        <div className="aut-current">
          <span>Current: <strong>L{cfg.level} · {levelName(cfg.level)}</strong></span>
          {cfg.updatedAt > 0 && <span className="hint">· set {new Date(cfg.updatedAt).toISOString()} · note: {cfg.note}</span>}
        </div>
        {message && <div className="aut-flash">{message}</div>}
      </header>

      <section className="aut-grid">
        {AUTONOMY_LEVELS.map((def) => {
          const isCurrent = def.level === cfg.level;
          return (
            <article key={def.level} className={"aut-card" + (isCurrent ? " current" : "")}>
              <header className="aut-card-head">
                <h2>L{def.level} · {def.name}</h2>
                {isCurrent && <span className="aut-current-badge">CURRENT</span>}
              </header>
              <p className="aut-desc">{def.description}</p>
              <ul className="aut-caps">
                {def.capability.map((c) => (
                  <li key={c} className={"aut-cap" + (can(cfg.level, c) && cfg.level === def.level ? " on" : "")}>{c}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </section>

      <section className="aut-form-section">
        <h2>Request a level change</h2>
        <form className="aut-form" method="post" action="/api/autonomy">
          <label>Level <select name="level" defaultValue={String(cfg.level)}>
            {AUTONOMY_LEVELS.map((def) => <option key={def.level} value={def.level}>L{def.level} · {def.name}</option>)}
          </select></label>
          <label>Note <input type="text" name="note" maxLength={200} placeholder="Why?" required /></label>
          <button type="submit">Request change</button>
        </form>
        <p className="hint">The change is written to <code>user-config:autonomy:{uid}</code> and takes effect immediately for advisory purposes. The planAndGate policy gate is the source of truth for actual write authorisation.</p>
      </section>

      <footer className="aut-foot">
        <p>
          <Link href="/warroom">/warroom</Link>{" "}
          <Link href="/abstain">/abstain</Link>{" "}
          <Link href="/compare">/compare</Link>{" "}
          <Link href="/dashboard">/dashboard</Link>
        </p>
      </footer>
    </div>
  );
}
