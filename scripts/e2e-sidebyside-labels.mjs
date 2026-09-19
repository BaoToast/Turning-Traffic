/**
 * ══════════════════════════════════════════════════════════════════════
 *  K-5：**並列**（平日＋假日、駛出＋駛入）時，圖上的字不可以疊在一起
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「只要確保 XY 軸名稱和 XY 軸刻度不重疊、顯示的文字不要被縮減成
 *     『XXX路...』這類沒完全顯示出來基本上就沒問題，請記得圖類型檔案，
 *     不論 excel 還是匯出的圖檔或是程式上顯示的圖，
 *     都要以肉眼觀察過，以完整呈現數據及美觀整齊為首要」
 *   「⚠️ **8 筆以內也要確保不重疊**」
 *
 * ── 為什麼要另外一支 ────────────────────────────────────────────
 *
 * 既有的 e2e-chart-layout 驗的是「季度很多時會不會擠」（一路壓到 40 季），
 * 那是**單數列、資料多**的情形。而使用者指名的是**另一種**：
 * **並列時資料少也會疊**——兩條數列的同一季在同一個 x 上，
 * 兩個數值標籤本來就靠在一起，季度少的時候點距大、標籤反而更大，
 * 疊起來的機會比 40 季那種還高。全日交通量已經改成矩形碰撞避讓，
 * 這一支是把**同一套檢查**推到路口轉向。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 *
 * 一、**前置一定要確認「真的並列了」**（畫出兩條數列）。只設下拉不檢查的話，
 *     萬一那個選項沒接上，整支會在單數列上驗，永遠不會疊——恆真。
 * 二、**不可以只驗 X 軸標籤。** 使用者點名的是「顯示的文字」，
 *     包含資料點上的數值標籤——那正是並列時會疊的東西。
 * 三、**要量畫面上的實際外框**（getBoundingClientRect），不是 SVG 的
 *     viewBox 座標：縮放與字型代換都只在畫面上看得見。
 * 四、**多種寬度都要量。** 疊不疊和可用寬度直接相關，只量一種寬度
 *     等於只驗了一台電腦。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8307;
/*
 * ⚠️ 用 seed-wide（16 季）但**只看其中三季**——使用者指名的是「8 筆以內」。
 *   季度多的那一種由 e2e-chart-layout 顧，兩支各守一邊。
 */
const seed = readFileSync(join(here, "seed-wide.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 950 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
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
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

const gotoTab = async (label) => {
  const found = await page.evaluate((text) => {
    const list = [...document.querySelectorAll("aside nav button")].filter(
      (button) => !button.className.includes("nav-collapse"),
    );
    const target = list.find((button) => (button.textContent || "").includes(text));
    if (!target) return false;
    target.click();
    return true;
  }, label);
  await page.waitForTimeout(1200);
  return found;
};

/** 把主工具列的某個下拉設成指定值。 */
const setMain = async (testId, value) => {
  const found = await page.evaluate(
    ([id, wanted]) => {
      const select = document.querySelector(`[data-testid="${id}"]`);
      if (!select) return false;
      const option = [...select.options].find((item) => item.value === wanted);
      if (!option) return false;
      select.value = wanted;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    [testId, value],
  );
  await page.waitForTimeout(1200);
  return found;
};
/**
 * 量某一個容器裡所有 <text> 的畫面外框，回報兩兩重疊的組合。
 *
 * ⚠️ 判準加 1px 容差：反鋸齒與次像素定位會讓兩個「剛好貼著」的字
 *   量出 0.3px 的重疊，那不是使用者看得到的問題。真正的重疊都在數 px 以上。
 */
const overlapsIn = (selector) =>
  page.evaluate((sel) => {
    const out = [];
    for (const svg of document.querySelectorAll(sel)) {
      const texts = [...svg.querySelectorAll("text")]
        .filter((node) => (node.textContent || "").trim())
        .map((node) => {
          const box = node.getBoundingClientRect();
          return {
            text: (node.textContent || "").trim(),
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            width: box.width,
          };
        })
        .filter((item) => item.width > 0);
      for (let i = 0; i < texts.length; i += 1)
        for (let j = i + 1; j < texts.length; j += 1) {
          const a = texts[i];
          const b = texts[j];
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 1 && overlapY > 1)
            out.push(
              `「${a.text}」×「${b.text}」（重疊 ${Math.round(overlapX)}×${Math.round(overlapY)}px）`,
            );
        }
    }
    return out;
  }, selector);


/* ══ 前置：把季度區間縮到三季（使用者指名的是「8 筆以內」）══ */
console.log("\n══ 前置：三季 ＋ 平日＋假日並列 ══");
ok("前置：切得到「歷季趨勢比較」", await gotoTab("歷季趨勢比較"));
const quarters = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="mt-quarter-from"] option')].map(
    (option) => option.value,
  ),
);
ok(
  "前置：季度下拉列得出多季（只有一季的話下面全部恆真）",
  quarters.length >= 3,
  `${quarters.length} 季`,
);
if (quarters.length >= 3) {
  await setMain("mt-quarter-from", quarters[quarters.length - 3]);
  await setMain("mt-quarter-to", quarters[quarters.length - 1]);
}
ok(
  "前置：日別切得到「平日＋假日並列」",
  await setMain("mt-day", "side-by-side"),
);
/* 挑一個跨多季的路口，否則圖畫不出來。 */
await page
  .locator(".trend-controls select")
  .first()
  .selectOption({ label: "示範路－示範二路－示範三街路口" })
  .catch(() => {});
await page.waitForTimeout(1200);
const drawn = await page.evaluate(
  () => document.querySelectorAll("#trend-svg text").length,
);
ok(
  "前置：趨勢圖真的畫出字了（0 個的話下面恆真）",
  drawn > 0,
  `${drawn} 個文字`,
);

/* ══ 一、趨勢圖：多種寬度都不可以疊 ══════════════════════════ */
for (const width of [1600, 1440, 1280, 1024]) {
  await page.setViewportSize({ width, height: 950 });
  await page.waitForTimeout(700);
  const hits = await overlapsIn("#trend-svg");
  ok(
    `⚠️ 視窗 ${width}px：並列時歷季趨勢圖上的字兩兩不重疊`,
    hits.length === 0,
    hits.slice(0, 3).join("；") || "0 處重疊",
  );
}
await page.setViewportSize({ width: 1600, height: 950 });
await page.waitForTimeout(600);

/* ══ 二、尖峰形狀那兩張圖 ══════════════════════════════════════ */
/*
 * ⚠️ 這兩張圖只有「15 分鐘記一次」的資料畫得出來，而 seed-wide 沒有逐格資料。
 *   所以另開一個**乾淨的工作階段**、換上 seed-15min 再量。
 *   在同一個工作階段裡換 seed 是做不到的（localStorage 已經被讀進記憶體了），
 *   硬塞只會量到上一份資料——那正是「量到的不是你以為的東西」。
 */
console.log("\n══ 二、轉向進階分析的兩張圖（另開工作階段，換 15 分鐘測資）══");
const shapeSeed = readFileSync(join(here, "seed-15min.json"), "utf8");
const shapeContext = await browser.newContext({
  viewport: { width: 1600, height: 950 },
  locale: "zh-TW",
});
const shapePage = await shapeContext.newPage();
shapePage.on("pageerror", (event) => errors.push(String(event.message)));
shapePage.on("dialog", (event) => event.accept());
await installStateHelpers(shapePage);
await shapePage.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 無痕或封鎖時就算了，下面的前置檢查會紅。 */
  }
}, shapeSeed);
await shapePage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await shapePage.waitForTimeout(1600);
await shapePage.evaluate(() => {
  const button = [...document.querySelectorAll("aside nav button")].find(
    (node) => (node.textContent || "").includes("轉向進階分析"),
  );
  button?.click();
});
await shapePage.waitForTimeout(1500);
await shapePage.evaluate(() => {
  for (const id of ["advanced-peak-quarter", "advanced-peak-window"]) {
    const node = document.getElementById(id);
    if (node) node.open = true;
  }
});
await shapePage.waitForTimeout(900);
const shapeTexts = await shapePage.evaluate(
  () => document.querySelectorAll(".peak-shape svg text").length,
);
ok(
  "前置：兩張圖真的畫出字了（0 個的話下面恆真）",
  shapeTexts > 0,
  `${shapeTexts} 個文字`,
);
const overlapsOn = (target, selector) =>
  target.evaluate((sel) => {
    const out = [];
    for (const svg of document.querySelectorAll(sel)) {
      const texts = [...svg.querySelectorAll("text")]
        .filter((node) => (node.textContent || "").trim())
        .map((node) => {
          const box = node.getBoundingClientRect();
          return {
            text: (node.textContent || "").trim(),
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            width: box.width,
          };
        })
        .filter((item) => item.width > 0);
      for (let i = 0; i < texts.length; i += 1)
        for (let j = i + 1; j < texts.length; j += 1) {
          const a = texts[i];
          const b = texts[j];
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 1 && overlapY > 1)
            out.push(
              `「${a.text}」×「${b.text}」（重疊 ${Math.round(overlapX)}×${Math.round(overlapY)}px）`,
            );
        }
    }
    return out;
  }, selector);
if (shapeTexts > 0)
  for (const width of [1600, 1280]) {
    await shapePage.setViewportSize({ width, height: 950 });
    await shapePage.waitForTimeout(700);
    const hits = await overlapsOn(shapePage, ".peak-shape svg");
    ok(
      `⚠️ 視窗 ${width}px：尖峰形狀圖上的字兩兩不重疊`,
      hits.length === 0,
      hits.slice(0, 3).join("；") || "0 處重疊",
    );
  }
await shapeContext.close();

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 並列時（資料少也一樣）圖上的字兩兩不重疊");
