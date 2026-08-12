/* ─── Aetheris UI types ───
 *
 * These mirror the payloads served by the unified Hermes runtime
 * (`/v1/hermes/*`). Cognition types are no longer defined here as
 * browser-side structures — they are what the backend reports.
 */

export type Theme = 'aurora' | 'daylight' | 'ink';
export type Persona = 'balanced' | 'precise' | 'imaginative' | 'mentor' | 'concise';

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
  voiceEnabled: boolean;
  useMemory: boolean;
  learn: boolean;
  showInspector: boolean;
}
