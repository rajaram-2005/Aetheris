import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getSessionAccount, mergeAnonymous, publicAccount, resolveAccount, sessionCookies } from "@/lib/auth/accounts";
import { guestAccessEnabled } from "@/lib/auth/gate";
import { getUserId } from "@/lib/user";
import { rateLimit } from "@/core/security/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create a browser-local guest account from a display name—no verified cross-device identity. */
export async function POST(req: Request) {
  if (!guestAccessEnabled()) return NextResponse.json({ error: "Guest access is disabled." }, { status: 404 });
  const current = await getSessionAccount();
  if (current) return NextResponse.json({ account: publicAccount(current) });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const limit = rateLimit(`auth:guest:${ip}`, { limit: 10, windowMs: 60 * 60_000 });
  if (!limit.ok) return NextResponse.json({ error: "Too many guest sessions. Try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } });

  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (name.length < 2 || name.length > 50) {
    return NextResponse.json({ error: "Enter a name between 2 and 50 characters." }, { status: 400 });
  }

  const { uid } = await getUserId({ allowAnonymous: true, freshAnonymous: true });
  const subject = randomBytes(16).toString("hex");
  const account = await resolveAccount({ provider: "guest", subject, name }, uid);
  await mergeAnonymous(uid, account);

  const res = NextResponse.json({ account: publicAccount(account), guest: true }, { status: 201 });
  for (const cookie of sessionCookies(account)) res.cookies.set(cookie);
  return res;
}
