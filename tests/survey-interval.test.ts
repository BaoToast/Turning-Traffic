/*
 * ══════════════════════════════════════════════════════════════════════
 *  尖峰小時要由「真的加起來剛好 60 分鐘」的格子組成（2026-09-24）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 舊寫法是 `needed = 60 ÷ 眾數格長`，然後取 needed 格、只比**起點間距**。
 * 格長一致時數格數＝數分鐘，所以是對的；混用格長時兩者脫鉤：
 *
 *   ・眾數 60 → needed = 1，**任何一格**都被當成一個完整小時
 *   ・眾數 15 → needed = 4，起點間距都是 15 就過關，
 *     即使其中一格其實是 60 分鐘（08:45 的 15 分鐘格接 09:00 的整點格，
 *     間距剛好 15 分鐘 → 舊版接受 → 50+50+50+100 被當成一小時）
 *
 * ⚠️ 這一組同時守**不可以誤殺**：格長一致的四種正常版型（15／20／30／60）
 *   與「只寫起點的舊紀錄」都必須與改版前得到同一個數字。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  rollingPeak,
  intervalLengthFromLabel,
  totalIntervalMinutes,
  type IntervalRow,
} from "../lib/traffic.ts";

const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const row = (start: number, length: number, value: number): IntervalRow => ({
  start,
  label: `${clock(start)}~${clock(start + length)}`,
  lengthMinutes: length,
  values: [value],
});
const DAY: [number, number] = [0, 24 * 60];

/** 給 qualityIssues() 用的最小可用紀錄。只有格距相關欄位是重點。 */
function baseRecord(over: Record<string, unknown>) {
  return {
    id: "R1",
    station: "A00T00-01",
    name: "示範路口",
    quarter: "115Q2",
    surveyType: "平日",
    approaches: [],
    routes: [{ fromApproachId: "a", toApproachId: "b", movement: "through", volumes: {} }],
    sourceFiles: ["示範檔.xlsx"],
    /* qualityIssues() 會讀 validation.notes 與 survey，缺了會丟例外。 */
    validation: { notes: [], mappingConfidence: "high" },
    survey: { intervals: 24, minutes: 1440, vehicle: { motorcycle: 100 } },
    directionDisplay: {},
    peaks: { AM: { start: "07:00", end: "08:00" }, PM: { start: "17:00", end: "18:00" }, DAY: { start: "07:00", end: "08:00" } },
    ...over,
  } as never;
}
const total = (rows: IntervalRow[], interval: number) =>
  rollingPeak(rows, DAY, interval)?.total ?? null;

/** 全日整點每格 100，只有 07–09 拆成 15 分鐘每格 50。真尖峰 07:00–08:00 ＝ 200。 */
function mixedHourlyWithQuarterPeak(): IntervalRow[] {
  const rows: IntervalRow[] = [];
  for (let h = 0; h < 24; h += 1)
    if (h === 7 || h === 8)
      for (let q = 0; q < 4; q += 1) rows.push(row(h * 60 + q * 15, 15, 50));
    else rows.push(row(h * 60, 60, 100));
  return rows.sort((a, b) => a.start - b.start);
}
/** 07–10 每 15 分鐘 50，17–21 每小時 300。真尖峰 17:00–18:00 ＝ 300。 */
function mixedQuarterThenHourly(): IntervalRow[] {
  const rows: IntervalRow[] = [];
  for (let q = 0; q < 12; q += 1) rows.push(row(7 * 60 + q * 15, 15, 50));
  for (let h = 17; h < 21; h += 1) rows.push(row(h * 60, 60, 300));
  return rows;
}

test("⚠️ 混用整點與 15 分鐘格：不論傳哪一個眾數，答案都要是真尖峰", () => {
  const rows = mixedHourlyWithQuarterPeak();
  /*
   * ⚠️ 兩個眾數都驗。舊版在眾數 60 時報 100（少報一半、時段也錯）、
   *   在眾數 15 時報 250（把一個整點格串進四格視窗）。只驗一個會漏掉另一半。
   */
  assert.equal(total(rows, 60), 200, "眾數 60：舊版報 100");
  assert.equal(total(rows, 15), 200, "眾數 15：舊版報 250");
  /* 時段也要對，不只是數字對。 */
  assert.equal(rollingPeak(rows, DAY, 60)?.start, 7 * 60);
});

test("⚠️ 混用（前拆細後整點）：整點那一格自己就是一小時", () => {
  const rows = mixedQuarterThenHourly();
  assert.equal(total(rows, 15), 300, "舊版報 200（挑了四格 15 分鐘）");
  assert.equal(total(rows, 60), 300);
  assert.equal(rollingPeak(rows, DAY, 15)?.start, 17 * 60);
});

test("⚠️ 混合格距的調查涵蓋要加每格實際分鐘，不可用列數乘眾數", () => {
  const rows = mixedHourlyWithQuarterPeak();
  assert.equal(totalIntervalMinutes(rows, 60), 24 * 60);
  assert.notEqual(rows.length * 60, 24 * 60, "測資必須能揭露舊算法");
});

test("⚠️ 反證：格長一致的四種正常版型都不可以被改到", () => {
  const cases: [string, IntervalRow[], number, number][] = [
    [
      "全部 15 分鐘",
      Array.from({ length: 12 }, (_, q) => row(7 * 60 + q * 15, 15, q === 3 ? 200 : 50)),
      15,
      350,
    ],
    [
      "全部整點",
      Array.from({ length: 24 }, (_, h) => row(h * 60, 60, h === 17 ? 500 : 100)),
      60,
      500,
    ],
    [
      "全部 20 分鐘",
      Array.from({ length: 18 }, (_, i) => row(7 * 60 + i * 20, 20, i >= 3 && i < 6 ? 90 : 30)),
      20,
      270,
    ],
    [
      "全部 30 分鐘",
      Array.from({ length: 12 }, (_, i) => row(7 * 60 + i * 30, 30, i === 4 ? 400 : 100)),
      30,
      500,
    ],
  ];
  for (const [name, rows, interval, expected] of cases)
    assert.equal(total(rows, interval), expected, `${name} 被改到了`);
});

test("⚠️ 反證：視窗不可以跨越資料空隙（上午最後一格接下午第一格）", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, q) => row(7 * 60 + q * 15, 15, 100)),
    ...Array.from({ length: 8 }, (_, q) => row(17 * 60 + q * 15, 15, 200)),
  ];
  /* 下午四格 200×4 ＝ 800 才是尖峰；跨空隙串起來會得到別的數字。 */
  assert.equal(total(rows, 15), 800);
  assert.equal(rollingPeak(rows, DAY, 15)?.start, 17 * 60);
});

test("⚠️ 2 小時與 45 分鐘一格：拒絕給數字，不可以冒充一小時", () => {
  const twoHour = Array.from({ length: 6 }, (_, i) =>
    row((7 + i * 2) * 60, 120, i === 5 ? 500 : 200));
  assert.equal(rollingPeak(twoHour, DAY, 120), null, "2 小時一格應該回資料不足");
  const fortyFive = Array.from({ length: 8 }, (_, i) => row(7 * 60 + i * 45, 45, 90));
  assert.equal(rollingPeak(fortyFive, DAY, 45), null, "45 分鐘一格組不成整小時");
});

test("⚠️ 舊紀錄（時間欄只寫起點、格長未知）行為要與改版前相同", () => {
  /*
   * v2.1.67 以前匯入的紀錄沒有起訖，`lengthMinutes` 是 undefined。
   * 那時退回眾數判斷——不可以因為「不知道長度」就整批變成資料不足。
   */
  const rows: IntervalRow[] = Array.from({ length: 12 }, (_, q) => ({
    start: 7 * 60 + q * 15,
    label: clock(7 * 60 + q * 15),
    values: [q === 3 ? 200 : 50],
  }));
  assert.equal(total(rows, 15), 350);
});

test("⚠️ intervalLengthFromLabel：只寫起點時要回 undefined，不可以猜", () => {
  assert.equal(intervalLengthFromLabel("07:00~07:15"), 15);
  assert.equal(intervalLengthFromLabel("07:00－08:00"), 60);
  assert.equal(intervalLengthFromLabel("07:00～09:00"), 120);
  assert.equal(intervalLengthFromLabel("23:45~00:00"), 15, "跨午夜要算得出正數");
  /* 這兩種是「不知道」，不是 0——回 0 會讓視窗永遠組不起來。 */
  assert.equal(intervalLengthFromLabel("07:00"), undefined);
  assert.equal(intervalLengthFromLabel("亂寫"), undefined);
  assert.equal(intervalLengthFromLabel(""), undefined);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  格距要列進資料異常清單（使用者 2026-09-24 的 I1／I3／I4）
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 2 小時一格要列成異常，而且說出「可能是誤植」", async () => {
  const { qualityIssues } = await import("../lib/traffic.ts");
  const record = baseRecord({
    sourceIntervals: {
      intervalMinutes: 120,
      columns: [],
      rows: Array.from({ length: 6 }, (_, i) => row((7 + i * 2) * 60, 120, 100)),
    },
  });
  const issues = qualityIssues([record]).filter(
    (item) => item.category === "調查格距異常",
  );
  assert.equal(issues.length, 1, "沒有列成異常");
  assert.match(issues[0].message, /2 小時 × 6 格/, issues[0].message);
  assert.match(issues[0].message, /共 6 格/, "沒有寫出總格數");
  assert.match(issues[0].message, /07:00~09:00/, "沒有舉出是哪一格");
  assert.equal(issues[0].resolution.kind, "人工確認");
  assert.match(
    issues[0].resolution.text,
    /誤植/,
    "沒有講出最可能的原因——使用者只看到「資料不足」不知道該去看什麼（I4）",
  );
  assert.match(
    issues[0].resolution.text,
    /4\.5\.1\.3/,
    "應該引用手冊 4.5.1.3（15 分鐘是手冊鼓勵的做法，不是異常）",
  );
});

test("⚠️ 混用格長要列成異常，但要講明「不一定是錯」", async () => {
  const { qualityIssues } = await import("../lib/traffic.ts");
  const rows: IntervalRow[] = [];
  for (let h = 0; h < 24; h += 1)
    if (h === 7 || h === 8)
      for (let q = 0; q < 4; q += 1) rows.push(row(h * 60 + q * 15, 15, 50));
    else rows.push(row(h * 60, 60, 100));
  const issues = qualityIssues([
    baseRecord({ sourceIntervals: { intervalMinutes: 60, columns: [], rows } }),
  ]).filter((item) => item.category === "調查格距混用");
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /15 分鐘 × 8 格/, issues[0].message);
  assert.match(issues[0].message, /60 分鐘 × 22 格/, issues[0].message);
  assert.match(issues[0].resolution.text, /不一定是錯/, "不可以逼使用者去改一份沒錯的檔");
});

test("⚠️ 正常格距一句都不可以叫（15／20／30／60）", async () => {
  const { qualityIssues } = await import("../lib/traffic.ts");
  const cases: [string, number, IntervalRow[]][] = [
    ["15 分鐘", 15, Array.from({ length: 12 }, (_, q) => row(7 * 60 + q * 15, 15, 50))],
    ["20 分鐘", 20, Array.from({ length: 9 }, (_, i) => row(7 * 60 + i * 20, 20, 50))],
    ["30 分鐘", 30, Array.from({ length: 6 }, (_, i) => row(7 * 60 + i * 30, 30, 50))],
    ["整點", 60, Array.from({ length: 24 }, (_, h) => row(h * 60, 60, 100))],
  ];
  for (const [name, interval, rows] of cases) {
    const issues = qualityIssues([
      baseRecord({ sourceIntervals: { intervalMinutes: interval, columns: [], rows } }),
    ]).filter((item) => /調查格距/.test(item.category));
    assert.deepEqual(issues, [], `${name} 被誤報成格距異常`);
  }
});

test("⚠️ 舊紀錄沒有 sourceIntervals 時什麼都不報（查不到不等於異常）", async () => {
  const { qualityIssues } = await import("../lib/traffic.ts");
  const issues = qualityIssues([baseRecord({})]).filter((item) =>
    /調查格距/.test(item.category),
  );
  assert.deepEqual(issues, []);
});

test("⚠️ 48 格裡只有 1 格誤植也要抓到（眾數會把它蓋掉）", async () => {
  const { qualityIssues } = await import("../lib/traffic.ts");
  const rows = [
    ...Array.from({ length: 24 }, (_, h) => row(h * 60, 60, 100)),
    row(7 * 60, 120, 100),
  ];
  const issues = qualityIssues([
    baseRecord({ sourceIntervals: { intervalMinutes: 60, columns: [], rows } }),
  ]).filter((item) => item.category === "調查格距異常");
  assert.equal(issues.length, 1, "被眾數蓋掉了——這正是最需要抓出來的情形");
  assert.match(issues[0].message, /2 小時 × 1 格/, issues[0].message);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  J2：舊紀錄沒有 lengthMinutes，但 label 還在——長度要先從 label 回推
 * ══════════════════════════════════════════════════════════════════════
 *
 * I2（尖峰小時口徑變更）的殘留缺口。匯入時這兩個欄位取自**同一個字串**：
 *   label: String(cell)
 *   lengthMinutes: intervalLengthFromLabel(String(cell))
 * 所以 v2.1.67 以前匯入的舊紀錄雖然沒有 `lengthMinutes`，長度是**回推得出來的**，
 * 不必等使用者重新匯入。在加 `cellMinutesOf()` 之前，這條路徑一路退回眾數，
 * I2 修好的那個缺陷在舊紀錄上還活著。
 */

/** 與 mixedHourlyWithQuarterPeak() 同一份資料，但把 lengthMinutes 拔掉（模擬舊紀錄）。 */
function mixedWithoutLengthMinutes(): IntervalRow[] {
  return mixedHourlyWithQuarterPeak().map(
    (item): IntervalRow => ({
      start: item.start,
      label: item.label,
      values: item.values,
      /* lengthMinutes 刻意不帶——這正是要模擬的舊紀錄。 */
    }),
  );
}

test("⚠️ J2 反證①：舊紀錄（沒有 lengthMinutes、label 有起訖）也要挑對", () => {
  const rows = mixedWithoutLengthMinutes();

  /* 前置：確認真的拔掉了，否則這一項是在測有 lengthMinutes 的那條路。 */
  assert.ok(
    rows.every((item) => item.lengthMinutes === undefined),
    "前置檢查：這一份資料應該一筆 lengthMinutes 都沒有",
  );
  /* 前置：label 真的帶得出長度，否則回推那一層根本沒有東西可用。 */
  assert.equal(intervalLengthFromLabel(rows[0].label), 60);

  /*
   * 舊寫法（`row.lengthMinutes ?? intervalMinutes`）在這份資料上：
   *   ・眾數 60 → 任何一格都被當成一整小時 → 報 100
   *   ・眾數 15 → 起點間距都是 15 就過關 → 50+50+50+100 ＝ 250
   * 兩個眾數都要驗，只驗一個會漏掉另一半。
   */
  assert.equal(total(rows, 15), 200, "眾數 15：舊寫法會報 250");
  assert.equal(total(rows, 60), 200, "眾數 60：舊寫法會報 100");
  assert.equal(totalIntervalMinutes(rows, 60), 24 * 60, "涵蓋分鐘也要從 label 回推");
});

test("⚠️ J2 反證②：label 只寫起點時仍然退回眾數（不可以猜）", () => {
  /*
   * 這一顆是防過度修正。`intervalLengthFromLabel("07:00")` 回 undefined，
   * 這時 cellMinutesOf 必須退回眾數——不可以讓它猜一個數字出來，
   * 否則「不知道長度」會變成「假裝知道」。
   * 與上面既有的「舊紀錄（時間欄只寫起點）」那一項是同一個結果（350），
   * 也就是行為與改版前完全相同。
   */
  const rows: IntervalRow[] = Array.from({ length: 12 }, (_, q) => ({
    start: 7 * 60 + q * 15,
    label: clock(7 * 60 + q * 15),
    values: [q === 3 ? 200 : 50],
  }));
  assert.equal(intervalLengthFromLabel(rows[0].label), undefined, "前置：回推不出來");
  assert.equal(total(rows, 15), 350);
  assert.equal(totalIntervalMinutes(rows, 15), 12 * 15);
});
