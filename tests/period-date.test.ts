import test from "node:test";
import assert from "node:assert/strict";
import {
  checkPeriodAgainstDate,
  findSurveyDate,
  formatPeriod,
  isLabelledSurveyDateText,
  parseSurveyDateText,
  parseSurveyPeriod,
  periodDisplayLabel,
  periodMismatchPrompt,
  periodUnknownNotice,
} from "../lib/period-date.ts";

/*
 * ── 調查日期 × 期別 一致性檢查 ──────────────────────────────────
 *
 * 下面三張表在「路口轉向」「全日交通量」「交通服務水準」三支程式的測試檔裡
 * **逐字相同**。三支的判斷不可以各自漂移——同一份調查檔、同一個期別，
 * 三支必須說同一句話。改任何一支就要同步改另外兩支。
 *
 * 另外釘住兩條不可以退讓的行為：
 *   1. 讀不到日期時 status 必須是 "unknown"，**絕不能變成 mismatch**
 *      （會擋住使用者匯入格式較特別的檔案）。
 *   2. 「製表日期」這類非調查日期不可以被當成調查日期拿去比對期別。
 */

const PERIOD_CASES = [
  { period: "115Q1", expect: "115Q1" },
  { period: "115q1", expect: "115Q1" },
  { period: "115 Q1", expect: "115Q1" },
  { period: "２０２６Ｑ１", expect: "115Q1" },
  { period: "2026Q1", expect: "115Q1" },
  { period: "114Q4", expect: "114Q4" },
  { period: "115Q5", expect: null },
  { period: "11501", expect: "115年01月" },
  { period: "11512", expect: "115年12月" },
  { period: "11513", expect: null },
  { period: "115-01", expect: "115年01月" },
  { period: "115/1", expect: "115年01月" },
  { period: "115.01", expect: "115年01月" },
  { period: "115年1月", expect: "115年01月" },
  { period: "115年01月", expect: "115年01月" },
  { period: "115M1", expect: "115年01月" },
  { period: "202601", expect: "115年01月" },
  { period: "", expect: null },
  { period: "abc", expect: null },
  { period: "5Q1", expect: null },
];

const DATE_TEXT_CASES = [
  { text: "日期：115.01.26 (平日)", iso: "2026-01-26", labelled: true, picked: true },
  { text: "監測日期：115年01月25日(假日)", iso: "2026-01-25", labelled: true, picked: true },
  { text: "日    期：115年01月26日(平日)", iso: "2026-01-26", labelled: true, picked: true },
  { text: "日　　期：115年01月26日(平日)", iso: "2026-01-26", labelled: true, picked: true },
  { text: "調查日期:115/01/26", iso: "2026-01-26", labelled: true, picked: true },
  { text: "115年01月26日(平日)", iso: "2026-01-26", labelled: false, picked: true },
  { text: "2026-01-26", iso: "2026-01-26", labelled: false, picked: true },
  { text: "製表日期：115年03月01日", iso: "2026-03-01", labelled: false, picked: false },
  { text: "路口名稱：中山路與民權路", iso: "", labelled: false, picked: false },
  { text: "", iso: "", labelled: false, picked: false },
  { text: "115年13月26日", iso: "", labelled: false, picked: false },
  { text: "115年01月32日", iso: "", labelled: false, picked: false },
  { text: "日期：115年02月29日", iso: "", labelled: true, picked: false },
  { text: "日期：113年02月29日", iso: "2024-02-29", labelled: true, picked: true },
  { text: "日期：115年04月31日", iso: "", labelled: true, picked: false },
];

const CHECK_CASES = [
  { period: "115Q1", iso: "2026-01-26", status: "match" },
  { period: "115Q1", iso: "2026-03-31", status: "match" },
  { period: "115Q2", iso: "2026-01-26", status: "mismatch" },
  { period: "115Q1", iso: "2025-01-26", status: "mismatch" },
  { period: "2026Q1", iso: "2026-01-26", status: "match" },
  { period: "11501", iso: "2026-01-26", status: "match" },
  { period: "11502", iso: "2026-01-26", status: "mismatch" },
  { period: "115年1月", iso: "2026-01-26", status: "match" },
  { period: "115Q1", iso: "", status: "unknown" },
  { period: "", iso: "2026-01-26", status: "unknown" },
  { period: "亂打", iso: "2026-01-26", status: "unknown" },
];

test("期別字串解析（含月期別 11501）", function () {
  for (const item of PERIOD_CASES)
    assert.equal(
      formatPeriod(parseSurveyPeriod(item.period)) || null,
      item.expect,
      "期別「" + item.period + "」",
    );
});

test("表頭日期判讀與「日期：」標示", function () {
  for (const item of DATE_TEXT_CASES) {
    assert.equal(parseSurveyDateText(item.text), item.iso, "日期「" + item.text + "」");
    assert.equal(
      isLabelledSurveyDateText(item.text),
      item.labelled,
      "標示「" + item.text + "」",
    );
    const one = findSurveyDate([{ text: item.text, sheet: "S", cell: "A1" }]);
    assert.equal(Boolean(one), item.picked, "採用「" + item.text + "」");
  }
});

test("期別 × 日期 判定", function () {
  for (const item of CHECK_CASES) {
    const found = item.iso
      ? { iso: item.iso, raw: "raw", sheet: "S", cell: "A1", labelled: true }
      : null;
    assert.equal(
      checkPeriodAgainstDate(item.period, found, "f.xls").status,
      item.status,
      item.period + " × " + (item.iso || "（無日期）"),
    );
  }
});

test("有標示的儲存格優先於位置較前、沒有標示的那一格", function () {
  const found = findSurveyDate([
    { text: "115年01月20日", sheet: "假日", cell: "A1" },
    { text: "監測日期：115年01月25日(假日)", sheet: "假日", cell: "F3" },
  ]);
  assert.equal(found?.iso, "2026-01-25");
  assert.equal(found?.cell, "F3");
  assert.equal(found?.labelled, true);
});

test("完全沒有標示時退而採用第一個像日期的，並標記為推測", function () {
  const found = findSurveyDate([{ text: "115年01月20日", sheet: "S", cell: "A1" }]);
  assert.equal(found?.iso, "2026-01-20");
  assert.equal(found?.labelled, false);
  const check = checkPeriodAgainstDate("115Q1", found, "f.xls");
  assert.equal(check.status, "match");
  assert.match(check.detail, /推測/);
});

test("讀不到日期時不阻擋——status 是 unknown，訊息用使用者指定的字句", function () {
  const check = checkPeriodAgainstDate("115Q1", null, "怪格式.xls");
  assert.equal(check.status, "unknown");
  assert.match(
    check.detail,
    /本次資料無法辨別日期，所以無法幫忙確認是否符合期別，請自行確認正確性/,
  );
  assert.equal(periodMismatchPrompt([check]), "", "unknown 不可以跳二次確認框");
  assert.match(periodUnknownNotice([check]), /怪格式\.xls/);
});

test("不一致時的二次確認文字要說得出來源儲存格與兩邊的期別", function () {
  const check = checkPeriodAgainstDate(
    "115Q2",
    {
      iso: "2026-01-25",
      raw: "監測日期：115年01月25日(假日)",
      sheet: "假日",
      cell: "F3",
      labelled: true,
    },
    "T1406.xls",
  );
  assert.equal(check.status, "mismatch");
  assert.equal(check.source, "假日!F3");
  assert.equal(check.dateLabel, "115Q1");
  assert.equal(check.periodLabel, "115Q2");
  const prompt = periodMismatchPrompt([check]);
  assert.match(prompt, /T1406\.xls/);
  assert.match(prompt, /假日!F3/);
  assert.match(prompt, /115Q1/);
  assert.match(prompt, /115Q2/);
  assert.match(prompt, /按「確定」/);
});

test("全部相符時不跳確認框，也沒有提醒", function () {
  const ok = checkPeriodAgainstDate(
    "115Q1",
    { iso: "2026-01-26", raw: "日期：115.01.26 (平日)", sheet: "路口(A)", cell: "H2", labelled: true },
    "T1401.xls",
  );
  assert.equal(ok.status, "match");
  assert.equal(periodMismatchPrompt([ok]), "");
  assert.equal(periodUnknownNotice([ok]), "");
});

/*
 * ── 期別顯示：季別 ⇄ 實際調查月份 ─────────────────────────────
 * 這一張表同樣在三支程式裡逐字相同。
 * 切換只換顯示文字：分組、排序、鍵值、計算與匯出的數值一律仍以季別為準。
 */
const DISPLAY_CASES = [
  { quarter: "115Q1", dates: ["2026-02-10"], expect: "115年2月" },
  { quarter: "115Q1", dates: ["2026-02-10", "2026-02-11"], expect: "115年2月" },
  { quarter: "115Q1", dates: ["2026-03-05", "2026-02-10"], expect: "115年2、3月" },
  { quarter: "115Q1", dates: ["2026-01-26", "2026-02-10", "2026-03-05"], expect: "115年1、2、3月" },
  { quarter: "115Q1", dates: [], expect: "115Q1" },
  { quarter: "115Q1", dates: ["", "壞掉的日期"], expect: "115Q1" },
  { quarter: "114Q4", dates: ["2025-11-03"], expect: "114年11月" },
  { quarter: "115Q1", dates: ["2025-12-30", "2026-01-05"], expect: "114年12月、115年1月" },
];

test("期別顯示切換：季別維持原樣，月份模式列出實際調查月份", function () {
  for (const item of DISPLAY_CASES) {
    assert.equal(
      periodDisplayLabel(item.quarter, item.dates, "quarter"),
      item.quarter,
      "季別模式必須原樣回傳：" + item.quarter,
    );
    assert.equal(
      periodDisplayLabel(item.quarter, item.dates, "month"),
      item.expect,
      item.quarter + " × " + JSON.stringify(item.dates),
    );
  }
});

test("沒有日期可用時月份模式退回季別，不會編出月份也不會留空白", function () {
  assert.equal(periodDisplayLabel("115Q2", [], "month"), "115Q2");
  assert.equal(periodDisplayLabel("115Q2", ["x"], "month"), "115Q2");
});
