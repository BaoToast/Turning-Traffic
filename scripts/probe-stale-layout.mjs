/*
 * 使用者回報：「重新把網頁放大又縮小後，保持圖片可見的功能就恢復了」。
 *
 * ⚠️ 這句話直接指出我先前那支探針的**方法錯誤**：
 *   probe-sticky-real.mjs 每量一個尺寸前都呼叫 setViewportSize()，
 *   那本身就等同於使用者說的「放大又縮小」——會強制整頁重新算版面。
 *   所以它量到的一律是「已經被修好之後」的狀態，永遠是綠的。
 *
 * 這一支刻意**不碰視窗大小**：用建立 context 時就定好的尺寸載入、換頁、
 * 展開，直接量。量完之後才故意改一次尺寸再改回來，第二次量。
 * 兩次不一樣 → 就是那個 bug，而且被重現出來了。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8412;
const seed = readFileSync(join(here, "seed-15min.json"), "utf8");
const W = 1521, H = 703;

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());

async function look(tag, jiggle) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, locale: "zh-TW" });
  const page = await ctx.newPage();
  page.on("dialog", (e) => e.accept());
  await installStateHelpers(page);
  /* 隱私瀏覽或封鎖站台資料時 localStorage 會丟例外；探測腳本不因此中斷。 */
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("turning-traffic-state-v2", t);
    } catch {
      /* 寫不進去就算了，下面照樣跑，只是畫面會是空白狀態 */
    }
  }, seed);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("nav button")].find((n) => n.textContent.trim().includes("轉向進階分析"));
    b?.click();
  });
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    for (const id of ["advanced-peak-quarter", "advanced-peak-window"]) {
      const n = document.getElementById(id);
      if (n) n.open = true;
    }
  });
  await page.waitForTimeout(1000);

  if (jiggle) {
    /* 模擬使用者「放大又縮小」：改一次尺寸再改回來。 */
    await page.setViewportSize({ width: W - 120, height: H });
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: W, height: H });
    await page.waitForTimeout(800);
  }

  const rows = await page.evaluate(() => {
    const out = [];
    for (const id of ["advanced-peak-quarter", "advanced-peak-window"]) {
      const panel = document.getElementById(id);
      const body = panel?.querySelector(".panel-body");
      const fig = body?.querySelector(":scope > .peak-shape-figure");
      const note = body?.querySelector(":scope > .peak-shape-note");
      if (!fig || !note) { out.push({ id, missing: true }); continue; }
      const f = fig.getBoundingClientRect(), n = note.getBoundingClientRect();
      const host = fig.closest(".peak-shape");
      out.push({
        id,
        containerW: Math.round(host.getBoundingClientRect().width),
        containerType: getComputedStyle(host).containerType,
        position: getComputedStyle(fig).position,
        sideBySide: n.left >= f.right - 2,
      });
    }
    return out;
  });
  await ctx.close();
  return rows;
}

const before = await look("直接載入（不碰視窗大小）", false);
const after = await look("載入後故意放大又縮小", true);

console.log(`視窗固定在 ${W}×${H}，兩次唯一的差別是「有沒有動過視窗大小」\n`);
console.log("圖                          載入後直接量                          放大又縮小之後");
for (let i = 0; i < before.length; i += 1) {
  const b = before[i], a = after[i];
  const fmt = (r) => r.missing ? "找不到" :
    `${r.sideBySide ? "並排" : "上下排"}／${r.position}／塊寬 ${r.containerW}px`;
  const same = JSON.stringify(b) === JSON.stringify(a);
  console.log(`${b.id.padEnd(26)}  ${fmt(b).padEnd(36)}  ${fmt(a)}   ${same ? "（相同）" : "⚠️ 不一樣 ← 重現了"}`);
}

await browser.close();
await server.close();
