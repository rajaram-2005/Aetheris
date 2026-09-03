import { ProviderError, type ChatMessage, type ProviderConfig } from "./types";

const DEFAULT_TIMEOUT_MS = Number(process.env.AETHERIS_PROVIDER_TIMEOUT_MS ?? 45_000);

/** HTTP statuses that mean "try the next provider". */
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export interface AdapterCall {
  provider: ProviderConfig;
  model: string;
  apiKey: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

async function doFetch(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderError(`network error: ${msg}`, undefined, true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function ensureOk(res: Response, providerName: string): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  // 401/403 (bad key) and 404 (bad model) are not retryable *on this provider*, but the
  // router will still move on to the next one. We flag them so the UI can surface config issues.
  const retryable = RETRYABLE.has(res.status);
  throw new ProviderError(
    `${providerName} responded ${res.status}${detail ? `: ${detail}` : ""}`,
    res.status,
    retryable,
  );
}

// ---------------------------------------------------------------------------------------
// OpenAI-compatible (Groq, Cerebras, SambaNova, GitHub Models, OpenRouter, Mistral, Together,
// HF router, NVIDIA, DeepSeek, AI21, Perplexity)
// ---------------------------------------------------------------------------------------
async function callOpenAI(c: AdapterCall): Promise<string> {
  const res = await doFetch(
    `${c.provider.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.apiKey}`,
        ...(c.provider.headers ?? {}),
      },
      body: JSON.stringify({
        model: c.model,
        messages: c.messages,
        temperature: c.temperature ?? 0.7,
        ...(c.maxTokens ? { max_tokens: c.maxTokens } : {}),
        stream: false,
      }),
    },
    c.signal,
  );
  await ensureOk(res, c.provider.name);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new ProviderError(`${c.provider.name} returned an empty completion`, 200, true);
  return content;
}

// ---------------------------------------------------------------------------------------
// Google Gemini (generateContent)
// ---------------------------------------------------------------------------------------
async function callGemini(c: AdapterCall): Promise<string> {
  const system = c.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = c.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

  const url = `${c.provider.baseUrl}/models/${encodeURIComponent(c.model)}:generateContent`;
  const res = await doFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": c.apiKey },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: {
          temperature: c.temperature ?? 0.7,
          ...(c.maxTokens ? { maxOutputTokens: c.maxTokens } : {}),
        },
      }),
    },
    c.signal,
  );
  await ensureOk(res, c.provider.name);
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new ProviderError(`${c.provider.name} returned an empty completion`, 200, true);
  return text;
}

// ---------------------------------------------------------------------------------------
// Cohere v2 chat
// ---------------------------------------------------------------------------------------
async function callCohere(c: AdapterCall): Promise<string> {
  const res = await doFetch(
    `${c.provider.baseUrl}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({
        model: c.model,
        messages: c.messages,
        temperature: c.temperature ?? 0.7,
        ...(c.maxTokens ? { max_tokens: c.maxTokens } : {}),
      }),
    },
    c.signal,
  );
  await ensureOk(res, c.provider.name);
  const json = (await res.json()) as { message?: { content?: { type: string; text?: string }[] } };
  const text = json.message?.content?.filter((p) => p.type === "text").map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new ProviderError(`${c.provider.name} returned an empty completion`, 200, true);
  return text;
}

// ---------------------------------------------------------------------------------------
// Cloudflare Workers AI
// ---------------------------------------------------------------------------------------
async function callCloudflare(c: AdapterCall): Promise<string> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!account) throw new ProviderError("CLOUDFLARE_ACCOUNT_ID not set", undefined, false);
  const res = await doFetch(
    `${c.provider.baseUrl}/${account}/ai/run/${c.model}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({
        messages: c.messages,
        temperature: c.temperature ?? 0.7,
        ...(c.maxTokens ? { max_tokens: c.maxTokens } : {}),
      }),
    },
    c.signal,
  );
  await ensureOk(res, c.provider.name);
  const json = (await res.json()) as { result?: { response?: string } };
  const text = json.result?.response ?? "";
  if (!text) throw new ProviderError(`${c.provider.name} returned an empty completion`, 200, true);
  return text;
}

export function callProvider(c: AdapterCall): Promise<string> {
  switch (c.provider.kind) {
    case "openai":
      return callOpenAI(c);
    case "gemini":
      return callGemini(c);
    case "cohere":
      return callCohere(c);
    case "cloudflare":
      return callCloudflare(c);
  }
}
