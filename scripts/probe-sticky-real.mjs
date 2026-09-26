/*
 * 探針（不是守門）：使用者回報「圖保持可見時常失效」。
 *
 * 目的：在**多種真實螢幕尺寸**下，逐一問三張圖
 *   ① 版面是不是並排（說明在圖的右邊）
 *   ② 圖有沒有真的釘住（computed position）
 *   ③ **把說明捲到底之後，圖還在不在畫面上**  ← 這才是使用者感受到的那件事
 *
 * ⚠️ ③ 才是重點。只驗 ① ② 的話，「規則有生效但圖還是被捲掉」驗不出來。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8411;
const seed = readFileSync(join(here, "seed-15min.json"), "utf8");

/*
 * 真實螢幕 × Windows 顯示縮放之後的 CSS 像素。
 * 使用者的機器是 Windows；1080p 筆電與多數外接螢幕出廠預設是 125%。
 */
const SIZES = [
  { w: 1521, h: 703, why: "使用者實測回報的可視大小" },
  { w: 1521, h: 900, why: "同寬但比較高（分開寬度與高度兩個變因）" },
  { w: 1920, h: 1080, why: "對照組" },
];

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: SIZES[0].w, height: SIZES[0].h },
  locale: "zh-TW",
});
const page = await ctx.newPage();
page.on("dialog", (event) => event.accept());
await installStateHelpers(page);
await page.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 無痕時算了 */
  }
}, seed);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);

/**
 * 量一張圖：並排嗎、釘住嗎、把說明捲到底之後圖還在不在畫面上。
 *
 * ⚠️ 「還在不在畫面上」用的是 getBoundingClientRect 與視窗高度比對，
 *   不是看 CSS——CSS 說 sticky 不代表它真的黏得住（包含區塊太矮、
 *   align-items 被 stretch、祖先有 overflow 都會讓它失效）。
 */
async function measure(figureSel, noteSel, containerSel) {
  return page.evaluate(
    ([fig, note, box]) => {
      const figure = document.querySelector(fig);
      const noteEl = document.querySelector(note);
      const container = box ? document.querySelector(box) : null;
      if (!figure || !noteEl) return null;
      const f0 = figure.getBoundingClientRect();
      const n0 = noteEl.getBoundingClientRect();
      /* 並排＝說明的左緣在圖的右緣之後（允許 2px 誤差）。 */
      const sideBySide = n0.left >= f0.right - 2;
      const pos = getComputedStyle(figure).position;
      const containerW = container
        ? Math.round(container.getBoundingClientRect().width)
        : null;
      let clipper = "";
      for (let node = figure.parentElement; node && node !== document.body; node = node.parentElement) {
        const cs = getComputedStyle(node);
        if (["auto","scroll","hidden","clip"].includes(cs.overflowY) || ["auto","scroll","hidden","clip"].includes(cs.overflowX)) {
          clipper = (String(node.className||node.tagName)).slice(0,28) + "(" + cs.overflowX + "/" + cs.overflowY + ")";
          break;
        }
      }
      const topRaw = getComputedStyle(figure).top;
      return {
        sideBySide,
        position: pos,
        containerW,
        stickyTop: topRaw,
        figureH: Math.round(f0.height),
        avail: Math.round(window.innerHeight - (parseFloat(topRaw) || 0)),
        clipper,
        figureTop: Math.round(f0.top),
        figureBottom: Math.round(f0.bottom),
        noteBottom: Math.round(n0.bottom),
        noteHeight: Math.round(n0.height),
      };
    },
    [figureSel, noteSel, containerSel],
  );
}

/** 把說明捲到底，再問圖還剩多少在畫面內。 */
async function scrollAndCheck(figureSel, noteSel) {
  return page.evaluate(
    ([fig, note]) => {
      const figure = document.querySelector(fig);
      const noteEl = document.querySelector(note);
      if (!figure || !noteEl) return null;
      /*
       * ⚠️ 先回到頁首再量。
       *   上一個尺寸量完時頁面是捲到底的，直接量會拿到「已經捲過」的狀態，
       *   於是每一列都說「不用捲」——那是另一種假的綠，而且很難看出來。
       */
      window.scrollTo(0, 0);
      const needScroll =
        noteEl.getBoundingClientRect().bottom > window.innerHeight;
      noteEl.scrollIntoView({ block: "end" });
      return new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const r = figure.getBoundingClientRect();
            const vh = window.innerHeight;
            const visible = Math.max(
              0,
              Math.min(r.bottom, vh) - Math.max(r.top, 0),
            );
            resolve({
              needScroll,
              visiblePx: Math.round(visible),
              ratio: r.height ? Math.round((visible / r.height) * 100) : 0,
              top: Math.round(r.top),
              height: Math.round(r.height),
            });
          }),
        ),
      );
    },
    [figureSel, noteSel],
  );
}

const TARGETS = [
  {
    name: "尖峰小時內四格 15 分鐘分布",
    nav: "轉向進階分析",
    open: ["advanced-peak-quarter", "advanced-peak-window"],
    figure: "#advanced-peak-quarter .panel-body > .peak-shape-figure",
    note: "#advanced-peak-quarter .panel-body > .peak-shape-note",
    container: "#advanced-peak-quarter",
  },
  {
    name: "連續 60 分鐘流率（依時間）",
    nav: "轉向進階分析",
    open: ["advanced-peak-quarter", "advanced-peak-window"],
    figure: "#advanced-peak-window .panel-body > .peak-shape-figure",
    note: "#advanced-peak-window .panel-body > .peak-shape-note",
    container: "#advanced-peak-window",
  },
  {
    name: "歷季趨勢比較圖",
    nav: "歷季趨勢",
    open: [],
    figure: ".trend-layout > .trend-chart",
    note: ".trend-layout > #trendScript",
    container: ".trend-layout",
  },
];

for (const target of TARGETS) {
  console.log(`\n══════ ${target.name} ══════`);
  console.log(
    "視窗           版面      CSS position   說明捲到底之後圖還看得到",
  );
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.w, height: size.h });
    await page.waitForTimeout(500);
    await page.evaluate((label) => {
      const button = [...document.querySelectorAll("nav button")].find((node) =>
        node.textContent.trim().includes(label),
      );
      button?.click();
    }, target.nav);
    await page.waitForTimeout(1100);
    if (target.open.length)
      await page.evaluate((ids) => {
        for (const id of ids) {
          const node = document.getElementById(id);
          if (node) node.open = true;
        }
      }, target.open);
    await page.waitForTimeout(700);
    const m = await measure(target.figure, target.note, target.container);
    if (!m) {
      console.log(
        `${String(size.w).padEnd(5)}×${String(size.h).padEnd(5)}  找不到這張圖（可能這個尺寸下沒畫出來）`,
      );
      continue;
    }
    const after = await scrollAndCheck(target.figure, target.note);
    const layout = m.sideBySide ? "並排" : "上下排";
    const verdict = !after
      ? "量不到"
      : !after.needScroll
        ? "－ 說明沒長到要捲（這個尺寸驗不出來）"
        : after.ratio >= 60
          ? `✅ 看得到 ${after.ratio}%`
          : after.ratio > 0
            ? `⚠️ 只剩 ${after.ratio}%`
            : "❌ 完全看不到";
    console.log(
      `${String(size.w).padEnd(5)}×${String(size.h).padEnd(5)}  ` +
        `${layout.padEnd(8)}  ${String(m.position).padEnd(12)}  ${verdict}` +
        `　（${size.why}；塊寬 ${m.containerW}px、說明高 ${m.noteHeight}px、圖高 ${m.figureH}px、top=${m.stickyTop}、可用高 ${m.avail}px` +
        (m.clipper ? `、⚠️祖先裁切 ${m.clipper}` : "") + `）`,
    );
  }
}

await browser.close();
await server.close();
