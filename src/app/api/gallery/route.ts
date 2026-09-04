import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getUserId, uidCookie } from "@/lib/user";
import { getSessionAccount } from "@/lib/auth/accounts";
import { store } from "@/lib/store";
import { SEED } from "@/lib/gallery/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface GalleryItem { id: string; title: string; description: string; prompt: string; agents: string[]; tags: string[]; author: { uid: string; name: string }; createdAt: number; uses: number; likes: number; likedBy?: string[] }
const COL = "gallery";

async function all(): Promise<GalleryItem[]> {
  const items = Object.values(await store.all<GalleryItem>(COL));
  if (items.length === 0) { for (const s of SEED) await store.set(COL, s.id, s); return SEED; }
  return items;
}

/** GET ?q=&tag=&mine=1 → items sorted by popularity. */
export async function GET(req: Request) {
  const { uid } = await getUserId();
  const u = new URL(req.url); const q = (u.searchParams.get("q") ?? "").toLowerCase(); const tag = u.searchParams.get("tag"); const mine = u.searchParams.get("mine");
  let items = await all();
  if (mine) items = items.filter((i) => i.author.uid === uid);
  if (tag) items = items.filter((i) => i.tags.includes(tag));
  if (q) items = items.filter((i) => [i.title, i.description, i.prompt, ...i.tags, ...i.agents].join(" ").toLowerCase().includes(q));
  items.sort((a, b) => (b.likes * 3 + b.uses) - (a.likes * 3 + a.uses) || b.createdAt - a.createdAt);
  const tags = Array.from(new Set((await all()).flatMap((i) => i.tags))).sort();
  return NextResponse.json({ items: items.map((i) => ({ ...i, liked: i.likedBy?.includes(uid) ?? false, likedBy: undefined, mine: i.author.uid === uid })), tags });
}

/** POST { title, description, prompt, agents?, tags? } → publish. */
export async function POST(req: Request) {
  const { uid, isNew } = await getUserId();
  const acc = await getSessionAccount();
  const b = (await req.json().catch(() => ({}))) as Partial<GalleryItem> & { agents?: string[] | string; tags?: string[] | string };
  const title = String(b.title ?? "").trim().slice(0, 80); const prompt = String(b.prompt ?? "").trim().slice(0, 8000);
  if (!title || !prompt) return NextResponse.json({ error: "title and prompt required" }, { status: 400 });
  const list = (v: string[] | string | undefined) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => s.trim().replace(/^@/, "").toLowerCase()).filter(Boolean).slice(0, 8);
  const item: GalleryItem = { id: randomBytes(5).toString("base64url"), title, description: String(b.description ?? "").trim().slice(0, 200), prompt, agents: list(b.agents), tags: list(b.tags), author: { uid, name: acc?.name ?? acc?.email?.split("@")[0] ?? `guest-${uid.slice(0, 4)}` }, createdAt: Date.now(), uses: 0, likes: 0, likedBy: [] };
  await store.set(COL, item.id, item);
  const res = NextResponse.json({ item });
  if (isNew) res.cookies.set(uidCookie(uid));
  return res;
}
