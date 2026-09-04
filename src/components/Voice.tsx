"use client";

/**
 * Voice mode — browser speech recognition (Web Speech API) for input, and either the
 * Studio TTS mesh (ElevenLabs / Kokoro, BYOK-aware) or the browser's speechSynthesis for output.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadByok } from "./Studio";

type SR = { start(): void; stop(): void; abort(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

export function useVoice(opts: { lang?: string; onFinal: (text: string) => void; onInterim?: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const rec = useRef<SR | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const { onFinal, onInterim } = opts;

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  const stopListening = useCallback(() => { rec.current?.stop(); setListening(false); }, []);
  const startListening = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = opts.lang ?? navigator.language ?? "en-IN"; r.continuous = false; r.interimResults = true;
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += t; else interim += t; }
      onInterim?.(finalText + interim);
    };
    r.onend = () => { setListening(false); if (finalText.trim()) onFinal(finalText.trim()); };
    r.onerror = () => setListening(false);
    rec.current = r; r.start(); setListening(true);
  }, [opts.lang, onFinal, onInterim]);

  const stopSpeaking = useCallback(() => { audio.current?.pause(); audio.current = null; window.speechSynthesis?.cancel(); setSpeaking(false); }, []);
  const speak = useCallback(async (text: string) => {
    stopSpeaking();
    const clean = text.replace(/```[\s\S]*?```/g, " (code omitted) ").replace(/[*_#>`|]/g, "").replace(/\[(\d+)\]/g, "").replace(/\s+/g, " ").trim().slice(0, 1500);
    if (!clean) return;
    setSpeaking(true);
    try {
      const r = await fetch("/api/media/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "audio", prompt: clean, keys: loadByok() }) });
      if (r.ok) {
        const j = await r.json() as { url: string };
        const a = new Audio(j.url); audio.current = a;
        a.onended = () => setSpeaking(false); a.onerror = () => setSpeaking(false);
        await a.play(); return;
      }
    } catch { /* fall through to browser TTS */ }
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(clean); u.lang = opts.lang ?? "en-IN";
      u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    } else setSpeaking(false);
  }, [opts.lang, stopSpeaking]);

  return { supported, listening, speaking, startListening, stopListening, speak, stopSpeaking };
}
