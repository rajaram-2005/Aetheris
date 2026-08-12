/* ─── SENSE — Stage 1: Tokenize, detect language, extract entities, sentiment, keywords ─── */

import { SenseResult, Token, Entity, Language } from '@/types';

/* ── Stopwords ── */
const STOPWORDS: Record<string, Set<string>> = {
  en: new Set([
    'a','an','the','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','shall','should',
    'may','might','can','could','to','of','in','for','on','with','at',
    'by','from','as','into','through','during','before','after','above',
    'below','between','out','off','over','under','again','further','then',
    'once','here','there','when','where','why','how','all','each','every',
    'both','few','more','most','other','some','such','no','nor','not',
    'only','own','same','so','than','too','very','just','because','but',
    'and','or','if','while','about','against','up','down','it','its',
    'i','me','my','we','our','you','your','he','him','his','she','her',
    'they','them','their','this','that','these','those','what','which',
    'who','whom','am','t','s','re','ve','ll','d','m','don','doesn','didn',
    'isn','aren','wasn','weren','won','wouldn','shouldn','couldn','haven',
    'hasn','hadn','let','much','also','like','get','got','know','think',
    'want','make','go','see','come','take','give','say','tell','use',
    'find','ask','work','seem','feel','try','leave','call','need','become',
    'keep','let','begin','show','hear','play','run','move','live','believe',
    'bring','happen','write','provide','sit','stand','lose','pay','meet',
    'include','continue','set','learn','change','lead','understand','watch',
    'follow','stop','create','speak','read','allow','add','spend','grow',
    'open','walk','win','offer','remember','love','consider','appear','buy',
    'wait','serve','die','send','expect','build','stay','fall','cut',
    'reach','kill','remain','suggest','raise','pass','sell','require','report',
    'decide','pull','develop','eat','put','plan','pull','check','carry',
    'please','could','would','should','might','shall','able','really',
    'well','back','still','way','even','new','old','now','here','there',
    'today','tomorrow','yesterday','already','always','never','sometimes',
    'however','although','though','yet','since','until','unless','whether',
    'while','because','therefore','moreover','furthermore','nevertheless',
    'meanwhile','otherwise','instead','besides','anyway','anyhow','indeed',
    'perhaps','maybe','certainly','surely','exactly','absolutely','actually',
    'basically','generally','honestly','simply','totally','usually',
  ]),
};

const DEFAULT_STOP = STOPWORDS.en;

/* ── Simple stemmer (Porter-lite) ── */
function stem(word: string): string {
  if (word.length < 3) return word;
  let w = word.toLowerCase();
  // strip common suffixes
  const suffixes = ['ation', 'ness', 'ment', 'ting', 'ling', 'ally',
    'ible', 'able', 'ious', 'eous', 'ful', 'less', 'ive', 'ize',
    'ise', 'ify', 'ing', 'ous', 'ity', 'ion', 'ent', 'ant',
    'est', 'ish', 'ers', 'ies', 'ed', 'er', 'ly', 'al', 'es', 's'];
  for (const s of suffixes) {
    if (w.endsWith(s) && w.length - s.length >= 2) {
      w = w.slice(0, -s.length);
      break;
    }
  }
  return w;
}

/* ── Language detection via character ranges + word cues ── */
function detectLanguage(text: string): { lang: Language; script: string } {
  const t = text.toLowerCase();

  // Devanagari (Hindi)
  if (/[\u0900-\u097F]/.test(text)) return { lang: 'hi', script: 'devanagari' };
  // Telugu
  if (/[\u0C00-\u0C7F]/.test(text)) return { lang: 'te', script: 'telugu' };
  // Tamil
  if (/[\u0B80-\u0BFF]/.test(text)) return { lang: 'ta', script: 'tamil' };

  // Word-cue detection for Latin-script languages
  const hiCues = ['kya', 'hai', 'hain', 'nahi', 'nahin', 'haan', 'bhai', 'yaar', 'accha', 'theek', 'kaise', 'kaise ho'];
  const teCues = ['ela', 'unnaru', 'enti', 'ledu', 'avunu', 'anna', 'akka', 'meeru', 'nuvvu', 'chestunnaru'];
  const esCues = ['hola', 'como', 'estas', 'bien', 'gracias', 'por favor', 'pero', 'tambien', 'muy', 'bueno'];
  const frCues = ['bonjour', 'salut', 'merci', 'oui', 'non', 'comment', 'allez', 'tres', 'bien', 'aussi'];
  const deCues = ['hallo', 'danke', 'bitte', 'ja', 'nein', 'wie', 'gut', 'sehr', 'auch', 'nicht'];
  const taCues = ['vanakkam', 'nandri', 'amma', 'appa', 'enna', 'epdi', 'irukinga'];

  const checkCues = (cues: string[], lang: Language): boolean => {
    return cues.some(c => t.includes(c));
  };

  if (checkCues(hiCues, 'hi')) return { lang: 'hi', script: 'latin-hi' };
  if (checkCues(teCues, 'te')) return { lang: 'te', script: 'latin-te' };
  if (checkCues(taCues, 'ta')) return { lang: 'ta', script: 'latin-ta' };
  if (checkCues(esCues, 'es')) return { lang: 'es', script: 'latin' };
  if (checkCues(frCues, 'fr')) return { lang: 'fr', script: 'latin' };
  if (checkCues(deCues, 'de')) return { lang: 'de', script: 'latin' };

  return { lang: 'en', script: 'latin' };
}

/* ── Entity extraction ── */
function extractEntities(text: string): Entity[] {
  const entities: Entity[] = [];
  const patterns: { type: Entity['type']; regex: RegExp }[] = [
    { type: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
    { type: 'url', regex: /https?:\/\/[^\s]+/g },
    { type: 'money', regex: /(?:₹|\$|€|£|¥)\s*\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:,\d{3})*(?:\.\d+)?\s*(?:rupees?|dollars?|euros?|pounds?|yen|inr|usd|eur|gbp)/gi },
    { type: 'date', regex: /\b(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+\d{4})?)\b/gi },
    { type: 'phone', regex: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
    { type: 'number', regex: /\b\d+(?:\.\d+)?(?:\s*(?:billion|million|thousand|lakh|crore))?\b/gi },
    { type: 'proper_noun', regex: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g },
  ];

  for (const { type, regex } of patterns) {
    let match;
    const re = new RegExp(regex.source, regex.flags);
    while ((match = re.exec(text)) !== null) {
      // Skip generic numbers unless they look meaningful
      if (type === 'number' && match[0].length < 2) continue;
      // Skip single capitalized words that are likely sentence starts
      if (type === 'proper_noun') {
        const word = match[0];
        const pos = match.index;
        if (pos === 0 || (pos > 0 && /[.!?]\s+$/.test(text.slice(Math.max(0, pos - 2), pos)))) continue;
        if (['I', 'The', 'A', 'An', 'This', 'That', 'What', 'How', 'When', 'Where', 'Why', 'Who'].includes(word)) continue;
      }
      entities.push({ type, value: match[0], start: match.index, end: match.index + match[0].length });
    }
  }

  return entities;
}

/* ── Sentiment lexicon ── */
const POSITIVE_WORDS = new Set([
  'good','great','excellent','amazing','wonderful','fantastic','awesome','love','loved','loving',
  'happy','happiness','joy','joyful','beautiful','brilliant','perfect','best','better','nice',
  'kind','kindness','helpful','grateful','thankful','thanks','thank','pleased','delighted',
  'exciting','excited','fun','enjoy','enjoyed','enjoying','impressive','magnificent','superb',
  'outstanding','remarkable','splendid','terrific','fabulous','marvelous','glorious','stellar',
  'incredible','phenomenal','spectacular','breathtaking','stunning','charming','elegant',
  'graceful','radiant','vibrant','lively','energetic','enthusiastic','passionate','creative',
  'innovative','brilliant','smart','intelligent','wise','clever','genius','talented','skilled',
  'accomplished','successful','victory','win','won','triumph','celebrate','celebration',
  'hope','hopeful','optimistic','positive','encouraging','inspiring','inspired','motivating',
  'motivated','empowered','confident','proud','satisfied','content','peaceful','calm','serene',
  'warm','warmth','comfortable','comfort','safe','secure','trust','trusted','reliable',
  'accha','badhiya','sundar','shandar',
]);

const NEGATIVE_WORDS = new Set([
  'bad','terrible','awful','horrible','dreadful','disgusting','hate','hated','hating',
  'sad','sadness','unhappy','miserable','depressed','depressing','grief','sorrow','pain',
  'painful','suffer','suffering','angry','anger','furious','rage','annoyed','annoying',
  'frustrated','frustrating','disappointed','disappointing','upsetting','disturbing',
  'worst','worse','poor','poverty','broken','failure','failed','fail','lose','lost',
  'loser','defeat','disaster','catastrophe','tragedy','tragic','cruel','cruelty','evil',
  'wicked','sinister','malicious','toxic','dangerous','danger','risk','risky','threat',
  'threatening','fear','fearful','scared','terrified','frightened','anxious','anxiety',
  'worried','worry','nervous','stress','stressed','overwhelmed','exhausted','tired',
  'boring','bored','dull','disappointing','useless','worthless','hopeless','desperate',
  'lonely','alone','abandoned','rejected','ignored','neglected','mistreated','abused',
  'confused','confusing','difficult','impossible','problem','trouble','struggle',
  'nahi','bura','kharab','ganda',
]);

function computeSentiment(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  let pos = 0, neg = 0;
  let negate = false;

  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^a-z]/g, '');
    if (['not', "n't", 'no', 'never', 'neither', 'nor', 'hardly', 'barely', 'scarcely'].includes(w)) {
      negate = true;
      continue;
    }
    if (POSITIVE_WORDS.has(w)) {
      if (negate) { neg++; negate = false; } else { pos++; }
    } else if (NEGATIVE_WORDS.has(w)) {
      if (negate) { pos++; negate = false; } else { neg++; }
    }
    if (i > 0 && words[i - 1].match(/[.!?]/)) negate = false;
  }

  const total = pos + neg;
  if (total === 0) return 0;
  return Math.round(((pos - neg) / total) * 100) / 100;
}

/* ── Keyword extraction (TF-based) ── */
function extractKeywords(tokens: Token[], topN = 8): string[] {
  const freq: Record<string, number> = {};
  for (const t of tokens) {
    if (t.isStopword || t.normalized.length < 3) continue;
    freq[t.normalized] = (freq[t.normalized] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w);
}

/* ── Main SENSE pipeline ── */
export function sense(text: string): SenseResult {
  const { lang, script } = detectLanguage(text);
  const stopset = STOPWORDS[lang] || DEFAULT_STOP;

  // Tokenize
  const rawTokens = text.match(/[\w\u0900-\u097F\u0C00-\u0C7F\u0B80-\u0BFF]+/g) || [];
  const tokens: Token[] = rawTokens.map(raw => {
    const normalized = raw.toLowerCase();
    return {
      raw,
      normalized,
      isStopword: stopset.has(normalized),
      stem: stem(normalized),
    };
  });

  const entities = extractEntities(text);
  const sentiment = computeSentiment(text);
  const keywords = extractKeywords(tokens);

  return { tokens, language: lang, entities, sentiment, keywords, script };
}
