import { NextResponse } from "next/server";
import { generateMedia } from "@/lib/media/router";
import { MediaError, type MediaKind } from "@/lib/media/types";
import { getUserId } from "@/lib/user";
import { hasFeature } from "@/lib/billing/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    kind?: MediaKind; prompt?: string; keys?: Record<string, string>; preferred?: string; voice?: string;
  };
  if (!body.kind || !["image", "audio", "video"].includes(body.kind)) return NextResponse.json({ error: "kind must be image|audio|video" }, { status: 400 });
  const prompt = body.prompt?.trim();
  if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });
  if (prompt.length > 4000) return NextResponse.json({ error: "prompt too long" }, { status: 413 });

  // Video is a Pro feature — unless the user brings their own key (their credits, their call).
  if (body.kind === "video") {
    const { uid } = await getUserId();
    const byok = Boolean(body.keys?.luma || body.keys?.runway);
    if (!byok && !(await hasFeature(uid, "video"))) {
      return NextResponse.json({ error: "Pro Video Generation requires Aetheris Pro (or your own Luma/Runway key).", code: "upgrade", feature: "video" }, { status: 402 });
    }
  }

  try {
    const r = await generateMedia({ kind: body.kind, prompt, userKeys: body.keys, preferred: body.preferred, voice: body.voice, signal: req.signal });
    return NextResponse.json(r);
  } catch (e) {
    const status = e instanceof MediaError ? e.status ?? 502 : 500;
    const attempts = (e as { attempts?: unknown }).attempts;
    return NextResponse.json({ error: (e as Error).message, attempts }, { status });
  }
}
