"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addProposalComment,
  addDocumentComment,
  createProposal,
  inviteContributor,
  listFiles,
  listPeople,
  listDocumentComments,
  listProposals,
  listSaves,
  openFile as openFolderFile,
  readFile,
  reviewProposal,
  saveDocument,
  type ChangeProposal,
  type Folder,
  type FolderFile,
  type OpenedFile,
  type SaveRow,
} from "@/lib/gf-api";
import {
  ImagePreview,
  AudioPreview,
  PdfPreview,
  QuickLookPreview,
  SheetPreview,
  SlidesPreview,
  UnsupportedView,
  VideoPreview,
  WordPreview,
} from "@/components/file-viewers";
import { DelimitedTableEditor, type DelimitedTableChange } from "@/components/delimited-table-editor";
import type { TableEdit } from "@/lib/table";
import { Timeline, TimelineSkeleton } from "@/components/timeline";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  CommentIcon,
  DocumentIcon,
  DownloadIcon,
  FileIcon,
  PeopleIcon,
  PlusIcon,
  ProposalIcon,
  ShieldIcon,
  TimelineIcon,
} from "@/components/icons";
import {
  Badge,
  EmptyState,
  Notice,
  ReviewBadge,
  Skeleton,
  done,
  problem,
  type NoticeMessage,
} from "@/components/ui";

type Tab = "files" | "timeline" | "proposals" | "people";
type Role = "owner" | "contributor";
type Notify = (n: NoticeMessage | null) => void;

const TABS: Array<{ id: Tab; label: string; Glyph: (p: { className?: string }) => React.ReactElement }> = [
  { id: "files", label: "Files", Glyph: DocumentIcon },
  { id: "timeline", label: "Timeline", Glyph: TimelineIcon },
  { id: "proposals", label: "Change Proposals", Glyph: ProposalIcon },
  { id: "people", label: "People", Glyph: PeopleIcon },
];

function markdownToHtml(value: string): string {
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
    .split(/\n{2,}/)
    .map((block) => (/^(<h|<blockquote|<li)/.test(block) ? block : `<p>${block.replace(/\n/g, "<br>")}</p>`))
    .join("");
}

function htmlToMarkdown(root: HTMLElement): string {
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const body = [...node.childNodes].map(walk).join("");
    switch (node.tagName) {
      case "H1": return `# ${body}\n\n`;
      case "H2": return `## ${body}\n\n`;
      case "H3": return `### ${body}\n\n`;
      case "P": return `${body}\n\n`;
      case "BR": return "\n";
      case "STRONG": case "B": return `**${body}**`;
      case "EM": case "I": return `*${body}*`;
      case "BLOCKQUOTE": return `> ${body.trim()}\n\n`;
      case "LI": return `- ${body.trim()}\n`;
      case "A": return `[${body}](${node.getAttribute("href") ?? ""})`;
      default: return body;
    }
  }
  return walk(root).replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Files grouped under the directory they live in, root entries first. */
function groupByDirectory(files: FolderFile[]): Array<{ dir: string; files: FolderFile[] }> {
  const groups = new Map<string, FolderFile[]>();
  for (const file of files) {
    const cut = file.path.lastIndexOf("/");
    const dir = cut < 0 ? "" : file.path.slice(0, cut);
    const bucket = groups.get(dir);
    if (bucket) bucket.push(file);
    else groups.set(dir, [file]);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0])))
    .map(([dir, list]) => ({ dir, files: list }));
}

function baseName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? path : path.slice(cut + 1);
}

/* ========================================================================== */

export function FolderWorkspace({ folder }: { folder: Folder }) {
  const [tab, setTab] = useState<Tab>("files");
  const [files, setFiles] = useState<FolderFile[]>([]);
  const [head, setHead] = useState<string | null>(null);
  const [role, setRole] = useState<Role>(folder.role ?? "owner");
  const [selected, setSelected] = useState<OpenedFile | null>(null);
  const [saves, setSaves] = useState<SaveRow[] | null>(null);
  const [proposals, setProposals] = useState<ChangeProposal[]>([]);
  const [people, setPeople] = useState<Array<{ email: string; role: Role }>>([]);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const tabStrip = useRef<HTMLDivElement>(null);

  async function refresh() {
    setLoading(true);
    setNotice(null);
    try {
      const [fileData, timeline, proposalData, peopleData] = await Promise.all([
        listFiles(folder.id),
        listSaves(folder.id),
        listProposals(folder.id),
        listPeople(folder.id),
      ]);
      setFiles(fileData.files);
      setHead(fileData.head);
      setRole(fileData.role);
      setSaves(timeline);
      setProposals(proposalData.proposals);
      setPeople(peopleData.people);
      const requestedPath = new URLSearchParams(window.location.search).get("file");
      const requestedFile = fileData.files.find((file) => file.path === requestedPath);
      if (requestedFile) {
        const opened = await openFolderFile(folder.id, requestedFile);
        setSelected(opened);
        setFiles((current) => current.map((file) =>
          file.path === opened.path ? { ...file, size: opened.size } : file,
        ));
      }
    } catch (e) {
      setNotice(problem((e as Error).message));
    } finally {
      setLoading(false);
    }
  }

  const refreshProposals = useCallback(async () => {
    try {
      const proposalData = await listProposals(folder.id);
      setRole(proposalData.role);
      setProposals(proposalData.proposals);
    } catch (e) {
      setNotice(problem((e as Error).message));
    }
  }, [folder.id]);

  useEffect(() => {
    function onProposalCreated(event: Event) {
      const detail = (event as CustomEvent<{ folderId?: string }>).detail;
      if (detail?.folderId !== folder.id) return;
      void refreshProposals();
    }
    window.addEventListener("proposal-created", onProposalCreated);
    return () => window.removeEventListener("proposal-created", onProposalCreated);
  }, [folder.id, refreshProposals]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder.id]);

  function closeFile() {
    history.replaceState(null, "", `/dashboard?folder=${encodeURIComponent(folder.id)}`);
    setSelected(null);
  }

  async function reviewFromWorkspace(proposal: ChangeProposal, action: "accept" | "reject") {
    try {
      const result = await reviewProposal(folder.id, proposal.id, { action });
      if (result.head) setHead(result.head);
      await refresh();
      if (result.saveNumber) {
        setNotice(done(`Accepted changes to ${proposal.suggestions[0]?.path ?? "the file"} and saved #${result.saveNumber}.`));
      } else if (result.status === "needs-review") {
        setNotice(problem("This proposal no longer matches the current file. It needs a fresh review and nothing was changed."));
      } else if (action === "reject") {
        setNotice(done("The proposal was rejected. No Save was created."));
      }
    } catch (e) {
      setNotice(problem((e as Error).message));
    }
  }

  async function openFile(file: FolderFile) {
    setNotice(null);
    try {
      history.replaceState(
        null,
        "",
        `/dashboard?folder=${encodeURIComponent(folder.id)}&file=${encodeURIComponent(file.path)}`,
      );
      const opened = await openFolderFile(folder.id, file);
      setSelected(opened);
      setFiles((current) => current.map((item) =>
        item.path === opened.path ? { ...item, size: opened.size } : item,
      ));
    } catch (e) {
      setNotice(problem((e as Error).message));
    }
  }

  // On a narrow screen the strip can scroll; keep the chosen tab visible.
  useEffect(() => {
    tabStrip.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  // Arrow keys move between tabs, as a tablist is expected to.
  function onTabKey(e: React.KeyboardEvent) {
    const order = TABS.map((t) => t.id);
    const at = order.indexOf(tab);
    const next =
      e.key === "ArrowRight" ? order[(at + 1) % order.length]
      : e.key === "ArrowLeft" ? order[(at - 1 + order.length) % order.length]
      : e.key === "Home" ? order[0]
      : e.key === "End" ? order[order.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabStrip.current?.querySelector<HTMLElement>(`#tab-${next}`)?.focus();
  }

  const openProposals = proposals.filter((p) => p.status === "open" || p.status === "needs-review").length;

  return (
    <div>
      {/* Workspace header ------------------------------------------------ */}
      <div className="border-b border-[var(--gf-line)] bg-white">
        <div className="px-4 pt-6 sm:px-7 lg:px-10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[22px] font-bold tracking-[-.025em] sm:text-[26px]">{folder.name}</h1>
              <p className="gf-faint mt-1 text-[13px]">
                {role === "owner" ? "Your folder" : "Shared with you"} ·{" "}
                <span className="gf-num">{files.length}</span> {files.length === 1 ? "file" : "files"}
              </p>
            </div>
            <Badge tone="open" icon={<ShieldIcon />}>
              Protected
            </Badge>
          </div>

          <div ref={tabStrip} onKeyDown={onTabKey} className="gf-tabs mt-5" role="tablist" aria-label="Folder sections">
            {TABS.map(({ id, label, Glyph }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`panel-${id}`}
                onClick={() => setTab(id)}
                className="gf-tab"
              >
                <Glyph />
                {label}
                {id === "proposals" && openProposals > 0 && (
                  <span className="gf-tab-count">
                    {openProposals}
                    <span className="sr-only"> waiting for review</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Panels ---------------------------------------------------------- */}
      <div className="px-4 py-6 sm:px-7 sm:py-8 lg:px-10">
        {notice && <Notice message={notice} className="mb-5" />}

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={-1}>
          {loading ? (
            <WorkspaceSkeleton tab={tab} />
          ) : tab === "files" ? (
            <FilesView
              files={files}
              selected={selected}
              head={head}
              role={role}
              folder={folder}
              onOpen={openFile}
              onClose={closeFile}
              onSaved={(next) => {
                setHead(next);
                void refresh();
              }}
              proposals={proposals}
              onRefreshProposals={refreshProposals}
              onReviewProposal={reviewFromWorkspace}
              onNotice={setNotice}
            />
          ) : tab === "timeline" ? (
            <Section
              title="Timeline"
              description="Every save stays readable and reversible. Going back happens on the computer where this folder lives."
            >
              <Timeline saves={saves} />
            </Section>
          ) : tab === "proposals" ? (
            <ProposalList
              folder={folder}
              role={role}
              proposals={proposals}
              onChanged={refresh}
              onNotice={setNotice}
            />
          ) : (
            <PeopleView folder={folder} role={role} people={people} onChanged={refresh} onNotice={setNotice} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Files */

interface FilesProps {
  files: FolderFile[];
  selected: OpenedFile | null;
  head: string | null;
  role: Role;
  folder: Folder;
  proposals: ChangeProposal[];
  onOpen: (f: FolderFile) => void;
  onClose: () => void;
  onSaved: (head: string) => void;
  onRefreshProposals: () => Promise<void>;
  onReviewProposal: (proposal: ChangeProposal, action: "accept" | "reject") => Promise<void>;
  onNotice: Notify;
}

function FilesView(props: FilesProps) {
  const groups = useMemo(() => groupByDirectory(props.files), [props.files]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  async function createDocument(e: React.FormEvent) {
    e.preventDefault();
    const entered = newName.trim();
    if (!entered) return;
    const path = `${entered.replace(/[^A-Za-z0-9 _.-]+/g, "-").replace(/\s+/g, "-").replace(/\.md$/i, "")}.md`;
    if (props.files.some((file) => file.path.toLowerCase() === path.toLowerCase())) {
      props.onNotice(problem("A document with that name already exists in this folder."));
      return;
    }
    setBusy(true);
    try {
      const result = await saveDocument(props.folder.id, {
        path,
        content: `# ${entered}\n`,
        baseHead: props.head,
        label: `Created ${entered}`,
      });
      props.onSaved(result.head);
      props.onNotice(done(`${path} was created and saved.`));
      setCreating(false);
      setNewName("");
    } catch (e) {
      props.onNotice(problem((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gf-card gf-card-lg grid overflow-hidden xl:min-h-[640px] xl:grid-cols-[280px_minmax(0,1fr)]">
      {/* Below xl this is master/detail: the list, or the document, not both. */}
      <aside
        className={`border-b border-[var(--gf-line)] bg-[var(--gf-surface-sunken)] xl:block xl:border-b-0 xl:border-r ${
          props.selected ? "hidden" : ""
        }`}
      >
        <div className="flex items-center gap-3 border-b border-[var(--gf-line)] px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="gf-h3">Files</h2>
            <p className="gf-faint mt-0.5 text-[12px]">
              <span className="gf-num">{props.files.length}</span> in this folder
            </p>
          </div>
          {props.role === "owner" && (
            <button
              type="button"
              className="gf-icon-button"
              aria-label="New document"
              aria-expanded={creating}
              onClick={() => setCreating((v) => !v)}
            >
              <PlusIcon />
            </button>
          )}
        </div>

        {creating && (
          <form onSubmit={createDocument} className="border-b border-[var(--gf-line)] bg-white p-3">
            <label htmlFor="gf-new-doc" className="gf-label">
              Name your document
            </label>
            <input
              id="gf-new-doc"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Meeting notes"
              className="gf-input"
            />
            <div className="mt-2 flex gap-2">
              <button type="submit" disabled={busy || !newName.trim()} className="gf-button-primary flex-1">
                {busy ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
                className="gf-button-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="p-2 xl:max-h-[560px] xl:overflow-auto">
          {groups.map((group) => (
            <div key={group.dir || "/"} className="mb-1">
              {group.dir && (
                <p className="gf-faint flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-semibold">
                  <ChevronDownIcon className="h-3 w-3" />
                  <span className="gf-truncate">{group.dir}</span>
                </p>
              )}
              {group.files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => props.onOpen(file)}
                  aria-current={props.selected?.path === file.path ? "true" : undefined}
                  className="gf-file-row"
                >
                  {file.editable ? <DocumentIcon /> : <FileIcon />}
                  <span className="gf-truncate flex-1">{baseName(file.path)}</span>
                  <small>{prettySize(file.size)}</small>
                </button>
              ))}
            </div>
          ))}
          {props.files.length === 0 && (
            <p className="gf-body p-5 text-sm">
              Nothing has been saved here yet. Once work is saved into this folder, the files show up in this list.
            </p>
          )}
        </div>
      </aside>

      <div className={`min-w-0 bg-white ${props.selected ? "" : "hidden xl:block"}`}>
        {props.selected ? (
          <DocumentView {...props} file={props.selected} />
        ) : (
          <div className="grid min-h-[400px] place-items-center p-8 text-center xl:min-h-[560px]">
            <div className="max-w-sm">
              <span className="gf-folder-glyph mx-auto h-14 w-14">
                <DocumentIcon />
              </span>
              <h3 className="mt-5 text-[19px] font-bold tracking-[-.02em]">Choose a file</h3>
              <p className="gf-body mt-2 text-[14px]">
                Read a document, look at what has happened to it, or prepare a change — without leaving the folder.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Document */

type DocumentComment = { id: string; quotedText?: string | null; body: string; authorEmail: string };

function announceProposalCreated(detail: { folderId: string; path: string; proposalId: string }) {
  window.dispatchEvent(new CustomEvent("proposal-created", { detail }));
}

function DocumentReviewPanel({
  path,
  role,
  proposals,
  comments,
  selection,
  commentDraft,
  onDraftChange,
  onComment,
  selectionHint,
  reviewTab,
  onReviewTab,
  onReviewProposal,
  focusedProposalId,
  dirty,
}: {
  path: string;
  role: Role;
  proposals: ChangeProposal[];
  comments: DocumentComment[];
  selection: string;
  commentDraft: string;
  onDraftChange: (value: string) => void;
  onComment: () => void;
  selectionHint: string;
  reviewTab: "comments" | "proposals";
  onReviewTab: (tab: "comments" | "proposals") => void;
  onReviewProposal: (proposal: ChangeProposal, action: "accept" | "reject") => void;
  focusedProposalId: string | null;
  dirty: boolean;
}) {
  const fileProposals = proposals.filter((proposal) => proposal.suggestions.some((suggestion) => suggestion.path === path));
  function onReviewTabKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const order = ["comments", "proposals"] as const;
    const current = order.indexOf(reviewTab);
    const next = event.key === "ArrowRight"
      ? order[(current + 1) % order.length]
      : event.key === "ArrowLeft"
        ? order[(current - 1 + order.length) % order.length]
        : event.key === "Home"
          ? order[0]
          : event.key === "End"
            ? order[order.length - 1]
            : null;
    if (!next) return;
    event.preventDefault();
    onReviewTab(next);
    window.requestAnimationFrame(() => document.getElementById(`review-tab-${next}`)?.focus());
  }
  return (
    <aside className="order-first border-b border-[var(--gf-line)] bg-[var(--gf-surface-sunken)] p-4 xl:order-last xl:border-b-0 xl:border-l">
      <div className="flex items-center justify-between gap-3">
        <h3 className="gf-h3">Review</h3>
        <span className="gf-faint text-[12px]">{comments.length + fileProposals.length} items</span>
      </div>
      <div className="gf-tabs mt-3" role="tablist" aria-label="Review sections" onKeyDown={onReviewTabKey}>
        {(["comments", "proposals"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`review-tab-${tab}`}
            aria-selected={reviewTab === tab}
            aria-controls={`review-panel-${tab}`}
            tabIndex={reviewTab === tab ? 0 : -1}
            onClick={() => onReviewTab(tab)}
            className="gf-tab min-h-10 px-2.5 text-[12px]"
          >
            {tab === "comments" ? "Comments" : "Proposals"}
            {tab === "comments" && comments.length > 0 && <span className="gf-tab-count">{comments.length}</span>}
            {tab === "proposals" && fileProposals.length > 0 && <span className="gf-tab-count">{fileProposals.length}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`review-panel-${reviewTab}`} aria-labelledby={`review-tab-${reviewTab}`} tabIndex={0} className="min-w-0">
        {reviewTab === "comments" ? (
          <>
          <p className="gf-body mt-3 text-[12.5px]">{selectionHint}</p>
          {selection && <p className="gf-faint mt-2 break-words text-[12px]">Anchored to: “{selection}”</p>}
          <div className="mt-4 grid gap-2.5">
            {comments.map((item) => (
              <div key={item.id} className="gf-card p-3">
                {item.quotedText && (
                  <blockquote className="gf-faint mb-2 border-l-2 border-[var(--gf-blue-ink)] pl-2 text-[12px]">
                    {item.quotedText}
                  </blockquote>
                )}
                <p className="text-[13.5px] leading-relaxed">{item.body}</p>
                <p className="gf-faint mt-2 text-[11px]">{item.authorEmail}</p>
              </div>
            ))}
            {comments.length === 0 && <p className="gf-faint text-[13px]">No comments on this file yet.</p>}
          </div>
          <label htmlFor="gf-doc-comment" className="gf-label mt-4">
            Add a comment
          </label>
          <textarea
            id="gf-doc-comment"
            value={commentDraft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder="What should the folder owner know?"
            className="gf-input min-h-24 resize-y"
          />
          <button type="button" onClick={onComment} disabled={!commentDraft.trim()} className="gf-button-primary gf-button-block mt-2">
            Add comment
          </button>
          </>
        ) : (
          <div className="mt-4 grid gap-3">
          {fileProposals.map((proposal) => (
            <article
              key={proposal.id}
              data-review-proposal={proposal.id === focusedProposalId ? "focused" : undefined}
              className={`gf-card p-3 ${proposal.id === focusedProposalId ? "ring-2 ring-[var(--gf-blue-ink)]" : ""}`}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-[13px] font-bold">{proposal.title}</h4>
                  <p className="gf-faint mt-1 text-[11px]">{proposal.authorEmail}</p>
                </div>
                <ReviewBadge status={proposal.status} />
              </div>
              {proposal.explanation && <p className="gf-body mt-2 text-[12.5px]">{proposal.explanation}</p>}
              <div className="mt-3 grid gap-2.5">
                {proposal.suggestions.filter((suggestion) => suggestion.path === path).map((suggestion) => {
                  const cells = suggestion.operation?.changes ?? [];
                  return suggestion.kind === "table_update" ? (
                    <div key={suggestion.id} className="rounded-[var(--gf-radius)] border border-[var(--gf-line)] bg-[var(--gf-surface-sunken)] p-2.5">
                      <p className="gf-change-label">Cell changes</p>
                      <div className="mt-2 grid gap-1.5">
                        {cells.map((cell) => (
                          <div key={`${suggestion.id}-${cell.address}`} className="grid grid-cols-[42px_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-[12px]">
                            <span className="font-mono font-semibold">{cell.address}</span>
                            <span className="break-words text-[var(--gf-ink-muted)]">{cell.before || "(empty)"}</span>
                            <span className="break-words font-semibold">{cell.replacement || "(empty)"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div key={suggestion.id} className="grid gap-1.5">
                      <p className="gf-change-label">Suggested text</p>
                      <pre className="gf-change gf-change-after max-h-40 overflow-auto">{suggestion.replacement}</pre>
                      <p className="gf-change-label">Replaces</p>
                      <pre className="gf-change gf-change-before max-h-40 overflow-auto">{suggestion.before}</pre>
                    </div>
                  );
                })}
              </div>
              {role === "owner" && proposal.status === "open" && (
                <>
                  {dirty && <p className="gf-faint mt-3 text-[12px]">Save or discard your local edits before accepting this proposal, so your draft is not lost.</p>}
                  <div className="mt-3 flex justify-end gap-2">
                  <button type="button" disabled={dirty} onClick={() => onReviewProposal(proposal, "reject")} className="gf-button-secondary">
                    Reject
                  </button>
                  <button type="button" disabled={dirty} onClick={() => onReviewProposal(proposal, "accept")} className="gf-button-primary">
                    Accept and Save
                  </button>
                  </div>
                </>
              )}
              {role !== "owner" && proposal.status === "open" && <p className="gf-faint mt-3 text-[12px]">Waiting for the folder owner.</p>}
              {proposal.status === "needs-review" && <p className="gf-faint mt-3 text-[12px]">This suggestion no longer matches the current file. Review the latest version before trying again.</p>}
            </article>
          ))}
          {fileProposals.length === 0 && <p className="gf-faint text-[13px]">No proposals on this file yet.</p>}
          </div>
        )}
      </div>
    </aside>
  );
}

function DocumentView(props: FilesProps & { file: OpenedFile }) {
  const editor = useRef<HTMLDivElement>(null);
  const importer = useRef<HTMLInputElement>(null);
  const exportWrap = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTab, setReviewTab] = useState<"comments" | "proposals">("comments");
  const [focusedProposalId, setFocusedProposalId] = useState<string | null>(null);
  const [reviewAnnouncement, setReviewAnnouncement] = useState("");
  const [tableDraft, setTableDraft] = useState("");
  const [tableChanges, setTableChanges] = useState<TableEdit[]>([]);
  const editable = props.file.kind === "text" && props.file.editable && props.file.content !== undefined;
  const tableEditable = editable && /\.(csv|tsv)$/i.test(props.file.path);

  useEffect(() => {
    if (editor.current && props.file.kind === "text" && props.file.content !== undefined) {
      editor.current.innerHTML = markdownToHtml(props.file.content);
      setDirty(false);
    }
    if (props.file.kind === "text" && props.file.content !== undefined) {
      setTableDraft(props.file.content);
      setTableChanges([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.file.path, props.file.sha]);

  useEffect(() => {
    void listDocumentComments(props.folder.id, props.file.path).then(setComments).catch(() => setComments([]));
  }, [props.folder.id, props.file.path]);

  useEffect(() => {
    setSelection("");
    delete document.body.dataset.gfSelectedCellAddress;
    delete document.body.dataset.gfSelectedCellValue;
    setCommentDraft("");
    setReviewOpen(false);
    setReviewTab("comments");
    setFocusedProposalId(null);
    setReviewAnnouncement("");
    setExportOpen(false);
    return () => {
      delete document.body.dataset.gfSelectedCellAddress;
      delete document.body.dataset.gfSelectedCellValue;
    };
  }, [props.file.path]);

  useEffect(() => {
    function onProposalCreated(event: Event) {
      const detail = (event as CustomEvent<{ folderId?: string; path?: string; proposalId?: string }>).detail;
      if (detail?.folderId !== props.folder.id || detail.path !== props.file.path || !detail.proposalId) return;
      setReviewOpen(true);
      setReviewTab("proposals");
      setFocusedProposalId(detail.proposalId);
      setReviewAnnouncement(`A new Change Proposal for ${props.file.path} is ready for review.`);
      void props.onRefreshProposals();
    }
    window.addEventListener("proposal-created", onProposalCreated);
    return () => window.removeEventListener("proposal-created", onProposalCreated);
  }, [props.file.path, props.folder.id, props.onRefreshProposals]);

  useEffect(() => {
    if (!exportOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExportOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (exportWrap.current && !exportWrap.current.contains(e.target as Node)) setExportOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [exportOpen]);

  function command(name: string, value?: string) {
    document.execCommand(name, false, value);
    editor.current?.focus();
    setDirty(true);
  }

  function captureTextSelection() {
    delete document.body.dataset.gfSelectedCellAddress;
    delete document.body.dataset.gfSelectedCellValue;
    setSelection(window.getSelection()?.toString() ?? "");
  }

  async function save() {
    const content = tableEditable ? tableDraft : editor.current ? htmlToMarkdown(editor.current) : null;
    if (content === null) return;
    if (tableEditable && tableChanges.length === 0) return;
    setSaving(true);
    props.onNotice(null);
    try {
      if (props.role === "owner") {
        const result = await saveDocument(props.folder.id, {
          path: props.file.path,
          content,
          baseHead: props.head,
          label: `Edited ${props.file.path}`,
        });
        setDirty(false);
        props.onSaved(result.head);
      } else {
        if (tableEditable) {
          const result = await createProposal(props.folder.id, {
            title: `Suggested changes to ${props.file.path}`,
            baseHead: null,
            operation: {
              path: props.file.path,
              kind: "table_update",
              changes: tableChanges,
              explanation: "Suggested from the table editor",
            },
          });
          announceProposalCreated({ folderId: props.folder.id, path: props.file.path, proposalId: result.proposalId });
        } else {
          const before = props.file.content || "";
          if (before.length > 20_000 || content.length > 20_000) {
            throw new Error(
              "This document is too large for a single Change Proposal. Select a smaller passage and ask your agent to suggest the focused edit.",
            );
          }
          const result = await createProposal(props.folder.id, {
            title: `Suggested changes to ${props.file.path}`,
            baseHead: null,
            operation: {
              path: props.file.path,
              kind: "text_replace",
              before,
              replacement: content,
              explanation: "Suggested from the document editor",
            },
          });
          announceProposalCreated({ folderId: props.folder.id, path: props.file.path, proposalId: result.proposalId });
        }
        setDirty(false);
        props.onNotice(done("Your Change Proposal was sent to the folder owner."));
      }
    } catch (e) {
      props.onNotice(problem((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  function downloadBlob(blob: Blob, extension: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = props.file.path.replace(/\.[^.]+$/, `.${extension}`);
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadSource() {
    if (!props.file.blob) return;
    const url = URL.createObjectURL(props.file.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = props.file.path.split("/").pop() ?? props.file.path;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportFile(kind: "md" | "html") {
    if (!editor.current) return;
    const content =
      kind === "md"
        ? htmlToMarkdown(editor.current)
        : `<!doctype html><meta charset="utf-8"><title>${props.file.path}</title>${editor.current.innerHTML}`;
    downloadBlob(new Blob([content], { type: kind === "md" ? "text/markdown" : "text/html" }), kind);
  }

  async function exportDocx() {
    if (!editor.current) return;
    const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import("docx");
    const markdown = htmlToMarkdown(editor.current);
    const children = markdown
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const heading = /^(#{1,3})\s+(.+)$/.exec(line);
        if (heading) {
          return new Paragraph({
            text: heading[2]!,
            heading:
              heading[1]!.length === 1
                ? HeadingLevel.HEADING_1
                : heading[1]!.length === 2
                  ? HeadingLevel.HEADING_2
                  : HeadingLevel.HEADING_3,
          });
        }
        const bullet = /^[-*]\s+(.+)$/.exec(line);
        if (bullet) return new Paragraph({ text: bullet[1]!, bullet: { level: 0 } });
        return new Paragraph({ children: [new TextRun(line.replace(/^>\s+/, ""))] });
      });
    downloadBlob(await Packer.toBlob(new Document({ sections: [{ children }] })), "docx");
  }

  async function importDocx(file: File) {
    if (!editor.current) return;
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      editor.current.innerHTML = result.value;
      setDirty(true);
      props.onNotice(
        result.messages.length
          ? done("The document was imported. Review it before saving, because some Word-only formatting wasn't carried across.")
          : done("The document was imported. Review it, then save when it looks right."),
      );
    } catch {
      props.onNotice(problem("GoodFolder couldn't import that Word document."));
    }
  }

  async function comment() {
    if (!commentDraft.trim()) return;
    try {
      await addDocumentComment(props.folder.id, props.file.path, commentDraft, selection || undefined);
      setCommentDraft("");
      setComments(await listDocumentComments(props.folder.id, props.file.path));
      props.onNotice(done("Your comment was added."));
    } catch (e) {
      props.onNotice(problem((e as Error).message));
    }
  }

  const reviewCount = comments.length + props.proposals.filter((proposal) => proposal.suggestions.some((suggestion) => suggestion.path === props.file.path)).length;
  function reviewPanel(selectionHint: string) {
    if (!reviewOpen) return null;
    return (
      <DocumentReviewPanel
        path={props.file.path}
        role={props.role}
        proposals={props.proposals}
        comments={comments}
        selection={selection}
        commentDraft={commentDraft}
        onDraftChange={setCommentDraft}
        onComment={() => void comment()}
        selectionHint={selectionHint}
        reviewTab={reviewTab}
        onReviewTab={setReviewTab}
        onReviewProposal={(proposal, action) => void props.onReviewProposal(proposal, action)}
        focusedProposalId={focusedProposalId}
        dirty={dirty}
      />
    );
  }

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">{reviewAnnouncement}</p>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--gf-line)] px-4 py-3 sm:px-6">
        {/* On a phone the name gets its own row; the actions wrap beneath it. */}
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto">
          <button
            type="button"
            onClick={props.onClose}
            className="gf-icon-button shrink-0 xl:hidden"
            aria-label="Back to the file list"
          >
            <ArrowLeftIcon />
          </button>
          <div className="min-w-0 flex-1">
            <p className="gf-truncate text-[14px] font-semibold">{props.file.path}</p>
            <p className="gf-faint text-[12px]">
              {prettySize(props.file.size)}
              {dirty && " · Unsaved changes"}
            </p>
          </div>
        </div>

        {editable && (
          <>
            <input
              ref={importer}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importDocx(file);
                e.currentTarget.value = "";
              }}
            />
            <button type="button" onClick={() => importer.current?.click()} className="gf-button-secondary">
              Import Word
            </button>
          </>
        )}

        {editable && (
          <div ref={exportWrap} className="relative">
            <button
              type="button"
              className="gf-button-secondary"
              aria-expanded={exportOpen}
              aria-haspopup="menu"
              onClick={() => setExportOpen((v) => !v)}
            >
              Export <ChevronDownIcon />
            </button>
            {exportOpen && (
              <div role="menu" className="gf-menu">
                {(
                  [
                    ["Word (.docx)", () => void exportDocx()],
                    ["Markdown", () => exportFile("md")],
                    ["HTML", () => exportFile("html")],
                    ["PDF / Print", () => window.print()],
                  ] as Array<[string, () => void]>
                ).map(([label, action]) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    className="gf-menu-item"
                    onClick={() => {
                      setExportOpen(false);
                      action();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {props.file.blob && (
          <button type="button" onClick={downloadSource} className="gf-button-secondary">
            <DownloadIcon />
            Download
          </button>
        )}

        <button
          type="button"
          onClick={() => setReviewOpen((open) => !open)}
          aria-expanded={reviewOpen}
          className="gf-button-secondary"
        >
          <CommentIcon />
          Review
          {reviewCount > 0 && <span className="gf-num">({reviewCount})</span>}
        </button>

        {editable && (
          <button type="button" onClick={save} disabled={!dirty || saving} className="gf-button-primary">
            {saving ? "Saving…" : props.role === "owner" ? "Save" : "Propose changes"}
          </button>
        )}
      </div>

      {editable ? (
        tableEditable ? (
          <div className={reviewOpen ? "grid xl:grid-cols-[minmax(0,1fr)_320px]" : ""}>
            <DelimitedTableEditor
              path={props.file.path}
              content={props.file.content ?? ""}
              onChange={(change: DelimitedTableChange) => {
                setTableDraft(change.content);
                setTableChanges(change.changes);
                setDirty(change.changes.length > 0);
              }}
              onSelect={setSelection}
            />
            {reviewPanel("Select a cell before commenting to keep the note attached to that part of the table.")}
          </div>
        ) : (
          <>
            <div
              className="gf-toolbar border-b border-[var(--gf-line)] bg-[var(--gf-surface-sunken)] px-4 py-2"
              role="toolbar"
              aria-label="Document formatting"
            >
              <button type="button" onClick={() => command("formatBlock", "h1")} title="Heading 1">H1</button>
              <button type="button" onClick={() => command("formatBlock", "h2")} title="Heading 2">H2</button>
              <button type="button" onClick={() => command("bold")} title="Bold"><b>B</b></button>
              <button type="button" onClick={() => command("italic")} title="Italic"><i>I</i></button>
              <button type="button" onClick={() => command("insertUnorderedList")} title="Bulleted list">List</button>
              <button type="button" onClick={() => command("formatBlock", "blockquote")} title="Quote">Quote</button>
              <button
                type="button"
                title="Link"
                onClick={() => {
                  const url = prompt("Link address");
                  if (url) command("createLink", url);
                }}
              >
                Link
              </button>
            </div>

            <div className={reviewOpen ? "grid xl:grid-cols-[minmax(0,1fr)_320px]" : ""}>
              <div
                ref={editor}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                onInput={() => setDirty(true)}
                onMouseUp={captureTextSelection}
                onKeyUp={captureTextSelection}
                className="gf-editor"
                aria-label={`Edit ${props.file.path}`}
              />
              {reviewPanel("Select a passage before commenting to keep the note anchored to those exact words.")}
            </div>
          </>
        )
      ) : (
        <div className={reviewOpen ? "grid xl:grid-cols-[minmax(0,1fr)_320px]" : ""}>
          <div className="min-w-0">
            {props.file.kind === "image" && props.file.blob ? (
              <ImagePreview path={props.file.path} blob={props.file.blob} />
            ) : props.file.kind === "pdf" && props.file.blob ? (
              <PdfPreview path={props.file.path} blob={props.file.blob} />
            ) : props.file.kind === "word" && props.file.blob ? (
              <WordPreview path={props.file.path} blob={props.file.blob} />
            ) : props.file.kind === "sheet" && props.file.blob ? (
              <SheetPreview path={props.file.path} blob={props.file.blob} onSelect={setSelection} />
            ) : props.file.kind === "slides" && props.file.blob ? (
              <SlidesPreview path={props.file.path} blob={props.file.blob} />
            ) : props.file.kind === "video" && props.file.blob ? (
              <VideoPreview path={props.file.path} blob={props.file.blob} />
            ) : props.file.kind === "audio" && props.file.blob ? (
              <AudioPreview path={props.file.path} blob={props.file.blob} />
            ) : props.file.kind === "quicklook" && props.file.blob ? (
              <QuickLookPreview path={props.file.path} blob={props.file.blob} />
            ) : props.file.kind === "text" && props.file.content !== undefined ? (
              <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap break-words p-6 text-[13px] leading-relaxed">
                {props.file.content}
              </pre>
            ) : (
              <UnsupportedView file={props.file} />
            )}
          </div>
          {reviewPanel(props.file.kind === "sheet" ? "Select a cell before commenting to keep the note attached to that part of the sheet." : "Add a note about this file for the people you work with.")}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- Proposals */

function ProposalList({
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

function PeopleView({
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

function Section({
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

function WorkspaceSkeleton({ tab }: { tab: Tab }) {
  if (tab === "timeline") {
    return (
      <div>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-2 h-3.5 w-72" />
        <div className="mt-6">
          <TimelineSkeleton />
        </div>
      </div>
    );
  }
  if (tab === "files") {
    return (
      <div className="gf-card gf-card-lg grid min-h-[640px] overflow-hidden xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="border-b border-[var(--gf-line)] bg-[var(--gf-surface-sunken)] p-4 xl:border-b-0 xl:border-r">
          <Skeleton className="h-4 w-16" />
          <div className="mt-5 grid gap-2.5">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
        <div className="grid place-items-center p-8">
          <Skeleton className="h-56 w-full max-w-lg rounded-[var(--gf-radius)]" />
        </div>
      </div>
    );
  }
  return (
    <div>
      <Skeleton className="h-5 w-44" />
      <Skeleton className="mt-2 h-3.5 w-80" />
      <div className="mt-6 grid gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-[var(--gf-radius)]" />
        ))}
      </div>
    </div>
  );
}
