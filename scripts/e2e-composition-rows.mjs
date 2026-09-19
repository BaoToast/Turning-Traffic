/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-35：「各路口車種組成」表**一列一筆調查**，不可以靠名稱合併
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-16 全面盤點查到，使用者裁示「依你建議執行」。
 *
 * 成因：那張表的資料來源先用**路口名稱**去重（`recordIntersectionKey`），
 * 而名稱在比對前會把**括號內的字整個刪掉**（原本是為了吃掉「（三叉路口）」
 * 「（修正版）」這類雜訊）。於是：
 *   ・同一個交流道的「（北向）」「（南向）」兩個**不同的調查點**變成同一個 key；
 *   ・同一站號的平日與假日也是同一個 key。
 * 用的是 Map，所以**後到的蓋掉先到的**，被蓋掉那幾筆就此消失，
 * 而畫面上沒有任何一個字提到它們存在過。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**測資一定要讓兩筆的名稱正規化之後相同、站號不同**。
 *     既有 seed 的兩筆名稱本來就不同，那種測資**永遠不會觸發合併**，
 *     驗出來的綠色不算數——所以這一支自己組測資。
 * 二、不可以只驗「列數等於筆數」。要驗**每一個站號都真的出現在表上**，
 *     否則把某一列複製兩次也會過。
 * 三、要**同時驗日別那一半**（同站號的平日與假日）。只驗站號的話，
 *     一個「用站號去重、仍然把兩天併成一列」的實作照樣全綠——
 *     而那正是合併的另一半。
 * 四、日別欄要**在有兩種日別時才出現**：永遠顯示會在單一日別時多一欄噪音，
 *     永遠不顯示則是兩列長得一模一樣、分不出誰是誰。兩種都要驗。
 * 五、⚠️ **不可以改到主工具列的路口清單**。那份清單用名稱合併是對的
 *     （X-23：同一個路口跨季有不同站號，清單要合併成一項）。
 *     用途相反：清單要合併、表格要攤開。這裡一併驗清單沒有被改壞。
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
 * ── 測資 ──────────────────────────────────────────────────────
 *
 * ⚠️ 前兩筆的名稱只差在**括號裡**，正規化之後完全相同——那正是要被誤判成
 *   同一個路口的情形。站號用示範值（不可以用真實站號）。
 * ⚠️ 第三筆與第一筆同站號、不同資料別（平日／假日），驗日別那一半。
 */
const seed = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
const template = seed.records[0];
const QUARTER = "115Q1";
const CASES = [
  { station: "T9-01", name: "示範交流道（北向）", surveyType: "平日" },
  { station: "T9-02", name: "示範交流道（南向）", surveyType: "平日" },
  { station: "T9-01", name: "示範交流道（北向）", surveyType: "假日" },
];
seed.records = CASES.map((item, index) => ({
  ...template,
  id: `${template.id}-x35-${index}`,
  quarter: QUARTER,
  station: item.station,
  name: item.name,
  rawName: item.name,
  surveyType: item.surveyType,
  /* ⚠️ intersectionId 要各自不同，否則連退路都指向同一個。 */
  intersectionId: `X35-${item.station}-${item.surveyType}`,
}));

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

const gotoPage = async (label) => {
  const found = await page.evaluate((text) => {
    const list = [...document.querySelectorAll("aside nav > div > button")].filter(
      (button) => !button.className.includes("nav-collapse"),
    );
    const target = list.find((button) => (button.textContent || "").includes(text));
    if (!target) return false;
    target.click();
    return true;
  }, label);
  await page.waitForTimeout(1200);
  return found;
};

/** 那張表目前的每一列（站號、名稱、資料別欄的文字）。 */
const tableRows = () =>
  page.evaluate(() => {
    const heads = [...document.querySelectorAll("section h2")];
    const head = heads.find((node) => (node.textContent || "").includes("車種組成"));
    const section = head?.closest("section");
    if (!section) return null;
    const headers = [...section.querySelectorAll("thead th")].map((th) =>
      (th.textContent || "").replace(/\s+/g, ""),
    );
    const rows = [...section.querySelectorAll("tbody tr")].map((tr) => ({
      cells: [...tr.querySelectorAll("td")].map((td) =>
        (td.textContent || "").replace(/\s+/g, " ").trim(),
      ),
      text: (tr.textContent || "").replace(/\s+/g, " ").trim(),
    }));
    return { headers, rows };
  });

console.log("\n══ 前置 ══");
ok("前置：側欄找得到「車種組成分析」", await gotoPage("車種組成分析"));
const view = await tableRows();
ok("前置：找得到「各路口…車種組成」那張表", view !== null);
if (!view) {
  console.error("找不到那張表，後面全部恆真，直接停。");
  await browser.close();
  server.close();
  process.exit(1);
}

/* ══ 一、一列一筆調查，一筆都不可以少 ══════════════════════════ */
console.log("\n══ 一、一列一筆調查 ══");
ok(
  "⚠️ ① 三筆調查就要三列（名稱正規化後相同的兩個站號，不可以被合併成一列）",
  view.rows.length === CASES.length,
  `實測 ${view.rows.length} 列：${view.rows.map((r) => r.text.slice(0, 22)).join(" ／ ")}`,
);
for (const station of [...new Set(CASES.map((item) => item.station))])
  ok(
    `⚠️ ① 站號 ${station} 出現在表上`,
    view.rows.some((row) => row.text.includes(station)),
    view.rows.map((r) => r.cells[0]).join(" ／ "),
  );
ok(
  "① 兩個不同的調查點都在（「（北向）」與「（南向）」是兩份調查，不是同一個路口的兩個方向）",
  view.rows.some((row) => row.text.includes("北向")) &&
    view.rows.some((row) => row.text.includes("南向")),
  view.rows.map((r) => r.cells[0]).join(" ／ "),
);

/* ══ 二、日別那一半 ══════════════════════════════════════════ */
console.log("\n══ 二、同一個站號的平日與假日是兩列 ══");
ok(
  "⚠️ ② 表上有「資料別」欄（同一站號兩列，沒有這一欄就分不出誰是誰）",
  view.headers.some((text) => text.includes("資料別")),
  view.headers.join("｜"),
);
const t901 = view.rows.filter((row) => row.text.includes("T9-01"));
ok(
  "⚠️ ② T9-01 的平日與假日各一列",
  t901.length === 2 &&
    t901.some((row) => row.text.includes("平日")) &&
    t901.some((row) => row.text.includes("假日")),
  t901.map((r) => r.text.slice(0, 30)).join(" ／ "),
);

/* ══ 三、只有一種資料別時，不要多一欄噪音 ══════════════════════ */
console.log("\n══ 三、只有一種資料別時不顯示那一欄 ══");
await page.selectOption('[data-testid="mt-day"]', "weekday");
await page.waitForTimeout(1200);
const weekdayOnly = await tableRows();
ok(
  "③ 篩成只看平日之後剩兩列",
  weekdayOnly?.rows.length === 2,
  `實測 ${weekdayOnly?.rows.length} 列`,
);
ok(
  "⚠️ ③ 只有一種資料別時**不顯示**「資料別」欄（永遠顯示會變成噪音）",
  !(weekdayOnly?.headers ?? []).some((text) => text.includes("資料別")),
  (weekdayOnly?.headers ?? []).join("｜"),
);
/*
 * ⚠️ 資料別的「全部」在甲案（2026-09-16）之後**不存在**了，預設值是並列。
 *   寫死 "all" 會讓 selectOption 一路重試到逾時，整支腳本被例外中斷——
 *   而中斷不是紅字，看起來像「還沒跑到」。期望值一律從程式裡取。
 */
const { DEFAULT_MAIN_FILTERS: DAY_DEFAULTS } = await import(
  "../app/main-filters.ts"
);
await page.selectOption('[data-testid="mt-day"]', DAY_DEFAULTS.day);
await page.waitForTimeout(1000);

/* ══ 四、主工具列的路口清單**不可以**被改壞 ══════════════════ */
console.log("\n══ 四、主工具列的路口清單要維持合併（X-23）══");
await page.locator('[data-testid="mt-intersections"]').click();
await page.waitForTimeout(600);
const options = await page.evaluate(() => {
  const panel = document.querySelector(".multi-picker-panel");
  return [...(panel?.querySelectorAll("label") ?? [])].map((node) =>
    (node.textContent || "").replace(/\s+/g, ""),
  );
});
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(400);
ok("前置：讀得到主工具列的路口清單", options.length > 0, String(options.length));
/*
 * ⚠️ 這裡驗的是「清單**沒有**變成一站一項」。
 *   兩個站號名稱正規化後相同，X-23 的規則是把它們併成一項；
 *   如果這次為了修表格而動到那份清單，這一條就會紅。
 */
ok(
  "⚠️ ④ 路口清單維持合併（三筆調查、兩個站號，清單上仍是 1 項）",
  options.length === 1,
  options.join(" ／ "),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log(
  "\n✅ 各路口車種組成：一列一筆調查、站號與資料別都分得開，主工具列的清單沒有被改壞",
);
