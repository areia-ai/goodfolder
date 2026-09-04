"use client";

// A web page in a folder, shown as a page.
//
// More and more of what people write for each other is a web page rather than
// a document: a report, a proposal, something an assistant put together. In a
// folder those arrive as a file called index.html with a stylesheet and a
// picture beside it, and until now the dashboard showed the reader the markup.
//
// So this renders it, scripts and all, the way any browser would. Two things
// make that safe rather than reckless, and both are described where they are
// implemented: the frame is denied an origin of its own (lib/page-frame.ts),
// so a page can reach nothing of the dashboard's; and everything it points at
// is carried inside it before it is handed over (lib/page-bundle.ts), so it
// asks the network for nothing it did not already ask for on its author's
// machine.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, ExpandIcon, SyncIcon } from "@/components/icons";
import { listFiles, readFile, readFileRaw, type FolderFile } from "@/lib/gf-api";
import { formatBytes } from "@/lib/preview";
import {
  assetMimeFor,
  bundlePage,
  bytesToBase64,
  resolveIn,
  type PageBundle,
  type PageFileReader,
} from "@/lib/page-bundle";
import {
  PAGE_FRAME_SANDBOX,
  pageFrameReply,
  pageFrameRuntime,
  readPageFrameEvent,
} from "@/lib/page-frame";
import { setPageRenderReport, type PageRenderProblem } from "@/lib/page-report";

/** A page's own requests for files beside it, before the answers stop. */
const REQUEST_COUNT_CAP = 300;
const REQUEST_BYTE_CAP = 16_000_000;
/** How tall the frame grows to fit its page before it scrolls instead. */
const FRAME_MIN_HEIGHT = 520;
const FRAME_MAX_HEIGHT = 2400;

function directoryOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

function nameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json" || mime === "application/xml";
}

export function PagePreview({
  folderId,
  path,
  content,
}: {
  /** Null where a page has no folder around it — a proposed file under
   *  review, before it is anywhere. It renders on its own. */
  folderId: string | null;
  path: string;
  content: string;
}) {
  // The folder's listing, so a reference that names nothing is known to be
  // missing without a request, and one naming something enormous is left out
  // without reading it. The page waits for this rather than rendering once
  // with everything beside it reported missing and again once it arrives.
  const [files, setFiles] = useState<FolderFile[] | null>(folderId ? null : []);
  const [mode, setMode] = useState<"page" | "source">("page");
  const [trail, setTrail] = useState<string[]>([path]);
  const [sources, setSources] = useState<Record<string, string>>({ [path]: content });
  const [bundle, setBundle] = useState<PageBundle | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [problems, setProblems] = useState<PageRenderProblem[]>([]);
  const [height, setHeight] = useState(FRAME_MIN_HEIGHT);
  const [generation, setGeneration] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const spend = useRef({ requests: 0, bytes: 0 });

  const current = trail[trail.length - 1] ?? path;
  const token = useMemo(
    () => `gf-page-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    [],
  );

  useEffect(() => {
    setTrail([path]);
    setSources({ [path]: content });
  }, [path, content]);

  useEffect(() => {
    if (!folderId) {
      setFiles([]);
      return;
    }
    let alive = true;
    setFiles(null);
    listFiles(folderId)
      .then((listing) => {
        if (alive) setFiles(listing.files);
      })
      .catch(() => {
        // A page still renders without knowing its neighbours; it just cannot
        // carry any of them, and says so.
        if (alive) setFiles([]);
      });
    return () => {
      alive = false;
    };
  }, [folderId]);

  const reader = useMemo<PageFileReader>(() => {
    const listing = (files ?? []).map((file) => ({ path: file.path, size: file.size }));
    if (!folderId) return { files: [], async readText() { return null; }, async readBytes() { return null; } };
    return {
      files: listing,
      async readText(target) {
        try {
          const file = await readFile(folderId, target);
          return file.content ?? null;
        } catch {
          return null;
        }
      },
      async readBytes(target) {
        try {
          const raw = await readFileRaw(folderId, target);
          if (!raw.blob) return null;
          return new Uint8Array(await raw.blob.arrayBuffer());
        } catch {
          return null;
        }
      },
    };
  }, [folderId, files]);

  /* --------------------------------------------------- build the page */

  useEffect(() => {
    if (folderId && files === null) return;
    let alive = true;
    setBundle(null);
    setFailure(null);
    setProblems([]);
    setHeight(FRAME_MIN_HEIGHT);
    spend.current = { requests: 0, bytes: 0 };
    (async () => {
      try {
        let html = sources[current];
        if (html === undefined) {
          if (!folderId) throw new Error("That page is not in this folder.");
          const file = await readFile(folderId, current);
          html = file.content ?? "";
          if (!alive) return;
          setSources((held) => ({ ...held, [current]: html as string }));
        }
        const built = await bundlePage(current, html, reader, { runtime: pageFrameRuntime(token) });
        if (!alive) return;
        setBundle(built);
      } catch (problem) {
        if (alive) setFailure((problem as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
    // `sources` is written by this effect; reading it here would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, reader, folderId, files, token, generation]);

  /* --------------------------------------- keep the report up to date */

  useEffect(() => {
    if (!bundle) return;
    setPageRenderReport({
      folderId: folderId ?? "",
      path: current,
      openedPath: path,
      title: nameOf(current),
      at: new Date().toISOString(),
      carried: bundle.included,
      missing: bundle.missing,
      fromTheWeb: bundle.external,
      omitted: bundle.omitted,
      bytes: bundle.bytes,
      problems,
    });
  }, [bundle, problems, folderId, current, path]);

  useEffect(() => () => setPageRenderReport(null), []);

  /* ---------------------------------- listen to what the page says back */

  const answer = useCallback(
    async (id: number, url: string) => {
      const target = folderId ? resolveIn(directoryOf(current), url) : null;
      const known = target ? (files ?? []).find((file) => file.path === target) : undefined;
      const refuse = () =>
        frame.current?.contentWindow?.postMessage(
          pageFrameReply(token, { id, ok: false, status: 404, mime: "", base64: "" }),
          "*",
        );
      if (!target || !known) return refuse();
      if (spend.current.requests >= REQUEST_COUNT_CAP || spend.current.bytes + known.size > REQUEST_BYTE_CAP) {
        return refuse();
      }
      spend.current.requests += 1;
      const mime = assetMimeFor(target);
      const bytes = isTextMime(mime)
        ? await reader.readText(target).then((text) => (text === null ? null : new TextEncoder().encode(text)))
        : await reader.readBytes(target);
      if (!bytes) return refuse();
      spend.current.bytes += bytes.byteLength;
      frame.current?.contentWindow?.postMessage(
        pageFrameReply(token, { id, ok: true, status: 200, mime, base64: bytesToBase64(bytes) }),
        "*",
      );
    },
    [current, files, folderId, reader, token],
  );

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      const said = readPageFrameEvent(event.data, token);
      if (!said) return;
      if (said.kind === "navigate") {
        setTrail((walked) => [...walked, said.path]);
        return;
      }
      if (said.kind === "request") {
        void answer(said.id, said.url);
        return;
      }
      if (said.kind === "height") {
        setHeight(Math.min(FRAME_MAX_HEIGHT, Math.max(FRAME_MIN_HEIGHT, Math.ceil(said.height))));
        return;
      }
      if (said.kind === "error") {
        setProblems((held) =>
          held.length >= 25 || held.some((problem) => problem.detail === said.message)
            ? held
            : [...held, { kind: "error", detail: said.message }],
        );
        return;
      }
      if (said.kind === "resource") {
        const detail = `${said.element || "file"} could not be loaded: ${said.url}`;
        setProblems((held) =>
          held.length >= 25 || held.some((problem) => problem.detail === detail)
            ? held
            : [...held, { kind: "resource", detail }],
        );
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [answer, token]);

  /* ------------------------------------------------------------- draw */

  const source = sources[current] ?? "";
  const unresolved = bundle ? bundle.missing.length + bundle.omitted.length : 0;
  const notes: string[] = [];
  if (bundle) {
    if (bundle.included.length) {
      notes.push(`${bundle.included.length} file${bundle.included.length === 1 ? "" : "s"} from this folder`);
    }
    if (bundle.missing.length) notes.push(`${bundle.missing.length} not in the folder`);
    if (bundle.omitted.length) notes.push(`${bundle.omitted.length} too big to carry`);
    if (bundle.external.length) {
      notes.push(`${bundle.external.length} from the web`);
    }
  }

  return (
    <div className="min-w-0" ref={shell}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gf-line)] px-4 py-2.5 sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">
            {trail.length > 1 ? nameOf(current) : "Web page"}
          </p>
          <p className="gf-faint text-[12px]">
            {formatBytes(new TextEncoder().encode(source).byteLength)} · read-only
            {bundle ? ` · ${notes.join(" · ")}` : ""}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {trail.length > 1 && (
            <button
              type="button"
              className="gf-icon-button"
              aria-label="Back to the page before"
              onClick={() => setTrail((walked) => walked.slice(0, -1))}
            >
              <ArrowLeftIcon />
            </button>
          )}
          <button
            type="button"
            className="gf-icon-button"
            aria-label="Read this page again"
            onClick={() => setGeneration((count) => count + 1)}
          >
            <SyncIcon />
          </button>
          <button
            type="button"
            className="gf-icon-button"
            aria-label="Fill the screen"
            onClick={() => void shell.current?.requestFullscreen?.().catch(() => undefined)}
          >
            <ExpandIcon />
          </button>
          <div className="gf-win-views gf-page-views" role="group" aria-label="How to show this page">
            {(["page", "source"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
              >
                {option === "page" ? "Page" : "Source"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mode === "source" ? (
        <pre className="overflow-auto whitespace-pre-wrap break-words p-6 text-[13px] leading-relaxed" style={{ maxHeight: "720px" }}>
          {source}
        </pre>
      ) : failure ? (
        <div className="grid min-h-[320px] place-items-center p-8 text-center">
          <p className="gf-body text-[14px]">{failure}</p>
        </div>
      ) : !bundle ? (
        <div className="grid min-h-[320px] place-items-center p-8" role="status" aria-live="polite">
          <span className="gf-faint text-[13px]">Opening the page…</span>
        </div>
      ) : (
        <iframe
          ref={frame}
          key={`${current}-${generation}`}
          title={`${nameOf(current)}, rendered`}
          /* Never `allow-same-origin`. lib/page-frame.ts says what that would
             mean, and a test holds this exact string. */
          sandbox={PAGE_FRAME_SANDBOX}
          allowFullScreen
          srcDoc={bundle.html}
          className="w-full border-0 bg-white"
          style={{ height: `${height}px` }}
        />
      )}

      {mode === "page" && bundle && (problems.length > 0 || unresolved > 0) && (
        <details className="border-t border-[var(--gf-line)] px-4 py-2.5 sm:px-6">
          <summary className="gf-faint cursor-pointer text-[12px]">
            {problems.length > 0
              ? `${problems.length} thing${problems.length === 1 ? "" : "s"} this page reported`
              : `${unresolved} thing${unresolved === 1 ? "" : "s"} this page asked for are not here`}
          </summary>
          <ul className="gf-faint mt-2 space-y-1 text-[12px]">
            {problems.map((problem) => (
              <li key={problem.detail} className="break-words">{problem.detail}</li>
            ))}
            {bundle.missing.map((missing) => (
              <li key={`missing-${missing}`} className="break-words">Not in the folder: {missing}</li>
            ))}
            {bundle.omitted.map((omitted) => (
              <li key={`omitted-${omitted}`} className="break-words">Too big to carry into the page: {omitted}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
