import { NextResponse } from "next/server";
import { getUserId, uidCookie } from "@/lib/user";
import { usageSummary } from "@/lib/billing/entitlements";
import { PAYEE } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

export async function GET() {
  const { uid, isNew } = await getUserId();
  const res = NextResponse.json({ ...(await usageSummary(uid)), payee: { phone: PAYEE.phone, email: PAYEE.email } });
  if (isNew) res.cookies.set(uidCookie(uid));
  return res;
}
