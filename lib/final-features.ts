import type { PeakKey, TrafficRecord } from "./traffic";

export type VehicleScheme = {
  id: string;
  name: string;
  mappings: Record<string, string>;
  createdAt: string;
};

export type RecordRevision = {
  id: string;
  recordId: string;
  savedAt: string;
  reason: string;
  snapshot: TrafficRecord;
};

export function recordPeakTotal(record: TrafficRecord, peak: PeakKey) {
  return Math.round(
    record.approaches.reduce(function (sum, approach) {
      const movement = approach.movements[peak];
      return sum + movement.left + movement.through + movement.right;
    }, 0) * 10,
  ) / 10;
}

export function routePeakTotal(record: TrafficRecord, peak: PeakKey) {
  if (!record.routes?.length) return recordPeakTotal(record, peak);
  return Math.round(
    record.routes.reduce(function (sum, route) {
      return sum + Number(route.volumes[peak]?.pcu || 0);
    }, 0) * 10,
  ) / 10;
}

export function conservationCheck(record: TrafficRecord, peak: PeakKey) {
  const movement = recordPeakTotal(record, peak);
  const routes = routePeakTotal(record, peak);
  const difference = Math.round((movement - routes) * 10) / 10;
  return { movement, routes, difference, valid: Math.abs(difference) < 0.11 };
}

export function odMatrix(record: TrafficRecord, peak: PeakKey) {
  return record.approaches.map(function (origin) {
    return {
      originId: origin.id,
      origin: origin.name,
      values: record.approaches.map(function (destination) {
        if (origin.id === destination.id) return 0;
        return Math.round(
          (record.routes || [])
            .filter(function (route) {
              return route.fromApproachId === origin.id && route.toApproachId === destination.id;
            })
            .reduce(function (sum, route) {
              return sum + Number(route.volumes[peak]?.pcu || 0);
            }, 0) * 10,
        ) / 10;
      }),
    };
  });
}

export function branchBalance(record: TrafficRecord, peak: PeakKey) {
  return record.approaches.map(function (approach) {
    const outbound = (record.routes || []).filter(function (route) {
      return route.fromApproachId === approach.id;
    }).reduce(function (sum, route) {
      return sum + Number(route.volumes[peak]?.pcu || 0);
    }, 0);
    const inbound = (record.routes || []).filter(function (route) {
      return route.toApproachId === approach.id;
    }).reduce(function (sum, route) {
      return sum + Number(route.volumes[peak]?.pcu || 0);
    }, 0);
    const fallback = approach.movements[peak];
    const source = record.routes?.length ? outbound : fallback.left + fallback.through + fallback.right;
    return {
      id: approach.id,
      name: approach.name,
      inbound: Math.round(inbound * 10) / 10,
      outbound: Math.round(source * 10) / 10,
      difference: Math.round((inbound - source) * 10) / 10,
    };
  });
}

export function peakSensitivity(record: TrafficRecord) {
  const intervals = record.sourceTrace?.intervals || [];
  const windows = intervals.map(function (item) {
    const selected = intervals.filter(function (candidate) {
      return candidate.start >= item.start && candidate.start < item.start + 60;
    });
    const continuous = selected.length > 0 && selected[selected.length - 1].end === item.start + 60;
    return {
      start: item.start,
      end: item.start + 60,
      pcu: Math.round(selected.reduce(function (sum, candidate) { return sum + candidate.pcu; }, 0) * 10) / 10,
      vehicles: selected.reduce(function (sum, candidate) { return sum + candidate.vehicles; }, 0),
      continuous,
    };
  }).filter(function (item) { return item.continuous; });
  return windows
    .sort(function (a, b) { return b.pcu - a.pcu || a.start - b.start; })
    .slice(0, 8)
    .map(function (item, index) {
      return { ...item, rank: index + 1 };
    });
}

export function quarterQualitySummary(records: TrafficRecord[]) {
  return records.map(function (record) {
    const am = conservationCheck(record, "AM");
    const pm = conservationCheck(record, "PM");
    const unmapped = (record.routes || []).filter(function (route) {
      return !record.approaches.some(function (approach) { return approach.id === route.toApproachId; });
    }).length;
    return {
      record,
      am,
      pm,
      unmapped,
      valid: am.valid && pm.valid && unmapped === 0 && Boolean(record.date),
    };
  });
}

export function diagramCollisionWarnings(
  record: TrafficRecord,
  /** 要檢查哪一個顯示模式的版面；預設檢查駛入＋駛出。 */
  mode: "both" | "inbound" | "outbound" = "both",
) {
  const warnings: string[] = [];
  const points = record.approaches.map(function (approach) {
    const rad = (approach.angle * Math.PI) / 180;
    // 版面預警做粗略檢查：看目前要匯出的那個顯示模式實際套用的位移，
    // 該模式沒調整過時才退回舊欄位，否則在只看駛入／駛出調整過的版面
    // 會完全檢查不到重疊。
    const layout = approach.cardLayouts?.[mode];
    const offset =
      layout?.cards?.inbound ||
      layout?.cards?.outbound ||
      approach.cardOffsets?.inbound ||
      approach.cardOffsets?.outbound ||
      approach.cardOffset || { x: 0, y: 0 };
    return {
      name: approach.name,
      x: Math.cos(rad) * 390 + offset.x,
      y: Math.sin(rad) * 390 + offset.y,
    };
  });
  for (let left = 0; left < points.length; left++) {
    for (let right = left + 1; right < points.length; right++) {
      if (Math.abs(points[left].x - points[right].x) < 230 && Math.abs(points[left].y - points[right].y) < 125)
        warnings.push(points[left].name + " 與 " + points[right].name + " 的數據框可能重疊");
    }
  }
  return warnings;
}

/*
 * 報表匯出項目
 *
 * 不同計畫要交的東西不一樣：有的只要各路口「駛出」的尖峰流量，有的只要「駛入」，
 * 有的要車種分析加駛出流量。這裡把所有可匯出的分析結果列成清單，讓使用者依計畫
 * 勾選，勾到的才會出現在 Excel 裡；勾選內容也可以存成範本重複套用。
 */
export type ReportItemKey =
  | "trend"
  | "composition"
  | "inboundPeak"
  | "outboundPeak"
  | "inboundOutbound"
  | "compare"
  | "odMatrix"
  | "branchBalance"
  | "quality"
  | "pce";

export type ReportItem = {
  key: ReportItemKey;
  /** Excel 工作表名稱（Excel 上限 31 字元） */
  sheet: string;
  label: string;
  hint: string;
};

export const REPORT_ITEMS: ReportItem[] = [
  {
    key: "outboundPeak",
    sheet: "各路口駛出尖峰流量",
    label: "各路口駛出尖峰流量",
    hint: "每條支線的 AM／PM 尖峰駛出量（PCU/hr 與實際車輛數）與尖峰時段。",
  },
  {
    key: "inboundPeak",
    sheet: "各路口駛入尖峰流量",
    label: "各路口駛入尖峰流量",
    hint: "每條支線的 AM／PM 尖峰駛入量（PCU/hr 與實際車輛數）與尖峰時段。",
  },
  {
    key: "inboundOutbound",
    sheet: "駛入駛出各路口流量",
    label: "駛入＋駛出完整流量表",
    hint: "同一張表同時列出全日與 AM／PM 的駛入、駛出量，欄位最完整。",
  },
  {
    key: "composition",
    sheet: "車種組成分析",
    label: "路口車種組成分析",
    hint: "全調查時段與 AM／PM 各車種的數量與組成比例。",
  },
  {
    key: "trend",
    sheet: "歷季趨勢比較",
    label: "歷季趨勢比較",
    hint: "同一路口各季度的尖峰總流量；可另外附上原生 Excel 折線圖。",
  },
  {
    key: "compare",
    sheet: "跨計畫多路口比較",
    label: "跨計畫／多路口比較",
    hint: "各計畫、各路口、各支線的尖峰轉向總量與駛入駛出量。",
  },
  {
    key: "odMatrix",
    sheet: "OD轉向矩陣",
    label: "OD 轉向矩陣",
    hint: "起點支線 × 目的支線的尖峰流量矩陣。",
  },
  {
    key: "branchBalance",
    sheet: "支線流量平衡",
    label: "支線流量平衡檢核",
    hint: "每條支線駛入與駛出的差值，用來檢查資料是否守恆。",
  },
  {
    key: "quality",
    sheet: "資料品質檢核",
    label: "資料品質檢核",
    hint: "缺值、總數不一致、尖峰時段異常與車種統計異常的明細。",
  },
  {
    key: "pce",
    sheet: "車種轉向當量",
    label: "車種轉向當量參數",
    hint: "本次分析採用的各車種左轉／直行／右轉當量係數。",
  },
];

export const DEFAULT_REPORT_ITEMS: ReportItemKey[] = [
  "outboundPeak",
  "inboundPeak",
  "composition",
  "trend",
  "compare",
];

export type ReportTemplate = {
  id: string;
  name: string;
  items: ReportItemKey[];
  includeChart: boolean;
  createdAt: string;
};

/**
 * 只有「從來沒設定過」（undefined／不是陣列）才套用預設組合。
 * 使用者刻意把全部取消掉時會存成空陣列，那是有效的選擇，不能又被還原成預設，
 * 否則按了「全部取消」還是會匯出五張表。
 */
export function normalizeReportItems(value: unknown): ReportItemKey[] {
  const valid = new Set(REPORT_ITEMS.map(function (item) { return item.key as string; }));
  if (!Array.isArray(value)) return [...DEFAULT_REPORT_ITEMS];
  return value
    .map(String)
    .filter(function (key) { return valid.has(key); }) as ReportItemKey[];
}
