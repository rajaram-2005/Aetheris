import { NextResponse } from "next/server";
import { masterGraph } from "@/core/fabric/graph";
import { eventFabric } from "@/core/fabric/events";
import { WorldModelEngine } from "@/core/fabric/worldmodel";
import { SelfTestEngine } from "@/core/fabric/selftest";
import { canonicalState } from "@/core/fabric/state";

export const dynamic = "force-dynamic";

/**
 * GET /api/network
 * Returns full unified state, nodes, edges, events, scenarios, and selftest result.
 */
export async function GET() {
  const state = canonicalState.getState();
  const nodes = masterGraph.getAllNodes();
  const edges = masterGraph.getAllEdges();
  const events = eventFabric.getRecentEvents(50);
  const scenarios = WorldModelEngine.getCanonicalScenarios();
  const causalTimeline = WorldModelEngine.getCausalTimeline();
  const selfTest = await SelfTestEngine.runSystemCheck();

  return NextResponse.json({
    ok: true,
    state,
    nodes,
    edges,
    events,
    world_model: {
      scenarios,
      causalTimeline,
    },
    self_test: selfTest,
  });
}
