/**
 * /network — AETHERIS Master Intelligence Operating Workspace
 *
 * "ONE STATE. ONE EVENT FABRIC. ONE INTELLIGENCE NETWORK. ONE DIGITAL REALITY. ONE VERIFIED RESULT."
 */
import React from "react";
import NetworkWorkspace from "@/components/network/NetworkWorkspace";
import { masterGraph } from "@/core/fabric/graph";
import { eventFabric } from "@/core/fabric/events";
import { canonicalState } from "@/core/fabric/state";
import { SelfTestEngine } from "@/core/fabric/selftest";

export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  const state = canonicalState.getState();
  const nodes = masterGraph.getAllNodes();
  const edges = masterGraph.getAllEdges();
  const events = eventFabric.getRecentEvents(30);
  const selfTest = await SelfTestEngine.runSystemCheck();

  return (
    <NetworkWorkspace
      initialState={state}
      initialNodes={nodes}
      initialEdges={edges}
      initialEvents={events}
      initialSelfTest={selfTest}
    />
  );
}
