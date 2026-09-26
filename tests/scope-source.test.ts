/**
 * ══════════════════════════════════════════════════════════════════════
 *  標籤與數字必須來自**同一邊**（2026-09-16 自我稽核，共 5 處）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 這一支守的是一整類的錯：某一塊可以脫離主工具列，它的**數字**照自己的
 * 條件算，但**檔名／頁首那一行／匯出的內容**卻讀主工具列。
 * 兩邊各自看都很合理，只有把兩份放在一起比才看得出來——而檔名與頁首
 * 那一行會被抄進報告。
 *
 * ⚠️ 用掃原始碼的方式，是因為這幾條都在「下載」這條路徑上：
 *   e2e 按下去會開啟檔案儲存流程，量不到檔名裡的字串；
 *   而這些錯全部都在**字串怎麼組**，不是在畫面上。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const raw = readFileSync(
  new URL("../app/traffic-app.tsx", import.meta.url),
  "utf8",
);
/** 去掉註解再比——註解裡合法地提到舊寫法（那是刻意留的說明）。 */
const source = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");
const blockFrom = (start: string, end: string) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + 1);
  assert.ok(from >= 0, `找不到起點：${start}`);
  assert.ok(to > from, `找不到終點：${end}`);
  return source.slice(from, to);
};

test("正式轉向圖的三個下載，檔名寫的是圖上那個時段", () => {
  /*
   * 這一頁的時段可以脫離（畫面上的下拉會呼叫 changeChartFilter）。
   * 三個下載（SVG／PNG／PDF）畫的都是 diagramPeak，檔名卻寫主工具列的
   * peak——檔名寫「AM」、圖裡畫的是全調查時段，而那張圖會被貼進報告。
   */
  const block = blockFrom("async function exportSvg", "async function createAnalysisWorkbook");
  const names = block.match(/diagramPeak \+\n\s*"_轉向圖\./g) || [];
  assert.equal(names.length, 2, "SVG 與 PNG 的檔名都要寫 diagramPeak");
  assert.match(block, /diagramPeak \+\n\s*"_轉向交通量報表\.pdf"/);
  assert.doesNotMatch(
    block,
    /\n\s*peak \+\n\s*"_轉向圖\./,
    "檔名還在讀主工具列的時段",
  );
  assert.doesNotMatch(
    block,
    /\n\s*peak \+\n\s*"_轉向交通量報表\.pdf"/,
    "PDF 檔名還在讀主工具列的時段",
  );
});

test("轉向進階分析：頁首的單位、畫面與匯出，三者同一個時段", () => {
  const page = blockFrom('{view === "advanced"', '{view === "conclusion"');
  /* 註解已被剝掉，所以中間會多出空白行——用寬鬆一點的比對。 */
  /*
   * ⚠️ 2026-09-25 第六輪：這一條原本釘 `{scopeUnit(advancedPeak)}`，
   *   也就是**沒有帶涵蓋**的寫法。守「時段對不對」是對的，但順手把
   *   「不帶涵蓋」一起釘住了，於是補上涵蓋反而會紅。
   *   現在只要求第一個參數是 `advancedPeak`，並另外要求第三個參數
   *   是這一頁自己算的涵蓋。
   */
  assert.match(
    page,
    /流量單位隨所選時段變動（目前為[\s\S]{0,160}?\{scopeUnit\(advancedPeak,\s*"pcu",\s*advancedCoverage\)\}）。/,
    "頁首那一行還在讀主工具列的時段、或沒有帶這一頁的調查涵蓋，" +
      "都會與下面每一塊的單位標籤不一致",
  );
  /* 畫面與匯出要走同一支，兩邊各寫一份遲早分岔。 */
  assert.match(source, /const advancedRecordFor = useCallback\(/);
  assert.match(page, /const advancedView = advancedRecordFor\(selected\);/);
  const exportBlock = blockFrom(
    "function exportAdvancedExcel",
    "function exportQualityExcel",
  );
  assert.match(exportBlock, /const view = advancedRecordFor\(record\);/);
  assert.match(exportBlock, /odMatrix\(view, advancedPeak\)/);
  assert.match(exportBlock, /branchBalance\(view, advancedPeak\)/);
  /*
   * ⚠️ 反面兩條，少一條都擋不住這次修掉的錯：
   *   ① 不可以再讀主工具列的時段
   *   ② 不可以再套 viewRecord（它會套主工具列的轉向別，
   *      而畫面上白紙黑字寫著「這裡一律以『全部轉向』計算」，
   *      套了之後守恆差值永遠對不起來）
   */
  assert.doesNotMatch(exportBlock, /scopeUnit\(peak\)/);
  assert.doesNotMatch(exportBlock, /viewRecord\(record\)/);
  /* 檔名要帶時段，否則兩個時段各下載一次會是同名檔、後者蓋掉前者。 */
  assert.match(exportBlock, /advancedPeak \+\n\s*"_轉向進階核對\.xlsx"/);
});

test("歷季趨勢的講稿與圖，單位是同一個", () => {
  /*
   * buildMetricSeries 的 unit 走 metricUnit(metric, scope, coverage)。
   * 涵蓋要與圖、Excel 同一個來源（`coverageOf(rows)`），否則整批都是
   * 24 小時的調查時，圖寫「PCU/調查日」、講稿寫「PCU/調查時段」，
   * 同一批數字兩種單位。
   * ⚠️ 2026-09-25 第六輪：`coverage` 已經改成**必填**（原本這裡寫「不帶時走
   *   安全預設」——那個預設值就是這一類不一致的來源，已經拿掉）。
   */
  const block = blockFrom("const scriptSeries = buildMetricSeries(", "const scriptSections");
  assert.match(block, /coverageOf\(rows\),/, "講稿的 series 沒有帶調查涵蓋");
});

test("歷季趨勢的下載檔名帶指標；視角只在真的吃視角時才寫", () => {
  /*
   * 舊檔名只寫「駛出總量／駛入總量」：
   *   ① 換一個指標再匯出一次 → 內容不同、檔名一樣，第二份蓋掉第一份
   *   ② 佔比／單一車種／單一轉向根本不吃視角（metricValue 直接忽略 flow），
   *      檔名卻宣告了視角，而 Excel 裡的「統計視角」欄自己寫著
   *      「不分駛出駛入」——同一份檔案自己打自己
   */
  for (const [what, suffix] of [
    ["PNG", '"_歷季趨勢.png"'],
    ["Excel", '"_歷季趨勢.xlsx"'],
  ]) {
    const near = source.slice(
      Math.max(0, source.indexOf(suffix) - 600),
      source.indexOf(suffix) + suffix.length,
    );
    assert.match(near, /seriesLabel \+/, `${what} 的檔名沒有帶指標`);
    assert.match(
      near,
      /metric\.flowAware\s*\n?\s*\?\s*"_" \+ \(trendFlow === "outbound" \? "駛出" : "駛入"\)/,
      `${what} 的檔名沒有依 flowAware 判斷要不要寫視角`,
    );
    assert.doesNotMatch(
      near,
      /\(trendFlow === "outbound" \? "駛出總量" : "駛入總量"\)/,
      `${what} 的檔名還在無條件寫視角`,
    );
  }
});
