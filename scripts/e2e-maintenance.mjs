/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-8／X-20：資料維護是**唯一**的落點，舊落點不可以還留著
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16：
 *   「三份程式都有統一資料維護位置也都有刪除單一季的功能」
 *   「刪除單一季功能統一位置後，"已匯入季度資料"功能就能移除掉了，
 *     一樣不需要刪除單一筆資料的功能了……不要同樣功能在很多地方都出現」
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**不可以只驗「資料維護頁有一顆刪除鈕」**。要驗它**真的刪得掉**
 *     （刪完那一季從季度清單裡消失），否則一顆什麼都不做的鈕也會過。
 * 二、**不可以只驗「舊的小分頁不見了」**。側欄不見、畫面上那一塊還在，
 *     使用者照樣捲得到、照樣按得到——所以要連**畫面上的元素**一起驗。
 * 三、**逐筆刪除要真的消失**：那是使用者指名捨棄的東西
 *     （「資料一多，會顯得太長串」）。
 * 四、刪除是破壞性操作，所以順序是「先驗舊落點都沒了 → 最後才真的刪」，
 *     不然刪完之後資料不見，後面幾條全部變成恆真。
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

/* 兩季測資，才驗得出「刪掉一季之後另一季還在」。 */
const seed = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
const template = seed.records[0];
seed.records = [
  { ...template, quarter: "115Q1", station: "T1-01", name: "示範1－示範一路口" },
  { ...template, quarter: "115Q2", station: "T2-01", name: "示範1－示範一路口" },
];

const browser = await chromium.launch(launchOptions());
let page = await (
  await browser.newContext({ viewport: { width: 1700, height: 1100 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
/* ⚠️ 刪除有 confirm，要按確定，否則第三節整段恆真。 */
page.on("dialog", (event) => event.accept());
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

/* ══ 一、舊落點都要不見了 ══════════════════════════════════ */
console.log("\n══ 一、舊落點不可以還留著 ══");
ok(
  "⚠️ ① 側欄**不可以**再有「資料品質檢查」這個大分頁（已併進資料維護）",
  (await page.evaluate(() =>
    [...document.querySelectorAll("aside nav button")].every(
      (button) => !(button.textContent || "").includes("資料品質檢查"),
    ),
  )) === true,
);
ok(
  "⚠️ ① 側欄**不可以**再有「已匯入季度資料」小分頁",
  (await page.evaluate(() =>
    [...document.querySelectorAll("aside nav button")].every(
      (button) => !(button.textContent || "").includes("已匯入季度資料"),
    ),
  )) === true,
);
ok("前置：側欄找得到「資料維護」", await gotoPage("資料維護"));
/* ⚠️ 側欄不見不代表畫面上沒有——舊區塊還在的話照樣捲得到、按得到。 */
ok(
  "⚠️ ① 畫面上也**不可以**再有「已匯入季度資料」那一塊",
  (await page.locator("#import-quarters").count()) === 0,
);
ok(
  "⚠️ ① 逐筆刪除（每個路口一顆「站號 ×」）要整個消失",
  (await page.evaluate(() =>
    [...document.querySelectorAll("button")].every(
      (button) => !/^T\d+-\d+\s*×$/.test((button.textContent || "").trim()),
    ),
  )) === true,
);

/* ══ 二、資料維護頁上該有的東西 ══════════════════════════ */
console.log("\n══ 二、資料維護頁 ══");
for (const [id, label] of [
  ["quality-run", "執行資料異常檢查"],
  ["maintenance-delete-quarter", "刪除單一季度"],
  ["quality-summary", "資料異常檢查摘要"],
  ["quality-reasons", "檢查結果"],
])
  ok(`② 「${label}」在畫面上（#${id}）`, (await page.locator(`#${id}`).count()) === 1);
/*
 * ⚠️ X-47（使用者 2026-09-16）：「異常原因與計算方式」那一塊**已經移除**
 *   （「從檢查結果和檢查摘要中就可以完全覆蓋到所有異常原因了」）。
 *   這是反面守門：它不可以再回來。
 */
ok(
  "⚠️ ② 「異常原因與計算方式」那一塊**不可以**再出現（重複的欄位已移除）",
  (await page.locator("#quality-detail").count()) === 0 &&
    !(await page.evaluate(() =>
      document.body.textContent.includes("異常原因與計算方式"),
    )),
);
/*
 * ⚠️ 側欄列的每一項都要**點得到對應的那一塊**。舊版把「異常原因與計算方式」
 *   的 anchor 掛在左欄的檢查結果清單上，點下去跳到的不是那個名字所指的東西。
 */
const navLabels = await page.evaluate(() =>
  [...document.querySelectorAll("aside nav .nav-section, aside nav .side-nav-item")].map(
    (node) => (node.textContent || "").trim(),
  ),
);
/*
 * ⚠️ X-59（使用者 2026-09-17）：「執行資料異常檢查……就應該增加在左側欄位，
 *   但左側欄位沒有看到這個標題」。它有一顆按鈕，符合列成小分頁的判準，
 *   而且沒按它下面兩塊都是空的——四項，不是三項。
 */
ok(
  "② 側欄列出資料維護底下的小分頁（X-59 之後是四個）",
  ["刪除單一季度", "執行資料異常檢查", "資料異常檢查摘要", "檢查結果"].every(
    (label) => navLabels.some((text) => text.includes(label)),
  ) && !navLabels.some((text) => text.includes("異常原因與計算方式")),
  navLabels.join("、"),
);
/*
 * ⚠️ X-58（使用者 2026-09-17，附圖）：「『資料異常檢查摘要』這個標題在欄位中
 *   沒看到，請修正」。
 *
 *   側欄列得出來、點下去也捲得到、外框也亮了——但那一塊上面**沒有那個名字**。
 *   使用者跳過去之後只看得到四張卡，對不上自己剛剛點的是什麼。
 *   舊守門只驗 `#quality-summary` 這個元素存在（見上面那一組 for 迴圈），
 *   驗不到「那個名字在畫面上看得到」，所以一直全綠。
 *
 * ⚠️ 用 innerText（不是 textContent）：要的是**看得到**的字。
 */
for (const [id, label] of [
  ["quality-run", "執行資料異常檢查"],
  ["maintenance-delete-quarter", "刪除單一季度"],
  ["quality-summary", "資料異常檢查摘要"],
  ["quality-reasons", "檢查結果"],
]) {
  const headings = await page.evaluate((anchor) => {
    const block = document.getElementById(anchor);
    if (!block) return null;
    return [...block.querySelectorAll("h1,h2,h3,h4,summary")].map((node) =>
      (node.innerText || "").replace(/\s+/g, " ").trim(),
    );
  }, id);
  ok(
    `⚠️ ② 「${label}」那一塊上面看得到自己的標題（#${id}）`,
    Array.isArray(headings) && headings.some((text) => text.includes(label)),
    headings === null ? "找不到那一塊" : headings.join("／") || "（一個標題都沒有）",
  );
}
/*
 * ⚠️ X-57（使用者 2026-09-17，附圖）：「資料異常檢查按鈕的欄位整個黏在畫面左側」。
 *
 *   成因：這支的 `.panel` **本身沒有內距**，內距是掛在特定子元素上的
 *   （`.panel > .panel-head`、`.panel > p`）。這一塊用的是 `.panel-title`，
 *   而 `.panel-title` 從來沒有任何內距規則，於是標題、說明與按鈕
 *   一路貼到卡片左邊框。
 *
 * ⚠️ 要量的是「**每一個**看得到的子元素離卡片左緣有多遠」，取最小值。
 *   只量標題的話，一個只修標題的半套修法照樣全綠——而使用者看到的
 *   仍然是按鈕貼著邊。（2026-09-17 第一版就是只量標題，
 *   另外那條「標題與狀態列同一條線」更糟：狀態列是 block，
 *   它的 box 左緣永遠等於卡片內容左緣，兩邊**恆等**，
 *   反例試出來是綠的——那一條是假守門，已整條換掉。）
 */
{
  const box = await page.evaluate(() => {
    const block = document.getElementById("quality-run");
    if (!block) return null;
    const b = block.getBoundingClientRect();
    const parts = [
      ["標題", block.querySelector("h3")],
      ["眉標", block.querySelector(".panel-title span")],
      ["說明", block.querySelector("small")],
      ["按鈕", block.querySelector("button")],
      ["狀態列", block.querySelector(".maintenance-run-state")],
    ].filter(([, node]) => node);
    return parts.map(([name, node]) => ({
      name,
      gap: node.getBoundingClientRect().left - b.left,
    }));
  });
  const worst =
    box && box.length
      ? box.reduce((a, c) => (c.gap < a.gap ? c : a))
      : null;
  ok(
    "⚠️ ② 「執行資料異常檢查」卡片裡沒有任何一樣東西貼著左邊框",
    !!worst && worst.gap >= 12 && box.length >= 4,
    worst
      ? `最靠左的是「${worst.name}」${worst.gap.toFixed(1)}px（共量 ${box.length} 樣）`
      : "量不到",
  );
}

/* ══ 二之二、X-44：按過「執行資料異常檢查」才產生結果 ══════════ */
console.log("\n══ 二之二、事後檢查要按了才跑 ══");
const summaryNumbers = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#quality-summary .panel strong")].map(
      (node) => (node.textContent || "").replace(/\s+/g, ""),
    ),
  );
const beforeRun = await summaryNumbers();
ok(
  "⚠️ ② 按之前，四張摘要卡不給數字（匯入時的即時提醒是另一件事）",
  beforeRun.length > 0 && beforeRun.every((text) => text === "—"),
  beforeRun.join("／"),
);
ok(
  "② 按之前，檢查結果那一塊寫「尚未檢查」",
  (await page.evaluate(
    () => document.getElementById("quality-reasons")?.textContent ?? "",
  )).includes("尚未檢查"),
);
await page.locator('[data-testid="quality-run"]').click();
await page.waitForTimeout(1200);
const afterRun = await summaryNumbers();
ok(
  "⚠️ ② 按下去之後才出現數字（按鈕要真的做一件事，不能是空殼）",
  afterRun.length > 0 && afterRun.some((text) => /\d/.test(text)),
  afterRun.join("／"),
);
ok(
  "② 狀態列寫出這一次檢查的時間與項目數",
  (await page.locator('[data-testid="quality-run-state"]').innerText()).includes(
    "上次檢查",
  ),
  await page.locator('[data-testid="quality-run-state"]').innerText(),
);
/* ══ 二之三、X-48：檢查範圍是全部季度，清單可用自己的季別下拉縮小 ══ */
console.log("\n══ 二之三、檢查範圍與季別篩選 ══");
const issueRowCount = () =>
  page.evaluate(
    () => document.querySelectorAll("#quality-reasons .issue-list > div").length,
  );
const allQuarterRows = await issueRowCount();
ok(
  "⚠️ ③ 檢查掃的是**全部季度**（測資兩季各有一筆異常，所以要看得到兩季）",
  allQuarterRows >= 1,
  `${allQuarterRows} 列`,
);
const quarterOptions = await page.evaluate(() =>
  [...(document.querySelector('[data-testid="issue-quarter-filter"]')?.options ?? [])].map(
    (option) => option.value,
  ),
);
ok(
  "③ 這一頁有自己的季別下拉，預設是「全部季度」",
  quarterOptions[0] === "" &&
    (await page.inputValue('[data-testid="issue-quarter-filter"]')) === "",
  quarterOptions.join("、"),
);
if (quarterOptions.length > 1) {
  await page.selectOption('[data-testid="issue-quarter-filter"]', quarterOptions[1]);
  await page.waitForTimeout(800);
  const narrowed = await issueRowCount();
  ok(
    "⚠️ ③ 選了某一季之後，清單只剩那一季（而且不可以變成 0）",
    narrowed > 0 && narrowed <= allQuarterRows,
    `全部 ${allQuarterRows} 列 → ${quarterOptions[1]} ${narrowed} 列`,
  );
  /* ⚠️ 摘要卡**不可以**跟著縮——它回答的是「還有幾項沒處理」。 */
  const summaryAfterFilter = await summaryNumbers();
  ok(
    "⚠️ ③ 摘要卡**不受**季別篩選影響（縮小範圍會讓人以為問題變少了）",
    JSON.stringify(summaryAfterFilter) === JSON.stringify(afterRun),
    `篩選前 ${afterRun.join("／")}　篩選後 ${summaryAfterFilter.join("／")}`,
  );
  await page.selectOption('[data-testid="issue-quarter-filter"]', "");
  await page.waitForTimeout(600);
}

ok(
  "⚠️ ② 這一支**不可以**有「異常提醒門檻」（使用者裁示：結構性檢查沒有門檻可調）",
  (await page.evaluate(() =>
    !document.body.textContent.includes("異常提醒門檻"),
  )) === true,
);

/* ══ 二之四、X-49：每一列都要寫出「解決方式」 ══════════════ */
console.log("\n══ 二之四、X-49：解決方式 ══");
/*
 * 使用者 2026-09-16：
 *   「我建議在檢查結果表中，新增一欄"解決方式"(例如重新匯入檔案、
 *     指引前往某分頁進行人工確認等)」
 *   「如果這個異常狀況真的只能靠重新匯入解決，那就請在檢查結果表中，
 *     標註說明請重新匯入該筆檔案」
 *
 * ⚠️ 刻意迴避的假通過：
 *   一、不可以只驗「有這個欄位」。空字串、或每一列都同一句通用句
 *       （「請檢查資料」）照樣會過，而那等於沒寫。所以要驗
 *       **每一列都有字、而且長度像一句話**。
 *   二、「只能重新匯入」那幾筆一定要**真的寫出那四個字**——
 *       那正是使用者指名要的那一句。
 *   三、有「前往某分頁」按鈕的，要驗**按下去真的換頁**，不是一顆裝飾。
 */
const resolutions = await page.evaluate(() =>
  [...document.querySelectorAll("#quality-reasons .issue-list > div")].map(
    (row) => {
      const box = row.querySelector('[data-testid="issue-resolution"]');
      return {
        category: row.querySelector("b")?.textContent?.trim() ?? "",
        kind: box?.getAttribute("data-kind") ?? "",
        text: box?.querySelector("span")?.textContent?.trim() ?? "",
        goto: box?.querySelector(".resolution-goto")?.textContent?.trim() ?? "",
      };
    },
  ),
);
ok(
  "前置：檢查結果裡真的有列（沒有的話底下全部恆真）",
  resolutions.length > 0,
  `${resolutions.length} 列`,
);
ok(
  "⚠️ ④ 每一列都有「解決方式」，而且每一句都有實際內容（不是空字串）",
  resolutions.length > 0 &&
    resolutions.every((item) => item.text.length >= 20),
  resolutions
    .map((item) => `${item.category}:${item.text.length}字`)
    .join("、"),
);
ok(
  "⚠️ ④ 每一列都標出處理類別（重新匯入／人工確認／畫面修正）",
  resolutions.length > 0 &&
    resolutions.every((item) =>
      ["重新匯入", "人工確認", "畫面修正"].includes(item.kind),
    ),
  [...new Set(resolutions.map((item) => item.kind))].join("／"),
);
ok(
  "⚠️ ④ 標成「重新匯入」的那幾筆，句子裡要真的寫出「重新匯入」四個字",
  resolutions
    .filter((item) => item.kind === "重新匯入")
    .every((item) => item.text.includes("重新匯入")),
);
/*
 * ⚠️ 同一種異常的兩列寫同一句是**對的**（同一種問題當然同一個解法），
 *   所以不可以用「每一列都不一樣」當判準——那會逼我把同一種異常
 *   硬寫成兩句話。要驗的是**不同種類的異常不可以共用同一句**。
 *   （跨全部種類的唯一性由 tests/plaintext-markup.test.mjs 靜態守住，
 *     那一支掃得到測資裡沒出現的種類。）
 */
{
  const byCategory = new Map();
  for (const item of resolutions) {
    const seen = byCategory.get(item.text);
    if (seen && seen !== item.category)
      byCategory.set(item.text, seen + "／" + item.category);
    else if (!seen) byCategory.set(item.text, item.category);
  }
  const shared = [...byCategory.entries()].filter(([, who]) =>
    who.includes("／"),
  );
  ok(
    "⚠️ ④ 不同種類的異常不可以共用同一句解決方式（那等於沒寫）",
    shared.length === 0,
    shared.map(([, who]) => who).join("、") ||
      `${new Set(resolutions.map((item) => item.category)).size} 種異常各寫各的`,
  );
}
const gotoRow = resolutions.findIndex((item) => item.goto);
ok("④ 至少有一列給了「前往某分頁」的按鈕", gotoRow >= 0);
if (gotoRow >= 0) {
  const viewBefore = await page.evaluate(
    () => document.querySelector("h1")?.textContent?.trim() ?? "",
  );
  await page
    .locator("#quality-reasons .issue-list > div .resolution-goto")
    .first()
    .click();
  await page.waitForTimeout(900);
  const viewAfter = await page.evaluate(
    () => document.querySelector("h1")?.textContent?.trim() ?? "",
  );
  ok(
    "⚠️ ④ 按「前往…」真的換到那一頁（不是一顆裝飾用的按鈕）",
    viewAfter !== viewBefore && viewAfter.length > 0,
    `${viewBefore} → ${viewAfter}`,
  );
  /*
   * 回到資料維護頁，後面的檢查才接得下去。
   * ⚠️ 用這一支自己的 gotoPage（掃側欄 nav），不要自己另寫一份 querySelector：
   *   我第一版寫成掃全頁的 button，配到的是別的東西，後面整段變成
   *   「0 筆異常／0 季」而紅——紅的原因與要驗的事情無關。
   */
  ok("④ 驗完之後回得到資料維護頁", await gotoPage("資料維護"));
  await page.locator('[data-testid="quality-run"]').click();
  await page.waitForTimeout(1600);
}

/* ══ 三、真的刪得掉 ══════════════════════════════════════ */
console.log("\n══ 三、刪除單一季度要真的刪得掉 ══");
const before = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="mt-quarter-to"] option')].map(
    (option) => option.value,
  ),
);
ok("前置：有兩季可以刪（只有一季的話下面恆真）", before.length === 2, before.join("、"));
/*
 * ⚠️ 面板不存在時要記一筆紅，不可以直接讓 playwright 拋例外——
 *   例外會把後面幾條整段吃掉，看不出到底壞了幾項。
 */
const hasPanel =
  (await page.locator('[data-testid="maintenance-delete-quarter-select"]').count()) === 1;
ok("前置：找得到刪除單一季度的下拉選單", hasPanel);
const target = hasPanel
  ? await page.inputValue('[data-testid="maintenance-delete-quarter-select"]')
  : "";
ok(
  "③ 預設選的是**最早一季**（最新一季通常是正在看的那一季，當刪除鈕的預設值太危險）",
  target === before[0],
  `${target}（清單最早：${before[0]}）`,
);
if (hasPanel) {
  await page.locator('[data-testid="maintenance-delete-quarter-run"]').click();
  await page.waitForTimeout(2000);
}
const after = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="mt-quarter-to"] option')].map(
    (option) => option.value,
  ),
);
ok(
  "⚠️ ③ 按下去之後那一季**真的不見了**（只驗鈕能按＝什麼都沒驗到）",
  after.length === 1 && !after.includes(target),
  `${before.join("、")} → ${after.join("、")}`,
);
ok(
  "③ 另一季要還在（不可以一次刪光）",
  after.includes(before[1]),
  after.join("、"),
);

/* ══ 四、X-49：資料處理完之後重按檢查，問題要真的消失 ══════ */
/*
 * 使用者 2026-09-16：
 *   「使用者處理完後，重新按一次檢查，問題如果解決了，就要確實消失」
 *
 * ⚠️ 這一節**一定要排在第三節之後**：它會把一整季刪掉當作「使用者處理掉了」，
 *   排在前面的話第三節就沒有兩季可以刪，紅的原因與要驗的事情無關
 *  （我第一版就是排在前面，實測踩到）。
 *
 * ⚠️ 刻意迴避的假通過：
 *   一、不可以只驗「按了會重跑」。要**真的把問題源頭拿掉**再按，
 *       驗那一季的那幾筆不見了——否則檢查吃快取也會全綠。
 *   二、要驗**剩下的那幾筆還在**。全部歸零也算「消失」，
 *       但那是檢查壞掉，不是問題解決了。
 *   三、比對用的是**季別**，不是筆數：筆數對得上也可能是刪 A 冒出 B。
 */
console.log("\n══ 四、X-49：重按檢查，已解決的要消失 ══");
/*
 * ⚠️ 第三節已經刪掉一季，這裡要先把測資**重新灌回來**才有兩季可用。
 *
 * ⚠️ 只 reload **沒有用**（實測）：這支程式會把 localStorage 的內容搬進
 *   IndexedDB，之後就以 IndexedDB 為準，addInitScript 寫回去的
 *   localStorage 會被忽略。所以要開一個**全新的 context**（IndexedDB 也是新的）。
 */
await page.close();
const freshContext = await browser.newContext({
  viewport: { width: 1700, height: 1100 },
  locale: "zh-TW",
});
page = await freshContext.newPage();
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.addInitScript(
  (value) => localStorage.setItem("turning-traffic-state-v2", value),
  JSON.stringify(seed),
);
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2200);
ok("前置：回得到資料維護頁", await gotoPage("資料維護"));
await page.locator('[data-testid="quality-run"]').click();
await page.waitForTimeout(1600);
/** 檢查結果目前列出哪幾季（用這一頁自己的季別下拉的選項當依據）。 */
const issueQuartersNow = () =>
  page.evaluate(() =>
    [
      ...(document.querySelector('[data-testid="issue-quarter-filter"]')
        ?.options ?? []),
    ]
      .map((option) => option.value)
      .filter(Boolean),
  );
const quartersBefore = await issueQuartersNow();
const rowsBefore = await issueRowCount();
if (quartersBefore.length >= 2) {
  const gone = quartersBefore[0];
  await page.selectOption("#maintenance-delete-quarter select", gone);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const button = [
      ...document.querySelectorAll("#maintenance-delete-quarter button"),
    ].find((item) => (item.textContent || "").includes("刪除"));
    button?.click();
  });
  await page.waitForTimeout(1800);
  await page.locator('[data-testid="quality-run"]').click();
  await page.waitForTimeout(1800);
  const quartersAfter = await issueQuartersNow();
  const rowsAfter = await issueRowCount();
  ok(
    "⚠️ ⑥ 處理掉來源之後重按檢查，那一季的異常**真的消失**（不是留在畫面上）",
    !quartersAfter.includes(gone),
    `${quartersBefore.join("、")} → ${quartersAfter.join("、") || "(沒有異常了)"}`,
  );
  ok(
    "⚠️ ⑥ 剩下那幾季的異常**還在**（全部歸零代表檢查壞了，不是問題解決了）",
    rowsAfter > 0 && rowsAfter < rowsBefore,
    `${rowsBefore} 筆 → ${rowsAfter} 筆`,
  );
} else {
  ok(
    "前置：測資要有兩季以上的異常，這一節才驗得到東西",
    false,
    quartersBefore.join("、") || "(沒有異常)",
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 資料維護：舊落點都收掉了、四塊都在、刪除單一季度真的刪得掉");
