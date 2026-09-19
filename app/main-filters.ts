/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列的條件模型（純資料，沒有 React，可以單獨寫測試）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 定的總原則：
 *
 *   「主工具列是**彙整目前所有圖表各自工具列都擁有的篩選條件**，並新增
 *     路口流量視角和尖峰時段判定，有圖表不適用的條件，該圖表就單獨顯示不適用，
 *     加上前面有說過如果該圖表自己的篩選條件做了選擇，會先以圖表自己的為主，
 *     不影響其他圖表，那問題就小很多，每個圖表旁也多個按鍵，回歸主工具列篩選條件」
 *
 * ── 三態，缺一不可 ────────────────────────────────────────────
 *
 *   ① 鏡子：圖上那一顆下拉顯示的就是主工具列現在的值。主工具列一改，
 *          圖上那一顆**看得到跟著變**。
 *          ⚠️ 這一態最容易被漏掉：只驗「改圖上的不影響別張」的話，
 *            一個「圖上永遠顯示自己預設值、根本不看主工具列」的實作也會全綠。
 *   ② 脫離：使用者真的動了圖上的條件 → **只有那一張**改用自己的值，
 *          並在圖上寫明「目前用本圖自己的條件（主工具列：…）」。
 *   ③ 回歸：每張脫離的圖有一顆「回到主工具列條件」；
 *          主工具列上另有一顆「回歸全部（N 張）」。
 *
 * ⚠️ 這一套機制**三支程式一律相同**（使用者 2026-09-14：
 *   「三個程式要統一的，包含主工具列的 全部回歸鍵 和 各自圖表的回歸鍵，
 *     以及你說的圖自己的篩選只影響自己，不會影響到其他圖表，
 *     這方面的規定應該是適用三項程式」）。
 *   主工具列上**放哪些條件**則三支不同，因為三支擁有的東西不一樣。
 */
import type { ScopeKey, VehicleKey } from "@/lib/traffic";

/**
 * 尖峰時段。
 *
 * ⚠️ 比程式內部的 ScopeKey 多一個 "AMPM"（上午＋下午並列）。
 *
 *   使用者一開始指定四個（上午／下午／全調查時段／全調查時段尖峰），
 *   我實測後回報「各路口駛入／駛出流量」與「各路口尖峰彙總」現在就是
 *   AM／PM 兩欄並列，只給四個會**弄丟現有功能**；使用者因此追加第五個。
 *
 *   並列不是一種 ScopeKey，是「這張圖要同時畫兩個 ScopeKey」，
 *   所以只活在主工具列這一層，往下傳給計算時一定要先攤開成 AM 與 PM。
 */
export type PeakChoice = ScopeKey | "AMPM";

/** 尖峰時段判定方式。兩種算出來的數字本來就不一樣，所以一定要讓使用者看得到。 */
export type PeakRule = "point" | "direction";

/** 路口流量視角。"both" ＝ 駛出與駛入並列。 */
export type FlowView = "outbound" | "inbound" | "both";

/**
 * 資料別（這支程式裡就是平日／假日，由表頭「日期：…（平日）」解析而來）。
 *
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ **沒有「全部資料別」這一個選項**（使用者 2026-09-17 裁示）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者問：「平日＋假日並列 和 全部資料別，有什麼差異嗎?」
 * 查證結果：**完全沒有差異**。篩選只在 day === "weekday"／"holiday" 時
 * 才真的擋掉紀錄（見 traffic-app.tsx 的 projectRecords／surveyTypes），
 * "all" 與 "side-by-side" 一個都不進那兩個分支。
 *
 * ⚠️ 兩個名字不同、行為相同的選項比少一個選項更糟：使用者會合理地以為
 *   它們不一樣，於是花時間去比對兩份一模一樣的結果。
 * ⚠️ 留下來的是「並列」——全日交通量那一支就是「平日／假日／平日＋假日」
 *   三個，三支要一致；而且「並列」講的是呈現方式，比「全部」多給一個資訊。
 * ⚠️ 型別上仍然留著 "all"：舊的存檔裡有這個值，讀得懂才不會壞掉。
 *   選單上不再出現（見 DAY_ORDER），載入時由 normalizeLegacyAll 換掉。
 */
export type DayChoice = "all" | "weekday" | "holiday" | "side-by-side";

/** 轉向別。 */
export type MovementChoice = "all" | "left" | "through" | "right";

/** 顯示數值。沿用畫面上已經在用的 DisplayMode，五種。 */
export type DisplayChoice =
  | "volume"
  | "count"
  | "percent"
  | "both"
  | "countPercent";

export type MainFilters = {
  /** 季度區間。起＝迄時就等於單季（使用者指定的預設狀態）。 */
  quarterFrom: string;
  quarterTo: string;
  /** 空陣列＝全部路口。 */
  intersections: string[];
  peak: PeakChoice;
  peakRule: PeakRule;
  flowView: FlowView;
  day: DayChoice;
  vehicle: VehicleKey;
  movement: MovementChoice;
  display: DisplayChoice;
};

export type MainFilterField = keyof MainFilters;

/**
 * 預設值。
 *
 * ⚠️ 這一份**必須等同升級前的行為**，否則升級當天所有既有數字都會變。
 *   對照升級前的實際狀態：
 *     peak       AM        （useState<ScopeKey>("AM")）
 *     vehicle    all       （useState<VehicleKey>("all")）
 *     display    both      （useState<DisplayMode>("both")）
 *     flowView   both      （flowSummaryMode 預設 both）
 *   peakRule 是新加的，"point"（整個調查點同一時段）＝目前的算法。
 *   季度區間的起迄由呼叫端填成「最新一季」，這裡留空字串。
 */
export const DEFAULT_MAIN_FILTERS: MainFilters = {
  quarterFrom: "",
  quarterTo: "",
  intersections: [],
  peak: "AM",
  peakRule: "point",
  flowView: "both",
  /* ⚠️ 預設＝並列（＝舊的 "all"，行為完全相同，見 DayChoice 的說明）。 */
  day: "side-by-side",
  vehicle: "all",
  movement: "all",
  display: "both",
};

/** 每一張圖／表自己的條件；沒有鍵＝那張圖還跟著主工具列（鏡子）。 */
export type ChartOverrides = Record<string, Partial<MainFilters>>;

/**
 * 把舊存檔裡的 day: "all" 換成 "side-by-side"。
 *
 * ⚠️ 不換的話，舊存檔載進來之後「資料別」下拉會選不到任何一項（顯示成空白），
 *   而畫面上的數字其實是對的——控制項看起來壞了、資料卻沒事，最難查。
 *   兩個值的行為本來就相同，所以換過去不會改變任何數字。
 */
export function normalizeLegacyAll(filters: MainFilters): MainFilters {
  return filters.day === "all" ? { ...filters, day: "side-by-side" } : filters;
}

/** 某一張圖實際該用的條件。 */
export function filtersFor(
  main: MainFilters,
  overrides: ChartOverrides,
  chartId: string,
): MainFilters {
  const own = overrides[chartId];
  return normalizeLegacyAll(own ? { ...main, ...own } : main);
}

/** 這張圖有沒有脫離主工具列。 */
export function isDetached(
  overrides: ChartOverrides,
  chartId: string,
): boolean {
  const own = overrides[chartId];
  return Boolean(own) && Object.keys(own as object).length > 0;
}

/** 目前有哪幾張圖脫離了（給主工具列那顆「回歸全部（N 張）」用）。 */
export function detachedIds(overrides: ChartOverrides): string[] {
  return Object.keys(overrides).filter((id) => isDetached(overrides, id));
}

/**
 * 在某一張圖上改一個條件 → 只有那一張脫離。
 *
 * ⚠️ 回傳新的 overrides，不可以就地改——React 靠參考變化才會重畫。
 */
export function setChartFilter<K extends MainFilterField>(
  overrides: ChartOverrides,
  chartId: string,
  field: K,
  value: MainFilters[K],
): ChartOverrides {
  const own = { ...(overrides[chartId] || {}) };
  own[field] = value;
  return { ...overrides, [chartId]: own };
}

/** 某一張圖回歸主工具列。 */
export function resetChart(
  overrides: ChartOverrides,
  chartId: string,
): ChartOverrides {
  if (!overrides[chartId]) return overrides;
  const next = { ...overrides };
  delete next[chartId];
  return next;
}

/** 全部回歸。 */
export function resetAllCharts(): ChartOverrides {
  return {};
}

/* ══════════════════════════════════════════════════════════════════
 *  「有沒有真的篩」——不適用的提醒只在這個為真時才出現
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：「不適用的提醒只在真的篩了那個條件時出現」。
 * 沒篩的時候跳出來講一句沒有人問的話，是另一種噪音。
 */
/**
 * 季度區間**有沒有被拉開**（起 ≠ 迄）。
 *
 * ⚠️ 這**不是**「有沒有篩季度」。起＝迄＝只有那一季，也是在篩。
 *   這個函式只回答一件事：**一張卡／一張圖放不下兩季**的那種情形。
 */
export function isRangeWidened(filters: MainFilters): boolean {
  return Boolean(
    filters.quarterFrom &&
      filters.quarterTo &&
      filters.quarterFrom !== filters.quarterTo,
  );
}

export function isFiltered(
  filters: MainFilters,
  field: MainFilterField,
): boolean {
  switch (field) {
    case "intersections":
      return filters.intersections.length > 0;
    /*
     * ⚠️⚠️ **季度不要用這個函式問**（2026-09-15 起）。
     *
     *   舊註解寫著「起＝迄不算篩」——那是 M-1 之前的語意。使用者定案之後
     *   剛好相反：**起＝迄＝只有那一季**，那當然是在篩。
     *   但這個函式看不到季度清單，答不出「有沒有比全部季度窄」。
     *
     *   要問「是不是拉開了（一張卡放不下）」請用 `isRangeWidened`——
     *   那才是這個分支實際在回答的事。
     *   tests/main-filters.test.mjs 有一條掃描擋著，呼叫端把
     *   quarterFrom／quarterTo 丟進 isFiltered 會紅。
     *   這裡仍然回答 isRangeWidened 的值，只為了不讓舊呼叫端整支壞掉。
     */
    case "quarterFrom":
    case "quarterTo":
      return isRangeWidened(filters);
    default:
      return filters[field] !== DEFAULT_MAIN_FILTERS[field];
  }
}

/**
 * 「使用者**主動選了**這個值」——值相符 **而且** 這個條件真的被篩過。
 *
 * ⚠️ 甲案（2026-09-16，使用者裁示）把「全部」拿掉、預設改成並列之後，
 *   `filters.day === "side-by-side"` 就變成**恆真**，掛在它上面的
 *   「這張圖畫不了並列」說明於是變成常駐噪音——而使用者自己定的規則是
 *   「不適用的條件只在真的篩了那個條件時才出現」。
 *   交通服務水準（ts2028）的 `MF.chose()` 是同一支，三支同一條標準。
 */
export function chose(
  filters: MainFilters,
  field: MainFilterField,
  value: MainFilters[MainFilterField],
): boolean {
  return filters[field] === value && isFiltered(filters, field);
}

/** 條件的中文名（訊息與守門都讀這一份，避免兩邊講不同的詞）。 */
export const FIELD_LABELS: Record<MainFilterField, string> = {
  quarterFrom: "季度",
  quarterTo: "季度",
  intersections: "路口",
  peak: "尖峰時段",
  peakRule: "尖峰時段判定方式",
  flowView: "路口流量視角",
  day: "資料別",
  vehicle: "車種",
  movement: "轉向別",
  display: "顯示數值",
};

export const PEAK_CHOICE_LABELS: Record<PeakChoice, string> = {
  AM: "上午尖峰",
  PM: "下午尖峰",
  DAY: "全調查時段尖峰",
  FULL: "全調查時段",
  AMPM: "上午＋下午並列",
};

export const PEAK_RULE_LABELS: Record<PeakRule, string> = {
  point: "整個調查點同一時段（可相加）",
  direction: "各方向各自認定自己的尖峰",
};

/**
 * 尖峰數字旁邊一定要寫明用哪一種判定方式算的。
 *
 * ⚠️ 這不是排版，是可追溯性：兩種算法的數字本來就不同，
 *   「各方向各自認定」那一組**各方向不可以相加**。
 *   沒寫明的話，兩頁用不同算法時使用者無從察覺。
 */
export function peakRuleNote(rule: PeakRule): string {
  return rule === "direction"
    ? "尖峰時段判定：各方向各自認定自己的尖峰——各方向的尖峰不在同一小時，不可以相加。"
    : "尖峰時段判定：整個調查點取同一時段，各方向可以相加。";
}

export const FLOW_VIEW_LABELS: Record<FlowView, string> = {
  outbound: "駛出路口（以該支線為起點）",
  inbound: "駛入路口（以該支線為終點）",
  both: "駛出＋駛入並列",
};

export const DAY_LABELS: Record<DayChoice, string> = {
  /* ⚠️ "all" 只為了讀得懂舊存檔而留著，選單上不再出現。 */
  all: "平日＋假日並列",
  weekday: "平日",
  holiday: "假日",
  "side-by-side": "平日＋假日並列",
};

/*
 * ⚠️ 名字不可以叫 MOVEMENT_LABELS——lib/traffic.ts 已經有一個同名的
 *   （Record<MovementKey, string>，沒有 "all"）。撞名時 tsc 會直接擋下來，
 *   但更糟的是有人「順手」把兩個合而為一，於是多出一個 all 的轉向鍵值。
 */
export const MOVEMENT_CHOICE_LABELS: Record<MovementChoice, string> = {
  all: "全部轉向",
  left: "左轉",
  through: "直行",
  right: "右轉",
};

export const DISPLAY_LABELS: Record<DisplayChoice, string> = {
  count: "車輛數",
  volume: "交通流量",
  percent: "百分比",
  both: "交通流量＋百分比",
  countPercent: "車輛數＋百分比",
};

/**
 * 主工具列目前的條件，寫成一行給脫離的圖標註用。
 *
 * ⚠️ 第二個參數 `showQuarter` **必須**傳進來（畫面上所有顯示季度的地方都要走它），
 *   否則這一行會是**唯一**還寫著「115Q1」的地方——使用者切到西元年／調查月份時，
 *   整頁都改了、只有這一句沒改，等於一頁兩種年份寫法。
 *   （2026-09-15 在全日交通量上被 e2e 抓到，三支同一套寫法，一起修。）
 *   預設值只是為了不讓舊呼叫端壞掉，**不是可以省略**。
 */
export function describeMain(
  main: MainFilters,
  showQuarter: (value: string) => string = (value) => value,
  /*
   * ⚠️ 第三個參數 `showVehicle` 也**必須**傳進來。
   *
   *   `main.vehicle` 是**內部代號**（例如 `custom:電動機車`、`motorcycle`），
   *   不是畫面上的名字。舊版直接 `String(main.vehicle)` 印出去，於是脫離的圖
   *   上會寫著「115Q2・上午尖峰・全部路口・custom:電動機車」——
   *   使用者看到的是一串他從來沒在畫面上見過的字。
   *
   *   而且這件事**不只是難看**：那一行是「主工具列現在是什麼」的唯一說明，
   *   使用者要靠它判斷這張圖和別張差在哪。印代號等於沒說。
   *
   *   預設值只是為了不讓舊呼叫端壞掉，**不是可以省略**。
   */
  showVehicle: (value: string) => string = (value) => value,
): string {
  const parts: string[] = [];
  parts.push(
    main.quarterFrom && main.quarterTo
      ? main.quarterFrom === main.quarterTo
        ? showQuarter(main.quarterFrom)
        : `${showQuarter(main.quarterFrom)}～${showQuarter(main.quarterTo)}`
      : "全部季度",
  );
  parts.push(PEAK_CHOICE_LABELS[main.peak]);
  /* ⚠️ 一律印出來：現在沒有「全部」那一個值可以當「不必講」。 */
  parts.push(DAY_LABELS[main.day] || DAY_LABELS.all);
  parts.push(
    main.intersections.length
      ? `${main.intersections.length} 個路口`
      : "全部路口",
  );
  if (main.vehicle !== "all") parts.push(showVehicle(String(main.vehicle)));
  if (main.movement !== "all") parts.push(MOVEMENT_CHOICE_LABELS[main.movement]);
  return parts.join("・");
}

/**
 * 不適用的說明文字。
 *
 * ⚠️ 「不適用」**不可以只是不做事**——使用者會以為篩選壞掉。
 *   每一句都要說**為什麼**，而且要說目前實際上是拿什麼在算。
 */
export function inapplicableNote(reason: string, actually: string): string {
  return `${reason}目前仍以${actually}計算。`;
}
