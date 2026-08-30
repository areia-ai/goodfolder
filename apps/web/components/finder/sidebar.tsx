"use client";

import Link from "next/link";
import { BrandLockup } from "@/components/brand";
import {
  ClockIcon, FolderIcon, PeopleIcon, ProposalIcon, StarIcon,
} from "@/components/icons";
import { Menu } from "@/components/finder/menu";
import {
  ROOT_SCOPE_LABEL, type Folder, type Location, type RootScope,
} from "@/components/finder/types";

const SCOPE_GLYPH: Record<RootScope, (props: { className?: string }) => React.ReactElement> = {
  all: FolderIcon,
  shared: PeopleIcon,
  review: ProposalIcon,
  recent: ClockIcon,
};

/**
 * The places down the left: everything, the slices worth their own name, and
 * the folders someone chose to keep to hand.
 *
 * Each one is a real place — it goes in the address, so Back comes back to it.
 */
export function Sidebar({
  folders,
  location,
  pinned,
  email,
  onGo,
  onTogglePin,
  onSignOut,
  onManagePlan,
}: {
  folders: Folder[];
  location: Location;
  pinned: string[];
  email: string;
  onGo: (next: Location) => void;
  onTogglePin: (folderId: string) => void;
  onSignOut: () => void;
  onManagePlan: () => void;
}) {
  const sharedCount = folders.filter((folder) => folder.role === "contributor").length;
  const reviewCount = folders.reduce((total, folder) => total + Number(folder.openProposalCount ?? 0), 0);
  const kept = pinned
    .map((id) => folders.find((folder) => folder.id === id))
    .filter((folder): folder is Folder => Boolean(folder));

  function place(scope: RootScope) {
    const Glyph = SCOPE_GLYPH[scope];
    const count = scope === "review" ? reviewCount : 0;
    const here = !location.folderId && location.scope === scope;
    return (
      <button
        key={scope}
        type="button"
        className="gf-win-side-link"
        aria-current={here ? "page" : undefined}
        onClick={() => onGo({ folderId: null, dir: "", file: null, scope })}
      >
        <Glyph />
        <span className="gf-truncate">{ROOT_SCOPE_LABEL[scope]}</span>
        {count > 0 && <span className="gf-win-side-count">{count}</span>}
      </button>
    );
  }

  return (
    <nav className="gf-win-sidebar" aria-label="Places">
      <Link href="/" aria-label="GoodFolder home" className="mb-1 inline-flex px-1.5 py-1.5">
        <BrandLockup size={28} />
      </Link>

      <p className="gf-win-side-heading">Locations</p>
      {place("all")}
      {sharedCount > 0 && place("shared")}

      <p className="gf-win-side-heading">Smart</p>
      {place("review")}
      {place("recent")}

      {kept.length > 0 && (
        <>
          <p className="gf-win-side-heading">Kept to hand</p>
          {kept.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="gf-win-side-link"
              aria-current={location.folderId === folder.id ? "page" : undefined}
              onClick={() => onGo({ folderId: folder.id, dir: "", file: null, scope: "all" })}
            >
              <FolderIcon />
              <span className="gf-truncate flex-1">{folder.name}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Stop keeping ${folder.name} here`}
                data-pinned="true"
                className="gf-win-side-pin"
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePin(folder.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  onTogglePin(folder.id);
                }}
              >
                <StarIcon />
              </span>
            </button>
          ))}
        </>
      )}

      <div className="mt-auto border-t border-[var(--gf-line)] pt-2">
        <Menu
          label={`Account: ${email}`}
          className="gf-win-side-link"
          align="left"
          direction="up"
          trigger={
            <>
              <span className="gf-win-initial" aria-hidden="true">
                {email[0]?.toUpperCase() ?? "?"}
              </span>
              <span className="gf-truncate">{email}</span>
            </>
          }
          items={[
            { id: "plan", label: "Plan and storage", onSelect: onManagePlan },
            { id: "out", label: "Sign out", onSelect: onSignOut, dividerBefore: true },
          ]}
        />
      </div>
    </nav>
  );
}
