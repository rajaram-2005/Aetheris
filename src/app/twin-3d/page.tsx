/**
 * /twin-3d?twinId=… — server-rendered page that lists the user's
 * wind-turbine twins and hands the selected one to the client-side
 * TwinViewer3D. The page does no rendering work itself; the canvas
 * is a client component.
 */
import Link from "next/link";
import { getUserId } from "@/lib/user";
import { listTwins } from "@/core/twins/twins";
import TwinViewer3D from "@/components/TwinViewer3D";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Twin3DPage({ searchParams }: { searchParams: Promise<{ twinId?: string }> }) {
  const sp = await searchParams;
  const { uid } = await getUserId();
  const twins = (await listTwins(uid)).filter((t) => t.kind === "wind-turbine");
  const selected = sp.twinId ? twins.find((t) => t.id === sp.twinId) : twins[0];
  return (
    <div className="twin3d-page">
      <header className="twin3d-page-head">
        <h1>🌀 Twin Viewer 3D</h1>
        <p>
          A wireframe of the canonical 2 MW wind-turbine geometry, with each
          twin's state overlaid at the relevant vertex. Honest scope: this is
          a typed wireframe, not a CAD/CFD render. The colours come from the
          same severity logic the <Link href="/diagnostics">diagnostics</Link> page uses.
        </p>
      </header>
      <div className="twin3d-page-grid">
        <aside className="twin3d-page-aside">
          <h2>Turbines</h2>
          {twins.length === 0 ? (
            <p className="hint">No wind-turbine twins yet. Create one with <code>POST /api/windturbine op:canon</code>.</p>
          ) : (
            <ul>
              {twins.map((t) => (
                <li key={t.id}>
                  <Link href={`/twin-3d?twinId=${encodeURIComponent(t.id)}`} className={selected?.id === t.id ? "on" : ""}>
                    {t.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <main className="twin3d-page-main">
          {selected ? (
            <TwinViewer3D twinId={selected.id} />
          ) : (
            <p className="hint">Create or select a wind-turbine twin to view it in 3D.</p>
          )}
        </main>
      </div>
    </div>
  );
}
