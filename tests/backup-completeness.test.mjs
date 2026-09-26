/*
 * 備份必須收齊使用者自己設定的每一樣東西，而且**依計畫分開收**。
 *
 * 起因是姊妹專案（全日交通量、交通服務水準）踩到的坑：結論草稿的條件範本
 * 存在本機，但匯出的備份沒有收，換一台電腦匯入之後範本一個都不剩，
 * 而畫面只會說匯入成功。功能測試完全驗不出這種事——匯出成功、匯入成功、
 * 每一支測試都是綠的，少收一樣東西不會讓任何斷言失敗。
 *
 * 本程式後來又發現第二層：範本雖然有收，但**沒有依計畫分開**，
 * 所有計畫共用同一份清單（v2.1.24 修正）。這一支同時把兩件事釘住。
 *
 * 作法是「清單比對」：把屬於使用者設定的鍵列出來，逐一確認
 * 存檔、備份匯出、還原三個地方都有它。日後新增設定卻忘了收進備份，
 * 這裡就會失敗。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../app/traffic-app.tsx", import.meta.url),
  "utf8",
);

/**
 * 使用者會自己調整、換電腦時應該一起帶走的東西。
 * 純衍生資料（可由 records 重算的）不列在這裡。
 */
const MUST_TRAVEL = [
  "projects",
  "records",
  "nameMap",
  "pceByProject",
  "catalogByProject",
  "mappingsByProject",
  "formatMemories",
  /* ⚠️ vehicleSchemes（車種歸類方案）已於 2026-09-15 移除，見 lib/final-features.ts。 */
  "reportTemplatesByProject",
  "conclusionTemplatesByProject",
  "recordRevisions",
  /*
   * 「這個轉向到底存不存在」的使用者裁決。沒收進備份的話，換一台電腦
   * 還原之後每一季匯入都會再問一次同樣的問題（那正是使用者抱怨過的事）。
   */
  "movementPresence",
  /* 使用者對多日期檔案指定的正式調查日期，以及明細欄顯示偏好。 */
  "surveyDateOverrides",
  "showSurveyDate",
  /*
   * 路口名稱別名（改名後的「舊名＝新名」）。
   * 沒帶走的話，換一台電腦之後每一季匯入都會重新問「這個路口要不要併入」——
   * 與上面那一條是同一類毛病，使用者兩次都親自撞到過。
   */
  "intersectionAliases",
  /*
   * 「已人工確認」的異常紀錄（2026-09-23 補）。
   *
   * ⚠️ 原本**整個沒有進備份**，兩條還原路徑也都不讀——而這一支
   *   「備份收齊了使用者的設定」照樣全綠，因為它比對的是**這份手寫清單**，
   *   而它不在清單裡。檔頭寫著「日後新增設定卻忘了收進備份，這裡就會失敗」，
   *   實際上失敗的前提是「有人記得同時把它加進清單」——
   *   **忘了加進備份的人，也會忘了加進清單**。
   *   所以下面另外補了一支「由 state 反推」的守門，這裡只是把它補齊。
   */
  "ackedIssues",
];

/** 每一項都必須是「每個計畫各自一份」，不可以是全機共用的一份。 */
const MUST_BE_PER_PROJECT = [
  "pceByProject",
  "catalogByProject",
  "mappingsByProject",
  "reportTemplatesByProject",
  "conclusionTemplatesByProject",
  "surveyDateOverrides",
  "ackedIssues",
];

/*
 * ══════════════════════════════════════════════════════════════════════
 *  鍵是「計畫id|其他」的複合鍵，要走 pickPrefixed() 而不是 pick()
 *  （2026-09-25 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 為什麼要分成兩張清單：pick() 比的是**整個鍵**等不等於計畫 id，
 *   對 `intersectionAliases`（鍵是 `計畫id|舊名`）**一個都篩不到**。
 *   原本 intersectionAliases 連 pick() 都沒有，而它也不在
 *   MUST_BE_PER_PROJECT 裡，所以上面那一條「都要用 pick()」照樣通過
 *   ——這正是這份手寫清單自己被繞過的實例。
 *
 * ⚠️ 新增「鍵帶計畫 id 前綴」的設定時，要加到**這一張**，不是上面那一張。
 */
const MUST_BE_PREFIX_PICKED = ["intersectionAliases"];

function block(startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `traffic-app.tsx 裡找不到 ${label} 的起點`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label} 之後找不到 ${endMarker}`);
  return source.slice(start, end);
}

test("存進瀏覽器的內容收齊了使用者的設定", () => {
  const saved = block(
    'kind: "TURNING_TRAFFIC_STATE"',
    /*
     * v2.1.53 起存檔改走 saveState()（IndexedDB），不再是
     * localStorage.setItem。這裡只是「存檔內容那一段」的結束標記，
     * 換成新的呼叫名稱即可，檢查的東西沒有變。
     */
    "saveState(",
    "存檔內容",
  );
  for (const key of MUST_TRAVEL)
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(saved),
      `存檔沒有收 ${key}——重新整理之後這一項會消失`,
    );
});

test("備份檔收齊了使用者的設定", () => {
  const backup = block(
    'kind: "TURNING_TRAFFIC_BACKUP"',
    "backupFileTag",
    "備份內容",
  );
  for (const key of MUST_TRAVEL)
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(backup),
      `備份沒有收 ${key}——換一台電腦還原之後這一項會消失`,
    );
});

test("每一項依計畫的設定，備份時都要用 pick() 篩出該計畫那一份", () => {
  /*
   * 單一計畫備份時，pick() 負責只帶走那個計畫的設定。
   * 少包一層 pick()，把 A 計畫的備份帶到 B 電腦就會連別的委託案的
   * 當量矩陣與範本一起搬過去。
   */
  const backup = block(
    'kind: "TURNING_TRAFFIC_BACKUP"',
    "backupFileTag",
    "備份內容",
  );
  for (const key of MUST_BE_PER_PROJECT)
    assert.match(
      backup,
      new RegExp(`${key}:\\s*pick\\(`),
      `備份裡的 ${key} 沒有經過 pick()`,
    );
  /*
   * ⚠️ 複合鍵那一類要走 pickPrefixed()。用 pick() 會篩成空的（更糟），
   *   什麼都不包則會夾帶別的委託案的資料。
   */
  for (const key of MUST_BE_PREFIX_PICKED) {
    assert.match(
      backup,
      new RegExp(`${key}:\\s*pickPrefixed\\(`),
      `備份裡的 ${key} 沒有經過 pickPrefixed()——` +
        `它的鍵是「計畫id|其他」，單一計畫匯出會夾帶別的委託案的資料`,
    );
    assert.ok(
      !new RegExp(`${key}:\\s*pick\\(`).test(backup),
      `${key} 用了 pick()——它的鍵是複合鍵，pick() 會把它篩成空的`,
    );
  }
});

test("pickPrefixed() 真的只留下指定計畫的複合鍵（不是形狀對就算）", () => {
  /*
   * ⚠️ 這一條是行為測試，不是掃字串：把 traffic-app.tsx 裡真正那一段
   *   pickPrefixed 切出來跑。只驗「有沒有寫 pickPrefixed(」的話，
   *   實作寫錯（例如比錯段落）照樣會綠。
   */
  const start = source.indexOf("const pickPrefixed = function");
  assert.notEqual(start, -1, "找不到 pickPrefixed——它被改名或刪掉了");
  const end = source.indexOf("\n    };", start);
  const body = source
    .slice(start, end + 7)
    .replace(/<T>/g, "")
    .replace(/: Record<string, T>/g, "")
    .replace(/map \|\| \{\}/g, "map || {}");
  const make = new Function(
    "scoped",
    "scopedIds",
    body + "\nreturn pickPrefixed;",
  );
  const pickPrefixed = make(true, new Set(["P1"]));
  const got = pickPrefixed({
    "P1|舊甲路口": "甲路口",
    "P2|舊乙路口": "乙路口",
    "P1|舊丙路口": "丙路口",
    沒有前綴的鍵: "x",
  });
  assert.deepEqual(
    got,
    { "P1|舊甲路口": "甲路口", "P1|舊丙路口": "丙路口" },
    "pickPrefixed() 篩出來的不是只有 P1 的別名",
  );
  const all = make(false, new Set(["P1"]));
  assert.equal(
    Object.keys(all({ "P1|a": 1, "P2|b": 2 })).length,
    2,
    "整機備份（scoped=false）不可以篩掉任何東西",
  );
});

test("兩種範本都是依計畫分開存，不是全機共用一份", () => {
  /*
   * v2.1.24 之前兩者都是扁平陣列：在甲計畫存的範本，切到乙計畫照樣列出來。
   * 結論條件裡存著 intersectionKeys 與 branchNames，那是該計畫專屬的識別字，
   * 套到別的計畫會篩出 0 筆而找不出原因。
   */
  for (const key of ["reportTemplates", "conclusionTemplates"]) {
    assert.match(
      source,
      new RegExp(
        `const \\[${key}ByProject, set${key[0].toUpperCase()}${key.slice(1)}ByProject\\] =?\\s*\\n?\\s*useState`,
      ),
      `${key} 沒有改成依計畫分開的 ${key}ByProject`,
    );
    assert.match(
      source,
      new RegExp(`const ${key} =\\s*\\n?\\s*${key}ByProject\\[activeProjectId\\]`),
      `${key} 沒有從目前計畫取值`,
    );
  }
});

test("舊版備份的扁平範本清單，還原時每個計畫各給一份", () => {
  /*
   * 這是使用者選定的遷移方式：什麼都不會不見。全部歸給某一個計畫的話，
   * 其他計畫就再也找不到過去存的範本了。
   */
  for (const key of ["reportTemplates", "conclusionTemplates"]) {
    assert.match(
      source,
      new RegExp(`${key}ByProject[\\s\\S]{0,200}?spread\\(`),
      `載入時沒有把舊版的 ${key} 分給每個計畫`,
    );
    assert.match(
      source,
      new RegExp(`${key}ByProject[\\s\\S]{0,200}?spreadToAll\\(`),
      `還原備份時沒有把舊版的 ${key} 分給每個計畫`,
    );
  }
});

test("存檔仍然寫出舊欄位，讓退版之後還讀得到東西", () => {
  const saved = block(
    'kind: "TURNING_TRAFFIC_STATE"',
    /*
     * v2.1.53 起存檔改走 saveState()（IndexedDB），不再是
     * localStorage.setItem。這裡只是「存檔內容那一段」的結束標記，
     * 換成新的呼叫名稱即可，檢查的東西沒有變。
     */
    "saveState(",
    "存檔內容",
  );
  for (const key of ["reportTemplates", "conclusionTemplates"])
    assert.match(
      saved,
      new RegExp(`\\n\\s*${key}: ${key},`),
      `存檔沒有保留舊欄位 ${key}`,
    );
});

test("調查日期指定在併入及完整取代兩條還原路徑都會恢復", () => {
  const restore = block(
    "async function restoreBackup(file: File)",
    "const allRecordsEmpty",
    "備份還原",
  );
  assert.equal(
    (restore.match(/setSurveyDateOverrides\(/g) || []).length,
    2,
    "surveyDateOverrides 沒有同時涵蓋併入與完整取代還原",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  A2／A3：「顯示調查日期」跟人走，不跟單一計畫備份走
 * ══════════════════════════════════════════════════════════════════════
 *
 * 它是「這台電腦這個人想不想看到那一欄」的顯示偏好，不是計畫資料。
 * v2.1.80 以前，併入**別人的**單一計畫備份會把這個開關整個翻掉，
 * 而且畫面上不會有任何提示。三支統一以交通服務水準的做法為準。
 *
 * ⚠️ 這條規則有兩半，缺一不可：
 *   ・單一計畫備份**不寫**這個欄位（不然舊版讀了照樣翻）
 *   ・併入路徑**不讀**這個欄位
 * 完整的個人全部計畫包仍然要寫、也要讀——那本來就是同一個人的東西。
 */
test("⚠️ 單一計畫備份不可以夾帶「顯示調查日期」", () => {
  assert.match(
    source,
    /\.\.\.\(scoped \? null : \{ showSurveyDate: showSurveyDate \}\)/,
    "單一計畫備份又把顯示偏好寫進去了——併入別人的備份會翻掉使用者的開關",
  );
});

test("⚠️ 併入路徑不可以讀「顯示調查日期」；完整還原才讀", () => {
  const restore = block(
    "async function restoreBackup(file: File)",
    "const allRecordsEmpty",
    "備份還原",
  );
  assert.equal(
    (restore.match(/setShowSurveyDate\(/g) || []).length,
    1,
    "顯示偏好又被併入路徑讀回去了（應該只有完整取代那一條會還原它）",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  A6：併入時同一個計畫的日期指定要**逐筆**合併
 * ══════════════════════════════════════════════════════════════════════
 *
 * 舊寫法 `{ ...existing, ...data.surveyDateOverrides }` 是淺層合併：
 * 備份裡有 P-1，本機 P-1 底下原有的其他日期指定就被整批換掉、**靜默消失**。
 * 同一支程式裡「紀錄」本身是逐筆合併的，兩個標準不一致的結果就是掉資料。
 */
test("⚠️ 併入備份不可以把同一個計畫的日期指定整批取代", () => {
  const restore = block(
    "async function restoreBackup(file: File)",
    "const allRecordsEmpty",
    "備份還原",
  );
  const merge = restore.slice(restore.indexOf("setSurveyDateOverrides("));
  assert.doesNotMatch(
    merge.slice(0, 1200),
    /return \{ \.\.\.existing, \.\.\.data\.surveyDateOverrides \};/,
    "又改回淺層合併——本機該計畫其他的日期指定會靜默消失",
  );
  assert.match(
    merge.slice(0, 1600),
    /merged\[projectId\] = \{ \.\.\.\(existing\[projectId\] \|\| \{\}\), \.\.\.picks \};/,
    "逐筆合併不見了",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ 清單不可以用手維護——這一支自己就是被那樣繞過去的
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-23 的獨立複查發現：`ackedIssues`（使用者一顆一顆按出來的
 * 「已人工確認」）**有進存檔、但完全沒進備份**，兩條還原路徑也都不讀。
 * 而上面那兩支「收齊了使用者的設定」照樣全綠——因為它比對的是
 * `MUST_TRAVEL` 這份**手寫清單**，而它不在清單裡。
 *
 * 檔頭寫著「日後新增設定卻忘了收進備份，這裡就會失敗」，
 * 實際上失敗的前提是「有人記得同時把它加進清單」。
 * **忘了加進備份的人，也會忘了加進清單。**
 *
 * 所以這一支改成從**存檔內容**反推：存檔收的每一個鍵，
 * 不是也進備份，就是必須列在下面的例外表裡並寫明理由。
 *
 * ⚠️ 為什麼用「存檔」當基準而不是 useState 清單：
 *   存檔（`kind: "TURNING_TRAFFIC_STATE"`）就是「重新整理之後還要在的東西」，
 *   那正好等於「換一台電腦之後還要在的東西」。畫面暫態不會進存檔，
 *   所以拿它當基準不會誤報一堆。
 */
function savedKeys() {
  const saved = block(
    'kind: "TURNING_TRAFFIC_STATE"',
    "saveState(",
    "存檔內容",
  );
  /* 只取「鍵: 值」那一層的鍵名，註解先剝掉。 */
  const body = saved.replace(/\/\*[\s\S]*?\*\//g, "");
  return [
    ...new Set(
      [...body.matchAll(/^\s{8}([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]),
    ),
  ];
}

/**
 * 存檔有收、但**刻意不進備份**的鍵，每一個都要寫理由。
 * ⚠️ 想讓這一支變綠而把一個鍵加到這裡時，請先問自己：
 *   使用者換一台電腦之後，這一項不見了他會不會覺得是 bug？
 *   會的話就是要收進備份，不是加到這張表。
 */
const DELIBERATELY_NOT_IN_BACKUP = {
  version: "存檔／備份各自的格式版本號，由寫檔那一端自己填，不是使用者的設定",
  savedAt: "存檔時間戳；備份用的是自己的 exportedAt",
};

test("⚠️ 存檔收的每一個鍵，不是也進備份就是列在例外表裡（清單由程式反推）", () => {
  const backup = block(
    'kind: "TURNING_TRAFFIC_BACKUP"',
    "backupFileTag",
    "備份內容",
  );
  const keys = savedKeys();
  assert.ok(
    keys.length >= 12,
    `只反推到 ${keys.length} 個鍵——抽取規則可能改壞了，這一支會安靜地變成恆真`,
  );
  /*
   * ⚠️ 註解一定要先剝掉。
   *   第一版沒剝，於是把 `ackedIssues: pick(ackedIssues)` 整行刪掉之後，
   *   這一條仍然是綠的——因為那一行上面的註解裡也寫著 ackedIssues。
   *   守門認得註解裡的字，就等於在守「有沒有人寫過說明」，不是守程式。
   */
  const body = backup.replace(/\/\*[\s\S]*?\*\//g, "");
  const missing = keys.filter(
    (key) =>
      !(key in DELIBERATELY_NOT_IN_BACKUP) &&
      /*
       * 用 `鍵:` 而不是整段搜尋，但**不限定行首**——
       * `showSurveyDate` 是寫成 `...(scoped ? null : { showSurveyDate: … })`
       * 的（顯示偏好只進「全部計畫」那一種包），不在行首。
       */
      !new RegExp(`\\b${key}:`).test(body),
  );
  assert.deepEqual(
    missing,
    [],
    "這幾樣重新整理之後留得住，但換一台電腦之後會不見：\n  " +
      missing.join("、") +
      "\n確定不該進備份的話，請加進 DELIBERATELY_NOT_IN_BACKUP 並寫明理由。",
  );
});

/*
 * 存檔有收、但**刻意不進備份**的鍵，理由寫在上面的 DELIBERATELY_NOT_IN_BACKUP。
 * 這一支確認那張表沒有和事實脫節。
 *
 * ⚠️ `version` 與 `activeProjectId` 在備份區塊裡也找得到，但意思不同：
 *   備份有它自己的 `version`，而 `activeProjectId` 出現在 pick() 的範圍判斷裡，
 *   不是「把使用者目前開著哪個計畫存進備份」。所以這一條只檢查
 *   **以 `鍵:` 形式出現在備份物件裡**的情形，不是整段文字搜尋。
 */
test("⚠️ 例外表裡不可以有真的被寫進備份物件的鍵（免得理由與事實對不上）", () => {
  const backup = block(
    'kind: "TURNING_TRAFFIC_BACKUP"',
    "backupFileTag",
    "備份內容",
  );
  const body = backup.replace(/\/\*[\s\S]*?\*\//g, "");
  const stale = Object.keys(DELIBERATELY_NOT_IN_BACKUP).filter(
    (key) =>
      /* version 兩邊各有自己的一個，不算脫節。 */
      key !== "version" && new RegExp(`^\\s{6}${key}:`, "m").test(body),
  );
  assert.deepEqual(
    stale,
    [],
    "例外表說這幾個不進備份，但備份物件裡確實寫了它們：" + stale.join("、"),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  匯出有帶、匯入沒讀，等於沒帶——**兩條還原路徑都要檢查**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 這支程式有兩條還原路徑：
 *   ・**併入**（單一計畫備份；只加不蓋，不動這台電腦上的其他計畫）
 *   ・**完整取代**（個人全部計畫包）
 *
 * 2026-09-23 之前 `ackedIssues` **兩條都不讀**，於是就算備份收了它也還不回來。
 *
 * ⚠️ `showSurveyDate` 是**刻意只在完整取代那一條**還原的：
 *   它是顯示偏好，併入別人的單一計畫備份時不可以翻掉本機的開關
 *   （never-revert-contract 第 22 條）。所以它在併入那一段必須是 0 次。
 *   這一條是**雙向**的：少了會出事，多了也會出事。
 */
function restoreBranches() {
  const start = source.indexOf("async function restoreBackup(");
  assert.notEqual(start, -1, "找不到 restoreBackup()");
  const split = source.indexOf("完整取代」這台電腦上目前的資料", start);
  assert.notEqual(split, -1, "找不到「完整取代」那一段的起點");
  const end = source.indexOf("\n  const allRecordsEmpty", split);
  assert.notEqual(end, -1, "找不到 restoreBackup() 的結尾");
  return { merge: source.slice(start, split), replace: source.slice(split, end) };
}

test("⚠️ 使用者親手按出來的東西，兩條還原路徑都要讀得回來", () => {
  const { merge, replace } = restoreBranches();
  assert.ok(merge.length > 500 && replace.length > 500, "切出來的區塊太短，切法可能壞了");
  for (const [setter, why] of [
    ["setAckedIssues", "按過的「已人工確認」"],
    ["setSurveyDateOverrides", "使用者指定的調查日期"],
    ["setMovementPresence", "「這個轉向存不存在」的裁決"],
    ["setIntersectionAliases", "路口名稱別名"],
  ]) {
    assert.ok(
      new RegExp(`\\b${setter}\\(`).test(merge),
      `「併入」那一條沒有還原 ${setter}（${why}）——備份帶了卻讀不回來`,
    );
    assert.ok(
      new RegExp(`\\b${setter}\\(`).test(replace),
      `「完整取代」那一條沒有還原 ${setter}（${why}）`,
    );
  }
});

test("⚠️ 顯示偏好刻意只在「完整取代」那一條還原，不可以被加進「併入」", () => {
  const { merge, replace } = restoreBranches();
  assert.ok(
    /\bsetShowSurveyDate\(/.test(replace),
    "「完整取代」那一條沒有還原 showSurveyDate",
  );
  assert.ok(
    !/\bsetShowSurveyDate\(/.test(merge),
    "「併入」那一條動到了 showSurveyDate——" +
      "使用者只是想拿一個計畫進來，開關卻被別人的習慣翻掉，而且沒有任何提示" +
      "（never-revert-contract 第 22 條，三支一致）",
  );
});
