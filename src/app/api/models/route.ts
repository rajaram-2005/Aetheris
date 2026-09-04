import { NextResponse } from "next/server";
import { getUserId, uidCookie } from "@/lib/user";
import { planFor } from "@/lib/billing/entitlements";
import { tiersForPlan } from "@/lib/models/tiers";

export const dynamic = "force-dynamic";

export async function GET() {
  const { uid, isNew } = await getUserId();
  const plan = await planFor(uid);
  const res = NextResponse.json({ plan: plan.id, models: tiersForPlan(plan.id).map(({ id, name, description, minPlan, available, agents, maxTokens }) => ({ id, name, description, minPlan, available, agents, maxTokens })) });
  if (isNew) res.cookies.set(uidCookie(uid));
  return res;
}
