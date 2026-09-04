// How each place in the window was last shown.
//
// A file manager that forgets is annoying in a way that is hard to name: you
// set a folder of photographs to big icons, leave, come back, and it is a list
// again. So this remembers per place, the way Finder does — and falls back to
// one set of defaults everywhere it has no memory.
//
// It lives in the browser, not the address and not the server. A preference is
// not a place: putting the view in the address would put it in every link
// someone shares, and in every address an assistant reads.
//
// Every read is defensive. Storage can be absent (a private window), full, or
// carrying something an older build wrote, and none of those may stop the
// window from drawing.

import type { GroupKey, SortDirection, SortKey } from "./vfs.ts";

export type ViewMode = "icons" | "list" | "columns" | "gallery";

export const VIEW_MODES: readonly ViewMode[] = ["icons", "list", "columns", "gallery"];

/**
 * How one place is shown — everything except which view it is in.
 *
 * The view deliberately belongs to the window, not to the place. Remembering
 * it per folder is what Finder does, and it is the thing about Finder people
 * complain about: clicking a file that happens to live one level up flips the
 * whole window into a different view for no reason the person can see. Sorting
 * a folder of photographs by date and having that stick is useful; the view
 * changing under you is not.
 */
export interface ViewPreference {
  sort: SortKey;
  direction: SortDirection;
  group: GroupKey;
  /** Tile width in pixels for the icon view. */
  iconSize: number;
  /** Whether the preview panel sits beside the listing. */
  previewPane: boolean;
}

export interface ViewPrefsState {
  version: number;
  /** One view for the whole window, wherever you are in it. */
  view: ViewMode;
  /** Used wherever a place has no memory of its own. */
  defaults: ViewPreference;
  /**
   * Place key → how that place was told to look, in full.
   *
   * Whole records rather than differences from the defaults, so that a place
   * set on purpose keeps its own view even when the default later moves onto
   * the same value and off it again.
   */
  places: Record<string, ViewPreference>;
  /** Place key → directories left open in the list view. */
  expanded: Record<string, string[]>;
  /** Folder ids kept in the sidebar, in the order they were added. */
  pinned: string[];
  sidebarCollapsed: boolean;
}

export const STORAGE_KEY = "goodfolder.window.v1";
export const PREFS_VERSION = 1;

export const MIN_ICON_SIZE = 72;
export const MAX_ICON_SIZE = 208;

/**
 * Columns, because it opens straight onto an inline preview of whatever's
 * selected — the fastest way to see what's actually inside a folder.
 */
export const DEFAULT_VIEW: ViewMode = "columns";

export const DEFAULT_PREFERENCE: ViewPreference = {
  sort: "name",
  direction: "asc",
  group: "none",
  iconSize: 112,
  previewPane: false,
};

export const DEFAULT_STATE: ViewPrefsState = {
  version: PREFS_VERSION,
  view: DEFAULT_VIEW,
  defaults: DEFAULT_PREFERENCE,
  places: {},
  expanded: {},
  pinned: [],
  sidebarCollapsed: false,
};

/** How many places keep a memory before the oldest are let go. */
const PLACE_LIMIT = 60;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Some browsers throw on the property itself when site data is blocked.
    return null;
  }
}

/* ------------------------------------------------------------- Validation */

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clampIconSize(value: unknown, fallback: number): number {
  const size = Number(value);
  if (!Number.isFinite(size)) return fallback;
  return Math.min(MAX_ICON_SIZE, Math.max(MIN_ICON_SIZE, Math.round(size)));
}

const SORT_KEYS: readonly SortKey[] = ["name", "kind", "size", "changed", "review"];
const DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];
const GROUP_KEYS: readonly GroupKey[] = ["none", "kind", "changed"];

/** Coerce anything into a whole, usable preference. */
export function normalizePreference(value: unknown, base: ViewPreference = DEFAULT_PREFERENCE): ViewPreference {
  const raw = (value ?? {}) as Partial<ViewPreference>;
  return {
    sort: oneOf(raw.sort, SORT_KEYS, base.sort),
    direction: oneOf(raw.direction, DIRECTIONS, base.direction),
    group: oneOf(raw.group, GROUP_KEYS, base.group),
    iconSize: clampIconSize(raw.iconSize, base.iconSize),
    previewPane: typeof raw.previewPane === "boolean" ? raw.previewPane : base.previewPane,
  };
}

function stringList(value: unknown, limit = 500): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item || out.includes(item)) continue;
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Take whatever is in storage and return something whole.
 *
 * Anything unrecognised — a different version, a truncated write, a value from
 * a build that no longer exists — becomes the defaults rather than an error.
 */
export function migrateState(raw: unknown): ViewPrefsState {
  if (!raw || typeof raw !== "object") return DEFAULT_STATE;
  const value = raw as Partial<ViewPrefsState>;
  if (Number(value.version) !== PREFS_VERSION) return DEFAULT_STATE;

  const defaults = normalizePreference(value.defaults);
  const places: Record<string, ViewPreference> = {};
  if (value.places && typeof value.places === "object") {
    for (const [key, stored] of Object.entries(value.places).slice(-PLACE_LIMIT)) {
      places[key] = normalizePreference(stored, defaults);
    }
  }

  const expanded: Record<string, string[]> = {};
  if (value.expanded && typeof value.expanded === "object") {
    for (const [key, paths] of Object.entries(value.expanded).slice(-PLACE_LIMIT)) {
      const list = stringList(paths);
      if (list.length > 0) expanded[key] = list;
    }
  }

  return {
    version: PREFS_VERSION,
    view: oneOf((raw as { view?: unknown }).view, VIEW_MODES, DEFAULT_VIEW),
    defaults,
    places,
    expanded,
    pinned: stringList(value.pinned, 40),
    sidebarCollapsed: value.sidebarCollapsed === true,
  };
}

/* --------------------------------------------------------------- Read and write */

export function readPrefs(storage: StorageLike | null = browserStorage()): ViewPrefsState {
  if (!storage) return DEFAULT_STATE;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    return migrateState(JSON.parse(raw));
  } catch {
    return DEFAULT_STATE;
  }
}

export function writePrefs(state: ViewPrefsState, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full or blocked store is not worth interrupting anyone over. The
    // window keeps working; it just will not remember this one change.
  }
}

export function clearPrefs(storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to recover from */
  }
}

/* ---------------------------------------------------------------- Queries */

/** How one place should be shown, defaults filled in. */
export function preferenceFor(state: ViewPrefsState, key: string): ViewPreference {
  return normalizePreference(state.places[key], state.defaults);
}

/**
 * Change how one place is shown.
 *
 * The change also becomes the new default, so setting a folder of photographs
 * to icons carries into the next folder you open that has no memory — which is
 * what people expect and what Finder does.
 */
export function withPreference(
  state: ViewPrefsState,
  key: string,
  patch: Partial<ViewPreference>,
): ViewPrefsState {
  const next = normalizePreference({ ...preferenceFor(state, key), ...patch }, state.defaults);
  const places = { ...state.places };
  // Re-inserting moves this place to the end, which is what marks it as the
  // most recently used when the oldest memories are let go.
  delete places[key];
  places[key] = next;
  return {
    ...state,
    defaults: normalizePreference(patch, state.defaults),
    places: prune(places),
  };
}

/** Forget one place, so it goes back to following the defaults. */
export function forgetPlace(state: ViewPrefsState, key: string): ViewPrefsState {
  if (!(key in state.places) && !(key in state.expanded)) return state;
  const places = { ...state.places };
  const expanded = { ...state.expanded };
  delete places[key];
  delete expanded[key];
  return { ...state, places, expanded };
}

export function expandedIn(state: ViewPrefsState, key: string): string[] {
  return state.expanded[key] ?? [];
}

export function withExpanded(state: ViewPrefsState, key: string, paths: string[]): ViewPrefsState {
  const list = stringList(paths);
  const expanded = { ...state.expanded };
  if (list.length > 0) expanded[key] = list;
  else delete expanded[key];
  return { ...state, expanded: prune(expanded) };
}

export function isPinned(state: ViewPrefsState, folderId: string): boolean {
  return state.pinned.includes(folderId);
}

export function togglePinned(state: ViewPrefsState, folderId: string): ViewPrefsState {
  if (!folderId) return state;
  const pinned = state.pinned.includes(folderId)
    ? state.pinned.filter((id) => id !== folderId)
    : [...state.pinned, folderId].slice(-40);
  return { ...state, pinned };
}

/** Change the window's view. It applies everywhere, immediately. */
export function withView(state: ViewPrefsState, view: ViewMode): ViewPrefsState {
  return { ...state, view: oneOf(view, VIEW_MODES, state.view) };
}

export function withSidebarCollapsed(state: ViewPrefsState, collapsed: boolean): ViewPrefsState {
  return { ...state, sidebarCollapsed: collapsed };
}

/** Keep the newest places only. Insertion order is the age order here. */
function prune<T>(record: Record<string, T>): Record<string, T> {
  const keys = Object.keys(record);
  if (keys.length <= PLACE_LIMIT) return record;
  const kept: Record<string, T> = {};
  for (const key of keys.slice(keys.length - PLACE_LIMIT)) kept[key] = record[key]!;
  return kept;
}
