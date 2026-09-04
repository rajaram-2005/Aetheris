import { NextResponse } from "next/server";
import { getUserId, uidCookie } from "@/lib/user";
import { authorize, issueConfirmation, principalFor } from "@/core/policy/permissions";
import { getCapability } from "@/core/capabilities/registry";
import { bootCapabilities } from "@/core/capabilities/sources";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";

/** GET → my principal. POST {capabilityId, confirm?: true, token?} → decision (and a confirmation token when the user confirms). */
export async function GET() { const { uid, isNew } = await getUserId(); const res = NextResponse.json({ principal: principalFor(uid) }); if (isNew) res.cookies.set(uidCookie(uid)); return res; }
export async function POST(req: Request) {
  bootCapabilities();
  const { uid, isNew } = await getUserId(); const p = principalFor(uid);
  const b = (await req.json().catch(() => ({}))) as { capabilityId?: string; confirm?: boolean; token?: string };
  if (!b.capabilityId) return NextResponse.json({ error: "capabilityId required" }, { status: 400 });
  const cap = await getCapability(b.capabilityId); if (!cap) return NextResponse.json({ error: "unknown capability" }, { status: 404 });
  const token = b.confirm && !b.token ? issueConfirmation(uid, cap.id) : b.token;
  const d = authorize({ principal: p, capabilityId: cap.id, required: cap.security_level, requiresConfirmation: cap.requires_confirmation, confirmationToken: token });
  const res = NextResponse.json({ decision: d, capability: { id: cap.id, security_level: cap.security_level, requires_confirmation: !!cap.requires_confirmation, status: cap.status } }, { status: d.allow ? 200 : 403 }); if (isNew) res.cookies.set(uidCookie(uid)); return res;
}
