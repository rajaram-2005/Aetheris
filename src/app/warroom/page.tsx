/**
 * War Room — server-rendered page that lists past debates and offers a
 * form to start a new one. The form is a small client component (the
 * streaming SSE is too dynamic for RSC). The list is server-rendered
 * from the same `debates` collection the API writes to.
 *
 *   URL: /warroom
 *   Renders: list of past debates (newest first) + new-debate form.
 *   Honesty: the list shows every saved debate, including the synthetic-
 *   fallback ones, so operators don't get fooled by an empty LLM. The
 *   verdict is the model's, not a fabricated scoreboard.
 */
import Link from "next/link";
import { getUserId } from "@/lib/user";
import { store } from "@/lib/store";
import WarRoomClient from "./WarRoomClient";
import type { WarRoomDebate } from "@/core/warroom/debate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface DebateMeta {
  id: string;
  motion: string;
  pro: string;
  con: string;
  judge: string;
  rounds: number;
  createdAt: number;
  finishedAt: number;
  totalTurns: number;
}

export default async function WarRoomPage({ searchParams }: { searchParams?: { id?: string } }) {
  const { uid } = await getUserId();
  const all = await store.all<WarRoomDebate & { uid: string }>("debates");
  const list: DebateMeta[] = Object.values(all)
    .filter((d) => d.uid === uid)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map((d) => ({
      id: d.id,
      motion: d.motion,
      pro: d.pro,
      con: d.con,
      judge: d.judge,
      rounds: d.rounds,
      createdAt: d.createdAt,
      finishedAt: d.finishedAt,
      totalTurns: d.totalTurns,
    }));

  const activeId = searchParams?.id;
  const active = activeId ? Object.values(all).find((d) => d.uid === uid && d.id === activeId) : null;

  return (
    <div className="warroom">
      <header className="warroom-head">
        <h1>🥊 War Room</h1>
        <p>
          Two specialist agents argue opposite sides of a motion for N rounds, then a judge (Metis) scores
          each side and picks a winner. The full transcript is auditable: every turn records the agent id,
          the system prompt, the messages sent, and the response. With no LLM provider reachable, the
          engine returns a deterministic synthetic transcript labelled as such.
        </p>
      </header>
      <WarRoomClient />
      <section>
        <h2>Past debates</h2>
        {list.length === 0 && <p className="warroom-empty">No debates yet. Start one above.</p>}
        <ul className="warroom-list">
          {list.map((d) => (
            <li key={d.id} className={d.id === activeId ? "warroom-item on" : "warroom-item"}>
              <Link href={`/warroom?id=${encodeURIComponent(d.id)}`}>
                <div className="warroom-motion">{d.motion.length > 120 ? d.motion.slice(0, 120) + "…" : d.motion}</div>
                <div className="warroom-meta">
                  <span>🥊 {d.pro} vs {d.con}</span>
                  <span>·</span>
                  <span>🦉 {d.judge}</span>
                  <span>·</span>
                  <span>{d.rounds} round{d.rounds === 1 ? "" : "s"}</span>
                  <span>·</span>
                  <span>{d.totalTurns} turns</span>
                  <span>·</span>
                  <time dateTime={new Date(d.createdAt).toISOString()}>{new Date(d.createdAt).toLocaleString()}</time>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {active && (
        <section className="warroom-detail">
          <h2>{active.motion}</h2>
          <p className="warroom-meta">
            <span>🥊 {active.pro} vs {active.con}</span>
            <span>·</span>
            <span>🦉 {active.judge}</span>
            <span>·</span>
            <span>{active.rounds} round{active.rounds === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>started {new Date(active.createdAt).toLocaleString()}</span>
          </p>
          <ol className="warroom-transcript">
            {active.turns.map((t, i) => (
              <li key={i} className={`warroom-turn ${t.side}`}>
                <div className="warroom-turn-head">
                  <span className="warroom-icon">{t.icon}</span>
                  <strong>{t.name}</strong>
                  <span className={`warroom-side ${t.side}`}>{t.side === "judge" ? "VERDICT" : t.side === "pro" ? "FOR" : "AGAINST"}</span>
                  <span className="warroom-round">round {t.round}</span>
                  <span className="warroom-provider">{t.provider}</span>
                </div>
                <pre className="warroom-text">{t.text}</pre>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
