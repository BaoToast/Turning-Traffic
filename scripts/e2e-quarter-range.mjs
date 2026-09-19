/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列的「季度起訖區間」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「如果只有起訖區間，然後當起和迄是同一時間的話 就等於單季……
 *     主工具列一開始的起迄都是預設同一時間」
 *   「因為歷季趨勢圖我可能要找某一期間內的趨勢變化，
 *     不一定是從第一期看到最後一期」
 *
 * ── 這一支為什麼要這樣驗 ─────────────────────────────────────
 *
 * ⚠️⚠️ 2026-09-15 使用者**推翻**了先前的語意，這一支跟著改寫：
 *
 *   舊規則：起＝迄 ＝「沒有拉區間」＝ 趨勢圖畫全部。
 *   新規則：**起＝迄 ＝ 只有那一季**（三支統一）。使用者原話：
 *     「當起和迄是同一時間的話 就等於單季」。
 *   舊寫法是路口轉向自己的特例（`from === to` 時直接回傳全部紀錄），
 *   與另外兩支不一致，而且「選了單季卻畫出全部」本身就在說謊。
 *
 *   **預設值**另外一件事：這一支的預設改成 **起＝最早、迄＝最新**。
 *   理由是它的 quarterFrom 只餵四個地方（趨勢圖、路口下拉母體、結論草稿
 *   範圍、報告範圍），**沒有任何「本季」卡片吃它**，所以預設拉成全區間
 *   不動任何既有數字，而使用者一打開就看得到完整趨勢。
 *  （全日交通量的預設刻意**不**改，因為它的 quarterFrom 餵的是「本季」
 *    類的區塊，改了會讓整個儀表板從「本季總覽」變成「全部季度合計」。
 *    語意三支一致、預設值依各支主畫面的性質而定——這不是不一致。）
 *
 * ⚠️ 只驗「數字變了」不夠。把區間接到別的地方（例如接錯成篩掉全部）
 *   數字也會變。所以這裡量的是**X 軸上實際列出的季別**，
 *   而且逐一比對它們是否落在區間內、區間內的一季都沒少。
 *
 * ⚠️ 要用 seed-wide（16 季）。預設的 seed 只有兩季，
 *   「拉開區間之後少了幾季」在兩季上幾乎驗不出東西。
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "github-pages-dist");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer((request, response) => {
  let path = join(
    root,
    decodeURIComponent(request.url.split("?")[0]).replace(/^\//, "") ||
      "index.html",
  );
  if (!existsSync(path)) path = join(root, "index.html");
  response.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const wide = join(here, "seed-wide.json");
if (!existsSync(wide)) {
  console.error(
    "找不到 scripts/seed-wide.json，先跑 node scripts/make-wide-seed.mjs",
  );
  process.exit(2);
}
const seed = readFileSync(wide, "utf8");

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1700, height: 1100 },
  locale: "zh-TW",
});
const page = await context.newPage();
await page.addInitScript(
  (value) => localStorage.setItem("turning-traffic-state-v2", value),
  seed,
);
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.dismiss());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2400);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

const gotoTab = async (nameFragment) => {
  const found = await page.evaluate((fragment) => {
    const list = [
      ...document.querySelectorAll("aside nav > div > button"),
    ].filter((button) => !button.className.includes("nav-collapse"));
    const target = list.find((button) =>
      (button.textContent || "").includes(fragment),
    );
    if (!target) return false;
    target.click();
    return true;
  }, nameFragment);
  await page.waitForTimeout(1200);
  return found;
};

/** 歷季趨勢圖 X 軸上實際列出的季別（去重、排序）。 */
const axisQuarters = () =>
  page.evaluate(() => {
    const svg = document.querySelector("#trend-svg");
    if (!svg) return null;
    return [
      ...new Set(
        [...svg.querySelectorAll("text.x-label")].map((node) =>
          (node.textContent || "").trim(),
        ),
      ),
    ]
      .filter(Boolean)
      .sort();
  });

ok("前置：切得到歷季趨勢比較", await gotoTab("歷季趨勢比較"));

/*
 * ⚠️ 趨勢圖一次只畫**一個路口**，而預設選到的那一個未必跨最多季。
 *   （seed-wide 預設選到的路口只有兩季——拿它來驗「區間有沒有縮」
 *     會把「路口只有兩季」誤判成「區間篩壞了」。）
 *   所以先挑一個季數最多的路口，後面全部在那個路口上量。
 */
const intersectionValues = await page.evaluate(() =>
  [
    ...document.querySelectorAll('[data-testid="trend-intersection"] option'),
  ].map((option) => option.value),
);
let bestValue = "";
let bestAxis = [];
/*
 * ⚠️ 這裡的 selectOption 一律包起來。把區間接壞（例如起＝迄就真的只留一季）時，
 *   路口選單會跟著只剩一個選項，選不到的那一下會直接讓整支腳本爆掉、
 *   一條結果都印不出來。守門爆掉雖然也算沒過，但訊息看不出是哪裡壞——
 *   包起來才會走到下面那幾條，紅在該紅的地方。
 */
const pick = async (selector, value) => {
  try {
    await page.selectOption(selector, value, { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
};
for (const value of intersectionValues) {
  if (!(await pick('[data-testid="trend-intersection"]', value))) continue;
  await page.waitForTimeout(700);
  const axis = (await axisQuarters()) || [];
  if (axis.length > bestAxis.length) {
    bestAxis = axis;
    bestValue = value;
  }
}
await pick('[data-testid="trend-intersection"]', bestValue);
await page.waitForTimeout(900);
ok(
  "前置：挑到一個跨多季的路口（季數太少驗不出區間有沒有生效）",
  bestAxis.length >= 4,
  `${bestValue}：${bestAxis.join("、")}`,
);

/* ══ ① 預設：起＝最早、迄＝最新，趨勢圖畫滿 ══ */
const from0 = await page.inputValue('[data-testid="mt-quarter-from"]');
const to0 = await page.inputValue('[data-testid="mt-quarter-to"]');
const bounds = await page.evaluate(() => {
  const options = (selector) =>
    [...document.querySelectorAll(`${selector} option`)].map((node) => node.value);
  const from = options('[data-testid="mt-quarter-from"]');
  const to = options('[data-testid="mt-quarter-to"]');
  return { earliest: from[0], latest: to[to.length - 1], count: from.length };
});
ok(
  "前置：季度下拉列得出多季（只有一季的話下面全部恆真）",
  bounds.count >= 4,
  `${bounds.count} 季，最早 ${bounds.earliest}／最新 ${bounds.latest}`,
);
ok(
  "① 主工具列一開啟就是「起＝最早、迄＝最新」（使用者 2026-09-15 指定的預設）",
  from0 === bounds.earliest && to0 === bounds.latest,
  `起=${from0}（最早 ${bounds.earliest}）／迄=${to0}（最新 ${bounds.latest}）`,
);
/*
 * ⚠️ 2026-09-15 起主工具列**一律不掛**區間說明（使用者指名拿掉，
 *   理由是那句話在受影響的圖上已經有了，主工具列要簡潔）。
 *   所以這裡不再驗「起＝迄時不出現」，改成驗**任何情況都不出現**，
 *   由下面第②段一起守。
 */
const axis0 = await axisQuarters();
ok(
  "① 量得到 X 軸季別",
  Array.isArray(axis0) && axis0.length > 0,
  String(axis0),
);

/*
 * ⚠️ 「預設要畫滿」不可以只驗「不只一季」——那樣把區間接成
 *   「只留最後兩季」也會過。這裡拿它跟**明確把起拉到最早那一季**
 *   的結果比：兩者必須一模一樣，才叫「預設＝全區間」。
 */
await pick('[data-testid="mt-quarter-from"]', bounds.earliest);
await page.waitForTimeout(1400);
const axisFull = await axisQuarters();
ok(
  "① 預設畫出來的，要和「把起拉到最早一季」一模一樣（＝預設就是全區間）",
  JSON.stringify(axis0) === JSON.stringify(axisFull),
  `預設 ${(axis0 || []).length} 季／全區間 ${(axisFull || []).length} 季`,
);

/* ══ ② 拉開區間：只留區間內的季，而且一季都不可以少 ══ */
const start = (axis0 || [])[Math.floor((axis0 || []).length / 2)];
await pick('[data-testid="mt-quarter-from"]', start);
await page.waitForTimeout(1400);
const axis1 = await axisQuarters();
const expected = (axis0 || []).filter((quarter) => quarter >= start);
ok(
  "② 拉開區間之後，趨勢圖真的縮短了（沒縮＝區間根本沒接上）",
  (axis1 || []).length < (axis0 || []).length,
  `畫了 ${(axis1 || []).length} 季／原本 ${(axis0 || []).length} 季`,
);
ok(
  "② 而且**列出來的每一季都對**（只驗數量的話，篩錯季別也會過）",
  JSON.stringify(axis1) === JSON.stringify(expected),
  `畫的是 ${(axis1 || []).join("、")}／應為 ${expected.join("、")}`,
);
ok(
  "② 主工具列上**不可以**再出現區間說明（使用者 2026-09-15 指名拿掉）",
  (await page.locator('[data-testid="mt-range-note"]').count()) === 0,
);
/*
 * ⚠️ 但提醒本身不可以整個消失——只是換了位置。
 *   受影響的那一塊自己要講，否則使用者會以為前幾季的資料不見了。
 */
ok(
  "② 受影響的區塊自己要講「這張圖畫的是區間內的季度」",
  await page.evaluate(() =>
    /區間/.test(document.querySelector(".content")?.textContent || ""),
  ),
);

/* ══ ③ 起＝迄：只畫那一季（使用者 2026-09-15 定的語意，三支統一）══ */
/*
 * ⚠️ 這一條**推翻了舊版**。舊版驗的是「起改回＝迄之後回到畫滿」，
 *   那是這一支自己的特例（`from === to` 時直接回傳全部紀錄）。
 *   使用者 2026-09-15：「當起和迄是同一時間的話 就等於單季」。
 *   選了單季卻畫出全部，是畫面在說謊。
 *
 * ⚠️ 要驗「剛好那一季」，不可以只驗「少於全部」——
 *   接成「只留最後兩季」也會少於全部。
 */
await pick('[data-testid="mt-quarter-from"]', to0);
await page.waitForTimeout(1400);
const axis2 = await axisQuarters();
ok(
  "③ 起＝迄之後，趨勢圖只畫那一季（不是畫滿，也不是空圖）",
  (axis2 || []).length === 1 && axis2[0] === to0,
  `畫了 ${(axis2 || []).length} 季：${(axis2 || []).join("、")}；起＝迄＝${to0}`,
);
/*
 * ⚠️ 再把起拉回最早，確認它**回得去**——單向改壞（從此再也畫不滿）
 *   同樣是缺陷，而且只驗③的話抓不到。
 */
await pick('[data-testid="mt-quarter-from"]', bounds.earliest);
await page.waitForTimeout(1400);
const axis3 = await axisQuarters();
ok(
  "③ 起再拉回最早，要整個回到畫滿（可逆，不是單向改壞）",
  (axis3 || []).length >= 4 && JSON.stringify(axis3) === JSON.stringify(axis0),
  `回來畫了 ${(axis3 || []).length} 季／原本 ${(axis0 || []).length} 季`,
);
ok(
  "③ 主工具列上仍然沒有區間說明",
  (await page.locator('[data-testid="mt-range-note"]').count()) === 0,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 季度起訖區間：預設畫滿、拉開才縮、收回去要復原");
