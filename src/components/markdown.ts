/**
 * Small dependency-free Markdown renderer for chat replies: fenced code, inline code, bold,
 * italics, strikethrough, links, headings, ordered/unordered lists, blockquotes, tables, hr.
 * All input is HTML-escaped first, so model output cannot inject markup.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(text: string): string {
  return text
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}

export function renderMarkdown(src: string): string {
  const blocks: string[] = [];
  // Pull out fenced code first so nothing inside gets transformed.
  let text = src.replace(/```([\w+-]*)[^\n]*\n([\s\S]*?)(```|$)/g, (_m, lang: string | undefined, code: string) => {
    const idx = blocks.push(`<div class="codeblock"><div class="cb-head"><span>${escapeHtml(lang || "code")}</span><button type="button" data-copy>copy</button></div><pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ""}>${escapeHtml(code.replace(/\n$/, ""))}</code></pre></div>`);
    return `\u0000${idx - 1}\u0000`;
  });
  text = escapeHtml(text);

  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    // table
    if (isTableRow(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const head = cells(l); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    // lists
    const ul = /^\s*[-*+]\s+(.+)$/.exec(l); const ol = /^\s*\d+[.)]\s+(.+)$/.exec(l);
    if (ul || ol) {
      const tag = ul ? "ul" : "ol"; const re = ul ? /^\s*[-*+]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/;
      const items: string[] = [];
      while (i < lines.length) { const m = re.exec(lines[i]); if (!m) break; items.push(`<li>${inline(m[1])}</li>`); i++; }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    // blockquote
    if (/^\s*&gt;\s?/.test(l)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) { q.push(inline(lines[i].replace(/^\s*&gt;\s?/, ""))); i++; }
      out.push(`<blockquote>${q.join("<br>")}</blockquote>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.+)$/.exec(l);
    if (h) { const n = Math.min(h[1].length, 3); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
    if (/^\u0000\d+\u0000$/.test(l.trim())) { out.push(l.trim()); i++; continue; }
    out.push(l === "" ? "\n" : inline(l) + "\n");
    i++;
  }
  return out.join("").replace(/\n{3,}/g, "\n\n").replace(/\u0000(\d+)\u0000/g, (_m, k: string) => blocks[Number(k)]);
}
