"use client";

/**
 * Voice mode — hands-free conversation.
 *  • Input: browser speech recognition (Web Speech API), language-aware (en-IN / ta-IN / hi-IN / …).
 *  • Output: streamed sentence-by-sentence via the browser's speechSynthesis (lowest latency), or the
 *    Studio TTS mesh (ElevenLabs / Kokoro, BYOK-aware) for the finished reply when the user opts in.
 *  • Loop: after the reply is spoken we automatically listen again; speaking while Aetheris talks
 *    interrupts it (barge-in). Everything is client-side; nothing is recorded or uploaded.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadByok } from "./Studio";

export type VoiceLang = "auto" | "en-IN" | "en-US" | "en-GB" | "ta-IN" | "hi-IN" | "te-IN" | "kn-IN" | "ml-IN" | "bn-IN" | "mr-IN" | "gu-IN" | "es-ES" | "fr-FR" | "de-DE" | "ja-JP" | "ar-SA" | "pt-BR";
export const VOICE_LANGS: { id: VoiceLang; label: string }[] = [
  { id: "auto", label: "Auto (UI language)" }, { id: "en-IN", label: "English (India)" }, { id: "en-US", label: "English (US)" }, { id: "en-GB", label: "English (UK)" },
  { id: "ta-IN", label: "தமிழ் Tamil" }, { id: "hi-IN", label: "हिन्दी Hindi" }, { id: "te-IN", label: "తెలుగు Telugu" }, { id: "kn-IN", label: "ಕನ್ನಡ Kannada" }, { id: "ml-IN", label: "മലയാളം Malayalam" },
  { id: "bn-IN", label: "বাংলা Bengali" }, { id: "mr-IN", label: "मराठी Marathi" }, { id: "gu-IN", label: "ગુજરાતી Gujarati" },
  { id: "es-ES", label: "Español" }, { id: "fr-FR", label: "Français" }, { id: "de-DE", label: "Deutsch" }, { id: "pt-BR", label: "Português" }, { id: "ja-JP", label: "日本語" }, { id: "ar-SA", label: "العربية" },
];
export interface VoicePrefs { lang: VoiceLang; engine: "browser" | "studio"; handsFree: boolean; rate: number; voiceURI: string }
const PREFS_KEY = "aetheris.voice";
const DEFAULT_PREFS: VoicePrefs = { lang: "auto", engine: "browser", handsFree: true, rate: 1, voiceURI: "" };
export function loadVoicePrefs(): VoicePrefs { try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return DEFAULT_PREFS; } }
export function saveVoicePrefs(p: VoicePrefs) { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); }
export function resolveVoiceLang(pref: VoiceLang, uiLang: string): string { if (pref !== "auto") return pref; return uiLang === "ta" ? "ta-IN" : uiLang === "hi" ? "hi-IN" : "en-IN"; }

/** Strip markdown / code so text reads well aloud. Exported for tests. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " (code shown on screen) ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/[^\s)]+?(?=[.,!?]?(?:\s|$))/g, "link")
    .replace(/^#{1,6}\s*/gm, "").replace(/^\s*[-*•]\s+/gm, "").replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~`>|#]/g, "").replace(/\[(\d+)\]/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ").trim();
}
/** Split text into sentence chunks; returns [complete sentences, trailing remainder]. Exported for tests. */
export function splitSentences(text: string): [string[], string] {
  const out: string[] = []; let rest = text;
  const re = /^([^\n]+?(?:[.!?।]+(?=\s|$)|(?=\n)))\n?/;
  for (;;) { const m = re.exec(rest); if (!m || m[1].trim().length < 2) break; out.push(m[1].trim()); rest = rest.slice(m[0].length).replace(/^\s+/, ""); }
  return [out, rest];
}

type SR = { start(): void; stop(): void; abort(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null; onspeechstart?: (() => void) | null };
type SRCtor = new () => SR;
const getSR = (): SRCtor | undefined => { const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }; return w.SpeechRecognition || w.webkitSpeechRecognition; };

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

export function useVoice(opts: { lang: string; prefs: VoicePrefs; onFinal: (text: string) => void; onInterim?: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const [level, setLevel] = useState(0); // 0–1 mic level for the visualiser
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SR | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const spokenUpTo = useRef(0); // chars of the current stream already queued
  const queue = useRef<string[]>([]);
  const uttering = useRef(false);
  const streamId = useRef<string | null>(null);
  const analyser = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);
  const { onFinal, onInterim, lang, prefs } = opts;

  useEffect(() => { setSupported(!!getSR() || !!window.speechSynthesis); }, []);

  // ---- mic level meter (purely visual; audio never leaves the device) ----
  const stopMeter = useCallback(() => { const a = analyser.current; if (!a) return; cancelAnimationFrame(a.raf); a.stream.getTracks().forEach((t) => t.stop()); a.ctx.close().catch(() => undefined); analyser.current = null; setLevel(0); }, []);
  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => { an.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) { const d = (v - 128) / 128; sum += d * d; } setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4)); if (analyser.current) analyser.current.raf = requestAnimationFrame(tick); };
      analyser.current = { ctx, stream, raf: requestAnimationFrame(tick) };
    } catch { /* meter is optional */ }
  }, []);

  const stopListening = useCallback(() => { try { rec.current?.stop(); } catch { /* noop */ } rec.current = null; setListening(false); stopMeter(); }, [stopMeter]);

  const stopSpeaking = useCallback(() => {
    queue.current = []; uttering.current = false; streamId.current = null;
    if (audio.current) { audio.current.pause(); audio.current = null; }
    window.speechSynthesis?.cancel(); setSpeaking(false);
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSR();
    if (!Ctor) { setError("Speech recognition isn't available in this browser — try Chrome, Edge or Safari."); return; }
    stopSpeaking();
    if (rec.current) return;
    const r = new Ctor();
    r.lang = lang; r.continuous = false; r.interimResults = true;
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += t; else interim += t; }
      onInterim?.(finalText + interim);
    };
    r.onend = () => { rec.current = null; setListening(false); stopMeter(); if (finalText.trim()) onFinal(finalText.trim()); else onInterim?.(""); };
    r.onerror = (e) => { rec.current = null; setListening(false); stopMeter(); if (e.error === "not-allowed") setError("Microphone permission denied. Allow the mic for this site and try again."); else if (e.error !== "no-speech" && e.error !== "aborted") setError(`Mic error: ${e.error}`); };
    rec.current = r; setError(null);
    try {
      r.start(); setListening(true); startMeter();
    } catch (err) {
      rec.current = null;
      const embedded = typeof window !== "undefined" && window.self !== window.top;
      setError(embedded
        ? "Voice input is blocked inside this embedded preview (the browser only grants microphone access to the top-level page). Open the site in its own tab to use voice."
        : `Couldn't start the microphone${err instanceof Error && err.message ? ` (${err.message})` : ""}. Check microphone permissions for this site and try again.`);
    }
  }, [lang, onFinal, onInterim, stopSpeaking, stopMeter, startMeter]);

  // ---- browser TTS queue ----
  const pickVoice = useCallback((l: string) => {
    const vs = window.speechSynthesis?.getVoices() ?? [];
    if (prefs.voiceURI) { const v = vs.find((x) => x.voiceURI === prefs.voiceURI); if (v) return v; }
    return vs.find((v) => v.lang === l) ?? vs.find((v) => v.lang.startsWith(l.split("-")[0])) ?? null;
  }, [prefs.voiceURI]);
  const pump = useCallback(() => {
    if (uttering.current || !window.speechSynthesis) return;
    const next = queue.current.shift();
    if (!next) { if (streamId.current === null) setSpeaking(false); return; }
    uttering.current = true; setSpeaking(true);
    const u = new SpeechSynthesisUtterance(next); u.lang = lang; u.rate = prefs.rate; const v = pickVoice(lang); if (v) u.voice = v;
    u.onend = u.onerror = () => { uttering.current = false; pump(); };
    window.speechSynthesis.speak(u);
  }, [lang, prefs.rate, pickVoice]);

  /** Feed a streaming assistant reply; new complete sentences are spoken as they arrive. */
  const speakStream = useCallback((id: string, fullText: string, done: boolean) => {
    if (prefs.engine !== "browser") return;
    if (streamId.current !== id) { streamId.current = id; spokenUpTo.current = 0; }
    const pending = fullText.slice(spokenUpTo.current);
    const [sentences, rest] = splitSentences(pending);
    const toSay = done ? [...sentences, rest].filter((s) => s.trim()) : sentences;
    if (toSay.length) { spokenUpTo.current = fullText.length - (done ? 0 : rest.length); for (const s of toSay) { const c = speakable(s); if (c) queue.current.push(c); } pump(); }
    if (done) { streamId.current = null; if (!uttering.current && queue.current.length === 0) setSpeaking(false); }
  }, [prefs.engine, pump]);

  /** Speak a finished text (Studio TTS mesh with browser fallback). */
  const speak = useCallback(async (text: string) => {
    stopSpeaking();
    const clean = speakable(text).slice(0, 2500);
    if (!clean) return;
    setSpeaking(true);
    if (prefs.engine === "studio") {
      try {
        const r = await fetch("/api/media/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "audio", prompt: clean.slice(0, 1500), keys: loadByok() }) });
        if (r.ok) {
          const j = await r.json() as { url: string };
          const a = new Audio(j.url); audio.current = a; a.playbackRate = prefs.rate;
          a.onended = () => setSpeaking(false); a.onerror = () => setSpeaking(false);
          await a.play(); return;
        }
      } catch { /* fall through to browser TTS */ }
    }
    queue.current = splitSentences(clean + " ")[0].concat(splitSentences(clean + " ")[1] ? [splitSentences(clean + " ")[1]] : []);
    if (!queue.current.length) queue.current = [clean];
    pump();
  }, [prefs.engine, prefs.rate, stopSpeaking, pump]);

  const state: VoiceState = listening ? "listening" : speaking ? "speaking" : "idle";
  const voices = useMemo(() => (typeof window !== "undefined" && window.speechSynthesis ? window.speechSynthesis.getVoices() : []), []);
  useEffect(() => () => { stopListening(); stopSpeaking(); }, [stopListening, stopSpeaking]);

  return { supported, listening, speaking, level, error, state, voices, startListening, stopListening, speak, speakStream, stopSpeaking, clearError: () => setError(null) };
}

/** Full-screen hands-free overlay. */
export function VoiceOverlay(props: {
  state: VoiceState; level: number; interim: string; lastUser: string; lastAssistant: string; error: string | null;
  prefs: VoicePrefs; onPrefs: (p: VoicePrefs) => void; langLabel: string; voices: SpeechSynthesisVoice[];
  onTap: () => void; onStop: () => void; onClose: () => void;
}) {
  const { state, level, interim, lastUser, lastAssistant, error, prefs, onPrefs, langLabel, voices, onTap, onStop, onClose } = props;
  const [showPrefs, setShowPrefs] = useState(false);
  const label = state === "listening" ? "Listening…" : state === "thinking" ? "Thinking…" : state === "speaking" ? "Speaking — tap or talk to interrupt" : prefs.handsFree ? "Tap the orb to start talking" : "Tap the orb, then speak";
  const scale = 1 + (state === "listening" ? level * 0.8 : state === "speaking" ? 0.15 + Math.sin(Date.now() / 200) * 0.05 : 0);
  const langVoices = voices.filter((v) => v.lang.split("-")[0] === (langLabel.split("-")[0] || "en"));
  return (
    <div className="voice-overlay" role="dialog" aria-label="Voice mode">
      <div className="voice-top">
        <span className="meta">🎙 Voice · {VOICE_LANGS.find((l) => l.id === prefs.lang)?.label ?? prefs.lang}{prefs.lang === "auto" ? ` → ${langLabel}` : ""}</span>
        <span className="row" style={{ gap: 6 }}>
          <button className="chip" onClick={() => setShowPrefs((v) => !v)}>⚙ Options</button>
          <button className="chip" onClick={onClose}>✕ Exit</button>
        </span>
      </div>
      {showPrefs && (
        <div className="voice-prefs">
          <label>Language<select value={prefs.lang} onChange={(e) => onPrefs({ ...prefs, lang: e.target.value as VoiceLang })}>{VOICE_LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
          <label>Speech engine<select value={prefs.engine} onChange={(e) => onPrefs({ ...prefs, engine: e.target.value as VoicePrefs["engine"] })}><option value="browser">Browser (instant, speaks while streaming)</option><option value="studio">Studio TTS (higher quality, waits for full reply)</option></select></label>
          {prefs.engine === "browser" && langVoices.length > 0 && <label>Voice<select value={prefs.voiceURI} onChange={(e) => onPrefs({ ...prefs, voiceURI: e.target.value })}><option value="">Default for language</option>{langVoices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}</select></label>}
          <label>Speed <input type="range" min={0.6} max={1.6} step={0.1} value={prefs.rate} onChange={(e) => onPrefs({ ...prefs, rate: Number(e.target.value) })} /> {prefs.rate.toFixed(1)}×</label>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={prefs.handsFree} onChange={(e) => onPrefs({ ...prefs, handsFree: e.target.checked })} /> Hands-free: listen again after each reply</label>
          <p className="hint" style={{ textAlign: "left", margin: 0 }}>Recognition and browser speech run on your device. Nothing is recorded or stored.</p>
        </div>
      )}
      <div className="voice-center">
        <button className={`voice-orb ${state}`} style={{ transform: `scale(${scale.toFixed(3)})` }} onClick={state === "speaking" || state === "thinking" ? onStop : onTap} aria-label={label}>
          {state === "listening" ? "🎙" : state === "thinking" ? "…" : state === "speaking" ? "🔊" : "🎙"}
        </button>
        <div className="voice-label">{label}</div>
        {error && <div className="err-box" style={{ maxWidth: 520 }}>{error}</div>}
        <div className="voice-transcript">
          {(interim || lastUser) && <div className={`voice-line you ${interim ? "live" : ""}`}><span className="meta">You</span>{interim || lastUser}</div>}
          {lastAssistant && <div className="voice-line ai"><span className="meta">Aetheris</span>{speakable(lastAssistant).slice(0, 700)}{speakable(lastAssistant).length > 700 ? "…" : ""}</div>}
        </div>
      </div>
      <div className="voice-bottom hint">Say things like “explain photosynthesis simply”, “@tutor quiz me on fractions”, or “translate this to Tamil”. Full text with formatting stays in the chat.</div>
    </div>
  );
}
