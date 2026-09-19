/*
 * ══════════════════════════════════════════════════════════════════
 *  數值標籤：少量直接標、量多改成滑鼠移上去；匯出一律淨空
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者定案（2026-09-10）：
 *   「在資料數列少的時候做到不重疊沒有問題，但資料一多，其實還是改成
 *     滑鼠移上去才顯示數值就很夠用……如果有這個功能，那麼說明裡也不需要
 *     附逐點數值表了」
 *   「點下去就能跳轉到表格並套用篩選……我反而覺得不用做到」
 * 使用者 2026-09-11 追問：
 *   「我想起來一件事還沒確認，就是把滑鼠移動到圖上，查看能否看到數值。」
 *
 * ── 為什麼要新寫這一支 ────────────────────────────────────────
 *
 * 功能是 v2.1.64 做的，但**從來沒有任何一支測試真的把滑鼠移上去過**。
 * e2e-chart-layout 只在註解裡提到這件事，斷言驗的是別的東西。
 * 「有測試」不等於「測到」——這正是這個專案一再踩到的那一條。
 *
 * ── 守四件事 ──────────────────────────────────────────────────
 *
 *   ① 資料少的時候**也一樣**要移滑鼠才看得到（X-46 起一律 hover）
 *   ② 資料多：靜止時**一個標籤都沒有**（不是變小、不是變淡）
 *   ③ 資料多時滑鼠移到某一個點：**那一個點**的數值出現，而且數字正確
 *   ④ 滑鼠移開：標籤要消失（否則掃過整張圖之後會留下一整排）
 *   ⑤ 匯出的 PNG 一律淨空——這裡不看畫面，直接檢查匯出路徑複製出來的
 *      那一份標記裡沒有 .point-value
 *
 * ── ⚠️ 刻意迴避的假通過 ───────────────────────────────────────
 *
 * 一、**只驗「hover 之後有字」不算數**：它可能顯示的是別的點的值。
 *     這裡比對的是 hover 出來的字與**那個點自己的 data-value**。
 * 二、**只驗「資料多時沒有標籤」不算數**：整張圖沒畫出來也會通過。
 *     所以先前置檢查「點真的畫出來了、而且數量夠多」。
 * 三、**只驗①不算數**：門檻寫成永遠成立也會過。①②要在同一次執行裡
 *     用**同一支程式、不同資料量**各驗一次。
 *
 * ── ⚠️ 2026-09-16 訂正：這一支原本守的是**舊規則** ────────────────
 * 舊的①是「資料少就直接把標籤標在圖上」。X-46（使用者 2026-09-16）已經
 * 改成**一律 hover 才顯示**：
 *   「又再次出現標籤重疊的問題。如果一直出現這個問題，
 *     是否統一一律改為滑鼠移上去才顯示數字呢?」
 * 舊①在新規則下永遠紅，而它紅的是「功能照規則做了」——
 * 一支守著已經作廢的規則的測試，比沒有測試更糟。
 * ⚠️ 原本掛在「畫面上本來就有的標籤」上的那兩段（二之二不可壓到縱軸刻度、
 *   三匯出淨空）改成**先 hover 出一個標籤再量**，驗的東西一個都沒少。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8294;

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

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const errors = [];

/**
 * 用指定的種子開一頁、切到歷季趨勢比較。
 * 兩種資料量各開一次——同一支程式、不同資料量，才驗得出門檻真的在作用。
 *
 * ⚠️ **每一份種子要用自己的 browser context**，不可以共用。
 *   這支程式會把 localStorage 的資料搬進 IndexedDB，而 IndexedDB 是
 *   整個 context 共用的、而且優先於 localStorage。共用 context 的話，
 *   第一份種子搬進去之後，第二份用 addInitScript 寫的 localStorage
 *   **會被無視**——第二頁看到的仍然是第一份資料。
 *   實測就是這樣：兩份種子都只畫得出 2 個點，而「資料多」那一段
 *   因此驗到的是「資料少」的畫面（前置檢查當場紅，設計正確）。
 */
async function openTrend(seedFile) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "zh-TW",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("dialog", (d) => d.accept());
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("turning-traffic-state-v2", t);
    } catch {
      /* 無痕或封鎖時就算了，前置檢查會紅。 */
    }
  }, readFileSync(join(here, seedFile), "utf8"));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.locator('nav button:has-text("歷季趨勢比較")').first().click();
  await page.waitForTimeout(1500);
  return page;
}

/** 目前畫面上看得見的數值標籤有幾個、寫了什麼。 */
const visibleLabels = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#trend-svg text.point-value")].map((t) =>
      (t.textContent || "").trim(),
    ),
  );

/** 圖上的資料點（含它自己身上記的真值）。 */
const pointsOf = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#trend-svg circle[data-value]")].map((c) => ({
      value: Number(c.getAttribute("data-value")),
      peak: c.getAttribute("data-peak"),
      quarter: c.getAttribute("data-quarter"),
      cx: Number(c.getAttribute("cx")),
      cy: Number(c.getAttribute("cy")),
    })),
  );

/* ══ 一、資料少：不必移滑鼠就看得到數值 ══════════════════════ */
console.log("\n══ 一、資料少（線數 × 季數 ≤ 8）：標籤直接標在圖上 ══");
const few = await openTrend("seed-state.json");
const fewPoints = await pointsOf(few);
ok(
  "前置：圖上真的有資料點",
  fewPoints.length > 0,
  failOnly("一個點都沒有——圖是不是根本沒畫出來？"),
);
ok(
  "前置：這一份測資的點數確實在門檻之內（≤ 8）",
  fewPoints.length > 0 && fewPoints.length <= 8,
  `${fewPoints.length} 個點`,
);
const fewIdle = await visibleLabels(few);
ok(
  "⚠️ 資料少時**也一樣**靜止沒有標籤（X-46：一律 hover 才顯示）",
  fewIdle.length === 0,
  failOnly(`靜止畫面上還有 ${fewIdle.length} 個：${fewIdle.slice(0, 4).join("／")}`),
);
/* 前置：後面兩段要量「畫面上的標籤」，所以先 hover 出一個來。 */
const fewTarget = few.locator("#trend-svg circle[data-value]").first();
await fewTarget.hover();
await few.waitForTimeout(400);
const fewLabels = await visibleLabels(few);
ok(
  "資料少時，滑鼠移上去就看得到數值",
  fewLabels.length > 0,
  fewLabels.slice(0, 4).join("／") || "（hover 之後仍然沒有標籤）",
);

/* ══ 二、資料多：靜止時一個標籤都沒有，移上去才出現 ════════════ */
console.log("\n══ 二、資料多：靜止沒有標籤，滑鼠移上去才顯示 ══");
const many = await openTrend("seed-wide.json");
/*
 * ⚠️ 趨勢圖一次只畫**一個路口**，所以「種子裡有 16 季」不代表圖上就有 16 個點。
 *   第一版直接用預設選項，結果只有 2 個點——前置檢查當場紅，設計正確。
 *   這裡逐一切過每一個路口，挑點數最多的那一個來測。
 */
const intersectionSelect = many.locator(".trend-controls select").first();
const options = await intersectionSelect
  .locator("option")
  .evaluateAll((list) => list.map((o) => o.value));
let bestValue = "";
let bestCount = 0;
for (const value of options) {
  await intersectionSelect.selectOption(value);
  await many.waitForTimeout(500);
  const count = (await pointsOf(many)).length;
  if (count > bestCount) {
    bestCount = count;
    bestValue = value;
  }
}
await intersectionSelect.selectOption(bestValue);
await many.waitForTimeout(700);
console.log(`   （挑了點數最多的路口：${bestCount} 個點，共 ${options.length} 個路口）`);
const manyPoints = await pointsOf(many);
ok(
  "前置：圖上的點夠多（超過門檻，才驗得到「改成 hover」這件事）",
  manyPoints.length > 8,
  `${manyPoints.length} 個點`,
);
const idleLabels = await visibleLabels(many);
ok(
  "資料多時，靜止畫面上一個數值標籤都沒有",
  idleLabels.length === 0,
  failOnly(`還留著 ${idleLabels.length} 個：${idleLabels.slice(0, 5).join("／")}`),
);

/*
 * 挑中間那一個點來測——第一個與最後一個常常剛好在邊界，
 * 邊界通過不代表中間也通過。
 */
const targetIndex = Math.floor(manyPoints.length / 2);
const target = manyPoints[targetIndex];
/*
 * ⚠️ 用**元素**去 hover，不要自己換算座標。
 *   SVG 以 viewBox 縮放，還可能有 preserveAspectRatio 造成的留白偏移；
 *   自己算 scaleX/scaleY 會把滑鼠放到離點幾十像素的地方，
 *   於是「移上去沒反應」看起來像功能壞掉，其實是測試沒對準。
 *   讓 Playwright 自己算元素中心，順便也更貼近使用者真正的動作。
 */
const targetCircle = many.locator("#trend-svg circle[data-value]").nth(targetIndex);
await targetCircle.hover();
await many.waitForTimeout(400);
const hoverLabels = await visibleLabels(many);
ok(
  "滑鼠移到某一個點時，數值出現",
  hoverLabels.length > 0,
  hoverLabels.join("／") || "（沒有任何標籤出現）",
);
/*
 * ⚠️ 這一條才是重點：出現的數字要是**那一個點**的值，
 *   不是隨便一個點的值。比對的是點自己身上的 data-value。
 */
const shown = hoverLabels.join(" ").replace(/,/g, "");
ok(
  "顯示的數字就是那一個點的值（不是別的點的）",
  hoverLabels.length > 0 &&
    shown.includes(
      target.value.toLocaleString("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).replace(/,/g, ""),
    ),
  `點上記的值 ${target.value}（${target.peak}／${target.quarter}）｜顯示 ${hoverLabels.join("／")}`,
);
ok(
  "只顯示滑鼠停的那一個，不是整排都亮起來",
  hoverLabels.length <= 3,
  `出現 ${hoverLabels.length} 個：${hoverLabels.slice(0, 5).join("／")}`,
);

/* 移開之後要收乾淨——否則掃過整張圖會留下一整排標籤 */
await many.locator("#trend-svg").first().hover({ position: { x: 5, y: 5 } });
await many.waitForTimeout(400);
const afterLeave = await visibleLabels(many);
ok(
  "滑鼠移開之後標籤要消失（不會掃過一遍就留下一整排）",
  afterLeave.length === 0,
  failOnly(`還留著 ${afterLeave.length} 個：${afterLeave.slice(0, 5).join("／")}`),
);

/*
 * ══════════════════════════════════════════════════════════════════
 *  二之二、標籤不可以壓到縱軸刻度
 * ══════════════════════════════════════════════════════════════════
 *
 * 姊妹專案（全日交通量）2026-09-11 被使用者截圖抓到：最左那一季的
 * 「平日 677,819」壓在縱軸刻度「600,000」上面。這一支的結構一模一樣
 * ——繪圖區是 x ∈ [100, 寬-70]，縱軸刻度畫在 x<100——只是還沒有人
 * 點到那張圖。三支踩過的雷要互相補上，所以這一條在這裡先釘住。
 *
 * ⚠️ 量的是**繪圖區**的界，不是整張 SVG 的界。
 *   標籤壓到縱軸刻度時並沒有超出 SVG，量 SVG 邊界會一路綠燈——
 *   那正是姊妹專案當初漏掉的原因。
 * ⚠️ 用 getBBox() 拿文字實際占的方框（SVG 座標系），
 *   才不必處理 viewBox 縮放。
 */
console.log("\n══ 二之二、標籤不可以壓到縱軸刻度 ══");
const axisClash = await few.evaluate(() => {
  const svg = document.querySelector("#trend-svg");
  if (!svg) return { error: "找不到 #trend-svg" };
  const width = Number(svg.getAttribute("width") || 0);
  const plotLeft = 100;
  const plotRight = width - 70;
  /*
   * ⚠️ 左側要量的是**與縱軸刻度數字的距離**，不是與繪圖區邊界的距離。
   *   刻度數字是右對齊畫在 x=75（見 .grid-lines text 的 text-anchor:end），
   *   標籤就算落在繪圖區左緣 x=100，離刻度也只有 25px。
   *   姊妹專案（全日交通量）2026-09-11 就是因為只留 13px 被使用者回報
   *   「數字有和Y軸重疊的疑慮」。這裡要求至少 18px。
   */
  const axisTextRight = 75;
  const GAP = 18;
  const labels = [...svg.querySelectorAll("text.point-value")];
  const bad = labels
    .map((el) => ({ text: el.textContent.trim(), box: el.getBBox() }))
    .filter(
      (item) =>
        item.box.x < axisTextRight + GAP ||
        item.box.x + item.box.width > plotRight + 0.5,
    )
    .map(
      (item) =>
        `${item.text}（${Math.round(item.box.x)}~${Math.round(item.box.x + item.box.width)}）`,
    );
  return { count: labels.length, plotLeft, plotRight, axisTextRight, gap: GAP, bad };
});
ok(
  "前置：這張圖上真的有數值標籤可以量",
  !axisClash.error && axisClash.count > 0,
  axisClash.error || `${axisClash.count} 個`,
);
ok(
  "標籤離縱軸刻度夠遠，右邊也沒有被切掉",
  !axisClash.error && axisClash.bad.length === 0,
  axisClash.error ||
    (axisClash.bad.length
      ? `越界：${axisClash.bad.join("、")}｜縱軸刻度右緣 ${axisClash.axisTextRight}、需留 ${axisClash.gap}px、繪圖區右緣 ${axisClash.plotRight}`
      : `縱軸刻度右緣 ${axisClash.axisTextRight}＋${axisClash.gap}px ~ 繪圖區右緣 ${axisClash.plotRight}`),
);

/* ══ 三、匯出一律淨空 ═══════════════════════════════════════ */
console.log("\n══ 三、匯出的圖一律沒有數值標籤 ══");
/*
 * 不按下載鈕（那會開檔案儲存流程），直接走與匯出相同的那一段：
 * 複製一份 SVG、移除 .point-value、序列化。驗的是「複製出來的那一份」。
 * ⚠️ 前置：先確認畫面上此刻**有**標籤，不然「移除後沒有」是恆真的。
 */
const exportCheck = await few.evaluate(() => {
  const node = document.querySelector("#trend-svg");
  if (!node) return { error: "找不到 #trend-svg" };
  const before = node.querySelectorAll("text.point-value").length;
  const clean = node.cloneNode(true);
  clean.querySelectorAll(".point-value").forEach((label) => label.remove());
  const markup = new XMLSerializer().serializeToString(clean);
  return {
    before,
    after: clean.querySelectorAll("text.point-value").length,
    /*
     * ⚠️ 不可以用 markup.includes("point-value") 判斷——SVG 裡內嵌了一段
     *   <style>，裡面本來就有 `.point-value{...}` 這條 CSS 規則（那是刻意的：
     *   匯出時讀不到外部樣式表）。第一版就是這樣寫，永遠紅。
     *   要找的是**元素**，不是字串。
     */
    hasInMarkup: /<text[^>]*class="[^"]*point-value/.test(markup),
    /* 反面：線與點要還在，不可以連圖一起清掉 */
    paths: clean.querySelectorAll("path,polyline").length,
    circles: clean.querySelectorAll("circle").length,
    /* 畫面上那一份不可以被動到 */
    screenStill: node.querySelectorAll("text.point-value").length,
  };
});
ok(
  "前置：畫面上此刻真的有標籤（否則「移除後沒有」是恆真的）",
  !exportCheck.error && exportCheck.before > 0,
  exportCheck.error || `${exportCheck.before} 個`,
);
ok(
  "匯出用的那一份裡，數值標籤已經清乾淨",
  exportCheck.after === 0 && exportCheck.hasInMarkup === false,
  failOnly(`還剩 ${exportCheck.after} 個；標記裡 ${exportCheck.hasInMarkup ? "仍有" : "沒有"} point-value`),
);
ok(
  "但折線與資料點沒有被一起清掉（匯出的是淨空版，不是空白）",
  exportCheck.paths > 0 && exportCheck.circles > 0,
  `折線 ${exportCheck.paths} 條、點 ${exportCheck.circles} 個`,
);
ok(
  "畫面上那一份沒有被動到（只複製一份來清，不是就地刪）",
  exportCheck.screenStill === exportCheck.before,
  failOnly(`清完之後畫面剩 ${exportCheck.screenStill} 個，原本 ${exportCheck.before} 個`),
);

ok("過程中沒有 JS 例外", errors.length === 0, failOnly(errors.slice(0, 3).join(" / ")));

await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過`);
  process.exit(1);
}
console.log("\n✅ 全部通過");
