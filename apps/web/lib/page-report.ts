// What happened the last time a web page in a folder was rendered.
//
// The dashboard already shows this at the foot of the page view. It is kept
// here as well, in one place any part of the app can read, because the
// assistant working in the browser needs it too: an agent that has just
// proposed a change to a page can ask what the page then did — what it could
// not find, what threw — instead of being told the change was applied and
// left to guess. See `get_page_render_report` in lib/webmcp.ts.
//
// Deliberately only the most recent one, and deliberately not persisted. It
// describes a thing currently on screen; a stale report answering for a page
// nobody is looking at would be worse than no report at all.

export interface PageRenderProblem {
  kind: "error" | "resource";
  detail: string;
}

export interface PageRenderReport {
  folderId: string;
  /** The page being rendered, which is not always the file that was opened:
   *  following a link inside the page moves this on. */
  path: string;
  openedPath: string;
  title: string;
  at: string;
  /** Files in the folder the page pointed at and got. */
  carried: string[];
  /** Of those, the ones too big to write into the page, handed over as bytes
   *  once it was running. */
  streamed: string[];
  /** References that named nothing in the folder. */
  missing: string[];
  /** Addresses left for the network to answer. */
  fromTheWeb: string[];
  /** Files left out because the page had already carried too much. */
  omitted: string[];
  bytes: number;
  problems: PageRenderProblem[];
}

let latest: PageRenderReport | null = null;
const listeners = new Set<() => void>();

export function setPageRenderReport(report: PageRenderReport | null): void {
  latest = report;
  for (const listener of listeners) listener();
}

export function pageRenderReport(): PageRenderReport | null {
  return latest;
}

export function watchPageRenderReport(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
