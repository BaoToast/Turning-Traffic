import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import {
  DEFAULT_PCE,
  PEAK_KEYS,
  PEAK_RANGES,
  SCOPE_KEYS,
  coverageOf,
  coversFullDay,
  emptyMovement,
  emptyPeakWindows,
  ensureRecordScopes,
  formatSurveyHours,
  fullDayUnavailableReason,
  hasDayPeak,
  inspectWorkbook,
  peakWindowsFor,
  scopeUnit,
  scopeWindowLabel,
  type TrafficRecord,
} from "../lib/traffic.ts";
import type { PeakKey as ConclusionPeakKey } from "../lib/conclusion.ts";
import {
  CONCLUSION_METRICS,
  scopeRateUnit,
  scopeVehicleUnit,
} from "../lib/conclusion.ts";

/*
 * ── 全日時段與全日尖峰小時（v2.1.30）的守門測試 ──
 *
 * 這一組守的是四件事：
 *   1. 全日尖峰小時**只有 24 小時的調查算得出來**。不足一天時必須是空的，
 *      不可以拿上午／下午尖峰裡較大的那一個充數——那個數字看起來像新資訊，
 *      其實只是換個名字，而且會被當成整天的最大值寫進報告。
 *   2. 上午／下午尖峰的搜尋範圍是 [00:00, 12:00) 與 [12:00, 24:00)，兩段
 *      鋪滿一天且不重疊。舊的 [05:00, 12:00) 與 [12:00, 23:00) 合起來掃不到
 *      23:00–24:00 與 00:00–05:00。
 *   3. 每一格的原始車輛數先四捨五入成整數，再進入所有計算。
 *   4. 同一件事只能有一個來源：24 小時的門檻只有 coversFullDay，
 *      統計範圍的欄位只由 SCOPE_KEYS 產生。
 *
 * 全部都已對未修正的 v2.1.29 實測過會紅字（結果見交付說明）。
 */

/** 產生一份「每小時一列、涵蓋 24 小時」的路口轉向調查表。 */
function fullDayWorkbook(options: {
  /** 第 hour 個小時、每一個左直右欄位各幾輛。可以回小數，用來測四捨五入。 */
  countAt: (hour: number) => number;
  hours?: number[];
  fileName?: string;
}) {
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const hours = options.hours ?? Array.from({ length: 24 }, (_, i) => i);
  const stride = vehicles.length * 3 + 2;
  const rows: unknown[][] = Array.from({ length: 6 + hours.length }, () =>
    Array(stride * 4 + 4).fill(null),
  );
  for (let approach = 0; approach < 4; approach++) {
    const base = approach * stride;
    rows[1][base] = "站號：09999T99-01";
    rows[1][base + 4] = "日期：115.05.04 (平日)";
    rows[2][base] = "站名：測試路/全日驗證路口";
    rows[3][base] = `路口編號：路口${String.fromCharCode(65 + approach)}`;
    rows[4][base] = "時間";
    vehicles.forEach(function (vehicle, vehicleIndex) {
      rows[4][base + 1 + vehicleIndex * 3] = vehicle;
      movements.forEach(function (movement, movementIndex) {
        rows[5][base + 1 + vehicleIndex * 3 + movementIndex] = movement;
      });
    });
    hours.forEach(function (hour, index) {
      const label =
        `${String(hour).padStart(2, "0")}:00～` +
        `${String(hour + 1).padStart(2, "0")}:00`;
      rows[6 + index][base] = label;
      for (let column = 1; column <= vehicles.length * 3; column++)
        rows[6 + index][base + column] = options.countAt(hour);
    });
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: 4 }).flatMap(function (_, approach) {
    return vehicles.map(function (__, vehicleIndex) {
      return {
        s: { r: 4, c: approach * stride + 1 + vehicleIndex * 3 },
        e: { r: 4, c: approach * stride + 3 + vehicleIndex * 3 },
      };
    });
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "平日");
  return new File(
    [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    options.fileName ?? "09999T99-01.xlsx",
  );
}

/*
 * ⚠️ 這一項在 v2.1.64 之前叫「24 小時的調查**才**算得出全日尖峰小時」。
 *   「才」字已經不成立（4 小時的調查現在也算得出全調查時段尖峰），
 *   但它要驗的另一半仍然重要：24 小時的調查挑到的視窗必須跟以前**完全一樣**。
 *   這是改口徑之後的回歸底線。
 */
test("24 小時的調查挑到的全調查時段尖峰，與改口徑之前完全一致", async () => {
  /* 尖峰刻意放在凌晨 03:00：舊的上午範圍 [05:00, 12:00) 掃不到那裡。 */
  const preview = await inspectWorkbook(
    fullDayWorkbook({ countAt: (hour) => (hour === 3 ? 100 : 1) }),
    DEFAULT_PCE,
  );
  assert.equal(preview.survey?.minutes, 24 * 60, "應該讀成 24 小時");
  assert.ok(preview.peakWindows.DAY, "24 小時的調查一定要有全調查時段尖峰");
  assert.equal(
    preview.peakWindows.DAY?.start,
    3 * 60,
    "全調查時段尖峰要挑到 03:00 那一小時",
  );
  assert.equal(
    preview.peakWindows.AM?.start,
    3 * 60,
    "上午尖峰的搜尋範圍已放寬到 00:00，03:00 必須挑得到",
  );
});

test("23:00 的尖峰要被下午尖峰掃到（舊範圍到 23:00 為止，掃不到）", async () => {
  const preview = await inspectWorkbook(
    fullDayWorkbook({ countAt: (hour) => (hour === 23 ? 100 : 1) }),
    DEFAULT_PCE,
  );
  assert.equal(preview.peakWindows.PM?.start, 23 * 60);
  assert.equal(preview.peakWindows.DAY?.start, 23 * 60);
});

test("上午與下午的搜尋範圍鋪滿一天、而且不重疊", () => {
  assert.deepEqual(PEAK_RANGES.AM, [0, 12 * 60]);
  assert.deepEqual(PEAK_RANGES.PM, [12 * 60, 24 * 60]);
  assert.deepEqual(PEAK_RANGES.DAY, [0, 24 * 60]);
  /* 上午的結尾就是下午的開頭：不重疊，也沒有缺口。 */
  assert.equal(PEAK_RANGES.AM[1], PEAK_RANGES.PM[0]);
  assert.equal(PEAK_RANGES.AM[0], PEAK_RANGES.DAY[0]);
  assert.equal(PEAK_RANGES.PM[1], PEAK_RANGES.DAY[1]);
});

test("不足 24 小時的調查**也要**算出全調查時段尖峰，但視窗不可以跨越空隙", async () => {
  /*
   * 使用者實際的檔案就是這個形狀：07:00–09:00 與 17:00–19:00，合計 4 小時。
   *
   * ⚠️ 這一項在 v2.1.64 **翻轉**了，翻轉的理由是名稱改了：
   *   舊名「全日尖峰」宣告的是一整天，4 小時的樣本算出來的值會被當成
   *   整天的最大值抄進報告，所以舊版一律回 null（那個判斷在當時是對的）。
   *   新名「全調查時段尖峰」宣告的是「這份調查涵蓋的時段」，
   *   4 小時的調查算出「這 4 小時裡最大的那一小時」完全誠實。
   *   使用者 2026-09-10：「三份程式統一名稱後，原本不用計算的資料，現在都要計算了」。
   *
   * ⚠️ 但**安全性沒有放寬**：視窗仍然必須由相接的原始格組成，
   *   絕對不可以橫跨 09:00–17:00 那八小時的空隙。這才是這一項真正要守的東西。
   */
  const preview = await inspectWorkbook(
    fullDayWorkbook({
      countAt: (hour) => (hour === 8 ? 50 : 10),
      hours: [7, 8, 17, 18],
      fileName: "09999T99-02.xlsx",
    }),
    DEFAULT_PCE,
  );
  assert.equal(preview.survey?.minutes, 4 * 60);
  assert.equal(coversFullDay(preview.survey), false);
  assert.ok(
    preview.peakWindows.DAY,
    "改名為全調查時段尖峰之後，4 小時的調查也要算得出來",
  );
  assert.ok(preview.peakWindows.AM, "上午尖峰仍然要算得出來");
  assert.ok(preview.peakWindows.PM, "下午尖峰仍然要算得出來");
  /*
   * 這一份的 08:00 那一格量最大，所以全調查時段尖峰應該落在 08:00 起算。
   * ⚠️ 只驗「算得出來」不夠——回一個橫跨空隙的視窗也「算得出來」。
   */
  assert.equal(preview.peakWindows.DAY?.start, 8 * 60);
  assert.equal(preview.peakWindows.DAY?.end, 9 * 60);
  /*
   * 反面：視窗的頭尾都必須落在**有資料的那兩段**之內。
   * 09:00–17:00 之間沒有任何一格，任何落在那裡的視窗都是假的。
   */
  const start = preview.peakWindows.DAY?.start ?? -1;
  const end = preview.peakWindows.DAY?.end ?? -1;
  const inside = (minute: number) =>
    (minute >= 7 * 60 && minute <= 9 * 60) ||
    (minute >= 17 * 60 && minute <= 19 * 60);
  assert.ok(
    inside(start) && inside(end),
    `全調查時段尖峰視窗 ${start}–${end} 落在沒有資料的區間，等於橫跨了調查空隙`,
  );
});

test("每一格的車輛數先四捨五入成整數，再進入所有計算", async () => {
  /*
   * 使用者的 06538／06525T2503 這類檔案，儲存格存的是小數（0.36、5.5506…），
   * Excel 的格式把它顯示成整數。舊版直接拿小數去算，全日車輛數會出現
   * 「27,988.79 輛」這種不存在的車，PCU 也跟著帶小數。
   */
  const preview = await inspectWorkbook(
    fullDayWorkbook({
      countAt: (hour) => (hour === 9 ? 5.5506 : 0.36),
      fileName: "09999T99-03.xlsx",
    }),
    DEFAULT_PCE,
  );
  const values = preview.survey?.values ?? [];
  assert.ok(values.length > 0);
  assert.ok(
    values.every(function (value) {
      return Number.isInteger(value);
    }),
    `全日車輛數出現小數：${values.filter((v) => !Number.isInteger(v)).slice(0, 3).join(", ")}`,
  );
  /* 0.36 → 0、5.5506 → 6：23 個小時各 0 輛，第 9 小時 6 輛。 */
  assert.equal(values[0], 6);
  assert.ok(
    (preview.intervalRows ?? []).every(function (row) {
      return row.values.every(Number.isInteger);
    }),
    "逐格資料裡還有小數，代表四捨五入沒有做在讀取原始儲存格的地方",
  );
});

test("peakWindowsFor 是唯一的尖峰挑選入口，而且不再吃 surveyMinutes 這道門檻", () => {
  const rows = Array.from({ length: 24 }, function (_, hour) {
    return {
      start: hour * 60,
      label: `${hour}:00`,
      values: [hour === 2 ? 100 : 1],
    };
  });
  const full = peakWindowsFor(rows, 60, undefined, 24 * 60);
  assert.equal(full.DAY?.start, 2 * 60);
  assert.equal(full.AM?.start, 2 * 60);
  /*
   * ⚠️ v2.1.64 起：同一批逐格資料，**宣告的調查時數不再改變挑選結果**。
   *   宣告時數只用來決定單位的分母要寫「調查日」還是「調查時段」。
   *   把時數當成計算門檻，會讓同一批資料因為 metadata 不同而算出不同的值。
   */
  const partial = peakWindowsFor(rows, 60, undefined, 4 * 60);
  assert.deepEqual(
    partial.DAY,
    full.DAY,
    "同一批逐格資料，宣告時數不同卻算出不同的尖峰——那代表時數被拿去當計算門檻了",
  );
  assert.equal(partial.AM?.start, 2 * 60, "上午尖峰不受影響");
});

test("全調查時段尖峰**不必然**等於 AM/PM 較大者：跨中午的視窗只有它挑得到", () => {
  /*
   * 舊版程式的註解斷言：「4 小時的調查算出來的全日尖峰必然等於上午與下午
   * 尖峰裡較大的那一個，看起來像新資訊其實不是。」
   *
   * 拿使用者提供的 5 份真實 4 小時檔實跑，**那句話在那 5 份上成立**
   *（harness/verify-peak-turning.mjs：10/10 相同，重複計入兩個目錄）。
   * 但它不是普遍成立的，這一項就是反例：
   *
   *   AM 的搜尋範圍是 [00:00, 12:00)，而且**視窗的結尾也要落在範圍內**；
   *   PM 是 [12:00, 24:00)，起點要 ≥ 12:00。
   *   所以 11:30–12:30 這個視窗，AM 挑不到（結尾超過 12:00）、
   *   PM 也挑不到（起點早於 12:00）——只有 DAY 的 [00:00, 24:00) 挑得到。
   *
   * ⚠️ 這一項的意義：全調查時段尖峰是**真的新資訊**，不是換個名字的舊數字。
   *   把它拿掉或改成 max(AM, PM)，10:00–14:00 這種午間調查會漏掉真正的尖峰。
   *
   * 這一份是**模擬資料**（真實檔裡沒有午間 4 小時的形狀），刻意標明。
   */
  const rows = [];
  for (let minute = 10 * 60; minute < 14 * 60; minute += 15)
    rows.push({
      start: minute,
      label: `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`,
      /* 11:30–12:30 這四格特別高，其餘一律 1。 */
      values: [minute >= 11 * 60 + 30 && minute < 12 * 60 + 30 ? 100 : 1],
    });
  const windows = peakWindowsFor(rows, 15, undefined, 4 * 60);
  assert.equal(
    windows.DAY?.start,
    11 * 60 + 30,
    "跨中午的尖峰必須挑得到，這正是全調查時段尖峰比 max(AM,PM) 多出來的資訊",
  );
  assert.equal(windows.DAY?.end, 12 * 60 + 30);
  /* AM 與 PM 都挑不到那個視窗——所以 max(AM, PM) 必然比 DAY 小。 */
  assert.notEqual(windows.AM?.start, 11 * 60 + 30);
  assert.notEqual(windows.PM?.start, 11 * 60 + 30);
  const larger = Math.max(windows.AM?.total ?? 0, windows.PM?.total ?? 0);
  assert.ok(
    (windows.DAY?.total ?? 0) > larger,
    `全調查時段尖峰 ${windows.DAY?.total} 沒有大於 max(AM,PM) ${larger}，` +
      "那代表跨中午的視窗沒被挑到",
  );
});

test("視窗中間缺一格就整個排除——這是拿掉 24 小時門檻之後唯一的護欄", () => {
  /*
   * ⚠️ 這一項是 v2.1.64 拿掉時數門檻之後**最重要的一條**。
   *   以前 4 小時的調查根本不算 DAY，所以「跨越空隙」不可能發生；
   *   現在會算了，護欄只剩 rollingPeak 裡「每一格要相接」那一段。
   *   那一段如果被誰改掉，07–09＋17–19 的檔案會算出一個橫跨八小時空隙、
   *   數字看起來很正常的假尖峰——那是最危險的一種錯。
   */
  const rows = [
    { start: 0, label: "00:00", values: [1] },
    { start: 15, label: "00:15", values: [1] },
    { start: 30, label: "00:30", values: [1] },
    /* 00:45 這一格刻意不存在 */
    { start: 60, label: "01:00", values: [999] },
    { start: 75, label: "01:15", values: [999] },
    { start: 90, label: "01:30", values: [999] },
    { start: 105, label: "01:45", values: [999] },
  ];
  const windows = peakWindowsFor(rows, 15, undefined, 2 * 60);
  assert.equal(
    windows.DAY?.start,
    60,
    "01:00 起算的四格是唯一完整相接的一小時，尖峰必須落在那裡",
  );
  /* 0 起算的視窗會橫跨缺掉的 00:45，絕對不可以被選中。 */
  assert.notEqual(windows.DAY?.start, 0);
});

test("舊備份自動補上全日欄位，既有的上午／下午數字一個都不動", () => {
  const legacyMovement = {
    left: 11.5,
    through: 22.5,
    right: 33.5,
    vehicle: { car: 60 },
    rawVehicleTotal: 60,
  };
  const legacy = {
    id: "legacy",
    station: "T99-01",
    name: "舊備份路口",
    rawName: "legacy.xls",
    quarter: "114Q1",
    date: "2025-01-01",
    surveyType: "平日",
    /* v2.1.29 以前存下來的形狀：只有 AM／PM。 */
    peaks: {
      AM: { start: "07:15", end: "08:15" },
      PM: { start: "17:00", end: "18:00" },
    },
    approaches: [
      {
        id: "A",
        name: "支線A",
        bearing: "東",
        angle: 0,
        lanes: null,
        capacity: null,
        movements: { AM: legacyMovement, PM: legacyMovement },
      },
    ],
    sourceFiles: [],
    importedAt: "2025-01-01T00:00:00Z",
    validation: { referenceFound: false, matchRate: null, notes: [] },
  } as unknown as TrafficRecord;

  const fixed = ensureRecordScopes(legacy);
  for (const key of SCOPE_KEYS)
    assert.ok(
      fixed.approaches[0].movements[key],
      `補齊後仍然少了 ${key}，載入舊備份會丟例外`,
    );
  for (const key of PEAK_KEYS)
    assert.ok(fixed.peaks[key], `補齊後仍然少了 peaks.${key}`);
  /* 既有數字不可以被動到。 */
  assert.equal(fixed.approaches[0].movements.AM.left, 11.5);
  assert.equal(fixed.approaches[0].movements.PM.right, 33.5);
  assert.equal(fixed.peaks.AM.start, "07:15");
  /* 補出來的是空值，不是 0 以外的任何憑空數字。 */
  assert.equal(fixed.approaches[0].movements.DAY.through, 0);
  assert.deepEqual(fixed.peaks.DAY, { start: "", end: "" });
  /* 空的起訖時間＝「沒有值」，據此才分辨得出「舊資料」與「資料不足」。 */
  assert.equal(hasDayPeak(fixed), false);
});

test("「－」要說得出是哪一種原因：資料不足，還是舊資料要重新匯入", () => {
  const base = ensureRecordScopes({
    id: "x",
    station: "T99-02",
    name: "路口",
    rawName: "x.xls",
    quarter: "115Q1",
    date: "2026-01-01",
    surveyType: "平日",
    peaks: emptyPeakWindows(),
    approaches: [],
    sourceFiles: [],
    importedAt: "2026-01-01T00:00:00Z",
    validation: { referenceFound: false, matchRate: null, notes: [] },
  } as unknown as TrafficRecord);

  /*
   * (1) 只做了 4 小時。
   * ⚠️ v2.1.64 起「不足 24 小時」**不再是一個理由**——
   *   全調查時段就是這份調查涵蓋的時段，4 小時的調查照樣有值。
   *   但畫面一定要寫得出「這一筆只涵蓋 4 小時」，否則讀者無從判讀那個數字。
   */
  base.survey = { intervals: 16, minutes: 4 * 60, vehicle: {} };
  assert.equal(
    fullDayUnavailableReason(base, "FULL"),
    null,
    "4 小時的調查有全調查時段的值，不可以說它算不出來",
  );
  assert.equal(formatSurveyHours(base), "4 小時");
  assert.equal(
    scopeWindowLabel(base, "FULL"),
    "4 小時",
    "涵蓋時數是判讀這個數字最需要的一件事，不可以寫「－」",
  );

  /* (2) 有逐格資料才算得出全調查時段尖峰；沒有＝舊版匯入的資料 */
  base.survey = { intervals: 24, minutes: 24 * 60, vehicle: {} };
  assert.equal(
    fullDayUnavailableReason(base, "FULL"),
    null,
    "全調查時段是從已存的調查總量算的，舊資料也該有",
  );
  assert.match(fullDayUnavailableReason(base, "DAY") ?? "", /重新匯入/);

  /* (3) 兩者都有 */
  base.peaks.DAY = { start: "08:00", end: "09:00" };
  assert.equal(fullDayUnavailableReason(base, "DAY"), null);
  assert.equal(scopeWindowLabel(base, "DAY"), "08:00–09:00");
  assert.equal(scopeWindowLabel(base, "FULL"), "24 小時");

  /* 尖峰的統計範圍永遠不會有「不適用」的理由。 */
  assert.equal(fullDayUnavailableReason(base, "AM"), null);
  assert.equal(fullDayUnavailableReason(base, "PM"), null);
});

test("單位跟著統計範圍走，全調查時段不可以標成每小時", () => {
  /*
   * ⚠️ 2026-09-25 第六輪：這一支原本寫 `scopeUnit("AM")`、`scopeUnit("FULL")`
   *   ——**故意只傳一個參數**，而且用正面斷言把「不傳涵蓋時是什麼」釘死。
   *   那等於用測試宣告「不傳涵蓋是合法用法」，而全專案二十幾個沒傳涵蓋的
   *   呼叫點就是這樣長出來的（其中好幾處在畫面上印出與同頁不一致的單位）。
   *   現在 `scopeUnit()` 三個參數全部必填，這裡一律明寫。
   */
  assert.equal(scopeUnit("AM", "pcu", "unknown"), "PCU/hr");
  assert.equal(scopeUnit("PM", "vehicle", "unknown"), "輛/hr");
  assert.equal(scopeUnit("DAY", "pcu", "unknown"), "PCU/hr");
  assert.equal(scopeUnit("DAY", "vehicle", "unknown"), "輛/hr");
  /* 全調查時段是整段調查的累計，不是流率。 */
  assert.equal(scopeUnit("FULL", "pcu", "unknown"), "PCU/調查時段");
  assert.equal(scopeUnit("FULL", "vehicle", "unknown"), "輛/調查時段");
});

test("scopeUnit() 的三個參數不可以再有預設值", () => {
  /*
   * ⚠️ 這一條守的是「洞不可以被悄悄補回去」。
   *   只要 `kind` 或 `coverage` 任何一個重新有預設值，呼叫端就又能不講涵蓋，
   *   而 TypeScript 不會有任何抱怨——第六輪之前就是這個狀態。
   *   刻意用原始碼比對，不是行為比對：行為上「有預設值」與「每個呼叫端都
   *   明寫 unknown」完全一樣，看不出差別。
   */
  const source = readFileSync(
    new URL("../lib/traffic.ts", import.meta.url),
    "utf8",
  );
  const signature = source.match(
    /export function scopeUnit\(([\s\S]*?)\) \{/,
  );
  assert.ok(signature, "找不到 scopeUnit 的簽章——寫法改了就要跟著改這一支");
  assert.doesNotMatch(
    signature[1],
    /=/,
    "scopeUnit() 的參數又出現預設值了。三個參數必填是刻意的：" +
      "拿掉預設值才能讓每一個呼叫點被迫講出它的涵蓋是從哪裡來的。\n" +
      `目前的簽章：${signature[1].trim()}`,
  );
  /* 前置檢查：真的抓到三個參數，不是抓到一個空字串就過。 */
  for (const name of ["scope", "kind", "coverage"])
    assert.match(signature[1], new RegExp(name), `簽章裡沒有 ${name}`);
});

test("分母：24 小時寫「調查日」，非 24 小時寫「調查時段」，混合一律「調查時段」", () => {
  /*
   * 使用者 2026-09-10 定案：
   *   「如果確認為 24 小時的數值的話，分母就維持『日』，非 24 小時的才寫調查時段」
   *   「（混合的表）欄名就統一用 調查時段，然後表下方註明清楚」
   */
  assert.equal(scopeUnit("FULL", "pcu", "full"), "PCU/調查日");
  assert.equal(scopeUnit("FULL", "vehicle", "full"), "輛/調查日");
  assert.equal(scopeUnit("FULL", "pcu", "partial"), "PCU/調查時段");
  assert.equal(scopeUnit("FULL", "pcu", "mixed"), "PCU/調查時段");
  /*
   * ⚠️ 涵蓋不明（`"unknown"`）時要落在「調查時段」而不是「調查日」。
   *   24 小時是「調查時段剛好等於一日」的特例，用調查時段當共同分母不會說錯話；
   *   反過來落在「日」，任何拿不到涵蓋的地方都會把 4 小時的量宣告成全日量。
   *   **錯的方向要選會少講，不要選會多講。**
   *   ⚠️ 這**不是**在說「可以不傳涵蓋」——三個參數已經全部必填（見上一支）。
   *     這裡講的是「真的查不到涵蓋時，那個值該落在哪一邊」。
   */
  assert.equal(scopeUnit("FULL", "pcu", "unknown"), "PCU/調查時段");
  /* 尖峰的分母永遠是 hr，不受涵蓋影響。 */
  for (const coverage of ["full", "partial", "mixed", "unknown"] as const)
    assert.equal(scopeUnit("AM", "pcu", coverage), "PCU/hr");
});

test("coverageOf：整批都滿 24 小時才是 full，混到一筆不是就變 mixed", () => {
  const at = (minutes: number) =>
    ({ survey: { minutes } }) as unknown as TrafficRecord;
  assert.equal(coverageOf(at(24 * 60)), "full");
  assert.equal(coverageOf(at(4 * 60)), "partial");
  assert.equal(coverageOf([at(24 * 60), at(24 * 60)]), "full");
  assert.equal(coverageOf([at(4 * 60), at(6 * 60)]), "partial");
  assert.equal(coverageOf([at(24 * 60), at(4 * 60)]), "mixed");
  /* 沒有記錄時數的一律不算數，全部都沒有才回 unknown。 */
  assert.equal(coverageOf([]), "unknown");
  assert.equal(coverageOf(at(0)), "unknown");
  assert.equal(
    coverageOf([at(24 * 60), at(0)]),
    "full",
    "沒有記錄時數的那一筆不該把整批拖成 mixed",
  );
});

test("結論草稿的時段鍵值必須和 lib/traffic 的一致", () => {
  /*
   * lib/conclusion.ts 刻意不匯入 lib/traffic（會連帶把 xlsx 拉進來），
   * 所以兩邊各有一份 PeakKey。這一項用型別層級的方式把它們釘在一起：
   * 只要有一邊多了或少了鍵值，下面的指派就編不過。
   */
  const fromTraffic: ConclusionPeakKey[] = PEAK_KEYS;
  const fromConclusion: (typeof PEAK_KEYS)[number][] = fromTraffic;
  assert.deepEqual(fromConclusion.sort(), [...PEAK_KEYS].sort());
});

/*
 * ── 以下是原始碼層級的檢查 ──
 *
 * 這幾件事沒辦法在 node --test 裡把畫面跑起來驗，但「有沒有把同一件事寫成
 * 兩份」看原始碼就分辨得出來，而且對修正前的版本確實會紅字。
 * 註解要先拿掉再比對——不然「說明舊版怎麼錯」的註解本身會被當成缺陷。
 */
function sourceWithoutComments(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const appSource = sourceWithoutComments("../app/traffic-app.tsx");
const libSource = sourceWithoutComments("../lib/traffic.ts");

test("「有沒有滿 24 小時」全系統只有 coversFullDay 說了算", () => {
  for (const [label, source] of [
    ["app/traffic-app.tsx", appSource],
    ["lib/traffic.ts", libSource],
  ] as const)
    assert.doesNotMatch(
      source,
      /minutes\s*[<>]=?\s*(24 \* 60|1440)/,
      `${label} 還有地方自己寫 24 小時的門檻，沒有走 coversFullDay`,
    );
  assert.match(libSource, /export function coversFullDay/);
});

test("尖峰搜尋範圍只寫在 PEAK_RANGES 一個地方", () => {
  /* 舊版在挑選、品質檢查兩處各寫一份 5／12／23，改口徑時很容易只改一半。 */
  assert.doesNotMatch(
    libSource,
    /\[5 \* 60, 12 \* 60\]/,
    "還有地方寫死舊的上午範圍",
  );
  assert.doesNotMatch(
    libSource,
    /\[12 \* 60, 23 \* 60\]/,
    "還有地方寫死舊的下午範圍",
  );
  assert.doesNotMatch(
    libSource,
    /peak === "AM" && \(hour < 5/,
    "品質檢查還在自己寫一份尖峰範圍",
  );
  assert.match(libSource, /export const PEAK_RANGES/);
});

test("四個統計範圍的欄位由 SCOPE_KEYS 產生，不是手寫", () => {
  /* 舊版把上午／下午／全日的欄位一個一個手寫，加一個時段就要補六個欄位。 */
  assert.doesNotMatch(appSource, /"AM Peak 駛入量（PCU\/hr）"/);
  assert.doesNotMatch(appSource, /"全日駛入量（PCU\/調查日）"/);
  assert.doesNotMatch(appSource, /"PM Peak 駛出實際車輛數（輛\/hr）"/);
  assert.match(appSource, /SCOPE_KEYS\.flatMap\(function \(scope\)/);
  /* 三元判斷式的取值方式也不可以再出現：多一個時段就會被當成 PM。 */
  assert.doesNotMatch(
    appSource,
    /peakKey === "AM" \? row\.outbound/,
    "還有地方用 AM/PM 三元判斷取值，第三個時段會被誤判成 PM",
  );
  assert.doesNotMatch(
    appSource,
    /key === "AM" \? item\.am\?\.values : item\.pm\?\.values/,
  );
});

test("進階分析與批次成果包的全日時段單位都走 scopeUnit", () => {
  const advancedBlock = appSource.slice(
    appSource.indexOf("function exportAdvancedExcel"),
    appSource.indexOf("function exportQualityExcel"),
  );
  /*
   * ⚠️ 2026-09-16：這一頁的時段**可以脫離**主工具列，所以匯出與畫面
   *   一律改讀 advancedPeak。守的仍然是同一件事——單位要走 scopeUnit、
   *   而且要走**這一頁實際在算的那個時段**，不是寫死 PCU/hr。
   */
  /*
   * ⚠️ 2026-09-25 第六輪：樣式一併要求**帶涵蓋**。原本只要求
   *   `scopeUnit(advancedPeak)`，那個寫法靠的是函式的預設涵蓋，
   *   選「全調查時段」時活頁簿寫「PCU/調查時段」而畫面寫「PCU/調查日」。
   *   現在 `scopeUnit()` 三個參數必填，樣式也要跟著釘住第三個參數。
   */
  assert.match(
    advancedBlock,
    /單位:\s*scopeUnit\(advancedPeak,\s*"pcu",\s*advancedExportCoverage\)/,
  );
  assert.match(
    advancedBlock,
    /const advancedExportCoverage = coverageOf\(view\)/,
    "匯出用的涵蓋不是從實際要匯出的那一筆算出來的",
  );
  assert.doesNotMatch(
    advancedBlock,
    /scopeUnit\(peak\)/,
    "匯出還在讀主工具列的時段，這一頁脫離時檔案會是另一個時段的數字",
  );
  assert.doesNotMatch(
    advancedBlock,
    /viewRecord\(record\)/,
    "匯出還在套主工具列的轉向別，而畫面上寫著「一律以全部轉向計算」",
  );

  const advancedView = appSource.slice(
    appSource.indexOf('{view === "advanced"'),
    appSource.indexOf('{view === "conclusion"'),
  );
  assert.match(
    advancedView,
    /scopeUnit\(advancedPeak,\s*"pcu",\s*advancedCoverage\)/,
  );
  assert.doesNotMatch(
    advancedView,
    /scopeUnit\(advancedPeak\)/,
    "這一頁還有沒帶涵蓋的單位標籤——同一份資料會出現兩種單位",
  );
  assert.doesNotMatch(
    advancedView,
    /守恆差值[\s\S]{0,160}PCU\/hr/,
    "全日時段的守恆差值仍被標成每小時",
  );

  const batchBlock = appSource.slice(
    appSource.indexOf("async function exportBatch"),
    appSource.indexOf("function importBackup"),
  );
  /*
   * ⚠️ 2026-09-25 第六輪：改成多行呼叫（第三個參數是整包的涵蓋），
   *   原本的單行樣式 `scopeUnit(peak,` 抓不到。順便把第三個參數一起釘住——
   *   README 描述的是整個 ZIP，逐筆算會寫出一個只對其中一個路口成立的單位。
   */
  assert.match(
    batchBlock,
    /scopeUnit\(\s*peak,\s*vehicle === "all" \? "pcu" : "vehicle",\s*coverageOf\(rows\.map\(viewRecord\)\),\s*\)/,
  );
  assert.match(batchBlock, /SCOPE_LABELS\[peak\]/);
});

test("轉向圖上的數字只有一支取值函式（含新增的車輛數模式）", () => {
  assert.match(appSource, /const movementValue = function/);
  assert.match(appSource, /const routeValueOf = function/);
  assert.match(appSource, /const destinationValue = function/);
  /* 舊版在圖裡就地寫了三次 `vehicle === "all" ? pcu : 輛數`。 */
  assert.doesNotMatch(
    appSource,
    /vehicle === "all"\s*\?\s*route\.volumes\[peak\]\.pcu/,
  );
  /* 單位不可以再寫死 PCU/hr——全日時段會變成「24,463.3 PCU/hr」。 */
  assert.doesNotMatch(
    appSource,
    /const unit = vehicle === "all" \? "PCU\/hr" : "輛\/hr";/,
  );
  /*
   * v2.1.34：「這個模式要報 PCU 還是輛」只能有一支判斷。以前寫成
   * `const countMode = mode === "count"` 藏在轉向圖產生器的區域變數裡，
   * 右側摘要拿不到、只好自己再猜一次，於是猜錯（選車輛數仍報 PCU）。
   * 現在統一走 displayValueKind()，圖與摘要都用它。
   */
  assert.match(appSource, /function displayValueKind\(mode: DisplayMode\)/);
  assert.match(appSource, /const valueKind = displayValueKind\(mode\);/);
  /*
   * ⚠️ v2.1.64 起還要把**這一筆的調查涵蓋**傳進去：
   *   滿 24 小時寫「/調查日」，否則寫「/調查時段」。
   *   ⚠️ 2026-09-25 第六輪：`scopeUnit()` 三個參數已全部必填，
   *     「不傳」在型別上就過不了（原本這裡寫的是「不傳會走安全預設」）。
   */
  assert.match(
    appSource,
    /const unit = scopeUnit\(peak, valueKind, coverageOf\(record\)\);/,
  );
  assert.doesNotMatch(appSource, /const countMode = mode === "count";/);
  /* 摘要的單位與值也必須走同一組判斷，不可以再寫死 PCU/hr。 */
  const summaryBlock = appSource.slice(
    appSource.indexOf("const summary = useMemo("),
    appSource.indexOf("const geometrySchematicHtml = useMemo("),
  );
  /*
   * ⚠️ v2.1.74（主工具列）起，摘要吃的是**轉向圖那一張自己的條件**
   *   （diagramDisplay／diagramPeak／diagramRecord），不是全站的
   *   displayMode／peak／selected——因為那一張圖現在可以脫離主工具列。
   *   守門要守的仍然是同一件事：**摘要與圖走同一組判斷**，
   *   不可以各自再猜一次；所以這裡放寬成「同一組 diagram* 值」。
   *   （沒放寬的話會逼人把摘要接回全站狀態，那正是 18 條紅字的來源。）
   */
  assert.match(summaryBlock, /displayValueKind\(diagramDisplay\)/);
  assert.match(
    summaryBlock,
    /scopeUnit\(diagramPeak, kind, coverageOf\(diagramRecord\)\)/,
  );
  assert.doesNotMatch(appSource, /<small>PCU\/hr<\/small>/);
});

test("全日時段不另外存檔，每次載入由 survey 現算", () => {
  /* 同一個概念存兩份，遲早分岔——這個專案已經為同類問題修過三輪。 */
  assert.match(appSource, /route\.volumes\.FULL = \{/);
  assert.match(appSource, /approach\.movements\.FULL = emptyMovement\(\);/);
  /* 清空要放在「沒有流向就 return」之前，否則舊備份帶著的值會一直留著。 */
  const sync = appSource.slice(
    appSource.indexOf("function syncRouteTotals"),
    appSource.indexOf("function applyReferenceMovementRule"),
  );
  assert.ok(
    sync.indexOf("approach.movements.FULL = emptyMovement();") <
      sync.indexOf("if (!record.routes?.length) return record;"),
    "FULL 的重建排在 routes 檢查之後，沒有流向的舊資料清不掉",
  );
});

test("車種一律取自資料，不是寫死的四種", () => {
  /*
   * 使用者明確要求：範例檔只有四種車，但系統要能匯入任意車種。
   * 新增的統計範圍若改用寫死的四種，自訂車種在全日欄位就會憑空消失。
   */
  const ids = appSource.slice(
    appSource.indexOf("function recordVehicleIds"),
    appSource.indexOf("function vehicleLabel"),
  );
  assert.match(ids, /SCOPE_KEYS\.forEach/, "車種清單沒有掃過四個統計範圍");
  assert.doesNotMatch(
    ids,
    /\["AM", "PM"\]/,
    "車種清單只掃了兩個時段，全日欄位的自訂車種會漏掉",
  );
  assert.match(appSource, /Object\.keys\(record\.survey\?\.vehicle \|\| \{\}\)/);
  const qualitySource = libSource.slice(
    libSource.indexOf("export function qualityIssues"),
    libSource.indexOf("export function rollingPeak"),
  );
  assert.doesNotMatch(
    qualitySource,
    /四車種合計/,
    "品質訊息不可把自訂車種誤稱為四車種",
  );
  assert.match(qualitySource, /各車種合計/);
});

test("歷季趨勢整體模式完整呈現 AM、PM 與全調查時段尖峰", () => {
  /*
   * v2.1.30 原稿已把 DAY 畫進折線，卻沒有圖例、獨立顏色和右側摘要，
   * 結果是一條無法辨識且與 PM 同色的線。整體模式的各部位必須一起跟著
   * 那張圖的統計範圍產生，不可以有人自己寫死一份。
   *
   * ⚠️ v2.1.65 起「整體」是**上下兩張圖**（三個尖峰／全調查時段），
   *   所以這一條原本寫死的三個字串已經過期：
   *   ・圖例改由 `view.scopes` 產生（不再是 PEAK_KEYS）
   *   ・標題改成「整體（尖峰＋全調查時段，上下兩張圖）」
   *   守的仍然是同一件事——**各部位一起跟著範圍走**——
   *   只是現在的範圍來源是每一張圖自己的 view。
   *   兩張圖的完整行為由 scripts/e2e-trend-split.mjs 實際量測。
   */
  assert.match(appSource, /DAY: "#1d4ed8"/);
  /*
   * 圖例、右側摘要一律跟著**這張圖實際畫出來的那幾條線**走。
   *
   * ⚠️ v2.1.75（X-34②「一張圖多條線」）之後，一條線不再等於一個統計範圍：
   *   逐項分列時同一個範圍上會有好幾條線（一個支線／轉向／車種一條）。
   *   所以來源從 `view.scopes` 改成 `view.series`、
   *   摘要從 `trendPeaks` 改成 `summarySeries`。
   *   守的仍然是同一件事——**各部位一起跟著線走，不可以有人自己寫死一份**。
   */
  assert.match(appSource, /view\.series\.map\(function \(item, index\)/);
  assert.doesNotMatch(
    appSource,
    /view\.scopes\.map\(function \(key, index\)/,
    "圖例還在照統計範圍產生，逐項分列時會少列好幾條線",
  );
  assert.match(appSource, /const summaries = summarySeries\.map/);
  assert.doesNotMatch(
    appSource,
    /const summaries = trendPeaks\.map/,
    "右側摘要還在照統計範圍列，會與圖上畫的線對不起來",
  );
  /* 「整體」時上圖是三個尖峰、下圖是全調查時段，兩張各自建立。 */
  assert.match(appSource, /buildChartView\(scopeSpecs\(PEAK_KEYS\), "trend-svg"/);
  assert.match(
    appSource,
    /scopeSpecs\(\["FULL"\]\),\s*\n\s*"trend-svg-full"/,
  );
  /*
   * ⚠️ 2026-09-16 訂正成 "AM_PM_DAY_FULL"。
   *   「整體」在畫面上是**兩張圖**（三個尖峰＋全調查時段），下載的 PNG
   *   也是兩張直向接在一起——舊檔名只寫 AM_PM_DAY，等於在檔名上漏掉
   *   下半張圖。收到檔案的人看不出少了什麼，那比整張壞掉更危險。
   */
  assert.match(appSource, /"AM_PM_DAY_FULL"/);
  assert.doesNotMatch(
    appSource,
    /color: peak === "AM" \? "#087f75" : "#d97706"/,
  );
  /*
   * ⚠️ 反面：不可以再出現「一個全域的 max」。
   *   兩張圖共用同一個縱軸最大值，就等於又回到「累計量與流率同一條軸」，
   *   三條尖峰線會被壓成貼著零的直線。
   */
  assert.doesNotMatch(
    appSource,
    /^ {2}const max = niceY\.max;$/m,
    "又出現了全域的縱軸最大值，兩張圖會共用同一條軸",
  );
});

test("空的 Movement 只有一份定義", () => {
  assert.match(libSource, /export function emptyMovement\(\): Movement/);
  /* app 端曾經自己再定義一份，兩邊欄位若漂移，補齊出來的形狀就不一樣。 */
  assert.doesNotMatch(appSource, /^function emptyMovement\(\)/m);
  assert.equal(
    emptyMovement().rawVehicleTotal,
    null,
    "沒有資料時是 null，不是 0——0 會被當成「真的沒有車」",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  呼叫端也要傳 coverage：同一頁不可以印出兩種單位（2026-09-25 第五輪）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 這個檔案原本只驗 `scopeUnit()` **本身**的行為，沒有驗**呼叫端有沒有把
 * coverage 傳進去**。第五輪獨立複查抓到：路口轉向圖「顯示」下拉的五個選項
 * 都沒傳，於是 `scope === "FULL"` 時選單恆寫「PCU/調查時段」，
 * 而同一頁的圖面走 `coverageOf(diagramRecord)`，滿 24 小時的檔寫「PCU/調查日」
 * ——同一頁對同一批資料兩種單位。
 *
 * PROJECT_HANDOFF 的規則是「單位的唯一來源是 scopeUnit()；不得另寫一套判斷」。
 * 三處都呼叫了同一支，但傳的參數不同，**規則字面過關、畫面仍然不一致**。
 * 所以守門要守的是「呼叫端傳了什麼」，不是「有沒有呼叫」。
 */
test("路口轉向圖的顯示下拉：每一個選項的單位都要傳 coverage", () => {
  const source = readFileSync(
    new URL("../app/traffic-app.tsx", import.meta.url),
    "utf8",
  );
  /*
   * 只看轉向圖「顯示」那個 <select> 的區塊，避免掃到別頁的同名選項
   * （`<option value="volume">交通流量</option>` 在別的下拉也有）。
   * 錨點用這一組只有轉向圖才有的選項值組合。
   */
  const start = source.indexOf('<option value="volume">\n');
  assert.notEqual(start, -1, "抓不到轉向圖「顯示」下拉的選項——結構改了嗎？");
  const end = source.indexOf('<option value="countPercent">', start);
  assert.notEqual(end, -1, "抓不到 countPercent 那個選項");
  const block = source.slice(start, end + 400);

  const calls = [...block.matchAll(/scopeUnit\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(
    calls.length >= 4,
    `這個區塊只抓到 ${calls.length} 個 scopeUnit(…)——結構改了嗎？`,
  );
  const missing = calls.filter((args) => !args.includes("coverageOf("));
  assert.deepEqual(
    missing,
    [],
    "轉向圖「顯示」下拉裡有 scopeUnit(…) 沒有傳 coverage："
      + "FULL 時它會恆寫「調查時段」，而同一頁的圖面寫「調查日」：\n  "
      + missing.map((a) => `scopeUnit(${a})`).join("\n  "),
  );
});

test("結論草稿自己那一份單位規則，必須與 scopeUnit() 逐格相同", () => {
  /*
   * ⚠️ `lib/conclusion.ts` 刻意**沒有任何 import**（它要能單獨搬走），
   *   所以單位規則在那裡有第二份實作：`scopeRateUnit()`／`scopeVehicleUnit()`。
   *   兩份實作就是兩個真相來源，而 2026-09-23 已經發生過一次：
   *   同一筆 24 小時調查，Excel 與報告草稿寫「PCU/調查日」、結論草稿寫
   *   「PCU/調查時段」。
   *
   * 既然不能合併，就**逐格比對**：四個統計範圍 × 四種涵蓋 × 兩種量，
   * 一格不同就紅。這比「兩邊各自有測試」強：各自的測試會各自通過。
   */
  const coverages = ["full", "partial", "mixed", "unknown"] as const;
  const scopes = ["AM", "PM", "DAY", "FULL"] as const;
  let checked = 0;
  for (const scope of scopes)
    for (const coverage of coverages) {
      assert.equal(
        scopeRateUnit(scope, coverage),
        scopeUnit(scope, "pcu", coverage),
        `PCU：${scope}／${coverage} 兩份實作不一致`,
      );
      assert.equal(
        scopeVehicleUnit(scope, coverage),
        scopeUnit(scope, "vehicle", coverage),
        `車輛數：${scope}／${coverage} 兩份實作不一致`,
      );
      checked += 2;
    }
  /* 前置檢查：真的比了 32 格，不是迴圈沒跑就過。 */
  assert.equal(checked, 32, `只比了 ${checked} 格`);
});

test("結論草稿的勾選標籤裡不可以寫死單位", () => {
  /*
   * ⚠️ 2026-09-25 第六輪抓到：勾選框的字寫死「（PCU/hr）」「（輛/調查時段）」，
   *   而使用者可以勾「全調查時段」、也可以一次勾多個時段——
   *   那個寫死的單位一定有機會與草稿本文不一致（實際就不一致）。
   *   單位只能由草稿本文逐句寫出來，標籤只講「是什麼量」。
   */
  /* ⚠️ 斜線有半形與全形兩種寫法，兩種都要抓（舊標籤裡兩種都出現過）。 */
  const HARDCODED_UNIT = /[/／]\s*(hr|調查日|調查時段)/;
  const bad = CONCLUSION_METRICS.filter((metric) =>
    HARDCODED_UNIT.test(metric.label),
  ).map((metric) => `${metric.key}：${metric.label}`);
  assert.deepEqual(
    bad,
    [],
    "這些勾選標籤把單位寫死了（單位要跟著使用者選的時段與該筆涵蓋走）：\n  " +
      bad.join("\n  "),
  );
  /* 前置檢查：真的讀到一批標籤。 */
  assert.ok(
    CONCLUSION_METRICS.length >= 10,
    `只讀到 ${CONCLUSION_METRICS.length} 項指標`,
  );
  /* 反面：樣式真的抓得到已知的舊寫法，否則這一支等於沒在守。 */
  for (const sample of ["各支線駛入流量（PCU/hr）", "全調查時段流量（輛／調查時段）"])
    assert.match(sample, HARDCODED_UNIT, "樣式抓不到舊寫法");
});
