"use client";

import {
  FloatingFocusManager,
  FloatingList,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListItem,
  useListNavigation,
  useRole,
  useTransitionStatus,
  useTypeahead,
  type Placement,
} from "@floating-ui/react";
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckIcon } from "@/components/icons";
import { Kbd, isMacPlatform, shortcutText } from "@/components/kbd";
import { Tooltip } from "@/components/tooltip";

export interface MenuItem {
  id: string;
  label: string;
  onSelect?: () => void;
  /** Draws a tick, and tells a screen reader this is a choice among several. */
  checked?: boolean;
  disabled?: boolean;
  /** A quiet line above this item, for grouping. */
  dividerBefore?: boolean;
  /** A small caps heading above this item, naming the group it starts. */
  heading?: string;
  /** Explains why an item cannot be used, in place of doing nothing silently. */
  note?: string;
  /** Declared Mac-style ("mod+shift+n"); drawn for the person's platform. */
  shortcut?: string;
  icon?: ReactNode;
}

interface MenuContextValue {
  activeIndex: number | null;
  getItemProps: (props?: Record<string, unknown>) => Record<string, unknown>;
  close: () => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

/**
 * The list itself, shared by the dropdown and the menu under the right mouse
 * button. Arrow keys walk it, typing jumps to a label, Escape and a click
 * elsewhere close it, and focus goes back where it came from.
 */
function MenuList({ items, label, id }: { items: MenuItem[]; label: string; id: string }) {
  return (
    <div id={id} role="menu" aria-label={label} className="gf-menu-list">
      {items.map((item) => (
        <MenuEntry key={item.id} item={item} />
      ))}
    </div>
  );
}

function MenuEntry({ item }: { item: MenuItem }) {
  const context = useContext(MenuContext)!;
  const { ref, index } = useListItem({ label: item.disabled ? null : item.label });
  const active = context.activeIndex === index;
  const mac = isMacPlatform();

  return (
    <>
      {item.heading && <p className="gf-menu-heading">{item.heading}</p>}
      {item.dividerBefore && !item.heading && <div className="gf-menu-divider" role="separator" />}
      <button
        ref={ref}
        type="button"
        role={item.checked === undefined ? "menuitem" : "menuitemradio"}
        aria-checked={item.checked}
        aria-keyshortcuts={item.shortcut ? shortcutText(item.shortcut, mac) : undefined}
        disabled={item.disabled}
        tabIndex={active ? 0 : -1}
        data-active={active || undefined}
        className="gf-menu-item"
        {...context.getItemProps({
          onClick() {
            if (item.disabled) return;
            context.close();
            item.onSelect?.();
          },
        })}
      >
        {item.checked !== undefined ? (
          <CheckIcon className={item.checked ? "" : "invisible"} />
        ) : item.icon ? (
          item.icon
        ) : null}
        <span className="gf-menu-item-body">
          <span className="gf-menu-item-label">{item.label}</span>
          {item.note && <span className="gf-menu-item-note">{item.note}</span>}
        </span>
        {item.shortcut && (
          <span className="gf-menu-item-end">
            <Kbd combo={item.shortcut} />
          </span>
        )}
      </button>
    </>
  );
}

/** Shared behaviour for anything that shows a MenuList. */
function useMenuBehaviour({
  open,
  setOpen,
  placement,
  virtualPoint,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  placement: Placement;
  virtualPoint?: { x: number; y: number } | null;
}) {
  const elements = useRef<Array<HTMLElement | null>>([]);
  const labels = useRef<Array<string | null>>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const floating = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(virtualPoint ? 2 : 4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements: floatingElements }) {
          floatingElements.floating.style.maxHeight = `${Math.max(160, availableHeight)}px`;
          floatingElements.floating.style.overflowY = "auto";
        },
      }),
    ],
  });

  const click = useClick(floating.context, { enabled: !virtualPoint });
  const dismiss = useDismiss(floating.context);
  const role = useRole(floating.context, { role: "menu" });
  const navigation = useListNavigation(floating.context, {
    listRef: elements,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
    focusItemOnOpen: true,
  });
  const typeahead = useTypeahead(floating.context, {
    listRef: labels,
    activeIndex,
    onMatch: setActiveIndex,
    enabled: open,
  });

  const interactions = useInteractions([click, dismiss, role, navigation, typeahead]);
  const transition = useTransitionStatus(floating.context, { duration: { open: 180, close: 140 } });

  const side = floating.context.placement.split("-")[0];
  const align = floating.context.placement.split("-")[1] ?? "center";
  const origin = side === "top"
    ? `bottom ${align === "start" ? "left" : align === "end" ? "right" : "center"}`
    : side === "bottom"
      ? `top ${align === "start" ? "left" : align === "end" ? "right" : "center"}`
      : side === "left" ? "right center" : "left center";

  return { floating, elements, labels, activeIndex, interactions, transition, origin };
}

/**
 * One dropdown for the whole window: sort, group, actions, the account.
 *
 * Escape closes it and returns focus to the control that opened it, a click
 * anywhere else closes it, the arrow keys walk the items, and typing a letter
 * jumps to the first item that starts with it.
 */
export function Menu({
  label,
  trigger,
  items,
  align = "right",
  /** Upwards for a control at the foot of a panel, where down goes off-screen. */
  direction = "down",
  className = "gf-win-tool",
  /** Shows the label as a hint when the pointer rests on the trigger. */
  tooltip = false,
  /** Passed through to the trigger. */
  triggerProps,
}: {
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  direction?: "down" | "up";
  className?: string;
  tooltip?: boolean;
  triggerProps?: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const placement: Placement = `${direction === "up" ? "top" : "bottom"}-${align === "left" ? "start" : "end"}`;
  const { floating, elements, labels, activeIndex, interactions, transition, origin } = useMenuBehaviour({
    open,
    setOpen,
    placement,
  });

  const close = useCallback(() => setOpen(false), []);
  const value = useMemo<MenuContextValue>(
    () => ({ activeIndex, getItemProps: interactions.getItemProps, close }),
    [activeIndex, interactions.getItemProps, close],
  );

  const triggerButton = (
    <button
      ref={floating.refs.setReference}
      type="button"
      className={className}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      {...interactions.getReferenceProps(triggerProps)}
    >
      {trigger}
    </button>
  );

  return (
    <>
      {tooltip ? (
        <Tooltip label={label} placement={direction === "up" ? "top" : "bottom"}>
          {triggerButton}
        </Tooltip>
      ) : (
        triggerButton
      )}
      {transition.isMounted && (
        <FloatingPortal>
          <FloatingFocusManager context={floating.context} modal={false} returnFocus>
            <div
              ref={floating.refs.setFloating}
              style={{ ...floating.floatingStyles, ["--gf-float-origin" as string]: origin }}
              className="gf-menu gf-float-enter"
              data-status={transition.status}
              {...interactions.getFloatingProps()}
            >
              <MenuContext.Provider value={value}>
                <FloatingList elementsRef={elements} labelsRef={labels}>
                  <MenuList items={items} label={label} id={menuId} />
                </FloatingList>
              </MenuContext.Provider>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

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
 * the place people will reach for Rename, Move and Delete, none of which
 * GoodFolder can do from here, because a folder's files live on a computer
 * and arrive by Save. Those entries are present and say so, rather than being
 * absent (so you wonder) or present and broken (so you find out the hard way).
 */
export function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const menuId = useId();
  const setOpenAndClose = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) onClose();
  }, [onClose]);

  const { floating, elements, labels, activeIndex, interactions, transition, origin } = useMenuBehaviour({
    open,
    setOpen: setOpenAndClose,
    placement: "bottom-start",
    virtualPoint: state,
  });

  // Anchor to the pointer rather than an element. Re-set when the point moves
  // so a second right-click somewhere else moves the menu with it.
  const anchorKey = `${state.x}:${state.y}`;
  const lastAnchor = useRef("");
  if (lastAnchor.current !== anchorKey) {
    lastAnchor.current = anchorKey;
    floating.refs.setPositionReference({
      getBoundingClientRect: () => ({
        x: state.x, y: state.y, width: 0, height: 0,
        top: state.y, left: state.x, right: state.x, bottom: state.y,
      }),
    });
  }

  const close = useCallback(() => setOpenAndClose(false), [setOpenAndClose]);
  const value = useMemo<MenuContextValue>(
    () => ({ activeIndex, getItemProps: interactions.getItemProps, close }),
    [activeIndex, interactions.getItemProps, close],
  );

  if (!transition.isMounted) return null;

  return (
    <FloatingPortal>
      <FloatingFocusManager context={floating.context} modal={false} returnFocus initialFocus={-1}>
        <div
          ref={floating.refs.setFloating}
          style={{ ...floating.floatingStyles, ["--gf-float-origin" as string]: origin }}
          className="gf-menu gf-menu-context gf-float-enter"
          data-status={transition.status}
          {...interactions.getFloatingProps()}
        >
          <MenuContext.Provider value={value}>
            <FloatingList elementsRef={elements} labelsRef={labels}>
              <MenuList items={state.items} label="What you can do with this" id={menuId} />
            </FloatingList>
          </MenuContext.Provider>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
