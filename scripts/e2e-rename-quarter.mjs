/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-85：季度改名（路口轉向）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-18：「請幫我將另外兩支也同步季度改名功能，
 *   擺放位置可以參考全日交通量程式擺放的地方。」
 *
 * ── ⚠️ 刻意迴避的假通過 ──────────────────────────────────────────
 * 一、**不可以只驗「改完之後新名字出現」**。只改 records 也會出現新名字，
 *     但還原點仍記著舊季度，還原之後會憑空冒出一個已經改掉的季。
 *     所以要驗：**舊季度整個消失**。
 * 二、**要驗撞名會被擋下來**，而且擋下來之後季度清單一格都不可以動。
 *     不驗這一條的話，「直接合併兩季」也會全綠——那是把兩季混成一季，
 *     事後分不回來。
 * 三、**要驗另一季沒有被波及**。
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
const stop = (why) => {
  console.error(`\n❌ ${why}——後面的條件會變成恆真，直接停。`);
  problems.push(why);
};

/* 兩季測資：改一季，另一季必須原封不動。 */
const seed = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
const template = seed.records[0];
seed.records = [
  { ...template, id: "R1", quarter: "115Q1", station: "T1-01", name: "示範1－示範一路口" },
  { ...template, id: "R2", quarter: "115Q2", station: "T2-01", name: "示範1－示範一路口" },
];

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1700, height: 1100 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
/* 改名有 confirm，要按確定，否則第二節整段恆真。 */
page.on("dialog", (event) => event.accept());
await page.addInitScript(
  (value) => localStorage.setItem("turning-traffic-state-v2", value),
  JSON.stringify(seed),
);
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2200);
await ensureToolbarOpen(page);

const gotoPage = async (label) => {
  const found = await page.evaluate((text) => {
    const list = [
      ...document.querySelectorAll("aside nav > div > button"),
    ].filter((button) => !button.className.includes("nav-collapse"));
    const target = list.find((button) =>
      (button.textContent || "").includes(text),
    );
    if (!target) return false;
    target.click();
    return true;
  }, label);
  await page.waitForTimeout(1100);
  return found;
};

ok("前置：側欄找得到「資料維護」", await gotoPage("資料維護"));
ok(
  "⚠️ ① 「季度改名」那一塊在畫面上，而且排在「刪除單一季度」前面",
  await page.evaluate(() => {
    const rename = document.getElementById("maintenance-rename-quarter");
    const remove = document.getElementById("maintenance-delete-quarter");
    if (!rename || !remove) return false;
    return (
      rename.compareDocumentPosition(remove) &
      Node.DOCUMENT_POSITION_FOLLOWING
    ) !== 0;
  }),
);
ok(
  "① 側欄也列得出「季度改名」（畫面上有、側欄沒列＝找不到）",
  await page.evaluate(() =>
    [...document.querySelectorAll("aside nav button")].some((b) =>
      (b.textContent || "").includes("季度改名"),
    ),
  ),
);

/** 目前刪除下拉裡列得出哪幾季（＝這個計畫目前有的季度）。 */
const quarters = () =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="maintenance-delete-quarter-select"] option',
      ),
    ]
      .map((o) => o.value)
      .sort(),
  );

const before = await quarters();
ok(
  "前置：改名之前有 115Q1 與 115Q2 兩季",
  before.join("、") === "115Q1、115Q2",
  before.join("、"),
);
if (before.join("、") !== "115Q1、115Q2") stop("測資不對");

/* ══ ① 撞名要被擋下來 ═══════════════════════════════════════ */
console.log("\n══ ① 撞名：不合併，擋下來 ══");
/* 主工具列的季度（迄）決定要改哪一季，先切到 115Q1。 */
await page
  .locator('[data-testid="mt-quarter-to"], [data-testid="mt-quarter"]')
  .first()
  .selectOption("115Q1")
  .catch(() => {});
await page.waitForTimeout(900);
await gotoPage("資料維護");
await page
  .locator('[data-testid="maintenance-rename-quarter-input"]')
  .fill("115Q2");
await page.locator('[data-testid="maintenance-rename-quarter-run"]').click();
await page.waitForTimeout(1100);
const afterClash = await quarters();
ok(
  "⚠️ ① 撞名時季度清單一格都沒有動（合併不可逆，不可以替使用者決定）",
  afterClash.join("、") === before.join("、"),
  afterClash.join("、"),
);
const toastText = await page
  .locator(".toast, [data-testid='toast']")
  .first()
  .innerText()
  .catch(() => "");
ok(
  "⚠️ ① 而且要講明為什麼被擋（不能只是靜靜沒反應）",
  /已經存在/.test(toastText) && /不會把兩季合併/.test(toastText),
  toastText.slice(0, 70),
);

/* ══ ② 正常改名 ════════════════════════════════════════════ */
console.log("\n══ ② 改成一個新名字 ══");
await page
  .locator('[data-testid="maintenance-rename-quarter-input"]')
  .fill("115Q3");
await page.locator('[data-testid="maintenance-rename-quarter-run"]').click();
await page.waitForTimeout(1400);
const after = await quarters();
ok("⚠️ ② 新季度出現了", after.includes("115Q3"), after.join("、"));
ok(
  "⚠️ ② **舊季度整個消失**（只驗新名字出現的話，只改一半也會過）",
  !after.includes("115Q1"),
  after.join("、"),
);
ok("② 另一季完全沒有被波及", after.includes("115Q2"), after.join("、"));

ok("沒有任何 JavaScript 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 季度改名：撞名會擋、改完舊季度整個消失、另一季沒被波及");
