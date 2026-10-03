/**
 * 版面碰撞的**通用**掃描：兩兩重疊、相鄰太近、貼邊
 *（#55，2026-09-30 新增；與另兩支同一套判準）
 *
 * 為什麼要「通用」而不是逐條寫：
 *
 *   這一類問題到今天為止都是**使用者自己看到才回報**，然後我針對那一處補一條守門
 *  （圖說與畫布重疊、側欄按鈕被推出畫面、按鈕文字被裁掉…）。
 *   針對性的守門只看得見「已經發生過的那一處」。
 *   使用者 2026-09-30 的原話：「**沒證據顯示漏過東西，不代表不會漏東西**」。
 *
 *   所以這一支不挑地方：**把畫面上每一塊、每一顆互動元素兩兩比一次**。
 *
 * ── 三條判準 ────────────────────────────────────────────────────
 *
 *   ① **兩兩重疊**：任兩個可見的面板，矩形不可以在兩個軸上同時交疊超過 2px。
 *      （2px 是抗鋸齒與邊框的容差，不是「差一點就算了」。）
 *   ② **相鄰太近**：同一列上兩顆可見的互動元素（按鈕／下拉／輸入框／連結），
 *      水平間距不可以 < 4px——那會讓人按錯，觸控裝置上尤其。
 *   ③ **貼邊**：可見的互動元素不可以距視窗左右邊緣 < 8px。
 *
 * ── ⚠️ 刻意迴避的假通過陷阱 ──────────────────────────────────────
 *
 *   一、**只驗一頁、一個寬度不算**。逐頁走過，而且在三個寬度各量一次
 *       （窄版才會出現的重疊，寬版上看不到）。
 *   二、**祖孫關係不算重疊**（面板裡面本來就有面板），只比**沒有包含關係**的兩塊。
 *   三、**刻意疊在上面的東西要排除**：視窗、彈出層、下拉選單、黏住的工具列——
 *       它們的職責就是疊在別的東西上面。排除清單寫死在下面，
 *       而且每一條都附理由；排除不是「看起來很吵就加進來」。
 *   五、**照實說這一支的界線**：重疊只比 `.panel`（這一支的區塊容器），
 *       所以用別的容器排的那幾頁（實測 page-quarter／page-settings／page-kpi
 *       的面板數是 0）在「重疊」這一條上沒有被驗到——它們的**互動元素**
 *       仍然逐顆驗了相鄰與貼邊（累計 417 顆）。
 *       這不是「大概沒問題」，是**寫下來的缺口**，要補就是把容器一起納入。
 *   四、**前置探針**：塞三個一定不合格的元素進畫面（互相重疊、間距 1px、貼邊 2px），
 *       三條判準都必須抓到它。抓不到的話那一條是恆綠的。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8274;
const seed = readFileSync(join(here, "seed-wide.json"), "utf8");

const problems = [];
const failOnly = (text) => ({ failOnly: text });
const ok = (label, condition, detail = "") => {
  const text =
    detail && typeof detail === "object" ? (condition ? "" : detail.failOnly) : detail;
  console.log(`${condition ? "✅" : "❌"} ${label}${text ? ` — ${text}` : ""}`);
  if (!condition) problems.push(label + (text ? ` — ${text}` : ""));
};

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1536, height: 950 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
page.on("dialog", (d) => d.accept());
/* 這一支用現成的種子資料灌進 localStorage（與 e2e-class-coverage 同一份）。 */
await page.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 無痕或封鎖時就算了，下面的前置檢查會紅。 */
  }
}, seed);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);

/**
 * 量目前這一頁的三條判準。
 *
 * ⚠️ 整段在瀏覽器裡跑：判準要看的是**算繪之後**的矩形，
 *   不是原始碼上的推測。
 */
const scan = () =>
  page.evaluate(() => {
    /*
     * 刻意疊在別的東西上面的，排除。每一條都附理由——
     * 排除清單是這一支唯一的漏洞來源，不可以無理由地加東西進來。
     */
    const STACKED = [
      ".modal-backdrop", // 對話框：職責就是蓋住整個畫面
      ".modal", // 同上
      ".popover", // 彈出層：貼在觸發元素旁邊
      ".col-filter-menu", // 表頭漏斗展開後的選單
      "aside", // 側欄是固定定位，與內容區各自一層
      ".main-toolbar", // 主工具列是黏住的
      ".sticky-actions", // 視窗底部黏住的動作列
      ".toast", // 暫時提示層：刻意覆在內容上，不是文件流控制項
      "[hidden]",
    ];
    const stacked = (node) => STACKED.some((selector) => node.closest(selector));
    const visible = (node) => {
      if (!node.getClientRects().length) return false;
      // Closed details may retain layout rectangles in Chromium; only its summary is displayed.
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (parent.tagName === "DETAILS" && !parent.open) {
          const summary = [...parent.children].find((child) => child.tagName === "SUMMARY");
          if (!summary?.contains(node)) return false;
        }
      }
      const style = getComputedStyle(node);
      const box = boxOf(node);
      return style.visibility !== "hidden" && style.opacity !== "0" && box.width > 0 && box.height > 0;
    };
    const boxOf = (node) => {
      const rect = node.getBoundingClientRect();
      let { left, right, top, bottom } = rect;
      // Compare the actually displayed portions inside scroll/clip containers, not hidden rows.
      // Do not clip to the viewport: this scan intentionally includes off-screen document content.
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX)) {
          left = Math.max(left, bounds.left + parent.clientLeft);
          right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth);
        }
        if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)) {
          top = Math.max(top, bounds.top + parent.clientTop);
          bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
        }
      }
      return {
        left, right, top, bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      };
    };
    const label = (node) =>
      `<${node.tagName.toLowerCase()}${
        node.id ? "#" + node.id : node.className && typeof node.className === "string" ? "." + node.className.split(" ")[0] : ""
      }>「${(node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 14)}」`;

    /* ── ① 兩兩重疊：面板 ── */
    const panels = [...document.querySelectorAll(".panel")].filter(
      (node) => visible(node) && !stacked(node) && node.getBoundingClientRect().height > 8,
    );
    const overlaps = [];
    for (let i = 0; i < panels.length; i += 1)
      for (let j = i + 1; j < panels.length; j += 1) {
        const a = panels[i];
        const b = panels[j];
        /* 祖孫關係不算：面板裡面本來就可以有面板。 */
        if (a.contains(b) || b.contains(a)) continue;
        const ra = boxOf(a);
        const rb = boxOf(b);
        const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (overlapX > 2 && overlapY > 2)
          overlaps.push(
            `${label(a)} 與 ${label(b)} 重疊 ${Math.round(overlapX)}×${Math.round(overlapY)}px`,
          );
      }

    /* ── ②③ 互動元素：相鄰太近、貼邊 ── */
    const controls = [
      ...document.querySelectorAll("button, select, input, a[href], textarea"),
    ].filter((node) => {
      if (!visible(node) || stacked(node)) return false;
      const rect = node.getBoundingClientRect();
      /* 藏起來的檔案輸入框（1px）不算互動元素。 */
      return rect.width > 4 && rect.height > 4;
    });
    const tooClose = [];
    for (let i = 0; i < controls.length; i += 1)
      for (let j = i + 1; j < controls.length; j += 1) {
        const a = controls[i];
        const b = controls[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = boxOf(a);
        const rb = boxOf(b);
        /* 垂直上要有重疊才算「同一列」。 */
        const sameRow =
          Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 4;
        if (!sameRow) continue;
        /*
         * ⚠️ 分段切換器（.segmented）裡的兩顆**是同一個控制項的兩段**，
         *   不是兩顆相鄰的按鈕：它們共用一條底軌，目前選中的那一段用白色
         *   填滿表示（`.segmented{background:#eef3f6;padding:3px}`＋
         *   `.segmented button.active{background:#fff}`）。
         *   中間留 4px 縫反而會讓它看起來像兩顆分開的鈕。
         *
         * ⚠️ 排除的**判準是「同一個 .segmented 裡面」**，不是「class 叫 segmented 就跳過」：
         *   分段切換器與它旁邊的別的按鈕之間，那 4px 照樣要驗。
         */
        const groupA = a.closest(".segmented");
        if (groupA && groupA === b.closest(".segmented")) continue;
        const gap = ra.left < rb.left ? rb.left - ra.right : ra.left - rb.right;
        if (gap < 4)
          tooClose.push(`${label(a)} 與 ${label(b)} 只隔 ${gap.toFixed(1)}px`);
      }
    const hugging = [];
    const width = document.documentElement.clientWidth;
    for (const node of controls) {
      const rect = boxOf(node);
      if (rect.left < 8) hugging.push(`${label(node)} 距左邊 ${rect.left.toFixed(1)}px`);
      if (width - rect.right < 8)
        hugging.push(`${label(node)} 距右邊 ${(width - rect.right).toFixed(1)}px`);
    }
    return {
      overlaps,
      tooClose,
      hugging,
      panelCount: panels.length,
      controlCount: controls.length,
    };
  });

console.log("\n══ 前置：三條判準都真的抓得到 ══");
await page.evaluate(() => {
  const host = document.createElement("div");
  host.id = "zz-collide-probe";
  host.style.position = "relative";
  host.innerHTML =
    '<div class="panel" style="position:absolute;left:40px;top:0;width:200px;height:60px">探針甲</div>' +
    '<div class="panel" style="position:absolute;left:60px;top:10px;width:200px;height:60px">探針乙</div>' +
    '<div style="position:absolute;left:40px;top:80px"><button>探針丙</button><button>探針丁</button></div>' +
    '<button style="position:absolute;left:2px;top:150px">探針戊</button>' +
    '<button style="position:absolute;left:40px;top:230px;width:100px">重疊探針甲</button>' +
    '<button style="position:absolute;left:60px;top:230px;width:100px">重疊探針乙</button>' +
    '<details><summary>收合探針</summary><button style="position:absolute;left:40px;top:310px;width:100px">隱藏探針甲</button><button style="position:absolute;left:60px;top:310px;width:100px">隱藏探針乙</button></details>';
  document.body.appendChild(host);
});
await page.waitForTimeout(300);
const probe = await scan();
ok("② 重疊的互動元素也必須抓到", probe.tooClose.some((item) =>
  item.includes("重疊探針甲") && item.includes("重疊探針乙")));
ok("收合區塊內未顯示的控制項不誤報", !probe.tooClose.some((item) => item.includes("隱藏探針")));
ok(
  "① 重疊判準抓得到刻意重疊的兩塊",
  probe.overlaps.some((item) => item.includes("探針")),
  failOnly(`抓到的是：${probe.overlaps.join("／") || "（什麼都沒抓到）"}`),
);
ok(
  "② 相鄰判準抓得到間距 0px 的兩顆按鈕",
  probe.tooClose.some((item) => item.includes("探針")),
  failOnly(`抓到的是：${probe.tooClose.join("／") || "（什麼都沒抓到）"}`),
);
ok(
  "③ 貼邊判準抓得到距左邊 2px 的按鈕",
  probe.hugging.some((item) => item.includes("探針")),
  failOnly(`抓到的是：${probe.hugging.join("／") || "（什麼都沒抓到）"}`),
);
await page.evaluate(() => document.getElementById("zz-collide-probe")?.remove());
await page.waitForTimeout(200);

/*
 * 側欄上實際存在的分頁，全部走一遍。
 * ⚠️ 收合鈕（.nav-collapse）也是 nav button，混進清單會被當成一頁去點，
 *   而點下去只是把小分頁收起來（e2e-class-coverage 註解裡記著這個坑）。
 */
const pageIds = await page.evaluate(() =>
  [...document.querySelectorAll("nav button:not(.nav-collapse):not(.nav-section)")]
    .map((node) => [...node.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent).join("").trim())
    .filter(Boolean),
);
ok(
  "前置：側欄找得到分頁（找不到的話下面只驗了一頁）",
  pageIds.length >= 10,
  `${pageIds.length} 個獨立分頁（不把頁內區塊跳轉重複計數）`,
);

const WIDTHS = [1536, 1180, 900];
let visited = 0;
let panelsSeen = 0;
let controlsSeen = 0;
for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 1000 });
  await page.waitForTimeout(500);
  console.log(`\n══ 寬度 ${width}px ══`);
  for (const [index, pageId] of pageIds.entries()) {
    // Badge counts can change after navigation; use the stable main-nav order, not stale text.
    const navButton = page.locator("nav button:not(.nav-collapse):not(.nav-section)").nth(index);
    await navButton.click();
    if (!(await navButton.evaluate((node) => node.classList.contains("active"))))
      throw new Error(`未切換至預期分頁：${pageId}`);
    await page.waitForTimeout(600);
    const found = await scan();
    visited += 1;
    panelsSeen += found.panelCount;
    controlsSeen += found.controlCount;
    const issues = [
      ...found.overlaps.map((item) => `重疊：${item}`),
      ...found.tooClose.map((item) => `太近：${item}`),
      ...found.hugging.map((item) => `貼邊：${item}`),
    ];
    if (issues.length)
      ok(`${width}px／${pageId}`, false, "\n     ・" + issues.join("\n     ・"));
    else
      console.log(
        `   ✅ ${pageId}：${found.panelCount} 塊面板、${found.controlCount} 顆互動元素，沒有碰撞`,
      );
  }
}

console.log("\n══ 結果 ══");
ok("真的走過每一個分頁 × 每一個寬度", visited === pageIds.length * WIDTHS.length, `${visited} 次`);
/*
 * ⚠️ 這兩個下限是防「掃描器選不到東西」：選擇器壞掉時三條判準都是空的，
 *   整支會變成綠的——而那時候它什麼都沒在看。
 */
ok("真的量到足夠多的面板", panelsSeen >= 30, `累計 ${panelsSeen} 塊`);
ok("真的量到足夠多的互動元素", controlsSeen >= 100, `累計 ${controlsSeen} 顆`);
ok("過程中沒有 JS 例外", errors.length === 0, failOnly(errors.slice(0, 3).join(" / ")));

await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過`);
  process.exit(1);
}
console.log("\n✅ 全部通過");
