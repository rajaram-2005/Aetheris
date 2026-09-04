import { NextResponse } from "next/server";
import { getUserId, uidCookie } from "@/lib/user";
import { usageSummary } from "@/lib/billing/entitlements";
import { PAYEE } from "@/lib/billing/plans";
import { getSessionAccount, publicAccount } from "@/lib/auth/accounts";
import { isAdminAccount, markAdminUid } from "@/lib/billing/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const { uid, isNew } = await getUserId();
  const acc = await getSessionAccount();
  const admin = isAdminAccount(acc);
  if (admin) markAdminUid(uid, true);
  const res = NextResponse.json({ ...(await usageSummary(uid)), user: acc ? { ...publicAccount(acc), admin } : null, admin, payee: { phone: PAYEE.phone, email: PAYEE.email } });
  if (isNew) res.cookies.set(uidCookie(uid));
  return res;
}
