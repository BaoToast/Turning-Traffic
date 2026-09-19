/*
 * ══════════════════════════════════════════════════════════════════
 *  說明文字不可以用「位置代稱」（X-6 規則；2026-09-18 大檢查 F-31／F-02）
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：「不要寫右邊 左邊 上面 下面這類用詞，直接說清楚是……
 *   然後不要用這邊那邊容易誤會的名詞」。排版一改「右邊」就是錯的，而且沒有守門會紅。
 *
 * 原本這條守門在 repo 外面的 `../harness/wording-three.test.mjs`（三支一起掃），
 * 交付出去的完整專案與 GitHub Actions 都沒有那個目錄，`npm test` 因此永遠紅。
 * 改成每一支各自掃自己的原始檔（只掃字串字面值、HTML 樣板與 JSX 文字，註解不算）。
 *
 * 反面（做過）：把「按下面的確認鈕」放回去 → 紅。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = new URL(".", import.meta.url);
const SOURCES = ["../app", "../lib"];
/** 位置／數量代稱。 */
const BANNED = ["右邊", "左邊", "上面的", "下面的", "這邊", "那邊", "這兩張圖", "這兩張表", "上方那", "下方那"];

function files() {
  const out = [];
  for (const entry of SOURCES) {
    const path = fileURLToPath(new URL(entry, HERE));
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path))
        if (/\.(ts|tsx|js)$/.test(name) && !name.endsWith(".d.ts") && statSync(join(path, name)).isFile()) out.push(join(path, name));
    } else out.push(path);
  }
  return out;
}
/** 去掉註解後，抓字串字面值與 JSX／HTML 文字節點。 */
function visibleStrings(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const out = [];
  for (const re of [/"([^"\\\n]|\\.)*"/g, /'([^'\\\n]|\\.)*'/g, /`([^`\\]|\\.)*`/g]) {
    let m;
    while ((m = re.exec(stripped))) out.push(m[0]);
  }
  for (const line of stripped.split("\n"))
    if (/^\s*[\u4e00-\u9fff][^<>{}"'`]*$/.test(line) || />[^<>{}]*[\u4e00-\u9fff][^<>{}]*</.test(line))
      out.push(line.trim());
  return out;
}

test("前置：掃描器抓得到違規句、註解不誤判", () => {
  const hit = visibleStrings('const t = "請按下面的確認鈕";');
  assert.ok(hit.some((s) => BANNED.some((w) => s.includes(w))));
  const clean = visibleStrings("/* 右邊是註解 */\n// 左邊也是註解");
  assert.ok(!clean.some((s) => BANNED.some((w) => s.includes(w))));
});

test("使用者看得到的字串不可以用右邊／左邊／上面的／下面的／這邊那邊這類位置代稱", () => {
  const bad = [];
  for (const file of files()) {
    let text = readFileSync(file, "utf8");
    if (file.endsWith(join("lib", "traffic.ts"))) {
      /* VERSION_HISTORY 的 note 不再渲染到畫面（v2.1.62 起），整段切掉再掃 */
      const a = text.indexOf("export const VERSION_HISTORY = [");
      const b = a >= 0 ? text.indexOf("\n];", a) : -1;
      if (a >= 0 && b >= 0) text = text.slice(0, a) + text.slice(b + 3);
    }
    for (const s of visibleStrings(text))
      for (const w of BANNED) if (s.includes(w)) bad.push(`${file.split("/").slice(-2).join("/")}｜${w}｜${s.slice(0, 80)}`);
  }
  assert.deepEqual(bad, [], "這些句子用了位置代稱，請改寫成區塊或按鈕名稱：\n" + bad.map((b) => "  " + b).join("\n"));
});
