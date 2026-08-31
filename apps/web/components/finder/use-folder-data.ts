"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listFiles, listPeople, listProposals, listSaves,
  type ChangeProposal, type FolderFile, type SaveRow,
} from "@/lib/gf-api";
import {
  EMPTY_CHANGE_INDEX, buildChangeIndex, buildReviewIndex, buildTree,
  type ChangeIndex, type ReviewIndex, type TreeIndex,
} from "@/lib/vfs";
import type { Role } from "@/components/document-surface";

export interface FolderData {
  status: "loading" | "ready" | "failed";
  error: string | null;
  role: Role;
  head: string | null;
  files: FolderFile[];
  tree: TreeIndex;
  changed: ChangeIndex;
  review: ReviewIndex;
  saves: SaveRow[];
  proposals: ChangeProposal[];
  people: Array<{ email: string; role: Role }>;
}

const LOADING: FolderData = {
  status: "loading", error: null, role: "owner", head: null, files: [],
  tree: buildTree([]), changed: EMPTY_CHANGE_INDEX, review: new Map(),
  saves: [], proposals: [], people: [],
};

export interface FolderStore {
  /** The folder currently open, or `null` at the root. */
  data: FolderData | null;
  /** Read a folder again from the server. */
  refresh: (folderId: string) => Promise<void>;
  /** Only what is waiting for review, for the cheap case after one decision. */
  refreshProposals: (folderId: string) => Promise<void>;
  /** Note a new head after a Save, without a full read. */
  setHead: (folderId: string, head: string) => void;
}

/**
 * Everything about one folder, kept until you sign out.
 *
 * A window is walked around, so stepping back into a folder must not empty the
 * screen and load it again. Each folder is read once and kept; a Save or a
 * decision refreshes just that one.
 */
export function useFolderData(folderId: string | null): FolderStore {
  const [cache, setCache] = useState<Record<string, FolderData>>({});
  const inFlight = useRef(new Set<string>());

  const load = useCallback(async (id: string) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setCache((current) => (current[id]?.status === "ready" ? current : { ...current, [id]: LOADING }));
    try {
      const [fileData, saves, proposalData, peopleData] = await Promise.all([
        listFiles(id),
        // The full path lists are what tell each file when it last changed.
        listSaves(id, true),
        listProposals(id),
        listPeople(id),
      ]);
      setCache((current) => ({
        ...current,
        [id]: {
          status: "ready",
          error: null,
          role: fileData.role,
          head: fileData.head,
          files: fileData.files,
          tree: buildTree(fileData.files),
          changed: buildChangeIndex(saves),
          review: buildReviewIndex(proposalData.proposals),
          saves,
          proposals: proposalData.proposals,
          people: peopleData.people,
        },
      }));
    } catch (error) {
      setCache((current) => ({
        ...current,
        [id]: { ...LOADING, status: "failed", error: (error as Error).message },
      }));
    } finally {
      inFlight.current.delete(id);
    }
  }, []);

  const refresh = useCallback(async (id: string) => {
    inFlight.current.delete(id);
    await load(id);
  }, [load]);

  const refreshProposals = useCallback(async (id: string) => {
    try {
      const proposalData = await listProposals(id);
      setCache((current) => {
        const existing = current[id];
        if (!existing) return current;
        return {
          ...current,
          [id]: {
            ...existing,
            role: proposalData.role,
            proposals: proposalData.proposals,
            review: buildReviewIndex(proposalData.proposals),
          },
        };
      });
    } catch {
      // A stale count is not worth an error in front of someone; the next
      // full read corrects it.
    }
  }, []);

  const setHead = useCallback((id: string, head: string) => {
    setCache((current) => (current[id] ? { ...current, [id]: { ...current[id]!, head } } : current));
  }, []);

  const known = folderId ? cache[folderId] : undefined;
  useEffect(() => {
    if (folderId && !known) void load(folderId);
  }, [folderId, known, load]);

  return {
    data: folderId ? (known ?? LOADING) : null,
    refresh,
    refreshProposals,
    setHead,
  };
}
