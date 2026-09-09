/**
 * API Route: /api/control-plane
 *
 * GET: List all tasks or retrieve task by ?id=...
 * POST: Execute a new task through the 12-Phase Gated Intelligence Pipeline
 */
import { NextResponse } from "next/server";
import { getUserId, uidCookie } from "@/lib/user";
import { ControlPlaneSupervisor } from "@/core/controlplane/supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { uid, isNew } = await getUserId();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const task = ControlPlaneSupervisor.getTask(id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const res = NextResponse.json({ task });
    if (isNew) res.cookies.set(uidCookie(uid));
    return res;
  }

  const tasks = ControlPlaneSupervisor.listTasks();
  const res = NextResponse.json({ tasks });
  if (isNew) res.cookies.set(uidCookie(uid));
  return res;
}

export async function POST(req: Request) {
  const { uid, isNew } = await getUserId();
  const body = (await req.json().catch(() => ({}))) as {
    request?: string;
    maxLoopbacks?: number;
    injectedFailure?: "missing_evidence" | "contradiction" | "safety_block" | "none";
  };

  const rawRequest = body.request || "Analyze WTG-04 gearbox bearing vibration telemetry";
  const task = await ControlPlaneSupervisor.executeTask(rawRequest, {
    uid,
    maxLoopbacks: body.maxLoopbacks ?? 3,
    injectedFailure: body.injectedFailure ?? "none",
  });

  const res = NextResponse.json({ task }, { status: 200 });
  if (isNew) res.cookies.set(uidCookie(uid));
  return res;
}
