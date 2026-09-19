/*
 * ══════════════════════════════════════════════════════════════════════
 *  側欄宣告的每一個小分頁錨點，畫面上都要真的有那個 id
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-15 大檢查查到：側欄的「季度批次匯入」底下宣告了
 *   { label: "本次匯入的尖峰時段", anchor: "import-peak-range" }
 * 而 `import-peak-range` 這個 id **全專案不存在**（實際的區塊是 `import-peak-rule`）。
 *
 * ── 為什麼沒有人發現 ────────────────────────────────────────────
 *
 * 因為畫面上有一道保險：小分頁在 render 前會先過
 * `presentAnchors.includes(section.anchor)`，找不到對應區塊的就**不列**。
 * 所以使用者看到的不是一顆壞掉的按鈕，而是**那一項從來沒出現過**。
 *
 * ⚠️ 那道保險是對的，但它讓這種錯誤變成**完全無聲**：
 *   宣告留在原始碼裡，沒有任何人會發現它已經指不到東西了。
 *   下一個人看到那一行，會以為那個小分頁「應該要有」，
 *   然後花時間去查「為什麼它沒出現」——而答案是它根本指錯了。
 *
 * ⚠️ 既有的守門都抓不到這一種：
 *   ・e2e-nav-coverage 檢查的是「畫面上有區塊卻沒列成小分頁」（少列）
 *   ・e2e-nav-target 檢查的是「列出來的點得到」——但它已經被過濾掉了，
 *     根本不在「列出來的」裡面
 *   兩支都是從**畫面**看過去的，而這個錯只存在於**宣告**裡。
 *   所以這一支反過來，從宣告看過去。
 *
 * ── 為什麼用掃原始碼而不是跑瀏覽器 ──────────────────────────────
 *
 * 要驗的正是「宣告了但畫面上永遠不會有」。跑瀏覽器只看得到有畫出來的東西，
 * 天生就看不到這一類錯誤——那就是它活下來的原因。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/*
 * ⚠️ 一定要掃 app 底下**每一個** .tsx，不能只掃 traffic-app.tsx。
 *   區塊會被拆到別的元件檔（例如 advanced-peak-quarter／advanced-peak-window
 *   住在 peak-shape-charts.tsx），只掃一個檔會把它們誤判成「不存在」——
 *   那是假紅，而假紅一樣會讓這支測試被關掉。
 */
const appDir = join(here, "..", "app");
const source = readdirSync(appDir)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(appDir, name), "utf8"))
  .join("\n");

/** 去掉註解——註解裡提到舊錨點（說明它為什麼被移除）是正常的。 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

test("側欄宣告的每一個 anchor，畫面上都要有同名的 id", () => {
  const anchors = [
    ...new Set(
      [...code.matchAll(/\banchor:\s*"([^"]+)"/g)].map((m) => m[1]),
    ),
  ];
  /*
   * 前置：真的抓得到一批錨點。抓到 0 個的話這條測試是恆真的——
   * 那比沒有測試更糟，因為它看起來是綠的。
   */
  assert.ok(
    anchors.length >= 10,
    `只抓到 ${anchors.length} 個 anchor 宣告，掃描方式可能壞了`,
  );
  const ids = new Set(
    [...code.matchAll(/\bid=(?:"([^"]+)"|\{"([^"]+)"\})/g)].map(
      (m) => m[1] ?? m[2],
    ),
  );
  /*
   * ⚠️ 有些 id 是用樣板字串組出來的（例如 id={`arm-${code}`}），
   *   那種抓不到也不該抓——側欄的錨點一律是寫死的字串。
   */
  const dead = anchors.filter((a) => !ids.has(a));
  assert.deepEqual(
    dead,
    [],
    "側欄宣告了這些錨點，但畫面上沒有同名的 id——" +
      "它們會被 presentAnchors 靜靜過濾掉，永遠不會出現在側欄，" +
      "而原始碼看起來像是「應該要有」：" +
      dead.join("、"),
  );
});

test("前置：這條掃描抓得到「指到不存在的 id」（不然它是恆真的）", () => {
  /*
   * 反面測試：在原始碼的副本裡塞一條指向不存在 id 的宣告，
   * 上面那條掃描必須抓得到。
   */
  const broken = code + '\n{ label: "假的", anchor: "this-id-does-not-exist" },\n';
  const anchors = [
    ...new Set([...broken.matchAll(/\banchor:\s*"([^"]+)"/g)].map((m) => m[1])),
  ];
  const ids = new Set(
    [...broken.matchAll(/\bid=(?:"([^"]+)"|\{"([^"]+)"\})/g)].map(
      (m) => m[1] ?? m[2],
    ),
  );
  assert.deepEqual(
    anchors.filter((a) => !ids.has(a)),
    ["this-id-does-not-exist"],
    "掃描方式抓不到刻意塞進去的壞錨點——那表示上面那一條是恆真的",
  );
});
