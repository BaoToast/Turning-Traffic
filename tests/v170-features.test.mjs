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
  /*
   * formatMemories 的**資料**仍然保留（照樣累積、照樣進備份），
   * 備份格式不變，舊備份還原不受影響。
   */
  assert.match(appSource, /formatMemories/);
});

/**
 * 匯入頁的「調查檔格式範本」面板（三張範本卡片＋「已記住的實際調查版型」
 * 折疊區）在 v2.1.54 移除。
 *
 * ⚠️ 這裡刻意比對 **JSX 的樣子**，不是比對「原始碼裡有沒有出現這幾個字」：
 *    ・原始碼會留下解釋「為什麼拿掉」的註解
 *    ・VERSION_HISTORY 的更新說明本來就要寫出拿掉了什麼
 *    這兩處都會出現同樣的字，用純字串比對會被自己的說明絆倒
 *    （第一版與第二版就是分別這樣紅的）。
 */
export const REMOVED_FORMAT_PANEL_PATTERNS = [
  /className="panel format-template-panel"/,
  /IMPORT_FORMAT_TEMPLATES\.map/,
  /已記住的實際調查版型（\{formatMemories\.length\}/,
  />\s*刪除格式記憶\s*</,
];

test("匯入頁不再展示「調查檔格式範本」與「已記住的實際調查版型」", () => {
  for (const pattern of REMOVED_FORMAT_PANEL_PATTERNS)
    assert.doesNotMatch(
      appSource,
      pattern,
      `匯入頁還留著這一段版型面板：${pattern}`,
    );
});test("shows destination inbound analysis with honest full-day availability", () => {
  assert.match(appSource, /駛入／駛出各路口交通量/);
  assert.match(appSource, /inboundAnalysisRows/);
  assert.match(appSource, /駛入駛出各路口流量/);
  /*
   * v2.1.30 起，四個統計範圍的欄位一律由 SCOPE_KEYS 產生，欄名不再逐個
   * 手寫（舊版寫死「全日駛入量（PCU/調查日）」那一串）。改成檢查
   * 「有沒有照範圍產生欄位」與「單位有沒有跟著範圍走」。
   */
  assert.match(appSource, /\$\{label\} 駛入量（\$\{pcu\}）/);
  /*
   * ⚠️ 2026-09-25 第六輪：這一條原本釘的是 `scopeUnit(scope)`——**沒有涵蓋**的
   *   那個寫法。等於用正面斷言把缺陷釘住：日後有人補上涵蓋，這一支會紅，
   *   而它紅的時候是對的修正被擋下來。現在改成釘「一定要帶整批的涵蓋」。
   */
  assert.match(
    appSource,
    /const pcu = scopeUnit\(scope, "pcu", exportCoverage\);/,
  );
  assert.match(
    appSource,
    /const exportCoverage = coverageOf\(exportRecords\.map\(viewRecord\)\);/,
    "匯出的欄名單位不是從整批資料算涵蓋——逐列算會讓同一張表長出兩組欄位",
  );
  /*
   * 「這份調查有沒有滿 24 小時」全系統只有 coversFullDay 說了算。
   * 舊版是就地寫 `record.survey.minutes < 24 * 60`，同一個門檻散在好幾處，
   * 改門檻時很容易只改到一半。
   */
  assert.doesNotMatch(
    appSource,
    /survey\.minutes\s*[<>]=?\s*24 \* 60/,
    "還有地方自己寫 24 小時的門檻，沒有走 coversFullDay",
  );
  assert.match(appSource, /coversFullDay\(selected\.survey\)/);
  /*
   * ⚠️ v2.1.64 起這一項的內容變了。
   *   舊版：不足 24 小時 → 「全日時段與全日尖峰小時皆不適用」。
   *   新版：全調查時段就是這份調查涵蓋的時段，4 小時的調查照樣有值，
   *         所以畫面要講的是**涵蓋幾小時**，不是「不適用」。
   *   「不以尖峰推估」那一句仍然要在——只是它現在套用的情形變成
   *   「缺少逐時間格資料」，而不是「涵蓋不足 24 小時」。
   */
  assert.match(appSource, /本筆調查涵蓋/);
  assert.match(appSource, /全調查時段與全調查時段尖峰都以這段涵蓋為準/);
  assert.match(appSource, /不以尖峰推估/);
  assert.doesNotMatch(
    appSource,
    /全日時段與全日尖峰小時皆不適用/,
    "舊的「不適用」說法還在，等於同一個畫面上同時講兩套規則",
  );
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
