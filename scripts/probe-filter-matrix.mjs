/*
 * 量出「主工具列每一個條件 × 每一頁」的現況：
 *   變 = 切了之後那一頁的數字真的變了
 *   註 = 沒變，但那一頁掛了「不適用」的說明
 *   ✗ = 既沒變也沒說明  ← 這一格就是使用者說的「有遺漏」
 *
 * 這是**量測工具**，不是守門。守門是 e2e-filter-coverage.mjs。
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "github-pages-dist");
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
});
const page = await context.newPage();
await page.addInitScript(
  (value) => localStorage.setItem("turning-traffic-state-v2", value),
  readFileSync(join(here, "seed-wide.json"), "utf8"),
);
page.on("dialog", (event) => event.dismiss());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2400);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

const tabs = await page.evaluate(() =>
  [...document.querySelectorAll("aside nav > div > button")]
    .filter((button) => !button.className.includes("nav-collapse"))
    .map((button) => (button.textContent || "").replace(/\s+/g, "").trim()),
);

const gotoTab = async (name) => {
  await page.evaluate((fragment) => {
    const list = [
      ...document.querySelectorAll("aside nav > div > button"),
    ].filter((button) => !button.className.includes("nav-collapse"));
    const target = list.find((button) =>
      (button.textContent || "").replace(/\s+/g, "").trim() === fragment,
    );
    if (target) target.click();
  }, name);
  await page.waitForTimeout(900);
};

const snapshot = () =>
  page.evaluate(() => {
    const host = document.querySelector(".content") || document.body;
    const skip = [
      ...host.querySelectorAll(
        ".main-toolbar, .chart-detach-note, .chart-inapplicable",
      ),
    ];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let text = "";
    let node;
    while ((node = walker.nextNode()))
      if (!skip.some((element) => element.contains(node.parentElement)))
        text += " " + node.nodeValue;
    return {
      numbers: (text.match(/-?\d[\d,]*\.?\d*/g) || [])
        .map((value) => value.replace(/,/g, ""))
        .join("|"),
      notes: host.querySelectorAll(".chart-inapplicable").length,
    };
  });

const { DEFAULT_MAIN_FILTERS: DEFAULTS } = await import("../app/main-filters.ts");
const CASES = [
  ["C 尖峰時段", "mt-peak", "PM", "AM"],
  ["C2 上午＋下午並列", "mt-peak", "AMPM", "AM"],
  ["D 尖峰判定", "mt-peak-rule", "direction", "point"],
  ["E 流量視角", "mt-flow-view", "inbound", "both"],
  /* ⚠️ 資料別的「全部」在甲案之後不存在了，還原值要取程式裡的預設。 */
  ["F 資料別", "mt-day", "weekday", DEFAULTS.day],
  ["G 車種", "mt-vehicle", null, "all"],
  ["H 轉向別", "mt-movement", "left", "all"],
  ["I 顯示數值", "mt-display", "percent", "both"],
];

const rows = [];
for (const [label, testid, value, backTo] of CASES) {
  let target = value;
  if (!target) {
    const options = await page.evaluate(
      (id) =>
        [...document.querySelectorAll(`[data-testid="${id}"] option`)].map(
          (option) => option.value,
        ),
      testid,
    );
    target = options.find((option) => option !== "all");
  }
  if (!target) {
    rows.push([label, "（沒有可選的值）"]);
    continue;
  }
  const before = {};
  for (const tab of tabs) {
    await gotoTab(tab);
    before[tab] = (await snapshot()).numbers;
  }
  await page.selectOption(`[data-testid="${testid}"]`, target);
  await page.waitForTimeout(900);
  const result = [];
  for (const tab of tabs) {
    await gotoTab(tab);
    const after = await snapshot();
    const changed = after.numbers !== before[tab];
    result.push(
      `${tab}=${changed ? "變" : after.notes ? "註" : "✗"}`,
    );
  }
  await page.selectOption(`[data-testid="${testid}"]`, backTo);
  await page.waitForTimeout(900);
  rows.push([label + "→" + target, result.join("  ")]);
}

for (const [label, detail] of rows) console.log("\n### " + label + "\n" + detail);

await browser.close();
server.close();
