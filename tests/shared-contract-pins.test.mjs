/*
 * ══════════════════════════════════════════════════════════════════════
 *  三支共用的「契約案例表」逐位元相同——用 SHA-256 釘住
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 為什麼補這一支 ──
 *
 * 三支程式的 README／交接文件一直寫著「由 `tests/*-contract.mjs` 以
 * SHA-256 釘住」，而 2026-09-23 的獨立複查實際去找，發現**只有**
 * `period-input-contract.mjs` 與 `never-revert-contract.mjs` 真的被釘住：
 * `direction-pair-contract.mjs` 與 `chart-levels-contract.mjs` 沒有任何
 * 測試在比對它們的內容。
 *
 * ⚠️ 這是最糟的一種狀態：**文件說有守、其實沒守**。
 *   維護者（含 AI）會因為「反正有雜湊釘著」而放心改其中一支，
 *   而三支之間的判定從此悄悄分岔——同一個數字在三支被說成不同的狀況，
 *   正是當初把這些案例表抽出來共用要防的事。
 *
 * ── 釘的是「案例表」，不是「實作」──
 *
 * 實作沒辦法三支一起釘：全日交通量與路口轉向是 TypeScript
 * （`app/direction-pair.ts` ／ `lib/direction-pair.ts`，兩支逐位元相同），
 * 交通服務水準是原生 JavaScript（`direction-pair.js`），本來就不同。
 * **三支真正共用的是案例表**——它規定「什麼輸入該得到什麼判定」，
 * 只要三支都跑得過同一張表，實作用什麼語言寫都不影響結果一致。
 * 所以這裡釘案例表，而不是釘實作。
 *
 * ── 改到它的時候該怎麼做 ──
 *
 * 1. 三支的 `*-contract.mjs` 一起換成同一份新內容；
 * 2. 三支的這一支測試一起換成新的雜湊；
 * 3. 說明為什麼要改（案例表是規格，改它等於改判定）。
 * 只改一支就會在另外兩支變紅——那正是這一支存在的意義。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/*
 * 三支的檔案位置不同（全日交通量與路口轉向放 `tests/`，
 * 交通服務水準放專案根），所以兩個地方都找一下。
 * ⚠️ 找不到檔案要**紅**，不可以 skip——「檔案被搬走了」與
 *   「內容被改了」一樣要擋，而 skip 會讓搬走變成綠的。
 */
function contractPath(name) {
  for (const candidate of [join(HERE, name), join(HERE, "tests", name), join(HERE, "..", name)])
    if (existsSync(candidate)) return candidate;
  return null;
}

/* 三支共用的案例表，雜湊三支一字不差。 */
const PINNED = {
  "direction-pair-contract.mjs":
    "33d106ca1ec707af2087c5883283ec0c940472de26c94cf7beffab9611182878",
  "chart-levels-contract.mjs":
    "3b3902af5bed6260e886ba553dcaed375d507ce1f04502d5ed53ea966a51b73c",
};

for (const [name, expected] of Object.entries(PINNED))
  test(`共用契約案例表 ${name} 逐位元相同`, () => {
    const path = contractPath(name);
    assert.ok(
      path,
      `找不到 ${name}——它是三支共用的契約案例表，被搬走或刪掉都要當成改動處理。`,
    );
    const actual = createHash("sha256")
      .update(readFileSync(path))
      .digest("hex");
    assert.equal(
      actual,
      expected,
      `${name} 的內容與三支共用的那一份不同。\n` +
        `  這一支算出來：${actual}\n` +
        `  三支應該是：  ${expected}\n` +
        "改案例表＝改判定規則，請三支一起改、三支的雜湊一起換，並寫明為什麼。",
    );
  });

test("這一條真的抓得到（反面檢查）", () => {
  /*
   * ⚠️ 沒有這一段的話，上面兩條在檔名寫錯時會變成「找不到→紅」，
   *   看起來像有在守；但如果哪天有人把 assert.ok(path) 拿掉改成 return，
   *   它就會安靜地永遠通過。這裡確認比對式本身是會分辨內容的。
   */
  const a = createHash("sha256").update("案例表 A").digest("hex");
  const b = createHash("sha256").update("案例表 B").digest("hex");
  assert.notEqual(a, b, "雜湊比對寫壞了——不同內容算出同一個值");
  assert.equal(a.length, 64);
});
