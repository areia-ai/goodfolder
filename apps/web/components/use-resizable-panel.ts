"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Edge = "start" | "end";

export function useResizablePanel({
  initial,
  min,
  max,
  edge,
  storageKey,
}: {
  initial: number;
  min: number;
  max: number | (() => number);
  edge: Edge;
  storageKey?: string;
}) {
  const [width, setWidth] = useState(initial);
  const widthRef = useRef(initial);
  widthRef.current = width;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      const stored = saved === null ? NaN : Number(saved);
      if (Number.isFinite(stored)) setWidth(Math.max(min, stored));
    } catch {
      // A panel that does not remember its width still needs to resize.
    }
  }, [min, storageKey]);

  const limit = useCallback((value: number) => {
    const upper = typeof max === "function" ? max() : max;
    return Math.round(Math.max(min, Math.min(Math.max(min, upper), value)));
  }, [max, min]);

  const update = useCallback((next: number) => {
    const value = limit(next);
    setWidth(value);
    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, String(value));
      } catch {
        // Private browsing and blocked storage should not interrupt resizing.
      }
    }
  }, [limit, storageKey]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const cursor = document.body.style.cursor;
    const select = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (move: PointerEvent) => {
      const delta = move.clientX - startX;
      update(startWidth + (edge === "end" ? delta : -delta));
    };
    const onUp = () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = select;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [edge, update]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      update(widthRef.current - (edge === "end" ? 16 : -16));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      update(widthRef.current + (edge === "end" ? 16 : -16));
    } else if (event.key === "Home") {
      event.preventDefault();
      update(min);
    } else if (event.key === "End") {
      event.preventDefault();
      update(typeof max === "function" ? max() : max);
    }
  }, [edge, max, min, update]);

  return { width, onPointerDown, onKeyDown, min, max: typeof max === "function" ? max() : max };
}
