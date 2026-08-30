"use client";

import { Fragment, useEffect, useRef } from "react";
import { ProposalIcon } from "@/components/icons";
import { NodeGlyph } from "@/components/finder/node-glyph";
import { useThumbnail } from "@/components/finder/use-thumbnail";
import { formatBytes } from "@/lib/preview";
import { directoryName } from "@/lib/vfs";
import type { NodeGroup, VfsNode } from "@/components/finder/types";
import type { ClickModifiers } from "@/components/finder/use-selection";

export interface IconsViewProps {
  nodes: VfsNode[];
  groups: NodeGroup[] | null;
  size: number;
  isSelected: (id: string) => boolean;
  cursor: string | null;
  onSelect: (node: VfsNode, modifiers: ClickModifiers) => void;
  onOpen: (node: VfsNode) => void;
  showPath: boolean;
}

export function IconsView(props: IconsViewProps) {
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.cursor) return;
    wrap.current
      ?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(props.cursor)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [props.cursor]);

  const sections = props.groups ?? [{ id: "all", label: "", nodes: props.nodes }];

  return (
    <div ref={wrap} className="p-3">
      {sections.map((section) => (
        <Fragment key={section.id}>
          {section.label && <p className="gf-win-group-label">{section.label}</p>}
          <ul
            role="listbox"
            aria-label={section.label || "Files and folders"}
            aria-multiselectable="true"
            className="gf-win-tiles"
            style={{ "--gf-tile": `${props.size}px` } as React.CSSProperties}
          >
            {section.nodes.map((node) => (
              <Tile
                key={node.id}
                node={node}
                size={props.size}
                selected={props.isSelected(node.id)}
                cursor={props.cursor === node.id}
                onSelect={props.onSelect}
                onOpen={props.onOpen}
                showPath={props.showPath}
              />
            ))}
          </ul>
        </Fragment>
      ))}
    </div>
  );
}

function Tile({
  node, size, selected, cursor, onSelect, onOpen, showPath,
}: {
  node: VfsNode;
  size: number;
  selected: boolean;
  cursor: boolean;
  onSelect: (node: VfsNode, modifiers: ClickModifiers) => void;
  onOpen: (node: VfsNode) => void;
  showPath: boolean;
}) {
  const { ref, url, state } = useThumbnail(node, true);

  return (
    <li
      ref={ref as React.Ref<HTMLLIElement>}
      data-node-id={node.id}
      data-cursor={cursor ? "true" : undefined}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      className="gf-win-tile"
      onClick={(event) => onSelect(node, { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey })}
      onDoubleClick={() => onOpen(node)}
    >
      <span className="gf-win-tile-art" style={{ height: `${Math.round(size * 0.72)}px` }}>
        {url ? (
          <img src={url} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={`gf-win-tile-glyph ${state === "waiting" ? "gf-skeleton" : ""}`}>
            <NodeGlyph node={node} />
          </span>
        )}
        {node.reviewCount > 0 && (
          <span className="gf-win-tile-flag">
            <ProposalIcon className="h-3 w-3" />
            {node.reviewCount}
            <span className="sr-only"> waiting for review</span>
          </span>
        )}
      </span>
      <span className="gf-win-tile-name" title={node.name}>{node.name}</span>
      <span className="gf-win-tile-meta">
        {showPath && node.kind !== "folder" && directoryName(node.path)
          ? `in ${directoryName(node.path)}`
          : node.kind === "directory"
            ? `${node.fileCount} ${node.fileCount === 1 ? "file" : "files"}`
            : node.size === null
              ? ""
              : formatBytes(node.size)}
      </span>
    </li>
  );
}
