/*
 * 探針：OD 矩陣底部新增的「駛入合計」列。
 * 要證明的不是「有這一列」，而是**數字對得起來**：
 *   所有列合計的和 ＝ 所有欄合計的和 ＝ 右下角總計
 * 而且要和右邊「各支線流量平衡」那張表的駛入欄逐格相同。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "../serve.mjs";
import { launchOptions } from "../chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8288;
const seed = readFileSync(join(here, "..", "seed-state.json"), "utf8");
const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-TW" })
).newPage();
page.on("dialog", (d) => d.accept());
page.on("pageerror", (e) => console.log("PAGEERROR", String(e.message).slice(0, 160)));
await page.addInitScript((t) => {
  try { localStorage.setItem("turning-traffic-state-v2", t); } catch { /* ignore */ }
}, seed);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.locator('nav button:has-text("轉向進階分析")').first().click();
await page.waitForTimeout(1200);

const report = await page.evaluate(() => {
  const num = (t) => Number(String(t).replace(/,/g, "")) || 0;
  const table = document.querySelector(".od-table");
  if (!table) return { error: "找不到 .od-table" };
  const bodyRows = [...table.querySelectorAll("tbody tr")];
  const rowTotals = bodyRows.map((tr) => num(tr.querySelector("td:last-child").textContent));
  const cells = bodyRows.map((tr) =>
    [...tr.querySelectorAll("td")].slice(0, -1).map((td) => num(td.textContent)),
  );
  const foot = table.querySelector("tfoot tr");
  if (!foot) return { error: "沒有 tfoot（駛入合計那一列沒出來）" };
  const footCells = [...foot.querySelectorAll("td")].map((td) => num(td.textContent));
  const colTotals = footCells.slice(0, -1);
  const grand = footCells[footCells.length - 1];
  /* 右邊那張「各支線流量平衡」的駛入欄 */
  const balance = [...document.querySelectorAll("table")]
    .find((t) => (t.querySelector("thead")?.textContent || "").includes("差值"));
  const balanceInbound = balance
    ? [...balance.querySelectorAll("tbody tr")].map((tr) => num(tr.children[1].textContent))
    : null;
  const computedCol = cells[0].map((_, i) => cells.reduce((s, r) => s + r[i], 0));
  return {
    footLabel: foot.querySelector("th")?.textContent,
    rowTotals, colTotals, computedCol, grand,
    sumRows: rowTotals.reduce((a, b) => a + b, 0),
    sumCols: colTotals.reduce((a, b) => a + b, 0),
    balanceInbound,
  };
});
console.log(JSON.stringify(report, null, 2));
await page.locator(".od-table").screenshot({ path: join(here, "od-inbound.png") });
await browser.close();
await server.close();
