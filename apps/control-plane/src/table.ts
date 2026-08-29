/**
 * Small, deliberately strict delimited-table engine used by file proposals.
 * It is not a spreadsheet formula engine. It only preserves the cell values
 * needed for a human-reviewed CSV/TSV edit and refuses malformed input.
 */

export const TABLE_ROW_CAP = 200;
export const TABLE_COL_CAP = 40;
export const TABLE_EDIT_CAP = 100;

export interface TableEdit {
  address: string;
  before: string;
  replacement: string;
}

export interface ParsedDelimitedTable {
  rows: string[][];
  delimiter: "," | "\t";
  lineEnding: "\n" | "\r\n" | "\r";
  hasFinalLineEnding: boolean;
  bom: boolean;
}

export type TableError =
  | "unsupported"
  | "malformed"
  | "invalid-address"
  | "duplicate-address"
  | "out-of-range"
  | "stale";

export type TableResult<T> =
  | T
  | { error: TableError; message: string; address?: string };

function delimiterForPath(path: string): "," | "\t" | null {
  if (/\.csv$/i.test(path)) return ",";
  if (/\.tsv$/i.test(path)) return "\t";
  return null;
}

function malformed(message: string): { error: "malformed"; message: string } {
  return { error: "malformed", message };
}

/** Parse a one-based A1 address such as A1, Z12, or AA203. */
export function parseCellAddress(address: string): { row: number; col: number } | null {
  const match = /^([A-Za-z]+)([1-9]\d*)$/.exec(address.trim());
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]!.toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  const row = Number(match[2]) - 1;
  col -= 1;
  if (!Number.isSafeInteger(row) || !Number.isSafeInteger(col) || row < 0 || col < 0) return null;
  return { row, col };
}

/** Parse CSV/TSV, including quoted delimiters, escaped quotes, and newlines. */
export function parseDelimitedTable(content: string, path: string): TableResult<ParsedDelimitedTable> {
  const delimiter = delimiterForPath(path);
  if (!delimiter) return { error: "unsupported", message: "Only CSV and TSV files can be edited as tables." };

  const bom = content.startsWith("\ufeff");
  const source = bom ? content.slice(1) : content;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let afterQuote = false;
  let fieldStarted = false;
  let lineEnding: "\n" | "\r\n" | "\r" = "\n";
  let foundLineEnding = false;
  let lastRecordEnded = false;

  function pushCell() {
    row.push(cell);
    cell = "";
    fieldStarted = false;
    afterQuote = false;
  }

  function pushRow() {
    pushCell();
    rows.push(row);
    row = [];
    lastRecordEnded = true;
  }

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        cell += ch;
      }
      lastRecordEnded = false;
      continue;
    }

    if (afterQuote) {
      if (ch === delimiter) {
        pushCell();
        lastRecordEnded = false;
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        const ending = ch === "\r" && source[i + 1] === "\n" ? "\r\n" : ch;
        if (!foundLineEnding) {
          lineEnding = ending;
          foundLineEnding = true;
        }
        if (ending === "\r\n") i += 1;
        pushRow();
        continue;
      }
      return malformed(`Unexpected character after a quoted cell at position ${i + 1}.`);
    }

    if (ch === '"') {
      if (fieldStarted || cell.length > 0) return malformed(`A quote must start a cell at position ${i + 1}.`);
      inQuotes = true;
      fieldStarted = true;
      lastRecordEnded = false;
      continue;
    }
    if (ch === delimiter) {
      pushCell();
      lastRecordEnded = false;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      const ending = ch === "\r" && source[i + 1] === "\n" ? "\r\n" : ch;
      if (!foundLineEnding) {
        lineEnding = ending;
        foundLineEnding = true;
      }
      if (ending === "\r\n") i += 1;
      pushRow();
      continue;
    }
    cell += ch;
    fieldStarted = true;
    lastRecordEnded = false;
  }

  if (inQuotes) return malformed("The table ends inside a quoted cell.");
  if (!lastRecordEnded && (row.length > 0 || fieldStarted || cell.length > 0)) pushRow();

  return {
    rows,
    delimiter,
    lineEnding,
    hasFinalLineEnding: lastRecordEnded,
    bom,
  };
}

function encodeCell(value: string, delimiter: "," | "\t"): string {
  if (!value.includes(delimiter) && !value.includes('"') && !/[\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function serializeDelimitedTable(table: ParsedDelimitedTable): string {
  const body = table.rows
    .map((row) => row.map((cell) => encodeCell(cell, table.delimiter)).join(table.delimiter))
    .join(table.lineEnding);
  return `${table.bom ? "\ufeff" : ""}${body}${table.hasFinalLineEnding && table.rows.length ? table.lineEnding : ""}`;
}

/** Apply exact, cell-addressed edits while retaining the source's table style. */
export function applyDelimitedEdits(content: string, path: string, edits: TableEdit[]): TableResult<{ content: string; table: ParsedDelimitedTable }> {
  if (!Array.isArray(edits) || edits.length === 0) {
    return { error: "invalid-address", message: "At least one table cell is required." };
  }
  if (edits.length > TABLE_EDIT_CAP) {
    return { error: "out-of-range", message: `A table proposal can contain at most ${TABLE_EDIT_CAP} cells.` };
  }
  const parsed = parseDelimitedTable(content, path);
  if ("error" in parsed) return parsed;

  const seen = new Set<string>();
  const rows = parsed.rows.map((current) => [...current]);
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  for (const edit of edits) {
    const address = typeof edit.address === "string" ? edit.address.trim().toUpperCase() : "";
    const position = parseCellAddress(address);
    if (!position) return { error: "invalid-address", message: `“${edit.address}” is not a valid cell address.`, address };
    if (seen.has(address)) return { error: "duplicate-address", message: `Cell ${address} appears more than once.`, address };
    seen.add(address);
    if (position.row >= TABLE_ROW_CAP || position.col >= TABLE_COL_CAP) {
      return { error: "out-of-range", message: `Cell ${address} is outside the first ${TABLE_ROW_CAP} rows and ${TABLE_COL_CAP} columns.`, address };
    }
    if (position.row >= rows.length || position.col >= maxColumns) {
      return { error: "out-of-range", message: `Cell ${address} is outside the current table.`, address };
    }
    while (rows[position.row]!.length <= position.col) rows[position.row]!.push("");
    if (rows[position.row]![position.col] !== edit.before) {
      return { error: "stale", message: `Cell ${address} no longer contains the expected value.`, address };
    }
    rows[position.row]![position.col] = edit.replacement;
  }

  const table = { ...parsed, rows };
  return { content: serializeDelimitedTable(table), table };
}
