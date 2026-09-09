/**
 * ══════════════════════════════════════════════════════════════════
 *  歷季趨勢：可選指標、圖表講稿、跨計畫比較
 * ══════════════════════════════════════════════════════════════════
 *
 * 這一支的目的只有一個：**讓圖、右側摘要、講稿、匯出的 Excel／PNG 全部
 * 讀同一份 series**。
 *
 * 以前的做法是圖自己算一次、摘要自己算一次、Excel 再算一次，於是「圖上是
 * 駛入、旁邊標的卻是駛出」這種事發生過（v2.1.33 的點標籤）。這裡把
 * 「一個指標在一季是多少」收斂成唯一一支 `metricValue()`，其餘（圖、摘要、
 * 講稿、匯出）一律吃 `buildMetricSeries()` 的輸出，不再各自碰紀錄。
 *
 * ⚠️ 這一支**不新增任何交通量算法**。每一個指標的值都是呼叫既有、已經被
 * 測試釘住的函式取得的：
 *   ・路口總量 → recordTotal / routes（與畫面原本的駛出／駛入完全同一支）
 *   ・單一支線 → totalMovement（與路口明細同一支）
 *   ・單一轉向 → totalMovement(approach, scope, movementKey)
 *   ・實際車輛數／車種 → approach.movements[scope].vehicle（匯入時寫入的值）
 * 這樣「趨勢圖的數字」與「明細頁的數字」不可能對不起來——因為根本是同一個
 * 計算來源。
 */

import {
  type Approach,
  type MovementKey,
  type ScopeKey,
  type TrafficRecord,
  CORE_VEHICLE_LABELS,
  SCOPE_SHORT_LABELS,
  hasScopeValue,
  recordTotal,
  scopeUnit,
  totalMovement,
} from "./traffic.ts";
import { recordIntersectionKey } from "./final-features.ts";

/* ── 指標定義 ────────────────────────────────────────────────── */

export type TrendMetricId =
  | "total"
  | "vehicles"
  | "vehicleClass"
  | "vehicleShare"
  | "arm"
  | "movement";

/** 「駛出」與「駛入」是同一批流向的兩種分組方式，不是兩份資料。 */
export type TrendFlow = "outbound" | "inbound";

export type TrendMetricOption = {
  /** 指標需要再選一個對象時用：車種 id、支線名稱、或轉向 key。 */
  key?: string;
};

export type TrendMetricDef = {
  id: TrendMetricId;
  label: string;
  /** 單位；佔比是 "%"，其餘由統計範圍決定（PCU/hr 或 輛）。 */
  unit: "scope" | "vehicle" | "%";
  /** 小數位數。 */
  digits: number;
  /** 需要再選一個對象嗎？選什麼？ */
  picker: null | "vehicle" | "arm" | "movement";
  /** 這個指標會不會跟著「駛出／駛入」切換？ */
  flowAware: boolean;
  /** 一句話：這個指標是什麼、要拿來回答什麼問題。 */
  meaning: string;
};

export const TREND_METRICS: TrendMetricDef[] = [
  {
    id: "total",
    label: "路口總量",
    unit: "scope",
    digits: 1,
    picker: null,
    flowAware: true,
    meaning:
      "整個路口在這個統計範圍內的車流量（換算成小客車當量 PCU）。這是最常放進報告的一條線，回答的是「這個路口整體變忙還是變閒」。",
  },
  {
    id: "vehicles",
    label: "實際車輛數",
    unit: "vehicle",
    digits: 0,
    picker: null,
    flowAware: false,
    meaning:
      "同一個統計範圍內實際數到的車輛數（不做 PCU 換算）。與「路口總量」搭配著看，可以看出車種組成有沒有變——車輛數沒變但 PCU 上升，代表大型車變多。",
  },
  {
    id: "vehicleClass",
    label: "單一車種車輛數",
    unit: "vehicle",
    digits: 0,
    picker: "vehicle",
    flowAware: false,
    meaning:
      "指定車種在這個統計範圍內實際數到的車輛數。用來回答「機車是不是變多了」「大型車有沒有增加」這類問題。",
  },
  {
    id: "vehicleShare",
    label: "單一車種佔比",
    unit: "%",
    digits: 1,
    picker: "vehicle",
    flowAware: false,
    meaning:
      "指定車種佔全部實際車輛數的百分比。總量在成長時，佔比才看得出「組成」有沒有變化——總量與佔比可以一升一降。",
  },
  {
    id: "arm",
    label: "單一支線量",
    unit: "scope",
    digits: 1,
    picker: "arm",
    flowAware: true,
    meaning:
      "指定一支支線的車流量（PCU）。整個路口總量沒變、但某一支明顯上升時，代表車流路徑改變了，這通常才是要處理的問題。",
  },
  {
    id: "movement",
    label: "單一轉向量",
    unit: "scope",
    digits: 1,
    picker: "movement",
    flowAware: false,
    meaning:
      "整個路口所有支線的左轉／直行／右轉各自的合計（PCU）。左轉量的變化直接關係到號誌時制與左轉專用時相的需求。",
  },
];

export const MOVEMENT_LABELS: Record<MovementKey, string> = {
  left: "左轉",
  through: "直行",
  right: "右轉",
};

export function trendMetricById(id: string): TrendMetricDef {
  return (
    TREND_METRICS.find(function (metric) {
      return metric.id === id;
    }) || TREND_METRICS[0]
  );
}

/**
 * 指標在某一個統計範圍下的單位。
 *
 * ⚠️ **一律轉給 lib/traffic.ts 的 scopeUnit()，這裡不可以自己再判斷一次。**
 *
 * 舊版在這裡另外寫了一套，而且寫錯：車輛數不分統計範圍一律回「輛」，
 * 所以 AM／PM／全日尖峰的車輛數（那是**一小時內**的量）在趨勢圖上
 * 被標成「輛」，看的人會以為那是一整天的量。PCU 那一半有分
 *（FULL 回 PCU、其餘回 PCU/hr），車輛數這一半卻沒有——
 * 同一個判斷寫兩次，就一定會有一次沒跟上。
 *
 * 全日時段（FULL）是一整天的累計，單位是「／調查日」；
 * 三個尖峰都是一小時內的量，單位是「／hr」。這個規則全系統只有
 * scopeUnit() 說了算。
 */
export function metricUnit(metric: TrendMetricDef, scope: ScopeKey): string {
  if (metric.unit === "%") return "%";
  return scopeUnit(scope, metric.unit === "vehicle" ? "vehicle" : "pcu");
}

/**
 * 指標完整名稱（含選到的對象）。
 *
 * 圖標題、PNG 檔名、Excel 工作表、講稿都用這一支，避免同一張圖在四個地方
 * 出現四種寫法——使用者把 PNG 貼進簡報時，圖上的字和檔名對不起來很難解釋。
 */
export function metricLabel(
  metric: TrendMetricDef,
  option: TrendMetricOption,
  vehicleName?: (id: string) => string,
): string {
  if (metric.picker === "vehicle") {
    const id = option.key || "";
    const name = vehicleName ? vehicleName(id) : CORE_VEHICLE_LABELS[id] || id;
    return metric.id === "vehicleShare"
      ? `${name}佔比`
      : `${name}車輛數`;
  }
  if (metric.picker === "arm")
    return `${option.key || "支線"} 支線量`;
  if (metric.picker === "movement")
    return `${MOVEMENT_LABELS[(option.key as MovementKey) || "left"] || "轉向"}量`;
  return metric.label;
}

/* ── 取值 ────────────────────────────────────────────────────── */

/** 這一筆紀錄裡實際出現過的車種 id（與畫面的車種清單同一個判準）。 */
export function recordVehicleIdList(record: TrafficRecord): string[] {
  const ids = new Set<string>();
  Object.keys(record.vehicleLabels || {}).forEach(function (id) {
    ids.add(id);
  });
  record.approaches.forEach(function (approach) {
    Object.values(approach.movements || {}).forEach(function (row) {
      Object.keys(row?.vehicle || {}).forEach(function (id) {
        ids.add(id);
      });
    });
  });
  return Array.from(ids);
}

/** 一支支線在這個統計範圍的實際車輛數合計。 */
function armVehicleCount(
  record: TrafficRecord,
  approach: Approach,
  scope: ScopeKey,
  vehicleId?: string,
): number {
  const row = approach.movements?.[scope];
  if (!row) return 0;
  if (vehicleId) return Number(row.vehicle?.[vehicleId] || 0);
  return recordVehicleIdList(record).reduce(function (sum, id) {
    return sum + Number(row.vehicle?.[id] || 0);
  }, 0);
}

/** 駛入視角的路口總量：以「目的支線」分組，與畫面原本的算法完全相同。 */
function inboundTotal(record: TrafficRecord, scope: ScopeKey): number {
  const armIds = new Set(record.approaches.map((arm) => arm.id));
  const inbound = (record.routes || [])
    .filter(function (route) {
      return armIds.has(route.toApproachId);
    })
    .reduce(function (sum, route) {
      return sum + Number(route.volumes[scope]?.pcu || 0);
    }, 0);
  return Math.round(inbound * 10) / 10;
}

/** 一支支線的駛入量（以這一支為目的地的流向合計）。 */
function inboundArmTotal(
  record: TrafficRecord,
  approach: Approach,
  scope: ScopeKey,
): number {
  const inbound = (record.routes || [])
    .filter(function (route) {
      return route.toApproachId === approach.id;
    })
    .reduce(function (sum, route) {
      return sum + Number(route.volumes[scope]?.pcu || 0);
    }, 0);
  return Math.round(inbound * 10) / 10;
}

/**
 * 支線在不同季度之間怎麼對應。
 *
 * 支線 id 是匯入時產生的，季與季之間不會相同；能跨季對得起來的只有
 * **名稱**（使用者在「路口名稱管理」改過的名稱會被記住）與原始代碼
 * （路口A／B／C）。名稱優先，因為代碼在不同承辦的原始檔裡可能對調。
 */
export function armMatchKey(approach: Approach): string {
  return String(approach.name || "").trim() || String(approach.sourceCode || "");
}

export function findArm(
  record: TrafficRecord,
  key: string,
): Approach | undefined {
  const wanted = String(key || "").trim();
  if (!wanted) return undefined;
  return (
    record.approaches.find(function (approach) {
      return armMatchKey(approach) === wanted;
    }) ||
    record.approaches.find(function (approach) {
      return String(approach.sourceCode || "") === wanted;
    })
  );
}

export type MetricPoint = {
  quarter: string;
  record: TrafficRecord;
  /** 算得出來時的值；算不出來一律 null（**絕對不可以用 0 代替**）。 */
  value: number | null;
  /** 為什麼算不出來。有值時是空字串。 */
  missingReason: string;
};

/**
 * 一筆紀錄、一個指標、一個統計範圍 → 值。
 *
 * 回 null 代表「這一季算不出這個指標」，呼叫端必須畫成斷線與「－」。
 * ⚠️ 全日尖峰（DAY）在不足 24 小時的調查底下，底層相容欄位仍然是 0；
 * 直接畫 0 會變成「這一季流量歸零」，而事實是「這份調查算不出全日尖峰」。
 * 0 會被抄進報告，「－」不會。
 */
export function metricValue(
  record: TrafficRecord,
  metric: TrendMetricDef,
  scope: ScopeKey,
  option: TrendMetricOption,
  flow: TrendFlow,
): { value: number | null; missingReason: string } {
  if (!hasScopeValue(record, scope))
    return {
      value: null,
      missingReason:
        scope === "DAY"
          ? "這一季的調查不足 24 小時（或為舊版匯入），算不出全日尖峰小時"
          : "這一季沒有這個統計範圍的資料",
    };
  const useFlow = metric.flowAware ? flow : "outbound";

  if (metric.id === "total")
    return {
      value:
        useFlow === "inbound"
          ? inboundTotal(record, scope)
          : recordTotal(record, scope),
      missingReason: "",
    };

  if (metric.id === "vehicles")
    return {
      value: record.approaches.reduce(function (sum, approach) {
        return sum + armVehicleCount(record, approach, scope);
      }, 0),
      missingReason: "",
    };

  if (metric.id === "vehicleClass" || metric.id === "vehicleShare") {
    const id = option.key || "";
    if (!id) return { value: null, missingReason: "尚未選定車種" };
    const count = record.approaches.reduce(function (sum, approach) {
      return sum + armVehicleCount(record, approach, scope, id);
    }, 0);
    if (metric.id === "vehicleClass") return { value: count, missingReason: "" };
    const all = record.approaches.reduce(function (sum, approach) {
      return sum + armVehicleCount(record, approach, scope);
    }, 0);
    /*
     * 分母為 0 時**不可以**回 0%——那會被讀成「這一季這個車種一台都沒有」，
     * 而事實是「這一季根本沒有車輛數可以當分母」。
     */
    if (!all)
      return {
        value: null,
        missingReason: "這一季沒有可以當分母的實際車輛數，算不出佔比",
      };
    return { value: (count / all) * 100, missingReason: "" };
  }

  if (metric.id === "arm") {
    const approach = findArm(record, option.key || "");
    if (!approach)
      return {
        value: null,
        missingReason: `這一季找不到「${option.key || "所選支線"}」這一支支線（可能改過名稱，或這一季的路口幾何不同）`,
      };
    return {
      value:
        useFlow === "inbound"
          ? inboundArmTotal(record, approach, scope)
          : Math.round(totalMovement(approach, scope) * 10) / 10,
      missingReason: "",
    };
  }

  if (metric.id === "movement") {
    const movement = (option.key as MovementKey) || "left";
    const total = record.approaches.reduce(function (sum, approach) {
      return sum + totalMovement(approach, scope, movement);
    }, 0);
    return { value: Math.round(total * 10) / 10, missingReason: "" };
  }

  return { value: null, missingReason: "未知的指標" };
}

/**
 * 一條指標數列。
 *
 * points 一定與傳進來的 rows 一一對應、順序相同——圖、摘要、講稿、Excel
 * 都以 index 對齊，少一個點就會全部錯開。算不出來的季度留在陣列裡，
 * value 為 null。
 */
export type MetricSeries = {
  metric: TrendMetricDef;
  scope: ScopeKey;
  flow: TrendFlow;
  option: TrendMetricOption;
  /** 完整名稱，含選到的對象。 */
  label: string;
  unit: string;
  digits: number;
  points: MetricPoint[];
  /** 真正算得出來的點。 */
  valued: MetricPoint[];
};

export function buildMetricSeries(
  rows: TrafficRecord[],
  metric: TrendMetricDef,
  scope: ScopeKey,
  option: TrendMetricOption,
  flow: TrendFlow,
  vehicleName?: (id: string) => string,
): MetricSeries {
  const points: MetricPoint[] = rows.map(function (record) {
    const got = metricValue(record, metric, scope, option, flow);
    return {
      quarter: record.quarter,
      record,
      value: got.value,
      missingReason: got.missingReason,
    };
  });
  return {
    metric,
    scope,
    flow,
    option,
    label: metricLabel(metric, option, vehicleName),
    unit: metricUnit(metric, scope),
    digits: metric.digits,
    points,
    valued: points.filter(function (point) {
      return point.value !== null;
    }),
  };
}

/* ── 數字寫法 ────────────────────────────────────────────────── */

/** 數值加單位。百分比不空格，其餘空一格（「1,234 PCU/hr」「42.9%」）。 */
export function formatMetric(
  value: number | null,
  series: Pick<MetricSeries, "unit" | "digits">,
): string {
  if (value === null || !Number.isFinite(value)) return "－";
  const text = value.toLocaleString("zh-TW", {
    minimumFractionDigits: series.digits,
    maximumFractionDigits: series.digits,
  });
  return series.unit === "%" ? text + "%" : text + " " + series.unit;
}

/**
 * 兩個值之間的變化怎麼講。
 *
 * 中文簡報不說「幾個百分點」。做法是**先把兩端都講出來**，再說變化量，
 * 聽的人自然知道那個數字是怎麼來的：
 *   「從 113Q3 的 14.3%，到 114Q2 的 42.9%，整體上升 28.6%，大約是原來的 3 倍」
 * 要講 28.6% 還是 3 倍由使用者自己決定，我們把最完整的結果都給他。
 */
export function describeChange(
  from: number | null,
  to: number | null,
  series: Pick<MetricSeries, "unit" | "digits">,
): string {
  if (from === null || to === null) return "";
  const delta = to - from;
  const direction = delta > 0 ? "上升" : delta < 0 ? "下降" : "持平";
  if (delta === 0) return "持平";
  const magnitude = formatMetric(Math.abs(delta), series);
  const ratio = from !== 0 ? to / from : null;
  const times =
    ratio !== null && ratio > 0
      ? ratio >= 1
        ? `，大約是原來的 ${ratio.toFixed(ratio >= 10 ? 0 : 1)} 倍`
        : `，大約剩下原來的 ${(ratio * 100).toFixed(0)}%`
      : "";
  return `${direction} ${magnitude}${times}`;
}

/* ── 圖表講稿 ────────────────────────────────────────────────── */

export type TrendScriptSection = { title: string; lines: string[] };

/**
 * 這張圖的簡報講稿。
 *
 * 場景設定：使用者把這張圖貼進簡報，站在業主面前。他需要知道的是
 * 「這張圖在說什麼」「怎麼看」「重點在哪」「有什麼要先講清楚的」。
 *
 * ⚠️ 這裡**只讀 series**，不重新碰紀錄。講稿說的每一個數字都必須是圖上
 * 畫得出來的那一個，否則就會發生「圖上寫 A、講稿講 B」——而講稿是會被
 * 照著念出來的。
 */
export function trendScript(
  series: MetricSeries,
  context: {
    intersectionName: string;
    surveyType: string;
    quarterLabel: (quarter: string) => string;
    /** 駛出與駛入總量不相等時的差額（PCU/hr），0 代表兩邊對得起來。 */
    flowGap?: number;
    /** 站號歷年變動時串起來的清單。 */
    chainedStations?: string[];
  },
): TrendScriptSection[] {
  const sections: TrendScriptSection[] = [];
  const q = context.quarterLabel;
  const scopeName = SCOPE_SHORT_LABELS[series.scope] || series.scope;
  const flowText =
    series.metric.flowAware
      ? series.flow === "inbound"
        ? "以「駛入」分組（以目的支線歸屬）"
        : "以「駛出」分組（以起始支線歸屬）"
      : "";

  /* ① 這張圖在說什麼 */
  sections.push({
    title: "這張圖在說什麼",
    lines: [
      `這是「${context.intersectionName}」在 ${context.surveyType} 調查下，${scopeName}的「${series.label}」歷季變化。`,
      series.metric.meaning,
      flowText
        ? `本圖${flowText}。駛出與駛入是同一批流向的兩種分組方式，資料完整時路口總量會完全相等。`
        : "",
      `橫軸是季度，縱軸是${series.label}，單位是 ${series.unit === "%" ? "百分比" : series.unit}。`,
    ].filter(Boolean),
  });

  /* ② 重點變化 */
  const valued = series.valued;
  const lines: string[] = [];
  if (valued.length >= 2) {
    const first = valued[0];
    const last = valued[valued.length - 1];
    lines.push(
      `整段期間：從 ${q(first.quarter)} 的 ${formatMetric(first.value, series)}，` +
        `到 ${q(last.quarter)} 的 ${formatMetric(last.value, series)}，` +
        `整體${describeChange(first.value, last.value, series)}。`,
    );
    /* 相鄰兩季變化最大的那一次——業主最常問的就是「哪一季跳最多」。 */
    let biggest: { from: MetricPoint; to: MetricPoint; delta: number } | null =
      null;
    for (let i = 1; i < valued.length; i++) {
      const delta = (valued[i].value as number) - (valued[i - 1].value as number);
      if (!biggest || Math.abs(delta) > Math.abs(biggest.delta))
        biggest = { from: valued[i - 1], to: valued[i], delta };
    }
    if (biggest && biggest.delta !== 0)
      lines.push(
        `變化最大的一次落在 ${q(biggest.from.quarter)} 到 ${q(biggest.to.quarter)}：` +
          `從 ${formatMetric(biggest.from.value, series)} ` +
          `${describeChange(biggest.from.value, biggest.to.value, series)}。` +
          `這一段通常要說明原因（工程施工、路網調整、鄰近設施開業、或調查條件不同）。`,
      );
    const values = valued.map(function (point) {
      return point.value as number;
    });
    const maxPoint = valued[values.indexOf(Math.max(...values))];
    const minPoint = valued[values.indexOf(Math.min(...values))];
    if (maxPoint.quarter !== minPoint.quarter)
      lines.push(
        `期間最高是 ${q(maxPoint.quarter)} 的 ${formatMetric(maxPoint.value, series)}，` +
          `最低是 ${q(minPoint.quarter)} 的 ${formatMetric(minPoint.value, series)}。`,
      );
  } else if (valued.length === 1) {
    lines.push(
      `目前只有 ${q(valued[0].quarter)} 一季算得出來（${formatMetric(valued[0].value, series)}），` +
        `一個點畫不出趨勢，請不要在簡報上把它講成「上升」或「下降」。`,
    );
  } else {
    lines.push("所選範圍內沒有任何一季算得出這個指標，圖上不會有折線。");
  }
  sections.push({ title: "重點變化", lines });

  /* ③ 怎麼看這張圖 */
  const how: string[] = [
    "折線斷開的地方代表那一季「算不出來」，不是「歸零」——系統不會把算不出來的季度連過去，因為連過去等於宣稱中間有一個介於兩端之間的值。",
  ];
  if (series.metric.id === "vehicleShare")
    how.push(
      "佔比要和總量一起看：總量成長時，佔比下降不代表這個車種變少，只代表它成長得比其他車種慢。",
    );
  if (series.metric.id === "total" || series.metric.id === "arm")
    how.push(
      "PCU（小客車當量）不是車輛數。同樣 1,000 PCU，可能是 1,000 輛小客車，也可能是較少的大型車——要看車輛組成請切換到「實際車輛數」或「單一車種佔比」。",
    );
  if (series.metric.id === "movement")
    how.push(
      "轉向量是整個路口所有支線的合計。某一支線的左轉暴增、另一支線同時下降時，合計看起來會像沒有變化——要定位到支線請改用「單一支線量」。",
    );
  if (series.scope === "DAY")
    how.push(
      "「全日尖峰」是在完整 24 小時裡搜尋出來的最忙一小時，和 AM／PM 尖峰不一定落在同一個時段；跨季比較時可以在明細表確認每一季的尖峰時段。",
    );
  sections.push({ title: "怎麼看這張圖", lines: how });

  /* ④ 要先講清楚的（資料界線） */
  const caveats: string[] = [];
  const missing = series.points.filter(function (point) {
    return point.value === null;
  });
  if (missing.length)
    caveats.push(
      `有 ${missing.length} 季算不出來：` +
        missing
          .map(function (point) {
            return `${q(point.quarter)}（${point.missingReason}）`;
          })
          .join("、") +
        "。這幾季在圖上是斷開的，簡報時要主動說明，不要讓聽的人誤以為是下降。",
    );
  if (valued.length && valued.length < 3)
    caveats.push(
      `目前只有 ${valued.length} 季有值，樣本太少，看不出趨勢方向；建議至少累積 4 季再下「持續上升／下降」這種結論。`,
    );
  if (context.flowGap)
    caveats.push(
      `這個路口的「駛出」與「駛入」總量不相等，最大差 ${Math.abs(context.flowGap).toLocaleString()} PCU/hr——代表有流向沒有指定目的支線。` +
        `在補齊之前，「駛入」視角會少掉這個量，兩種視角不可以混著講。`,
    );
  if (context.chainedStations && context.chainedStations.length > 1)
    caveats.push(
      `本路口的站號歷年有變動（${context.chainedStations.join(" → ")}），已依路口名稱串接成同一條線。若這幾個站號其實不是同一個路口，這條線就不能這樣講。`,
    );
  if (context.surveyType === "待設定")
    caveats.push(
      "本圖的資料別是「待設定」——那幾季在匯入當下讀不出平日／假日。平日與假日混在一起比較沒有意義，請先到「流量核對工作台」指定資料別。",
    );
  if (!caveats.length)
    caveats.push(
      "所選範圍內每一季都算得出來，折線沒有斷點；駛出與駛入總量一致，兩種視角可以互相核對。",
    );
  sections.push({ title: "要先講清楚的", lines: caveats });

  return sections;
}

/* ── 跨計畫比較 ──────────────────────────────────────────────── */

/**
 * 跨計畫歷季趨勢。
 *
 * ⚠️ **絕對不可以比總量。** 每個計畫的路口數量本來就不一樣——A 計畫 12 個
 * 路口、B 計畫 3 個，總量畫在一起只會證明「A 比較大」，那是已知的，不是
 * 資訊。這裡一律換算成**每路口平均**，並把該季的路口數（N）帶在點上，
 * 讓看的人知道這個平均是幾個路口平均出來的。
 *
 * 佔比類指標（車種佔比）本來就是比例，改用**加權平均**：分子分母各自
 * 加總再相除，而不是把各路口的百分比再平均一次——後者會讓一個很小的
 * 路口和一個很大的路口有同樣的份量。
 */
export type CrossProjectPoint = {
  quarter: string;
  /** 每路口平均（佔比指標則是加權平均）。 */
  value: number | null;
  /** 這一季有幾個路口算得出來。 */
  count: number;
  /** 這一季總共有幾個路口（含算不出來的）。 */
  total: number;
};

export type CrossProjectSeries = {
  projectId: string;
  projectName: string;
  points: CrossProjectPoint[];
};

export type CrossProjectTrend = {
  quarters: string[];
  series: CrossProjectSeries[];
  metric: TrendMetricDef;
  scope: ScopeKey;
  label: string;
  unit: string;
  digits: number;
  /** 平均的說明字樣，畫在圖上與講稿裡。 */
  basis: string;
};

export function buildCrossProjectTrend(
  projects: Array<{ id: string; name: string; records: TrafficRecord[] }>,
  metric: TrendMetricDef,
  scope: ScopeKey,
  option: TrendMetricOption,
  flow: TrendFlow,
  compareQuartersFn: (a: string, b: string) => number,
  vehicleName?: (id: string) => string,
): CrossProjectTrend {
  /*
   * 頭尾之間整季沒有資料的季度要補成空格，X 軸的間距才對應真實時間。
   * 補出來的季在每一個計畫底下都查不到紀錄，值一律 null，折線會斷開。
   */
  const quarters = completeQuarterRange(
    Array.from(
      new Set(
        projects.flatMap(function (project) {
          return project.records.map(function (record) {
            return record.quarter;
          });
        }),
      ),
    ).sort(compareQuartersFn),
  );

  const series = projects.map(function (project) {
    /*
     * ⚠️ 一季一個路口只能算一筆。
     *
     * 同一個路口同一季可能有兩筆（平日與假日，或重新匯入過），全部丟進去
     * 平均的話有兩個後果：一是把平日與假日混在一起平均——那是一個不對應
     * 任何一天的數字，沒有應用意義；二是 N（路口數）會被算成筆數，
     * 「12 個路口」變成「24 筆」，平均值整個錯掉。
     *
     * 呼叫端應該先把資料別過濾成單一種（見畫面上的「資料別」選單）；
     * 這裡再以路口鍵去重一次當作最後一道防線，同一個路口取最後匯入的那筆。
     */
    const byQuarter = new Map<string, Map<string, TrafficRecord>>();
    for (const record of project.records) {
      const bucket = byQuarter.get(record.quarter) ?? new Map<string, TrafficRecord>();
      const key = recordIntersectionKey(record);
      const seen = bucket.get(key);
      if (
        !seen ||
        String(seen.importedAt || "") <= String(record.importedAt || "")
      )
        bucket.set(key, record);
      byQuarter.set(record.quarter, bucket);
    }
    const points = quarters.map(function (quarter): CrossProjectPoint {
      const bucket: TrafficRecord[] = Array.from(
        (byQuarter.get(quarter) || new Map<string, TrafficRecord>()).values(),
      );
      if (!bucket.length)
        return { quarter, value: null, count: 0, total: 0 };
      if (metric.id === "vehicleShare") {
        /* 加權平均：分子分母各自加總再相除。 */
        const id = option.key || "";
        let numerator = 0;
        let denominator = 0;
        let counted = 0;
        for (const record of bucket) {
          if (!hasScopeValue(record, scope)) continue;
          const part = record.approaches.reduce(function (sum, approach) {
            return sum + armVehicleCount(record, approach, scope, id);
          }, 0);
          const all = record.approaches.reduce(function (sum, approach) {
            return sum + armVehicleCount(record, approach, scope);
          }, 0);
          if (!all) continue;
          numerator += part;
          denominator += all;
          counted++;
        }
        return {
          quarter,
          value: denominator ? (numerator / denominator) * 100 : null,
          count: counted,
          total: bucket.length,
        };
      }
      const values = bucket
        .map(function (record) {
          return metricValue(record, metric, scope, option, flow).value;
        })
        .filter(function (value): value is number {
          return value !== null;
        });
      return {
        quarter,
        value: values.length
          ? values.reduce(function (sum, value) {
              return sum + value;
            }, 0) / values.length
          : null,
        count: values.length,
        total: bucket.length,
      };
    });
    return { projectId: project.id, projectName: project.name, points };
  });

  return {
    quarters,
    series,
    metric,
    scope,
    label: metricLabel(metric, option, vehicleName),
    unit: metricUnit(metric, scope),
    digits: metric.digits,
    basis:
      metric.id === "vehicleShare"
        ? "各計畫的加權平均（分子分母各自加總再相除，不是把各路口的百分比再平均一次）"
        : "各計畫的每路口平均（總量除以該季算得出來的路口數）",
  };
}

export function crossProjectScript(
  trend: CrossProjectTrend,
  quarterLabel: (quarter: string) => string,
): TrendScriptSection[] {
  const q = quarterLabel;
  const sections: TrendScriptSection[] = [];
  const scopeName = SCOPE_SHORT_LABELS[trend.scope] || trend.scope;

  sections.push({
    title: "這張圖在說什麼",
    lines: [
      `這是各計畫在 ${scopeName}的「${trend.label}」歷季比較，每一條線是一個計畫。`,
      `⚠️ 每個計畫的路口數量不一樣，所以圖上畫的**不是總量**，而是${trend.basis}。` +
        `直接比總量只會證明「路口比較多的計畫比較大」，那是已知的，不是資訊。`,
      "每一個點旁邊的 N 是那一季實際算得出來的路口數。N 差很多時（例如一個計畫 12 個路口、另一個只有 2 個），兩條線的穩定度本來就不同——路口少的那一條，單一路口的變化就足以讓整條線跳動。",
    ],
  });

  const lines: string[] = [];
  for (const item of trend.series) {
    const valued = item.points.filter(function (point) {
      return point.value !== null;
    });
    if (valued.length >= 2) {
      const first = valued[0];
      const last = valued[valued.length - 1];
      lines.push(
        `${item.projectName}：從 ${q(first.quarter)} 的 ${formatMetric(first.value, trend)}（N=${first.count}），` +
          `到 ${q(last.quarter)} 的 ${formatMetric(last.value, trend)}（N=${last.count}），` +
          `${describeChange(first.value, last.value, trend)}。`,
      );
    } else if (valued.length === 1) {
      lines.push(
        `${item.projectName}：只有 ${q(valued[0].quarter)} 一季有值（${formatMetric(valued[0].value, trend)}，N=${valued[0].count}），畫不出趨勢。`,
      );
    } else {
      lines.push(`${item.projectName}：所選範圍內沒有算得出來的季度。`);
    }
  }
  sections.push({ title: "各計畫的變化", lines });

  const caveats: string[] = [];
  const counts = trend.series.flatMap(function (item) {
    return item.points
      .filter(function (point) {
        return point.value !== null;
      })
      .map(function (point) {
        return point.count;
      });
  });
  if (counts.length) {
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    if (max >= min * 3 && min > 0)
      caveats.push(
        `各計畫的路口數差距很大（最少 ${min} 個、最多 ${max} 個）。路口數少的計畫，平均值容易被單一路口帶著跑，兩條線的抖動幅度不能直接拿來相比。`,
      );
    if (min === 1)
      caveats.push(
        "有計畫在某一季只有 1 個路口算得出來——那一季的「平均」其實就是那一個路口本身，不具代表性。",
      );
  }
  const partial = trend.series.filter(function (item) {
    return item.points.some(function (point) {
      return point.total > 0 && point.count < point.total;
    });
  });
  if (partial.length)
    caveats.push(
      `有計畫的某些季度只有部分路口算得出來（${partial
        .map(function (item) {
          return item.projectName;
        })
        .join("、")}），平均是用算得出來的那幾個算的。要知道是哪幾個路口沒算出來，請展開下方的明細表。`,
    );
  const sparse = trend.series.filter(function (item) {
    return (
      item.points.filter(function (point) {
        return point.value !== null;
      }).length < 2
    );
  });
  if (sparse.length)
    caveats.push(
      `${sparse
        .map(function (item) {
          return item.projectName;
        })
        .join("、")} 不足兩季，圖上不會有折線；這不是資料異常，只是還沒累積夠。`,
    );
  if (!caveats.length)
    caveats.push(
      "各計畫的路口數相當、每一季都算得出來，這幾條線可以直接互相比較。",
    );
  sections.push({ title: "要先講清楚的", lines: caveats });

  return sections;
}

/* ── 缺季補齊 ────────────────────────────────────────────────── */

/**
 * 把頭尾之間**真正沒有資料的整季**補進季度清單。
 *
 * ⚠️ 這不是美觀問題，是**看圖的人會讀錯**。假設某個路口只做了 113Q1 與
 * 114Q1，不補的話 X 軸只有兩格、兩個點緊鄰，折線看起來像「上一季到這一
 * 季」的變化——實際上中間隔了整整一年、四季。補上空格之後，X 軸的間距
 * 才對應真實時間，而缺的那幾季因為沒有值，折線會在那裡斷開
 *（斷線＝「這幾季沒調查」，不是「這幾季是 0」）。
 *
 * 保守處理，寧可不補也不要猜：
 *  - 只要有一個季度不是 `<年>Q<1-4>`（例如自訂期別名稱）就整批原樣回傳。
 *  - 民國三碼與西元四碼**混用**時原樣回傳——補出來的格子必須挑一種寫法，
 *    挑錯會讓 X 軸同時出現「113Q2」與「2024Q3」兩種格式。
 *  - 跨距離譜（超過 100 年）時原樣回傳，避免資料打錯字時補出上萬格。
 */
export function completeQuarterRange(quarters: string[]): string[] {
  if (quarters.length < 2) return quarters;
  let width: number | null = null;
  const keys: number[] = [];
  for (const raw of quarters) {
    const match = /^(\d{2,4})Q([1-4])$/.exec(String(raw ?? "").trim());
    if (!match) return quarters;
    const digits = match[1].length;
    if (width === null) width = digits;
    else if (width !== digits) return quarters;
    keys.push(Number(match[1]) * 4 + Number(match[2]) - 1);
  }
  const from = Math.min(...keys);
  const to = Math.max(...keys);
  if (to - from > 400) return quarters;
  const out: string[] = [];
  for (let key = from; key <= to; key += 1)
    out.push(String(Math.floor(key / 4)) + "Q" + ((key % 4) + 1));
  return out;
}

/**
 * 趨勢圖可以橫向捲動，但 canvas 匯出有瀏覽器尺寸上限。季度再多也把 SVG
 * 控制在安全寬度內，交給 labelStride 減少標籤，而不是產生數萬像素的圖片。
 */
export const MAX_TREND_CHART_WIDTH = 4800;
export function trendChartWidth(quarterCount: number): number {
  return Math.min(
    MAX_TREND_CHART_WIDTH,
    Math.max(780, 180 + Math.max(0, quarterCount) * 100),
  );
}
