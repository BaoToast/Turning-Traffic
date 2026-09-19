/*
 * ══════════════════════════════════════════════════════════════════════
 *  各分頁的「目前路口」是同一份，不是各存各的
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「有些自己的功能列沒有與上面共同功能列同步，有些則是有同步……
 *     如果有發現bug請修正」
 *   「篩選錯誤和計算錯誤是一樣嚴重，因為我以為我篩的是A條件，
 *     結果卻是其他功能列B的條件，結果一樣嚴重。」
 *
 * 這一支程式的上方共同功能列只有「計畫」與「季度」——路口是每一頁自己的
 * 選擇器（因為每一頁一次只看一個路口）。查證結果：
 *   ・路口轉向圖、車種組成分析、流量核對工作台、各路口駛入／駛出流量
 *     共用同一份 selectedIntersection ✅
 *   ・**歷季趨勢比較自己另存了一份** ❌
 * 於是在轉向圖切到路口C、再點進歷季趨勢比較，看到的仍是別的路口，
 * 而畫面上沒有任何提示。這種錯不會壞掉，只會讓人看錯圖。
 *
 * ⚠️ 兩個方向都要驗：
 *   ① 在 A 頁切路口 → B 頁跟著
 *   ② 在 B 頁切路口 → A 頁也要跟著
 *   只驗①的話，一份「單向複製」的實作會全綠。
 *
 * ⚠️ 而且要驗**畫面上的內容真的換了**，不是只有下拉選單的值換了。
 *   只比對 select.value 的話，一份「選單換了、圖沒換」的實作會全綠——
 *   而那正是最危險的情況。
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { serve } = await import(pathToFileURL(join(HERE, "serve.mjs")).href);
const { launchOptions } = await import(
  pathToFileURL(join(HERE, "chrome-path.mjs")).href
);
const { installStateHelpers } = await import(
  pathToFileURL(join(HERE, "read-state.mjs")).href
);
const seed = readFileSync(join(HERE, "seed-state.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(8161);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());

await installStateHelpers(page);
await page.goto("http://localhost:8161/");
await page.waitForTimeout(900);
await page.evaluate(async (state) => {
  localStorage.clear();
  await window.__writeState(state);
}, seed);
await page.reload();
await page.waitForTimeout(1800);

const go = async (label) => {
  await page.locator(`nav > div > button:has-text("${label}")`).first().click();
  await page.waitForTimeout(900);
};

/** 某一頁上「路口」那個下拉的目前值與選項，以及畫面上實際顯示的路口名。 */
const pageState = () =>
  page.evaluate(() => {
    /*
     * ⚠️ 不可以用「選項文字裡有沒有『路口』」來認這個下拉。
     *   季度下拉的選項寫的是「115Q2（2 路口）」——裡面就有「路口」兩個字，
     *   於是會挑到季度那一個，整支測試變成在測季度同步，而且會紅得
     *   莫名其妙（實測過）。改成認**它前面那個 <label> 的文字**。
     */
    const pick = [...document.querySelectorAll(".content label")]
      .filter((el) => (el.childNodes[0]?.textContent || "").trim() === "路口")
      .map((el) => el.querySelector("select"))
      .find(Boolean);
    return {
      value: pick?.value || "",
      shown: pick ? (pick.options[pick.selectedIndex]?.textContent || "").trim() : "",
      options: pick
        ? [...pick.options].map((option) => (option.textContent || "").trim())
        : [],
      /* 畫面上真的印出來的路口名（不是下拉的值）。 */
      heading: (document.querySelector(".content h1, .content h2")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim(),
    };
  });

await go("路口轉向圖");
const first = await pageState();
ok(
  "前置：轉向圖上有路口可以切換，而且不只一個",
  first.options.length >= 2,
  first.options.join("、") || "找不到路口下拉",
);
if (first.options.length < 2) {
  console.error("種子資料只有一個路口，這支測試測不到東西");
  await browser.close();
  await server.close?.();
  process.exit(1);
}

/* ── ① 在轉向圖切路口 → 歷季趨勢比較要跟著 ── */
console.log("\n══ ① 轉向圖 → 歷季趨勢比較 ══");
const target = first.options[1];
await page.evaluate((label) => {
  const pick = [...document.querySelectorAll(".content label")]
    .filter((el) => (el.childNodes[0]?.textContent || "").trim() === "路口")
    .map((el) => el.querySelector("select"))
    .find(Boolean);
  const option = [...(pick?.options || [])].find(
    (item) => (item.textContent || "").trim() === label,
  );
  if (pick && option) {
    pick.value = option.value;
    pick.dispatchEvent(new Event("change", { bubbles: true }));
  }
}, target);
await page.waitForTimeout(900);
const afterSwitch = await pageState();
ok(
  `前置：轉向圖確實切到「${target}」`,
  afterSwitch.shown === target,
  `目前是「${afterSwitch.shown}」`,
);

await go("歷季趨勢比較");
const trend = await pageState();
ok(
  "⚠️ ① 歷季趨勢比較跟著切到同一個路口（舊版它自己存一份，會停在別的路口）",
  trend.shown === target,
  `轉向圖切到「${target}」，趨勢頁顯示的是「${trend.shown}」`,
);
/*
 * ⚠️ 不可以只看下拉的值。只比對 select.value 的話，一份
 *   「選單換了、圖沒換」的實作會全綠——而那正是最危險的情況。
 */
const trendTitle = await page.evaluate(
  () =>
    (document.querySelector(".trend-chart h2, .trend-chart .chart-title, .content h2")
      ?.textContent || "").replace(/\s+/g, " ").trim(),
);
ok(
  "⚠️ ① 而且圖上印的路口名也是同一個（不是只有下拉換了）",
  trendTitle.includes(target) || trend.heading.includes(target),
  `圖上寫「${trendTitle}」`,
);

/* ── ② 在歷季趨勢比較切回去 → 轉向圖也要跟著 ── */
console.log("\n══ ② 歷季趨勢比較 → 轉向圖 ══");
const back = first.options[0];
await page.evaluate((label) => {
  const pick = [...document.querySelectorAll(".content label")]
    .filter((el) => (el.childNodes[0]?.textContent || "").trim() === "路口")
    .map((el) => el.querySelector("select"))
    .find(Boolean);
  const option = [...(pick?.options || [])].find(
    (item) => (item.textContent || "").trim() === label,
  );
  if (pick && option) {
    pick.value = option.value;
    pick.dispatchEvent(new Event("change", { bubbles: true }));
  }
}, back);
await page.waitForTimeout(900);
await go("路口轉向圖");
const backOnDiagram = await pageState();
ok(
  "⚠️ ② 在趨勢頁切路口，轉向圖也跟著（只驗單向的話，單向複製也會全綠）",
  backOnDiagram.shown === back,
  `趨勢頁切到「${back}」，轉向圖顯示的是「${backOnDiagram.shown}」`,
);

/* ── ③ 車種組成分析也是同一份 ── */
console.log("\n══ ③ 車種組成分析 ══");
await go("車種組成分析");
const composition = await pageState();
ok(
  "③ 車種組成分析也跟著同一個路口",
  composition.shown === back,
  `顯示的是「${composition.shown}」，應該是「${back}」`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
await server.close?.();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 各分頁的「目前路口」是同一份，兩個方向都同步");
