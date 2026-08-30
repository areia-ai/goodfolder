"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckIcon } from "@/components/icons";
import type { MenuItem } from "@/components/finder/menu";

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/**
 * The menu under the right mouse button.
 *
 * It is also where the window is honest about itself. Somewhere on the way
 * from a list of cards to something shaped like a file browser, this became
 * the place people will reach for Rename, Move and Delete — none of which
 * GoodFolder can do from here, because a folder's files live on a computer
 * and arrive by Save. Those entries are present and say so, rather than being
 * absent (so you wonder) or present and broken (so you find out the hard way).
 */
export function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x: state.x, y: state.y });

  // Nudge back inside the window when opened near an edge.
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    setAt({
      x: Math.max(6, Math.min(state.x, window.innerWidth - box.width - 6)),
      y: Math.max(6, Math.min(state.y, window.innerHeight - box.height - 6)),
    });
  }, [state.x, state.y]);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const options = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
      if (options.length === 0) return;
      event.preventDefault();
      const index = options.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      options[(index + step + options.length) % options.length]?.focus();
    }
    function onPointer(event: MouseEvent) {
      if (panel.current && !panel.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={panel}
      role="menu"
      aria-label="What you can do with this"
      className="gf-menu gf-menu-context"
      style={{ left: at.x, top: at.y }}
    >
      {state.items.map((item) => (
        <div key={item.id}>
          {item.dividerBefore && <div className="my-1 border-t border-[var(--gf-line)]" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className="gf-menu-item flex items-start gap-2 disabled:cursor-default disabled:opacity-100"
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
          >
            <CheckIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${item.checked ? "" : "invisible"}`} />
            <span className="min-w-0 flex-1">
              <span className={item.disabled ? "gf-faint" : ""}>{item.label}</span>
              {item.note && (
                <small className="gf-faint mt-0.5 block text-[11.5px] leading-snug">{item.note}</small>
              )}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
