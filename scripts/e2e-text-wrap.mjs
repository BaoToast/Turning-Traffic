/*
 * ══════════════════════════════════════════════════════════════════════
 *  一句話的短說明，不可以被自己的 max-width 逼到換行
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14（在姊妹專案「全日交通量」上實測抓到，附圖）：
 *   「紅框的文字不用換行」
 * 依使用者的規矩「我們踩過的雷，請確保三份程式都不會再踩到」，三支同一套。
 *
 * ── 成因：`ch` 這個單位對中文是錯的 ─────────────────────────────
 *
 * 那一句是 `max-width: 70ch`。`ch` 的定義是「數字 0 的寬度」：
 *   ・半形英數 1 個字 ≈ 1ch
 *   ・**中文字 ≈ 2ch**
 * 所以 70ch 看起來像「70 個字」，實際上只裝得下約 35 個中文字。
 * 那一句有 41 個字，於是被折成兩行——而它右邊還空著一大片
 *（面板寬約 1470px，它只佔 388px）。
 *
 * ⚠️ 為什麼既有守門抓不到：版面類的守門量的是「有沒有被裁切」「有沒有溢出」
 *   「間距一不一致」。**換行不是錯誤狀態**，長文章本來就該換行，
 *   所以沒有任何一支會去問「這一行是不是被不必要地折斷了」。
 *
 * ── 這一支要驗的，和不驗的 ────────────────────────────────────
 *
 * 驗：**短**說明（45 個字以內）被 max-width 綁住而換行，
 *     而且它所在的區塊明明還有 1.4 倍以上的寬度可用。
 *
 * ⚠️ 刻意**不驗**長說明換行——那是對的排版，不是缺陷。
 *   把長文章拉成一整行橫跨 1400px 的螢幕只會更難讀。
 *   （實測姊妹專案有兩處長說明落在這個情況，本支刻意讓它們通過。）
 *
 * ⚠️ 也刻意**不**去掃「有沒有人用 ch」——那會變成禁止一個單位，
 *   而 ch 用在純英數的地方是對的。驗結果，不驗寫法。
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { launchOptions } = await import(
  pathToFileURL(join(here, "chrome-path.mjs")).href
);
const root = join(here, "..", "github-pages-dist");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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
  /* ⚠️ 要夠寬，才問得出「明明有空間卻還是折了」。窄螢幕折行是合理的。 */
  viewport: { width: 1680, height: 950 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.dismiss());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

/** 掃當前畫面：回傳「被 cap 綁住、又換了行、旁邊還有空間」的短說明。 */
const scan = () =>
  page.evaluate(() => {
    const found = [];
    let capped = 0;
    for (const element of document.querySelectorAll(
      "p,small,span,li,h3,h4,div",
    )) {
      const style = getComputedStyle(element);
      if (style.display === "none" || element.children.length > 0) continue;
      const maxWidth = style.maxWidth;
      if (!maxWidth || maxWidth === "none") continue;
      const cap = parseFloat(maxWidth);
      if (!cap) continue;
      const rect = element.getBoundingClientRect();
      if (rect.height < 2 || rect.width < 2) continue;
      capped += 1;
      /* 實際寬度貼著上限 ＝ 真的是被這個 cap 綁住的。 */
      if (rect.width < cap - 2) continue;
      const lineHeight =
        parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
      const lines = Math.round(rect.height / lineHeight);
      if (lines < 2) continue;
      const text = (element.textContent || "").replace(/\s+/g, " ").trim();
      /*
       * 只管**短**說明。45 字以內的中文大約就是「一句話」，
       * 那種東西被折成兩行就是版面問題，不是排版需要。
       */
      if ([...text].length > 45) continue;
      /* 往上找最近一個明顯更寬的祖先＝本來可以用的空間。 */
      let ancestor = element.parentElement;
      let avail = 0;
      while (ancestor && ancestor !== document.body) {
        const width = ancestor.getBoundingClientRect().width;
        if (width > rect.width * 1.4) {
          avail = width;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (!avail) continue;
      found.push({
        maxWidth,
        width: Math.round(rect.width),
        avail: Math.round(avail),
        lines,
        text: text.slice(0, 40),
      });
    }
    return { found, capped };
  });

const tabs = await page.evaluate(() =>
  [...document.querySelectorAll("nav button")]
    .filter((button) => !String(button.className).includes("collapse"))
    .map((button) => (button.textContent || "").trim())
    .filter(Boolean),
);

ok("前置①：側欄列得出分頁", tabs.length >= 10, `${tabs.length} 個`);

const seen = new Set();
const bad = [];
let cappedTotal = 0;
let pages = 0;
for (const tab of ["", ...tabs]) {
  if (tab) {
    await page.evaluate((name) => {
      const button = [...document.querySelectorAll("nav button")].find(
        (element) => (element.textContent || "").trim() === name,
      );
      if (button) button.click();
    }, tab);
    await page.waitForTimeout(260);
  }
  pages += 1;
  const { found, capped } = await scan();
  cappedTotal += capped;
  for (const item of found) {
    const key = item.text + item.maxWidth;
    if (seen.has(key)) continue;
    seen.add(key);
    bad.push(
      `［${tab || "初始畫面"}］「${item.text}」` +
        `max-width:${item.maxWidth}／實寬 ${item.width}px，` +
        `但這一塊有 ${item.avail}px 可用，卻折成 ${item.lines} 行`,
    );
  }
}

/*
 * ⚠️ 前置②：畫面上真的有「設了 max-width 的文字」可以量。
 *   一個都沒有的話，上面那個迴圈等於什麼都沒檢查，整支恆真。
 */
ok(
  "前置②：真的量到設了 max-width 的文字（量到 0 個就是恆真）",
  cappedTotal > 0,
  `${pages} 頁共 ${cappedTotal} 個`,
);

ok(
  "沒有任何「一句話的短說明」被自己的 max-width 逼到換行",
  bad.length === 0,
  bad.join("　｜　"),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 短說明都在一行內，沒有被 max-width 不必要地折斷");
