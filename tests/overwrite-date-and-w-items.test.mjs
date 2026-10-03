/*
 * ══════════════════════════════════════════════════════════════════════
 *  W 區守門（路口轉向）：W-0 覆蓋日期把關／#5 差值說明／#54 container query
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-29 的三件事：
 *
 *  ①「那串數字記的是第幾季……對使用者來說是流水編號，主要還是看資料裡面的
 *     日期，才能做為判定這是哪一季……檔案編號哪怕一樣，使用者都不會在意。
 *     這一點情況，三支程式都可能發生。」
 *
 *  ②「我比較擔心程式會因為檔案編號一樣……後者資料卻覆蓋掉了前者，但明明
 *     檔案裡面顯示的是不同監測日期。」
 *
 *  ③「路口轉向 #5，目前程式不是已經有差值是什麼意思的文字了嗎? 如果沒有，
 *     就請你做」／「#54，我記得你確認過，這個問題已經完成修正了，你可以
 *     確認一下，如果還沒修正，你就做你說的後者。」
 *
 * 動手前的確認結果：#5 只有一句（缺三個要點）、#54 只做了一半
 * （.peak-shape 改了 container query、.trend-layout 還是 viewport media query）。
 *
 * ⚠️ 範例編號一律用 A00T00-01，不用真實站號。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { overwriteDateConflictPrompt } from "../lib/period-date.ts";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "..", "app", "traffic-app.tsx"), "utf8");
const cssSource = readFileSync(join(here, "..", "app", "globals.css"), "utf8");

/* ══════════════════════════════════════════════════════════════════════
 *  A. 覆蓋前的日期把關
 * ══════════════════════════════════════════════════════════════════════ */

test("A-1 舊新日期不同才算衝突", () => {
  const message = overwriteDateConflictPrompt([
    { label: "115Q1・甲路口・平日", oldDate: "2026-01-14", newDate: "2026-10-21" },
  ]);
  assert.match(message, /會蓋掉 1 筆/);
  assert.match(message, /原本是 2026-01-14，這一批是 2026-10-21/);
});

test("A-2 日期相同不算衝突——那是同一次調查的重匯，本來就該覆蓋", () => {
  assert.equal(
    overwriteDateConflictPrompt([
      { label: "甲", oldDate: "2026-01-14", newDate: "2026-01-14" },
    ]),
    "",
  );
});

test("A-3 只有一邊讀得出日期不算衝突——沒有證據就擋是假的紅", () => {
  assert.equal(
    overwriteDateConflictPrompt([{ label: "甲", oldDate: "", newDate: "2026-10-21" }]),
    "",
  );
  assert.equal(
    overwriteDateConflictPrompt([{ label: "甲", oldDate: "2026-01-14", newDate: "" }]),
    "",
  );
});

test("A-4 訊息要說出「編號一樣不代表是同一份資料」", () => {
  const message = overwriteDateConflictPrompt([
    { label: "甲", oldDate: "2026-01-14", newDate: "2026-10-21" },
  ]);
  assert.match(message, /檔案編號一樣不代表是同一份資料/);
  assert.match(message, /判斷依據一律是檔案裡的調查日期/);
  assert.match(message, /兩次不同的調查/);
});

test("A-5 把關要擋在真的動 records 之前", () => {
  /*
   * ⚠️ 不可以用 indexOf 的第一個——那是檔頭的 import。
   *   先錨在只出現一次的那一行，再往後找最近的一個。
   */
  const anchor = appSource.indexOf("const rawConflicts = overwritePlan.map(");
  assert.ok(anchor > 0, "前置：找不到覆蓋把關那一段的錨點");
  assert.equal(
    appSource.split("const rawConflicts = overwritePlan.map(").length - 1,
    1,
    "錨點不只一處，這一條會量到別的地方",
  );
  const writeAt = appSource.indexOf("const next = [...records];", anchor);
  assert.ok(writeAt > anchor, "前置：錨點之後找不到 `const next = [...records]`");
  const callAt = appSource.indexOf("overwriteDateConflictPrompt(", anchor);
  assert.ok(callAt > anchor && callAt < writeAt, "覆蓋把關被排到動 records 之後了");
});

test("A-6 舊日期要走 effectiveRecordDate（畫面上顯示的那一個）", () => {
  const anchor = appSource.indexOf("const rawConflicts = overwritePlan.map(");
  const block = appSource.slice(anchor, anchor + 900);
  assert.match(
    block,
    /effectiveRecordDate\(record\)/,
    "舊日期沒有走 effectiveRecordDate——使用者指定過日期的那幾筆，訊息會和畫面上不一樣",
  );
});

test("A-7 復原說明要是這一支自己的（還原點）", () => {
  const anchor = appSource.indexOf("const rawConflicts = overwritePlan.map(");
  const callAt = appSource.indexOf("overwriteDateConflictPrompt(", anchor);
  const block = appSource.slice(callAt, callAt + 400);
  assert.match(block, /還原點/);
  assert.doesNotMatch(
    block,
    /匯入紀錄/,
    "抄到交通服務水準的復原說明了——這一支沒有那個功能，寫了就是說謊",
  );
});

test("A-8 期別不從檔名編號推", () => {
  /*
   * 檔名編號在這一支只有兩個用途：剝掉路名前綴、切出站號。
   * 一旦有人寫出「從檔名數字算季別」，這一條要紅。
   */
  const bad = appSource.split("\n").filter((line) => {
    const assignsQuarter = /\bquarter\s*[:=]\s*[^=]/.test(line);
    const usesFileName = /\b(fileName|file\.name|item\.file|rawName)\b/.test(line);
    return assignsQuarter && usesFileName && !line.trim().startsWith("*");
  });
  assert.deepEqual(
    bad.map((line) => line.trim()),
    [],
    "有地方拿檔名去決定季別——依使用者裁示，編號是流水號，季別一律看檔案裡的調查日期",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  B. #5 差值說明要有四個要點
 * ══════════════════════════════════════════════════════════════════════ */

test("B-1 差值說明四個要點都在", () => {
  const anchor = appSource.indexOf('data-testid="balance-difference-note"');
  assert.ok(anchor > 0, "前置：找不到差值說明區塊");
  const block = appSource.slice(anchor, anchor + 2200);
  assert.match(block, /差值 ＝ 駛入 扣掉/, "① 少了「差值是怎麼算的」");
  assert.match(block, /正值代表/, "① 少了「正負值各代表哪個方向」");
  assert.match(block, /潮汐/, "② 少了「進出不平衡是正常現象（潮汐）」");
  assert.match(block, /差值大不等於/, "③ 少了「差值大 ≠ 那一支線車最多」");
  assert.match(block, /公路容量手冊/, "④ 少了「要指回手冊」");
  assert.match(block, /OD 總量/, "少了「要守恆的是整個路口的 OD 總量」");
});

test("B-2 差值說明不可以把「本系統的做法」寫成「手冊規定」", () => {
  const anchor = appSource.indexOf('data-testid="balance-difference-note"');
  const block = appSource.slice(anchor, anchor + 2200);
  assert.match(
    block,
    /不代替手冊做判定/,
    "指回手冊的同時要說清楚界線：系統只算數字，判定依手冊",
  );
});

test("B-3 畫面文字不可以用 Markdown 的 ** 粗體", () => {
  /*
   * 這一串會直接進 DOM，星號會原樣印出來（tests/plaintext-markup.test.mjs
   * 守的是同一條規則，這裡對新加的這一段再守一次）。
   */
  const anchor = appSource.indexOf('data-testid="balance-difference-note"');
  /*
   * ⚠️ 要先把 JSX 註解 {/* … *\/} 剝掉再掃。
   *   不剝的話，寫在旁邊解釋「不可以用 ** 粗體」的那段註解本身會被抓到——
   *   那是假的紅，而且會讓人以為畫面上真的有星號。
   */
  const block = appSource
    .slice(anchor, anchor + 2600)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(block, /\*\*/, "差值說明裡出現了 ** 粗體標記");
});

/* ══════════════════════════════════════════════════════════════════════
 *  C. #54 歷季趨勢改用 container query
 * ══════════════════════════════════════════════════════════════════════ */

test("C-1 .trend-layout 的欄數不可以再由 viewport media query 決定", () => {
  /*
   * ⚠️ 這一條就是 #54 的驗收線。同一頁的 .peak-shape 已經是 container query，
   *   .trend-layout 留在 viewport media query 的話，側欄收合時兩塊的欄數
   *   會在同一個寬度下對不起來——而且畫面上要收合側欄才看得出來。
   */
  const mediaBlocks = [...cssSource.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)].map(
    (hit) => hit[0],
  );
  const offenders = mediaBlocks.filter(
    (block) =>
      /\.trend-layout\s*[,{]/.test(block) && /grid-template-(columns|areas)/.test(block),
  );
  assert.deepEqual(
    offenders.map((block) => block.split("\n")[0]),
    [],
    ".trend-layout 的欄數還被 viewport media query 決定著",
  );
});

test("C-2 container 要下在外層，不可以下在 .trend-layout 自己身上", () => {
  /*
   * 元素查詢不到自己的寬度。.peak-shape 那一次已經踩過，
   * 這裡把同一個錯誤鎖住。
   */
  assert.match(
    cssSource,
    /\.trend-layout-container\s*\{[^}]*container-type:\s*inline-size/,
    "找不到 .trend-layout-container 的 container-type",
  );
  assert.doesNotMatch(
    cssSource,
    /\.trend-layout\s*\{[^}]*container-type/,
    "container-type 被下在 .trend-layout 自己身上了——它查詢不到自己的寬度",
  );
});

test("C-3 外層要真的包在 .trend-layout 外面，而且不可以包在裡面", () => {
  /*
   * ⚠️ 包在 .trend-layout **裡面**會一次打斷四支端對端腳本
   *   （e2e-chart-layout／e2e-sticky-offset／e2e-trend-order／e2e-trend-split
   *   都在用 `.trend-layout > .trend-chart` 這個直接子選擇器）。
   */
  const containerAt = appSource.indexOf('className="trend-layout-container"');
  const layoutAt = appSource.indexOf('className="trend-layout"');
  assert.ok(containerAt > 0, "前置：JSX 裡找不到 .trend-layout-container");
  assert.ok(layoutAt > 0, "前置：JSX 裡找不到 .trend-layout");
  assert.ok(
    containerAt < layoutAt,
    ".trend-layout-container 沒有包在 .trend-layout 外面",
  );
});

test("C-4 門檻要換算過，不可以照抄視窗的 1100／1400", () => {
  /*
   * 容器寬 = min(視窗 − 248（側欄）, 1540) − 68（.content 左右內距）。
   *   視窗 1100 → 容器 784；視窗 1400 → 容器 1084。
   *
   * ⚠️ 照抄 1100／1400 的話門檻會晚 316px 才觸發——那是「改了但沒真的改」，
   *   而且畫面在那 316px 的區間裡是壞的。這種錯誤不會有任何症狀，
   *   所以一定要用測試釘住。
   */
  const containerQueries = [...cssSource.matchAll(/@container\s*\(([^)]*)\)/g)].map(
    (hit) => hit[1].trim(),
  );
  assert.ok(
    containerQueries.includes("max-width:1083px") ||
      containerQueries.includes("max-width: 1083px"),
    `找不到容器 1083px 的單欄門檻，現有的是：${containerQueries.join(" / ")}`,
  );
  assert.ok(
    containerQueries.includes("min-width:1084px") ||
      containerQueries.includes("min-width: 1084px"),
    `找不到容器 1084px 的並排門檻，現有的是：${containerQueries.join(" / ")}`,
  );
  for (const query of containerQueries)
    assert.doesNotMatch(
      query,
      /\b(1100|1399|1400)px\b/,
      `門檻照抄了視窗的值（${query}）——容器寬比視窗少了側欄與內距`,
    );
});

/* ══════════════════════════════════════════════════════════════════════
 *  D. 手冊與畫面不可以互相矛盾（差值那一段）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-29：手冊寫「差值愈接近 0 代表資料愈完整；某一條明顯偏離，
 * **通常是**那條支線有未調查的出入口，或轉向歸類有誤」，
 * 而畫面依使用者 #5 的定案寫「單一支線進出不平衡是**正常現象**（潮汐），
 * 不是資料錯誤」。**兩句不可能同時是對的。**
 *
 * ⚠️ 這個矛盾是 v2.1.87 把畫面補齊之後才變尖銳的——手冊那一句從
 *   「講得不夠」變成「直接牴觸」。使用者拿手冊去對畫面會以為程式改錯了。
 *
 * ⚠️ 手冊是 PDF、畫面是 JSX，兩邊**沒有共用字串**，所以只能用
 *   手冊的**原始 HTML** 去驗。這一條擋不住「有人只改 PDF 不改原始檔」，
 *   但原始檔才是產生 PDF 的唯一來源（見 manual.html 的版本戳記規則），
 *   所以實際上夠用。
 */
const manualSource = readFileSync(
  join(here, "..", "scripts", "manual", "manual.html"),
  "utf8",
);

test("D-1 手冊不可以再寫「差值愈接近 0 代表資料愈完整」", () => {
  assert.doesNotMatch(
    manualSource,
    /差值愈接近\s*0\s*代表資料愈完整/,
    "手冊又寫回「差值愈接近 0 代表資料愈完整」——那和畫面上「潮汐是正常現象」直接牴觸",
  );
});

test("D-2 手冊的差值說明要和畫面的四要點一致", () => {
  const at = manualSource.indexOf("各支線流量平衡");
  assert.ok(at > 0, "前置：手冊裡找不到「各支線流量平衡」那一段");
  const block = manualSource.slice(at, at + 1200);
  assert.match(block, /正值代表/, "手冊少了「正負值各代表哪個方向」");
  assert.match(block, /潮汐/, "手冊少了「進出不平衡是潮汐造成的正常現象」");
  assert.match(block, /差值大不等於/, "手冊少了「差值大 ≠ 那一支線車最多」");
  assert.match(block, /公路容量手冊/, "手冊少了「判定依公路容量手冊」");
  assert.match(
    block,
    /不代替手冊做判定/,
    "手冊少了界線：本系統只算數字，不代替手冊判定",
  );
});

test("D-3 ★反面：「未調查的出入口／轉向歸類有誤」要保留成**其中一種**可能，不是唯一原因", () => {
  /*
   * ⚠️ 矯枉過正的方向：把那一句整段刪掉。那也是錯的——
   *   它確實是差值特別大時的一種可能原因，只是不該寫成唯一原因。
   *   改壞成「一律是正常現象」的話，使用者就再也不會去查真的漏掉的出入口。
   */
  const at = manualSource.indexOf("各支線流量平衡");
  const block = manualSource.slice(at, at + 1200);
  assert.match(block, /未調查的出入口/, "把「未調查的出入口」整段刪掉了——那是矯枉過正");
  assert.match(
    block,
    /其中一種/,
    "沒有把它標成「其中一種」可能原因，又會變回「偏離＝資料有問題」",
  );
});
