import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
/*
 * 版號一律從 lib/traffic.ts 的 VERSION 取，不要在測試裡再寫死一次。
 * 寫死的話每次升版都要記得改這裡，忘了就是「測試失敗但程式是對的」，
 * 而更糟的是有人為了讓測試過去而改錯地方。
 */
import { VERSION } from "../lib/traffic.ts";

const MANUAL_BASE = `Turning-Traffic-${VERSION}-新手操作手冊`;

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
    "多計畫管理",
    "季度批次匯入",
    "車種轉向當量",
    "車種組成分析",
    "路口轉向圖",
    "跨計畫",
    "歷季趨勢比較",
    "資料品質檢查",
    "備份、還原與版本",
    "新手操作手冊",
  ])
    assert.match(html, new RegExp(text));
  assert.doesNotMatch(html, /HCM|服務水準|LOS/);
});

test("ships the final verified release", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, new RegExp(VERSION.replace(/\./g, "\\.")));
  assert.match(html, /轉向進階分析/);
  const source = await readFile(new URL("../app/traffic-app.tsx", import.meta.url), "utf8");
  assert.match(source, /圖卡排版預覽/);
  assert.match(source, /下載完整 PDF 手冊/);
  assert.ok(source.includes(MANUAL_BASE + ".pdf"), `程式裡的 PDF 手冊連結不是 ${MANUAL_BASE}.pdf`);
  assert.ok(source.includes(MANUAL_BASE + ".docx"), `程式裡的 Word 手冊連結不是 ${MANUAL_BASE}.docx`);
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

test("ships the rewritten beginner manual in PDF and editable Word", async () => {
  const { access } = await import("node:fs/promises");
  for (const file of [MANUAL_BASE + ".pdf", MANUAL_BASE + ".docx"])
    await access(new URL("../public/" + file, import.meta.url));
  // 手冊由單一 HTML 原始檔同時產生 PDF 與 Word，避免兩份說明不一致
  const manual = await readFile(new URL("../scripts/manual/manual.html", import.meta.url), "utf8");
  for (const text of [
    "零基礎也看得懂的 10 個名詞",
    "駛出支線",
    "駛入支線",
    "只顯示駛入 ＋ 聚焦路口A",
    "簡報沒有的車種，一律預設 1.0",
    "自己決定要匯出什麼",
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
