/*
 * ══════════════════════════════════════════════════════════════════════
 *  結論草稿產生器／批次輸出：「套用主工具列目前的條件」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 對這兩頁的裁示是**維持獨立**（不自動跟著主工具列跑），
 * 另加一顆「套用主工具列目前的條件」。理由很實際：報表常常要輸出一份
 * 和畫面上不同的範圍（畫面在看最新一季、報告要出全年）。
 *
 * ── 這一支為什麼要這樣驗 ─────────────────────────────────────
 *
 * ⚠️ 「獨立」和「按了會套用」要**一起驗**。
 *   只驗後者的話，一個「其實一直自動跟著主工具列」的實作也會全綠，
 *   而那正是使用者明確否決的行為。
 *
 * ⚠️ 按下去要**看得出真的變了**，不可以只看有沒有 toast。
 *   所以這裡量的是季度下拉的 value 與「符合條件 N 筆」。
 *
 * ⚠️ 路口那一項要特別小心：主工具列存的是**站號**，
 *   結論條件存的是 recordIntersectionKey。直接塞站號會篩出 0 筆，
 *   而畫面上看起來條件是設好的——所以這裡驗「筆數不可以變成 0」。
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

const wide = join(here, "seed-wide.json");
if (!existsSync(wide)) {
  console.error("找不到 scripts/seed-wide.json，先跑 make-wide-seed.mjs");
  process.exit(2);
}

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1700, height: 1100 },
  locale: "zh-TW",
});
const page = await context.newPage();
await page.addInitScript(
  (value) => localStorage.setItem("turning-traffic-state-v2", value),
  readFileSync(wide, "utf8"),
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

/* 先在主工具列拉一個明顯不同的區間，這樣「有沒有套用」才看得出來。 */
const quartersInList = await page.evaluate(() =>
  [
    ...document.querySelectorAll('[data-testid="mt-quarter-from"] option'),
  ].map((option) => option.value),
);
ok("前置：主工具列列得出多季", quartersInList.length >= 4, String(quartersInList.length));
const wantedFrom = quartersInList[1];
await page.selectOption('[data-testid="mt-quarter-from"]', wantedFrom);
await page.waitForTimeout(1000);
const mainTo = await page.inputValue('[data-testid="mt-quarter-to"]');

/* ══ ① 批次輸出（X-61 之前叫「報表與批次輸出」）══ */
ok("前置：切得到批次輸出", await gotoTab("批次輸出"));
const reportSelects = () =>
  page.evaluate(() => {
    const labels = [...document.querySelectorAll(".report-range label")];
    const pick = (text) =>
      labels
        .find((label) => (label.textContent || "").trim().startsWith(text))
        ?.querySelector("select")?.value || "";
    return { from: pick("起始季度"), to: pick("結束季度") };
  });
const beforeReport = await reportSelects();
ok(
  "① 這一頁**不自動**跟著主工具列（使用者明確要它獨立）",
  beforeReport.from !== wantedFrom || beforeReport.to !== mainTo,
  `報表現在是 ${beforeReport.from}～${beforeReport.to}，主工具列是 ${wantedFrom}～${mainTo}`,
);
const applyReport = page.locator('[data-testid="reports-apply-main"]');
ok("① 有「套用主工具列目前的條件」這一顆", (await applyReport.count()) === 1);
await applyReport.click();
await page.waitForTimeout(1000);
const afterReport = await reportSelects();
ok(
  "① 按下去之後，起訖季度真的變成主工具列那一組",
  afterReport.from === wantedFrom && afterReport.to === mainTo,
  `報表變成 ${afterReport.from}～${afterReport.to}`,
);

/* ══ ② 結論草稿產生器 ══ */
ok("前置：切得到結論草稿產生器", await gotoTab("結論草稿"));
const matchedCount = () =>
  page.evaluate(() => {
    const node = document.querySelector(".conclusion-count");
    const match = (node?.textContent || "").match(/(\d+)/);
    return match ? Number(match[1]) : -1;
  });
/*
 * ⚠️ 這幾顆 radio **沒有 value 屬性**（讀出來一律是 "on"）——
 *   第一版就是讀 value，兩次都是 "on"，比對永遠相等而紅字。
 *   要讀的是那一顆旁邊的文字。
 */
const scopeKind = () =>
  page.evaluate(() => {
    const label = [
      ...document.querySelectorAll(".conclusion-radios label"),
    ].find((item) => item.querySelector("input")?.checked);
    return (label?.textContent || "").trim();
  });
const beforeMatched = await matchedCount();
const beforeScope = await scopeKind();
ok("前置：量得到「符合條件 N 筆」", beforeMatched >= 0, String(beforeMatched));
const applyConclusion = page.locator('[data-testid="conclusion-apply-main"]');
ok(
  "② 有「套用主工具列目前的條件」這一顆",
  (await applyConclusion.count()) === 1,
);
await applyConclusion.click();
await page.waitForTimeout(1200);
const afterMatched = await matchedCount();
const afterScope = await scopeKind();
ok(
  "② 按下去之後統計範圍換成「季度區間」（主工具列的起≠迄）",
  afterScope === "季度區間",
  `現在是 ${afterScope}（按之前是 ${beforeScope}）`,
);
/*
 * ⚠️ 這一條是「站號 vs recordIntersectionKey」那個坑的守門。
 *   換算錯的話條件看起來設好了、筆數卻是 0。
 */
ok(
  "② 套用之後**不可以變成 0 筆**（站號沒換算成路口鍵的話就會變 0）",
  afterMatched > 0,
  `${beforeMatched} 筆 → ${afterMatched} 筆`,
);
const toast = await page.evaluate(
  () => document.body.innerText.match(/已套用主工具列：[^\n]*/)?.[0] || "",
);
ok(
  "② 要**說出套用了什麼**（默默改掉整組條件，使用者會以為是自己點錯）",
  toast.includes("季度"),
  toast || "（畫面上找不到那一句）",
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 兩頁都維持獨立，而且一鍵套得上主工具列的條件");
