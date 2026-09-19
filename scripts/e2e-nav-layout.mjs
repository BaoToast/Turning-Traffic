/*
 * ══════════════════════════════════════════════════════════════════════
 *  側欄導覽與版面：跳轉落點、區塊間距、內距、側欄文字不被裁切
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11 一次回報四件事，全部在這一頁上：
 *
 *  ①「點了流量核對工作台下面4個分頁，全部跳轉畫面都是把標題遮住，
 *     看不出我已經跳轉到什麼畫面，只有成果審核狀態正確跳轉」
 *  ②「欄位和欄位之間 黏太近，例如"原始儲存格與換算來源"和
 *     "本季成果尚未鎖定" 這兩個欄位黏很近」
 *  ③「本季鎖定情況，右邊的文字非常黏在邊緣快要突破邊緣的感覺，很有壓抑感」
 *  ④「原始處存格與換算來....後面的文字看不到了根本不知那個分頁是什麼…
 *     如果固定寬度，那要注意文字不能被裁切到，尤其畫面被放大或縮小時」
 *
 * ⚠️ 這四件事全部是**量得出來的數字**，不是「看起來如何」：
 *   ① 跳轉後標題的上緣 vs 浮在上面的功能列下緣
 *   ② 相鄰兩塊的垂直間距，全頁要一致
 *   ③ 最右側元素的右緣 vs 面板內容區右緣
 *   ④ 側欄項目的 scrollWidth vs clientWidth
 * 所以四件都釘在這裡。之前沒被抓到，是因為版面只有人用眼睛看過。
 *
 * ⚠️ ④ 要在**三種縮放**下各量一次。只量 100% 抓不到——使用者的原話就是
 *   「尤其畫面被放大或縮小時」。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";

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
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const seed = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
/*
 * ⚠️ 這裡原本會補幾筆還原點，因為 ③ 量的是「版本差異與還原」清單的左右內距。
 *   那一塊已於 2026-09-15 從畫面移除（使用者裁示：還原點使用者不會用、
 *   也不敢按，資料留著給維護用就好），所以改成量**每一個面板**的內距——
 *   規則本來就是通用的「面板裡的東西不可以貼齊邊框」，
 *   綁在一個特定清單上只是當初剛好在那裡發現它。
 */

await new Promise((r) => server.listen(8137, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 900 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());

await installStateHelpers(page);
await page.goto("http://localhost:8137/");
await page.waitForTimeout(700);
await page.evaluate(async (json) => {
  localStorage.clear();
  await window.__writeState(json);
}, JSON.stringify(seed));
await page.reload();
await page.waitForTimeout(1000);

await page.locator('nav button:has-text("流量核對工作台")').first().click();
await page.waitForTimeout(700);

/*
 * ══════════════════════════════════════════════════════════════════
 *  ① 側欄四個子項目，跳過去之後標題要在功能列**下面**看得到
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ 這一段刻意**掃畫面上全部的子項目**，不寫死四個標題。
 *   寫死的清單只保證「我想到的那幾個」正常；這一頁以後再加一塊，
 *   漏掉的永遠是新加的那一個。
 */
console.log("\n══ ① 側欄跳轉的落點不可以被功能列蓋住 ══");
/*
 * ⚠️ 這一段要掃**整個側欄**，不是只掃「流量核對工作台」這一頁。
 *
 * 子項目只在該頁是目前頁時才渲染，所以要一頁一頁點進去看。
 * 只驗自己想得到的那一頁，等於把「新加的那一頁」永遠排除在外——
 * 姊妹專案就是這樣讓「本季總覽」整項沒反應而沒人發現。
 */
const pageIds = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".sidebar nav > div")).map((el, i) => i),
);
const allSections = [];
for (const index of pageIds) {
  const opened = await page.evaluate((i) => {
    const group = document.querySelectorAll(".sidebar nav > div")[i];
    const button = group?.querySelector(":scope > button");
    if (!button) return null;
    button.click();
    return (button.textContent || "").trim().slice(0, 16);
  }, index);
  if (!opened) continue;
  await page.waitForTimeout(300);
  const labels = await page.evaluate(
    (i) =>
      Array.from(
        document.querySelectorAll(".sidebar nav > div")[i].querySelectorAll(
          ".nav-sections .nav-section",
        ),
      ).map((el) => el.getAttribute("data-goto-item")),
    index,
  );
  for (const label of labels)
    allSections.push({ pageIndex: index, page: opened, label });
}
ok(
  "前置：側欄子項目掃得到（掃全部分頁，不是寫死清單）",
  allSections.length >= 7,
  allSections.map((x) => `${x.page}/${x.label}`).join("、"),
);

for (const { pageIndex, page: pageName, label } of allSections) {
  /*
   * ⚠️ 要先回到那一頁。子項目只在「該頁是目前頁」時才渲染，
   *   上面掃完之後停在最後一頁，直接點別頁的子項目會找不到元素。
   */
  await page.evaluate((i) => {
    const group = document.querySelectorAll(".sidebar nav > div")[i];
    group.querySelector(":scope > button").click();
  }, pageIndex);
  await page.waitForTimeout(350);
  await page.locator(`.nav-section[data-goto-item="${label}"]`).first().click();
  await page.waitForTimeout(500);
  const measure = await page.evaluate(() => {
    const bar = document.querySelector(".topbar");
    const target = document.querySelector(".is-focused");
    if (!bar || !target) return null;
    const barRect = bar.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    /*
     * 標題文字本身的位置才是使用者在看的東西——區塊上緣露出來但
     * 標題還被蓋住，一樣是「看不出跳到哪裡」。
     */
    const heading = target.querySelector("h2, h1, b, strong");
    const headRect = heading ? heading.getBoundingClientRect() : rect;
    return {
      id: target.id,
      barBottom: Math.round(barRect.bottom),
      blockTop: Math.round(rect.top),
      headTop: Math.round(headRect.top),
      headText: (heading?.textContent || "").trim().slice(0, 20),
    };
  });
  ok(
    `「${pageName}／${label}」跳轉後，標題在功能列下緣之下（沒被蓋住）`,
    Boolean(measure) && measure.headTop >= measure.barBottom,
    measure
      ? `#${measure.id}「${measure.headText}」標題上緣 ${measure.headTop}px、功能列下緣 ${measure.barBottom}px`
      : "找不到被點名的區塊",
  );
}

/*
 * ══════════════════════════════════════════════════════════════════
 *  ② 區塊與區塊的間距，整頁要一致
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ 驗的是「一致」，不是「等於某個數字」。間距值之後可能會調，
 *   但「同一頁上出現兩種間距」永遠是 bug——那正是使用者看出來的。
 */
console.log("\n══ ② 區塊間距要一致 ══");
/* ①掃完之後停在最後一頁，②③要量的是流量核對工作台，先回去。 */
await page.locator('nav button:has-text("流量核對工作台")').first().click();
await page.waitForTimeout(600);
const gaps = await page.evaluate(() => {
  const stack = document.querySelector(".audit-stack");
  if (!stack) return null;
  /*
   * ⚠️ 要排除 position:sticky 的元素。
   *   黏住的元素量到的是它**現在黏在畫面上的位置**，不是它在版面裡的位置，
   *   拿來算相鄰間距會得到負幾百 px 這種沒有意義的數字。
   *   （第一版沒排除，量到 -1480px。）
   */
  const kids = Array.from(stack.children).filter(
    (el) => el.getBoundingClientRect().height > 0,
  );
  const out = [];
  for (let i = 1; i < kids.length; i += 1) {
    /*
     * ⚠️ 只要這一對裡有 sticky 的就跳過整對。
     *   黏住的元素量到的是它**現在黏在畫面上的位置**，不是它在版面裡的位置；
     *   而且把它從清單裡抽掉再算「前後相鄰」也不對——那會把它的高度
     *   算進別人的間距裡（實測量到 169px）。正確做法是整對不算。
     */
    if (
      getComputedStyle(kids[i]).position === "sticky" ||
      getComputedStyle(kids[i - 1]).position === "sticky"
    )
      continue;
    out.push({
      after: (kids[i - 1].id || kids[i - 1].className).slice(0, 30),
      gap: Math.round(
        kids[i].getBoundingClientRect().top -
          kids[i - 1].getBoundingClientRect().bottom,
      ),
    });
  }
  return out;
});
ok("前置：找得到 .audit-stack 這一層", Boolean(gaps), gaps ? "" : "沒有這一層");
if (gaps) {
  const values = gaps.map((g) => g.gap);
  const min = Math.min(...values);
  const max = Math.max(...values);
  ok(
    "相鄰區塊的間距整頁一致（不會有的黏有的鬆）",
    max - min <= 2,
    gaps.map((g) => `${g.after}→${g.gap}px`).join("、"),
  );
  ok(
    "間距夠大，看得出是兩塊不同的東西",
    min >= 12,
    `最小 ${min}px`,
  );
}

/*
 * ══════════════════════════════════════════════════════════════════
 *  ③ 面板裡的東西不可以貼齊面板邊框
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ 左右**都要量**。只量右邊的話，哪天左邊也貼上去一樣不會被抓到。
 */
console.log("\n══ ③ 面板內距：內容不可以貼邊 ══");
const insets = await page.evaluate(() => {
  /*
   * ⚠️ 量**每一個**面板，不是挑一個。挑一個的話，哪天別的面板貼邊了
   *   一樣不會被抓到——而「貼邊」正是會一個一個冒出來的那種問題。
   *
   * ⚠️ 只量面板自己的標題列與按鈕（.panel-head 底下的 h1/h2/h3 與 button）。
   *   表格與圖是另一回事：它們有自己的 overflow 容器，本來就可以貼到容器邊。
   */
  const rows = [];
  for (const panel of document.querySelectorAll("main .panel")) {
    const box = panel.getBoundingClientRect();
    if (box.width < 100 || box.height < 30) continue;
    const head = panel.querySelector(":scope > .panel-head");
    if (!head) continue;
    for (const el of head.querySelectorAll("h1, h2, h3, button")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      rows.push({
        panel: (panel.querySelector("h1, h2, h3")?.textContent || panel.id || "?")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 18),
        left: Math.round(r.left - box.left),
        right: Math.round(box.right - r.right),
      });
    }
  }
  return rows;
});
ok(
  "前置：真的量到面板（量不到的話下面幾條是恆真的）",
  insets.length >= 3,
  `${insets.length} 個元素`,
);
if (insets.length) {
  const worstLeft = insets.reduce((a, b) => (b.left < a.left ? b : a));
  const worstRight = insets.reduce((a, b) => (b.right < a.right ? b : a));
  ok(
    "標題與按鈕離面板左緣有距離（不是貼著邊）",
    worstLeft.left >= 12,
    `最近的是「${worstLeft.panel}」${worstLeft.left}px`,
  );
  ok(
    "標題與按鈕離面板右緣有距離",
    worstRight.right >= 12,
    `最近的是「${worstRight.panel}」${worstRight.right}px`,
  );
}

/*
 * ══════════════════════════════════════════════════════════════════
 *  ④ 側欄文字不可以被裁切——放大縮小都一樣
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ 只量 100% 沒有用。使用者的原話是「尤其畫面被放大或縮小時」，
 *   而側欄寬度是固定的 px，字一變大就先出事。
 *
 * 量的是 scrollWidth vs clientWidth：文字換行的話兩者相等（往下長），
 * 被硬裁的話 scrollWidth 會大於 clientWidth。這個量法不必知道
 * 到底是 nowrap、ellipsis 還是 overflow hidden 造成的，三種都抓得到。
 */
console.log("\n══ ④ 側欄文字在各種縮放下都不可以被裁切 ══");
for (const zoom of [1, 1.25, 1.5]) {
  await page.evaluate((z) => {
    document.documentElement.style.zoom = String(z);
  }, zoom);
  await page.waitForTimeout(350);
  const clipped = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        ".sidebar nav button, .nav-section, .nav-group",
      ),
    )
      .filter((el) => el.getBoundingClientRect().width > 0)
      .filter((el) => el.scrollWidth - el.clientWidth > 1)
      .map(
        (el) =>
          `${(el.textContent || "").trim().slice(0, 14)}(${el.scrollWidth}>${el.clientWidth})`,
      ),
  );
  ok(
    `縮放 ${Math.round(zoom * 100)}%：側欄沒有任何一項被裁切`,
    clipped.length === 0,
    clipped.join("、") || "全部完整",
  );
  const navOverflow = await page.evaluate(() => {
    const nav = document.querySelector(".sidebar nav");
    return nav ? nav.scrollWidth - nav.clientWidth : -1;
  });
  ok(
    `縮放 ${Math.round(zoom * 100)}%：側欄不會長出橫向捲軸`,
    navOverflow <= 1,
    `溢出 ${navOverflow}px`,
  );
}
await page.evaluate(() => {
  document.documentElement.style.zoom = "1";
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  側欄子項目的順序，要和畫面由上而下的順序一致
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12（附截圖）：「流量核對工作表，第一個表格不是 OD 流量表，
 * 而應該是最上方的資料別（平／假日）設定欄位，所以左側功能列那邊把
 * OD 流量表當作第一個應該是錯的。」
 *
 * ⚠️ 這個錯**不會讓任何東西壞掉**，所以沒有測試就永遠不會被發現：
 *   子項目點下去照樣跳得到、照樣有醒目提示，只是第一個子項目之上還有
 *   一整塊設定沒有被列出來。使用者的讀法是「第一個子項目之前沒有東西」，
 *   於是那一塊就被整個略過。
 *
 * 所以這裡量的是**位置**：每一個子項目對應的區塊，在畫面上的 y 座標
 * 必須和側欄上的排列順序同方向遞增；而且第一個子項目要對應到
 * 這一頁**最上面**那一個有錨點的區塊。
 */
console.log("\n══ 側欄子項目順序 vs 畫面順序 ══");
const navOrder = await page.evaluate(() => {
  const items = [...document.querySelectorAll(".nav-sections .nav-section")];
  return items.map((button) => {
    const label = (button.textContent || "").trim();
    /* 錨點：按鈕上沒有寫，改用點下去會跳到的那一塊——用 data-goto-item 對回標題。 */
    return { label };
  });
});
const blockTops = await page.evaluate(() => {
  const map = {};
  for (const el of document.querySelectorAll(".content [id]")) {
    const rect = el.getBoundingClientRect();
    map[el.id] = Math.round(rect.top + window.scrollY);
  }
  return map;
});
/* 一個一個點下去，記下它實際跳到哪一塊。 */
const visited = [];
for (const item of navOrder) {
  await page
    .locator(`.nav-sections .nav-section:has-text("${item.label}")`)
    .first()
    .click();
  await page.waitForTimeout(400);
  const focused = await page.evaluate(() => {
    const el = document.querySelector(".content .is-focused");
    return el ? { id: el.id, top: Math.round(el.getBoundingClientRect().top + window.scrollY) } : null;
  });
  visited.push({ label: item.label, ...(focused || {}) });
}
ok(
  "前置：每一個子項目都點得到對應的區塊",
  visited.length > 0 && visited.every((v) => v.id),
  visited.map((v) => `${v.label}→${v.id || "找不到"}`).join("、"),
);
const tops = visited.map((v) => v.top ?? -1);
ok(
  "⚠️ 側欄子項目的排列順序，和那幾塊在畫面上由上而下的順序一致",
  tops.every((top, index) => index === 0 || top >= tops[index - 1]),
  visited.map((v) => `${v.label}@${v.top}px`).join("、"),
);
/* 第一個子項目要是這一頁最上面那一塊。 */
const highest = Object.entries(blockTops)
  .filter(([id]) => visited.some((v) => v.id === id) || id.startsWith("audit-"))
  .sort((a, b) => a[1] - b[1])[0];
ok(
  "⚠️ 第一個子項目對應的就是這一頁最上面那一塊（上面不可以還有沒被列出來的設定）",
  Boolean(highest) && highest[0] === visited[0]?.id,
  `最上面的是 ${highest?.[0]}（${highest?.[1]}px），第一個子項目是 ${visited[0]?.id}`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 流量核對工作台版面全部合格");
