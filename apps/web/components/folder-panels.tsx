"use client";

import { useState } from "react";
import {
  addProposalComment,
  inviteContributor,
  reviewProposal,
  type ChangeProposal,
  type Folder,
} from "@/lib/gf-api";
import { PeopleIcon, ProposalIcon } from "@/components/icons";
import { Badge, EmptyState, ReviewBadge, done, problem } from "@/components/ui";
import type { Notify, Role } from "@/components/document-surface";

/* --------------------------------------------------------------------------
   The two panels that are about a whole folder rather than one file: what is
   waiting for a decision, and who can see it. Lifted out of the old four-tab
   workspace unchanged.
-------------------------------------------------------------------------- */

/* -------------------------------------------------------------- Proposals */

export function ProposalList({
  folder,
  role,
  proposals,
  onChanged,
  onNotice,
}: {
  folder: Folder;
  role: Role;
  proposals: ChangeProposal[];
  onChanged: () => Promise<void>;
  onNotice: Notify;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

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
        {proposals.map((proposal) => (
          <article key={proposal.id} className="gf-card p-5 sm:p-6">
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
                  {suggestion.kind === "table_update" ? (
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
                  {role === "owner" && suggestion.status === "open" && (
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
        ))}

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
