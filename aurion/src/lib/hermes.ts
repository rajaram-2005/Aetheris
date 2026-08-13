/* ─── Hermes client — talks to the unified Aetheris backend ───
 *
 * The UI no longer carries its own brain. Cognition, tools, memory, and
 * meta-learning all live in the Python runtime; this module is the single
 * seam between the browser and `/v1/hermes/*`.
 *
 * All URLs are relative, so the app works identically whether it is served
 * by FastAPI directly (single-process production) or through the Next dev
 * server's proxy — and never reaches for localhost from the browser.
 */

import { HermesRun, MetaStats, KnowledgeArticleMeta, Adaptation, CustomNeuralModel, GalleryImage } from '@/types';

/** Base path for the API. Relative by design — see the module docstring. */
const API = '';

export class HermesError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'HermesError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } catch {
    throw new HermesError(
      'Cannot reach the Aetheris runtime. Is the server running?',
    );
  }

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep the default message */
    }
    throw new HermesError(detail, response.status);
  }

  return response.json() as Promise<T>;
}

/** Run one task through the full Hermes cascade. */
export function runHermes(
  task: string,
  options: { sessionId?: string; useMemory?: boolean; learn?: boolean; mode?: string } = {},
): Promise<HermesRun> {
  return request<HermesRun>('/v1/hermes/run', {
    method: 'POST',
    body: JSON.stringify({
      task,
      session_id: options.sessionId ?? '',
      use_memory: options.useMemory ?? true,
      learn: options.learn ?? true,
      mode: options.mode ?? '',
    }),
  });
}

/** Send an explicit reward for a past episode (this is what teaches it). */
export function sendFeedback(
  episodeId: string,
  reward: number,
  feedback = '',
): Promise<{ episode: unknown; strategy: Record<string, number> }> {
  return request('/v1/hermes/feedback', {
    method: 'POST',
    body: JSON.stringify({ episode_id: episodeId, reward, feedback }),
  });
}

/** Everything the meta-learner currently believes. */
export function getMetaStats(): Promise<MetaStats> {
  return request<MetaStats>('/v1/hermes/meta');
}

/** Preview the adaptation that would be applied to a task. */
export function previewAdaptation(text: string): Promise<Adaptation> {
  return request<Adaptation>('/v1/hermes/meta/adapt', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

/** The built-in offline knowledge corpus. */
export function getKnowledge(): Promise<{
  count: number;
  categories: string[];
  articles: KnowledgeArticleMeta[];
}> {
  return request('/v1/hermes/knowledge');
}

export function getArticle(id: string): Promise<{
  id: string;
  title: string;
  category: string;
  content: string;
}> {
  return request(`/v1/hermes/knowledge/${encodeURIComponent(id)}`);
}

/** Runtime manifest: pillars, stages, learning state. */
export function getManifest(): Promise<{
  codename: string;
  foundation: string;
  version: string;
  offline: boolean;
  pillars: { id: string; name: string; status: string; summary: string }[];
  stages: string[];
  knowledge_articles: number;
  episodes: number;
  learning_enabled: boolean;
}> {
  return request('/v1/hermes');
}

/** Sovereign in-house neural models list. */
export function getNeuralModels(): Promise<{
  count: number;
  sovereign_engine: string;
  zero_external_dependency: boolean;
  models: CustomNeuralModel[];
}> {
  return request('/v1/neural/models');
}

/** Gallery of mind-blowing UI/UX visual assets. */
export function getGalleryImages(): Promise<{
  total: number;
  images: GalleryImage[];
}> {
  return request('/v1/gallery/images');
}

/** Liveness + which provider is actually serving inference. */
export function getHealth(): Promise<{
  status: string;
  version: string;
  provider: string;
  tools: string[];
}> {
  return request('/v1/health');
}

/* ─── Multi-provider upgrade: skills, integrations, resources, media ─── */

/** Curated skill packs (Claude-style & Gemini-style). */
export function getSkillsCatalog(): Promise<{
  label: string;
  families: {
    family: string;
    note: string;
    skills: {
      id: string;
      name: string;
      icon: string;
      description: string;
      tools: string[];
      trigger: string;
    }[];
  }[];
}> {
  return request('/v1/skills/catalog');
}

/** Available integration templates (Gmail, Meet, Telegram, …). */
export function getIntegrations(): Promise<{
  data: {
    service: string;
    name: string;
    description: string;
    auth_type: string;
    required_fields: string[];
    optional_fields: string[];
  }[];
}> {
  return request('/v1/integrations');
}

/** Open-source runtimes, hosted APIs, and model families. */
export function getResources(): Promise<{
  label: string;
  runtimes: { id: string; name: string; description: string; setup: string; offline: boolean }[];
  hosted: { id: string; name: string; description: string; setup: string }[];
  model_families: { id: string; name: string; license: string; url: string }[];
  media: { id: string; name: string; kind: string; license: string; url: string }[];
}> {
  return request('/v1/resources');
}

/** Generate an image (layered: offline procedural or real model). */
export function generateImage(prompt: string): Promise<{
  artifact: { url: string; media_type: string };
  detail: { provider: string; model: string };
}> {
  return request('/v1/images/generations', {
    method: 'POST',
    body: JSON.stringify({ prompt, width: 1024, height: 576 }),
  });
}

/** Text-to-speech: returns an artifact URL to spoken audio. */
export function synthesizeSpeech(text: string, voice = 'default'): Promise<{
  artifact: { url: string };
  detail: { provider: string; model: string };
}> {
  return request('/v1/audio/speech', {
    method: 'POST',
    body: JSON.stringify({ text, voice }),
  });
}

/* ─── Tamil Mythology ─── */

export interface MythCharacter {
  id: string;
  name: string;
  tamil_name: string;
  category: string;
  epithet: string;
  title: string;
  domain: string;
  symbol: string;
  aspect: string;
  summon: string;
}

export function getMythology(): Promise<{
  count: number;
  categories: Record<string, string>;
  characters: MythCharacter[];
}> {
  return request('/v1/mythology');
}

/** Speak with a summoned mythological character. */
export function mythologyChat(
  characterId: string,
  message: string,
): Promise<{
  character: { id: string; name: string; tamil_name: string; category: string; epithet: string };
  reply: string;
  episode_id: string;
}> {
  return request('/v1/mythology/chat', {
    method: 'POST',
    body: JSON.stringify({ character_id: characterId, message }),
  });
}

/** Generate a portrait of a mythological figure. */
export function mythologyPortrait(characterId: string): Promise<{
  artifact: { url: string; media_type: string };
  detail: { provider: string; name: string };
}> {
  return request(`/v1/mythology/${characterId}/portrait`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
