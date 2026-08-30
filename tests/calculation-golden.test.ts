/*
 * ── 計算口徑的黃金值鎖 ──
 *
 * 這個專案最重要的一條原則是「不得變更既有計算口徑」，但在此之前**沒有任何
 * 測試在守它**——每次改版都靠人工比對外部腳本，改動者一旦忘了比，就沒有防線。
 *
 * 這支測試把一份固定輸入的解析結果整個鎖起來：逐格車輛數、尖峰視窗的起訖與
 * 總 PCU、逐車種數量。任何改動只要動到計算，這裡就會紅。
 *
 * 值是從 v2.1.37（本次修改的基準版）實測產生的。若日後**刻意**要調整計算
 * 口徑，請連同 `LAST_CALC_CHANGE_VERSION` 一起更新，不要只把數字改掉。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectWorkbook, DEFAULT_PCE, pceFactor, roundedPcu } from "../lib/traffic.ts";
import XLSX from "xlsx";

/**
 * 固定輸入：四叉路口、15 分鐘時距、07:00–09:00 共 8 個時距。
 * 每個支線每個車種每個轉向的值刻意各不相同，這樣任何一格算錯都會反映在總數上。
 */
function goldenFile() {
  const rows: unknown[][] = Array.from({ length: 20 }, () => Array(60).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  for (let approach = 0; approach < 4; approach++) {
    const base = approach * 14;
    rows[1][base] = "站號：11017T99-01";
    rows[1][base + 4] = "日期：115年01月26日 (平日)";
    rows[2][base] = "站名：黃金值－驗證路口";
    rows[3][base] = `路口編號：路口${String.fromCharCode(65 + approach)}`;
    rows[4][base] = "時間";
    vehicles.forEach((vehicle, vi) => {
      rows[4][base + 1 + vi * 3] = vehicle;
      movements.forEach((mv, mi) => {
        rows[5][base + 1 + vi * 3 + mi] = mv;
      });
    });
    for (let slot = 0; slot < 8; slot++) {
      const minutes = 7 * 60 + slot * 15;
      const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
      const mm = String(minutes % 60).padStart(2, "0");
      const eh = String(Math.floor((minutes + 15) / 60)).padStart(2, "0");
      const em = String((minutes + 15) % 60).padStart(2, "0");
      rows[6 + slot][base] = `${hh}:${mm}~${eh}:${em}`;
      for (let column = 1; column <= 12; column++)
        /* 每一格都不一樣：支線、欄位、時距三者都影響數值 */
        rows[6 + slot][base + column] = approach * 7 + column * 3 + slot;
    }
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: 4 }).flatMap((_, approach) =>
    vehicles.map((__, vi) => ({
      s: { r: 4, c: approach * 14 + 1 + vi * 3 },
      e: { r: 4, c: approach * 14 + 3 + vi * 3 },
    })),
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "平日");
  return new File(
    [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    "黃金值_驗證路口.xlsx",
  );
}

test("黃金值：逐車種車輛數與尖峰 PCU 必須與 v2.1.37 完全相同", async () => {
  const preview = await inspectWorkbook(goldenFile());

  /* 一、逐車種車輛總數 */
  const byVehicle: Record<string, number> = {};
  for (const column of preview.columns) {
    let sum = 0;
    for (const row of preview.intervalRows!)
      sum += Number(row.values[column.valueIndex] || 0);
    byVehicle[column.vehicle] = (byVehicle[column.vehicle] || 0) + sum;
  }
  assert.deepEqual(
    byVehicle,
    { motorcycle: 1920, car: 2784, heavy: 3648, special: 4512 },
    "逐車種車輛數變了——除非是刻意調整計算口徑，否則這是回歸",
  );

  /* 二、尖峰視窗的起訖與總量 */
  const am = preview.peakWindows.AM!;
  /* 值是從 v2.1.37 實測得到的，不是推算的 */
  assert.equal(am.start, 8 * 60, "AM 尖峰起點（08:00）");
  assert.equal(am.end, 9 * 60, "AM 尖峰終點（09:00）");
  assert.equal(roundedPcu(am.total), 11312, "AM 尖峰總 PCU");

  /* 三、PCU 必須等於「逐格車輛數 × 該車種該轉向的當量」 */
  let hand = 0;
  for (const column of preview.columns)
    hand +=
      Number(am.values[column.valueIndex] || 0) *
      pceFactor(DEFAULT_PCE, column.vehicle, column.movement || "through");
  assert.equal(
    roundedPcu(hand),
    roundedPcu(am.total),
    "系統算的 PCU 與逐格手算對不起來",
  );

  /* 四、四捨五入的口徑：每一格先取整再進入後續計算 */
  for (const row of preview.intervalRows!)
    for (const value of row.values)
      assert.equal(value, Math.round(value), "每一格都應該已經是整數");
});
