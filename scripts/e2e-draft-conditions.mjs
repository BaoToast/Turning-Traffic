/*
 * ══════════════════════════════════════════════════════════════════════
 *  兩個草稿產生器：條件要齊、口徑要寫出來、小數位數要跟著走
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「主工具列的篩選條件及各圖表各自的篩選條件，都要在結論草稿產生器及
 *     報表草稿產生器的篩選條件中，這樣使用者才能自定義出題。
 *     針對不適用某些篩選條件的結果，在產生草稿時，可以直接說
 *     **該數值不適用 XXX 條件**。
 *     草稿的數值正確性、小數點位設定（曾踩過的雷）都要確保正確。」
 *
 * ── 這一支守什麼 ────────────────────────────────────────────────
 *
 * ① **結論草稿要有「轉向別」與「車種」**。主工具列有這兩項，草稿以前完全沒有，
 *    使用者沒辦法出「只看左轉」「只看大型車」這種題目。
 * ② 換了那兩個條件，草稿的**數字真的要跟著換**。只驗「下拉列得出選項」是假綠。
 * ③ **報告文字草稿要寫出統計條件**。「尖峰時段判定方式」與「轉向別」
 *    **本來就一路在改寫每一個數字**（viewRecord），而舊版一個字都沒寫——
 *    這段文字會被整段貼進報告，報告上看不到畫面。
 * ④ 判定方式為「各方向各自認定」時，草稿要明講**不可以相加**：
 *    各支線的尖峰不在同一小時，而草稿裡的「各支線駛出合計」正是把它們加起來。
 * ⑤ **小數位數**：兩份草稿都要有，0／1／2 都要真的變，**百分比也要跟著變**。
 * ⑥ 結論草稿要**照實寫出**用的是哪一種尖峰時段判定方式，不可以安靜忽略。
 *    （2026-09-23 之前這一條寫的是「草稿做不到，要明講不適用」——
 *      那個限制已經解除，見下面那一段的說明。）
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "seed-wide.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(8188);
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
page.on("dialog", (d) => d.accept());
await page.addInitScript((s) => {
  if (!localStorage.getItem("turning-traffic-state-v2"))
    localStorage.setItem("turning-traffic-state-v2", s);
}, seed);
await installStateHelpers(page);
await page.goto("http://localhost:8188/");
await page.waitForTimeout(1400);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

const go = async (label) => {
  await page
    .locator(
      `nav button:has-text("${label}"), aside button:has-text("${label}")`,
    )
    .first()
    .click();
  await page.waitForTimeout(800);
};

/* ══ 一、結論草稿：轉向別與車種 ═══════════════════════════════ */
console.log("\n══ 一、結論草稿：轉向別與車種 ══");
await go("結論草稿產生器");
const controls = await page.evaluate(() => ({
  movement: Boolean(document.querySelector('[data-testid="conclusion-movement"]')),
  vehicle: Boolean(document.querySelector('[data-testid="conclusion-vehicle"]')),
  dayPeak: [...document.querySelectorAll(".conclusion-checks label")].some(
    (label) => (label.textContent || "").includes("全調查時段尖峰"),
  ),
}));
ok(
  "⚠️ ① 結論草稿有「轉向別」這個條件（主工具列有，草稿以前完全沒有）",
  controls.movement,
  `找到：${controls.movement}`,
);
ok(
  "⚠️ ① 結論草稿有「車種」這個條件",
  controls.vehicle,
  `找到：${controls.vehicle}`,
);
/*
 * ⚠️ 「全調查時段尖峰」本來就在資料模型裡（PeakKey 含 DAY），
 *   而且「套用主工具列」早就會把它設進來——只有畫面上少了核取方塊。
 *   設得進去卻選不到，比沒有更容易被當成壞掉。
 */
ok(
  "⚠️ ① 時段可以勾「全調查時段尖峰」（資料模型本來就支援，只是畫面上漏了）",
  controls.dayPeak,
  `找到：${controls.dayPeak}`,
);

const draft = page.locator('textarea[aria-label="結論草稿"]');
const generate = async () => {
  await page
    .locator('.conclusion-output button:has-text("產生草稿")')
    .first()
    .click();
  await page.waitForTimeout(900);
  return draft.inputValue();
};
const allMovements = await generate();
ok(
  "前置：草稿產生得出來（空的話下面全部恆真）",
  allMovements.length > 200,
  `${allMovements.length} 字`,
);
ok(
  "⚠️ ③ 結論草稿要寫出統計條件（轉向別、車種、小數位數）",
  /統計條件：轉向別＝/.test(allMovements),
  (allMovements.match(/統計條件：.{0,60}/) || ["（沒有寫）"])[0],
);
/*
 * ⚠️ ⑥ 用的是哪一種判定方式，一定要寫在草稿裡。
 *
 *   舊版這一條驗的是「草稿要寫**不適用**『尖峰時段判定方式』」——當時
 *   結論草稿真的做不到，理由寫著「一筆紀錄裝不下三份」。
 *   2026-09-23 查證後那個理由是錯的：`peaks` 本來就按時段分開存，
 *   每一個時段可以各自吃自己那一份重挑過的紀錄。現在它是結論草稿自己的
 *   條件（預設仍是「整個調查點同一時段」＝改版前的行為）。
 *
 *   所以這一條改成驗**照實寫出用的是哪一種**。不寫的話，同一批資料在
 *   兩份草稿裡會給出不同的尖峰量，而兩份都看起來合理。
 *   切換之後的行為由 e2e-conclusion.mjs 的「尖峰時段判定方式」那一段守。
 */
ok(
  "⚠️ ⑥ 草稿要寫出用的是哪一種「尖峰時段判定方式」",
  /尖峰時段判定方式：整個調查點同一時段/.test(allMovements),
  (allMovements.match(/尖峰時段判定方式：.{0,60}/) || ["（一句都沒寫）"])[0],
);
/*
 * ⚠️ 預設那一種**不可以**印不可相加的警告——那句話是給另一種用的。
 *   兩種都印同一句的話，使用者分不出哪一種的數字可以相加。
 */
ok(
  "⚠️ ⑥ 預設（可以相加的那一種）不可以印「不適用『相加』」",
  !/本數值不適用「相加」/.test(allMovements),
  (allMovements.match(/.{0,20}不適用「相加」.{0,40}/) || ["（沒有印，正確）"])[0],
);

if (controls.movement) {
  await page.selectOption('[data-testid="conclusion-movement"]', "left");
  await page.waitForTimeout(900);
  const leftOnly = await generate();
  ok(
    "⚠️ ② 換成「只看左轉」之後，草稿的**數字真的變了**（只加下拉不接資料是假功能）",
    leftOnly.length > 200 && leftOnly !== allMovements,
    leftOnly === allMovements ? "兩份一模一樣" : "內容有變",
  );
  ok(
    "⚠️ ③ 草稿的統計條件要寫出目前是「左轉」",
    /轉向別＝左轉/.test(leftOnly),
    (leftOnly.match(/統計條件：.{0,40}/) || ["（沒有寫）"])[0],
  );
  /*
   * ⚠️ 反面：只看左轉時，總量一定**比全部轉向少**（左轉是全部的一部分）。
   *   只比「文字有沒有變」證明不了數字接對了——條件那一行本來就會變。
   */
  const sumPcu = (text) =>
    [...text.matchAll(/([\d,]+(?:\.\d+)?)\s?PCU\/hr/g)]
      .map((match) => Number(match[1].replace(/,/g, "")))
      .reduce((sum, value) => sum + value, 0);
  ok(
    "⚠️ ② 只看左轉時，草稿裡的 PCU 合計**比全部轉向少**（數字真的接上了）",
    sumPcu(allMovements) > 0 && sumPcu(leftOnly) < sumPcu(allMovements),
    `全部轉向 ${sumPcu(allMovements).toFixed(1)} → 只看左轉 ${sumPcu(leftOnly).toFixed(1)}`,
  );
  await page.selectOption('[data-testid="conclusion-movement"]', "all");
  await page.waitForTimeout(700);
}

/* 小數位數（含百分比）。 */
const pctDigitsIn = (text) =>
  [
    ...new Set(
      [...text.matchAll(/(\d+)(?:\.(\d+))?%/g)].map((m) => (m[2] || "").length),
    ),
  ].sort();
const setDigits = async (value) => {
  await page.evaluate((wanted) => {
    const label = [...document.querySelectorAll(".conclusion-inline")].find(
      (node) => (node.textContent || "").replace(/\s+/g, "").startsWith("小數位數"),
    );
    const select = label?.querySelector("select");
    if (!select) return;
    select.value = wanted;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.waitForTimeout(700);
  return generate();
};
const d0 = await setDigits("0");
const d2 = await setDigits("2");
ok(
  "⚠️ ⑤ 結論草稿：小數位數選 0 位時，**百分比**也是 0 位",
  pctDigitsIn(d0).length > 0 && pctDigitsIn(d0).every((n) => n === 0),
  `百分比的小數位：${pctDigitsIn(d0).join("／") || "（量不到百分比）"}`,
);
ok(
  "⚠️ ⑤ 結論草稿：小數位數選 2 位時，百分比也是 2 位",
  pctDigitsIn(d2).length > 0 && pctDigitsIn(d2).every((n) => n === 2),
  `百分比的小數位：${pctDigitsIn(d2).join("／") || "（量不到百分比）"}`,
);
await setDigits("1");

/* ══ 二、報告文字草稿 ═════════════════════════════════════════ */
console.log("\n══ 二、報告文字草稿 ══");
await go("成果交付");
const reportDraft = page.locator('textarea[aria-label="報告文字草稿"]');
ok(
  "前置：報告文字草稿面板有出現",
  (await reportDraft.count()) === 1,
  `${await reportDraft.count()} 個`,
);
const digitsCount = await page
  .locator('[data-testid="report-draft-digits"]')
  .count();
ok(
  "⚠️ ⑤ 報告文字草稿有「小數位數」（以前每一處都是寫死的 1 位）",
  digitsCount === 1,
  `${digitsCount} 個`,
);
const reportText = () => reportDraft.inputValue();
const base = await reportText();
ok(
  "前置：報告文字草稿有內容（空的話下面恆真）",
  base.length > 200,
  `${base.length} 字`,
);
ok(
  "⚠️ ③ 報告文字草稿要寫出統計條件（路口、尖峰時段判定方式、轉向別、車種、資料別）",
  /統計條件：/.test(base) &&
    /尖峰時段判定方式＝/.test(base) &&
    /轉向別＝/.test(base),
  (base.match(/統計條件：.{0,100}/) || ["（沒有寫）"])[0],
);
ok(
  "⚠️ ④ 判定方式是「整個調查點同一時段」時**不可以**出現「不可以相加」的警語",
  !/不適用「相加」/.test(base),
  (base.match(/.{0,10}不適用「相加」.{0,40}/) || ["沒有多餘的警語"])[0],
);
/* 把主工具列的判定方式切成「各方向各自認定」，警語一定要出現。 */
const ruleSelect = page.locator('[data-testid="mt-peak-rule"]');
if (await ruleSelect.count()) {
  await ruleSelect.selectOption("direction");
  await page.waitForTimeout(1400);
  const afterRule = await reportText();
  ok(
    "⚠️ ④ 判定方式切成「各方向各自認定」時，草稿要明講**不可以相加**",
    /不適用「相加」/.test(afterRule),
    (afterRule.match(/.{0,6}不適用「相加」.{0,60}/) || ["（一句都沒寫）"])[0],
  );
  ok(
    "⚠️ ③ 統計條件那一行也要跟著寫出新的判定方式",
    /尖峰時段判定方式＝各方向各自認定/.test(afterRule),
    (afterRule.match(/統計條件：.{0,80}/) || ["（沒有寫）"])[0],
  );
  await ruleSelect.selectOption("point");
  await page.waitForTimeout(1200);
} else {
  ok("前置：主工具列找得到「尖峰時段判定方式」", false, "找不到 mt-peak-rule");
}
if (digitsCount === 1) {
  await page.selectOption('[data-testid="report-draft-digits"]', "2");
  await page.waitForTimeout(1200);
  const two = await reportText();
  const pcuDigits = (text) =>
    [
      ...new Set(
        [...text.matchAll(/[\d,]+\.(\d+)\s?PCU\/hr/g)].map((m) => m[1].length),
      ),
    ].sort();
  ok(
    "⚠️ ⑤ 報告文字草稿的小數位數真的生效（PCU/hr）",
    pcuDigits(two).length > 0 && pcuDigits(two).every((n) => n === 2),
    `PCU/hr 的小數位：${pcuDigits(two).join("／") || "（量不到）"}`,
  );
  ok(
    "⚠️ ⑤ 報告文字草稿的**百分比**也跟著小數位數走（踩過的雷：百分比寫死 1 位）",
    pctDigitsIn(two).length === 0 || pctDigitsIn(two).every((n) => n === 2),
    `百分比的小數位：${pctDigitsIn(two).join("／") || "（這批資料沒有百分比）"}`,
  );
  await page.selectOption('[data-testid="report-draft-digits"]', "1");
  await page.waitForTimeout(900);
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log(
  "\n✅ 兩個草稿產生器：轉向別／車種可出題、條件寫得出來、不可相加有警語、小數位數（含百分比）都生效",
);
