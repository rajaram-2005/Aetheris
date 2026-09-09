/**
 * API Route: /api/test-lab
 *
 * GET: Retrieve test failures, regression stats, or composite evaluation score
 * POST: Execute Test Lab regression suite across 8 failure categories
 */
import { NextResponse } from "next/server";
import { getUserId, uidCookie } from "@/lib/user";
import { failureStats, listFailures, recordFailure } from "@/core/controlplane/testlab/database";
import { runTestLabSuite } from "@/core/controlplane/testlab/runner";
import { computeEvaluationScore } from "@/core/controlplane/testlab/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { uid, isNew } = await getUserId();
  const url = new URL(req.url);
  const type = url.searchParams.get("type");

  if (type === "eval") {
    const report = await computeEvaluationScore();
    const res = NextResponse.json({ report });
    if (isNew) res.cookies.set(uidCookie(uid));
    return res;
  }

  const failures = listFailures();
  const stats = failureStats();
  const res = NextResponse.json({ failures, stats });
  if (isNew) res.cookies.set(uidCookie(uid));
  return res;
}

export async function POST(req: Request) {
  const { uid, isNew } = await getUserId();
  const body = (await req.json().catch(() => ({}))) as { action?: string; failure?: any };

  if (body.action === "record_failure" && body.failure) {
    const rec = recordFailure(body.failure);
    const res = NextResponse.json({ failure: rec }, { status: 201 });
    if (isNew) res.cookies.set(uidCookie(uid));
    return res;
  }

  // Run full Test Lab suite
  const suite = await runTestLabSuite();
  const evalReport = await computeEvaluationScore(suite);

  const res = NextResponse.json({ suite, evalReport }, { status: 200 });
  if (isNew) res.cookies.set(uidCookie(uid));
  return res;
}
