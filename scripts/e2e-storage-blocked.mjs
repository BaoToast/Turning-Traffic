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

/* ── 二、資料還在讀時，只能顯示過場，不可以先畫空的主程式 ── */
const slowCtx = await browser.newContext();
const slow = await slowCtx.newPage();
await slow.addInitScript(() => {
  const data = new Map();
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    close: () => {},
    transaction: () => {
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
      tx.objectStore = () => ({
        get(key) {
          const request = { onsuccess: null, onerror: null, result: undefined, error: null };
          queueMicrotask(() => {
            request.result = data.get(key);
            request.onsuccess?.();
            queueMicrotask(() => tx.oncomplete?.());
          });
          return request;
        },
        put(value, key) {
          const request = { onsuccess: null, onerror: null, result: key, error: null };
          queueMicrotask(() => {
            data.set(key, value);
            request.onsuccess?.();
            queueMicrotask(() => tx.oncomplete?.());
          });
          return request;
        },
        delete(key) {
          const request = { onsuccess: null, onerror: null, result: undefined, error: null };
          queueMicrotask(() => {
            data.delete(key);
            request.onsuccess?.();
            queueMicrotask(() => tx.oncomplete?.());
          });
          return request;
        },
      });
      return tx;
    },
  };
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const request = {
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
          onblocked: null,
          result: db,
          error: null,
        };
        setTimeout(() => request.onsuccess?.(), 1500);
        return request;
      },
    },
  });
});
await slow.goto(base, { waitUntil: "domcontentloaded" });
await slow.waitForTimeout(250);
const whileLoading = await slow.evaluate(() => ({
  text: document.body.innerText.replace(/\s+/g, " ").trim(),
  loading: Boolean(document.querySelector('[data-testid="storage-loading"]')),
  nav: document.querySelectorAll("nav button").length,
  fileInputs: document.querySelectorAll('input[type="file"]').length,
}));
ok(
  "本機資料還在讀取時顯示明確過場",
  whileLoading.loading && /正在讀取這台電腦上的資料/.test(whileLoading.text),
  whileLoading.text.slice(0, 100),
);
ok(
  "讀取完成前不可以先畫空的主程式或留下匯入／還原入口",
  whileLoading.nav === 0 && whileLoading.fileInputs === 0,
  `導覽鈕 ${whileLoading.nav}、檔案輸入 ${whileLoading.fileInputs}`,
);
await slow.waitForTimeout(1800);
const afterSlowLoad = await slow.evaluate(() => ({
  loading: Boolean(document.querySelector('[data-testid="storage-loading"]')),
  nav: document.querySelectorAll("nav button").length,
}));
ok(
  "資料讀完後才進入正常主畫面",
  !afterSlowLoad.loading && afterSlowLoad.nav > 3,
  `導覽鈕 ${afterSlowLoad.nav}`,
);
await slowCtx.close();

/* ── 三、第一次逾時要自動重試；兩次都逾時要顯示專用畫面 ── */
const retryCtx = await browser.newContext();
const retry = await retryCtx.newPage();
await retry.clock.install();
await retry.addInitScript(() => {
  window.__storageOpenCount = 0;
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    close: () => {},
    transaction: () => {
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
      tx.objectStore = () => ({
        get() {
          const request = { onsuccess: null, onerror: null, result: undefined, error: null };
          queueMicrotask(() => {
            request.onsuccess?.();
            queueMicrotask(() => tx.oncomplete?.());
          });
          return request;
        },
        put(_value, key) {
          const request = { onsuccess: null, onerror: null, result: key, error: null };
          queueMicrotask(() => {
            request.onsuccess?.();
            queueMicrotask(() => tx.oncomplete?.());
          });
          return request;
        },
      });
      return tx;
    },
  };
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: {
      open() {
        window.__storageOpenCount += 1;
        const request = {
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
          onblocked: null,
          result: db,
          error: null,
        };
        /* 第一次永遠不回；第二次立即成功。 */
        if (window.__storageOpenCount >= 2)
          queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
  });
});
await retry.goto(base, { waitUntil: "domcontentloaded" });
/*
 * ⚠️ 2026-09-29：第一次逾時之後**要先等 1.5 秒**才重試（RETRY_DELAY_MS）。
 *   使用者 2026-09-29 在線上遇到逾時，而手動重新整理一次就好了——
 *   立刻重試等於用同一個忙碌瞬間再賭一次，自動重試形同虛設。
 *   這裡先只推進到 8001ms，確認**第二次還沒開始**，證明那段等待真的存在；
 *   不驗這一步的話，把 RETRY_DELAY_MS 改回 0 也不會有人發現。
 */
await retry.clock.runFor(8001);
const midRetry = await retry.evaluate(() => window.__storageOpenCount);
ok(
  "第一次逾時之後不可以立刻重試，要先等 RETRY_DELAY_MS",
  midRetry === 1,
  `8001ms 時已經 open ${midRetry} 次（應該還是 1 次）`,
);
await retry.clock.runFor(1600);
const retryView = await retry.evaluate(() => ({
  opens: window.__storageOpenCount,
  nav: document.querySelectorAll("nav button").length,
  text: document.body.innerText.replace(/\s+/g, " ").trim(),
}));
ok(
  "第一次逾時後真的再次呼叫 indexedDB.open，而且第二次成功就正常載入",
  retryView.opens >= 2 && retryView.nav > 3,
  `open ${retryView.opens} 次、導覽鈕 ${retryView.nav}`,
);
ok(
  "自動重試成功時不可以誤顯示任何搶救畫面",
  !/暫時無法開啟本機資料庫|瀏覽器不允許這個網站儲存資料/.test(retryView.text),
);
await retryCtx.close();

const timeoutCtx = await browser.newContext();
const timeout = await timeoutCtx.newPage();
await timeout.clock.install();
await timeout.addInitScript(() => {
  window.__storageOpenCount = 0;
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: {
      open() {
        window.__storageOpenCount += 1;
        return {
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
          onblocked: null,
          result: { close() {} },
          error: null,
        };
      },
    },
  });
});
await timeout.goto(base, { waitUntil: "domcontentloaded" });
/* 8000（第一次逾時）＋1500（等待）＋8000（第二次逾時）＝17500 */
await timeout.clock.runFor(17501);
const timeoutView = await timeout.evaluate(() => ({
  opens: window.__storageOpenCount,
  text: document.body.innerText.replace(/\s+/g, " ").trim(),
  timeout: Boolean(document.querySelector('[data-testid="storage-timeout"]')),
  nav: document.querySelectorAll("nav button").length,
}));
ok(
  "兩次都逾時時顯示獨立的『暫時無法開啟』畫面",
  timeoutView.opens === 2 && timeoutView.timeout && /暫時無法開啟本機資料庫/.test(timeoutView.text),
  `open ${timeoutView.opens} 次`,
);
/*
 * ⚠️ 2026-09-29 改：建議清單要跟著 blocked 走。
 *   這個 mock 的 onblocked **從來沒有被呼叫**，所以 blocked === false——
 *   系統自己已經知道「不是其他分頁佔著資料庫」。
 *   舊版在這種情況下仍然把「先關閉同一網站的其他分頁」排第一條，
 *   而使用者 2026-09-29 就是只開一個分頁卻看到那一條。
 *   那跟 v2.1.84 拿掉「Cookie／無痕／擴充套件」是同一個毛病，當時漏了這一條。
 */
ok(
  "瀏覽器沒有回報 blocked 時，第一條不可以是「先關閉其他分頁」",
  !/先關閉同一網站的其他分頁/.test(timeoutView.text) &&
    /並沒有回報/.test(timeoutView.text) &&
    /先按下方按鈕重新載入/.test(timeoutView.text),
  timeoutView.text.slice(0, 220),
);
ok(
  "逾時畫面不冒充 Cookie／無痕／擴充套件封鎖",
  !/封鎖所有 Cookie|無痕或隱私模式|擴充套件/.test(timeoutView.text) &&
    !/瀏覽器不允許這個網站儲存資料/.test(timeoutView.text),
  timeoutView.text.slice(0, 180),
);
ok(
  "逾時畫面要講明系統試了兩次、而且兩次之間有等",
  /系統已自動試了兩次/.test(timeoutView.text) &&
    /等 1.5 秒再試一次/.test(timeoutView.text),
  timeoutView.text.slice(0, 160),
);
ok(
  "逾時後仍不可以顯示可操作的空主畫面",
  timeoutView.nav === 0 && /不要建立計畫、匯入資料或還原備份/.test(timeoutView.text),
  `導覽鈕 ${timeoutView.nav}`,
);
await timeoutCtx.close();

/* ── 三之二、瀏覽器真的回報 blocked 時，建議清單要換成另一套 ──
 *
 * ⚠️ 這一段是上一條的另一半：只驗「沒有 blocked 的時候不要叫人關分頁」，
 *   把整段文字寫死成一種也會通過。兩邊都要驗，這條守門才不是半條。
 */
const blockedTimeoutCtx = await browser.newContext();
const blockedTimeout = await blockedTimeoutCtx.newPage();
await blockedTimeout.clock.install();
await blockedTimeout.addInitScript(() => {
  window.__storageOpenCount = 0;
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: {
      open() {
        window.__storageOpenCount += 1;
        const request = {
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
          onblocked: null,
          result: { close() {} },
          error: null,
        };
        /* 回報 blocked，然後就這樣停著——真實世界裡「其他分頁佔著舊版」的樣子。 */
        queueMicrotask(() => request.onblocked?.());
        return request;
      },
    },
  });
});
await blockedTimeout.goto(base, { waitUntil: "domcontentloaded" });
await blockedTimeout.clock.runFor(17501);
const blockedTimeoutView = await blockedTimeout.evaluate(() => ({
  opens: window.__storageOpenCount,
  text: document.body.innerText.replace(/\s+/g, " ").trim(),
  timeout: Boolean(document.querySelector('[data-testid="storage-timeout"]')),
}));
ok(
  "前置：blocked 版本也真的走到逾時畫面、也真的開了兩次",
  blockedTimeoutView.timeout && blockedTimeoutView.opens === 2,
  `open ${blockedTimeoutView.opens} 次`,
);
ok(
  "瀏覽器回報 blocked 時，第一條才可以是「先關閉其他分頁」",
  /瀏覽器回報資料庫正在等其他分頁釋放/.test(blockedTimeoutView.text) &&
    /先關閉同一網站的其他分頁/.test(blockedTimeoutView.text) &&
    !/並沒有回報/.test(blockedTimeoutView.text),
  blockedTimeoutView.text.slice(0, 220),
);
ok(
  "blocked 版本的錯誤訊息要講出「正等候其他分頁釋放」",
  /正等候其他分頁釋放/.test(blockedTimeoutView.text),
  blockedTimeoutView.text.slice(0, 200),
);
await blockedTimeoutCtx.close();

/* ── 四、儲存空間正常時，不可以誤跳這個畫面 ── */
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

/* ── 五、只有 localStorage 被擋、IndexedDB 可用時，要正常運作 ── */
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
