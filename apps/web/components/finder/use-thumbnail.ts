"use client";

import { useEffect, useRef, useState } from "react";
import { cachedThumbnail, canHaveThumbnail, loadThumbnail, type ThumbnailState } from "@/lib/thumbnails";
import type { VfsNode } from "@/lib/vfs";

/**
 * A picture for one tile, read only once the tile is nearly on screen.
 *
 * Attach the returned ref to the tile. Scrolling past a thousand of them
 * reads only the ones that came near, and the module behind this holds
 * everything else down.
 */
export function useThumbnail(node: VfsNode, enabled: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  const eligible =
    enabled && node.kind === "file" && canHaveThumbnail(node.path, node.size ?? 0);
  const key = node.kind === "file" ? `${node.folderId} ${node.path}` : "";

  const [url, setUrl] = useState<string | null>(() =>
    node.kind === "file" ? cachedThumbnail(node.folderId, node.path) : null,
  );
  const [state, setState] = useState<ThumbnailState>(() => (url ? "ready" : "none"));

  useEffect(() => {
    if (node.kind !== "file") return;
    const known = cachedThumbnail(node.folderId, node.path);
    setUrl(known);
    setState(known ? "ready" : "none");
  }, [key, node]);

  useEffect(() => {
    const element = ref.current;
    if (!eligible || !element || url || node.kind !== "file") return;

    let cancelled = false;
    const start = () => {
      setState("waiting");
      void loadThumbnail(node.folderId, node.path).then((result) => {
        if (cancelled) return;
        setUrl(result);
        setState(result ? "ready" : "failed");
      });
    };

    if (typeof IntersectionObserver === "undefined") {
      start();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        start();
      },
      // A screen's worth of margin, so a tile is drawn by the time it arrives
      // rather than a moment after.
      { rootMargin: "600px" },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [eligible, url, key, node]);

  return { ref, url, state, eligible };
}
