/*
 * ══════════════════════════════════════════════════════════════════════
 *  換分頁的捲動位置：第一次從最上面，回頭接著上次看
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「我在各路口尖峰彙總滑動畫面查看到最底下後，繼續點流量核對工作台，
 *     右側的畫面不是從最上方開始讓我查看，而是從中間開始，以至於我沒發現
 *     上方還有資料。」
 *
 * ⚠️ 這個 bug 的可怕之處在於它**看起來很正常**：
 *   新的一頁從中間開始顯示，畫面上照樣有標題、有表格，
 *   使用者不會意識到上面還有一整段沒看到。所以測試不能只看「有沒有捲動」，
 *   要**直接量 window.scrollY**。
 *
 * 釘三件事：
 *   ① 第一次進 B → scrollY 必須是 0
 *   ② 回到 A     → 必須回到離開 A 時的位置（不是 0）
 *   ③ 再進 B     → 停在 B 上次的位置（第二次就不是第一次了）
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { serve } = await import(pathToFileURL(join(HERE, "serve.mjs")).href);
const { launchOptions } = await import(
  pathToFileURL(join(HERE, "chrome-path.mjs")).href
);
const { installStateHelpers } = await import(
  pathToFileURL(join(HERE, "read-state.mjs")).href
);
const seed = readFileSync(join(HERE, "seed-state.json"), "utf8");

const problems = [];
const failOnly = (text) => ({ failOnly: text });
const ok = (label, condition, detail = "") => {
  const text =
    detail && typeof detail === "object"
      ? condition
        ? ""
        : detail.failOnly
      : detail;
  console.log(`${condition ? "✅" : "❌"} ${label}${text ? ` — ${text}` : ""}`);
  if (!condition) problems.push(label + (text ? ` — ${text}` : ""));
};

const server = await serve(8153);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  /* 視窗刻意矮一點，比較容易讓每一頁都捲得動。 */
  viewport: { width: 1500, height: 720 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());

await installStateHelpers(page);
await page.goto("http://localhost:8153/");
await page.waitForTimeout(900);
await page.evaluate(async (s) => {
  localStorage.clear();
  await window.__writeState(s);
}, seed);
await page.reload();
await page.waitForTimeout(1600);

const go = async (label) => {
  await page
    .locator(`nav > div > button:has-text("${label}")`)
    .first()
    .click();
  await page.waitForTimeout(700);
};
const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
const scrollable = () =>
  page.evaluate(
    () =>
      document.documentElement.scrollHeight -
      document.documentElement.clientHeight,
  );

/*
 * 挑使用者實際踩到的那兩頁。兩頁都要夠長，否則捲不動就測不到東西。
 */
const A = "各路口尖峰彙總";
const B = "流量核對工作台";

await go(A);
const roomA = await scrollable();
ok(
  `前置：「${A}」捲得動（不然這支測試測不到東西）`,
  roomA > 300,
  `可捲 ${roomA}px`,
);
const TARGET = Math.min(roomA, 900);
await page.evaluate((y) => window.scrollTo(0, y), TARGET);
await page.waitForTimeout(400);
const leftA = await scrollY();
ok(`前置：在「${A}」捲到 ${TARGET}px`, Math.abs(leftA - TARGET) <= 4, `實際 ${leftA}px`);

/* ── ① 第一次進 B ── */
await go(B);
const firstB = await scrollY();
ok(
  `① 第一次點進「${B}」，從最上面開始（這正是使用者踩到的那一下）`,
  firstB === 0,
  `scrollY = ${firstB}px（前一頁停在 ${leftA}px）`,
);
const roomB = await scrollable();
ok(`前置：「${B}」也捲得動`, roomB > 300, `可捲 ${roomB}px`);
const TARGET_B = Math.min(roomB, 500);
await page.evaluate((y) => window.scrollTo(0, y), TARGET_B);
await page.waitForTimeout(400);
const leftB = await scrollY();

/* ── ② 回到 A ── */
await go(A);
const backA = await scrollY();
ok(
  `② 回到「${A}」，停在上次中斷的地方（不是回到最上面）`,
  Math.abs(backA - leftA) <= 8,
  `回來是 ${backA}px，離開時是 ${leftA}px`,
);

/* ── ③ 再進 B ── */
await go(B);
const backB = await scrollY();
ok(
  `③ 第二次進「${B}」也停在上次的位置（第二次就不算第一次了）`,
  Math.abs(backB - leftB) <= 8,
  `回來是 ${backB}px，離開時是 ${leftB}px`,
);

/* ── ④ 第三頁：仍然要從最上面 ── */
const C = "車種組成分析";
await page.evaluate(() => window.scrollTo(0, 0));
await go(A);
await page.evaluate(() => window.scrollTo(0, 700));
await page.waitForTimeout(300);
await go(C);
const firstC = await scrollY();
ok(
  `④ 沒去過的「${C}」照樣從最上面開始（不是只有那兩頁被特別處理）`,
  firstC === 0,
  `scrollY = ${firstC}px`,
);

ok("整段沒有 JS 例外", errors.length === 0, failOnly(errors.slice(0, 3).join(" | ")));

await browser.close();
await server.close?.();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 第一次進分頁從最上面，回頭接著上次看");
