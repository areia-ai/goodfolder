"use client";

import { folderStatus, type Folder } from "@/lib/gf-api";
import {
  AlertIcon,
  ArrowRightIcon,
  CircleIcon,
  FolderIcon,
  PeopleIcon,
  ShieldIcon,
} from "@/components/icons";
import { Badge, Skeleton } from "@/components/ui";

function StatusBadge({ kind }: { kind: "empty" | "attention" | "current" }) {
  if (kind === "attention") {
    return (
      <Badge tone="attention" icon={<AlertIcon />}>
        Needs a look
      </Badge>
    );
  }
  if (kind === "empty") {
    return (
      <Badge tone="quiet" icon={<CircleIcon />}>
        Nothing saved yet
      </Badge>
    );
  }
  return (
    <Badge tone="open" icon={<ShieldIcon />}>
      Protected
    </Badge>
  );
}

export function FolderCards({
  folders,
  activeId,
  onSelect,
}: {
  folders: Folder[];
  activeId: string | null;
  onSelect: (f: Folder) => void;
}) {
  const now = Date.now();
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {folders.map((f) => {
        const st = folderStatus(f, now);
        const saves = Number(f.lastSeq ?? 0);
        const people = Number(f.contributorCount ?? 0) + 1;
        const toReview = Number(f.openProposalCount ?? 0);
        // folderStatus already writes "Protected · last saved 2 hours ago";
        // the badge carries the state, so the line only has to say what
        // happened most recently — repeating the badge helps nobody.
        const activity =
          st.kind === "current"
            ? st.text.replace(/^Protected · /, "")
            : st.kind === "empty"
              ? "Connected and ready for its first save"
              : "Open the folder to see what needs a decision";
        return (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onSelect(f)}
              aria-current={f.id === activeId ? "true" : undefined}
              className={`gf-card gf-card-interactive group flex h-full w-full flex-col p-5 text-left ${
                f.id === activeId ? "border-[var(--gf-blue-ink)]" : ""
              }`}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="gf-folder-glyph shrink-0">
                  <FolderIcon />
                </span>
                <StatusBadge kind={st.kind} />
              </span>

              <span className="mt-4 block text-[16px] font-semibold tracking-[-.015em]">{f.name}</span>
              <span className="gf-faint mt-1 block text-[13px] first-letter:uppercase">{activity}</span>
              {f.role === "contributor" && (
                <span className="gf-faint mt-2 flex items-center gap-1.5 text-[12px]">
                  <PeopleIcon className="h-3.5 w-3.5" />
                  Shared with you
                </span>
              )}

              <span className="mt-auto flex items-center gap-2 border-t border-[var(--gf-line)] pt-4 text-[12.5px]">
                <span className="gf-count gf-num">
                  <strong>{saves}</strong> save{saves === 1 ? "" : "s"}
                </span>
                <span className="gf-faint" aria-hidden="true">
                  ·
                </span>
                <span className="gf-count gf-num">
                  <strong>{people}</strong> {people === 1 ? "person" : "people"}
                </span>
                {toReview > 0 && (
                  <Badge tone="strong" className="gf-num ml-1">
                    {toReview} to review
                  </Badge>
                )}
                <ArrowRightIcon className="gf-faint ml-auto h-4 w-4 shrink-0 transition group-hover:translate-x-0.5" />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function FolderCardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="gf-card p-5">
          <div className="flex items-start justify-between">
            <Skeleton className="h-10 w-10 rounded-[10px]" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          <Skeleton className="mt-4 h-4 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/2" />
          <div className="mt-5 border-t border-[var(--gf-line)] pt-4">
            <Skeleton className="h-3 w-3/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}
