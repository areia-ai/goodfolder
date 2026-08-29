"use client";

// Read-only viewers for the file types people actually keep in a folder.
//
// Principles that hold across every viewer here:
//   - Viewing only. Nothing in this file writes anywhere; markdown stays the
//     one editable format.
//   - Every renderer is lazily imported inside its effect, so the dashboard's
//     first load never carries a viewer's bytes.
//   - A viewer that half-works says so. Captions name what is simplified or
//     missing, and every failure lands on an honest explanation with the
//     file's name, size, and type.
//   - Status never rides on colour alone: titles and icons carry the meaning.

import { useEffect, useState, type CSSProperties } from "react";
import { ArrowLeftIcon, ArrowRightIcon, ComputerIcon, FileIcon, SearchIcon } from "@/components/icons";
import {
  LEGACY_OFFICE_EXTENSIONS,
  SHEET_COL_CAP,
  SHEET_ROW_CAP,
  extensionOfPath,
  formatBytes,
  previewKindLabel,
} from "@/lib/preview";
import type { OpenedFile } from "@/lib/gf-api";

/* ------------------------------------------------------------ shared bits */

function metaLine(file: { path: string; size: number }): string {
  const base = file.path.split("/").pop() ?? file.path;
  const size = formatBytes(file.size);
  const bits = [base, previewKindLabel(file.path)];
  if (size) bits.push(size);
  return bits.join(" · ");
}

function ViewerNotice({
  title,
  children,
  meta,
}: {
  title: string;
  children: React.ReactNode;
  meta?: string;
}) {
  return (
    <div className="grid min-h-[480px] place-items-center p-8 text-center">
      <div className="max-w-sm">
        <span className="gf-folder-glyph mx-auto h-14 w-14" aria-hidden="true">
          <FileIcon />
        </span>
        <h3 className="mt-5 text-[19px] font-bold tracking-[-.02em]">{title}</h3>
        <p className="gf-body mt-2 text-[14px]">{children}</p>
        {meta && <p className="gf-faint mt-3 break-words text-[12px]">{meta}</p>}
      </div>
    </div>
  );
}

function OpenOnComputer({ meta }: { meta: string }) {
  return (
    <span className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--gf-blue-ink)]">
      <ComputerIcon />
      Open it on a connected computer
      <span className="sr-only"> — {meta}</span>
    </span>
  );
}

function ViewerLoading({ label }: { label: string }) {
  return (
    <div className="grid min-h-[480px] place-items-center p-8" role="status" aria-live="polite">
      <span className="gf-faint text-[13px]">{label}</span>
    </div>
  );
}

function ViewerFailed({ path, size }: { path: string; size: number }) {
  return (
    <ViewerNotice title="This file couldn't be opened here" meta={metaLine({ path, size })}>
      It may be damaged, or in a form the browser can&apos;t read. GoodFolder still keeps it safe.
      <OpenOnComputer meta={previewKindLabel(path)} />
    </ViewerNotice>
  );
}

/** The honest dead end: unsupported types, and files whose bytes live only in
 *  the folder's full stored copy on the person's computers. */
export function UnsupportedView({ file }: { file: OpenedFile }) {
  const ext = extensionOfPath(file.path);
  const meta = metaLine(file);
  if (file.previewIssue === "too-large") {
    return (
      <ViewerNotice title="This file is too large to preview here" meta={meta}>
        {file.previewMessage ?? "Open it on a connected computer to see the full file. It is kept safe."}
        <OpenOnComputer meta={previewKindLabel(file.path)} />
      </ViewerNotice>
    );
  }
  if (file.previewIssue === "missing") {
    return (
      <ViewerNotice title="This file's stored copy couldn't be found" meta={meta}>
        {file.previewMessage ?? "Save the folder again from a connected computer to restore this preview."}
        <OpenOnComputer meta={previewKindLabel(file.path)} />
      </ViewerNotice>
    );
  }
  if (LEGACY_OFFICE_EXTENSIONS.has(ext)) {
    return (
      <ViewerNotice title="This older file format can't be shown here" meta={meta}>
        Files in the older Word, Excel, and PowerPoint formats can&apos;t be displayed in the
        browser. GoodFolder keeps the file safe — open it on a connected computer to see it.
      </ViewerNotice>
    );
  }
  if (file.storedForDevice) {
    return (
      <ViewerNotice title="This file lives in the folder's full copy" meta={meta}>
        The browser can&apos;t display this type yet. The full copy of the folder — with files
        like this one — lives on your connected computers, and the file is kept safe either way.
        <OpenOnComputer meta={previewKindLabel(file.path)} />
      </ViewerNotice>
    );
  }
  return (
    <ViewerNotice title="This file type can't be shown here yet" meta={meta}>
      GoodFolder keeps this file safe, but it can&apos;t be previewed in the browser yet.
      <OpenOnComputer meta={previewKindLabel(file.path)} />
    </ViewerNotice>
  );
}

/* ----------------------------------------------------------------- image */

function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function ImagePreview({ path, blob }: { path: string; blob: Blob }) {
  const url = useObjectUrl(blob);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (!url) return <ViewerLoading label="Loading image…" />;
  if (failed) {
    return (
      <ViewerNotice title="This image can't be displayed in this browser" meta={metaLine({ path, size: blob.size })}>
        The browser can&apos;t decode this image type — newer photo formats, for example, only
        render in some browsers. The image itself is fine and stays safe.
        <OpenOnComputer meta={previewKindLabel(path)} />
      </ViewerNotice>
    );
  }
  return (
    <figure className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gf-line)] px-4 py-2.5 sm:px-6">
        <div>
          <p className="text-[13px] font-semibold">Image preview</p>
          <p className="gf-faint text-[12px]">{formatBytes(blob.size)} · read-only</p>
        </div>
        <p className="gf-faint text-[12px]">{loaded ? "Loaded from the folder" : "Loading image…"}</p>
      </div>
      <div className="grid min-h-[420px] place-items-center bg-[var(--gf-surface-sunken)] p-5 sm:min-h-[540px] sm:p-8">
        {/* Every image — SVG included — renders through <img>, which never runs
            markup. Nothing here inlines document content. */}
        <img
          src={url}
          alt={path.split("/").pop() ?? path}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="max-h-[560px] max-w-full rounded-[var(--gf-radius)] object-contain shadow-[var(--gf-shadow)]"
        />
      </div>
      <figcaption className="gf-faint border-t border-[var(--gf-line)] px-4 py-2.5 text-[12px] sm:px-6">
        {path.split("/").pop() ?? path} · the original file stays unchanged.
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------- pdf */

export function PdfPreview({ path, blob }: { path: string; blob: Blob }) {
  const url = useObjectUrl(blob);
  if (!url) return <ViewerLoading label="Loading PDF…" />;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gf-line)] px-4 py-2.5 sm:px-6">
        <div>
          <p className="text-[13px] font-semibold">PDF preview</p>
          <p className="gf-faint text-[12px]">{formatBytes(blob.size)} · read-only</p>
        </div>
        <p className="gf-faint text-[12px]">Use the viewer controls to zoom or turn pages</p>
      </div>
      <iframe title={`Preview of ${path}`} src={url} className="h-[640px] w-full bg-white" />
    </div>
  );
}

/* ------------------------------------------------------------------- media */

function MediaPreview({ path, blob, kind }: { path: string; blob: Blob; kind: "video" | "audio" }) {
  const url = useObjectUrl(blob);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setFailed(false);
    setReady(false);
  }, [blob]);
  if (!url) return <ViewerLoading label={kind === "video" ? "Loading video…" : "Loading audio…"} />;
  if (failed) {
    return (
      <ViewerNotice title={`This ${kind} can't be played in this browser`} meta={metaLine({ path, size: blob.size })}>
        The file is safe, but this browser does not support its media codec. Download it or open it on a connected computer.
        <OpenOnComputer meta={previewKindLabel(path)} />
      </ViewerNotice>
    );
  }
  const isVideo = kind === "video";
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gf-line)] px-4 py-2.5 sm:px-6">
        <div>
          <p className="text-[13px] font-semibold">{isVideo ? "Video preview" : "Audio preview"}</p>
          <p className="gf-faint text-[12px]">{formatBytes(blob.size)} · read-only</p>
        </div>
        <p className="gf-faint text-[12px]">{ready ? "Ready to play" : "Loading media…"}</p>
      </div>
      <div className={`grid place-items-center bg-[var(--gf-surface-sunken)] p-5 sm:p-8 ${isVideo ? "min-h-[320px] sm:min-h-[480px]" : "min-h-[220px] sm:min-h-[280px]"}`}>
        {isVideo ? (
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            onLoadedData={() => setReady(true)}
            onError={() => setFailed(true)}
            className="max-h-[520px] w-full max-w-[960px] rounded-[var(--gf-radius)] bg-[var(--gf-black)] shadow-[var(--gf-shadow)]"
            aria-label={`Play ${path.split("/").pop() ?? path}`}
          />
        ) : (
          <audio
            src={url}
            controls
            preload="metadata"
            onCanPlay={() => setReady(true)}
            onError={() => setFailed(true)}
            className="w-full max-w-[720px]"
            aria-label={`Play ${path.split("/").pop() ?? path}`}
          />
        )}
      </div>
      <p className="gf-faint border-t border-[var(--gf-line)] px-4 py-2.5 text-[12px] sm:px-6">
        {path.split("/").pop() ?? path} · the original file stays unchanged.
      </p>
    </div>
  );
}

export function VideoPreview({ path, blob }: { path: string; blob: Blob }) {
  return <MediaPreview path={path} blob={blob} kind="video" />;
}

export function AudioPreview({ path, blob }: { path: string; blob: Blob }) {
  return <MediaPreview path={path} blob={blob} kind="audio" />;
}

/* ------------------------------------------------------------------ word */

// Black on white with alpha derivatives only — the strict palette, mirrored
// inside the isolated frame where the app's CSS variables don't reach.
const WORD_PREVIEW_STYLE = `<style>
  :root{color-scheme:light}
  body{font-family:Georgia,'Times New Roman',serif;color:#000;background:color-mix(in srgb,#3B82F6 3%,#fff);margin:0;padding:24px 16px;line-height:1.58;font-size:15px}
  .page{box-sizing:border-box;background:#fff;max-width:760px;min-height:560px;margin:0 auto;padding:42px 48px 64px;box-shadow:0 1px 2px rgba(0,0,0,.08),0 18px 42px -28px rgba(0,0,0,.42)}
  h1{font-family:ui-sans-serif,system-ui,sans-serif;font-size:2em;line-height:1.15;margin:0 0 24px;letter-spacing:-.03em}
  h2{font-family:ui-sans-serif,system-ui,sans-serif;font-size:1.35em;line-height:1.25;margin:30px 0 12px;letter-spacing:-.02em}
  h3{font-family:ui-sans-serif,system-ui,sans-serif;font-size:1.15em;line-height:1.3;margin:24px 0 9px}
  p{margin:0 0 15px}ul,ol{margin:0 0 18px;padding-left:26px}li{margin:3px 0}
  img{display:block;max-width:100%;height:auto;margin:20px auto}
  table{border-collapse:collapse;width:100%;margin:18px 0 22px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px}
  td,th{border:1px solid rgba(0,0,0,.18);padding:8px 10px;text-align:left;vertical-align:top}
  blockquote{border-left:3px solid #3B82F6;margin:18px 0;padding:4px 0 4px 16px;color:rgba(0,0,0,.62)}
  a{color:#000;text-decoration:underline}
  @media(max-width:600px){body{padding:12px 0}.page{min-height:480px;padding:28px 22px 44px;box-shadow:none}}
</style>`;

export function WordPreview({ path, blob }: { path: string; blob: Blob }) {
  const [html, setHtml] = useState<string | null>(null);
  const [messageCount, setMessageCount] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setHtml(null);
    setMessageCount(0);
    setFailed(false);
    (async () => {
      try {
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
        if (alive) {
          setHtml(result.value);
          setMessageCount(result.messages.length);
        }
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [blob]);
  if (failed) return <ViewerFailed path={path} size={blob.size} />;
  if (html === null) return <ViewerLoading label="Opening document…" />;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gf-line)] px-4 py-2.5 sm:px-6">
        <div>
          <p className="text-[13px] font-semibold">Word document preview</p>
          <p className="gf-faint text-[12px]">{formatBytes(blob.size)} · read-only</p>
        </div>
        <p className="gf-faint text-[12px]">
          {messageCount > 0 ? `${messageCount} layout note${messageCount === 1 ? "" : "s"} · ` : ""}
          Word page layout is simplified
        </p>
      </div>
      {/* sandbox with no permissions: markup renders, scripts can never run */}
      <iframe
        title={`Preview of ${path}`}
        sandbox=""
        srcDoc={WORD_PREVIEW_STYLE + `<main class="page">${html}</main>`}
        className="h-[720px] w-full bg-[var(--gf-surface-sunken)]"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ sheet */

interface SheetCell {
  address: string;
  display: string;
  formula?: string;
}

interface SheetTab {
  name: string;
  startRow: number;
  startCol: number;
  totalRows: number;
  totalCols: number;
  rows: SheetCell[][];
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function highlightedCell(value: string, query: string): React.ReactNode {
  if (!query) return value;
  const lowerValue = value.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let at = lowerValue.indexOf(lowerQuery, from);
  while (at >= 0) {
    if (at > from) parts.push(value.slice(from, at));
    parts.push(
      <mark key={`${at}-${query}`} className="rounded-[3px] bg-[var(--gf-blue-soft)] px-0.5 text-[var(--gf-black)]">
        {value.slice(at, at + query.length)}
      </mark>,
    );
    from = at + query.length;
    at = lowerValue.indexOf(lowerQuery, from);
  }
  if (from === 0) return value;
  if (from < value.length) parts.push(value.slice(from));
  return parts;
}

export function SheetPreview({ path, blob, onSelect }: { path: string; blob: Blob; onSelect?: (value: string) => void }) {
  const [tabs, setTabs] = useState<SheetTab[] | null>(null);
  const [active, setActive] = useState(0);
  const [selectedCell, setSelectedCell] = useState<SheetCell | null>(null);
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setTabs(null);
    setActive(0);
    setSelectedCell(null);
    setQuery("");
    setFailed(false);
    (async () => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await blob.arrayBuffer(), { type: "array" });
        const loaded = wb.SheetNames.slice(0, 12).map((name) => {
          const sheet = wb.Sheets[name]!;
          const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"] as string) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };
          const totalRows = Math.max(0, range.e.r - range.s.r + 1);
          const totalCols = Math.max(0, range.e.c - range.s.c + 1);
          const rows = Array.from({ length: Math.min(totalRows, SHEET_ROW_CAP) }, (_, rowIndex) =>
            Array.from({ length: Math.min(totalCols, SHEET_COL_CAP) }, (_, colIndex) => {
              const address = XLSX.utils.encode_cell({ r: range.s.r + rowIndex, c: range.s.c + colIndex });
              const cell = sheet[address] as { w?: unknown; v?: unknown; f?: string } | undefined;
              const raw = cell?.w ?? cell?.v ?? "";
              return { address, display: raw instanceof Date ? raw.toLocaleDateString() : String(raw), formula: cell?.f };
            }),
          );
          return { name, startRow: range.s.r, startCol: range.s.c, totalRows, totalCols, rows };
        });
        if (!loaded.length || loaded.every((tab) => tab.rows.length === 0)) throw new Error("empty workbook");
        if (alive) setTabs(loaded);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [blob]);
  if (failed) return <ViewerFailed path={path} size={blob.size} />;
  if (!tabs) return <ViewerLoading label="Opening spreadsheet…" />;

  const current = tabs[Math.min(active, tabs.length - 1)]!;
  const queryValue = query.trim();
  const matchCount = queryValue
    ? current.rows.flat().filter((cell) => cell.display.toLocaleLowerCase().includes(queryValue.toLocaleLowerCase())).length
    : 0;
  const truncated = current.totalRows > SHEET_ROW_CAP || current.totalCols > SHEET_COL_CAP;

  function chooseSheet(index: number) {
    setActive(index);
    setSelectedCell(null);
    if (typeof document !== "undefined") {
      delete document.body.dataset.gfSelectedCellAddress;
      delete document.body.dataset.gfSelectedCellValue;
    }
    onSelect?.("");
  }

  function chooseCell(cell: SheetCell) {
    setSelectedCell(cell);
    if (typeof document !== "undefined") {
      document.body.dataset.gfSelectedCellAddress = cell.address;
      document.body.dataset.gfSelectedCellValue = cell.display;
    }
    onSelect?.(`${cell.address}: ${cell.display || "(empty)"}`);
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--gf-line)] px-4 py-3 sm:px-6">
        <div>
          <p className="text-[13px] font-semibold">Spreadsheet preview</p>
          <p className="gf-faint text-[12px]">{formatBytes(blob.size)} · read-only · formulas remain visible when a cell is selected</p>
        </div>
        <label className="relative min-w-[190px] flex-1 sm:max-w-[260px]">
          <span className="sr-only">Find in sheet</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gf-ink-faint)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find in sheet"
            className="gf-input h-9 min-h-9 pl-9 pr-3 text-[13px]"
          />
        </label>
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-[var(--gf-line)] px-3 py-2" role="tablist" aria-label="Sheets in this spreadsheet">
          {tabs.map((tab, i) => (
            <button
              key={tab.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              tabIndex={i === active ? 0 : -1}
              onClick={() => chooseSheet(i)}
              className={`gf-button-ghost h-9 shrink-0 rounded-full border px-3.5 text-[12.5px] font-semibold ${
                i === active ? "border-[var(--gf-blue-ink)] bg-[var(--gf-blue-soft)] text-[var(--gf-blue-ink)]" : "border-[var(--gf-line)]"
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gf-line)] bg-[var(--gf-surface-sunken)] px-4 py-2.5 text-[12px] sm:px-6">
        <p className="gf-faint"><span className="font-semibold text-[var(--gf-black)]">{current.name}</span> · {current.totalRows} rows · {current.totalCols} columns</p>
        <p className="gf-faint" aria-live="polite">{queryValue ? `${matchCount} match${matchCount === 1 ? "" : "es"} in the visible range` : "Click a cell to inspect its value"}</p>
      </div>

      <div className="min-h-12 border-b border-[var(--gf-line)] px-4 py-2.5 sm:px-6" aria-live="polite">
        {selectedCell ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px]">
            <code className="rounded-[5px] bg-[var(--gf-blue-soft)] px-1.5 py-0.5 font-semibold text-[var(--gf-blue-ink)]">{selectedCell.address}</code>
            <span className="min-w-0 break-words text-[var(--gf-black)]">{selectedCell.display || "(empty)"}</span>
            {selectedCell.formula && <code className="min-w-0 break-all text-[var(--gf-ink-faint)]">{selectedCell.formula}</code>}
          </div>
        ) : (
          <p className="gf-faint text-[12.5px]">Select a cell to see its address, displayed value, and formula.</p>
        )}
      </div>

      {/* Wide sheets scroll inside this region, never the page. */}
      <div className="max-h-[600px] overflow-auto" role="region" aria-label={`${current.name} sheet`}>
        {current.rows.length > 0 ? (
          <table role="grid" className="border-collapse text-left text-[13px]">
            <thead>
              <tr className="bg-[var(--gf-surface-sunken)]">
                <th scope="col" className="sticky left-0 top-0 z-20 min-w-12 border-b border-r border-[var(--gf-line-strong)] bg-[var(--gf-surface-sunken)] px-2 py-2 text-right text-[11px] font-semibold text-[var(--gf-ink-faint)]">#</th>
                {current.rows[0]!.map((_, colIndex) => (
                  <th key={colIndex} scope="col" className="sticky top-0 z-10 min-w-32 whitespace-nowrap border-b border-[var(--gf-line-strong)] bg-[var(--gf-surface-sunken)] px-3 py-2 text-center text-[11px] font-semibold text-[var(--gf-ink-faint)]">
                    {columnName(current.startCol + colIndex)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {current.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th scope="row" className="sticky left-0 z-[1] border-b border-r border-[var(--gf-line)] bg-[var(--gf-surface-sunken)] px-2 py-1.5 text-right text-[11px] font-semibold text-[var(--gf-ink-faint)]">
                    {current.startRow + rowIndex + 1}
                  </th>
                  {row.map((cell) => (
                    <td
                      key={cell.address}
                      role="gridcell"
                      tabIndex={0}
                      aria-label={`${cell.address}: ${cell.display || "empty"}`}
                      onClick={() => chooseCell(cell)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          chooseCell(cell);
                        }
                      }}
                      className={`min-w-32 max-w-72 whitespace-nowrap border-b border-[var(--gf-line)] px-3 py-1.5 align-top outline-none ${
                        selectedCell?.address === cell.address ? "bg-[var(--gf-blue-soft)] text-[var(--gf-black)] ring-1 ring-inset ring-[var(--gf-blue-ink)]" : "hover:bg-[var(--gf-blue-wash)] focus:bg-[var(--gf-blue-wash)]"
                      }`}
                    >
                      {highlightedCell(cell.display, queryValue)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="gf-faint p-5 text-[13px]">This sheet is empty.</p>
        )}
      </div>
      {truncated && (
        <p className="gf-faint border-t border-[var(--gf-line)] px-4 py-2.5 text-[12px]">
          Showing the first {SHEET_ROW_CAP} rows and {SHEET_COL_CAP} columns. Open the file on a connected computer to see everything.
        </p>
      )}
    </div>
  );
}


/* ----------------------------------------------------------------- slides */

function decodeXmlEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

const PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const RELATIONSHIP_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

interface SlideBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SlideTextElement extends SlideBox {
  kind: "text";
  text: string;
  fontSizePt: number;
  bold: boolean;
  color: string;
}

interface SlideImageElement extends SlideBox {
  kind: "image";
  url: string;
  alt: string;
}

type SlideElement = SlideTextElement | SlideImageElement;

interface ParsedSlide {
  background: string;
  elements: SlideElement[];
}

interface ParsedDeck {
  width: number;
  height: number;
  slides: ParsedSlide[];
  mediaCount: number;
}

function xmlElements(root: Document | Element, namespace: string, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(namespace, name));
}

function numericAttribute(node: Element | undefined, name: string): number {
  const value = Number(node?.getAttribute(name) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function transformOf(root: Element): SlideBox | null {
  const xfrm = xmlElements(root, DRAWING_NS, "xfrm")[0];
  const off = xfrm ? xmlElements(xfrm, DRAWING_NS, "off")[0] : undefined;
  const ext = xfrm ? xmlElements(xfrm, DRAWING_NS, "ext")[0] : undefined;
  const box = {
    left: numericAttribute(off, "x"),
    top: numericAttribute(off, "y"),
    width: numericAttribute(ext, "cx"),
    height: numericAttribute(ext, "cy"),
  };
  return box.width > 0 && box.height > 0 ? box : null;
}

function normalizeZipPath(baseDir: string, target: string): string {
  const parts = [...(target.startsWith("/") ? [] : baseDir.split("/")), ...target.split("/")];
  const clean: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") clean.pop();
    else clean.push(part);
  }
  return clean.join("/");
}

function relationshipTargets(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  for (const relation of Array.from(doc.getElementsByTagName("Relationship"))) {
    const id = relation.getAttribute("Id");
    const target = relation.getAttribute("Target");
    if (id && target) map.set(id, target);
  }
  return map;
}

function safeSlideColor(value: string | null | undefined, fallback: string): string {
  return value && /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : fallback;
}

function colorOf(root: Element): string {
  const color = xmlElements(root, DRAWING_NS, "srgbClr")[0]?.getAttribute("val");
  return safeSlideColor(color, "#000000");
}

function fontSizeOf(root: Element): number {
  const runProperties = [...xmlElements(root, DRAWING_NS, "rPr"), ...xmlElements(root, DRAWING_NS, "defRPr")];
  const size = runProperties.map((node) => Number(node.getAttribute("sz"))).find((value) => Number.isFinite(value) && value > 0);
  return Math.max(8, Math.min(36, (size ?? 1600) / 100));
}

function boldOf(root: Element): boolean {
  return [...xmlElements(root, DRAWING_NS, "rPr"), ...xmlElements(root, DRAWING_NS, "defRPr")].some((node) => {
    const value = node.getAttribute("b");
    return value === "1" || value?.toLowerCase() === "true";
  });
}

function mediaMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml" } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream";
}

function slideIds(doc: Document): string[] {
  return xmlElements(doc, PRESENTATION_NS, "sldId").map((node) => node.getAttributeNS(RELATIONSHIP_NS, "id") ?? node.getAttribute("r:id") ?? "");
}

async function parseDeck(blob: Blob, registerUrl: (url: string) => string): Promise<ParsedDeck> {
  const { unzipSync } = await import("fflate");
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const decoder = new TextDecoder();
  const parser = new DOMParser();
  const xml = (name: string): Document => parser.parseFromString(decoder.decode(entries[name] ?? new Uint8Array()), "application/xml");
  const presentation = xml("ppt/presentation.xml");
  const size = xmlElements(presentation, PRESENTATION_NS, "sldSz")[0];
  const width = Math.max(1, numericAttribute(size, "cx"));
  const height = Math.max(1, numericAttribute(size, "cy"));
  const slideNames = Object.keys(entries).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  if (!slideNames.length) throw new Error("no slides found");
  const presentationRels = relationshipTargets(xml("ppt/_rels/presentation.xml.rels"));
  const orderedNames = slideIds(presentation)
    .map((id) => presentationRels.get(id))
    .filter((target): target is string => Boolean(target))
    .map((target) => normalizeZipPath("ppt", target));
  const names = (orderedNames.length ? orderedNames : slideNames.sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]))).filter((name) => entries[name]);
  if (!names.length) throw new Error("no readable slides");
  const slides = names.map((name) => {
    const slide = xml(name);
    const relName = name.replace(/\/([^/]+)\.xml$/, "/_rels/$1.xml.rels");
    const rels = relationshipTargets(entries[relName] ? parser.parseFromString(decoder.decode(entries[relName]!), "application/xml") : parser.parseFromString("<Relationships/>", "application/xml"));
    const backgroundNode = xmlElements(slide, PRESENTATION_NS, "bg")[0];
    const backgroundColor = backgroundNode ? xmlElements(backgroundNode, DRAWING_NS, "srgbClr")[0]?.getAttribute("val") : null;
    const elements: SlideElement[] = [];
    for (const shape of xmlElements(slide, PRESENTATION_NS, "sp")) {
      const lines = xmlElements(shape, DRAWING_NS, "t").map((node) => decodeXmlEntities(node.textContent ?? "")).filter((line) => line.trim());
      const box = transformOf(shape);
      if (!box || !lines.length) continue;
      elements.push({ ...box, kind: "text", text: lines.join("\n"), fontSizePt: fontSizeOf(shape), bold: boldOf(shape), color: colorOf(shape) });
    }
    for (const picture of xmlElements(slide, PRESENTATION_NS, "pic")) {
      const box = transformOf(picture);
      const embed = xmlElements(picture, DRAWING_NS, "blip")[0]?.getAttributeNS(RELATIONSHIP_NS, "embed") ?? xmlElements(picture, DRAWING_NS, "blip")[0]?.getAttribute("r:embed");
      const target = embed ? rels.get(embed) : undefined;
      const entryName = target ? normalizeZipPath("ppt/slides", target) : "";
      if (!box || !entryName || !entries[entryName]) continue;
      const url = registerUrl(URL.createObjectURL(new Blob([new Uint8Array(entries[entryName]!)], { type: mediaMime(entryName) })));
      elements.push({ ...box, kind: "image", url, alt: "Embedded presentation image" });
    }
    return { background: safeSlideColor(backgroundColor, "#FFFFFF"), elements };
  });
  return { width, height, slides, mediaCount: Object.keys(entries).filter((name) => name.startsWith("ppt/media/")).length };
}

function SlideCanvas({ slide, width, height, thumb = false }: { slide: ParsedSlide; width: number; height: number; thumb?: boolean }) {
  return (
    <div className="relative w-full overflow-hidden border border-[var(--gf-line-strong)]" style={{ aspectRatio: `${width} / ${height}`, background: slide.background }}>
      {slide.elements.map((element, index) => {
        const style: CSSProperties = {
          position: "absolute",
          left: `${Math.max(-5, Math.min(105, element.left / width * 100))}%`,
          top: `${Math.max(-5, Math.min(105, element.top / height * 100))}%`,
          width: `${Math.max(1, Math.min(110, element.width / width * 100))}%`,
          height: `${Math.max(1, Math.min(110, element.height / height * 100))}%`,
          overflow: "hidden",
        };
        if (element.kind === "image") {
          return <img key={index} src={element.url} alt={element.alt} style={{ ...style, objectFit: "contain" }} />;
        }
        return <div key={index} style={{ ...style, color: element.color, fontSize: thumb ? "7px" : `${element.fontSizePt}pt`, fontWeight: element.bold ? 700 : 400, lineHeight: 1.15, whiteSpace: "pre-wrap" }}>{element.text}</div>;
      })}
    </div>
  );
}

export function SlidesPreview({ path, blob }: { path: string; blob: Blob }) {
  const [deck, setDeck] = useState<ParsedDeck | null>(null);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    setDeck(null);
    setActive(0);
    setFailed(false);
    (async () => {
      try {
        const parsed = await parseDeck(blob, (url) => { urls.push(url); return url; });
        if (alive) setDeck(parsed);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [blob]);
  if (failed) return <ViewerFailed path={path} size={blob.size} />;
  if (!deck) return <ViewerLoading label="Opening presentation…" />;
  const current = deck.slides[Math.min(active, deck.slides.length - 1)]!;
  return (
    <div className="min-w-0 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gf-line)] pb-3">
        <div>
          <p className="text-[13px] font-semibold">PowerPoint preview</p>
          <p className="gf-faint text-[12px]">{deck.slides.length} slides{deck.mediaCount ? ` · ${deck.mediaCount} embedded image${deck.mediaCount === 1 ? "" : "s"}` : ""} · read-only</p>
        </div>
        <p className="gf-faint text-[12px]">Layout is an in-browser approximation</p>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[150px_minmax(0,1fr)]">
        <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:max-h-[610px] lg:space-y-2 lg:overflow-y-auto" role="tablist" aria-label="Slides in this presentation">
          {deck.slides.map((slide, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === active}
              tabIndex={index === active ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); setActive(Math.min(deck.slides.length - 1, index + 1)); }
                if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); setActive(Math.max(0, index - 1)); }
              }}
              className={`block w-28 shrink-0 rounded-[var(--gf-radius-sm)] border p-1.5 text-left lg:w-full ${index === active ? "border-[var(--gf-blue-ink)] bg-[var(--gf-blue-soft)]" : "border-[var(--gf-line)] bg-white hover:bg-[var(--gf-blue-wash)]"}`}
            >
              <div className="aspect-video w-full overflow-hidden rounded-[5px] bg-white"><SlideCanvas slide={slide} width={deck.width} height={deck.height} thumb /></div>
              <span className="gf-faint mt-1 block px-0.5 text-[11px] font-semibold">Slide {index + 1}</span>
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={`Slide ${active + 1}`} className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <p className="text-[13px] font-semibold">Slide {active + 1} of {deck.slides.length}</p>
            <div className="flex gap-1.5">
              <button type="button" className="gf-icon-button" aria-label="Previous slide" disabled={active === 0} onClick={() => setActive((index) => Math.max(0, index - 1))}><ArrowLeftIcon /></button>
              <button type="button" className="gf-icon-button" aria-label="Next slide" disabled={active === deck.slides.length - 1} onClick={() => setActive((index) => Math.min(deck.slides.length - 1, index + 1))}><ArrowRightIcon /></button>
            </div>
          </div>
          <div className="rounded-[var(--gf-radius)] border border-[var(--gf-line)] bg-[var(--gf-surface-sunken)] p-3 sm:p-5">
            <div className="mx-auto w-full max-w-[900px]"><SlideCanvas slide={current} width={deck.width} height={deck.height} /></div>
          </div>
          <p className="gf-faint mt-3 text-[12px]">Text and embedded images are shown where the file exposes them. Fonts, transitions, charts, and complex PowerPoint layout may differ from the original; download the file for the full presentation.</p>
        </div>
      </div>
    </div>
  );
}


/* ------------------------------------------------- keynote / numbers files */

type QuickLookState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "none" }
  | { status: "image"; blob: Blob }
  | { status: "pdf"; blob: Blob };

export function QuickLookPreview({ path, blob }: { path: string; blob: Blob }) {
  const [state, setState] = useState<QuickLookState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    (async () => {
      try {
        const { unzipSync } = await import("fflate");
        const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
        const byLower = new Map<string, Uint8Array>();
        for (const [name, data] of Object.entries(entries)) byLower.set(name.toLowerCase(), data);
        const thumbPng = byLower.get("quicklook/thumbnail.png");
        const thumbJpg = byLower.get("quicklook/thumbnail.jpg");
        const previewPdf = byLower.get("quicklook/preview.pdf");
        if (!alive) return;
        if (thumbPng) {
          setState({ status: "image", blob: new Blob([new Uint8Array(thumbPng)], { type: "image/png" }) });
        } else if (thumbJpg) {
          setState({ status: "image", blob: new Blob([new Uint8Array(thumbJpg)], { type: "image/jpeg" }) });
        } else if (previewPdf) {
          setState({ status: "pdf", blob: new Blob([new Uint8Array(previewPdf)], { type: "application/pdf" }) });
        } else {
          setState({ status: "none" });
        }
      } catch {
        if (alive) setState({ status: "failed" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [blob]);
  if (state.status === "loading") return <ViewerLoading label="Looking for a preview inside the file…" />;
  if (state.status === "failed") return <ViewerFailed path={path} size={blob.size} />;
  if (state.status === "none") {
    return (
      <ViewerNotice title="No preview is stored inside this file" meta={metaLine({ path, size: blob.size })}>
        Files like this sometimes carry a small preview snapshot — this one doesn&apos;t. The
        document itself is safe and opens in full on a connected computer.
        <OpenOnComputer meta={previewKindLabel(path)} />
      </ViewerNotice>
    );
  }
  return (
    <div className="min-w-0">
      <p className="gf-faint border-b border-[var(--gf-line)] px-4 py-2.5 text-[12px] sm:px-6">
        Preview image — a snapshot the app stored inside the file, not the full document. The
        document itself opens on a connected computer.
      </p>
      {state.status === "image" ? (
        <ImagePreview path={path} blob={state.blob} />
      ) : (
        <PdfPreview path={path} blob={state.blob} />
      )}
    </div>
  );
}
