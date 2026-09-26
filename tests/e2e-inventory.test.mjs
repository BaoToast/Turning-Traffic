/*
 * ══════════════════════════════════════════════════════════════════════
 *  e2e 腳本的三個數字，文件與事實必須對得上
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 為什麼需要這一支 ──
 *
 * `PROJECT_HANDOFF.md` 寫著「83 支 e2e 腳本／npm run e2e 明列 82 支／
 * 合計 84 個執行步驟」，而 2026-09-23 的獨立複查實際去數是 **84／83／85**：
 * v2.1.82 新增的 `scripts/e2e-trend-order.mjs` 已經掛進 `npm run e2e`，
 * 那一行卻沒跟著改。
 *
 * ⚠️ 這不是「文件小瑕疵」：同一份文件（以及 `VALIDATION_REPORT.md`）
 *   要求複查的人**照這個數字核對**——「不得把 N 個步驟全部稱為瀏覽器 E2E」。
 *   數字本身過期的話，那條規勸就變成拿舊數字去糾正新事實。
 *
 * ── 另一件同樣重要的事：有沒有腳本「寫了卻沒掛」 ──
 *
 * 全日交通量在 v20.63 交接時踩過：repo 裡有兩支沒掛進 `npm run e2e` 的
 * 舊腳本，於是它們**從來沒有跑過**，而所有人都以為「E2E 全部通過」。
 * 所以這裡除了數字，還要列出「沒被掛上的腳本」並要求它們都在白名單裡。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));
const handoff = readFileSync(new URL("PROJECT_HANDOFF.md", ROOT), "utf8");

const files = readdirSync(new URL("scripts/", ROOT)).filter((name) =>
  /^e2e-.*\.mjs$/.test(name),
);
/*
 * ⚠️ 有些步驟帶著 node 旗標（例如
 *   `node --experimental-strip-types scripts/e2e-report-draft.mjs`），
 *   所以不可以寫死 `node scripts/…`——第一版就是那樣寫的，
 *   於是把一支**確實掛著**的腳本誤報成「沒掛」。
 *   誤報比漏報更糟：它會逼下一個人去把守門改鬆。
 */
const steps = [
  ...pkg.scripts.e2e.matchAll(/node\b[^&|]*?scripts\/([A-Za-z0-9-]+\.mjs)/g),
].map((match) => match[1]);
const e2eSteps = steps.filter((name) => name.startsWith("e2e-"));

/**
 * 刻意**不**掛進 `npm run e2e` 的腳本，每一支都要寫理由。
 * ⚠️ 這張表是「為什麼它沒跑」的唯一說明。腳本寫了卻沒掛又沒列在這裡，
 *   等於有一支永遠不會跑的測試，而大家以為它在守。
 */
const DELIBERATELY_UNHOOKED = {
  "e2e-tryout-smoke.mjs":
    "單檔試用版的獨立 smoke，由 `npm run e2e:tryout` 另外跑（它要先 build:tryout）",
};

test("⚠️ 每一支 e2e 腳本不是掛進 npm run e2e，就是列在例外表裡並寫明理由", () => {
  const unhooked = files.filter(
    (name) => !e2eSteps.includes(name) && !(name in DELIBERATELY_UNHOOKED),
  );
  assert.deepEqual(
    unhooked,
    [],
    "這幾支腳本寫了卻沒有掛進 npm run e2e，等於永遠不會跑：\n  " +
      unhooked.join("\n  ") +
      "\n（姊妹專案全日交通量在 v20.63 交接時就是這樣，兩支舊腳本從來沒跑過，" +
      "而所有人都以為「E2E 全部通過」。）",
  );
});

test("⚠️ 例外表寫的理由裡指名的 npm script，必須真的存在", () => {
  /*
   * ⚠️ 2026-09-25 第六輪抓到：例外表寫著
   *   「由 `npm run e2e:tryout` 另外跑」，而 `package.json` 裡**沒有**
   *   `e2e:tryout` 這個 script——那支腳本其實**沒有任何方式會跑到**。
   *   例外表的用途就是「說明它為什麼沒掛」，理由指向一個不存在的命令時，
   *   它從說明變成掩護。
   *
   * 守法：把理由裡出現的每一個 `npm run xxx` 抓出來，要求 package.json 有它。
   */
  const named = [];
  for (const reason of Object.values(DELIBERATELY_UNHOOKED))
    for (const m of reason.matchAll(/npm run ([A-Za-z0-9:_-]+)/g))
      named.push(m[1]);
  /* 前置檢查：真的抓到命令名，否則這一支等於沒在守。 */
  assert.ok(
    named.length >= 1,
    "例外表的理由裡一個 `npm run …` 都沒抓到——每一支沒掛的腳本都要說明「那它什麼時候跑」",
  );
  const missing = named.filter((name) => !(name in pkg.scripts));
  assert.deepEqual(
    missing,
    [],
    "例外表的理由指名了這些不存在的 npm script：\n  " +
      missing.map((name) => `npm run ${name}`).join("\n  ") +
      "\n（理由指向一個跑不起來的命令，那支腳本等於永遠不會跑）",
  );
  /* 反面：指名的命令真的會執行那支腳本，不是隨便一個同名的命令。 */
  for (const [file, reason] of Object.entries(DELIBERATELY_UNHOOKED))
    for (const m of reason.matchAll(/npm run ([A-Za-z0-9:_-]+)/g))
      assert.ok(
        (pkg.scripts[m[1]] || "").includes(file),
        `\`npm run ${m[1]}\` 沒有執行到 ${file}——理由對不上`,
      );
});

test("⚠️ 例外表裡不可以有其實已經掛上的腳本", () => {
  const stale = Object.keys(DELIBERATELY_UNHOOKED).filter((name) =>
    e2eSteps.includes(name),
  );
  assert.deepEqual(stale, [], "例外表說這幾支沒掛，但它們在 npm run e2e 裡：" + stale.join("、"));
});

test("⚠️ PROJECT_HANDOFF 寫的三個數字要等於實際數量", () => {
  /* 先確認那一段真的找得到，否則正規表示式改壞之後這一支會安靜地變成恆真。 */
  const section = handoff.slice(handoff.indexOf("- `scripts/`："));
  assert.ok(section.length > 200, "PROJECT_HANDOFF 裡找不到 scripts/ 那一段");

  const numbers = [...section.slice(0, 600).matchAll(/\*\*(\d+)\*\*/g)].map(
    (match) => Number(match[1]),
  );
  assert.equal(
    numbers.length,
    3,
    `那一段應該用 **N** 標出三個數字，實際抓到 ${numbers.length} 個——` +
      "格式改了就要同步改這一支，不要讓它變成恆真",
  );
  const [scriptCount, hookedCount, stepCount] = numbers;
  assert.equal(
    scriptCount,
    files.length,
    `文件說有 ${scriptCount} 支 e2e 腳本，實際 ${files.length} 支`,
  );
  assert.equal(
    hookedCount,
    e2eSteps.length,
    `文件說 npm run e2e 明列 ${hookedCount} 支，實際 ${e2eSteps.length} 支`,
  );
  assert.equal(
    stepCount,
    steps.length,
    `文件說合計 ${stepCount} 個執行步驟，實際 ${steps.length} 個`,
  );
});

test("前置：數出來的東西不是空的（不然上面三條會恆真）", () => {
  assert.ok(files.length >= 50, `只數到 ${files.length} 支腳本，數法可能壞了`);
  assert.ok(steps.length >= 50, `只數到 ${steps.length} 個步驟，數法可能壞了`);
  assert.ok(
    steps.length > e2eSteps.length,
    "步驟數應該比 e2e 腳本數多（還有種子資料產生器）",
  );
});

test("⚠️ 文件不可以把「執行步驟數」寫成「N 支 e2e」", () => {
  /*
   * ⚠️ 2026-09-25 第六輪抓到：`PROJECT_HANDOFF.md` 自己寫著
   *   「報告時不得把那 85 個步驟全部稱為瀏覽器 E2E」，
   *   而 `VALIDATION_REPORT.md` 的驗證數字表寫的就是「e2e｜85 支，全綠」。
   *   **文件自己訂的紅線，被同一包裡的另一份文件踩過去。**
   *
   * 守法：步驟數（`steps.length`）不可以和「支」＋e2e 出現在同一句；
   *   數字從實際數出來，不寫死——日後步驟數變了這一條照樣有效。
   */
  const total = steps.length;
  const files2 = [
    "PROJECT_HANDOFF.md",
    "VALIDATION_REPORT.md",
    "README.md",
    "【更新說明】請先讀我.txt",
  ];
  const bad = [];
  for (const name of files2) {
    let text;
    try {
      text = readFileSync(new URL(name, ROOT), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      /* 「不得把那 85 個步驟…稱為」這種**禁止句**本身不算違規。 */
      if (/不得|不可以|不能|禁止/.test(line)) continue;
      if (
        new RegExp(`${total}\\s*支`).test(line) &&
        /e2e|E2E|瀏覽器測試/.test(line)
      )
        bad.push(`${name}：${line.trim().slice(0, 100)}`);
    }
  }
  assert.deepEqual(
    bad,
    [],
    `這幾行把 ${total} 個執行步驟寫成「${total} 支 e2e」，` +
      `而其中 ${e2eSteps.length} 支才是瀏覽器測試、` +
      `${total - e2eSteps.length} 支是種子資料產生器：\n  ` +
      bad.join("\n  "),
  );
  /* 前置檢查：樣式真的抓得到已知的違規寫法。 */
  assert.match(`| e2e | ${total} 支，全綠 |`, new RegExp(`${total}\\s*支`));
});
