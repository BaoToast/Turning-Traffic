/*
 * ══════════════════════════════════════════════════════════════════════
 *  尖峰小時口徑契約——**兩支程式共用同一張表**（2026-09-25 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 為什麼要有這一支：
 *
 * 「尖峰小時怎麼認定」在全日交通量與路口轉向**各有一份實作**
 *（app/partial-day.ts 的 rollingPeak／lib/traffic.ts 的 rollingPeak）。
 * 兩份實作遲早會漂移，而漂移的症狀是「兩支程式對同一批資料給出不同的尖峰」
 * ——兩個數字各自都合理，合起來卻不是同一件事，使用者無從發現。
 *
 * 實際發生過的漂移：同一筆只有 45 分鐘的連續區塊，
 *   全日交通量給那 45 分鐘的合計（單位寫「輛/該時段（45 分鐘）」）、
 *   路口轉向回「資料不足」。
 * 使用者 2026-09-24 裁示「以路口轉向那個保守作法為主」，兩支才對齊。
 *
 * ⚠️ 這張 CASES 表與期望值**必須與另一支程式的同名檔案逐字相同**
 *   （做法與 never-revert-contract.mjs 相同：同一份內容放兩處，
 *     任一邊改了就會有一邊紅）。
 *   要改口徑時**兩支一起改**，而且要先問使用者——這是計算口徑。
 *
 * ⚠️ 已用跨程式驗算確認過：2026-09-25 在同一個容器裡把下面 10 種情境
 *   同時餵給兩支程式的 rollingPeak，**10/10 值與視窗完全一致**。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { rollingPeak } from "../lib/traffic.ts";

/**
 * 共用情境表。每一列是 [起始分鐘, 這一格幾分鐘, 值]。
 *
 * ⚠️ 期望值是「剛好 60 分鐘的視窗裡的合計」與「那個視窗的起始分鐘」；
 *   湊不滿 60 分鐘一律 null（＝資料不足）。
 */
export const PEAK_HOUR_CASES = [
  {
    name: "整點一格 × 24（一般全日）",
    spec: Array.from({ length: 24 }, (_, i) => [i * 60, 60, 100 + i]),
    expectTotal: 123,
    expectStart: 23 * 60,
  },
  {
    name: "15 分鐘 × 8（07–09）",
    spec: Array.from({ length: 8 }, (_, i) => [420 + i * 15, 15, 50 + i * 10]),
    expectTotal: 420,
    expectStart: 8 * 60,
  },
  {
    name: "20 分鐘 × 6（07–09）",
    spec: Array.from({ length: 6 }, (_, i) => [420 + i * 20, 20, 60 + i * 5]),
    expectTotal: 240,
    expectStart: 8 * 60,
  },
  {
    name: "30 分鐘 × 4（07–09）",
    spec: Array.from({ length: 4 }, (_, i) => [420 + i * 30, 30, 100 + i * 20]),
    expectTotal: 300,
    expectStart: 8 * 60,
  },
  {
    /* ⚠️ 45 分鐘組不成整小時 → 資料不足。這就是 2026-09-24 對齊的那一件。 */
    name: "45 分鐘 × 2（湊不滿）",
    spec: [
      [420, 45, 100],
      [465, 45, 300],
    ],
    expectTotal: null,
    expectStart: null,
  },
  {
    name: "整份只有 45 分鐘",
    spec: [[420, 45, 100]],
    expectTotal: null,
    expectStart: null,
  },
  {
    /* 2 小時一格：加第一格就超過 60 分鐘 → 資料不足（本來就是這樣）。 */
    name: "2 小時一格",
    spec: [[420, 120, 400]],
    expectTotal: null,
    expectStart: null,
  },
  {
    /*
     * 混用格長的經典陷阱：舊算法（數格數）眾數是 60 → needed = 1，
     * 於是任何一格都被當成一整小時，會報 00:00 的 100 而不是 07 時的 200。
     */
    name: "混用：整點 + 07–09 拆 15 分鐘",
    spec: [
      ...Array.from({ length: 7 }, (_, i) => [i * 60, 60, 100]),
      ...Array.from({ length: 8 }, (_, i) => [420 + i * 15, 15, 50]),
      ...Array.from({ length: 15 }, (_, i) => [540 + i * 60, 60, 100]),
    ],
    expectTotal: 200,
    expectStart: 7 * 60,
  },
  {
    /*
     * 08:45 的 15 分鐘格接 09:00 的整點格：起點間距剛好 15 分鐘，
     * 只比「起點」的舊檢查會放它過，於是 50+50+50+100 被當成一小時。
     * 累計分鐘數的算法會在加到第五格時發現超過 60 而停下來。
     */
    name: "混用：60 + 15（08:45 接 09:00 的陷阱）",
    spec: [
      [420, 60, 50],
      [480, 15, 50],
      [495, 15, 50],
      [510, 15, 50],
      [525, 15, 50],
      [540, 60, 100],
    ],
    expectTotal: 200,
    expectStart: 8 * 60,
  },
  {
    /* 視窗不可以跨越上午與下午之間的空隙。 */
    name: "有空隙（上午 + 下午）",
    spec: [
      ...Array.from({ length: 4 }, (_, i) => [420 + i * 15, 15, 10]),
      ...Array.from({ length: 4 }, (_, i) => [1020 + i * 15, 15, 1000]),
    ],
    expectTotal: 4000,
    expectStart: 17 * 60,
  },
];

const clock = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

test("尖峰小時口徑：十種情境的結果與共用契約表完全一致", () => {
  for (const item of PEAK_HOUR_CASES) {
    const rows = item.spec.map(([start, len, value]) => ({
      start,
      label: `${clock(start)}~${clock(start + len)}`,
      values: [value],
      lengthMinutes: len,
    }));
    /* 眾數格長（rollingPeak 的前置檢查要用它）。 */
    const counts = new Map();
    for (const [, len] of item.spec) counts.set(len, (counts.get(len) ?? 0) + 1);
    const mode = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || b[0] - a[0],
    )[0][0];
    const got = rollingPeak(rows, [0, 24 * 60], mode, [1]);
    if (item.expectTotal === null) {
      assert.equal(
        got,
        null,
        `${item.name}：應該是「資料不足」（null），卻算出 ${JSON.stringify(got)}`,
      );
      continue;
    }
    assert.ok(got, `${item.name}：不該回 null`);
    assert.equal(
      got.total,
      item.expectTotal,
      `${item.name}：合計應該是 ${item.expectTotal}，實際 ${got.total}`,
    );
    assert.equal(
      got.start,
      item.expectStart,
      `${item.name}：視窗起點應該是 ${clock(item.expectStart)}，實際 ${clock(got.start)}`,
    );
  }
});

test("⚠️ 前置：契約表要有足夠的情境（表被掏空的話上一條恆真）", () => {
  assert.ok(
    PEAK_HOUR_CASES.length >= 10,
    `契約表只有 ${PEAK_HOUR_CASES.length} 種情境——被刪過了`,
  );
  assert.ok(
    PEAK_HOUR_CASES.some((item) => item.expectTotal === null),
    "契約表裡沒有任何「資料不足」的情境，那是 2026-09-24 對齊的重點",
  );
  assert.ok(
    PEAK_HOUR_CASES.some((item) => item.name.includes("混用")),
    "契約表裡沒有混用格長的情境，那是這個算法存在的理由",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  尖峰小時口徑契約表：兩支程式必須逐位元相同（2026-09-25 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 「尖峰小時怎麼認定」在全日交通量與路口轉向各有一份實作，
 * 而 tests/peak-hour-contract.test.mjs 裡的 PEAK_HOUR_CASES 表是
 * **兩支共用的同一份內容**（做法與 never-revert-contract.mjs 相同）。
 *
 * 這一條把那張表的雜湊釘住：任何一支單邊改了表（或改了口徑卻只改一支），
 * 那一支就會紅。要改口徑時**兩支一起改、並同步更新這個雜湊**——
 * 而且那是計算口徑，要先問使用者。
 *
 * ⚠️ 2026-09-25 已用跨程式驗算確認：同一組 10 種情境同時餵給兩支的
 *   rollingPeak，值與視窗 10/10 完全一致。
 */
test("尖峰小時口徑契約表的雜湊必須與另一支程式相同", () => {
  const text = readFileSync(
    new URL("./peak-hour-contract.test.mjs", import.meta.url),
    "utf8",
  );
  const from = text.indexOf("export const PEAK_HOUR_CASES = [");
  assert.notEqual(from, -1, "找不到 PEAK_HOUR_CASES——契約表被改名或刪掉了");
  const to = text.indexOf("\n];", from);
  assert.notEqual(to, -1, "PEAK_HOUR_CASES 的結尾找不到");
  const table = text.slice(from, to + 3);
  assert.equal(
    createHash("sha256").update(table).digest("hex"),
    "213ef6f7f53c054bdae3a988ebd6973dd1816b78fbb361368b390e19b8abd1c6",
    "尖峰小時口徑契約表與另一支程式不一致了。" +
      "兩支必須逐位元相同——單邊改表就是口徑漂移，" +
      "而漂移的症狀是兩支對同一批資料給出不同的尖峰。",
  );
});
