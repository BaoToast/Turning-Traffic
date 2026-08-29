import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  REPORT_ITEMS,
  recordIntersectionKey,
  trendSeriesRecords,
  buildTrendSeries,
} from "../lib/final-features.ts";
import type { TrafficRecord } from "../lib/traffic.ts";
import {
  DRAFT_ONLY_SECTIONS,
  DRAFT_SECTION_LABELS,
  DRAFT_SECTION_ORDER,
  buildReportDraft,
  type DraftSectionKey,
  type ReportDraftContext,
} from "../lib/report-draft.ts";

function context(overrides: Partial<ReportDraftContext> = {}): ReportDraftContext {
  return {
    projectName: "測試計畫",
    quarterRange: "115Q1～115Q4",
    quarterCount: 4,
    intersectionCount: 2,
    recordCount: 8,
    focusLabel: "中正路口（115Q4、平日）",
    peaks: { am: "07:30–08:30", pm: "17:15–18:15" },
    siteOmitted: 0,
    routelessRecords: 0,
    siteSummaries: [
      {
        name: "中正路口 115Q4（平日）",
        peaks: [
          {
            label: "上午尖峰",
            hour: "07:30–08:30",
            total: 2900.6,
            arms: [
              { name: "路口A", outbound: 1200.5, inbound: 1000.6 },
              { name: "路口B", outbound: 900.1, inbound: 1100 },
            ],
            vehicles: [
              { label: "機車", share: 52.1 },
              { label: "小型車", share: 39.1 },
            ],
          },
          {
            label: "下午尖峰",
            hour: "17:15–18:15",
            total: 2720.9,
            arms: [{ name: "路口A", outbound: 1100.2, inbound: 990.9 }],
            vehicles: [],
          },
        ],
      },
    ],
    outbound: [
      { name: "路口A", am: 1200.5, pm: 1100.2 },
      { name: "路口B", am: 900.1, pm: 880.4 },
      { name: "路口C", am: 500, pm: 460.3 },
      { name: "路口D", am: 300, pm: 280 },
    ],
    inbound: [
      { name: "路口B", am: 1100, pm: 1050 },
      { name: "路口A", am: 1000.6, pm: 990.9 },
      { name: "路口C", am: 500, pm: 400 },
      { name: "路口D", am: 300, pm: 280 },
    ],
    totals: { am: 2900.6, pm: 2720.9 },
    flowTotals: {
      outboundAm: 2900.6,
      outboundPm: 2720.9,
      inboundAm: 2900.6,
      inboundPm: 2720.9,
    },
    vehicles: [
      { label: "機車", count: 12000, share: 52.1 },
      { label: "小型車", count: 9000, share: 39.1 },
    ],
    compositionScope: "全調查時段",
    compositionUnit: "輛/調查時段",
    trend: [
      { quarter: "115Q3", am: 2500, pm: 2400 },
      { quarter: "115Q4", am: 2900.6, pm: 2720.9 },
    ],
    trendLabel: "中正路口／平日",
    compare: [
      { name: "中正路口 115Q4（平日）", am: 2900.6, pm: 2720.9 },
      { name: "民生路口 115Q4（平日）", am: 1800, pm: 1750 },
    ],
    compareIntersections: 2,
    topFlow: {
      station: "T-01 115Q4",
      peak: "AM",
      from: "路口A",
      to: "路口C",
      pcu: 640.5,
    },
    worstBalance: {
      station: "T-01 115Q4",
      peak: "AM",
      name: "路口B",
      difference: 0,
    },
    conservation: { checked: 16, passed: 16 },
    quality: { total: 0, errors: 0, warnings: 0, topCategories: [] },
    factors: [
      { label: "機車", left: 0.5, through: 0.3, right: 0.4 },
      { label: "小型車", left: 1.5, through: 1, right: 1.3 },
    ],
    factorMatrixCount: 1,
    ...overrides,
  };
}

const ALL: DraftSectionKey[] = DRAFT_SECTION_ORDER;

test("每一個匯出勾選項目都有對應的草稿段落，反之亦然", () => {
  // 這是這個功能最重要的一條測試。匯出項目清單與草稿段落若各自維護，
  // 日後新增一種匯出內容時很容易只加一邊，使用者就會遇到
  //「這個項目匯得出來，草稿裡卻永遠不會提到」。
  const exportKeys = REPORT_ITEMS.map((item) => item.key as string);
  const draftOnlyKeys = DRAFT_ONLY_SECTIONS.map((item) => item.key as string);
  for (const key of exportKeys)
    assert.ok(
      (DRAFT_SECTION_ORDER as string[]).includes(key),
      `匯出項目 ${key} 沒有對應的草稿段落`,
    );
  assert.deepEqual(
    [...(DRAFT_SECTION_ORDER as string[])].sort(),
    [...exportKeys, ...draftOnlyKeys].sort(),
    "草稿段落與（匯出項目＋草稿專屬段落）必須一一對應",
  );
  for (const key of DRAFT_SECTION_ORDER)
    assert.ok(DRAFT_SECTION_LABELS[key], `段落 ${key} 缺少顯示名稱`);
});

test("畫面的段落勾選直接取用共用常數，不另外維護一份清單", async () => {
  const source = await readFile(
    new URL("../app/traffic-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /DRAFT_SECTION_ORDER\.map\(/);
  assert.match(source, /DRAFT_SECTION_LABELS\[key\]/);
});

/** 只填 trendSeriesRecords 會看的欄位。 */
function seriesRecord(over: Partial<TrafficRecord>): TrafficRecord {
  return {
    id: over.station + "-" + over.quarter + "-" + (over.surveyType || ""),
    station: "T-01",
    name: "中正路口",
    quarter: "115Q1",
    surveyType: "平日",
    approaches: [],
    routes: [],
    sourceFiles: [],
    peaks: {
      AM: { start: "07:00", end: "08:00" },
      PM: { start: "17:00", end: "18:00" },
    },
    ...over,
  } as unknown as TrafficRecord;
}

test("歷季趨勢不會把同一個交流道的不同站號併成一條線", () => {
  /*
   * recordIntersectionKey 會把「(北向)」「(南向)」正規化掉，兩站因此共用
   * 同一個 key。少了站號條件，同一季會出現兩個點，「較前一季」變成
   * 北向對南向——而這個序列同時餵給 Excel 的歷季趨勢比較與折線圖。
   */
  const north = { name: "台1－岡山交流道路口(北向)", station: "T-N" };
  const south = { name: "台1－岡山交流道路口(南向)", station: "T-S" };
  assert.equal(
    recordIntersectionKey(seriesRecord(north)),
    recordIntersectionKey(seriesRecord(south)),
    "前提：兩個站號本來就會正規化成同一個路口 key",
  );
  const records = [
    seriesRecord({ ...north, quarter: "115Q1" }),
    seriesRecord({ ...south, quarter: "115Q1" }),
    seriesRecord({ ...north, quarter: "115Q2" }),
    seriesRecord({ ...south, quarter: "115Q2" }),
  ];
  const series = trendSeriesRecords(records, records[0]);
  assert.deepEqual(
    series.map((r) => `${r.station}|${r.quarter}`),
    ["T-N|115Q1", "T-N|115Q2"],
    "只能取同一站號",
  );
  assert.equal(
    new Set(series.map((r) => r.quarter)).size,
    series.length,
    "同一季不可以出現兩個點",
  );
});

test("歷季趨勢只取同一種資料別", () => {
  const records = [
    seriesRecord({ quarter: "115Q1", surveyType: "平日" }),
    seriesRecord({ quarter: "115Q1", surveyType: "假日" }),
    seriesRecord({ quarter: "115Q2", surveyType: "平日" }),
  ];
  const series = trendSeriesRecords(records, records[0]);
  assert.deepEqual(
    series.map((r) => `${r.quarter}|${r.surveyType}`),
    ["115Q1|平日", "115Q2|平日"],
  );
});

test("歷季趨勢依季度排序，且空清單不會爆", () => {
  const records = [
    seriesRecord({ quarter: "115Q3" }),
    seriesRecord({ quarter: "115Q1" }),
    seriesRecord({ quarter: "115Q2" }),
  ];
  assert.deepEqual(
    trendSeriesRecords(records, records[0]).map((r) => r.quarter),
    ["115Q1", "115Q2", "115Q3"],
  );
  assert.deepEqual(trendSeriesRecords([], null), []);
});

test("站號逐年換掉時，歷季趨勢要串成同一條線（不是只剩一季）", () => {
  /*
   * 迴歸測試：站號是標案／年度給的編號，同一個路口很常換
   *（111 年 T13-04、115 年 T15-04）。v2.1.9 把「站號相同」列為必要條件，
   * 使用者明明有 16 季資料，畫面只剩最早那一季對得上的站號，折線圖顯示
   * 「至少需要兩季資料」，整個歷季趨勢等於不能用。
   */
  const quarters = ["111Q3", "111Q4", "112Q1", "112Q2", "113Q1", "115Q2"];
  const records = quarters.map((quarter, index) =>
    seriesRecord({
      quarter,
      station: index < 2 ? "T13-04" : index < 4 ? "T14-04" : "T15-04",
    }),
  );
  const series = trendSeriesRecords(records, records.at(-1)!);
  assert.deepEqual(
    series.map((r) => r.quarter),
    quarters,
    "六季都要留下來",
  );
  const built = buildTrendSeries(records, {
    intersectionKey: recordIntersectionKey(records[0]),
    surveyType: "平日",
  });
  assert.equal(built.chainedStations, true, "要回報站號有變動");
  assert.equal(built.parallelStations, false, "每季只有一筆，不是並存站號");
  assert.deepEqual(built.stations, ["T13-04", "T14-04", "T15-04"]);
});

test("並存站號（北向／南向）仍然只畫一個站，且可以切換", () => {
  const north = { name: "台1－岡山交流道路口(北向)", station: "T-N" };
  const south = { name: "台1－岡山交流道路口(南向)", station: "T-S" };
  const records = [
    seriesRecord({ ...north, quarter: "115Q1" }),
    seriesRecord({ ...south, quarter: "115Q1" }),
    seriesRecord({ ...north, quarter: "115Q2" }),
    seriesRecord({ ...south, quarter: "115Q2" }),
  ];
  const key = recordIntersectionKey(records[0]);
  const built = buildTrendSeries(records, {
    intersectionKey: key,
    surveyType: "平日",
  });
  assert.equal(built.parallelStations, true);
  assert.equal(built.chainedStations, false);
  assert.deepEqual(built.availableStations, ["T-N", "T-S"]);
  assert.equal(new Set(built.rows.map((r) => r.quarter)).size, built.rows.length);
  const picked = buildTrendSeries(records, {
    intersectionKey: key,
    surveyType: "平日",
    preferStation: "T-S",
  });
  assert.deepEqual(
    picked.rows.map((r) => `${r.station}|${r.quarter}`),
    ["T-S|115Q1", "T-S|115Q2"],
  );
});

test("季度範圍會限制趨勢序列", () => {
  const records = ["115Q1", "115Q2", "115Q3"].map((quarter) =>
    seriesRecord({ quarter }),
  );
  const built = buildTrendSeries(records, {
    intersectionKey: recordIntersectionKey(records[0]),
    surveyType: "平日",
    quarters: ["115Q1", "115Q2"],
  });
  assert.deepEqual(
    built.rows.map((r) => r.quarter),
    ["115Q1", "115Q2"],
  );
});

test("畫面的折線圖與報表共用 buildTrendSeries，不再自己挑站號", async () => {
  const source = await readFile(
    new URL("../app/traffic-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /buildTrendSeries\(props\.records, \{/);
  assert.doesNotMatch(
    source,
    /record\.station === trendStation/,
    "畫面不可以再自己用最早一季的站號過濾",
  );
});

test("選定的路口不在匯出範圍內時，退回第一筆而不是回空清單", () => {
  const records = [seriesRecord({ quarter: "115Q1" })];
  const outsider = seriesRecord({ name: "別的路口", station: "T-99" });
  assert.equal(trendSeriesRecords(records, outsider).length, 1);
});

test("草稿與 Excel 共用同一組匯出範圍與趨勢挑選規則", async () => {
  // 兩邊各自算一次範圍或趨勢序列，數字遲早會分岔，而且是在報告送出去之後
  // 才被發現。這裡確保共用函式真的兩邊都在用。
  const source = await readFile(
    new URL("../app/traffic-app.tsx", import.meta.url),
    "utf8",
  );
  const trendUses = source.match(/trendSeriesRecords\(exportRecords, selected\)/g) || [];
  assert.equal(trendUses.length, 2, "Excel 與草稿都要用 trendSeriesRecords");
  assert.match(source, /const exportRecords = reportExportScope\.records;/);
  // 挑選規則本身必須留在 lib（可被單元測試直接驗），不能又被複製回畫面檔。
  assert.doesNotMatch(source, /function trendSeriesRecords/);
});

test("全部勾選時，每一個段落都會出現在草稿裡", () => {
  const text = buildReportDraft(context(), ALL);
  assert.match(text, /測試計畫 115Q1～115Q4 路口轉向交通量分析報告草稿/);
  assert.match(text, /本次分析範圍：115Q1～115Q4（共 4 個季度）、2 個路口、8 筆/);
  assert.match(text, /尖峰時段：上午 07:30–08:30、下午 17:15–18:15。/);
  assert.match(text, /支線與車種的敘述以 中正路口（115Q4、平日） 為代表/);
  assert.match(text, /各支線駛出尖峰流量（駛出路口X＝以支線 X 為起點/);
  assert.match(text, /各支線駛入尖峰流量（駛入路口X＝以支線 X 為終點/);
  assert.match(text, /路口轉向總量：上午尖峰 2,900.6 PCU\/hr/);
  assert.match(text, /OD 轉向矩陣中流量最高的一筆為 T-01 115Q4 AM 尖峰的 路口A → 路口C，640.5/);
  assert.match(text, /支線流量平衡檢核：全部支線的駛入與駛出差值皆為 0/);
  assert.match(text, /守恆檢核共檢查 16 組，通過 16 組。/);
  assert.match(text, /車種組成（中正路口（115Q4、平日），全調查時段）：機車 52.1%（12,000 輛\/調查時段）/);
  assert.match(text, /歷季趨勢（中正路口／平日）/);
  assert.match(text, /最新一季 115Q4 較前一季 115Q3：上午尖峰增加 16.0%/);
  assert.match(text, /各路口比較（每個路口、每種資料別各取範圍內最新一季，共 2 筆、涵蓋 2 個路口/);
  assert.match(text, /資料品質檢核：未發現缺值/);
  assert.match(text, /車種轉向當量（左轉／直行／右轉）：機車 0.5／0.3／0.4/);
  assert.match(text, /正式引用前請核對原始調查檔/);
});

test("各路口分項結果會逐個路口、逐個尖峰寫出", () => {
  const text = buildReportDraft(context(), ["sites"]);
  assert.match(text, /各路口分項結果（每一筆路口季度資料各自的尖峰時段與流量/);
  assert.match(text, /【中正路口 115Q4（平日）】/);
  assert.match(
    text,
    /・上午尖峰（07:30–08:30）：路口轉向總量 2,900.6 PCU\/hr；各支線駛出／駛入：路口A 1,200.5／1,000.6、路口B 900.1／1,100.0 PCU\/hr；車種組成：機車 52.1%、小型車 39.1%。/,
  );
  // 沒有車種資料的尖峰不會硬寫出一句空的車種組成。
  assert.match(
    text,
    /・下午尖峰（17:15–18:15）：路口轉向總量 2,720.9 PCU\/hr；各支線駛出／駛入：路口A 1,100.2／990.9 PCU\/hr。/,
  );
});

test("各路口分項結果不會把無法計算的全日尖峰寫成 0", () => {
  const c = context();
  c.siteSummaries[0].peaks.push({
    label: "全日尖峰小時",
    hour: "－",
    available: false,
    total: 0,
    arms: [
      { name: "路口A", outbound: 0, inbound: 0 },
      { name: "路口B", outbound: 0, inbound: 0 },
    ],
    vehicles: [],
  });
  const text = buildReportDraft(c, ["sites"]);
  assert.match(text, /・全日尖峰小時（－）：無法計算。/);
  assert.doesNotMatch(text, /全日尖峰小時（－）：路口轉向總量 0\.0 PCU\/hr/);
});

test("整體總結與各路口分項結果可以各自勾選，互不影響", () => {
  const onlyOverall = buildReportDraft(context(), ["inboundOutbound"]);
  assert.match(onlyOverall, /路口轉向總量：上午尖峰 2,900.6/);
  assert.doesNotMatch(onlyOverall, /各路口分項結果/);
  const both = buildReportDraft(context(), ["inboundOutbound", "sites"]);
  assert.match(both, /路口轉向總量：上午尖峰 2,900.6/);
  assert.match(both, /各路口分項結果/);
});

test("沒有路口資料時，勾了分項結果會明講", () => {
  const text = buildReportDraft(context({ siteSummaries: [] }), ["sites"]);
  assert.match(text, /各路口分項結果：目前範圍沒有可敘述的資料。/);
});

test("超過三條支線時會註明其餘幾條見表，不會把全部塞進句子", () => {
  const text = buildReportDraft(context(), ["outboundPeak"]);
  assert.match(text, /其餘 1 條支線見表/);
  assert.doesNotMatch(text, /路口D/);
});

test("沒有勾選的段落不會出現", () => {
  const text = buildReportDraft(context(), ["scope"]);
  assert.match(text, /本次分析範圍/);
  assert.doesNotMatch(text, /車種組成/);
  assert.doesNotMatch(text, /OD 轉向矩陣/);
});

test("勾選了但沒有資料的段落會明講，而不是靜靜消失", () => {
  const text = buildReportDraft(
    context({ compare: [], topFlow: null }),
    ["compare", "odMatrix"],
  );
  assert.match(text, /跨計畫／多路口比較：目前範圍沒有可敘述的資料。/);
  assert.match(text, /OD 轉向矩陣：目前範圍沒有可敘述的資料。/);
});

test("駛入與駛出合計不一致時要照實寫，不能宣稱守恆", () => {
  const text = buildReportDraft(
    context({
      flowTotals: {
        outboundAm: 2900.6,
        outboundPm: 2720.9,
        inboundAm: 2800.6,
        inboundPm: 2720.9,
      },
    }),
    ["inboundOutbound"],
  );
  assert.match(text, /駛入與駛出合計不一致（上午差 -100.0、下午差 0.0 PCU\/hr）/);
  assert.doesNotMatch(text, /流向資料守恆/);
});

test("支線平衡有差值時會指出是哪一個路口、哪一個時段的哪一條支線", () => {
  const text = buildReportDraft(
    context({
      worstBalance: {
        station: "T-02 115Q3",
        peak: "PM",
        name: "路口D",
        difference: -42.5,
      },
    }),
    ["branchBalance"],
  );
  assert.match(text, /差值最大的是 T-02 115Q3 PM 尖峰的 路口D，駛入減駛出 -42.5 PCU\/hr/);
});

test("多組當量矩陣時不會列出單一組係數", () => {
  const text = buildReportDraft(context({ factorMatrixCount: 3 }), ["pce"]);
  assert.match(text, /共用到 3 組不同的當量矩陣/);
  assert.doesNotMatch(text, /機車 0.5／0.3／0.4/);
});

test("前一季為 0 時不會產生 Infinity 或 NaN", () => {
  const text = buildReportDraft(
    context({
      trend: [
        { quarter: "115Q3", am: 0, pm: 0 },
        { quarter: "115Q4", am: 2900.6, pm: 2720.9 },
      ],
    }),
    ["trend"],
  );
  assert.doesNotMatch(text, /Infinity|NaN/);
  // 前一季兩個時段都是 0，沒有百分比可算，整句就不該出現。
  assert.doesNotMatch(text, /較前一季/);
});

test("只有一季時只列出該季，不會硬算「較前一季」", () => {
  const text = buildReportDraft(
    context({ trend: [{ quarter: "115Q4", am: 2900.6, pm: 2720.9 }] }),
    ["trend"],
  );
  assert.match(text, /歷季趨勢（中正路口／平日）：115Q4/);
  assert.doesNotMatch(text, /較前一季/);
});

test("品質檢核有問題時會寫出項數與主要類別", () => {
  const text = buildReportDraft(
    context({
      quality: {
        total: 7,
        errors: 2,
        warnings: 5,
        topCategories: ["尖峰時段異常 4 項", "缺值 2 項"],
      },
    }),
    ["quality"],
  );
  assert.match(
    text,
    /資料品質檢核共 7 項（錯誤 2 項、警示 5 項），主要類別為 尖峰時段異常 4 項、缺值 2 項/,
  );
});

test("同一個路口的平日與假日不會被當成「兩個路口」拿來比較", () => {
  // compare 的每一列是「路口 × 資料別」，一個路口有平日與假日就是兩列。
  // 用列數判斷會讓單一路口的計畫也出現「各路口比較」，實際上那是日別比較。
  const text = buildReportDraft(
    context({
      compare: [
        { name: "中正路口 115Q4（平日）", am: 2900.6, pm: 2720.9 },
        { name: "中正路口 115Q4（假日）", am: 1800, pm: 1750 },
      ],
      compareIntersections: 1,
    }),
    ["compare"],
  );
  assert.match(text, /跨計畫／多路口比較：目前範圍沒有可敘述的資料。/);
});

test("舊版匯入（沒有流向）的紀錄不會被宣稱「資料守恆」", () => {
  // 沒有 routes 時駛入是用路口幾何推算的，兩側合計必然相等；
  // 宣稱守恆等於用同義反覆給使用者一個假的保證。
  const text = buildReportDraft(
    context({ routelessRecords: 3 }),
    ["inboundOutbound"],
  );
  assert.match(text, /有 3 筆為舊版匯入、缺少逐條起點→終點流向的紀錄/);
  assert.doesNotMatch(text, /流向資料守恆/);
});

test("完全沒有可檢查的守恆組數時會講原因，不會靜靜略過", () => {
  const text = buildReportDraft(
    context({ conservation: { checked: 0, passed: 0 }, routelessRecords: 2 }),
    ["branchBalance"],
  );
  assert.match(text, /無法進行轉向總量與流向總量的守恆檢核/);
});

test("支線平衡沒有資料時，守恆檢核那一行仍然會出現", () => {
  // 這是上一輪修掉的迴歸：舊寫法在 worstBalance 為 null 時整段早退，
  // 連帶把獨立的守恆檢核結果一起吃掉。
  const text = buildReportDraft(context({ worstBalance: null }), ["branchBalance"]);
  assert.match(text, /守恆檢核共檢查 16 組，通過 16 組。/);
});

test("前一季算不出來時不會宣稱上一季是 0", () => {
  // NaN 是 falsy，舊寫法會走進「由 0 增為 …」，等於在報告裡宣稱上一季零流量，
  // 而同一段的上一行才剛把它印成「—」（未知）。
  const text = buildReportDraft(
    context({
      trend: [
        { quarter: "115Q3", am: Number.NaN, pm: 100 },
        { quarter: "115Q4", am: 200, pm: 150 },
      ],
    }),
    ["trend"],
  );
  assert.match(text, /115Q3（AM —、PM 100.0 PCU\/hr）/);
  assert.match(text, /上午尖峰變動幅度無法計算（資料含非數值欄位）/);
  assert.doesNotMatch(text, /上午尖峰由 0 增為/);
  assert.doesNotMatch(text, /NaN|Infinity/);
});

test("分項結果超過上限時會說明還有幾筆", () => {
  const text = buildReportDraft(context({ siteOmitted: 5 }), ["sites"]);
  assert.match(text, /（另有 5 筆路口季度資料未逐筆列出，完整數字請見各工作表。）/);
});

test("計畫沒有名稱時不會產生空白開頭", () => {
  const text = buildReportDraft(context({ projectName: "" }), ["scope"]);
  assert.match(text, /（未命名計畫） 115Q1～115Q4 路口轉向交通量分析報告草稿/);
});
