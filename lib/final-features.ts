import { canonicalIntersectionKey } from "./traffic.ts";
import type { PeakKey, TrafficRecord } from "./traffic";

/**
 * 季度的排序鍵。
 *
 * 季度字串是「年＋Q＋季」，年可能是民國兩碼（99Q4）、三碼（115Q1）或
 * 西元四碼（2026Q1）。直接拿字串比大小會排錯：
 *   "100Q1" < "99Q4"（字串）但 民國100Q1 其實在 99Q4 之後；
 *   "115Q4" < "2026Q1"（字串）但 2026Q1 就是民國 115Q1，在 115Q4 之前。
 * 這裡一律換算成「西元年 × 4 + 季」再比，兩種寫法就能正確混排。
 */
export function quarterOrderKey(quarter: string): number {
  const match = String(quarter || "").match(/^(\d{2,4})Q([1-4])$/);
  if (!match) return Number.NEGATIVE_INFINITY;
  const year = Number(match[1]);
  // 四碼視為西元；兩碼與三碼視為民國，加 1911 換成西元。
  const gregorian = match[1].length === 4 ? year : year + 1911;
  return gregorian * 4 + Number(match[2]);
}

/** 依季度先後排序的比較器，可直接丟給 Array.prototype.sort。 */
export function compareQuarters(a: string, b: string) {
  return quarterOrderKey(a) - quarterOrderKey(b) || a.localeCompare(b);
}

/**
 * 一筆紀錄屬於哪一個路口。名稱正規化之後才比對，所以「中正路／民生路口」與
 * 「中正路-民生路」會歸為同一個路口。
 */
export function recordIntersectionKey(record: TrafficRecord) {
  return (
    canonicalIntersectionKey(record.name) ||
    record.intersectionId ||
    record.station
  );
}

export type TrendSeries = {
  /** 依季度排好、每季至多一筆的趨勢資料。 */
  rows: TrafficRecord[];
  /** 這條線實際用到的站號（依季度先後）。 */
  stations: string[];
  /** 同一季就同時存在多個站號——需要使用者指定要看哪一個站。 */
  parallelStations: boolean;
  /** 站號逐年換過，但每一季都只有一個站——已串接成同一條線。 */
  chainedStations: boolean;
  /** parallelStations 時實際採用的站號。 */
  station: string;
  /** 同一路口在範圍內出現過的所有站號（供選單使用）。 */
  availableStations: string[];
};

const EMPTY_TREND: TrendSeries = {
  rows: [],
  stations: [],
  parallelStations: false,
  chainedStations: false,
  station: "",
  availableStations: [],
};

/**
 * 歷季趨勢要取哪幾筆。
 *
 * Excel 的「歷季趨勢比較」、畫面上的折線圖與報告文字草稿都必須用同一組
 * 資料，否則報告寫的變動幅度會跟附表、跟畫面對不起來。所以挑選規則只寫
 * 在這裡一次，三邊共用。
 *
 * 一定要成立的兩個條件：
 * ・同一路口——這是「趨勢」的定義。
 * ・同一資料別——同一季常常同時有平日與假日兩筆，混在一起會讓「較前季」
 *   變成假日跟平日相比。
 *
 * 站號則**不能**無條件當成篩選條件。站號是標案／年度給的編號，同一個路口
 * 很常換（111 年是 T13-04、115 年變成 T15-04）。v2.1.9 曾經把「站號相同」
 * 也列為必要條件，結果是：使用者明明有 111Q3～115Q2 共 16 季的資料，畫面
 * 只留下最早那一季的站號能對得上的紀錄，折線圖顯示「至少需要兩季資料」，
 * 整個歷季趨勢等於不能用。
 *
 * 但站號當初是為了解決一個真實問題才加的：「岡山交流道路口(北向)」與
 * 「(南向)」會被名稱正規化成同一個 key，同一季出現兩個點，「較前一季」
 * 變成北向對南向。
 *
 * 這兩件事其實可以分辨，判準是「同一季裡有沒有出現兩個以上的站號」：
 * ・沒有（每季都只有一筆）→ 站號是隨年度換的，直接串成一條線，
 *   並回報 chainedStations，由呼叫端提示使用者站號有變動。
 * ・有 → 是並存的兩個站（北向／南向），這時才需要指定站號；
 *   預設沿用目前選定紀錄的站號，沒有就取涵蓋季數最多的那一個。
 */
export function buildTrendSeries(
  records: TrafficRecord[],
  options: {
    intersectionKey: string;
    surveyType?: string;
    quarters?: string[] | null;
    preferStation?: string;
  },
): TrendSeries {
  const wanted = options.quarters ? new Set(options.quarters) : null;
  const surveyType = options.surveyType;
  const candidates = records.filter(function (record) {
    if (recordIntersectionKey(record) !== options.intersectionKey) return false;
    if (wanted && !wanted.has(record.quarter)) return false;
    if (surveyType && (record.surveyType || "待設定") !== surveyType)
      return false;
    return true;
  });
  if (!candidates.length) return EMPTY_TREND;

  const byQuarter = new Map<string, TrafficRecord[]>();
  for (const record of candidates) {
    const bucket = byQuarter.get(record.quarter);
    if (bucket) bucket.push(record);
    else byQuarter.set(record.quarter, [record]);
  }
  const availableStations = Array.from(
    new Set(candidates.map((record) => record.station)),
  ).sort();
  const parallelStations = Array.from(byQuarter.values()).some(function (
    bucket,
  ) {
    return new Set(bucket.map((record) => record.station)).size > 1;
  });

  // 每個站號涵蓋幾季——並存站號時用來決定預設要看哪一個。
  const coverage = new Map<string, number>();
  for (const [, bucket] of byQuarter)
    for (const station of new Set(bucket.map((record) => record.station)))
      coverage.set(station, (coverage.get(station) || 0) + 1);

  let station = "";
  if (parallelStations) {
    station =
      options.preferStation && coverage.has(options.preferStation)
        ? options.preferStation
        : Array.from(coverage.entries()).sort(function (a, b) {
            return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
          })[0][0];
  }

  const rows = Array.from(byQuarter.entries())
    .map(function ([, bucket]) {
      const pool = station
        ? bucket.filter((record) => record.station === station)
        : bucket;
      if (!pool.length) return null;
      if (pool.length === 1) return pool[0];
      // 同一季、同一站號還是有兩筆時，取最後匯入的那一筆，結果才穩定。
      return pool
        .slice()
        .sort(function (a, b) {
          return String(a.importedAt || "") < String(b.importedAt || "")
            ? -1
            : String(a.importedAt || "") > String(b.importedAt || "")
              ? 1
              : 0;
        })
        .at(-1) as TrafficRecord;
    })
    .filter(function (record): record is TrafficRecord {
      return Boolean(record);
    })
    .sort(function (a, b) {
      return compareQuarters(a.quarter, b.quarter);
    });

  const stations = Array.from(new Set(rows.map((record) => record.station)));
  return {
    rows,
    stations,
    parallelStations,
    chainedStations: !parallelStations && stations.length > 1,
    station: station || stations[0] || "",
    availableStations,
  };
}

/** 報表與 Excel 用的薄包裝：以目前選定紀錄為準取出趨勢資料列。 */
/**
 * 挑出這批紀錄要畫哪一個路口的歷季趨勢。
 *
 * 優先用畫面上正在看的那一個（focus）。找不到時**不能**退回
 * exportRecords[0]——那是匯入順序決定的任意一筆。批次成果包會為每個計畫
 * 各產生一份 Excel，而 focus 只可能來自目前開著的那個計畫，於是其他計畫的
 * 「歷季趨勢比較」工作表拿到的都是那個任意路口，使用者無從察覺。
 * 改成挑「季度數最多」的那一個路口——趨勢表的用意就是看變化，
 * 季度最多的那一個才是最有內容的預設值。
 */
export function trendSeriesTarget(
  exportRecords: TrafficRecord[],
  focus: TrafficRecord | null,
) {
  const matched = focus
    ? exportRecords.find(function (record) {
        return recordIntersectionKey(record) === recordIntersectionKey(focus);
      })
    : undefined;
  if (matched) return matched;
  const byIntersection = new Map<string, TrafficRecord[]>();
  for (const record of exportRecords) {
    const key = recordIntersectionKey(record);
    const bucket = byIntersection.get(key);
    if (bucket) bucket.push(record);
    else byIntersection.set(key, [record]);
  }
  let best: TrafficRecord | undefined;
  let bestQuarters = -1;
  for (const [, group] of byIntersection) {
    const quarters = new Set(group.map((record) => record.quarter)).size;
    /* 同分時取站號較小的，結果才穩定（不受匯入順序影響）。 */
    if (
      quarters > bestQuarters ||
      (quarters === bestQuarters && best && group[0].station < best.station)
    ) {
      bestQuarters = quarters;
      best = group[0];
    }
  }
  return best || exportRecords[0];
}

export function trendSeriesRecords(
  exportRecords: TrafficRecord[],
  focus: TrafficRecord | null,
) {
  const trendTarget = trendSeriesTarget(exportRecords, focus);
  if (!trendTarget) return [];
  const intersectionKey = recordIntersectionKey(trendTarget);
  /*
   * 資料別也要挑「季度數最多」的那一種，不能直接用 trendTarget 自己的。
   * 只挑路口的話，trendTarget 是該路口在陣列裡的第一筆，資料別由匯入順序
   * 決定；一個「1 季假日排在最前、另有 5 季平日」的路口會只剩 1 列，
   * 比隨便挑另一個路口還糟——而趨勢表的用意就是看變化。
   */
  const sameIntersection = exportRecords.filter(function (record) {
    return recordIntersectionKey(record) === intersectionKey;
  });
  const quartersByType = new Map<string, Set<string>>();
  for (const record of sameIntersection) {
    const type = record.surveyType || "待設定";
    const bucket = quartersByType.get(type);
    if (bucket) bucket.add(record.quarter);
    else quartersByType.set(type, new Set([record.quarter]));
  }
  let surveyType = trendTarget.surveyType || "待設定";
  let bestCount = -1;
  for (const [type, quarters] of quartersByType) {
    /* 同分時取字典序較小的，結果才穩定（不受匯入順序影響）。 */
    if (quarters.size > bestCount || (quarters.size === bestCount && type < surveyType)) {
      bestCount = quarters.size;
      surveyType = type;
    }
  }
  return buildTrendSeries(exportRecords, {
    intersectionKey,
    surveyType,
    preferStation: trendTarget.station,
  }).rows;
}

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
        // 對角線＝迴轉（從 X 出發又回到 X）。舊版一律回 0，於是原始檔若有
        // 「往A」欄在 A 區塊裡，那些迴轉量會從 OD 工作表整個消失，
        // 但駛入／駛出與守恆檢核都算得到它——同一份成果裡的總量互相矛盾。
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
    // 「連續」不能只看最後一格有沒有收在 +60 分。中間缺一格的話（例如
    // 07:30~07:45 沒調查），最後一格仍然結束在 08:00，舊的判斷就把只有 45
    // 分鐘資料的區間當成完整的一小時尖峰，尖峰量因此被低估、排名也跟著錯。
    // 這裡改成逐格檢查首尾相接。
    let continuous = selected.length > 0 && selected[0].start === item.start;
    for (let i = 1; continuous && i < selected.length; i += 1)
      if (selected[i].start !== selected[i - 1].end) continuous = false;
    if (continuous && selected[selected.length - 1].end !== item.start + 60)
      continuous = false;
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
    // 起點與終點兩邊都要看。舊版只查目的支線，於是「起點支線被刪掉」的孤兒
    // 流向完全不列入，畫面上的「未指定」是 0，而駛入與駛出合計已經對不起來，
    // 草稿還會叫使用者去檢查「目的支線」——指向錯的那一邊。
    const hasApproach = function (id: string) {
      return record.approaches.some(function (approach) {
        return approach.id === id;
      });
    };
    const unmapped = (record.routes || []).filter(function (route) {
      return !hasApproach(route.toApproachId) || !hasApproach(route.fromApproachId);
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
  /** 要檢查哪一種圖面樣式的畫布尺寸；預設用正式版（畫布最大）。 */
  style: "formal" | "standard" | "simple" = "formal",
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
  // 舊版只比對數據框彼此。但圖上還有兩塊固定的東西：右下角的流向圖例，
  // 以及正中央的路口名稱與尖峰時段。支線一多、或使用者把數據框往中間、
  // 往右下拉之後，這兩塊照樣會被蓋住，匯出前檢查卻顯示「版面正常」。
  const expanded = style === "formal" || (style === "standard" && record.approaches.length > 4);
  const width = expanded ? 1200 : 1000;
  const height = expanded ? 900 : 820;
  const cx = width / 2;
  const cy = expanded ? 470 : 430;
  const HALF_W = 115;
  const HALF_H = 62;
  const overlaps = (
    card: { x: number; y: number },
    box: { minX: number; maxX: number; minY: number; maxY: number },
  ) =>
    card.x + HALF_W > box.minX &&
    card.x - HALF_W < box.maxX &&
    card.y + HALF_H > box.minY &&
    card.y - HALF_H < box.maxY;
  // 圖例：translate(width-280, height-26)，三組項目往右展開約 250、字高約 26。
  const legendBox = { minX: width - 290, maxX: width - 20, minY: height - 44, maxY: height - 8 };
  // 中央標籤：路口名稱在 cy-15、尖峰在 cy+15，估一個保守的方框。
  const centerBox = { minX: cx - 150, maxX: cx + 150, minY: cy - 40, maxY: cy + 32 };
  points.forEach(function (point) {
    const card = { x: cx + point.x, y: cy + point.y };
    if (overlaps(card, legendBox))
      warnings.push(point.name + " 的數據框可能蓋住右下角的流向圖例");
    if (overlaps(card, centerBox))
      warnings.push(point.name + " 的數據框可能蓋住中央的路口名稱與尖峰時段");
  });
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
