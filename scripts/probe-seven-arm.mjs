/*
 * ══════════════════════════════════════════════════════════════════════
 *  用使用者提供的**真實七叉檔**重現「右上角小卡被切掉」
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 這一支**不是**交付包的一部分，也不可以進 npm run e2e：
 *   它吃的是 realdata/ 底下的真實調查檔，那些檔案永遠留在測試環境。
 *   進不了自動化鏈的原因就是這個——不是因為它不重要。
 *
 * 2026-09-12 我用樣本檔（七叉 ＋ 加長的支線名）重現不出使用者回報的症狀，
 * 因為樣本的圖卡位置是依畫布比例排的，畫布縮小時卡片跟著縮。
 * 2026-09-13 使用者提供了真實檔（站名「中山北路/岡山路口(七叉路口)」）。
 *
 * 量法：把每一個畫出來的東西的邊界換算到**根 SVG 座標系**（getBBox 回的是
 * 元素自己的座標系，圖卡都包在 translate 過的 <g> 裡，不換算就會量到
 * 「右緣 17」這種假數字），再和 viewBox 比。另外整張截圖存檔用肉眼看。
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(
  here,
  "..",
  "..",
  "realdata",
  "11017T15-01-中山北路-岡山路口七叉路口.xlsx",
);
const shotDir = join(here, "..", ".probe-shots");
mkdirSync(shotDir, { recursive: true });

const server = await serve(8166);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:8166/");
await page.waitForTimeout(1500);

const go = async (label) => {
  await page
    .locator(`nav button:has-text("${label}"), aside button:has-text("${label}")`)
    .first()
    .click();
  await page.waitForTimeout(800);
};

await go("建立與管理計畫");
await page.locator(".project-form input").first().fill("PROBE7");
await page.locator(".project-form input").nth(1).fill("七叉重現");
await page.locator('.project-form button:has-text("建立計畫")').first().click();
await page.waitForTimeout(900);

await go("季度批次匯入");
await page.locator(".import-period input").first().fill("115");
await page.locator(".import-period select").first().selectOption("2");
await page.waitForTimeout(400);
await page.locator(".upload-card").first().evaluate((card, base64) => {
  const transfer = new DataTransfer();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  transfer.items.add(
    new File([bytes], "11017T15-01-七叉路口.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  card.dispatchEvent(
    new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
  );
}, readFileSync(FILE).toString("base64"));
await page.waitForTimeout(7000);
const commit = page.locator('button:has-text("確認寫入")');
if (await commit.count()) {
  await commit.first().click();
  await page.waitForTimeout(5000);
}

await go("路口轉向圖");
await page.waitForTimeout(1500);

/** 有幾種樣式／顯示模式就各量一次——症狀可能只在其中一種出現。 */
const styles = await page.evaluate(() =>
  [...document.querySelectorAll("button")]
    .map((b) => (b.textContent || "").trim())
    .filter((t) => ["精簡", "標準", "正式"].includes(t)),
);
console.log("   可選樣式：", styles.join("、") || "（找不到樣式切換）");

async function measure(tag) {
  const data = await page.evaluate(() => {
    const svg = document.querySelector(".diagram-canvas svg");
    if (!svg) return null;
    const box = svg.viewBox.baseVal;
    const rootInverse = svg.getScreenCTM()?.inverse();
    if (!rootInverse) return null;
    const out = [];
    for (const el of svg.querySelectorAll(
      "rect.flow-card, text, path.movement-path, rect.junction, rect.road-label-bg",
    )) {
      let b;
      try {
        b = el.getBBox();
      } catch {
        continue;
      }
      if (!b.width && !b.height) continue;
      const ctm = el.getScreenCTM();
      if (!ctm) continue;
      const toRoot = rootInverse.multiply(ctm);
      const xs = [];
      const ys = [];
      for (const [px, py] of [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x, b.y + b.height],
        [b.x + b.width, b.y + b.height],
      ]) {
        const point = svg.createSVGPoint();
        point.x = px;
        point.y = py;
        const moved = point.matrixTransform(toRoot);
        xs.push(moved.x);
        ys.push(moved.y);
      }
      out.push({
        cls: el.getAttribute("class") || el.tagName,
        text: (el.textContent || "").slice(0, 20),
        left: Math.round(Math.min(...xs)),
        top: Math.round(Math.min(...ys)),
        right: Math.round(Math.max(...xs)),
        bottom: Math.round(Math.max(...ys)),
      });
    }
    return {
      view: { width: box.width, height: box.height },
      items: out,
      cards: svg.querySelectorAll("rect.flow-card").length,
      title: svg.querySelector("text.title")?.textContent || "",
    };
  });
  if (!data) {
    console.log(`❌ ${tag}：找不到轉向圖`);
    return;
  }
  const outside = data.items.filter(
    (i) =>
      i.left < -0.5 ||
      i.top < -0.5 ||
      i.right > data.view.width + 0.5 ||
      i.bottom > data.view.height + 0.5,
  );
  console.log(
    `\n── ${tag} ── viewBox ${data.view.width}×${data.view.height}、圖卡 ${data.cards} 張、量了 ${data.items.length} 個元素`,
  );
  console.log("   標題：", data.title.slice(0, 40));
  if (!outside.length) console.log("   ✅ 沒有任何東西超出 viewBox");
  else {
    console.log(`   ❌ 有 ${outside.length} 個元素超出 viewBox：`);
    for (const i of outside.slice(0, 12))
      console.log(
        `      ${i.cls}「${i.text}」 左${i.left} 上${i.top} 右${i.right} 下${i.bottom}`,
      );
  }
  const file = join(shotDir, `seven-${tag}.png`);
  await page.locator(".diagram-canvas").first().screenshot({ path: file });
  console.log("   截圖：", file);
}

await measure("預設");
for (const style of styles) {
  await page.locator(`button:has-text("${style}")`).first().click();
  await page.waitForTimeout(900);
  await measure(style);
}

/*
 * ── 螢幕寬度掃一遍 ─────────────────────────────────────────────
 *
 * ⚠️ 使用者說的是「**螢幕上**右上角的小卡被切掉右半邊」。
 *   SVG 內部沒有東西超出 viewBox（上面量過了），所以如果真的看得到被切，
 *   那就不是 viewBox 的問題，而是**容器把 SVG 裁掉**——那要看實際的
 *   瀏覽器寬度。我先前一律用 1680px 量，等於只測了一種螢幕。
 *
 * 量兩件事：
 *   ① SVG 畫出來的右緣有沒有超出 .diagram-canvas 的可視右緣
 *   ② 容器是不是 overflow:hidden（是的話捲也捲不到，就是真的看不到）
 * 並且存**整個視窗**的截圖（不是元素截圖——元素截圖會自己捲動，
 * 反而把「看不到」的部分拍進來，那就量不到使用者看到的畫面了）。
 */
for (const width of [1920, 1680, 1536, 1440, 1366, 1280]) {
  await page.setViewportSize({ width, height: 950 });
  /*
   * ⚠️ 每次都先捲回最上面。前面量 viewBox 時用的是元素截圖，Playwright
   *   會自己把元素捲進視野——不捲回來的話，這裡拍到的是「捲到一半」的畫面，
   *   會把黏著式功能列蓋住文字誤判成版面缺陷（我第一次就差點這樣報錯）。
   */
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector("main")?.scrollTo(0, 0);
    document.querySelector(".content")?.scrollTo(0, 0);
  });
  await page.waitForTimeout(900);
  const fit = await page.evaluate(() => {
    const box = document.querySelector(".diagram-canvas");
    const svg = box?.querySelector("svg");
    if (!box || !svg) return null;
    const boxRect = box.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const style = getComputedStyle(box);
    return {
      boxLeft: Math.round(boxRect.left),
      boxRight: Math.round(boxRect.right),
      svgLeft: Math.round(svgRect.left),
      svgRight: Math.round(svgRect.right),
      overflowX: style.overflowX,
      scrollWidth: box.scrollWidth,
      clientWidth: box.clientWidth,
    };
  });
  if (!fit) {
    console.log(`\n── ${width}px ── 找不到畫布`);
    continue;
  }
  const cut = fit.svgRight - fit.boxRight;
  console.log(
    `\n── 視窗 ${width}px ── 畫布可視 ${fit.boxLeft}～${fit.boxRight}、SVG ${fit.svgLeft}～${fit.svgRight}`,
  );
  console.log(
    `   ${cut > 1 ? "❌ 右側被切掉 " + Math.round(cut) + "px" : "✅ 完整放得下"}` +
      `（overflow-x: ${fit.overflowX}、可捲寬 ${fit.scrollWidth} / 可視寬 ${fit.clientWidth}）`,
  );
  await page.screenshot({ path: join(shotDir, `seven-視窗${width}.png`) });
}

console.log("\nJS 例外：", errors.length ? errors.slice(0, 3).join(" | ") : "無");
await browser.close();
server.close();
