/*
 * ══════════════════════════════════════════════════════════════════════
 *  側欄列得出來的每一項，畫面上都要找得到對應的那一塊
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12（附截圖）：
 *   「我點選我的計畫，所以中間『我的計畫』變成顯眼。但我按了本季總覽，
 *     畫面跳到第二張圖那樣，我完全看不出本季總覽是什麼用途?」
 *
 * 成因：「本季總覽」那一塊的渲染條件是 `activeProject && quarter`。
 * 他當下切到的計畫是剛建好的（0 個季度、0 筆資料），quarter 是空字串，
 * **整個區塊根本沒有被畫出來**。側欄那一項照樣點得下去、照樣變成
 * 「目前這一項」，但畫面上什麼都沒發生。
 *
 * ⚠️ 這比壞掉更糟：**功能看起來像故障，而使用者無從得知原因**。
 *   沒有任何錯誤訊息、沒有任何提示，他只會覺得「這個按鈕壞了」或
 *   「我看不懂這個功能」——兩種結論都是錯的，而且他不會再按第二次。
 *
 * 所以這一支不是驗「有沒有這個按鈕」，是驗**空資料狀態下**
 * 每一個側欄錨點都還找得到對應的區塊、而且點下去真的被框起來。
 *
 * ⚠️ 一定要用**空的計畫**測。有資料時每一塊都畫得出來，
 *   這個洞一項都抓不到，而測試會全綠。
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { serve } = await import(pathToFileURL(join(HERE, "serve.mjs")).href);
const { launchOptions } = await import(
  pathToFileURL(join(HERE, "chrome-path.mjs")).href
);
const server = await serve(8159);

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:8159/");
await page.waitForTimeout(1600);

/* 一個**完全空的**計畫——0 個季度、0 筆資料。 */
await page
  .locator('button:has-text("建立計畫"), button:has-text("新增計畫")')
  .first()
  .click()
  .catch(() => {});
await page.waitForTimeout(600);
const nameInput = page.locator(".modal-backdrop input, .modal input").first();
if (await nameInput.count()) {
  await nameInput.fill("空計畫");
  await page
    .locator('.modal-backdrop button:has-text("建立"), .modal button:has-text("建立")')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(900);
}

/*
 * 側欄上所有「錨點型」的子項目。
 *
 * ⚠️ 路口轉向的側欄和全日交通量不一樣：子項目只在**目前這一頁**底下才展開
 *   （`view === item.id && item.sections`），所以要一頁一頁進去收集。
 */
/*
 * ⚠️ 2026-09-13 起每一列右側多了一顆收合鈕（也是 nav > div > button）。
 *   收集大分頁時**一定要排除它**，否則它的文字「▾」會被當成一個分頁名稱，
 *   接著 :has-text("▾") 會去按它 → 把小分頁收起來，
 *   後面每一項都找不到而逾時。（實測就是這樣紅的。）
 */
const pages = await page.evaluate(() =>
  [...document.querySelectorAll("nav > div > button:not(.nav-collapse)")].map((el) =>
    (el.textContent || "").replace(/\s+/g, " ").trim(),
  ),
);
const anchors = [];
for (const label of pages) {
  await page.locator(`nav > div > button:has-text("${label}")`).first().click();
  await page.waitForTimeout(450);
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll(".nav-sections .nav-section")].map(
      (el) => el.getAttribute("data-goto-item") || "",
    ),
  );
  for (const item of sections) anchors.push({ zone: label, label: item });
}

ok(
  "前置：空計畫下還是列得出一些錨點型子項目",
  anchors.length >= 3,
  anchors.map((a) => a.label).join("、") || "一個都沒有",
);
/*
 * ⚠️ 這一條是這支測試的**反面**：對應的區塊不存在時，那幾個子項目
 *   就**不該被列出來**。流量核對工作台在沒有選到紀錄時整頁換成一張
 *   說明卡，底下那五塊全部不存在——那就不要列五個點了沒反應的項目。
 */
ok(
  "⚠️ 沒有資料時，流量核對工作台的子項目不列出來（點了沒反應比不列更糟）",
  !anchors.some((a) => a.label === "OD 流量表"),
  anchors.map((a) => a.label).join("、"),
);

console.log("\n══ 空計畫（0 季度、0 筆資料）下逐項點過去 ══");
for (const item of anchors) {
  /* 先進到那一個分區，子項目才會展開。 */
  await page
    .locator(`nav > div > button:has-text("${item.zone}")`)
    .first()
    .click();
  await page.waitForTimeout(500);
  await page
    .locator(`.nav-section[data-goto-item="${item.label}"]`)
    .first()
    .click();
  await page.waitForTimeout(700);
  const landed = await page.evaluate(() => {
    const el = document.querySelector(".is-focused");
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return {
      id: el.id,
      outline: parseFloat(getComputedStyle(el).outlineWidth || "0"),
      height: Math.round(box.height),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
    };
  });
  /*
   * ⚠️ 三件事一起驗，缺一不可：
   *   ・找得到那一塊（不是整個沒被渲染）
   *   ・框畫得出來（使用者看得出是「這一塊」）
   *   ・裡面**真的有字**（空殼子和沒有一樣：他還是不知道這是什麼）
   */
  ok(
    `「${item.label}」點下去找得到對應的區塊並框起來`,
    Boolean(landed) && landed.outline > 0 && landed.height > 20,
    landed
      ? `#${landed.id} 外框 ${landed.outline}px、高 ${landed.height}px`
      : "畫面上完全沒有任何區塊被點名（＝那一塊沒有被畫出來）",
  );
  if (landed)
    ok(
      `「${item.label}」那一塊沒有資料時也說得出它是什麼／為什麼是空的`,
      landed.text.length >= 6,
      landed.text || "整塊沒有任何文字",
    );
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  有資料時，那五個子項目必須回來
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 少了這一段，上面那條「沒有資料就不要列出來」會變成一條**危險**的
 *   測試：把子項目整個刪掉也會全綠。要兩邊一起釘，才是真的在驗行為。
 */
console.log("\n══ 有資料時，子項目要回來 ══");
const { installStateHelpers } = await import(
  pathToFileURL(join(HERE, "read-state.mjs")).href
);
const { readFileSync } = await import("node:fs");
await installStateHelpers(page);
await page.goto("http://localhost:8159/");
await page.waitForTimeout(1000);
await page.evaluate(async (seed) => {
  localStorage.clear();
  await window.__writeState(seed);
}, readFileSync(join(HERE, "seed-state.json"), "utf8"));
await page.reload();
await page.waitForTimeout(1800);
await page
  .locator('nav > div > button:has-text("流量核對工作台")')
  .first()
  .click();
await page.waitForTimeout(900);
const withData = await page.evaluate(() =>
  [...document.querySelectorAll(".nav-sections .nav-section")].map(
    (el) => el.getAttribute("data-goto-item") || "",
  ),
);
ok(
  "⚠️ 有資料時五個子項目要回來（不然「沒資料就不列」會變成把它整個刪掉也全綠）",
  withData.length === 5,
  withData.join("、") || "一個都沒有",
);
for (const label of withData) {
  await page
    .locator(`.nav-section[data-goto-item="${label}"]`)
    .first()
    .click();
  await page.waitForTimeout(600);
  const landed = await page.evaluate(() => {
    const el = document.querySelector(".content .is-focused");
    return el
      ? {
          id: el.id,
          outline: parseFloat(getComputedStyle(el).outlineWidth || "0"),
        }
      : null;
  });
  ok(
    `有資料時「${label}」點下去找得到對應的區塊並框起來`,
    Boolean(landed) && landed.outline > 0,
    landed ? `#${landed.id} 外框 ${landed.outline}px` : "沒有任何區塊被點名",
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
await server.close?.();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 空計畫下，側欄每一項都找得到對應的那一塊");
