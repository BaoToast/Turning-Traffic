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
  assert.match(appSource, /cardSection\(\s*"inbound",\s*incomingValues/);
  assert.match(appSource, /cardSection\(\s*"outbound",\s*values/);
  assert.match(appSource, /const routePath = function/);
  assert.match(appSource, /flowSummaryMode === "outbound"/);
  assert.match(appSource, /flowSummaryMode === "inbound"/);
  assert.match(appSource, /splitOffset = cardWidth \/ 2 \+ roadWidth \/ 2 \+ 10/);
  assert.match(appSource, /pushCard\("outbound"/);
  assert.match(appSource, /pushCard\("inbound"/);
  assert.match(appSource, /minimumCardRadius/);
  assert.match(appSource, /radialCardExtent/);
  assert.match(appSource, /movement-path\.zero/);
  assert.match(appSource, /pendingCards/);
  assert.match(appSource, /perimeterSlots/);
  // 多岔路口的卡片配位改用「貪婪配對 + 兩兩交換」，不再用會指數爆炸的遞迴窮舉，
  // 也不再在 render 當中 throw（一 throw 整個畫面就會變成空白錯誤頁）。
  assert.match(appSource, /assignedSlots\[pair\.card\] = pair\.slot/);
  assert.match(appSource, /多岔路口的卡片配位|兩兩交換/);
  assert.doesNotMatch(appSource, /const assign = function \(cardIndex: number, usedMask: number\)/);
  assert.doesNotMatch(appSource, /throw new Error\("多岔路流量卡片無法配置到獨立位置。"\)/);
  assert.match(appSource, /multi-arm-card/);
  assert.match(appSource, /route\.toApproachId === approach\.id/);
  assert.match(appSource, /movementTargetIndex\(\s*record\.approaches,\s*sourceIndex,\s*movement,?\s*\) === index/);
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

test("箭頭一律畫完整路徑，聚焦時依駛入／駛出決定方向", () => {
  // 不再把貝茲曲線從中點切一半（舊版會讓箭頭停在路口中央）
  assert.doesNotMatch(appSource, /firstControl\.x\.toFixed\(1\)/);
  assert.match(appSource, /const keepRoute = function/);
  assert.match(appSource, /if \(flowSummaryMode === "inbound"\) return destinationIndex === focusIndex/);
  assert.match(appSource, /if \(flowSummaryMode === "outbound"\) return sourceIndex === focusIndex/);
});

test("圖卡與路口標籤都可拖曳，且拖曳過程不寫入狀態", () => {
  assert.match(appSource, /data-card-section=/);
  assert.match(appSource, /data-label-id=/);
  assert.match(appSource, /cardOffsets/);
  assert.match(appSource, /labelOffset/);
  // 三種顯示模式各自保存版面
  assert.match(appSource, /cardLayouts/);
  assert.match(appSource, /function approachCardOffset/);
  assert.match(appSource, /function approachLabelOffset/);
  assert.match(appSource, /layouts\[layoutMode\] = layout/);
  // 拖曳中只改 DOM transform，用 rAF 節流；放開才呼叫 updateSelectedGeometry
  assert.match(appSource, /requestAnimationFrame\(paint\)/);
  assert.match(appSource, /node\.setAttribute\(\s*"transform"/);
  // 已移除數字位移輸入
  assert.doesNotMatch(appSource, /數據卡左右位移/);
  assert.doesNotMatch(appSource, /數據卡上下位移/);
});

test("圖卡標題有置中樣式", () => {
  assert.match(appSource, /\.section-title\{[^}]*text-anchor:middle/);
});

test("報表匯出項目可依計畫勾選並存成範本", () => {
  assert.match(appSource, /REPORT_ITEMS/);
  assert.match(appSource, /activeReportItems/);
  assert.match(appSource, /reportTemplates/);
  assert.match(appSource, /各路口" \+ label \+ "尖峰流量/);
  assert.match(appSource, /reportItems: next/);
});

test("拖曳換算與邊界處理", () => {
  // 用 getScreenCTM 取真正的縮放，避免 max-height 造成的左右留白讓橫向比例失準
  assert.match(appSource, /svg\.getScreenCTM\(\)/);
  // 位移以自動基準點為原點並先夾在畫布內，畫面與存檔一致、沒有死區
  assert.match(appSource, /data-base-x=/);
  assert.match(appSource, /const offsetAt = function/);
  assert.match(appSource, /clampX\(baseX \+ startOffsetX \+ dx\) - baseX/);
  // 多點觸控與拖曳中重繪的保護
  assert.match(appSource, /pointerEvent\.pointerId !== event\.pointerId/);
  assert.match(appSource, /setPointerCapture/);
  assert.match(appSource, /if \(!node\.isConnected\) return;/);
});

test("跨季度同步與新增支線不會互相污染", () => {
  // 重複的支線代碼加上序號，避免多條「人工」支線被併成同一條
  assert.match(appSource, /const codeKey = function/);
  assert.match(appSource, /index \? code \+ "#" \+ index : code/);
  // 新增支線不沿用第一條的交通量與版面，且序號要避開已存在的代碼
  assert.match(appSource, /sourceCode: "人工" \+ seq/);
  assert.match(appSource, /usedCodes\.has\("人工" \+ seq\)/);
  assert.match(appSource, /cardLayouts: undefined,/);
});

test("聚焦支線索引會跟著路口夾回有效範圍", () => {
  assert.match(appSource, /if \(count && focusIndex >= count\) setFocusIndex\(0\);/);
});

test("多岔路補位格子不會重疊", () => {
  assert.match(appSource, /const baseSlotCount = perimeterSlots\.length;/);
  assert.match(appSource, /index % baseSlotCount/);
  assert.doesNotMatch(appSource, /perimeterSlots\.length % Math\.max\(1, perimeterSlots\.length\)/);
});
