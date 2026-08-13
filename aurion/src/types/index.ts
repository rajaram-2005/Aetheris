/* ─── Aetheris UI types ───
 *
 * These mirror the payloads served by the unified Hermes runtime
 * (`/v1/hermes/*`) and sovereign neural architecture (`/v1/neural/*`).
 */

export type Theme = 'aurora' | 'daylight' | 'ink';
export type Persona = 'balanced' | 'precise' | 'imaginative' | 'mentor' | 'concise';
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
  voiceEnabled: boolean;
  useMemory: boolean;
  learn: boolean;
  showInspector: boolean;
}
