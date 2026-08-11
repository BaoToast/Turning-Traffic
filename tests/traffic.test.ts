import assert from "node:assert/strict";
import test from "node:test";
import { createDemoRecords, normalizeIntersectionName, rollingPeak, stationFromFilename } from "../lib/traffic.ts";

test("normalizes filenames without deleting real road names", () => {
  assert.equal(normalizeIntersectionName("11017Ｔ１－０４【中山路-國昌路-民強街路口】(修正版)V2.xls"), "中山路－國昌路－民強街路口");
  assert.equal(normalizeIntersectionName("11017T1-05(台1-台28路口)..xls"), "台1－台28路口");
  assert.equal(stationFromFilename("11017T1-03(台1-路科一路口).xls"), "T1-03");
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
