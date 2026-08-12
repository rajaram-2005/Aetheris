/* ─── ALIGN — Stage 2: Hybrid intent classifier (cue/regex + TF-IDF cosine) ─── */

import { AlignResult, Intent, SenseResult } from '@/types';

/* ── Intent prototypes (phrases that exemplify each intent) ── */
const INTENT_PROTOTYPES: Record<Intent, string[]> = {
  greet: ['hello', 'hi', 'hey', 'good morning', 'good evening', 'namaste', 'hola', 'howdy', 'sup', 'yo', 'greetings'],
  identity: ['who are you', 'what are you', 'your name', 'what is your name', 'introduce yourself', 'tell me about yourself', 'are you chatgpt', 'are you ai', 'what do you do'],
  capability: ['what can you do', 'your capabilities', 'what are your features', 'help me with', 'what do you know', 'show me what you can do', 'capabilities'],
  write_email: ['write an email', 'draft email', 'compose email', 'email to', 'send email', 'write a formal email', 'professional email', 'business email'],
  write_letter: ['write a letter', 'draft letter', 'compose letter', 'formal letter', 'application letter', 'cover letter', 'resignation letter', 'complaint letter'],
  write_blog: ['write a blog', 'blog post', 'write article', 'write a post', 'blog about', 'article about', 'write content'],
  write_social: ['write a tweet', 'social media post', 'instagram caption', 'write a caption', 'linkedin post', 'twitter thread', 'write a post for social'],
  write_ad: ['write an ad', 'advertisement copy', 'ad copy', 'write copy', 'marketing copy', 'sales copy', 'promotional text'],
  write_poem: ['write a poem', 'compose poem', 'poetry', 'write verse', 'haiku', 'write a sonnet', 'rhyme about'],
  write_story: ['write a story', 'tell a story', 'short story', 'fiction', 'write a tale', 'narrative', 'once upon a time'],
  rewrite: ['rewrite', 'rephrase', 'reword', 'paraphrase', 'improve this', 'make it better', 'edit this', 'fix this text'],
  summarize: ['summarize', 'summary', 'tldr', 'brief summary', 'give me a summary', 'short version', 'key points', 'condense this'],
  code_gen: ['write code', 'code for', 'program to', 'function that', 'script to', 'implement', 'build a', 'create a class', 'write a function', 'generate code', 'write a program'],
  code_explain: ['explain this code', 'what does this code do', 'how does this work', 'code explanation', 'walk me through', 'explain the code', 'code review'],
  code_debug: ['debug', 'fix this code', 'error in', 'not working', 'bug in', 'fix bug', 'troubleshoot', 'code error', 'syntax error', 'runtime error'],
  translate: ['translate', 'translation', 'in hindi', 'in telugu', 'in spanish', 'in french', 'in german', 'in tamil', 'how do you say', 'meaning in', 'convert to hindi', 'say it in'],
  math: ['calculate', 'compute', 'solve', 'what is', 'find the value', 'evaluate', 'math', 'equation', 'formula', 'derivative', 'integral', 'algebra'],
  explain: ['explain', 'what is', 'how does', 'tell me about', 'describe', 'define', 'meaning of', 'what does it mean', 'elaborate on'],
  howto: ['how to', 'how do i', 'how can i', 'steps to', 'guide me', 'tutorial', 'instructions for', 'way to'],
  compare: ['compare', 'difference between', 'vs', 'versus', 'which is better', 'pros and cons', 'contrast', 'distinction'],
  quiz: ['quiz me', 'test me', 'quiz', 'questions about', 'ask me questions', 'practice questions', 'mcq', 'multiple choice'],
  flashcard: ['flashcard', 'flash card', 'make cards', 'study cards', 'revision cards', 'memory cards'],
  study: ['study plan', 'study guide', 'study tips', 'how to study', 'prepare for exam', 'exam preparation', 'jee', 'neet', 'upsc'],
  eli5: ['eli5', 'explain like i am five', 'explain in simple terms', 'simple explanation', 'for beginners', 'in layman terms', 'like i am a kid'],
  resume: ['resume', 'cv', 'curriculum vitae', 'build resume', 'create cv', 'resume template', 'professional resume'],
  interview: ['interview', 'interview questions', 'job interview', 'mock interview', 'interview prep', 'prepare for interview'],
  analyze: ['analyze', 'analysis', 'examine', 'evaluate', 'assess', 'review', 'breakdown', 'insights'],
  brainstorm: ['brainstorm', 'ideas for', 'give me ideas', 'creative ideas', 'suggestions', 'think of', 'come up with'],
  plan: ['plan', 'planning', 'schedule', 'roadmap', 'timeline', 'project plan', 'strategy', 'action plan'],
  image: ['draw', 'image', 'picture', 'generate image', 'create image', 'visualize', 'illustration', 'poster', 'artwork'],
  diagram: ['diagram', 'flowchart', 'chart', 'graph', 'visual', 'diagram for', 'flow diagram', 'process flow'],
  palette: ['color palette', 'colour palette', 'colors for', 'theme colors', 'design palette', 'generate palette'],
  recipe: ['recipe', 'cook', 'cooking', 'how to make', 'ingredients', 'preparation', 'biryani recipe', 'food'],
  travel: ['travel', 'visit', 'tourist', 'tourism', 'places to visit', 'things to do', 'weekend plan', 'trip'],
  health: ['health', 'symptoms', 'medicine', 'doctor', 'diet', 'nutrition', 'exercise', 'workout', 'fitness'],
  convert: ['convert', 'conversion', 'how many', 'celsius to fahrenheit', 'km to miles', 'kg to pounds', 'unit conversion'],
  datetime: ['time', 'date', 'today', 'what day', 'current time', 'day of the week', 'timezone'],
  joke: ['joke', 'funny', 'make me laugh', 'humor', 'tell me a joke', 'laugh', 'comedy'],
  file_qa: ['file', 'document', 'attached', 'this file', 'read this', 'analyze this file', 'from the file', 'based on the file'],
  chat: ['chat', 'talk', 'conversation', 'let us talk', 'tell me something', 'anything interesting', 'what do you think'],
};

/* ── Cue patterns (regex) for fast matching ── */
const CUE_PATTERNS: { intent: Intent; pattern: RegExp; weight: number }[] = [
  { intent: 'greet', pattern: /^(hi|hello|hey|yo|sup|howdy|namaste|hola|good\s+(morning|afternoon|evening|night))\b/i, weight: 0.95 },
  { intent: 'identity', pattern: /(who|what)\s+(are|r)\s+(you|u)|(your\s+name)|(are\s+you\s+(chatgpt|gpt|ai|claude|gemini))/i, weight: 0.9 },
  { intent: 'capability', pattern: /what\s+can\s+you\s+do|capabilities|features|what\s+do\s+you\s+know/i, weight: 0.85 },
  { intent: 'math', pattern: /(?:calculate|compute|solve|evaluate)\s+[\d\(]|[\d\+\-\*\/\^\(\)]+\s*=\s*\?|\b\d+\s*[\+\-\*\/\^%]\s*\d+/i, weight: 0.9 },
  { intent: 'translate', pattern: /(?:translate|in\s+(?:hindi|telugu|spanish|french|german|tamil|urdu|bengali|marathi)|(?:hindi|telugu|spanish|french|german|tamil)\s+(?:mein|lo|in)|how\s+(?:do\s+you\s+)?say|meaning\s+in)/i, weight: 0.85 },
  { intent: 'code_gen', pattern: /(?:write|create|build|make|generate|implement)\s+(?:a\s+)?(?:function|class|program|script|code|api|component|module|app|website|page|server)/i, weight: 0.85 },
  { intent: 'code_explain', pattern: /explain\s+(?:this|the|that)\s+(?:code|function|program|script|snippet)/i, weight: 0.85 },
  { intent: 'code_debug', pattern: /(?:debug|fix|error|bug|not\s+working|syntax\s+error|runtime\s+error|type\s+error|reference\s+error)/i, weight: 0.8 },
  { intent: 'write_email', pattern: /(?:write|draft|compose)\s+(?:a\s+)?(?:an?\s+)?email/i, weight: 0.9 },
  { intent: 'write_letter', pattern: /(?:write|draft|compose)\s+(?:a\s+)?(?:an?\s+)?(?:formal\s+)?letter/i, weight: 0.9 },
  { intent: 'write_blog', pattern: /(?:write|create)\s+(?:a\s+)?(?:blog|article|post)/i, weight: 0.85 },
  { intent: 'write_poem', pattern: /(?:write|compose)\s+(?:a\s+)?(?:poem|poetry|verse|haiku|sonnet)/i, weight: 0.9 },
  { intent: 'write_story', pattern: /(?:write|tell|create)\s+(?:a\s+)?(?:story|tale|fiction|narrative)/i, weight: 0.85 },
  { intent: 'summarize', pattern: /(?:summarize|summary|tldr|tl;dr|give\s+(?:me\s+)?(?:a\s+)?(?:brief\s+)?(?:summary|overview))/i, weight: 0.9 },
  { intent: 'quiz', pattern: /(?:quiz|test)\s+(?:me|us)|(?:ask\s+me)\s+(?:questions|quiz)|(?:mcq|practice\s+questions)/i, weight: 0.9 },
  { intent: 'flashcard', pattern: /flash\s*card|flashcard|study\s+card|revision\s+card/i, weight: 0.9 },
  { intent: 'eli5', pattern: /eli5|explain\s+(?:like|as\s+if)\s+(?:i(?:'m|\s+am)\s+)?(?:five|5|a\s+child|a\s+kid|simple)/i, weight: 0.95 },
  { intent: 'resume', pattern: /(?:resume|cv|curriculum\s+vitae)\s*(?:for|template|build|create|write)/i, weight: 0.85 },
  { intent: 'interview', pattern: /interview\s*(?:question|prep|preparation|tips|mock)/i, weight: 0.85 },
  { intent: 'image', pattern: /(?:draw|generate|create|make|show)\s+(?:a\s+)?(?:an?\s+)?(?:image|picture|illustration|poster|visual|art|artwork|drawing)/i, weight: 0.85 },
  { intent: 'diagram', pattern: /(?:draw|create|make|show)\s+(?:a\s+)?(?:diagram|flowchart|chart|graph|flow|visual)/i, weight: 0.85 },
  { intent: 'palette', pattern: /(?:color|colour)\s+palette|palette\s+for|theme\s+colors/i, weight: 0.9 },
  { intent: 'recipe', pattern: /(?:recipe|how\s+to\s+(?:make|cook|prepare|bake))\s+/i, weight: 0.85 },
  { intent: 'health', pattern: /(?:health|symptom|medicine|doctor|diet|nutrition|exercise|workout|fitness|medical)/i, weight: 0.7 },
  { intent: 'convert', pattern: /convert\s+\d|\d+\s*(?:km|mi|kg|lb|celsius|fahrenheit|°[cf])\s*(?:to|in)\s*/i, weight: 0.85 },
  { intent: 'datetime', pattern: /(?:what\s+(?:is\s+)?(?:the\s+)?(?:current\s+)?(?:time|date|day)|today(?:'s)?\s+(?:date|day)|what\s+day\s+is\s+it)/i, weight: 0.9 },
  { intent: 'joke', pattern: /(?:tell\s+(?:me\s+)?(?:a\s+)?joke|joke|funny|make\s+me\s+laugh)/i, weight: 0.9 },
  { intent: 'rewrite', pattern: /(?:rewrite|rephrase|reword|paraphrase|improve|fix|polish|edit)\s+(?:this|the|my|that)/i, weight: 0.85 },
  { intent: 'compare', pattern: /(?:compare|difference\s+between|vs\.?|versus|which\s+is\s+better|pros?\s+and\s+cons?)/i, weight: 0.85 },
  { intent: 'brainstorm', pattern: /(?:brainstorm|ideas?\s+(?:for|about)|give\s+(?:me\s+)?ideas|suggestions?\s+(?:for|about))/i, weight: 0.8 },
  { intent: 'study', pattern: /(?:study\s+(?:plan|guide|tips|method)|how\s+to\s+study|exam\s+(?:prep|preparation)|jee|neet|upsc)/i, weight: 0.8 },
  { intent: 'file_qa', pattern: /(?:from\s+(?:the\s+)?(?:file|document|attachment)|(?:file|document)\s+(?:you|I)\s+(?:uploaded|attached)|based\s+on\s+(?:the\s+)?(?:file|document))/i, weight: 0.85 },
];

/* ── TF-IDF implementation ── */
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1);
}

function termFreq(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const len = tokens.length || 1;
  for (const t in tf) tf[t] /= len;
  return tf;
}

function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, magA = 0, magB = 0;
  for (const k of allKeys) {
    const va = a[k] || 0;
    const vb = b[k] || 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/* ── Build IDF from all prototypes ── */
const allPrototypeTokens: string[][] = [];
const docFreq: Record<string, number> = {};
const TOTAL_DOCS = Object.values(INTENT_PROTOTYPES).reduce((n, arr) => n + arr.length, 0);

for (const phrases of Object.values(INTENT_PROTOTYPES)) {
  for (const phrase of phrases) {
    const toks = tokenize(phrase);
    allPrototypeTokens.push(toks);
    const seen = new Set(toks);
    for (const t of seen) docFreq[t] = (docFreq[t] || 0) + 1;
  }
}

function idf(term: string): number {
  const df = docFreq[term] || 0;
  return Math.log((TOTAL_DOCS + 1) / (df + 1)) + 1;
}

function tfidf(tokens: string[]): Record<string, number> {
  const tf = termFreq(tokens);
  const result: Record<string, number> = {};
  for (const t in tf) result[t] = tf[t] * idf(t);
  return result;
}

/* ── Intent prototype vectors (precomputed) ── */
const INTENT_VECTORS: Record<Intent, Record<string, number>[]> = {} as Record<Intent, Record<string, number>[]>;
for (const [intent, phrases] of Object.entries(INTENT_PROTOTYPES)) {
  INTENT_VECTORS[intent as Intent] = phrases.map(p => tfidf(tokenize(p)));
}

/* ── Main ALIGN pipeline ── */
export function align(senseResult: SenseResult, rawText: string): AlignResult {
  const text = rawText.trim();
  const textLower = text.toLowerCase();

  // Phase 1: Cue/regex matching (fast path)
  const cueScores: Partial<Record<Intent, number>> = {};
  for (const { intent, pattern, weight } of CUE_PATTERNS) {
    if (pattern.test(text)) {
      cueScores[intent] = Math.max(cueScores[intent] || 0, weight);
    }
  }

  // Phase 2: TF-IDF cosine similarity
  const inputTokens = tokenize(text);
  const inputVec = tfidf(inputTokens);

  const tfidfScores: Partial<Record<Intent, number>> = {};
  for (const intent of Object.keys(INTENT_VECTORS) as Intent[]) {
    const vectors = INTENT_VECTORS[intent];
    let maxSim = 0;
    for (const vec of vectors) {
      const sim = cosineSimilarity(inputVec, vec);
      if (sim > maxSim) maxSim = sim;
    }
    if (maxSim > 0.01) tfidfScores[intent] = maxSim;
  }

  // Phase 3: Merge scores (weighted hybrid)
  const merged: Partial<Record<Intent, number>> = {};
  const allIntents = new Set<Intent>([
    ...Object.keys(cueScores) as Intent[],
    ...Object.keys(tfidfScores) as Intent[],
  ]);

  for (const intent of allIntents) {
    const cue = cueScores[intent] || 0;
    const tf = tfidfScores[intent] || 0;
    merged[intent] = cue * 0.6 + tf * 0.4;
  }

  // Context boosters from SENSE
  const hasQuestion = textLower.includes('?') || /^(what|how|why|when|where|who|which|can|could|would|should|is|are|do|does|did)\b/i.test(text);
  const hasCode = senseResult.entities.some(e => e.type === 'url') ||
    /[{}\[\]();]/.test(text) || /\b(function|class|def|import|const|let|var|return|async)\b/.test(text);

  if (hasCode) {
    merged.code_gen = (merged.code_gen || 0) + 0.15;
    merged.code_explain = (merged.code_explain || 0) + 0.1;
    merged.code_debug = (merged.code_debug || 0) + 0.1;
  }

  if (hasQuestion && !merged.explain) {
    merged.explain = 0.3;
  }

  // File attachment check
  if (senseResult.keywords.some(k => ['file', 'document', 'attachment', 'uploaded', 'attached'].includes(k))) {
    merged.file_qa = (merged.file_qa || 0) + 0.3;
  }

  // Fallback: if nothing scored above threshold, default to chat
  if (Object.keys(merged).length === 0 || Math.max(...Object.values(merged) as number[]) < 0.15) {
    merged.chat = 0.5;
  }

  // Sort and pick best
  const sorted = Object.entries(merged)
    .sort((a, b) => b[1] - a[1])
    .map(([intent, score]) => ({ intent: intent as Intent, score: Math.min(score, 1) }));

  const best = sorted[0];

  return {
    intent: best.intent,
    confidence: best.score,
    subIntents: sorted.slice(0, 5),
  };
}
