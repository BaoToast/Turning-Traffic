/*
 * 報告文字草稿的端對端檢查。
 *
 * 單元測試已經逐段驗過組字，這一支要驗的是「畫面接得對不對」：
 * 草稿的數字有沒有真的跟著匯出範圍走、各路口分項結果有沒有逐筆寫出、
 * 手改之後會不會被自動覆蓋、勾選改變時會不會即時反映。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { DRAFT_SECTION_ORDER } from "../lib/report-draft.ts";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "seed-state.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(8117);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
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
await page.goto("http://localhost:8117/");
await page.waitForTimeout(1200);

await page
  .locator('nav button:has-text("報表與批次輸出"), aside button:has-text("報表與批次輸出")')
  .first()
  .click();
await page.waitForTimeout(900);

const draft = page.locator('textarea[aria-label="報告文字草稿"]');
ok("報告文字草稿面板有出現", (await draft.count()) === 1);

const first = await draft.inputValue();
console.log("── 草稿前 900 字 ──\n" + first.slice(0, 900) + "\n──────────────");

ok("草稿有標題與範圍段落", /報告草稿/.test(first) && /本次分析範圍：/.test(first));
ok(
  "草稿寫明支線與車種是以哪一筆代表資料為準",
  /支線與車種的敘述以 .+ 為代表/.test(first),
);
ok("草稿有各路口分項結果", /各路口分項結果（/.test(first));
ok(
  "分項結果逐個路口、逐個尖峰列出",
  /【.+】/.test(first) &&
    /・上午尖峰（\d\d:\d\d–\d\d:\d\d）：路口轉向總量 [\d,.]+ PCU\/hr/.test(first) &&
    /・下午尖峰（\d\d:\d\d–\d\d:\d\d）：路口轉向總量 [\d,.]+ PCU\/hr/.test(first),
);
ok("分項結果會列出各支線的駛出／駛入", /各支線駛出／駛入：/.test(first));
ok(
  "算不出的全日尖峰明確寫成無法計算",
  /・全日尖峰小時（－）：無法計算。/.test(first),
);
ok(
  "報告草稿不會把算不出的全日尖峰寫成 0",
  !/全日尖峰小時（－）：路口轉向總量 0(?:\.0)? PCU\/hr/.test(first),
);
ok("草稿沒有出現 NaN 或 undefined", !/NaN|undefined|Infinity/.test(first));

// 每一段勾選都要能真的關掉那一段。
const chips = page.locator(".draft-section-chips .chip-check");
const chipCount = await chips.count();
// 期望值取自共用常數，這樣日後新增匯出項目時這支測試不必跟著改數字，
// 但畫面漏接一段時仍然會被抓到。
ok(
  "段落勾選數量與共用常數一致",
  chipCount === DRAFT_SECTION_ORDER.length,
  `畫面 ${chipCount} 個、常數 ${DRAFT_SECTION_ORDER.length} 個`,
);

await page.locator('.report-draft-head-actions button:has-text("全部不勾")').click();
await page.waitForTimeout(400);
const empty = await draft.inputValue();
ok(
  "全部不勾之後只剩標題與結尾提醒",
  !/本次分析範圍：/.test(empty) && !/各路口分項結果（/.test(empty) &&
    /正式引用前請核對/.test(empty),
);

await page.locator('.report-draft-head-actions button:has-text("全選")').click();
await page.waitForTimeout(400);
ok("全選之後段落回來", /各路口分項結果（/.test(await draft.inputValue()));

// 只勾「各路口分項結果」——使用者要的是「逐點總結」與「整體總結」互不綁定。
for (let index = 0; index < chipCount; index += 1) {
  const label = (await chips.nth(index).innerText()).trim();
  if (label !== "各路口分項結果")
    await chips.nth(index).locator("input").uncheck();
}
await page.waitForTimeout(400);
const onlySites = await draft.inputValue();
ok(
  "可以只要各路口分項結果，不含整體總結",
  /各路口分項結果（/.test(onlySites) && !/本次分析範圍：/.test(onlySites),
);

await page.locator('.report-draft-head-actions button:has-text("全選")').click();
await page.waitForTimeout(300);

// 手改之後不可以被自動覆蓋。
await draft.fill("我自己寫的內容");
await page.waitForTimeout(300);
await page.locator('.draft-section-chips .chip-check input').first().uncheck();
await page.waitForTimeout(400);
ok("手改之後改勾選不會覆蓋草稿", (await draft.inputValue()) === "我自己寫的內容");

await page.locator('.report-draft-actions button:has-text("重新產生")').click();
await page.waitForTimeout(400);
ok(
  "按重新產生會還原成系統版本",
  /各路口分項結果（/.test(await draft.inputValue()),
);

ok("全程無 JS 錯誤", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? "\n有問題：\n" + problems.join("\n") : "\n全部通過");
process.exit(problems.length ? 1 : 0);
