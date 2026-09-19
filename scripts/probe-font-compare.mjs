/*
 * ══════════════════════════════════════════════════════════════════════
 *  拿掉網路字型會怎樣：同一個畫面，兩種字型各拍一張，用眼睛比
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者要決定「正式站要不要也拿掉 Google 網路字型」，所以要看得到差別，
 * 不是聽我描述。
 *
 * ⚠️ 這個容器連不到 fonts.googleapis.com，所以不能真的載網路字型。
 *   改用 fontconfig 把「Noto Sans TC」這個名字指到容器裡真的有的
 *   Noto Sans CJK TC（就是 Google 那一套的同一款字），得到的字形與
 *   網路字型一致；差別只在西文（IBM Plex Sans 這裡沒有）。
 *
 * ⚠️ 更重要的是**量**，不是只看：字換了以後
 *   ① 圖卡裡的文字有沒有超出卡片（字寬變了就可能爆框）
 *   ② 側欄項目、表頭有沒有被裁掉
 *   這兩件事光看縮圖看不出來，而它們才是「會不會出事」的部分。
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "seed-state.json"), "utf8");
const shotDir = join(here, "..", ".probe-shots");
mkdirSync(shotDir, { recursive: true });

const server = await serve(8177);
const browser = await chromium.launch(launchOptions());

/**
 * @param {string} tag 檔名用
 * @param {boolean} webFont true＝模擬網路字型載得到
 */
async function shoot(tag, webFont) {
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "zh-TW",
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    (s) => localStorage.setItem("turning-traffic-state-v2", s),
    seed,
  );
  await installStateHelpers(page);
  /*
   * 不要網路字型時，把整站的字型堆疊裡那兩個名字拔掉——
   * 等同於「載不到」的結果（瀏覽器往後找下一個）。
   */
  if (!webFont)
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent =
          "*{font-family:'Microsoft JhengHei','Heiti TC',sans-serif !important}";
        document.head.append(style);
      });
    });
  await page.goto("http://localhost:8177/");
  await page.waitForTimeout(1500);
  await page
    .locator('aside button:has-text("路口轉向圖"), nav button:has-text("路口轉向圖")')
    .first()
    .click();
  await page.waitForTimeout(1200);

  /*
   * 量：圖卡裡的每一段文字有沒有超出它所屬的那張卡。
   * 字換了之後字寬會變，這是「會不會爆框」唯一算得準的檢查。
   */
  const overflow = await page.evaluate(() => {
    const svg = document.querySelector(".diagram-canvas svg");
    if (!svg) return null;
    const out = [];
    for (const card of svg.querySelectorAll("rect.flow-card")) {
      const group = card.closest("g");
      if (!group) continue;
      const cardBox = card.getBoundingClientRect();
      for (const text of group.querySelectorAll("text")) {
        const t = text.getBoundingClientRect();
        if (!t.width) continue;
        const over = Math.max(cardBox.left - t.left, t.right - cardBox.right);
        if (over > 1)
          out.push({
            text: (text.textContent || "").slice(0, 14),
            over: Math.round(over),
          });
      }
    }
    return out;
  });
  const sidebar = await page.evaluate(() =>
    [...document.querySelectorAll("aside.sidebar nav button")]
      .filter((b) => b.scrollWidth - b.clientWidth > 1)
      .map((b) => (b.textContent || "").trim().slice(0, 16)),
  );
  console.log(
    `\n── ${tag} ──\n   圖卡文字爆框：${overflow ? overflow.length : "量不到"} 處` +
      (overflow && overflow.length
        ? `（例：${overflow
            .slice(0, 4)
            .map((o) => `「${o.text}」超出 ${o.over}px`)
            .join("、")}）`
        : "") +
      `\n   側欄文字被裁：${sidebar.length} 項${sidebar.length ? "（" + sidebar.join("、") + "）" : ""}`,
  );
  await page.screenshot({ path: join(shotDir, `font-${tag}-整頁.png`) });
  await page
    .locator(".diagram-canvas")
    .first()
    .screenshot({ path: join(shotDir, `font-${tag}-轉向圖.png`) });
  await ctx.close();
}

await shoot("有網路字型", true);
await shoot("沒有網路字型", false);

await browser.close();
server.close();
console.log("\n截圖在 .probe-shots/ 底下，檔名以 font- 開頭。");
