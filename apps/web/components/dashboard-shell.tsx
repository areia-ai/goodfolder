"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { BrandLockup, BrandMark } from "@/components/brand";
import { ArrowLeftIcon, FolderIcon, SignOutIcon } from "@/components/icons";

export interface ShellFolder {
  id: string;
  name: string;
}

/**
 * One shell for the whole signed-in surface. The folder home and the folder
 * workspace live inside it, so the account, the way back to every folder, and
 * sign-out never disappear when you open something.
 */
export function DashboardShell({
  email,
  onSignOut,
  folder,
  onLeaveFolder,
  children,
}: {
  email: string;
  onSignOut: () => void;
  folder: ShellFolder | null;
  onLeaveFolder: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="gf-shell lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a href="#workspace" className="gf-skip-link">
        Skip to content
      </a>

      {/* Desktop rail ---------------------------------------------------- */}
      <div className="hidden lg:sticky lg:top-0 lg:flex lg:h-svh lg:flex-col">
        <nav className="gf-rail h-full" aria-label="Your account">
          <Link href="/" aria-label="GoodFolder home" className="mb-4 inline-flex px-1 py-1">
            <BrandLockup size={30} />
          </Link>

          <button
            type="button"
            onClick={onLeaveFolder}
            className="gf-rail-link"
            aria-current={folder ? undefined : "page"}
          >
            <FolderIcon />
            Your folders
          </button>

          {folder && (
            <>
              <p className="gf-rail-heading">Open now</p>
              <span className="gf-rail-link" aria-current="page">
                <FolderIcon />
                <span className="gf-truncate">{folder.name}</span>
              </span>
            </>
          )}

          <div className="mt-auto border-t border-[var(--gf-line)] pt-3">
            <p className="gf-faint px-2 pb-2 text-[12px]" title={email}>
              <span className="gf-truncate block">{email}</span>
            </p>
            <button type="button" onClick={onSignOut} className="gf-rail-link">
              <SignOutIcon />
              Sign out
            </button>
          </div>
        </nav>
      </div>

      {/* Mobile header --------------------------------------------------- */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-[var(--gf-line)] bg-white/95 px-3 backdrop-blur-xl lg:hidden">
        {folder ? (
          <button type="button" onClick={onLeaveFolder} className="gf-icon-button" aria-label="Back to your folders">
            <ArrowLeftIcon />
          </button>
        ) : (
          <Link href="/" aria-label="GoodFolder home" className="-m-2 inline-flex shrink-0 items-center p-2">
            <BrandMark size={28} title="GoodFolder" />
          </Link>
        )}
        <p className="gf-truncate flex-1 text-[15px] font-semibold">{folder ? folder.name : "Your folders"}</p>
        <AccountMenu email={email} onSignOut={onSignOut} />
      </header>

      <main id="workspace" className="min-w-0">
        {children}
      </main>
    </div>
  );
}

function AccountMenu({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="gf-avatar"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-label={`Account: ${email}`}
      >
        {email[0]?.toUpperCase() ?? "?"}
      </button>
      {open && (
        <div id={menuId} role="menu" className="gf-menu">
          <p className="gf-faint gf-truncate px-2.5 pb-2 pt-1.5 text-[12px]">{email}</p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="gf-menu-item flex items-center gap-2"
          >
            <SignOutIcon className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
