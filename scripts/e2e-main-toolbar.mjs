/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列的三態：鏡子／脫離／回歸，以及「不適用」的說明
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 裁示（三支程式共用同一套機制）：
 *   ①「圖可以自己改，但只影響那一張」
 *   ②「針對共同的篩選條件……圖表自身的工具列仍舊要與主工具列同步」
 *   ③「主工具列也多一個全部回歸鈕……避免有部分圖表忘記點選回歸」
 *   ④「有圖表不適用的條件，該圖表就單獨顯示不適用」
 *
 * ── 這一支為什麼要這樣驗 ─────────────────────────────────────
 *
 * ⚠️ ①和②要**一起驗**。只驗①的話，一個「圖上永遠顯示自己的預設值、
 *   根本不看主工具列」的實作也會全綠——而那正是使用者會抱怨
 *   「主工具列寫 115Q2、圖上還寫 115Q1」的情況。
 *
 * ⚠️ 驗「鏡子」不可以只比對下拉的 value。value 對了但畫面沒重算的話
 *   （圖還是舊的），使用者照樣會把錯的數字抄走。所以每一步都**連數字一起量**。
 *
 * ⚠️ 「全部回歸」要驗**全部**回去，不是回去一部分。
 *   只驗「按了之後沒有脫離的圖」不夠——那一顆鈕把 overrides 清成 {} 就會過，
 *   但如果某一張圖的條件是自己另存的（沒走 overrides），它會留在原地。
 *   所以要逐張確認回到主工具列的值。
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

/* ══ ⓪-2c 一開機時主工具列要是**收合**的（X-78）════════════════
 *
 * 使用者 2026-09-17：「重新載入或第一次開網頁時，主工具列是否能預設為
 *   收合狀態。下方版面比較清楚」——三支同步。
 *
 * ⚠️ 兩件事一起驗，缺一條都守不住：
 *   ① 那一排條件真的收起來了（量**實際高度**，不是只看 hidden 屬性——
 *      `display:flex` 的權重比瀏覽器內建的 `[hidden]{display:none}` 高，
 *      只驗屬性的話畫面明明還看得見也會全綠，這是 2026-09-15 實測過的坑）
 *   ② 收起來之後**仍然看得到目前的條件**。收合不可以把「現在依什麼在算」
 *      一起藏掉，那比佔版面更糟。只驗①的話，一個「收合＝什麼都不顯示」
 *      的實作也會全綠。
 */
{
  const state = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="main-toolbar"]');
    const row = bar?.querySelector(".main-toolbar-row");
    const summary = bar?.querySelector('[data-testid="mt-summary"]');
    const toggle = bar?.querySelector('[data-testid="mt-toggle"]');
    return {
      found: Boolean(bar),
      expanded: toggle?.getAttribute("aria-expanded"),
      rowHeight: row ? Math.round(row.getBoundingClientRect().height) : -1,
      summary: (summary?.textContent || "").replace(/\s+/g, " ").trim(),
    };
  });
  ok(
    "前置：主工具列在畫面上（不在的話下面兩條恆真）",
    state.found,
  );
  ok(
    "⚠️ ⓪-2c 一開機時主工具列是收合的（條件那一排高度為 0）",
    state.expanded === "false" && state.rowHeight <= 0,
    `aria-expanded=${state.expanded}／條件列高 ${state.rowHeight}px`,
  );
  ok(
    "⚠️ ⓪-2c 收合狀態下仍然看得到目前的條件（收合不可以把口徑一起藏掉）",
    state.summary.length >= 4,
    state.summary || "（收合列上什麼都沒寫）",
  );
}
/*
 * ⚠️ ⓪-2c 量完之後才可以展開——下面每一節都要動主工具列的欄位，
 *   收合狀態下 selectOption 會等到逾時（X-78 之後的新前提）。
 */
await ensureToolbarOpen(page);
await page.waitForTimeout(2200);

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
  await page.waitForTimeout(1100);
  return found;
};

/** 內容區的數字指紋（排除主工具列自己）。 */
const numbers = () =>
  page.evaluate(() => {
    const host = document.querySelector(".content") || document.body;
    /*
     * ⚠️ 脫離提示與不適用說明也要排除。
     *   那一行寫著「主工具列：115Q2・下午尖峰…」——裡面有數字，
     *   它一出現，指紋就變了。反面測試時「這一張的數字變了」因此
     *   **假通過**：實際上圖根本沒重算，變的只是那行提示。
     *   要量的是圖的數字，不是旁白。
     */
    const skip = [
      ...host.querySelectorAll(
        ".main-toolbar, .toolbar, .filters, .chart-detach-note, .chart-inapplicable",
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

/* ══ ⓪ 主工具列在每一頁都看得到 ══ */
const tabs = await page.evaluate(() =>
  [...document.querySelectorAll("aside nav > div > button")]
    .filter((button) => !button.className.includes("nav-collapse"))
    .map((button) => (button.textContent || "").replace(/\s+/g, "").trim()),
);
ok("前置⓪：列得出分頁", tabs.length >= 10, `${tabs.length} 頁`);
let missing = [];
for (const tab of tabs) {
  await gotoTab(tab);
  if ((await page.locator('[data-testid="main-toolbar"]').count()) === 0)
    missing.push(tab);
}
ok(
  "⓪ 主工具列在每一頁都看得到（條件散在各頁正是升級前的毛病）",
  missing.length === 0,
  missing.join("、"),
);

/* ══ ⓪-2 九個條件都在 ══ */
const CONTROLS = [
  ["mt-quarter-from", "季度（起）"],
  ["mt-quarter-to", "季度（迄）"],
  ["mt-intersections", "路口"],
  ["mt-peak", "尖峰時段"],
  ["mt-peak-rule", "尖峰時段判定方式"],
  ["mt-flow-view", "路口流量視角"],
  ["mt-day", "資料別"],
  ["mt-vehicle", "車種"],
  ["mt-movement", "轉向別"],
  ["mt-display", "顯示數值"],
];
const absent = [];
for (const [id, label] of CONTROLS)
  if ((await page.locator(`[data-testid="${id}"]`).count()) === 0)
    absent.push(label);
ok(
  "⓪-2 使用者指定的每一個條件都在主工具列上（少一個就是掉功能）",
  absent.length === 0,
  absent.join("、"),
);

/* ══ ⓪-2b 一開機就必須**真的**是預設狀態 ══════════════════════
 *
 * ⚠️ 這一條是 2026-09-17 踩到才補的，而且踩得很難看：
 *   甲案把「全部」從資料別選單拿掉、預設改成「平日＋假日並列」之後，
 *   `useState<DayChoice>("all")` 這一行沒跟著改。`<select value="all">`
 *   在選項裡找不到對應的 option，瀏覽器就顯示**第一項**（平日）——
 *   畫面寫著「平日」、狀態其實是 "all"，而且因為狀態不等於預設值，
 *   一開機就掛著一顆「恢復預設條件」（按下去畫面才真的變成並列）。
 *
 *   兩件事一起驗才守得住：
 *     ・每一格的值就是 DEFAULT_MAIN_FILTERS 裡的那一個
 *       （⚠️ 期望值要**從程式裡取**，寫死的話下次改預設又會重演）
 *     ・「恢復預設條件」那一顆不可以出現
 *   只驗後者的話，一個「永遠不顯示那顆鈕」的實作也會全綠。
 *   只驗前者的話，`value` 對、但 `mainAtDefault` 比錯欄位也會全綠。
 */
{
  const { DEFAULT_MAIN_FILTERS: D } = await import("../app/main-filters.ts");
  const wrong = [];
  for (const [id, field] of [
    ["mt-peak", "peak"],
    ["mt-peak-rule", "peakRule"],
    ["mt-flow-view", "flowView"],
    ["mt-day", "day"],
    ["mt-vehicle", "vehicle"],
    ["mt-movement", "movement"],
    ["mt-display", "display"],
  ]) {
    const value = await page.inputValue(`[data-testid="${id}"]`);
    if (value !== D[field]) wrong.push(`${id}=${value}（應為 ${D[field]}）`);
  }
  ok(
    "⚠️ ⓪-2b 一開機時每一格都等於程式裡的預設值",
    wrong.length === 0,
    wrong.join("、"),
  );
  ok(
    "⚠️ ⓪-2b 一開機時**不可以**出現「恢復預設條件」（沒動過卻叫人恢復＝那一格其實不是預設）",
    (await page.locator('[data-testid="mt-reset-main"]').count()) === 0,
  );
}

/* ⓪-3 尖峰時段必須是**五個**選項，含使用者追加的並列。 */
const peakOptions = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="mt-peak"] option')].map((o) =>
    o.textContent.replace(/（.*$/, "").trim(),
  ),
);
ok(
  "⓪-3 尖峰時段五個選項（含「上午＋下午並列」，少了會弄丟現有的 AM／PM 並列）",
  peakOptions.length === 5 && peakOptions.includes("上午＋下午並列"),
  peakOptions.join("／"),
);
const displayOptions = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="mt-display"] option')].map((o) =>
    o.textContent.trim(),
  ),
);
ok(
  "⓪-4 顯示數值五個選項（含兩種組合）",
  displayOptions.length === 5,
  displayOptions.join("／"),
);

/* ══ ① 鏡子：主工具列一改，圖上跟著變、數字也跟著變 ══ */
await gotoTab("車種組成");
const beforeMirror = await numbers();
ok("前置①：車種組成頁量得到數字", beforeMirror.length > 10);

await page.selectOption('[data-testid="mt-peak"]', "PM");
await page.waitForTimeout(1200);
const afterMirror = await numbers();
ok(
  "① 主工具列改成下午尖峰 → **車種組成的數字跟著變**（升級前它不跟）",
  afterMirror !== beforeMirror,
  afterMirror === beforeMirror ? "數字一模一樣＝沒有重算" : "已重算",
);
ok(
  "① 而且這時候**不該**出現「本圖使用自己的條件」（它還跟著主工具列）",
  (await page.locator('[data-testid="chart-detach-note"]').count()) === 0,
);

/* ══ ② 脫離：在這一頁改它自己的時段，只有這一張變 ══ */
const otherBefore = await (async () => {
  await gotoTab("轉向進階分析");
  const value = await numbers();
  await gotoTab("車種組成");
  return value;
})();
/*
 * ⚠️ 比較基準要在**點下去的前一刻**量，不可以沿用上面那一次。
 *   上面那一次是切走別頁之前量的；中間切走又切回來，
 *   畫面重繪本身就可能讓數字字串不同——那樣這一條會因為
 *   「換頁造成的差異」而變綠，而不是因為條件真的生效。
 *   （反面測試時就是它沒有跟著紅，我才發現量錯了東西。）
 */
const beforeDetachClick = await numbers();

await page.evaluate(() => {
  const buttons = [
    ...document.querySelectorAll(".page-head .head-buttons button"),
  ];
  const target = buttons.find((button) =>
    (button.textContent || "").includes("全調查時段"),
  );
  if (target) target.click();
});
await page.waitForTimeout(1200);
const detachedNumbers = await numbers();
ok(
  "② 在這一頁改它自己的條件 → 這一張的數字變了",
  detachedNumbers !== beforeDetachClick,
  detachedNumbers === beforeDetachClick ? "數字一模一樣＝那一下沒生效" : "",
);
ok(
  "② 而且出現「目前用本圖自己的條件」與回歸鈕",
  (await page.locator('[data-testid="chart-detach-note"]').count()) === 1 &&
    (await page.locator('[data-testid="chart-detach-reset"]').count()) === 1,
);
ok(
  "② 那一行要寫出**主工具列現在是什麼**（只寫「自訂」使用者得自己捲回去對照）",
  /主工具列：/.test(
    await page.locator('[data-testid="chart-detach-note"]').innerText(),
  ),
  await page.locator('[data-testid="chart-detach-note"]').innerText(),
);

await gotoTab("轉向進階分析");
ok(
  "② **別張完全不受影響**",
  (await numbers()) === otherBefore,
  (await numbers()) === otherBefore ? "" : "別張也跟著變了",
);

/* ② 主工具列再改 → 脫離的那張不動，別張跟著動 */
const otherBeforeSecond = await numbers();
await page.selectOption('[data-testid="mt-peak"]', "AM");
await page.waitForTimeout(1200);
ok(
  "② 主工具列再改一次，**沒脫離的那一張要跟著變**",
  (await numbers()) !== otherBeforeSecond,
);
await gotoTab("車種組成");
ok(
  "② 而**脫離的那一張不可以跟著變**",
  (await numbers()) === detachedNumbers,
  (await numbers()) === detachedNumbers ? "" : "脫離的圖被主工具列帶走了",
);

/* ══ ③ 單張回歸 ══ */
await page.locator('[data-testid="chart-detach-reset"]').click();
await page.waitForTimeout(1200);
/*
 * ⚠️ 這一條我第一版寫成「把右邊整串用 replace 換成左邊」——
 *   等號**永遠成立**，是一條恆真的守門，自己讀第二遍才發現。
 *   （順帶踩到第二個坑：把那段正規表示式抄進註解裡，
 *     裡面的斜線加星號直接把註解提前關掉，整支腳本語法錯誤。）
 *   現在比的是「回歸之後」與「同樣條件下、還沒脫離時」量到的那一份，
 *   兩者必須一模一樣。主工具列這時是上午尖峰，所以基準就是最初那一次量測。
 */
const mirrorAtAm = beforeMirror;
const afterReset = await numbers();
ok(
  "③ 按「回到主工具列條件」之後，數字回到跟著主工具列的那一份",
  afterReset === mirrorAtAm,
  afterReset === mirrorAtAm ? "" : "回歸之後的數字和「沒脫離時」不一樣",
);
ok(
  "③ 回歸之後那一條提示要消失（留著的話使用者以為還在脫離）",
  (await page.locator('[data-testid="chart-detach-note"]').count()) === 0,
);

/* ══ ④ 不適用：選了並列才出現，沒選不出現 ══ */
/*
 * ⚠️ 只數「條件式」的不適用說明。
 *
 *   有一種說明是**常駐**的（掛著 data-inapplicable-always="1"）：
 *   「這一塊跨路口並排、用的是本頁自己的時段設定」那一類——
 *   它與主工具列選了什麼無關，本來就該一直在。
 *   這一條原本連常駐的一起數，v2.1.75 拆頁之後這一頁多了一個常駐說明，
 *   於是前置永遠是紅的，而它守的「沒篩卻講話＝噪音」其實沒壞。
 */
const conditionalNotes = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="chart-inapplicable"]')].filter(
      (node) => node.getAttribute("data-inapplicable-always") !== "1",
    ).length,
  );
ok(
  "④ 前置：沒有選並列時，**不可以**出現條件式的不適用說明（那是噪音）",
  (await conditionalNotes()) === 0,
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="chart-inapplicable"]')]
      .filter((node) => node.getAttribute("data-inapplicable-always") !== "1")
      .map((n) => (n.textContent || "").replace(/\s+/g, "").slice(0, 60))
      .join(" ｜ "),
  ),
);
await page.selectOption('[data-testid="mt-peak"]', "AMPM");
await page.waitForTimeout(1200);
ok(
  "④ 選了「上午＋下午並列」之後，車種組成要寫明為什麼畫不出並列",
  (await page.locator('[data-testid="chart-inapplicable"]').count()) >= 1,
);
await page.selectOption('[data-testid="mt-peak"]', "AM");
await page.waitForTimeout(900);
ok(
  "④ 改回去之後那一句要收掉",
  (await conditionalNotes()) === 0,
);

/* ══ ⑤ 全部回歸 ══ */
ok(
  "⑤ 前置：沒有人脫離時，主工具列**不可以**出現「回歸全部」（按下去沒反應的鈕＝壞掉的鈕）",
  (await page.locator('[data-testid="mt-reset-all"]').count()) === 0,
);
await page.evaluate(() => {
  const buttons = [
    ...document.querySelectorAll(".page-head .head-buttons button"),
  ];
  const target = buttons.find((button) =>
    (button.textContent || "").includes("全調查時段"),
  );
  if (target) target.click();
});
await page.waitForTimeout(1000);
const resetAll = page.locator('[data-testid="mt-reset-all"]');
ok("⑤ 有圖脫離之後，「回歸全部」才出現", (await resetAll.count()) === 1);
ok(
  "⑤ 而且要寫出**有幾張**（使用者才知道按下去影響多少）",
  /\d+\s*張/.test(await resetAll.innerText()),
  await resetAll.innerText(),
);
await resetAll.click();
await page.waitForTimeout(1200);
ok(
  "⑤ 按下去之後全部回到主工具列，那一顆鈕自己也收掉",
  (await page.locator('[data-testid="mt-reset-all"]').count()) === 0 &&
    (await page.locator('[data-testid="chart-detach-note"]').count()) === 0,
);

/* ══ ⑥ 「恢復預設條件」（X-10，使用者 2026-09-16）══════════════
 *
 * ⚠️ 正反兩面都要守：
 *   ・條件是預設 → 那一顆**不可以**出現（主工具列要簡潔）
 *   ・條件動過　 → 出現，按了之後每一格回到預設
 *   ・按了它**不可以**動到脫離中的圖（那是「回歸全部」的事）
 *   只驗第二面的話，做成「永遠顯示」也會全綠。
 */
console.log("\n══ ⑥ 一鍵把主工具列的條件回到預設 ══");
ok(
  "⑥ 預設狀態下**不可以**出現「恢復預設條件」",
  (await page.locator('[data-testid="mt-reset-main"]').count()) === 0,
);
await page.selectOption('[data-testid="mt-day"]', "weekday");
await page.waitForTimeout(600);
await page.selectOption('[data-testid="mt-movement"]', "left");
await page.waitForTimeout(600);
/* 順便讓一張圖脫離，驗這一顆不會動到它。 */
await page.evaluate(() => {
  const buttons = [
    ...document.querySelectorAll(".page-head .head-buttons button"),
  ];
  const target = buttons.find((button) =>
    (button.textContent || "").includes("全調查時段"),
  );
  if (target) target.click();
});
await page.waitForTimeout(1000);
const detachedBefore = await page
  .locator('[data-testid="chart-detach-note"]')
  .count();
const resetMain = page.locator('[data-testid="mt-reset-main"]');
ok("⑥ 條件動過之後那一顆才出現", (await resetMain.count()) === 1);
await resetMain.click();
await page.waitForTimeout(1200);
/*
 * ⚠️ 資料別的預設值是 "side-by-side"（甲案，使用者 2026-09-16 裁示把「全部」
 *   拿掉、預設改成並列），**不是** "all"。這一條原本寫死 "all"，
 *   甲案之後就一直是紅的——而我在 2026-09-17 的交付說明裡寫了
 *   「路口轉向端對端全套全綠」，那句話是錯的（當時跑的是舊的建置產物）。
 *   期望值改成從 DEFAULT_MAIN_FILTERS 取，日後再改預設值就不會重演。
 */
const { DEFAULT_MAIN_FILTERS } = await import("../app/main-filters.ts");
ok(
  "⚠️ ⑥ 按下去之後每一格都回到預設（這裡驗資料別與轉向別）",
  (await page.inputValue('[data-testid="mt-day"]')) ===
    DEFAULT_MAIN_FILTERS.day &&
    (await page.inputValue('[data-testid="mt-movement"]')) ===
      DEFAULT_MAIN_FILTERS.movement,
  `資料別=${await page.inputValue('[data-testid="mt-day"]')}／轉向別=${await page.inputValue('[data-testid="mt-movement"]')}`,
);
ok(
  "⚠️ ⑥ 而且**不可以**動到脫離中的圖（那是「回歸全部」的事，兩顆不同事）",
  detachedBefore > 0 &&
    (await page.locator('[data-testid="chart-detach-note"]').count()) ===
      detachedBefore,
  `按之前 ${detachedBefore} 張 → 按之後 ${await page.locator('[data-testid="chart-detach-note"]').count()} 張`,
);
ok(
  "⑥ 回到預設之後那一顆又收起來",
  (await page.locator('[data-testid="mt-reset-main"]').count()) === 0,
);
await page.locator('[data-testid="mt-reset-all"]').click();
await page.waitForTimeout(1000);

/* ══ ⑦ 主工具列：固定在上方 ＋ 可收合（使用者 2026-09-15 指名） ══ */
{
  /*
   * 使用者的原話：「你當初是說會將主工具列固定在上方隨時可見，
   * 只是會做著展開的按鈕，避免版面佔用過大」。三件事都要驗：
   *   ① 固定在上方（position: sticky）
   *   ② 收得起來，而且**條件那一列真的不見了**
   *     ⚠️ 這一條最容易假通過：`display:flex` 的權重比瀏覽器內建的
   *       `[hidden]{display:none}` 高，所以只驗 hidden 屬性有沒有掛上的話，
   *       畫面明明還看得見也會全綠（2026-09-15 實測到的真實情況）。
   *       所以要量**實際高度**。
   *   ③ 收起來之後仍然看得到目前的條件（不然要確認「現在依什麼在算」就得先展開）
   */
  const sticky = await page.evaluate(() => {
    const node = document.querySelector('[data-testid="main-toolbar"]');
    return node ? getComputedStyle(node).position : "";
  });
  ok("⑦ 主工具列固定在上方（sticky）", sticky === "sticky", sticky);
  /*
   * ⚠️⚠️ 只驗 `position: sticky` 是**假綠**。
   *
   * 使用者 2026-09-15：「因為主工具列**不能常駐在畫面上方**，
   *   要改變條件很不方便」。CSS 寫了 sticky 不代表它真的黏得住：
   *   祖先只要有 overflow 就會讓 sticky 失效，而且**沒有任何錯誤訊息**；
   *   吸頂的表頭也可能把它蓋掉——那同樣是「看不到」。
   */
  /*
   * ⚠️ 要先確定**這一頁真的捲得動**，否則量到的「黏住」是假的
   *   （根本沒捲，當然還在原地）。內容不夠長時把視窗壓矮再量。
   */
  const viewportBefore = page.viewportSize();
  const canScroll = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  if (canScroll < 400)
    await page.setViewportSize({
      width: viewportBefore.width,
      height: 420,
    });
  await page.waitForTimeout(300);
  const stickTop = await page.evaluate(async () => {
    window.scrollTo(0, 2000);
    await new Promise((r) => setTimeout(r, 400));
    const node = document.querySelector('[data-testid="main-toolbar"]');
    if (!node) return { scrolled: window.scrollY, top: null };
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(
      Math.round(rect.left + rect.width / 2),
      Math.round(rect.top + 4),
    );
    return {
      scrolled: Math.round(window.scrollY),
      top: Math.round(rect.top),
      height: Math.round(rect.height),
      viewport: window.innerHeight,
      covered: !(hit && (node === hit || node.contains(hit))),
      coveredBy: hit ? hit.className || hit.tagName : "",
    };
  });
  ok(
    "⑦ 前置：頁面真的捲得動（捲不動的話下面兩條恆真）",
    stickTop.scrolled > 300,
    `scrollY=${stickTop.scrolled}`,
  );
  ok(
    "⚠️ ⑦ 捲到下面之後，主工具列**仍然黏在視窗上緣**（只驗 CSS 是 sticky 會假綠）",
    stickTop.top !== null &&
      stickTop.top >= 0 &&
      stickTop.top <= 120 &&
      stickTop.top + stickTop.height <= stickTop.viewport,
    `捲到 ${stickTop.scrolled}px 時，工具列上緣在 ${stickTop.top}px（高 ${stickTop.height}px、視窗 ${stickTop.viewport}px）`,
  );
  ok(
    "⚠️ ⑦ 而且沒有被別的吸頂元素蓋住（蓋住等於看不到，和沒有 sticky 一樣）",
    stickTop.top !== null && !stickTop.covered,
    stickTop.covered ? `被「${stickTop.coveredBy}」蓋住` : "沒有被蓋住",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize(viewportBefore);
  await page.waitForTimeout(300);

  const rowHeight = () =>
    page.evaluate(() => {
      const row = document.querySelector(".main-toolbar-row");
      return row ? Math.round(row.getBoundingClientRect().height) : -1;
    });
  const openHeight = await rowHeight();
  ok("⑦ 前置：展開時條件列有高度", openHeight > 20, `${openHeight}px`);

  await page.locator('[data-testid="mt-toggle"]').click();
  await page.waitForTimeout(500);
  const closedHeight = await rowHeight();
  ok(
    "⑦ 收起來之後條件列**實際上看不見了**（只驗 hidden 屬性會假通過）",
    closedHeight === 0,
    `${openHeight}px → ${closedHeight}px`,
  );
  const summary = await page
    .locator('[data-testid="mt-summary"]')
    .innerText()
    .catch(() => "");
  ok(
    "⑦ 收起來之後仍然看得到目前的條件",
    summary.trim().length > 0,
    summary.slice(0, 60),
  );
  await page.locator('[data-testid="mt-toggle"]').click();
  await page.waitForTimeout(500);
  ok(
    "⑦ 再按一次展開回來",
    (await rowHeight()) > 20,
    `${await rowHeight()}px`,
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 鏡子／脫離／回歸／全部回歸／不適用說明，五件事都對");
