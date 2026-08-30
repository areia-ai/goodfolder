"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CheckIcon } from "@/components/icons";

export interface MenuItem {
  id: string;
  label: string;
  onSelect?: () => void;
  /** Draws a tick, and tells a screen reader this is a choice among several. */
  checked?: boolean;
  disabled?: boolean;
  /** A quiet line above this item, for grouping. */
  dividerBefore?: boolean;
  /** Explains why an item cannot be used, in place of doing nothing silently. */
  note?: string;
}

/**
 * One dropdown for the whole window: sort, group, actions, the account.
 *
 * Escape closes it and returns focus to the control that opened it, a click
 * anywhere else closes it, and the arrow keys walk the items — the three
 * things a menu has to do that a bare list of buttons does not.
 */
export function Menu({
  label,
  trigger,
  items,
  align = "right",
  /** Upwards for a control at the foot of a panel, where down goes off-screen. */
  direction = "down",
  className = "gf-win-tool",
}: {
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  direction?: "down" | "up";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const options = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
      if (options.length === 0) return;
      event.preventDefault();
      const at = options.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      options[(at + step + options.length) % options.length]?.focus();
    }
    function onPointer(event: MouseEvent) {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative flex-none">
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={list}
          id={menuId}
          role="menu"
          aria-label={label}
          className={`gf-menu ${direction === "up" ? "gf-menu-up" : ""}`}
          style={align === "left" ? { right: "auto", left: 0 } : undefined}
        >
          {items.map((item) => (
            <div key={item.id}>
              {item.dividerBefore && <div className="my-1 border-t border-[var(--gf-line)]" />}
              <button
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked}
                disabled={item.disabled}
                className="gf-menu-item flex items-center gap-2 disabled:cursor-default disabled:opacity-45"
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                <CheckIcon className={`h-3.5 w-3.5 shrink-0 ${item.checked ? "" : "invisible"}`} />
                <span className="min-w-0 flex-1">
                  {item.label}
                  {item.note && <small className="gf-faint mt-0.5 block text-[11.5px] leading-snug">{item.note}</small>}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
