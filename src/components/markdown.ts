/**
 * Tiny, dependency-free Markdown renderer covering what chat replies use most:
 * fenced code blocks, inline code, bold, italics, links, headings, and lists.
 * All input is HTML-escaped first, so model output cannot inject markup.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderMarkdown(src: string): string {
  const blocks: string[] = [];
  // Pull out fenced code first so nothing inside gets transformed.
  let text = src.replace(/```(\w+)?\n([\s\S]*?)```/g, (_m, lang: string | undefined, code: string) => {
    const idx = blocks.push(
      `<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ""}>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`,
    );
    return `\u0000${idx - 1}\u0000`;
  });

  text = escapeHtml(text);
  text = text
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^###\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/^##\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/^#\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/^\s*[-*]\s+(.+)$/gm, "• $1");

  return text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => blocks[Number(i)]);
}
