/**
 * /episodes — RAVANA Episode Ledger.
 *
 *   Server-rendered view of every finished RAVANA task for the current
 *   user. Each row is grounded in a real task record (plan, events,
 *   verification, models, tools, duration). Live/running tasks are
 *   excluded. Nothing is invented.
 *
 *   Detail view: /episodes?id=rvn_…
 *   Export:      /api/v1/ravana/episodes?format=csv|json
 */
import Link from "next/link";
import { getUserId } from "@/lib/user";
import { getEpisode, listEpisodes, type Episode, type EpisodeDetail } from "@/core/ravana/episodes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fmtDate(t: number | null): string {
  if (t === null || !t) return "—";
  return new Date(t).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function fmtDur(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function fmtPct(n: number | null): string {
  if (n === null) return "—";
  return `${Math.round(n * 1000) / 10}%`;
}

const STATUS_COLOUR: Record<string, string> = {
  completed: "#4ade80",
  failed: "#f87171",
  cancelled: "#9ca3af",
  timeout: "#fb923c",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className="ep-pill" style={{ color: STATUS_COLOUR[status] ?? "#e5e7eb", borderColor: STATUS_COLOUR[status] ?? "#e5e7eb" }}>
      {status}
    </span>
  );
}

function StatsBar({
  stats,
  total,
}: {
  stats: Awaited<ReturnType<typeof listEpisodes>>["stats"];
  total: number;
}) {
  return (
    <div className="ep-meta">
      <span>
        Episodes: <strong>{total}</strong>
      </span>
      <span>
        · Completed: <strong>{stats.completed}</strong>
      </span>
      <span>
        · Failed: <strong>{stats.failed}</strong>
      </span>
      <span>
        · Success: <strong>{fmtPct(stats.successRate)}</strong>
      </span>
      <span>
        · Avg duration: <strong>{fmtDur(stats.avgDurationMs)}</strong>
      </span>
      <span>
        · Model calls: <strong>{stats.totalModelCalls}</strong>
      </span>
      <span>
        · Tool calls: <strong>{stats.totalToolCalls}</strong>
      </span>
    </div>
  );
}

function EpisodeRow({ e }: { e: Episode }) {
  return (
    <tr className={`ep-row ep-row-${e.status}`}>
      <td>
        <Link href={`/episodes?id=${e.id}`}>{e.title || e.id}</Link>
        <div className="ep-id">
          <code>{e.id}</code>
        </div>
      </td>
      <td>
        <code>{e.kind}</code>
      </td>
      <td>
        <StatusPill status={e.status} />
      </td>
      <td>
        <code>{e.engineResolved ?? e.engine}</code>
      </td>
      <td>{fmtDur(e.durationMs)}</td>
      <td>
        {e.nodes.passed}/{e.nodes.total}
        {e.nodes.failed > 0 ? <span className="ep-fail"> · {e.nodes.failed} fail</span> : null}
      </td>
      <td>
        {e.verification ? (
          <span style={{ color: e.verification.status.startsWith("passed") ? "#4ade80" : e.verification.status === "failed" ? "#f87171" : undefined }}>
            {e.verification.status}
            {e.verification.score !== null ? ` · ${e.verification.score}` : ""}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td>{fmtDate(e.finishedAt)}</td>
    </tr>
  );
}

function DetailView({ ep }: { ep: EpisodeDetail }) {
  return (
    <div className="ep-detail">
      <header className="ep-head">
        <p className="ep-back">
          <Link href="/episodes">← all episodes</Link>
        </p>
        <h1>🧾 {ep.title || ep.id}</h1>
        <p className="ep-objective">{ep.objective}</p>
        <div className="ep-meta">
          <StatusPill status={ep.status} />
          <span>
            · kind <code>{ep.kind}</code>
          </span>
          <span>
            · engine <code>{ep.engineResolved ?? ep.engine}</code>
          </span>
          <span>
            · duration <strong>{fmtDur(ep.durationMs)}</strong>
          </span>
          <span>
            · finished <strong>{fmtDate(ep.finishedAt)}</strong>
          </span>
          <span>
            · id <code>{ep.id}</code>
          </span>
        </div>
        {ep.error ? <p className="ep-error">Error: {ep.error}</p> : null}
        {ep.kindReason ? (
          <p className="hint">
            Classified as <code>{ep.kind}</code>: {ep.kindReason}
          </p>
        ) : null}
      </header>

      <section className="ep-section">
        <h2>Plan ({ep.plan.length} nodes)</h2>
        {ep.plan.length === 0 ? (
          <p className="hint">No plan nodes recorded.</p>
        ) : (
          <table className="ep-table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Type</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Tools</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {ep.plan.map((n) => (
                <tr key={n.id}>
                  <td>
                    <code>{n.id}</code>
                  </td>
                  <td>{n.type}</td>
                  <td>
                    <StatusPill status={n.status === "passed" ? "completed" : n.status === "failed" ? "failed" : n.status} />
                  </td>
                  <td>{n.attempts}</td>
                  <td>{n.tools.length ? n.tools.join(", ") : "—"}</td>
                  <td>{n.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="ep-section">
        <h2>Execution trace ({ep.timeline.length} events)</h2>
        <p className="hint">Execution-trace events only — never hidden chain-of-thought. Same vocabulary the RAVANA SSE stream emits.</p>
        {ep.timeline.length === 0 ? (
          <p className="hint">No events recorded.</p>
        ) : (
          <ol className="ep-timeline">
            {ep.timeline.map((ev) => (
              <li key={`${ev.seq}-${ev.at}`}>
                <span className="ep-tl-seq">#{ev.seq}</span>
                <code className="ep-tl-type">{ev.type}</code>
                <span className="ep-tl-at">{fmtDate(ev.at)}</span>
                <span className="ep-tl-sum">{ev.summary}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="ep-section">
        <h2>Verification</h2>
        {ep.verificationFull ? (
          <div className="ep-ver">
            <div className="ep-meta">
              <span>
                strategy <code>{ep.verificationFull.strategy}</code>
              </span>
              <span>
                · status <StatusPill status={ep.verificationFull.status.startsWith("passed") ? "completed" : ep.verificationFull.status === "failed" ? "failed" : "cancelled"} />
              </span>
              {ep.verificationFull.score !== undefined ? (
                <span>
                  · score <strong>{ep.verificationFull.score}</strong>
                </span>
              ) : null}
              {ep.verificationFull.independent !== undefined ? (
                <span>
                  · independent <strong>{String(ep.verificationFull.independent)}</strong>
                </span>
              ) : null}
            </div>
            {ep.verificationFull.detail ? <p className="hint">{ep.verificationFull.detail}</p> : null}
            {ep.verificationFull.findings?.length ? (
              <ul className="ep-findings">
                {ep.verificationFull.findings.map((f, i) => (
                  <li key={i}>
                    <code>{f.severity}</code> {f.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No findings.</p>
            )}
          </div>
        ) : (
          <p className="hint">No verification record on this episode.</p>
        )}
      </section>

      <section className="ep-section">
        <h2>Models & tools</h2>
        <div className="ep-two">
          <div>
            <h3>Models</h3>
            {ep.modelsUsed.length === 0 ? (
              <p className="hint">None recorded.</p>
            ) : (
              <ul>
                {ep.modelsUsed.map((m, i) => (
                  <li key={i}>
                    <code>{m.role}</code> · {m.provider}/{m.model} · {m.calls} call{m.calls === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3>Tools</h3>
            {ep.toolsUsed.length === 0 ? (
              <p className="hint">None recorded.</p>
            ) : (
              <ul>
                {ep.toolsUsed.map((t, i) => (
                  <li key={i}>
                    <code>{t.name}</code> · {t.calls} call{t.calls === 1 ? "" : "s"} · ok {t.ok} · fail {t.failed}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="ep-section">
        <h2>Result</h2>
        {ep.result ? (
          <div>
            <p>
              type <code>{ep.result.type}</code>
              {ep.result.files.length ? (
                <>
                  {" "}
                  · files: {ep.result.files.map((f) => (
                    <code key={f} className="ep-file">
                      {f}
                    </code>
                  ))}
                </>
              ) : null}
            </p>
            <pre className="ep-result">{ep.result.content}</pre>
          </div>
        ) : (
          <p className="hint">No result content stored.</p>
        )}
      </section>

      <footer className="ep-foot">
        <p>
          <Link href="/episodes">← ledger</Link> · <Link href="/api/v1/ravana/episodes?format=json">JSON export</Link> ·{" "}
          <Link href="/api/v1/ravana/episodes?format=csv">CSV export</Link>
        </p>
      </footer>
    </div>
  );
}

export default async function EpisodesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { uid } = await getUserId({ allowAnonymous: true });
  const sp = (await searchParams) ?? {};
  const idRaw = sp.id;
  const id = typeof idRaw === "string" ? idRaw : Array.isArray(idRaw) ? idRaw[0] : undefined;

  if (id) {
    const ep = await getEpisode(uid, id);
    if (!ep) {
      return (
        <div className="ep-page">
          <header className="ep-head">
            <h1>🧾 Episode not found</h1>
            <p className="hint">
              No terminal RAVANA task <code>{id}</code> for this uid. Live/running tasks are not episodes.{" "}
              <Link href="/episodes">Back to ledger →</Link>
            </p>
          </header>
        </div>
      );
    }
    return (
      <div className="ep-page">
        <DetailView ep={ep} />
      </div>
    );
  }

  const list = await listEpisodes(uid, { limit: 100 });

  return (
    <div className="ep-page">
      <header className="ep-head">
        <h1>🧾 RAVANA Episode Ledger</h1>
        <p>
          Every <strong>finished</strong> RAVANA task for this workspace — completed, failed, cancelled or timed out.
          Each row is grounded in a stored task record (plan, execution-trace events, verification, models, tools,
          duration). Live/running tasks are excluded. Nothing here is invented.
        </p>
        <StatsBar stats={list.stats} total={list.total} />
        <p className="ep-actions">
          <a className="ep-btn" href="/api/v1/ravana/episodes?format=json">
            Export JSON
          </a>
          <a className="ep-btn" href="/api/v1/ravana/episodes?format=csv">
            Export CSV
          </a>
          <Link className="ep-btn ghost" href="/docs">
            Docs
          </Link>
        </p>
      </header>

      <section className="ep-section">
        <h2>Episodes</h2>
        {list.episodes.length === 0 ? (
          <p className="hint">
            No finished RAVANA tasks yet. Open the <strong>🔱 RAVANA</strong> mode in the sidebar, run an objective
            (preview engine works offline), and the completed task will appear here.
          </p>
        ) : (
          <table className="ep-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Engine</th>
                <th>Duration</th>
                <th>Nodes</th>
                <th>Verify</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {list.episodes.map((e) => (
                <EpisodeRow key={e.id} e={e} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="ep-section ep-notes">
        <h2>Honest scope</h2>
        <p>
          <strong>Proves:</strong> {list.notes.proves}
        </p>
        <p>
          <strong>Does not prove:</strong> {list.notes.doesNotProve}
        </p>
      </section>

      <footer className="ep-foot">
        <p>
          API: <code>GET /api/v1/ravana/episodes</code> · detail <code>?id=</code> · export <code>?format=json|csv</code>
        </p>
        <p className="hint">
          Capability <code>ravana:episodes</code> at <code>read_only</code>. Cross-uid isolation enforced. This ledger is
          the seed surface for a future RAVANA-Bench export — it is not a benchmark itself.
        </p>
      </footer>
    </div>
  );
}
