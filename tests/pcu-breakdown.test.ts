import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PCE,
  totalMovement,
  emptyScopeMovements,
  emptyScopeVolumes,
  pcuBreakdown,
  type TrafficRecord,
} from "../lib/traffic.ts";

test("單一車種 PCU 必須使用實際 OD 轉向，不能用總 PCU 比例反推", () => {
  const movements = emptyScopeMovements();
  movements.AM = {
    left: 5,
    through: 10,
    right: 0,
    vehicle: { motorcycle: 10, car: 10 },
    rawVehicleTotal: 20,
  };
  const approach = {
    id: "A",
    name: "路口A",
    bearing: "東",
    angle: 0,
    lanes: null,
    capacity: null,
    movements,
  };
  const left = emptyScopeVolumes();
  left.AM = { pcu: 5, vehicle: { motorcycle: 10 } };
  const through = emptyScopeVolumes();
  through.AM = { pcu: 10, vehicle: { car: 10 } };
  const record = {
    id: "pcu-breakdown",
    station: "S01",
    name: "測試路口",
    rawName: "test.xlsx",
    quarter: "115Q1",
    date: "2026-01-01",
    surveyType: "平日",
    pceUsed: DEFAULT_PCE,
    peaks: {
      AM: { start: "07:00", end: "08:00" },
      PM: { start: "17:00", end: "18:00" },
      DAY: { start: "", end: "" },
    },
    approaches: [approach],
    routes: [
      {
        id: "A-B",
        fromApproachId: "A",
        toApproachId: "B",
        movement: "left",
        volumes: left,
      },
      {
        id: "A-C",
        fromApproachId: "A",
        toApproachId: "C",
        movement: "through",
        volumes: through,
      },
    ],
    sourceFiles: [],
    importedAt: "2026-01-01T00:00:00Z",
    validation: { referenceFound: false, matchRate: null, notes: [] },
  } as unknown as TrafficRecord;

  const result = pcuBreakdown(record, approach, "AM");
  assert.equal(result.perVehicle.motorcycle.pcu, 5);
  assert.equal(result.perVehicle.car.pcu, 10);
  assert.equal(result.derivedPcu, 15);
  assert.equal(result.storedPcu, 15);
  assert.equal(result.reconciled, true);
});

/*
 * ── 車輛數必須與轉向圖同源（v2.1.36）──────────────────────────
 *
 * v2.1.35 把 count 也改成從 OD 逐筆加總。PCU 那一半是對的，但車輛數這一半
 * 讓摘要與轉向圖分成兩個來源：轉向圖讀的是 row.vehicle[id]
 *（totalMovement(approach, scope, undefined, id) 就是它），而 AM／PM／全日尖峰
 * 的 row.vehicle 是匯入時由尖峰視窗算的、syncRouteTotals 刻意不重建
 *（重建會蓋掉使用者在核對工作台改過的值）。兩者本來就可能不一樣，
 * 而既有的「車種統計異常」品質檢查還容許 5% 落差不報警——落在那個範圍裡，
 * 圖顯示一個數字、摘要顯示另一個，兩邊都不吭聲。正是這一版要防的事。
 */
function divergentRecord() {
  const movements = emptyScopeMovements();
  /* 使用者在核對工作台把機車從 10 改成 12：row.vehicle 與 OD 加總不一致。 */
  movements.AM = {
    left: 5,
    through: 10,
    right: 0,
    vehicle: { motorcycle: 12, car: 10 },
    rawVehicleTotal: 22,
  };
  const approach = {
    id: "A",
    name: "路口A",
    bearing: "東",
    angle: 0,
    lanes: null,
    capacity: null,
    movements,
  };
  const left = emptyScopeVolumes();
  left.AM = { pcu: 5, vehicle: { motorcycle: 10 } };
  const through = emptyScopeVolumes();
  through.AM = { pcu: 10, vehicle: { car: 10 } };
  const record = {
    id: "divergent",
    station: "S01",
    name: "測試路口",
    rawName: "test.xlsx",
    quarter: "115Q1",
    date: "2026-01-01",
    surveyType: "平日",
    pceUsed: DEFAULT_PCE,
    peaks: {
      AM: { start: "07:00", end: "08:00" },
      PM: { start: "17:00", end: "18:00" },
      DAY: { start: "", end: "" },
    },
    approaches: [approach],
    routes: [
      { id: "A-B", fromApproachId: "A", toApproachId: "B", movement: "left", volumes: left },
      { id: "A-C", fromApproachId: "A", toApproachId: "C", movement: "through", volumes: through },
    ],
    sourceFiles: [],
    importedAt: "2026-01-01T00:00:00Z",
    validation: { referenceFound: false, matchRate: null, notes: [] },
  } as unknown as TrafficRecord;
  return { record, approach };
}

test("摘要的車輛數必須與轉向圖同源（row.vehicle），不可改用 OD 加總", () => {
  const { record, approach } = divergentRecord();
  const breakdown = pcuBreakdown(record, approach, "AM");
  /* 轉向圖在車輛數模式讀的就是這一支。 */
  const diagram = totalMovement(approach, "AM", undefined, "motorcycle", record.routes);
  assert.equal(diagram, 12, "前提：轉向圖讀到的是 row.vehicle 的 12");
  assert.equal(
    breakdown.perVehicle.motorcycle.count,
    diagram,
    "摘要與轉向圖的車輛數必須相同，否則畫面上又會各說各話",
  );
});

test("車輛數與流向差很多時要講出來，不可以默默顯示", () => {
  const { record, approach } = divergentRecord();
  /* 差距要超過既有「車種統計異常」的門檻（5 輛或 5%）才算對不起來。 */
  approach.movements.AM.vehicle = { motorcycle: 30, car: 10 };
  approach.movements.AM.rawVehicleTotal = 40;
  const breakdown = pcuBreakdown(record, approach, "AM");
  assert.equal(breakdown.reconciled, false);
  assert.match(breakdown.reason, /車輛數/);
});

test("小幅落差沿用既有品質門檻，不另外發明第三套標準、也不濫報", () => {
  const { record, approach } = divergentRecord();
  /* 12 vs 10 差 2 輛，在既有的「5 輛或 5%」容差內：不該跳警告。 */
  const breakdown = pcuBreakdown(record, approach, "AM");
  assert.equal(breakdown.reconciled, true);
  /* 但車輛數仍然必須與轉向圖同源。 */
  assert.equal(breakdown.perVehicle.motorcycle.count, 12);
});

test("PCU 仍照實際 OD 加總，不受車輛數來源改變影響", () => {
  const { record, approach } = divergentRecord();
  const breakdown = pcuBreakdown(record, approach, "AM");
  /* 機車 10 輛左轉 × 0.5＝5.0（不是 12 輛 × 0.5＝6.0）。 */
  assert.equal(breakdown.perVehicle.motorcycle.pcu, 5);
  assert.equal(breakdown.perVehicle.car.pcu, 10);
});

test("一致時不可以誤報警告", () => {
  const { record, approach } = divergentRecord();
  /* 把 row.vehicle 改回與 OD 一致。 */
  approach.movements.AM.vehicle = { motorcycle: 10, car: 10 };
  approach.movements.AM.rawVehicleTotal = 20;
  const breakdown = pcuBreakdown(record, approach, "AM");
  assert.equal(breakdown.reconciled, true);
  assert.equal(breakdown.reason, "");
});

test("各車種差異互相抵銷時仍要警告，不能只核對全部車種總數", () => {
  const { record, approach } = divergentRecord();
  /*
   * row 與 OD 都是 20 輛，但機車／小型車各差 7 輛，總數剛好互相抵銷。
   * 儲存 PCU 仍與 OD 推導值相同；若只核對總車數與總 PCU，會誤判為一致。
   */
  approach.movements.AM.vehicle = { motorcycle: 17, car: 3 };
  approach.movements.AM.rawVehicleTotal = 20;
  const breakdown = pcuBreakdown(record, approach, "AM");
  assert.equal(breakdown.routeCountTotal, 20);
  assert.equal(breakdown.rowCountTotal, 20);
  assert.equal(breakdown.derivedPcu, breakdown.storedPcu);
  assert.equal(breakdown.reconciled, false);
  assert.match(breakdown.reason, /機車|motorcycle|各車種/);
});
