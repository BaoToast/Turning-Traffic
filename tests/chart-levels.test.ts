/*
 * 圖說第 3、4 級：走三支共用的契約表。
 * ⚠️ 案例表在 tests/chart-levels-contract.mjs，三支逐位元相同——
 *   要改判斷規則就三支一起改，否則同一個數字在三支會被說成不同的狀況。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as levels from "../lib/chart-levels.ts";
import { checkChartLevelsContract } from "./chart-levels-contract.mjs";

test("圖說第 3、4 級符合三支共用的契約", () => {
  const failures: string[] = [];
  checkChartLevelsContract(levels, (label: string, passed: boolean, detail: string) => {
    if (!passed) failures.push(`${label} — ${detail}`);
  });
  assert.deepEqual(failures, []);
});

test("⚠️ 共用模組的內容要與另外兩支逐位元相同（SHA-256 釘住）", () => {
  const source = readFileSync(new URL("../lib/chart-levels.ts", import.meta.url));
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "0f9a62f51479e6807c859157a61064a0f96d187261ced9e747f05bb79810aa4c",
    "chart-levels.ts 改過了，但另外兩支可能沒跟著改",
  );
});
