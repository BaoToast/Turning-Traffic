import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureRecordScopes,
  hasDayPeak,
  hasScopeValue,
  recordTotal,
  scopeValueOrNull,
  type TrafficRecord,
} from "../lib/traffic.ts";

/*
 * ── 歷季趨勢圖不可以把「算不出全日尖峰」畫成 0（v2.1.32）──
 *
 * 起因：不足 24 小時的調查、以及還沒重新匯入的舊備份，底層的 DAY 欄位是
 * **空值 0**（ensureRecordScopes 補的）。趨勢圖直接拿 recordTotal 畫，
 * 折線就掉到零、右側摘要寫「全日尖峰 0 PCU/hr」——看起來像那一季流量歸零，
 * 事實是這份調查根本算不出全日尖峰。0 會被抄進報告，「－」不會。
 *
 * v2.1.30 已經會畫那條線（沒有圖例、不易察覺），v2.1.31 幫它加了顏色、
 * 圖例、點標籤與摘要數字，把這個 0 變得很顯眼。v2.1.32 補上判斷。
 *
 * 全系統只能有一支判斷：hasScopeValue（內部走 hasDayPeak）。
 */

/** 只做上下午各 2 小時的調查——算不出全日尖峰。 */
function shortSurvey(id = "s1"): TrafficRecord {
  return ensureRecordScopes({
    id, station: "T99-01", name: "測試路口", rawName: "x.xls",
    quarter: "115Q1", date: "2026-01-01", surveyType: "平日",
    peaks: { AM: { start: "07:15", end: "08:15" }, PM: { start: "17:00", end: "18:00" } },
    approaches: [{
      id: "a1", name: "北向", rawName: "北向",
      movements: {
        AM: { left: 100, through: 200, right: 50, total: 350, vehicle: {} },
        PM: { left: 120, through: 220, right: 60, total: 400, vehicle: {} },
      },
    }],
    sourceFiles: ["x.xls"], importedAt: "2026-01-01T00:00:00Z",
    validation: { referenceFound: false, matchRate: null, notes: [] },
  } as unknown as TrafficRecord);
}

/** 24 小時的調查，有全日尖峰。 */
function fullSurvey(id = "f1"): TrafficRecord {
  const r = shortSurvey(id);
  r.peaks.DAY = { start: "08:00", end: "09:00" };
  r.survey = { minutes: 24 * 60, intervals: [] } as never;
  r.approaches[0].movements.DAY = {
    left: 10, through: 20, right: 5, total: 35, vehicle: {},
  } as never;
  return r;
}

test("前提：底層資料真的是 0，不是 null——所以畫面一定要自己判斷", () => {
  const r = shortSurvey();
  assert.equal(hasDayPeak(r), false, "這筆本來就算不出全日尖峰");
  assert.equal(recordTotal(r, "DAY"), 0, "底層是 0；直接拿去畫就會變成一條掉到零的線");
  assert.equal(recordTotal(r, "AM"), 350, "上午尖峰照樣有值，不可以被一起擋掉");
});

test("算不出全日尖峰時，hasScopeValue('DAY') 要是 false", () => {
  assert.equal(hasScopeValue(shortSurvey(), "DAY"), false);
});

test("AM／PM 永遠有值，不可以被誤擋", () => {
  const r = shortSurvey();
  assert.equal(hasScopeValue(r, "AM"), true);
  assert.equal(hasScopeValue(r, "PM"), true);
});

test("24 小時的調查，全日尖峰要顯示得出來", () => {
  const r = fullSurvey();
  assert.equal(hasDayPeak(r), true);
  assert.equal(hasScopeValue(r, "DAY"), true);
});

test("hasScopeValue 與 hasDayPeak 對 DAY 永遠講同一句話（不可以有第二套判斷）", () => {
  for (const r of [shortSurvey(), fullSurvey()]) {
    assert.equal(hasScopeValue(r, "DAY"), hasDayPeak(r));
  }
});

test("趨勢圖的資料點：算不出來的季度要被排除，不是給 0", () => {
  const rows = [shortSurvey("q1"), fullSurvey("q2"), shortSurvey("q3")];
  /* 這是趨勢圖 series 的算法：只保留 hasScopeValue 為真的點。 */
  const dayPoints = rows.filter((r) => hasScopeValue(r, "DAY"));
  assert.equal(dayPoints.length, 1, "三季裡只有一季算得出全日尖峰");
  assert.equal(dayPoints[0].id, "q2");
  /* 折線要斷開：q1 與 q3 之間不可以連成一條經過 q2 的線以外的東西 */
  const segments: string[][] = [];
  let cur: string[] = [];
  rows.forEach((r) => {
    if (hasScopeValue(r, "DAY")) cur.push(r.id);
    else if (cur.length) { segments.push(cur); cur = []; }
  });
  if (cur.length) segments.push(cur);
  assert.deepEqual(segments, [["q2"]], "只有一段，而且只含 q2");
});

test("AM 的折線不受影響，三季都連得起來", () => {
  const rows = [shortSurvey("q1"), fullSurvey("q2"), shortSurvey("q3")];
  const amPoints = rows.filter((r) => hasScopeValue(r, "AM"));
  assert.equal(amPoints.length, 3);
});

test("Excel 匯出：算不出的 DAY 必須是空白 null，不可以是假 0", () => {
  const r = shortSurvey();
  assert.equal(scopeValueOrNull(r, "DAY", recordTotal(r, "DAY")), null);
});

test("Excel 匯出：算得出的真正 0 必須保留，不能誤當成空白", () => {
  const r = fullSurvey();
  r.approaches[0].movements.DAY = {
    left: 0, through: 0, right: 0, total: 0, vehicle: {},
  } as never;
  assert.equal(scopeValueOrNull(r, "DAY", recordTotal(r, "DAY")), 0);
});

test("Excel 匯出：AM／PM 即使是 0 也仍是有效數值", () => {
  const r = shortSurvey();
  assert.equal(scopeValueOrNull(r, "AM", 0), 0);
  assert.equal(scopeValueOrNull(r, "PM", 0), 0);
});
