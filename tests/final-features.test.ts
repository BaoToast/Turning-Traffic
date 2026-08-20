import test from "node:test";
import assert from "node:assert/strict";
import { branchBalance, conservationCheck, diagramCollisionWarnings, odMatrix, peakSensitivity } from "../lib/final-features.ts";
import type { TrafficRecord } from "../lib/traffic.ts";

function record(): TrafficRecord {
  const movement = { left: 0, through: 10, right: 0, vehicle: { car: 10 }, rawVehicleTotal: 10 };
  return {
    id: "r", station: "T-01", name: "測試路口", rawName: "source.xls", quarter: "115Q2", date: "2026-05-01", surveyType: "平日",
    peaks: { AM: { start: "07:00", end: "08:00" }, PM: { start: "17:00", end: "18:00" } },
    approaches: [
      { id: "A", name: "路口A", bearing: "東", angle: 0, lanes: null, capacity: null, movements: { AM: movement, PM: movement } },
      { id: "B", name: "路口B", bearing: "西", angle: 180, lanes: null, capacity: null, movements: { AM: movement, PM: movement } },
    ],
    routes: [
      { id: "A-B", fromApproachId: "A", toApproachId: "B", movement: "through", volumes: { AM: { pcu: 10, vehicle: { car: 10 } }, PM: { pcu: 10, vehicle: { car: 10 } } } },
      { id: "B-A", fromApproachId: "B", toApproachId: "A", movement: "through", volumes: { AM: { pcu: 10, vehicle: { car: 10 } }, PM: { pcu: 10, vehicle: { car: 10 } } } },
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

test("diagram preflight reports only close cards", function () {
  const sample = record();
  assert.equal(diagramCollisionWarnings(sample).length, 0);
  sample.approaches[1].angle = 5;
  assert.equal(diagramCollisionWarnings(sample).length, 1);
});
