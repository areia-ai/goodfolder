"use client";

import { useEffect, useRef, useState } from "react";
import {
  addProposalComment,
  changesTheFolder,
  inviteContributor,
  readProposalAssetPreview,
  reviewProposal,
  type ChangeProposal,
  type Folder,
  type ProposalSuggestion,
} from "@/lib/gf-api";
import { formatBytes, previewKindFor } from "@/lib/preview";
import type { WorkspaceProposal } from "@/lib/gf-api";
import { FilePreview } from "@/components/file-preview";
import { PeopleIcon, ProposalIcon } from "@/components/icons";
import { Badge, EmptyState, ReviewBadge, done, problem } from "@/components/ui";
import type { Notify, Role } from "@/components/document-surface";

/* --------------------------------------------------------------------------
   The two panels that are about a whole folder rather than one file: what is
   waiting for a decision, and who can see it. Lifted out of the old four-tab
   workspace unchanged.
-------------------------------------------------------------------------- */

/* -------------------------------------------------------------- Proposals */

export function WorkspaceProposalList({ proposals, onReview, onNotice }: {
  proposals: WorkspaceProposal[];
  onReview: (proposalId: string, action: "accept" | "reject") => Promise<void>;
  onNotice: Notify;
}) {
  return (
    <Section title="New GoodFolders" description="An agent can prepare a new empty GoodFolder here. It exists only after you accept it.">
      <div className="grid gap-3.5">
        {proposals.map((proposal) => (
          <article key={proposal.id} className="gf-card p-5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-[16px] font-bold">{proposal.name}</h3>
                <p className="gf-faint mt-1 text-[12px]">{proposal.authorEmail}</p>
                <p className="gf-body mt-3 text-[14px]">{proposal.explanation}</p>
              </div>
              <ReviewBadge status={proposal.status} />
            </div>
            {proposal.status === "open" && (
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="gf-button-secondary" onClick={() => void onReview(proposal.id, "reject").catch((error) => onNotice(problem((error as Error).message)))}>Reject</button>
                <button type="button" className="gf-button-primary" onClick={() => void onReview(proposal.id, "accept").catch((error) => onNotice(problem((error as Error).message)))}>Create folder</button>
              </div>
            )}
          </article>
        ))}
        {proposals.length === 0 && <EmptyState icon={<ProposalIcon />} title="No new folders waiting for review">When an agent proposes a new empty GoodFolder, it will appear here.</EmptyState>}
      </div>
    </Section>
  );
}

export function ProposalList({
  folder,
  role,
  proposals,
  focusedProposalId,
  onChanged,
  onNotice,
}: {
  folder: Folder;
  role: Role;
  proposals: ChangeProposal[];
  focusedProposalId?: string | null;
  onChanged: () => Promise<void>;
  onNotice: Notify;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const focusedProposal = useRef<HTMLElement>(null);

  useEffect(() => {
    focusedProposal.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedProposalId]);

  async function review(proposal: ChangeProposal, action: "accept" | "reject", suggestionId?: string) {
    try {
      await reviewProposal(folder.id, proposal.id, { action, suggestionId });
      await onChanged();
    } catch (e) {
      onNotice(problem((e as Error).message));
    }
  }

  return (
    <Section
      title="Change Proposals"
      description="Suggestions from people and agents stay separate until the folder owner accepts them."
    >
      <div className="grid gap-3.5">
        {proposals.map((proposal) => {
          const reviewTogether = proposal.suggestions.length > 1 &&
            proposal.suggestions.some((suggestion) => suggestion.kind === "asset_replace") &&
            proposal.suggestions.some((suggestion) => !changesTheFolder(suggestion.kind));
          return (
          <article
            key={proposal.id}
            ref={proposal.id === focusedProposalId ? focusedProposal : undefined}
            data-review-proposal={proposal.id === focusedProposalId ? "focused" : undefined}
            className={`gf-card p-5 sm:p-6 ${proposal.id === focusedProposalId ? "ring-2 ring-[var(--gf-blue-ink)]" : ""}`}
          >
            <div className="flex flex-wrap items-start gap-3">
              {/* basis keeps the title on its own row before it gets squeezed. */}
              <div className="min-w-0 flex-1 basis-72">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[16px] font-bold tracking-[-.015em]">{proposal.title}</h3>
                  <ReviewBadge status={proposal.status} />
                </div>
                <p className="gf-faint mt-1 text-[13px]">
                  {proposal.authorEmail} · {new Date(proposal.createdAt).toLocaleDateString()}
                </p>
                {proposal.explanation && <p className="gf-body mt-3 text-[14px]">{proposal.explanation}</p>}
              </div>
              {role === "owner" && proposal.status === "open" && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => review(proposal, "reject")} className="gf-button-secondary">
                    Reject all
                  </button>
                  <button type="button" onClick={() => review(proposal, "accept")} className="gf-button-primary">
                    Accept all
                  </button>
                </div>
              )}
            </div>

            <div className="mt-5 grid gap-3">
              {reviewTogether && (
                <p className="rounded-[var(--gf-radius)] border border-[var(--gf-line)] bg-[var(--gf-blue-soft)] px-3 py-2 text-[12.5px]">
                  The media and its document reference travel together. Accept or reject the whole proposal.
                </p>
              )}
              {proposal.suggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="rounded-[var(--gf-radius)] border border-[var(--gf-line)] bg-[var(--gf-surface-sunken)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-medium">
                      {suggestion.path}
                      {suggestion.section ? ` · ${suggestion.section}` : ""}
                    </p>
                    <ReviewBadge status={suggestion.status} />
                  </div>
                  {changesTheFolder(suggestion.kind) ? (
                    <FolderChange folderId={folder.id} proposalId={proposal.id} suggestion={suggestion} />
                  ) : suggestion.kind === "table_update" ? (
                    <div className="mt-3 rounded-[var(--gf-radius)] border border-[var(--gf-line)] bg-white p-3">
                      <span className="gf-change-label">Cell changes</span>
                      <div className="mt-2 grid gap-2">
                        {(suggestion.operation?.changes ?? []).map((cell) => (
                          <div key={`${suggestion.id}-${cell.address}`} className="grid grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-[12.5px]">
                            <span className="font-mono font-semibold">{cell.address}</span>
                            <span className="break-words text-[var(--gf-ink-muted)]">{cell.before || "(empty)"}</span>
                            <span className="break-words font-semibold">{cell.replacement || "(empty)"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <div>
                        <span className="gf-change-label">Now</span>
                        <pre className="gf-change gf-change-before">{suggestion.before}</pre>
                      </div>
                      <div>
                        <span className="gf-change-label">Suggested</span>
                        <pre className="gf-change gf-change-after">{suggestion.replacement}</pre>
                      </div>
                    </div>
                  )}
                  {suggestion.explanation && <p className="gf-body mt-2.5 text-[12.5px]">{suggestion.explanation}</p>}
                  {role === "owner" && suggestion.status === "open" && !reviewTogether && (
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => review(proposal, "reject", suggestion.id)}
                        className="gf-button-secondary"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => review(proposal, "accept", suggestion.id)}
                        className="gf-button-primary"
                      >
                        Accept
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <form
              className="mt-4 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const body = (drafts[proposal.id] ?? "").trim();
                if (!body) return;
                try {
                  await addProposalComment(folder.id, proposal.id, body);
                  setDrafts((d) => ({ ...d, [proposal.id]: "" }));
                  onNotice(done("Your comment was added."));
                } catch (err) {
                  onNotice(problem((err as Error).message));
                }
              }}
            >
              <label htmlFor={`comment-${proposal.id}`} className="sr-only">
                Add a comment to {proposal.title}
              </label>
              <input
                id={`comment-${proposal.id}`}
                value={drafts[proposal.id] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [proposal.id]: e.target.value }))}
                placeholder="Add a comment"
                className="gf-input flex-1"
              />
              <button type="submit" className="gf-button-secondary">
                Comment
              </button>
            </form>
          </article>
          );
        })}

        {proposals.length === 0 && (
          <EmptyState icon={<ProposalIcon />} title="No Change Proposals yet">
            When a contributor or an agent suggests something, it arrives here with the current text beside the
            suggested text — and changes nothing until you accept it.
          </EmptyState>
        )}
      </div>
    </Section>
  );
}

/**
 * A suggestion that changes which files the folder holds.
 *
 * There is no passage to put beside another passage here — the whole change
 * is one sentence, so the card is that sentence and the name it concerns.
 * The one about adding says how big the waiting file is, because that is the
 * question an owner actually has about a file they cannot see yet.
 */
function FolderChange({ folderId, proposalId, suggestion }: { folderId: string; proposalId: string; suggestion: ProposalSuggestion }) {
  const name = suggestion.path.split("/").pop() || suggestion.path;
  const to = suggestion.operation?.to ?? "";
  const size = suggestion.operation?.sizeBytes;
  // A name with no slash in it is at the top of the folder, not one character
  // short of itself — which is what a bare lastIndexOf would have said.
  const holding = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const moving = holding(to) !== holding(suggestion.path);
  const renaming = (to.split("/").pop() || to) !== name;
  const there = holding(to) || "the top of the folder";
  return (
    <div className="mt-3 rounded-[var(--gf-radius)] border border-[var(--gf-line)] bg-white p-3">
      {suggestion.kind === "path_rename" && (
        <p className="text-[13px]">
          {renaming ? (
            <>
              Rename <b className="font-mono text-[12.5px]">{name}</b> to{" "}
              <b className="font-mono text-[12.5px]">{to.split("/").pop() || to}</b>
              {moving && <> — and move it to <span className="font-mono text-[12.5px]">{there}</span></>}.
            </>
          ) : (
            <>
              Move <b className="font-mono text-[12.5px]">{name}</b> to{" "}
              <span className="font-mono text-[12.5px]">{there}</span>.
            </>
          )}
        </p>
      )}
      {suggestion.kind === "path_remove" && (
        <p className="text-[13px]">
          Take <b className="font-mono text-[12.5px]">{name}</b> out of the folder. Every earlier Save still holds it.
        </p>
      )}
      {suggestion.kind === "asset_replace" && (
        <>
          <p className="text-[13px]">
            {suggestion.baseFileSha ? "Replace" : "Add"} <b className="font-mono text-[12.5px]">{name}</b>
            {typeof size === "number" ? <> — {formatBytes(size)}</> : null}. Nothing is in the folder until you accept it.
          </p>
          {previewKindFor(suggestion.path) && (
            <ProposedFilePreview folderId={folderId} proposalId={proposalId} suggestion={suggestion} />
          )}
        </>
      )}
    </div>
  );
}

function ProposedFilePreview({ folderId, proposalId, suggestion }: {
  folderId: string;
  proposalId: string;
  suggestion: ProposalSuggestion;
}) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function openPreview() {
    setLoading(true);
    setError("");
    try {
      setBlob(await readProposalAssetPreview(folderId, proposalId, suggestion.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  if (blob) {
    return (
      <div className="mt-3 overflow-hidden rounded-[var(--gf-radius)] border border-[var(--gf-line)] bg-white">
        <FilePreview file={{ path: suggestion.path, sha: "waiting-for-review", size: blob.size, kind: previewKindFor(suggestion.path), blob, mimeType: suggestion.operation?.mimeType ?? null, storedForDevice: false }} />
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" className="gf-button-secondary" disabled={loading} onClick={openPreview}>
        {loading ? "Opening proposed file…" : "Preview proposed file"}
      </button>
      {error && <p className="text-[12.5px] text-[var(--gf-red-ink)]">{error}</p>}
    </div>
  );
}

/* ----------------------------------------------------------------- People */

export function PeopleView({
  folder,
  role,
  people,
  onChanged,
  onNotice,
}: {
  folder: Folder;
  role: Role;
  people: Array<{ email: string; role: Role }>;
  onChanged: () => Promise<void>;
  onNotice: Notify;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Section
      title="People"
      description="Contributors can read, comment, and send Change Proposals. They can't replace the owner's work directly."
    >
      <ul className="grid gap-2.5">
        {people.map((person) => (
          <li key={person.email} className="gf-card flex items-center gap-3.5 p-4">
            <span className="gf-avatar shrink-0">{person.email[0]?.toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="gf-truncate block text-[14px] font-medium">{person.email}</span>
            </span>
            <Badge tone={person.role === "owner" ? "strong" : "open"}>
              {person.role === "owner" ? "Owner" : "Contributor"}
            </Badge>
          </li>
        ))}
        {people.length === 0 && (
          <li>
            <EmptyState icon={<PeopleIcon />} title="Nobody else is here yet">
              Invite someone by email and they can read this folder, comment on passages, and send Change Proposals.
            </EmptyState>
          </li>
        )}
      </ul>

      {role === "owner" && (
        <form
          className="gf-card mt-5 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await inviteContributor(folder.id, email);
              onNotice(done(`An invitation was emailed to ${email}.`));
              setEmail("");
              await onChanged();
            } catch (err) {
              onNotice(problem((err as Error).message));
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3 className="gf-h3">Invite a contributor</h3>
          <p className="gf-body mt-1 text-[13.5px]">
            They can read, comment, and send Change Proposals. Only you can save directly or decide what is accepted.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <label htmlFor="gf-invite" className="sr-only">
              Email address of the person to invite
            </label>
            <input
              id="gf-invite"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              className="gf-input min-w-[13rem] flex-1"
            />
            <button type="submit" disabled={busy} className="gf-button-primary">
              {busy ? "Sending…" : "Send invitation"}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}
/* ------------------------------------------------------------- Scaffolding */

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[20px] font-bold tracking-[-.02em]">{title}</h2>
      <p className="gf-body mt-1.5 max-w-2xl text-[13.5px]">{description}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}
