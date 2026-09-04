"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { BrandMark, BrandWordmark } from "@/components/brand";
import {
  ClockIcon, FolderIcon, PeopleIcon, ProposalIcon, StarIcon,
} from "@/components/icons";
import { Tooltip } from "@/components/tooltip";
import { Menu } from "@/components/finder/menu";
import {
  ROOT_SCOPE_LABEL, type Folder, type Location, type RootScope,
} from "@/components/finder/types";

/** Fade only the clipped end, easing the mask away as the content fits. */
function SidebarLabel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const box = ref.current;
    const content = box?.firstElementChild;
    if (!box || !content) return;
    const measure = () => {
      const overflow = Math.max(0, content.getBoundingClientRect().width - box.clientWidth);
      box.style.opacity = String(Math.min(1, box.clientWidth / 24));
      box.style.setProperty("--gf-label-fade", `${Math.min(24, overflow)}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, []);
  return <span ref={ref} className="gf-win-side-label"><span>{children}</span></span>;
}

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
  onRedeemChallenge,
}: {
  folders: Folder[];
  location: Location;
  pinned: string[];
  email: string;
  onGo: (next: Location) => void;
  onTogglePin: (folderId: string) => void;
  onSignOut: () => void;
  onManagePlan: () => void;
  onRedeemChallenge: () => void;
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
      <Tooltip key={scope} label={ROOT_SCOPE_LABEL[scope]} placement="right">
        <button
          type="button"
          className="gf-win-side-link"
          aria-label={ROOT_SCOPE_LABEL[scope]}
          aria-current={here ? "page" : undefined}
          onClick={() => onGo({ folderId: null, dir: "", file: null, scope })}
        >
          <Glyph />
          <SidebarLabel>{ROOT_SCOPE_LABEL[scope]}</SidebarLabel>
          {count > 0 && <span className="gf-win-side-count">{count}</span>}
        </button>
      </Tooltip>
    );
  }

  return (
    <nav className="gf-win-sidebar" aria-label="Places">
      <Link href="/" aria-label="GoodFolder home" className="gf-win-side-brand">
        <BrandMark size={28} title="" />
        <SidebarLabel><BrandWordmark height={14.6} title="" /></SidebarLabel>
      </Link>

      <p className="gf-win-side-heading"><SidebarLabel>Locations</SidebarLabel></p>
      {place("all")}
      {sharedCount > 0 && place("shared")}

      <p className="gf-win-side-heading"><SidebarLabel>Smart</SidebarLabel></p>
      {place("review")}
      {place("recent")}

      {kept.length > 0 && (
        <>
          <p className="gf-win-side-heading"><SidebarLabel>Kept to hand</SidebarLabel></p>
          {kept.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="gf-win-side-link"
              title={folder.name}
              aria-label={folder.name}
              aria-current={location.folderId === folder.id ? "page" : undefined}
              onClick={() => onGo({ folderId: folder.id, dir: "", file: null, scope: "all" })}
            >
              <FolderIcon />
              <SidebarLabel>{folder.name}</SidebarLabel>
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
              <SidebarLabel>{email}</SidebarLabel>
            </>
          }
          items={[
            { id: "plan", label: "Plan and storage", onSelect: onManagePlan },
            { id: "challenge", label: "Redeem challenge code", onSelect: onRedeemChallenge },
            { id: "out", label: "Sign out", onSelect: onSignOut, dividerBefore: true },
          ]}
        />
      </div>
    </nav>
  );
}
