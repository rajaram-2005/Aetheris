/* ─── AURION Core Types ─── */

export type Intent =
  | 'greet' | 'identity' | 'capability'
  | 'write_email' | 'write_letter' | 'write_blog' | 'write_social'
  | 'write_ad' | 'write_poem' | 'write_story' | 'rewrite' | 'summarize'
  | 'code_gen' | 'code_explain' | 'code_debug'
  | 'translate' | 'math' | 'explain' | 'howto' | 'compare'
  | 'quiz' | 'flashcard' | 'study' | 'eli5'
  | 'resume' | 'interview' | 'analyze' | 'brainstorm' | 'plan'
  | 'image' | 'diagram' | 'palette'
  | 'recipe' | 'travel' | 'health' | 'convert' | 'datetime'
  | 'joke' | 'file_qa' | 'chat';

export type Language = 'en' | 'hi' | 'te' | 'es' | 'fr' | 'de' | 'ta' | 'unknown';
export type Style = 'formal' | 'brief' | 'simple' | 'creative' | 'precise';
export type Persona = 'balanced' | 'precise' | 'imaginative' | 'mentor' | 'concise';
export type Theme = 'aurora' | 'daylight' | 'ink';

export interface Entity {
  type: 'email' | 'url' | 'money' | 'date' | 'proper_noun' | 'number' | 'phone';
  value: string;
  start: number;
  end: number;
}

export interface Token {
  raw: string;
  normalized: string;
  isStopword: boolean;
  stem: string;
}

export interface SenseResult {
  tokens: Token[];
  language: Language;
  entities: Entity[];
  sentiment: number; // -1 to 1
  keywords: string[];
  script: string;
}

export interface AlignResult {
  intent: Intent;
  confidence: number;
  subIntents: { intent: Intent; score: number }[];
}

export interface PlotStep {
  action: string;
  description: string;
}

export interface PlotResult {
  steps: PlotStep[];
  style: Style;
  format: string;
}

export interface RecallResult {
  articles: { title: string; content: string; score: number }[];
  sessionContext: string;
  fileChunks: string[];
}

export interface ThinkResult {
  type: 'math' | 'conversion' | 'percent' | 'quadratic' | 'stats' | 'none';
  input: string;
  output: string;
  steps: string[];
  value?: number;
}

export interface WeaveResult {
  response: string;
  format: 'text' | 'code' | 'list' | 'table' | 'markdown';
  language?: string;
  metadata?: Record<string, string>;
}

export interface RefineResult {
  final: string;
  safetyFlag: boolean;
  safetyReason?: string;
  honestyNote?: string;
  stripped: string[];
}

export interface C7Trace {
  sense: SenseResult;
  align: AlignResult;
  plot: PlotResult;
  recall: RecallResult;
  think: ThinkResult;
  weave: WeaveResult;
  refine: RefineResult;
  timings: Record<string, number>;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  trace?: C7Trace;
  attachments?: Attachment[];
}

export interface Attachment {
  name: string;
  type: string;
  content: string;
  size: number;
}

export interface Thread {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  persona: Persona;
  creativity: number; // 0-1
  length: number; // 0-1
  theme: Theme;
  voiceEnabled: boolean;
  systemPrompt: string;
}

export interface SessionMemory {
  facts: { key: string; value: string; timestamp: number }[];
}
