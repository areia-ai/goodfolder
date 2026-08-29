"use client";

import { actorLabel, countsLabel, whenLabel, type SaveRow } from "@/lib/gf-api";
import { AlertIcon, ClockIcon, TimelineIcon } from "@/components/icons";
import { Badge, EmptyState, Skeleton } from "@/components/ui";

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function Timeline({ saves }: { saves: SaveRow[] | null }) {
  if (saves === null) return <TimelineSkeleton />;

  if (saves.length === 0) {
    return (
      <EmptyState icon={<TimelineIcon />} title="Nothing saved here yet">
        As soon as you or an agent saves work in this folder, it appears here — who acted, what changed, and when.
      </EmptyState>
    );
  }

  return (
    <ol className="grid gap-2.5">
      {saves.map((s) => {
        const actor = actorLabel(s);
        const counts = countsLabel(s);
        const paths = Array.isArray(s.topPaths) ? s.topPaths.slice(0, 3) : [];
        const attention = Boolean(s.collision && s.collision !== "none");
        return (
          <li key={s.seq} className="gf-card min-w-0 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <Badge tone="quiet" className="gf-num">
                #{s.seq}
              </Badge>
              {actor && <span className="text-[13px] font-semibold">{sentenceCase(actor)}</span>}
              {attention && (
                <Badge tone="attention" icon={<AlertIcon />}>
                  Needs a look
                </Badge>
              )}
              <span className="gf-faint ml-auto flex items-center gap-1.5 whitespace-nowrap text-[12px]">
                <ClockIcon className="h-3.5 w-3.5" />
                {whenLabel(s.createdAt)}
              </span>
            </div>

            <p className="mt-2 text-[15px] font-medium leading-snug">{s.label}</p>

            {(counts || paths.length > 0) && (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                {counts && <span className="gf-count gf-num">{counts}</span>}
                {/* The separator only earns its place when the two parts
                    share a line; on a phone they stack. */}
                {counts && paths.length > 0 && (
                  <span className="gf-faint hidden sm:inline" aria-hidden="true">
                    ·
                  </span>
                )}
                {paths.length > 0 && (
                  <span className="gf-faint min-w-0 truncate font-mono text-[12px]">{paths.join(" · ")}</span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function TimelineSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-2.5" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="gf-card p-4 sm:p-5">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-5 w-11 rounded-full" />
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="ml-auto h-3 w-24" />
          </div>
          <Skeleton className="mt-3 h-4 w-3/4" />
          <Skeleton className="mt-2.5 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
