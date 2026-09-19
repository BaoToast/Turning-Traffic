import { canonicalIntersectionKey, round1 } from "./traffic.ts";
/*
 * 這幾支都只是「照統計範圍取值」，尖峰與全日時段一體適用，
 * 所以參數型別是 ScopeKey 而不是 PeakKey——否則畫面切到全日時段時，
 * OD 矩陣、支線平衡、守恆檢查三張表就只能空著。
 */
import type { ScopeKey, TrafficRecord } from "./traffic";

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

/*
 * ⚠️ VehicleScheme（車種歸類方案）已於 2026-09-15 整組移除。
 *
 * 使用者原話：「這個車種歸類方案保存功能可以拿掉，不需要記憶。因為套用後，
 *   使用者還是得逐一確認當量參數是它要的，所花費的時間其實就等於它親自
 *   輸入當量係數，這功能似乎就不太需要了」。
 *
 * 另外三個理由（一起記著，免得有人又加回來）：
 *   ・按「套用」當下畫面毫無變化，它只影響**下一次匯入**——延遲生效的按鈕
 *     最容易被當成壞掉。
 *   ・它是跨計畫的全域範本，連「清除本機資料」都得為它多寫一段說明。
 *   ・全日交通量沒有這個功能，拿掉之後三支一致。
 *
 * ⚠️ 每個計畫**自己的**車種歸類（mappingsByProject）完全不受影響——
 *   那是資料的一部分，不是範本。
 */

export type RecordRevision = {
  id: string;
  recordId: string;
  savedAt: string;
  reason: string;
  snapshot: TrafficRecord;
  /*
   * 還原點以「一次操作」為單位。
   *
   * 原本是**每一筆紀錄各一個**：一次季度批次重新匯入覆蓋 65 個路口，
   * 就一口氣長出 65 個看不出差別的還原點，清單沒有人看得懂，
   * 而且丟舊資料時會把同一次操作切成兩半——還原回去只還原了一部分，
   * 比沒有還原點更危險。
   *
   * 改成同一次操作的每一筆共用一個 batchId，畫面依 batchId 收成一列
   * （「115Q2 重新匯入，涵蓋 65 個路口」），淘汰與刪除也一律整批進出。
   *
   * 三個欄位都是選填：**舊備份與舊資料沒有這些欄位**，讀回來時每一筆
   * 各自當成一個只含一筆的批次，照樣顯示、照樣還原得回去。
   */
  batchId?: string;
  batchLabel?: string;
  batchSize?: number;
};

/** 還原點最多保留幾「次操作」。超過就整批丟掉最舊的。 */
/**
 * 計畫名稱的字數上限。
 *
 * 使用者實測把名稱設得很長時，左側／清單的計畫卡片會撐破邊界
 * （全日交通量實測溢出 265px、路口轉向 60 字時溢出 431px）。
 * 修法是兩件事一起做，缺一不可：
 *   ① 這個上限，擋掉「整段文字貼進來」的極端情況；
 *   ② CSS 的平衡換行（text-wrap: balance），讓上限以內的長名稱
 *      平均分行而不是塞滿一行再溢出。
 *
 * 40 字是使用者定的：他現有最長的計畫名稱是 15 字，40 字很寬裕，
 * 正常命名幾乎不會撞到。三支程式用同一個數字。
 *
 * ⚠️ 這個上限只擋**新輸入**。既有超過 40 字的名稱照常顯示、照常可以編輯
 *    （只是不能再變長），不可以自動截斷別人已經存好的資料。
 */
export const PROJECT_NAME_LIMIT = 40;
/*
 * 計畫**編號**也要有上限。
 *
 * 使用者 2026-09-10 實測（附截圖）：
 *   「計畫名稱沒問題了，但忘記限制計畫編號（三個程式都是），
 *     當編號過長時會遮蓋到計畫名稱」
 *
 * ⚠️ 20 是「看得完又夠用」的長度：真實計畫代碼像 115-A01、11017-RKC02，
 *    最長的一種是「年度＋標案號＋標段」約 16 字。
 */
export const PROJECT_CODE_LIMIT = 20;

/**
 * 截字，但**不會把已經超長的既有值一刀砍掉**。
 *
 * ⚠️ 直接 `slice(0, limit)` 會有一個很難發現的副作用：
 *    舊資料裡本來就有 30 字的編號時，使用者只要點一下那個欄位、
 *    什麼都沒改，onChange 也可能被觸發（輸入法、瀏覽器自動填），
 *    於是**資料被無聲截短**。所以上限取「limit 與原值長度的較大者」：
 *    既有的超長值可以原樣留著、可以刪短，但不能再變得更長。
 */
export function capText(next: string, previous: string, limit: number): string {
  const allowed = Math.max(limit, previous.length);
  return next.length <= allowed ? next : next.slice(0, allowed);
}

/**
 * 「手動新增支線」的條數上限。
 *
 * 使用者 2026-09-10 指定：「新增支線處，可以有小字提醒（最多 7 個路口），
 * 手冊則記錄新增支線上線是 7 個路口，超過會無法再新增」。
 *
 * ⚠️ 這是**產品決定，不是技術限制**，註解要寫清楚以免日後有人誤會。
 * 實測（harness/arm-count-babe 那支演算法探針）：轉向解算
 * （movementTargetIndex → closestDestination）在 **4～12 支**都是一對一，
 * 每一支的左／直／右各自解到三個不同的目的支線，沒有重複。
 * 唯一的例外是 3 支（三岔），那是幾何上必然的——三岔只有兩個去向。
 *
 * 也就是說 8 支以上算得出來，只是：
 *   ・轉向圖的等角配置與數據卡版面是照 7 支以內設計的，更多支會很擠；
 *   ・實務上 7 叉已經是極少見的路口。
 * 所以上限訂在 7 是為了版面與實務，不是因為算不出來。
 *
 * ⚠️ **匯入不受這個上限限制**——匯入是照調查表實際有幾支就讀幾支，
 * 不可以拿這個常數去擋匯入。擋了會讓真實資料進不來，那是嚴重得多的問題。
 */
export const MANUAL_ARM_LIMIT = 7;

/**
 * 還原點保留幾「次操作」。
 *
 * ⚠️ 2026-09-15 由 30 降到 **8**。
 *
 * 理由：畫面上的「版本差異與還原」那一塊已經整組移除（使用者裁示：
 *   「使用者不會去使用，也不會去查看……如果你維護會用到，
 *     那一樣放在你看的到的程式碼裡就好了」），所以這份紀錄現在是
 *   **純維護用**，不是使用者的救援路徑。使用者真正會做的是
 *   「刪掉那一季重新匯入」與「還原備份檔」。
 *
 * 使用者 2026-09-15：「要保留幾筆都交由你自己決定，主要你自己覺得夠用就好，
 *   **不要明明只需要前 10 筆，你卻讓程式硬是留 100 筆來增加儲存空間的負荷**」。
 *
 * 選 8 的依據：維護時要回答的問題是「剛才那幾步做了什麼」，
 * 8 次操作足以涵蓋一輪匯入＋幾次人工修正；再往前的價值很低，
 * 而單一個七叉路口的快照實測就有 38.7 KB，一次批次匯入可以涵蓋幾十個路口，
 * 留 30 次等於讓備份檔多帶好幾十 MB 沒有人會看的東西。
 *
 * ⚠️ 下面的 REVISION_BYTE_BUDGET 仍然要留著：筆數上限擋不住
 *   「一次操作涵蓋幾十個路口」這種胖批次。
 */
export const REVISION_BATCH_LIMIT = 8;

/**
 * 還原點總量上限（位元組）。
 *
 * 只有筆數上限不夠：一次批次匯入可以涵蓋幾十個路口，
 * 而單一個七叉路口的快照實測就有 38.7 KB。改存 IndexedDB 之後空間
 * 大得多，但仍然不該無上限地長，否則備份檔會被還原點灌爆
 * （實測全日交通量的使用者備份，還原點佔了整份 67.1 MB 的 94%）。
 */
export const REVISION_BYTE_BUDGET = 20 * 1024 * 1024;

/**
 * 依「次操作」淘汰還原點：先砍到 REVISION_BATCH_LIMIT 次，
 * 再砍到 REVISION_BYTE_BUDGET 以內。永遠至少留最新的一次操作，
 * 而且**不會把同一次操作切成兩半**。
 *
 * 傳回的陣列維持原本的排序（新的在前）。
 */
export function trimRevisionBatches(items: RecordRevision[]) {
  const order: string[] = [];
  const groups = new Map<string, RecordRevision[]>();
  for (const item of items) {
    /* 舊資料沒有 batchId，用自己的 id 當批次鍵，等於一筆一批。 */
    const key = item.batchId || item.id;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(item);
  }
  let kept = order.slice(0, REVISION_BATCH_LIMIT);
  const sizeOf = function (key: string) {
    return JSON.stringify(groups.get(key) ?? []).length;
  };
  let total = kept.reduce(function (sum, key) {
    return sum + sizeOf(key);
  }, 0);
  while (kept.length > 1 && total > REVISION_BYTE_BUDGET) {
    total -= sizeOf(kept[kept.length - 1]);
    kept = kept.slice(0, -1);
  }
  const keptKeys = new Set(kept);
  return items.filter(function (item) {
    return keptKeys.has(item.batchId || item.id);
  });
}

export function recordPeakTotal(record: TrafficRecord, peak: ScopeKey) {
  return Math.round(
    record.approaches.reduce(function (sum, approach) {
      const movement = approach.movements[peak];
      return sum + movement.left + movement.through + movement.right;
    }, 0) * 10,
  ) / 10;
}

export function routePeakTotal(record: TrafficRecord, peak: ScopeKey) {
  if (!record.routes?.length) return recordPeakTotal(record, peak);
  return Math.round(
    record.routes.reduce(function (sum, route) {
      return sum + Number(route.volumes[peak]?.pcu || 0);
    }, 0) * 10,
  ) / 10;
}

export function conservationCheck(record: TrafficRecord, peak: ScopeKey) {
  const movement = recordPeakTotal(record, peak);
  const routes = routePeakTotal(record, peak);
  const difference = round1(movement - routes);
  return { movement, routes, difference, valid: Math.abs(difference) < 0.11 };
}

export function odMatrix(record: TrafficRecord, peak: ScopeKey) {
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

export function branchBalance(record: TrafficRecord, peak: ScopeKey) {
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
      inbound: round1(inbound),
      outbound: round1(source),
      difference: round1(inbound - source),
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

/*
 * ══════════════════════════════════════════════════════════════════
 *  匯出前排版預警：量真正畫出來的東西，不要另外估一份
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ 這一支在 v2.1.64 以前是**自己估位置**的：假設每個支線的數據框都排在
 *    半徑 390 的圓周上（`cos(角度) × 390 ＋ 手動位移`）。使用者 2026-09-10
 *    回報「我確認過卡片彼此沒重疊，為什麼還是跳警示」，原因就在這裡：
 *
 *    ① 支線**超過 4 個**時，繪圖端根本不是排在圓周上。它會改用外圍固定
 *       格位（上排 4、右側 3、下排 4、左側 3），再用最近距離配位。
 *       7 叉路口的實際版面與圓周估算**是兩個座標系**，必然對不上。
 *    ② 「駛入＋駛出」模式每個支線畫的是**兩張卡**（沿切線左右分開），
 *       舊估算一個支線只算一個點，連數量都不對。
 *    ③ 位置還會被畫布邊界夾住（clamp），估算完全沒有這一段。
 *
 *    誤報只是吵人；同一個錯誤反過來會**漏報真正重疊的**，那才是危險的一邊。
 *
 * 現在的做法：繪圖端（diagramLayout）在**推出每一個 <g transform> 的同一行**
 * 把該張卡的矩形記下來，這一支只吃那份矩形做真正的相交判斷。
 * 檢查與繪圖用的是同一組數字，不可能再各說各話。
 *
 * ⚠️ 不要為了「省一次 SVG 組字串」而在這裡重新推算位置——那正是原本的錯。
 *    量不到就不要報，寧可少報也不要報一個假的讓人去追。
 */
export type LayoutBox = {
  /** card＝可拖曳的數據框；legend／center＝圖上保留給固定元件的區域。 */
  kind: "card" | "legend" | "center";
  /** 報給使用者看的名字（數據框用「支線名 · 駛入／駛出」）。 */
  name: string;
  /** 左上角座標與尺寸，與 SVG 的 translate 完全一致。 */
  x: number;
  y: number;
  w: number;
  h: number;
};

/** 兩個矩形是否真的相交（相接不算，容忍 1px 的浮點誤差）。 */
function rectsOverlap(a: LayoutBox, b: LayoutBox) {
  const EPS = 1;
  return (
    a.x + a.w - EPS > b.x &&
    b.x + b.w - EPS > a.x &&
    a.y + a.h - EPS > b.y &&
    b.y + b.h - EPS > a.y
  );
}

/** 兩個矩形重疊面積占較小者的比例，用來過濾掉只擦到一點點的情形。 */
function overlapRatio(a: LayoutBox, b: LayoutBox) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return smaller > 0 ? (w * h) / smaller : 0;
}

export function diagramCollisionWarnings(boxes: LayoutBox[] | null | undefined) {
  const warnings: string[] = [];
  if (!boxes || !boxes.length) return warnings;
  const cards = boxes.filter(function (box) {
    return box.kind === "card";
  });
  const reserved = boxes.filter(function (box) {
    return box.kind !== "card";
  });
  for (let left = 0; left < cards.length; left += 1)
    for (let right = left + 1; right < cards.length; right += 1)
      if (rectsOverlap(cards[left], cards[right]))
        warnings.push(
          cards[left].name + " 與 " + cards[right].name + " 的數據框重疊了",
        );
  /*
   * 固定元件（右下角流向圖例、中央路口名稱與時段）用「重疊面積比例」而不是
   * 單純相交：卡片邊緣擦到圖例一兩個 pixel 在圖上看不出來，報出來只會讓人
   * 去追一個不存在的問題。真的蓋住時比例一定遠大於 4%。
   */
  cards.forEach(function (card) {
    reserved.forEach(function (zone) {
      if (overlapRatio(card, zone) > 0.04)
        warnings.push(card.name + " 的數據框蓋住" + zone.name);
    });
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
    /*
     * ⚠️ key 維持 "compare" **不可以改**——使用者存好的報表範本存的是這個
     * 鍵，改了舊範本就對不上。改的只有顯示名稱與工作表名稱。
     *
     * 舊名叫「跨計畫多路口比較」、說明寫「各計畫…」，但它的資料來源是
     * reportExportScope.records → projectRecords，**只有目前這一個計畫**，
     * 從來沒有跨過計畫。跨計畫比較於 2026-09-09 依使用者授權整組移除之後，
     * 這個名字會讓人以為移除沒做乾淨，所以一併正名。
     */
    key: "compare",
    sheet: "各路口支線尖峰流量",
    label: "各路口支線尖峰流量",
    hint: "每個路口、每條支線的上午／下午尖峰：轉向總量、駛出路口量、駛入路口量（PCU/hr）。",
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

/* ══════════════════════════════════════════════════════════════════
 *  尖峰小時的「內部」與「附近」——兩張新圖的資料來源
 * ══════════════════════════════════════════════════════════════════
 *
 * 這兩支回答的是既有圖表答不出來的兩個問題，而且**問的不是同一件事**：
 *
 *  ① peakQuarterHours()：**選定的那一小時裡面**，車流是平均分布還是
 *     集中在某一段 15 分鐘？→ 四格 15 分鐘柱狀圖
 *
 *  ② peakWindowSeries()：**一整天裡**，每一個連續 60 分鐘各是多少？
 *     尖峰是一根尖銳的峰，還是一片平坦的高原？→ 連續 60 分鐘折線圖
 *
 * ⚠️ 兩支都**只讀 sourceTrace.intervals**，不自己算任何交通量——
 *    那些值是匯入當時就算好、已被既有測試釘住的。新圖不得產生新的算法。
 */

/** "07:15" → 435；讀不出來回 null（不可以回 0，0 是真的午夜十二點）。 */
export function minutesOfClock(text: string | undefined | null): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * 選定尖峰小時內的每一格（通常是四格 15 分鐘）。
 *
 * 回 [] 的情況有三種，各自有意義，呼叫端要分開講給使用者聽：
 *   ・沒有逐格資料（舊版匯入的檔沒有 sourceTrace）
 *   ・這個統計範圍沒有尖峰視窗（例如全日尖峰算不出來）
 *   ・視窗內的格子不是 15 分鐘一格（例如整點一格的檔）
 */
export function peakQuarterHours(record: TrafficRecord, scope: ScopeKey) {
  const intervals = record.sourceTrace?.intervals || [];
  if (!intervals.length) return { cells: [], reason: "no-intervals" as const };
  const window = record.peaks?.[scope as "AM" | "PM" | "DAY"];
  const start = minutesOfClock(window?.start);
  const end = minutesOfClock(window?.end);
  if (start === null || end === null)
    return { cells: [], reason: "no-window" as const };
  const cells = intervals
    .filter(function (item) {
      return item.start >= start && item.end <= end;
    })
    .sort(function (a, b) {
      return a.start - b.start;
    });
  if (!cells.length) return { cells: [], reason: "no-cells" as const };
  /*
   * 只有「每一格都是 15 分鐘」才算適用。
   * 整點一格的檔會落在這裡回 not-quarter——那不是錯誤，是這張圖不適用，
   * 畫面要顯示說明而不是畫一根柱子假裝有結果。
   */
  const quarter = cells.every(function (item) {
    return item.end - item.start === 15;
  });
  if (!quarter) return { cells: [], reason: "not-quarter" as const };
  return { cells, reason: "ok" as const };
}

/**
 * 一整天裡**每一個**連續 60 分鐘視窗，**依時間排序**。
 *
 * ⚠️ 與 peakSensitivity() 的差別：那一支是「前 8 名、依大小排」，
 *    這一支是「全部、依時間排」。畫成圖一定要用時間軸——
 *    依名次排的折線圖只會畫出一條由高到低的斜線，看不出一天的形狀，
 *    而且那又變成一張排行榜（使用者已明確表示排名沒有意義）。
 */
export function peakWindowSeries(record: TrafficRecord) {
  const intervals = record.sourceTrace?.intervals || [];
  if (!intervals.length) return [];
  return intervals
    .map(function (item) {
      const selected = intervals.filter(function (candidate) {
        return candidate.start >= item.start && candidate.start < item.start + 60;
      });
      /* 「連續」要逐格首尾相接，中間缺一格就不算——與 peakSensitivity 同一套判斷 */
      let continuous = selected.length > 0 && selected[0].start === item.start;
      for (let i = 1; continuous && i < selected.length; i += 1)
        if (selected[i].start !== selected[i - 1].end) continuous = false;
      if (continuous && selected[selected.length - 1].end !== item.start + 60)
        continuous = false;
      return {
        start: item.start,
        end: item.start + 60,
        pcu:
          Math.round(
            selected.reduce(function (sum, c) { return sum + c.pcu; }, 0) * 10,
          ) / 10,
        vehicles: selected.reduce(function (sum, c) { return sum + c.vehicles; }, 0),
        continuous,
      };
    })
    .filter(function (item) { return item.continuous; })
    .sort(function (a, b) { return a.start - b.start; });
}
