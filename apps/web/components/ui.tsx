import type { ReactNode } from "react";
import {
  AlertIcon,
  CheckCircleIcon,
  CircleDotIcon,
  CircleIcon,
  CrossCircleIcon,
  InfoIcon,
} from "@/components/icons";

/* --------------------------------------------------------------------------
   Small shared primitives. Every state carries an icon and a written word so
   meaning never depends on color alone.
-------------------------------------------------------------------------- */

export type NoticeKind = "info" | "done" | "problem";

export interface NoticeMessage {
  kind: NoticeKind;
  text: string;
  /**
   * One number per notice, because two of them can say the same words. Keying
   * a toast by its text made the second rejection reuse the first one's toast:
   * the countdown carried on from wherever it was, so the second confirmation
   * showed for whatever was left of the six seconds, or — if the first was
   * already leaving — never appeared at all.
   */
  id: number;
}

let noticeCount = 0;
const nextNoticeId = () => (noticeCount += 1);

export const info = (text: string): NoticeMessage => ({ kind: "info", text, id: nextNoticeId() });
export const done = (text: string): NoticeMessage => ({ kind: "done", text, id: nextNoticeId() });
export const problem = (text: string): NoticeMessage => ({ kind: "problem", text, id: nextNoticeId() });

const NOTICE_LABEL: Record<NoticeKind, string> = {
  info: "Note",
  done: "Done",
  problem: "Something went wrong",
};

export function Notice({
  message,
  className = "",
  testId,
}: {
  message: NoticeMessage;
  className?: string;
  testId?: string;
}) {
  const Glyph = message.kind === "problem" ? AlertIcon : message.kind === "done" ? CheckCircleIcon : InfoIcon;
  return (
    <div
      data-testid={testId}
      role={message.kind === "problem" ? "alert" : "status"}
      className={`gf-notice gf-notice-${message.kind} ${className}`}
    >
      <Glyph />
      <span>
        <b>{NOTICE_LABEL[message.kind]}.</b> {message.text}
      </span>
    </div>
  );
}

/** Review states, drawn with four distinct shapes rather than four colors. */
export type BadgeTone = "strong" | "open" | "attention" | "closed" | "quiet";

export function Badge({
  tone = "open",
  icon,
  children,
  className = "",
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`gf-badge gf-badge-${tone} ${className}`}>
      {icon}
      {children}
    </span>
  );
}

const REVIEW_STATE = {
  open: { tone: "open" as const, label: "Waiting for review", Glyph: CircleDotIcon },
  accepted: { tone: "strong" as const, label: "Accepted", Glyph: CheckCircleIcon },
  rejected: { tone: "closed" as const, label: "Not used", Glyph: CrossCircleIcon },
  "needs-review": { tone: "attention" as const, label: "Needs a look", Glyph: AlertIcon },
};

/** One badge for both Change Proposals and the suggestions inside them. */
export function ReviewBadge({ status }: { status: keyof typeof REVIEW_STATE }) {
  const state = REVIEW_STATE[status] ?? { tone: "open" as const, label: status, Glyph: CircleIcon };
  const { Glyph } = state;
  return (
    <Badge tone={state.tone} icon={<Glyph />}>
      {state.label}
    </Badge>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`gf-skeleton ${className}`} aria-hidden="true" />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="gf-card flex flex-col items-center px-6 py-14 text-center">
      {icon && <span className="gf-folder-glyph mb-4">{icon}</span>}
      <h3 className="gf-h3">{title}</h3>
      {children && <p className="gf-body mt-2 max-w-sm text-sm">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
