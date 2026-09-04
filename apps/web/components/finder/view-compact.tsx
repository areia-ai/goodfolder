"use client";

import { memo, useMemo, type RefObject } from "react";
import { MoreHorizontalIcon, PeopleIcon, ProposalIcon } from "@/components/icons";
import { NodeGlyph } from "@/components/finder/node-glyph";
import { useThumbnail } from "@/components/finder/use-thumbnail";
import { formatBytes } from "@/lib/preview";
import { directoryName, kindLabel, type ListRow } from "@/lib/vfs";
import type { ChangeStamp, VfsNode } from "@/components/finder/types";
import { WINDOW_THRESHOLD, useWindowSlice } from "@/components/finder/use-window";

/**
 * The listing on a phone.
 *
 * The window offers four ways of showing a folder, and on a phone none of
 * them is right: Columns needs several columns of width, Gallery and Icons
 * need a grid wider than a thumb, and List is a table whose columns all
 * disappear at this size, leaving a name and a lot of empty room. So a phone
 * gets one way instead of a choice between four — every folder, every search
 * result, every place, drawn the same.
 *
 * What a row says is chosen for a screen you hold: the name, and one line
 * underneath saying the thing you would otherwise have to turn the phone
 * sideways for. Actions are on a button rather than behind a long press,
 * because a long press is not a thing a listing can tell you about.
 *
 * The stored view preference is not touched. Someone who chose Gallery on
 * their laptop still has Gallery there; this only decides what a narrow
 * window draws.
 */

/** Short enough for a phone: a time today, a date this year, a month before. */
function whenShort(stamp: ChangeStamp | null): string {
  if (!stamp) return "";
  const date = new Date(stamp.at);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/** The one line under a name, different for each kind of thing a row can be. */
function secondLine(node: VfsNode, showPath: boolean): string {
  const when = whenShort(node.changed);
  if (node.kind === "folder") {
    const saves = Number(node.folder.lastSeq ?? 0);
    const counted = saves > 0 ? `${saves} save${saves === 1 ? "" : "s"}` : "Nothing saved yet";
    return when ? `${counted} · ${when}` : counted;
  }
  if (node.kind === "directory") {
    const files = node.fileCount;
    return `${files} ${files === 1 ? "file" : "files"}`;
  }
  const parts = [kindLabel(node)];
  if (node.size !== null && node.size > 0) parts.push(formatBytes(node.size));
  if (when) parts.push(when);
  if (showPath && directoryName(node.path)) parts.push(`in ${directoryName(node.path)}`);
  return parts.join(" · ");
}

type Entry =
  | { kind: "group"; id: string; label: string }
  | { kind: "row"; id: string; node: VfsNode };

export interface CompactViewProps {
  rows: ListRow[];
  groups: Array<{ id: string; label: string; rows: ListRow[] }> | null;
  isSelected: (id: string) => boolean;
  onOpen: (node: VfsNode) => void;
  onContext: (node: VfsNode, at: { x: number; y: number }) => void;
  /** Search results come from anywhere beneath, so they name where they live. */
  showPath: boolean;
  /** The element that scrolls, so a long folder draws only what shows. */
  scroller: RefObject<HTMLElement | null>;
}

/** A row is taller than a list row and does not change height between them. */
const ROW_HEIGHT = 60;
const GROUP_HEIGHT = 34;

export function CompactView(props: CompactViewProps) {
  const sections = useMemo(
    () => props.groups ?? [{ id: "all", label: "", rows: props.rows }],
    [props.groups, props.rows],
  );

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const section of sections) {
      if (section.label) out.push({ kind: "group", id: section.id, label: section.label });
      for (const row of section.rows) out.push({ kind: "row", id: row.node.id, node: row.node });
    }
    return out;
  }, [sections]);

  const heights = useMemo(
    () => entries.map((entry) => (entry.kind === "group" ? GROUP_HEIGHT : ROW_HEIGHT)),
    [entries],
  );
  const slice = useWindowSlice(props.scroller, heights, entries.length > WINDOW_THRESHOLD);
  const visible = slice.active ? entries.slice(slice.start, slice.end) : entries;

  return (
    <ul className="gf-touch-list" aria-label="Files and folders">
      {slice.padTop > 0 && <li aria-hidden="true" style={{ height: slice.padTop }} />}
      {visible.map((entry) =>
        entry.kind === "group" ? (
          <li key={`group-${entry.id}`} className="gf-touch-group">
            {entry.label}
          </li>
        ) : (
          <TouchRow
            key={entry.id}
            node={entry.node}
            selected={props.isSelected(entry.id)}
            showPath={props.showPath}
            onOpen={props.onOpen}
            onContext={props.onContext}
          />
        ),
      )}
      {slice.padBottom > 0 && <li aria-hidden="true" style={{ height: slice.padBottom }} />}
    </ul>
  );
}

const TouchRow = memo(function TouchRow({
  node,
  selected,
  showPath,
  onOpen,
  onContext,
}: {
  node: VfsNode;
  selected: boolean;
  showPath: boolean;
  onOpen: (node: VfsNode) => void;
  onContext: (node: VfsNode, at: { x: number; y: number }) => void;
}) {
  const { ref, url } = useThumbnail(node, true);
  const shared = node.kind === "folder" && node.folder.role === "contributor";

  return (
    <li className="gf-touch-row" data-node-id={node.id} aria-selected={selected}>
      <button
        type="button"
        className="gf-touch-open"
        onClick={() => onOpen(node)}
        onContextMenu={(event) => {
          event.preventDefault();
          onContext(node, { x: event.clientX, y: event.clientY });
        }}
      >
        <span ref={ref as RefObject<HTMLSpanElement>} className="gf-touch-mark" aria-hidden="true">
          {url ? <img src={url} alt="" loading="lazy" /> : <NodeGlyph node={node} />}
        </span>
        <span className="gf-touch-text">
          <span className="gf-touch-name gf-truncate">{node.name}</span>
          <span className="gf-touch-meta gf-truncate">
            {shared && <PeopleIcon className="h-3 w-3 flex-none" />}
            {secondLine(node, showPath)}
          </span>
        </span>
        {node.reviewCount > 0 && (
          <span className="gf-win-flag flex-none">
            <ProposalIcon className="h-3 w-3" />
            {node.reviewCount}
            <span className="sr-only"> waiting for review</span>
          </span>
        )}
      </button>
      <button
        type="button"
        className="gf-touch-more"
        aria-label={`Actions for ${node.name}`}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onContext(node, { x: box.right, y: box.bottom });
        }}
      >
        <MoreHorizontalIcon />
      </button>
    </li>
  );
});
