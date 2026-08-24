/**
 * 檢查「路口轉向 Turning Traffic」匯出的 .xlsx，
 * 是否會讓 Excel 跳出「部分內容有問題／是否嘗試復原」。
 * 規則同 Traffic_Analysis：依 ECMA-376 檢查圖表 part 的元素順序與 Excel 額外限制。
 */
import { chromium } from "playwright";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkWorkbook } from "./ooxml-check.mjs";
import { chromiumLaunchOptions } from "./chromium.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "seed-state.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const { serve } = await import("./serve.mjs");
const server = await serve(8104);
const browser = await chromium.launch(chromiumLaunchOptions());
const downloads = mkdtempSync(join(tmpdir(), "tt-xlsx-"));
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1100 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("console", (m) => {
  if (m.type() === "error" && !/net::ERR_|favicon|404 \(Not Found\)/.test(m.text()))
    errors.push(m.text());
});
page.on("dialog", (d) => d.accept());

// 以既有的種子狀態開站，確保有資料可以匯出
await page.addInitScript((s) => localStorage.setItem("turning-traffic-state-v2", s), seed);
await page.goto("http://localhost:8104/");
await page.waitForTimeout(1500);

await page
  .locator('nav button:has-text("報表與批次輸出"), aside button:has-text("報表與批次輸出")')
  .first()
  .click();
await page.waitForTimeout(1000);

const wait = page.waitForEvent("download", { timeout: 120000 });
await page.locator('button:has-text("下載新版 .xlsx")').first().click();
const dl = await wait;
const file = join(downloads, "turning.xlsx");
await dl.saveAs(file);
const bytes = readFileSync(file);
ok("匯出檔非空", bytes.length > 5000, `${bytes.length} bytes`);

const report = await checkWorkbook(bytes);
console.log("   part 數：", report.parts.length, "／圖表數：", report.charts.length);
for (const issue of report.issues) console.log("   ⚠", issue);
ok(
  "Excel 開檔不會跳出修復提示（OOXML 結構全部合規）",
  report.issues.length === 0,
  report.issues.length ? `${report.issues.length} 項不合規` : "",
);

ok("全程無 JS 錯誤", errors.length === 0, errors.slice(0, 3).join(" ｜ "));
await browser.close();
server.close();
console.log(problems.length ? "\n❌ 有問題：\n" + problems.join("\n") : "\n全部通過");
process.exit(problems.length ? 1 : 0);
