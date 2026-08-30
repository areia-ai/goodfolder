"use client";

import { useEffect, useRef } from "react";
import { ProposalIcon } from "@/components/icons";
import { NodeGlyph } from "@/components/finder/node-glyph";
import { useThumbnail } from "@/components/finder/use-thumbnail";
import { formatBytes, previewKindLabel } from "@/lib/preview";
import type { VfsNode } from "@/components/finder/types";
import type { ClickModifiers } from "@/components/finder/use-selection";

export interface GalleryViewProps {
  nodes: VfsNode[];
  focused: VfsNode | null;
  isSelected: (id: string) => boolean;
  cursor: string | null;
  onSelect: (node: VfsNode, modifiers: ClickModifiers) => void;
  onOpen: (node: VfsNode) => void;
  /** The real viewer for whatever is focused, when there is one. */
  detail: React.ReactNode;
}

/**
 * One thing large, everything else along the bottom.
 *
 * For a folder of photographs or scans, a list of names is the wrong shape —
 * you are looking for the picture, and you know it when you see it.
 */
export function GalleryView(props: GalleryViewProps) {
  const strip = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!props.cursor) return;
    strip.current
      ?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(props.cursor)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [props.cursor]);

  return (
    <div className="gf-win-gallery">
      <div className="gf-win-gallery-stage">
        {props.focused ? (
          props.detail
        ) : (
          <div className="gf-win-empty">
            <div>
              <p className="text-[15px] font-semibold">Choose something to look at</p>
              <p>Pick anything below and it fills this space.</p>
            </div>
          </div>
        )}
      </div>

      <div className="gf-win-gallery-foot">
        {props.focused && (
          <p className="gf-win-gallery-caption">
            <b>{props.focused.name}</b>
            <span className="gf-faint">
              {props.focused.kind === "file" ? ` · ${previewKindLabel(props.focused.path)}` : ""}
              {props.focused.size !== null ? ` · ${formatBytes(props.focused.size)}` : ""}
            </span>
          </p>
        )}
        <ul ref={strip} role="listbox" aria-label="Everything here" className="gf-win-filmstrip">
          {props.nodes.map((node) => (
            <Frame
              key={node.id}
              node={node}
              selected={props.isSelected(node.id)}
              cursor={props.cursor === node.id}
              onSelect={props.onSelect}
              onOpen={props.onOpen}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function Frame({
  node, selected, cursor, onSelect, onOpen,
}: {
  node: VfsNode;
  selected: boolean;
  cursor: boolean;
  onSelect: (node: VfsNode, modifiers: ClickModifiers) => void;
  onOpen: (node: VfsNode) => void;
}) {
  const { ref, url } = useThumbnail(node, true);
  return (
    <li
      ref={ref as React.Ref<HTMLLIElement>}
      data-node-id={node.id}
      data-cursor={cursor ? "true" : undefined}
      role="option"
      aria-selected={selected}
      className="gf-win-frame"
      title={node.name}
      onClick={(event) => onSelect(node, { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey })}
      onDoubleClick={() => onOpen(node)}
    >
      <span className="gf-win-frame-art">
        {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <NodeGlyph node={node} />}
        {node.reviewCount > 0 && (
          <span className="gf-win-tile-flag">
            <ProposalIcon className="h-3 w-3" />
            {node.reviewCount}
          </span>
        )}
      </span>
      <span className="gf-win-frame-name">{node.name}</span>
    </li>
  );
}
