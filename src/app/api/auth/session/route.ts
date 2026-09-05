import { NextResponse } from "next/server";
import { SESSION_COOKIE, getSessionAccount, publicAccount } from "@/lib/auth/accounts";
import { googleConfigured } from "@/lib/auth/deliver";
import { oauthConfigured as githubConfigured } from "@/lib/github/auth";
import { usageSummary } from "@/lib/billing/entitlements";
import { getUserId } from "@/lib/user";
import { isAdminAccount, markAdminUid } from "@/lib/billing/admin";
import { authenticationRequired, guestAccessEnabled } from "@/lib/auth/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → who am I + which sign-in methods this deployment supports. */
export async function GET() {
  const acc = await getSessionAccount();
  const { uid } = await getUserId({ allowAnonymous: true });
  const admin = isAdminAccount(acc);
  if (admin) markAdminUid(uid, true);
  const usage = await usageSummary(uid);
  return NextResponse.json({
    account: acc ? { ...publicAccount(acc), admin, guest: acc.providers.guest !== undefined } : null,
    admin,
    plan: usage.planId,
    authRequired: authenticationRequired(),
    methods: {
      google: googleConfigured(),
      github: githubConfigured(),
      guest: guestAccessEnabled(),
    },
  });
}

/** DELETE → sign out (keeps the uid cookie so anonymous usage continues under the same id). */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete("aetheris_gh");
  return res;
}
