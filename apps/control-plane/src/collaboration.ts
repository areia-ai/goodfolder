export function safeDocumentPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) return null;
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) return null;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts.join("/");
}

export function applyAnchoredSuggestion(
  content: string,
  before: string,
  replacement: string,
): { content: string } | { error: "missing" | "ambiguous" } {
  // An empty file has no non-empty anchor. Treat a whole-file replacement as
  // exact only in that one safe case; an empty anchor in non-empty content is
  // inherently ambiguous and must stay in human review.
  if (before.length === 0) return content.length === 0 ? { content: replacement } : { error: "ambiguous" };
  const first = content.indexOf(before);
  if (first < 0) return { error: "missing" };
  if (content.indexOf(before, first + before.length) >= 0) return { error: "ambiguous" };
  return {
    content: content.slice(0, first) + replacement + content.slice(first + before.length),
  };
}
