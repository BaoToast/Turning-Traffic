/*
 * 歷季趨勢的可選指標、講稿與跨計畫比較。
 *
 * ── 這一支釘住的是什麼 ────────────────────────────────────────
 *
 * 趨勢圖是要給業主看的，使用者的原話：「資料正確性、圖表代表的意義很重要」。
 * 所以這裡守的不是「畫得出來」，而是三件會讓報告出錯的事：
 *
 *   一、算不出來的季度必須是 null，**絕對不可以是 0**。
 *       0 會被畫成折線掉到零、被寫進講稿、被抄進報告；「－」不會。
 *   二、講稿講的每一個數字，必須就是圖上那一份 series 的值。
 *       圖與文字分岔的時候，被念出來的是文字。
 *   三、跨計畫比較**不可以比總量**。各計畫路口數本來就不同，
 *       比總量只會證明「路口多的計畫比較大」。
 *
 * ── ⚠️ 假通過陷阱（這一支刻意迴避的）────────────────────────
 *
 * 一、只驗「回傳有值」不夠——回傳 0 也是有值，而 0 正是要擋的那一個。
 *     所以要**分辨 null 與 0**：真的量到 0 要留 0，算不出來要給 null。
 * 二、只驗「講稿有字」不夠——印任何字都會過。要驗講稿裡出現的數字
 *     **逐字等於** formatMetric 對同一份 series 算出來的字串。
 * 三、只驗「跨計畫有回傳」不夠——回傳總量也會過。要拿兩個路口數不同、
 *     但每路口平均相同的計畫，驗它們的值**相等**；若程式改回比總量，
 *     這一項會立刻紅（一個是另一個的三倍）。
 * 四、只驗「有 caveat」不夠——永遠印同一句也會過。要驗**沒有問題時
 *     不會亂講**，以及有問題時講的是**那一個**問題。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  TREND_METRICS,
  buildCrossProjectTrend,
  buildMetricSeries,
  completeQuarterRange,
  crossProjectScript,
  describeChange,
  findArm,
  formatMetric,
  metricLabel,
  metricUnit,
  metricValue,
  MAX_TREND_CHART_WIDTH,
  trendChartWidth,
  trendMetricById,
  trendScript,
} from "../lib/trend-metrics.ts";
import {
  type Approach,
  type Movement,
  type ScopeKey,
  type TrafficRecord,
  SCOPE_KEYS,
  scopeUnit,
} from "../lib/traffic.ts";

/* ── 測資 ─────────────────────────────────────────────────── */

function movement(
  left: number,
  through: number,
  right: number,
  vehicle: Record<string, number>,
): Movement {
  return { left, through, right, vehicle, rawVehicleTotal: null };
}

function arm(
  id: string,
  name: string,
  values: { left: number; through: number; right: number },
  vehicle: Record<string, number>,
): Approach {
  const movements = {} as Record<ScopeKey, Movement>;
  for (const key of SCOPE_KEYS)
    movements[key] = movement(values.left, values.through, values.right, vehicle);
  return {
    id,
    sourceCode: name.replace("路口", ""),
    name,
    bearing: "N",
    angle: 0,
    lanes: 2,
    capacity: null,
    movements,
  } as Approach;
}

/**
 * 一筆最小可用的紀錄。
 * fullDay 為 false 時代表調查不足 24 小時——那時候 DAY 一定要算不出來。
 */
function makeRecord(over: {
  quarter: string;
  fullDay?: boolean;
  arms?: Approach[];
  routes?: TrafficRecord["routes"];
  name?: string;
}): TrafficRecord {
  const arms =
    over.arms ||
    [
      arm("a1", "路口A", { left: 100, through: 200, right: 50 }, { motorcycle: 300, car: 100 }),
      arm("a2", "路口B", { left: 60, through: 140, right: 40 }, { motorcycle: 180, car: 60 }),
    ];
  return {
    id: "r-" + over.quarter,
    station: "A00T00-01",
    name: over.name || "示範一路－示範二路口",
    rawName: over.name || "示範一路－示範二路口",
    quarter: over.quarter,
    date: "",
    surveyType: "平日",
    survey: { intervals: 96, minutes: over.fullDay === false ? 240 : 1440, vehicle: {} },
    vehicleLabels: { motorcycle: "機車", car: "小型車" },
    peaks: {
      AM: { start: "07:00", end: "08:00" },
      PM: { start: "17:00", end: "18:00" },
      DAY: over.fullDay === false ? { start: "", end: "" } : { start: "08:00", end: "09:00" },
    },
    approaches: arms,
    routes: over.routes || [],
    sourceFiles: [],
  } as unknown as TrafficRecord;
}

const label = (q: string) => q;

/* ── 一、算不出來要是 null，不是 0 ──────────────────────────── */

test("調查不足 24 小時的季度，全日尖峰要回 null 而不是 0", () => {
  const record = makeRecord({ quarter: "115Q1", fullDay: false });
  const got = metricValue(record, trendMetricById("total"), "DAY", {}, "outbound");
  assert.equal(got.value, null, "算不出來就是算不出來，不可以退化成 0");
  assert.match(got.missingReason, /24 小時|全日尖峰/);
  /* 反面：AM 算得出來，同一筆同一支函式要給得出值。 */
  assert.ok(
    (metricValue(record, trendMetricById("total"), "AM", {}, "outbound").value || 0) > 0,
  );
});

test("真的量到 0 要保留 0，不可以跟「算不出來」混為一談", () => {
  const zeroArm = arm("a1", "路口A", { left: 0, through: 0, right: 0 }, { motorcycle: 0 });
  const record = makeRecord({ quarter: "115Q1", arms: [zeroArm] });
  const got = metricValue(record, trendMetricById("total"), "AM", {}, "outbound");
  assert.equal(got.value, 0, "量到 0 是一個真實的觀測值，要留著");
  assert.equal(got.missingReason, "");
});

test("沒有分母時，車種佔比要回 null 而不是 0%", () => {
  const noVehicle = arm("a1", "路口A", { left: 10, through: 10, right: 10 }, {});
  const record = makeRecord({ quarter: "115Q1", arms: [noVehicle] });
  const got = metricValue(
    record,
    trendMetricById("vehicleShare"),
    "AM",
    { key: "motorcycle" },
    "outbound",
  );
  assert.equal(got.value, null, "0% 會被讀成「一台都沒有」，事實是「沒有分母」");
  assert.match(got.missingReason, /分母/);
});

test("這一季找不到所選支線時要回 null 並說明原因，不可以當成 0", () => {
  const record = makeRecord({ quarter: "115Q1" });
  const got = metricValue(record, trendMetricById("arm"), "AM", { key: "路口Z" }, "outbound");
  assert.equal(got.value, null);
  assert.match(got.missingReason, /路口Z/);
  /* 反面：真的有的支線要找得到。 */
  assert.ok(findArm(record, "路口A"));
  assert.equal(
    metricValue(record, trendMetricById("arm"), "AM", { key: "路口A" }, "outbound").value,
    350,
  );
});

/* ── 二、指標本身 ──────────────────────────────────────────── */

test("路口總量等於各支線三個轉向的合計", () => {
  const record = makeRecord({ quarter: "115Q1" });
  const got = metricValue(record, trendMetricById("total"), "AM", {}, "outbound");
  assert.equal(got.value, 100 + 200 + 50 + 60 + 140 + 40);
});

test("單一轉向量是整個路口所有支線該轉向的合計", () => {
  const record = makeRecord({ quarter: "115Q1" });
  assert.equal(
    metricValue(record, trendMetricById("movement"), "AM", { key: "left" }, "outbound").value,
    160,
  );
  assert.equal(
    metricValue(record, trendMetricById("movement"), "AM", { key: "through" }, "outbound").value,
    340,
  );
});

test("實際車輛數與單一車種要分得開，佔比是兩者相除", () => {
  const record = makeRecord({ quarter: "115Q1" });
  assert.equal(
    metricValue(record, trendMetricById("vehicles"), "AM", {}, "outbound").value,
    300 + 100 + 180 + 60,
  );
  assert.equal(
    metricValue(record, trendMetricById("vehicleClass"), "AM", { key: "motorcycle" }, "outbound")
      .value,
    480,
  );
  const share = metricValue(
    record,
    trendMetricById("vehicleShare"),
    "AM",
    { key: "motorcycle" },
    "outbound",
  ).value as number;
  assert.ok(Math.abs(share - (480 / 640) * 100) < 1e-9);
});

test("只有會跟著駛出／駛入切換的指標才受 flow 影響", () => {
  const record = makeRecord({ quarter: "115Q1" });
  /* 車種類指標不分駛出駛入：切換 flow 不可以改變值。 */
  const a = metricValue(record, trendMetricById("vehicles"), "AM", {}, "outbound").value;
  const b = metricValue(record, trendMetricById("vehicles"), "AM", {}, "inbound").value;
  assert.equal(a, b);
  assert.equal(trendMetricById("vehicles").flowAware, false);
  assert.equal(trendMetricById("total").flowAware, true);
});

test("指標名稱要帶出選到的對象，圖標題、檔名與講稿才不會各寫各的", () => {
  assert.equal(
    metricLabel(trendMetricById("vehicleShare"), { key: "motorcycle" }),
    "機車佔比",
  );
  assert.equal(metricLabel(trendMetricById("arm"), { key: "路口A" }), "路口A 支線量");
  assert.equal(metricLabel(trendMetricById("movement"), { key: "left" }), "左轉量");
  /* 自訂車種要吃得到呼叫端傳進來的名稱表，不可以印出內部 id。 */
  assert.equal(
    metricLabel(trendMetricById("vehicleClass"), { key: "ebike" }, () => "電動自行車"),
    "電動自行車車輛數",
  );
});

/* ── 三、數字寫法 ──────────────────────────────────────────── */

test("百分比不空格、其餘空一格；算不出來一律「－」", () => {
  assert.equal(formatMetric(42.85, { unit: "%", digits: 1 }), "42.9%");
  assert.equal(formatMetric(1234, { unit: "PCU/hr", digits: 1 }), "1,234.0 PCU/hr");
  assert.equal(formatMetric(null, { unit: "%", digits: 1 }), "－");
});

test("變化要先給變化量再給倍數，不使用「個百分點」的說法", () => {
  const text = describeChange(14.3, 42.9, { unit: "%", digits: 1 });
  assert.match(text, /上升 28\.6%/);
  assert.match(text, /大約是原來的 3\.0 倍/);
  assert.doesNotMatch(text, /百分點/);
  assert.equal(describeChange(10, 10, { unit: "%", digits: 1 }), "持平");
  assert.match(describeChange(100, 50, { unit: "秒", digits: 0 }), /下降 50 秒/);
});

/* ── 四、講稿只讀 series ────────────────────────────────────── */

test("講稿裡的數字必須逐字等於 series 算出來的值", () => {
  const rows = [
    makeRecord({ quarter: "114Q1" }),
    makeRecord({
      quarter: "114Q2",
      arms: [
        arm("a1", "路口A", { left: 150, through: 250, right: 60 }, { motorcycle: 400, car: 120 }),
        arm("a2", "路口B", { left: 70, through: 160, right: 50 }, { motorcycle: 200, car: 70 }),
      ],
    }),
  ];
  const series = buildMetricSeries(rows, trendMetricById("total"), "AM", {}, "outbound");
  const script = trendScript(series, {
    intersectionName: "示範一路－示範二路口",
    surveyType: "平日",
    quarterLabel: label,
  });
  const body = script.map((s) => s.lines.join("")).join("");
  const first = formatMetric(series.valued[0].value, series);
  const last = formatMetric(series.valued[series.valued.length - 1].value, series);
  assert.ok(body.includes(first), `講稿要出現起點 ${first}`);
  assert.ok(body.includes(last), `講稿要出現終點 ${last}`);
  /* 起點終點都在，變化量才「說得通」——這是使用者特別要求的講法。 */
  assert.match(body, /整體上升|整體下降|持平/);
});

test("有季度算不出來時，講稿一定要主動講出來是哪一季、為什麼", () => {
  const rows = [
    makeRecord({ quarter: "114Q1" }),
    makeRecord({ quarter: "114Q2", fullDay: false }),
    makeRecord({ quarter: "114Q3" }),
  ];
  const series = buildMetricSeries(rows, trendMetricById("total"), "DAY", {}, "outbound");
  const script = trendScript(series, {
    intersectionName: "示範一路－示範二路口",
    surveyType: "平日",
    quarterLabel: label,
  });
  const caveats = script.find((s) => s.title === "要先講清楚的");
  assert.ok(caveats);
  assert.match(caveats.lines.join(""), /114Q2/);
  assert.match(caveats.lines.join(""), /24 小時/);
  assert.match(caveats.lines.join(""), /不要讓聽的人誤以為是下降|斷開/);
});

test("沒有問題時，注意事項不可以亂講一句", () => {
  const rows = ["114Q1", "114Q2", "114Q3", "114Q4"].map((q) => makeRecord({ quarter: q }));
  const series = buildMetricSeries(rows, trendMetricById("total"), "AM", {}, "outbound");
  const caveats = trendScript(series, {
    intersectionName: "示範一路－示範二路口",
    surveyType: "平日",
    quarterLabel: label,
  }).find((s) => s.title === "要先講清楚的");
  const text = caveats!.lines.join("");
  assert.doesNotMatch(text, /算不出來/);
  assert.doesNotMatch(text, /樣本太少/);
  assert.match(text, /每一季都算得出來/);
});

test("只有一季有值時，不可以講成「上升」或「下降」", () => {
  const series = buildMetricSeries(
    [makeRecord({ quarter: "114Q1" })],
    trendMetricById("total"),
    "AM",
    {},
    "outbound",
  );
  const body = trendScript(series, {
    intersectionName: "示範一路－示範二路口",
    surveyType: "平日",
    quarterLabel: label,
  })
    .map((s) => s.lines.join(""))
    .join("");
  assert.match(body, /一個點畫不出趨勢/);
});

test("駛出與駛入對不起來時，講稿要說在補齊之前兩種視角不可以混著講", () => {
  const rows = ["114Q1", "114Q2"].map((q) => makeRecord({ quarter: q }));
  const series = buildMetricSeries(rows, trendMetricById("total"), "AM", {}, "outbound");
  const text = trendScript(series, {
    intersectionName: "示範一路－示範二路口",
    surveyType: "平日",
    quarterLabel: label,
    flowGap: 250,
  })
    .find((s) => s.title === "要先講清楚的")!
    .lines.join("");
  assert.match(text, /250/);
  assert.match(text, /沒有指定目的支線/);
});

/* ── 五、跨計畫一律比平均，不比總量 ─────────────────────────── */

test("路口數不同但每路口平均相同的兩個計畫，跨計畫圖上要等高", () => {
  const one = ["114Q1", "114Q2"].flatMap((q) => [makeRecord({ quarter: q })]);
  /* 第二個計畫有三個路口，每一個都與第一個計畫那一個完全相同。 */
  const three = ["114Q1", "114Q2"].flatMap((q) => [
    makeRecord({ quarter: q, name: "示範路口一" }),
    makeRecord({ quarter: q, name: "示範路口二" }),
    makeRecord({ quarter: q, name: "示範路口三" }),
  ]);
  const trend = buildCrossProjectTrend(
    [
      { id: "p1", name: "一個路口的計畫", records: one },
      { id: "p3", name: "三個路口的計畫", records: three },
    ],
    trendMetricById("total"),
    "AM",
    {},
    "outbound",
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const a = trend.series[0].points[0];
  const b = trend.series[1].points[0];
  assert.equal(a.value, b.value, "比的是每路口平均；若改回比總量，這裡會變成 1:3");
  assert.equal(a.count, 1);
  assert.equal(b.count, 3, "N 要如實反映這一季有幾個路口算得出來");
});

test("跨計畫的車種佔比要用加權平均，不是把各路口的百分比再平均一次", () => {
  /* 大路口：機車 900／總 1000＝90%；小路口：機車 0／總 10＝0%。 */
  const big = makeRecord({
    quarter: "114Q1",
    name: "大路口",
    arms: [arm("a1", "路口A", { left: 1, through: 1, right: 1 }, { motorcycle: 900, car: 100 })],
  });
  const small = makeRecord({
    quarter: "114Q1",
    name: "小路口",
    arms: [arm("a1", "路口A", { left: 1, through: 1, right: 1 }, { motorcycle: 0, car: 10 })],
  });
  const trend = buildCrossProjectTrend(
    [{ id: "p", name: "計畫", records: [big, small] }],
    trendMetricById("vehicleShare"),
    "AM",
    { key: "motorcycle" },
    "outbound",
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const value = trend.series[0].points[0].value as number;
  /* 加權：900 ÷ 1010 ≒ 89.1%。若寫成 (90 + 0) / 2 就會是 45%。 */
  assert.ok(Math.abs(value - (900 / 1010) * 100) < 1e-9, `實際 ${value}`);
  assert.ok(value > 80, "算術平均會得到 45%，那讓一個 10 輛的路口與 1000 輛的路口同等份量");
  assert.match(trend.basis, /加權平均/);
});

test("跨計畫講稿一定要講出各計畫路口數不同這件事", () => {
  const trend = buildCrossProjectTrend(
    [
      { id: "p1", name: "計畫一", records: ["114Q1", "114Q2"].map((q) => makeRecord({ quarter: q })) },
      {
        id: "p2",
        name: "計畫二",
        records: ["114Q1", "114Q2"].flatMap((q) =>
          ["甲", "乙", "丙", "丁", "戊", "己"].map((n) =>
            makeRecord({ quarter: q, name: "示範路口" + n }),
          ),
        ),
      },
    ],
    trendMetricById("total"),
    "AM",
    {},
    "outbound",
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const text = crossProjectScript(trend, label)
    .map((s) => s.lines.join(""))
    .join("");
  assert.match(text, /不是總量|不是\*\*總量\*\*/);
  assert.match(text, /N=/);
  /* 1 個路口 vs 6 個路口＝差 6 倍，一定要提醒抖動幅度不能直接比。 */
  assert.match(text, /路口數差距很大|不具代表性/);
});

test("每一個指標都要有意義說明，否則講稿第一段會開天窗", () => {
  for (const metric of TREND_METRICS) {
    assert.ok(metric.meaning && metric.meaning.length > 10, metric.id);
    assert.ok(metric.label, metric.id);
  }
  /* 認不得的 id 要退回第一個指標，不可以回 undefined 讓呼叫端爆掉。 */
  assert.equal(trendMetricById("不存在的指標").id, TREND_METRICS[0].id);
});

/* ── 六、同一季同一路口不可以被算成兩筆 ─────────────────────── */

test("同一路口同一季有兩筆時，跨計畫只能算一筆（N 是路口數，不是筆數）", () => {
  /*
   * 這是使用者踩過的坑：平日與假日是**同時顯示**的兩條線，不是加總，
   * 也不是平均在一起。呼叫端會先把資料別過濾成單一種，這裡再驗最後一道
   * 防線——就算真的傳進同一個路口的兩筆，也只能算一筆。
   */
  const one = makeRecord({ quarter: "114Q1", name: "同一個路口" });
  const duplicate = {
    ...makeRecord({ quarter: "114Q1", name: "同一個路口" }),
    id: "r-dup",
    importedAt: "2026-01-02T00:00:00.000Z",
  } as TrafficRecord;
  const trend = buildCrossProjectTrend(
    [{ id: "p", name: "計畫", records: [one, duplicate] }],
    trendMetricById("total"),
    "AM",
    {},
    "outbound",
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const point = trend.series[0].points[0];
  assert.equal(point.count, 1, "N 要是路口數，不是筆數");
  /* 值要是那一個路口本身，不是兩筆的平均或加總。 */
  assert.equal(point.value, 590);
});

test("兩個不同路口才算兩筆", () => {
  const trend = buildCrossProjectTrend(
    [
      {
        id: "p",
        name: "計畫",
        records: [
          makeRecord({ quarter: "114Q1", name: "路口甲" }),
          makeRecord({ quarter: "114Q1", name: "路口乙" }),
        ],
      },
    ],
    trendMetricById("total"),
    "AM",
    {},
    "outbound",
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  assert.equal(trend.series[0].points[0].count, 2);
});

/* ── 缺季補齊 ────────────────────────────────────────────── */

test("頭尾之間整季沒有資料時要補成空格，X 軸間距才對應真實時間", () => {
  /*
   * ⚠️ 這一項守的是「兩個點緊鄰＝相隔一季」的讀法。某個路口只做了
   * 113Q1 與 114Q1 的話，不補的話 X 軸只有兩格，看圖的人會以為中間
   * 只隔一季，實際上隔了整整一年。
   */
  assert.deepEqual(completeQuarterRange(["113Q1", "114Q1"]), [
    "113Q1",
    "113Q2",
    "113Q3",
    "113Q4",
    "114Q1",
  ]);
  /* 沒有缺季時不可以動它。 */
  assert.deepEqual(completeQuarterRange(["113Q1", "113Q2"]), [
    "113Q1",
    "113Q2",
  ]);
  assert.deepEqual(completeQuarterRange(["113Q1"]), ["113Q1"]);
  assert.deepEqual(completeQuarterRange([]), []);
});

test("看不懂的期別、民國與西元混用時寧可不補，不可以亂猜寫法", () => {
  /*
   * ⚠️ 假通過陷阱：只驗「有缺季時會補」的話，把不認得的期別也硬套進
   * `<年>Q<季>` 的迴圈一樣會過——那會把使用者自訂的期別名稱整批換掉。
   */
  assert.deepEqual(completeQuarterRange(["113Q1", "第二次調查"]), [
    "113Q1",
    "第二次調查",
  ]);
  assert.deepEqual(completeQuarterRange(["113Q1", "2025Q1"]), [
    "113Q1",
    "2025Q1",
  ]);
  assert.deepEqual(completeQuarterRange(["2024Q3", "2025Q1"]), [
    "2024Q3",
    "2024Q4",
    "2025Q1",
  ]);
});

test("季度再多也不可以產生超過瀏覽器 canvas 安全範圍的超寬圖", () => {
  assert.equal(trendChartWidth(0), 780);
  assert.equal(trendChartWidth(44), 4580, "既有 44 季版面不應被縮小");
  assert.equal(trendChartWidth(401), MAX_TREND_CHART_WIDTH);
  assert.ok(trendChartWidth(10_000) <= 4800);
});

test("跨計畫圖補出來的空季是斷線，不是 0，也不會被當成樣本數最少的一季", () => {
  const trend = buildCrossProjectTrend(
    [
      {
        id: "a",
        name: "甲計畫",
        records: [
          makeRecord({ quarter: "113Q1", name: "路口甲" }),
          makeRecord({ quarter: "114Q1", name: "路口甲" }),
        ],
      },
    ],
    trendMetricById("total"),
    "AM",
    {},
    "outbound",
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  assert.deepEqual(trend.quarters, [
    "113Q1",
    "113Q2",
    "113Q3",
    "113Q4",
    "114Q1",
  ]);
  const points = trend.series[0].points;
  assert.equal(points.length, 5);
  /* 中間三季必須是 null——給 0 的話折線會掉到零，看起來像流量歸零。 */
  assert.equal(points[1].value, null);
  assert.equal(points[2].value, null);
  assert.equal(points[3].value, null);
  assert.notEqual(points[1].value, 0);
  /* 空季 N=0，不可以跑進「最少 0 個路口」那句小樣本警告。 */
  const body = crossProjectScript(trend, (q) => q)
    .flatMap((section) => section.lines)
    .join("\n");
  assert.ok(!/最少 0 /.test(body), "空季不可以被當成路口數最少的那一季");
});

/* ── 單位 ────────────────────────────────────────────────── */

test("趨勢圖的單位必須與全系統的 scopeUnit() 完全一致", () => {
  /*
   * ⚠️ 這一項是 GPT 複查時指出來的：舊版的守門「把尖峰車輛數單位接受成
   * 『輛』，未能攔住應為『輛/hr』的錯誤」。
   *
   * 成因是 metricUnit() 自己又寫了一套判斷，而且只寫對了一半：
   * PCU 有分（FULL → PCU、其餘 → PCU/hr），車輛數卻不分，一律回「輛」。
   * 三個尖峰的車輛數是**一小時內**的量，標成「輛」會被讀成一整天的量。
   *
   * 假通過陷阱：只驗「單位不是空字串」或「單位含『輛』」都擋不住舊版。
   * 要**逐一與 scopeUnit() 比對**——那才是全系統唯一的單位來源。
   */
  for (const metric of TREND_METRICS) {
    for (const scope of [...SCOPE_KEYS, "FULL"] as ScopeKey[]) {
      const actual = metricUnit(metric, scope);
      if (metric.unit === "%") {
        assert.equal(actual, "%", `${metric.id}／${scope}`);
        continue;
      }
      const expected = scopeUnit(
        scope,
        metric.unit === "vehicle" ? "vehicle" : "pcu",
      );
      assert.equal(actual, expected, `${metric.id}／${scope}`);
    }
  }
});

test("尖峰的車輛數單位一定要是「輛/hr」，全日時段才是「輛/調查日」", () => {
  /* 把上一項的重點單獨釘一次，紅字訊息才看得懂是哪一種組合錯了。 */
  const vehicles = TREND_METRICS.find((metric) => metric.id === "vehicles")!;
  assert.equal(metricUnit(vehicles, "AM"), "輛/hr");
  assert.equal(metricUnit(vehicles, "PM"), "輛/hr");
  assert.equal(metricUnit(vehicles, "DAY"), "輛/hr");
  assert.equal(metricUnit(vehicles, "FULL"), "輛/調查日");
  assert.notEqual(metricUnit(vehicles, "AM"), "輛");
});
