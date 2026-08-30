import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PCE,
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
