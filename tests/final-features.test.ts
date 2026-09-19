import test from "node:test";
import assert from "node:assert/strict";
import { branchBalance, conservationCheck, diagramCollisionWarnings, minutesOfClock, odMatrix, peakQuarterHours, peakSensitivity, peakWindowSeries } from "../lib/final-features.ts";
import type { TrafficRecord } from "../lib/traffic.ts";
import {
  emptyMovement,
  emptyRouteVolume,
  emptyPeakWindows,
} from "../lib/traffic.ts";

function record(): TrafficRecord {
  const movement = { left: 0, through: 10, right: 0, vehicle: { car: 10 }, rawVehicleTotal: 10 };
  return {
    id: "r", station: "T-01", name: "測試路口", rawName: "source.xls", quarter: "115Q2", date: "2026-05-01", surveyType: "平日",
    /* 全日尖峰留空：這筆測試資料不是 24 小時的調查。 */
    peaks: { ...emptyPeakWindows(), AM: { start: "07:00", end: "08:00" }, PM: { start: "17:00", end: "18:00" } },
    approaches: [
      { id: "A", name: "路口A", bearing: "東", angle: 0, lanes: null, capacity: null, movements: { DAY: emptyMovement(), FULL: emptyMovement(), AM: movement, PM: movement } },
      { id: "B", name: "路口B", bearing: "西", angle: 180, lanes: null, capacity: null, movements: { DAY: emptyMovement(), FULL: emptyMovement(), AM: movement, PM: movement } },
    ],
    routes: [
      { id: "A-B", fromApproachId: "A", toApproachId: "B", movement: "through", volumes: { DAY: emptyRouteVolume(), FULL: emptyRouteVolume(), AM: { pcu: 10, vehicle: { car: 10 } }, PM: { pcu: 10, vehicle: { car: 10 } } } },
      { id: "B-A", fromApproachId: "B", toApproachId: "A", movement: "through", volumes: { DAY: emptyRouteVolume(), FULL: emptyRouteVolume(), AM: { pcu: 10, vehicle: { car: 10 } }, PM: { pcu: 10, vehicle: { car: 10 } } } },
    ],
    sourceTrace: { templateId: "t", templateName: "測試", dateSource: null, cells: [], intervals: [0, 15, 30, 45, 60].map(function (start, index) { return { start, end: start + 15, pcu: index + 1, vehicles: index + 1 }; }) },
    sourceFiles: ["source.xls"], importedAt: "2026-05-01T00:00:00Z", validation: { referenceFound: false, matchRate: null, notes: [] },
  };
}

test("final analysis conserves OD totals and builds matrix", function () {
  const sample = record();
  assert.deepEqual(conservationCheck(sample, "AM"), { movement: 20, routes: 20, difference: 0, valid: true });
  assert.deepEqual(odMatrix(sample, "AM").map(function (row) { return row.values; }), [[0, 10], [10, 0]]);
  assert.deepEqual(branchBalance(sample, "AM").map(function (row) { return row.difference; }), [0, 0]);
});

test("peak sensitivity ranks continuous 60-minute windows", function () {
  const rows = peakSensitivity(record());
  assert.equal(rows[0].start, 15);
  assert.equal(rows[0].pcu, 14);
  assert.equal(rows[0].end, 75);
});

test("peak sensitivity skips windows with a missing interval in the middle", function () {
  const sample = record();
  // 0~105 每 15 分鐘一格，但挖掉 30~45（該時段沒有調查）。
  sample.sourceTrace!.intervals = [0, 15, 30, 45, 60, 75, 90]
    .filter(function (start) { return start !== 30; })
    .map(function (start, index) {
      return { start, end: start + 15, pcu: index + 1, vehicles: index + 1 };
    });
  const rows = peakSensitivity(sample);
  // 0 與 15 起算的一小時中間都跨過那個缺口，只有 45 分鐘實際資料，不能列入。
  assert.equal(rows.some(function (row) { return row.start === 0; }), false);
  assert.equal(rows.some(function (row) { return row.start === 15; }), false);
  // 45 起算的 45~105 四格完整相接，仍應列入。
  assert.equal(rows.some(function (row) { return row.start === 45; }), true);
});

/* ══ 匯出前排版預警：吃的是真正畫出來的矩形 ═══════════════════════ */

/*
 * ⚠️ v2.1.63 以前這一支自己估位置（cos(角度)×390），
 *    支線超過 4 個時繪圖端早就改用外圍格位排版，兩邊對不上，
 *    於是「畫面沒重疊卻一直跳警示」，反過來也會漏報真的重疊。
 *    現在它只做一件事：**判定給進來的矩形有沒有相交**。
 *    「矩形是不是圖上真正的位置」由 diagramLayout 保證（同一段程式同時
 *    推出 <g transform> 與矩形），並由 e2e-preflight.mjs 在真實畫面上把關。
 */
const card = (name: string, x: number, y: number) => ({
  kind: "card" as const,
  name,
  x,
  y,
  w: 216,
  h: 116,
});

test("排版預警：分開的卡片不可以報", function () {
  assert.deepEqual(
    diagramCollisionWarnings([card("A · 駛入", 0, 0), card("B · 駛入", 300, 0)]),
    [],
  );
  /* 上下錯開也一樣：只有 x 重疊不算重疊。 */
  assert.deepEqual(
    diagramCollisionWarnings([card("A · 駛入", 0, 0), card("B · 駛入", 0, 200)]),
    [],
  );
});

test("排版預警：真的疊在一起就一定要報，而且要報對是哪兩張", function () {
  const warnings = diagramCollisionWarnings([
    card("路口A · 駛入", 0, 0),
    card("路口B · 駛出", 100, 40),
    card("路口C · 駛入", 900, 600),
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /路口A · 駛入/);
  assert.match(warnings[0], /路口B · 駛出/);
  /* 沒有牽連到的那一張不可以被拖下水。 */
  assert.doesNotMatch(warnings[0], /路口C/);
});

test("排版預警：剛好相接不算重疊（否則整排並排的卡片會全部報）", function () {
  assert.deepEqual(
    diagramCollisionWarnings([card("A · 駛入", 0, 0), card("B · 駛入", 216, 0)]),
    [],
  );
});

test("排版預警：擦到圖例一點點不報，真的蓋住才報", function () {
  const legend = {
    kind: "legend" as const,
    name: "右下角的流向圖例",
    x: 910,
    y: 856,
    w: 270,
    h: 26,
  };
  /* 只咬到 2px：圖上看不出來，報出來只會讓人去追不存在的問題。 */
  assert.deepEqual(
    diagramCollisionWarnings([card("A · 駛入", 908, 740), legend]),
    [],
  );
  const covered = diagramCollisionWarnings([card("A · 駛入", 950, 820), legend]);
  assert.equal(covered.length, 1);
  assert.match(covered[0], /圖例/);
});

test("排版預警：沒有矩形可量的時候寧可不報，也不要用估的", function () {
  assert.deepEqual(diagramCollisionWarnings([]), []);
  assert.deepEqual(diagramCollisionWarnings(null), []);
});

/* ══ 尖峰小時「內部」與「附近」的兩張新圖：資料來源的守門 ══════════ */

test("minutesOfClock：讀不出來要回 null，不可以回 0", function () {
  assert.equal(minutesOfClock("07:15"), 435);
  assert.equal(minutesOfClock("00:00"), 0);
  /* ⚠️ 00:00 是真的午夜，所以「讀不出來」不能也用 0 表示，必須是 null */
  assert.equal(minutesOfClock(""), null);
  assert.equal(minutesOfClock("七點"), null);
  assert.equal(minutesOfClock("25:00"), null);
  assert.equal(minutesOfClock(undefined), null);
});

test("四格圖：只取尖峰視窗**內**的格子，而且每一格都要是 15 分鐘", function () {
  const sample = record();
  sample.peaks.AM = { start: "00:00", end: "01:00" };
  const result = peakQuarterHours(sample, "AM");
  assert.equal(result.reason, "ok");
  assert.deepEqual(result.cells.map(function (c) { return c.start; }), [0, 15, 30, 45]);
  /* 60 那一格的 end 是 75，超出視窗，不可以被算進來 */
  assert.equal(result.cells.length, 4);
});

test("四格圖：整點一格的調查檔要回 not-quarter，不可以硬畫", function () {
  const sample = record();
  sample.sourceTrace!.intervals = [
    { start: 0, end: 60, pcu: 100, vehicles: 100 },
    { start: 60, end: 120, pcu: 120, vehicles: 120 },
  ];
  sample.peaks.AM = { start: "00:00", end: "01:00" };
  assert.equal(peakQuarterHours(sample, "AM").reason, "not-quarter");
});

test("四格圖：三種空結果要分得開，畫面才講得出原因", function () {
  const noTrace = record();
  delete noTrace.sourceTrace;
  assert.equal(peakQuarterHours(noTrace, "AM").reason, "no-intervals");
  const noWindow = record();
  assert.equal(peakQuarterHours(noWindow, "DAY").reason, "no-window");
});

test("60 分鐘折線：要**依時間**排，不是依名次排", function () {
  const rows = peakWindowSeries(record());
  assert.deepEqual(rows.map(function (r) { return r.start; }), [0, 15]);
  /*
   * 同一份資料下，peakSensitivity 依大小排、第一名是 start=15；
   * peakWindowSeries 依時間排、第一筆是 start=0。
   * 兩者第一筆不同，正好證明這一支不是把那一支換個名字。
   */
  assert.equal(peakSensitivity(record())[0].start, 15);
  assert.equal(rows[0].start, 0);
});

test("60 分鐘折線：中間缺一格的視窗要整個排除，不可以當成完整的一小時", function () {
  const sample = record();
  sample.sourceTrace!.intervals = [
    { start: 0, end: 15, pcu: 1, vehicles: 1 },
    { start: 15, end: 30, pcu: 2, vehicles: 2 },
    /* 30–45 缺一格 */
    { start: 45, end: 60, pcu: 4, vehicles: 4 },
    { start: 60, end: 75, pcu: 5, vehicles: 5 },
  ];
  const rows = peakWindowSeries(sample);
  assert.deepEqual(rows.map(function (r) { return r.start; }), []);
});

test("60 分鐘折線：沒有逐格資料時回空陣列，不可以丟例外", function () {
  const sample = record();
  delete sample.sourceTrace;
  assert.deepEqual(peakWindowSeries(sample), []);
});
