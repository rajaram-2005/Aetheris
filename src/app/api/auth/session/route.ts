import { NextResponse } from "next/server";
import { SESSION_COOKIE, getSessionAccount, publicAccount } from "@/lib/auth/accounts";
import { emailConfigured, googleConfigured, smsConfigured } from "@/lib/auth/deliver";
import { oauthConfigured as githubConfigured } from "@/lib/github/auth";
import { usageSummary } from "@/lib/billing/entitlements";
import { getUserId } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → who am I + which sign-in methods this deployment supports. */
export async function GET() {
  const acc = await getSessionAccount();
  const { uid } = await getUserId();
  const usage = await usageSummary(uid);
  return NextResponse.json({
    account: acc ? publicAccount(acc) : null,
    plan: usage.planId,
    methods: { google: googleConfigured(), github: githubConfigured(), email: true, phone: true, emailLive: emailConfigured(), smsLive: smsConfigured() },
  });
}

/** DELETE → sign out (keeps the uid cookie so anonymous usage continues under the same id). */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete("aetheris_gh");
  return res;
}
