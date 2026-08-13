/* ─── Aetheris UI types ───
 *
 * These mirror the payloads served by the unified Hermes runtime
 * (`/v1/hermes/*`) and sovereign neural architecture (`/v1/neural/*`).
 */

/** The two views of the single application shell. */
export type AppView = 'home' | 'workspace';

export type Theme =
  | 'aurora'
  | 'daylight'
  | 'ink'
  | 'titanium'
  | 'nordic'
  | 'arcane'
  | 'elven'
  | 'celestial'
  | 'alchemy'
  | 'abyssal_horror'
  | 'blood_moon'
  | 'shadow_realm'
  | 'cyberpunk_neon'
  | 'synthwave'
  | 'matrix_terminal'
  | 'thamizh_mythos'
  | 'olympus';
export type Persona = 'balanced' | 'precise' | 'imaginative' | 'mentor' | 'concise';
export type ModeId =
  | 'general'
  | 'engineering'
  | 'editorial'
  | 'structured'
  | 'myth'
  | 'legendary'
  | 'pro'
  | 'lite'
  | 'flash'
  | 'thamizh';
export type ModelId =
  | 'aetheris-prime-v4'
  | 'aetheris-omni-reasoner'
  | 'aetheris-flash-v2'
  | 'hermes-cognition-v4'
  | 'aetheris-vision-v3';

export interface CustomNeuralModel {
  id: string;
  name: string;
  version: string;
  parameters_total: string;
  parameters_active: string;
  architecture: string;
  context_window: number;
  max_output_tokens: number;
  hidden_dim: number;
  num_layers: number;
  num_heads: number;
  latency_ms_per_token: number;
  description: string;
  specialties: string[];
  multimodal: boolean;
  reasoning_pass: boolean;
  is_sovereign: boolean;
}

export interface GalleryImage {
  id: string;
  url: string;
  title: string;
  tagline: string;
  prompt: string;
  category: string;
  tags: string[];
  dimensions: string;
}

/* ── Hermes cascade ── */

/** One stage of the eleven-stage Hermes cascade. */
export interface StageTrace {
  stage: string;
  summary: string;
  duration_ms: number;
  skipped: boolean;
  detail: Record<string, unknown>;
}

export interface ToolCallTrace {
  tool: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  output: string;
  error: string;
  duration_ms: number;
}

export interface ExemplarPreview {
  task: string;
  intent: string;
  reward: number;
  answer_preview: string;
}

export interface Adaptation {
  intent_prior: Record<string, number>;
  exemplars: ExemplarPreview[];
  preferred_tools: string[];
  discouraged_tools: string[];
  strategy: Record<string, number>;
  familiarity: number;
  episodes_seen: number;
  rationale: string[];
}

export interface ExpertRoute {
  id?: string;
  name?: string;
  weight?: number;
  signals?: Record<string, number>;
}

/** The full result of one Hermes run. */
export interface HermesRun {
  answer: string;
  intent: string;
  confidence: number;
  episode_id: string;
  mode?: string;
  grounded: boolean;
  solved_exactly: boolean;
  safety_flag: boolean;
  reward: number;
  duration_ms: number;
  strategy: Record<string, number>;
  adaptation: Adaptation;
  experts: ExpertRoute[];
  stages: StageTrace[];
  tool_trace: ToolCallTrace[];
}

/* ── Meta-learning ── */

export interface ToolPrior {
  intent: string;
  tool: string;
  attempts: number;
  successes: number;
  success_rate: number;
}

export interface MetaStats {
  episodes: number;
  updates: number;
  exemplars: number;
  strategy: Record<string, number>;
  mean_reward: number;
  recent_mean_reward: number;
  improving: boolean;
  intent_prior: Record<string, number>;
  intent_reward: Record<string, number>;
  tool_priors: ToolPrior[];
}

export interface KnowledgeArticleMeta {
  id: string;
  title: string;
  category: string;
  chars: number;
}

/* ── Conversation ── */

export interface Attachment {
  name: string;
  type: string;
  content: string;
  size: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  run?: HermesRun;
  attachments?: Attachment[];
  /** Set once the user has rated this answer, so the UI can show it. */
  rated?: number;
  error?: boolean;
}

export interface Thread {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  persona: Persona;
  theme: Theme;
  model: ModelId;
  mode: ModeId;
  voiceEnabled: boolean;
  useMemory: boolean;
  learn: boolean;
  showInspector: boolean;
}

/* ── 50 AI Research Features (1950 - 2026) ── */

export type EvolutionEraId =
  | 'symbolic_foundations_1950_1980'
  | 'statistical_learning_1990_2000'
  | 'deep_learning_revolution_2010_2017'
  | 'transformers_scaling_2018_2022'
  | 'direct_alignment_efficiency_2023_2024'
  | 'frontier_reasoning_compute_2024_2026';

export interface ResearchFeatureItem {
  id: string;
  name: string;
  era: EvolutionEraId;
  year: number;
  authors: string;
  citation: string;
  mathematical_formula: string;
  summary: string;
  description?: string;
  key_innovations?: string[];
  default_parameters?: Record<string, any>;
}

export interface ResearchTimelineItem {
  year: number;
  feature_id: string;
  name: string;
  era: EvolutionEraId;
  paper_title: string;
  milestone_impact: string;
}

export interface ResearchRunOutput {
  feature_id: string;
  name: string;
  era: EvolutionEraId;
  year: number;
  status: string;
  metrics: Record<string, any>;
  artifacts: Record<string, any>;
  theoretical_insight: string;
  execution_time_ms: number;
}

/* ── Unified Home view data (mirrors /v1/models, /v1/modes, /v1/architecture,
      /v1/training, /v1/research/eras) ── */

export interface ModelInfo {
  id: string;
  alias: string;
  display_name: string;
  tagline: string;
  description: string;
  context_window: number;
  max_output_tokens: number;
  latency_class: string;
  reasoning: boolean;
  capabilities: string[];
}

export interface ModelList {
  object: 'list';
  data: ModelInfo[];
}

export interface ModeInfo {
  id: string;
  display_name: string;
  description: string;
  family: string;
  aliases: string[];
}

export interface ModeList {
  object: 'list';
  data: ModeInfo[];
}

export interface ModalitySupport {
  text: boolean;
  code: boolean;
  structured_data: boolean;
  ui_schematics: boolean;
  image: boolean;
  logical_diagrams: boolean;
  evidence?: string;
}

export interface ArchitectureModel {
  name: string;
  architecture_type: string;
  optimizations: string[];
  modalities: ModalitySupport;
  alignment: string;
  output_fidelity_domains: string[];
  hallucination_policy: string;
  context_windows: Record<string, number>;
  evidence: Record<string, string>;
}

export interface TrainingStageModel {
  id: string;
  name: string;
  phase: string;
  objective: string;
  evidence: string;
  datasets: string[];
  notes: string;
}

export interface TrainingRuntimeTelemetry {
  hermes_enabled?: boolean;
  available?: boolean;
  learning_enabled?: boolean;
  pillars?: { hermes_agent?: string; meta_learning?: string };
  episodes_learned_from?: number;
  meta_updates?: number;
  few_shot_exemplars?: number;
  adapted_strategy?: Record<string, number>;
  mean_reward?: number;
  recent_mean_reward?: number;
  improving?: boolean;
  intent_prior?: Record<string, number>;
  tool_priors?: unknown[];
}

export interface TrainingPipelineModel {
  name: string;
  foundation: string;
  foundation_status: string;
  alignment_methods: string[];
  meta_learning_methods: string[];
  stages: TrainingStageModel[];
  evidence: Record<string, string>;
  runtime?: TrainingRuntimeTelemetry;
}

export interface EraSummary {
  era_id: EvolutionEraId;
  title: string;
  time_span: string;
  paradigm: string;
  feature_count: number;
  features: string[];
}

export interface ResearchErasResponse {
  eras: EraSummary[];
}


