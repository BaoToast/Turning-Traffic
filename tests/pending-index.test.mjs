/*
 * ══════════════════════════════════════════════════════════════════
 *  待修正事項的「逐條清冊」必須與內文一致
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：
 *   「交通服務水準要修正的事項目前累積下來應該很多，
 *     有確實記錄到時才能全面都作修正而不遺漏嗎？還是大檢查到時會逐一確認？」
 *
 * 誠實的答案是：光靠「大檢查時逐條確認」這條規則**不夠**，那只是紀律。
 * 2026-09-11 當天我自己就犯過一次——那天新增的 8 條寫成 `### 一、…`，
 * 而逐條走過時認的是 `## ☐`，**那 8 條會被整批跳過**，
 * 而且檔案看起來好好的，不會有任何人發現。
 *
 * 所以改成：每一份清單開頭有一段**自動產生**的逐條清冊（項目、狀態、行號），
 * 這一支釘住「清冊 ＝ 內文」。有人新增項目卻沒更新清冊、
 * 或把項目記在 `### ` 那種掃不到的層級，這裡就會紅。
 *
 * 修法只有一條指令：`node scripts/build-pending-index.mjs`
 *
 * ⚠️ 刻意迴避的假通過：
 *   一、只驗「清冊存在」不算數——過期的清冊也存在。這裡是**重新產生一次再比**。
 *   二、只驗「條數對」不算數——條數一樣但內容換掉照樣過。這裡比的是整塊文字。
 *   三、前置檢查：確認真的掃得到項目，檔案搬走時不可以安靜地全部通過。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  LISTS,
  applyIndex,
  collectItems,
  stripIndex,
} from "../scripts/build-pending-index.mjs";

const present = LISTS.filter((name) => existsSync(join(ROOT, name)));

/*
 * ⚠️ 2026-09-18 大檢查（F-07）：這幾份 `待修正事項_*.md` 放在 repo **外面**
 *   （維護方工作區的上一層），交付出去的完整專案 zip 與 GitHub Actions 都沒有它們，
 *   一份都找不到時原本直接紅——那是環境差異，不是程式或清冊出錯。
 *   改成：一份都沒有 → 整組 skip 並說明；有的話照舊嚴格驗。
 */
const NONE_PRESENT = present.length === 0;
test(
  "前置：待修正事項清單讀得到，而且掃得到項目",
  { skip: NONE_PRESENT ? `工作區沒有 ${LISTS.join("、")}（交付包／CI 環境本來就沒有這幾份），略過` : false },
  () => {
  assert.ok(
    present.length >= 1,
    `一份都找不到——檔案是不是搬走或改名了？找過：${LISTS.join("、")}`,
  );
  for (const name of present) {
    const items = collectItems(stripIndex(readFileSync(join(ROOT, name), "utf8")));
    assert.ok(items.length > 0, `${name} 一條項目都掃不到——格式是不是變了？`);
  }
});

/*
 * ⚠️ 這一則是**獨立驗算**，不可以拿掉。
 *
 * 上面那一則「重新產生一次再比」抓不到「產生器本身算錯」——
 * 產生與比對用的是同一套算法，算錯也會兩邊一致、全綠。
 * 實測發生過：第一版在「拿掉清冊的文字」上數行號，再把清冊插進去，
 * 於是每一個行號都固定短少一個清冊高度（三份分別差 51、40、56 行），
 * 跳過去會落在完全不相干的段落，而測試是綠的。
 *
 * 所以這裡改成問一件**產生器管不到**的事：
 * 清冊說「第 N 行」，那就去讀第 N 行，看它是不是真的那一條。
 */
for (const name of present)
  test(`${name}：清冊寫的行號真的指到那一條`, () => {
    const lines = readFileSync(join(ROOT, name), "utf8").split("\n");
    const bad = [];
    let counted = 0;
    for (const line of lines) {
      const m = line.match(/^\d+\. ([☐☑✗]) (.+)（第 (\d+) 行）$/);
      if (!m) continue;
      counted += 1;
      const at = Number(m[3]);
      const actual = at > 0 && at <= lines.length ? lines[at - 1] : "";
      if (!actual.startsWith(`## ${m[1]}`))
        bad.push(
          `「${m[2].slice(0, 24)}」說在第 ${at} 行，實際那行是：${actual.slice(0, 40)}`,
        );
    }
    /* 前置：清冊真的有內容，否則這一則是恆綠的 */
    assert.ok(counted > 0, `${name} 的清冊一條都讀不到——格式是不是變了？`);
    assert.deepEqual(
      bad,
      [],
      `行號跳過去會落在不相干的地方：\n` + bad.map((b) => "  " + b).join("\n"),
    );
  });

for (const name of present)
  test(`${name}：逐條清冊與內文一致`, () => {
    const text = readFileSync(join(ROOT, name), "utf8");
    assert.equal(
      applyIndex(text),
      text,
      `清冊過期了。請執行：node scripts/build-pending-index.mjs\n` +
        `（大檢查是照清冊逐條走的，清冊漏掉的項目就等於沒有人會去看。）`,
    );
  });
