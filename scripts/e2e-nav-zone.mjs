/*
 * ══════════════════════════════════════════════════════════════════════
 *  側欄：選中一個分頁不可以讓它變高；分類可以整區收合
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「路口轉向 分類標題(一、二、三...)文字太小，可以比照全日交通量那樣，
 *     並且附帶展開收合功能」
 *   「路口轉向大分頁文字被選擇後因為文字加粗，會導致文字換行，請修正，
 *     然後大分頁也請保持 展開/收合的功能」
 *
 * ── ①「選中就換行」要怎麼驗才驗得準 ────────────────────────────
 *
 * 不能驗「有沒有寫 font-weight」——那是驗寫法，改個寫法就繞過去了。
 * 要驗**結果**：同一顆分頁按鈕，在「沒被選中」與「被選中」兩種狀態下
 * 量它的高度，**高度必須一樣**。多一行字就是多一個行高，量得出來。
 *
 * ⚠️ 而且要挑**字最長**的那一顆來量。短的分頁名加粗了也還在同一行，
 *   拿它來量會永遠綠——那就是一支恆真的守門。
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

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

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1500, height: 950 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.dismiss());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

/* ── ① 選中不可以變高 ── */
const tabs = await page.evaluate(() =>
  [...document.querySelectorAll("aside nav > div > button")]
    .filter((button) => !button.className.includes("nav-collapse"))
    .map((button, index) => ({
      index,
      label: (button.textContent || "").trim(),
      height: Math.round(button.getBoundingClientRect().height),
      active: button.className.includes("active"),
    })),
);
ok("前置①：列得出大分頁", tabs.length >= 10, `${tabs.length} 顆`);

/*
 * ⚠️ 不可以只挑一顆來量。第一版挑了「字最長的那一顆」，結果那一顆
 *   **本來就已經是兩行**（67px），加粗前後都一樣高——反面測試把加粗放回去
 *   照樣全綠。真正會出事的是**剛好卡在一行邊緣**的那幾顆
 *  （使用者截圖裡是「道路與流向管理」），字長不長不短。
 *   所以改成**每一顆都量**：逐一點過去，比對它在「沒選中」與「選中」
 *   兩種狀態下的高度。哪一顆卡在邊緣，這樣就一定抓得到。
 */
const heights = new Map(tabs.map((tab) => [tab.index, tab.height]));
const grew = [];
let measured = 0;
for (const tab of tabs) {
  await page.evaluate((index) => {
    const list = [
      ...document.querySelectorAll("aside nav > div > button"),
    ].filter((button) => !button.className.includes("nav-collapse"));
    if (list[index]) list[index].click();
  }, tab.index);
  await page.waitForTimeout(180);
  const now = await page.evaluate((index) => {
    const list = [
      ...document.querySelectorAll("aside nav > div > button"),
    ].filter((button) => !button.className.includes("nav-collapse"));
    const element = list[index];
    if (!element) return null;
    return {
      height: Math.round(element.getBoundingClientRect().height),
      active: element.className.includes("active"),
      weight: getComputedStyle(element).fontWeight,
    };
  }, tab.index);
  if (!now || !now.active) continue;
  measured += 1;
  const before = heights.get(tab.index);
  if (now.height !== before)
    grew.push(
      `「${tab.label}」未選中 ${before}px → 選中 ${now.height}px（字重 ${now.weight}）`,
    );
}

ok(
  "前置②：真的逐顆量過（量到 0 顆就是恆真）",
  measured >= 10,
  `${measured} / ${tabs.length} 顆`,
);
ok(
  `選中之後高度不可以改變（＝不可以因此換行），共 ${measured} 顆`,
  grew.length === 0,
  grew.join("　｜　"),
);

/* ── ② 分類可以整區收合 ── */
const zones = await page.evaluate(() =>
  [...document.querySelectorAll("aside nav .nav-zone-toggle")].map(
    (button) => ({
      zone: button.dataset.zoneToggle,
      label: (button.textContent || "").trim(),
      expanded: button.getAttribute("aria-expanded"),
    }),
  ),
);
ok("前置④：分類標題是可以點的（列得出收合鈕）", zones.length >= 2, `${zones.length} 區`);

/*
 * ⚠️ 分類標題**不可以比它底下的分頁還小**。
 *
 *   使用者 2026-09-14 在交通服務水準上回報：「分類標題文字比大分頁還小，
 *   看起來有點不舒適」。這一支程式當時量出來一模一樣（標題 13px／分頁 16px），
 *   只是他還沒點到——「我們踩過的雷，請確保三份程式都不會再踩到」。
 *
 * ⚠️ 門檻**不可以寫成一個絕對數字**。我在交通服務水準第一次就是寫「至少 13px」
 *   ——那是只想著「比原本的 10.5px 大就好」，結果 13px 仍然比 16px 的分頁小，
 *   使用者只好再回報一次。單看一個數字看不出「比下層還小」，要量的是**關係**。
 */
const zoneSizes = await page.evaluate(() =>
  [...document.querySelectorAll("aside nav .nav-zone-toggle")].map((el) => ({
    label: (el.textContent || "").trim(),
    size: Math.round(parseFloat(getComputedStyle(el).fontSize)),
  })),
);
const tabSize = await page.evaluate(() => {
  const button = [...document.querySelectorAll("aside nav > div > button")].find(
    (el) => !el.className.includes("nav-collapse"),
  );
  return button ? Math.round(parseFloat(getComputedStyle(button).fontSize)) : 0;
});
ok("前置④-2：量得到大分頁的字級（量到 0 的話下面那條恆真）", tabSize > 0, `${tabSize}px`);
ok(
  `分類標題不可以比它底下的分頁還小（分頁 ${tabSize}px）`,
  zoneSizes.length > 0 && zoneSizes.every((zone) => zone.size >= tabSize),
  zoneSizes.map((z) => `${z.label}=${z.size}px`).join("、"),
);
/*
 * ⚠️ 三層要**嚴格遞減**，不是「大於等於」。
 *
 * 使用者 2026-09-15（在交通服務水準上回報，三支同一套側欄）：
 *   「分類標題與它下方的大分頁文字大小不要相同……文字大小請依此順序遞減，
 *     分類標題（最大）＞大分頁＞小分頁，請將大分頁文字大小重新調整」。
 *
 * 上面那一條寫的是 `>=`，所以 2026-09-14 那一版「兩層都 16px、只差字重」
 * 照樣全綠——那正是使用者這一次要擋掉的狀態。兩條都留著：
 * 上面守「不可以倒過來」，這一條守「不可以一樣大」。
 */
const subSize = await page.evaluate(() => {
  const el = document.querySelector("aside nav .nav-section");
  return el ? Math.round(parseFloat(getComputedStyle(el).fontSize)) : 0;
});
ok(
  "前置④-3：量得到小分頁的字級（量到 0 的話下面那條恆真）",
  subSize > 0,
  `${subSize}px`,
);
ok(
  "側欄三層字級嚴格遞減：分類標題 > 大分頁 > 小分頁",
  zoneSizes.length > 0 &&
    subSize > 0 &&
    zoneSizes.every((zone) => zone.size > tabSize) &&
    tabSize > subSize,
  `分類標題 ${zoneSizes.map((z) => `${z.size}px`).join("／")}、大分頁 ${tabSize}px、小分頁 ${subSize}px`,
);
ok(
  "前置⑤：預設全部是展開的（預設收起來的話下面的比對會失真）",
  zones.every((zone) => zone.expanded === "true"),
  zones.map((z) => `${z.label}=${z.expanded}`).join("、"),
);

if (zones.length) {
  const first = zones[0];
  const countIn = (zone) =>
    page.evaluate(
      (name) =>
        document.querySelectorAll(`aside nav > div > button.zone-${name}`)
          .length,
      zone,
    );
  const opened = await countIn(first.zone);
  ok(
    `前置⑥：第一區「${first.label}」底下真的有分頁`,
    opened > 0,
    `${opened} 顆`,
  );
  await page.click(`.nav-zone-toggle[data-zone-toggle="${first.zone}"]`);
  await page.waitForTimeout(300);
  const closed = await countIn(first.zone);
  ok(
    `收起來之後這一區的分頁就看不到了：「${first.label}」`,
    closed === 0,
    `${opened} → ${closed}`,
  );
  /* 其他區不可以被波及。 */
  if (zones[1]) {
    const other = await countIn(zones[1].zone);
    ok(
      `只收這一區，別區不受影響：「${zones[1].label}」`,
      other > 0,
      `${other} 顆`,
    );
  }
  /* 記得住。 */
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const afterReload = await countIn(first.zone);
  ok("重新整理之後還記得收合狀態", afterReload === 0, `${afterReload} 顆`);
  /* 再點一次要展開回來（只驗收合不驗展開的話，壞掉也不會紅）。 */
  await page.click(`.nav-zone-toggle[data-zone-toggle="${first.zone}"]`);
  await page.waitForTimeout(300);
  const reopened = await countIn(first.zone);
  ok("再點一次要展開回來", reopened === opened, `${reopened} / ${opened}`);
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 選中不會換行；分類可以整區收合、記得住、也展得開");
