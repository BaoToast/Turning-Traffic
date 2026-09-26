/*
 * ══════════════════════════════════════════════════════════════════════
 *  不可回頭清單的守門（A22）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 清單本身在 never-revert-contract.mjs，三支逐位元相同。
 * 這一支做三件事：
 *   ① 釘住清單沒有被單獨改過（SHA-256）
 *   ② 掃描這支程式的原始碼，確認「錯誤說法的關鍵字」沒有出現
 *   ③ 確認掃描真的掃到東西（不是掃了一個空字串然後變綠）
 *
 * ⚠️ **關鍵字掃描只掃使用者看得到的字串與程式碼，不掃註解。**
 *   註解裡必然會出現錯誤說法——那正是在解釋「不要改回這個」。
 *   不排除註解的話，寫得越清楚的警語越容易讓守門自己變紅，
 *   最後的下場是有人把守門關掉。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NEVER_REVERT, entriesFor } from "././never-revert-contract.mjs";

/* ⚠️ 寫死。改成從檔案現算就永遠對得上，等於沒有守門。 */
const CONTRACT_SHA256 = "bf929a6b503779f4df7ebc5164c34e96073db1cb4dcfd98534c15014c7e457b5";

const PROGRAM = "turning";
const SOURCES = ["../app/traffic-app.tsx", "../lib/traffic.ts", "../lib/conclusion.ts", "../lib/report-draft.ts"];

test("不可回頭清單沒有被單獨改過（三支必須一起改）", async () => {
  const bytes = await readFile(
    new URL("././never-revert-contract.mjs", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    CONTRACT_SHA256,
    "清單被改過。三支要一起改，並同步更新三支的 CONTRACT_SHA256。",
  );
  assert.ok(NEVER_REVERT.length >= 23, "清單條目變少了——不可以刪，只可以加");
});

/**
 * 去掉「不該被掃描的部分」，只留下真正會執行／會被使用者看到的字。
 *
 * ⚠️ 一、註解要去掉。註解裡必然會出現錯誤說法——那正是在解釋
 *   「不要改回這個」。不去掉的話，寫得越清楚的警語越容易讓守門自己變紅，
 *   最後的下場是有人把守門整支關掉。
 *
 * ⚠️ 二、**版本更新紀錄（VERSION_HISTORY／CHANGELOG）要去掉。**
 *   那是歷史：「v2.1.30 新增全日尖峰小時……只有 24 小時的調查檔算得出來」
 *   如實記載了當時的行為，把它改寫才是竄改紀錄。
 *   歷史說「當時是這樣」，守門要管的是「現在不可以是這樣」。
 */
const HISTORY_BLOCKS = [
  ["export const VERSION_HISTORY = [", "\n];"],
  ["const CHANGELOG = [", "\n];"],
];

function stripComments(text) {
  let body = text;
  for (const [open, close] of HISTORY_BLOCKS) {
    const start = body.indexOf(open);
    if (start === -1) continue;
    const end = body.indexOf(close, start);
    if (end === -1) continue;
    body = body.slice(0, start) + body.slice(end + close.length);
  }
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*\*.*$/gm, "");
}

test("這支程式的原始碼裡沒有出現任何「錯誤說法」", async () => {
  const bodies = [];
  for (const path of SOURCES) {
    const text = await readFile(new URL(path, import.meta.url), "utf8");
    bodies.push([path, stripComments(text)]);
  }
  /* ③ 掃描器沒壞：檔案讀得到、而且去掉註解之後還有東西。 */
  assert.ok(bodies.length > 0, "一個來源檔都沒讀到");
  for (const [path, body] of bodies)
    assert.ok(body.length > 2000, `${path} 去掉註解之後幾乎是空的，掃描無效`);

  const hits = [];
  for (const entry of entriesFor(PROGRAM))
    for (const phrase of entry.banned)
      for (const [path, body] of bodies)
        if (body.includes(phrase))
          hits.push(`#${entry.id}「${phrase}」出現在 ${path}：${entry.damage}`);
  assert.deepEqual(
    hits,
    [],
    "有已經定案、不可以改回去的事被改回去了：\n" + hits.join("\n"),
  );
});

test("每一列都寫得出「改回去會怎樣」", () => {
  /*
   * 沒有後果的條目最後一定會被當成可有可無而刪掉。
   * 這一支順便擋住「加了一列但欄位留空」。
   */
  for (const entry of NEVER_REVERT) {
    assert.ok(entry.fact.trim(), `#${entry.id} 沒有寫事實`);
    assert.ok(entry.damage.trim(), `#${entry.id} 沒有寫改回去會怎樣`);
    assert.ok(entry.scope.length, `#${entry.id} 沒有寫適用哪幾支`);
  }
});
