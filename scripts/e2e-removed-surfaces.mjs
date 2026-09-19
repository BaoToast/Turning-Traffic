/*
 * 端對端：**授權移除的東西真的不見了**。
 *
 * 為什麼需要獨立一支：
 *   移除類的守門有兩個特別容易踩的陷阱，兩個我都實際踩過：
 *
 *   ① **恆真的假檢查。** 我原本把「系統版本與更新紀錄不可再出現」寫進
 *      tests/rendered-html.test.mjs，但那一支測的是伺服器端算出來的首頁
 *      HTML，裡面只有預設那一頁。那個面板本來就在「備份與還原」頁上，
 *      **在舊版跑同一條斷言也是綠的**——等於沒加。
 *      要驗它，就得像使用者一樣**真的點到那一頁**。
 *
 *   ② **子字串誤判。** 「建立與管理計畫」是「多建立與管理計畫」的子字串，
 *      只驗新名字存在，舊版照樣通過。反向斷言（舊名不可出現）才有保護力。
 *
 * 這一支走過每一頁，確認三件事：
 *   ・側欄不再有「跨計畫／多路口比較」，全站文字不再出現「跨計畫」
 *   ・側欄是「建立與管理計畫」而不是「多建立與管理計畫」，且該頁沒有跨計畫趨勢面板
 *   ・「備份與還原」頁上沒有「系統版本與更新紀錄」
 */
import { chromium } from "playwright";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages-dist");
const seed = readFileSync(join(here, "seed-wide.json"), "utf8");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: "zh-TW" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(""));
await page.addInitScript((s) => localStorage.setItem("turning-traffic-state-v2", s), seed);
await page.goto(base);
await page.waitForTimeout(1500);

const navText = await page.evaluate(() =>
  [...document.querySelectorAll("aside.sidebar nav button")].map((b) => b.textContent.trim()),
);
ok("側欄不可以再有「跨計畫／多路口比較」", !navText.some((t) => t.includes("跨計畫")), navText.length + " 個項目");
ok("側欄要有「建立與管理計畫」，而且不是舊名「多建立與管理計畫」",
  navText.some((t) => t.includes("建立與管理計畫")) && !navText.some((t) => t.includes("多建立與管理計畫")),
  navText.find((t) => t.includes("建立與管理計畫")) || "找不到");
ok("側欄「備份與還原」不再叫「備份、還原與版本」",
  navText.some((t) => t.includes("備份與還原")) && !navText.some((t) => t.includes("備份、還原與版本")),
  navText.find((t) => t.includes("備份")) || "找不到");

/* 逐頁走過去，每一頁都看內文 */
const goto = async (label) => {
  const b = page.locator(`aside.sidebar nav button:has-text("${label}")`).first();
  if (!(await b.count())) return false;
  await b.click({ timeout: 8000 });
  await page.waitForTimeout(700);
  return true;
};
const mainText = () => page.evaluate(() => document.querySelector("main")?.innerText ?? "");

ok("前置：進得去「建立與管理計畫」（進不去的話下一項會變成恆真）", await goto("建立與管理計畫"));
const projectsText = await mainText();
ok("建立與管理計畫頁不可以再有「跨計畫歷季趨勢」面板", !projectsText.includes("跨計畫"),
  projectsText.slice(0, 60).replace(/\n/g, " "));
ok("建立與管理計畫頁仍要能建立計畫（這一頁是全系統唯一能建立與刪除計畫的地方）",
  projectsText.includes("建立新計畫") && projectsText.includes("現有計畫"));

ok("前置：進得去「備份與還原」（進不去的話下一項會變成恆真）", await goto("備份與還原"));
const backupText = await mainText();
ok("備份頁不可以再有「系統版本與更新紀錄」", !/系統版本與更新紀錄|CHANGELOG/.test(backupText),
  backupText.slice(0, 60).replace(/\n/g, " "));
ok("備份與還原的功能本身要都還在", backupText.includes("備份") && backupText.includes("清除本機資料"));

/*
 * ★ 正向守門：移除那一頁時**要留下來的兩塊表**，必須真的還在。
 *
 * ⚠️ 這一條是補上一個實際犯過的錯：我 dump 那一頁時它顯示「表 0」，
 *   因為預設沒有勾選任何計畫、表根本沒渲染，於是我以為那頁只有摘要卡與
 *   排名，就整頁刪掉了——**使用者是看線上截圖才發現表不見了**。
 *   教訓：要先操作才會出現的內容，不操作就抓不到。
 */
ok("前置：進得去「各路口尖峰彙總」", await goto("各路口尖峰彙總"));
const peaksText = await mainText();
ok("上半：每個路口的尖峰時段與轉向總量表要在",
  peaksText.includes("各路口尖峰彙總") && peaksText.includes("轉向總量"),
  peaksText.slice(0, 50).replace(/\n/g, " "));
ok("下半：各支線駛入／駛出尖峰流量要在",
  peaksText.includes("各支線駛入／駛出尖峰流量") &&
    peaksText.includes("駛出路口") && peaksText.includes("駛入路口"));
const peaksTables = await page.evaluate(() => document.querySelectorAll("main table").length);
ok("這一頁要有多張表（1 張彙總 ＋ 每個路口 1 張支線表）", peaksTables >= 2, peaksTables + " 張");
/*
 * ★ 路口選單的守門。
 * ⚠️ 第一版用 recordIntersectionKey 當鍵，它會把同一個交流道的北向站與南向站
 *   正規化成同一個名稱——**選單少一站**，而表是逐站號列的，於是選單 4 個選項、
 *   表 5 列。改用站號分組。這一條就是釘住「選單的數量要等於表的路口數」。
 */
const peaksOptions = await page.evaluate(() => {
  /*
   * ⚠️ 要限定在 `.content`，不可以用 `main label`。
   *   v2.1.73 起主工具列上也有一個叫「路口」的多選清單，
   *   而它排在 main 裡面、又在內容區前面，`main label` 會先抓到它，
   *   於是量到的是主工具列的選項數，不是這一頁的。
   *   （同一種陷阱在 e2e-diagram 也發生過：一個新控制項出現，
   *     舊的寬鬆選擇器就默默指向別的東西。）
   */
  const label = [...document.querySelectorAll(".content label")].find((l) =>
    l.textContent.trim().startsWith("路口"),
  );
  return [...(label?.querySelector("select")?.options || [])].map((o) => o.value);
});
const peaksStations = await page.evaluate(() =>
  [...document.querySelectorAll(".content table tbody tr")]
    .map((tr) => tr.children[0]?.querySelector("strong")?.textContent.trim())
    .filter(Boolean),
);
ok("路口選單的選項數要等於表裡的路口數（＋1 個「全部路口」）",
  peaksOptions.length === new Set(peaksStations).size + 1,
  `選單 ${peaksOptions.length - 1} 個路口｜表 ${new Set(peaksStations).size} 個站號`);

ok("這一頁不可以出現「計畫」欄（只剩單一計畫，整欄都一樣）",
  !(await page.evaluate(() =>
    [...(document.querySelector("main table thead")?.querySelectorAll("th") || [])]
      .some((th) => th.textContent.trim() === "計畫"))));

/*
 * ★ 兩張新圖的守門（轉向進階分析頁最底下）。
 * 驗四件事，缺一不可：
 *   ① 兩個區塊都在，而且**預設是收合的**（使用者定調「平常用不上就收合」）
 *   ② 展開後，適用的資料要畫得出圖；不適用的要顯示**說明文字**而不是空白
 *   ③ 說明文字裡的「複製」鍵要在**展開後**才出現
 *   ④ X 軸標籤不可以互相重疊（實測踩過：24 個整點疊成「00:01:02:03…」）
 */
/*
 * ── 兩張新圖：**另開一個乾淨的瀏覽器環境**跑 ──────────────────
 *
 * ⚠️ 不能只換 localStorage 再 reload。這個程式啟動時會把資料搬進
 *   IndexedDB，之後就不看 localStorage 了——換了 seed 也還是讀到舊資料。
 *   實測就是這樣：換了含逐 15 分鐘資料的 seed，仍然跑出「圖 0・說明 2」，
 *   而「複製鍵數＝圖的張數」「X 軸標籤不重疊」在 0 比 0 的情況下**全綠**。
 *   那是恆真的假檢查。必須開一個全新的 context（乾淨的 IndexedDB）。
 */
const shapeCtx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, locale: "zh-TW" });
const shapePage = await shapeCtx.newPage();
shapePage.on("pageerror", (e) => errors.push(String(e.message)));
/*
 * 主控台的 error 也要收。`pageerror` 只收得到**未捕捉的例外**，
 * 收不到瀏覽器自己對不合法屬性發出的抱怨——例如把
 * `height="auto"` 寫進 <svg>（"auto" 不是合法長度）時，Chrome 每重畫
 * 一次就印一行 `<svg> attribute height: Expected length, "auto".`，
 * 圖照樣畫得出來，所以只看畫面完全發現不了。
 * 字型來自外部 CDN，離線環境載不到，那一種不算。
 */
shapePage.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  if (/fonts\.googleapis|ERR_TUNNEL_CONNECTION_FAILED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(text))
    return;
  errors.push("console: " + text.slice(0, 200));
});
await shapePage.addInitScript(
  (s) => localStorage.setItem("turning-traffic-state-v2", s),
  readFileSync(join(here, "seed-15min.json"), "utf8"),
);
await shapePage.goto(base);
await shapePage.waitForTimeout(1800);
await shapePage.locator('aside.sidebar nav button:has-text("轉向進階分析")').first().click();
await shapePage.waitForTimeout(900);

const shapeSummaries = await shapePage.evaluate(() =>
  [...document.querySelectorAll("main details.peak-shape > summary")].map((s) =>
    s.textContent.replace(/\s+/g, " ").trim(),
  ),
);
ok("兩張尖峰形狀圖的區塊都要在", shapeSummaries.length === 2, shapeSummaries.length + " 個");
ok("兩張都要預設收合",
  await shapePage.evaluate(() =>
    [...document.querySelectorAll("main details.peak-shape")].every((d) => !d.open)));
/*
 * ⚠️ 收合時**不可以**用 getBoundingClientRect().height === 0 判斷。
 *   實測：details 收合時 Chrome 用 content-visibility 隱藏內容，
 *   裡面的按鈕仍然回報 height 27、display:block——量出來是「看得見」，
 *   但畫面上根本沒有畫出來，也點不到。這是「量到的不是使用者看到的」。
 *   用 checkVisibility()（含 contentVisibilityAuto）才問得到真正的可見性。
 */
ok("收合時「複製說明文字」鍵不可以露出來",
  await shapePage.evaluate(() => {
    const btn = document.querySelector("main .peak-shape-copy button");
    if (!btn) return true;
    return !btn.checkVisibility({
      contentVisibilityAuto: true,
      opacityProperty: true,
      visibilityProperty: true,
    });
  }));
for (const s of await shapePage.locator("main details.peak-shape > summary").all()) {
  await s.click();
  await shapePage.waitForTimeout(350);
}
const shape = await shapePage.evaluate(() => ({
  svgs: document.querySelectorAll("main details.peak-shape svg").length,
  empties: document.querySelectorAll("main .peak-shape-empty").length,
  copies: document.querySelectorAll("main .peak-shape-copy button").length,
  downloads: document.querySelectorAll("main .peak-shape-download button").length,
  stray: /\*\*/.test(document.querySelector("main")?.innerText || ""),
  bars: document.querySelectorAll("main details.peak-shape rect").length,
  path: document.querySelectorAll("main details.peak-shape path").length,
}));
ok("★ 前置：這一份 seed 要真的畫得出兩張圖（畫不出來的話下面幾項會變成恆真）",
  shape.svgs === 2, `圖 ${shape.svgs}・說明 ${shape.empties}`);
ok("四格圖要真的有四根柱子", shape.bars === 4, shape.bars + " 根");
ok("60 分鐘折線要真的有一條線", shape.path >= 1, shape.path + " 條");
ok("展開後才出現的「複製說明文字」鍵，數量要等於圖的張數",
  shape.copies === shape.svgs && shape.copies === 2, `鍵 ${shape.copies}・圖 ${shape.svgs}`);
/*
 * ⚠️ 上面那一條**曾經是假的**：下載 PNG 的外框以前也叫 .peak-shape-copy，
 *   於是它數到 4 顆（2 顆複製 ＋ 2 顆下載）。2026-09-12 把下載那一塊改名成
 *   .peak-shape-download 才分得開。
 *   ⚠️ 改名之後一定要**同時驗下載鍵還在**——否則「把下載鍵刪掉」
 *   也會讓上面那一條變綠，等於用刪功能換測試綠。
 */
ok("每一張圖都要有自己的「下載高解析圖片」鍵（與複製說明文字分開）",
  shape.downloads === shape.svgs && shape.downloads === 2,
  `下載鍵 ${shape.downloads}・圖 ${shape.svgs}`);
ok("展開後那兩顆鍵要**真的看得見**（不是只存在於 DOM 裡）",
  await shapePage.evaluate(() =>
    [...document.querySelectorAll("main .peak-shape-copy button")].every((b) =>
      b.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }),
    )));
ok("說明文字不可以殘留 markdown 星號（純文字會原樣印出來）", !shape.stray);
const labelOverlap = await shapePage.evaluate(() => {
  const out = [];
  for (const svg of document.querySelectorAll("main details.peak-shape svg")) {
    const t = [...svg.querySelectorAll("text.x-label")].map((e) => ({
      text: e.textContent,
      box: e.getBoundingClientRect(),
    }));
    for (let i = 1; i < t.length; i += 1)
      if (t[i].box.left < t[i - 1].box.right - 0.5)
        out.push(`${t[i - 1].text} / ${t[i].text}`);
  }
  return out;
});
ok("X 軸標籤不可以互相重疊", labelOverlap.length === 0, labelOverlap.join("｜") || "0 組");

/*
 * SVG 的 width／height 屬性只接受長度值。寫 "auto"（CSS 才懂的值）
 * 會讓瀏覽器每次重畫都往主控台丟一行錯誤。高度要交給 CSS 的
 * `.peak-shape svg { height: auto }`，比例由 viewBox 決定。
 */
const badLength = await shapePage.evaluate(() => {
  const out = [];
  for (const svg of document.querySelectorAll(".content svg"))
    for (const attr of ["width", "height"]) {
      const v = svg.getAttribute(attr);
      if (v && /^(auto|inherit|initial|unset)$/i.test(v.trim()))
        out.push(`${attr}="${v}"`);
    }
  return out;
});
ok(
  "SVG 的 width／height 屬性不可以寫 CSS 關鍵字（auto 之類）",
  badLength.length === 0,
  badLength.join("、") || "0 個",
);
await shapeCtx.close();

/*
 * 全站掃一遍，同一輪順便驗兩件事：
 *   (1) 每一頁的內文都不可以出現「跨計畫」
 *   (2) 每一頁都要有 <h1>（大標）
 *
 * (2) 是踩到才補的：新開的「各路口尖峰彙總」漏了 page-head，
 * 點進去只有工具列和表格，跟別頁長得不一樣，也沒有一句話說明這一頁在做什麼。
 * 表格畫得出來、沒有任何錯誤，所以只跑功能檢查完全發現不了。
 * 沒有資料而顯示「尚無資料」的頁面不在此限（那是另一種畫面）。
 */
const leftovers = [];
const noHeading = [];
for (const label of navText) {
  if (!(await goto(label))) continue;
  const t = await mainText();
  if (t.includes("跨計畫")) leftovers.push(label);
  const head = await page.evaluate(() => ({
    h1: document.querySelector("main .content h1")?.textContent?.trim() || "",
    empty: !!document.querySelector("main .content .empty-state, main .content .no-data"),
  }));
  if (!head.h1 && !head.empty) noHeading.push(label.split("\n").pop());
}
ok("走過每一頁，內文都不可以再出現「跨計畫」", leftovers.length === 0, leftovers.join("、") || "0 頁");
ok(
  "每一頁都要有大標（<h1>）",
  noHeading.length === 0,
  noHeading.join("、") || `${navText.length} 頁都有`,
);

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" / "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
