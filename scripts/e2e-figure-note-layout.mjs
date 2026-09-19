/**
 * ══════════════════════════════════════════════════════════════════════
 *  一圖一說明：放得下就左右並排、圖固定；放不下就上下排、圖不固定
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15 定案（三支同步）：
 *   「有些圖和說明文字本來就是左右並排了……那應該一開始就要做成左右並排，
 *     然後圖固定在左邊？這項一定要用肉眼確認，且同步到三份程式」
 *   「連續 60 分鐘流率這一張要嘛補抽稀、要嘛維持整寬不並排……
 *     但也請以可以看到完整數據圖為優先」
 *
 * 這一支守「轉向進階分析」底下那兩張圖（尖峰小時內四格 15 分鐘分布、
 * 連續 60 分鐘流率）改成左右並排之後的版面。
 *
 * ⚠️ 連續 60 分鐘流率**可以**並排，是因為它的橫軸已經有抽稀。
 *   這一支順便驗抽稀還在——兩件事是綁在一起的，抽稀被拿掉的話
 *   並排就會讓橫軸標籤疊成一片。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 *
 * 一、**只驗 CSS 字串不算數。** 這裡量的是 getBoundingClientRect 的實際座標。
 *     而且這一塊真的踩過：container-type 下錯層（下在 .panel-body 自己身上）
 *     時，`position:sticky`（後代）生效、`grid-template-columns`（容器本身）
 *     卻沒生效——**同一個 @container 區塊只有一半會動**。
 *     只驗 sticky 的話那個錯會整個漏掉。所以並排與 sticky **兩件都要驗**。
 * 二、**只驗寬視窗不算數。** 永遠並排的實作在寬視窗會過，窄的時候說明會
 *     被壓成一條。所以寬窄都驗。
 * 三、**前置要先確認圖真的畫得出來**，否則整支恆真。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8293;
/* ⚠️ 一定要用 15 分鐘的 seed：整點記一次的檔拆不出四段，那張圖會直接不畫。 */
const seed = readFileSync(join(here, "seed-15min.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1920, height: 1000 },
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

await page.evaluate(() => {
  const button = [...document.querySelectorAll("nav button")].find(
    (node) => node.textContent.trim() === "轉向進階分析",
  );
  button?.click();
});
await page.waitForTimeout(1500);
/* 兩塊都是 <details>，預設收著；量版面要先展開。 */
await page.evaluate(() => {
  for (const id of ["advanced-peak-quarter", "advanced-peak-window"]) {
    const node = document.getElementById(id);
    if (node) node.open = true;
  }
});
await page.waitForTimeout(900);

const BLOCKS = [
  ["advanced-peak-quarter", "尖峰小時內四格 15 分鐘分布"],
  ["advanced-peak-window", "連續 60 分鐘流率"],
];

const survey = () =>
  page.evaluate(() => {
    const px = (value) => Number.parseFloat(value) || 0;
    const stickyOf = (selector) => {
      const node = document.querySelector(selector);
      return node && getComputedStyle(node).position === "sticky"
        ? node.getBoundingClientRect().height
        : 0;
    };
    const expectedTop = Math.round(
      stickyOf(".topbar") + stickyOf(".main-toolbar") + 12,
    );
    const out = { expectedTop, blocks: {} };
    for (const id of ["advanced-peak-quarter", "advanced-peak-window"]) {
      const body = document.querySelector(`#${id} .panel-body`);
      const figure = body?.querySelector(":scope > .peak-shape-figure");
      const note = body?.querySelector(":scope > .peak-shape-note");
      if (!body || !figure || !note) {
        out.blocks[id] = null;
        continue;
      }
      const f = figure.getBoundingClientRect();
      const n = note.getBoundingClientRect();
      const svg = figure.querySelector("svg");
      /* 橫軸標籤的實際位置——用來確認抽稀還在、沒有疊在一起。 */
      const labels = svg
        ? [...svg.querySelectorAll("text.x-label")].map((node) => {
            const box = node.getBoundingClientRect();
            return { left: box.left, right: box.right };
          })
        : [];
      let overlaps = 0;
      for (let i = 1; i < labels.length; i += 1) {
        if (labels[i].left < labels[i - 1].right - 0.5) overlaps += 1;
      }
      out.blocks[id] = {
        bodyWidth: Math.round(body.getBoundingClientRect().width),
        figureWidth: Math.round(f.width),
        noteWidth: Math.round(n.width),
        sideBySide: n.left >= f.right - 1,
        noteInsideFigure: Boolean(figure.querySelector(".peak-shape-note")),
        figurePosition: getComputedStyle(figure).position,
        figureTop: px(getComputedStyle(figure).top),
        labelCount: labels.length,
        labelOverlaps: overlaps,
      };
    }
    return out;
  });

console.log("\n══ 一、寬視窗（1920px）：左右並排 ＋ 圖固定 ══");
let data = await survey();
for (const [id, label] of BLOCKS) {
  const block = data.blocks[id];
  ok(`前置：${label} 找得到圖與說明（找不到的話下面全部恆真）`, Boolean(block), id);
  if (!block) continue;
  ok(
    `① ${label}：說明是圖的**兄弟**，不是被包在圖裡`,
    !block.noteInsideFigure,
    block.noteInsideFigure ? "說明被包進 .peak-shape-figure 了" : "兄弟關係正確",
  );
  ok(
    `② ${label}：說明真的在圖的右邊`,
    block.sideBySide,
    `面板 ${block.bodyWidth}px、圖 ${block.figureWidth}px、說明 ${block.noteWidth}px`,
  );
  ok(
    `② ${label}：圖是 sticky`,
    block.figurePosition === "sticky",
    block.figurePosition,
  );
  ok(
    `③ ${label}：sticky 的 top ＝ 上方功能列＋主工具列＋留白（不是寫死的數字）`,
    Math.abs(block.figureTop - data.expectedTop) <= 2,
    `實際 ${block.figureTop}px vs 應該 ${data.expectedTop}px`,
  );
}

/*
 * ④ 並排之後圖變窄，橫軸標籤更容易疊。
 * ⚠️ 這一條是「可以並排」的**前提**：連續 60 分鐘流率原本有幾十～上百個
 *   時間點，靠抽稀才印得下。抽稀被拿掉的話這裡會紅，那時要做的是
 *   把抽稀加回來，或把這一塊改回整寬——不是放寬這條守門。
 */
console.log("\n── 並排之後橫軸標籤不可以疊在一起");
for (const [id, label] of BLOCKS) {
  const block = data.blocks[id];
  if (!block) continue;
  ok(
    `前置：${label} 真的印得出橫軸標籤（0 個的話下一條恆真）`,
    block.labelCount > 0,
    `${block.labelCount} 個`,
  );
  ok(
    `④ ${label}：橫軸標籤兩兩不重疊`,
    block.labelOverlaps === 0,
    `${block.labelCount} 個標籤、重疊 ${block.labelOverlaps} 處`,
  );
}

console.log("\n══ 二、窄視窗（1280px）：上下排，而且**不可以**釘住 ══");
/*
 * ⚠️ 上下排時圖若還釘著，往下捲圖會滑到說明上面——圖底下是不透明的面板色，
 *   說明的字會被整片蓋掉。那比不釘住更糟。
 */
await page.setViewportSize({ width: 1280, height: 1000 });
await page.waitForTimeout(800);
data = await survey();
for (const [id, label] of BLOCKS) {
  const block = data.blocks[id];
  if (!block) continue;
  ok(
    `前置：${label} 在窄視窗真的窄了（沒窄的話下面兩條恆真）`,
    block.bodyWidth < 1040,
    `${block.bodyWidth}px`,
  );
  ok(
    `⑤ ${label}：窄的時候不並排（說明在圖的下面）`,
    !block.sideBySide,
    `圖 ${block.figureWidth}px、說明 ${block.noteWidth}px`,
  );
  ok(
    `⑤ ${label}：窄的時候圖**不可以**釘住（會蓋住說明）`,
    block.figurePosition === "static",
    block.figurePosition,
  );
}
await page.setViewportSize({ width: 1920, height: 1000 });
await page.waitForTimeout(600);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log(
  "\n✅ 圖與說明左右並排、圖固定、橫軸不疊；窄的時候自動改上下排且不釘住",
);
