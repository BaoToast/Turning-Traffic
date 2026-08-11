import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { canonicalIntersectionKey, computeVC, createDemoRecords, DEFAULT_PCE, inspectWorkbook, normalizeIntersectionName, qualityIssues, rollingPeak, stationFromFilename } from "../lib/traffic.ts";

test("normalizes filenames without deleting real road names", () => {
  assert.equal(normalizeIntersectionName("11017Ｔ１－０４【中山路-國昌路-民強街路口】(修正版)V2.xls"), "中山路－國昌路－民強街路口");
  assert.equal(normalizeIntersectionName("11017T1-05(台1-台28路口)..xls"), "台1－台28路口");
  assert.equal(stationFromFilename("11017T1-03(台1-路科一路口).xls"), "T1-03");
  assert.equal(canonicalIntersectionKey("台1－台28路口（湖內區）"), canonicalIntersectionKey("台1-台28路口"));
});

test("reads side-by-side approach blocks from legacy Excel without mixing time columns", async () => {
  const rows: unknown[][] = Array.from({ length: 10 }, () => Array(56).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  for (let approach = 0; approach < 4; approach++) {
    const base = approach * 14;
    rows[1][base] = "站號：11017T15-99";
    rows[1][base + 4] = "日期：115年05月04日(平日)";
    rows[2][base] = "站名：測試路/驗證路口";
    rows[3][base] = `路口編號：路口${String.fromCharCode(65 + approach)}`;
    rows[4][base] = "時間";
    vehicles.forEach((vehicle, vehicleIndex) => {
      rows[4][base + 1 + vehicleIndex * 3] = vehicle;
      movements.forEach((movement, movementIndex) => { rows[5][base + 1 + vehicleIndex * 3 + movementIndex] = movement; });
    });
    times.forEach((time, rowIndex) => {
      rows[6 + rowIndex][base] = time;
      for (let column = 1; column <= 12; column++) rows[6 + rowIndex][base + column] = 1;
    });
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: 4 }).flatMap((_, approach) => vehicles.map((__, vehicleIndex) => ({ s: { r: 4, c: approach * 14 + 1 + vehicleIndex * 3 }, e: { r: 4, c: approach * 14 + 3 + vehicleIndex * 3 } })));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "平日");
  const binary = XLSX.write(workbook, { type: "array", bookType: "biff8" });
  const preview = await inspectWorkbook(new File([binary], "11017T15-99-old.xls"));
  assert.equal(preview.layout, "turning");
  assert.deepEqual(preview.approaches, ["A", "B", "C", "D"]);
  assert.equal(preview.columns.length, 48);
  assert.equal(preview.date, "2026-05-04");
  assert.equal(preview.intervals, 4);
  assert.ok(preview.warnings.some((warning) => warning.includes("Excel 97–2003")));
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
  assert.deepEqual([...new Set(records.map((r) => r.approaches.length))].sort(), [3, 4, 5, 7]);
});

test("keeps the supplied four-vehicle turning-equivalent matrix editable by movement", () => {
  assert.deepEqual(DEFAULT_PCE.special, { left: 2.5, through: 2, right: 2.3 });
  assert.deepEqual(DEFAULT_PCE.motorcycle, { left: 0.5, through: 0.3, right: 0.4 });
});

test("calculates lane capacity from saturation flow and effective green ratio", () => {
  const record = createDemoRecords()[0];
  for (const approach of record.approaches) {
    approach.saturationFlow = 1800;
    approach.effectiveGreen = 45;
    approach.cycleLength = 90;
  }
  const result = computeVC(record, "AM");
  assert.equal(result.calculable, true);
  assert.equal(result.rows[0].capacity, 1800);
});

test("never compares classified vehicles in vehicles/hr with PCU/hr", () => {
  const record = createDemoRecords()[0];
  const movement = record.approaches[0].movements.AM;
  movement.rawVehicleTotal = null;
  movement.vehicle.car = 1;
  assert.equal(qualityIssues([record]).some((issue) => issue.category === "車種統計異常" && issue.station === record.station), false);
});
