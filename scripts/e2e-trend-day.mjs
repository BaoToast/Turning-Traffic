/*
 * 歷季趨勢圖不可以把「算不出全日尖峰」畫成 0（v2.1.32）。
 *
 * 不足 24 小時的調查、以及還沒重新匯入的舊備份，底層 DAY 欄位是空值 0。
 * 趨勢圖若直接拿去畫，折線掉到零、右側摘要寫「全日尖峰 0 PCU/hr」——
 * 看起來像那一季流量歸零，事實是這份調查根本算不出全日尖峰。
 *
 * 這支用真的瀏覽器量：整體模式下右側摘要對「全日尖峰」要顯示「－」。
 * 對未修正的 v2.1.31 應該紅字。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages-dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const seed = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
/* 前提：seed 的紀錄涵蓋 24 小時，但沒有 peaks.DAY —— 正是「舊資料要重新匯入」。 */
ok("前提：測資確實算不出全日尖峰（沒有 peaks.DAY）",
  seed.records.every((r) => !r.peaks?.DAY?.start),
  `${seed.records.length} 筆`);

await new Promise((r) => server.listen(8127, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: "zh-TW" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());

await page.goto("http://localhost:8127/");
await page.waitForTimeout(700);
await page.evaluate((json) => {
  localStorage.clear();
  localStorage.setItem("turning-traffic-state-v2", json);
}, JSON.stringify(seed));
await page.reload();
await page.waitForTimeout(1200);

await page.locator('nav button:has-text("歷季趨勢比較")').first().click();
await page.waitForTimeout(900);

/* 切到「整體」模式（三條線都畫） */
const allBtn = page.locator('button:has-text("整體")').first();
if (await allBtn.count()) { await allBtn.click(); await page.waitForTimeout(700); }

const summary = (await page.locator(".trend-summary").first().innerText())
  .replace(/\s+/g, " ").trim();
console.log("   右側摘要：", summary.slice(0, 220));

ok("右側摘要沒有出現「全日尖峰 0 PCU/hr」",
  !/全日尖峰\s*0\s*PCU\/hr/.test(summary), summary.slice(0, 160));
ok("算不出來時顯示「－」", /全日尖峰\s*－/.test(summary), summary.slice(0, 160));
ok("上午／下午尖峰照樣有數字（不可以被一起擋掉）",
  /AM Peak\s*[\d,.]+\s*PCU\/hr/.test(summary) && /PM Peak\s*[\d,.]+\s*PCU\/hr/.test(summary),
  summary.slice(0, 160));

/* 折線本身：DAY 那條不可以有資料點掉在零線上 */
const dayDots = await page.evaluate(() => {
  const svg = document.getElementById("trend-svg");
  if (!svg) return { found: false };
  const circles = [...svg.querySelectorAll("circle")].filter(
    (c) => (c.getAttribute("stroke") || "").toLowerCase() === "#1d4ed8",
  );
  return { found: true, count: circles.length };
});
ok("全日尖峰那條線沒有畫出任何資料點（三季都算不出來）",
  dayDots.found && dayDots.count === 0, JSON.stringify(dayDots));

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
