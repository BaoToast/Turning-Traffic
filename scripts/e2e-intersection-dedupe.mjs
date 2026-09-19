/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-23：主工具列的「路口」清單，一個路口只能出現一次
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16（附圖）：
 *   「路口顯示異常，明明只有N條路口，系統卻自己建立的站號反覆出現相同的調查點位」
 *
 * 成因：清單原本用 `record.station` 當鍵，而**站號是逐季的**
 *（同一個路口在 5 個季度是 T1-01、T2-01、T3-01…），
 * 於是拉開季別區間之後，同一個路口在清單裡出現 5 次。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**測資一定要讓同一個路口在不同季有不同站號**。
 *     既有的 seed-state 兩季都用 S01-03，那種測資**永遠不會重複**，
 *     驗出來的綠色不算數——所以這一支自己組一份測資。
 * 二、不可以只驗「清單長度＝路口數」。要驗**名稱真的不重複**，
 *     否則把清單截斷成前 N 個也會過。
 * 三、**選了那個路口之後，別季的資料不可以被篩掉**。
 *     只帶第一個站號的實作會讓清單變乾淨、資料卻少一半——
 *     那比重複出現更糟，而且畫面上不會有任何錯誤。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages-dist");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] || "application/octet-stream",
  });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/*
 * ── 測資：同一個路口，三季三個站號 ────────────────────────────
 *
 * ⚠️ 站號刻意做成 T1-01／T2-01／T3-01（與使用者實機看到的形狀相同），
 *   而路口名稱三季完全一樣——那正是要被合併成一項的情況。
 * ⚠️ 另外放一個只在某一季出現的路口，驗「合併不可以把別的路口吃掉」。
 * ⚠️ 站號一律用示範值（A00T00／T?-0?），不可以用真實站號。
 */
const seed = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
const template = seed.records[0];
const QUARTERS = ["115Q1", "115Q2", "115Q3"];
seed.records = QUARTERS.map((quarter, index) => ({
  ...template,
  quarter,
  station: `T${index + 1}-01`,
  name: "示範1－示範一路口",
})).concat([
  {
    ...template,
    quarter: "115Q3",
    station: "T3-09",
    name: "示範2－示範二路口",
  },
]);

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1700, height: 1100 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.dismiss());
await page.addInitScript(
  (value) => localStorage.setItem("turning-traffic-state-v2", value),
  JSON.stringify(seed),
);
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2200);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

/* 把季別區間拉到涵蓋三季——不拉開的話清單本來就只有一季，整支恆真。 */
await page.selectOption('[data-testid="mt-quarter-from"]', QUARTERS[0]);
await page.waitForTimeout(500);
await page.selectOption('[data-testid="mt-quarter-to"]', QUARTERS[2]);
await page.waitForTimeout(900);
ok(
  "前置：季別區間真的涵蓋三季（不涵蓋的話整支恆真）",
  (await page.inputValue('[data-testid="mt-quarter-from"]')) === QUARTERS[0] &&
    (await page.inputValue('[data-testid="mt-quarter-to"]')) === QUARTERS[2],
  `${await page.inputValue('[data-testid="mt-quarter-from"]')}～${await page.inputValue('[data-testid="mt-quarter-to"]')}`,
);

/* ⚠️ 面板是 React 條件渲染的：點開之後要**等一個影格**再讀，
   同一個 evaluate 裡點完就讀一定是 0 筆（第一版就是這樣紅的）。 */
await page.locator('[data-testid="mt-intersections"]').click();
await page.waitForTimeout(500);
const options = await page.evaluate(() => {
  const panel = document.querySelector(".multi-picker-panel");
  return [...(panel?.querySelectorAll("label") ?? [])].map((node) => ({
    value: node.querySelector("input")?.value ?? "",
    text: (node.textContent || "").replace(/\s+/g, ""),
  }));
});
ok("前置：讀得到路口清單", Array.isArray(options) && options.length > 0, String(options?.length));

const texts = options.map((item) => item.text);
ok(
  "⚠️ ① 同一個路口只出現**一次**（站號逐季不同，不可以各算一項）",
  texts.filter((text) => text.includes("示範一路口")).length === 1,
  texts.join(" ／ "),
);
ok(
  "⚠️ ① 清單裡沒有任何重複的名稱",
  new Set(texts).size === texts.length,
  texts.join(" ／ "),
);
ok(
  "① 合併不可以把別的路口吃掉（只在某一季出現的那一個要還在）",
  texts.some((text) => text.includes("示範二路口")),
  texts.join(" ／ "),
);

/*
 * ⚠️ ② 關鍵：選了那個路口之後，**三季的資料都要留著**。
 *   只帶第一個站號的實作會讓清單變乾淨、資料卻只剩一季——
 *   而且畫面上不會有任何錯誤訊息。
 */
const picked = await page.evaluate(() => {
  const panel = document.querySelector(".multi-picker-panel");
  const label = [...(panel?.querySelectorAll("label") ?? [])].find((node) =>
    (node.textContent || "").includes("示範一路口"),
  );
  const input = label?.querySelector("input");
  const value = input?.value ?? "";
  input?.click();
  return value;
});
await page.waitForTimeout(900);
await page.locator('[data-testid="mt-intersections"]').click();
await page.waitForTimeout(400);
ok(
  "⚠️ ② 那一項的值要帶著**全部三個站號**（只帶一個＝別季的資料會被篩掉）",
  picked.split("|").length === 3 &&
    ["T1-01", "T2-01", "T3-01"].every((station) => picked.includes(station)),
  picked,
);
ok(
  "② 勾起來之後主工具列的摘要要說出選了 1 個路口（不是 3 個）",
  (await page.locator('[data-testid="mt-summary"]').innerText()).includes(
    "1 個路口",
  ),
  await page.locator('[data-testid="mt-summary"]').innerText(),
);

/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-36：括號內容**不可以一律刪掉**——分不出「資料別」與「位置」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16：
 *   「我的檔案……的確會出現 A路段(平日)、B路段(假日) 這種，
 *     但平日和假日是分別兩筆資料……只要不要程式搞混成同一筆資料就好」
 *   「主工具列不要再出現，明明是同一路段，卻因為有站號，誤判為多個路段」
 *
 * ⚠️ **我在 2026-09-16 一度把這一節寫反了，留著當紀錄：**
 *   我原本要讓「（北向）」「（南向）」在主工具列上分成兩項，理由是
 *   「那是兩個不同的調查點」。既有測試把我擋下來——系統的設計是
 *   把它們當成同一個路口的**並存站號**（同一個路口、兩個方向各設一站），
 *   各處再依站號分開（歷季趨勢有站別切換）。括號一律刪掉也同時處理了
 *   「（湖內區）」行政區註記與「（修正版）」版本字尾，那些都必須刪。
 *
 *   所以清單合併是**對的**；真正要修的是**表格層**——
 *   車種組成表原本直接吃那份去重清單，兩個站只畫一列、另一站靜靜消失
 *  （已於 X-35 改成一列一筆，見 `e2e-composition-rows.mjs`）。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、清單合併之後，**標籤不可以還掛著其中一種資料別**。
 *     「A路段（平日）（2 季）」會讓人以為假日那一筆不見了。
 * 二、清單的「（N 季）」標籤要驗 **N 真的是季數**。
 *     舊版用的是站號數，同一季有兩個站號時就寫成「2 季」——
 *     只驗「有沒有那個括號」抓不到。
 */
console.log("\n══ 三、括號裡是資料別就併、是位置就分開（X-36）══");
const identitySeed = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
const identityTemplate = identitySeed.records[0];
/*
 * ⚠️ 六筆刻意這樣排：
 *   ・示範一路：同一條路段，兩季（站號逐季不同）× 平日／假日 → 清單上 1 項、2 季
 *   ・示範交流道：同一季的北向與南向兩個調查點 → 清單上 2 項
 */
const IDENTITY_CASES = [
  { quarter: "115Q1", station: "T1-01", name: "示範一路（平日）", surveyType: "平日" },
  { quarter: "115Q1", station: "T1-01", name: "示範一路（假日）", surveyType: "假日" },
  { quarter: "115Q2", station: "T2-01", name: "示範一路（平日）", surveyType: "平日" },
  { quarter: "115Q1", station: "T1-08", name: "示範交流道（北向）", surveyType: "平日" },
  { quarter: "115Q1", station: "T1-09", name: "示範交流道（南向）", surveyType: "平日" },
];
identitySeed.records = IDENTITY_CASES.map((item, index) => ({
  ...identityTemplate,
  id: `${identityTemplate.id}-x36-${index}`,
  quarter: item.quarter,
  station: item.station,
  name: item.name,
  rawName: item.name,
  surveyType: item.surveyType,
  intersectionId: `X36-${item.station}-${item.surveyType}`,
}));
const identityPage = await (
  await browser.newContext({ viewport: { width: 1700, height: 1100 }, locale: "zh-TW" })
).newPage();
identityPage.on("pageerror", (event) => errors.push(String(event.message)));
identityPage.on("dialog", (event) => event.dismiss());
await identityPage.addInitScript(
  (value) => localStorage.setItem("turning-traffic-state-v2", value),
  JSON.stringify(identitySeed),
);
await identityPage.goto(base, { waitUntil: "networkidle" });
await identityPage.waitForTimeout(2200);
/* ⚠️ 這是**另開的第二個工作階段**，也要先展開主工具列（X-78）。 */
await ensureToolbarOpen(identityPage);
/* 季別區間拉開，才驗得到「同一路段跨季併成一項」。 */
await identityPage.selectOption('[data-testid="mt-quarter-from"]', "115Q1");
await identityPage.waitForTimeout(500);
await identityPage.selectOption('[data-testid="mt-quarter-to"]', "115Q2");
await identityPage.waitForTimeout(1000);
await identityPage.locator('[data-testid="mt-intersections"]').click();
await identityPage.waitForTimeout(600);
const identityOptions = await identityPage.evaluate(() => {
  const panel = document.querySelector(".multi-picker-panel");
  return [...(panel?.querySelectorAll("label") ?? [])].map((node) => ({
    value: node.querySelector("input")?.value ?? "",
    text: (node.textContent || "").replace(/\s+/g, ""),
  }));
});
const identityTexts = identityOptions.map((item) => item.text);
ok("前置：讀得到路口清單", identityOptions.length > 0, identityTexts.join(" ／ "));
ok(
  "⚠️ ③ 括號裡是**資料別**就併：「示範一路（平日）」與「（假日）」只出現一次",
  identityTexts.filter((text) => text.includes("示範一路")).length === 1,
  identityTexts.join(" ／ "),
);
ok(
  "⚠️ ③ 標籤**不可以**還掛著其中一種資料別（會讓人以為另一天不見了）",
  !identityTexts.some((text) => /（平日）|（假日）/.test(text)),
  identityTexts.join(" ／ "),
);
/*
 * ⚠️ 北向與南向在清單上是**同一項**——那是刻意的（並存站號），
 *   不是缺陷。要分開的地方是各張表自己逐筆列（X-35）。
 *   這一條驗的是「那一項的值把兩個站號都帶上了」：
 *   只帶一個的話，使用者選了它，另一站的資料會被靜靜篩掉。
 */
const interchange = identityOptions.find((item) => item.text.includes("交流道"));
ok(
  "⚠️ ③ 並存站號（北向／南向）合併成一項，但值要帶上**兩個**站號",
  Boolean(interchange) &&
    interchange.value.split("|").includes("T1-08") &&
    interchange.value.split("|").includes("T1-09"),
  `${interchange?.text} → ${interchange?.value}`,
);
ok(
  "⚠️ ③ 並存站號那一項的標籤要把**兩個站的名字都寫出來**（只寫其中一個＝另一站看起來不見了）",
  (interchange?.text ?? "").includes("北向") &&
    (interchange?.text ?? "").includes("南向"),
  interchange?.text ?? "",
);
ok(
  "③ 清單總共兩項（示範一路、示範交流道）",
  identityOptions.length === 2,
  `實測 ${identityOptions.length} 項：${identityTexts.join(" ／ ")}`,
);
/*
 * ⚠️ 「（N 季）」的 N 要是**季數**。舊版拿站號數當季數：
 *   示範一路在 115Q1 有 T1-01（平日、假日兩筆共用同一個站號）、
 *   115Q2 有 T2-01 → 站號 2 個、季 2 個，這一筆剛好看不出差別；
 *   所以下面另外驗「同一季兩個站號**不可以**寫成 2 季」。
 */
const oneRoad = identityTexts.find((text) => text.includes("示範一路")) ?? "";
ok(
  "⚠️ ③ 跨兩季的那一項標籤寫「2 季」",
  /2季/.test(oneRoad),
  oneRoad,
);
ok(
  "⚠️ ③ 只有一季的路口**不可以**被寫成多季（舊版拿站號數當季數：兩個並存站號＝「2 季」）",
  !/\d+季/.test(interchange?.text ?? ""),
  interchange?.text ?? "",
);
await identityPage.close();

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 路口清單：同一個路口只列一次，而且選了之後跨季的資料都留著");
