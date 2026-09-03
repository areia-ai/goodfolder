"use client";

import { useEffect, useState } from "react";

/**
 * A keyboard shortcut, written the way the person's own keyboard writes it.
 *
 * Shortcuts are declared once in Mac spelling ("mod+shift+n", "mod+1", "?",
 * "space") and drawn as ⌘ ⇧ N on a Mac or Ctrl Shift N elsewhere. The first
 * render, before we know the platform, is the Mac spelling: on a static export
 * there is no request to read a user agent from, and this is the cheaper
 * mistake to correct.
 */

const MAC_GLYPH: Record<string, string> = {
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
  ctrl: "⌃",
  enter: "↵",
  backspace: "⌫",
  delete: "⌦",
  escape: "esc",
  space: "space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  tab: "⇥",
};

const OTHER_GLYPH: Record<string, string> = {
  mod: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  ctrl: "Ctrl",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Del",
  escape: "Esc",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  tab: "Tab",
};

let cachedMac: boolean | null = null;

export function isMacPlatform(): boolean {
  if (cachedMac !== null) return cachedMac;
  if (typeof navigator === "undefined") return true;
  const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";
  cachedMac = /mac|iphone|ipad|ipod/i.test(platform);
  return cachedMac;
}

export function useIsMac(): boolean {
  const [mac, setMac] = useState(true);
  useEffect(() => setMac(isMacPlatform()), []);
  return mac;
}

/** "mod+shift+n" → ["⌘", "⇧", "N"] on a Mac, ["Ctrl", "Shift", "N"] elsewhere. */
export function shortcutParts(combo: string, mac: boolean): string[] {
  const table = mac ? MAC_GLYPH : OTHER_GLYPH;
  return combo
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => table[part] ?? (part.length === 1 ? part.toUpperCase() : part));
}

/** "mod+shift+n" → "⌘⇧N" or "Ctrl+Shift+N", for aria-keyshortcuts and plain text. */
export function shortcutText(combo: string, mac: boolean): string {
  const parts = shortcutParts(combo, mac);
  return mac ? parts.join("") : parts.join("+");
}

export function Kbd({ combo, className = "" }: { combo: string; className?: string }) {
  const mac = useIsMac();
  const parts = shortcutParts(combo, mac);
  return (
    <kbd className={`gf-kbd ${className}`} aria-label={shortcutText(combo, mac)}>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>{part}</span>
      ))}
    </kbd>
  );
}
