import { applyAnchoredSuggestion } from "./collaboration.ts";
import { applyDelimitedEdits, type TableEdit, type TableError } from "./table.ts";

/**
 * A proposal's stored kind. `text` and `table` transform a file's contents;
 * `asset`, `rename` and `remove` change which files a folder holds and touch
 * no contents at all. This module is only about the first two — the second
 * family is named here so it is refused on purpose rather than by accident.
 */
export type StoredSuggestionKind = "text" | "table" | "asset" | "rename" | "remove";

/** True for the kinds that change the folder's files rather than a file's text. */
export function isFileOperation(kind: StoredSuggestionKind | string | null): boolean {
  return kind === "asset" || kind === "rename" || kind === "remove";
}

export interface StoredProposalSuggestion {
  kind: StoredSuggestionKind | null;
  before: string;
  replacement: string;
  operation: unknown;
}

/** A media file and the text that refers to it must be reviewed as one unit. */
export function isDocumentMediaBundle(suggestions: StoredProposalSuggestion[]): boolean {
  return suggestions.length === 2 &&
    suggestions.some((suggestion) => suggestion.kind === "asset") &&
    suggestions.some((suggestion) => suggestion.kind === "text") &&
    suggestions.every((suggestion) => {
      const operation = suggestion.operation && typeof suggestion.operation === "object"
        ? suggestion.operation as Record<string, unknown>
        : {};
      return operation.bundle === "document_media";
    });
}

export type ProposalApplyError =
  | "missing"
  | "ambiguous"
  | "unsupported"
  | TableError;

export type ProposalApplyResult = { content: string } | { error: ProposalApplyError };

function operationFor(suggestion: StoredProposalSuggestion):
  | { kind: "text_replace"; before: string; replacement: string }
  | { kind: "table_update"; changes: TableEdit[]; malformed?: boolean }
  | { kind: "file_operation" } {
  const operation = suggestion.operation && typeof suggestion.operation === "object"
    ? suggestion.operation as Record<string, unknown>
    : {};
  if (suggestion.kind === "table" || operation.kind === "table_update") {
    if (!Array.isArray(operation.changes)) return { kind: "table_update", changes: [], malformed: true };
    let malformed = false;
    const changes = operation.changes.flatMap((change): TableEdit[] => {
      if (!change || typeof change !== "object") {
        malformed = true;
        return [];
      }
      const value = change as Record<string, unknown>;
      if (typeof value.address !== "string" || typeof value.before !== "string" || typeof value.replacement !== "string") {
        malformed = true;
        return [];
      }
      return [{ address: value.address, before: value.before, replacement: value.replacement }];
    });
    return { kind: "table_update", changes, malformed };
  }
  if (isFileOperation(suggestion.kind) || operation.kind === "asset_replace") return { kind: "file_operation" };
  return {
    kind: "text_replace",
    before: typeof operation.before === "string" ? operation.before : suggestion.before,
    replacement: typeof operation.replacement === "string" ? operation.replacement : suggestion.replacement,
  };
}

/** Apply a single-file proposal in memory, before the repository write gate. */
export function applyProposalOperations(
  content: string,
  path: string,
  suggestions: StoredProposalSuggestion[],
): ProposalApplyResult {
  if (suggestions.length === 0) return { error: "unsupported" };
  const operations = suggestions.map(operationFor);
  const kinds = new Set(operations.map((operation) => operation.kind));
  if (kinds.size !== 1 || kinds.has("file_operation")) return { error: "unsupported" };

  if (operations[0]!.kind === "text_replace") {
    let next = content;
    for (const operation of operations) {
      if (operation.kind !== "text_replace") continue;
      const applied = applyAnchoredSuggestion(next, operation.before, operation.replacement);
      if ("error" in applied) return applied;
      next = applied.content;
    }
    return { content: next };
  }

  if (operations.some((operation) => operation.kind === "table_update" && operation.malformed)) {
    return { error: "malformed" };
  }
  const changes = operations.flatMap((operation) => operation.kind === "table_update" ? operation.changes : []);
  const applied = applyDelimitedEdits(content, path, changes);
  if ("error" in applied) return { error: applied.error };
  return { content: applied.content };
}
