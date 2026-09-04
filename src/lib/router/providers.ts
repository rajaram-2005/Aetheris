import type { ProviderConfig } from "./types";

/**
 * The Aetheris provider mesh.
 *
 * Every provider here has a free tier (or free developer credits) at the time of writing.
 * A provider is only *active* if its API key env var is set. The router tries providers in
 * priority order (lower first), shuffling within the same priority, and fails over on
 * rate limits / errors.
 *
 * Model names are defaults and can be overridden per provider with AETHERIS_MODEL_<ID>
 * (e.g. AETHERIS_MODEL_GROQ=llama-3.1-8b-instant).
 */
export const PROVIDERS: ProviderConfig[] = [
  // ---- Tier 1: fast + generous free tiers -------------------------------------------
  {
    id: "groq",
    name: "Groq Cloud",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    model: "llama-3.3-70b-versatile",
    priority: 1,
    vision: true, visionModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    notes: "LPU-accelerated Llama; very fast, free tier.",
  },
  {
    id: "cerebras",
    name: "Cerebras Inference",
    kind: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    envKey: "CEREBRAS_API_KEY",
    model: "llama-3.3-70b",
    priority: 1,
    notes: "Wafer-scale inference, free tier.",
  },
  {
    id: "sambanova",
    name: "SambaNova Cloud",
    kind: "openai",
    baseUrl: "https://api.sambanova.ai/v1",
    envKey: "SAMBANOVA_API_KEY",
    model: "Meta-Llama-3.3-70B-Instruct",
    priority: 1,
    vision: true, visionModel: "Llama-4-Maverick-17B-128E-Instruct",
    notes: "High-speed free tier inference.",
  },
  {
    id: "gemini",
    name: "Google AI Studio",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    envKey: "GEMINI_API_KEY",
    model: "gemini-2.0-flash",
    priority: 1,
    vision: true,
    notes: "Gemini Flash; generous free tier.",
  },

  // ---- Tier 2: solid free tiers -----------------------------------------------------
  {
    id: "github",
    name: "GitHub Models",
    kind: "openai",
    baseUrl: "https://models.github.ai/inference",
    envKey: "GITHUB_MODELS_TOKEN",
    model: "openai/gpt-4o-mini",
    priority: 2,
    vision: true,
    notes: "Free for developers with a GitHub PAT (models:read scope).",
  },
  {
    id: "openrouter",
    name: "OpenRouter (free)",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    priority: 2,
    vision: true, visionModel: "google/gemma-3-27b-it:free",
    headers: {
      "HTTP-Referer": "https://github.com/rajaram-2005/Aetheris",
      "X-Title": "Aetheris One",
    },
    notes: "Aggregator of dozens of free open-weight models.",
  },
  {
    id: "mistral",
    name: "Mistral La Plateforme",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
    model: "open-mistral-nemo",
    priority: 2,
    vision: true, visionModel: "pixtral-12b-2409",
    notes: "Free experiment tier.",
  },
  {
    id: "together",
    name: "Together AI",
    kind: "openai",
    baseUrl: "https://api.together.xyz/v1",
    envKey: "TOGETHER_API_KEY",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
    priority: 2,
    vision: true, visionModel: "meta-llama/Llama-Vision-Free",
    notes: "Free credit tier for Llama and Qwen.",
  },
  {
    id: "cohere",
    name: "Cohere",
    kind: "cohere",
    baseUrl: "https://api.cohere.com/v2",
    envKey: "COHERE_API_KEY",
    model: "command-r-08-2024",
    priority: 2,
    notes: "Command-R; free trial developer key.",
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    kind: "cloudflare",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts",
    envKey: "CLOUDFLARE_API_TOKEN",
    model: "@cf/meta/llama-3.1-8b-instruct",
    priority: 2,
    notes: "Edge inference; needs CLOUDFLARE_ACCOUNT_ID too. 10k neurons/day free.",
  },
  {
    id: "huggingface",
    name: "Hugging Face Inference",
    kind: "openai",
    baseUrl: "https://router.huggingface.co/v1",
    envKey: "HF_TOKEN",
    model: "meta-llama/Llama-3.1-8B-Instruct",
    priority: 2,
    notes: "Serverless inference across open-source models; free monthly credits.",
  },

  // ---- Tier 3: credit-based / specialist ---------------------------------------------
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    kind: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    envKey: "NVIDIA_API_KEY",
    model: "meta/llama-3.1-70b-instruct",
    priority: 3,
    vision: true, visionModel: "meta/llama-3.2-90b-vision-instruct",
    notes: "Free developer credits.",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
    model: "deepseek-chat",
    priority: 3,
    notes: "Hyper-cheap; grants for new accounts.",
  },
  {
    id: "ai21",
    name: "AI21 Labs",
    kind: "openai",
    baseUrl: "https://api.ai21.com/studio/v1",
    envKey: "AI21_API_KEY",
    model: "jamba-mini",
    priority: 3,
    notes: "Jamba models; free trial credits.",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    kind: "openai",
    baseUrl: "https://api.perplexity.ai",
    envKey: "PERPLEXITY_API_KEY",
    model: "sonar",
    priority: 4,
    notes: "Online search-grounded answers. Kept last: intended for explicit web queries.",
  },
];

export function providerById(id: string): ProviderConfig | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Resolve the model for a provider, honouring AETHERIS_MODEL_<ID> overrides. */
export function resolveModel(p: ProviderConfig, opts?: { vision?: boolean }): string {
  if (opts?.vision) {
    const vo = process.env[`AETHERIS_VISION_MODEL_${p.id.toUpperCase()}`];
    if (vo && vo.trim()) return vo.trim();
    if (p.visionModel) return p.visionModel;
  }
  const override = process.env[`AETHERIS_MODEL_${p.id.toUpperCase()}`];
  return override && override.trim() ? override.trim() : p.model;
}

export function isConfigured(p: ProviderConfig): boolean {
  const key = process.env[p.envKey];
  if (!key || !key.trim()) return false;
  if (p.kind === "cloudflare" && !process.env.CLOUDFLARE_ACCOUNT_ID) return false;
  return true;
}
