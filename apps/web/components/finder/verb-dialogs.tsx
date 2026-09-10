"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";
import {
  forgetDevice, getAccountPlan, getPlans, listDevices, openBillingPortal, setOverageCap,
  signOutEverywhere, startHostedTrial, whenLabel,
  type AccountPlan, type ApprovedDevice, type BillingInterval, type PlanCode, type PlanDefinition,
} from "@/lib/gf-api";
import { formatBytes } from "@/lib/preview";

/**
 * The questions the window has to ask before it changes a folder.
 *
 * Each is the same small card, and each says what happens next in the same
 * breath as the button that does it: a rename reaches the person's own
 * computers at the next Sync, and taking a file out does not lose it.
 */

export function RenameDialog(props: {
  name: string;
  kind: "file" | "folder";
  /** True for someone invited: this is asked of the owner, not done. */
  suggesting: boolean;
  onCancel: () => void;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(props.name);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = field.current;
    if (!input) return;
    // Select the name and leave the extension alone: almost nobody means to
    // change ".png", and having to skip past it every time is a small tax on
    // the one thing this dialog is for.
    const dot = props.name.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : props.name.length);
  }, [props.name]);

  const clean = name.trim();
  return (
    <Dialog
      open
      onClose={props.onCancel}
      initialFocus={field}
      title={props.suggesting ? "Suggest a new name" : "Rename"}
      description={props.suggesting
        ? `The folder's owner decides. The ${props.kind} keeps its name until they accept.`
        : `The ${props.kind} changes name here, and on your own computers at the next Sync.`}
      onSubmit={() => {
        if (clean && clean !== props.name) props.onRename(clean);
        else props.onCancel();
      }}
      actions={
        <>
          <button type="button" className="gf-button-secondary" onClick={props.onCancel}>Cancel</button>
          <button type="submit" className="gf-button-primary" disabled={!clean || clean === props.name}>
            {props.suggesting ? "Suggest" : "Rename"}
          </button>
        </>
      }
    >
      <label htmlFor="gf-rename" className="gf-label mt-4">Name</label>
      <input
        id="gf-rename"
        ref={field}
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="gf-input"
      />
    </Dialog>
  );
}

export function RemoveDialog(props: {
  names: string[];
  /** True for someone invited: this is asked of the owner, not done. */
  suggesting: boolean;
  onCancel: () => void;
  onRemove: () => void;
}) {
  // Cancel holds the keyboard, so a key still travelling from the Delete
  // that opened this lands on the harmless half of the question.
  const cancel = useRef<HTMLButtonElement>(null);
  const many = props.names.length > 1;
  const shown = props.names.slice(0, 5);
  return (
    <Dialog
      open
      onClose={props.onCancel}
      initialFocus={cancel}
      width="26rem"
      title={props.suggesting
        ? many ? `Suggest taking ${props.names.length} files out?` : `Suggest taking “${props.names[0]}” out?`
        : many ? `Take ${props.names.length} files out?` : `Take “${props.names[0]}” out?`}
      description={props.suggesting ? (
        <>
          The folder&apos;s owner decides. {many ? "They stay" : "It stays"} where {many ? "they are" : "it is"}
          {" "}until {many ? "each one is" : "it is"} accepted.
        </>
      ) : (
        <>
          {many ? "They stop" : "It stops"} being part of the folder from the next Save on. Every earlier Save
          still holds {many ? "them" : "it"}, and going back to one brings {many ? "them" : "it"} with it.
        </>
      )}
      actions={
        <>
          <button ref={cancel} type="button" className="gf-button-secondary" onClick={props.onCancel}>Cancel</button>
          <button type="button" className="gf-button-primary" onClick={props.onRemove}>
            {props.suggesting ? "Suggest" : "Take out"}
          </button>
        </>
      }
    >
      {many && (
        <ul className="gf-faint mt-3 grid gap-0.5 font-mono text-[12px]">
          {shown.map((name) => <li key={name} className="gf-truncate">{name}</li>)}
          {props.names.length > shown.length && <li>and {props.names.length - shown.length} more</li>}
        </ul>
      )}
    </Dialog>
  );
}

export function DeleteFolderDialog(props: {
  name: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);
  const confirmed = confirmation === props.name;
  return (
    <Dialog
      open
      onClose={props.onCancel}
      initialFocus={cancel}
      busy={props.busy}
      width="27rem"
      title={<>Delete “{props.name}” forever?</>}
      description="This permanently deletes every Save, stored file, invitation, and comment in this GoodFolder. It does not delete a local copy that still exists on a computer. This cannot be undone."
      onSubmit={() => {
        if (confirmed && !props.busy) props.onDelete();
      }}
      actions={
        <>
          <button ref={cancel} type="button" className="gf-button-secondary" onClick={props.onCancel} disabled={props.busy}>
            Cancel
          </button>
          <button type="submit" className="gf-button-primary" disabled={!confirmed || props.busy}>
            {props.busy ? "Deleting…" : "Delete forever"}
          </button>
        </>
      }
    >
      <label htmlFor="gf-delete-folder" className="gf-label mt-4">Type {props.name} to confirm</label>
      <input
        id="gf-delete-folder"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        className="gf-input"
        autoComplete="off"
        spellCheck={false}
        disabled={props.busy}
      />
      {props.error && <p className="mt-2 text-[13px] font-semibold" role="alert">{props.error}</p>}
    </Dialog>
  );
}

export function NameFolderDialog({ onCancel, onName }: { onCancel: () => void; onName: (name: string) => void }) {
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open
      onClose={onCancel}
      initialFocus={field}
      title="New folder"
      description="Start a brand-new empty folder here, then bring it down to a computer. To protect an existing folder on this computer, use the GoodFolder MCP or CLI there instead."
      onSubmit={() => {
        if (name.trim()) onName(name);
      }}
      actions={
        <>
          <button type="button" className="gf-button-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="gf-button-primary" disabled={!name.trim()}>Create</button>
        </>
      }
    >
      <label htmlFor="gf-new-folder" className="gf-label mt-4">Name</label>
      <input
        id="gf-new-folder"
        ref={field}
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Q3 Report"
        className="gf-input"
      />
    </Dialog>
  );
}

export function ChallengeCodeDialog(props: {
  code: string;
  onCode: (code: string) => void;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onRedeem: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open
      onClose={props.onCancel}
      initialFocus={field}
      busy={props.busy}
      width="28rem"
      title="Redeem challenge code"
      description="This gives your account full access for the WebMCP Challenge. It ends October 1; your folders remain yours."
      onSubmit={() => { if (!props.busy && props.code.trim()) props.onRedeem(); }}
      actions={
        <>
          <button type="button" className="gf-button-secondary" onClick={props.onCancel} disabled={props.busy}>Cancel</button>
          <button type="submit" className="gf-button-primary" disabled={props.busy || !props.code.trim()}>
            {props.busy ? "Checking…" : "Redeem"}
          </button>
        </>
      }
    >
      <label className="gf-label mt-4" htmlFor="challenge-code">Code</label>
      <input
        id="challenge-code"
        ref={field}
        className="gf-input"
        value={props.code}
        onChange={(event) => props.onCode(event.target.value)}
        disabled={props.busy}
      />
      {props.error && <p className="mt-2 text-[13px] font-semibold" role="alert">{props.error}</p>}
    </Dialog>
  );
}

/**
 * The computers approved to act for this account. Each one came from a
 * one-time pairing in this browser and holds a credential that can create
 * and open folders, so the person can see them here and take one back. The
 * list is read when the dialog opens; nothing is fetched otherwise.
 */
export function DevicesDialog(props: { onCancel: () => void; onSignedOutEverywhere: () => void }) {
  const [devices, setDevices] = useState<ApprovedDevice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);

  useEffect(() => {
    let live = true;
    listDevices()
      .then((result) => { if (live) setDevices(result.devices); })
      .catch(() => { if (live) { setDevices([]); setError("Could not read the list of approved computers."); } });
    return () => { live = false; };
  }, []);

  async function forget(device: ApprovedDevice) {
    setBusy(device.id);
    setError(null);
    try {
      await forgetDevice(device.id);
      setDevices((current) => (current ?? []).filter((item) => item.id !== device.id));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function signOutAll() {
    setBusy("everywhere");
    setError(null);
    try {
      await signOutEverywhere();
      props.onSignedOutEverywhere();
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(null);
    }
  }

  return (
    <Dialog
      open
      onClose={props.onCancel}
      busy={busy !== null}
      width="30rem"
      title="Approved computers"
      description="Each of these can save, sync, and open the folders on your account. Take one back if you no longer have it or no longer trust it."
      actions={
        <>
          {confirmingAll ? (
            <>
              <button type="button" className="gf-button-secondary" onClick={() => setConfirmingAll(false)} disabled={busy !== null}>Keep signed in</button>
              <button type="button" className="gf-button-primary" onClick={() => void signOutAll()} disabled={busy !== null}>
                {busy === "everywhere" ? "Signing out…" : "Sign out of every browser"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="gf-button-secondary" onClick={() => setConfirmingAll(true)} disabled={busy !== null}>Sign out everywhere</button>
              <button type="button" className="gf-button-primary" onClick={props.onCancel} disabled={busy !== null}>Done</button>
            </>
          )}
        </>
      }
    >
      {devices === null && <p className="gf-faint mt-4 text-[13px]">Reading…</p>}
      {devices !== null && devices.length === 0 && !error && (
        <p className="gf-faint mt-4 text-[13px]">No computers are approved on this account. The command line asks for approval the first time it connects a folder.</p>
      )}
      {devices && devices.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--gf-line)]">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">
                  {device.name}
                  {device.thisOne && <span className="gf-faint font-normal"> · this computer</span>}
                </p>
                <p className="gf-faint text-[12px]">
                  Approved {whenLabel(device.approvedAt)}
                  {device.lastUsedAt ? ` · last used ${whenLabel(device.lastUsedAt)}` : " · not used yet"}
                </p>
              </div>
              <button
                type="button"
                className="gf-button-ghost"
                onClick={() => void forget(device)}
                disabled={busy !== null}
                aria-label={`Take back the approval for ${device.name}`}
              >
                {busy === device.id ? "Taking back…" : "Take back"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {confirmingAll && (
        <p className="mt-3 text-[13px]">Every browser signed in to this account will be signed out, including this one. Approved computers are not affected.</p>
      )}
      {error && <p className="mt-2 text-[13px] font-semibold" role="alert">{error}</p>}
    </Dialog>
  );
}

const BILLING_PLANS: PlanCode[] = ["starter", "plus", "studio"];
const BILLING_STATUSES = new Set<AccountPlan["status"]>(["trialing", "active", "past_due", "canceled", "paused"]);

function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function dateLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function planName(code: PlanCode | null): string {
  return code ? code[0].toUpperCase() + code.slice(1) : "Hosted";
}

/** Account billing actions live here so every route is still behind the signed-in dashboard. */
export function BillingDialog(props: {
  plan: AccountPlan | null;
  initialPlan?: PlanCode;
  initialInterval?: BillingInterval;
  onCancel: () => void;
  onPlanUpdated: (plan: AccountPlan) => void;
}) {
  const [plans, setPlans] = useState<Record<PlanCode, PlanDefinition> | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanCode>(props.initialPlan ?? "plus");
  const [interval, setInterval] = useState<BillingInterval>(props.initialInterval ?? "month");
  const [cap, setCap] = useState(String(props.plan?.overageCapCents ?? 0));
  const [busy, setBusy] = useState<"checkout" | "portal" | "cap" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getPlans()
      .then((result) => { if (live) setPlans(result); })
      .catch((failure) => { if (live) setError((failure as Error).message); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    setCap(String(props.plan?.overageCapCents ?? 0));
  }, [props.plan?.overageCapCents]);

  const refresh = async () => {
    setBusy("refresh");
    setError(null);
    try {
      const current = await getAccountPlan();
      props.onPlanUpdated(current);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const checkout = async () => {
    setBusy("checkout");
    setError(null);
    try {
      const result = await startHostedTrial(selectedPlan, interval);
      window.location.assign(result.url);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(null);
    }
  };

  const portal = async () => {
    setBusy("portal");
    setError(null);
    try {
      const result = await openBillingPortal();
      window.location.assign(result.url);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(null);
    }
  };

  const saveCap = async () => {
    setBusy("cap");
    setError(null);
    try {
      const updated = await setOverageCap(Number(cap));
      props.onPlanUpdated(updated);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const current = props.plan;
  const hasHostedBilling = current?.billingMode === "stripe";
  const canManage = current ? BILLING_STATUSES.has(current.status) : false;
  const canStart = current ? !["trialing", "active", "past_due"].includes(current.status) : false;
  const canSetCap = current?.status === "active" || current?.status === "past_due";
  const selectedDefinition = plans?.[selectedPlan];
  const currentPeriod = dateLabel(current?.currentPeriodEnd ?? null);
  const trialEnd = dateLabel(current?.trialEndsAt ?? null);

  return (
    <Dialog
      open
      onClose={props.onCancel}
      busy={busy !== null}
      width="35rem"
      title="Plan and storage"
      description="Choose the amount of protected storage you need. Hosted plans start with a 7-day trial; billing is handled securely by Stripe."
      actions={
        <>
          <button type="button" className="gf-button-secondary" onClick={props.onCancel} disabled={busy !== null}>Done</button>
          {canManage && (
            <button type="button" className="gf-button-primary" onClick={() => void portal()} disabled={busy !== null}>
              {busy === "portal" ? "Opening…" : "Manage billing"}
            </button>
          )}
        </>
      }
    >
      {current === null && <p className="gf-faint mt-4 text-[13px]">Reading your plan…</p>}
      {current && (
        <div className="mt-4 rounded-xl border border-[var(--gf-line)] bg-[var(--gf-paper)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="gf-eyebrow">Current access</p>
              <p className="mt-1 text-[18px] font-semibold">{planName(current.planCode)}</p>
              <p className="gf-faint mt-1 text-[13px]">
                {current.status === "self_hosted" ? "Self-hosted account" : current.status === "none" ? "No hosted plan yet" : `${current.status.replace("_", " ")}${trialEnd ? ` · trial ends ${trialEnd}` : currentPeriod ? ` · renews ${currentPeriod}` : ""}`}
              </p>
            </div>
            <button type="button" className="gf-button-ghost" onClick={() => void refresh()} disabled={busy !== null}>
              {busy === "refresh" ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {current.authorizedBytes !== null && (
            <p className="gf-faint mt-3 text-[13px]">
              {formatBytes(current.usageBytes + current.reservedBytes)} of {formatBytes(current.authorizedBytes)} protected
            </p>
          )}
        </div>
      )}

      {current?.billingMode === "disabled" && (
        <p className="mt-4 rounded-lg border border-[var(--gf-line)] px-3 py-2 text-[13px]" role="status">
          Hosted billing is not enabled for this account yet. The checkout actions will become available when Stripe is enabled.
        </p>
      )}

      {hasHostedBilling && current && canStart && (
        <>
          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="gf-eyebrow">Choose a plan</p>
            <div className="inline-flex rounded-full border border-[var(--gf-line)] bg-white p-1" role="tablist" aria-label="Billing interval">
              {(["month", "year"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={interval === value}
                  onClick={() => setInterval(value)}
                  className={`rounded-full px-3 py-1 text-[12px] font-medium ${interval === value ? "bg-[var(--gf-ink)] text-white" : "text-[var(--gf-ink-soft)]"}`}
                >
                  {value === "month" ? "Monthly" : "Yearly · save 20%"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Hosted plan">
            {BILLING_PLANS.map((code) => {
              const definition = plans?.[code];
              const active = selectedPlan === code;
              const price = definition ? (interval === "month" ? definition.monthlyPriceCents : definition.annualPriceCents) : null;
              return (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelectedPlan(code)}
                  className={`rounded-xl border p-3 text-left ${active ? "border-[var(--gf-blue-ink)] bg-[var(--gf-blue-soft)]" : "border-[var(--gf-line)]"}`}
                >
                  <span className="block text-[13px] font-semibold">{planName(code)}</span>
                  <span className="gf-faint mt-1 block text-[12px]">{definition ? `${formatBytes(definition.includedBytes)} included` : "Reading…"}</span>
                  <span className="mt-2 block text-[15px] font-semibold">{price === null ? "—" : `${money(price)}${interval === "month" ? "/mo" : "/yr"}`}</span>
                </button>
              );
            })}
          </div>
          {selectedDefinition && <p className="gf-faint mt-3 text-[12px]">Extra capacity is {money(selectedDefinition.overageCentsPerGbMonth)} per GB-month.</p>}
          {error && <p className="mt-3 text-[13px] font-semibold" role="alert">{error}</p>}
          <button type="button" className="gf-button-primary mt-4 w-full" onClick={() => void checkout()} disabled={busy !== null || !selectedDefinition}>
            {busy === "checkout" ? "Opening secure checkout…" : `Start ${planName(selectedPlan)} trial`}
          </button>
        </>
      )}

      {canSetCap && (
        <div className="mt-5 border-t border-[var(--gf-line)] pt-4">
          <p className="gf-eyebrow">Extra-capacity spending limit</p>
          <p className="gf-faint mt-1 text-[12px]">Set the maximum monthly overage charge. Choose $0 to pause extra capacity.</p>
          <div className="mt-3 flex items-end gap-2">
            <label className="flex-1">
              <span className="sr-only">Monthly overage cap</span>
              <select className="gf-input" value={cap} onChange={(event) => setCap(event.target.value)} disabled={busy !== null}>
                {Array.from({ length: 11 }, (_, index) => index * 1000).map((value) => (
                  <option key={value} value={value}>{money(value)} per month</option>
                ))}
              </select>
            </label>
            <button type="button" className="gf-button-secondary" onClick={() => void saveCap()} disabled={busy !== null || Number(cap) === current?.overageCapCents}>
              {busy === "cap" ? "Saving…" : "Save limit"}
            </button>
          </div>
        </div>
      )}

      {error && !(hasHostedBilling && current && canStart) && <p className="mt-3 text-[13px] font-semibold" role="alert">{error}</p>}
    </Dialog>
  );
}
