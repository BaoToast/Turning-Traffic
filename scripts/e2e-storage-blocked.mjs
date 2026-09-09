/*
 * 端對端：瀏覽器不讓網站用本機儲存空間時，畫面不可以整頁空白。
 *
 * 起因（實測，v2.1.51）：把 window.localStorage 改成「存取即拋錯」——
 * 也就是瀏覽器設定成「封鎖所有網站資料」時的實際行為——重新開啟網頁後：
 *   ・畫面完全空白（連導覽列都沒有）
 *   ・主控台一則未捕捉的例外「localStorage 已被停用」
 *   ・沒有任何訊息告訴使用者發生什麼事、該怎麼辦
 * 原因是讀取那兩行寫在 try 之外，例外直接冒到 React、整棵樹卸載。
 *
 * 三支系統在同一情境下的對照（都實測過）：
 *   全日交通量   → toast「IndexedDB 已被停用」，畫面正常、不假裝存檔成功
 *   交通服務水準 → 顯示搶救畫面
 *   路口轉向     → 整頁空白　← 這一支要修的就是這個
 *
 * ⚠️ 假通過陷阱兩個：
 *  一、只驗「畫面不是空的」不夠——顯示成正常的主畫面也會通過，可是那等於
 *      讓使用者在一個永遠存不進去的狀態下工作。所以要驗**指定的那段說明**。
 *  二、要順便驗「儲存空間正常時不可以誤跳這個畫面」，否則把它寫成無條件
 *      顯示也會通過。
 */
import { chromium } from "playwright";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const PORT = 8241;
const server = await serve(PORT);
const base = `http://127.0.0.1:${PORT}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());

/* ── 一、儲存空間被封鎖 ── */
const blockedCtx = await browser.newContext();
const blocked = await blockedCtx.newPage();
const blockedErrors = [];
blocked.on("pageerror", (e) => blockedErrors.push(String(e.message)));
blocked.on("dialog", (d) => d.accept());
/*
 * v2.1.53 起資料存在 IndexedDB，所以要擋的是 IndexedDB。
 * 兩個都擋，因為瀏覽器的「封鎖所有 Cookie／網站資料」本來就是兩個一起擋——
 * 只擋 localStorage 的話程式會正常運作（那是改版後的正確行為，
 * 由本檔下半段的第三段驗），這一段就會變成什麼都沒驗到的假通過。
 */
await blocked.addInitScript(() => {
  Object.defineProperty(window, "indexedDB", {
    get() {
      throw new DOMException("IndexedDB 已被停用", "SecurityError");
    },
  });
  Object.defineProperty(window, "localStorage", {
    get() {
      throw new DOMException("localStorage 已被停用", "SecurityError");
    },
  });
});
await blocked.goto(base, { waitUntil: "networkidle" });
await blocked.waitForTimeout(2200);

const view = await blocked.evaluate(() => ({
  text: document.body.innerText.replace(/\s+/g, " ").trim(),
  panel: Boolean(document.querySelector(".load-error")),
}));

ok(
  "封鎖儲存空間時，畫面不可以是空白的",
  view.text.length > 30,
  view.text ? `畫面有 ${view.text.length} 個字` : "畫面完全空白",
);
ok(
  "要明講是「瀏覽器不允許儲存」，不是資料損壞",
  /瀏覽器不允許這個網站儲存資料/.test(view.text),
  view.text.slice(0, 70) || "（空白）",
);
ok(
  "儲存權限被封鎖時無法知道原本有沒有資料，不可以武斷宣稱沒有資料",
  /無法判斷這台電腦原本是否有資料/.test(view.text) &&
    !/這台電腦上目前沒有本系統的資料/.test(view.text),
  view.text.slice(0, 150),
);
ok(
  "要給得出處理方式（封鎖 Cookie／無痕／擴充套件）",
  /封鎖所有 Cookie/.test(view.text) && /無痕/.test(view.text) && /擴充套件/.test(view.text),
);
ok(
  "不可以在這個畫面提供「下載原始資料」——按下去一定失敗",
  !/下載原始資料/.test(view.text),
  view.text.includes("下載原始資料") ? "畫面上仍有下載鈕" : "沒有下載鈕",
);
ok(
  "要提醒使用者現在不要匯入（看起來會成功，關掉就沒了）",
  /請不要匯入資料/.test(view.text),
);
ok(
  "不可以留下未捕捉的例外",
  blockedErrors.length === 0,
  blockedErrors.slice(0, 2).join(" | ") || "沒有例外",
);
await blockedCtx.close();

/* ── 二、儲存空間正常時，不可以誤跳這個畫面 ── */
const normalCtx = await browser.newContext();
const normal = await normalCtx.newPage();
const normalErrors = [];
normal.on("pageerror", (e) => normalErrors.push(String(e.message)));
await normal.goto(base, { waitUntil: "networkidle" });
await normal.waitForTimeout(2200);
const normalView = await normal.evaluate(() => ({
  text: document.body.innerText.replace(/\s+/g, " ").trim(),
  nav: document.querySelectorAll("nav button").length,
}));
ok(
  "前置：儲存空間正常時是正常主畫面，不可以誤跳封鎖說明",
  normalView.nav > 3 && !/瀏覽器不允許這個網站儲存資料/.test(normalView.text),
  `導覽列 ${normalView.nav} 個項目`,
);
ok("正常情境也不可以有未捕捉的例外", normalErrors.length === 0, normalErrors.slice(0, 2).join(" | "));
await normalCtx.close();

/* ── 三、只有 localStorage 被擋、IndexedDB 可用時，要正常運作 ── */
/*
 * v2.1.53 把資料搬到 IndexedDB 之後，localStorage 只剩「讀舊資料來搬家」
 * 這一個用途，讀不到就當作沒有舊資料。所以這種情況不可以再跳搶救畫面。
 */
const legacyOnlyCtx = await browser.newContext();
const legacyOnly = await legacyOnlyCtx.newPage();
const legacyErrors = [];
legacyOnly.on("pageerror", (e) => legacyErrors.push(String(e.message)));
await legacyOnly.addInitScript(() => {
  Object.defineProperty(window, "localStorage", {
    get() {
      throw new DOMException("localStorage 已被停用", "SecurityError");
    },
  });
});
await legacyOnly.goto(base, { waitUntil: "networkidle" });
await legacyOnly.waitForTimeout(2200);
const legacyView = await legacyOnly.evaluate(() => ({
  text: document.body.innerText.replace(/\s+/g, " ").trim(),
  nav: document.querySelectorAll("nav button").length,
}));
ok(
  "只有 localStorage 被擋（IndexedDB 可用）時要正常運作，不可以跳搶救畫面",
  legacyView.nav > 3 && !/瀏覽器不允許這個網站儲存資料/.test(legacyView.text),
  `導覽列 ${legacyView.nav} 個項目`,
);
ok(
  "這種情況也不可以有未捕捉的例外",
  legacyErrors.length === 0,
  legacyErrors.slice(0, 2).join(" | "),
);
await legacyOnlyCtx.close();

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
