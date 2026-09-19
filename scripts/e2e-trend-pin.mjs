/*
 * ══════════════════════════════════════════════════════════════════
 *  歷季趨勢圖：捲說明時圖要看得到，而且**標題與單位不可以被切掉**
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-10 實測回報（三件事，成因各不相同）：
 *
 *   ①「現在我在滾動說明時，的確能看到整張圖了，但並不是整張圖能完整看到，
 *      **圖標題和單位就消失在畫面了**」
 *   ②「如果我繼續往下看其他圖片，**我該如何解除圖片固定的效果?**」
 *   ③「查看完說明後，想換下一個路段的圖來看結果，
 *      **我又得一直往上滑到功能列**」
 *
 * 對應的修法：
 *   ① 釘住的東西要**小到放得進視窗**（圖跟著縮），不是讓容器溢出。
 *      容器一溢出，被切掉的一定是最上面那幾行——也就是標題。
 *   ② **不需要按鈕**：sticky 只在自己的包含區塊裡黏住，捲出去就自動放開。
 *   ③ 把精簡的選擇器一起帶進釘住區。
 *
 * ── ⚠️ 這一支刻意迴避的假通過 ────────────────────────────────
 *
 * 一、只驗「圖還看得到」會**漏掉標題**——那正是壞掉的那一項。
 *     一定要單獨驗「標題與單位在視窗內」。
 * 二、只驗「有 position: sticky」不夠：容器比視窗高的時候它照樣是 sticky，
 *     使用者看到的仍然是被切掉的標題。要**實際捲到說明底部再量座標**。
 * 三、只驗「捲到底時還黏著」不夠：那樣「永遠黏著」也會過，
 *     而永遠黏著正是使用者問「怎麼解除」的原因。
 *     要驗**捲過這一整區之後圖不再黏住**。
 * 四、選擇器要驗「換了之後圖就地更新**而且畫面沒有捲動**」，
 *     只驗「有下拉」會被「放一個沒接線的下拉」騙過去。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8255;
const seed = readFileSync(join(here, "seed-wide.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
/* 視窗要夠高才會啟用 sticky（矮螢幕刻意不啟用），這裡用一般筆電的高度。 */
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await installStateHelpers(page);
await page.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 無痕或封鎖時就算了，下面的前置檢查會紅。 */
  }
}, seed);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
await page.locator('nav button:has-text("歷季趨勢比較")').first().click();
await page.waitForTimeout(1500);

/* 選一個有多季資料的路口，否則圖畫不出來，下面全部變成恆真。 */
const picker = page.locator(".trend-controls select").first();
await picker
  .selectOption({ label: "示範路－示範二路－示範三街路口" })
  .catch(() => {});
await page.waitForTimeout(900);

ok("前置：折線圖畫得出來", (await page.locator("#trend-svg").count()) > 0);
ok(
  "前置：說明欄位在（沒有它就沒有「捲說明」這件事）",
  (await page.locator("#trendScript").count()) > 0,
);

const geometry = async () =>
  page.evaluate(() => {
    const chart = document.querySelector(".trend-chart");
    const head = chart?.querySelector(".panel-head");
    const unit = head?.querySelector(".status-dot");
    const svg = document.querySelector("#trend-svg");
    const script = document.querySelector("#trendScript");
    const box = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        height: Math.round(rect.height),
      };
    };
    return {
      viewport: window.innerHeight,
      position: chart ? getComputedStyle(chart).position : "",
      chart: box(chart),
      head: box(head),
      unit: box(unit),
      svg: box(svg),
      script: box(script),
      layout: box(document.querySelector(".trend-layout")),
      scrollY: Math.round(window.scrollY),
    };
  });

console.log("\n══ 一、釘住區必須放得進視窗 ══");
const atTop = await geometry();
console.log("   ", JSON.stringify(atTop));
ok("釘住區是 sticky", atTop.position === "sticky", atTop.position);
/*
 * ⚠️ 這一條是①的根因守門：容器比視窗高的話，sticky 只保證上緣貼住，
 *    被切掉的一定是最上面那幾行（標題與單位）。
 */
ok(
  "⚠️ 釘住區的高度不可以超過視窗（超過就一定會切掉標題）",
  atTop.chart.height <= atTop.viewport,
  `釘住區 ${atTop.chart.height}px／視窗 ${atTop.viewport}px`,
);

console.log("\n══ 二、捲到說明最底部時，標題與單位仍然要在視窗內 ══");
/*
 * ⚠️ 捲到「說明的底部」而不是「頁面的底部」：
 *    頁面底部已經捲出 .trend-layout，圖本來就該放開了（那是第三段要驗的）。
 *    這一段要驗的是**還在這一區裡面**的時候。
 */
await page.evaluate(() => {
  const script = document.querySelector("#trendScript");
  if (!script) return;
  const rect = script.getBoundingClientRect();
  window.scrollTo({
    top: window.scrollY + rect.bottom - window.innerHeight + 40,
    behavior: "auto",
  });
});
await page.waitForTimeout(700);
const scrolled = await geometry();
console.log("   ", JSON.stringify(scrolled));
ok(
  "捲到說明底部之後，畫面真的有捲動（沒捲的話下面全部是恆真）",
  scrolled.scrollY > atTop.scrollY + 100,
  `${atTop.scrollY} → ${scrolled.scrollY}`,
);
ok(
  "⚠️ 圖的**標題**仍然在視窗內（這就是使用者回報壞掉的那一項）",
  scrolled.head.top >= -2 && scrolled.head.bottom <= scrolled.viewport,
  `標題 ${scrolled.head.top}～${scrolled.head.bottom}／視窗 0～${scrolled.viewport}`,
);
ok(
  "⚠️ **單位**也仍然在視窗內",
  scrolled.unit &&
    scrolled.unit.top >= -2 &&
    scrolled.unit.bottom <= scrolled.viewport,
  scrolled.unit
    ? `單位 ${scrolled.unit.top}～${scrolled.unit.bottom}`
    : "找不到單位",
);
ok(
  "折線圖本身也整張在視窗內",
  scrolled.svg.top >= -2 && scrolled.svg.bottom <= scrolled.viewport + 2,
  `圖 ${scrolled.svg.top}～${scrolled.svg.bottom}`,
);

console.log("\n══ 三、捲過這一整區之後要**自動放開**（不是靠按鈕）══");
await page.evaluate(() =>
  window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" }),
);
await page.waitForTimeout(700);
const bottom = await geometry();
console.log("   ", JSON.stringify(bottom));
/*
 * ⚠️ 「捲到頁尾就會放開」**不一定驗得到**：說明欄如果不夠長，
 *   捲到頁尾時 .trend-layout 根本還沒捲出畫面，圖當然還黏著——
 *   那是正確行為，拿它當紅字是假紅。
 *
 * 要驗的是**機制**：sticky 只在包含區塊裡黏住，所以圖的下緣
 * 永遠不會超過 .trend-layout 的下緣。包含區塊若被設成整個內容區，
 * 圖就會黏過這一整區、跟著使用者到下一張圖旁邊——那才是使用者
 * 問「我該如何解除」的情形，而這一條抓得到它。
 */
ok(
  "⚠️ 圖的下緣不會超出 .trend-layout（＝包含區塊限制在這一區，捲出去就自動放開）",
  bottom.layout && bottom.chart.bottom <= bottom.layout.bottom + 2,
  `圖下緣 ${bottom.chart.bottom}／區塊下緣 ${bottom.layout?.bottom}`,
);
ok(
  "沒有出現「取消固定」之類的按鈕（正確做法是修範圍，不是加按鈕）",
  (await page.locator('button:has-text("取消固定")').count()) === 0,
);

/*
 * ══════════════════════════════════════════════════════════════════
 *  四、X-53：釘住區裡**不可以**再有一組「路口／指標」
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16（附圖，兩組都圈起來）：
 *   「歷季趨勢自身工具列，其中路口和指標與自身工具列重複了，
 *     導致無法選擇路口，請保留上方那個比較完整的自身工具列的功能」
 *
 * ⚠️ 這一節原本驗的是**相反的事**（2026-09-10 那次要的「釘住區裡也能換路段」）。
 *   兩次交辦互相衝突，依新的那一次改；舊的那一節不是刪掉了事，
 *   是**反過來守**，否則哪天有人「好心」把它加回來不會有人發現。
 *
 * ⚠️ 不可以只驗 `.trend-pinned-controls` 這個 class 不存在——
 *   換個 class 名稱照樣是兩組下拉。所以驗的是**整個圖表區裡有幾個
 *   下拉、上方功能列裡有幾個**，用「路口」這個標籤實際去數。
 */
console.log("\n══ 四、X-53：圖表區裡不可以再有第二組「路口／指標」 ══");
await page.evaluate(() => {
  const script = document.querySelector("#trendScript");
  if (!script) return;
  const rect = script.getBoundingClientRect();
  window.scrollTo({ top: window.scrollY + rect.top - 60, behavior: "auto" });
});
await page.waitForTimeout(500);
const duplicated = await page.evaluate(() => {
  /** 一個 <label> 的文字標籤（去掉底下 select 的選項文字）。 */
  const labelOf = (label) => {
    const clone = label.cloneNode(true);
    clone.querySelectorAll("select, option").forEach((node) => node.remove());
    return (clone.textContent || "").replace(/\s+/g, "");
  };
  const count = (root, wanted) =>
    root
      ? [...root.querySelectorAll("label")].filter(
          (label) =>
            label.querySelector("select") && labelOf(label) === wanted,
        ).length
      : -1;
  const chart = document.querySelector(".trend-layout > .trend-chart");
  const controls = document.querySelector(".trend-controls");
  return {
    chartRoad: count(chart, "路口"),
    chartMetric: count(chart, "指標"),
    controlsRoad: count(controls, "路口"),
    controlsMetric: count(controls, "指標"),
    legacyClass: document.querySelectorAll(".trend-pinned-controls").length,
  };
});
ok(
  "⚠️ 圖表區裡**沒有**「路口」下拉（那一組是重複的，使用者指名移除）",
  duplicated.chartRoad === 0,
  `圖表區有 ${duplicated.chartRoad} 個`,
);
ok(
  "⚠️ 圖表區裡**沒有**「指標」下拉",
  duplicated.chartMetric === 0,
  `圖表區有 ${duplicated.chartMetric} 個`,
);
ok(
  "舊的 .trend-pinned-controls 整塊不存在",
  duplicated.legacyClass === 0,
  `還有 ${duplicated.legacyClass} 塊`,
);
/*
 * ⚠️ 上面三項若只是「把上方功能列也一起砍了」也會全綠——
 *   所以一定要反過來驗：使用者指名**保留**的那一組還在，而且真的能用。
 */
ok(
  "⚠️ 使用者指名保留的上方功能列裡，「路口」下拉剛好一個",
  duplicated.controlsRoad === 1,
  `上方功能列有 ${duplicated.controlsRoad} 個`,
);
ok(
  "⚠️ 上方功能列裡「指標」下拉剛好一個",
  duplicated.controlsMetric === 1,
  `上方功能列有 ${duplicated.controlsMetric} 個`,
);
{
  const top = page.locator('.trend-controls [data-testid="trend-intersection"]');
  const before = await page.evaluate(
    () =>
      document.querySelector(".trend-chart .panel-head h2")?.textContent ?? "",
  );
  const labels = await top.locator("option").allTextContents();
  const other = labels.find((text) => text !== before.split(" · ")[0]);
  if (other) {
    await top.selectOption({ label: other });
    await page.waitForTimeout(900);
    const after = await page.evaluate(
      () =>
        document.querySelector(".trend-chart .panel-head h2")?.textContent ??
        "",
    );
    ok(
      "⚠️ 用上方那一組換路口，圖的標題真的跟著換（不是砍掉重複的就算了）",
      after !== before && after.includes(other),
      `${before} → ${after}`,
    );
  } else {
    ok("測資裡只有一個路口，換不了——這一項驗不到東西", false, labels.join("／"));
  }
}

/*
 * ══════════════════════════════════════════════════════════════════
 *  四之二、1080p 螢幕開 125% 縮放時**一定要**釘住
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11 回報「圖會直接隨著畫面消失，功能是否壞掉了？」
 *
 * 功能沒有壞，是「螢幕太矮就不釘」那道門檻訂得太高：
 *   1920×1080 ＋ Windows 顯示縮放 **125%**（1080p 螢幕的出廠預設）
 *   → CSS 像素 1536×864，再扣掉分頁列／網址列／書籤列／工作列
 *   → 可視高度約 **712 CSS px**，剛好落在舊門檻 720 之下。
 *   而寬度 1536 仍然 ≥ 1400，所以版面還是兩欄——
 *   使用者看到的就是「兩欄還在、圖卻不黏了」，完全像壞掉。
 *
 * ⚠️ 這一項守的是**那個具體的尺寸**，不是「sticky 這個屬性存在」。
 *   只驗屬性的話，門檻再被調回 720 也照樣綠。
 */
console.log("\n══ 四之二、1080p @125% 縮放（1536×712）一定要釘住 ══");
await page.setViewportSize({ width: 1536, height: 712 });
await page.waitForTimeout(600);
const scaled = await page.evaluate(() => ({
  position: getComputedStyle(
    document.querySelector(".trend-layout > .trend-chart"),
  ).position,
  twoColumn:
    getComputedStyle(document.querySelector(".trend-layout"))
      .gridTemplateColumns.split(" ").length === 2,
}));
ok(
  "1536×712（1080p 開 125% 縮放）仍然是兩欄版面",
  scaled.twoColumn,
  `欄數判定 ${scaled.twoColumn}`,
);
ok(
  "⚠️ 而且圖要釘住——兩欄卻不釘，使用者看到的就是「功能壞掉」",
  scaled.position === "sticky",
  `position=${scaled.position}`,
);
await page.evaluate(() => window.scrollTo(0, 900));
await page.waitForTimeout(400);
const scaledGeom = await page.evaluate(() => {
  /*
   * ⚠️ 判準要跟著「浮在上面那幾層」走，不可以寫死。
   *   這一條原本寫「圖上緣要在 0～40px」——那是**主工具列還不存在時**
   *   算出來的。工具列 2026-09-15 起常駐（而且可收合、窄視窗會換行），
   *   圖自然停在 261px（上方功能列 72 ＋ 工具列 177 ＋ 留白 12），守門就紅了——
   *   但畫面其實是對的：圖剛好停在工具列下緣，沒有被切掉。
   *   要驗的是「圖有沒有被浮在上面的東西蓋住」，不是「離頂端幾像素」。
   */
  const height = (selector) => {
    const node = document.querySelector(selector);
    return node && getComputedStyle(node).position === "sticky"
      ? node.getBoundingClientRect().height
      : 0;
  };
  const floating = Math.round(height(".topbar") + height(".main-toolbar"));
  return {
    top: Math.round(
      document
        .querySelector(".trend-layout > .trend-chart")
        .getBoundingClientRect().top,
    ),
    floating,
  };
});
ok(
  "捲下去之後圖真的停在浮動列的正下方（不是只有屬性寫著 sticky）",
  scaledGeom.top >= scaledGeom.floating - 1 &&
    scaledGeom.top <= scaledGeom.floating + 40,
  `圖上緣 ${scaledGeom.top}px；浮在上面的共 ${scaledGeom.floating}px（要落在 ${scaledGeom.floating - 1}～${scaledGeom.floating + 40}）`,
);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);

console.log("\n══ 五、螢幕矮的時候不啟用（釘住只會把說明擠到看不見）══");
await page.setViewportSize({ width: 1600, height: 620 });
await page.waitForTimeout(500);
const short = await page.evaluate(() => ({
  position: getComputedStyle(document.querySelector(".trend-chart")).position,
  innerHeight: window.innerHeight,
  /* 直接問瀏覽器媒體查詢的結果，才分得出「條件沒成立」與「條件寫錯」。 */
  matches: window.matchMedia("(min-width: 1400px) and (min-height: 660px)").matches,
}));
ok(
  "視窗高度 620px 時不啟用 sticky（矮螢幕釘住只會把說明擠到看不見）",
  short.position !== "sticky",
  JSON.stringify(short),
);

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 3).join(" ｜ "));

await browser.close();
server.close();
console.log(
  problems.length
    ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}`
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
