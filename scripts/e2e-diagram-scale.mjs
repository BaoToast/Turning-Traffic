/*
 * ══════════════════════════════════════════════════════════════════════
 *  轉向圖：支線再多，中央路口在畫面上的大小都不變
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：
 *   「路口示意圖的各路口不要分這麼開嗎?看起來不好看，能保持原中間路段
 *     原本的樣子就好，畫布增大只是增加四周空白處，讓各路口轉向流量的
 *     小卡(駛入/駛出)有地方放」
 *
 * 診斷：圖上的幾何**本來就沒有跟著畫布放大**（支線半徑是固定的 205／145／158），
 * 看起來被拉開純粹是 CSS 的 `.diagram-canvas svg{width:100%}` 造成的——
 * 支線一多 viewBox 就變大，整張圖被等比縮小塞進同樣寬的面板，
 * 於是中央路口變小、支線之間的空白變大。
 *
 * 所以這支量的是**畫面上的實際尺寸**，不是 SVG 座標：
 *   ・中央路口方塊（rect.junction，SVG 座標固定 164×164）
 *   ・中心圓點（circle.center-dot，SVG 座標固定 r=31）
 * 四叉與七叉兩張圖上，這兩個東西的 CSS 像素尺寸要**幾乎相同**。
 *
 * ⚠️ 量 SVG 座標是驗不到這件事的——SVG 座標本來就一直相同，
 *   量它會一路綠燈，而使用者看到的問題完全不受影響。
 *   這是「量錯對象的測試比沒有測試更糟」的又一個例子。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages-dist");
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
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const seed = readFileSync(join(here, "seed-state.json"), "utf8");
await new Promise((r) => server.listen(8142, r));
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
await page.goto("http://localhost:8142/");
await page.waitForTimeout(800);
await page.evaluate(async (s) => {
  localStorage.clear();
  await window.__writeState(s);
}, seed);
await page.reload();
await page.waitForTimeout(1400);

await page
  .locator('nav button:has-text("路口轉向圖"), aside button:has-text("路口轉向圖")')
  .first()
  .click();
await page.waitForTimeout(1000);

/** 目前這張圖上，中央那兩個固定大小的元素在畫面上實際多大。 */
const measure = () =>
  page.evaluate(() => {
    const svg = document.querySelector(".diagram-canvas svg");
    const junction = document.querySelector(".diagram-canvas rect.junction");
    const dot = document.querySelector(".diagram-canvas circle.center-dot");
    if (!svg || !junction || !dot) return null;
    const j = junction.getBoundingClientRect();
    const d = dot.getBoundingClientRect();
    return {
      arms: document.querySelectorAll(".diagram-canvas [data-card-id]").length,
      /*
       * ⚠️ 有沒有「看不到的部分」。
       *   使用者 2026-09-12：七岔時整張圖比容器寬，出現橫捲軸，
       *   而且**左側被裁掉捲不到**（置中＋溢出的經典坑）。
       *   預設狀態下這個值必須是 0。
       */
      overflowX: (() => {
        const box = document.querySelector(".diagram-canvas");
        return box ? Math.round(box.scrollWidth - box.clientWidth) : -1;
      })(),
      /* 「放大到原尺寸」那一顆在不在（只有放不下時才該出現）。 */
      hasZoom: Boolean(document.querySelector(".diagram-zoom button")),
      /*
       * ⚠️ 捲到最左邊之後，圖的左緣有沒有真的露出來。
       *
       * 使用者 2026-09-12 回報兩次「左邊被裁切且捲不到」。
       * 只量 scrollWidth−clientWidth 抓不到這個——有捲軸是正常的，
       * 問題在於**捲到底也看不到左邊那一段**（置中把它推到容器起點之外，
       * 而可捲動範圍只往右延伸）。所以要真的把捲軸拉到 0 再量左緣。
       */
      leftGap: (() => {
        const box = document.querySelector(".diagram-canvas");
        const svg = document.querySelector(".diagram-canvas svg");
        if (!box || !svg) return null;
        box.scrollLeft = 0;
        return Math.round(
          svg.getBoundingClientRect().left - box.getBoundingClientRect().left,
        );
      })(),
      viewBox: svg.getAttribute("viewBox"),
      /* 畫面上的 CSS 像素——使用者眼睛看到的就是這個 */
      junctionW: Math.round(j.width * 10) / 10,
      dotW: Math.round(d.width * 10) / 10,
      /* SVG 座標裡它一直是 164×164、r=31；拿來當對照組 */
      svgJunctionW: Number(junction.getAttribute("width")),
      /*
       * ⚠️ 路段條近端到中心的距離（SVG 座標）。
       *
       * 使用者 2026-09-12：「每條路段都離正中間的正方形太遠了…畫布增大是
       * 增加可以放置流量小卡的位置，而不是拉大路段與中間正方形的距離。」
       *
       * 路段條是 <rect y=… height=…> 再繞 (cx,cy) 旋轉，所以旋轉前的
       * 「cy − (y+height)」就是近端到中心的距離，量這個不必管旋轉角度。
       * 舊版把 y 寫成畫布的絕對座標 85，於是這個距離＝cy−385，
       * 跟著畫布一起長：四叉 45px、七叉 179px。
       */
      roadGap: (() => {
        const rect = document.querySelector(".diagram-canvas rect.road");
        const svgEl = document.querySelector(".diagram-canvas svg");
        if (!rect || !svgEl) return null;
        const box = svgEl.getAttribute("viewBox").split(/\s+/).map(Number);
        const cy = box[3] / 2;
        /* cy 不是 viewBox 中點——用中央圓點的 cy 才準。 */
        const dot = document.querySelector(".diagram-canvas circle.center-dot");
        const centerY = dot ? Number(dot.getAttribute("cy")) : cy;
        const y = Number(rect.getAttribute("y"));
        const h = Number(rect.getAttribute("height"));
        return Math.round(centerY - (y + h));
      })(),
    };
  });

/*
 * 切到指定名稱的那一筆路口。
 *
 * ⚠️ 七叉那一筆在 115Q2，所以要先把季度切過去——
 *   第一版沒切，兩次量到的都是同一張四叉圖（viewBox 一樣），
 *   而底下「大小不變」那兩條照樣全綠。前置條件那一條就是為了擋這個。
 */
async function pickRecord(name) {
  await page
    .locator('label:has-text("資料季度") select')
    .first()
    .selectOption({ label: "115Q2（2 路口）" })
    .catch(() => {});
  await page.waitForTimeout(700);
  /*
   * ⚠️ 不可以用 `label:has-text("路口") select`：
   *   「資料季度」那個標籤的文字是「資料季度115Q1（1 路口）115Q2（2 路口）」，
   *   裡面也含「路口」兩個字，.first() 會抓到季度下拉而不是路口下拉。
   *   直接用「哪個下拉裡有這個選項」來認，最不會認錯。
   */
  await page
    .locator(`select:has(option:text-is("${name}"))`)
    .first()
    .selectOption({ label: name });
  await page.waitForTimeout(1000);
}

const shots = [];
for (const name of ["示範1－示範一路口", "示範1－示範交流道路口"]) {
  await pickRecord(name);
  const m = await measure();
  ok(
    `量得到「${name}」的圖`,
    Boolean(m),
    m ? `${m.arms} 支線・viewBox ${m.viewBox}` : "找不到圖",
  );
  if (m) shots.push(m);
}
ok(
  "前置：量到了不只一種支線數的圖（否則下面的比較沒有意義）",
  new Set(shots.map((s) => s.viewBox)).size >= 2,
  shots.map((s) => `${s.viewBox}／畫面 ${s.junctionW}px`).join("｜"),
);

ok(
  "對照組：SVG 座標裡的路口方塊本來就一直是 164（量這個抓不到問題）",
  shots.every((s) => s.svgJunctionW === 164),
  shots.map((s) => s.svgJunctionW).join("、"),
);

if (shots.length >= 2) {
  /*
   * ══════════════════════════════════════════════════════════════════
   *  預設：整張圖都看得到，不必捲動
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-12（附截圖）：七岔時出現橫捲軸，而且**左側被裁掉**
   * ——「請讓路口轉向圖分頁中的圖案，不要依靠捲動，直接能在畫面一眼
   * 看到成果，避免使用者以為被裁切到了」。
   *
   * ⚠️ 這和他 9/11 指定的「中央路口方塊不要因為支線變多而縮小」
   *   直接衝突，兩者在目前的容器寬度下不可能同時成立。他選的是：
   *   預設整張看得到，另外給一顆放大鈕，而且**平常放得下時不要出現**。
   */
  for (const shot of shots)
    ok(
      `⚠️ 預設狀態下「${shot.viewBox}」整張圖都看得到（沒有橫向捲動）`,
      shot.overflowX === 0,
      `溢出 ${shot.overflowX}px`,
    );
  const narrow = shots.find((s) => s.viewBox === "0 0 1200 900");
  const wide = shots.find((s) => s.viewBox === "0 0 1620 1080");
  if (narrow)
    ok(
      "⚠️ 放得下的路口**不要**出現「放大到原尺寸」（按了沒差別的按鈕比沒有更糟）",
      narrow.hasZoom === false,
      narrow.hasZoom ? "四叉也出現了放大鈕" : "沒有出現",
    );
  if (wide)
    ok(
      "放不下的路口才出現「放大到原尺寸」",
      wide.hasZoom === true,
      wide.hasZoom ? "有出現" : "七叉也沒有放大鈕，等於沒得選",
    );

  /*
   * ══════════════════════════════════════════════════════════════════
   *  按下放大：中央路口方塊回到「和十字路口一樣大」
   * ══════════════════════════════════════════════════════════════════
   *
   * 這是 9/11 那一項要求，現在改成由放大鈕提供。
   * ⚠️ 這一段一定要在：少了它，「預設不捲動」可以靠**永遠縮小**達成，
   *   而那等於把 9/11 的修正整個丟掉，測試卻全綠。
   */
  console.log("\n══ 按下「放大到原尺寸」之後 ══");
  const zoomed = [];
  for (const name of ["示範1－示範一路口", "示範1－示範交流道路口"]) {
    await pickRecord(name);
    const button = page.locator(".diagram-zoom button").first();
    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(700);
    }
    const m = await measure();
    if (m) zoomed.push(m);
    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(400);
    }
  }
  const widths = zoomed.map((s) => s.junctionW);
  const spread = Math.max(...widths) - Math.min(...widths);
  ok(
    "⚠️ 放大之後，中央路口方塊在畫面上的大小不隨支線數改變（四叉與七叉一樣大）",
    zoomed.length >= 2 && spread <= 2,
    zoomed
      .map((s) => `viewBox ${s.viewBox} → ${s.junctionW}px`)
      .join("｜") + `，最大差 ${Math.round(spread * 10) / 10}px`,
  );
  /*
   * ⚠️ 放大之後一定會有捲軸（那是放大的本意），但**捲到最左邊要看得到左緣**。
   *   leftGap < 0 代表圖的左邊被推到容器外面，永遠捲不到——
   *   使用者看到的是「左邊被裁掉」，而下載的 PNG 卻是完整的，
   *   所以他會以為是圖壞了。
   */
  for (const shot of zoomed)
    ok(
      `⚠️ 放大之後「${shot.viewBox}」捲到最左邊看得到圖的左緣（不是被推到容器外）`,
      shot.leftGap !== null && shot.leftGap >= 0,
      `左緣距容器左邊 ${shot.leftGap}px（負數＝捲不到）`,
    );
  const dots = zoomed.map((s) => s.dotW);
  ok(
    "放大之後中心圓點同樣不隨支線數縮小",
    zoomed.length >= 2 && Math.max(...dots) - Math.min(...dots) <= 2,
    zoomed.map((s) => `${s.dotW}px`).join("、"),
  );
  /*
   * ⚠️ 這一條量的是 SVG 座標，與上面兩條刻意不同。
   *   上面兩條問的是「畫面上看起來一樣大嗎」，這一條問的是
   *   「圖本身的幾何有沒有被畫布撐開」——兩件不同的事，
   *   而使用者兩件都遇到了（先是整張圖被縮小，再來是路段被推遠）。
   */
  const gaps = shots.map((s) => s.roadGap).filter((g) => g !== null);
  ok(
    "前置：量得到路段條與中心的距離",
    gaps.length === shots.length,
    shots.map((s) => `${s.roadGap}`).join("、"),
  );
  ok(
    "⚠️ 路段條與中央路口方塊的距離不隨支線數改變",
    gaps.length > 1 && Math.max(...gaps) - Math.min(...gaps) <= 1,
    shots
      .map((s) => `viewBox ${s.viewBox} → 近端距中心 ${s.roadGap}`)
      .join("｜"),
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 轉向圖顯示比例合格：支線再多，中央路口看起來一樣大");
