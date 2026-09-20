/*
 * ══════════════════════════════════════════════════════════════════════
 *  同一份檔案讀到兩個調查日期：要進異常檢查、要能指定哪一個才對
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-20：
 *   「同一張表若你判讀到 2 個日期，在資料匯入時就應該做為異常顯示提醒
 *     使用者，在異常資料檢查結果也要檢查出來，我在想的是你要如何讓使用者
 *     告訴你哪個才是正確的日期（因為有可能另一個不同的日期在該資料中有其
 *     意義存在，所以使用者不會修正資料）」
 *
 * ⚠️ 最後那一句是重心：**不可以叫使用者去改原始檔**，所以解法是「覆寫」
 *   而不是「改資料」，而且覆寫要跟著存檔走、跟著顯示走、跟著匯出的圖走。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const traffic = await readFile(new URL("../lib/traffic.ts", import.meta.url), "utf8");
const app = await readFile(new URL("../app/traffic-app.tsx", import.meta.url), "utf8");

test("前置：兩個檔案都讀得到而且有內容", () => {
  assert.ok(traffic.length > 50000, "lib/traffic.ts 讀起來太短");
  assert.ok(app.length > 50000, "app/traffic-app.tsx 讀起來太短");
});

/* ── 全文搜索找日期 ──────────────────────────────────────────── */
test("候選日期一律全表掃描，不是只看標題區前 13 列", () => {
  assert.match(
    traffic,
    /function workbookCells\(workbook: XLSX\.WorkBook, deep = false\)/,
    "workbookCells 沒有可切換深度的參數",
  );
  assert.match(
    traffic,
    /const lastRow = deep \? range\.e\.r : Math\.min\(range\.e\.r, 12\)/,
    "deep 參數沒有真的改變掃描範圍",
  );
  assert.match(
    traffic,
    /const deepCells = workbookCells\(workbook, true\)/,
    "候選清單沒有走全表掃描",
  );
});

test("⚠️ 系統實際採用的那一個仍以標題區優先（正常檔案的行為不可以變）", () => {
  /*
   * foundDate 那一行是舊的、沒有被動到的：先在交通量工作表的標題區挑，
   * 找不到才退回整份活頁簿。新增的全表掃描只餵給候選清單。
   */
  assert.match(
    traffic,
    /const foundDate = findSurveyDate\(scopedDateCells\) \|\| findSurveyDate\(cells\);/,
    "系統採用的那一個被改成全表挑，正常檔案的行為就變了",
  );
});

test("⚠️ 候選只看交通量工作表，監測照片／時相圖上的日期不算", () => {
  assert.match(
    traffic,
    /const scopedDeepCells = deepCells\.filter\(function \(item\) \{\s*\n?\s*return !options\?\.trafficSheets \|\| options\.trafficSheets\.includes\(item\.sheet\);/,
    "全表掃描沒有先限縮到交通量工作表",
  );
  assert.match(
    traffic,
    /scopedDeepCells\.length \? scopedDeepCells : deepCells/,
    "交通量工作表一個日期都沒有時沒有退回整份活頁簿",
  );
});

test("⚠️ 候選清單的第一個必須就是系統實際採用的那一個", () => {
  assert.match(
    traffic,
    /foundDate && otherDateIsos\.length \? \[foundDate\.iso, \.\.\.otherDateIsos\] : \[\]/,
    "候選清單的第一個不是系統採用的那一個",
  );
});

/* ── 候選要存下來 ────────────────────────────────────────────── */
test("候選要跟著紀錄一起存下來（原始檔匯完就不在手上了）", () => {
  assert.ok(
    /surveyDateCandidates\?: string\[\];/.test(traffic),
    "TrafficRecord／ImportPreview 沒有這一欄",
  );
  assert.match(
    app,
    /surveyDateCandidates:\s*\n?\s*item\.surveyDateCandidates && item\.surveyDateCandidates\.length > 1/,
    "匯入時沒有把候選存進紀錄，事後執行異常檢查就掃不到",
  );
});

/* ── 異常檢查 ────────────────────────────────────────────────── */
test("異常檢查會列出「調查日期不只一個」，而且是人工確認", () => {
  assert.ok(
    traffic.includes('category: "調查日期不只一個"'),
    "異常檢查沒有這一類",
  );
  assert.ok(
    /\| "調查日期不只一個";/.test(traffic),
    "QualityIssue 的 category 聯集沒有登記這一類",
  );
  const at = traffic.indexOf('category: "調查日期不只一個"');
  const block = traffic.slice(at, at + 2400);
  assert.ok(block.includes('kind: "人工確認"'), "不是人工確認類，使用者沒有出路");
  assert.ok(
    block.includes("系統不會自己挑"),
    "解決方式沒有講明系統不自行挑選——那是本系統的基本原則",
  );
  assert.ok(
    block.includes("不影響任何流量或 PCU 計算"),
    "解決方式沒有講明這一項不影響計算",
  );
});

test("⚠️ 訊息裡不可以寫「目前採用的是 X」（指紋是 [id, message]）", () => {
  /*
   * 使用者一指定，「目前採用的」就變了，而確認的指紋含 message——
   * 那會讓他剛按下去的確認當場失效。會變的字全部留在畫面層。
   */
  const at = traffic.indexOf('id: `${record.id}-date-multi`');
  assert.notEqual(at, -1, "找不到這一類異常");
  const block = traffic.slice(at, at + 1400);
  const message = block.slice(block.indexOf("message:"), block.indexOf("resolution:"));
  for (const forbidden of ["目前採用", "你指定的", "尚未指定"])
    assert.ok(
      !message.includes(forbidden),
      `message 裡有會變的字「${forbidden}」，使用者按過的確認會當場失效`,
    );
  /* 候選清單**要**在 message 裡：候選真的變了就該重新提醒。 */
  assert.ok(
    message.includes("record.surveyDateCandidates.join"),
    "message 裡沒有候選清單，候選變了也不會重新提醒",
  );
});

/* ── 指定＝覆寫＋確認 ────────────────────────────────────────── */
test("指定日期要同時寫覆寫與記為已確認，取消指定兩邊都要拿掉", () => {
  const at = app.indexOf("const chooseSurveyDate = (");
  assert.notEqual(at, -1, "找不到指定調查日期的處理函式");
  const block = app.slice(at, at + 900);
  assert.ok(block.includes("setSurveyDateOverrides("), "沒有寫覆寫");
  assert.ok(block.includes("toggleIssueAck("), "沒有記為已確認");
  assert.ok(
    block.includes("if (iso) own[scope] = iso;") &&
      block.includes("else delete own[scope];"),
    "取消指定時沒有把覆寫拿掉",
  );
});

test("⚠️ 覆寫值不在候選裡就不採用", () => {
  const at = app.indexOf("const effectiveRecordDate = useCallback(");
  assert.notEqual(at, -1, "找不到 effectiveRecordDate");
  const block = app.slice(at, at + 900);
  assert.ok(
    block.includes("!candidates.includes(picked)"),
    "採用了一個原始檔上根本沒有的日期——使用者無從發現",
  );
});

/* ── 顯示 ────────────────────────────────────────────────────── */
test("明細表、期別月份與匯出的圖都要走 effectiveRecordDate", () => {
  for (const [what, needle] of [
    ["明細表的調查日欄", "surveyDateInYearStyle(\n                                      effectiveRecordDate(record),"],
    ["期別顯示調查月份", "if (effectiveRecordDate(record))"],
    ["匯出的紀錄卡", "調查日期: effectiveRecordDate(item.record)"],
    ["轉向圖上的那一行", "const iso = effectiveRecordDate(base);"],
  ])
    assert.ok(app.includes(needle), `${what}沒有走 effectiveRecordDate`);
});

test("⚠️ 轉向圖上的日期要與畫面一致（交出去的那一份不可以是另一天）", () => {
  const at = app.indexOf("const diagramRecord = useMemo(");
  const block = app.slice(at, at + 900);
  assert.ok(
    block.includes("return iso === base.date ? base : { ...base, date: iso };"),
    "圖上的日期沒有換成使用者指定的那一個",
  );
});

test("讀不到日期時要寫出原因，不可以留白", () => {
  assert.ok(
    app.includes("原始檔讀不到日期"),
    "讀不到日期時留白，使用者分不出「程式沒做」與「原始檔真的沒寫」",
  );
});

test("有「顯示調查日期」開關，預設是開，而且關掉時欄位不可以消失", () => {
  assert.ok(
    app.includes("const [showSurveyDate, setShowSurveyDate] = useState(true);"),
    "沒有這顆開關，或預設不是開",
  );
  assert.ok(
    app.includes('data-testid="show-survey-date"'),
    "畫面上找不到這顆開關",
  );
  /*
   * ⚠️ 關掉時那一欄仍然在、只是寫「－」。整欄拿掉的話整張表的欄位會位移。
   */
  const at = app.indexOf("{showSurveyDate ? (");
  assert.notEqual(at, -1, "明細表沒有接上開關");
  assert.ok(
    app.slice(at, at + 700).includes('<small className="muted-cell">－</small>'),
    "關掉時把整欄拿掉了，整張表的欄位會位移",
  );
});

/* ── 存檔 ────────────────────────────────────────────────────── */
test("指定的調查日期與開關都要跟著存檔走", () => {
  assert.ok(
    app.includes("surveyDateOverrides: surveyDateOverrides,"),
    "存檔沒有收 surveyDateOverrides——重新整理之後日期會變成另一天",
  );
  assert.ok(
    app.includes("showSurveyDate: showSurveyDate,"),
    "存檔沒有收開關狀態",
  );
  assert.match(
    app,
    /if \(data\.surveyDateOverrides && typeof data\.surveyDateOverrides === "object"\)/,
    "讀檔時沒有還原 surveyDateOverrides",
  );
  /* 相依陣列少了的話，改完不會觸發存檔，關掉分頁就沒了。 */
  const at = app.indexOf("/* 已確認的異常也要跟著存檔，少了它重新整理就全部復活。 */");
  assert.notEqual(at, -1);
  const block = app.slice(at, at + 260);
  assert.ok(
    block.includes("surveyDateOverrides,") && block.includes("showSurveyDate,"),
    "存檔的相依陣列少了新欄位，改完不會觸發存檔",
  );
});
