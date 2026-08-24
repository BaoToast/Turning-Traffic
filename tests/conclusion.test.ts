import test from "node:test";
import assert from "node:assert/strict";
import {
  CONCLUSION_METRICS,
  DEFAULT_CONDITION,
  buildConclusion,
  quarterKey,
  quarterYear,
  normalizeCondition,
  selectRecords,
  type ConclusionCondition,
  type ConclusionMetricKey,
  type ConclusionRecord,
} from "../lib/conclusion.ts";

const META = {
  projectName: "測試計畫",
  systemVersion: "v2.1.10",
  generatedAt: "2026-08-23 10:00",
};

function makeRecord(over: Partial<ConclusionRecord> = {}): ConclusionRecord {
  return {
    id: over.station + "-" + over.quarter,
    intersectionKey: "K1",
    station: "T15-01",
    name: "中山北路－岡山路口",
    quarter: "115Q2",
    surveyType: "平日",
    routeless: false,
    compositionScope: "全調查時段",
    compositionUnit: "輛/調查時段",
    composition: [
      { label: "機車", count: 4131 },
      { label: "小型車", count: 1766 },
      { label: "大型車", count: 90 },
    ],
    peaks: {
      AM: {
        window: "07:15–08:15",
        totalPcu: 1000,
        totalVehicles: 6012,
        branches: [
          {
            name: "路口A",
            outboundByVehicleSafe: [
              { label: "機車", count: 3000 },
              { label: "小型車", count: 1200 },
            ],
            inflowByVehicleSafe: [
              { label: "機車", count: 3400 },
              { label: "小型車", count: 1100 },
            ],
            twoWayByVehicleSafe: [
              { label: "機車", count: 6400 },
              { label: "小型車", count: 2300 },
            ],
            directionDisplay: "split",
            inflowPcu: 400,
            outflowPcu: 380,
            inflowVehicles: 741,
            outflowVehicles: 556,
            inflowFullDayVehicles: 12000,
            outflowFullDayVehicles: 11800,
          },
          {
            name: "路口B",
            outboundByVehicleSafe: null,
            inflowByVehicleSafe: null,
            twoWayByVehicleSafe: null,
            directionDisplay: "split",
            inflowPcu: 600,
            outflowPcu: 620,
            inflowVehicles: 548,
            outflowVehicles: 1969,
            inflowFullDayVehicles: null,
            outflowFullDayVehicles: null,
          },
        ],
      },
      PM: {
        window: "17:00–18:00",
        totalPcu: 1200,
        totalVehicles: 6500,
        branches: [
          {
            name: "路口A",
            outboundByVehicleSafe: null,
            inflowByVehicleSafe: null,
            twoWayByVehicleSafe: null,
            directionDisplay: "split",
            inflowPcu: 500,
            outflowPcu: 490,
            inflowVehicles: 852,
            outflowVehicles: 853,
            inflowFullDayVehicles: null,
            outflowFullDayVehicles: null,
          },
          {
            name: "路口B",
            outboundByVehicleSafe: null,
            inflowByVehicleSafe: null,
            twoWayByVehicleSafe: null,
            directionDisplay: "split",
            inflowPcu: 700,
            outflowPcu: 710,
            inflowVehicles: 1381,
            outflowVehicles: 686,
            inflowFullDayVehicles: null,
            outflowFullDayVehicles: null,
          },
        ],
      },
    },
    ...over,
  } as ConclusionRecord;
}

function cond(over: Partial<ConclusionCondition> = {}): ConclusionCondition {
  return { ...DEFAULT_CONDITION, ...over };
}

test("季度排序鍵：民國兩碼、三碼與西元四碼可以混排", () => {
  assert.ok(quarterKey("99Q4") < quarterKey("100Q1"));
  assert.ok(quarterKey("115Q1") < quarterKey("115Q2"));
  assert.equal(quarterKey("2026Q1"), quarterKey("115Q1"));
  assert.equal(quarterKey("亂碼"), Number.NEGATIVE_INFINITY);
  assert.equal(quarterYear("115Q2"), "115");
  assert.equal(quarterYear("亂碼"), "");
});

test("單季條件只留下那一季", () => {
  const records = [
    makeRecord({ quarter: "115Q1" }),
    makeRecord({ quarter: "115Q2" }),
    makeRecord({ quarter: "114Q4" }),
  ];
  const picked = selectRecords(
    records,
    cond({ scope: { kind: "quarter", quarter: "115Q2" } }),
  );
  assert.deepEqual(picked.map((r) => r.quarter), ["115Q2"]);
});

test("年度條件會涵蓋該年度的四季，且不會抓到別的年度", () => {
  const records = ["114Q1", "114Q2", "114Q3", "114Q4", "115Q1", "113Q4"].map(
    (quarter) => makeRecord({ quarter }),
  );
  const picked = selectRecords(
    records,
    cond({ scope: { kind: "year", year: "114" } }),
  );
  assert.deepEqual(
    picked.map((r) => r.quarter),
    ["114Q1", "114Q2", "114Q3", "114Q4"],
  );
});

test("季度區間含頭含尾，且起訖顛倒也能用", () => {
  const records = ["114Q3", "114Q4", "115Q1", "115Q2"].map((quarter) =>
    makeRecord({ quarter }),
  );
  const forward = selectRecords(
    records,
    cond({ scope: { kind: "range", from: "114Q4", to: "115Q1" } }),
  );
  assert.deepEqual(forward.map((r) => r.quarter), ["114Q4", "115Q1"]);
  const backward = selectRecords(
    records,
    cond({ scope: { kind: "range", from: "115Q1", to: "114Q4" } }),
  );
  assert.deepEqual(backward.map((r) => r.quarter), ["114Q4", "115Q1"]);
});

test("看不懂的季度字樣一律保留，不會被無聲濾掉", () => {
  const records = [makeRecord({ quarter: "114Q9" }), makeRecord({ quarter: "115Q1" })];
  const picked = selectRecords(
    records,
    cond({ scope: { kind: "range", from: "115Q1", to: "115Q2" } }),
  );
  assert.ok(picked.some((r) => r.quarter === "114Q9"));
});

test("路口與資料別條件會生效", () => {
  const records = [
    makeRecord({ intersectionKey: "K1", surveyType: "平日" }),
    makeRecord({ intersectionKey: "K2", station: "T15-02", surveyType: "平日" }),
    makeRecord({ intersectionKey: "K1", surveyType: "假日" }),
  ];
  assert.equal(selectRecords(records, cond({ intersectionKeys: ["K1"] })).length, 2);
  assert.equal(selectRecords(records, cond({ surveyTypes: ["假日"] })).length, 1);
  assert.equal(
    selectRecords(records, cond({ intersectionKeys: ["K1"], surveyTypes: ["平日"] })).length,
    1,
  );
});

test("使用者只勾「駛入流量＋百分比」時，草稿就只寫這兩項", () => {
  const text = buildConclusion(
    [makeRecord()],
    cond({
      scope: { kind: "quarter", quarter: "115Q2" },
      peaks: ["AM"],
      metrics: ["inflowPcu", "share"],
      grouping: "byIntersection",
    }),
    META,
  );
  assert.match(text, /駛入 400\.0 PCU\/hr/);
  assert.match(text, /佔駛入 40\.0%/);
  assert.doesNotMatch(text, /駛出/, "沒有勾駛出就不該出現駛出");
  assert.doesNotMatch(text, /下午尖峰/, "只勾 AM 就不該寫 PM");
  assert.doesNotMatch(text, /車種組成/);
});

test("勾了車輛數就會寫輛/hr，且不會把它寫成 PCU", () => {
  const text = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: ["inflowVehicles"] }),
    META,
  );
  assert.match(text, /駛入 741 輛\/hr/);
  assert.doesNotMatch(text, /741 PCU/);
});

test("車種組成會寫出輛數與百分比，百分比加起來是 100", () => {
  const text = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: ["composition"] }),
    META,
  );
  assert.match(text, /機車 4,131 輛\/調查時段（69\.0%）/);
  assert.match(text, /合計 5,987 輛\/調查時段/);
});

test("各支線各車種駛入／駛出：單位是輛/調查時段，且百分比以該側合計為分母", () => {
  const text = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: ["branchComposition"] }),
    META,
  );
  // 路口A：駛入 機車 3400、小型車 1100，合計 4500 → 機車 75.6%
  assert.match(text, /駛入各車種：機車 3,400（75\.6%）、小型車 1,100（24\.4%），合計 4,500 輛\/調查時段/);
  assert.match(text, /駛出各車種：機車 3,000（71\.4%）、小型車 1,200（28\.6%），合計 4,200 輛\/調查時段/);
  // 沒有逐流向調查明細的支線要明講，不能寫成 0
  assert.match(text, /路口B：[^\n]*沒有逐流向的調查明細/);
  assert.doesNotMatch(text, /路口B：[^\n]*合計 0 輛/);
});

test("呈現方式選「一律雙向合計」時，寫的是雙向合計那一列", () => {
  const text = buildConclusion(
    [makeRecord()],
    cond({
      peaks: ["AM"],
      metrics: ["branchComposition"],
      branchCompositionMode: "two-way",
    }),
    META,
  );
  // 雙向合計＝駛出＋駛入：機車 6400、小型車 2300，合計 8700
  assert.match(
    text,
    /雙向合計各車種：機車 6,400（73\.6%）、小型車 2,300（26\.4%），合計 8,700 輛\/調查時段/,
  );
  // 選了雙向合計就不該再分寫駛入／駛出兩段
  assert.doesNotMatch(text, /駛入各車種：機車/);
  assert.doesNotMatch(text, /駛出各車種：機車/);
});

test("呈現方式選「跟著車種組成分析頁」時，用該支線自己的設定", () => {
  const followSplit = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: ["branchComposition"] }),
    META,
  );
  assert.match(followSplit, /駛入各車種：機車 3,400/);

  /* 同一筆資料，只把該支線在分析頁的設定改成雙向合計 */
  const record = makeRecord();
  record.peaks.AM!.branches[0].directionDisplay = "two-way";
  const followTwoWay = buildConclusion(
    [record],
    cond({ peaks: ["AM"], metrics: ["branchComposition"] }),
    META,
  );
  assert.match(followTwoWay, /雙向合計各車種：機車 6,400/);
  assert.doesNotMatch(followTwoWay, /駛入各車種：機車/);
});

test("呈現方式選「一律分行車方向」時，不理會分析頁的雙向合計設定", () => {
  const record = makeRecord();
  record.peaks.AM!.branches[0].directionDisplay = "two-way";
  const text = buildConclusion(
    [record],
    cond({
      peaks: ["AM"],
      metrics: ["branchComposition"],
      branchCompositionMode: "split",
    }),
    META,
  );
  assert.match(text, /駛入各車種：機車 3,400/);
  assert.match(text, /駛出各車種：機車 3,000/);
  assert.doesNotMatch(text, /雙向合計各車種：/);
});

test("勾了各支線各車種時，標頭會寫明目前用的呈現方式", () => {
  const text = buildConclusion(
    [makeRecord()],
    cond({
      peaks: ["AM"],
      metrics: ["branchComposition"],
      branchCompositionMode: "two-way",
    }),
    META,
  );
  assert.match(text, /呈現方式：一律雙向合計/);
  /* 沒勾這個指標時不該多出這一句 */
  const without = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: ["inflowPcu"] }),
    META,
  );
  assert.doesNotMatch(without, /呈現方式：/);
});

test("各支線各車種的單位不會被寫成 輛/hr", () => {
  const text = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: ["branchComposition"] }),
    META,
  );
  const line = text.split("\n").find((l) => /駛入各車種/.test(l)) || "";
  assert.match(line, /輛\/調查時段/);
  assert.doesNotMatch(line, /輛\/hr/, line);
});

test("指定支線時只寫那一條", () => {
  const text = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: ["inflowPcu"], branchNames: ["路口B"] }),
    META,
  );
  assert.match(text, /路口B：駛入 600\.0 PCU\/hr/);
  assert.doesNotMatch(text, /路口A：/);
  assert.match(text, /只敘述指定支線：路口B/);
});

test("跨路口只比大小，明講不做加總", () => {
  const records = [
    makeRecord({ intersectionKey: "K1", station: "T15-01" }),
    makeRecord({
      intersectionKey: "K2",
      station: "T15-02",
      name: "岡山北路－育才路口",
      peaks: {
        AM: { window: "07:00–08:00", totalPcu: 2000, totalVehicles: 5000, branches: [] },
      },
    }),
  ];
  const text = buildConclusion(
    records,
    cond({ peaks: ["AM"], metrics: ["extremes"], grouping: "overall" }),
    META,
  );
  assert.match(text, /最高為 T15-02/);
  assert.match(text, /最低為 T15-01/);
  assert.match(text, /2 筆平均 1,500\.0 PCU\/hr/);
  assert.match(text, /不做加總/);
});

test("季度變動只在同一路口、同一尖峰之間計算", () => {
  const records = [
    makeRecord({ quarter: "114Q1", peaks: { AM: { window: "", totalPcu: 1000, totalVehicles: null, branches: [] } } }),
    makeRecord({ quarter: "114Q4", peaks: { AM: { window: "", totalPcu: 1250, totalVehicles: null, branches: [] } } }),
  ];
  const text = buildConclusion(
    records,
    cond({ scope: { kind: "year", year: "114" }, peaks: ["AM"], metrics: ["growth"] }),
    META,
  );
  assert.match(text, /由 114Q1 的 1,000\.0 PCU\/hr 變為 114Q4 的 1,250\.0 PCU\/hr/);
  assert.match(text, /增加 25\.0%/);
});

test("起始季為 0 時不寫出無限大的百分比", () => {
  const records = [
    makeRecord({ quarter: "114Q1", peaks: { AM: { window: "", totalPcu: 0, totalVehicles: null, branches: [] } } }),
    makeRecord({ quarter: "114Q2", peaks: { AM: { window: "", totalPcu: 500, totalVehicles: null, branches: [] } } }),
  ];
  const text = buildConclusion(
    records,
    cond({ peaks: ["AM"], metrics: ["growth"] }),
    META,
  );
  assert.match(text, /起始季為 0，變動幅度無法以百分比表示/);
  assert.doesNotMatch(text, /Infinity|NaN/);
});

test("缺值寫成「—」，不會變成 0 或 NaN", () => {
  const text = buildConclusion(
    [
      makeRecord({
        routeless: true,
        peaks: {
          AM: {
            window: "07:00–08:00",
            totalPcu: null,
            totalVehicles: null,
            branches: [
              {
                name: "路口A",
                outboundByVehicleSafe: null,
                inflowByVehicleSafe: null,
                twoWayByVehicleSafe: null,
                directionDisplay: "split",
                inflowPcu: null,
                outflowPcu: null,
                inflowVehicles: null,
                outflowVehicles: null,
                inflowFullDayVehicles: null,
                outflowFullDayVehicles: null,
              },
            ],
          },
        },
      }),
    ],
    cond({ peaks: ["AM"], metrics: ["inflowPcu", "total", "fullDay"] }),
    META,
  );
  assert.match(text, /駛入 — PCU\/hr/);
  assert.doesNotMatch(text, /NaN/);
  assert.match(text, /沒有逐流向（OD）資料/);
  assert.match(text, /全日數值需要完整 24 小時調查資料/);
});

test("條件挑不到資料時給的是可行動的說明，不是空白", () => {
  const text = buildConclusion(
    [makeRecord({ quarter: "115Q2" })],
    cond({ scope: { kind: "quarter", quarter: "113Q1" } }),
    META,
  );
  assert.match(text, /所選條件沒有對應的資料/);
  assert.match(text, /請放寬季度範圍/);
});

test("三種分段方式都寫得出東西，且標題會編號", () => {
  const records = [
    makeRecord({ quarter: "115Q1" }),
    makeRecord({ quarter: "115Q2" }),
  ];
  for (const grouping of ["byIntersection", "byQuarter", "overall"] as const) {
    const text = buildConclusion(
      records,
      cond({ peaks: ["AM"], metrics: ["total"], grouping }),
      META,
    );
    assert.match(text, /^1\. /m, `${grouping} 應該有第 1 段`);
    assert.ok(text.length > 120, `${grouping} 不應該幾乎空白`);
  }
});

test("整體模式會講清楚代表的是哪一筆", () => {
  const text = buildConclusion(
    [makeRecord({ quarter: "115Q1" }), makeRecord({ quarter: "115Q2" })],
    cond({ peaks: ["AM"], metrics: ["total"], grouping: "overall" }),
    META,
  );
  assert.match(text, /代表紀錄：115Q1/);
  assert.match(text, /僅以上列這一筆為代表/);
});

test("每一個可勾選指標都真的會改變輸出（沒有死選項）", () => {
  const records = [
    makeRecord({ quarter: "114Q1" }),
    makeRecord({ quarter: "114Q2" }),
    makeRecord({
      quarter: "114Q2",
      intersectionKey: "K2",
      station: "T15-02",
      name: "岡山北路－育才路口",
    }),
  ];
  const base = cond({ peaks: ["AM", "PM"], metrics: [], grouping: "byIntersection" });
  const empty = buildConclusion(records, base, META);
  for (const metric of CONCLUSION_METRICS) {
    const key = metric.key as ConclusionMetricKey;
    const text = buildConclusion(
      records,
      { ...base, metrics: [key] },
      META,
    );
    assert.notEqual(
      text,
      empty,
      `勾選「${metric.label}」之後輸出必須有變化，否則就是死選項`,
    );
  }
});

test("標頭一定寫明單位規則，避免有人把 PCU/hr 相加", () => {
  const text = buildConclusion([makeRecord()], cond(), META);
  assert.match(text, /僅在同一筆紀錄內可相加/);
  assert.match(text, /不同路口、不同季度之間只做比較，不做加總/);
});

/*
 * ── 季度變動必須在同一種資料別之內比較 ──
 *
 * 同一路口的同一季常常同時有平日與假日兩筆。只依季度排序的話，first/last
 * 會跨到不同的資料別，寫出「由 115Q1 的 3,000.0 變為 115Q1 的 1,200.0，
 * 減少 60.0%」——同一季自己跟自己比，比的還是平日對假日。
 * 這句話會被原封不動貼進正式報告。
 */
function typedRecord(quarter: string, surveyType: string, pcu: number) {
  const base = makeRecord();
  return {
    ...base,
    id: quarter + surveyType,
    quarter,
    surveyType,
    peaks: {
      AM: { ...base.peaks.AM!, totalPcu: pcu },
    },
  } as ConclusionRecord;
}

test("季度變動不會拿同一季的平日跟假日相比", () => {
  const text = buildConclusion(
    [typedRecord("115Q1", "平日", 3000), typedRecord("115Q1", "假日", 1200)],
    cond({ peaks: ["AM"], metrics: ["growth"] }),
    META,
  );
  assert.doesNotMatch(text, /由 115Q1 的 [\d,.]+ PCU\/hr 變為 115Q1/, text);
  assert.doesNotMatch(text, /減少 60\.0%/, text);
  assert.match(text, /未做季度比較/);
});

test("季度變動不會跨資料別（115Q1 平日 → 115Q2 假日）", () => {
  const text = buildConclusion(
    [
      typedRecord("115Q1", "平日", 3000),
      typedRecord("115Q2", "假日", 1300),
    ],
    cond({ peaks: ["AM"], metrics: ["growth"] }),
    META,
  );
  assert.doesNotMatch(text, /115Q1 的 3,000\.0 PCU\/hr 變為 115Q2 的 1,300\.0/, text);
});

test("同一種資料別有兩季時，照常算出變動幅度", () => {
  const text = buildConclusion(
    [
      typedRecord("115Q1", "平日", 3000),
      typedRecord("115Q2", "平日", 3300),
      typedRecord("115Q1", "假日", 1200),
      typedRecord("115Q2", "假日", 1500),
    ],
    cond({ peaks: ["AM"], metrics: ["growth"] }),
    META,
  );
  assert.match(text, /（平日）/);
  assert.match(text, /（假日）/);
  assert.match(text, /由 115Q1 的 3,000\.0 PCU\/hr 變為 115Q2 的 3,300\.0 PCU\/hr，增加 10\.0%/);
  assert.match(text, /由 115Q1 的 1,200\.0 PCU\/hr 變為 115Q2 的 1,500\.0 PCU\/hr，增加 25\.0%/);
});

/*
 * ── 舊版條件範本不可以讓整個分頁當掉 ──
 * 範本存在瀏覽器裡也會隨備份帶到別台電腦，而條件結構會隨版本長出新欄位。
 */
test("缺欄位的舊範本套用後不丟例外", () => {
  const legacy = {
    scope: { kind: "project" },
    peaks: ["AM"],
    metrics: ["total"],
    grouping: "byIntersection",
    digits: 1,
  } as unknown as ConclusionCondition;
  assert.doesNotThrow(() => selectRecords([makeRecord()], legacy));
  const text = buildConclusion([makeRecord()], legacy, META);
  assert.match(text, /【結論草稿】/);
  assert.doesNotMatch(text, /undefined|NaN/);
});

test("normalizeCondition 會補齊欄位並擋掉壞值", () => {
  const fixed = normalizeCondition({
    scope: { kind: "亂寫" } as never,
    peaks: [],
    grouping: "亂寫" as never,
    digits: Number.NaN,
    branchCompositionMode: "亂寫" as never,
  });
  assert.deepEqual(fixed.scope, { kind: "project" });
  assert.deepEqual(fixed.peaks, ["AM", "PM"]);
  assert.equal(fixed.grouping, "byIntersection");
  assert.equal(fixed.digits, 1);
  assert.equal(fixed.branchCompositionMode, "follow");
  assert.deepEqual(fixed.surveyTypes, []);
});

/* ── 「待設定」不可以被寫成一種資料別 ── */
test("待設定寫成「資料別未指定」，並在統計範圍另計筆數", () => {
  const text = buildConclusion(
    [typedRecord("115Q1", "平日", 3000), typedRecord("115Q2", "待設定", 3100)],
    cond({ peaks: ["AM"], metrics: ["total"] }),
    META,
  );
  assert.doesNotMatch(text, /資料別：平日、待設定/, text);
  assert.match(text, /尚未指定資料別/);
  assert.match(text, /115Q2・資料別未指定/);
});

/* ── 勾了指標卻寫不出來時，一定要交代原因，不能靜靜消失 ── */
test("三種敘述方式下，growth 與 extremes 寫不出來時都會說明", () => {
  for (const grouping of ["byIntersection", "byQuarter", "overall"] as const) {
    const text = buildConclusion(
      [makeRecord()],
      cond({ peaks: ["AM"], metrics: ["growth", "extremes"], grouping }),
      META,
    );
    assert.match(
      text,
      /未做季度比較|未做大小比較|不足/,
      `${grouping} 下勾了 growth／extremes 卻一個字都沒寫`,
    );
  }
});
