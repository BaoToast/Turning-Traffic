/*
 * ══════════════════════════════════════════════════════════════════
 *  側欄：三支程式各一個顏色，但文字一律要讀得到
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-10 的兩句話，這一支把它們變成可以量的東西：
 *
 *   「三個程式側欄的顏色不要一樣，讓使用者很直覺的發現，顏色不同是否
 *     開錯程式了，**但要注意的是文字不要被背景色遮掩而消失了**」
 *   「例如現在背景是深色，**文字亮白會比淡白色還清楚**」
 *
 * 三條驗收線：
 *   一、側欄文字（未選取／已選取）在自己的底色上都要 ≥ 7:1（AAA）。
 *       這裡刻意不用 4.5:1 的 AA：側欄字是長時間掃視的導覽，
 *       而且使用者已經明講現在「不夠白」，守在 AA 等於承認現況可以。
 *   二、子項目的字（比主項小）同樣要 ≥ 7:1。
 *   三、三支程式的底色**必須彼此分得出來**，否則「換色好認」這件事沒發生。
 *
 * ⚠️ 為什麼三支的顏色寫在這一支測試裡：
 *    另外兩支程式的原始碼不在這個 repo，沒辦法直接讀它們的 CSS。
 *    這裡釘住的是**這一版定案的三個色票**，任何一支要改色都得回來改這裡，
 *    順便被強迫重新算一次對比——這正是要的效果。
 *    本程式（路口轉向）的那一個另外從 globals.css 讀出來比對，
 *    確保「測試裡寫的」與「真的用的」不會分岔。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

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

/** 從 :root 讀一個自訂屬性的值，不要在測試裡另外抄一份。 */
function token(name) {
  const at = css.indexOf(`--${name}:`);
  assert.notEqual(at, -1, `globals.css 的 :root 裡找不到 --${name}`);
  const value = css.slice(at + name.length + 3, css.indexOf(";", at)).trim();
  assert.match(value, /^#[0-9a-fA-F]{6}$/, `--${name} 不是六碼色碼：${value}`);
  return value.toLowerCase();
}

/* 三支程式的側欄底色。改色一定要回來改這裡。 */
const SIDEBARS = {
  全日交通量: "#0f3d31",
  路口轉向: "#3a2350",
  交通服務水準: "#17354d",
};
/* 側欄文字：未選取與已選取。三支共用同一組。 */
const SIDE_INK = "#eaf4fa";
const SIDE_INK_STRONG = "#ffffff";
/* 子項目的字（14px，比主項小，所以更需要對比）。 */
const SIDE_ITEM_INK = "#dcecf3";

test("測試裡寫的側欄色票，必須就是本程式真正用的那一個", () => {
  assert.equal(
    token("side"),
    SIDEBARS.路口轉向,
    "globals.css 的 --side 與這支測試寫的不一樣——改了顏色卻沒有重新驗對比",
  );
  assert.equal(token("side-ink"), SIDE_INK);
  assert.equal(token("side-ink-strong"), SIDE_INK_STRONG);
});

test("三支程式的側欄文字在各自底色上都要達 AAA（7:1）", () => {
  for (const [program, background] of Object.entries(SIDEBARS))
    for (const [role, ink] of [
      ["未選取", SIDE_INK],
      ["已選取", SIDE_INK_STRONG],
      ["子項目", SIDE_ITEM_INK],
    ]) {
      const value = contrast(ink, background);
      assert.ok(
        value >= 7,
        `${program} 的${role}文字 ${ink} 在 ${background} 上只有 ${value.toFixed(2)}:1，` +
          "未達 AAA 的 7:1——使用者說的「文字被背景色遮掩」就是這個",
      );
    }
});

test("已選取要比未選取更亮，否則「現在在哪一頁」看不出來", () => {
  for (const background of Object.values(SIDEBARS))
    assert.ok(
      contrast(SIDE_INK_STRONG, background) > contrast(SIDE_INK, background),
      "已選取的字必須比未選取更亮",
    );
});

test("三支程式的側欄底色必須彼此分得出來", () => {
  /*
   * ⚠️ 只驗「色碼不一樣」不夠：#0f3d31 與 #0f3d32 也不一樣，
   *   但沒有人看得出差別，「開錯程式一眼看出來」就沒有發生。
   *
   * ⚠️ 也不可以用 RGB 距離。三個底色都很深，RGB 三個分量本來就都小，
   *   於是「一眼看得出是綠是紫」的兩個顏色，RGB 距離也只有二三十——
   *   第一版就是這樣寫的，門檻訂 40 直接把合理的配色判成不合格。
   *   深色配色要看的是**色相**：綠、藍、紫是三種顏色，深淺不是重點。
   */
  const hueOf = (hex) => {
    const [r, g, b] = [1, 3, 5].map(
      (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
    );
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    const hue =
      max === r
        ? ((g - b) / d + (g < b ? 6 : 0)) * 60
        : max === g
          ? ((b - r) / d + 2) * 60
          : ((r - g) / d + 4) * 60;
    return hue;
  };
  const saturationOf = (hex) => {
    const [r, g, b] = [1, 3, 5].map(
      (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
    );
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  };
  const entries = Object.entries(SIDEBARS);
  for (const [name, hex] of entries)
    assert.ok(
      saturationOf(hex) >= 0.3,
      `${name}（${hex}）的彩度只有 ${saturationOf(hex).toFixed(2)}，` +
        "太接近中性灰，看起來三支都一樣",
    );
  for (let a = 0; a < entries.length; a += 1)
    for (let b = a + 1; b < entries.length; b += 1) {
      const [nameA, hexA] = entries[a];
      const [nameB, hexB] = entries[b];
      const raw = Math.abs(hueOf(hexA) - hueOf(hexB));
      const gap = Math.min(raw, 360 - raw);
      assert.ok(
        gap >= 40,
        `${nameA}（${hexA}，色相 ${hueOf(hexA).toFixed(0)}°）與 ` +
          `${nameB}（${hexB}，色相 ${hueOf(hexB).toFixed(0)}°）只差 ${gap.toFixed(0)}°，` +
          "太接近，使用者分不出開錯程式",
      );
    }
});

test("側欄字級要嚴格遞減：分類標題 > 大分頁 > 小分頁", () => {
  /*
   * 使用者 2026-09-15（在交通服務水準上回報，三支同一套側欄，一起改）：
   *   「分類標題與它下方的大分頁文字大小不要相同，不然點了分類標題後，
   *     出現一個相同大小的文字，會誤以為是其他分類標題，文字大小請依此
   *     順序遞減，分類標題（最大）＞大分頁＞小分頁」。
   *
   * ⚠️ 這一條**取代**了舊的「側欄項目要 16px」。舊的那一條把大分頁釘在 16px，
   *   與分類標題同級——那正是使用者回報的問題本身，守著它等於守著那個錯。
   *
   * ⚠️ 驗的是**三層之間的關係**，不是三個寫死的數字：
   *   釘死數字的話，日後整體放大一級就會無謂地轉紅；
   *   而只驗「有沒有設 font-size」則完全擋不住「三層一樣大」。
   *
   * ⚠️ 選擇器要照抄 CSS 裡實際生效的那一條（含前面的 `.sidebar nav `）。
   *   具體度是這一段踩過的坑：`.nav-zone-toggle` (0,1,0) 會被
   *   `.sidebar nav button` (0,1,2) 壓過去，所以 CSS 裡寫的是
   *   `.sidebar nav .nav-zone-toggle` (0,2,2)。這裡比對的必須是那一條，
   *   否則量到的是一個根本沒生效的宣告——那是假綠。
   */
  const sizeOf = (selector, label) => {
    const hit = css.match(
      new RegExp(
        selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          "\\s*\\{[\\s\\S]*?font-size:\\s*(\\d+)px",
      ),
    );
    assert.ok(hit, `找不到 ${label}（${selector}）的 font-size`);
    return Number(hit[1]);
  };
  const zone = sizeOf(".sidebar nav .nav-zone-toggle", "分類標題");
  const page = sizeOf(".sidebar nav button", "大分頁");
  const sub = sizeOf(".sidebar nav .nav-section", "小分頁");
  assert.ok(
    zone > page,
    `分類標題 ${zone}px 沒有比大分頁 ${page}px 大——點開分類後會看到同樣大的字，分不出層級`,
  );
  assert.ok(
    page > sub,
    `大分頁 ${page}px 沒有比小分頁 ${sub}px 大`,
  );
  /*
   * ⚠️ 差 1px 在深色底上幾乎看不出來（2026-09-15 在全日交通量上實測過：
   *   使用者附圖說「感覺兩個文字一樣大」，當時差的其實是 0px，
   *   但即使差 1px 也一樣分不出）。所以要求每一階至少差 2px。
   */
  assert.ok(
    zone - page >= 2 && page - sub >= 2,
    `三層字級是 ${zone}／${page}／${sub}px，每一階至少要差 2px 才看得出來`,
  );
  /* 分區小標（.nav-group）不可以比大分頁小——它是標題不是項目。 */
  const group = sizeOf(".nav-group", "分區小標");
  assert.ok(
    group >= page,
    `分區小標是 ${group}px，比大分頁 ${page}px 還小`,
  );
});
