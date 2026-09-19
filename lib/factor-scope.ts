/*
 * ══════════════════════════════════════════════════════════════════
 *  係數的適用範圍：依「季別 × 路段」覆寫
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-10 的需求（原話節錄）：
 *
 *   「我們調整好係數，是把這些係數套用到**這個計畫所有路段**。如果哪天同一個
 *     計畫，每個路段要分別設置當量係數、轉向當量係數，那反而辦不到了。
 *     是否能改成**預設全部路段都套用同一個係數**，然後在轉向係數管理分頁裡，
 *     可以指定不同路段，手動設定不同轉向係數？」
 *
 *   「考慮到可能標準如果在某一季做了改變……應該要增加一個條件，
 *     **『依照季別』去設置**。初始的預設自然是設定一次，套用全季度＋全路段。」
 *
 *   「**計畫和計畫之間不能彼此干擾，路段和路段之間，季別和季別之間都不能互相
 *     干擾**，且**這份設定要能被存檔匯出和匯入**。」
 *
 * ── 這一支只做一件事：回答「這一筆資料該用哪一組係數」 ──────────
 *
 * 刻意做成**純函式、不碰 React、不碰儲存**。理由：係數是每一個 PCU 數字的
 * 來源，這個判斷錯一次，畫面、Excel、報告草稿、歷季趨勢會一起錯，
 * 而且錯得很安靜（數字看起來都很合理）。所以它必須是可以單獨測到爛的東西。
 *
 * ⚠️ **最重要的一條不變量**：沒有任何覆寫時，`resolveFactors()` 回傳的
 *   就是原本那一組計畫預設係數，**一模一樣的物件參考**。
 *   也就是說這個改版對「還沒開始用範圍設定」的使用者是**完全無感**的。
 *   tests/factor-scope.test.mjs 的 A 段就是在守這一條。
 */

/** 萬用字元：代表「全季別」或「全路段」。 */
export const ANY = "*";

/** 一筆有適用範圍的係數設定。 */
export type FactorScope<TFactors> = {
  /** 季別；`"*"` 代表全季別。 */
  quarter: string;
  /** 路段／路口代碼；`"*"` 代表全路段。 */
  roadId: string;
  /** 這個範圍要套用的係數。 */
  factors: TFactors;
};

/** 一筆覆寫是怎麼命中的——摘要與衝突提示要用。 */
export type ScopeTier =
  | "quarter-road"
  | "quarter-any"
  | "any-road"
  | "project-default";

export const TIER_LABELS: Record<ScopeTier, string> = {
  "quarter-road": "這一季 × 這一路段",
  "quarter-any": "這一季 × 全路段",
  "any-road": "全季別 × 這一路段",
  "project-default": "全季別 × 全路段（計畫預設）",
};

/**
 * 解析順位——**由細到粗**，取第一個命中的。
 *
 * | 順位 | 範圍 | 意思 |
 * |---|---|---|
 * | 1 | (這一季, 這一段) | 這一季、這一段的專屬設定 |
 * | 2 | (這一季, 全部)   | 這一季標準改了 |
 * | 3 | (全季別, 這一段) | 這一段路型特殊 |
 * | 4 | 計畫預設         | **就是現在的行為** |
 *
 * ⚠️ 順位 2 蓋過順位 3（**季別優先**）。這是我選的，不是使用者指定的。
 *   理由：標準改版通常是外部規定，一改就是全部都改；而路段專屬值是使用者
 *   為了某一段自己調的，新標準下那個調整本來就該重做。
 *   ⚠️ 但**不可以默默套用**——`conflictsIn()` 會把這種重疊挑出來，
 *     由畫面明白寫出「目前套用的是哪一組」。
 *     看不見的優先順位，就是下一個「算出來的數字沒人解釋得了」。
 */
const TIER_ORDER: ScopeTier[] = ["quarter-road", "quarter-any", "any-road"];

function tierOf(scope: FactorScope<unknown>): ScopeTier {
  const anyQuarter = scope.quarter === ANY;
  const anyRoad = scope.roadId === ANY;
  if (!anyQuarter && !anyRoad) return "quarter-road";
  if (!anyQuarter) return "quarter-any";
  if (!anyRoad) return "any-road";
  return "project-default";
}

/** 這一筆覆寫適用於（季別, 路段）這一格嗎？ */
function matches(
  scope: FactorScope<unknown>,
  quarter: string,
  roadId: string,
): boolean {
  const quarterOk = scope.quarter === ANY || scope.quarter === quarter;
  const roadOk = scope.roadId === ANY || scope.roadId === roadId;
  return quarterOk && roadOk;
}

/**
 * 這一筆資料該用哪一組係數？
 *
 * @param scopes  這個計畫的所有覆寫（順序不影響結果，由順位決定）
 * @param projectDefault 計畫預設係數——**沒有覆寫時原樣回傳這一個**
 * @param quarter 這一筆的季別
 * @param roadId  這一筆的路段／路口代碼
 */
export function resolveFactors<TFactors>(
  scopes: FactorScope<TFactors>[] | null | undefined,
  projectDefault: TFactors,
  quarter: string,
  roadId: string,
): TFactors {
  return resolveFactorsWithTier(scopes, projectDefault, quarter, roadId)
    .factors;
}

/** 同上，但一併回傳「是靠哪一個順位命中的」，摘要與提示要用。 */
export function resolveFactorsWithTier<TFactors>(
  scopes: FactorScope<TFactors>[] | null | undefined,
  projectDefault: TFactors,
  quarter: string,
  roadId: string,
): { factors: TFactors; tier: ScopeTier; scope: FactorScope<TFactors> | null } {
  const list = scopes || [];
  for (const tier of TIER_ORDER) {
    /*
     * ⚠️ 同一個順位若有重複設定（同季同段被設了兩次），取**最後一筆**。
     *   理由：畫面上的編輯是「寫入這一格」，最後寫的就是使用者現在要的。
     *   真正該做的是不要讓重複發生——`upsertScope()` 負責這件事。
     */
    let hit: FactorScope<TFactors> | null = null;
    for (const scope of list)
      if (tierOf(scope) === tier && matches(scope, quarter, roadId))
        hit = scope;
    if (hit) return { factors: hit.factors, tier, scope: hit };
  }
  /*
   * ⚠️ 這裡一定要回傳**原本那個物件**，不可以複製。
   *   複製的話，任何「這一筆是不是用預設係數」的比較（=== 或簽章）
   *   都會變成 false，畫面會開始說「這一季有專屬係數」——而其實沒有。
   */
  return { factors: projectDefault, tier: "project-default", scope: null };
}

/**
 * 寫入一筆覆寫：同一格已經有了就取代，沒有才新增。
 *
 * ⚠️ 一定要「取代」不可以「累加」。累加的話同一格會有兩筆，
 *   摘要會列出兩列一模一樣的範圍，使用者刪掉其中一列卻發現值沒變。
 */
export function upsertScope<TFactors>(
  scopes: FactorScope<TFactors>[] | null | undefined,
  next: FactorScope<TFactors>,
): FactorScope<TFactors>[] {
  const list = (scopes || []).filter(function (scope) {
    return !(scope.quarter === next.quarter && scope.roadId === next.roadId);
  });
  return [...list, next];
}

/** 移除一筆覆寫（＝那一格「還原成預設」）。 */
export function removeScope<TFactors>(
  scopes: FactorScope<TFactors>[] | null | undefined,
  quarter: string,
  roadId: string,
): FactorScope<TFactors>[] {
  return (scopes || []).filter(function (scope) {
    return !(scope.quarter === quarter && scope.roadId === roadId);
  });
}

/** 取出某一格**自己**的設定（不套順位、不繼承）——編輯畫面要用。 */
export function ownScope<TFactors>(
  scopes: FactorScope<TFactors>[] | null | undefined,
  quarter: string,
  roadId: string,
): FactorScope<TFactors> | null {
  const list = (scopes || []).filter(function (scope) {
    return scope.quarter === quarter && scope.roadId === roadId;
  });
  return list.length ? list[list.length - 1] : null;
}

/** 摘要用的一列。 */
export type ScopeConflict = {
  quarter: string;
  roadId: string;
  /** 實際生效的那一筆是哪一個順位。 */
  winner: ScopeTier;
  /** 被蓋過去的那些順位。 */
  loser: ScopeTier;
};

/**
 * 找出「兩個維度打架」的格子。
 *
 * 會打架的只有這一種：
 *
 *     (全季別, A路段) = 機車 1.0     ← 因為 A 路段路型特殊
 *     (115Q2, 全路段) = 機車 0.8     ← 因為 115Q2 標準改了
 *                                       115Q2 的 A 路段到底是 1.0 還是 0.8？
 *
 * 依順位是 0.8（季別優先），但**使用者不會知道**，
 * 除非畫面明白寫出來。這一支就是把這種格子挑出來。
 *
 * ⚠️ 已經有 (115Q2, A路段) 明確設定的格子**不算衝突**——
 *   使用者已經自己講清楚了，那就沒有「不知道用哪一組」的問題。
 */
export function conflictsIn<TFactors>(
  scopes: FactorScope<TFactors>[] | null | undefined,
): ScopeConflict[] {
  const list = scopes || [];
  const quarterOnly = list.filter(function (scope) {
    return tierOf(scope) === "quarter-any";
  });
  const roadOnly = list.filter(function (scope) {
    return tierOf(scope) === "any-road";
  });
  const conflicts: ScopeConflict[] = [];
  for (const q of quarterOnly)
    for (const r of roadOnly) {
      if (ownScope(list, q.quarter, r.roadId)) continue;
      conflicts.push({
        quarter: q.quarter,
        roadId: r.roadId,
        winner: "quarter-any",
        loser: "any-road",
      });
    }
  return conflicts;
}

/** 這個計畫有沒有任何覆寫？（沒有＝行為與改版前完全相同） */
export function hasAnyScope<TFactors>(
  scopes: FactorScope<TFactors>[] | null | undefined,
): boolean {
  return Boolean(scopes && scopes.length);
}

/** 範圍的人話標籤，摘要與 Excel 都用這一支，避免兩處寫法不同。 */
export function scopeLabel(
  quarter: string,
  roadId: string,
  roadName?: string,
  /*
   * 「全部」那一欄要叫什麼。
   *
   * ⚠️ 三支程式的分析單位不同：全日交通量是**路段**，路口轉向是**路口**。
   *   寫死「全路段」的話，路口轉向的畫面上會出現「115Q2 × 全路段」，
   *   而那支程式從頭到尾沒有「路段」這個詞——使用者會以為那是另一個東西。
   */
  anyRoadLabel = "全路段",
): string {
  /*
   * ⚠️ 傳進來的 quarter 可能已經是**顯示用**的字（民國年／西元年由呼叫端
   *   決定），也可能是原始的儲存值。這一支只負責組字，不做轉換——
   *   轉換一旦在這裡也做一次，就會有兩個地方決定同一件事。
   */
  const quarterText = quarter === ANY ? "全季別" : quarter;
  const roadText = roadId === ANY ? anyRoadLabel : roadName || roadId;
  return `${quarterText} × ${roadText}`;
}

/**
 * 只保留指定計畫的覆寫——匯出備份時要用。
 *
 * ⚠️ 使用者明講「**計畫和計畫之間不能彼此干擾**」。
 *   匯出單一計畫的備份時若把別的計畫的覆寫也帶出去，
 *   還原到另一台電腦就會把別人的係數帶進去。
 */
export function pickProjects<TFactors>(
  byProject: Record<string, FactorScope<TFactors>[]> | null | undefined,
  projectIds: string[] | null,
): Record<string, FactorScope<TFactors>[]> {
  const source = byProject || {};
  if (!projectIds) return { ...source };
  const out: Record<string, FactorScope<TFactors>[]> = {};
  for (const id of projectIds) if (source[id]) out[id] = source[id];
  return out;
}
