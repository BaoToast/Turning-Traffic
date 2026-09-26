/*
 * ══════════════════════════════════════════════════════════════════════
 *  手冊不可以和系統講不同的話
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 為什麼需要這一支 ──
 *
 * 使用者定的規矩：「大檢查時：手冊與系統要逐項交叉比對。」
 * 2026-09-12 的稽核實際抓到三句與現行行為**完全相反**的敘述：
 *
 *   「全日尖峰小時……只有調查滿 24 小時才算得出來」
 *   「調查不足 24 小時就沒有全天最忙的一小時可言」
 *   「『全日尖峰』永遠是『－』……系統不會拿部分時段去推估」
 *
 * 這三句在 v2.1.64 之前是對的。那一版依使用者決定把 24 小時的門檻拿掉、
 * 並把名稱改成「全調查時段尖峰」，系統從此**算得出來**——但手冊沒跟著改。
 *
 * ⚠️ 後果比「文件過期」嚴重得多：使用者照手冊判斷，會把一個正確的數字
 *   當成系統壞掉，或反過來以為某一欄本來就該是空的而不去追究。
 *   **手冊是使用者唯一的權威說明**，它和系統互相矛盾時，錯的是兩邊都不可信。
 *
 * ── 這一支守什麼 ──
 *
 * 只守「已經證實會出事」的那幾件，不做全面比對（全面比對要跑瀏覽器，
 * 在 harness/manual-cross-check.mjs）。守的是最便宜、最容易再犯的那一類：
 * **改了計算口徑或名稱，卻忘了改手冊。**
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SCOPE_LABELS } from "../lib/traffic.ts";

const manual = await readFile(
  new URL("../scripts/manual/manual.html", import.meta.url),
  "utf8",
);

test("手冊不可以再說「不足 24 小時就算不出全調查時段尖峰」", () => {
  /*
   * 這三句是 2026-09-12 實際找到的。留著正規式而不是比對整句，
   * 是因為改寫句子的人通常會換幾個字，但語意不變。
   */
  for (const [pattern, why] of [
    [/只有調查滿\s*24\s*小時才算得出來/, "v2.1.64 起不足 24 小時也算得出來"],
    [/不足\s*24\s*小時就沒有[^。]*最忙的一小時/, "同上，這句話已經不成立"],
    [/永遠是「－」/, "它不是永遠是「－」，算不出來另有原因（舊資料或格距）"],
  ])
    assert.doesNotMatch(
      manual,
      pattern,
      `手冊仍寫著與系統相反的敘述：${why}`,
    );
});

test("手冊用的時段名稱要和系統畫面上的一致", () => {
  /*
   * ⚠️ 期望值取自程式本身（SCOPE_LABELS），不要在測試裡再寫死一份名稱——
   *   寫死的話，下次改名會變成「測試綠、手冊錯」。
   */
  for (const label of Object.values(SCOPE_LABELS))
    assert.ok(
      manual.includes(label),
      `手冊裡找不到系統在用的統計範圍名稱「${label}」`,
    );
  /* 舊名不可以再出現在說明性的敘述裡。 */
  /*
   * ⚠️ 2026-09-25 第五輪複查：這一行原本是
   *     manual.replace(/（v2.1.64 起…）/g, "")
   *   而手冊裡**從來沒有**那種括號（實測 0 次命中），所以它從第一天就是空操作。
   *   更糟的是它讓人以為手冊允許帶版號的歷史括號，而
   *   `tests/manual-version-log.test.mjs` 的規則是不允許——兩支守門對
   *   「手冊能不能出現版號」給了不同答案。整行拿掉，答案只留一個。
   */
  const withoutHistory = manual;
  for (const stale of ["全日時段", "全日尖峰"])
    assert.ok(
      !withoutHistory.includes(stale),
      `手冊仍在用舊名「${stale}」，系統畫面上已經沒有這個詞`,
    );
});

test("這幾條真的抓得到（反面檢查，不然它們可能永遠是綠的）", () => {
  /*
   * ⚠️ 沒有這一段的話，上面兩條在正規式寫錯時會永遠通過，
   *   而我們會以為手冊被守著。
   */
  const broken =
    "全日尖峰小時：只有調查滿 24 小時才算得出來，不足 24 小時就沒有全天最忙的一小時可言。";
  assert.match(broken, /只有調查滿\s*24\s*小時才算得出來/);
  assert.match(broken, /不足\s*24\s*小時就沒有[^。]*最忙的一小時/);
  assert.ok("這一版把全日時段改名".includes("全日時段"));
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  角度慣例：手冊講的 0 度必須就是程式算的 0 度（2026-09-25）
 * ══════════════════════════════════════════════════════════════════════
 *
 * F6 第三輪抓到：手冊寫「**正北是 0 度**，順時針增加」，而
 * `bearingFromAngle()` 的表是 `["東","東南","南","西南","西","西北","北","東北"]`
 * ——**0 度是正東**。README 與 PROJECT_HANDOFF 都寫對，只有手冊寫反。
 *
 * ⚠️ 這不是「文件過期」，是**照著做就全錯**：每一條支線都會偏 90 度，
 *   而系統是用「兩條支線之間的夾角」判左／直／右，
 *   所以左轉會被判成右轉——而且手冊自己在同一頁下面就寫著
 *   「角度填錯，左轉會被判成右轉，**而且不會有錯誤訊息**」。
 *
 * ⚠️ 守法刻意**從程式的對照表反推**該講哪一個方位，不比對寫死的字串。
 *   表改了（例如改成 0 度＝北），手冊沒跟上照樣會紅。
 */
test("手冊講的「0 度是哪個方位」必須與 bearingFromAngle() 一致", async () => {
  const { bearingFromAngle } = await import("../lib/traffic.ts");
  const zero = bearingFromAngle(0);
  /* 前置檢查：函式真的回得出方位字，否則這一支等於沒在守。 */
  assert.ok(
    ["東", "南", "西", "北"].includes(zero),
    `bearingFromAngle(0) 回了「${zero}」，不是四正方位——對照表改了嗎？`,
  );

  /* 手冊裡那一列的文字 */
  const line = manual.match(/<li><strong>角度<\/strong>[\s\S]*?<\/li>/)?.[0];
  assert.ok(line, "抓不到手冊「角度」那一列——寫法改過的話這一支要跟著改");

  /* 必須講對的那一個，而且不可以講成別的正方位。 */
  assert.ok(
    line.includes(`0 度是正${zero}`) || line.includes(`正${zero}是 0 度`),
    `手冊沒有把「0 度＝正${zero}」講出來。實際那一列是：\n  ${line}`,
  );
  for (const other of ["東", "南", "西", "北"]) {
    if (other === zero) continue;
    assert.ok(
      !new RegExp(`正${other}是 0 度|0 度是正${other}`).test(line),
      `手冊把 0 度說成正${other}，而程式的 0 度是正${zero}`,
    );
  }
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  手冊提到的分頁名，必須是側欄真的有的那幾個（2026-09-25）
 * ══════════════════════════════════════════════════════════════════════
 *
 * F6 第三輪抓到：手冊有五處指到一個**不存在的分頁「資料品質檢查」**，
 * 而且同一張分區表裡同時列了舊名（掛在錯的分區「一　建立與匯入」）
 * 與新名「資料維護」（在對的分區「五　產出與維護」）——一份手冊自己前後矛盾。
 * 程式裡 `app/traffic-app.tsx` 的 NAV 早就改名並搬區了，還寫著改名的理由。
 *
 * ⚠️ 既有的守門抓不到的原因：它只守「24 小時那三句」與 `SCOPE_LABELS`，
 *   **沒有任何一條在比對手冊講的分頁名是不是側欄真的有的**。
 *
 * 守法：把 NAV 的 label 當白名單，掃手冊裡被 `<strong>「…」</strong>`
 * 或 `「…」` 包起來、看起來像分頁名的字串，不在白名單就紅。
 * ⚠️ 只掃「已知的舊分頁名」會變成打地鼠，所以改成**白名單**方向。
 */
test("手冊提到的分頁名必須是側欄真的有的那幾個", async () => {
  const source = await readFile(
    new URL("../app/traffic-app.tsx", import.meta.url),
    "utf8",
  );
  /* NAV 的 label（含小分頁的 label，它們也會被手冊引用）。 */
  const labels = new Set(
    [...source.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]),
  );
  /* 前置檢查：白名單真的抓到了。 */
  assert.ok(
    labels.size >= 30 && labels.has("資料維護"),
    `NAV 的 label 只抓到 ${labels.size} 個——結構改了嗎？這一支靠它當白名單`,
  );

  /*
   * ⚠️ 已知會被手冊當成分頁名引用、但不是 NAV label 的字：分區名、
   *   畫面上的區塊名、動作名。列成**具名清單**而不是整類放行，
   *   日後多一個名字仍然會紅。
   */
  const ALSO_OK = new Set([
    /* 分區名（不是分頁） */
    "一　建立與匯入", "二　參數設定", "三　資料檢視", "四　圖表與比較", "五　產出與維護",
    /*
     * 資料別、時段名。
     * ⚠️ 2026-09-25 第六輪：這裡原本還列著「全日」。那是 v2.1.64 **改掉的舊名**
     *   （現在叫「全調查時段」／「全調查時段尖峰」），留在豁免清單裡等於
     *   預先替手冊的舊名開一張通行證——手冊哪天寫回「到「全日」」也不會紅。
     *   下面那條「豁免清單裡不可以有程式裡找不到的名字」當時抓不到它，
     *   因為 `source` 是整檔文字，而註解與 `VERSION_HISTORY` 裡本來就寫著
     *   「全日」的歷史（那正是 B1 那一條同樣的漏洞）。已一併修正。
     */
    "平日", "假日", "上午尖峰", "下午尖峰", "全調查時段", "全調查時段尖峰",
    /*
     * 按鈕與動作名。
     * ⚠️ 2026-09-25 第六輪移除「重新套用計算」：**全站沒有那一顆按鈕**
     *   （實際是「用目前的設定重算（N 筆）」與「用這一組重算」）。
     *   它留在豁免清單裡，就是在替手冊與畫面上那句錯的提示打掩護。
     */
    "確認寫入", "用目前的設定重算", "用這一組重算",
    /* 畫面上的控制項／欄位名（在某一頁裡面，不是分頁本身） */
    "顯示調查日期", "調查日期不只一個", "指定調查日期",
    /* 單位字樣 */
    "PCU/hr", "輛/hr",
  ]);

  /*
   * 只挑「<strong>「…」</strong>」這種被特別標起來、明顯在指某一頁的寫法，
   * 以及「到「…」」「進「…」」這種操作指示。
   */
  const cited = new Set();
  for (const m of manual.matchAll(/<strong>「([^」]{3,14})」<\/strong>/g)) cited.add(m[1]);
  for (const m of manual.matchAll(/[到進去]「([^」]{3,14})」/g)) cited.add(m[1]);
  assert.ok(cited.size >= 5, `抓不到手冊引用的分頁名（只抓到 ${cited.size} 個）`);

  const unknown = [...cited].filter(
    (name) => !labels.has(name) && !ALSO_OK.has(name),
  );
  assert.deepEqual(
    unknown,
    [],
    "手冊指到這些名字，但側欄沒有這幾個分頁（改名或搬區之後手冊沒跟上）：\n  " +
      unknown.join("、") +
      "\n若那是區塊名而不是分頁名，請加進這一支的 ALSO_OK 具名清單並寫明理由",
  );

  /*
   * ── 反過來也要成立：ALSO_OK 裡不可以有「程式裡根本不存在」的名字 ──
   *
   * 2026-09-25 第五輪複查指出這一支「反向不成立」。
   * ⚠️ 但**不可以**改成「ALSO_OK 每一個都必須被手冊引用到」：手冊本來就不一定
   *   每一個分區名、每一個時段名都用 `<strong>「…」</strong>` 包起來提，
   *   那樣會產生假的紅（實測 18 個裡有 13 個目前沒被引用）。
   *   真正該守的是「這張豁免清單裡沒有憑空編出來的名字」——
   *   那才是它會腐壞的方向（例如某個區塊改名了，豁免清單留著舊名，
   *   手冊也留著舊名，於是兩邊一起錯而守門沉默）。
   */
  /*
   * ⚠️ 2026-09-25 第六輪：這一條原本拿**整檔文字**去 `includes`，
   *   所以註解與 `VERSION_HISTORY` 裡寫過的舊名一律算「存在」——
   *   而註解與改版紀錄本來就會寫舊名（那是它們的用途）。
   *   結果是：這一條抓不到任何已經改掉的名字，也就是它要守的那一件事。
   *   比對之前先切掉註解與 `VERSION_HISTORY`（同 B1 的作法）。
   */
  /*
   * ⚠️ 範圍要含 `lib/traffic.ts` 與 `app/main-filters.ts`：
   *   時段名、資料別、異常類別名（例如「調查日期不只一個」）都住在那裡，
   *   只掃 `traffic-app.tsx` 會把它們誤判成幽靈。
   *   `VERSION_HISTORY` 要先切掉，否則歷次改版敘述又會讓這一條恆真。
   */
  const stripHistory = (text) => {
    const at = text.indexOf("export const VERSION_HISTORY = [");
    if (at < 0) return text;
    const end = text.indexOf("\n];", at);
    return end < 0 ? text.slice(0, at) : text.slice(0, at) + text.slice(end + 3);
  };
  const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/[^\n]*$/gm, " ");
  let live = "";
  for (const file of [
    "../app/traffic-app.tsx",
    "../app/main-filters.ts",
    "../lib/traffic.ts",
  ])
    live += stripComments(
      stripHistory(await readFile(new URL(file, import.meta.url), "utf8")),
    );
  assert.ok(live.length > 200_000, `切完只剩 ${live.length} 字，切過頭了`);
  assert.ok(
    !live.includes("export const VERSION_HISTORY"),
    "VERSION_HISTORY 沒有被切掉——這一條會退回成恆真",
  );
  assert.ok(
    !live.includes("F6 第三輪抓到"),
    "註解沒有被切掉——這一條會退回成幾乎恆真",
  );
  /*
   * ⚠️ 不可以只用 `includes`：短名字會被**別的詞包住**而蒙混過關。
   *   實測：把已改掉的舊時段名「全日」放回豁免清單，`includes` 照樣過——
   *   因為另一句正常的說明裡寫著「全日整點」。
   *   所以要求它是一個**完整的使用者可見字串**：
   *   在字串字面裡整串出現（`"全日"`、`「全日」`、`>全日<`），
   *   或前後不是中日文字。
   */
  const isWholeLabel = (name) => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:"${esc}"|「${esc}」|>${esc}<|(?<![\\p{Script=Han}\\w])${esc}(?![\\p{Script=Han}\\w]))`,
      "u",
    ).test(live);
  };
  const ghosts = [...ALSO_OK].filter((name) => !isWholeLabel(name));
  /* 前置檢查：這個判斷真的會對已知的幽靈說不（否則它又變成恆真）。 */
  assert.ok(
    !isWholeLabel("全日"),
    "「全日」是 v2.1.64 改掉的舊時段名，判斷卻說它還在——這一條又變成恆真了",
  );
  assert.ok(isWholeLabel("平日"), "「平日」是現行的資料別，判斷卻說它不存在");
  assert.deepEqual(
    ghosts,
    [],
    "ALSO_OK 這張豁免清單裡有程式裡找不到的名字——它可能已經改名了，"
      + "而豁免清單正在替手冊的舊名打掩護：\n  " + ghosts.join("、"),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  交接文件也不可以和系統講不同的話（2026-09-25）
 * ══════════════════════════════════════════════════════════════════════
 *
 * F6 第三輪抓到：手冊那幾句有守門（上面那一支），但 `PROJECT_HANDOFF.md`
 * **沒有任何人守**，於是同樣的兩句過期敘述在那裡活到現在：
 *
 *   「`DAY` 只在調查涵蓋至少 1,440 分鐘時提供」
 *   「全日時段與全日尖峰都要求至少 24 小時」
 *   「混合時間格目前是只警告、不改既有挑選邏輯，未經使用者明確決策不得順手改掉」
 *
 * ⚠️ 這比手冊過期更貴：交接文件是**工程唯一正式基準**，而第三句是寫給
 *   下一個人的**紅線**。照它做，複查者會把 v2.1.83 的核心修正當成
 *   「未經授權順手改掉的口徑變更」而要求還原——這份文件自己就記錄過
 *   一次「文件反過來要求把正確的值改回舊值」的事故。
 *
 * ⚠️ 守法與手冊那一支一樣：只守**已經證實會出事**的那幾句語意，
 *   不做全面比對。並且把「現在的正解」也一起釘住（正面斷言），
 *   否則有人把那幾句整段刪掉也會過。
 */
test("PROJECT_HANDOFF.md 不可以再說「DAY 要滿 24 小時」或「混用格長只警告」", async () => {
  const handoff = await readFile(
    new URL("../PROJECT_HANDOFF.md", import.meta.url),
    "utf8",
  );
  /* 前置檢查：真的讀到那一節，否則這一支等於沒在守。 */
  assert.match(handoff, /###\s*6\.3/, "抓不到 6.3 節——文件結構改了嗎？");

  for (const [pattern, why] of [
    [
      /`?DAY`?\s*只在調查涵蓋至少\s*1,?440\s*分鐘時提供/,
      "v2.1.64 起 DAY 不再要求 24 小時（peakWindowsFor 裡是 void surveyMinutes）",
    ],
    [
      /全日時段與全日尖峰都要求至少\s*24\s*小時/,
      /*
       * ⚠️ 這一行的理由原本寫「只有 FULL 要求完整調查日，DAY 不要求」——
       *   **那也是錯的**：FULL 也不要求（見下面兩條）。守門自己的說明寫錯，
       *   會讓下一個人照著把 FULL 改回去。2026-09-25 更正。
       */
      "兩者都不要求 24 小時：DAY 自 v2.1.64 起不要求，FULL 只在沒有記錄調查時數時才算不出來",
    ],
    /*
     * ⚠️ 2026-09-25 第五輪複查：原本這一條只擋**一種字面寫法**，
     *   而第 11 節用的是另一種寫法（同一件事、不同句子），所以整條看不到。
     *   改成**概念級**：只要同一句裡同時出現「混合／混用時間格（挑選）」
     *   與「只警告」，不管後面接什麼，一律紅。
     *   本輪我自己在寫更正註記時原句引用了那一句，也被這一條抓出來——
     *   那正是它該有的反應，註記已改成轉述。
     */
    /*
     * ⚠️ 2026-09-25 第六輪：上一輪雖然說是改成「概念級」，實際上還是綁死
     *   **「只警告」這三個字**。同一條紅線可以有很多種寫法：
     *   「只給提醒」「僅警示」「不動計算」「不改既有挑選邏輯」「維持既有挑選」。
     *   實測：`VALIDATION_REPORT.md` 第 11 節那一列寫的就是
     *   「混合時間格不動計算、只給提醒」——舊樣式一個字都抓不到。
     *   現在改成「同一句裡同時出現『混合／混用時間格』與**任一種
     *   『不改計算』的說法**」就紅。
     */
    [
      new RegExp(
        "(?:混合|混用)時間格[^。\n]{0,24}?" +
          "(?:只警告|僅警告|只加警告|只提醒|僅提醒|只給提醒|只警示|僅警示" +
          "|不動計算|不改計算|不改既有挑選|不改挑選邏輯|維持既有挑選)",
      ),
      "v2.1.83 起混用格長已改成逐格採用自己的長度（使用者 2026-09-24 拍板）",
    ],
    /* 反過來的語序也要抓：「只給提醒、不動混用時間格的計算」。 */
    [
      new RegExp(
        "(?:只警告|僅警告|只提醒|僅提醒|只給提醒|只警示|僅警示|不動計算|不改計算)" +
          "[^。\n]{0,24}?(?:混合|混用)時間格",
      ),
      "同上（語序相反的寫法）",
    ],
    /*
     * ⚠️ 2026-09-25 第五輪複查：`FULL` 那兩條與 `DAY` 同一節、同一類、
     *   同一個成因，09-25 只修了 `DAY`，`FULL` 一條都沒守。
     *   實際留在文件裡的是「FULL（全調查日累計）要求完整調查日；
     *   資料不足 24 小時時顯示「－」與原因」——而
     *   `fullDayUnavailableReason()` 只在「沒有記錄調查時數」時才回原因。
     */
    [
      /*
       * ⚠️ 負向後查不可以省：現在的正解那一句寫的是「FULL **不**要求完整
       *   調查日」，少了 (?<!不) 會把正解自己抓成違規（本輪實際發生過）。
       */
      /`?FULL`?[^。\n]{0,20}(?<!不)要求完整調查日/,
      "FULL 不要求完整調查日：fullDayUnavailableReason() 只在沒有記錄調查時數時才回原因",
    ],
    [
      /`?FULL`?\s*是完整調查日累計/,
      "FULL 的單位由 scopeUnit() 依涵蓋範圍決定（調查日／調查時段），不是只有「調查日」一種",
    ],
  ])
    assert.doesNotMatch(handoff, pattern, `交接文件仍寫著與系統相反的敘述：${why}`);

  /* 正面斷言：現在的正解要寫在那裡，不可以整段刪掉了事。 */
  assert.match(
    handoff,
    /`?FULL`?\s*不要求完整調查日/,
    "交接文件沒有寫出 FULL 現在的規則（只寫「不是舊規則」不算，要寫出正解）",
  );
  assert.match(
    handoff,
    /調查時段/,
    "交接文件沒有提到 FULL 的另一種單位（調查時段）",
  );
  assert.match(
    handoff,
    /自\s*v2\.1\.64\s*起不再要求\s*24\s*小時/,
    "交接文件沒有寫出 DAY 現在的規則",
  );
  assert.match(
    handoff,
    /自\s*v2\.1\.83\s*起逐格採用自己的長度/,
    "交接文件沒有寫出混用格長現在的做法",
  );

  /* 而且程式真的是那樣——不是只有文件這樣寫。 */
  const lib = await readFile(new URL("../lib/traffic.ts", import.meta.url), "utf8");
  assert.match(
    lib,
    /void surveyMinutes;/,
    "程式裡找不到 `void surveyMinutes;`——DAY 的 24 小時門檻回來了嗎？那文件要跟著改回去",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  手冊叫使用者按的按鈕，必須是程式裡真的有的那一顆（2026-09-25 第五輪）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 第五輪獨立複查抓到：手冊寫「按『讀取並預覽』之後…」，而那六個字**全包只有
 * 手冊那一行有**——程式裡那顆按鈕是「選擇檔案」（未選年度季度時寫
 * 「請先選年度與季度」，解析中寫「正在解析…」），選完檔就自動出現辨識結果。
 * 手冊自己第 4 章的步驟寫的才是對的流程，同一本手冊前後矛盾。
 *
 * ⚠️ 既有的分頁名白名單那一支抓不到：它只掃 `<strong>「…」</strong>` 與
 *   `到／進／去「…」` 兩種寫法，**按鈕是「按「…」」**，不在它的射程內。
 *
 * 守法：掃手冊裡「按／按一下／點／點一下」＋「…」的字串，
 * 要求它在 `app/` 或 `lib/` 的原始碼裡逐字出現。
 * 這是機械可算的，不需要白名單。
 */
test("手冊叫使用者按的按鈕，程式裡必須真的有", async () => {
  const manual = await readFile(
    new URL("../scripts/manual/manual.html", import.meta.url),
    "utf8",
  );
  const plain = manual.replace(/<[^>]+>/g, "");
  const files = [
    "../app/traffic-app.tsx",
    "../app/main-toolbar.tsx",
    "../app/main-filters.ts",
    "../lib/traffic.ts",
    "../lib/final-features.ts",
  ];
  /*
   * ⚠️ 2026-09-25 第六輪抓到這一支是**假的綠**：它整檔 `includes`，
   *   而 `lib/traffic.ts` 裡有 `VERSION_HISTORY`——歷次改版的敘述。
   *   那份敘述提到過的每一顆按鈕（包含**後來改名或移除**的）都在字串裡，
   *   所以「手冊寫的按鈕程式裡有沒有」永遠會過。
   *   註解同理：註解裡本來就會記「這顆鈕以前叫 X」。
   *
   * 作法：比對之前先切掉 ①`VERSION_HISTORY` 整段、②全部註解。
   *   剩下的才是**真的會畫到畫面上**的字。
   */
  const stripHistory = (text) => {
    const start = text.indexOf("export const VERSION_HISTORY = [");
    if (start < 0) return text;
    const end = text.indexOf("\n];", start);
    return end < 0 ? text.slice(0, start) : text.slice(0, start) + text.slice(end + 3);
  };
  const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/[^\n]*$/gm, " ");
  let source = "";
  for (const f of files)
    source += stripComments(
      stripHistory(await readFile(new URL(f, import.meta.url), "utf8")),
    );
  /*
   * 前置檢查：切除真的發生了，而且沒有把整個檔切光。
   * 這兩條缺一個，上面那段就會安靜地退回成原本的假綠。
   */
  assert.ok(source.length > 200_000, `切完只剩 ${source.length} 字，切過頭了`);
  assert.ok(
    !source.includes("export const VERSION_HISTORY"),
    "VERSION_HISTORY 沒有被切掉——這一支會退回成恆真",
  );
  assert.ok(
    !source.includes("第五輪獨立複查抓到"),
    "註解沒有被切掉——這一支會退回成恆真",
  );

  const cited = [
    ...new Set(
      [...plain.matchAll(/(?:按一下|按|點一下|點)「([^」]{2,16})」/g)].map(
        (m) => m[1],
      ),
    ),
  ];
  /* 前置檢查：真的抓到一批按鈕名，否則這一支等於沒在守。 */
  assert.ok(
    cited.length >= 5,
    `手冊裡只抓到 ${cited.length} 個「按「…」」——正規式壞了嗎？`,
  );
  /*
   * ⚠️ 2026-09-25 第六輪再補一次：光驗「這串字出現在原始碼裡」**不夠**。
   *   實測：手冊與畫面上的提示都寫「按一下『重新套用計算』」，而**全站沒有
   *   那一顆按鈕**（實際是「用目前的設定重算（N 筆）」與「用這一組重算」）。
   *   那五個字之所以「找得到」，是因為它出現在一段**說明文字**裡——
   *   說明文字提到一個不存在的按鈕，正是這一支要抓的東西。
   *
   * 作法：另外抽出**真正的按鈕文字**（`<button …>…</button>` 之間的字，
   *   以及側欄 `NAV` 的 label），要求被引用的名字是其中之一。
   *   ⚠️ 允許「前綴相符」：畫面上的字常帶動態尾綴
   *   （「用目前的設定重算（{n} 筆）」），手冊只寫前面那一段是正確的寫法。
   */
  /*
   * 抽出每一顆 `<button>` 的內容。
   *
   * ⚠️ 不可以用 `/<button[^>]*>/`：開始標籤裡有箭頭函式（`onClick={() => …}`），
   *   `[^>]*` 會在 `=>` 的那個 `>` 就停下來，於是抓到的「內容」是程式碼而不是文字
   *   ——「產生草稿」那一顆就是這樣漏掉的。
   *   作法：從 `</button>` 往回找最近的 `<button`，再從那裡**跳過成對的大括號
   *   與字串**，找到真正結束開始標籤的那個 `>`。
   *
   * ⚠️ 內容裡的字串字面值也要收：按鈕文字常寫成三元式
   *   （`{importing ? "正在解析…" : "選擇檔案"}`）。
   */
  const buttonTexts = new Set();
  const addText = (raw) => {
    const text = raw
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
      .replace(/\{[\s\S]*?\}/g, "\u0000")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, "")
      .trim();
    if (text) buttonTexts.add(text);
  };
  {
    let at = 0;
    for (;;) {
      const close = source.indexOf("</button>", at);
      if (close < 0) break;
      at = close + 9;
      const open = source.lastIndexOf("<button", close);
      if (open < 0) continue;
      /* 找開始標籤的結尾 `>`：跳過 {…} 與 "…"／'…'／`…` */
      let i = open + 7;
      let depth = 0;
      let quote = "";
      for (; i < close; i += 1) {
        const ch = source[i];
        if (quote) {
          if (ch === "\\") i += 1;
          else if (ch === quote) quote = "";
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
        if (ch === "{") { depth += 1; continue; }
        if (ch === "}") { depth -= 1; continue; }
        if (ch === ">" && depth === 0) break;
      }
      const body = source.slice(i + 1, close);
      addText(body);
      /* 內容裡的字串字面值各自也算一個候選按鈕文字。 */
      for (const lit of body.matchAll(/"([^"\n]{2,30})"/g))
        addText(lit[1]);
    }
  }
  const navBlock2 = source.match(/const NAV: \{[\s\S]*?\n\}\[\] = \[[\s\S]*?\n\];/);
  if (navBlock2)
    for (const m of navBlock2[0].matchAll(/label:\s*"([^"]+)"/g))
      buttonTexts.add(m[1].replace(/\s+/g, ""));
  /* 前置檢查：真的抽到一批按鈕文字，否則這一段等於恆真。 */
  assert.ok(
    buttonTexts.size >= 20,
    `只抽到 ${buttonTexts.size} 個按鈕文字——`
      + "`<button>` 的寫法改了嗎？抽不到就等於沒在守",
  );
  for (const must of ["用這一組重算", "選擇檔案", "產生草稿"])
    assert.ok(
      buttonTexts.has(must),
      `按鈕文字清單裡沒有「${must}」，抽取方式不對`,
    );
  assert.ok(
    [...buttonTexts].some((t) => t.startsWith("用目前的設定重算")),
    "按鈕文字清單裡沒有「用目前的設定重算…」，抽取方式不對",
  );

  const squeeze = (text) => text.replace(/\s+/g, "");
  const isRealButton = (name) => {
    const want = squeeze(name);
    for (const text of buttonTexts) {
      const plain = text.split("\u0000").join("");
      if (plain === want) return true;
      /*
       * 允許手冊只寫前面那一段，前提是**後面接的是括號補述**
       *   ・「用目前的設定重算（{n} 筆）」→ 手冊寫「用目前的設定重算」
       *   ・「重設所有圖卡位置（全部模式）」→ 手冊寫「重設所有圖卡位置」
       * 只允許括號，不允許任意前綴——任意前綴會讓這一支鬆掉。
       */
      if (plain.startsWith(want) && /^[（(]/.test(plain.slice(want.length)))
        return true;
      if (
        plain.startsWith(want) &&
        text.includes("\u0000") &&
        ["\u0000", "（", "("].includes(text.slice(want.length, want.length + 1))
      )
        return true;
    }
    return false;
  };
  const missing = cited.filter((name) => !isRealButton(name));
  assert.deepEqual(
    missing,
    [],
    "手冊叫使用者按這幾顆按鈕，但它們**不是畫面上任何一顆按鈕的字**"
      + "（改名之後手冊沒跟上，或那顆按鈕根本不存在——"
      + "注意：字串出現在說明文字裡不算）：\n  "
      + missing.join("\n  "),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  手冊裡的「第 N 章」交叉引用（2026-09-25 第五輪）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 第五輪獨立複查抓到**四處**指錯章：導讀表把「要交報表、要寫報告文字」指到
 * 轉向圖與其他分析頁面那兩章、把「換電腦、卡住了」指到結論草稿產生器，
 * 正文又把備份指到錯的一章。章號與章名都是機械可算的，卻完全沒有守門。
 *
 * 這一支守兩件事：
 *   ① 手冊裡提到的每一個「第 N 章」都必須真的存在（不可以超出章數）；
 *   ② 導讀表每一列指到的章，其**章名**必須包含這裡列出的關鍵詞。
 *
 * ⚠️ ② 是**具名清單**，不是模糊比對。試過用「列名與章名的共同字」自動判斷，
 *   但正確答案（例如「要交報表」→「成果交付與批次輸出」）本來就沒有共同字，
 *   自動判斷會把對的判成錯的——那就是一個會誤報的守門。
 *   所以改成：章名關鍵詞寫在這裡，章號從手冊現場算。章節搬動時這一支會紅，
 *   紅的時候把關鍵詞對應到新的章號即可。
 */
test("手冊裡的「第 N 章」必須存在，導讀表也必須指到對的章", async () => {
  const manual = await readFile(
    new URL("../scripts/manual/manual.html", import.meta.url),
    "utf8",
  );
  const chapters = new Map(
    [
      ...manual.matchAll(
        /<h2 class="sec"><span class="n">(\d+)\.<\/span>([^<]*)/g,
      ),
    ].map((m) => [Number(m[1]), m[2]]),
  );
  /* 前置檢查：章號抓得到。 */
  assert.ok(
    chapters.size >= 15,
    `只抓到 ${chapters.size} 章——手冊結構改了嗎？這一支靠它當基準`,
  );

  /*
   * ── ① 引用的章號都要存在 ──
   *
   * ⚠️ 2026-09-25 第六輪：範圍從「只掃手冊」擴到**交付包裡會引用章號的每一份
   *   文件**。手冊以外的文件（驗證報告、更新說明）同樣寫著「手冊第 N 章」，
   *   而它們完全不在守備範圍——章節搬動時只有手冊內部會紅。
   */
  const DOCS = {
    "scripts/manual/manual.html": manual,
    "VALIDATION_REPORT.md": await readFile(
      new URL("../VALIDATION_REPORT.md", import.meta.url),
      "utf8",
    ),
    "PROJECT_HANDOFF.md": await readFile(
      new URL("../PROJECT_HANDOFF.md", import.meta.url),
      "utf8",
    ),
    "【更新說明】請先讀我.txt": await readFile(
      new URL("../【更新說明】請先讀我.txt", import.meta.url),
      "utf8",
    ),
  };
  const outOfRange = [];
  let citations = 0;
  for (const [name, text] of Object.entries(DOCS)) {
    const plainText = text.replace(/<[^>]+>/g, "");
    for (const m of plainText.matchAll(
      /第\s*(\d+)\s*(?:[～~、,，]\s*(\d+)\s*)?章/g,
    ))
      for (const raw of [m[1], m[2]]) {
        if (!raw) continue;
        citations += 1;
        if (!chapters.has(Number(raw))) outOfRange.push(`${name}：第 ${raw} 章`);
      }
  }
  /* 前置檢查：真的掃到一批引用，不是正規式壞掉之後安靜恆真。 */
  assert.ok(citations >= 10, `只掃到 ${citations} 個章號引用——正規式壞了嗎？`);
  assert.deepEqual(
    outOfRange,
    [],
    `這些地方指到不存在的章（手冊共 ${chapters.size} 章）：\n  ` +
      outOfRange.join("\n  "),
  );

  /*
   * ── ①-b 指名主題的引用，必須落在標題含那個主題的那一章 ──
   *
   * ⚠️ 光驗「章號存在」抓不到「號碼存在但指錯章」——第五輪那四處全都是
   *   存在的章號。主題關鍵詞寫死在這裡（不從文件反推，反推就永遠相符）。
   */
  const TOPICS = [
    ["備份", "備份"],
    ["結論草稿", "結論草稿"],
    ["成果交付", "成果交付"],
    ["認識畫面", "認識畫面"],
  ];
  const misdirected = [];
  for (const [topic, titleKeyword] of TOPICS) {
    const want = [...chapters].find(([, title]) => title.includes(titleKeyword));
    assert.ok(want, `手冊裡找不到標題含「${titleKeyword}」的章`);
    /*
     * ⚠️ 數字可能被 Markdown 粗體包起來（`第 **18** 章`）。
     *   姊妹系統交通服務水準 2026-09-25 發現原本的樣式抓不到那種寫法，
     *   於是帶粗體的章號引用完全不在守備範圍；三支同步補上。
     */
    const NUM = "\\*{0,2}(\\d+)\\*{0,2}";
    const re = new RegExp(
      `第\\s*${NUM}\\s*章[^。\\n]{0,10}${topic}|${topic}[^。\\n]{0,10}第\\s*${NUM}\\s*章`,
      "g",
    );
    for (const [name, text] of Object.entries(DOCS)) {
      const plainText = text.replace(/<[^>]+>/g, "");
      for (const m of plainText.matchAll(re)) {
        const got = Number(m[1] ?? m[2]);
        if (got !== want[0])
          misdirected.push(
            `${name}：「${topic}」寫成第 ${got} 章，實際第 ${want[0]} 章（${want[1]}）`,
          );
      }
    }
  }
  assert.deepEqual(misdirected, [], `章號指錯章：\n  ${misdirected.join("\n  ")}`);

  /* ── ② 導讀表每一列指到的章，章名要含這些關鍵詞 ── */
  const EXPECT = [
    { row: "完全沒概念", must: ["這個系統在做什麼", "名詞", "認識畫面"] },
    { row: "今天就要把一季資料做完", must: ["第一次使用"] },
    { row: "匯入時跳出警告", must: ["匯入資料", "資料維護"] },
    { row: "想看懂畫面上那些數字", must: ["流量", "尖峰彙總", "核對", "轉向圖", "分析頁面"] },
    { row: "要交報表、要寫報告文字", must: ["成果交付", "結論草稿"] },
    { row: "換電腦、資料不見了、卡住了", must: ["備份", "常見問題"] },
  ];
  for (const { row, must } of EXPECT) {
    const re = new RegExp(
      `<td class="k">${row}[^<]*</td><td>第\\s*(\\d+)(?:\\s*[～~、,，]\\s*(\\d+))?\\s*章`,
    );
    const hit = manual.match(re);
    assert.ok(hit, `導讀表裡找不到「${row}」那一列——列名改了就要一起改這一支`);
    const from = Number(hit[1]);
    const to = hit[2] ? Number(hit[2]) : from;
    const titles = [];
    for (let n = from; n <= to; n += 1) titles.push(chapters.get(n) ?? "");
    const joined = titles.join("｜");
    assert.ok(
      must.some((k) => joined.includes(k)),
      `導讀表「${row}」指到第 ${hit[0].includes("～") ? `${from}～${to}` : from} 章，`
        + `而那幾章是「${joined}」——裡面沒有 ${must.join("／")} 任何一個`,
    );
  }
});

test("手冊不可以叫使用者去一個不存在的畫面", async () => {
  /*
   * ⚠️ 2026-09-25 第六輪抓到（而且是**我自己上一版新寫的句子**）：
   *   手冊寫「您可以從『匯入紀錄』看到每一筆是什麼時候匯的」——
   *   「匯入紀錄」是**姊妹系統（交通服務水準）**的頁面，這一支沒有，
   *   而且這一支從頭到尾沒有任何畫面會顯示 `importedAt`。
   *   使用者照著找會找不到，然後懷疑是自己的問題。
   *
   * 守法：把 `NAV` 的 `label` 與各 `sections[].label` 當成「合法的畫面名」，
   *   手冊裡凡是用「去／到／從／點開／切到『X』」這種**導引句型**提到的名字，
   *   都必須在那份清單裡。
   *
   * ⚠️ 只掃導引句型，不掃所有的「」：手冊裡大量的「」是欄名、選項、
   *   狀態字與名詞解釋，把它們一起要求成畫面名會在正確的手冊上變紅。
   */
  const app = await readFile(
    new URL("../app/traffic-app.tsx", import.meta.url),
    "utf8",
  );
  const navBlock = app.match(/const NAV: \{[\s\S]*?\n\}\[\] = \[[\s\S]*?\n\];/);
  assert.ok(navBlock, "找不到 NAV 的定義——選擇器要跟著改，不可以讓這一支變恆真");
  const pages = new Set(
    [...navBlock[0].matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]),
  );
  assert.ok(
    pages.size >= 20,
    `只抓到 ${pages.size} 個畫面名——NAV 的寫法改了嗎？`,
  );
  /* 前置檢查：抓到的真的是畫面名。 */
  for (const must of ["總覽儀表板", "季度批次匯入"])
    assert.ok(pages.has(must), `畫面名清單裡沒有「${must}」，抓錯地方了`);

  const GUIDE = /(?:去|到|從|點開|切到|切換到|回到)\s*「([^」\n]{2,14})」/g;
  /*
   * 白名單：這些不是畫面名，但會出現在導引句型裡（區名、瀏覽器的東西、檔案）。
   * ⚠️ 加東西進來之前先確認它真的不是畫面——白名單是這一支唯一的漏洞來源。
   */
  const NOT_A_PAGE = new Set([
    "建立與匯入",
    "參數設定",
    "資料檢視",
    "圖表",
    "產出與維護",
    "主工具列",
    "上一步",
    "下一步",
    "原始檔",
    "另存新檔",
    "列印",
    "更新說明",
  ]);
  const bad = [];
  for (const m of manual.matchAll(GUIDE)) {
    const name = m[1];
    if (pages.has(name) || NOT_A_PAGE.has(name)) continue;
    /*
     * 單位不是畫面名：「從「PCU/hr」改成「輛/hr」」會落進導引句型。
     * 畫面名裡沒有斜線，用這一點排掉就好，不必把每個單位列成白名單。
     */
    if (/[/／]/.test(name)) continue;
    bad.push(name);
  }
  assert.deepEqual(
    [...new Set(bad)],
    [],
    "手冊用「去／到／從…『X』」的句型指到這些不存在的畫面：\n  " +
      [...new Set(bad)].join("、") +
      "\n（真的是畫面就去 NAV 補；不是畫面請改寫句子，或加進這一支的白名單並寫明理由）",
  );
});

test("手冊寫的轉向圖「顯示」模式數量要等於程式的 DisplayMode 數量", async () => {
  /*
   * ⚠️ 2026-09-25 第六輪抓到：手冊寫「要顯示 PCU、車輛數、百分比，或兩者並列」——
   *   程式有**五種**（volume／count／percent／both／countPercent），
   *   而且選單上的第一種叫「交通量」不叫「PCU」，「兩者並列」其實是**兩種**
   *   不同的模式（PCU＋百分比、輛＋百分比）。使用者照手冊找不到自己要的那一種。
   *
   * 數量從 `type DisplayMode` 的聯集數出來，不在測試裡寫死。
   */
  const app = await readFile(
    new URL("../app/traffic-app.tsx", import.meta.url),
    "utf8",
  );
  const union = app.match(/type DisplayMode =([^;]+);/);
  assert.ok(union, "找不到 type DisplayMode 的定義");
  const modes = [...union[1].matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.ok(modes.length >= 4, `只數到 ${modes.length} 種模式——型別寫法改了嗎？`);
  const CJK = ["零", "一", "兩", "三", "四", "五", "六", "七", "八"];
  const row = manual.match(/<td class="k">顯示<\/td><td>([\s\S]*?)<\/td>/);
  assert.ok(row, "手冊第 14 章找不到「顯示」那一列");
  assert.match(
    row[1],
    new RegExp(`共(?:<[^>]+>|[^<]){0,12}?(?:${modes.length}|${CJK[modes.length]})種`),
    `手冊沒有寫出「共${CJK[modes.length]}種」——程式實際有 ${modes.length} 種（${modes.join("／")}）`,
  );
  /* 反面：五種模式在畫面上的關鍵字都要出現，光寫對數量不算。 */
  for (const word of ["交通量", "車輛數", "百分比"])
    assert.match(row[1], new RegExp(word), `手冊的「顯示」說明沒有提到「${word}」`);
});
