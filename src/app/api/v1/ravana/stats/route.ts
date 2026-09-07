import { NextResponse } from "next/server";
import { getUserId } from "@/lib/user";
import { stampUid } from "@/core/ravana/http";
import { taskStats, engineManifest } from "@/core/ravana/engine";
import { counts } from "@/core/ravana/memory/manager";
import { bootTools, toolStatus } from "@/core/ravana/tools";
import { modelPool } from "@/core/ravana/routing/model_router";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/ravana/stats — RAVANA dashboard numbers (spec §24). */
export async function GET() {
  const { uid, isNew } = await getUserId();
  const [stats, memory, manifest] = await Promise.all([taskStats(uid), counts(uid), engineManifest(uid)]);
  bootTools();
  const tools = toolStatus();
  const pool = modelPool();
  return stampUid(
    NextResponse.json({
      online: true,
      subsystemStatus: manifest.subsystems,
      tasks: stats,
      memory: { byType: memory, total: Object.values(memory).reduce((n, x) => n + x, 0) },
      models: { available: pool.roles.filter((r) => r.status === "configured").length, roles: pool.roles },
      tools: { available: tools.length, tools },
    }),
    isNew,
    uid,
  );
}
