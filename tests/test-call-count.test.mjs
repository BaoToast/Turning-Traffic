/*
 * ══════════════════════════════════════════════════════════════════════
 *  條數計數器：不可以把字串、正規式、註解裡的 test 當成真的呼叫
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-10-05 由姊妹系統全日交通量移植過來。那一支原本用
 *   `.replace(/\/\*[\s\S]*?\*\//g," ")` 刪註解，再用 `/^\s*test\(/gm` 數；
 * 測試標題裡只要出現 `scripts/*.mjs` 這種字串，裡面的註解開頭符號就會被當成
 * 真的註解，把後面整段吃掉——實測把真正 3 項數成 2 項。
 *
 * 這一支還多一個毛病：行首錨點。寫成 `});test(` 同一行的數不到——
 * 本專案的 tests/v170-features.test.mjs 實測正規式 13、語法樹 14。
 * ⚠️ 照實記：那一支**當時沒有造成任何紅錯**，因為四份現況文件都沒有宣稱
 *   它的條數，守門根本不會拿它去比。這是體質問題，不是當時的現行缺陷。
 *
 * ⚠️ 這一支就是「換成語法樹」的反證：把 scripts/test-call-count.mjs 換回
 *   正規式版，下面第一、第三、第四條會紅；第一條在 GPT 複查時補強 fixture。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { countTestCalls } from "../scripts/test-call-count.mjs";

test("字串裡的 scripts/*.mjs 不可以吞掉真正的 test 呼叫", () => {
  const fixture =
    'test("scripts/*.mjs",()=>{});\ntest("two",()=>{});\n/* 正常註解 */\ntest("three",()=>{});';
  assert.equal(countTestCalls(fixture), 3);
});

test("字串、正規式、註解裡的假 test 呼叫不計入", () => {
  const fixture = String.raw`const fake="test('not real')"; const pattern=/test\(/;
/* test("fake") */
// test("fake")
test("real",()=>{});`;
  assert.equal(countTestCalls(fixture), 1);
});

test("寫成 });test( 同一行的也要數到（行首錨點數不到）", () => {
  const fixture = 'test("one",()=>{\n});test("two",()=>{\n});';
  assert.equal(countTestCalls(fixture), 2);
});

test("本專案實際的 v170-features 守門是 14 項，不是 13", () => {
  const source = readFileSync(new URL("./v170-features.test.mjs", import.meta.url), "utf8");
  assert.equal(countTestCalls(source), 14);
});
