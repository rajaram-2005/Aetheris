import { NextResponse } from "next/server";
import { getUserId } from "@/lib/user";
import { getScheduleRun, getSchedule } from "@/lib/schedules/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?id=<runId> → full run (output included). */
export async function GET(req: Request) {
  const { uid } = await getUserId(); const id = new URL(req.url).searchParams.get("id") ?? "";
  const run = await getScheduleRun(id); if (!run || run.uid !== uid) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run, schedule: await getSchedule(run.scheduleId) });
}
