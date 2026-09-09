/**
 * /agents — the Agent Inspector.
 *
 *   Server-rendered page that lists every agent in the Aetheris catalog
 *   with their tier, domain, skills, system prompt (truncated to keep
 *   the page light), and any tool grants. The selected agent gets a
 *   full detail panel on the right.
 *
 *   The catalog is the same one the agent orchestrator uses at runtime
 *   (src/lib/agents/catalog.ts), so the page can never drift from what
 *   the planner actually selects.
 *
 *   Honest: the per-agent "state" is the catalog spec itself — not a
 *   live runtime trace. The orchestrator keeps that trace in memory and
 *   is not persisted (yet). The page shows the spec; the runtime trace
 *   is exposed via /api/agents/[id]/trace once we add a persistence
 *   layer for it.
 */
import { AGENTS } from "@/lib/agents/catalog";
import type { AgentSpec } from "@/lib/agents/types";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIER_COLOURS: Record<string, string> = {
  ultra: "#a78bfa",
  god: "#fbbf24",
  specialist: "#38bdf8",
  sub: "#94a3b8",
};

const TIER_ORDER: Record<string, number> = { ultra: 0, god: 1, specialist: 2, sub: 3 };

function sortByTier(a: AgentSpec, b: AgentSpec): number {
  return (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const sp = await searchParams;
  const sorted = AGENTS.slice().sort(sortByTier);
  const selected = (sp?.id ? AGENTS.find((a) => a.id === sp.id) : null) ?? sorted.find((a) => a.tier === "ultra") ?? sorted[0];

  return (
    <div className="ag-page">
      <header className="ag-head">
        <h1>🤖 Agent Inspector</h1>
        <p>
          Every agent in the Aetheris catalog, with tier, domain, skills, and the system prompt the
          orchestrator appends to the Hermes base at runtime. The same catalog drives the planner's
          selection and the @mention picker, so this page cannot drift from production routing.
        </p>
        <div className="ag-meta">
          <span>total: <strong>{AGENTS.length}</strong> agents</span>
          <span>·</span>
          <span>tiers: <strong>{Object.keys(TIER_ORDER).length}</strong></span>
          <span>·</span>
          <span>domains: <strong>{new Set(AGENTS.map((a) => a.domain)).size}</strong></span>
        </div>
      </header>

      <div className="ag-grid">
        <aside className="ag-list">
          <ul>
            {sorted.map((a) => {
              const colour = TIER_COLOURS[a.tier] ?? "#94a3b8";
              return (
                <li key={a.id}>
                  <Link
                    href={`/agents?id=${encodeURIComponent(a.id)}`}
                    className={selected?.id === a.id ? "on" : ""}
                  >
                    <span className="ag-icon">{a.icon}</span>
                    <span className="ag-name">{a.name}</span>
                    <span className="ag-tier" style={{ background: colour }}>{a.tier}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="ag-detail">
          {selected ? <AgentDetail a={selected} /> : <p>No agent selected.</p>}
        </section>
      </div>
    </div>
  );
}

function AgentDetail({ a }: { a: AgentSpec }) {
  const colour = TIER_COLOURS[a.tier] ?? "#94a3b8";
  return (
    <article className="ag-card">
      <header className="ag-card-head">
        <span className="ag-icon-big">{a.icon}</span>
        <div>
          <h2>{a.name}</h2>
          <p className="ag-sub">id <code>{a.id}</code> · tier <span style={{ color: colour }}>{a.tier}</span> · domain <code>{a.domain}</code></p>
        </div>
      </header>
      <p className="ag-desc">{a.description}</p>
      <h3>Skills</h3>
      <ul className="ag-skills">
        {a.skills.map((s) => <li key={s}>{s}</li>)}
      </ul>
      {a.aliases && a.aliases.length > 0 && (
        <>
          <h3>Aliases</h3>
          <p className="ag-aliases">{a.aliases.map((al) => <code key={al}>@{al}</code>)}</p>
        </>
      )}
      {a.tools && a.tools.length > 0 && (
        <>
          <h3>Tool grants</h3>
          <p className="ag-tools">{a.tools.map((t) => <code key={t}>{t}</code>)}</p>
        </>
      )}
      <h3>System prompt (preview)</h3>
      <pre className="ag-system">{truncate(a.system, 1200)}</pre>
      <h3>Inspector trace</h3>
      <p className="ag-honest">
        The runtime execution trace (which tools fired, what evidence came back, how long it took) lives
        in process memory while the agent is running. A persisted trace is on the roadmap; the live
        picker shows the same spec the planner sees.
      </p>
    </article>
  );
}
