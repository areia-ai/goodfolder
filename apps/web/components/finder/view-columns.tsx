"use client";

import { useEffect, useMemo, useRef } from "react";
import { ChevronRightIcon, ProposalIcon } from "@/components/icons";
import { NodeGlyph } from "@/components/finder/node-glyph";
import { folderChildren, locationOf, sortNodes, type Decoration, type TreeIndex } from "@/lib/vfs";
import type { Location, SortDirection, SortKey, VfsNode } from "@/components/finder/types";
import type { ClickModifiers } from "@/components/finder/use-selection";

export interface ColumnsViewProps {
  /** The root column: GoodFolders, or the top of the open folder. */
  rootNodes: VfsNode[];
  location: Location;
  tree: TreeIndex | null;
  decoration: Decoration;
  sort: SortKey;
  direction: SortDirection;
  isSelected: (id: string) => boolean;
  cursor: string | null;
  onSelect: (node: VfsNode, modifiers: ClickModifiers) => void;
  onOpen: (node: VfsNode) => void;
  /** What fills the last column when a file is picked out. */
  detail: React.ReactNode;
}

interface Column {
  id: string;
  /** The directory this column lists; `null` for the root column. */
  dir: string | null;
  nodes: VfsNode[];
  /** Which row in this column leads to the next one. */
  activeId: string | null;
}

/**
 * One column per level, the way a hierarchy is actually shaped.
 *
 * This is the view that makes a deep folder legible: you can see where you
 * are, what is beside it, and what is inside it at the same time — and the
 * last column is the file itself rather than a fifth list.
 */
export function ColumnsView(props: ColumnsViewProps) {
  const strip = useRef<HTMLDivElement>(null);

  const columns = useMemo<Column[]>(() => {
    const order = (nodes: VfsNode[]) => sortNodes(nodes, props.sort, props.direction);
    const { location, tree } = props;

    // The first column is always every folder, with the one you are in picked
    // out — walking into a folder should not make its siblings vanish.
    const out: Column[] = [{
      id: "root",
      dir: null,
      nodes: order(props.rootNodes),
      activeId: location.folderId ? `folder:${location.folderId}` : null,
    }];
    if (!location.folderId || !tree) return out;

    // Then one column for the folder's top level, and one for each directory
    // the address has walked into.
    const segments = location.dir.split("/").filter(Boolean);
    let at = "";
    for (let depth = 0; depth <= segments.length; depth += 1) {
      const nodes = order(folderChildren(tree, location.folderId, at, props.decoration));
      const nextSegment = segments[depth];
      const nextDir = nextSegment ? (at ? `${at}/${nextSegment}` : nextSegment) : null;
      out.push({
        id: at || "top",
        dir: at,
        nodes,
        activeId: nextDir
          ? `dir:${location.folderId}:${nextDir}`
          : location.file
            ? `file:${location.folderId}:${location.file}`
            : null,
      });
      if (!nextDir) break;
      at = nextDir;
    }
    return out;
  }, [props]);

  // A new column appears to the right; bring it into view.
  useEffect(() => {
    const element = strip.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [columns.length, props.location.file]);

  return (
    <div ref={strip} className="gf-win-columns">
      {columns.map((column) => (
        <div key={column.id} className="gf-win-column">
          <ul
            role="listbox"
            aria-label={column.dir ? `Inside ${column.dir}` : "Folders"}
            aria-multiselectable="true"
          >
            {column.nodes.map((node) => {
              const leadsOn = column.activeId === node.id;
              return (
                <li
                  key={node.id}
                  data-node-id={node.id}
                  data-cursor={props.cursor === node.id ? "true" : undefined}
                  role="option"
                  aria-selected={props.isSelected(node.id) || leadsOn}
                  className="gf-win-column-row"
                  onClick={(event) => {
                    props.onSelect(node, { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey });
                    // A single click walks a column browser forward; that is
                    // the whole point of it.
                    props.onOpen(node);
                  }}
                  onDoubleClick={() => props.onOpen(node)}
                >
                  <NodeGlyph node={node} />
                  <span className="gf-truncate flex-1">{node.name}</span>
                  {node.reviewCount > 0 && (
                    <span className="gf-win-flag flex-none">
                      <ProposalIcon className="h-3 w-3" />
                      {node.reviewCount}
                    </span>
                  )}
                  {node.kind !== "file" && <ChevronRightIcon className="h-3.5 w-3.5 flex-none opacity-60" />}
                </li>
              );
            })}
            {column.nodes.length === 0 && (
              <li className="gf-faint px-3 py-2.5 text-[12.5px]">Nothing in here</li>
            )}
          </ul>
        </div>
      ))}
      {/* Only once there is something to show: an empty pane would take a
          third of the width away from the columns that are the view. */}
      {props.detail && <div className="gf-win-column-detail">{props.detail}</div>}
    </div>
  );
}

/** Where a column click should take you, so the browser can act on it. */
export function columnTarget(node: VfsNode): Location {
  return locationOf(node);
}
