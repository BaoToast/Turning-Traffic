/*
 * ══════════════════════════════════════════════════════════════════════
 *  按過「已人工確認」之後，全畫面要同步（A10）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-21 回報：
 *   「但左側欄位的資料維護 2，沒有恢復正常……是我沒確認成功還是 bug 呢?」
 *
 * 當時同一份資料在畫面上有五個數字，只有一個扣掉了已確認：
 *   ① 側欄「資料維護」旁的紅字      ← 沒扣
 *   ② 本季檢核摘要的品質分數        ← 沒扣
 *   ③ 摘要「待人工確認」            ← 沒扣
 *   ④ 摘要「需處理錯誤」            ← 沒扣
 *   ⑤ 檢查結果的狀態列              ← 只有這個對
 *
 * ⚠️ 這支測試守的是**規則**，不是那五個位置：
 *   凡是回答「還有幾件事等著我處理」的地方，一律讀 openIssues。
 *   新增第六個顯示時忘記改，這裡會紅。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../app/traffic-app.tsx", import.meta.url),
  "utf8",
);

test("openIssues 是「未確認清單」的唯一來源，而且沒有把已確認的刪掉", () => {
  assert.match(
    source,
    /const openIssues = currentIssues\.filter\(function \(issue\) \{\s*return !issueAcked\(issue\);/,
    "未確認清單不見了，或改成從別的地方算",
  );
  /* currentIssues 仍然是完整的一份——使用者要能把已確認的叫回來、取消確認。 */
  assert.match(source, /const currentIssues = issues;/);
  assert.match(
    source,
    /showAckedIssues/,
    "「顯示已確認」的開關不見了：已確認的被整個藏掉，使用者按完就再也找不到",
  );
});

test("側欄「資料維護」的紅字讀未確認清單", () => {
  assert.match(
    source,
    /item\.id === "maintenance" && openIssues\.length > 0 && \(\s*<b>\{openIssues\.length\}<\/b>/,
    "側欄紅字又讀回含已確認的 currentIssues——使用者按完確認它不會變",
  );
});

test("本季檢核摘要的三個數字都讀未確認清單", () => {
  const start = source.indexOf("<h2>本季檢核摘要</h2>");
  assert.notEqual(start, -1, "找不到本季檢核摘要");
  const block = source.slice(start, start + 3000);
  assert.match(block, /100 - openIssues\.length \* 4/);
  assert.match(block, /openIssues\.filter\(function \(i\) \{\s*return i\.severity === "warning";/);
  assert.match(block, /openIssues\.filter\(function \(i\) \{\s*return i\.severity === "error";/);
  assert.doesNotMatch(
    block,
    /currentIssues/,
    "摘要卡裡還有地方讀含已確認的清單",
  );
  assert.match(
    block,
    /已人工確認/,
    "已確認的不計入三行之後，必須另外寫出來——否則看起來像資料憑空消失",
  );
});

test("寫出總筆數的地方一定同時寫出已確認幾筆", () => {
  /*
   * 「共 N 項」本身是對的（清單真的有 N 列），但只寫它就等於沒有回答
   * 「我按過的確認到底有沒有生效」。
   */
  const marker = "<h2>檢查結果（全部季度）</h2>";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "找不到檢查結果的標題");
  const block = source.slice(start, start + 1200);
  assert.match(block, /共 \$\{currentIssues\.length\} 項/);
  assert.match(block, /其中 \$\{ackedCount\} 項已確認/);
});
