/**
 * API Route: /api/incident
 *
 * GET: Retrieve active Incident Command status
 * POST: Trigger new incident or dispatch mitigation action
 */
import { NextResponse } from "next/server";
import { getUserId, uidCookie } from "@/lib/user";
import { clearIncident, getActiveIncident, triggerIncident } from "@/core/controlplane/incident/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { uid, isNew } = await getUserId();
  const incident = getActiveIncident();
  const res = NextResponse.json({ incident });
  if (isNew) res.cookies.set(uidCookie(uid));
  return res;
}

export async function POST(req: Request) {
  const { uid, isNew } = await getUserId();
  const body = (await req.json().catch(() => ({}))) as { action?: string; incidentData?: any };

  if (body.action === "clear") {
    clearIncident();
    const res = NextResponse.json({ cleared: true });
    if (isNew) res.cookies.set(uidCookie(uid));
    return res;
  }

  const incident = triggerIncident(body.incidentData || {});
  const res = NextResponse.json({ incident });
  if (isNew) res.cookies.set(uidCookie(uid));
  return res;
}
