"use client";

import {
  ArrowLeftIcon, ArrowRightIcon, ChevronUpIcon, CloseIcon, HomeIcon, MoreHorizontalIcon,
  PeopleIcon, PlusIcon, SearchIcon, SidebarIcon, SortIcon, StarIcon, TimelineIcon,
  ViewColumnsIcon, ViewGalleryIcon, ViewIconsIcon, ViewListIcon,
} from "@/components/icons";
import { useState } from "react";
import { Menu, type MenuItem } from "@/components/finder/menu";
import { Tooltip, TooltipGroup } from "@/components/tooltip";
import { MAX_ICON_SIZE, MIN_ICON_SIZE } from "@/lib/view-prefs";
import type {
  GroupKey, SortDirection, SortKey, ViewMode, ViewPreference,
} from "@/components/finder/types";

const VIEWS: Array<{ id: ViewMode; label: string; hint: string; Glyph: (p: { className?: string }) => React.ReactElement }> = [
  { id: "icons", label: "Icons", hint: "1", Glyph: ViewIconsIcon },
  { id: "list", label: "List", hint: "2", Glyph: ViewListIcon },
  { id: "columns", label: "Columns", hint: "3", Glyph: ViewColumnsIcon },
  { id: "gallery", label: "Gallery", hint: "4", Glyph: ViewGalleryIcon },
];

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "name", label: "Name" },
  { id: "kind", label: "Kind" },
  { id: "size", label: "Size" },
  { id: "changed", label: "Last changed" },
  { id: "review", label: "Waiting for review" },
];

const GROUPS: Array<{ id: GroupKey; label: string }> = [
  { id: "none", label: "Nothing" },
  { id: "kind", label: "Kind" },
  { id: "changed", label: "Last changed" },
];

export interface ToolbarProps {
  title: string;
  view: ViewMode;
  onView: (view: ViewMode) => void;
  preference: ViewPreference;
  onPreference: (patch: Partial<ViewPreference>) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onHome: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  search: string;
  onSearch: (value: string) => void;
  searchLabel: string;
  /** True while a file fills the window: the view controls have no listing to act on. */
  reading?: boolean;
  /** Only at the root, where a new folder is a thing that can be made. */
  onNewFolder?: () => void;
  /** Inside a folder you own: pick files rather than dragging them in. */
  onAddFiles?: () => void;
  /** Folder-only actions; absent at the root. */
  folderActions?: {
    isPinned: boolean;
    onTogglePin: () => void;
    onShare: () => void;
    onTimeline: () => void;
    canShare: boolean;
  };
  extraActions?: MenuItem[];
}

export function Toolbar(props: ToolbarProps) {
  const { preference, onPreference } = props;
  // On a phone the search box is a whole row of chrome for something used
  // occasionally, so it waits behind its own glyph until it is wanted.
  const [searchOpen, setSearchOpen] = useState(false);
  const showSearch = searchOpen || props.search.length > 0;

  const sortItems: MenuItem[] = [
    ...SORTS.map((sort) => ({
      id: `sort-${sort.id}`,
      label: sort.label,
      checked: preference.sort === sort.id,
      onSelect: () => onPreference({ sort: sort.id }),
    })),
    ...(["asc", "desc"] as SortDirection[]).map((direction, index) => ({
      id: `direction-${direction}`,
      label: direction === "asc" ? "Ascending" : "Descending",
      checked: preference.direction === direction,
      dividerBefore: index === 0,
      onSelect: () => onPreference({ direction }),
    })),
    ...GROUPS.map((group, index) => ({
      id: `group-${group.id}`,
      label: index === 0 ? "Group by nothing" : `Group by ${group.label.toLowerCase()}`,
      checked: preference.group === group.id,
      dividerBefore: index === 0,
      onSelect: () => onPreference({ group: group.id }),
    })),
  ];

  const actionItems: MenuItem[] = [
    {
      id: "preview",
      label: preference.previewPane ? "Hide the preview panel" : "Show the preview panel",
      onSelect: () => onPreference({ previewPane: !preference.previewPane }),
    },
    ...(props.folderActions
      ? [
          {
            id: "pin",
            label: props.folderActions.isPinned ? "Stop keeping this to hand" : "Keep this folder to hand",
            dividerBefore: true,
            onSelect: props.folderActions.onTogglePin,
          },
          { id: "timeline", label: "What has happened here", onSelect: props.folderActions.onTimeline },
          {
            id: "share",
            label: "Who can see this",
            onSelect: props.folderActions.onShare,
          },
        ]
      : []),
    ...(props.extraActions ?? []),
  ];

  return (
    <div className="gf-win-toolbar" role="toolbar" aria-label="Window controls">
      <TooltipGroup>
      <Tooltip label={props.sidebarCollapsed ? "Show the places list" : "Hide the places list"}>
        <button
          type="button"
          className="gf-win-tool"
          aria-pressed={props.sidebarCollapsed}
          aria-label={props.sidebarCollapsed ? "Show the places list" : "Hide the places list"}
          onClick={props.onToggleSidebar}
        >
          <SidebarIcon />
        </button>
      </Tooltip>

      <div className="flex flex-none items-center">
        <Tooltip label="Back">
          <button
            type="button"
            className="gf-win-tool"
            aria-label="Back"
            disabled={!props.canGoBack}
            onClick={props.onBack}
          >
            <ArrowLeftIcon />
          </button>
        </Tooltip>
        <Tooltip label="Forward">
          <button
            type="button"
            className="gf-win-tool"
            aria-label="Forward"
            disabled={!props.canGoForward}
            onClick={props.onForward}
          >
            <ArrowRightIcon />
          </button>
        </Tooltip>
        <Tooltip label="Up one level">
          <button
            type="button"
            className="gf-win-tool gf-win-up"
            aria-label="Up one level"
            disabled={!props.canGoUp}
            onClick={props.onUp}
          >
            <ChevronUpIcon />
          </button>
        </Tooltip>
        <Tooltip label="All folders">
          <button type="button" className="gf-win-tool" aria-label="All folders" onClick={props.onHome}>
            <HomeIcon />
          </button>
        </Tooltip>
      </div>

      <p className="gf-win-title gf-truncate flex-1">{props.title}</p>

      {!props.reading && (
      <div className="gf-win-views" role="group" aria-label="How to show this">
        {VIEWS.map((view) => (
          <Tooltip key={view.id} label={`${view.label} view`} shortcut={`mod+${view.hint}`}>
            <button
              type="button"
              aria-pressed={props.view === view.id}
              aria-label={`${view.label} view`}
              onClick={() => props.onView(view.id)}
            >
              <view.Glyph />
            </button>
          </Tooltip>
        ))}
      </div>
      )}

      {!props.reading && <Menu label="Sort and group" trigger={<SortIcon />} items={sortItems} tooltip />}

      {!props.reading && props.view === "icons" && (
        <label className="gf-win-size-slider hidden md:flex">
          <span className="sr-only">Tile size</span>
          <ViewIconsIcon className="h-3 w-3 text-[var(--gf-ink-faint)]" />
          <input
            type="range"
            min={MIN_ICON_SIZE}
            max={MAX_ICON_SIZE}
            step={8}
            value={preference.iconSize}
            onChange={(event) => onPreference({ iconSize: Number(event.target.value) })}
          />
        </label>
      )}

      {props.folderActions?.canShare && (
        <Tooltip label="Who can see this">
          <button
            type="button"
            className="gf-win-tool hidden sm:inline-flex"
            aria-label="Who can see this"
            onClick={props.folderActions.onShare}
          >
            <PeopleIcon />
          </button>
        </Tooltip>
      )}
      {props.folderActions && (
        <Tooltip label="What has happened here">
          <button
            type="button"
            className="gf-win-tool hidden sm:inline-flex"
            aria-label="What has happened here"
            onClick={props.folderActions.onTimeline}
          >
            <TimelineIcon />
          </button>
        </Tooltip>
      )}
      {props.folderActions && (
        <Tooltip label={props.folderActions.isPinned ? "Stop keeping this to hand" : "Keep this folder to hand"}>
          <button
            type="button"
            className="gf-win-tool hidden sm:inline-flex"
            aria-pressed={props.folderActions.isPinned}
            aria-label={props.folderActions.isPinned ? "Stop keeping this to hand" : "Keep this folder to hand"}
            onClick={props.folderActions.onTogglePin}
          >
            <StarIcon />
          </button>
        </Tooltip>
      )}

      {props.onNewFolder && !props.reading && (
        <Tooltip label="New folder">
          <button type="button" className="gf-win-tool" aria-label="New folder" onClick={props.onNewFolder}>
            <PlusIcon />
          </button>
        </Tooltip>
      )}

      {props.onAddFiles && !props.reading && (
        <Tooltip label="Add files">
          <button type="button" className="gf-win-tool" aria-label="Add files" onClick={props.onAddFiles}>
            <PlusIcon />
          </button>
        </Tooltip>
      )}

      <Menu label="More actions" trigger={<MoreHorizontalIcon />} items={actionItems} tooltip />

      {!showSearch && (
        <Tooltip label={props.searchLabel} shortcut="mod+f">
          <button
            type="button"
            className="gf-win-tool sm:hidden"
            aria-label={props.searchLabel}
            aria-expanded={false}
            onClick={() => {
              setSearchOpen(true);
              window.requestAnimationFrame(() =>
                document.querySelector<HTMLInputElement>('[data-window-search="true"]')?.focus(),
              );
            }}
          >
            <SearchIcon />
          </button>
        </Tooltip>
      )}

      <label className={`gf-win-search ${showSearch ? "" : "hidden sm:flex"}`}>
        <SearchIcon />
        <span className="sr-only">{props.searchLabel}</span>
        <input
          type="search"
          value={props.search}
          placeholder={props.searchLabel}
          onChange={(event) => props.onSearch(event.target.value)}
          onBlur={() => {
            if (!props.search) setSearchOpen(false);
          }}
          data-window-search="true"
        />
        {props.search && (
          <button type="button" aria-label="Clear the search" onClick={() => props.onSearch("")}>
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </label>
      </TooltipGroup>
    </div>
  );
}
