/*
 * ══════════════════════════════════════════════════════════════════════
 *  畫面實測：使用者真的會等的那幾件事，各花多少毫秒
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-23：
 *   「請確保程式性能上不要有 Lag 情況發生……要能順暢跑每一筆資料」
 *   「如果效能上不會有延遲問題，沒做改變也是合理的」
 *
 * ── 這一支和 tests/perf-scaling.test.ts 的分工 ────────────────
 *
 * `tests/perf-scaling.test.ts` 守的是**演算法的成長形狀**（純函式，
 * 資料 ×10 時間不可以 ×100），跑在每一次 `npm test` 裡。
 *
 * 這一支開真的瀏覽器、走真的畫面，量的是**使用者會盯著等**的那幾個
 * 動作。純函式再快，如果 React 每按一下就把整棵樹重算一遍，一樣會卡。
 *
 * ⚠️ **刻意不是測試、不掛進 `npm run e2e`。**
 *   它印絕對毫秒數，而絕對值在不同機器上差好幾倍。做成會紅的測試
 *   只會變成「有時候紅、重跑就綠」，最後被關掉。用途是**交付前跑一次、
 *   把數字寫進文件**，以及日後懷疑變慢時拿同一支再跑一次做比較。
 *
 * ⚠️ 量測腳本自己壞掉時要**大聲失敗**，不可以吞例外。
 *   姊妹專案全日交通量的第一版就是吞掉找不到控制項的例外，
 *   結果印出「30032 ms」（其實是 Playwright 逾時）——一支會印假數字的
 *   效能量測比沒有量測更糟：它會讓人去優化一個不存在的問題。
 *
 * 用法：
 *   npm run build:github && node scripts/seed-state.mjs && node scripts/make-wide-seed.mjs && node scripts/perf-ui.mjs
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages-dist");
const SEED = join(here, "seed-wide.json");
if (!existsSync(ROOT))
  throw new Error(`找不到 ${ROOT}——請先執行 npm run build:github`);
if (!existsSync(SEED))
  throw new Error(
    `找不到 ${SEED}——請先執行 node scripts/seed-state.mjs && node scripts/make-wide-seed.mjs`,
  );

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(8198, r));

const seed = readFileSync(SEED, "utf8");
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 隱私瀏覽時寫不進去；下面的前置檢查會抓到並中止，不會靜靜量假數字。 */
  }
}, seed);

const rows = [];
/**
 * 量一個動作花多久。
 *
 * ⚠️ 量的是「按下去 → 畫面真的畫完」。每一次都等兩個 requestAnimationFrame，
 *   React 更新完、瀏覽器也真的畫上去才算數。只等 promise resolve 會量到
 *   一個漂亮但假的數字。
 */
async function timed(label, action) {
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const started = Date.now();
  await action();
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const ms = Date.now() - started;
  rows.push([label, ms]);
  console.log(`  ${String(ms).padStart(6)} ms  ${label}`);
  return ms;
}

await page.goto("http://localhost:8198/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

/*
 * ⚠️ 前置檢查要看**畫面**，不是看 localStorage。
 *
 *   這支程式啟動時會把 localStorage 的舊狀態搬進 IndexedDB 並清掉
 *   localStorage 那一份（見 lib/state-storage.ts 的搬遷）。所以
 *   「載入後 localStorage 還在不在」根本不是測資有沒有進去的判準——
 *   第一版就是那樣寫的，結果每次都誤報「測資沒有進到 localStorage」。
 *   改成問畫面：側欄有沒有長出來、畫面上有沒有季別。
 */
const seeded = await page.evaluate(() => {
  const quarters = new Set(
    (document.body.innerText.match(/\b11[0-9]Q[1-4]\b/g) || []),
  );
  return {
    quarters: quarters.size,
    navButtons: document.querySelectorAll("nav button").length,
  };
});
if (!seeded.quarters || seeded.navButtons < 5)
  throw new Error(
    `測資沒有進到畫面（季別 ${seeded.quarters} 種、側欄 ${seeded.navButtons} 顆鈕）` +
      "——下面量出來的都是空畫面的數字",
  );
console.log(
  `\n測資：畫面上出現 ${seeded.quarters} 種季別、側欄 ${seeded.navButtons} 顆鈕` +
    "（seed-wide：16 季、站號中途換過兩次、含並存站號）",
);

console.log("\n══ 使用者會盯著等的動作 ══");
/*
 * ⚠️ 先量一個**什麼都不做**的基準線。
 *   `timed()` 本身有固定成本（兩次 rAF ＋ Playwright 來回）。
 *   不先量的話，下面每一項都分不出「真的在算」與「腳本開銷」。
 */
await timed("（基準線：什麼都不做）", async () => {});

const navButtons = page.locator("nav button");
const navCount = await navButtons.count();
for (let i = 0; i < Math.min(navCount, 18); i += 1) {
  const button = navButtons.nth(i);
  const label = (await button.textContent())?.trim().slice(0, 14) || `第${i}顆`;
  if (!(await button.isVisible())) continue;
  await timed(`切到「${label}」`, async () => {
    await button.click();
    await page.waitForTimeout(80);
  });
}

console.log("\n══ 結果 ══");
const baseline = rows[0][1];
const worst = rows.slice(1).reduce((a, b) => (b[1] > a[1] ? b : a), ["—", 0]);
console.log(`基準線（腳本自己的開銷）：${baseline} ms`);
console.log(`最慢的一項：${worst[0]} = ${worst[1]} ms`);
console.log(
  errors.length
    ? `⚠️ 有 ${errors.length} 個 JS 例外：${errors.slice(0, 3).join(" | ")}`
    : "沒有 JS 例外",
);
console.log(
  "\n⚠️ 每一項都含一個刻意的 80ms 等待（等 React 換頁）與約 " +
    baseline +
    "ms 的腳本開銷，真正在算的是剩下的部分。",
);
console.log(
  "⚠️ 這些是**這台機器**（2 CPU、無 GPU 的 Linux 容器）的數字，" +
    "不等於使用者 Windows 筆電的體感。判讀時看的是「有沒有哪一項離群」，" +
    "以及與上一版同一支腳本的比較，不是拿絕對值去對一個標準。",
);

await browser.close();
server.close();
