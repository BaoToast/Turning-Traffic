import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromePath } from "../chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "manual.html");
const out = join(here, "..", "..", "public", "Turning-Traffic-v2.1.25-新手操作手冊.pdf");

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
    `<div style="${style}text-align:center;">v2.1.25 ｜ 2026-08-25 ｜ 正式成果前請先下載備份　　第 ` +
    `<span class="pageNumber"></span> / <span class="totalPages"></span> 頁</div>`,
});

await browser.close();
console.log("PDF 已產生：", out);
