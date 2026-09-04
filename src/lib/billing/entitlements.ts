import { store } from "@/lib/store";
import { FREE_PLAN, PLANS, planById, type Feature, type Plan } from "./plans";

export interface Entitlement {
  uid: string;
  planId: string;
  expiresAt: number; // epoch ms
  grantedBy: string; // payment id or "admin"
}

export async function getEntitlement(uid: string): Promise<Entitlement | null> {
  const e = await store.get<Entitlement>("entitlements", uid);
  if (!e || e.expiresAt < Date.now()) return null;
  return e;
}

/** Effective plan (falls back to Free). */
export async function planFor(uid: string): Promise<Plan> {
  const e = await getEntitlement(uid);
  return (e && planById(e.planId)) || FREE_PLAN;
}

export async function hasFeature(uid: string, f: Feature): Promise<boolean> {
  return (await planFor(uid)).features.includes(f);
}

export async function grant(uid: string, planId: string, grantedBy: string): Promise<Entitlement> {
  const plan = planById(planId);
  if (!plan || plan.priceInr === 0) throw new Error(`Unknown plan ${planId}`);
  return store.update<Entitlement>("entitlements", uid, (cur) => {
    const base = cur && cur.expiresAt > Date.now() && cur.planId === planId ? cur.expiresAt : Date.now();
    return { uid, planId, expiresAt: base + plan.days * 86_400_000, grantedBy };
  });
}

// ---- Metering (credits per day, plan-dependent) --------------------------------------------
interface Usage { day: string; count: number }
function today() { return new Date().toISOString().slice(0, 10); }

export async function consumeChat(uid: string, cost = 1): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  const plan = await planFor(uid);
  const u = await store.update<Usage>("usage", uid, (cur) => {
    const d = today();
    if (!cur || cur.day !== d) return { day: d, count: cost };
    return { day: d, count: cur.count + cost };
  });
  if (plan.dailyCredits === null) return { allowed: true, used: u.count, limit: null };
  return { allowed: u.count <= plan.dailyCredits, used: u.count, limit: plan.dailyCredits };
}

export async function usageSummary(uid: string) {
  const ent = await getEntitlement(uid);
  const plan = await planFor(uid);
  const u = await store.get<Usage>("usage", uid);
  const used = u && u.day === today() ? u.count : 0;
  return {
    plan: ent ? plan : null,
    planId: plan.id,
    expiresAt: ent?.expiresAt ?? null,
    features: plan.features,
    maxModel: plan.maxModel,
    maxAgents: plan.maxAgents,
    apiKeys: plan.apiKeys,
    chat: { used, limit: plan.dailyCredits },
    plans: PLANS,
  };
}
