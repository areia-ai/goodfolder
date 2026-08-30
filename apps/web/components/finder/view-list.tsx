"use client";

import { Fragment, useEffect, useRef } from "react";
import { ChevronRightIcon, ProposalIcon } from "@/components/icons";
import { NodeGlyph } from "@/components/finder/node-glyph";
import { formatBytes } from "@/lib/preview";
import { directoryName, kindLabel, type ListRow } from "@/lib/vfs";
import type {
  ChangeStamp, SortDirection, SortKey, VfsNode,
} from "@/components/finder/types";
import type { ClickModifiers } from "@/components/finder/use-selection";

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
}

export function ListView(props: ListViewProps) {
  const body = useRef<HTMLTableSectionElement>(null);

  // Keep the row the keyboard is on inside the scrolling area.
  useEffect(() => {
    if (!props.cursor) return;
    body.current
      ?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(props.cursor)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [props.cursor]);

  const sections = props.groups ?? [{ id: "all", label: "", rows: props.rows }];

  return (
    <table className="gf-win-table" role="treegrid" aria-label="Files and folders">
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
        {sections.map((section) => (
          <Fragment key={section.id}>
            {section.label && (
              <tr className="gf-win-group">
                <td colSpan={1 + props.columns.length}>{section.label}</td>
              </tr>
            )}
            {section.rows.map((row) => {
              const { node } = row;
              const selected = props.isSelected(node.id);
              return (
                <tr
                  key={node.id}
                  data-node-id={node.id}
                  data-cursor={props.cursor === node.id ? "true" : undefined}
                  className="gf-win-row"
                  role="row"
                  aria-level={row.level + 1}
                  aria-selected={selected}
                  aria-expanded={row.expandable ? row.expanded : undefined}
                  onClick={(event) =>
                    props.onSelect(node, { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey })
                  }
                  onDoubleClick={() => props.onOpen(node)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!selected) props.onSelect(node, {});
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
                  {props.columns.map((column) => (
                    <td key={column.id} className={column.className}>
                      {column.render(node)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

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
