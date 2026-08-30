"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  acceptInvitation, getAccountPlan, listFolders, openFile as openFolderFile,
  reviewProposal, type AccountPlan, type ChangeProposal, type Folder, type OpenedFile,
} from "@/lib/gf-api";
import { AlertIcon, FolderIcon, SearchIcon, SparklesIcon } from "@/components/icons";
import { EmptyState, Notice, Skeleton, done, problem, type NoticeMessage } from "@/components/ui";
import { DocumentSurface } from "@/components/document-surface";
import { registerDashboardTools, webMcpSupported } from "@/lib/webmcp";
import { formatBytes } from "@/lib/preview";
import {
  ROOT_SCOPE_LABEL, baseName, breadcrumb, descendantFiles, filterNodes, filterRoot,
  flattenRows, folderChildren, groupNodes, locationKey, locationOf, parentLocation,
  rootChildren, sortNodes, type Decoration, type ListRow, type Location, type SortKey,
  type TreeIndex, type VfsNode,
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
import { useFolderData, LISTING_LIMIT } from "@/components/finder/use-folder-data";
import { useSelection, type ClickModifiers } from "@/components/finder/use-selection";

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
  const [opened, setOpened] = useState<OpenedFile | null>(null);

  const listing = useRef<HTMLDivElement>(null);
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

  const openedPath = location.file;
  useEffect(() => {
    if (!openedPath || !location.folderId) {
      setOpened(null);
      return;
    }
    if (!data || data.status !== "ready") return;
    const file = data.tree.byPath.get(openedPath);
    if (!file) {
      setOpened(null);
      setNotice(problem("That file is not in this folder any more."));
      return;
    }
    let cancelled = false;
    setOpened(null);
    openFolderFile(location.folderId, file)
      .then((result) => {
        if (!cancelled) setOpened(result);
      })
      .catch((error) => {
        if (!cancelled) setNotice(problem((error as Error).message));
      });
    return () => {
      cancelled = true;
    };
  }, [openedPath, location.folderId, data]);

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

  const refresh = useCallback(async () => {
    if (location.folderId) await store.refresh(location.folderId);
    await loadFolders();
  }, [location.folderId, store, loadFolders]);

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

  function onListKey(event: React.KeyboardEvent) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
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
    if (event.key === "Escape") {
      if (search) setSearch("");
      else selection.clear();
      return;
    }
    if (event.key.length === 1 && !modifier && !event.altKey) {
      // Type-ahead: letters typed quickly build one prefix, as in every file
      // list anyone has used.
      const now = Date.now();
      typed.current.buffer = now - typed.current.at > 900 ? event.key : typed.current.buffer + event.key;
      typed.current.at = now;
      selection.typeAhead(typed.current.buffer);
    }
  }

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

  const statusNote = location.folderId
    ? data?.truncated
      ? `Showing the first ${LISTING_LIMIT} items in this folder`
      : data?.changed.partial && preference.sort === "changed"
        ? "Some dates are older than the timeline reaches"
        : null
    : null;

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
            className={`gf-win-listing ${inlineDetail && !notice ? "gf-win-listing-fill" : ""}`}
            tabIndex={-1}
            onKeyDown={onListKey}
            onClick={(event) => {
              if (event.target === event.currentTarget) selection.clear();
            }}
          >
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
  const select = (node: VfsNode, modifiers: ClickModifiers) => props.selection.select(node.id, modifiers);

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
      onContext={() => {}}
      showPath={props.searching}
      datesPartial={props.datesPartial}
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
