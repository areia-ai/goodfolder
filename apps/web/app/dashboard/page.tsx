"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandLockup, BrandMark } from "@/components/brand";
import { FinderBrowser } from "@/components/finder/browser";
import { ArrowLeftIcon, MailIcon } from "@/components/icons";
import { Notice, Skeleton, problem, type NoticeMessage } from "@/components/ui";
import { API, me, requestSignInLink } from "@/lib/gf-api";
import { unregisterDashboardTools } from "@/lib/webmcp";
import { demoActive, installDemoTransport } from "@/lib/demo";

interface Me {
  id: string;
  email: string;
}

type State =
  | { phase: "checking" }
  | { phase: "signed-out" }
  | { phase: "email-sent"; email: string }
  | { phase: "signed-in"; me: Me };

export default function Dashboard() {
  // Answering GoodFolder's own addresses from invented content, so the window
  // can be built and looked at without a server. Removed from a production
  // build entirely; see lib/demo.ts.
  if (demoActive()) installDemoTransport(API);

  const [state, setState] = useState<State>({ phase: "checking" });
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);

  useEffect(() => {
    me()
      .then((who) => setState({ phase: "signed-in", me: who }))
      .catch(() => setState({ phase: "signed-out" }));
  }, []);

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
    await fetch(`${API}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    await unregisterDashboardTools().catch(() => {});
    setState({ phase: "signed-out" });
    setNotice(null);
    history.replaceState(null, "", "/dashboard");
  }

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

  return <FinderBrowser email={state.me.email} onSignOut={logout} />;
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
