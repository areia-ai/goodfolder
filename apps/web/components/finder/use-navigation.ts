"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ROOT_LOCATION, locationHref, parseLocation, sameLocation, type Location } from "@/lib/vfs";

/**
 * Where the window is, and how Back gets you out of it.
 *
 * The dashboard used to rewrite the address in place on every move, which
 * meant the browser's own Back button left the product instead of stepping
 * back through it. Every move is now a real history entry, and the toolbar's
 * arrows are the browser's own.
 *
 * Each entry carries a number so the window can tell whether there is
 * anywhere to go. Nothing else exposes that, and a Back arrow that is always
 * lit and sometimes does nothing is worse than one that dims.
 */
interface Marked {
  gfIndex?: number;
}

export interface Navigation {
  location: Location;
  /** Move to a place, adding a history entry. */
  go: (next: Location) => void;
  /** Change the address without adding an entry — for tidying, not moving. */
  replace: (next: Location) => void;
  back: () => void;
  forward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}

function readIndex(): number {
  const state = (typeof history === "undefined" ? null : history.state) as Marked | null;
  const value = Number(state?.gfIndex);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function useNavigation(): Navigation {
  // The address is only readable in the browser, and this page is exported as
  // static files — so the first render is always the root, and the effect
  // below corrects it before anything is loaded.
  const [location, setLocation] = useState<Location>(ROOT_LOCATION);
  const [depth, setDepth] = useState({ index: 0, max: 0 });

  const locationRef = useRef(location);
  locationRef.current = location;
  const depthRef = useRef(depth);
  const commitDepth = useCallback((next: { index: number; max: number }) => {
    depthRef.current = next;
    setDepth(next);
  }, []);

  useEffect(() => {
    const index = readIndex();
    history.replaceState({ ...(history.state as object), gfIndex: index }, "", window.location.href);
    commitDepth({ index, max: index });
    setLocation(parseLocation(window.location.search));

    function onPop() {
      const at = readIndex();
      commitDepth({ index: at, max: Math.max(depthRef.current.max, at) });
      setLocation(parseLocation(window.location.search));
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [commitDepth]);

  const go = useCallback(
    (next: Location) => {
      if (sameLocation(locationRef.current, next)) return;
      const index = depthRef.current.index + 1;
      history.pushState({ gfIndex: index }, "", locationHref(next));
      commitDepth({ index, max: index });
      setLocation(next);
    },
    [commitDepth],
  );

  const replace = useCallback((next: Location) => {
    history.replaceState({ ...(history.state as object) }, "", locationHref(next));
    setLocation(next);
  }, []);

  const back = useCallback(() => history.back(), []);
  const forward = useCallback(() => history.forward(), []);

  return {
    location,
    go,
    replace,
    back,
    forward,
    // Only inside the window. Stepping out of the product is what the
    // browser's own Back is for, and it still does exactly that.
    canGoBack: depth.index > 0,
    canGoForward: depth.index < depth.max,
  };
}
