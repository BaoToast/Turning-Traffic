/*
 * ══════════════════════════════════════════════════════════════════
 *  X-34②：歷季趨勢「一張圖多條線」——一個支線／轉向／車種一條線
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16：
 *   「我可以單選一個路段，就能看到一路段一張圖了，目前反而缺少一張圖多條線
 *     ……(這點三項程式都適用)」
 *
 * 這一支程式的「路段」對應到**支線／轉向／車種**：原本一次只挑得了一個，
 * 想比較幾個支線就得一個一個切，切完還要自己記上一個的數字。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**不可以只驗「線變多了」**。要驗每一條線的值**就是**單獨選那一個支線
 *     時畫出來的值——把同一條線畫三次、或畫出三條合計的等分，線數也會變多。
 * 二、**測資要讓各支線的值不一樣**。一樣的話「逐項」與「畫同一條線三次」
 *     分不出來，所以先逐一單選記下值，並明確驗它們互不相同。
 * 三、**識別不可以只靠顏色**。色盲讀者與灰階列印靠的是名稱，
 *     所以要驗圖例逐條列出名稱，而且滑鼠移上去的數字標籤會冠上名稱。
 * 四、**右側「季度變化」要跟著圖走**。圖畫五條、摘要只列一條（目前下拉那一個）
 *     是這次改動最可能留下的破口——摘要是會被抄進報告的那一份。
 * 五、**講稿只講一條**，所以畫面上一定要有一句話講明白，否則整段會被當成
 *     整張圖的結論抄走。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { serve } = await import(pathToFileURL(join(HERE, "serve.mjs")).href);
const { launchOptions } = await import(
  pathToFileURL(join(HERE, "chrome-path.mjs")).href
);
const seed = readFileSync(join(HERE, "seed-wide.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};
const stop = (why) => {
  console.error(`\n❌ ${why}——後面的條件會變成恆真，直接停。`);
  problems.push(why);
};

const server = await serve(8171);
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
await page.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 無痕時就算了，前置檢查會紅。 */
  }
}, seed);
await page.goto("http://127.0.0.1:8171/", { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
await page
  .locator('aside.sidebar nav button:has-text("歷季趨勢比較")')
  .first()
  .click();
await page.waitForTimeout(1200);

/* 單選一個統計範圍，畫面上才只有一張圖（比對才有唯一的對象）。 */
const amButton = page.locator('.segmented button:has-text("AM Peak")').first();
if (await amButton.count()) {
  await amButton.click();
  await page.waitForTimeout(900);
}

/** 目前 #trend-svg 上每一個資料點（值、線名、季別）。 */
const readPoints = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#trend-svg circle[data-value]")].map(
      (node) => ({
        value: Number(node.getAttribute("data-value")),
        series: node.getAttribute("data-series") || "",
        quarter: node.getAttribute("data-quarter") || "",
      }),
    ),
  );
const readLegend = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#trend-svg .trend-legend text")].map((node) =>
      (node.textContent || "").trim(),
    ),
  );
const setSelect = async (id, value) => {
  await page.evaluate(
    ([selectId, next]) => {
      const select = document.getElementById(selectId);
      if (!select) return;
      select.value = next;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [id, value],
  );
  await page.waitForTimeout(900);
};

/* ══ 前置：切到「單一支線」，而且支線要有兩個以上 ══════════════ */
console.log("\n══ 前置 ══");
await setSelect("trendMetric", "arm");
const armOptions = await page.evaluate(() =>
  [...(document.getElementById("trendMetricKey")?.options || [])].map((o) => ({
    value: o.value,
    label: (o.textContent || "").trim(),
  })),
);
const realArms = armOptions.filter((o) => o.value !== "__ALL__");
ok(
  "前置：指標切到「單一支線」，而且支線選單列得出來",
  realArms.length > 0,
  realArms.map((o) => o.label).join("、"),
);
if (realArms.length < 2)
  stop("這個路口只有一個支線，逐項分列與單選是同一張圖，測不出東西");

/* ══ 一、逐一單選，記下每一個支線自己的值 ══════════════════════ */
console.log("\n══ 一、每一個支線單獨看時的值 ══");
const solo = new Map();
for (const arm of realArms) {
  await setSelect("trendMetricKey", arm.value);
  const points = await readPoints();
  solo.set(arm.label, points.map((p) => p.value).sort((a, b) => a - b));
  console.log(`   ${arm.label}：${points.length} 點`);
}
const signatures = [...solo.values()].map((values) => values.join(","));
ok(
  "⚠️ ① 各支線的值互不相同（否則「逐項」與「同一條畫三次」分不出來）",
  new Set(signatures).size === signatures.length,
  `${new Set(signatures).size}／${signatures.length} 組不同`,
);
if (new Set(signatures).size < 2)
  stop("各支線的值完全一樣，測資本身不會觸發問題");

/* ══ 二、切到「全部（逐項一條線）」 ═══════════════════════════ */
console.log("\n══ 二、逐項一條線 ══");
const hasAllOption = armOptions.some((o) => o.value === "__ALL__");
ok(
  "② 支線選單裡有「全部（逐項一條線）」這一項",
  hasAllOption,
  armOptions.map((o) => o.label).join("／"),
);
if (!hasAllOption) stop("沒有這個選項，後面每一條都沒得驗");
await setSelect("trendMetricKey", "__ALL__");
const allPoints = await readPoints();
const drawnSeries = [...new Set(allPoints.map((p) => p.series))];
ok(
  "⚠️ ② 圖上每一個支線各一條線（線名認得出來）",
  realArms.every((arm) => drawnSeries.includes(arm.label)),
  `圖上的線：${drawnSeries.join("、") || "（一條都認不出來）"}`,
);
/*
 * ⚠️ 這一條才是重點：逐項畫出來的值必須**就是**單選時的那幾個。
 *   少了它，一個「把路口總量等分成 N 條」的實作也會全綠。
 */
let sameAsSolo = true;
const mismatch = [];
for (const arm of realArms) {
  const drawn = allPoints
    .filter((p) => p.series === arm.label)
    .map((p) => p.value)
    .sort((a, b) => a - b);
  const want = solo.get(arm.label) || [];
  if (drawn.join(",") !== want.join(",")) {
    sameAsSolo = false;
    mismatch.push(`${arm.label}：逐項 [${drawn}] ≠ 單選 [${want}]`);
  }
}
ok(
  "⚠️ ② 每一條線的值就是單獨選那個支線時的值",
  sameAsSolo,
  mismatch.join("；"),
);

/* ══ 三、識別不可以只靠顏色 ═══════════════════════════════════ */
console.log("\n══ 三、名稱，不是只有顏色 ══");
const legend = await readLegend();
ok(
  "⚠️ ③ 圖例逐條列出支線名稱（色盲讀者與灰階列印靠的是名稱）",
  realArms.every((arm) => legend.some((text) => text === arm.label)),
  `圖例：${legend.join("、") || "（沒有圖例）"}`,
);
const firstPoint = page.locator("#trend-svg circle[data-value]").first();
await firstPoint.hover({ force: true }).catch(() => {});
await page.waitForTimeout(500);
const hoverLabels = await page.evaluate(() =>
  [...document.querySelectorAll("#trend-svg text.point-value")].map((node) =>
    (node.textContent || "").trim(),
  ),
);
ok(
  "⚠️ ③ 滑鼠移上去的數字標籤會冠上支線名稱（不是只有一個數字）",
  hoverLabels.length > 0 &&
    hoverLabels.some((text) =>
      realArms.some((arm) => text.startsWith(arm.label)),
    ),
  hoverLabels.join(" | ") || "（hover 之後一個標籤都沒有）",
);
ok(
  "⚠️ ③ 同一時間只亮一條線的標籤（鍵要含對象，不然全部一起亮）",
  hoverLabels.length <= 1,
  `${hoverLabels.length} 個標籤`,
);

/* ══ 四、右側「季度變化」要跟著圖走 ═══════════════════════════ */
console.log("\n══ 四、季度變化與圖同一份 ══");
const summaryText = await page.evaluate(
  () =>
    document.getElementById("trend-summary")?.textContent?.replace(/\s+/g, " ") ??
    "",
);
ok(
  "⚠️ ④ 季度變化逐支線列出，不是只列目前下拉那一個",
  realArms.every((arm) => summaryText.includes(arm.label)),
  realArms
    .filter((arm) => !summaryText.includes(arm.label))
    .map((arm) => arm.label)
    .join("、") || "全部都在",
);

/* ══ 五、講稿只講一條，畫面上要講明白 ════════════════════════ */
console.log("\n══ 五、講稿只涵蓋一條線 ══");
const caveat = page.locator('[data-testid="trend-script-one-line"]');
const caveatText = (await caveat.count())
  ? (await caveat.first().textContent()) || ""
  : "";
ok(
  "⚠️ ⑤ 畫面上明說「這一段只講其中一條線」",
  Boolean(caveatText) && /只講其中的/.test(caveatText),
  caveatText ? caveatText.replace(/\s+/g, " ").slice(0, 70) : "畫面上沒有這一句",
);

/* ══ 六、切回單選要完全回到舊行為 ═════════════════════════════ */
console.log("\n══ 六、切回單選 ══");
await setSelect("trendMetricKey", realArms[0].value);
const backPoints = await readPoints();
/*
 * ⚠️ 單選時線名是**統計範圍**（「AM Peak」），不是支線名稱——
 *   一條線的時候標題已經說了那是哪一個支線，標籤再冠一次是多餘的。
 *   所以這裡驗的是「只有一條線」＋「值回到單選時那一組」。
 */
ok(
  "⑥ 切回單一支線之後，圖上只剩一條線，而且值回到單選時那一組",
  new Set(backPoints.map((p) => p.series)).size === 1 &&
    backPoints
      .map((p) => p.value)
      .sort((a, b) => a - b)
      .join(",") === (solo.get(realArms[0].label) || []).join(","),
  `${new Set(backPoints.map((p) => p.series)).size} 條線：${[
    ...new Set(backPoints.map((p) => p.series)),
  ].join("、")}`,
);

ok("沒有任何 JavaScript 例外", errors.length === 0, errors.join(" | "));

await browser.close();
await server.close?.();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過：`);
  problems.forEach((line) => console.error(`   ・${line}`));
  process.exit(1);
}
console.log("\n✅ 歷季趨勢「一個支線一條線」全部通過");
process.exit(0);
