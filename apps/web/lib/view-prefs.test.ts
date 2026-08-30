import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREFERENCE,
  DEFAULT_STATE,
  MAX_ICON_SIZE,
  MIN_ICON_SIZE,
  PREFS_VERSION,
  STORAGE_KEY,
  clearPrefs,
  expandedIn,
  forgetPlace,
  isPinned,
  migrateState,
  normalizePreference,
  preferenceFor,
  readPrefs,
  togglePinned,
  withExpanded,
  withPreference,
  withSidebarCollapsed,
  withView,
  writePrefs,
  type StorageLike,
  type ViewPrefsState,
} from "./view-prefs.ts";

function fakeStorage(seed: string | null = null): StorageLike & { value: string | null } {
  return {
    value: seed,
    getItem() {
      return this.value;
    },
    setItem(_key: string, value: string) {
      this.value = value;
    },
    removeItem() {
      this.value = null;
    },
  };
}

function refusingStorage(): StorageLike {
  return {
    getItem() {
      throw new Error("site data is blocked");
    },
    setItem() {
      throw new Error("quota exceeded");
    },
    removeItem() {
      throw new Error("site data is blocked");
    },
  };
}

/* ------------------------------------------------------------- Validation */

test("normalizePreference fills in whatever is missing", () => {
  assert.deepEqual(normalizePreference(undefined), DEFAULT_PREFERENCE);
  assert.deepEqual(normalizePreference({}), DEFAULT_PREFERENCE);
  assert.equal(normalizePreference({ group: "kind" }).group, "kind");
  assert.equal(normalizePreference({ group: "kind" }).sort, DEFAULT_PREFERENCE.sort);
});

test("normalizePreference refuses a value it does not recognise", () => {
  const preference = normalizePreference({ sort: "colour", direction: "sideways", group: 7 });
  assert.deepEqual(preference, DEFAULT_PREFERENCE);
});

test("normalizePreference keeps the icon size inside what can be drawn", () => {
  assert.equal(normalizePreference({ iconSize: 4 }).iconSize, MIN_ICON_SIZE);
  assert.equal(normalizePreference({ iconSize: 9000 }).iconSize, MAX_ICON_SIZE);
  assert.equal(normalizePreference({ iconSize: "big" }).iconSize, DEFAULT_PREFERENCE.iconSize);
  assert.equal(normalizePreference({ iconSize: 120.6 }).iconSize, 121);
});

/* -------------------------------------------------------------- Migration */

test("migrateState turns anything unusable into the defaults", () => {
  for (const raw of [null, undefined, 7, "list", [], {}, { version: 99 }]) {
    assert.deepEqual(migrateState(raw), DEFAULT_STATE, JSON.stringify(raw));
  }
});

test("migrateState keeps a record this build understands", () => {
  const state = migrateState({
    version: PREFS_VERSION,
    view: "columns",
    defaults: { sort: "kind" },
    places: { "f1:figures": { sort: "size", direction: "desc" } },
    expanded: { f1: ["figures", "figures"] },
    pinned: ["f1", "f1", "f2"],
    sidebarCollapsed: true,
  });
  assert.equal(state.view, "columns");
  assert.equal(preferenceFor(state, "f1:figures").sort, "size");
  assert.deepEqual(state.expanded.f1, ["figures"], "duplicates are dropped");
  assert.deepEqual(state.pinned, ["f1", "f2"]);
  assert.equal(state.sidebarCollapsed, true);
});

test("migrateState fills a half-written place record from the defaults", () => {
  const state = migrateState({
    version: PREFS_VERSION,
    defaults: { sort: "changed", group: "kind" },
    places: { f1: { sort: "size" } },
  });
  assert.equal(preferenceFor(state, "f1").sort, "size");
  assert.equal(preferenceFor(state, "f1").group, "kind", "the rest comes from the defaults");
});

test("the view belongs to the window, not to a place", () => {
  // Finder remembers the view per folder, and that is precisely how clicking
  // a file one level up flips the whole window into another view.
  let state = withView(DEFAULT_STATE, "columns");
  state = withPreference(state, "photos", { sort: "changed" });
  assert.equal(state.view, "columns");
  assert.equal(withView(state, "not-a-view" as never).view, "columns", "an unknown view is refused");
  assert.equal(Object.keys(preferenceFor(state, "photos")).includes("view"), false);
});

/* --------------------------------------------------------- Read and write */

test("readPrefs and writePrefs round-trip through storage", () => {
  const storage = fakeStorage();
  const state = withPreference(withView(DEFAULT_STATE, "icons"), "f1", { iconSize: 160 });
  writePrefs(state, storage);
  assert.ok(storage.value?.includes(STORAGE_KEY) === false, "the key is the address, not the payload");
  assert.deepEqual(readPrefs(storage), state);
});

test("readPrefs survives an empty, broken, or refusing store", () => {
  assert.deepEqual(readPrefs(fakeStorage(null)), DEFAULT_STATE);
  assert.deepEqual(readPrefs(fakeStorage("{not json")), DEFAULT_STATE);
  assert.deepEqual(readPrefs(fakeStorage('{"version":1,"defaults":')), DEFAULT_STATE);
  assert.deepEqual(readPrefs(refusingStorage()), DEFAULT_STATE);
  assert.deepEqual(readPrefs(null), DEFAULT_STATE);
});

test("writing to a refusing store is quiet, not fatal", () => {
  assert.doesNotThrow(() => writePrefs(DEFAULT_STATE, refusingStorage()));
  assert.doesNotThrow(() => writePrefs(DEFAULT_STATE, null));
  assert.doesNotThrow(() => clearPrefs(refusingStorage()));
});

/* ---------------------------------------------------------------- Queries */

test("a place with no memory follows the defaults", () => {
  assert.deepEqual(preferenceFor(DEFAULT_STATE, "anywhere"), DEFAULT_PREFERENCE);
});

test("changing a place also becomes the default for places never visited", () => {
  const state = withPreference(DEFAULT_STATE, "f1", { sort: "size" });
  assert.equal(preferenceFor(state, "f1").sort, "size");
  assert.equal(preferenceFor(state, "never-opened").sort, "size");
});

test("a place that was sorted on purpose keeps that order when the default moves", () => {
  let state = withPreference(DEFAULT_STATE, "photos", { sort: "changed" });
  state = withPreference(state, "reports", { sort: "name" });
  assert.equal(preferenceFor(state, "photos").sort, "changed", "the photo folder was sorted by date");
  assert.equal(preferenceFor(state, "reports").sort, "name");
  assert.equal(preferenceFor(state, "never-opened").sort, "name");
});

test("a place set back to today's default still holds it when the default moves on", () => {
  let state = withPreference(DEFAULT_STATE, "photos", { sort: "changed" });
  state = withPreference(state, "photos", { sort: "name" });
  state = withPreference(state, "reports", { sort: "size" });
  assert.equal(preferenceFor(state, "photos").sort, "name", "photos was sorted by name on purpose");
  assert.equal(preferenceFor(state, "never-opened").sort, "size");
});

test("sort, grouping and the preview panel are remembered per place too", () => {
  const state = withPreference(DEFAULT_STATE, "f1", {
    sort: "changed",
    direction: "desc",
    group: "kind",
    previewPane: true,
  });
  const preference = preferenceFor(state, "f1");
  assert.equal(preference.sort, "changed");
  assert.equal(preference.direction, "desc");
  assert.equal(preference.group, "kind");
  assert.equal(preference.previewPane, true);
});

test("forgetPlace sends a place back to following the defaults", () => {
  let state = withPreference(DEFAULT_STATE, "photos", { sort: "changed" });
  state = withPreference(state, "reports", { sort: "kind" });
  state = withExpanded(state, "photos", ["a"]);
  state = forgetPlace(state, "photos");
  assert.equal(preferenceFor(state, "photos").sort, "kind");
  assert.deepEqual(expandedIn(state, "photos"), []);
  assert.equal(forgetPlace(state, "never-known"), state, "forgetting nothing changes nothing");
});

test("expanded directories are kept per place and cleaned up when empty", () => {
  let state = withExpanded(DEFAULT_STATE, "f1", ["figures", "figures/old"]);
  assert.deepEqual(expandedIn(state, "f1"), ["figures", "figures/old"]);
  state = withExpanded(state, "f1", []);
  assert.deepEqual(expandedIn(state, "f1"), []);
  assert.deepEqual(Object.keys(state.expanded), []);
});

test("pinning a folder toggles, and never pins the same folder twice", () => {
  let state = togglePinned(DEFAULT_STATE, "f1");
  assert.equal(isPinned(state, "f1"), true);
  state = togglePinned(state, "f1");
  assert.equal(isPinned(state, "f1"), false);
  assert.equal(togglePinned(state, ""), state);
});

test("the sidebar remembers being closed", () => {
  assert.equal(withSidebarCollapsed(DEFAULT_STATE, true).sidebarCollapsed, true);
});

test("only the newest places are remembered", () => {
  let state: ViewPrefsState = DEFAULT_STATE;
  for (let i = 0; i < 200; i += 1) {
    state = withPreference(state, `place-${i}`, { sort: i % 2 === 0 ? "size" : "kind" });
  }
  assert.equal(Object.keys(state.places).length, 60);
  assert.equal(state.places["place-0"], undefined, "the oldest place was let go");
  assert.ok(state.places["place-199"], "the newest place is kept");
  const roundTripped = migrateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(roundTripped, state);
});
