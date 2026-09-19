/*
 * ══════════════════════════════════════════════════════════════════
 *  「-0」不可以出現在任何要給人看的數字上
 * ══════════════════════════════════════════════════════════════════
 *
 * 2026-09-10 大檢查在流量核對工作台掃到：
 *     「OD 逐筆加總 3,932.9 PCU/hr　核對差值 -0 PCU/hr　兩者一致」
 *
 * 判定是對的（-0 === 0，所以 `Math.abs(d) < 0.11` 本來就成立），
 * 錯的是**印出來的那個負號**。看報表的人會以為有差額，
 * 然後花時間追一個不存在的問題；更糟的是這個值會被匯出到 Excel。
 *
 * 成因：`Math.round(x * 10) / 10` 在 x 是很小的負數時得到 -0，
 *       而 `(-0).toLocaleString()` 就是「-0」。
 *
 * 這一支守三層：
 *   ①  round1() 本身：正規化 -0，而且不動到其他任何值
 *   ②  真的會相減的那幾支函式：餵進「差額是極小負數」的資料
 *   ③  **掃描式**：原始碼裡不可以再出現 `Math.round(相減 * 10) / 10`
 *       ——日後有人新增一處相減，這一條會自動抓到，不必有人記得。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { round1 } from "../lib/traffic.ts";
import { conservationCheck, branchBalance } from "../lib/final-features.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Object.is 是唯一分得出 0 與 -0 的比較方式；=== 兩者都是 true。 */
const isNegZero = (value) => Object.is(value, -0);

test("① round1 把 -0 正規化成 0", () => {
  assert.equal(isNegZero(round1(-0.02)), false, "round1(-0.02) 仍是 -0");
  assert.equal(isNegZero(round1(-0)), false, "round1(-0) 仍是 -0");
  assert.equal(isNegZero(round1(-0.0001)), false);
  assert.equal((round1(-0.02)).toLocaleString(), "0");
});

test("① round1 不可以動到其他任何值（只治 -0，別治壞了正確的數字）", () => {
  const cases = [
    [0, 0],
    [1, 1],
    [-1, -1],
    [3.14159, 3.1],
    [-3.14159, -3.1],
    [-0.06, -0.1],
    [0.06, 0.1],
    [-1234.56, -1234.6],
    [1e6 + 0.04, 1e6],
  ];
  for (const [input, expected] of cases)
    assert.equal(round1(input), expected, `round1(${input})`);
});

test("① round1 保留真正的負數——負號不是一律拿掉", () => {
  /*
   * ⚠️ 這一條是反面守門。把 -0 治掉最偷懶的寫法是 `Math.abs()`，
   *   那會連「真的少了 4.1」也變成 +4.1，核對表就再也看不出方向。
   */
  assert.equal(round1(-4.1), -4.1);
  assert.ok(round1(-0.2) < 0, "-0.2 四捨五入後仍必須是負的");
});

/* ── ② 真的會相減的函式 ────────────────────────────────────── */

/**
 * 造一筆「轉向合計」與「流向合計」差了 -0.02 的模擬資料。
 * ⚠️ 這是**模擬**資料，不是任何真實調查檔。
 */
function recordWithTinyNegativeGap() {
  const volumes = (pcu) => ({
    AM: { pcu, count: pcu },
    PM: { pcu, count: pcu },
    DAY: { pcu, count: pcu },
    FULL: { pcu, count: pcu },
  });
  return {
    id: "sim-1",
    station: "A00T00-01",
    approaches: [
      {
        id: "arm-a",
        name: "模擬支線甲",
        movements: {
          AM: { left: 0, through: 100, right: 0 },
          PM: { left: 0, through: 100, right: 0 },
          DAY: { left: 0, through: 100, right: 0 },
          FULL: { left: 0, through: 100, right: 0 },
        },
      },
    ],
    routes: [
      {
        id: "route-1",
        fromApproachId: "arm-a",
        toApproachId: "arm-a",
        volumes: volumes(100.02),
      },
    ],
  };
}

test("② conservationCheck 的差額不可以是 -0", () => {
  const result = conservationCheck(recordWithTinyNegativeGap(), "AM");
  assert.equal(
    isNegZero(result.difference),
    false,
    `difference 是 -0（會印成「-0」）：${result.difference}`,
  );
  /* 判定本身不受影響：差 0.02 仍然算一致。 */
  assert.equal(result.valid, true);
});

test("② 支線平衡表的三個數字都不可以是 -0", () => {
  const rows = branchBalance(recordWithTinyNegativeGap(), "AM");
  for (const row of rows)
    for (const key of ["inbound", "outbound", "difference"])
      assert.equal(
        isNegZero(row[key]),
        false,
        `${row.name} 的 ${key} 是 -0：${row[key]}`,
      );
});

/* ── ③ 掃描式：原始碼裡不可以再出現「相減之後直接 round」 ──── */

test("③ ⚠️ 原始碼裡不可以再出現 Math.round(甲 - 乙) 的寫法", () => {
  /*
   * 為什麼要掃原始碼，而不是只測函式：
   *   ②只涵蓋「我現在知道的那幾支」。這個 bug 的本質是**寫法**，
   *   日後任何人新增一處相減都會再犯一次，而那一處不會有人補測試。
   *   掃描式守門不需要有人記得，這才擋得住。
   *
   * 允許的寫法只有一種：round1(甲 - 乙)。
   */
  const files = [
    "app/traffic-app.tsx",
    "lib/traffic.ts",
    "lib/final-features.ts",
    "lib/trend-metrics.ts",
    "lib/conclusion.ts",
  ];
  const offenders = [];
  for (const relative of files) {
    const text = readFileSync(join(HERE, "..", relative), "utf8");
    const lines = text.split("\n");
    /*
     * 只抓「括號裡有減號」的 round：`Math.round(x * 10) / 10` 本身
     * 對非負數是安全的（總量、加總不會是 -0），逐一改掉只會製造雜訊。
     * 危險的是相減。
     */
    const pattern = /Math\.round\(\s*\(?[^()]*[^-\s(][ \t]-[ \t][^()]*\)?\s*\*\s*10\s*\)\s*\/\s*10(?!\s*\+\s*0)/;
    lines.forEach((line, index) => {
      if (line.trim().startsWith("*") || line.trim().startsWith("//")) return;
      if (pattern.test(line))
        offenders.push(`${relative}:${index + 1}｜${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `這些地方相減之後沒有走 round1()，會印出「-0」：\n- ${offenders.join("\n- ")}`,
  );
});

test("③ 前置：上面那條掃描規則真的抓得到（不然它是恆真的）", () => {
  /*
   * ⚠️ 沒有這一條，③ 可能因為正規式寫錯而永遠是綠的——
   *   那比沒有測試更糟，因為它會讓人以為守住了。
   */
  const pattern = /Math\.round\(\s*\(?[^()]*[^-\s(][ \t]-[ \t][^()]*\)?\s*\*\s*10\s*\)\s*\/\s*10(?!\s*\+\s*0)/;
  assert.ok(
    pattern.test("  const difference = Math.round((movement - routes) * 10) / 10;"),
    "抓不到舊寫法，這條規則等於沒做",
  );
  assert.equal(
    pattern.test("  const difference = round1(movement - routes);"),
    false,
    "新寫法被誤判成違規",
  );
  assert.equal(
    pattern.test("  const total = Math.round(inbound * 10) / 10;"),
    false,
    "沒有相減的 round 被誤判成違規",
  );
});
