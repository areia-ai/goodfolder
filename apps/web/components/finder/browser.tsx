"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  acceptInvitation, createFolder, getAccountPlan, listFolders, openFile as openFolderFile, redeemChallengeAccess,
  reviewProposal, type AccountPlan, type ChangeProposal, type Folder, type OpenedFile,
} from "@/lib/gf-api";
import { QuickLook } from "@/components/finder/quick-look";
import { ContextMenu, type ContextMenuState } from "@/components/finder/context-menu";
import type { MenuItem } from "@/components/finder/menu";
import { useOpenedFile } from "@/components/finder/use-opened-file";
import { AlertIcon, FolderIcon, SearchIcon, SparklesIcon } from "@/components/icons";
import { EmptyState, Notice, Skeleton, done, info, problem, type NoticeMessage } from "@/components/ui";
import { DocumentSurface } from "@/components/document-surface";
import { registerDashboardTools, webMcpSupported } from "@/lib/webmcp";
import { formatBytes } from "@/lib/preview";
import {
  ROOT_SCOPE_LABEL, baseName, breadcrumb, descendantFiles, filterNodes, filterRoot,
  flattenRows, folderChildren, groupNodes, locationKey, locationOf, parentLocation,
  rootChildren, sortNodes, type Decoration, type DirectoryNode, type FileNode,
  type ListRow, type Location, type SortKey, type TreeIndex, type VfsNode,
} from "@/lib/vfs";
import {
  preferenceFor, readPrefs, togglePinned, withExpanded, withPreference,
  withSidebarCollapsed, withView, writePrefs, DEFAULT_STATE, VIEW_MODES, expandedIn,
  type ViewMode, type ViewPreference, type ViewPrefsState,
} from "@/lib/view-prefs";
import { Sidebar } from "@/components/finder/sidebar";
import { Toolbar } from "@/components/finder/toolbar";
import { PathBar, StatusBar } from "@/components/finder/foot";
import { FOLDER_COLUMNS, ListView, ROOT_COLUMNS } from "@/components/finder/view-list";
import { IconsView } from "@/components/finder/view-icons";
import { ColumnsView } from "@/components/finder/view-columns";
import { GalleryView } from "@/components/finder/view-gallery";
import { Inspector, type InspectorTab } from "@/components/finder/inspector";
import { useNavigation } from "@/components/finder/use-navigation";
import { useFolderData } from "@/components/finder/use-folder-data";
import { useSelection, type ClickModifiers } from "@/components/finder/use-selection";
import { droppedFiles, useFileVerbs } from "@/components/finder/use-file-verbs";
import { RemoveDialog, RenameDialog } from "@/components/finder/verb-dialogs";

/**
 * Everything with a path inside a folder — so, everything but a GoodFolder
 * itself. Renaming and taking out are about these; a whole GoodFolder is
 * neither renamed nor taken out from a listing.
 */
type NamedNode = DirectoryNode | FileNode;

const withPath = (nodes: readonly VfsNode[]): NamedNode[] =>
  nodes.filter((node): node is NamedNode => node.kind !== "folder");

/**
 * One window over everything: the folders at the top, and the files inside
 * each one, in the same hierarchy people have used since folders existed.
 */
export function FinderBrowser({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const nav = useNavigation();
  const { location } = nav;

  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [plan, setPlan] = useState<AccountPlan | null>(null);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const [agentReady, setAgentReady] = useState(false);

  const [prefs, setPrefs] = useState<ViewPrefsState>(DEFAULT_STATE);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [sidebarSheet, setSidebarSheet] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("info");
  const [glanceId, setGlanceId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [naming, setNaming] = useState(false);
  const [renaming, setRenaming] = useState<NamedNode | null>(null);
  const [removing, setRemoving] = useState<NamedNode[] | null>(null);
  const [dropTarget, setDropTarget] = useState(false);
  const [challengeCodeOpen, setChallengeCodeOpen] = useState(false);
  const [challengeCode, setChallengeCode] = useState("");
  const [redeemingChallenge, setRedeemingChallenge] = useState(false);

  const listing = useRef<HTMLDivElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const typed = useRef({ buffer: "", at: 0 });

  const store = useFolderData(location.folderId);
  const data = store.data;

  /* ------------------------------------------------------------- Loading */

  const loadFolders = useCallback(async () => {
    setLoadFailed(false);
    try {
      const params = new URLSearchParams(window.location.search);
      const invite = params.get("invite");
      if (invite) {
        const accepted = await acceptInvitation(invite);
        nav.replace({ folderId: accepted.projectId, dir: "", file: null, scope: "all" });
      }
      const [rows, accountPlan] = await Promise.all([listFolders(), getAccountPlan().catch(() => null)]);
      setFolders(rows);
      setPlan(accountPlan);
      try {
        if (webMcpSupported()) setAgentReady((await registerDashboardTools()).length > 0);
      } catch {
        /* the site tools are a bonus; never block the person */
      }
    } catch (error) {
      setFolders([]);
      setLoadFailed(true);
      setNotice(problem((error as Error).message));
    }
    // nav.replace is stable; re-running this on every navigation would
    // re-accept the invitation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    setPrefs(readPrefs());
    setPrefsLoaded(true);
  }, []);

  useEffect(() => {
    if (prefsLoaded) writePrefs(prefs);
  }, [prefs, prefsLoaded]);

  // Searching is about where you are, so leaving takes the search with you.
  const placeKey = locationKey(location);
  useEffect(() => {
    setSearch("");
  }, [placeKey]);

  /* ------------------------------------------------------- What is shown */

  const folder = useMemo(
    () => folders?.find((entry) => entry.id === location.folderId) ?? null,
    [folders, location.folderId],
  );

  const preference = useMemo<ViewPreference>(() => {
    const stored = preferenceFor(prefs, placeKey);
    // "Recently changed" is a place about time; opening it sorted by name
    // would be answering a question nobody asked.
    if (!location.folderId && location.scope === "recent" && !prefs.places[placeKey]) {
      return { ...stored, sort: "changed", direction: "desc" };
    }
    return stored;
  }, [prefs, placeKey, location.folderId, location.scope]);

  const decoration = useMemo(
    () => ({ changed: data?.changed ?? null, review: data?.review ?? null }),
    [data?.changed, data?.review],
  );

  const searching = search.trim().length > 0;

  const everyFolder = useMemo(() => rootChildren(folders ?? []), [folders]);

  const nodes = useMemo<VfsNode[]>(() => {
    if (!location.folderId) {
      return filterNodes(filterRoot(everyFolder, location.scope), search);
    }
    if (!data || data.status !== "ready") return [];
    if (searching) {
      return filterNodes(descendantFiles(data.tree, location.folderId, location.dir, decoration), search);
    }
    return folderChildren(data.tree, location.folderId, location.dir, decoration);
  }, [everyFolder, location.folderId, location.scope, location.dir, data, search, searching, decoration]);

  const expanded = useMemo(() => new Set(expandedIn(prefs, placeKey)), [prefs, placeKey]);

  const rows = useMemo<ListRow[]>(() => {
    if (searching || preference.group !== "none" || !location.folderId || !data) {
      return sortNodes(nodes, preference.sort, preference.direction).map((node) => ({
        node, level: 0, expandable: false, expanded: false,
      }));
    }
    return flattenRows({
      nodes, index: data.tree, folderId: location.folderId, expanded,
      sort: preference.sort, direction: preference.direction, decoration,
    });
  }, [nodes, searching, preference, location.folderId, data, expanded, decoration]);

  const groups = useMemo(() => {
    if (preference.group === "none") return null;
    return groupNodes(rows.map((row) => row.node), preference.group).map((group) => ({
      id: group.id,
      label: group.label,
      rows: group.nodes.map((node) => ({ node, level: 0, expandable: false, expanded: false })),
    }));
  }, [rows, preference.group]);

  const ordered = useMemo(
    () => (groups ? groups.flatMap((group) => group.rows.map((row) => row.node)) : rows.map((row) => row.node)),
    [groups, rows],
  );

  const selection = useSelection(ordered, `${placeKey}|${search}|${preference.group}`);

  const focused = useMemo<VfsNode | null>(() => {
    if (location.file) {
      const found = ordered.find((node) => node.kind === "file" && node.path === location.file);
      if (found) return found;
    }
    return selection.nodes[0] ?? null;
  }, [location.file, ordered, selection.nodes]);

  /* --------------------------------------------------------- Opening one */

  const openedFile = useMemo(
    () => (location.file && data?.status === "ready" ? (data.tree.byPath.get(location.file) ?? null) : null),
    [location.file, data],
  );
  const { opened, error: openError } = useOpenedFile(location.folderId, openedFile);
  useEffect(() => {
    if (openError) setNotice(problem(openError));
  }, [openError]);

  /* ------------------------------------------------------------- Actions */

  const go = nav.go;

  const inlineDetail = prefs.view === "columns" || prefs.view === "gallery";

  const open = useCallback(
    (node: VfsNode) => {
      setNotice(null);
      const next = locationOf(node);
      // In a view that shows the file beside the listing, moving along a
      // filmstrip or down a column is looking, not travelling. Filling the
      // history with every glance would make Back useless.
      if (node.kind === "file" && inlineDetail) nav.replace(next);
      else go(next);
    },
    [go, nav, inlineDetail],
  );

  const toggleRow = useCallback(
    (node: VfsNode) => {
      if (node.kind !== "directory") return;
      setPrefs((current) => {
        const open = new Set(expandedIn(current, placeKey));
        if (open.has(node.path)) open.delete(node.path);
        else open.add(node.path);
        return withExpanded(current, placeKey, [...open]);
      });
    },
    [placeKey],
  );

  const setPreference = useCallback(
    (patch: Partial<ViewPreference>) => setPrefs((current) => withPreference(current, placeKey, patch)),
    [placeKey],
  );

  const onSort = useCallback(
    (key: SortKey) =>
      setPreference(
        preference.sort === key
          ? { direction: preference.direction === "asc" ? "desc" : "asc" }
          : { sort: key, direction: "asc" },
      ),
    [preference.sort, preference.direction, setPreference],
  );

  const download = useCallback(
    async (node: VfsNode) => {
      if (node.kind !== "file" || !location.folderId) return;
      try {
        const file = await openFolderFile(location.folderId, node.file);
        const blob = file.blob ?? (file.content !== undefined ? new Blob([file.content]) : null);
        if (!blob) {
          setNotice(problem("This file is kept safe, but its content is not available to download here."));
          return;
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = node.name;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        setNotice(problem((error as Error).message));
      }
    },
    [location.folderId],
  );

  const makeFolder = useCallback(
    async (name: string) => {
      const clean = name.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!clean) return;
      setNaming(false);
      try {
        await createFolder(clean);
        await loadFolders();
        setNotice(
          done(
            `“${clean}” is ready. On the computer where it should live, run goodfolder clone "${clean}" to bring it down.`,
          ),
        );
      } catch (error) {
        setNotice(problem((error as Error).message));
      }
    },
    [loadFolders],
  );

  const refresh = useCallback(async () => {
    if (location.folderId) await store.refresh(location.folderId);
    await loadFolders();
  }, [location.folderId, store, loadFolders]);

  /* --------------------------------------------------- Changing the folder */

  /**
   * Both roles get all three verbs inside a folder. An owner's lands; a
   * contributor's is sent as a Change Proposal for the owner to decide. The
   * window says which one it is doing at every point where it offers it.
   */
  const inFolder = Boolean(location.folderId) && data?.status === "ready";
  const canChange = inFolder && data?.role === "owner";
  const suggesting = inFolder && data?.role === "contributor";
  const canTouch = canChange || suggesting;

  const verbs = useFileVerbs({
    folderId: location.folderId,
    head: data?.head ?? null,
    role: data?.role ?? null,
    onNotice: setNotice,
    onChanged: refresh,
  });

  const addFiles = useCallback(
    (files: readonly File[]) => {
      if (!canTouch) return;
      void verbs.add(files, location.dir);
    },
    [canTouch, verbs, location.dir],
  );

  const startRename = useCallback((node: NamedNode) => setRenaming(node), []);

  const startRemove = useCallback((nodes: readonly VfsNode[]) => {
    const named = withPath(nodes);
    if (named.length > 0) setRemoving(named);
  }, []);

  const doRename = useCallback(
    (name: string) => {
      const node = renaming;
      setRenaming(null);
      if (!node) return;
      const parent = node.path.includes("/") ? `${node.path.slice(0, node.path.lastIndexOf("/"))}/` : "";
      void verbs.rename(node.path, `${parent}${name}`);
    },
    [renaming, verbs],
  );

  const doRemove = useCallback(() => {
    const nodes = removing;
    setRemoving(null);
    if (!nodes) return;
    // Nothing can stay selected once it is out of the folder, or the count
    // at the foot goes on describing files that are no longer there.
    selection.clear();
    void verbs.remove(nodes.map((node) => node.path));
  }, [removing, verbs, selection]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      dragDepth.current = 0;
      setDropTarget(false);
      if (!event.dataTransfer) return;
      event.preventDefault();
      if (!canTouch) {
        setNotice(problem("Open one of your folders first, then drop the files inside it."));
        return;
      }
      const { files, hadFolder } = droppedFiles(event.dataTransfer);
      if (hadFolder) {
        setNotice(problem(
          "A whole folder has to be copied in on the computer where this folder lives; the next Save brings it here. Files on their own can be dropped here.",
        ));
        return;
      }
      addFiles(files);
    },
    [canTouch, addFiles],
  );

  const reviewFromWindow = useCallback(
    async (proposal: ChangeProposal, action: "accept" | "reject") => {
      if (!location.folderId) return;
      try {
        const result = await reviewProposal(location.folderId, proposal.id, { action });
        await store.refresh(location.folderId);
        if (result.saveNumber) {
          setNotice(done(`Accepted the change and saved #${result.saveNumber}.`));
        } else if (result.status === "needs-review") {
          setNotice(problem("This suggestion no longer matches the current file. Nothing was changed."));
        } else if (action === "reject") {
          setNotice(done("The suggestion was rejected. Nothing was changed."));
        }
      } catch (error) {
        setNotice(problem((error as Error).message));
      }
    },
    [location.folderId, store],
  );

  /* ------------------------------------------------------------ Keyboard */

  const openInspector = useCallback(
    (tab: InspectorTab) => {
      setInspectorTab(tab);
      setPreference({ previewPane: true });
    },
    [setPreference],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      if (event.key >= "1" && event.key <= "4") {
        event.preventDefault();
        setPrefs((current) => withView(current, VIEW_MODES[Number(event.key) - 1]!));
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('[data-window-search="true"]')?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setPreference]);

  /**
   * The listing's keys, listened for on the page rather than on one element.
   *
   * A file browser is expected to answer the arrow keys after you have
   * clicked a row, and a clicked row is not a focusable thing. Anywhere a
   * person is actually typing — a box, a document, the panel over the top —
   * hands the keys back.
   */
  const onListKey = useCallback((event: KeyboardEvent) => {
    // The target is not always an element — with nothing focused it can be the
    // document itself, which has no `closest`.
    const target = event.target instanceof Element ? event.target : null;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable) ||
      target?.closest('[role="dialog"], [role="menu"], .gf-win-aside')
    ) return;
    // A glance is over the top and owns the keyboard while it is open.
    if (glanceId) return;
    const modifier = event.metaKey || event.ctrlKey;

    if (modifier && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selection.selectAll();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      selection.move(event.key === "ArrowDown" ? 1 : -1, event.shiftKey);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const node = ordered.find((entry) => entry.id === selection.cursor);
      if (!node) return;
      event.preventDefault();
      if (node.kind === "directory" && !searching && preference.group === "none") toggleRow(node);
      else if (event.key === "ArrowRight") open(node);
      return;
    }
    if (event.key === "Enter" || (modifier && event.key === "ArrowDown")) {
      const node = ordered.find((entry) => entry.id === selection.cursor);
      if (!node) return;
      event.preventDefault();
      open(node);
      return;
    }
    if (modifier && event.key === "ArrowUp") {
      event.preventDefault();
      const up = parentLocation(location);
      if (up) go(up);
      return;
    }
    if (event.key === " ") {
      const node = ordered.find((entry) => entry.id === selection.cursor);
      if (!node) return;
      event.preventDefault();
      if (node.kind === "file") setGlanceId(node.id);
      else open(node);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      const chosen = withPath(selection.nodes);
      if (chosen.length === 0) return;
      event.preventDefault();
      startRemove(chosen);
      return;
    }
    if (event.key === "Escape") {
      if (search) setSearch("");
      else selection.clear();
      return;
    }
    if (event.key.length === 1 && event.key !== " " && !modifier && !event.altKey) {
      // Type-ahead: letters typed quickly build one prefix, as in every file
      // list anyone has used.
      const now = Date.now();
      typed.current.buffer = now - typed.current.at > 900 ? event.key : typed.current.buffer + event.key;
      typed.current.at = now;
      selection.typeAhead(typed.current.buffer);
    }
  }, [ordered, selection, searching, preference.group, toggleRow, open, location, go, search, glanceId, startRemove]);

  useEffect(() => {
    document.addEventListener("keydown", onListKey);
    return () => document.removeEventListener("keydown", onListKey);
  }, [onListKey]);

  /* ---------------------------------------------------------- Assembling */

  const crumbs = breadcrumb(location, folder?.name ?? null);
  const readingFile = Boolean(location.file) && !inlineDetail;
  const title = location.file
    ? baseName(location.file)
    : location.folderId
      ? (location.dir.split("/").filter(Boolean).pop() ?? folder?.name ?? "Folder")
      : ROOT_SCOPE_LABEL[location.scope];
  const totalBytes = nodes.reduce((sum, node) => sum + (node.size ?? 0), 0);
  const asideOpen = preference.previewPane;

  const statusNote = location.folderId && data?.changed.partial && preference.sort === "changed"
    ? "Some dates are older than the timeline reaches"
    : null;

  const glance = useMemo<VfsNode | null>(
    () => (glanceId ? (ordered.find((node) => node.id === glanceId) ?? null) : null),
    [glanceId, ordered],
  );

  const stepGlance = useCallback(
    (delta: number) => {
      const files = ordered.filter((node) => node.kind === "file");
      if (files.length === 0) return;
      const at = files.findIndex((node) => node.id === glanceId);
      const next = files[(at + delta + files.length) % files.length];
      if (!next) return;
      setGlanceId(next.id);
      selection.selectOnly(next.id);
    },
    [ordered, glanceId, selection],
  );

  /**
   * What the right mouse button offers.
   *
   * Rename, move and delete are named and explained rather than left out.
   * People will look for them here, and "not there" reads as broken while
   * "here is where that happens" reads as a rule.
   */
  const elsewhere: MenuItem = {
    id: "elsewhere",
    label: "Rename or take out",
    disabled: true,
    dividerBefore: true,
    note: "This happens on the computer where the folder lives.",
  };

  const changeItems = useCallback(
    (node: NamedNode): MenuItem[] => {
      if (!canTouch) return [elsewhere];
      const chosen = withPath(selection.nodes);
      const many = chosen.length > 1 && chosen.some((entry) => entry.id === node.id);
      return [
        {
          id: "rename",
          label: suggesting ? "Suggest a new name…" : "Rename…",
          dividerBefore: true,
          onSelect: () => startRename(node),
        },
        {
          id: "remove",
          label: suggesting
            ? many ? `Suggest taking ${chosen.length} out…` : "Suggest taking it out…"
            : many ? `Take ${chosen.length} out of the folder…` : "Take out of the folder…",
          note: suggesting
            ? "The owner decides. Nothing changes until they accept."
            : "It stays in every earlier Save.",
          onSelect: () => startRemove(many ? chosen : [node]),
        },
      ];
    },
    // `elsewhere` is a constant shape; the rest is what actually varies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canTouch, suggesting, selection.nodes, startRename, startRemove],
  );

  const contextItemsFor = useCallback(
    (node: VfsNode | null): MenuItem[] => {
      if (!node) {
        return [
          ...(location.folderId
            ? canTouch
              ? [{
                  id: "add",
                  label: suggesting ? "Suggest adding files…" : "Add files…",
                  onSelect: () => chooser.current?.click(),
                }]
              : []
            : [{ id: "new", label: "New Folder…", onSelect: () => setNaming(true) }]),
          {
            id: "panel",
            label: preference.previewPane ? "Hide the panel" : "Show the panel",
            onSelect: () => setPreference({ previewPane: !preference.previewPane }),
          },
        ];
      }
      if (node.kind === "folder") {
        return [
          { id: "open", label: "Open", onSelect: () => open(node) },
          {
            id: "pin",
            label: prefs.pinned.includes(node.folderId) ? "Stop keeping this to hand" : "Keep this folder to hand",
            onSelect: () => setPrefs((current) => togglePinned(current, node.folderId)),
          },
          elsewhere,
        ];
      }
      if (node.kind === "directory") {
        return [
          { id: "open", label: "Open", onSelect: () => open(node) },
          { id: "info", label: "Get info", onSelect: () => openInspector("info") },
          ...changeItems(node),
        ];
      }
      return [
        { id: "open", label: "Open", onSelect: () => open(node) },
        { id: "glance", label: "Take a look", onSelect: () => setGlanceId(node.id) },
        { id: "download", label: "Download a copy", onSelect: () => void download(node) },
        { id: "info", label: "What has happened to it", onSelect: () => openInspector("info") },
        ...changeItems(node),
      ];
    },
    [location.folderId, preference.previewPane, setPreference, open, prefs.pinned, openInspector, download, changeItems, canTouch, suggesting],
  );

  const selectNode = useCallback(
    (node: VfsNode, modifiers: ClickModifiers) => selection.select(node.id, modifiers),
    // `select` is stable; the selection object around it is not, and depending
    // on that would hand every row a fresh callback on every render and undo
    // the memoisation.
    [selection.select],
  );

  const onContext = useCallback(
    (node: VfsNode | null, at: { x: number; y: number }) =>
      setContextMenu({ x: at.x, y: at.y, items: contextItemsFor(node) }),
    [contextItemsFor],
  );

  const fileSurface = (
    <FileSurface
      opened={opened}
      folder={folder}
      data={data}
      onClose={() => {
        const up = parentLocation(location);
        if (up) go(up);
      }}
      onSaved={(head) => {
        if (location.folderId) {
          store.setHead(location.folderId, head);
          void store.refresh(location.folderId);
        }
      }}
      onRefreshProposals={async () => {
        if (location.folderId) await store.refreshProposals(location.folderId);
      }}
      onReviewProposal={reviewFromWindow}
      onNotice={setNotice}
    />
  );

  const redeemChallenge = async () => {
    setRedeemingChallenge(true);
    try {
      const result = await redeemChallengeAccess(challengeCode);
      setChallengeCodeOpen(false);
      setChallengeCode("");
      setNotice(done(`Challenge access is active until ${new Date(result.expiresAt).toLocaleString()}.`));
      setPlan(await getAccountPlan().catch(() => null));
    } catch (error) {
      setNotice(problem((error as Error).message));
    } finally {
      setRedeemingChallenge(false);
    }
  };

  return (
    <div className={`gf-win ${prefs.sidebarCollapsed ? "gf-win-collapsed" : ""}`}>
      <a href="#listing" className="gf-skip-link">Skip to the files</a>

      <div className={`hidden ${prefs.sidebarCollapsed ? "" : "lg:block"}`}>
        <Sidebar
          folders={folders ?? []}
          location={location}
          pinned={prefs.pinned}
          email={email}
          onGo={go}
          onTogglePin={(id) => setPrefs((current) => togglePinned(current, id))}
          onSignOut={onSignOut}
          onManagePlan={() => openInspector("info")}
          onRedeemChallenge={() => setChallengeCodeOpen(true)}
        />
      </div>

      {sidebarSheet && (
        <>
          <div className="gf-win-scrim lg:hidden" onClick={() => setSidebarSheet(false)} />
          <div className="gf-win-sheet lg:hidden">
            <Sidebar
              folders={folders ?? []}
              location={location}
              pinned={prefs.pinned}
              email={email}
              onGo={(next) => {
                setSidebarSheet(false);
                go(next);
              }}
              onTogglePin={(id) => setPrefs((current) => togglePinned(current, id))}
              onSignOut={onSignOut}
              onManagePlan={() => openInspector("info")}
              onRedeemChallenge={() => setChallengeCodeOpen(true)}
            />
          </div>
        </>
      )}

      <div className="gf-win-main">
        <Toolbar
          title={title}
          view={prefs.view}
          onView={(next) => setPrefs((current) => withView(current, next))}
          preference={preference}
          onPreference={setPreference}
          canGoBack={nav.canGoBack}
          canGoForward={nav.canGoForward}
          canGoUp={parentLocation(location) !== null}
          onBack={nav.back}
          onForward={nav.forward}
          onUp={() => {
            const up = parentLocation(location);
            if (up) go(up);
          }}
          sidebarCollapsed={prefs.sidebarCollapsed}
          onToggleSidebar={() => {
            if (window.matchMedia("(min-width: 1024px)").matches) {
              setPrefs((current) => withSidebarCollapsed(current, !current.sidebarCollapsed));
            } else {
              setSidebarSheet((value) => !value);
            }
          }}
          search={search}
          onSearch={setSearch}
          searchLabel={location.folderId ? `Search ${folder?.name ?? "this folder"}` : "Search your folders"}
          reading={readingFile}
          onNewFolder={location.folderId ? undefined : () => setNaming(true)}
          onAddFiles={canTouch ? () => chooser.current?.click() : undefined}
          folderActions={
            folder
              ? {
                  isPinned: prefs.pinned.includes(folder.id),
                  onTogglePin: () => setPrefs((current) => togglePinned(current, folder.id)),
                  onShare: () => openInspector("people"),
                  onTimeline: () => openInspector("history"),
                  canShare: data?.role === "owner",
                }
              : undefined
          }
        />

        <div className="gf-win-body">
          <div
            id="listing"
            ref={listing}
            aria-label={location.folderId ? `Inside ${title}` : title}
            className={`gf-win-listing ${inlineDetail && !notice ? "gf-win-listing-fill" : ""} ${dropTarget ? "gf-win-dropping" : ""}`}
            tabIndex={0}
            onClick={(event) => {
              if (event.target === event.currentTarget) selection.clear();
            }}
            onContextMenu={(event) => {
              if (event.target !== event.currentTarget) return;
              event.preventDefault();
              selection.clear();
              onContext(null, { x: event.clientX, y: event.clientY });
            }}
            onDragEnter={(event) => {
              if (![...event.dataTransfer.types].includes("Files")) return;
              dragDepth.current += 1;
              setDropTarget(true);
            }}
            onDragOver={(event) => {
              if (![...event.dataTransfer.types].includes("Files")) return;
              // Without this the browser opens the file instead of dropping it.
              event.preventDefault();
              event.dataTransfer.dropEffect = canTouch ? "copy" : "none";
            }}
            onDragLeave={() => {
              // Dragging over a child fires leave on the parent; count depth
              // rather than believing the first one.
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDropTarget(false);
            }}
            onDrop={onDrop}
          >
            {dropTarget && (
              <p className="gf-win-drop" role="status">
                {suggesting
                  ? `Drop to suggest adding to ${title}`
                  : canChange
                    ? `Drop to add to ${title}`
                    : "Open one of your folders to add files"}
              </p>
            )}

            {verbs.progress && (
              <div className="px-3 pt-3">
                <Notice
                  message={info(
                    `${suggesting ? "Sending" : "Adding"} ${verbs.progress.name}${
                      verbs.progress.total === 1
                        ? ""
                        : ` — ${verbs.progress.done + 1} of ${verbs.progress.total}`
                    }…`,
                  )}
                />
              </div>
            )}
            {notice && (
              <div className="px-3 pt-3">
                <Notice message={notice} />
              </div>
            )}

            {agentReady && !location.folderId && !searching && (
              <div data-testid="site-tools-banner" className="gf-notice gf-notice-info m-3">
                <SparklesIcon />
                <span>
                  <b>This window speaks agent.</b> Your assistant can read what is here alongside you. It can look and
                  suggest — it can&apos;t save, accept a suggestion, or change who has access.
                </span>
              </div>
            )}

            {readingFile ? (
              fileSurface
            ) : (
              <Listing
                loading={Boolean(location.folderId) && data?.status === "loading"}
                failed={loadFailed || data?.status === "failed"}
                error={data?.error ?? null}
                onRetry={() => void refresh()}
                nodes={nodes}
                folders={folders}
                location={location}
                search={search}
                onClearSearch={() => setSearch("")}
                rows={rows}
                groups={groups}
                preference={preference}
                view={prefs.view}
                onSort={onSort}
                selection={selection}
                searching={searching}
                datesPartial={Boolean(data?.changed.partial)}
                onOpen={open}
                onToggle={toggleRow}
                onContext={onContext}
                onSelectNode={selectNode}
                scroller={listing}
                everyFolder={everyFolder}
                tree={data?.tree ?? null}
                decoration={decoration}
                focused={focused}
                detail={location.file ? fileSurface : null}
              />
            )}
          </div>

          {asideOpen && (
            <>
              <div className="gf-win-scrim" onClick={() => setPreference({ previewPane: false })} />
              <aside className="gf-win-aside gf-win-aside-open" aria-label="About what is selected">
                <Inspector
                  tab={inspectorTab}
                  onTab={setInspectorTab}
                  onClose={() => setPreference({ previewPane: false })}
                  folder={folder}
                  data={data}
                  selection={selection.nodes}
                  itemCount={nodes.length}
                  totalBytes={totalBytes}
                  onDownload={(node) => void download(node)}
                  onNotice={setNotice}
                  onChanged={refresh}
                />
              </aside>
            </>
          )}
        </div>

        {glance && glance.kind === "file" && location.folderId && (
          <QuickLook
            node={glance}
            folderId={location.folderId}
            onClose={() => setGlanceId(null)}
            onStep={stepGlance}
            onOpen={(node) => {
              setGlanceId(null);
              open(node);
            }}
            onDownload={(node) => void download(node)}
          />
        )}

        {contextMenu && <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />}
        {naming && <NameFolder onCancel={() => setNaming(false)} onName={(name) => void makeFolder(name)} />}
        {renaming && (
          <RenameDialog
            name={renaming.name}
            kind={renaming.kind === "directory" ? "folder" : "file"}
            suggesting={suggesting}
            onCancel={() => setRenaming(null)}
            onRename={doRename}
          />
        )}
        {removing && (
          <RemoveDialog
            names={removing.map((node) => node.name)}
            suggesting={suggesting}
            onCancel={() => setRemoving(null)}
            onRemove={doRemove}
          />
        )}
        {challengeCodeOpen && (
          <div className="gf-win-dialog-scrim" role="presentation">
            <form className="gf-card absolute left-1/2 top-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-5 shadow-xl" onSubmit={(event) => { event.preventDefault(); void redeemChallenge(); }}>
              <h2 className="gf-h3">Redeem challenge code</h2>
              <p className="gf-body mt-2 text-sm">This gives your account full access for the WebMCP Challenge. It ends October 1; your folders remain yours.</p>
              <label className="mt-4 block text-sm font-semibold" htmlFor="challenge-code">Code</label>
              <input id="challenge-code" autoFocus className="gf-input mt-1 w-full" value={challengeCode} onChange={(event) => setChallengeCode(event.target.value)} disabled={redeemingChallenge} />
              <div className="mt-5 flex justify-end gap-2"><button type="button" className="gf-button-secondary" onClick={() => setChallengeCodeOpen(false)} disabled={redeemingChallenge}>Cancel</button><button type="submit" className="gf-button-primary" disabled={redeemingChallenge || !challengeCode.trim()}>{redeemingChallenge ? "Checking…" : "Redeem"}</button></div>
            </form>
          </div>
        )}

        <input
          ref={chooser}
          type="file"
          multiple
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            addFiles([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />

        <div className="gf-win-foot">
          <PathBar crumbs={crumbs} onGo={go} />
          <StatusBar
            count={nodes.length}
            selectedCount={selection.ids.size}
            bytes={location.folderId ? totalBytes : null}
            plan={plan}
            note={statusNote}
            onManagePlan={() => openInspector("info")}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- The listing */

function Listing(props: {
  loading: boolean;
  failed: boolean;
  error: string | null;
  onRetry: () => void;
  nodes: VfsNode[];
  folders: Folder[] | null;
  location: Location;
  search: string;
  onClearSearch: () => void;
  rows: ListRow[];
  groups: Array<{ id: string; label: string; rows: ListRow[] }> | null;
  preference: ViewPreference;
  view: ViewMode;
  onSort: (key: SortKey) => void;
  selection: ReturnType<typeof useSelection>;
  searching: boolean;
  datesPartial: boolean;
  onOpen: (node: VfsNode) => void;
  onToggle: (node: VfsNode) => void;
  onContext: (node: VfsNode, at: { x: number; y: number }) => void;
  onSelectNode: (node: VfsNode, modifiers: ClickModifiers) => void;
  scroller: React.RefObject<HTMLDivElement | null>;
  everyFolder: VfsNode[];
  tree: TreeIndex | null;
  decoration: Decoration;
  focused: VfsNode | null;
  detail: React.ReactNode;
}) {
  if (props.loading || (!props.location.folderId && props.folders === null)) {
    return (
      <div className="p-3">
        {Array.from({ length: 9 }, (_, index) => (
          <Skeleton key={index} className="mb-1.5 h-7 w-full rounded-[7px]" />
        ))}
      </div>
    );
  }

  if (props.failed) {
    return (
      <div className="gf-win-empty">
        <EmptyState
          icon={<AlertIcon />}
          title="We couldn't load this"
          action={
            <button type="button" onClick={props.onRetry} className="gf-button-primary">
              Try again
            </button>
          }
        >
          {props.error ?? "Your folders are safe — this is only the listing failing to load."} Check your connection
          and try again.
        </EmptyState>
      </div>
    );
  }

  const view = props.view;
  const select = props.onSelectNode;

  // Columns keeps working with nothing in the current directory — its other
  // columns are still the way around. The rest have nothing left to draw.
  if (props.nodes.length === 0 && view !== "columns") {
    return <EmptyListing location={props.location} search={props.search} onClearSearch={props.onClearSearch} />;
  }

  if (view === "columns") {
    return (
      <ColumnsView
        rootNodes={props.everyFolder}
        location={props.location}
        tree={props.tree}
        decoration={props.decoration}
        sort={props.preference.sort}
        direction={props.preference.direction}
        isSelected={props.selection.isSelected}
        cursor={props.selection.cursor}
        onSelect={select}
        onOpen={props.onOpen}
        detail={props.detail}
      />
    );
  }

  if (view === "gallery") {
    return (
      <GalleryView
        nodes={props.groups ? props.groups.flatMap((group) => group.rows.map((row) => row.node)) : props.nodes}
        focused={props.focused}
        isSelected={props.selection.isSelected}
        cursor={props.selection.cursor}
        onSelect={(node, modifiers) => {
          select(node, modifiers);
          if (node.kind === "file") props.onOpen(node);
        }}
        onOpen={props.onOpen}
        detail={props.detail}
      />
    );
  }

  if (view === "icons") {
    return (
      <IconsView
        nodes={props.nodes}
        groups={props.groups ? props.groups.map((group) => ({
          id: group.id, label: group.label, nodes: group.rows.map((row) => row.node),
        })) : null}
        size={props.preference.iconSize}
        isSelected={props.selection.isSelected}
        cursor={props.selection.cursor}
        onSelect={select}
        onOpen={props.onOpen}
        showPath={props.searching}
      />
    );
  }

  return (
    <ListView
      rows={props.rows}
      columns={props.location.folderId ? FOLDER_COLUMNS : ROOT_COLUMNS}
      groups={props.groups}
      sort={props.preference.sort}
      direction={props.preference.direction}
      onSort={props.onSort}
      isSelected={props.selection.isSelected}
      cursor={props.selection.cursor}
      onSelect={select}
      onOpen={props.onOpen}
      onToggle={props.onToggle}
      onContext={props.onContext}
      showPath={props.searching}
      datesPartial={props.datesPartial}
      scroller={props.scroller}
    />
  );
}

function EmptyListing({
  location, search, onClearSearch,
}: { location: Location; search: string; onClearSearch: () => void }) {
  if (search.trim()) {
    return (
      <div className="gf-win-empty">
        <EmptyState
          icon={<SearchIcon />}
          title="Nothing here matches that"
          action={
            <button type="button" onClick={onClearSearch} className="gf-button-secondary">
              Clear the search
            </button>
          }
        >
          Nothing in this place is called “{search.trim()}”. Try part of the name instead.
        </EmptyState>
      </div>
    );
  }
  if (!location.folderId) {
    const empty: Record<string, { title: string; body: string }> = {
      all: {
        title: "No folders yet",
        body: "Ask your AI agent to protect a folder for you — something like “create a GoodFolder called Q3 report” — and it will show up here with its own history.",
      },
      shared: { title: "Nobody has shared a folder with you", body: "When someone invites you to a folder, it appears here." },
      review: { title: "Nothing is waiting for you", body: "Suggestions from people and agents land here until you accept or reject them." },
      recent: { title: "Nothing has been saved yet", body: "As soon as work is saved into one of your folders, it shows up here." },
    };
    const copy = empty[location.scope] ?? empty.all!;
    return (
      <div className="gf-win-empty">
        <EmptyState icon={<FolderIcon />} title={copy.title}>{copy.body}</EmptyState>
      </div>
    );
  }
  return (
    <div className="gf-win-empty">
      <EmptyState icon={<FolderIcon />} title="Nothing here">
        This folder holds no files yet. A folder with nothing in it is not part of what a Save protects, so only
        folders that hold something appear here.
      </EmptyState>
    </div>
  );
}

/* ---------------------------------------------------------- Reading a file */

function FileSurface({
  opened, folder, data, onClose, onSaved, onRefreshProposals, onReviewProposal, onNotice,
}: {
  opened: OpenedFile | null;
  folder: Folder | null;
  data: ReturnType<typeof useFolderData>["data"];
  onClose: () => void;
  onSaved: (head: string) => void;
  onRefreshProposals: () => Promise<void>;
  onReviewProposal: (proposal: ChangeProposal, action: "accept" | "reject") => Promise<void>;
  onNotice: (notice: NoticeMessage | null) => void;
}) {
  if (!folder || !data || !opened) {
    return (
      <div className="p-5">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-72 w-full rounded-[var(--gf-radius)]" />
      </div>
    );
  }
  return (
    <DocumentSurface
      folder={folder}
      file={opened}
      head={data.head}
      role={data.role}
      proposals={data.proposals}
      onClose={onClose}
      onSaved={onSaved}
      onRefreshProposals={onRefreshProposals}
      onReviewProposal={onReviewProposal}
      onNotice={onNotice}
    />
  );
}

/* ------------------------------------------------------------- New folder */

/**
 * Naming a new GoodFolder.
 *
 * The dashboard could never make one before, which made the emptiest possible
 * first screen — no folders, and nothing to do about it. What comes back from
 * the server includes a credential for a computer; it is not read here and
 * never shown. The person is told the one command that brings the folder down
 * to the machine it should live on.
 */
function NameFolder({ onCancel, onName }: { onCancel: () => void; onName: (name: string) => void }) {
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="gf-win-glance-scrim" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form
        className="gf-card gf-card-lg w-full max-w-[24rem] p-6"
        role="dialog"
        aria-modal="true"
        aria-label="New folder"
        onSubmit={(event) => {
          event.preventDefault();
          onName(name);
        }}
      >
        <h2 className="text-[17px] font-bold tracking-[-.02em]">New folder</h2>
        <p className="gf-body mt-1.5 text-[13px]">
          It is made here, and comes down to a computer when you ask for it there.
        </p>
        <label htmlFor="gf-new-folder" className="gf-label mt-4">Name</label>
        <input
          id="gf-new-folder"
          ref={field}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Q3 Report"
          className="gf-input"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="gf-button-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="gf-button-primary" disabled={!name.trim()}>Create</button>
        </div>
      </form>
    </div>
  );
}
