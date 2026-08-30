"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronRightIcon, ProposalIcon } from "@/components/icons";
import { NodeGlyph } from "@/components/finder/node-glyph";
import { formatBytes } from "@/lib/preview";
import { directoryName, kindLabel, type ListRow } from "@/lib/vfs";
import type {
  ChangeStamp, SortDirection, SortKey, VfsNode,
} from "@/components/finder/types";
import type { ClickModifiers } from "@/components/finder/use-selection";
import { WINDOW_THRESHOLD, useWindowSlice } from "@/components/finder/use-window";

export interface ListColumn {
  id: string;
  label: string;
  className: string;
  /** Absent for a column there is no sensible way to order by. */
  sort?: SortKey;
  render: (node: VfsNode) => React.ReactNode;
}

/** Inside a folder, where everything has a size and a type worth naming. */
export const FOLDER_COLUMNS: ListColumn[] = [
  {
    id: "changed", label: "Last changed", sort: "changed",
    className: "hidden sm:table-cell",
    render: (node) => whenLabel(node.changed),
  },
  {
    id: "size", label: "Size", sort: "size",
    className: "hidden md:table-cell gf-win-num",
    render: (node) => (node.size === null ? "—" : formatBytes(node.size)),
  },
  {
    id: "kind", label: "Kind", sort: "kind",
    className: "hidden xl:table-cell",
    render: (node) => kindLabel(node),
  },
];

/**
 * At the root every row is a GoodFolder, so "Kind" would say the same word
 * three times and a byte size is not something the folder list carries. What
 * a person actually wants to know there is how much has happened, and whether
 * anyone else is in it.
 */
export const ROOT_COLUMNS: ListColumn[] = [
  {
    id: "changed", label: "Last saved", sort: "changed",
    className: "hidden sm:table-cell",
    render: (node) => whenLabel(node.changed),
  },
  {
    id: "saves", label: "Saves",
    className: "hidden md:table-cell gf-win-num",
    render: (node) => (node.kind === "folder" ? Number(node.folder.lastSeq ?? 0) : ""),
  },
  {
    id: "people", label: "Who", sort: "kind",
    className: "hidden xl:table-cell",
    render: (node) => {
      if (node.kind !== "folder") return "";
      if (node.folder.role === "contributor") return "Shared with you";
      const others = Number(node.folder.contributorCount ?? 0);
      return others > 0 ? `You and ${others} other${others === 1 ? "" : "s"}` : "Just you";
    },
  },
];

function whenLabel(stamp: ChangeStamp | null): string {
  if (!stamp) return "—";
  const date = new Date(stamp.at);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export interface ListViewProps {
  rows: ListRow[];
  columns: ListColumn[];
  /** Groups, when grouping is on; disclosure triangles are off in that case. */
  groups: Array<{ id: string; label: string; rows: ListRow[] }> | null;
  sort: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  isSelected: (id: string) => boolean;
  cursor: string | null;
  onSelect: (node: VfsNode, modifiers: ClickModifiers) => void;
  onOpen: (node: VfsNode) => void;
  onToggle: (node: VfsNode) => void;
  onContext: (node: VfsNode, at: { x: number; y: number }) => void;
  /** Search results come from anywhere beneath, so they name where they live. */
  showPath: boolean;
  /** True when a date column would be lying by omission. */
  datesPartial: boolean;
  /** The element that scrolls, so long listings can draw only what shows. */
  scroller: RefObject<HTMLElement | null>;
}

type Entry =
  | { kind: "group"; id: string; label: string }
  | { kind: "row"; id: string; row: ListRow; index: number };

/** A stable, collision-free element id for one row of the current listing. */
export function rowDomId(index: number): string {
  return `gf-row-${index}`;
}

export function ListView(props: ListViewProps) {
  const body = useRef<HTMLTableSectionElement>(null);
  // Measured rather than assumed: a row is taller under a coarse pointer, and
  // a guess here would put every windowed listing slightly out of place.
  const [sizes, setSizes] = useState({ row: 30, group: 26 });

  const sections = useMemo(
    () => props.groups ?? [{ id: "all", label: "", rows: props.rows }],
    [props.groups, props.rows],
  );

  // One flat list of everything drawn, group headings included, so a row's
  // place from the top is a single sum.
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    let index = 0;
    for (const section of sections) {
      if (section.label) out.push({ kind: "group", id: section.id, label: section.label });
      for (const row of section.rows) out.push({ kind: "row", id: row.node.id, row, index: index++ });
    }
    return out;
  }, [sections]);

  const heights = useMemo(
    () => entries.map((entry) => (entry.kind === "group" ? sizes.group : sizes.row)),
    [entries, sizes],
  );
  const slice = useWindowSlice(props.scroller, heights, entries.length > WINDOW_THRESHOLD);

  useLayoutEffect(() => {
    const row = body.current?.querySelector<HTMLElement>(".gf-win-row");
    const group = body.current?.querySelector<HTMLElement>(".gf-win-group");
    const next = {
      row: row?.offsetHeight || sizes.row,
      group: group?.offsetHeight || sizes.group,
    };
    if (next.row !== sizes.row || next.group !== sizes.group) setSizes(next);
  }, [sizes, entries.length]);

  const placeOf = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((entry, at) => {
      if (entry.kind === "row") map.set(entry.id, at);
    });
    return map;
  }, [entries]);

  // Keep the row the keyboard is on in view. When the listing is windowed the
  // row may not be drawn at all, so scroll to where it will be.
  useEffect(() => {
    if (!props.cursor) return;
    const drawn = body.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(props.cursor)}"]`);
    if (drawn) {
      drawn.scrollIntoView({ block: "nearest" });
      return;
    }
    const at = placeOf.get(props.cursor);
    const element = props.scroller.current;
    if (at === undefined || !element) return;
    const top = slice.offsetOf(at);
    const rowBottom = top + sizes.row;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (rowBottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = rowBottom - element.clientHeight;
    }
  }, [props.cursor, placeOf, slice, sizes.row, props.scroller]);

  const visible = slice.active ? entries.slice(slice.start, slice.end) : entries;
  const span = 1 + props.columns.length;
  const cursorAt = props.cursor ? placeOf.get(props.cursor) : undefined;
  const cursorEntry = cursorAt === undefined ? null : entries[cursorAt];

  return (
    <table
      className="gf-win-table"
      role="treegrid"
      aria-label="Files and folders"
      aria-rowcount={placeOf.size}
      aria-activedescendant={
        cursorEntry && cursorEntry.kind === "row" ? rowDomId(cursorEntry.index) : undefined
      }
    >
      <thead>
        <tr>
          <th scope="col" aria-sort={ariaSort(props.sort, "name", props.direction)}>
            <button type="button" onClick={() => props.onSort("name")}>
              Name
              <SortMark active={props.sort === "name"} direction={props.direction} />
            </button>
          </th>
          {props.columns.map((column) => (
            <th
              key={column.id}
              scope="col"
              className={column.className}
              aria-sort={column.sort ? ariaSort(props.sort, column.sort, props.direction) : undefined}
            >
              {column.sort ? (
                <button type="button" onClick={() => props.onSort(column.sort!)}>
                  {column.label}
                  <SortMark active={props.sort === column.sort} direction={props.direction} />
                  {column.id === "changed" && props.datesPartial && (
                    <span className="sr-only"> — some dates are older than the timeline reaches</span>
                  )}
                </button>
              ) : (
                <span className="flex min-h-[30px] items-center px-2.5">{column.label}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody ref={body}>
        {slice.padTop > 0 && (
          <tr aria-hidden="true" style={{ height: slice.padTop }}>
            <td colSpan={span} />
          </tr>
        )}
        {visible.map((entry) =>
          entry.kind === "group" ? (
            <tr key={entry.id} className="gf-win-group">
              <td colSpan={span}>{entry.label}</td>
            </tr>
          ) : (
            <Row
              key={entry.id}
              row={entry.row}
              domId={rowDomId(entry.index)}
              rowIndex={entry.index + 1}
              columns={props.columns}
              selected={props.isSelected(entry.id)}
              cursor={props.cursor === entry.id}
              showPath={props.showPath}
              onSelect={props.onSelect}
              onOpen={props.onOpen}
              onToggle={props.onToggle}
              onContext={props.onContext}
            />
          ),
        )}
        {slice.padBottom > 0 && (
          <tr aria-hidden="true" style={{ height: slice.padBottom }}>
            <td colSpan={span} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

interface RowProps {
  row: ListRow;
  domId: string;
  rowIndex: number;
  columns: ListColumn[];
  selected: boolean;
  cursor: boolean;
  showPath: boolean;
  onSelect: (node: VfsNode, modifiers: ClickModifiers) => void;
  onOpen: (node: VfsNode) => void;
  onToggle: (node: VfsNode) => void;
  onContext: (node: VfsNode, at: { x: number; y: number }) => void;
}

/**
 * One row.
 *
 * Held apart and memoised because a folder can carry a thousand of them, and
 * without this every arrow-key press re-renders all of them to move one
 * highlight.
 */
const Row = memo(function Row(props: RowProps) {
  const { row, columns } = props;
  const { node } = row;
  return (
    <tr
      id={props.domId}
      data-node-id={node.id}
      data-cursor={props.cursor ? "true" : undefined}
      className="gf-win-row"
      role="row"
      aria-rowindex={props.rowIndex}
      aria-level={row.level + 1}
      aria-selected={props.selected}
      aria-expanded={row.expandable ? row.expanded : undefined}
      onClick={(event) =>
        props.onSelect(node, { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey })
      }
      onDoubleClick={() => props.onOpen(node)}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!props.selected) props.onSelect(node, {});
        props.onContext(node, { x: event.clientX, y: event.clientY });
      }}
    >
      <td>
        <div className="gf-win-name" style={{ paddingLeft: `${8 + row.level * 17}px` }}>
          {row.expandable ? (
            <button
              type="button"
              className="gf-win-twist"
              aria-expanded={row.expanded}
              aria-label={`${row.expanded ? "Close" : "Open"} ${node.name}`}
              onClick={(event) => {
                event.stopPropagation();
                props.onToggle(node);
              }}
            >
              <ChevronRightIcon />
            </button>
          ) : (
            <span className="w-[22px] flex-none" aria-hidden="true" />
          )}
          <NodeGlyph node={node} />
          <span title={node.name}>{node.name}</span>
          {props.showPath && node.kind !== "folder" && directoryName(node.path) && (
            <span className="gf-win-subpath gf-truncate">in {directoryName(node.path)}</span>
          )}
          {node.reviewCount > 0 && (
            <span className="gf-win-flag flex-none">
              <ProposalIcon className="h-3 w-3" />
              {node.reviewCount}
              <span className="sr-only"> waiting for review</span>
            </span>
          )}
        </div>
      </td>
      {columns.map((column) => (
        <td key={column.id} className={column.className}>
          {column.render(node)}
        </td>
      ))}
    </tr>
  );
});

function ariaSort(current: SortKey, column: SortKey, direction: SortDirection) {
  if (current !== column) return undefined;
  return direction === "asc" ? ("ascending" as const) : ("descending" as const);
}

function SortMark({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return null;
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3">
      <path
        d={direction === "asc" ? "M6 3.5 9 8H3z" : "M6 8.5 3 4h6z"}
        fill="currentColor"
      />
    </svg>
  );
}
