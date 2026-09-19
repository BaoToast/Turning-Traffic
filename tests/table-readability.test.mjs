/*
 * ══════════════════════════════════════════════════════════════════
 *  表格可讀性：極淡斑馬紋不可以變成「看起來有顏色」
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-10 定案時給了兩條驗收線：
 *   「只要**不要文字被背景色遮蔽**或**看的眼花撩亂**就可以了」
 *
 * 這一支把那兩句話變成可以量的東西：
 *
 *   一、「文字不被遮蔽」＝ 主要與次要文字在斑馬列與 hover 列上都要 ≥ 4.5:1。
 *   二、「不眼花」沒辦法直接量，但它的成因可以：**底色一重就是在「上顏色」，
 *       而不是在「分行」**。所以釘住「斑馬底色與白底的相對亮度差 ≤ 5%」。
 *       日後有人把顏色調重，這裡會紅。
 *
 * ⚠️ 為什麼要有第二條：只驗對比的話，把底色換成飽和的淡綠也會過
 *（淡綠上的深色字對比一樣很高），但那正是使用者說「看起來很雜亂」的東西。
 * 對比守的是「看得見」，亮度差守的是「不吵」——兩件事，缺一不可。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

/** sRGB 相對亮度（WCAG 定義）。 */
function luminance(hex) {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a, b) {
  const [hi, lo] = luminance(a) > luminance(b) ? [a, b] : [b, a];
  return (luminance(hi) + 0.05) / (luminance(lo) + 0.05);
}

/**
 * 從 CSS 裡把實際用的顏色讀出來，不要在測試裡另外寫死一份。
 *
 * ⚠️ 刻意用「找字串 → 找下一個 background」而不是組一條正規表示式：
 * 選擇器裡有 `.`、`(`、`)`、`:` 這些會被當成 regex 語法的字元，
 * 在樣板字串裡逐層跳脫很容易寫錯（第一版就寫錯了，三項全紅），
 * 而且錯的樣子是「找不到」——看起來像樣式壞了，其實是測試自己壞了。
 */
function colorOf(selector) {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `CSS 裡找不到選擇器 ${selector}`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  assert.ok(open !== -1 && close !== -1, `${selector} 的規則區塊不完整`);
  const hit = /background:\s*(#[0-9a-fA-F]{6})/.exec(css.slice(open, close));
  assert.ok(hit, `找不到 ${selector} 的背景色——樣式是不是被改掉或改名了？`);
  return hit[1].toLowerCase();
}

const WHITE = "#ffffff";
/* 這兩個是這一支程式的主要／次要文字色（v20.62 起為了對比調深過）。 */
const INK = "#1d3038";
const MUTED = "#5f6f74";

test("斑馬紋的底色必須淡到「分得出行」而不是「看起來有顏色」", () => {
  const zebra = colorOf(".table-scroll tbody tr:nth-child(even)");
  const gap = (luminance(WHITE) - luminance(zebra)) * 100;
  assert.ok(
    gap > 0.5,
    `斑馬底色 ${zebra} 與白底幾乎沒有差別（${gap.toFixed(2)}%），等於沒做`,
  );
  assert.ok(
    gap <= 5,
    `斑馬底色 ${zebra} 與白底的亮度差 ${gap.toFixed(2)}% 超過 5%，` +
      "那已經是「上顏色」而不是「分行」，正是使用者說的眼花來源",
  );
});

test("斑馬列與 hover 列上的文字對比都要過 AA", () => {
  const zebra = colorOf(".table-scroll tbody tr:nth-child(even)");
  const hover = colorOf(".table-scroll tbody tr:hover");
  for (const [name, background] of [
    ["斑馬列", zebra],
    ["hover 列", hover],
  ])
    for (const [role, ink] of [
      ["主要文字", INK],
      ["次要文字", MUTED],
    ]) {
      const value = contrast(ink, background);
      assert.ok(
        value >= 4.5,
        `${role} ${ink} 在${name} ${background} 上只有 ${value.toFixed(2)}:1，未達 AA 的 4.5:1`,
      );
    }
});

test("hover 要壓得過斑馬紋，否則偶數列 hover 時看不出反應", () => {
  /*
   * ⚠️ 這一條是實作上真的會踩的：只寫 `tr:hover` 的話，
   * 它與 `tr:nth-child(even)` **具體度相同**，誰後寫誰贏——
   * 偶數列 hover 時可能完全沒有反應，而奇數列有。
   * 所以規則要同時涵蓋 `tr:nth-child(even):hover`。
   */
  assert.match(
    css,
    /\.table-scroll tbody tr:nth-child\(even\):hover/,
    "hover 規則要明確涵蓋偶數列，否則偶數列 hover 沒有反應",
  );
  const zebra = colorOf(".table-scroll tbody tr:nth-child(even)");
  const hover = colorOf(".table-scroll tbody tr:hover");
  assert.notEqual(hover, zebra, "hover 的顏色不可以和斑馬紋一樣");
});

test("數字欄要用等寬數字，這一項不加任何顏色卻解決同一個問題", () => {
  assert.match(
    css,
    /\.table-scroll (td|th),[\s\S]{0,80}font-variant-numeric:\s*tabular-nums/,
    "數字沒有上下對齊時，橫向讀錯行的機率會大幅上升",
  );
});

test("刻意不做「整張表換一個顏色」", () => {
  /*
   * 這是一條**反向**守門：使用者原本想「每張表換一個顏色」，
   * 討論後定案不做（顏色是有意義的訊號，用來表達「這是第幾張表」
   * 這種沒有意義的區別，正是雜亂感的來源）。
   * 沒有這一條的話，日後很容易又被加回去而沒有人記得為什麼不該加。
   */
  assert.doesNotMatch(
    css,
    /\.table-panel:nth-child\(|\.table-panel--color-\d/,
    "不可以依表的順序給整張表不同顏色——定案是用表頭與排版區分，不是用顏色",
  );
});
