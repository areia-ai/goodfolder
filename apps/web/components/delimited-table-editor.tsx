"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseCellAddress,
  parseDelimitedTable,
  serializeDelimitedTable,
  TABLE_COL_CAP,
  TABLE_ROW_CAP,
  type TableEdit,
} from "@/lib/table";

export interface DelimitedTableChange {
  content: string;
  changes: TableEdit[];
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function cellAddress(row: number, col: number): string {
  return `${columnName(col)}${row + 1}`;
}

export function DelimitedTableEditor({
  path,
  content,
  onChange,
  onSelect,
}: {
  path: string;
  content: string;
  onChange: (change: DelimitedTableChange) => void;
  onSelect: (value: string) => void;
}) {
  const parsed = useMemo(() => parseDelimitedTable(content, path), [content, path]);
  const [rows, setRows] = useState<string[][]>([]);
  const [changes, setChanges] = useState<TableEdit[]>([]);
  const [selected, setSelected] = useState<string>("");
  const refs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if ("error" in parsed) {
      setRows([]);
      setChanges([]);
      setSelected("");
      onSelect("");
      return;
    }
    setRows(parsed.rows.map((row) => [...row]));
    setChanges([]);
    setSelected("");
    onSelect("");
  }, [parsed, onSelect]);

  useEffect(() => () => {
    if (typeof document !== "undefined") {
      delete document.body.dataset.gfSelectedCellAddress;
      delete document.body.dataset.gfSelectedCellValue;
    }
  }, []);

  if ("error" in parsed) {
    return (
      <div className="grid min-h-[420px] place-items-center p-8 text-center">
        <div className="max-w-md">
          <p className="gf-eyebrow">Table needs review</p>
          <h3 className="mt-2 text-[19px] font-bold tracking-[-.02em]">This {path.toLowerCase().endsWith(".tsv") ? "TSV" : "CSV"} is malformed</h3>
          <p className="gf-body mt-2 text-[14px]">{parsed.message} Nothing has been changed. Fix the file on a connected computer, then save it again.</p>
          <pre className="gf-change gf-change-before mt-5 max-h-52 overflow-auto text-left">{content}</pre>
        </div>
      </div>
    );
  }

  const table = parsed as import("@/lib/table").ParsedDelimitedTable;
  const displayRows = rows.slice(0, TABLE_ROW_CAP);
  const totalColumns = Math.max(1, Math.min(TABLE_COL_CAP, rows.reduce((max, row) => Math.max(max, row.length), 0)));
  const truncated = rows.length > TABLE_ROW_CAP || rows.some((row) => row.length > TABLE_COL_CAP);

  function publishSelection(address: string, value: string) {
    setSelected(address);
    if (typeof document !== "undefined") {
      document.body.dataset.gfSelectedCellAddress = address;
      document.body.dataset.gfSelectedCellValue = value;
    }
    onSelect(`${address}: ${value || "(empty)"}`);
  }

  function focusCell(row: number, col: number) {
    const address = cellAddress(row, col);
    window.requestAnimationFrame(() => refs.current[address]?.focus());
  }

  function updateCell(rowIndex: number, colIndex: number, value: string) {
    const address = cellAddress(rowIndex, colIndex);
    const original = table.rows[rowIndex]?.[colIndex] ?? "";
    const nextRows = rows.map((row) => [...row]);
    while (nextRows[rowIndex] && nextRows[rowIndex]!.length <= colIndex) nextRows[rowIndex]!.push("");
    if (!nextRows[rowIndex]) return;
    nextRows[rowIndex]![colIndex] = value;
    const nextChanges = changes.filter((change) => change.address !== address);
    if (value !== original) nextChanges.push({ address, before: original, replacement: value });
    setRows(nextRows);
    setChanges(nextChanges);
    publishSelection(address, value);
    onChange({ content: serializeDelimitedTable({ ...table, rows: nextRows }), changes: nextChanges });
  }

  function onCellKeyDown(event: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    let nextRow = row;
    let nextCol = col;
    if (event.key === "ArrowUp") nextRow -= 1;
    else if (event.key === "ArrowDown" || event.key === "Enter") nextRow += 1;
    else if (event.key === "ArrowLeft") nextCol -= 1;
    else if (event.key === "ArrowRight") nextCol += 1;
    else if (event.key === "Tab") {
      event.preventDefault();
      nextCol += event.shiftKey ? -1 : 1;
      if (nextCol < 0) {
        nextRow -= 1;
        nextCol = totalColumns - 1;
      } else if (nextCol >= totalColumns) {
        nextRow += 1;
        nextCol = 0;
      }
    } else return;
    if (nextRow < 0 || nextRow >= displayRows.length || nextCol < 0 || nextCol >= totalColumns) return;
    event.preventDefault();
    focusCell(nextRow, nextCol);
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gf-line)] px-4 py-3 sm:px-6">
        <div>
          <p className="text-[13px] font-semibold">{path.toLowerCase().endsWith(".tsv") ? "TSV" : "CSV"} table</p>
          <p className="gf-faint text-[12px]">Edit cells directly. {changes.length ? `${changes.length} pending ${changes.length === 1 ? "change" : "changes"}` : "No pending changes"}.</p>
        </div>
        <p className="gf-faint text-[12px]">{parsed.delimiter === "\t" ? "Tab-separated" : "Comma-separated"} · {parsed.lineEnding === "\r\n" ? "CRLF" : parsed.lineEnding === "\r" ? "CR" : "LF"}</p>
      </div>
      {truncated && (
        <p className="border-b border-[var(--gf-line)] bg-[var(--gf-surface-sunken)] px-4 py-2.5 text-[12px] text-[var(--gf-ink-muted)] sm:px-6">
          Showing the first {TABLE_ROW_CAP} rows and {TABLE_COL_CAP} columns. The rest stays unchanged and is not editable here.
        </p>
      )}
      <div className="max-h-[640px] overflow-auto" role="region" aria-label={`${path} table`}>
        <table className="min-w-full border-collapse text-left text-[12.5px]" role="grid" aria-rowcount={rows.length} aria-colcount={totalColumns}>
          <thead className="sticky top-0 z-[1] bg-[var(--gf-surface-sunken)]">
            <tr role="row">
              <th scope="col" className="sticky left-0 w-12 border-b border-r border-[var(--gf-line)] px-3 py-2 text-right font-mono text-[11px] text-[var(--gf-ink-faint)]">#</th>
              {Array.from({ length: totalColumns }, (_, col) => (
                <th key={col} scope="col" className="min-w-36 border-b border-r border-[var(--gf-line)] px-2.5 py-2 font-mono text-[11px] font-semibold text-[var(--gf-ink-muted)]">
                  {columnName(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, rowIndex) => (
              <tr key={rowIndex} role="row">
                <th scope="row" className="sticky left-0 border-b border-r border-[var(--gf-line)] bg-[var(--gf-surface-sunken)] px-3 py-1.5 text-right font-mono text-[11px] text-[var(--gf-ink-faint)]">{rowIndex + 1}</th>
                {Array.from({ length: totalColumns }, (_, colIndex) => {
                  const address = cellAddress(rowIndex, colIndex);
                  const value = row[colIndex] ?? "";
                  const changed = changes.some((change) => change.address === address);
                  return (
                    <td key={address} role="gridcell" aria-selected={selected === address} className={`border-b border-r border-[var(--gf-line)] p-0 ${selected === address ? "bg-[var(--gf-blue-soft)]" : "bg-white"}`}>
                      <input
                        ref={(node) => { refs.current[address] = node; }}
                        value={value}
                        onFocus={() => publishSelection(address, value)}
                        onClick={() => publishSelection(address, value)}
                        onChange={(event) => updateCell(rowIndex, colIndex, event.target.value)}
                        onKeyDown={(event) => onCellKeyDown(event, rowIndex, colIndex)}
                        aria-label={`${address}${value ? `, ${value}` : ", empty"}`}
                        className={`min-h-10 w-full min-w-36 border-0 bg-transparent px-2.5 py-2 outline-none focus:bg-[var(--gf-blue-soft)] focus:ring-2 focus:ring-inset focus:ring-[var(--gf-blue-ink)] ${changed ? "font-semibold" : ""}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {displayRows.length === 0 && <p className="p-8 text-center text-[13px] text-[var(--gf-ink-muted)]">This table is empty.</p>}
      </div>
    </div>
  );
}
