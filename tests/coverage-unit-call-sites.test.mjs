/*
 * 「全調查時段」的單位必須跟著資料涵蓋：滿 24 小時是「／調查日」，
 * 其餘是「／調查時段」。這支守門釘住 2026-09-26 複查時發現的四個漏網
 * 呼叫點，避免日後新增畫面或匯出時又把單位寫死。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/traffic-app.tsx", import.meta.url), "utf8");

test("車種組成的畫面、草稿與 Excel 單位都走涵蓋感知 helper", () => {
  for (const call of [
    'compositionUnit: compositionScopeUnit(record, scope)',
    'compositionUnit: compositionScopeUnit(focus, compositionKey)',
    '單位: compositionScopeUnit(record, scope)',
    'compositionScopeUnit(current, compositionScope)',
    'compositionScopeUnit(selected, "SURVEY")',
  ])
    assert.ok(source.includes(call), `缺少涵蓋感知的單位呼叫：${call}`);
});

test("全調查時段的現行畫面不可以把單位寫死為調查時段", () => {
  assert.doesNotMatch(source, /單位：輛／調查時段/);
  assert.doesNotMatch(source, /的累計量（輛／調查時段、PCU／調查時段）/);
  assert.doesNotMatch(source, /compositionUnit:\s*scope === "SURVEY"/);
  assert.doesNotMatch(source, /compositionUnit:\s*compositionKey === "SURVEY"/);
  assert.doesNotMatch(source, /單位:\s*scope === "SURVEY"/);
});
