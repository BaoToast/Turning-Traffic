/*
 * ══════════════════════════════════════════════════════════════════════
 *  路口轉向圖與交通量圖卡：自己的工具列只影響自己
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：「圖自己的篩選只影響自己，不會影響到其他圖表」
 *（同一句話他在三次不同的訊息裡講過）。
 *
 * ── 升級前是相反的（實測） ───────────────────────────────────
 *
 * 路口轉向圖工具列上的「時段／藍框流量顯示／顯示／車種」動到的是
 * **全站共用的狀態**：在這一頁把時段切成下午，車種組成分析、
 * 轉向進階分析、歷季趨勢比較的數字全部跟著換，而那三頁上沒有任何字
 * 告訴使用者是誰換的。交通量圖卡預覽的三顆「只看駛入／只看駛出」也一樣。
 *
 * ── 這一支為什麼要這樣驗 ─────────────────────────────────────
 *
 * ⚠️ 「這一張變了」和「別張沒變」要**一起驗**。
 *   只驗前者的話，一個仍然改全域狀態的實作照樣全綠——那正是升級前的毛病。
 *
 * ⚠️ 還要驗**主工具列自己沒有被帶著跑**。
 *   在圖上改條件卻把主工具列的下拉也改掉的話，下一次主工具列一動，
 *   所有圖都會跟著跳到那個值，使用者完全不會知道發生了什麼。
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "github-pages-dist");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer((request, response) => {
  let path = join(
    root,
    decodeURIComponent(request.url.split("?")[0]).replace(/^\//, "") ||
      "index.html",
  );
  if (!existsSync(path)) path = join(root, "index.html");
  response.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1700, height: 1100 },
  locale: "zh-TW",
});
const page = await context.newPage();
await page.addInitScript(
  (value) => localStorage.setItem("turning-traffic-state-v2", value),
  readFileSync(join(here, "seed-state.json"), "utf8"),
);
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.dismiss());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2400);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

const gotoTab = async (nameFragment) => {
  const found = await page.evaluate((fragment) => {
    const list = [
      ...document.querySelectorAll("aside nav > div > button"),
    ].filter((button) => !button.className.includes("nav-collapse"));
    const target = list.find((button) =>
      (button.textContent || "").includes(fragment),
    );
    if (!target) return false;
    target.click();
    return true;
  }, nameFragment);
  await page.waitForTimeout(1200);
  return found;
};

/**
 * 內容區的數字指紋。
 *
 * ⚠️ 主工具列、各頁工具列、脫離提示與不適用說明都要排除——
 *   它們裡面也有數字（「115Q2」「2 張圖」），一出現指紋就變了，
 *   於是「圖的數字變了」會**假通過**：實際上變的只是旁白。
 */
const numbers = () =>
  page.evaluate(() => {
    const host = document.querySelector(".content") || document.body;
    const skip = [
      ...host.querySelectorAll(
        ".main-toolbar, .diagram-toolbar, .toolbar, .filters, .chart-detach-note, .chart-inapplicable",
      ),
    ];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let text = "";
    let node;
    while ((node = walker.nextNode()))
      if (!skip.some((element) => element.contains(node.parentElement)))
        text += " " + node.nodeValue;
    return (text.match(/-?\d[\d,]*\.?\d*/g) || [])
      .map((value) => value.replace(/,/g, ""))
      .join("|");
  });

/** 轉向圖 SVG 裡的數字（圖本身，不含右側摘要）。 */
const diagramNumbers = () =>
  page.evaluate(() => {
    const host = document.querySelector(".diagram-layout") || document.body;
    return ((host.textContent || "").match(/-?\d[\d,]*\.?\d*/g) || [])
      .map((value) => value.replace(/,/g, ""))
      .join("|");
  });

/* ══ ① 路口轉向圖：改自己的時段 ══ */
ok("前置：切得到路口轉向圖", await gotoTab("路口轉向圖"));
const mainPeakBefore = await page.inputValue('[data-testid="mt-peak"]');
const diagramBefore = await diagramNumbers();
ok("前置：轉向圖上量得到數字", diagramBefore.length > 10);
ok(
  "① 前置：還沒動過時，這一頁**不可以**出現脫離提示",
  (await page.locator('[data-testid="chart-detach-note"]').count()) === 0,
);

/* 別張（車種組成）的基準，在動手的前一刻量。 */
await gotoTab("車種組成");
const otherBefore = await numbers();
await gotoTab("路口轉向圖");

/*
 * 這一頁工具列上的「時段」。用 label 文字找，不用位置——
 * 工具列上的欄位順序改過好幾次。
 */
const pickOwnPeak = async (value) =>
  page.evaluate((wanted) => {
    const labels = [
      ...document.querySelectorAll(".diagram-toolbar label"),
    ].filter((label) => (label.textContent || "").trim().startsWith("時段"));
    const select = labels[0]?.querySelector("select");
    if (!select) return false;
    select.value = wanted;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, value);

ok("① 找得到這一頁自己的「時段」下拉", await pickOwnPeak("PM"));
await page.waitForTimeout(1400);
const diagramAfter = await diagramNumbers();
ok(
  "① 在這一頁改時段 → **轉向圖自己的數字變了**",
  diagramAfter !== diagramBefore,
  diagramAfter === diagramBefore ? "數字一模一樣＝那一下沒生效" : "",
);
ok(
  "① 出現脫離提示與回歸鈕",
  (await page.locator('[data-testid="chart-detach-note"]').count()) === 1 &&
    (await page.locator('[data-testid="chart-detach-reset"]').count()) === 1,
);
ok(
  "① **主工具列自己不可以被帶著跑**（被帶走的話，下次主工具列一動全部圖都跟著跳）",
  (await page.inputValue('[data-testid="mt-peak"]')) === mainPeakBefore,
  `主工具列現在是 ${await page.inputValue('[data-testid="mt-peak"]')}`,
);

await gotoTab("車種組成");
ok(
  "① **別張完全不受影響**（升級前它會跟著換，而且不會說）",
  (await numbers()) === otherBefore,
  (await numbers()) === otherBefore ? "" : "別張也跟著變了",
);

/* ② 主工具列再改 → 脫離的轉向圖不跟 */
await gotoTab("路口轉向圖");
const detachedNumbers = await diagramNumbers();
await page.selectOption('[data-testid="mt-peak"]', "DAY");
await page.waitForTimeout(1400);
ok(
  "② 主工具列改了，**脫離的轉向圖不可以跟著變**",
  (await diagramNumbers()) === detachedNumbers,
  (await diagramNumbers()) === detachedNumbers
    ? ""
    : "脫離的圖被主工具列帶走了",
);

/* ③ 回歸 */
await page.locator('[data-testid="chart-detach-reset"]').click();
await page.waitForTimeout(1400);
ok(
  "③ 按回歸之後，轉向圖回到跟著主工具列（此時主工具列是全日尖峰，所以不該還是 PM 那一份）",
  (await diagramNumbers()) !== detachedNumbers,
);
ok(
  "③ 回歸之後提示要消失",
  (await page.locator('[data-testid="chart-detach-note"]').count()) === 0,
);
await page.selectOption('[data-testid="mt-peak"]', mainPeakBefore);
await page.waitForTimeout(1400);
ok(
  "③ 主工具列切回原值之後，轉向圖回到最初那一份（證明回歸是真的回到主工具列，不是回到某個預設值）",
  (await diagramNumbers()) === diagramBefore,
  (await diagramNumbers()) === diagramBefore ? "" : "沒回到最初那一份",
);

/* ══ ④ 交通量圖卡的三顆流量鈕也只影響自己 ══ */
ok("前置：切得到道路與流向管理", await gotoTab("道路與流向管理"));
const openCard = await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((item) =>
    (item.textContent || "").includes("開啟圖卡排版預覽"),
  );
  if (!button) return false;
  button.click();
  return true;
});
await page.waitForTimeout(1500);
if (!openCard || (await page.locator("#geometry-card-preview").count()) === 0) {
  ok("④ 打得開交通量圖卡排版預覽", false, "找不到那一塊，後面幾條驗不了");
} else {
  const cardBefore = await page.evaluate(
    () =>
      document.querySelector(".geometry-card-preview-canvas")?.textContent ||
      "",
  );
  await page.evaluate(() => {
    const button = [
      ...document.querySelectorAll(".geometry-preview-switches button"),
    ].find((item) => (item.textContent || "").includes("只看駛入"));
    if (button) button.click();
  });
  await page.waitForTimeout(1300);
  const cardAfter = await page.evaluate(
    () =>
      document.querySelector(".geometry-card-preview-canvas")?.textContent ||
      "",
  );
  ok("④ 按「只看駛入」→ 圖卡自己變了", cardAfter !== cardBefore);
  ok(
    "④ 出現脫離提示",
    (await page.locator('[data-testid="chart-detach-note"]').count()) >= 1,
  );
  ok(
    "④ 主工具列的流量視角**沒有**被帶著跑",
    (await page.inputValue('[data-testid="mt-flow-view"]')) === "both",
    await page.inputValue('[data-testid="mt-flow-view"]'),
  );
  await gotoTab("路口轉向圖");
  ok(
    "④ 路口轉向圖**完全不受影響**（升級前按這三顆，轉向圖的藍框也跟著只剩駛入）",
    (await diagramNumbers()) === diagramBefore,
    (await diagramNumbers()) === diagramBefore ? "" : "轉向圖也跟著變了",
  );
  /* 全部回歸把兩張一起收回來。 */
  const resetAll = page.locator('[data-testid="mt-reset-all"]');
  ok("④ 主工具列上有「回歸全部」", (await resetAll.count()) === 1);
  if (await resetAll.count()) {
    await resetAll.click();
    await page.waitForTimeout(1300);
    ok(
      "④ 按下去之後全部收掉",
      (await page.locator('[data-testid="chart-detach-note"]').count()) === 0 &&
        (await page.locator('[data-testid="mt-reset-all"]').count()) === 0,
    );
  }
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 轉向圖與圖卡：自己的工具列只影響自己，主工具列不被帶走");
