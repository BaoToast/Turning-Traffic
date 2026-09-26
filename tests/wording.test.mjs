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

/*
 * ══════════════════════════════════════════════════════════════════
 *  引用《2022 年臺灣公路容量手冊》4.5.1.3 時不可以寫成「要求／規定」
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ 2026-09-25 第六輪抓到：註解寫「公路容量手冊 4.5.1.3 還特別**要求**
 *   『評估現況宜根據尖峰 15 分鐘之需求流率』」——被引用的那句話自己用的是
 *   **「宜」**，那是建議，不是要求。而同一支程式給使用者看的那一段
 *   （`調查格距異常` 的解決方式）寫的是「建議／鼓勵」：
 *   **同一份程式對同一句話給了兩種力度**，而註解是下一個人改程式時看的那一份。
 *
 * ⚠️ 姊妹系統全日交通量同一段文字有三處，其中一處在**使用者看得到的字串裡**。
 *   三支同一條規則。
 *
 * ⚠️ 樣式刻意只鎖 `4.5.1.3` 這一節：別的章節本來就有真正的「規定」
 *   （容量、服務水準門檻），整本禁字會在正確的敘述上變紅
 *   ——交通服務水準的手冊就有一段正確地寫著「手冊規範的是…、它沒有規定…」。
 */
test("引用公路容量手冊 4.5.1.3 時，力度必須是「建議／鼓勵」而不是「要求／規定」", () => {
  /*
   * ⚠️ 不可以有 `\n` 排除：正規化之後整段是一行，句子由「。」切開。
   * ⚠️ 負向後查不可以省：正確的敘述裡會出現「那是建議，**不是規定**」
   *   這種句子，少了 (?<!不是) 會把正解自己抓成違規——
   *   這一組系統已經在別的守門上踩過同一個坑（`FULL 不要求完整調查日`）。
   */
  const OVERSTATED =
    /4\.5\.1\.3[^。]{0,40}?(?<!不是)(?<!沒有)(?<!不)(要求|明文|規定)/;
  const DOCS = [
    "../app",
    "../lib",
    "../PROJECT_HANDOFF.md",
    "../VALIDATION_REPORT.md",
    "../README.md",
    "../【更新說明】請先讀我.txt",
    "../scripts/manual/manual.html",
  ];
  const bad = [];
  /*
   * ⚠️ **一定要先把換行正規化再掃**。第一版是逐行掃的，而那段註解長這樣：
   *     *   …公路容量手冊 4.5.1.3
   *     *   還特別要求「評估現況宜根據…」
   *   「4.5.1.3」與「要求」分在兩行，逐行掃**永遠抓不到**——
   *   我自己的反證就是這樣沒有變紅的（第六輪，同一個會話裡第三次）。
   *   作法：把行首的註解符號與換行都換成一個空白，再依「。」切句。
   */
  const scan = (label, text) => {
    const flat = text
      .replace(/\r/g, "")
      .replace(/\n[ \t]*\*[ \t]*/g, " ")
      .replace(/\n[ \t]*/g, " ");
    for (const sentence of flat.split("。")) {
      /* 記錄「原本寫錯」的更正註記本身不算違規。 */
      if (/更正|原本寫|不可以寫成|第六輪|樣式抓不到|被抓成違規/.test(sentence))
        continue;
      const hit = OVERSTATED.exec(sentence);
      if (hit) bad.push(`${label}：…${hit[0]}…`);
    }
  };
  for (const entry of DOCS) {
    const path = fileURLToPath(new URL(entry, HERE));
    if (statSync(path).isDirectory())
      for (const file of walkAll(path)) scan(file.replace(path, ""), readFileSync(file, "utf8"));
    else scan(entry.replace("../", ""), readFileSync(path, "utf8"));
  }
  assert.deepEqual(
    bad,
    [],
    "被引用的那句話用的是「宜」（建議），這幾處把它講成要求／規定：\n  " +
      bad.join("\n  "),
  );
  /* 前置檢查：樣式真的抓得到已知的舊寫法，否則這一支等於沒在守。 */
  for (const sample of [
    "公路容量手冊 4.5.1.3 還特別要求「評估現況宜根據尖峰 15 分鐘之需求流率」",
    "2022 年臺灣公路容量手冊 4.5.1.3 明文要求「評估現況宜根據",
  ])
    assert.match(sample, OVERSTATED, "樣式抓不到已知的舊寫法");
  /* 反面：正確的寫法不可以被抓。 */
  for (const good of [
    "公路容量手冊 4.5.1.3 還特別建議評估現況根據尖峰 15 分鐘的需求流率",
    "公路容量手冊 4.5.1.3 建議用尖峰 15 分鐘的流率；那是建議，不是規定",
    "公路容量手冊 4.5.1.3 不要求一定要拆到 15 分鐘",
  ])
    assert.doesNotMatch(good, OVERSTATED, `正確的寫法被抓成違規了：${good}`);
});

/** 遞迴列出目錄底下所有原始檔（含 .md／.html，供上面那一支使用）。 */
function walkAll(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkAll(full));
    else if (/\.(tsx?|mjs|js|md|txt|html)$/.test(full)) out.push(full);
  }
  return out;
}
