/*
 * ══════════════════════════════════════════════════════════════════
 *  單欄版面時：圖 → 圖說 → 季度變化（A5）
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-21 回報：畫面縮放到 110%（視窗 < 1400 CSS px）時版面
 * 收成單欄，**圖的正下方是「季度變化」**，要看的圖說被隔到更下面，
 * 得來回捲才能邊看圖說邊對照圖。
 *
 * ── ⚠️ 這一支刻意迴避的假通過 ────────────────────────────────
 *
 * 一、**只驗單欄那一邊不算數。** 只把窄視窗驗綠的話，把兩欄也一起改掉
 *     也會通過——而使用者明說「兩欄（100%）時完全不動」。
 *     所以兩個寬度都量，而且寬視窗要驗**兩欄仍然成立**。
 * 二、**用 DOM 順序判斷不算數。** order 改的是視覺順序，DOM 順序不會變。
 *     一定要量實際的畫面座標（getBoundingClientRect().top）。
 * 三、**斷點兩側都要量。** 這個專案踩過「兩個斷點各寫各的、中間留空窗」
 *     的坑（1101～1420px 那次圖被整片蓋掉）。這裡量 1399 與 1400。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8271;
const seed = readFileSync(join(here, "seed-wide.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await installStateHelpers(page);
await page.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 無痕或封鎖時就算了，下面的前置檢查會紅。 */
  }
}, seed);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
await page.locator('nav button:has-text("歷季趨勢比較")').first().click();
await page.waitForTimeout(1500);
const picker = page.locator(".trend-controls select").first();
await picker
  .selectOption({ label: "示範路－示範二路－示範三街路口" })
  .catch(() => {});
await page.waitForTimeout(900);

/*
 * 前置檢查：三塊都在。少了任何一塊，下面比大小的判斷會變成恆真
 * （undefined 比什麼都不成立，但「不成立」會被寫成紅；這裡直接擋在前面，
 * 讓訊息說得出是哪一塊不見了）。
 */
const present = await page.evaluate(() => ({
  chart: Boolean(document.querySelector(".trend-layout > .trend-chart")),
  script: Boolean(document.querySelector(".trend-layout > .trend-script")),
  summary: Boolean(document.querySelector(".trend-layout > .trend-summary")),
}));
ok("前置：圖在", present.chart);
ok("前置：圖說在", present.script);
ok("前置：季度變化在", present.summary);

/** 三塊在畫面上的實際位置（不是 DOM 順序）。 */
const tops = async () => {
  /* sticky 會讓圖的 top 跟著捲動變，先回到頁首再量。 */
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const at = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top + window.scrollY), left: Math.round(r.left) };
    };
    return {
      chart: at(".trend-layout > .trend-chart"),
      script: at(".trend-layout > .trend-script"),
      summary: at(".trend-layout > .trend-summary"),
    };
  });
};

for (const width of [1200, 1399]) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(500);
  const t = await tops();
  ok(
    `${width}px（單欄）：圖在最上面`,
    t.chart && t.script && t.summary && t.chart.top < t.script.top,
    JSON.stringify(t),
  );
  ok(
    `${width}px（單欄）：圖說排在季度變化**前面**`,
    t.script && t.summary && t.script.top < t.summary.top,
    t.script && t.summary
      ? `圖說 ${t.script.top}、季度變化 ${t.summary.top}`
      : "量不到",
  );
}

for (const width of [1400, 1600]) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(500);
  const t = await tops();
  /*
   * 兩欄版面：圖在左欄，摘要與圖說疊在右欄。
   * 驗的是「兩欄仍然成立」——圖的左緣要明顯在另外兩塊的左邊。
   * 這一條就是在擋「順手把兩欄也一起改掉」。
   */
  ok(
    `${width}px（兩欄）：版面沒有被改動，圖仍在左欄`,
    t.chart && t.summary && t.chart.left < t.summary.left,
    t.chart && t.summary ? `圖左緣 ${t.chart.left}、摘要左緣 ${t.summary.left}` : "量不到",
  );
  ok(
    `${width}px（兩欄）：摘要仍在圖說上方（右欄的原本順序）`,
    t.summary && t.script && t.summary.top <= t.script.top,
    t.summary && t.script
      ? `摘要 ${t.summary.top}、圖說 ${t.script.top}`
      : "量不到",
  );
}

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" / "));

await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過`);
  process.exit(1);
}
console.log("\n✅ 全部通過");
