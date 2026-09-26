/*
 * ══════════════════════════════════════════════════════════════════════
 *  結論草稿產生器：全條件覆蓋盤點（使用者 2026-09-23 指定）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者的話（這一支存在的理由）：
 *   「因為圖表很多，使用者更多是依賴結論草稿產生器，所以針對結論草稿產生器
 *     以及報表草稿產生器，**功能正常運作等同於數值正確性一樣重要**」
 *   「只要程式查的到的數值，結論草稿產生器應該都能讓使用者勾選對應條件後，
 *     產出正確的數值，不要再出現如同我上次在路口轉向系統，找不到我要的結果」
 *
 * ── 這一支在防哪四種缺陷（都真的發生過）────────────────────────────
 *
 *   ① **勾了卻什麼都沒寫**（A17：`peaks` 只建了 AM/PM，勾 DAY 永遠沒數字）
 *   ② **抬頭說有篩、內容沒篩**（A15：支線篩選對車種組成無效）
 *   ③ **根本勾不到**（A14：「全調查時段」以前是靠「都不勾」表達的隱藏狀態）
 *   ④ **單位跟著錯**（全調查時段是累計量，寫成 PCU/hr 會被抄進報告）
 *
 * ── 為什麼要用「矩陣」而不是逐項寫測試 ──────────────────────────
 *
 *   前三個缺陷都是**單獨勾都對、組合起來才出事**，而且它們能活下來，
 *   正是因為測試是一項一項手寫的——沒有人會想到去寫那個組合。
 *   這裡改成**把每一個指標 × 每一個時段跑一遍**，由程式回報哪一格是空的。
 *   新增指標或時段時，這張矩陣會自動把它算進去。
 *
 * ⚠️ 判定一律用**該指標特有的字樣**，不是「草稿不是空的」——
 *   出事的草稿本來就不是空的。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCLUSION_METRICS,
  DEFAULT_CONDITION,
  buildConclusion,
  type ConclusionMetricKey,
  type ConclusionRecord,
  type ConclusionScopeKey,
} from "../lib/conclusion.ts";
import { CONCLUSION_META as META, makeRecord } from "./helpers/conclusion-record.ts";

const SCOPES: ConclusionScopeKey[] = ["AM", "PM", "FULL", "DAY"];

/** 一條支線，欄位全部填滿（缺欄位會讓「沒寫出來」變成測資問題而不是缺陷）。 */
function branch(code: string, name: string, base: number) {
  return {
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
    twoWayByVehicleSafe: [{ label: "機車", count: base * 5 }],
    directionDisplay: "split" as const,
    inflowPcu: base,
    outflowPcu: base + 7,
    inflowVehicles: base * 4,
    outflowVehicles: base * 4 + 7,
    inflowFullDayVehicles: base * 20,
    outflowFullDayVehicles: base * 20,
  };
}

/** 一筆四個時段都有資料、逐支線車種也有的紀錄。 */
function rich(over: Partial<ConclusionRecord> = {}): ConclusionRecord {
  const record = makeRecord({
    station: "A00T00-01",
    name: "示範北路－示範一路口",
    quarter: "115Q2",
    ...over,
  });
  const windows: Record<ConclusionScopeKey, string> = {
    AM: "07:00–08:00",
    PM: "17:00–18:00",
    DAY: "17:15–18:15",
    FULL: "實測 12 小時（非 24 小時）",
  };
  for (const scope of SCOPES)
    record.peaks[scope] = {
      window: windows[scope],
      totalPcu: 1000 + SCOPES.indexOf(scope) * 100,
      totalVehicles: 4000 + SCOPES.indexOf(scope) * 100,
      branches: [branch("A", "路口A", 100), branch("B", "路口B", 300)],
    };
  record.compositionByBranch = [
    { code: "A", name: "路口A", items: [{ label: "機車", count: 1111 }] },
    { code: "B", name: "路口B", items: [{ label: "小型車", count: 2222 }] },
  ];
  return record;
}

/*
 * 每一個指標**特有**的字樣。
 *
 * ⚠️ 這張表要與 CONCLUSION_METRICS 一一對應：下面有一支測試釘住
 *   「新增指標時不可以忘記在這裡登記」——忘了登記的話，
 *   矩陣會安靜地少驗一格，而那正是這一支要防的事。
 */
const MARKS: Record<ConclusionMetricKey, RegExp> = {
  inflowPcu: /駛入 [\d,.]+ (PCU\/hr|PCU\/調查(?:日|時段))/,
  outflowPcu: /駛出 [\d,.]+ (PCU\/hr|PCU\/調查(?:日|時段))/,
  inflowVehicles: /駛入 [\d,]+ (輛\/hr|輛\/調查(?:日|時段))/,
  outflowVehicles: /駛出 [\d,]+ (輛\/hr|輛\/調查(?:日|時段))/,
  /*
   * ⚠️ PCU 版本的字樣要**排除**車輛數版本，不可以只寫 /佔駛入/——
   *   那樣只勾車輛數版本時 PCU 那一格也會被判定成「有寫」，
   *   兩格互相冒充，矩陣等於少驗兩格。
   */
  shareIn: /佔駛入 [\d.]+%/,
  shareOut: /佔駛出 [\d.]+%/,
  shareInVehicles: /佔駛入車輛數 [\d.]+%/,
  shareOutVehicles: /佔駛出車輛數 [\d.]+%/,
  total: /總流量/,
  peakHour: /(\d{2}:\d{2}–\d{2}:\d{2}|實測)/,
  composition: /車種組成/,
  branchCompositionIn: /駛入各車種|雙向合計各車種/,
  branchCompositionOut: /駛出各車種|雙向合計各車種/,
  balance: /駛入減駛出/,
  /*
   * ⚠️ 2026-09-23 一併改。舊字樣 `/全日駛(入|出)|全日數值/` 會吃下
   *   「全日數值需要完整 24 小時調查資料，這一筆沒有」這句**明講自己
   *   寫不出數字**的話，所以那一格其實是半個假的綠。
   *   現在認的是真的印出數字＋單位的那一段。
   */
  fullDay: /全調查時段駛(入|出) [\d,]+ 輛\/調查(?:日|時段)/,
  growth: /(增加|減少|變動幅度|由 .* 的)/,
  extremes: /(最高為|最低為)/,
};

const KEYS = CONCLUSION_METRICS.map((metric) => metric.key);

test("MARKS 與 CONCLUSION_METRICS 一一對應（新增指標不可以漏登記）", () => {
  assert.deepEqual(
    [...KEYS].sort(),
    Object.keys(MARKS).sort(),
    "有指標沒有登記判定字樣——下面的矩陣會少驗一格而且不會有人發現",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ 每一個判定字樣都必須**分辨得出來**（對照組：一個指標都不勾）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-23 在姊妹專案交通服務水準上抓到：它的 12 格覆蓋矩陣**有 5 格恆真**
 * ——草稿的固定抬頭本來就含「旅行速率」「行駛速率」「服務水準」「速限」「筆」
 * 這幾個詞，所以那幾個指標壞成什麼樣都會是綠的。
 *
 * 這一支是同一種病的**通用疫苗**：把 metrics 設成空陣列（一個指標都不勾），
 * 這時候草稿裡不可以出現任何一個指標的判定字樣。出現了就代表那個字樣
 * 認的是固定文字，不是那個指標的輸出。
 *
 * ⚠️ 要放在矩陣**前面**：矩陣全綠但字樣是恆真的，比矩陣紅還糟。
 */
test("⚠️ 判定字樣必須分辨得出來：一個指標都不勾時，一個字樣都不可以命中", () => {
  const records = [
    rich({ quarter: "115Q1" }),
    rich({ quarter: "115Q2" }),
  ];
  const bogus: string[] = [];
  for (const grouping of ["byIntersection", "overall"] as const)
    for (const scope of SCOPES) {
      const blank = buildConclusion(
        records,
        {
          ...DEFAULT_CONDITION,
          scope: { kind: "project" },
          peaks: [scope],
          metrics: [],
          grouping,
        },
        META,
      );
      for (const key of KEYS)
        if (MARKS[key].test(blank))
          bogus.push(`${key}（時段 ${scope}／分組 ${grouping}）：${MARKS[key]}`);
    }
  assert.deepEqual(
    [...new Set(bogus)],
    [],
    "這些判定字樣在「一個指標都不勾」時就已經命中——\n" +
      "它們認的是草稿的固定文字，不是那個指標的輸出，\n" +
      "所以矩陣裡對應的那幾格是**恆真**的，指標壞掉也不會紅：\n  " +
      [...new Set(bogus)].join("\n  "),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ① 矩陣：每一個指標 × 每一個時段，都要真的寫得出東西
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 矩陣：每一個指標在四個時段底下都寫得出內容", () => {
  /* 跨季指標（growth／extremes）要兩季以上才有意義，所以測資給兩季。 */
  const records = [
    rich({ quarter: "115Q1" }),
    rich({ quarter: "115Q2" }),
    rich({
      quarter: "115Q2",
      station: "A00T00-02",
      name: "示範南路－示範二路口",
      intersectionKey: "K2",
    }),
  ];
  const holes: string[] = [];
  for (const scope of SCOPES)
    for (const key of KEYS) {
      const text = buildConclusion(
        records,
        {
          ...DEFAULT_CONDITION,
          scope: { kind: "project" },
          peaks: [scope],
          metrics: [key],
          grouping: key === "extremes" ? "overall" : "byIntersection",
        },
        META,
      );
      if (!MARKS[key].test(text))
        holes.push(
          `時段「${scope}」＋指標「${key}」：勾了卻寫不出內容\n--- 草稿 ---\n${text}\n---`,
        );
    }
  assert.deepEqual(
    holes,
    [],
    `有 ${holes.length} 種勾選組合產不出內容：\n\n${holes.join("\n\n")}`,
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ② 單位：全調查時段是累計量，其餘三個是一小時的流率
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 全調查時段的單位是 /調查時段，其餘三個是 /hr", () => {
  const base = {
    ...DEFAULT_CONDITION,
    scope: { kind: "project" as const },
    metrics: ["total", "inflowPcu", "inflowVehicles"] as ConclusionMetricKey[],
  };
  const full = buildConclusion([rich()], { ...base, peaks: ["FULL"] }, META);
  assert.match(full, /PCU\/調查時段/);
  assert.match(full, /輛\/調查時段/);
  assert.doesNotMatch(
    full,
    /PCU\/hr/,
    "把一整段的累計量寫成一小時的流率——這句話會被抄進報告",
  );
  for (const scope of ["AM", "PM", "DAY"] as ConclusionScopeKey[]) {
    const text = buildConclusion([rich()], { ...base, peaks: [scope] }, META);
    assert.match(text, /PCU\/hr/, `${scope} 的單位不是 /hr`);
    assert.doesNotMatch(
      text,
      /PCU\/調查時段/,
      `${scope} 是某一個小時的流率，不可以寫成 /調查時段`,
    );
  }
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ③ 篩選：宣稱有篩就要真的篩到（抬頭不可以說謊）
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 支線篩選：勾不同支線一定要寫出不同的數字", () => {
  const record = rich();
  const base = {
    ...DEFAULT_CONDITION,
    scope: { kind: "project" as const },
    peaks: ["AM"] as ConclusionScopeKey[],
  };
  /* 逐支線的每一種指標都要吃到篩選，不是只有其中一種。 */
  for (const metrics of [
    ["inflowPcu"],
    ["outflowPcu"],
    ["inflowVehicles"],
    ["shareIn"],
    ["balance"],
    ["branchCompositionIn"],
    ["composition"],
  ] as ConclusionMetricKey[][]) {
    const onlyA = buildConclusion(
      [record],
      { ...base, metrics, branchNames: ["路口A"] },
      META,
    );
    const onlyB = buildConclusion(
      [record],
      { ...base, metrics, branchNames: ["路口B"] },
      META,
    );
    assert.notEqual(
      onlyA,
      onlyB,
      `指標「${metrics[0]}」：勾路口A 與勾路口B 寫出一模一樣的字——抬頭說有篩、內容沒篩`,
    );
    assert.match(onlyA, /只敘述指定支線/);
  }
});

test("⚠️ 路口篩選：勾一個路口不可以寫出另一個路口", () => {
  const records = [
    rich({ intersectionKey: "K1", station: "A00T00-01", name: "示範北路口" }),
    rich({ intersectionKey: "K2", station: "A00T00-02", name: "示範南路口" }),
  ];
  const text = buildConclusion(
    [...records],
    {
      ...DEFAULT_CONDITION,
      scope: { kind: "project" },
      peaks: ["AM"],
      metrics: ["total"],
      intersectionKeys: ["K1"],
    },
    META,
  );
  assert.match(text, /示範北路口/);
  assert.doesNotMatch(text, /示範南路口/, "路口篩選沒有生效");
});

test("⚠️ 資料別篩選：勾平日不可以寫出假日", () => {
  const records = [
    rich({ surveyType: "平日" }),
    rich({ surveyType: "假日", station: "A00T00-02", intersectionKey: "K2" }),
  ];
  const text = buildConclusion(
    [...records],
    {
      ...DEFAULT_CONDITION,
      scope: { kind: "project" },
      peaks: ["AM"],
      metrics: ["total"],
      surveyTypes: ["平日"],
    },
    META,
  );
  assert.doesNotMatch(text, /假日/, "資料別篩選沒有生效");
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ④ 分組方式：三種都要產得出東西，而且真的不一樣
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 三種分組方式都產得出內容，而且輸出彼此不同", () => {
  const records = [
    rich({ quarter: "115Q1" }),
    rich({ quarter: "115Q2" }),
    rich({ quarter: "115Q2", station: "A00T00-02", intersectionKey: "K2" }),
  ];
  const texts = (["byIntersection", "byQuarter", "overall"] as const).map(
    (grouping) =>
      buildConclusion(
        records,
        {
          ...DEFAULT_CONDITION,
          scope: { kind: "project" },
          peaks: ["AM"],
          metrics: ["total", "inflowPcu"],
          grouping,
        },
        META,
      ),
  );
  for (const [index, text] of texts.entries()) {
    assert.ok(text.length > 120, `第 ${index + 1} 種分組產出的草稿短到不正常`);
    assert.match(text, /總流量/, `第 ${index + 1} 種分組沒有寫出數字`);
  }
  assert.equal(
    new Set(texts).size,
    3,
    "三種分組方式寫出一模一樣的字——選項等於沒有作用",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⑤ 範圍：四種都要能挑到資料
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 四種統計範圍（單季／年度／區間／全計畫）都挑得到資料", () => {
  const records = [
    rich({ quarter: "114Q4" }),
    rich({ quarter: "115Q1" }),
    rich({ quarter: "115Q2" }),
  ];
  for (const scope of [
    { kind: "quarter" as const, quarter: "115Q1" },
    { kind: "year" as const, year: "115" },
    { kind: "range" as const, from: "114Q4", to: "115Q1" },
    { kind: "project" as const },
  ]) {
    const text = buildConclusion(
      records,
      {
        ...DEFAULT_CONDITION,
        scope,
        peaks: ["AM"],
        metrics: ["total"],
      },
      META,
    );
    assert.match(
      text,
      /總流量/,
      `範圍 ${JSON.stringify(scope)} 挑不到任何資料`,
    );
  }
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⑥ 全部一起勾：不可以互相吃掉
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 四個時段 × 全部指標一起勾：每一個指標都還在", () => {
  const records = [
    rich({ quarter: "115Q1" }),
    rich({ quarter: "115Q2" }),
    rich({ quarter: "115Q2", station: "A00T00-02", intersectionKey: "K2" }),
  ];
  const text = buildConclusion(
    records,
    {
      ...DEFAULT_CONDITION,
      scope: { kind: "project" },
      peaks: SCOPES,
      metrics: [...KEYS],
      grouping: "byIntersection",
    },
    META,
  );
  const missing = KEYS.filter((key) => !MARKS[key].test(text));
  assert.deepEqual(
    missing,
    [],
    `全部勾起來時，這些指標被其他指標吃掉了：${missing.join("、")}`,
  );
  /* 兩種單位同時出現時一定要提醒不可相加。 */
  assert.match(text, /不可以相加/);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  報表文字草稿：每一個可勾選的段落都要寫得出內容
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-23：「報表草稿產生器，功能正常運作等同於數值正確性一樣重要」。
 *
 * ⚠️ `buildReportDraft()` 在段落產不出內容時會退回一句
 *   「…：目前範圍沒有可敘述的資料。」——那是**誠實的**，不是 bug。
 *   但如果在一份**資料齊全**的情境下還退回那一句，就是這個段落接在空的地方
 *   （A17 在結論草稿上就是這樣：勾了永遠沒數字）。
 *   所以這裡用一份欄位全滿的 context 去跑，**任何一段退回那句話就是紅**。
 */
import {
  DRAFT_SECTION_ORDER,
  DRAFT_SECTION_LABELS,
  buildReportDraft,
} from "../lib/report-draft.ts";
import { context } from "./helpers/report-context.ts";

/*
 * 欄位全滿的報表情境，與 report-draft.test.ts 共用同一份
 * （見 tests/helpers/report-context.ts 的說明：缺一個欄位就會丟例外，
 *   那會讓「段落寫不出內容」與「我的測資漏了欄位」混在一起）。
 */
const fullContext = () =>
  context({
    /* 四個核心統計範圍都放進來，FULL 那一段帶自己的單位。 */
    siteSummaries: [
      {
        name: "示範北路口 115Q2（平日）",
        peaks: [
          {
            label: "上午尖峰",
            hour: "07:30–08:30",
            unit: "PCU/hr",
            total: 2900.6,
            arms: [{ name: "路口A", outbound: 1200.5, inbound: 1000.6 }],
            vehicles: [{ label: "機車", share: 52.1 }],
          },
          {
            label: "全調查時段",
            hour: "實測 12 小時（非 24 小時）",
            unit: "PCU/調查時段",
            total: 24463.3,
            arms: [{ name: "路口A", outbound: 12000, inbound: 12463.3 }],
            vehicles: [{ label: "機車", share: 51.4 }],
          },
        ],
      },
    ],
  });

test("⚠️ 報表草稿：每一個段落單獨勾都要寫得出內容", () => {
  const context = fullContext();
  const holes: string[] = [];
  for (const key of DRAFT_SECTION_ORDER) {
    const text = buildReportDraft(context, [key]);
    if (text.includes(`${DRAFT_SECTION_LABELS[key]}：目前範圍沒有可敘述的資料。`))
      holes.push(
        `段落「${key}」（${DRAFT_SECTION_LABELS[key]}）在資料齊全時仍然寫不出內容`,
      );
  }
  assert.deepEqual(
    holes,
    [],
    `有 ${holes.length} 個段落接在空的地方：\n${holes.join("\n")}`,
  );
});

test("⚠️ 報表草稿：全部段落一起勾，每一段都還在", () => {
  const text = buildReportDraft(fullContext(), [...DRAFT_SECTION_ORDER]);
  assert.doesNotMatch(
    text,
    /目前範圍沒有可敘述的資料。/,
    "全部一起勾的時候有段落被吃掉了",
  );
  /* 段落數 ＝ 標題 ＋ 每一段 ＋ 結尾說明。 */
  const blocks = text.split("\n\n").length;
  assert.ok(
    blocks >= DRAFT_SECTION_ORDER.length + 2,
    `只產出 ${blocks} 段，少於勾選的 ${DRAFT_SECTION_ORDER.length} 段`,
  );
});
