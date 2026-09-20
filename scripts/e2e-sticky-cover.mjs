/*
 * ══════════════════════════════════════════════════════════════════════
 *  釘住的區塊不可以蓋住別的區塊（掃寬度做 hit-test）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-20：「路口幾何示意圖我看不到，似乎和顏色檢視轉向重疊」。
 *
 * 真正的原因是**斷點沒對齊**：
 *   .geometry-layout      1420px 以下收成單欄
 *   .geometry-turn-preview 1100px 以下才取消 position: sticky
 * 於是 1101～1420px 這一段「已經單欄、卻還釘著」。單欄時它的正下方就是
 * 「路口幾何示意圖」，往下捲時它釘在畫面上緣，而 sticky 是定位元素、
 * 下面那塊是一般元素——依 CSS 繪製順序定位元素在上，整塊幾何示意圖
 * 被不透明面板底色蓋掉。
 *
 * ⚠️ 為什麼要**掃一整段寬度**，不能只測 1366 和 1536：
 *   這個坑就是「兩個 media query 中間的空窗」。只測幾個點，
 *   剛好測在空窗外面就什麼都驗不到。這裡刻意每 60px 掃一次。
 *
 * ⚠️ 為什麼要**先捲過去再量**，不能只在頁首截圖：
 *   sticky 只有在「捲到它上緣以上」之後才會釘起來。停在頁首的視覺檢查
 *   對這個 bug 永遠是綠的——GPT 這一輪「1366×768 逐頁檢查未見重疊」
 *   就是這樣漏掉的。所以這支一定要先點側欄跳過去。
 *
 * ⚠️ 為什麼用 document.elementFromPoint，不用矩形相交：
 *   矩形相交在兩欄版面會誤判（同列相鄰的兩塊 y 區間本來就重疊），
 *   而且相交也不代表「被蓋住」——要看**誰畫在上面**。
 *   elementFromPoint 回的就是那個點最上層的元素，這才是使用者看到的東西。
 *
 * 反證（必須會紅）：把 app/globals.css 的
 *   @media (min-width: 1421px) { .geometry-turn-preview { position: sticky } }
 * 改回無條件的 `.geometry-turn-preview { position: sticky }`，
 * 這支要在 1120～1400 一整段報 ❌。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { serve } = await import(pathToFileURL(join(HERE, "serve.mjs")).href);
const { launchOptions } = await import(
  pathToFileURL(join(HERE, "chrome-path.mjs")).href
);
const seed = readFileSync(join(HERE, "seed-wide.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};
const stop = (why) => {
  console.error(`\n❌ ${why}——後面的條件會變成恆真，直接停。`);
  problems.push(why);
};

/*
 * 要掃的頁面與該頁側欄子項目。
 * 只列「同一個格線容器裡有釘住元素」的頁面沒有意義——新頁面會漏掉，
 * 所以這裡列的是**整頁的側欄項目**，由腳本自己一個一個點過去。
 */
const PAGES = [
  { tab: "道路與流向管理", blocks: ["支線與流向設定", "用顏色檢視轉向", "路口幾何示意圖"] },
  { tab: "歷季趨勢比較", blocks: [] },
  { tab: "流量核對工作台", blocks: [] },
  { tab: "轉向進階分析", blocks: [] },
];

/* 每 60px 掃一次，範圍涵蓋兩個斷點前後。 */
const WIDTHS = [];
for (let w = 1120; w <= 1600; w += 60) WIDTHS.push(w);
WIDTHS.push(1421, 1420); /* 斷點兩側各釘一個 */

const server = await serve(8266);
const browser = await chromium.launch(launchOptions());

let checked = 0;

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    locale: "zh-TW",
  });
  const page = await context.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.addInitScript((text) => {
    try {
      localStorage.setItem("turning-traffic-state-v2", text);
    } catch {
      /* 無痕時就算了，前置檢查會紅。 */
    }
  }, seed);
  await page.goto("http://127.0.0.1:8266/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1300);

  for (const spec of PAGES) {
    const tab = page
      .locator(`aside.sidebar nav button:has-text("${spec.tab}")`)
      .first();
    if (!(await tab.count())) {
      stop(`${width}px：側欄找不到「${spec.tab}」`);
      continue;
    }
    await tab.click();
    await page.waitForTimeout(900);

    for (const name of spec.blocks) {
      const item = page
        .locator(`aside.sidebar nav button:has-text("${name}")`)
        .first();
      if (!(await item.count())) {
        stop(`${width}px：側欄找不到子項目「${name}」`);
        continue;
      }
      await item.click();
      await page.waitForTimeout(1100);

      const result = await page.evaluate(() => {
        const target = document.querySelector(".is-focused");
        if (!target) return { noFocus: true };
        const r = target.getBoundingClientRect();
        if (r.width < 40 || r.height < 40)
          return { tooSmall: true, w: Math.round(r.width), h: Math.round(r.height) };
        const hits = [];
        let floated = 0;
        for (const fy of [0.12, 0.35, 0.6, 0.85]) {
          const y = r.top + r.height * fy;
          const x = r.left + r.width * 0.5;
          /* 落在視窗外的取樣點不算數（不可以當成通過，也不可以當成失敗）。 */
          if (y < 4 || y > innerHeight - 4) continue;
          const el = document.elementFromPoint(x, y);
          if (!el) continue;
          if (target.contains(el)) {
            hits.push({ fy, verdict: "self" });
            continue;
          }
          /*
           * ⚠️ position:fixed 的東西（快閃提示 .toast、頂列、主工具列）
           *   本來就是**浮在所有內容上面**的設計，不是這支要抓的東西。
           *   這支抓的是「在版面流裡的兄弟區塊把別人蓋掉」。
           *   ——但被略過的點要另外計數，不可以默默吃掉；
           *     四個點全被略過時下面會報「什麼都沒驗到」。
           */
          let fixedAncestor = false;
          for (let n = el; n && n !== document.body; n = n.parentElement) {
            if (getComputedStyle(n).position === "fixed") {
              fixedAncestor = true;
              break;
            }
          }
          if (fixedAncestor) {
            floated += 1;
            continue;
          }
          /* 蓋住它的是誰？把最近的有 id 的祖先講出來，訊息才查得下去。 */
          let node = el,
            who = el.tagName.toLowerCase() + "." + (el.className || "");
          while (node && node !== document.body) {
            if (node.id) {
              who = "#" + node.id;
              break;
            }
            node = node.parentElement;
          }
          const pos = node ? getComputedStyle(node).position : "";
          hits.push({ fy, verdict: "covered", who, pos });
        }
        return { id: target.id, hits, sampled: hits.length, floated };
      });

      if (result.noFocus) {
        stop(`${width}px／${name}：點了側欄卻沒有任何區塊被標記 .is-focused`);
        continue;
      }
      if (result.tooSmall) {
        stop(
          `${width}px／${name}：被標記的區塊只有 ${result.tooSmall ? `${result.w}×${result.h}` : ""}，取樣沒有意義`,
        );
        continue;
      }
      if (!result.sampled) {
        stop(
          `${width}px／${name}：四個取樣點全部落在視窗外或被浮動層（fixed）擋掉（略過 ${result.floated} 點），這一輪什麼都沒驗到`,
        );
        continue;
      }
      checked += result.sampled;
      const covered = result.hits.filter((h) => h.verdict === "covered");
      ok(
        `${width}px：點「${name}」之後，看到的就是那一塊（#${result.id}，取樣 ${result.sampled} 點）`,
        covered.length === 0,
        covered
          .map((c) => `${Math.round(c.fy * 100)}% 被 ${c.who}（position:${c.pos}）蓋住`)
          .join("；"),
      );
    }
  }
  await context.close();
}

/* ⚠️ 前置：真的有量到東西，否則上面全綠等於什麼都沒驗。 */
ok(
  "前置：整輪至少取樣 60 個點",
  checked >= 60,
  `實際 ${checked} 點`,
);

await browser.close();
server.close();

if (problems.length) {
  console.error(`\n❌ ${problems.length} 項：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 釘住的區塊沒有蓋住任何被點名的區塊。");
