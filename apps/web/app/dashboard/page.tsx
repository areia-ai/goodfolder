"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BrandLockup, BrandMark } from "@/components/brand";
import { DashboardShell } from "@/components/dashboard-shell";
import { FolderCards, FolderCardsSkeleton } from "@/components/folder-card";
import { FolderWorkspace } from "@/components/folder-workspace";
import { AlertIcon, ArrowLeftIcon, FolderIcon, MailIcon, SearchIcon, SparklesIcon } from "@/components/icons";
import { EmptyState, Notice, Skeleton, done, problem, type NoticeMessage } from "@/components/ui";
import {
  listFolders, acceptInvitation, getAccountPlan, getPlans, me, openBillingPortal,
  requestSignInLink, setOverageCap, startHostedTrial,
  type AccountPlan, type Folder, type PlanCode, type PlanDefinition,
} from "@/lib/gf-api";
import { registerDashboardTools, unregisterDashboardTools, webMcpSupported } from "@/lib/webmcp";

interface Me {
  id: string;
  email: string;
}

type State =
  | { phase: "checking" }
  | { phase: "signed-out" }
  | { phase: "email-sent"; email: string }
  | { phase: "signed-in"; me: Me };

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard() {
  const [state, setState] = useState<State>({ phase: "checking" });
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);

  const [projects, setProjects] = useState<Folder[] | null>(null);
  const [workspace, setWorkspace] = useState<Folder | null>(null);
  const [agentReady, setAgentReady] = useState(false);
  const [folderQuery, setFolderQuery] = useState("");
  // A failed load is not an empty account — the two states must not look alike.
  const [loadFailed, setLoadFailed] = useState(false);
  const [plan, setPlan] = useState<AccountPlan | null>(null);
  const [plans, setPlans] = useState<Record<PlanCode, PlanDefinition> | null>(null);

  const loadProjects = useCallback(async () => {
    setProjects(null);
    setLoadFailed(false);
    try {
      const params = new URLSearchParams(window.location.search);
      const invite = params.get("invite");
      if (invite) {
        const accepted = await acceptInvitation(invite);
        params.delete("invite");
        params.set("folder", accepted.projectId);
        history.replaceState(null, "", `/dashboard?${params.toString()}`);
      }
      const [rows, accountPlan, planCatalog] = await Promise.all([listFolders(), getAccountPlan(), getPlans()]);
      setProjects(rows);
      setPlan(accountPlan);
      setPlans(planCatalog);
      const folderId = new URLSearchParams(window.location.search).get("folder");
      const requested = rows.find((row) => row.id === folderId);
      if (requested) setWorkspace(requested);
      // Site tools for the signed-in person's agent — feature-checked,
      // silently skipped outside WebMCP browsers.
      try {
        if (webMcpSupported()) {
          const registered = await registerDashboardTools();
          setAgentReady(registered.length > 0);
        }
      } catch {
        /* agent tools are a bonus; never block the human */
      }
    } catch (e) {
      setProjects([]);
      setLoadFailed(true);
      setNotice(problem((e as Error).message));
    }
  }, []);

  useEffect(() => {
    me()
      .then((who) => {
        setState({ phase: "signed-in", me: who });
        void loadProjects();
      })
      .catch(() => setState({ phase: "signed-out" }));
  }, [loadProjects]);

  async function requestLink() {
    const clean = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      setNotice(problem("That doesn't look like an email address."));
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await requestSignInLink(clean);
      setState({ phase: "email-sent", email: clean });
    } catch (e) {
      setNotice(problem((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const API = process.env.NEXT_PUBLIC_API_URL ?? "https://api.trygoodfolder.com";
    await fetch(`${API}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    await unregisterDashboardTools().catch(() => {});
    setState({ phase: "signed-out" });
    setProjects(null);
    setWorkspace(null);
    setAgentReady(false);
    setNotice(null);
    setLoadFailed(false);
    setPlan(null);
    setPlans(null);
    history.replaceState(null, "", "/dashboard");
  }

  const query = folderQuery.trim().toLowerCase();
  const visible = useMemo(
    () => (projects ?? []).filter((p) => p.name.toLowerCase().includes(query)),
    [projects, query],
  );

  if (state.phase !== "signed-in") {
    return (
      <AuthScreen
        state={state}
        email={email}
        busy={busy}
        notice={notice}
        onEmail={setEmail}
        onSubmit={requestLink}
        onRestart={() => {
          setNotice(null);
          setState({ phase: "signed-out" });
        }}
      />
    );
  }

  return (
    <DashboardShell
      email={state.me.email}
      onSignOut={logout}
      folder={workspace}
      onLeaveFolder={() => {
        history.replaceState(null, "", "/dashboard");
        setWorkspace(null);
      }}
    >
      {workspace ? (
        <FolderWorkspace folder={workspace} />
      ) : (
        <div className="px-4 py-8 sm:px-7 sm:py-10 lg:px-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="gf-eyebrow">Your workspace</p>
              <h1 className="mt-2 text-[26px] font-bold tracking-[-.03em] sm:text-[32px]">{greeting()}</h1>
              <p className="gf-body mt-2 text-[14px]">
                Your folders, what has happened in them, and anything waiting for your review.
              </p>
            </div>
          </div>

          {agentReady && (
            <div data-testid="site-tools-banner" className="gf-notice gf-notice-info mt-6">
              <SparklesIcon />
              <span>
                <b>This page speaks agent.</b> Your AI assistant can read this timeline alongside you. It can look and
                suggest — it can&apos;t save, accept a suggestion, or change who has access.
              </span>
            </div>
          )}

          {notice && <Notice message={notice} className="mt-6" />}

          {plan && plans && (
            <BillingCard
              plan={plan}
              plans={plans}
              onPlan={setPlan}
              onNotice={setNotice}
            />
          )}

          {projects === null ? (
            <div className="mt-8">
              <Skeleton className="h-11 w-full rounded-[var(--gf-radius)]" />
              <div className="mt-5">
                <FolderCardsSkeleton />
              </div>
            </div>
          ) : loadFailed ? (
            <div className="mt-8">
              <EmptyState
                icon={<AlertIcon />}
                title="We couldn't load your folders"
                action={
                  <button type="button" onClick={() => void loadProjects()} className="gf-button-primary">
                    Try again
                  </button>
                }
              >
                Your folders are safe — this is only the list failing to load. Check your connection and try again.
              </EmptyState>
            </div>
          ) : projects.length === 0 ? (
            <div className="mt-8">
              <EmptyState icon={<FolderIcon />} title="No folders yet">
                Ask your AI agent to protect a folder for you — something like “create a GoodFolder called Q3 report” —
                and it will show up here with its own history.
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="gf-card mt-8 flex items-center gap-2.5 px-3.5">
                <SearchIcon className="gf-faint h-4 w-4 shrink-0" />
                <label htmlFor="gf-folder-search" className="sr-only">
                  Find a folder
                </label>
                <input
                  id="gf-folder-search"
                  type="search"
                  value={folderQuery}
                  onChange={(e) => setFolderQuery(e.target.value)}
                  placeholder="Find a folder"
                  className="min-h-11 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
                />
                <span className="gf-faint gf-num shrink-0 text-[12px]" aria-live="polite">
                  {visible.length} of {projects.length}
                </span>
              </div>

              <div className="mt-5">
                {visible.length === 0 ? (
                  <EmptyState
                    icon={<SearchIcon />}
                    title="No folder matches that"
                    action={
                      <button type="button" onClick={() => setFolderQuery("")} className="gf-button-secondary">
                        Clear the search
                      </button>
                    }
                  >
                    Nothing here is called “{folderQuery.trim()}”. Try part of the name instead.
                  </EmptyState>
                ) : (
                  <FolderCards
                    folders={visible}
                    activeId={null}
                    onSelect={(folder) => {
                      history.replaceState(null, "", `/dashboard?folder=${encodeURIComponent(folder.id)}`);
                      setWorkspace(folder);
                    }}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </DashboardShell>
  );
}

function formatProtected(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(bytes >= 10_000_000_000 ? 0 : 1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${Math.max(0, bytes / 1_000).toFixed(0)} KB`;
}

function dateLabel(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function BillingCard({
  plan,
  plans,
  onPlan,
  onNotice,
}: {
  plan: AccountPlan;
  plans: Record<PlanCode, PlanDefinition>;
  onPlan: (plan: AccountPlan) => void;
  onNotice: (notice: NoticeMessage | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const used = plan.usageBytes + plan.reservedBytes;
  const percent = plan.authorizedBytes ? Math.min(100, (used / plan.authorizedBytes) * 100) : 0;
  const currentPlan = plan.planCode ? plans[plan.planCode] : null;
  const statusLine = plan.status === "trialing" ? `Trial ends ${dateLabel(plan.trialEndsAt) ?? "soon"}`
    : plan.status === "past_due" ? `Payment needs attention. Full access ends ${dateLabel(plan.writeAccessEndsAt) ?? "soon"}`
    : plan.access === "read_only" ? `Read and export access ends ${dateLabel(plan.retentionEndsAt) ?? "soon"}`
    : plan.status === "canceled" ? `Hosted access ends ${dateLabel(plan.currentPeriodEnd) ?? "soon"}`
    : plan.status === "active" ? `Next renewal ${dateLabel(plan.currentPeriodEnd) ?? "soon"}`
    : "No hosted plan yet";

  async function start(planCode: PlanCode) {
    setBusy(true);
    onNotice(null);
    try {
      const result = await startHostedTrial(planCode, "month");
      window.location.assign(result.url);
    } catch (error) {
      onNotice(problem((error as Error).message));
      setBusy(false);
    }
  }

  async function manage() {
    setBusy(true);
    onNotice(null);
    try {
      const result = await openBillingPortal();
      window.location.assign(result.url);
    } catch (error) {
      onNotice(problem((error as Error).message));
      setBusy(false);
    }
  }

  async function changeCap(capCents: number) {
    const description = capCents === 0 ? "disable extra capacity" : `set a $${capCents / 100} monthly ceiling`;
    if (!window.confirm(`Confirm that you want to ${description}. Existing protected data will not be deleted.`)) return;
    setBusy(true);
    onNotice(null);
    try {
      onPlan(await setOverageCap(capCents));
      onNotice(done(capCents === 0 ? "Extra capacity is off." : `Extra capacity can add at most $${capCents / 100} to a monthly bill.`));
    } catch (error) {
      onNotice(problem((error as Error).message));
    } finally {
      setBusy(false);
    }
  }

  if (plan.billingMode === "disabled") {
    return (
      <section className="gf-card mt-6 p-5 sm:p-6" aria-label="Protected data">
        <p className="gf-eyebrow">Self-hosted</p>
        <h2 className="mt-2 text-[17px] font-bold">Capacity comes from this server</h2>
        <p className="gf-body mt-2 text-[13.5px]">GoodFolder does not apply a hosted plan or spending limit here.</p>
      </section>
    );
  }

  return (
    <section className="gf-card mt-6 p-5 sm:p-6" aria-label="Hosted plan and protected data">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="gf-eyebrow">GoodFolder Hosted</p>
          <h2 className="mt-2 text-[18px] font-bold">
            {plan.status === "none" || plan.status === "expired" ? "Choose a plan, with a 7-day trial" : `${currentPlan?.name ?? "Hosted"} — ${statusLine}`}
          </h2>
          <p className="gf-body mt-2 max-w-2xl text-[13.5px]">
            Current files and earlier versions stay protected without an arbitrary expiry date. Reaching the limit pauses new Saves; it does not remove what is already here.
          </p>
        </div>
        {plan.status === "none" || plan.status === "expired" ? (
          <div className="flex flex-wrap gap-2">
            {(["starter", "plus", "studio"] as const).map((code) => (
              <button
                key={code}
                type="button"
                disabled={busy}
                onClick={() => void start(code)}
                className={code === "plus" ? "gf-button-primary" : "gf-button-secondary"}
              >
                {busy ? "Opening…" : `${plans[code].name} $${plans[code].monthlyPriceCents / 100}/mo`}
              </button>
            ))}
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => void manage()} className="gf-button-secondary">
            Manage billing
          </button>
        )}
      </div>

      {plan.authorizedBytes !== null && (
        <div className="mt-5 border-t border-[var(--gf-line)] pt-5">
          <div className="flex flex-wrap items-end justify-between gap-2 text-[13px]">
            <span><b>{formatProtected(used)}</b> protected</span>
            <span className="gf-faint">{formatProtected(plan.authorizedBytes)} authorized</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--gf-blue-soft)]" aria-label={`${percent.toFixed(0)} percent used`}>
            <div className="h-full rounded-full bg-[var(--gf-blue-ink)]" style={{ width: `${Math.max(percent > 0 ? 2 : 0, percent)}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-[12.5px]">
            <span className="gf-faint">Not enough activity to estimate when this limit may be reached.</span>
            <span>Estimated extra charge: ${(plan.accruedOverageCents / 100).toFixed(2)}</span>
          </div>
        </div>
      )}

      {["active", "past_due"].includes(plan.status) && (
        <div className="mt-5 border-t border-[var(--gf-line)] pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <b className="text-[13.5px]">Extra protected capacity</b>
              <p className="gf-faint mt-1 text-[12.5px]">
                ${((currentPlan?.overageCentsPerGbMonth ?? 10) / 100).toFixed(2)} per GB-month, never above the ceiling you choose.
              </p>
            </div>
            <select
              aria-label="Monthly extra-capacity ceiling"
              value={plan.overageCapCents}
              disabled={busy}
              onChange={(event) => void changeCap(Number(event.target.value))}
              className="gf-input w-auto min-w-44"
            >
              <option value={0}>Off</option>
              {[1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000].map((cents) => (
                <option key={cents} value={cents}>${cents / 100} monthly ceiling</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- Sign in */

function AuthScreen({
  state,
  email,
  busy,
  notice,
  onEmail,
  onSubmit,
  onRestart,
}: {
  state: State;
  email: string;
  busy: boolean;
  notice: NoticeMessage | null;
  onEmail: (value: string) => void;
  onSubmit: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="gf-shell flex min-h-svh flex-col">
      <header className="border-b border-[var(--gf-line)] bg-white">
        <div className="gf-wrap flex h-16 items-center justify-between gap-4">
          <Link href="/" aria-label="GoodFolder home" className="-m-2 inline-flex p-2">
            {/* Identical to the landing header, so the brand does not change size
                when someone moves between the two. Keep them in step. */}
            <BrandMark size={36} className="min-[360px]:hidden" title="GoodFolder" />
            <BrandLockup size={36} className="hidden min-[360px]:inline-flex" />
          </Link>
          <Link href="/" className="gf-button-ghost">
            <ArrowLeftIcon /> Home
          </Link>
        </div>
      </header>

      <div className="gf-wrap flex flex-1 items-center justify-center py-12 sm:py-20">
        <div className="w-full max-w-[26rem]">
          {state.phase === "checking" && (
            <div className="gf-card gf-card-lg p-7">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
              <Skeleton className="mt-6 h-11 w-full rounded-[var(--gf-radius)]" />
              <p className="gf-faint mt-4 text-center text-[13px]" role="status">
                Checking your sign-in…
              </p>
            </div>
          )}

          {state.phase === "signed-out" && (
            <div className="gf-card gf-card-lg p-7">
              <h1 className="text-[22px] font-bold tracking-[-.025em]">Open your folders</h1>
              <p className="gf-body mt-2 text-[14px]">
                Sign in with your email and we&apos;ll send a one-time link. There is no password to remember.
              </p>

              <label htmlFor="gf-signin-email" className="gf-label mt-6">
                Email address
              </label>
              <input
                id="gf-signin-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => onEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && onSubmit()}
                placeholder="you@example.com"
                className="gf-input gf-input-lg"
              />
              <button
                type="button"
                onClick={onSubmit}
                disabled={busy}
                className="gf-button-primary gf-button-lg gf-button-block mt-3"
              >
                {busy ? "Sending…" : "Email me a sign-in link"}
              </button>

              {notice && <Notice message={notice} className="mt-4" />}

              <p className="gf-faint mt-6 border-t border-[var(--gf-line)] pt-5 text-[13px] leading-relaxed">
                A GoodFolder is a normal folder with a clear history around it — what changed, who changed it, and a
                safe way back. If someone shared a folder with you, sign in with the address they used.
              </p>
            </div>
          )}

          {state.phase === "email-sent" && (
            <div className="gf-card gf-card-lg p-7 text-center">
              <span className="gf-folder-glyph mx-auto">
                <MailIcon />
              </span>
              <h1 className="mt-5 text-[22px] font-bold tracking-[-.025em]">Check your inbox</h1>
              <p className="gf-body mt-2 text-[14px]">
                We sent a one-time sign-in link to <strong className="text-black">{state.email}</strong>. Open it and
                this page will finish loading your folders.
              </p>
              <button type="button" onClick={onRestart} className="gf-button-secondary mt-6">
                Use a different email
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
