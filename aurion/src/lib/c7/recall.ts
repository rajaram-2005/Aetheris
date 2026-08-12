/* ─── RECALL — Stage 4: BM25 over knowledge base, session memory, and file chunks ─── */

import { RecallResult, SenseResult, AlignResult, Thread, Attachment } from '@/types';
import { KNOWLEDGE_BASE, KnowledgeArticle } from '@/lib/kb';

/* ── BM25 parameters ── */
const BM25_K1 = 1.5;
const BM25_B = 0.75;

/* ── Tokenize for BM25 ── */
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
}

/* ── Build inverted index and document stats ── */
interface DocEntry {
  id: string;
  title: string;
  content: string;
  tokens: string[];
  tf: Record<string, number>;
  docLen: number;
}

const documents: DocEntry[] = [];
const idfCache: Record<string, number> = {};
const globalFreq: Record<string, number> = {};
let totalDocLen = 0;
let avgDocLen = 0;
const N = 0;

function buildIndex() {
  for (const article of KNOWLEDGE_BASE) {
    const text = `${article.title} ${article.content}`;
    const tokens = tokenize(text);
    const tf: Record<string, number> = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;

    documents.push({
      id: article.id,
      title: article.title,
      content: article.content,
      tokens,
      tf,
      docLen: tokens.length,
    });
    totalDocLen += tokens.length;
    const seen = new Set(tokens);
    for (const t of seen) globalFreq[t] = (globalFreq[t] || 0) + 1;
  }
  avgDocLen = documents.length > 0 ? totalDocLen / documents.length : 1;
}

// Build on module load
buildIndex();

/* ── BM25 score for a single document against a query ── */
function bm25Score(queryTokens: string[], doc: DocEntry): number {
  let score = 0;
  const n = documents.length || 1;

  for (const qt of queryTokens) {
    const df = globalFreq[qt] || 0;
    // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1);
    const tf = doc.tf[qt] || 0;
    if (tf === 0) continue;

    const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.docLen / avgDocLen)));
    score += idf * tfNorm;
  }

  return score;
}

/* ── Search knowledge base ── */
function searchKB(query: string, topK = 5): { title: string; content: string; score: number }[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored = documents.map(doc => ({
    title: doc.title,
    content: doc.content,
    score: bm25Score(queryTokens, doc),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(d => d.score > 0).slice(0, topK);
}

/* ── Extract session memory facts ── */
function extractSessionContext(thread: Thread | null): string {
  if (!thread || thread.messages.length === 0) return '';

  // Build context from recent conversation
  const recent = thread.messages.slice(-10);
  const parts: string[] = [];

  for (const msg of recent) {
    if (msg.role === 'user') {
      // Extract personal facts
      const nameMatch = msg.content.match(/(?:my name is|i am|i'm|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
      if (nameMatch) parts.push(`User's name: ${nameMatch[1]}`);

      const prefMatch = msg.content.match(/(?:i (?:like|prefer|love|enjoy))\s+(.+?)(?:\.|,|$)/i);
      if (prefMatch) parts.push(`User preference: ${prefMatch[1]}`);

      parts.push(`User said: ${msg.content.slice(0, 200)}`);
    } else {
      parts.push(`AURION said: ${msg.content.slice(0, 200)}`);
    }
  }

  return parts.join('\n');
}

/* ── Search file attachments ── */
function searchFiles(query: string, attachments: Attachment[] = []): string[] {
  if (attachments.length === 0) return [];

  const queryTokens = new Set(tokenize(query));
  const results: { text: string; score: number }[] = [];

  for (const att of attachments) {
    // Split content into chunks of ~500 chars
    const chunks: string[] = [];
    for (let i = 0; i < att.content.length; i += 500) {
      chunks.push(att.content.slice(i, i + 500));
    }

    for (const chunk of chunks) {
      const chunkTokens = new Set(tokenize(chunk));
      let overlap = 0;
      for (const qt of queryTokens) {
        if (chunkTokens.has(qt)) overlap++;
      }
      if (overlap > 0) {
        results.push({ text: chunk, score: overlap });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 3).map(r => r.text);
}

/* ── Main RECALL pipeline ── */
export function recall(
  senseResult: SenseResult,
  alignResult: AlignResult,
  rawText: string,
  thread: Thread | null = null,
  attachments: Attachment[] = [],
): RecallResult {
  // Build query from keywords + original text
  const query = [rawText, ...senseResult.keywords].join(' ');

  // Search knowledge base
  const articles = searchKB(query);

  // Get session context
  const sessionContext = extractSessionContext(thread);

  // Search file chunks
  const fileChunks = searchFiles(rawText, attachments);

  return { articles, sessionContext, fileChunks };
}
