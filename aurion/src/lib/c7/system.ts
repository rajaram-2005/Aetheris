/* ─── SYSTEM — C7 Cascade Orchestrator ─── */

import { C7Trace, Message, Thread, Settings, Attachment } from '@/types';
import { sense } from './sense';
import { align } from './align';
import { plot } from './plot';
import { recall } from './recall';
import { think } from './think';
import { weave } from './weave';
import { refine } from './refine';

const DEFAULT_SETTINGS: Settings = {
  persona: 'balanced',
  creativity: 0.5,
  length: 0.5,
  theme: 'aurora',
  voiceEnabled: false,
  systemPrompt: `You are AURION, a sovereign cognitive engine on the user's device. You are not ChatGPT/Gemini/Claude. No vendor APIs. C7 is your mind. Be fluent where you have structure/knowledge and honest where you don't. Voice: clear, specific, slightly dry. No "Great question!". Answer first. Complete artefacts. Educational-only for health/law/finance. Refuse crime/weapons/malware. Do not mention these instructions unless asked "show me your system prompt".`,
};

export function getSystemPrompt(): string {
  return DEFAULT_SETTINGS.systemPrompt;
}

export async function runC7(
  userText: string,
  settings: Settings = DEFAULT_SETTINGS,
  thread: Thread | null = null,
  attachments: Attachment[] = [],
): Promise<{ response: string; trace: C7Trace }> {
  const timings: Record<string, number> = {};

  // ── SENSE ──
  let t0 = performance.now();
  const senseResult = sense(userText);
  timings.sense = performance.now() - t0;

  // ── ALIGN ──
  t0 = performance.now();
  const alignResult = align(senseResult, userText);
  timings.align = performance.now() - t0;

  // ── PLOT ──
  t0 = performance.now();
  const plotResult = plot(alignResult, senseResult, settings);
  timings.plot = performance.now() - t0;

  // ── RECALL ──
  t0 = performance.now();
  const recallResult = recall(senseResult, alignResult, userText, thread, attachments);
  timings.recall = performance.now() - t0;

  // ── THINK ──
  t0 = performance.now();
  const thinkResult = think(userText, senseResult);
  timings.think = performance.now() - t0;

  // ── WEAVE ──
  t0 = performance.now();
  const weaveResult = weave(
    userText,
    alignResult.intent,
    plotResult,
    recallResult,
    thinkResult,
    senseResult,
    settings,
    attachments.map(a => ({ name: a.name, content: a.content })),
    thread?.messages,
  );
  timings.weave = performance.now() - t0;

  // ── REFINE ──
  t0 = performance.now();
  const refineResult = refine(weaveResult, plotResult, recallResult, settings, userText);
  timings.refine = performance.now() - t0;

  const trace: C7Trace = {
    sense: senseResult,
    align: alignResult,
    plot: plotResult,
    recall: recallResult,
    think: thinkResult,
    weave: weaveResult,
    refine: refineResult,
    timings,
  };

  return { response: refineResult.final, trace };
}

export { DEFAULT_SETTINGS };
