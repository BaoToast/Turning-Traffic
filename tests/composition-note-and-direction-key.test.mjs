/*
 * ══════════════════════════════════════════════════════════════════════
 *  兩件 2026-09-29 的修正
 * ══════════════════════════════════════════════════════════════════════
 *
 * ① 「各路口車種組成」不適用並列時，說明文字把這一頁描述成一種**環狀圖形**，
 *    而這一頁從來沒有那種圖形——它是一組數字卡（`.kpi-grid.composition-kpis`）
 *    加上「全調查時段道路方向車種數量」那張表。
 *    使用者 2026-09-29 指名要改。拿一個不存在的圖形去解釋為什麼不能並列，
 *    使用者照著描述在畫面上找不到那個東西，只會懷疑自己看錯頁。
 *    ⚠️ **擋下並列這個行為沒有改**，改的只有解釋——下面第 ①-2 條就是守這件事。
 *
 * ② `directionTextKey()`：方向顯示名稱的比對鍵（三支共用的
 *    direction-pair 新增的一支）。姊妹系統交通服務水準的
 *    「方向對應不一致」檢查原本拿原始字串比對，於是「北上」「北 上」
 *    「北－上」被算成三種寫法而報出假的異常。判準搬到共用檔，三支同一套。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { directionTextKey, bearingOf } from "../lib/direction-pair.ts";

const app = readFileSync(new URL("../app/traffic-app.tsx", import.meta.url), "utf8");

/* ────────────────────────────────────────────────────────────────────
 *  ① 車種組成頁的不適用說明
 * ──────────────────────────────────────────────────────────────────── */

/** 把「車種組成頁在並列時的不適用說明」那一段抓出來。 */
function compositionAmpmNote() {
  const at = app.indexOf('show={compositionFilters.peak === "AMPM"}');
  assert.ok(at > 0, "找不到車種組成頁的並列不適用說明——它是不是被整段刪掉了？");
  const end = app.indexOf("/>", at);
  assert.ok(end > at, "那一段的 JSX 沒有收尾");
  return app.slice(at, end);
}

test("①-1 說明文字不可以再描述成環狀圖形（這一頁沒有那種圖形）", () => {
  const note = compositionAmpmNote();
  for (const word of ["圓環", "圓餅", "環圈"])
    assert.ok(
      !note.includes(word),
      `說明裡還寫著「${word}」，而這一頁是數字卡加一張表：\n${note}`,
    );
});

test("①-2 但那一句**必須還在**，而且要說出真正的理由", () => {
  /*
   * ⚠️ 這一條是上一條的反面。只驗「不可以出現圓環」的話，
   *   把整段 InapplicableNote 刪掉也會綠——而那正是最糟的結果：
   *   選了並列之後畫面只顯示上午，一句話都不說。
   */
  const note = compositionAmpmNote();
  assert.ok(
    note.includes("inapplicableNote("),
    `那一句被拆掉了：\n${note}`,
  );
  assert.ok(
    /一次只讀得出一個時段/.test(note),
    `說明要寫出「一次只讀得出一個時段」這個事實：\n${note}`,
  );
  assert.ok(
    /百分比不能跨時段相加/.test(note),
    `說明要寫出真正的理由（百分比不能跨時段相加）：\n${note}`,
  );
  assert.ok(
    note.includes('"上午尖峰"'),
    `要告訴使用者實際顯示的是哪一個時段：\n${note}`,
  );
});

test("①-3 前置：被擋下來的行為真的還在（並列會退回上午）", () => {
  /*
   * 說明文字對不對，前提是「並列真的顯示不出來」。
   * 這裡釘住 compositionScope 的那一段推導——它變了，說明就跟著錯。
   */
  const at = app.indexOf("const compositionScope: CompositionScope =");
  assert.ok(at > 0, "找不到 compositionScope 的推導");
  const block = app.slice(at, at + 260);
  assert.ok(
    /compositionFilters\.peak === "AMPM"\s*\?\s*"AM"/.test(block),
    `並列不再退回上午的話，這一句說明就得重寫：\n${block}`,
  );
});

test("①-4 更正註記要留下來（歷史段落加向前指標，不是改掉）", () => {
  const at = app.indexOf('show={compositionFilters.peak === "AMPM"}');
  const before = app.slice(Math.max(0, at - 1600), at);
  assert.ok(
    /2026-09-29 更正說明文字/.test(before),
    "更正註記不見了——不留向前指標的話，下一個人會以為這裡從來沒錯過",
  );
  /*
   * ⚠️ 更正註記一律**轉述**，不可以原句引用那句錯的話。
   *   原句留在檔案裡，搜尋與複製都還找得到它，等於錯的說法沒有真的退場。
   */
  assert.ok(
    !/圓環/.test(before),
    "更正註記原句引用了那句錯的話——一律轉述",
  );
});

/* ────────────────────────────────────────────────────────────────────
 *  ② directionTextKey()
 * ──────────────────────────────────────────────────────────────────── */

test("②-1 吸收排版雜訊：空白、全半形、破折號、頓號、斜線", () => {
  const same = [
    ["北上", "北 上"],
    ["北上", "北－上"],
    ["北上", "北-上"],
    ["北上", "北　上"],
    ["往台北", "往　台北"],
    ["甲街／乙街", "甲街/乙街"],
    ["A線", "A 線"],
  ];
  for (const [a, b] of same)
    assert.equal(
      directionTextKey(a),
      directionTextKey(b),
      `「${a}」與「${b}」只差排版雜訊，比對鍵應該相同`,
    );
});

test("②-2 不吸收內容：方位與大小寫都要分得出來", () => {
  const different = [
    ["北上", "南下"],
    ["往台北", "往竹科"],
    ["A線", "a線"],
    ["北上", "北下"],
  ];
  for (const [a, b] of different)
    assert.notEqual(
      directionTextKey(a),
      directionTextKey(b),
      `「${a}」與「${b}」是真的不同（使用者 2026-09-11 裁示：` +
        "空格與全半形是排版雜訊，大小寫是內容)",
    );
});

test("②-3 空值與非字串不可以炸", () => {
  for (const input of [null, undefined, "", "   ", 0, {}])
    assert.equal(typeof directionTextKey(input), "string", String(input));
  assert.equal(directionTextKey(null), "");
  assert.equal(directionTextKey("  　 "), "");
});

test("②-4 bearingOf 走的就是這一支（不可以各自正規化一次）", () => {
  /*
   * ⚠️ 兩支各留一份「看起來很像」的正規化，就是漂移的起點。
   *   這裡驗的是行為等價：bearingOf 對「北 上」與「北上」必須同結論，
   *   而那只有在它真的走 directionTextKey 時才成立。
   */
  assert.equal(bearingOf("北 上"), "北");
  assert.equal(bearingOf("北－上"), "北");
  assert.equal(bearingOf("北上"), bearingOf("北 上"));
  /* 防誤報那三條不可以被放寬。 */
  assert.equal(bearingOf("往台北"), null);
  assert.equal(bearingOf("北屯路"), null);
  assert.equal(bearingOf("南投端"), null);
  /* 原始碼層面也釘一下，避免日後有人把那一行複製回去。 */
  const source = readFileSync(
    new URL("../lib/direction-pair.ts", import.meta.url),
    "utf8",
  );
  const body = source.slice(source.indexOf("export function bearingOf"));
  assert.ok(
    /const text = directionTextKey\(name\);/.test(body.slice(0, 300)),
    "bearingOf 沒有走 directionTextKey，兩邊的雜訊集合會各自漂移",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  ③ 「刪除單一季度」的說明不可以說謊（2026-09-29）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者要我確認「另外兩支的定稿鎖有沒有異常」時查到的。
 * 那一段原本寫「已定稿的季度**會被擋下來**，請先到本頁下方把狀態改回**草稿**」，
 * 兩句都不成立：
 *   ① 這一支的鎖不是擋死。deleteQuarter() 走 authorizeLockedChange()，
 *     那是一個確認框，按確定就**連帶解除鎖定**並刪除。
 *   ② 這一支的審核狀態沒有「草稿」這個值，那句指路指向一個不存在的選項。
 *
 * ⚠️ 只改說明，行為沒有動——軟鎖是刻意的設計。所以下面同時驗
 *   「說明改對了」與「行為還在」，少任何一邊都是半個守門。
 */

/** 把「刪除單一季度」那一區的說明文字抓出來。 */
function deleteQuarterNote() {
  const at = app.indexOf('id="maintenance-delete-quarter"');
  assert.ok(at > 0, "找不到「刪除單一季度」那一區");
  const from = app.indexOf("<small>", at);
  const to = app.indexOf("</small>", from);
  assert.ok(from > at && to > from, "那一區的說明文字不見了");
  return app.slice(from, to);
}

test("③-1 不可以再寫「會被擋下來」，也不可以叫人改成一個不存在的狀態", () => {
  const note = deleteQuarterNote();
  assert.ok(
    !/會被擋下來/.test(note),
    `這一支是確認框不是擋死，說明不可以寫「會被擋下來」：\n${note}`,
  );
  assert.ok(
    !/草稿/.test(note),
    `這一支的審核狀態沒有「草稿」，指路不可以指向不存在的選項：\n${note}`,
  );
});

test("③-2 但要寫出真正會發生的事（確認＋一併解除鎖定）", () => {
  const note = deleteQuarterNote();
  assert.ok(
    /已鎖定成果/.test(note),
    `說明要用這一支自己的詞「已鎖定成果」：\n${note}`,
  );
  assert.ok(
    /先跳出確認/.test(note) && /解除/.test(note),
    `說明要寫出「會先跳出確認、並一併解除鎖定」：\n${note}`,
  );
});

test("③-3 前置：行為真的還是「確認＋解除」，不是擋死", () => {
  /*
   * ⚠️ 這一條是上面兩條的前提。哪天有人把它改成擋死（與姊妹系統對齊），
   *   說明就得跟著改——那時這一條會紅，正好提醒他。
   */
  const at = app.indexOf("function deleteQuarter(");
  assert.ok(at > 0, "找不到 deleteQuarter()");
  const body = app.slice(at, at + 400);
  assert.ok(
    /authorizeLockedChange\(targets, "刪除季度"\)/.test(body),
    `deleteQuarter 不再走 authorizeLockedChange 的話，說明要一起改：\n${body.slice(0, 300)}`,
  );
  const gate = app.indexOf("function authorizeLockedChange(");
  assert.ok(gate > 0, "找不到 authorizeLockedChange()");
  const gateBody = app.slice(gate, gate + 700);
  assert.ok(
    /return confirm\(/.test(gateBody),
    `authorizeLockedChange 改成擋死了，說明要一起改：\n${gateBody.slice(0, 300)}`,
  );
  assert.ok(
    /是否解除相關成果鎖定並繼續/.test(gateBody),
    "確認框的訊息變了，說明要一起檢查",
  );
});

test("③-4 更正註記留在原處（向前指標，不是改掉）", () => {
  const at = app.indexOf('id="maintenance-delete-quarter"');
  const after = app.slice(at, at + 2400);
  assert.ok(
    /2026-09-29 更正這一段說明/.test(after),
    "更正註記不見了——不留向前指標的話，下一個人會以為這裡從來沒錯過",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  ④ 交付包不可以夾帶探針產生的截圖（2026-09-29）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-29 打包前掃到：`scripts/manual/` 底下有 **6 個 .png**
 * （`od-inbound.png`、`peaks-date.png`、`unstyled-*.png` 四個），
 * 而它們全部是 `scripts/manual/probe-*.mjs` **寫出來的截圖**——
 * 沒有任何程式、測試或文件讀它們。手冊也沒有引用（實測 0 命中）。
 *
 * ⚠️ 這與姊妹系統全日交通量 2026-09-28 的
 *   `scripts/manual/point-labels-few.png` 是**同一件事**：
 *   我那一次交了一個 e2e 截圖出去，GPT 把它刪掉是對的。
 *   一次是意外，兩次就該有守門。
 *
 * ⚠️ 擋的是「**交付包裡**有這種檔」，不是「探針不可以產生截圖」。
 *   探針照樣會在本機寫出 .png（那是它證明事情的方式），
 *   只是那些檔案不該跟著交付包走。
 */
test("④ scripts/ 底下不可以有 .png（探針輸出，不是交付內容）", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join } = await import("node:path");
  const root = fileURLToPath(new URL("../scripts", import.meta.url));
  const found = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (/\.png$/i.test(name)) found.push(`${prefix}${name}`);
    }
  };
  walk(root, "scripts/");
  assert.deepEqual(
    found,
    [],
    "交付包裡夾帶了探針產生的截圖：\n- " +
      found.join("\n- ") +
      "\n這些是 probe-*.mjs 寫出來的，沒有任何程式讀它們。打包前要清掉。",
  );
});
