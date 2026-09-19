/*
 * ══════════════════════════════════════════════════════════════════
 *  畫面上每一個 class，樣式表裡都要真的寫過
 * ══════════════════════════════════════════════════════════════════
 *
 * 為什麼要有這一支：
 *
 *   2026-09-11 一天之內踩到三次**同一種**錯誤：
 *     ・.ghost（本程式）→ 按鈕變成沒有邊框的純文字
 *     ・.ghost（全日交通量）→ 同上
 *     ・.factor-scope-picker／-state／-summary（全日交通量）
 *       → 使用者原話：「參數設定 套用季別 全季別 和套用路段 也全面是白色的，
 *          與背景色相融，完全沒發現這裡可以設定 季別/路段」
 *
 *   三次都是：**JSX 寫了 class，CSS 從頭到尾沒有那一條規則**。
 *
 * ⚠️ 這種錯誤不會有任何錯誤訊息。TypeScript 不看 class 名稱，ESLint 不看，
 *   瀏覽器主控台也不會吭聲——畫面照樣畫得出來，只是畫成一行沒有樣式的字。
 *   使用者要自己「看出來這裡本來應該有個東西」才會回報，
 *   而「看不出來這裡可以設定」正是他這次的原話。
 *
 * ── 為什麼用 E2E 而不是掃原始碼 ────────────────────────────────
 *
 *   掃 .tsx 找 className 要自己剖析樣板字串、三元運算式、
 *   還分不出「這是 class」和「這是傳給函式的 id」，假警報會多到沒人理它——
 *   沒人理的測試等於沒有測試。改成在**真的畫出來的畫面**上做：
 *   讀每個元素的 classList，再問 document.styleSheets 有沒有規則提到它。
 *   兩邊都是事實，不需要猜。
 *
 * ── ⚠️ 刻意迴避的假通過陷阱 ────────────────────────────────────
 *
 *   一、**只看一頁不算。** 這支程式有 18 個分頁，換頁之後別頁的 DOM
 *       根本不存在，只驗首頁等於只驗十八分之一。這裡逐頁走過再聯集。
 *   二、**「有規則」不等於「規則有效」**——這一支只擋「完全沒寫」。
 *       顏色對比由 tests/sidebar-contrast.test.mjs 與 e2e-layout 管。
 *   三、前置檢查：先塞一個**故意不存在**的 class 進 DOM，確認抓得到。
 *       抓不到的話，下面那條是恆綠的。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8266;
const seed = readFileSync(join(here, "seed-wide.json"), "utf8");

const problems = [];
/*
 * detail 分兩種用途：有些是**佐證**（成功時也該印出來看），
 * 有些是**失敗原因**（成功時印出來會讓人以為出事了）。
 * 後者用 failOnly() 包起來，只在紅字時才顯示。
 */
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

/*
 * 這些 class 是**刻意**沒有自己的樣式的，不是漏寫。
 *
 * ⚠️ 要往這裡加東西之前，規矩是：**把那一塊實際算繪出來拍下來看過**，
 *   不可以用「應該沒關係吧」放行——2026-09-11 那三次事故，
 *   每一次都是在這一步自我說服而過關的。
 *   下面五個是 2026-09-11 用 scripts/manual/probe-unstyled.mjs
 *   逐一截圖確認過畫面正常才列進來的，截圖當時的尺寸一併記在後面。
 */
const INTENTIONAL = new Set([
  /* 783x433，卡片樣式來自 .panel 與內部元素；這個名字只是結構標記 */
  "project-list",
  /* 1220x262，格線來自 .kpi-grid，七張卡片排版正常 */
  "composition-kpis",
  /* 1178x165，版面來自 .report-items-head；按鈕來自 .report-draft-head-actions */
  "report-draft-head",
  /* 1220x79，版面來自 .page-head */
  "help-head",
  /*
   * ⚠️ .ready 是「沒有警告」那一個狀態，而**沒有警告就是預設長相**
   *   （青色的 .export-preflight）。有警告時才由 .has-warning 換成橘色。
   *   也就是說它不需要自己的規則——但它**看起來**像個該有樣式的狀態名，
   *   所以這一條特別記下來，免得下一個人以為是漏寫而去補一條橘色進來。
   */
  "ready",
]);

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1536, height: 900 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 無痕或封鎖時就算了，下面的前置檢查會紅。 */
  }
}, seed);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);

const scanPage = () =>
  page.evaluate(() => {
    const styled = new Set();
    const collect = (rules) => {
      for (const rule of rules) {
        if (rule.selectorText)
          /*
           * ⚠️ 這一條正規式我第一版寫錯過，而且**錯得會全綠或全紅**：
           *   字元類別裡放了「空白到 \uFFFF」的範圍，等於連小數點和空白
           *   都算進名稱，於是 `.severity.warning` 被當成一個叫
           *   「severity.warning」的類別，`.warning` 就永遠找不到規則。
           *   實測一次噴出 40 幾個假警報。名稱只能是 CSS 識別字：
           *   字母／數字／底線／連字號（外加非 ASCII）。
           */
          for (const m of rule.selectorText.matchAll(
            /\.(-?[_a-zA-Z\u00a0-\uffff][\w\u00a0-\uffff-]*)/g,
          ))
            styled.add(m[1]);
        if (rule.cssRules) collect(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        collect(sheet.cssRules);
      } catch {
        /* 跨來源樣式表讀不到；本專案是內嵌的，不會走到這裡 */
      }
    }
    const missing = {};
    for (const el of document.querySelectorAll("[class]")) {
      if (typeof el.className !== "string") continue; /* SVG 元素跳過 */
      for (const klass of el.classList)
        if (!styled.has(klass) && !(klass in missing))
          missing[klass] =
            `<${el.tagName.toLowerCase()} class="${el.className}">` +
            (el.textContent || "").trim().slice(0, 24);
    }
    return missing;
  });

console.log("\n══ 前置：這支掃描器真的抓得到沒有規則的 class ══");
await page.evaluate(() => {
  const probe = document.createElement("div");
  probe.className = "zz-probe-class-with-no-rule";
  document.body.appendChild(probe);
});
ok(
  "塞一個不存在的 class 進去，掃描器抓得到",
  "zz-probe-class-with-no-rule" in (await scanPage()),
  failOnly("抓不到的話，下面「每個 class 都有規則」那一條是恆綠的"),
);
await page.evaluate(() => {
  document.querySelector(".zz-probe-class-with-no-rule")?.remove();
});

/* 側欄上實際存在的分頁，全部走一遍（不寫死清單，側欄改了就自動跟著改）。 */
const navLabels = await page.evaluate(() =>
  /*
   * ⚠️ 2026-09-13 起每一列右側多了一顆收合鈕（也是 nav button）。
   *   它的文字是「▾」，混進分頁清單的話會被當成一頁去點，
   *   而點下去只是把小分頁收起來——走訪數就對不上（實測 19/21）。
   */
  [...document.querySelectorAll("nav button:not(.nav-collapse)")]
    .map((b) => (b.textContent || "").trim())
    .filter(Boolean),
);
ok(
  "側欄找得到分頁按鈕",
  navLabels.length >= 10,
  failOnly(`只找到 ${navLabels.length} 個——定位方式是不是又變了？`),
);

console.log("\n══ 逐頁掃描 ══");
const missing = {};
let visited = 0;
for (const label of navLabels) {
  const button = page.locator("nav button:not(.nav-collapse)", { hasText: label }).first();
  if (!(await button.count())) continue;
  await button.click().catch(() => {});
  await page.waitForTimeout(650);
  visited += 1;
  const found = await scanPage();
  let count = 0;
  for (const [klass, where] of Object.entries(found)) {
    if (INTENTIONAL.has(klass)) continue;
    count += 1;
    if (!(klass in missing)) missing[klass] = `${label}｜${where}`;
  }
  console.log(`   ${label}：${count ? `${count} 個沒有規則` : "全部都有規則"}`);
}

console.log("\n══ 結果 ══");
ok("真的走過每一個分頁", visited === navLabels.length, `走了 ${visited}/${navLabels.length} 頁`);
ok(
  "畫面上每一個 class 在樣式表裡都找得到規則",
  Object.keys(missing).length === 0,
  Object.keys(missing).length
    ? "\n" +
      Object.entries(missing)
        .map(([k, v]) => `   .${k}　←　${v}`)
        .join("\n")
    : "",
);
ok("過程中沒有 JS 例外", errors.length === 0, failOnly(errors.slice(0, 3).join(" / ")));

await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過`);
  process.exit(1);
}
console.log("\n✅ 全部通過");
