import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromePath } from "../chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "manual.html");

/*
 * 版號與更新日期一律從 manual.html 的封面戳記讀，不在這裡寫死。
 * 寫死的話升版時會悄悄產生一份檔名與頁尾都還是舊版號的手冊，而且不會報錯。
 */
const manualHtml = readFileSync(src, "utf8");
const stamp = manualHtml.match(/系統版本：(v[\d.]+)\s*　?更新日期：([\d-]+)/);
if (!stamp)
  throw new Error("manual.html 讀不到封面戳記「系統版本：vX.Y　更新日期：YYYY-MM-DD」");
const [, MANUAL_VERSION, MANUAL_DATE] = stamp;

const out = join(here, "..", "..", "public", `Turning-Traffic-${MANUAL_VERSION}-新手操作手冊.pdf`);

const chrome = chromePath();
const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto(pathToFileURL(src).href, { waitUntil: "networkidle" });
await page.emulateMedia({ media: "print" });

const style =
  "font-family:'Noto Sans CJK TC',sans-serif;font-size:7pt;color:#6f7e8d;width:100%;padding:0 16mm;";

await page.pdf({
  path: out,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  margin: { top: "20mm", bottom: "18mm", left: "16mm", right: "16mm" },
  headerTemplate: `<div style="${style}text-align:right;">Turning Traffic ｜ 路口尖峰轉向交通量分析 新手操作手冊</div>`,
  footerTemplate:
    `<div style="${style}text-align:center;">${MANUAL_VERSION} ｜ ${MANUAL_DATE} ｜ 正式成果前請先下載備份　　第 ` +
    `<span class="pageNumber"></span> / <span class="totalPages"></span> 頁</div>`,
});

await browser.close();
console.log("PDF 已產生：", out);
