/**
 * /twins/edit — Twin Edit / Write page.
 *
 *   Server-rendered shell that lets the user pick a twin and
 *   apply one of six mutations: setName, setState, addBound,
 *   removeBound, addRule, addMaintenance. Each form posts to
 *   /api/twins/edit, which calls the production edit engine.
 */
import Link from "next/link";
import { listTwins } from "@/core/twins/twins";
import { getUserId } from "@/lib/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPS = [
  { op: "setName", label: "Set name", fields: [{ name: "name", label: "New name" }] },
  { op: "setState", label: "Set state", fields: [{ name: "key", label: "Key" }, { name: "value", label: "Value" }] },
  { op: "addBound", label: "Add bound", fields: [{ name: "key", label: "Key" }, { name: "min", label: "Min" }, { name: "max", label: "Max" }] },
  { op: "removeBound", label: "Remove bound", fields: [{ name: "key", label: "Key" }] },
  { op: "addRule", label: "Add rule", fields: [{ name: "target", label: "Target" }, { name: "expr", label: "Expr" }] },
  { op: "addMaintenance", label: "Add maintenance", fields: [{ name: "note", label: "Note" }, { name: "nextDue", label: "Next due (ms)" }] },
];

export default async function TwinEditPage({ searchParams }: { searchParams: Promise<{ id?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId({ allowAnonymous: true });
  const twins = await listTwins(uid);
  const id = sp.id ?? (twins[0]?.id ?? "");
  return (
    <div className="te-page">
      <header className="te-head">
        <h1>✏ Twin Edit</h1>
        <p>Apply a typed mutation to a twin via the production <code>edit.ts</code> engine. The POST is sent to <code>/api/twins/edit</code>, which validates ownership, validates the input, appends a <code>device</code>-typed event, and saves the twin.</p>
        <form className="te-pick" method="get">
          <label>Twin <input type="text" name="id" defaultValue={id} list="te-twin-ids" required /></label>
          <button type="submit">Open</button>
        </form>
        <datalist id="te-twin-ids">{twins.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</datalist>
        {sp.ok && <p className="te-flash ok">Mutation succeeded.</p>}
        {sp.err && <p className="te-flash err">Error: {sp.err}</p>}
      </header>

      <section className="te-grid">
        {OPS.map((o) => (
          <article key={o.op} className="te-card">
            <h2>{o.label} <code>{o.op}</code></h2>
            <form action="/api/twins/edit" method="post" className="te-form">
              <input type="hidden" name="op" value={o.op} />
              <input type="hidden" name="id" value={id} />
              {o.op === "addBound" ? (
                <input type="hidden" name="bound" value={JSON.stringify({ key: "", min: undefined, max: undefined })} />
              ) : null}
              {o.fields.map((f) => (
                <label key={f.name}>{f.label} <input type="text" name={f.name} required /></label>
              ))}
              <button type="submit">Apply</button>
            </form>
          </article>
        ))}
      </section>

      <footer className="te-foot">
        <p>
          <Link href="/fleet">/fleet</Link>{" "}
          <Link href="/diagnostics">/diagnostics</Link>{" "}
          <Link href="/dashboard">/dashboard</Link>
        </p>
      </footer>
    </div>
  );
}
