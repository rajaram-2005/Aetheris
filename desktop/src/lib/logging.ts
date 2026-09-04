/**
 * Desktop log. A small line-oriented log written to `<userData>/logs/aetheris-YYYY-MM-DD.log`
 * plus an in-memory ring so the UI can show the tail without touching the disk.
 *
 * Every line passes through `redact()` first: the embedded server prints provider URLs and the
 * desktop app handles the user's own API keys, so anything that looks like a credential is masked
 * before it reaches the file.
 */

export type LogLevel = "info" | "warn" | "error";

export type LogEntry = { time: string; level: LogLevel; text: string };

/**
 * Patterns applied in order by `redact()`. Keeping them in one array keeps the order explicit —
 * `key: value` has to be masked before the "long opaque token" rule, or the rule would leave the
 * key name behind.
 */
const SECRET_PATTERNS: { re: RegExp; mask: (m: string, ...g: string[]) => string }[] = [
  // key=value / key: value. The trailing \b matters: without it "password=hunter2" parses as key
  // "hunter" with an empty separator, leaving the tail of the secret in the log.
  {
    re: /\b(api[_-]?key|apikey|authorization|bearer|secret|token|password|passwd|pwd)\b(\s*[:=]\s*)([^\s,;"']+)/gi,
    mask: (_m, k: string, sep: string) => `${k}${sep}[redacted]`,
  },
  // `Authorization: Bearer <token>` — the scheme word is separated by a space, not `:` or `=`.
  { re: /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, mask: (_m, scheme: string) => `${scheme} [redacted]` },
  // Vendor-prefixed keys (OpenAI, GitHub, Slack, Google, Anthropic, …).
  {
    re: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}|\bgh[pousr]_[A-Za-z0-9]{10,}|\bxox[baprs]-[A-Za-z0-9-]{8,}|\bya29\.[A-Za-z0-9_-]{8,}|\bAIza[A-Za-z0-9_-]{20,}/g,
    mask: (m) => `${m.slice(0, 4)}…[redacted]`,
  },
  // Anything else long and opaque (hex digests, session ids, PATs without a known prefix).
  { re: /\b[A-Za-z0-9_-]{32,}\b/g, mask: (m) => `${m.slice(0, 4)}…[redacted]` },
];

/** Mask anything credential-shaped. Deterministic and side-effect free. */
export function redact(input: string): string {
  let out = input;
  for (const { re, mask } of SECRET_PATTERNS) out = out.replace(re, mask as (m: string, ...g: string[]) => string);
  return out;
}

export function formatLine(entry: LogEntry): string {
  return `${entry.time} ${entry.level.toUpperCase().padEnd(5)} ${entry.text}`;
}

export type LogSink = {
  append(text: string): void;
  now(): string;
};

/** Sink that appends to a file; created by the main process. */
export function fileSink(filePath: string, fsLike: { appendFileSync(p: string, d: string): void; mkdirSync(p: string, o: { recursive: boolean }): void }, dir: string): LogSink {
  let ready = false;
  return {
    append(text: string) {
      try {
        if (!ready) {
          fsLike.mkdirSync(dir, { recursive: true });
          ready = true;
        }
        fsLike.appendFileSync(filePath, text.endsWith("\n") ? text : `${text}\n`);
      } catch {
        /* a log must never take the app down */
      }
    },
    now: () => new Date().toISOString(),
  };
}

export type Logger = {
  log(level: LogLevel, text: string): void;
  info(text: string): void;
  warn(text: string): void;
  error(text: string): void;
  tail(n?: number): LogEntry[];
  readonly entries: LogEntry[];
};

/**
 * Create a logger. `maxEntries` bounds memory; `sink` may be omitted (memory only, used in tests
 * and before userData is known).
 */
export function createLogger(opts: { sink?: LogSink; maxEntries?: number; echoToConsole?: boolean } = {}): Logger {
  const max = opts.maxEntries ?? 500;
  const entries: LogEntry[] = [];
  const sink = opts.sink;
  const log = (level: LogLevel, text: string) => {
    const entry: LogEntry = { time: sink?.now() ?? new Date().toISOString(), level, text: redact(String(text)) };
    entries.push(entry);
    if (entries.length > max) entries.splice(0, entries.length - max);
    const line = formatLine(entry);
    sink?.append(line);
    if (opts.echoToConsole) {
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    }
  };
  return {
    log,
    info: (t: string) => log("info", t),
    warn: (t: string) => log("warn", t),
    error: (t: string) => log("error", t),
    tail: (n = 100) => entries.slice(Math.max(0, entries.length - n)),
    entries,
  };
}

/** Log file name for a given day, e.g. `aetheris-2026-09-04.log`. */
export function logFileName(isoDate: string): string {
  return `aetheris-${isoDate.slice(0, 10)}.log`;
}
