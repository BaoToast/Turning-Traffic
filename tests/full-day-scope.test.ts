import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import {
  DEFAULT_PCE,
  PEAK_KEYS,
  PEAK_RANGES,
  SCOPE_KEYS,
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

test("24 小時的調查才算得出全日尖峰小時", async () => {
  /* 尖峰刻意放在凌晨 03:00：舊的上午範圍 [05:00, 12:00) 掃不到那裡。 */
  const preview = await inspectWorkbook(
    fullDayWorkbook({ countAt: (hour) => (hour === 3 ? 100 : 1) }),
    DEFAULT_PCE,
  );
  assert.equal(preview.survey?.minutes, 24 * 60, "應該讀成 24 小時");
  assert.ok(preview.peakWindows.DAY, "24 小時的調查一定要有全日尖峰小時");
  assert.equal(
    preview.peakWindows.DAY?.start,
    3 * 60,
    "全日尖峰要挑到 03:00 那一小時",
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

test("不足 24 小時的調查沒有全日尖峰小時，也不拿尖峰充數", async () => {
  /*
   * 使用者實際的檔案就是這個形狀：07:00–09:00 與 17:00–19:00，合計 4 小時。
   * 若照樣算「全日尖峰」，算出來一定等於上午與下午尖峰裡較大的那一個。
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
  assert.equal(
    preview.peakWindows.DAY,
    null,
    "只做了 4 小時卻報出全日尖峰，等於用 4 小時的樣本冒充一整天的最大值",
  );
  assert.ok(preview.peakWindows.AM, "上午尖峰仍然要算得出來");
  assert.ok(preview.peakWindows.PM, "下午尖峰仍然要算得出來");
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

test("peakWindowsFor 是唯一的尖峰挑選入口，且吃 surveyMinutes 這道門檻", () => {
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
  /* 同一批資料，只要宣告調查時數不足一天，DAY 就必須是 null。 */
  const partial = peakWindowsFor(rows, 60, undefined, 4 * 60);
  assert.equal(partial.DAY, null);
  assert.equal(partial.AM?.start, 2 * 60, "上午尖峰不受 24 小時門檻影響");
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

  /* (1) 只做了 4 小時 */
  base.survey = { intervals: 16, minutes: 4 * 60, vehicle: {} };
  assert.match(fullDayUnavailableReason(base, "FULL") ?? "", /不足 24 小時/);
  assert.match(fullDayUnavailableReason(base, "DAY") ?? "", /不足 24 小時/);
  assert.equal(formatSurveyHours(base), "4 小時");

  /* (2) 有 24 小時，但沒有全日尖峰＝舊版匯入的資料 */
  base.survey = { intervals: 24, minutes: 24 * 60, vehicle: {} };
  assert.equal(
    fullDayUnavailableReason(base, "FULL"),
    null,
    "全日時段是從已存的調查總量算的，舊資料也該有",
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

test("單位跟著統計範圍走，全日時段不可以標成每小時", () => {
  assert.equal(scopeUnit("AM"), "PCU/hr");
  assert.equal(scopeUnit("PM", "vehicle"), "輛/hr");
  assert.equal(scopeUnit("DAY"), "PCU/hr");
  assert.equal(scopeUnit("DAY", "vehicle"), "輛/hr");
  /* 全日時段是一整天的累計，不是流率。 */
  assert.equal(scopeUnit("FULL"), "PCU/調查日");
  assert.equal(scopeUnit("FULL", "vehicle"), "輛/調查日");
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
  assert.match(appSource, /const unit = scopeUnit\(peak, valueKind\);/);
  assert.doesNotMatch(appSource, /const countMode = mode === "count";/);
  /* 摘要的單位與值也必須走同一組判斷，不可以再寫死 PCU/hr。 */
  const summaryBlock = appSource.slice(
    appSource.indexOf("const summary = useMemo("),
    appSource.indexOf("const geometrySchematicHtml = useMemo("),
  );
  assert.match(summaryBlock, /displayValueKind\(displayMode\)/);
  assert.match(summaryBlock, /scopeUnit\(peak, kind\)/);
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

test("歷季趨勢整體模式完整呈現 AM、PM 與全日尖峰", () => {
  /*
   * v2.1.30 原稿已把 DAY 畫進折線，卻沒有圖例、獨立顏色和右側摘要，
   * 結果是一條無法辨識且與 PM 同色的線。整體模式的各部位必須一起跟著
   * PEAK_KEYS 產生。
   */
  assert.match(appSource, /DAY: "#1d4ed8"/);
  assert.match(appSource, /PEAK_KEYS\.map\(function \(key, index\)/);
  assert.match(appSource, /const summaries = trendPeaks\.map/);
  assert.match(appSource, /"AM／PM／全日尖峰整體"/);
  assert.match(appSource, /"AM_PM_DAY"/);
  assert.doesNotMatch(
    appSource,
    /color: peak === "AM" \? "#087f75" : "#d97706"/,
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
