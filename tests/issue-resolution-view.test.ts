/*
 * ══════════════════════════════════════════════════════════════════════
 *  異常的「前往某分頁」按鈕，指的必須是真的存在的側欄分頁（2026-09-26 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 為什麼要有這一支：
 *
 * `IssueResolution.view` 寫的是側欄 `NAV` 的 id。寫錯的 id **不會有任何錯誤
 * 訊息**——畫面照樣畫出一顆「前往車種轉向當量」的按鈕，按下去什麼都不會發生。
 * 使用者看到的是「這個按鈕壞了」，而且沒有任何線索。
 *
 * 2026-09-26 實際抓到：`view: "params"`，而側欄 id 是 `parameters`。
 * 它從 v2.1.60 左右就這樣寫著，而既有的 `scripts/e2e-maintenance.mjs`
 * **只點第一顆** `.resolution-goto`，那一顆一直不是第一顆，所以從來沒被按到。
 * 這一輪把 DAY-missing 那一顆的 view 改成同一個值之後，它變成第一顆，
 * e2e 當場紅——那次紅是對的，而它暴露的是一個一直都在的缺陷。
 *
 * ── 這一支守什麼 ────────────────────────────────────────────────
 *
 * ① `lib/traffic.ts` 裡每一個 `view: "…"` 都必須是 `app/traffic-app.tsx` 的
 *    `NAV` 真的列得出來的 id。
 * ② `viewLabel` 要與那個 id 在側欄上的 label 一致——標籤寫別的名字，
 *    使用者會去側欄找一個不存在的項目。
 *
 * ⚠️ 前置檢查：NAV 的 id 清單與 view 的清單都要真的抓到（各至少 5 個），
 *   抓不到就紅。少了這一條，正規式失效時整支會安靜地變成恆真。
 * ⚠️ 這是**原始碼比對**，不是行為測試：行為那一面由
 *   `scripts/e2e-maintenance.mjs` 負責（它現在每一顆按鈕都點），
 *   兩支合起來才完整——靜態比對抓得到「id 打錯」，
 *   行為測試抓得到「id 對但那一頁畫不出來」。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const app = readFileSync(
  new URL("../app/traffic-app.tsx", import.meta.url),
  "utf8",
);
const lib = readFileSync(new URL("../lib/traffic.ts", import.meta.url), "utf8");

/** 側欄 NAV 列得出來的 id → label。 */
function navEntries() {
  const at = app.indexOf("const NAV:");
  assert.notEqual(at, -1, "找不到 NAV 的宣告——寫法改了就要跟著改這一支");
  const block = app.slice(at, at + 12_000);
  const found = new Map<string, string>();
  for (const m of block.matchAll(
    /\{\s*id:\s*"([A-Za-z]+)",\s*label:\s*"([^"]+)"/g,
  ))
    found.set(m[1], m[2]);
  return found;
}

/** lib/traffic.ts 裡每一組 resolution 的 view 與 viewLabel。 */
function resolutionViews() {
  /*
   * ⚠️ 切掉區塊註解再掃：本檔的註解裡會引用寫錯的舊值當例子
   *  （這一支自己的說明就引用了 `view: "import"`），
   *   不切掉的話正解會被自己的說明絆倒。
   */
  const source = lib.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { view: string; label: string | null }[] = [];
  for (const m of source.matchAll(
    /view:\s*"([A-Za-z]+)",\s*(?:viewLabel:\s*"([^"]+)",)?/g,
  ))
    out.push({ view: m[1], label: m[2] ?? null });
  return out;
}

test("⚠️ 異常解決方式指名的分頁 id，必須是側欄真的有的那幾個", () => {
  const nav = navEntries();
  const views = resolutionViews();
  /* 前置檢查：兩邊都真的抓到東西。 */
  assert.ok(nav.size >= 10, `只從 NAV 抓到 ${nav.size} 個分頁——正規式失效了`);
  assert.ok(views.length >= 5, `只抓到 ${views.length} 個 view——正規式失效了`);

  const bad = views
    .filter((item) => !nav.has(item.view))
    .map((item) => `view: "${item.view}"（側欄沒有這個 id）`);
  assert.deepEqual(
    [...new Set(bad)],
    [],
    "異常的「前往某分頁」按鈕指到不存在的分頁 id。寫錯不會有錯誤訊息，" +
      "按鈕照樣畫出來、按下去什麼都不會發生：\n  " +
      [...new Set(bad)].join("\n  ") +
      `\n目前側欄有的 id：${[...nav.keys()].join("、")}`,
  );
});

test("⚠️ viewLabel 要與那個分頁在側欄上的名字一致", () => {
  const nav = navEntries();
  const wrong = resolutionViews()
    .filter((item) => item.label && nav.get(item.view) !== item.label)
    .map(
      (item) =>
        `view: "${item.view}" 寫 viewLabel「${item.label}」，側欄上是「${nav.get(item.view)}」`,
    );
  assert.deepEqual(
    [...new Set(wrong)],
    [],
    "按鈕上的名字與側欄不一致——使用者會去側欄找一個不存在的項目：\n  " +
      [...new Set(wrong)].join("\n  "),
  );
});
