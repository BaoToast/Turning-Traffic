import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
/*
 * 版號一律從 lib/traffic.ts 的 VERSION 取，不要在測試裡再寫死一次。
 * 寫死的話每次升版都要記得改這裡，忘了就是「測試失敗但程式是對的」，
 * 而更糟的是有人為了讓測試過去而改錯地方。
 */
import { VERSION } from "../lib/traffic.ts";

const MANUAL_BASE = `路口轉向程式手冊_${VERSION}`;

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the Turning Traffic application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Turning Traffic/);
  assert.match(html, /路口尖峰轉向交通量分析系統/);
  assert.doesNotMatch(html, /codex-preview|loading skeleton/i);
});

test("ships required analysis surfaces", async () => {
  const response = await render();
  const html = await response.text();
  for (const text of [
    "總覽儀表板",
    /*
     * 「多計畫管理」→「計畫管理」：跨計畫比較於 2026-09-09 依使用者授權移除，
     * 這一頁只剩建立／切換／刪除計畫，名稱與位置一併調整。
     *
     * ⚠️ 2026-09-13 再改名為「**建立與管理計畫**」（三支統一，使用者指定：
     *   「三個程式建立計畫的分頁名稱應該都要統一為 建立與管理計畫」）。
     *   這一條當時忘了跟著改，於是 v2.1.68、v2.1.69 兩版交出去時這支測試是紅的——
     *   「計畫管理」不是「建立與管理計畫」的子字串（後者是「管理計畫」）。
     */
    "建立與管理計畫",
    /* 移除「跨計畫／多路口比較」時，這一頁的兩塊表被保留成獨立一頁 */
    "各路口尖峰彙總",
    "季度批次匯入",
    "車種轉向當量",
    "車種組成分析",
    "路口轉向圖",
    "歷季趨勢比較",
    "資料維護",
    /*
     * 「備份、還原與版本」→「備份與還原」：名稱裡的「版本」指的是
     * 「系統版本與更新紀錄」那一塊，使用者 2026-09-09 指名移除
     *（「沒有人會關注這個」），頁面上已無版本相關內容。
     */
    "備份與還原",
    "新手操作手冊",
  ])
    assert.match(html, new RegExp(text));
  assert.doesNotMatch(html, /HCM|服務水準|LOS/);
  /*
   * ★ 移除守門：跨計畫比較已整組移除，側欄不可以再出現這幾個字。
   *   把 nav 項目加回去、或把「跨計畫歷季趨勢」面板放回計畫管理頁，這裡就紅。
   *   ⚠️ 用 doesNotMatch 是刻意的——移除類的守門要驗「不存在」，
   *   只驗「其他東西還在」不會抓到殘留。
   */
  assert.doesNotMatch(html, /跨計畫/);
  /*
   * ⚠️ 這裡**不驗**「系統版本與更新紀錄已移除」。
   *
   * 實測過：那個面板在「備份與還原」頁上，而這一支測的是伺服器端算出來的
   * 首頁 HTML——裡面只有預設那一頁，從來就沒有它。在舊版（面板還在時）
   * 跑同一條斷言也是**綠的**，等於一條恆真的假檢查。
   * 真正的守門放在 scripts/e2e-removed-surfaces.mjs：實際點到那一頁再看。
   *
   * ★「多計畫管理」也不可以只驗 /計畫管理/——那是「多計畫管理」的子字串，
   *   舊版照樣會綠。要同時驗舊名不存在。
   */
  assert.doesNotMatch(html, /多計畫管理/);
  assert.doesNotMatch(html, /備份、還原與版本/);
});

test("ships the final verified release", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, new RegExp(VERSION.replace(/\./g, "\\.")));
  assert.match(html, /轉向進階分析/);
  const source = await readFile(new URL("../app/traffic-app.tsx", import.meta.url), "utf8");
  assert.match(source, /圖卡排版預覽/);
  assert.match(source, /下載新手手冊/);
  assert.ok(source.includes(MANUAL_BASE + ".pdf"), `程式裡的 PDF 手冊連結不是 ${MANUAL_BASE}.pdf`);
  // 匯入預覽要能整批取消：預覽的用意就是「先看有沒有問題，有問題先去修檔案」，
  // 只能一列一列刪除的話，看到錯誤卻放棄不了，預覽就失去意義。
  assert.match(source, /取消預覽/);
  assert.match(source, /setImportRows\(\[\]\);\s*\n\s*setImportResolutions\(\{\}\);\s*\n\s*setImportConflictModes\(\{\}\);/);
  assert.match(source, /if \(fileRef\.current\) fileRef\.current\.value = "";/);
  // 報表匯出項目自選（報表分頁要切換後才渲染，因此檢查原始碼）
  assert.match(source, /這個計畫要匯出哪些分析結果/);
  assert.match(source, /儲存目前勾選/);
  const reportItems = await readFile(new URL("../lib/final-features.ts", import.meta.url), "utf8");
  assert.match(reportItems, /sheet: "各路口駛出尖峰流量"/);
  assert.match(reportItems, /sheet: "各路口駛入尖峰流量"/);
});

test("ships the rewritten beginner manual in PDF", async () => {
  const { access } = await import("node:fs/promises");
  await access(new URL("../public/" + MANUAL_BASE + ".pdf", import.meta.url));
  // 手冊只由 scripts/manual/manual.html 這一份原始檔產生，畫面上的說明與它同源
  const manual = await readFile(new URL("../scripts/manual/manual.html", import.meta.url), "utf8");
  /*
   * 手冊 v2.1.64 整份重寫（22 章，寫給完全沒有交通概念的人），
   * 所以這裡的取樣字串跟著換成新版真正存在的段落。
   *
   * 取樣的用意是擋「手冊被換成一份空殼或舊檔還照樣通過」，
   * 所以刻意挑**內容**而不是章節標題——標題最容易在重寫時原樣留著。
   * 每一條都對應手冊裡一個必須存在的說明：名詞章、駛出／駛入的定義、
   * 新分頁「各路口尖峰彙總」、轉向進階分析底下那兩張新圖、
   * 以及最後的每季檢查表。
   */
  for (const text of [
    "零基礎也看得懂的名詞",
    "駛出路口",
    "駛入路口",
    "同一批車",
    "各路口尖峰彙總",
    "尖峰小時內四格 15 分鐘分布",
    "連續 60 分鐘流率",
    "成果檔不能當備份用",
    "每季作業檢查表",
  ])
    assert.ok(manual.includes(text), "手冊缺少段落：" + text);
});

/*
 * 手冊裡一定要有「本版」的更新說明。
 *
 * 姊妹專案踩過的坑：升版時用字串取代把新的更新說明插進 manual.html，
 * 但比對的字串對不上，replace 靜靜地什麼都沒做，連續三版的更新說明
 * 完全沒進到手冊裡，而手冊照樣產生、版號也照樣對得上。
 * 只檢查「手冊裡有這個版號」等於沒檢查（標題與版本戳記本來就有），
 * 所以這裡檢查的是**更新說明區塊的標題**帶著目前版號。
 */
test("手冊裡有本版的更新說明區塊", async () => {
  const manual = await readFile(
    new URL("../scripts/manual/manual.html", import.meta.url),
    "utf8",
  );
  assert.ok(
    manual.includes(`系統版本：${VERSION}　更新日期：`),
    `manual.html 的封面戳記不是 ${VERSION}——升版時可能只改了版號、` +
      `忘了寫這一版做了什麼，或是字串取代沒有生效。`,
  );
});

test("支線沒有自訂名稱時，代碼與名稱不可以並排寫兩次", async () => {
  /*
   * 使用者 2026-09-14（附圖）：「流量核對工作台，紅框處重複寫了兩次路口A，
   *   是否錯誤?」——畫面上是「駛出路口 A ・ 路口A」。
   *
   * 支線沒有自訂名稱時，名稱是系統用代碼組出來的（「路口A」），
   * 把代碼與名稱並排寫就是同一件事講兩次。
   *
   * ⚠️ 姊妹專案「全日交通量」同一天修過**一模一樣**的問題
   *  （那邊是「路口A－路口A」）。這是會跨程式重演的那一類，所以要釘住。
   *
   * ⚠️ 驗的是那支判斷函式本身，不是畫面字串——畫面字串要有資料才長得出來，
   *   而這個判斷是純函式，四種情況都驗得到，比抓畫面可靠。
   */
  const { isNamedArm } = await import("../app/arm-name.ts");
  assert.equal(isNamedArm("A", "路口A"), false, "「路口A」是系統組出來的，不算自訂");
  assert.equal(isNamedArm("A", "路口 A"), false, "中間有空白也一樣不算");
  assert.equal(isNamedArm("A", "A"), false, "名稱就等於代碼，不算自訂");
  assert.equal(isNamedArm("A", "中山北路"), true, "真的取過名字才算");
  assert.equal(isNamedArm("A", ""), false, "沒有名稱就只寫代碼");
});
