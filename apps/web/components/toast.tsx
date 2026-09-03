"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertIcon, CheckCircleIcon, CloseIcon, InfoIcon } from "@/components/icons";
import type { NoticeMessage } from "@/components/ui";

/**
 * A short-lived line at the foot of the window for something that just
 * happened.
 *
 * What used to sit inline at the top of the listing pushed the files down
 * and then pulled them back up when it left; a toast floats instead, so the
 * listing never moves. A result ("Done", "Note") waits six seconds, pauses
 * while the pointer rests on it, and shows how long is left in the bar along
 * its foot. A problem stays until it is dismissed — nobody should have to
 * chase the one message that tells them something failed.
 */

const AUTO_DISMISS_MS = 6000;
const EXIT_MS = 140;

const LABEL: Record<NoticeMessage["kind"], string> = {
  info: "Note",
  done: "Done",
  problem: "Something went wrong",
};

const GLYPH: Record<NoticeMessage["kind"], (p: { className?: string }) => ReactNode> = {
  info: (p) => <InfoIcon {...p} />,
  done: (p) => <CheckCircleIcon {...p} />,
  problem: (p) => <AlertIcon {...p} />,
};

/** Where toasts live: bottom right on a desktop, full width on a phone. */
export function Toasts({ children }: { children: ReactNode }) {
  return <div className="gf-toasts">{children}</div>;
}

export function Toast({ message, onClose }: { message: NoticeMessage; onClose: () => void }) {
  const element = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const [status, setStatus] = useState<"initial" | "open" | "close">("initial");
  const [life, setLife] = useState(1);
  const sticky = message.kind === "problem";

  function close() {
    if (closing.current) return;
    closing.current = true;
    setStatus("close");
    window.setTimeout(onClose, EXIT_MS);
  }
  const closeRef = useRef(close);
  closeRef.current = close;

  // Arrive on the next frame, so the enter transition has something to run from.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setStatus("open"));
    return () => cancelAnimationFrame(frame);
  }, []);

  // The countdown for a result toast; a problem has none.
  useEffect(() => {
    if (sticky || status !== "open") return;
    let remaining = AUTO_DISMISS_MS;
    let last = performance.now();
    let paused = false;
    const node = element.current;
    const pause = () => {
      paused = true;
    };
    const resume = () => {
      paused = false;
      last = performance.now();
    };
    node?.addEventListener("pointerenter", pause);
    node?.addEventListener("pointerleave", resume);
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (!paused) remaining -= now - last;
      last = now;
      setLife(Math.max(0, remaining / AUTO_DISMISS_MS));
      if (remaining <= 0) {
        window.clearInterval(timer);
        closeRef.current();
      }
    }, 100);
    return () => {
      window.clearInterval(timer);
      node?.removeEventListener("pointerenter", pause);
      node?.removeEventListener("pointerleave", resume);
    };
  }, [sticky, status]);

  return (
    <div
      ref={element}
      role={message.kind === "problem" ? "alert" : "status"}
      className={`gf-toast ${sticky ? "gf-toast-problem" : "gf-toast-progress"}`}
      data-status={status}
    >
      {GLYPH[message.kind]({})}
      <span className="gf-toast-body">
        <b>{LABEL[message.kind]}.</b> {message.text}
      </span>
      <button type="button" className="gf-toast-close" aria-label="Dismiss" onClick={close}>
        <CloseIcon />
      </button>
      {!sticky && (
        <span className="gf-toast-bar" aria-hidden="true">
          <span style={{ width: `${life * 100}%` }} />
        </span>
      )}
    </div>
  );
}

/** Work in progress, with the bar showing how far along it is. Stays until the work ends. */
export function ProgressToast({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div role="status" className="gf-toast gf-toast-progress">
      <InfoIcon />
      <span className="gf-toast-body">
        {label}
        {total <= 1 ? "" : ` — ${done + 1} of ${total}`}…
      </span>
      <span className="gf-toast-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (done / Math.max(1, total)) * 100)}%` }} />
      </span>
    </div>
  );
}
