/*
 * ══════════════════════════════════════════════════════════════════
 *  一個大分頁＝一個獨立畫面（使用者 2026-09-17，三支同步）
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者原話：
 *   「三個程式，是否能做到，一個大分頁本身就是一個界面，不要與其他大界面
 *     共用畫面呢？……點其中一個大分頁，右邊的畫面，就單純只有這個大分頁的內容，
 *     不要往下滾動畫面時，就會看到其它大分頁的內容。」
 *   「目前看來 路口轉向程式 是唯一 完美做到我說的這些格式的最佳範本」
 *
 * 這一支把「範本」變成**守門**：它不是驗某一頁長什麼樣，而是驗這條規則——
 *   **任何一個大分頁的畫面上，都不可以出現另一個大分頁的區塊。**
 *
 * ⚠️ 為什麼需要它：這條規則沒有人守的話，下一次有人為了方便把一塊搬過來，
 *   或是新增一塊時忘了包進 `{view === "…" && …}`，畫面就默默退回舊樣子，
 *   而所有既有的守門都還是綠的（它們驗的是那一塊自己對不對，
 *   不是它出現在哪一頁）。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**不可以只驗幾頁**。要掃側欄列得出來的**每一個**大分頁；
 *     漏掉一頁，那一頁就永遠沒有人守（這正是 e2e-nav-sections 註解裡
 *     記著的那個坑）。
 * 二、**錨點表要從畫面上長出來**，不可以手寫。手寫的清單會漂移，
 *     而漂移的症狀正好是「規則看起來還在、其實已經不管用」。
 * 三、**要確認真的收集到東西**。一頁都沒收到錨點的話，第二輪的
 *     交集永遠是空集合——整支恆真。所以先驗收集量。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
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

const server = await serve(8189);
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
page.on("dialog", (d) => d.accept());
await page.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 無痕時就算了，前置檢查會紅。 */
  }
}, seed);
await page.goto("http://127.0.0.1:8189/", { waitUntil: "networkidle" });
await page.waitForTimeout(1600);

/** 側欄上每一個大分頁的名字（分區標題與收合鈕不算）。 */
const tabs = await page.evaluate(() =>
  [...document.querySelectorAll("aside.sidebar nav button")]
    .filter(
      (button) =>
        !button.className.includes("nav-collapse") &&
        !button.className.includes("nav-group") &&
        !button.closest(".nav-sections"),
    )
    .map((button) => (button.textContent || "").replace(/\s+/g, "").trim())
    .filter(Boolean),
);
ok("前置：列得出側欄上的大分頁", tabs.length >= 10, `${tabs.length} 頁`);

const gotoTab = async (name) => {
  await page
    .locator(`aside.sidebar nav button:has-text("${name}")`)
    .first()
    .click();
  await page.waitForTimeout(900);
};

/*
 * ── 第一輪：逐頁記下「這一頁有哪些錨點」──────────────────────
 *   錨點＝側欄在這一頁底下列出來的小分頁所指的那些 id。
 *   ⚠️ 從 DOM 讀，不手寫。
 */
const anchorsOf = new Map();
for (const tab of tabs) {
  await gotoTab(tab);
  const anchors = await page.evaluate(() =>
    [...document.querySelectorAll("aside.sidebar nav .nav-sections button")]
      .map((button) => button.getAttribute("data-anchor") || "")
      .filter(Boolean),
  );
  anchorsOf.set(tab, anchors);
}
const total = [...anchorsOf.values()].reduce((sum, list) => sum + list.length, 0);
ok(
  "前置：收集得到各頁的小分頁錨點（收不到的話第二輪恆真）",
  total >= 12,
  `${total} 個錨點，分佈在 ${[...anchorsOf].filter(([, v]) => v.length).length} 頁`,
);

/*
 * ── 第二輪：站在每一頁上，別頁的錨點都不可以在畫面上 ─────────
 */
console.log("\n══ 每一頁只顯示自己的內容 ══");
for (const tab of tabs) {
  const mine = new Set(anchorsOf.get(tab) || []);
  const foreign = [];
  for (const [other, list] of anchorsOf) {
    if (other === tab) continue;
    for (const anchor of list) if (!mine.has(anchor)) foreign.push([other, anchor]);
  }
  if (!foreign.length) continue;
  await gotoTab(tab);
  const found = await page.evaluate(
    (ids) => ids.filter((id) => document.getElementById(id)),
    foreign.map(([, anchor]) => anchor),
  );
  const named = found.map((anchor) => {
    const owner = foreign.find((entry) => entry[1] === anchor);
    return `${anchor}（屬於「${owner ? owner[0] : "?"}」）`;
  });
  ok(
    `「${tab}」的畫面上沒有別的大分頁的區塊`,
    found.length === 0,
    named.join("、"),
  );
}

/*
 * ── X-61：批次輸出那一頁的版面（使用者指定）─────────────────
 *   「前4個都是窄的小卡形式，多計畫批次成果包是一個橫式大卡，
 *     所以4個在上，橫式在下的格式」
 * ⚠️ 量的是**實際位置與寬度**，不是 class 名稱——
 *   class 掛對了但格線沒生效的話，畫面仍然是錯的。
 */
console.log("\n══ X-61 批次輸出的版面 ══");
await gotoTab("批次輸出");
const layout = await page.evaluate(() => {
  const pick = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return { id, top: Math.round(box.top), width: Math.round(box.width) };
  };
  return ["report-xlsx", "report-pdf", "report-chart-png", "report-svg", "report-batch"]
    .map(pick)
    .filter(Boolean);
});
ok(
  "前置：五張卡都在這一頁上",
  layout.length === 5,
  layout.map((item) => item.id).join("、"),
);
if (layout.length === 5) {
  const narrow = layout.filter((item) => item.id !== "report-batch");
  const wide = layout.find((item) => item.id === "report-batch");
  ok(
    "X-61 四張窄卡在同一排（頂端對齊）",
    Math.max(...narrow.map((n) => n.top)) - Math.min(...narrow.map((n) => n.top)) <= 4,
    narrow.map((n) => `${n.id}=${n.top}`).join("、"),
  );
  ok(
    "X-61 橫式大卡在那四張的**下面**",
    wide.top > Math.max(...narrow.map((n) => n.top)),
    `橫式 ${wide.top} vs 窄卡 ${Math.max(...narrow.map((n) => n.top))}`,
  );
  ok(
    "X-61 橫式大卡真的比窄卡寬（只掛 class 不算）",
    wide.width > narrow[0].width * 2,
    `橫式 ${wide.width}px vs 窄卡 ${narrow[0].width}px`,
  );
}

/*
 * ⚠️ 拆開之後最危險的是那條看不見的相依：
 *   「這個計畫要匯出哪些分析結果」在成果交付那一頁，
 *   但它決定這一頁 Excel 與批次成果包的內容。
 *   所以兩張卡上都要有一顆**點得過去**的鈕——不是一句灰字。
 */
for (const testId of ["report-xlsx-items-link", "report-batch-items-link"]) {
  ok(
    `X-61 「${testId}」這顆跳到成果交付的鈕在畫面上`,
    (await page.locator(`[data-testid="${testId}"]`).count()) === 1,
  );
}
await page.locator('[data-testid="report-xlsx-items-link"]').click();
await page.waitForTimeout(900);
ok(
  "X-61 按下去真的換到「成果交付」，而且那排勾選就在眼前（不是一顆裝飾鈕）",
  (await page.locator("#report-items").count()) === 1 &&
    (await page.locator("#report-xlsx").count()) === 0,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 每一個大分頁都只顯示自己的內容；批次輸出的版面也照指定排");
