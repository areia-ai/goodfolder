"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

/**
 * Draw only the rows that are near the screen.
 *
 * A folder can hold a thousand files, and the transport will hand over every
 * one of them in a single answer. Measured with all of them drawn, moving the
 * keyboard selection one row cost about 35ms — every row in the folder is
 * asked to re-render to move one highlight, and the result is a list that
 * visibly lags the arrow key. Below the threshold nothing here runs at all,
 * because a short listing is cheaper drawn whole than measured.
 */
export const WINDOW_THRESHOLD = 150;

/** Rows above and below the opening, so scrolling does not chase the draw. */
const OVERSCAN = 12;

export interface WindowSlice {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
  /** Where an item sits from the top of the listing, for scrolling to it. */
  offsetOf: (index: number) => number;
  active: boolean;
}

export function useWindowSlice(
  scroller: RefObject<HTMLElement | null>,
  heights: number[],
  enabled: boolean,
): WindowSlice {
  const [view, setView] = useState({ top: 0, height: 0 });
  const frame = useRef(0);

  const offsets = useMemo(() => {
    const out = new Array<number>(heights.length + 1);
    out[0] = 0;
    for (let i = 0; i < heights.length; i += 1) out[i + 1] = out[i]! + (heights[i] ?? 0);
    return out;
  }, [heights]);

  const measure = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    setView((current) =>
      current.top === element.scrollTop && current.height === element.clientHeight
        ? current
        : { top: element.scrollTop, height: element.clientHeight },
    );
  }, [scroller]);

  useEffect(() => {
    const element = scroller.current;
    if (!element || !enabled) return;
    measure();
    const onScroll = () => {
      // One read per frame: a scroll fires far more often than anything can
      // usefully be redrawn.
      if (frame.current) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = 0;
        measure();
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (frame.current) window.cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [scroller, enabled, measure]);

  const offsetOf = useCallback((index: number) => offsets[Math.max(0, Math.min(index, heights.length))] ?? 0, [offsets, heights.length]);

  if (!enabled || view.height === 0) {
    return { start: 0, end: heights.length, padTop: 0, padBottom: 0, offsetOf, active: false };
  }

  const total = offsets[heights.length] ?? 0;
  let start = 0;
  while (start < heights.length && offsets[start + 1]! < view.top) start += 1;
  start = Math.max(0, start - OVERSCAN);

  let end = start;
  const bottom = view.top + view.height;
  while (end < heights.length && offsets[end]! < bottom) end += 1;
  end = Math.min(heights.length, end + OVERSCAN);

  return {
    start,
    end,
    padTop: offsets[start] ?? 0,
    padBottom: Math.max(0, total - (offsets[end] ?? total)),
    offsetOf,
    active: true,
  };
}
