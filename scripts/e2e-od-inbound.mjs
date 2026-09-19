/*
 * ══════════════════════════════════════════════════════════════════
 *  OD 矩陣要同時看得到「駛出」與「駛入」
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：
 *   「我記得之前好像說過，『OD MATRIX 來源支線 → 目的支線』這張表顯示的是
 *     『駛入』，但我希望也能顯示駛出……現在回頭來看這張表，一樣只有『駛入』，
 *     我找不到如何切換成駛出。」
 *
 * ── 實際的狀況與修法 ──────────────────────────────────────────
 *
 * 這張表本來就同時含有兩個方向：
 *   ・每一**列** ＝ 這條支線駛出到各支線 → 列合計＝**駛出合計**（本來就有）
 *   ・每一**欄** ＝ 各支線駛入這條支線 → 欄合計＝**駛入合計**（以前沒印）
 *
 * 所以缺的是最底下那一列，不是一個切換鈕。
 *
 * ⚠️ 刻意**不做**「切換成駛出視角」：轉置之後每一格數字一個都沒變，
 *   只是行列對調，看的人會以為那是另一組資料——那才是真的會出錯的做法。
 *
 * ── ⚠️ 這一支刻意迴避的假通過 ────────────────────────────────
 *
 * 一、**只驗「有 tfoot」不算數。** 印一列 0 也會過。
 *     這裡驗的是守恆：所有列合計的和 ＝ 所有欄合計的和 ＝ 右下角總計。
 * 二、**只驗「內部自洽」不算數。** 整張表都算錯、但錯得一致也會過。
 *     所以另外拿右邊「各支線流量平衡」那張表的**駛入**欄逐格對——
 *     那一欄是另一條程式路徑算出來的，兩邊相同才是真的對。
 * 三、**只驗一個統計範圍不算數。** AM／PM／全調查時段的數字不同，
 *     這裡把有資料的範圍都走一遍。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8289;
const seed = readFileSync(join(here, "seed-state.json"), "utf8");

const problems = [];
const failOnly = (text) => ({ failOnly: text });
const ok = (label, condition, detail = "") => {
  const text =
    detail && typeof detail === "object"
      ? condition
        ? ""
        : detail.failOnly
      : detail;
  console.log(`${condition ? "✅" : "❌"} ${label}${text ? ` — ${text}` : ""}`);
  if (!condition) problems.push(label + (text ? ` — ${text}` : ""));
};
/* 浮點數相加會有尾差（實測 4795.799999999999 vs 4795.8），比到 0.05 即可。 */
const near = (a, b) => Math.abs(a - b) < 0.05;

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.addInitScript((t) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", t);
  } catch {
    /* 無痕或封鎖時就算了，下面的前置檢查會紅。 */
  }
}, seed);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.locator('nav button:has-text("轉向進階分析")').first().click();
await page.waitForTimeout(1200);

const readMatrix = () =>
  page.evaluate(() => {
    const num = (t) => Number(String(t).replace(/,/g, "")) || 0;
    const table = document.querySelector(".od-table");
    if (!table) return { error: "找不到 .od-table" };
    const bodyRows = [...table.querySelectorAll("tbody tr")];
    if (!bodyRows.length) return { error: "矩陣沒有任何資料列" };
    const stripSmall = (node) => {
      const clone = node.cloneNode(true);
      clone.querySelectorAll("small").forEach((child) => child.remove());
      return clone.textContent;
    };
    const rowTotals = bodyRows.map((tr) =>
      num(stripSmall(tr.querySelector("td:last-child"))),
    );
    /*
     * ⚠️ 只讀**數值**那一半。
     *   v2.1.74 起「顯示數值」接到了 OD 矩陣上，預設「交通流量＋百分比」
     *   會在同一格裡多寫一行 <small>12.5%</small>。
     *   直接讀 td.textContent 會拿到「1560.612.5%」，num() 解析失敗變成 0，
     *   於是守門寫著「逐格算 0.0」——看起來像矩陣壞了，其實是讀錯東西。
     *   守門自己說謊比沒有守門更糟，所以這裡把百分比那一行排除。
     */
    const valueOf = (td) => {
      const clone = td.cloneNode(true);
      clone.querySelectorAll("small").forEach((node) => node.remove());
      return num(clone.textContent);
    };
    const cells = bodyRows.map((tr) =>
      [...tr.querySelectorAll("td")].slice(0, -1).map(valueOf),
    );
    const foot = table.querySelector("tfoot tr");
    if (!foot)
      return { error: "沒有 tfoot——「駛入合計」那一列不見了（就是這次要修的東西）" };
    const footCells = [...foot.querySelectorAll("td")].map((td) =>
      num(stripSmall(td)),
    );
    /* 右邊「各支線流量平衡」那張表：欄位是 支線／駛入／駛出／差值 */
    const balance = [...document.querySelectorAll("table")].find((t) =>
      (t.querySelector("thead")?.textContent || "").includes("差值"),
    );
    return {
      footLabel: (foot.querySelector("th")?.textContent || "").trim(),
      rowTotals,
      colTotals: footCells.slice(0, -1),
      grand: footCells[footCells.length - 1],
      computedCol: cells[0].map((_, i) =>
        cells.reduce((sum, row) => sum + row[i], 0),
      ),
      balanceInbound: balance
        ? [...balance.querySelectorAll("tbody tr")].map((tr) =>
            num(tr.children[1].textContent),
          )
        : null,
    };
  });

const SCOPES = ["AM Peak", "PM Peak", "全調查時段尖峰", "全調查時段"];
let checked = 0;
for (const scope of SCOPES) {
  const button = page.locator("button", { hasText: scope }).first();
  if (!(await button.count())) continue;
  if (await button.isDisabled().catch(() => false)) {
    console.log(`   （${scope}：這筆資料算不出這個時段，跳過）`);
    continue;
  }
  await button.click().catch(() => {});
  await page.waitForTimeout(700);
  const m = await readMatrix();
  if (m.error) {
    ok(`${scope}：讀得到 OD 矩陣`, false, m.error);
    continue;
  }
  checked += 1;
  ok(
    `${scope}：最底下那一列叫「駛入合計」`,
    m.footLabel === "駛入合計",
    failOnly(`實際是「${m.footLabel}」`),
  );
  const sumRows = m.rowTotals.reduce((a, b) => a + b, 0);
  const sumCols = m.colTotals.reduce((a, b) => a + b, 0);
  ok(
    `${scope}：列合計的和 ＝ 欄合計的和 ＝ 右下角總計`,
    near(sumRows, sumCols) && near(sumCols, m.grand),
    `駛出合計和 ${sumRows.toFixed(1)}／駛入合計和 ${sumCols.toFixed(1)}／總計 ${m.grand.toFixed(1)}`,
  );
  ok(
    `${scope}：每一欄的合計真的等於那一欄逐格相加`,
    m.colTotals.every((v, i) => near(v, m.computedCol[i])),
    failOnly(
      `表上 ${m.colTotals.join("／")}　逐格算 ${m.computedCol.map((v) => v.toFixed(1)).join("／")}`,
    ),
  );
  ok(
    `${scope}：與「各支線流量平衡」的駛入欄逐格相同（兩條不同的程式路徑）`,
    Array.isArray(m.balanceInbound) &&
      m.balanceInbound.length === m.colTotals.length &&
      m.colTotals.every((v, i) => near(v, m.balanceInbound[i])),
    `OD 欄合計 ${m.colTotals.join("／")}　平衡表駛入 ${(m.balanceInbound || []).join("／")}`,
  );
  /* 反面：不可以整列都是 0（那樣上面每一條都會「一致」地通過） */
  ok(
    `${scope}：駛入合計不是一整列 0（不是拿空表當通過）`,
    m.colTotals.some((v) => v > 0),
    failOnly("整列都是 0"),
  );
}

ok("至少驗過一個統計範圍", checked > 0, failOnly("四個範圍都沒驗到"));
ok("過程中沒有 JS 例外", errors.length === 0, failOnly(errors.slice(0, 3).join(" / ")));

await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過`);
  process.exit(1);
}
console.log("\n✅ 全部通過");
