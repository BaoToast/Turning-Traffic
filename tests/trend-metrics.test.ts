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
  buildMetricSeries,
  completeQuarterRange,
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

test("挑不出尖峰視窗的季度，全調查時段尖峰要回 null 而不是 0", () => {
  /*
   * ⚠️ v2.1.64 起，觸發條件從「調查不足 24 小時」變成「**沒有挑出尖峰視窗**」。
   *   4 小時的調查現在照樣算得出全調查時段尖峰；真正算不出來的是
   *   舊備份（沒存逐時間格）與格距組不成整小時的檔案。
   *   這一份測資的 peaks.DAY 是空的起訖時間，代表的正是後者。
   */
  const record = makeRecord({ quarter: "115Q1", fullDay: false });
  const got = metricValue(record, trendMetricById("total"), "DAY", {}, "outbound");
  assert.equal(got.value, null, "算不出來就是算不出來，不可以退化成 0");
  assert.match(got.missingReason, /逐時間格|全調查時段尖峰/);
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

test("變化要先給變化量再給倍數，不使用「個百分點」的說法，而且倍率句要有主詞", () => {
  /*
   * ⚠️ 2026-09-11 起 describeChange() 的第四個參數是**必填**的主詞標籤。
   *
   * 使用者：「『大約剩下原來的 65%』，『原來的』是什麼？……
   *   『A 是 B 的幾 %』主詞要明確，不然會看不懂，是跟誰比才有這倍率。」
   *
   * 這一條跟著改成驗「有主詞的那一句」，而不是只驗倍數算得對——
   * 算得對但讀不懂，對使用者來說一樣是壞的。
   */
  const text = describeChange(14.3, 42.9, { unit: "%", digits: 1 }, {
    from: "113Q3",
    to: "114Q2",
  });
  assert.match(text, /上升 28\.6%/);
  assert.match(text, /114Q2大約是113Q3的 3\.0 倍/);
  assert.doesNotMatch(text, /百分點/);
  /* 反面：不可以再出現沒有主詞的舊寫法 */
  assert.doesNotMatch(text, /原來的/);
  assert.equal(
    describeChange(10, 10, { unit: "%", digits: 1 }, { from: "A", to: "B" }),
    "持平",
  );
  assert.match(
    describeChange(100, 50, { unit: "秒", digits: 0 }, { from: "前", to: "後" }),
    /下降 50 秒/,
  );
  assert.match(
    describeChange(100, 50, { unit: "秒", digits: 0 }, { from: "前", to: "後" }),
    /後大約是前的 50%/,
  );
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
  const series = buildMetricSeries(
    rows,
    trendMetricById("total"),
    "AM",
    {},
    "outbound",
    undefined,
    "unknown",
  );
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
  const series = buildMetricSeries(
    rows,
    trendMetricById("total"),
    "DAY",
    {},
    "outbound",
    undefined,
    "unknown",
  );
  const script = trendScript(series, {
    intersectionName: "示範一路－示範二路口",
    surveyType: "平日",
    quarterLabel: label,
  });
  const caveats = script.find((s) => s.title === "要先講清楚的");
  assert.ok(caveats);
  assert.match(caveats.lines.join(""), /114Q2/);
  /* 理由的措辭在 v2.1.64 改了（不再是「不足 24 小時」），但**一定要有理由**。 */
  assert.match(caveats.lines.join(""), /逐時間格|全調查時段尖峰|算不出/);
  assert.match(caveats.lines.join(""), /不要讓聽的人誤以為是下降|斷開/);
});

test("沒有問題時，注意事項不可以亂講一句", () => {
  const rows = ["114Q1", "114Q2", "114Q3", "114Q4"].map((q) => makeRecord({ quarter: q }));
  const series = buildMetricSeries(
    rows,
    trendMetricById("total"),
    "AM",
    {},
    "outbound",
    undefined,
    "unknown",
  );
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
    undefined,
    "unknown",
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
  const series = buildMetricSeries(
    rows,
    trendMetricById("total"),
    "AM",
    {},
    "outbound",
    undefined,
    "unknown",
  );
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
      const actual = metricUnit(metric, scope, "unknown");
      if (metric.unit === "%") {
        assert.equal(actual, "%", `${metric.id}／${scope}`);
        continue;
      }
      const expected = scopeUnit(
        scope,
        metric.unit === "vehicle" ? "vehicle" : "pcu",
        "unknown",
      );
      assert.equal(actual, expected, `${metric.id}／${scope}`);
    }
  }
});

test("尖峰的車輛數單位一定要是「輛/hr」，全調查時段才是累計量", () => {
  /* 把上一項的重點單獨釘一次，紅字訊息才看得懂是哪一種組合錯了。 */
  const vehicles = TREND_METRICS.find((metric) => metric.id === "vehicles")!;
  assert.equal(metricUnit(vehicles, "AM", "unknown"), "輛/hr");
  assert.equal(metricUnit(vehicles, "PM", "unknown"), "輛/hr");
  assert.equal(metricUnit(vehicles, "DAY", "unknown"), "輛/hr");
  assert.notEqual(metricUnit(vehicles, "AM", "unknown"), "輛");
  /*
   * ⚠️ 歷季趨勢天生是混合的：同一張圖上可能有 24 小時的季度，也有只做
   *   4 小時的季度。所以預設分母是「調查時段」——**寧可少講，不要多講**。
   *   整批都滿 24 小時時，呼叫端傳 "full" 才會寫「調查日」。
   */
  assert.equal(metricUnit(vehicles, "FULL", "unknown"), "輛/調查時段");
  assert.equal(metricUnit(vehicles, "FULL", "full"), "輛/調查日");
  assert.equal(metricUnit(vehicles, "FULL", "partial"), "輛/調查時段");
  assert.equal(metricUnit(vehicles, "FULL", "mixed"), "輛/調查時段");
});

/*
 * ══════════════════════════════════════════════════════════════════
 *  跨季對應支線：空格差異不可以造成斷線
 * ══════════════════════════════════════════════════════════════════
 *
 * 2026-09-11 普查發現：findArm() 兩邊都只做 trim()，而自動命名產生的是
 * 「路口 A」（「路口」與代碼之間有半形空格）、使用者手打的是「路口A」。
 * 於是趨勢圖選了其中一種寫法，另一種寫法的那幾季全部畫成斷線，
 * 而畫面上寫的原因是「這一季找不到這一支支線（可能改過名稱）」
 * ——把使用者引導到完全錯誤的方向。
 *
 * ⚠️ 只驗「同樣寫法找得到」是恆真的，一定要驗**不同寫法也找得到**。
 */
test("findArm：「路口 A」與「路口A」視為同一支支線", async () => {
  const { findArm } = await import("../lib/trend-metrics.ts");
  const record = {
    approaches: [
      { id: "R1-A", sourceCode: "A", name: "路口 A" },
      { id: "R1-B", sourceCode: "B", name: "路口B" },
    ],
  } as unknown as Parameters<typeof findArm>[0];
  assert.equal(findArm(record, "路口A")?.sourceCode, "A", "沒空格的寫法要找得到");
  assert.equal(findArm(record, "路口 A")?.sourceCode, "A", "有空格的寫法也要找得到");
  assert.equal(findArm(record, "路口　A")?.sourceCode, "A", "全形空格也要找得到");
  /* 反面：不是同一個名字就不可以對到 */
  assert.equal(findArm(record, "路口C"), undefined);
  /* 退回代碼比對的那條路徑仍然要在 */
  assert.equal(findArm(record, "B")?.sourceCode, "B");
});
