/**
 * /arena — Model Arena page.
 *
 *   Server-rendered (with a client form to re-run on demand).
 *   Runs the same prompt against every provider the user has
 *   configured, then shows a side-by-side comparison: provider,
 *   model, content, latency, cost class, status, error. In a
 *   CI env with no API keys the rows say so honestly.
 *
 *   URL: /arena?prompt=…&providers=groq,ollama
 */
import Link from "next/link";
import { runArena, arenaProviderList } from "@/core/arena/compare";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_COLOUR: Record<string, string> = {
  ok: "#4ade80",
  error: "#f87171",
  not_configured: "#9ca3af",
};

export default async function ArenaPage({ searchParams }: { searchParams: Promise<{ prompt?: string; providers?: string }> }) {
  const sp = await searchParams;
  const prompt = sp.prompt ?? "Explain in one sentence what an FFT does.";
  const providerIds = sp.providers ? sp.providers.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const allProviders = arenaProviderList();
  const result = await runArena(prompt, { providerIds });
  return (
    <div className="ar-page">
      <header className="ar-head">
        <h1>🏟 Model Arena</h1>
        <p>Run the same prompt against every provider in parallel, then compare the side-by-side results. In a CI environment with no API keys configured, the rows say so honestly. Production router, real route() calls.</p>
        <form className="ar-form" method="get">
          <label>Prompt <input type="text" name="prompt" defaultValue={prompt} required style={{ minWidth: 400 }} /></label>
          <label>Provider IDs (comma-sep) <input type="text" name="providers" defaultValue={sp.providers ?? ""} placeholder="(all)" /></label>
          <button type="submit">Run</button>
        </form>
        <div className="ar-meta">
          <span>Total: <strong>{result.total}</strong></span>
          <span>·</span>
          <span>Configured: <strong>{result.configured}</strong></span>
          <span>·</span>
          <span>OK: <strong style={{ color: STATUS_COLOUR.ok }}>{result.succeeded}</strong></span>
          <span>·</span>
          <span>Failed: <strong style={{ color: STATUS_COLOUR.error }}>{result.failed}</strong></span>
          <span>·</span>
          <span>Best: <strong>{result.best ? `${result.best.providerId} (${result.best.latencyMs}ms)` : "—"}</strong></span>
        </div>
      </header>

      <section className="ar-rows">
        {result.rows.map((row) => (
          <article key={row.providerId} className={`ar-row ar-status-${row.status}`}>
            <header className="ar-row-head">
              <h2>{row.providerName}</h2>
              <span className="ar-provider-id"><code>{row.providerId}</code></span>
              <span className="ar-model"><code>{row.model}</code></span>
              <span className="ar-status" style={{ color: STATUS_COLOUR[row.status] }}>{row.status}</span>
              <span className="ar-latency">{row.latencyMs} ms</span>
            </header>
            <div className="ar-row-body">
              {row.status === "ok" && <pre className="ar-content">{row.content}</pre>}
              {row.status !== "ok" && <p className="ar-error">{row.error}</p>}
            </div>
            <footer className="ar-row-foot">
              <span>cost class: <code>{row.costClass}</code></span>
              <span>·</span>
              <span>locality: <code>{row.locality}</code></span>
            </footer>
          </article>
        ))}
      </section>

      <section className="ar-all-providers">
        <h2>All providers ({allProviders.length})</h2>
        <table className="ar-table">
          <thead>
            <tr><th>ID</th><th>Name</th><th>Cost class</th><th>Locality</th><th>Configured</th></tr>
          </thead>
          <tbody>
            {allProviders.map((p) => (
              <tr key={p.id}>
                <td><code>{p.id}</code></td>
                <td>{p.name}</td>
                <td><code>{p.costClass}</code></td>
                <td>{p.locality}</td>
                <td>{p.configured ? "✓" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="ar-foot">
        <p>
          <Link href="/dashboard">/dashboard</Link>{" "}
          <Link href="/compare">/compare</Link>{" "}
          <Link href="/trust">/trust</Link>
        </p>
      </footer>
    </div>
  );
}
