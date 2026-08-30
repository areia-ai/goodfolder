"use client";

import { ChevronRightIcon } from "@/components/icons";
import { formatBytes } from "@/lib/preview";
import type { AccountPlan, Crumb, Location } from "@/components/finder/types";

/** Where you are, one step per button, all the way back to the root. */
export function PathBar({ crumbs, onGo }: { crumbs: Crumb[]; onGo: (next: Location) => void }) {
  return (
    <nav className="gf-win-path" aria-label="Where you are">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <div key={`${crumb.label}-${index}`} className="flex flex-none items-center">
            {index > 0 && <ChevronRightIcon className="h-3 w-3 shrink-0 text-[var(--gf-ink-faint)]" />}
            {last ? (
              <span aria-current="page">{crumb.label}</span>
            ) : (
              <button type="button" onClick={() => onGo(crumb.location)}>
                {crumb.label}
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function protectedLine(plan: AccountPlan | null): { text: string; percent: number } | null {
  if (!plan || plan.billingMode === "disabled" || plan.authorizedBytes === null) return null;
  const used = plan.usageBytes + plan.reservedBytes;
  return {
    text: `${formatBytes(used)} of ${formatBytes(plan.authorizedBytes)} protected`,
    percent: plan.authorizedBytes ? Math.min(100, (used / plan.authorizedBytes) * 100) : 0,
  };
}

/**
 * What is in front of you, and how much room is left.
 *
 * The second half is the whole of the old billing card. A window's status bar
 * is where a person already looks for "how full is this", and it keeps the
 * number in sight without it being the first thing anyone sees.
 */
export function StatusBar({
  count,
  selectedCount,
  bytes,
  plan,
  note,
  onManagePlan,
}: {
  count: number;
  selectedCount: number;
  bytes: number | null;
  plan: AccountPlan | null;
  note?: string | null;
  onManagePlan: () => void;
}) {
  const capacity = protectedLine(plan);
  const items = selectedCount > 0
    ? `${selectedCount} of ${count} selected`
    : `${count} ${count === 1 ? "item" : "items"}`;

  return (
    <div className="gf-win-status" role="status">
      <span><b>{items}</b></span>
      {bytes !== null && bytes > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span>{formatBytes(bytes)}</span>
        </>
      )}
      {note && (
        <>
          <span aria-hidden="true">·</span>
          <span className="gf-truncate">{note}</span>
        </>
      )}
      {capacity && (
        <button
          type="button"
          onClick={onManagePlan}
          className="ml-auto flex flex-none items-center gap-2 rounded-full px-2 py-0.5 hover:bg-[var(--gf-blue-soft)]"
        >
          <span className="gf-win-meter" aria-hidden="true">
            <span style={{ width: `${Math.max(capacity.percent > 0 ? 3 : 0, capacity.percent)}%` }} />
          </span>
          <span>{capacity.text}</span>
        </button>
      )}
    </div>
  );
}
