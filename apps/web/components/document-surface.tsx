"use client";

import { useEffect, useRef, useState } from "react";
import {
  addDocumentComment,
  createProposal,
  listDocumentComments,
  readFileRaw,
  saveDocument,
  type ChangeProposal,
  type Folder,
  type OpenedFile,
} from "@/lib/gf-api";
import { markdownToHtml } from "@/lib/markdown";
import { FilePreview } from "@/components/file-preview";
import { DelimitedTableEditor, type DelimitedTableChange } from "@/components/delimited-table-editor";
import type { TableEdit } from "@/lib/table";
import { ArrowLeftIcon, ChevronDownIcon, CommentIcon, DownloadIcon } from "@/components/icons";
import { ReviewBadge, done, problem, type NoticeMessage } from "@/components/ui";

/* --------------------------------------------------------------------------
   Reading and changing one file.

   Lifted out of the old four-tab workspace unchanged, so that the same
   surface can be mounted wherever a file is being read: beside a listing, in
   the last column of the browser, under the gallery, or on its own.
-------------------------------------------------------------------------- */

export type Role = "owner" | "contributor";
export type Notify = (n: NoticeMessage | null) => void;

export interface DocumentSurfaceProps {
  folder: Folder;
  file: OpenedFile;
  head: string | null;
  role: Role;
  proposals: ChangeProposal[];
  onClose: () => void;
  onSaved: (head: string) => void;
  onRefreshProposals: () => Promise<void>;
  onReviewProposal: (proposal: ChangeProposal, action: "accept" | "reject") => Promise<void>;
  onNotice: Notify;
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
      case "IMG": return `![${node.getAttribute("alt") ?? ""}](${node.dataset.gfMarkdownImageSource ?? ""})`;
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

export function DocumentSurface(props: DocumentSurfaceProps) {
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
      editor.current.innerHTML = markdownToHtml(props.file.content, props.file.path);
      setDirty(false);
    }
    if (props.file.kind === "text" && props.file.content !== undefined) {
      setTableDraft(props.file.content);
      setTableChanges([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.file.path, props.file.sha]);

  useEffect(() => {
    const root = editor.current;
    if (!root || props.file.kind !== "text") return;
    const images = [...root.querySelectorAll<HTMLImageElement>("img[data-gf-inline-image-path]")];
    const objectUrls: string[] = [];
    let cancelled = false;

    void Promise.all(images.map(async (image) => {
      const path = image.dataset.gfInlineImagePath;
      if (!path) return;
      try {
        const result = await readFileRaw(props.folder.id, path);
        if (cancelled || !result.blob || !result.mimeType?.startsWith("image/")) return;
        const url = URL.createObjectURL(result.blob);
        objectUrls.push(url);
        image.src = url;
      } catch {
        // A broken or unavailable local reference remains its original Markdown
        // when saved; the image is simply not rendered in this view.
      }
    }));

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [props.folder.id, props.file.path, props.file.sha, props.file.kind]);

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
            <FilePreview file={props.file} onSelect={setSelection} />
          </div>
          {reviewPanel(props.file.kind === "sheet" ? "Select a cell before commenting to keep the note attached to that part of the sheet." : "Add a note about this file for the people you work with.")}
        </div>
      )}
    </div>
  );
}
