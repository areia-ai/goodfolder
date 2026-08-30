"use client";

import { CloseIcon, DownloadIcon, ProposalIcon } from "@/components/icons";
import { Badge } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import { ProposalList, PeopleView } from "@/components/folder-panels";
import { NodeGlyph } from "@/components/finder/node-glyph";
import { formatBytes, previewKindLabel } from "@/lib/preview";
import { directoryName, kindLabel } from "@/lib/vfs";
import type { FolderData } from "@/components/finder/use-folder-data";
import type { Folder, VfsNode } from "@/components/finder/types";
import type { NoticeMessage } from "@/components/ui";

export type InspectorTab = "info" | "review" | "history" | "people";

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: "info", label: "Info" },
  { id: "review", label: "Review" },
  { id: "history", label: "History" },
  { id: "people", label: "People" },
];

function whenLine(at: string | null | undefined): string {
  if (!at) return "Not known";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "Not known";
  return date.toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="gf-win-fact">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * What is selected, and everything about the folder that is not a file.
 *
 * The old workspace put Timeline, Change Proposals and People beside Files as
 * equal tabs, which made reading a folder feel like operating an application.
 * They belong here: about the thing in front of you, beside it, not instead
 * of it.
 */
export function Inspector({
  tab,
  onTab,
  onClose,
  folder,
  data,
  selection,
  itemCount,
  totalBytes,
  onDownload,
  onNotice,
  onChanged,
}: {
  tab: InspectorTab;
  onTab: (next: InspectorTab) => void;
  onClose: () => void;
  folder: Folder | null;
  data: FolderData | null;
  selection: VfsNode[];
  itemCount: number;
  totalBytes: number;
  onDownload: (node: VfsNode) => void;
  onNotice: (notice: NoticeMessage | null) => void;
  onChanged: () => Promise<void>;
}) {
  const only = selection.length === 1 ? selection[0]! : null;
  const usable = folder ? TABS : TABS.filter((entry) => entry.id === "info");

  return (
    <>
      <div className="gf-win-aside-head">
        <div className="gf-tabs flex-1" role="tablist" aria-label="About this">
          {usable.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className="gf-tab min-h-9 px-2.5 text-[12px]"
              onClick={() => onTab(entry.id)}
            >
              {entry.label}
              {entry.id === "review" && (data?.proposals.filter((p) => p.status === "open").length ?? 0) > 0 && (
                <span className="gf-tab-count">{data!.proposals.filter((p) => p.status === "open").length}</span>
              )}
            </button>
          ))}
        </div>
        <button type="button" className="gf-win-tool" aria-label="Close this panel" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div className="p-3.5" role="tabpanel">
        {tab === "info" && (
          <div>
            {only ? (
              <>
                <div className="flex items-start gap-2.5">
                  <NodeGlyph node={only} />
                  <div className="min-w-0">
                    <p className="break-words text-[14px] font-bold">{only.name}</p>
                    <p className="gf-faint text-[12px]">{kindLabel(only)}</p>
                  </div>
                </div>
                <dl className="mt-3">
                  {only.kind === "file" && <Fact term="Type">{previewKindLabel(only.path)}</Fact>}
                  <Fact term="Size">{only.size === null ? "Not known here" : formatBytes(only.size)}</Fact>
                  {only.kind === "directory" && <Fact term="Holds">{only.fileCount} files</Fact>}
                  <Fact term="Last changed">
                    {only.changed ? (
                      <>
                        {whenLine(only.changed.at)}
                        <span className="gf-faint"> · Save #{only.changed.seq}</span>
                      </>
                    ) : data?.changed.partial ? (
                      "Older than the timeline reaches"
                    ) : (
                      "Not known"
                    )}
                  </Fact>
                  {only.kind !== "folder" && (
                    <Fact term="Where">{directoryName(only.path) || "The top of this folder"}</Fact>
                  )}
                  {only.reviewCount > 0 && (
                    <Fact term="Waiting">
                      <Badge tone="attention" icon={<ProposalIcon />}>
                        {only.reviewCount} for review
                      </Badge>
                    </Fact>
                  )}
                </dl>
                {only.kind === "file" && (
                  <button type="button" className="gf-button-secondary mt-3.5 w-full" onClick={() => onDownload(only)}>
                    <DownloadIcon />
                    Download a copy
                  </button>
                )}
                <p className="gf-faint mt-4 border-t border-[var(--gf-line)] pt-3 text-[12px] leading-relaxed">
                  Renaming, moving and deleting happen on the computer where this folder lives. The next Save brings
                  the change here with the rest of its history.
                </p>
              </>
            ) : selection.length > 1 ? (
              <dl>
                <Fact term="Selected">{selection.length} items</Fact>
                <Fact term="Size">
                  {formatBytes(selection.reduce((total, node) => total + (node.size ?? 0), 0))}
                </Fact>
              </dl>
            ) : (
              <>
                <p className="text-[14px] font-bold">{folder ? folder.name : "All your folders"}</p>
                <dl className="mt-3">
                  <Fact term="Holds">{itemCount} {itemCount === 1 ? "item" : "items"}</Fact>
                  {totalBytes > 0 && <Fact term="Size">{formatBytes(totalBytes)}</Fact>}
                  {folder && <Fact term="You are">{data?.role === "contributor" ? "A contributor" : "The owner"}</Fact>}
                  {folder && <Fact term="Saves">{folder.lastSeq ?? 0}</Fact>}
                  {folder && <Fact term="Last save">{whenLine(folder.lastSaveAt)}</Fact>}
                </dl>
                {!folder && (
                  <p className="gf-faint mt-4 text-[12px] leading-relaxed">
                    Every folder you have protected, and every folder someone has shared with you. Open one to read
                    what is inside it.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {tab === "history" && <Timeline saves={data?.saves ?? null} />}

        {tab === "review" && folder && data && (
          <ProposalList
            folder={folder}
            role={data.role}
            proposals={data.proposals}
            onChanged={onChanged}
            onNotice={onNotice}
          />
        )}

        {tab === "people" && folder && data && (
          <PeopleView
            folder={folder}
            role={data.role}
            people={data.people}
            onChanged={onChanged}
            onNotice={onNotice}
          />
        )}
      </div>
    </>
  );
}
