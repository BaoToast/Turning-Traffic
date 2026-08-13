import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../app/traffic-app.tsx", import.meta.url), "utf8");
const trafficSource = await readFile(new URL("../lib/traffic.ts", import.meta.url), "utf8");

test("ships the OD audit and quarterly locking workflow", () => {
  assert.match(appSource, /流量核對工作台/);
  assert.match(appSource, /OD 逐筆加總/);
  assert.match(appSource, /鎖定 .* 成果/);
  assert.match(appSource, /authorizeLockedChange/);
  assert.match(trafficSource, /resultLock\?:/);
});

test("supports inbound and outbound diagram summaries", () => {
  assert.match(appSource, /藍框流量顯示/);
  assert.match(appSource, /只顯示駛入/);
  assert.match(appSource, /只顯示駛出/);
  assert.match(appSource, /flowSummaryMode/);
  assert.match(appSource, /cardSection\("inbound", incomingValues/);
  assert.match(appSource, /cardSection\("outbound", values/);
  assert.match(appSource, /const routePath = function/);
  assert.match(appSource, /flowSummaryMode === "outbound"/);
  assert.match(appSource, /flowSummaryMode === "inbound"/);
  assert.match(appSource, /splitOffset = cardWidth \/ 2 \+ roadWidth \/ 2 \+ 10/);
  assert.match(appSource, /pushCard\("outbound"/);
  assert.match(appSource, /pushCard\("inbound"/);
  assert.match(appSource, /minimumCardRadius/);
  assert.match(appSource, /radialCardExtent/);
  assert.match(appSource, /movement-path\.zero/);
  assert.match(appSource, /route\.toApproachId === approach\.id/);
  assert.match(appSource, /movementTargetIndex\(record\.approaches, sourceIndex, movement\) === index/);
});

test("keeps multi-quarter exports, batch packages, and format memories", () => {
  assert.match(appSource, /reportStartQuarter/);
  assert.match(appSource, /reportEndQuarter/);
  assert.match(appSource, /exportBatchPackage/);
  assert.match(appSource, /formatMemories/);
  assert.match(appSource, /已記住的實際調查版型/);
});

test("shows destination inbound analysis with honest full-day availability", () => {
  assert.match(appSource, /駛入／駛出各路口交通量/);
  assert.match(appSource, /inboundAnalysisRows/);
  assert.match(appSource, /全日駛入量（PCU\/調查日）/);
  assert.match(appSource, /record\.survey\.minutes < 24 \* 60/);
  assert.match(appSource, /全日欄位不適用/);
  assert.match(appSource, /駛入駛出各路口流量/);
});

test("deduplicates weekday and holiday geometry entries by canonical intersection", () => {
  assert.match(appSource, /currentCanonicalRecords/);
  assert.match(appSource, /selectedSurveyType/);
  assert.match(appSource, /selectedIntersectionRecords/);
  assert.match(appSource, /資料別/);
  assert.match(appSource, /切換路口/);
  assert.match(appSource, /駛出路口/);
  assert.match(appSource, /駛入路口/);
});
