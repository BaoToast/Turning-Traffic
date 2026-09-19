/*
 * ══════════════════════════════════════════════════════════════════════
 *  這支程式不可以在開啟時往外連線
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 為什麼需要這一支 ──
 *
 * 2026-09-12 實測抓到：試用版單檔 HTML 開啟時仍然會連一次 Google 抓字型
 *（globals.css 第一行的 @import）。使用者 2026-09-13 看過有無網路字型的
 * 並排截圖後決定**正式站也拿掉**，三支程式一致。
 *
 * ⚠️ 為什麼這件事值得一支守門：**它壞掉的時候完全沒有訊息。**
 *   沒有網路、或公司網路擋掉 fonts.googleapis.com 時，字型靜靜地退回備援，
 *   畫面和驗過的長得不一樣，而使用者與我都不會知道看的是哪一種。
 *   這支程式處理的是調查成果，不該在啟動時對外發出任何請求。
 *
 * ⚠️ 只擋「瀏覽器真的會去抓」的那幾種寫法。函式庫裡的 XML 命名空間
 *   （schemas.openxmlformats.org…）只是字串，不會發請求；寬鬆比對會全部誤判，
 *   然後人就會把這一條關掉，等於沒守。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8").catch(
  () => "",
);

const FETCHERS = [
  [/@import\s+(?:url\(\s*)?["']?https?:\/\/[^"')]+/g, "CSS 的 @import"],
  [/url\(\s*["']?https?:\/\/[^"')]+/g, "CSS 的 url()"],
  [/(?:src|href)="https?:\/\/[^"]+"/g, "標籤的 src／href"],
];

test("⚠️ 樣式表不可以向外部網站要字型或圖片", () => {
  const hits = [];
  for (const [pattern, what] of FETCHERS)
    for (const m of css.matchAll(pattern)) hits.push(`${what}：${m[0].slice(0, 90)}`);
  assert.deepEqual(
    hits,
    [],
    "globals.css 又開始往外連了：\n" + hits.join("\n"),
  );
});

test("首頁的 HTML 也不可以載入外部資源", () => {
  const hits = [];
  for (const [pattern, what] of FETCHERS)
    for (const m of html.matchAll(pattern)) hits.push(`${what}：${m[0].slice(0, 90)}`);
  assert.deepEqual(hits, [], "index.html 又開始往外連了：\n" + hits.join("\n"));
});

test("這幾條真的抓得到（反面檢查，不然它們可能永遠是綠的）", () => {
  const broken =
    '@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+TC");';
  const caught = FETCHERS.some(([pattern]) => new RegExp(pattern.source).test(broken));
  assert.ok(caught, "把網路字型加回來時應該要被抓到");
  /* 而備援字型堆疊要還在——拿掉 @import 之後靠的就是它。 */
  assert.match(css, /"Microsoft JhengHei"/);
});
