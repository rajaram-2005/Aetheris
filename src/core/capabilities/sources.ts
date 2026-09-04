/**
 * Built-in capability sources. Each adapts an existing Aetheris catalog into Capability records.
 * The "platform" source is the honest status board for whole subsystems — including the ones that
 * are designed but NOT built (physical AI, robotics, twins). Nothing here is mocked.
 */
import type { Capability, CapabilitySource } from "./types";
import { registerSource } from "./registry";
import { PROVIDERS, isConfigured, resolveModel } from "@/lib/router/providers";
import { meshStatus } from "@/lib/router/router";
import { AGENTS } from "@/lib/agents/catalog";
import { CONNECTORS } from "@/lib/mcp/catalog";
import { APIS } from "@/lib/gateway/apis";

// ---- Models --------------------------------------------------------------------------------------
const modelSource: CapabilitySource = {
  id: "models",
  list() {
    const mesh = new Map(meshStatus().map((m) => [m.id, m]));
    return PROVIDERS.map<Capability>((p) => {
      const m = mesh.get(p.id); const total = (m?.successes ?? 0) + (m?.failures ?? 0);
      return {
        id: `model:${p.id}`, name: `${p.name} · ${resolveModel(p)}`, category: "model", provider: "router",
        description: p.notes ?? `${p.name} via ${p.kind} adapter`, status: isConfigured(p) ? "implemented" : "not_available",
        tags: ["llm", "chat", p.kind, ...(p.vision ? ["vision", "multimodal"] : []), ...(p.keyless ? ["keyless"] : []), p.id],
        security_level: "read_only", cost: { unit: "free" }, latency: "normal",
        reliability: total ? (m!.successes + 1) / (total + 2) : undefined,
        model_requirements: undefined, supported_operations: ["chat.completions", "stream", ...(p.vision ? ["vision"] : [])],
        verification_status: total ? "verified" : "unverified", locality: "remote", invoke: { kind: "internal", ref: "router.route({preferred})" },
      };
    });
  },
};

// ---- Agents --------------------------------------------------------------------------------------
const agentSource: CapabilitySource = {
  id: "agents",
  list: () => AGENTS.map<Capability>((a) => ({
    id: `agent:${a.id}`, name: `${a.icon} ${a.name}`, category: "agent", provider: "orchestrator", description: a.description, status: "implemented",
    tags: [a.domain, a.tier, ...a.skills.map((s) => s.toLowerCase()), ...(a.aliases ?? [])],
    security_level: "read_only", cost: { unit: "free" }, latency: "normal", supported_operations: ["run", "delegate"], verification_status: "verified", locality: "remote",
    invoke: { kind: "mention", ref: `@${a.id}` },
  })),
};

// ---- Connectors (remote MCP + gateway REST) -----------------------------------------------------
const connectorSource: CapabilitySource = {
  id: "connectors",
  list: () => [
    ...CONNECTORS.map<Capability>((c) => ({
      id: `connector:${c.id}`, name: c.name, category: "connector", provider: c.kind === "remote" ? "mcp-remote" : "gateway", description: c.description,
      status: c.kind === "gateway" ? "implemented" : "partial", // remote servers: real, but reachability depends on vendor + user credential
      tags: [c.category, c.kind, "mcp", ...(c.auth ? ["needs-credential"] : ["public"])],
      security_level: /write|send|create|post|delete/i.test(c.description) ? "safe_write" : "read_only", cost: { unit: "free" }, latency: "fast",
      supported_operations: ["tools/list", "tools/call"], verification_status: "untestable_here", locality: "remote", invoke: { kind: "mcp", ref: c.kind === "remote" ? c.url : `/api/gateway/${c.id}` },
    })),
    ...APIS.flatMap<Capability>((api) => api.tools.map((t) => ({
      id: `tool:${api.id}.${t.name}`, name: `${api.name}: ${t.name}`, category: "tool", provider: "gateway", description: t.description, status: "implemented",
      tags: [api.id, ...t.name.split("_")], input_schema: { type: "object", properties: Object.fromEntries(Object.entries(t.params ?? {}).map(([k, v]) => [k, { type: v.type, description: v.description }])), required: Object.entries(t.params ?? {}).filter(([, v]) => v.required).map(([k]) => k) },
      security_level: /^(send|create|post|add|update|delete|remove|set|write|publish|upload)/.test(t.name) ? "safe_write" : "read_only", requires_confirmation: /^(delete|remove)/.test(t.name),
      cost: { unit: "free" }, latency: "fast", supported_operations: ["call"], verification_status: "untestable_here", locality: "remote", invoke: { kind: "mcp", ref: `${api.id}__${t.name}` },
    }))),
  ],
};

// ---- Platform subsystems (honest status board) --------------------------------------------------
const P = (c: Omit<Capability, "cost" | "latency" | "locality" | "provider"> & Partial<Pick<Capability, "cost" | "latency" | "locality" | "provider">>): Capability =>
  ({ cost: { unit: "free" }, latency: "normal", locality: "hybrid", provider: "aetheris-core", ...c });

const platformSource: CapabilitySource = {
  id: "platform",
  list: () => [
    P({ id: "system:model-router", name: "Model Router", category: "system", description: "Provider-neutral router over 27 providers: capability filter (vision), health-ranked failover, cooldowns, tier allow-lists, streaming.", status: "implemented", tags: ["router", "failover", "models"], security_level: "read_only", supported_operations: ["route", "stream", "failover"], verification_status: "verified" }),
    P({ id: "system:agent-runtime", name: "Agent Runtime (Prime → specialists → Metis)", category: "system", description: "Planner (Prime) decomposes, specialists execute single/pipeline/parallel, Metis extracts lessons. Missing: budgets, checkpoints, cancellation of sub-tasks, background jobs.", status: "partial", tags: ["agents", "planner", "executor"], security_level: "read_only", supported_operations: ["plan", "delegate", "pipeline", "parallel", "reflect"], verification_status: "verified" }),
    P({ id: "system:verifier", name: "Verification Engine", category: "system", description: "Explainer/critic pass (fact vs inference, confidence, how to verify) and Metis review. Missing: automatic test/type-check loops on generated code, schema validation of tool outputs, independent reviewer gate.", status: "partial", tags: ["verify", "review", "explainability"], security_level: "read_only", supported_operations: ["explain", "critique"], verification_status: "verified" }),
    P({ id: "system:execution-policy", name: "Execution Policy & Permissions", category: "execution", description: "Capability-based permission levels (READ_ONLY → PHYSICAL), confirmation gates and audit log for every tool/command invocation.", status: "implemented", tags: ["security", "permissions", "sandbox", "audit"], security_level: "admin", supported_operations: ["check", "audit"], verification_status: "verified" }),
    P({ id: "execution:browser-sandbox", name: "Code Interpreter (browser sandbox)", category: "execution", description: "Python (Pyodide) and JavaScript run inside a sandboxed iframe in the user's browser — no server execution.", status: "implemented", tags: ["python", "javascript", "sandbox"], security_level: "read_only", supported_operations: ["run"], verification_status: "verified", locality: "local" }),
    P({ id: "execution:server-sandbox", name: "Server-side command sandbox", category: "execution", description: "Container/process isolation for shell commands, tests and builds on the server. Designed (see docs/ARCHITECTURE.md) — not built. GitHub Actions is used today for CI-style execution.", status: "not_available", tags: ["shell", "container", "tests"], security_level: "full_workspace", supported_operations: [], verification_status: "untestable_here" }),
    P({ id: "system:mcp-gateway", name: "MCP Gateway & Hub", category: "system", description: "One MCP endpoint (/api/mcp/hub) aggregating 110 connectors: remote MCP servers + REST gateway with per-user credentials, OAuth, tool namespacing. Missing: user-added arbitrary MCP servers with health monitoring and versioning.", status: "partial", tags: ["mcp", "tools", "gateway"], security_level: "safe_write", supported_operations: ["tools/list", "tools/call", "oauth"], verification_status: "verified" }),
    P({ id: "system:capability-registry", name: "Capability Registry", category: "system", description: "Unified, searchable metadata for models, agents, tools, connectors, subsystems with honest status. Drives intent routing and the Control Center.", status: "implemented", tags: ["registry", "discovery"], security_level: "read_only", supported_operations: ["search", "get", "summary"], verification_status: "verified", locality: "local" }),
    P({ id: "system:intent-router", name: "Intent → Capability Router", category: "system", description: "Classifies a command into task types and picks capabilities (agent, connectors, knowledge, mode) with explicit manual override.", status: "implemented", tags: ["intent", "routing", "planner"], security_level: "read_only", supported_operations: ["route"], verification_status: "verified", locality: "local" }),
    P({ id: "knowledge:kb", name: "Knowledge bases (documents, BM25)", category: "knowledge", description: "Per-user KBs: PDF/DOCX/CSV/HTML/text/URL ingestion, heading-aware chunking, BM25 retrieval, [D#] citations. Missing: embeddings/vector option, knowledge graph, temporal store, contradiction detection.", status: "partial", tags: ["rag", "documents", "pdf", "citations"], security_level: "read_only", supported_operations: ["ingest", "search", "cite"], verification_status: "verified", locality: "local" }),
    P({ id: "memory:user", name: "Memory (user facts, lessons)", category: "memory", description: "Client-stored user memory with extraction, review, deletion; Metis agent lessons per user. Missing: episodic/project/agent memory types, ranking, expiry, provenance.", status: "partial", tags: ["memory"], security_level: "read_only", supported_operations: ["extract", "list", "forget"], verification_status: "verified", locality: "local" }),
    P({ id: "research:deep", name: "Deep Research", category: "research", description: "Question decomposition → web search (Tavily) → synthesis with citations. Missing: academic sources, PDF ingestion into evidence graph, citation graph, reproducibility analysis.", status: "partial", tags: ["research", "search", "citations"], security_level: "read_only", supported_operations: ["research"], verification_status: "verified" }),
    P({ id: "github:factory", name: "GitHub Coding Factory", category: "github", description: "Generates a project, pushes to a repo, opens CI (Actions), reads logs, reports. Missing: repository intelligence map, PR review, issue-driven automation, incremental patching of existing repos.", status: "partial", tags: ["github", "ci", "codegen"], security_level: "safe_write", requires_confirmation: true, supported_operations: ["generate", "commit", "ci", "report"], verification_status: "untestable_here" }),
    P({ id: "media:studio", name: "Multimodal Studio", category: "media", description: "Image/audio/video generation via free media providers; vision input in chat; voice mode (STT/TTS). Missing: video understanding, sensor streams.", status: "partial", tags: ["image", "audio", "video", "vision", "voice"], security_level: "read_only", supported_operations: ["generate", "vision", "tts", "stt"], verification_status: "verified" }),
    P({ id: "browser:agent", name: "Browser agent", category: "browser", description: "Autonomous browsing (navigate, extract, fill forms) through a secure tool interface. Not built; today web access is search + URL fetch only.", status: "not_available", tags: ["browser", "automation"], security_level: "safe_write", supported_operations: [], verification_status: "untestable_here" }),
    P({ id: "automation:workflows", name: "Workflows + Schedules", category: "automation", description: "Agent/transform/branch pipelines, cron schedules with delivery (share/email/webhook) and run history. Missing: event triggers (GitHub issue, sensor anomaly), conditions.", status: "partial", tags: ["workflow", "cron", "automation"], security_level: "safe_write", supported_operations: ["run", "schedule", "deliver"], verification_status: "verified" }),
    P({ id: "device:gateway", name: "Physical AI — Device Gateway", category: "device", description: "Device/driver abstraction (MQTT, serial, Modbus, OPC-UA) with telemetry pipeline, digital twins and a safety policy gate. Interfaces defined in src/core/physical; no adapters implemented. Requires hardware to verify.", status: "not_available", tags: ["iot", "esp32", "mqtt", "modbus", "sensor", "actuator"], security_level: "physical", requires_confirmation: true, hardware_requirements: ["device", "broker"], supported_operations: [], verification_status: "untestable_here", locality: "local" }),
    P({ id: "robot:ros2", name: "Robotics — ROS 2 bridge", category: "robot", description: "Robot agent over ROS 2 / simulation with planner and safety controller. Interface defined; not implemented.", status: "not_available", tags: ["robotics", "ros2", "slam"], security_level: "physical", requires_confirmation: true, hardware_requirements: ["ros2"], supported_operations: [], verification_status: "untestable_here", locality: "local" }),
    P({ id: "twin:digital", name: "Digital Twins", category: "twin", description: "Typed twin model (state, sensors, actuators, telemetry, events, maintenance, relationships) to reason before acting. Types defined; no store/UI.", status: "not_available", tags: ["twin", "industrial"], security_level: "read_only", supported_operations: [], verification_status: "untestable_here" }),
    P({ id: "system:observability", name: "Observability & Control Center", category: "system", description: "Structured event log for model/agent/tool/permission/schedule events with a Control Center view. Missing: cost metadata per call (all providers are free tier), persistent trace store, alerts.", status: "partial", tags: ["telemetry", "audit", "control-center"], security_level: "admin", supported_operations: ["record", "query", "summary"], verification_status: "verified", locality: "local" }),
    P({ id: "auth:accounts", name: "Accounts & API keys", category: "auth", description: "Google/GitHub/email/phone sign-in, anonymous device identity, personal API keys (sk-aeth-…), OpenAI-compatible /api/v1.", status: "implemented", tags: ["auth", "oauth", "api-keys"], security_level: "admin", supported_operations: ["login", "session", "keys"], verification_status: "verified" }),
    P({ id: "storage:json", name: "Storage provider (JSON file store)", category: "storage", description: "Single-node JSON collections under data/. Swap point for Postgres/SQLite (StorageProvider interface in src/core/providers).", status: "implemented", tags: ["storage"], security_level: "admin", supported_operations: ["get", "set", "all", "update", "remove"], verification_status: "verified", locality: "local" }),
  ],
};

let booted = false;
/** Register the built-in sources once (idempotent; safe to call from any route). */
export function bootCapabilities() {
  if (booted) return; booted = true;
  registerSource(modelSource); registerSource(agentSource); registerSource(connectorSource); registerSource(platformSource);
}
