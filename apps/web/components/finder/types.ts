// One import for everything the window's own pieces need, so a component
// reaches for `@/components/finder/types` rather than three modules.

export type {
  AccountPlan, ChangeProposal, Folder, FolderFile, OpenedFile,
  PlanCode, PlanDefinition, SaveRow,
} from "@/lib/gf-api";

export type {
  ChangeIndex, ChangeStamp, Crumb, DirectoryNode, FileNode, GoodFolderNode,
  GroupKey, Location, NodeGroup, ReviewIndex, RootScope, SortDirection,
  SortKey, TreeIndex, VfsNode,
} from "@/lib/vfs";

export {
  ROOT_LOCATION, ROOT_SCOPES, ROOT_SCOPE_LABEL,
  baseName, breadcrumb, changedBucket, descendantFiles, directoryName,
  filterNodes, filterRoot, folderChildren, groupNodes, kindLabel, locationKey,
  locationOf, parentLocation, rootChildren, sameLocation, sortNodes,
} from "@/lib/vfs";

export type { ViewMode, ViewPreference, ViewPrefsState } from "@/lib/view-prefs";

import type { ViewMode } from "@/lib/view-prefs";

/**
 * What the window is actually drawing, which is not always what was stored.
 *
 * `ViewMode` is the preference — the four a person can choose between, and
 * the only four that are ever written down. A narrow window draws `compact`
 * instead, whatever the preference says, and leaves the preference alone so
 * the same account on a laptop still opens in the view it was left in.
 */
export type ShownView = ViewMode | "compact";
export type { Role } from "@/components/document-surface";
