/**
 * 報告文字草稿（路口轉向）。
 *
 * 與全日交通量那一支相同的作法：所有數字由畫面端算好之後傳進來，這裡只
 * 負責組字，因此可以用單元測試逐段驗證，不必開瀏覽器。
 *
 * ── 為什麼段落清單要綁著 REPORT_ITEMS ────────────────────────────
 * 匯出項目的勾選清單（REPORT_ITEMS）與草稿的段落清單如果各自維護，日後
 * 新增一種匯出內容時很容易只加了其中一邊，使用者就會遇到「這個項目匯得
 * 出來，草稿裡卻永遠不會提到」。所以草稿段落＝REPORT_ITEMS ＋ 幾個沒有
 * 對應工作表、但報告一定會寫的段落，並用測試確保一一對應。
 *
 * ── 這裡刻意「不」自己算任何交通量 ──────────────────────────────
 * 所有數字都必須由畫面端用產生 Excel 的同一批函式算好再傳進來。草稿如果
 * 自己另算一次，只要哪天匯出邏輯改了，報告文字就會跟 Excel 對不起來，
 * 而這種錯誤在報告送出去之前幾乎不會被發現。
 */
import { REPORT_ITEMS, type ReportItemKey } from "./final-features.ts";

/** 沒有對應工作表、但報告一定會寫到的段落。 */
export const DRAFT_ONLY_SECTIONS = [
  { key: "scope", label: "本次分析範圍（建議保留）" },
  { key: "sites", label: "各路口分項結果" },
] as const;

export type DraftOnlyKey = (typeof DRAFT_ONLY_SECTIONS)[number]["key"];
export type DraftSectionKey = ReportItemKey | DraftOnlyKey;

/** 草稿段落的順序：先講範圍，再依報告習慣的敘述順序。 */
export const DRAFT_SECTION_ORDER: DraftSectionKey[] = [
  "scope",
  "sites",
  "outboundPeak",
  "inboundPeak",
  "inboundOutbound",
  "odMatrix",
  "branchBalance",
  "composition",
  "trend",
  "compare",
  "quality",
  "pce",
];

export const DRAFT_SECTION_LABELS: Record<DraftSectionKey, string> = {
  ...Object.fromEntries(REPORT_ITEMS.map((item) => [item.key, item.label])),
  ...Object.fromEntries(DRAFT_ONLY_SECTIONS.map((item) => [item.key, item.label])),
} as Record<DraftSectionKey, string>;

export type ArmFlow = { name: string; am: number; pm: number };

export type ReportDraftContext = {
  projectName: string;
  /** 匯出的季度範圍，例如「115Q1～115Q4」；只有一季時就是那一季。 */
  quarterRange: string;
  quarterCount: number;
  intersectionCount: number;
  recordCount: number;
  /**
   * 支線、車種這類「不能跨路口／跨季度相加」的敘述，是以哪一筆資料為代表。
   * 例如「中正路口（115Q4、平日）」。
   */
  focusLabel: string;
  /** 尖峰時段：本範圍內出現最多次的那一組；不一致時由畫面端加註。 */
  peaks: { am: string; pm: string };
  /**
   * 各路口分項結果：整體總結之外，匯出範圍內每一筆路口季度資料各寫一段。
   *
   * 這裡收到的是已經算好的值（與 Excel 用的是同一批函式），草稿不再算一次。
   * 每個路口分 AM／PM 兩個尖峰各寫一行，時段標籤就是該筆自己的尖峰小時，
   * 所以不會有「拿別的路口的時段套在這個路口上」的問題。
   */
  siteSummaries: {
    name: string;
    peaks: {
      label: string;
      hour: string;
      /** 路口轉向總量（PCU/hr）。 */
      total: number;
      arms: { name: string; outbound: number; inbound: number }[];
      vehicles: { label: string; share: number }[];
    }[];
  }[];
  /** 分項結果因為筆數上限而沒有逐筆寫出來的筆數。 */
  siteOmitted: number;
  /** 各支線的駛出尖峰量（PCU/hr），已由大到小排序。 */
  outbound: ArmFlow[];
  /** 各支線的駛入尖峰量（PCU/hr），已由大到小排序。 */
  inbound: ArmFlow[];
  /** 各路口轉向總量的合計（與 Excel 的「路口轉向總量」同一個數字）。 */
  totals: { am: number; pm: number };
  /**
   * 匯出範圍內有幾筆是「舊版匯入、沒有逐條 OD 流向」的紀錄。
   * 這種紀錄的駛入／守恆數字是由幾何推算出來的，不是實際流向，
   * 不能拿來宣稱資料守恆——必須在文字裡講清楚。
   */
  routelessRecords: number;
  /** 由各支線流量加總而得的駛出／駛入合計，用來檢查是否守恆。 */
  flowTotals: {
    outboundAm: number;
    outboundPm: number;
    inboundAm: number;
    inboundPm: number;
  };
  vehicles: { label: string; count: number; share: number }[];
  /** 車種組成的統計範圍說明，例如「全調查時段」。 */
  compositionScope: string;
  /** 車種數量的單位，例如「輛/調查時段」。 */
  compositionUnit: string;
  /** 歷季趨勢的資料序列；與 Excel「歷季趨勢比較」同一個路口、同一種資料別。 */
  trend: { quarter: string; am: number; pm: number }[];
  /** 趨勢序列是哪一個路口、哪一種資料別。 */
  trendLabel: string;
  /**
   * 各路口比較：每個「路口 × 資料別」取範圍內最新一季，依上午尖峰轉向總量
   * 由大到小。名稱已含季度與資料別，例如「中正路口 115Q4（平日）」。
   * 一列 ≠ 一個路口，所以敘述與計數都要用「筆」而不是「個路口」。
   */
  compare: ArmFlow[];
  /** compare 涵蓋幾個不同的路口。只有一個路口時這一段沒有比較的意義。 */
  compareIntersections: number;
  /** OD 矩陣裡最大的一筆流量。 */
  topFlow: {
    station: string;
    peak: string;
    from: string;
    to: string;
    pcu: number;
  } | null;
  /** 支線平衡：駛入與駛出差值絕對值最大的一條。 */
  worstBalance: {
    station: string;
    peak: string;
    name: string;
    difference: number;
  } | null;
  conservation: { checked: number; passed: number };
  quality: { total: number; errors: number; warnings: number; topCategories: string[] };
  /** 當量係數；只有在全部資料共用同一組矩陣時才會被寫進草稿。 */
  factors: { label: string; left: number; through: number; right: number }[];
  /** 本次匯出的資料實際用到幾組當量矩陣。 */
  factorMatrixCount: number;
};

const nf = (value: number, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-TW", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";

// Number.isFinite 的判斷不能省：資料含非數值欄位時 recordTotal 會回 NaN，
// 少了這個守衛就會在報告裡寫出「減少 NaN%」。
const pct = (value: number) =>
  Number.isFinite(value)
    ? `${value >= 0 ? "增加" : "減少"} ${Math.abs(value).toFixed(1)}%`
    : "變動幅度無法計算（資料含非數值欄位）";

const armList = (rows: ArmFlow[], limit = 3) =>
  rows
    .slice(0, limit)
    .map((row) => `${row.name}（AM ${nf(row.am, 1)}、PM ${nf(row.pm, 1)} PCU/hr）`)
    .join("、");

const rest = (rows: unknown[], limit = 3, unit = "條支線", tail = "見表") =>
  rows.length > limit ? `，其餘 ${rows.length - limit} ${unit}${tail}` : "";

/** 兩個 PCU 數值是否可視為相等。各處都做到小數一位，所以用 0.05 當門檻。 */
const same = (a: number, b: number) => Math.abs(a - b) < 0.05;

/** 單一段落的內容。回傳空陣列代表「這一段目前沒有資料可寫」。 */
function sectionLines(key: DraftSectionKey, c: ReportDraftContext): string[] {
  switch (key) {
    case "scope": {
      return [
        `本次分析範圍：${c.quarterRange}（共 ${c.quarterCount} 個季度）、${c.intersectionCount} 個路口、${nf(c.recordCount)} 筆路口季度資料。`,
        `尖峰時段：上午 ${c.peaks.am}、下午 ${c.peaks.pm}。`,
        // 尖峰小時流量不能跨路口或跨季度相加（把 Q1 與 Q2 的尖峰量加起來
        // 沒有意義），所以支線與車種的敘述固定以一筆代表資料為準，並在這裡
        // 講清楚是哪一筆，其餘的完整數字請看工作表。
        `支線與車種的敘述以 ${c.focusLabel} 為代表，其餘路口與季度的完整數字請見各工作表。`,
      ];
    }
    case "sites": {
      if (!c.siteSummaries.length) return [];
      const lines = [
        "各路口分項結果（每一筆路口季度資料各自的尖峰時段與流量，時段標籤即為該筆自己的尖峰小時）：",
      ];
      for (const site of c.siteSummaries) {
        lines.push(`【${site.name}】`);
        for (const peak of site.peaks) {
          const arms = peak.arms.length
            ? `各支線駛出／駛入：${peak.arms
                .map(
                  (arm) =>
                    `${arm.name} ${nf(arm.outbound, 1)}／${nf(arm.inbound, 1)}`,
                )
                .join("、")} PCU/hr`
            : "";
          // 車種占比最多列 5 種，其餘併成一句，免得一個路口就佔掉半頁。
          const shown = peak.vehicles.slice(0, 5);
          const others = peak.vehicles.slice(5);
          const otherShare = others.reduce((sum, item) => sum + item.share, 0);
          const composition = shown.length
            ? `車種組成：${shown
                .map((item) => `${item.label} ${item.share.toFixed(1)}%`)
                .join("、")}${
                others.length
                  ? `、其餘 ${others.length} 種合計 ${otherShare.toFixed(1)}%`
                  : ""
              }`
            : "";
          const parts = [
            `路口轉向總量 ${nf(peak.total, 1)} PCU/hr`,
            arms,
            composition,
          ].filter(Boolean);
          lines.push(`・${peak.label}（${peak.hour}）：${parts.join("；")}。`);
        }
      }
      if (c.siteOmitted > 0)
        lines.push(
          `（另有 ${c.siteOmitted} 筆路口季度資料未逐筆列出，完整數字請見各工作表。）`,
        );
      return lines;
    }
    case "outboundPeak": {
      if (!c.outbound.length) return [];
      return [
        `${c.focusLabel} 各支線駛出尖峰流量（駛出路口X＝以支線 X 為起點、開往其他支線的車）：` +
          `${armList(c.outbound)}${rest(c.outbound)}。`,
      ];
    }
    case "inboundPeak": {
      if (!c.inbound.length) return [];
      return [
        `${c.focusLabel} 各支線駛入尖峰流量（駛入路口X＝以支線 X 為終點、由其他支線開來的車）：` +
          `${armList(c.inbound)}${rest(c.inbound)}。`,
      ];
    }
    case "inboundOutbound": {
      if (!c.totals.am && !c.totals.pm) return [];
      const lines = [
        `${c.focusLabel} 路口轉向總量：上午尖峰 ${nf(c.totals.am, 1)} PCU/hr、下午尖峰 ${nf(c.totals.pm, 1)} PCU/hr。`,
      ];
      const f = c.flowTotals;
      const amBalanced = same(f.outboundAm, f.inboundAm);
      const pmBalanced = same(f.outboundPm, f.inboundPm);
      lines.push(
        `各支線駛出合計：上午 ${nf(f.outboundAm, 1)}、下午 ${nf(f.outboundPm, 1)} PCU/hr；` +
          `各支線駛入合計：上午 ${nf(f.inboundAm, 1)}、下午 ${nf(f.inboundPm, 1)} PCU/hr。`,
      );
      // 「駛入合計＝駛出合計」是資料完整時才成立的性質，不能無條件寫死；
      // 有流向沒被分配到支線時它就不成立，那正是報告該提醒的地方。
      /*
       * 「守恆」只有在真的有逐條 OD 流向時才是一個檢查結果。
       * 舊版匯入的紀錄沒有 routes，駛入是用路口幾何推算的，加總必然等於
       * 駛出——宣稱「資料守恆」等於用同義反覆給使用者一個假的保證。
       */
      if (c.routelessRecords)
        lines.push(
          `注意：本範圍有 ${nf(c.routelessRecords)} 筆為舊版匯入、缺少逐條起點→終點流向的紀錄，` +
            "其駛入量是依路口幾何推算而得，兩側合計必然相等，不足以作為守恆的佐證。",
        );
      else
        lines.push(
          amBalanced && pmBalanced
            ? "同一統計範圍內，各支線的駛入合計與駛出合計相等，流向資料守恆。"
            : `駛入與駛出合計不一致（上午差 ${nf(f.inboundAm - f.outboundAm, 1)}、下午差 ${nf(f.inboundPm - f.outboundPm, 1)} PCU/hr），` +
              "請檢查是否有流向的目的支線未指定。",
        );
      return lines;
    }
    case "odMatrix": {
      if (!c.topFlow) return [];
      return [
        `OD 轉向矩陣中流量最高的一筆為 ${c.topFlow.station} ${c.topFlow.peak} 尖峰的 ` +
          `${c.topFlow.from} → ${c.topFlow.to}，${nf(c.topFlow.pcu, 1)} PCU/hr。`,
      ];
    }
    case "branchBalance": {
      const lines: string[] = [];
      if (c.worstBalance)
        lines.push(
          same(c.worstBalance.difference, 0)
            ? "支線流量平衡檢核：全部支線的駛入與駛出差值皆為 0，流向資料守恆。"
            : `支線流量平衡檢核：差值最大的是 ${c.worstBalance.station} ${c.worstBalance.peak} 尖峰的 ${c.worstBalance.name}，` +
              `駛入減駛出 ${nf(c.worstBalance.difference, 1)} PCU/hr，請確認是否有未分配的流向。`,
        );
      // 守恆檢核的結果不能被平衡檢核的早退吃掉——它是各自獨立的檢查，
      // 沒有支線資料時仍然要交代檢查了幾組。沒有任何一組可檢查時要講原因，
      // 不能靜靜略過（使用者會以為系統忘了檢查）。
      if (c.conservation.checked)
        lines.push(
          `轉向總量與流向總量的守恆檢核共檢查 ${c.conservation.checked} 組，通過 ${c.conservation.passed} 組。`,
        );
      else if (c.routelessRecords)
        lines.push(
          "本範圍的紀錄都缺少逐條起點→終點流向，無法進行轉向總量與流向總量的守恆檢核。",
        );
      return lines;
    }
    case "composition": {
      if (!c.vehicles.length) return [];
      return [
        `車種組成（${c.focusLabel}，${c.compositionScope}）：${c.vehicles
          .map((v) => `${v.label} ${v.share.toFixed(1)}%（${nf(v.count)} ${c.compositionUnit}）`)
          .join("、")}。`,
      ];
    }
    case "trend": {
      if (!c.trend.length) return [];
      const head =
        `歷季趨勢（${c.trendLabel}）：${c.trend
          .map((row) => `${row.quarter}（AM ${nf(row.am, 1)}、PM ${nf(row.pm, 1)} PCU/hr）`)
          .join("、")}。`;
      if (c.trend.length < 2) return [head];
      const last = c.trend[c.trend.length - 1];
      const previous = c.trend[c.trend.length - 2];
      const lines = [head];
      /*
       * 「前一季是 0」與「前一季算不出來」是兩回事，不能混為一談。
       * NaN 是 falsy，舊寫法會走進「由 0 增為 …」那一支，等於在報告裡宣稱
       * 上一季是零流量——而上面那一行才剛把它印成「—」（未知）。
       */
      const changeText = (now: number, before: number, unit = "PCU/hr") => {
        if (!Number.isFinite(before) || !Number.isFinite(now))
          return "變動幅度無法計算（資料含非數值欄位）";
        if (!before) return `由 0 增為 ${nf(now, 1)} ${unit}`;
        return pct(((now - before) / before) * 100);
      };
      const comparable =
        (Number.isFinite(previous.am) && previous.am) ||
        (Number.isFinite(previous.pm) && previous.pm);
      if (comparable)
        lines.push(
          `最新一季 ${last.quarter} 較前一季 ${previous.quarter}：` +
            `上午尖峰${changeText(last.am, previous.am)}、` +
            `下午尖峰${changeText(last.pm, previous.pm)}。`,
        );
      return lines;
    }
    case "compare": {
      // 用「路口數」而不是「列數」判斷。同一個路口的平日與假日是兩列，
      // 但那是日別比較不是路口比較，掛在「各路口比較」底下會誤導。
      if (c.compareIntersections < 2 || c.compare.length < 2) return [];
      return [
        `各路口比較（每個路口、每種資料別各取範圍內最新一季，共 ${c.compare.length} 筆、涵蓋 ${c.compareIntersections} 個路口，依上午尖峰轉向總量排序）：` +
          `${armList(c.compare, 5)}${rest(c.compare, 5, "筆", "，完整清單見表")}。`,
      ];
    }
    case "quality": {
      if (!c.quality.total)
        return ["資料品質檢核：未發現缺值、總數不一致、尖峰時段異常或車種統計異常。"];
      return [
        `資料品質檢核共 ${nf(c.quality.total)} 項（錯誤 ${nf(c.quality.errors)} 項、警示 ${nf(c.quality.warnings)} 項）` +
          `${c.quality.topCategories.length ? `，主要類別為 ${c.quality.topCategories.join("、")}` : ""}，` +
          "明細見「資料品質檢核」工作表。",
      ];
    }
    case "pce": {
      if (c.factorMatrixCount > 1)
        return [
          `本次匯出的資料共用到 ${c.factorMatrixCount} 組不同的當量矩陣（每一筆資料以匯入當下的設定換算），` +
            "各組係數詳見「車種轉向當量」工作表；此處不列單一組數值，以免報告誤引用。",
        ];
      if (!c.factors.length) return [];
      return [
        `車種轉向當量（左轉／直行／右轉）：${c.factors
          .map((f) => `${f.label} ${f.left}／${f.through}／${f.right}`)
          .join("、")}。`,
      ];
    }
    default:
      return [];
  }
}

/**
 * 產生草稿全文。
 * 沒有勾到的段落不會出現；勾了但沒有資料的段落會明確寫出來，
 * 而不是靜靜消失——不然使用者會以為系統漏寫。
 */
export function buildReportDraft(
  context: ReportDraftContext,
  enabled: DraftSectionKey[],
): string {
  const picked = new Set(enabled);
  const blocks: string[] = [
    `${context.projectName || "（未命名計畫）"} ${context.quarterRange} 路口轉向交通量分析報告草稿`,
  ];
  for (const key of DRAFT_SECTION_ORDER) {
    if (!picked.has(key)) continue;
    const lines = sectionLines(key, context);
    blocks.push(
      lines.length
        ? lines.join("\n")
        : `${DRAFT_SECTION_LABELS[key]}：目前範圍沒有可敘述的資料。`,
    );
  }
  blocks.push(
    "本段文字由系統依目前的匯出範圍自動產生，僅供撰寫報告時參考；正式引用前請核對原始調查檔、路口幾何與當量係數設定。",
  );
  return blocks.join("\n\n");
}
