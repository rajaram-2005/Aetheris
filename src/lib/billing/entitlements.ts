import { store } from "@/lib/store";
import { FREE_DAILY_MESSAGES, PLANS, planById, type Feature } from "./plans";

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

export async function hasFeature(uid: string, f: Feature): Promise<boolean> {
  const e = await getEntitlement(uid);
  if (!e) return false;
  return planById(e.planId)?.features.includes(f) ?? false;
}

export async function grant(uid: string, planId: string, grantedBy: string): Promise<Entitlement> {
  const plan = planById(planId);
  if (!plan) throw new Error(`Unknown plan ${planId}`);
  return store.update<Entitlement>("entitlements", uid, (cur) => {
    // Extend from current expiry if still active, else from now.
    const base = cur && cur.expiresAt > Date.now() && cur.planId === planId ? cur.expiresAt : Date.now();
    return { uid, planId, expiresAt: base + plan.days * 86_400_000, grantedBy };
  });
}

// ---- Free-tier metering (chat messages per day) ------------------------------------------
interface Usage { day: string; count: number }
function today() { return new Date().toISOString().slice(0, 10); }

export async function consumeChat(uid: string, cost = 1): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  if (await hasFeature(uid, "unlimited_chat")) return { allowed: true, used: 0, limit: null };
  const u = await store.update<Usage>("usage", uid, (cur) => {
    const d = today();
    if (!cur || cur.day !== d) return { day: d, count: cost };
    return { day: d, count: cur.count + cost };
  });
  return { allowed: u.count <= FREE_DAILY_MESSAGES, used: u.count, limit: FREE_DAILY_MESSAGES };
}

export async function usageSummary(uid: string) {
  const ent = await getEntitlement(uid);
  const u = await store.get<Usage>("usage", uid);
  const used = u && u.day === today() ? u.count : 0;
  return {
    plan: ent ? planById(ent.planId) ?? null : null,
    expiresAt: ent?.expiresAt ?? null,
    features: ent ? planById(ent.planId)?.features ?? [] : [],
    chat: { used, limit: ent && planById(ent.planId)?.features.includes("unlimited_chat") ? null : FREE_DAILY_MESSAGES },
    plans: PLANS,
  };
}
