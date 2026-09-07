/**
 * /handoff — Operator Handoff Notes page.
 *
 *   Server-rendered. Shows the handoff notes for a twin
 *   (newest-first), lets the oncoming shift ack existing notes,
 *   and lets any operator post a new note (observation,
 *   decision, open question, escalation).
 *
 *   The store is `handoff-notes`, with each entry containing
 *   twinId, uid, author, at, kind, text, acked.
 *
 *   URL: /handoff?twinId=…&kind=…&author=…&text=…&ack=…
 */
import Link from "next/link";
import { listHandoff, postHandoff, ackHandoff, HANDOFF_KINDS, type HandoffKind, type HandoffNote } from "@/core/handoff/notes";
import { getUserId } from "@/lib/user";
import { listTwins } from "@/core/twins/twins";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function postAction(formData: FormData) {
  "use server";
  const twinId = (formData.get("twinId") ?? "").toString();
  const kind = (formData.get("kind") ?? "observation") as HandoffKind;
  const author = (formData.get("author") ?? "operator").toString();
  const text = (formData.get("text") ?? "").toString();
  if (!twinId || !text) return;
  const { uid } = await getUserId({ allowAnonymous: true });
  await postHandoff({ twinId, uid, author, kind, text });
  revalidatePath(`/handoff?twinId=${twinId}`);
}

async function ackAction(formData: FormData) {
  "use server";
  const id = (formData.get("id") ?? "").toString();
  const twinId = (formData.get("twinId") ?? "").toString();
  if (!id) return;
  await ackHandoff(id);
  revalidatePath(`/handoff?twinId=${twinId}`);
}

function fmtTime(t: number): string {
  return new Date(t).toISOString();
}

export default async function HandoffPage({ searchParams }: { searchParams: Promise<{ twinId?: string }> }) {
  const sp = await searchParams;
  const twins = await listTwins("");
  const { uid } = await getUserId({ allowAnonymous: true });
  const twinId = sp.twinId ?? (twins[0]?.id ?? "");
  const notes: HandoffNote[] = twinId ? await listHandoff(twinId) : [];
  const openCount = notes.filter((n) => !n.acked).length;

  return (
    <div className="ho-page">
      <header className="ho-head">
        <h1>📋 Operator Handoff</h1>
        <p>Notes from the previous shift, for the oncoming operator. Pick a twin, read what's open, ack what you've actioned, and leave your own note (observation, decision, open question, or escalation).</p>
        <form className="ho-form" method="get">
          <label>Twin <input type="text" name="twinId" defaultValue={twinId} list="ho-twin-ids" required /></label>
          <button type="submit">Open</button>
        </form>
        <datalist id="ho-twin-ids">{twins.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</datalist>
        <div className="ho-meta">
          <span>Twin: <code>{twinId || "—"}</code></span>
          <span>·</span>
          <span>Total notes: <strong>{notes.length}</strong></span>
          <span>·</span>
          <span>Open: <strong>{openCount}</strong></span>
        </div>
      </header>

      <section className="ho-post">
        <h2>Leave a note</h2>
        <form action={postAction} className="ho-post-form">
          <input type="hidden" name="twinId" value={twinId} />
          <div className="ho-post-row">
            <label>Author <input type="text" name="author" maxLength={60} defaultValue={"operator-" + uid.slice(0, 6)} required /></label>
            <label>Kind <select name="kind" defaultValue="observation">
              {HANDOFF_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select></label>
          </div>
          <textarea name="text" maxLength={2000} placeholder="What did you observe? What did you decide? What's open?" required rows={4} />
          <button type="submit">Post note</button>
        </form>
      </section>

      <section className="ho-list">
        <h2>Notes (newest first)</h2>
        {notes.length === 0 ? <p className="hint">No notes yet for this twin.</p> : (
          <ul className="ho-items">
            {notes.map((n) => {
              const meta = HANDOFF_KINDS.find((k) => k.kind === n.kind)!;
              return (
                <li key={n.id} className={"ho-item" + (n.acked ? " acked" : "")}>
                  <header className="ho-item-head">
                    <span className="ho-kind" style={{ background: meta.colour }}>{meta.label}</span>
                    <span className="ho-author">{n.author}</span>
                    <span className="ho-time">{fmtTime(n.at)}</span>
                    {n.acked && <span className="ho-acked">ACKED</span>}
                  </header>
                  <p className="ho-text">{n.text}</p>
                  {!n.acked && (
                    <form action={ackAction} className="ho-ack">
                      <input type="hidden" name="id" value={n.id} />
                      <input type="hidden" name="twinId" value={twinId} />
                      <button type="submit">Acknowledge</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="ho-foot">
        <p>
          <Link href="/fleet">/fleet</Link>{" "}
          <Link href="/diagnostics">/diagnostics</Link>{" "}
          <Link href="/maintenance">/maintenance</Link>
        </p>
      </footer>
    </div>
  );
}
