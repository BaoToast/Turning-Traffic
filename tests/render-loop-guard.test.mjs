/*
 * ══════════════════════════════════════════════════════════════════════
 *  掛了 exhaustive-deps 豁免的 effect，裡面一定要留著「值沒變就不 setState」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：「好的請幫我做路口轉向的 零警告」。
 *
 * 做法是把兩個**刻意不給相依陣列**的 effect 就地豁免掉，因為規則建議的
 * 修法（改成 `[]`）在這兩處是錯的——那等於只量一次，而這兩段存在的目的
 * 正是「每次 render 後都重新量一次畫面」。
 *
 * ── 但豁免不可以變成貼紙 ────────────────────────────────────────
 *
 * 規則真正擔心的事是成立的：一個沒有相依陣列、又在裡面 setState 的 effect
 * **會無限重繪**。這兩處之所以安全，唯一的理由是它們的 setState 裡寫了
 * 「算出來的結果和上一次一樣就回傳 previous」——React 看到同一個參考
 * 就不會再觸發 render。
 *
 * 也就是說：**豁免的正當性完全寄生在那一段比較上**。
 * 哪天有人把那段比較拿掉（或改寫成每次都回新物件），豁免還在、lint 還是綠的，
 * 而畫面會直接卡死在無限重繪——這一支測試就是為了讓那一刻變紅。
 *
 * ⚠️ 這支測試自己也可能變成恆真：如果哪天豁免被拿掉、或寫法改了而掃不到，
 *   它會「檢查了 0 個地方」然後全綠。所以下面第一條就是前置檢查：
 *   掃到的豁免數量必須 ≥ 2（目前就是這兩處），掃到 0 個直接失敗。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "app", "traffic-app.tsx"), "utf8");

const DIRECTIVE = "// eslint-disable-next-line react-hooks/exhaustive-deps";

/*
 * ⚠️ 同一個規則的豁免有**兩種**，不可以混為一談（第一版就混了，被自己的
 *   前置檢查抓到）：
 *     ①「有相依陣列，但陣列故意不完整」——`useEffect(fn, [a, b])`
 *       這一種本來就跑不出無限迴圈，跟下面要守的事無關，共 3 處。
 *     ②「完全沒有相依陣列」——`useEffect(fn)`
 *       這一種才是規則真正擔心的，也才是本支要釘住的，共 2 處。
 *   判別方式：把 effect 主體的大括號配對切出來之後，看緊接在後面的是
 *   `)`（沒有相依陣列）還是 `,`（後面還有一個陣列）。
 */
/** 取出每一處豁免後面那個 effect 的函式主體（以大括號配對切出來，不用行號算）。 */
function effectsAfterDirective(code) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = code.indexOf(DIRECTIVE, from);
    if (at === -1) break;
    from = at + DIRECTIVE.length;
    /*
     * ⚠️ 不可以用「往後抓固定幾行」來切——使用者的規矩：
     *   刪／取程式碼範圍不可以用行號算。改成從 useEffect 的第一個 {
     *   開始做大括號配對，配到 0 為止就是這個 effect 的完整主體。
     */
    const start = code.indexOf("useEffect(", from);
    if (start === -1) {
      out.push({ ok: false, why: "豁免後面找不到 useEffect(" });
      continue;
    }
    let i = code.indexOf("{", start);
    if (i === -1) {
      out.push({ ok: false, why: "找不到 effect 的主體" });
      continue;
    }
    let depth = 0;
    let end = -1;
    for (let j = i; j < code.length; j += 1) {
      if (code[j] === "{") depth += 1;
      else if (code[j] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) {
      out.push({ ok: false, why: "大括號沒有配對成功" });
      continue;
    }
    /* 主體結束之後的第一個非空白字元：`)` ＝沒有相依陣列，`,` ＝有。 */
    const after = code.slice(end + 1).match(/^\s*(.)/);
    out.push({
      ok: true,
      body: code.slice(i, end + 1),
      at,
      noDeps: after ? after[1] === ")" : false,
    });
  }
  return out;
}

const all = effectsAfterDirective(source);
const effects = all.filter((item) => item.ok && item.noDeps);

test("前置：真的掃到「完全沒有相依陣列」的豁免（掃到 0 個就等於整支恆真）", () => {
  assert.ok(
    all.length > 0,
    "整份檔案掃不到任何 exhaustive-deps 豁免，這支測試已經不守任何東西。",
  );
  assert.ok(
    effects.length >= 2,
    `掃到 ${all.length} 處豁免，其中「沒有相依陣列」的只有 ${effects.length} 處。` +
      `本來應該有 2 處（量側欄區塊、量轉向圖寬度）。` +
      `被拿掉了、或寫法變了掃不到；不管是哪一種，都必須先修好這支測試。`,
  );
});

test("每一處「沒有相依陣列」的豁免，effect 裡都要有 setState，否則根本不需要豁免", () => {
  for (const item of effects) {
    assert.match(
      item.body,
      /\bset[A-Z]\w*\(/,
      "這個 effect 裡沒有 setState——那它為什麼需要豁免？" +
        "要嘛豁免是多餘的，要嘛它掛錯地方了。",
    );
  }
});

test("每一處「沒有相依陣列」的豁免，setState 裡都要留著「值沒變就回傳 previous」", () => {
  for (const item of effects) {
    /*
     * 兩處目前的寫法：
     *   setPresentAnchors(function (previous) {
     *     return previous.join("|") === found.join("|") ? previous : found;
     *   });
     *   setDiagramOverflow(function (previous) {
     *     return previous === cut ? previous : cut;
     *   });
     * 共同點是：拿 previous 比對，相等時**把 previous 原封不動回傳**。
     * 只驗這個共同點，不驗兩者各自的比對方式（比對方式本來就該能改）。
     */
    /*
     * ⚠️ 要驗的是**每一個** setState，不是「至少有一個」。
     *   第一版寫成「body 裡找得到一個 previous 寫法就算過」，反面測試
     *   （把其中一個 setState 改成直接寫值）**照樣全綠**——因為同一個
     *   effect 裡還有另一個仍然守規矩的 setState 頂著。
     *   那等於這支測試守不到「有人只改壞其中一條路徑」的情況，
     *   而那正是最可能發生的情況（這個 effect 就有兩條路徑：
     *   量不到元素時歸零、量得到時寫實際值）。
     */
    const calls = [...item.body.matchAll(/\bset[A-Z]\w*\(/g)];
    assert.ok(
      calls.length > 0,
      "這個 effect 裡沒有 setState（前一條應該已經擋下來了）。",
    );
    for (const call of calls) {
      const tail = item.body.slice(call.index);
      const name = call[0].slice(0, -1);
      assert.match(
        tail,
        /^set[A-Z]\w*\(\s*function\s*\(\s*previous\s*\)\s*\{[\s\S]{0,200}?return\s+previous[\s\S]{0,120}?\?\s*previous\s*:/,
        `${name}() 沒有寫成「拿 previous 比對、一樣就原封不動回傳 previous」。\n` +
          "少了它，這個沒有相依陣列的 effect 每次 render 都會寫入一個新值，" +
          "React 又因此再 render 一次——畫面會卡死在無限重繪，" +
          "而 lint 因為有豁免仍然是綠的。",
      );
    }
  }
});

test("豁免用 eslint-disable-next-line 的單行寫法（本支實測不會被誤報）", () => {
  /*
   * ⚠️ 這一條的來歷要講清楚，因為我一開始判斷錯了。
   *
   *   2026-09-14 在姊妹專案「全日交通量」遇到：一個**必要**的
   *   eslint-disable 被 ESLint 誤報成「Unused directive」，而 lint 是零警告，
   *   整包因此變紅。我當時的結論是「因為指令後面加了 `-- 理由` 尾巴」，
   *   並把這一條寫成「不准加尾巴」。
   *
   *   **那個結論是錯的。** 後來把尾巴拿掉，誤報照樣出現；真正的差別是
   *   **lint 的範圍**——單獨 lint 一個檔案不會報，lint 整個目錄才會報，
   *   與有沒有尾巴無關。（那一支最後是改寫程式、讓規則根本不觸發來解決的。）
   *
   *   本支這兩處用的是 `eslint-disable-next-line` 的單行寫法，
   *   實測在整包 lint 下不會被誤報。所以這一條改成釘住**寫法**：
   *   維持單行寫法，不要改回 `eslint-disable` / `eslint-enable` 的區塊寫法
   *   （那才是會踩到誤報的那一種）。
   */
  const block = source.match(/\/\*\s*eslint-disable\s+react-hooks\/exhaustive-deps/);
  assert.equal(
    block,
    null,
    "有人把豁免改成 `/* eslint-disable ... */` 的區塊寫法。" +
      "區塊寫法在整包 lint 下可能被誤報成 Unused directive，而 lint 是零警告，" +
      "整包會紅。請維持 `// eslint-disable-next-line` 的單行寫法。",
  );
});

test("lint 一定要維持零警告（--max-warnings=0 不可以被拿掉）", () => {
  /*
   * ⚠️ 使用者指名要「零警告」。如果哪天有人把這個旗標拿掉，
   *   上面所有的努力都會安靜地失效：警告照樣出現，只是沒有人會被擋下來。
   *   另外兩支程式本來就有這個旗標，三支一致。
   */
  const pkg = JSON.parse(
    readFileSync(join(here, "..", "package.json"), "utf8"),
  );
  assert.match(
    pkg.scripts.lint,
    /--max-warnings=0/,
    "package.json 的 lint 指令少了 --max-warnings=0，" +
      "警告不會再擋下任何人（使用者 2026-09-14 指名要零警告）。",
  );
});
