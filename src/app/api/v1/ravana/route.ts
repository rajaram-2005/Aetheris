import { NextResponse } from "next/server";
import { getUserId } from "@/lib/user";
import { stampUid } from "@/core/ravana/http";
import { engineManifest } from "@/core/ravana/engine";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/ravana — RAVANA service manifest: core status + honest subsystem states. */
export async function GET() {
  const { uid, isNew } = await getUserId();
  const manifest = await engineManifest(uid);
  return stampUid(NextResponse.json(manifest), isNew, uid);
}
