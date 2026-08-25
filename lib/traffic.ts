import * as XLSX from "xlsx";

export type PeakKey = "AM" | "PM";
export type MovementKey = "left" | "through" | "right";
export type PceVehicle = string;
export type VehicleKey = "all" | PceVehicle;
export type LaneClass = "fast" | "slow" | "motorcycle" | "other";
/** mixed/left/custom are retained only so older JSON backups remain readable. */
export type LaneType = LaneClass | "mixed" | "left" | "custom";

export type Project = {
  id: string;
  code: string;
  name: string;
  client: string;
  note: string;
  createdAt: string;
  /**
   * 這個計畫要匯出哪些分析項目（見 lib/final-features 的 REPORT_ITEMS）。
   * 不同計畫要交的東西不一樣，所以記在計畫上；未設定時採用預設組合。
   */
  reportItems?: string[];
};

export type PceMatrix = Record<PceVehicle, Record<MovementKey, number>>;

export type VehicleDefinition = {
  id: PceVehicle;
  label: string;
  /** Core classes keep legacy four-vehicle imports byte-for-byte compatible. */
  core: boolean;
};

export const CORE_VEHICLE_LABELS: Record<string, string> = {
  motorcycle: "機車",
  car: "小型車",
  heavy: "大型車",
  special: "特種車",
};

export function pceFactor(
  pce: PceMatrix,
  vehicle: PceVehicle,
  movement: MovementKey,
) {
  return Number(pce[vehicle]?.[movement] ?? 1);
}

// The user-supplied training deck (slide 15) is the only supplied source with a
// complete 4-vehicle × 3-movement matrix. The UI identifies it as an editable,
// legacy project default rather than attributing it to the 2022 manual.
export const DEFAULT_PCE: PceMatrix = {
  special: { left: 2.5, through: 2, right: 2.3 },
  heavy: { left: 2.3, through: 1.5, right: 2 },
  car: { left: 1.5, through: 1, right: 1.3 },
  motorcycle: { left: 0.5, through: 0.3, right: 0.4 },
};

export const LANE_GUIDANCE: Record<
  LaneType,
  { label: string; min: number; max: number; recommended: number; note: string }
> = {
  fast: {
    label: "快車道",
    min: 1200,
    max: 1600,
    recommended: 1400,
    note: "本系統初篩經驗值，可依計畫校估；不是手冊通用固定容量",
  },
  slow: {
    label: "慢車道",
    min: 500,
    max: 900,
    recommended: 700,
    note: "本系統初篩經驗值；混合車種、停車與路側干擾會改變容量",
  },
  motorcycle: {
    label: "機車專用車道",
    min: 500,
    max: 900,
    recommended: 700,
    note: "以 PCU/hr 作初篩；正式分析仍應依車道寬與機車疏解特性",
  },
  other: {
    label: "其他／自訂車道",
    min: 100,
    max: 3000,
    recommended: 1000,
    note: "無法歸類時的暫用值，建議在進階設定中修改",
  },
  mixed: {
    label: "舊版：混合車道",
    min: 500,
    max: 1400,
    recommended: 700,
    note: "舊備份相容；新資料請改用快、慢、機車專用或其他",
  },
  left: {
    label: "舊版：左轉車道",
    min: 1000,
    max: 1600,
    recommended: 1400,
    note: "舊備份相容；轉向用途改由流向資料表達",
  },
  custom: {
    label: "舊版：自訂",
    min: 100,
    max: 3000,
    recommended: 1000,
    note: "舊備份相容；新資料請改用其他／自訂車道",
  },
};

export const ACTIVE_LANE_CLASSES: LaneClass[] = [
  "fast",
  "slow",
  "motorcycle",
  "other",
];

export type Movement = {
  left: number;
  through: number;
  right: number;
  vehicle: Record<string, number>;
  /** Actual-vehicle total for the same scope/time as vehicle, never PCU. */
  rawVehicleTotal?: number | null;
};

export type RouteVolume = {
  pcu: number;
  vehicle: Record<string, number>;
};

export type RouteFlow = {
  id: string;
  fromApproachId: string;
  toApproachId: string;
  movement: MovementKey;
  volumes: Record<PeakKey, RouteVolume>;
  /** Actual vehicles for the complete imported survey period. */
  survey?: {
    vehicle: Record<string, number>;
  };
};

/** 轉向圖「藍框流量顯示」的三種模式，也是圖卡版面的保存單位。 */
export type FlowLayoutMode = "both" | "inbound" | "outbound";

export type Approach = {
  id: string;
  /** A/B/C... read from the source workbook; independent of drawing angle. */
  sourceCode?: string;
  name: string;
  bearing: string;
  angle: number;
  lanes: number | null;
  laneType?: LaneType;
  laneComposition?: Partial<Record<LaneClass, number>>;
  saturationFlow?: number | null;
  effectiveGreen?: number | null;
  cycleLength?: number | null;
  capacity: number | null;
  /** 舊版：整支支線（駛入＋駛出卡）共用的位移。保留以相容既有備份。 */
  cardOffset?: { x: number; y: number };
  /**
   * 每一張圖卡各自的位移。駛入卡與駛出卡可以分別拖到不同位置，
   * 舊資料只有 cardOffset 時兩張卡會沿用同一組數值。
   */
  cardOffsets?: Partial<
    Record<"inbound" | "outbound", { x: number; y: number }>
  >;
  /** 路口標籤（例如「路口A」）的位移，讓使用者可把標籤拖離道路或圖卡。 */
  labelOffset?: { x: number; y: number };
  /**
   * 各「藍框流量顯示」模式各自的版面。
   *
   * 只看駛入、只看駛出、駛入＋駛出三種畫面上，卡片數量與位置需求完全不同
   * （例如只看駛入時想把卡片擺左邊，駛入＋駛出時想擺右邊），因此每種模式
   * 各自保存一組圖卡與標籤位置，彼此互不干擾。
   * 某個模式尚未調整過時，會沿用上面的 cardOffsets／cardOffset／labelOffset
   * 作為共同起點，確保既有備份與 v2.1.0 的資料不會跑位。
   */
  cardLayouts?: Partial<
    Record<
      FlowLayoutMode,
      {
        cards?: Partial<
          Record<"inbound" | "outbound", { x: number; y: number }>
        >;
        label?: { x: number; y: number };
      }
    >
  >;
  movements: Record<PeakKey, Movement>;
};

export type ReviewStatus = "待核對" | "已核對" | "已確認" | "需修正";

export type SourceCellTrace = {
  peak: PeakKey;
  sheet: string;
  cell: string;
  time: string;
  approach: string;
  destination: string | null;
  movement: MovementKey | null;
  vehicle: string;
  vehicleLabel: string;
  rawCount: number;
  factor: number;
  pcu: number;
};

export type TrafficRecord = {
  id: string;
  projectId?: string;
  intersectionId?: string;
  station: string;
  name: string;
  rawName: string;
  quarter: string;
  date: string;
  surveyType: string;
  /** Snapshot used for this import so future coefficient changes remain auditable. */
  pceUsed?: PceMatrix;
  pceVersion?: string;
  peaks: Record<PeakKey, { start: string; end: string }>;
  /** Actual vehicles over every imported 15-minute survey interval; no PCU factors. */
  survey?: {
    intervals: number;
    minutes: number;
    vehicle: Record<string, number>;
  };
  /** Labels of the analysis classes stored in vehicle count objects. */
  vehicleLabels?: Record<string, string>;
  /** Source header -> analysis class snapshot selected before import. */
  vehicleMapping?: Record<string, string>;
  approaches: Approach[];
  /** Explicit origin-to-destination flows. Required for five-to-seven-arm intersections. */
  routes?: RouteFlow[];
  /** How OD routes were classified as left/through/right. */
  movementRule?: "reference-calculation" | "geometry-suggested" | "manual";
  /**
   * 使用者在「路口名稱管理」自己打過的名稱。設了這個旗標之後，重新整理時
   * 就不再對名稱跑一次正規化——否則使用者刻意加的括號、破折號、叉路口字樣
   * 會在下次開啟時被清掉，看起來像系統自己把名字改了。
   */
  nameEdited?: boolean;
  /** Per road branch: show inbound/outbound separately or as a two-way total. */
  directionDisplay?: Record<string, "split" | "two-way">;
  /** Manual approval lock for a checked quarterly result. */
  resultLock?: {
    lockedAt: string;
    version: string;
    signature: string;
  };
  /** Review workflow is separate from the immutable result lock. */
  review?: {
    status: ReviewStatus;
    updatedAt: string;
    note: string;
  };
  /** Import revision number for duplicate/overwrite audit. */
  revision?: number;
  /** Cell-level lineage retained from the source workbook. */
  sourceTrace?: {
    templateId: string;
    templateName: string;
    dateSource: { sheet: string; cell: string; raw: string } | null;
    cells: SourceCellTrace[];
    intervals: Array<{
      start: number;
      end: number;
      pcu: number;
      vehicles: number;
    }>;
  };
  sourceFiles: string[];
  importedAt: string;
  validation: {
    referenceFound: boolean;
    matchRate: number | null;
    notes: string[];
  };
};

export type QualityIssue = {
  id: string;
  severity: "error" | "warning" | "info";
  category: "缺值" | "總數不一致" | "尖峰時段異常" | "車種統計異常";
  station: string;
  quarter: string;
  message: string;
  details?: {
    turningVehicleTotal: number;
    classifiedVehicleTotal: number;
    difference: number;
    unit: "輛/hr";
    explanation: string;
  };
};

/**
 * 匯入時判斷「這一筆和既有紀錄是不是同一份調查」。
 *
 * 規則：同計畫＋同季度＋同站號，而且資料別（平日／假日）也一樣。
 *
 * 唯一的例外是「待設定」——它不是一種資料別，而是**當時還不知道**
 * （原始檔的日期沒寫「（平日）」，工作表名稱也看不出來）。如果拿它當一般
 * 資料別比對，重新匯入同一個檔案（這次讀出了平日）就會被當成另一份調查，
 * 同一個路口同一季會同時留下「待設定」與「平日」兩筆，使用者以為重匯就會
 * 修好，畫面上卻還是看得到待設定。所以待設定的紀錄要能被有資料別的新匯入
 * 接手。
 *
 * 反過來不成立：已經是平日的紀錄不會被一筆待設定的新匯入接手，
 * 那等於拿「不知道」去覆蓋「已經知道」。
 */
export function isSameSurvey(
  record: { projectId?: string; quarter?: string; station?: string; surveyType?: string },
  item: { station?: string; surveyType?: string },
  context: { projectId?: string; quarter?: string },
) {
  if (record.projectId !== context.projectId) return false;
  if (record.quarter !== context.quarter) return false;
  if (record.station !== item.station) return false;
  const recordType = record.surveyType || "待設定";
  const itemType = item.surveyType || "待設定";
  if (recordType === itemType) return true;
  return recordType === "待設定" && itemType !== "待設定";
}

/**
 * 判斷這一筆調查的「資料別」（平日／假日）。
 *
 * 依序看三個地方，先讀到的先用：
 *
 *  1. 呼叫端指定的（一個檔案同時有「平日」「假日」兩張工作表時，
 *     每一張各產生一筆，資料別由工作表名稱直接指定）。
 *
 *  2. 日期字樣裡的括號：「日期：115年05月04日(平日)」→ 平日。
 *     括號內不限平日／假日，寫什麼就存什麼（有些案子會寫「路口轉向」之類）。
 *
 *  3. **交通量工作表的名稱**：整份只有一張叫「平日」（或「假日」）的
 *     工作表時，那就是這份調查的資料別。
 *
 *     這一段是後來補的。原本只有第 2 點，而工作表名稱只在「同時有平日與
 *     假日兩張」時才會用到；於是「只做了一天、日期欄沒寫括號、但工作表就
 *     叫平日」的檔案會被判成「待設定」——資訊明明就在檔案裡，只是沒去讀。
 *     實際案例：120507T501／T502／T503，日期欄是「日期：115年04月15日」
 *     （沒有括號），工作表叫「平日」。
 *
 * 三個地方都讀不到才是「待設定」——意思是**這一筆還不知道**，
 * 不是第三種資料別，之後可以在「流量核對工作台」補，或重新匯入時被補上。
 */
export function resolveSurveyType(input: {
  explicit?: string;
  dateText?: string;
  sheetNames?: string[];
}) {
  if (input.explicit) return input.explicit;
  const inParentheses = (input.dateText || "").match(
    /[（(]\s*([^）)]+)\s*[）)]/,
  )?.[1];
  if (inParentheses) return inParentheses;
  const fromSheets = Array.from(
    new Set(
      (input.sheetNames || [])
        .map(function (sheet) {
          return sheet.normalize("NFKC").trim();
        })
        .filter(function (sheet) {
          return sheet === "平日" || sheet === "假日";
        }),
    ),
  );
  /* 只有一種時才敢用；同時有平日與假日是另一條路徑（每張各產生一筆）。 */
  if (fromSheets.length === 1) return fromSheets[0];
  return "待設定";
}

export const VERSION = "v2.1.23";
export const VERSION_HISTORY = [
  {
    version: "v2.1.23",
    date: "2026-08-25",
    note: "結論草稿產生器的「時段」可以兩個都不勾。使用者的實際需求是「我只要某個路口全調查時段的車種組成那一行」，但舊版強制至少保留一個尖峰——取消最後一個時會被自動加回去，於是草稿一定夾帶不要的尖峰段落，只能產生完再自己刪。現在**兩個都不勾＝不敘述尖峰時段**，只寫全調查時段的數值；統計範圍那一行會寫明「不敘述尖峰時段」，而且沒有尖峰時就不再印「PCU/hr 是該尖峰一小時的流率」那句說明（草稿裡根本不會出現 PCU/hr）。若兩個都不勾、「要寫哪些數字」卻只選了寫在尖峰底下的項目，草稿會直接說明產生不出內容、請改勾「車種組成」，而不是交出一份只有標題的空草稿。**沒有動任何計算**：有勾時段時的輸出與 v2.1.22 完全相同，已用測試釘住。另外修正一個相關的小陷阱——舊範本沒有 peaks 欄位時仍要補上預設的上午＋下午，但「有欄位、是空陣列」是使用者刻意的選擇，不可以被補回預設；這兩種情況以前被當成同一件事。新增 5 項單元測試。",
  },
  {
    version: "v2.1.22",
    date: "2026-08-24",
    note: "修正使用者回報的兩項，另外查出並修掉一個會讓資料整個不見的嚴重問題。(1) **全新的瀏覽器從頭到尾不會存檔**（本輪查出，使用者沒回報但影響最大）：載入時若這台電腦還沒有資料，程式直接跳出而沒有解鎖存檔開關，於是後面每一次存檔都被擋住。症狀是建立計畫、匯入一整季、核對、鎖定，畫面上一切正常，只要重新整理或關掉分頁就全部消失，而且沒有任何訊息；在另一台空白電腦還原備份也一樣，還原完看起來成功、重開就沒了。已改為「沒有資料可讀」也要解鎖存檔（只有「讀不出來」才維持不寫入，那是為了保住原始資料）。(2) **可以只備份一個計畫**：舊版「完整 ZIP」與「JSON 純資料」其實是同一份東西——整台電腦的所有計畫，只差在壓不壓縮，畫面上卻沒有寫。使用者在 A 電腦匯出 A 計畫帶到 B 電腦，結果 B 電腦冒出 A 電腦裡的每一個計畫（包含別的委託案），而 B 電腦原有的計畫被整批覆蓋。現在分成「只備份目前這個計畫」與「備份全部計畫」兩組，檔名帶計畫編號與名稱；單一計畫的備份匯入時是**併入**（同一個計畫被取代，其他計畫不動），全部計畫的備份匯入時才是完整取代，動手前都會把哪一種寫清楚讓您確認。成果審核狀態、鎖定狀態與還原點都會跟著備份走。(3) **成果審核狀態現在真的管得到鎖定**：舊版不論選「待核對」「已核對」「已確認」還是「需修正」都鎖得起來，那個欄位等於只是備註。現在「需修正」會擋下鎖定並列出是哪幾個路口，「待核對」鎖定前會再問一次，鎖定之後審核狀態就改不動（要改先解除鎖定）；核對工作台另外新增一張「本筆成果鎖定狀態」卡，寫出何時鎖的、鎖定當時的版本、鎖定後內容有沒有被動過，以及鎖定期間哪些操作會先跳出確認。(4) **下載的檔名不再變成 download**：產生下載用的連結沒有掛進頁面，部分瀏覽器會忽略指定的檔名。(5) xlsx 上游安全警示：npm 上沒有修好的版本可以升，改在自己的邊界處理——解析時關掉用不到的公式、內嵌 HTML 與 VBA，並在解析前後比對瀏覽器內建物件；一旦真的被動到就中止這次匯入並指出是哪一個檔案，而不是只在說明裡寫一句「請匯入可信來源的檔案」。新增兩支端對端測試（備份與匯入、審核狀態與鎖定）與三項單元測試。",
  },
  {
    version: "v2.1.21",
    date: "2026-08-24",
    note: "採用外部複核對尖峰小時口徑的建議，並修好交付流程上兩個會讓線上出錯的環節。(1) **尖峰小時只能由能精確組成 60 分鐘的格距算出來**（15／20／30／60 可以；45 或 120 不行）。v2.1.19 我原本的作法是「視窗長度＝格數×格距」，2 小時一格的資料會回報一個 2 小時的視窗——但那個值下游仍會被標成 PCU/hr，等於把 2 小時的量冒充成一小時的流率。外部複核指出這一點是對的，本版改為明確回報資料不足；同時拿掉原本把格距硬夾在 15–60 之間的處理（那會讓 2 小時的資料偽裝成 60 分鐘）。(2) **修好「程式連到的手冊檔不在包裡」**：v2.1.20 的線上版本連到 v2.1.20 的手冊，GitHub Pages 包裡卻是 v2.1.18 的手冊，「下載完整 PDF 手冊」按鈕會 404。(3) **打包腳本改為自己重新建置網站成品**，不再沿用磁碟上不知道哪一版的產物——那正是 (2) 的成因；並在打包時檢查「程式連到的手冊檔是否真的在包裡」與「建置產物裡是否看得到目前版號」，對不上就讓打包直接失敗。(4) 測試指令改回 npm（前一版用 pnpm，沒裝 pnpm 的電腦會失敗）。(5) 瀏覽器尋找順序採納外部複核的建議，補上 Windows 的 Chrome／Edge 與 macOS、Linux 的常見安裝位置——多數使用者是在 Windows 上打開備份包，本機已有瀏覽器時不必再另外下載一份。新增非 60 分鐘格距的回歸測試。",
  },
  {
    version: "v2.1.20",
    date: "2026-08-24",
    note: "交付包要能在另一台電腦完整重建與驗證。**沒有任何功能或計算變動**，網站行為與 v2.1.19 完全相同。(1) `npm test` 沒有先建置，但有測試會讀 dist/ 的建置產物——把原始碼包解壓到乾淨環境後直接跑測試會有 3 項失敗。測試指令改為先建置（和全日交通量一致）。(2) 端對端測試用的 playwright 與手冊產生器用的 docx **沒有列進依賴**，在開發機上「剛好裝了」所以看不出來，換一台電腦裝不起來。已補上並同步 lock 檔。(3) 所有端對端腳本與手冊產生器**寫死了開發容器裡的瀏覽器路徑**（/opt/pw-browsers/…），別台電腦沒有那個檔案。改為自動尋找：先看環境變數 CHROME_PATH，再看容器路徑，最後交給 Playwright 用它自己安裝的瀏覽器。(4) 新增 tests/dependency-manifest.test.mjs：測試與腳本 import 的每一個套件都必須列在 package.json 裡、會讀建置產物的測試其指令必須先建置、lock 檔也要對得上，任何一項不符就讓測試失敗。實測：把原始碼包解壓到全新目錄，npm ci 之後 npm test 為 121/121 通過。",
  },
  {
    version: "v2.1.19",
    date: "2026-08-23",
    note: "外部檢查回報的四項，全部確認屬實並修正。(1) **上午／下午尖峰的搜尋視窗只限制起點**，視窗卻是「起點＋一小時」，於是上午尖峰 [05:00, 12:00) 可以挑到 11:45 起算的 **11:45–12:45**——一個大半在下午的視窗被標成「上午尖峰」，而且和下午尖峰挑到的 12:00–13:00 **重疊 45 分鐘**，同一批車被算進兩個尖峰；晚間也會超出上界（22:45 起算 → 22:45–23:45）。現在要求整個視窗（含結尾）都落在時段內，視窗長度也改用「實際格數×格距」而不是寫死 60 分鐘（以 2 小時為一格的原始檔，舊版會把 2 小時的量標成一小時）。(2) **時間欄用全形數字時整張工作表讀成 0 筆**。時間解析的 \\d 不吃全形數字「０７：００」，也不允許「7 : 00」這種冒號旁有空白的寫法；認不出時間欄就找不到資料起始列，那個路口的量憑空消失，而且整體完全不報錯。現在先做 NFKC 正規化並允許冒號旁空白，同時擋掉 25:70 這種不合理的值。(3) **不在內建關鍵字裡的車種被無聲略過**。舊版認不得欄名就跳過整個欄位，調查表裡有「自行車」這類新車種時，那幾欄的量會消失且沒有任何提示，與「可讀取任意數量車種」的說明不符。現在在「這一欄確實有左／直／右或目的地」的前提下收成自訂車種，並列進匯入預覽的新車種清單；合計、備註、時間這類欄名仍會被擋掉，避免總量重複計算。(4) **發布中繼資料版本號不一致**：package.json 是 2.1.8、package-lock.json 是 2.0.1、程式顯示 v2.1.18。三者已同步，並新增測試在版本不一致時直接讓測試失敗，杜絕再次漂移。",
  },
  {
    version: "v2.1.18",
    date: "2026-08-23",
    note: "全面稽核修正（發布前最後一次健檢）。**會直接寫錯報告數字的**：(1) 結論草稿的「季度之間的變動幅度」原本只依路口分組，同一路口同一季常常同時有平日與假日兩筆，於是寫出「上午尖峰總流量由 115Q1 的 3,000.0 PCU/hr 變為 115Q1 的 1,200.0 PCU/hr，減少 60.0%」——同一季自己跟自己比，比的還是平日對假日；現在一律**在同一種資料別之內**比較，同一種底下不足兩季時明講原因。(2) 歷季趨勢的**點標籤**與右側「季度變化」摘要原本永遠用駛出總量，折線座標與 Excel 匯出卻跟著駛出／駛入切換——資料有缺口時會變成「點畫在駛入的高度、旁邊標駛出的數字」，而且會被下載成 PNG 交出去；三者現在一致，趨勢 PNG／Excel 的檔名也加上視角、Excel 多一欄「統計視角」。(3)「跨計畫／多路口比較」卡片原本把各路口的尖峰流量相加標成「AM Peak 合計」，但各路口尖峰小時不同、相加不對應任何一個真實小時；改為「最高路口＋平均」並寫明理由。**會遺失資料的**：(4) 完整備份原本只存「匯出當下開著的那個計畫」的當量矩陣與車種設定，還原時又寫進錯的計畫，其他計畫全部退回系統預設而畫面只說「還原完成」；現在存還原每個計畫各自那一份（舊備份自動沿用原本的遷移方式）。(5)「全部清除」原本沒清掉其他計畫的當量矩陣、車種目錄與車種對照；刪除計畫也沒清掉該計畫的設定與還原點，孤兒資料會一直吃空間。(6) 儲存空間不足而降級存檔（丟掉還原點）時原本完全不出聲，畫面上卻仍列出全部還原點——使用者會依據一個已經不存在的救援選項做決定；現在會明確告知保留了幾筆。**其他**：(7) 同一批次匯入含重複站號＋資料別時原本會無聲互相覆蓋、完成訊息還把被蓋掉與略過的一起算進「已寫入」；現在會先擋下並列出是哪幾個檔案，訊息也改成實際寫入筆數。(8) 條件範本缺欄位（舊版存的）會在 render 期丟 TypeError 讓整個結論分頁消失，新增 normalizeCondition 補齊並夾住小數位數。(9) 批次成果包的 PDF／PNG 改為跟著畫面的車種篩選（與單張匯出一致），README 也改為據實寫出車種與單位。(10) 批次成果包中其他計畫的「歷季趨勢比較」工作表原本取到匯入順序決定的任意路口與資料別，改為挑季度數最多的路口與資料別。(11)「待設定」不再被寫成一種資料別，改寫為「資料別未指定」，統計範圍另計筆數。(12) 勾了「季度變動」「最大／最小」卻寫不出來時一律交代原因，不再靜靜消失。新增／補強單元測試至 92 項，端對端 6 支腳本全數通過。",
  },
  {
    version: "v2.1.17",
    date: "2026-08-23",
    note: "把已經存在的「待設定」一次補完。v2.1.16 修的是**以後**匯入的行為，它不會回頭改既有紀錄——資料別是匯入當下判定並存進每一筆的，不會自己重讀。於是舊版匯入的那幾季仍然掛著待設定，而「待設定」被當成另一種資料別，同一個路口的歷季趨勢就被拆成兩條：選「平日」只看得到 1 季（畫不出趨勢，顯示「至少需要兩季資料」），選「待設定」才看得到 4 季。本版做三件事：(1)「歷季趨勢比較」的資料別**預設停在真正的資料別**，不再一進來就停在待設定；(2) 同一路口同時有待設定與真實資料別時，趨勢圖上方直接說明「趨勢線為什麼被拆成兩條」，並附上**一鍵補完**按鈕（這個路口的 N 季，或整個計畫的 N 筆）；(3)「流量核對工作台」的資料別區塊也加上同一組批次按鈕。批次只會更動目前是「待設定」的紀錄，已經是平日／假日的一律不碰，每一筆都會先自動保存還原點，可在版本差異還原。端對端腳本補上這個情境的完整重現：做出「同路口一季讀得到、一季讀不到」的資料，確認資料別下拉同時出現平日與待設定、預設不停在待設定、提示與按鈕出現、按下之後待設定消失且兩季合成同一條趨勢線。",
  },
  {
    version: "v2.1.16",
    date: "2026-08-23",
    note: "三處和「資料別（平日／假日）」有關的修正。**(1) 日期沒寫括號、但工作表就叫「平日」的檔案不再被判成待設定。** 資料別原本只從日期字樣的括號讀（「日期：115年05月04日(平日)」），工作表名稱只有在「同一個檔案同時有平日與假日兩張」時才會被採用；於是「只做了一天、日期欄沒寫括號、但交通量工作表就叫平日」的檔案會被判成待設定——資訊明明就在檔案裡，只是沒去讀（實際案例：120507T501／502／503 與 06525T2501／2502／2503，日期欄分別是「日期：115年04月15日」「日期：115年06月03-04日」，都沒有括號，工作表都叫「平日」）。現在多一層：整份只有一張叫「平日」或「假日」的交通量工作表時，就用它當資料別。同時有兩張時維持原本的行為（每張各產生一筆，各自帶自己的資料別）。**(2) 重新匯入不會清掉舊的「待設定」，反而多出一筆。** 判斷「這是不是同一份調查」原本用「同計畫＋同季度＋同站號＋同資料別」，但待設定不是一種資料別，而是匯入當下還讀不出來；舊版存成待設定的紀錄，在用同一個檔案重新匯入（這次讀出了平日）時會被當成另一份調查，同一個路口同一季就同時留著兩筆。現在待設定的紀錄可以被有資料別的新匯入接手（先自動保存還原點，完成訊息會寫明補了幾筆）；反向不成立，已經知道是平日的紀錄不會被一筆待設定覆蓋，平日與假日之間也仍然是兩份不同的調查。**(3) 站號沒有連字號時被切錯。** 「站號：06525T2503」原本用貪婪的兩組數字去切，第一組盡量吃，切成「T250-03」；慣例是後兩碼為子編號，正確是 T25-03（同理 T501 應為 T5-01，舊版切成 T50-01）。有連字號時照舊。路口的識別是用路口名稱不是站號，所以既有資料的分組不受影響，但報表上顯示的站號會是對的。三處規則都抽成純函式（resolveSurveyType、isSameSurvey、stationFromFilename）並補上 11 項單元測試；另新增端對端腳本 e2e-survey-type.mjs，從瀏覽器實際匯入一次，驗證「工作表叫平日→讀成平日」「兩處都讀不到→才是待設定」「重新匯入後待設定被接手、路口數沒有增加」。",
  },
  {
    version: "v2.1.15",
    date: "2026-08-23",
    note: "結論草稿產生器新增「各支線各車種駛入／駛出車輛數（輛／調查時段）」這個指標，數字直接取自「車種組成分析」的『全調查時段道路方向車種數量』——用的是同一支 surveyDirectionRows，不是另外算一份，所以草稿寫的每一個車種輛數必然和那張表逐格相同（端對端測試會把該表 111 個數值逐一比對回草稿）。單位是**輛／調查時段**（整個調查期間的累計），和上面的 輛/hr、PCU/hr 是不同的單位，草稿每一行都會把單位寫出來，避免有人拿去相加。呈現方式也和那一頁同一套：可選「跟著車種組成分析頁的設定」（您在那一頁把某條支線改成雙向合計，草稿就寫雙向合計，其他支線仍分行車方向）、「一律分行車方向」或「一律雙向合計」，標頭會寫明這次用的是哪一種。沒有逐流向調查明細的紀錄會明講「這一筆沒有逐流向的調查明細」，不會寫成 0。",
  },
  {
    version: "v2.1.14",
    date: "2026-08-23",
    note: "車種轉向當量、車種目錄與車種對照改為**依計畫各存一份**，計畫之間完全獨立：A 計畫機車直行 0.42、B 計畫 0.5 不會互相覆蓋；A 計畫有 6 個車種、B 計畫有 10 個，刪掉 B 也不會影響 A 顯示的 6 個。舊版是全域共用一組，雖然已匯入的資料不受影響（每筆紀錄在匯入當下就把矩陣存進 pceUsed、PCU 也在那時算好，改設定不會回頭改數字，本版補上端對端測試把關），但畫面上永遠只看得到「最後一次設定」——切到 A 計畫卻顯示 B 的係數，而且在 A 重新匯入某一季時會用到 B 的係數，同一計畫的季度就對不起來。升級時會把原本那一組自動複製給每一個現有計畫，數字完全不變。另：「流量核對工作台」新增路口與資料別選擇器，不必先到別的分頁挑好再回來；資料別下拉不再把「待設定」當成可主動選的值（只有這一筆目前就是待設定時才列出），說明文字也改為講明「待設定」是指**這一筆**的原始檔沒寫，不是整個計畫都沒讀到。",
  },
  {
    version: "v2.1.13",
    date: "2026-08-23",
    note: "「待設定」的說明與更正方式：資料別（平日／假日）是匯入時從原始檔的日期字樣「115年5月4日（平日）」或工作表名稱判斷的，原始檔沒寫就會是「待設定」——但以前沒有任何地方可以補，那筆資料在歷季趨勢、報表與結論草稿裡就永遠掛著「待設定」，也沒辦法和同一路口的另一種資料別分開比較。現在「流量核對工作台」新增資料別下拉，可直接指定平日／假日（更改前會自動保存還原點）。另外，結論草稿產生器的「二、時段與資料別」原本兩排長得一模一樣、沒有小標，「待設定」看起來像是第三個尖峰時段；現在加上「時段」與「資料別」兩個小標題，並在出現「待設定」時說明它的意思與更正路徑。另修正兩處按鈕／文字貼邊：(1)「道路與流向管理」的「開啟圖卡排版預覽」「重設所有圖卡位置」按鈕列內距是 12px 0，兩顆按鈕貼在卡片邊框上，比上面的支線列往左凸出 20px；(2)「多計畫管理」的計畫列在 760px 以下的內距降到 12px，計畫名稱比卡片標題往左凸出 9px。排版量測腳本也一併加強：原本只比對表格與段落，現在按鈕列也納入，且改用 Range 量「文字實際畫在哪裡」，外層包裝元素（padding 在內層）不會再被誤判成貼邊。",
  },
  {
    version: "v2.1.12",
    date: "2026-08-23",
    note: "修正結論草稿產生器切換分頁後內容消失：條件與草稿原本是元件自己的狀態，切到別的分頁時元件被卸載、狀態跟著清空，使用者只是去看一眼路口轉向圖再回來，設好的整組條件與已產生的文字就全部不見了。狀態改放在整個 session 都不會卸載的上層元件，只有換計畫時才重設（換了計畫，原本挑的路口與支線本來就不存在）。另在「報告文字草稿」與「結論草稿產生器」各加一段說明，講清楚什麼時候該用哪一個（前者是這批 Excel 的說明文字、段落跟著匯出項目走；後者是自己出題），詳細對照表寫進手冊第 14 章。另外把「流量核對工作台」的表頭分成兩組：中間各車種欄位加上「① 原始調查車輛數（輛/hr）」，右邊加上「② 乘上車種轉向當量後的交通流量」，並在表格上方說明這一頁是核對換算過程用的——車種欄若標成 PCU 就沒有東西可以核對了。車種欄位本來就是依每一筆紀錄自己的車種清單產生（不是寫死四種），多車種調查格式一直都可以用，本次補上端對端測試把關（實測 7 車種全部列出，換算式也逐項使用）。「流量核對工作台」與「歷季趨勢比較」新增**駛出／駛入視角切換**：兩者是同一批 OD 流向、只是分組方式不同，資料完整時整個路口的總量必須相等，所以兩邊都會直接寫出合計關係——相等時說明可以互相核對，不相等時寫出差額並指出「有流向沒有指定目的支線」，因為那個差額正好就是缺口的大小。歷季趨勢的 Excel 匯出也跟著同一個視角走，避免折線圖與附表給出兩組數字。既有計算完全未變動。",
  },
  {
    version: "v2.1.11",
    date: "2026-08-23",
    note: "結論草稿產生器的條件面板版面修正：(1)「要寫哪些路口／支線」的清單原本寫死最高 180px，卡片被其他欄位撐高之後清單只佔上面一小塊、下面留一大片空白，現在會撐滿卡片剩下的高度（上限 420px）；(2) 選項標籤原本依內容寬度排列，短標籤被擠成一行一兩個字，改為等寬格線每格至少 104px；(3) 清單與選項字級由 12px 調到 13px，行距放寬。功能與計算完全未變動。",
  },
  {
    version: "v2.1.10",
    date: "2026-08-23",
    note: "新增「結論草稿產生器」：可自行勾選統計範圍（單一季度／某一年度／季度區間／整個計畫）、時段（上午尖峰／下午尖峰）、資料別（平日／假日）、要寫哪些路口與哪些支線，以及要寫哪些數字（各支線駛入／駛出流量 PCU、車輛數、佔路口百分比、路口總量、尖峰時段、車種組成、駛入駛出平衡、全日流量、季度變動、範圍內最大最小），再選擇依路口分段／依季度分段／只寫整體，系統照條件寫出一段可直接貼進報告的中文結論。文字可自行修改，改過之後要重新產生會先詢問；條件可存成多組範本重複使用（隨計畫一起備份）。草稿的數字全部取自畫面與 Excel 用的同一組計算，不另外再算一次，並在標頭寫明「PCU/hr 與 輛/hr 僅在同一筆紀錄內可相加，跨路口與跨季度只做比較不做加總」。修正：(1) 歷季趨勢比較把「站號相同」當成必要條件，導致同一路口在不同年度換過站號時（111 年 T13-04、115 年 T15-04）只剩一季對得上，圖表顯示「至少需要兩季資料」——改為每季只有一筆時直接串接並提示站號變動，只有同一季並存多個站號時才需要指定站號（此時多出站號選單）；(2) 報告文字草稿整張卡片沒有寫內距，標題、說明與文字框全部貼在卡片邊框上；(3) 滿版卡片裡的表格第一欄比卡片標題往左凸出，OD 矩陣、各路口駛入／駛出流量、車種組成分析都是；(4) 表格下方說明小字的樣式（.inline-note）根本不存在，整段貼著左邊框；(5) 六張卡片的標題被縮排兩次；(6) 道路與流向管理在 1281～1411px 之間整頁橫向溢出 28px、820px 時溢出 4px。另新增排版量測腳本（17 個分頁 × 12 種視窗寬度，直接量座標）納入端對端測試。",
  },
  {
    version: "v2.1.9",
    date: "2026-08-23",
    note: "全面稽核與修正（37 項，涵蓋計算、功能與排版）。四項最嚴重：(1) 15 分鐘資料只要中間缺一格，「一格幾分鐘」的判斷就會誤判成 60 分鐘，所有流量變成真值的四分之一（實測 16,896 → 4,224 PCU/hr），且 13 小時的調查會被當成 53 小時而填滿「全日」欄位——改為取所有間隔的眾數；(2) 三叉路口的左轉與直行被併成同一條 OD 流向，左轉整批消失並以直行當量換算，而且每次重新整理總量都會再少一次（實測 2,328 → 2,264 PCU/hr）——流向的鍵值加入轉向別；(3) 每次開啟網頁會先把空白狀態寫回儲存再寫真實資料，只要有一筆資料格式不對，整個計畫的資料就會在無聲中被空白覆蓋——改為讀取完成前不寫入，並新增讀取失敗的搶救畫面；(4) 還原備份沒有任何確認，且失敗時會留下一半的破壞——改為先驗證整份、詢問後才一次寫入。另修正：季度排序改用民國／西元通用的比較器（99Q4 與 100Q1 不再排反）；儀表板「較上季」改為只比兩季都有的同一路口同一尖峰；歷季趨勢不再把同一交流道的不同站號畫成同一條線；刪除支線後重算路口總量（原本會留下憑空的流量且品質檢查報「沒有異常」）；「總數不一致」這個一直是 0 的檢查真的實作了；人工確認過的轉向分類不再被內建參考表覆寫；匯入的「併入既有路口」下拉兩個方向都失效已修正；取消預覽會還原預覽時新增的車種；全部清除真的清除全部設定；已鎖定的紀錄不能被單筆刪除；路口改名不再每打一個字就失焦。排版修正按鈕被擠成一行一個字、特定寬度整頁左右捲動、手冊頁「Word 版」下載鈕白字白底完全看不見。",
  },
  {
    version: "v2.1.8",
    date: "2026-08-23",
    note: "「報表與批次輸出」新增報告文字草稿：依匯出期間與勾選的成果範圍，產出一段可直接貼進報告的中文敘述，可自行修改、複製全文或下載 .txt。除了整體總結之外另有「各路口分項結果」，把匯出期間內每一筆路口季度資料各寫一段（上午尖峰、下午尖峰各一行，含該筆自己的尖峰時段、路口轉向總量、各支線駛出／駛入量與車種組成），兩種總結各自獨立勾選。草稿的數字全部取自產生 Excel 的同一批計算（recordTotal、inboundAnalysisRows、odMatrix、branchBalance、conservationCheck、qualityIssues），不另外再算一次；匯出期間與歷季趨勢的挑選規則也改為兩邊共用同一個函式，避免報告文字與附表分岔。尖峰小時流量不能跨路口、跨季度相加，因此支線與車種的敘述固定以一筆代表資料（目前選定路口在範圍內的最新一季）為準，並在文中寫明是哪一筆；駛入與駛出合計不一致時照實寫出差值，不再無條件宣稱守恆；本次匯出用到多組當量矩陣時不列出單一組係數，改為指向工作表。段落清單直接綁定匯出項目清單，並以測試確保一一對應，日後新增匯出項目不會漏掉草稿段落。",
  },
  {
    version: "v2.1.7",
    date: "2026-08-23",
    note: "修正「調查檔格式範本」三張卡片貼著面板邊框的排版問題：.panel 本身沒有內距，而這一格完全沒給，實測左右各只剩 1px，但上面的標題內縮 21px、下面的「已記住的版型」內縮 18px，同一個面板出現三種內縮。現在統一為 21px。",
  },
  {
    version: "v2.1.6",
    date: "2026-08-23",
    note: "匯入辨識結果新增「取消預覽」：預覽的用意就是先看有沒有問題、有問題先去修檔案，但過去要放棄整批只能一列一列按刪除，看到錯誤卻放棄不了。現在可以一次清空整批辨識結果（含檔案選取框），正式資料完全不變動。",
  },
  {
    version: "v2.1.5",
    date: "2026-08-22",
    note: "全面除錯：(1) 只要路口名稱同時含「中山北路」與「岡山路」，任何路口都會被硬套 T15-01 七叉參考轉向表，把匯入的轉向別整批改寫，現在必須支線代碼恰為 A~G 七支才套用；(2) 刪除支線時留下指向該支線的孤兒 OD 路徑，導致駛入合計與駛出合計對不起來，現在會一併刪除並事先提示影響筆數；(3) 新增支線的序號改用「未被占用的最小序號」，避免刪除後再新增造成代碼撞號、跨季度同步把兩支併成一支；(4) 路口改名只影響目前計畫，不再連帶改掉其他計畫的同名路口；(5) 使用者自行輸入的路口名稱不再於重新整理時被正規化吃掉；(6) 尖峰敏感度分析改為逐格檢查時間連續，中間缺一格的區間不再被當成完整一小時；(7)「車種轉向當量」工作表改為輸出各筆資料實際換算所用的當量矩陣，不再輸出畫面上目前的設定；(8) 匯出前排版預警新增「數據框蓋住右下角圖例／中央路口名稱」的檢查；(9) 各路口駛入／駛出流量表首欄由「目的路口」正名為「路口支線」；(10) 歷季趨勢比較新增「資料別」切換與欄位，平日與假日不再混在同一條折線上比較。",
  },
  {
    version: "v2.1.4",
    date: "2026-08-22",
    note: "修正匯出的 .xlsx 在 Excel 開啟時會跳出「部分內容有問題／是否嘗試復原」，按「是」之後歷季趨勢圖被整張丟掉的問題。圖表 XML 有三處不符合 ECMA-376：c:smooth 排在 c:ser 之前、數值軸的 c:majorGridlines 排在 c:numFmt 之後。已全部修正並新增自動檢查，圖表可直接開啟並保持可編輯。可編輯原生圖表需要 Excel 2007 以上，更舊的版本請改用舊版 .xls 數值表。",
  },
  {
    version: "v2.1.3",
    date: "2026-08-22",
    note: "統一「駛入／駛出」用詞：駛入路口X＝車輛從其他支線駛入 X（以 X 為終點），駛出路口X＝車輛從 X 駛出開進路口（以 X 為起點）。全站原本就是這樣算，只有「調查資料 → 與路口關係」欄的兩個標籤寫反了，本版修正；歷季趨勢匯出的兩個欄位名稱也改用同一套用詞。數值完全沒有變動。",
  },
  {
    version: "v2.1.2",
    date: "2026-08-22",
    note: "修正路口轉向圖右下角的流向圖例：左轉／直行／右轉原本都是同一個深灰色圓點，看不出對應哪一種箭頭；現改為與圖上箭頭同色的箭頭線段（左轉桃紅、直行藍、右轉紅）。",
  },
  {
    version: "v2.1.1",
    date: "2026-08-22",
    note: "全面檢查後的修正版：修正寬螢幕下拖曳圖卡位移量與滑鼠不成比例；修正拖到邊界後回拖會有一段沒有反應的死區；修正拖曳路口標籤會跳到畫面左上角；修正重新整理後「（平日）」「（假日）」被拆成兩個路口；修正各車種轉向量原本按 PCU 比例分攤，改為直接加總實際車輛數；修正批次 ZIP 沿用目前計畫的匯出項目；儲存空間寫滿時不再讓整頁變空白。",
  },
  {
    version: "v2.1.0",
    date: "2026-08-22",
    note: "修正長時間拖曳圖卡導致分頁崩潰（拖曳中不再逐幀寫入儲存）；圖卡與路口標籤皆可逐一拖曳並移除 X／Y 數字輸入，且只看駛入／只看駛出／駛入＋駛出三種畫面各自保存版面；圖卡標題置中；只顯示駛入／駛出時箭頭改畫完整方向；報表匯出項目可依計畫勾選並存成範本；新手操作手冊全面改寫為零基礎導向，並提供 PDF 與 Word 版。",
  },
  {
    version: "v2.0.1",
    date: "2026-08-21",
    note: "修正圖卡位移介面：保留清楚的道路簡圖，另增可拖曳的全幅圖卡排版預覽；新增網站新手操作手冊與 PDF 下載。",
  },
  {
    version: "v2.0.0",
    date: "2026-08-21",
    note: "最終版：新增儲存格追溯、匯入差異與歷史還原、審核流程、車種方案、格式版本管理、圖面排位檢查及 OD 矩陣／流量平衡／尖峰敏感度分析。",
  },
  {
    version: "v1.8.0",
    date: "2026-08-20",
    note: "新增動態車種辨識、獨立分析或併入四個標準類別、各車種左直右當量與跨電腦備份；非轉向路段表不會誤建路口資料。",
  },
  {
    version: "v1.7.2",
    date: "2026-08-14",
    note: "五至七岔路口改用外圍自動避讓排版，流量卡不再互相遮蔽。",
  },
  {
    version: "v1.7.1",
    date: "2026-08-14",
    note: "新增各路口駛入／駛出全日與尖峰分析、平假日資料別切換；轉向圖支援駛入／駛出獨立卡片，單一模式顯示對應半段箭線，同時模式顯示完整 OD 流向。",
  },
  {
    version: "v1.7.0",
    date: "2026-08-13",
    note: "新增 OD 流量核對工作台、季度成果鎖定與衝突提示，以及轉向圖駛入／駛出顯示切換。",
  },
  {
    version: "v1.6.0",
    date: "2026-08-13",
    note: "新增平／假日整點格式範本、跨季 Excel、批次成果包與圖表／流量卡定位修正。",
  },
  {
    version: "v1.5.1",
    date: "2026-08-11",
    note: "歷季趨勢 Excel 圖表移至資料表下方並重新整理座標軸與留白；跨計畫／多路口比較新增各支線 AM／PM 駛入中央路口與駛出至支線的尖峰流量明細。",
  },
  {
    version: "v1.5.0",
    date: "2026-08-11",
    note: "歷季趨勢新增 AM／PM 整體檢視與可編輯 Excel 折線圖；報表 Excel 精簡為車種組成、歷季趨勢及跨計畫／多路口比較，並修正道路幾何頁在 100% 縮放時的裁切。",
  },
  {
    version: "v1.4.0",
    date: "2026-08-11",
    note: "依使用目的移除容量與車道數輸入；新增全調查時段／尖峰車種組成，並修正跨季路口識別、跨計畫季度同步及多叉路圖面邊界。",
  },
  {
    version: "v1.3.0",
    date: "2026-08-11",
    note: "修正民國點號日期與四車種欄群辨識；移除方向流量離群誤報，並加入可追溯日期來源、精簡名稱管理、安全刪除計畫及 T 字路口幾何推定。",
  },
  {
    version: "v1.2.0",
    date: "2026-08-11",
    note: "實檔匯入器改為表型辨識；支援七岔路起訖流向、並排區塊、舊版 Excel、名稱合併決策與正式 OD 流向圖。",
  },
  {
    version: "v1.1.0",
    date: "2026-08-11",
    note: "新增多計畫管理、可調整轉向當量、容量建議與號誌欄位、跨電腦備份；重製轉向箭頭、單位與報表。",
  },
  {
    version: "v1.0.0",
    date: "2026-08-11",
    note: "首版：批次匯入、尖峰分析、SVG 轉向圖、比較、品質檢查、報表與備份。",
  },
];

const vehicleShare = {
  motorcycle: 0.42,
  car: 0.48,
  heavy: 0.08,
  special: 0.02,
};

function movement(total: number, split = [0.16, 0.68, 0.16]): Movement {
  const left = Math.round(total * split[0]);
  const through = Math.round(total * split[1]);
  const right = Math.max(0, total - left - through);
  return {
    left,
    through,
    right,
    rawVehicleTotal: total,
    vehicle: Object.fromEntries(
      Object.entries(vehicleShare).map(([key, share]) => [
        key,
        Math.round(total * share),
      ]),
    ) as Movement["vehicle"],
  };
}

const sites = [
  {
    station: "T1-01",
    name: "中山北路－岡山路口",
    arms: [
      "中山北路北側",
      "中山北路南側",
      "岡山路東側",
      "岡山路西側",
      "中興路",
      "支路A",
      "支路B",
    ],
    base: 965,
  },
  {
    station: "T1-02",
    name: "岡山北路－育才路口",
    arms: ["岡山北路北側", "岡山北路南側", "育才路東側", "育才路西側"],
    base: 742,
  },
  {
    station: "T1-03",
    name: "台1線－路科一路口",
    arms: ["台1線北側", "台1線南側", "路科一路東側"],
    base: 1108,
  },
  {
    station: "T1-04",
    name: "中山路－國昌路－民強街路口",
    arms: ["中山路北側", "中山路南側", "國昌路東側", "國昌路西側", "民強街"],
    base: 886,
  },
  {
    station: "T1-05",
    name: "台1線－台28線路口",
    arms: ["台1線北側", "台1線南側", "台28線東側", "台28線西側"],
    base: 1286,
  },
];

const quarters = ["114Q3", "114Q4", "115Q1", "115Q2"];
const quarterMonths = ["2025-08", "2025-11", "2026-02", "2026-05"];

export function bearingFromAngle(angle: number): string {
  const normalized = ((Number(angle) % 360) + 360) % 360;
  return ["東", "東南", "南", "西南", "西", "西北", "北", "東北"][
    Math.round(normalized / 45) % 8
  ];
}

export function createDemoRecords(): TrafficRecord[] {
  return quarters.flatMap((quarter, qi) =>
    sites.map((site, si) => {
      const factor = 0.91 + qi * 0.035 + si * 0.008;
      const approaches = site.arms.map((name, ai) => {
        const scale =
          site.base * factor * (0.78 + ((ai * 7 + si * 3) % 8) * 0.055);
        const angle = -90 + ai * (360 / site.arms.length);
        return {
          id: `${site.station}-A${ai + 1}`,
          name,
          bearing: bearingFromAngle(angle),
          angle,
          lanes: ai < 4 ? 2 : 1,
          capacity: ai < 4 ? 1450 + si * 40 : null,
          movements: {
            AM: movement(Math.round(scale * (0.74 + (ai % 3) * 0.08)), [
              0.12 + (ai % 2) * 0.04,
              0.72 - (ai % 3) * 0.03,
              0.16,
            ]),
            PM: movement(Math.round(scale * (0.82 + ((ai + 1) % 3) * 0.07)), [
              0.15,
              0.67 - (ai % 2) * 0.04,
              0.18 + (ai % 2) * 0.04,
            ]),
          },
        } satisfies Approach;
      });
      return {
        id: `${quarter}-${site.station}`,
        station: site.station,
        name: site.name,
        rawName: `11017${site.station}-${site.name}.xls`,
        quarter,
        date: `${quarterMonths[qi]}-${String(8 + si * 2).padStart(2, "0")}`,
        surveyType: "平日",
        peaks: {
          AM: { start: "07:15", end: "08:15" },
          PM: { start: "17:00", end: "18:00" },
        },
        approaches,
        sourceFiles: [
          `11017${site.station}-${site.name}.xls`,
          `${site.station}.xls`,
        ],
        importedAt: "2026-08-11T09:00:00+08:00",
        validation: {
          referenceFound: false,
          matchRate: null,
          notes: [
            "示範資料：以連續 4 個 15 分鐘區間計算 60 分鐘尖峰。",
            "正式參考檔尚待實檔驗證。",
          ],
        },
      } satisfies TrafficRecord;
    }),
  );
}

export function normalizeIntersectionName(input: string): string {
  let value = input.normalize("NFKC").replace(/\.(xlsx?|xlsm)$/i, "");
  value = value.replace(/^\s*\d{4,}(?:[-_.]?T?\d+[-_.]?\d+)?\s*/i, "");
  value = value.replace(/^\s*T\d+[-_.]?\d+\s*(?:[-_.·｜|]\s*)?/i, "");
  value = value.replace(/^\s*\d{1,3}[-_.]\d{1,3}\s*(?:[-_.·｜|]\s*)?/i, "");
  value = value.replace(/[（(]\s*[三四五六七八九十\d]+叉路口\s*[）)]/gu, "");
  value = value.replace(/[三四五六七八九十\d]+叉路口$/u, "");
  value = value.replace(/[【[（(]+/g, "").replace(/[】\]）)]+/g, "");
  value = value.replace(
    /(?:(?:修正版|更新版|最終版|final|rev(?:ision)?|ver(?:sion)?|v)\s*[._-]?\d*)+$/i,
    "",
  );
  value = value.replace(/[._]{2,}$/g, "").replace(/[._]+$/g, "");
  value = value
    .replace(/[-‐‑‒–—―－~～〜/\\_]+/g, "－")
    .replace(/－{2,}/g, "－");
  value = value
    .replace(/^－|－$/g, "")
    .replace(/\s+/g, "")
    .trim();
  return value || "未命名路口";
}

export function canonicalIntersectionKey(input: string) {
  return normalizeIntersectionName(
    input.normalize("NFKC").replace(/\([^)]*\)/g, ""),
  )
    .replace(/[三四五六七八九十\d]+叉路口/g, "")
    .replace(/路口/g, "路")
    .replace(/台(\d+)線/g, "台$1")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase("zh-TW");
}

export function stationFromFilename(name: string): string {
  const text = name.normalize("NFKC");
  /* 有分隔符號時最單純，直接照它切：T15-04、T15_04、T15.04 */
  const separated = text.match(/T\s*(\d+)\s*[-_.]\s*(\d+)/i);
  if (separated) return `T${separated[1]}-${separated[2].padStart(2, "0")}`;
  /*
   * 沒有分隔符號時要自己切，例如「06525T2503」。
   * 慣例是**後兩碼**為子編號，所以 T2503 → T25-03、T501 → T5-01。
   * 舊版是用貪婪的兩組 (\d+)(\d+) 去切，第一組會盡量吃，於是 T2503 被切成
   * 「T250-03」、T501 被切成「T50-01」——站號一旦寫錯，報表與歷季比較上
   * 顯示的就是錯的站號。
   * 只有兩碼時（T51）維持舊行為切成 T5-01。
   */
  const run = text.match(/T\s*(\d+)/i)?.[1];
  if (run && run.length >= 3)
    return `T${run.slice(0, -2)}-${run.slice(-2)}`;
  if (run && run.length === 2) return `T${run[0]}-${run[1].padStart(2, "0")}`;
  return `S-${Math.abs(hash(name)) % 999}`;
}

function hash(value: string) {
  return [...value].reduce(
    (sum, char) => ((sum << 5) - sum + char.charCodeAt(0)) | 0,
    0,
  );
}

export function totalMovement(
  approach: Approach,
  peak: PeakKey,
  movementKey?: MovementKey,
  vehicle: VehicleKey = "all",
  routes?: RouteFlow[],
) {
  const row = approach.movements[peak];
  if (vehicle !== "all") {
    const vehicleTotal = row.vehicle[vehicle] || 0;
    if (!movementKey) return vehicleTotal;
    // 有逐條 OD 流向時，直接把該轉向的實際車輛數加總——這是精確值。
    if (routes?.length) {
      const matched = routes.filter(
        (route) =>
          route.fromApproachId === approach.id &&
          route.movement === movementKey,
      );
      if (matched.length)
        return Math.round(
          matched.reduce(
            (sum, route) =>
              sum + Number(route.volumes[peak].vehicle[vehicle] || 0),
            0,
          ),
        );
    }
    // 沒有 OD 流向的舊資料只能按比例推估。注意 left／through／right 在
    // 有流向時是 PCU、沒有流向時是實際車輛數；這裡是後者，比例才成立。
    const overall = row.left + row.through + row.right || 1;
    return Math.round((vehicleTotal * row[movementKey]) / overall);
  }
  return movementKey ? row[movementKey] : row.left + row.through + row.right;
}

export function recordTotal(record: TrafficRecord, peak: PeakKey) {
  return record.approaches.reduce(
    (sum, approach) => sum + totalMovement(approach, peak),
    0,
  );
}

export function qualityIssues(records: TrafficRecord[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const record of records) {
    if (
      !record.routes?.length &&
      record.sourceFiles.some(function (file) {
        return /\.xls(?:x|m)?$/i.test(file);
      })
    ) {
      issues.push({
        id: `${record.id}-legacy-import`,
        severity: "error",
        category: "缺值",
        station: record.station,
        quarter: record.quarter,
        message:
          "此筆由舊版匯入器建立，缺少可追溯的起點→終點流向；請刪除本筆後，以 v1.4.0 重新匯入原始 Excel。",
      });
    }
    for (const peak of ["AM", "PM"] as PeakKey[]) {
      const hour = Number(record.peaks[peak].start.split(":")[0]);
      if (
        (peak === "AM" && (hour < 5 || hour >= 12)) ||
        (peak === "PM" && (hour < 12 || hour >= 23))
      ) {
        issues.push({
          id: `${record.id}-${peak}-time`,
          severity: "warning",
          category: "尖峰時段異常",
          station: record.station,
          quarter: record.quarter,
          message: `${peak} 尖峰 ${record.peaks[peak].start} 不在預設搜尋範圍。`,
        });
      }
      const approachTotals = record.approaches.map((a) =>
        totalMovement(a, peak),
      );
      approachTotals.forEach((value, index) => {
        if (!Number.isFinite(value))
          issues.push({
            id: `${record.id}-${peak}-${index}-missing`,
            severity: "error",
            category: "缺值",
            station: record.station,
            quarter: record.quarter,
            message: `${record.approaches[index].name} ${peak} 含非數值欄位。`,
          });
        const m = record.approaches[index].movements[peak];
        const classifiedVehicleTotal = Object.values(m.vehicle).reduce(
          (a, b) => a + b,
          0,
        );
        const turningVehicleTotal = m.rawVehicleTotal;
        // left/through/right are PCU/hr and cannot be compared with classified
        // vehicles. Only run this rule when the importer has retained the
        // same-scope actual-vehicle total (vehicles/hr).
        if (turningVehicleTotal != null) {
          const difference = Math.abs(
            classifiedVehicleTotal - turningVehicleTotal,
          );
          if (difference > Math.max(5, turningVehicleTotal * 0.05))
            issues.push({
              id: `${record.id}-${peak}-${index}-vehicle`,
              severity: "warning",
              category: "車種統計異常",
              station: record.station,
              quarter: record.quarter,
              message: `${record.approaches[index].name} ${peak}：左直右實際車輛合計 ${turningVehicleTotal.toLocaleString()} 輛/hr，四車種合計 ${classifiedVehicleTotal.toLocaleString()} 輛/hr，差 ${difference.toLocaleString()} 輛/hr。`,
              details: {
                turningVehicleTotal,
                classifiedVehicleTotal,
                difference,
                unit: "輛/hr",
                explanation:
                  "兩邊均須來自同一方向、同一尖峰時段的實際車輛數；PCU/hr 不參與此項加總檢查。",
              },
            });
        }
      });
    }
    if (!record.date)
      issues.push({
        id: `${record.id}-date`,
        severity: "error",
        category: "缺值",
        station: record.station,
        quarter: record.quarter,
        message:
          record.validation.notes.find(function (note) {
            return note.startsWith("日期辨識未成功：");
          }) || "日期辨識未成功；不代表原始檔欄位一定空白。",
      });
    /*
     * 總數不一致：路口轉向總量（由 approaches 的左直右加總）與逐條 OD 流向
     * 加總應該相等。不相等就代表 approaches 與 routes 脫鉤了——最常見的是
     * 刪除支線之後沒有重算，畫面與每一張 Excel 都會多出一筆憑空的流量。
     *
     * 這個類別本來就宣告在型別裡、KPI 也有一格，但沒有任何規則會產生它，
     * 所以那一格永遠是 0，等於對使用者謊稱「已經檢查過而且沒問題」。
     */
    if (record.routes?.length)
      for (const peak of ["AM", "PM"] as PeakKey[]) {
        const movementTotal = record.approaches.reduce(function (sum, approach) {
          return sum + totalMovement(approach, peak);
        }, 0);
        const routeTotal = record.routes.reduce(function (sum, route) {
          return sum + Number(route.volumes[peak]?.pcu || 0);
        }, 0);
        const difference = Math.round((movementTotal - routeTotal) * 10) / 10;
        // 兩邊都做到小數一位，容差取 0.11 與 conservationCheck 一致。
        if (Math.abs(difference) >= 0.11)
          issues.push({
            id: `${record.id}-${peak}-conservation`,
            severity: "error",
            category: "總數不一致",
            station: record.station,
            quarter: record.quarter,
            message: `${peak} 尖峰：路口轉向總量 ${movementTotal.toLocaleString()} PCU/hr 與逐條流向加總 ${routeTotal.toLocaleString()} PCU/hr 相差 ${difference.toLocaleString()} PCU/hr。常見原因是刪除支線後未重算，請到「流量核對工作台」確認。`,
          });
      }
  }
  return issues;
}

export type IntervalRow = { start: number; label: string; values: number[] };

export function rollingPeak(
  rows: IntervalRow[],
  range: [number, number],
  intervalMinutes = 15,
  weights?: number[],
) {
  /*
   * 尖峰**小時**一定要由「恰好 60 分鐘」的原始格距組成。
   *
   * 15、20、30、60 分鐘都能精確組成一小時；45 或 120 分鐘則不能。
   * 後兩者若硬取一格再標成 PCU/hr，等於把 45 分鐘或 2 小時的量冒充成
   * 一小時的流率——那比顯示「資料不足」危險得多，因為數字看起來很正常。
   * 所以這裡直接回 null，由畫面說明資料不足。
   *
   * （v2.1.19 我原本的作法是「視窗長度＝格數×格距」，2 小時的資料會回報
   * 一個 2 小時的視窗；但那個值下游仍會被標成 PCU/hr。外部複核指出這一點，
   * 這一版採用較保守的作法。）
   */
  if (
    !Number.isFinite(intervalMinutes) ||
    intervalMinutes <= 0 ||
    intervalMinutes > 60 ||
    60 % intervalMinutes !== 0
  )
    return null;
  const needed = 60 / intervalMinutes;
  /*
   * 視窗的**頭和尾都要落在時段內**。
   *
   * 舊版只檢查起點（row.start < range[1]），視窗卻是 start 到 start+60，
   * 於是：
   *  ・上午尖峰 [05:00, 12:00) 可以挑到 11:45 起算 → 11:45–12:45，
   *    一個橫跨中午、大半在下午的視窗被標成「上午尖峰」；
   *  ・更糟的是它和下午尖峰 [12:00, 23:00) 挑到的 12:00–13:00 重疊 45 分鐘，
   *    同一批車同時被算進上午與下午兩個尖峰；
   *  ・晚間也會超出上界：22:45 起算 → 22:45–23:45，已經超過 23:00。
   * 現在要求整個視窗（含結尾）都在範圍內。
   */
  const windowMinutes = 60;
  const candidates = rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) =>
        row.start >= range[0] && row.start + windowMinutes <= range[1],
    );
  let best: {
    start: number;
    end: number;
    total: number;
    values: number[];
  } | null = null;
  for (const { row, index } of candidates) {
    const slice = rows.slice(index, index + needed);
    if (
      slice.length !== needed ||
      slice.some(
        (r, i) => i && r.start - slice[i - 1].start !== intervalMinutes,
      )
    )
      continue;
    const values = Array.from(
      { length: Math.max(...slice.map((r) => r.values.length), 0) },
      (_, col) =>
        slice.reduce((sum, r) => sum + (Number(r.values[col]) || 0), 0),
    );
    const total = values.reduce(
      (sum, value, column) => sum + value * (weights?.[column] ?? 1),
      0,
    );
    if (!best || total > best.total)
      best = {
        start: row.start,
        end: row.start + windowMinutes,
        total,
        values,
      };
  }
  return best;
}

function parseTime(value: unknown): number | null {
  if (typeof value === "number" && value > 0 && value < 1)
    return Math.round(value * 24 * 60);
  /*
   * 一定要先 NFKC 正規化，並允許冒號兩側有空白。
   *
   * 從 Word 貼過來的調查表常見全形數字與全形冒號「０７：００」，也有人打成
   * 「7 : 00」。舊版的 \d 不吃全形數字（雖然吃得到全形冒號），於是整個
   * 時間欄一格都認不出來——時間欄認不出來就找不到資料起始列，**整張工作表
   * 讀成 0 筆**，而且整體不會報錯，只是那個路口的量憑空消失。
   * 這是全系統唯一的時間解析入口，補在這裡等於所有讀取路徑一起修好。
   */
  const text = String(value ?? "").normalize("NFKC");
  const match = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  /* 25:70 這種明顯不是時間的字串不要當成時間，否則會誤判時間欄。 */
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export type ImportPreview = {
  file: string;
  station: string;
  name: string;
  role: "原始交通量" | "參考計算檔" | "非路口轉向" | "無法辨識";
  sheets: {
    traffic: string[];
    log: string[];
    phase: string[];
    ignored: string[];
  };
  intervals: number;
  intervalMinutes?: number;
  intervalRows?: Array<{
    start: number;
    label: string;
    values: number[];
    /** One-based source row for each contributing worksheet. */
    sourceRows?: Record<string, number>;
  }>;
  survey?: {
    intervals: number;
    minutes: number;
    values: number[];
  };
  am: ReturnType<typeof rollingPeak>;
  pm: ReturnType<typeof rollingPeak>;
  date: string;
  dateSource: { sheet: string; cell: string; raw: string } | null;
  surveyType: string;
  layout: "turning" | "od" | "unknown";
  approaches: string[];
  columns: Array<{
    valueIndex: number;
    sheet: string;
    sourceColumn: number;
    label: string;
    approach: string;
    destination: string | null;
    movement: MovementKey | null;
    vehicle: PceVehicle;
    vehicleLabel: string;
  }>;
  detectedVehicles: VehicleDefinition[];
  mappingConfidence: "high" | "medium" | "low";
  warnings: string[];
  templateId?: string;
  templateName?: string;
  /** Coefficients used to select the previewed peak window. */
  pceUsed: PceMatrix;
};

export type ImportFormatTemplate = {
  id: string;
  name: string;
  description: string;
  intervalMinutes: 15 | 60 | "auto";
};

export const IMPORT_FORMAT_TEMPLATES: ImportFormatTemplate[] = [
  {
    id: "hourly-weekday-holiday-turning-v1",
    name: "平／假日全日整點轉向表",
    description:
      "同一活頁簿含平日、假日工作表；依日別分開匯入，讀取四車種×左直右整點流量。",
    intervalMinutes: 60,
  },
  {
    id: "semantic-turning-v1",
    name: "一般語意轉向表",
    description:
      "依時間欄、來源支線、左直右或 OD 目的地及車種欄名辨識，不依固定欄號。",
    intervalMinutes: "auto",
  },
  {
    id: "full-day-road-vehicle-v1",
    name: "全日路段車種表（非轉向）",
    description:
      "可辨識全日路段車種與行車方向，但沒有左／直／右或 OD 欄位，不建立路口轉向成果。",
    intervalMinutes: 60,
  },
];

function importTemplate(templateId: string) {
  return (
    IMPORT_FORMAT_TEMPLATES.find(function (template) {
      return template.id === templateId;
    }) || IMPORT_FORMAT_TEMPLATES[1]
  );
}

function mergedCellValue(sheet: XLSX.WorkSheet, row: number, col: number) {
  const direct = sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v;
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const merge = (sheet["!merges"] || []).find(
    (item) =>
      row >= item.s.r && row <= item.e.r && col >= item.s.c && col <= item.e.c,
  );
  if (!merge) return "";
  return String(sheet[XLSX.utils.encode_cell(merge.s)]?.v ?? "").trim();
}

function movementFromHeader(label: string): MovementKey | null {
  if (/左轉|左彎|\bL\b/i.test(label)) return "left";
  if (/直行|直進|\bT\b/i.test(label)) return "through";
  if (/右轉|右彎|\bR\b/i.test(label)) return "right";
  return null;
}

/**
 * 檔案裡來的字串要當成物件的鍵時，先擋掉會污染原型的那幾個名字。
 *
 * 為什麼需要：工作表名稱、支線代碼這些都直接來自使用者上傳的檔案，而程式
 * 有好幾處是 `object[名稱] = 值`。一個工作表如果真的叫 `__proto__`，
 * 這一行就會改寫到 Object.prototype，之後全站每一個物件都會多出那個屬性
 * ——症狀千奇百怪而且極難追。
 *
 * 這也是對 xlsx（SheetJS 0.18.5）已知原型污染警示的一層防禦：
 * npm 上沒有修好的版本可用（修正版只在 SheetJS 自己的 CDN 上），
 * 所以在**我們自己的邊界**擋一次，不完全依賴上游。
 */
export function safeObjectKey(key: string): string {
  return key === "__proto__" || key === "constructor" || key === "prototype"
    ? "_" + key + "_"
    : key;
}

/*
 * ────────────────────────────────────────────────────────────────
 *  對 xlsx（SheetJS 0.18.5）上游安全警示的實際處置
 * ────────────────────────────────────────────────────────────────
 *
 * 狀況：npm 上的 xlsx 停在 0.18.5，那一版有一則原型污染的警示
 * （prototype pollution），而**修正版只發在 SheetJS 自己的 CDN**，
 * npm 沒有可以直接升上去的版本（`npm audit` 也回報 fixAvailable: false）。
 *
 * 「請只匯入可信來源的檔案」本身沒有錯，但那是把責任推回使用者，
 * 而且這支程式的使用情境正好是「收別人給的調查檔」。所以在我們自己的
 * 邊界做兩件做得到的事：
 *
 *  1. 解析時關掉用不到的解析路徑。這支程式只讀儲存格的值，公式、
 *     內嵌 HTML 與 VBA 巨集一個都不需要，關掉就少一片攻擊面。
 *  2. 解析前後各拍一次 Object.prototype 的自有屬性清單。攻擊要生效
 *     一定得先污染成功，污染成功就一定看得到差異：把多出來的屬性
 *     刪掉、中止這次匯入，並明講是哪一個檔案、多了什麼。
 *     （安靜地清掉更危險——使用者會以為那個檔案沒問題。）
 *
 * 這不能取代升級，但它把「無聲被污染」變成「當場中止並告知」。
 */
export const SAFE_XLSX_READ_OPTIONS = {
  type: "array",
  cellDates: true,
  cellFormula: false,
  cellHTML: false,
  bookVBA: false,
} as const;

/** 解析前先記下 Object.prototype 目前有哪些自有屬性。 */
export function prototypeFingerprint(): string[] {
  return Object.getOwnPropertyNames(Object.prototype);
}

/**
 * 解析後比對；多出來的屬性代表這個檔案動到了原型。
 * 回傳多出來的屬性名稱（已經刪掉），沒有就是空陣列。
 */
export function detectPrototypePollution(before: string[]): string[] {
  const known = new Set(before);
  const added = Object.getOwnPropertyNames(Object.prototype).filter(
    function (name) {
      return !known.has(name);
    },
  );
  added.forEach(function (name) {
    try {
      delete (Object.prototype as unknown as Record<string, unknown>)[name];
    } catch {
      /* 刪不掉也要繼續往下報告，不能因此吞掉警告 */
    }
  });
  return added;
}

/** 解析後立刻呼叫；被污染就丟例外中止匯入。 */
export function assertNoPrototypePollution(
  before: string[],
  fileLabel: string,
): void {
  const added = detectPrototypePollution(before);
  if (!added.length) return;
  throw new Error(
    "「" +
      fileLabel +
      "」在解析過程中試圖修改瀏覽器的內建物件（" +
      added.join("、") +
      "），本次匯入已中止，系統資料沒有變動。請確認這個檔案的來源。",
  );
}

function customVehicleId(label: string) {
  return (
    "custom:" +
    label
      .normalize("NFKC")
      .trim()
      .replace(/[\s\u3000]+/g, "")
      .replace(/[|｜/\\()[\]（）]/g, "-")
      .replace(/-+/g, "-")
  );
}

function vehicleFromHeader(label: string): VehicleDefinition | null {
  const normalized = label.normalize("NFKC").replace(/[\s\u3000]+/g, "");
  const matches = [
    {
      pattern: /機踏車|機車|motorcycle|motorbike/i,
      id: "motorcycle",
      label: "機車",
      core: true,
    },
    {
      pattern: /小型車|小客車|小客|轎車|passengercar|lightvehicle/i,
      id: "car",
      label: "小型車",
      core: true,
    },
    { pattern: /大貨車|大卡車|貨車|truck/i, label: "大貨車" },
    { pattern: /大客車|客運車|公車|bus/i, label: "大客車" },
    { pattern: /聯結車|聯結|貨櫃車|曳引車|trailer/i, label: "聯結車" },
    {
      pattern: /大型車|heavyvehicle/i,
      id: "heavy",
      label: "大型車",
      core: true,
    },
    {
      pattern: /特種車|特車|specialvehicle/i,
      id: "special",
      label: "特種車",
      core: true,
    },
  ].find(function (item) {
    return item.pattern.test(normalized);
  });
  if (matches)
    return {
      id: matches.id || customVehicleId(matches.label),
      label: matches.label,
      core: Boolean(matches.core),
    };
  return null;
}

/**
 * 認不得的欄名，在「這一欄確實是某個車種的左／直／右或目的地欄」時，
 * 收成自訂車種。
 *
 * 為什麼需要：vehicleFromHeader 只認得七組內建關鍵字，不符合就回 null，
 * 呼叫端接著 `continue` **無聲跳過整個欄位**。調查表裡有「自行車」
 * 「電動機車」「小貨車」這類新車種時，那幾欄的量會憑空消失，總量少掉
 * 而且沒有任何提示，也和「可讀取任意數量車種」的說明不符。
 *
 * 為什麼不直接放寬 vehicleFromHeader：那支也被「掃描前 20 列找出這份檔案
 * 有哪些車種」用到，放寬會把時間欄、合計欄一起收成車種。這裡是唯一
 * 「已經確認有左／直／右或目的地」的地方，才有足夠證據判定它是車種欄。
 *
 * 即使如此仍要擋掉明顯不是車種的字樣——合計、備註被當成車種會讓總量重複
 * 計算，比漏掉還糟。
 */
function customVehicleFromHeader(label: string): VehicleDefinition | null {
  /*
   * 傳進來的 label 是「上下欄名用｜串起來」的複合字串，例如
   * 「日期：115.05.04 (平日)｜自行車｜左轉」。要先把流向、日期那幾段拿掉，
   * 剩下的才是車種名稱——否則「自行車｜左轉」會因為含有「左轉」而被
   * 下面的排除清單擋掉，那正是這支函式要救的欄位。
   */
  const dropSegment =
    /^(左轉|直進|直行|右轉|迴轉|掉頭|u-?turn|left|through|straight|right)$|^往|^至|^日期|^站號|^站名|^天候|^調查員|^路口編號|^時\s*間$/i;
  const segments = label
    .split(/[｜|]/)
    .map((part) => part.normalize("NFKC").replace(/[\s\u3000]+/g, ""))
    .filter((part) => part && !dropSegment.test(part));
  const normalized = segments.at(-1) || "";
  if (!normalized || normalized.length > 12) return null;
  /* 時間、時間區間、純數字或百分比一律不是車種 */
  if (/\d\s*[:：]\s*\d/.test(normalized)) return null;
  if (/[～~—–]/.test(normalized)) return null;
  if (/^[\d.,%\-+]+$/.test(normalized)) return null;
  if (
    /合計|小計|總計|總和|加總|平均|百分比|比例|佔比|備註|說明|時間|時段|方向|轉向|左轉|直進|直行|右轉|迴轉|流量|pcu|當量|人次|序號|編號|項目|日期|天候|站號|站名|路口|支線|合流|分流/i.test(
      normalized,
    )
  )
    return null;
  return { id: customVehicleId(normalized), label: normalized, core: false };
}

function detectedVehicleHeaders(workbook: XLSX.WorkBook) {
  const result = new Map<string, VehicleDefinition>();
  workbook.SheetNames.forEach(function (sheetName) {
    if (/照片|photo|image|監測日誌|日誌|log/i.test(sheetName)) return;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.["!ref"]) return;
    const range = XLSX.utils.decode_range(sheet["!ref"]!);
    for (
      let row = range.s.r;
      row <= Math.min(range.e.r, range.s.r + 20);
      row++
    ) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const raw = sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v;
        if (raw == null) continue;
        const definition = vehicleFromHeader(String(raw));
        if (definition) result.set(definition.id, definition);
      }
    }
  });
  return [...result.values()];
}

function workbookCells(workbook: XLSX.WorkBook) {
  const values: Array<{ text: string; sheet: string; cell: string }> = [];
  workbook.SheetNames.forEach(function (sheetName) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.["!ref"]) return;
    const range = XLSX.utils.decode_range(sheet["!ref"]!);
    for (let row = range.s.r; row <= Math.min(range.e.r, 12); row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const value = sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v;
        if (value != null && String(value).trim())
          values.push({
            text: String(value).trim(),
            sheet: sheetName,
            cell: XLSX.utils.encode_cell({ r: row, c: col }),
          });
      }
    }
  });
  return values;
}

function rocDate(value: string) {
  const match = value
    .normalize("NFKC")
    .match(
      /(\d{2,4})\s*(?:年\s*|[./-]\s*)(\d{1,2})\s*(?:月\s*|[./-]\s*)(\d{1,2})\s*(?:日)?/,
    );
  if (!match) return "";
  const sourceYear = Number(match[1]);
  const year = sourceYear < 1911 ? sourceYear + 1911 : sourceYear;
  return `${year}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
}

function sourceCode(
  sheet: XLSX.WorkSheet,
  headerEnd: number,
  startColumn: number,
  endColumn: number,
  sheetName: string,
) {
  for (let row = 0; row <= headerEnd; row++) {
    for (let col = startColumn; col <= endColumn; col++) {
      const text = String(
        sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v ?? "",
      ).normalize("NFKC");
      const match = text.match(/路口編號\s*[：:]?\s*(?:路口)?\s*([A-Z0-9]+)/i);
      if (match) return match[1].toUpperCase();
    }
  }
  return (
    sheetName
      .normalize("NFKC")
      .match(/路口\s*[（(]?\s*([A-Z0-9]+)\s*[)）]?/i)?.[1]
      ?.toUpperCase() || ""
  );
}

function defaultMovementForOd(
  from: string,
  to: string,
  approaches: string[],
): MovementKey {
  const fromIndex = approaches.indexOf(from);
  const toIndex = approaches.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || approaches.length < 3) return "through";
  const step =
    (((toIndex - fromIndex) % approaches.length) + approaches.length) %
    approaches.length;
  const signedDegrees =
    (((step * 360) / approaches.length - 180 + 540) % 360) - 180;
  if (Math.abs(signedDegrees) <= 50) return "through";
  return signedDegrees < 0 ? "left" : "right";
}

const ZHONGSHAN_GANGSHAN_SEVEN_ARM_MOVEMENTS: Record<
  string,
  Record<string, MovementKey>
> = {
  A: { B: "left", C: "left", D: "left", E: "through", F: "right", G: "right" },
  B: { C: "left", D: "left", E: "left", F: "through", G: "right", A: "right" },
  C: { D: "left", E: "left", F: "left", G: "through", A: "right", B: "right" },
  D: { E: "left", F: "left", G: "left", A: "right", B: "right", C: "right" },
  E: { F: "left", G: "left", A: "through", B: "right", C: "right", D: "right" },
  F: { G: "left", A: "left", B: "through", C: "right", D: "right", E: "right" },
  G: { A: "left", B: "left", C: "through", D: "right", E: "right", F: "right" },
};

const REFERENCE_ARM_CODES = ["A", "B", "C", "D", "E", "F", "G"];

/**
 * 這張參考表是從使用者 T15-01 的人工計算底稿抄下來的，只對「那一個」七叉
 * 路口成立（該底稿裡 D 沒有直行）。
 *
 * 早期的判斷條件只看路口名稱有沒有同時出現「中山北路」與「岡山路」，於是
 * 任何名字沾到這兩條路的路口——包含只有四叉的一般路口、或同一條路上的別
 * 的交叉點——都會被硬套這張表，把使用者匯入的轉向別整批改寫掉（實測會把
 * A→B 從直行 368.5 改成左轉 538.9），而且畫面上不會有任何提示。
 *
 * 因此除了名稱之外，還要求路口的支線代碼恰好是 A~G 七支，形狀對不上就不
 * 套用，改回幾何推算。
 */
export function referenceMovementForOd(
  intersectionName: string,
  from: string,
  to: string,
  armCodes: string[],
): MovementKey | null {
  const normalized = intersectionName.normalize("NFKC");
  if (!normalized.includes("中山北路") || !normalized.includes("岡山路"))
    return null;
  const codes = [
    ...new Set(
      (armCodes || [])
        .map((code) => String(code || "").trim().toUpperCase())
        .filter(Boolean),
    ),
  ].sort();
  if (codes.length !== REFERENCE_ARM_CODES.length) return null;
  if (codes.some((code, index) => code !== REFERENCE_ARM_CODES[index]))
    return null;
  return ZHONGSHAN_GANGSHAN_SEVEN_ARM_MOVEMENTS[from]?.[to] || null;
}

export async function inspectWorkbook(
  file: File,
  pce: PceMatrix = DEFAULT_PCE,
  options?: {
    trafficSheets?: string[];
    fileLabel?: string;
    surveyType?: string;
  },
): Promise<ImportPreview> {
  const array = await file.arrayBuffer();
  const fingerprint = prototypeFingerprint();
  const workbook = XLSX.read(array, SAFE_XLSX_READ_OPTIONS);
  assertNoPrototypePollution(fingerprint, options?.fileLabel || file.name);
  const detectedVehicles = detectedVehicleHeaders(workbook);
  const buckets = {
    traffic: [] as string[],
    log: [] as string[],
    phase: [] as string[],
    ignored: [] as string[],
  };
  const dayTypeTrafficSheets = workbook.SheetNames.filter(function (sheet) {
    return /^(平日|假日)\s*$/.test(sheet.normalize("NFKC"));
  });
  const templateId =
    dayTypeTrafficSheets.length >= 2
      ? "hourly-weekday-holiday-turning-v1"
      : "semantic-turning-v1";
  workbook.SheetNames.forEach((sheet) => {
    if (/照片|photo|image/i.test(sheet)) buckets.ignored.push(sheet);
    else if (/監測日誌|日誌|log/i.test(sheet)) buckets.log.push(sheet);
    else if (/時相|號誌|phase|signal/i.test(sheet)) buckets.phase.push(sheet);
    else if (!options?.trafficSheets || options.trafficSheets.includes(sheet))
      buckets.traffic.push(sheet);
    else buckets.ignored.push(sheet);
  });
  const cells = workbookCells(workbook);
  const texts = cells.map(function (item) {
    return item.text;
  });
  const workbookStation = texts
    .map(function (text) {
      return text.match(/站號\s*[：:]\s*[^\s]*?(T\s*\d+[-_.]?\s*\d+)/i)?.[1];
    })
    .find(Boolean);
  const workbookName =
    texts
      .map(function (text) {
        return text.match(/站名\s*[：:]\s*(.+)$/)?.[1];
      })
      .find(Boolean) ||
    texts
      .map(function (text) {
        return text.match(/地\s*點\s*[：:]?\s*(.+)$/)?.[1];
      })
      .find(Boolean);
  const dateCell =
    cells.find(function (item) {
      return (
        (!options?.trafficSheets ||
          options.trafficSheets.includes(item.sheet)) &&
        Boolean(rocDate(item.text))
      );
    }) ||
    cells.find(function (item) {
      return Boolean(rocDate(item.text));
    }) ||
    null;
  const dateText = dateCell?.text || "";
  const intervalMap = new Map<number, IntervalRow>();
  const detectedColumns: ImportPreview["columns"] = [];
  const originOrder: string[] = [];
  let sawOd = false;
  let sawTurning = false;
  let positionalVehicleBlocks = 0;
  let vehicleHeaderConflicts = 0;
  for (const sheetName of buckets.traffic) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.["!ref"]) continue;
    const used = XLSX.utils.decode_range(sheet["!ref"]!);
    const timeColumns: Array<{ column: number; firstDataRow: number }> = [];
    for (let col = used.s.c; col <= used.e.c; col++) {
      let firstDataRow = -1;
      let timeCount = 0;
      let stringTimeCount = 0;
      for (let row = used.s.r; row <= used.e.r; row++) {
        const value = sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v;
        if (parseTime(value) !== null) {
          if (firstDataRow < 0) firstDataRow = row;
          timeCount++;
          if (typeof value === "string") stringTimeCount++;
        }
      }
      const hasTimeHeader =
        firstDataRow >= 0 &&
        Array.from(
          { length: Math.min(4, firstDataRow - used.s.r + 1) },
          function (_, offset) {
            return mergedCellValue(sheet, firstDataRow - offset - 1, col);
          },
        ).some(function (value) {
          return /時\s*間/.test(value);
        });
      if (
        firstDataRow >= 0 &&
        timeCount >= 4 &&
        (hasTimeHeader || stringTimeCount >= 4)
      )
        timeColumns.push({ column: col, firstDataRow });
    }
    timeColumns.forEach(function (timeColumn, blockIndex) {
      const blockEnd =
        (timeColumns[blockIndex + 1]?.column ?? used.e.c + 1) - 1;
      const origin =
        sourceCode(
          sheet,
          timeColumn.firstDataRow - 1,
          timeColumn.column,
          blockEnd,
          sheetName,
        ) || `A${originOrder.length + 1}`;
      if (!originOrder.includes(origin)) originOrder.push(origin);
      const blockColumns: ImportPreview["columns"] = [];
      const candidates: Array<{
        sourceColumn: number;
        label: string;
        movement: MovementKey | null;
        destination: string | null;
        headerVehicle: VehicleDefinition;
      }> = [];
      for (let col = timeColumn.column + 1; col <= blockEnd; col++) {
        const parts: string[] = [];
        for (
          let headerRow = Math.max(used.s.r, timeColumn.firstDataRow - 8);
          headerRow < timeColumn.firstDataRow;
          headerRow++
        ) {
          const value = mergedCellValue(sheet, headerRow, col);
          if (value && !parts.includes(value)) parts.push(value);
        }
        const label = parts.join("｜");
        const movement = movementFromHeader(label);
        const destination =
          label.match(/往\s*([A-Z0-9]+)/i)?.[1]?.toUpperCase() || null;
        /*
         * 這一欄要有左／直／右或目的地，才算是「車種 × 流向」的資料欄。
         * 有了這個前提，欄名認不得時就收成自訂車種而不是無聲丟掉
         * （見 customVehicleFromHeader 的說明）。
         */
        if (!movement && !destination) continue;
        const headerVehicle =
          vehicleFromHeader(label) || customVehicleFromHeader(label);
        if (!headerVehicle) continue;
        candidates.push({
          sourceColumn: col,
          label,
          movement,
          destination,
          headerVehicle,
        });
      }
      const distinctHeaderVehicles = new Set(
        candidates.map(function (candidate) {
          return candidate.headerVehicle.id;
        }),
      ).size;
      const usePositionalVehicles =
        candidates.length >= 8 &&
        candidates.length % 4 === 0 &&
        distinctHeaderVehicles === 4;
      const vehicleGroupSize = usePositionalVehicles
        ? candidates.length / 4
        : 0;
      if (usePositionalVehicles) positionalVehicleBlocks++;
      candidates.forEach(function (candidate, candidateIndex) {
        const positionalVehicle = usePositionalVehicles
          ? (["motorcycle", "car", "heavy", "special"] as PceVehicle[])[
              Math.min(3, Math.floor(candidateIndex / vehicleGroupSize))
            ]
          : candidate.headerVehicle.id;
        if (
          usePositionalVehicles &&
          positionalVehicle !== candidate.headerVehicle.id
        )
          vehicleHeaderConflicts++;
        const vehicle = positionalVehicle;
        const { movement, destination, label, sourceColumn: col } = candidate;
        if (movement) sawTurning = true;
        if (destination) sawOd = true;
        const column: ImportPreview["columns"][number] = {
          valueIndex: detectedColumns.length,
          sheet: sheetName,
          sourceColumn: col,
          label,
          approach: origin,
          destination,
          movement,
          vehicle,
          vehicleLabel: usePositionalVehicles
            ? CORE_VEHICLE_LABELS[vehicle]
            : candidate.headerVehicle.label,
        };
        detectedColumns.push(column);
        blockColumns.push(column);
      });
      for (let row = timeColumn.firstDataRow; row <= used.e.r; row++) {
        const cell =
          sheet[XLSX.utils.encode_cell({ r: row, c: timeColumn.column })]?.v;
        const start = parseTime(cell);
        if (start === null) continue;
        const interval = intervalMap.get(start) || {
          start,
          label: String(cell),
          values: [],
          sourceRows: {},
        };
        interval.sourceRows![safeObjectKey(sheetName)] = row + 1;
        blockColumns.forEach(function (column) {
          const value =
            sheet[XLSX.utils.encode_cell({ r: row, c: column.sourceColumn })]
              ?.v;
          interval.values[column.valueIndex] = Number(value) || 0;
        });
        intervalMap.set(start, interval);
      }
    });
  }
  detectedColumns.forEach(function (column) {
    if (column.destination && !originOrder.includes(column.destination))
      originOrder.push(column.destination);
  });
  detectedColumns.forEach(function (column) {
    if (!column.movement && column.destination) {
      column.movement =
        referenceMovementForOd(
          workbookName || file.name,
          column.approach,
          column.destination,
          originOrder,
        ) ||
        defaultMovementForOd(column.approach, column.destination, originOrder);
    }
  });
  const intervalRows = [...intervalMap.values()].sort(function (a, b) {
    return a.start - b.start;
  });
  /*
   * 一格是幾分鐘：取「所有間隔裡最常出現的那一個」，不是第一個。
   *
   * 舊寫法取 [0]（第一個正的間隔）。真實調查很常見開頭缺幾格（晚開始、
   * 換設備、第一段作廢），例如 15 分鐘的資料缺了 06:15/06:30/06:45，
   * 第一個間隔就是 60 分鐘——於是整份 15 分鐘資料被當成整點資料：
   * 尖峰的滾動視窗只需要 1 格，一格 15 分鐘的量被當成一小時的量
   *（實測真值 16,896 PCU/hr 被記成 4,224，只有四分之一），
   * survey.minutes 也會被高估四倍，讓 13 小時的調查填滿「全日」欄位。
   * 取眾數對「中間缺幾格」是穩健的；同票時取較小者（比較保守，
   * 寧可把整點資料當成細格資料多算幾格，也不要把細格資料當成整點）。
   */
  const gaps = intervalRows
    .slice(1)
    .map(function (row, index) {
      return row.start - intervalRows[index].start;
    })
    .filter(function (value) {
      return value > 0;
    });
  const gapCounts = new Map<number, number>();
  for (const gap of gaps) gapCounts.set(gap, (gapCounts.get(gap) || 0) + 1);
  let commonGap = 0;
  let commonCount = 0;
  for (const [gap, count] of [...gapCounts.entries()].sort(function (a, b) {
    return a[0] - b[0];
  }))
    if (count > commonCount) {
      commonGap = gap;
      commonCount = count;
    }
  /*
   * 保留實際的眾數格距，**不要**夾到 15–60 之間。
   * 夾過之後 2 小時一格的資料會變成 60，等於假裝它可以算尖峰小時；
   * rollingPeak 需要看到真實格距才判斷得出「這份資料組不成一小時」。
   */
  const intervalMinutes = Math.max(1, commonGap || 15);
  const surveyValues = Array.from(
    {
      length: Math.max(
        ...intervalRows.map(function (row) {
          return row.values.length;
        }),
        0,
      ),
    },
    function (_, column) {
      return intervalRows.reduce(function (sum, row) {
        return sum + (Number(row.values[column]) || 0);
      }, 0);
    },
  );
  intervalRows.forEach(function (row) {
    row.values = Array.from(
      { length: detectedColumns.length },
      function (_, index) {
        return Number(row.values[index]) || 0;
      },
    );
  });
  const weights = detectedColumns.map(function (column) {
    return pceFactor(pce, column.vehicle, column.movement || "through");
  });
  const baseRole: ImportPreview["role"] =
    /^T\d+[-_.]?\d+\.(xls|xlsx|xlsm)$/i.test(file.name.normalize("NFKC"))
      ? "參考計算檔"
      : intervalRows.length
        ? "原始交通量"
        : "無法辨識";
  const warnings: string[] = [];
  if (!buckets.log.length)
    warnings.push("未找到監測日誌；道路名稱與幾何仍可人工補正。");
  if (!buckets.phase.length)
    warnings.push(
      "未找到時相圖；不影響尖峰轉向流量，僅表示道路幾何可能需要人工校正。",
    );
  if (!intervalRows.length) warnings.push("未找到可辨識的時間序列資料。");
  const distinctApproaches = new Set(
    detectedColumns.map(function (column) {
      return column.approach;
    }),
  ).size;
  const mappingConfidence =
    detectedColumns.length >= 12 && distinctApproaches >= 2
      ? "high"
      : detectedColumns.length >= 4
        ? "medium"
        : "low";
  const layout: ImportPreview["layout"] = sawOd
    ? "od"
    : sawTurning
      ? "turning"
      : "unknown";
  const resolvedTemplateId =
    layout === "unknown" && detectedVehicles.length
      ? "full-day-road-vehicle-v1"
      : templateId;
  const resolvedTemplateName = importTemplate(resolvedTemplateId).name;
  const role: ImportPreview["role"] =
    layout === "unknown" && intervalRows.length && detectedVehicles.length
      ? "非路口轉向"
      : baseRole;
  const resolvedDetectedVehicles = detectedColumns.length
    ? [
        ...new Map(
          detectedColumns.map(function (column) {
            return [
              column.vehicle,
              {
                id: column.vehicle,
                label: column.vehicleLabel,
                core: Boolean(CORE_VEHICLE_LABELS[column.vehicle]),
              } satisfies VehicleDefinition,
            ] as const;
          }),
        ).values(),
      ]
    : detectedVehicles;
  if (role === "非路口轉向")
    warnings.push(
      `已辨識 ${detectedVehicles.length} 個車種與 ${intervalRows.length} 個時間區間，但未找到左轉、直行、右轉或起訖（OD）欄位；此檔不會寫入路口轉向資料。`,
    );
  else if (mappingConfidence === "low")
    warnings.push(
      "欄位語意不足，匯入前必須人工確認；系統不會把未知數值當成正式流量。",
    );
  else if (layout === "od")
    warnings.push(
      `已辨識 ${distinctApproaches} 個入口、${detectedColumns.length} 個起訖車種欄位；將保留 A→B 等實際流向，不強制改成左直右。`,
    );
  else
    warnings.push(
      `已辨識 ${distinctApproaches} 個入口區塊、${detectedColumns.length} 個左直右×車種欄位。`,
    );
  warnings.push(`套用格式範本：${resolvedTemplateName}。`);
  if (positionalVehicleBlocks && vehicleHeaderConflicts)
    warnings.push(
      `發現 ${vehicleHeaderConflicts} 個車種欄名與第 1–4 車種欄位順序不一致；已依欄位群組辨識為機車、小型車、大型／大客車、特種／聯結車，請在預覽確認。`,
    );
  if (/\.xls$/i.test(file.name))
    warnings.push("已使用舊版 Excel 97–2003（.xls）相容讀取模式。");
  return {
    file: options?.fileLabel || file.name,
    station: workbookStation
      ? stationFromFilename(workbookStation)
      : stationFromFilename(file.name),
    name: normalizeIntersectionName(workbookName || file.name),
    role,
    sheets: buckets,
    intervals: intervalRows.length,
    intervalMinutes,
    intervalRows: structuredClone(intervalRows),
    survey: {
      intervals: intervalRows.length,
      minutes: intervalRows.length * intervalMinutes,
      values: surveyValues,
    },
    am: rollingPeak(intervalRows, [5 * 60, 12 * 60], intervalMinutes, weights),
    pm: rollingPeak(intervalRows, [12 * 60, 23 * 60], intervalMinutes, weights),
    date: rocDate(dateText),
    dateSource: dateCell
      ? { sheet: dateCell.sheet, cell: dateCell.cell, raw: dateCell.text }
      : null,
    surveyType: resolveSurveyType({
      explicit: options?.surveyType,
      dateText,
      sheetNames: buckets.traffic,
    }),
    layout,
    approaches: originOrder,
    columns: detectedColumns,
    detectedVehicles: resolvedDetectedVehicles,
    mappingConfidence,
    warnings,
    templateId: resolvedTemplateId,
    templateName: resolvedTemplateName,
    pceUsed: structuredClone(pce),
  };
}

export async function inspectWorkbookVariants(
  file: File,
  pce: PceMatrix = DEFAULT_PCE,
): Promise<ImportPreview[]> {
  const array = await file.arrayBuffer();
  const fingerprint = prototypeFingerprint();
  const workbook = XLSX.read(array, SAFE_XLSX_READ_OPTIONS);
  assertNoPrototypePollution(fingerprint, file.name);
  const daySheets = workbook.SheetNames.filter(function (sheet) {
    return /^(平日|假日)\s*$/.test(sheet.normalize("NFKC"));
  });
  if (daySheets.length < 2) return [await inspectWorkbook(file, pce)];
  return Promise.all(
    daySheets.map(function (sheet) {
      const surveyType = sheet.normalize("NFKC").trim();
      return inspectWorkbook(file, pce, {
        trafficSheets: [sheet],
        fileLabel: file.name + "【" + surveyType + "】",
        surveyType,
      });
    }),
  );
}

export function formatMinutes(minutes: number) {
  const value = (minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
