/**
 * Multimodal Perception (Phase 11) — one typed entry point: perceive(input) → Perception.
 *
 *   image      vision LLM via the model router (Groq/Gemini/OpenRouter/... vision-capable)       IMPLEMENTED
 *   document   PDF/DOCX/CSV/HTML/text extraction (existing KB extractor) + summary                 IMPLEMENTED
 *   audio      speech-to-text via OpenAI-compatible /audio/transcriptions (Groq whisper-large-v3    IMPLEMENTED
 *              free tier, or STT_URL/STT_KEY); no local model → honest NOT AVAILABLE without a key
 *   video      frame sampling with ffmpeg when installed → vision on N frames + optional audio track  PARTIAL
 *              (requires ffmpeg on the host; reported in status())
 *   sensor     numeric time-series → statistics, anomalies (z-score), trend; LLM narrative optional  IMPLEMENTED
 *
 * Generation (image/audio/video) already lives in src/lib/media. Outputs never fake: if no capable
 * provider exists the result carries ok:false and a reason.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { route } from "@/lib/router/router";
import { extractText } from "@/lib/kb";
import { PROVIDERS, apiKeyFor } from "@/lib/router/providers";
import { traced } from "../observability/events";

const run = promisify(execFile);
export type Modality = "image" | "document" | "audio" | "video" | "sensor";
export interface PerceiveInput { modality: Modality; data?: Buffer; url?: string; name?: string; mime?: string; question?: string; series?: { t: number; v: number }[]; preferred?: string }
export interface Perception { ok: boolean; modality: Modality; text: string; structured?: Record<string, unknown>; provider?: string; model?: string; ms: number; reason?: string }

async function which(bin: string) { try { await run("which", [bin]); return true; } catch { return false; } }
export async function status() {
  const vision = PROVIDERS.filter((p) => p.vision && apiKeyFor(p)).map((p) => p.id);
  const stt = process.env.STT_URL && process.env.STT_KEY ? "custom STT_URL" : process.env.GROQ_API_KEY ? "groq whisper-large-v3" : undefined;
  return { image: { available: vision.length > 0, providers: vision }, document: { available: true, formats: "pdf docx csv html txt md code" }, audio: { available: !!stt, via: stt ?? "set GROQ_API_KEY (free) or STT_URL/STT_KEY" }, video: { available: (await which("ffmpeg")) && vision.length > 0, needs: "ffmpeg on host + vision provider" }, sensor: { available: true } };
}

/** Pure sensor analytics: stats, linear trend, z-score anomalies (tested). */
export function analyzeSeries(series: { t: number; v: number }[], z = 3) {
  const n = series.length; if (!n) return { n: 0 };
  const vs = series.map((s) => s.v); const mean = vs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vs.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 0;
  const xs = series.map((s) => s.t); const mx = xs.reduce((a, b) => a + b, 0) / n;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (vs[i] - mean), 0) / (xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1);
  const anomalies = series.filter((s) => sd > 0 && Math.abs(s.v - mean) / sd >= z);
  return { n, min: Math.min(...vs), max: Math.max(...vs), mean, sd, slopePerUnit: slope, trend: Math.abs(slope) * (xs[n - 1] - xs[0]) <= Math.max(sd * 0.5, 1e-9) ? "flat" : slope > 0 ? "rising" : "falling", anomalies, first: series[0], last: series[n - 1] };
}

export async function perceive(input: PerceiveInput): Promise<Perception> {
  return traced({ type: "tool", capability: `multimodal:${input.modality}` }, async () => {
    const t0 = Date.now(); const done = (p: Omit<Perception, "ms" | "modality">): Perception => ({ ...p, modality: input.modality, ms: Date.now() - t0 });
    try {
      switch (input.modality) {
        case "image": {
          const img = input.url ?? (input.data ? `data:${input.mime ?? "image/png"};base64,${input.data.toString("base64")}` : undefined);
          if (!img) return done({ ok: false, text: "", reason: "image data or url required" });
          const r = await route({ preferred: input.preferred, temperature: 0.1, maxTokens: 900, messages: [{ role: "system", content: "You are a precise visual analyst. Describe what is in the image, read any text verbatim, list objects/counts, note safety-relevant details. If asked a question, answer it first." }, { role: "user", content: input.question ?? "Describe this image in detail.", images: [img] }] });
          return done({ ok: true, text: r.content, provider: r.provider, model: r.model });
        }
        case "document": {
          if (!input.data) return done({ ok: false, text: "", reason: "document bytes required" });
          const ex = await extractText(input.name ?? "file", input.mime ?? "application/octet-stream", input.data);
          const excerpt = ex.text.slice(0, 24_000);
          if (!input.question && excerpt.length < 4000) return done({ ok: true, text: excerpt, structured: { kind: ex.kind, chars: ex.text.length, pages: ex.pages?.length } });
          const r = await route({ preferred: input.preferred, temperature: 0.1, maxTokens: 1200, messages: [{ role: "system", content: "Summarise the document faithfully: purpose, key points, entities, numbers, dates, action items. Answer the question if given. Quote when precise." }, { role: "user", content: `${input.question ? `Question: ${input.question}\n\n` : ""}Document (${ex.kind}, ${ex.text.length} chars${ex.text.length > excerpt.length ? ", truncated" : ""}):\n${excerpt}` }] });
          return done({ ok: true, text: r.content, structured: { kind: ex.kind, chars: ex.text.length, pages: ex.pages?.length }, provider: r.provider, model: r.model });
        }
        case "audio": {
          if (!input.data) return done({ ok: false, text: "", reason: "audio bytes required" });
          const tr = await transcribe(input.data, input.name ?? "audio.webm", input.mime);
          if (!tr.ok) return done({ ok: false, text: "", reason: tr.reason });
          if (!input.question) return done({ ok: true, text: tr.text, provider: tr.provider, model: tr.model, structured: { language: tr.language } });
          const r = await route({ preferred: input.preferred, temperature: 0.2, maxTokens: 800, messages: [{ role: "system", content: "Answer using the transcript only." }, { role: "user", content: `Question: ${input.question}\n\nTranscript:\n${tr.text.slice(0, 20_000)}` }] });
          return done({ ok: true, text: r.content, structured: { transcript: tr.text, language: tr.language }, provider: r.provider, model: r.model });
        }
        case "video": {
          if (!input.data) return done({ ok: false, text: "", reason: "video bytes required" });
          if (!(await which("ffmpeg"))) return done({ ok: false, text: "", reason: "ffmpeg not installed on this host — video understanding NOT AVAILABLE here" });
          const dir = await mkdtemp(path.join(tmpdir(), "aeth-v-")); const src = path.join(dir, input.name?.replace(/[^\w.]/g, "_") ?? "in.mp4");
          try {
            await writeFile(src, input.data);
            await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", src, "-vf", "fps=1/5,scale=768:-1", "-frames:v", "6", path.join(dir, "f%02d.jpg")], { timeout: 60_000 });
            const frames: string[] = []; for (let i = 1; i <= 6; i++) { try { frames.push(`data:image/jpeg;base64,${(await readFile(path.join(dir, `f${String(i).padStart(2, "0")}.jpg`))).toString("base64")}`); } catch { break; } }
            if (!frames.length) return done({ ok: false, text: "", reason: "no frames extracted" });
            let transcript = ""; try { await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", path.join(dir, "a.mp3")], { timeout: 60_000 }); const tr = await transcribe(await readFile(path.join(dir, "a.mp3")), "a.mp3", "audio/mpeg"); if (tr.ok) transcript = tr.text; } catch { /* no audio track or STT */ }
            const r = await route({ preferred: input.preferred, temperature: 0.1, maxTokens: 1000, messages: [{ role: "system", content: "You see frames sampled every 5 seconds from a video (in order) and an optional transcript. Describe what happens over time; answer the question if given." }, { role: "user", content: `${input.question ?? "What happens in this video?"}${transcript ? `\n\nTranscript:\n${transcript.slice(0, 8000)}` : ""}`, images: frames }] });
            return done({ ok: true, text: r.content, structured: { frames: frames.length, transcript: transcript || undefined }, provider: r.provider, model: r.model });
          } finally { await rm(dir, { recursive: true, force: true }); }
        }
        case "sensor": {
          if (!input.series?.length) return done({ ok: false, text: "", reason: "series [{t,v}] required" });
          const a = analyzeSeries(input.series);
          if (!input.question) return done({ ok: true, text: `${a.n} samples · mean ${a.mean?.toFixed(3)} · sd ${a.sd?.toFixed(3)} · ${a.trend} · ${a.anomalies?.length ?? 0} anomalies`, structured: a });
          const r = await route({ preferred: input.preferred, temperature: 0.1, maxTokens: 600, messages: [{ role: "system", content: "You interpret sensor statistics for an engineer. Be quantitative and cautious; never invent causes without saying they are hypotheses." }, { role: "user", content: `Question: ${input.question}\nStats: ${JSON.stringify(a)}` }] });
          return done({ ok: true, text: r.content, structured: a, provider: r.provider, model: r.model });
        }
      }
    } catch (e) { return done({ ok: false, text: "", reason: (e as Error).message }); }
  });
}

/** OpenAI-compatible speech-to-text. Groq's free tier hosts whisper-large-v3. */
export async function transcribe(data: Buffer, name: string, mime?: string): Promise<{ ok: true; text: string; language?: string; provider: string; model: string } | { ok: false; reason: string }> {
  const custom = process.env.STT_URL && process.env.STT_KEY; const groq = process.env.GROQ_API_KEY;
  if (!custom && !groq) return { ok: false, reason: "no speech-to-text provider configured (set GROQ_API_KEY — free — or STT_URL/STT_KEY)" };
  const url = custom ? `${process.env.STT_URL!.replace(/\/$/, "")}/audio/transcriptions` : "https://api.groq.com/openai/v1/audio/transcriptions";
  const model = process.env.STT_MODEL ?? (custom ? "whisper-1" : "whisper-large-v3");
  const fd = new FormData(); fd.append("file", new Blob([new Uint8Array(data)], { type: mime ?? "application/octet-stream" }), name); fd.append("model", model); fd.append("response_format", "verbose_json");
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${custom ? process.env.STT_KEY : groq}` }, body: fd, signal: AbortSignal.timeout(120_000) });
  if (!r.ok) return { ok: false, reason: `STT ${r.status}: ${(await r.text()).slice(0, 200)}` };
  const j = (await r.json()) as { text: string; language?: string };
  return { ok: true, text: j.text, language: j.language, provider: custom ? "custom" : "groq", model };
}
