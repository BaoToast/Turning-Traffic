/*
 * ══════════════════════════════════════════════════════════════════
 *  淺底上的文字一律要過 AA（4.5:1）
 * ══════════════════════════════════════════════════════════════════
 *
 * 起因：2026-09-10 為了做表格斑馬紋，寫了 table-readability 的對比測試，
 * 它抓到 `.table-scroll td small` 的 `#889699` 在**白底**上只有 2.92:1。
 * 那不是斑馬紋造成的，是本來就存在的問題，只是從來沒有人量過。
 * 順手把整份樣式表掃了一遍：**43 處**淺灰文字低於 4.5:1，
 * 最糟的一處只有 2.24:1。
 *
 * 使用者的要求是「文字不要被背景色遮掩而消失了」。淺灰配白就是那句話
 * 的另一種形式——不是被蓋住，是根本就淡到看不清楚。
 *
 * 修法：保持色相與彩度，只把明度壓到剛好過 4.5:1。
 * 看起來還是同一個灰，只是讀得到了。
 *
 * ── ⚠️ 這一支刻意迴避的假通過 / 假紅 ──────────────────────────
 *
 * 一、**不可以只驗幾個抽樣的顏色**。這一支掃的是整份樣式表裡每一條
 *     `color: #xxxxxx`，新加的規則自動被納入。少了這一點，
 *     日後新增一個淺灰小字沒有人會發現。
 * 二、深底上的文字**不可以拿白底來量**，那會是假紅。所以有一份豁免清單，
 *     每一項都要寫出「它的底色是什麼」，不可以只寫選擇器了事。
 * 三、`:disabled` 一律豁免：停用中的控制項本來就該看起來是停用的，
 *     WCAG 1.4.3 也明文排除。把它改到 4.5:1 反而讓人以為按得下去。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

/*
 * ── ⚠️ 2026-09-15 補：`color: var(--x)` 以前完全掃不到 ──────────────
 *
 *   這一支原本只認 `color: #xxxxxx` 這種字面色。實測：路口轉向的
 *   `--muted: #6b7b80` 在白底上只有 **4.40:1**，而全站有幾十處
 *   `color: var(--muted)`——整個變數這條路從來沒有被量過。
 *   （`.trace-merged-into` 之所以被抓到，只是因為它剛好寫死了顏色。）
 *
 *   所以先把 `:root` 裡的自訂屬性讀出來，量的時候一併解析。
 * ⚠️ 只解析一層，而且只解析解得開的：解不開的（例如 var 套 var、
 *   或定義在別的選擇器裡）一律跳過，不要猜——猜錯會產生假紅。
 */
const CUSTOM_PROPERTIES = (() => {
  const out = new Map();
  /*
   * ⚠️ 一定要先把註解拿掉再切區塊。
   *   `:root { ... }` 裡面的說明文字含有 `scrollIntoView({block:"start"})`
   *   這種**帶大括號的程式碼片段**，`[^{}]*` 會在那裡斷掉，
   *   於是整個 :root 一個變數都讀不到——而測試會安靜地變成「沒有變數要檢查」。
   *   （第一版就是這樣：路口轉向讀到 0 個變數，全綠。）
   */
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of withoutComments.matchAll(/:root[^{]*\{([^{}]*)\}/g))
    for (const hit of block[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g))
      out.set(hit[1], hit[2].toLowerCase());
  return out;
})();
/** 把一個 color 的值解析成 #rrggbb；解不開就回 null（跳過，不猜）。 */
function resolveColor(raw) {
  const value = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  const varHit = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (varHit) return CUSTOM_PROPERTIES.get(varHit[1]) || null;
  return null;
}

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

/*
 * 豁免：這些選擇器的底色**不是**淺色，所以不能拿白底去量。
 * 每一項都註明底色，日後有人要加進來也得先講清楚底是什麼。
 */
const DARK_GROUND = [
  ["sidebar", "側欄 --side #3a2350"],
  ["brand", "側欄品牌區，同上"],
  ["side-foot", "側欄頁尾，同上"],
  ["nav-group", "側欄分區小標，同上"],
  [".toast", "深色浮出提示 #18384f"],
  [".busy", "半透明深色遮罩"],
  ["hero", "深色漸層首屏"],
  [".badge", "各種深色小徽章"],
  ["legend-title", "轉向圖 SVG 內的圖例，底是圖面不是頁面"],
  ["vehicle-badge-new", "新車種徽章，底是 #8a5a08，另有專屬檢查釘住"],
  ["nav-section", "側欄子項目（這一頁有哪幾塊），底就是側欄 #3a2350"],
  ["nav-collapse", "側欄的小分頁收合鈕，底就是側欄 #3a2350"],
];

/*
 * 有色底上的文字，逐組釘住實際的前景／背景。
 *
 * ⚠️ 上面那一支是拿**白底**掃整份樣式表，對「深底上的白字」量不準，
 *   所以那種只能豁免。但豁免不等於不用管——那正是最容易出事的地方：
 *   我 2026-09-11 做新車種徽章時用了 #d99a19 配白字，實測只有 2.45:1，
 *   字幾乎融進底色，而上面那一支因為豁免完全不會紅。
 *   所以凡是進豁免清單的有色底，都要在這裡補一組明確的前景／背景。
 */
const ON_COLOR = [
  ["新車種徽章", "#ffffff", "#8a5a08"],
  ["新車種列的主要文字", "#17333b", "#fdf7ea"],
  ["新車種列的次要文字", "#5f6f74", "#fdf7ea"],
  ["季別衝突提示", "#7a5405", "#fdf7ea"],
  ["季別已變更提示", "#7a5405", "#fdf7ea"],
  /*
   * 側欄子項目（2026-09-11 新增）。底是側欄的深紫 #3a2350。
   * ⚠️ 進了豁免清單就一定要在這裡補一組，否則豁免＝沒人管——
   *   那正是新車種徽章 2.45:1 活下來的原因。
   */
  ["側欄子項目", "#dcd2e8", "#3a2350"],
  ["側欄子項目（目前這一個）", "#ffffff", "#3a2350"],
  /*
   * 小分頁收合鈕（2026-09-13 新增）。底是側欄的深紫 #3a2350，
   * 按鈕自己那層半透明白底只會讓它更亮，量底色是保守的。
   */
  ["側欄收合鈕", "#eaf4fa", "#3a2350"],
  ["側欄收合鈕（滑鼠移上去）", "#ffffff", "#3a2350"],
];

test("有色底上的文字也要 ≥ 4.5:1（豁免不等於可以不管）", () => {
  const failures = [];
  for (const [name, fg, bg] of ON_COLOR) {
    const ratio = contrast(fg, bg);
    if (ratio < 4.5)
      failures.push(`${name}：${fg} 配 ${bg} 只有 ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(
    failures,
    [],
    `以下有色底上的文字未達 AA 的 4.5:1：\n- ${failures.join("\n- ")}`,
  );
});

test("前置：上面那一條真的算得出低對比（不然它是恆真的）", () => {
  /* 我實測踩過的那一組，必須被判成不合格。 */
  assert.ok(
    contrast("#ffffff", "#d99a19") < 4.5,
    "白字配 #d99a19 應該要算出低於 4.5:1，這條規則等於沒做",
  );
  assert.ok(contrast("#ffffff", "#8a5a08") >= 4.5, "改好的色卻算不過");
});
/* 停用中的控制項：WCAG 1.4.3 明文排除，而且改亮會讓人以為還能按。 */
const DISABLED = ":disabled";

/** 這一條規則要不要納入檢查。 */
function checked(selector) {
  if (selector.includes(DISABLED)) return false;
  return !DARK_GROUND.some(([needle]) => selector.includes(needle));
}

test("淺底上的每一個文字色都要 ≥ 4.5:1（整份樣式表掃過，不是抽樣）", () => {
  const failures = [];
  /*
   * ⚠️ 用「規則區塊」而不是整份字串上的正規表示式：
   *   要知道每一個顏色屬於哪一條選擇器，才判斷得出它的底是深是淺，
   *   也才能在紅字裡告訴人該去改哪一行。
   */
  const rules = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  let inspected = 0;
  for (const rule of rules) {
    const selector = rule[1].trim().split("\n").pop().trim();
    if (!checked(selector)) continue;
    for (const hit of rule[2].matchAll(/(?<!-)color:\s*(#[0-9a-fA-F]{6}|var\(\s*--[\w-]+\s*\))/g)) {
      const value = resolveColor(hit[1]);
      if (!value) continue;
      inspected += 1;
      const ratio = contrast(value, "#ffffff");
      if (ratio < 4.5)
        failures.push(`${selector} 的 ${value} 只有 ${ratio.toFixed(2)}:1`);
    }
  }
  /*
   * ⚠️ 這一行是防「測試自己壞掉」的：正規表示式寫錯時，
   *   一個顏色都掃不到，failures 是空的，測試會**變成綠的**。
   *   釘一個下限，掃不到東西時要紅。
   */
  assert.ok(
    inspected >= 60,
    `只掃到 ${inspected} 個文字色，太少——選擇器解析是不是壞了？`,
  );
  assert.deepEqual(
    failures,
    [],
    `以下文字色在白底上未達 AA 的 4.5:1：\n- ${failures.join("\n- ")}`,
  );
});

test("豁免清單本身要合理：不可以把整份樣式表都豁免掉", () => {
  /*
   * 豁免是必要的（深底文字拿白底量會是假紅），但豁免清單如果無限膨脹，
   * 這一支就變成裝飾品。釘住「被檢查的規則要遠多於被豁免的」。
   */
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((rule) =>
    rule[1].trim().split("\n").pop().trim(),
  );
  const exempt = rules.filter((selector) => !checked(selector)).length;
  const total = rules.length;
  assert.ok(
    exempt < total * 0.25,
    `豁免了 ${exempt}／${total} 條規則，超過四分之一——豁免清單失控了`,
  );
});
