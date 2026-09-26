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
  type ConclusionScopeKey,
} from "../lib/conclusion.ts";

/* 樣本紀錄與 meta 抽到 helpers，跨系統守門測試共用同一份形狀。 */
import {
  CONCLUSION_META as META,
  CONCLUSION_META,
  makeRecord,
} from "./helpers/conclusion-record.ts";



/*
 * v2.1.23 以前的那一個鍵。
 *
 * v2.1.24 把它拆成 branchCompositionIn／branchCompositionOut 兩項，
 * normalizeCondition 會把舊鍵原地展開成兩項。下面幾支測試**刻意繼續用舊鍵**
 * ——它們原本就是釘住那段輸出的，現在同時變成「舊範本套用之後輸出不變」
 * 的迴歸保證。改成新鍵的話，這層保證就沒有了。
 *
 * 型別上舊鍵已經不在 ConclusionMetricKey 裡了，所以這裡明確轉型一次，
 * 而不是把它加回型別（加回去等於承認它還是個有效的選項）。
 */
const LEGACY_BRANCH_COMPOSITION = [
  "branchComposition",
] as unknown as ConclusionMetricKey[];

/*
 * 同理，v2.1.25 以前的 "share"（各支線佔路口總量百分比）。
 * 它只會展開成 shareIn，不是兩項——舊版的「佔駛出」那一支是死碼，
 * 從來沒有被寫出來過，展開成兩項反而會多出一段從沒有過的文字。
 * 下面那支測試斷言「沒有勾駛出就不該出現駛出」，正好把這件事釘住。
 */
const LEGACY_INFLOW_AND_SHARE = [
  "inflowPcu",
  "share",
] as unknown as ConclusionMetricKey[];

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
      metrics: LEGACY_INFLOW_AND_SHARE,
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
    cond({ peaks: ["AM"], metrics: LEGACY_BRANCH_COMPOSITION }),
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
      metrics: LEGACY_BRANCH_COMPOSITION,
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
    cond({ peaks: ["AM"], metrics: LEGACY_BRANCH_COMPOSITION }),
    META,
  );
  assert.match(followSplit, /駛入各車種：機車 3,400/);

  /* 同一筆資料，只把該支線在分析頁的設定改成雙向合計 */
  const record = makeRecord();
  record.peaks.AM!.branches[0].directionDisplay = "two-way";
  const followTwoWay = buildConclusion(
    [record],
    cond({ peaks: ["AM"], metrics: LEGACY_BRANCH_COMPOSITION }),
    META,
  );
  assert.match(followTwoWay, /雙向合計各車種：機車 6,400/);
  assert.doesNotMatch(followTwoWay, /駛入各車種：機車/);
});

/*
 * ── 佔比拆成兩個方向（v2.1.25）─────────────────────────────────
 */

test("舊的 share 只換成 shareIn，不會多出一段從沒有過的「佔駛出」", () => {
  const migrated = normalizeCondition(cond({ metrics: LEGACY_INFLOW_AND_SHARE }));
  assert.deepEqual(migrated.metrics, ["inflowPcu", "shareIn"]);
});

test("舊範本的佔比輸出，與拆分前逐字相同", () => {
  const viaLegacy = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: LEGACY_INFLOW_AND_SHARE }),
    META,
  );
  const viaSplit = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: ["inflowPcu", "shareIn"] }),
    META,
  );
  assert.equal(viaLegacy, viaSplit);
});

test("只勾駛出佔比時，寫的是佔駛出（舊版永遠寫不出這一行）", () => {
  const text = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: ["shareOut"] }),
    META,
  );
  assert.match(text, /佔駛出 /);
  assert.doesNotMatch(text, /佔駛入 /);
});

test("兩個佔比都勾時，兩行都寫，而且駛入排在駛出前面", () => {
  const text = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: ["shareIn", "shareOut"] }),
    META,
  );
  const line = text.split("\n").find((l) => /佔駛入 /.test(l)) || "";
  assert.match(line, /佔駛入 /);
  assert.match(line, /佔駛出 /);
  assert.ok(
    line.indexOf("佔駛入") < line.indexOf("佔駛出"),
    "駛入要排在駛出前面，順序才和其他成對的指標一致",
  );
});

test("兩個方向的佔比用同一個分母（路口總量），所以各自加總都是 100%", () => {
  /*
   * 分母相同是對的：駛入合計與駛出合計必然相等（同一批車依終點重新分組）。
   * 這一支釘住的是「不可以有人把駛出的分母偷偷換成別的東西」——
   * 換了之後每一格看起來都還是個合理的百分比，從畫面上看不出來。
   */
  const record = makeRecord();
  const peak = record.peaks.AM!;
  const total = peak.totalPcu!;
  const sumIn = peak.branches.reduce((s, b) => s + (b.inflowPcu || 0), 0);
  const sumOut = peak.branches.reduce((s, b) => s + (b.outflowPcu || 0), 0);
  assert.ok(Math.abs(sumIn - total) < 0.01, `駛入合計 ${sumIn} 應等於總量 ${total}`);
  assert.ok(Math.abs(sumOut - total) < 0.01, `駛出合計 ${sumOut} 應等於總量 ${total}`);
});

/*
 * ── 駛入／駛出拆成兩個勾選項（v2.1.24）──────────────────────────
 *
 * 上面幾支測試用的是舊鍵 LEGACY_BRANCH_COMPOSITION，它們釘住的是
 * 「兩個方向都要寫」時的輸出，也就是拆分前後必須完全一致的那一份。
 * 下面這幾支釘的是拆分後才有的新行為：各自單選。
 */

test("舊的 branchComposition 會展開成拆分後的兩項", () => {
  const migrated = normalizeCondition(
    cond({ metrics: LEGACY_BRANCH_COMPOSITION }),
  );
  assert.deepEqual(migrated.metrics, [
    "branchCompositionIn",
    "branchCompositionOut",
  ]);
  /* 展開之後就不該再留著舊鍵，否則每一處 wants() 都得記得認兩個鍵。 */
  assert.ok(!(migrated.metrics as string[]).includes("branchComposition"));
});

test("舊範本套用後的草稿，與拆分前的輸出逐字相同", () => {
  /*
   * 這一支是這次改動的核心保證：使用者既有的範本產生的文字不能有任何變化。
   * 比對整份草稿字串，不是只比對幾個 match——只比 match 的話，
   * 多寫了一段或少寫了一段都驗不出來。
   */
  const viaLegacy = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: LEGACY_BRANCH_COMPOSITION }),
    META,
  );
  const viaSplit = buildConclusion(
    [makeRecord()],
    cond({
      peaks: ["AM"],
      metrics: ["branchCompositionIn", "branchCompositionOut"],
    }),
    META,
  );
  assert.equal(viaLegacy, viaSplit);
});

test("只勾駛入時，草稿裡只有駛入那一段", () => {
  const text = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: ["branchCompositionIn"] }),
    META,
  );
  assert.match(text, /駛入各車種：機車 3,400（75\.6%）/);
  assert.doesNotMatch(text, /駛出各車種：/);
  assert.doesNotMatch(text, /雙向合計各車種：/);
});

test("只勾駛出時，草稿裡只有駛出那一段", () => {
  const text = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: ["branchCompositionOut"] }),
    META,
  );
  assert.match(text, /駛出各車種：機車 3,000（71\.4%）/);
  assert.doesNotMatch(text, /駛入各車種：/);
  assert.doesNotMatch(text, /雙向合計各車種：/);
});

test("只勾一個方向時，「雙向合計」不可以生效", () => {
  /*
   * 雙向合計是駛入＋駛出。使用者只要駛入，卻拿到把駛出也算進去的數字，
   * 那是**錯的數字**，比少寫一段嚴重得多——而且畫面上看不出來，
   * 因為它一樣會印出一行合理的文字。
   */
  for (const [key, wrong] of [
    ["branchCompositionIn", /駛出各車種：/],
    ["branchCompositionOut", /駛入各車種：/],
  ] as const) {
    const text = buildConclusion(
      [makeRecord()],
      cond({
        peaks: ["AM"],
        metrics: [key],
        branchCompositionMode: "two-way",
      }),
      META,
    );
    assert.doesNotMatch(text, /雙向合計各車種：/);
    assert.doesNotMatch(text, wrong);
  }
});

test("只勾一個方向時，標頭寫的是方向，不是沒生效的呈現方式", () => {
  const inOnly = buildConclusion(
    [makeRecord()],
    cond({
      peaks: ["AM"],
      metrics: ["branchCompositionIn"],
      branchCompositionMode: "two-way",
    }),
    META,
  );
  assert.match(inOnly, /只敘述駛入方向/);
  /* 那個設定沒有生效，就不可以照抄它的名稱，否則使用者會以為它生效了。 */
  assert.doesNotMatch(inOnly, /呈現方式：一律雙向合計/);

  const outOnly = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], metrics: ["branchCompositionOut"] }),
    META,
  );
  assert.match(outOnly, /只敘述駛出方向/);
});

test("呈現方式選「一律分行車方向」時，不理會分析頁的雙向合計設定", () => {
  const record = makeRecord();
  record.peaks.AM!.branches[0].directionDisplay = "two-way";
  const text = buildConclusion(
    [record],
    cond({
      peaks: ["AM"],
      metrics: LEGACY_BRANCH_COMPOSITION,
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
      metrics: LEGACY_BRANCH_COMPOSITION,
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
    cond({ peaks: ["AM"], metrics: LEGACY_BRANCH_COMPOSITION }),
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
  assert.match(text, /不做加總/);
  /*
   * ⚠️ 2026-09-16 起**不可以**再出現「N 筆平均」（使用者裁示：
   *   「每一行展示一筆季別+日別的結果……而不是要你平均起來」）。
   *   這一條是反面守門：平均加回來就會紅。
   */
  assert.ok(
    !/筆平均/.test(text),
    "結論草稿不可以再寫「N 筆平均」——跨路口、跨季別、跨日別的平均沒有意義",
  );
  assert.match(text, /不取平均/);
  /* 而且要**逐筆**列出（一行一個路口 × 季別 × 日別）。 */
  assert.match(text, /・T15-01[^\n]*：1,000\.0 PCU\/hr/);
  assert.match(text, /・T15-02[^\n]*：2,000\.0 PCU\/hr/);
});

test("跨路口逐筆列出：筆數太多時不列、而且一個合計或平均都不給", () => {
  /*
   * ⚠️ 超過上限時的正確行為是「說明還有幾筆」，**不是**改回給一個平均——
   *   那等於把剛剛拿掉的錯誤換個說法留著。
   */
  const records = Array.from({ length: 15 }, (_, index) =>
    makeRecord({
      intersectionKey: `K${index}`,
      station: `T15-${String(index).padStart(2, "0")}`,
      name: `示範路口${index}`,
      peaks: {
        AM: {
          window: "07:00–08:00",
          totalPcu: 1000 + index * 100,
          totalVehicles: 3000,
          branches: [],
        },
      },
    }),
  );
  const text = buildConclusion(
    records,
    cond({ peaks: ["AM"], metrics: ["extremes"], grouping: "overall" }),
    META,
  );
  assert.match(text, /共 15 筆，逐筆列出過長/);
  assert.ok(!/筆平均/.test(text), "超過上限時也不可以改回給平均");
  /* 最大最小仍然要寫得出來——那是在比大小，不是把數字混在一起。 */
  assert.match(text, /最高為 T15-14/);
  assert.match(text, /最低為 T15-00/);
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
                code: "A",
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
  /*
   * ⚠️ 2026-09-23 改：這一句原本寫「全日數值需要完整 24 小時調查資料」，
   *   而那是**錯的原因**——`inflowFullDayVehicles` 為 null 的唯一成因是
   *   「這一筆沒有逐支線的駛入／駛出明細」（本案例正是 routeless），
   *   涵蓋時數不足並不會讓它變成 null（24 小時門檻 2026-09-11 已移除）。
   *   照原本那樣寫，使用者會去補調查時數，而那補不出東西來。
   */
  assert.match(text, /沒有逐支線的駛入／駛出明細，算不出全調查時段流量/);
  assert.doesNotMatch(
    text,
    /需要完整 24 小時調查資料/,
    "又把「要滿 24 小時」寫回去了——那不是這個欄位為 null 的原因",
  );
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

test("⚠️ 稽核表 J：整體模式的代表紀錄是**最新一季**，而且說得出沒涵蓋到哪些", () => {
  /*
   * 舊版寫 `chosen.slice(0, 1)`，而 selectRecords() 是「季度由小到大」排序，
   * 所以代表紀錄一直是**最舊**的那一季——報告要引用的通常是最新一季，
   * 挑法連方向都相反，而畫面上只寫「代表紀錄：…」，看不出它是怎麼挑的。
   *
   * ⚠️ 兩件事要一起驗：
   *   ・挑的是最新一季（只驗「有寫代表紀錄」的話，挑最舊也會全綠——
   *     那正是舊版的狀態，而舊測試就是這樣寫的）
   *   ・其餘沒寫進這一段的那幾筆要被列出來（不然使用者不知道漏了什麼）
   */
  const text = buildConclusion(
    [makeRecord({ quarter: "115Q1" }), makeRecord({ quarter: "115Q2" })],
    cond({ peaks: ["AM"], metrics: ["total"], grouping: "overall" }),
    META,
  );
  assert.match(text, /代表紀錄：115Q2/, "要取最新一季，不是陣列的第一筆");
  assert.ok(
    !/代表紀錄：115Q1/.test(text),
    "最舊那一季不可以被當成代表紀錄",
  );
  assert.match(text, /最新的一季/, "要說明代表紀錄是怎麼挑的");
  assert.match(text, /僅以上列這一筆為代表/);
  assert.match(text, /沒有寫進這一段/, "要說出其餘幾筆沒被涵蓋");
  assert.match(text, /115Q1/, "要把沒涵蓋到的那一筆列出來");
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
  /*
   * 空的時段陣列**不是**壞值，是「不敘述尖峰時段」這個有效選擇，
   * 必須原樣保留。（缺欄位才補預設，另有一支測試涵蓋。）
   */
  assert.deepEqual(fixed.peaks, []);
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

/*
 * ── 時段可以一個都不選 ──
 *
 * 使用者的實際需求：只想要「車種組成（全調查時段）」那一行。
 * 但舊版強制「時段至少要留一個」，取消最後一個尖峰時會被自動加回去，
 * 於是草稿一定夾帶不要的尖峰段落，只能產生完再自己刪。
 *
 * 空陣列是有效的選擇，而且**不可以**在任何一層被偷偷補回預設值。
 */
test("兩個尖峰都不勾時，只寫車種組成，不寫任何尖峰段落", () => {
  const record = makeRecord({ station: "T15-01", quarter: "115Q2" });
  const text = buildConclusion([record], {
    ...DEFAULT_CONDITION,
    peaks: [],
    metrics: ["composition"],
  }, META);
  assert.match(text, /車種組成（全調查時段）/);
  assert.match(text, /敘述時段：不敘述尖峰時段/);
  assert.doesNotMatch(text, /上午尖峰/);
  assert.doesNotMatch(text, /下午尖峰/);
  /* 沒有尖峰就不會出現 PCU/hr，那句說明也不該印 */
  assert.doesNotMatch(text, /PCU\/hr 與 輛\/hr 是該尖峰/);
});

test("normalizeCondition 不可以把「刻意的空時段」補回預設", () => {
  const normalized = normalizeCondition({ ...DEFAULT_CONDITION, peaks: [] });
  assert.deepEqual(normalized.peaks, [], "空陣列要原樣保留");
});

test("舊範本缺 peaks 欄位時，仍然補上預設的上午＋下午", () => {
  const partial = { ...DEFAULT_CONDITION } as Partial<ConclusionCondition>;
  delete partial.peaks;
  const normalized = normalizeCondition(partial as ConclusionCondition);
  assert.deepEqual(normalized.peaks, DEFAULT_CONDITION.peaks);
});

test("四個時段都不勾又只選了時段底下的項目時，明講產生不出東西", () => {
  const record = makeRecord({ station: "T15-01", quarter: "115Q2" });
  const text = buildConclusion([record], {
    ...DEFAULT_CONDITION,
    peaks: [],
    metrics: ["total", "inflowPcu"],
  }, META);
  assert.match(text, /一個都沒有勾/);
  /*
   * ⚠️ 這句話要把**四個**時段的名字都寫出來。
   *   v2.1.80 的版本只叫使用者「去勾一個尖峰時段」，而使用者要的
   *   「全調查時段」當時根本不是一顆可以勾的東西。
   */
  for (const label of [
    "上午尖峰",
    "下午尖峰",
    "全調查時段",
    "全調查時段尖峰",
  ])
    assert.ok(text.includes(label), `提示沒有寫出「${label}」：${text}`);
  assert.match(text, /車種組成/);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  A14／A17：「全調查時段」是第四個可以勾的選項，而且真的接得上數字
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-21：「正確做法應該是把全調查時段做為第 4 個可勾選選項吧?」
 */
test("⚠️ 勾「全調查時段」要寫得出數字，而且單位不可以是 /hr", () => {
  const record = makeRecord({ station: "T15-01", quarter: "115Q2" });
  record.peaks.FULL = {
    window: "實測 4 小時（非 24 小時）",
    totalPcu: 12345,
    totalVehicles: 20000,
    branches: [
      {
        code: "A",
        name: "路口A",
        outboundByVehicleSafe: null,
        inflowByVehicleSafe: null,
        twoWayByVehicleSafe: null,
        directionDisplay: "split",
        inflowPcu: 3000,
        outflowPcu: 3000,
        inflowVehicles: 5000,
        outflowVehicles: 5000,
        inflowFullDayVehicles: null,
        outflowFullDayVehicles: null,
      },
    ],
  };
  const text = buildConclusion(
    [record],
    { ...DEFAULT_CONDITION, peaks: ["FULL"], metrics: ["total", "inflowPcu"] },
    META,
  );
  assert.match(text, /全調查時段/);
  assert.match(text, /12,345\.0 PCU\/調查時段/);
  assert.doesNotMatch(
    text,
    /12,345\.0 PCU\/hr/,
    "把整段的累計量寫成一小時的流率——這句話會被抄進報告",
  );
  assert.match(text, /20,000 輛\/調查時段/);
});

test("⚠️ 上午尖峰與全調查時段可以同時勾（舊版做不到）", () => {
  const record = makeRecord({ station: "T15-01", quarter: "115Q2" });
  record.peaks.FULL = {
    window: "實測 4 小時（非 24 小時）",
    totalPcu: 12345,
    totalVehicles: 20000,
    branches: [],
  };
  const text = buildConclusion(
    [record],
    { ...DEFAULT_CONDITION, peaks: ["AM", "FULL"], metrics: ["total"] },
    META,
  );
  assert.match(text, /上午尖峰/);
  assert.match(text, /全調查時段/);
  assert.match(
    text,
    /不可以相加/,
    "同時出現兩種單位卻沒有提醒不可相加",
  );
});

test("⚠️ 混合 24 小時與部分時段紀錄時，單位說明要列出正文實際使用的兩種分母", () => {
  const full = makeRecord({ station: "T15-01", quarter: "115Q2" });
  const partial = makeRecord({ station: "T15-02", quarter: "115Q2" });
  full.surveyCoverage = "full";
  partial.surveyCoverage = "partial";
  for (const record of [full, partial])
    record.peaks.FULL = {
      window: "全調查時段",
      totalPcu: 1000,
      totalVehicles: 1500,
      branches: [],
    };
  const text = buildConclusion(
    [full, partial],
    { ...DEFAULT_CONDITION, peaks: ["FULL"], metrics: ["total"] },
    META,
  );
  for (const unit of ["PCU／調查日", "PCU／調查時段", "輛／調查日", "輛／調查時段"])
    assert.match(text, new RegExp(unit), `單位說明漏掉 ${unit}`);
});

test("有勾時段時，行為與原本完全相同", () => {
  const record = makeRecord({ station: "T15-01", quarter: "115Q2" });
  const before = buildConclusion([record], {
    ...DEFAULT_CONDITION,
    peaks: ["AM", "PM"],
  }, META);
  assert.match(before, /上午尖峰/);
  assert.match(before, /下午尖峰/);
  assert.match(before, /敘述時段：上午尖峰、下午尖峰。/);
});

/*
 * ══════════════════════════════════════════════════════════════════
 *  支線用「名稱」篩，而且看起來一樣的名字就要算同一個
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11 的兩段回報，合起來才是完整的需求：
 *
 *   ①「我把自動抓到的名字手動同步名稱……在『四、要寫哪些支線』
 *      他竟然把自訂義的名稱也獨立變成一個選項了。」
 *   ②「A 和 B 路段用預設名稱『路口A』就能正常抓到；C 路段自動讀到
 *      『神農路口』，**就算我手動改成『路口A』，也不會被歸類到路口A裡面**，
 *      除非我把 A、B 也手動輸入一次一模一樣的『路口A』。」
 *
 * 成因：inferApproachGeometry() 自動命名寫的是 `"路口 " + code`
 * ——「路口」和代碼之間**有一個半形空格**。使用者手打的是「路口A」。
 * `路口 A` ≠ `路口A`，於是被當成兩條不同的支線。
 *
 * ⚠️ 解法**不是**改成用支線代碼分類。使用者明確否決過：
 *   「假設哪一天檔案第一條支線其實是路口D，只是這份資料不小心被挪到了
 *     第一支線的位置，原本我希望我可以自己手動去修改名稱後，
 *     讓程式把同樣名稱歸類在一起，現在反而作不到。」
 *   代碼是檔案給的位置，名稱才是使用者可以修正的事實。
 */
test("名字看起來一樣就算同一條：自動的「路口 A」與手打的「路口A」要一起選到", () => {
  const renamed = makeRecord({
    intersectionKey: "K2",
    station: "T15-02",
    peaks: {
      AM: {
        window: "07:15–08:15",
        totalPcu: 900,
        totalVehicles: 5000,
        branches: [
          {
            /* 這一筆排在第一欄，但使用者把它改名成 D——名稱才算數 */
            code: "A",
            name: "路口D",
            outboundByVehicleSafe: null,
            inflowByVehicleSafe: null,
            twoWayByVehicleSafe: null,
            directionDisplay: "split",
            inflowPcu: 111,
            outflowPcu: 112,
            inflowVehicles: 113,
            outflowVehicles: 114,
            inflowFullDayVehicles: null,
            outflowFullDayVehicles: null,
          },
          {
            code: "B",
            /* 自動命名的樣子：中間有一個半形空格 */
            name: "路口 A",
            outboundByVehicleSafe: null,
            inflowByVehicleSafe: null,
            twoWayByVehicleSafe: null,
            directionDisplay: "split",
            inflowPcu: 221,
            outflowPcu: 222,
            inflowVehicles: 223,
            outflowVehicles: 224,
            inflowFullDayVehicles: null,
            outflowFullDayVehicles: null,
          },
        ],
      },
    },
  });
  /* 使用者勾的是他看到的「路口A」（沒有空格） */
  const text = buildConclusion(
    [makeRecord(), renamed],
    cond({ peaks: ["AM"], branchNames: ["路口A"], metrics: ["inflowPcu"] }),
    META,
  );
  assert.match(text, /400/, "第一個路口原本就叫路口A 的那一條要在");
  assert.match(
    text,
    /221/,
    "另一個路口自動命名成「路口 A」（有空格）的那一條也要在——這是修的東西",
  );
  /* 反面：被改名成「路口D」的那一條不可以混進來（哪怕它排在第一欄） */
  assert.doesNotMatch(text, /111/, "名稱不是路口A 的支線不可以被選到");
});

test("支線挪錯位置時，改名之後就歸到正確的那一類", () => {
  const shifted = makeRecord({
    intersectionKey: "K3",
    station: "T15-03",
    peaks: {
      AM: {
        window: "07:15–08:15",
        totalPcu: 900,
        totalVehicles: 5000,
        branches: [
          {
            /* 資料排在第一欄（代碼 A），但它其實是路口D，使用者已改名 */
            code: "A",
            name: "路口D",
            outboundByVehicleSafe: null,
            inflowByVehicleSafe: null,
            twoWayByVehicleSafe: null,
            directionDisplay: "split",
            inflowPcu: 777,
            outflowPcu: 778,
            inflowVehicles: 779,
            outflowVehicles: 780,
            inflowFullDayVehicles: null,
            outflowFullDayVehicles: null,
          },
        ],
      },
    },
  });
  const text = buildConclusion(
    [shifted],
    cond({ peaks: ["AM"], branchNames: ["路口D"], metrics: ["inflowPcu"] }),
    META,
  );
  assert.match(text, /777/, "依名稱選得到，不受它排在第幾欄影響");
});

test("全形／空白差異不影響比對", () => {
  for (const typed of ["路口 A", "路口　A", "路口A", "　路口A　"]) {
    const text = buildConclusion(
      [makeRecord()],
      cond({ peaks: ["AM"], branchNames: [typed], metrics: ["inflowPcu"] }),
      META,
    );
    assert.match(text, /400/, `「${typed}」應該要選到路口A`);
  }
});

test("條件摘要寫的是支線的原名，不可以露出內部比對鍵", () => {
  /*
   * ⚠️ 這一則守的是我自己 2026-09-11 差點交出去的東西：
   *   branchNames 改存比對鍵（小寫、去空白）之後，摘要那一行如果直接
   *   把陣列 join 出來，草稿裡會出現「只敘述指定支線：路口a」——
   *   小寫的 a。草稿是會被整段貼進報告的。
   */
  const text = buildConclusion(
    [makeRecord()],
    cond({ peaks: ["AM"], branchNames: ["路口 A"], metrics: ["inflowPcu"] }),
    META,
  );
  assert.match(text, /只敘述指定支線：路口A。/);
  assert.doesNotMatch(text, /路口a/, "不可以印出小寫的比對鍵");
});

test("大小寫算不同的名稱（排版差異吸收，內容差異不吸收）", async () => {
  /*
   * 使用者 2026-09-11：「路口A 和路口a、路口 a 會判定同名稱嗎？
   *   我建議是判定是不同，因為這不是比對前『正規化』的意思。」
   *
   * 分界：空格與全半形是**排版雜訊**，大小寫是**內容**。
   * ⚠️ 這一則同時擋兩個方向——正規化不足（空格沒吸收）與正規化過頭
   *   （把不同的名字併在一起），兩種都是錯的。
   */
  const { typedNameKey } = await import("../lib/conclusion.ts");
  /* 要吸收的：空格（含中間與全形）、全形英數字 */
  assert.equal(typedNameKey("路口 A"), typedNameKey("路口A"));
  assert.equal(typedNameKey("路口　A"), typedNameKey("路口A"));
  assert.equal(typedNameKey(" 路口A "), typedNameKey("路口A"));
  assert.equal(typedNameKey("路口Ａ"), typedNameKey("路口A"), "全形 Ａ 要收斂成半形");
  /* 不可以吸收的：大小寫 */
  assert.notEqual(typedNameKey("路口A"), typedNameKey("路口a"));
  assert.notEqual(typedNameKey("路口A"), typedNameKey("路口 a"));
  /* 不同的名字當然還是不同 */
  assert.notEqual(typedNameKey("路口A"), typedNameKey("路口B"));
  assert.notEqual(typedNameKey("神農路口"), typedNameKey("路口A"));
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  A15：支線篩選必須真的對「車種組成」生效
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-21 回報：「勾選路口A或B或全選，文字結果都一樣」，
 * 而草稿抬頭同時印著「只敘述指定支線：路口 B」。
 * 抬頭說有篩、內容沒篩，整個路口的數字會被當成該支線的數字抄進報告。
 */
test("⚠️ 勾了支線，車種組成要跟著換數字，不可以照印路口合計", () => {
  const record = makeRecord({ station: "T15-01", quarter: "115Q2" });
  record.compositionByBranch = [
    {
      code: "A",
      name: "路口A",
      items: [
        { label: "機車", count: 1000 },
        { label: "小型車", count: 400 },
      ],
    },
    {
      code: "B",
      name: "路口B",
      items: [
        { label: "機車", count: 3131 },
        { label: "小型車", count: 1366 },
      ],
    },
  ];
  const base = { ...DEFAULT_CONDITION, peaks: [], metrics: ["composition"] as const };
  const all = buildConclusion([record], { ...base, metrics: ["composition"] }, META);
  const onlyA = buildConclusion(
    [record],
    { ...base, metrics: ["composition"], branchNames: ["路口A"] },
    META,
  );
  const onlyB = buildConclusion(
    [record],
    { ...base, metrics: ["composition"], branchNames: ["路口B"] },
    META,
  );
  assert.notEqual(onlyA, onlyB, "勾不同支線寫出一模一樣的字");
  assert.notEqual(onlyA, all, "勾了支線和全選寫出一模一樣的字");
  assert.match(onlyA, /1,000/);
  assert.doesNotMatch(onlyA, /3,131/, "路口A 的段落裡出現了路口B 的數量");
  assert.match(onlyB, /3,131/);
  assert.doesNotMatch(onlyB, /1,000 /, "路口B 的段落裡出現了路口A 的數量");
});

test("⚠️ 篩不了的時候要講出來，不可以靜靜地印路口合計", () => {
  const record = makeRecord({ station: "T15-01", quarter: "115Q2" });
  record.compositionByBranch = null; /* 雙向合計呈現，沒有可安全相加的逐支線值 */
  const text = buildConclusion(
    [record],
    {
      ...DEFAULT_CONDITION,
      peaks: [],
      metrics: ["composition"],
      branchNames: ["路口A"],
    },
    META,
  );
  assert.match(
    text,
    /沒有依指定支線篩選/,
    "抬頭寫著只敘述指定支線，內容卻是路口合計，而且沒有任何說明",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  A18：混合勾選的組合測試（測試盲區）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-21 的盤點結果：這支檔案原本有 54 項測試，
 * 其中「一次勾 3 項以上」的組合**只有 1 項**，而且時段只勾過
 * ["AM"] 與 ["AM","PM"]，**沒有一支勾過第三個**。
 *
 * 三個真實缺陷（A14、A15、A17）全部躲在同一個盲區裡：
 *   ・A17：`peaks` 只建了 AM 與 PM，勾「全調查時段尖峰」永遠沒數字
 *   ・A15：支線篩選對「車種組成」無效（測試只用會吃篩選的 inflowPcu）
 *   ・A14：「不勾時段」的測試用的 metrics 全是時段底下的，
 *          從來沒測過「一個不依附時段的＋幾個依附時段的」混合
 *
 * ⚠️ **只斷言「草稿不是空的」不算數**——出事的那幾份草稿本來就不是空的。
 *   這裡逐一斷言**每一個勾起來的項目都真的寫出來了**。
 */

/** 造一筆四個時段都有資料、而且逐支線車種也有的紀錄。 */
function fullRecord() {
  const record = makeRecord({ station: "T15-09", quarter: "115Q2" });
  const branch = (code: string, name: string, base: number) => ({
    code,
    name,
    outboundByVehicleSafe: [
      { label: "機車", count: base * 2 },
      { label: "小型車", count: base },
    ],
    inflowByVehicleSafe: [
      { label: "機車", count: base * 3 },
      { label: "小型車", count: base },
    ],
    twoWayByVehicleSafe: null,
    directionDisplay: "split" as const,
    inflowPcu: base,
    outflowPcu: base + 10,
    inflowVehicles: base * 4,
    outflowVehicles: base * 4 + 10,
    inflowFullDayVehicles: base * 20,
    outflowFullDayVehicles: base * 20,
  });
  for (const [key, label] of [
    ["AM", "07:00–08:00"],
    ["PM", "17:00–18:00"],
    ["DAY", "17:15–18:15"],
    ["FULL", "實測 12 小時（非 24 小時）"],
  ] as const) {
    record.peaks[key] = {
      window: label,
      totalPcu: 1000,
      totalVehicles: 4000,
      branches: [branch("A", "路口A", 100), branch("B", "路口B", 300)],
    };
  }
  record.compositionByBranch = [
    { code: "A", name: "路口A", items: [{ label: "機車", count: 1000 }] },
    { code: "B", name: "路口B", items: [{ label: "小型車", count: 2222 }] },
  ];
  return record;
}

test("⚠️ 四個時段全勾：每一個都要寫出來，而且單位各自正確", () => {
  const text = buildConclusion(
    [fullRecord()],
    {
      ...DEFAULT_CONDITION,
      peaks: ["AM", "PM", "FULL", "DAY"],
      metrics: ["total", "peakHour"],
    },
    META,
  );
  for (const label of ["上午尖峰", "下午尖峰", "全調查時段", "全調查時段尖峰"])
    assert.ok(text.includes(label), `草稿裡沒有「${label}」`);
  assert.match(text, /PCU\/調查時段/, "全調查時段寫成了 /hr");
  assert.match(text, /PCU\/hr/, "尖峰的單位不見了");
  assert.doesNotMatch(
    text,
    /這一筆沒有(上午尖峰|下午尖峰|全調查時段|全調查時段尖峰)的資料/,
    "有時段接在空的地方——勾了卻永遠得不到數字",
  );
});

test("⚠️ 混合勾選：依附時段的與不依附時段的一起勾，兩邊都要寫出來", () => {
  /*
   * 使用者實際踩到的組合：時段＋車種組成＋各支線各車種駛入／駛出＋支線篩選。
   */
  const text = buildConclusion(
    [fullRecord()],
    {
      ...DEFAULT_CONDITION,
      peaks: ["AM", "FULL"],
      branchNames: ["路口B"],
      metrics: [
        /* 不依附時段 */
        "composition",
        /* 依附時段 */
        "total",
        "inflowPcu",
        "branchCompositionIn",
        "branchCompositionOut",
      ],
    },
    META,
  );
  /* 每一個勾起來的項目都要真的出現。 */
  assert.match(text, /車種組成/, "勾了車種組成卻沒有寫");
  assert.match(text, /總流量/, "勾了路口總流量卻沒有寫");
  assert.match(text, /駛入 /, "勾了各支線駛入流量卻沒有寫");
  assert.match(text, /上午尖峰/);
  assert.match(text, /全調查時段/);
  /* 支線篩選要真的生效（A15）：路口B 的 2,222 要在、路口A 的 1,000 不可以在。 */
  assert.match(text, /2,222/, "支線篩選沒有套到車種組成上");
  assert.doesNotMatch(
    text,
    /1,000 輛/,
    "勾了路口B，草稿裡卻出現路口A 的車種數量",
  );
  /* 同時寫駛入與駛出時要提醒不可相加（A20）。 */
  assert.match(text, /不可以相加/, "同時寫兩個方向卻沒有提醒");
});

test("⚠️ 只勾不依附時段的項目、時段一個都不勾：仍要產得出內容", () => {
  /*
   * 這是 A14 之前那個隱藏狀態的替代路徑：時段都不勾是允許的，
   * 但「要寫哪些數字」裡得有不依附時段的項目。
   * 舊測試用的 metrics 全是時段底下的，從來沒測過這一條真的走得通。
   */
  const text = buildConclusion(
    [fullRecord()],
    { ...DEFAULT_CONDITION, peaks: [], metrics: ["composition"] },
    META,
  );
  assert.match(text, /車種組成/);
  assert.doesNotMatch(
    text,
    /一個都沒有勾/,
    "勾了不依附時段的項目，卻還是說產不出東西",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  尖峰時段判定方式：各方向各自認定（使用者 2026-09-23 核准新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 舊版的結論草稿一律以「整個調查點同一時段」計算，並在草稿裡明講做不到
 * 另一種，理由寫著「一筆紀錄裝不下三份」。那個理由是錯的——`peaks` 本來
 * 就按時段分開存，每一個時段可以各自吃自己那一份重挑過的紀錄。
 *
 * 這一組守三件事：
 *   ① 預設（point）時輸出與改版前**逐字相同**——一個字都不可以多。
 *   ② 選 direction 時每一條支線要寫出自己的視窗，而且要印出不可相加的警告。
 *   ③ 算不出自己視窗的支線要**明講算不出來**，不可以靜靜地沿用路口的視窗。
 */
function withPeakWindows(
  windows: Record<string, string | null | undefined>,
): ConclusionRecord {
  const record = makeRecord({ station: "A00T00-01", quarter: "115Q2" });
  for (const scope of ["AM", "PM"] as const)
    for (const branch of record.peaks[scope]!.branches)
      branch.peakWindow = windows[branch.code];
  return record;
}

const PEAK_RULE_CONDITION = {
  ...DEFAULT_CONDITION,
  scope: { kind: "project" as const },
  peaks: ["AM"] as ConclusionScopeKey[],
  metrics: ["total", "inflowPcu", "peakHour"] as ConclusionMetricKey[],
  grouping: "byIntersection" as const,
};

test("⚠️ 預設「整個調查點同一時段」時，輸出與改版前逐字相同", () => {
  const text = buildConclusion(
    [makeRecord({ station: "A00T00-01", quarter: "115Q2" })],
    { ...PEAK_RULE_CONDITION, peakRule: "point" },
    CONCLUSION_META,
  );
  assert.match(text, /07:15–08:15/, "路口層級的尖峰視窗不見了");
  assert.doesNotMatch(text, /自己最忙/, "沒選各方向各自認定卻寫了支線視窗");
  assert.doesNotMatch(text, /算不出這條支線/, "沒選各方向各自認定卻寫了算不出來");
  assert.match(
    text,
    /尖峰時段判定方式：整個調查點同一時段/,
    "草稿沒有寫出用的是哪一種判定方式",
  );
  assert.doesNotMatch(text, /不適用「相加」/, "可以相加的那一種不該印不可相加的警告");
});

test("⚠️ 選「各方向各自認定」時，每一條支線要寫出自己最忙的時段", () => {
  const text = buildConclusion(
    [withPeakWindows({ A: "07:15–08:15", B: "17:30–18:30" })],
    { ...PEAK_RULE_CONDITION, peakRule: "direction" },
    CONCLUSION_META,
  );
  assert.match(text, /路口A（自己最忙 07:15–08:15）/, text);
  assert.match(text, /路口B（自己最忙 17:30–18:30）/, text);
});

test("⚠️ 選「各方向各自認定」時，一定要印出「不可以相加」", () => {
  const text = buildConclusion(
    [withPeakWindows({ A: "07:15–08:15", B: "17:30–18:30" })],
    { ...PEAK_RULE_CONDITION, peakRule: "direction" },
    CONCLUSION_META,
  );
  /*
   * 這是這個判定方式最容易被誤讀的地方：各支線的尖峰不在同一小時，
   * 加起來不是任何一個時刻的量。畫面與報告文字草稿都印著同一句警告，
   * 結論草稿不可以是唯一沒印的那一個。
   */
  assert.match(text, /本數值不適用「相加」/, text);
  assert.match(text, /各方向各自認定自己的尖峰/, text);
});

test("⚠️ 算不出自己視窗的支線要明講，不可以靜靜沿用整個路口的視窗", () => {
  const text = buildConclusion(
    [withPeakWindows({ A: "07:15–08:15", B: null })],
    { ...PEAK_RULE_CONDITION, peakRule: "direction" },
    CONCLUSION_META,
  );
  assert.match(text, /路口A（自己最忙 07:15–08:15）/, text);
  assert.match(
    text,
    /路口B（這一筆算不出這條支線自己的尖峰，改用整個路口的時段）/,
    "算不出來卻沒說——讀者會以為它和路口A 走同一個視窗\n" + text,
  );
});

test("⚠️ 舊範本沒有 peakRule 欄位時，回「整個調查點同一時段」", () => {
  const withoutRule: Record<string, unknown> = {
    ...(PEAK_RULE_CONDITION as Record<string, unknown>),
  };
  delete withoutRule.peakRule;
  assert.equal(
    normalizeCondition(withoutRule as never).peakRule,
    "point",
    "舊範本套用之後突然換了一套數字",
  );
  assert.equal(normalizeCondition({ peakRule: "亂寫" } as never).peakRule, "point");
  assert.equal(
    normalizeCondition({ peakRule: "direction" } as never).peakRule,
    "direction",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  支線佔比的車輛數版本（使用者 2026-09-23 核准新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 「各路口駛入／駛出流量」那張表在「顯示數值＝車輛數＋百分比」時，
 * 百分比是拿**車輛數**算的；草稿的 shareIn／shareOut 永遠拿 PCU 算。
 * 同一個支線、同一個時段，兩種分母算出來是不同的數字——
 * 表格查得到，草稿寫不出來。
 */
test("⚠️ 支線佔比的車輛數版本，分母是總車輛數不是總 PCU", () => {
  const record = makeRecord({ station: "A00T00-01", quarter: "115Q2" });
  const text = buildConclusion(
    [record],
    {
      ...PEAK_RULE_CONDITION,
      metrics: ["shareInVehicles", "shareOutVehicles"] as ConclusionMetricKey[],
    },
    CONCLUSION_META,
  );
  /*
   * 樣本：AM 的 totalVehicles = 6012；路口A 駛入 741、駛出 556。
   *   741 / 6012 = 12.3%   556 / 6012 = 9.2%
   * 若誤用 totalPcu（1000）當分母會得到 74.1%／55.6%——差很多，一看就分得出來。
   */
  assert.match(text, /路口A：佔駛入車輛數 12\.3%；佔駛出車輛數 9\.2%/, text);
  assert.doesNotMatch(text, /74\.1%|55\.6%/, "分母用成 PCU 了");
});

test("⚠️ 車輛數版本與 PCU 版本要分得出來，不可以都寫「佔駛入」", () => {
  const text = buildConclusion(
    [makeRecord({ station: "A00T00-01", quarter: "115Q2" })],
    {
      ...PEAK_RULE_CONDITION,
      metrics: [
        "shareIn",
        "shareInVehicles",
      ] as ConclusionMetricKey[],
    },
    CONCLUSION_META,
  );
  /* 同一行裡兩個不同分母的百分比並排，名稱一定要不同。 */
  assert.match(text, /佔駛入 40\.0%/, text);
  assert.match(text, /佔駛入車輛數 12\.3%/, text);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  分析範圍要寫「涵蓋 N 個調查日」（使用者 2026-09-23 核准新增）
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 同一天做的多個路口只算一個調查日", () => {
  const text = buildConclusion(
    [
      makeRecord({ station: "A00T00-01", quarter: "115Q2", surveyDate: "2026-05-12" }),
      makeRecord({ station: "A00T00-02", quarter: "115Q2", surveyDate: "2026-05-12", intersectionKey: "K2" }),
      makeRecord({ station: "A00T00-03", quarter: "115Q2", surveyDate: "2026-05-19", intersectionKey: "K3" }),
    ],
    PEAK_RULE_CONDITION,
    CONCLUSION_META,
  );
  assert.match(text, /共 3 筆調查紀錄（涵蓋 2 個調查日）/, text);
});

test("⚠️ 讀不到日期的紀錄不計入，而且要講出來", () => {
  const text = buildConclusion(
    [
      makeRecord({ station: "A00T00-01", quarter: "115Q2", surveyDate: "2026-05-12" }),
      makeRecord({ station: "A00T00-02", quarter: "115Q2", intersectionKey: "K2" }),
    ],
    PEAK_RULE_CONDITION,
    CONCLUSION_META,
  );
  assert.match(text, /涵蓋 1 個調查日，另有 1 筆讀不到調查日期/, text);
});

test("⚠️ 一筆日期都讀不到時整段不寫，不可以寫「0 個調查日」", () => {
  const text = buildConclusion(
    [makeRecord({ station: "A00T00-01", quarter: "115Q2" })],
    PEAK_RULE_CONDITION,
    CONCLUSION_META,
  );
  assert.doesNotMatch(text, /調查日/, text);
});
