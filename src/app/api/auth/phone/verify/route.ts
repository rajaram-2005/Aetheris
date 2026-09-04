import { NextResponse } from "next/server";
import { getSessionAccount, mergeAnonymous, normalizePhone, publicAccount, resolveAccount, sessionCookies, verifyCode } from "@/lib/auth/accounts";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { phone, code, name } = (await req.json().catch(() => ({}))) as { phone?: string; code?: string; name?: string };
  const p = phone ? normalizePhone(phone) : "";
  if (!p || !code) return NextResponse.json({ error: "phone and code required" }, { status: 400 });
  if (!(await verifyCode("phone", p, code))) return NextResponse.json({ error: "Wrong or expired code." }, { status: 400 });
  const { uid } = await getUserId();
  const current = await getSessionAccount();
  const acc = await resolveAccount({ provider: "phone", subject: p, phone: p, name: name?.trim() || undefined }, uid, current?.id);
  await mergeAnonymous(uid, acc);
  const res = NextResponse.json({ account: publicAccount(acc) });
  for (const c of sessionCookies(acc)) res.cookies.set(c);
  return res;
}
