/* 探針：把「有 class 但沒有 CSS 規則」的那幾塊拍下來，人看一下是不是真的壞掉。 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "../serve.mjs";
import { launchOptions } from "../chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8277;
const seed = readFileSync(join(here, "..", "seed-wide.json"), "utf8");
const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1536, height: 900 },
    locale: "zh-TW",
  })
).newPage();
page.on("dialog", (d) => d.accept());
await page.addInitScript((t) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", t);
  } catch {
    /* ignore */
  }
}, seed);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

for (const [label, selector, file] of [
  ["計畫管理", ".project-list", "project-list"],
  ["車種組成分析", ".composition-kpis", "composition-kpis"],
  ["報表與批次輸出", ".report-draft-head", "report-draft-head"],
  ["新手操作手冊", ".help-head", "help-head"],
]) {
  await page.locator("nav button", { hasText: label }).first().click();
  await page.waitForTimeout(900);
  const el = page.locator(selector).first();
  if (!(await el.count())) {
    console.log(`${label}：找不到 ${selector}`);
    continue;
  }
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await el.boundingBox();
  console.log(
    `${label} ${selector} → ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "無尺寸"}`,
  );
  await el.screenshot({ path: join(here, `unstyled-${file}.png`) });
}
await browser.close();
await server.close();
