import { NextResponse } from "next/server";
import { getUserId, uidCookie } from "@/lib/user";
import { addFact, queryUnified, fabricStatus, listFacts, type SourceKind } from "@/core/knowledge/fabric";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";

/** GET ?q=&workspace=&k=&asOf=&mode=&entity=&tag=&documents=0 → hybrid hits (facts + document KBs unless documents=0) (or recent facts + status when no q). POST {text, workspace?, tags?, source?, ref?, confidence?, validFrom?, validTo?, supersedes?, edges?}. */
export async function GET(req: Request) {
  const { uid, isNew } = await getUserId(); const u = new URL(req.url); const q = u.searchParams.get("q");
  const ws = u.searchParams.get("workspace") ?? undefined;
  let body: unknown;
  try {
    if (q) body = { hits: await queryUnified(uid, q, { includeDocuments: u.searchParams.get("documents") !== "0", workspace: ws, k: Number(u.searchParams.get("k") ?? 8), asOf: u.searchParams.get("asOf") ? Number(u.searchParams.get("asOf")) : undefined, mode: (u.searchParams.get("mode") as "hybrid" | undefined) ?? undefined, entity: u.searchParams.get("entity") ?? undefined, tags: u.searchParams.getAll("tag") }) };
    else body = { status: await fabricStatus(), facts: await listFacts(uid, ws, Number(u.searchParams.get("limit") ?? 50)) };
  } catch (e) { return NextResponse.json({ error: (e as Error).message, status: await fabricStatus() }, { status: 503 }); }
  const res = NextResponse.json(body); if (isNew) res.cookies.set(uidCookie(uid)); return res;
}
export async function POST(req: Request) {
  const { uid, isNew } = await getUserId();
  const b = (await req.json().catch(() => ({}))) as { text?: string; workspace?: string; tags?: string[]; source?: SourceKind; ref?: string; confidence?: number; validFrom?: number; validTo?: number; supersedes?: string; entities?: string[]; edges?: { src: string; rel: string; dst: string; weight?: number }[] };
  if (!b.text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
  try { const fact = await addFact({ uid, workspace: b.workspace, text: b.text, tags: b.tags, entities: b.entities, validFrom: b.validFrom, validTo: b.validTo, supersedes: b.supersedes, edges: b.edges, provenance: { kind: b.source ?? "user", ref: b.ref, confidence: b.confidence ?? 0.9, by: uid } }); const res = NextResponse.json({ fact }, { status: 201 }); if (isNew) res.cookies.set(uidCookie(uid)); return res; }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 503 }); }
}
