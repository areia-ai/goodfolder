"use client";

import { useCallback, useState } from "react";
import { createProposal, removeFiles, renameFile, stageFile, uploadFile } from "@/lib/gf-api";
import { done, problem, type NoticeMessage } from "@/components/ui";
import type { Role } from "@/components/document-surface";

/**
 * Adding, renaming and taking files out, from the window.
 *
 * Both roles get all three; what differs is where they land. The owner's
 * change goes into the folder. Someone invited sends the same change as a
 * Change Proposal and the owner decides — that boundary is what makes an
 * invitation safe to hand out, and it lives here rather than in four places
 * in the window.
 *
 * Files go up one at a time. Each answer carries the folder's new state, and
 * the next file is sent against it, so a drop of twelve photos is twelve
 * saves in order rather than twelve writes racing each other. It also means
 * one file that cannot go in — too large, or the kind a save leaves out —
 * says so on its own without taking the other eleven down with it.
 */

export interface UploadProgress {
  done: number;
  total: number;
  name: string;
}

export interface FileVerbs {
  busy: boolean;
  progress: UploadProgress | null;
  add: (files: readonly File[], intoDir: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (paths: readonly string[]) => Promise<void>;
}

/** What a person means by "one file" — the last part, not the whole path. */
function nameOf(path: string): string {
  return path.split("/").pop() || path;
}

export function useFileVerbs(input: {
  folderId: string | null;
  head: string | null;
  role: Role | null;
  onNotice: (message: NoticeMessage | null) => void;
  onChanged: () => Promise<void> | void;
}): FileVerbs {
  const { folderId, head, role, onNotice, onChanged } = input;
  const suggesting = role === "contributor";
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const add = useCallback(
    async (files: readonly File[], intoDir: string) => {
      if (!folderId || files.length === 0) return;
      onNotice(null);
      setBusy(true);
      let at = head;
      const added: string[] = [];
      const refused: string[] = [];
      try {
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i]!;
          setProgress({ done: i, total: files.length, name: file.name });
          const path = intoDir ? `${intoDir}/${file.name}` : file.name;
          try {
            if (suggesting) {
              // The bytes wait outside the folder until somebody says yes.
              const waiting = await stageFile(folderId, { name: path, file });
              await createProposal(folderId, {
                title: `Add ${file.name}`,
                operation: { path, kind: "asset_replace", stagingId: waiting.stagingId },
                baseHead: at,
              });
            } else {
              const result = await uploadFile(folderId, { path, file, baseHead: at });
              at = result.head;
            }
            added.push(file.name);
          } catch (error) {
            refused.push(`${file.name} — ${(error as Error).message}`);
          }
        }
      } finally {
        setProgress(null);
        setBusy(false);
      }
      await onChanged();
      if (refused.length > 0 && added.length === 0) {
        onNotice(problem(refused.length === 1 ? refused[0]! : `None of the ${refused.length} files went in. ${refused[0]}`));
      } else if (refused.length > 0) {
        onNotice(problem(`${added.length} of ${files.length} went through. ${refused[0]}`));
      } else if (suggesting) {
        onNotice(done(
          added.length === 1
            ? `${added[0]} is waiting for the folder's owner. Nothing has changed until they accept it.`
            : `${added.length} files are waiting for the folder's owner. Nothing has changed until they accept them.`,
        ));
      } else {
        onNotice(done(added.length === 1 ? `Added ${added[0]}.` : `Added ${added.length} files.`));
      }
    },
    [folderId, head, onNotice, onChanged, suggesting],
  );

  const rename = useCallback(
    async (from: string, to: string) => {
      if (!folderId || from === to) return;
      onNotice(null);
      setBusy(true);
      try {
        if (suggesting) {
          await createProposal(folderId, {
            title: `Rename ${nameOf(from)} to ${nameOf(to)}`,
            operation: { path: from, kind: "path_rename", to },
            baseHead: head,
          });
          await onChanged();
          onNotice(done(`Sent to the folder's owner. “${nameOf(from)}” keeps its name until they accept it.`));
        } else {
          await renameFile(folderId, { from, to, baseHead: head });
          await onChanged();
          onNotice(done(`“${nameOf(from)}” is now “${nameOf(to)}”. The next Sync carries the change to your computers.`));
        }
      } catch (error) {
        onNotice(problem((error as Error).message));
      } finally {
        setBusy(false);
      }
    },
    [folderId, head, onNotice, onChanged, suggesting],
  );

  const remove = useCallback(
    async (paths: readonly string[]) => {
      if (!folderId || paths.length === 0) return;
      onNotice(null);
      setBusy(true);
      try {
        if (suggesting) {
          // One file per proposal, so the owner can say yes to one and no to
          // another rather than being handed all of it at once.
          for (const path of paths) {
            await createProposal(folderId, {
              title: `Take ${nameOf(path)} out of the folder`,
              operation: { path, kind: "path_remove" },
              baseHead: head,
            });
          }
          await onChanged();
          onNotice(done(
            paths.length === 1
              ? `Sent to the folder's owner. “${nameOf(paths[0]!)}” stays until they accept it.`
              : `${paths.length} files sent to the folder's owner. They stay until each one is accepted.`,
          ));
        } else {
          const result = await removeFiles(folderId, { paths: [...paths], baseHead: head });
          await onChanged();
          const what = result.removed.length === 1
            ? `“${nameOf(result.removed[0]!)}” is`
            : `${result.removed.length} files are`;
          onNotice(done(`${what} out of the folder. Every earlier Save still holds ${result.removed.length === 1 ? "it" : "them"}.`));
        }
      } catch (error) {
        onNotice(problem((error as Error).message));
      } finally {
        setBusy(false);
      }
    },
    [folderId, head, onNotice, onChanged, suggesting],
  );

  return { busy, progress, add, rename, remove };
}

/**
 * The files in a drop, and whether a whole folder came with them.
 *
 * A folder dragged from a desktop arrives as an entry with nothing readable
 * behind it. Sending its contents up one file at a time would make a save
 * per file and take a long time doing it, so this reports the folder and the
 * window says where that is done instead.
 */
export function droppedFiles(transfer: DataTransfer): { files: File[]; hadFolder: boolean } {
  const files: File[] = [];
  let hadFolder = false;
  const items = transfer.items;
  if (items && items.length > 0) {
    for (const item of items) {
      if (item.kind !== "file") continue;
      const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
      if (entry?.isDirectory) {
        hadFolder = true;
        continue;
      }
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    return { files, hadFolder };
  }
  return { files: [...transfer.files], hadFolder: false };
}
