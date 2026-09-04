import { NextResponse } from "next/server";
import { issueCode, normalizeEmail } from "@/lib/auth/accounts";
import { emailConfigured, sendEmailCode } from "@/lib/auth/deliver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  const e = email ? normalizeEmail(email) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const r = await issueCode("email", e);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 429 });
  try { await sendEmailCode(e, r.code); } catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 502 }); }
  // In dev without an email provider, return the code so the flow is testable.
  return NextResponse.json({ ok: true, ...(emailConfigured() || process.env.NODE_ENV === "production" ? {} : { devCode: r.code }) });
}
