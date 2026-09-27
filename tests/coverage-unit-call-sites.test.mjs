/*
 * 「全調查時段」的單位必須跟著資料涵蓋：滿 24 小時是「／調查日」，
 * 其餘是「／調查時段」。這支守門釘住 2026-09-26 複查時發現的四個漏網
 * 呼叫點，避免日後新增畫面或匯出時又把單位寫死。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/traffic-app.tsx", import.meta.url), "utf8");
const trafficSource = await readFile(new URL("../lib/traffic.ts", import.meta.url), "utf8");

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

/*
 * ══════════════════════════════════════════════════════════════════════
 *  性質級守門：原始碼裡不可以有寫死單位的**字串字面值**（2026-09-26 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 上面那兩支是「寫法級」的：它們比對特定的呼叫字串，以及四種特定的寫死寫法。
 * 2026-09-26 的複查指出那還不夠，兩個方向都有缺口：
 *
 *   ・**只守了一半**：反面斷言 `/單位：輛／調查時段/` 用的是**全形**斜線，
 *     而真正被修掉的字面值是**半形**的 `"輛/調查時段"`。
 *   ・**繞得過去**：把單位抽成變數再用——
 *       const u = scope === "SURVEY" ? "輛/調查時段" : "輛/hr";
 *       … compositionUnit: u
 *     五條斷言一條都不會紅。
 *
 * 所以這裡加一條**性質級**的：`app/traffic-app.tsx` 裡不可以出現
 * 「PCU 或輛 ＋ 斜線 ＋ 調查日／調查時段」的**字串字面值**，半形全形都算。
 * 單位一律要由 `scopeUnit()`／`compositionScopeUnit()` 算出來。
 *
 * ⚠️ 比對前要切掉註解與 `VERSION_HISTORY`：那兩處必然寫著歷次改版的敘述，
 *   凡是曾經存在過的寫法都在字串裡（這個坑在這個專案踩過兩次）。
 *   切完要**斷言真的切掉了、而且沒有切光**，否則這一支會變成恆真。
 * ⚠️ 只禁**字串字面值**，不禁 JSX 的說明文字：畫面上有一段是在解釋
 *   「滿 24 小時標示為…、其餘標示為…」這條規則，那句話本來就該寫出兩種單位。
 * ⚠️ 反證（2026-09-26 實測）：把 `compositionUnit: compositionScopeUnit(record, scope)`
 *   改回 `const u = scope === "SURVEY" ? "輛/調查時段" : "輛/hr"` 就紅。
 */
test("app/traffic-app.tsx 不可以出現寫死單位的字串字面值（半形全形都算）", () => {
  /* 切掉區塊註解、行註解與 VERSION_HISTORY。 */
  const historyAt = source.indexOf("VERSION_HISTORY");
  const withoutHistory =
    historyAt >= 0 ? source.slice(0, historyAt) : source;
  const stripped = withoutHistory
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  /* 前置檢查：真的切掉了，而且沒有切光。 */
  assert.ok(
    stripped.length < withoutHistory.length * 0.95,
    "註解幾乎沒有被切掉——切除樣式失效了，這一支會被註解裡的舊寫法蒙混",
  );
  assert.ok(
    stripped.length > 200_000,
    `切完只剩 ${stripped.length} 字——切過頭了，這一支等於沒在看程式`,
  );
  /* 前置檢查：正確的寫法真的在裡面（否則這一支對一個空檔案也會通過）。 */
  assert.match(
    stripped,
    /compositionScopeUnit\(/,
    "切完之後找不到 compositionScopeUnit(——切錯範圍了",
  );

  /*
   * ⚠️ 樣式刻意**不跨行**（`[^"'`\n]`）。第一版用了允許換行的寫法，
   *   結果一個反引號會一路吃到幾百行之後才收尾，把整段程式當成「字面值」
   *   報出來（實測到一段 CSV 的模板字串）。單位字面值一定寫在同一行。
   */
  const LITERAL = /(["'`])([^"'`\n]*(?:PCU|輛)[／/]調查(?:日|時段)[^"'`\n]*)\1/g;
  const hits = [...stripped.matchAll(LITERAL)].map((match) => match[0]);
  assert.deepEqual(
    hits,
    [],
    "原始碼裡有寫死單位的字串字面值。單位一律要由 scopeUnit()／" +
      "compositionScopeUnit() 依涵蓋算出來，寫死的那一份遲早與畫面其他地方不一致：\n  " +
      hits.join("\n  "),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  「N 個 M 分鐘區間」不可以報一個不存在的平均格長（2026-09-26 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * `survey.minutes` 自 v2.1.83 起是**逐格加總的實際分鐘數**，於是
 *   `Math.round(survey.minutes / survey.intervals)`
 * 變成「平均格長」。混用 60＋15 分鐘格時會印出「27 個 33 分鐘區間」——
 * 那個格長一格都不存在，而這一欄（車種組成 Excel 的「時段」）會被貼進正式報告。
 *
 * ⚠️ 這一支是原始碼比對：那段程式在 React 元件的匯出組裝裡，
 *   行為測試到不了。守兩件事——
 *     ①不可以再出現「用 minutes ÷ intervals 算格長」那個式子
 *     ②畫面與匯出都必須改走共用的 surveyIntervalDescription()，
 *       而它必須以**逐格長度的種類數**判斷
 * ⚠️ 反證（2026-09-26 實測）：把那一格改回原本的除法寫法就紅。
 */
test("所有調查時段說明都不得用 minutes ÷ intervals 冒充固定格長", () => {
  assert.doesNotMatch(
    source,
    /survey(?:\?\.)?\.minutes\s*\/[\s\S]{0,100}?survey(?:\?\.)?\.intervals/,
    "又用「總分鐘數 ÷ 格數」算格長了——混用格長時那個數字是平均值，一格都不存在",
  );
  assert.match(
    source,
    /時段:\s*\n?\s*scope === "SURVEY"\s*\n?\s*\? surveyIntervalDescription\(record\)/,
    "Excel 的「時段」欄沒有走共用的 surveyIntervalDescription()",
  );
  assert.match(
    source,
    /調查時段合計：["']\s*\+[\s\S]{0,100}?surveyIntervalDescription\(selected\)/,
    "畫面上的調查時段合計仍有第二套寫法",
  );
  /* 共用 helper 必須以逐格長度的種類數判斷，不是拿整除去猜。 */
  const start = trafficSource.indexOf("export function surveyIntervalDescription(");
  const body = trafficSource.slice(start, start + 1800);
  assert.ok(start >= 0 && body.length > 500, "抓不到 surveyIntervalDescription 的本體");
  assert.match(
    body,
    /new Set\([\s\S]*?cellMinutesOf\(/,
    "surveyIntervalDescription 沒有用逐格長度的種類數判斷混用",
  );
  assert.match(
    body,
    /格長混用/,
    "混用時沒有在文字裡講出「格長混用」——使用者無從得知那一欄為什麼不報格長",
  );
});
