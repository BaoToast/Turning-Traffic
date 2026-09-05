/**
 * 端對端：按下「產生草稿」之後，草稿框必須在使用者看得到的地方——
 * 而且**本來就看得到時，畫面不准跳**。
 *
 * 起因是使用者的實際回報（交通服務水準）：
 *   「路段管理的功能頁面中，修改正式名稱／合併重複路段，按下預覽修改影響之後，
 *     因為畫面停在原地，所以使用者不知道預覽畫面已經顯示在下方了，
 *     會誤以為程式沒任何反應。」
 *
 * 三支都量過。結論草稿產生器在 v2.1.45 以前是「頁首一顆、草稿框旁邊一顆」，
 * 從頁首那一顆按下去時草稿框在視窗外，按了完全沒動。v2.1.46 依使用者的決定
 * 移除頁首那一顆，動線因此都停在草稿框旁邊；捲動仍然保留，處理視窗特別矮、
 * 或草稿變長把框推出畫面外這類例外。
 *
 * 兩半都要驗，因為只驗一半的話反向的錯誤實作也會通過：
 *   ・只驗「按完看得到」→ 把 revealResult() 改成無條件捲動也會過。
 *   ・只驗「不准跳」    → 直接把 revealResult() 刪掉也會過。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages-dist");
const VH = 768;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(8142, r));

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label);
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: VH }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(""));

const seed = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
await page.addInitScript((s) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", JSON.stringify(s));
  } catch (error) {
    void error;
  }
}, seed);
await page.goto("http://localhost:8142/");
await page.waitForTimeout(2500);

await page.locator('button:has-text("結論草稿")').first().click();
await page.waitForTimeout(1200);
ok("結論草稿產生器打得開", (await page.locator(".conclusion-output").count()) === 1);

/*
 * v2.1.46：頁首那一顆「產生草稿」已移除，整頁只剩草稿框旁邊那一顆。
 * 這一項同時擋住「改回兩顆」與「改名回重新產生」。
 */
const generateButtons = await page.evaluate(() =>
  [...document.querySelectorAll("button")].filter(
    (b) => b.textContent.trim() === "產生草稿",
  ).length,
);
ok("整頁只有一顆「產生草稿」", generateButtons === 1, `${generateButtons} 顆`);
ok(
  "那一顆就在草稿框裡",
  (await page.locator('.conclusion-output button:has-text("產生草稿")').count()) === 1,
);
ok(
  "已經沒有叫「重新產生」的按鈕（結論草稿）",
  (await page.locator('.conclusion-output button:has-text("重新產生")').count()) === 0,
);

/*
 * ── 第一半：草稿框被推到視窗外時，按完必須看得到 ──
 *
 * 把條件面板頂到視窗最上緣，草稿框就整個落在視窗下方之外。
 *
 * 這裡**不能**用 Playwright 的 click()：它按之前會自己把元素捲進視窗，
 * 於是不管程式有沒有 revealResult()，量到的都是「看得到」——守門測試會
 * 變成永遠通過的裝飾品（實測：拿掉 revealResult() 之後仍然全綠）。
 * 改成在頁面裡直接對按鈕發 click()，沒有任何自動捲動，
 * 量到的才是程式自己的行為。
 *
 * 這一段模擬的是移除頁首按鈕之後仍然存在的例外：視窗特別矮、
 * 或草稿變長把框推出畫面外，按下之後結果落在看不到的地方。
 */
await page.evaluate(() => {
  const el = document.querySelector(".conclusion-panel");
  if (el) el.scrollIntoView({ block: "start" });
});
await page.waitForTimeout(400);

const beforeVisible = await page.evaluate(() => {
  const r = document.querySelector(".conclusion-output").getBoundingClientRect();
  const vh = window.innerHeight;
  return Math.round(Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)));
});
/*
 * 前置條件也要驗。少了這一項，版面一改（草稿框剛好落在視窗內）
 * 下面那一項就會變成恆真，而且沒有人會發現。
 */
ok(
  "前置：按之前草稿框確實看不到",
  beforeVisible < 40,
  `按之前可見 ${beforeVisible}px`,
);

await page.evaluate(() => {
  const button = [...document.querySelectorAll(".conclusion-output button")].find(
    (b) => b.textContent.trim() === "產生草稿",
  );
  if (button) button.click();
});
await page.waitForTimeout(1200);

const m = await page.evaluate(() => {
  const el = document.querySelector(".conclusion-output");
  const ta = document.querySelector('.conclusion-output textarea');
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  return {
    top: Math.round(r.top),
    vh,
    height: Math.round(r.height),
    visible: Math.round(Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))),
    drafted: ((ta && ta.value) || "").length,
  };
});
ok("草稿真的產生了", m.drafted > 0, `${m.drafted} 字`);

/*
 * 判準：光是「上緣在視窗內」不算看得到——上緣落在視窗下緣往上 60px 的地方，
 * 使用者只看得到一條邊，跟沒看到一樣。所以要求**實際可見高度**至少
 * 160px 或整個區塊的四分之一（取小者），這才是「按下去有看到結果」。
 * 另外擋掉「量到 0 高度也算通過」的假通過。
 */
ok("量到的草稿框不是 0 高度", m.height >= 24, `框高 ${m.height}px`);
const need = Math.min(160, Math.round(m.height / 4));
ok(
  "草稿框按完之後真的看得到",
  m.visible >= need,
  `可見 ${m.visible}px／需要 ${need}px（按之前 ${beforeVisible}px、top=${m.top}px、框高 ${m.height}px、視窗 ${m.vh}px）`,
);

/*
 * ── 第二半同樣重要：結果已經看得到時，畫面**不准**跳 ──
 *
 * 使用者交代過：「除非是按下確認鍵修正後，修正的畫面就是在原地，那才不用跳開。」
 * 他後來又補充結論草稿的實際用法——「使用者必須先決定產生哪些結論出來，
 * 會一路往下滑，勾選要產生的監測結果，最後在最底下才會點選，
 * 直接原地看到結果，不需要跳轉。」這才是移除頁首按鈕之後的正常動線。
 */
/*
 * 這裡有一個量測上的陷阱，踩過一次：直接捲到整頁最底下按，畫面**本來就**
 * 動不了（已經到捲動極限），於是不管程式怎麼寫都會通過——實測把
 * revealResult() 改成無條件 `block: "start"` 仍然全綠。
 *
 * 所以先在頁尾補一塊空白，讓「草稿框整個看得見」與「還捲得動」同時成立，
 * 再把草稿框放到視窗中間。這時候只要程式擅自捲動就一定量得到。
 * 空白塊掛在 React 根節點外面，重畫不會把它清掉；量完就移除。
 */
await page.evaluate(() => {
  const spacer = document.createElement("div");
  spacer.id = "reveal-probe-spacer";
  spacer.style.height = "1500px";
  document.body.appendChild(spacer);
  document
    .querySelector(".conclusion-output")
    .scrollIntoView({ block: "center", behavior: "auto" });
});
await page.waitForTimeout(400);
const stayBefore = await page.evaluate(() => {
  const r = document.querySelector(".conclusion-output").getBoundingClientRect();
  const vh = window.innerHeight;
  const max = document.documentElement.scrollHeight - vh;
  return {
    y: Math.round(window.scrollY),
    fullyVisible: r.top >= 0 && r.bottom <= vh,
    canScroll: Math.round(window.scrollY) < Math.round(max) - 50,
  };
});
ok(
  "前置：草稿框整個看得見，而且畫面還捲得動",
  stayBefore.fullyVisible && stayBefore.canScroll,
  `整個看得見=${stayBefore.fullyVisible}、還捲得動=${stayBefore.canScroll}（scrollY=${stayBefore.y}）`,
);
const stayY0 = stayBefore.y;
await page.evaluate(() => {
  const button = [...document.querySelectorAll(".conclusion-output button")].find(
    (b) => b.textContent.trim() === "產生草稿",
  );
  if (button) button.click();
});
await page.waitForTimeout(900);
const stayY1 = await page.evaluate(() => Math.round(window.scrollY));
await page.evaluate(() => {
  document.getElementById("reveal-probe-spacer")?.remove();
});
ok(
  "草稿本來就看得到時，畫面不可以跳",
  stayY0 === stayY1,
  `捲動前 ${stayY0} → 捲動後 ${stayY1}`,
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
