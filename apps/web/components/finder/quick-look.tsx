"use client";

import { useEffect, useRef } from "react";
import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, DownloadIcon, ExpandIcon } from "@/components/icons";
import { FilePreview } from "@/components/file-preview";
import { Skeleton, Notice, problem } from "@/components/ui";
import { useOpenedFile } from "@/components/finder/use-opened-file";
import { formatBytes, previewKindLabel } from "@/lib/preview";
import type { FileNode, VfsNode } from "@/components/finder/types";

/**
 * A look at something without opening it.
 *
 * The space bar is the one file-browser gesture almost everyone knows, and it
 * is the difference between finding the right file in four keystrokes and
 * opening six wrong ones. Arrow keys walk the same listing underneath, so a
 * folder of scans can be gone through without ever leaving it.
 */
export function QuickLook({
  node,
  folderId,
  onClose,
  onStep,
  onOpen,
  onDownload,
}: {
  node: FileNode;
  folderId: string;
  onClose: () => void;
  onStep: (delta: number) => void;
  onOpen: (node: VfsNode) => void;
  onDownload: (node: VfsNode) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<Element | null>(null);
  const { opened, error } = useOpenedFile(folderId, node.file);

  useEffect(() => {
    restoreTo.current = document.activeElement;
    panel.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      (restoreTo.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  function onKey(event: React.KeyboardEvent) {
    if (event.key === "Escape" || event.key === " ") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      onStep(1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      onStep(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(node);
    }
  }

  return (
    <div className="gf-win-glance-scrim" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`A look at ${node.name}`}
        tabIndex={-1}
        className="gf-win-glance"
        onKeyDown={onKey}
      >
        <div className="gf-win-glance-head">
          <button type="button" className="gf-win-tool" aria-label="Previous" onClick={() => onStep(-1)}>
            <ArrowLeftIcon />
          </button>
          <button type="button" className="gf-win-tool" aria-label="Next" onClick={() => onStep(1)}>
            <ArrowRightIcon />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="gf-truncate text-[13.5px] font-bold">{node.name}</p>
            <p className="gf-faint text-[11.5px]">
              {previewKindLabel(node.path)}
              {node.size !== null ? ` · ${formatBytes(node.size)}` : ""}
            </p>
          </div>
          <button type="button" className="gf-win-tool" aria-label="Download a copy" onClick={() => onDownload(node)}>
            <DownloadIcon />
          </button>
          <button type="button" className="gf-win-tool" aria-label="Open it properly" onClick={() => onOpen(node)}>
            <ExpandIcon />
          </button>
          <button type="button" className="gf-win-tool" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="gf-win-glance-body">
          {error ? (
            <div className="p-5">
              <Notice message={problem(error)} />
            </div>
          ) : opened ? (
            <FilePreview file={opened} maxHeight="100%" />
          ) : (
            <div className="p-5">
              <Skeleton className="h-72 w-full rounded-[var(--gf-radius)]" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
