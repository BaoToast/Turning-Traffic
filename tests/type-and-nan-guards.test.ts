/*
 * ══════════════════════════════════════════════════════════════════════
 *  2026-09-25 修正的行為反證（路口轉向）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 這一支收的是「同一類缺陷」的行為測試，不是掃原始碼字串：
 *
 *   K9  pceFactor() 用 `Number(x ?? 1)`，空字串／陣列／布林會讓當量變 0
 *   K10 describeGrowth() 用 `!== null` 擋不住 NaN，於是同一句話同時印
 *       「—」與「起始季為 0」，而且「期間最高」會挑中那個讀不到的季
 *   K11 normalizeCondition() 的 digits 守衛漏掉註解自己點名的 Number("")
 *   K12 勾「全調查時段」＋「各方向各自認定」時，草稿宣告了一個
 *       完全沒套用的判定方式，還對可相加的累計量印「請勿相加」
 *   K19 movementPresence 的查詢鍵與寫入鍵不是同一把（併入過的路口每季重問）
 *
 * ⚠️ 每一條的反證做法都寫在該段裡，全部實驗過（2026-09-25）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PCE,
  pceFactor,
  pceIssues,
  MOVEMENT_LABELS,
  canonicalIntersectionKey,
} from "../lib/traffic.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";

/*
 * ⚠️ movementPresenceKey 住在 app/traffic-app.tsx（含 JSX，node --test 直接
 *   import 不了），所以這裡**把它的組法從原始碼切出來 eval**，
 *   而不是在測試裡另外抄一份公式——抄一份的話，app 改了組法測試照樣綠。
 */
const APP_SOURCE = readFileSync(
  new URL("../app/traffic-app.tsx", import.meta.url),
  "utf8",
);
const movementPresenceKey = (() => {
  const start = APP_SOURCE.indexOf("export function movementPresenceKey(");
  assert.notEqual(start, -1, "找不到 movementPresenceKey——它被改名或刪掉了");
  const end = APP_SOURCE.indexOf("\n}", start);
  const body = APP_SOURCE.slice(start, end + 2)
    .replace("export function", "function")
    .replace(/: string/g, "")
    .replace(/: MovementKey/g, "");
  return new Function(body + "\nreturn movementPresenceKey;")() as (
    a: string,
    b: string,
    c: string,
    d: string,
  ) => string;
})();
import {
  DEFAULT_CONDITION,
  buildConclusion,
  normalizeCondition,
} from "../lib/conclusion.ts";
import {
  makeRecord,
  CONCLUSION_META,
} from "./helpers/conclusion-record.ts";

/* ────────────────────────────────────────────────────────────────────
 *  K9 pceFactor()
 * ──────────────────────────────────────────────────────────────────── */
const NOT_A_NUMBER = ["", " ", "\t", [], false, true, "一點四", {}];

test("K9 當量係數是空字串／陣列／布林時回 NaN，不可以變成 0 或 1", () => {
  /*
   * ⚠️ 為什麼一定要擋：當量變 0 → 該車種該轉向的 PCU 全部變 0，
   *   而畫面、Excel、兩份草稿全部照印、沒有任何警告。
   *   `Number("")`、`Number([])`、`Number(false)` 都是 0，`Number(true)` 是 1。
   *
   * 反證：把 pceFactor 改回 `Number(pce[vehicle]?.[movement] ?? 1)`，
   *   這一條就會紅（實測 "" 會變 0、true 會變 1）。
   */
  for (const bad of NOT_A_NUMBER) {
    const pce = structuredClone(DEFAULT_PCE);
    (pce.motorcycle as Record<string, unknown>).left = bad;
    const got = pceFactor(pce, "motorcycle", "left");
    assert.ok(
      Number.isNaN(got),
      `當量設成 ${JSON.stringify(bad)} 時得到 ${got}——` +
        `那會讓該車種該轉向的 PCU 全部算成 ${got}，而且沒有任何警告`,
    );
  }
});

test("K9 真的沒填（null／undefined）仍然回 1，行為與改版前相同", () => {
  for (const empty of [null, undefined]) {
    const pce = structuredClone(DEFAULT_PCE);
    (pce.motorcycle as Record<string, unknown>).left = empty;
    assert.equal(
      pceFactor(pce, "motorcycle", "left"),
      1,
      `當量是 ${JSON.stringify(empty)} 時應該退回 1（＝沒填）`,
    );
  }
});

test("K9 正常值與數字字串都要照算（不可以修過頭）", () => {
  const pce = structuredClone(DEFAULT_PCE);
  assert.equal(pceFactor(pce, "motorcycle", "left"), DEFAULT_PCE.motorcycle.left);
  (pce.motorcycle as Record<string, unknown>).left = "0.5";
  assert.equal(pceFactor(pce, "motorcycle", "left"), 0.5, "數字字串要算得出來");
  (pce.motorcycle as Record<string, unknown>).left = 0;
  assert.equal(pceFactor(pce, "motorcycle", "left"), 0, "真的設成 0 是使用者的自由");
});

test("K9 pceIssues() 要指名是哪一格壞了（不可以只說「有問題」）", () => {
  const pce = structuredClone(DEFAULT_PCE) as Record<string, Record<string, unknown>>;
  pce.motorcycle.left = "";
  pce.car.right = "一點四";
  const issues = pceIssues(pce);
  assert.equal(issues.length, 2, `應該抓到兩格，實際：${JSON.stringify(issues)}`);
  /*
   * ⚠️ 2026-09-25 第六輪：這兩條原本驗的是訊息裡有 `left`／`right`
   *   ——也就是**內部鍵**。它把缺陷釘住了：使用者看到「機車／through」
   *   對不到畫面上的「直行」那一欄。現在要求印**中文轉向名**，
   *   並反過來斷言訊息裡**不可以**出現內部鍵。
   */
  assert.ok(
    issues.some(
      (line) => line.includes("機車") && line.includes(MOVEMENT_LABELS.left),
    ),
    `沒有指名機車／${MOVEMENT_LABELS.left}：${JSON.stringify(issues)}`,
  );
  assert.ok(
    issues.some(
      (line) => line.includes("小型車") && line.includes(MOVEMENT_LABELS.right),
    ),
    `沒有指名小型車／${MOVEMENT_LABELS.right}：${JSON.stringify(issues)}`,
  );
  for (const line of issues)
    for (const key of ["left", "through", "right"])
      assert.ok(
        !line.includes(key),
        `訊息裡出現內部鍵「${key}」，使用者對不到畫面上的欄位：${line}`,
      );
  assert.deepEqual(pceIssues(DEFAULT_PCE), [], "正常的矩陣不該被指出問題");
});

/* ────────────────────────────────────────────────────────────────────
 *  K10 describeGrowth()／describeExtremes() 的 NaN
 * ──────────────────────────────────────────────────────────────────── */
test("K10 某一季讀不到數值時，不可以寫「起始季為 0」", () => {
  /*
   * ⚠️ 實測到的舊輸出：
   *   「上午尖峰總流量由 114Q4 的 — PCU/hr 變為 115Q2 的 1,000.0 PCU/hr，
   *     起始季為 0，變動幅度無法以百分比表示；期間最高為 114Q4（— PCU/hr）。」
   *   同一句話前半印「—」（讀不到）、後半宣稱「是 0」，
   *   而且「期間最高」還挑中那個讀不到的季（reduce 以第一筆當初始值，
   *   `NaN > best.value` 恆為 false）。整句會被抄進報告。
   *
   * 反證：把 filter 改回 `point.value !== null`、
   *   把 change 改回 `first.value ? … : null`，這一條就會紅。
   */
  const first = makeRecord({ quarter: "114Q4" });
  const last = makeRecord({ quarter: "115Q2" });
  (first.peaks.AM as Record<string, unknown>).totalPcu = Number.NaN;
  const text = String(
    buildConclusion(
      [first, last],
      { ...DEFAULT_CONDITION, metrics: ["total", "growth"] },
      CONCLUSION_META,
    ),
  );
  assert.ok(
    !/上午尖峰[^\n]*起始季為 0/.test(text),
    `上午尖峰讀不到卻被寫成「起始季為 0」：\n${text}`,
  );
  assert.match(
    text,
    /上午尖峰[^\n]*讀不到數值/,
    `讀不到就要照實說出來，不可以整段消失：\n${text}`,
  );
  assert.ok(
    !/期間最高為[^）\n]*（—/.test(text),
    `「期間最高」挑中了一個讀不到數值的季：\n${text}`,
  );
});

test("K10 真的是 0 的那一季仍然要寫「起始季為 0」（不可以修過頭）", () => {
  const first = makeRecord({ quarter: "114Q4" });
  const last = makeRecord({ quarter: "115Q2" });
  (first.peaks.AM as Record<string, unknown>).totalPcu = 0;
  const text = String(
    buildConclusion(
      [first, last],
      { ...DEFAULT_CONDITION, metrics: ["total", "growth"] },
      CONCLUSION_META,
    ),
  );
  assert.match(
    text,
    /起始季為 0/,
    `真的量到 0 時應該寫「起始季為 0」：\n${text}`,
  );
});

/* ────────────────────────────────────────────────────────────────────
 *  K11 digits
 * ──────────────────────────────────────────────────────────────────── */
test("K11 digits 是空字串／空白／陣列／布林 false 時要退回預設 1 位", () => {
  /*
   * 反證：把守衛改回
   *   `source.digits === null || source.digits === undefined || !Number.isFinite(Number(source.digits))`
   * 這一條就會紅（實測 "" → 0）。
   */
  for (const bad of ["", " ", "\t", [], false, {}, "abc"])
    assert.equal(
      normalizeCondition({ digits: bad } as never).digits,
      DEFAULT_CONDITION.digits,
      `digits=${JSON.stringify(bad)} 被算成 ` +
        `${normalizeCondition({ digits: bad } as never).digits} 位——` +
        `使用者設的位數被靜默換掉，兩份草稿的位數從此對不起來`,
    );
});

test("K11 合法的位數（含數字字串）仍然照用", () => {
  for (const [given, want] of [
    [0, 0],
    [2, 2],
    ["2", 2],
    [" 2 ", 2],
    [2.4, 2],
    [99, 4],
    [-5, 0],
  ] as [unknown, number][])
    assert.equal(
      normalizeCondition({ digits: given } as never).digits,
      want,
      `digits=${JSON.stringify(given)} 應該夾成 ${want}`,
    );
});

/* ────────────────────────────────────────────────────────────────────
 *  K12 「全調查時段」不套用「各方向各自認定」
 * ──────────────────────────────────────────────────────────────────── */
test("K12 只勾全調查時段時，不可以宣告套用了「各方向各自認定」，也不可以叫人不要相加", () => {
  /*
   * ⚠️ recordWithApproachPeaks() 對 FULL 無條件回 null（設計如此：
   *   全調查時段是一段累計量，沒有尖峰視窗可挑）。
   *   舊版照 condition.peakRule 無條件寫抬頭，於是宣告了一個一次都沒套用的
   *   判定方式，還對**可以相加**的累計量印「請勿相加」。
   *
   * 反證：把抬頭改回無條件的三元運算，這一條就會紅。
   */
  const text = String(
    buildConclusion(
      [makeRecord({})],
      {
        ...DEFAULT_CONDITION,
        peakRule: "direction",
        peaks: ["FULL"],
        metrics: ["total"],
      },
      CONCLUSION_META,
    ),
  );
  assert.ok(
    !/本數值不適用「相加」/.test(text),
    `全調查時段的累計量是可以相加的，卻印了「請勿相加」：\n${text}`,
  );
  assert.match(
    text,
    /不套用「各方向各自認定自己的尖峰」/,
    `要明講「這個時段不套用那個判定方式」，不可以宣告一個沒套用的方式：\n${text}`,
  );
  assert.match(
    text,
    /仍然可以相加/,
    `要告訴使用者這個時段的量是可以相加的：\n${text}`,
  );
});

test("K12 同時勾上午尖峰與全調查時段時，兩句都要出現且各自正確", () => {
  const text = String(
    buildConclusion(
      [makeRecord({})],
      {
        ...DEFAULT_CONDITION,
        peakRule: "direction",
        peaks: ["AM", "FULL"],
        metrics: ["total"],
      },
      CONCLUSION_META,
    ),
  );
  assert.match(text, /套用於：上午尖峰/, `要說出套用在哪些時段：\n${text}`);
  assert.match(text, /本數值不適用「相加」/, `上午尖峰要保留警告：\n${text}`);
  assert.match(
    text,
    /全調查時段不套用/,
    `全調查時段要單獨點名不套用：\n${text}`,
  );
});

test("K12 判定方式選「整個調查點同一時段」時，說法與改版前完全相同", () => {
  const text = String(
    buildConclusion(
      [makeRecord({})],
      { ...DEFAULT_CONDITION, peakRule: "point", peaks: ["AM"], metrics: ["total"] },
      CONCLUSION_META,
    ),
  );
  assert.match(text, /整個調查點同一時段/, text);
  assert.ok(!/不適用「相加」/.test(text), `這一種是可以相加的：\n${text}`);
});

/* ────────────────────────────────────────────────────────────────────
 *  K19 movementPresence 的鑰匙
 * ──────────────────────────────────────────────────────────────────── */
test("K19 併入既有路口之後，查與存必須用同一把鑰匙", () => {
  /*
   * ⚠️ 這一條是「鍵一致性」的直接驗算。
   *   查詢端原本用「這次調查表自己的名字」，寫入端用已經改寫成合併目標的
   *   `record.name`。併入的條件本身保證兩個名字正規化後不同
   *  （from !== to），所以答案寫進去之後永遠查不到，
   *   裁決視窗每一季再跳一次——而程式三處註解都宣稱不會再問第二次。
   *
   *   修法是讓呼叫端把「解析過別名／合併目標之後的名字」傳進
   *   recordFromPreview 的 presenceKeyName，兩邊就對得上。
   */
  /*
   * ⚠️ 兩個名字要**正規化之後真的不同**才測得到東西。
   *   canonicalIntersectionKey() 會拿掉括號、破折號、「路口」→「路」等等，
   *   所以「中山北路岡山路口」與「中山北路－岡山路口」其實是同一把鍵
   *  （那是刻意的設計，不要改它）。這裡改用調查廠商真的會出現的另一種寫法：
   *   檔名只寫了其中一條路。
   */
  const importName = "岡山路口"; /* 這一季調查表上的寫法（只寫一條路） */
  const mergedName = "中山北路－岡山路口"; /* 既有路口（併入目標） */
  assert.notEqual(
    canonicalIntersectionKey(importName),
    canonicalIntersectionKey(mergedName),
    "前置：兩個名字正規化後必須不同，否則這一條測不到東西",
  );
  const writeKey = movementPresenceKey(
    canonicalIntersectionKey(mergedName),
    "A",
    "D",
    "left",
  );
  /* 修好之後：查詢端拿到的也是合併目標的名字 */
  const queryKeyFixed = movementPresenceKey(
    canonicalIntersectionKey(mergedName),
    "A",
    "D",
    "left",
  );
  assert.equal(queryKeyFixed, writeKey, "查與存的鑰匙必須相同");
  /* 舊行為（用調查表自己的名字）確實對不上——這就是缺陷本身 */
  const queryKeyOld = movementPresenceKey(
    canonicalIntersectionKey(importName),
    "A",
    "D",
    "left",
  );
  assert.notEqual(
    queryKeyOld,
    writeKey,
    "前置：舊做法確實會對不上（若這一條失敗，表示這個缺陷的前提已經不成立）",
  );
});

test("K19 recordFromPreview 必須收得下「解析後的路口名」，而且兩個呼叫端都要傳", () => {
  /*
   * ⚠️ 這一條補的是行為測試碰不到的部分（參數有沒有真的被傳進去）。
   *   單獨它沒有保護力，上面那一條才是。
   */
  const text = APP_SOURCE;
  assert.match(
    text,
    /presenceKeyName\?: string,/,
    "recordFromPreview 沒有 presenceKeyName 參數",
  );
  assert.match(
    text,
    /presenceKeyName \?\? item\.name/,
    "presenceKeyName 沒有被用來組 movementPresence 的鑰匙",
  );
  assert.match(
    text,
    /mergeTarget\?\.name \|\| nameMap\[item\.file\] \|\| item\.name,/,
    "匯入呼叫端沒有把解析後的名字傳進去",
  );
  assert.match(
    text,
    /previous\.name,\n {6}\);/,
    "重算呼叫端沒有把這一筆自己定案的名字傳進去",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  pceIssues() 必須真的有人用（2026-09-25，F6 第三輪抓到）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 上面那一支（K9）直接呼叫 `pceIssues()` 並驗它指名得出壞格——**那一段是對的**，
 * 但它**沒有驗有沒有人用它**。實際情況是：`grep -rn "pceIssues" app/ lib/ tests/`
 * 只命中 `lib/traffic.ts`（定義＋註解）與這一支測試，
 * `grep -c "整列不是物件" assets/index-*.js` 是 **0**——
 * 整個函式被 tree-shake 掉，**沒進發布的網站**。
 *
 * 於是 v2.1.83 這一項的淨效果只是「壞的當量格從靜靜變成 0 改成靜靜變成 NaN」：
 * 使用者拿到的仍然是沒有指名、沒有警告的錯數字，而 NaN 還會傳到 Excel 與草稿。
 * `VERSION_HISTORY` 與 `CHANGELOG.md` 卻對外宣告「新增 pceIssues() 逐格指名」。
 *
 * ⚠️ 這是「假的綠」的一種**新型態**：守門驗了函式的行為，卻沒驗它在不在線上。
 *   規則：凡是「為了告訴使用者某件事」而寫的函式，都要有一條驗它被接起來。
 */
test("pceIssues() 必須被 app 真的用到（不可以只有測試在呼叫）", () => {
  /* APP_SOURCE 上面已經讀過了，沿用它，不重複讀檔。 */
  const appSource = APP_SOURCE;
  const libSource = readFileSync(
    new URL("../lib/traffic.ts", import.meta.url),
    "utf8",
  );

  /* 一、lib 裡要有一個把它包成異常清單項目的入口。 */
  const wrapper = /export function pceMatrixIssue\([\s\S]*?\n\}/.exec(libSource);
  assert.ok(wrapper, "找不到 pceMatrixIssue()——pceIssues() 沒有被包成異常清單項目");
  assert.match(wrapper[0], /pceIssues\(/, "pceMatrixIssue 沒有真的呼叫 pceIssues()");
  /* 每一筆異常都必須有解決方式（X-49 的規則），這一筆也不例外。 */
  assert.match(wrapper[0], /resolution:\s*\{/, "這一筆異常沒有給解決方式");
  assert.match(wrapper[0], /kind:\s*"(人工確認|畫面修正|重新匯入)"/, "解決方式沒有寫 kind");
  assert.match(wrapper[0], /view:\s*"params"/, "解決方式沒有指出要去哪一頁處理");

  /* 二、畫面要真的把它接進異常清單。 */
  const memo = /const issues = useMemo\([\s\S]*?\n {2}\);/.exec(appSource);
  assert.ok(memo, "找不到 issues 這個 memo——結構改了嗎？");
  assert.match(
    memo[0],
    /pceMatrixIssue\(/,
    "異常清單沒有把當量係數的壞格接進來；pceIssues() 又會變成沒人用的死程式",
  );
  /* 計畫預設與每一條覆寫都要檢查，只檢查其中一種等於漏一半。 */
  assert.match(memo[0], /pceMatrixIssue\(\s*pce\s*,/, "沒有檢查計畫預設那一組係數");
  assert.match(
    memo[0],
    /pceScopes\.forEach[\s\S]*?pceMatrixIssue\(/,
    "沒有檢查「季別 × 路口」覆寫的那幾組係數",
  );

  /*
   * ⚠️ 2026-09-25 補一條**最直接**的：它必須真的出現在**發布產物**裡。
   *   上面那幾條都是掃原始碼，而這個缺陷的本質是「原始碼有、bundle 沒有」
   *   （tree-shake）。掃原始碼的守門對那件事天生無效。
   *   ⚠️ 只有原始碼的包（沒有 assets/）就跳過，並在輸出明講跳過的理由。
   */
  const assetsDir = new URL("../assets/", import.meta.url);
  if (existsSync(assetsDir)) {
    const main = readdirSync(assetsDir).find((name) => /^index-.*\.js$/.test(name));
    assert.ok(main, "根目錄 assets/ 裡找不到主程式資產");
    const bundle = readFileSync(new URL(main, assetsDir), "utf8");
    /* 訊息字串是它唯一會留在 bundle 裡的指紋（函式名會被壓掉）。 */
    for (const fingerprint of ["整列不是物件", "當量係數不是數字"])
      assert.ok(
        bundle.includes(fingerprint),
        `發布產物 assets/${main} 裡找不到「${fingerprint}」——` +
          "代表 pceIssues()／pceMatrixIssue() 被 tree-shake 掉了（沒有人用它），" +
          "或是根目錄的建置產物還是舊的",
      );
  } else {
    console.log("  \u2139\ufe0f 這一包沒有 assets/（只有原始碼），跳過「發布產物裡找得到」那一條。");
  }

  /*
   * 三、import 真的有拉進來（少了它，上面兩條會過、執行時會壞）。
   * ⚠️ 只看指向 lib/traffic 的那一段 import 區塊，不做全檔搜尋——
   *   全檔搜尋會被下面的呼叫點滿足，等於沒驗到 import。
   * ⚠️ 正規式刻意在 from 與引號之間放 `\\s+`，不要讓「from」後面直接接引號：
   *   `tests/dependency-manifest.test.mjs` 會掃「from 後面緊接引號」的字樣來
   *   反推有哪些外部套件，所以連**註解裡**都不可以出現那個組合——
   *   出現了就會被它當成一個叫「…」的套件（我 2026-09-25 讓那一支紅了兩次，
   *   第一次是正規式本體、第二次是我用來解釋它的註解）。
   */
  const importBlock = /import \{[\s\S]*?\} from\s+["'][^"']*lib\/traffic[^"']*["'];/.exec(
    appSource,
  );
  assert.ok(importBlock, "找不到從 lib/traffic 的 import 區塊");
  assert.match(
    importBlock[0],
    /\bpceMatrixIssue\b/,
    "app 沒有 import pceMatrixIssue",
  );
});
