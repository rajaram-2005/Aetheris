/**
 * Built-in capability sources. Each adapts an existing Aetheris catalog into Capability records.
 * The "platform" source is the honest status board for whole subsystems — including the ones that
 * are only partially built (robotics, twins). Nothing here is mocked; the `simulated` device adapter is labelled as such.
 */
import type { Capability, CapabilitySource } from "./types";
import { registerSource } from "./registry";
import { PROVIDERS, isConfigured, resolveModel } from "@/lib/router/providers";
import { meshStatus } from "@/lib/router/router";
import { AGENTS } from "@/lib/agents/catalog";
import { CONNECTORS } from "@/lib/mcp/catalog";
import { APIS } from "@/lib/gateway/apis";
import { store } from "@/lib/store";
import type { McpServerRecord } from "@/core/mcp/gateway";

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
    P({ id: "system:model-router", name: "Model Router (task-aware, local-first capable)", category: "system", description: "Provider-neutral router over 27 cloud + 3 local providers (Ollama, LM Studio, vLLM/custom): task policy (coding/reasoning/long-context/multilingual/tools), locality (local/prefer_local/remote), context fit, health-ranked failover, cooldowns, streaming.", status: "implemented", tags: ["router", "failover", "models", "local", "ollama"], security_level: "read_only", supported_operations: ["route", "stream", "failover"], verification_status: "verified" }),
    P({ id: "system:agent-runtime", name: "Agent Runtime (jobs, budgets, checkpoints)", category: "system", description: "Prime plans, specialists execute single/pipeline/parallel, Metis extracts lessons; background jobs with budgets (model calls, chars, time, agents), checkpoints, cancellation, retry, SSE progress (/api/jobs).", status: "implemented", tags: ["agents", "planner", "executor"], security_level: "read_only", supported_operations: ["plan", "delegate", "pipeline", "parallel", "reflect"], verification_status: "verified" }),
    P({ id: "system:verifier", name: "Verification Engine", category: "system", description: "Explainer/critic pass (fact vs inference, confidence, how to verify) and Metis review. Missing: automatic test/type-check loops on generated code, schema validation of tool outputs, independent reviewer gate.", status: "partial", tags: ["verify", "review", "explainability"], security_level: "read_only", supported_operations: ["explain", "critique"], verification_status: "verified" }),
    P({ id: "system:execution-policy", name: "Execution Policy & Permissions", category: "execution", description: "Capability-based permission levels (READ_ONLY → PHYSICAL), confirmation gates and audit log for every tool/command invocation.", status: "implemented", tags: ["security", "permissions", "sandbox", "audit"], security_level: "admin", supported_operations: ["check", "audit"], verification_status: "verified" }),
    P({ id: "execution:browser-sandbox", name: "Code Interpreter (browser sandbox)", category: "execution", description: "Python (Pyodide) and JavaScript run inside a sandboxed iframe in the user's browser — no server execution.", status: "implemented", tags: ["python", "javascript", "sandbox"], security_level: "read_only", supported_operations: ["run"], verification_status: "verified", locality: "local" }),
    P({ id: "execution:server-sandbox", name: "Server-side command sandbox", category: "execution", description: "Process-isolated shell/test execution on the server: fresh temp workspace, scrubbed env, SIGKILL timeout, output caps, allow-listed binaries, deny-list, network off via unshare when the host permits. Not a VM/container — run Aetheris itself in a container for defence in depth.", status: "implemented", tags: ["shell", "tests", "python", "node", "sandbox"], security_level: "full_workspace", requires_confirmation: true, supported_operations: ["run", "files", "fsChanges"], verification_status: "verified", locality: "local" }),
    P({ id: "system:mcp-gateway", name: "MCP Gateway & Hub", category: "system", description: "One MCP endpoint (/api/mcp/hub) aggregating 110 catalog connectors (remote MCP + REST gateway, per-user credentials, OAuth) plus user-registered MCP servers (/api/mcp/servers) with manifest capture, health monitoring & sweeps, tool versioning, JSON-schema argument validation and per-tool permission classification.", status: "implemented", tags: ["mcp", "tools", "gateway"], security_level: "safe_write", supported_operations: ["tools/list", "tools/call", "oauth"], verification_status: "verified" }),
    P({ id: "system:capability-registry", name: "Capability Registry", category: "system", description: "Unified, searchable metadata for models, agents, tools, connectors, subsystems with honest status. Drives intent routing and the Control Center.", status: "implemented", tags: ["registry", "discovery"], security_level: "read_only", supported_operations: ["search", "get", "summary"], verification_status: "verified", locality: "local" }),
    P({ id: "system:intent-router", name: "Intent → Capability Router", category: "system", description: "Classifies a command into task types and picks capabilities (agent, connectors, knowledge, mode) with explicit manual override.", status: "implemented", tags: ["intent", "routing", "planner"], security_level: "read_only", supported_operations: ["route"], verification_status: "verified", locality: "local" }),
    P({ id: "knowledge:fabric", name: "Knowledge Fabric (hybrid: keyword + vector + graph + temporal)", category: "knowledge", description: "SQLite/FTS5 fact store with provenance per fact and edge, entity/relation graph, point-in-time (asOf) queries with supersession, reciprocal-rank fusion of BM25 + cosine + graph expansion. Embeddings: local hashed n-gram by default (lexical, not semantic); set EMBEDDINGS_URL/KEY for provider vectors. /api/knowledge, /api/knowledge/graph. Auto-recalled into chat.", status: "implemented", tags: ["knowledge", "graph", "vector", "temporal", "provenance"], security_level: "safe_write", supported_operations: ["add", "query", "graph", "delete"], verification_status: "verified", locality: "local" }),
    P({ id: "knowledge:kb", name: "Knowledge bases (documents, BM25)", category: "knowledge", description: "Per-user KBs: PDF/DOCX/CSV/HTML/text/URL ingestion, heading-aware chunking, BM25 retrieval, [D#] citations. Structured facts live in knowledge:fabric.", status: "implemented", tags: ["rag", "documents", "pdf", "citations"], security_level: "read_only", supported_operations: ["ingest", "search", "cite"], verification_status: "verified", locality: "local" }),
    P({ id: "memory:typed", name: "Typed memory (episodic / semantic / procedural / working / short-term)", category: "memory", description: "Server-side per-user memory on the knowledge fabric: provenance, confidence, dedupe, eviction limits, supersession, hybrid time-scoped recall; working & short-term are process-local (not persisted). /api/memory. Auto-recalled into chat.", status: "implemented", tags: ["memory", "episodic", "semantic", "procedural"], security_level: "safe_write", supported_operations: ["remember", "recall", "list", "forget"], verification_status: "verified", locality: "local" }),
    P({ id: "memory:user", name: "Memory (client facts, agent lessons)", category: "memory", description: "Client-stored user memory with LLM extraction, review, deletion; Metis agent lessons per user. Complements memory:typed.", status: "implemented", tags: ["memory"], security_level: "read_only", supported_operations: ["extract", "list", "forget"], verification_status: "verified", locality: "local" }),
    P({ id: "research:engine", name: "Research Engine (academic evidence + citation graph)", category: "research", description: "Keyless academic sources (arXiv, Crossref, OpenAlex, Semantic Scholar) + optional web; cross-source dedupe by DOI/title; Semantic Scholar citation edges; LLM claim extraction mapped to evidence ids; contradiction detection; report with reproducibility/limitations; optional persistence to the knowledge fabric. /api/research/academic.", status: "implemented", tags: ["research", "arxiv", "citations", "evidence", "claims"], security_level: "read_only", supported_operations: ["research", "claims", "graph", "persist"], verification_status: "untestable_here" }),
    P({ id: "browser:agent", name: "Browser agent (goal-driven navigation)", category: "browser", description: "LLM-driven navigate/follow/submit/extract loop over an accessibility-style page snapshot. Engine http (static HTML, robots.txt-respecting, cookie jar) is IMPLEMENTED; playwright engine (JS pages) is used only if the package + chromium are installed — reported by GET /api/browser. Private networks always denied; form submission needs safe_write confirmation; every step traced.", status: "partial", tags: ["browser", "web", "navigation", "scraping"], security_level: "safe_write", requires_confirmation: true, supported_operations: ["browse", "extract", "status"], verification_status: "verified" }),
    P({ id: "research:deep", name: "Deep Research (web)", category: "research", description: "Question decomposition → web search (Tavily) → streamed synthesis with citations. Academic evidence lives in research:engine.", status: "implemented", tags: ["research", "search", "citations"], security_level: "read_only", supported_operations: ["research"], verification_status: "verified" }),
    P({ id: "github:intelligence", name: "GitHub Repository Intelligence", category: "github", description: "Repo map (tree/languages/hotspots/key files), LLM architecture brief, diff-grounded PR review with severity findings (optionally posted), issue triage (optionally labelled), and incremental patch → branch → draft PR on existing repos. /api/github/repos/intel. Writes need safe_write confirmation.", status: "implemented", tags: ["github", "review", "triage", "repo-map", "patch"], security_level: "safe_write", requires_confirmation: true, supported_operations: ["map", "analyze", "review", "triage", "patch"], verification_status: "untestable_here" }),
    P({ id: "github:factory", name: "GitHub Coding Factory", category: "github", description: "Generates a project, pushes to a repo, opens CI (Actions), reads logs, reports. Existing-repo work lives in github:intelligence.", status: "implemented", tags: ["github", "ci", "codegen"], security_level: "safe_write", requires_confirmation: true, supported_operations: ["generate", "commit", "ci", "report"], verification_status: "untestable_here" }),
    P({ id: "multimodal:perceive", name: "Multimodal perception (image · document · audio · video · sensor)", category: "media", description: "One typed entry point /api/multimodal: vision via router; document extraction+summary; STT via Groq whisper (free) or STT_URL; video = ffmpeg frame sampling + vision + audio track (PARTIAL: needs ffmpeg on host); sensor series stats/trend/z-score anomalies. Availability reported honestly per modality.", status: "partial", tags: ["vision", "stt", "document", "video", "sensor", "multimodal"], security_level: "read_only", supported_operations: ["perceive", "status"], verification_status: "verified" }),
    P({ id: "media:studio", name: "Multimodal Studio (generation)", category: "media", description: "Image/audio/video generation via free media providers; vision input in chat; voice mode (STT/TTS).", status: "implemented", tags: ["image", "audio", "video", "vision", "voice"], security_level: "read_only", supported_operations: ["generate", "vision", "tts", "stt"], verification_status: "verified" }),
    P({ id: "automation:workflows", name: "Workflows + Schedules", category: "automation", description: "Agent/transform/branch pipelines, cron schedules with delivery (share/email/webhook) and run history. Event triggers and conditions live in automation:engine.", status: "implemented", tags: ["workflow", "cron", "automation"], security_level: "safe_write", supported_operations: ["run", "schedule", "deliver"], verification_status: "verified" }),
    P({ id: "automation:engine", name: "Automation engine (trigger → condition → agent → verify → action)", category: "automation", description: "Triggers: cron, webhook (secret), device telemetry threshold (edge + cooldown), twin health, job finished, manual. Condition/verify via safe expression DSL or model rubric (PASS/FAIL gate). Actions: webhook, email, remember (memory), twin event, submit job, device actuate (needs physical grant + stored confirmation). Per-stage run log. /api/automations.", status: "implemented", tags: ["automation", "trigger", "workflow", "webhook"], security_level: "safe_write", supported_operations: ["create", "fire", "hook", "runs"], verification_status: "verified" }),
    P({ id: "device:gateway", name: "Physical AI — Device Gateway", category: "device", description: "Per-user device registry with adapters: http (ESP32/Arduino/RPi JSON firmware), mqtt (dependency-free MQTT 3.1.1 client), modbus (Modbus/TCP FC1-6,16) — protocol clients verified against in-repo mocks, UNVERIFIED on real hardware from this sandbox; serial via local bridge (docs/HARDWARE.md); opcua/can NOT AVAILABLE. Telemetry (poll + push ingest), safety loop (limits, interlocks, rate limits, E-stop latch, read-back verification), `physical` grant only via explicit opt-in + per-action confirmation. /api/devices.", status: "partial", tags: ["iot", "esp32", "mqtt", "modbus", "plc", "sensor", "actuator", "safety"], security_level: "physical", requires_confirmation: true, hardware_requirements: ["device", "broker or PLC"], supported_operations: ["register", "read", "ingest", "validate", "actuate", "estop"], verification_status: "verified", locality: "local" }),
    P({ id: "robot:ros2", name: "Robotics — ROS 2 via rosbridge", category: "robot", description: "Dependency-free rosbridge WebSocket client (topics/services/nodes, subscribe/publish/call) + RobotAgent safety governor (velocity clamps, geofence, heartbeat watchdog auto-stop, E-stop latch). Works with real robots or Gazebo/Webots/TurtleBot sims exposing rosbridge. Protocol verified against an in-repo mock; UNVERIFIED on a live ROS 2 graph from this sandbox. /api/robots.", status: "partial", tags: ["robotics", "ros2", "rosbridge", "safety"], security_level: "physical", requires_confirmation: true, hardware_requirements: ["rosbridge_server"], supported_operations: ["inspect", "echo", "govern", "move", "estop"], verification_status: "verified", locality: "local" }),
    P({ id: "twin:digital", name: "Digital Twins", category: "twin", description: "Persisted twins linked to devices: auto-sync from telemetry, history, bounds with critical flags, rule-based forward simulation (safe arithmetic DSL, no eval) to test an actuation before doing it, events, maintenance, health score. Scheduler syncs all twins. /api/twins.", status: "implemented", tags: ["twin", "industrial", "simulation"], security_level: "safe_write", supported_operations: ["create", "sync", "simulate", "health"], verification_status: "verified" }),
    P({ id: "system:observability", name: "Observability & Control Center", category: "system", description: "Structured event log for model/agent/tool/permission/schedule events with a Control Center view. Missing: cost metadata per call (all providers are free tier), persistent trace store, alerts.", status: "partial", tags: ["telemetry", "audit", "control-center"], security_level: "admin", supported_operations: ["record", "query", "summary"], verification_status: "verified", locality: "local" }),
    P({ id: "auth:accounts", name: "Accounts & API keys", category: "auth", description: "Google/GitHub/email/phone sign-in, anonymous device identity, personal API keys (sk-aeth-…), OpenAI-compatible /api/v1.", status: "implemented", tags: ["auth", "oauth", "api-keys"], security_level: "admin", supported_operations: ["login", "session", "keys"], verification_status: "verified" }),
    P({ id: "security:guard", name: "Security layer (least privilege, SSRF guard, rate limits, audit)", category: "system", description: "4 permission levels + physical grant (opt-in), single-use confirmation tokens, stop-actions never blocked by dialogs, SSRF/DNS checks on every user-supplied URL (MCP servers, webhooks, browser, http devices), secret redaction in the event buffer, per-IP edge rate limits + per-uid limits, audit export (/api/telemetry/audit), security headers via middleware. Honest limits: in-memory counters per instance; no WAF.", status: "implemented", tags: ["security", "audit", "ssrf", "rate-limit"], security_level: "read_only", supported_operations: ["authorize", "audit", "rate-limit"], verification_status: "verified" }),
    P({ id: "workspace:scopes", name: "Workspaces", category: "system", description: "Named scopes that group knowledge facts, memories, jobs and automations per user; computed stats, default workspace always present. /api/workspaces. Sharing between accounts NOT AVAILABLE.", status: "implemented", tags: ["workspace", "scope"], security_level: "safe_write", supported_operations: ["create", "update", "delete", "stats"], verification_status: "verified", locality: "local" }),
    P({ id: "storage:json", name: "Storage provider (JSON file store)", category: "storage", description: "Single-node JSON collections under data/. Swap point for Postgres/SQLite (StorageProvider interface in src/core/providers).", status: "implemented", tags: ["storage"], security_level: "admin", supported_operations: ["get", "set", "all", "update", "remove"], verification_status: "verified", locality: "local" }),
  ],
};

// ---- User-registered MCP servers (Phase 7) -----------------------------------------------------
const userMcpSource: CapabilitySource = {
  id: "mcp-servers",
  async list() {
    const all = Object.values(await store.all<McpServerRecord>("mcp_servers"));
    return all.flatMap<Capability>((srv) => [
      { id: `mcpserver:${srv.id}`, name: `MCP · ${srv.name}`, category: "connector", provider: "mcp-gateway", description: `${srv.url} · ${srv.manifest?.serverName ?? ""} ${srv.manifest?.serverVersion ?? ""} · ${srv.manifest?.tools.length ?? 0} tools`.trim(), status: srv.health.state === "healthy" ? "implemented" : srv.health.state === "degraded" ? "partial" : "not_available", tags: ["mcp", "user-server", srv.name.toLowerCase()], security_level: "read_only", cost: { unit: "free" }, latency: "fast", reliability: srv.health.calls ? (srv.health.calls - srv.health.failures + 1) / (srv.health.calls + 2) : undefined, supported_operations: ["tools/list", "tools/call", "health"], verification_status: srv.health.lastCheck ? "verified" : "unverified", locality: /localhost|127\.0\.0\.1|192\.168\.|10\./.test(srv.url) ? "local" : "remote", invoke: { kind: "mcp", ref: `/api/mcp/servers/${srv.id}/call` } },
      ...(srv.manifest?.tools ?? []).map<Capability>((t) => ({ id: `mcpserver:${srv.id}.${t.name}`, name: `${srv.name}: ${t.name}`, category: "tool", provider: "mcp-gateway", description: t.description ?? "", status: srv.health.state === "down" ? "not_available" : "implemented", tags: ["mcp", srv.name.toLowerCase(), ...t.name.split(/[_\-.]/)], input_schema: t.inputSchema, security_level: t.permission, requires_confirmation: t.requiresConfirmation, cost: { unit: "free" }, latency: "fast", supported_operations: ["call"], verification_status: "unverified", locality: "remote", invoke: { kind: "mcp", ref: `/api/mcp/servers/${srv.id}/call` } })),
    ]);
  },
};

let booted = false;
/** Register the built-in sources once (idempotent; safe to call from any route). */
export function bootCapabilities() {
  if (booted) return; booted = true;
  registerSource(modelSource); registerSource(agentSource); registerSource(connectorSource); registerSource(platformSource); registerSource(userMcpSource);
  loadPlugins();
}
/** Plugins register their own CapabilitySources on import (src/plugins/index.ts). */
function loadPlugins() { try { require("@/plugins"); } catch (e) { console.warn("[aetheris] plugin load failed", (e as Error).message); } }
