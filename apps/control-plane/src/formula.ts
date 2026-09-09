/**
 * Which spreadsheet formulas a prepared file may carry.
 *
 * A generated spreadsheet is opened by the person who accepts it, in their own
 * spreadsheet program, with their own permissions. Arithmetic and lookups are
 * what a formula is for. A formula that reaches outside the workbook — to a
 * web address, another program, or a file on the person's computer — is not,
 * and is the classic way a spreadsheet is turned against whoever opens it.
 * Those are refused before the file is made, so there is nothing to review.
 */

const REACHES_OUTSIDE = [
  /\bHYPERLINK\s*\(/i,
  /\bWEBSERVICE\s*\(/i,
  /\bFILTERXML\s*\(/i,
  /\bIMPORT(?:DATA|RANGE|XML|HTML|FEED)\s*\(/i,
  /\bIMAGE\s*\(/i,
  /\bRTD\s*\(/i,
  /\b(?:CALL|REGISTER(?:\.ID)?|EXEC|EXECUTE|RUN|SEND\.KEYS|SHELL)\s*\(/i,
  /\bDDE\s*\(/i,
  /\|/, // DDE and external-command syntax: =cmd|' /C ...'!A0
  /\[[^\]]*\]/, // a reference into another workbook: [Book.xlsx]Sheet!A1
  /(?:^|[^A-Za-z0-9_])(?:https?|file|ftp|javascript|data|ms-\w+):/i,
];

/** Null when the formula stays inside the workbook; otherwise, the reason. */
export function formulaRefusal(formula: string): string | null {
  const text = formula.trim().replace(/^=/, "");
  if (text.length === 0) return "empty formula";
  if (text.length > 1_000) return "formula is too long";
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return "formula holds control characters";
  for (const pattern of REACHES_OUTSIDE) {
    if (pattern.test(text)) return "formula reaches outside the workbook";
  }
  return null;
}
