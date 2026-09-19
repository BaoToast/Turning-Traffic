/*
 * ══════════════════════════════════════════════════════════════════════
 *  盤點：每一個大分頁底下「該有」幾個小分頁，實際列了幾個
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：「大分頁下面有小分頁（例如各種圖的名稱作為小分頁
 * 名稱）……利用大小分頁讓人知道各種圖、功能分別在哪。」
 *
 * ⚠️ 既有的守門（e2e-nav-target／e2e-nav-layout）驗的是
 *   「**列出來的**點得到、框得起來、不被功能列蓋住」。
 *   它們**驗不到「該列的有沒有漏列」**——一頁有五塊、只列兩塊，照樣全綠。
 *   這一支補的就是這個缺口：逐頁數畫面上真的有幾塊獨立區塊，
 *   跟側欄列了幾個小分頁對照。
 *
 * 判定「一塊」的方式：畫面主區裡有自己標題（h2／h3）而且畫得出高度的
 * panel／section。純說明用的小方塊（.box、hint）不算。
 *
 * ⚠️ 2026-09-13 起這一支**會紅**，不再只是盤點：
 *   有落差的分頁要嘛補上小分頁，要嘛列進下面的 SINGLE_BLOCK（那一頁
 *   畫面上只有一塊，列一項等於重複頁名，所以刻意不列）。
 *   「補上」與「豁免」都要留下決定，這樣以後新加一頁時不會默默漏掉。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "seed-state.json"), "utf8");

const server = await serve(8188);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
await page.addInitScript(
  (s) => localStorage.setItem("turning-traffic-state-v2", s),
  seed,
);
await installStateHelpers(page);
await page.goto("http://localhost:8188/");
await page.waitForTimeout(1600);

/*
 * 刻意不列小分頁的分頁：畫面上只有一塊，列一項等於把頁名再寫一次。
 * ⚠️ 要加進來之前先確認**真的只有一塊**——下面會驗，多一塊就紅。
 */
const SINGLE_BLOCK = new Set([
  "總覽儀表板",
  "各路口駛入／駛出流量",
  "路口轉向圖",
  "結論草稿產生器",
]);

const problems = [];
const pages = await page.evaluate(() =>
/*
 * ⚠️ 2026-09-13 起每一列右側多了一顆收合鈕（也是 nav > div > button）。
 *   收集大分頁時**一定要排除它**，否則它的文字「▾」會被當成一個分頁名稱，
 *   接著 :has-text("▾") 會去按它 → 把小分頁收起來，
 *   後面每一項都找不到而逾時。（實測就是這樣紅的。）
 */
  [...document.querySelectorAll("nav > div > button:not(.nav-collapse)")].map((el) =>
    (el.textContent || "").replace(/\s+/g, " ").trim(),
  ),
);

console.log(
  `${"大分頁".padEnd(22)}${"小分頁".padEnd(8)}${"畫面上的區塊".padEnd(14)}落差`,
);
console.log("─".repeat(78));
const gaps = [];
for (const label of pages) {
  await page.locator(`nav > div > button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const listed = [...document.querySelectorAll(".nav-sections .nav-section")].map(
      (el) => (el.getAttribute("data-goto-item") || el.textContent || "").trim(),
    );
    /*
     * 畫面上的「一塊」＝ 主區裡有自己標題、而且真的畫得出高度的區塊。
     * 巢狀的內層 panel 不重複計（只取最外層）。
     */
    const blocks = [];
    /*
     * ⚠️ 明講出來的豁免：純說明的區塊**刻意不列**成小分頁。
     *
     * 使用者 2026-09-13：「小分頁中，如果那個欄位是純粹的說明文字、
     *   沒有任何功用的話，不用特地做成小分頁在左側欄位，三個程式都是如此。
     *   大小分頁都前提是該項是有實質功能的。」
     *
     * ⚠️ 這個標記**不可以變成萬用貼紙**：下面同時檢查它名副其實——
     *   被標成純說明的區塊裡若出現按鈕／輸入／下拉／表格，就是標錯了，
     *   一樣要紅。否則只要想讓守門變綠，貼一張就好。
     */
    const mislabelled = [];
    for (const el of document.querySelectorAll("[data-nav-skip='explanation']")) {
      /*
       * ⚠️ 判準補一條（使用者 2026-09-14）：
       *   **「複製／下載這一塊自己的說明文字」不算可操作的控制項。**
       *   那種鈕不對資料做任何事，區塊的本質仍然是說明文字。
       *
       * ⚠️ 但不可以變成萬用貼紙：這裡要求純說明區塊裡的按鈕
       *   **每一顆**都掛 data-copy-own-text，漏一顆就是標錯。
       */
      const interactive = [
        ...el.querySelectorAll("button, input, select, textarea, table, a[download]"),
      ].filter(
        (node) =>
          !(node.tagName === "BUTTON" && node.hasAttribute("data-copy-own-text")) &&
          /*
           * ⚠️ 判準再補一條（使用者 2026-09-15）：
           *   **說明用的對照表不算「要核對的資料」。**
           *   新手手冊裡那張「哪個功能什麼時候才需要」的表，內容是寫死的，
           *   沒有任何一個本計畫的數字——它是說明，不是要核對的資料。
           *
           * ⚠️ 一樣不可以變成萬用貼紙：只有明確標了 data-explanation-table
           *   的 <table> 才排除，按鈕／輸入／下拉一個都不放過。
           */
          !(node.tagName === "TABLE" && node.hasAttribute("data-explanation-table")),
      ).length;
      if (interactive)
        mislabelled.push(
          `${(el.querySelector("h2, h3")?.textContent || el.id || "?").trim().slice(0, 20)}（有 ${interactive} 個可操作元素）`,
        );
    }
    for (const el of document.querySelectorAll(
      "main .content > section, main .content > article, main .content section.panel, main .content article.panel",
    )) {
      if (el.closest(".panel") !== el && el.parentElement?.closest(".panel")) continue;
      /* 純說明的區塊不算「該列的一塊」。 */
      if (el.closest("[data-nav-skip='explanation']")) continue;
      const heading = el.querySelector(":scope > .panel-head h2, :scope > h2, :scope > .panel-head h3");
      if (!heading) continue;
      if (el.getBoundingClientRect().height < 20) continue;
      blocks.push((heading.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24));
    }
    return { listed, blocks: [...new Set(blocks)], mislabelled };
  });
  for (const item of info.mislabelled ?? [])
    problems.push(
      `${label}：「${item}」被標成「純說明」，但它有可操作的元素——標記名不副實`,
    );
  const name = label.replace(/^[^一-龥A-Za-z]+/, "");
  const gap = info.blocks.length - info.listed.length;
  console.log(
    `${name.padEnd(22)}${String(info.listed.length).padEnd(8)}${String(info.blocks.length).padEnd(14)}${gap > 0 ? "⚠️ 少 " + gap : ""}`,
  );
  if (gap > 0) {
    gaps.push({ name, listed: info.listed, blocks: info.blocks });
    if (!SINGLE_BLOCK.has(name))
      problems.push(
        `${name}：畫面上 ${info.blocks.length} 塊，側欄只列 ${info.listed.length} 項`,
      );
  }
  /* 豁免名單裡的分頁若長出第二塊，就不該再豁免。 */
  if (SINGLE_BLOCK.has(name) && info.blocks.length > 1)
    problems.push(
      `${name}：已列在「只有一塊」的豁免名單裡，但畫面上其實有 ${info.blocks.length} 塊——請補小分頁或把它移出名單`,
    );
}

if (gaps.length) {
  console.log("\n── 有落差的分頁，逐一列出畫面上有哪幾塊 ──");
  for (const g of gaps) {
    console.log(`\n【${g.name}】`);
    console.log("  側欄列了：", g.listed.join("、") || "（一個都沒有）");
    console.log("  畫面上有：", g.blocks.join("、"));
  }
}
if (errors.length) problems.push("有 JS 例外：" + errors.slice(0, 2).join(" | "));
await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 每一個大分頁底下，畫面上有幾塊就列得出幾個小分頁");
