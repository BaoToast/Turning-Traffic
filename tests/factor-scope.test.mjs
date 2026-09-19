/*
 * ══════════════════════════════════════════════════════════════════
 *  係數適用範圍：解析順位與「不設定就完全無感」
 * ══════════════════════════════════════════════════════════════════
 *
 * 這一支守的是**每一個 PCU 數字的來源**。判斷錯一次，畫面、Excel、
 * 報告草稿、歷季趨勢會一起錯，而且錯得很安靜——數字看起來都很合理。
 *
 * A 段最重要：**沒有任何覆寫時，行為必須與改版前一模一樣。**
 * 使用者的原話是「初始的預設自然是設定一次，套用全季度＋全路段」，
 * 也就是說現有行為就是最粗的那一層。做不到這一點，就是拿一個全新的
 * 複雜度去換一個他還沒要用的彈性。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ANY,
  conflictsIn,
  hasAnyScope,
  ownScope,
  pickProjects,
  removeScope,
  resolveFactors,
  resolveFactorsWithTier,
  scopeLabel,
  upsertScope,
} from "../lib/factor-scope.ts";

/* 用可辨識的假係數，看得出到底命中了哪一組。 */
const DEFAULT = { tag: "計畫預設" };
const Q_ROAD = { tag: "這一季這一段" };
const Q_ANY = { tag: "這一季全路段" };
const ANY_ROAD = { tag: "全季別這一段" };

const scope = (quarter, roadId, factors) => ({ quarter, roadId, factors });

/* ── A. 沒有覆寫時完全無感 ──────────────────────────────────── */

test("A1 ⚠️ 沒有任何覆寫時，回傳的必須是**同一個物件**，不是複製品", () => {
  /*
   * 複製的話，任何「這一筆是不是用預設係數」的比較（=== 或 JSON 簽章）
   * 都會變成 false，畫面會開始說「這一季有專屬係數」——而其實沒有。
   * Excel 的「共用到 N 組不同的當量矩陣」也會從 1 變成 N。
   */
  for (const empty of [null, undefined, []])
    assert.equal(
      resolveFactors(empty, DEFAULT, "115Q2", "R-01"),
      DEFAULT,
      `scopes=${JSON.stringify(empty)} 時沒有回傳原物件`,
    );
});

test("A2 沒有覆寫時，任何季別 × 任何路段都拿到同一組", () => {
  const seen = new Set();
  for (const quarter of ["111Q3", "113Q1", "115Q2", ""])
    for (const road of ["R-01", "R-99", ""])
      seen.add(resolveFactors([], DEFAULT, quarter, road));
  assert.equal(seen.size, 1);
  assert.equal([...seen][0], DEFAULT);
});

test("A3 hasAnyScope 要能分辨「完全沒設定」", () => {
  assert.equal(hasAnyScope(null), false);
  assert.equal(hasAnyScope([]), false);
  assert.equal(hasAnyScope([scope("115Q2", ANY, Q_ANY)]), true);
});

/* ── B. 解析順位 ────────────────────────────────────────────── */

test("B1 順位 1：(這一季, 這一段) 蓋過其他全部", () => {
  const scopes = [
    scope(ANY, "R-01", ANY_ROAD),
    scope("115Q2", ANY, Q_ANY),
    scope("115Q2", "R-01", Q_ROAD),
  ];
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-01"), Q_ROAD);
});

test("B2 順位 2：(這一季, 全路段) 蓋過 (全季別, 這一段)——**季別優先**", () => {
  /*
   * 這正是使用者的情境沒有涵蓋到、我選的那一條。
   * 理由：標準改版通常是外部規定，一改就是全部都改；
   * 而路段專屬值是使用者為了某一段自己調的，新標準下本來就該重做。
   * ⚠️ 但這種重疊一定要被 conflictsIn() 挑出來（見 D 段）。
   */
  const scopes = [scope(ANY, "R-01", ANY_ROAD), scope("115Q2", ANY, Q_ANY)];
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-01"), Q_ANY);
});

test("B3 順位 3：只有 (全季別, 這一段) 時就用它", () => {
  const scopes = [scope(ANY, "R-01", ANY_ROAD)];
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-01"), ANY_ROAD);
  /* 別的路段不受影響。 */
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-02"), DEFAULT);
});

test("B4 順位 4：都沒命中就回計畫預設", () => {
  const scopes = [scope("114Q1", "R-09", Q_ROAD)];
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-01"), DEFAULT);
});

test("B5 命中的順位要講得出來（摘要與提示靠它）", () => {
  const scopes = [
    scope(ANY, "R-01", ANY_ROAD),
    scope("115Q2", ANY, Q_ANY),
    scope("115Q2", "R-01", Q_ROAD),
  ];
  assert.equal(
    resolveFactorsWithTier(scopes, DEFAULT, "115Q2", "R-01").tier,
    "quarter-road",
  );
  assert.equal(
    resolveFactorsWithTier(scopes, DEFAULT, "115Q2", "R-02").tier,
    "quarter-any",
  );
  assert.equal(
    resolveFactorsWithTier(scopes, DEFAULT, "114Q1", "R-01").tier,
    "any-road",
  );
  assert.equal(
    resolveFactorsWithTier(scopes, DEFAULT, "114Q1", "R-02").tier,
    "project-default",
  );
});

/* ── C. 互不干擾 ────────────────────────────────────────────── */

test("C1 ⚠️ 季別之間不可以互相干擾", () => {
  const scopes = [scope("115Q2", ANY, Q_ANY)];
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-01"), Q_ANY);
  for (const other of ["115Q1", "115Q3", "114Q4", "111Q3"])
    assert.equal(
      resolveFactors(scopes, DEFAULT, other, "R-01"),
      DEFAULT,
      `${other} 被 115Q2 的設定汙染了`,
    );
});

test("C2 ⚠️ 路段之間不可以互相干擾", () => {
  const scopes = [scope(ANY, "R-01", ANY_ROAD)];
  for (const other of ["R-02", "R-10", "R-011", "r-01"])
    assert.equal(
      resolveFactors(scopes, DEFAULT, "115Q2", other),
      DEFAULT,
      `${other} 被 R-01 的設定汙染了`,
    );
});

test("C3 ⚠️ 路段代碼是**完全比對**，不可以用前綴比對", () => {
  /*
   * 「R-1」若用 startsWith 去比，會連 R-10、R-11、R-12 一起吃掉。
   * 這種錯不會有人發現——那幾段路的 PCU 只是「有點不一樣」。
   */
  const scopes = [scope(ANY, "R-1", ANY_ROAD)];
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-1"), ANY_ROAD);
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-10"), DEFAULT);
});

test("C4 ⚠️ 計畫之間不可以互相干擾（匯出備份時）", () => {
  const byProject = {
    "P-1": [scope("115Q2", ANY, Q_ANY)],
    "P-2": [scope(ANY, "R-01", ANY_ROAD)],
  };
  const picked = pickProjects(byProject, ["P-1"]);
  assert.deepEqual(Object.keys(picked), ["P-1"]);
  /* 全部匯出時兩個都在。 */
  assert.deepEqual(Object.keys(pickProjects(byProject, null)).sort(), [
    "P-1",
    "P-2",
  ]);
});

/* ── D. 衝突要看得見 ────────────────────────────────────────── */

test("D1 兩個維度重疊時要被標成衝突", () => {
  const scopes = [scope(ANY, "R-01", ANY_ROAD), scope("115Q2", ANY, Q_ANY)];
  const found = conflictsIn(scopes);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], {
    quarter: "115Q2",
    roadId: "R-01",
    winner: "quarter-any",
    loser: "any-road",
  });
});

test("D2 ⚠️ 已經有明確設定的那一格**不算**衝突", () => {
  /* 使用者已經自己講清楚了，就沒有「不知道用哪一組」的問題。 */
  const scopes = [
    scope(ANY, "R-01", ANY_ROAD),
    scope("115Q2", ANY, Q_ANY),
    scope("115Q2", "R-01", Q_ROAD),
  ];
  assert.deepEqual(conflictsIn(scopes), []);
});

test("D3 沒有重疊就沒有衝突（不可以無中生有）", () => {
  assert.deepEqual(conflictsIn([]), []);
  assert.deepEqual(conflictsIn([scope("115Q2", ANY, Q_ANY)]), []);
  assert.deepEqual(conflictsIn([scope(ANY, "R-01", ANY_ROAD)]), []);
  assert.deepEqual(
    conflictsIn([scope("115Q2", "R-01", Q_ROAD)]),
    [],
    "明確設定單獨存在時不該算衝突",
  );
});

test("D4 多對多的重疊要全部列出來", () => {
  const scopes = [
    scope(ANY, "R-01", ANY_ROAD),
    scope(ANY, "R-02", ANY_ROAD),
    scope("115Q1", ANY, Q_ANY),
    scope("115Q2", ANY, Q_ANY),
  ];
  const found = conflictsIn(scopes);
  assert.equal(found.length, 4, "2 季 × 2 段 應該要有 4 格重疊");
});

/* ── E. 寫入與刪除 ──────────────────────────────────────────── */

test("E1 ⚠️ 同一格重複寫入是**取代**，不是累加", () => {
  /*
   * 累加的話同一格會有兩筆，摘要列出兩列一模一樣的範圍，
   * 使用者刪掉其中一列卻發現值沒變。
   */
  let scopes = [];
  scopes = upsertScope(scopes, scope("115Q2", "R-01", { tag: "第一次" }));
  scopes = upsertScope(scopes, scope("115Q2", "R-01", { tag: "第二次" }));
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0].factors.tag, "第二次");
});

test("E2 不同格各自獨立", () => {
  let scopes = [];
  scopes = upsertScope(scopes, scope("115Q2", "R-01", Q_ROAD));
  scopes = upsertScope(scopes, scope("115Q2", "R-02", Q_ANY));
  scopes = upsertScope(scopes, scope(ANY, "R-01", ANY_ROAD));
  assert.equal(scopes.length, 3);
});

test("E3 刪除一格＝那一格還原成預設，其他格不受影響", () => {
  let scopes = [
    scope("115Q2", "R-01", Q_ROAD),
    scope("115Q2", "R-02", Q_ANY),
  ];
  scopes = removeScope(scopes, "115Q2", "R-01");
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-01"), DEFAULT);
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-02"), Q_ANY);
});

test("E4 ownScope 只回「這一格自己的」，不繼承", () => {
  const scopes = [scope("115Q2", ANY, Q_ANY)];
  /* 這一格有自己的設定。 */
  assert.equal(ownScope(scopes, "115Q2", ANY)?.factors, Q_ANY);
  /* 這一格是**繼承**來的，不是自己的——編輯畫面要顯示成「尚未設定」。 */
  assert.equal(ownScope(scopes, "115Q2", "R-01"), null);
});

test("E5 upsert／remove 不可以就地改動原陣列（React state 會不更新）", () => {
  const original = [scope("115Q2", "R-01", Q_ROAD)];
  const frozen = JSON.stringify(original);
  upsertScope(original, scope("114Q1", ANY, Q_ANY));
  removeScope(original, "115Q2", "R-01");
  assert.equal(JSON.stringify(original), frozen, "原陣列被就地改掉了");
});

/* ── F. 標籤 ────────────────────────────────────────────────── */

test("F1 範圍標籤要看得懂，而且全系統只有一種寫法", () => {
  assert.equal(scopeLabel(ANY, ANY), "全季別 × 全路段");
  assert.equal(scopeLabel("115Q2", ANY), "115Q2 × 全路段");
  assert.equal(scopeLabel(ANY, "R-01"), "全季別 × R-01");
  assert.equal(scopeLabel("115Q2", "R-01", "示範一路口"), "115Q2 × 示範一路口");
});
