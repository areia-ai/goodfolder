"use client";

import { useEffect, useState } from "react";
import { openFile as openFolderFile, type FolderFile, type OpenedFile } from "@/lib/gf-api";

/**
 * The bytes, or the text, of one file.
 *
 * Two places want this — the surface a file opens into, and the glance you
 * get from the space bar — and both must drop what they were showing the
 * moment the file changes rather than leaving the last one on screen while
 * the next arrives.
 */
export function useOpenedFile(folderId: string | null, file: FolderFile | null) {
  const [opened, setOpened] = useState<OpenedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = file?.path ?? null;
  const sha = file?.sha ?? null;

  useEffect(() => {
    if (!folderId || !file) {
      setOpened(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setOpened(null);
    setError(null);
    openFolderFile(folderId, file)
      .then((result) => {
        if (!cancelled) setOpened(result);
      })
      .catch((problem) => {
        if (!cancelled) setError((problem as Error).message);
      });
    return () => {
      cancelled = true;
    };
    // The identity of `file` changes on every listing rebuild; its path and
    // its content are what actually decide whether to read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId, path, sha]);

  return { opened, error };
}
