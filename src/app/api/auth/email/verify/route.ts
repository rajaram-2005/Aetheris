import { NextResponse } from "next/server";
import { mergeAnonymous, normalizeEmail, publicAccount, resolveAccount, sessionCookies, verifyCode, getSessionAccount } from "@/lib/auth/accounts";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { email, code, name } = (await req.json().catch(() => ({}))) as { email?: string; code?: string; name?: string };
  const e = email ? normalizeEmail(email) : "";
  if (!e || !code) return NextResponse.json({ error: "email and code required" }, { status: 400 });
  if (!(await verifyCode("email", e, code))) return NextResponse.json({ error: "Wrong or expired code." }, { status: 400 });
  const { uid } = await getUserId();
  const current = await getSessionAccount();
  const acc = await resolveAccount({ provider: "email", subject: e, email: e, name: name?.trim() || undefined }, uid, current?.id);
  await mergeAnonymous(uid, acc);
  const res = NextResponse.json({ account: publicAccount(acc) });
  for (const c of sessionCookies(acc)) res.cookies.set(c);
  return res;
}
