/**
 * ══════════════════════════════════════════════════════════════════════
 *  吸頂的東西不可以互相蓋住——而且要跟著主工具列的實際高度走
 * ══════════════════════════════════════════════════════════════════════
 *
 * 這一支守的是 2026-09-15 查到的**既有缺陷**（與另外兩支同一個坑）：
 *
 *   ・`.main-toolbar` 與 `.topbar` **兩層都寫 `top: 0`**。主工具列的
 *     z-index 是 30、上方功能列是 10，所以工具列會**直接蓋住**功能列。
 *
 *   ・`.trend-layout > .trend-chart`（歷季趨勢圖）寫死 `top: 12px`、
 *     `.geometry-turn-preview`（轉向預覽圖）寫死 `top: 12px`、
 *     `.issue-detail`（品質總覽右欄）寫死 `top: 88px`。
 *     這三個數字都是**主工具列還沒加進來之前**算的，所以捲動時上緣
 *     會被工具列切掉——就是使用者回報過的「圖標題和單位就消失在畫面了」。
 *
 *   ・`.content [id]` 的 `scroll-margin-top` 只扣了上方功能列，
 *     沒扣主工具列，所以側欄跳轉的落點會被工具列遮住標題。
 *
 * ── 為什麼不能改寫死一個新數字 ──────────────────────────────────
 *
 * 主工具列的高度**會變**：可以收合、窄視窗時欄位換行會長高、
 * 「回歸全部（N 張）」那一顆有時候在有時候不在。
 * 寫死的話：收合時留一大段空白、展開時又被切掉——兩種都錯。
 * 所以改成由 app/main-toolbar.tsx 量實際高度寫進 `--main-toolbar-h`，
 * 吸頂的東西一律用 `--sticky-top`。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 *
 * 一、**只驗 CSS 字串是 `var(--sticky-top)` 不算數。** 變數可能沒被寫、
 *     可能寫錯值、可能被更具體的規則蓋過。這裡**真的捲動**，再量座標。
 * 二、**只驗「圖的 top ≥ 0」不算數。** 被工具列蓋住時 top 仍然是正的
 *    （它只是躲在工具列後面）。要比的是**工具列的下緣**。
 * 三、**前置要先確認圖真的黏住了。** 沒有 sticky 的元素捲走之後 top 會變成
 *     負的，那時「top ≥ 工具列下緣」自然不成立——但紅的原因不是被蓋住。
 * 四、**要驗收合與展開兩種狀態。** 只驗一種的話，一個寫死數字的實作
 *     在那一種狀態下剛好會過。
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
const PORT = 8291;
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
    viewport: { width: 1600, height: 900 },
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

/*
 * ⚠️ 先切到歷季趨勢比較再開始量。
 *   剛載入停在匯入頁，那一頁短到**捲不動**（scrollY 永遠是 0），
 *   而 sticky 的 top 要等到「捲到它要黏住」的時候才看得出來——
 *   在捲不動的頁面上量，等於量了一條恆真的假檢查。
 */
await page.locator('nav button:has-text("歷季趨勢比較")').first().click();
await page.waitForTimeout(1500);
/* 選一個有多季資料的路口，否則圖畫不出來，下面全部變成恆真。 */
await page
  .locator(".trend-controls select")
  .first()
  .selectOption({ label: "示範路－示範二路－示範三街路口" })
  .catch(() => {});
await page.waitForTimeout(900);

/* ══ 一、--main-toolbar-h 要等於主工具列的實際高度 ══════════════ */
console.log("\n══ 一、CSS 變數要跟著實際高度走 ══");

const measure = () =>
  page.evaluate(() => {
    const bar = document.querySelector(".main-toolbar");
    const topbar = document.querySelector(".topbar");
    const root = getComputedStyle(document.documentElement);
    const box = bar?.getBoundingClientRect();
    return {
      varPx: Number.parseFloat(root.getPropertyValue("--main-toolbar-h")) || 0,
      height: Math.round(box?.height ?? -1),
      top: Math.round(box?.top ?? -1),
      bottom: Math.round(box?.bottom ?? -1),
      open: bar?.dataset.open,
      topbarBottom: Math.round(topbar?.getBoundingClientRect().bottom ?? -1),
    };
  });

const opened = await measure();
ok(
  "前置：主工具列真的畫得出來（高度 > 0，量不到的話下面全部恆真）",
  opened.height > 20,
  `高度 ${opened.height}px`,
);
ok(
  "① 展開時 --main-toolbar-h ＝ 實際高度",
  Math.abs(opened.varPx - opened.height) <= 1,
  `變數 ${opened.varPx}px vs 實際 ${opened.height}px`,
);
/*
 * ⚠️ 這一條**一定要先捲動再量**，不可以在頁首量。
 *   在頁首時主工具列還在它的自然位置（就在功能列底下），無論 top 寫 0
 *   還是寫 var(--topbar-h) 量起來都一樣——那是一條恆真的假檢查。
 *   sticky 的 top 要等到「捲到它要黏住」的時候才看得出來。
 *   我第一版就是寫在頁首量的，還原成舊版 CSS 去試才發現它照樣綠。
 */
await page.evaluate(() => globalThis.scrollBy(0, 400));
await page.waitForTimeout(400);
const stuck = await measure();
ok(
  "前置：真的捲到主工具列黏住了（沒捲的話下一條恆真）",
  await page.evaluate(() => globalThis.scrollY > 200),
  `scrollY=${await page.evaluate(() => Math.round(globalThis.scrollY))}`,
);
ok(
  "① 黏住之後，主工具列停在上方功能列**底下**，不是疊在它上面",
  Math.abs(stuck.top - stuck.topbarBottom) <= 1,
  `工具列上緣 ${stuck.top}px、功能列下緣 ${stuck.topbarBottom}px`,
);
await page.evaluate(() => globalThis.scrollTo(0, 0));
await page.waitForTimeout(400);

const toggle = async () => {
  await page.evaluate(() =>
    document.querySelector('[data-testid="mt-toggle"]')?.click(),
  );
  await page.waitForTimeout(500);
};

await toggle();
const collapsed = await measure();
ok(
  "② 收合之後高度真的變矮了（沒變的話收合鈕是壞的，下一條會假綠）",
  collapsed.height > 0 && collapsed.height < opened.height - 10,
  `展開 ${opened.height}px → 收合 ${collapsed.height}px`,
);
ok(
  "② 收合時 --main-toolbar-h 也跟著變",
  Math.abs(collapsed.varPx - collapsed.height) <= 1,
  `變數 ${collapsed.varPx}px vs 實際 ${collapsed.height}px`,
);
await toggle();

/* 視窗變窄 → 欄位換行 → 高度變高，變數也要跟著。 */
await page.setViewportSize({ width: 1000, height: 900 });
await page.waitForTimeout(800);
const narrow = await measure();
ok(
  "③ 視窗變窄（欄位換行）之後，變數仍等於實際高度",
  Math.abs(narrow.varPx - narrow.height) <= 1,
  `變數 ${narrow.varPx}px vs 實際 ${narrow.height}px（寬 1000px）`,
);
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForTimeout(800);

/* ══ 二、真的捲動，吸頂的圖不可以被工具列蓋住 ══════════════════ */
console.log("\n══ 二、捲動之後吸頂的東西仍然完整看得到 ══");

/**
 * 捲到「這一列還沒結束」的位置，再回報吸頂元素與工具列的實際座標。
 *
 * ⚠️ 捲的距離要**依這一列還剩多少可以黏**來算，不可以寫死。
 *   捲過頭的話整列都出去了，圖當然不在畫面上——那不是缺陷。
 */
const probe = async (label) => {
  await page.evaluate(() => {
    const row = document.querySelector(".trend-layout");
    const figure = row?.querySelector(".trend-chart");
    if (!row || !figure) return;
    row.scrollIntoView({ block: "start" });
    /*
     * ⚠️ 捲的距離**不可以**直接用「這一列比圖長多少」的一半。
     *   sticky 能黏的範圍是「這一列比圖長的部分」再**扣掉 top 這個位移**：
     *   捲過頭的話，圖會被這一列的下緣推上去（sticky 不能跑出包含區塊），
     *   量到的上緣就比 top 小——那會被誤判成「被工具列切掉」。
     */
    const room =
      row.getBoundingClientRect().height -
      figure.getBoundingClientRect().height;
    const offset = Number.parseFloat(getComputedStyle(figure).top) || 0;
    /*
     * ⚠️ scrollIntoView 之後這一塊的上緣已經在視窗 0，元素早就進入
     *   sticky 的區間了，所以**不要再把 offset 加回去**——加回去就會
     *   捲過頭，被下緣推上來。可捲的上限就是 usable 本身，取一半最穩。
     */
    const usable = room - offset;
    globalThis.scrollBy(0, Math.max(0, Math.round(usable / 2)));
  });
  await page.waitForTimeout(600);
  const result = await page.evaluate(() => {
    const figure = document.querySelector(".trend-layout > .trend-chart");
    const bar = document.querySelector(".main-toolbar");
    if (!figure || !bar) return null;
    const f = figure.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const row = figure.closest(".trend-layout");
    return {
      stickyRoom: Math.round(
        (row?.getBoundingClientRect().height ?? 0) - f.height,
      ),
      /* 真正能黏的範圍＝這一列比圖長的部分再扣掉 top 位移。 */
      usable: Math.round(
        (row?.getBoundingClientRect().height ?? 0) -
          f.height -
          (Number.parseFloat(getComputedStyle(figure).top) || 0),
      ),
      figureTop: Math.round(f.top),
      figureBottom: Math.round(f.bottom),
      barBottom: Math.round(b.bottom),
      viewport: globalThis.innerHeight,
      sticky: getComputedStyle(figure).position,
      scrollY: Math.round(globalThis.scrollY),
    };
  });
  if (result) console.log(`   ${label}：`, JSON.stringify(result));
  return result;
};

const scrolled = await probe("展開狀態");
ok(
  "前置：歷季趨勢圖找得到，而且真的設成 sticky",
  Boolean(scrolled) && scrolled.sticky === "sticky",
  scrolled ? `position: ${scrolled.sticky}` : "找不到圖",
);
ok(
  "前置：真的捲動了（沒捲的話下面幾條驗不到吸頂行為）",
  Boolean(scrolled) && scrolled.scrollY > 100,
  scrolled ? `scrollY=${scrolled.scrollY}` : "",
);
ok(
  "前置：扣掉 top 位移之後仍然有「可以黏」的範圍——沒有的話 sticky 本來就不會生效",
  Boolean(scrolled) && scrolled.usable > 150,
  scrolled
    ? `說明比圖長 ${scrolled.stickyRoom}px、扣掉位移後可黏 ${scrolled.usable}px`
    : "",
);
ok(
  "前置：捲動之後圖還在畫面上（沒黏住的話會被捲出去，那時下一條紅的原因是別的事）",
  Boolean(scrolled) &&
    scrolled.figureBottom > 0 &&
    scrolled.figureTop < scrolled.viewport,
  scrolled ? `top=${scrolled.figureTop}、bottom=${scrolled.figureBottom}` : "",
);
ok(
  "⚠️ 捲動時圖的上緣在主工具列**下面**（不可以被它切掉）",
  Boolean(scrolled) && scrolled.figureTop >= scrolled.barBottom - 1,
  scrolled
    ? `圖上緣 ${scrolled.figureTop}px、工具列下緣 ${scrolled.barBottom}px（差 ${
        scrolled.figureTop - scrolled.barBottom
      }px）`
    : "",
);

/* 收合狀態也要對：寫死數字的實作在這一種狀態會留一大段空白或被切掉。 */
await toggle();
const scrolledCollapsed = await probe("收合狀態");
ok(
  "⚠️ 收合之後圖的上緣同樣在工具列下面，而且不會留一大段空白",
  Boolean(scrolledCollapsed) &&
    scrolledCollapsed.figureTop >= scrolledCollapsed.barBottom - 1 &&
    scrolledCollapsed.figureTop - scrolledCollapsed.barBottom <= 24,
  scrolledCollapsed
    ? `圖上緣 ${scrolledCollapsed.figureTop}px、工具列下緣 ${scrolledCollapsed.barBottom}px（差 ${
        scrolledCollapsed.figureTop - scrolledCollapsed.barBottom
      }px，要在 0～24 之間）`
    : "",
);
ok(
  "⚠️ 收合與展開兩種狀態下的間距差不多（寫死數字的話會差一整條工具列的高度）",
  Boolean(scrolled) &&
    Boolean(scrolledCollapsed) &&
    Math.abs(
      scrolled.figureTop -
        scrolled.barBottom -
        (scrolledCollapsed.figureTop - scrolledCollapsed.barBottom),
    ) <= 4,
  scrolled && scrolledCollapsed
    ? `展開差 ${scrolled.figureTop - scrolled.barBottom}px、收合差 ${
        scrolledCollapsed.figureTop - scrolledCollapsed.barBottom
      }px`
    : "",
);
await toggle();

/* ══ 三、側欄跳轉的落點也要讓開工具列 ══════════════════════════ */
console.log("\n══ 三、側欄跳轉之後標題不可以被工具列遮住 ══");
/*
 * ⚠️ 這一條不是版面潔癖：使用者 2026-09-11 回報過
 *   「全部跳轉畫面都是把標題遮住，看不出我已經跳轉到什麼畫面」。
 *   當時修好了（扣掉上方功能列），主工具列加進來之後又壞了一次。
 */
const jump = await page.evaluate(() => {
  const target = document.querySelector(".content [id]");
  if (!target) return null;
  target.scrollIntoView({ block: "start", behavior: "auto" });
  const bar = document.querySelector(".main-toolbar");
  return {
    id: target.id,
    top: Math.round(target.getBoundingClientRect().top),
    barBottom: Math.round(bar?.getBoundingClientRect().bottom ?? -1),
    margin: getComputedStyle(target).scrollMarginTop,
  };
});
await page.waitForTimeout(400);
ok(
  "前置：找得到跳轉目標（找不到的話下一條恆真）",
  Boolean(jump),
  jump ? `#${jump.id}，scroll-margin-top: ${jump.margin}` : "找不到",
);
ok(
  "⚠️ 跳轉落點的上緣在主工具列下面（不是躲在它後面）",
  Boolean(jump) && jump.top >= jump.barBottom - 1,
  jump ? `目標上緣 ${jump.top}px、工具列下緣 ${jump.barBottom}px` : "",
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 吸頂高度跟著主工具列走，捲動與跳轉時都不會被切掉");
