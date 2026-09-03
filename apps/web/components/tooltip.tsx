"use client";

import {
  FloatingDelayGroup,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDelayGroup,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  useTransitionStatus,
  type Placement,
} from "@floating-ui/react";
import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode, type Ref } from "react";
import { Kbd } from "@/components/kbd";

/**
 * The hint that appears when you rest on a control.
 *
 * A row of glyph buttons is only as usable as its hints, and the browser's own
 * `title` arrives a second late, unstyled, and never on a keyboard. This one
 * opens after a short rest, and once one hint in a group is showing its
 * neighbours open at once, the way a desktop toolbar behaves. It shows on
 * focus too, so the keyboard learns the same names the mouse does.
 *
 * Touch never opens it: a finger cannot rest, and a long press would fight
 * scrolling. Controls keep their aria-label, which is what a touch screen
 * reader reads anyway.
 *
 * The child must forward a ref to a DOM element and accept event props;
 * every button and link does.
 */
export function Tooltip({
  label,
  shortcut,
  note,
  placement = "top",
  disabled = false,
  children,
}: {
  label: ReactNode;
  /** Declared Mac-style ("mod+1"); drawn for the person's platform. */
  shortcut?: string;
  /** A quieter second line: why a control is off, or what it will do. */
  note?: ReactNode;
  placement?: Placement;
  /** Keeps the child untouched, for a control that explains itself already. */
  disabled?: boolean;
  children: ReactElement<Record<string, unknown>>;
}) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const { delay, isInstantPhase } = useDelayGroup(context);
  const hover = useHover(context, {
    delay,
    move: false,
    // A tooltip is a hint for a pointer that can rest. A finger cannot.
    mouseOnly: true,
    enabled: !disabled,
  });
  const focus = useFocus(context, { enabled: !disabled, visibleOnly: true });
  const dismiss = useDismiss(context, { referencePress: true });
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  const { isMounted, status } = useTransitionStatus(context, {
    duration: { open: isInstantPhase ? 0 : 120, close: 80 },
  });

  const child = children as ReactElement<Record<string, unknown> & { ref?: Ref<HTMLElement> }>;
  const childRef = isValidElement(child) ? (child.props as { ref?: Ref<HTMLElement> }).ref : undefined;
  const ref = useMergeRefs([refs.setReference, childRef ?? null]);

  if (!isValidElement(child)) return children;

  return (
    <>
      {cloneElement(child, getReferenceProps({ ref, ...child.props }))}
      {isMounted && !disabled && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="gf-tooltip"
            data-status={status}
            data-side={context.placement.split("-")[0]}
            {...getFloatingProps()}
          >
            <span className="gf-tooltip-label">{label}</span>
            {shortcut && <Kbd combo={shortcut} className="gf-tooltip-kbd" />}
            {note && <span className="gf-tooltip-note">{note}</span>}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/**
 * Wrap a row of controls so their hints share one delay: the first waits, the
 * rest arrive as the pointer passes over them, and the wait returns once the
 * pointer has left the row for a moment.
 */
export function TooltipGroup({ children }: { children: ReactNode }) {
  return (
    <FloatingDelayGroup delay={{ open: 450, close: 80 }} timeoutMs={300}>
      {children}
    </FloatingDelayGroup>
  );
}
