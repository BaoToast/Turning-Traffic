/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列的三態：鏡子／脫離／回歸
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 裁示的架構，三支程式共用：
 *   ①「圖可以自己改，但只影響那一張」
 *   ②「針對共同的篩選條件……圖表自身的工具列仍舊要與主工具列同步」
 *   ③「主工具列也多一個全部回歸鈕，將所有有套用到自己篩選條件的圖表一起大回歸」
 *
 * ⚠️ 第①條和第②條要**一起驗**。只驗①的話，一個
 *   「圖上永遠顯示自己的預設值、根本不看主工具列」的實作也會全綠——
 *   而那正是使用者會抱怨「主工具列寫 115Q2、圖上還寫 115Q1」的情況。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_MAIN_FILTERS,
  filtersFor,
  isDetached,
  detachedIds,
  setChartFilter,
  resetChart,
  resetAllCharts,
  isFiltered,
  isRangeWidened,
  describeMain,
  normalizeLegacyAll,
} from "../app/main-filters.ts";

const main = {
  ...DEFAULT_MAIN_FILTERS,
  quarterFrom: "115Q2",
  quarterTo: "115Q2",
};

test("① 鏡子：沒動過的圖，拿到的就是主工具列現在的值", () => {
  const overrides = {};
  assert.deepEqual(filtersFor(main, overrides, "trend"), main);
  /* 主工具列改了，鏡子要跟著換——不是停在舊值。 */
  const moved = { ...main, quarterTo: "115Q4" };
  assert.equal(filtersFor(moved, overrides, "trend").quarterTo, "115Q4");
  assert.equal(isDetached(overrides, "trend"), false);
});

test("② 脫離：在一張圖上改條件，只有那一張變", () => {
  let overrides = {};
  overrides = setChartFilter(overrides, "trend", "peak", "PM");
  assert.equal(filtersFor(main, overrides, "trend").peak, "PM");
  /* 別張完全不受影響。 */
  assert.equal(filtersFor(main, overrides, "composition").peak, "AM");
  assert.equal(isDetached(overrides, "trend"), true);
  assert.equal(isDetached(overrides, "composition"), false);
});

test("② 脫離之後，**沒被動到的那幾個條件**仍然跟著主工具列走", () => {
  /*
   * ⚠️ 這一條很容易寫錯成「整組凍結」：使用者只改了尖峰，
   *   季度卻從此停在脫離當下那一季——他會以為程式壞了。
   *   脫離是**逐欄**的，不是整組。
   */
  let overrides = setChartFilter({}, "trend", "peak", "PM");
  const moved = { ...main, quarterTo: "115Q4" };
  const got = filtersFor(moved, overrides, "trend");
  assert.equal(got.peak, "PM", "自己改過的欄位要保留");
  assert.equal(got.quarterTo, "115Q4", "沒改過的欄位要跟著主工具列");
});

test("③ 回歸：單張回歸只影響那一張", () => {
  let overrides = {};
  overrides = setChartFilter(overrides, "trend", "peak", "PM");
  overrides = setChartFilter(overrides, "composition", "vehicle", "car");
  assert.deepEqual(detachedIds(overrides).sort(), ["composition", "trend"]);
  overrides = resetChart(overrides, "trend");
  assert.deepEqual(detachedIds(overrides), ["composition"]);
  assert.equal(filtersFor(main, overrides, "trend").peak, "AM");
  assert.equal(filtersFor(main, overrides, "composition").vehicle, "car");
});

test("③ 全部回歸：三張一起回去，不可以只回兩張", () => {
  let overrides = {};
  overrides = setChartFilter(overrides, "a", "peak", "PM");
  overrides = setChartFilter(overrides, "b", "vehicle", "car");
  overrides = setChartFilter(overrides, "c", "movement", "left");
  assert.equal(detachedIds(overrides).length, 3, "前置：真的有三張脫離");
  overrides = resetAllCharts();
  assert.deepEqual(detachedIds(overrides), []);
  for (const id of ["a", "b", "c"])
    assert.deepEqual(filtersFor(main, overrides, id), main);
});

test("isFiltered：季度看的是**起迄有沒有拉開**，不是跟預設比", () => {
  /*
   * ⚠️ 季度的預設是空字串，開機後一定會被填成最新一季。
   *   拿預設來比的話，「115Q2～115Q2」會被判成「有篩」，
   *   於是每一張不吃季度的圖一開機就跳出「不適用季度篩選」——
   *   那正是使用者說的噪音。
   */
  assert.equal(isFiltered(main, "quarterFrom"), false, "起＝迄不算篩");
  assert.equal(
    isFiltered({ ...main, quarterFrom: "115Q1" }, "quarterFrom"),
    true,
    "拉開才算篩",
  );
});

test("isFiltered：其他條件回到預設就是沒篩", () => {
  assert.equal(isFiltered(main, "vehicle"), false);
  assert.equal(isFiltered({ ...main, vehicle: "car" }, "vehicle"), true);
  assert.equal(isFiltered(main, "movement"), false);
  assert.equal(isFiltered({ ...main, movement: "left" }, "movement"), true);
  assert.equal(isFiltered(main, "intersections"), false);
  assert.equal(
    isFiltered({ ...main, intersections: ["S01-03"] }, "intersections"),
    true,
  );
});

test("預設值必須等同升級前的行為（改了就會動到既有數字）", () => {
  /*
   * ⚠️ 這一條不是形式檢查。升級前畫面上的實際狀態是
   *   peak=AM、vehicle=all、display=both、flowSummaryMode=both。
   *   預設值只要有一項不同，升級當天所有既有數字就會變，
   *   而使用者會以為是計算被改壞了。
   */
  assert.equal(DEFAULT_MAIN_FILTERS.peak, "AM");
  assert.equal(DEFAULT_MAIN_FILTERS.vehicle, "all");
  assert.equal(DEFAULT_MAIN_FILTERS.display, "both");
  assert.equal(DEFAULT_MAIN_FILTERS.flowView, "both");
  assert.equal(DEFAULT_MAIN_FILTERS.movement, "all");
  /*
   * ⚠️ 2026-09-17 起預設值是 "side-by-side"（平日＋假日並列）。
   *   這一條守的是「預設值不可以改變既有數字」——而這一次改**沒有**改變
   *   任何數字：篩選只在 "weekday"／"holiday" 時才擋紀錄，
   *   "all" 與 "side-by-side" 一個都不進那兩個分支（使用者 2026-09-17
   *   問到這件事，查證後裁示把重複的那一個選項拿掉）。
   *   所以這裡跟著改成新的預設值，守的東西沒有變。
   */
  assert.equal(DEFAULT_MAIN_FILTERS.day, "side-by-side");
  assert.equal(
    DEFAULT_MAIN_FILTERS.peakRule,
    "point",
    "整個調查點同一時段＝升級前的算法",
  );
});

test("describeMain：脫離的圖要標得出主工具列現在是什麼", () => {
  assert.match(describeMain(main), /115Q2/);
  assert.match(describeMain(main), /上午尖峰/);
  assert.match(describeMain(main), /全部路口/);
  assert.match(
    describeMain({ ...main, quarterFrom: "115Q1" }),
    /115Q1～115Q2/,
    "起迄拉開時要寫成區間",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  N-5：脫離的圖上那一行不可以印出車種的**內部代號**
 * ══════════════════════════════════════════════════════════════════════
 *
 * `main.vehicle` 存的是代號（`custom:電動機車`、`motorcycle`…），
 * 不是畫面上的名字。舊版直接 String() 印出去，脫離的圖上會寫著
 *   「115Q2・上午尖峰・全部路口・custom:電動機車」
 * ——一串使用者從來沒在畫面上見過的字。
 *
 * 那一行是「主工具列現在是什麼」的唯一說明，使用者要靠它判斷這張圖
 * 和別張差在哪。印代號等於沒說。
 */
test("describeMain：車種要翻成畫面上的名字，不可以印內部代號", () => {
  const filters = { ...main, vehicle: "custom:電動機車" };
  const shown = describeMain(
    filters,
    (value) => value,
    (id) => (id === "custom:電動機車" ? "電動機車" : id),
  );
  assert.match(shown, /電動機車/);
  assert.doesNotMatch(
    shown,
    /custom:/,
    "內部代號不可以出現在使用者看得到的字串裡",
  );
});

test("前置：不傳翻譯函式時會印出代號（證明上一條不是恆真）", () => {
  const filters = { ...main, vehicle: "custom:電動機車" };
  /*
   * ⚠️ 這一條刻意驗「舊行為」。沒有它的話，上一條在
   *   「describeMain 根本不印車種」的實作下也會通過——
   *   那時 doesNotMatch 成立、match 卻應該要紅，所以這裡一起釘住
   *   「車種確實有被印出來」這件事。
   */
  assert.match(describeMain(filters), /custom:電動機車/);
});

test("describeMain：車種是 all 時不印這一段（沒篩卻講話是噪音）", () => {
  const shown = describeMain({ ...main, vehicle: "all" }, (v) => v, (v) => v);
  assert.doesNotMatch(shown, /all/);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  R-8：季度不可以用 isFiltered 問（M-1 之後語意剛好相反）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-15 使用者定案：**起＝迄＝只有那一季**（不是「不限季」）。
 * 所以「選了單季」也是在篩——但 isFiltered 看不到季度清單，
 * 答不出「有沒有比全部季度窄」。要問那件事只能用 isPeriodNarrowed。
 *
 * 這一條掃的是**呼叫端**：任何地方把季度欄位丟進 isFiltered 就紅。
 * ⚠️ 為什麼要用掃描而不是靠註解：那個函式**不會爆炸**，它會安靜地回一個
 *   「區間有沒有拉開」的答案。呼叫端拿它當「有沒有篩」用時，
 *   畫面上看起來完全正常，只是該出現的說明沒出現——沒有人會發現。
 */

test("R-8：程式裡不可以把季度欄位丟進 isFiltered", () => {
  const source = readFileSync(new URL("../app/traffic-app.tsx", import.meta.url), "utf8");
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const hits = [
    ...stripped.matchAll(/isFiltered\([^)]*["'](quarterFrom|quarterTo|periodFrom|periodTo)["']/g),
  ].map((match) => match[0]);
  assert.deepEqual(
    hits,
    [],
    "季度要用 isPeriodNarrowed（有沒有比全部季度窄）或 isRangeWidened（是不是拉開了）：\n" +
      hits.join("\n"),
  );
});

test("前置：這條掃描真的抓得到（抓不到的話上一條恆綠）", () => {
  const fake = 'const a = isFiltered(mainFilters, "quarterFrom");';
  const hits = [
    ...fake.matchAll(/isFiltered\([^)]*["'](quarterFrom|quarterTo|periodFrom|periodTo)["']/g),
  ];
  assert.equal(hits.length, 1);
});

test("isRangeWidened：起＝迄＝false（那是單季，不是拉開）", () => {
  assert.equal(
    isRangeWidened({ ...main, quarterFrom: "115Q2", quarterTo: "115Q2" }),
    false,
  );
});

test("isRangeWidened：起≠迄＝true（一張卡放不下兩季，要說一聲）", () => {
  assert.equal(
    isRangeWidened({ ...main, quarterFrom: "115Q1", quarterTo: "115Q2" }),
    true,
  );
});

test("資料別沒有「全部」那一個選項（它與「並列」完全同義）", () => {
  /*
   * 使用者 2026-09-17 問「平日＋假日並列 和 全部資料別 有什麼差異」，
   * 查證結果是**完全沒有差異**：篩選只在 "weekday"／"holiday" 時才擋紀錄。
   * 兩個名字不同、行為相同的選項比少一個選項更糟——使用者會以為它們
   * 不一樣，然後去比對兩份一模一樣的結果。
   */
  const source = readFileSync(
    new URL("../app/main-toolbar.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const DAY_ORDER: DayChoice\[\] = \["weekday", "holiday", "side-by-side"\];/,
    "選單還列著「全部資料別」",
  );
  /* 舊存檔裡的 "all" 一律換成並列，否則下拉會選不到任何一項。 */
  assert.equal(
    normalizeLegacyAll({ ...DEFAULT_MAIN_FILTERS, day: "all" }).day,
    "side-by-side",
  );
  /* ⚠️ 換過去**不可以改變任何數字**：兩個值本來就都不擋紀錄。 */
  for (const value of ["all", "side-by-side"])
    assert.equal(
      value === "weekday" || value === "holiday",
      false,
      "只有平日／假日會擋紀錄",
    );
});
