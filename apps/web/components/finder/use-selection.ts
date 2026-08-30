"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VfsNode } from "@/lib/vfs";

export interface ClickModifiers {
  /** Shift extends from the last thing clicked. */
  shift?: boolean;
  /** Command on a Mac, Control elsewhere: add or remove one. */
  toggle?: boolean;
}

export interface Selection {
  /** Node ids, in no particular order. */
  ids: ReadonlySet<string>;
  /** Where the keyboard is, which is not always what is selected. */
  cursor: string | null;
  nodes: VfsNode[];
  select: (id: string, modifiers?: ClickModifiers) => void;
  selectOnly: (id: string | null) => void;
  selectAll: () => void;
  clear: () => void;
  /** Move the cursor by rows, taking the selection with it. */
  move: (delta: number, extend?: boolean) => VfsNode | null;
  /** Jump to the first name starting with what was typed. */
  typeAhead: (prefix: string) => VfsNode | null;
  isSelected: (id: string) => boolean;
}

/**
 * What is picked out in a listing.
 *
 * Multiple things can be selected even though most of what you could do to
 * several at once does not exist here. The selection is what the panel on the
 * right is describing, and "3 items, 12.4 MB" is worth being able to ask for.
 */
export function useSelection(ordered: VfsNode[], resetKey: string): Selection {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);

  useEffect(() => {
    setIds(new Set());
    setCursor(null);
    anchor.current = null;
  }, [resetKey]);

  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;

  const indexOf = useCallback(
    (id: string | null) => (id === null ? -1 : orderedRef.current.findIndex((node) => node.id === id)),
    [],
  );

  const select = useCallback(
    (id: string, modifiers: ClickModifiers = {}) => {
      const list = orderedRef.current;
      if (modifiers.shift && anchor.current) {
        const from = indexOf(anchor.current);
        const to = indexOf(id);
        if (from >= 0 && to >= 0) {
          const [low, high] = from <= to ? [from, to] : [to, from];
          setIds(new Set(list.slice(low, high + 1).map((node) => node.id)));
          setCursor(id);
          return;
        }
      }
      if (modifiers.toggle) {
        setIds((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        anchor.current = id;
        setCursor(id);
        return;
      }
      setIds(new Set([id]));
      anchor.current = id;
      setCursor(id);
    },
    [indexOf],
  );

  const selectOnly = useCallback((id: string | null) => {
    setIds(id ? new Set([id]) : new Set());
    anchor.current = id;
    setCursor(id);
  }, []);

  const selectAll = useCallback(() => {
    const list = orderedRef.current;
    setIds(new Set(list.map((node) => node.id)));
    anchor.current = list[0]?.id ?? null;
    setCursor(list[list.length - 1]?.id ?? null);
  }, []);

  const clear = useCallback(() => {
    setIds(new Set());
    anchor.current = null;
    setCursor(null);
  }, []);

  const move = useCallback(
    (delta: number, extend = false) => {
      const list = orderedRef.current;
      if (list.length === 0) return null;
      const at = indexOf(cursor);
      const next = at < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, at + delta));
      const node = list[next]!;
      if (extend) select(node.id, { shift: true });
      else selectOnly(node.id);
      return node;
    },
    [cursor, indexOf, select, selectOnly],
  );

  const typeAhead = useCallback(
    (prefix: string) => {
      const needle = prefix.toLowerCase();
      if (!needle) return null;
      const list = orderedRef.current;
      const at = indexOf(cursor);
      // Start just past the cursor so typing the same letter walks through
      // every name that begins with it, as a file list is expected to.
      const rotated = [...list.slice(at + 1), ...list.slice(0, at + 1)];
      const found = rotated.find((node) => node.name.toLowerCase().startsWith(needle))
        ?? list.find((node) => node.name.toLowerCase().startsWith(needle));
      if (found) selectOnly(found.id);
      return found ?? null;
    },
    [cursor, indexOf, selectOnly],
  );

  const nodes = useMemo(() => ordered.filter((node) => ids.has(node.id)), [ordered, ids]);
  const isSelected = useCallback((id: string) => ids.has(id), [ids]);

  return { ids, cursor, nodes, select, selectOnly, selectAll, clear, move, typeAhead, isSelected };
}
