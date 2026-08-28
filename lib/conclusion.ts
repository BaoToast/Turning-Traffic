/*
 * 結論草稿產生器（自訂條件）。
 *
 * 和 report-draft.ts 的分工：
 * ・report-draft.ts 寫的是「一份報告的固定章節」，段落與順序是排好的。
 * ・這一支寫的是「使用者自己挑條件」的結論——想只寫 115Q2 每個路口的
 *   駛入流量與百分比可以，想寫 114 年度四季的變化也可以。
 *
 * 這個檔案是**純文字產生器**：所有數字都由畫面端先算好再傳進來。
 * 這樣做的理由和報告草稿一樣——數字只能有一個來源。如果這裡自己再算一次，
 * 草稿寫的數字遲早會和畫面上、Excel 裡的不一樣，而且是在報告送出去之後
 * 才被發現。
 *
 * 單位規則（會直接影響能不能相加）：
 * ・PCU/hr 與 輛/hr 是「某一個特定小時」的率，只能在同一筆紀錄、同一個
 *   尖峰之內相加（各支線加總＝該路口總量）。
 * ・跨路口、跨季度一律不加總，只寫各自的值、最大／最小、平均與變動幅度。
 */

/*
 * 這裡刻意不從 lib/traffic 匯入型別：那一支會連帶把 xlsx 拉進來，
 * 而這個檔案是純文字產生器，測試要能單獨跑。三個鍵值必須和 lib/traffic
 * 的 PeakKey 一致——tests/conclusion.test.ts 有一項檢查釘住這件事。
 */
export type PeakKey = "AM" | "PM" | "DAY";

/** 可勾選的敘述指標。 */
export const CONCLUSION_METRICS = [
  { key: "inflowPcu", label: "各支線駛入流量（PCU/hr）" },
  { key: "outflowPcu", label: "各支線駛出流量（PCU/hr）" },
  { key: "inflowVehicles", label: "各支線駛入車輛數（輛/hr）" },
  { key: "outflowVehicles", label: "各支線駛出車輛數（輛/hr）" },
  /*
   * 佔比也拆成兩個方向（v2.1.25）。
   *
   * 舊版是一項 share，但輸出是 if / else if：有駛入資料就寫「佔駛入」，
   * 只有整筆沒有駛入時才改寫「佔駛出」。所以使用者**永遠拿不到駛出的佔比**，
   * 而且選項名稱只寫「佔路口總量百分比」，沒說是哪一個方向。
   *
   * 兩個方向的分母相同（都是路口總量，駛入合計＝駛出合計），
   * 但分子不同，數字差很多：實測某一筆 路口B 駛入 10.4%／駛出 27.6%。
   *
   * 舊的 share 仍然讀得懂：normalizeCondition 會把它換成 shareIn
   * （只換成駛入那一項，理由見 migrateMetrics 裡的註解），
   * 所以既有範本的草稿逐字不變。
   */
  { key: "shareIn", label: "各支線佔駛入路口總量百分比" },
  { key: "shareOut", label: "各支線佔駛出路口總量百分比" },
  { key: "total", label: "路口總流量與總車輛數" },
  { key: "peakHour", label: "尖峰時段（起訖時間）" },
  { key: "composition", label: "車種組成（輛數與百分比）" },
  /*
   * 駛入與駛出拆成兩個勾選項（v2.1.24）。
   *
   * 舊版是一項 branchComposition，一勾就是兩個方向都寫。使用者常常只需要
   * 其中一個方向，只能產生完再自己刪掉另一半。拆開之後兩個方向各自獨立。
   *
   * 舊的 branchComposition 仍然讀得懂：normalizeCondition 會把它展開成
   * 這兩項，所以既有的範本與備份套用之後輸出和以前完全一樣。
   */
  {
    key: "branchCompositionIn",
    label: "各支線各車種駛入車輛數（輛/調查時段）",
  },
  {
    key: "branchCompositionOut",
    label: "各支線各車種駛出車輛數（輛/調查時段）",
  },
  { key: "balance", label: "駛入／駛出平衡差值" },
  { key: "fullDay", label: "全日流量（輛／調查日）" },
  { key: "growth", label: "季度之間的變動幅度" },
  { key: "extremes", label: "範圍內的最大／最小路口" },
] as const;

export type ConclusionMetricKey = (typeof CONCLUSION_METRICS)[number]["key"];

export const DEFAULT_CONCLUSION_METRICS: ConclusionMetricKey[] = [
  "total",
  "inflowPcu",
  "shareIn",
  "peakHour",
];

export type ConclusionScope =
  | { kind: "quarter"; quarter: string }
  | { kind: "year"; year: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "project" };

export type ConclusionGrouping = "byIntersection" | "byQuarter" | "overall";

export type ConclusionCondition = {
  scope: ConclusionScope;
  peaks: PeakKey[];
  /** 空陣列＝全部路口。存的是 recordIntersectionKey。 */
  intersectionKeys: string[];
  /** 空陣列＝全部支線。存的是支線名稱。 */
  branchNames: string[];
  /** 空陣列＝全部資料別（平日／假日）。 */
  surveyTypes: string[];
  metrics: ConclusionMetricKey[];
  grouping: ConclusionGrouping;
  digits: number;
  /*
   * 「各支線各車種駛入／駛出車輛數」要用哪一種呈現方式，和「車種組成分析」
   * 頁面上每一條支線的下拉選單同一套：
   *   follow   ＝ 跟著車種組成分析頁上該支線目前設定的方式（預設）
   *   split    ＝ 一律分行車方向（駛出、駛入各寫一段）
   *   two-way  ＝ 一律雙向合計（駛出＋駛入寫成一段）
   * 這樣使用者在分析頁怎麼看，草稿就怎麼寫；要固定成同一種也可以。
   */
  branchCompositionMode: BranchCompositionMode;
};

/** 各支線各車種的呈現方式，對應車種組成分析頁的下拉選單。 */
export type BranchCompositionMode = "follow" | "split" | "two-way";

export const BRANCH_COMPOSITION_MODES: {
  key: BranchCompositionMode;
  label: string;
}[] = [
  { key: "follow", label: "跟著車種組成分析頁的設定" },
  { key: "split", label: "一律分行車方向（駛出／駛入分開）" },
  { key: "two-way", label: "一律雙向合計" },
];

export const DEFAULT_CONDITION: ConclusionCondition = {
  scope: { kind: "project" },
  peaks: ["AM", "PM"],
  intersectionKeys: [],
  branchNames: [],
  surveyTypes: [],
  metrics: DEFAULT_CONCLUSION_METRICS,
  grouping: "byIntersection",
  digits: 1,
  branchCompositionMode: "follow",
};

export type ConclusionTemplate = {
  id: string;
  name: string;
  condition: ConclusionCondition;
  savedAt: string;
};

/** 一條支線在某個尖峰的數字。null＝這份資料沒有這個欄位（不是 0）。 */
export type ConclusionBranch = {
  name: string;
  /*
   * 該支線「全調查時段」的逐車種輛數，分駛出與駛入兩組。
   * 來源是「車種組成分析」的『全調查時段道路方向車種數量』那張表
   * （surveyDirectionRows），單位是 輛／調查時段，不是 輛/hr——
   * 它統計的是整個調查期間，不能和尖峰小時的率混用。
   * 沒有逐流向的調查明細時為 null（不是 0）。
   */
  outboundByVehicleSafe: { label: string; count: number }[] | null;
  inflowByVehicleSafe: { label: string; count: number }[] | null;
  /** 同一張表的「雙向合計」列（駛出＋駛入）。 */
  twoWayByVehicleSafe: { label: string; count: number }[] | null;
  /**
   * 這條支線在「車種組成分析」頁上目前選的呈現方式。條件選 follow 時就用它，
   * 讓草稿寫出來的樣子和使用者在分析頁看到的一致。
   */
  directionDisplay: "split" | "two-way";
  inflowPcu: number | null;
  outflowPcu: number | null;
  inflowVehicles: number | null;
  outflowVehicles: number | null;
  /** 全日（輛／調查日），只有完整 24 小時的資料才有。 */
  inflowFullDayVehicles: number | null;
  outflowFullDayVehicles: number | null;
};

export type ConclusionPeakData = {
  /** 尖峰時段字樣，例如 07:15–08:15。 */
  window: string;
  totalPcu: number | null;
  totalVehicles: number | null;
  branches: ConclusionBranch[];
};

export type ConclusionRecord = {
  id: string;
  intersectionKey: string;
  station: string;
  name: string;
  quarter: string;
  surveyType: string;
  peaks: Partial<Record<PeakKey, ConclusionPeakData>>;
  /** 車種組成：整份調查（或退回 AM 尖峰）的輛數。 */
  composition: { label: string; count: number }[];
  compositionScope: string;
  compositionUnit: string;
  /** 沒有逐流向資料時，很多敘述都不能寫，要在文中講清楚。 */
  routeless: boolean;
};

export type ConclusionMeta = {
  projectName: string;
  systemVersion: string;
  /** 由畫面傳入，避免這支純函式碰時間（測試才能穩定）。 */
  generatedAt: string;
};

const PEAK_LABEL: Record<PeakKey, string> = {
  AM: "上午尖峰",
  PM: "下午尖峰",
  DAY: "全日尖峰小時",
};

function num(value: number | null | undefined, digits: number) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return Number(value).toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function whole(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return Math.round(value).toLocaleString("zh-TW");
}

function pct(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return value.toFixed(digits) + "%";
}

/** 民國年（三碼或兩碼）與西元年（四碼）都換算成可比較的數字。 */
export function quarterKey(quarter: string): number {
  const match = String(quarter || "").match(/^(\d{2,4})Q([1-4])$/);
  if (!match) return Number.NEGATIVE_INFINITY;
  const year = Number(match[1]);
  const gregorian = match[1].length === 4 ? year : year + 1911;
  return gregorian * 4 + Number(match[2]);
}

export function quarterYear(quarter: string): string {
  const match = String(quarter || "").match(/^(\d{2,4})Q[1-4]$/);
  return match ? match[1] : "";
}

/**
 * 舊的 `branchComposition` 展開成拆分後的兩個方向。
 *
 * v2.1.24 把「各支線各車種駛入／駛出車輛數」拆成駛入、駛出兩個獨立勾選項。
 * 使用者既有的條件範本、備份檔與正在編輯的條件裡都還存著舊的那一個鍵；
 * 舊鍵的意思本來就是「兩個方向都寫」，所以在這裡原地展開成兩項，
 * **套用舊範本產生的草稿與 v2.1.23 完全相同**。
 *
 * 展開而不是保留舊鍵，是為了讓後面的判斷只需要認得新的兩個鍵；
 * 否則每一處 wants() 都要記得同時檢查舊鍵，遲早會漏掉一處。
 */
function migrateMetrics(metrics: string[]): ConclusionMetricKey[] {
  const out: ConclusionMetricKey[] = [];
  const push = (key: ConclusionMetricKey) => {
    if (!out.includes(key)) out.push(key);
  };
  for (const key of metrics) {
    if (key === "branchComposition") {
      push("branchCompositionIn");
      push("branchCompositionOut");
    } else if (key === "share") {
      /*
       * 舊的 share 只展開成**駛入**那一項，不是兩項。
       *
       * 因為舊版的輸出是 if / else if：有駛入就寫「佔駛入」，
       * 只有整筆沒有駛入時才寫「佔駛出」。而 inflowPcu 是由
       * destinationFlowTotal() 算出來的，那支函式永遠回傳數字，
       * 所以「佔駛出」那一支其實是執行不到的死碼——一次都沒有被寫出來過。
       * 展開成兩項的話，既有範本的草稿會多出一段從來沒有過的「佔駛出」，
       * 那就不是「輸出不變」了。
       */
      push("shareIn");
    } else push(key as ConclusionMetricKey);
  }
  return out;
}

/**
 * 把外來的條件補成完整的形狀。
 *
 * 為什麼需要：條件範本是存進瀏覽器（也會隨備份檔帶到別台電腦）的，
 * 而這個結構會隨版本長出新欄位。舊版存下來的範本沒有後來新增的欄位，
 * 直接拿去用會在 `condition.surveyTypes.length` 這種地方丟
 * TypeError——而且它是在 render 期間被呼叫的，整個結論分頁會直接消失，
 * 不是按下「產生草稿」才出錯。
 *
 * 同一個系統的 lib/final-features.ts 早就為匯出項目清單做過同樣的事
 * （normalizeReportItems），這裡補上。
 */
export function normalizeCondition(
  condition: Partial<ConclusionCondition> | null | undefined,
): ConclusionCondition {
  const source = condition || {};
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  const scope = source.scope;
  const validScope =
    scope &&
    typeof scope === "object" &&
    ["quarter", "year", "range", "project"].includes((scope as { kind?: string }).kind || "");
  return {
    ...DEFAULT_CONDITION,
    ...source,
    scope: validScope ? (scope as ConclusionScope) : DEFAULT_CONDITION.scope,
    /*
     * 時段可以一個都不選 ＝「不敘述尖峰時段」，只寫全調查時段的數值
     * （例如只要各路口的車種組成那一行）。
     *
     * 所以這裡必須分清楚兩件事：
     *   ・欄位**根本沒有**（舊範本缺欄位）→ 補上預設的上午＋下午。
     *   ・欄位**有、但是空陣列**（使用者刻意兩個都不勾）→ 就是空的，
     *     不可以自作主張補回預設，否則使用者永遠取消不掉。
     * 舊寫法只看長度，兩種情況被當成同一件事。
     */
    peaks: Array.isArray(source.peaks)
      ? (list(source.peaks) as PeakKey[])
      : DEFAULT_CONDITION.peaks,
    intersectionKeys: list(source.intersectionKeys) as string[],
    branchNames: list(source.branchNames) as string[],
    surveyTypes: list(source.surveyTypes) as string[],
    metrics: migrateMetrics(list(source.metrics) as string[]),
    grouping: ["byIntersection", "byQuarter", "overall"].includes(
      String(source.grouping),
    )
      ? (source.grouping as ConclusionGrouping)
      : DEFAULT_CONDITION.grouping,
    /*
     * digits 要夾範圍。Number(null) 與 Number("") 都是 0（finite），所以
     * 存著 digits: null 的舊範本會變成 0 位小數而不是預設的 1；而 digits: 100
     * 會讓 toLocaleString({ minimumFractionDigits: 100 }) 直接丟 RangeError
     * ——那正是這支函式要防的「舊範本讓整個分頁消失」。
     */
    digits:
      source.digits === null ||
      source.digits === undefined ||
      !Number.isFinite(Number(source.digits))
        ? DEFAULT_CONDITION.digits
        : Math.min(4, Math.max(0, Math.round(Number(source.digits)))),
    branchCompositionMode: ["follow", "split", "two-way"].includes(
      String(source.branchCompositionMode),
    )
      ? (source.branchCompositionMode as BranchCompositionMode)
      : "follow",
  };
}

/** 依條件挑出要敘述的紀錄。純函式，可單獨測。 */
export function selectRecords(
  records: ConclusionRecord[],
  rawCondition: ConclusionCondition,
): ConclusionRecord[] {
  /* 舊版範本可能缺欄位，一律先補成完整形狀再用。 */
  const condition = normalizeCondition(rawCondition);
  const scope = condition.scope;
  return records
    .filter(function (record) {
      if (scope.kind === "quarter" && record.quarter !== scope.quarter)
        return false;
      if (scope.kind === "year" && quarterYear(record.quarter) !== scope.year)
        return false;
      if (scope.kind === "range") {
        const key = quarterKey(record.quarter);
        const from = quarterKey(scope.from);
        const to = quarterKey(scope.to);
        const low = Math.min(from, to);
        const high = Math.max(from, to);
        // 季度字樣看不懂時（例如 114Q9）一律保留，讓使用者自己看到，
        // 不要無聲地把資料濾掉。
        if (Number.isFinite(key) && key !== Number.NEGATIVE_INFINITY) {
          if (key < low || key > high) return false;
        }
      }
      if (
        condition.intersectionKeys.length &&
        !condition.intersectionKeys.includes(record.intersectionKey)
      )
        return false;
      if (
        condition.surveyTypes.length &&
        !condition.surveyTypes.includes(record.surveyType || "待設定")
      )
        return false;
      return true;
    })
    .sort(function (a, b) {
      const byQuarter = quarterKey(a.quarter) - quarterKey(b.quarter);
      if (byQuarter) return byQuarter;
      return a.station < b.station ? -1 : a.station > b.station ? 1 : 0;
    });
}

function branchesOf(peakData: ConclusionPeakData, condition: ConclusionCondition) {
  if (!condition.branchNames.length) return peakData.branches;
  return peakData.branches.filter(function (branch) {
    return condition.branchNames.includes(branch.name);
  });
}

function scopeLabel(scope: ConclusionScope, records: ConclusionRecord[]) {
  if (scope.kind === "quarter") return scope.quarter;
  if (scope.kind === "year") return scope.year + " 年度";
  if (scope.kind === "range") return scope.from + "～" + scope.to;
  const quarters = Array.from(new Set(records.map((r) => r.quarter))).sort(
    (a, b) => quarterKey(a) - quarterKey(b),
  );
  return quarters.length
    ? "全計畫（" + quarters[0] + "～" + quarters.at(-1) + "）"
    : "全計畫";
}

/** 一個路口、一個尖峰要寫出來的那幾行。 */
function describePeak(
  record: ConclusionRecord,
  peak: PeakKey,
  condition: ConclusionCondition,
): string[] {
  const data = record.peaks[peak];
  if (!data) return [`　${PEAK_LABEL[peak]}：這一筆沒有 ${peak} 尖峰資料。`];
  const lines: string[] = [];
  const wants = (key: ConclusionMetricKey) => condition.metrics.includes(key);
  const digits = condition.digits;

  const head: string[] = [PEAK_LABEL[peak]];
  if (wants("peakHour") && data.window) head.push(data.window);
  const headline: string[] = [];
  if (wants("total")) {
    if (data.totalPcu !== null)
      headline.push(`總流量 ${num(data.totalPcu, digits)} PCU/hr`);
    if (data.totalVehicles !== null)
      headline.push(`總車輛數 ${whole(data.totalVehicles)} 輛/hr`);
  }
  lines.push(
    `　${head.join(" ")}${headline.length ? "：" + headline.join("、") : "："}`,
  );

  const branches = branchesOf(data, condition);
  if (!branches.length) {
    lines.push("　　（所選支線在這一筆沒有資料。）");
    return lines;
  }
  if (record.routeless) {
    lines.push(
      "　　這一筆沒有逐流向（OD）資料，駛入／駛出無法分列，以下僅列可得的數值。",
    );
  }

  const showsBranchMetric =
    wants("inflowPcu") ||
    wants("outflowPcu") ||
    wants("inflowVehicles") ||
    wants("outflowVehicles") ||
    wants("shareIn") ||
    wants("shareOut") ||
    wants("balance") ||
    wants("fullDay") ||
    wants("branchCompositionIn") ||
    wants("branchCompositionOut");

  if (showsBranchMetric)
    for (const branch of branches) {
      const parts: string[] = [];
      if (wants("inflowPcu"))
        parts.push(`駛入 ${num(branch.inflowPcu, digits)} PCU/hr`);
      if (wants("outflowPcu"))
        parts.push(`駛出 ${num(branch.outflowPcu, digits)} PCU/hr`);
      if (wants("inflowVehicles"))
        parts.push(`駛入 ${whole(branch.inflowVehicles)} 輛/hr`);
      if (wants("outflowVehicles"))
        parts.push(`駛出 ${whole(branch.outflowVehicles)} 輛/hr`);
      /*
       * 佔比：兩個方向各自獨立，分母都是路口總量。
       *
       * 分母相同是對的——駛入合計與駛出合計必然相等（同一批車依終點重新
       * 分組，總量不變），所以兩者用同一個 totalPcu 當分母，加起來各自都是
       * 100%。差異全部來自分子：駛入多的支線不一定駛出也多，實測某一筆
       * 路口B 駛入 10.4%、駛出 27.6%。
       */
      if (wants("shareIn") || wants("shareOut")) {
        const total = data.totalPcu;
        const shareOf = (value: number | null) =>
          total && value !== null ? (value / total) * 100 : null;
        const inShare = shareOf(branch.inflowPcu);
        const outShare = shareOf(branch.outflowPcu);
        if (wants("shareIn") && inShare !== null)
          parts.push(`佔駛入 ${pct(inShare)}`);
        if (wants("shareOut") && outShare !== null)
          parts.push(`佔駛出 ${pct(outShare)}`);
      }
      if (wants("balance")) {
        if (branch.inflowPcu !== null && branch.outflowPcu !== null) {
          const diff = branch.inflowPcu - branch.outflowPcu;
          parts.push(
            `駛入減駛出 ${diff >= 0 ? "+" : ""}${num(diff, digits)} PCU/hr`,
          );
        } else parts.push("駛入減駛出 無法計算（缺少其中一側）");
      }
      if (wants("branchCompositionIn") || wants("branchCompositionOut")) {
        /*
         * 各車種的駛出／駛入輛數，單位是「輛／調查時段」——整個調查期間的
         * 累計，不是尖峰小時的率。所以每一行都把單位寫出來，避免有人拿它
         * 去和上面的 輛/hr 相比或相加。
         */
        const side = function (
          list: { label: string; count: number }[] | null,
          label: string,
        ) {
          if (!list) return `${label}各車種：這一筆沒有逐流向的調查明細`;
          const items = list.filter((item) => item.count > 0);
          if (!items.length) return `${label}各車種：調查時段內沒有車輛`;
          const sum = items.reduce((total, item) => total + item.count, 0);
          return (
            `${label}各車種：` +
            items
              .slice()
              .sort((a, b) => b.count - a.count)
              .map(
                (item) =>
                  `${item.label} ${whole(item.count)}（${pct(
                    sum ? (item.count / sum) * 100 : null,
                  )}）`,
              )
              .join("、") +
            `，合計 ${whole(sum)} 輛/調查時段`
          );
        };
        /*
         * 呈現方式：條件選 follow 時，用該支線在車種組成分析頁上的設定，
         * 使用者在那一頁怎麼看，草稿就怎麼寫。
         */
        const mode =
          condition.branchCompositionMode === "follow"
            ? branch.directionDisplay || "split"
            : condition.branchCompositionMode;
        /*
         * 「雙向合計」是把駛入與駛出加在一起寫成一段，只有兩個方向都要寫的
         * 時候才成立。使用者只勾其中一個方向時，合計那一段不是他要的數字
         * ——那會把另一個方向的車也算進去。所以只勾一邊時一律照該方向寫。
         */
        const bothSides = wants("branchCompositionIn") && wants("branchCompositionOut");
        if (mode === "two-way" && bothSides) {
          parts.push(side(branch.twoWayByVehicleSafe, "雙向合計"));
        } else {
          if (wants("branchCompositionIn"))
            parts.push(side(branch.inflowByVehicleSafe, "駛入"));
          if (wants("branchCompositionOut"))
            parts.push(side(branch.outboundByVehicleSafe, "駛出"));
        }
      }
      if (wants("fullDay")) {
        if (branch.inflowFullDayVehicles !== null)
          parts.push(`全日駛入 ${whole(branch.inflowFullDayVehicles)} 輛/調查日`);
        if (branch.outflowFullDayVehicles !== null)
          parts.push(`全日駛出 ${whole(branch.outflowFullDayVehicles)} 輛/調查日`);
        if (
          branch.inflowFullDayVehicles === null &&
          branch.outflowFullDayVehicles === null
        )
          parts.push("全日數值需要完整 24 小時調查資料，這一筆沒有");
      }
      lines.push(`　　${branch.name}：${parts.join("；")}`);
    }
  return lines;
}

function describeComposition(record: ConclusionRecord) {
  const total = record.composition.reduce((sum, item) => sum + item.count, 0);
  if (!total) return ["　車種組成：這一筆沒有可用的車種數量。"];
  const parts = record.composition
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .map(
      (item) =>
        `${item.label} ${whole(item.count)} ${record.compositionUnit}（${pct(
          (item.count / total) * 100,
        )}）`,
    );
  return [
    `　車種組成（${record.compositionScope}）：${parts.join("、")}；` +
      `合計 ${whole(total)} ${record.compositionUnit}。`,
  ];
}

/** 同一路口、同一尖峰跨季度的變動幅度——只有這種比較是有意義的。 */
/**
 * 「待設定」不是一種資料別，而是那一筆在匯入當下讀不出來。
 * 所以寫進正式文字時要講成「資料別未指定」，不能讓讀者以為是第三種調查類別。
 */
function surveyTypeText(record: ConclusionRecord) {
  const type = record.surveyType || "待設定";
  return type === "待設定" ? "資料別未指定" : type;
}

function quarterTag(record: ConclusionRecord) {
  return "・" + surveyTypeText(record);
}

/**
 * 季度變動要**在同一種資料別之內**比較。
 *
 * 為什麼一定要分開：同一個路口的同一季常常同時有平日與假日兩筆。
 * 只依季度排序的話，first/last 會跨到不同的資料別，寫出
 * 「上午尖峰總流量由 115Q1 的 3,000.0 PCU/hr 變為 115Q1 的 1,200.0 PCU/hr，
 * 減少 60.0%」——同一季自己跟自己比，而且比的是平日與假日。
 * 這句話會原封不動被貼進報告。
 *
 * 同一個系統的另外兩處早就是這樣做的（lib/final-features.ts 的
 * buildTrendSeries 以 surveyType 過濾；traffic 的同名函式分組鍵含 dayType），
 * 只有這裡漏掉。
 */
function growthBySurveyType(
  group: ConclusionRecord[],
  peaks: PeakKey[],
  digits: number,
) {
  const byType = new Map<string, ConclusionRecord[]>();
  for (const record of group) {
    const key = record.surveyType || "待設定";
    const bucket = byType.get(key);
    if (bucket) bucket.push(record);
    else byType.set(key, [record]);
  }
  const lines: string[] = [];
  for (const [type, records] of byType) {
    const inner = describeGrowth(records, peaks, digits);
    if (!inner.length) continue;
    /* 只有一種資料別時不必多一行標題，多一種才需要分清楚是哪一種。 */
    if (byType.size > 1)
      lines.push(
        `　（${type === "待設定" ? "資料別未指定" : type}）`,
      );
    lines.push(...inner);
  }
  if (!lines.length && group.length >= 2)
    lines.push(
      "　同一種資料別（平日／假日）之下不足兩季，未做季度比較" +
        "——季度變動只在同一種資料別之間計算，否則會變成拿假日跟平日相比。",
    );
  return lines;
}

function describeGrowth(
  group: ConclusionRecord[],
  peaks: PeakKey[],
  digits: number,
) {
  const lines: string[] = [];
  const ordered = group
    .slice()
    .sort((a, b) => quarterKey(a.quarter) - quarterKey(b.quarter));
  if (ordered.length < 2) return lines;
  for (const peak of peaks) {
    const points = ordered
      .map((record) => ({
        quarter: record.quarter,
        value: record.peaks[peak]?.totalPcu ?? null,
      }))
      .filter((point) => point.value !== null) as {
      quarter: string;
      value: number;
    }[];
    if (points.length < 2) continue;
    const first = points[0];
    const last = points.at(-1)!;
    const change = first.value ? (last.value / first.value - 1) * 100 : null;
    const peakPoint = points.reduce((best, point) =>
      point.value > best.value ? point : best,
    );
    lines.push(
      `　${PEAK_LABEL[peak]}總流量由 ${first.quarter} 的 ${num(first.value, digits)} PCU/hr ` +
        `變為 ${last.quarter} 的 ${num(last.value, digits)} PCU/hr，` +
        (change === null
          ? "起始季為 0，變動幅度無法以百分比表示"
          : `${change >= 0 ? "增加" : "減少"} ${Math.abs(change).toFixed(1)}%`) +
        `；期間最高為 ${peakPoint.quarter}（${num(peakPoint.value, digits)} PCU/hr）。`,
    );
  }
  return lines;
}

/** 範圍內誰最大誰最小——跨路口不可以相加，但可以比大小。 */
function describeExtremes(
  records: ConclusionRecord[],
  peaks: PeakKey[],
  digits: number,
) {
  const lines: string[] = [];
  for (const peak of peaks) {
    const points = records
      .map((record) => ({
        label: `${record.station} ${record.name}（${record.quarter}）`,
        value: record.peaks[peak]?.totalPcu ?? null,
      }))
      .filter((point) => point.value !== null) as {
      label: string;
      value: number;
    }[];
    if (points.length < 2) continue;
    const sorted = points.slice().sort((a, b) => b.value - a.value);
    const mean =
      points.reduce((sum, point) => sum + point.value, 0) / points.length;
    lines.push(
      `　${PEAK_LABEL[peak]}：最高為 ${sorted[0].label} ${num(sorted[0].value, digits)} PCU/hr，` +
        `最低為 ${sorted.at(-1)!.label} ${num(sorted.at(-1)!.value, digits)} PCU/hr，` +
        `${points.length} 筆平均 ${num(mean, digits)} PCU/hr。` +
        `（各路口的尖峰小時不一定相同，此處僅比較大小，不做加總。）`,
    );
  }
  return lines;
}

function recordTitle(record: ConclusionRecord) {
  const type = record.surveyType && record.surveyType !== "待設定"
    ? `・${record.surveyType}`
    : "";
  return `${record.quarter}　${record.station}　${record.name}${type}`;
}

/**
 * 產生結論草稿全文。
 *
 * @param records 已經算好數字的紀錄（畫面端提供）
 * @param condition 使用者勾選的條件
 * @param meta 計畫名稱、版本、產生時間
 */
export function buildConclusion(
  records: ConclusionRecord[],
  rawCondition: ConclusionCondition,
  meta: ConclusionMeta,
): string {
  /* 舊版範本可能缺欄位，一律先補成完整形狀再用（見 normalizeCondition）。 */
  const condition = normalizeCondition(rawCondition);
  const chosen = selectRecords(records, condition);
  /* 空陣列是有效的選擇（不敘述尖峰時段），不要在這裡又補回預設。 */
  const peaks = condition.peaks;
  const digits = condition.digits;
  const out: string[] = [];

  out.push(`【結論草稿】${scopeLabel(condition.scope, chosen)}`);
  out.push(
    `計畫：${meta.projectName}｜產生時間：${meta.generatedAt}｜系統版本：${meta.systemVersion}`,
  );

  if (!chosen.length) {
    out.push("");
    out.push(
      "所選條件沒有對應的資料。請放寬季度範圍、改選其他路口或資料別後再產生一次。",
    );
    return out.join("\n");
  }

  const quarters = Array.from(new Set(chosen.map((r) => r.quarter))).sort(
    (a, b) => quarterKey(a) - quarterKey(b),
  );
  const intersections = Array.from(
    new Set(chosen.map((r) => r.intersectionKey)),
  );
  /*
   * 「待設定」不是一種資料別，是那幾筆還沒指定。列成「資料別：平日、待設定」
   * 會被讀成第三種調查類別，所以真實的資料別和未指定的筆數分開寫。
   */
  const realSurveyTypes = Array.from(
    new Set(chosen.map((r) => r.surveyType || "待設定")),
  ).filter((type) => type !== "待設定");
  const pendingCount = chosen.filter(
    (r) => (r.surveyType || "待設定") === "待設定",
  ).length;
  const surveyTypeText2 =
    (realSurveyTypes.length ? realSurveyTypes.join("、") : "未指定") +
    (pendingCount
      ? `（另有 ${pendingCount} 筆尚未指定資料別，可在「流量核對工作台」補上）`
      : "");
  out.push("");
  out.push(
    `統計範圍：${quarters.length} 個季度（${quarters.join("、")}）、` +
      `${intersections.length} 個路口、共 ${chosen.length} 筆調查紀錄；` +
      `資料別：${surveyTypeText2}；` +
      (peaks.length
        ? `敘述時段：${peaks.map((p) => PEAK_LABEL[p]).join("、")}。`
        : "敘述時段：不敘述尖峰時段，只寫全調查時段的數值。"),
  );
  if (condition.branchNames.length)
    out.push(`只敘述指定支線：${condition.branchNames.join("、")}。`);
  /* 沒有寫任何尖峰時，草稿裡不會出現 PCU/hr，這句說明反而讓人困惑。 */
  if (peaks.length)
    out.push(
      "說明：PCU/hr 與 輛/hr 是該尖峰「一小時」的流率，僅在同一筆紀錄內可相加；" +
        "不同路口、不同季度之間只做比較，不做加總。",
    );

  const wants = (key: ConclusionMetricKey) => condition.metrics.includes(key);
  /*
   * 各支線的車種輛數是寫在「某一個尖峰」底下的，一個尖峰都沒選時根本不會
   * 出現，這句說明也就不必印——印了會讓人以為下面有東西卻找不到。
   */
  const wantsBranchIn = wants("branchCompositionIn");
  const wantsBranchOut = wants("branchCompositionOut");
  if ((wantsBranchIn || wantsBranchOut) && peaks.length)
    out.push(
      "說明：各支線各車種輛數取自「車種組成分析」的『全調查時段道路方向車種數量』，" +
        "單位是 輛／調查時段（整個調查期間的累計），不能和上面的 輛/hr 相比或相加；" +
        /*
         * 只勾一個方向時，「呈現方式」那一項不會生效（雙向合計會把另一個
         * 方向的車也算進去，不是使用者要的）。這裡就照實寫出方向，
         * 不要照抄一個其實沒有套用的設定名稱。
         */
        (wantsBranchIn && wantsBranchOut
          ? "呈現方式：" +
            (BRANCH_COMPOSITION_MODES.find(
              (mode) =>
                mode.key === (condition.branchCompositionMode || "follow"),
            )?.label || "跟著車種組成分析頁的設定")
          : `只敘述${wantsBranchIn ? "駛入" : "駛出"}方向`) +
        "。",
    );
  /*
   * 一個尖峰都不選是允許的（例如只要各路口的車種組成那一行），但這時
   * 「要寫哪些數字」裡至少得有一項是跟尖峰無關的，否則草稿只會剩下標題。
   * 與其交出一份空的草稿，不如直接說清楚差在哪裡。
   */
  const PEAK_FREE_METRICS: ConclusionMetricKey[] = ["composition"];
  if (!peaks.length && !PEAK_FREE_METRICS.some((key) => wants(key))) {
    out.push("");
    out.push(
      "目前沒有勾選任何時段，而「要寫哪些數字」裡選的項目都是寫在尖峰時段底下的，" +
        "因此沒有內容可以產生。請勾選「車種組成」（那一項寫的是全調查時段的累計量，" +
        "不需要尖峰），或者回去勾一個尖峰時段。",
    );
    return out.join("\n");
  }

  let section = 0;
  const heading = (text: string) => {
    section += 1;
    out.push("");
    out.push(`${section}. ${text}`);
  };

  if (condition.grouping === "byIntersection") {
    const groups = new Map<string, ConclusionRecord[]>();
    for (const record of chosen) {
      const bucket = groups.get(record.intersectionKey);
      if (bucket) bucket.push(record);
      else groups.set(record.intersectionKey, [record]);
    }
    for (const [, group] of groups) {
      heading(`${group[0].station}　${group[0].name}`);
      for (const record of group) {
        if (group.length > 1 || quarters.length > 1)
          out.push(`　〔${record.quarter}${quarterTag(record)}〕`);
        for (const peak of peaks)
          out.push(...describePeak(record, peak, condition));
        if (wants("composition")) out.push(...describeComposition(record));
      }
      if (wants("growth")) {
        /*
         * 勾了卻寫不出來時一定要交代原因。一個字都不寫的話，使用者無從判斷
         * 是「資料不足」還是「系統漏寫」，只能自己去猜。
         */
        const lines = growthBySurveyType(group, peaks, digits);
        out.push(
          ...(lines.length
            ? lines
            : ["　這個路口在所選範圍內不足兩季，未做季度比較。"]),
        );
      }
    }
  } else if (condition.grouping === "byQuarter") {
    for (const quarter of quarters) {
      const group = chosen.filter((record) => record.quarter === quarter);
      heading(`${quarter}（共 ${group.length} 筆）`);
      for (const record of group) {
        out.push(`　〔${record.station}　${record.name}〕`);
        for (const peak of peaks)
          out.push(...describePeak(record, peak, condition));
        if (wants("composition")) out.push(...describeComposition(record));
      }
      if (wants("extremes")) {
        const lines = describeExtremes(group, peaks, digits);
        out.push(
          ...(lines.length
            ? lines
            : ["　這一季可比較的路口不足兩個，未做大小比較。"]),
        );
      }
    }
  } else {
    heading("整體結果");
    for (const record of chosen.slice(0, 1)) {
      out.push(`　代表紀錄：${recordTitle(record)}`);
      for (const peak of peaks) out.push(...describePeak(record, peak, condition));
      if (wants("composition")) out.push(...describeComposition(record));
    }
    if (chosen.length > 1)
      out.push(
        `　（範圍內共 ${chosen.length} 筆；支線與車種這類不能跨路口相加的數字，` +
          `僅以上列這一筆為代表。要逐筆寫出請改選「依路口分段」或「依季度分段」。）`,
      );
  }

  if (wants("extremes") && condition.grouping !== "byQuarter") {
    heading("範圍內的最大與最小");
    const lines = describeExtremes(chosen, peaks, digits);
    if (lines.length) out.push(...lines);
    else out.push("　可比較的紀錄不足兩筆，未做大小比較。");
  }

  if (wants("growth") && condition.grouping !== "byIntersection") {
    heading("季度之間的變動");
    const groups = new Map<string, ConclusionRecord[]>();
    for (const record of chosen) {
      const bucket = groups.get(record.intersectionKey);
      if (bucket) bucket.push(record);
      else groups.set(record.intersectionKey, [record]);
    }
    let wrote = false;
    for (const [, group] of groups) {
      const lines = growthBySurveyType(group, peaks, digits);
      if (!lines.length) continue;
      wrote = true;
      out.push(`　〔${group[0].station}　${group[0].name}〕`);
      out.push(...lines);
    }
    if (!wrote)
      out.push("　範圍內沒有任何一個路口具備兩季以上的資料，未做季度比較。");
  }

  const routeless = chosen.filter((record) => record.routeless).length;
  if (routeless) {
    out.push("");
    out.push(
      `註：${routeless} 筆紀錄沒有逐流向（OD）資料，該筆的駛入／駛出無法分列；` +
        "重新匯入含流向的原始檔後即可補齊。",
    );
  }

  return out.join("\n");
}
