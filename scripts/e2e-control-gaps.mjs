/**
 * 控制項的間距：不可以被壓扁、不可以互相重疊、label 不可以黏著自己的控制項
 *（2026-10-03，使用者連報兩件之後新增）
 *
 * ── 使用者回報的那一件 ──────────────────────────────────────────
 *
 *   「路口轉向程式，轉向進階分析分頁中，**車種-全部車種 這個欄位和旁邊的
 *     全調查時段 標籤重疊**」（2026-10-03，附線上 v2.1.89 的畫面）
 *
 *   成因：`.advanced-controls` 是 `flex-wrap: nowrap`，而 `.segmented`
 *   是可壓縮的 flex 項目。整列塞不下時，瀏覽器把每一塊往內壓，
 *   切換器被壓到比它的內容還窄，旁邊的 `<label>` 直接蓋上來。
 *
 * ── ⚠️ 為什麼既有的守門抓不到 ────────────────────────────────────
 *
 *   `e2e-layout-collisions.mjs` 的判準是對的，但它用的種子資料
 *  （`seed-wide.json`）路口名稱很短，那一列**根本塞得下**，
 *   所以它一直是綠的。這就是「**守門釘在特定批次的資料上**」：
 *   判準沒問題，餵進去的資料太溫和。
 *
 *   這一支刻意把情境推到會出事的那一邊，兩個條件一起：
 *     ① **路口名稱加長**（使用者的真實路名就是這個長度等級）
 *     ② **字距加寬**，模擬「同樣的字、比較寬的字型」——
 *        使用者的 Windows 用微軟正黑體，比容器裡的字型寬；
 *        容器裡量不到的溢出，在她機器上會發生。
 *        ⚠️ 不模擬這一條的話，這一支在**這個容器裡**會是假的綠。
 *
 * ── 判準 ────────────────────────────────────────────────────────
 *
 *   ① 每一個可見的 `.segmented` 都不可以被壓到比內容窄
 *      （`scrollWidth > clientWidth` 就是被壓扁了）。
 *   ② `.advanced-controls` 裡**視覺上同一列**的兩個直接子元素，
 *      左右不可以交疊。
 *
 * ── 內建反證（不是恆真）────────────────────────────────────────
 *
 *   量完之後，**把修正拿掉**（`.segmented{flex:0 1 auto}` ＋
 *   `.advanced-controls{flex-wrap:nowrap}`），同一套判準必須**抓到重疊**。
 *   抓不到就代表這支守門是恆綠的，整支視為失敗。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8286;
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/*
 * 種子：拿現成的 seed-wide.json，把路口名稱換成**與使用者真實路名等長**的示範名。
 * ⚠️ 刻意不寫她的真實路名——真實資料不可以進交付包。長度一樣就夠了。
 */
const seedObject = JSON.parse(readFileSync(join(here, "seed-wide.json"), "utf8"));
const LONG_NAME = "示範縣道123示範路－示範27東示範路";
for (const record of seedObject.records ?? []) {
  record.name = LONG_NAME;
  record.rawName = LONG_NAME;
}
const seed = JSON.stringify(seedObject);

/** 量一次：回傳 {squeezed:[…], overlaps:[…]}。 */
const measure = (page) =>
  page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const squeezed = [];
    for (const el of document.querySelectorAll(".segmented")) {
      if (!visible(el)) continue;
      /* ① 自己被壓到比內容窄 */
      if (el.scrollWidth - el.clientWidth > 1)
        squeezed.push({
          text: el.textContent.trim().slice(0, 24),
          why: "內容比自己的框寬",
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        });
      /*
       * ② **溢出它的外框**。
       *   實跑才發現這一種才是使用者看到的那一種：`.segmented` 自己
       *   `scrollWidth == clientWidth`（它沒有被壓），被壓的是外層
       *   `.segmented-wrap`（min-width:0），於是切換器整個**撐出容器**，
       *   溢出去的那一截蓋在旁邊的「車種」上面。
       *   只驗 ① 的話，這一支對使用者回報的那一件是恆綠的。
       */
      const wrap = el.closest(".segmented-wrap");
      if (wrap && visible(wrap)) {
        const a = el.getBoundingClientRect();
        const b = wrap.getBoundingClientRect();
        const spill = Math.max(a.right - b.right, b.left - a.left);
        if (spill > 1)
          squeezed.push({
            text: el.textContent.trim().slice(0, 24),
            why: "撐出 .segmented-wrap",
            spillPx: Number(spill.toFixed(1)),
          });
      }
    }
    const overlaps = [];
    for (const row of document.querySelectorAll(".advanced-controls")) {
      /*
       * ⚠️ 量的是「**畫面上真的佔到哪裡**」，不是直接子元素自己的框。
       *
       *   第一版我只比直接子元素，結果反證抓不到——因為被壓扁的是
       *   `.segmented-wrap`（它有 min-width:0），而裡面的 `.segmented`
       *   會**溢出自己的容器**。容器的框縮小了，溢出去的那一截才是
       *   蓋到旁邊的東西。所以每一塊都要取「自己 ∪ 所有子孫」的聯集框。
       */
      const inkBox = (el) => {
        let { left, right, top, bottom } = el.getBoundingClientRect();
        for (const kid of el.querySelectorAll("*")) {
          if (!visible(kid)) continue;
          const r = kid.getBoundingClientRect();
          left = Math.min(left, r.left);
          right = Math.max(right, r.right);
          top = Math.min(top, r.top);
          bottom = Math.max(bottom, r.bottom);
        }
        return { left, right, top, bottom };
      };
      const kids = [...row.children].filter(visible).map((el) => ({
        text: el.textContent.trim().slice(0, 14),
        ...inkBox(el),
      }));
      for (let i = 0; i < kids.length; i += 1)
        for (let j = i + 1; j < kids.length; j += 1) {
          const a = kids[i];
          const b = kids[j];
          /*
           * 視覺上不在同一列就不比（換行之後本來就會上下錯開）。
           * ⚠️ 判準是**垂直範圍有沒有交疊**，不是「上緣差幾 px」。
           *   第一版寫成 `Math.abs(a.top - b.top) > 6` 就跳過——
           *   而這一列是 `align-items:center`、每一塊高度都不一樣，
           *   上緣本來就差三十幾 px，於是**該比的那一對永遠被跳過**，
           *   反證因此抓不到。這是我自己在反證裡抓到的第三個洞。
           */
          if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 0) continue;
          /*
           * ⚠️ 水平交疊 = min(右緣) − max(左緣)，大於 0 才是真的疊在一起。
           *   第一版我寫成 `Math.min(b.left - a.right, a.left - b.right)`，
           *   那個式子對**沒有重疊**的兩塊也會算出負數（兩個差一正一負，
           *   min 一定取到負的那個），於是每一對都被報成重疊——
           *   **恆紅**的守門和恆綠的一樣沒用。實跑時當場看到「overlapPx:350」
           *   這種等於整塊寬度的數字才發現。
           */
          const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          if (overlap > 0.5)
            overlaps.push({ a: a.text, b: b.text, overlapPx: Number(overlap.toFixed(1)) });
        }
    }
    return { squeezed, overlaps };
  });

/**
 * 第二組判準：**label 的文字與它自己的控制項**不可以黏在一起。
 *
 * 使用者 2026-10-03 的第二封：「車種 和旁邊下拉式清單也太接近，
 * 顯示數值和他的下拉清單也很接近，**幾乎是黏在一起了**」。
 *
 * ⚠️ 既有的 `e2e-layout-collisions.mjs` 量的是「兩顆**互動元素**之間」，
 *   而 label 的文字是**文字節點**、不是互動元素，所以那一支看不到這一種。
 *   這也是為什麼同一個毛病在 .diagram-toolbar、.trend-controls、
 *   .review-panel、.advanced-controls 補了四次都還會再出現。
 *
 * 量法：用 Range 取 label **第一段文字**的實際矩形，與它底下第一個
 * 控制項（select／input／button）的矩形比水平間距；
 * 兩者不在同一條基線上（上下排）就不比。
 */
const labelGaps = (page) =>
  page.evaluate(() => {
    const MIN = 4;
    const tight = [];
    for (const label of document.querySelectorAll("label")) {
      const control = label.querySelector("select, input, button, textarea");
      if (!control) continue;
      const cr = control.getBoundingClientRect();
      if (cr.width <= 0 || cr.height <= 0) continue;
      const node = [...label.childNodes].find(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
      );
      if (!node) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const tr = range.getBoundingClientRect();
      if (tr.width <= 0) continue;
      /* 上下排（文字在控制項上方）不算黏在一起。 */
      if (Math.min(tr.bottom, cr.bottom) - Math.max(tr.top, cr.top) <= 0) continue;
      const gap = cr.left >= tr.right ? cr.left - tr.right : tr.left - cr.right;
      if (gap < MIN)
        tight.push({
          text: node.textContent.trim().slice(0, 12),
          control: control.tagName.toLowerCase(),
          gapPx: Number(gap.toFixed(1)),
        });
    }
    return tight;
  });

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());

/* 字距加寬：模擬「同樣的字、比較寬的字型」。 */
const WIDER_GLYPHS = ".segmented button{letter-spacing:2.4px}";
/*
 * 反證用：把這一列**強制擠窄**，同時還原「可壓縮 ＋ 不換行」的舊行為。
 *
 * ⚠️ 為什麼不是單純「把修正拿掉」就好：實跑發現只拿掉 flex 與 flex-wrap 時，
 *   瀏覽器會改成把按鈕文字在框內**折行**（高度從 46px 變兩行），
 *   於是誰也沒疊到誰——反證抓不到，而那會被誤讀成「這一支是恆綠的」。
 *   反證要證明的是**量得出來**，所以把情境推到一定會疊的那一邊：
 *   限寬 ＋ 可壓縮 ＋ 文字不折行。這三個就是使用者機器上實際發生的組合。
 */
const FORCE_SQUEEZE =
  ".advanced-controls{flex-wrap:nowrap;row-gap:0;max-width:620px}" +
  ".segmented{flex:0 1 auto;min-width:0}" +
  ".segmented button{white-space:nowrap}";

for (const width of [1366, 1536, 1890]) {
  const ctx = await browser.newContext({ viewport: { width, height: 950 }, locale: "zh-TW" });
  const page = await ctx.newPage();
  await page.addInitScript((text) => {
    try {
      localStorage.setItem("turning-traffic-state-v2", text);
    } catch {
      /* 無痕或封鎖時就算了，下面的前置檢查會紅。 */
    }
  }, seed);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);

  const names = await page.$$eval(
    "nav button:not(.nav-collapse):not(.nav-section)",
    (buttons) => buttons.map((b) => b.textContent.trim()),
  );
  const index = names.findIndex((name) => name.includes("轉向進階分析"));
  ok(`${width}px：找得到「轉向進階分析」分頁`, index >= 0, `側欄共 ${names.length} 頁`);
  if (index < 0) break;
  await page.locator("nav button:not(.nav-collapse):not(.nav-section)").nth(index).click();
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: WIDER_GLYPHS });
  await page.waitForTimeout(300);

  /* ── 前置檢查：真的量到東西，不是選擇器失效讓下面恆綠 ── */
  const shape = await page.evaluate(() => {
    const row = document.querySelector(".advanced-controls");
    return {
      hasRow: Boolean(row),
      kids: row ? row.children.length : 0,
      segments: document.querySelectorAll(".segmented").length,
      longName: document.body.textContent.includes("示範27東示範路"),
    };
  });
  ok(
    `${width}px：前置——這一頁真的有那一列（子元素 ${shape.kids} 個、分段切換器 ${shape.segments} 個）`,
    shape.hasRow && shape.kids >= 3 && shape.segments >= 1,
    JSON.stringify(shape),
  );
  ok(`${width}px：前置——長路口名稱真的進到畫面上了`, shape.longName);

  // 換行可能掩蓋遺漏的共用規則；幾何正常不能代替實際 computed contract。
  const contract = await page.evaluate(() => ({
    segments: [...document.querySelectorAll(".advanced-controls .segmented")].map((el) => ({
      shrink: getComputedStyle(el).flexShrink,
      buttons: [...el.querySelectorAll("button")].map((button) => getComputedStyle(button).whiteSpace),
    })),
    rowGap: getComputedStyle(document.querySelector(".advanced-controls")).rowGap,
  }));
  ok(`${width}px：共用切換器不可壓縮、按鈕文字不折行`,
    contract.segments.length > 0 && contract.segments.every((el) =>
      el.shrink === "0" && el.buttons.length > 0 && el.buttons.every((value) => value === "nowrap")),
    JSON.stringify(contract));
  ok(`${width}px：控制列換行間距為 12px`, contract.rowGap === "12px", contract.rowGap);

  const after = await measure(page);
  ok(
    `${width}px：分段切換器沒有被壓到比內容窄`,
    after.squeezed.length === 0,
    after.squeezed.length ? JSON.stringify(after.squeezed) : "全部都是自然寬度",
  );
  ok(
    `${width}px：同一列的控制項沒有互相重疊`,
    after.overlaps.length === 0,
    after.overlaps.length ? JSON.stringify(after.overlaps) : "逐對比過，最小間距 ≥ 0",
  );

  /* ── 第二組：label 的文字與自己的控制項 ── */
  const tight = await labelGaps(page);
  ok(
    `${width}px：label 的文字與自己的控制項間距 ≥ 4px`,
    tight.length === 0,
    tight.length ? JSON.stringify(tight) : "逐個 label 量過，沒有黏在一起的",
  );

  /* ── 內建反證：把修正拿掉，同一套判準必須抓到 ── */
  await page.addStyleTag({ content: FORCE_SQUEEZE + ".advanced-controls > label{gap:0}" });
  const tightBroken = await labelGaps(page);
  ok(
    `${width}px：⚠️ 反證——把 label 的 gap 設成 0 之後，判準必須抓到黏在一起`,
    tightBroken.length > 0,
    tightBroken.length ? `抓到 ${tightBroken.length} 個：${JSON.stringify(tightBroken[0])}` : "**沒抓到＝這一條是恆綠的**",
  );
  await page.waitForTimeout(300);
  const broken = await measure(page);
  ok(
    `${width}px：⚠️ 反證——把這一列強制擠窄之後，判準必須抓到重疊或壓扁`,
    broken.overlaps.length > 0 || broken.squeezed.length > 0,
    broken.overlaps.length || broken.squeezed.length
      ? `抓到重疊 ${broken.overlaps.length} 組、壓扁 ${broken.squeezed.length} 個` +
        (broken.overlaps[0] ? `：${JSON.stringify(broken.overlaps[0])}` : "")
      : "**沒抓到＝這一支是恆綠的**",
  );
  await ctx.close();
}

await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不通過：`);
  for (const line of problems) console.error("  - " + line);
  process.exit(1);
}
console.log("\n✅ 全部通過");
