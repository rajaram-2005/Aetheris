/**
 * /knowledge-graph — Knowledge Graph Explorer.
 *
 *   Server-rendered. Shows the user's knowledge fabric as a
 *   graph: top entities by degree, top relations, most-connected
 *   entity, and a depth-1 subgraph around a chosen entity. The
 *   data is read from the production knowledge fabric — no
 *   fabricated nodes.
 *
 *   URL: /knowledge-graph?seed=1&center=…&depth=…
 */
import Link from "next/link";
import { knowledgeGraph, seedDemoGraph, subgraph } from "@/core/knowledge/graph";
import { getUserId } from "@/lib/user";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function seedAction(formData: FormData) {
  "use server";
  const { uid } = await getUserId({ allowAnonymous: true });
  await seedDemoGraph(uid);
  revalidatePath("/knowledge-graph");
}

export default async function KnowledgeGraphPage({ searchParams }: { searchParams: Promise<{ center?: string; depth?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId({ allowAnonymous: true });
  const g = await knowledgeGraph(uid);
  const center = sp.center ?? g.hubEntity;
  const depth = Math.min(3, Math.max(1, Number(sp.depth ?? "1")));
  const sub = center ? await subgraph(uid, center, depth) : null;
  return (
    <div className="kg-page">
      <header className="kg-head">
        <h1>🕸 Knowledge Graph</h1>
        <p>The user's knowledge fabric, viewed as a graph. Every node and every edge comes from the production knowledge fabric — no fabricated entities. The most-connected entity is shown as the hub; pick any entity to see its depth-1 neighbourhood.</p>
        <div className="kg-meta">
          <span>Facts: <strong>{g.totalFacts}</strong></span>
          <span>·</span>
          <span>Edges: <strong>{g.totalEdges}</strong></span>
          <span>·</span>
          <span>Entities: <strong>{g.totalEntities}</strong></span>
          <span>·</span>
          <span>Hub: <strong>{g.hubEntity ?? "—"}</strong></span>
        </div>
      </header>

      {g.totalEntities === 0 && (
        <section className="kg-empty">
          <p>No facts yet. Seed a small demo graph to explore the view.</p>
          <form action={seedAction}>
            <button type="submit">Seed demo graph</button>
          </form>
        </section>
      )}

      <section className="kg-cols">
        <div>
          <h2>Top entities</h2>
          <table className="kg-table">
            <thead>
              <tr><th>Entity</th><th>In</th><th>Out</th><th>Total</th><th>Top relations</th></tr>
            </thead>
            <tbody>
              {g.nodes.map((n) => (
                <tr key={n.entity} className={n.entity === center ? "kg-current" : ""}>
                  <td><Link href={`/knowledge-graph?center=${encodeURIComponent(n.entity)}&depth=${depth}`}>{n.entity}</Link></td>
                  <td>{n.inDegree}</td>
                  <td>{n.outDegree}</td>
                  <td>{n.totalDegree}</td>
                  <td>{n.topRelations.slice(0, 3).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h2>Top relations</h2>
          <table className="kg-table">
            <thead><tr><th>Relation</th><th>Count</th></tr></thead>
            <tbody>
              {g.topRelations.map((r) => (
                <tr key={r.rel}><td>{r.rel}</td><td>{r.count}</td></tr>
              ))}
            </tbody>
          </table>

          {sub && (
            <div className="kg-sub">
              <h3>Subgraph @ {sub.center} (depth {depth})</h3>
              <p className="hint">{sub.nodes.length} nodes · {sub.edges.length} edges</p>
              <ul className="kg-sub-edges">
                {sub.edges.map((e) => (
                  <li key={e.id}><code>{e.src}</code> — <strong>{e.rel}</strong> → <code>{e.dst}</code></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="kg-recent">
        <h2>Recent facts</h2>
        {g.recentFacts.length === 0 ? <p className="hint">No facts yet.</p> : (
          <ul className="kg-recent-list">
            {g.recentFacts.map((f) => (
              <li key={f.id}>
                <code>{new Date(f.at).toISOString()}</code> — {f.text}
                {f.tags.length > 0 && <span className="kg-tags"> [{f.tags.join(", ")}]</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="kg-foot">
        <p>
          <Link href="/dashboard">/dashboard</Link>{" "}
          <Link href="/chat">/chat</Link>{" "}
          <Link href="/compare">/compare</Link>
        </p>
      </footer>
    </div>
  );
}
