/*
 * ══════════════════════════════════════════════════════════════════════
 *  車種組成：算不出來的路口要寫「－」，不可以寫 0
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-10 就講過一次：「車種分析分頁……因為沒有全日尖峰，
 * 我竟然可以點進去，點了之後顯示都是 0」。當時的修法是把「全調查時段尖峰」
 * 這個選項鎖起來（Segmented 的 disabledReason）。
 *
 * ⚠️ 但那個鎖是用 **current（整季全部路口）** 判斷的：
 *   只要整季裡**有一個**路口算得出全日尖峰，這個選項就開著。
 *   而底下 KPI 的數字是從 **selected（就那一個路口）** 算出來的。
 *   於是「整季有人算得出來、我現在看的這一個算不出來」時，
 *   選項是開的、數字是 0——同一個條件下 Excel 寫的是「－」。
 *   0 會被直接抄進報告，被讀成「真的沒有車」。
 *
 * 所以這支測試刻意造一個**混合**的季度：
 *   ・示範交流道路口 → 有 peaks.DAY（算得出來）
 *   ・示範一路口     → 沒有（算不出來）
 * 只有一種資料的季度測不到這個洞——鎖會整個關起來，永遠不會紅。
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

const seed = JSON.parse(readFileSync(join(HERE, "seed-state.json"), "utf8"));
/* 同一季裡：一個算得出全日尖峰、一個算不出來。 */
const QUARTER = "115Q2";
const quarterRecords = seed.records.filter((r) => r.quarter === QUARTER);
const WITH_DAY = quarterRecords.find((r) => r.station === "S01-01");
const WITHOUT_DAY = quarterRecords.find((r) => r.station === "S01-03");
WITH_DAY.peaks = {
  ...(WITH_DAY.peaks || {}),
  DAY: { start: "07:00", end: "08:00" },
};
if (WITHOUT_DAY.peaks) delete WITHOUT_DAY.peaks.DAY;

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

const server = await serve(8151);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());

await installStateHelpers(page);
await page.goto("http://localhost:8151/");
await page.waitForTimeout(900);
await page.evaluate(async (s) => {
  localStorage.clear();
  await window.__writeState(s);
}, JSON.stringify(seed));
await page.reload();
await page.waitForTimeout(1600);

await page
  .locator('nav button:has-text("車種組成分析"), aside button:has-text("車種組成分析")')
  .first()
  .click();
await page.waitForTimeout(900);

/* 統計範圍切到「全調查時段尖峰」。 */
const dayButton = page
  .locator('.head-buttons button:has-text("全調查時段尖峰")')
  .first();
ok("前置：找得到「全調查時段尖峰」這個統計範圍", (await dayButton.count()) > 0);
const disabled = await dayButton.isDisabled().catch(() => true);
ok(
  "前置：整季有人算得出來，所以「全調查時段尖峰」是可以點的（這正是漏洞的前提）",
  !disabled,
  failOnly("按鈕是鎖住的，這個季度造得不對，測不到東西"),
);
await dayButton.click();
await page.waitForTimeout(800);

/** 目前畫面上 KPI 的數值。 */
const kpiValues = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".composition-kpis .kpi, .composition-kpis > *")]
      .map((el) => ({
        label: el.querySelector("small, .kpi-label")?.textContent?.trim() || "",
        text: el.textContent.trim(),
      }))
      .filter((x) => x.text),
  );

const pickIntersection = async (name) => {
  /* ⚠️ 不能用 label:has-text("路口")——「資料季度」的選項文字裡就有「路口」
     兩個字（「115Q2（2 路口）」），has-text 會連祖先一起比，選到季度那一個。 */
  const select = page.locator(".diagram-toolbar select").nth(1);
  await select.selectOption({ label: name });
  await page.waitForTimeout(800);
};

/* ── ① 算不出來的那一個路口 ── */
console.log("\n══ ① 算不出全日尖峰的路口 ══");
await pickIntersection(WITHOUT_DAY.name);
const bad = await kpiValues();
ok("前置：KPI 卡片抓得到", bad.length > 0, `${bad.length} 張`);
ok(
  "⚠️ 算不出來的路口，KPI 寫「－」而不是 0",
  bad.length > 0 && bad.every((k) => k.text.includes("－")),
  bad.map((k) => k.text.replace(/\s+/g, " ")).join(" ｜ "),
);
ok(
  "⚠️ 而且畫面上完全沒有 0 或 0.0%（0 會被抄進報告）",
  bad.every((k) => !/(^|\s)0(\s|$)|0\.0%/.test(k.text)),
  bad.map((k) => k.text.replace(/\s+/g, " ")).join(" ｜ "),
);
const notice = await page
  .locator(".empty-inline")
  .filter({ hasText: "－" })
  .count();
ok("有一行字說明為什麼是「－」，不是默默留白", notice > 0);

/* ── ② 算得出來的那一個路口，不可以被連累 ── */
console.log("\n══ ② 算得出全日尖峰的路口 ══");
await pickIntersection(WITH_DAY.name);
const good = await kpiValues();
ok(
  "算得出來的路口照常顯示數字（修正沒有把好的那一邊也改成「－」）",
  good.length > 0 &&
    good.some((k) => /\d/.test(k.text)) &&
    good.every((k) => !k.text.includes("－")),
  good.map((k) => k.text.replace(/\s+/g, " ")).join(" ｜ "),
);

/* ── ③ 下面「各路口車種組成」整表也要逐列判斷 ── */
console.log("\n══ ③ 全部路口那一張表 ══");
const tableRows = await page.evaluate(() => {
  const head = [...document.querySelectorAll(".panel")].find((p) =>
    p.querySelector(".eyebrow")?.textContent?.includes("ALL INTERSECTIONS"),
  );
  if (!head) return null;
  return [...head.querySelectorAll("tbody tr")].map((tr) => ({
    station: tr.children[0]?.textContent?.trim() || "",
    cells: [...tr.children].slice(1).map((td) => td.textContent.trim()),
  }));
});
ok("前置：找得到「各路口車種組成」整表", Array.isArray(tableRows) && tableRows.length > 0);
if (tableRows) {
  const badRow = tableRows.find((r) => r.station.includes(WITHOUT_DAY.station));
  const goodRow = tableRows.find((r) => r.station.includes(WITH_DAY.station));
  ok(
    "⚠️ 表裡算不出來的那一列寫「－」（整季有人算得出來，不代表這一列算得出來）",
    Boolean(badRow) && badRow.cells.every((c) => c === "－"),
    badRow ? badRow.cells.join("｜") : "找不到那一列",
  );
  ok(
    "表裡算得出來的那一列照常有數字",
    Boolean(goodRow) && goodRow.cells.some((c) => /\d/.test(c)),
    goodRow ? goodRow.cells.join("｜") : "找不到那一列",
  );
}

ok("整段沒有 JS 例外", errors.length === 0, failOnly(errors.slice(0, 3).join(" | ")));

await browser.close();
await server.close?.();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 算不出來的路口一律「－」，算得出來的照常顯示");
