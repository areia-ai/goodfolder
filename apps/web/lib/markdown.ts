/**
 * The small Markdown subset the browser editor can display safely.
 *
 * Images deliberately resolve only inside the current GoodFolder. Their bytes
 * are fetched through the authenticated file-preview endpoint after rendering;
 * this function merely leaves a marker for that work.
 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function resolveInlineImagePath(documentPath: string, source: string): string | null {
  const clean = source.trim();
  if (!clean || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(clean) || /[?#]/.test(clean)) return null;

  const parts = documentPath.split("/").slice(0, -1);
  for (const segment of clean.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    if (segment.includes("\\")) return null;
    parts.push(segment);
  }
  return parts.join("/") || null;
}

export function markdownToHtml(value: string, documentPath: string): string {
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt, source) => {
      const path = resolveInlineImagePath(documentPath, source);
      if (!path) return whole;
      return `<img alt="${escapeAttribute(alt)}" data-gf-inline-image-path="${escapeAttribute(path)}" data-gf-markdown-image-source="${escapeAttribute(source)}" class="my-3 max-w-full rounded-[var(--gf-radius)] shadow-[var(--gf-shadow)]" />`;
    })
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
    .split(/\n{2,}/)
    .map((block) => (/^(<h|<blockquote|<li)/.test(block) ? block : `<p>${block.replace(/\n/g, "<br>")}</p>`))
    .join("");
}
