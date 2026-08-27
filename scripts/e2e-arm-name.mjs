/*
 * 支線名稱與季度選單的端對端檢查（路口轉向）。
 *
 * 兩件事在 v2.1.27 以前都是「看起來正常、其實不對」：
 *
 * 1. 轉向圖同一張圖卡的兩半用不同來源。駛出那半印 approach.name，
 *    駛入那半印 approach.sourceCode。使用者替支線改名之後，圖上只有一半會變；
 *    人工新增的支線會印成「←人工2」。PNG／PDF 匯出共用同一支產生程式。
 *
 * 2. 右上角季度選單的第一個選項「尚無季度」是死的。選它會把季度設成空字串，
 *    緊接著 useEffect 又把它拉回最新一季，所以點了什麼都沒發生。
 *    全系統六個季度選單也只有這一個有它。
 *
 * 使用交付包自帶的示範種子，不含任何實際計畫、站號或路口名稱。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
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
page.on("crash", () => errors.push("PAGE CRASHED"));

/* 刻意取一個絕對不會和支線代碼（A~G）混淆的名字。 */
const NEW_NAME = "示範北路北側入口";

await page.addInitScript((s) => {
  localStorage.setItem("turning-traffic-state-v2", s);
}, seed);
await page.goto("http://localhost:8117/");
await page.waitForTimeout(1400);

const go = async (name) => {
  await page.locator(`nav button:has-text("${name}"), aside button:has-text("${name}")`).first().click();
  await page.waitForTimeout(900);
};

/* ══ 1. 季度選單 ══ */
const quarterSelect = page.locator("header select").nth(1);
const quarterOptions = await quarterSelect.locator("option").allInnerTexts();
ok(
  "有季度時，選單裡不再有死選項「尚無季度」",
  !quarterOptions.some((text) => text.trim() === "尚無季度"),
  quarterOptions.join(" ／ "),
);
ok(
  "季度選單本身有東西可選（前提檢查）",
  quarterOptions.length >= 2,
  `${quarterOptions.length} 個選項`,
);
/*
 * 每一個選項都必須真的能切換。以前第一個選項選下去等於沒選，
 * 而畫面照樣顯示最新一季，看不出哪裡不對。
 */
for (const label of quarterOptions.slice(0, 3)) {
  await quarterSelect.selectOption({ label });
  await page.waitForTimeout(600);
  const shown = await quarterSelect.inputValue();
  ok(`選「${label}」之後選單真的停在該季`, shown === label, `實際為 ${shown}`);
}
await quarterSelect.selectOption({ label: quarterOptions.at(-1) });
await page.waitForTimeout(600);

/* ══ 2. 支線改名之後轉向圖兩半要一致 ══ */
await go("道路與流向管理");
/* 找到第一個支線名稱輸入框：以目前值是預設支線名稱（支線／路口／新增支線開頭）者為準。 */
const armInputs = page.locator("input[type='text'], input:not([type])");
const armCount = await armInputs.count();
let target = null;
let originalName = "";
for (let i = 0; i < armCount; i += 1) {
  const value = await armInputs.nth(i).inputValue().catch(() => "");
  if (/^(支線|路口|新增支線)/.test(value)) {
    target = armInputs.nth(i);
    originalName = value;
    break;
  }
}
ok("找得到支線名稱欄位（前提檢查）", !!target, originalName);
if (target) {
  await target.fill(NEW_NAME);
  await target.blur();
  await page.waitForTimeout(900);

  await go("路口轉向圖");
  /*
   * 直接抓 SVG 裡以 ← / → 開頭的文字節點，一個節點就是一格的方向標籤。
   * 不要用整段 textContent 去正規比對——數字會黏在標籤後面，
   * 「B722.6」看起來像有名稱，其實只是代碼加流量，測不出東西來。
   */
  const cardText = await page.evaluate(
    () => document.querySelector(".diagram-canvas")?.textContent || "",
  );
  const arrows = await page.evaluate(() => {
    const out = { inbound: [], outbound: [] };
    for (const node of document.querySelectorAll(".diagram-canvas text, .diagram-canvas tspan")) {
      const text = (node.textContent || "").trim();
      if (text.startsWith("←")) out.inbound.push(text.slice(1));
      else if (text.startsWith("→")) out.outbound.push(text.slice(1));
    }
    return out;
  });
  ok("轉向圖上出現新的支線名稱", cardText.includes(NEW_NAME));
  ok(
    "抓得到駛入與駛出兩半的方向標籤（前提檢查）",
    arrows.inbound.length > 0 && arrows.outbound.length > 0,
    `駛入 ${arrows.inbound.length} 格、駛出 ${arrows.outbound.length} 格`,
  );
  ok(
    "駛出那半有寫新名稱",
    arrows.outbound.some((x) => x.includes(NEW_NAME)),
    [...new Set(arrows.outbound)].slice(0, 8).join("、"),
  );
  ok(
    "駛入那半也有寫新名稱",
    arrows.inbound.some((x) => x.includes(NEW_NAME)),
    [...new Set(arrows.inbound)].slice(0, 8).join("、"),
  );
  /*
   * 最關鍵的一項：同一張圖上，駛入用的標籤集合必須等於駛出用的標籤集合。
   * 兩半本來就是同一組支線，只是箭頭方向相反；集合不一樣就代表兩邊
   * 取的來源不同（舊寫法一邊取 name、一邊取 sourceCode）。
   */
  const setOf = (list) =>
    [...new Set(list.filter((x) => x && x !== "－"))].sort().join("｜");
  ok(
    "駛入與駛出兩半用的是同一組支線標籤",
    setOf(arrows.inbound) === setOf(arrows.outbound),
    `駛入＝${setOf(arrows.inbound)}\n   駛出＝${setOf(arrows.outbound)}`,
  );
  /* 代碼並沒有消失——圖卡標題那一行仍然寫「A · 支線名稱」。 */
  ok("圖卡標題仍然看得到支線代碼", /[A-G]\s*·/.test(cardText));
}

ok("全程無 JS 錯誤", errors.length === 0, errors.slice(0, 3).join(" | "));

console.log(
  problems.length
    ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}`
    : "\n全部通過",
);
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
