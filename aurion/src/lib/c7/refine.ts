/* ─── REFINE — Stage 7: Safety, honesty, persona polish ─── */

import { RefineResult, WeaveResult, PlotResult, RecallResult, Settings, Style } from '@/types';

/* ── Vendor voice patterns to strip ── */
const VENDOR_PATTERNS = [
  /as of my last (?:training|update|knowledge)/gi,
  /i am (?:chatgpt|gpt|claude|gemini|bard|copilot|an ai language model|an? openai)/gi,
  /as an ai (?:language model|assistant|chatbot)/gi,
  /openai|anthropic|google ai|mistral|meta ai/gi,
  /my (?:training|developers|creators) at (?:openai|google|anthropic|meta|microsoft)/gi,
  /i (?:was|am) (?:trained|built|created|developed) by (?:openai|google|anthropic|meta|microsoft)/gi,
  /i don'?t have (?:feelings|emotions|consciousness|sentience)/gi,
  /i'?m (?:just |merely )?(?:an? |the )?(?:ai|language model|chatbot|assistant|model)/gi,
  /based on my (?:training data|training)/gi,
  /according to my (?:training|knowledge|data)/gi,
  /i (?:can'?t|cannot|am unable to|am not able to) (?:browse|access|search|look up) (?:the )?(?:internet|web|online)/gi,
  /it'?s (?:important|worth) (?:noting|mentioning|pointing out) that (?:i|as)/gi,
  /please note that (?:i|this|as)/gi,
  /i (?:should|must) (?:clarify|mention|note) that/gi,
];

/* ── Safety: harmful content detection ── */
const SAFETY_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /how\s+(?:to\s+)?(?:make|build|create|manufacture)\s+(?:a\s+)?(?:bomb|explosive|weapon|gun|firearm|missile|nuclear)/i, reason: 'Weapons manufacturing' },
  { pattern: /how\s+(?:to\s+)?(?:make|synthesize|produce|cook)\s+(?:meth|cocaine|heroin|fentanyl|lsd|mdma|drugs)/i, reason: 'Illegal drug synthesis' },
  { pattern: /(?:hack|exploit|attack)\s+(?:a\s+)?(?:server|network|database|system)\s+(?:to|and)\s+(?:steal|access|exfiltrate)/i, reason: 'Cyberattack instructions' },
  { pattern: /how\s+(?:to\s+)?(?:commit|carry out|plan)\s+(?:a\s+)?(?:murder|assassination|terrorism|kidnapping|assault)/i, reason: 'Violence instructions' },
  { pattern: /how\s+(?:to\s+)?(?:make|build|create)\s+(?:a\s+)?(?:malware|ransomware|virus|trojan|keylogger|worm)\b/i, reason: 'Malware creation' },
  { pattern: /(?:write|create|generate)\s+(?:a\s+)?(?:exploit|payload|backdoor|rootkit|zero.?day)/i, reason: 'Exploit creation' },
  { pattern: /(?:methods?|ways)\s+(?:to\s+)?(?:harm|hurt|kill)\s+(?:myself|yourself|oneself)/i, reason: 'Self-harm methods' },
  { pattern: /(?:methods?|ways?|how)\s+(?:to\s+)?(?:die|suicide|end\s+(?:it|my\s+life))/i, reason: 'Self-harm content' },
];

/* ── Honesty enforcement: when knowledge is thin ── */
function detectKnowledgeGap(response: string, recallResult: RecallResult): string | undefined {
  const hasGoodMatch = recallResult.articles.some(a => a.score > 2);
  const hasPhrases = /\[.*?\]/.test(response) || /placeholder/i.test(response) || /\[provide|explain|detail|specific\]/i.test(response);

  if (!hasGoodMatch && hasPhrases) {
    return 'Note: This topic may not be fully covered in my built-in knowledge base. The response uses general reasoning rather than verified facts. For authoritative information, please consult specialized sources.';
  }
  return undefined;
}

/* ── Persona adjustment ── */
function applyPersona(text: string, settings: Settings): string {
  switch (settings.persona) {
    case 'precise':
      // Remove hedging language
      return text
        .replace(/\b(perhaps|maybe|possibly|might|could be|it seems)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    case 'imaginative':
      // Slightly more expressive
      return text;

    case 'mentor':
      // Add guiding questions
      if (!text.includes('?') && text.length > 200) {
        return text + '\n\n*What would you like to explore further?*';
      }
      return text;

    case 'concise':
      // Trim verbosity
      if (text.length > 800) {
        const sentences = text.split(/(?<=[.!?])\s+/);
        if (sentences.length > 6) {
          return sentences.slice(0, 6).join(' ') + (text.includes('---') ? '' : '\n\n*Want me to elaborate on any part?*');
        }
      }
      return text;

    case 'balanced':
    default:
      return text;
  }
}

/* ── Length adjustment ── */
function applyLength(text: string, lengthPref: number): string {
  if (lengthPref < 0.3) {
    // Shorter
    const lines = text.split('\n');
    const important = lines.filter(l => !l.startsWith('*') || l.includes('**'));
    return important.slice(0, Math.max(5, Math.floor(important.length * 0.6))).join('\n');
  }
  if (lengthPref > 0.7) {
    // Already detailed by default
    return text;
  }
  return text;
}

/* ── Main REFINE pipeline ── */
export function refine(
  weaveResult: WeaveResult,
  plotResult: PlotResult,
  recallResult: RecallResult,
  settings: Settings,
  rawText: string,
): RefineResult {
  let text = weaveResult.response;
  const stripped: string[] = [];
  let safetyFlag = false;
  let safetyReason: string | undefined;

  // 1. Safety check (on input)
  for (const { pattern, reason } of SAFETY_PATTERNS) {
    if (pattern.test(rawText)) {
      safetyFlag = true;
      safetyReason = reason;
      text = `I can't help with that request. ${reason} falls outside what I'm designed to assist with.\n\nI'm happy to help with constructive topics: writing, coding, learning, math, planning, creative projects, and more. What else can I work on?`;
      return {
        final: text,
        safetyFlag: true,
        safetyReason,
        honestyNote: undefined,
        stripped: [],
      };
    }
  }

  // 2. Strip vendor voice
  for (const pattern of VENDOR_PATTERNS) {
    const before = text;
    text = text.replace(pattern, '');
    if (text !== before) {
      stripped.push(pattern.source);
    }
  }

  // 3. Clean up artifacts from stripping
  text = text.replace(/\.{2,}/g, '.').replace(/\s{2,}/g, ' ').replace(/^\s*[\n]/gm, '\n').trim();

  // 4. Honesty enforcement
  const honestyNote = detectKnowledgeGap(text, recallResult);

  // 5. Persona adjustment
  text = applyPersona(text, settings);

  // 6. Length adjustment
  text = applyLength(text, settings.length);

  // 7. Add honesty footer if needed
  if (honestyNote && !text.includes('knowledge base')) {
    text += `\n\n---\n*${honestyNote}*`;
  }

  return {
    final: text,
    safetyFlag: false,
    safetyReason: undefined,
    honestyNote,
    stripped,
  };
}
