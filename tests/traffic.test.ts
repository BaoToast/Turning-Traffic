import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  ACTIVE_LANE_CLASSES,
  bearingFromAngle,
  canonicalIntersectionKey,
  createDemoRecords,
  DEFAULT_PCE,
  inspectWorkbook,
  inspectWorkbookVariants,
  isSameSurvey,
  normalizeIntersectionName,
  pceFactor,
  qualityIssues,
  referenceMovementForOd,
  resolveSurveyType,
  assertNoPrototypePollution,
  detectPrototypePollution,
  prototypeFingerprint,
  rollingPeak,
  SAFE_XLSX_READ_OPTIONS,
  safeObjectKey,
  stationFromFilename,
} from "../lib/traffic.ts";

test("normalizes filenames without deleting real road names", () => {
  assert.equal(
    normalizeIntersectionName(
      "11017Ｔ１－０４【中山路-國昌路-民強街路口】(修正版)V2.xls",
    ),
    "中山路－國昌路－民強街路口",
  );
  assert.equal(
    normalizeIntersectionName("11017T1-05(台1-台28路口)..xls"),
    "台1－台28路口",
  );
  assert.equal(
    normalizeIntersectionName("15-01-中山北路-岡山路口(七叉路口).xlsx"),
    "中山北路－岡山路口",
  );
  assert.equal(
    normalizeIntersectionName("中山北路－岡山路口七叉路口"),
    "中山北路－岡山路口",
  );
  assert.equal(
    normalizeIntersectionName("T15-02 · 岡山北路-育才路口.xls"),
    "岡山北路－育才路口",
  );
  assert.equal(stationFromFilename("11017T1-03(台1-路科一路口).xls"), "T1-03");
  assert.equal(
    canonicalIntersectionKey("台1－台28路口（湖內區）"),
    canonicalIntersectionKey("台1-台28路口"),
  );
});

test("derives compass bearing from the editable diagram angle", () => {
  assert.equal(bearingFromAngle(0), "東");
  assert.equal(bearingFromAngle(45), "東南");
  assert.equal(bearingFromAngle(90), "南");
  assert.equal(bearingFromAngle(180), "西");
  assert.equal(bearingFromAngle(270), "北");
  assert.equal(bearingFromAngle(-90), "北");
  assert.equal(bearingFromAngle(315), "東北");
});

test("keeps the confirmed T15-01 seven-arm movement classification", () => {
  const name = "中山北路－岡山路口（七岔路口）";
  const arms = ["A", "B", "C", "D", "E", "F", "G"];
  assert.equal(referenceMovementForOd(name, "A", "E", arms), "through");
  assert.equal(referenceMovementForOd(name, "A", "B", arms), "left");
  assert.equal(referenceMovementForOd(name, "A", "G", arms), "right");
  assert.equal(referenceMovementForOd(name, "D", "E", arms), "left");
  assert.equal(referenceMovementForOd(name, "D", "A", arms), "right");
  assert.equal(referenceMovementForOd("其他路口", "A", "E", arms), null);
});

test("does not force the T15-01 table onto other intersections that share the road names", () => {
  // 名稱同時含「中山北路」與「岡山路」但只有四叉，不能套七叉參考表。
  const name = "中山北路／岡山路口";
  assert.equal(referenceMovementForOd(name, "A", "B", ["A", "B", "C", "D"]), null);
  // 支線數對但代碼不是 A~G，也不套用。
  assert.equal(
    referenceMovementForOd(name, "A", "B", ["A", "B", "C", "D", "E", "F", "H"]),
    null,
  );
  // 刪掉一支之後剩六叉，同樣退回幾何推算。
  assert.equal(
    referenceMovementForOd(name, "A", "B", ["A", "B", "C", "D", "E", "F"]),
    null,
  );
});

test("reads side-by-side approach blocks from legacy Excel without mixing time columns", async () => {
  const rows: unknown[][] = Array.from({ length: 10 }, () =>
    Array(56).fill(null),
  );
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  for (let approach = 0; approach < 4; approach++) {
    const base = approach * 14;
    rows[1][base] = "站號：11017T15-99";
    rows[1][base + 4] = "日期：115.05.04 (平日)";
    rows[2][base] = "站名：測試路/驗證路口";
    rows[3][base] = `路口編號：路口${String.fromCharCode(65 + approach)}`;
    rows[4][base] = "時間";
    vehicles.forEach((vehicle, vehicleIndex) => {
      rows[4][base + 1 + vehicleIndex * 3] = vehicle;
      movements.forEach((movement, movementIndex) => {
        rows[5][base + 1 + vehicleIndex * 3 + movementIndex] = movement;
      });
    });
    times.forEach((time, rowIndex) => {
      rows[6 + rowIndex][base] = time;
      for (let column = 1; column <= 12; column++)
        rows[6 + rowIndex][base + column] = 1;
    });
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: 4 }).flatMap((_, approach) =>
    vehicles.map((__, vehicleIndex) => ({
      s: { r: 4, c: approach * 14 + 1 + vehicleIndex * 3 },
      e: { r: 4, c: approach * 14 + 3 + vehicleIndex * 3 },
    })),
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "平日");
  const binary = XLSX.write(workbook, { type: "array", bookType: "biff8" });
  const preview = await inspectWorkbook(
    new File([binary], "11017T15-99-old.xls"),
  );
  assert.equal(preview.layout, "turning");
  assert.deepEqual(preview.approaches, ["A", "B", "C", "D"]);
  assert.equal(preview.columns.length, 48);
  assert.equal(preview.date, "2026-05-04");
  assert.equal(preview.dateSource?.cell, "E2");
  assert.equal(preview.intervals, 4);
  assert.equal(preview.survey?.minutes, 60);
  assert.equal(preview.survey?.values.length, 48);
  assert.ok(preview.survey?.values.every((value) => value === 4));
  assert.deepEqual(
    Object.fromEntries(
      ["motorcycle", "car", "heavy", "special"].map(function (vehicle) {
        return [
          vehicle,
          preview.columns.filter(function (column) {
            return column.vehicle === vehicle;
          }).length,
        ];
      }),
    ),
    { motorcycle: 12, car: 12, heavy: 12, special: 12 },
  );
  assert.ok(
    preview.warnings.some((warning) => warning.includes("Excel 97–2003")),
  );
});

test("selects a continuous four-interval peak and breaks ties early", () => {
  const rows = [
    { start: 420, label: "07:00", values: [10, 10] },
    { start: 435, label: "07:15", values: [20, 20] },
    { start: 450, label: "07:30", values: [30, 30] },
    { start: 465, label: "07:45", values: [40, 40] },
    { start: 480, label: "08:00", values: [10, 10] },
  ];
  const peak = rollingPeak(rows, [360, 720]);
  assert.equal(peak?.start, 420);
  assert.equal(peak?.end, 480);
  assert.equal(peak?.total, 200);
});

test("demo data covers three through seven approaches and four quarters", () => {
  const records = createDemoRecords();
  assert.equal(records.length, 20);
  assert.deepEqual([...new Set(records.map((r) => r.quarter))].length, 4);
  assert.deepEqual(
    [...new Set(records.map((r) => r.approaches.length))].sort(),
    [3, 4, 5, 7],
  );
});

test("keeps the supplied four-vehicle turning-equivalent matrix editable by movement", () => {
  assert.deepEqual(DEFAULT_PCE.special, { left: 2.5, through: 2, right: 2.3 });
  assert.deepEqual(DEFAULT_PCE.motorcycle, {
    left: 0.5,
    through: 0.3,
    right: 0.4,
  });
});

test("uses physical lane classes only for geometry metadata", () => {
  assert.deepEqual(ACTIVE_LANE_CLASSES, [
    "fast",
    "slow",
    "motorcycle",
    "other",
  ]);
});

test("never compares classified vehicles in vehicles/hr with PCU/hr", () => {
  const record = createDemoRecords()[0];
  const movement = record.approaches[0].movements.AM;
  movement.rawVehicleTotal = null;
  movement.vehicle.car = 1;
  assert.equal(
    qualityIssues([record]).some(
      (issue) =>
        issue.category === "車種統計異常" && issue.station === record.station,
    ),
    false,
  );
});

test("does not flag a legitimately high surveyed direction as an anomaly", () => {
  const record = createDemoRecords()[0];
  record.approaches[0].movements.AM.left = 99999;
  assert.equal(
    qualityIssues([record]).some((issue) =>
      String(issue.category).includes("異常流量"),
    ),
    false,
  );
});

test("keeps five source vehicle types distinct in a turning workbook", async () => {
  const vehicleNames = ["機車", "小型車", "大貨車", "大客車", "聯結車"];
  const rows: Array<Array<string | number>> = [
    ["站號：T5-10", "站名：動態車種測試路口"],
    ["時間", ...vehicleNames.flatMap(function (name) { return [name, name, name]; })],
    ["", ...vehicleNames.flatMap(function () { return ["左轉", "直行", "右轉"]; })],
    ...Array.from({ length: 24 }, function (_, hour) {
      return [
        String(hour).padStart(2, "0") + ":00～" + String(hour + 1).padStart(2, "0") + ":00",
        ...Array.from({ length: 15 }, function (_, index) { return hour + index + 1; }),
      ];
    }),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "路口A");
  const file = new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "11000T5-10-動態車種.xlsx");
  const preview = await inspectWorkbook(file, DEFAULT_PCE);
  assert.equal(preview.layout, "turning");
  assert.equal(preview.columns.length, 15);
  assert.deepEqual(preview.detectedVehicles.map(function (item) { return item.label; }), vehicleNames);
  assert.ok(preview.columns.some(function (column) { return column.vehicle === "custom:大貨車"; }));
  assert.ok(preview.columns.some(function (column) { return column.vehicle === "custom:大客車"; }));
  assert.ok(preview.columns.some(function (column) { return column.vehicle === "custom:聯結車"; }));
  assert.equal(pceFactor(DEFAULT_PCE, "custom:大貨車", "through"), 1);
});

test("recognizes a five-vehicle full-day road sheet without inventing turning flows", async () => {
  const rows = [
    ["路段交通量調查表"],
    ["監測日期：115年03月09日(平日)"],
    ["時間", "機車", "小型車", "大貨車", "大客車", "聯結車", "機車", "小型車", "大貨車", "大客車", "聯結車"],
    ...Array.from({ length: 24 }, function (_, hour) {
      return [String(hour).padStart(2, "0") + ":00～" + String(hour + 1).padStart(2, "0") + ":00", ...Array(10).fill(hour + 1)];
    }),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "平日");
  const file = new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "14013T5-10-北林路.xlsx");
  const preview = await inspectWorkbook(file, DEFAULT_PCE);
  assert.equal(preview.layout, "unknown");
  assert.equal(preview.role, "非路口轉向");
  assert.equal(preview.columns.length, 0);
  assert.equal(preview.templateId, "full-day-road-vehicle-v1");
  assert.equal(preview.detectedVehicles.length, 5);
});

test("splits weekday and holiday hourly workbooks into independent previews", async () => {
  const workbook = XLSX.utils.book_new();
  for (const name of ["平日", "假日"]) {
    const rows = [
      ["站號：T15-01", "", "站名：測試路口"],
      ["時間", "機踏車", "", ""],
      ["", "左轉", "直進", "右轉"],
      ...Array.from({ length: 24 }, function (_, hour) {
        return [
          String(hour).padStart(2, "0") + ":00～" + String(hour + 1).padStart(2, "0") + ":00",
          hour === 7 ? 10 : 1,
          hour === 7 ? 20 : 2,
          hour === 7 ? 5 : 1,
        ];
      }),
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const file = new File(
    [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    "T15-01(平、假日).xlsx",
  );
  const previews = await inspectWorkbookVariants(file, DEFAULT_PCE);
  assert.equal(previews.length, 2);
  assert.deepEqual(
    previews.map(function (preview) { return preview.surveyType; }).sort(),
    ["假日", "平日"],
  );
  assert.ok(previews.every(function (preview) { return preview.templateId === "hourly-weekday-holiday-turning-v1"; }));
  assert.ok(previews.every(function (preview) { return preview.am?.end - preview.am?.start === 60; }));
});

/*
 * 重新匯入時的「待設定」接手規則。
 *
 * 使用者實際遇到的情形：原始檔的日期欄位寫著「115年05月04日(平日)」，
 * 系統也讀得出來，但畫面上那一筆仍然是「待設定」——因為那一筆是更早以前
 * 匯入的（當時沒讀到），而重新匯入時比對條件把資料別也算進去，於是新讀出
 * 的「平日」被當成另一份調查，同一路口同一季就同時留著兩筆。
 * 這一組測試把規則釘住。
 */
test("重新匯入：讀出資料別的新檔會接手同站號的「待設定」舊紀錄", () => {
  const ctx = { projectId: "P1", quarter: "115Q2" };
  const old = {
    projectId: "P1",
    quarter: "115Q2",
    station: "T15-01",
    surveyType: "待設定",
  };
  assert.equal(isSameSurvey(old, { station: "T15-01", surveyType: "平日" }, ctx), true);
});

test("重新匯入：已經知道是平日的紀錄，不會被一筆「待設定」覆蓋", () => {
  const ctx = { projectId: "P1", quarter: "115Q2" };
  const known = {
    projectId: "P1",
    quarter: "115Q2",
    station: "T15-01",
    surveyType: "平日",
  };
  assert.equal(isSameSurvey(known, { station: "T15-01", surveyType: "待設定" }, ctx), false);
});

test("重新匯入：平日與假日仍然是兩份不同的調查，不會互相覆蓋", () => {
  const ctx = { projectId: "P1", quarter: "115Q2" };
  const weekday = {
    projectId: "P1",
    quarter: "115Q2",
    station: "T15-01",
    surveyType: "平日",
  };
  assert.equal(isSameSurvey(weekday, { station: "T15-01", surveyType: "假日" }, ctx), false);
  assert.equal(isSameSurvey(weekday, { station: "T15-01", surveyType: "平日" }, ctx), true);
});

test("重新匯入：不同計畫、不同季度、不同站號一律不算同一份", () => {
  const ctx = { projectId: "P1", quarter: "115Q2" };
  const base = {
    projectId: "P1",
    quarter: "115Q2",
    station: "T15-01",
    surveyType: "待設定",
  };
  const item = { station: "T15-01", surveyType: "平日" };
  assert.equal(isSameSurvey({ ...base, projectId: "P2" }, item, ctx), false);
  assert.equal(isSameSurvey({ ...base, quarter: "115Q1" }, item, ctx), false);
  assert.equal(isSameSurvey({ ...base, station: "T15-02" }, item, ctx), false);
});

/*
 * 資料別（平日／假日）要從哪裡讀。
 *
 * 使用者實際遇到的檔案：日期欄是「日期：115年04月15日」（**沒有括號**），
 * 但交通量工作表就叫「平日」——資訊明明在檔案裡，舊版卻判成「待設定」，
 * 因為工作表名稱以前只在「同時有平日與假日兩張」時才會被採用。
 */
test("資料別：日期括號優先", () => {
  assert.equal(
    resolveSurveyType({ dateText: "日期：115年05月04日(平日)", sheetNames: ["假日"] }),
    "平日",
  );
  assert.equal(
    resolveSurveyType({ dateText: "日期：115年05月04日（假日）" }),
    "假日",
  );
});

test("資料別：日期沒寫括號時，改用工作表名稱（只有一張平日或假日）", () => {
  assert.equal(
    resolveSurveyType({
      dateText: "日期：115年04月15日",
      sheetNames: ["平日"],
    }),
    "平日",
  );
  /* 工作表名稱帶全形空白或尾隨空白也要認得 */
  assert.equal(
    resolveSurveyType({ dateText: "日期：115年04月15日", sheetNames: ["假日 "] }),
    "假日",
  );
});

test("資料別：同時有平日與假日兩張時不猜，交給逐張匯入那條路徑", () => {
  assert.equal(
    resolveSurveyType({
      dateText: "日期：115年04月15日",
      sheetNames: ["平日", "假日"],
    }),
    "待設定",
  );
  /* 那條路徑會直接指定，指定的最優先 */
  assert.equal(
    resolveSurveyType({
      explicit: "假日",
      dateText: "日期：115年04月15日(平日)",
      sheetNames: ["平日", "假日"],
    }),
    "假日",
  );
});

test("資料別：三個地方都讀不到才是「待設定」", () => {
  assert.equal(
    resolveSurveyType({ dateText: "日期：115年04月15日", sheetNames: ["路口A", "路口B"] }),
    "待設定",
  );
  assert.equal(resolveSurveyType({}), "待設定");
});

/*
 * 站號沒有分隔符號時要怎麼切。
 *
 * 實際案例：檔案裡寫「站號：06525T2503」（沒有連字號）。
 * 舊版用貪婪的兩組 (\d+)(\d+) 去切，第一組盡量吃，於是切成「T250-03」；
 * 慣例是後兩碼為子編號，正確答案是 T25-03。
 */
test("站號：有分隔符號時照它切", () => {
  assert.equal(stationFromFilename("06525T25-01嘉45縣167路口.xlsx"), "T25-01");
  assert.equal(stationFromFilename("11017T15-99測試.xls"), "T15-99");
  assert.equal(stationFromFilename("T15_04"), "T15-04");
  assert.equal(stationFromFilename("T15.04"), "T15-04");
});

test("站號：沒有分隔符號時取後兩碼當子編號", () => {
  assert.equal(stationFromFilename("06525T2503嘉45縣168路口.xlsx"), "T25-03");
  assert.equal(stationFromFilename("站號：06525T2503"), "T25-03");
  assert.equal(stationFromFilename("120507T501縣142彰鹿路.xls"), "T5-01");
});

test("站號：完全讀不到時給穩定的替代值，同一個名稱永遠得到同一個", () => {
  const first = stationFromFilename("沒有站號的檔名.xlsx");
  assert.match(first, /^S-\d+$/);
  assert.equal(stationFromFilename("沒有站號的檔名.xlsx"), first);
});

/*
 * ── 尖峰視窗的頭和尾都要落在時段內 ──
 *
 * 舊版只檢查起點（row.start < range[1]），視窗卻是 start 到 start+60，
 * 於是上午尖峰 [05:00, 12:00) 可以挑到 11:45 起算的 11:45–12:45——
 * 一個大半在下午的視窗被標成「上午尖峰」，而且和下午尖峰挑到的
 * 12:00–13:00 重疊 45 分鐘，同一批車被算進兩個尖峰。
 */
function minuteRows(fromMinutes: number, toMinutes: number, heavy: [number, number]) {
  const rows = [];
  for (let m = fromMinutes; m < toMinutes; m += 15)
    rows.push({
      start: m,
      label: "",
      values: [m >= heavy[0] && m < heavy[1] ? 1000 : 10],
      sourceRows: {},
    });
  return rows as never[];
}

test("上午尖峰不會挑到跨越中午的視窗，也不會和下午尖峰重疊", () => {
  const rows = minuteRows(9 * 60, 13 * 60, [11 * 60 + 45, 12 * 60 + 45]);
  const am = rollingPeak(rows, [5 * 60, 12 * 60], 15);
  const pm = rollingPeak(rows, [12 * 60, 23 * 60], 15);
  assert.ok(am, "上午應該還是挑得到視窗");
  assert.ok(am!.end <= 12 * 60, `上午尖峰跨過中午：${am!.start}–${am!.end}`);
  assert.ok(pm, "下午應該挑得到視窗");
  assert.ok(pm!.start >= 12 * 60);
  assert.ok(am!.end <= pm!.start, "上午與下午尖峰不可以重疊");
});

test("下午尖峰的視窗不會超過上界（23:00）", () => {
  const rows = minuteRows(21 * 60, 24 * 60, [22 * 60 + 45, 24 * 60]);
  const pm = rollingPeak(rows, [12 * 60, 23 * 60], 15);
  assert.ok(pm, "應該還是挑得到視窗");
  assert.ok(pm!.end <= 23 * 60, `視窗超出 23:00：${pm!.start}–${pm!.end}`);
});

/*
 * ── 時間欄的容錯：全形數字與冒號旁空白 ──
 * 時間欄認不出來就找不到資料起始列，整張工作表會讀成 0 筆，
 * 而且整體不會報錯，只是那個路口的量憑空消失。
 */
function turningSheet(options: {
  timeText: (row: number) => string;
  vehicles?: string[];
}) {
  const vehicles = options.vehicles ?? ["機車", "小型車", "大型車", "特種車"];
  const stride = vehicles.length * 3 + 2;
  const rows: unknown[][] = Array.from({ length: 10 }, () =>
    Array(stride * 4 + 4).fill(null),
  );
  const movements = ["左轉", "直進", "右轉"];
  for (let approach = 0; approach < 4; approach++) {
    const base = approach * stride;
    rows[1][base] = "站號：11017T15-99";
    rows[1][base + 4] = "日期：115.05.04 (平日)";
    rows[2][base] = "站名：測試路/驗證路口";
    rows[3][base] = `路口編號：路口${String.fromCharCode(65 + approach)}`;
    rows[4][base] = "時間";
    vehicles.forEach(function (vehicle, vehicleIndex) {
      rows[4][base + 1 + vehicleIndex * 3] = vehicle;
      movements.forEach(function (movement, movementIndex) {
        rows[5][base + 1 + vehicleIndex * 3 + movementIndex] = movement;
      });
    });
    for (let row = 0; row < 4; row++) {
      rows[6 + row][base] = options.timeText(row);
      for (let column = 1; column <= vehicles.length * 3; column++)
        rows[6 + row][base + column] = 2;
    }
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
    "11017T15-99.xlsx",
  );
}

const halfWidthTime = (row: number) =>
  `07:${String(row * 15).padStart(2, "0")}~07:${String((row + 1) * 15).padStart(2, "0")}`;
const toFullWidth = (text: string) =>
  text
    .replace(/[0-9]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xfee0))
    .replace(/:/g, "：")
    .replace(/~/g, "～");

test("時間欄用全形數字或冒號旁有空白時，整張表仍讀得到（不會變成 0 筆）", async () => {
  for (const [label, timeText] of [
    ["半形", halfWidthTime],
    ["全形數字與全形冒號", (row: number) => toFullWidth(halfWidthTime(row))],
    ["冒號兩側有空白", (row: number) => halfWidthTime(row).replace(/:/g, " : ")],
  ] as const) {
    const preview = await inspectWorkbook(turningSheet({ timeText }), DEFAULT_PCE);
    assert.equal(preview.intervals, 4, `${label}：整張表讀成 0 筆`);
    assert.equal(preview.columns.length, 48, label);
    assert.ok(preview.am, `${label}：找不到上午尖峰`);
  }
});

/*
 * ── 不在內建關鍵字裡的車種不可以被無聲略過 ──
 * 舊版 vehicleFromHeader 認不得就回 null，呼叫端直接 continue，
 * 「自行車」那幾欄的量會憑空消失，總量少掉而且沒有任何提示，
 * 與「可讀取任意數量車種」的說明不符。
 */
test("新車種（自行車）會被收成自訂車種，不會被無聲丟掉", async () => {
  const preview = await inspectWorkbook(
    turningSheet({
      timeText: halfWidthTime,
      vehicles: ["機車", "小型車", "大型車", "特種車", "自行車"],
    }),
    DEFAULT_PCE,
  );
  assert.equal(preview.columns.length, 60, "4 個路口 × 5 車種 × 3 轉向");
  const labels = [...new Set(preview.columns.map((column) => column.vehicleLabel))];
  assert.ok(labels.includes("自行車"), labels.join("、"));
  assert.ok(
    preview.detectedVehicles.some((vehicle) => vehicle.label === "自行車"),
    "匯入預覽要列出這個新車種，才不會是無聲新增",
  );
});

test("合計、備註、時間這類欄名不會被誤收成車種", async () => {
  const preview = await inspectWorkbook(
    turningSheet({
      timeText: halfWidthTime,
      vehicles: ["機車", "小型車", "合計", "備註"],
    }),
    DEFAULT_PCE,
  );
  const labels = [...new Set(preview.columns.map((column) => column.vehicleLabel))];
  assert.ok(!labels.includes("合計"), labels.join("、"));
  assert.ok(!labels.includes("備註"), labels.join("、"));
});

/*
 * ── 尖峰「小時」只能由能精確組成 60 分鐘的格距算出來 ──
 *
 * 15／20／30／60 分鐘可以；45 或 120 分鐘不行。後兩者若硬取一格再標成
 * PCU/hr，等於把 45 分鐘或 2 小時的量冒充成一小時的流率——數字看起來很正常，
 * 比顯示「資料不足」危險得多。這是外部複核指出的，採用較保守的作法。
 */
test("能整除 60 的格距照常算出尖峰小時", () => {
  for (const gap of [15, 20, 30, 60]) {
    const rows = [];
    for (let m = 7 * 60; m < 11 * 60; m += gap)
      rows.push({ start: m, label: "", values: [m === 8 * 60 ? 500 : 10], sourceRows: {} });
    const peak = rollingPeak(rows as never[], [5 * 60, 12 * 60], gap);
    assert.ok(peak, `${gap} 分鐘一格應該算得出尖峰小時`);
    assert.equal(peak!.end - peak!.start, 60, `${gap} 分鐘：視窗必須正好一小時`);
  }
});

test("組不成一小時的格距（45、120 分鐘）回報資料不足，不冒充成一小時", () => {
  for (const gap of [45, 120]) {
    const rows = [];
    for (let m = 7 * 60; m < 13 * 60; m += gap)
      rows.push({ start: m, label: "", values: [100], sourceRows: {} });
    const peak = rollingPeak(rows as never[], [5 * 60, 12 * 60], gap);
    assert.equal(
      peak,
      null,
      `${gap} 分鐘一格不能算成尖峰小時，否則會把 ${gap} 分鐘的量標成 PCU/hr`,
    );
  }
});

/*
 * ── 檔案裡來的字串不可以污染 Object.prototype ──
 *
 * 工作表名稱直接來自使用者上傳的檔案，而程式有好幾處是
 * `object[名稱] = 值`。一個工作表如果真的叫 `__proto__`，那一行就會改寫到
 * Object.prototype，之後全站每一個物件都會多出那個屬性。
 * 這同時也是對 xlsx（SheetJS 0.18.5）已知原型污染警示的一層自我防禦。
 */
test("safeObjectKey 擋掉 __proto__、constructor、prototype", () => {
  assert.equal(safeObjectKey("平日"), "平日");
  assert.equal(safeObjectKey("路口A"), "路口A");
  assert.notEqual(safeObjectKey("__proto__"), "__proto__");
  assert.notEqual(safeObjectKey("constructor"), "constructor");
  assert.notEqual(safeObjectKey("prototype"), "prototype");
});

test("工作表叫 __proto__ 的檔案不會污染 Object.prototype", async () => {
  const before = Object.keys(Object.prototype).length;
  const rows: unknown[][] = Array.from({ length: 10 }, () => Array(20).fill(null));
  rows[1][0] = "站號：11017T15-99";
  rows[1][4] = "日期：115.05.04 (平日)";
  rows[2][0] = "站名：測試路/驗證路口";
  rows[3][0] = "路口編號：路口A";
  rows[4][0] = "時間";
  ["機車", "小型車", "大型車", "特種車"].forEach(function (vehicle, index) {
    rows[4][1 + index * 3] = vehicle;
    ["左轉", "直進", "右轉"].forEach(function (movement, offset) {
      rows[5][1 + index * 3 + offset] = movement;
    });
  });
  for (let row = 0; row < 4; row += 1) {
    rows[6 + row][0] = `07:${String(row * 15).padStart(2, "0")}~07:${String((row + 1) * 15).padStart(2, "0")}`;
    for (let column = 1; column <= 12; column += 1) rows[6 + row][column] = 1;
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = ["機車", "小型車", "大型車", "特種車"].map(function (_, index) {
    return { s: { r: 4, c: 1 + index * 3 }, e: { r: 4, c: 3 + index * 3 } };
  });
  const workbook = XLSX.utils.book_new();
  /* 工作表就叫 __proto__ */
  XLSX.utils.book_append_sheet(workbook, sheet, "__proto__");
  await inspectWorkbook(
    new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "T15-99.xlsx"),
    DEFAULT_PCE,
  );
  assert.equal(
    Object.keys(Object.prototype).length,
    before,
    "Object.prototype 被加上了新屬性——原型污染",
  );
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

/*
 * ── xlsx 上游安全警示的防禦措施 ──
 * npm 上的 xlsx 停在 0.18.5，沒有修好的版本可以升。這三項測試釘住
 * 我們自己這一層做了什麼：關掉用不到的解析路徑、偵測到污染就中止匯入。
 */
test("解析選項關掉了公式、內嵌 HTML 與 VBA", () => {
  assert.equal(SAFE_XLSX_READ_OPTIONS.cellFormula, false);
  assert.equal(SAFE_XLSX_READ_OPTIONS.cellHTML, false);
  assert.equal(SAFE_XLSX_READ_OPTIONS.bookVBA, false);
  /* 儲存格日期還是要留著，不然時間欄會整批讀成序號 */
  assert.equal(SAFE_XLSX_READ_OPTIONS.cellDates, true);
});

test("原型被污染時會被抓出來、清乾淨並中止", () => {
  const before = prototypeFingerprint();
  Object.defineProperty(Object.prototype, "__e2eInjected", {
    value: 1,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  assert.throws(
    () => assertNoPrototypePollution(before, "惡意檔案.xlsx"),
    /惡意檔案\.xlsx/,
    "被污染時必須中止匯入並指出是哪一個檔案",
  );
  assert.equal(
    (Object.prototype as unknown as Record<string, unknown>).__e2eInjected,
    undefined,
    "偵測到之後要把多出來的屬性刪掉",
  );
  assert.deepEqual(prototypeFingerprint(), before);
});

test("沒有被污染時什麼都不做", () => {
  const before = prototypeFingerprint();
  assert.deepEqual(detectPrototypePollution(before), []);
  assert.doesNotThrow(() => assertNoPrototypePollution(before, "正常檔案.xlsx"));
});
