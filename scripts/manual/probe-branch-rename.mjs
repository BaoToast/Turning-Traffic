/*
 * 探針：走使用者的那條路——在「道路與流向管理」把某一個路口的支線改名，
 * 再去看結論草稿的支線清單會不會多出一個獨立選項。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "../serve.mjs";
import { launchOptions } from "../chrome-path.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8292;
const seed = readFileSync(join(here, "..", "seed-wide.json"), "utf8");
const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-TW" })).newPage();
page.on("dialog", (d) => d.accept());
page.on("pageerror", (e) => console.log("PAGEERROR", String(e.message).slice(0, 160)));
await page.addInitScript((t) => { try { localStorage.setItem("turning-traffic-state-v2", t); } catch { /* ignore */ } }, seed);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const branchList = async () =>
  page.evaluate(() => {
    const fs = [...document.querySelectorAll("fieldset")].find((f) =>
      (f.querySelector("legend")?.textContent || "").includes("支線"),
    );
    return fs ? [...fs.querySelectorAll("label")].map((l) => l.textContent.trim()) : [];
  });

await page.locator('nav button:has-text("結論草稿產生器")').first().click();
await page.waitForTimeout(1000);
console.log("改名前：", (await branchList()).join(" / "));

await page.locator('nav button:has-text("道路與流向管理")').first().click();
await page.waitForTimeout(1200);
/* 把目前這個路口的前三條支線改成 1 / 2 / 3（使用者實際做的事） */
const inputs = page.locator('.geometry-list input[type="text"], .geometry-list input:not([type])');
const n = Math.min(3, await inputs.count());
for (let i = 0; i < n; i += 1) {
  await inputs.nth(i).fill(String(i + 1));
  await page.waitForTimeout(250);
}
console.log(`改了 ${n} 條支線的名稱`);
await page.waitForTimeout(600);

await page.locator('nav button:has-text("結論草稿產生器")').first().click();
await page.waitForTimeout(1200);
console.log("改名後：", (await branchList()).join(" / "));
await browser.close();
await server.close();
