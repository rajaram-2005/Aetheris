export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export type AdapterKind = "openai" | "gemini" | "cohere" | "cloudflare";

export interface ProviderConfig {
  /** Stable identifier, e.g. "groq" */
  id: string;
  /** Human-readable name */
  name: string;
  /** Which wire protocol this provider speaks */
  kind: AdapterKind;
  /** Base URL (OpenAI-compatible providers: the URL that /chat/completions is appended to) */
  baseUrl: string;
  /** Environment variable holding the API key */
  envKey: string;
  /** Default model to use */
  model: string;
  /** Lower = tried first. Ties are shuffled for load balancing. */
  priority: number;
  /** Extra headers required by the provider */
  headers?: Record<string, string>;
  /** Notes shown in the UI / docs */
  notes?: string;
}

export interface ProviderResult {
  provider: string;
  model: string;
  content: string;
  latencyMs: number;
}

export interface ProviderAttempt {
  provider: string;
  ok: boolean;
  status?: number;
  error?: string;
  latencyMs: number;
}

export interface RouteResult extends ProviderResult {
  attempts: ProviderAttempt[];
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
