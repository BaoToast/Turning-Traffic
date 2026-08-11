import * as XLSX from "xlsx";

export type PeakKey = "AM" | "PM";
export type MovementKey = "left" | "through" | "right";
export type VehicleKey = "all" | "motorcycle" | "car" | "lightTruck" | "heavy" | "bus";

export type Movement = {
  left: number;
  through: number;
  right: number;
  vehicle: Record<Exclude<VehicleKey, "all">, number>;
};

export type Approach = {
  id: string;
  name: string;
  bearing: string;
  angle: number;
  lanes: number | null;
  capacity: number | null;
  movements: Record<PeakKey, Movement>;
};

export type TrafficRecord = {
  id: string;
  station: string;
  name: string;
  rawName: string;
  quarter: string;
  date: string;
  surveyType: string;
  peaks: Record<PeakKey, { start: string; end: string }>;
  approaches: Approach[];
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
};

export const VERSION = "v1.0.0";
export const VERSION_HISTORY = [
  { version: "v1.0.0", date: "2026-08-11", note: "首版：批次匯入、尖峰分析、SVG 轉向圖、比較、品質檢查、報表與備份。" },
];

const vehicleShare = { motorcycle: 0.42, car: 0.39, lightTruck: 0.09, heavy: 0.05, bus: 0.05 };

function movement(total: number, split = [0.16, 0.68, 0.16]): Movement {
  const left = Math.round(total * split[0]);
  const through = Math.round(total * split[1]);
  const right = Math.max(0, total - left - through);
  return {
    left,
    through,
    right,
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
  value = value.replace(/[【\[（(]+/g, "").replace(/[】\]）)]+/g, "");
  value = value.replace(/(?:(?:修正版|更新版|最終版|final|rev(?:ision)?|ver(?:sion)?|v)\s*[._-]?\d*)+$/i, "");
  value = value.replace(/[._]{2,}$/g, "").replace(/[._]+$/g, "");
  value = value.replace(/[-‐‑‒–—―－~～〜/\\_]+/g, "－").replace(/－{2,}/g, "－");
  value = value.replace(/^－|－$/g, "").replace(/\s+/g, "").trim();
  return value || "未命名路口";
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
    if (!approach.capacity) missing.push(`${approach.name}：容量/飽和流率`);
    const capacity = approach.capacity && approach.lanes ? approach.capacity * approach.lanes : null;
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
        const vehicle = Object.values(m.vehicle).reduce((a, b) => a + b, 0);
        if (Math.abs(vehicle - value) > Math.max(5, value * 0.05)) issues.push({ id: `${record.id}-${peak}-${index}-vehicle`, severity: "warning", category: "車種統計異常", station: record.station, quarter: record.quarter, message: `${record.approaches[index].name} ${peak} 車種合計與轉向總量差 ${Math.abs(vehicle - value)} 輛。` });
      });
    }
    if (!record.date) issues.push({ id: `${record.id}-date`, severity: "error", category: "缺值", station: record.station, quarter: record.quarter, message: "缺少調查日期。" });
  }
  return issues;
}

export type IntervalRow = { start: number; label: string; values: number[] };

export function rollingPeak(rows: IntervalRow[], range: [number, number], intervalMinutes = 15) {
  const needed = Math.max(1, Math.round(60 / intervalMinutes));
  const candidates = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.start >= range[0] && row.start < range[1]);
  let best: { start: number; end: number; total: number; values: number[] } | null = null;
  for (const { row, index } of candidates) {
    const slice = rows.slice(index, index + needed);
    if (slice.length !== needed || slice.some((r, i) => i && r.start - slice[i - 1].start !== intervalMinutes)) continue;
    const values = Array.from({ length: Math.max(...slice.map((r) => r.values.length), 0) }, (_, col) => slice.reduce((sum, r) => sum + (Number(r.values[col]) || 0), 0));
    const total = values.reduce((a, b) => a + b, 0);
    if (!best || total > best.total) best = { start: row.start, end: row.start + 60, total, values };
  }
  return best;
}

function parseTime(value: unknown): number | null {
  if (typeof value === "number" && value >= 0 && value < 1) return Math.round(value * 24 * 60);
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
  warnings: string[];
};

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
  const intervalRows: IntervalRow[] = [];
  for (const sheetName of buckets.traffic) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
    for (const row of rows) {
      const start = parseTime(row[0]);
      if (start === null) continue;
      const values = row.slice(1).map(Number).filter(Number.isFinite);
      if (values.length) intervalRows.push({ start, label: String(row[0]), values });
    }
  }
  intervalRows.sort((a, b) => a.start - b.start);
  const role = /^T\d+[-_.]?\d+\.(xls|xlsx|xlsm)$/i.test(file.name.normalize("NFKC")) ? "參考計算檔" : intervalRows.length ? "原始交通量" : "無法辨識";
  const warnings: string[] = [];
  if (!buckets.log.length) warnings.push("未找到監測日誌工作表，路口幾何需人工確認。");
  if (!buckets.phase.length) warnings.push("未找到時相圖工作表；V/C 可能缺少號誌參數。");
  if (!intervalRows.length) warnings.push("未辨識到以時間開頭的交通量資料列。");
  return {
    file: file.name,
    station: stationFromFilename(file.name),
    name: normalizeIntersectionName(file.name),
    role,
    sheets: buckets,
    intervals: intervalRows.length,
    am: rollingPeak(intervalRows, [5 * 60, 12 * 60]),
    pm: rollingPeak(intervalRows, [12 * 60, 23 * 60]),
    warnings,
  };
}

export function formatMinutes(minutes: number) {
  const value = (minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
