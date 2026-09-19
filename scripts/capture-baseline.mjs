/*
 * ══════════════════════════════════════════════════════════════════════
 *  升級前後逐格比對用的「數字基準」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 對主工具列升級的要求：
 *   「請務必確認好數值正確性……確認數值反覆驗證及高度正確性」
 *
 * 主工具列這種改動最危險的地方不是畫面，是**它會不會悄悄改掉既有數字**。
 * 所以在動任何一行程式之前，先把每一頁**每一個數字連同它的位置**存下來；
 * 升級之後把主工具列設回「等同現行預設」的條件，再跑一次，逐格比對。
 *
 * ⚠️ 存的是**每個數字在哪個元素裡**，不是只存一串數字。
 *   只存一串的話，兩個數字對調位置也會比對通過——那正是會寫錯報告的錯。
 *
 * ⚠️ 排除主工具列與篩選列本身：它們每一頁都在，改條件當然會變。
 *   （第一次量就是忘了排除，設定頁也顯示「有變」，其實只是篩選列上的季度字樣。）
 *
 * 用法：
 *   node scripts/capture-baseline.mjs 升級前   → 寫出 baseline/g2164-升級前.json
 *   node scripts/capture-baseline.mjs 升級後   → 寫出 baseline/g2164-升級後.json
 *   node scripts/compare-baseline.mjs 升級前 升級後
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "github-pages-dist");
const outDir = join(here, "..", "..", "baseline");
mkdirSync(outDir, { recursive: true });
const tag = process.argv[2] || "未命名";

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
  readFileSync(join(here, "seed-state.json"), "utf8"),
);
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.dismiss());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2200);

const tabs = await page.evaluate(() =>
  [...document.querySelectorAll("aside nav > div > button")]
    .filter((button) => !button.className.includes("nav-collapse"))
    .map((button, index) => ({
      index,
      label: (button.textContent || "").replace(/\s+/g, "").trim(),
    })),
);

/**
 * 一頁的「每一格數字」：走訪每個文字節點，記下
 * 它所在元素的路徑（tag 串）＋ 同層第幾個 ＋ 那一段文字裡的數字。
 * 位置換了、數字換了，比對都會抓到。
 */
async function cells() {
  return page.evaluate(() => {
    const host = document.querySelector(".content") || document.body;
    const skip = [...host.querySelectorAll(".toolbar, .filters, .main-toolbar")];
    const inSkip = (element) => skip.some((node) => node.contains(element));
    const pathOf = (element) => {
      const parts = [];
      for (let node = element; node && node !== host; node = node.parentElement) {
        const parent = node.parentElement;
        const index = parent
          ? [...parent.children].indexOf(node)
          : 0;
        parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
      }
      return parts.join(">");
    };
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const out = [];
    let node;
    while ((node = walker.nextNode())) {
      const element = node.parentElement;
      if (!element || inSkip(element)) continue;
      const text = (node.nodeValue || "").trim();
      if (!text) continue;
      /*
       * ⚠️ 時間戳要遮掉，不然基準永遠對不起來。
       *   實測：匯入紀錄與備份清單有「2026/9/14 上午9:31:44」與
       *   「B1789378294426」（毫秒時間戳當編號），兩次擷取一定不同——
       *   67 格因此紅掉，而那不是數字被改，是我量錯東西。
       * ⚠️ 遮罩刻意寫窄：只遮「日期時間格式」與「13 位毫秒時間戳」，
       *   不可以寫成「長數字一律遮掉」——那會把真的流量數字一起遮掉。
       */
      /*
       * ⚠️ **不可以**把「時:分」也當成時間戳遮掉。
       *   第一版寫成「含 \d{1,2}:\d{2} 就遮」，結果把
       *   「07:00~08:00」這種**尖峰時段起訖**也遮掉了——路口轉向一口氣
       *   少掉 261 個數字（1434 → 1173）。那是真正的分析數值，
       *   尖峰視窗挑錯了正是我們最要抓的錯，遮掉等於把守門的眼睛蒙上。
       *   只有**帶日期**的（匯入時間、備份時間）才是每次都不一樣的時間戳。
       */
      const looksLikeTime = /\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(text);
      const numbers = looksLikeTime
        ? ["<時間戳>"]
        : (text.match(/-?\d[\d,]*\.?\d*/g) || [])
            .map((value) => value.replace(/,/g, ""))
            .map((value) => (/^1[6-9]\d{11}$/.test(value) ? "<時間戳>" : value));
      if (!numbers.length) continue;
      out.push({ at: pathOf(element), text, numbers });
    }
    return out;
  });
}

const snapshot = { tag, capturedAt: new Date().toISOString(), pages: {} };
for (const tab of tabs) {
  await page.evaluate((index) => {
    const list = [
      ...document.querySelectorAll("aside nav > div > button"),
    ].filter((button) => !button.className.includes("nav-collapse"));
    if (list[index]) list[index].click();
  }, tab.index);
  await page.waitForTimeout(950);
  snapshot.pages[tab.label] = await cells();
}
snapshot.errors = errors;

const file = join(outDir, `g2164-${tag}.json`);
writeFileSync(file, JSON.stringify(snapshot, null, 1), "utf8");
const total = Object.values(snapshot.pages).reduce(
  (sum, list) => sum + list.reduce((n, cell) => n + cell.numbers.length, 0),
  0,
);
console.log(`已存下 ${Object.keys(snapshot.pages).length} 頁、${total} 個數字`);
for (const [label, list] of Object.entries(snapshot.pages))
  console.log(
    `  ${label}：${list.reduce((n, cell) => n + cell.numbers.length, 0)} 個`,
  );
if (errors.length) console.log("⚠️ 期間有 JS 例外：", errors.slice(0, 3));
console.log("→", file);

await browser.close();
server.close();
