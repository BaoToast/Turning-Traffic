/*
 * ══════════════════════════════════════════════════════════════════
 *  待修正事項清單**不在這個 repository 裡**（A7，2026-09-21 使用者定案）
 * ══════════════════════════════════════════════════════════════════
 *
 * 這一支原本守的是「repo 裡那幾份 `待修正事項_*.md` 的逐條清冊要與內文一致」。
 * 那個機制本身沒有錯，但**前提已經改掉了**：
 *
 *   使用者 2026-09-21 定案：待修正事項一律以**他持有的《待修正事項總表》**
 *   為準，不放進 repository。repo 的文件只留「已經定案的口徑」「已決定的
 *   禁止事項」與「證據界線」。
 *
 *   理由：過期的待辦與「待裁示」段落會讓下一個維護者（含 AI）把**已經定案**
 *   的事當成還沒決定的事，然後「順手」改掉一個正確的設計——
 *   2026-09-21 就發生過一次，是使用者當場擋下來的。
 *
 * ⚠️ 舊版這一支在交付包裡是 **skip**（因為那幾份 .md 本來就不在包裡），
 *   於是它既沒有守到任何東西、又看起來像「有在守」。
 *   現在改成反過來守：**這幾份檔案不可以再出現在 repository 裡**。
 *   這是找得到就紅、找不到才綠，不會有「安靜地略過」那一種狀態。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("repository 裡不可以出現待修正事項清單", () => {
  const offenders = readdirSync(ROOT).filter((name) =>
    /^待修正事項/.test(name),
  );
  assert.deepEqual(
    offenders,
    [],
    "待修正事項清單又被放回 repository 了。它一律以使用者持有的" +
      "《待修正事項總表》為準；repo 文件只留已定案的口徑、禁止事項與證據界線。",
  );
});

test("PROJECT_HANDOFF 要寫明待修正事項放在哪裡", () => {
  /*
   * 反面守門：上面那一支是「找不到就綠」，把整套規則忘掉也會綠。
   * 這一支確認「為什麼不放」這件事真的被寫下來了——
   * 沒寫下來的話，下一個維護者只會覺得「清單不見了」然後再建一份。
   */
  assert.ok(
    readdirSync(ROOT).includes("PROJECT_HANDOFF.md"),
    "找不到 PROJECT_HANDOFF.md",
  );
  const text = readFileSync(ROOT + "PROJECT_HANDOFF.md", "utf8");
  assert.match(
    text,
    /待修正事項放在哪裡/,
    "PROJECT_HANDOFF 沒有寫明待修正事項放在哪裡——下一個維護者只會再建一份",
  );
  assert.match(text, /待修正事項總表/);
});
