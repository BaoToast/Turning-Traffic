/**
 * ══════════════════════════════════════════════════════════════════════
 *  「已人工確認」（使用者 2026-09-17 指名這個名稱）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 守這個功能最容易做錯的三件事（三支同一套）：
 *   ① 指紋不含那一筆的內容 → 確認過「尖峰時段 07:00-08:00」之後，
 *      下一季換成別的時段也被同一把鑰匙消音。
 *   ② 「重新匯入」類也給按 → 等於提供一個把資料錯誤藏起來的開關。
 *   ③ 確認之後把總數直接變小 → 看不出還有幾筆、已處理幾筆。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../app/traffic-app.tsx", import.meta.url),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("① 指紋一定要包含那一筆的訊息文字", () => {
  assert.match(
    source,
    /JSON\.stringify\(\[issue\.id, issue\.message\]\)/,
    "指紋沒有帶訊息文字——確認過一次就永遠消音了",
  );
});

test("② 只有「人工確認」類可以按確認", () => {
  assert.match(source, /issue\.resolution\?\.kind === "人工確認"/);
  assert.match(source, /\{issueCanAck\(issue\) && \(/);
  assert.match(source, /data-testid="issue-ack"/);
});

test("③ 確認之後兩個數字都要寫出來，不是把總數變小", () => {
  assert.match(
    source,
    /項需要注意、\$\{ackedCount\} 項已確認。/,
  );
});

test("已確認的要存檔，重新整理不可以復活", () => {
  assert.match(source, /ackedIssues: ackedIssues,/, "存檔時沒有寫出去");
  assert.match(source, /data\.ackedIssues && typeof data\.ackedIssues === "object"/);
});

test("⚠️ 那顆鈕的名字就是「已人工確認」（使用者 2026-09-17 指名）", () => {
  /*
   * 使用者原話：「按鈕名稱不要這麼長，改為『已人工確認』，系統就主動不再提醒」。
   * 守的是**名字**——改回長版本的話，按鈕文字在窄欄位會撐破邊界，
   * 那正是使用者點名要避免的三個雷之一。
   */
  assert.match(source, /"已人工確認"/, "那顆鈕的名字要是「已人工確認」");
  assert.ok(
    !/已確認，不再提醒/.test(source),
    "舊的長名字還留著——那一串在窄欄位會撐破按鈕",
  );
  assert.match(source, /"取消確認"/, "取消那一顆要維持自己的名字");
});
