"use client";

import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";

/**
 * A question the window asks before it does something.
 *
 * Built on the browser's own <dialog>, which brings what a hand-rolled card
 * never quite did: the keyboard cannot leave it, the page behind it is inert,
 * Escape closes it, and focus returns to wherever it was. The card and the
 * backdrop fade in and out from globals.css.
 *
 * Content is a form when `onSubmit` is given, so Enter in a field submits and
 * the primary button can be `type="submit"`.
 */
export function Dialog({
  open,
  onClose,
  onSubmit,
  title,
  description,
  children,
  actions,
  width = "24rem",
  /** Which element takes the keyboard when the dialog opens; the dialog itself if none. */
  initialFocus,
  /** While true, neither Escape nor the backdrop closes it. */
  busy = false,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  width?: string;
  initialFocus?: React.RefObject<HTMLElement | null>;
  busy?: boolean;
  labelledBy?: string;
}) {
  const element = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const dialog = element.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const target = initialFocus?.current;
      if (target) target.focus();
      else dialog.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocus]);

  // The browser fires `cancel` for Escape; we decide whether to honour it.
  useEffect(() => {
    const dialog = element.current;
    if (!dialog) return;
    function onCancel(event: Event) {
      event.preventDefault();
      if (!busyRef.current) onClose();
    }
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [onClose]);

  const body = (
    <>
      <h2 id={labelledBy ?? titleId} className="gf-dialog-title">{title}</h2>
      {description && <p id={descriptionId} className="gf-dialog-body">{description}</p>}
      {children}
      {actions && <div className="gf-dialog-actions">{actions}</div>}
    </>
  );

  return (
    <dialog
      ref={element}
      className="gf-dialog"
      style={{ ["--gf-dialog-width" as string]: width }}
      aria-labelledby={labelledBy ?? titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself; a click
        // on anything inside lands on that thing.
        if (event.target === event.currentTarget && !busyRef.current) onClose();
      }}
    >
      {onSubmit ? (
        <form className="gf-dialog-inner" method="dialog" onSubmit={(event) => { event.preventDefault(); onSubmit(event); }}>{body}</form>
      ) : (
        <div className="gf-dialog-inner">{body}</div>
      )}
    </dialog>
  );
}
