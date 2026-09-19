/* 探針：各路口尖峰彙總新增的「調查日」欄，以及結論草稿的支線清單。 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "../serve.mjs";
import { launchOptions } from "../chrome-path.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8291;
const seed = readFileSync(join(here, "..", "seed-wide.json"), "utf8");
const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-TW" })).newPage();
page.on("dialog", (d) => d.accept());
page.on("pageerror", (e) => console.log("PAGEERROR", String(e.message).slice(0, 160)));
await page.addInitScript((t) => { try { localStorage.setItem("turning-traffic-state-v2", t); } catch { /* ignore */ } }, seed);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.locator('nav button:has-text("各路口尖峰彙總")').first().click();
await page.waitForTimeout(900);
console.log("== 各路口尖峰彙總 表頭與前三列 ==");
console.log(await page.evaluate(() => {
  const t = document.querySelector(".table-scroll table");
  if (!t) return "找不到表";
  const head = [...t.querySelectorAll("thead th")].map((h) => h.textContent.trim());
  const rows = [...t.querySelectorAll("tbody tr")].slice(0, 3)
    .map((tr) => [...tr.children].map((td) => td.textContent.trim().replace(/\s+/g, " ")).slice(0, 3).join(" | "));
  return JSON.stringify({ head, rows }, null, 1);
}));
await page.locator(".table-scroll").first().screenshot({ path: join(here, "peaks-date.png") });
await page.locator('nav button:has-text("結論草稿產生器")').first().click();
await page.waitForTimeout(1200);
console.log("== 結論草稿 四、要寫哪些支線 ==");
console.log(await page.evaluate(() => {
  const fs = [...document.querySelectorAll("fieldset")].find((f) => (f.querySelector("legend")?.textContent || "").includes("支線"));
  if (!fs) return "找不到";
  return [...fs.querySelectorAll("label")].map((l) => l.textContent.trim()).join(" / ");
}));
await browser.close();
await server.close();
