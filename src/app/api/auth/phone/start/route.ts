import { NextResponse } from "next/server";
import { issueCode, normalizePhone } from "@/lib/auth/accounts";
import { sendSmsCode, smsConfigured } from "@/lib/auth/deliver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { phone } = (await req.json().catch(() => ({}))) as { phone?: string };
  let p = phone ? normalizePhone(phone) : "";
  if (/^\+\d{10}$/.test(p)) p = "+91" + p.slice(1); // bare 10-digit Indian number
  if (!/^\+\d{8,15}$/.test(p)) return NextResponse.json({ error: "Enter a valid phone number with country code, e.g. +91 98765 43210." }, { status: 400 });
  const r = await issueCode("phone", p);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 429 });
  try { await sendSmsCode(p, r.code); } catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 502 }); }
  return NextResponse.json({ ok: true, phone: p, ...(smsConfigured() || process.env.NODE_ENV === "production" ? {} : { devCode: r.code }) });
}
