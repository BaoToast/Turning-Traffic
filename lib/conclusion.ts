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
 * 而這個檔案是純文字產生器，測試要能單獨跑。鍵值必須和 lib/traffic
 * 的 PeakKey／ScopeKey 一致——tests/conclusion.test.ts 有一項檢查釘住這件事。
 */
export type PeakKey = "AM" | "PM" | "DAY";
/**
 * 結論草稿的「時段」＝**四個核心統計範圍**，不是三個尖峰。
 *
 * ⚠️ 使用者 2026-09-21 定案（原話：「這 4 個名詞是我們交通調查的 4 個核心」）：
 *
 *     AM    上午尖峰         該段裡流率最高的 1 小時       PCU/hr、輛/hr
 *     PM    下午尖峰         該段裡流率最高的 1 小時       PCU/hr、輛/hr
 *     DAY   全調查時段尖峰   調查涵蓋內流率最高的 1 小時   PCU/hr、輛/hr
 *     FULL  全調查時段       調查涵蓋內的**累計量**        PCU/調查時段、輛/調查時段
 *
 * ⚠️⚠️ FULL 的單位**不是 /hr**。它是一整段的累計；把它寫成 PCU/hr 等於
 *   把「一整天的總量」講成「一小時的流率」，而這句話會被原封不動抄進報告。
 *   所有輸出一律走 scopeRateUnit()／scopeVehicleUnit()，不可以在任何一處
 *   自己寫死 "PCU/hr" 或 "輛/hr"。
 *
 * ⚠️ v2.1.82 以前這裡只有三個尖峰，而且畫面上只擺了兩顆勾選框（上午／下午）：
 *   「全調查時段」是靠**兩個都不勾**這個隱藏狀態表達的，於是使用者
 *   沒辦法同時要「上午尖峰」和「全調查時段」。使用者 2026-09-21 指出
 *   「正確做法應該是把全調查時段做為第 4 個可勾選選項」——就是這裡。
 *   **不要把第四個選項再拿掉，也不要把它退回成「都不勾」的隱藏狀態。**
 */
export type ConclusionScopeKey = PeakKey | "FULL";

/**
 * 可勾選的敘述指標。
 *
 * ⚠️ 2026-09-25 第六輪：這些標籤原本把單位**寫死**在字面上
 *   （「（PCU/hr）」「（輛/hr）」「（輛/調查時段）」）。那是錯的，而且是
 *   兩種錯法疊在一起：
 *     ① 使用者可以勾「全調查時段」，那時的單位不是 /hr；
 *     ② 同一次可以勾**多個時段**，單位本來就不只一種。
 *   於是勾選框寫「PCU/hr」，而草稿裡同一項寫「PCU/調查日」——
 *   同一個畫面自己打自己。（第 120 行那一則註解自己就記著
 *   「兩個勾選框互相打臉」，但當時只改了其中一個的字面。）
 *
 *   現在標籤**只寫是什麼量**（流量／車輛數／百分比），單位交給草稿本文
 *   （它一律走 `scopeRateUnit()`／`scopeVehicleUnit()`，帶著該筆的涵蓋），
 *   勾選區底下另有一句話說明單位怎麼決定。
 *   **不要把單位寫回標籤裡。**
 */
export const CONCLUSION_METRICS = [
  { key: "inflowPcu", label: "各支線駛入流量（PCU）" },
  { key: "outflowPcu", label: "各支線駛出流量（PCU）" },
  { key: "inflowVehicles", label: "各支線駛入車輛數" },
  { key: "outflowVehicles", label: "各支線駛出車輛數" },
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
  /*
   * ── 車輛數版本的佔比（使用者 2026-09-23 核准新增）────────────────
   *
   * 上面那兩項的分子分母都是 **PCU**。但「各路口駛入／駛出流量」那張表
   * 在「顯示數值＝車輛數＋百分比」時，百分比是拿**車輛數**算的
   *（traffic-app 的 `useCount` 分支，分母是 inboundVehicles／outboundVehicles）。
   * 同一個支線、同一個時段，兩種分母的百分比是不同的數字——
   * 表格查得到車輛數版本，草稿只寫得出 PCU 版本。
   *
   * ⚠️ 刻意**另開兩個鍵**而不是改既有那兩個：改既有的等於讓所有既有範本
   *   與備份的輸出換一套數字。兩個新鍵不勾就完全不出現。
   *
   * ⚠️ 分母用 `totalVehicles`（整個路口該時段的總車輛數）。
   *   駛入各支線的車輛數合計與駛出各支線的合計都等於它——同一批車依起點
   *   或終點重新分組，總量不變——所以兩個方向共用同一個分母，
   *   各自加起來各是 100%。這和 PCU 版本是同一個道理。
   */
  { key: "shareInVehicles", label: "各支線佔駛入路口總車輛數百分比" },
  { key: "shareOutVehicles", label: "各支線佔駛出路口總車輛數百分比" },
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
    label: "各支線各車種駛入車輛數",
  },
  {
    key: "branchCompositionOut",
    label: "各支線各車種駛出車輛數",
  },
  { key: "balance", label: "駛入／駛出平衡差值" },
  /*
   * ⚠️ 2026-09-23 改名。原本叫「全日流量（輛／調查日）」，而它讀的其實是
   *   `row.inbound.FULL`＝**全調查時段**，而且**沒有任何 24 小時判斷**
   *   （那個門檻 2026-09-11 就拿掉了，見 traffic-app 的註解）。
   *   於是一份 4 小時的調查，它的 4 小時累計會被寫成
   *   「全日駛入 N 輛/調查日」貼進報告——同一份草稿裡
   *   `branchCompositionIn` 標的是「輛/調查時段」，兩個勾選框互相打臉。
   *   名稱與單位一律跟著 `scopeVehicleUnit("FULL", coverage)`，不再自己寫死。
   *   ⚠️ 2026-09-25 第六輪：標籤裡的「（輛／調查時段）」也拿掉了——
   *     滿 24 小時的調查，草稿本文寫的是「輛/調查日」，標籤卻寫「調查時段」。
   */
  { key: "fullDay", label: "全調查時段流量（車輛數）" },
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
  /*
   * ⚠️ 欄位名稱維持 `peaks`：它**存在範本與備份裡**，改名會讓使用者既有的
   *   範本讀不回來。型別已經是四個統計範圍（含 FULL＝全調查時段），
   *   名字是歷史包袱，不是「只有尖峰」的意思。
   */
  peaks: ConclusionScopeKey[];
  /** 空陣列＝全部路口。存的是 recordIntersectionKey。 */
  intersectionKeys: string[];
  /**
   * 空陣列＝全部支線。存的是**支線名稱的比對鍵**（見 typedNameKey()）。
   *
   * ⚠️ 為什麼是「比對鍵」而不是原字串：使用者 2026-09-11 實測發現，
   *   同一個看起來一樣的名字在系統裡其實是兩個不同的字串。
   *
   *   成因：自動命名那一行寫的是 `"路口 " + code`——**「路口」和代碼中間
   *   有一個半形空格**。使用者手動輸入時打的是「路口A」（沒有空格），
   *   於是 `路口 A` ≠ `路口A`，兩者被當成兩條不同的支線。
   *   他的原話：
   *     「就算我手動改成『路口A』，他也不會被歸類到路口A裡面……
   *       除非我 A 和 B 路段也手動輸入一次一模一樣的『路口A』才會歸在一起。」
   *
   *   所以**不是「預設的」與「手動的」被分成兩類**，是那個空格。
   *   比對前一律過 typedNameKey()（NFKC、去空白與標點、統一全半形），
   *   之後「只要名稱相同就歸在一起」才真的成立。
   *
   * ⚠️ 這裡**刻意用名稱而不是支線代碼**。一度改成代碼，使用者指出那會拿掉
   *   他需要的彈性：「假設哪一天檔案第一條支線其實是路口D，只是這份資料
   *   不小心被挪到了第一支線的位置，原本我希望我可以自己手動去修改名稱後，
   *   讓程式把同樣名稱歸類在一起，現在反而作不到。」
   *   名稱是**使用者可以修正的事實**，代碼是檔案給的位置——要以前者為準。
   *
   * 欄位名稱維持 branchNames：使用者存過的範本裡是這個鍵。
   */
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
  /*
   * ── 尖峰時段判定方式（使用者 2026-09-23 核准新增）──────────────
   *
   * "point"（預設）＝整個調查點同一時段：各支線的尖峰在同一小時，
   *   各支線的量**可以相加**，合計等於路口總量。這是改版前的唯一行為。
   *
   * "direction" ＝各方向各自認定自己的尖峰：逐時段替每一條支線挑它自己
   *   最忙的那一小時。兩種算出來的數字本來就不同（實測差距可以到 50 倍，
   *   見 tests/approach-peak.test.mjs），而且**各支線的量不可以相加**——
   *   它們不是同一時刻的量。草稿會把這句警告寫出來。
   *
   * ⚠️ 這一頁刻意**不跟著主工具列跑**（使用者 2026-09-14 裁示：結論草稿
   *   與報表維持獨立）。要對齊請按「套用主工具列」。
   */
  peakRule?: "point" | "direction";
  /*
   * ── 轉向別與車種（使用者 2026-09-15 指名補上）────────────────
   *
   * 主工具列有這兩項，結論草稿以前**完全沒有**——使用者沒辦法出
   * 「只看左轉」「只看大型車」這種題目。
   *
   * ⚠️ 兩者都是**逐筆紀錄的純轉換**（recordWithMovementFilter／
   *   recordWithVehicleFilter，涵蓋 AM／PM／DAY／FULL 四個時段），
   *   所以由畫面端在把紀錄交給草稿之前先套用，草稿本身不重算。
   * ⚠️ 預設 "all"／"all" ＝改版前的行為，舊範本沒有這兩個鍵也一樣。
   */
  movement?: "all" | "left" | "through" | "right";
  vehicle?: string;
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
  movement: "all",
  vehicle: "all",
  /*
   * ⚠️ 預設是「整個調查點同一時段」＝**改版前的行為**。
   *   升級當天既有的範本、備份與畫面預設全部落在這一支，
   *   草稿輸出逐字不變（有一支測試把這件事釘住）。
   */
  peakRule: "point",
};

export type ConclusionTemplate = {
  id: string;
  name: string;
  condition: ConclusionCondition;
  savedAt: string;
};

/**
 * **使用者自己打進去的名稱**，比對前的正規化鍵。
 *
 * 只吸收「排版差異」，不吸收「內容差異」。
 *
 * 適用範圍：支線名稱、範本名稱……凡是**使用者可以自由輸入、而且他看不出
 * 兩個字串到底哪裡不一樣**的欄位。系統自動解析出來的識別字（檔名推出來的
 * 路段名稱、站號代碼）另有各自的規則，不走這一支。
 *
 * 為什麼需要它（2026-09-11 實測）：
 *   ・自動命名寫的是 `"路口 " + code` → 存進去是「路口 A」（**有半形空格**）
 *   ・使用者手動輸入時打的是「路口A」（沒有空格）
 *   → 直接比字串的話，這兩個是不同的支線，而畫面上看起來一模一樣。
 *
 * 會被吸收的（都是**打字排版**上的差異，不改變名字本身）：
 *   ・半形／全形空格，以及字串中間的空格
 *   ・全形英數字（Ａ→A）與全形標點，由 NFKC 處理
 *   ・全形／半形括號、各種破折號（～ ~ — – －）
 *   ・逗號、句號、頓號、冒號、底線
 *
 * ⚠️ **大小寫刻意不吸收**：「路口A」與「路口a」視為**不同**的名稱。
 *   使用者 2026-09-11 的指示：
 *     「我建議是判定是不同，因為這不是比對前『正規化』的意思。」
 *   他的分界很清楚：空格與全半形是**排版雜訊**，大小寫是**內容**。
 *   一度寫成 toLocaleLowerCase() 併在一起，已依此拿掉。
 *
 * ⚠️ 不可以只做 trim()：問題出在**字串中間**的空格，trim 碰不到。
 */
export function typedNameKey(value: string): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[～~—–－-]/g, "~")
    .replace(/[\s\u3000，,。．.、:：_]/g, "");
}

/** 一條支線在某個尖峰的數字。null＝這份資料沒有這個欄位（不是 0）。 */
export type ConclusionBranch = {
  /**
   * 支線代碼（A／B／C…），來自原始檔的欄位順序。
   *
   * ⚠️ **篩選不用它**，篩選用的是名稱（見 ConclusionCondition.branchNames）。
   *   理由是使用者 2026-09-11 指出的情境：「假設哪一天檔案第一條支線
   *   其實是路口D，只是這份資料不小心被挪到了第一支線的位置」——
   *   代碼只說明它排在第幾欄，不代表它是哪一條路；名稱才是可以被修正的事實。
   *
   * 留著它是為了**顯示**：同一個名稱橫跨兩個以上的代碼時（就是上面那種挪位
   * 的情形），清單上把代碼一起標出來，使用者才看得出發生了什麼。
   */
  code: string;
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
  /*
   * ── 這條支線**自己**最忙的那一小時（使用者 2026-09-23 核准新增）────
   *
   * ⚠️ 只有條件選「各方向各自認定自己的尖峰」時才有值；選「整個調查點
   *   同一時段」（預設）時一律是 null／undefined，草稿一個字都不會多寫，
   *   輸出與改版前逐字相同。
   *
   * ⚠️ 算不出來的支線（v2.1.67 以前匯入、沒有 sourceIntervals，或格距
   *   組不成整小時）是 null——**不可以偷偷沿用整個路口的視窗**。
   *   那會讓同一段草稿裡有些是「自己的尖峰」、有些是「整路口的尖峰」，
   *   而文字上只寫著一種判定方式。畫面那邊已經因為同一個理由把算不出來的
   *   紀錄列出來明講，草稿要一致。
   */
  peakWindow?: string | null;
  inflowPcu: number | null;
  outflowPcu: number | null;
  inflowVehicles: number | null;
  outflowVehicles: number | null;
  /*
   * 全調查時段的車輛數（單位走 scopeVehicleUnit("FULL")）。
   *
   * ⚠️ 欄位名稱裡的 `FullDay` 是歷史包袱，**它不是「全日」**：
   *   來源是 `row.inbound.FULL`＝整份調查實際涵蓋的那一段，
   *   沒有 24 小時門檻。null 代表「這一筆沒有逐流向明細」，
   *   **不是**「涵蓋時數不足」。
   *   （鍵名不改是因為它會出現在使用者存好的結論草稿範本裡；
   *   要改就得連遷移一起做，而那不是這一版的範圍。）
   */
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
  peaks: Partial<Record<ConclusionScopeKey, ConclusionPeakData>>;
  /** 車種組成：整份調查（或退回 AM 尖峰）的輛數。**這是整個路口的合計。** */
  composition: { label: string; count: number }[];
  compositionScope: string;
  compositionUnit: string;
  /*
   * 這一筆的調查涵蓋（`coverageOf(record)` 的輸出）。
   *
   * ⚠️ 只用來決定「全調查時段」那一個範圍的單位：滿 24 小時時是
   *   `PCU／調查日`、`輛／調查日`，其餘一律 `／調查時段`。
   *   `lib/traffic.ts` 的 `scopeUnit()` 本來就是這樣算的，Excel 欄名與
   *   報告文字草稿也都走它——2026-09-23 的反向對帳抓到**只有結論草稿**
   *   沒有跟上：同一筆 24 小時調查，Excel 寫「PCU/調查日」、
   *   報告草稿寫「PCU/調查日」、結論草稿寫「PCU/調查時段」。
   *
   * ⚠️ **選填**。讀不到時一律當成「調查時段」，也就是改版前的行為——
   *   舊的呼叫端與既有測試一個字都不會變。
   *   方向也是刻意的：「調查時段」在滿 24 小時時只是講得保守，
   *   反過來把 4 小時標成「調查日」則是講錯（見 scopeUnit 的註解：
   *   「錯的方向要選會少講，不要選會多講」）。
   */
  surveyCoverage?: "full" | "partial" | "mixed" | "unknown";
  /*
   * 這一筆的調查日期（ISO）。
   *
   * ⚠️ 只用來數「這個範圍涵蓋幾個調查日」——儀表板的「本季調查路口 N 處」
   *   底下那一行就是這個數字，而分析範圍段落常常要寫它，草稿卻寫不出來
   *  （使用者 2026-09-23 核准新增）。
   * ⚠️ 舊備份與沒有日期的紀錄是 undefined，那幾筆**不計入**，
   *   而且會另外講出來——不可以把「沒有日期」默默算成一天。
   */
  surveyDate?: string;
  /**
   * 逐支線的車種輛數（**駛入方向**，全調查時段）。
   *
   * ⚠️ 為什麼需要這一欄（使用者 2026-09-21 回報）：
   *   結論草稿的支線篩選對「車種組成」**完全無效**——勾路口A、勾路口B、
   *   或全選，輸出的車種組成一模一樣（都是整個路口的合計），
   *   而抬頭卻寫著「只敘述指定支線：路口 B」。
   *   **抬頭說有篩、內容沒篩**，使用者會把整個路口的數字當成該支線的數字
   *   抄進報告。`composition` 一欄天生就是路口層級的，接不住支線篩選，
   *   所以另外備一份逐支線的。
   *
   * ⚠️ 只取**駛入**：四條支線的駛入合計＝路口總量，可以相加；
   *   駛出合計也等於路口總量，兩者**相加會變成兩倍**。
   *   這一筆若是以「雙向合計」呈現（沒有駛入／駛出之分），就沒有可以
   *   安全相加的逐支線值——這時候是 null，敘述端要照實說不能篩，
   *   **不可以拿路口合計硬充數**。
   */
  compositionByBranch:
    | { code: string; name: string; items: { label: string; count: number }[] }[]
    | null;
  /** 沒有逐流向資料時，很多敘述都不能寫，要在文中講清楚。 */
  routeless: boolean;
};

export type ConclusionMeta = {
  projectName: string;
  systemVersion: string;
  /** 由畫面傳入，避免這支純函式碰時間（測試才能穩定）。 */
  generatedAt: string;
  /*
   * 季度在草稿上要寫成民國年還是西元年。
   *
   * **純顯示**的換字：篩選（record.quarter === scope.quarter）、排序
   *（quarterKey）與分組一律走傳進來的儲存值，換寫法不會挑到不同的資料、
   * 也不會動到任何數字。不傳就照原樣輸出，舊呼叫端與單元測試的行為不變。
   */
  showQuarter?: (quarter: string) => string;
  /**
   * 車種條件在畫面上的名稱。
   *
   * ⚠️ 由呼叫端傳進來，這裡**不查目錄**：目錄是計畫層級、只增不減的
   *   原始車種表，會列出已經被併走的車種；兩邊各查各的遲早給出不同的名字。
   */
  vehicleLabel?: string;
};

/*
 * 季度在草稿上要寫成民國年還是西元年（見 ConclusionMeta.showQuarter）。
 *
 * 用模組層變數而不是一路傳參數：組字的輔助函式有七、八個，全部加一個參數
 * 會讓每一個簽章都變髒。buildConclusion 是同步的，進入時設定、用完即可。
 * 篩選、排序與分組一律走儲存值，這裡只換看到的字。
 */
let quarterText: (quarter: string) => string = (quarter) => String(quarter ?? "");

const PEAK_LABEL: Record<ConclusionScopeKey, string> = {
  AM: "上午尖峰",
  PM: "下午尖峰",
  /* 2026-09-10 依使用者指定改名，三支一致。見 lib/traffic.ts 的 SCOPE_SHORT_LABELS。 */
  DAY: "全調查時段尖峰",
  FULL: "全調查時段",
};

/**
 * 這個統計範圍的 PCU 單位。
 *
 * ⚠️ **只有 FULL 不是 /hr。** AM／PM／DAY 三者都是「某一個特定的 1 小時」，
 *   所以是流率；FULL 是整段涵蓋的累計量，寫成 /hr 會把總量講成流率。
 *   這一支存在的唯一理由，就是讓四個地方不要各自寫死字串。
 */
export function scopeRateUnit(
  scope: ConclusionScopeKey,
  coverage?: ConclusionRecord["surveyCoverage"],
): string {
  if (scope !== "FULL") return "PCU/hr";
  return coverage === "full" ? "PCU/調查日" : "PCU/調查時段";
}

/** 這個統計範圍的車輛數單位。理由同 scopeRateUnit。 */
export function scopeVehicleUnit(
  scope: ConclusionScopeKey,
  coverage?: ConclusionRecord["surveyCoverage"],
): string {
  if (scope !== "FULL") return "輛/hr";
  return coverage === "full" ? "輛/調查日" : "輛/調查時段";
}

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

/*
 * 百分比一律要把「小數位數」帶進來。
 *
 * 舊版這個參數有預設值 1，而全部呼叫端都沒有傳，於是使用者把小數位數
 * 改成 2 位時百分比完全不動（三支系統都是同一個寫法、同一個毛病）。
 * 這裡**刻意拿掉預設值**，漏傳就是編譯錯誤，不會再無聲失效。
 */
function pct(value: number | null | undefined, digits: number) {
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
      ? (list(source.peaks) as ConclusionScopeKey[])
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
    /*
     * ⚠️ 2026-09-25 修正：上面那段註解點名了 `Number("")`，程式卻沒擋它。
     *
     * 舊寫法只排掉 null 與 undefined，而實測：
     *     digits=""    → 0（應為 1）      digits=" "   → 0
     *     digits=[]    → 0               digits=false → 0
     * 四種都通得過 `Number.isFinite(Number(...))`，於是使用者設的 1 位小數
     * 被靜默換成 0 位，而結論草稿與報表草稿的位數從此對不起來。
     * 照 lib/report-draft.ts 的 safeReportDigits() 改成先擋型別再轉數字。
     */
    digits: (() => {
      const raw = source.digits as unknown;
      const usable =
        typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "");
      if (!usable || !Number.isFinite(Number(raw)))
        return DEFAULT_CONDITION.digits;
      return Math.min(4, Math.max(0, Math.round(Number(raw))));
    })(),
    branchCompositionMode: ["follow", "split", "two-way"].includes(
      String(source.branchCompositionMode),
    )
      ? (source.branchCompositionMode as BranchCompositionMode)
      : "follow",
    /*
     * ⚠️ 舊範本與舊備份沒有這個欄位，一律回「整個調查點同一時段」——
     *   也就是它們存檔當時的行為。套用舊範本不會突然換一套數字。
     */
    peakRule: source.peakRule === "direction" ? "direction" : "point",
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
        /*
         * ⚠️ 2026-09-25：拿掉贅餘的 `key !== Number.NEGATIVE_INFINITY`。
         *   quarterKey() 認不得季度時回 -Infinity，而
         *   `Number.isFinite(-Infinity)` 本來就是 false（實測），
         *   所以第二個條件永遠成立、永遠多餘。留著會讓下一個人以為
         *   「這裡已經多擋了一道」，改了 quarterKey 的回傳值（例如改成 NaN
         *   或 -1）之後誤判為安全。行為完全不變。
         */
        if (Number.isFinite(key)) {
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
  /*
   * 兩邊都過一次 typedNameKey()：
   *   ・condition 裡存的可能是舊範本的原字串（例如「路口 A」）
   *   ・branch.name 是這一筆資料目前的名稱
   * 正規化之後比，舊範本才不會靜默失效（選不到任何支線，草稿卻照樣產出）。
   */
  const wanted = new Set(condition.branchNames.map(typedNameKey));
  return peakData.branches.filter(function (branch) {
    return wanted.has(typedNameKey(branch.name));
  });
}

function scopeLabel(
  scope: ConclusionScope,
  records: ConclusionRecord[],
  show: (quarter: string) => string,
) {
  if (scope.kind === "quarter") return show(scope.quarter);
  if (scope.kind === "year") return showYear(scope.year, show) + " 年度";
  if (scope.kind === "range")
    return show(scope.from) + "～" + show(scope.to);
  const quarters = Array.from(new Set(records.map((r) => r.quarter))).sort(
    (a, b) => quarterKey(a) - quarterKey(b),
  );
  return quarters.length
    ? "全計畫（" + show(quarters[0]) + "～" + show(quarters.at(-1) as string) + "）"
    : "全計畫";
}

/*
 * 年度是「115」這種光年份的字串，沒有 Qn，show() 認不得。
 * 借一個季度殼子換算完再把 Qn 去掉；換不成就原樣回傳。
 */
function showYear(year: string, show: (quarter: string) => string) {
  const match = String(show(String(year) + "Q1")).match(/^(\d{2,4})Q1$/);
  return match ? match[1] : String(year);
}

/** 一個路口、一個尖峰要寫出來的那幾行。 */
function describePeak(
  record: ConclusionRecord,
  peak: ConclusionScopeKey,
  condition: ConclusionCondition,
): string[] {
  const data = record.peaks[peak];
  /*
   * ⚠️ 單位一律由 peak 決定，不可以寫死：FULL（全調查時段）是累計量，
   *   單位是 PCU/調查時段、輛/調查時段；AM／PM／DAY 才是 /hr 的流率。
   */
  /* ⚠️ 帶著這一筆的調查涵蓋：滿 24 小時的「全調查時段」單位是「／調查日」。 */
  const rateUnit = scopeRateUnit(peak, record.surveyCoverage);
  const vehicleUnit = scopeVehicleUnit(peak, record.surveyCoverage);
  if (!data)
    return [
      `　${PEAK_LABEL[peak]}：這一筆沒有${PEAK_LABEL[peak]}的資料。`,
    ];
  const lines: string[] = [];
  const wants = (key: ConclusionMetricKey) => condition.metrics.includes(key);
  const digits = condition.digits;

  const head: string[] = [PEAK_LABEL[peak]];
  if (wants("peakHour") && data.window) head.push(data.window);
  const headline: string[] = [];
  if (wants("total")) {
    if (data.totalPcu !== null)
      headline.push(`總流量 ${num(data.totalPcu, digits)} ${rateUnit}`);
    if (data.totalVehicles !== null)
      headline.push(`總車輛數 ${whole(data.totalVehicles)} ${vehicleUnit}`);
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
    wants("shareInVehicles") ||
    wants("shareOutVehicles") ||
    wants("balance") ||
    wants("fullDay") ||
    wants("branchCompositionIn") ||
    wants("branchCompositionOut");

  if (showsBranchMetric)
    for (const branch of branches) {
      const parts: string[] = [];
      if (wants("inflowPcu"))
        parts.push(`駛入 ${num(branch.inflowPcu, digits)} ${rateUnit}`);
      if (wants("outflowPcu"))
        parts.push(`駛出 ${num(branch.outflowPcu, digits)} ${rateUnit}`);
      if (wants("inflowVehicles"))
        parts.push(`駛入 ${whole(branch.inflowVehicles)} ${vehicleUnit}`);
      if (wants("outflowVehicles"))
        parts.push(`駛出 ${whole(branch.outflowVehicles)} ${vehicleUnit}`);
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
          parts.push(`佔駛入 ${pct(inShare, digits)}`);
        if (wants("shareOut") && outShare !== null)
          parts.push(`佔駛出 ${pct(outShare, digits)}`);
      }
      /*
       * 車輛數版本的佔比（與「各路口駛入／駛出流量」表在「車輛數＋百分比」
       * 顯示模式下算的是同一個口徑）。
       *
       * ⚠️ 單位詞一定要寫「車輛數」，不可以和上面的 PCU 版本都寫「佔駛入」——
       *   同一行裡兩個不同分母的百分比並排而看不出差別，正是這個專案
       *   一再出事的類型。
       */
      if (wants("shareInVehicles") || wants("shareOutVehicles")) {
        const total = data.totalVehicles;
        const shareOf = (value: number | null) =>
          total && value !== null ? (value / total) * 100 : null;
        const inShare = shareOf(branch.inflowVehicles);
        const outShare = shareOf(branch.outflowVehicles);
        if (wants("shareInVehicles") && inShare !== null)
          parts.push(`佔駛入車輛數 ${pct(inShare, digits)}`);
        if (wants("shareOutVehicles") && outShare !== null)
          parts.push(`佔駛出車輛數 ${pct(outShare, digits)}`);
      }
      if (wants("balance")) {
        if (branch.inflowPcu !== null && branch.outflowPcu !== null) {
          const diff = branch.inflowPcu - branch.outflowPcu;
          parts.push(
            `駛入減駛出 ${diff >= 0 ? "+" : ""}${num(diff, digits)} ${rateUnit}`,
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
                    digits,
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
        /*
         * ⚠️ 單位一律走 scopeVehicleUnit("FULL")（＝輛/調查時段）。
         *   2026-09-23 之前這裡寫死「輛/調查日」，而值是整段調查涵蓋的
         *   累計量、沒有任何 24 小時判斷——4 小時的量被標成全日量。
         *   系統本來就有 scopeUnit()／scopeVehicleUnit() 在管這件事，
         *   註解還特別寫著「錯的方向要選會少講，不要選會多講」，
         *   這裡正好反過來多講。
         */
        const fullUnit = scopeVehicleUnit("FULL", record.surveyCoverage);
        if (branch.inflowFullDayVehicles !== null)
          parts.push(
            `全調查時段駛入 ${whole(branch.inflowFullDayVehicles)} ${fullUnit}`,
          );
        if (branch.outflowFullDayVehicles !== null)
          parts.push(
            `全調查時段駛出 ${whole(branch.outflowFullDayVehicles)} ${fullUnit}`,
          );
        if (
          branch.inflowFullDayVehicles === null &&
          branch.outflowFullDayVehicles === null
        )
          /*
           * ⚠️ 這句話原本寫「需要完整 24 小時調查資料」——那是**錯的原因**。
           *   null 的唯一成因是「這一筆沒有逐流向明細」，
           *   涵蓋時數不足並不會讓它變成 null。照原本那樣寫，
           *   使用者會去補時數，而那補不出東西來。
           */
          parts.push("這一筆沒有逐支線的駛入／駛出明細，算不出全調查時段流量");
      }
      /*
       * ── 這條支線自己最忙的那一小時 ────────────────────────────
       *
       * ⚠️ 只有條件選「各方向各自認定自己的尖峰」時 `peakWindow` 才有值。
       *   選預設的「整個調查點同一時段」時它是 undefined，這一段完全不執行，
       *   輸出與改版前逐字相同。
       *
       * ⚠️ 支線名稱後面**立刻**寫視窗，而不是丟在句尾：
       *   讀的人必須在看到數字之前就知道「這一行講的不是上面那個路口視窗」。
       * ⚠️ 算不出來（null）也要寫出來。靜靜地不寫，讀者只會以為那條支線
       *   和其他條走同一個視窗——而那正是這個判定方式最容易被誤讀的地方。
       */
      const own =
        branch.peakWindow === undefined
          ? ""
          : branch.peakWindow
            ? `（自己最忙 ${branch.peakWindow}）`
            : "（這一筆算不出這條支線自己的尖峰，改用整個路口的時段）";
      lines.push(`　　${branch.name}${own}：${parts.join("；")}`);
    }
  return lines;
}

/**
 * 車種組成那一行（或那幾行）。
 *
 * ⚠️ **支線篩選一定要在這裡生效。**（使用者 2026-09-21 回報的缺陷）
 *   舊版這一支只收 (record, digits)，`condition` 根本沒傳進來，
 *   於是勾路口A、勾路口B、全選，寫出來的車種組成一模一樣——
 *   都是整個路口的合計——而草稿抬頭同時印著「只敘述指定支線：路口 B」。
 *   **抬頭說有篩、內容沒篩**，數字會被當成該支線的量抄進報告。
 *
 * ⚠️ 篩不了的時候要**說出來**，不可以靜靜地印路口合計：
 *   這一筆若以「雙向合計」呈現，逐支線就沒有可以安全相加的值
 *   （駛入合計與駛出合計各自等於路口總量，相加是兩倍）。
 */
function describeComposition(
  record: ConclusionRecord,
  digits: number,
  condition: ConclusionCondition,
) {
  const wantedNames = condition.branchNames.map(typedNameKey);
  const filtering = wantedNames.length > 0;
  const line = (
    scopeText: string,
    items: { label: string; count: number }[],
    lead: string,
  ) => {
    const total = items.reduce((sum, item) => sum + item.count, 0);
    if (!total) return `${lead}（${scopeText}）：這一筆沒有可用的車種數量。`;
    const parts = items
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .map(
        (item) =>
          `${item.label} ${whole(item.count)} ${record.compositionUnit}（${pct(
            (item.count / total) * 100,
            digits,
          )}）`,
      );
    return (
      `${lead}（${scopeText}）：${parts.join("、")}；` +
      `合計 ${whole(total)} ${record.compositionUnit}。`
    );
  };

  /* 沒有篩支線＝路口合計，輸出與 v2.1.80 **逐字相同**。 */
  if (!filtering)
    return [`　${line(record.compositionScope, record.composition, "車種組成")}`];

  const wanted = new Set(wantedNames);
  const branches = (record.compositionByBranch || []).filter((branch) =>
    wanted.has(typedNameKey(branch.name)),
  );
  if (!record.compositionByBranch)
    return [
      `　${line(record.compositionScope, record.composition, "車種組成")}`,
      "　　⚠️ 上面這一行是「整個路口的合計」，沒有依指定支線篩選：這一筆的" +
        "車種資料是以「雙向合計」呈現的，逐支線沒有可以單獨列出的駛入方向數量。" +
        "要得到逐支線的車種組成，請到「車種組成分析」把該支線改成分行車方向。",
    ];
  if (!branches.length)
    return [
      "　車種組成：指定的支線在這一筆找不到對應的名稱，因此沒有可寫的車種數量。" +
        "（請確認支線名稱是否已在這一季改過。）",
    ];
  const lines = branches.map(
    (branch) =>
      `　${line(record.compositionScope + "・駛入", branch.items, `車種組成－${branch.name}`)}`,
  );
  if (branches.length > 1) {
    const merged = new Map<string, number>();
    for (const branch of branches)
      for (const item of branch.items)
        merged.set(item.label, (merged.get(item.label) ?? 0) + item.count);
    lines.push(
      `　${line(
        record.compositionScope + "・駛入",
        [...merged].map(([label, count]) => ({ label, count })),
        `車種組成－指定 ${branches.length} 條支線合計`,
      )}`,
    );
    lines.push(
      "　　（可以相加是因為這裡取的是「駛入」方向：各支線的駛入合計＝路口總量。" +
        "駛出合計也等於路口總量，兩者相加會變成兩倍。）",
    );
  }
  return lines;
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
  peaks: ConclusionScopeKey[],
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
  peaks: ConclusionScopeKey[],
  digits: number,
) {
  const lines: string[] = [];
  const ordered = group
    .slice()
    .sort((a, b) => quarterKey(a.quarter) - quarterKey(b.quarter));
  if (ordered.length < 2) return lines;
  for (const peak of peaks) {
    /*
     * ══════════════════════════════════════════════════════════════
     *  ⚠️ 2026-09-25 修正：`!== null` 擋不住 NaN
     * ══════════════════════════════════════════════════════════════
     *
     * `NaN !== null` 為 true（過得了 filter），而 `NaN` 是 falsy
     *（走進「起始季為 0」那一支）。實測到的輸出：
     *
     *   「上午尖峰總流量由 114Q4 的 — PCU/hr 變為 115Q2 的 1,000.0 PCU/hr，
     *     起始季為 0，變動幅度無法以百分比表示；期間最高為 114Q4（— PCU/hr）。」
     *
     * 同一句話前半印「—」（讀不到）、後半宣稱「是 0」；而且
     * `reduce` 以第一筆當初始值、`NaN > best.value` 恆為 false，
     * 所以「期間最高」還會挑中那個讀不到的季。整句會被抄進報告。
     *
     * NaN 的來源：recordTotal → totalMovement，任一欄缺值或當量含壞值即為 NaN
     *（與 pceFactor 的修正同源）。
     *
     * lib/report-draft.ts:582-591 對同一件事早就改用 Number.isFinite 了，
     * 這一支沒跟上。三處一起修：filter、取最大值、以及「是 0 還是讀不到」的分辨。
     */
    const points = ordered
      .map((record) => ({
        quarter: record.quarter,
        value: record.peaks[peak]?.totalPcu ?? null,
      }))
      .filter((point) => Number.isFinite(point.value as number)) as {
      quarter: string;
      value: number;
    }[];
    if (points.length < 2) {
      /*
       * ⚠️ 2026-09-25：被濾掉而湊不滿兩季時要**寫出理由**，不可以整段消失。
       *   NaN 以前是被當成「有值」硬算下去的（於是印出「起始季為 0」）；
       *   現在正確地濾掉了，但如果不交代，使用者會以為自己少勾了什麼。
       *   這與 lib/conclusion.ts 其他段落的 fallback 一致。
       */
      const unreadable = ordered.filter(
        (record) => !Number.isFinite(record.peaks[peak]?.totalPcu as number),
      ).length;
      if (unreadable)
        lines.push(
          `　${PEAK_LABEL[peak]}：有 ${unreadable} 季的總流量讀不到數值` +
            `（可能是車種欄位缺值或當量係數設定有問題），可比較的季別不足兩季，未做變動幅度比較。`,
        );
      continue;
    }
    const first = points[0];
    const last = points.at(-1)!;
    /*
     * 「基期是 0」與「基期讀不到」是兩件事，不可以講成同一句。
     * 走到這裡時 filter 已經保證兩端都是有限數，所以只剩「真的是 0」。
     */
    const change = first.value === 0 ? null : (last.value / first.value - 1) * 100;
    const peakPoint = points.reduce((best, point) =>
      point.value > best.value ? point : best,
    );
    lines.push(
      `　${PEAK_LABEL[peak]}總流量由 ${quarterText(first.quarter)} 的 ${num(first.value, digits)} ${scopeRateUnit(peak)} ` +
        `變為 ${quarterText(last.quarter)} 的 ${num(last.value, digits)} ${scopeRateUnit(peak)}，` +
        (change === null
          ? "起始季為 0，變動幅度無法以百分比表示"
          : `${change >= 0 ? "增加" : "減少"} ${pct(Math.abs(change), digits)}`) +
        `；期間最高為 ${quarterText(peakPoint.quarter)}（${num(peakPoint.value, digits)} ${scopeRateUnit(peak)}）。`,
    );
  }
  return lines;
}

/**
 * 範圍內誰最大誰最小，以及**逐筆**列出每一個路口 × 季別 × 日別。
 *
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ 2026-09-16 起**不再寫「N 筆平均」**（使用者裁示）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者原話：
 *   「每一行展示一筆季別+日別的結果，例如 A路段 在114Q1 平日結果XXX
 *     假日結果YYY，而不是要你平均起來，除非評估過後 某個數值是以平均
 *     來呈現最佳。」
 *
 * 為什麼那個平均本來就不該寫：它把**不同路口、不同季別、不同日別**的
 * 尖峰小時流量混成一個數字。那三個維度各自都不可比——
 *  ・不同路口：量的是不同地點的車
 *  ・不同季別：量的是不同時間的車
 *  ・不同日別：平日與假日本來就是兩種不同的運作狀態
 * 平均出來的值不對應真實世界任何一個路口在任何一個時段的流量。
 *
 * ⚠️ 最大／最小**保留**——那是在比大小，不是把數字混在一起，
 *   而且使用者要的「誰最忙」正是靠它回答。
 *
 * ⚠️ 筆數太多時**不給任何合計或平均**，只說明還有幾筆、請用篩選縮小範圍。
 *   給一個「總結數字」等於把剛剛拿掉的錯誤換個說法留著。
 */
/** 逐筆列出時最多幾行；超過就收起來並說明（與畫面上的小卡同一個數字）。 */
const EXTREME_LINE_LIMIT = 12;
function describeExtremes(
  records: ConclusionRecord[],
  peaks: ConclusionScopeKey[],
  digits: number,
) {
  const lines: string[] = [];
  for (const peak of peaks) {
    const points = records
      .map((record) => ({
        label: `${record.station} ${record.name}（${quarterText(record.quarter)}${
          record.surveyType && record.surveyType !== "待設定"
            ? `・${record.surveyType}`
            : ""
        }）`,
        value: record.peaks[peak]?.totalPcu ?? null,
      }))
      /*
       * ⚠️ 2026-09-25：`!== null` 擋不住 NaN，而 NaN 參與排序時
       *   所有比較都是 false → 排序結果由原始順序決定 → 「最高／最低」
       *   可能指到一個讀不到數值的紀錄（畫面上印「—」）。
       *   與 describeGrowth 同一個修法。
       */
      .filter((point) => Number.isFinite(point.value as number)) as {
      label: string;
      value: number;
    }[];
    if (points.length < 2) {
      const unreadable = records.filter(
        (record) => !Number.isFinite(record.peaks[peak]?.totalPcu as number),
      ).length;
      if (unreadable)
        lines.push(
          `　${PEAK_LABEL[peak]}：有 ${unreadable} 筆的總流量讀不到數值，` +
            `可比較的紀錄不足兩筆，未做大小比較。`,
        );
      continue;
    }
    const sorted = points.slice().sort((a, b) => b.value - a.value);
    lines.push(
      `　${PEAK_LABEL[peak]}：最高為 ${sorted[0].label} ${num(sorted[0].value, digits)} ${scopeRateUnit(peak)}，` +
        `最低為 ${sorted.at(-1)!.label} ${num(sorted.at(-1)!.value, digits)} ${scopeRateUnit(peak)}。` +
        `（各路口的尖峰小時不一定相同，此處僅比較大小，不做加總，也不取平均。）`,
    );
    if (sorted.length <= EXTREME_LINE_LIMIT)
      for (const point of sorted)
        lines.push(
          `　　・${point.label}：${num(point.value, digits)} ${scopeRateUnit(peak)}`,
        );
    else
      lines.push(
        `　　（共 ${sorted.length} 筆，逐筆列出過長，此處不列；` +
          `不同路口、季別與日別的流量不可以相加，也不取平均，` +
          `要看個別數值請縮小路口或季度範圍後重新產生。）`,
      );
  }
  return lines;
}

function recordTitle(record: ConclusionRecord) {
  const type = record.surveyType && record.surveyType !== "待設定"
    ? `・${record.surveyType}`
    : "";
  return `${quarterText(record.quarter)}　${record.station}　${record.name}${type}`;
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
  quarterText =
    typeof meta.showQuarter === "function"
      ? meta.showQuarter
      : (quarter: string) => String(quarter ?? "");
  /* 舊版範本可能缺欄位，一律先補成完整形狀再用（見 normalizeCondition）。 */
  const condition = normalizeCondition(rawCondition);
  const chosen = selectRecords(records, condition);
  /* 空陣列是有效的選擇（不敘述尖峰時段），不要在這裡又補回預設。 */
  const peaks = condition.peaks;
  const digits = condition.digits;
  const out: string[] = [];

  out.push(`【結論草稿】${scopeLabel(condition.scope, chosen, quarterText)}`);
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
  /*
   * 「涵蓋幾個調查日」（使用者 2026-09-23 核准新增）。
   *
   * ⚠️ 去重之後才算：同一天做了三個路口是**一個**調查日，不是三個。
   *   儀表板那張卡也是這樣算的（`new Set(current.map(r => r.date)).size`），
   *   兩處必須是同一個口徑。
   * ⚠️ 沒有日期的紀錄不計入，而且要講出來——否則「涵蓋 2 個調查日」
   *   會被讀成「這批資料只做了兩天」，而事實可能是還有五筆沒有日期。
   * ⚠️ 一筆日期都讀不到時整段不寫（寫「0 個調查日」是錯的說法）。
   */
  const surveyDays = Array.from(
    new Set(chosen.map((r) => r.surveyDate).filter((date) => Boolean(date))),
  );
  const undatedCount = chosen.filter((r) => !r.surveyDate).length;
  const surveyDayText = surveyDays.length
    ? `（涵蓋 ${surveyDays.length} 個調查日` +
      (undatedCount ? `，另有 ${undatedCount} 筆讀不到調查日期` : "") +
      "）"
    : "";
  out.push("");
  out.push(
    `統計範圍：${quarters.length} 個季度（${quarters.map(quarterText).join("、")}）、` +
      `${intersections.length} 個路口、共 ${chosen.length} 筆調查紀錄${surveyDayText}；` +
      `資料別：${surveyTypeText2}；` +
      (peaks.length
        ? `敘述時段：${peaks.map((p) => PEAK_LABEL[p]).join("、")}。`
        : "敘述時段：不敘述尖峰時段，只寫全調查時段的數值。"),
  );
  /*
   * ── 條件與「不適用」一定要寫進草稿本身（使用者 2026-09-15）──────
   *
   * ⚠️ 這段文字會被整段貼進報告，而報告上看不到畫面——
   *   看報告的人無從得知這些數字是「只算左轉」還是「全部轉向」。
   * ⚠️ 「尖峰時段判定方式」則是**這一份草稿做不到的條件**，必須明講：
   *   草稿的每一筆紀錄要同時提供上午／下午／全調查時段三個時段的數字，
   *   而「各方向各自認定」是逐時段各自重新挑尖峰、每個時段得到一份
   *   不同的紀錄——一筆紀錄裝不下三份。所以這裡一律是
   *   「整個調查點同一時段」，也就是**可以相加**的那一種。
   *   不寫的話，同一批資料在報告文字草稿與結論草稿會給出不同的尖峰量，
   *   而兩份都看起來很合理。
   */
  out.push(
    "統計條件：轉向別＝" +
      (condition.movement === "left"
        ? "左轉"
        : condition.movement === "through"
          ? "直行"
          : condition.movement === "right"
            ? "右轉"
            : "全部轉向") +
      "；車種＝" +
      (meta.vehicleLabel || "全部車種") +
      `；數值小數 ${digits} 位。`,
  );
  /*
   * ⚠️ 2026-09-23：這一句原本是無條件印的——因為當時草稿**真的做不到**
   *   「各方向各自認定」。現在做得到了（`peaks` 本來就按時段分開存，
   *   所以每一個時段可以各自吃自己那一份重挑過的紀錄），所以這裡改成
   *   **照實寫出這一份草稿用的是哪一種**。
   *
   * ⚠️ 選「各方向各自認定」時，最重要的那句話是**不可以相加**：
   *   各支線的尖峰不在同一小時，把它們加起來得到的不是任何一個時刻的量。
   *   畫面與報告文字草稿本來就印著同一句警告（report-draft.ts 的
   *   `⚠️ 本數值不適用「相加」`），三處要一致。
   */
  /*
   * ══════════════════════════════════════════════════════════════════
   *  ⚠️ 2026-09-25 修正：宣告的判定方式必須是**真的套用到的**那一個
   * ══════════════════════════════════════════════════════════════════
   *
   * 舊寫法照 `condition.peakRule` 無條件寫抬頭。但
   * `recordWithApproachPeaks()` 對 `peak === "FULL"` **無條件回 null**
   *（設計如此：全調查時段是一段累計量，不是一個尖峰小時，沒有視窗可挑）。
   *
   * 於是勾了「全調查時段」＋「各方向各自認定」時，實測輸出是：
   *     有宣告「各方向各自認定」＝true、有印「不適用『相加』」＝true
   * 而那些數字**一次都沒有被重挑過**，而且全調查時段的累計量
   * **正是可以相加的**——草稿對可相加的數字印「請勿相加」，
   * 又宣告了一個完全沒套用的判定方式。
   *
   * 改成逐時段說清楚：能套用的時段照實寫，FULL 這種套不上的要點名，
   * 並且**只有真的有時段套用到 direction 時**才印「不適用相加」那句警告。
   * 這與 lib/conclusion.ts 自己寫的「畫面那邊已經因為同一個理由把算不出來的
   * 紀錄列出來明講，草稿要一致」一致。
   */
  const directionAble = peaks.filter((peak) => peak !== "FULL");
  const directionUnable = peaks.filter((peak) => peak === "FULL");
  if (condition.peakRule === "direction") {
    if (directionAble.length)
      out.push(
        "尖峰時段判定方式：各方向各自認定自己的尖峰" +
          `（逐時段替每一條支線挑它自己最忙的那一小時）；套用於：${directionAble
            .map((peak) => PEAK_LABEL[peak])
            .join("、")}。` +
          /* ⚠️ 這一句的字面要與畫面、報表草稿（report-draft.ts）完全一致——
             三處同一句話，任何一處改字就會漂移，tests/conclusion.test.ts
             也釘著它。所以維持「本數值不適用「相加」」不改。 */
          "⚠️ 本數值不適用「相加」：各支線的尖峰不在同一小時，" +
          "各支線的量相加不等於路口總量，也不是任何一個時刻的量，請勿相加。",
      );
    if (directionUnable.length)
      out.push(
        `尖峰時段判定方式：${directionUnable
          .map((peak) => PEAK_LABEL[peak])
          .join("、")}不套用「各方向各自認定自己的尖峰」` +
          "——那是一段累計量，不是一個尖峰小時，沒有視窗可以各自挑。" +
          "這個時段的各支線量仍然可以相加，合計等於路口總量。",
      );
    if (!directionAble.length && !directionUnable.length)
      out.push("尖峰時段判定方式：本次沒有勾選任何時段。");
  } else {
    out.push(
      "尖峰時段判定方式：整個調查點同一時段（各支線的尖峰在同一小時，各支線的量可以相加，" +
        "合計等於路口總量）。要改成「各方向各自認定自己的尖峰」請在上方條件切換。",
    );
  }
  /*
   * ⚠️ 這一句要把**這一次真的會出現的單位**列出來，不可以寫死。
   *   舊版無條件寫「（PCU/hr、輛、%）」——使用者只勾「全調查時段」時，
   *   草稿裡一個 PCU/hr 都不會出現，說明卻還在講它；
   *   反過來也會讓人以為全調查時段的數字也是一小時的流率。
   *   這種「說明與內容不符」正是這個專案一再出事的類型。
   */
  /*
   * 「全調查時段」逐筆依實際涵蓋標示單位。選到 24 小時與部分時段的紀錄時，
   * 下方內容會同時出現「／調查日」與「／調查時段」；抬頭也必須把兩種都列出，
   * 不可以只用一個保守單位描述整批，否則說明會漏掉正文實際使用的單位。
   */
  const fullCoverages: ConclusionRecord["surveyCoverage"][] = chosen.length
    ? [...new Set(chosen.map((record) => record.surveyCoverage ?? "unknown"))]
    : ["unknown"];
  const fullRateUnits = [
    ...new Set(fullCoverages.map((coverage) => scopeRateUnit("FULL", coverage).replace("/", "／"))),
  ];
  const fullVehicleUnits = [
    ...new Set(fullCoverages.map((coverage) => scopeVehicleUnit("FULL", coverage).replace("/", "／"))),
  ];
  const unitsInUse = [
    ...(peaks.some((peak) => peak !== "FULL") ? ["PCU/hr", "輛/hr"] : []),
    ...(peaks.includes("FULL") ? [...fullRateUnits, ...fullVehicleUnits] : []),
    "輛",
    "%",
  ];
  out.push(
    "本數值不適用「顯示數值」條件：草稿裡每一句各自標明自己的單位" +
      `（${unitsInUse.join("、")}），不跟著主工具列的「顯示數值」切換。`,
  );
  if (condition.branchNames.length) {
    /*
     * ⚠️ 不可以直接把 condition.branchNames 印出來。
     *   它存的是 typedNameKey() 的輸出（小寫、去空白與標點），
     *   直接印會變成「只敘述指定支線：路口a、路口b」——內部鍵值外洩到草稿裡，
     *   而草稿是會被整段貼進報告的。
     *   這裡回頭從實際挑到的資料取原本的名稱來寫；
     *   一條都對不到時（例如舊範本指到已經改名的支線）才退回顯示鍵值，
     *   那種情況本來就該讓使用者看見哪裡對不上。
     */
    const wanted = new Set(condition.branchNames.map(typedNameKey));
    const shown = new Map<string, string>();
    for (const record of chosen)
      for (const peak of Object.values(record.peaks))
        for (const branch of peak?.branches || []) {
          const key = typedNameKey(branch.name);
          if (wanted.has(key) && !shown.has(key)) shown.set(key, branch.name);
        }
    const names = condition.branchNames.map(function (value) {
      return shown.get(typedNameKey(value)) ?? value;
    });
    out.push(`只敘述指定支線：${names.join("、")}。`);
    /*
     * ══════════════════════════════════════════════════════════════════
     *  ⚠️ 支線條件**不是每一個指標都吃得到**——吃不到的要逐項講明
     * ══════════════════════════════════════════════════════════════════
     *
     * 2026-09-23 的反向對帳抓到：勾了支線之後，抬頭寫著「只敘述指定支線：
     * 路口A」，但下面這幾個指標仍然是**整個路口**的數字：
     *   ・總流量／總車輛數（`data.totalPcu`／`data.totalVehicles`）
     *   ・季度之間的變動幅度（同樣讀 totalPcu）
     *   ・範圍內的最大／最小路口（同樣讀 totalPcu）
     * 實測：支線「路口A」駛入 400，草稿仍寫「總流量 1,000.0 PCU/hr」。
     *
     * ⚠️ 為什麼**不是**改成「只加總所選支線」：
     *   路口總量是既有的、與畫面一致的數字；把它改成所選支線的和，
     *   等於偷偷換一個口徑，而且駛入與駛出相加會得到剛好兩倍的假總量
     *   （這一點本檔別處已經警告過）。使用者 2026-09-23 也明講
     *   「不要因為補功能而讓現有功能異常」。
     *   所以這裡採用本專案既有的做法：**篩不了就明講篩不了與為什麼**
     *   （與 describeComposition 2026-09-21 的修法同一套）。
     */
    out.push(
      "本數值不適用「支線」條件的部分：「總流量」「總車輛數」「季度之間的變動幅度」" +
        "「範圍內的最大／最小路口」這四項是「整個路口」的數字，不是所選支線的和" +
        "（各支線的駛入與駛出相加會得到兩倍的假總量，所以系統不替你加）。" +
        "要看單一支線的量，請看下面各支線逐條列出的那幾行。",
    );
  }
  /*
   * 沒有寫任何時段時，草稿裡不會出現這些單位，這句說明反而讓人困惑。
   *
   * ⚠️ 兩種單位要分開講。使用者勾了「全調查時段」卻讀到「這是一小時的流率」，
   *   會把一整段的累計量當成流率抄進報告——那正是這一段要防的事。
   */
  /*
   * ══════════════════════════════════════════════════════════════════════
   *  ⚠️ 車種組成**不吃時段、也不吃轉向別與車種**——這三件都要講明
   * ══════════════════════════════════════════════════════════════════════
   *
   * 2026-09-23 的反向對帳抓到三件「抬頭宣告了、內容沒套用」：
   *
   * ① **時段**：`describeComposition()` 的範圍固定是 `record.compositionScope`
   *    （由畫面端依 `record.survey` 有沒有量決定），**沒有 peak 參數**。
   *    實測：peaks 設 AM／PM／FULL，車種組成那一行**逐字相同**。
   *    而 Excel 的「車種組成分析」是逐筆輸出 SURVEY＋AM＋PM＋DAY 四個範圍的。
   *
   * ② **轉向別**與 ③ **車種**：這兩個條件是在紀錄層套的
   *    （`recordWithMovementFilter` → `recordWithVehicleFilter`），
   *    而那兩支只改寫 `route.volumes` 與 `approach.movements`，
   *    **完全沒碰 `record.survey` 與 `route.survey`**——
   *    車種組成與各支線各車種讀的正是後者，所以數字一個都不會變。
   *    畫面上的車種組成分析頁對這兩項**有**明寫的「不適用」提示，草稿漏了。
   *
   * ⚠️ 為什麼不是「讓它跟著變」：那要動到資料層供給哪些範圍的組成，
   *   是既有功能的口徑改動，風險遠大於收益（使用者 2026-09-23：
   *   「不要因為補功能而讓現有功能異常」）。
   *   本專案既有的處理方式就是**篩不了就明講篩不了與為什麼**。
   */
  const usesComposition = (["composition", "branchCompositionIn", "branchCompositionOut"] as ConclusionMetricKey[]).some(
    (key) => condition.metrics.includes(key),
  );
  if (usesComposition) {
    const notApplicable: string[] = [];
    if (peaks.length) notApplicable.push("「時段」");
    if (condition.movement && condition.movement !== "all")
      notApplicable.push("「轉向別」");
    if (meta.vehicleLabel) notApplicable.push("「車種」");
    if (notApplicable.length)
      out.push(
        `本數值不適用${notApplicable.join("與")}條件的部分：` +
          "「車種組成」與「各支線各車種」讀的是整份調查的車種統計" +
          "（與畫面上的車種組成分析頁同一份），它不隨時段改變，" +
          "也不吃轉向別與車種的篩選。要看逐時段或逐轉向的車種數字，" +
          "請用匯出中心的「車種組成分析」工作表。",
      );
  }
  const hasRateScope = peaks.some((peak) => peak !== "FULL");
  const hasFullScope = peaks.includes("FULL");
  if (hasRateScope)
    out.push(
      "說明：PCU/hr 與 輛/hr 是該尖峰「一小時」的流率，僅在同一筆紀錄內可相加；" +
        "不同路口、不同季度之間只做比較，不做加總。",
    );
  if (hasFullScope)
    out.push(
      `說明：「全調查時段」依每筆調查的實際涵蓋標示單位（${[
        ...fullRateUnits,
        ...fullVehicleUnits,
      ].join("、")}），` +
        "是這份調查「實際涵蓋的整段時間」的累計量，不是一小時的流率；" +
        "它和上午尖峰、下午尖峰、全調查時段尖峰的數字不可以相加、也不可以直接比大小。" +
        "（調查滿 24 小時時，這一段涵蓋剛好等於一個調查日。）",
    );

  const wants = (key: ConclusionMetricKey) => condition.metrics.includes(key);
  /*
   * ── 駛入與駛出**不可以相加**（使用者 2026-09-21 指定）─────────────
   *
   * 四條支線的駛出合計＝駛入合計＝路口總量（同一批車依終點重新分組，
   * 總量不變）。所以草稿同時寫出兩個方向時，讀者很容易把兩欄加起來，
   * 得到**剛好兩倍**的「路口總量」，而這個數字看起來完全合理。
   * 「各支線的雙向合計」再相加也是同一個兩倍。
   *
   * ⚠️ 這一句只在**真的兩個方向都寫出來**時才印。單方向時印它反而製造困惑。
   */
  const writesInflow =
    wants("inflowPcu") || wants("inflowVehicles") || wants("branchCompositionIn");
  const writesOutflow =
    wants("outflowPcu") || wants("outflowVehicles") || wants("branchCompositionOut");
  if (writesInflow && writesOutflow && peaks.length)
    out.push(
      "⚠️ 說明：草稿同時寫出「駛入」與「駛出」。這兩組數字不可以相加——" +
        "各支線的駛出合計＝駛入合計＝路口總量（同一批車依終點重新分組），" +
        "相加會得到剛好兩倍的假總量；各支線的「雙向合計」相加也是同樣的兩倍。" +
        "要寫路口總量請直接用「路口總流量與總車輛數」那一項。",
    );
  /*
   * 各支線的車種輛數是寫在「某一個尖峰」底下的，一個尖峰都沒選時根本不會
   * 出現，這句說明也就不必印——印了會讓人以為下面有東西卻找不到。
   */
  const wantsBranchIn = wants("branchCompositionIn");
  const wantsBranchOut = wants("branchCompositionOut");
  if ((wantsBranchIn || wantsBranchOut) && peaks.length)
    out.push(
      "說明：各支線各車種輛數取自「車種組成分析」的『全調查時段道路方向車種數量』，" +
        "單位是 輛／調查時段（整個調查期間的累計），不能和尖峰的 輛/hr 相比或相加；" +
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
   * 一個時段都不選是允許的（例如只要各路口的車種組成那一行），但這時
   * 「要寫哪些數字」裡至少得有一項是**不寫在時段底下**的，否則草稿只會剩標題。
   *
   * ⚠️⚠️ v2.1.82 起「都不勾」**不再等於「全調查時段」**。
   *   全調查時段現在是第四個可以勾的選項（FULL），使用者 2026-09-21 定案。
   *   舊版把「都不勾」當成一個隱藏的第四種狀態，後果是：
   *     ・沒辦法同時要「上午尖峰」和「全調查時段」；
   *     ・畫面上要靠一句說明文字去教使用者一個看不見的狀態。
   *   **不要再把這個隱藏狀態加回來。**
   *
   * ⚠️ 這張清單要列出**每一個不依附時段的指標**，不是只列一個。
   *   v2.1.80 以前這裡是 `["composition"]`——只放了一樣，於是
   *   「只勾車種組成以外的無時段指標」就會被誤判成「沒有東西可產生」。
   *   新增不依附時段的指標時，**一定要同時加進這張清單**。
   */
  const SCOPE_FREE_METRICS: ConclusionMetricKey[] = [
    /* 車種組成：整段調查的累計，本來就不分時段。 */
    "composition",
    /*
     * ⚠️ 2026-09-23：`fullDay` **從這張清單移除**。
     *
     *   它的值確實是整份調查的累計（不依附某一個尖峰），但它**只在
     *   `describePeak()` 裡輸出**，而 `describePeak` 只被
     *   `for (const peak of peaks)` 呼叫。列在這張清單裡等於讓守門放行，
     *   於是「只勾全調查時段流量、把四個時段都取消」會產出一份
     *   **只剩標題、零數字、零說明**的草稿——而畫面上「符合條件 N 筆」還亮著。
     *
     *   使用者原話：「不要讓使用者出了題卻無法抓出答案來，但明明表格中
     *   卻能查到答案」。這就是那個情形的字面版本。
     *
     *   修法刻意選**最小的那一種**：讓守門正確攔下來，並且**指名**是哪幾個
     *   指標需要時段、該勾哪一個。不改 describePeak 的輸出路徑——
     *   那條路徑是既有功能，動它的風險大於收益。
     */
  ];
  /** 這幾個指標一定要有時段才寫得出來；訊息要指名，不可以只說「請勾一個時段」。 */
  const NEEDS_PEAK_LABEL: Partial<Record<ConclusionMetricKey, string>> = {
    fullDay: "全調查時段流量",
  };
  if (!peaks.length && !SCOPE_FREE_METRICS.some((key) => wants(key))) {
    const blocked = (Object.keys(NEEDS_PEAK_LABEL) as ConclusionMetricKey[])
      .filter((key) => wants(key))
      .map((key) => NEEDS_PEAK_LABEL[key]!);
    out.push("");
    out.push(
      "目前四個時段（上午尖峰、下午尖峰、全調查時段、全調查時段尖峰）一個都沒有勾，" +
        "而「要寫哪些數字」裡選的項目都是寫在時段底下的，因此沒有內容可以產生。" +
        "請至少勾一個時段，或改勾「車種組成」這類不分時段的項目。",
    );
    if (blocked.length)
      out.push(
        `⚠️ 其中「${blocked.join("」「")}」看名字像是不分時段，但它是寫在時段底下的：` +
          "請把「全調查時段」那一個時段勾起來，就會寫出來。",
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
          out.push(`　〔${quarterText(record.quarter)}${quarterTag(record)}〕`);
        for (const peak of peaks)
          out.push(...describePeak(record, peak, condition));
        if (wants("composition"))
          out.push(...describeComposition(record, digits, condition));
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
      heading(`${quarterText(quarter)}（共 ${group.length} 筆）`);
      for (const record of group) {
        out.push(`　〔${record.station}　${record.name}〕`);
        for (const peak of peaks)
          out.push(...describePeak(record, peak, condition));
        if (wants("composition"))
          out.push(...describeComposition(record, digits, condition));
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
    /*
     * ⚠️ 稽核表 J：**代表紀錄不可以是「陣列的第一筆」**。
     *
     * 舊版寫 `chosen.slice(0, 1)`，而 selectRecords() 的排序是
     * 「季度由小到大、再站號字典序」——所以那一筆是**最舊一季、站號最小**的。
     * 報告要引用的通常是最新一季，挑法連方向都相反，而畫面上只寫著
     * 「代表紀錄：…」，沒有人看得出它是怎麼挑的。
     *
     * 改成：取**最新一季**，而且把「怎麼挑的」與「沒有涵蓋到哪些」都寫出來。
     * 系統仍然不替使用者決定要用哪一筆——它只是不再假裝「第一筆」是中立的。
     * 這與 describeExtremes（稽核表 K／③）同一條規則：不取平均、不合計，
     * 要嘛逐筆列出，要嘛講清楚這一行只代表哪一筆。
     */
    const representative = chosen.length
      ? chosen.reduce(function (best, record) {
          const diff = quarterKey(record.quarter) - quarterKey(best.quarter);
          if (diff > 0) return record;
          if (diff < 0) return best;
          return record.station < best.station ? record : best;
        })
      : null;
    if (representative) {
      out.push(
        `　代表紀錄：${recordTitle(representative)}` +
          (chosen.length > 1 ? "（範圍內最新的一季；同季時取站號較小者）" : ""),
      );
      for (const peak of peaks)
        out.push(...describePeak(representative, peak, condition));
      if (wants("composition"))
        out.push(...describeComposition(representative, digits, condition));
    }
    if (chosen.length > 1) {
      const others = chosen
        .filter((record) => record !== representative)
        .map(recordTitle);
      out.push(
        `　（範圍內共 ${chosen.length} 筆；支線與車種這類不能跨路口相加的數字，` +
          `僅以上列這一筆為代表，其餘 ${others.length} 筆沒有寫進這一段：` +
          (others.length <= EXTREME_LINE_LIMIT
            ? others.join("、")
            : `${others.slice(0, EXTREME_LINE_LIMIT).join("、")} 等`) +
          `。要逐筆寫出請改選「依路口分段」或「依季度分段」。）`,
      );
    }
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
