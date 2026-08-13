import * as XLSX from "xlsx";

export type PeakKey = "AM" | "PM";
export type MovementKey = "left" | "through" | "right";
export type VehicleKey = "all" | "motorcycle" | "car" | "heavy" | "special";
export type PceVehicle = "special" | "heavy" | "car" | "motorcycle";
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
};

export type PceMatrix = Record<PceVehicle, Record<MovementKey, number>>;

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
  vehicle: Record<Exclude<VehicleKey, "all">, number>;
  /** Actual-vehicle total for the same scope/time as vehicle, never PCU. */
  rawVehicleTotal?: number | null;
};

export type RouteVolume = {
  pcu: number;
  vehicle: Record<Exclude<VehicleKey, "all">, number>;
};

export type RouteFlow = {
  id: string;
  fromApproachId: string;
  toApproachId: string;
  movement: MovementKey;
  volumes: Record<PeakKey, RouteVolume>;
  /** Actual vehicles for the complete imported survey period. */
  survey?: {
    vehicle: Record<Exclude<VehicleKey, "all">, number>;
  };
};

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
  movements: Record<PeakKey, Movement>;
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
    vehicle: Record<Exclude<VehicleKey, "all">, number>;
  };
  approaches: Approach[];
  /** Explicit origin-to-destination flows. Required for five-to-seven-arm intersections. */
  routes?: RouteFlow[];
  /** How OD routes were classified as left/through/right. */
  movementRule?: "reference-calculation" | "geometry-suggested" | "manual";
  /** Per road branch: show inbound/outbound separately or as a two-way total. */
  directionDisplay?: Record<string, "split" | "two-way">;
  /** Manual approval lock for a checked quarterly result. */
  resultLock?: {
    lockedAt: string;
    version: string;
    signature: string;
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

export const VERSION = "v1.7.1";
export const VERSION_HISTORY = [
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
  value = value.replace(
    /^\s*T\d+[-_.]?\d+\s*(?:[-_.·｜|]\s*)?/i,
    "",
  );
  value = value.replace(
    /^\s*\d{1,3}[-_.]\d{1,3}\s*(?:[-_.·｜|]\s*)?/i,
    "",
  );
  value = value.replace(
    /[（(]\s*[三四五六七八九十\d]+叉路口\s*[）)]/gu,
    "",
  );
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
  return (
    name
      .normalize("NFKC")
      .match(/T\s*(\d+)[-_.]?\s*(\d+)/i)
      ?.slice(1)
      .map((x, i) => (i ? x.padStart(2, "0") : x))
      .join("-")
      .replace(/^/, "T") || `S-${Math.abs(hash(name)) % 999}`
  );
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
) {
  const row = approach.movements[peak];
  if (vehicle !== "all") {
    const vehicleTotal = row.vehicle[vehicle] || 0;
    if (!movementKey) return vehicleTotal;
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
  const needed = Math.max(1, Math.round(60 / intervalMinutes));
  const candidates = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.start >= range[0] && row.start < range[1]);
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
      best = { start: row.start, end: row.start + 60, total, values };
  }
  return best;
}

function parseTime(value: unknown): number | null {
  if (typeof value === "number" && value > 0 && value < 1)
    return Math.round(value * 24 * 60);
  const match = String(value ?? "").match(/(\d{1,2})[:：](\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export type ImportPreview = {
  file: string;
  station: string;
  name: string;
  role: "原始交通量" | "參考計算檔" | "無法辨識";
  sheets: {
    traffic: string[];
    log: string[];
    phase: string[];
    ignored: string[];
  };
  intervals: number;
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
  }>;
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

function vehicleFromHeader(label: string): PceVehicle | null {
  if (/機車|機踏車|motor/i.test(label)) return "motorcycle";
  if (/特種|特車|聯結|貨櫃|曳引|special/i.test(label)) return "special";
  if (/大客|大貨|大型|heavy|truck|bus/i.test(label)) return "heavy";
  if (/小客|小貨|小型|轎車|car|light/i.test(label)) return "car";
  return null;
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

/**
 * Confirmed movement classification copied from the user's T15-01 reference
 * calculation workbook. D has no through movement in that workbook.
 */
export function referenceMovementForOd(
  intersectionName: string,
  from: string,
  to: string,
): MovementKey | null {
  const normalized = intersectionName.normalize("NFKC");
  if (!normalized.includes("中山北路") || !normalized.includes("岡山路"))
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
  const workbook = XLSX.read(array, { type: "array", cellDates: true });
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
  const templateName = importTemplate(templateId).name;
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
        (!options?.trafficSheets || options.trafficSheets.includes(item.sheet)) &&
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
        headerVehicle: PceVehicle;
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
        const headerVehicle = vehicleFromHeader(label);
        if (!headerVehicle || (!movement && !destination)) continue;
        candidates.push({
          sourceColumn: col,
          label,
          movement,
          destination,
          headerVehicle,
        });
      }
      const usePositionalVehicles =
        candidates.length >= 8 && candidates.length % 4 === 0;
      const vehicleGroupSize = usePositionalVehicles
        ? candidates.length / 4
        : 0;
      if (usePositionalVehicles) positionalVehicleBlocks++;
      candidates.forEach(function (candidate, candidateIndex) {
        const positionalVehicle = usePositionalVehicles
          ? (["motorcycle", "car", "heavy", "special"] as PceVehicle[])[
              Math.min(3, Math.floor(candidateIndex / vehicleGroupSize))
            ]
          : candidate.headerVehicle;
        if (
          usePositionalVehicles &&
          positionalVehicle !== candidate.headerVehicle
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
        };
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
        ) ||
        defaultMovementForOd(
          column.approach,
          column.destination,
          originOrder,
        );
    }
  });
  const intervalRows = [...intervalMap.values()].sort(function (a, b) {
    return a.start - b.start;
  });
  const intervalMinutes = Math.max(
    15,
    Math.min(
      60,
      intervalRows
        .slice(1)
        .map(function (row, index) {
          return row.start - intervalRows[index].start;
        })
        .filter(function (value) {
          return value > 0;
        })[0] || 15,
    ),
  );
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
    return pce[column.vehicle][column.movement || "through"];
  });
  const role = /^T\d+[-_.]?\d+\.(xls|xlsx|xlsm)$/i.test(
    file.name.normalize("NFKC"),
  )
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
  if (mappingConfidence === "low")
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
  warnings.push(`套用格式範本：${templateName}。`);
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
    survey: {
      intervals: intervalRows.length,
      minutes: intervalRows.length * intervalMinutes,
      values: surveyValues,
    },
    am: rollingPeak(
      intervalRows,
      [5 * 60, 12 * 60],
      intervalMinutes,
      weights,
    ),
    pm: rollingPeak(
      intervalRows,
      [12 * 60, 23 * 60],
      intervalMinutes,
      weights,
    ),
    date: rocDate(dateText),
    dateSource: dateCell
      ? { sheet: dateCell.sheet, cell: dateCell.cell, raw: dateCell.text }
      : null,
    surveyType:
      options?.surveyType ||
      dateText.match(/[（(]\s*([^）)]+)\s*[）)]/)?.[1] ||
      "待設定",
    layout,
    approaches: originOrder,
    columns: detectedColumns,
    mappingConfidence,
    warnings,
    templateId,
    templateName,
    pceUsed: structuredClone(pce),
  };
}

export async function inspectWorkbookVariants(
  file: File,
  pce: PceMatrix = DEFAULT_PCE,
): Promise<ImportPreview[]> {
  const array = await file.arrayBuffer();
  const workbook = XLSX.read(array, { type: "array", cellDates: true });
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
