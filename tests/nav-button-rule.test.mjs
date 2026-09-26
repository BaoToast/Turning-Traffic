/*
 * ══════════════════════════════════════════════════════════════════════
 *  「前往…」按鈕的準則（A11，使用者 2026-09-21 指示）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 準則：**看說明文字有沒有真的叫使用者去那一頁「做一件事」。**
 *   有  → 保留按鈕
 *   沒有 → 移除（只是「去那邊看結果」，或那一頁根本沒提到）
 *
 * 三支共 27 顆按鈕全部盤過，**只有 1 顆不通過**，而且三支是同一種異常：
 *   路口轉向     調查日期不只一個 → 流量核對工作台
 *   交通服務水準 調查日期不只一個 → 尖峰明細
 *   全日交通量   調查日期不只一個 → 可追溯明細
 * 那一項的動作完全在那一列完成（「指定調查日期」選單），
 * 按鈕只會讓人以為還有一步沒做。使用者原話：
 *   「請把前往流量核對工作台拿掉」
 *
 * ⚠️ 其餘 24 顆一顆都不能動。這一支守的是**那一顆不要回來**，
 *   以及**其他的不要被順手清掉**。
 *
 * ⚠️ 「27 顆／24 顆」是**三支合計**的數字。本支自己只有 7 顆
 *   （`grep -c "viewLabel:" lib/traffic.ts`），下面那條反面守門的門檻
 *   要照**本支**的數量訂，不是照三支合計。2026-09-23 的複查抓到
 *   訊息寫「其餘 24 顆」而斷言是 `>= 6`，兩者不是同一件事——
 *   訊息與實際守的範圍對不起來，會讓人以為守得比實際嚴。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../lib/traffic.ts", import.meta.url),
  "utf8",
);

/** 「調查日期不只一個」那一筆的 resolution 區塊。 */
function dateMultiResolution() {
  const start = source.indexOf('category: "調查日期不只一個"');
  assert.notEqual(start, -1, "找不到「調查日期不只一個」這個異常");
  const from = source.indexOf("resolution: {", start);
  assert.notEqual(from, -1, "那一筆沒有 resolution");
  return source.slice(from, source.indexOf("});", from));
}

test("⚠️「調查日期不只一個」不可以有「前往…」按鈕", () => {
  const block = dateMultiResolution();
  assert.doesNotMatch(
    block,
    /\bview:/,
    "按鈕回來了——那一頁只是顯示結果，會讓人以為還有一步沒做",
  );
  assert.doesNotMatch(block, /\bviewLabel:/);
  assert.match(
    block,
    /指定調查日期/,
    "說明文字不再指向那一列的選單，使用者會不知道要做什麼",
  );
});

test("⚠️ 其餘的「前往…」按鈕不可以被順手清掉", () => {
  /*
   * 反面守門：上面那一支是「找不到就綠」。整批按鈕被刪光時它也會綠，
   * 而那是另一種災難——使用者會失去 24 個真的有用的捷徑。
   */
  const count = (source.match(/\bviewLabel:/g) || []).length;
  /*
   * 本支目前有 7 顆（三支合計 27 顆裡的 7 顆），移除的那 1 顆已經不在裡面。
   * 門檻訂在 7：**一顆都不可以再少**。真的要再移除一顆時，
   * 請照準則判斷、改這個數字，並在這裡寫下是哪一顆、為什麼。
   */
  assert.ok(
    count >= 7,
    `本支的「前往…」按鈕只剩 ${count} 顆（應為 7 顆）——` +
      "通過準則的那幾顆是使用者真的在用的捷徑，不可以被順手清掉。" +
      "（27／24 是三支合計的數字，不要拿來當本支的門檻。）",
  );
});
