/*
 * ══════════════════════════════════════════════════════════════════════
 *  試用版（單一 .html）真的打得開、真的能用
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 「建出來了」不等於「打得開」。試用版是用 file:// 直接開的，
 *   與端對端測試用的 http:// 不是同一個環境：
 *     ・任何沒內嵌乾淨的外部檔案，在 file:// 下會靜靜地載入失敗，
 *       畫面照樣長出來，只是某個功能默默沒反應
 *     ・部分瀏覽器 API 在 file:// 下行為不同
 *   所以一定要用**產出的那一個檔案**、用 file:// 開、真的操作一遍。
 *
 * 這支驗四件事：
 *   ① 打得開、沒有 JS 例外、沒有載入失敗的請求
 *   ② 版號就是這一版（不是拿到舊檔案還以為是新的）
 *   ③ 轉向圖畫得出來，而且圖上有**不是 0** 的數字
 *   ④ 這一版新做的東西真的在（計畫可修改、備份三張卡與側欄三個名稱）
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";
import { VERSION as SYSTEM_VERSION } from "../lib/traffic.ts";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(
  here,
  "..",
  "..",
  "out",
  `路口轉向_試用版_${SYSTEM_VERSION}.html`,
);
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

ok(`前置：試用版檔案存在（${SYSTEM_VERSION}）`, existsSync(file), file);
if (!existsSync(file)) process.exit(1);

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
const failedRequests = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("requestfailed", (r) => {
  if (/\.(js|css|json)(\?|$)/.test(r.url())) failedRequests.push(r.url());
});
page.on("dialog", (d) => d.accept());

await page.goto(pathToFileURL(file).href);
await page.waitForTimeout(2500);

/* ── ① 打得開 ── */
const shell = await page.evaluate(() => ({
  title: document.title,
  hasShell: Boolean(document.querySelector(".app-shell")),
  hasSidebar: Boolean(document.querySelector(".sidebar nav")),
  navCount: document.querySelectorAll(".sidebar nav button").length,
}));
ok(
  "用 file:// 開得起來，主畫面有長出來",
  shell.hasShell && shell.hasSidebar,
  shell.title,
);
ok("側欄的分頁都在", shell.navCount >= 15, `${shell.navCount} 顆`);
ok("沒有任何 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));
ok(
  "沒有載入失敗的 JS／CSS（＝內嵌是乾淨的）",
  failedRequests.length === 0,
  failedRequests.slice(0, 3).join(" | "),
);

/* ── ② 版號 ── */
const shown = await page.evaluate(() => document.body.textContent || "");
ok(
  `畫面上顯示的版號就是 ${SYSTEM_VERSION}`,
  shown.includes(SYSTEM_VERSION),
  /v2\.1\.\d+/.exec(shown)?.[0] || "找不到版號",
);

/*
 * ── ③ 核心流程：用種子資料開起來，圖真的畫得出來 ──
 *
 * ⚠️ 種子要走 __writeState（資料存在 IndexedDB）。
 *   只寫 localStorage 的話，程式開機看到 IndexedDB 已經有東西
 *  （第一次載入時存檔 effect 寫進去的空白狀態）就不會理它。
 */
await installStateHelpers(page);
await page.reload();
await page.waitForTimeout(1200);
await page.evaluate(async (seed) => {
  localStorage.clear();
  await window.__writeState(seed);
}, readFileSync(join(here, "seed-state.json"), "utf8"));
await page.reload();
await page.waitForTimeout(1800);

await page
  .locator('nav button:has-text("路口轉向圖"), aside button:has-text("路口轉向圖")')
  .first()
  .click();
await page.waitForTimeout(1200);
const diagram = await page.evaluate(() => {
  const svg = document.querySelector(".diagram-canvas svg");
  const junction = document.querySelector(".diagram-canvas rect.junction");
  return {
    hasSvg: Boolean(svg),
    cards: document.querySelectorAll(".diagram-canvas [data-card-id]").length,
    junctionW: junction ? Math.round(junction.getBoundingClientRect().width) : 0,
    values: [...document.querySelectorAll(".diagram-canvas .value")]
      .map((el) => (el.textContent || "").trim())
      .filter((t) => /[1-9]/.test(t)).length,
  };
});
ok("轉向圖畫得出來", diagram.hasSvg && diagram.cards > 0, `${diagram.cards} 張圖卡`);
/*
 * ⚠️ 一定要驗「圖上有不是 0 的數字」。
 *   資料沒讀進來時圖照樣畫得出來，只是每一格都是 0——只驗「有圖」會全綠。
 */
ok(
  "圖上真的有流量數字（不是一片 0）",
  diagram.values > 0,
  `${diagram.values} 個非零數值`,
);
ok(
  "中央路口方塊畫得出來（顯示比例那一版改動沒有把圖弄壞）",
  diagram.junctionW > 50,
  `${diagram.junctionW}px`,
);

/* ── ④ 這一版新做的東西 ── */
await page
  .locator('nav button:has-text("建立與管理計畫"), aside button:has-text("建立與管理計畫")')
  .first()
  .click();
await page.waitForTimeout(800);
const edit = await page.evaluate(() => ({
  rows: document.querySelectorAll(".project-row").length,
  editButtons: document.querySelectorAll(".project-row .project-edit").length,
}));
ok(
  "計畫清單每一列都有「修改」（本支原本完全沒有這個功能）",
  edit.rows > 0 && edit.editButtons === edit.rows,
  `${edit.editButtons}/${edit.rows} 列`,
);

await page
  .locator('nav button:has-text("備份與還原"), aside button:has-text("備份與還原")')
  .first()
  .click();
await page.waitForTimeout(800);
const backup = await page.evaluate(() => ({
  sections: [...document.querySelectorAll(".nav-sections .nav-section")].map(
    (el) => (el.textContent || "").trim(),
  ),
  cards: ["backup-one", "backup-all", "backup-restore", "clear-local"].filter(
    (id) => document.getElementById(id),
  ),
}));
/*
 * ⚠️ 這裡驗的是「這幾個名稱在不在」，**不是「剛好幾個」**。
 *   v2.1.68 依使用者指定在底下加了「清除本機資料」（三支同步），
 *   寫死 length === 3 的話，合法的新增會讓試用版守門變紅，
 *   而下一個人最省事的修法就是把數字改大——那條線就此失去意義。
 */
for (const label of [
  "備份本計畫",
  "備份全部計畫",
  "還原計畫",
  "清除本機資料",
])
  ok(
    `側欄的備份與還原底下列得出「${label}」`,
    backup.sections.includes(label),
    backup.sections.join("、"),
  );
ok(
  "四張卡片都在（三張備份 ＋ 清除本機資料）",
  backup.cards.length === 4,
  backup.cards.join("、"),
);

await page.locator('.nav-section[data-goto-item="還原計畫"]').first().click();
await page.waitForTimeout(700);
const focused = await page.evaluate(() => {
  const el = document.querySelector(".is-focused");
  if (!el) return null;
  return {
    id: el.id,
    outline: parseFloat(getComputedStyle(el).outlineWidth || "0"),
  };
});
ok(
  "點「還原計畫」會把那一張卡片框起來，而且框真的畫得出來",
  Boolean(focused) && focused.id === "backup-restore" && focused.outline > 0,
  focused ? `#${focused.id} 外框 ${focused.outline}px` : "沒有任何區塊被點名",
);

ok("整段沒有累積 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log(`\n✅ 試用版 ${SYSTEM_VERSION} 用 file:// 開得起來，核心流程走得完`);
