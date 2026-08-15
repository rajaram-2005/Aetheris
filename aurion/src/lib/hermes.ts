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

import {
  HermesRun,
  MetaStats,
  KnowledgeArticleMeta,
  Adaptation,
  CustomNeuralModel,
  GalleryImage,
  ModelList,
  ModeList,
  ArchitectureModel,
  TrainingPipelineModel,
  ResearchErasResponse,
} from '@/types';

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

/* ─── Unified Home view — product introspection for the single app shell ─── */

/** The three Aetheris model tiers (OpenAI-compatible envelope). */
export function getModels(): Promise<ModelList> {
  return request<ModelList>('/v1/models');
}

/** The inference modes available on this deployment. */
export function getModes(): Promise<ModeList> {
  return request<ModeList>('/v1/modes');
}

/** Foundation architecture spec: modalities, optimizations, context windows. */
export function getArchitecture(): Promise<ArchitectureModel> {
  return request<ArchitectureModel>('/v1/architecture');
}

/** Training pipeline spec plus live meta-learning runtime telemetry. */
export function getTraining(): Promise<TrainingPipelineModel> {
  return request<TrainingPipelineModel>('/v1/training');
}

/** The six AI-evolution research eras (1950–2026). */
export function getResearchEras(): Promise<ResearchErasResponse> {
  return request<ResearchErasResponse>('/v1/research/eras');
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
export function generateImage(
  prompt: string,
  options: { style?: string; palette?: string; width?: number; height?: number; n?: number } = {},
): Promise<{
  artifact: { id: string; url: string; media_type: string };
  artifacts: { id: string; url: string; media_type: string }[];
  detail: { provider: string; model: string; style?: string; palette?: string; variations?: number };
}> {
  return request('/v1/images/generations', {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      width: options.width ?? 1024,
      height: options.height ?? 576,
      style: options.style ?? undefined,
      palette: options.palette ?? undefined,
      n: options.n ?? 1,
    }),
  });
}

/** Generate a looping animation (delivered as a GIF artifact). */
export function generateVideo(
  prompt: string,
  options: {
    motion?: string;
    seconds?: number;
    fps?: number;
    width?: number;
    height?: number;
    loop?: 'loop' | 'bounce';
  } = {},
): Promise<{
  artifact: { id: string; url: string; media_type: string };
  detail: { motion: string; frames: number; fps: number; duration_seconds: number; loop: string };
}> {
  return request('/v1/videos/generations', {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      motion: options.motion ?? undefined,
      seconds: options.seconds ?? 3,
      fps: options.fps ?? 12,
      width: options.width ?? 480,
      height: options.height ?? 270,
      loop: options.loop ?? 'loop',
    }),
  });
}

/** Enlarge a stored image 2–4× (offline, nearest or bilinear). */
export function upscaleImage(
  imageId: string,
  scale: number,
  method: 'nearest' | 'bilinear' = 'bilinear',
): Promise<{
  artifact: { id: string; url: string; media_type: string };
  detail: { operation: string; method: string; scale: number; width: number; height: number };
}> {
  return request('/v1/images/upscale', {
    method: 'POST',
    body: JSON.stringify({ image: imageId, scale, method }),
  });
}

/** Synthesise instrumental music (melody, chords, arp, drums, pad, bass). */
export function generateMusic(
  mode: string,
  options: {
    notation?: string;
    tempo?: number;
    timbre?: string;
    bars?: number;
    pattern?: string;
    fill?: boolean;
    fx?: string[];
  } = {},
): Promise<{
  artifact: { id: string; url: string; media_type: string };
  detail: { mode: string; duration_seconds: number; fx?: string[] };
}> {
  return request('/v1/audio/generations', {
    method: 'POST',
    body: JSON.stringify({
      mode,
      notation: options.notation ?? '',
      tempo: options.tempo ?? 110,
      timbre: options.timbre ?? 'warm',
      bars: options.bars ?? 4,
      pattern: options.pattern ?? undefined,
      fill: options.fill ?? undefined,
      fx: options.fx ?? [],
    }),
  });
}

/** Apply an offline edit (grayscale, sepia, blur, duotone, …) to a stored image. */
export function editImage(
  imageId: string,
  operation: string,
  options: { strength?: number; palette?: string } = {},
): Promise<{
  artifact: { id: string; url: string; media_type: string };
  detail: { operation: string; strength: number; palette?: string; edited_from: string };
}> {
  return request('/v1/images/edits', {
    method: 'POST',
    body: JSON.stringify({
      image: imageId,
      operation,
      strength: options.strength ?? 0.5,
      palette: options.palette ?? undefined,
    }),
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
  engine: 'upstream-model' | 'in-character';
  episode_id: string;
}> {
  return request('/v1/mythology/chat', {
    method: 'POST',
    body: JSON.stringify({ character_id: characterId, message }),
  });
}

/** The whole pantheon as one connected graph. */
export function getMythologyGraph(): Promise<{
  nodes: { id: string; name: string; tamil_name: string; category: string; epithet: string }[];
  edges: { from: string; to: string; relation: string }[];
  node_count: number;
  edge_count: number;
}> {
  return request('/v1/mythology/graph');
}

/** Full details including a character's connections. */
export function getMythologyCharacter(id: string): Promise<
  MythCharacter & { connections: { other: string; relation: string }[] }
> {
  return request(`/v1/mythology/${encodeURIComponent(id)}`);
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

/* ─── Connected mythology features: council, daily wisdom, custom legends ─── */

/** Wisdom of the day — a rotating figure + kural-sized counsel. */
export function getDailyWisdom(): Promise<{
  date: string;
  character_id: string;
  character: { id: string; name: string; tamil_name: string; category: string; epithet: string };
  wisdom: string;
}> {
  return request('/v1/mythology/daily');
}

/** Convene several legends around a question. */
export function mythologyCouncil(
  characterIds: string[],
  question: string,
): Promise<{
  question: string;
  members: { id: string; name: string; tamil_name: string; category: string; epithet: string }[];
  speeches: { id: string; name: string; category: string; voice: string }[];
  synthesis: string;
}> {
  return request('/v1/mythology/council', {
    method: 'POST',
    body: JSON.stringify({ character_ids: characterIds, question }),
  });
}

/** List user-created legends. */
export function getCustomLegends(): Promise<{ count: number; legends: (MythCharacter & { custom: boolean })[] }> {
  return request('/v1/mythology/custom');
}

/** Create a custom legend. */
export function createCustomLegend(data: {
  name: string;
  tamil_name?: string;
  category?: string;
  epithet?: string;
  title?: string;
  domain?: string;
  symbol?: string;
  aspect?: string;
  persona?: string;
  summon?: string;
  image_prompt?: string;
}): Promise<MythCharacter & { custom: boolean }> {
  return request('/v1/mythology/custom', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
