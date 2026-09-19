/*
 * 排版量測：走過每一個分頁，用瀏覽器實際量出來的座標判斷有沒有「沾黏」。
 *
 * 沾黏在這裡有兩種，都會量：
 *  A. 版面沾黏——主內容區塊的左緣（或右緣）貼著視窗，沒有留白。
 *  B. 內容沾黏——某個區塊的文字／表格跑到它自己容器的內距之外，
 *     視覺上就是字貼著卡片邊框。
 * 另外一併檢查整頁有沒有橫向捲動（overflow）。
 *
 * 只印數字與判定，不靠截圖目視。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";



const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "seed-wide.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const VIEWS = [
  "總覽儀表板",
  /*
   * v2.1.64：「多建立與管理計畫」改名為「建立與管理計畫」（頁內的跨計畫趨勢圖移除，
   * 但建立／刪除計畫仍然只有這一頁做得到）；
   * 「跨計畫／多路口比較」整頁移除，頁內那兩組表格改掛在新的
   * 「各路口尖峰彙總」；「備份、還原與版本」改名為「備份與還原」。
   * 這份清單是**版面檢查要走過的每一頁**，名字對不上就整頁沒被量到，
   * 所以要跟著改，不可以只把不存在的那幾個刪掉了事。
   */
  "建立與管理計畫",
  "季度批次匯入",
  "資料維護",
  "路口名稱管理",
  "車種轉向當量",
  "道路與流向管理",
  "路口轉向圖",
  "車種組成分析",
  "各路口駛入／駛出流量",
  "各路口尖峰彙總",
  "歷季趨勢比較",
  "流量核對工作台",
  "轉向進階分析",
  "成果交付",
  "批次輸出",
  "備份與還原",
  "新手操作手冊",
].map((label) => [label, label]);

const WIDTHS = [640, 760, 820, 900, 1024, 1100, 1180, 1280, 1350, 1440, 1680, 1920];
const MIN_PAGE_GUTTER = 12; // 主內容左右至少要留的空白（px）

const server = await serve(8123);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/net::ERR_/.test(m.text())) errors.push(m.text());
});
await page.addInitScript(
  (s) => localStorage.setItem("turning-traffic-state-v2", s),
  seed,
);
await page.goto("http://localhost:8123/");
await page.waitForTimeout(1400);

async function gotoView(label) {
  const button = page
    .locator(`nav button:has-text("${label}"), aside button:has-text("${label}")`)
    .first();
  if (!(await button.count())) return false;
  /*
   * 窄視窗時側邊選單是用 transform 推到畫面外的（不是 display:none），
   * Playwright 仍然把它算成「可見」，所以不能靠 isVisible 判斷，
   * 直接看側邊欄現在有沒有被推出去。
   */
  const offscreen = await page.evaluate(() => {
    const aside = document.querySelector("aside.sidebar");
    if (!aside) return false;
    return aside.getBoundingClientRect().right <= 1;
  });
  if (offscreen) {
    const menu = page.locator("button.menu");
    if (await menu.count()) {
      await menu.first().click();
      await page.waitForTimeout(360);
    }
  }
  await button.click({ timeout: 8000 });
  await page.waitForTimeout(650);
  // 點完把選單收回去，才不會蓋住內容影響量測。
  const menu = page.locator("button.menu");
  if ((await menu.count()) && (await menu.first().isVisible())) {
    const open = await page.locator("aside.sidebar.open").count();
    if (open) {
      await menu.first().click();
      await page.waitForTimeout(320);
    }
  }
  return true;
}

/** 量一個分頁的排版數字。 */
async function measure() {
  return page.evaluate((MIN) => {
    // 真正的內容容器是 .content（.main 底下還有一條 topbar 是滿版的）。
    const main = document.querySelector(".content") || document.body;
    const mainBox = main.getBoundingClientRect();
    const view = document.documentElement.clientWidth;

    const styles = getComputedStyle(main);
    const padLeft = parseFloat(styles.paddingLeft) || 0;
    const padRight = parseFloat(styles.paddingRight) || 0;

    const blocks = Array.from(main.children).filter(
      (el) => el.getBoundingClientRect().height > 0,
    );
    let minLeftGap = Infinity;
    let minRightGap = Infinity;
    let leftCulprit = "";
    let rightCulprit = "";
    for (const el of blocks) {
      const box = el.getBoundingClientRect();
      const leftGap = box.left - (mainBox.left + padLeft);
      const rightGap = mainBox.right - padRight - box.right;
      if (leftGap < minLeftGap) {
        minLeftGap = leftGap;
        leftCulprit = el.className || el.tagName;
      }
      if (rightGap < minRightGap) {
        minRightGap = rightGap;
        rightCulprit = el.className || el.tagName;
      }
    }

    // B. 內容沾黏：文字節點的左緣是否越過它所在卡片的內距
    const stuck = [];
    for (const card of main.querySelectorAll(".panel, article, section")) {
      const cardBox = card.getBoundingClientRect();
      if (cardBox.height < 8) continue;
      const cardStyle = getComputedStyle(card);
      const cardPadLeft = parseFloat(cardStyle.paddingLeft) || 0;
      if (cardPadLeft < 1) continue; // 這張卡本來就沒有內距（例如純表格容器）
      for (const el of card.querySelectorAll(
        "h1,h2,h3,h4,p,span,strong,b,label,td,th,li",
      )) {
        if (el.closest(".panel, article, section") !== card) continue;
        const text = (el.textContent || "").trim();
        if (!text) continue;
        const box = el.getBoundingClientRect();
        if (box.width < 1 || box.height < 1) continue;
        if (getComputedStyle(el).position === "absolute") continue;
        const gap = box.left - cardBox.left;
        if (gap < Math.min(cardPadLeft, MIN) - 0.6)
          stuck.push({
            card: card.className || card.tagName,
            el: el.tagName + "." + (el.className || ""),
            text: text.slice(0, 28),
            gap: Math.round(gap * 10) / 10,
            cardPadLeft,
          });
      }
    }

    // C. 橫向溢出
    const overflow = document.documentElement.scrollWidth - view;
    const wide = [];
    if (overflow > 1)
      for (const el of document.querySelectorAll("main *")) {
        const box = el.getBoundingClientRect();
        if (box.right > view + 1 && getComputedStyle(el).overflowX !== "auto")
          wide.push({
            el: el.tagName + "." + (el.className || ""),
            right: Math.round(box.right),
          });
      }

    /*
     * D. 卡片內左緣對齊：同一張卡片裡，標題（.eyebrow/h2）與表格第一欄、
     *    段落文字應該對齊在同一條線上。表格若比標題更靠左，看起來就是
     *    「文字貼著卡片邊」——這是使用者實際回報的那種沾黏。
     */
    /*
     * D0. 卡片標題本身有沒有內距。整張卡片忘了寫 padding 時（實際發生過：
     *     .report-draft-panel），標題就直接貼在卡片邊框上。
     */
    const flushHeads = [];
    for (const card of main.querySelectorAll(".panel")) {
      const cardBox = card.getBoundingClientRect();
      if (cardBox.height < 8) continue;
      for (const head of card.querySelectorAll(".eyebrow")) {
        if (head.closest(".panel") !== card) continue;
        const gap = head.getBoundingClientRect().left - cardBox.left;
        if (gap < 12)
          flushHeads.push({
            card: card.className,
            text: (head.textContent || "").trim().slice(0, 24),
            gap: Math.round(gap * 10) / 10,
          });
      }
    }

    const misaligned = [];
    for (const card of main.querySelectorAll(".panel")) {
      const cardBox = card.getBoundingClientRect();
      if (cardBox.height < 8) continue;
      const heads = Array.from(
        card.querySelectorAll(".eyebrow, .panel-head h2, .panel-head h3"),
      ).filter((el) => el.closest(".panel") === card);
      if (!heads.length) continue;
      const headLeft = Math.min(
        ...heads.map((el) => el.getBoundingClientRect().left),
      );
      /*
       * 除了表格與段落，卡片裡的「按鈕列」也要比對。
       * 實測 .geometry-tools 的 padding 是 12px 0，「開啟圖卡排版預覽」因此
       * 貼在卡片邊框上、比上面的支線列往左凸出 20px，而舊版的檢查只看
       * 表格與 <p>，完全沒抓到。
       */
      const inner = Array.from(
        card.querySelectorAll(
          "table th:first-child, table td:first-child, .panel > p, .panel > ul > li," +
            " .panel > div > button:first-child, .panel > button:first-child",
        ),
      ).filter((el) => el.closest(".panel") === card);
      for (const el of inner) {
        const box = el.getBoundingClientRect();
        if (box.width < 1 || !(el.textContent || "").trim()) continue;
        /*
         * 量「文字實際畫在哪裡」，用 Range 取第一個文字節點的位置。
         *
         * 不能用「外框左緣＋自己的 padding」：像 .project-row 那種只是外層
         * 包裝、padding 在內層 .project-open 上的結構，會被誤判成貼邊
         *（實測回報「少 9px」，但畫面上其實是對齊的）。
         */
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let textLeft = null;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0) {
            textLeft = rect.left;
            break;
          }
        }
        if (textLeft === null) continue;
        const delta = Math.round((textLeft - headLeft) * 10) / 10;
        if (delta < -3) {
          misaligned.push({
            card: card.className,
            text: (el.textContent || "").trim().slice(0, 20),
            delta,
            headLeft: Math.round(headLeft),
            elLeft: Math.round(textLeft),
            cardLeft: Math.round(cardBox.left),
          });
          break; // 同一張卡片回報一次就好
        }
      }
    }

    /*
     * ── 按鈕文字被裁掉 ────────────────────────────────────────
     *
     * 使用者 2026-09-16：「不要再出現文字超過按鍵大小或被背景色遮蔽的狀況」。
     *
     * ⚠️ 既有的「橫向溢出」抓不到這一種：按鈕本身乖乖待在版面裡，
     *   溢出的是**按鈕裡面的字**。判準是 scrollWidth > clientWidth。
     * ⚠️ 沒畫出來的按鈕一律跳過，否則整支恆紅。
     */
    const clippedButtons = [];
    for (const el of document.querySelectorAll("button")) {
      if (!el.getClientRects().length) continue;
      const text = (el.textContent || "").trim();
      if (!text) continue;
      const over = el.scrollWidth - el.clientWidth;
      if (over > 1)
        clippedButtons.push(`「${text.slice(0, 16)}」多 ${Math.round(over)}px`);
    }
    return {
      view,
      padLeft,
      padRight,
      clippedButtons: clippedButtons.slice(0, 6),
      misaligned: misaligned.slice(0, 8),
      misalignedCount: misaligned.length,
      flushHeads: flushHeads.slice(0, 6),
      flushHeadCount: flushHeads.length,
      minLeftGap: Math.round(minLeftGap * 10) / 10,
      minRightGap: Math.round(minRightGap * 10) / 10,
      leftCulprit,
      rightCulprit,
      stuck: stuck.slice(0, 6),
      stuckCount: stuck.length,
      overflow,
      wide: wide.slice(0, 4),
    };
  }, MIN_PAGE_GUTTER);
}

console.log("\n══ 逐分頁排版量測（1440px）══");
const perView = {};
for (const [id, label] of VIEWS) {
  if (!(await gotoView(label))) {
    console.log(`⚠️  找不到分頁按鈕：${label}`);
    continue;
  }
  const m = await measure();
  perView[id] = m;
  console.log(
    `\n【${label}】main 內距 L${m.padLeft}/R${m.padRight}｜` +
      `區塊最小左留白 ${m.minLeftGap}（${m.leftCulprit}）｜` +
      `最小右留白 ${m.minRightGap}（${m.rightCulprit}）｜` +
      `橫向溢出 ${m.overflow}｜貼邊文字 ${m.stuckCount} 處`,
  );
  ok(`${label}：主內容左緣沒有貼住視窗`, m.minLeftGap >= -0.6, `${m.minLeftGap}px`);
  ok(`${label}：主內容右緣沒有貼住視窗`, m.minRightGap >= -0.6, `${m.minRightGap}px`);
  ok(`${label}：整頁沒有橫向溢出`, m.overflow <= 1, `${m.overflow}px`);
  ok(
    `${label}：按鈕文字沒有被裁掉`,
    m.clippedButtons.length === 0,
    m.clippedButtons.join("；"),
  );
  ok(
    `${label}：卡片內沒有文字貼著邊框`,
    m.stuckCount === 0,
    m.stuck.map((s) => `${s.text}（距卡片左緣 ${s.gap}px，內距 ${s.cardPadLeft}px，卡片 ${s.card}）`).join("；"),
  );
  ok(
    `${label}：每張卡片的標題都有內距`,
    m.flushHeadCount === 0,
    m.flushHeads.map((h) => `${h.card}「${h.text}」距卡片左緣僅 ${h.gap}px`).join("；"),
  );
  ok(
    `${label}：卡片內表格／段落與標題左緣對齊`,
    m.misalignedCount === 0,
    m.misaligned
      .map(
        (s) =>
          `${s.card}｜卡片左緣 ${s.cardLeft}px｜「${s.text}」在 ${s.elLeft}px（+${s.elLeft - s.cardLeft}），標題在 ${s.headLeft}px（+${s.headLeft - s.cardLeft}）`,
      )
      .join("；"),
  );
  if (m.wide.length)
    console.log("   溢出元素：", m.wide.map((w) => `${w.el}@${w.right}`).join(", "));
}

console.log("\n══ 多寬度掃描（每個分頁只看溢出與左右留白）══");
for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 1000 });
  await page.waitForTimeout(250);
  const bad = [];
  for (const [, label] of VIEWS) {
    if (!(await gotoView(label))) continue;
    const m = await measure();
    /*
     * 溢出要一併講出「是哪一個元素」。
     * 只報 px 的話，下一個人得自己重跑一次瀏覽器才知道要改哪裡——
     * 我這次就重跑了一次。
     */
    if (m.overflow > 1)
      bad.push(
        `${label} 溢出 ${m.overflow}px` +
          (m.wide.length ? `（${m.wide.map((w) => `${w.el}@${w.right}`).join("、")}）` : ""),
      );
    if (m.clippedButtons.length)
      bad.push(`${label} 按鈕文字被裁 ${m.clippedButtons.length} 處（${m.clippedButtons[0]}）`);
    if (m.minLeftGap < -0.6) bad.push(`${label} 左貼邊 ${m.minLeftGap}px`);
    if (m.minRightGap < -0.6) bad.push(`${label} 右貼邊 ${m.minRightGap}px`);
    if (m.stuckCount > 0) bad.push(`${label} 文字貼卡片 ${m.stuckCount} 處`);
    if (m.flushHeadCount > 0)
      bad.push(`${label} 標題貼卡片邊 ${m.flushHeadCount} 處（${m.flushHeads[0]?.card}）`);
    if (m.misalignedCount > 0)
      bad.push(
        `${label} 卡內未對齊 ${m.misalignedCount} 處（${m.misaligned[0]?.card}「${m.misaligned[0]?.text}」少 ${-(m.misaligned[0]?.delta ?? 0)}px）`,
      );
  }
  ok(`寬度 ${width}px 全分頁乾淨`, bad.length === 0, bad.join("；"));
}

await page.setViewportSize({ width: 1440, height: 1000 });

console.log("\n══ 歷季趨勢比較 ══");
await gotoView("歷季趨勢比較");
await page
  .locator(".trend-controls select")
  .first()
  .selectOption({ label: "示範路－示範二路－示範三街路口" });
await page.waitForTimeout(500);
const trendText = await page.locator("main").innerText();
const hasChart = (await page.locator("#trend-svg").count()) > 0;
ok("站號換過的路口仍然畫得出折線圖", hasChart, hasChart ? "" : trendText.slice(0, 200));
ok(
  "有提示站號歷年變動",
  /站號歷年有變動/.test(trendText),
  trendText.match(/站號[^\n]{0,60}/)?.[0] || "（沒有提示）",
);
const pointCount = await page.locator("#trend-svg circle").count();
ok("折線圖畫出多季資料點", pointCount >= 16, `${pointCount} 個點`);
ok("季數統計有寫出「有資料 N 季」", /有資料\s*\d+\s*季/.test(trendText));

// 切到並存站號的路口
const intersectionSelect = page.locator(".trend-controls select").first();
const options = await intersectionSelect.locator("option").allTextContents();
const parallel = options.find((t) => /示範交流道匝道口/.test(t));
if (parallel) {
  await intersectionSelect.selectOption({ label: parallel });
  await page.waitForTimeout(500);
  const text2 = await page.locator("main").innerText();
  ok("並存站號的路口會出現站號選單", /站號/.test(text2) && (await page.locator(".trend-controls select").count()) >= 3);
  ok("並存站號有提示只呈現所選站號", /同一季同時有多個站號/.test(text2));
  const pts = await page.locator("#trend-svg circle").count();
  const labels = await page.locator("#trend-svg text.x-label").allTextContents();
  ok(
    "並存站號時同一季不會出現兩個點",
    new Set(labels).size === labels.length,
    labels.join(","),
  );
  console.log(`   （並存站號路口畫出 ${pts} 個點、${labels.length} 個季別標籤）`);
}

console.log("\n══ 主控台錯誤 ══");
ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 4).join(" / "));

/* ── 按鈕上的字要看得見 ── */
/*
 * 姊妹專案（交通服務水準）實際踩到的：按鈕裡的 <small> 被一條沒寫 color
 * 的規則塗成灰色，白底的按鈕看得到，深藍底的那顆對比只有 1.12:1——
 * 等於看不見。**只有其中一顆壞掉**，肉眼掃過去很容易漏掉，必須用量的。
 *
 * ⚠️ 假通過陷阱：只驗「字有沒有設 color」擋不住（設了灰色也是有設），
 * 只驗「按鈕上有文字」更擋不住。要**真的算對比度**：取元素的實際文字色
 * 與它背後那一層的實際背景色，照 WCAG 的相對亮度公式算，門檻 4.5:1。
 * 另外，沒有 active 的分頁是 display:none，量不到任何東西——所以要
 * 逐分頁走一遍，而且先驗「真的量到東西」，否則對比那一項會變成恆真。
 */
const contrastProbe = () => {
  const lum = (rgb) => {
    const parts = rgb.match(/[\d.]+/g).slice(0, 3).map(Number);
    const chan = parts.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
  };
  /* 往上找到第一個不透明的背景色——按鈕的字是畫在按鈕自己的底色上。 */
  const backdrop = (node) => {
    let cursor = node;
    while (cursor && cursor !== document.documentElement) {
      const bg = getComputedStyle(cursor).backgroundColor;
      const alpha = bg.match(/[\d.]+/g);
      if (bg && alpha && (alpha.length < 4 || Number(alpha[3]) > 0.9)) return bg;
      cursor = cursor.parentElement;
    }
    return "rgb(255,255,255)";
  };
  const out = [];
  for (const node of document.querySelectorAll(
    "button small, button b, button span",
  )) {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = getComputedStyle(node);
    const fg = lum(style.color);
    const bg = lum(backdrop(node));
    const ratio =
      (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    out.push({
      text: (node.textContent || "").trim().slice(0, 24),
      color: style.color,
      background: backdrop(node),
      ratio: Number(ratio.toFixed(2)),
    });
  }
  return out;
};
const contrast = [];
for (const [, label] of VIEWS) {
  if (!(await gotoView(label))) continue;
  contrast.push(...(await page.evaluate(contrastProbe)));
}
ok(
  "前置：要真的量到按鈕裡的補充文字（量不到的話下一項會變成恆真）",
  contrast.length > 0,
  `量到 ${contrast.length} 段`,
);
{
  const bad = contrast.filter((item) => item.ratio < 4.5);
  ok(
    "按鈕上的補充說明文字要看得清楚（與按鈕底色的對比 ≥ 4.5:1）",
    bad.length === 0,
    bad
      .map((item) => `「${item.text}」${item.ratio}:1（字 ${item.color}／底 ${item.background}）`)
      .join("；"),
  );
}

await browser.close();
server.close();

console.log(
  problems.length
    ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ")
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
