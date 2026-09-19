/*
 * ══════════════════════════════════════════════════════════════════════
 *  肉眼檢查用：把每一頁、每一張圖拍下來
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「我重視的數據正確性，及要用肉眼觀看為準的各項功能和圖表，
 *     確認異常都完成修正後，再提供試用檔給我」
 *
 * ⚠️ 這一支**不判斷對錯**，只負責把畫面拍清楚。
 *   自動守門看得到的是數字與 DOM；看不到的是
 *   「字被切掉」「兩個標籤疊在一起」「圖例跑到圖外面」「長條與刻度對不上」，
 *   那些只有把圖拍出來、真的看一眼才會發現。
 *
 * ⚠️ 全頁截圖（fullPage）不可以省。只拍視窗的話，
 *   捲動之後才出現的區塊永遠不會被看到——而那正是最容易壞的地方。
 *
 * 輸出：scripts/.shots/<分頁>.png、<分頁>--<區塊>.png
 */
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "github-pages-dist");
const OUT = join(here, ".shots");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer((request, response) => {
  let path = join(
    root,
    decodeURIComponent(request.url.split("?")[0]).replace(/^\//, "") ||
      "index.html",
  );
  if (!existsSync(path)) path = join(root, "index.html");
  response.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1700, height: 1100 },
  locale: "zh-TW",
  deviceScaleFactor: 1,
});
const page = await context.newPage();
await page.addInitScript(
  (value) => localStorage.setItem("turning-traffic-state-v2", value),
  readFileSync(join(here, "seed-state.json"), "utf8"),
);
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.dismiss());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const safe = (text) => text.replace(/[^一-龥A-Za-z0-9]+/g, "_");

const tabs = await page.evaluate(() =>
  [...document.querySelectorAll("aside nav > div > button")]
    .filter((button) => !button.className.includes("nav-collapse"))
    .map((button) => (button.textContent || "").replace(/\s+/g, "").trim()),
);
console.log(`分頁：${tabs.join("、")}`);

const gotoTab = async (fragment) => {
  await page.evaluate((text) => {
    const list = [
      ...document.querySelectorAll("aside nav > div > button"),
    ].filter((button) => !button.className.includes("nav-collapse"));
    list.find((button) => (button.textContent || "").includes(text))?.click();
  }, fragment);
  await page.waitForTimeout(1300);
};

let index = 0;
for (const tab of tabs) {
  index += 1;
  await gotoTab(tab);
  const name = `${String(index).padStart(2, "0")}_${safe(tab)}`;
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    fullPage: true,
  });
  /* 每一張圖（面板）再單獨拍一張，字才看得清楚。 */
  const panels = await page.locator(".content .panel").all();
  let panelIndex = 0;
  for (const panel of panels) {
    panelIndex += 1;
    if (panelIndex > 12) break;
    const box = await panel.boundingBox();
    if (!box || box.height < 80) continue;
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const title = (
      await panel.evaluate(
        (node) => node.querySelector("h2, h3, .panel-title")?.textContent || "",
      )
    )
      .replace(/\s+/g, "")
      .slice(0, 14);
    await panel
      .screenshot({
        path: join(OUT, `${name}--${String(panelIndex).padStart(2, "0")}_${safe(title) || "區塊"}.png`),
      })
      .catch(() => {});
  }
  console.log(`  ✔ ${name}（${panels.length} 個區塊）`);
}

console.log(errors.length ? `⚠️ JS 例外：${errors.slice(0, 5).join(" | ")}` : "（無 JS 例外）");
await browser.close();
server.close();
console.log(`\n拍完了：${OUT}`);
