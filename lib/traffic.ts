import * as XLSX from "xlsx";

export type PeakKey = "AM" | "PM";
export type MovementKey = "left" | "through" | "right";
export type VehicleKey = "all" | "motorcycle" | "car" | "heavy" | "special";
export type PceVehicle = "special" | "heavy" | "car" | "motorcycle";
export type LaneType = "fast" | "mixed" | "slow" | "left" | "custom";

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

export const LANE_GUIDANCE: Record<LaneType, { label: string; min: number; max: number; recommended: number; note: string }> = {
  fast: { label: "直行快車道", min: 1600, max: 2000, recommended: 1800, note: "初估飽和流率；需依車道寬、坡度、車種與現地校估" },
  mixed: { label: "直右混合車道", min: 1100, max: 1700, recommended: 1400, note: "初估飽和流率；右轉、行人與機車比例會影響" },
  slow: { label: "慢車道／高度混合車道", min: 700, max: 1300, recommended: 1000, note: "僅供資料不足時初篩，不等於實際容量" },
  left: { label: "保護左轉車道", min: 1200, max: 1700, recommended: 1450, note: "初估飽和流率；需配合左轉時相與綠燈比" },
  custom: { label: "自訂", min: 100, max: 3000, recommended: 1400, note: "請填入專案校估值與依據" },
};

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
};

export type Approach = {
  id: string;
  name: string;
  bearing: string;
  angle: number;
  lanes: number | null;
  laneType?: LaneType;
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
  peaks: Record<PeakKey, { start: string; end: string }>;
  approaches: Approach[];
  /** Explicit origin-to-destination flows. Required for five-to-seven-arm intersections. */
  routes?: RouteFlow[];
  sourceFiles: string[];
  importedAt: string;
  validation: { referenceFound: boolean; matchRate: number | null; notes: string[] };
};

export type QualityIssue = {
  id: string;
  severity: "error" | "warning" | "info";
  category: "缺值" | "總數不一致" | "尖峰時段異常" | "車種統計異常" | "異常流量";
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

export const VERSION = "v1.2.0";
export const VERSION_HISTORY = [
  { version: "v1.2.0", date: "2026-08-11", note: "實檔匯入器改為表型辨識；支援七岔路起訖流向、並排區塊、舊版 Excel、名稱合併決策與正式 OD 流向圖。" },
  { version: "v1.1.0", date: "2026-08-11", note: "新增多計畫管理、可調整轉向當量、容量建議與號誌欄位、跨電腦備份；重製轉向箭頭、單位與報表。" },
  { version: "v1.0.0", date: "2026-08-11", note: "首版：批次匯入、尖峰分析、SVG 轉向圖、比較、品質檢查、報表與備份。" },
];

const vehicleShare = { motorcycle: 0.42, car: 0.48, heavy: 0.08, special: 0.02 };

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
      Object.entries(vehicleShare).map(([key, share]) => [key, Math.round(total * share)]),
    ) as Movement["vehicle"],
  };
}

const sites = [
  { station: "T1-01", name: "中山北路－岡山路口", arms: ["中山北路北側", "中山北路南側", "岡山路東側", "岡山路西側", "中興路", "支路A", "支路B"], base: 965 },
  { station: "T1-02", name: "岡山北路－育才路口", arms: ["岡山北路北側", "岡山北路南側", "育才路東側", "育才路西側"], base: 742 },
  { station: "T1-03", name: "台1線－路科一路口", arms: ["台1線北側", "台1線南側", "路科一路東側"], base: 1108 },
  { station: "T1-04", name: "中山路－國昌路－民強街路口", arms: ["中山路北側", "中山路南側", "國昌路東側", "國昌路西側", "民強街"], base: 886 },
  { station: "T1-05", name: "台1線－台28線路口", arms: ["台1線北側", "台1線南側", "台28線東側", "台28線西側"], base: 1286 },
];

const quarters = ["114Q3", "114Q4", "115Q1", "115Q2"];
const quarterMonths = ["2025-08", "2025-11", "2026-02", "2026-05"];

export function createDemoRecords(): TrafficRecord[] {
  return quarters.flatMap((quarter, qi) => sites.map((site, si) => {
    const factor = 0.91 + qi * 0.035 + si * 0.008;
    const approaches = site.arms.map((name, ai) => {
      const scale = site.base * factor * (0.78 + ((ai * 7 + si * 3) % 8) * 0.055);
      const angle = -90 + ai * (360 / site.arms.length);
      return {
        id: `${site.station}-A${ai + 1}`,
        name,
        bearing: ["北", "東北", "東", "東南", "南", "西南", "西", "西北"][Math.round(((angle + 90 + 360) % 360) / 45) % 8],
        angle,
        lanes: ai < 4 ? 2 : 1,
        capacity: ai < 4 ? 1450 + si * 40 : null,
        movements: {
          AM: movement(Math.round(scale * (0.74 + (ai % 3) * 0.08)), [0.12 + (ai % 2) * 0.04, 0.72 - (ai % 3) * 0.03, 0.16]),
          PM: movement(Math.round(scale * (0.82 + ((ai + 1) % 3) * 0.07)), [0.15, 0.67 - (ai % 2) * 0.04, 0.18 + (ai % 2) * 0.04]),
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
      peaks: { AM: { start: "07:15", end: "08:15" }, PM: { start: "17:00", end: "18:00" } },
      approaches,
      sourceFiles: [`11017${site.station}-${site.name}.xls`, `${site.station}.xls`],
      importedAt: "2026-08-11T09:00:00+08:00",
      validation: { referenceFound: false, matchRate: null, notes: ["示範資料：以連續 4 個 15 分鐘區間計算 60 分鐘尖峰。", "正式參考檔尚待實檔驗證。"] },
    } satisfies TrafficRecord;
  }));
}

export function normalizeIntersectionName(input: string): string {
  let value = input.normalize("NFKC").replace(/\.(xlsx?|xlsm)$/i, "");
  value = value.replace(/^\s*\d{4,}(?:[-_.]?T?\d+[-_.]?\d+)?\s*/i, "");
  value = value.replace(/^\s*T\d+[-_.]?\d+\s*/i, "");
  value = value.replace(/[【[（(]+/g, "").replace(/[】\]）)]+/g, "");
  value = value.replace(/(?:(?:修正版|更新版|最終版|final|rev(?:ision)?|ver(?:sion)?|v)\s*[._-]?\d*)+$/i, "");
  value = value.replace(/[._]{2,}$/g, "").replace(/[._]+$/g, "");
  value = value.replace(/[-‐‑‒–—―－~～〜/\\_]+/g, "－").replace(/－{2,}/g, "－");
  value = value.replace(/^－|－$/g, "").replace(/\s+/g, "").trim();
  return value || "未命名路口";
}

export function canonicalIntersectionKey(input: string) {
  return normalizeIntersectionName(input.normalize("NFKC").replace(/\([^)]*\)/g, ""))
    .replace(/[三四五六七八九十\d]+叉路口/g, "")
    .replace(/路口/g, "路")
    .replace(/台(\d+)線/g, "台$1")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase("zh-TW");
}

export function stationFromFilename(name: string): string {
  return name.normalize("NFKC").match(/T\s*(\d+)[-_.]?\s*(\d+)/i)?.slice(1).map((x, i) => (i ? x.padStart(2, "0") : x)).join("-").replace(/^/, "T") || `S-${Math.abs(hash(name)) % 999}`;
}

function hash(value: string) {
  return [...value].reduce((sum, char) => ((sum << 5) - sum + char.charCodeAt(0)) | 0, 0);
}

export function totalMovement(approach: Approach, peak: PeakKey, movementKey?: MovementKey, vehicle: VehicleKey = "all") {
  const row = approach.movements[peak];
  if (vehicle !== "all") {
    const vehicleTotal = row.vehicle[vehicle] || 0;
    if (!movementKey) return vehicleTotal;
    const overall = row.left + row.through + row.right || 1;
    return Math.round(vehicleTotal * row[movementKey] / overall);
  }
  return movementKey ? row[movementKey] : row.left + row.through + row.right;
}

export function recordTotal(record: TrafficRecord, peak: PeakKey) {
  return record.approaches.reduce((sum, approach) => sum + totalMovement(approach, peak), 0);
}

export function computeVC(record: TrafficRecord, peak: PeakKey) {
  const missing: string[] = [];
  const rows = record.approaches.map((approach) => {
    if (!approach.lanes) missing.push(`${approach.name}：車道數`);
    const saturationFlow = approach.saturationFlow ?? approach.capacity;
    if (!saturationFlow) missing.push(`${approach.name}：每車道飽和流率`);
    if (!approach.effectiveGreen) missing.push(`${approach.name}：有效綠燈秒數`);
    if (!approach.cycleLength) missing.push(`${approach.name}：號誌週期秒數`);
    const capacity = saturationFlow && approach.lanes && approach.effectiveGreen && approach.cycleLength
      ? saturationFlow * approach.lanes * approach.effectiveGreen / approach.cycleLength
      : null;
    return { approach: approach.name, volume: totalMovement(approach, peak), capacity, ratio: capacity ? totalMovement(approach, peak) / capacity : null };
  });
  return { calculable: missing.length === 0, missing: [...new Set(missing)], rows };
}

export function qualityIssues(records: TrafficRecord[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const record of records) {
    for (const peak of ["AM", "PM"] as PeakKey[]) {
      const hour = Number(record.peaks[peak].start.split(":")[0]);
      if ((peak === "AM" && (hour < 5 || hour >= 12)) || (peak === "PM" && (hour < 12 || hour >= 23))) {
        issues.push({ id: `${record.id}-${peak}-time`, severity: "warning", category: "尖峰時段異常", station: record.station, quarter: record.quarter, message: `${peak} 尖峰 ${record.peaks[peak].start} 不在預設搜尋範圍。` });
      }
      const approachTotals = record.approaches.map((a) => totalMovement(a, peak));
      const mean = approachTotals.reduce((a, b) => a + b, 0) / Math.max(1, approachTotals.length);
      approachTotals.forEach((value, index) => {
        if (!Number.isFinite(value)) issues.push({ id: `${record.id}-${peak}-${index}-missing`, severity: "error", category: "缺值", station: record.station, quarter: record.quarter, message: `${record.approaches[index].name} ${peak} 含非數值欄位。` });
        if (mean > 0 && value > mean * 2.2) issues.push({ id: `${record.id}-${peak}-${index}-anomaly`, severity: "warning", category: "異常流量", station: record.station, quarter: record.quarter, message: `${record.approaches[index].name} ${peak} 流量為方向平均的 ${(value / mean).toFixed(1)} 倍，建議核對。` });
        const m = record.approaches[index].movements[peak];
        const classifiedVehicleTotal = Object.values(m.vehicle).reduce((a, b) => a + b, 0);
        const turningVehicleTotal = m.rawVehicleTotal;
        // left/through/right are PCU/hr and cannot be compared with classified
        // vehicles. Only run this rule when the importer has retained the
        // same-scope actual-vehicle total (vehicles/hr).
        if (turningVehicleTotal != null) {
          const difference = Math.abs(classifiedVehicleTotal - turningVehicleTotal);
          if (difference > Math.max(5, turningVehicleTotal * 0.05)) issues.push({
            id: `${record.id}-${peak}-${index}-vehicle`, severity: "warning", category: "車種統計異常", station: record.station, quarter: record.quarter,
            message: `${record.approaches[index].name} ${peak}：左直右實際車輛合計 ${turningVehicleTotal.toLocaleString()} 輛/hr，四車種合計 ${classifiedVehicleTotal.toLocaleString()} 輛/hr，差 ${difference.toLocaleString()} 輛/hr。`,
            details: { turningVehicleTotal, classifiedVehicleTotal, difference, unit: "輛/hr", explanation: "兩邊均須來自同一方向、同一尖峰時段的實際車輛數；PCU/hr 不參與此項加總檢查。" },
          });
        }
      });
    }
    if (!record.date) issues.push({ id: `${record.id}-date`, severity: "error", category: "缺值", station: record.station, quarter: record.quarter, message: "缺少調查日期。" });
  }
  return issues;
}

export type IntervalRow = { start: number; label: string; values: number[] };

export function rollingPeak(rows: IntervalRow[], range: [number, number], intervalMinutes = 15, weights?: number[]) {
  const needed = Math.max(1, Math.round(60 / intervalMinutes));
  const candidates = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.start >= range[0] && row.start < range[1]);
  let best: { start: number; end: number; total: number; values: number[] } | null = null;
  for (const { row, index } of candidates) {
    const slice = rows.slice(index, index + needed);
    if (slice.length !== needed || slice.some((r, i) => i && r.start - slice[i - 1].start !== intervalMinutes)) continue;
    const values = Array.from({ length: Math.max(...slice.map((r) => r.values.length), 0) }, (_, col) => slice.reduce((sum, r) => sum + (Number(r.values[col]) || 0), 0));
    const total = values.reduce((sum, value, column) => sum + value * (weights?.[column] ?? 1), 0);
    if (!best || total > best.total) best = { start: row.start, end: row.start + 60, total, values };
  }
  return best;
}

function parseTime(value: unknown): number | null {
  if (typeof value === "number" && value > 0 && value < 1) return Math.round(value * 24 * 60);
  const match = String(value ?? "").match(/(\d{1,2})[:：](\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export type ImportPreview = {
  file: string;
  station: string;
  name: string;
  role: "原始交通量" | "參考計算檔" | "無法辨識";
  sheets: { traffic: string[]; log: string[]; phase: string[]; ignored: string[] };
  intervals: number;
  am: ReturnType<typeof rollingPeak>;
  pm: ReturnType<typeof rollingPeak>;
  date: string;
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
};

function mergedCellValue(sheet: XLSX.WorkSheet, row: number, col: number) {
  const direct = sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v;
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const merge = (sheet["!merges"] || []).find((item) => row >= item.s.r && row <= item.e.r && col >= item.s.c && col <= item.e.c);
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
  if (/特種|特車|special/i.test(label)) return "special";
  if (/大客|大貨|大型|聯結|曳引|heavy|truck|bus/i.test(label)) return "heavy";
  if (/小客|小貨|小型|轎車|car|light/i.test(label)) return "car";
  return null;
}

function workbookText(workbook: XLSX.WorkBook) {
  const values: string[] = [];
  workbook.SheetNames.forEach(function (sheetName) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.["!ref"]) return;
    const range = XLSX.utils.decode_range(sheet["!ref"]!);
    for (let row = range.s.r; row <= Math.min(range.e.r, 12); row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const value = sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v;
        if (value != null && String(value).trim()) values.push(String(value).trim());
      }
    }
  });
  return values;
}

function rocDate(value: string) {
  const match = value.normalize("NFKC").match(/(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!match) return "";
  return `${Number(match[1]) + 1911}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
}

function sourceCode(sheet: XLSX.WorkSheet, headerEnd: number, startColumn: number, endColumn: number, sheetName: string) {
  for (let row = 0; row <= headerEnd; row++) {
    for (let col = startColumn; col <= endColumn; col++) {
      const text = String(sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v ?? "").normalize("NFKC");
      const match = text.match(/路口編號\s*[：:]?\s*(?:路口)?\s*([A-Z0-9]+)/i);
      if (match) return match[1].toUpperCase();
    }
  }
  return sheetName.normalize("NFKC").match(/路口\s*[（(]?\s*([A-Z0-9]+)\s*[)）]?/i)?.[1]?.toUpperCase() || "";
}

function defaultMovementForOd(from: string, to: string, approaches: string[]): MovementKey {
  const fromIndex = approaches.indexOf(from);
  const toIndex = approaches.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || approaches.length < 3) return "through";
  const step = ((toIndex - fromIndex) % approaches.length + approaches.length) % approaches.length;
  const signedDegrees = ((step * 360 / approaches.length - 180 + 540) % 360) - 180;
  if (Math.abs(signedDegrees) <= 50) return "through";
  return signedDegrees < 0 ? "left" : "right";
}

export async function inspectWorkbook(file: File): Promise<ImportPreview> {
  const array = await file.arrayBuffer();
  const workbook = XLSX.read(array, { type: "array", cellDates: true });
  const buckets = { traffic: [] as string[], log: [] as string[], phase: [] as string[], ignored: [] as string[] };
  workbook.SheetNames.forEach((sheet) => {
    if (/照片|photo|image/i.test(sheet)) buckets.ignored.push(sheet);
    else if (/監測日誌|日誌|log/i.test(sheet)) buckets.log.push(sheet);
    else if (/時相|號誌|phase|signal/i.test(sheet)) buckets.phase.push(sheet);
    else buckets.traffic.push(sheet);
  });
  const texts = workbookText(workbook);
  const workbookStation = texts.map(function (text) { return text.match(/站號\s*[：:]\s*[^\s]*?(T\s*\d+[-_.]?\s*\d+)/i)?.[1]; }).find(Boolean);
  const workbookName = texts.map(function (text) { return text.match(/站名\s*[：:]\s*(.+)$/)?.[1]; }).find(Boolean)
    || texts.map(function (text) { return text.match(/地\s*點\s*[：:]?\s*(.+)$/)?.[1]; }).find(Boolean);
  const dateText = texts.find(function (text) { return /\d{2,3}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(text.normalize("NFKC")); }) || "";
  const intervalMap = new Map<number, IntervalRow>();
  const detectedColumns: ImportPreview["columns"] = [];
  const originOrder: string[] = [];
  let sawOd = false;
  let sawTurning = false;
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
      const hasTimeHeader = firstDataRow >= 0 && Array.from({ length: Math.min(4, firstDataRow - used.s.r + 1) }, function (_, offset) {
        return mergedCellValue(sheet, firstDataRow - offset - 1, col);
      }).some(function (value) { return /時\s*間/.test(value); });
      if (firstDataRow >= 0 && timeCount >= 4 && (hasTimeHeader || stringTimeCount >= 4)) timeColumns.push({ column: col, firstDataRow });
    }
    timeColumns.forEach(function (timeColumn, blockIndex) {
      const blockEnd = (timeColumns[blockIndex + 1]?.column ?? (used.e.c + 1)) - 1;
      const origin = sourceCode(sheet, timeColumn.firstDataRow - 1, timeColumn.column, blockEnd, sheetName) || `A${originOrder.length + 1}`;
      if (!originOrder.includes(origin)) originOrder.push(origin);
      const blockColumns: ImportPreview["columns"] = [];
      for (let col = timeColumn.column + 1; col <= blockEnd; col++) {
        const parts: string[] = [];
        for (let headerRow = Math.max(used.s.r, timeColumn.firstDataRow - 8); headerRow < timeColumn.firstDataRow; headerRow++) {
          const value = mergedCellValue(sheet, headerRow, col);
          if (value && !parts.includes(value)) parts.push(value);
        }
        const label = parts.join("｜");
        const movement = movementFromHeader(label);
        const destination = label.match(/往\s*([A-Z0-9]+)/i)?.[1]?.toUpperCase() || null;
        const vehicle = vehicleFromHeader(label);
        if (!vehicle || (!movement && !destination)) continue;
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
      }
      for (let row = timeColumn.firstDataRow; row <= used.e.r; row++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: timeColumn.column })]?.v;
        const start = parseTime(cell);
        if (start === null) continue;
        const interval = intervalMap.get(start) || { start, label: String(cell), values: [] };
        blockColumns.forEach(function (column) {
          const value = sheet[XLSX.utils.encode_cell({ r: row, c: column.sourceColumn })]?.v;
          interval.values[column.valueIndex] = Number(value) || 0;
        });
        intervalMap.set(start, interval);
      }
    });
  }
  detectedColumns.forEach(function (column) {
    if (column.destination && !originOrder.includes(column.destination)) originOrder.push(column.destination);
  });
  detectedColumns.forEach(function (column) {
    if (!column.movement && column.destination) column.movement = defaultMovementForOd(column.approach, column.destination, originOrder);
  });
  const intervalRows = [...intervalMap.values()].sort(function (a, b) { return a.start - b.start; });
  intervalRows.forEach(function (row) {
    row.values = Array.from({ length: detectedColumns.length }, function (_, index) { return Number(row.values[index]) || 0; });
  });
  const weights = detectedColumns.map(function (column) { return DEFAULT_PCE[column.vehicle][column.movement || "through"]; });
  const role = /^T\d+[-_.]?\d+\.(xls|xlsx|xlsm)$/i.test(file.name.normalize("NFKC")) ? "參考計算檔" : intervalRows.length ? "原始交通量" : "無法辨識";
  const warnings: string[] = [];
  if (!buckets.log.length) warnings.push("未找到監測日誌；道路名稱與幾何仍可人工補正。");
  if (!buckets.phase.length) warnings.push("未找到時相圖；只影響 V/C 的有效綠燈與週期，不影響尖峰流量。");
  if (!intervalRows.length) warnings.push("未找到可辨識的時間序列資料。");
  const distinctApproaches = new Set(detectedColumns.map(function (column) { return column.approach; })).size;
  const mappingConfidence = detectedColumns.length >= 12 && distinctApproaches >= 2 ? "high" : detectedColumns.length >= 4 ? "medium" : "low";
  const layout: ImportPreview["layout"] = sawOd ? "od" : sawTurning ? "turning" : "unknown";
  if (mappingConfidence === "low") warnings.push("欄位語意不足，匯入前必須人工確認；系統不會把未知數值當成正式流量。");
  else if (layout === "od") warnings.push(`已辨識 ${distinctApproaches} 個入口、${detectedColumns.length} 個起訖車種欄位；將保留 A→B 等實際流向，不強制改成左直右。`);
  else warnings.push(`已辨識 ${distinctApproaches} 個入口區塊、${detectedColumns.length} 個左直右×車種欄位。`);
  if (/\.xls$/i.test(file.name)) warnings.push("已使用舊版 Excel 97–2003（.xls）相容讀取模式。");
  return {
    file: file.name,
    station: workbookStation ? stationFromFilename(workbookStation) : stationFromFilename(file.name),
    name: normalizeIntersectionName(workbookName || file.name),
    role,
    sheets: buckets,
    intervals: intervalRows.length,
    am: rollingPeak(intervalRows, [5 * 60, 12 * 60], 15, weights),
    pm: rollingPeak(intervalRows, [12 * 60, 23 * 60], 15, weights),
    date: rocDate(dateText),
    surveyType: dateText.match(/[（(]\s*([^）)]+)\s*[）)]/)?.[1] || "待設定",
    layout,
    approaches: originOrder,
    columns: detectedColumns,
    mappingConfidence,
    warnings,
  };
}

export function formatMinutes(minutes: number) {
  const value = (minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
