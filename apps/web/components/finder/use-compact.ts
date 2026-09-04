"use client";

import { useEffect, useState } from "react";

/** Below this the window is one column and one way of showing things. */
export const COMPACT_WIDTH = 768;

/**
 * Whether the window is on a phone-sized screen.
 *
 * The export has no request to read a width from, so the first paint is
 * always the desktop layout and it corrects on hydration — the same trade
 * `Kbd` makes for its shortcut glyphs. Everything this decides is layout, so
 * a phone briefly measuring itself as a desktop costs a frame and nothing
 * else; no state is stored or thrown away when it flips.
 */
export function useCompact(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${COMPACT_WIDTH - 1}px)`);
    const read = () => setCompact(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);
  return compact;
}
