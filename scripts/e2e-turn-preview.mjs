/*
 * ══════════════════════════════════════════════════════════════════════
 *  「用顏色檢視轉向」：顏色必須真的等於表上的轉向別
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「我可以逐一選擇路口，直接從圖片看轉向顏色，**顏色不對的地方表示
 *     轉向錯誤，要去對應的地方調整轉向**。路口轉向則無法做到，
 *     能幫路口轉向也新增的這個功能嗎?」
 *
 * ⚠️ 這個功能的價值**完全建立在「圖上的顏色 ＝ 表上的判定」**這件事上。
 *   如果圖自己另外算一次角度，就會出現「圖看起來錯、改了表卻沒變」，
 *   那比沒有這張圖更糟——使用者會對著它束手無策。
 *
 *   所以這一支不驗「有沒有畫出來」，而是：
 *     ①改表上某一列的轉向別 → 圖上那一條線的顏色**真的跟著變**
 *     ②換一個起點 → 畫的是新起點的線，而且下面的表跟著開到同一塊
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

/* ⚠️ 沒有種子資料的話畫面上一個路口都沒有，整支會「檢查了 0 個東西」然後全綠。 */

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

const COLORS = { through: "#0F8A45", left: "#E8710A", right: "#0072B2" };

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1680, height: 1000 },
  locale: "zh-TW",
});
const page = await context.newPage();
const seed = readFileSync(join(here, "seed-state.json"), "utf8");
await page.addInitScript(
  (value) => localStorage.setItem("turning-traffic-state-v2", value),
  seed,
);
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.dismiss());
await page.goto(base, { waitUntil: "networkidle" });

await page.waitForTimeout(1300);

await page.evaluate(() => {
  const button = [...document.querySelectorAll("aside nav button")].find(
    (element) => (element.textContent || "").includes("道路與流向管理"),
  );
  if (button) button.click();
});
await page.waitForTimeout(900);

ok(
  "前置①：找得到「用顏色檢視轉向」這一塊",
  await page.locator("#geometry-turn-preview").count().then((n) => n > 0),
);

const arms = await page.evaluate(() =>
  [...document.querySelectorAll(".turn-preview-pick select option")].map(
    (option) => ({ value: option.value, label: option.textContent.trim() }),
  ),
);
ok("前置②：起點下拉列得出支線", arms.length >= 3, `${arms.length} 支`);

/** 讀圖上每一條流向線的顏色。 */
const strokes = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".turn-preview-svg path[marker-end]")].map(
      (path) => path.getAttribute("stroke").toUpperCase(),
    ),
  );

const before = await strokes();
ok(
  "前置③：圖上真的畫得出流向線（畫不出來的話下面的比對恆真）",
  before.length >= 2,
  `${before.length} 條`,
);
ok(
  "前置④：線的顏色都是三種轉向色之一（不是隨便一個顏色）",
  before.every((color) => Object.values(COLORS).includes(color)),
  before.join("、"),
);

/*
 * ── 核心：改表上的轉向別，圖上的顏色要跟著變 ──────────────────
 */
const opened = await page.evaluate(() => {
  for (const item of document.querySelectorAll("details.route-mapping"))
    item.open = true;
  return document.querySelectorAll("details.route-group[open]").length;
});
ok("前置⑤：下面那張表展得開，而且有一塊是開著的", opened >= 1, `${opened} 塊`);
await page.waitForTimeout(300);

const picked = await page.evaluate(() => {
  const group = document.querySelector("details.route-group[open]");
  const row = group?.querySelector("tbody tr");
  if (!row) return null;
  const select = row.querySelectorAll("select")[1];
  const options = [...select.options].map((option) => option.value);
  const next = options.find((value) => value !== select.value);
  return { was: select.value, next };
});
ok("前置⑥：挑得到一列可以改的轉向別", !!picked && !!picked.next, JSON.stringify(picked));

if (picked && picked.next) {
  await page.evaluate((value) => {
    const group = document.querySelector("details.route-group[open]");
    const select = group.querySelector("tbody tr").querySelectorAll("select")[1];
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, picked.next);
  await page.waitForTimeout(700);
  const after = await strokes();
  ok(
    "改了表上的轉向別，圖上的顏色**真的跟著變**（圖與表不可以各說各話）",
    JSON.stringify(after) !== JSON.stringify(before) &&
      after.includes(COLORS[picked.next].toUpperCase()),
    `${picked.was} → ${picked.next}；改前 ${before.join("、")}　改後 ${after.join("、")}`,
  );
}

/* ── 換起點：圖與表要一起換 ── */
if (arms.length >= 2) {
  const target = arms[arms.length - 1];
  await page.selectOption(".turn-preview-pick select", target.value);
  await page.waitForTimeout(600);
  const center = await page.textContent(".turn-center");
  ok(
    `換起點之後圖上寫的是新起點：${target.label}`,
    (center || "").includes(target.label),
    center || "",
  );
  const openLabel = await page.evaluate(
    () =>
      document
        .querySelector("details.route-group[open] > summary")
        ?.textContent?.trim() || "",
  );
  ok(
    "下面那張表也跟著開到同一個起點（不可以圖看 C、表開著 A）",
    openLabel.includes(target.label),
    `表上開著：${openLabel}`,
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await page.screenshot({
  path: join(here, "..", "..", "out", "_screens", "g2164_轉向顏色檢視.png"),
  fullPage: false,
});

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 圖上的顏色就是表上的判定，而且圖與表永遠指向同一個起點");
