import * as XLSX from "xlsx";
/* 調查日期的標籤優先、排除清單與曆日驗證只由共用模組判定。 */
import { findSurveyDate } from "./period-date.ts";

/**
 * 尖峰時段。三個都是「某一小時的流率」，PCU 欄位的單位是 PCU/hr。
 *
 * DAY（全日尖峰小時）＝掃過完整 24 小時找出來的最大一小時，**只有 24 小時的
 * 調查檔算得出來**。資料不足 24 小時時整組留空、畫面顯示「－」，絕不拿
 * 上午／下午尖峰去頂替——那等於用 4 小時的樣本冒充一整天的最大值。
 */
export type PeakKey = "AM" | "PM" | "DAY";

/**
 * 畫面與匯出用的「統計範圍」＝三個尖峰再加上 FULL。
 *
 * FULL（全日時段）**不是尖峰**，是一整天的累計量，單位是「輛／調查日」與
 * 「PCU／調查日」，不能和尖峰的 PCU/hr 相提並論。它也**不是獨立存起來的
 * 數字**：每次載入都由 record.survey／route.survey 現算（見 syncRouteTotals）。
 *
 * 為什麼要現算而不是存一份：同一個概念在系統裡有兩份來源，遲早會分岔——
 * 這個專案已經因為同類問題（同一件事在 N 個地方各算各的）修過三輪。
 * survey 是唯一的來源，FULL 只是它的另一種呈現。
 */
export type ScopeKey = PeakKey | "FULL";
export type MovementKey = "left" | "through" | "right";

/** 三個轉向的固定順序。要逐轉向套當量時一律走這一個，不要各處自己寫陣列。 */
export const MOVEMENT_KEYS: MovementKey[] = ["left", "through", "right"];

/** 轉向的中文名稱，只用於畫面與提醒訊息。 */
export const MOVEMENT_LABELS: Record<MovementKey, string> = {
  left: "左轉",
  through: "直進",
  right: "右轉",
};
/**
 * 一支支線的「轉向欄位盤點」：調查表印了幾個轉向、其中幾個是不存在的。
 *
 * ── 這張表在算什麼 ───────────────────────────────────────────
 * 調查表不管路口幾岔，每一支支線都固定印同樣幾個轉向欄（左轉／直進／右轉）。
 * 但一支支線實際上只能去 **（支線數 - 1）** 個地方。所以：
 *
 *     應該不存在的轉向數 ＝ 轉向欄數 - 去向數
 *
 *   ・三岔：3 欄 - 2 個去向 ＝ **每支剛好 1 個轉向不存在**（全路口共 3 個）
 *   ・四岔：3 欄 - 3 個去向 ＝ **0 個**（每一欄都對應一個真實去向）
 *   ・五岔以上：欄數少於去向數，算出來是負的，一律視為 0
 *
 * 這是純算術，不依賴任何調查廠商的編號習慣，所以可以拿來核對。
 * 實測 37 份實檔：三岔檔（岡山北路－育才路口、左楠路－世運大道、
 * 高楠路－1003 巷）都剛好每支 1 個純橫線轉向、合計 3 個，完全符合；
 * 四岔檔（台1－路科一路口、中山路－國昌路－民強街、台1－台28、
 * 左楠路－後昌路、後昌路－宏毅二路）一個純橫線都沒有，也完全符合。
 *
 * ── 為什麼要有這張表 ─────────────────────────────────────────
 * 一、**數量對不上就是有問題**：三岔卻只數到 2 個純橫線，代表有一欄被寫成
 *     空白沒畫橫線、或表頭欄位被讀錯。以前這種檔案會安靜通過。
 * 二、**四岔以上出現純橫線，意義完全不同**：四岔的 3 個轉向本來就各自對應
 *     一個真實去向，會畫橫線通常代表**禁止轉向或單行道**，那是真實的路口
 *     管制資訊。這種流向不可以像三岔的幽靈列那樣安靜刪掉，要讓使用者看見。
 * 三、**整欄空白時可以給出有依據的建議**：三岔某支線該缺 1 個轉向、卻一個
 *     橫線都沒畫，而剛好只有一個轉向整欄空白，那個空白就是缺的那一個。
 *
 * ⚠️ 這張表**只用來示警與提供建議，不參與任何交通量或 PCU 計算**。
 */
export type ArmMovementAudit = {
  /** 支線代碼（來自調查表表頭的「路口編號：」）。 */
  approach: string;
  /** 這支支線在調查表上印了幾個轉向欄。 */
  movementCount: number;
  /** 這支支線實際能去的地方＝支線數 - 1。 */
  destinationCount: number;
  /** 依算術「應該」有幾個轉向是不存在的。 */
  expectedAbsent: number;
  /** 實際整欄畫橫線（＝調查員明寫「沒有這個轉向」）的轉向。 */
  absent: MovementKey[];
  /** 實際整欄空白（既沒數字也沒橫線＝沒填，分不出來）的轉向。 */
  blank: MovementKey[];
};

/**
 * 逐支線盤點轉向欄位。輸入是 inspectWorkbook 產出的 columns。
 *
 * 判斷「這個轉向存不存在」一律以**調查表原本寫什麼**為準，不看算出來是不是 0
 * ——四岔與七岔的真實檔各有 6～9 欄是真的整天量到 0，只憑「全為 0」會刪掉真實
 * 資料（v2.1.53 實測過的錯誤）。
 *
 * 一個轉向要「所有車種欄都沒有數字」才算數，只要任何一格有數字就代表這個轉向
 * 存在。
 */
export function auditArmMovements(
  columns: Array<{
    approach: string;
    movement: MovementKey | null;
    numericCells: number;
    placeholderCells: number;
  }>,
): ArmMovementAudit[] {
  const withMovement = columns.filter(
    (column) => column.approach && column.movement,
  );
  const approaches = [...new Set(withMovement.map((c) => c.approach))].sort();
  const destinationCount = Math.max(0, approaches.length - 1);
  return approaches.map(function (approach) {
    const mine = withMovement.filter((c) => c.approach === approach);
    const movements = MOVEMENT_KEYS.filter((movement) =>
      mine.some((c) => c.movement === movement),
    );
    const cellsFor = (movement: MovementKey) =>
      mine.filter((c) => c.movement === movement);
    return {
      approach,
      movementCount: movements.length,
      destinationCount,
      expectedAbsent: Math.max(0, movements.length - destinationCount),
      absent: movements.filter(function (movement) {
        const cells = cellsFor(movement);
        return (
          cells.length > 0 &&
          cells.every((c) => c.numericCells === 0 && c.placeholderCells > 0)
        );
      }),
      blank: movements.filter(function (movement) {
        const cells = cellsFor(movement);
        return (
          cells.length > 0 &&
          cells.every((c) => c.numericCells === 0 && c.placeholderCells === 0)
        );
      }),
    };
  });
}

/**
 * 這一支支線的純橫線轉向，是不是**多過**算術預期。
 *
 * 三岔每支預期 1 個：正好 1 個 → 那就是幽靈列，照舊安靜移除，不打擾使用者。
 * 四岔預期 0 個：只要出現任何一個 → 一定是超出預期，要讓使用者看見再決定。
 */
export function absentBeyondExpectation(audit: ArmMovementAudit) {
  return audit.absent.length > audit.expectedAbsent;
}

/**
 * 整欄空白的轉向裡，能不能靠算術指認出「就是它不存在」。
 *
 * 條件很嚴：橫線畫得比預期少 N 個，而剛好只有 N 個轉向整欄空白，
 * 那這 N 個就是缺的那幾個。少一個條件都不給建議——寧可讓使用者自己決定，
 * 也不要給一個看起來有把握、其實是猜的建議。
 */
export function blankExplainedByArithmetic(audit: ArmMovementAudit) {
  const shortfall = audit.expectedAbsent - audit.absent.length;
  return shortfall > 0 && audit.blank.length === shortfall;
}

export type PceVehicle = string;
export type VehicleKey = "all" | PceVehicle;
export type LaneClass = "fast" | "slow" | "motorcycle" | "other";
/** mixed/left/custom are retained only so older JSON backups remain readable. */
export type LaneType = LaneClass | "mixed" | "left" | "custom";

export const PEAK_KEYS: PeakKey[] = ["AM", "PM", "DAY"];
export const SCOPE_KEYS: ScopeKey[] = ["AM", "PM", "DAY", "FULL"];

export const SCOPE_LABELS: Record<ScopeKey, string> = {
  AM: "上午尖峰",
  PM: "下午尖峰",
  DAY: "全調查時段尖峰",
  FULL: "全調查時段",
};

/** 匯出欄名與圖面標題用的短標籤（「AM Peak」這種既有寫法沿用）。 */
/*
 * ⚠️ 名稱在 2026-09-10 依使用者指定改過，三支程式一致：
 *     全日時段     → 全調查時段
 *     全日尖峰(小時) → 全調查時段尖峰
 *
 * 這不只是換字。舊名字宣告的是「一整天」，所以不足 24 小時的調查一律
 * 不算；新名字宣告的是「這份調查涵蓋的時段」，4 小時的調查算出來的
 * 「涵蓋時段內流量最大的那一小時」完全誠實，於是**閘門要拿掉**。
 * 使用者的原話：「三份程式統一名稱後，原本不用計算的資料，現在都要計算了」。
 */
export const SCOPE_SHORT_LABELS: Record<ScopeKey, string> = {
  AM: "AM Peak",
  PM: "PM Peak",
  DAY: "全調查時段尖峰",
  FULL: "全調查時段",
};

/**
 * 每個尖峰要在哪一段時間裡找那個最大的一小時。單位是「當天的第幾分鐘」。
 *
 * ⚠️ 上午／下午的範圍在 v2.1.30 由使用者決定放寬：
 *   舊：AM [05:00, 12:00)、PM [12:00, 23:00)
 *   新：AM [00:00, 12:00)、PM [12:00, 24:00)
 * 舊的兩段合起來掃不到 23:00–24:00 與 00:00–05:00，真正的尖峰若落在那六個
 * 小時，任何一個數字都抓不到。放寬之後兩段剛好把一天鋪滿、且不重疊。
 *
 * 實測使用者提供的 8 份調查檔，新舊口徑算出來的上午／下午尖峰完全相同
 * （深夜與清晨本來就不會是尖峰）；差別只在那六個小時真的出現尖峰的場合。
 * 即便如此這仍是**計算口徑變更**，所以 LAST_CALC_CHANGE_VERSION 一併推進。
 */
export const PEAK_RANGES: Record<PeakKey, [number, number]> = {
  AM: [0, 12 * 60],
  PM: [12 * 60, 24 * 60],
  DAY: [0, 24 * 60],
};

/**
 * 某個統計範圍的單位——**全系統只有這一支**。
 *
 * 尖峰是「某一小時的流率」（PCU/hr、輛/hr），全日時段是「一整天的累計量」
 * （PCU/調查日、輛/調查日）。兩者不可以相加、也不可以互相比較，所以單位
 * 一定要跟著範圍走。以前單位都是寫死的 "PCU/hr"，新增全日時段之後如果
 * 沿用，圖上會出現「24,463.3 PCU/hr」這種一看就錯的數字。
 */
/**
 * 這一批紀錄的調查涵蓋屬於哪一種。單位的分母由它決定。
 *
 * ⚠️ mixed 是**真的會發生**的：同一張表同時列出 24 小時與 4 小時的季度／路口。
 *   那時欄名只有一個，沒辦法同時是「日」又是「調查時段」。
 */
export type SurveyCoverage = "full" | "partial" | "mixed" | "unknown";

export function coverageOf(
  records: TrafficRecord | TrafficRecord[] | null | undefined,
): SurveyCoverage {
  const list = !records ? [] : Array.isArray(records) ? records : [records];
  const known = list.filter((item) => Number(item?.survey?.minutes || 0) > 0);
  if (!known.length) return "unknown";
  const full = known.filter((item) => coversFullDay(item.survey)).length;
  if (full === known.length) return "full";
  if (full === 0) return "partial";
  return "mixed";
}

/**
 * 某個統計範圍的單位——**全系統只有這一支**。
 *
 * 尖峰是「某一小時的流率」（PCU/hr、輛/hr），全調查時段是「整個調查涵蓋
 * 時段的累計量」。兩者不可以相加、也不可以互相比較，所以單位一定要跟著
 * 範圍走。以前單位都是寫死的 "PCU/hr"，新增全調查時段之後如果沿用，
 * 圖上會出現「24,463.3 PCU/hr」這種一看就錯的數字。
 *
 * ── 分母的規則（2026-09-10 使用者定案，三支一致）──────────────
 *
 *   整批都是 24 小時          → PCU/調查日
 *   整批都不是 24 小時        → PCU/調查時段
 *   **同一張表混合不同涵蓋**  → PCU/調查時段（＋表下方註明哪幾筆是幾小時）
 *
 * 使用者的原話：「如果確認為 24 小時的數值的話，分母就維持『日』，
 * 非 24 小時的才寫調查時段」「（混合的表）欄名就統一用 調查時段，
 * 然後表下方註明清楚」。
 *
 * ⚠️ 預設值刻意是「調查時段」而不是「調查日」。
 *   24 小時本來就是「調查時段剛好等於一日」的特例，用調查時段當共同分母
 *   不會說錯話；反過來用「日」當預設，任何忘了傳涵蓋的呼叫端都會把 4 小時
 *   的量宣告成全日量——**錯的方向要選會少講，不要選會多講**。
 */
export function scopeUnit(
  scope: ScopeKey,
  kind: "pcu" | "vehicle" = "pcu",
  coverage: SurveyCoverage = "unknown",
) {
  const per = scope === "FULL" ? (coverage === "full" ? "調查日" : "調查時段") : "hr";
  return `${kind === "pcu" ? "PCU" : "輛"}/${per}`;
}

/**
 * 四捨五入到小數一位，並且**把 -0 正規化成 0**。
 *
 * ⚠️ 為什麼需要這一支，而不是各處直接寫 `Math.round(x * 10) / 10`：
 *
 *   JavaScript 的浮點數有兩個零。`Math.round(-0.02 * 10) / 10` 得到的是
 *   **-0**，而 `(-0).toLocaleString()` 印出來就是「-0」。
 *   畫面上會看到「核對差值 -0 PCU/hr　兩者一致」——判定是對的，
 *   但那個負號會讓看報表的人以為有差額，然後花時間去追一個不存在的問題；
 *   更糟的是這種值會被匯出到 Excel，變成報告裡的「-0」。
 *
 *   `+ 0` 就足以正規化（-0 + 0 === 0），而任何其他值加 0 都不變，
 *   所以正負值、整數小數一律不受影響。
 *
 *   ⚠️ **這件事只影響顯示，不影響判斷**：-0 === 0 是 true，
 *     所以 `Math.abs(difference) < 0.11` 這類比較本來就是對的。
 *     不要因為看到這支函式就以為以前的核對邏輯算錯了。
 *
 *   實測 2026-09-10 大檢查在 111Q3 的流量核對工作台掃到「核對差值 -0」。
 *   凡是「兩個數相減之後要給人看」的地方都應該走這一支，
 *   由 tests/negative-zero.test.mjs 逐一把關。
 */
export function round1(value: number) {
  return Math.round(value * 10) / 10 + 0;
}

/** 一天有幾分鐘。「這份調查有沒有涵蓋完整一天」全系統只用這一個門檻。 */
export const FULL_DAY_MINUTES = 24 * 60;

/**
 * 這份調查是不是完整的 24 小時？
 *
 * 全日時段與全日尖峰小時**都**卡這一道；只有這一支函式說了算，
 * 不要在別處再寫一次 `minutes >= 1440`。
 */
export function coversFullDay(
  survey: { minutes?: number } | null | undefined,
): boolean {
  return Number(survey?.minutes || 0) >= FULL_DAY_MINUTES;
}

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
  /**
   * 三個尖峰的 PCU/hr，加上 FULL（全日時段）。
   * FULL 每次載入都由 survey 現算（syncRouteTotals），不是獨立來源。
   */
  volumes: Record<ScopeKey, RouteVolume>;
  /** Actual vehicles for the complete imported survey period. */
  survey?: {
    vehicle: Record<string, number>;
  };
  /**
   * 這個轉向到底存不存在——只有「調查表沒填」時才會是 "unknown"。
   *
   * 調查表用兩種寫法表達兩件不同的事：
   *   `0`  ＝ 這個轉向存在，只是整天量到 0     → 這裡不設值（等同 "yes"）
   *   `--` ＝ 這個路口根本沒有這個轉向          → 流向根本不會被建立
   * 但如果一欄**既沒有填數值、也沒有寫 `--`**，兩者都不是，系統無從判斷。
   * 那時候流向會先**保留**（保留最多是多一列 0，刪掉卻可能弄丟真實流向），
   * 同時標成 "unknown"，由匯入後跳出的視窗請使用者裁決。
   *
   * 使用者回答之後這個欄位就會被清掉或整條流向被移除，
   * 所以正常情況下存下來的資料**不應該**留著 "unknown"。
   */
  presence?: "unknown";
  /**
   * 為什麼要問（只在 presence 為 "unknown" 時有值，答完就清掉）。
   *
   *   "blank"       ＝ 整欄空白，調查表兩種寫法都沒寫，本來就分不出來。
   *   "placeholder" ＝ 整欄畫橫線，但**橫線的數量超出算術預期**。
   *                   三岔每支剛好 1 個是正常的幽靈列，照舊安靜移除不問；
   *                   四岔預期 0 個卻出現橫線，那通常代表禁止轉向或單行道，
   *                   是真實的路口管制資訊，不可以安靜刪掉。
   */
  presenceReason?: "blank" | "placeholder";
  /**
   * 系統依算術給出的建議答案（沒把握就不給）。只用於預設選項與畫面說明，
   * 不會自動套用——一律要使用者按下按鈕才生效。
   */
  presenceSuggestion?: "yes" | "no";
  /** 建議或提問的理由，直接顯示在裁決視窗上，讓使用者看得到依據。 */
  presenceBasis?: string;
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
  movements: Record<ScopeKey, Movement>;
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
  /*
   * ⚠️ **原始調查表上那一欄的車種名**，與上面兩個不是同一件事。
   *
   *   `vehicle`／`vehicleLabel` 是**歸類之後**的分析類型（聯結車併入特種車
   *   之後，這兩個是「特種車」）。但這張表的用途是
   *   「被質疑時逐格指出原始儲存格」——業主問「這個 1,763 PCU 怎麼算的」，
   *   翻開調查表看到的欄名是**聯結車**。
   *   只印「特種車」的話，使用者對不回原始檔案的那一欄，這張表就失去意義。
   *
   *   舊版只留歸類後的名字（`CORE_VEHICLE_LABELS[analysisVehicle] || …`），
   *   原始車種名就此消失。2026-09-15 補上。
   *
   * ⚠️ 兩者相同時（沒有被併走）就是同一個字，畫面上只印一次。
   * ⚠️ 舊備份沒有這兩個欄位（optional）——讀回來時退回 vehicleLabel，
   *   不可以顯示成空白。
   */
  sourceVehicle?: string;
  sourceVehicleLabel?: string;
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
  /*
   * 匯入當下，使用者對「這一天最忙的一小時橫跨中午」的決定。
   *
   *   "am"／"pm" ＝ 把那一小時算成 AM／PM Peak
   *   "ignore"   ＝ 照 12:00 的分界算，那一小時兩邊都不選
   *   沒有這個欄位 ＝ 匯入時沒有發生這種情況（絕大多數資料都是如此）
   *
   * ⚠️ 上午／下午的分界**固定在中午 12:00，不提供設定**（使用者 2026-09-12
   *   定案）。會需要人來決定的只有「最忙的那一小時剛好跨過中午」這一種，
   *   而那是逐筆的事實，不是一個全域參數。
   */
  noonSide?: "am" | "pm" | "ignore";
  /*
   * ── 匯入時讀到的逐時間格原始資料 ──────────────────────────
   *
   * 使用者 2026-09-12：「讓三份程式都能把讀到的原始資料存下來……不論未來
   *   有沒其他重算功能，至少有新增功能時，不需要使用者把所有計畫都重新
   *   匯入一次（工作量太大）。」
   *
   * ⚠️ 目前**沒有任何功能讀它**，這是刻意的：它是為了未來留的原料。
   *   會這樣做是因為 v2.1.29→v2.1.30 新增「全調查時段尖峰」時，舊資料
   *   因為沒有逐時間格資料而算不出來，使用者被迫把每一個計畫重匯一次。
   *
   * ⚠️ 容量實測（使用者提供的 37 份真實檔）：平均一筆 2 KB、最大 8 KB，
   *   全部加起來 268 KB。資料存在 IndexedDB（v2.1.52 起），配額是 GB 等級，
   *   這個量完全不是問題。
   *
   * ⚠️ **選填**：v2.1.67 以前匯入的紀錄沒有這個欄位，那些資料要重新匯入
   *   一次才會有。這一點無法回推——當初就沒有存。
   */
  sourceIntervals?: {
    /** 每一格幾分鐘（15、20、30、60…） */
    intervalMinutes: number;
    /** 每一欄對應的（支線、車種、轉向）——與 values 的順序一一對應 */
    columns: { approach: string; vehicle: string; movement: string; destination?: string }[];
    /** 逐時間格的原始值 */
    rows: { start: number; label: string; values: number[] }[];
  };
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
  /**
   * ── 重算用的逐格原始資料 ────────────────────────────────────
   *
   * 使用者 2026-09-11 實測：114Q2 匯入時忘了把「聯結車」併入「特種車」，
   * 事後想改卻改不動——因為這支程式在匯入當下就把 PCU、OD 與**尖峰**
   * 算完存起來了，而留下的軌跡只有「已選定尖峰時段內」的逐格值，
   * 沒有完整的逐時逐車種資料，**沒辦法重新挑尖峰**。
   *
   * 把匯入預覽原封不動留下來就解決了：重算＝拿這一份重跑
   * `configuredImportPreview()`（用新係數重挑尖峰）再重跑
   * `recordFromPreview()`。**完全不新增任何計算邏輯**——
   * 重算走的是與當初匯入一模一樣的那兩支函式，結構上不可能算出第三種答案。
   *
   * ⚠️ 實測儲存成本：平均每筆 8 KB、最大 43 KB（168 欄的七叉路口）。
   *   65 路口 × 8 季約 4.2 MB。
   *
   * ⚠️ **選填**。舊資料沒有這一份，那些紀錄就不能重算——畫面要講清楚
   *   「這一季是舊版匯入的，要重算請重新匯入」，不可以按了沒反應。
   */
  sourcePreview?: ImportPreview;
  sourceFiles: string[];
  importedAt: string;
  validation: {
    referenceFound: boolean;
    matchRate: number | null;
    notes: string[];
  };
};

/**
 * ══════════════════════════════════════════════════════════════════
 *  一筆異常的「解決方式」（X-49，使用者 2026-09-16）
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者原話：
 *   「使用者處理完後，重新按一次檢查，問題如果解決了，就要確實消失……
 *     如果這個異常狀況真的只能靠重新匯入解決，那就請在檢查結果表中，
 *     標註說明請重新匯入該筆檔案」
 *   「我建議在檢查結果表中，新增一欄"解決方式"(例如重新匯入檔案、
 *     指引前往某分頁進行人工確認等)」
 *
 * ⚠️ **每一類異常各寫各的，不可以共用一句通用句**（例如全部寫「請檢查資料」）。
 *   那等於沒寫。寫不出來的那一類，代表它本身沒有出路——那是要回報的問題，
 *   不是拿一句話帶過的理由。
 *
 * ⚠️ `kind` 是給使用者看的**期待管理**，不是分類標籤：
 *   ・畫面修正 → 程式裡真的有地方可以改，改完重按檢查**就會消失**
 *   ・重新匯入 → 錯在原始檔、畫面上沒有入口，一直按檢查也不會消失
 *   ・人工確認 → 不一定是錯，要有人看過並判定
 *   標成「畫面修正」卻其實改不掉，就是對使用者謊報。
 */
export type IssueResolution = {
  kind: "畫面修正" | "重新匯入" | "人工確認";
  /** 使用者實際要做的那件事，一句話講完。 */
  text: string;
  /** 可以直接跳過去的分頁 id（對應 NAV 的 id）；沒有對應分頁時省略。 */
  view?: string;
  /** 那個分頁在側欄上的名字，拿來寫按鈕文字。 */
  viewLabel?: string;
};

export type QualityIssue = {
  id: string;
  severity: "error" | "warning" | "info";
  category: "缺值" | "總數不一致" | "尖峰時段異常" | "車種統計異常";
  station: string;
  quarter: string;
  message: string;
  /** X-49：這一筆要怎麼處理。**每一筆都必須有**，沒有就是漏掉了。 */
  resolution: IssueResolution;
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
  /*
   * v2.1.38 以前，日期欄括號裡寫什麼就存什麼，於是「（晴）」這種寫法會留下
   * `surveyType` 為「晴」 的舊紀錄。那不是系統認可的資料別，也不是「待設定」，
   * 若原樣比對，重新匯入同一個檔案會多出一筆——正是這一版要修掉的症狀，
   * 反而被修正本身在既有資料上觸發。這裡把非平日／假日一律視同「待設定」，
   * 讓它可以被有資料別的新匯入接手。
   */
  const normalizeType = (value?: string) =>
    value === "平日" || value === "假日" ? value : "待設定";
  const recordType = normalizeType(record.surveyType);
  const itemType = normalizeType(item.surveyType);
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
 *     括號內只認平日／假日，其餘一律回「待設定」（有些案子會寫「路口轉向」之類）。
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
  /*
   * 括號裡的內容只接受「平日」「假日」。
   *
   * 舊版把括號內容原樣當成資料別，但調查表的日期欄常常寫的是別的東西：
   * 「日期：115年06月03日（晴）」會得到資料別「晴」，「（第一天）」
   * 「（星期日）」同理。而且「晴」不是「待設定」，於是 isSameSurvey 不讓
   * 重新匯入接手它——同一個檔案再匯一次只會多出一筆，趨勢線被拆成兩條，
   * 匯出的「資料別」欄位也印著「晴」。系統對「待設定」有整套補救機制
   *（專屬 UI、批次補完），這條路徑卻繞過了它們。
   * 系統認可的資料別只有平日與假日，其餘一律回「待設定」由使用者補。
   */
  const inParentheses = (input.dateText || "")
    .match(/[（(]\s*([^）)]+)\s*[）)]/)?.[1]
    ?.normalize("NFKC")
    .trim();
  if (inParentheses === "平日" || inParentheses === "假日")
    return inParentheses;
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

export const VERSION = "v2.1.79";

/**
 * 最後一次「動到計算口徑」的版本。
 *
 * 成果鎖定會記下鎖定當時的系統版本。舊版只要版號和目前不同就報「鎖定衝突」，
 * 但那是字串完全相等比較——**升過一次版，所有已鎖定的資料就永遠亮著紅字**，
 * 而且下一版又全部重來一次。使用者有 20 幾季資料時，那是 20 幾筆永遠消不掉的警告。
 *
 * 更糟的是它會淹掉真正該看的那一個：「鎖定後的資料內容已變更」。兩種訊息長得
 * 一模一樣紅，看久了就會連真的那次也一起略過。
 *
 * 所以改成：只有當鎖定當時的版本**早於**這個常數，數字才可能和現在不同，
 * 那時候才算衝突。之後的改版若沒有動計算，鎖定仍然有效，只顯示一行說明。
 *
 * ⚠️ 升版時如果真的改了計算口徑（PCU 當量、尖峰視窗、駛入推導、車種歸類…），
 *    **這個常數要跟著改成新版號**，否則舊鎖定會被誤判為仍然有效。
 *    只改介面、文件、測試或發布流程則不要動它。
 *
 * 目前是 v2.1.30。那一版動了兩件計算口徑：
 *   (1) 上午尖峰的搜尋範圍由 [05:00, 12:00) 改為 [00:00, 12:00)，
 *       下午尖峰由 [12:00, 23:00) 改為 [12:00, 24:00)。舊的兩段合起來
 *       掃不到 23:00–24:00 與 00:00–05:00。
 *   (2) 每一格的原始車輛數先四捨五入成整數再進入所有計算（有些調查檔
 *       的儲存格存的是小數，Excel 只是顯示成整數）。
 * 實測使用者提供的 8 份調查檔，(1) 新舊口徑算出來的尖峰完全相同、
 * (2) 只影響儲存格本來就有小數的那一份；但口徑確實變了，依使用者決定
 * 推進本常數，讓 v2.1.30 以前鎖定的季度亮出鎖定衝突。
 *
 * 在此之前是 v2.1.21：那一版改了尖峰小時的口徑（只接受能精確組成 60 分鐘的格距）。
 * v2.1.22 是存檔問題，v2.1.23～v2.1.29 每一版都自述未變更計算。
 *
 * ── v2.1.64（2026-09-10）：全調查時段尖峰不再卡 24 小時 ────────────
 *
 * 「全日尖峰小時」改名為「全調查時段尖峰」，隨之拿掉「調查要滿 24 小時
 * 才計算」那道門檻。舊名字宣告的是一整天，4 小時的樣本算出來的值會被
 * 當成整天的最大值抄進報告；新名字宣告的是「這份調查涵蓋的時段」，
 * 4 小時的調查算出「這 4 小時裡最忙的一小時」是誠實的。
 * 使用者 2026-09-10 指定：「三份程式統一名稱後，原本不用計算的資料，
 * 現在都要計算了」。
 *
 * 實測 44 份真實調查檔（harness/verify-peak-turning.mjs）：
 *   ・24 小時的檔案，新舊算出來的視窗**完全相同**（回歸底線守住）
 *   ・5 份 4 小時的檔案由「算不出來」變成有值，視窗都落在有資料的區間內
 *   ・另外用獨立寫的一支演算法重算 AM／PM／DAY 三個視窗，44 份全部相同
 *
 * ⚠️ 這確實是計算口徑變更：同一份 4 小時的調查，舊版顯示「－」、新版顯示
 *   一個數字。所以本常數推進到 v2.1.64，讓更早鎖定的季度亮出鎖定衝突——
 *   否則使用者會拿到一份「鎖定時是舊算法、現在是新算法」而毫不知情的成果。
 */
export const LAST_CALC_CHANGE_VERSION = "v2.1.64";

/** 把 "v2.1.21" 拆成 [2,1,21] 以便比大小；認不得的格式回傳空陣列。 */
function versionParts(version: string): number[] {
  const match = String(version || "").match(/^v?(\d+(?:\.\d+)*)$/);
  return match ? match[1].split(".").map(Number) : [];
}

/** version 是否等於或新於 baseline。格式認不得時一律回傳 false（從嚴）。 */
export function isVersionAtLeast(version: string, baseline: string): boolean {
  const a = versionParts(version);
  const b = versionParts(baseline);
  if (!a.length || !b.length) return false;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

export type LockStatus = {
  /** 真的需要使用者處理的事，會以紅字顯示。 */
  conflicts: string[];
  /** 只是說明，不是問題（例如升版但沒動計算）。 */
  note: string;
};

/**
 * 判斷一筆鎖定成果現在的狀況。
 *
 * 抽到這裡是為了能被測試：這段邏輯原本寫在畫面元件裡，而它決定的是
 * 「使用者要不要為了一行紅字去解除、重新鎖定 20 幾季的資料」，值得釘住。
 *
 * @param lockedVersion 鎖定當時的系統版本
 * @param currentVersion 目前的系統版本
 * @param signatureMatches 鎖定後資料內容有沒有被動過
 */
export function lockStatus(
  lockedVersion: string,
  currentVersion: string,
  signatureMatches: boolean,
): LockStatus {
  const conflicts: string[] = [];
  if (!isVersionAtLeast(lockedVersion, LAST_CALC_CHANGE_VERSION))
    conflicts.push(
      `鎖定當時的版本（${lockedVersion}）早於最後一次變更計算口徑的 ${LAST_CALC_CHANGE_VERSION}，數字可能已經不同`,
    );
  /*
   * ⚠️ 這一條只有在「兩個版號都解析得出來」時才成立。
   *
   * isVersionAtLeast 認不得格式時一律回傳 false（從嚴），對「鎖定版本早於常數」
   * 那一條來說是對的；但用在這裡會反過來出事：只要 VERSION 帶了 `-final`、
   * `-rc1`、`-hotfix` 這種尾巴，或前後多一個空白，它就解析不出來，於是
   * **每一筆 v2.1.21 以後鎖定的資料全部亮紅字**——正是這一版要修掉的那個症狀。
   * 實測 19×19 的版號矩陣：currentVersion 一旦不可解析，就多出 344 筆紅字。
   * 而且訊息會說反（「較新的版本 v2.1.27 鎖定、目前 V2.1.28」）。
   *
   * 版號認不得是「不知道」，不是「有問題」，所以這裡不報衝突。
   */
  else if (
    versionParts(currentVersion).length > 0
    && versionParts(lockedVersion).length > 0
    && !isVersionAtLeast(currentVersion, lockedVersion)
  )
    conflicts.push(
      `這筆成果由較新的系統版本（${lockedVersion}）鎖定，目前版本（${currentVersion}）無法確認相容性`,
    );
  if (!signatureMatches) conflicts.push("鎖定後的資料內容已變更");
  const note =
    conflicts.length || lockedVersion === currentVersion
      ? ""
      : `鎖定當時的版本是 ${lockedVersion}，之後的改版沒有變更計算口徑，數字不受影響。`;
  return { conflicts, note };
}
export const VERSION_HISTORY = [
  {
    version: "v2.1.79",
    date: "2026-09-18",
    note: "大檢查（Fable 5.1）：畫面說明與實際行為對齊、重複資料一律擋下、多處純文字星號清理。**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.64。**(1) 三處說謊的說明**：「各路口尖峰彙總」寫「不適用尖峰時段判定方式／資料別／轉向別」，但表格每一格走 viewFor（判定方式與轉向別確實套上，真實檔實測轉向別＝左轉時 T15-01 的 AM 轉向總量 3,976.6→1,422.8），改成只保留真的不跟的「資料別」並以 data-consumes 宣告判定方式；「各支線駛入／駛出尖峰流量」卡片原本依目前尖峰時段的總量排序、切時段就換位置，改成依站號；「車種組成分析」跨路口表寫「用本頁自己的時段設定，不適用主工具列的尖峰時段…資料別」，實際跟著主工具列的尖峰時段（本頁時段鈕是鏡子）與資料別變，改成只列真的不跟的四項，並在「上午＋下午並列」時說明本表顯示上午。**(2) F-11 使用者裁示**：同一張表兩個欄群同一路口編號、同一欄群兩欄同名、同一支線時距重複，一律**擋下不寫入**（原本只警告、按確認仍相加寫入），訊息寫到「哪一張工作表、第幾欄～第幾欄／哪一格」並告知修正後重新匯入（ImportPreview 新增 blockReason；tests/duplicate-labels.test.ts 改為擋下語意，原始版 3 紅）。**(3) 純文字裡的 Markdown 星號**：lib/traffic.ts 匯入警告×2、lib/conclusion.ts、lib/report-draft.ts×2、lib/trend-metrics.ts 圖說、app/main-filters.ts 共 7 處拿掉；tests/plaintext-markup 擴到 app/＋lib/ 全部原始檔（排除已不渲染的 VERSION_HISTORY）。**(4) 位置代稱**：轉向圖縮放提示的「按左邊」「右邊還有約 N 像素」改成寫按鈕名稱；新增 tests/wording.test.mjs（取代交付包裡不存在的 ../harness）。**(5) 守門**：scripts/e2e-filter-coverage 補上反向那一半——寫著「不適用 X」的塊數字不可以因 X 變、consumes 與不適用不可同時宣告、SVG 座標取 2 位小數避免浮點假差；在 v2.1.78 建置上跑 3 項紅（composition-all×2、peaks-branch），本版全綠。tests/pending-index 在交付包環境（沒有 ../待修正事項_*.md）改為 skip。",
  },
  {
    version: "v2.1.78",
    date: "2026-09-18",
    note: "使用者逐項回報的收尾，**沒有變更任何交通量或 PCU 計算**。**(1) X-78 主工具列預設收合**：三支統一，而且**不記進 localStorage**——使用者要的是「重新載入或第一次開網頁時」都收合，記住狀態反而做不到。收合那一列仍然寫著目前的條件，這一點不可以為了收合而犧牲。⚠️ 這一改讓**十幾支端對端腳本逾時**（它們還在等收合起來的欄位出現），已補上共用的 `scripts/_toolbar.mjs`，並逐支確認——包含兩支**另開第二個工作階段**的（e2e-peak-rule 的 legacy、e2e-intersection-dedupe 的 identityPage），那兩支第一次補的時候漏掉了。**(2) X-83 尖峰形狀兩張圖**：使用者問「多選調查點時這是加總還是平均」，查證結果**兩者都不是**——那兩張畫的是一季×一個路口×一種資料別（current 先濾掉別季、selected 再挑一個路口）。缺陷是圖上沒寫是誰。已補標題（季別・路名，**不寫站號**，使用者指定）與多選時的提醒；單選時提醒不出現（常駐＝噪音）。**(3) X-84 歷季趨勢圖三處**：說明在圖與「季度變化」上重複（改成一塊完整、一塊短版指回去，**兩塊都仍帶 data-inapplicable**，逐塊守門照樣量得到）；「起＝迄時不限季」是**舊行為的殘留說明**（程式早就照 2026-09-15 的裁示做成單一季度），畫面在說謊，已更正；不跟隨說明依使用者要求精簡成一句。**(4) X-85 季度改名**：全日交通量早就有，本支補上，位置與它一致（資料維護，排在刪除單一季度上面）。兩條界線：**不可以併進已存在的季度**（擋下來，不自行合併）、要**一次改完全部**（records ＋ 還原點的 snapshot 與批次標籤）。**(5) 守門**：新增 `scripts/e2e-rename-quarter.mjs`（含「撞名時一格都不可以動」的反面）、`scripts/e2e-peak-shape-scope.mjs`（含「單選時不可以出現提醒」的反面）。兩支都做過反證。",
  },
  {
    version: "v2.1.77",
    date: "2026-09-17",
    note: "加總／並列稽核的最後兩項（I、J），**沒有變更任何交通量或 PCU 計算**。**(1) 稽核表 I：報告文字草稿的代表紀錄可能悄悄換成別的路口。** 報表有自己的季度區間，而「目前選定的路口」跟著主工具列走；兩者對不上時（報表 115Q2～115Q4、選定的路口只在 115Q1 調查過）舊版一路退回 `latestBySeries.values().next().value`——匯入順序上的第一筆，別的路口、別的季、別的日別——然後照樣把那一筆的支線流量與車種組成寫成正文，畫面上只寫「以 ○○ 為代表」，**沒有一句說你選的那個不在裡面**。退路保留（不留的話整段草稿寫不出來），但改成明講：草稿直接寫「目前選定的『…』不在這份報表的季度範圍內，所以改以 … 為代表，要寫選定的那一個請調整季度區間」。**(2) 稽核表 J：結論草稿「整體結果」的代表紀錄是陣列的第一筆**，而 `selectRecords()` 的排序是「季度由小到大、再站號字典序」——所以那一筆是**最舊一季、站號最小**的，而報告通常要引用最新一季，挑法連方向都相反。改成取最新一季（同季時取站號較小者），並把「怎麼挑的」與「其餘 N 筆沒有寫進這一段」都寫出來。**(3) 守門**：`tests/report-draft.test.ts` 兩條（落到退路要講、正常情況不可以講）、`tests/conclusion.test.ts` 一條改寫（原本寫死 `代表紀錄：115Q1`，等於把舊的錯誤行為釘住）。三條都做過反證。",
  },
  {
    version: "v2.1.76",
    date: "2026-09-17",
    note: "匯入時「重複」的東西一律出聲（X-66），**沒有變更任何交通量或 PCU 計算**。起因是使用者問交通服務水準的旅行／行駛速率怎麼判讀欄位，接著問「另外兩支程式有這類問題嗎?三支程式是否都是讀取標籤，然後欄位如果有換位，都能讀到，如果有重複，也能指出異常讓使用者去確認的功能嗎?」——查下去發現本支有**三種重複是完全安靜的**。**(1) 兩個欄群讀到同一個「路口編號：A」**：下游一律「篩出 approach 等於這個名字的欄位再加總」，所以撞號的結果是那一支的流量變成兩支相加，而畫面上只看得到一支 A。**(2) 同一個欄群裡兩欄完全同名**（例如兩欄「機車｜左轉」）：同一個「車種×流向」被重複計入。**(3) 同一支支線裡同一個時距重複**：`interval.values[...]` 是指派不是累加，後一列**蓋掉**前一列，而且 `sourceRows` 一起被蓋——逐格追溯會指到錯的列，追溯功能本身在說謊。三者都改成在匯入預覽出警告，**只指出、不替使用者挑、不平均、不相加**（與交通服務水準 X-65 同一條標準）。⚠️ 時距那一條的判斷範圍必須是**這一個欄群**而不是整張工作表：intervalMap 本來就以「開始分鐘」為鍵，好讓同一張表的各支線併成同一列，用工作表當範圍的話每一份多支線檔案都會被誤報（已用一份四支支線、時距完全相同的正常檔案把這個寫法擋下來，反證實跑過）。**(4) 守門**：新增 `tests/duplicate-labels.test.ts`（4 條，含一條「正常檔案一句都不可以叫」的對照組），反證實跑：拿掉三段收集之後該紅的三條紅、對照組照舊綠。",
  },
  {
    version: "v2.1.75",
    date: "2026-09-17",
    note: "版面重組與兩個「本頁有自己的選擇器、卻被主工具列鎖住」的真錯，**沒有變更任何交通量或 PCU 計算**。**(1) X-61「報表與批次輸出」拆成兩個大分頁**：成果交付（要匯出哪些分析結果＋報告文字草稿）與批次輸出（Excel／PDF／全部圖檔／向量圖四張窄卡在上，多計畫批次成果包橫式大卡在下）。使用者自己先問了「下方的小分頁彼此之間是否都有關聯」——查證結果是有：那一排勾選同時決定報告文字草稿、分析數據 Excel 與多計畫批次成果包三者的內容，所以兩張吃它的卡片上把相依關係寫在畫面上並加一顆跳過去的鈕。**(2) X-60 歷季趨勢比較的路口下拉選不動**：一段同步用的 effect 從**套過主工具列**的那一份推回路口，主工具列只留 A 時選 B 會立刻被扳回 A——而那一頁白紙黑字寫著「本頁不適用主工具列的『路口』」。已限縮那個 effect 的職責（只在值真的不存在時才補）。**(3) X-64 道路與流向管理被主工具列鎖住**：站號逐季會變，勾了舊季的路口再匯入新一季，「切換路口」整個空掉、連換都換不了，而幾何卡還停在上一季（畫面上同時寫著兩個季度）。這一頁是設定頁，改用它自己的一份資料（這一季的全部路口），並在畫面上明講不受主工具列的路口與資料別影響。**(4) X-58／X-59 資料維護**：摘要那一塊補上看得見的標題、「執行資料異常檢查」進側欄並補上 focusClass，摘要卡的說明從「這一季」更正為「全部季度」（X-48 改了程式、字沒跟著改）。**(5) X-57** 執行資料異常檢查那一塊整個貼著卡片左邊框（.panel 本身沒有內距，而它用的 .panel-title 沒有內距規則）。**(6) 守門**：新增 e2e-page-isolation（每一個大分頁只顯示自己的內容）、e2e-trend-intersection、e2e-geometry-scope；三支都做過反證。⚠️ 同時換掉一支**假守門**：e2e-maintenance 的「標題與狀態列左緣同一條線」是恆真的（狀態列是 block，左緣永遠等於卡片內容左緣），反證試出來是綠的。",
  },
  {
    version: "v2.1.74",
    date: "2026-09-14",
    note: "主工具列上線：把散在各頁的篩選條件彙整到每一頁最上方的同一列，並加上使用者指定的三態（鏡子／脫離／回歸）。**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.64；改版前後以同一份測資逐頁逐格比對，既有數字一個都沒有變。**(1) 主工具列**（每一頁都看得到）：季度起訖區間（預設起＝迄＝單季）、路口多選、尖峰時段、尖峰時段判定方式、路口流量視角、資料別、車種、轉向別、顯示數值。**(2) 三態**：沒動過的區塊顯示的就是主工具列的值，主工具列一改它看得到跟著變而且數字真的重算（鏡子）；在區塊上改條件只有那一塊改用自己的值並寫明「目前用本區塊自己的條件（主工具列：…）」（脫離）；每一塊脫離的區塊有一顆「回到主工具列條件」，主工具列上另有一顆「回歸全部（N 張圖）」（回歸）。**(3) 不適用的條件單獨顯示不適用並說明理由**，而且只在真的篩了那個條件時才出現——沒篩卻講一句沒有人問的話是另一種噪音。**(4) 結論草稿與報表輸出維持獨立**（使用者明確裁示），另加一顆「套用主工具列目前的條件」。**(5) 計算層的兩個真實錯誤**（都是這次升級才照出來的）：`recordWithMovementFilter` 只清了流向、沒有清 `approach.movements`，於是「只看左轉」時 routes 表算 1,573.4、路口總量卻仍是 5,413.1；`directionPeak` 只算了當下那一個尖峰時段，脫離到 PM 的圖會拿 AM 推出來的時窗去算。兩者都補了手算黃金值的單元測試。**(6) 2026-09-14 逐頁肉眼檢查**：開機的「資料已搬到 IndexedDB」告知訊息直接呼叫 setToast()，**沒有人幫它關掉**，於是 18 頁每一頁的右下角都蓋著它（在轉向圖蓋住左／直／右圖例、在彙總表蓋住最後一列）——改走 notify()；歷季趨勢比較同時有兩組季度（主工具列 115Q2～115Q2、圖上 115Q1～115Q2）而中間沒有一個字解釋，補一行常駐說明講明兩者是先後兩道。**(7) 守門**：新增 e2e-main-toolbar（三態，連數字一起量）、e2e-filter-coverage（每個條件×每一頁：不是真的算了就是寫明不適用）、e2e-quarter-range、e2e-diagram-detach、e2e-apply-main、probe-filter-matrix。",
  },
  {
    version: "v2.1.73",
    date: "2026-09-14",
    note: "側欄的展開收合改成「點大分頁就展開它的小分頁」，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.64。使用者 2026-09-14 在交通服務水準回報（附圖，「路段管理」被選中卻是收合的）：「當我點選大分頁標題(路段管理)時，它並沒有展開而是保持收合，請修正成自動展開下面的各項小分頁，如同另外兩個程式一樣的做法」，並接著要求「請同步確認三份程式是否都能自動展開」。本支是同一個毛病：小分頁的收合狀態寫在 localStorage，按過一次那顆 ▼ 之後那一頁就**永遠**是收的，再怎麼點大分頁都不會展開。**(1)** 大分頁的 onClick 在換頁之前先把自己從收合清單移除。**(2)** 小分頁的收合狀態改成**只留在記憶體**，並清掉舊的鍵——這一支重新整理會回到預設分頁，要回某一頁就一定得點它一下，而點下去現在就展開，所以「記住小分頁收合」唯一做得到的事就是製造上面那個毛病。分類（整區）收合**不一樣，仍然記住**，因為分類標題永遠在畫面上。**(3)** 分類標題字級由 13px 改成 16px／800（和交通服務水準同一個毛病，使用者還沒點到本支；「我們踩過的雷，請確保三份程式都不會再踩到」），並清掉 .nav-zone-toggle 重複的 font-weight。**(4) 守門**：e2e-nav-collapse 的第(4)條由「重新整理之後還記得」改寫成「收合後離開再點回來要展開」＋「重新整理之後是展開的」，並補「收合鈕仍然收得起來／再按一次展開回來」——只驗展開的話，把收合做死也會全綠；反面測試（把 onClick 的展開拿掉再建置）× 0/3。e2e-nav-zone 的字級門檻改成**關係**而不是絕對數字：分類標題不可以比它底下的分頁小，並附一條前置確認真的量到分頁字級。⚠️ 我在交通服務水準第一次就是寫「至少 13px」，那是只想著「比原本大就好」，結果仍比 16px 的分頁小，使用者只好再回報一次。",
  },
  {
    version: "v2.1.72",
    date: "2026-09-14",
    note: "依使用者指名做「零警告」，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.64。**(1) lint 改成一條警告都不准有**（另外兩支本來就是，三支一致）。原本那兩條警告來自兩個**刻意不給相依陣列**的 effect（量側欄有哪些區塊真的畫得出來、量轉向圖有沒有被裁切）——規則的警告文字建議「改成 []」，而那在這兩處是**錯的修法**：改成 [] 等於只量一次，而這兩段存在的目的正是每次 render 後重新量一次畫面。所以是就地豁免，理由寫在程式碼旁邊。**(2) 但豁免不可以變成貼紙**：規則擔心的無限重繪是真的會發生的，這兩處之所以安全，唯一理由是它們的 setState 寫了「算出來和上一次一樣就原封不動回傳 previous」。新增 `tests/render-loop-guard.test.mjs` 把那道防護釘住：掛了豁免的 effect 裡**每一個** setState 都要是那個寫法，少一個就紅。⚠️ 第一版寫成「至少有一個就算過」，反面測試（把其中一個改成直接寫值）**照樣全綠**——因為同一個 effect 裡還有另一個守規矩的頂著；已改成逐一檢查。⚠️ 另外前置檢查也被自己抓到過一次：檔案裡同一個規則的豁免其實有**兩種**（有相依陣列但故意不完整的 3 處、完全沒有相依陣列的 2 處），第一版混為一談，已分開。**(3) 豁免那一行不可以加 `-- 理由` 尾巴**：實測帶說明尾巴會讓 eslint 多報一條假的「Unused eslint-disable directive」，而 lint 是零警告，那條假警告會讓整包變紅。**(4) 短說明不可以被 max-width 逼到換行**（三支同步的守門，本支原本就沒有中招）：新增 `scripts/e2e-text-wrap.mjs`。",
  },
  {
    version: "v2.1.71",
    date: "2026-09-14",
    note: "使用者 2026-09-14 實測回報的三件事，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.64。**(1)「清除原始資料」那顆鈕的名字在誘導人按**：使用者問「原始資料被清掉? 表示之後如果我改轉向當量參數，就無法套用重算了? 因為寫原始資料感覺按下去後果蠻嚴重的」——他說對了。那顆鈕不刪任何數字，但丟掉的是每一筆的原始逐格快照，而那份東西唯一的用途就是日後重算；清掉之後要改歸類或係數只能重新匯入。舊的名字只寫好處（「省約 0.2 MB」），代價藏在確認框裡。依使用者指定的分工改成：按鈕短寫「清除原始資料」、旁邊備註「目前只佔 0.2 MB，建議本機資料累積到 1 GB 以上再清除」（兩個數字並排，一眼看得出差多遠）、確認視窗寫明「未來要重算必須重新匯入原始檔案」。⚠️ 我第一版把整句代價塞進按鈕名字，變成一顆很長的鈕，是矯枉過正。**(2)「這張圖怎麼講（簡報用）」不再列成小分頁**：使用者「說明文字類型的不用在左側欄位中做成小分頁」。它裡面有一顆「複製全部說明」，按既有判準會被算成該列的一塊——判準因此補一條：「複製／下載**這一塊自己的說明文字**」不算可操作的控制項。⚠️ 不可以變成萬用貼紙：守門要求純說明區塊裡的按鈕**每一顆**都掛 data-copy-own-text，漏一顆就紅。**(3) 側欄小分頁可收合**（三支同步）：大分頁那一列最右側一顆獨立的箭頭鈕，只負責收合，那一列其餘區域的換頁行為一個字都沒改；狀態記在本機。⚠️ 收合鈕沒有另外包一層 DOM——包一層的話 `nav > div > button` 就打不到大分頁按鈕，而八支既有守門都那樣寫。即使如此仍有三支守門被絆到，全是「恆真」型：它們用「側欄每一顆按鈕的文字」當分頁清單，收合鈕的「▼」混進去之後腳本會去點它＝把小分頁收起來。三支都改成 `:not(.nav-collapse)`。**(4) 試用版的手冊按鈕原本是死連結**：把產出的單檔試用版真的用 file:// 打開、走到手冊那一頁去量那顆按鈕的 href（不是讀原始碼猜的），量到的是 `./Turning-Traffic-vX.Y.Z-新手操作手冊.pdf`——單檔旁邊沒有那個檔，按下去**連錯誤訊息都沒有**，畫面毫無反應。交通服務水準早就踩過同一顆雷並修好（把手冊嵌成 data URI），本支與全日交通量卻一路沒補上。已改為內嵌，並補兩層守門：(1)內嵌一次都沒命中就直接讓建置失敗（避免這段變成恆真的裝飾）；(2)原本的「殘留外部參照」檢查只看 HTML 的 src=／href= 屬性，打包後寫在 JS 字面值裡的相對路徑一律漏掉——那正是它溜過去的原因，補上專找 .pdf/.docx/.xlsx/.csv/.zip 相對路徑的一條。反面測試：把內嵌停掉 → 建置擋下並印出那條死連結。三支用同一道關卡。**(5) 守門與過期守門**：新增 e2e-modal-actions-visible（本支原本就符合，只補守門，沒有為了「三支一致」去動本來就對的東西）、e2e-nav-collapse。另修掉兩條**自己過期**的守門：showQuarter 的相依斷言（v2.1.68 就過期）、側欄要有「計畫管理」（v2.1.68 已改名「建立與管理計畫」）——這兩條讓 v2.1.68、v2.1.69 交出去時測試是紅的。⚠️ 還有一條是守門抓到我自己的錯：我在 window.confirm 的純文字裡寫了 Markdown 粗體記號，畫面上會原樣印出星號，plaintext-markup 守門擋下來了。",
  },
  {
    version: "v2.1.70",
    date: "2026-09-13",
    note: "使用者要求三支同步的「取消／確認／關閉始終可見」，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.64。**(1) 查證結果：本支原本就符合**。`.presence-modal` 是 `grid-template-rows: auto minmax(0,1fr) auto` 的三列格線，只有中間的清單會捲，動作列永遠在最後一列——那個寫法正是 v2.1.5x 為了「footer 被擠出視窗、按鈕點不到」做的。所以本版**沒有為此改任何樣式**：不會為了「三支一致」去動本來就對的東西。**(2) 但補了守門**，因為「現在是對的」不等於「以後也會是對的」：`scripts/e2e-modal-actions-visible.mjs` 造四個三岔留空白路口讓裁決清單長到必須捲（實測可捲 1951px），把清單捲到最上面後量動作列裡**每一顆**按鈕的 `rect.bottom ≦ innerHeight`。⚠️ 它另外釘住兩件產生器管不到的事：(1)三列格線仍在；(2)視窗的子元素**剛好三個**——多一個就會多一列 auto，動作列被擠到第四列而回到舊毛病。反面測試把格線改成 `auto auto auto` → 兩顆按鈕的底緣量到 2582（視窗高 700），三條變紅。**(3) 發布中繼資料補齊**：v2.1.68、v2.1.69 只出過試用版，repo 的 package-lock（停在 2.1.67）、更新說明、CHANGELOG、根目錄網站建置產物都還是 v2.1.67；另外 repo 根目錄留著 v2.1.67 的手冊 PDF，而畫面上的連結指向 v2.1.69——**點下去會 404**。本版一併修正並刪除舊檔。",
  },
  {
    version: "v2.1.67",
    date: "2026-09-12",
    note: "使用者指名要查證的三件事，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.64。**(1) 車種當量與併入／獨立分析有沒有確實重算（使用者：「因為我手上沒有錯誤的檔案可以驗證了」）**：造一份每一格都是固定常數的調查表，讓每一個 PCU 都可以手算，逐項對答案——匯入當下（聯結車獨立分析）左/直/右＝930.8/649.6/816.4 與手算相同；只改當量不按重算時既有數字一個都沒動（刻意的設計，已交出去的數字不該在背後被改）；按下「用目前的設定重算」後直行 649.6→700，剛好等於「4 格 × 聯結車輛數 × 當量差」＝50.4，而左轉右轉完全沒跟著變（排除「三個轉向套同一個當量」）；改成併入特種車再重算後，車種明細裡聯結車消失、特種車輛數＝原特種車＋原聯結車、左/直/右＝914/616/788.4 全等於用特種車當量的手算值，並另外算出「若仍用聯結車自己的當量會是 700」確認程式不等於它（排除巧合）。結論：**確實重算，而且算對**。守門 `e2e-pce-recompute.mjs`。**(2) 路名別名（使用者：「這點我驗證不到」）**：別名功能本來就有、匯入時真的在用，但**畫面上完全看不到**（該頁說明甚至明寫「不在此頁逐筆展開」），所以驗證不到是必然的。已補上「檔名別名清冊」：列出目前計畫記住的每一筆、可逐筆刪除，而且顯示的是**使用者看得懂的名字**而不是內部正規化鍵。⚠️ 同時修掉兩個真的 bug：(1)別名**匯出備份有帶走、還原卻沒有讀回來**（`setIntersectionAliases` 全檔只出現在建立處，兩條還原路徑都沒有），換一台電腦還原後別名全部消失而畫面只說「還原完成」；(2)「全部清除」漏清別名，上一個委託案的對應會殘留到下一個案子。守門 `e2e-alias-visible.mjs`（備份→清空→還原，別名要還在）。**(3) 清除本季資料三支是否同步**：三支都有，但名稱、位置與定稿鎖各不相同（本支「刪除整季」在匯入資料頁，會攔截已鎖定成果）。本支順手修掉：刪季度只刪 records、**不刪對應的還原點**，那些孤兒還原點指向已不存在的紀錄，按下去會還原出使用者以為已刪掉的資料，而且會把真正有用的舊版擠出 30 筆的保留上限。**(4) 趨勢圖數值標籤離縱軸刻度太近**：姊妹專案被使用者回報「有和Y軸重疊的疑慮」，本支結構相同，一併把內縮從 3px 加到 6px，守門改成量「與刻度數字的距離」而不是「與繪圖區邊界的距離」。**(5) 計畫資訊可修改**：見 v2.1.66。",
  },
  {
    version: "v2.1.66",
    date: "2026-09-11",
    note: "使用者實機測試回報的版面與操作問題，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.64。**(1) 側欄跳轉會把標題蓋住**：使用者「點了流量核對工作台下面4個分頁，全部跳轉畫面都是把標題遮住，看不出我已經跳轉到什麼畫面，只有成果審核狀態正確跳轉」。`scrollIntoView({block:\"start\"})` 把目標對到視窗上緣，正好被 position:sticky 的 72px 功能列蓋掉；「成果審核狀態」看起來正常只是因為它是最後一塊、捲到底捲不動。改用 `scroll-margin-top: calc(var(--topbar-h) + 18px)`，功能列高度寫成 CSS 變數避免兩處不同步。**(2) 側欄文字被裁切**：使用者「原始處存格與換算來....後面的文字看不到了」。成因不是寬度不夠——`.nav-section` 的樣式被 `.sidebar nav button`（具體度 0,1,2 對 0,1,0）整組壓過去，實測字級是 16px 而不是設定的 13px、左右內距多 10px，格軌 190px 塞進 180px 容器、側欄橫向溢出 21px。提高選擇器具體度並允許換行；守門在 **100%／125%／150% 三種縮放各量一次**。**(3) 區塊間距不一致**：同一頁有的區塊自己帶 margin、有的沒帶。改由父層 `.audit-stack` 一個 gap 統一決定。**(4) 版本清單貼右緣**：面板的內距是寫在特定子元素上的（`.panel > .panel-head`、`.panel > p`），`.revision-list` 是 div，兩條都套不到。**(5) 轉向圖中央路口隨支線數縮小**：使用者「路口示意圖的各路口不要分這麼開嗎…能保持原中間路段原本的樣子就好，畫布增大只是增加四周空白處」。圖上的幾何本來就沒有跟著畫布放大（支線半徑是固定值），是 `.diagram-canvas svg{width:100%}` 把大 viewBox 等比縮小塞進同寬面板。改為顯示比例跟著畫布走（`--canvas-scale`／`--canvas-scale-h`），四支線時剛好是 1、十字路口顯示尺寸一個像素都沒變。⚠️ 寬與高要分開算：四叉 1200×900、七叉 1620×1080 形狀不同，共用一個比例會讓七叉反而比四叉大 4%。**(6) 計畫資訊可修改（本支原本完全沒有）**：只有 addProject 與 deleteProject，名稱打錯時唯一的辦法是刪掉重建，而刪除會連資料一起消失。補上每一列的「修改」，共用同一張表單。**(7) 備份與還原補上側欄子項目**：三個名稱（備份本計畫／備份全部計畫／還原計畫）各指向一張卡片，卡片抬頭改成與側欄同一個詞。**(8) 數值標籤不可以壓到縱軸刻度**：姊妹專案實機被抓到，本支結構相同但還沒有人點到那張圖，先行修正（最左／最右那一季改對齊方式）。**(9) 點名外框的 CSS 從綁元素改成純 `.is-focused`**：綁元素時新加的區塊掛了 class 也不會有樣式，而類別覆蓋掃描器會過關。**(10) 守門**：新增 `e2e-nav-layout`（跳轉落點、區塊間距、面板內距、側欄三種縮放不裁切）、`e2e-diagram-scale`（量畫面 CSS 像素而非 SVG 座標——SVG 座標本來就一直相同，量它會一路綠燈）、`e2e-project-edit`（最重要的一條是「改名之後每個計畫的路口資料筆數一筆都沒有變」）。",
  },
  {
    version: "v2.1.65",
    date: "2026-09-11",
    note: "使用者實測回饋與一輪全面稽核，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.64。**(1) 字串比對造成的「假分裂」（本輪最重要）**：使用者回報結論草稿的「四、要寫哪些支線」把同一條支線列成兩項，而且勾了其中一個會**靜默漏掉**另一種寫法的資料。他自己去舊版實測後指出真正的成因——不是「自動命名 vs 手動命名」，是自動命名寫的是 `\"路口 \" + code`（「路口」和代碼之間**有一個半形空格**），使用者手打的是「路口A」，`路口 A !== 路口A`。新增 `typedNameKey()`（NFKC → 統一括號破折號 → 去掉所有空白與標點；**不轉小寫**，依使用者判斷「空格看不出來要吸收、大小寫看得出來不吸收」），套用在結論草稿的支線清單與篩選、**歷季趨勢的 `findArm()`**（普查才發現，它只做 trim，會讓另一種寫法的季度全部畫成斷線，而畫面寫的原因是「這一季找不到這一支支線」，把人引導到錯的方向）、報表與結論範本的同名覆寫、匯入預覽補填站號切不出 T 站號時的退路。⚠️ 一度改成用支線代碼分類，被使用者否決且理由正確：代碼是檔案給的位置，名稱才是使用者可以修正的事實（「第一條支線其實是路口D 被挪錯位置」的情境）。**(2) OD 矩陣補上「駛入合計」列**：這張表本來就同時含兩個方向（列合計＝駛出、欄合計＝駛入），只是欄合計沒印出來。刻意**不做**「切換成駛出視角」——轉置之後每一格數字一個都沒變，看的人會以為是另一組資料。守門驗守恆：列合計和＝欄合計和＝右下角總計，且與另一條程式路徑算出來的「各支線流量平衡」駛入欄逐格相同。**(3) 各路口尖峰彙總新增「調查日」欄**：期別顯示切到「調查月份」時寫的是整季合寫（「115年4、5月」），看不出哪一筆是哪個月。這一欄不受期別顯示開關控制、一直都在（做成「切到月份才出現」等於把功能藏起來），年份寫法則跟著開關走。**(4) 守門**：新增 `e2e-class-coverage`（逐頁走過，畫面上每個 class 都要在樣式表裡找得到規則——同一天踩到三次「class 有寫、CSS 沒寫」）、`e2e-od-inbound`、`e2e-branch-code`、**`e2e-point-hover`**（數值標籤「少量直接標、量多滑鼠移上去、匯出淨空」這個功能 v2.1.64 就做了，但**從來沒有任何一支測試真的把滑鼠移上去過**）。`npm test` 加入 `tsc --noEmit`（同一天兩次「識別字打錯 → 整支程式白畫面」，而 lint 與 build 都不看這件事）。新增 `build-pending-index.mjs` 與 `pending-index.test.mjs`：三份待修正事項清單自動產生「逐條清冊」，清冊過期或行號對不上都會紅。**(5) 文字**：禁止「比以前／比原來」這類沒有主詞的比較基準用語；條件摘要不可以印出內部比對鍵。",
  },
  {
    version: "v2.1.64",
    date: "2026-09-10",
    note: "依使用者決定移除「跨計畫比較」整條線，並補上尖峰形狀的兩張圖與一頁彙總表。**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30；改版前後逐頁逐格比對數字，14 頁全部逐字相同。**(1) 移除跨計畫比較**：使用者的評估是「跨計畫比較似乎沒什麼意義」——不同計畫的路口、車道數、調查時間都不一樣，把原始總量並排本來就不可比。移除「跨計畫／多路口比較」分頁與 lib/trend-metrics.ts 的 buildCrossProjectTrend、crossProjectScript。⚠️ 移除過程中差一點連帶刪掉三樣**不是**跨計畫的東西，都已保留：(1)「多計畫管理」是**唯一**能新增與刪除計畫的地方（畫面上每一顆「建立計畫」都指向它），只拿掉頁內的跨計畫趨勢圖，頁面改名為「計畫管理」；(2)Excel 的「跨計畫多路口比較」工作表名字誤導，它的資料來源是 reportExportScope.records＝**目前這個計畫**，改名為「各路口支線尖峰流量」，工作表的 key 維持 `compare` 不動（使用者存下來的匯出範本記的是 key，改了範本會失效）；(3)被刪分頁裡的「歷季各路口尖峰比較」與「各支線駛入／駛出尖峰流量」兩組表格，其他分頁**沒有**同樣的東西（「各路口駛入／駛出流量」一次只看一個路口，那兩張是所有路口並排），另立新分頁「各路口尖峰彙總」保留。新分頁的路口選單以**站號**為鍵，不用 recordIntersectionKey——後者會把同一交流道的南北向站併成一筆，選單會比表格少一列。**(2) 總覽儀表板移除「路口尖峰小時排名」**：排名把不同路口的原始總量排大小，量體不同的路口排在一起沒有判斷意義。彙總表改為**依站號排序**，不再依流量排序。**(3) 轉向進階分析新增兩張尖峰形狀圖**：「尖峰小時內四格 15 分鐘分布」與「連續 60 分鐘流率（依時間）」，都預設收合。兩張圖只讀 sourceTrace.intervals，**不新增任何計算邏輯**；折線圖的橫軸是時間（不是排名），最高的那個窗以橘圈標出，旁邊附判讀說明與「複製說明文字」。資料不是 15 分鐘格距、或沒有逐格資料時，圖會**寫明為什麼不適用**，不畫空圖。**(4) 版本更新歷程不再顯示在畫面上**：使用者的原話是「沒有人會關注這個」。VERSION_HISTORY 陣列**保留**（發布流程與測試都要讀），只是不再渲染成畫面上的區塊。**(5) 手冊整份重寫**：22 章，寫給完全沒有交通概念的人，不寫版本沿革。依使用者決定**只提供 PDF**，取消 Word 版與 build-docx.mjs。**(6) 守門**：新增 scripts/e2e-removed-surfaces.mjs，用**另開的乾淨瀏覽器工作階段**與含逐格資料的測資驗證移除項確實不在、保留項確實還在、新分頁與兩張圖真的畫得出來。⚠️ 過程中抓到三個**假通過**的守門並修掉：(1)在伺服器端渲染的 HTML 上斷言「找不到版本更新歷程」——舊版也會通過，因為伺服器只渲染預設分頁；(2)`assert.match(html, /計畫管理/)` 在「多計畫管理」上一樣通過（子字串），補上 doesNotMatch；(3)圖表檢查用的測資沒有逐格資料，兩張圖都顯示「不適用」而斷言照樣全綠，改為先斷言前提成立。另外，收合的 <details> 在 Chrome 是用 content-visibility 隱藏，getBoundingClientRect 仍回報有高度，改用 checkVisibility({contentVisibilityAuto:true}) 才驗得準。",
  },
  {
    version: "v2.1.63",
    date: "2026-09-10",
    note: "GPT 依風險導向規則獨立複查 v2.1.62 後修正趨勢圖、可編輯 Excel 與儲存完成語意。單一路口歷季趨勢的畫面、右側摘要與 Excel 原生圖表現在都使用所選指標的同一數值與單位；車種數量顯示輛/hr、車種占比顯示 %，不再沿用 PCU/hr。IndexedDB 存檔改為等交易真正完成才回報成功，瀏覽器封鎖儲存時不再誤稱本機沒有資料。長期間趨勢圖設 4,800px 安全上限並依寬度抽樣數值標籤，保留完整折線與資料點；跨計畫全部資料別改為各資料別分線。另修正 README 尖峰搜尋時段與手冊 HTML 標題。沒有變更交通量、PCU、尖峰挑選或流向判定，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。",
  },
  {
    version: "v2.1.62",
    date: "2026-09-10",
    note: "側欄分成五個功能區、圖旁補上說明、修掉四項 GPT 複查指出的問題（其中「儲存競態」是**真的會掉資料**的一項）。**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。**(1) 側欄分區**：17 個項目平鋪、順序照當初做出來的先後排，改成五區（開始／一 資料匯入／二 參數設定／三 資料檢視／四 圖表與比較／五 產出與維護），每一區有小標與代表色；三支系統用同一套分區名稱與順序。只重排與換小標，**View 的 id 一個都沒改**。兩處順序調整：多計畫管理移到「圖表與比較」最後（它是跨計畫比較的前置，不是每天第一件事）、資料品質檢查移到「資料匯入」區（匯完就檢查是同一個動作的兩半）。**(2) 圖旁的說明**：講稿原本排在圖的下方且整頁寬，寬螢幕（≧1400px）時改成接在右欄（＝圖的旁邊），窄螢幕回到圖下方。斷點取 1400 而不是 1080——講稿佔掉 320px 之後，1280～1366 的筆電上 8 季的圖就開始需要橫向捲動。**(3) 單位（GPT 指出）**：`metricUnit()` 自己又寫了一套判斷而且只寫對一半——PCU 有分 FULL／尖峰，車輛數卻不分，一律回「輛」，所以三個尖峰的車輛數（**一小時內**的量）被標成「輛」。改為一律轉給 lib/traffic.ts 的 `scopeUnit()`，全系統只有那一支說了算。新增 2 項守門逐一比對每個指標 × 每個統計範圍，退回舊寫法實測紅字。**(4) 缺季的可編輯 Excel（GPT 指出沒有守門，實測是壞的）**：畫面上的 X 軸已經排滿起訖之間的每一季，匯出的 Excel 卻只列「有資料的那幾季」，Excel 裡那張折線圖照樣把缺季壓掉——**交出去的是 Excel，不是畫面**。改為依 `axisQuarters` 產生，補出來的季整列留空（Excel 遇到空白儲存格會斷線），並新增「備註：這一季沒有調查資料」欄放在最後（不可以插在中間，折線圖是用欄位字母指定數列的）。缺季之後那一季的「較前季（%）」改為留空——前一季根本沒有資料可比，舊版會寫 0（會被讀成「持平」）。**(5) 跨計畫趨勢的資料別拆線（GPT 指出沒有守門）**：新增 scripts/e2e-cross-trend.mjs，驗「全部（分開顯示）」時線數＝計畫數×日別數、線名帶日別、**而且平日那條線的值與單獨選平日時完全相同**。⚠️ 這一段第一次是用線尾標籤的 y 當值，而那些標籤為了不重疊會被排開，四條線與兩條線排開的幅度不同，量出一個假紅字；改讀講稿裡的數字（與圖同源）。**(6) 對比**：站號、單位、副標等淡灰字實測只有 2.67～3.27:1（AA 需 4.5:1），加深到 5.19:1；計畫代碼在淺綠底上 4.49:1，改用同色系深一階（5.63:1），品牌色本身不動。**(7) 大量季度**：版面守門的測資從 24 季提高到 44 季（GPT 把大量季度列為風險）。**(8) 連續存檔會把新資料蓋回舊資料（GPT 指出「儲存競態」，查證屬實，會掉資料）**：saveState() 每次呼叫都自己 indexedDB.open() 一次，而 open 是非同步的，兩次寫入誰先開好**沒有保證**。連續改兩次時，第一次（舊資料）若比第二次（新資料）晚開好，它的 put 就會**後**落地，資料庫裡最後留下舊資料；重新整理之後使用者剛改的東西不見了，**沒有任何錯誤訊息**。⚠️ traffic-app.tsx 的 saveTokenRef 擋不住這一種——那個序號只決定「哪一次的結果可以更新畫面與 toast」，不會取消已經送出去的 IndexedDB 寫入，是「看起來有防護、其實沒防到」的典型。修法：lib/state-storage.ts 內把**所有寫入**（含 localStorage→IndexedDB 的搬遷寫入與「全部清除」）排成一條鏈，前一次寫完才開始下一次，順序由呼叫順序決定，與 open 的回應時間無關。刻意**不做**「跳過被取代的那一次」：那樣先呼叫的會拿到「成功」卻其實沒寫，而如果最後一次因配額失敗就變成兩次都沒進去。新增 tests/state-storage-race.test.ts（2 項），用假的儲存層讓 open 的回應順序完全顛倒（第一次等 40ms、第二次 20ms、第三次 0ms）。紅字：把排隊拿掉還原成直接寫入 → × 2 項（'第一次（舊）' !== '第三次（新）'；清除與存檔交錯時最後留下的是被清掉前的值）。",
  },
  {
    version: "v2.1.61",
    date: "2026-09-09",
    note: "修正單一路口歷季趨勢圖**資料點畫的位置與縱軸說的不一致**，並把縱軸刻度改成好讀的整數。**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。**症狀（這一項是使用者問出來的）**：資料點的縱向對應寫的是 `310 - (值 / max) * 235`，格線卻畫在 y=70／130／190／250／310（跨距 **240**）。兩個對應關係差 5px，於是整片資料點被往下壓：值等於軸頂的點畫在 y=75，而標著那個值的格線在 y=70。誤差隨值線性放大，**照著縱軸讀一個高點會少讀約 2%**——在 6,000 PCU 的軸上就是 120 PCU。圖畫得出來、線也很漂亮，沒有任何錯誤訊息，這是圖表最惡質的一種錯。實測還原後守門顯示最大誤差 **99.9 PCU**。**修法**：點的縱向對應改用與格線相同的 240。⚠️ 跨計畫趨勢圖沒有這個問題，它的 py 與格線本來就都用 `(bottom - top)`。**第二項**：縱軸軸頂原本是「資料最大值 ×1.12」直接四等分，刻度變成 5,371.3／4,028.5／2,685.6／1,342.8／0 這種一排亂數。新增 `niceAxisMax()`：**先決定每一格的高度再回推軸頂**（先定軸頂再均分的話，軸頂雖然是整數，每一格仍可能是 1,750 這種數字）。每一格只允許 1／1.5／2／2.5／3／4／5／6／8／10 的 10 的次方倍，往上吸附，所以軸頂一定 ≧ 資料最大值且最多只高一階。同一個例子會變成 6,000／4,500／3,000／1,500／0。單一路口圖與跨計畫圖都改，三支系統刻意用同一套規則。守門：scripts/e2e-chart-layout.mjs 新增 6 項，其中一項是**從 SVG 直接量**——取最上與最下兩條格線建立「像素雙向值」的對應，再把每個點的 cy 反推回值，與點旁邊標的數字比對（標籤與點自 v2.1.58 起同源，所以標籤＝真值）。⚠️ 迴避的假通過陷阱：只驗「最下面那條格線＝0 的點畫在那裡」會恆真，兩種算法在 0 的地方本來就重合，誤差是從 0 往上長的；所以另外釘住「測資要有一個夠高的點」。**第三項**：縱軸名稱原本用 `writing-mode: vertical-rl`（真正的直排），而直排要靠字型裡的**直排前進量**才知道下一個字往下多少。字型沒有那組度量時（無頭瀏覽器、部分 Linux／Android、匯出 PNG 時載入的替代字型），中文字的前進量會變成 0.4px——實測「路口總量（」五個字全部疊在 1.6px 裡糊成一團，只有 PCU/hr 排得開。改成「橫排的字整段轉 90 度」，只用得到每一種字型都有的橫排度量；姊妹專案本來就是這樣做的，這一支是唯一的例外。⚠️ 原本的守門沒抓到，因為版面檢查只比對**不同** text 之間有沒有重疊，而 getBBox 回的是整段外框——一個框不會跟自己重疊。本版新增逐字檢查（getExtentOfChar，相鄰兩字必須真的前進，門檻取字級四分之一），畫面與「模擬匯出」兩條路徑各驗一次。紅字：點的對應退回 235 → × 最大誤差 99.9（容差 30.0）；刻度退回舊算法 → × 刻度印成 5,371.3／4,028.5／2,685.6／1,342.8／0；縱軸名稱退回 vertical-rl → × 2 項，訊息是「『路口總量（PCU/hr）』的『路口』只前進 0.4px」。",
  },
  {
    version: "v2.1.60",
    date: "2026-09-09",
    note: "歷季趨勢圖的橫軸改為排滿「起訖之間的每一季」，整季沒有調查的季度留空並讓折線斷開。**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。**症狀**：舊版橫軸只排「有資料的那幾季」。某個路口若只做了 113Q1 與 114Q1，圖上就只有兩格、兩個點緊鄰——看圖的人（業主）會讀成「上一季到這一季」的變化，實際上中間隔了整整一年。這張圖會被下載成 PNG 貼進簡報，讀錯就跟著交出去。**修法**：新增 `completeQuarterRange()`（lib/trend-metrics.ts），單一計畫趨勢圖與跨計畫趨勢圖的橫軸都改由它產生。補出來的季度在紀錄裡查不到，值一律 null，折線在那裡斷開——斷線代表「這幾季沒調查」，不是「這幾季是 0」，與既有的「算不出來」走同一條路徑。補出來的空季 N＝0，不會被算成「路口數最少的一季」而蓋掉其他季度真正的小樣本警告。**保守處理**：期別不是 `<年>Q<1-4>`（例如自訂期別名稱）、或民國三碼與西元四碼混用、或跨距超過 100 年時，一律原樣不補——補出來的格子必須挑一種寫法，挑錯會讓 X 軸同時出現「113Q2」與「2024Q3」兩種格式。守門：tests/trend-metrics.test.ts 新增 3 項，scripts/e2e-chart-layout.mjs 新增 5 項（以只有 113Q1 與 114Q1 的測資，驗 X 軸出現補出來的 113Q3、標籤數為 5、兩點相距四格、折線斷成兩段）。把補齊還原、**重新建置**、跑同一支腳本，實測單元測試 3 項紅字、E2E 3 項紅字。",
  },
  {
    version: "v2.1.59",
    date: "2026-09-09",
    note: "修正 v2.1.58 新增的跨計畫歷季趨勢圖把不同資料別混在一起的問題，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。**症狀**：v2.1.58 的跨計畫圖完全沒有過濾資料別，而同一個路口同一季通常有平日與假日兩筆。後果有兩個，第二個更嚴重：一、平日與假日被平均在一起，得到一個**不對應任何一天**的數字——使用者的原話是「把平日和假日的車輛數加總起來，是沒有意義的圖表」，平均在一起同理；二、**N（路口數）會變成筆數**，12 個路口被算成 24 筆，每路口平均整個錯掉，而畫面上還理直氣壯地標著「N=24」。**修法**：跨計畫圖新增「資料別」選單，預設單一種；另有「全部（分開顯示）」會把一個計畫拆成平日一條、假日一條——**同時顯示，不是加總**。並在 buildCrossProjectTrend 內以路口鍵去重當最後一道防線（同一路口同一季取最後匯入的那一筆），就算呼叫端忘了過濾也不會把筆數當成路口數。畫面上直接寫明「平日與假日不會被加總」。⚠️ **單一計畫的趨勢圖從來沒有這個問題**：它的資料別是單選，統計範圍選「整體」時是畫 AM／PM／全日尖峰三條線，不是加總——這一版沒有動它。守門：tests/trend-metrics.test.ts 新增 2 項（「同一路口同一季有兩筆時只能算一筆，N 是路口數不是筆數」與「兩個不同路口才算兩筆」），把去重拿掉之後實測 **4 項紅字**，包含原有的「每路口平均」與「加權平均」兩項也一起紅——那正說明去重壞掉時平均值會跟著錯。",
  },
  {
    version: "v2.1.58",
    date: "2026-09-09",
    note: "歷季趨勢圖大幅擴充，並修掉匯出圖片的版面問題。**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。**(1) 趨勢圖新增可選指標。** 舊版只畫得出「路口總量（PCU）」一種；本版新增實際車輛數、單一車種車輛數、單一車種佔比、單一支線量、單一轉向量，共六個指標，預設仍是路口總量（＝與舊版完全相同的那一條線）。所有指標一律走新的 lib/trend-metrics.ts 的 buildMetricSeries()，**圖、右側摘要、講稿、PNG、Excel 全部只讀同一份 series**——舊版曾經發生過「點畫在駛入的高度、旁邊標的卻是駛出的數字」（點座標用 totalOf、標籤用 recordTotal），收斂成一份之後那一類錯誤在結構上不可能再發生。每一個指標的值都是呼叫既有、已被測試釘住的函式取得的（recordTotal／totalMovement／movements[scope].vehicle），**沒有新增任何交通量算法**。算不出來一律回 null 畫成斷線，**絕不用 0 代替**——除了原本的「不足 24 小時算不出全日尖峰」，新增兩種：所選支線這一季不存在（改過名稱或路口幾何不同）、車種佔比沒有分母。**(2) 圖旁新增簡報講稿欄位。** 四段固定格式（這張圖在說什麼／重點變化／怎麼看這張圖／要先講清楚的），只讀上面那一份 series，不回頭重算。中文寫法依使用者要求不用「個百分點」，一律先講兩端再講變化量與倍數。第四段會主動講出算不出來的季度與原因、樣本太少、駛出駛入對不起來、站號歷年變動、資料別是「待設定」。**(3) 多計畫管理新增跨計畫歷季趨勢圖。** 一個計畫一條線；**一律比每路口平均，不比總量**——各計畫路口數本來就不同，比總量只會證明「路口多的計畫比較大」。佔比類指標用加權平均（分子分母各自加總再相除），不是把各路口的百分比再平均一次。線尾標出該季實際算得出來的路口數 N，明細表預設收合並可搜尋。**(4) 修掉匯出圖片的版面問題（重點）。** 匯出走 svgToPng，它把 SVG 序列化成獨立文件再畫進 canvas，**讀不到 globals.css**；而這個系統的圖表文字大小與對齊（font-size、text-anchor）全部寫在樣式表裡，所以下載下來的圖字級從 9～10px 變成 16px、`text-anchor` 從 middle／end 退回 start，**每一段字整個往右移半個字寬**，縱軸刻度從右對齊變成壓進繪圖區，整片重疊。畫面上完全正常，只有交出去的那一張壞掉。本版把樣式內嵌進每一張 SVG（CHART_SVG_STYLE），畫面與匯出讀同一份。同時：縱軸名稱改為跟著指標走並一律帶單位（舊版寫死「尖峰小時交通量（PCU/hr）」，換成車種或佔比之後就是錯的）、新增橫軸名稱「季度」、刻度不再每一格重複單位、X 軸標籤依實際字寬計算間隔。另修掉一個實測到的重疊：24 季時點上的數字每個都重複「PCU/hr」，標籤寬到 85px，相鄰兩個直接相交（「5,371.3」與「4,795.8 PCU/hr」）——單位既然已經在軸上，點上就不再重複。**(5) 匯出改成「圖歸圖、字歸字」。** 依使用者要求：PNG 只有圖，說明文字不印在圖上（那是簡報者要口述的）；可編輯 Excel 新增「圖表說明」工作表放講稿，資料欄名與數值跟著所選指標走。守門：新增 tests/trend-metrics.test.ts（20 項，五種變異各自實測紅字）、scripts/e2e-chart-layout.mjs（22 項，量文字外框並**把樣式抽掉再量一次**模擬匯出處境，四種還原各自實測紅字）。紅字都是把修正還原、**重新建置**、跑同一支腳本實測出來的，不是推論。",
  },
  {
    version: "v2.1.57",
    date: "2026-09-08",
    note: "兩項修正，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。**(1) 用「支線數」做算術核對，並把超出預期的橫線從安靜移除改成跳出來問。** 起因是使用者問「三岔的原始檔只有路口A、B、C，這對判讀有沒有幫助」。查核結果：支線代碼本來就有在讀（sourceCode() 讀表頭的「路口編號：」），支線數也一直在用（movementTargetIndex 的角度換算、轉向圖等角配置）；但先前**沒有拿它做過任何核對**。本版新增 auditArmMovements()：一支支線只能去（支線數 - 1）個地方，調查表卻固定印同樣幾個轉向欄，兩者的差就是「應該有幾個轉向不存在」——三岔 3-2＝每支剛好 1 個、四岔 3-3＝0 個。這是純算術，不依賴任何調查廠商的編號習慣。實測 37 份實檔完全符合：三份三岔檔（岡山北路－育才路口、左楠路－世運大道、高楠路－1003 巷）每支剛好 1 個純橫線，五份四岔檔一個都沒有。**用途一：數量對不上就示警**（該畫橫線的欄位被留成空白、或表頭欄位被讀錯），以前這種檔案會安靜通過。**用途二（重點）：四岔以上出現純橫線不再安靜刪掉。** 實測 movementTargetIndex 對 4～7 岔是一對一、不會兩個轉向撞到同一支（幽靈重複列是三岔獨有的），所以四岔會畫橫線通常代表**禁止轉向或單行道**，是真實的路口管制資訊。v2.1.56 的過濾一視同仁、而且是一個沒有任何提示的 .filter()，碰到這種檔案會**安靜少掉一條流向**。本版改成列進裁決視窗，**預設選項仍是「移除」＝與 v2.1.56 結果完全相同**（e2e 實測兩版都是 11 條、總量都是 680／680），改變的只是這件事看不看得見、改不改得回來、答案記不記得住。三岔那些照預期畫的橫線**維持安靜移除**，不會每季跳出來煩使用者。**用途三：整欄空白時給出有依據的建議。** 橫線畫得比預期少 N 個、而剛好有 N 個轉向整欄空白時，就指認那幾個並預設「沒有這個轉向」，視窗上直接寫出算術依據；數量對不上就不給建議（寧可讓使用者自己決定，也不要把猜的裝成有依據）。**(2) 修正「全部先保留（不記住）」的殘留標記。** 這顆按鈕只清掉視窗，**沒有清掉流向上的 presence: \"unknown\"**，那個標記會一路存進資料與備份；而組題目的那段是掃**全部紀錄**找 unknown、不是只掃這次匯入的，所以按過一次之後，之後匯入**任何一個無關的路口**都會把舊的未答項目再抓出來問一次——正是使用者抱怨過的「每次匯入都跳」那類毛病。瀏覽器實測重現：殘留 3 條、第二輪匯入無關路口時視窗又跳出來。清掉標記不影響「該問的還是要問」：重新匯入同一個路口時會依調查表欄位重新判定再問（第三輪實測有跳）。**(3) 另修裁決視窗的版面。** .presence-modal 只寫了 max-height: 86vh 卻沒指定列高，格線三列各自照內容撐開，內容一長就把 footer 擠出視窗外、「套用並記住」點不到（本版說明變長後實測撞到，Playwright 重試 60 次後逾時）；改為 grid-template-rows: auto minmax(0, 1fr) auto。守門：新增 tests/arm-arithmetic.test.ts（7 項，含「四岔真的量到 0 不可以被算成缺口」與「數量對不上時不可以給建議」兩個反例）；scripts/e2e-three-arm.mjs 增為 36 項、新增第五份對照檔「四岔＋禁止左轉」，對 v2.1.56 有 **7 項紅字**；新增 scripts/e2e-presence-keep.mjs（13 項，三輪匯入），對 v2.1.56 有 **2 項紅字**。紅字都是把 v2.1.56 的原始碼放回去、**重新建置**、跑同一支腳本實測出來的，不是推論。",
  },
  {
    version: "v2.1.56",
    date: "2026-09-07",
    note: "新增「這個轉向到底存不存在」的裁決視窗，**沒有變更任何交通量或 PCU 計算**。起因：調查表用 0 表示「有這個轉向、只是整天量到 0」，用橫線表示「根本沒有這個轉向」；v2.1.55 已能分辨這兩種，但**兩種都沒寫、整欄空白**時仍然分不出來，當時只在匯入提醒裡寫一行。使用者指出「寫成提醒可能不會被注意到」，而這個答案會直接改變流向清單、路口轉向圖與各項成果，所以本版改成跳視窗逐條詢問。**觸發條件很窄**：只有「既沒有填數值、也沒有寫橫線」的轉向才會列進來；寫了數字（含 0）或寫了橫線的都不問。實測 73 份轉向版型的調查檔裡，有數字 4,488 欄、純橫線 224 欄、整欄空白只有 12 欄（集中在 1 份檔），所以絕大多數匯入根本不會看到這個視窗。**預設一律是「有這個轉向」（保留）**——直接關掉視窗等於保留，因為保留最多是畫面上多一列 0，刪掉卻可能弄丟真實流向。選「沒有這個轉向」時被移除的流向整份調查都是 0，**任何加總都不受影響**。**答案會記住**：存進新的 movementPresence（鍵值是路口名稱正規化鍵＋支線代號＋轉向，不含站號與季度），跟著計畫存、跟著備份走，下一季匯入同一個路口直接套用、不再問第二次——這正是使用者對另一支系統抱怨過的毛病，所以特別避開。另提供「全部先保留（不記住）」，這次先保留但不記下答案，下次還會問。RouteFlow 新增選填欄位 presence: \"unknown\"，只在待裁決期間存在，使用者回答後就清掉或整條移除。守門：scripts/e2e-three-arm.mjs 增為 26 項，改成四份匿名對照檔一次批次匯入（三岔寫橫線、四岔含真的 0、三岔含真的 0、三岔留空白），實測驗到視窗只列空白那 3 條、裁決前一律保留 9 條並標記 unknown、選「沒有」後變 6 條且總量不變、答案存進 movementPresence、**再匯入同一批檔案不會再跳視窗且直接套用（6 條）**。對 v2.1.55 有 5 項紅字。tests/backup-completeness.test.mjs 的必帶清單也加上 movementPresence，避免日後有人忘了把它收進備份而讓換電腦之後每季重問。",
  },
  {
    version: "v2.1.55",
    date: "2026-09-07",
    note: "v2.1.54 的欄位記帳有一個我自己的錯，本版修正，並補上「分不出來」時的提醒。**沒有變更任何交通量或 PCU 計算。** **(1) 空白格不可以算成「量到 0」。** v2.1.54 新增的 numericCells 記帳把**空白格也算成數字**——把空字串丟給 Number() 會得到 0，而 0 是有限數，所以 usable 對空白格也是 true。後果是「整欄空白」被記成「整欄量到 0」，於是「調查表沒填」與「調查表填了 0」分不出來。這個錯讓我第一次的量測完全失真：掃過 201 份檔說「一欄空白都沒有」，其實不是沒有，是全被算成數字了。修正後重新量：73 份轉向版型的預覽裡，欄位分為有數字 4,488、純橫線 224、**整欄空白 12**（集中在 1 份檔的一個整塊空白區塊）。對真實檔的判斷結果**完全沒有改變**（八筆真實紀錄複驗：三岔 6 條、四岔 12 條、無重複起訖、路線合計＝支線合計），因為真實檔沒有「同一欄既有橫線又有空白」的情形；但記帳本身現在才是誠實的。 **(2) 「整欄空白」會在匯入提醒裡講出來。** 調查表用 0 表示「這個轉向存在但整天量到 0」、用橫線表示「根本沒有這個轉向」；如果一欄**既沒有填數值、也沒有寫橫線**，那就是沒填，系統無從判斷。這時候**一律保留**（當成「有這個轉向、量到 0」），因為保留最多是畫面上多一列 0，刪掉卻可能弄丟真實流向；但保留是預設值不是判斷，所以會在匯入辨識結果的提醒裡寫出是哪幾支支線的哪個轉向，並告訴使用者若確定沒有該轉向可到「道路與流向管理」刪除。守門：scripts/e2e-three-arm.mjs 增為 17 項，新增第四份對照檔「三岔留空白」，驗「分不出來時一律保留」（9 條而不是 6 條）與總量一致。另修 tests/silent-failure-guards.test.ts 一處字串比對——它用「不是數字」找警告，新提醒原本也含這四個字而被誤抓（測試紅、程式對），已改成比對完整片語「個儲存格有內容但不是數字」，順便把那個比對變嚴謹。",
  },
  {
    version: "v2.1.54",
    date: "2026-09-07",
    note: "兩項修正，**沒有變更任何交通量或 PCU 計算**。**(1) 三岔路口的空流向改用「調查表原本寫什麼」判斷，不再靠「全為 0 而且起訖重複」推論。** v2.1.53 的做法是間接推論，實測會誤刪：三岔路口若有一個**真的存在、但整天量到 0** 的轉向，而它剛好與一條有流量的轉向解到同一支目的支線，v2.1.53 會把它一起刪掉（實測 7 條變 6 條；總量不受影響，但畫面上少一列真實流向）。真實檔裡這種形狀確實存在——左楠路－世運大道假日那一份就同時有 12 欄純橫線與 1 欄真的量到 0。本版改為：inspectWorkbook 逐欄記下 numericCells／placeholderCells（這一欄出現過幾格數字、幾格橫線佔位符），**數值本身完全不動**（`--` 一樣算 0），只用來讓下游分得出「沒有這個轉向」與「整天量到 0」；只有「一格數字都沒有、而且出現過橫線」的欄位所對應的流向才會被拿掉。實測：三份真實三岔檔各有剛好 12 欄純橫線、0 欄誤判；四岔與七岔檔 0 欄純橫線，卻各有 6～9 欄是真的整天量到 0（後昌路－宏毅二路假日 9 欄、七叉路口A 9 欄、台1－路科一路口 8 欄），全部保留。八筆真實紀錄複驗：三岔 6 條、四岔 12 條、無重複起訖、路線合計＝支線合計。**(2) 移除「季度批次匯入」頁的「調查檔格式範本」面板**（三張範本卡片與其下的「已記住的實際調查版型」折疊區）。使用者的原話：程式自己記得版型就好，使用者不需要知道記憶了哪些；也不必為了說明「沒有左直右的檔案會讀但不建立轉向成果」而用三張卡片佔版面。那個面板本來就有誤導：formatMemories 是**只寫不讀**的，沒有任何一處拿它去影響解析（版型由工作表內容當場推定），所以「刪除格式記憶」那顆按鈕會讓人以為按了能改變辨識結果，實際上不會。**formatMemories 的資料本身刻意保留**（照樣累積、照樣進備份），備份格式完全不變，舊備份還原不受影響。相關 CSS 一併移除；三張卡片裡唯一有用的那句改寫進手冊第 6 章。守門：scripts/e2e-three-arm.mjs 增為 15 項，新增第三份對照檔「三岔＋真實零流量」，對 v2.1.53 有 2 項紅字；tests/v170-features.test.mjs 新增面板移除檢查（比對 JSX 樣式而非字串，避免被自己的說明絆倒），對 v2.1.53 有 4 項紅字。",
  },
  {
    version: "v2.1.53",
    date: "2026-09-07",
    note: "三項修正，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30，固定計算黃金值不變。**(1) 三岔路口不再列出重複而且一輛都沒有的流向。** 三岔路口的調查表每一支支線一定有一欄整欄寫 `--`（A 沒有右轉、B 沒有直進、C 沒有左轉），欄位卻照樣排出來；而三岔只有兩個去向，三個轉向硬要對到兩支目的支線，movementTargetIndex 必然讓兩個轉向解到同一支，結果 9 條流向裡有 3 條「from→to 與別人重複、整份調查一輛都沒有」的空列，畫面上看起來像同一個路口被列了兩次。以三份真實三岔檔實測：一律 9 條、3 條四個時段全零、3 組重複，而且每一組重複裡剛好一條全零、一條有流量；四岔一律 12 條、0 重複。本版在建立流向後把「整份調查為零、且同一個 from→to 另有一條真的有流量」的流向濾掉，三岔 9→6 條、四岔完全不變。被濾掉的流向整份調查都是 0，**任何加總都不受影響**（實測路線合計＝支線合計，差 0）。註：解析階段已經把 `--` 直接當成 0，程式目前分不出「沒有這個轉向」與「整天量到 0」，所以刻意不改解析層，而是加上「另有一條同 from→to 有流量」這個條件——四岔路口真的整天量到 0 的轉向因此不會被誤刪。**(2) 本機資料從 localStorage 搬到 IndexedDB。** localStorage 每個網站硬上限實測 4.94 MB，而路口轉向是三支裡唯一把全部資料都放在那裡的；單一路口快照平均 14.2 KB、最大 38.7 KB，一季就可能用完，使用者實際回報「儲存空間快滿、還原點只保留 20 筆」。新增 lib/state-storage.ts，第一次啟動時把 localStorage 的舊資料搬進 IndexedDB，**寫入後一定重新讀回來逐字比對相同才刪掉舊的**，比對不過就原封不動留著下次再搬。依使用者定案**不做雙寫**（兩邊都寫會有「哪一份才是最新」的問題）。存檔改成非同步，因此加上「後發先至」的序號保護與寫入未完成時的離開確認。儲存空間被封鎖時的搶救畫面維持 v2.1.52 的行為，搶救畫面的下載改為只讀不搬遷。**(3) 還原點改成一次操作一個。** 舊版每一筆紀錄各建一個還原點，一次批次覆蓋 65 個路口就長出 65 個看不出差別的項目，而且淘汰用逐筆 slice(0, 300)，會把同一次操作攔腰切斷、還原回去只還原一半。本版同一次操作共用一個 batchId，上限改為最近 30 次操作加 20 MB 總量，整批進出；畫面加上每個還原點的「刪除這個還原點」與「刪除還原點不會影響現有資料」的說明，**不做獨立的「清除還原點」按鈕**。舊備份與舊資料沒有 batchId，會被當成一筆一批，照樣顯示、照樣還原得回去。**(4) 結論草稿的「小數位數」現在真的管得到百分比。** 使用者在全日交通量實測回報，三支系統寫法相同、毛病也相同：pct() 的位數參數有預設值 1，而所有呼叫端都沒有傳，於是把小數位數改成 2 位時百分比完全不動。本支受影響四處：佔駛入、佔駛出、支線車種組成、路口車種組成，另加跨季度變動幅度的增減百分比（原本寫死 toFixed(1)）。本版把設定帶進全部五處，並拿掉 pct() 的預設值（日後漏傳是編譯錯誤，不會再無聲失效）。車輛數維持整數。**沒有變更任何計算**。新增四支守門：scripts/e2e-three-arm.mjs（11 項，對未修正的 v2.1.52 有 3 項紅字）、scripts/e2e-storage-idb.mjs（18 項，7 項紅字）、scripts/e2e-revision-batch.mjs（15 項，9 項紅字）、tests/conclusion-digits.test.ts（2 項，2 項紅字）。",
  },
  {
    version: "v2.1.52",
    date: "2026-09-06",
    note: "修正「瀏覽器不允許本站使用本機儲存空間」時整頁空白的問題，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30，固定計算黃金值不變。症狀：瀏覽器設定成「封鎖所有 Cookie／網站資料」時，連讀取 `window.localStorage` 這個屬性本身都會丟 SecurityError；而讀取那兩行原本寫在 try 之外，例外直接冒到 React、整棵元件樹卸載——**畫面完全空白、沒有任何訊息、也沒有搶救指引**，使用者只會覺得「這個網站壞了」。實測（把 localStorage 改成存取即拋錯）畫面 0 個字、主控台一則未捕捉例外。三支系統同情境對照：全日交通量會出 toast「IndexedDB 已被停用」且不假裝存檔成功、交通服務水準顯示搶救畫面、只有本支整頁空白。本版把讀取包進 try，並把「儲存空間用不了」與「資料格式壞掉」分成兩種畫面——前者原本那句「您的原始資料仍然完整保留在瀏覽器裡」並不成立（根本沒有資料），改為明講原因、列出三種常見設定（封鎖 Cookie／無痕模式／擴充套件）與處理方式、給一顆「調整設定後，重新載入」，並提醒此時不要匯入（畫面看起來會成功，關掉分頁就全部消失）；搶救畫面的下載鈕也補上 try，權限中途改變時改為明確提示而不是再拋一次例外。新增 scripts/e2e-storage-blocked.mjs（9 項），實測對未修正的 v2.1.51 有 5 項紅字，並同時驗「儲存空間正常時不可以誤跳這個畫面」，避免寫成無條件顯示也會通過。",
  },
  {
    version: "v2.1.51",
    date: "2026-09-05",
    note: "全面徹查後的四項修正與發布前獨立補正，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30，固定計算黃金值不變。**(1) 全日時段單位修正。** 批次成果包 README、轉向進階核對 Excel 的支線流量平衡及畫面上的守恆差值改為跟著 scopeUnit(peak)；固定 60 分鐘候選排行明確標示 PCU/hr。**(2) 混用時間格只加警告，不改挑選邏輯。** 警告只在兩種以上格距各佔兩成以上且各自至少重複兩次時出現，避免短時段只漏一列造成單次跳號誤報。**(3) 補上 paint() 的守門測試。** 以匯入期間 requestAnimationFrame 呼叫次數確認第一份解析前確實重畫。**(4) 重新匯入測試改為真實滑鼠點擊。** 在按鈕確實停用期間檢查檔案對話框不會被再次叫出。上述修改只涉及顯示、警告與測試，不改尖峰挑選、OD、車種當量或流量計算。",
  },
  {
    version: "v2.1.50",
    date: "2026-09-05",
    note: "補上「按下選擇檔案之後、檔案還在讀」這段空窗期的提示，並確保第一份檔案開始解析前畫面一定先重畫一次，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30，固定計算黃金值完全相同。使用者回報兩件事：一是按下「選擇檔案」、在系統對話框選了大量檔案之後，畫面看起來完全沒反應（對話框關閉到程式收到 change 之間是瀏覽器在讀檔，程式插不進去），二是匯入開始後要等到全部讀完才看得到進度。本版在按下按鈕當下就顯示「正在讀取您選擇的檔案，請稍候…」，選好檔或按取消都會自己收掉（取消沒有 change 事件，靠視窗重新取得焦點當退路）；另外在第一份檔案開始解析前先等一次真正的重畫（連續兩個 requestAnimationFrame），讓進度列在第一份就看得到，並附 250ms 時間退路，避免分頁在背景時 requestAnimationFrame 不觸發而永遠卡住。三項修正都以「拿掉修正」的版本實測守門測試會紅字。",
  },
  {
    version: "v2.1.49",
    date: "2026-09-05",
    note: "修正全域拖放防呆會連一般文字拖曳都擋掉的問題，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30，固定計算黃金值完全相同。v2.1.47 加入的「檔案掉在放置區外面不要把使用者帶離頁面」少了一層判斷：沒有先確認拖進來的是不是檔案，於是使用者在頁面內拖動選取文字（例如把一段字拖到輸入框）也一起被擋住。實測輸入框、側邊選單與內容區三處都中。改成只有 `dataTransfer.types` 含 `Files` 時才攔截，文字拖曳完全不受影響——全日交通量 v20.47 本來就是這樣寫的，本版與它對齊。另外把 `scripts/e2e-progress.mjs` 的畫面取樣由固定 10ms 輪詢改成 MutationObserver 全量記錄：短命的畫面狀態用輪詢會漏掉，改法讓守門測試看得到每一次變動。",
  },
  {
    version: "v2.1.48",
    date: "2026-09-05",
    note: "獨立複查 v2.1.47 後修正大量檔案判讀的進度顯示，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30，固定計算黃金值完全相同。每份檔案讀完、切換下一份的短暫畫面原本可能把下一個序號配到上一個檔名，最後一份也可能短暫顯示超過總份數；現在序號、總份數與檔名始終一致。另以 `finally` 保證後續預覽整理即使發生非預期例外，也一定解除「正在解析」與按鈕停用狀態。`e2e-progress.mjs` 新增序號、檔名與總數一致性的守門檢查。",
  },
  {
    version: "v2.1.47",
    date: "2026-09-04",
    note: "上傳與判讀的操作回饋，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30，固定計算黃金值完全相同。（一）拖曳上傳：上傳卡片本來就接得到 drop，但畫面上完全沒有變化，使用者拖到一半看不出來丟這裡對不對，只能賭一把放開；現在拖曳經過時整張卡片會亮起來，放開就收掉。備份還原那一張卡原本完全不吃拖曳，現在也可以直接把備份檔拖進去。（二）檔案掉在放置區**外面**時，瀏覽器預設會直接開啟那個檔案、把使用者踢出系統畫面，現在全域擋掉並讓游標顯示「不可放置」。（三）判讀進度：使用者回報「上傳大量檔案後以為沒成功」，原因是判讀中只有按鈕文字換成「正在解析…」，一動也不動，檔案一多就分不出還在跑還是當掉了；現在按鈕會顯示「正在解析… 3／12」，上傳卡片上另有一行寫出正在讀哪一個檔名，並且每讀完一份就讓瀏覽器有機會重畫。新增 `scripts/e2e-drop.mjs` 與 `scripts/e2e-progress.mjs` 兩支守門測試，兩支都對「拿掉功能」的版本實測會紅字。",
  },
  {
    version: "v2.1.46",
    date: "2026-09-04",
    note: "結論草稿產生器改成只有一顆「產生草稿」，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30，固定計算黃金值完全相同。舊版在頁首與草稿框旁邊各有一顆按鈕，呼叫的是同一個函式。使用者指出實際動線用不到頁首那一顆：條件與條件範本都在下方，「哪怕條件沒變，為了確保資料正確，正常情況下仍會往下滑動確認條件」，所以每一條動線最後都停在草稿框旁邊；兩顆同名按鈕反而讓人以為有差別，也可能讓新手在還沒勾任何條件時就按下去，拿到一份用預設條件產生的草稿。現在移除頁首那一顆，草稿框旁邊那一顆由「重新產生」改名為「產生草稿」，行為不變（已手改過仍會先詢問再覆蓋）。另外補上保守的結果捲動：按下之後若草稿框整個看得見就**完全不動**，只有被推到視窗外時才捲到剛好看得見，且遵守系統的「減少動態效果」設定；新增 `scripts/e2e-reveal.mjs` 同時釘住「看不到時要帶過去」與「看得到時不可以捲」兩半。並修正三處已過期的程式註解：SheetJS 0.20.3 自 v2.1.45 起改為包內 `vendor/` 相依並以 SHA-256 鎖定，註解卻仍寫「官方 CDN」。",
  },
  {
    version: "v2.1.45",
    date: "2026-09-03",
    note: "年度輸入的判定改看年份數值、與另外兩支系統對齊，**沒有變更任何交通量或 PCU 計算**。v2.1.43 依「位數」判定（四碼一律當西元），於是把 `0115Q1` 判成「西元 115 年、超出範圍」並回一句「民國年請填 90～200」——但 0115 就是 115，訊息與事實矛盾；而共用的 `normalizeSurveyPeriod()` 一直都把它算成 115Q1，等於檢查與正規化對同一個字串有兩種看法。改以年份**數值**判定（民國 90～200 與西元 2001～2111 兩段不重疊，數值本身就分得出來），並補上 NFKC 與去空白，全形數字、全形 Ｑ 與夾在中間的空白一併收下。另外，v2.1.43 的守門測試斷言原始碼含有 `rocYear >= 90 && rocYear <= 200`——那是某一種實作的長相而不是行為，結果是想把三支同步回同一份程式反而會踩紅它，守門測試從「防止分歧」變成「鎖住分歧」；現已改成三支各放一份逐位元相同的行為契約檔（`tests/period-input-contract.mjs`，用 SHA-256 互相釘住），每一支都跑完整份契約。可接受的年份範圍完全沒有改：89Q1、201Q3、2000Q1、2112Q3 一樣擋下。",
  },
  {
    version: "v2.1.43",
    date: "2026-09-03",
    note: "年度輸入補上範圍檢查，**沒有變更任何交通量或 PCU 計算**。v2.1.42 開放民國與西元兩種寫法之後，年度輸入框只做「去掉非數字、截到四碼」，完全沒有範圍檢查；而 `normalizeSurveyPeriod()` 只在民國 90～200（西元 2001～2111）這個窗口內換算，窗口外的四碼年份會**原樣回傳**。於是打成 2112 或 1990 會直接把西元字串存成季度鍵——它和對應的民國寫法（201Q3、79Q2）是同一季，`quarterKey()` 算出來的排序鍵也完全相同、會相鄰出現，畫面上只看得出「同一季出現了兩次」，很難想到是年份寫法造成的。這正是 v2.1.42 要消滅的那一類問題，只是發生在換算窗口之外。現在超出範圍會擋下並在輸入框下方說明該填什麼，選檔按鈕也要檢查通過才會啟用；讀檔時再擋一次，避免按鈕被繞過。檢查抽成三支共用的 `checkSurveyPeriodInput()`（同時修掉另一個方向：民國兩碼年份如 99Q4 是合法寫法，排序與正規化一直都認得，不該被輸入檢查擋掉）。新增 3 項守門測試，並實測對未修正的 v2.1.42 全部紅字。",
  },
  {
    version: "v2.1.42",
    date: "2026-08-31",
    note: "季度輸入同時接受民國與西元年，**沒有變更任何交通量或 PCU 計算**。舊版的年度輸入框是 `max=\"999\"` 加上 `slice(0, 3)`，打西元 2026 會被靜靜截成 202 而且沒有任何提示，使用者拿到西元年標示的委託案時只能自己換算。現在兩種都收，但**寫入的季度一律正規化成民國年**（`normalizeSurveyPeriod()`，三支共用的 period-date 模組）——照打的字原樣存的話，同一季會因為寫法不同而變成兩個不同的鍵，季度清單與歷季比較都是以這個字串分組的，115Q1 與 2026Q1 會並列成兩季且永遠不會合併，而兩者的排序鍵完全相同、會相鄰出現，看起來只像同一季出現兩次。打西元時輸入框下方會即時顯示「將存成 115Q2」。",
  },
  {
    version: "v2.1.41",
    date: "2026-08-31",
    note: "三支系統跨系統徹查後的七項修正，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30，固定計算黃金值完全相同，37 份真實檔的總車輛數與修正前逐位相同。**(1) 工作表名稱前面多一個空白時，平日與假日會被合併成一筆。** 判斷日別資料頁的規則以前只容許名稱後面有空白；37 份真實檔裡有 11 份的分頁名稱帶空白，只要空白出現在前面就數不到兩張日別分頁，於是退回整份合併讀取——不是少讀一天，而是平日的量被加進假日那一筆。實測 11535T1502 的假日量由 86,207 輛變成 194,235 輛（虛增 125%），總量守恆所以任何以總量為基礎的檢查都抓不到。現與全日交通量共用同一套前後 trim 的規則。**(2) 匯出的轉向圖檔名不帶資料別，平日圖與假日圖互相覆寫**，ZIP 同名直接覆蓋，同一站只留下一張且看不出是哪一天。**(3) 表頭寫「大貨車」「大客車」時不再依欄位位置併入內建車種。** 舊版看到第 3、4 個車種欄位就當成大型車與特種車，大客車因此拿到特種車的當量 2.5，但大客車在工程上通常算大型車。改為比照全日交通量保留成自訂車種、由使用者自行歸類；表頭寫的都是內建四車種、只是順序亂掉或有殘留舊值時（如 11017T1501 七叉路口的合併儲存格）仍用位置推定救援。**(4) 全形數字「１２３」舊版計 0 輛**，全日交通量讀成 123，同一格在兩支得到不同的數字。**(5)「--」「－」「—」「–」不再被誤報成壞資料**——這是「該轉向不存在」的標準記法，全日交通量早就視為合法，實測 11017T1502 因此跳出 192 次誤報。**(6) 算不出來的統計範圍寫「－」不寫 0**，不足 24 小時的調查沒有全日尖峰小時，舊版仍寫 0 輛/hr 與 0.0%，會被 Excel 的加總與平均吃進去。**(7) 三支共用的非調查日期清單同步**（彙整、輸出、建檔、產製）。",
  },
  {
    version: "v2.1.40",
    date: "2026-08-31",
    note: "複查後修正調查日期選取，**沒有變更任何交通量或 PCU 計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30，固定計算黃金值完全相同。**「製表日期」不會再被當成調查日期。** 舊版實際紀錄日期取第一個像日期的儲存格，期別檢查卻另外使用會優先辨認『調查／監測日期』的共用選擇器，因此同一份檔案可能得到兩個日期；若製表日期括號寫『假日』，資料別也會被帶偏，重新匯入便可能不接手而多出一筆。現在紀錄日期、資料別與期別檢查全部使用 `findSurveyDate()`：優先採用明確標示且有效的調查日期，排除製表、列印、彙整、輸出、建檔與產製日期等非調查日期，讀不到時仍維持待確認而不阻擋匯入。規則只留在共用 `period-date` 模組。",
  },
  {
    version: "v2.1.39",
    date: "2026-08-31",
    note: "複查 v2.1.38 後修正三項發布前問題，沒有變更任何交通量或 PCU 計算，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。**一、撤回試算表套件降版。** 候選包把既有的 SheetJS 0.20.3 改成 npm registry 的 0.18.5，重新引入已知安全警示；本版恢復官方 CDN 的 0.20.3，並保留既有的安全讀取邊界。**二、檔案角色與原因一致。** 只有全日路段分向車種、沒有轉向或 OD 的純代號檔名，最終角色是「非路口轉向」，但原因仍誤稱「參考計算檔」；現在原因依最終內容角色產生，避免引導使用者錯誤改名。**三、連續相同提示不會互相提早關閉。** 舊版用訊息文字識別計時器，兩則內容相同時，前一個計時器會關掉後一則；現在每則通知使用獨立序號，點擊關閉也會使舊計時器失效。",
  },
  {
    version: "v2.1.38",
    date: "2026-08-30",
    note: "把「檔名決定行為」這件事從隱形規則改成看得見的規則，**沒有變更任何交通量計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30（五份真實調查檔的逐車種車輛數與 AM／PM 尖峰 PCU 與 v2.1.37 逐位相同，並已與全日交通量系統交叉驗算）。**一、讀不到站號時不再捏造一個。** `stationFromFilename()` 舊版在檔名切不出站號時回傳 `S-<雜湊值>`，那是整支程式唯一會「安靜出錯」的地方：不報錯，只給一個看起來像真站號的值，然後它會一路進到報表、匯出檔名與歷季比較，而使用者完全不會知道系統其實沒讀到站號。現在一律回傳空字串，並在匯入預覽標示「站號未判定」、提供欄位讓使用者直接填寫；沒有站號的紀錄不予寫入。**二、站號來源公開。** ImportPreview 新增 `stationSource`（workbook／filename／none）。站號本來就優先讀檔案內的「站號：」欄位、讀不到才退回檔名，但畫面上看不出來是哪一種；現在預覽逐列標示，由檔名推定時明確請使用者核對。**三、匯入失敗要說得出原因。** 舊版一律只丟「沒有可寫入的原始交通量檔。」，而使用者最常撞到的情形是檔名被判成參考計算檔——畫面上只有一個藍色標籤，訊息又不提檔名，於是完全無從得知「改個檔名就好了」。現在逐檔說明「哪個檔、為什麼、怎麼辦」，並區分是檔名造成的還是內容造成的（兩者處理方式完全不同）。ImportPreview 新增 `roleReason`。**四、部分檔案未寫入時要指名道姓。** 舊版成功訊息只算使用者自己選擇略過的數量，因角色或版面被濾掉的檔案完全不會出現在任何地方；五個檔進來、四個寫入時，畫面只說「已寫入 4 個路口」。**五、參考計算檔標籤由藍色改為警示色**並附上原因說明——藍色在本介面代表中性資訊，使用者不會意識到那代表「這個檔不會被寫入」。**六、匯入頁新增「檔名會決定什麼？」說明區塊**，在上傳前就看得到，含正例反例與建議命名。**七、移除轉向圖摘要卡寫死的「本系統只彙整尖峰轉向流量。」**——同一頁的時段選單就提供全日尖峰小時與全日時段，且上方已有一句會依資料涵蓋時數變動的正確說明，兩者並存自相矛盾；系統目前也不只彙整轉向流量。新增 7 項守門測試涵蓋角色判定、原因訊息、站號來源與「不得再出現 S- 開頭假站號」。**九、另修三處同類的「安靜失敗」**（發布前再稽核一次找到的）：（1）資料別原本把日期欄括號裡的**任何**內容都當成資料別，「日期：115年06月03日（晴）」會得到資料別「晴」；而「晴」不是「待設定」，isSameSurvey 不讓重新匯入接手它，同一個檔案再匯一次只會多出一筆、趨勢線被拆成兩條，且完全繞過系統為「待設定」準備的整套補救機制——現在只接受平日與假日，其餘一律回「待設定」。（2）表頭讀不到「路口編號：」時，支線代碼會被推定成 A1、A2…，與真實代碼（正規式允許 A1 這種寫法）在畫面與匯出上分不出來；它是跨季幾何繼承、轉向繼承與參考轉向表比對的鍵，同一路口若一季讀得到、一季讀不到，兩季支線會靜靜對不起來——推定行為保留（全給空字串會讓多支線模型建不起來），但改為列出推定的代碼並提醒確認。（3）有內容但不是數字的儲存格（「-」「休」「N/A」）原本一律當成 0 輛，而「0」與「沒測到」在統計上意義不同，且這個轉換讓品質檢查的 `Number.isFinite` 規則在匯入路徑上永遠不會觸發——現在逐格記錄並在預覽列出原文。**十、修正六處與實際行為不符的說明文字**：摘要卡那句被移除文案的孿生句、當量「只用於尖峰」（實際上也決定尖峰挑在哪一小時、也套用於全日時段）、總覽儀表板與轉向進階分析與核對工作台寫死的 PCU/hr（選全日時段時實際單位是 PCU/調查日）、以及要使用者「以 v1.4.0 重新匯入」的訊息（v1.4.0 的計算口徑已過時）。**十一、手冊修正七處**：尖峰搜尋範圍仍寫 05:00～12:00／12:00～23:00（v2.1.30 起已放寬為 00:00～12:00／12:00～24:00，使用者會用錯門檻判斷警示是否合理）、「四車種分類合計」（實際加總所有車種含自訂車種）、選單 17 項（實為 18 項）、支線上限 A～G、轉向圖只能切 AM／PM，以及手冊前面引用了本版已移除的那句文案。三項安靜失敗各補守門測試，並實測對未修正版本會失敗（4 項紅字）。**十二、交付前對抗性複查再修五項**：（1）**日期格式或布林值的儲存格會把 1.78 兆輛塞進資料**——`cellDates: true` 讓日期格的 `.v` 是 Date，`Number(Date)` 是有限的 epoch 毫秒會通過 `|| 0`，然後進尖峰挑選、PCU 與全日累計；這是 v2.1.37 就存在、且完全沒有提示的資料損毀，修法是讓判斷與寫入共用同一個運算式。（2）匯入失敗的逐檔說明一律 2.8 秒消失、`.toast` 沒有 `white-space: pre-line` 使條列擠成一團，等於說明寫了也看不到；改為依字數延長顯示（上限 20 秒）、保留換行、可點擊關閉。（3）使用者補填的站號未正規化，照訊息填 `11017T14-02` 會與另一季由檔名推出的 `T14-02` 對不起來，改走 `stationFromFilename()`。（4）補填站號後覆蓋／版本判斷不重算，會沒問過就覆蓋既有紀錄，改為一律建立新版本。（5）v2.1.37 以前存下的 `surveyType` 為「晴」的紀錄既非平日假日也非「待設定」，重新匯入會多出一筆——正是本版要修的症狀被修正本身觸發；`isSameSurvey` 改為把非平日／假日視同待設定。另新增 `tests/calculation-golden.test.ts` 黃金值鎖：在此之前**沒有任何測試在守「不得變更計算口徑」**，值取自 v2.1.37 實測。",
  },
  {
    version: "v2.1.37",
    date: "2026-08-30",
    note: "發布前複查 v2.1.36 後補上一項對帳漏報，不改交通量計算，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。v2.1.36 已讓摘要車輛數與轉向圖同讀 `row.vehicle`，並保留 PCU 依實際 OD 逐筆加總；但車輛數對帳只比較『全部車種總數』。若機車多 7 輛、小型車少 7 輛，兩者會互相抵銷，全部車種總數及總 PCU 都可能相同，系統便誤判為一致，單一車種的輛數與 PCU 明細其實仍分歧。本版改為逐車種比較 `row.vehicle` 與 OD 車種數，各車種分別沿用 5 輛或 5% 門檻；有差異時警告會列出車種及兩邊數值。若 PCU 與車輛數同時不一致，兩項原因會完整並列，不再只顯示其中一項。新增『各車種差異互相抵銷』反例守門測試。另補齊與現有 Cloudflare 外掛相符的 Worker／D1 官方型別及 `DB` 綁定宣告，讓乾淨原始碼可完成 TypeScript 驗證；不影響公開靜態網站或交通計算。v2.1.36、v2.1.35 的修正與曆日驗證均完整保留。",
  },
  {
    version: "v2.1.36",
    date: "2026-08-30",
    note: "複查 v2.1.35 後修正一項它引進的新不一致，沒有變更任何交通量計算，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。**摘要的車輛數改回與轉向圖同源。** v2.1.35 把單一車種 PCU 改用實際 OD 逐筆加總是對的（那修掉了 v2.1.34 用支線總 PCU 比例反推的錯誤），但它連「車輛數」也一起改成從 OD 加總，而轉向圖的車輛數讀的是 row.vehicle[id]。AM／PM／全日尖峰的 row.vehicle 是匯入時由尖峰視窗的原始格子算出來的，syncRouteTotals **刻意不重建**（重建會蓋掉使用者在核對工作台改過的值），所以它和 OD 加總本來就可能不一樣——而且系統既有的「車種統計異常」品質檢查容許 5 輛或 5% 的落差不報警。落在那個範圍裡，轉向圖會顯示一個數字、右側摘要顯示另一個，兩邊都不吭聲，正是 v2.1.34 要修掉的那個病。本版：**車輛數一律用 row.vehicle（與圖同源），PCU 一律走實際 OD**（保留 v2.1.35 的正確作法），兩者若對不起來由 reconciled 明講，並在摘要下方寫出實際原因，不靠任何一邊悄悄改寫另一邊。車輛數的對帳門檻沿用既有「車種統計異常」的 5 輛或 5%，不另外發明第三套標準。新增守門測試：摘要與轉向圖的車輛數必須相同（對 v2.1.35 實測紅字）、差很多時要講出來、小幅落差不濫報、一致時不誤報，以及瀏覽器層的「把資料改成來源分歧狀態後，圖與摘要仍必須顯示同一個數字」。v2.1.35 的兩項修正（實際 OD 拆解、曆日驗證）完整保留。",
  },
  {
    version: "v2.1.35",
    date: "2026-08-30",
    note: "複查 v2.1.34 後修正兩項新功能缺陷，沒有變更既有尖峰選擇、轉向分類、當量係數或路口總量計算，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。**一、單一車種 PCU 改用實際 OD 轉向資料**：v2.1.34 的 `pcuBreakdown()` 以支線左／直／右總 PCU 比例反推每個車種的轉向分布；當不同車種及轉向的當量不同時，會把個別車種 PCU 分錯，總量甚至可能剛好對得上而不觸發警告。現在有 routes 時直接逐筆加總「車種 × 實際轉向 × 匯入時當量」，圖與右側摘要使用相同 OD 路徑；只有沒有 routes 的舊備份才保留比例估算，並繼續以 reconciled 提醒不可靠。**二、日期檢查不再接受不存在的日期**：新增實際曆日驗證，會正確拒絕 115 年 2 月 29 日、4 月 31 日等日期，並正確接受 113 年 2 月 29 日。新增單元與瀏覽器守門測試。",
  },
  {
    version: "v2.1.34",
    date: "2026-08-30",
    note: "修正右側摘要與圖說不同話，新增第五種顯示模式，並新增「調查日期 × 期別」檢查與期別月份顯示。**沒有變更任何交通量計算**，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。**一、轉向圖右側摘要現在跟著「顯示 × 時段 × 車種」走**：以前那一格寫死 recordTotal() ＋文字「PCU/hr」，完全不看使用者選了什麼。於是顯示切成「車輛數」時，圖的抬頭寫「全路口流量 10,779 輛/調查日」、右邊摘要寫「10,469.5 PCU/hr」——同一張畫面兩個數字兩種單位。現在圖與摘要**共用同一組判斷**：值要用 PCU 還是輛由新的 displayValueKind() 決定、單位由 scopeUnit() 決定，兩邊都走這兩支，不各自再猜一次。**二、新增第五種顯示模式「車輛數＋百分比」**，並修正單一車種的單位謊報：以前車種只要不是「全部車種」就一律改報輛數（因為系統沒有存每個車種各自的 PCU），但選單還寫著 PCU。現在單一車種的 PCU 用 vehiclePcuFor() 現算，用的是匯入當時存下來的當量矩陣、和建立 movements PCU 時同一支 pceFactor，不是另寫一套公式；另外 pcuBreakdown() 會逐支線對帳，各車種 PCU 加總若與已存的總 PCU 對不起來（舊紀錄沒存當量矩陣時可能發生），畫面上會明白標示這一筆的單一車種 PCU 不可靠。**三、摘要新增車種組成**：百分比模式列各車種的百分比，車輛數＋百分比模式連車輛數一起列；選單一車種時改報該車種的數值與它占路口總量的百分比。**四、總覽儀表板與跨計畫比較的同類問題一併修好**：單位不再寫死 PCU/hr（全日時段會變成 /調查日）、標籤不再把內部代碼印成「最高流量路口 · FULL」、算不出的全日尖峰不再以相容欄位的 0 參與排名；跨計畫比較的時段選單補齊為四個，不再出現「選單只有 AM／PM 卻用著全日時段的數字」。**五、新增「調查日期 × 期別」一致性檢查**：匯入前輸入的期別與檔案表頭寫的調查日期如果對不起來，預覽面板顯眼標示，按「確認寫入」時再跳一次確認框；日期從表頭整塊文字判讀，不看固定欄位位置，優先採用有「日期：」標示的儲存格並排除「製表日期」這類非調查日期；**讀不到日期一律不阻擋匯入**，只提醒使用者自行確認。判斷邏輯集中在新檔 lib/period-date.ts——路口轉向、全日交通量、交通服務水準三支程式同一份程式、同一份測試表。**六、新增「期別顯示」切換（季別 雙向 實際調查月份）**：平常顯示 115Q1，按一下改顯示這一季實際做調查的月份（例：115年2、3月），季度下拉、已匯入季度清單、歷季趨勢圖 X 軸與右側摘要一起換；只換顯示文字，資料仍以季別分組與計算。ImportPreview 新增唯讀欄位 dateCandidates，既有的 date／dateSource 取法與值完全沒變。",
  },
  {
    version: "v2.1.33",
    date: "2026-08-29",
    note: "發布前複查補齊 v2.1.32 的 Excel 匯出缺口，沒有變更任何交通量計算。v2.1.32 已讓網頁歷季趨勢在無法計算全日尖峰時顯示「－」並斷線，但批次分析報表與頁面上的「下載趨勢 Excel」仍把相容欄位的 0 寫成真正數值，Excel 的可編輯圖表因此仍會掉到零。本版新增 scopeValueOrNull：無法計算的 DAY 匯出為空白 null，原生折線圖依既有 dispBlanksAs=gap 正確斷線；真正算得出的 0、以及 AM／PM 的 0 都完整保留。`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。",
  },
  {
    version: "v2.1.32",
    date: "2026-08-29",
    note: "複查修正兩項顯示問題，沒有動到任何計算。**一、歷季趨勢圖不再把「算不出全日尖峰」畫成 0**：不足 24 小時的調查、以及還沒重新匯入的舊備份，底層 DAY 欄位是空值 0；趨勢圖直接拿去畫，折線就掉到零、右側摘要寫「全日尖峰 0 PCU/hr」——看起來像那一季流量歸零，事實是這份調查根本算不出全日尖峰。0 會被抄進報告，「－」不會。系統其他地方（統計範圍切換、路口明細）本來就用 hasDayPeak 顯示「－」，只有趨勢圖漏了；現在折線在算不出來的季度**斷開**、不畫資料點，右側摘要與增減率都顯示「－」，判斷統一走新的 hasScopeValue（內部即 hasDayPeak），不另寫第二套。上午／下午尖峰完全不受影響。**二、品質異常明細的欄位標籤由「四車種分類合計」改為「各車種分類合計」**：v2.1.31 已把品質訊息改成「各車種合計」，卻漏了顯示同一個數字的欄位標籤，同一個數字上一行叫「各車種合計」、下一行叫「四車種分類合計」，等於把要消滅的說法留在使用者看到的最後一個字。`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。",
  },
  {
    version: "v2.1.31",
    date: "2026-08-28",
    note: "發布前複查修正。歷季趨勢的「整體」模式在 v2.1.30 已畫入第三條「全日尖峰」折線，但圖例、顏色、標題、右側季度摘要與下載檔名仍只按 AM／PM 處理。現在整體模式的三條線均有獨立顏色、圖例、點標籤與右側摘要，PNG 檔名也明確寫出 AM_PM_DAY；Excel 圖表繼續使用同一組三個尖峰數列。另將多車種調查的品質訊息由「四車種合計」改為「各車種合計」。本版沒有變更尖峰選擇、車種當量、轉向分類或任何流量計算，`LAST_CALC_CHANGE_VERSION` 維持 v2.1.30。",
  },
  {
    version: "v2.1.30",
    date: "2026-08-28",
    note: "新增「全日時段」與「全日尖峰小時」兩大類統計，並依使用者決定調整兩項計算口徑。**一、新增全日尖峰小時（DAY）**：掃過完整 24 小時找出流量最大的那一個小時，只有 24 小時的調查檔算得出來；不足一天的調查（例如只做 07:00–09:00＋17:00–19:00 共 4 小時）一律顯示「－」，不拿 4 小時的樣本冒充一整天的最大值——那個數字必然等於上午與下午尖峰裡較大的一個，看起來像新資訊其實不是。**二、全日時段（FULL）納入同一套統計範圍**：路口轉向圖、車種組成分析、駛入／駛出流量、流量核對工作台、OD 矩陣、支線平衡、Excel 匯出與批次成果包一律以 SCOPE_KEYS 產生欄位，新增時段不必再到各處手動補一次。全日時段不另外存檔，每次載入由 record.survey／route.survey 現算（syncRouteTotals），只有一個來源。**三、上午／下午尖峰的搜尋範圍放寬**：上午由 [05:00, 12:00) 改為 [00:00, 12:00)，下午由 [12:00, 23:00) 改為 [12:00, 24:00)。舊的兩段合起來掃不到 23:00–24:00 與 00:00–05:00，真正的尖峰若落在那六個小時，任何一個數字都抓不到；新的兩段剛好把一天鋪滿且不重疊。實測使用者提供的 8 份調查檔，新舊口徑算出來的上午／下午尖峰完全相同。**四、每一格的原始車輛數先四捨五入成整數再進入所有計算**：有些調查檔的儲存格存的是小數（0.36、5.5506…），Excel 的格式把它顯示成整數，於是報告上看到 0 與 6、程式拿去算的卻是 0.36 與 5.5506，全日車輛數會算出 27,988.79 輛這種不存在的車。四捨五入放在全系統唯一讀取原始儲存格的地方，之後的加總、尖峰滾動、PCU 換算全部自動吃到整數。**五、轉向圖新增「車輛數」顯示模式**：原本只有交通量（PCU）、百分比、PCU＋百分比三種，選「全部車種」時拿不到純輛數；新模式一律報實際調查到的車輛數，可搭配車種篩選看單一車種或全部車種的輛數。圖上的單位跟著統計範圍走（尖峰是 PCU/hr、輛/hr，全日時段是 PCU/調查日、輛/調查日），不再寫死 PCU/hr。**六、既有資料相容**：舊備份與舊 localStorage 只有 AM／PM，載入時自動補上空的 DAY／FULL，既有的上午／下午尖峰數字一個都不動；全日時段因為是從已存的調查總量現算，舊資料直接就有，全日尖峰小時則需要重新匯入原始檔（逐時間格的資料沒有存檔，無法回推），畫面與品質檢查都會明確寫出是哪一種原因。三、四兩項確實變更了計算口徑，依使用者決定一併推進 LAST_CALC_CHANGE_VERSION 至 v2.1.30，v2.1.30 以前鎖定的季度會亮出鎖定衝突。",
  },
  {
    version: "v2.1.29",
    date: "2026-08-27",
    note: "發布後複查發現三件事，都不影響任何交通量、PCU、駛入／駛出、尖峰搜尋或車種組成的計算。一、v2.1.28 新增的『被更新版本鎖定』警示，判斷時沒有先確認版號解析得出來——isVersionAtLeast 認不得格式時一律回傳 false（對『鎖定版本早於常數』那條是對的），用在這裡卻會反過來：只要 VERSION 帶了 -final、-rc1 這種尾巴或多一個空白就解析不出來，於是每一筆 v2.1.21 以後鎖定的資料全部亮紅字，正是 v2.1.28 要修掉的那個症狀（實測 19×19 版號矩陣會多出 344 筆紅字），訊息還會說反。改為兩個版號都解析得出來才判斷——版號認不得是『不知道』，不是『有問題』。二、四大車種的名稱兩張表對不起來：app 的 VEHICLE_LABELS 寫『大型／大客車』『特種／聯結車』，lib 的 CORE_VEHICLE_LABELS 寫『大型車』『特種車』，而匯入時寫進紀錄的是後者。vehicleLabel() 優先讀紀錄，所以 v2.1.19 以前沒有 vehicleLabels 欄位的舊備份會落到前者，跨季的結論草稿因此同一個車種前後兩種寫法。以匯入時實際寫入的那一組為準，並新增第 12 項發布結構檢查釘住兩張表一致（已實測會在舊寫法下紅字）。三、交付的 ZIP 中文檔名沒有標記 UTF-8，解壓後全部變成 #Uxxxx 亂碼，導致該備存包內找不到程式連得到的手冊檔名、發布結構檢查第 4 項紅字（44 項中 2 項失敗）；檔名還原後 44/44 全過。⚠️ 線上網站不受影響（使用者實測手冊下載正常），受影響的只有交付出去的備存 ZIP——拿它還原 repository 會少掉手冊。本版重新打包並標記 UTF-8 檔名。",
  },
  {
    version: "v2.1.28",
    date: "2026-08-27",
    note: "把測試種子裡的實際計畫、站號與路口名稱換成示範資料，沒有變更任何計算規則或操作方式。scripts/seed-state.json 與 seed-wide.json 原本寫著實際的委託案名稱、計畫編號、站號與路口名稱，而這兩個檔案就在公開的 repository 裡、也能從 GitHub Pages 下載（裡面的流量數字本來就是 seed-state.mjs 用固定種子產生的，不是實際調查值，但名稱是真的）。本版改為「示範捷運延伸線示範標」「示範1－示範交流道路口」與 A0000／S01-01 這類假識別碼，並新增第 10 項守門檢查釘住種子與選取腳本不得再出現實際名稱。另新增 .gitattributes（* -text）：上一版的備份 ZIP 裡每一個文字檔都被轉成 CRLF，連建置產物也一樣，導致 assets 的內容不再雜湊成它自己的檔名、無法與線上逐位元核對；第 11 項守門檢查釘住這個設定。兩項都已實測會在對應的錯誤狀態下失敗。lib/ 與 app/ 裡的路口名稱刻意未動——referenceMovementForOd 等產品行為靠它判斷，要不要改是產品決策，不是清理工作。另修正使用者回報的鎖定衝突誤報：舊版只要鎖定當時的版號和目前不同就報「鎖定衝突」，是字串完全相等比較，於是升過一次版之後所有已鎖定資料就永遠亮紅字（使用者有 20 幾季），而且和真正該注意的「鎖定後資料內容已變更」長得一模一樣紅，會把真的那次一起淹掉。現在新增 LAST_CALC_CHANGE_VERSION（目前 v2.1.21，最後一次變更尖峰小時口徑的版本）與 lockStatus()，只有鎖定版本早於它才算衝突；升版但沒動計算只顯示一行灰字說明。使用者不需要、也不應該為了這行紅字去解除並重新鎖定——那會蓋掉原本的鎖定時間與版本這份稽核紀錄。新增單元測試 6 項與端對端檢查 2 項。另把 npm test 改為先跑 npm run lint，讓 CI 也把關程式碼檢查。另修正轉向圖同一張圖卡兩半各說各話：駛出那半印支線名稱、駛入那半印原始代碼（sourceCode），使用者替支線改名之後圖上只有一半會變，人工新增的支線會印成「←人工2」，PNG 與 PDF 匯出共用同一支產生程式所以交付出去的圖也一樣。兩半改為同一種取法，圖卡標題仍然保留「代碼 · 名稱」。另移除右上角季度選單裡的死選項「尚無季度」：它被無條件畫出來，但選了會把季度設成空字串、緊接著又被拉回最新一季，等於點了什麼都沒發生，而全系統六個季度選單只有這一個有它；現在只有真的一季都沒有時才顯示。新增端對端腳本 scripts/e2e-arm-name.mjs，兩項都已實測會在未修正的舊版下紅字。發布前增量複查另補上較新版本鎖定的降版相容性警示，以及舊備份自訂車種在結論草稿的顯示名稱 fallback；兩者都不改任何交通量或 PCU 計算。",
  },
  {
    version: "v2.1.27",
    date: "2026-08-26",
    note: "把上一版修好的發布結構釘進自動檢查，沒有變更任何計算規則或操作方式。新增 tests/release-structure.test.mjs（9 項）：只能有一條 GitHub Pages 發布路徑、點號開頭檔案（.nojekyll／.gitignore／.github／.openai/hosting.json）不得遺失、不得出現第二套套件鎖定檔、根目錄不得殘留上一版的雜湊資產、手冊必須跟著版號重新產生且舊版手冊要刪除、手冊封面戳記與每一頁頁尾的版號與日期必須一致、更新紀錄的最新版號必須等於程式版號。前 8 項已逐一實測會在對應的錯誤狀態下失敗（共 11 種情境），不是只加會通過的檢查。另修正 DEPLOYMENT.md（仍寫著已退役的 GPT Site、已移除的 pnpm 指令與兩條部署路徑），並將 CHANGELOG.md 改為指向本清單這個唯一來源；scripts/stress-drag.mjs 原本寫死某一台機器上的種子檔絕對路徑且沒有正式建置目錄預設值，現已改為可直接執行；第 9 項守門檢查會防止無參數啟動錯誤再次出現。",
  },
  {
    version: "v2.1.26",
    date: "2026-08-26",
    note: "發布與維護健檢版，沒有變更任何交通量計算規則。(1) GitHub Actions 改為只執行建置與測試，正式網站統一由 GitHub Pages 的 main／root 分支發布，避免自訂 workflow 與分支發布互相覆蓋。(2) 補入 .nojekyll，清除根目錄過期雜湊資產與 v2.1.21～v2.1.25 舊手冊，避免快取或人工上傳留下多版本檔案。(3) 套件管理統一為 npm，移除失同步的 pnpm 鎖定檔；SheetJS 改用官方 0.20.3 發布包，正式相依套件安全掃描為 0 項弱點。(4) 修正全部 ESLint 錯誤與警告，並補齊 React 儲存 effect 的相依項；舊版備份相容欄位與目前畫面行為不變。(5) 線上版本只用帶版號手冊、?v= 參數及新版專屬雜湊資產驗證，不用容易受 CDN 快取影響的固定路徑判斷。",
  },
  {
    version: "v2.1.25",
    date: "2026-08-25",
    note: "結論草稿的「各支線佔路口總量百分比」拆成**駛入**與**駛出**兩個勾選項。使用者問「10.6% 是方向無關的值，還是只是駛入的？」——是駛入的，而且舊版**永遠只寫得出駛入那一組**：兩個百分比其實都算了，但輸出是 `if (inShare) … else if (outShare) …`，只有整筆完全沒有駛入資料時才輪得到駛出；而 inflowPcu 由 destinationFlowTotal() 產生、那支函式永遠回傳數字，所以「佔駛出」是**執行不到的死碼**，一次都沒有被寫出來過。選項名稱也只寫「佔路口總量百分比」，沒說是哪個方向，而且標籤還會隨資料在「佔駛入」與「佔駛出」之間悄悄變動。兩個方向的分母相同（都是路口總量，因為駛入合計必然等於駛出合計），但分子不同，數字差很多——實測某一筆路口B 駛入 10.4%、駛出 27.6%，路口F 駛入 42.8%、駛出 14.7%。本版拆成「各支線佔駛入路口總量百分比」與「各支線佔駛出路口總量百分比」，各勾各的，兩個都勾時駛入排在駛出前面。**沒有動任何計算**：舊的 share 鍵在 normalizeCondition 裡只換成 shareIn（不是展開成兩項——展開會讓既有範本多出一段從來沒有過的「佔駛出」），既有範本與備份產生的草稿與 v2.1.24 逐字相同，已用整份字串比對的迴歸測試釘住。新增 5 項單元測試（含「兩個方向用同一個分母、各自加總都是 100%」的防線，避免日後有人把駛出的分母換掉——換了之後每一格看起來仍是合理的百分比，畫面上看不出來）與 3 項端對端檢查。",
  },
  {
    version: "v2.1.24",
    date: "2026-08-25",
    note: "使用者回報一項並提出一項需求，兩項都處理。(1) **範本現在專屬於各自的計畫**：結論草稿的「條件範本」與報表的「匯出項目範本」舊版都存成一份扁平清單、所有計畫共用——在甲計畫存的範本，切到乙計畫照樣列在畫面上。這不只是看了礙眼：結論條件裡存著 intersectionKeys 與 branchNames，那是該計畫專屬的識別字，套到別的計畫會篩出 0 筆而找不出原因。這支程式其實已經知道這件事（換計畫時本來就會重設「正在編的條件」與草稿），漏掉的只有「已存起來的範本清單」。改法與 pceByProject／catalogByProject／mappingsByProject 完全一致，連 setter 都沿用同一個 scopedSetter。**既有的範本不會不見**：升版時舊的扁平清單會分給每一個計畫各一份，請到各計畫把用不到的刪掉一次，之後新存的就只屬於當下那個計畫。備份與還原同樣依計畫分開帶，舊版備份（扁平清單）也讀得懂。(2) **「各支線各車種駛入／駛出車輛數」拆成駛入、駛出兩個勾選項**：舊版一勾就是兩個方向都寫，只需要其中一個方向時只能產生完再自己刪。拆開之後兩個方向各自獨立；只勾一個方向時，「呈現方式」那一區會收起來，因為「雙向合計」是把兩個方向加起來，對單一方向來說那是**錯的數字**（會把另一個方向的車也算進去）。**沒有動任何計算**：舊的 branchComposition 鍵在讀取時原地展開成新的兩項，既有範本與備份產生的草稿與 v2.1.23 逐字相同，已用整份字串比對的迴歸測試釘住。新增 6 項單元測試、一支備份完整性測試（6 項）與 6 項端對端檢查。",
  },
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
    note: "修正結論草稿產生器切換分頁後內容消失：條件與草稿原本是元件自己的狀態，切到別的分頁時元件被卸載、狀態跟著清空，使用者只是去看一眼路口轉向圖再回來，設好的整組條件與已產生的文字就全部不見了。狀態改放在整個 session 都不會卸載的上層元件，只有換計畫時才重設（換了計畫，原本挑的路口與支線本來就不存在）。另在「報告文字草稿」與「結論草稿產生器」各加一段說明，講清楚什麼時候該用哪一個（前者是這批 Excel 的說明文字、段落跟著匯出項目走；後者是自己出題），詳細對照表寫進手冊第 14 章。另外把「流量核對工作台」的表頭分成兩組：中間各車種欄位加上「(1) 原始調查車輛數（輛/hr）」，右邊加上「(2) 乘上車種轉向當量後的交通流量」，並在表格上方說明這一頁是核對換算過程用的——車種欄若標成 PCU 就沒有東西可以核對了。車種欄位本來就是依每一筆紀錄自己的車種清單產生（不是寫死四種），多車種調查格式一直都可以用，本次補上端對端測試把關（實測 7 車種全部列出，換算式也逐項使用）。「流量核對工作台」與「歷季趨勢比較」新增**駛出／駛入視角切換**：兩者是同一批 OD 流向、只是分組方式不同，資料完整時整個路口的總量必須相等，所以兩邊都會直接寫出合計關係——相等時說明可以互相核對，不相等時寫出差額並指出「有流向沒有指定目的支線」，因為那個差額正好就是缺口的大小。歷季趨勢的 Excel 匯出也跟著同一個視角走，避免折線圖與附表給出兩組數字。既有計算完全未變動。",
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
            /*
             * 示範資料只有上午與下午尖峰。全日時段與全日尖峰小時留空
             * ——示範資料本來就不是 24 小時的調查，硬編一個數字進去會讓
             * 使用者以為那是真的算出來的。
             */
            ...emptyScopeMovements(),
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
          ...emptyPeakWindows(),
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

/**
 * 括號裡屬於「資料別」的那幾種字樣（X-36）——**只給畫面顯示用**。
 *
 * 使用者 2026-09-16：
 *   「我的檔案……的確會出現 A路段(平日)、B路段(假日) 這種，
 *     但平日和假日是分別兩筆資料……只要不要程式搞混成同一筆資料就好」
 *   「明明是同一路段，卻因為有站號，誤判為多個路段」
 *
 * ⚠️ 舊版把括號內的字**一律刪掉**，於是分不出括號裡是哪一種：
 *   ・「（平日）」「（假日）」是**資料別**——系統另有欄位承載它，
 *     刪掉才對（否則同一條路段會因為資料別分裂成兩項）。
 *   ・「（北向）」「（南向）」是**位置**——那是兩個不同的調查點，
 *     刪掉就會被判成同一個，而且用的是 Map，後到的蓋掉先到的，
 *     被蓋掉那一筆連同它的資料一起從畫面上消失。
 *
 * ⚠️ 這份白名單**不參與「是不是同一個路口」的判定**（那是
 *   `canonicalIntersectionKey`，它一律刪括號，有測試釘住）。
 *   這裡只負責一件事：主工具列把「A路段（平日）」與「A路段（假日）」
 *   併成一項之後，標籤不要還掛著其中一天。
 */
const DROPPABLE_PAREN_CONTENT =
  /^(?:平日|假日|例假日|平常日|週末|周末|工作日|非假日|[三四五六七八九十\d]+[叉岔]路口|修正版|更新版|最終版|定稿版?|final|rev(?:ision)?\s*\d*|ver(?:sion)?\s*[\d.]*|v\s*[\d.]+)$/i;

/**
 * 拿掉名稱裡的「資料別」括號，給**畫面顯示**用（X-36）。
 *
 * ⚠️ 與 `canonicalIntersectionKey` 用**同一份白名單**，但兩者用途不同：
 *   ・`canonicalIntersectionKey` 是拿來比對「是不是同一個路口」的鍵；
 *   ・這一支是拿來寫在畫面上的名字。
 *   主工具列把「A路段（平日）」與「A路段（假日）」併成一項之後，
 *   標籤若照抄第一筆的名字就會寫成「A路段（平日）（2 季）」——
 *   明明併起來了卻還掛著其中一天，看的人會以為另一天不見了。
 *
 * ⚠️ 非資料別的括號（（北向）、（第一期）…）**保留**：
 *   那是區分不同調查點的資訊，拿掉就看不出差別了。
 */
export function displayIntersectionName(input: string) {
  const cleaned = input
    .replace(/[（(]([^）)]*)[）)]/g, function (whole, inner) {
      return DROPPABLE_PAREN_CONTENT.test(String(inner).trim()) ? "" : whole;
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || input;
}

/**
 * 兩個名稱是不是同一個路口。
 *
 * ⚠️ 括號內的字**一律刪掉**，這是刻意的，不是漏網（有測試釘住）：
 *   「（湖內區）」是行政區註記、「（修正版）」是版本、「（七叉路口）」是形制、
 *   「（平日）」是資料別——同一個路口在不同檔案裡會帶上其中任何一種，
 *   留著就會讓同一個路口分裂成好幾項。
 *
 * ⚠️ 「（北向）」「（南向）」也會被刪掉，兩站因此共用同一個 key——
 *   **那也是刻意的**：系統把它們當成同一個路口的「並存站號」，
 *   各處再依站號分開（歷季趨勢有站別切換，見
 *   `tests/report-draft.test.ts` 的「並存站號（北向／南向）仍然只畫一個站」）。
 *   2026-09-16 我一度想改成「只刪已知字樣、保留位置」，被這兩條測試擋下來——
 *   **不要再改**，要分開的地方是各張表自己逐筆列（見 X-35），不是這個鍵。
 */
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

/**
 * 「該轉向不存在」的合法佔位記號。
 *
 * 與全日交通量 traffic-parser.ts 的 isUnusableCount() 用同一組字元
 * （`-` `－` `—` `–`）。這些格子按 0 輛處理，但**不是**壞資料，不該警告。
 */
const DASH_PLACEHOLDER = /^[-－—–]+$/;

/**
 * 這張工作表是不是「平日」或「假日」的資料頁。
 *
 * 舊寫法是 `/^(平日|假日)\s*$/`——只容許**尾端**空白。實際收到的調查表裡
 * 分頁名稱前後多一個空白是家常便飯（37 份真實檔就有 11 份如此），
 * 而前導空白會讓這個判斷整組失效，後果不是少讀一天，是**兩天被合併成一筆**：
 * daySheets 數不到 2 就退回單一 inspectWorkbook，它會把所有資料頁依時間
 * 疊加起來，於是平日的量被加進假日那一筆。實測 11535T1502 一份真實檔，
 * 假日由 86,207 輛變成 194,235 輛（虛增 125%），總量卻守恆，
 * 任何以總量為基礎的檢查都抓不到，畫面只顯示匯入成功。
 *
 * 全日交通量的 trafficSheetNamesForDay() 一直是前後都 trim 的；
 * 這裡改成同一套規則，三支系統對同一個檔名的判斷才會一致。
 */
export function isDayTypeSheetName(sheet: string): boolean {
  return /^(平日|假日)$/.test(String(sheet ?? "").normalize("NFKC").trim());
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
  /*
   * 切不出站號時回傳空字串，由呼叫端決定怎麼處理。
   *
   * 舊版在這裡回傳 `S-<雜湊值>`。那是這支程式裡唯一會「安靜出錯」的地方：
   * 它不會失敗，只會產生一個看起來像真站號的值（S-372），然後那個值會一路
   * 進到報表、匯出檔名與歷季比較，而使用者完全不會知道系統其實根本沒讀到
   * 站號。判讀不出來就要說判讀不出來，不能拿一個假的頂替。
   */
  return "";
}

export function totalMovement(
  approach: Approach,
  peak: ScopeKey,
  movementKey?: MovementKey,
  vehicle: VehicleKey = "all",
  routes?: RouteFlow[],
) {
  const row = approach.movements[peak] || emptyMovement();
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

/*
 * ── 單一車種的 PCU ──────────────────────────────────────────────
 *
 * 系統只存「每個轉向的總 PCU」與「每個車種的車輛數」，沒有存每個車種各自的
 * PCU。所以車種篩成單一車種時，以前一律改報車輛數——這是對的，但畫面上的
 * 「顯示」選單仍寫著 PCU，講一套做一套。
 *
 * v2.1.34 起改成現算：**用的是 syncRouteTotals 建立 movements PCU 時完全
 * 同一支 pceFactor、同一組係數（record.pceUsed）**，不是另寫一套公式。
 * 有逐條流向的紀錄，各車種算出來的 PCU 加總本來就會等於已存的總 PCU。
 *
 * 但舊紀錄若沒有存下當量矩陣就會退回 DEFAULT_PCE，那時兩者可能對不起來。
 * 對不起來的時候不可以默默顯示——`pcuBreakdown()` 會回報 reconciled: false，
 * 呼叫端必須在畫面上標明這一筆的單一車種 PCU 不可靠。
 */
export function vehiclePcuFor(
  record: TrafficRecord,
  vehicle: PceVehicle,
  movement: MovementKey,
  count: number,
) {
  return count * pceFactor(record.pceUsed || DEFAULT_PCE, vehicle, movement);
}

/**
 * 一支支線在某個統計範圍下，逐車種的車輛數與 PCU，外加一次對帳。
 *
 * reconciled 為 false 代表「各車種 PCU 加總」與「已存的轉向 PCU」對不起來，
 * 這一筆的單一車種 PCU 不可靠，畫面上必須講出來。
 */
export function pcuBreakdown(
  record: TrafficRecord,
  approach: Approach,
  scope: ScopeKey,
) {
  const row = approach.movements[scope] || emptyMovement();
  const storedPcu = roundedPcu(row.left + row.through + row.right);
  const perVehicle: Record<string, { count: number; pcu: number }> = {};
  let derivedPcu = 0;
  const sourceRoutes = (record.routes || []).filter(
    (route) => route.fromApproachId === approach.id,
  );
  const vehicleIds = new Set(Object.keys(row.vehicle || {}));
  for (const route of sourceRoutes)
    for (const id of Object.keys(route.volumes?.[scope]?.vehicle || {}))
      vehicleIds.add(id);
  const overall = row.left + row.through + row.right || 1;
  /*
   * 車輛數的唯一來源是 row.vehicle——**轉向圖也是讀這一個**
   * （totalMovement(approach, scope, undefined, id) 回的就是 row.vehicle[id]）。
   *
   * v2.1.35 把 count 改成從 OD 逐筆加總，PCU 那一半是對的，但車輛數這一半
   * 讓摘要與圖又分成兩個來源：AM／PM／全日尖峰的 row.vehicle 是匯入時由尖峰
   * 視窗的原始格子算出來的，syncRouteTotals **刻意不重建**（2026-09-12 更正：
 * 原本寫的理由「會蓋掉使用者在核對工作台改過的值」是錯的，那個編輯功能
 * 並不存在；真正的理由是逐時間格資料沒有存進紀錄，這裡推不回去。舊敘述：使用者
   * 在核對工作台改過的值），所以它和 OD 加總本來就可能不一樣——而且系統既有的
   * 「車種統計異常」品質檢查容許 5% 的落差不報警。落在那個範圍裡，圖會顯示
   * 一個數字、摘要顯示另一個，兩邊都不吭聲。
   *
   * 所以：**車輛數一律用 row.vehicle（與圖同源），PCU 一律走實際 OD**，
   * 兩者若對不起來就由 reconciled 講出來，不靠任何一邊悄悄改寫另一邊。
   */
  const hasRowVehicles = Object.keys(row.vehicle || {}).length > 0;
  let routeCountTotal = 0;
  let rowCountTotal = 0;
  const countMismatches: Array<{
    id: string;
    routeCount: number;
    rowCount: number;
  }> = [];
  for (const id of vehicleIds) {
    let routeCount = 0;
    let pcu = 0;
    if (sourceRoutes.length) {
      /*
       * OD 紀錄已存有「逐車種 × 實際轉向」數量，PCU 必須直接照它加總。
       * 不可用左／直／右的總 PCU 比例反推：各車種及各轉向當量不同時，
       * 反推會把個別車種 PCU 分錯，甚至可能在總量恰好相等時逃過對帳。
       */
      for (const route of sourceRoutes) {
        const value = Number(route.volumes?.[scope]?.vehicle?.[id]) || 0;
        routeCount += value;
        pcu += vehiclePcuFor(record, id, route.movement, value);
      }
    }
    /*
     * row.vehicle 完全是空的（很舊的備份）才退而用 OD 加總當車輛數，
     * 否則整張摘要會變成 0。
     */
    const count = hasRowVehicles ? Number(row.vehicle?.[id]) || 0 : routeCount;
    if (!sourceRoutes.length) {
      /*
       * 僅供沒有 OD 明細的舊備份：只存支線總車種數與總 PCU，無法還原精確
       * 轉向，只能依既有比例估算，並由 reconciled 明確揭露這是估算值。
       */
      pcu = MOVEMENT_KEYS.reduce(function (sum, movement) {
        const share = (count * row[movement]) / overall;
        return sum + vehiclePcuFor(record, id, movement, share);
      }, 0);
    }
    perVehicle[id] = { count, pcu: roundedPcu(pcu) };
    derivedPcu += pcu;
    routeCountTotal += routeCount;
    rowCountTotal += count;
    if (sourceRoutes.length && hasRowVehicles) {
      /*
       * 必須逐車種核對，不能只核對全部車種總數。否則「機車多 7 輛、
       * 小型車少 7 輛」會互相抵銷，摘要仍會把同一車種的輛數與 PCU
       * 分別取自兩套不一致的明細，卻完全沒有警告。
       */
      const vehicleCountTolerance = Math.max(5, Math.abs(count) * 0.05);
      if (Math.abs(routeCount - count) > vehicleCountTolerance)
        countMismatches.push({ id, routeCount, rowCount: count });
    }
  }
  /* PCU 容差取 1%＋0.5，吸收逐格四捨五入；差得更多就是係數對不起來。 */
  const pcuTolerance = Math.max(0.5, storedPcu * 0.01);
  const pcuMatches = Math.abs(roundedPcu(derivedPcu) - storedPcu) <= pcuTolerance;
  /*
   * 車輛數容差沿用既有「車種統計異常」品質檢查的門檻（5 輛或 5%），
   * 不另外發明第三套標準。
   */
  const countMatches =
    !sourceRoutes.length ||
    !hasRowVehicles ||
    countMismatches.length === 0;
  const reasons: string[] = [];
  if (!pcuMatches)
    reasons.push(
      `各車種 PCU 加總 ${roundedPcu(derivedPcu).toLocaleString()} 與已存的路口總 PCU ${storedPcu.toLocaleString()} 對不起來`,
    );
  if (!countMatches) {
    const details = countMismatches
      .slice(0, 3)
      .map(function (item) {
        const label = record.vehicleLabels?.[item.id] || CORE_VEHICLE_LABELS[item.id] || item.id;
        return `${label}（逐條流向 ${Math.round(item.routeCount).toLocaleString()} 輛、各車種 ${Math.round(item.rowCount).toLocaleString()} 輛）`;
      })
      .join("、");
    const remainder = countMismatches.length > 3 ? `等 ${countMismatches.length} 種` : "";
    reasons.push(`各車種車輛數明細對不起來：${details}${remainder}`);
  }
  const reason = reasons.join("；");
  return {
    perVehicle,
    storedPcu,
    derivedPcu: roundedPcu(derivedPcu),
    routeCountTotal: Math.round(routeCountTotal),
    rowCountTotal: Math.round(rowCountTotal),
    reconciled: pcuMatches && countMatches,
    reason,
  };
}

/** PCU 一律留一位小數。全系統只有這一支，畫面與匯出才不會差在小數點。 */
export function roundedPcu(value: number) {
  return Math.round(value * 10) / 10;
}

export function emptyMovement(): Movement {
  return {
    left: 0,
    through: 0,
    right: 0,
    vehicle: {} as Record<string, number>,
    rawVehicleTotal: null,
  };
}

export function emptyRouteVolume(): RouteVolume {
  return { pcu: 0, vehicle: {} };
}

/** 四個統計範圍都給一份空的 Movement，之後再覆蓋有資料的那幾個。 */
export function emptyScopeMovements(): Record<ScopeKey, Movement> {
  return Object.fromEntries(
    SCOPE_KEYS.map((key) => [key, emptyMovement()]),
  ) as Record<ScopeKey, Movement>;
}

export function emptyScopeVolumes(): Record<ScopeKey, RouteVolume> {
  return Object.fromEntries(
    SCOPE_KEYS.map((key) => [key, emptyRouteVolume()]),
  ) as Record<ScopeKey, RouteVolume>;
}

/** 三個尖峰都給一組空的起訖時間。空字串＝「這個尖峰沒有值」。 */
export function emptyPeakWindows(): Record<
  PeakKey,
  { start: string; end: string }
> {
  return Object.fromEntries(
    PEAK_KEYS.map((key) => [key, { start: "", end: "" }]),
  ) as Record<PeakKey, { start: string; end: string }>;
}

/**
 * 補齊一筆紀錄的四個統計範圍，讓舊備份與舊 localStorage 直接能用。
 *
 * v2.1.29 以前的資料只有 AM／PM。這支函式在載入、還原備份、匯入之後都會跑，
 * 把缺的 DAY 與 FULL 補成空值——**空值不是 0**：畫面靠「有沒有 peaks.DAY.start」
 * 分辨「這份調查不足 24 小時」與「舊資料還沒重新匯入」，兩種都顯示「－」但
 * 說明不一樣。這裡不會憑空生出數字，也不會動到任何既有的 AM／PM 值。
 */
export function ensureRecordScopes(record: TrafficRecord): TrafficRecord {
  record.peaks = record.peaks || ({} as TrafficRecord["peaks"]);
  for (const key of PEAK_KEYS)
    if (!record.peaks[key]) record.peaks[key] = { start: "", end: "" };
  (record.approaches || []).forEach(function (approach) {
    approach.movements =
      approach.movements || ({} as Approach["movements"]);
    for (const key of SCOPE_KEYS)
      if (!approach.movements[key]) approach.movements[key] = emptyMovement();
  });
  (record.routes || []).forEach(function (route) {
    route.volumes = route.volumes || ({} as RouteFlow["volumes"]);
    for (const key of SCOPE_KEYS)
      if (!route.volumes[key]) route.volumes[key] = emptyRouteVolume();
  });
  return record;
}

/** 這筆紀錄算得出全日尖峰小時嗎？（有 24 小時資料，而且真的挑到了一個視窗） */
/**
 * 這一筆算不算得出「全調查時段尖峰」。
 *
 * ⚠️ v2.1.64 起**不再要求涵蓋 24 小時**（見 peakWindowsFor 的說明）。
 * 現在算不出來只剩兩種情形，兩種都與涵蓋時數無關：
 *   (1) 舊備份沒有存逐時間格的資料 → 重新匯入原始檔就有
 *   (2) 格距組不成整小時（例如 45 分鐘一格）→ rollingPeak 回 null
 * 兩種都顯示「－」而不是 0：**0 會被抄進報告，「－」不會。**
 */
export function hasDayPeak(record: TrafficRecord): boolean {
  return Boolean(record.peaks?.DAY?.start);
}

/**
 * 這一筆紀錄、這個統計範圍，**有沒有值可以顯示**。
 *
 * 只有 DAY 會「算不出來」：調查不足 24 小時，或舊備份還沒重新匯入。
 * 那種情況底層資料是 **0**（`ensureRecordScopes` 補的是空值），不是 null——
 * 畫面若照 0 呈現，折線會掉到零、摘要會寫「全日尖峰 0 PCU/hr」，
 * 看起來像「那一季流量歸零」，事實是「這份調查根本算不出全日尖峰」。
 * **0 會被抄進報告，「－」不會。**
 *
 * ⚠️ 全系統要用同一支判斷。歷季趨勢圖在 v2.1.30／v2.1.31 就是因為自己
 * 沒判斷、直接畫 recordTotal，才把 0 畫了出來；統計範圍切換與路口明細
 * 用的是 hasDayPeak，兩邊講的話不一樣。v2.1.32 起一律走這裡。
 */
export function hasScopeValue(record: TrafficRecord, scope: ScopeKey): boolean {
  return scope !== "DAY" || hasDayPeak(record);
}

/**
 * 把統計範圍的數值轉成可安全呈現在表格／圖表的值。
 *
 * DAY 無法計算時，底層相容欄位仍是 0；匯出若直接寫入 0，Excel 會把它
 * 當成真正的資料點。回傳 null 可讓儲存格保持空白，原生折線圖也會依
 * `dispBlanksAs=gap` 正確斷線。真正算得出的 0 則必須保留。
 */
export function scopeValueOrNull(
  record: TrafficRecord,
  scope: ScopeKey,
  value: number,
): number | null {
  return hasScopeValue(record, scope) ? value : null;
}

/**
 * 全調查時段相關欄位為什麼是「－」。畫面上只寫一句摘要，詳細說明在手冊。
 * 回 null 代表算得出來，沒有理由要說。
 *
 * ⚠️ v2.1.64 起「不足 24 小時」**不再是理由**。
 *   全調查時段就是這份調查涵蓋的時段，4 小時的調查照樣有值；
 *   全調查時段尖峰也照樣算得出來（見 peakWindowsFor）。
 *   現在唯一算不出來的，是資料本身缺了逐時間格。
 */
export function fullDayUnavailableReason(
  record: TrafficRecord,
  scope: ScopeKey,
): string | null {
  if (scope !== "DAY" && scope !== "FULL") return null;
  if (scope === "FULL")
    return Number(record.survey?.minutes || 0) > 0
      ? null
      : "這一筆沒有記錄調查時數，請重新匯入原始檔";
  if (!record.peaks?.DAY?.start)
    /*
     * ⚠️ 這一句會被塞進時段下拉的 <option> 文字裡。
     *   我第一版寫了 38 個字，結果那個 <select> 被撐到 590px 寬，
     *   在 820px 的視窗下整頁橫向溢出 86px（e2e-layout 抓到）。
     *   說明要完整，但**塞進選項的那一份必須短**；完整說明放畫面上的註記。
     */
    return "缺逐時間格資料，需重新匯入";
  return null;
}

/**
 * 一筆紀錄在某個統計範圍底下「涵蓋的時間」要怎麼寫。
 *
 * 尖峰寫挑到的那一小時（07:00–08:00）；全調查時段寫實際調查時數。
 * 算不出來時回 "－"——空白會讓人以為只是還沒載入完。
 *
 * ⚠️ v2.1.64 之前，全調查時段（FULL）在不足 24 小時時寫的是「－」，
 *   等於把「這份調查只做了 4 小時」講成「不知道」。實際涵蓋幾小時是
 *   讀者判讀這個數字**最需要的一件事**，一定要寫出來。
 */
export function scopeWindowLabel(
  record: TrafficRecord,
  scope: ScopeKey,
): string {
  if (scope === "FULL")
    return Number(record.survey?.minutes || 0) > 0
      ? coversFullDay(record.survey)
        ? "24 小時"
        : formatSurveyHours(record)
      : "－";
  const window = record.peaks?.[scope];
  return window?.start && window?.end ? `${window.start}–${window.end}` : "－";
}

/** 「4 小時」「24 小時」這種字樣；沒有調查時數資訊時回「未知時數」。 */
export function formatSurveyHours(record: TrafficRecord): string {
  const minutes = Number(record.survey?.minutes || 0);
  if (!minutes) return "未知時數";
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小時`;
}

export function recordTotal(record: TrafficRecord, peak: ScopeKey) {
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
          /*
           * 舊版寫「以 v1.4.0 重新匯入」。v1.4.0 是 2026-08-11 的版本，
           * 使用者既拿不到、也不該用：計算口徑在 v2.1.30 已經改過
           *（LAST_CALC_CHANGE_VERSION），真照做反而會得到舊口徑的數字。
           */
          "此筆由舊版匯入器建立，缺少可追溯的起點→終點流向；請刪除本筆後，以目前版本重新匯入原始 Excel。",
        resolution: {
          kind: "重新匯入",
          /*
           * ⚠️ 不可以寫成「請重新匯入」就結束。舊版匯入的紀錄還在資料庫裡，
           *   直接再匯一次會被當成同一份調查而併進去，缺的流向不會補回來。
           *   一定要先刪掉那一季。
           */
          text: "畫面上沒有補回流向的方法。請先在本頁「刪除單一季度」刪掉這一季，再到「季度批次匯入」以目前版本重新匯入原始 Excel；不先刪除的話會被當成同一份調查併入，缺的流向補不回來。",
          view: "import",
          viewLabel: "季度批次匯入",
        },
      });
    }
    for (const peak of PEAK_KEYS) {
      /*
       * 尖峰時間落在搜尋範圍外＝資料有問題。範圍不再寫死在這裡，一律讀
       * PEAK_RANGES——以前這裡自己寫了一份 5/12/23，改口徑時很容易只改了
       * 挑選那一邊、忘了這邊，於是每一筆新資料都被自己的檢查判成異常。
       *
       * 全日尖峰（DAY）搜尋範圍就是一整天，不可能落在範圍外，所以只有在
       * 「有 24 小時資料卻沒挑到視窗」時才需要說話——那是格距組不成一小時
       * （例如 2 小時一格），rollingPeak 會回 null。
       */
      const window = record.peaks[peak];
      if (!window?.start) {
        /*
         * ⚠️ 這裡原本是 `peak === "DAY" && coversFullDay(record.survey)`，
         *   2026-09-11 拿掉 24 小時那一半。
         *
         *   v2.1.64 起 4 小時的調查**也算得出**全調查時段尖峰，
         *   所以 4 小時的調查算不出來時同樣是一件該說的事。
         *   舊條件的後果是：使用者的 4 小時資料那一欄整排「－」，
         *   而品質檢查**一聲都不吭**——他只能自己來問為什麼。
         *   實際發生過（2026-09-11）。
         */
        if (peak === "DAY")
          issues.push({
            id: `${record.id}-DAY-missing`,
            severity: "warning",
            category: "尖峰時段異常",
            station: record.station,
            quarter: record.quarter,
            message:
              "有逐時間格的調查資料，但沒有挑出全調查時段尖峰。可能是舊版匯入的資料（重新匯入原始檔即可），或原始檔的時間格距組不成整整一小時（例如 45 分鐘一格）。",
            resolution: {
              kind: "重新匯入",
              text: "兩種成因都要回到原始檔：舊版匯入的直接重新匯入該筆即可；時間格距組不成整整一小時（例如 45 分鐘一格）的，要先把原始檔改成 15／20／30／60 分鐘一格再重新匯入。系統不會自行把不足一小時的量當成一小時的流率。",
              view: "import",
              viewLabel: "季度批次匯入",
            },
          });
        continue;
      }
      const [rangeStart, rangeEnd] = PEAK_RANGES[peak];
      const startMinutes =
        Number(window.start.split(":")[0]) * 60 +
        Number(window.start.split(":")[1] || 0);
      if (startMinutes < rangeStart || startMinutes + 60 > rangeEnd) {
        issues.push({
          id: `${record.id}-${peak}-time`,
          severity: "warning",
          category: "尖峰時段異常",
          station: record.station,
          quarter: record.quarter,
          message: `${SCOPE_LABELS[peak]} ${window.start} 不在預設搜尋範圍（${formatMinutes(rangeStart)}–${formatMinutes(rangeEnd)}）。`,
          resolution: {
            kind: "人工確認",
            /*
             * ⚠️ 這一類**不一定是錯**。搜尋範圍是系統固定的（PEAK_RANGES），
             *   使用者調不了；真實路口的尖峰本來就可能落在範圍邊緣。
             *   所以不可以寫成「請修正」——那會逼使用者去改一份沒有錯的檔。
             */
            text: "這不一定是錯：尖峰搜尋範圍是系統固定的，實際尖峰本來就可能落在邊緣。請到「流量核對工作台」的「原始儲存格與換算來源」核對這一筆的時間欄位——沒寫錯就在報告中註明本季尖峰落在範圍外即可（這一項會持續列出，屬正常）；時間欄位寫錯才需要修正原始檔後重新匯入。",
            view: "audit",
            viewLabel: "流量核對工作台",
          },
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
            message: `${record.approaches[index].name} ${SCOPE_LABELS[peak]} 含非數值欄位。`,
            resolution: {
              kind: "重新匯入",
              text: "原始檔這一格不是數字（常見的是寫了「－」「無」或註記文字）。本系統不提供逐格改值，也不會自行把它當成 0。請到「流量核對工作台」的「原始儲存格與換算來源」找出是哪一個儲存格，在原始檔改成數字後重新匯入該筆。",
              view: "audit",
              viewLabel: "流量核對工作台",
            },
          });
        const m =
          record.approaches[index].movements[peak] || emptyMovement();
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
              message: `${record.approaches[index].name} ${SCOPE_LABELS[peak]}：左直右實際車輛合計 ${turningVehicleTotal.toLocaleString()} 輛/hr，各車種合計 ${classifiedVehicleTotal.toLocaleString()} 輛/hr，差 ${difference.toLocaleString()} 輛/hr。`,
              resolution: {
                kind: "重新匯入",
                text: "這是原始檔裡「兩組數字本身」對不起來（左直右一組、各車種一組），系統不會自行調整任何一邊來湊平。請到「流量核對工作台」的「原始儲存格與換算來源」比對這個方向的兩組欄位，在原始檔更正後重新匯入該筆；只在畫面上操作不會讓這一項消失。",
                view: "audit",
                viewLabel: "流量核對工作台",
              },
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
        resolution: {
          kind: "重新匯入",
          /*
           * ⚠️ 本系統**沒有**手動填調查日期的欄位（查過：畫面上只有資料別
           *   平日／假日可以改，日期不行）。所以不可以寫「請到某頁補上日期」——
           *   那會讓使用者去找一個不存在的欄位。
           */
          text: "本系統沒有手動填調查日期的欄位。請在原始檔的交通量工作表標題區把調查日期寫成可辨識的格式（例：115年3月12日），再重新匯入該筆。附註：「資料別（平日／假日）」可以在「流量核對工作台」直接指定，但那是另一件事，指定資料別不會讓這一項消失。",
          view: "import",
          viewLabel: "季度批次匯入",
        },
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
      for (const peak of SCOPE_KEYS) {
        /*
         * 沒有這個範圍的資料就跳過——不足 24 小時的調查，DAY 與 FULL 整組
         * 是空的，兩邊都是 0、差值也是 0，跑下去只是白跑；但如果哪天其中
         * 一邊有值另一邊沒有，那就是真的脫鉤，仍然要被抓出來。
         */
        const movementTotal = record.approaches.reduce(function (sum, approach) {
          return sum + totalMovement(approach, peak);
        }, 0);
        const routeTotal = record.routes.reduce(function (sum, route) {
          return sum + Number(route.volumes[peak]?.pcu || 0);
        }, 0);
        if (!movementTotal && !routeTotal) continue;
        const difference = round1(movementTotal - routeTotal);
        // 兩邊都做到小數一位，容差取 0.11 與 conservationCheck 一致。
        if (Math.abs(difference) >= 0.11)
          issues.push({
            id: `${record.id}-${peak}-conservation`,
            severity: "error",
            category: "總數不一致",
            station: record.station,
            quarter: record.quarter,
            message: `${SCOPE_LABELS[peak]}：路口轉向總量 ${movementTotal.toLocaleString()} ${scopeUnit(peak)} 與逐條流向加總 ${routeTotal.toLocaleString()} ${scopeUnit(peak)} 相差 ${difference.toLocaleString()} ${scopeUnit(peak)}。常見原因是刪除支線後未重算，請到「流量核對工作台」確認。`,
            resolution: {
              kind: "畫面修正",
              /*
               * ⚠️ 標成「畫面修正」的前提是**真的改得掉**：
               *   「重新套用」走的是與匯入相同的那兩支，會把 approaches 與
               *   routes 一起重建，所以脫鉤確實會消失。
               *   但舊版匯入的紀錄沒有 sourcePreview，重算不了——那一半
               *   一定要講出來，不然使用者會一直按一顆對他無效的按鈕。
               */
              text: "先到「流量核對工作台」的「OD 流量表」看是哪一個時段對不上。若是刪除支線後沒有重算，到「車種轉向當量」按「重新套用」用目前的歸類與係數重算這一季即可（重算會同時重建轉向與流向，兩邊就會一致）。⚠️ 舊版匯入、沒有留下逐格原始資料的那幾筆重算不了，只能重新匯入該季。",
              view: "audit",
              viewLabel: "流量核對工作台",
            },
          });
      }
  }
  return issues;
}

export type IntervalRow = {
  start: number;
  label: string;
  values: number[];
  /** One-based source row for each contributing worksheet. */
  sourceRows?: Record<string, number>;
};

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

/**
 * 一次算出三個尖峰的視窗——**全系統只有這一支**。
 *
 * 匯入預覽（inspectWorkbook）與換過當量係數後的重算（configuredImportPreview）
 * 都走這裡，所以兩邊不可能挑到不同的視窗。以前那兩處各寫一次 rollingPeak，
 * 要新增一個時段就得記得兩邊都補。
 *
 * @param surveyMinutes 這份調查總共涵蓋幾分鐘。不足 24 小時時 DAY 一律是 null：
 *   只做了 4 小時（例如 07–09＋17–19）卻回報一個「全日尖峰」，那個數字必然
 *   等於上午與下午尖峰裡較大的一個，看起來像新資訊其實不是，還會被當成
 *   整天的最大值寫進報告。
 */
/*
 * ══════════════════════════════════════════════════════════════════════
 *  橫跨中午的尖峰小時：程式不自己決定，問使用者
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12 的定案（他一度要求上午／下午可自行設定，討論後收回）：
 *   「回歸以前作法，不確定時，就是跳出視窗詢問使用者。」
 *   「如果有15分鐘滾動去計算1小時的當量時，其實也會遇到，真的有這個類型的
 *     時段發生時(11:15~12:15之類)，就跳出詢問視窗。」
 *
 * ⚠️ 為什麼非做不可：AM 只在 [00:00, 12:00) 裡找、PM 只在 [12:00, 24:00) 裡找，
 *   而且要求**整個視窗**都落在範圍內（v2.1.36 修過的規則）。於是真正最忙的
 *   那一小時如果橫跨中午（11:45–12:45），**兩邊都挑不到它**——AM 會報一個
 *   比較小的時段，而畫面上完全看不出來少報了什麼。
 *
 * ⚠️ 這不是「界線設錯」，改界線也解決不了（不管切在哪裡，都可能有一個視窗
 *   剛好跨過那條線）。唯一誠實的作法是把它挑出來、問人。
 */
export const NOON_MINUTES = 12 * 60;

/** 使用者對「橫跨中午的那一小時」的決定。 */
export type NoonSide = "am" | "pm" | "ignore";

export type NoonStraddleInfo = {
  /** 橫跨中午的那個視窗 */
  window: NonNullable<ReturnType<typeof rollingPeak>>;
  /** 不算它的話，AM／PM 各自會是哪一個視窗 */
  amBest: ReturnType<typeof rollingPeak>;
  pmBest: ReturnType<typeof rollingPeak>;
};

/**
 * 找出「橫跨中午、而且是這一份調查裡最忙的那一小時」。
 *
 * 回傳 null 代表不必問：要嘛沒有跨中午的完整視窗，要嘛它不是最忙的那一小時
 * （不是最忙的話，怎麼歸類都不會改變 AM／PM 任何一欄的數字，問了只是打擾）。
 */
export function noonStraddle(
  rows: IntervalRow[],
  intervalMinutes: number,
  weights?: number[],
): NoonStraddleInfo | null {
  if (!rows.length || !intervalMinutes) return null;
  let best: ReturnType<typeof rollingPeak> = null;
  for (const row of rows) {
    // 整個視窗要真的跨過中午：起點在 11:00 之後、12:00 之前。
    if (row.start <= NOON_MINUTES - 60 || row.start >= NOON_MINUTES) continue;
    const window = rollingPeak(
      rows,
      [row.start, row.start + 60],
      intervalMinutes,
      weights,
    );
    if (!window) continue;
    if (window.start !== row.start || window.end !== row.start + 60) continue;
    if (!best || window.total > best.total) best = window;
  }
  if (!best) return null;
  const dayBest = rollingPeak(rows, PEAK_RANGES.DAY, intervalMinutes, weights);
  /*
   * ⚠️ 條件是「它是這一份調查最忙的那一小時」，不是「它比 AM、PM 都大」。
   *   原始檔的時間格本身錯開時（整份寫成 11:30～12:30），那一格的起點在
   *   中午以前，**本來就已經是 AM Peak**——用「比 AM 大」當條件永遠不成立，
   *   於是永遠不會問，而那正是唯一需要人決定的地方。
   */
  if (dayBest && best.total < dayBest.total - 1e-9) return null;
  return {
    window: best,
    amBest: rollingPeak(rows, PEAK_RANGES.AM, intervalMinutes, weights),
    pmBest: rollingPeak(rows, PEAK_RANGES.PM, intervalMinutes, weights),
  };
}

export function peakWindowsFor(
  rows: IntervalRow[],
  intervalMinutes: number,
  weights: number[] | undefined,
  surveyMinutes: number,
  /*
   * 使用者對「橫跨中午的那一小時」的決定。
   * ⚠️ 省略＝沒有決定＝與 v2.1.67 以前逐格相同。
   */
  noonSide?: NoonSide,
): Record<PeakKey, ReturnType<typeof rollingPeak>> {
  /*
   * ⚠️ v2.1.64 起 DAY **不再卡 24 小時**。
   *
   * 舊版的理由（寫在下面那段 JSDoc 裡）是：4 小時的調查算出來的「全日尖峰」
   * 必然等於 AM／PM 兩個尖峰裡較大的那一個，看起來像新資訊其實不是，
   * 還會被當成整天的最大值寫進報告。**那個理由在名字叫「全日尖峰」時是對的。**
   *
   * 改名成「全調查時段尖峰」之後就不成立了：它宣告的是「這份調查涵蓋的時段裡，
   * 流量最大的那一小時」，4 小時的調查算出這個值是誠實的。
   *
   * ⚠️ 安全性由 rollingPeak 自己保證，不在這裡另外擋：
   *   它要求視窗的 60 分鐘由**相接的**原始格組成
   *  （`r.start - slice[i-1].start !== intervalMinutes` 就跳過），
   *   所以 07–09＋17–19 這種兩段式調查，視窗不可能橫跨中間那八小時的空隙。
   *   要改這裡之前先確認那一段還在，否則會算出一個橫跨空隙的假尖峰。
   *
   * surveyMinutes 現在只用來標示涵蓋（單位要寫「調查日」還是「調查時段」），
   * 不再參與 DAY 算不算得出來的判斷。
   */
  void surveyMinutes;
  /*
   * ── 使用者對「橫跨中午的那一小時」的決定 ──────────────────
   *
   * 沒有決定（或決定「忽略」）時，這一段完全不動作，結果與 v2.1.67 逐格相同。
   *
   * ⚠️ 指派給一邊之後，**另一邊的搜尋範圍要往外縮**，不可以讓兩個尖峰
   *   共用同一段時間的車流。例如把 11:45–12:45 判給 AM，PM 就只能從 12:45
   *   之後開始找——否則 12:00–13:00 會把 12:00～12:45 那三格再算一次，
   *   兩個數字各自看都對，放在一起是重複計算。
   */
  let amRange = PEAK_RANGES.AM;
  let pmRange = PEAK_RANGES.PM;
  let amOverride: ReturnType<typeof rollingPeak> = null;
  let pmOverride: ReturnType<typeof rollingPeak> = null;
  if (noonSide === "am" || noonSide === "pm") {
    const straddle = noonStraddle(rows, intervalMinutes, weights);
    if (straddle) {
      if (noonSide === "am") {
        amOverride = straddle.window;
        pmRange = [straddle.window.end, PEAK_RANGES.PM[1]];
      } else {
        pmOverride = straddle.window;
        amRange = [PEAK_RANGES.AM[0], straddle.window.start];
      }
    }
  }
  return {
    AM: amOverride ?? rollingPeak(rows, amRange, intervalMinutes, weights),
    PM: pmOverride ?? rollingPeak(rows, pmRange, intervalMinutes, weights),
    /* 全調查時段尖峰與上午／下午怎麼分無關，永遠掃一整天。 */
    DAY: rollingPeak(rows, PEAK_RANGES.DAY, intervalMinutes, weights),
  };
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  各支線「各自認定自己的尖峰」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 指定主工具列要有「尖峰時段判定方式」，兩種：
 *   ・整個調查點同一時段（可相加）  ← 既有行為，peakWindowsFor 算的那一個
 *   ・各方向各自認定自己的尖峰      ← 這一支
 *
 * ⚠️ 兩種算出來的數字**本來就不一樣**，而且「各方向各自認定」那一組
 *   **各方向不可以相加**——各支線的尖峰小時不同，加起來不對應任何一個真實小時。
 *   凡是顯示這一組數字的地方都要寫明，否則會被當成同一小時的合計抄進報告。
 *
 * ⚠️ 只讀 record.sourceIntervals，**不新增任何解析邏輯**。
 *   那份資料是使用者 2026-09-12 指定要留下來的原料
 *  （「不論未來有沒其他重算功能……不需要使用者把所有計畫都重新匯入一次」），
 *   v2.1.67 起的匯入都有；更早的紀錄沒有，呼叫端要擋下來並說明，
 *   **不可以回 0**——0 會被當成「真的沒有車」抄走。
 *
 * ⚠️ 挑視窗用的權重與既有做法完全相同（pceFactor × 該欄的車種與轉向），
 *   差別只在「別支線的欄位權重給 0」。所以同一支支線在
 *  「整個路口同一時段」與「自己認定」下挑到同一小時時，兩邊的數字必然相同——
 *   這一點有單元測試守著。
 */
export type ApproachPeakCell = {
  movement: MovementKey;
  vehicle: PceVehicle;
  destination?: string;
  count: number;
};
export type ApproachPeakBreakdown = {
  /** 這一支支線自己的尖峰小時；算不出來時是 null（資料格距不整除一小時等）。 */
  window: { start: number; end: number } | null;
  cells: ApproachPeakCell[];
  /** 這一支在自己的尖峰小時內的 PCU 與實際車輛數。 */
  pcu: number;
  vehicles: number;
};

export function approachPeakBreakdown(
  source: {
    intervalMinutes: number;
    columns: Array<{
      approach: string;
      vehicle: string;
      movement: string;
      destination?: string;
    }>;
    rows: Array<{ start: number; label: string; values: number[] }>;
  },
  pce: PceMatrix,
  peak: PeakKey,
): Record<string, ApproachPeakBreakdown> {
  const approaches = [
    ...new Set(
      source.columns.map((column) => column.approach).filter(Boolean),
    ),
  ];
  const out: Record<string, ApproachPeakBreakdown> = {};
  for (const approach of approaches) {
    /*
     * ⚠️ 別支線的權重給 0，不是把那幾欄拿掉。
     *   拿掉會讓欄位索引整個位移，best.values 就對不回原本的欄。
     */
    const weights = source.columns.map((column) =>
      column.approach === approach
        ? pceFactor(
            pce,
            column.vehicle as PceVehicle,
            (column.movement || "through") as MovementKey,
          )
        : 0,
    );
    const best = rollingPeak(
      source.rows,
      PEAK_RANGES[peak],
      source.intervalMinutes,
      weights,
    );
    if (!best) {
      out[approach] = { window: null, cells: [], pcu: 0, vehicles: 0 };
      continue;
    }
    const cells: ApproachPeakCell[] = [];
    let pcu = 0;
    let vehicles = 0;
    source.columns.forEach((column, index) => {
      if (column.approach !== approach) return;
      const count = Number(best.values[index]) || 0;
      const movement = (column.movement || "through") as MovementKey;
      cells.push({
        movement,
        vehicle: column.vehicle as PceVehicle,
        ...(column.destination ? { destination: column.destination } : {}),
        count,
      });
      vehicles += count;
      pcu += count * pceFactor(pce, column.vehicle as PceVehicle, movement);
    });
    out[approach] = {
      window: { start: best.start, end: best.end },
      cells,
      pcu: roundedPcu(pcu),
      vehicles,
    };
  }
  return out;
}

/**
 * 把一筆紀錄改成「各支線各自認定自己的尖峰」的版本。
 *
 * ⚠️ **回傳新的一份，原始紀錄一個欄位都不碰。**
 *   下游有幾十個地方讀 record.routes[].volumes[peak]；就地改的話，
 *   使用者把判定方式切回去時那些數字回不來，而且會被存進本機資料。
 *
 * ⚠️ 沒有 sourceIntervals（v2.1.67 以前匯入的）時回 null，**不是回 0**。
 *   呼叫端要據此把選項停用並說明「請重新匯入原始檔」。
 *   回 0 的話畫面會顯示「0 輛」，而 0 會被當成「真的沒有車」抄進報告。
 *
 * ⚠️ FULL（全調查時段）不是一個「尖峰小時」，沒有視窗可挑，
 *   所以這個判定方式對它沒有意義——直接回 null，由呼叫端說明。
 */
export function recordWithApproachPeaks(
  record: TrafficRecord,
  peak: ScopeKey,
): {
  record: TrafficRecord;
  /** 每一支支線自己的尖峰小時；null＝那一支算不出來。 */
  windows: Record<string, { start: number; end: number } | null>;
} | null {
  if (peak === "FULL") return null;
  const source = record.sourceIntervals;
  if (!source || !source.rows?.length || !source.columns?.length) return null;
  const pce = record.pceUsed || DEFAULT_PCE;
  const breakdown = approachPeakBreakdown(source, pce, peak);
  /*
   * 一支都算不出視窗（格距組不成一小時）時就當作不支援，
   * 不要回一份全是 0 的紀錄。
   */
  const usable = Object.values(breakdown).filter((item) => item.window);
  if (!usable.length) return null;

  const next = structuredClone(record);
  const codeOf = (approachId: string) => {
    const approach = next.approaches.find((item) => item.id === approachId);
    return approach?.sourceCode || "";
  };
  next.routes?.forEach((route) => {
    const fromCode = codeOf(route.fromApproachId);
    const toCode = codeOf(route.toApproachId);
    const arm = breakdown[fromCode];
    if (!arm || !arm.window) {
      /*
       * 這一支算不出自己的尖峰。**不可以沿用整路口的視窗**——
       * 那會讓同一張表裡有些數字是「自己的尖峰」、有些是「整路口的尖峰」，
       * 而畫面上只寫著一種判定方式。清成 0 並由呼叫端說明哪幾支算不出來。
       */
      route.volumes[peak] = { pcu: 0, vehicle: {} };
      return;
    }
    const vehicle: Record<string, number> = {};
    let pcu = 0;
    for (const cell of arm.cells) {
      if (cell.movement !== route.movement) continue;
      /* OD 格式的欄位帶著目的支線；轉向格式沒有，靠 movement 就唯一。 */
      if (cell.destination && cell.destination !== toCode) continue;
      vehicle[cell.vehicle] = (vehicle[cell.vehicle] || 0) + cell.count;
      pcu += cell.count * pceFactor(pce, cell.vehicle, cell.movement);
    }
    route.volumes[peak] = { pcu: roundedPcu(pcu), vehicle };
  });
  const windows: Record<string, { start: number; end: number } | null> = {};
  for (const [code, item] of Object.entries(breakdown))
    windows[code] = item.window;
  return { record: next, windows };
}

/**
 * 只看某一個轉向（左轉／直行／右轉）的版本。
 *
 * ⚠️ **不是把不符合的流向刪掉**，是把它們的量歸零。
 *   刪掉的話，下游用支線去找流向的地方（駛入／駛出、OD 矩陣的欄列）
 *   會少掉整條，表格結構就跟著變形；歸零則是「這個轉向這一格沒有量」，
 *   結構完全不動，使用者一眼看得出哪幾格被篩掉了。
 *
 * ⚠️ 四個統計範圍**全部**都要歸零。只歸零目前看的那一個的話，
 *   換一個時段就會突然冒出沒被篩掉的數字。
 *
 * ⚠️ movement === "all" 時原封不動回傳**原物件**（不是複製品），
 *   既有的 memo 才不會每次都失效。
 */
export function recordWithMovementFilter(
  record: TrafficRecord,
  movement: "all" | MovementKey,
): TrafficRecord {
  if (movement === "all") return record;
  if (!record.routes?.length) return record;
  const scopes = ["AM", "PM", "DAY", "FULL"] as ScopeKey[];
  const next = structuredClone(record);
  next.routes?.forEach((route) => {
    if (route.movement === movement) return;
    for (const key of scopes) route.volumes[key] = { pcu: 0, vehicle: {} };
  });
  /*
   * ── 支線的 movements 也要跟著歸零 ────────────────────────────
   *
   * ⚠️ 這一段是 2026-09-14 實測補上的，**沒有它就是算錯**。
   *
   *   第一版只歸零 route.volumes。但 recordTotal()／totalMovement() 讀的是
   *   approach.movements，不是 routes。於是「只看左轉」時：
   *     ・逐條流向的表（駛入／駛出、OD、核對工作台）＝ 1,573.4（左轉）
   *     ・同一畫面上的「路口總量」＝ 5,413.1（全部轉向，**沒被篩到**）
   *   兩個數字並排放在同一頁，而且都沒有任何標示。實測數字就是這兩個。
   *
   *   左／直／右三個欄位本來就是分開存的，所以這裡是**精確歸零**，
   *   不是重算、也不是估計。
   *
   * ⚠️ 逐車種的輛數（movements[key].vehicle）只能從 routes 重建。
   *   AM／PM／全日尖峰的 row.vehicle 是匯入時由尖峰視窗的原始格子算的，
   *   本來就不保證與 routes 加總完全相同（既有的品質檢查容許 5 輛或 5%
   *   的落差）。但篩了轉向之後，「這個轉向有幾輛」只有 routes 講得出來，
   *   拿沒篩過的 row.vehicle 充數會讓車輛數欄整個不跟著篩——
   *   那比小幅落差嚴重得多。
   */
  next.approaches.forEach((approach) => {
    for (const key of scopes) {
      const row = approach.movements[key];
      if (!row) continue;
      for (const other of ["left", "through", "right"] as MovementKey[])
        if (other !== movement) row[other] = 0;
      const vehicle: Record<string, number> = {};
      next.routes
        ?.filter(
          (route) =>
            route.fromApproachId === approach.id &&
            route.movement === movement,
        )
        .forEach((route) => {
          for (const [id, count] of Object.entries(
            route.volumes[key]?.vehicle || {},
          ))
            vehicle[id] = Number(vehicle[id] || 0) + (Number(count) || 0);
        });
      row.vehicle = vehicle;
    }
  });
  return next;
}

/**
 * 只留下一個車種的顯示用紀錄。
 *
 * ⚠️ 這**不是**另寫一套換算。PCU 用的是 syncRouteTotals 建立 route PCU 時
 *   完全同一支 pceFactor 與同一組係數（record.pceUsed），只是把加總範圍
 *   縮到一個車種。逐條流向齊全時，各車種算出來的加總就等於已存的總 PCU。
 *
 * ⚠️ 支線的 movements **一定要跟著重建**。
 *   recordTotal()／totalMovement() 讀的是 approach.movements，不是 routes；
 *   只改 routes 的話，同一個畫面上逐支線的表是單一車種、
 *   「路口總量」卻還是全車種——兩個數字並排，都沒有標示。
 *  （轉向別篩選就踩過這個坑，2026-09-14 實測抓到。）
 *
 * ⚠️ 沒有逐條流向的舊紀錄**原封不動回傳**。
 *   系統只存「每個轉向的總 PCU」與「每個車種的車輛數」，
 *   沒有流向就對不起車種與轉向，任何拆法都是猜的。
 *   呼叫端必須用 canSplitByVehicle() 判斷並在畫面上講出來，
 *   不可以讓使用者看著一個沒被篩到的數字以為篩過了。
 *
 * ⚠️ vehicle === "all" 時回傳**原物件**（不是複製品），既有的 memo 才不會失效。
 */
export function canSplitByVehicle(record: TrafficRecord) {
  return Boolean(record.routes?.length);
}

export function recordWithVehicleFilter(
  record: TrafficRecord,
  vehicle: string,
): TrafficRecord {
  if (!vehicle || vehicle === "all") return record;
  if (!record.routes?.length) return record;
  const scopes = ["AM", "PM", "DAY", "FULL"] as ScopeKey[];
  const pce = record.pceUsed || DEFAULT_PCE;
  const next = structuredClone(record);
  next.routes?.forEach((route) => {
    for (const key of scopes) {
      const count = Number(route.volumes[key]?.vehicle?.[vehicle] || 0);
      route.volumes[key] = {
        pcu: roundedPcu(count * pceFactor(pce, vehicle, route.movement)),
        vehicle: count ? { [vehicle]: count } : {},
      };
    }
  });
  next.approaches.forEach((approach) => {
    for (const key of scopes) {
      const row = approach.movements[key];
      if (!row) continue;
      const totals = { left: 0, through: 0, right: 0 };
      let count = 0;
      next.routes
        ?.filter((route) => route.fromApproachId === approach.id)
        .forEach((route) => {
          totals[route.movement] += route.volumes[key].pcu;
          count += Number(route.volumes[key].vehicle[vehicle] || 0);
        });
      row.left = roundedPcu(totals.left);
      row.through = roundedPcu(totals.through);
      row.right = roundedPcu(totals.right);
      row.vehicle = count ? { [vehicle]: count } : {};
      if (row.rawVehicleTotal !== undefined) row.rawVehicleTotal = count;
    }
  });
  return next;
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
  /**
   * 站號是從哪裡判定的。
   * `workbook` 讀自檔案內的「站號：」欄位（可靠）；`filename` 是檔案裡沒有
   * 站號欄位、退而從檔名推出來的（需要人工核對）；`none` 是兩邊都讀不到。
   * 匯入預覽要據此提醒使用者哪些站號需要確認。
   */
  stationSource: "workbook" | "filename" | "none";
  name: string;
  role: "原始交通量" | "參考計算檔" | "非路口轉向" | "無法辨識";
  /** 為什麼判成這個角色，以及使用者可以怎麼處理。用於匯入失敗時的說明。 */
  roleReason?: string;
  /**
   * 這一份檔案被**擋下不寫入**的原因（與角色無關）。
   *
   * 2026-09-18 使用者裁示（F-11）：同一張表兩個欄群讀到同一個路口編號、同一欄群
   * 兩欄同名、同一支線時距重複——這些是原始檔的錯，系統不替使用者決定要留哪一筆、
   * 也不再「警告後照樣相加寫入」（X-66 原本的做法）。改成擋下，並把「哪一張工作表、
   * 哪幾個欄位」寫清楚，請使用者核對原始檔後重新匯入。交通服務水準 X-65 同一條標準。
   */
  blockReason?: string;
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
  /**
   * 三個尖峰各自挑到的那一小時。用 Record 而不是 am/pm/day 三個欄位，是為了讓
   * 下游一律寫 `preview.peakWindows[key]`——以前寫成 `key === "AM" ? item.am : item.pm`
   * 的地方有兩處，多一個時段就要記得兩邊都改，漏一邊就是「同一件事在不同畫面
   * 說不同話」。
   *
   * DAY 只有 24 小時的調查檔才會有值（coversFullDay），否則是 null。
   */
  peakWindows: Record<PeakKey, ReturnType<typeof rollingPeak>>;
  /*
   * 這一份調查裡「最忙的那一小時剛好橫跨中午」時的資訊；沒有就是 undefined。
   *
   * ⚠️ 有值代表**必須問使用者**才能決定 AM／PM（見 noonStraddle 的說明）。
   *   把「要問什麼、不問的話會是什麼」一起帶出來，畫面才給得出判斷依據——
   *   只丟四個選項而不給數字，使用者無從決定。
   */
  noonQuestion?: {
    label: string;
    total: number;
    amLabel: string;
    amTotal: number;
    pmLabel: string;
    pmTotal: number;
  };
  /** 使用者的決定；還沒問或選「忽略」時是 "ignore"／undefined。 */
  noonSide?: NoonSide;
  /** 使用者選了「取消，這一份不要匯入」。 */
  noonSkip?: boolean;
  date: string;
  dateSource: { sheet: string; cell: string; raw: string } | null;
  /**
   * 表頭裡所有「像日期」的儲存格（本工作表優先）。只給期別檢查用。
   * date／dateSource 的意義與取法完全不變，這一欄是額外附上的候選清單。
   */
  dateCandidates?: Array<{ text: string; sheet: string; cell: string }>;
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
    /*
     * 這一欄在整份調查裡出現過幾格數字、幾格橫線佔位符（`--`／`—`／`–`／`－`）。
     *
     * 為什麼要分開記：調查表用兩種寫法表達兩件不同的事——
     *   `0`  ＝ 這個轉向存在，只是整天量到 0
     *   `--` ＝ 這個路口根本沒有這個轉向
     * 解析出來的**數值兩者都是 0**（這一點刻意不改，改了就是動計算），
     * 所以只看數值永遠分不出來。
     *
     * 實測：三份真實三岔檔各有剛好 12 欄是「一格數字都沒有、全是橫線」
     * （3 支線 × 1 個不存在的轉向 × 4 車種）；而四岔／七岔檔是 0 欄，
     * 卻各有 6～9 欄是**真的整天量到 0**（例：後昌路－宏毅二路假日 9 欄、
     * 中山北路－岡山路口七叉 路口A 9 欄）。只憑「全為 0」判斷會刪掉真實資料。
     */
    numericCells: number;
    placeholderCells: number;
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
 * 系統使用包內已雜湊驗證的 SheetJS 官方 0.20.3；這層防禦仍保留，避免安全性只依賴
 * 第三方套件版本，也保護後續以檔案文字建立物件鍵的應用程式程式碼。
 */
export function safeObjectKey(key: string): string {
  return key === "__proto__" || key === "constructor" || key === "prototype"
    ? "_" + key + "_"
    : key;
}

/*
 * ────────────────────────────────────────────────────────────────
 *  試算表解析的額外安全邊界
 * ────────────────────────────────────────────────────────────────
 *
 * 套件使用包內已雜湊驗證的 SheetJS 官方 0.20.3，不應為了改用 npm registry 而降回
 * 0.18.5。即使使用修正版，使用者上傳的工作表名稱與欄位文字仍是不可信輸入，
 * 所以在應用程式邊界保留下列兩層檢查。
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
 * 這不能取代套件維護，但可把「無聲被污染」變成「當場中止並告知」。
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
  const dayTypeTrafficSheets = workbook.SheetNames.filter(isDayTypeSheetName);
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
  /*
   * 實際紀錄日期與期別檢查必須使用同一支選擇器。舊版兩條路徑分開：紀錄取
   * 第一個像日期的格子，期別檢查卻優先取明確標示的調查日期，因此同一份檔案
   * 可能得到兩個日期。先在本次交通工作表範圍挑選；找不到才退回整份活頁簿。
   */
  const scopedDateCells = cells.filter(function (item) {
    return !options?.trafficSheets || options.trafficSheets.includes(item.sheet);
  });
  const foundDate = findSurveyDate(scopedDateCells) || findSurveyDate(cells);
  const dateText = foundDate?.raw || "";
  /* 只把正式採用的同一格交給畫面做期別檢查，避免兩條路徑再次分岔。 */
  const dateCandidates = foundDate
    ? [{ text: foundDate.raw, sheet: foundDate.sheet, cell: foundDate.cell }]
    : [];
  const intervalMap = new Map<number, IntervalRow>();
  const detectedColumns: ImportPreview["columns"] = [];
  const originOrder: string[] = [];
  /* 從檔案讀不到、由系統依出現順序推定的支線代碼，匯入預覽要提醒使用者確認。 */
  const inferredApproachCodes = new Set<string>();
  /* 有內容但不是數字的格子（空白格不算）。舊版一律當 0，使用者不會知道。 */
  const nonNumericCells: string[] = [];
  /* 同一種原文歸併計數，避免整欄寫「-」時警告被同一句洗版。 */
  const nonNumericTexts = new Map<string, number>();
  /*
   * ⚠️ X-66：重複的東西一律要出聲，不可以靜靜挑一個／蓋掉／相加。
   *
   * 這一支原本三種重複全都是安靜的：
   *   ・兩個欄群都讀到同一個「路口編號：A」→ 兩支支線的量被加成一支，
   *     畫面上只看得到一支 A，沒有任何提示。
   *   ・同一個欄群裡兩欄完全同名（例如兩欄「機車｜左轉」）→ 相加。
   *   ・同一張表裡同一個時間值出現兩次 → 後者蓋掉前者，**連「這個數字
   *     出自第幾列」的追溯記錄一起被蓋掉**，逐格追溯會指到錯的列。
   * 交通服務水準那一支（X-65）已經是「看到兩個就報錯」，三支要同一條標準。
   *
   * 這裡只**指出**，不替使用者決定要留哪一筆——與整支程式一致。
   */
  const duplicateApproachCodes = new Set<string>();
  /** 每一個讀到的支線代碼出現在哪一張表的哪幾欄（給擋下訊息用）。 */
  const approachCodePlaces = new Map<string, string[]>();
  const duplicateColumnLabels = new Map<string, Set<string>>();
  const duplicateIntervals = new Map<string, Set<string>>();
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
      /*
       * 支線代碼讀不到時仍要給一個值——全部給空字串的話多支線模型會塌成
       * 一支，整個路口建不起來。但**不能悄悄捏造**：推定出來的 A1、A2 和
       * 真實代碼（正規式是 [A-Z0-9]+，本來就允許 A1 這種寫法）在畫面與匯出
       * 上分不出來，而它是跨季幾何繼承、轉向繼承與參考轉向表比對的鍵。
       * 同一路口兩季若一季讀得到、一季讀不到，兩季的支線會對不起來而靜靜
       * 繼承失敗。所以推定歸推定，但要記下來並在預覽提醒使用者確認。
       */
      const readCode = sourceCode(
        sheet,
        timeColumn.firstDataRow - 1,
        timeColumn.column,
        blockEnd,
        sheetName,
      );
      const origin = readCode || `A${originOrder.length + 1}`;
      if (!readCode) inferredApproachCodes.add(origin);
      /*
       * ⚠️ 讀到的代碼撞號＝**兩個欄群自稱是同一支支線**。
       *   下游一律「篩出 approach === 這個名字的欄位再加總」，所以撞號的結果
       *   是那一支的量變成兩支相加，而畫面上只有一支。推定出來的代碼不算
       *   （A1、A2 是依序給的，本來就不會撞），只認檔案自己寫的。
       */
      if (readCode && originOrder.includes(origin))
        duplicateApproachCodes.add(origin);
      if (readCode) {
        const places = approachCodePlaces.get(origin) || [];
        places.push(
          `「${sheetName}」第 ${XLSX.utils.encode_col(timeColumn.column)}～${XLSX.utils.encode_col(blockEnd)} 欄`,
        );
        approachCodePlaces.set(origin, places);
      }
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
      /*
       * ⚠️ 同一個欄群裡兩欄**完全同名**＝調查表打錯字（或多貼了一欄）。
       *   舊版兩欄各自取值，下游把同一個（車種×流向）的欄位一起加總，
       *   於是那一格的數字憑空變成兩欄相加，畫面上看不出來。
       *   只比對欄名相同的情形——合併儲存格造成的「同一欄被讀兩次」不會
       *   走到這裡（那是同一個 col），所以不會誤報。
       */
      {
        const seenLabels = new Set<string>();
        for (const candidate of candidates) {
          if (seenLabels.has(candidate.label)) {
            const bucket =
              duplicateColumnLabels.get(origin) || new Set<string>();
            bucket.add(candidate.label);
            duplicateColumnLabels.set(origin, bucket);
          }
          seenLabels.add(candidate.label);
        }
      }
      const distinctHeaderVehicles = new Set(
        candidates.map(function (candidate) {
          return candidate.headerVehicle.id;
        }),
      ).size;
      /*
       * 依「欄位位置」推定車種只用來救一種情況：表頭寫的**就是**四個內建車種、
       * 只是順序亂掉或有殘留的舊值。實測 11017T1501 七叉路口的合併儲存格裡
       * 就藏著沒清乾淨的「大型車」，位置推定在那裡是對的。
       *
       * 但表頭若寫的是「大貨車」「大客車」這種不在內建對照表裡的車種，
       * 那是使用者自己的車種分類，不該由系統依位置替他決定歸到哪一類——
       * 「大客車」排在第 4 欄就被當成特種車（當量 2.5），
       * 但大客車在工程上通常算大型車（1.5），系統沒有立場替他選。
       * 全日交通量對這種欄位是保留成自訂車種、由使用者自行歸類的，
       * 這裡改成同一套做法：**表頭有非內建車種時就以表頭為準**。
       */
      const headerVehiclesAreAllCore = candidates.every(function (candidate) {
        return Boolean(CORE_VEHICLE_LABELS[candidate.headerVehicle.id]);
      });
      const usePositionalVehicles =
        candidates.length >= 8 &&
        candidates.length % 4 === 0 &&
        distinctHeaderVehicles === 4 &&
        headerVehiclesAreAllCore;
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
          /* 逐格累計，見型別上的說明；讀值的流程完全不變。 */
          numericCells: 0,
          placeholderCells: 0,
        };
        detectedColumns.push(column);
        blockColumns.push(column);
      });
      /** 這一個欄群已經看過的時距（重複偵測的範圍，見下方說明）。 */
      const blockSeenIntervals = new Set<number>();
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
        /*
         * ⚠️ 同一個欄群裡同一個時距出現兩次＝調查表重複列（或時間打錯）。
         *
         * 底下的 `interval.values[...] = ...` 是**指派**不是累加，
         * 後一列會無聲蓋掉前一列；而且 sourceRows 也被一起蓋掉，
         * 於是「逐格追溯」會指到錯的那一列——追溯功能本身在說謊。
         *
         * ⚠️ 判斷的範圍必須是**這一個欄群**，不可以用
         *   `interval.sourceRows[sheetName] !== undefined` 去判。
         *   intervalMap 以「開始分鐘」為鍵，本來就是要讓同一張表的各支線
         *   欄群合併成同一列——那是正常行為，用工作表當範圍會把
         *   「第二支支線也有 07:00」誤報成重複，每一份多支線的檔案都會中。
         */
        if (blockSeenIntervals.has(start)) {
          const bucket = duplicateIntervals.get(sheetName) || new Set<string>();
          bucket.add(`${origin}｜${String(cell)}`);
          duplicateIntervals.set(sheetName, bucket);
        }
        blockSeenIntervals.add(start);
        interval.sourceRows![safeObjectKey(sheetName)] = row + 1;
        blockColumns.forEach(function (column) {
          const value =
            sheet[XLSX.utils.encode_cell({ r: row, c: column.sourceColumn })]
              ?.v;
          /*
           * 每一格的車輛數先四捨五入成整數，再拿去做後面所有計算。
           *
           * 起因：使用者的 06525T2503 調查檔裡，儲存格存的是小數
           * （0.36、5.5506 …），Excel 的格式把它顯示成整數，於是報告上
           * 看到的是 0 與 6，程式拿去算的卻是 0.36 與 5.5506。全日車輛數
           * 因此算出 27,988.79 輛——一個不存在的車。PCU 也跟著帶小數。
           *
           * 依使用者決定：以「畫面上看到的整數」為準。四捨五入放在這裡
           * ——**全系統唯一讀取原始儲存格的地方**——之後的加總、尖峰滾動、
           * PCU 換算、全日累計全部自動吃到整數，不必在下游各補一次
           * （補在下游就會變成同一件事在 N 個地方各做各的）。
           */
          /*
           * 有內容但不是數字的格子，要記下來告訴使用者。
           *
           * `Number("-")`、`Number("休")`、`Number("N/A")` 都是 NaN，
           * 舊版 `|| 0` 直接當成 0 輛繼續算。在交通量統計上「0」與
           * 「沒測到」意義完全不同：0 會進加總、進尖峰視窗挑選、進全日
           * 累計與 PCU 換算，而使用者不會知道那一格其實沒有數字。
           * 更糟的是這個轉換讓既有的防線失效——品質檢查的
           * `Number.isFinite(value)`（見 collectIssues）拿到的一律是被
           * 補過的有限數，那條 error 規則在匯入路徑上永遠不會觸發，
           * 等於對使用者謊稱「已經檢查過而且沒問題」。
           * 空白格不算：稀疏區塊本來就會有空格，那是正常的。
           */
          const rawText =
            value === undefined || value === null ? "" : String(value).trim();
          /*
           * 判斷與寫入必須用**同一個運算式**，否則訊息會說謊。
           *
           * 舊版寫入用 `Number(value) || 0`。`SAFE_XLSX_READ_OPTIONS` 帶
           * `cellDates: true`，所以日期／時間格式的儲存格 `.v` 是 Date 物件，
           * `Number(Date)` 是**有限的** epoch 毫秒，通過 `|| 0` 之後
           * 一格就把 1,780,444,800,000 輛塞進那個時距，然後一路進尖峰視窗
           * 挑選、PCU 換算與全日累計。布林 true 同理會變成 1 輛。
           * Excel 對「7:00」這種輸入會自動套時間格式，承辦很容易踩到。
           * v2.1.37 以前完全沒有任何提示。
           */
          /*
           * 全形數字與合法的橫線佔位符要與全日交通量一致。
           *
           * ・「１２３」：舊版 Number("１２３") 是 NaN，於是計 0 輛並且警告，
           *   但全日交通量早就先做 NFKC 正規化、正確讀成 123。同一格資料
           *   在兩支系統得到不同的數字。
           * ・「--」「－」「—」「–」：這是調查表裡「該轉向不存在」的標準記法，
           *   全日交通量的 isUnusableCount() 明確視為合法、不警告；
           *   舊版轉向卻一律當成壞資料，實測 11017T1502 一份真實檔就跳出
           *   「有 192 個儲存格有內容但不是數字」。192 次誤報會直接讓使用者
           *   學會忽略這個警告，而它本來是要抓 N/A、休 這類真正的壞資料。
           */
          const normalizedText = rawText.normalize("NFKC");
          const numeric =
            typeof value === "number" ? value : Number(normalizedText);
          const usable = Number.isFinite(numeric);
          const legitimatePlaceholder = DASH_PLACEHOLDER.test(normalizedText);
          if (rawText && !usable && !legitimatePlaceholder) {
            const label = rawText.length > 24 ? rawText.slice(0, 24) + "…" : rawText;
            nonNumericTexts.set(label, (nonNumericTexts.get(label) || 0) + 1);
            if (nonNumericCells.length < 8)
              nonNumericCells.push(
                `${sheetName}!${XLSX.utils.encode_cell({ r: row, c: column.sourceColumn })}=「${label}」`,
              );
          }
          /*
           * 只是**記帳**，不改任何數值：橫線一樣算 0（下一行不變）。
           * 記下來是為了讓下游分得出「沒有這個轉向」與「整天量到 0」。
           *
           * ⚠️ 空白格要跳過，不可以算進 numericCells。
           *    `Number("")` 是 0、是有限數，所以 `usable` 對空白格也是 true——
           *    照著寫的話「整欄空白」會被記成「整欄量到 0」，
           *    「調查表沒填」與「調查表填了 0」就分不出來了。
           *    （第一版就是這樣寫的，實測 201 份檔一欄「空白」都測不到，
           *      不是因為沒有，是因為全被算成數字。）
           */
          if (!rawText) {
            /* 空白：既不是數字也不是橫線，兩邊都不加 */
          } else if (usable) column.numericCells += 1;
          else if (legitimatePlaceholder) column.placeholderCells += 1;
          interval.values[column.valueIndex] = usable ? Math.round(numeric) : 0;
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
  /*
   * 純代號檔名（T14-02.xls）視為承辦附的參考計算檔，只拿來對帳、不寫入資料。
   * 這條規則只看檔名，因此**必須**把原因一併帶出去：使用者看到的不能只是
   * 「沒有匯入」，而要知道是檔名造成的、以及改檔名就能解決。
   */
  const looksLikeReferenceFile = /^T\d+[-_.]?\d+\.(xls|xlsx|xlsm)$/i.test(
    file.name.normalize("NFKC"),
  );
  const baseRole: ImportPreview["role"] = looksLikeReferenceFile
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
  /*
   * 混合時間格：同一份檔案裡有些是 15 分鐘格、有些是整點格。
   *
   * 格距只取全表眾數，而尖峰視窗是**數格數**（needed = 60 / 眾數格距）、
   * 不是累計分鐘數。眾數是 60 時 needed = 1，等於任何一列都被當成一個完整
   * 小時；台灣常見的「全日整點＋尖峰時段拆 15 分鐘」版型正好踩中，
   * 尖峰那一小時被拆成 4 列，系統只取其中 1 列當成該小時的流率，
   * 低估 75%，而且總量守恆，任何以總量為基礎的檢查都抓不到。
   *
   * 這裡**只做偵測與提醒，不改計算**。修正挑選邏輯會變更計算口徑，
   * 那要連 LAST_CALC_CHANGE_VERSION 一起推進、讓既有鎖定全部重新確認，
   * 屬於使用者要拍板的決定，不是可以順手做掉的事。
   * （實測：使用者目前的 37 份真實工作簿沒有任何一份混用，0/37。）
   */
  /*
   * 判準要抓「兩種規律的格距」，不是「格距不完全一致」。
   *
   * 第一版只看 gapCounts.size > 1 就報，實測 55 筆真實預覽誤報 19 筆：
   *  ・調查中間有休息時段（07:00–09:00、17:00–19:00）→ 中間一個 480 分鐘的跳號
   *  ・旅行時間格式的檔案（TS 系列）根本不是等距時間序列，一堆一次性的間隔
   * 所以改成：每一種格距都要**佔全部間隔的兩成以上**才算一個「規律」，
   * 有兩種以上規律才是真的混用。休息時段的跳號只出現一次，佔比極低，
   * 不會觸發；TS 那種零散間隔也不會有任何一種達到兩成。
   */
  const totalGaps = gaps.length;
  const regularGaps = [...gapCounts.entries()]
    .filter(function (entry) {
      /*
       * 一次性的跳號不是「規律格距」。短時段資料若只漏一列，可能只有
       * 4 個相鄰間隔，其中那一個 30 分鐘跳號就占 25%；只看比例會把
       * 全部都標成 15 分鐘的資料誤報為混合 15／30 分鐘。
       * 至少重複兩次，再加上兩成門檻，才有足夠證據稱為另一種規律。
       */
      return totalGaps > 0 && entry[1] >= 2 && entry[1] / totalGaps >= 0.2;
    })
    .sort(function (a, b) {
      return a[0] - b[0];
    });
  if (regularGaps.length > 1) {
    const spread = regularGaps
      .map(function (entry) {
        return entry[0] + " 分鐘 × " + entry[1] + " 段";
      })
      .join("、");
    warnings.push(
      "這份檔案混用了不同長度的時間格（" +
        spread +
        "），系統以最常出現的 " +
        intervalMinutes +
        " 分鐘為準推算尖峰小時，該值可能不是真正的一小時流量，請人工核對尖峰時段的數字。",
    );
  }
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
  /*
   * 原因必須依「最終角色」產生。全日路段表可能同時符合純代號檔名規則，
   * 但內容判定會把最終角色改成「非路口轉向」；若沿用 baseRole 的原因，畫面
   * 會一面說非路口轉向、一面叫使用者改檔名解除參考檔判定，兩者互相矛盾。
   */
  const roleReason =
    role === "非路口轉向"
      ? `已辨識 ${detectedVehicles.length} 個車種與 ${intervalRows.length} 個時間區間，但未找到左轉、直行、右轉或起訖（OD）欄位；這是內容判定結果，不是檔名造成，且不會寫入路口轉向資料。`
      : looksLikeReferenceFile
        ? `檔名「${file.name}」只有站號代號、沒有其他文字，依檔名規則判定為參考計算檔，不會寫入資料。若這是原始調查資料，請在檔名加上路口名稱（例如 ${file.name.replace(/\.(xls|xlsx|xlsm)$/i, "_路口名稱.$1")}）後重新匯入。`
        : role === "無法辨識"
          ? "檔案中找不到可辨識的逐時距車種計數。這不是檔名的問題，請確認工作表內容是否為路口轉向調查表。"
          : undefined;
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
  /*
   * 「整欄空白」是唯一分不出來的情況，要講出來。
   *
   * 調查表用兩種寫法表達兩件不同的事：
   *   `0`  ＝ 這個轉向存在，只是整天量到 0
   *   `--` ＝ 這個路口根本沒有這個轉向
   * 但如果一欄**既沒有數字、也沒有橫線**，那就是調查表沒填——
   * 系統無從判斷是「沒有這個轉向」還是「漏填」。
   *
   * 這時候一律**保留**（當成「有這個轉向、量到 0」），因為保留最多只是
   * 畫面上多一列 0，刪掉卻可能弄丟真實流向。但保留是預設值，不是判斷，
   * 所以要明講，讓使用者自己決定要不要去「道路與流向管理」刪掉那條流向。
   *
   * 實測：73 份轉向版型的調查檔裡有 1 份出現這種欄位（12 欄，屬於一個
   * 整塊空白的區塊）；其餘的欄位不是有數字就是寫了橫線。
   */
  const blankOnlyColumns = detectedColumns.filter(function (column) {
    return column.numericCells === 0 && column.placeholderCells === 0;
  });
  if (blankOnlyColumns.length) {
    const where = Array.from(
      new Set(
        blankOnlyColumns.map(function (column) {
          return `${column.approach}${column.movement ? "・" + MOVEMENT_LABELS[column.movement] : ""}`;
        }),
      ),
    );
    warnings.push(
      `有 ${blankOnlyColumns.length} 欄整欄空白（沒有填任何數值，也沒有寫「--」）：` +
        where.slice(0, 6).join("、") +
        (where.length > 6 ? ` 等 ${where.length} 種` : "") +
        "。調查表沒填，無法判斷是「沒有這個轉向」還是「漏填」；" +
        "已一律當成「有這個轉向、整天量到 0」保留。" +
        "若確定該路口沒有這個轉向，請到「道路與流向管理」刪除該流向。",
    );
  }
  /*
   * 支線數與純橫線數的算術核對。
   *
   * 「三岔路口每支支線應該剛好有 1 個轉向整欄畫橫線」不是經驗法則，是算術：
   * 三岔的每一支只能去 2 個地方，調查表卻固定印 3 個轉向欄。詳見
   * auditArmMovements() 的說明。
   *
   * 對不上就一定有事——可能是該畫橫線的那一欄被留成空白、可能是表頭欄位
   * 被讀錯而把某支支線的欄位算到隔壁去。以前這種檔案會安靜通過，使用者只
   * 會在畫面上看到一列莫名其妙的流向，而不知道原因。
   *
   * 這裡只示警，不改任何數值、不改任何流向。
   */
  const armAudits = auditArmMovements(detectedColumns);
  const mismatched = armAudits.filter(
    (audit) => audit.absent.length !== audit.expectedAbsent,
  );
  if (armAudits.length >= 3 && mismatched.length) {
    const detail = mismatched
      .slice(0, 6)
      .map(function (audit) {
        const found = audit.absent.length
          ? audit.absent.map((m) => MOVEMENT_LABELS[m]).join("、")
          : "沒有任何一欄畫橫線";
        return (
          `路口${audit.approach}（印了 ${audit.movementCount} 個轉向欄、` +
          `只能去 ${audit.destinationCount} 個地方，應為 ${audit.expectedAbsent} 個，` +
          `實際 ${audit.absent.length} 個：${found}）`
        );
      })
      .join("；");
    warnings.push(
      `支線數與「沒有這個轉向」的數量對不起來：這是 ${armAudits.length} 岔路口，` +
        "每一支支線只能去（支線數 - 1）個地方，" +
        "調查表卻固定印同樣幾個轉向欄，兩者的差就是應該畫橫線的數量。" +
        `對不上的支線：${detail}` +
        (mismatched.length > 6 ? ` 等 ${mismatched.length} 支` : "") +
        "。可能是該畫橫線的欄位被留成空白，也可能是表頭欄位被讀錯，請核對原始檔。",
    );
  }
  if (positionalVehicleBlocks && vehicleHeaderConflicts)
    warnings.push(
      `發現 ${vehicleHeaderConflicts} 個車種欄名與第 1–4 車種欄位順序不一致；已依欄位群組辨識為機車、小型車、大型／大客車、特種／聯結車，請在預覽確認。`,
    );
  if (/\.xls$/i.test(file.name))
    warnings.push("已使用舊版 Excel 97–2003（.xls）相容讀取模式。");
  const stationValue = workbookStation
    ? stationFromFilename(workbookStation)
    : stationFromFilename(file.name);
  if (!workbookStation && stationValue)
    warnings.push(
      `檔案中沒有「站號：」欄位，站號 ${stationValue} 是從檔名推出來的，請於預覽確認。`,
    );
  if (!stationValue)
    warnings.push(
      "檔案與檔名都讀不到站號，請在預覽列直接填寫，或將檔名改為含 T<站號> 的格式後重新匯入。",
    );
  if (nonNumericTexts.size) {
    const total = [...nonNumericTexts.values()].reduce((a, b) => a + b, 0);
    const kinds = [...nonNumericTexts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([text, count]) => `「${text}」${count} 格`)
      .join("、");
    warnings.push(
      `有 ${total} 個儲存格有內容但不是數字，已一律計為 0 輛：${kinds}` +
        `${nonNumericTexts.size > 4 ? " 等" : ""}` +
        `（例如 ${nonNumericCells.slice(0, 3).join("、")}）。` +
        "「0」與「沒測到」在統計上意義不同，請確認這些格子是否真的代表零流量。",
    );
  }
  /*
   * ⚠️ X-66：三種「重複」的警告。一律只指出、不替使用者決定要留哪一筆
   *   （與交通服務水準 X-65 同一條標準）。
   */
  /*
   * ⚠️ 2026-09-18 使用者裁示（F-11）：這三種「重複」一律**擋下不寫入**
   *   （X-66 原本只警告、按確認仍會相加寫入）。訊息要寫到「哪一張表、哪幾欄」，
   *   讓使用者拿著原始檔找得到那一格。三段各自成一句，全部收進 blockReason；
   *   同時也留在 warnings 裡，預覽列的警告區照常看得到。
   */
  const blockReasons: string[] = [];
  if (duplicateApproachCodes.size)
    blockReasons.push(
      `同一張表有 ${duplicateApproachCodes.size} 個路口編號出現不只一次：` +
        [...duplicateApproachCodes]
          .map(
            (code) =>
              `「${code}」出現在 ${(approachCodePlaces.get(code) || []).join(" 與 ")}`,
          )
          .join("；") +
        "。兩個欄群自稱同一支支線，系統無法判斷哪一個才對、也不會把兩群相加，" +
        "請核對原始檔這幾欄表頭的「路口編號：」是否打錯（例如其中一群應為別的支線），修正後重新匯入。",
    );
  if (duplicateColumnLabels.size) {
    const detail = [...duplicateColumnLabels.entries()]
      .map(([code, labels]) => `路口${code} 的表頭「${[...labels].join("」「")}」`)
      .join("；");
    blockReasons.push(
      `同一支支線的表頭出現完全相同的欄名：${detail}。` +
        "同一個「車種×流向」有兩欄，系統無法判斷該用哪一欄、也不會相加，" +
        "請核對原始檔是不是多貼了一欄或打錯字，修正後重新匯入。",
    );
  }
  if (duplicateIntervals.size) {
    const detail = [...duplicateIntervals.entries()]
      .map(
        ([sheet, labels]) =>
          `「${sheet}」的 ${[...labels]
            .map((item) => {
              const [code, cell] = item.split("｜");
              return `路口${code}（時間欄 ${cell}）`;
            })
            .join("、")}`,
      )
      .join("；");
    blockReasons.push(
      `同一支支線裡有時距重複出現：${detail}。` +
        "重複的時距系統無法判斷哪一列才對、也不會相加，請核對原始檔的時間欄，修正後重新匯入。",
    );
  }
  const blockReason = blockReasons.length
    ? `本檔不會寫入。${blockReasons.join(" ")}`
    : undefined;
  if (blockReason) warnings.push(blockReason);
  if (inferredApproachCodes.size)
    warnings.push(
      `有 ${inferredApproachCodes.size} 支支線在表頭讀不到「路口編號：」，` +
        `代碼由系統依出現順序推定為 ${[...inferredApproachCodes].join("、")}。` +
        "支線代碼是跨季比對幾何與轉向的依據，推定值與其他季度可能對不起來，" +
        "請於「道路與流向管理」確認，或在原始檔補上路口編號後重新匯入。",
    );
  return {
    file: options?.fileLabel || file.name,
    /*
     * 站號優先讀檔案內的「站號：」欄位，讀不到才退回檔名。
     * 一併記下來源，讓匯入預覽能提醒使用者哪些站號是猜出來的、需要核對。
     */
    station: stationValue,
    stationSource: workbookStation
      ? "workbook"
      : stationValue
        ? "filename"
        : "none",
    name: normalizeIntersectionName(workbookName || file.name),
    role,
    roleReason,
    blockReason,
    sheets: buckets,
    intervals: intervalRows.length,
    intervalMinutes,
    intervalRows: structuredClone(intervalRows),
    survey: {
      intervals: intervalRows.length,
      minutes: intervalRows.length * intervalMinutes,
      values: surveyValues,
    },
    peakWindows: peakWindowsFor(
      intervalRows,
      intervalMinutes,
      weights,
      intervalRows.length * intervalMinutes,
    ),
    noonQuestion: (() => {
      const info = noonStraddle(intervalRows, intervalMinutes, weights);
      if (!info) return undefined;
      return {
        label: `${formatMinutes(info.window.start)}–${formatMinutes(info.window.end)}`,
        total: info.window.total,
        amLabel: info.amBest
          ? `${formatMinutes(info.amBest.start)}–${formatMinutes(info.amBest.end)}`
          : "",
        amTotal: info.amBest?.total ?? 0,
        pmLabel: info.pmBest
          ? `${formatMinutes(info.pmBest.start)}–${formatMinutes(info.pmBest.end)}`
          : "",
        pmTotal: info.pmBest?.total ?? 0,
      };
    })(),
    date: foundDate?.iso || "",
    dateSource: foundDate
      ? { sheet: foundDate.sheet, cell: foundDate.cell, raw: foundDate.raw }
      : null,
    dateCandidates: dateCandidates,
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
  const daySheets = workbook.SheetNames.filter(isDayTypeSheetName);
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
