"use client";

/*
 * 本元件刻意以 useMemo 快取大型 SVG 與跨季報表內容。資料更新一律透過
 * structuredClone 後寫回 state，但 React Compiler 無法證明這點，會把既有
 * memoization 報成無法保留；保留手動快取，避免七叉路口每次輸入都重建 SVG。
 */
/* eslint-disable react-hooks/preserve-manual-memoization */

import { PeakShapeCharts } from "./peak-shape-charts.tsx";
import { TurnPreview } from "./turn-preview.tsx";
import { isNamedArm } from "./arm-name";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useViewScrollMemory } from "./view-scroll";
import * as XLSX from "xlsx";

import JSZip from "jszip";
import { jsPDF } from "jspdf";
import {
  Approach,
  absentBeyondExpectation,
  auditArmMovements,
  bearingFromAngle,
  blankExplainedByArithmetic,
  canonicalIntersectionKey,
  CORE_VEHICLE_LABELS,
  DEFAULT_PCE,
  FlowLayoutMode,
  formatMinutes,
  ImportPreview,
  inspectWorkbookVariants,
  Movement,
  MovementKey,
  normalizeIntersectionName,
  PceMatrix,
  pceFactor,
  PeakKey,
  ScopeKey,
  PEAK_KEYS,
  recordWithApproachPeaks,
  recordWithMovementFilter,
  recordWithVehicleFilter,
  canSplitByVehicle,
  SCOPE_KEYS,
  SCOPE_LABELS,
  SCOPE_SHORT_LABELS,
  coverageOf,
  scopeUnit,
  scopeWindowLabel,
  coversFullDay,
  hasDayPeak,
  hasScopeValue,
  scopeValueOrNull,
  fullDayUnavailableReason,
  formatSurveyHours,
  emptyMovement,
  emptyScopeMovements,
  ensureRecordScopes,
  roundedPcu,
  Project,
  qualityIssues,
  pceMatrixIssue,
  referenceMovementForOd,
  recordTotal,
  peakWindowsFor,
  RouteFlow,
  totalMovement,
  vehiclePcuFor,
  pcuBreakdown,
  MOVEMENT_KEYS,
  TrafficRecord,
  VehicleKey,
  VERSION,
  lockStatus,
  LockStatus,
  isSameSurvey,
  stationFromFilename,
  round1,
  type NoonSide,
  displayIntersectionName,
} from "../lib/traffic";
import {
  ANY as SCOPE_ANY,
  conflictsIn as scopeConflictsIn,
  ownScope as ownPceScope,
  removeScope as removePceScope,
  resolveFactors as resolvePceFactors,
  scopeLabel as pceScopeLabel,
  upsertScope as upsertPceScope,
  type FactorScope,
} from "../lib/factor-scope";

/*
 * ⚠️ 固定的空陣列。
 *   每次 render 都寫 `|| []` 的話會產生**新的陣列**，
 *   任何以它為相依的 useMemo 都會每次重算，而且「有沒有覆寫」的
 *   === 比較永遠是 false。
 */
const EMPTY_SCOPES: FactorScope<PceMatrix>[] = [];
import {
  checkPeriodAgainstDate,
  findSurveyDate,
  periodDisplayLabel,
  quarterInYearStyle,
  surveyDateInYearStyle,
  YEAR_STYLE_LABELS,
  type YearStyle,
  periodMismatchPrompt,
  periodUnknownNotice,
  normalizeSurveyPeriod,
  checkSurveyPeriodInput,
  surveyPeriodInputMessage,
  PERIOD_DISPLAY_LABELS,
  type PeriodDateCheck,
  type PeriodDisplayMode,
} from "../lib/period-date";
import {
  branchBalance,
  conservationCheck,
  diagramCollisionWarnings,
  type LayoutBox,
  odMatrix,
  peakSensitivity,
  quarterQualitySummary,
  RecordRevision,
  PROJECT_NAME_LIMIT,
  PROJECT_CODE_LIMIT,
  capText,
  MANUAL_ARM_LIMIT,
  trimRevisionBatches,
  compareQuarters,
  recordIntersectionKey,
  REPORT_ITEMS,
  ReportItemKey,
  ReportTemplate,
  normalizeReportItems,
  trendSeriesRecords,
  buildTrendSeries,
} from "../lib/final-features";
import {
  TREND_METRICS,
  MOVEMENT_LABELS,
  type TrendMetricDef,
  type TrendMetricOption,
  type TrendFlow,
  armMatchKey,
  buildMetricSeries,
  completeQuarterRange,
  formatMetric,
  metricLabel,
  metricUnit,
  recordVehicleIdList,
  trendMetricById,
  trendChartWidth,
  trendScript,
} from "../lib/trend-metrics";
import { loadState, readRawState, saveState } from "../lib/state-storage";
/*
 * ⚠️ 受控數字輸入框**一律**走這一支，不要在畫面上再寫
 *   `<input type="number" value={數字} onChange={…Number(e.target.value)}>`。
 *   那個寫法會讓欄位被按空時黏一個 0（見 lib/number-field.tsx 的說明），
 *   tests/number-field-usage.test.mjs 會擋住新的違規。
 */
import { NumberField } from "../lib/number-field";
import {
  DRAFT_ONLY_SECTIONS,
  DRAFT_SECTION_LABELS,
  DRAFT_SECTION_ORDER,
  buildReportDraft,
  type DraftSectionKey,
  type ReportDraftContext,
} from "../lib/report-draft";
import {
  BRANCH_COMPOSITION_MODES,
  CONCLUSION_METRICS,
  DEFAULT_CONDITION,
  typedNameKey,
  buildConclusion,
  normalizeCondition,
  quarterKey as conclusionQuarterKey,
  quarterYear,
  selectRecords,
  type ConclusionCondition,
  type ConclusionScope,
  type ConclusionScopeKey,
  type ConclusionMetricKey,
  type ConclusionRecord,
  type ConclusionTemplate,
} from "../lib/conclusion";

/*
 * 按下按鈕之後，把「剛長出來的結果」帶到看得見的地方。
 *
 * 使用者回報（交通服務水準）：「路段管理」按下『預覽修改影響』之後畫面停在原地，
 * 不知道預覽已經長在下面，會以為程式沒反應。三支都做了同一件事的實測。
 *
 * 規則刻意訂得保守，因為「畫面亂跳」比「不跳」更惱人：
 *   ・結果已經整個看得到 → **完全不動**。按了之後結果就在原地的按鈕不受影響。
 *   ・結果在視窗外       → 才捲動，而且只捲到剛好看得見。
 *   ・使用者的系統設定要求減少動態效果 → 直接跳過去，不做平滑捲動。
 *
 * 只在「按了才會出現結果」的按鈕呼叫；每次輸入都會重畫的地方不要用，
 * 那會變成打一個字畫面跳一次。
 */
export function revealResult(el: Element | null | undefined) {
  if (!el || typeof el.getBoundingClientRect !== "function") return;
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const fullyVisible = rect.top >= 0 && rect.bottom <= vh;
  const fillsViewport = rect.top <= 0 && rect.bottom >= vh;
  if (fullyVisible || fillsViewport) return;
  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    el.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
  } catch {
    /* 舊瀏覽器不接受設定物件時，退回最陽春的用法 */
    el.scrollIntoView();
  }
}

type View =
  | "dashboard"
  | "projects"
  | "import"
  | "parameters"
  | "composition"
  | "inbound"
  | "peaks"
  | "diagram"
  | "trend"
  | "audit"
  | "advanced"
  | "conclusion"
  | "maintenance"
  | "names"
  | "geometry"
  | "delivery"
  | "batch"
  | "backup"
  | "help";
import {
  DEFAULT_MAIN_FILTERS,
  filtersFor,
  isDetached,
  detachedIds,
  setChartFilter,
  resetChart,
  resetAllCharts,
  isFiltered,
  chose,
  describeMain,
  inapplicableNote,
  FIELD_LABELS,
  PEAK_RULE_LABELS,
  MOVEMENT_CHOICE_LABELS,
  DAY_LABELS,
} from "./main-filters";
import {
  MainToolbar,
  ChartDetachNote,
  InapplicableNote,
} from "./main-toolbar";
import type {
  MainFilters,
  ChartOverrides,
  PeakChoice,
  PeakRule,
  DayChoice,
  MovementChoice,
  FlowView,
  DisplayChoice,
} from "./main-filters";

type DiagramStyle = "formal" | "standard" | "simple";
/*
 * 轉向圖上那個數字要顯示什麼。
 *   volume  ＝交通量（PCU；車種選單一車種時本來就是輛數）
 *   count   ＝車輛數（v2.1.30 新增，一律是實際調查到的輛數，不套當量）
 *   percent ＝佔比
 *   both    ＝交通量＋佔比
 */
/*
 * 轉向圖的「顯示」五種模式。
 *   volume        交通量（PCU）
 *   count         車輛數（輛）
 *   percent       百分比
 *   both          交通量＋百分比
 *   countPercent  車輛數＋百分比（v2.1.34 新增）
 *
 * 「這個模式要報 PCU 還是輛」全系統只由 displayValueKind() 說了算，
 * 圖、摘要、單位標籤都走它——以前這個判斷寫在轉向圖產生器的區域變數裡，
 * 外面拿不到，右側摘要只好自己再猜一次，於是猜錯。
 */
type DisplayMode = "volume" | "count" | "percent" | "both" | "countPercent";

const DISPLAY_MODE_KIND: Record<DisplayMode, "pcu" | "vehicle"> = {
  volume: "pcu",
  both: "pcu",
  percent: "pcu",
  count: "vehicle",
  countPercent: "vehicle",
};

function displayValueKind(mode: DisplayMode) {
  return DISPLAY_MODE_KIND[mode];
}

/** 這個模式要不要在數值旁邊附百分比。 */
function displayShowsPercent(mode: DisplayMode) {
  return mode === "percent" || mode === "both" || mode === "countPercent";
}

/** 這個模式要不要顯示數值本身（「百分比」模式只報比例）。 */
function displayShowsValue(mode: DisplayMode) {
  return mode !== "percent";
}
type ArrowMode = "all" | "focus";
// 顯示模式同時也是版面保存的單位，直接沿用 lib 的型別避免兩邊定義漂移
type FlowSummaryMode = FlowLayoutMode;
/*
 * 車種組成分析的「分析範圍」。
 *
 * SURVEY（全調查時段）＝這份檔案匯入到多少就算多少，**不等於全日**：
 * 只做 07–09＋17–19 的調查，它就是那 4 小時的累計。因此標籤一律把實際
 * 涵蓋時數寫出來（compositionScopeLabel），免得 4 小時被當成一整天。
 * 24 小時的調查底下，SURVEY 就等於全日時段。
 */
type CompositionScope = PeakKey | "SURVEY";

/** 分析範圍要怎麼寫——全系統只有這一支。 */
function compositionScopeLabel(
  record: TrafficRecord | null | undefined,
  scope: CompositionScope,
) {
  if (scope !== "SURVEY") return SCOPE_LABELS[scope];
  return record
    ? `全調查時段（${formatSurveyHours(record)}）`
    : "全調查時段";
}

/**
 * 分析範圍的單位。車種組成一律報實際車輛數，不套 PCU 當量。
 *
 * ⚠️ 2026-09-25 第六輪：這一支原本把 `SURVEY` 的單位**寫死**成「輛/調查時段」，
 *   而其餘範圍走 `scopeUnit()` 時**沒有傳涵蓋**，於是全調查時段也永遠是
 *   「輛/調查時段」。同一頁的範圍標籤（`compositionScopeLabel`）拿得到
 *   `record`、會寫出實際涵蓋時數，單位卻不跟著走——滿 24 小時的檔，
 *   標籤寫「全調查時段（24 小時）」而單位寫「輛/調查時段」，
 *   和同一批資料在別頁的「輛/調查日」互相矛盾。
 *
 *   `SURVEY` 與 `FULL` 的分母規則是**同一條**（見 lib 的 scopeUnit 註解：
 *   24 小時就是「調查時段剛好等於一日」），所以這裡把 `SURVEY` 直接映到
 *   `FULL` 去問同一支函式，不再自己寫死一份。
 */
function compositionScopeUnit(
  record: TrafficRecord | TrafficRecord[] | null | undefined,
  scope: CompositionScope,
) {
  const coverage = coverageOf(record);
  return scope === "SURVEY"
    ? scopeUnit("FULL", "vehicle", coverage)
    : scopeUnit(scope, "vehicle", coverage);
}
type ImportResolution = {
  action: "auto" | "auto-new" | "new" | "merge" | "skip";
  targetId?: string;
};
type FormatMemory = {
  id: string;
  templateId: string;
  templateName: string;
  sheetPattern: string;
  columnCount: number;
  sampleFile: string;
  uses: number;
  lastUsedAt: string;
};
type VehicleMappingTable = Record<string, string>;
type ImportConflictMode = "overwrite" | "version" | "skip";

/*
 * ══════════════════════════════════════════════════════════════════
 *  側欄分區
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者的話：「讓使用者一目了然知道資料匯入區、參數設定區、圖表區、
 * 多計劃比較區等等各大功能區。」
 *
 * 舊版是三個群組（資料管理／分析與圖表／輸出與維護）＋前面四個沒有群組
 * 的項目，順序照當初做出來的先後排，不是照使用流程。
 *
 * 改成五區，**三支系統（交通服務水準、路口轉向、全日交通量）用同一套
 * 分區名稱與順序**，換一支也不用重新學。
 *
 * ⚠️ 這裡**只重排與換小標，沒有動任何功能，View 的 id 一個都沒改**。
 * 兩處順序調整：
 *  ・「計畫管理」（原名多計畫管理）：v2.1.62 曾移到「圖表與比較」最後，
 *    理由是「跨計畫比較的前置」。跨計畫比較已於 2026-09-09 移除，
 *    它現在只做建立／切換／刪除計畫，因此移回「一 資料匯入」最前面。
 *  ・「資料品質檢查」移到「資料匯入」區，緊接在匯入後面——匯完就檢查，
 *    是同一個動作的兩半。
 */
/*
 * ⚠️ 側欄項目**沒有圖示**（2026-09-15 移除）。
 *
 * 使用者原話：「請讓**任何電腦都看的到**做為前題去放小圖示，不然寧願不要放
 *   小圖示也不會影響什麼，靠文字大小和分類標籤的一、二、就已經能區別的出來了」。
 *
 * 那批圖示（⌂ ▦ ⇧ ✣ ⇄ ≋ ◔ ⌁ ✎ ▤ ⟳ ↗ …）**全部不在 Big5 字集裡**，
 * 而網頁字型是微軟正黑體。在他那台電腦上剛好畫得出來（有替補字型），
 * 但那不是保證——換一台電腦就可能整排變成空白。
 * 層級已經由字級遞減（16／14／12）與分類標題的「一、二、三」表達，
 * 圖示是錦上添花，不值得為它賭。
 *
 * ⚠️ 要加回來的話，先確認那個字在 Big5 符號區裡（例如 ○●△▲▽▼□■◇◆），
 *   不要因為「自己電腦看得到」就加。
 */
const NAV: {
  id: View;
  label: string;
  group?: string;
  zone?: "in" | "set" | "data" | "chart" | "out";
  /*
   * 這一頁裡面有哪幾塊，以及它們的錨點 id。
   *
   * 使用者 2026-09-11：「流量核對工作台左側欄位，可以新增 OD 流量表、
   * 本季鎖定狀況、成果審核狀態，讓使用者也可以直接從左側欄位快速跳轉。
   * 也能知道流量核對工作表有什麼功能。」
   *
   * ⚠️ 只在**目前正在看的那一頁**底下展開。這支側欄有 18 個分頁，
   *   每一頁都攤開子項目會變成一份四十幾列的清單，反而找不到東西。
   *   點進去就看得到，也就達成了「知道這一頁有什麼功能」。
   */
  /*
   * 這一個大分頁底下有哪些小分頁。
   *
   * ⚠️ `needs` 不是可有可無的。
   *   scripts/e2e-nav-target.mjs 守的是一條很硬的規矩：**側欄列得出來的
   *   每一項，畫面上都要找得到對應的那一塊**。而這支程式有很多區塊的渲染
   *   條件是「要先選到一個路口」或「這一季要有資料」——空計畫時它們根本
   *   不會被畫出來。列了卻點不到，使用者看到的是「這個按鈕壞了」，而且
   *   沒有任何訊息告訴他為什麼（v2.1.62 就是因為「本季總覽」踩過這個坑）。
   *
   *   所以每一個小分頁都要宣告它需要什麼，由側欄在渲染時過濾：
   *     undefined ＝ 永遠都在（例如說明文字、上傳區）
   *     "record"  ＝ 要先選到一個路口
   *     "records" ＝ 這個計畫要至少有一筆資料
   */
  sections?: {
    label: string;
    anchor: string;
    needs?: "record" | "records";
  }[];
}[] = [
  { id: "dashboard", label: "總覽儀表板" },
  /*
   * ⚠️ 新手操作手冊**刻意沒有小分頁**。
   *
   * 使用者 2026-09-15：「新手操作手冊下面的小分頁標題都是**說明類文字**，
   *   不需要做成左側的小分頁」。
   *
   * 這與早先定下的判準一致（2026-09-13）：
   *   「小分頁中，如果那個欄位是**純粹的說明文字、沒有任何功用**的話，
   *     不用特地做成小分頁在左側欄位，三個程式都是如此。」
   * 這一頁整頁都是說明，列成小分頁只會讓側欄變長而找不到重點。
   *
   * ⚠️ 頁面本身與那兩塊的 id 都留著（手冊內文與錨點連結仍然指得到），
   *   拿掉的只有**側欄的小分頁**。
   */
  {
    id: "help",
    label: "新手操作手冊",
  },
  /*
   * 「計畫管理」原名「多計畫管理」，v2.1.62 把它排在「四 圖表與比較」最後，
   * 理由是「它是跨計畫比較的前置」。跨計畫比較已於 2026-09-09 依使用者授權
   * 整組移除，那個理由就不成立了——它現在只做**建立、切換、刪除計畫**，
   * 是每一件事的起點，所以移到「一 資料匯入」最前面。
   *
   * ⚠️ 這一頁不可以整個拿掉：**全系統只有這裡能建立與刪除計畫**
   * （頂端那個「計畫」下拉只能切換）。每一顆「建立計畫」按鈕都是
   * setView("projects") 導到這裡。
   */
  {
    id: "projects",
    /*
     * ⚠️ 名稱是**三支統一**的，不要各自改。
     *   使用者 2026-09-13：「三個程式建立計畫的分頁名稱應該都要統一為
     *   **建立與管理計畫**，這樣才知道所有的第一步都是從建立計畫開始，
     *   而且這裡也能管理計畫。」
     */
    label: "建立與管理計畫",
    /*
     * ⚠️ 區名跟著改成「建立與匯入」：把建立計畫放在一個叫「資料匯入」的區裡
     *   名不副實。三支用同一個區名。
     */
    group: "一　建立與匯入",
    zone: "in",
    sections: [
      { label: "建立／修改計畫", anchor: "project-form" },
      { label: "現有計畫", anchor: "project-list" },
    ],
  },
  {
    id: "import",
    label: "季度批次匯入",
    zone: "in",
    sections: [
      { label: "上傳調查檔", anchor: "import-upload" },
      /*
       * ⚠️ 這裡原本還有一條 { label: "本次匯入的尖峰時段", anchor: "import-peak-range" }。
       *   **那個 id 全專案不存在**（實際的區塊是 import-peak-rule），
       *   所以點下去不會捲到任何地方——2026-09-15 大檢查查到。
       *   而 import-peak-rule 是純說明區塊（掛著 data-nav-skip="explanation"），
       *   依下面那條判準本來就不該列成小分頁，所以這一條是整個移除，不是改指向。
       *   ⚠️ e2e-nav-coverage 當時沒抓到，因為它只檢查「有區塊卻沒列」，
       *     沒有反過來檢查「列了卻沒有那個區塊」。守門已一併補上。
       */
      /*
       * ⚠️ 「檔名會決定什麼？」與「尖峰小時計算說明」**刻意不列**。
       *
       * 使用者 2026-09-13（附圖）：
       *   「小分頁中，如果那個欄位是**純粹的說明文字、沒有任何功用**的話，
       *     不用特地做成小分頁在左側欄位，三個程式都是如此。
       *     大小分頁都前提是**該項是有實質功能的**（例如確認監測結果、
       *     匯入匯出資料等等），說明文字只是提醒用，所以不需要做成小分頁。」
       *
       * 判準（三支共用）：一個區塊要列成小分頁，必須至少符合一項——
       *   (1) 裡面有可操作的控制項（按鈕、輸入、下拉、上傳、下載）
       *   (2) 裡面有要使用者確認或核對的資料（表格、清單、檢查結果、圖）
       * 只有文字的 → 不列。
       *
       * ⚠️ 這兩塊**不是刪掉**，只是不放進側欄——它們仍然在畫面上。
       *   區塊本身掛 data-nav-skip="explanation" 明講這件事，
       *   守門讀那個標記，而且會檢查標記是否名副其實
       *   （被標成純說明的區塊裡若出現按鈕／輸入／表格，一樣要紅）。
       */
      { label: "匯入辨識結果", anchor: "import-preview-panel", needs: "records" },
      /*
       * ⚠️ 「已匯入季度資料」已於 2026-09-16 從畫面移除（X-20）：
       *   刪除整季搬到「資料維護 → 刪除單一季度」，逐筆刪除依使用者裁示捨棄。
       *   小分頁一併拿掉——側欄列著一個畫面上沒有的東西，點下去什麼都不會發生。
       */
    ],
  },
  /*
   * ── X-8：資料維護（使用者 2026-09-16）─────────────────────────
   *
   * 使用者原話：「三份程式都有統一資料維護位置也都有刪除單一季的功能」
   *   「不要同樣功能在很多地方都出現」
   *
   * 這一頁原本叫「資料品質檢查」、掛在第一區（建立與匯入）。改成：
   *   ・名稱統一成「資料維護」（三支同一個詞）
   *   ・移到第五區（產出與維護）——它做的是產出後的核對與清理，不是匯入
   *   ・把「刪除單一季度」一起收進來（原本藏在「已匯入季度資料」裡）
   *
   * ⚠️ 小分頁要**名實相符**：舊版只列一項「異常原因與計算方式」，
   *   而那個 anchor 指的是**左欄的檢查結果清單**、標題卻在右欄的說明面板——
   *   點下去跳到的不是那個名字所指的東西。這次逐塊給自己的 id。
   * ⚠️ 這一支**不放「異常提醒門檻」**（使用者 2026-09-16 裁示）：
   *   它查的四類是結構性／一致性問題（缺值、總數不一致、尖峰時段範圍、
   *   車種加總），是「對或不對」，不是「變多少才算異常」——沒有門檻可調。
   */
  {
    id: "names",
    label: "路口名稱管理",
    group: "二　參數設定",
    zone: "set",
    sections: [{ label: "檔名別名清冊", anchor: "alias-list", needs: "records" }],
  },
  {
    id: "geometry",
    label: "道路與流向管理",
    zone: "set",
    sections: [
      { label: "支線與流向設定", anchor: "geometry-approaches", needs: "record" },
      /*
       * ⚠️ v2.1.72 加了「用顏色檢視轉向」這一塊，卻**忘了列進小分頁**。
       *   e2e-nav-coverage 抓到的：畫面上 3 塊、側欄只列 2 項。
       *   側欄是使用者找功能的唯一入口，沒列等於把功能藏起來。
       */
      { label: "用顏色檢視轉向", anchor: "geometry-turn-preview", needs: "record" },
      { label: "路口幾何示意圖", anchor: "geometry-schematic", needs: "record" },
      { label: "交通量圖卡排版預覽", anchor: "geometry-card-preview", needs: "record" },
    ],
  },
  {
    id: "parameters",
    label: "車種轉向當量",
    zone: "set",
    sections: [
      { label: "當量套用範圍", anchor: "param-scope" },
      { label: "各分析車種左／直／右當量", anchor: "param-pce" },
      { label: "本系統的計算範圍", anchor: "param-coverage" },
    ],
  },
  { id: "inbound", label: "各路口駛入／駛出流量", group: "三　資料檢視", zone: "data" },
  /*
   * 「各路口尖峰彙總」原本是「跨計畫／多路口比較」頁的中段兩塊表。
   * 那一頁於 2026-09-09 依使用者授權移除，但**表要留下來**——
   * 使用者的原話：「那些表可以保留……是各路口駛入／駛出流量表，那些保留」。
   *
   * ⚠️ 它與「各路口駛入／駛出流量」**不是同一件事**，不可以合併：
   *   ・各路口駛入／駛出流量 ＝ 一次看**一個**路口（上方有路口選單），
   *     欄位是四種統計範圍 × 駛入／駛出 × PCU 與車輛數。
   *   ・各路口尖峰彙總　　　 ＝ **所有路口並排**，一眼看完整個計畫，
   *     上半是每個路口的尖峰時段與轉向總量，下半是每個路口逐支線的
   *     駛出／駛入尖峰流量。
   *   我一度以為兩者重複而說「不必另做」，是錯的。
   */
  {
    id: "peaks",
    label: "各路口尖峰彙總",
    zone: "data",
    sections: [
      { label: "各支線駛入／駛出尖峰流量", anchor: "peaks-branch", needs: "record" },
    ],
  },
  {
    id: "audit",
    label: "流量核對工作台",
    zone: "data",
    sections: [
      { label: "資料別（平日／假日）設定", anchor: "audit-daytype" },
      { label: "OD 流量表", anchor: "audit-od" },
      { label: "原始儲存格與換算來源", anchor: "audit-trace" },
      { label: "本季鎖定狀況", anchor: "audit-lock" },
      { label: "成果審核狀態", anchor: "audit-review" },
    ],
  },
  { id: "diagram", label: "路口轉向圖", group: "四　圖表與比較", zone: "chart" },
  {
    id: "composition",
    label: "車種組成分析",
    zone: "chart",
    sections: [
      { label: "各路口車種組成", anchor: "composition-all", needs: "record" },
      { label: "全調查時段道路方向車種數量", anchor: "composition-table", needs: "record" },
    ],
  },
  /*
   * ⚠️ 2026-09-12 補上 sections。使用者：「左側欄位『轉向進階分析』分頁，
   *   少了尖峰小時4格15分鐘分布、連續60分鐘流率分析圖的分頁，雖然這兩張圖
   *   平常是收合，但使用者點左側分頁時，也應該要展開並顯眼提示，這樣才會被
   *   注意到有這張圖存在，是否使用則看使用者。」
   *
   *   這正是「收合」的代價：收著的東西使用者不會知道它存在。側欄列出來是
   *   第一步，點下去還必須**真的展開**（見 PeakShapeCharts 的 focusedBlock）。
   */
  {
    id: "advanced",
    label: "轉向進階分析",
    zone: "chart",
    sections: [
      { label: "來源支線 → 目的支線（OD 矩陣）", anchor: "advanced-od", needs: "record" },
      { label: "各支線流量平衡", anchor: "advanced-balance", needs: "record" },
      { label: "連續 60 分鐘候選排行", anchor: "advanced-window-rank", needs: "record" },
      { label: "尖峰小時內四格 15 分鐘分布", anchor: "advanced-peak-quarter", needs: "record" },
      { label: "連續 60 分鐘流率（依時間）", anchor: "advanced-peak-window", needs: "record" },
    ],
  },
  {
    id: "trend",
    label: "歷季趨勢比較",
    zone: "chart",
    /*
     * ⚠️ 這三塊 2026-09-13 以前一項都沒有列。逐頁盤點（數畫面上有幾塊、
     *   對照側欄列了幾項）才抓到——既有的守門只驗「列出來的點得到」，
     *   驗不到「該列的有沒有漏列」。
     */
    sections: [
      { label: "歷季趨勢圖", anchor: "trend-chart", needs: "record" },
      { label: "季度變化", anchor: "trend-summary", needs: "record" },
      /*
       * ⚠️ 「這張圖怎麼講（簡報用）」**刻意不列**。
       *
       * 使用者 2026-09-14（附圖）：「**說明文字類型的不用在左側欄位中做成小分頁**。」
       *
       * ⚠️ 它裡面有一顆「複製全部說明」——按既有的判準（「有可操作的控制項就要列」）
       *   它會被算成該列的一塊。但那顆鈕做的事是**複製這一塊自己的文字**，
       *   不是對資料做任何事。判準因此補一條：
       *   **「複製／下載這一塊自己的說明文字」不算可操作的控制項。**
       *   否則只要在說明區塊放一顆複製鈕，就能繞過整條規則。
       */
    ],
  },
  /*
   * ⚠️ X-45：這一條**必須放在第五群的其他項目旁邊**。
   *
   *   側欄的群組標題是依這個陣列的順序渲染的：條目上寫著
   *   `group: "五　產出與維護"`，標題就在**它出現的位置**冒出來。
   *   我 2026-09-16 把它排在「季度批次匯入」後面（第一群與第二群之間），
   *   於是畫面上變成「一 → 五 → 二 → 三 → 四」，
   *   使用者連續回報三次才被我修對（前兩次我還誤判成「位置是對的」）。
   *   ⚠️ 要移動它的話，連 `group` 標在誰身上一起檢查。
   */
  {
    id: "maintenance",
    label: "資料維護",
    group: "五　產出與維護",
    zone: "out",
    sections: [
      /*
       * ⚠️ X-59（使用者 2026-09-17）：「執行資料異常檢查……就應該增加在左側欄位，
       *   但左側欄位沒有看到這個標題……請三支同步。」
       *
       *   它符合三支共用的判準第 (1) 條（裡面有可操作的控制項——就是那顆按鈕），
       *   而且它是這一頁的第一步：沒按它，下面兩塊都是空的。
       *
       * ⚠️ 位置跟著**畫面上由上而下的順序**排（刪除單一季度在它上面），
       *   不是跟著操作順序排。側欄順序與捲動順序對不起來的話，
       *   點第二項反而往上跳——那是這三支一路在避開的坑。
       *   （版面重組那一批會把「資料異常檢查」整組獨立成一個大分頁，
       *     到時候刪除單一季度會搬去「還原與備份」，順序問題一併解決。）
       * ⚠️ needs: "records" 與下面兩項相同——空計畫時這一整塊不會被畫出來
       *   （renderNoData 取代），列了卻點不到就是「這個按鈕壞了」。
       */
      /* X-85：季度改名排在刪除上面，與全日交通量同一個順序。 */
      { label: "季度改名", anchor: "maintenance-rename-quarter" },
      { label: "刪除單一季度", anchor: "maintenance-delete-quarter" },
      { label: "執行資料異常檢查", anchor: "quality-run", needs: "records" },
      { label: "資料異常檢查摘要", anchor: "quality-summary", needs: "records" },
      { label: "檢查結果", anchor: "quality-reasons", needs: "records" },
      /*
       * ⚠️ 這裡原本還有「異常原因與計算方式」，使用者 2026-09-16 指名移除：
       *   「從檢查結果和檢查摘要中就可以完全覆蓋到所有異常原因了，
       *     不用特地多這個重複性質的欄位」。
       *   原本只在詳情面板才看得到的數字（左直右合計、各車種合計、差異、
       *   判定前提）已經併進「檢查結果」每一列裡，不是直接砍掉。
       */
    ],
  },
  { id: "conclusion", label: "結論草稿產生器", zone: "out" },
  /*
   * ⚠️ X-61（使用者 2026-09-17）：「報表與批次輸出」原本一頁七塊，
   *   是這一支**唯一**還要捲動的頁（使用者自己量出來的）。拆成兩頁：
   *     成果交付＝勾選要交什麼 ＋ 報告文字草稿
   *     批次輸出＝四張窄卡（Excel／PDF／全部圖檔／向量圖）＋ 橫式的批次成果包
   *   ⚠️ 名稱：使用者原本取「圖檔批次輸出」，改成「批次輸出」——
   *     那一組裡有 Excel，不是圖檔；而「成果交付」與交通服務水準
   *     既有的分頁名稱正好對得起來（三支同一個詞）。
   */
  {
    id: "delivery",
    label: "成果交付",
    zone: "out",
    sections: [
      { label: "這個計畫要匯出哪些分析結果", anchor: "report-items" },
      { label: "報告文字草稿", anchor: "report-draft" },
    ],
  },
  {
    id: "batch",
    label: "批次輸出",
    zone: "out",
    sections: [
      { label: "分析數據 Excel", anchor: "report-xlsx" },
      { label: "正式版多頁 PDF", anchor: "report-pdf" },
      { label: "一鍵下載全部圖檔", anchor: "report-chart-png" },
      { label: "目前路口向量圖", anchor: "report-svg" },
      { label: "多計畫批次成果包", anchor: "report-batch" },
    ],
  },
  /*
   * ⚠️ 這三個子項目是使用者 2026-09-11 指名要的：
   *   「甚至在備分還原下方新增 這三個功能的名稱，使用者點哪個功能的名稱，
   *     那個功能的卡片邊框 也能像前面說的那樣 變顯眼，
   *     表是這個功能對應的卡片是這裡。使用者也能知道 資料是要去哪備份 或還原」
   *   名稱要與卡片上的抬頭**同一個詞**，不可以一個叫「備份本計畫」、
   *   卡片上寫「只備份目前這個計畫」——那樣使用者還是要自己對應。
   */
  {
    id: "backup",
    label: "備份與還原",
    zone: "out",
    sections: [
      { label: "備份本計畫", anchor: "backup-one" },
      { label: "備份全部計畫", anchor: "backup-all" },
      { label: "還原計畫", anchor: "backup-restore" },
      { label: "清除本機資料", anchor: "clear-local" },
    ],
  },
];

/*
 * ⚠️ 四大車種的名稱必須和 lib/traffic.ts 的 CORE_VEHICLE_LABELS 完全一致。
 *
 * 這裡原本寫「大型／大客車」「特種／聯結車」，而匯入時寫進紀錄的是
 * CORE_VEHICLE_LABELS 的「大型車」「特種車」。vehicleLabel() 優先讀紀錄裡的
 * vehicleLabels，所以：正常匯入的資料顯示「大型車」，而 v2.1.19 以前的舊備份
 * （那時候還沒有 vehicleLabels 欄位）會落到這張表、顯示「大型／大客車」——
 * 跨季的結論草稿因此可能同一個車種前後兩種寫法。以匯入時實際寫入的那一組為準。
 * 有一項測試釘住兩張表一致。
 */
const VEHICLE_LABELS: Record<string, string> = {
  all: "全部車種",
  motorcycle: "機車",
  car: "小型車",
  heavy: "大型車",
  special: "特種車",
};
const PCE_LABELS = {
  special: "特種／聯結車",
  heavy: "大型／大客車",
  car: "小型車",
  motorcycle: "機車",
};
/*
 * ⚠️ 2026-09-25 第六輪：這裡原本自己寫了一份轉向標籤表，而 lib 也有一份
 *   （`MOVEMENT_LABELS`），兩份的「through」一個寫「直行」、一個寫「直進」，
 *   兩份都印在畫面上。現在一律用 lib 那一份，這個名字只留作別名，
 *   免得下面幾十處都要改（改動範圍越大越容易漏）。
 *   **不要把它改回自己寫一份物件。**
 */
const MOVE_LABELS = MOVEMENT_LABELS;
const ANALYSIS_VEHICLES = ["motorcycle", "car", "heavy", "special"] as const;
const EMPTY_REPORT_TEMPLATES: ReportTemplate[] = [];
const EMPTY_CONCLUSION_TEMPLATES: ConclusionTemplate[] = [];

function recordVehicleIds(record: TrafficRecord) {
  const ids = new Set<string>();
  Object.keys(record.vehicleLabels || {}).forEach(function (id) {
    ids.add(id);
  });
  Object.keys(record.survey?.vehicle || {}).forEach(function (id) {
    ids.add(id);
  });
  /*
   * 四個統計範圍都要掃。車種清單一律由**資料裡實際出現過的**車種決定，
   * 不是寫死那四種——調查表可以有自行車、電動車、任何自訂車種，
   * ANALYSIS_VEHICLES 只用來決定內建四種的排列順序。
   */
  record.approaches.forEach(function (approach) {
    SCOPE_KEYS.forEach(function (peak) {
      Object.keys(approach.movements[peak]?.vehicle || {}).forEach(
        function (id) {
          ids.add(id);
        },
      );
    });
  });
  const ordered = ANALYSIS_VEHICLES.filter(function (id) {
    return ids.has(id);
  }) as string[];
  return ordered.concat(
    [...ids]
      .filter(function (id) {
        return !ordered.includes(id);
      })
      .sort(function (a, b) {
        return vehicleLabel(record, a).localeCompare(
          vehicleLabel(record, b),
          "zh-Hant",
        );
      }),
  );
}

function vehicleLabel(record: TrafficRecord | null | undefined, id: string) {
  return (
    record?.vehicleLabels?.[id] ||
    VEHICLE_LABELS[id] ||
    CORE_VEHICLE_LABELS[id] ||
    id.replace(/^custom:/, "")
  );
}

function recordVehicleTotal(
  record: TrafficRecord,
  scope: CompositionScope,
  vehicle: string,
) {
  if (scope === "SURVEY") return Number(record.survey?.vehicle[vehicle] || 0);
  return record.approaches.reduce(function (sum, approach) {
    return sum + Number(approach.movements[scope].vehicle[vehicle] || 0);
  }, 0);
}

function surveyDirectionRows(record: TrafficRecord) {
  const emptyVehicle = function () {
    return Object.fromEntries(
      recordVehicleIds(record).map(function (id) {
        return [id, 0];
      }),
    ) as Record<string, number>;
  };
  const analysisVehicles = recordVehicleIds(record);
  return record.approaches.flatMap(function (approach) {
    // 用詞定義（與全站一致）：
    //   駛出路口X ＝ 車輛「從支線 X 駛出」開進路口，也就是以 X 為起點（fromApproachId）。
    //   駛入路口X ＝ 車輛「從其他支線駛入 X」，也就是以 X 為終點（toApproachId）。
    const departing = emptyVehicle(); // 以本支線為起點
    const arriving = emptyVehicle(); // 以本支線為終點
    (record.routes || []).forEach(function (route) {
      if (!route.survey) return;
      if (route.fromApproachId === approach.id)
        analysisVehicles.forEach(function (vehicle) {
          departing[vehicle] += Number(route.survey?.vehicle[vehicle] || 0);
        });
      if (route.toApproachId === approach.id)
        analysisVehicles.forEach(function (vehicle) {
          arriving[vehicle] += Number(route.survey?.vehicle[vehicle] || 0);
        });
    });
    const bidirectional = emptyVehicle();
    analysisVehicles.forEach(function (vehicle) {
      bidirectional[vehicle] = departing[vehicle] + arriving[vehicle];
    });
    return [
      {
        approach,
        // 由該支線開往路口中心
        direction: bearingFromAngle(approach.angle + 180),
        relation: "駛出路口",
        vehicle: departing,
      },
      {
        approach,
        // 由路口中心開往該支線
        direction: bearingFromAngle(approach.angle),
        relation: "駛入路口",
        vehicle: arriving,
      },
      {
        approach,
        direction: "雙向",
        relation: "雙向合計",
        vehicle: bidirectional,
      },
    ];
  });
}

function esc(value: string | number) {
  return String(value).replace(/[<>&"']/g, function (char) {
    return (
      (
        {
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
          "'": "&apos;",
        } as Record<string, string>
      )[char] || char
    );
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  /*
   * 連結一定要先掛進頁面再按。
   * 沒掛進頁面的 <a> 在部分瀏覽器（含 Chromium 的部分版本與無頭模式）
   * 會忽略 download 屬性，檔案就存成沒有副檔名的 "download"——
   * 使用者一次匯出三個計畫的備份，收到三個都叫 download 的檔案，
   * 分不出哪個是哪個。實測 Chromium 無頭模式即為此症狀。
   */
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(function () {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 1500);
}

/** 可編輯 Excel 裡的一張原生折線圖。 */
type EditableChartSpec = {
  series: Array<{ name: string; column: string; color: string }>;
  title?: string;
  valueAxisTitle?: string;
  valueNumberFormat?: string;
};

async function editableTrendWorkbookBlob(
  workbook: XLSX.WorkBook,
  sheetName: string,
  lastRow: number,
  /*
   * ⚠️ 一次可以放**多張**圖。
   *
   * 「整體」在畫面上是上下兩張圖（尖峰流率／全調查時段累計量），
   * Excel 就必須也是兩張。舊版寫死 chart1.xml、drawing 裡只有一個
   * graphicFrame，四個統計範圍的**數字**雖然都在工作表裡，
   * 但圖只有一張——收到檔案的人會以為那張圖就是全部。
   *
   * 為了相容，也接受舊的「一個 series 陣列」寫法。
   */
  chartsInput:
    | EditableChartSpec[]
    | Array<{ name: string; column: string; color: string }>,
  chartText: {
    title?: string;
    valueAxisTitle?: string;
    valueNumberFormat?: string;
  } = {},
) {
  const charts: EditableChartSpec[] = Array.isArray(chartsInput) &&
    chartsInput.length &&
    "column" in (chartsInput[0] as Record<string, unknown>)
    ? [
        {
          series: chartsInput as Array<{
            name: string;
            column: string;
            color: string;
          }>,
          ...chartText,
        },
      ]
    : (chartsInput as EditableChartSpec[]).map(function (chart) {
        return { ...chartText, ...chart };
      });
  if (!charts.length) throw new Error("沒有任何要輸出的圖表。");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const zip = await JSZip.loadAsync(bytes);
  const worksheetPath = "xl/worksheets/sheet1.xml";
  const worksheetFile = zip.file(worksheetPath);
  if (!worksheetFile) throw new Error("找不到趨勢資料工作表。");
  let worksheetXml = await worksheetFile.async("string");
  if (!/xmlns:r=/.test(worksheetXml))
    worksheetXml = worksheetXml.replace(
      /<worksheet\b/,
      '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    );
  worksheetXml = worksheetXml.replace(
    "</worksheet>",
    '<drawing r:id="rId1"/></worksheet>',
  );
  zip.file(worksheetPath, worksheetXml);

  zip.file(
    "xl/worksheets/_rels/sheet1.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>' +
      "</Relationships>",
  );
  /*
   * 每一張圖一個 twoCellAnchor，**上下排開**（第二張接在第一張下面 22 列），
   * 和畫面上的上下排列一致。重疊的話 Excel 打開會看到兩張圖疊在一起。
   */
  const CHART_ROWS = 22;
  zip.file(
    "xl/drawings/drawing1.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      charts
        .map(function (_, index) {
          const top = lastRow + 2 + index * (CHART_ROWS + 2);
          return (
            `<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${top}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
            `<xdr:to><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${top + CHART_ROWS}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
            `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="歷季趨勢圖${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/>` +
            `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${index + 1}"/></a:graphicData></a:graphic>` +
            "</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>"
          );
        })
        .join("") +
      "</xdr:wsDr>",
  );
  zip.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      charts
        .map(function (_, index) {
          return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${index + 1}.xml"/>`;
        })
        .join("") +
      "</Relationships>",
  );
  const quotedSheet = "'" + sheetName.replace(/'/g, "''") + "'";
  charts.forEach(function (chart, chartIndex) {
  const series = chart.series;
  const chartTitle = chart.title || "歷季尖峰交通量趨勢（單位：PCU/hr）";
  const valueAxisTitle =
    chart.valueAxisTitle || "尖峰小時交通量（PCU/hr）";
  const valueNumberFormat = chart.valueNumberFormat || "#,##0.0";
  /*
   * ⚠️ 兩張圖的軸 id 一定要不一樣。
   *   OOXML 的 catAx／valAx 是靠 axId 對起來的，兩張圖用同一組 id，
   *   Excel 開檔會判定內容有問題而跳「是否修復」——而修復的結果
   *   通常是**直接把圖刪掉**，使用者只會看到「圖不見了」。
   */
  const catAxId = 48650112 + chartIndex * 2;
  const valAxId = 48672768 + chartIndex * 2;
  const seriesXml = series
    .map(function (item, index) {
      return (
        `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>` +
        `<c:tx><c:strRef><c:f>${quotedSheet}!$${item.column}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(item.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
        `<c:spPr><a:ln w="38100" cap="rnd"><a:solidFill><a:srgbClr val="${item.color}"/></a:solidFill></a:ln></c:spPr>` +
        `<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="${item.color}"/></a:solidFill></a:ln></c:spPr></c:marker>` +
        `<c:cat><c:strRef><c:f>${quotedSheet}!$A$2:$A$${lastRow}</c:f></c:strRef></c:cat>` +
        `<c:val><c:numRef><c:f>${quotedSheet}!$${item.column}$2:$${item.column}$${lastRow}</c:f></c:numRef></c:val>` +
        "</c:ser>"
      );
    })
    .join("");
  zip.file(
    `xl/charts/chart${chartIndex + 1}.xml`,
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:style val="10"/>' +
      '<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-TW" sz="1500" b="1"><a:solidFill><a:srgbClr val="17333B"/></a:solidFill></a:rPr><a:t>' +
      esc(chartTitle) +
      '</a:t></a:r></a:p></c:rich></c:tx><c:layout/>' +
      '<c:overlay val="0"/></c:title><c:plotArea><c:layout/><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' +
      seriesXml +
      // CT_LineChart 的順序：grouping → varyColors → ser* → … → marker → smooth → axId。
      // c:smooth 一定要排在 c:ser 之後、c:axId 之前。
      `<c:marker val="1"/><c:smooth val="0"/><c:axId val="${catAxId}"/><c:axId val="${valAxId}"/></c:lineChart>` +
      `<c:catAx><c:axId val="${catAxId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-TW" sz="1000"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:rPr><a:t>調查季度</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title><c:tickLblPos val="nextTo"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr/><a:defRPr sz="900"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:defRPr></a:p></c:txPr><c:crossAx val="${valAxId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>` +
      /*
       * ⚠️ 這一段一定要用**樣板字串一路寫到底**。
       *   我改成多圖時，把開頭的 ' 換成 ` 卻沒發現這個字串原本是被
       *   `' + esc(valueAxisTitle) + '` 接起來的——結果縱軸名稱與數值格式
       *   變成 XML 裡的**字面文字**，每一份匯出的 Excel 都會壞。
       *   是 eslint 的 no-unused-vars 抓到（那兩個變數突然沒人用了）才發現。
       */
      `<c:valAx><c:axId val="${valAxId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="DDE6E3"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:title><c:tx><c:rich><a:bodyPr rot="-5400000"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-TW" sz="1000"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:rPr><a:t>${esc(valueAxisTitle)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title><c:numFmt formatCode="${esc(valueNumberFormat)}" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr/><a:defRPr sz="900"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:defRPr></a:p></c:txPr><c:crossAx val="${catAxId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>` +
      '</c:plotArea><c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr/><a:defRPr sz="900"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:defRPr></a:p></c:txPr></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="DDE6E3"/></a:solidFill></a:ln></c:spPr></c:chartSpace>',
  );
  });
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) throw new Error("Excel 格式缺少內容型別設定。");
  let contentTypes = await contentTypesFile.async("string");
  contentTypes = contentTypes.replace(
    "</Types>",
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
      /*
       * ⚠️ 每一個 chartN.xml 都要有自己的 Override。
       *   漏掉的話 Excel 開檔會跳「是否修復」，而修復通常是把圖刪掉。
       */
      charts
        .map(function (_, index) {
          return `<Override PartName="/xl/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
        })
        .join("") +
      "</Types>",
  );
  zip.file("[Content_Types].xml", contentTypes);
  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function downloadEditableTrendWorkbook(
  workbook: XLSX.WorkBook,
  sheetName: string,
  lastRow: number,
  series:
    | EditableChartSpec[]
    | Array<{ name: string; column: string; color: string }>,
  filename: string,
  chartText?: {
    title?: string;
    valueAxisTitle?: string;
    valueNumberFormat?: string;
  },
) {
  downloadBlob(
    await editableTrendWorkbookBlob(
      workbook,
      sheetName,
      lastRow,
      series,
      chartText,
    ),
    filename,
  );
}

function circularDistance(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function nameSimilarity(a: string, b: string) {
  const left = canonicalIntersectionKey(a),
    right = canonicalIntersectionKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const pairs = function (value: string) {
    return new Set(
      Array.from(
        { length: Math.max(1, value.length - 1) },
        function (_, index) {
          return value.slice(index, index + 2);
        },
      ),
    );
  };
  const leftPairs = pairs(left),
    rightPairs = pairs(right);
  const shared = [...leftPairs].filter(function (pair) {
    return rightPairs.has(pair);
  }).length;
  return (2 * shared) / Math.max(1, leftPairs.size + rightPairs.size);
}

function resultSignature(record: TrafficRecord) {
  const value = JSON.stringify({
    station: record.station,
    name: record.name,
    quarter: record.quarter,
    pceUsed: record.pceUsed,
    peaks: record.peaks,
    approaches: record.approaches,
    routes: record.routes,
  });
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * 這一筆鎖定成果現在的狀況。判斷邏輯在 lib/traffic.ts 的 lockStatus()，
 * 抽出去是為了能被測試——它決定的是「使用者要不要為了一行紅字去解除、
 * 重新鎖定 20 幾季的資料」。
 */
function lockState(record: TrafficRecord): LockStatus {
  if (!record.resultLock) return { conflicts: [], note: "" };
  return lockStatus(
    record.resultLock.version,
    VERSION,
    record.resultLock.signature === resultSignature(record),
  );
}

/** 只取「真的需要處理」的那些，紅字用。 */
function lockConflict(record: TrafficRecord) {
  return lockState(record).conflicts.join("；");
}

function closestDestination(
  approaches: Approach[],
  sourceIndex: number,
  targetAngle: number,
) {
  return approaches
    .map(function (approach, index) {
      return {
        index: index,
        distance:
          index === sourceIndex
            ? 999
            : circularDistance(approach.angle, targetAngle),
      };
    })
    .sort(function (a, b) {
      return a.distance - b.distance;
    })[0].index;
}

function movementTargetIndex(
  approaches: Approach[],
  sourceIndex: number,
  movement: "left" | "through" | "right",
) {
  const source = approaches[sourceIndex];
  if (!source) return -1;
  const targetAngle =
    movement === "left"
      ? source.angle + 90
      : movement === "right"
        ? source.angle - 90
        : source.angle + 180;
  return closestDestination(approaches, sourceIndex, targetAngle);
}

/* roundedPcu 與 emptyMovement 已移到 lib/traffic，畫面與 lib 共用同一份。 */

function destinationFlowTotal(
  record: TrafficRecord,
  peak: ScopeKey,
  destinationIndex: number,
  vehicle: VehicleKey,
) {
  if (vehicle !== "all") {
    const destination = record.approaches[destinationIndex];
    if (record.routes?.length)
      return record.routes
        .filter(function (route) {
          return route.toApproachId === destination?.id;
        })
        .reduce(function (sum, route) {
          return sum + Number(route.volumes[peak].vehicle[vehicle] || 0);
        }, 0);
    // 舊版備份沒有 routes，這時要跟「全部車種」一樣改用幾何推導，
    // 否則駛入卡每一格都有數字、合計卻是 0，百分比也會全部變成 0%。
    return Math.round(
      record.approaches.reduce(function (sum, source, sourceIndex) {
        return (
          sum +
          (["left", "through", "right"] as const).reduce(function (
            movementSum,
            movement,
          ) {
            return movementTargetIndex(
              record.approaches,
              sourceIndex,
              movement,
            ) === destinationIndex
              ? movementSum +
                  totalMovement(source, peak, movement, vehicle, record.routes)
              : movementSum;
          }, 0)
        );
      }, 0),
    );
  }
  if (record.routes?.length) {
    const destination = record.approaches[destinationIndex];
    return roundedPcu(
      (record.routes || [])
        .filter(function (route) {
          return route.toApproachId === destination?.id;
        })
        .reduce(function (sum, route) {
          return sum + Number(route.volumes[peak].pcu || 0);
        }, 0),
    );
  }
  return roundedPcu(
    record.approaches.reduce(function (sum, source, sourceIndex) {
      return (
        sum +
        (["left", "through", "right"] as const).reduce(function (
          movementSum,
          movement,
        ) {
          return movementTargetIndex(
            record.approaches,
            sourceIndex,
            movement,
          ) === destinationIndex
            ? movementSum + source.movements[peak][movement]
            : movementSum;
        }, 0)
      );
    }, 0),
  );
}

function sourceFlowTotal(
  record: TrafficRecord,
  peak: ScopeKey,
  sourceIndex: number,
) {
  const source = record.approaches[sourceIndex];
  if (!source) return 0;
  if (record.routes?.length)
    return roundedPcu(
      record.routes
        .filter(function (route) {
          return route.fromApproachId === source.id;
        })
        .reduce(function (sum, route) {
          return sum + Number(route.volumes[peak].pcu || 0);
        }, 0),
    );
  return roundedPcu(totalMovement(source, peak));
}

function branchPeakFlows(record: TrafficRecord, peak: ScopeKey) {
  return record.approaches.map(function (approach, index) {
    return {
      approach,
      enteringIntersection: sourceFlowTotal(record, peak, index),
      leavingIntersection: destinationFlowTotal(record, peak, index, "all"),
    };
  });
}

function movementFromGeometry(
  source: Approach,
  destination: Approach,
): "left" | "through" | "right" {
  const incomingHeading = source.angle + 180;
  const delta = ((destination.angle - incomingHeading + 540) % 360) - 180;
  if (Math.abs(delta) <= 45) return "through";
  return delta < 0 ? "left" : "right";
}

function syncRouteTotals(record: TrafficRecord) {
  /*
   * 先補齊四個統計範圍再說。舊備份與舊 localStorage 只有 AM／PM，
   * 底下每一段都直接寫 route.volumes[key]，少了鍵就會丟例外。
   */
  ensureRecordScopes(record);
  /*
   * 全日時段（FULL）在這裡**現算**，不是存起來的獨立數字。
   *
   * 唯一的來源是 route.survey / record.survey——也就是「這份調查每一欄
   * 總共幾輛車」。存兩份的話，改當量係數、刪支線、合併路口之後兩份就會
   * 分岔，而且是在報告送出去之後才被發現。
   *
   * ⚠️ 這一段要放在「沒有 routes 就 return」**之前**：沒有流向的舊資料
   * 一樣要把 FULL 清乾淨，否則備份裡萬一帶著上一版留下的值，會一直留著。
   */
  /*
   * ⚠️ 這裡原本是 `vehicle: fullDay ? {...} : {}`——不足 24 小時就清空，
   *   2026-09-11 拿掉（理由與 scopeValues 那一處完全相同：
   *   FULL 已經改名成「全調查時段」，卻只有 24 小時的調查才有資料）。
   *   清空的後果不只是畫面少一欄：駛入／駛出、OD 矩陣、支線平衡、
   *   Excel 匯出全部讀這一份，所以那些地方也一起變成空的。
   */
  record.routes?.forEach(function (route) {
    route.volumes.FULL = {
      pcu: 0,
      vehicle: { ...(route.survey?.vehicle || {}) },
    };
  });
  record.approaches.forEach(function (approach) {
    approach.movements.FULL = emptyMovement();
  });
  if (!record.routes?.length) return record;
  const pce = record.pceUsed || DEFAULT_PCE;
  record.routes.forEach(function (route) {
    SCOPE_KEYS.forEach(function (key) {
      route.volumes[key].pcu = roundedPcu(
        Object.keys(route.volumes[key].vehicle).reduce(function (sum, vehicle) {
          return (
            sum +
            Number(route.volumes[key].vehicle[vehicle] || 0) *
              pceFactor(pce, vehicle, route.movement)
          );
        }, 0),
      );
    });
  });
  record.approaches.forEach(function (approach) {
    SCOPE_KEYS.forEach(function (key) {
      const totals = { left: 0, through: 0, right: 0 };
      const vehicle: Record<string, number> = {};
      let rawVehicleTotal = 0;
      record.routes
        ?.filter(function (route) {
          return route.fromApproachId === approach.id;
        })
        .forEach(function (route) {
          totals[route.movement] += route.volumes[key].pcu;
          Object.entries(route.volumes[key].vehicle).forEach(function (entry) {
            const count = Number(entry[1]) || 0;
            vehicle[entry[0]] = Number(vehicle[entry[0]] || 0) + count;
            rawVehicleTotal += count;
          });
        });
      approach.movements[key].left = roundedPcu(totals.left);
      approach.movements[key].through = roundedPcu(totals.through);
      approach.movements[key].right = roundedPcu(totals.right);
      /*
       * 只有全日時段的逐車種輛數在這裡重建。
       *
       * AM／PM／全日尖峰的 vehicle 是匯入時由「該尖峰視窗內的原始格子」
       * 算出來的，這裡不重建；而 FULL 本來就沒有存，每次都要從 survey 現算。
       *
       * ⚠️ 這段註解 2026-09-12 更正過。原文寫的理由是「重建會覆蓋掉使用者
       *   在核對工作台改過的值」——**那個編輯功能並不存在**。實際查證：
       *   流量核對工作台上的控制項全部是篩選（支線／車種／轉向下拉），
       *   沒有任何一個地方可以打字修改交通量；全系統唯一會寫進
       *   route.volumes[].vehicle 的路徑就是匯入。
       *   留著錯的理由比沒有理由更糟：下一個人會依據它做決定。
       *
       *   真正不該在這裡重建的理由是：這三個尖峰的輛數來自「尖峰視窗內的
       *   原始格子」，而那份逐時間格資料沒有存進紀錄，這裡根本推不回去；
       *   用 route.survey（整份調查的總量）硬算只會得到另一個數字。
       */
      if (key === "FULL") {
        approach.movements[key].vehicle = vehicle;
        /*
         * ⚠️ 這裡原本是 `fullDay ? rawVehicleTotal : null`——同一道
         *   「不足 24 小時就清空」的舊門檻（見上面 route.volumes.FULL 的說明），
         *   2026-09-11 一併移除。全調查時段就是這份調查涵蓋的時段，
         *   4 小時的調查有 4 小時的原始輛數，那是誠實的數字。
         */
        approach.movements[key].rawVehicleTotal = rawVehicleTotal;
      }
    });
  });
  return record;
}

function applyReferenceMovementRule(record: TrafficRecord) {
  /*
   * 使用者自己確認過的轉向分類，任何情況下都不能被覆蓋。
   *
   * 這支函式在每次開啟網頁、每次還原備份時都會跑一遍。舊版沒有這一道檢查，
   * 於是使用者在「檢查起點→終點流向」手動改好的分類，重新整理之後就被
   * 內建的參考表改回去了——而畫面上明明寫著「本路口採人工確認分類；調整
   * 圖面角度不會覆蓋」。
   */
  /*
   * 這一支是「每次開啟網頁、每次還原備份」都會跑的入口，所以四個統計範圍
   * 的補齊放在最前面：底下每一條路徑都會讀 volumes[key]，舊備份少了
   * DAY／FULL 兩個鍵就會丟例外，整個計畫的資料會進不去。
   */
  ensureRecordScopes(record);
  if (record.movementRule === "manual") return syncRouteTotals(record);
  let applied = false;
  const armCodes = (record.approaches || []).map(function (approach) {
    return approach.sourceCode || "";
  });
  (record.routes || []).forEach(function (route) {
    const source = record.approaches.find(function (approach) {
      return approach.id === route.fromApproachId;
    });
    const destination = record.approaches.find(function (approach) {
      return approach.id === route.toApproachId;
    });
    const movement = referenceMovementForOd(
      record.name,
      source?.sourceCode || "",
      destination?.sourceCode || "",
      armCodes,
    );
    if (movement) {
      route.movement = movement;
      applied = true;
    }
  });
  if (applied) record.movementRule = "reference-calculation";
  return syncRouteTotals(record);
}

function syncRouteGeometry(record: TrafficRecord) {
  record.approaches.forEach(function (approach) {
    approach.bearing = bearingFromAngle(approach.angle);
  });
  if (!record.routes?.length) return record;
  if (
    record.movementRule === "reference-calculation" ||
    record.movementRule === "manual"
  )
    return syncRouteTotals(record);
  record.routes.forEach(function (route) {
    const source = record.approaches.find(function (approach) {
      return approach.id === route.fromApproachId;
    });
    const destination = record.approaches.find(function (approach) {
      return approach.id === route.toApproachId;
    });
    if (source && destination)
      route.movement = movementFromGeometry(source, destination);
  });
  record.movementRule = "geometry-suggested";
  return syncRouteTotals(record);
}

function inheritRecordGeometry(
  record: TrafficRecord,
  geometrySource: TrafficRecord,
) {
  const sourceByCode = new Map(
    geometrySource.approaches.map(function (approach) {
      return [approach.sourceCode || approach.id, approach] as const;
    }),
  );
  record.approaches.forEach(function (approach) {
    const source = sourceByCode.get(approach.sourceCode || approach.id);
    if (!source) return;
    approach.name = source.name;
    approach.angle = source.angle;
    approach.bearing = bearingFromAngle(source.angle);
  });
  const movementByCode = new Map<string, RouteFlow["movement"]>();
  (geometrySource.routes || []).forEach(function (route) {
    const from = geometrySource.approaches.find(function (approach) {
      return approach.id === route.fromApproachId;
    });
    const to = geometrySource.approaches.find(function (approach) {
      return approach.id === route.toApproachId;
    });
    if (from && to)
      movementByCode.set(
        (from.sourceCode || from.id) + "→" + (to.sourceCode || to.id),
        route.movement,
      );
  });
  (record.routes || []).forEach(function (route) {
    const from = record.approaches.find(function (approach) {
      return approach.id === route.fromApproachId;
    });
    const to = record.approaches.find(function (approach) {
      return approach.id === route.toApproachId;
    });
    const movement = movementByCode.get(
      (from?.sourceCode || from?.id || "") +
        "→" +
        (to?.sourceCode || to?.id || ""),
    );
    if (movement) route.movement = movement;
  });
  record.movementRule = geometrySource.movementRule;
  record.directionDisplay = structuredClone(
    geometrySource.directionDisplay || {},
  );
  return syncRouteTotals(record);
}

function synchronizeGeometryAcrossQuarters(records: TrafficRecord[]) {
  const latest = new Map<string, TrafficRecord>();
  records.forEach(function (record) {
    const key = (record.projectId || "") + "|" + recordIntersectionKey(record);
    const current = latest.get(key);
    if (!current || compareQuarters(current.quarter, record.quarter) < 0)
      latest.set(key, record);
  });
  return records.map(function (record) {
    const source = latest.get(
      (record.projectId || "") + "|" + recordIntersectionKey(record),
    );
    return source && source.id !== record.id
      ? inheritRecordGeometry(structuredClone(record), source)
      : record;
  });
}

/**
 * 取出某條支線在「目前這個顯示模式」下的圖卡位移。
 * 這個模式還沒被調整過時，沿用 v2.1.0 的 cardOffsets、再退回更舊的 cardOffset，
 * 讓既有資料在三種模式下都維持原本位置，直到使用者真的在該模式拖過為止。
 */
export function approachCardOffset(
  approach: Approach,
  mode: FlowLayoutMode,
  section: "inbound" | "outbound",
) {
  return (
    approach.cardLayouts?.[mode]?.cards?.[section] ??
    approach.cardOffsets?.[section] ??
    approach.cardOffset ?? { x: 0, y: 0 }
  );
}

/** 同上，但取的是路口標籤（例如「路口A」）的位移。 */
export function approachLabelOffset(approach: Approach, mode: FlowLayoutMode) {
  return (
    approach.cardLayouts?.[mode]?.label ??
    approach.labelOffset ?? { x: 0, y: 0 }
  );
}

/** 這條支線是否有任何手動調整過的版面（用於顯示狀態與停用還原鈕）。 */
export function hasManualLayout(approach: Approach) {
  return Boolean(
    approach.cardOffset ||
    approach.cardOffsets?.inbound ||
    approach.cardOffsets?.outbound ||
    approach.labelOffset ||
    Object.values(approach.cardLayouts || {}).some(function (layout) {
      return Boolean(
        layout?.label || layout?.cards?.inbound || layout?.cards?.outbound,
      );
    }),
  );
}

/** 已經調整過版面的模式清單，顯示成「駛入＋駛出、只看駛入」這種提示。 */
export function adjustedLayoutModes(approach: Approach) {
  const labels: Record<FlowLayoutMode, string> = {
    both: "駛入＋駛出",
    inbound: "只看駛入",
    outbound: "只看駛出",
  };
  const modes = (["both", "inbound", "outbound"] as FlowLayoutMode[]).filter(
    function (mode) {
      const layout = approach.cardLayouts?.[mode];
      return Boolean(
        layout?.label || layout?.cards?.inbound || layout?.cards?.outbound,
      );
    },
  );
  return modes.map(function (mode) {
    return labels[mode];
  });
}

/*
 * 轉向圖的唯一產生點。
 *
 * 回傳兩樣東西，而且兩樣是**同一次計算**的產物：
 *   markup ── 要畫出來、要匯出的 SVG 字串
 *   boxes  ── 每一張數據框、以及圖例與中央標籤的實際矩形
 *
 * ⚠️ 匯出前排版預警吃的就是 boxes。之所以要一起回傳而不是另外寫一支去估，
 *    是因為 v2.1.63 以前正是「另外估一份」——支線超過 4 個時繪圖端改用外圍
 *    格位排版，估算卻還停在圓周公式，於是畫面明明沒重疊卻一直跳警示
 *    （使用者 2026-09-10 回報），反過來也會漏報真正重疊的。
 */
export function diagramLayout(
  record: TrafficRecord,
  peak: ScopeKey,
  style: DiagramStyle,
  mode: DisplayMode,
  vehicle: VehicleKey,
  arrowMode: ArrowMode,
  focusIndex: number,
  flowSummaryMode: FlowSummaryMode = "both",
  /*
   * 圖上那一行說明的季度要寫成民國年還是西元年。
   * 只換文字：record.quarter 本身與所有分組、排序、識別鍵都不受影響。
   * 預設原樣輸出，舊呼叫端與單元測試的行為不變。
   */
  quarterText: (quarter: string) => string = (quarter) => quarter,
) {
  const n = record.approaches.length;
  const expandedCanvas = style === "formal" || (style === "standard" && n > 4);
  /*
   * ── 畫布尺寸跟著支線數走 ──────────────────────────────────────
   *
   * 使用者 2026-09-11：「在七叉路口拖曳圖卡時，我覺得可拖曳的空間挺不夠用的，
   *   希望能再增大些畫布。如果是正常的十字路口，畫布不用這麼大時，
   *   希望也能自動調整合適的大小，不知道畫布大小能否因路口的數量而自動調整？」
   *
   * 舊版只有兩種尺寸（1000×820 / 1200×900），五叉到八叉共用同一塊畫布。
   * 後果有兩個，使用者兩個都遇到了：
   *   (1) 七叉時右上角的小卡**超出 viewBox 被裁掉**（匯出的 PNG 反而是完整的，
   *      因為匯出走另一條路徑會重算邊界——同一張圖，螢幕上被切、檔案裡完整）。
   *   (2) 卡片幾乎貼滿畫布，拖曳時沒有空間可以挪。
   *
   * ⚠️ 做法是**每多一支線就加一格**，不是「把 1200 調成 1400」：
   *   調大一個固定值只是把門檻往後挪，八叉一樣會再犯，
   *   而且四叉、五叉會平白多出一大片空白（使用者特別交代不要）。
   *
   * ⚠️ 四支線以下**刻意維持原尺寸不變**（1000×820，formal 仍是 1200×900）。
   *   十字路口是最常見的情況，沒有理由為了七叉去動它——
   *   而且那樣可以讓既有的版面守門測試繼續有效，改動範圍縮到最小。
   *
   * ⚠️ cy 改成**依原本的比例**放大，不是寫死的 430／470，也不是另外挑一個
   *   係數。寫死的話畫布一變高，路口中心就偏上、下半部空一大片；
   *   另挑係數（例如 0.523）則會讓四支線的 430 變成 429——
   *   差 1px 就足以踩紅所有釘住版面的守門測試，而那個 1px 沒有任何好處。
   *   用 baseCy × (height / baseHeight) 可以保證：**高度沒變時 cy 一個像素都不變**。
   */
  const extraArms = Math.max(0, n - 4);
  const baseWidth = expandedCanvas ? 1200 : 1000;
  const baseHeight = expandedCanvas ? 900 : 820;
  const baseCy = expandedCanvas ? 470 : 430;
  const width = baseWidth + extraArms * 140,
    height = baseHeight + extraArms * 60,
    cx = width / 2,
    cy = Math.round((baseCy * height) / baseHeight);
  /*
   * 「這張圖要報 PCU 還是輛」——v2.1.34 起完全由顯示模式決定，不再受車種
   * 篩選影響。
   *
   * 舊行為：車種只要不是「全部車種」就一律改報輛數，因為系統沒有存每個
   * 車種各自的 PCU。行為本身沒錯，錯的是**上面的選單還寫著 PCU**——
   * 使用者選「PCU/hr＋百分比」＋「機車」，圖上卻是「輛/hr」。
   *
   * 現在單一車種的 PCU 用 vehiclePcuFor() 現算，用的是匯入當時存下來的
   * 當量矩陣、和建立 movements PCU 時同一支 pceFactor，不是另寫一套公式。
   *
   * 單位一樣跟著統計範圍走：尖峰是某一小時的流率（PCU/hr、輛/hr），
   * 全調查時段是整段涵蓋的累計。
   *
   * ⚠️ 分母要看**這一筆**的涵蓋：滿 24 小時寫「調查日」，否則寫「調查時段」。
   *   這張圖一次只畫一個路口，涵蓋是明確的，所以一定要把它傳進去。
   *   ⚠️ 2026-09-25 第六輪更正：這一行原本寫「不傳的話會走安全預設（調查時段）」
   *     ——`scopeUnit()` 的三個參數已經全部改成**必填**，「不傳」在型別上就過不了。
   *     註解留著舊的可能性，下一個人會以為不傳是合法的省事寫法。
   */
  const valueKind = displayValueKind(mode);
  const unit = scopeUnit(peak, valueKind, coverageOf(record));
  const countVehicleIds =
    valueKind === "vehicle" && vehicle === "all" ? recordVehicleIds(record) : [];
  const sumOverVehicles = function (pick: (id: string) => number) {
    return countVehicleIds.reduce(function (sum, id) {
      return sum + pick(id);
    }, 0);
  };
  /* 圖上任何一個「一支支線某個轉向的值」都走這一支。 */
  const movementValue = function (
    approach: Approach,
    movementKey?: MovementKey,
  ) {
    if (valueKind === "vehicle")
      return vehicle === "all"
        ? sumOverVehicles(function (id) {
            return totalMovement(approach, peak, movementKey, id, record.routes);
          })
        : totalMovement(approach, peak, movementKey, vehicle, record.routes);
    /*
     * PCU 模式。全部車種時 totalMovement 回的本來就是 PCU；
     * 單一車種時它回的是輛數，要再套當量換成 PCU。
     */
    if (vehicle === "all")
      return totalMovement(approach, peak, movementKey, "all", record.routes);
    const count = totalMovement(
      approach,
      peak,
      movementKey,
      vehicle,
      record.routes,
    );
    return roundedPcu(
      movementKey
        ? vehiclePcuFor(record, vehicle, movementKey, count)
        : MOVEMENT_KEYS.reduce(function (sum, key) {
            return (
              sum +
              vehiclePcuFor(
                record,
                vehicle,
                key,
                totalMovement(approach, peak, key, vehicle, record.routes),
              )
            );
          }, 0),
    );
  };
  /* 一條 OD 流向的值。 */
  const routeValueOf = function (route: RouteFlow) {
    if (valueKind === "vehicle")
      return vehicle === "all"
        ? Object.values(route.volumes[peak]?.vehicle || {}).reduce(
            function (sum, value) {
              return sum + (Number(value) || 0);
            },
            0,
          )
        : Number(route.volumes[peak]?.vehicle[vehicle] || 0);
    /* PCU：全部車種有現成的；單一車種要套當量現算。 */
    return vehicle === "all"
      ? Number(route.volumes[peak]?.pcu || 0)
      : roundedPcu(
          vehiclePcuFor(
            record,
            vehicle,
            route.movement,
            Number(route.volumes[peak]?.vehicle[vehicle] || 0),
          ),
        );
  };
  /* 駛入某一支支線的合計。 */
  const destinationValue = function (destinationIndex: number) {
    if (valueKind === "vehicle")
      return vehicle === "all"
        ? sumOverVehicles(function (id) {
            return destinationFlowTotal(record, peak, destinationIndex, id);
          })
        : destinationFlowTotal(record, peak, destinationIndex, vehicle);
    /*
     * PCU：全部車種走既有的 destinationFlowTotal（本來就回 PCU）。
     * 單一車種沒有現成的 PCU，改用逐條流向套當量加總——和 routeValueOf
     * 同一支公式，不另立第二種算法。
     */
    if (vehicle === "all")
      return destinationFlowTotal(record, peak, destinationIndex, "all");
    const target = record.approaches[destinationIndex];
    if (!target) return 0;
    return roundedPcu(
      (record.routes || [])
        .filter(function (route) {
          return route.toApproachId === target.id;
        })
        .reduce(function (sum, route) {
          return (
            sum +
            vehiclePcuFor(
              record,
              vehicle,
              route.movement,
              Number(route.volumes[peak]?.vehicle[vehicle] || 0),
            )
          );
        }, 0),
    );
  };
  const total = Math.max(
    1,
    record.approaches.reduce(function (sum, approach) {
      return sum + movementValue(approach);
    }, 0),
  );
  const point = function (angle: number, radius: number) {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + Math.cos(rad) * radius, y: cy + Math.sin(rad) * radius };
  };
  const roadParts: string[] = [];
  const pathParts: string[] = [];
  const cardParts: string[] = [];
  const pendingCards: Array<{
    markup: string;
    handle: string;
    name: string;
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
    preferred: { x: number; y: number };
    manualOffset: { x: number; y: number };
    width: number;
    height: number;
  }> = [];
  /*
   * 檢查與繪圖共用的同一組矩形。
   * ⚠️ 一定要在「推出 <g transform=...> 的同一段程式」裡填，用同一組 x/y/w/h；
   *    只要另外算一份，就會回到 v2.1.63 那個「畫面沒重疊卻一直跳警示」的錯。
   */
  const layoutBoxes: LayoutBox[] = [];
  const names = ["left", "through", "right"] as const;
  const offsets = [-12, 0, 12];
  const colors = { left: "#d64ba7", through: "#2166d1", right: "#e24538" };
  /*
   * 箭頭一律畫「起點支線 → 目的支線」的完整曲線，箭頭落在目的支線那一端。
   * 舊版在只看駛入／只看駛出時把貝茲曲線從中點切一半，結果箭頭停在路口中央，
   * 看起來像是車開到路口就消失，方向也讀不出來。要限制方向請改用聚焦支線
   * （見下方 keepRoute）：只看駛出＝從該支線畫出去，只看駛入＝各支線畫進來。
   */
  const routePath = function (
    start: { x: number; y: number },
    control: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    return (
      "M " +
      start.x.toFixed(1) +
      " " +
      start.y.toFixed(1) +
      " Q " +
      control.x.toFixed(1) +
      " " +
      control.y.toFixed(1) +
      " " +
      end.x.toFixed(1) +
      " " +
      end.y.toFixed(1)
    );
  };
  /*
   * 聚焦模式下要留哪些箭頭：
   *   只看駛出 → 起點是聚焦支線的（從聚焦支線指向其他每個路口）
   *   只看駛入 → 目的地是聚焦支線的（其他每個路口指向聚焦支線）
   *   駛入＋駛出 → 兩者都留
   */
  const keepRoute = function (sourceIndex: number, destinationIndex: number) {
    if (arrowMode !== "focus") return true;
    if (flowSummaryMode === "inbound") return destinationIndex === focusIndex;
    if (flowSummaryMode === "outbound") return sourceIndex === focusIndex;
    return sourceIndex === focusIndex || destinationIndex === focusIndex;
  };

  /*
   * ── 路段條與中央路口方塊的距離 ───────────────────────────────
   *
   * 使用者 2026-09-12：「每條路段都離正中間的正方形太遠了，適當的路段與
   * 正中間正方形的距離應該如十字路口那樣，畫布增大是增加可以放置流量小卡
   * 的位置，而不是拉大路段與中間正方形的距離。」
   *
   * ⚠️ 成因：路段條原本是畫成 `<rect y="85" height="300">` 再繞 (cx,cy) 旋轉，
   *   **y 是畫布的絕對座標**，而中心 cy 會隨畫布變高往下移。
   *   於是「路段條近端到中心的距離」＝ cy - 385，跟著畫布一起長：
   *     四叉（1000×820，cy=430）→ 45px，路段條幾乎貼著路口方塊
   *     七叉（1620×1080，cy=564）→ 179px，中間空出快 100px
   *   使用者看到的就是這 100px。
   *
   * 改成**以中心為基準**的半徑，而且半徑用**四叉時的 cy（baseCy）**回推——
   * 這樣四叉的圖一個像素都不會變（cy === baseCy 時算出來就是原本的 85），
   * 支線再多也維持同一個距離。
   *
   * ⚠️ 不可以改用目前的 cy 回推，那等於沒修；也不可以寫死 45／345，
   *   因為 formal 版型的基準是 85／385，寫死會讓正式版型的圖整個位移。
   */
  const roadNearRadius = baseCy - 385;
  const roadFarRadius = baseCy - 85;
  const roadTop = cy - roadFarRadius;
  const roadHeight = roadFarRadius - roadNearRadius;
  record.approaches.forEach(function (approach, index) {
    const p = point(approach.angle, 205);
    const roadWidth = n > 5 ? 62 : 90;
    roadParts.push(
      '<g transform="rotate(' +
        (approach.angle + 90) +
        " " +
        cx +
        " " +
        cy +
        ')">' +
        '<rect x="' +
        (cx - roadWidth / 2) +
        '" y="' +
        roadTop.toFixed(1) +
        '" width="' +
        roadWidth +
        '" height="' +
        roadHeight.toFixed(1) +
        '" rx="3" class="road"/>' +
        /* 中央虛線比路段條兩端各內縮一點，與原本的 85→98、385→374 同樣比例。 */
        '<path d="M ' +
        cx +
        " " +
        (roadTop + 13).toFixed(1) +
        " V " +
        (roadTop + roadHeight - 11).toFixed(1) +
        '" class="divider"/></g>' +
        '<g class="road-label" data-label-id="' +
        esc(approach.id) +
        // 標籤也要標示自動基準點與可放置範圍，拖曳時才知道要從哪裡起算。
        // 少了這些屬性會被當成基準點 (0,0)，一拖就整個跳到畫面左上角。
        '" data-base-x="' +
        p.x.toFixed(1) +
        '" data-base-y="' +
        p.y.toFixed(1) +
        '" data-min-x="85" data-max-x="' +
        (width - 85).toFixed(1) +
        '" data-min-y="20" data-max-y="' +
        (height - 20).toFixed(1) +
        '" transform="translate(' +
        Math.max(
          85,
          Math.min(
            width - 85,
            p.x + Number(approachLabelOffset(approach, flowSummaryMode).x || 0),
          ),
        ).toFixed(1) +
        " " +
        Math.max(
          20,
          Math.min(
            height - 20,
            p.y + Number(approachLabelOffset(approach, flowSummaryMode).y || 0),
          ),
        ).toFixed(1) +
        ')"><rect x="-77" y="-14" width="154" height="28" rx="14" class="road-label-bg"/>' +
        '<text class="road-name" x="0" y="5">' +
        esc(approach.name) +
        "</text></g>",
    );

    const values = names.map(function (key) {
      return movementValue(approach, key);
    });
    const approachTotal = values.reduce(function (a, b) {
      return a + b;
    }, 0);
    const destinations = names.map(function (movement) {
      return movementTargetIndex(record.approaches, index, movement);
    });
    const explicitRoutes = (record.routes || []).filter(function (route) {
      return route.fromApproachId === approach.id;
    });
    const incomingRoutes = (record.routes || []).filter(function (route) {
      return route.toApproachId === approach.id;
    });
    if (explicitRoutes.length) {
      explicitRoutes.forEach(function (route, routeIndex) {
        const destinationIndex = record.approaches.findIndex(function (item) {
          return item.id === route.toApproachId;
        });
        if (destinationIndex < 0) return;
        if (!keepRoute(index, destinationIndex)) return;
        const destination = record.approaches[destinationIndex];
        const routeValue = routeValueOf(route);
        const laneOffset = (routeIndex - (explicitRoutes.length - 1) / 2) * 1.6;
        const start = point(approach.angle + laneOffset, 145);
        const end = point(destination.angle - laneOffset, 158);
        const klass =
          arrowMode === "focus"
            ? "movement-path focus " +
              route.movement +
              (routeValue ? "" : " zero")
            : "movement-path " + route.movement + (routeValue ? "" : " zero");
        pathParts.push(
          '<path class="' +
            klass +
            " summary-" +
            flowSummaryMode +
            '" d="' +
            routePath(start, { x: cx, y: cy }, end) +
            '" marker-end="url(#arrow-' +
            route.movement +
            ')"><title>' +
            esc(approach.name) +
            " → " +
            esc(destination.name) +
            "：" +
            routeValue.toLocaleString() +
            " " +
            unit +
            "</title></path>",
        );
      });
    } else {
      names.forEach(function (key, moveIndex) {
        if (!keepRoute(index, destinations[moveIndex])) return;
        const start = point(approach.angle, 145 + offsets[moveIndex]);
        const destination = record.approaches[destinations[moveIndex]];
        const end = point(destination.angle, 158 + offsets[moveIndex]);
        const sourceRad = (approach.angle * Math.PI) / 180;
        const normalX = -Math.sin(sourceRad) * offsets[moveIndex];
        const normalY = Math.cos(sourceRad) * offsets[moveIndex];
        const c1x = cx + normalX * 2.2,
          c1y = cy + normalY * 2.2;
        const klass =
          arrowMode === "focus"
            ? "movement-path focus " + key
            : "movement-path " + key;
        pathParts.push(
          '<path class="' +
            klass +
            " summary-" +
            flowSummaryMode +
            '" d="' +
            routePath(start, { x: c1x, y: c1y }, end) +
            '" marker-end="url(#arrow-' +
            key +
            ')"><title>' +
            esc(approach.name) +
            " " +
            MOVE_LABELS[key] +
            " → " +
            esc(destination.name) +
            "</title></path>",
        );
      });
    }

    if (style === "simple") return;
    const cardWidth =
      flowSummaryMode === "both"
        ? style === "formal"
          ? 216
          : 198
        : style === "formal"
          ? 246
          : n > 4
            ? 210
            : 230;
    const cardHeight = 116;
    const approachRad = (approach.angle * Math.PI) / 180;
    const radialCardExtent =
      Math.abs(Math.cos(approachRad)) * (cardWidth / 2) +
      Math.abs(Math.sin(approachRad)) * (cardHeight / 2);
    const radialLabelExtent =
      Math.abs(Math.cos(approachRad)) * 77 +
      Math.abs(Math.sin(approachRad)) * 14;
    const minimumCardRadius = 205 + radialLabelExtent + radialCardExtent + 20;
    const baseCardP = point(
      approach.angle,
      Math.max(n > 4 ? 355 : 315, minimumCardRadius),
    );
    // 位移改由 pushCard 依「駛入／駛出」各自套用，這裡只保留自動算出的基準位置。
    const cardP = { x: baseCardP.x, y: baseCardP.y };
    const cell = cardWidth / 3;
    const formatter = function (value: number, sectionTotal: number) {
      const pct = sectionTotal
        ? Math.round((value / sectionTotal) * 100) + "%"
        : "0%";
      if (!displayShowsValue(mode)) return pct;
      /* 交通量與車輛數都是「一個數字＋單位」，差別在 unit 與取值來源。 */
      const text = value.toLocaleString() + " " + unit;
      return displayShowsPercent(mode) ? text + " | " + pct : text;
    };
    const destinationLabels = names.map(function (key, movementIndex) {
      const explicit = explicitRoutes
        .filter(function (route) {
          return route.movement === key;
        })
        .map(function (route) {
          return (
            record.approaches
              .find(function (item) {
                return item.id === route.toApproachId;
              })
              ?.name.replace(/^路口\s*/, "") || ""
          );
        })
        .filter(Boolean);
      return explicit.length
        ? explicit.join("、")
        : record.approaches[destinations[movementIndex]].name;
    });
    const destinationTotal = destinationValue(index);
    const sourceCode = approach.sourceCode || String.fromCharCode(65 + index);
    const incomingValues = names.map(function (movement) {
      if (incomingRoutes.length)
        return roundedPcu(
          incomingRoutes
            .filter(function (route) {
              return route.movement === movement;
            })
            .reduce(function (sum, route) {
              return sum + routeValueOf(route);
            }, 0),
        );
      return roundedPcu(
        record.approaches.reduce(function (sum, source, sourceIndex) {
          return (
            sum +
            names.reduce(function (movementSum, sourceMovement) {
              if (
                sourceMovement !== movement ||
                movementTargetIndex(
                  record.approaches,
                  sourceIndex,
                  sourceMovement,
                ) !== index
              )
                return movementSum;
              return movementSum + movementValue(source, sourceMovement);
            }, 0)
          );
        }, 0),
      );
    });
    /*
     * 駛入那半格的支線標籤。
     *
     * 這裡原本取的是 sourceCode（原始代碼 A~G），而正上方的 destinationLabels
     * 取的是 approach.name。同一張圖卡的兩半因此各說各話：使用者把支線 A 改名
     * 成「岡山北路北側」之後，駛出那格寫「→岡山北路北側」，駛入那格還是「←A」；
     * 人工新增的支線更明顯，會印成「←人工2」。圖卡標題、道路名稱、箭頭提示
     * 全都用 name，只有這裡不是。PNG 與 PDF 匯出共用同一支產生程式，所以
     * 交付出去的圖也是錯的。
     *
     * 改成與 destinationLabels 完全相同的取法（含去掉開頭的「路口」兩字），
     * 兩半從此一致。支線代碼並沒有消失——圖卡標題那一行仍然寫「A · 支線名稱」。
     */
    const approachLabel = function (source?: { name?: string }) {
      return (source?.name || "").replace(/^路口\s*/, "");
    };
    const incomingSources = names.map(function (movement) {
      if (incomingRoutes.length)
        return incomingRoutes
          .filter(function (route) {
            return route.movement === movement;
          })
          .map(function (route) {
            return approachLabel(
              record.approaches.find(function (item) {
                return item.id === route.fromApproachId;
              }),
            );
          })
          .filter(Boolean)
          .join("、");
      return record.approaches
        .map(function (source, sourceIndex) {
          return movementTargetIndex(
            record.approaches,
            sourceIndex,
            movement,
          ) === index
            ? approachLabel(source) || source.sourceCode || ""
            : "";
        })
        .filter(Boolean)
        .join("、");
    });
    const cardSection = function (
      section: "inbound" | "outbound",
      sectionValues: number[],
      sectionTotal: number,
      labels: string[],
    ) {
      const title = section === "inbound" ? "駛入路口" : "駛出路口";
      return (
        '<text x="' +
        cardWidth / 2 +
        '" y="14" class="section-title ' +
        section +
        '">' +
        title +
        esc(sourceCode) +
        "</text>" +
        '<line x1="0" x2="' +
        cardWidth +
        '" y1="22" y2="22" class="cell-line"/>' +
        '<line x1="' +
        cell +
        '" x2="' +
        cell +
        '" y1="22" y2="82" class="cell-line"/>' +
        '<line x1="' +
        cell * 2 +
        '" x2="' +
        cell * 2 +
        '" y1="22" y2="82" class="cell-line"/>' +
        names
          .map(function (key, moveIndex) {
            const percentage = sectionTotal
              ? Math.round((sectionValues[moveIndex] / sectionTotal) * 100) +
                "%"
              : "0%";
            const directionLabel =
              section === "inbound"
                ? "←" + (labels[moveIndex] || "－")
                : "→" + (labels[moveIndex] || "－");
            /* 數值＋百分比的兩種模式都要上下兩行；只報百分比或只報數值的走單行。 */
            const valueMarkup =
              displayShowsValue(mode) && displayShowsPercent(mode)
                ? '<text x="' +
                  cell * (moveIndex + 0.5) +
                  '" y="65" class="value">' +
                  esc(sectionValues[moveIndex].toLocaleString() + " " + unit) +
                  '</text><text x="' +
                  cell * (moveIndex + 0.5) +
                  '" y="78" class="percent">' +
                  percentage +
                  "</text>"
                : '<text x="' +
                  cell * (moveIndex + 0.5) +
                  '" y="71" class="value">' +
                  esc(formatter(sectionValues[moveIndex], sectionTotal)) +
                  "</text>";
            return (
              '<text x="' +
              cell * (moveIndex + 0.5) +
              '" y="38" class="turn ' +
              key +
              '">' +
              MOVE_LABELS[key] +
              '</text><text x="' +
              cell * (moveIndex + 0.5) +
              '" y="52" class="destination">' +
              esc(directionLabel.slice(0, 9)) +
              "</text>" +
              valueMarkup
            );
          })
          .join("") +
        '<text x="' +
        cardWidth / 2 +
        '" y="96" class="' +
        (section === "inbound" ? "destination-sum" : "sum") +
        '">' +
        title +
        esc(sourceCode) +
        "合計 " +
        sectionTotal.toLocaleString() +
        " " +
        unit +
        "</text>"
      );
    };
    const pushCard = function (
      section: "inbound" | "outbound",
      centerPoint: { x: number; y: number },
    ) {
      const bounds = {
        minX: 8,
        maxX: width - cardWidth - 8,
        minY: 112,
        maxY: height - cardHeight - 8,
      };
      const clampX = function (value: number) {
        return Math.max(bounds.minX, Math.min(bounds.maxX, value));
      };
      const clampY = function (value: number) {
        return Math.max(bounds.minY, Math.min(bounds.maxY, value));
      };
      const x = clampX(centerPoint.x - cardWidth / 2);
      const y = clampY(centerPoint.y - cardHeight / 2);
      const sectionMarkup =
        section === "inbound"
          ? cardSection(
              "inbound",
              incomingValues,
              destinationTotal,
              incomingSources,
            )
          : cardSection("outbound", values, approachTotal, destinationLabels);
      const markup =
        '<g class="flow-card-group ' +
        section +
        '">' +
        '<rect width="' +
        cardWidth +
        '" height="' +
        cardHeight +
        '" rx="9" class="flow-card"/>' +
        '<text x="' +
        cardWidth / 2 +
        '" y="-9" class="bearing">' +
        (section === "outbound" ? "來源 " : "目的 ") +
        esc(sourceCode) +
        " · " +
        esc(approach.name) +
        "</text>" +
        sectionMarkup +
        "</g>";
      // 駛入卡與駛出卡各自記自己的位移，而且是「這個顯示模式」專屬的一組。
      const manualOffset = approachCardOffset(
        approach,
        flowSummaryMode,
        section,
      );
      /*
       * 把「自動排版的基準座標」與「可放置範圍」一起輸出到 DOM。
       * 拖曳時如果只用「原位移＋滑鼠位移」回存，一旦位置被邊界夾住，
       * 存下來的數字就會超出畫布，下次要往回拖時得先把超出的量拖回來，
       * 使用者會覺得卡片黏住不動、或是在不同顯示模式之間亂跳。
       * 有了基準與範圍，拖曳可以先夾好再換算成位移，畫面與存檔永遠一致。
       */
      const boxName =
        approach.name + " · " + (section === "inbound" ? "駛入" : "駛出");
      const handle =
        ' data-card-id="' +
        esc(approach.id) +
        '" data-card-section="' +
        section +
        '"';
      const geometryAttrs = function (baseX: number, baseY: number) {
        return (
          ' data-base-x="' +
          baseX.toFixed(1) +
          '" data-base-y="' +
          baseY.toFixed(1) +
          '" data-min-x="' +
          bounds.minX +
          '" data-max-x="' +
          bounds.maxX.toFixed(1) +
          '" data-min-y="' +
          bounds.minY +
          '" data-max-y="' +
          bounds.maxY.toFixed(1) +
          '"'
        );
      };
      if (n > 4) {
        pendingCards.push({
          markup,
          handle,
          name: boxName,
          bounds,
          preferred: { x: x + cardWidth / 2, y: y + cardHeight / 2 },
          manualOffset: {
            x: Number(manualOffset.x || 0),
            y: Number(manualOffset.y || 0),
          },
          width: cardWidth,
          height: cardHeight,
        });
      } else {
        /* 這兩個數字同時給 transform 與 layoutBoxes，不各算一次。 */
        const drawX = clampX(x + Number(manualOffset.x || 0));
        const drawY = clampY(y + Number(manualOffset.y || 0));
        layoutBoxes.push({
          kind: "card",
          name: boxName,
          x: drawX,
          y: drawY,
          w: cardWidth,
          h: cardHeight,
        });
        cardParts.push(
          "<g" +
            handle +
            geometryAttrs(x, y) +
            ' transform="translate(' +
            drawX.toFixed(1) +
            " " +
            drawY.toFixed(1) +
            ')">' +
            markup +
            "</g>",
        );
      }
    };
    if (flowSummaryMode === "both") {
      const tangent = { x: -Math.sin(approachRad), y: Math.cos(approachRad) };
      const splitOffset = cardWidth / 2 + roadWidth / 2 + 10;
      pushCard("outbound", {
        x: cardP.x + tangent.x * splitOffset,
        y: cardP.y + tangent.y * splitOffset,
      });
      pushCard("inbound", {
        x: cardP.x - tangent.x * splitOffset,
        y: cardP.y - tangent.y * splitOffset,
      });
    } else {
      pushCard(flowSummaryMode, cardP);
    }
  });

  if (pendingCards.length) {
    const cardWidth = Math.max.apply(
      null,
      pendingCards.map(function (card) {
        return card.width;
      }),
    );
    const cardHeight = Math.max.apply(
      null,
      pendingCards.map(function (card) {
        return card.height;
      }),
    );
    /*
     * ══════════════════════════════════════════════════════════════
     *  卡片比外圍格位多時要**把外圍加寬一圈**，不是往下多長一排
     * ══════════════════════════════════════════════════════════════
     *
     * 外圍原本是 14 個格位（上 4 ＋ 右 3 ＋ 下 4 ＋ 左 3）。使用者
     * 2026-09-20 把手動新增支線的上限從 7 調到 8，八叉在「駛入＋駛出並列」
     * 時是 **16 張卡**——多出來的兩張走舊的「往下再長一圈」補位規則，
     * 於是左上角那一張往下長一個卡高，**正好落在左側那一排的第一個格位上**。
     * scripts/e2e-eight-arm.mjs 實測到兩張卡完全疊在一起。
     *
     * ⚠️ 只在**格位真的不夠**時才加寬（卡片 > 14 張，也就是八叉並列）。
     *   無條件改成 5＋4＋5＋4 的話，四叉～七叉現有的版面會整批位移，
     *   連帶把使用者已經拖好的位置也一起搬走——他沒有要求改那些，
     *   而且釘住版面的守門測試會全紅。
     * ⚠️ 判斷條件寫成「卡片數 > 基本格位數」而不是「支線數 >= 8」：
     *   同一件事有兩種數法時，遲早會有一處改了另一處沒改。
     */
    const BASE_TOP_SLOTS = 4;
    const BASE_SIDE_SLOTS = 3;
    const needsWiderRing =
      pendingCards.length > BASE_TOP_SLOTS * 2 + BASE_SIDE_SLOTS * 2;
    const topSlotCount = needsWiderRing ? BASE_TOP_SLOTS + 1 : BASE_TOP_SLOTS;
    const horizontalCenters = Array.from(
      { length: topSlotCount },
      function (_, index) {
        const left = 16;
        const usable = width - left * 2 - cardWidth;
        return left + cardWidth / 2 + (usable * index) / (topSlotCount - 1);
      },
    );
    const topCenterY = 184;
    /*
     * 底排要**讓開右下角的流向圖例**。
     *
     * ⚠️ 這是 2026-09-10 修好排版預警之後第一件被抓出來的真缺陷：
     *    七叉路口的底排最右邊那一張卡佔到 y 774～890，而圖例畫在 y≈864～876，
     *    圖例又是在卡片之後才畫的，於是**圖例整條壓在「駛入路口D合計」那一行上**。
     *    舊的圓周估算從來沒報過（它連卡片在哪都算錯），使用者也不會知道
     *    這是系統排的還是自己拖的。截圖實測確認為真。
     *
     *    56 ＝ 圖例文字高度（約 26）＋「聚焦：路口X」那一行（約 18）＋ 呼吸空間。
     *    往上讓開之後，底排與側排中間仍有 130px 以上，不會擠在一起。
     */
    const LEGEND_BAND = 56;
    const bottomCenterY = height - cardHeight / 2 - 10 - LEGEND_BAND;
    const sideCenterX = cardWidth / 2 + 10;
    /*
     * ⚠️ 不加寬時**沿用原本寫死的三個值**，一個像素都不動：
     *   改成「依畫布高度平均分布」會讓四叉～七叉的側排整排位移，
     *   釘住版面的守門測試會全紅，而那個位移沒有任何好處。
     * 加寬時才改成四個、平均分布在上排與底排之間，
     * 間距一定大於一張卡的高度加上它上方那一行標題。
     */
    const sideCentersY = needsWiderRing
      ? Array.from({ length: BASE_SIDE_SLOTS + 1 }, function (_, index) {
          const first = topCenterY + cardHeight + 60;
          const last = bottomCenterY - cardHeight - 60;
          return first + ((last - first) * index) / BASE_SIDE_SLOTS;
        })
      : [340, 490, 640];
    const perimeterSlots = horizontalCenters
      .map(function (x) {
        return { x, y: topCenterY };
      })
      .concat(
        sideCentersY.map(function (y) {
          return { x: width - sideCenterX, y };
        }),
        horizontalCenters
          .slice()
          .reverse()
          .map(function (x) {
            return { x, y: bottomCenterY };
          }),
        sideCentersY
          .slice()
          .reverse()
          .map(function (y) {
            return { x: sideCenterX, y };
          }),
      );
    /*
     * 舊版用「位元遮罩 + 遞迴」窮舉所有卡片與外圍格位的配對，複雜度是
     * O(格位數 × 2^格位數 × 卡片數)：7 叉路口有 14 張卡、14 個格位時，光是一次
     * 重繪就要跑上百萬次遞迴，而這個函式在每次 render 會被呼叫兩三次——拖曳時
     * 每秒重繪數十次，分頁就會直接卡死。卡片多於格位時還會 throw，而它是在
     * render 當中被呼叫的，一 throw 整個畫面就變成空白錯誤頁。
     *
     * 改成「先貪婪配對最近的格位，再做幾輪兩兩交換」：結果與窮舉幾乎一樣好，
     * 但複雜度降到 O(卡片數 × 格位數)，而且格位不足時會自動補位而不是丟例外。
     */
    // 卡片比外圍格位多時往下再長一圈。
    // 原本的取模寫法 (len % len) 恆為 0，會一直複製第一個格位，
    // 而且 ring 對 14～27 都算出同一個值，結果補出來的格位互相重疊。
    const baseSlotCount = perimeterSlots.length;
    while (perimeterSlots.length < pendingCards.length && baseSlotCount > 0) {
      const index = perimeterSlots.length - baseSlotCount;
      const source = perimeterSlots[index % baseSlotCount];
      const ring = Math.floor(index / baseSlotCount) + 1;
      perimeterSlots.push({
        x: source.x,
        y: source.y + ring * (cardHeight + 12),
      });
    }
    const distance = function (cardIndex: number, slotIndex: number) {
      const dx =
        pendingCards[cardIndex].preferred.x - perimeterSlots[slotIndex].x;
      const dy =
        pendingCards[cardIndex].preferred.y - perimeterSlots[slotIndex].y;
      return dx * dx + dy * dy;
    };
    const pairs: Array<{ card: number; slot: number; cost: number }> = [];
    pendingCards.forEach(function (_, cardIndex) {
      perimeterSlots.forEach(function (__, slotIndex) {
        pairs.push({
          card: cardIndex,
          slot: slotIndex,
          cost: distance(cardIndex, slotIndex),
        });
      });
    });
    pairs.sort(function (a, b) {
      return a.cost - b.cost;
    });
    const assignedSlots = new Array<number>(pendingCards.length).fill(-1);
    const takenSlots = new Set<number>();
    pairs.forEach(function (pair) {
      if (assignedSlots[pair.card] >= 0 || takenSlots.has(pair.slot)) return;
      assignedSlots[pair.card] = pair.slot;
      takenSlots.add(pair.slot);
    });
    // 補上貪婪階段沒配到的卡片（理論上不會發生，但絕不讓它在 render 裡爆掉）
    assignedSlots.forEach(function (slot, cardIndex) {
      if (slot >= 0) return;
      const free = perimeterSlots.findIndex(function (_, slotIndex) {
        return !takenSlots.has(slotIndex);
      });
      assignedSlots[cardIndex] = free >= 0 ? free : 0;
      takenSlots.add(assignedSlots[cardIndex]);
    });
    // 兩兩交換：只要換過去總距離更短就換，跑幾輪就會收斂
    for (let pass = 0; pass < 4; pass += 1) {
      let improved = false;
      for (let a = 0; a < assignedSlots.length; a += 1)
        for (let b = a + 1; b < assignedSlots.length; b += 1) {
          const before =
            distance(a, assignedSlots[a]) + distance(b, assignedSlots[b]);
          const after =
            distance(a, assignedSlots[b]) + distance(b, assignedSlots[a]);
          if (after < before - 0.5) {
            const swap = assignedSlots[a];
            assignedSlots[a] = assignedSlots[b];
            assignedSlots[b] = swap;
            improved = true;
          }
        }
      if (!improved) break;
    }
    /*
     * ══════════════════════════════════════════════════════════════
     *  外圍格位不夠時補出來的位置會疊在既有格位上（八叉路口實測）
     * ══════════════════════════════════════════════════════════════
     *
     * 使用者 2026-09-20 把手動新增支線的上限從 7 調到 8。八叉在
     * 「駛入＋駛出並列」時是 **16 張卡**，而外圍只有 14 個格位
     *（上 4 ＋ 右 3 ＋ 下 4 ＋ 左 3）。多出來的兩張走「往下再長一圈」的
     * 補位規則，於是左上角那一張往下長 128px，**正好落在左側那一排的
     * 第一個格位上**——scripts/e2e-eight-arm.mjs 實測到
     * (16,254–232,370) 與 (10,282–226,398) 兩張卡疊在一起。
     *
     * ⚠️ 不改外圍格位的產生方式（例如把上下排從 4 個改成 5 個）：
     *   那會動到四叉～七叉現有的版面，連帶把使用者已經拖好的位置
     *   整批位移——他沒有要求改那些，而且釘住版面的守門測試會全紅。
     *   所以只在**最後真的疊在一起時**把它們推開：
     *   四～七叉沒有重疊，這一段完全不會動到它們（等於行為不變）。
     *
     * ⚠️ 推開的是**系統排的基準位置**，使用者手動拖的位移仍然照加。
     *   反過來把手動位移也一起推的話，等於系統偷偷搬動使用者擺好的卡。
     */
    const basePositions = pendingCards.map(function (card, cardIndex) {
      const slot = perimeterSlots[assignedSlots[cardIndex]];
      return {
        x: Math.max(
          card.bounds.minX,
          Math.min(card.bounds.maxX, slot.x - card.width / 2),
        ),
        y: Math.max(
          card.bounds.minY,
          Math.min(card.bounds.maxY, slot.y - card.height / 2),
        ),
      };
    });
    /*
     * 留的縫要**包含卡片上方那一行標題**（「來源 E · 示範環河快速道路」
     * 畫在卡片外面、y = -9，連字高約 20px）。
     * ⚠️ 只留 8px 的話矩形的確分開了，但上面那一行標題仍然壓在隔壁卡上——
     *   e2e-eight-arm 實測到「目的 G · …」壓到卡片 #10。
     *   量矩形卻忘了量寫在矩形外面的字，是這一類排版守門最常見的漏。
     */
    const CARD_GAP = 12;
    /*
     * 卡片上方那一行標題實際佔掉的高度：y = -9 起、字高約 11，
     * 再留 4px 呼吸空間。
     */
    const LABEL_BAND = 24;
    for (let pass = 0; pass < 8; pass += 1) {
      let moved = false;
      for (let a = 0; a < basePositions.length; a += 1)
        for (let b = a + 1; b < basePositions.length; b += 1) {
          const ca = pendingCards[a];
          const cb = pendingCards[b];
          const pa = basePositions[a];
          const pb = basePositions[b];
          /*
           * ⚠️ 卡片上方那一行標題（「來源 C · 示範東路三段」）畫在**矩形
           *   外面**，y = -9、字高約 11，所以實際佔用的範圍要往上多算一段。
           *   只比矩形的話：兩張卡差 20px 不算重疊，但下面那張的標題
           *   正好壓在上面那張的底部——e2e-eight-arm 實測到三處。
           *   「量了矩形卻忘了量寫在矩形外面的字」是這一類守門最常見的漏。
           */
          const aTop = pa.y - LABEL_BAND;
          const bTop = pb.y - LABEL_BAND;
          const overlapX =
            Math.min(pa.x + ca.width, pb.x + cb.width) - Math.max(pa.x, pb.x);
          const overlapY =
            Math.min(pa.y + ca.height, pb.y + cb.height) - Math.max(aTop, bTop);
          if (overlapX <= 0 || overlapY <= 0) continue;
          /*
           * 往**穿透比較淺**的那一軸推：另一軸推的話要移動的距離大得多，
           * 卡片會被甩到畫布另一頭，看起來像亂跳。
           */
          const shift = (Math.min(overlapX, overlapY) + CARD_GAP) / 2;
          if (overlapY <= overlapX) {
            const up = pa.y <= pb.y ? -1 : 1;
            pa.y = Math.max(
              ca.bounds.minY,
              Math.min(ca.bounds.maxY, pa.y + up * shift),
            );
            pb.y = Math.max(
              cb.bounds.minY,
              Math.min(cb.bounds.maxY, pb.y - up * shift),
            );
          } else {
            const left = pa.x <= pb.x ? -1 : 1;
            pa.x = Math.max(
              ca.bounds.minX,
              Math.min(ca.bounds.maxX, pa.x + left * shift),
            );
            pb.x = Math.max(
              cb.bounds.minX,
              Math.min(cb.bounds.maxX, pb.x - left * shift),
            );
          }
          moved = true;
        }
      if (!moved) break;
    }
    pendingCards.forEach(function (card, cardIndex) {
      const bounds = card.bounds;
      const baseX = basePositions[cardIndex].x;
      const baseY = basePositions[cardIndex].y;
      const x = Math.max(
        bounds.minX,
        Math.min(bounds.maxX, baseX + card.manualOffset.x),
      );
      const y = Math.max(
        bounds.minY,
        Math.min(bounds.maxY, baseY + card.manualOffset.y),
      );
      layoutBoxes.push({
        kind: "card",
        name: card.name,
        x,
        y,
        w: card.width,
        h: card.height,
      });
      cardParts.push(
        "<g" +
          card.handle +
          ' data-base-x="' +
          baseX.toFixed(1) +
          '" data-base-y="' +
          baseY.toFixed(1) +
          '" data-min-x="' +
          bounds.minX +
          '" data-max-x="' +
          bounds.maxX.toFixed(1) +
          '" data-min-y="' +
          bounds.minY +
          '" data-max-y="' +
          bounds.maxY.toFixed(1) +
          '" transform="translate(' +
          x.toFixed(1) +
          " " +
          y.toFixed(1) +
          ')" class="multi-arm-card">' +
          card.markup +
          "</g>",
      );
    });
  }

  /* 圖上那一行「這張圖是哪個時段」。全日時段沒有尖峰小時，寫涵蓋時數。 */
  const peakText =
    SCOPE_SHORT_LABELS[peak] + " " + scopeWindowLabel(record, peak);
  const meta =
    style === "simple"
      ? ""
      : '<g class="meta"><text x="30" y="38" class="title">' +
        esc(record.station) +
        "｜" +
        esc(record.name) +
        "</text>" +
        '<text x="30" y="64">調查日期 ' +
        esc(record.date || "未填") +
        "　" +
        esc(peakText) +
        "　單位：" +
        unit +
        "</text>" +
        '<text x="30" y="86">季度 ' +
        esc(quarterText(record.quarter)) +
        "　車種 " +
        esc(vehicle === "all" ? "全部車種" : vehicleLabel(record, vehicle)) +
        "　全路口流量 " +
        total.toLocaleString() +
        " " +
        unit +
        "</text></g>";
  /*
   * 「聚焦：路口X」的位置。
   *
   * ⚠️ 舊版寫死在 translate(30 775)——左下角。那裡**沒有保留給任何東西**，
   * 而數據卡的位置是使用者可以拖曳的，所以一定會有某些配置撞在一起；
   * 使用者實測就是被它遮住了轉向流量的卡牌。
   *
   * 改成貼在右下角的箭頭圖例正上方（使用者建議的做法）。圖例那一塊本來
   * 就是保留給圖例的，不會有卡片放進去。座標**跟著圖例算**，
   * 不再另外寫死一組常數——否則圖例日後移動時這一行又會落單。
   */
  const legendX = width - 280;
  const legendY = height - 26;
  /*
   * 圖上兩塊「不是卡片、但一定會被看到」的固定元件，也一起記進矩形清單。
   * 座標跟著上面實際用來畫的 legendX／legendY 與 cx／cy 走，不另外寫死常數。
   *   ・圖例：三組項目自 legendX 往右展開約 250、基線在 legendY，字高約 26。
   *   ・中央標籤：路口名稱在 cy-3、時段在 cy+15，外面還有 r=31 的圓底。
   */
  if (style !== "simple") {
    layoutBoxes.push({
      kind: "legend",
      name: "右下角的流向圖例",
      x: legendX - 10,
      y: legendY - 18,
      w: 270,
      h: 26,
    });
    layoutBoxes.push({
      kind: "center",
      name: "中央的路口名稱與時段",
      x: cx - 82,
      y: cy - 40,
      w: 164,
      h: 72,
    });
  }
  const focusNote =
    arrowMode === "focus" && record.approaches[focusIndex]
      ? '<g transform="translate(' +
        legendX +
        " " +
        (legendY - 20) +
        ')"><text class="legend-title">聚焦：' +
        esc(record.approaches[focusIndex].name) +
        "</text></g>"
      : "";

  const markup =
    '<svg id="turning-svg" xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    width +
    " " +
    height +
    '" role="img" aria-label="' +
    esc(record.name) +
    " " +
    esc(peakText) +
    ' 轉向圖">' +
    "<style>.canvas{fill:#fffdf8}.road{fill:#e8edf0;stroke:#9eabb1;stroke-width:1.4}.divider{fill:none;stroke:#fff;stroke-width:2;stroke-dasharray:9 8}.road-label-bg{fill:#fffdf8;stroke:#d5dddf}.road-name{font:600 12px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#334d56;text-anchor:middle}.junction{fill:#dfe6e8;stroke:#819198;stroke-width:2}.flow-card{fill:#fff;stroke:#1b5364;stroke-width:1.5;filter:url(#shadow)}.cell-line{stroke:#cfdbdf}.bearing{font:600 11px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#274b58;text-anchor:middle}.turn{font:700 10px sans-serif;text-anchor:middle}.turn.left{fill:#b82d89}.turn.through{fill:#1656b4}.turn.right{fill:#c6352a}.destination{font:8px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#718188;text-anchor:middle}.value{font:700 8px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#102c36;text-anchor:middle}.percent{font:700 8px sans-serif;fill:#60747b;text-anchor:middle}.sum{font:600 9px sans-serif;fill:#087f75;text-anchor:middle}.title{font:700 19px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#102c36}.meta text:not(.title){font:11px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#5f7076}.north{font:700 13px sans-serif;fill:#183d49}.center-label{font:700 12px sans-serif;fill:#fff;text-anchor:middle}.center-dot{fill:#0e7c75}.movement-path{fill:none;stroke-width:2;opacity:.54}.movement-path.left{stroke:" +
    colors.left +
    "}.destination-sum{font:600 9px sans-serif;fill:#8a5d16;text-anchor:middle}.movement-path.zero{opacity:.18;stroke-dasharray:5 4}.movement-path.through{stroke:" +
    colors.through +
    "}.movement-path.right{stroke:" +
    colors.right +
    "}.movement-path.focus{stroke-width:5;opacity:.98}.legend text{font:700 10px Noto Sans TC,sans-serif;fill:#415961}.legend-title{font:700 11px Noto Sans TC,sans-serif;fill:#173d49}" +
    // 圖卡標題（駛入路口A／駛出路口A）：原本沒有任何樣式，text-anchor 預設是 start，
    // 所以文字從卡片正中央往右排、看起來靠右甚至溢出卡片。補上置中與字級。
    ".section-title{font:700 13px Noto Sans TC,Microsoft JhengHei,sans-serif;text-anchor:middle;dominant-baseline:middle}.section-title.inbound{fill:#0e5f74}.section-title.outbound{fill:#8a4b12}" +
    "[data-card-id],[data-label-id]{cursor:grab}[data-card-id]:active,[data-label-id]:active{cursor:grabbing}" +
    "</style>" +
    '<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity=".12"/></filter>' +
    '<marker id="arrow-left" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="' +
    colors.left +
    '"/></marker>' +
    '<marker id="arrow-through" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="' +
    colors.through +
    '"/></marker>' +
    '<marker id="arrow-right" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="' +
    colors.right +
    '"/></marker></defs>' +
    '<rect class="canvas" width="' +
    width +
    '" height="' +
    height +
    '" rx="12"/>' +
    meta +
    roadParts.join("") +
    '<rect x="' +
    (cx - 82) +
    '" y="' +
    (cy - 82) +
    '" width="164" height="164" rx="18" class="junction"/>' +
    pathParts.join("") +
    '<circle cx="' +
    cx +
    '" cy="' +
    cy +
    '" r="31" class="center-dot"/><text x="' +
    cx +
    '" y="' +
    (cy - 3) +
    '" class="center-label">' +
    esc(record.station) +
    '</text><text x="' +
    cx +
    '" y="' +
    (cy + 15) +
    '" class="center-label">' +
    peak +
    "</text>" +
    cardParts.join("") +
    '<g class="legend" transform="translate(' +
    legendX +
    " " +
    legendY +
    // 這是流向箭頭的顏色圖例。舊版三個項目都寫成同樣的「●」而沒有上色，
    // 三個黑點看起來毫無意義；現在改成畫出與圖上箭頭同色的短線加箭頭。
    ')">' +
    (["left", "through", "right"] as const)
      .map(
        (movement, index) =>
          '<g transform="translate(' +
          index * 78 +
          ' 0)"><path d="M0 -4H22" stroke="' +
          colors[movement] +
          '" stroke-width="3" stroke-linecap="round" marker-end="url(#arrow-' +
          movement +
          ')"/><text x="30" y="0">' +
          MOVE_LABELS[movement] +
          "</text></g>",
      )
      .join("") +
    "</g>" +
    focusNote +
    '<g transform="translate(' +
    (width - 52) +
    ' 26)"><text x="12" y="12" class="north">N</text><path d="M12 56V21M12 21L5 32M12 21l7 11" fill="none" stroke="#183d49" stroke-width="2"/></g></svg>';
  /*
   * ⚠️ 把畫布尺寸與「基準尺寸」一起回傳，給畫面決定要用多大比例顯示。
   *
   * 使用者 2026-09-11：「路口示意圖的各路口不要分這麼開嗎?看起來不好看，
   * 能保持原中間路段原本的樣子就好，畫布增大只是增加四周空白處，
   * 讓各路口轉向流量的小卡(駛入/駛出)有地方放」。
   *
   * 圖上的幾何**本來就沒有跟著畫布放大**（支線半徑是固定的 205／145／158），
   * 看起來被拉開是因為 CSS 寫了 `.diagram-canvas svg{width:100%}`——
   * viewBox 一變大，整張圖就被**等比縮小**塞進同樣寬的面板，
   * 於是中央路口變小、支線之間的空白變大。
   *
   * 解法是讓顯示比例固定：七叉的畫布比四叉寬多少，就讓它在畫面上也寬多少
   * （超出面板的部分由 .diagram-canvas 的 overflow:auto 捲動）。
   * 這樣中央那一塊在四叉與七叉看起來**一樣大**，多出來的真的只是四周留白。
   */
  return {
    markup,
    boxes: layoutBoxes,
    width,
    height,
    /** 四支線時的畫布尺寸；顯示比例以它為 1 倍。 */
    baseWidth,
    baseHeight,
  };
}

/**
 * 只要 SVG 字串的呼叫端用這一支，簽章與 v2.1.63 完全相同。
 * ⚠️ 不要為了「順便」把它改掉——十個呼叫端都只需要字串，
 *    多回傳一個用不到的陣列只會讓每一處都要多寫一次 `.markup`。
 */
export function diagramMarkup(
  ...args: Parameters<typeof diagramLayout>
): string {
  return diagramLayout(...args).markup;
}

/*
 * ══════════════════════════════════════════════════════════════════
 *  圖表樣式：畫面與匯出圖片的唯一來源
 * ══════════════════════════════════════════════════════════════════
 *
 * 這一段一定要**內嵌在 SVG 裡**，不可以只寫在 globals.css。
 *
 * 理由是 svgToPng()：它把 SVG 序列化成 blob URL 再交給 <img> 畫進 canvas，
 * 而那份 blob 是**獨立文件**，讀不到頁面的樣式表。文字的大小與對齊
 * （font-size、text-anchor）都在樣式表裡，所以匯出的 PNG 會變成：
 *   ・字級從 9～10px 變成瀏覽器預設的 16px；
 *   ・text-anchor 從 middle／end 退回 start，**每一段字整個往右移半個字寬**，
 *     縱軸刻度從右對齊變成左對齊，直接壓進繪圖區。
 * 兩件事加起來就是使用者最擔心的那個結果：X 軸的字互相重疊、被切掉。
 * 畫面上完全正常，只有下載下來的那一張壞掉——而那一張才是要貼進簡報的。
 *
 * 折線本身在這個系統裡是用屬性（stroke／fill）畫的，所以線不會消失；
 * 但文字全靠樣式表。內嵌之後畫面與 PNG 讀同一份，不可能分岔。
 */
const CHART_FONT =
  "'Noto Sans TC','PingFang TC','Microsoft JhengHei','Heiti TC',sans-serif";
const CHART_SVG_STYLE = `
text{font-family:${CHART_FONT}}
.grid-lines line{stroke:#e8ecea;stroke-width:1}
.grid-lines text{font-size:9px;fill:#91a0a3;text-anchor:end}
.point-value{font-size:10px;fill:#31505a;text-anchor:middle;font-weight:700}
.x-label{font-size:9px;fill:#7a8a8e;text-anchor:middle;font-weight:700}
.trend-legend text{font-size:10px;fill:#536a72;font-weight:700}
.y-axis-title{font-size:10px;fill:#536a72;font-weight:700;letter-spacing:0.04em}
.axis-title{font-size:10px;fill:#536a72;font-weight:700}
`;

/**
 * X 軸標籤要間隔幾個才印一個。
 *
 * 季度會一路累積下去。目前的圖是「每一季都印」，16 季、24 季之後標籤就會
 * 擠成一團——而那時候使用者已經在簡報現場了。這裡照**實際字寬**算印得下
 * 幾個：中文字約等於字級、半形數字約 0.58 倍，估得比實際寬一點是刻意的，
 * 寧可少印一個也不要疊在一起。
 */
function labelStride(labels: string[], available: number, fontSize: number) {
  let widest = 0;
  for (const raw of labels) {
    const text = String(raw || "");
    let width = 0;
    for (let i = 0; i < text.length; i += 1)
      width += text.charCodeAt(i) > 255 ? fontSize : fontSize * 0.58;
    if (width > widest) widest = width;
  }
  const slot = widest + fontSize * 1.4;
  const fits = Math.max(1, Math.floor(available / slot));
  return Math.max(1, Math.ceil(labels.length / fits));
}


/**
 * 縱軸刻度要落在「好看的整數」上。
 *
 * 舊版直接把資料最大值乘上留白倍率當軸頂，再均分四格，刻度就變成
 * 6,015.5／4,511.6／3,007.8／1,503.9／0 這種一排亂數——看圖的人得先在
 * 心裡換算才知道某一點大概是多少。
 *
 * ⚠️ 這裡是**先決定每一格的高度**，再回推軸頂（max = 每格 × 格數），
 * 不是先決定軸頂再均分。先定軸頂的話，軸頂雖然是整數，每一格卻可能
 * 變成 1,750 這種數字（7,000 ÷ 4），刻度照樣不好讀。
 *
 * 每一格只允許 1／1.5／2／2.5／3／4／5／6／8／10 的 10 的次方倍——
 * 這幾個乘上任何一個 10 的次方，讀起來都是「一眼就知道多少」的數。
 * 往上吸附，所以軸頂一定 ≧ 資料最大值，而且最多只高一階，
 * 不會像先定軸頂那樣動不動就多出三成空白。
 */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceAxisMax(hi: number, count: number) {
  const top = hi > 0 ? hi : 1;
  const rough = top / Math.max(1, count);
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const scaled = rough / power;
  const pick = NICE_STEPS.find((value) => scaled <= value + 1e-9) ?? 10;
  const gap = pick * power;
  const digits = Math.max(0, -Math.floor(Math.log10(gap)));
  return {
    max: Number((gap * count).toFixed(digits + 2)),
    digits,
  };
}

/** 刻度數字的寫法：小數位數由間距決定，同一條軸上位數一致。 */
function tickText(value: number, digits: number) {
  return Number(value).toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 這一格 X 軸標籤要不要印（最後一季一定印，倒數幾個讓位）。 */
function showXLabel(index: number, count: number, stride: number) {
  if (index === count - 1) return true;
  if (index % stride !== 0) return false;
  /*
   * 門檻是整個 stride，不是一半。用一半的話，stride=2 時「倒數第二個」
   * 與「最後一個」只差 1 格就會同時印出來，兩個標籤直接疊在一起。
   */
  return stride === 1 || count - 1 - index >= stride;
}

/**
 * 把多張同寬的 SVG 直向接成一張。
 *
 * 「整體」在畫面上是上下兩張圖，匯出的 PNG 就必須也是上下兩張——
 * 少一張的 PNG 交出去，收到的人看不出來少了什麼。
 *
 * ⚠️ 每一張都包在自己的 `<g transform="translate(0, y)">` 裡，
 *   而**不是**去改每個元素的座標：那些 SVG 裡有 `rotate(-90)` 的縱軸名稱、
 *   有 `text-anchor`、有內嵌 `<style>`，逐一搬座標一定會漏掉幾個。
 *
 * ⚠️ 內層的 `<svg>` 標籤要換成 `<g>`：巢狀 `<svg>` 在序列化成獨立文件
 *   再畫進 canvas 時，各家瀏覽器對內層 viewBox 的處理並不一致。
 */
export function stackSvgMarkup(parts: string[], width: number, each: number) {
  const gap = 24;
  const height = parts.length * each + gap * (parts.length - 1);
  const body = parts
    .map(function (markup, index) {
      const inner = markup
        .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
        .replace(/<\/svg>\s*$/, "");
      return (
        `<g transform="translate(0,${index * (each + gap)})">` + inner + "</g>"
      );
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#fff"/>` +
    body +
    "</svg>"
  );
}

/*
 * 匯出圖的放大倍率。三支程式同一個數字（全日交通量 app/chart-png.ts
 * 的 EXPORT_SCALE 也是 3）。3 倍在 A4 報告與投影片上都還算銳利。
 *
 * ⚠️ PDF 例外，仍走 2 倍：那條路徑會把**每一筆紀錄**各畫一張再全部塞進
 *   同一份 PDF，倍率一提高，檔案大小與記憶體用量是平方成長的。
 *   單張 PNG 才是使用者會貼進報告的那一張。
 */
const EXPORT_PNG_SCALE = 3;

/**
 * 把畫面上某一張 SVG 圖存成高解析 PNG。
 *
 * ⚠️ 三件事一定要一致，所以收斂成這一支（三支程式同一套規矩）：
 *   (1) **只有圖，沒有說明文字**——使用者原話：「下載下來的圖本來就該只有圖，
 *      不能有文字，否則貼到簡報上時，看到那些應該由簡報者說明的文字展示在
 *      上方這樣才奇怪。」數值標籤（.point-value）在匯出時一律移除。
 *   (2) **白底**（svgToPng 裡填）——透明底貼到深色投影片上字會看不見。
 *   (3) **3 倍解析度**。
 *
 * ⚠️ 要 cloneNode 之後再刪標籤，**不可以就地刪畫面上的節點**——
 *   畫面上的標籤是 e2e-chart-layout 唯一的參照物，刪掉等於拆掉守門。
 */
async function svgMarkupToPng(markup: string, fileName: string) {
  /*
   * ⚠️ 這兩張幾何圖在 DOM 裡的 id 都是 "turning-svg"（markup 寫死的），
   *   同一頁同時出現兩個一模一樣的 id——用 getElementById 一定抓錯一張，
   *   而且抓錯的那張看起來也是一張正常的圖，不會有任何錯誤。
   *   所以這條路徑直接吃已經算好的 markup 字串，不碰 DOM。
   */
  downloadBlob(
    await svgToPng(markup),
    fileName.replace(/[\\/:*?"<>|]/g, "_"),
  );
}

async function svgElementToPng(svgId: string, fileName: string) {
  const node = document.getElementById(svgId);
  if (!node) return false;
  const clean = node.cloneNode(true) as SVGElement;
  clean.querySelectorAll(".point-value").forEach(function (label) {
    label.remove();
  });
  downloadBlob(
    await svgToPng(new XMLSerializer().serializeToString(clean)),
    fileName.replace(/[\\/:*?"<>|]/g, "_"),
  );
  return true;
}

/**
 * 把 SVG 的尺寸釘成**絕對像素**。
 *
 * ⚠️ 畫面上的圖常常寫 width="100%"（要跟著版面伸縮）。但匯出時這份 SVG
 *   會被當成**獨立文件**交給 <img>，那裡沒有「100% 是多少」可以參照，
 *   瀏覽器只好用替換元素的預設寬 300px——於是 1000×330 的圖被畫成
 *   300×99，再乘 3 倍也才 900px 寬。**畫面上完全正常，只有下載下來
 *   那一張又小又糊**。實測抓到的（尖峰形狀的兩張圖）。
 *
 * 尺寸一律從 viewBox 取，viewBox 才是這張圖真正的座標範圍。
 */
function withAbsoluteSvgSize(svg: string) {
  const viewBox = /viewBox="([\d.\s-]+)"/.exec(svg);
  if (!viewBox) return svg;
  const parts = viewBox[1].trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || !parts[2] || !parts[3]) return svg;
  const [, , width, height] = parts;
  return svg.replace(/<svg\b([^>]*)>/, function (match, attrs: string) {
    const cleaned = attrs
      .replace(/\swidth="[^"]*"/, "")
      .replace(/\sheight="[^"]*"/, "");
    return `<svg${cleaned} width="${width}" height="${height}">`;
  });
}

async function svgToPng(svg: string, scale = EXPORT_PNG_SCALE) {
  return new Promise<Blob>(function (resolve, reject) {
    const image = new Image();
    const url = URL.createObjectURL(
      new Blob([withAbsoluteSvgSize(svg)], {
        type: "image/svg+xml;charset=utf-8",
      }),
    );
    image.onload = function () {
      const canvas = document.createElement("canvas");
      canvas.width = image.width * scale;
      canvas.height = image.height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas unavailable"));
      ctx.scale(scale, scale);
      /*
       * ⚠️ 一定要先填白底。
       *
       * SVG 沒有畫到的地方在 PNG 裡是**透明**的，而透明底貼到深色投影片上
       * 字會整片看不見——畫面上完全看不出來（畫面本來就是白底卡片），
       * 只有交出去的那一張壞掉。轉向圖自己有一塊底色的矩形所以躲過了，
       * 但趨勢圖與尖峰分布圖沒有。
       */
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, image.width, image.height);
      ctx.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob) {
        return blob
          ? resolve(blob)
          : reject(new Error("PNG conversion failed"));
      }, "image/png");
    };
    image.onerror = reject;
    image.src = url;
  });
}

/*
 * 欄位對應不到支線時的空白轉向量。
 *
 * 舊版是把 values 依 index*3 切三格當成左／直／右直接存進去，有兩個致命問題：
 * 1. values 的順序是「車種 × 轉向」（機車左/機車直/機車右/小型車左…），
 *    不是「支線 × 轉向」，所以切出來的三格根本不是那一支支線的量。
 * 2. 完全沒有乘當量係數，卻存進 left/through/right 這三個「PCU 欄位」——
 *    實測 400 輛機車左轉（＝200 PCU/hr）被記成 400 PCU/hr，剛好兩倍，
 *    而且預覽畫面顯示 200、寫入之後變成 400，同一次匯入兩個數字。
 * 對應不到就是對應不到，寧可留白讓使用者去修檔案或設定車種對應，
 * 也不要給一個兩倍且單位錯誤的數字。
 */

/**
 * 某個統計範圍要用哪一組逐欄數值——**全系統只有這一支**。
 *
 * 三個尖峰各讀自己挑到的那一小時；FULL（全日時段）讀整份調查的加總，
 * 而且**只有 24 小時的調查才給值**：不足一天的調查（例如只做 07–09＋17–19）
 * 若讓它有值，那個數字會被當成「整天的量」寫進報告，而它其實只有 4 小時。
 *
 * 以前這裡寫成 `peak === "AM" ? item.am?.values : item.pm?.values`，
 * 一樣的三元判斷在檔案裡有兩處，多一個時段就得記得兩邊都補。
 */
function scopeValues(
  item: ImportPreview,
  scope: ScopeKey,
): number[] | undefined {
  if (scope === "FULL")
    /*
     * ⚠️ 這裡原本是 `coversFullDay(item.survey) ? … : undefined`，
     *   2026-09-11 拿掉那道門檻。
     *
     *   v2.1.64 把這個時段從「全日時段」改名成「**全調查時段**」，
     *   而且 fullDayUnavailableReason／scopeWindowLabel／peakWindowsFor
     *   都跟著改了——**只有資料這一條沒改**。
     *   後果：4 小時的路口調查，畫面抬頭誠實寫著「全調查時段：4 小時」，
     *   底下那一整欄卻全部是「－」，同一頁自相矛盾。
     *   使用者 2026-09-11 實測回報：「目前已經改成全調查時段，
     *   為什麼仍就沒有全調查時段尖峰、全調查時段的數值呢？」
     *
     *   「全調查時段」照定義就是**這份調查涵蓋的時段**，
     *   4 小時的調查有 4 小時的量，那是誠實的數字，不是冒充的一整天。
     *   單位由 scopeUnit 標成「PCU/調查時段」而不是「PCU/日」，
     *   讀者不會誤以為那是 24 小時的量。
     */
    return item.survey?.values;
  return item.peakWindows?.[scope]?.values;
}

function mappedMovement(
  item: ImportPreview,
  peak: ScopeKey,
  approachName: string,
  pce: PceMatrix,
  vehicleMappings: VehicleMappingTable,
) {
  const values = scopeValues(item, peak);
  const vehicle: Record<string, number> = {};
  const raw = { left: 0, through: 0, right: 0 };
  const pcu = { left: 0, through: 0, right: 0 };
  item.columns
    .filter(function (column) {
      return column.approach === approachName;
    })
    .forEach(function (column) {
      const count = Number(values?.[column.valueIndex]) || 0;
      const movement = column.movement || "through";
      const analysisVehicle = vehicleMappings[column.vehicle] || column.vehicle;
      vehicle[analysisVehicle] = Number(vehicle[analysisVehicle] || 0) + count;
      raw[movement] += count;
      pcu[movement] += count * pceFactor(pce, analysisVehicle, movement);
    });
  return {
    left: roundedPcu(pcu.left),
    through: roundedPcu(pcu.through),
    right: roundedPcu(pcu.right),
    vehicle: vehicle,
    rawVehicleTotal: raw.left + raw.through + raw.right,
  };
}

function inferApproachGeometry(
  item: ImportPreview,
  mappedNames: string[],
  movements: Array<{ AM: Movement; PM: Movement }>,
) {
  const count = mappedNames.length;
  const angles = Array.from({ length: count }, function (_, index) {
    return -90 + (index * 360) / Math.max(1, count);
  });
  let tSideIndex = -1;
  if (count === 3) {
    const throughTotals = movements.map(function (row) {
      return row.AM.through + row.PM.through;
    });
    tSideIndex = throughTotals.indexOf(Math.min(...throughTotals));
    const before = (tSideIndex + count - 1) % count;
    const after = (tSideIndex + 1) % count;
    const westEvidence =
      movements[before].AM.left +
      movements[before].PM.left +
      movements[after].AM.right +
      movements[after].PM.right;
    const eastEvidence =
      movements[before].AM.right +
      movements[before].PM.right +
      movements[after].AM.left +
      movements[after].PM.left;
    angles[before] = 90;
    angles[after] = -90;
    angles[tSideIndex] = westEvidence >= eastEvidence ? 180 : 0;
  }
  const roadParts = item.name
    .replace(/口$/u, "")
    .split(/[－/／]/u)
    .map(function (part) {
      return part.trim();
    })
    .filter(Boolean);
  const mainRoad = roadParts[0] || "主線";
  const sideRoad = roadParts[1] || "支線";
  const names = mappedNames.map(function (code, index) {
    if (count !== 3 || tSideIndex < 0) return "路口 " + code;
    if (index === tSideIndex)
      return sideRoad + (angles[index] === 180 ? "西側" : "東側");
    return mainRoad + (angles[index] === -90 ? "北側" : "南側");
  });
  return { angles, names, inferredT: count === 3 && tSideIndex >= 0 };
}

/**
 * 「這個轉向到底存不存在」的使用者答案。
 *
 * 鍵值刻意用**路口名稱的正規化鍵 ＋ 支線代號 ＋ 轉向**，不用站號、不含季度：
 * 站號會改（同一個路口換過站號是有的），季度更是每一季都不同。
 * 用這個鍵，使用者對同一個路口答過一次，之後每一季匯入都直接套用，
 * 不會像舊版那個幾何確認視窗一樣每季重跳。
 */
export type MovementPresence = "yes" | "no";
export function movementPresenceKey(
  intersectionKey: string,
  fromCode: string,
  toCode: string,
  movement: MovementKey,
) {
  return [intersectionKey, fromCode, toCode, movement].join("|");
}

function recordFromPreview(
  item: ImportPreview,
  projectId: string,
  quarter: string,
  pce: PceMatrix,
  vehicleMappings: VehicleMappingTable,
  presenceAnswers: Record<string, MovementPresence> = {},
  /*
   * 依季別／路口的係數覆寫。
   * ⚠️ 選填：不傳＝沒有覆寫＝改版前的行為，一個數字都不會變。
   */
  scopes?: FactorScope<PceMatrix>[] | null,
  /*
   * ══════════════════════════════════════════════════════════════════
   *  這一筆要用**哪一個路口名稱**去查／存「這個轉向存不存在」的答案
   *  （2026-09-25 新增）
   * ══════════════════════════════════════════════════════════════════
   *
   * ⚠️ 選填。不傳＝用調查表自己的名字，行為與改版前相同。
   *
   * 為什麼需要它：`movementPresence` 的鍵是
   *   `canonicalIntersectionKey(路口名) | 起 | 訖 | 轉向`。
   * 舊版**查詢端**用的是「這次調查表自己的名字」（item.name），
   * 而**寫入端**用的是 `record.name`，那個值在併入既有路口之後
   * 已經被改寫成合併目標的名字。只要使用者選過一次「併入既有路口」，
   * 兩把鍵就永遠不相等（併入的條件本身保證 from !== to），
   * 於是答案寫進去之後**永遠查不到**——裁決視窗每一季再跳一次。
   *
   * 而程式三處註解都宣稱「下一季再匯入同一個路口就直接套用，不會再問第二次」。
   *
   * 正解：由呼叫端把**解析過別名／合併目標之後的名字**傳進來，
   * 讓查與存用同一把鑰匙。
   */
  presenceKeyName?: string,
): TrafficRecord {
  const intersectionKeyForPresence = canonicalIntersectionKey(
    storedNameOf({ name: presenceKeyName ?? item.name } as TrafficRecord),
  );
  /*
   * ── 這一筆要用哪一組當量係數？ ──────────────────────────
   *
   * 順序有意義，不可以調換：
   *   (1) item.pceUsed —— 匯入預覽畫面上使用者**當場改過**的那一組。
   *      他剛剛才在畫面上調整完，那是最明確的意思表示，範圍覆寫不該蓋掉它。
   *   (2) 依（季別, 路口）解析出來的覆寫
   *   (3) 計畫預設 pce
   *
   * ⚠️ 路口的識別用 canonicalIntersectionKey，與歷季趨勢串接同一條線用的
   *   是同一支函式。用站號的話，站號逐季會變（T13-04 → T15-04），
   *   覆寫在下一季就自動失效，而使用者不會收到任何提示。
   */
  const appliedPce =
    item.pceUsed ||
    resolvePceFactors(scopes, pce, quarter, intersectionKeyForPresence);
  const length = Math.max(
    ...SCOPE_KEYS.map(function (key) {
      return scopeValues(item, key)?.length || 0;
    }),
    0,
  );
  const mappedNames = item.approaches.length
    ? item.approaches
    : Array.from(
        new Set(
          item.columns.map(function (column) {
            return column.approach;
          }),
        ),
      );
  const useMapping =
    item.mappingConfidence !== "low" &&
    mappedNames.length >= 3 &&
    mappedNames.length <= 7;
  const armCount = useMapping
    ? mappedNames.length
    : length >= 9 && length <= 21 && length % 3 === 0
      ? length / 3
      : 4;
  const mappedMovements = mappedNames.map(function (name) {
    return Object.fromEntries(
      SCOPE_KEYS.map(function (key) {
        return [
          key,
          mappedMovement(item, key, name, appliedPce, vehicleMappings),
        ];
      }),
    ) as Record<ScopeKey, ReturnType<typeof mappedMovement>>;
  });
  const geometry = inferApproachGeometry(item, mappedNames, mappedMovements);
  const approaches: Approach[] = Array.from(
    { length: armCount },
    function (_, index) {
      const approachName = useMapping
        ? geometry.names[index]
        : "支線 " + (index + 1);
      const approachAngle = useMapping
        ? geometry.angles[index]
        : -90 + (index * 360) / armCount;
      return {
        id: item.station + "-" + (mappedNames[index] || "A" + (index + 1)),
        sourceCode: mappedNames[index] || "A" + (index + 1),
        name: approachName,
        bearing: bearingFromAngle(approachAngle),
        angle: approachAngle,
        lanes: null,
        laneType: "other",
        laneComposition: { fast: 0, slow: 0, motorcycle: 0, other: 0 },
        saturationFlow: null,
        effectiveGreen: null,
        cycleLength: null,
        capacity: null,
        movements: {
          /*
           * 只要這一支支線在原始檔裡有對應的欄位，就用 mappedMovement 算
           *（它會依每一欄自己的車種與轉向別套用當量係數，是正確的算法）。
           * 完全對應不到才留白。
           */
          ...emptyScopeMovements(),
          ...(mappedMovements[index] || {}),
        },
      };
    },
  );
  const routeKeys = new Map<
    string,
    { from: string; to: string; movement: "left" | "through" | "right" }
  >();
  const destinationForColumn = function (
    column: ImportPreview["columns"][number],
  ) {
    if (column.destination) return column.destination;
    const sourceIndex = mappedNames.indexOf(column.approach);
    const targetIndex = movementTargetIndex(
      approaches,
      sourceIndex,
      column.movement || "through",
    );
    return (
      approaches[targetIndex]?.sourceCode || mappedNames[targetIndex] || ""
    );
  };
  /*
   * key 一定要含轉向別。
   *
   * 三叉路口（T 字）上，movementTargetIndex 對「左轉」與「直行」會解出
   * 同一支目的支線（兩個候選與直行目標等距，取到同一個）。舊寫法只用
   * from→to 當 key，後來的那一欄就把前面的覆蓋掉：左轉整批消失，
   * 它的流量被併進直行、用直行的當量換算，而且每次重新整理
   * syncRouteTotals 會用這批殘缺的流向回寫 approaches，路口總量因此
   * 一次比一次少（實測 2,328 → 2,264 PCU/hr，使用者完全沒有編輯過）。
   */
  item.columns.forEach(function (column) {
    const movement = column.movement || "through";
    const destination = destinationForColumn(column);
    if (destination)
      routeKeys.set(column.approach + "→" + destination + "→" + movement, {
        from: column.approach,
        to: destination,
        movement,
      });
  });
  const allRoutes = [...routeKeys.values()]
    .map(function (route, index) {
      const volumes = Object.fromEntries(
        SCOPE_KEYS.map(function (key) {
          const values = scopeValues(item, key);
          const vehicle: Record<string, number> = {};
          let routePcu = 0;
          item.columns
            .filter(function (column) {
              const destination = destinationForColumn(column);
              // 轉向別也要比對，否則同一個 from→to 的左轉與直行兩條流向
              // 會各自把對方的欄位也加進來，流量變成兩倍。
              return (
                column.approach === route.from &&
                destination === route.to &&
                (column.movement || "through") === route.movement
              );
            })
            .forEach(function (column) {
              const count = Number(values?.[column.valueIndex]) || 0;
              const movement = column.movement || route.movement;
              const analysisVehicle =
                vehicleMappings[column.vehicle] || column.vehicle;
              vehicle[analysisVehicle] =
                Number(vehicle[analysisVehicle] || 0) + count;
              routePcu +=
                count * pceFactor(appliedPce, analysisVehicle, movement);
            });
          return [key, { pcu: roundedPcu(routePcu), vehicle }];
        }),
      ) as RouteFlow["volumes"];
      const surveyVehicle: Record<string, number> = {};
      item.columns
        .filter(function (column) {
          const destination = destinationForColumn(column);
          // 與上面的尖峰值一樣，轉向別也要比對；三叉路口的左轉與直行
          // 共用同一個 from→to，不比對會互相把對方的量也加進來。
          return (
            column.approach === route.from &&
            destination === route.to &&
            (column.movement || "through") === route.movement
          );
        })
        .forEach(function (column) {
          const analysisVehicle =
            vehicleMappings[column.vehicle] || column.vehicle;
          surveyVehicle[analysisVehicle] =
            Number(surveyVehicle[analysisVehicle] || 0) +
            (Number(item.survey?.values[column.valueIndex]) || 0);
        });
      return {
        id: item.station + "-R" + (index + 1),
        fromApproachId: approaches[mappedNames.indexOf(route.from)]?.id || "",
        toApproachId: approaches[mappedNames.indexOf(route.to)]?.id || "",
        movement: route.movement,
        volumes,
        survey: { vehicle: surveyVehicle },
      };
    })
    .filter(function (route) {
      return route.fromApproachId && route.toApproachId;
    });
  /*
   * 把「調查表上根本沒有這個轉向」的流向拿掉。
   *
   * 症狀：三岔路口的 OD 清單會出現「路口A 駛往 路口B」「路口A 駛往 路口C」
   * 之中同一個目的路口重複兩次。成因有兩個，缺一不可：
   *  ・三岔的調查表每一支支線一定有一欄整欄寫 `--`（A 沒有右轉、
   *    B 沒有直進、C 沒有左轉），但欄位照樣排出來，所以 columns 仍然是
   *    3 支 × 3 轉向 × 車種。
   *  ・三岔只有兩個去向，三個轉向硬要對應兩支目的支線，
   *    movementTargetIndex 必然讓其中兩個轉向解到同一支。
   *
   * **判斷依據是調查表原本寫什麼，不是算出來是不是 0。**
   * 調查表用兩種寫法表達兩件不同的事：
   *   `0`  ＝ 這個轉向存在，只是整天量到 0
   *   `--` ＝ 這個路口根本沒有這個轉向
   * 解析出來的數值兩者都是 0（刻意不改，改了就是動計算），
   * 所以 inspectWorkbook 另外逐欄記了 numericCells／placeholderCells，
   * 這裡只認「一格數字都沒有、而且出現過橫線」的欄位。
   *
   * 為什麼不能用「全為 0」判斷（實測）：四岔與七岔的真實檔各有 6～9 欄
   * 是**真的整天量到 0**（後昌路－宏毅二路假日 9 欄、中山北路－岡山路口
   * 七叉的路口A 9 欄、台1－路科一路口 8 欄），那些是真實資料，不能刪。
   * 而三份真實三岔檔各有剛好 12 欄是純橫線、0 欄誤判——分得乾乾淨淨。
   *
   * 被拿掉的流向整份調查都是 0，**任何加總都不受影響**
   * （實測路線合計＝支線合計，差 0）。
   */
  const columnIsAbsent = function (column: ImportPreview["columns"][number]) {
    return (
      Number(column.numericCells ?? 0) === 0 &&
      Number(column.placeholderCells ?? 0) > 0
    );
  };
  const routeColumns = function (route: (typeof allRoutes)[number]) {
    const from = approaches.find((a) => a.id === route.fromApproachId);
    const to = approaches.find((a) => a.id === route.toApproachId);
    if (!from || !to) return [];
    return item.columns.filter(function (column) {
      return (
        column.approach === from.sourceCode &&
        destinationForColumn(column) === to.sourceCode &&
        (column.movement || "through") === route.movement
      );
    });
  };
  /*
   * 「整欄空白」是唯一分不出來的情況：既沒有填數值、也沒有寫 `--`。
   * 這時候先保留（保留最多是多一列 0，刪掉卻可能弄丟真實流向），
   * 並標成 presence: "unknown"，由匯入後跳出的視窗請使用者裁決。
   * 使用者對同一個路口同一個轉向答過一次之後，答案會存進 movementPresence，
   * 下一季再匯入同一個路口就直接套用，不會再問第二次。
   */
  const columnIsBlank = function (column: ImportPreview["columns"][number]) {
    return (
      Number(column.numericCells ?? 0) === 0 &&
      Number(column.placeholderCells ?? 0) === 0
    );
  };
  /*
   * 逐支線的算術盤點：這一支印了幾個轉向欄、只能去幾個地方、
   * 所以「應該」有幾個轉向不存在。詳見 lib/traffic 的 auditArmMovements()。
   *
   * 為什麼要用它來分流，而不是所有純橫線一律移除（v2.1.56 的做法）：
   *   ・三岔每支預期 1 個 → 正好 1 個就是幽靈列，安靜移除，不打擾使用者。
   *     （不然每一季匯入三岔都要跳三題，就變成使用者抱怨過的那種每季煩擾。）
   *   ・四岔預期 0 個 → 出現橫線就是**超出預期**。四岔的三個轉向本來各自
   *     對應一個真實去向，會畫橫線通常代表禁止轉向或單行道，那是真實的
   *     路口管制資訊。v2.1.56 會把它**安靜刪掉**、畫面上少一條而且不出聲，
   *     這是一個會沉默出錯的地方，本版改成列進裁決視窗讓使用者看見。
   *
   * ⚠️ 預設選項刻意設成「移除」＝與 v2.1.56 的結果相同。
   *    也就是說本版**不改變任何既有檔案的結果**，只是把原本看不見的移除
   *    變成看得見、可以一鍵改回保留、而且答案會記住。
   */
  const armAudits = auditArmMovements(item.columns);
  const auditOf = function (code: string) {
    return armAudits.find((audit) => audit.approach === code);
  };
  const codeOfApproach = function (id: string) {
    return approaches.find((a) => a.id === id)?.sourceCode ?? "";
  };
  const askPresence = function (
    route: (typeof allRoutes)[number],
    reason: "blank" | "placeholder",
    suggestion: "yes" | "no",
    basis: string,
  ) {
    const answered =
      presenceAnswers[
        movementPresenceKey(
          intersectionKeyForPresence,
          codeOfApproach(route.fromApproachId),
          codeOfApproach(route.toApproachId),
          route.movement,
        )
      ];
    if (answered === "no") return null;
    if (answered === "yes") return route;
    return {
      ...route,
      presence: "unknown" as const,
      presenceReason: reason,
      presenceSuggestion: suggestion,
      presenceBasis: basis,
    };
  };
  const routes = allRoutes
    .map(function (route) {
      const columns = routeColumns(route);
      /*
       * 對不到來源欄位就一律保留——寧可多列一條，也不要因為對應規則有變
       * 而無聲刪掉真實流向。
       */
      if (!columns.length) return route;
      const audit = auditOf(codeOfApproach(route.fromApproachId));

      /* ── 整欄畫橫線：調查員明寫「沒有這個轉向」 ── */
      if (columns.every(columnIsAbsent)) {
        if (!audit || !absentBeyondExpectation(audit)) return null;
        return askPresence(
          route,
          "placeholder",
          "no",
          `這是 ${audit.destinationCount + 1} 岔路口，路口${audit.approach} 印了 ` +
            `${audit.movementCount} 個轉向欄、可以去 ${audit.destinationCount} 個地方，` +
            `照算術應該 ${audit.expectedAbsent} 個轉向不存在，但調查表畫了 ` +
            `${audit.absent.length} 個橫線。橫線多過預期時，通常代表這裡有禁止轉向` +
            "或單行道等實際管制，不是版面上的空欄；也可能是欄位被讀錯。" +
            "維持移除會與前一版結果相同，但請先確認這不是真實存在的轉向。",
        );
      }

      /* ── 整欄空白：兩種寫法都沒有，本來就分不出來 ── */
      if (!columns.every(columnIsBlank)) return route;
      const suggestByArithmetic =
        audit &&
        blankExplainedByArithmetic(audit) &&
        audit.blank.includes(route.movement);
      return askPresence(
        route,
        "blank",
        suggestByArithmetic ? "no" : "yes",
        suggestByArithmetic
          ? `這是 ${audit.destinationCount + 1} 岔路口，路口${audit.approach} 照算術應該有 ` +
              `${audit.expectedAbsent} 個轉向不存在，調查表只畫了 ${audit.absent.length} 個橫線，` +
              `而剛好只有這 ${audit.blank.length} 個轉向整欄空白——` +
              "數量對得上，所以空白的這個很可能就是不存在的那一個。"
          : "調查表既沒有填數值、也沒有寫橫線，系統無從判斷；" +
              "算術上也指不出是哪一個，所以預設保留。",
      );
    })
    .filter(function (route): route is NonNullable<typeof route> {
      return Boolean(route);
    });
  const surveyVehicle: Record<string, number> = {};
  item.columns.forEach(function (column) {
    const analysisVehicle = vehicleMappings[column.vehicle] || column.vehicle;
    surveyVehicle[analysisVehicle] =
      Number(surveyVehicle[analysisVehicle] || 0) +
      (Number(item.survey?.values[column.valueIndex]) || 0);
  });
  /*
   * 逐格追溯只做三個尖峰，不做全日時段。
   *
   * 尖峰是一小時、頂多四格，攤開來看得出「哪一格哪一欄湊成這個數字」；
   * 全調查時段是整段涵蓋 × 每一欄，一筆七叉路口就是好幾萬列，存下來會
   * 把儲存配額吃掉，而且沒有人會去逐格看一整天。
   * ⚠️ 本系統自 v2.1.53 起存的是 **IndexedDB**（見 lib/state-storage.ts），
   *   不是 localStorage；配額大得多，但仍然不是拿來放好幾萬列的地方。
   * 全日的數字仍然可以在「流量核對工作台」與匯出的 Excel 裡對得出來。
   */
  const traceCells = PEAK_KEYS.flatMap(function (tracePeak) {
    const window = item.peakWindows?.[tracePeak];
    if (!window) return [];
    return (item.intervalRows || [])
      .filter(function (row) {
        return row.start >= window.start && row.start < window.end;
      })
      .flatMap(function (row) {
        return item.columns.map(function (column) {
          const analysisVehicle =
            vehicleMappings[column.vehicle] || column.vehicle;
          const movement = column.movement || "through";
          const rawCount = Number(row.values[column.valueIndex]) || 0;
          const factor = pceFactor(appliedPce, analysisVehicle, movement);
          const sourceRow = row.sourceRows?.[column.sheet];
          return {
            peak: tracePeak,
            sheet: column.sheet,
            cell: sourceRow
              ? XLSX.utils.encode_cell({
                  r: sourceRow - 1,
                  c: column.sourceColumn,
                })
              : XLSX.utils.encode_col(column.sourceColumn) + "?",
            time: row.label,
            approach: column.approach,
            destination: column.destination,
            movement: column.movement,
            vehicle: analysisVehicle,
            vehicleLabel:
              CORE_VEHICLE_LABELS[analysisVehicle] || column.vehicleLabel,
            /*
             * ⚠️ 原始調查表那一欄的車種名要留著。
             *   歸類之後 vehicle／vehicleLabel 是「特種車」，但調查表上
             *   那一欄寫的是「聯結車」——這張表的用途正是逐格對回原始檔案，
             *   只留歸類後的名字就對不回去了（N-5）。
             */
            sourceVehicle: column.vehicle,
            sourceVehicleLabel: column.vehicleLabel,
            rawCount,
            factor,
            pcu: roundedPcu(rawCount * factor),
          };
        });
      });
  });
  const traceIntervals = (item.intervalRows || []).map(function (row) {
    let pcu = 0;
    let vehicles = 0;
    item.columns.forEach(function (column) {
      const count = Number(row.values[column.valueIndex]) || 0;
      const analysisVehicle = vehicleMappings[column.vehicle] || column.vehicle;
      pcu +=
        count *
        pceFactor(appliedPce, analysisVehicle, column.movement || "through");
      vehicles += count;
    });
    return {
      start: row.start,
      end: row.start + Number(item.intervalMinutes || 15),
      pcu: roundedPcu(pcu),
      vehicles,
    };
  });
  return {
    id:
      projectId +
      "-" +
      quarter +
      "-" +
      item.station +
      (item.surveyType && item.surveyType !== "待設定"
        ? "-" + item.surveyType
        : ""),
    projectId: projectId,
    station: item.station,
    name:
      item.surveyType && item.surveyType !== "待設定"
        ? item.name + "（" + item.surveyType + "）"
        : item.name,
    rawName: item.file,
    quarter: quarter,
    date: item.date,
    /*
     * 同一份檔案讀到兩個以上不同日期時的候選清單，要跟著紀錄一起存下來——
     * 原始檔匯完就不在手上了，事後執行異常檢查沒有辦法再掃一次。
     */
    surveyDateCandidates:
      item.surveyDateCandidates && item.surveyDateCandidates.length > 1
        ? item.surveyDateCandidates
        : undefined,
    surveyType: item.surveyType,
    pceUsed: structuredClone(appliedPce),
    pceVersion: "匯入快照 " + new Date().toISOString(),
    revision: 1,
    review: { status: "待核對", updatedAt: new Date().toISOString(), note: "" },
    sourceTrace: {
      templateId: item.templateId || "semantic-turning-v1",
      templateName: item.templateName || "一般語意轉向表",
      dateSource: item.dateSource,
      cells: traceCells,
      intervals: traceIntervals,
    },
    /*
     * 把這一次匯入的預覽原封不動留下來，之後才有辦法用新的歸類與係數重算。
     *
     * ⚠️ 存的是**還沒套上這次係數**的那一份也沒關係——重算時會重跑
     *   configuredImportPreview()，peakWindows 與 pceUsed 都會被重新算過。
     *   關鍵是 intervalRows × columns（逐時段 × 逐支線 × 逐轉向 × 逐車種），
     *   那是唯一無法從彙總結果反推回來的東西。
     */
    sourcePreview: item,
    vehicleLabels: Object.fromEntries(
      item.detectedVehicles.map(function (definition) {
        const target = vehicleMappings[definition.id] || definition.id;
        return [target, CORE_VEHICLE_LABELS[target] || definition.label];
      }),
    ),
    vehicleMapping: Object.fromEntries(
      item.detectedVehicles.map(function (definition) {
        return [definition.id, vehicleMappings[definition.id] || definition.id];
      }),
    ),
    peaks: Object.fromEntries(
      PEAK_KEYS.map(function (key) {
        const window = item.peakWindows?.[key];
        return [
          key,
          window
            ? {
                start: formatMinutes(window.start),
                end: formatMinutes(window.end),
              }
            : /* 空字串＝這個尖峰沒有值，和「00:00」是兩回事。 */
              { start: "", end: "" },
        ];
      }),
    ) as TrafficRecord["peaks"],
    /*
     * 使用者對「橫跨中午那一小時」的決定要跟著紀錄存下來。
     * 決定本身也是資料的一部分——不記下來，日後回頭看就不知道當初怎麼判的。
     */
    noonSide: item.noonSide,
    /*
     * 匯入時讀到的逐時間格原始資料，原樣留著（見 TrafficRecord.sourceIntervals）。
     *
     * 現在「各方向各自認定尖峰」會讀它重新挑選各支線時段；同時保留它作為
     * 未來重算的原料，避免新增功能時要求使用者重匯全部計畫。
     *
     * ⚠️ 只留「值」與「這一欄是誰」，不留樣式、不留原始儲存格座標——
     *   後者已經由既有的逐格追溯（sourceCells）負責，存兩份會分岔。
     */
    sourceIntervals:
      item.intervalRows?.length && item.intervalMinutes
        ? {
            intervalMinutes: item.intervalMinutes,
            columns: item.columns.map(function (column) {
              return {
                approach: column.approach,
                vehicle: column.vehicle,
                movement: column.movement || "through",
                ...(column.destination ? { destination: column.destination } : {}),
              };
            }),
            rows: item.intervalRows.map(function (row) {
              return {
                start: row.start,
                label: row.label,
                lengthMinutes: row.lengthMinutes,
                values: row.values,
              };
            }),
          }
        : undefined,
    survey: item.survey
      ? {
          intervals: item.survey.intervals,
          minutes: item.survey.minutes,
          vehicle: surveyVehicle,
        }
      : undefined,
    approaches: approaches,
    routes: routes,
    movementRule: referenceMovementForOd(
      item.name,
      "A",
      "E",
      approaches.map(function (approach) {
        return approach.sourceCode || "";
      }),
    )
      ? "reference-calculation"
      : "geometry-suggested",
    sourceFiles: [item.file],
    importedAt: new Date().toISOString(),
    validation: {
      referenceFound: false,
      matchRate: null,
      notes: [
        useMapping
          ? item.layout === "od"
            ? "已依原始表保留每一組起點→終點與四車種流量。"
            : "已依各入口區塊辨識左直右與四車種並套用當量。"
          : "欄位語意辨識不足，只保留尖峰數列；不執行車種合計一致性判定。",
        geometry.inferredT
          ? "道路幾何：已依三支線直行缺口推定 T 字主線與側路；方位仍可在道路與流向管理人工校正。"
          : armCount > 4
            ? "道路幾何未確認：多岔路不得將等角配置視為正式幾何，匯出前請依監測日誌校正支線角度。"
            : "道路幾何：四岔路採方位模板，仍可人工校正。",
        item.dateSource
          ? "調查日期來源：" +
            item.dateSource.sheet +
            "!" +
            item.dateSource.cell +
            "（" +
            item.dateSource.raw +
            "）"
          : "日期辨識未成功：已掃描交通量工作表標題區（" +
            (item.sheets.traffic.join("、") || "無可辨識工作表") +
            "），未找到可解析的民國／西元日期；不代表原始檔一定空白。",
      ],
    },
  };
}

function Kpi(props: {
  label: string;
  value: string;
  note: string;
  accent?: string;
}) {
  return (
    <article className={"kpi " + (props.accent || "")}>
      <div className="kpi-top">
        <span>{props.label}</span>
        <i />
      </div>
      <strong>{props.value}</strong>
      <small>{props.note}</small>
    </article>
  );
}
function Empty(props: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>◇</span>
      <strong>{props.title}</strong>
      <p>{props.text}</p>
      {props.action}
    </div>
  );
}
/**
 * 一排互斥的切換鈕。
 *
 * ── disabledReason：沒有資料的選項要按不下去，而且要說得出為什麼 ──────
 *
 * 使用者 2026-09-10 實測回報：
 *   「在流量核對工作分頁中，如果資料因為只有上下午各 3 小時的數值，
 *     而沒有『全日尖峰』和『全日時段』的話，當使用者忘記而點選功能鍵時，
 *     **應該要不產生任何反應**，目前程式是點一下就強制跳回 AM peak」
 *
 * 使用者選定的做法是(1)＋(2)一起做（第三種不做）：
 *   (1) 按鈕停用（按下去不產生任何反應）
 *   (2) 講出原因（滑鼠移上去看得到，畫面上也有一行）
 *
 * ⚠️ 「點了跳回 AM peak」比「沒反應」更糟：畫面**動了**，使用者會以為
 *   自己按錯了別的東西，或以為系統壞了。停用至少是誠實的。
 *
 * ⚠️ 停用的按鈕一定要保留 title 與畫面上的說明。只停用不說明，
 *   使用者會一直去點它，然後回報「這個按鈕壞了」。
 */
/*
 * ── 匯入預覽的兩個旗標，**唯一的定義在這裡** ────────────────────
 *
 * ⚠️ 2026-09-10 之前這兩件事被寫成三份：表格逐列一份、上方計數一份、
 *   捲動目標又一份。三份會漂移，而漂移的症狀正是使用者回報的
 *   「沒有異常卻跳到異常確認表」與「上面說有 N 個要確認、表格裡卻不是那些列」。
 *   任何地方要判斷這兩件事，一律呼叫這兩支，不要就地再寫一次。
 *
 * hasIssue   ＝ 這一列**會影響寫入結果**：版面認不得，或這個檔根本不會被寫入。
 *               「跳到第一筆有異常的資料」找的就是它。
 * needsCheck ＝ hasIssue，再加上「仍會正常寫入、但要人看一眼」的情形：
 *               站號沒判定出來、解析時留下警告。表格的黃底用它。
 *
 * ⚠️ 兩者**不可以**寫成同一個條件。相等的話，「有沒有異常」就退化成
 *   「有沒有要看一眼」，這一輪修掉的缺陷會原樣復發。
 */
function importRowHasIssue(row: ImportPreview): boolean {
  return row.layout === "unknown" || row.role !== "原始交通量";
}
function importRowNeedsCheck(row: ImportPreview): boolean {
  /*
   * ⚠️ **不可以**把 `row.warnings.length > 0` 算進來。
   *   我一度加了它，實測之後發現 warnings 裝的多半是**說明**而不是異常：
   *     「已辨識 4 個入口區塊、48 個左直右×車種欄位。」
   *     「套用格式範本：一般語意轉向表。」
   *     「未找到時相圖；不影響尖峰轉向流量。」
   *   把它們算進來的後果是**每一個檔案都「需要確認」**，
   *   於是「沒有異常就收合」這件事永遠不會發生，
   *   而且畫面會對一批完全正常的資料說「6 個需要您確認」——
   *   狼來了喊久了，真正要看的那一次就沒有人看了。
   */
  return importRowHasIssue(row) || row.stationSource === "none";
}

function Segmented<T extends string>(props: {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
  /** 回傳原因字串代表這個選項不能選；回 null 代表可以選。 */
  disabledReason?: (value: T) => string | null;
}) {
  const reasons = props.options
    .map(function (option): [T, string | null] {
      return [option[0], props.disabledReason?.(option[0]) ?? null];
    })
    .filter(function (entry): entry is [T, string] {
      return Boolean(entry[1]);
    });
  return (
    <div className="segmented-wrap">
      <div className="segmented">
        {props.options.map(function (option) {
          const reason = props.disabledReason?.(option[0]) ?? null;
          return (
            <button
              key={option[0]}
              className={option[0] === props.value ? "active" : ""}
              disabled={Boolean(reason)}
              title={reason ?? undefined}
              aria-disabled={reason ? true : undefined}
              onClick={function () {
                if (reason) return;
                props.onChange(option[0]);
              }}
            >
              {option[1]}
            </button>
          );
        })}
      </div>
      {reasons.length > 0 && (
        <p className="segmented-note">
          {reasons
            .map(function (entry) {
              const label =
                props.options.find(function (option) {
                  return option[0] === entry[0];
                })?.[1] ?? entry[0];
              return `${label}：${entry[1]}`;
            })
            .join("；")}
        </p>
      )}
    </div>
  );
}

function configuredImportPreview(
  item: ImportPreview,
  pce: PceMatrix,
  vehicleMappings: VehicleMappingTable,
) {
  if (!item.intervalRows?.length || !item.intervalMinutes) return item;
  const weights = item.columns.map(function (column) {
    const target = vehicleMappings[column.vehicle] || column.vehicle;
    return pceFactor(pce, target, column.movement || "through");
  });
  return {
    ...item,
    /*
     * 換過當量係數之後要重挑尖峰（挑的依據是 PCU）。這裡和匯入預覽走
     * 同一支 peakWindowsFor，兩邊不可能挑到不同的視窗，也不會有一邊
     * 忘了補新時段的問題。
     */
    peakWindows: peakWindowsFor(
      item.intervalRows,
      item.intervalMinutes,
      weights,
      item.survey?.minutes ?? item.intervalRows.length * item.intervalMinutes,
      /*
       * ⚠️ 換當量係數之後重挑尖峰時，一定要沿用使用者對「橫跨中午那一小時」
       *   的決定。這裡若省略，他在預覽畫面調一下係數，那個決定就會靜靜地
       *   失效，而畫面上沒有任何提示。
       */
      item.noonSide,
    ),
    pceUsed: structuredClone(pce),
  };
}

function destinationVehicleTotal(
  record: TrafficRecord,
  peak: ScopeKey,
  destinationIndex: number,
  vehicle: VehicleKey = "all",
) {
  const destination = record.approaches[destinationIndex];
  if (!destination || !record.routes?.length) return null;
  const ids = vehicle === "all" ? recordVehicleIds(record) : [vehicle];
  return record.routes
    .filter(function (route) {
      return route.toApproachId === destination.id;
    })
    .reduce(function (sum, route) {
      return (
        sum +
        ids.reduce(function (vehicleSum, id) {
          return vehicleSum + Number(route.volumes[peak].vehicle[id] || 0);
        }, 0)
      );
    }, 0);
}

/*
 * ── 單一車種在某一支線的駛入／駛出 PCU ──────────────────────────
 *
 * ⚠️ 這**不是**另寫一套換算。用的是 syncRouteTotals 建立 route PCU 時
 *   完全同一支 pceFactor 與同一組係數（record.pceUsed），只是把加總範圍
 *   縮到一個車種。逐條流向齊全時，各車種算出來的加總就等於已存的總 PCU。
 *
 * ⚠️ 沒有逐條流向的舊紀錄回 null（畫面寫「－」），**不可以回 0**：
 *   系統只存「每個轉向的總 PCU」與「每個車種的車輛數」，
 *   沒有流向就對不起車種與轉向，任何數字都是猜的。
 */
function branchVehiclePcu(
  record: TrafficRecord,
  peak: ScopeKey,
  index: number,
  vehicle: VehicleKey,
  direction: "inbound" | "outbound",
) {
  const approach = record.approaches[index];
  if (!approach || !record.routes?.length) return null;
  const pce = record.pceUsed || DEFAULT_PCE;
  return roundedPcu(
    record.routes
      .filter(function (route) {
        return direction === "inbound"
          ? route.toApproachId === approach.id
          : route.fromApproachId === approach.id;
      })
      .reduce(function (sum, route) {
        const count = Number(route.volumes[peak].vehicle[vehicle] || 0);
        return sum + count * pceFactor(pce, vehicle, route.movement);
      }, 0),
  );
}

/*
 * surveyDestinationTotals / surveySourceTotals（v2.1.29 以前）已經移除。
 *
 * 那兩支是「全日欄位」專用的第二套加總：各自從 route.survey 逐筆乘上當量。
 * 現在全日時段和三個尖峰一樣，走 destinationFlowTotal / sourceFlowTotal
 * 讀 route.volumes.FULL——而 volumes.FULL 正是 syncRouteTotals 從同一份
 * route.survey 現算出來的。少一套加總，就少一個會和畫面分岔的地方。
 *
 * 差別只有小數點的取法：舊版是「逐筆不取整數→加總→取到一位小數」，
 * 現在是「逐筆取到一位小數→加總→再取一位小數」，與三個尖峰一致。
 * 實測使用者的三份 24 小時調查檔，兩種取法的全日量差距見交付說明。
 */

function sourceVehicleTotal(
  record: TrafficRecord,
  peak: ScopeKey,
  sourceIndex: number,
  vehicle: VehicleKey = "all",
) {
  const source = record.approaches[sourceIndex];
  if (!source) return null;
  const ids = vehicle === "all" ? recordVehicleIds(record) : [vehicle];
  if (record.routes?.length)
    return record.routes
      .filter(function (route) {
        return route.fromApproachId === source.id;
      })
      .reduce(function (sum, route) {
        return (
          sum +
          ids.reduce(function (vehicleSum, id) {
            return vehicleSum + Number(route.volumes[peak].vehicle[id] || 0);
          }, 0)
        );
      }, 0);
  /*
   * 沒有逐條流向的舊紀錄：整支的原始輛數還在，但**拆不到車種**。
   * 篩了車種就只能誠實回 null（畫面寫「－」）。
   */
  if (vehicle !== "all") return null;
  return source.movements[peak].rawVehicleTotal ?? null;
}

/**
 * 讀檔／還原備份時再正規化一次路口名稱。
 * normalizeIntersectionName 會把所有括號拿掉，而匯入時會在名稱後面補上
 * 「（平日）」「（假日）」來區分同一路口的兩種資料別；直接再跑一次的話，
 * 重新整理後兩筆的名稱會變成「…平日」「…假日」，被當成兩個不同路口，
 * 資料別下拉、幾何同步與歷季比較都會跟著錯。這裡把括號內容原樣保留。
 */
function renormalizeStoredName(input: string) {
  const name = String(input ?? "");
  const matched = /^(.*)（([^（）]*)）$/.exec(name);
  if (matched)
    return normalizeIntersectionName(matched[1]) + "（" + matched[2] + "）";
  return normalizeIntersectionName(name);
}
/** 使用者自己打過的名稱不再正規化，其餘沿用舊行為。 */
function storedNameOf(record: TrafficRecord) {
  return record.nameEdited ? record.name : renormalizeStoredName(record.name);
}

export type ScopeFlow = { pcu: number | null; vehicles: number | null };

/**
 * 一支支線在某個統計範圍的駛入／駛出量——**全系統只有這一支**。
 *
 * 為什麼要有這一支：舊版把四個數字寫成 inboundAmPcu、inboundPmPcu、
 * inboundFullDayPcu… 這種平鋪欄位，每加一個時段就要在畫面、Excel、
 * 結論草稿、報告草稿四個地方各補一次，漏掉哪一個都不會有人發現。
 *
 * 算不出來時回 null（畫面顯示「－」），**不是 0**：
 * ・全日時段：調查不足 24 小時
 * ・全日尖峰：沒有 24 小時資料，或這一筆是舊版匯入的（需重新匯入）
 * 0 會被當成「這裡真的沒有車」，還會被平均與最大最小算進去。
 */
function scopeFlowFor(
  record: TrafficRecord,
  index: number,
  scope: ScopeKey,
  /*
   * 主工具列的「車種」。預設 all＝升級前的行為（全車種），
   * 所以不傳的呼叫端一個數字都不會變。
   */
  vehicle: VehicleKey = "all",
): { inbound: ScopeFlow; outbound: ScopeFlow } {
  const blank = { pcu: null, vehicles: null };
  /*
   * ⚠️ 原本這裡還有一條 `scope === "FULL" && !coversFullDay(record.survey)`，
   *   2026-09-11 移除——那是「全日時段」時代留下來的門檻。
   *   現在 FULL 是「全調查時段」，只要這份調查有時數就有值；
   *   真的沒有時數（舊備份沒存 survey）由 fullDayUnavailableReason 說明。
   *
   *   DAY 那一條留著：全調查時段尖峰要挑得出一個**相接的 60 分鐘視窗**，
   *   挑不到（格距組不成整小時、或舊版匯入沒存逐時間格）就是真的沒有，
   *   這時候寫「－」是誠實的，寫 0 會被抄進報告。
   */
  if (scope === "DAY" && !hasDayPeak(record))
    return { inbound: { ...blank }, outbound: { ...blank } };
  return {
    inbound: {
      pcu:
        vehicle === "all"
          ? destinationFlowTotal(record, scope, index, "all")
          : branchVehiclePcu(record, scope, index, vehicle, "inbound"),
      vehicles: destinationVehicleTotal(record, scope, index, vehicle),
    },
    outbound: {
      pcu:
        vehicle === "all"
          ? sourceFlowTotal(record, scope, index)
          : branchVehiclePcu(record, scope, index, vehicle, "outbound"),
      vehicles: sourceVehicleTotal(record, scope, index, vehicle),
    },
  };
}

function inboundAnalysisRows(
  record: TrafficRecord,
  vehicle: VehicleKey = "all",
) {
  return record.approaches.map(function (approach, index) {
    const inbound = {} as Record<ScopeKey, ScopeFlow>;
    const outbound = {} as Record<ScopeKey, ScopeFlow>;
    SCOPE_KEYS.forEach(function (scope) {
      const flows = scopeFlowFor(record, index, scope, vehicle);
      inbound[scope] = flows.inbound;
      outbound[scope] = flows.outbound;
    });
    return { approach, inbound, outbound };
  });
}

/**
 * 把畫面用的 TrafficRecord 換成結論產生器要的資料。
 *
 * 這一步是刻意分開的：lib/conclusion.ts 只負責組字，數字全部在這裡取，
 * 而且取的是**畫面與 Excel 用的同一組函式**（inboundAnalysisRows、
 * recordTotal、recordVehicleTotal）。只要這裡不另外算，草稿寫的數字就
 * 不可能和成果表對不起來。
 */
/**
 * ══════════════════════════════════════════════════════════════════════
 *  把畫面的紀錄轉成結論草稿要的形狀
 * ══════════════════════════════════════════════════════════════════════
 *
 * `perScope`（2026-09-23 新增）：尖峰時段判定方式選「各方向各自認定自己的
 * 尖峰」時，**每一個時段各有一份重挑過的紀錄**（見 recordWithApproachPeaks）。
 *
 * ⚠️ 這件事以前被判定為「草稿做不到」，理由寫在 conclusion.ts 的註解裡：
 *   「一筆紀錄裝不下三份」。那個判斷是錯的——`peaks` 本來就是**按時段分開
 *   存**的，所以 `peaks.AM` 可以吃 AM 那一份重挑的紀錄、`peaks.PM` 吃 PM 那
 *   一份，互不干擾。裝不下的是「整筆紀錄」，不是 `peaks`。
 *
 * ⚠️ 不傳 `perScope`（預設）時，這一支走的路與改版前**完全相同**：
 *   同一份 `rows`、同一個 `record`，輸出逐字不變。
 *
 * ⚠️ FULL（全調查時段）**永遠不重挑**：它是整段涵蓋的累計量，不是某一個
 *   小時，「各方向各自認定」對它沒有意義（recordWithApproachPeaks 對 FULL
 *   直接回 null，這裡跟著不套）。
 */
function toConclusionRecords(
  records: TrafficRecord[],
  perScope?: (
    scope: ScopeKey,
    record: TrafficRecord,
  ) => {
    record: TrafficRecord;
    windows: Record<string, { start: number; end: number } | null>;
  } | null,
): ConclusionRecord[] {
  return records.map(function (record) {
    const rows = inboundAnalysisRows(record);
    const vehicleIds = recordVehicleIds(record);
    /*
     * 各支線的逐車種輛數（全調查時段），取自「車種組成分析」那張
     * 『全調查時段道路方向車種數量』用的同一支 surveyDirectionRows，
     * 兩邊的數字因此必然相同。沒有逐流向調查明細時給 null，不是 0。
     */
    const hasSurveyDetail = (record.routes || []).some(function (route) {
      return Boolean(route.survey);
    });
    const directionRows = hasSurveyDetail ? surveyDirectionRows(record) : [];
    const byArm = new Map<
      string,
      {
        outbound: { label: string; count: number }[];
        inbound: { label: string; count: number }[];
        twoWay: { label: string; count: number }[];
        display: "split" | "two-way";
      }
    >();
    for (const row of directionRows) {
      const code = row.approach.sourceCode || row.approach.id;
      const entry = byArm.get(row.approach.id) || {
        outbound: [],
        inbound: [],
        twoWay: [],
        /*
         * 這條支線在「車種組成分析」頁上目前選的呈現方式，直接沿用同一份
         * record.directionDisplay，使用者在那一頁改成雙向合計，草稿也會跟著改。
         */
        display: (record.directionDisplay?.[code] || "split") as
          | "split"
          | "two-way",
      };
      const list = vehicleIds.map(function (id) {
        return {
          label: vehicleLabel(record, id),
          count: Number(row.vehicle[id] || 0),
        };
      });
      if (row.relation === "駛出路口") entry.outbound = list;
      else if (row.relation === "駛入路口") entry.inbound = list;
      else entry.twoWay = list;
      byArm.set(row.approach.id, entry);
    }
    const surveyTotal = vehicleIds.reduce(function (sum, id) {
      return sum + recordVehicleTotal(record, "SURVEY", id);
    }, 0);
    /* 車種組成：整份調查有資料就用它，否則退回 AM 尖峰（與分析頁一致）。 */
    const scope: CompositionScope = surveyTotal > 0 ? "SURVEY" : "AM";
    /*
     * ⚠️ 這一支收的是**四個統計範圍**（AM／PM／DAY／FULL），不是兩個尖峰。
     *
     *   v2.1.80 以前它只認得 AM 與 PM：每一個欄位都寫成
     *   `peak === "AM" ? row.inbound.AM.x : row.inbound.PM.x` 這種三元判斷，
     *   於是傳 DAY 進來會**靜靜地拿到 PM 的數字**，而下面組出來的物件更是
     *   只有 `{ AM, PM }` 兩個鍵——結論草稿上那顆「全調查時段尖峰」勾選框
     *   因此永遠接在空的地方，勾了只會得到「這一筆沒有資料」，
     *   **連 24 小時的調查檔也一樣**（使用者 2026-09-21 回報）。
     *
     *   現在一律走 `row.inbound[scope]`／`row.outbound[scope]`：
     *   inboundAnalysisRows 本來就把 SCOPE_KEYS 四個都算好了。
     *
     * ⚠️ FULL 沒有「視窗」可寫（它不是某一個小時），所以 window 走
     *   scopeWindowLabel()——那一支會寫出實際涵蓋時數。
     */
    const peakData = function (peak: ScopeKey) {
      /*
       * 這一個時段要用哪一份紀錄算。
       *
       * ⚠️ `perScope` 沒傳、或這一個時段重挑不出來（FULL、或這一筆沒有
       *   15 分鐘細格）時一律回 null，底下整段就走原紀錄——與改版前相同。
       */
      const rewritten = perScope ? perScope(peak, record) : null;
      const source = rewritten ? rewritten.record : record;
      const scopeRows = rewritten ? inboundAnalysisRows(source) : rows;
      const window = peak === "FULL" ? null : record.peaks?.[peak as PeakKey];
      const totalVehicles = scopeRows.reduce(function (sum, row) {
        const value = row.inbound[peak].vehicles;
        return value === null ? sum : sum + value;
      }, 0);
      const hasVehicles = scopeRows.some(function (row) {
        return row.inbound[peak].vehicles !== null;
      });
      return {
        /*
         * ⚠️ 各方向各自認定時，**路口層級沒有一個共同的視窗**——
         *   這裡的合計是把各支線各自最忙的那一小時加起來得到的，
         *   不是任何一個時刻的量。寫一個時段在抬頭會讓人以為它是。
         *   所以留空，由各支線各自寫自己的視窗，並由草稿印出不可相加的警告。
         */
        window: rewritten
          ? ""
          : window
            ? window.start + "–" + window.end
            : peak === "FULL"
              ? scopeWindowLabel(record, "FULL")
              : "",
        totalPcu: recordTotal(source, peak),
        totalVehicles: hasVehicles ? totalVehicles : null,
        branches: scopeRows.map(function (row) {
          const composition = byArm.get(row.approach.id);
          return {
            /*
             * 代碼是篩選用的識別字；name 只用來顯示（使用者可以改名）。
             *
             * ⚠️ 用 sourceCode（原始檔裡的 A／B／C…），**不是 approach.id**。
             *   id 實測長成「R1-A」「R2-A」——它帶著路口自己的前綴，
             *   每個路口都不一樣，拿它當 key 的話清單仍然是聯集（實測 15 項），
             *   等於沒修。sourceCode 才是「這是第幾條支線」那個共通的代碼。
             *   舊資料沒有 sourceCode 時退回 id，至少不會變成空字串。
             */
            code: row.approach.sourceCode || row.approach.id,
            name: row.approach.name,
            outboundByVehicleSafe: composition ? composition.outbound : null,
            inflowByVehicleSafe: composition ? composition.inbound : null,
            twoWayByVehicleSafe: composition ? composition.twoWay : null,
            directionDisplay: composition ? composition.display : "split",
            /*
             * 這條支線自己最忙的那一小時。
             *
             * ⚠️ `windows` 的鍵是 **sourceCode**（A／B／C…），不是 approach.id
             *   ——recordWithApproachPeaks 就是這樣建的。用錯鍵的話每一支都
             *   查不到，草稿會一律印「算不出來」而測試照樣綠。
             * ⚠️ 沒套重挑時是 `undefined`（草稿完全不寫這一段）；
             *   套了但這一支算不出來是 `null`（草稿明講算不出來）。
             *   兩者不可以混成同一個值。
             */
            peakWindow: rewritten
              ? (function () {
                  const own =
                    rewritten.windows[row.approach.sourceCode || row.approach.id];
                  return own
                    ? formatMinutes(own.start) + "–" + formatMinutes(own.end)
                    : null;
                })()
              : undefined,
            inflowPcu: row.inbound[peak].pcu,
            outflowPcu: row.outbound[peak].pcu,
            inflowVehicles: row.inbound[peak].vehicles,
            outflowVehicles: row.outbound[peak].vehicles,
            inflowFullDayVehicles: row.inbound.FULL.vehicles,
            outflowFullDayVehicles: row.outbound.FULL.vehicles,
          };
        }),
      };
    };
    return {
      id: record.id,
      intersectionKey: recordIntersectionKey(record),
      station: record.station,
      name: record.name,
      quarter: record.quarter,
      surveyType: record.surveyType || "待設定",
      routeless: !record.routes?.length,
      /*
       * ⚠️ 這一筆的調查涵蓋要帶給結論草稿，它才知道「全調查時段」該標
       *   「／調查日」還是「／調查時段」（滿 24 小時是前者）。
       *   Excel 欄名與報告文字草稿本來就走 scopeUnit()／coverageOf()，
       *   2026-09-23 的反向對帳抓到只有結論草稿沒跟上。
       */
      surveyCoverage: coverageOf(record),
      /* 只用來數「涵蓋幾個調查日」，與儀表板那張卡同一個欄位（r.date）。 */
      surveyDate: record.date,
      compositionScope: scope === "SURVEY" ? "全調查時段" : "上午尖峰小時",
      compositionUnit: compositionScopeUnit(record, scope),
      composition: vehicleIds.map(function (id) {
        return {
          label: vehicleLabel(record, id),
          count: recordVehicleTotal(record, scope, id),
        };
      }),
      /*
       * 逐支線的車種輛數，給結論草稿的**支線篩選**用。
       *
       * ⚠️ 只取**駛入**方向：各支線的駛入合計＝路口總量，可以相加；
       *   駛出合計也等於路口總量，兩者相加是兩倍。
       * ⚠️ 只要有一條支線沒有「駛入」那一份（整筆以雙向合計呈現），
       *   就整筆回 null——寧可讓草稿照實說「這一筆篩不了」，
       *   也不要把路口合計當成支線的量交出去。那正是 v2.1.80 的毛病。
       */
      compositionByBranch: (function () {
        if (!directionRows.length) return null;
        const list = rows.map(function (row) {
          const entry = byArm.get(row.approach.id);
          return {
            code: row.approach.sourceCode || row.approach.id,
            name: row.approach.name,
            items: entry?.inbound?.length ? entry.inbound : null,
          };
        });
        if (list.some((item) => item.items === null)) return null;
        return list as {
          code: string;
          name: string;
          items: { label: string; count: number }[];
        }[];
      })(),
      /*
       * ⚠️ **四個都要建**。少建一個，畫面上對應的那顆勾選框就接在空的地方，
       *   而且不會有任何錯誤——只會安靜地寫出「這一筆沒有資料」。
       *   v2.1.80 以前這裡是 `{ AM, PM }`，DAY 與 FULL 兩顆因此永遠是空的。
       */
      peaks: {
        AM: peakData("AM"),
        PM: peakData("PM"),
        DAY: peakData("DAY"),
        FULL: peakData("FULL"),
      },
    };
  });
}

/**
 * 「各路口分項結果」最多逐筆敘述幾筆。
 * 每一筆會寫成一個標題加兩行（含全部支線與車種），4 季 × 10 路口 × 平假日
 * 就是 240 行，整段貼進報告反而沒人看得完；超過的部分在段末說明還有幾筆。
 */
const SITE_SUMMARY_LIMIT = 30;

function AuditWorkbench(props: {
  /** 側欄點到的那一塊（見 NAV 的 sections）；用來在畫面上「點名」。 */
  focusedBlock: string;
  record: TrafficRecord | null;
  peak: ScopeKey;
  setPeak: (peak: ScopeKey) => void;
  /*
   * 脫離提示與「不適用」說明由上層組好傳進來——這個元件不知道
   * chartOverrides，也不該知道；它只負責把那一塊放在工具列底下。
   */
  detachNote?: ReactNode;
  /** 這一頁目前的「路口流量視角」（主工具列或它自己脫離後的值）。 */
  flowView: FlowView;
  quarter: string;
  /* 季度要顯示成民國年還是西元年。只換文字，quarter 本身仍是儲存值。 */
  showQuarter: (value: string) => string;
  quarterRecords: TrafficRecord[];
  lockQuarter: () => void;
  unlockQuarter: () => void;
  setReview: (
    status: "待核對" | "已核對" | "已確認" | "需修正",
    note: string,
  ) => void;
  setSurveyType: (value: string) => void;
  /** 指定**某一個路口**的資料別（見「本季各路口的資料別」那一張表）。 */
  setSurveyTypeFor: (recordId: string, value: string) => void;
  /* 這一頁自己要能換路口，不必先跑去別的分頁挑好再回來。 */
  intersections: { key: string; label: string }[];
  selectedIntersection: string;
  setSelectedIntersection: (value: string) => void;
  /* 這一頁自己也要能換季度（原本只能換路口，季度要跑去別頁改）。 */
  setQuarter: (value: string) => void;
  quarters: string[];
  quarterLabel: (value: string) => string;
  surveyTypes: string[];
  selectedSurveyType: string;
  setSelectedSurveyType: (value: string) => void;
  /* 整個計畫還掛著「待設定」的筆數，以及一次補完的入口。 */
  pendingSurveyTypeCount: number;
  /** 那幾筆是哪些（季度＋站號＋路口名），讓使用者看得到才敢按。 */
  pendingSurveyTypeLabels: string[];
  assignPendingSurveyType: (value: string) => void;
}) {
  const record = props.record;
  /*
   * 核對視角：依「來源」分組＝駛出路口，依「目的」分組＝駛入路口。
   * 兩者是同一批 OD 流向、只是分組方式不同，所以整個路口的總量應該相等；
   * 不相等就代表有流向沒有指定目的支線，那個差額正好是資料的問題所在。
   */
  /*
   * ⚠️ 這一個要**跟著主工具列的「路口流量視角」走**。
   *   升級前它是一份獨立狀態，主工具列切成「只顯示駛入」時這一頁不動，
   *   而且沒有任何一個字說明（實測，probe-filter-matrix）。
   *   「駛入＋駛出並列」這一頁做不到（它是一張逐格核對表，
   *   兩種分組方式的列本來就不一樣），那時維持這一頁自己的選擇。
   */
  const [ownFlowView, setOwnFlowView] = useState<"outbound" | "inbound">(
    "outbound",
  );
  const flowView: "outbound" | "inbound" =
    props.flowView === "inbound" || props.flowView === "outbound"
      ? props.flowView
      : ownFlowView;
  const setFlowView = setOwnFlowView;
  /*
   * 「原始儲存格與換算來源」那張表的篩選（支線／車種／轉向）。
   *
   * ⚠️ 只影響**這張表怎麼顯示**，完全不碰資料，也不碰
   *   「下載核對 Excel」——那份一律輸出全部格子。
   *   篩選一旦影響到匯出，使用者就會在不知情的狀況下交出一份殘缺的核對表。
   *
   * ⚠️ 三個 state 必須宣告在**任何 early return 之前**（下面有一個
   *   `if (!record) return <Empty…>`）。放在後面會違反 React 的 hooks 規則：
   *   沒有資料時少呼叫三個 useState，切換到有資料的路口時 hooks 順序就錯位了。
   */
  /** 這一塊是不是側欄剛剛點名的那一塊。 */
  const focusClass = (anchor: string, base: string) =>
    props.focusedBlock === anchor ? base + " is-focused" : base;
  const [traceApproach, setTraceApproach] = useState("");
  const [traceVehicle, setTraceVehicle] = useState("");
  const [traceMovement, setTraceMovement] = useState("");
  const lockedCount = props.quarterRecords.filter(function (item) {
    return Boolean(item.resultLock);
  }).length;
  const lockStates = props.quarterRecords.map(lockState);
  const conflicts = lockStates.flatMap((state) => state.conflicts);
  /*
   * 「升版但沒動計算」不是衝突，只是說明——用灰字，別跟真的衝突長得一樣紅。
   * 舊版兩者都報成紅色「鎖定衝突」，於是升過一次版之後所有鎖定都永遠亮紅字，
   * 真正該注意的「鎖定後資料被動過」就被淹掉了。
   */
  const versionNotes = lockStates.map((state) => state.note).filter(Boolean);
  if (!record)
    return (
      <Empty title="尚無可核對資料" text="請先選擇有匯入資料的計畫與季度。" />
    );
  /** 目前這一筆的鎖定狀況，下面的審核欄位與鎖定狀態卡都要用。 */
  const recordLock = record.resultLock;
  const recordState = lockState(record);
  const recordConflict = recordState.conflicts.join("；");
  const approachById = new Map(
    record.approaches.map(function (approach) {
      return [approach.id, approach] as const;
    }),
  );
  /*
   * 這一個時段的逐格追溯資料，以及篩選之後要顯示的那些。
   *
   * ⚠️ `cell.peak === props.peak` 這一道是原本就有的：這張表一次只講
   *   目前選到的那個時段，否則四個時段的格子會混在一起，
   *   使用者會拿 AM 的格子去對 PM 的數字。
   */
  const traceCells = (record.sourceTrace?.cells || []).filter(function (cell) {
    return cell.peak === props.peak;
  });
  const traceOptionsOf = (pick: (cell: (typeof traceCells)[number]) => string) =>
    Array.from(
      new Set(traceCells.map(pick).filter(Boolean)),
    ).sort(function (a, b) {
      return a.localeCompare(b, "zh-TW");
    });
  const traceApproachOptions = traceOptionsOf(function (cell) {
    return cell.approach || "";
  });
  const traceVehicleOptions = traceOptionsOf(function (cell) {
    return cell.vehicleLabel || "";
  });
  const traceMovementOptions = traceOptionsOf(function (cell) {
    return MOVE_LABELS[cell.movement || "through"] || "";
  });
  const traceFiltered = traceCells.filter(function (cell) {
    if (traceApproach && cell.approach !== traceApproach) return false;
    if (traceVehicle && cell.vehicleLabel !== traceVehicle) return false;
    if (
      traceMovement &&
      MOVE_LABELS[cell.movement || "through"] !== traceMovement
    )
      return false;
    return true;
  });
  const routes = record.routes || [];
  const routeTotal = routes.reduce(function (sum, route) {
    return sum + Number(route.volumes[props.peak].pcu || 0);
  }, 0);
  const peakTotal = recordTotal(record, props.peak);
  /* 相減之後要給人看的數字一律走 round1()——理由寫在 lib/traffic.ts 的註解裡。 */
  const difference = round1(peakTotal - routeTotal);
  const pceMatrix = record.pceUsed || DEFAULT_PCE;
  /*
   * 這一頁的單位一律問同一支 `scopeUnit()`，而且**一定要帶這一筆的涵蓋**。
   *
   * ⚠️ 2026-09-25 第六輪：這一頁原本十幾處都寫 `scopeUnit(props.peak)`，
   *   靠的是那支函式的預設涵蓋（`"unknown"`）。選「全調查時段」時，
   *   同一批資料在轉向圖抬頭寫「PCU/調查日」（那裡有帶涵蓋），
   *   在這一頁寫「PCU/調查時段」——**同一個數字兩種單位**，
   *   而核對工作台正是使用者用來追「數字對不對」的那一頁。
   *   算一次、存成變數，就沒有下一次只改到其中幾處的機會。
   */
  const auditCoverage = coverageOf(record);
  const auditPcuUnit = scopeUnit(props.peak, "pcu", auditCoverage);
  const auditVehUnit = scopeUnit(props.peak, "vehicle", auditCoverage);
  const downloadAuditWorkbook = function () {
    const workbook = XLSX.utils.book_new();
    const routeRows = routes.map(function (route) {
      const origin = approachById.get(route.fromApproachId);
      const destination = approachById.get(route.toApproachId);
      const row: Record<string, string | number> = {
        時段: SCOPE_LABELS[props.peak],
        起點: origin?.name || route.fromApproachId,
        終點: destination?.name || route.toApproachId,
        轉向: MOVE_LABELS[route.movement],
        流量: route.volumes[props.peak].pcu,
        流量單位: auditPcuUnit,
      };
      recordVehicleIds(record).forEach(function (vehicleKey) {
        row[
          vehicleLabel(record, vehicleKey) +
            "（" +
            auditVehUnit +
            "）"
        ] = Number(
          route.volumes[props.peak].vehicle[vehicleKey] || 0,
        );
      });
      return row;
    });
    const traceRows = (record.sourceTrace?.cells || [])
      .filter(function (cell) {
        return cell.peak === props.peak;
      })
      .map(function (cell) {
        return {
          工作表: cell.sheet,
          儲存格: cell.cell,
          時段: cell.time,
          來源: cell.approach,
          目的: cell.destination || "－",
          轉向: cell.movement ? MOVE_LABELS[cell.movement] : "－",
          /*
           * ⚠️ 匯出也要兩欄：核對的人拿這份 Excel 對回調查表，
           *   只有歸類後的類型是對不回去的（N-5）。
           */
          原始車種: cell.sourceVehicleLabel || cell.vehicleLabel,
          計入類型: cell.vehicleLabel,
          原始車輛數: cell.rawCount,
          車輛單位: "輛",
          當量: cell.factor,
          換算PCU: cell.pcu,
        };
      });
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(routeRows),
      "OD核對",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(traceRows),
      "原始儲存格追溯",
    );
    XLSX.writeFile(
      workbook,
      record.station +
        "_" +
        record.quarter +
        "_" +
        props.peak +
        "_流量核對.xlsx",
      { bookType: "xlsx" },
    );
  };
  /*
   * ⚠️ .audit-stack 這一層是為了給整頁一個**統一的區塊間距**，不是包好看的。
   *
   * 使用者 2026-09-11：「欄位和欄位之間 黏太近，例如"原始儲存格與換算來源"
   * 和"本季成果尚未鎖定" 這兩個欄位黏很近」。
   *
   * 原因是這一頁的區塊間距**各寫各的**：.audit-kpis 與 .lock-banner 自己帶
   * margin-bottom:16px，.audit-panel 什麼都沒帶——於是「有帶的」後面看起來
   * 正常，「沒帶的」後面就黏在一起。逐一補 margin 只會讓下一塊再忘一次。
   *
   * 改成由父層用一個 gap 決定所有間距，子層的 margin 一併拿掉；
   * 以後新增區塊不必記得加 margin，間距自動一致。
   */
  return (
    <div className="audit-stack">
      <section className="page-head audit-head">
        <div>
          <span className="eyebrow">FLOW AUDIT</span>
          <h1>流量核對工作台</h1>
          <p>
            逐筆展開尖峰總量的 OD 來源、車種數與 PCU
            換算式，不改變既有計算結果。
          </p>
        </div>
      </section>
      {/*
       * ── 時段切換列：獨立成一列，黏在畫面上緣 ──────────────────
       *
       * 使用者 2026-09-11：「在下面看資訊時，如果要切換 AM/PM peak 或其他時，
       * 還得往上滑才能切換的到」。
       *
       * ⚠️ 它原本是 .page-head 的子元素，那樣 `position: sticky` **沒有用**：
       *   sticky 只能在**自己父層的範圍內**移動，而 .page-head 只有一百多 px 高，
       *   捲過標題之後它就跟著標題一起離開畫面了。
       *   （我第一版就是這樣寫的，實測量到它停在 -1131px——等於完全沒黏住。）
       *   所以這裡把它拉出來成為**與標題並列**的一層，父層是整頁的 .content，
       *   它才有整頁的高度可以黏。
       *
       * ⚠️ 是「把原本那一列釘住」，不是在下面再放一份。再放一份會變成
       *   同一件事有兩顆按鈕，遲早出現「上面選 AM、下面顯示 PM」。
       */}
      {props.detachNote}
      <div className="audit-sticky-bar">
        <div className="audit-actions">
          <Segmented
            value={props.peak}
            options={SCOPE_KEYS.map(function (key): [ScopeKey, string] {
              return [key, SCOPE_SHORT_LABELS[key]];
            })}
            onChange={props.setPeak}
            /*
             * 這一季所有路口都算不出來的時段才停用。
             *
             * ⚠️ 判斷用「這一季的每一筆」而不是「目前選到的那一筆」：
             *   這一頁是整季逐筆核對，只要還有任何一個路口算得出來，
             *   停用就會讓那個路口的數字看不到。
             *
             * ⚠️ 也不可以用「有沒有滿 24 小時」判斷——v2.1.64 起
             *   4 小時的調查照樣算得出全調查時段尖峰。唯一的依據是
             *   hasScopeValue（＝有沒有挑到視窗）。
             */
            disabledReason={function (key) {
              if (!props.quarterRecords.length) return null;
              const usable = props.quarterRecords.filter(function (record) {
                return hasScopeValue(record, key);
              });
              if (usable.length) return null;
              return "本季的調查資料缺少逐時間格資料（舊版匯入，或格距組不成整小時），算不出這個時段";
            }}
          />
          <button onClick={downloadAuditWorkbook}>下載核對 Excel</button>
          {/*
           * ⚠️ data-testid 是刻意加的。守門測試原本用
           *   `button:has-text("鎖定 ")` 找這一顆——而 Playwright 的
           *   has-text 會把需求字串的前後空白**修掉**再做子字串比對，
           *   所以側欄新增的子項目「本季鎖定狀況」也命中了，而且排在前面。
           *   結果 `.first()` 點到的是側欄那一顆，畫面跳了一下、什麼也沒鎖，
           *   測試紅字寫著「全部『已確認』後鎖定成功 — 已鎖 0 筆」，
           *   看起來像鎖定功能整個壞掉。
           *   錨點要綁身分，不要綁畫面上的字。
           */}
          {lockedCount === props.quarterRecords.length && lockedCount > 0 ? (
            <button
              className="danger-outline"
              data-testid="unlock-quarter"
              onClick={props.unlockQuarter}
            >
              解除 {props.showQuarter(props.quarter)} 鎖定
            </button>
          ) : (
            <button
              className="primary"
              data-testid="lock-quarter"
              onClick={props.lockQuarter}
            >
              鎖定 {props.showQuarter(props.quarter)} 成果
            </button>
          )}
        </div>
      </div>
      {/*
        資料別（平日／假日）。
        匯入時是從原始檔的日期字樣「115年5月4日（平日）」或工作表名稱判斷的；
        原始檔沒寫就會是「待設定」。以前沒有地方可以補，於是這筆資料在
        歷季趨勢、報表與結論草稿裡永遠都掛著「待設定」，也沒辦法跟同一路口的
        另一種資料別分開比較。這裡讓使用者直接指定。
      */}
      {/*
       * ⚠️ 這一塊是這一頁**最上面**的區塊，所以側欄的子項目第一個必須是它。
       *
       * 使用者 2026-09-12（附截圖）：「流量核對工作表，第一個表格不是
       * OD 流量表，而應該是最上方的資料別（平／假日）設定欄位，所以左側
       * 功能列那邊把 OD 流量表當作第一個應該是錯的。」
       *
       * 側欄子項目的順序要和畫面由上而下的順序一致——對不上的話，
       * 使用者會以為「第一個子項目之前沒有東西」，整塊設定就被略過了。
       */}
      <section
        className={focusClass("audit-daytype", "panel review-panel")}
        id="audit-daytype"
      >
        {/*
         * ⚠️ 常駐說明：這一塊是**設定**（把這一季的資料標成平日或假日），
         *   不是分析結果，所以主工具列的任何條件都不會改變它。
         *   使用者 2026-09-15 要求「不受某篩選條件影響要有提醒文字」——
         *   逐條件各跳一句會變成八句噪音，所以一句話講完。
         */}
        <p
          className="chart-inapplicable"
          data-testid="chart-inapplicable"
          data-inapplicable="all"
          data-inapplicable-always="1"
        >
          這一塊不受主工具列條件影響：它是<b>設定</b>（指定這一季的資料算平日
          還是假日），不是分析結果。改了這裡會影響其他每一塊的數字，反過來則不會。
        </p>
        <div>
          <b>資料別（平日／假日）</b>
          <p>
            {/*
             * ⚠️ 2026-09-11 改寫。使用者：「下方的說明有點難理解，
             *   可以簡要說明作用就好嗎？」並且給了他要的版本，這裡照用。
             *
             *   原本那兩段是「把所有可能的誤解一次講完」——判讀從哪來、
             *   為什麼下拉一定有假日、待設定是哪一層的概念、怎麼補……
             *   每一句都對，但合起來要讀三十秒才知道自己該做什麼。
             *   說明的用途是讓人**知道現在要做什麼**，不是把設計說明書貼上去。
             *   細節留在新手手冊。
             */}
            {record.surveyType && record.surveyType !== "待設定"
              ? "請依這一筆的調查日期歸類為平日或假日；系統已協助判讀，若有錯誤可在此修正。"
              : "系統從原始檔讀不出這一筆是平日還是假日，請直接在此指定；用原檔重新匯入同一季也可以補。"}
          </p>
        </div>
        <select
          value={record.surveyType || "待設定"}
          onChange={function (event) {
            props.setSurveyType(event.target.value);
          }}
        >
          {/*
            「待設定」代表「原始檔沒寫」，不是一個使用者會主動想選的值，
            所以只有在這一筆目前真的是待設定時才列出來。
          */}
          {Array.from(
            new Set(
              [record.surveyType || "待設定", "平日", "假日"].filter(Boolean),
            ),
          ).map(function (value) {
            return <option key={value}>{value}</option>;
          })}
        </select>
        {/*
          一筆一筆改要切換路口與季度，很容易漏掉——而漏掉的後果是歷季趨勢被
          拆成兩條線（選「平日」只看得到一部分的季度）。所以這裡直接給批次入口。
        */}
        {/*
         * ── 本季各路口的資料別：一次看完、逐筆指定 ─────────────────
         *
         * 使用者 2026-09-11：「如果這一季 A 和 B 路段是在平日做的，
         * C 和 D 路段是假日做的，這邊無法依照路段分別進行平日／假日的設定。」
         *
         * ⚠️ 資料別本來就是**每一筆自己一個值**（不是整季共用一個），
         *   所以資料結構完全不必動——缺的只是一個「一次看完」的畫面。
         *   舊版只能改「目前選到的那一筆」，四個路口要切換四次，
         *   而漏掉一筆的後果是歷季趨勢被拆成兩條線，而且不會有提示。
         *
         * ⚠️ 每一列走的是**同一條寫入路徑**（setSurveyTypeFor →
         *   saveRevision → setRecords），不是另外寫一份。
         *   兩份的話「改資料別前自動保存還原點」遲早只剩一邊有做。
         *
         * ⚠️ 鎖定的那幾筆要停用並說明原因，不可以讓人按了沒反應。
         */}
        {props.quarterRecords.length > 1 ? (
          <div className="survey-type-grid">
            <b>本季各路口的資料別（{props.quarterRecords.length} 個路口）</b>
            <small>
              各路口的調查日期可能不同；這裡可以逐一指定，不必一個一個切換過去。
            </small>
            <div className="survey-type-rows">
              {props.quarterRecords.map(function (item) {
                const locked = Boolean(item.resultLock);
                return (
                  <label
                    key={item.id}
                    className={
                      item.id === record.id
                        ? "survey-type-row current"
                        : "survey-type-row"
                    }
                  >
                    <span>
                      <b>{item.station}</b>
                      {item.name}
                    </span>
                    <select
                      value={item.surveyType || "待設定"}
                      disabled={locked}
                      title={
                        locked
                          ? "這一筆成果已鎖定，先到上方解除鎖定才能改資料別。"
                          : undefined
                      }
                      onChange={function (event) {
                        props.setSurveyTypeFor(item.id, event.target.value);
                      }}
                    >
                      {Array.from(
                        new Set(
                          [
                            item.surveyType || "待設定",
                            "平日",
                            "假日",
                          ].filter(Boolean),
                        ),
                      ).map(function (value) {
                        return <option key={value}>{value}</option>;
                      })}
                    </select>
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}
        {props.pendingSurveyTypeCount > 0 && (
          <div className="review-batch">
            <small>
              這個計畫還有 <b>{props.pendingSurveyTypeCount}</b>{" "}
              筆是「待設定」：{props.pendingSurveyTypeLabels.join("、")}
              。可以一次補完（只動待設定的，已經是平日／假日的不會被改到，
              每一筆都會先自動保存還原點）。
              <b>如果這幾筆不是同一種資料別，不要用批次</b>
              ——請用「路口」選擇器選到那一筆，再用
              「資料別（平日／假日）」下拉逐筆指定。
              判斷依據是原始調查檔本身（調查日期是星期幾、檔名或工作表有沒有寫）。
            </small>
            <div className="head-buttons">
              {["平日", "假日"].map(function (value) {
                return (
                  <button
                    key={value}
                    className="secondary"
                    onClick={function () {
                      props.assignPendingSurveyType(value);
                    }}
                  >
                    全部指定為{value}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>
      <section className="panel audit-picker">
        {/*
          * ★ 就地切季度。原本這一頁只能選路口，季度要跑去別頁改再回來
          *（使用者指出的同一類問題）。綁的是全站共用的 quarter。
          */}
        <label>
          資料季度
          <select
            value={props.quarter}
            onChange={function (event) {
              props.setQuarter(event.target.value);
            }}
          >
            {props.quarters.map(function (item) {
              return (
                <option key={item} value={item}>
                  {props.quarterLabel(item)}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          路口
          <select
            value={props.selectedIntersection}
            onChange={function (event) {
              props.setSelectedIntersection(event.target.value);
            }}
          >
            {props.intersections.map(function (entry) {
              return (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              );
            })}
          </select>
        </label>
        {props.surveyTypes.length > 1 && (
          <label>
            資料別
            <select
              value={props.selectedSurveyType}
              onChange={function (event) {
                props.setSelectedSurveyType(event.target.value);
              }}
            >
              {props.surveyTypes.map(function (type) {
                return (
                  <option key={type} value={type}>
                    {type}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        <span>
          本季共 {props.intersections.length} 個路口
          {props.surveyTypes.length > 1
            ? `；此路口有 ${props.surveyTypes.length} 種資料別`
            : ""}
        </span>
      </section>
      <section className="audit-kpis">
        <Kpi
          label={
            props.peak === "FULL" ? "系統全日總量" : "系統尖峰總量"
          }
          value={peakTotal.toLocaleString() + " " + auditPcuUnit}
          note={scopeWindowLabel(record, props.peak)}
        />
        <Kpi
          label="OD 逐筆加總"
          value={routeTotal.toLocaleString() + " " + auditPcuUnit}
          note={routes.length + " 筆 OD 流向"}
        />
        <Kpi
          label="核對差值"
          value={difference.toLocaleString() + " " + auditPcuUnit}
          note={Math.abs(difference) < 0.11 ? "兩者一致" : "請展開下表追查"}
          accent={Math.abs(difference) < 0.11 ? "" : "warn"}
        />
      </section>
      <section
        className={focusClass("audit-od", "panel audit-panel")}
        id="audit-od"
      >
        {/*
         * ⚠️ 常駐說明：這一塊是**核對換算過程**用的（原始車輛數 × 當量係數
         *   ＝ 交通流量），一定要把整個路口的每一條流向都攤開才核對得起來，
         *   所以主工具列的篩選條件對它不適用——篩掉一部分就核對不出總量。
         *   使用者 2026-09-15：「請確保每個圖表都要有各自的不適用說明」。
         */}
        <p
          className="chart-inapplicable"
          data-testid="chart-inapplicable"
          data-inapplicable="all"
          data-inapplicable-always="1"
        >
          這一塊不受主工具列條件影響：它是<b>核對換算過程</b>用的，
          必須把整個路口的每一條流向、每一個車種都攤開，才核對得出
          「原始車輛數 × 當量係數 ＝ 交通流量」。篩掉任何一部分就核對不起來了。
        </p>
        <div className="panel-head">
          <div>
            <span className="eyebrow">OD TRACE</span>
            <h2>
              {record.station} · {record.name}
            </h2>
            <p className="audit-unit-note">
              這一頁是核對<b>換算過程</b>用的：中間各車種欄位是原始的
              <b>調查車輛數（{auditVehUnit}）</b>
              ，乘上該車種在該轉向的當量係數（見「換算式」），
              才得到<b>交通流量（{auditPcuUnit}）</b>那一欄。
              車種欄若標成 PCU 就沒有東西可以核對了。
            </p>
          </div>
          <div className="audit-head-actions">
            <Segmented
              value={flowView}
              options={[
                ["outbound", "駛出路口（依來源分組）"],
                ["inbound", "駛入路口（依目的分組）"],
              ]}
              onChange={setFlowView}
            />
            <span className="status-dot">
              車種欄＝調查輛數；流量欄＝當量 {auditPcuUnit}
            </span>
          </div>
        </div>
        {/*
          兩種視角是同一批 OD 流向、只是分組方式不同，所以總量必須相等。
          不相等就是有流向沒有指定目的支線——這裡直接把差額寫出來，
          否則使用者只會看到「駛入怎麼比較少」卻不知道原因。
        */}
        {(function () {
          const outbound = routes.reduce(function (sum, route) {
            return sum + Number(route.volumes[props.peak]?.pcu || 0);
          }, 0);
          const inbound = routes
            .filter(function (route) {
              return record.approaches.some(function (arm) {
                return arm.id === route.toApproachId;
              });
            })
            .reduce(function (sum, route) {
              return sum + Number(route.volumes[props.peak]?.pcu || 0);
            }, 0);
          const gap = round1(outbound - inbound);
          return (
            <p className={gap ? "audit-flow-gap warn" : "audit-flow-gap"}>
              {gap
                ? `駛出合計 ${outbound.toLocaleString()} ${auditPcuUnit}、駛入合計 ${inbound.toLocaleString()} ${auditPcuUnit}，差 ${gap.toLocaleString()} ${auditPcuUnit}。這代表有流向沒有指定目的支線，請到「道路與流向管理」補齊；在補齊之前，「駛入」視角會少掉這個量。`
                : `駛出與駛入合計相同（${outbound.toLocaleString()} ${auditPcuUnit}）：每一筆流向都有指定目的支線，兩種視角可以互相核對。`}
            </p>
          );
        })()}
        {record.approaches.map(function (arm) {
          const armRoutes = routes.filter(function (route) {
            return flowView === "outbound"
              ? route.fromApproachId === arm.id
              : route.toApproachId === arm.id;
          });
          if (!armRoutes.length) return null;
          const armTotal = armRoutes.reduce(function (sum, route) {
            return sum + route.volumes[props.peak].pcu;
          }, 0);
          return (
            <details className="audit-origin" key={arm.id} open>
              <summary>
                <span>
                  {/*
                    * ⚠️ 名稱只有在**真的是使用者取的名字**時才多寫一次。
                    *
                    *   使用者 2026-09-14（附圖）：「紅框處重複寫了兩次路口A，
                    *     是否錯誤?」——他問得對。支線沒有自訂名稱時，名稱是
                    *   系統用代碼組出來的「路口A」，於是畫面變成
                    *   「駛出路口 A ・ 路口A」，同一件事講兩次。
                    *   （姊妹專案「全日交通量」同一天修過同樣的問題。）
                    */}
                  {flowView === "outbound" ? "駛出路口" : "駛入路口"}{" "}
                  {isNamedArm(arm.sourceCode, arm.name)
                    ? `${arm.sourceCode} ・ ${arm.name}`
                    : arm.sourceCode || arm.name}
                </span>
                <strong>
                  {armTotal.toLocaleString()} {auditPcuUnit}
                </strong>
              </summary>
              <div className="table-scroll">
                <table className="audit-table">
                  <thead>
                    {/*
                      這一張表是「核對換算過程」用的，所以左半邊一定要是
                      原始調查車輛數（{auditVehUnit}），
                      右半邊才是乘上當量後的 {auditPcuUnit}。
                      沒有分組標題時，很容易誤以為中間那幾欄也應該是 PCU。
                    */}
                    <tr className="audit-group-row">
                      <th colSpan={2} />
                      <th colSpan={recordVehicleIds(record).length}>
                        (1) 原始調查車輛數（輛/hr）
                      </th>
                      <th colSpan={2}>(2) 乘上車種轉向當量後的交通流量</th>
                    </tr>
                    <tr>
                      <th>OD 流向</th>
                      <th>轉向</th>
                      {recordVehicleIds(record).map(function (vehicleKey) {
                        return (
                          <th key={vehicleKey}>
                            {vehicleLabel(record, vehicleKey)}
                            <br />
                            {auditVehUnit}
                          </th>
                        );
                      })}
                      <th>換算式</th>
                      <th>
                        流量
                        <br />
                        {auditPcuUnit}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {armRoutes.map(function (route) {
                      /*
                       * OD 流向欄要寫這一筆流向自己的起訖，不能沿用分組用的
                       * 那一支支線——切到「駛入」視角時分組的是目的地，
                       * 沿用的話每一列的起點都會被寫成目的地。
                       */
                      const origin = approachById.get(route.fromApproachId);
                      const destination = approachById.get(route.toApproachId);
                      const counts = route.volumes[props.peak].vehicle;
                      const formula = recordVehicleIds(record)
                        .map(function (vehicleKey) {
                          return (
                            Number(counts[vehicleKey] || 0) +
                            "×" +
                            pceFactor(pceMatrix, vehicleKey, route.movement)
                          );
                        })
                        .join(" + ");
                      return (
                        <tr key={route.id}>
                          <td>
                            {origin?.sourceCode || origin?.name || "未設定"} →{" "}
                            {destination?.sourceCode ||
                              destination?.name ||
                              "未設定"}
                          </td>
                          <td>{MOVE_LABELS[route.movement]}</td>
                          {recordVehicleIds(record).map(function (vehicleKey) {
                            return (
                              <td key={vehicleKey}>
                                {Number(
                                  counts[vehicleKey] || 0,
                                ).toLocaleString()}
                              </td>
                            );
                          })}
                          <td className="audit-formula">{formula}</td>
                          <td>
                            <b>
                              {route.volumes[props.peak].pcu.toLocaleString()}
                            </b>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </section>
      {/*
       * ══════════════════════════════════════════════════════════
       *  原始儲存格與換算來源：**預設收合**，展開後可篩選
       * ══════════════════════════════════════════════════════════
       *
       * 使用者 2026-09-11：
       *   「當資料很多時，這張表會變得很長，希望可以支援篩選功能，
       *     以及平常保持收合，以避免要滑好久才能到頁面底部。
       *     但其實我有點質疑，使用者用得到這個功能嗎？」
       *
       * ⚠️ **不可以移除**，查過了：
       *   ・`sourceTrace.cells` 同時是「下載核對 Excel」那張表的資料來源
       *   ・`sourceTrace.intervals` 是「轉向進階分析」兩張尖峰形狀圖的
       *     唯一資料來源，也是「用目前的設定重算」要用的原始資料
       *   所以資料一定要留著。
       *
       * 至於畫面：它不是給人「平常看」的，是**被質疑時逐格指出來**用的
       *（業主問「這個 1,763 PCU 怎麼算的」，這張表是唯一答得出來的東西）。
       * 平常沒人看正是它該收起來的理由，不是該刪掉的理由。
       */}
      <details
        className={focusClass("audit-trace", "panel audit-panel audit-trace")}
        id="audit-trace"
      >
        <summary>
          <div>
            <span className="eyebrow">SOURCE CELLS</span>
            <h2>原始儲存格與換算來源</h2>
            <small>
              每一格原始儲存格怎麼換成 PCU 的逐格對照。平常不必看；
              被問到「這個數字怎麼來的」時展開，可以逐格指出來源。
            </small>
          </div>
          <span className="status-dot">
            {traceCells.length} 格{traceFiltered.length !== traceCells.length
              ? `（篩選後 ${traceFiltered.length}）`
              : ""}
          </span>
        </summary>
        {record.sourceTrace?.cells.length ? (
          <>
            {/*
             * 篩選：支線、車種、轉向三個下拉。
             * ⚠️ 選項一律由**目前這一批 cells 自己**長出來，不可以寫死——
             *   車種是使用者自己歸類出來的（可能有「聯結車」這種新車種），
             *   寫死的清單會漏掉他自己新增的那些，而且漏掉時不會有提示。
             */}
            <div className="trace-filters">
              <label>
                支線
                <select
                  value={traceApproach}
                  onChange={function (e) {
                    setTraceApproach(e.target.value);
                  }}
                >
                  <option value="">全部支線</option>
                  {traceApproachOptions.map(function (name) {
                    return (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label>
                車種
                <select
                  value={traceVehicle}
                  onChange={function (e) {
                    setTraceVehicle(e.target.value);
                  }}
                >
                  <option value="">全部車種</option>
                  {traceVehicleOptions.map(function (name) {
                    return (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label>
                轉向
                <select
                  value={traceMovement}
                  onChange={function (e) {
                    setTraceMovement(e.target.value);
                  }}
                >
                  <option value="">全部轉向</option>
                  {traceMovementOptions.map(function (name) {
                    return (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    );
                  })}
                </select>
              </label>
              {traceApproach || traceVehicle || traceMovement ? (
                <button
                  className="link-button"
                  onClick={function () {
                    setTraceApproach("");
                    setTraceVehicle("");
                    setTraceMovement("");
                  }}
                >
                  清除篩選
                </button>
              ) : null}
              <small className="trace-filter-note">
                ⚠️ 篩選只影響這張表，<b>不影響任何計算、也不影響下載的核對
                Excel</b>（Excel 一律輸出全部格子）。
              </small>
            </div>
            <div className="table-scroll">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>工作表／儲存格</th>
                    <th>時段</th>
                    <th>來源→目的</th>
                    <th>車種</th>
                    <th>原始輛數</th>
                    <th>當量</th>
                    <th>PCU</th>
                  </tr>
                </thead>
                <tbody>
                  {traceFiltered.map(function (cell, index) {
                    return (
                      <tr key={cell.sheet + cell.cell + index}>
                        <td>
                          {cell.sheet}!{cell.cell}
                        </td>
                        <td>{cell.time}</td>
                        <td>
                          {cell.approach} →{" "}
                          {cell.destination ||
                            MOVE_LABELS[cell.movement || "through"]}
                        </td>
                        <td>
                          {/*
                            ⚠️ 被併走的車種要同時看得到**原始欄名**與**計入的類型**。
                              只印「特種車」的話，使用者翻回調查表找不到那一欄
                              （欄名是「聯結車」），這張表就失去用途。
                              沒有被併走時兩者相同，只印一次。
                          */}
                          {cell.sourceVehicleLabel &&
                          cell.sourceVehicleLabel !== cell.vehicleLabel ? (
                            <>
                              {cell.sourceVehicleLabel}
                              <br />
                              <small className="trace-merged-into">
                                計入{cell.vehicleLabel}
                              </small>
                            </>
                          ) : (
                            cell.vehicleLabel
                          )}
                        </td>
                        <td>{cell.rawCount.toLocaleString()} 輛</td>
                        <td>{cell.factor}</td>
                        <td>{cell.pcu.toLocaleString()} PCU</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {traceCells.length && !traceFiltered.length ? (
              <p className="hint">
                目前的篩選條件沒有符合的格子。按「清除篩選」看全部 {traceCells.length} 格。
              </p>
            ) : null}
          </>
        ) : (
          <p>
            此資料由舊版備份移轉，未保存儲存格座標；重新匯入即可建立追溯資料。
          </p>
        )}
      </details>
      {/*
       * ══════════════════════════════════════════════════════════
       *  審核與鎖定：**放在流量表之後**
       * ══════════════════════════════════════════════════════════
       *
       * 使用者 2026-09-11：「按照邏輯，應該是先看過下方的流量計算表後，
       * 最下方才是成果審核狀態的設定？」——他是對的。
       *
       * 這三塊（本季鎖定狀況／成果審核狀態／本筆鎖定狀態）做的都是
       * 「**看完之後下結論**」的事。放在最上面等於還沒看資料就要人做判斷，
       * 而且把真正要看的流量表整整往下推了一整個螢幕。
       *
       * ⚠️ 只調順序，三塊的內容、判斷條件與 state 一個字都沒有動。
       */}
      <section
        className={focusClass(
          "audit-lock",
          "panel lock-banner " + (conflicts.length ? "conflict" : ""),
        )}
        id="audit-lock"
      >
        <div>
          <b>
            {lockedCount
              ? "本季已鎖定 " +
                lockedCount +
                "／" +
                props.quarterRecords.length +
                " 個路口"
              : "本季成果尚未鎖定"}
          </b>
          <p>
            {lockedCount
              ? "鎖定後若修改名稱、角度、流向或覆蓋匯入，系統會先詢問並解除受影響成果。"
              : "完成逐筆核對後可手動鎖定；日後仍可手動解除。"}
          </p>
        </div>
        {conflicts.length > 0 && (
          <strong>
            偵測到鎖定衝突：{Array.from(new Set(conflicts)).join("；")}
          </strong>
        )}
        {conflicts.length === 0 && versionNotes.length > 0 && (
          <span className="lock-note">
            {Array.from(new Set(versionNotes)).join("；")}
          </span>
        )}
      </section>
      {/*
       * ⚠️ data-testid 是刻意加的，不是裝飾。
       *   這一頁有三塊都掛著 .review-panel（成果審核狀態、資料別、…），
       *   守門測試原本用 `.review-panel select` 的**第一個**來找審核下拉。
       *   2026-09-11 把審核區移到流量表之後，DOM 裡的第一個就換成了
       *   「資料別」那一顆——測試紅字寫著「鎖定後審核狀態下拉停用」，
       *   看起來像鎖定失效，其實鎖定完全正常，只是抓錯了元素。
       *   錨點要綁在**這一塊自己的身分**上，不是它在頁面上的位置。
       */}
      <section
        className={focusClass("audit-review", "panel review-panel")}
        id="audit-review"
        data-testid="review-status"
      >
        <div>
          <b>成果審核狀態</b>
          {/*
            這一段要說清楚這個欄位在做什麼，否則使用者看到「不論選哪一個都
            鎖得起來」，只會覺得它沒有用途。它管三件事：
            「需修正」擋住鎖定、「待核對」鎖定前會再問一次、鎖定之後就改不動。
          */}
          <p>
            審核狀態不會改變任何計算，但它決定這一季能不能鎖定：
            <b>需修正</b>會擋下鎖定，<b>待核對</b>鎖定前會再問一次，
            <b>已核對／已確認</b>可直接鎖定。
            {recordLock ? "本筆已鎖定，要改審核狀態請先解除鎖定。" : ""}
          </p>
        </div>
        <select
          value={record.review?.status || "待核對"}
          disabled={Boolean(recordLock)}
          title={recordLock ? "本筆成果已鎖定，請先解除鎖定" : ""}
          onChange={function (event) {
            props.setReview(
              event.target.value as "待核對" | "已核對" | "已確認" | "需修正",
              record.review?.note || "",
            );
          }}
        >
          <option>待核對</option>
          <option>已核對</option>
          <option>已確認</option>
          <option>需修正</option>
        </select>
        <input
          value={record.review?.note || ""}
          placeholder="審核備註"
          disabled={Boolean(recordLock)}
          onChange={function (event) {
            props.setReview(
              record.review?.status || "待核對",
              event.target.value,
            );
          }}
        />
      </section>
      {/*
        鎖定到底有沒有作用，要看得見才算數。
        舊版只有頂端一行「本季已鎖定 N／M 個路口」，使用者無從判斷
        目前這一筆是不是鎖著的、什麼時候鎖的、鎖了以後資料有沒有被動過。
      */}
      <section className={"panel review-panel lock-state" + (recordLock ? "" : " unlocked")}>
        <div>
          <b>本筆成果鎖定狀態</b>
          {recordLock ? (
            <p>
              已於 {new Date(recordLock.lockedAt).toLocaleString("zh-TW")} 鎖定
              （鎖定當時版本 {recordLock.version}）。
              {recordConflict
                ? "　⚠️ " + recordConflict + "。"
                : "　鎖定後內容未被更動。"}
              {!recordConflict && recordState.note ? "　" + recordState.note : ""}
              {" "}
              鎖定期間修改名稱、角度、流向、批次指定資料別、重新匯入或刪除季度，
              系統都會先跳出確認並要求解除鎖定才會動手。
            </p>
          ) : (
            <p>
              尚未鎖定。這一筆目前可以被改名、調整角度與流向，或被重新匯入覆蓋，
              而且不會有任何確認視窗。
            </p>
          )}
        </div>
        <span className={recordLock ? "status-dot locked" : "status-dot"}>
          {recordLock ? "🔒 已鎖定" : "未鎖定"}
        </span>
      </section>
      {/*
        * ══════════════════════════════════════════════════════════════
        *  「版本差異與還原」整塊已於 2026-09-15 從畫面移除
        * ══════════════════════════════════════════════════════════════
        *
        * 使用者原話：
        *   「還原清單和還原此版本的按鈕，我是覺得使用者不會去使用，也不會去查看。
        *     寧願直接刪除該季資料，重新匯入……所以還原清單和還原此版本的按鈕，
        *     如果你維護會用到，那一樣**放在你看的到的程式碼裡就好了，
        *     不用顯示給使用者看**」
        *   「我看不懂還原點會還原些什麼事情，**不敢去賭**」
        *
        * ⚠️ **還原點資料本身照常繼續產生與保存**（recordRevisions、
        *   trimRevisionBatches、備份匯出全部保留）——它是重新匯入、人工修改、
        *   刪除之前自動留下的備份，維護時要靠它。拿掉的只有畫面上那一顆
        *   沒有人敢按的按鈕。
        *
        * ⚠️ 拿掉之後，畫面上**沒有任何「回到上一版」的入口**了。
        *   使用者的救援路徑只剩「刪掉那一季重新匯入」與「還原備份檔」——
        *   這是使用者明確選的，不是疏漏。
        *
        * ⚠️ 要在維護時看這份清單：state 裡的 recordRevisions 就是它，
        *   結構是 { id, recordId, savedAt, reason, batchLabel, batchSize, snapshot }。
        */}
    </div>
  );
}

/*
 * 拖曳放置區的「進出深度」計數，記在該區塊自己的 dataset 上。
 *
 * 用計數而不是布林旗標：拖曳經過區塊內部的子元素時，子元素的 dragenter
 * 會比父元素的 dragleave 晚送達，用布林會讓高亮一閃一閃。
 * 每個放置區各記各的，互不干擾。放在元件外面是因為它不碰任何狀態。
 */
function dragDepth(el: HTMLElement, delta: number) {
  const next = Math.max(0, Number(el.dataset.dragDepth || 0) + delta);
  el.dataset.dragDepth = String(next);
  return next;
}

/**
 * 側欄小分頁的收合狀態存在哪裡。
 *
 * ⚠️ 讀不到（無痕視窗、瀏覽器封鎖儲存）時回空陣列＝全部展開，
 *   不可以讓它整支拋例外——側欄壞掉比記不住收合狀態嚴重得多。
 */
const NAV_COLLAPSE_KEY = "turning-nav-collapsed-v1";
/*
 * ── 分類（一、二、三…）也可以整區收合 ──────────────────────────
 *
 * 使用者 2026-09-14：
 *   「路口轉向 分類標題(一、二、三...)文字太小，可以比照全日交通量那樣，
 *     **並且附帶展開收合功能**」
 *
 * ⚠️ 這個 key 和小分頁收合的 key **分開存**。兩者是不同層級的東西
 *  （分類收起來 = 整區的大分頁都不顯示；小分頁收起來 = 只收那一頁的錨點），
 *   混在同一個陣列裡會互相覆蓋，而且日後看不出某個 id 指的是哪一種。
 */
const ZONE_COLLAPSE_KEY = "turning-nav-zone-collapsed-v1";
function readStringList(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter(function (x) {
          return typeof x === "string";
        })
      : [];
  } catch {
    return [];
  }
}
/*
 * ⚠️ 小分頁的收合狀態**刻意不再記住**（舊的 key 一併清掉）。
 *
 *   使用者 2026-09-14 在交通服務水準上回報：按過一次收合鈕之後，
 *   那一頁的小分頁就**永遠**是收的，再怎麼點大分頁都不會展開，
 *   接著要求「請同步確認三份程式是否都能自動展開」。
 *
 *   這一支重新整理一律回到預設分頁，要回到某一頁就一定得點它一下，
 *   而點下去現在就會展開。也就是說「記住小分頁收合」唯一做得到的事，
 *   就是製造那個毛病。收合鈕的用途是「我正在看這一頁，側欄先收一下」，
 *   那是這一次瀏覽期間的事，不必留到下次。
 *
 * ⚠️ 分類（整區）收合**不一樣，仍然記住**：那一區的分類標題永遠在畫面上，
 *   重新整理之後看得到、也點得開，記住它是有意義的。
 */
const readNavCollapsed = (): string[] => {
  try {
    localStorage.removeItem(NAV_COLLAPSE_KEY);
  } catch {
    /* 清不掉也無所謂，反正下面回的是空陣列＝全部展開。 */
  }
  return [];
};
const readZoneCollapsed = () => readStringList(ZONE_COLLAPSE_KEY);

export default function TrafficApp() {
  const [view, setView] = useState<View>("projects");
  /* 第一次進某一頁 → 從最上面；回頭再進去 → 接著上次中斷的地方。 */
  useViewScrollMemory(view);

  /*
   * ══════════════════════════════════════════════════════════════════
   *  側欄子項目：對應的區塊不存在時就不要列出來
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-12（在全日交通量上實際踩到，附截圖）：
   *   「我按了本季總覽，畫面跳到……我完全看不出本季總覽是什麼用途?」
   *   ——那一塊因為沒有資料而整個沒被渲染，側欄那一項照樣點得下去、
   *   照樣變成「目前這一項」，但畫面上什麼都沒發生。
   *
   * ⚠️ 這比壞掉更糟：**功能看起來像故障，而使用者無從得知原因**。
   *   沒有錯誤訊息、沒有提示，他只會覺得「這個按鈕壞了」或
   *   「我看不懂這個功能」——兩種結論都是錯的，而且他不會再按第二次。
   *
   * 這一支程式的「流量核對工作台」在沒有選到紀錄時整頁換成一張說明卡
   *（AuditWorkbench 的 `if (!record) return <Empty…>`），底下那五塊
   * 全部不存在。那就**不要列出它的五個子項目**——頁面上那張說明卡
   * 已經講了「請先選擇有匯入資料的計畫與季度」，比五個點了沒反應的
   * 項目清楚得多。
   */
  const navSectionsReady = function (viewId: View) {
    if (viewId === "audit") return Boolean(selected);
    return true;
  };
  /*
   * ── 「列得出來的，畫面上一定找得到」──────────────────────────────
   *
   * ⚠️ 光靠 `needs` 宣告是**不夠的**，2026-09-12 的端對端實測抓到五項：
   *     ・季度批次匯入／本次匯入的尖峰時段   （要正在匯入才有）
   *     ・季度批次匯入／匯入辨識結果         （同上，宣告成 "records" 是錯的）
   *     ・路口名稱管理／檔名別名清冊         （要真的存過別名才有）
   *     ・道路與流向管理／交通量圖卡排版預覽 （條件比「有選路口」更窄）
   *     ・車種組成分析／全調查時段道路方向車種數量（要算得出車種列）
   *   它們照樣被列出來，點下去什麼都不會發生——**沒有任何訊息**，
   *   使用者只會覺得那顆按鈕壞了。
   *
   * ⚠️ 正確的做法不是再發明幾個 `needs` 名目去猜每一塊的渲染條件
   *   （條件會變，猜錯了又是一個安靜的洞），而是**直接問畫面**：
   *   這個 id 存不存在、而且畫得出高度嗎？沒有就不列。
   *   交通服務水準那一支已經是這樣做的（renderNavSections 依實際高度過濾），
   *   這裡對齊，三支同一套規矩。
   *
   * `needs` 保留當作便宜的前置過濾（少跑幾次量測），但**最終由畫面決定**。
   */
  const [presentAnchors, setPresentAnchors] = useState<string[]>([]);
  /*
   * ⚠️ 就地豁免 react-hooks/exhaustive-deps，理由寫清楚（2026-09-14）：
   *
   *   規則的警告文字是「沒有相依陣列可能造成無限更新，請改成 []」——
   *   **它建議的修法在這裡是錯的**。改成 [] 等於只量一次，
   *   而這一段存在的目的正是「每次 render 後都重新量一次畫面」。
   *
   *   規則擔心的無限迴圈，是靠下面 setState 裡那一段
   *   「算出來的結果和上一次一樣就回傳 previous」擋掉的：
   *   React 看到同一個參考就不會再觸發一次 render。
   *   規則看不到那一段，所以它判斷不了。
   *
   *   ⚠️ 這個豁免**綁在那道防護上**：`tests/render-loop-guard.test.mjs`
   *   會檢查每一處掛了這個豁免的 effect，裡面都還留著那段比較；
   *   把比較拿掉、只留豁免，測試就會紅。
   *   （不可以讓 eslint-disable 變成「貼上去就安靜」的貼紙。）
   *
   * ⚠️ 維持 `eslint-disable-next-line` 的**單行**寫法，不要改成
   *   `eslint-disable` / `eslint-enable` 的區塊寫法：實測（同日，在全日交通量上）
   *   區塊寫法會被 eslint 誤報成「Unused eslint-disable directive」——
   *   而且只有在 lint **整個目錄**時才報，單獨 lint 一個檔案不會報，
   *   拿掉它規則卻確實會出錯。lint 是零警告，那條誤報會讓整包永遠紅。
   *   （我一度把成因歸給「指令後面的 `-- 理由` 尾巴」，那是錯的，已更正。）
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(function () {
    /*
     * ⚠️ 這個 effect 刻意**不給相依陣列**：區塊出現／消失的原因太多
     *  （匯入預覽、存了一個別名、算得出車種列…），列不完，列漏了就又是洞。
     *   每次 render 後量一次，但**只有結果真的變了才 setState**，
     *   否則會無限重繪。
     */
    const found: string[] = [];
    for (const item of NAV)
      for (const section of item.sections || []) {
        const el = document.getElementById(section.anchor);
        if (el && el.getBoundingClientRect().height > 0)
          found.push(section.anchor);
      }
    setPresentAnchors(function (previous) {
      return previous.join("|") === found.join("|") ? previous : found;
    });
  });
  /*
   * 側欄子項目點到哪一塊，那一塊就被「點名」（外框＋微微抬起）。
   *
   * ⚠️ 用外框不用底色：那幾塊裡面有白底輸入框、灰字說明、深色數字，
   *   換底色等於一次動到好幾種文字的對比。outline 畫在方塊**外面**，
   *   不覆蓋任何一個字，「遮到字」結構上不可能發生。
   *   （與全日交通量同一套做法，三支一致。）
   *
   * ⚠️ 換頁時要清掉，否則切到別頁再切回來，還留著上一次的外框。
   */
  const [focusedBlock, setFocusedBlock] = useState("");
  /**
   * 這張卡片現在是不是側欄點名的那一張。
   *
   * ⚠️ 與 AuditWorkbench 裡那一個同名、同語意，但那一個是元件內的區域變數，
   *   拿不到這一層來用。兩邊都只做一件事（接上 " is-focused"），
   *   外框樣式一律由 CSS 的 `.is-focused` 給，而且那條選擇器**不綁元素**
   *   ——新加的卡片掛上 class 就一定看得見（姊妹專案踩過綁元素的坑）。
   */
  const focusClass = (anchor: string, base: string) =>
    focusedBlock === anchor ? base + " is-focused" : base;
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [records, setRecords] = useState<TrafficRecord[]>([]);
  const [quarter, setQuarter] = useState("");
  /*
   * ── 主工具列的其餘條件 ──────────────────────────────────────
   *
   * 使用者 2026-09-14 逐項指定，模型與三態（鏡子／脫離／回歸）見
   * app/main-filters.ts。
   *
   * ⚠️ 季度是**起訖區間**，`quarter` 就是「結束季度」。
   *
   * ⚠️ 預設是**起＝最早一季、迄＝最新一季**（使用者 2026-09-15 定案）。
   *   舊版預設起＝迄＝最新一季，並把「起＝迄」在歷季趨勢圖上解釋成「不限季」，
   *   好讓那張圖預設畫得出全部季度。那是**用錯誤的語意去補預設值的問題**：
   *   使用者的定義是「起＝迄就是只有那一季」。
   *   改成預設涵蓋全部季度之後，兩件事同時成立：
   *     ・預設狀態下歷季趨勢圖照樣畫全部季度（因為區間本來就是全部）
   *     ・起＝迄時**真的只看那一季**，三支語意一致
   *
   * ⚠️ 這一支的 quarterFrom 只餵四個地方：歷季趨勢圖、路口下拉的母體、
   *   結論草稿的範圍、報告範圍——**沒有任何「本季」卡片吃它**，
   *   所以改預設不會動到畫面上任何一個既有數字。
   *  （全日交通量不同：它有好幾塊「本季」的卡片吃 quarterFrom，
   *    那一支的預設維持起＝迄＝本季，見待修正清單的說明。）
   */
  const [quarterFrom, setQuarterFrom] = useState("");
  /* 使用者有沒有自己動過起始季度。動過就不再自動跟著季度清單跑。 */
  const [quarterFromTouched, setQuarterFromTouched] = useState(false);
  /*
   * X-8：「資料維護 → 刪除單一季度」那一格選到哪一季。
   * ⚠️ 與主工具列的季度**刻意分開**：刪除是破壞性操作，
   *   拿主工具列的值當預設會讓「我只是看某一季」變成「我正要刪它」。
   *   空字串＝還沒選（按鈕 disabled）；下面的 effect 會在季度清單變動時補上。
   */
  const [deleteQuarterKey, setDeleteQuarterKey] = useState("");
  /*
   * ══════════════════════════════════════════════════════════════════
   *  X-85：季度改名（三支同步；全日交通量早就有，這兩支缺）
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-17：「我看全日交通量程式除了可以刪除單一季度外，還能針對
   *   單一季度做修改名稱，你覺得這項功能要同步給路口轉向程式和交通服務水準
   *   程式嗎?」→ 2026-09-18 裁示：「請幫我將另外兩支也同步季度改名功能，
   *   擺放位置可以參考全日交通量程式擺放的地方。」
   *
   * ⚠️ 為什麼需要它：季度是匯入時**手打**的，打錯是必然。沒有改名就只能
   *   刪掉重匯，而重匯會連帶弄丟那一季的成果鎖定與還原點。
   * ⚠️ 兩條界線（和全日交通量一致，不可以放寬）：
   *   ① **不可以併進一個已經存在的季度**——那等於自行合併兩季的資料，
   *     系統不替使用者做這種決定，直接擋下來。
   *   ② 要**一次改完全部**：紀錄本身、還原點裡記的季度、成果鎖定。
   *     只改 records 的話，還原點會指向一個不存在的季度。
   */
  const [renameQuarterDraft, setRenameQuarterDraft] = useState("");
  const [peakRule, setPeakRule] = useState<PeakRule>("point");
  /*
   * ⚠️ 初始值要取 DEFAULT_MAIN_FILTERS.day，不可以寫死 "all"。
   *
   * 甲案（2026-09-16）把「全部」從選單上拿掉、預設改成「平日＋假日並列」之後，
   * 這一行還留著 "all"：`<select value="all">` 在選項裡找不到對應的 option，
   * 瀏覽器只好顯示**第一項**（平日）——畫面上寫著「平日」、狀態卻是 "all"，
   * 而且 `mainAtDefault` 比出來不相等，於是一開機就掛著一顆
   * 「恢復預設條件」（按了才真的變成並列）。
   * 這正是 normalizeLegacyAll 上方註解警告過的那個症狀，只是它只管舊存檔，
   * 沒管到這個**初始值**。
   */
  const [dayChoice, setDayChoice] = useState<DayChoice>(
    DEFAULT_MAIN_FILTERS.day,
  );
  const [movementChoice, setMovementChoice] = useState<MovementChoice>("all");
  const [mainIntersections, setMainIntersections] = useState<string[]>([]);
  /** 哪幾張圖正在用自己的條件；空的＝全部跟著主工具列。 */
  const [chartOverrides, setChartOverrides] = useState<ChartOverrides>({});
  /*
   * 「各路口尖峰彙總」自己的路口篩選。
   * 季度沿用頂端那個全站共用的「季度」選單（在哪一頁改，其他頁跟著變），
   * 這裡只多一個「要看哪一個路口」。預設 ALL＝全部路口並排，
   * 那才是這一頁存在的理由；路口多的計畫才需要縮到單一路口。
   */
  const [peaksIntersection, setPeaksIntersection] = useState("ALL");
  /*
   * 期別要顯示成「季別」還是「實際調查月份」。
   * **只影響畫面上的文字**——分組、排序、鍵值、計算與匯出的數值一律仍以
   * 季別為準（quarter 這個字串本身完全沒動）。使用者一季分兩個月做完時，
   * 這個切換讓他一眼看出 115Q1 實際是「115年2、3月」。
   */
  /*
   * 年份顯示成民國還是西元。**純顯示**——季別一律以民國年寫法儲存，
   * 分組、排序、識別鍵全部走儲存值，切換不會多出季度也不動任何計算。
   * 匯出的 Excel 跟著一起換，避免畫面寫 2026Q1、交出去的報表寫 115Q1。
   */
  const [yearStyle, setYearStyle] = useState<YearStyle>("roc");
  /*
   * 顯示用的季度字串。數值欄位一律不經過它。
   *
   * 包成 useCallback 是必要的：好幾個 useMemo（轉向圖 SVG、幾何示意圖）
   * 會用到它，函式每次 render 都換一個新的話，那些 memo 等於沒有效果，
   * 每次 render 都要重新組一整張 SVG。相依只有 yearStyle。
   */

  const [periodDisplay, setPeriodDisplay] =
    useState<PeriodDisplayMode>("quarter");
  const [importYear, setImportYear] = useState("");
  const [importQuarterNo, setImportQuarterNo] = useState("");
  const [selectedIntersection, setSelectedIntersection] = useState("");
  const [selectedSurveyType, setSelectedSurveyType] = useState("");
  /*
   * ── 尖峰時段：主工具列的那一個 ──────────────────────────────
   *
   * ⚠️ 這裡**刻意不改既有的 `peak` 介面**：下游有幾十個地方讀它，
   *   而它的型別 ScopeKey 裝不下「上午＋下午並列」。
   *   所以狀態改成 peakChoice（多一個 "AMPM"），
   *   再往下攤成既有的 peak；沒有選並列時兩者完全相同，
   *   既有數字一個都不會變。
   */
  const [peakChoice, setPeakChoice] = useState<PeakChoice>("AM");
  const peak: ScopeKey = peakChoice === "AMPM" ? "AM" : peakChoice;
  /*
   * ⚠️ 這裡原本還有一個 setPeak（ScopeKey → setPeakChoice 的轉接）。
   *   v2.1.74 之後每一張圖的時段都走 changeChartFilter(圖的 id, "peak", …)，
   *   沒有任何一個地方該直接改全站的時段——留著它只會讓下一個人
   *   又寫出「在這一頁切時段、別頁跟著換」的舊毛病。所以拿掉。
   *   主工具列改時段走 onPeak → setPeakChoice。
   */
  /*
   * ⚠️ 車種組成的「時段」**不再是一份獨立狀態**。
   *
   *   升級前它是 useState<CompositionScope>("AM")，和全站共用的 peak
   *   各存各的。實測（2026-09-14）：在「路口轉向圖」把時段切成下午尖峰，
   *   流量核對工作台、轉向進階分析、歷季趨勢比較的數字都跟著換了，
   *   **只有車種組成分析沒換**，標題還寫著「AM Peak」。
   *   同一個畫面上兩個「時段」的概念，數字自然對不起來。
   *
   *   現在它是「這一張圖實際該用的條件」推出來的：平常跟著主工具列，
   *   在這一頁動了它就只有這一張脫離（三態見 app/main-filters.ts）。
   *
   * ⚠️ 預設值仍然是 AM（主工具列的預設也是 AM），所以**既有數字一個都不會變**——
   *   baseline 逐格比對過。
   */

  const [diagramStyle, setDiagramStyle] = useState<DiagramStyle>("formal");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("both");
  const [arrowMode, setArrowMode] = useState<ArrowMode>("all");
  const [flowSummaryMode, setFlowSummaryMode] =
    useState<FlowSummaryMode>("both");
  const [showGeometryCardPreview, setShowGeometryCardPreview] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [vehicle, setVehicle] = useState<VehicleKey>("all");
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  /*
   * ── 車種轉向當量、車種目錄與車種對照：依計畫各存一份 ──
   *
   * v2.1.13 以前這三樣是全域共用的。已匯入的資料不會被影響（每一筆紀錄在
   * 匯入當下就把矩陣存進 pceUsed、PCU 也在那時算好），但畫面上永遠只看得到
   * 「最後一次設定」——切到 A 計畫卻顯示 B 計畫的係數，而且在 A 重新匯入
   * 某一季時會用到 B 的係數，同一個計畫裡的季度就對不起來了。
   * 車種目錄也一樣：某個計畫匯入過大客車，之後每個計畫都會看到大客車。
   *
   * 現在改成以計畫 id 為鍵各存一份，計畫之間完全不互相影響。
   * 下面三個 pce / vehicleCatalog / vehicleMappings 是「目前計畫的那一份」，
   * setter 也維持原本的用法（可傳物件或 updater），呼叫端不必改。
   */
  const [pceByProject, setPceByProject] = useState<Record<string, PceMatrix>>(
    {},
  );
  const [catalogByProject, setCatalogByProject] = useState<
    Record<string, Record<string, string>>
  >({});
  const [mappingsByProject, setMappingsByProject] = useState<
    Record<string, VehicleMappingTable>
  >({});
  /*
   * ── 依「季別 × 路口」覆寫的當量係數 ──────────────────────────
   *
   * 使用者 2026-09-10：「初始的預設自然是設定一次，套用全季度＋全路段。
   * 有需求的使用者，就到當量係數設定畫面，去按自己的需求（不同季度）
   *（不同路段）套用不同的標準。」「計畫和計畫之間不能彼此干擾，
   * 路段和路段之間，季別和季別之間都不能互相干擾。」
   *
   * ⚠️ pceByProject **完全沒有改動**，它存的就是「全季別 × 全路口」那一組，
   *   也就是解析順位裡最粗的那一層。所以舊資料不必轉檔、舊備份讀得到、
   *   沒有建立任何覆寫的使用者一個數字都不會變。
   *
   * ⚠️ 這一支程式與全日交通量有個關鍵差異：**每一筆紀錄都帶著
   *   `record.pceUsed` 快照**，計算讀的是快照而不是目前設定。
   *   所以覆寫的作用點是「**匯入時要套哪一組**」，以及使用者主動按下
   *   「重新套用到已匯入資料」時要換成哪一組。
   *   這代表：建立覆寫**不會**默默改掉既有資料的數字——那是好事，
   *   但也代表畫面上必須講清楚「要按了才會重算」。
   */
  const [pceScopesByProject, setPceScopesByProject] = useState<
    Record<string, FactorScope<PceMatrix>[]>
  >({});
  const pceScopes = pceScopesByProject[activeProjectId] || EMPTY_SCOPES;
  const pce = pceByProject[activeProjectId] || DEFAULT_PCE;
  const vehicleCatalog =
    catalogByProject[activeProjectId] || CORE_VEHICLE_LABELS;
  const vehicleMappings = mappingsByProject[activeProjectId] || {};
  /** 把「整體設定」的 setter 包成「只改目前計畫那一份」。 */
  function scopedSetter<T>(
    setMap: (updater: (previous: Record<string, T>) => Record<string, T>) => void,
    fallback: T,
  ) {
    return function (value: T | ((previous: T) => T)) {
      setMap(function (previous) {
        // 沒有選計畫時不要寫進 ""，那會變成一份誰也看不到的孤兒設定。
        if (!activeProjectId) return previous;
        const current = previous[activeProjectId] ?? fallback;
        const next =
          typeof value === "function"
            ? (value as (previous: T) => T)(current)
            : value;
        return { ...previous, [activeProjectId]: next };
      });
    };
  }
  const setPce = scopedSetter<PceMatrix>(setPceByProject, DEFAULT_PCE);
  const setPceScopes = scopedSetter<FactorScope<PceMatrix>[]>(
    setPceScopesByProject,
    EMPTY_SCOPES,
  );
  /* 目前正在編輯哪一個範圍。預設就是「全季別 × 全路口」。 */
  const [scopeQuarter, setScopeQuarter] = useState<string>(SCOPE_ANY);
  const [scopeRoadId, setScopeRoadId] = useState<string>(SCOPE_ANY);
  /*
   * ── 編輯中的係數 ────────────────────────────────────────────
   *
   * `null` ＝ 正在編輯**計畫預設**：這時表格直接寫進 pce，
   *          與改版前一模一樣的那條路徑，一個字都沒變。
   * 非 null ＝ 正在編輯**某一個範圍**：表格只寫進草稿，
   *          按下「套用到這個範圍」才會變成一筆覆寫。
   *
   * ⚠️ 這個草稿是**必要**的，不是為了好看。沒有它的話，使用者選了
   *   115Q2 之後在表格上打字，會直接改掉**全季別**的預設係數——
   *   他以為只動了一季，其實動了全部，而且沒有任何提示。
   */
  const [scopeDraft, setScopeDraft] = useState<PceMatrix | null>(null);
  /** 表格上實際顯示與編輯的那一組。 */
  const editingPce = scopeDraft ?? pce;
  /*
   * ⚠️ 換計畫時要歸零。不歸零的話，在 A 案選了某個路口之後切到 B 案，
   *   畫面還停在那一格，而 B 案可能根本沒有那個路口——
   *   一按套用就會在 B 案建立一筆永遠不會命中的覆寫。
   */
  useEffect(
    function () {
      setScopeQuarter(SCOPE_ANY);
      setScopeRoadId(SCOPE_ANY);
      setScopeDraft(null);
    },
    [activeProjectId],
  );
  const setVehicleCatalog = scopedSetter<Record<string, string>>(
    setCatalogByProject,
    CORE_VEHICLE_LABELS,
  );
  const setVehicleMappings = scopedSetter<VehicleMappingTable>(
    setMappingsByProject,
    {},
  );
  const [importRows, setImportRows] = useState<ImportPreview[]>([]);
  const [formatMemories, setFormatMemories] = useState<FormatMemory[]>([]);
  /*
   * 兩種範本都是**每個計畫各自一份**（v2.1.24）。
   *
   * 舊版兩者都存成一個扁平陣列，所有計畫共用同一份清單：在甲計畫存的範本，
   * 切到乙計畫照樣列在畫面上。這不只是看了礙眼——結論條件裡存著
   * intersectionKeys 與 branchNames，那是該計畫專屬的識別字，套到別的計畫
   * 會篩出 0 筆而找不出原因。這支程式其實已經知道這件事：換計畫時它**會**
   * 重設「正在編的條件」與草稿，理由就寫在下面那段註解裡；漏掉的只有
   * 「已存起來的範本清單」這一項。
   *
   * 作法與 pceByProject／catalogByProject／mappingsByProject 完全一致，
   * 連 setter 都沿用同一個 scopedSetter，呼叫端不必改。
   */
  const [reportTemplatesByProject, setReportTemplatesByProject] = useState<
    Record<string, ReportTemplate[]>
  >({});
  const [conclusionTemplatesByProject, setConclusionTemplatesByProject] =
    useState<Record<string, ConclusionTemplate[]>>({});
  const reportTemplates =
    reportTemplatesByProject[activeProjectId] || EMPTY_REPORT_TEMPLATES;
  const conclusionTemplates =
    conclusionTemplatesByProject[activeProjectId] || EMPTY_CONCLUSION_TEMPLATES;
  const setReportTemplates = scopedSetter<ReportTemplate[]>(
    setReportTemplatesByProject,
    [],
  );
  const setConclusionTemplates = scopedSetter<ConclusionTemplate[]>(
    setConclusionTemplatesByProject,
    [],
  );
  /*
   * 結論草稿的條件與內容放在這一層，切換分頁才不會被卸載清空。
   * 換計畫時才重設——換了計畫，原本挑的路口與支線都不存在了。
   */
  const [conclusionCondition, setConclusionCondition] =
    useState<ConclusionCondition>(DEFAULT_CONDITION);
  const [conclusionDraft, setConclusionDraft] = useState("");
  const [conclusionEdited, setConclusionEdited] = useState(false);
  const [conclusionTemplateName, setConclusionTemplateName] = useState("");
  /*
   * 換計畫時把條件與草稿重設。不重設的話，A 計畫挑的路口與支線會被帶到
   * B 計畫，篩出 0 筆卻看不出原因；草稿也會留著別的案子的數字。
   */
  const conclusionOwner = useRef(activeProjectId);
  useEffect(
    function () {
      if (conclusionOwner.current === activeProjectId) return;
      conclusionOwner.current = activeProjectId;
      setConclusionCondition(DEFAULT_CONDITION);
      setConclusionDraft("");
      setConclusionEdited(false);
    },
    [activeProjectId],
  );
  const [reportTemplateName, setReportTemplateName] = useState("");
  const [recordRevisions, setRecordRevisions] = useState<RecordRevision[]>([]);
  const [importConflictModes, setImportConflictModes] = useState<
    Record<string, ImportConflictMode>
  >({});
  /**
   * 上一次做路口比對時，這個計畫的路口名稱長什麼樣。
   *
   * 使用者 2026-09-11 問的情境：選完 114Q3 的檔案（預覽產生）→ 跑去
   * 「路口名稱管理」改名 → 回來按確認寫入。「名稱處理」那一欄是**選檔當下**
   * 決定的，改名之後不會重算——如果改名剛好讓這批檔案「本來對不上、
   * 改完就對得上」某個既有路口，預覽仍停在「建立新路口」，
   * 按下去就會多一個重複的路口。
   *
   * ⚠️ 刻意**不自動重算**：自動重算會把使用者自己在下拉裡挑的選擇蓋掉，
   *   那是另一種更難察覺的錯。改成提示＋一顆明確的按鈕。
   */
  const [importNameSnapshot, setImportNameSnapshot] = useState("");
  const [importResolutions, setImportResolutions] = useState<
    Record<string, ImportResolution>
  >({});
  const [importing, setImporting] = useState(false);
  /*
   * 匯入大量檔案時的逐檔進度。
   *
   * 舊版判讀中只有按鈕文字變成「正在解析…」，一動也不動——檔案一多、
   * 跑上十幾秒，使用者分不出「還在跑」和「當掉了」，會以為沒上傳成功。
   * 這裡記「已完成幾份／共幾份／正在讀哪一個檔」，畫在上傳卡片上。
   */
  const [importProgress, setImportProgress] = useState<{
    done: number;
    total: number;
    file: string;
  } | null>(null);
  /*
   * 拖曳中的視覺回饋。原本 onDrop 是有接的，但畫面上沒有任何變化，
   * 使用者拖到一半看不出來「丟這裡對不對」，只能賭一把放開。
   */
  const [dragZone, setDragZone] = useState("");
  /*
   * 選檔期間的提示。
   *
   * 使用者回報「按下選擇檔案、選了大量檔案之後，畫面什麼都沒有」。
   * 實測過原因：change 一送到畫面 0ms 就更新——那段等待完全發生在
   * 瀏覽器把檔案準備好之前，程式那時候還沒被叫到，所以沒辦法
   * 「等待中才開始顯示」，只能從按下去的那一刻就先顯示。
   *
   * 取消選取時不會有 change，靠視窗重新取得焦點當退路。
   */
  const [pickingFiles, setPickingFiles] = useState(false);
  useEffect(
    function () {
      if (!pickingFiles) return undefined;
      let timer = 0;
      function onFocus() {
        window.clearTimeout(timer);
        /* 有選檔時 change 很快就到；等一下再判斷，避免把正常選檔誤判成取消 */
        timer = window.setTimeout(function () {
          setPickingFiles(false);
        }, 1200);
      }
      window.addEventListener("focus", onFocus);
      return function () {
        window.clearTimeout(timer);
        window.removeEventListener("focus", onFocus);
      };
    },
    [pickingFiles],
  );
  /*
   * 檔案掉在放置區**外面**時，瀏覽器預設會直接開啟那個檔案，
   * 等於把使用者踢出系統畫面。這裡全域擋掉，並讓游標顯示「不可放置」。
   * 放置區內部照常放行，交給該區自己的 onDrop 處理。
   */
  useEffect(function () {
    function blockStray(e: DragEvent) {
      /*
       * 只攔「拖檔案」，不要攔一般的文字拖曳。
       *
       * v2.1.47～48 少了這一層判斷，於是把使用者在頁面內拖動選取文字
       * 也一起擋掉了——拖一段字到輸入框或文字區都放不下去。實測確認過。
       * dataTransfer.types 含 "Files" 才是拖檔案。
       */
      const types = e.dataTransfer ? Array.from(e.dataTransfer.types || []) : [];
      if (!types.includes("Files")) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el && el.closest("[data-dropzone]")) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    }
    window.addEventListener("dragover", blockStray);
    window.addEventListener("drop", blockStray);
    return function () {
      window.removeEventListener("dragover", blockStray);
      window.removeEventListener("drop", blockStray);
    };
  }, []);
  /*
   * 站號在檔案內與檔名都讀不到時，讓使用者在預覽列直接補填。
   * 鍵是預覽列的檔案標籤（同一個檔案的平日／假日會是兩列，各自填各自的）。
   */
  /*
   * 每一列預覽是在「哪一個季度」之下解析的。
   *
   * 預覽改成累加之後（分兩次選檔會兩批一起留在預覽裡），出現一個新的風險：
   * 使用者可能先在 112Q4 選了 A，再把季度改成 113Q1 才選 B——
   * 而寫入是**整批寫進目前選的季度**，A 就會被寫到錯的季別，
   * 而且畫面上完全看不出來。
   * 所以逐列記下解析當下的季度，與目前選的季度不一致時要擋下來。
   */
  const [importRowPeriod, setImportRowPeriod] = useState<
    Record<string, string>
  >({});
  /*
   * ★ 路口名稱別名：`計畫id|舊名的正規化鍵` → `新名的正規化鍵`。
   *
   * 使用者實測回報：「我匯入資料後去把名稱做了修正，但可能因為沒有『別名』
   * 的設置，導致我後來匯入的每一季，都要我去確認該路段是否併入修正後的路段裡。」
   *
   * 匯入時的自動比對是拿**調查表裡的名稱**去比**系統裡的名稱**；
   * 改過名之後兩邊就對不起來，於是每一季都退回「請使用者自己選要不要併入」。
   * 改名的當下把「舊名 → 新名」記下來，之後同一個舊名進來就直接自動併入。
   *
   * ⚠️ 鍵值帶計畫 id：不同計畫可能有同名路口，別名不可以跨計畫互相影響
   *    （改名本身也已經是只改自己計畫，別名要一致）。
   */
  const [intersectionAliases, setIntersectionAliases] = useState<
    Record<string, string>
  >({});
  /** 開始編輯名稱時的原名，供 onBlur 判斷「改成了什麼」。 */
  const nameEditStart = useRef<Record<string, string>>({});
  const [stationOverrides, setStationOverrides] = useState<
    Record<string, string>
  >({});
  const [toast, setToast] = useState("");
  /* 每則通知使用獨立序號，避免內容相同的舊計時器誤關掉新通知。 */
  const toastTokenRef = useRef(0);
  /*
   * loaded：本機資料讀完了沒有。存檔 effect 在這之前一律不動作，
   * 避免「開啟網頁時先用空白蓋掉使用者的資料」。
   * loadError：讀取失敗的原因。有值時整個畫面換成搶救指引，不進主程式——
   * 因為主程式一旦 render 就會開始存檔，那才是真正把資料弄丟的那一步。
   */
  /** 這次預覽新增了哪些車種（取消預覽時要原樣還原）。 */
  const [previewAddedVehicles, setPreviewAddedVehicles] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  /*
   * 「資料讀不出來」與「瀏覽器根本不讓我們用儲存空間」是兩件事，
   * 搶救畫面要講的話完全相反：前者原始資料還在、要先備份；
   * 後者根本沒有資料可備份，該做的是去改瀏覽器設定。
   */
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  /*
   * 側欄小分頁的收合狀態（使用者 2026-09-13，三支同步）。
   *
   * ⚠️ 初始值直接讀 localStorage，不用 useEffect 補——
   *   用 effect 的話第一個影格會是全部展開，看得到一次閃動。
   */
  const [navCollapsed, setNavCollapsed] = useState<string[]>(readNavCollapsed);
  const [zoneCollapsed, setZoneCollapsed] =
    useState<string[]>(readZoneCollapsed);
  /*
   * 「用顏色檢視轉向」的起點支線。**同時**驅動兩件事：
   *   (1)上面那張示意圖畫哪一個起點
   *   (2)下面「檢查起點 → 終點流向」展開哪一塊
   * 兩邊共用同一個狀態，就不會出現「圖上看 C、表上開著 A」這種對不起來的情形
   *（那正是使用者要這個功能的原因：看到顏色不對，要能馬上找到那一列去改）。
   */
  const [turnPreviewFrom, setTurnPreviewFrom] = useState("");
  /** 正在編輯哪一個計畫；空字串＝表單是「建立新計畫」。 */
  const [editingProjectId, setEditingProjectId] = useState("");
  const [projectForm, setProjectForm] = useState({
    code: "",
    name: "",
    client: "",
    note: "",
  });
  /*
   * ══════════════════════════════════════════════════════════════════
   *  X-44：檢查摘要與檢查結果，要**按過「執行資料異常檢查」才產生**
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-16 裁示：
   *   「資料異常檢查摘要、檢查結果 應該是建立在 使用者手動點
   *     執行資料異常檢查功能 按鈕後，才產生資料的欄位。
   *     當調查資料匯入時，如果資料有異常，會立刻跳出提醒、警告、確認
   *     那是在匯入的畫面，與資料維護功能是分開的。
   *     **一個是事前預防，一個是事後檢查。**」
   *   「所以使用者手動修正問題後，在按一次檢查，確認異常已消除。」
   *
   * ⚠️ 我原本的作法是「不加按鈕，改成寫一句『即時檢查』的說明」——被否決。
   *   使用者的區分是對的：兩者混在一起，看的人分不出
   *   「這是剛才匯入時就知道的」還是「我現在要查的」。
   *
   * ⚠️ 檢查本身（qualityIssues）照舊即時算，變的是**畫面什麼時候顯示它**。
   */
  const [qualityRunAt, setQualityRunAt] = useState("");
  /** 檢查結果清單的季別篩選（空字串＝全部季度）。這一頁不吃主工具列。 */
  const [issueQuarterFilter, setIssueQuarterFilter] = useState("");
  /** 按下檢查那一刻的資料指紋；與現在不同＝結果已過期。 */
  const [qualityRunStamp, setQualityRunStamp] = useState("");
  /*
   * ⚠️ X-47 之後「異常原因與計算方式」那一塊沒了，選取狀態也就沒有用途。
   *   這裡原本是 `const [selectedIssueId, setSelectedIssueId] = useState("")`，
   *   兩個都移除——留著一個沒人用的選取狀態，下一個人很容易又拿它去做一塊詳情面板。
   */
  /*
   * 「檢查結果」目前篩選哪幾種類型（空陣列＝全列）。
   * 使用者 2026-09-13：「不點任何標籤，表格就全列出全部。」
   */
  const [issueTypeFilter, setIssueTypeFilter] = useState<string[]>([]);
  /*
   * 報告文字草稿的小數位數（使用者 2026-09-15 指名補上）。
   *
   * ⚠️ 舊版**每一處都寫死 1 位**，於是結論草稿改成 2 位之後，
   *   同一批數字在兩份文件裡以不同的位數出現，而兩份都沒有解釋。
   *   預設 1 位＝改版前的行為，升級當天一個字都不變。
   */
  const [reportDraftDigits, setReportDraftDigits] = useState(1);
  const [reportStartQuarter, setReportStartQuarter] = useState("");
  const [reportEndQuarter, setReportEndQuarter] = useState("");
  /*
   * 報告文字草稿。
   * draftSectionOverride 為 null 代表「跟著匯出勾選走」，使用者自己動過之後
   * 才變成一份獨立的清單；換計畫時會還原成跟著走。
   * reportDraftEdited 為 true 代表使用者已經手改過草稿，這時不再自動覆蓋，
   * 否則改到一半按個篩選就整段被蓋掉。
   */
  const [draftSectionOverride, setDraftSectionOverride] = useState<
    DraftSectionKey[] | null
  >(null);
  const [reportDraftText, setReportDraftText] = useState("");
  const [reportDraftEdited, setReportDraftEdited] = useState(false);
  const [batchProjectIds, setBatchProjectIds] = useState<string[]>([]);
  const [batchQuarterKeys, setBatchQuarterKeys] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  /*
   * 存檔改成非同步之後才需要的兩個東西：
   *  ・saveTokenRef：只有最新一次存檔的結果算數（後發先至的競態）
   *  ・savePending：還沒寫完就關掉分頁時要攔一下
   */
  const saveTokenRef = useRef(0);
  const [savePending, setSavePending] = useState(false);
  /*
   * 「這個轉向到底存不存在」的使用者答案，跟著計畫存、跟著備份走。
   * 同一個路口同一個轉向答過一次就記住，之後每一季匯入直接套用，
   * 不會每季重問（那正是使用者對另一支系統抱怨過的事）。
   */
  /*
   * ══════════════════════════════════════════════════════════════════
   *  已經人工確認過、下次檢查不再提醒的異常（使用者 2026-09-17）
   * ══════════════════════════════════════════════════════════════════
   *
   * 「如果已經回報了，要怎麼按確認，來讓這項問題，在下次異常檢查時，
   *   不會再次回報異常呢?」
   *
   * 形狀：{ 計畫 id: { 指紋: { at } } }
   *
   * ⚠️ 指紋**一定要包含那一筆的訊息文字**（裡面有數字與時間）。
   *   只用 issue.id 當鍵的話，確認過「尖峰時段 07:00-08:00」之後，
   *   下一季變成別的時段也會被同一把鑰匙消音——那是把一個新的事實藏起來。
   *   內容變了 → 指紋變了 → 重新出現，這是刻意的。
   * ⚠️ 只有「人工確認」類可以按確認。「重新匯入」是原始檔真的有錯，
   *   給它一顆按掉的鈕，等於提供一個把資料錯誤藏起來的開關。
   * ⚠️ 確認**只影響畫面**：匯出與交付一律仍然輸出全部項目。
   */
  const [ackedIssues, setAckedIssues] = useState<
    Record<string, Record<string, { at: string }>>
  >({});
  /** 檢查結果要不要把已確認的那幾筆一起列出來。 */
  const [showAckedIssues, setShowAckedIssues] = useState(false);
  /*
   * ══════════════════════════════════════════════════════════════════
   *  同一份檔案有兩個日期時，使用者指定的那一個（使用者 2026-09-20）
   * ══════════════════════════════════════════════════════════════════
   *
   * 形狀：{ 計畫 id: { 紀錄 id: "YYYY-MM-DD" } }
   *
   * ⚠️ 為什麼是**覆寫**而不是直接改紀錄：使用者原話是「有可能另一個不同
   *   的日期在該資料中有其意義存在，**所以使用者不會修正資料**」。
   *   同理，系統這一端也不該把原始判讀結果洗掉——留著才有辦法換回來，
   *   也才看得出當初到底有幾個候選。
   * ⚠️ 只影響**顯示**。不影響任何流量或 PCU 計算。
   */
  const [surveyDateOverrides, setSurveyDateOverrides] = useState<
    Record<string, Record<string, string>>
  >({});
  /*
   * 逐筆表格要不要把調查日期寫出來（使用者 2026-09-20：「只需要增加一個
   * 開關讓我可以看到調查日期就好」）。
   *
   * ⚠️ 預設是**開**。做成預設關的話，使用者得先知道有這顆開關才找得到
   *   這個資訊——那等於把功能藏起來。
   * ⚠️ 這顆只管顯示，與「期別顯示：季別／調查月份」是兩件事。
   */
  const [showSurveyDate, setShowSurveyDate] = useState(true);
  const surveyDateMap = useMemo(
    () => surveyDateOverrides[activeProjectId] || {},
    [surveyDateOverrides, activeProjectId],
  );
  /**
   * 這一筆實際要顯示的調查日期：使用者指定過就用他指定的，否則用判讀到的。
   *
   * ⚠️ 覆寫值**必須是候選之一**才採用。備份被手改、或候選在重新匯入後
   *   變了之後，一個不在候選裡的覆寫會讓畫面顯示一個原始檔上根本沒有的
   *   日期——那比顯示錯的還糟，因為使用者無從發現。
   */
  const effectiveRecordDate = useCallback(
    (record: { id: string; date?: string; surveyDateCandidates?: string[] }) => {
      const picked = surveyDateMap[record.id];
      if (!picked) return record.date || "";
      const candidates = record.surveyDateCandidates;
      if (
        Array.isArray(candidates) &&
        candidates.length &&
        !candidates.includes(picked)
      )
        return record.date || "";
      return picked;
    },
    [surveyDateMap],
  );
  const [movementPresence, setMovementPresence] = useState<
    Record<string, MovementPresence>
  >({});
  /** 匯入後待裁決的「分不出來」清單；非空時跳出詢問視窗。 */
  const [presenceQuestions, setPresenceQuestions] = useState<
    {
      key: string;
      recordId: string;
      routeId: string;
      station: string;
      intersectionName: string;
      fromName: string;
      toName: string;
      movement: MovementKey;
      /**
       * 為什麼要問這一條：
       *   "blank"       ＝ 調查表整欄空白，兩種寫法都沒寫。
       *   "placeholder" ＝ 整欄畫橫線，而且橫線數超出算術預期
       *                   （四岔卻出現橫線，通常是禁止轉向或單行道）。
       */
      reason: "blank" | "placeholder";
      /** 系統建議的答案；沒把握時一律是保留。 */
      suggestion: MovementPresence;
      /** 建議的依據，直接顯示給使用者看，不要讓人只能看到結論。 */
      basis: string;
      /** 同一組起訖是否另有一條真的有流量的流向——有的話畫面會出現重複。 */
      duplicatesFlowingRoute: boolean;
    }[]
  >([]);
  /** 視窗裡每一列目前選的答案，預設值＝系統建議（見上）。 */
  const [presenceDraft, setPresenceDraft] = useState<
    Record<string, MovementPresence>
  >({});


  useEffect(function () {
    /*
     * 讀取儲存空間本身就可能丟例外——瀏覽器設定成「封鎖網站資料」時，
     * 連 `window.localStorage` / `indexedDB` 這兩個屬性都會拋 SecurityError。
     *
     * 這一段原本寫在 try 之外，於是那個例外會直接往上冒到 React，整個元件
     * 掛掉：**畫面全白、沒有任何訊息、也沒有搶救指引**。實測（把
     * localStorage 改成存取即拋錯）：畫面完全空白、主控台一則未捕捉例外。
     * 使用者只會覺得「這個網站壞了」。
     *
     * 三支系統對照（同樣把儲存空間停用）：
     *   全日交通量  → toast「IndexedDB 已被停用」，畫面正常、不假裝存檔成功
     *   交通服務水準 → 顯示搶救畫面（文案另有問題，見該支）
     *   路口轉向    → 整頁空白 ← 最差的一個，就是這裡
     *
     * v2.1.53 起改讀 IndexedDB（見 lib/state-storage.ts），舊的 localStorage
     * 資料由 loadState() 自動搬過去。被封鎖的處理維持不變，而且要和
     * 「資料格式壞掉」分開講：儲存空間用不了的時候，資料**不是**還好好留在
     * 瀏覽器裡，不能沿用那句話。
     */
    let cancelled = false;
    loadState().then(
      function (result) {
        if (cancelled) return;
        applyLoadedState(result.text, result.source === "migrated");
      },
      function (error) {
        if (cancelled) return;
        setStorageBlocked(true);
        setLoadError(
          error instanceof Error
            ? error.message
            : "瀏覽器不允許這個網站使用本機儲存空間",
        );
      },
    );
    return function () {
      cancelled = true;
    };

    function applyLoadedState(saved: string | null, migrated: boolean) {
    /*
     * 這台電腦還沒有任何資料 —— 一樣要解鎖存檔。
     *
     * 舊寫法是直接 return，`loaded` 永遠留在 false，而下面那個存檔 effect
     * 第一行就是 `if (!loaded) return;`。結果是：**全新的瀏覽器從頭到尾
     * 不會存下任何東西**。使用者建立計畫、匯入一整季的調查檔、核對、鎖定，
     * 畫面上一切正常，只要重新整理或關掉分頁，全部消失，而且沒有任何訊息。
     * 在另一台空白電腦還原備份也一樣——還原完看起來成功了，重開就沒了。
     * 實測：全新瀏覽器建立計畫後 localStorage 完全沒有寫入，重新整理後
     * 計畫不見。
     *
     * 只有「讀取失敗」才可以不解鎖（那時不寫入是為了保住原始資料）。
     * 「沒有資料可讀」跟「讀不出來」是兩回事。
     */
    if (!saved) {
      setLoaded(true);
      return;
    }
    try {
      const data = JSON.parse(saved);
      const oldDemo =
        data.version === "v1.0.0" &&
        Array.isArray(data.records) &&
        data.records.length === 20 &&
        data.records.every(function (r: TrafficRecord) {
          return r.importedAt === "2026-08-11T09:00:00+08:00";
        });
      if (!oldDemo && Array.isArray(data.records)) {
        if (Array.isArray(data.projects) && data.projects.length) {
          setRecords(
            synchronizeGeometryAcrossQuarters(
              data.records.map(function (record: TrafficRecord) {
                return applyReferenceMovementRule({
                  ...record,
                  name: storedNameOf(record),
                  approaches: record.approaches.map(function (approach) {
                    return {
                      ...approach,
                      bearing: bearingFromAngle(approach.angle),
                    };
                  }),
                  intersectionId:
                    record.intersectionId ||
                    "I-" + canonicalIntersectionKey(record.name),
                });
              }),
            ),
          );
          setProjects(data.projects);
          setActiveProjectId(data.activeProjectId || data.projects[0].id);
        } else if (data.records.length) {
          const migratedId = "P-migrated-v1";
          setProjects([
            {
              id: migratedId,
              code: "MIGRATED",
              name: "舊版資料移轉",
              client: "",
              note: "由 v1.0 本機資料自動移轉；請重新核對匯入欄位。",
              createdAt: new Date().toISOString(),
            },
          ]);
          setActiveProjectId(migratedId);
          setRecords(
            synchronizeGeometryAcrossQuarters(
              data.records.map(function (record: TrafficRecord) {
                return applyReferenceMovementRule({
                  ...record,
                  projectId: migratedId,
                  name: storedNameOf(record),
                  approaches: record.approaches.map(function (approach) {
                    return {
                      ...approach,
                      bearing: bearingFromAngle(approach.angle),
                    };
                  }),
                  intersectionId:
                    record.intersectionId ||
                    "I-" + canonicalIntersectionKey(record.name),
                });
              }),
            ),
          );
        }
      }
      if (data.nameMap) setNameMap(data.nameMap);
      /*
       * 車種設定：新版是「依計畫各存一份」，舊版是全域一份。
       * 讀到舊版資料時把那一份複製給每一個現有計畫，使用者原本看到的數字
       * 完全不變；之後各計畫才會各走各的。
       */
      const projectIds = (data.projects || []).map(function (project: Project) {
        return project.id;
      });
      const spread = function <T>(value: T) {
        return Object.fromEntries(projectIds.map((id: string) => [id, value]));
      };
      setPceByProject(
        data.pceByProject && typeof data.pceByProject === "object"
          ? data.pceByProject
          : spread(data.pce || DEFAULT_PCE),
      );
      /*
       * ⚠️ 舊存檔沒有這個欄位——那時要是空的，代表「沒有任何覆寫」，
       *   也就是與改版前完全相同的行為。不可以退回別的東西。
       */
      setPceScopesByProject(
        data.pceScopesByProject && typeof data.pceScopesByProject === "object"
          ? data.pceScopesByProject
          : {},
      );
      setCatalogByProject(
        data.catalogByProject && typeof data.catalogByProject === "object"
          ? data.catalogByProject
          : spread({ ...CORE_VEHICLE_LABELS, ...(data.vehicleCatalog || {}) }),
      );
      setMappingsByProject(
        data.mappingsByProject && typeof data.mappingsByProject === "object"
          ? data.mappingsByProject
          : spread(data.vehicleMappings || {}),
      );
      if (Array.isArray(data.formatMemories))
        setFormatMemories(data.formatMemories);
      /*
       * 範本改成依計畫分開存之後，舊資料（扁平陣列）**每個計畫各給一份**。
       *
       * 選這個作法是因為它不會讓任何東西看起來像是消失了：使用者過去存的
       * 範本可能是在任何一個計畫底下存的，全部歸給某一個計畫的話，其他計畫
       * 就再也找不到它們。各給一份之後，使用者只要把各計畫用不到的刪掉一次
       * 即可，之後新存的範本就只屬於當下那個計畫。
       * pce／catalog／mappings 三項當初也是這樣遷移的。
       */
      setReportTemplatesByProject(
        data.reportTemplatesByProject &&
          typeof data.reportTemplatesByProject === "object"
          ? data.reportTemplatesByProject
          : spread(
              Array.isArray(data.reportTemplates) ? data.reportTemplates : [],
            ),
      );
      setConclusionTemplatesByProject(
        data.conclusionTemplatesByProject &&
          typeof data.conclusionTemplatesByProject === "object"
          ? data.conclusionTemplatesByProject
          : spread(
              Array.isArray(data.conclusionTemplates)
                ? data.conclusionTemplates
                : [],
            ),
      );
      if (data.movementPresence && typeof data.movementPresence === "object")
        setMovementPresence(data.movementPresence);
      if (data.ackedIssues && typeof data.ackedIssues === "object")
        setAckedIssues(
          data.ackedIssues as Record<string, Record<string, { at: string }>>,
        );
      if (data.surveyDateOverrides && typeof data.surveyDateOverrides === "object")
        setSurveyDateOverrides(
          data.surveyDateOverrides as Record<string, Record<string, string>>,
        );
      if (typeof data.showSurveyDate === "boolean")
        setShowSurveyDate(data.showSurveyDate);
      /* 路口名稱別名（改名後讓下一季自動併入）。舊資料沒有這個欄位是正常的。 */
      if (data.intersectionAliases && typeof data.intersectionAliases === "object")
        setIntersectionAliases(data.intersectionAliases);
      if (Array.isArray(data.recordRevisions))
        /*
         * 讀進來也要套同一套上限。舊資料是「每一筆一個還原點」，
         * 沒有 batchId，會被當成一筆一批——一次批次匯入留下的 65 個
         * 就是 65 批，只保留最近的 REVISION_BATCH_LIMIT 批。
         */
        setRecordRevisions(trimRevisionBatches(data.recordRevisions));
    } catch (error) {
      /*
       * 讀取失敗絕對不能靜靜吞掉。
       *
       * 舊版在這裡什麼都不做，而下面的存檔 effect 又會在同一次 commit 就把
       * 「還是空的」state 寫回去——只要儲存的資料裡有一筆格式不對（少一個
       * 欄位就夠），使用者的全部計畫會在開啟網頁的瞬間被空白覆蓋掉，
       * 畫面上沒有任何訊息。現在改成：讀取失敗就不解鎖存檔，原始資料
       * 原封不動留在瀏覽器裡，並明確告訴使用者發生什麼事、該怎麼救。
       */
      setLoadError(
        error instanceof Error ? error.message : "資料格式無法解析",
      );
      return;
    }
    setLoaded(true);
    /*
     * 搬家成功要講一聲，否則使用者只會發現「資料還在」而不知道
     * 發生過什麼事；萬一之後出狀況，他也講得出來是哪一次開始的。
     */
    /*
     * ⚠️ 走 notify()，不可以直接 setToast()。
     *   直接 setToast() 的訊息**沒有人幫它關掉**——這一則是開機就出現的
     *   告知性訊息，於是它會一直蓋在右下角，把表格最後一列、轉向圖右下角
     *   的圖例擋住，使用者得自己發現「可以點掉」。逐頁截圖時每一頁都看得到。
     *   （下面兩則「儲存空間不足」是**刻意**留著不自動收的：那是要使用者
     *     動手處理的警告，閃過去就等於沒說。）
     */
    if (migrated)
      notify(
        "本機資料已從舊的儲存位置搬到容量大得多的 IndexedDB，資料內容沒有變動。",
        /*
         * ⚠️ 這一則要留久一點（15 秒）。它講的是「你的資料搬到哪裡去了」，
         *   依字數算只有 2.8 秒，使用者還在看畫面就不見了；
         *   而 e2e-storage-idb 也量不到（它要先讀 IndexedDB 再讀畫面）。
         *   但仍然**會自己收掉**——不收的話會一直蓋著右下角（見上面的說明）。
         */
        15000,
      );
    }
  }, []);

  useEffect(
    function () {
      /*
       * 讀取完成之前一律不寫入。
       *
       * 這兩個 effect 屬於同一次 commit，存檔這一個的閉包裡抓到的是「還沒
       * 載入、全部是空的」那一份 state，所以每次開啟網頁都會先把空白寫回
       * 儲存、下一個 tick 才寫回真實資料。中間只要出任何差錯，資料就沒了。
       */
      if (!loaded) return;
      const base = {
        kind: "TURNING_TRAFFIC_STATE",
        version: VERSION,
        projects: projects,
        activeProjectId: activeProjectId,
        records: records,
        nameMap: nameMap,
        pceByProject: pceByProject,
        /*
         * 依季別／路口的係數覆寫。
         * ⚠️ 舊版讀不懂這個欄位會直接忽略，而 pceByProject（＝全季別×全路口）
         *   照舊寫在旁邊——所以退版之後讀到的就是預設係數，不會壞掉。
         */
        pceScopesByProject: pceScopesByProject,
        catalogByProject: catalogByProject,
        mappingsByProject: mappingsByProject,
        /* 舊版欄位仍然寫出目前計畫的那一份，萬一退版也還讀得到東西。 */
        pce: pceByProject[activeProjectId] || DEFAULT_PCE,
        vehicleCatalog:
          catalogByProject[activeProjectId] || CORE_VEHICLE_LABELS,
        vehicleMappings: mappingsByProject[activeProjectId] || {},
        formatMemories: formatMemories,
        /* 「這個轉向存不存在」的使用者答案；不收的話下一季會再問一次。 */
        movementPresence: movementPresence,
        /* 已人工確認、不再提醒的異常；不收的話重新整理就全部復活。 */
        ackedIssues: ackedIssues,
        /*
         * 「同一份檔案有兩個日期，哪一個才對」的指定。
         * ⚠️ 不收的話，重新整理之後系統會退回自己判讀的那一個日期，
         *   明細上的調查日與期別顯示的調查月份**當場變成另一天**。
         */
        surveyDateOverrides: surveyDateOverrides,
        /* 「顯示調查日期」開關；不收的話每次重新整理都跳回預設。 */
        showSurveyDate: showSurveyDate,
        /* 改名後的「舊名＝新名」；不收的話下一季匯入又會問要不要併入。 */
        intersectionAliases: intersectionAliases,
        reportTemplatesByProject: reportTemplatesByProject,
        conclusionTemplatesByProject: conclusionTemplatesByProject,
        /* 舊欄位仍然寫出目前計畫的那一份，萬一退版也還讀得到東西。 */
        reportTemplates: reportTemplates,
        conclusionTemplates: conclusionTemplates,
      };
      /*
       * 存檔改成非同步（IndexedDB）。三件事一定要顧到：
       *
       * 1. **後發的一定要贏**。連續改兩次時，兩個寫入是同時在跑的，
       *    先發的有可能後完成，把新的蓋回舊的。用一個遞增的序號，
       *    只有目前最新的那一次才准寫、也只有它的結果算數。
       * 2. **寫入中不能讓人無聲關掉分頁**。saveTokenRef 沒有結清之前
       *    掛 beforeunload 提醒（見下方 effect）。
       * 3. **寫不進去時畫面不可以壞**。例外一律接住，改用 toast 說明，
       *    絕不讓它冒到 React 造成整頁空白。
       *
       * 降級鏈保留：IndexedDB 的配額比 localStorage 的 4.94 MB 大得多
       * （實測本機容器 0.40 GB，一般 Windows 桌機通常是數十 GB），
       * 但配額仍然存在，而且使用者可能把磁碟塞滿。
       */
      const attempts = [
        { ...base, recordRevisions: recordRevisions },
        { ...base, recordRevisions: trimRevisionBatches(recordRevisions).slice(0, 20) },
        { ...base, recordRevisions: [] },
      ];
      const token = saveTokenRef.current + 1;
      saveTokenRef.current = token;
      setSavePending(true);
      (async function () {
        for (let index = 0; index < attempts.length; index += 1) {
          try {
            await saveState(JSON.stringify(attempts[index]));
            /* 這一次已經被更新的存檔取代了，結果不算數也不要覆蓋狀態。 */
            if (saveTokenRef.current !== token) return;
            /*
             * 降級存檔一定要講出來。
             * 丟掉還原點之後，畫面上的「版本差異與還原」清單讀的是記憶體裡的
             * state，仍然完整顯示 N 筆——但那些已經沒有存進去了，重新整理就
             * 全部消失，而那正是使用者要靠還原點救資料的時候。
             * 使用者依據一個已經不存在的救援選項做決定，比存不進去更危險。
             */
            if (index > 0) {
              const kept = attempts[index].recordRevisions.length;
              setToast(
                "瀏覽器儲存空間快滿了，這次存檔只保留 " +
                  kept +
                  " 筆還原點（原本 " +
                  recordRevisions.length +
                  " 筆）。畫面上仍會列出全部，但重新整理之後只會剩下有存到的那些。" +
                  "請盡快到「備份、還原與版本」下載備份。",
              );
            }
            return;
          } catch {
            if (saveTokenRef.current !== token) return;
            /* 換下一種較精簡的內容再試一次 */
          }
        }
        if (saveTokenRef.current !== token) return;
        /*
         * ⚠️ 這則訊息要**講出一條真的做得到的路**。
         *
         * 空間不足時，使用者人在別的分頁，不會想到「車種轉向當量」那一頁
         * 有一個可以省空間的選項。在真正需要的時刻把它講出來，
         * 比放一顆平常沒人看的按鈕有用得多。
         *
         * ⚠️ 這裡就地算，不用外面的 recomputableCount——那個宣告在這個
         *   effect 後面，提前引用會在執行期炸掉（eslint 實測抓到）。
         */
        const clearable = records.filter(function (record) {
          return record.sourcePreview;
        }).length;
        setToast(
          "瀏覽器儲存空間已滿，本次變更沒有存檔。請先到「備份與還原」下載備份，再清理舊資料。" +
            (clearable
              ? /*
                 * ⚠️ 這裡也要把代價講出來，不可以只說「不影響已算好的數字」——
                 *   那句話是真的，但它會讓人以為沒有代價。
                 */
                `另外，到「車種轉向當量」可以清掉原始資料，省下約 ${Math.round((clearable * 8) / 1024 * 10) / 10} MB。已算好的數字不受影響，但「那幾筆未來要重算就必須重新匯入原始檔案」。`
              : ""),
        );
      })().finally(function () {
        if (saveTokenRef.current === token) setSavePending(false);
      });
    },
    [
      projects,
      activeProjectId,
      records,
      nameMap,
      pceByProject,
      pceScopesByProject,
      catalogByProject,
      mappingsByProject,
      formatMemories,
      /* 已確認的異常也要跟著存檔，少了它重新整理就全部復活。 */
      ackedIssues,
      surveyDateOverrides,
      showSurveyDate,
      reportTemplatesByProject,
      conclusionTemplatesByProject,
      reportTemplates,
      conclusionTemplates,
      recordRevisions,
      movementPresence,
      intersectionAliases,
      loaded,
    ],
  );

  /*
   * 存檔還在進行時關掉分頁會掉資料。
   *
   * localStorage 的寫入是同步的，關分頁前一定寫完了；IndexedDB 不是。
   * 這是這次搬遷唯一新增的風險，所以補上瀏覽器原生的離開確認。
   * 只在真的有未完成的寫入時才掛，平常不打擾使用者。
   */
  useEffect(
    function () {
      if (!savePending) return;
      const handler = function (event: BeforeUnloadEvent) {
        event.preventDefault();
        /* 舊瀏覽器要靠回傳值才會跳確認框。 */
        event.returnValue = "";
        return "";
      };
      window.addEventListener("beforeunload", handler);
      return function () {
        window.removeEventListener("beforeunload", handler);
      };
    },
    [savePending],
  );

  /*
   * 訊息長短差很多，顯示時間必須跟著變。
   *
   * 匯入失敗的說明現在是逐檔條列（哪個檔、為什麼、怎麼辦），動輒三四百字；
   * 舊版一律 2.8 秒就收掉，等於使用者只看到一團字閃過去——說明寫得再清楚
   * 也沒有用。這裡依字數延長（每字約 55 毫秒，上限 20 秒），並且長訊息
   * 讓使用者可以自己點掉，不必乾等。
   */
  /**
   * @param holdMs 想留久一點時指定（毫秒）。
   *   ⚠️ 只有「使用者一定要看到、但不必動手處理」的訊息才給長時間；
   *     要他動手的警告另外處理（那幾則刻意不自動收）。
   */
  const notify = function (message: string, holdMs?: number) {
    const token = toastTokenRef.current + 1;
    toastTokenRef.current = token;
    setToast(message);
    /*
     * 顯示時間依字數延長。匯入失敗的說明現在是逐檔條列，動輒三四百字；
     * 舊版一律 2.8 秒收掉，等於使用者只看到一團字閃過去，說明寫得再清楚
     * 也沒有用。長訊息也可以直接點掉，不必乾等。
     */
    const ms =
      holdMs ?? Math.min(20000, Math.max(2800, message.length * 55));
    setTimeout(function () {
      /* 序號不同代表後來已有新訊息；即使文字相同也不能代替它關閉。 */
      if (toastTokenRef.current === token) setToast("");
    }, ms);
  };
  const activeProject = projects.find(function (project) {
    return project.id === activeProjectId;
  });
  /* 目前計畫要匯出哪些分析項目；沒設定過就用預設組合。 */
  const activeReportItems = useMemo(
    function () {
      return normalizeReportItems(activeProject?.reportItems);
    },
    [activeProject],
  );
  function setActiveReportItems(next: ReportItemKey[]) {
    if (!activeProjectId) return;
    setProjects(function (all) {
      return all.map(function (project) {
        return project.id === activeProjectId
          ? { ...project, reportItems: next }
          : project;
      });
    });
  }
  function toggleReportItem(key: ReportItemKey) {
    setActiveReportItems(
      activeReportItems.includes(key)
        ? activeReportItems.filter(function (item) {
            return item !== key;
          })
        : REPORT_ITEMS.map(function (item) {
            return item.key;
          }).filter(function (item) {
            return item === key || activeReportItems.includes(item);
          }),
    );
  }
  const projectRecords = useMemo(
    function () {
      return records.filter(function (record) {
        return record.projectId === activeProjectId;
      });
    },
    [records, activeProjectId],
  );
  /*
   * ── 係數範圍可以選哪些季別、哪些路口 ──────────────────────
   *
   * ⚠️ 一律取自**這個計畫實際有資料的**那些。
   *   讓使用者對著不存在的季別或路口設定係數的話，那筆覆寫永遠不會命中，
   *   他卻會以為設定好了，然後回報「我設了怎麼沒有變」。
   */
  const scopeQuarterOptions = useMemo(
    function () {
      return Array.from(
        new Set(
          projectRecords.map(function (record) {
            return record.quarter;
          }),
        ),
      )
        .filter(Boolean)
        .sort()
        .reverse();
    },
    [projectRecords],
  );
  const scopeRoadOptions = useMemo(
    function () {
      const map = new Map<string, string>();
      for (const record of projectRecords) {
        const key = recordIntersectionKey(record);
        if (key && !map.has(key)) map.set(key, record.name || key);
      }
      return Array.from(map, function ([id, name]) {
        return { id, name };
      }).sort(function (a, b) {
        return a.name.localeCompare(b.name, "zh-Hant");
      });
    },
    [projectRecords],
  );
  const intersectionNameOf = function (key: string) {
    if (key === SCOPE_ANY) return "";
    return (
      scopeRoadOptions.find(function (road) {
        return road.id === key;
      })?.name || key
    );
  };
  const scopeRoadName = intersectionNameOf(scopeRoadId);
  /*
   * 兩個維度打架的格子。
   * ⚠️ 只是列出來，不改變任何計算——解析順位由 lib 決定，
   *   這裡只負責讓使用者看得見「為什麼是這個值」。
   */
  const scopeConflicts = useMemo(
    function () {
      return scopeConflictsIn(pceScopes);
    },
    [pceScopes],
  );

  /*
   * 切換範圍時，把表格換成**那一格目前生效的值**。
   *
   * ⚠️ 顯示「目前生效的」而不是「這一格自己的」，是刻意的：
   *   使用者切到 (115Q2, A路口) 看到的應該是那一格現在算出來的係數，
   *   才知道要從哪裡開始改。顯示空白或系統預設的話，
   *   他會以為那一格現在用的是那組值——而其實它是繼承來的。
   *   上方那一行「沿用上層設定／有自己的專屬係數」負責把差別講清楚。
   */
  useEffect(
    function () {
      if (scopeQuarter === SCOPE_ANY && scopeRoadId === SCOPE_ANY) {
        setScopeDraft(null);
        return;
      }
      const own = ownPceScope(pceScopes, scopeQuarter, scopeRoadId);
      setScopeDraft(
        structuredClone(
          own?.factors ||
            resolvePceFactors(pceScopes, pce, scopeQuarter, scopeRoadId),
        ),
      );
    },
    /*
     * ⚠️ 這個 disable 是**刻意**的，理由寫下來（2026-09-11 補）：
     *   少列的是 `pce`。列進去的話，使用者在「全季別 × 全路口」那一格
     *   打字改係數時，每打一個字都會觸發這個 effect 把草稿**重設回
     *   已儲存的值**，看起來就是「打了字又跳回去」。
     *   這個 effect 的職責只有一件：**切換範圍時**把草稿換成那一格的值。
     *
     *   ⚠️ 這一行絕對不可以拿去壓「算數字」的 useMemo／useCallback。
     *     那邊少一個相依的後果是「使用者按了套用、數字不會變、沒有錯誤」，
     *     而 disable 會讓 eslint 連吭都不吭一聲。
     *     全日交通量就有一個被這樣壓了很久才查出來的真 bug
     *     （computePeriodRows 少了 pcuScopes）。
     *     這一支目前沒有同類問題：pceScopes 只在匯入與重算兩個
     *     **事件處理函式**裡讀，不是在 memo 裡，不存在相依過期的問題。
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeQuarter, scopeRoadId, pceScopes],
  );

  /**
   * ── 用目前的歸類與係數，重算一批已匯入的資料 ──────────────────
   *
   * 使用者 2026-09-11：114Q2 匯入時忘了把聯結車併入特種車，事後想改卻改不動。
   * 「改完參數要能重新套用計算」——這一支就是那顆按鈕的本體。
   *
   * ⚠️ **完全不新增任何計算邏輯**。重算走的是與當初匯入一模一樣的兩支：
   *      configuredImportPreview()  ← 用新係數重挑尖峰
   *      recordFromPreview()        ← 重建整筆紀錄
   *   自己再寫一套「把某車種的量搬到另一車種」的話，那一套遲早會和匯入
   *   那一條分岔，而且只有自訂車種會不一樣——最不容易被發現的那種錯。
   *
   * ⚠️ 使用者在匯入之後做過的編輯**一定要留著**：路口名稱、支線名稱與角度、
   *   流向的轉向判定、資料別、版本號、核對狀態。重算只該換掉「算出來的數字」，
   *   不該把他改好的名稱與幾何打回原形。
   *
   * ⚠️ 舊資料沒有 sourcePreview（那是 v2.1.65 才開始存的），重算不了。
   *   這種一定要**講出來**，不可以按了沒反應——回傳值帶著 skipped 就是為此。
   */
  const recomputeRecords = function (targets: TrafficRecord[]) {
    const recomputable = targets.filter(function (record) {
      return Boolean(record.sourcePreview);
    });
    const skipped = targets.length - recomputable.length;
    if (!recomputable.length)
      return { changed: 0, skipped, recomputed: [] as TrafficRecord[] };
    const byId = new Map(
      recomputable.map(function (record) {
        return [record.id, record] as const;
      }),
    );
    const rebuilt = new Map<string, TrafficRecord>();
    byId.forEach(function (previous, id) {
      const preview = previous.sourcePreview as ImportPreview;
      const configured = configuredImportPreview(preview, pce, vehicleMappings);
      const fresh = recordFromPreview(
        configured,
        /*
         * ⚠️ 一定要用**這一筆自己的**計畫與季別，不是目前畫面上選的那一組。
         *   用目前選的話，重算「115Q2」時會把 114Q2 的資料也標成 115Q2——
         *   資料整個換季而且事後看不出來。
         */
        previous.projectId || activeProjectId,
        previous.quarter,
        pce,
        vehicleMappings,
        movementPresence,
        pceScopes,
        /*
         * ⚠️ 重算時用**這一筆已經定案的名字**（下面 fresh.name 也是接回它）。
         *   用 preview 裡的舊檔名會讓重算後查到另一把鑰匙，
         *   等於把使用者答過的裁決結果丟掉。
         */
        previous.name,
      );
      /* ── 把使用者匯入後改過的東西原樣接回來 ── */
      fresh.id = previous.id;
      fresh.intersectionId = previous.intersectionId;
      fresh.name = previous.name;
      fresh.station = previous.station;
      fresh.surveyType = previous.surveyType;
      fresh.sourceFiles = previous.sourceFiles;
      fresh.importedAt = previous.importedAt;
      fresh.review = previous.review;
      fresh.revision = Number(previous.revision || 1) + 1;
      fresh.pceVersion =
        "重新套用 " + new Date().toISOString();
      inheritRecordGeometry(fresh, previous);
      rebuilt.set(id, fresh);
    });
    return {
      changed: rebuilt.size,
      skipped,
      recomputed: Array.from(rebuilt.values()),
    };
  };

  /**
   * 這個計畫的資料裡**實際出現過**哪些車種。
   *
   * 使用者 2026-09-11 實測：他先把聯結車誤設成「獨立分析」匯入，發現後把
   * 整季刪掉、重新用正確設定（併入特種車）匯入，結果「車種轉向當量」表上
   * **大客車與聯結車都還在**，當量還是 1／1／1——他以為自己又設錯了。
   *
   * 成因：車種清單（vehicleCatalog／pce）是計畫層級、只增不減的，
   * 刪掉季度資料不會把它們一起清掉。
   */
  const vehiclesInUse = new Set(
    projectRecords.flatMap(function (record) {
      return recordVehicleIds(record);
    }),
  );
  /**
   * 沒有任何資料在用、也沒有被當成合併來源的車種。
   *
   * ⚠️ 「被當成合併來源」的不算孤兒：聯結車併入特種車之後，資料裡只會有
   *   特種車，但那條對應關係要留著，下一季匯入才會自動併入。
   *   把它清掉的話，使用者下次匯入又要重設一次。
   */
  const orphanVehicles = Object.keys(pce).filter(function (key) {
    if (ANALYSIS_VEHICLES.includes(key as (typeof ANALYSIS_VEHICLES)[number]))
      return false;
    if (vehiclesInUse.has(key)) return false;
    const target = vehicleMappings[key];
    return !target || target === key;
  });

  /** 有幾筆留著重算需要的逐格原始資料。 */
  const recomputableCount = projectRecords.filter(function (record) {
    return Boolean(record.sourcePreview);
  }).length;

  /** 把目前的歸類與係數重新套用到指定的那些紀錄上。 */
  const applyRecompute = function (
    targets: TrafficRecord[],
    scopeLabelText: string,
  ) {
    if (!targets.length) return notify("這個範圍目前沒有已匯入的資料。");
    const result = recomputeRecords(targets);
    if (!result.changed)
      return notify(
        `這 ${targets.length} 筆都是舊版匯入的，沒有留下重算需要的逐格原始資料，沒辦法重新套用。請重新匯入那幾季的檔案（會沿用原本的路口名稱與幾何設定）。`,
      );
    /* 重算會改變數字，和覆蓋匯入一樣要先建立還原點。 */
    const replaced = new Map(
      result.recomputed.map(function (record) {
        return [record.id, record] as const;
      }),
    );
    saveRevisions(
      targets.filter(function (record) {
        return replaced.has(record.id);
      }),
      "重新套用歸類與係數",
    );
    setRecords(function (previous) {
      return previous.map(function (record) {
        return replaced.get(record.id) || record;
      });
    });
    notify(
      `已用目前的歸類與係數重算「${scopeLabelText}」的 ${result.changed} 筆資料。` +
        (result.skipped
          ? `另有 ${result.skipped} 筆是舊版匯入的、沒有逐格原始資料，沒有被重算——那幾筆要重新匯入才會改變。`
          : "") +
        " ⚠️ 這些資料的 PCU 與尖峰時段都已重算，請重新確認報表。",
    );
  };

  /** 把目前表格上的係數寫成「這個範圍」的專屬設定。 */
  const applyPceScope = function () {
    if (!activeProjectId)
      return notify("係數是依計畫各自儲存的，請先建立或選擇一個計畫。");
    /*
     * ⚠️ 全季別 × 全路口＝計畫預設，就是原本那條路徑，不建立覆寫。
     *   這個分岔寫錯的後果是相反方向的災難：
     *   該寫覆寫卻寫了預設 → 只想改一段，結果全部都變了；
     *   該寫預設卻寫了覆寫 → 以為改了全部，其實只改了一格。
     *   兩種都不會有錯誤訊息。
     */
    if (scopeQuarter === SCOPE_ANY && scopeRoadId === SCOPE_ANY)
      return notify(
        "目前選的是「全季別 × 全路口」，上方表格改動本來就已經是計畫預設值，不需要另外套用。",
      );
    setPceScopes(
      upsertPceScope(pceScopes, {
        quarter: scopeQuarter,
        roadId: scopeRoadId,
        /* ⚠️ 寫的是**草稿**，不是計畫預設。 */
        factors: structuredClone(scopeDraft ?? pce),
      }),
    );
    notify(
      `已建立「${pceScopeLabel(quarterLabel(scopeQuarter), scopeRoadId, scopeRoadName, "全路口")}」的專屬係數。之後匯入這個範圍的資料會自動套用；已匯入的資料要按下方的「重新套用」才會重算。`,
    );
  };
  /** 刪掉一格覆寫＝那一格還原成計畫預設。 */
  const clearPceScope = function (quarter: string, roadId: string) {
    setPceScopes(removePceScope(pceScopes, quarter, roadId));
    notify(
      `「${pceScopeLabel(quarterLabel(quarter), roadId, intersectionNameOf(roadId), "全路口")}」已還原成計畫預設係數。已匯入資料的數字不變——要重算請重新匯入，或先建立新的範圍設定再按「重新套用」。`,
    );
  };
  /*
   * ══════════════════════════════════════════════════════════════
   *  ⚠️ 為什麼**沒有**「把新係數重新套用到已匯入資料」這顆按鈕
   * ══════════════════════════════════════════════════════════════
   *
   * 使用者的原話是「當量係數改變了，寫入新的係數並套用**然後重新計算**」，
   * 所以我本來做了那顆按鈕。做完之後查了一遍資料結構，發現**它做不對**，
   * 於是拿掉了——寧可少一個功能，也不要一個算到一半的功能。
   *
   * 原因：這支程式在匯入當下就把結果**算完存起來**了。
   *   ・`record.approaches[].movements[scope]` —— 各支線左／直／右的 PCU
   *   ・`record.routes[].volumes[scope].pcu` —— 每一條 OD 流向的 PCU
   *   ・`record.peaks` —— 尖峰挑在哪一小時（**用 PCU 挑的**）
   *
   * 而留下來的原始軌跡 `sourceTrace.intervals` 只有逐格的
   * `{ start, end, pcu, vehicles }` **合計**，**沒有**逐車種 × 逐轉向的
   * 原始車輛數。也就是說：換一組係數之後，這三樣東西**沒有辦法**
   * 從現有資料重新算出來。
   *
   * 只把 `pceUsed` 換掉會發生什麼事：讀快照的那幾個畫面（逐車種 PCU、
   * 轉向圖的單一車種）會變成新係數的值，但總量、OD 表與尖峰時段仍然是
   * 舊係數算出來的——**同一頁上的兩個數字互相矛盾，而且都沒有錯誤訊息**。
   * 那比「不能重算」糟糕得多。
   *
   * 正確的路徑是**重新匯入那個範圍的檔案**：程式本來就有重新匯入流程，
   * 而且會沿用同一個路口與幾何設定。畫面上直接把這件事寫清楚。
   *
   * ⚠️ 全日交通量**沒有**這個限制：它不存快照，PCU 一律即時重算，
   *   所以那一支建立覆寫之後畫面立刻就是新的數字。兩支的行為不同，
   *   是因為資料結構本來就不同，不是其中一支做錯。
   */

  const quarters = useMemo(
    function () {
      return Array.from(
        new Set(
          projectRecords.map(function (record) {
            return record.quarter;
          }),
        ),
      ).sort(compareQuarters);
    },
    [projectRecords],
  );
  /*
   * X-8：刪除季度那一格的選項。
   * ⚠️ 季度被刪掉（或換了計畫）之後要拉回合法值，否則會停在一個不存在的季度上，
   *   按下去什麼都刪不到，而畫面看起來一切正常。
   * ⚠️ 預設**最早一季**，不是最新一季：最新一季通常是剛匯入、正在看的那一季，
   *   把它當成刪除鈕的預設值太危險。
   */
  useEffect(
    function () {
      if (!quarters.length) {
        if (deleteQuarterKey) setDeleteQuarterKey("");
        return;
      }
      if (!deleteQuarterKey || !quarters.includes(deleteQuarterKey))
        setDeleteQuarterKey(quarters[0]);
    },
    [quarters, deleteQuarterKey],
  );
  useEffect(
    function () {
      if (!quarter || !quarters.includes(quarter))
        setQuarter(quarters.at(-1) || "");
    },
    [quarters, quarter],
  );
  /*
   * ⚠️ 起始季度預設是**最早一季**（不是跟著結束季度走）。理由見上面 quarterFrom
   *   宣告處的長註解：起＝迄現在代表「只有那一季」，拿它當預設等於一開機
   *   就把歷季趨勢圖壓成一個點。
   *
   *   清單裡沒有這一季（換計畫、刪季度）時要拉回來，
   *   不然會停在一個不存在的季度上，畫出空圖。
   *
   * ⚠️ 使用者主動改過之後**不再自動跟隨**——否則他每匯入一季，
   *   自己設好的區間就被擦掉一次。
   */
  useEffect(
    function () {
      if (!quarters.length) return;
      if (!quarterFromTouched) {
        const earliest = quarters[0] || "";
        if (quarterFrom !== earliest) setQuarterFrom(earliest);
        return;
      }
      if (!quarterFrom || !quarters.includes(quarterFrom))
        setQuarterFrom(quarters[0] || "");
    },
    [quarters, quarterFrom, quarter, quarterFromTouched],
  );
  /*
   * 主工具列目前的一整組條件。各圖要用的是 filtersFor(mainFilters, chartOverrides, 圖的 id)，
   * 不是直接讀這一份——直接讀就沒有「圖可以自己改」那一態了。
   */
  const mainFilters: MainFilters = useMemo(
    function () {
      return {
        ...DEFAULT_MAIN_FILTERS,
        quarterFrom: quarterFrom || quarter,
        quarterTo: quarter,
        intersections: mainIntersections,
        peak: peakChoice,
        peakRule,
        flowView: flowSummaryMode,
        day: dayChoice,
        vehicle,
        movement: movementChoice,
        display: displayMode,
      };
    },
    [
      quarterFrom,
      quarter,
      mainIntersections,
      peakChoice,
      peakRule,
      flowSummaryMode,
      dayChoice,
      vehicle,
      movementChoice,
      displayMode,
    ],
  );
  /** 某一張圖實際該用的條件（沒脫離時就是主工具列那一份）。 */
  const filtersOf = useCallback(
    (chartId: string) => filtersFor(mainFilters, chartOverrides, chartId),
    [mainFilters, chartOverrides],
  );
  /** 在某一張圖上改一個條件——只有那一張會變。 */
  const changeChartFilter = useCallback(
    function <K extends keyof MainFilters>(
      chartId: string,
      field: K,
      value: MainFilters[K],
    ) {
      setChartOverrides((previous) =>
        setChartFilter(previous, chartId, field, value),
      );
    },
    [],
  );
  const detachedCharts = useMemo(
    () => detachedIds(chartOverrides),
    [chartOverrides],
  );
  /*
   * ── L-2：浮動小卡要列的名稱 ────────────────────────────────
   *
   * ⚠️ 這一支的「脫離」是**以分頁為單位**（說明掛在 .content 上，一頁一份），
   *   所以清單列的是**分頁名稱**，點了就換到那一頁。
   *   名稱一律從 NAV 取——那是側欄用的同一份清單，改名只要改一個地方。
   *   ⚠️ 不要在這裡另外抄一份中文名：「同一件事寫在兩個地方就會漂移」。
   *
   * ⚠️ 對不到 NAV 的（例如日後新增一張圖卻忘了對應分頁）**不可以默默丟掉**，
   *   那會讓小卡列的數量與「回歸全部（N）」對不起來。
   *   對不到就原樣列出那個 id，看起來突兀正好提醒要補對應。
   */
  const detachedItems = useMemo(
    function () {
      const pageOf: Record<string, View> = {
        composition: "composition",
        diagram: "diagram",
        "geometry-card": "geometry",
        "inbound-flow": "inbound",
        "peaks-summary": "peaks",
        audit: "audit",
        advanced: "advanced",
        trend: "trend",
      };
      return detachedCharts.map(function (id) {
        const page = pageOf[id];
        const item = page ? NAV.find((entry) => entry.id === page) : undefined;
        return { id: page ?? id, label: item ? item.label : id };
      });
    },
    [detachedCharts],
  );
  /*
   * ── 每一張圖的 id ──────────────────────────────────────────────
   * 脫離／回歸都以這個字串為鍵，畫面上的 data-detached-chart 也是它，
   * 守門才點得到。⚠️ 不要用中文標題當 id：標題改名過好幾次。
   */
  const CHART_COMPOSITION = "composition";
  const CHART_DIAGRAM = "diagram";
  /*
   * ── 路口轉向圖自己的一組條件 ──────────────────────────────────
   *
   * ⚠️ 升級前，這一頁工具列上的「時段／顯示／車種／藍框流量顯示」
   *   動到的是**全站共用的狀態**：在這裡把時段切成下午，
   *   車種組成分析、轉向進階分析、歷季趨勢比較的數字全部跟著換，
   *   而那三頁上沒有任何字告訴使用者是誰換的（實測，2026-09-14）。
   *
   *   使用者 2026-09-14 三次指定的規則是相反的：
   *   「圖自己的篩選只影響自己，不會影響到其他圖表」。
   *   所以這四個條件改成走 chartOverrides——在這一頁動它們，
   *   只有這一張脫離，其餘各頁照舊跟著主工具列。
   *
   * ⚠️ 沒有人脫離時 filtersOf 回傳的就是主工具列那一份，
   *   所以預設狀態下這四個值與升級前**逐字相同**（基準逐格比對過）。
   */
  const diagramFilters = filtersOf(CHART_DIAGRAM);
  /*
   * 「上午＋下午並列」這一張畫不出來（一張圖一個路口一個時段），
   * 退回上午並在畫面上明說——見下面那一條 InapplicableNote。
   */
  const diagramPeak: ScopeKey =
    diagramFilters.peak === "AMPM" ? "AM" : diagramFilters.peak;
  const diagramDisplay = diagramFilters.display as DisplayMode;
  const diagramVehicle = diagramFilters.vehicle as VehicleKey;
  const diagramFlow = diagramFilters.flowView as FlowSummaryMode;
  /*
   * 「道路與流向管理」頁的交通量圖卡預覽也是一張圖，也有自己的
   * 「只看駛入／只看駛出」。升級前那三顆鈕改的是**全站共用**的
   * flowSummaryMode——在這一頁按「只看駛入」，路口轉向圖也跟著只剩駛入，
   * 而那一頁沒有任何字說是誰改的。這裡給它自己的一組。
   */
  const CHART_GEOMETRY = "geometry-card";
  const geometryFilters = filtersOf(CHART_GEOMETRY);
  const geometryPeak: ScopeKey =
    geometryFilters.peak === "AMPM" ? "AM" : geometryFilters.peak;
  const geometryFlow = geometryFilters.flowView as FlowSummaryMode;
  /*
   * ── 駛入／駛出各路口交通量：這一張自己的一組條件 ──────────────
   *
   * ⚠️ 實測（2026-09-14，probe-filter-matrix）升級前這一頁對
   *   「路口流量視角／車種／顯示數值」**完全沒有反應**，
   *   而且也沒有任何一句話說它不適用——使用者說的「有遺漏」就是這個。
   */
  const CHART_INBOUND = "inbound-flow";
  const inboundFilters = filtersOf(CHART_INBOUND);
  const inboundVehicle = inboundFilters.vehicle as VehicleKey;
  /*
   * ── 各路口尖峰彙總：這一張自己的一組條件 ──────────────────────
   *
   * ⚠️ 這一頁的表**同時列出三個尖峰**（上午／下午／全調查時段尖峰），
   *   所以「尖峰時段」對它不適用；但「路口流量視角／車種／轉向別」
   *   都算得出來，升級前那三個一個都沒接上（實測）。
   */
  const CHART_PEAKS = "peaks-summary";
  const peaksFilters = filtersOf(CHART_PEAKS);
  /*
   * ── 流量核對工作台 ────────────────────────────────────────── */
  const CHART_AUDIT = "audit";
  const auditFilters = filtersOf(CHART_AUDIT);
  /*
   * ── 轉向進階分析（OD 矩陣與支線流量平衡） ─────────────────── */
  const CHART_ADVANCED = "advanced";
  const advancedFilters = filtersOf(CHART_ADVANCED);
  /*
   * ── 歷季趨勢比較 ──────────────────────────────────────────── */
  const CHART_TREND = "trend";
  const trendFilters = filtersOf(CHART_TREND);
  /*
   * 車種組成分析要用的時段。平常跟著主工具列；在這一頁動了它，
   * 就只有這一張脫離（見上面 compositionScope 那一段被移除的理由）。
   * CompositionScope 少一個 FULL、多一個 SURVEY，兩邊指的是同一件事
   *（「全調查時段」），所以在這裡互換。
   */
  const compositionFilters = filtersOf(CHART_COMPOSITION);
  const compositionScope: CompositionScope =
    compositionFilters.peak === "FULL"
      ? "SURVEY"
      : compositionFilters.peak === "AMPM"
        ? "AM"
        : compositionFilters.peak;
  const setCompositionScope = useCallback(
    function (value: CompositionScope) {
      changeChartFilter(
        CHART_COMPOSITION,
        "peak",
        value === "SURVEY" ? "FULL" : value,
      );
    },
    [changeChartFilter],
  );
  /*
   * 主工具列的路口選單。
   *
   * ⚠️ 範圍是**整個季度區間**，不是只有結束季度那一季——
   *   使用者把區間拉開來看歷季趨勢時，選單卻只列得出最後一季有的路口，
   *   等於挑不到前幾季才有的那幾個。
   * ⚠️ 以**站號**分組，不可以用 recordIntersectionKey：
   *   後者會把同一交流道的南北向站併成一筆，選單會比表格少一站
   *  （這個坑「各路口尖峰彙總」的選單踩過，註解在下面那一段）。
   */
  const mainIntersectionOptions = useMemo(
    function (): [string, string][] {
      const from = quarterFrom || quarter;
      const to = quarter;
      const inRange = projectRecords.filter(function (record) {
        if (!from || !to) return true;
        return (
          compareQuarters(record.quarter, from) >= 0 &&
          compareQuarters(record.quarter, to) <= 0
        );
      });
      /*
       * ── X-23（使用者 2026-09-16，附圖）：一個路口只出現一次 ──────────
       *
       * 使用者原話：「路口顯示異常，明明只有N條路口，系統卻自己建立的站號
       *   反覆出現相同的調查點位」。
       *
       * 成因：這裡用 `record.station` 當鍵，而**站號是逐季的**
       *（T1-01、T2-01、T3-01… 是同一個路口在 5 個季度的站號），
       * 於是拉開季別區間之後，同一個路口在清單裡出現 5 次。
       * 使用者要選「中山北路－岡山路口」時得把 5 個都勾起來，
       * 而畫面上完全看不出要這樣做。
       *
       * ⚠️ 去重的依據**只能用現成的那一套** `recordIntersectionKey()`
       *   （名稱正規化＋別名鏈，路口名稱管理在用的同一份）。
       *   在這裡另外發明一套，兩邊對「這是不是同一個路口」就會給不同答案。
       * ⚠️ 選項的**值**仍然是站號（下游的篩選比對的是 record.station），
       *   所以同一個路口要把它在區間內的**每一個站號**都帶上，
       *   用 `|` 串起來；比對時拆開比。只帶第一個站號的話，
       *   使用者選了那個路口，別季的資料會被篩掉——那比重複出現更糟。
       * ⚠️ 標籤只寫路口名稱，不寫站號：站號有好幾個，寫哪一個都不對。
       */
      /*
       * ⚠️ X-36：季數要**真的數季度**，不可以拿站號數充當。
       *
       *   舊版寫的是 `stations.length` ——那是站號數。同一季有兩個站號時
       *  （例如同一個交流道的北向站與南向站）標籤就寫成「（2 季）」，
       *   而那兩站其實都在同一季。實測測資三筆全在 115Q1，照樣寫 2 季。
       */
      const byIntersection = new Map<
        string,
        { names: string[]; stations: string[]; quarters: Set<string> }
      >();
      for (const record of inRange) {
        const key = recordIntersectionKey(record);
        const hit = byIntersection.get(key);
        if (!hit) {
          byIntersection.set(key, {
            names: [record.name],
            stations: [record.station],
            quarters: new Set([record.quarter]),
          });
          continue;
        }
        if (!hit.stations.includes(record.station)) hit.stations.push(record.station);
        if (!hit.names.includes(record.name)) hit.names.push(record.name);
        hit.quarters.add(record.quarter);
      }
      return [...byIntersection.values()].map(function (entry) {
        const stations = [...entry.stations].sort();
        /*
         * ⚠️ 名稱要把**這一項底下全部不同的寫法**列出來，不可以只取第一筆。
         *
         *   並存站號（同一個路口的北向站與南向站）合併成一項之後，
         *   標籤若只寫「示範交流道（北向）」，使用者會以為南向那一站不見了。
         * ⚠️ 先用 displayIntersectionName 去掉「（平日）」「（假日）」——
         *   那是資料別，系統另有欄位承載；留著會讓同一條路段的標籤
         *   寫成「A路段（平日）（2 季）」，看起來像假日那一筆消失了。
         */
        const names = [
          ...new Set(entry.names.map(displayIntersectionName)),
        ];
        const nameText = names.join("、");
        return [
          stations.join("|"),
          entry.quarters.size > 1
            ? `${nameText}（${entry.quarters.size} 季）`
            : /*
               * 只有一季時寫站號；同一季有兩個站號時寫哪一個都不對，
               * 所以站號也全部列出來。
               */
              `${stations.join("、")} · ${nameText}`,
        ] as [string, string];
      });
    },
    [projectRecords, quarterFrom, quarter],
  );
  /**
   * 主工具列的「路口」選到的，包不包含這一筆？
   *
   * ⚠️ X-23 起每一個選項的值是**那個路口在區間內的全部站號**，用 `|` 串起來
   *   （一個路口每一季各有一個站號）。所以比對時要拆開比，
   *   不可以再用 `includes(record.station)` ——那樣只有剛好等於整串的
   *   單站路口才篩得到，其餘全部被篩掉，而且畫面上不會有任何錯誤。
   * ⚠️ 空陣列＝全部路口（不是全部排除），與主工具列同一個約定。
   */
  const mainIntersectionStations = useMemo(
    function () {
      return new Set(
        mainFilters.intersections.flatMap(function (value) {
          return value.split("|");
        }),
      );
    },
    [mainFilters.intersections],
  );
  /**
   * 分析用的「車種」下拉——列的是**歸類後的車種類型**。
   *
   * ══ 2026-09-15 修正：這裡原本列的是歸類**前**的原始車種，那會讓表格顯示 0 ══
   *
   * 使用者定義（原話）：「基本 4 個原車種類型，就是機車、小型車、大型車、
   *   特種車，剩下就是看使用者是要把新車種自動歸類成 1 個新類型，
   *   **或是要併入 4 個原車種類型裡**……大型車類型就是指原車種類型的大型車，
   *   以及任何把新車種併入到大型車裡面的車種。」
   *
   * ⚠️ 舊版寫的是 `Object.entries(vehicleCatalog)`。`vehicleCatalog` 是
   *   **計畫層級、只增不減**的原始車種目錄（歸類設定畫面要用它，那是對的）。
   *   但紀錄裡的車種在**匯入當下就已經歸類完了**
   *  （`recordFromPreview()` 用 `vehicleMappings[column.vehicle] || column.vehicle`），
   *   所以把「聯結車」併入特種車之後：
   *     ・下拉裡**仍然列得出「聯結車」**——一個使用者已經宣告不再獨立存在的類型
   *     ・選下去之後程式拿 `聯結車` 這個 key 去查紀錄，紀錄裡根本沒有這個 key
   *     ・整張表、整張圖**安靜地顯示 0**，沒有任何錯誤訊息
   *   而 0 是會被抄進報告的。
   *
   * ⚠️ 這一顆下拉同時餵給**四個**地方（主工具列、各路口駛入／駛出流量、
   *   各路口尖峰彙總、轉向進階分析），所以那四處一起錯、也一起修。
   *   對照組：歷季趨勢的車種下拉本來就走 `recordVehicleIdList`（歸類後），
   *   是對的——同一支程式有兩套做法，才會只有部分畫面出錯。
   *
   * ⚠️ 需要**原始車種**的地方只有兩個，它們不走這一支：
   *   歸類設定畫面（要問的正是「每一個原始車種歸到哪裡」）與匯入預覽。
   */
  const mainVehicleOptions = useMemo(
    function (): [string, string][] {
      const found = new Map<string, string>();
      for (const record of projectRecords)
        for (const id of recordVehicleIds(record))
          if (!found.has(id)) found.set(id, vehicleLabel(record, id));
      /*
       * ⚠️ 資料還沒匯進來時（found 是空的）退回原始目錄，
       *   否則新建計畫的下拉會是空的，看起來像壞掉。
       *   有資料之後一律以資料為準。
       */
      if (!found.size) return Object.entries(vehicleCatalog) as [string, string][];
      return [...found.entries()];
    },
    [projectRecords, vehicleCatalog],
  );
  /*
   * ⚠️ 把車種代號翻成畫面上的名字——**與下拉用的是同一份**。
   *
   *   `mainFilters.vehicle` 存的是內部代號（`custom:電動機車`、`motorcycle`…），
   *   而脫離的圖上那一行「主工具列：…」會把它印出來。
   *   不翻譯的話使用者看到的是一串他從來沒在畫面上見過的字（N-5）。
   *
   * ⚠️ 一定要沿用 mainVehicleOptions，不可以另外查一次目錄：
   *   目錄是**計畫層級、只增不減**的原始車種表，會列出已經被併走的車種，
   *   兩邊各查各的遲早給出不同的名字。
   */
  const showVehicle = useCallback(
    function (id: string) {
      const hit = mainVehicleOptions.find(function (entry) {
        return entry[0] === id;
      });
      return hit ? hit[1] : id.replace(/^custom:/, "");
    },
    [mainVehicleOptions],
  );
  /*
   * 每一個季別在畫面上要顯示成什麼。切到「調查月份」時，取那一季底下所有
   * 紀錄的調查日期，列出實際做調查的月份（例：「115年2、3月」）。
   * 那一季完全沒有日期就原樣顯示季別——不編、也不留空白。
   */
  const quarterLabels = useMemo(
    function () {
      const dates: Record<string, string[]> = {};
      for (const record of projectRecords)
        /* ⚠️ 走 effectiveRecordDate：使用者指定過哪一個才對，這裡要跟著走。 */
        if (effectiveRecordDate(record))
          dates[record.quarter] = [
            ...(dates[record.quarter] || []),
            effectiveRecordDate(record),
          ];
      const labels: Record<string, string> = {};
      for (const key of quarters)
        labels[key] = periodDisplayLabel(
          key,
          dates[key] || [],
          periodDisplay,
          yearStyle,
        );
      return { labels, anyDate: Object.keys(dates).length > 0 };
    },
    /* ⚠️ 使用者指定了哪一個才是調查日期之後，這一格要跟著重算。 */
    [projectRecords, quarters, periodDisplay, yearStyle, effectiveRecordDate],
  );
  /*
   * ⚠️ 包成 useCallback 不是為了效能：下面的 applyMainToConclusion 依賴它，
   *   每次 render 都換一個新函式的話，那個 useCallback 的相依每次都變，
   *   等於 memo 沒有作用，而且 lint 會要求貼 eslint-disable——
   *   那正是我們說好不要的貼紙。
   */
  const quarterLabel = useCallback(
    function (value: string) {
      return quarterLabels.labels[value] || value;
    },
    [quarterLabels],
  );
  /*
   * ── 「套用主工具列目前的條件」（結論草稿產生器） ────────────────
   *
   * 使用者 2026-09-14：結論草稿與報表**維持獨立**，另加這一顆。
   *
   * ⚠️ 三件事一定要做對，否則這一顆比沒有還糟：
   *
   *   (1) 路口要**換算**。主工具列存的是**站號**（S01-09N），
   *     結論條件存的是 recordIntersectionKey（把同一交流道的南北向併成一筆）。
   *     直接塞站號進去，條件會篩出 0 筆，而畫面上看起來條件是設好的。
   *
   *   (2) 「全調查時段」不是結論的尖峰選項（它只有上午／下午／全日尖峰）。
   *     不可以默默塞一個近似值——回傳的說明文字要點名這一項沒有套進去。
   *
   *   (3) 要**說出套用了什麼**。默默改掉使用者設好的一整組條件，
   *     他會以為是自己剛才點錯了。
   */
  /*
   * ── 結論草稿要看的紀錄（2026-09-15 補上轉向別與車種）─────────────
   *
   * 舊版直接把 projectRecords 交給草稿，於是主工具列有的「轉向別」與
   * 「車種」兩個條件，在結論草稿裡**完全無法出題**。
   *
   * ⚠️ 兩支轉換都是既有的純函式（涵蓋 AM／PM／DAY／FULL 四個時段），
   *   草稿本身不重算任何交通量——數字只能有一個來源。
   * ⚠️ 兩者都是 "all" 時**回原本那個陣列**（同一個參考），
   *   下游的 memo 完全不會失效，改版當天一個數字都不會變。
   * ⚠️ 順序與 viewRecord 一致：先轉向別、再車種。
   *   反過來會變成「先把別的車種歸零、再依剩下的量挑轉向」，
   *   那是另一回事。
   */
  const conclusionRecords = useMemo(
    function () {
      const movement = conclusionCondition.movement || "all";
      const vehicle = conclusionCondition.vehicle || "all";
      if (movement === "all" && vehicle === "all") return projectRecords;
      return projectRecords.map(function (record) {
        const byMovement = recordWithMovementFilter(record, movement);
        return vehicle === "all"
          ? byMovement
          : recordWithVehicleFilter(byMovement, vehicle);
      });
    },
    [projectRecords, conclusionCondition.movement, conclusionCondition.vehicle],
  );
  const applyMainToConclusion = useCallback(
    function (): string {
      const from = mainFilters.quarterFrom;
      const to = mainFilters.quarterTo;
      const scope: ConclusionScope =
        from && to && from !== to
          ? { kind: "range", from, to }
          : { kind: "quarter", quarter: to || from };
      /* (1) 站號 → recordIntersectionKey。 */
      const keys = new Set<string>();
      for (const record of projectRecords)
        if (mainIntersectionStations.has(record.station))
          keys.add(recordIntersectionKey(record));
      const surveyTypes =
        mainFilters.day === "weekday"
          ? ["平日"]
          : mainFilters.day === "holiday"
            ? ["假日"]
            : [];
      /*
       * ⚠️ 主工具列的「時段」共有五種選法，這張表**每一種都要有**。
       *   漏掉哪一種，「套用主工具列」就會對那一種靜靜地不動作
       *   （`peaks || conclusionCondition.peaks` 會保留舊值），
       *   而畫面上還是會顯示「已套用」。FULL 是 v2.1.82 補上的——
       *   在那之前使用者把主工具列切到「全調查時段」再套用，
       *   草稿的時段完全不會變。
       */
      const peakMap: Record<string, ConclusionScopeKey[]> = {
        AM: ["AM"],
        PM: ["PM"],
        DAY: ["DAY"],
        FULL: ["FULL"],
        AMPM: ["AM", "PM"],
      };
      const peaks = peakMap[mainFilters.peak];
      setConclusionCondition({
        ...conclusionCondition,
        scope,
        /* ⚠️ 2026-09-25：peakMap 的鍵涵蓋 PeakChoice 的全部五個值，
           所以 peaks 恆為真值，舊的 `|| conclusionCondition.peaks`
           是永不執行的死分支（理由詳見下面 return 前的說明）。 */
        peaks,
        intersectionKeys: [...keys],
        surveyTypes,
        /* 轉向別與車種現在**是**結論草稿的條件（2026-09-15 補），一併帶過來。 */
        movement: mainFilters.movement,
        vehicle: mainFilters.vehicle,
        /* 尖峰時段判定方式同理（2026-09-23 補）。 */
        peakRule: mainFilters.peakRule === "direction" ? "direction" : "point",
      });
      /* (3) 說出套用了什麼，以及(2)沒套進去的那一項。 */
      const parts = [
        scope.kind === "range"
          ? `季度 ${quarterLabel(from)}～${quarterLabel(to)}`
          : `季度 ${quarterLabel(to || from)}`,
        keys.size ? `路口 ${keys.size} 個` : "全部路口",
        surveyTypes.length ? `資料別 ${surveyTypes.join("、")}` : "全部資料別",
        peaks ? `時段 ${peaks.join("、")}` : null,
        `轉向別 ${MOVEMENT_CHOICE_LABELS[mainFilters.movement]}`,
        `車種 ${mainFilters.vehicle === "all" ? "全部車種" : showVehicle(mainFilters.vehicle)}`,
        `尖峰時段判定方式 ${
          mainFilters.peakRule === "direction"
            ? "各方向各自認定自己的尖峰"
            : "整個調查點同一時段"
        }`,
      ].filter(Boolean);
      /*
       * ⚠️ 沒套進去的一定要點名。
       *
       * ⚠️ 2026-09-23：「尖峰時段判定方式」**現在套得進去了**。
       *   舊註解寫著草稿做不到，理由是「一筆紀錄裝不下三份」——那個判斷
       *   是錯的：`peaks` 本來就按時段分開存，每一個時段可以各自吃自己
       *   那一份重挑過的紀錄。現在它是結論草稿自己的條件，這裡跟著套，
       *   不再列為「沒套進去」。
       *
       * ⚠️ 2026-09-25：拿掉 `skipped` 這個**死分支＋內容相反的殘留提示**。
       *   `peakMap` 的鍵剛好是 AM/PM/DAY/FULL/AMPM 五個，而
       *   `mainFilters.peak` 的型別 `PeakChoice = ScopeKey | "AMPM"`
       *  （`ScopeKey = PeakKey | "FULL"`）就是那五個，所以
       *   `peakMap[mainFilters.peak]` 恆為真值 → `skipped` 恆為空字串，
       *   那一行提示一次都不會顯示。
       *   而它要印的那句話本身也已經是錯的：「『全調查時段』不是結論草稿的
       *   時段選項」——FULL 明確**是**結論草稿的時段選項（peakMap 有它、
       *   lib/conclusion.ts 有 PEAK_LABEL.FULL、也有 peaks.includes("FULL")）。
       *   留著等於埋一句錯的話，等某天型別放寬就會印出來。
       *   `peaks || conclusionCondition.peaks` 那個 fallback 一併簡化掉。
       */
      return "已套用主工具列：" + parts.join("、") + "。";
    },
    [
      mainFilters,
      mainIntersectionStations,
      projectRecords,
      conclusionCondition,
      quarterLabel,
      showVehicle,
    ],
  );
  /*
   * 季度字串在畫面與匯出檔上要顯示成什麼樣子。
   *
   * ⚠️ 必須**同時**套上兩層：年份寫法（民國／西元）與期別寫法（季別／調查月份）。
   *
   * 使用者 2026-09-13（在交通服務水準上發現，並指定三支都要查）：
   *   「期別顯示調查月份 和西元年，但這裡的資料**只有成功變成西元年，
   *     沒有變成調查月份**。」「三份程式都有，確認都有正常運作。」
   *
   * 舊版這一支只呼叫 quarterInYearStyle（**只換年份**），而畫面上五十幾處
   * 顯示季度的地方走的是它——年份會換、期別永遠不換。
   * 按鈕上寫著「調查月份」，欄位給的卻是季別，**畫面在說謊**。
   *
   * ⚠️ 定義位置從原本的第 5290 行搬到這裡，因為它要讀 quarterLabels。
   *   已確認原位置與這裡之間沒有任何呼叫端（搬動不改變任何行為）。
   * ⚠️ 仍然包 useCallback：好幾個 useMemo（轉向圖 SVG、幾何示意圖）用到它，
   *   每次 render 換一個新函式會讓那些 memo 等於沒有效果。
   *   相依要**同時**有 yearStyle 與 quarterLabels——少一個就會停在舊文字。
   */
  const showQuarter = useCallback(
    function (value: string) {
      /*
       * 認得的季度才有月份可查；不在清單裡的（例如別的計畫的季度）
       * 退回只換年份，不可以原樣吐回民國年。
       */
      return quarterLabels.labels[value] ?? quarterInYearStyle(value, yearStyle);
    },
    [quarterLabels, yearStyle],
  );
  const anySurveyDate = quarterLabels.anyDate;
  const allQuarterKeys = useMemo(
    function () {
      return Array.from(
        new Set(
          records.map(function (record) {
            return record.quarter;
          }),
        ),
      ).sort(compareQuarters);
    },
    [records],
  );
  useEffect(
    function () {
      setBatchQuarterKeys(function (value) {
        const valid = value.filter(function (item) {
          return allQuarterKeys.includes(item);
        });
        return valid.length ? valid : allQuarterKeys;
      });
    },
    [allQuarterKeys],
  );
  useEffect(
    function () {
      setReportStartQuarter(function (value) {
        return quarters.includes(value) ? value : quarters[0] || "";
      });
      setReportEndQuarter(function (value) {
        return quarters.includes(value) ? value : quarters.at(-1) || "";
      });
    },
    [quarters],
  );
  useEffect(
    function () {
      setBatchProjectIds(function (value) {
        const valid = value.filter(function (id) {
          return projects.some(function (project) {
            return project.id === id;
          });
        });
        return valid.length ? valid : activeProjectId ? [activeProjectId] : [];
      });
    },
    [projects, activeProjectId],
  );
  /*
   * ── 這一季實際要看的那幾筆 ────────────────────────────────────
   *
   * ⚠️ 主工具列的「路口」與「資料別」在這裡就篩掉，下游每一頁自然跟著走——
   *   在每一頁各自再篩一次的話，遲早有一頁忘了篩，而那一頁的數字會和
   *   旁邊那一頁對不起來（升級前「時段」就是這樣只有四頁跟著走）。
   *
   * ⚠️ 預設是「全部路口・全部資料別」，兩者都不篩，
   *   所以升級當天的數字一個都不會變（baseline 逐格比對過）。
   *
   * ⚠️ 篩到一筆都不剩時**不可以靜靜變成空白**——各頁要看得出是
   *   「篩掉了」而不是「沒有資料」。那一句由各頁自己掛（見 InapplicableNote）。
   */
  /*
   * ⚠️ 包成 useMemo 不是為了效能，是為了**讓相依關係說得出口**：
   *   下面 currentView 要依賴它，而每次 render 都產生新陣列的話，
   *   currentView 就得靠 eslint-disable 來閉嘴——那正是我們說好不要的貼紙。
   */
  const current = useMemo(
    function () {
      return projectRecords.filter(function (record) {
        if (record.quarter !== quarter) return false;
        if (
          mainFilters.intersections.length &&
          !mainIntersectionStations.has(record.station)
        )
          return false;
        if (mainFilters.day === "weekday" && record.surveyType !== "平日")
          return false;
        if (mainFilters.day === "holiday" && record.surveyType !== "假日")
          return false;
        return true;
      });
    },
    [projectRecords, quarter, mainFilters.intersections, mainIntersectionStations, mainFilters.day],
  );
  /**
   * 這一季畫面上有幾種資料別（X-35）。
   *
   * 「各路口車種組成」表用它決定要不要多一欄「資料別」：
   * 同一個站號的平日與假日是**兩列**，沒有那一欄就兩列長得一模一樣；
   * 但只有一種資料別時多那一欄是噪音。
   */
  const compositionDayTypes = [
    ...new Set(
      current.map(function (record) {
        return record.surveyType;
      }),
    ),
  ];
  /** 沒篩之前這一季有幾筆——拿來分辨「被篩掉了」與「本來就沒有」。 */
  const currentBeforeFilter = projectRecords.filter(function (record) {
    return record.quarter === quarter;
  });

  /*
   * ══════════════════════════════════════════════════════════════════
   *  X-83：「轉向進階分析」是一季 × 一個路口的頁面
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-17 問「多選調查點時，尖峰形狀那兩張圖是加總還是平均」。
   * 兩者都不是——`current` 已經先濾掉別季（record.quarter !== quarter），
   * `selected` 再挑一個路口與一種資料別。整頁本來就是單筆。
   *
   * 這兩個數字只用來**判斷要不要出現提醒**：主工具列選了不只一季或不只一個
   * 路口時，畫面要講明「這裡只畫其中一個」，否則使用者會以為圖把全部都算進去了。
   *
   * ⚠️ 數的是**主工具列篩完之後畫面上真的有的**，不是主工具列的勾選陣列——
   *   勾了三個但其中兩個這一季沒有資料時，說「選了 3 個」是謊報。
   */
  const currentIntersectionCount = new Set(
    current.map(function (record) {
      return recordIntersectionKey(record);
    }),
  ).size;
  const mainQuarterCount = (function () {
    if (!quarterFrom || !quarter) return 1;
    return (
      projectRecords
        .map(function (record) {
          return record.quarter;
        })
        .filter(function (q, index, all) {
          return (
            all.indexOf(q) === index &&
            compareQuarters(q, quarterFrom) >= 0 &&
            compareQuarters(q, quarter) <= 0
          );
        }).length || 1
    );
  })();

  /*
   * ── 尖峰時段判定方式：各方向各自認定 ──────────────────────────
   *
   * 使用者 2026-09-14 指定的第二種判定方式。兩種算出來的數字**本來就不同**
   *（實測差距可以到 50 倍，見 tests/approach-peak.test.mjs），
   * 所以不是換個標籤，是真的換一套數字。
   *
   * ⚠️ 「整個調查點同一時段」＝升級前的行為，這裡**原封不動回傳原紀錄**。
   *   預設就是它，所以升級當天一個數字都不會變（baseline 逐格比對過）。
   *
   * ⚠️ 算不出來的紀錄（v2.1.67 以前匯入、沒有 sourceIntervals；
   *   或格距組不成整小時）**不可以偷偷沿用整路口的視窗**——
   *   那會讓同一張表裡有些數字是「自己的尖峰」、有些是「整路口的尖峰」，
   *   而畫面上只寫著一種判定方式。這裡把它們列出來，由畫面明講。
   */
  /*
   * ⚠️ 要**依時段各算一份**，不可以只算主工具列那一個時段。
   *
   *   「各方向各自認定」是在**某一個時段範圍內**替每一條支線挑它自己最忙的
   *   一小時。範圍換了（上午→下午），挑出來的視窗就換了。
   *   第一版只算主工具列的 peak 一份，於是一張脫離成「下午」的圖
   *   會拿**上午**範圍挑出來的視窗去算下午的數字——畫面上寫著下午，
   *   數字卻是上午挑的窗。這種錯不會有任何症狀，只會安靜地錯。
   *
   *   所以這裡回傳的是一個**取用函式**，內部按時段快取；
   *   每一張圖拿自己的時段去要自己那一份。
   */
  const DIRECTION_PEAK_SCOPES: ScopeKey[] = ["AM", "PM", "DAY", "FULL"];
  const directionPeakMaps = useMemo(
    function () {
      /*
       * ⚠️ 2026-09-25：`unsupported` 必須分成兩種，原因完全不同。
       *
       *   notApplicable ＝這個時段**本來就沒有尖峰視窗可挑**（只有 FULL：
       *     全調查時段是一段累計量，recordWithApproachPeaks 依設計回 null）。
       *     這不是資料的問題，而且那個時段的量**可以相加**。
       *   unsupported   ＝這一筆**真的缺逐格資料**（或格距組不成整小時）。
       *
       * 混成一個之後，勾「全調查時段」＋「各方向各自認定」時橫幅會把
       * **全部**調查點列成「這些資料匯入時還沒有保留各支線的逐格資料，
       * 要用這個判定方式請重新匯入原始檔」——原因是假的，那些檔案有完整
       * 逐格資料。使用者會照指示把整個計畫重新匯入一次（正是
       * lib/traffic.ts 記載過的那個痛），而重匯完訊息一字不變。
       */
      const out = new Map<
        string,
        {
          map: Map<string, TrafficRecord>;
          unsupported: string[];
          /** 這個時段本來就不套用這個判定方式（只有全調查時段）。 */
          notApplicable: boolean;
          windows: Map<
            string,
            Record<string, { start: number; end: number } | null>
          >;
        }
      >();
      /*
       * ⚠️ 2026-09-23：**結論草稿也可以選這個判定方式了**，所以觸發條件
       *   不再只看主工具列。兩處都沒選時這一份仍然是空的，
       *   `recordWithApproachPeaks` 一次都不會跑——效能與改版前相同。
       */
      if (
        mainFilters.peakRule !== "direction" &&
        conclusionCondition.peakRule !== "direction"
      )
        return out;
      for (const scope of DIRECTION_PEAK_SCOPES) {
        const map = new Map<string, TrafficRecord>();
        const windows = new Map<
          string,
          Record<string, { start: number; end: number } | null>
        >();
        const unsupported: string[] = [];
        /*
         * 全調查時段：recordWithApproachPeaks 依設計一律回 null，
         * 所以不要把每一筆都記成「算不出來」——那是時段的性質，不是資料的問題。
         */
        const notApplicable = scope === "FULL";
        if (!notApplicable)
          for (const record of projectRecords) {
            const result = recordWithApproachPeaks(record, scope);
            if (result) {
              map.set(record.id, result.record);
              windows.set(record.id, result.windows);
            } else unsupported.push(record.station || record.name);
          }
        out.set(scope, {
          map,
          unsupported: [...new Set(unsupported)],
          notApplicable,
          windows,
        });
      }
      return out;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectRecords, mainFilters.peakRule, conclusionCondition.peakRule],
  );
  /*
   * 判定方式是「整個調查點同一時段」時，這一份是空的——
   * 取用函式回傳空集合，viewRecord 就原封不動回傳原紀錄（升級前的行為）。
   */
  const EMPTY_DIRECTION_PEAK = useMemo(
    function () {
      return {
        map: new Map<string, TrafficRecord>(),
        unsupported: [] as string[],
        notApplicable: false,
        windows: new Map<
          string,
          Record<string, { start: number; end: number } | null>
        >(),
      };
    },
    [],
  );
  const directionPeakFor = useCallback(
    function (scope: ScopeKey) {
      return directionPeakMaps.get(scope) || EMPTY_DIRECTION_PEAK;
    },
    [directionPeakMaps, EMPTY_DIRECTION_PEAK],
  );
  const directionPeak = directionPeakFor(peak);
  /*
   * 結論草稿要用的「這一個時段那一份重挑過的紀錄」。
   *
   * ⚠️ 一定要是**穩定的參考**（useCallback），不可以在 JSX 裡寫行內箭頭函式。
   *   ConclusionStudio 裡是 `useMemo(() => toConclusionRecords(records, fn),
   *   [records, fn])`——行內函式每一次 render 都是新的，那個 memo 會每次
   *   重算整份草稿資料（含逐筆 inboundAnalysisRows）。使用者 2026-09-23：
   *   「程式性能上不要有 Lag 情況發生」。
   * ⚠️ 條件是「整個調查點同一時段」（預設）時回 undefined，
   *   toConclusionRecords 走原路，輸出與改版前逐字相同。
   */
  const conclusionPeakRuleRecordFor = useMemo(
    function () {
      if (conclusionCondition.peakRule !== "direction") return undefined;
      return function (scope: ScopeKey, record: TrafficRecord) {
        const { map, windows } = directionPeakFor(scope);
        const rewritten = map.get(record.id);
        const own = windows.get(record.id);
        return rewritten && own ? { record: rewritten, windows: own } : null;
      };
    },
    [conclusionCondition.peakRule, directionPeakFor],
  );
  /**
   * 顯示用的紀錄。判定方式是「整個調查點同一時段」時就是原紀錄本身
   *（同一個物件參考，不是複製品——這樣既有的 memo 都不會失效）。
   *
   * ⚠️ **只用在顯示**。編輯（改支線名稱、角度、當量）一律走原紀錄，
   *   不然使用者改的是一份複製品，存下去會不見。
   */
  /*
   * ⚠️ 一定要吃得下 null。
   *
   *   一個計畫都還沒建立、或這一季一筆資料都沒有時，selected 是 null，
   *   而好幾個 memo 不管在哪一頁都會先算一次。第一版沒有防這個，
   *   e2e-nav-zone（它刻意不灌種子資料）立刻紅字：
   *   「Cannot read properties of null (reading 'id')」——整頁白掉。
   *   守門抓到的，不是我事後想到的。
   */
  const viewRecord = useCallback(
    function <T extends TrafficRecord | null | undefined>(record: T): T {
      if (!record) return record;
      const byPeakRule = directionPeak.map.get(record.id) || record;
      /*
       * ⚠️ 轉向別篩選接在判定方式**後面**。
       *   順序反過來（先篩轉向再挑尖峰）會變成「只看左轉的話，
       *   尖峰小時要依左轉的量重新挑」——那是另一回事，
       *   使用者要的是「這個尖峰小時裡，左轉有多少」。
       */
      return recordWithMovementFilter(byPeakRule, mainFilters.movement) as T;
    },
    [directionPeak, mainFilters.movement],
  );
  /**
   * 「不吃轉向別」的那幾張圖要用這一份（仍然吃尖峰判定方式）。
   *
   * ⚠️ 這不是偷懶的例外，是**說到做到**：OD 矩陣與支線流量平衡上寫著
   *   「不適用轉向別篩選，目前仍以全部轉向計算」，那就真的要用全部轉向算。
   *   如果照樣套用篩選，畫面上那句話就是假的——那比沒有那句話更糟。
   */
  /**
   * ══════════════════════════════════════════════════════════════════
   *  X-51：保留全部轉向，但依**指定的時段**套「各方向各自認定」
   * ══════════════════════════════════════════════════════════════════
   *
   * 舊版這裡有一支 `viewRecordAllMovements`，用的是 `directionPeak`，
   * 而 `directionPeak = directionPeakFor(peak)` 吃的是**主工具列**的時段。
   *
   * 問題出在脫離的圖：`recordWithApproachPeaks(record, scope)` 只改寫
   * `movements[scope]` 與 `routes[].volumes[scope]` 這**一個**時段，
   * 其餘時段原封不動。所以轉向進階分析脫離成「下午尖峰」之後：
   *   ・拿到的是照「上午」改寫過的紀錄
   *   ・讀的卻是 movements["PM"]——那一份**沒有**被改寫
   *   → 判定方式寫著「各方向各自認定」，數字其實是「整個調查點同一時段」。
   *     畫面上沒有任何症狀，守恆差值也照樣算得出來。
   *
   * 所以脫離中的圖要用**自己那個時段**去取對應的改寫結果。
   * （`viewRecordFor` 做的是同一件事，但它會順手套轉向別篩選；
   *   轉向進階分析刻意不套轉向別，所以另開這一支。）
   */
  const viewRecordAllMovementsFor = useCallback(
    function <T extends TrafficRecord | null | undefined>(
      record: T,
      scope: ScopeKey,
    ): T {
      if (!record) return record;
      return (directionPeakFor(scope).map.get(record.id) || record) as T;
    },
    [directionPeakFor],
  );
  /**
   * 脫離中的圖要用自己那一組條件改寫紀錄（自己的時段、自己的轉向別）。
   *
   * ⚠️ 不可以用上面的 viewRecord：它吃的是**主工具列**的時段與轉向別。
   *   一張脫離成「下午」的圖套上主工具列的上午視窗，畫面寫下午、
   *   數字是上午挑的——這種錯沒有任何症狀。
   */
  const viewRecordFor = useCallback(
    function <T extends TrafficRecord | null | undefined>(
      record: T,
      chartFilters: MainFilters,
      /*
       * ⚠️ 車種篩選預設**不做**。
       *   路口轉向圖、車種組成分析那幾張自己就把 vehicle 傳進繪圖函式
       *  （而且單一車種在那裡的慣例是改報「輛數」），
       *   在這裡再篩一次會變成篩兩遍。
       *   要由紀錄層篩的頁（尖峰彙總、核對工作台、進階分析、歷季趨勢）
       *   自己把 applyVehicle 打開。
       */
      options?: { applyVehicle?: boolean },
    ): T {
      if (!record) return record;
      const scope: ScopeKey =
        chartFilters.peak === "AMPM" ? "AM" : chartFilters.peak;
      const byPeakRule =
        directionPeakFor(scope).map.get(record.id) || record;
      const byMovement = recordWithMovementFilter(
        byPeakRule,
        chartFilters.movement,
      );
      return (
        options?.applyVehicle
          ? recordWithVehicleFilter(byMovement, chartFilters.vehicle)
          : byMovement
      ) as T;
    },
    [directionPeakFor],
  );
  const currentCanonicalRecords = [
    ...new Map(
      current.map(function (record) {
        return [recordIntersectionKey(record), record];
      }),
    ).values(),
  ];
  /*
   * 「各路口尖峰彙總」的路口選單。
   *
   * ⚠️ **不可以用 recordIntersectionKey 當鍵**（我第一版就是這樣，實測抓到）。
   * 它會把同一個交流道的北向站與南向站（S01-09N／S01-09S）正規化成同一個
   * 名稱——選單裡會**少一站**，而下面的表是逐「站號」列的，於是選單有 4 個
   * 選項、表卻有 5 列，選到那一個還會一次跑出兩站。
   * 這裡以**站號**分組，與表格的列一一對應。
   */
  const peaksIntersectionOptions = [
    ...new Map(
      current.map(function (record) {
        return [record.station, record];
      }),
    ).values(),
  ].map(function (record) {
    return { key: record.station, station: record.station, name: record.name };
  });
  /*
   * 換季度之後，原本選的那個路口可能這一季沒有調查。
   * 不退回「全部路口」的話，畫面會變成一片空白而且看不出原因。
   */
  const peaksIntersectionValue =
    peaksIntersection !== "ALL" &&
    !peaksIntersectionOptions.some(function (item) {
      return item.key === peaksIntersection;
    })
      ? "ALL"
      : peaksIntersection;
  /*
   * 「各路口尖峰彙總」那一頁的資料集算一次。
   *
   * ⚠️ 2026-09-25 第六輪：這個篩選條件原本在同一頁**抄了兩份**
   *   （彙總表與支線卡片各一），而表頭的單位又完全沒有問涵蓋，
   *   於是滿 24 小時的整批資料，表頭寫「PCU/調查時段」；
   *   下面那段說明更是直接寫死「單位均為 PCU/hr」，
   *   選「全調查時段」時整段都是錯的。
   *   ⚠️ 涵蓋一定要取**整張表**：逐列算會讓同一張表出現兩種欄名。
   */
  const peaksSummaryRecords = records.filter(function (record) {
    return (
      record.projectId === activeProjectId &&
      record.quarter === quarter &&
      (peaksIntersectionValue === "ALL" ||
        record.station === peaksIntersectionValue)
    );
  });
  const peaksSummaryCoverage = coverageOf(peaksSummaryRecords.map(viewRecord));
  const canonicalRecords = useMemo(
    function () {
      return [
        ...new Map(
          projectRecords.map(function (record) {
            return [recordIntersectionKey(record), record];
          }),
        ).values(),
      ];
    },
    [projectRecords],
  );
  /*
   * 目前這個計畫記住的「舊名 → 標準路口」別名，整理成可以列出來的形狀。
   *
   * ⚠️ 別名存的是**正規化後的鍵**，不是使用者當初打的字（見改名那一段的
   *   canonicalIntersectionKey）。所以「會併入哪一個」要回頭用目前的紀錄
   *   把鍵換回**現在的顯示名稱**——直接把鍵印出來的話，使用者看到的是
   *   一串他沒打過的字，等於還是驗證不了。
   *   找不到對應紀錄時（那個路口的資料被刪掉了）就退回顯示鍵本身，
   *   並註明資料已不在，不可以靜靜地不列出來。
   */
  const projectAliasRows = useMemo(
    function () {
      const prefix = activeProjectId + "|";
      const labelOf = new Map(
        projectRecords.map(function (record) {
          return [canonicalIntersectionKey(record.name), record.name] as const;
        }),
      );
      return Object.entries(intersectionAliases)
        .filter(function ([aliasKey]) {
          return aliasKey.startsWith(prefix);
        })
        .map(function ([aliasKey, target]) {
          return {
            aliasKey,
            from: aliasKey.slice(prefix.length),
            toLabel: labelOf.get(target) || target + "（這個路口目前沒有資料）",
          };
        })
        .sort(function (a, b) {
          return a.from.localeCompare(b.from, "zh-Hant");
        });
    },
    [intersectionAliases, activeProjectId, projectRecords],
  );
  /*
   * ══════════════════════════════════════════════════════════════════
   *  X-64：「道路與流向管理」是**設定頁**，不吃主工具列的路口與資料別
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-17（附圖，而且自己還原了重現步驟）：
   *   「我先故意勾選主工具列任意兩個路段，然後再去資料匯入新資料，
   *     再回到道路與流向管理分頁……路段變成不可選」
   *
   * ⚠️ 重現的關鍵是**站號逐季會變**（T1-01 → T5-01 是這一支自己的已知情況）。
   *   主工具列的路口篩選是照**站號**比對的，所以勾了舊季的兩個路口之後
   *   匯入新一季，那兩個站號在新一季不存在 → `current` 變成空陣列
   *   → 「切換路口」整個下拉是空的，**連換一個路口都做不到**，
   *   而下面的幾何卡還停在上一次選到的那一季（畫面上同時出現
   *   「圖面季度 113Q1」與「資料季度 111Q3」，自己打自己）。
   *
   * ⚠️ 真正的問題不是那個警語不夠清楚，是**規則本身錯了**：
   *   這一頁設定的是路口幾何（支線名稱、角度、車道組成），它是參數設定，
   *   不是分析結果。分析用的篩選條件不應該決定「你能不能編輯哪一個路口」——
   *   否則使用者必須先回去解除篩選，才改得到他要改的那一個路口。
   *   這與 X-60（歷季趨勢自己的路口下拉被鎖住）是同一類。
   *
   * ⚠️ 這一份**只給這一頁用**：分析頁（轉向圖、車種組成、進階分析…）
   *   照樣吃主工具列，那是它們該有的行為。
   */
  const geometryRecords = useMemo(
    function () {
      return projectRecords.filter(function (record) {
        return record.quarter === quarter;
      });
    },
    [projectRecords, quarter],
  );
  /** 這一頁的「切換路口」下拉：這一季的每一個路口，各一項。 */
  const geometryIntersectionOptions = useMemo(
    function () {
      return [
        ...new Map(
          geometryRecords.map(function (record) {
            return [recordIntersectionKey(record), record];
          }),
        ).values(),
      ];
    },
    [geometryRecords],
  );
  /**
   * 這一頁**自己**選到的那一筆。
   *
   * ⚠️ 不可以沿用共用的 `selected`：它是從 `current`（套過主工具列）推出來的，
   *   主工具列只留 A 時選 B 會被退回 A——下拉看起來換了、卡片沒換，
   *   使用者會改到**另一個路口**的幾何。那比「不能換」更糟。
   */
  const geometrySelected = useMemo(
    function () {
      const own = geometryRecords.filter(function (record) {
        return recordIntersectionKey(record) === selectedIntersection;
      });
      return (
        own.find(function (record) {
          return record.surveyType === selectedSurveyType;
        }) ||
        own[0] ||
        geometryRecords[0] ||
        null
      );
    },
    [geometryRecords, selectedIntersection, selectedSurveyType],
  );
  /** 這一頁「資料別」下拉的選項（同一個路口在這一季的每一種資料別）。 */
  const geometrySelectedRecords = useMemo(
    function () {
      const key = geometrySelected
        ? recordIntersectionKey(geometrySelected)
        : "";
      return geometryRecords.filter(function (record) {
        return recordIntersectionKey(record) === key;
      });
    },
    [geometryRecords, geometrySelected],
  );
  const selectedIntersectionRecords = current.filter(function (record) {
    const activeKey =
      selectedIntersection ||
      (current[0] ? recordIntersectionKey(current[0]) : "");
    return recordIntersectionKey(record) === activeKey;
  });
  const selected =
    selectedIntersectionRecords.find(function (record) {
      return record.surveyType === selectedSurveyType;
    }) ||
    selectedIntersectionRecords[0] ||
    current[0] ||
    projectRecords[0] ||
    null;
  /*
   * ══════════════════════════════════════════════════════════════════
   *  X-60：這一支同步用的 effect，把「歷季趨勢比較」的路口選不動
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-17（附圖）：
   *   「歷季趨勢比較圖說明中有寫，路段不受主工具列影響。但我實測後，
   *     當我選擇A路段後……自身的工具列，想點選B路段，會變成無法選擇……
   *     只有我把主工具列的路段解除篩選後，歷季趨勢圖自己的工具列才能正常使用」
   *   「主工具列不論路口怎麼選，都不影響歷季趨勢圖，這才是本頁不適用主工具列
   *     的『路口』，然後只有自身的工具列選擇單一路口，趨勢圖跟著變動，
   *     才是正常的。」
   *
   * ⚠️ 他說得對，而且這是**畫面在說謊**那一類：那一頁白紙黑字寫著
   *   「本頁不適用主工具列的『路口』」，圖也真的不吃（trendRecordsForChart
   *   是從 projectRecords 重走一次的，沒有套 intersections），
   *   但**那一頁自己的下拉選不動**——選了 B，這個 effect 立刻把它扳回 A。
   *
   * 成因：`selected` 是從 `current`（＝**套過主工具列**的那一份）推出來的。
   *   主工具列只留 A 時，選成 B → selectedIntersectionRecords 變成空陣列
   *   → selected 退回 current[0]＝A → 這個 effect 把 state 改回 A。
   *   使用者看到的是「這個下拉壞了」，而且沒有任何訊息說明為什麼。
   *
   * ⚠️ 修法是**限縮這個 effect 的職責**，不是把它拿掉：
   *   它原本的用處是「state 還是空的、或指到一個已經不存在的路口時，
   *   補一個有效值」。所以只要目前這個值在**這個計畫裡真的存在**，
   *   就不要動它——它只是被主工具列篩掉而已。
   *
   * ⚠️ 其他分頁不受影響：那幾頁的路口下拉綁的都是
   *   `recordIntersectionKey(selected)`（推導值），不是這個 state 本身，
   *   而 selected 永遠落在 current 裡面，所以它們顯示的仍然是自己清單裡的那一個。
   */
  useEffect(
    function () {
      if (!selected) return;
      const stillExists =
        selectedIntersection &&
        projectRecords.some(function (record) {
          return recordIntersectionKey(record) === selectedIntersection;
        });
      if (stillExists) return;
      if (recordIntersectionKey(selected) !== selectedIntersection)
        setSelectedIntersection(recordIntersectionKey(selected));
    },
    [selected, selectedIntersection, projectRecords],
  );
  /*
   * ── 顯示用 vs 編輯用 ──────────────────────────────────────────
   *
   * ⚠️ 這兩份**故意分開**。
   *   `selected` / `current` 是**原紀錄**，編輯（改支線名稱、角度、當量、
   *   刪除、備份）一律用它；用改寫過的複製品去編輯，使用者存下去會不見。
   *   `selectedView` / `currentView` 是**顯示用**：判定方式選「各方向各自
   *   認定」時，它們的 routes 已經換成各支線自己尖峰小時的量。
   *
   * ⚠️ 判定方式是「整個調查點同一時段」（預設）時，viewRecord 回傳的是
   *   **同一個物件參考**，所以兩份完全相同、既有的 memo 也不會失效。
   */
  /*
   * ⚠️ 這裡**沒有**另外做 selectedView／currentView。
   *
   *   一度做了，但後來發現更誠實的做法是**在每一個讀數字的地方**寫
   *   `recordTotal(viewRecord(record), …)`——因為那樣才看得出
   *   「這一行是顯示用的」。另外準備一份 xxxView 陣列的話，
   *   之後有人不小心拿它去編輯（改支線名稱、角度），改的就是複製品，
   *   存下去會不見，而且從變數名稱上看不出來。
   *   編輯一律用 selected／current（原紀錄），顯示一律 viewRecord(…)。
   */
  /*
   * 歷季趨勢比較跨季度，所以它要的是**整個計畫**的顯示用紀錄，
   * 不是只有目前這一季的 currentView。
   */
  /**
   * 路口轉向圖要畫的那一筆（已套用這一張圖自己的時段、轉向別與判定方式）。
   *
   * ⚠️ 升級前這張圖拿的是**原紀錄**，所以「尖峰時段判定方式」與「轉向別」
   *   在這一頁上完全沒有作用——主工具列切了，圖一動也不動。
   *   使用者的要求是「能計算或繪製的話，都要確實去計算或繪製」，
   *   這張圖兩者都算得出來，所以接上。
   */
  const diagramRecord = useMemo(
    /*
     * ⚠️ 圖上那一行「調查日期 …」要寫**使用者指定的**那一個。
     *   不換的話，畫面上的明細表寫他指定的日期、匯出的圖卻寫系統判讀的
     *   那一個——同一份資料兩個日期，而且是交出去的那一份錯。
     */
    () => {
      const base = viewRecordFor(selected, diagramFilters);
      if (!base) return base;
      const iso = effectiveRecordDate(base);
      return iso === base.date ? base : { ...base, date: iso };
    },
    [selected, viewRecordFor, diagramFilters, effectiveRecordDate],
  );
  /** 交通量圖卡預覽要畫的那一筆（套用它自己那一組條件）。 */
  const geometryRecord = useMemo(
    () => viewRecordFor(selected, geometryFilters),
    [selected, viewRecordFor, geometryFilters],
  );
  /** 駛入／駛出表要算的那一筆（套用它自己那一組條件）。 */
  const inboundRecord = useMemo(
    () => viewRecordFor(selected, inboundFilters),
    [selected, viewRecordFor, inboundFilters],
  );
  /**
   * 各路口尖峰彙總／流量核對工作台／轉向進階分析／歷季趨勢比較用的
   * 「這一張圖自己的顯示用紀錄」。
   *
   * ⚠️ 這四張都**由紀錄層篩車種**（applyVehicle），
   *   因為它們的數字全部走 recordTotal／branchPeakFlows／odMatrix 這一類
   *   讀 approach.movements 或 routes 的函式，沒有自己的 vehicle 參數。
   *   不從紀錄層篩的話，主工具列的「車種」在這四頁完全沒有作用——
   *   實測（probe-filter-matrix，2026-09-14）就是這樣。
   */
  const viewFor = useCallback(
    function (record: TrafficRecord, chartFilters: MainFilters) {
      return viewRecordFor(record, chartFilters, { applyVehicle: true });
    },
    [viewRecordFor],
  );
  /*
   * 篩了車種、但這一筆沒有逐條流向 → 拆不開。
   * 這種情況一定要在畫面上講，不可以顯示一個沒被篩到的數字。
   */
  const vehicleSplitBlocked = useCallback(
    function (records: TrafficRecord[], chartFilters: MainFilters) {
      if (chartFilters.vehicle === "all") return [] as string[];
      return [
        ...new Set(
          records
            .filter((record) => !canSplitByVehicle(record))
            .map((record) => record.station || record.name),
        ),
      ];
    },
    [],
  );
  /*
   * 歷季趨勢圖真正要畫的那一份：在季度區間之上，再套這一張圖自己的
   * 轉向別與車種。
   *
   * ⚠️ trendRecordsView 已經套了**主工具列**的轉向別（走 viewRecord），
   *   這裡要的是**這一張圖自己的**那一組，所以從 projectRecords 重走一次，
   *   不可以在 trendRecordsView 上再疊一層（會變成篩兩遍）。
   */
  const trendRecordsForChart = useMemo(
    function () {
      const from = trendFilters.quarterFrom || quarter;
      const to = trendFilters.quarterTo || quarter;
      /*
       * ── 「起＝迄」＝**只有那一季**（使用者 2026-09-15 定義，三支統一）──
       *
       * 使用者原話：「起＝迄，是指單一季度……如果起 114Q1、迄 114Q1，
       *   **代表只有 114Q1 這一季**」「你一開始說的**起＝迄代表不限季是錯誤的**」
       *
       * ⚠️ 舊版在這裡把「起＝迄」解釋成**不限季**（直接回傳 projectRecords），
       *   理由是「否則趨勢圖只剩一個點」。那是**用錯誤的語意去補預設值的問題**——
       *   真正該改的是預設值（起＝最早一季），語意不該動。
       *   使用者也直接回掉了那個顧慮：「如果歷季圖出現起＝迄，導致趨勢圖
       *   只有單筆資料，那就只顯示單筆資料，是沒問題的」。
       *
       * ⚠️ 空字串（還沒載入完）仍然回傳全部——那是「還不知道」，不是「只要一季」。
       */
      const inRange =
        !from || !to
          ? projectRecords
          : projectRecords.filter(function (record) {
              return (
                compareQuarters(record.quarter, from) >= 0 &&
                compareQuarters(record.quarter, to) <= 0
              );
            });
      return inRange.map(function (record) {
        return viewFor(record, trendFilters);
      });
    },
    [projectRecords, trendFilters, quarter, viewFor],
  );
  const trendVehicleBlocked = useMemo(
    () => vehicleSplitBlocked(projectRecords, trendFilters),
    [projectRecords, trendFilters, vehicleSplitBlocked],
  );
  /*
   * ══════════════════════════════════════════════════════════════════
   *  X-52：「各方向各自認定」對歷季趨勢**不是一律不適用**
   * ══════════════════════════════════════════════════════════════════
   *
   * 算得出來的季別，這張圖是真的會跟著換的（viewFor 有套）。
   * 算不出來的是那些沒有逐時間格原始資料的紀錄——那時圖一動也不動，
   * 而使用者不會知道為什麼。所以這一句**只在真的算不出來時**出現，
   * 並且把是哪幾個調查點列出來。
   *
   * ⚠️ 不可以改寫成「這張圖不適用判定方式」一句了事：那對有原始資料的
   *   計畫是謊報，而那才是多數情況。
   */
  const trendPeakRuleBlocked = useMemo(
    function () {
      if (mainFilters.peakRule !== "direction") return [] as string[];
      const scope: ScopeKey =
        trendFilters.peak === "AMPM" || trendFilters.peak === "FULL"
          ? "AM"
          : trendFilters.peak;
      const { map } = directionPeakFor(scope);
      return [
        ...new Set(
          projectRecords
            .filter(function (record) {
              return !map.has(record.id);
            })
            .map(function (record) {
              return record.station || record.name;
            }),
        ),
      ];
    },
    [mainFilters.peakRule, trendFilters.peak, projectRecords, directionPeakFor],
  );
  const inboundRows = useMemo(
    function () {
      if (!inboundRecord) return [];
      return inboundAnalysisRows(inboundRecord, inboundVehicle);
    },
    [inboundRecord, inboundVehicle],
  );
  /*
   * 百分比的分母：同一統計範圍、同一方向的**全路口合計**。
   * ⚠️ 有任何一格算不出來（null）時，合計不可以把它當 0 加進去——
   *   那會讓分母偏小、百分比全部偏大。這裡遇到 null 就把整個分母記成 null，
   *   畫面寫「－」。
   */
  const inboundTotals = useMemo(
    function () {
      const out = {} as Record<
        ScopeKey,
        {
          inboundPcu: number | null;
          outboundPcu: number | null;
          inboundVehicles: number | null;
          outboundVehicles: number | null;
        }
      >;
      for (const scope of SCOPE_KEYS) {
        const sum = function (
          pick: (row: (typeof inboundRows)[number]) => number | null,
        ) {
          let total = 0;
          for (const row of inboundRows) {
            const value = pick(row);
            if (value == null) return null;
            total += value;
          }
          return inboundRows.length ? total : null;
        };
        out[scope] = {
          inboundPcu: sum((row) => row.inbound[scope].pcu),
          outboundPcu: sum((row) => row.outbound[scope].pcu),
          inboundVehicles: sum((row) => row.inbound[scope].vehicles),
          outboundVehicles: sum((row) => row.outbound[scope].vehicles),
        };
      }
      return out;
    },
    [inboundRows],
  );
  /*
   * 這張表（各路口駛入／駛出流量）一次只看一個路口，所以涵蓋就是那一筆的。
   * ⚠️ 2026-09-25 第六輪補：表頭原本完全沒有問涵蓋，滿 24 小時的檔
   *   在「全調查時段」那幾欄會寫成「PCU/調查時段」，
   *   而同一筆資料的轉向圖抬頭寫「PCU/調查日」。
   */
  const inboundCoverage = coverageOf(
    inboundRecord ? viewRecord(inboundRecord) : null,
  );
  /* 「顯示數值」決定這張表出現哪幾組欄位。 */
  const inboundShowsPcu =
    inboundFilters.display === "volume" || inboundFilters.display === "both";
  /*
   * ⚠️ 「交通流量＋百分比」（預設值）時**車輛數欄要留著**。
   *
   *   升級前這張表固定同時列出交通流量與車輛數兩組欄位。
   *   第一版照著五個選項的字面做，預設值把車輛數整組拿掉了——
   *   使用者什麼都沒選，一打開就少了原本看得到的東西，
   *   那就是「遺失原本就有的功能」。
   *   使用者**主動**選「交通流量」或「百分比」時才真的收起來，
   *   那是他自己要的縮減。
   */
  const inboundShowsCount =
    inboundFilters.display === "count" ||
    inboundFilters.display === "countPercent" ||
    inboundFilters.display === "both";
  const inboundShowsPercent = displayShowsPercent(
    inboundFilters.display as DisplayMode,
  );
  /*
   * 各路口尖峰彙總的支線流量表要出現哪幾欄。
   *
   * ⚠️ 「駛出路口」＝以這支為起點（enteringIntersection，車流開進中央路口）；
   *   「駛入路口」＝以這支為終點（leavingIntersection）。
   *   這兩個欄名與內部欄位名字剛好是反過來的，改的時候不要照字面配。
   */
  const peaksFlowCols = useMemo(
    function () {
      const all = [
        {
          key: "entering",
          label: "駛出路口",
          view: "outbound",
          pick: (item: { enteringIntersection: number }) =>
            item.enteringIntersection,
        },
        {
          key: "leaving",
          label: "駛入路口",
          view: "inbound",
          pick: (item: { leavingIntersection: number }) =>
            item.leavingIntersection,
        },
      ] as const;
      if (peaksFilters.flowView === "both") return all;
      return all.filter((column) => column.view === peaksFilters.flowView);
    },
    [peaksFilters.flowView],
  );
  /*
   * ⚠️ 這裡原本有一支 `trendPeak`，把 FULL 與 AMPM 都折成 AM 再傳給趨勢圖。
   *   X-54（2026-09-16）拿掉了：折過之後這一頁的「全調查時段」與「整體」
   *   兩顆就永遠選不起來，而且主工具列改成那兩個值時圖不會動。
   *   現在直接傳 trendFilters.peak，由趨勢圖自己處理四個範圍。
   */
  /*
   * 車種組成表要寫輛數、百分比、還是兩個都寫。
   * ⚠️ 這一頁**以實際車輛數統計、不套 PCU 當量**（畫面上就是這樣寫的），
   *   所以「交通流量」對它不適用——不可以把輛數當成 PCU 印出去。
   *   那一句由 InapplicableNote 掛在頁面上。
   */
  const compositionShowsValue =
    compositionFilters.display !== "percent";
  const compositionShowsPercent = displayShowsPercent(
    compositionFilters.display as DisplayMode,
  );
  /*
   * 「這一頁用不到主工具列的這幾個條件」——一次講完。
   *
   * ⚠️ 只列**真的被篩了**的那幾個（沒篩卻講話是噪音，這是我們對
   *   「不適用說明」訂的規則）。全部都沒篩時回 null，整塊不出現。
   */
  const unusedConditionsNote = useCallback(
    function (fields: (keyof MainFilters)[], reason: string) {
      const hit = fields.filter((field) => isFiltered(mainFilters, field));
      if (!hit.length) return null;
      const NAMES: Partial<Record<keyof MainFilters, string>> = {
        peak: "尖峰時段",
        peakRule: "尖峰時段判定方式",
        flowView: "路口流量視角",
        day: "資料別",
        vehicle: "車種",
        movement: "轉向別",
        display: "顯示數值",
        intersections: "路口",
      };
      return (
        <p
          className="chart-inapplicable"
          data-testid="chart-inapplicable"
          /*
           * ⚠️ 這個屬性是給守門用的，使用者看不到，但它是
           *   「**哪幾個條件**有被交代」唯一量得到的憑據。
           *
           * 使用者 2026-09-15：「偶爾會出現某張圖有出現提醒文字，
           *   卻對某一個篩選條件卻沒出現不受影響的提醒文字」。
           *   只驗「這一塊有沒有說明」會**假綠**——它對尖峰講了一句、
           *   對顯示數值一個字都沒有，照樣算「有說明」。
           *
           * ⚠️ 標的是這一句**涵蓋**的全部條件（fields），不是這次剛好
           *   被篩中的那幾個（hit）：句子本身講的就是這幾個都不適用。
           */
          data-inapplicable={fields.join(" ")}
        >
          本頁不適用主工具列的「
          {hit.map((field) => NAMES[field] || String(field)).join("」「")}
          」：{reason}
        </p>
      );
    },
    [mainFilters],
  );
  /*
   * 「這一塊不吃**任何**主工具列條件」——一句常駐說明。
   *
   * ⚠️ 逐條件各跳一句會變成八句噪音，所以這種塊一句話講完；
   *   但**不可以什麼都不說**：使用者篩了一輪、捲到這裡看到數字一動也不動，
   *   畫面上要有一個字告訴他為什麼。
   */
  const alwaysIndependentNote = useCallback(function (reason: string) {
    return (
      <p
        className="chart-inapplicable"
        data-testid="chart-inapplicable"
        data-inapplicable="all"
        data-inapplicable-always="1"
      >
        {reason}
      </p>
    );
  }, []);
  /* 轉向進階分析自己的時段。 */
  const advancedPeak: ScopeKey =
    advancedFilters.peak === "AMPM" ? "AM" : advancedFilters.peak;
  /*
   * 這一頁只看 `selected` 這一筆，所以涵蓋就是那一筆的。
   * ⚠️ 2026-09-25 第六輪補：這一頁四處單位標籤原本都沒有問涵蓋
   *   （頁首那一句、守恆差值、OD 矩陣、各支線流量平衡），
   *   選「全調查時段」而資料滿 24 小時時，四處都寫「PCU/調查時段」，
   *   而同一筆的轉向圖抬頭寫「PCU/調查日」——**同一份資料兩種單位**。
   *   算一次存成變數，下一次就不會只改到其中幾處。
   */
  const advancedCoverage = coverageOf(selected ? viewRecord(selected) : null);
  /**
   * 轉向進階分析那一頁**實際在算的那一份紀錄**。
   *
   * ⚠️ 畫面與「下載核對 Excel」一定要用同一支。
   *   升級前匯出走的是 viewRecord(record) ＋ 主工具列的 peak，
   *   而畫面走 advancedPeak ＋ 車種篩選 ＋ 全部轉向，於是：
   *   ① 這一頁脫離時段時，檔案裡是另一個時段的數字；
   *   ② 主工具列選了「只看左轉」時，**檔案真的只算左轉**——
   *      而畫面上白紙黑字寫著「這裡一律以『全部轉向』計算」，
   *      守恆差值因此永遠對不起來，看檔案的人會以為是資料有錯。
   *   （2026-09-16 實測抓到。）
   */
  const advancedRecordFor = useCallback(
    (record: TrafficRecord) =>
      recordWithVehicleFilter(
        viewRecordAllMovementsFor(record, advancedPeak),
        advancedFilters.vehicle,
      ),
    [advancedPeak, advancedFilters.vehicle, viewRecordAllMovementsFor],
  );
  /*
   * OD 矩陣要不要寫數值／百分比。
   * ⚠️ 「百分比」單獨選時只寫比例（沒有數值），與轉向圖的規則一致；
   *   兩個都不寫是不可能的組合，所以不必另外防。
   */
  const advancedShowsValue = displayShowsValue(
    advancedFilters.display as DisplayMode,
  );
  const advancedShowsPercent = displayShowsPercent(
    advancedFilters.display as DisplayMode,
  );
  /* 核對工作台自己的時段（脫離時才與主工具列不同）。 */
  const auditPeak: ScopeKey =
    auditFilters.peak === "AMPM" ? "AM" : auditFilters.peak;
  const auditVehicleBlocked = useMemo(
    () => vehicleSplitBlocked(selected ? [selected] : [], auditFilters),
    [selected, auditFilters, vehicleSplitBlocked],
  );
  /* 篩了車種、但這一季有紀錄拆不開時要點名。 */
  const peaksVehicleBlocked = useMemo(
    () => vehicleSplitBlocked(current, peaksFilters),
    [current, peaksFilters, vehicleSplitBlocked],
  );
  /* 「路口流量視角」決定欄名寫什麼——欄名不跟著改就是謊報。 */
  const inboundFlowTitle =
    inboundFilters.flowView === "inbound"
      ? "駛入"
      : inboundFilters.flowView === "outbound"
        ? "駛出"
        : "駛入／駛出";
  /*
   * 選著「全日尖峰小時」或「全日時段」，再切到一個只做了幾小時的路口時，
   * 那個時段在新路口是算不出來的。不退回去的話畫面會整片 0，而且看起來
   * 像資料壞掉；退回上午尖峰並且下拉選單也跟著變，使用者才知道發生什麼事。
   */
  /*
   * ⚠️ 這裡改呼叫 setPeakChoice，不是 setPeak。
   *   setPeak 現在是包在 useCallback 裡的轉接函式，放進相依陣列只是徒增一層；
   *   真正的狀態是 peakChoice，直接設它最誠實，lint 也不會再嫌少了相依。
   * ⚠️ 並列（AMPM）時 peak 已經攤成 AM，所以這裡退回 "AM" 對並列也是對的。
   */
  useEffect(
    function () {
      if (selected && fullDayUnavailableReason(selected, peak))
        setPeakChoice("AM");
    },
    [selected, peak],
  );
  useEffect(
    function () {
      if (selected && selected.surveyType !== selectedSurveyType)
        setSelectedSurveyType(selected.surveyType || "待設定");
    },
    [selected, selectedSurveyType],
  );
  /*
   * 聚焦支線的索引要跟著路口走。刪掉支線或換到支線比較少的路口之後，
   * 舊索引會指向不存在的支線，聚焦模式就會一條箭線都畫不出來，
   * 而下拉選單看起來卻是選在第一條，畫面與狀態不一致。
   */
  useEffect(
    function () {
      const count = selected?.approaches.length ?? 0;
      if (count && focusIndex >= count) setFocusIndex(0);
    },
    [selected, focusIndex],
  );
  const issues = useMemo(
    function () {
      const list = qualityIssues(projectRecords);
      /*
       * ══════════════════════════════════════════════════════════════════
       *  當量係數有壞格也要進異常清單（2026-09-25，F6 第三輪抓到）
       * ══════════════════════════════════════════════════════════════════
       *
       * ⚠️ v2.1.83 寫了 `pceIssues()` 並對外宣告「逐格指名哪一格壞掉」，
       *   但**它一個呼叫點都沒有**——整個函式被 tree-shake 掉、沒進 bundle。
       *   淨效果只是「靜靜變成 0」換成「靜靜變成 NaN」，使用者照樣沒被告知，
       *   而 NaN 會一路傳到畫面、Excel 與結論草稿。
       *
       * ⚠️ `qualityIssues()` 只吃 records，而當量是**計畫層級的設定**
       *   （還有「季別 × 路口」覆寫），所以在這裡接，不改那一支的簽名。
       * ⚠️ 依使用者定的順序：先判定是不是異常 → 列進清單讓他確認 →
       *   確認不是異常才套用處理方式。這裡不自己把壞值改回 1。
       */
      const base = pceMatrixIssue(pce, "計畫預設", "default");
      if (base) list.push(base);
      pceScopes.forEach(function (scope, index) {
        /*
         * ⚠️ 只用 scope 自己的 quarter／roadId 組標籤，**不查路口名稱**。
         *   查名稱要 `intersectionNameOf`，那是一個每次 render 都重建的
         *   普通函式；把它放進 deps 會讓這個 memo 每一次 render 都重算
         *   （等於沒有 memo）。異常清單只需要認得出是哪一條覆寫，
         *   代碼就夠了，使用者點進「車種轉向當量」就會看到完整的那一列。
         */
        const label = pceScopeLabel(scope.quarter, scope.roadId, "", "全路口");
        const one = pceMatrixIssue(scope.factors, label, `scope-${index}`);
        if (one) list.push(one);
      });
      return list;
    },
    [projectRecords, pce, pceScopes],
  );
  /*
   * 報表匯出的季度範圍與資料筆數。
   *
   * Excel 匯出與報告文字草稿都要用「完全同一批紀錄」，否則草稿寫的數字會
   * 跟附表對不起來。所以這段只算一次，兩邊共用。
   * 起訖季度反過來選（例如起 115Q4、訖 115Q1）時取兩者之間，不當成空範圍。
   */
  const reportExportScope = useMemo(
    function () {
      const requestedStartIndex = Math.max(
        0,
        quarters.indexOf(reportStartQuarter),
      );
      const requestedEndIndex = Math.max(0, quarters.indexOf(reportEndQuarter));
      const startIndex = Math.min(requestedStartIndex, requestedEndIndex);
      const endIndex = Math.max(requestedStartIndex, requestedEndIndex);
      const selectedQuarters = quarters.slice(startIndex, endIndex + 1);
      /*
       * ⚠️ 「路口」這個條件以前**完全沒有套用**（只篩季度）。
       *   而尖峰時段判定方式與轉向別**卻是套用的**（走 viewRecord）——
       *   同一條主工具列，有的條件會影響草稿、有的不會，而畫面上看不出差別。
       *   使用者 2026-09-15 指名要「主工具列有的篩選條件，草稿產生器都能同步」，
       *   所以這裡補上；草稿開頭的「統計條件」會寫出目前選了哪幾個路口。
       * ⚠️ 空陣列＝全部路口（不是全部排除），與主工具列同一個約定。
       */
      const wanted = mainIntersectionStations;
      return {
        quarters: selectedQuarters,
        records: projectRecords.filter(function (record) {
          if (!selectedQuarters.includes(record.quarter)) return false;
          if (wanted.size && !wanted.has(record.station)) return false;
          /*
           * ⚠️ 2026-09-23 補上「資料別」。
           *
           *   這裡原本只篩季度與路口，**完全沒有篩資料別**，
           *   而草稿開頭卻照樣印出「統計條件：…；資料別＝平日；…」
           *   （見下方 conditions 那一段）。
           *   於是主工具列選「平日」時：畫面每一張表都只剩平日，
           *   產生出來的報告草稿卻把假日那幾筆一起寫進去，
           *   而第一段白紙黑字宣告只有平日。
           *   **草稿宣告了一個沒有套用的條件**，那比少寫更糟。
           *
           * ⚠️ 判準與畫面用的那一份（`current`）**逐字相同**，
           *   不另寫一套，否則兩邊遲早分岔。
           * ⚠️ `mainFilters.day` 的預設是「兩種都看」，那時候這兩行都不成立，
           *   行為與改版前完全一樣。
           */
          if (mainFilters.day === "weekday" && record.surveyType !== "平日")
            return false;
          if (mainFilters.day === "holiday" && record.surveyType !== "假日")
            return false;
          return true;
        }),
      };
    },
    [
      quarters,
      reportStartQuarter,
      reportEndQuarter,
      projectRecords,
      mainIntersectionStations,
      mainFilters.day,
    ],
  );
  /*
   * 報告文字草稿要用的數字。
   *
   * 三個原則：
   * 1. 全部沿用產生 Excel 的同一批函式（recordTotal、inboundAnalysisRows、
   *    odMatrix、branchBalance、conservationCheck、qualityIssues…），
   *    草稿不自己另算一次。
   * 2. 尖峰小時流量不能跨路口或跨季度相加，所以支線、車種這類敘述固定以
   *    一筆「代表資料」為準（目前選定路口在範圍內的最新一季），並在草稿裡
   *    寫明是哪一筆。
   * 3. 取最大值、計數、逐季列出這類不牽涉相加的敘述才涵蓋整個匯出範圍。
   */
  const reportDraftContext = useMemo(
    function (): ReportDraftContext | null {
      const exportRecords = reportExportScope.records;
      if (!exportRecords.length) return null;
      const quarterKeys = Array.from(
        new Set(
          exportRecords.map(function (record) {
            return record.quarter;
          }),
        ),
      ).sort(compareQuarters);
      const quarterRange =
        quarterKeys.length > 1
          ? quarterKeys[0] + "～" + quarterKeys[quarterKeys.length - 1]
          : quarterKeys[0] || "";
      const intersectionKeys = Array.from(
        new Set(exportRecords.map(recordIntersectionKey)),
      );
      /*
       * 每個「路口 × 資料別」在範圍內的最新一季。
       *
       * 一定要把資料別也放進 key：recordIntersectionKey 會把平日與假日
       * 正規化成同一個 key，只用它分組的話，同一個路口的平日與假日會互相
       * 覆蓋，「各路口比較」就會少掉一半的列，代表資料也可能挑到使用者
       * 沒有在看的那一種日別。
       */
      const latestBySeries = new Map<string, TrafficRecord>();
      const seriesKeyOf = function (record: TrafficRecord) {
        // 站號一起放進 key。recordIntersectionKey 會把同一個交流道的北向與
        // 南向站正規化成同一個名稱，只用它分組會讓其中一站整個消失，
        // 而 Excel 的「各路口支線尖峰流量」兩站都會列——兩份成果對不起來。
        return [
          recordIntersectionKey(record),
          record.station,
          record.surveyType || "待設定",
        ].join("|");
      };
      exportRecords.forEach(function (record) {
        const key = seriesKeyOf(record);
        const kept = latestBySeries.get(key);
        if (!kept || compareQuarters(record.quarter, kept.quarter) > 0)
          latestBySeries.set(key, record);
      });
      /*
       * 全篇統一的一筆資料標示法。舊版 topFlow／worstBalance 只寫「站號 季度」，
       * 同一站同一季同時有平日與假日時無法分辨，也對不上其他段落的寫法。
       */
      const siteLabelOf = function (record: TrafficRecord) {
        /*
         * ⚠️ 這裡要用 showQuarter，不可以再直接呼叫 quarterInYearStyle。
         *   quarterInYearStyle **只換年份**，期別（季別／調查月份）不會換——
         *   使用者 2026-09-13 就是踩到這個：切到「調查月份」之後，
         *   年份變成西元了、期別仍然是季別。
         *
         *   舊註解說「showQuarter 每次 render 都是新的函式」——那在當時成立，
         *   但 showQuarter 現在是 useCallback，相依只有 [quarterLabels, yearStyle]，
         *   放進相依陣列是安全的。
         */
        return `${record.name || record.station} ${showQuarter(
          record.quarter,
        )}（${record.surveyType || "待設定"}）`;
      };
      /*
       * 代表資料：優先取「使用者目前選的路口＋目前選的資料別」的最新一季；
       * 該資料別在範圍內沒有資料時才退回同一路口的其他資料別。
       */
      /*
       * ⚠️ 稽核表 I：前兩層是「使用者選的那個路口」，第三、四層是**退路**。
       *   退路本身要留著（不留的話整段草稿寫不出來），但**不可以安靜地用**：
       *   報表有自己的季度區間，選定的路口不在範圍內時就會落到退路，
       *   而那一筆是匯入順序上的第一筆——別的路口、別的季、別的日別。
       *   所以這裡把「有沒有落到退路」記下來，交給草稿明講。
       */
      const focusOwn =
        (selected && latestBySeries.get(seriesKeyOf(selected))) ||
        (selected &&
          [...latestBySeries.values()].find(function (record) {
            return (
              recordIntersectionKey(record) === recordIntersectionKey(selected)
            );
          })) ||
        null;
      const focus =
        focusOwn || latestBySeries.values().next().value || exportRecords[0];
      const focusIsSelected = Boolean(focusOwn);
      const focusRequestedLabel = selected ? siteLabelOf(selected) : "";
      const focusLabel = siteLabelOf(focus);
      const peakLabel = function (peakKey: PeakKey) {
        const own =
          scopeWindowLabel(viewRecord(focus), peakKey);
        const others = new Set(
          exportRecords.map(function (record) {
            return scopeWindowLabel(viewRecord(record), peakKey);
          }),
        );
        others.delete(own);
        return own + (others.size ? `（其餘資料另有 ${others.size} 種時段）` : "");
      };
      /*
       * ⚠️ 2026-09-23 修正：同 siteSummaries 那一處——這裡原本沒有經過
       *   `viewRecord()`，於是 `outbound`／`inbound`／`flowTotals` 三段
       *   都是**未套轉向別與尖峰判定**的數字，而同一份草稿的 `totals`
       *   走的是 `recordTotal(viewRecord(focus), …)`，是**已套**的。
       *   兩者並排在同一份報告草稿裡，各支線加總會遠大於總量。
       */
      const focusRows = inboundAnalysisRows(viewRecord(focus));
      const armFlows = function (direction: "inbound" | "outbound") {
        return focusRows
          .map(function (row) {
            return {
              name: row.approach.name,
              /* 這一段寫的是上午／下午尖峰的各支線流量。AM 與 PM 一定
                 有值（不像全日欄位會是 null），?? 0 只是讓型別收斂。 */
              am: (direction === "inbound" ? row.inbound.AM : row.outbound.AM)
                .pcu ?? 0,
              pm: (direction === "inbound" ? row.inbound.PM : row.outbound.PM)
                .pcu ?? 0,
              /*
               * ── 另外兩個核心統計範圍（2026-09-23 新增）──────────────
               *
               * ⚠️ 這兩個**可能是 null**（沒有逐條流向的舊紀錄、或這一筆
               *   算不出全調查時段），與 AM／PM 不同。null 要原樣往下傳，
               *   草稿那邊看到 null 會整段不寫——**不可以 `?? 0`**：
               *   0 會被當成「這個範圍沒有車」抄進報告。
               */
              day: (direction === "inbound" ? row.inbound.DAY : row.outbound.DAY)
                .pcu,
              full: (direction === "inbound"
                ? row.inbound.FULL
                : row.outbound.FULL
              ).pcu,
            };
          })
          .sort(function (a, b) {
            return b.am - a.am || b.pm - a.pm;
          });
      };
      const sumBy = function (
        rows: { am: number; pm: number; day?: number | null; full?: number | null }[],
        peak: "am" | "pm" | "day" | "full",
      ) {
        /*
         * ⚠️ 只要有**任何一條支線**在這個範圍算不出來，整個合計就是 null。
         *   把算不出來的那幾條當成 0 加進去，得到的合計會比真值小，
         *   而草稿還會拿它去和駛出合計比守恆——兩邊各缺不同的支線時，
         *   會得到一個「不守恆」的假警報；剛好缺同幾條時更糟，
         *   會得到一個看起來守恆的假保證。
         */
        if (rows.some((row) => row[peak] === null || row[peak] === undefined))
          return null;
        return (
          Math.round(
            rows.reduce(function (sum, row) {
              return sum + Number(row[peak] ?? 0);
            }, 0) * 10,
          ) / 10
        );
      };
      const outbound = armFlows("outbound");
      const inbound = armFlows("inbound");
      /* 車種組成：全調查時段有資料就用它，否則退回 AM 尖峰。 */
      const focusVehicleIds = recordVehicleIds(focus);
      const surveyTotal = focusVehicleIds.reduce(function (sum, id) {
        return sum + recordVehicleTotal(viewRecord(focus), "SURVEY", id);
      }, 0);
      const compositionKey: CompositionScope = surveyTotal > 0 ? "SURVEY" : "AM";
      const compositionCounts = focusVehicleIds.map(function (id) {
        return {
          label: vehicleLabel(focus, id),
          count: recordVehicleTotal(viewRecord(focus), compositionKey, id),
        };
      });
      const compositionTotal = compositionCounts.reduce(function (sum, item) {
        return sum + item.count;
      }, 0);
      /* OD 矩陣中最大的一筆：取最大值不牽涉相加，可以跨整個範圍找。 */
      let topFlow: ReportDraftContext["topFlow"] = null;
      let worstBalance: ReportDraftContext["worstBalance"] = null;
      let conservationChecked = 0;
      let conservationPassed = 0;
      exportRecords.forEach(function (record) {
        /* 只比三個尖峰：它們都是「某一小時」的量，可以互相比大小。
           全日時段是一整天的累計，拿來比一定是它最大，沒有意義。 */
        PEAK_KEYS.forEach(function (peakKey) {
          odMatrix(viewRecord(record), peakKey).forEach(function (row) {
            row.values.forEach(function (value, destinationIndex) {
              const destination = record.approaches[destinationIndex];
              if (!destination || destination.id === row.originId) return;
              // value > 0 是必要的：舊版匯入的紀錄沒有 routes，整個矩陣都是 0，
              // 只判斷 !topFlow 會寫出「流量最高的一筆為 … 0.0 PCU/hr」，
              // 正確的表現是讓這一段落回到「沒有可敘述的資料」。
              if (value > 0 && (!topFlow || value > topFlow.pcu))
                topFlow = {
                  station: siteLabelOf(record),
                  /*
                   * ⚠️ 要傳**顯示名稱**，不是內部鍵值。
                   *   舊版直接傳 "AM"／"PM"／"DAY"，草稿就印成「DAY 尖峰」——
                   *   「DAY 尖峰」在這個系統裡不是任何一個名詞，而 Excel 的
                   *   「OD轉向矩陣」同一列寫的是「全調查時段尖峰」。
                   *   同一筆資料，兩份成果兩種寫法，而草稿會被整段抄進報告。
                   */
                  peak: SCOPE_SHORT_LABELS[peakKey] ?? peakKey,
                  from: row.origin,
                  to: destination.name,
                  pcu: value,
                };
            });
          });
          branchBalance(viewRecord(record), peakKey).forEach(function (row) {
            // Number.isFinite 不能省：資料含非數值欄位時 difference 會是 NaN，
            // 而 `x > NaN` 永遠是 false，之後每一列都比不過它——真正最大的
            // 失衡就永遠不會被報出來，畫面上只看到一個「—」。
            if (
              Number.isFinite(row.difference) &&
              (!worstBalance ||
                Math.abs(row.difference) > Math.abs(worstBalance.difference))
            )
              worstBalance = {
                station: siteLabelOf(record),
                /* ⚠️ 同上：顯示名稱，不是內部鍵值。 */
                peak: SCOPE_SHORT_LABELS[peakKey] ?? peakKey,
                name: row.name,
                difference: row.difference,
              };
          });
          /*
           * 沒有 routes 的舊版紀錄不算進守恆檢核。
           * conservationCheck 對這種紀錄會讓 routePeakTotal 直接退回
           * recordPeakTotal，於是必定「通過」——那不是檢查結果，是同義反覆。
           * 一整批舊資料會得到「共檢查 N 組，通過 N 組」的假保證。
           */
          if (record.routes?.length) {
            const check = conservationCheck(viewRecord(record), peakKey);
            conservationChecked += 1;
            if (check.valid) conservationPassed += 1;
          }
        });
      });
      const draftIssues = qualityIssues(exportRecords);
      const categoryCounts = new Map<string, number>();
      draftIssues.forEach(function (issue) {
        categoryCounts.set(
          issue.category,
          (categoryCounts.get(issue.category) || 0) + 1,
        );
      });
      /* 當量矩陣：與「車種轉向當量」工作表同樣看 pceUsed，不是畫面上的設定。 */
      const matrixSignatures = new Set(
        exportRecords.map(function (record) {
          return JSON.stringify(record.pceUsed || DEFAULT_PCE);
        }),
      );
      const focusMatrix = focus.pceUsed || DEFAULT_PCE;
      const trendRecords = trendSeriesRecords(exportRecords, selected);
      return {
        projectName: activeProject?.name || "",
        quarterRange,
        quarterCount: quarterKeys.length,
        intersectionCount: intersectionKeys.length,
        recordCount: exportRecords.length,
        focusLabel,
        focusIsSelected,
        focusRequestedLabel,
        /*
         * 尖峰時段一定要報「代表資料自己的」時段。
         * 舊寫法取全範圍的眾數，但下面的支線、車種、路口總量全部來自 focus，
         * 讀者會把 focus 的數字掛在別筆的時段上。時段不只一種時另外註明。
         */
        peaks: {
          am: peakLabel("AM"),
          pm: peakLabel("PM"),
        },
        /*
         * 各路口分項結果。整體總結回答「這個範圍加起來多少」，但報告通常還要
         * 逐個路口交代「A 路口上午尖峰多少、下午尖峰多少」。
         * 每一筆用自己的尖峰時段與自己的支線，所以這一段可以涵蓋整個匯出
         * 範圍，不需要像整體總結那樣挑一筆代表資料。
         */
        siteSummaries: exportRecords
          .slice()
          // 逐筆敘述會很長（每筆兩行、每行含全部支線），超過 30 筆時先截斷，
          // 並在段末說明還有幾筆——整段塞進文字框反而沒人看得完。
          /*
           * 由新到舊排序，截斷時留下的才是最新的資料。
           * 舊寫法是由舊到新再 .slice(0, 30)，4 季 × 10 路口 × 平假日的案子
           * 會剛好把最新一季整個切掉，而草稿其他段落講的都是最新一季——
           * 使用者拿到的分項結果與前後文完全對不上。
           */
          .sort(function (a, b) {
            return (
              compareQuarters(b.quarter, a.quarter) ||
              (a.name || a.station).localeCompare(b.name || b.station, "zh-Hant")
            );
          })
          .slice(0, SITE_SUMMARY_LIMIT)
          .map(function (record) {
            /*
             * ⚠️ 2026-09-23 修正：這裡原本是 `inboundAnalysisRows(record)`
             *   ——**沒有經過 viewRecord()**，也就是不吃「轉向別」與
             *   「尖峰時段判定方式」。而同一個物件的 `total` 走的是
             *   `recordTotal(viewRecord(record), …)`，**有**吃。
             *
             *   後果是同一段自相矛盾：主工具列選「只看左轉」之後，
             *     「路口轉向總量 1,422.8 PCU/hr」
             *     「各支線駛出／駛入：路口A 3,976.6／…」
             *   並排出現，各支線加總遠大於總量，而草稿上方寫著「轉向別＝左轉」。
             *   畫面上的各支線卡片與各路口流量頁**都有**套（viewFor／viewRecordFor），
             *   只有這一份草稿沒有。
             */
            const rows = inboundAnalysisRows(viewRecord(record));
            const vehicleIds = recordVehicleIds(record);
            return {
              name: siteLabelOf(record),
              /*
               * ⚠️ 走 SCOPE_KEYS（四個），不是 PEAK_KEYS（三個）。
               *
               *   A23，使用者 2026-09-21：「這 4 個名詞是我們交通調查的
               *   4 個核心」。舊版這裡少了 FULL＝全調查時段，於是報表文字
               *   草稿從頭到尾不會出現那一段，而結論草稿有——同一份資料
               *   兩份草稿講的東西不一樣。
               * ⚠️ 單位一定要跟著 scope 走，見 scopeUnit()。
               */
              peaks: SCOPE_KEYS.map(function (peakKey) {
                /*
                 * ⚠️ 車種組成的「範圍」與流量的「範圍」不是同一組鍵。
                 *   approach.movements 只有三個尖峰（AM／PM／DAY）；
                 *   「全調查時段」的車種輛數在 record.survey 底下，
                 *   也就是 CompositionScope 的 "SURVEY"。
                 *   直接把 "FULL" 丟進 recordVehicleTotal 會讀到 undefined
                 *   而整排變成 0——0 會被抄進報告。
                 */
                const compositionKey: CompositionScope =
                  peakKey === "FULL" ? "SURVEY" : peakKey;
                const vehicleSum = vehicleIds.reduce(function (sum, id) {
                  return (
                    sum +
                    recordVehicleTotal(viewRecord(record), compositionKey, id)
                  );
                }, 0);
                return {
                  label: SCOPE_LABELS[peakKey],
                  available: hasScopeValue(viewRecord(record), peakKey),
                  hour:
                    scopeWindowLabel(viewRecord(record), peakKey),
                  unit: scopeUnit(
                    peakKey,
                    "pcu",
                    coverageOf([viewRecord(record)]),
                  ),
                  total: recordTotal(viewRecord(record), peakKey),
                  arms: rows.map(function (row) {
                    return {
                      name: row.approach.name,
                      /* 直接用 peakKey 取，不要再寫 AM/PM 三元判斷——
                         多了全日尖峰之後，三元判斷會把它當成 PM。 */
                      outbound: row.outbound[peakKey].pcu ?? 0,
                      inbound: row.inbound[peakKey].pcu ?? 0,
                    };
                  }),
                  vehicles: vehicleSum
                    ? vehicleIds
                        .map(function (id) {
                          return {
                            label: vehicleLabel(record, id),
                            share:
                              (recordVehicleTotal(
                                viewRecord(record),
                                compositionKey,
                                id,
                              ) /
                                vehicleSum) *
                              100,
                          };
                        })
                        .filter(function (item) {
                          return item.share > 0;
                        })
                        .sort(function (a, b) {
                          return b.share - a.share;
                        })
                    : [],
                };
              }),
            };
          }),
        siteOmitted: Math.max(0, exportRecords.length - SITE_SUMMARY_LIMIT),
        routelessRecords: exportRecords.filter(function (record) {
          return !record.routes?.length;
        }).length,
        compareIntersections: new Set(
          [...latestBySeries.values()].map(recordIntersectionKey),
        ).size,
        outbound,
        inbound,
        totals: {
          am: recordTotal(viewRecord(focus), "AM"),
          pm: recordTotal(viewRecord(focus), "PM"),
          /*
           * ⚠️ `hasScopeValue` 先問「這個範圍算不算得出來」。
           *   不問的話 recordTotal 會回 0，而 0 在報告裡讀起來是
           *   「這個範圍沒有車」，不是「這個範圍沒有資料」。
           *   siteSummaries 那一段 2026-09-21 就是為了同一件事加了 available。
           */
          day: hasScopeValue(viewRecord(focus), "DAY")
            ? recordTotal(viewRecord(focus), "DAY")
            : null,
          full: hasScopeValue(viewRecord(focus), "FULL")
            ? recordTotal(viewRecord(focus), "FULL")
            : null,
        },
        /*
         * 四個範圍各自的單位。
         * ⚠️ 一律走 scopeUnit()，不可以寫死——「全調查時段」滿 24 小時是
         *   PCU／調查日，否則是 PCU／調查時段；標成 PCU/hr 會把一整段的量
         *   講成一小時的量。這與 siteSummaries 那一段同一支函式。
         */
        scopeUnits: {
          am: scopeUnit("AM", "pcu", coverageOf([viewRecord(focus)])),
          pm: scopeUnit("PM", "pcu", coverageOf([viewRecord(focus)])),
          day: scopeUnit("DAY", "pcu", coverageOf([viewRecord(focus)])),
          full: scopeUnit("FULL", "pcu", coverageOf([viewRecord(focus)])),
        },
        flowTotals: {
          outboundAm: sumBy(outbound, "am") ?? 0,
          outboundPm: sumBy(outbound, "pm") ?? 0,
          inboundAm: sumBy(inbound, "am") ?? 0,
          inboundPm: sumBy(inbound, "pm") ?? 0,
          outboundDay: sumBy(outbound, "day"),
          outboundFull: sumBy(outbound, "full"),
          inboundDay: sumBy(inbound, "day"),
          inboundFull: sumBy(inbound, "full"),
        },
        vehicles: compositionCounts.map(function (item) {
          return {
            label: item.label,
            count: item.count,
            share: compositionTotal ? (item.count / compositionTotal) * 100 : 0,
          };
        }),
        compositionScope:
          compositionKey === "SURVEY" ? "全調查時段" : "上午尖峰小時",
        compositionUnit: compositionScopeUnit(focus, compositionKey),
        trend: trendRecords.map(function (record) {
          return {
            quarter: record.quarter,
            am: recordTotal(viewRecord(record), "AM"),
            pm: recordTotal(viewRecord(record), "PM"),
          };
        }),
        // 標籤一定要取自趨勢序列自己的第一筆，不能拿 focus 來標：
        // 兩者的挑選規則不同（趨勢取範圍內第一筆、focus 取最新一季），
        // 同一路口同時有平日與假日時會標成另一種資料別，數字與說明對不起來。
        trendLabel: trendRecords.length
          ? `${trendRecords[0].name || trendRecords[0].station}／${
              trendRecords[0].surveyType || "待設定"
            }`
          : "—",
        compare: Array.from(latestBySeries.values())
          .map(function (record) {
            return {
              name: siteLabelOf(record),
              am: recordTotal(viewRecord(record), "AM"),
              pm: recordTotal(viewRecord(record), "PM"),
              /* 見 armFlows：算不出來是 null，不是 0。 */
              day: hasScopeValue(viewRecord(record), "DAY")
                ? recordTotal(viewRecord(record), "DAY")
                : null,
              full: hasScopeValue(viewRecord(record), "FULL")
                ? recordTotal(viewRecord(record), "FULL")
                : null,
            };
          })
          .sort(function (a, b) {
            return b.am - a.am || b.pm - a.pm;
          }),
        topFlow,
        worstBalance,
        conservation: {
          checked: conservationChecked,
          passed: conservationPassed,
        },
        quality: {
          total: draftIssues.length,
          errors: draftIssues.filter(function (issue) {
            return issue.severity === "error";
          }).length,
          warnings: draftIssues.filter(function (issue) {
            return issue.severity === "warning";
          }).length,
          topCategories: Array.from(categoryCounts.entries())
            .sort(function (a, b) {
              return b[1] - a[1];
            })
            .slice(0, 2)
            .map(function (entry) {
              return `${entry[0]} ${entry[1]} 項`;
            }),
        },
        factors: Object.keys(focusMatrix)
          .sort()
          .map(function (id) {
            return {
              label:
                vehicleCatalog[id] ||
                VEHICLE_LABELS[id] ||
                CORE_VEHICLE_LABELS[id] ||
                id,
              left: focusMatrix[id].left,
              through: focusMatrix[id].through,
              right: focusMatrix[id].right,
            };
          }),
        factorMatrixCount: matrixSignatures.size,
        /*
         * ── 這一份草稿是在哪一組條件底下算出來的（2026-09-15 補）──────
         *
         * ⚠️ 其中兩項**本來就一路在改寫每一個數字**，只是舊版一個字都沒寫：
         *   ・尖峰時段判定方式：viewRecord() 套在這一段的每一筆紀錄上。
         *   ・轉向別：同樣經過 viewRecord，篩成「左轉」之後每一個 PCU 都變了。
         *   兩者都沒有控制項也沒有提示，而這段文字會被複製進正式報告。
         * ⚠️ 名稱一律取自 main-filters 的那一份標籤表，不在這裡另寫中文——
         *   同一件事寫在兩個地方就會漂移。
         */
        conditions: [
          {
            label: FIELD_LABELS.intersections,
            value: mainFilters.intersections.length
              ? `${mainFilters.intersections.length} 個（主工具列指定）`
              : "全部路口",
          },
          {
            label: FIELD_LABELS.peakRule,
            value: PEAK_RULE_LABELS[mainFilters.peakRule],
          },
          {
            label: FIELD_LABELS.movement,
            value: MOVEMENT_CHOICE_LABELS[mainFilters.movement],
          },
          {
            label: FIELD_LABELS.vehicle,
            /* ⚠️ 名稱一律走 showVehicle（＝mainVehicleOptions），不另外查目錄。 */
            value:
              mainFilters.vehicle === "all"
                ? "全部車種"
                : showVehicle(mainFilters.vehicle),
          },
          { label: FIELD_LABELS.day, value: DAY_LABELS[mainFilters.day] },
        ],
        /*
         * 「各方向各自認定自己的尖峰」時，各支線的尖峰不在同一小時，
         * 那些數字**不可以相加**——而草稿裡的「各支線駛出合計」正是把它們加起來。
         */
        peakRuleAdditive: mainFilters.peakRule !== "direction",
        digits: reportDraftDigits,
      };
    },
    /*
     * ⚠️ 相依從 yearStyle 換成 showQuarter：
     *   這一段現在只透過 showQuarter 取得季度文字，而 showQuarter 本身
     *   已經把 yearStyle 與 quarterLabels 都納進相依。
     *   再放一個 yearStyle 是多餘的（lint 會指出來），但**不可以兩個都拿掉**——
     *   少了 showQuarter，切換期別顯示時這一段會停在舊文字。
     */
    /*
     * ⚠️ viewRecord 也要列進來：判定方式一改，這一段裡的尖峰數字就要跟著換，
     *   少了它報告草稿會停在上一種判定方式算出來的值——而那份文字會被抄進報告。
     */
    [
      reportExportScope,
      selected,
      activeProject,
      vehicleCatalog,
      showQuarter,
      viewRecord,
      /*
       * ⚠️ 條件一改，草稿開頭那一段「統計條件」就要跟著換；
       *   小數位數一改，整份草稿的每一個數字都要重排。
       *   少列任何一項，草稿都會停在舊條件——而那份文字會被貼進報告。
       */
      mainFilters.intersections,
      mainFilters.peakRule,
      mainFilters.movement,
      mainFilters.vehicle,
      mainFilters.day,
      showVehicle,
      reportDraftDigits,
    ],
  );
  const draftSections = useMemo(
    function (): DraftSectionKey[] {
      if (draftSectionOverride) return draftSectionOverride;
      return (
        DRAFT_ONLY_SECTIONS.map(function (item) {
          return item.key as DraftSectionKey;
        }) as DraftSectionKey[]
      ).concat(activeReportItems);
    },
    [draftSectionOverride, activeReportItems],
  );
  const generatedReportDraft = useMemo(
    function () {
      return reportDraftContext
        ? buildReportDraft(reportDraftContext, draftSections)
        : "";
    },
    [reportDraftContext, draftSections],
  );
  useEffect(
    function () {
      if (!reportDraftEdited) setReportDraftText(generatedReportDraft);
    },
    [generatedReportDraft, reportDraftEdited],
  );
  /* 換計畫時草稿要重新開始，不然會把上一個計畫的文字留在畫面上。 */
  useEffect(
    function () {
      setDraftSectionOverride(null);
      setReportDraftEdited(false);
    },
    [activeProjectId],
  );
  function toggleDraftSection(key: DraftSectionKey) {
    const next = draftSections.includes(key)
      ? draftSections.filter(function (item) {
          return item !== key;
        })
      : DRAFT_SECTION_ORDER.filter(function (item) {
          return item === key || draftSections.includes(item);
        });
    setDraftSectionOverride(next);
  }
  /**
   * 目前資料的指紋（X-44）。
   *
   * 按下「執行資料異常檢查」時記下它；之後只要資料動過（匯入、刪除、
   * 人工修改），指紋就不一樣，畫面上會說「結果已過期，請重新檢查」。
   *
   * ⚠️ 用筆數＋每筆的修訂序號，不用 JSON.stringify 整包——
   *   那會在每次 render 都把全部紀錄序列化一遍。
   */
  const qualityDataStamp = `${projectRecords.length}:${projectRecords.reduce(
    function (sum, record) {
      return sum + (record.revision ?? 0);
    },
    0,
  )}:${quarter}`;
  /*
   * ══════════════════════════════════════════════════════════════════
   *  X-48：檢查範圍＝**這個計畫的全部季度**，不是只有當季
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-16：
   *   「如果我匯入了5季的資料，再按執行資料異常檢查按鈕，
   *     它是檢查5季還是單一季呢?」
   *
   * ⚠️ 舊版只掃當季（`issue.quarter === quarter`）。匯了 5 季只檢查最新一季，
   *   前四季的問題永遠不會被發現——而那些資料一樣會進報告。
   *   交通服務水準本來就掃全計畫，這一支是不一致的那一個。
   *
   * ⚠️ **摘要卡用的就是這一份（全部季度）**：那是「還有幾項沒處理」，
   *   縮小範圍會讓人以為問題變少了。
   * ⚠️ 要看某一季時用**這一頁自己的**季別下拉（issueQuarterFilter），
   *   它只影響下方的清單，不影響摘要卡。
   */
  const currentIssues = issues;
  /**
   * 一筆異常的指紋——「已確認」記在這把鑰匙上。
   *
   * ⚠️ 一定要帶 message。它裡面有數字與時段，所以內容一變指紋就變，
   *   上一次的確認**自動失效**、這一筆會重新出現。少了它，
   *   確認過一次之後同一個路口就再也不會提醒。
   */
  const issueFingerprint = useCallback(
    (issue: { id: string; message: string }) =>
      JSON.stringify([issue.id, issue.message]),
    [],
  );
  const ackMap = useMemo(
    () => ackedIssues[activeProjectId] || {},
    [ackedIssues, activeProjectId],
  );
  /*
   * 使用者指定了「哪一個才是調查日期」。
   *
   * ⚠️ 要**同時**寫覆寫與記為已確認：只寫覆寫的話這一列會一直掛著，
   *   只記確認的話系統仍然在用它自己猜的那一個日期。
   * ⚠️ 選回「請指定…」＝收回指定，覆寫與確認兩邊都要拿掉，
   *   否則會留下一個「已確認但沒有指定」的狀態，使用者看不懂。
   */
  const chooseSurveyDate = (
    issue: { id: string; message: string; choiceScope?: string },
    iso: string,
  ) => {
    const scope = issue.choiceScope;
    if (!scope) return;
    setSurveyDateOverrides(function (previous) {
      const own = { ...(previous[activeProjectId] || {}) };
      if (iso) own[scope] = iso;
      else delete own[scope];
      return { ...previous, [activeProjectId]: own };
    });
    toggleIssueAck(issueFingerprint(issue), Boolean(iso));
  };
  /** 只有「人工確認」類可以按確認——理由見 ackedIssues 的說明。 */
  const issueCanAck = useCallback(
    (issue: { resolution?: { kind?: string } }) =>
      issue.resolution?.kind === "人工確認",
    [],
  );
  const issueAcked = useCallback(
    (issue: { id: string; message: string; resolution?: { kind?: string } }) =>
      issueCanAck(issue) && Boolean(ackMap[issueFingerprint(issue)]),
    [ackMap, issueCanAck, issueFingerprint],
  );
  /*
   * ⚠️ 刻意**不**包 useCallback：notify 每次 render 都是新的函式，
   *   包起來的話相依陣列每次都變，等於白包一層，eslint 也會擋。
   *   這一支只在清單的按鈕上用，沒有 memo 邊界需要穩定的參考。
   */
  const toggleIssueAck = (fingerprint: string, on: boolean) => {
    setAckedIssues(function (previous) {
      const own = { ...(previous[activeProjectId] || {}) };
      if (on) own[fingerprint] = { at: new Date().toLocaleString("zh-TW") };
      else delete own[fingerprint];
      return { ...previous, [activeProjectId]: own };
    });
    notify(
      on
        ? "已記錄為「已確認」，下次檢查不再提醒。"
        : "已取消確認，這一筆會重新提醒。",
    );
  };
  const ackedCount = currentIssues.filter(issueAcked).length;
  /*
   * ══════════════════════════════════════════════════════════════════
   *  「還沒處理的」只有這一份（A10，使用者 2026-09-21 回報）
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者原話：
   *   「但左側欄位的資料維護 2，沒有恢復正常……是我沒確認成功還是 bug 呢?」
   *
   * 是 bug。他按完「已人工確認」之後，同一份資料在畫面上有**五個數字**，
   * 而**只有一個**扣掉了已確認：
   *   ① 側欄「資料維護」旁的紅字      currentIssues.length        ← 沒扣
   *   ② 本季檢核摘要的品質分數        100 − currentIssues.length×4 ← 沒扣
   *   ③ 摘要「待人工確認」            warning 的筆數              ← 沒扣
   *   ④ 摘要「需處理錯誤」            error 的筆數                ← 沒扣
   *   ⑤ 檢查結果的狀態列              currentIssues − ackedCount  ← 只有這個對
   *
   * 所以他按完確認，最顯眼的那個紅字 2 紋風不動，看起來像確認沒生效。
   *
   * ⚠️ **不可以把已確認的從 currentIssues 裡刪掉**：他還要能按「顯示已確認」
   *   把它們叫回來、也要能取消確認。所以留一份完整的、另外派生一份未確認的，
   *   凡是回答「**還有幾件事等著我處理**」的地方一律讀 openIssues。
   *
   * ⚠️ 新增「還有幾件待處理」的顯示時，**一定要用這一份**。
   *   這個專案最常犯的錯就是「該列 N 樣的地方只列了 1 樣」——
   *   tests/issue-ack-sync.test.mjs 會掃描，別讓它抓到第六個。
   */
  const openIssues = currentIssues.filter(function (issue) {
    return !issueAcked(issue);
  });
  /*
   * ══════════════════════════════════════════════════════════════════
   *  清掉「再也對不上任何一筆現存異常」的確認紀錄（使用者 2026-09-20）
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者原話（在交通服務水準上提出，三支同步）：
   *   「那我看完後我要怎麼點選確認，讓之後不會一直出現? 不然資料會累積
   *     越來越多」
   *
   * 他擔心的是畫面上的清單，但**真正會無限長大的是使用者看不到的
   * ackedIssues**：指紋是 [id, message]，訊息裡的數字一變舊紀錄就永遠是
   * 孤兒，只進不出。
   *
   * ⚠️ 只在「使用者真的按了執行檢查」之後清，而且只清孤兒。
   *   資料還沒載入就清，會把使用者上一季的確認全部誤殺。
   * ⚠️ 沒有孤兒時**不可以 setAckedIssues**：每按一次檢查就寫一次存檔，
   *   等於每次都製造一個沒有內容的變更。
   * ⚠️ 用 currentIssues（這一次檢查真的跑出來的全部項目），
   *   **不可以用畫面上篩過的那一份**——那會把「只是被篩掉」的確認當成孤兒清掉。
   */
  const pruneOrphanAcks = () => {
    setAckedIssues(function (previous) {
      const own = previous[activeProjectId] || {};
      const keys = Object.keys(own);
      if (!keys.length) return previous;
      const live = new Set(currentIssues.map(issueFingerprint));
      const kept: Record<string, { at: string }> = {};
      for (const key of keys) if (live.has(key)) kept[key] = own[key];
      if (Object.keys(kept).length === keys.length) return previous;
      return { ...previous, [activeProjectId]: kept };
    });
  };
  /*
   * 檢查結果的類型標籤篩選（使用者 2026-09-13 指定，三支同步）。
   * ⚠️ 依筆數由多到少排：最常發生的那一類排最前面，使用者才好「先挑最重大的看」。
   * ⚠️ 篩選只影響**畫面**；匯出與交付一律含全部項目——
   *   交付檔不該因為畫面上剛好篩了什麼而少東西。
   */
  const issueTypeCounts = (function () {
    const counts = new Map();
    for (const issue of currentIssues)
      counts.set(issue.category, (counts.get(issue.category) ?? 0) + 1);
    return [...counts.entries()].sort(function (a, b) {
      return b[1] - a[1];
    });
  })();
  /*
   * X-48：清單可以用**這一頁自己的**季別下拉縮小（預設「全部季度」）。
   * ⚠️ 只影響清單，不影響摘要卡——摘要卡永遠是全部季度的總數。
   */
  const shownIssues = currentIssues.filter(function (issue) {
    if (issueQuarterFilter && issue.quarter !== issueQuarterFilter) return false;
    if (issueTypeFilter.length && !issueTypeFilter.includes(issue.category))
      return false;
    /*
     * ⚠️ 已確認的預設收起來，但**不是刪掉**：上方另有一顆「顯示已確認（N）」
     *   可以叫回來、也可以取消確認。整個藏掉的話，使用者按完就再也找不到
     *   自己按過什麼——而那幾筆仍然會出現在交付檔案裡。
     */
    if (!showAckedIssues && issueAcked(issue)) return false;
    return true;
  });
  /* ⚠️ X-47：原本這裡是 selectedIssue（詳情面板用的），面板移除後一併拿掉。 */
  /*
   * ⚠️ 這裡原本有兩整段計算：「最高流量路口」的排名，以及「較上季」的
   *   逐路口配對（changeSeriesKey／previousByKey／comparablePairs／
   *   pairedChange）。2026-09-11 兩張卡片依使用者決定移除，計算也一併拿掉。
   *
   * ⚠️ **不留著沒人用的計算**：留著的話 eslint 只會報 unused，
   *   而它仍然每一次 render 都跑一遍（整季逐筆排序＋配對），
   *   而且下一個人會以為畫面上某處還在用它。
   *   真的要回來時，git 裡有完整的那一版（含站號配對那個修正）。
   *
   * ⚠️ 那個配對修正的結論值得留在這裡，免得日後重做時又踩一次：
   *   配對的鍵**不可以包含站號**——站號本來就會逐季改（T7-01 → T2-01），
   *   包含站號會讓比較永遠配不到，而畫面給的理由是
   *  「沒有可對應的同一路口資料」，聽起來像資料有問題。
   *   正確的鍵是 [路口, 資料別]；同一鍵有多筆（並存站號）時才用站號挑。
   */
  const importPeriod =
    importYear && importQuarterNo ? importYear + "Q" + importQuarterNo : "";
  /*
   * 寫進資料的季度一律用民國年寫法。
   *
   * 輸入框同時接受民國與西元，但如果照打的字原樣存下去，同一季會因為寫法
   * 不同而變成兩個不同的鍵——季度清單與歷季比較都是以這個字串分組的，
   * 115Q1 與 2026Q1 會並列成兩季且永遠不會合併（兩者的排序鍵完全相同，
   * 所以會相鄰出現，更難聯想到是寫法問題）。
   * 正規化規則在三支共用的 period-date 模組裡。
   */
  const importPeriodKey = normalizeSurveyPeriod(importPeriod);
  /*
   * 年度輸入只有「去掉非數字、截到四碼」，完全沒有範圍檢查。
   * normalizeSurveyPeriod() 只在民國 90～200（西元 2001～2111）這個窗口內
   * 換算，窗口外的四碼年份會原樣回傳——打成 2112 或 1990 就會直接把西元字串
   * 存成季度鍵。它和對應的民國寫法是同一季、排序鍵完全相同，畫面上只看得出
   * 「同一季出現了兩次」，很難想到是年份寫法造成的。
   */
  const importPeriodCheck = importPeriod
    ? checkSurveyPeriodInput(importPeriod)
    : null;
  const importPeriodReady = Boolean(importPeriodCheck?.ok);
  /*
   * ── 調查日期 × 期別檢查 ──────────────────────────────────────
   * 只讀 ImportPreview 已經解析好的表頭文字，不重新讀檔、不碰任何數值，
   * 也不會修改任何一筆紀錄。判斷邏輯集中在 lib/period-date.ts
   *（路口轉向／全日交通量／交通服務水準三支同一份）。
   */
  const importDateChecks = useMemo(
    function (): PeriodDateCheck[] {
      return importRows.map(function (row) {
        const candidates =
          row.dateCandidates && row.dateCandidates.length
            ? row.dateCandidates
            : row.dateSource
              ? [
                  {
                    text: row.dateSource.raw,
                    sheet: row.dateSource.sheet,
                    cell: row.dateSource.cell,
                  },
                ]
              : [];
        return checkPeriodAgainstDate(
          importPeriodKey,
          findSurveyDate(candidates),
          row.file,
        );
      });
    },
    [importRows, importPeriodKey],
  );
  const importDateMismatches = importDateChecks.filter(function (item) {
    return item.status === "mismatch";
  });
  /**
   * 所有「日期對不上」的檔案是不是都指向**同一季**？是的話才給一鍵切換。
   *
   * ⚠️ 指向好幾季時刻意不給按鈕：一顆按鈕表達不了「要改成哪一個」，
   *   隨便挑一個預設值，使用者按下去才發現改錯了——那比沒有按鈕更糟。
   *   那種情況本來就該分批匯入。
   */
  const importDateSuggestedPeriod = (function () {
    const labels = Array.from(
      new Set(
        importDateChecks
          .filter(function (item) {
            return item.status === "mismatch" && item.dateLabel;
          })
          .map(function (item) {
            return item.dateLabel;
          }),
      ),
    );
    return labels.length === 1 && labels[0] !== importPeriod ? labels[0] : "";
  })();
  const importDateUnknowns = importDateChecks.filter(function (item) {
    return item.status === "unknown";
  });
  const importVehicleDefinitions = [
    ...new Map(
      importRows
        .flatMap(function (row) {
          return row.detectedVehicles;
        })
        .map(function (definition) {
          return [definition.id, definition] as const;
        }),
    ).values(),
  ];
  /**
   * 這一批裡有幾個是系統沒有的新車種。
   *
   * ⚠️ 原生只有四個標準車種：機車、小型車、大型車、特種車。
   *   其餘一律是新車種，需要使用者決定「獨立分析」還是「併入哪一類」——
   *   決定錯了整季的 PCU 都會不對，所以畫面上一定要讓它跳出來。
   */
  const importNewVehicleCount = importVehicleDefinitions.filter(function (item) {
    return !item.core;
  }).length;
  /** 預覽產生之後，路口名稱有沒有被改過。 */
  const importNamesChanged =
    importRows.length > 0 &&
    Boolean(importNameSnapshot) &&
    importNameSnapshot !== intersectionNameSignature();
  const selectedVehicleIds = selected ? recordVehicleIds(selected) : [];
  const currentVehicleIds = [
    ...new Set(
      currentCanonicalRecords.flatMap(function (record) {
        return recordVehicleIds(record);
      }),
    ),
  ];

  /*
   * 一次把這個計畫裡還掛著「待設定」的紀錄補上資料別。
   *
   * 為什麼需要這顆按鈕：資料別是在「匯入當下」判定並存進每一筆紀錄的，之後不會
   * 重讀，程式改版也不會回頭改既有資料。所以舊版匯入時讀不到、存成待設定的
   * 那幾季，即使現在的版本讀得出來了，畫面上仍然掛著待設定——而且因為
   * 「待設定」和「平日」被當成兩種資料別，同一個路口的趨勢線會被拆成兩條
   * （選平日只剩 1 季、選待設定才有 4 季）。
   *
   * 一筆一筆改要切換路口與季度，很容易漏掉，所以提供這個批次入口。
   * 它只動「目前是待設定」的紀錄，已經是平日／假日的一律不碰，
   * 而且每一筆都會先存還原點。
   */
  function pendingSurveyTypeRecords(intersectionKey?: string) {
    return projectRecords.filter(function (record) {
      if ((record.surveyType || "待設定") !== "待設定") return false;
      if (!intersectionKey) return true;
      return recordIntersectionKey(record) === intersectionKey;
    });
  }

  function assignPendingSurveyType(value: string, intersectionKey?: string) {
    const targets = pendingSurveyTypeRecords(intersectionKey);
    if (!targets.length) return notify("目前沒有『待設定』的紀錄。");
    if (!authorizeLockedChange(targets, "批次指定資料別")) return;
    /*
     * 一定要把「是哪幾筆」列出來。
     * 這個計畫可能真的同時做過平日與假日調查，只是其中幾筆讀不出來；
     * 只寫「N 筆」的話，使用者無從判斷全部指定為平日對不對。
     */
    const listed = targets
      .map(function (record) {
        return "・" + record.quarter + "　" + record.station + "　" + record.name;
      })
      .join("\n");
    if (
      !confirm(
        "要把以下 " +
          targets.length +
          " 筆「待設定」指定為「" +
          value +
          "」嗎？\n\n" +
          listed +
          "\n\n" +
          "只會更動上列這幾筆，已經是平日／假日的不會被改到。\n" +
          "如果其中有的其實是假日，請按取消，改到「流量核對工作台」逐筆指定。\n" +
          /*
           * ⚠️ 不可以再寫「之後可以在『版本差異與還原』還原」——
           *   那一塊已於 2026-09-15 從畫面移除（使用者裁示）。
           *   叫使用者去一個不存在的地方，比什麼都不說更糟。
           */
          "每一筆都會先自動保存還原點（系統內部保留，畫面上不提供還原入口）。\n" +
          "如果改錯了，請刪掉這一季重新匯入，或還原備份檔。",
      )
    )
      return;
    const ids = new Set(targets.map((record) => record.id));
    saveRevisions(targets, "批次指定資料別前自動保存");
    setRecords(
      records.map(function (record) {
        return ids.has(record.id) ? { ...record, surveyType: value } : record;
      }),
    );
    notify(
      "已把 " + targets.length + " 筆「待設定」指定為「" + value + "」。",
    );
  }

  /*
   * 一次操作＝一個還原點批次。
   *
   * 舊寫法是每一筆紀錄各呼叫一次、各自成為一個還原點，所以一次涵蓋
   * 65 個路口的批次匯入就長出 65 個項目，而且淘汰時（原本 slice(0, 300)）
   * 會把同一次操作攔腰切斷，還原回去只還原一半。
   * 現在同一次操作的每一筆共用一個 batchId，淘汰也整批進出
   * （見 trimRevisionBatches）。
   */
  function saveRevisions(targets: TrafficRecord[], reason: string) {
    if (!targets.length) return;
    // 只在使用者觸發儲存時執行，不是 render 階段的計算。
    // eslint-disable-next-line react-hooks/purity
    const stamp = Date.now().toString(36);
    const batchId = "B-" + stamp;
    const savedAt = new Date().toISOString();
    const batchLabel =
      targets.length > 1 ? reason + "，涵蓋 " + targets.length + " 個路口" : reason;
    const batch: RecordRevision[] = targets.map(function (record, index) {
      return {
        id: record.id + "-R-" + stamp + "-" + index,
        recordId: record.id,
        savedAt,
        reason,
        snapshot: structuredClone(record),
        batchId,
        batchLabel,
        batchSize: targets.length,
      };
    });
    setRecordRevisions(function (items) {
      return trimRevisionBatches([...batch, ...items]);
    });
  }

  function saveRevision(record: TrafficRecord, reason: string) {
    saveRevisions([record], reason);
  }

  function authorizeLockedChange(targets: TrafficRecord[], action: string) {
    const locked = targets.filter(function (record) {
      return Boolean(record.resultLock);
    });
    if (!locked.length) return true;
    const conflicts = locked.map(lockConflict).filter(Boolean);
    return confirm(
      action +
        "會修改 " +
        locked.length +
        " 筆已鎖定成果。" +
        (conflicts.length
          ? "\n另偵測到：" + Array.from(new Set(conflicts)).join("；")
          : "") +
        "\n是否解除相關成果鎖定並繼續？",
    );
  }

  function lockCurrentQuarter() {
    if (!current.length) return notify("目前季度沒有可鎖定的成果。");
    /*
     * ── 審核狀態要真的管到鎖定 ──
     *
     * 使用者問得很直接：不論審核狀態是「待核對」「已核對」「已確認」還是
     * 「需修正」，右上角的「鎖定成果」都按得下去，那這個欄位到底在幹嘛？
     * 舊版的答案是「什麼都沒幹」——它只是一個備註欄，鎖定完全不看它。
     *
     * 現在把兩者接起來：
     *   ・有任何一筆標成「需修正」→ 直接擋下來。那是使用者自己標的
     *     「這筆有問題」，鎖定的意思卻是「這批成果定案了」，兩件事互相矛盾。
     *   ・還有「待核對」→ 問一次，並把是哪幾個路口列出來。
     *   ・全部「已核對」或「已確認」→ 直接鎖。
     * 鎖定之後審核狀態就不能再改（見核對工作台），要改得先解除鎖定。
     */
    const labelOf = function (record: TrafficRecord) {
      return record.station + " " + record.name;
    };
    const needsFix = current.filter(function (record) {
      return record.review?.status === "需修正";
    });
    if (needsFix.length)
      return notify(
        "有 " +
          needsFix.length +
          " 筆的成果審核狀態是「需修正」，不能鎖定：" +
          needsFix.map(labelOf).join("、") +
          "。請先處理並改成「已核對」或「已確認」。",
      );
    const unchecked = current.filter(function (record) {
      return (record.review?.status || "待核對") === "待核對";
    });
    if (
      unchecked.length &&
      !confirm(
        "有 " +
          unchecked.length +
          "／" +
          current.length +
          " 筆還是「待核對」，尚未有人核對過：\n" +
          unchecked.map(labelOf).join("\n") +
          "\n\n鎖定的意思是這一季的成果定案，之後要改名稱、角度、流向或重新匯入都會先跳出確認。\n仍要現在鎖定嗎？",
      )
    )
      return;
    const now = new Date().toISOString();
    setRecords(function (all) {
      return all.map(function (record) {
        if (record.projectId !== activeProjectId || record.quarter !== quarter)
          return record;
        return {
          ...record,
          resultLock: {
            lockedAt: now,
            version: VERSION,
            signature: resultSignature(record),
          },
        };
      });
    });
    notify(quarter + " 成果已鎖定。");
  }

  function unlockCurrentQuarter() {
    const locked = current.filter(function (record) {
      return record.resultLock;
    });
    if (!locked.length) return;
    if (
      !confirm(
        "確定解除 " +
          quarter +
          " 的成果鎖定？解除後名稱、角度、流向與資料可再次修改。",
      )
    )
      return;
    setRecords(function (all) {
      return all.map(function (record) {
        return record.projectId === activeProjectId &&
          record.quarter === quarter
          ? { ...record, resultLock: undefined }
          : record;
      });
    });
    notify(quarter + " 已解除鎖定。");
  }

  useEffect(
    function () {
      if (view !== "import" || importYear || importQuarterNo) return;
      const match = quarter.match(/^(\d{2,4})Q([1-4])$/i);
      if (match) {
        setImportYear(match[1]);
        setImportQuarterNo(match[2]);
      }
    },
    [view, quarter, importYear, importQuarterNo],
  );

  /*
   * ══════════════════════════════════════════════════════════════════
   *  修改既有計畫的名稱／代碼／委託單位／備註
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-11：「我們有說，針對計畫，我們要可以手動編輯計畫名稱／
   * 計畫編號等資訊」。他記得三支程式都有，但**這一支從來沒有過**——
   * 只有 addProject 與 deleteProject。查證結果如此，如實回報。
   *
   * ⚠️ 這不是「小功能」：計畫名稱打錯時，舊版唯一的辦法是刪掉重建，
   *   而刪除會連同那個計畫的所有季度路口資料一起消失。
   *
   * ⚠️ 只動 projects 這一份清單，**不碰任何一筆 records**。
   *   路口資料是靠 projectId 關聯的，改名稱不該動到資料；
   *   哪天改成用名稱關聯，這裡就會變成改個名字資料全不見。
   */
  function saveProjectEdit() {
    const target = projects.find(function (p) {
      return p.id === editingProjectId;
    });
    if (!target) return;
    if (!projectForm.name.trim()) return notify("計畫名稱不可以是空的。");
    setProjects(
      projects.map(function (project) {
        return project.id === target.id
          ? {
              ...project,
              code: projectForm.code.trim() || project.code,
              name: projectForm.name.trim(),
              client: projectForm.client.trim(),
              note: projectForm.note.trim(),
            }
          : project;
      }),
    );
    setEditingProjectId("");
    setProjectForm({ code: "", name: "", client: "", note: "" });
    notify("計畫資訊已更新，季度與路口資料不受影響。");
  }
  function startProjectEdit(project: Project) {
    setEditingProjectId(project.id);
    setProjectForm({
      code: project.code || "",
      name: project.name || "",
      client: project.client || "",
      note: project.note || "",
    });
  }
  function cancelProjectEdit() {
    setEditingProjectId("");
    setProjectForm({ code: "", name: "", client: "", note: "" });
  }
  function addProject() {
    if (!projectForm.name.trim()) return notify("請先輸入計畫名稱。");
    // 只在使用者按下新增計畫時執行，不是 render 階段的計算。
    // eslint-disable-next-line react-hooks/purity
    const id = "P-" + Date.now().toString(36);
    const project: Project = {
      id: id,
      code: projectForm.code.trim() || "P" + (projects.length + 1),
      name: projectForm.name.trim(),
      client: projectForm.client.trim(),
      note: projectForm.note.trim(),
      createdAt: new Date().toISOString(),
    };
    setProjects([...projects, project]);
    setActiveProjectId(id);
    setProjectForm({ code: "", name: "", client: "", note: "" });
    notify("計畫已建立，現在可匯入第一季資料。");
  }

  function deleteProject(project: Project) {
    const projectRows = records.filter(function (record) {
      return record.projectId === project.id;
    });
    const projectQuarters = new Set(
      projectRows.map(function (record) {
        return record.quarter;
      }),
    ).size;
    const confirmed = confirm(
      "確定刪除計畫「" +
        project.code +
        " · " +
        project.name +
        "」？\n將一併刪除 " +
        projectRows.length +
        " 筆路口資料、" +
        projectQuarters +
        " 個季度。此動作無法復原，建議先匯出備份。",
    );
    if (!confirmed) return;
    const remainingProjects = projects.filter(function (item) {
      return item.id !== project.id;
    });
    setProjects(remainingProjects);
    setRecords(
      records.filter(function (record) {
        return record.projectId !== project.id;
      }),
    );
    /*
     * 這個計畫的每一份設定與還原點也要跟著刪掉，否則會留下孤兒資料，
     * 一直吃儲存空間（空間不足時的降級寫入正是先丟還原點），
     * 而且下次若出現同 id 的計畫會撿到上一個計畫的當量矩陣。
     * ⚠️ 儲存層是 IndexedDB（v2.1.53 起），不是 localStorage。
     */
    const dropProject = function <T>(map: Record<string, T>) {
      const next = { ...map };
      delete next[project.id];
      return next;
    };
    setPceByProject(dropProject(pceByProject));
    /* ⚠️ 覆寫也是依計畫存的，刪計畫時一定要一起清掉。 */
    setPceScopesByProject(dropProject(pceScopesByProject));
    setCatalogByProject(dropProject(catalogByProject));
    setMappingsByProject(dropProject(mappingsByProject));
    /*
     * ⚠️ 路口別名的鍵是「計畫id｜舊名」，不是單純的計畫 id，
     *   所以 dropProject 清不掉，要自己依前綴篩。
     *   漏掉的話會留下一堆撿不回來的孤兒（新計畫是新的 id，對不上），
     *   只是一直佔儲存空間——而空間不足時的降級寫入正是先丟還原點，
     *   等於別人的資料替它背黑鍋。（儲存層是 IndexedDB，見 lib/state-storage.ts。）
     */
    const aliasPrefix = project.id + "|";
    setIntersectionAliases(
      Object.fromEntries(
        Object.entries(intersectionAliases).filter(function (entry) {
          return !entry[0].startsWith(aliasPrefix);
        }),
      ),
    );
    const removedIds = new Set(
      records
        .filter(function (record) {
          return record.projectId === project.id;
        })
        .map(function (record) {
          return record.id;
        }),
    );
    setRecordRevisions(
      recordRevisions.filter(function (revision) {
        return !removedIds.has(revision.recordId);
      }),
    );
    if (activeProjectId === project.id) {
      setActiveProjectId(remainingProjects[0]?.id || "");
      setQuarter("");
      setSelectedIntersection("");
      setImportRows([]);
    setNoonAsked(false);
      setNoonAsked(false);
      setImportResolutions({});
      setView("projects");
    }
    notify("已刪除計畫「" + project.name + "」。");
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    if (!importPeriod) return notify("請先選擇調查年度與季度，再選取檔案。");
    if (importPeriodCheck && !importPeriodCheck.ok)
      return notify(surveyPeriodInputMessage(importPeriodCheck.reason));
    setImporting(true);
    try {
    const all = Array.from(files);
    /*
     * 每讀完一份就讓出主執行緒一個「巨集任務」的時間。
     * 只 await 一個已完成的 Promise 只會讓出微任務，瀏覽器不會重畫，
     * 進度數字會整批卡到最後才一次跳完。
     */
    const breathe = () => new Promise((done) => setTimeout(done, 0));
    /*
     * 第一次解析之前，要**確定畫面已經重繪過**。
     *
     * setTimeout(0) 只是讓出一個巨集任務，不保證瀏覽器有機會畫。
     * 實測（交通服務水準，6 份 1.7MB 的檔）：狀態停在「已完成 0／6 份」，
     * 每 20ms 的心跳整段只跳了 1 次——單一檔案解析的過程主執行緒完全被佔住，
     * 畫面零重繪。使用者回報「按下選擇檔案之後，作業系統的檔案對話框
     * 沒有自動關閉，但系統仍在匯入」就是這個原因：畫面來不及重繪，
     * 對話框關閉後的殘影留在螢幕上。三支的解析流程一樣，所以一起處理。
     *
     * ⚠️ 分頁在背景時 requestAnimationFrame 不會觸發，一定要有時間退路，
     *    否則匯入會永遠停住。
     */
    const paint = () =>
      new Promise<void>((done) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          done();
        };
        const fallback = setTimeout(finish, 250);
        if (typeof requestAnimationFrame === "function")
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              clearTimeout(fallback);
              finish();
            }),
          );
      });
    setImportProgress({ done: 0, total: all.length, file: all[0]?.name ?? "" });
    await paint();
    const rows: ImportPreview[] = [];
    let parsedCount = 0;
    for (const file of all) {
      setImportProgress({
        done: parsedCount,
        total: all.length,
        file: all[parsedCount]?.name ?? file.name,
      });
      await breathe();
      try {
        rows.push(...(await inspectWorkbookVariants(file, pce)));
      } catch (error) {
        rows.push({
          file: file.name,
          station: "",
          stationSource: "none",
          name: normalizeIntersectionName(file.name),
          role: "無法辨識",
          roleReason:
            "這個檔案讀取失敗，系統沒有機會判斷內容。這不是檔名的問題。",
          sheets: { traffic: [], log: [], phase: [], ignored: [] },
          intervals: 0,
          peakWindows: { AM: null, PM: null, DAY: null },
          date: "",
          dateSource: null,
          surveyType: "待設定",
          layout: "unknown",
          approaches: [],
          columns: [],
          detectedVehicles: [],
          mappingConfidence: "low",
          warnings: [
            "讀取失敗：" +
              (error instanceof Error ? error.message : "未知錯誤"),
          ],
          pceUsed: structuredClone(pce),
        });
      }
      parsedCount += 1;
      await breathe();
    }
    const detectedDefinitions = new Map<
      string,
      { id: string; label: string }
    >();
    rows.forEach(function (row) {
      row.detectedVehicles.forEach(function (definition) {
        detectedDefinitions.set(definition.id, definition);
      });
    });
    const conflicts: Record<string, ImportConflictMode> = {};
    rows.forEach(function (row) {
      const existing = records.find(function (record) {
        return (
          record.projectId === activeProjectId &&
          record.quarter === importPeriodKey &&
          record.station === row.station &&
          (record.surveyType || "待設定") === (row.surveyType || "待設定")
        );
      });
      if (existing) conflicts[row.file] = "version";
    });
    setImportConflictModes(conflicts);
    /*
     * 預覽階段就把新車種寫進車種目錄／對應／當量矩陣，是為了讓下面的
     * 「車種歸類」面板馬上能操作。但那會讓「取消預覽」的承諾（正式資料
     * 完全不會變動）變成假的——實測取消之後，當量矩陣永遠多出一列，
     * 而畫面上沒有任何地方可以把它刪掉。
     * 所以這裡記下「這次預覽新增了哪些」，取消時原樣還原。
     */
    const addedNow: string[] = [];
    detectedDefinitions.forEach(function (definition) {
      if (!vehicleCatalog[definition.id] && !CORE_VEHICLE_LABELS[definition.id])
        addedNow.push(definition.id);
    });
    setPreviewAddedVehicles(addedNow);
    setVehicleCatalog(function (existing) {
      const next = { ...CORE_VEHICLE_LABELS, ...existing };
      detectedDefinitions.forEach(function (definition) {
        next[definition.id] = definition.label;
      });
      return next;
    });
    setVehicleMappings(function (existing) {
      const next = { ...existing };
      detectedDefinitions.forEach(function (definition) {
        if (!next[definition.id]) next[definition.id] = definition.id;
      });
      return next;
    });
    setPce(function (existing) {
      const next = structuredClone(existing);
      detectedDefinitions.forEach(function (definition) {
        if (!next[definition.id])
          next[definition.id] = { left: 1, through: 1, right: 1 };
      });
      return next;
    });
    const resolutions = matchRowsToIntersections(rows);
    setFormatMemories(function (existing) {
      const next = [...existing];
      rows
        .filter(function (row) {
          return Boolean(row.templateId);
        })
        .forEach(function (row) {
          const sheetPattern = row.sheets.traffic
            .map(function (name) {
              return name.normalize("NFKC").replace(/\d+/g, "#");
            })
            .sort()
            .join("｜");
          const id = [row.templateId, sheetPattern, row.columns.length].join(
            "::",
          );
          const found = next.findIndex(function (memory) {
            return memory.id === id;
          });
          const value: FormatMemory = {
            id,
            templateId: row.templateId || "semantic-turning-v1",
            templateName: row.templateName || "一般語意轉向表",
            sheetPattern,
            columnCount: row.columns.length,
            sampleFile: row.file,
            uses: found >= 0 ? next[found].uses + 1 : 1,
            lastUsedAt: new Date().toISOString(),
          };
          if (found >= 0) next[found] = value;
          else next.push(value);
        });
      return next
        .sort(function (a, b) {
          return b.lastUsedAt.localeCompare(a.lastUsedAt);
        })
        .slice(0, 50);
    });
    /*
     * ★ 預覽改成**累加**，不是覆蓋。
     *
     * 使用者實測回報：「先只匯入 A 資料，預覽就顯示了 A；不立刻按匯入、
     * 再繼續選擇 B，預覽就變成了 B，而不是 A 和 B 同時顯示。」
     *
     * 一次挑幾個、看一眼、再挑幾個是很自然的操作，而舊行為會把前一批
     * **無聲丟掉**——使用者按下確認時，以為兩批都寫進去了。
     *
     * 同一個檔名再選一次＝以新的那次為準（重新解析過），不會變成兩列。
     */
    setImportRows(function (previous) {
      const incoming = new Set(rows.map(function (row) { return row.file; }));
      return [
        ...previous.filter(function (row) { return !incoming.has(row.file); }),
        ...rows,
      ];
    });
    setImportResolutions(function (previous) {
      return { ...previous, ...resolutions };
    });
    /*
     * 記下「比對當下，這個計畫的路口名稱長什麼樣」。
     * 之後只要這串變了，就代表名稱被改過，「名稱處理」欄可能已經過期。
     */
    setImportNameSnapshot(intersectionNameSignature());
    setImportRowPeriod(function (previous) {
      const next = { ...previous };
      for (const row of rows) next[row.file] = importPeriodKey || "";
      return next;
    });
    /*
     * ★ 解析完成後把畫面帶到「匯入辨識結果」標題——**一律**，不分有沒有異常。
     *
     * ── 為什麼改成固定一個目標（2026-09-10 使用者實測後定案）──────────
     *
     * 舊版分兩條路：有需要確認的列就捲到那一列，全部乾淨才捲到面板。
     * 使用者實測抓到兩個現象：
     *   (1) 「資料匯入成功，也沒有任何異常，但畫面跳轉的位置卻是異常確認表」
     *   (2) 「第一筆正確跳到確認鍵，之後每次都跳到異常確認表了」
     *
     * 原因是**選錯目標元素**：
     *   (1) `[data-needs-check]` 的判定範圍比「異常」寬，沒有異常時照樣命中。
     *   (2) 預覽改成累加之後，第二批一定找得到前一批留下的那一列。
     *
     * 使用者的建議（本版採用）：「不論有沒異常，都統一跳轉到『匯入辨識結果』
     * 標題的位置」。這個標題**只有一個**，不會因為匯入幾筆、有沒有異常而改變，
     * 正好解掉「容易跑掉」的根源。
     *
     * ⚠️ 使用者這句要記牢：「如果系統只靠算間距去做跳轉，這樣容易跳錯位置」。
     *    這裡用的是 scrollIntoView（不是自己算 offset），但**選錯目標元素**
     *    和算錯間距一樣糟——他看到的結果沒有差別。
     *
     * 要快速找到第一筆異常，改用異常表上那顆按鈕（按了才動，不會和版面高度、
     * 匯入筆數互相影響）。
     *
     * ⚠️ 只在「解析剛結束」這一刻捲一次。之後使用者可能正在輸入站號，
     *    再自動捲會把他正在打字的欄位捲走。
     * ⚠️ 要等 React 把預覽畫出來才捲得到，所以放在兩層 rAF 之後
     *    （一層只保證進到下一幀，畫面不一定已經 commit）。
     */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document
          .getElementById("import-preview-panel")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    } finally {
      // 即使後續整理或記憶範本時發生非預期錯誤，也不能讓選檔按鈕永遠卡在停用狀態。
    setImporting(false);
    setImportProgress(null);
    }
  }

  /**
   * 這一批預覽裡，有幾個檔需要使用者親自確認。
   *
   * 判準要與預覽表格裡逐列標記的 `needsCheck` **完全一致**——
   * 兩邊各寫一份就會漂移，畫面說「有 2 個要確認」卻只有 1 列標黃，
   * 那比不提示更糟。
   */
  /**
   * 預覽裡有沒有「在別的季度之下解析、卻要寫進目前季度」的列。
   *
   * 預覽改成累加之後才會發生：先在 112Q4 選了 A、改成 113Q1 再選 B，
   * 兩批都還在預覽裡，而寫入是整批寫進目前選的季度。
   * 這種情況**一定要擋**——A 會被寫到錯的季別，而且事後看不出來。
   */
  const importPeriodMismatch = importRows.filter(function (row) {
    const parsed = importRowPeriod[row.file];
    return Boolean(parsed) && Boolean(importPeriodKey) && parsed !== importPeriodKey;
  });
  /**
   * 預覽裡總共出現過幾個不同的「解析季別」。
   *
   * ⚠️ 這個數字決定要不要**擋死**，是這一整段的關鍵：
   *
   *   ・**只有 1 個**（而且與目前選的不同）＝ 使用者是**整批**在某一季之下
   *     預覽的，後來才把季別改成正確的那一個。這種情況沒有混批風險——
   *     每一筆的去向都一樣，而且就是他現在選的那一季。
   *     使用者 2026-09-11 實測遇到：先選了 114Q2、匯入時才發現檔案是 114Q3，
   *     改好季別之後卻按不下去，只能取消重選。**擋過頭了。**
   *
   *   ・**2 個以上**＝ 預覽裡真的混了不同季別的批次。這時無論寫進哪一季，
   *     都一定有一批是錯的，而且**事後看不出來**——這種一定要擋死。
   *
   * ⚠️ 這裡算的是「解析季別」的**種類數**，不是不一致的列數。
   *   用列數判斷的話，3 個檔案同樣都來自 114Q2 會被當成「3 筆不一致」而擋死，
   *   那就退回改版前的行為了。
   */
  const importParsedPeriods = Array.from(
    new Set(
      importRows
        .map(function (row) {
          return importRowPeriod[row.file];
        })
        .filter(Boolean),
    ),
  );
  /** 真的混批：預覽裡有兩種以上的解析季別 → 一定要擋死。 */
  const importPeriodMixed = importParsedPeriods.length > 1;
  /** 整批同一個解析季別、只是目標季別改了 → 放行，但寫入時要再問一次。 */
  const importPeriodShifted =
    !importPeriodMixed && importPeriodMismatch.length > 0;

  const importNeedsCheck = importRows.filter(importRowNeedsCheck).length;
  const importHasIssue = importRows.filter(importRowHasIssue).length;

  /**
   * 把預覽列比對到既有路口——**parse 當下與「重新比對」共用這一支**。
   *
   * ⚠️ 抽成函式的理由：使用者 2026-09-11 問「預覽開著的時候去改路口名稱，
   *   回來按匯入會怎樣？」——答案是「名稱處理」欄停在選檔當下的決定，
   *   不會重算。要補「用目前的名稱重新比對」就一定要再跑一次同一套規則，
   *   而規則寫兩份遲早會分岔：改名後重比的結果與當初選檔的結果不一致，
   *   使用者完全無從判斷哪一個才對。
   */
  function matchRowsToIntersections(rows: ImportPreview[]) {
    const known = new Map<string, TrafficRecord>();
    projectRecords.forEach(function (record) {
      known.set(recordIntersectionKey(record), record);
    });
    const resolutions: Record<string, ImportResolution> = {};
    rows.forEach(function (row) {
      const rawKey = canonicalIntersectionKey(row.name);
      /*
       * 先查別名。使用者把路口改過名之後，調查表裡仍然是舊名——
       * 沒有這一步的話每一季都會退回「請自己選要不要併入」。
       * 別名可能被改過好幾手（A→B→C），所以要跟著鏈走完；
       * 加上訪問過的集合，避免有人不小心設出 A→B→A 這種環而無限迴圈。
       */
      let key = rawKey;
      const seen = new Set<string>([key]);
      for (let hop = 0; hop < 10; hop += 1) {
        const next = intersectionAliases[activeProjectId + "|" + key];
        if (!next || seen.has(next)) break;
        seen.add(next);
        key = next;
      }
      const existing = [...known.values()].find(function (record) {
        return canonicalIntersectionKey(record.name) === key;
      });
      if (existing) {
        resolutions[row.file] = {
          action: "auto",
          targetId: recordIntersectionKey(existing),
        };
        return;
      }
      const possible = [...known.values()]
        .map(function (record) {
          return { record, score: nameSimilarity(row.name, record.name) };
        })
        .sort(function (a, b) {
          return b.score - a.score;
        })[0];
      resolutions[row.file] =
        possible && possible.score >= 0.58
          ? {
              action: "merge",
              targetId: recordIntersectionKey(possible.record),
            }
          : { action: "auto-new" };
    });
    return resolutions;
  }

  /**
   * 這個計畫目前所有路口名稱的簽章。
   *
   * ⚠️ 用**正規化後的鍵**而不是原字串：只改了括號或全半形的那種「改名」，
   *   比對結果本來就不會變，不該跳提示去吵使用者。
   */
  function intersectionNameSignature() {
    return projectRecords
      .map(function (record) {
        return canonicalIntersectionKey(record.name);
      })
      .sort()
      .join("｜");
  }

  /*
   * ── 橫跨中午的尖峰：寫入前先問 ──────────────────────────
   *
   * 使用者 2026-09-12：「匯入 > 程式一發現 > 詢問 > 確認後 > 立刻按照分類
   *   算出正確的上下午尖峰 然後就固定。之後不能因為確認過1次分類以後就固定，
   *   而是每次都發現相同情況時都要做詢問，然後也要有取消功能，因為也有可能
   *   是檔案數值誤植，使用者可以取消 重新檢查檔案 再重新匯入。」
   *
   * 四個選項（編號照使用者寫的）：
   *   1. 取消不匯入   2. 忽略這個時段   3. 算上午   4. 算下午
   *
   * ⚠️ **每一次匯入都重新問**，不記住上一次的答案——他的理由是
   *   「也有可能是檔案數值誤植」，上一次的判斷不必然適用這一次的檔案。
   */
  const [noonAsked, setNoonAsked] = useState(false);
  const noonQuestionRows = useMemo(
    function () {
      return importRows.filter(function (row) {
        return Boolean(row.noonQuestion) && row.role === "原始交通量";
      });
    },
    [importRows],
  );
  /** 使用者在預覽列改了決定。 */
  function setNoonSide(file: string, side: NoonSide | "skip") {
    setImportRows(function (rows) {
      return rows.map(function (row) {
        if (row.file !== file) return row;
        return side === "skip"
          ? { ...row, noonSide: undefined, noonSkip: true }
          : { ...row, noonSide: side, noonSkip: false };
      });
    });
  }
  function commitImport() {
    if (!activeProjectId) return notify("請先建立並選擇計畫。");
    /*
     * ⚠️ 問題要在**寫入之前**問。寫完再補問的話，中間那段時間系統裡會躺著
     *   一筆「AM Peak 可能少報了」的資料，而畫面上完全看不出來。
     */
    if (noonQuestionRows.length && !noonAsked) {
      setNoonAsked(true);
      return;
    }
    if (!importPeriodCheck?.ok)
      return notify(
        importPeriodCheck
          ? surveyPeriodInputMessage(importPeriodCheck.reason)
          : "請先選擇調查年度與季度。",
      );
    const q = importPeriodKey;
    if (!q) return notify("請先選擇調查年度與季度。");
    /*
     * ── 預覽季別與寫入季別不同 ────────────────────────────────
     *
     * ⚠️ 混批（兩種以上的解析季別）在按鈕那一層就已經停用了，走不到這裡。
     *   走到這裡的一定是「整批同一個解析季別、使用者把目標季別改了」。
     *
     * 這種情況資料會寫進**目前選的季別**（就是使用者剛改成的那一個），
     * 通常正是他要的。但也可能是「改了季別準備選下一批、卻先按了寫入」，
     * 所以要再問一次，而且要把**兩個季別都寫出來**——
     * 只寫「確定嗎」的確認框沒有任何資訊，按的人只會一直按確定。
     */
    if (importPeriodMixed)
      return notify(
        "預覽裡混了不同季別的批次，無論寫進哪一季都會有一批是錯的。請按「取消預覽」重來，或分批寫入。",
      );
    if (importPeriodShifted) {
      const parsedPeriod = importParsedPeriods[0];
      const confirmed = window.confirm(
        `這批 ${importRows.length} 個檔案原本是在「${quarterLabel(parsedPeriod)}」之下預覽的，` +
          `現在要整批寫進「${quarterLabel(q)}」。\n\n` +
          `如果你是「選完檔才發現季別選錯、剛改好」，按確定就對了。\n` +
          `如果你是「改季別準備選下一批」，請按取消，先把這一批寫進 ${quarterLabel(parsedPeriod)}。`,
      );
      if (!confirmed) return;
    }
    /*
     * 站號在檔案與檔名都讀不到時，使用者可以在預覽列補填；這裡把補填的值
     * 併回去再判斷。沒有站號的紀錄不能寫入——站號是覆蓋更新的比對鍵之一，
     * 讓它空著會讓同一個路口的兩季資料對不起來。
     */
    const withStation = importRows.map(function (row) {
      const raw = (stationOverrides[row.file] || "").trim();
      /*
       * 使用者填的站號要走與系統其他地方相同的正規化。
       *
       * 訊息本身就叫他「改成含 T<站號> 的格式（例如 11500T01-02_路口名稱.xls）」，
       * 所以他很自然會照樣填整串案號＋站號。若原樣存下去，同一路口另一季由
       * 檔名推出來的是 `T14-02`，兩季的站號對不起來，覆蓋更新與歷季比較就失效
       * ——等於換一種方式重現我們正要修掉的那個問題。
       */
      /*
       * ⚠️ 切不出 T 站號時的退路，2026-09-11 補上正規化。
       *
       * 舊寫法是 `|| raw`，而 raw 只做過 trim()——**字串中間的空白原樣留著**。
       * 使用者漏打 T、或從表格複製貼上時打成「1 4-02」「Ｔ14-02」，
       * 這一季就存成一個獨立的站號；下一季由檔名推出來的是 `T14-02`，
       * 兩季對不起來 → 歷季趨勢畫成斷線，而畫面寫的是「這一季找不到這個站」。
       * 站號是覆蓋更新的比對鍵之一，所以這不只是難看。
       *
       * stationFromFilename() 本身已經有 NFKC；這裡補的是它切不出來時的那一條路。
       */
      const fallback = raw.normalize("NFKC").replace(/[\s\u3000]/g, "");
      const override = raw ? stationFromFilename(raw) || fallback : "";
      return row.station || !override ? row : { ...row, station: override };
    });
    const originals = withStation.filter(function (row) {
      return (
        row.role === "原始交通量" &&
        Boolean(row.station) &&
        PEAK_KEYS.some(function (key) {
          return Boolean(row.peakWindows?.[key]);
        }) &&
        row.layout !== "unknown" &&
        row.columns.length > 0 &&
        /* 2026-09-18 F-11：原始檔有重複的路口編號／表頭／時距 → 擋下不寫入。 */
        !row.blockReason &&
        importResolutions[row.file]?.action !== "skip" &&
        /*
         * 使用者在「橫跨中午」那個視窗選了「取消，這一份不要匯入」。
         * ⚠️ 整份不寫入，不是只丟掉那一個時段——丟一半會留下一筆殘缺的
         *   資料，而殘缺的那一半在畫面上看不出來。
         */
        !row.noonSkip
      );
    });
    /*
     * 一個檔都寫不進去時，要說出「哪一個檔、為什麼、怎麼辦」。
     *
     * 舊版只丟一句「沒有可寫入的原始交通量檔。」，使用者最常撞到的情形是
     * 檔名被判成參考計算檔——畫面上只有一個藍色標籤，訊息又不提檔名，
     * 於是完全無從得知「改個檔名就好了」。
     */
    if (!originals.length) {
      /* 使用者沒有主動略過、卻仍然寫不進去的列，要逐一說明原因。 */
      const notSkipped = withStation.filter(function (row) {
        return importResolutions[row.file]?.action !== "skip";
      });
      const reasons = notSkipped.map(function (row) {
        if (row.roleReason) return `・${row.file}：${row.roleReason}`;
        if (row.blockReason) return `・${row.file}：${row.blockReason}`;
        if (!row.station)
          return `・${row.file}：檔案內沒有「站號：」欄位，檔名也讀不到站號，因此無法寫入。請在預覽列填寫站號，或將檔名改為含 T<站號> 的格式（例如 11500T01-02_路口名稱.xls）後重新匯入。`;
        if (row.layout === "unknown" || !row.columns.length)
          return `・${row.file}：讀到資料，但無法辨識路口支線與轉向欄位，因此不能寫入。這不是檔名的問題，請確認工作表格式。`;
        if (!PEAK_KEYS.some((key) => Boolean(row.peakWindows?.[key])))
          return `・${row.file}：讀到資料，但算不出任何尖峰時段（可能時間欄格式不符或資料筆數不足）。這不是檔名的問題。`;
        return `・${row.file}：無法寫入。`;
      });
      return notify(
        reasons.length
          ? "沒有任何檔案被寫入：\n" + reasons.join("\n")
          : "沒有可寫入的原始交通量檔。請先選取檔案。",
      );
    }
    /* 比對規則見 lib/traffic.ts 的 isSameSurvey（含「待設定」為何要特別處理）。 */
    const sameSurvey = function (
      record: TrafficRecord,
      item: { station: string; surveyType: string },
    ) {
      return isSameSurvey(record, item, { projectId: activeProjectId, quarter: q });
    };
    const overwriteTargets = records.filter(function (record) {
      return originals.some(function (item) {
        return sameSurvey(record, item);
      });
    });
    /*
     * 同一批次裡撞號要先擋下來。
     * forEach 是對 next 做 findIndex，所以第二份同站號同資料別的檔案會找到
     * 第一份剛 push 進去的那筆並直接覆蓋——第一份的解析結果無聲消失，
     * 完成訊息卻說「已寫入 2 個路口」。使用者事後看不出少了哪一份。
     * 另外兩支程式都有擋（speed 會算出 owners 碰撞、traffic 的 validateImport
     * 會警告「匯入檔內有 N 組重複鍵值」），turning 這裡補上。
     */
    const seen = new Map<string, string[]>();
    for (const item of originals) {
      const key = item.station + "｜" + (item.surveyType || "待設定");
      const bucket = seen.get(key);
      if (bucket) bucket.push(item.file);
      else seen.set(key, [item.file]);
    }
    const collisions = [...seen.entries()].filter(function (entry) {
      return entry[1].length > 1;
    });
    if (collisions.length) {
      notify(
        "這批檔案裡有 " +
          collisions.length +
          " 組會互相覆蓋，已停止寫入：" +
          collisions
            .map(function (entry) {
              return entry[0] + "（" + entry[1].join("、") + "）";
            })
            .join("；") +
          "。它們被判定為同一個站號與資料別，一次匯入只會留下最後一份。" +
          "請在預覽列表用「刪除」留下要用的那一份，或分批匯入。",
      );
      return;
    }
    /*
     * 調查日期與所選期別對不起來時，寫入前顯眼提示並要求二次確認。
     * 只比對這次真的會寫入的檔案（originals）；使用者選擇略過的不算。
     * 讀不到日期一律**不阻擋**，只在預覽面板提醒使用者自行確認。
     */
    const writingFiles = new Set(
      originals.map(function (item) {
        return item.file;
      }),
    );
    const dateProblems = importDateChecks.filter(function (item) {
      return item.status === "mismatch" && writingFiles.has(item.file);
    });
    if (dateProblems.length && !confirm(periodMismatchPrompt(dateProblems)))
      return;
    if (!authorizeLockedChange(overwriteTargets, "重新匯入")) return;
    const next = [...records];
    /* 有幾筆原本是「待設定」、這次被讀出的資料別補上了 */
    let upgraded = 0;
    /* 實際寫入與依使用者選擇略過的筆數——完成訊息要說實話。 */
    let written = 0;
    let skipped = 0;
    /*
     * 這一輪要覆蓋掉的舊資料先收在這裡，迴圈跑完才一次建立**一個**
     * 還原點批次。原本是每覆蓋一筆就 saveRevision 一次，一次涵蓋
     * 65 個路口的批次匯入就長出 65 個還原點。
     */
    const overwritten: TrafficRecord[] = [];
    let overwriteReason = "重新匯入覆蓋";
    /*
     * 這一批要新增的路口名稱別名（`舊名正規化鍵` → `目標路口鍵`）。
     * 迴圈裡收集、迴圈結束後一次寫進 state——在迴圈裡逐次 setState
     * 會用到過期的 previous，只會留下最後一筆。
     */
    const aliasAdditions: Record<string, string> = {};
    originals.forEach(function (item) {
      /*
       * 先找資料別完全相同的那一筆；找不到才退而找同站號的「待設定」，
       * 讓這次讀出來的平日／假日去補上它（見上面 sameSurvey 的說明）。
       * 兩段分開找而不是直接用 sameSurvey，是因為一個檔案同時有平日與假日
       * 兩張工作表時會產生兩筆，必須讓各自「完全相同」的那筆優先對到，
       * 不能讓先跑到的那一筆把待設定搶走。
       */
      const exact = next.findIndex(function (record) {
        return (
          record.projectId === activeProjectId &&
          record.quarter === q &&
          record.station === item.station &&
          (record.surveyType || "待設定") === (item.surveyType || "待設定")
        );
      });
      const found =
        exact >= 0
          ? exact
          : next.findIndex(function (record) {
              return sameSurvey(record, item);
            });
      const configuredItem = configuredImportPreview(
        item,
        pce,
        vehicleMappings,
      );
      /*
       * 衝突模式是在 handleFiles 當下算的，那時使用者還沒補填站號。
       * 補填之後才對上既有紀錄的話，預覽不會顯示「已存在第 N 版」，
       * 這裡也會拿到預設的 overwrite——結果是沒問過就覆蓋掉既有資料。
       * 所以補填造成的新對應，一律改走建立新版本而不是覆蓋。
       */
      const stationWasFilled =
        !importRows.find(function (row) {
          return row.file === item.file;
        })?.station && Boolean(item.station);
      const conflictMode = stationWasFilled
        ? "version"
        : importConflictModes[item.file] || "overwrite";
      if (found >= 0 && conflictMode === "skip") {
        skipped += 1;
        return;
      }
      /*
       * ⚠️ 2026-09-25：resolution／mergeTarget 必須在 recordFromPreview
       *   **之前**算出來。它們只依賴 importResolutions 與 projectRecords，
       *   與 created 無關，所以提前算不改變任何行為；
       *   而 recordFromPreview 需要「解析後的路口名」才能用正確的鑰匙
       *   去查「這個轉向存不存在」的既有答案（詳見它的 presenceKeyName 說明）。
       */
      const resolution = importResolutions[item.file] || { action: "new" };
      const mergeTarget = resolution.targetId
        ? projectRecords.find(function (record) {
            return recordIntersectionKey(record) === resolution.targetId;
          })
        : undefined;
      const created = recordFromPreview(
        configuredItem,
        activeProjectId,
        q,
        pce,
        vehicleMappings,
        movementPresence,
        pceScopes,
        /* 併入既有路口時用那個路口的名字，否則用這一次進來的名字。 */
        mergeTarget?.name || nameMap[item.file] || item.name,
      );
      created.intersectionId =
        mergeTarget?.intersectionId ||
        resolution.targetId ||
        "I-" + canonicalIntersectionKey(created.name);
      /*
       * ★ 使用者在預覽裡選了「併入某路口」，就把這個對應記成別名。
       *
       * 使用者的原話（2026-09-10）：
       *   「同一個路段，結果好幾個檔案名稱不一樣，所以我分別都做好了併入的動作，
       *     系統就會自動記憶那就是別名，後來再出現一樣的名稱就會自動併入了。」
       *
       * ⚠️ 我第一版只在「路口名稱管理改名」時建立別名——那只是兩條路徑裡的一條，
       *    而且是比較少走的那一條。真正常走的是**匯入預覽裡手動選併入**：
       *    調查廠商每一季檔名寫法不同，同一個路口會以好幾種名字進來，
       *    使用者每一種都選過一次併入之後，就不該再被問第二次。
       *
       * ⚠️ 別名是**多對一**：好幾個舊名可以同時指向同一個路口。
       *    這裡的鍵是「這一次進來的名字」，值是「併進去的那個路口」，
       *    所以每選一次併入就多記一個入口，天然支援一個路口有很多別名。
       *
       * 只在真的併進既有路口時記（mergeTarget 存在）。
       * 建立新路口不必記——那就是它自己的名字。
       */
      if (mergeTarget) {
        const from = canonicalIntersectionKey(created.name);
        const to = recordIntersectionKey(mergeTarget);
        if (from && to && from !== to) aliasAdditions[from] = to;
      }
      created.name = mergeTarget?.name || nameMap[item.file] || created.name;
      const geometrySource = found >= 0 ? next[found] : mergeTarget;
      if (geometrySource) inheritRecordGeometry(created, geometrySource);
      if (found >= 0) {
        if ((next[found].surveyType || "待設定") === "待設定" && exact < 0)
          upgraded += 1;
        overwritten.push(next[found]);
        if (conflictMode === "version")
          overwriteReason = "重新匯入並建立新版本";
        created.revision = Number(next[found].revision || 1) + 1;
      }
      created.validation.referenceFound = importRows.some(function (row) {
        return row.role === "參考計算檔" && row.station === item.station;
      });
      if (found >= 0) next[found] = created;
      else next.push(created);
      written += 1;
    });
    saveRevisions(overwritten, overwriteReason);
    setRecords(next);
    /*
     * 把這一批「手動選了併入」的對應記成別名，下一季同名檔案就自動併入。
     * 一次寫進去（不是在迴圈裡逐次呼叫），否則只會留下最後一筆。
     */
    if (Object.keys(aliasAdditions).length)
      setIntersectionAliases(function (existing) {
        const merged = { ...existing };
        for (const [from, to] of Object.entries(aliasAdditions))
          merged[activeProjectId + "|" + from] = to;
        return merged;
      });
    /*
     * 有「分不出來」的轉向就整理成一張清單，等一下跳視窗請使用者裁決。
     *
     * 只在**答案會改變結果**時才問——而「刪掉一條流向」一定會改變畫面、
     * OD 清單與轉向圖卡，所以只要還有 presence: "unknown" 就要問。
     * 使用者答過的（movementPresence 已有答案）在 recordFromPreview 就
     * 直接套用了，不會走到這裡，所以下一季匯入同一個路口不會再問一次。
     */
    const questions = next.flatMap(function (record) {
      const nameOf = function (id: string) {
        return record.approaches.find((a) => a.id === id)?.name || id;
      };
      const codeOf = function (id: string) {
        return record.approaches.find((a) => a.id === id)?.sourceCode || "";
      };
      const flowing = new Set(
        (record.routes ?? [])
          .filter(function (route) {
            return (
              Object.values(route.survey?.vehicle ?? {}).reduce(
                (sum, value) => sum + (Number(value) || 0),
                0,
              ) > 0
            );
          })
          .map((route) => route.fromApproachId + "→" + route.toApproachId),
      );
      return (record.routes ?? [])
        .filter((route) => route.presence === "unknown")
        .map(function (route) {
          return {
            key: movementPresenceKey(
              canonicalIntersectionKey(storedNameOf(record)),
              codeOf(route.fromApproachId),
              codeOf(route.toApproachId),
              route.movement,
            ),
            recordId: record.id,
            routeId: route.id,
            station: record.station,
            intersectionName: record.name,
            fromName: nameOf(route.fromApproachId),
            toName: nameOf(route.toApproachId),
            movement: route.movement,
            /*
             * 為什麼問、建議答什麼、依據是什麼，一路帶到視窗上。
             * 舊版視窗只說「這幾個轉向調查表沒有填任何內容」，使用者看不到
             * 系統的依據，只能自己回頭翻原始檔。
             */
            reason: route.presenceReason ?? "blank",
            suggestion: route.presenceSuggestion ?? "yes",
            basis: route.presenceBasis ?? "",
            duplicatesFlowingRoute: flowing.has(
              route.fromApproachId + "→" + route.toApproachId,
            ),
          };
        });
    });
    if (questions.length) {
      setPresenceQuestions(questions);
      /*
       * 預設值＝系統的建議。沒把握時建議一律是「保留」，
       * 超出預期的橫線建議是「移除」（＝與前一版結果相同，不改變既有結果）。
       */
      setPresenceDraft(
        Object.fromEntries(questions.map((item) => [item.key, item.suggestion])),
      );
    }
    setQuarter(q);
    setImportRows([]);
    setImportResolutions({});
    setImportConflictModes({});
    /* 累加式預覽的季別紀錄，寫入成功後也要一起清掉。 */
    setImportRowPeriod({});
    /*
     * 檔案選取框也要清掉。
     * 使用者修好原始檔之後通常會再選同一個檔名，瀏覽器判斷 value 沒變就
     * 不會觸發 change，於是「重新選檔 → 什麼都沒發生」，沒有預覽也沒有訊息。
     *「取消預覽」早就有清，這裡漏掉了。
     */
    if (fileRef.current) fileRef.current.value = "";
    setPreviewAddedVehicles([]);
    setStationOverrides({});
    /*
     * 部分檔案寫不進去時也要指名道姓。
     *
     * 舊版訊息只算「使用者自己選擇略過」的數量；因為角色、版面或尖峰判讀
     * 而被 originals 濾掉的檔案完全不會出現在任何地方，五個檔進來、四個
     * 寫入時，畫面只會說「已寫入 4 個路口」——少掉的那個沒有人提。
     */
    const rejected = withStation.filter(function (row) {
      return (
        importResolutions[row.file]?.action !== "skip" &&
        !originals.some(function (item) {
          return item.file === row.file;
        })
      );
    });
    notify(
      "已寫入 " +
        written +
        " 個路口" +
        (skipped ? "（另有 " + skipped + " 個依您的選擇略過）" : "") +
        "；同計畫、同季度、同站號採覆蓋更新。" +
        (rejected.length
          ? "\n\n以下 " +
            rejected.length +
            " 個檔案未寫入：\n" +
            rejected
              .map(function (row) {
                return `・${row.file}：${
                  row.roleReason ||
                  row.blockReason ||
                  (!row.station
                    ? "讀不到站號，未寫入。請於預覽列填寫站號後重新匯入。"
                    : "無法辨識為可寫入的原始交通量資料。")
                }`;
              })
              .join("\n") +
            "\n"
          : "") +
        (upgraded
          ? "其中 " +
            upgraded +
            " 筆原本是「待設定」，已由這次讀到的資料別（平日／假日）補上，不會再多出一筆。"
          : ""),
    );
  }

  function updateSelected(mutator: (record: TrafficRecord) => TrafficRecord) {
    if (!selected) return;
    if (!authorizeLockedChange([selected], "此項修改")) return;
    saveRevision(selected, "人工修改前自動保存");
    setRecords(function (all) {
      return all.map(function (record) {
        if (record.id !== selected.id) return record;
        const changed = mutator(structuredClone(record));
        changed.resultLock = undefined;
        return changed;
      });
    });
  }

  function updateSelectedGeometry(
    mutator: (record: TrafficRecord) => TrafficRecord,
  ) {
    if (!selected) return;
    const selectedKey = recordIntersectionKey(selected);
    const affected = records.filter(function (record) {
      return (
        record.projectId === selected.projectId &&
        recordIntersectionKey(record) === selectedKey
      );
    });
    if (!authorizeLockedChange(affected, "道路幾何或流向修改")) return;
    saveRevision(selected, "道路幾何或圖面排位修改前自動保存");
    const updated = mutator(structuredClone(selected));
    updated.resultLock = undefined;
    /*
     * 跨季度同步是靠支線代碼比對的。人工新增的支線舊版一律叫「人工」，
     * 同一個路口若有兩條以上，Map 只會留下最後一條，另一季的兩條支線就會
     * 被寫成同一份資料（名稱、角度、版面全部一樣）。
     * 這裡對重複出現的代碼加上出現序號，讓每一條都能對到自己的那一條。
     */
    const codeKey = function (approaches: Approach[]) {
      const seen = new Map<string, number>();
      return approaches.map(function (approach) {
        const code = approach.sourceCode || approach.id;
        const index = seen.get(code) ?? 0;
        seen.set(code, index + 1);
        return index ? code + "#" + index : code;
      });
    };
    const updatedKeys = codeKey(updated.approaches);
    const geometryByCode = new Map(
      updated.approaches.map(function (approach, index) {
        return [updatedKeys[index], approach] as const;
      }),
    );
    const movementByCode = new Map<string, RouteFlow["movement"]>();
    (updated.routes || []).forEach(function (route) {
      const from = updated.approaches.find(function (approach) {
        return approach.id === route.fromApproachId;
      });
      const to = updated.approaches.find(function (approach) {
        return approach.id === route.toApproachId;
      });
      if (from && to)
        movementByCode.set(
          (from.sourceCode || from.id) + "→" + (to.sourceCode || to.id),
          route.movement,
        );
    });
    setRecords(function (all) {
      return all.map(function (record) {
        if (
          record.projectId !== selected.projectId ||
          recordIntersectionKey(record) !== selectedKey
        )
          return record;
        if (record.id === selected.id) return updated;
        const copy = structuredClone(record);
        const copyKeys = codeKey(copy.approaches);
        copy.approaches.forEach(function (approach, approachIndex) {
          const geometry = geometryByCode.get(copyKeys[approachIndex]);
          if (!geometry) return;
          approach.name = geometry.name;
          approach.angle = geometry.angle;
          approach.bearing = bearingFromAngle(geometry.angle);
          approach.cardOffset = geometry.cardOffset
            ? { ...geometry.cardOffset }
            : undefined;
          approach.cardOffsets = geometry.cardOffsets
            ? structuredClone(geometry.cardOffsets)
            : undefined;
          approach.labelOffset = geometry.labelOffset
            ? { ...geometry.labelOffset }
            : undefined;
          approach.cardLayouts = geometry.cardLayouts
            ? structuredClone(geometry.cardLayouts)
            : undefined;
        });
        (copy.routes || []).forEach(function (route) {
          const from = copy.approaches.find(function (approach) {
            return approach.id === route.fromApproachId;
          });
          const to = copy.approaches.find(function (approach) {
            return approach.id === route.toApproachId;
          });
          const movement = movementByCode.get(
            (from?.sourceCode || from?.id || "") +
              "→" +
              (to?.sourceCode || to?.id || ""),
          );
          if (movement) route.movement = movement;
        });
        copy.movementRule = updated.movementRule;
        copy.directionDisplay = structuredClone(updated.directionDisplay || {});
        copy.resultLock = undefined;
        return syncRouteTotals(copy);
      });
    });
  }

  /*
   * 三份轉向圖 SVG 都很大（7 叉路口有 14 張卡、上百條路徑），舊版直接寫在 JSX 裡，
   * 任何一次 render（包含輸入框打字、切換分頁）都會重新組三次字串並讓瀏覽器
   * 重新解析整段 SVG。改成依實際輸入 memo，只有真的改到圖形參數才重算；
   * 沒在該分頁時直接給空字串，完全不做事。
   */
  /*
   * 匯出前排版預警。
   *
   * ⚠️ 舊版是在 JSX 裡直接呼叫六次 diagramCollisionWarnings(selected, …)，
   *    每次 render 重算六遍；而且那六遍算的是**估計位置**，不是圖上的位置。
   *    現在只算一次，而且吃的是 diagramLayout 產圖時同一組矩形。
   */
  const collisionWarnings = useMemo(
    function (): string[] {
      if (!diagramRecord) return [];
      return diagramCollisionWarnings(
        diagramLayout(
          diagramRecord,
          diagramPeak,
          diagramStyle,
          diagramDisplay,
          diagramVehicle,
          arrowMode,
          focusIndex,
          diagramFlow,
          showQuarter,
        ).boxes,
      );
    },
    [
      diagramRecord,
      diagramPeak,
      diagramStyle,
      diagramDisplay,
      diagramVehicle,
      arrowMode,
      focusIndex,
      diagramFlow,
      showQuarter,
    ],
  );
  /*
   * 畫布在畫面上要用多大比例顯示。
   *
   * 1 = 與四支線時一樣大。七叉的畫布比四叉寬，這個值就 > 1，
   * 於是**中央路口在畫面上的大小維持不變**，多出來的變成四周留白，
   * 超出面板的部分由 .diagram-canvas 的 overflow:auto 捲動。
   * （使用者 2026-09-11：「能保持原中間路段原本的樣子就好，
   *   畫布增大只是增加四周空白處」）
   */
  /*
   * 轉向圖要不要放大到「中央路口方塊固定大小」的原尺寸。
   * 預設 false ＝ 整張看得到、不必捲動（使用者 2026-09-12 選的）。
   */
  const [diagramZoom, setDiagramZoom] = useState(false);
  /*
   * ── 「整張圖都看得到」這句話要**量過才敢說** ────────────────────────
   *
   * ⚠️ 2026-09-13 實測：這一行小字原本是用 diagramScale 推論出來的，
   *   而 CSS 另外有一個 `min-width: 880px` 它不知道。螢幕 1440px 以下時
   *   面板只有 838px，右邊整排圖卡看不到，畫面卻寫著「沒有被裁切」。
   *
   *   ⚠️ 這比單純的版面問題嚴重：**系統在對使用者陳述一件不成立的事**。
   *   使用者看到那句話，就不會再去找那些卡片，也不會想到可以左右捲。
   *
   *   所以現在改成**量**：SVG 實際畫出來的寬度有沒有超過面板的可視寬度。
   *   量到什麼就說什麼，不用推論的。
   */
  const diagramBoxRef = useRef<HTMLElement | null>(null);
  const [diagramOverflow, setDiagramOverflow] = useState(0);
  /*
   * ⚠️ 就地豁免 react-hooks/exhaustive-deps，理由與上面那一處相同
   *  （搜尋「規則的警告文字是」可以找到完整說明）：
   *   圖會因為換路口、換時段、換樣式、視窗縮放而改變寬度，列不完；
   *   規則建議的 [] 等於只量一次，是錯的修法。
   *   無限迴圈由下面 setState 裡的「數字沒變就回傳 previous」擋掉，
   *   而那道防護由 `tests/render-loop-guard.test.mjs` 釘住。
   * ⚠️ 一樣要維持單行寫法，不要改成 eslint-disable/enable 的區塊寫法。
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(function () {
    /*
     * ⚠️ 沒有相依陣列：圖會因為換路口、換時段、換樣式、視窗縮放而改變寬度，
     *   列不完。每次 render 後量一次，只有數字真的變了才 setState。
     */
    const box = diagramBoxRef.current;
    const svg = box?.querySelector("svg");
    if (!box || !svg) {
      setDiagramOverflow(function (previous) {
        return previous === 0 ? previous : 0;
      });
      return;
    }
    const cut = Math.round(
      svg.getBoundingClientRect().width - box.clientWidth,
    );
    setDiagramOverflow(function (previous) {
      return previous === cut ? previous : cut;
    });
  });
  const diagramScale = useMemo(
    function () {
      if (view !== "diagram" || !diagramRecord) return { w: 1, h: 1 };
      const layout = diagramLayout(
        diagramRecord,
        diagramPeak,
        diagramStyle,
        diagramDisplay,
        diagramVehicle,
        arrowMode,
        focusIndex,
        diagramFlow,
        showQuarter,
      );
      /*
       * ⚠️ 寬與高要**分開**算比例，不能共用一個。
       *   四叉是 1200×900（比例 1.33），七叉是 1620×1080（比例 1.5）——
       *   形狀本來就不一樣。只用寬的比例去放大，高度上限那一條就會在
       *   兩張圖上夾得不一樣緊：實測四叉被 max-height 夾住而縮小、
       *   七叉沒被夾住，結果七叉反而比四叉大 4%。
       *   兩軸各自照自己的倍數放大，不管最後是寬還是高在限制，
       *   兩張圖的實際顯示比例都會相同。
       */
      return {
        w: layout.width / layout.baseWidth,
        h: layout.height / layout.baseHeight,
      };
    },
    [
      view,
      diagramRecord,
      diagramPeak,
      diagramStyle,
      diagramDisplay,
      diagramVehicle,
      arrowMode,
      focusIndex,
      diagramFlow,
      showQuarter,
    ],
  );
  const diagramHtml = useMemo(
    function () {
      if (view !== "diagram" || !diagramRecord) return "";
      return diagramMarkup(
        diagramRecord,
        diagramPeak,
        diagramStyle,
        diagramDisplay,
        diagramVehicle,
        arrowMode,
        focusIndex,
        diagramFlow,
        /* 圖上的季度跟著畫面的年份顯示切換走。 */
        showQuarter,
      );
    },
    [
      view,
      diagramRecord,
      diagramPeak,
      diagramStyle,
      diagramDisplay,
      diagramVehicle,
      arrowMode,
      focusIndex,
      diagramFlow,
      showQuarter,
    ],
  );
  /*
   * ── 轉向圖右側摘要 ──────────────────────────────────────────
   *
   * v2.1.33 以前這一格寫死 `recordTotal(selected, peak)` ＋ 文字「PCU/hr」，
   * 完全不看使用者選的「顯示」與「車種」，單位也不跟統計範圍走。於是同一張
   * 畫面上，圖的抬頭寫「全路口流量 10,779 輛/調查日」，右邊摘要寫
   * 「10,469.5 PCU/hr」——兩個數字、兩種單位，講的是同一件事。
   *
   * 現在摘要與圖**共用同一組判斷**：值要用 PCU 還是輛由 displayValueKind()
   * 決定、單位由 scopeUnit() 決定，兩邊都走這兩支，不各自再猜一次。
   */
  const summary = useMemo(
    function () {
      /*
       * ⚠️ 這一格用的是**轉向圖那一張自己的條件**（diagram*），不是主工具列。
       *
       *   v2.1.74 起路口轉向圖可以脫離主工具列。摘要如果還讀主工具列的
       *   時段／顯示／車種，圖脫離的那一刻摘要就和圖講不同的話——
       *   正是 v2.1.33 修掉的那個病（e2e-composition-dash 立刻紅字，
       *   實測 18 條：「圖 42,390.1 / 摘要 4,795.8」）。
       */
      const kind = displayValueKind(diagramDisplay);
      /* 分母跟著這一筆的涵蓋走，和轉向圖抬頭用同一個判斷，兩邊不會分岔。 */
      const unit = scopeUnit(diagramPeak, kind, coverageOf(diagramRecord));
      const empty = {
        value: 0,
        unit,
        share: null as number | null,
        breakdown: [] as Array<{
          id: string;
          label: string;
          value: number;
          percent: number;
        }>,
        showsValue: displayShowsValue(diagramDisplay),
        isBase: false,
        reconciled: true,
        reason: "",
        derivedPcu: 0,
        storedPcu: 0,
      };
      if (view !== "diagram" || !diagramRecord) return empty;
      /* 逐支線對帳一次，任何一支對不起來就整筆標為不可靠。 */
      const breakdowns = diagramRecord.approaches.map(function (approach) {
        return pcuBreakdown(diagramRecord, approach, diagramPeak);
      });
      const reconciled = breakdowns.every(function (item) {
        return item.reconciled;
      });
      const derivedPcu = roundedPcu(
        breakdowns.reduce(function (sum, item) {
          return sum + item.derivedPcu;
        }, 0),
      );
      const storedPcu = roundedPcu(
        breakdowns.reduce(function (sum, item) {
          return sum + item.storedPcu;
        }, 0),
      );
      /* 各車種的值：PCU 模式用現算的 PCU，車輛數模式用實際輛數。 */
      const ids = recordVehicleIds(diagramRecord);
      const perVehicle = ids.map(function (id) {
        const value = breakdowns.reduce(function (sum, item) {
          const cell = item.perVehicle[id];
          return sum + (cell ? (kind === "pcu" ? cell.pcu : cell.count) : 0);
        }, 0);
        return {
          id,
          label: vehicleLabel(diagramRecord, id),
          value: kind === "pcu" ? roundedPcu(value) : value,
        };
      });
      const grandTotal = perVehicle.reduce(function (sum, item) {
        return sum + item.value;
      }, 0);
      const pct = function (value: number) {
        return grandTotal ? (value / grandTotal) * 100 : 0;
      };
      /*
       * 「全部車種」時報整個路口；選了單一車種就報那一個車種，另外給它
       * 占路口總量的百分比——那正是使用者篩選之後最想知道的一個數字。
       */
      const picked =
        diagramVehicle === "all"
          ? null
          : perVehicle.find(function (item) {
              return item.id === diagramVehicle;
            }) || null;
      return {
        ...empty,
        value:
          diagramVehicle === "all"
            ? kind === "pcu"
              ? roundedPcu(recordTotal(diagramRecord, diagramPeak))
              : roundedPcu(grandTotal)
            : picked?.value ?? 0,
        share: picked ? pct(picked.value) : null,
        /*
         * 車種組成只在「全部車種」時才有意義（選了單一車種，組成就只有它
         * 自己一列）。百分比模式只列比例，車輛數＋百分比模式連數值一起列。
         */
        breakdown:
          diagramVehicle === "all" && displayShowsPercent(diagramDisplay)
            ? perVehicle.map(function (item) {
                return { ...item, percent: pct(item.value) };
              })
            : [],
        isBase: diagramDisplay === "percent" && diagramVehicle === "all",
        /*
         * 車輛數模式也要看對帳結果：車輛數與 PCU 用的是不同來源
         *（row.vehicle vs 實際流向），對不起來時兩種模式都該講出來。
         */
        reconciled,
        reason:
          breakdowns.find(function (item) {
            return !item.reconciled;
          })?.reason || "",
        derivedPcu,
        storedPcu,
      };
    },
    /*
     * ⚠️ viewRecord 要列進來：判定方式一改，轉向圖上的數字就要跟著換。
     *   少了它，圖上會停在上一種判定方式算出來的值，而圖說只寫一種。
     */
    [view, diagramRecord, diagramPeak, diagramDisplay, diagramVehicle],
  );
  /*
   * ⚠️ 這兩張幾何圖的 markup **要能在別的分頁上也產得出來**。
   *
   * 下面那兩個 memo 為了省效能會在「不是 geometry 這一頁」時回空字串，
   * 那是對的（沒開那一頁就不必畫）。但「一鍵下載全部圖檔」在報表頁，
   * 直接拿 memo 的話拿到的是空字串，svgToPng 會丟出一個訊息只有 "Event"
   * 的錯誤，而且**整批 ZIP 一張都產不出來**——實測抓到的。
   * 所以把參數收斂成這兩支，memo 與批次匯出讀同一份，不可能分岔。
   */
  const buildGeometrySchematic = function () {
    if (!geometryRecord) return "";
    return diagramMarkup(
      geometryRecord,
      geometryPeak,
      "simple",
      "volume",
      "all",
      "focus",
      0,
      "both",
      /* 圖上的季度跟著畫面的年份顯示切換走。 */
      showQuarter,
    );
  };
  const buildGeometryCardPreview = function () {
    if (!geometryRecord) return "";
    return diagramMarkup(
      geometryRecord,
      geometryPeak,
      "formal",
      "both",
      "all",
      "focus",
      focusIndex,
      geometryFlow,
      /* 圖上的季度跟著畫面的年份顯示切換走。 */
      showQuarter,
    );
  };
  const geometrySchematicHtml = useMemo(
    function () {
      if (view !== "geometry" || !selected) return "";
      return buildGeometrySchematic();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, geometryRecord, geometryPeak, showQuarter],
  );
  const geometryCardPreviewHtml = useMemo(
    function () {
      if (view !== "geometry" || !selected || !showGeometryCardPreview)
        return "";
      return buildGeometryCardPreview();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      view,
      geometryRecord,
      showGeometryCardPreview,
      geometryPeak,
      focusIndex,
      geometryFlow,
      showQuarter,
    ],
  );


  /*
   * 拖曳圖卡與路口標籤。
   *
   * 舊版在每一個 pointermove 都呼叫 updateSelectedGeometry：那會 structuredClone
   * 整筆紀錄、把快照塞進 300 筆的版本歷程、再把整包狀態寫進本機儲存，
   * 接著整個畫面連同兩三份 SVG 重新產生。滑鼠每秒送 60～120 個事件，
   * 這些工作全部堆在主執行緒上，拖沒幾秒分頁就會被瀏覽器判定沒有回應而顯示
   * 「This page couldn't load」；一旦儲存空間被寫爆（QuotaExceededError），
   * 之後只要再碰圖卡就會再爆一次。
   * ⚠️ 這段描述的是 v2.1.52 以前（當時存 localStorage）觀察到的症狀。
   *   儲存層在 v2.1.53 改成 IndexedDB，配額大得多，但「拖曳中不寫入」
   *   這個做法與儲存層無關，**不要因為換了儲存層就把它改回去**。
   *
   * 現在改成：拖曳過程完全不碰 React 狀態，只用 requestAnimationFrame 直接改
   * 那一個 <g> 的 transform（最多每幀一次）；放開滑鼠才寫入一次狀態。
   * 拖曳中不存檔、不寫版本歷程，效能與資料量都跟拖多久無關。
   */
  /*
   * ⚠️ 版面是**依「流量顯示模式」各存一份**的（both／inbound／outbound）。
   *
   *   模式一定要由呼叫端傳進來：v2.1.74 之後，路口轉向圖用的是
   *   diagramFlow、道路與流向管理的圖卡預覽用的是 geometryFlow，
   *   兩者各自獨立，已經沒有一個「全站的 flowSummaryMode」可以讀。
   *   照舊讀全域值的話，在「只顯示駛入」拖曳會存到 both 那一份底下，
   *   畫面上完全不動——e2e-diagram 立刻紅字「Δ=0」，就是這樣抓到的。
   */
  function startCardDrag(
    event: ReactPointerEvent<HTMLElement>,
    layoutMode: FlowLayoutMode,
  ) {
    if (!selected) return;
    const node = (event.target as Element).closest<SVGGElement>(
      "[data-card-id],[data-label-id]",
    );
    if (!node) return;
    const approachId =
      node.getAttribute("data-card-id") || node.getAttribute("data-label-id");
    const section = node.getAttribute("data-card-section") as
      "inbound" | "outbound" | null;
    const isLabel = !node.getAttribute("data-card-id");
    const approach = selected.approaches.find(function (item) {
      return item.id === approachId;
    });
    const svg = event.currentTarget.querySelector("svg");
    if (!approach || !approachId || !svg) return;
    event.preventDefault();

    /*
     * 螢幕像素 → SVG 座標的換算。
     * 舊版用 viewBox 寬 ÷ 元素寬，但 .diagram-canvas 的 SVG 有 max-height，
     * 一旦高度被夾住，preserveAspectRatio 會在左右留白：元素比實際畫面寬，
     * 橫向比例就會偏小，卡片跟不上游標（寬螢幕上誤差可達 15%）。
     * getScreenCTM() 取的是真正套用到內容上的縮放，兩軸都準。
     */
    const ctm = svg.getScreenCTM();
    const box = svg.getBoundingClientRect();
    const scaleX =
      ctm && ctm.a
        ? 1 / ctm.a
        : Number(svg.viewBox.baseVal.width || 1200) / Math.max(1, box.width);
    const scaleY =
      ctm && ctm.d
        ? 1 / ctm.d
        : Number(svg.viewBox.baseVal.height || 900) / Math.max(1, box.height);
    const startX = event.clientX;
    const startY = event.clientY;
    const number = function (name: string, fallback: number) {
      // 注意 Number(null) === 0：屬性不存在時一定要走 fallback，
      // 否則基準點與邊界會被當成 0，一拖就跳到畫面左上角。
      const raw = node.getAttribute(name);
      if (raw === null || raw === "") return fallback;
      const value = Number(raw);
      return Number.isFinite(value) ? value : fallback;
    };
    const currentTransform = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(
      node.getAttribute("transform") || "",
    );
    const renderedX = Number(currentTransform?.[1] ?? 0);
    const renderedY = Number(currentTransform?.[2] ?? 0);
    // 自動排版的基準點與可放置範圍（圖卡才有；路口標籤不設限）
    const baseX = number("data-base-x", renderedX);
    const baseY = number("data-base-y", renderedY);
    const limit = {
      minX: number("data-min-x", -Infinity),
      maxX: number("data-max-x", Infinity),
      minY: number("data-min-y", -Infinity),
      maxY: number("data-max-y", Infinity),
    };
    const clampX = function (value: number) {
      return Math.max(limit.minX, Math.min(limit.maxX, value));
    };
    const clampY = function (value: number) {
      return Math.max(limit.minY, Math.min(limit.maxY, value));
    };
    const original = isLabel
      ? approachLabelOffset(approach, layoutMode)
      : approachCardOffset(approach, layoutMode, section || "inbound");
    const startOffsetX = Number(original.x || 0);
    const startOffsetY = Number(original.y || 0);
    // 位移一律以「自動基準點」為原點，並先夾在畫布內，
    // 存下來的值就等於畫出來的值，往回拖不會出現拖了沒反應的死區。
    const offsetAt = function (dx: number, dy: number) {
      return {
        x: Math.round(clampX(baseX + startOffsetX + dx) - baseX),
        y: Math.round(clampY(baseY + startOffsetY + dy) - baseY),
      };
    };

    let frame = 0;
    let latest = { dx: 0, dy: 0 };
    const paint = function () {
      frame = 0;
      if (!node.isConnected) return;
      const offset = offsetAt(latest.dx, latest.dy);
      node.setAttribute(
        "transform",
        "translate(" +
          (baseX + offset.x).toFixed(1) +
          " " +
          (baseY + offset.y).toFixed(1) +
          ")",
      );
    };
    const move = function (pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== event.pointerId) return;
      latest = {
        dx: (pointerEvent.clientX - startX) * scaleX,
        dy: (pointerEvent.clientY - startY) * scaleY,
      };
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const finish = function (pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== event.pointerId) return;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      if (frame) cancelAnimationFrame(frame);
      const next = offsetAt(
        (pointerEvent.clientX - startX) * scaleX,
        (pointerEvent.clientY - startY) * scaleY,
      );
      if (
        next.x === Math.round(startOffsetX) &&
        next.y === Math.round(startOffsetY)
      )
        return;
      // 拖曳途中若畫面重繪（例如切換顯示模式），被拖的節點會被換掉、
      // 使用者其實什麼都沒看到移動，這時就不要把位置寫進去。
      if (!node.isConnected) return;
      updateSelectedGeometry(function (record) {
        const item = record.approaches.find(function (candidate) {
          return candidate.id === approachId;
        });
        if (!item) return record;
        // 位置存在「目前這個顯示模式」底下：只看駛入、只看駛出、駛入＋駛出
        // 三種畫面各有自己的一組，互不干擾。
        const layouts = { ...(item.cardLayouts || {}) };
        const layout = { ...(layouts[layoutMode] || {}) };
        if (isLabel) layout.label = next;
        else {
          const cards = { ...(layout.cards || {}) };
          if (section) cards[section] = next;
          else {
            cards.inbound = next;
            cards.outbound = next;
          }
          layout.cards = cards;
        }
        layouts[layoutMode] = layout;
        item.cardLayouts = layouts;
        return record;
      });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    // 抓住這個指標，滑鼠移出視窗或多點觸控時才不會把事件送到別的元素
    if (node.setPointerCapture)
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        /* 舊瀏覽器不支援時忽略即可 */
      }
  }

  function deleteQuarter(q: string) {
    const targets = records.filter(function (record) {
      return record.projectId === activeProjectId && record.quarter === q;
    });
    if (!authorizeLockedChange(targets, "刪除季度")) return;
    if (!confirm("確定刪除「" + q + "」全部路口資料？建議先下載備份。")) return;
    /*
     * ⚠️ 還原點也要跟著刪。
     *
     * 使用者 2026-09-11 問「清除本季資料三支是否同步」，查證時發現這一支
     * 刪季度只刪 records，recordRevisions 原封不動——那些還原點指向的紀錄
     * 已經不存在了，會一直留在「版本差異與還原」清單裡，而且按下去會還原出
     * 一筆**使用者以為已經刪掉**的資料。保留上限是最近 30 次操作，
     * 孤兒還原點還會把真正有用的舊版擠掉。
     */
    const removedIds = new Set(
      targets.map(function (record) {
        return record.id;
      }),
    );
    setRecords(function (all) {
      return all.filter(function (record) {
        return !(record.projectId === activeProjectId && record.quarter === q);
      });
    });
    setRecordRevisions(function (all) {
      return all.filter(function (revision) {
        return !removedIds.has(revision.recordId);
      });
    });
    notify("已刪除季度 " + q + "，該季的還原點也一併清除。");
  }

  /**
   * X-85：把主工具列目前選到的那一季改名。
   *
   * ⚠️ 改的是**整個季度**（這個計畫底下那一季的每一筆），
   *   不是畫面上篩出來的那一份——這一點畫面上要寫出來。
   */
  function renameQuarter(event: React.FormEvent) {
    event.preventDefault();
    const raw = renameQuarterDraft.trim().toUpperCase();
    const check = checkSurveyPeriodInput(raw);
    if (!check.ok) return notify(surveyPeriodInputMessage(check.reason));
    const next = check.key;
    if (!quarter) return notify("目前沒有選到季度。");
    if (next === quarter) return notify("季度名稱沒有變動。");
    /*
     * ⚠️ 撞名一律擋下來，**不自行合併**。
     *   合併看起來像「幫使用者省事」，實際上是把兩季的資料混成一季，
     *   而且事後分不回來——這與三支共同的「系統不自行挑選或平均」同一條原則。
     */
    const clashing = quarters.find(function (item) {
      return item !== quarter && normalizeSurveyPeriod(item) === next;
    });
    if (clashing)
      return notify(
        quarterLabel(clashing) +
          " 已經存在，系統不會把兩季合併。請改用別的名稱，或先處理掉那一季。",
      );
    const targets = projectRecords.filter(function (record) {
      return record.quarter === quarter;
    });
    if (!targets.length) return notify("這一季沒有資料可以改名。");
    if (!authorizeLockedChange(targets, "季度改名")) return;
    const targetIds = new Set(
      targets.map(function (record) {
        return record.id;
      }),
    );
    setRecords(function (all) {
      return all.map(function (record) {
        return record.projectId === activeProjectId &&
          record.quarter === quarter
          ? { ...record, quarter: next }
          : record;
      });
    });
    /*
     * ⚠️ 還原點裡也記著季度。不一起改的話，還原之後那一筆會**跳回舊季度名**，
     *   畫面上會憑空多出一個已經改掉的季度。
     */
    setRecordRevisions(function (all) {
      return all.map(function (revision) {
        return targetIds.has(revision.recordId) &&
          revision.snapshot?.quarter === quarter
          ? {
              ...revision,
              snapshot: { ...revision.snapshot, quarter: next },
              /* 批次標籤上也寫著季度，不改的話清單會列出一個不存在的季。 */
              batchLabel: revision.batchLabel
                ? revision.batchLabel.split(quarter).join(next)
                : revision.batchLabel,
            }
          : revision;
      });
    });
    setQuarter(next);
    setRenameQuarterDraft("");
    notify(
      "季度已改為 " +
        quarterLabel(next) +
        "（共 " +
        targets.length +
        " 筆）" +
        (raw !== next ? "；輸入的 " + raw + " 已正規化為 " + next : ""),
    );
  }

  async function exportSvg() {
    // 靜靜結束會讓按鈕看起來壞掉。旁邊的 xlsx／PDF／PNG 都有提示，這裡漏了。
    if (!selected) return notify("目前沒有選定的路口，無法輸出 SVG。");
    downloadBlob(
      new Blob(
        [
          diagramMarkup(
            diagramRecord,
            diagramPeak,
            diagramStyle,
            diagramDisplay,
            diagramVehicle,
            arrowMode,
            focusIndex,
            diagramFlow,
            /* 圖上的季度跟著畫面的年份顯示切換走。 */
            showQuarter,
          ),
        ],
        { type: "image/svg+xml;charset=utf-8" },
      ),
      /*
       * 同 ZIP：帶上資料別，否則同一站的平日與假日會下載成兩個同名檔。
       * ⚠️ 時段要寫 **diagramPeak**（這張圖自己的），不是主工具列的 peak。
       *   這一頁的時段可以脫離；寫主工具列的話，檔名寫「AM」、
       *   圖裡畫的卻是全調查時段——而那張圖會被貼進報告，
       *   看的人只讀得到檔名。（2026-09-16 實測）
       */
      selected.quarter +
        "_" +
        selected.station +
        "_" +
        selected.surveyType +
        "_" +
        diagramPeak +
        "_轉向圖.svg",
    );
  }
  async function exportPng() {
    if (!selected) return;
    downloadBlob(
      await svgToPng(
        diagramMarkup(
          diagramRecord,
          diagramPeak,
          diagramStyle,
          diagramDisplay,
          diagramVehicle,
          arrowMode,
          focusIndex,
          diagramFlow,
          /* 圖上的季度跟著畫面的年份顯示切換走。 */
          showQuarter,
        ),
      ),
      /*
       * 同 ZIP：帶上資料別，否則同一站的平日與假日會下載成兩個同名檔。
       * ⚠️ 時段要寫 **diagramPeak**（這張圖自己的），不是主工具列的 peak。
       *   這一頁的時段可以脫離；寫主工具列的話，檔名寫「AM」、
       *   圖裡畫的卻是全調查時段——而那張圖會被貼進報告，
       *   看的人只讀得到檔名。（2026-09-16 實測）
       */
      selected.quarter +
        "_" +
        selected.station +
        "_" +
        selected.surveyType +
        "_" +
        diagramPeak +
        "_轉向圖.png",
    );
  }
  async function exportPdf(rows = selected ? [selected] : []) {
    if (!rows.length) return notify("沒有可輸出的路口資料。");
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
    });
    for (let index = 0; index < rows.length; index++) {
      if (index) pdf.addPage("a4", "landscape");
      const blob = await svgToPng(
        diagramMarkup(
          /*
           * ⚠️ 這一支是**路口轉向圖那一頁**的 PDF 鈕，畫的就是畫面上那一張圖，
           *   所以要用那張圖自己的條件（時段、車種、流量視角），不是主工具列的。
           *   交出去的 PDF 和畫面不一樣，比沒有 PDF 還糟。
           */
          rows[index],
          diagramPeak,
          "formal",
          "both",
          diagramVehicle,
          "all",
          0,
          diagramFlow,
          /* 圖上的季度跟著畫面的年份顯示切換走。 */
          showQuarter,
        ),
        2,
      );
      const dataUrl = await new Promise<string>(function (resolve) {
        const reader = new FileReader();
        reader.onload = function () {
          resolve(String(reader.result));
        };
        reader.readAsDataURL(blob);
      });
      pdf.addImage(dataUrl, "PNG", 10, 8, 277, 205);
    }
    pdf.save(
      /* ⚠️ 同上：上面 diagramMarkup 畫的是 diagramPeak，檔名要一致。 */
      (activeProject?.code || "Project") +
        "_" +
        (quarter || "all") +
        "_" +
        diagramPeak +
        "_轉向交通量報表.pdf",
    );
  }

  async function createAnalysisWorkbook(
    exportRecords: TrafficRecord[],
    format: "xlsx" | "xls" = "xlsx",
    items: ReportItemKey[] = activeReportItems,
  ) {
    if (!exportRecords.length) throw new Error("選定期間沒有可輸出的資料。");
    const wanted = new Set(items);
    if (!wanted.size) throw new Error("請至少勾選一個要匯出的分析項目。");
    /*
     * 這一份活頁簿裡**所有**工作表的單位共用同一個涵蓋判定。
     *
     * ⚠️ 不可以逐列算涵蓋。Excel 的欄名就是物件的鍵：某幾列算出「PCU/調查日」、
     *   另幾列算出「PCU/調查時段」時，`json_to_sheet` 會生出**兩組欄位**，
     *   同一種數字散在兩欄、加總全錯。
     * ⚠️ 而且這正是使用者定的規則：「（混合的表）欄名就統一用 調查時段，
     *   然後表下方註明清楚」——整批混合時取的就是「調查時段」，
     *   由 `coverageOf()` 對整批回 `"mixed"` 自然得到。
     *   （2026-09-25 第六輪：原本這幾張表都沒有傳涵蓋，所以永遠寫「調查時段」，
     *   滿 24 小時的整批資料交出去的欄名是錯的。）
     */
    const exportCoverage = coverageOf(exportRecords.map(viewRecord));
    // 挑選規則與報告文字草稿共用同一個函式，兩邊的數字才不會分岔。
    const trendRows = trendSeriesRecords(exportRecords, selected).map(
      function (record) {
        return {
          季度: showQuarter(record.quarter),
          資料別: record.surveyType || "待設定",
          ...Object.fromEntries(
            PEAK_KEYS.flatMap(function (key) {
              return [
                [
                  `${SCOPE_SHORT_LABELS[key]}（${scopeUnit(key, "pcu", exportCoverage)}）`,
                  scopeValueOrNull(viewRecord(record), key, recordTotal(viewRecord(record), key)),
                ],
              ];
            }),
          ),
          站號: record.station,
          路口名稱: record.name,
          ...Object.fromEntries(
            PEAK_KEYS.map(function (key) {
              return [
                `${SCOPE_SHORT_LABELS[key]} 尖峰時段`,
                scopeWindowLabel(viewRecord(record), key),
              ];
            }),
          ),
        };
      });
    const vehicleComposition = exportRecords.flatMap(function (record) {
      return (["SURVEY", ...PEAK_KEYS] as CompositionScope[]).flatMap(
        function (scope) {
          /* SURVEY 一定算得出來；三個尖峰範圍要有對應的視窗才算得出來。 */
          const computable = scope === "SURVEY" || hasScopeValue(viewRecord(record), scope);
          const analysisVehicles = recordVehicleIds(record);
          const counts = Object.fromEntries(
            analysisVehicles.map(function (vehicleKey) {
              return [
                vehicleKey,
                recordVehicleTotal(viewRecord(record), scope, vehicleKey),
              ];
            }),
          ) as Record<string, number>;
          const total = analysisVehicles.reduce(function (sum, vehicleKey) {
            return sum + counts[vehicleKey];
          }, 0);
          return analysisVehicles.map(function (vehicleKey) {
            const recordProject = projects.find(function (project) {
              return project.id === record.projectId;
            });
            return {
              計畫: recordProject?.name || activeProject?.name || "",
              季度: showQuarter(record.quarter),
              站號: record.station,
              路口名稱: record.name,
              分析範圍: compositionScopeLabel(record, scope),
              時段:
                scope === "SURVEY"
                  ? `${record.survey?.intervals || 0} 個 ${Math.round(
                      (record.survey?.minutes || 0) /
                        Math.max(1, record.survey?.intervals || 1),
                    )} 分鐘區間（${((record.survey?.minutes || 0) / 60).toFixed(
                      1,
                    )} 小時）`
                  : scopeWindowLabel(viewRecord(record), scope),
              車種: vehicleLabel(record, vehicleKey),
              單位: compositionScopeUnit(record, scope),
              /*
               * 這個統計範圍算不出來時要寫「－」，不能寫 0。
               *
               * 格距組不成完整 60 分鐘，或舊紀錄沒有逐格資料時，該尖峰範圍
               * 可能算不出來。舊版仍會產生列、數量寫 0、組成比例寫 0.0%，那些 0 會被
               * Excel 的自動篩選、加總與平均一起吃進去，看起來像「那個時段真的
               * 沒有車」。同一支函式裡的另一張表早就是這樣處理的
               * （見上方「算不出來的一律寫「－」，不是 0」那段註解），
               * 車種組成這一張是唯一漏掉的。
               */
              數量: computable ? counts[vehicleKey] : "－",
              組成比例: computable && total ? counts[vehicleKey] / total : "－",
            };
          });
        },
      );
    });
    const inboundRows = exportRecords.flatMap(function (record) {
      return inboundAnalysisRows(record).map(function (row) {
        const recordProject = projects.find(function (project) {
          return project.id === record.projectId;
        });
        return {
          計畫: recordProject?.name || activeProject?.name || "",
          季度: showQuarter(record.quarter),
          站號: record.station,
          路口名稱: record.name,
          目的支線代碼: row.approach.sourceCode || row.approach.id,
          目的支線名稱: row.approach.name,
          /*
           * 四個統計範圍各一組欄位，欄名由 SCOPE_KEYS 直接產生。
           * 舊版是把 AM／PM／全日的欄位一個一個手寫出來，加一個時段就要
           * 補六個欄位、而且很容易漏掉車輛數那半。
           * 算不出來的一律寫「－」，不是 0——0 會被 Excel 的加總與平均吃進去。
           */
          ...Object.fromEntries(
            SCOPE_KEYS.flatMap(function (scope) {
              const label = SCOPE_SHORT_LABELS[scope];
              const pcu = scopeUnit(scope, "pcu", exportCoverage);
              const veh = scopeUnit(scope, "vehicle", exportCoverage);
              const cell = function (value: number | null) {
                return value == null ? "－" : value;
              };
              return [
                [
                  `${label} 時段`,
                  scopeWindowLabel(viewRecord(record), scope),
                ],
                [`${label} 駛入量（${pcu}）`, cell(row.inbound[scope].pcu)],
                [`${label} 駛出量（${pcu}）`, cell(row.outbound[scope].pcu)],
                [
                  `${label} 駛入實際車輛數（${veh}）`,
                  cell(row.inbound[scope].vehicles),
                ],
                [
                  `${label} 駛出實際車輛數（${veh}）`,
                  cell(row.outbound[scope].vehicles),
                ],
              ];
            }),
          ),
        };
      });
    });
    const exportRecordIds = new Set(
      exportRecords.map(function (record) {
        return record.id;
      }),
    );
    const comparisonRows = records
      .filter(function (record) {
        return exportRecordIds.has(record.id);
      })
      .sort(function (a, b) {
        return recordTotal(b, "AM") - recordTotal(a, "AM");
      })
      .flatMap(function (record) {
        const project = projects.find(function (item) {
          return item.id === record.projectId;
        });
        const amFlows = branchPeakFlows(viewRecord(record), "AM");
        const pmFlows = branchPeakFlows(viewRecord(record), "PM");
        return record.approaches.map(function (approach, index) {
          return {
            計畫代碼: project?.code || "",
            計畫名稱: project?.name || "",
            季度: showQuarter(record.quarter),
            站號: record.station,
            路口名稱: record.name,
            支線代碼: approach.sourceCode || String.fromCharCode(65 + index),
            支線名稱: approach.name,
            ...Object.fromEntries(
              PEAK_KEYS.map(function (key) {
                return [
                  `${SCOPE_SHORT_LABELS[key]} 尖峰時段`,
                  scopeWindowLabel(viewRecord(record), key),
                ];
              }),
            ),
            "AM 路口轉向總量（PCU/hr）": recordTotal(viewRecord(record), "AM"),
            "AM 駛出路口（該支線→路口中心，PCU/hr）":
              amFlows[index].enteringIntersection,
            "AM 駛入路口（路口中心→該支線，PCU/hr）":
              amFlows[index].leavingIntersection,
            "PM 路口轉向總量（PCU/hr）": recordTotal(viewRecord(record), "PM"),
            "PM 駛出路口（該支線→路口中心，PCU/hr）":
              pmFlows[index].enteringIntersection,
            "PM 駛入路口（路口中心→該支線，PCU/hr）":
              pmFlows[index].leavingIntersection,
          };
        });
      });
    const workbook = XLSX.utils.book_new();
    const trendSheet = XLSX.utils.json_to_sheet(trendRows);
    trendSheet["!cols"] = [12, 12, 20, 20, 12, 30, 18, 18].map(function (wch) {
      return { wch };
    });
    trendSheet["!autofilter"] = { ref: trendSheet["!ref"] || "A1:A1" };
    // 加了「資料別」欄之後，AM／PM 兩欄從 B、C 往後移到 C、D，
    // 數字格式與圖表系列都必須跟著改，否則圖表會指到文字欄。
    for (let row = 2; row <= trendRows.length + 1; row++)
      ["C", "D"].forEach(function (column) {
        if (trendSheet[column + row]) trendSheet[column + row].z = "#,##0.0";
      });
    if (wanted.has("trend"))
      XLSX.utils.book_append_sheet(workbook, trendSheet, "歷季趨勢比較");
    const compositionSheet = XLSX.utils.json_to_sheet(vehicleComposition);
    compositionSheet["!cols"] = [20, 10, 10, 30, 15, 26, 18, 16, 16, 14].map(
      function (wch) {
        return { wch };
      },
    );
    compositionSheet["!autofilter"] = {
      ref: compositionSheet["!ref"] || "A1:A1",
    };
    if (wanted.has("composition"))
      XLSX.utils.book_append_sheet(workbook, compositionSheet, "車種組成分析");
    for (let row = 2; row <= vehicleComposition.length + 1; row++) {
      if (compositionSheet["J" + row]) compositionSheet["J" + row].z = "0.0%";
    }
    const inboundSheet = XLSX.utils.json_to_sheet(inboundRows);
    inboundSheet["!cols"] = [
      22, 10, 12, 28, 14, 24, 28, 18, 24, 18, 24, 30, 28, 28,
    ].map(function (wch) {
      return { wch };
    });
    inboundSheet["!autofilter"] = {
      ref: inboundSheet["!ref"] || "A1:A1",
    };
    if (wanted.has("inboundOutbound"))
      XLSX.utils.book_append_sheet(
        workbook,
        inboundSheet,
        "駛入駛出各路口流量",
      );
    // 只要「駛入」或只要「駛出」的計畫，各自出一張精簡的尖峰流量表
    (["inbound", "outbound"] as const).forEach(function (direction) {
      const key = direction === "inbound" ? "inboundPeak" : "outboundPeak";
      if (!wanted.has(key)) return;
      const label = direction === "inbound" ? "駛入" : "駛出";
      const rows = exportRecords.flatMap(function (record) {
        return inboundAnalysisRows(record).map(function (row) {
          const flowOf = function (scope: ScopeKey) {
            return direction === "inbound"
              ? row.inbound[scope]
              : row.outbound[scope];
          };
          return {
            計畫:
              projects.find(function (project) {
                return project.id === record.projectId;
              })?.name ||
              activeProject?.name ||
              "",
            季度: showQuarter(record.quarter),
            站號: record.station,
            路口名稱: record.name,
            支線代碼: row.approach.sourceCode || row.approach.id,
            支線名稱: row.approach.name,
            /* 欄位由 SCOPE_KEYS 產生，新增時段時這張表自動跟上。 */
            ...Object.fromEntries(
              SCOPE_KEYS.flatMap(function (scope) {
                const scopeLabel = SCOPE_SHORT_LABELS[scope];
                const flow = flowOf(scope);
                return [
                  [`${scopeLabel} 時段`, scopeWindowLabel(viewRecord(record), scope)],
                  [
                    `${scopeLabel} ${label}量（${scopeUnit(scope, "pcu", exportCoverage)}）`,
                    flow.pcu == null ? "－" : flow.pcu,
                  ],
                  [
                    `${scopeLabel} ${label}實際車輛數（${scopeUnit(
                      scope,
                      "vehicle",
                      exportCoverage,
                    )}）`,
                    flow.vehicles == null ? "－" : flow.vehicles,
                  ],
                ];
              }),
            ),
          };
        });
      });
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [22, 10, 12, 28, 12, 22, 18, 24, 28, 18, 24, 28, 26].map(
        function (wch) {
          return { wch };
        },
      );
      sheet["!autofilter"] = { ref: sheet["!ref"] || "A1:A1" };
      XLSX.utils.book_append_sheet(
        workbook,
        sheet,
        "各路口" + label + "尖峰流量",
      );
    });
    const comparisonSheet = XLSX.utils.json_to_sheet(comparisonRows);
    comparisonSheet["!cols"] = [
      14, 26, 10, 12, 30, 12, 24, 18, 22, 28, 30, 18, 22, 28, 30,
    ].map(function (wch) {
      return { wch };
    });
    comparisonSheet["!autofilter"] = {
      ref: comparisonSheet["!ref"] || "A1:A1",
    };
    for (let row = 2; row <= comparisonRows.length + 1; row++)
      ["I", "J", "K", "M", "N", "O"].forEach(function (column) {
        if (comparisonSheet[column + row])
          comparisonSheet[column + row].z = "#,##0.0";
      });
    if (wanted.has("compare"))
      XLSX.utils.book_append_sheet(
        workbook,
        comparisonSheet,
        "各路口支線尖峰流量",
      );
    if (wanted.has("odMatrix")) {
      const rows = exportRecords.flatMap(function (record) {
        /* 三個尖峰單位相同（PCU/hr），可以放在同一張表；全日時段是
           PCU/調查日，已經有「各路口駛入駛出流量」那張表的全日欄位。 */
        return PEAK_KEYS.flatMap(function (peakKey) {
          return odMatrix(viewRecord(record), peakKey).flatMap(function (row) {
            return row.values
              .map(function (value, destinationIndex) {
                const destination = record.approaches[destinationIndex];
                if (!destination || destination.id === row.originId)
                  return null;
                return {
                  季度: showQuarter(record.quarter),
                  站號: record.station,
                  路口名稱: record.name,
                  時段: SCOPE_SHORT_LABELS[peakKey],
                  起點支線: row.origin,
                  目的支線: destination.name,
                  "流量（PCU/hr）": value,
                };
              })
              .filter(Boolean) as Array<Record<string, string | number>>;
          });
        });
      });
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [10, 12, 28, 14, 20, 20, 20].map(function (wch) {
        return { wch };
      });
      sheet["!autofilter"] = { ref: sheet["!ref"] || "A1:A1" };
      XLSX.utils.book_append_sheet(workbook, sheet, "OD轉向矩陣");
    }
    if (wanted.has("branchBalance")) {
      const rows = exportRecords.flatMap(function (record) {
        return PEAK_KEYS.flatMap(function (peakKey) {
          return branchBalance(viewRecord(record), peakKey).map(function (row) {
            return {
              季度: showQuarter(record.quarter),
              站號: record.station,
              路口名稱: record.name,
              時段: SCOPE_SHORT_LABELS[peakKey],
              支線: row.name,
              "駛出（PCU/hr）": row.outbound,
              "駛入（PCU/hr）": row.inbound,
              "差值（PCU/hr）": row.difference,
            };
          });
        });
      });
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [10, 12, 28, 14, 20, 20, 20, 20].map(function (wch) {
        return { wch };
      });
      sheet["!autofilter"] = { ref: sheet["!ref"] || "A1:A1" };
      XLSX.utils.book_append_sheet(workbook, sheet, "支線流量平衡");
    }
    if (wanted.has("quality")) {
      const rows = qualityIssues(exportRecords).map(function (issue) {
        return {
          季度: issue.quarter,
          站號: issue.station,
          類別: issue.category,
          嚴重度:
            issue.severity === "error"
              ? "錯誤"
              : issue.severity === "warning"
                ? "警示"
                : "提示",
          說明: issue.message,
        };
      });
      const sheet = XLSX.utils.json_to_sheet(
        rows.length
          ? rows
          : [
              {
                季度: "－",
                站號: "－",
                類別: "－",
                嚴重度: "－",
                說明: "本次匯出範圍未發現品質問題。",
              },
            ],
      );
      sheet["!cols"] = [10, 12, 16, 10, 70].map(function (wch) {
        return { wch };
      });
      XLSX.utils.book_append_sheet(workbook, sheet, "資料品質檢核");
    }
    if (wanted.has("pce")) {
      // 這張表要寫的是「這些資料實際換算時用的當量」，不是畫面上目前的設定。
      // 每筆記錄在匯入當下就把當時的矩陣存進 pceUsed，之後使用者若在設定頁
      // 改過係數，畫面上的 pce 和資料實際用的就不一樣了。舊版直接輸出畫面
      // 上的 pce，等於在報表裡宣稱一組沒有被用來算過任何一個數字的係數。
      const usedMatrices: { label: string; matrix: PceMatrix }[] = [];
      exportRecords.forEach(function (record) {
        const matrix = record.pceUsed || DEFAULT_PCE;
        const signature = JSON.stringify(matrix);
        const found = usedMatrices.find(function (item) {
          return JSON.stringify(item.matrix) === signature;
        });
        const label = record.station + " " + record.quarter;
        if (found) found.label += "、" + label;
        else usedMatrices.push({ label, matrix });
      });
      if (!usedMatrices.length)
        usedMatrices.push({ label: "目前設定", matrix: pce });
      const pceRow = function (
        scopeLabel: string,
        vehicleId: string,
        factors: { left: number; through: number; right: number },
        sourceNote: string,
      ) {
        return {
          適用資料: scopeLabel,
          車種代碼: vehicleId,
          車種名稱:
            vehicleCatalog[vehicleId] ||
            VEHICLE_LABELS[vehicleId as keyof typeof VEHICLE_LABELS] ||
            vehicleId,
          類別: CORE_VEHICLE_LABELS[vehicleId] ? "標準車種" : "新增車種",
          左轉當量: factors.left,
          直行當量: factors.through,
          右轉當量: factors.right,
          來源:
            sourceNote ||
            (CORE_VEHICLE_LABELS[vehicleId]
              ? "交通流量教育訓練簡報第 15 頁「當量參考值」"
              : "簡報未提供參考值，系統預設 1.0，由使用者確認"),
        };
      };
      const rows = usedMatrices.flatMap(function (entry) {
        return Object.keys(entry.matrix)
          .sort()
          .map(function (vehicleId) {
            return pceRow(
              usedMatrices.length > 1 ? entry.label : "本次匯出全部資料",
              vehicleId,
              entry.matrix[vehicleId],
              "",
            );
          });
      });
      // 使用者可能在匯入之後才新增車種或改係數。那些設定沒有被用來換算本次
      // 匯出的任何一筆資料，但仍要列出來，否則參數表看起來像「這個車種不見了」。
      const appliedIds = new Set(
        usedMatrices.flatMap(function (entry) {
          return Object.keys(entry.matrix);
        }),
      );
      Object.keys(pce)
        .sort()
        .forEach(function (vehicleId) {
          if (appliedIds.has(vehicleId)) return;
          rows.push(
            pceRow(
              "目前設定（未套用於本次匯出資料）",
              vehicleId,
              pce[vehicleId],
              CORE_VEHICLE_LABELS[vehicleId]
                ? "交通流量教育訓練簡報第 15 頁「當量參考值」；本次匯出的資料匯入時尚未使用此車種"
                : "簡報未提供參考值，系統預設 1.0，由使用者確認；本次匯出的資料匯入時尚未使用此車種",
            ),
          );
        });
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [28, 18, 18, 12, 12, 12, 12, 52].map(function (wch) {
        return { wch };
      });
      XLSX.utils.book_append_sheet(workbook, sheet, "車種轉向當量");
    }
    if (!workbook.SheetNames.length)
      throw new Error("勾選的分析項目在目前範圍內沒有資料可輸出。");
    const exportQuarters = Array.from(
      new Set(
        exportRecords.map(function (record) {
          return record.quarter;
        }),
      ),
    ).sort(compareQuarters);
    const includedProjectCodes = Array.from(
      new Set(
        exportRecords.map(function (record) {
          return (
            projects.find(function (project) {
              return project.id === record.projectId;
            })?.code || "Project"
          );
        }),
      ),
    );
    const baseName =
      (includedProjectCodes.length === 1 ? includedProjectCodes[0] : "多計畫") +
      "_" +
      (exportQuarters.length === 1
        ? exportQuarters[0]
        : exportQuarters[0] + "_至_" + exportQuarters.at(-1)) +
      "_分析圖表報表";
    if (format === "xls") {
      return {
        blob: new Blob(
          [XLSX.write(workbook, { bookType: "biff8", type: "array" })],
          {
            type: "application/vnd.ms-excel",
          },
        ),
        filename: baseName + ".xls",
      };
    } else {
      // 沒有勾「歷季趨勢比較」時就沒有圖表要掛的資料表，直接輸出一般 xlsx，
      // 否則注入的圖表會指向不存在的工作表，Excel 開檔會跳修復。
      const bytes = workbook.SheetNames.includes("歷季趨勢比較")
        ? await editableTrendWorkbookBlob(
            workbook,
            "歷季趨勢比較",
            trendRows.length + 1,
            [
              /* trendRows 的欄位順序：A 季度、B 資料別、C～E 三個尖峰。 */
              ...PEAK_KEYS.map(function (key, index) {
                return {
                  name: SCOPE_SHORT_LABELS[key],
                  column: String.fromCharCode(67 + index),
                  color: ["087F75", "D97706", "1D4ED8"][index],
                };
              }),
            ],
          )
        : new Blob(
            [XLSX.write(workbook, { bookType: "xlsx", type: "array" })],
            {
              type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
          );
      return {
        blob: bytes,
        filename: baseName + ".xlsx",
      };
    }
  }

  async function exportExcel(format: "xlsx" | "xls" = "xlsx") {
    // 與報告文字草稿共用同一個範圍計算，兩邊涵蓋的紀錄必定一致。
    const exportRecords = reportExportScope.records;
    if (!exportRecords.length) return notify("選定期間沒有可輸出的資料。");
    if (!activeReportItems.length)
      return notify("請至少勾選一個要匯出的分析項目。");
    try {
      const result = await createAnalysisWorkbook(exportRecords, format);
      downloadBlob(result.blob, result.filename);
      notify(
        format === "xls"
          ? "指定期間的舊版 Excel 已下載（" +
              activeReportItems.length +
              " 個項目）。"
          : "指定期間 Excel 已下載（" +
              activeReportItems.length +
              " 個項目）。",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Excel 匯出失敗。");
    }
  }

  function exportCompositionExcel() {
    if (!current.length) return notify("本季度沒有可輸出的車種組成資料。");
    const unit = compositionScopeUnit(current.map(viewRecord), compositionScope);
    const summaryRows = current.map(function (record) {
      /* 選定的統計範圍算不出來時（例如不足 24 小時卻選了全日尖峰小時），
         數量與比例一律寫「－」，不可以寫 0。 */
      const computable =
        compositionScope === "SURVEY" ||
        hasScopeValue(viewRecord(record), compositionScope);
      const analysisVehicles = recordVehicleIds(record);
      const counts = Object.fromEntries(
        analysisVehicles.map(function (vehicleKey) {
          return [
            vehicleKey,
            recordVehicleTotal(viewRecord(record), compositionScope, vehicleKey),
          ];
        }),
      ) as Record<string, number>;
      const total = analysisVehicles.reduce(function (sum, vehicleKey) {
        return sum + counts[vehicleKey];
      }, 0);
      const row: Record<string, string | number> = {
        計畫代碼: activeProject?.code || "",
        計畫名稱: activeProject?.name || "",
        季度: showQuarter(record.quarter),
        站號: record.station,
        路口名稱: record.name,
        分析範圍: compositionScopeLabel(record, compositionScope),
        時段:
          compositionScope === "SURVEY"
            ? formatSurveyHours(record)
            : scopeWindowLabel(viewRecord(record), compositionScope),
        單位: unit,
        /* 算不出來的統計範圍寫「－」，不是 0——理由同 vehicleComposition。 */
        實際車輛合計: computable ? total : "－",
      };
      analysisVehicles.forEach(function (vehicleKey) {
        const label = vehicleLabel(record, vehicleKey);
        row[label] = computable ? counts[vehicleKey] : "－";
        row[label + "比例（%）"] =
          computable && total ? counts[vehicleKey] / total : "－";
      });
      return row;
    });
    const detailRows = current.flatMap(function (record) {
      /* 選定的統計範圍算不出來時（例如不足 24 小時卻選了全日尖峰小時），
         數量與比例一律寫「－」，不可以寫 0。 */
      const computable =
        compositionScope === "SURVEY" ||
        hasScopeValue(viewRecord(record), compositionScope);
      const analysisVehicles = recordVehicleIds(record);
      const counts = analysisVehicles.map(function (vehicleKey) {
        return recordVehicleTotal(viewRecord(record), compositionScope, vehicleKey);
      });
      const total = counts.reduce(function (sum, count) {
        return sum + count;
      }, 0);
      return analysisVehicles.map(function (vehicleKey, index) {
        return {
          季度: showQuarter(record.quarter),
          站號: record.station,
          路口名稱: record.name,
          分析範圍: compositionScopeLabel(record, compositionScope),
          車種: vehicleLabel(record, vehicleKey),
          單位: unit,
          數量: computable ? counts[index] : "－",
          組成比例: computable && total ? counts[index] / total : "－",
        };
      });
    });
    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    summarySheet["!cols"] = [
      14, 24, 10, 12, 30, 15, 20, 16, 14, 16, 14, 16, 18, 20, 18, 20, 18,
    ].map(function (wch) {
      return { wch };
    });
    summarySheet["!autofilter"] = { ref: summarySheet["!ref"] || "A1:A1" };
    const summaryRange = XLSX.utils.decode_range(
      summarySheet["!ref"] || "A1:A1",
    );
    for (let column = summaryRange.s.c; column <= summaryRange.e.c; column++) {
      const address = XLSX.utils.encode_cell({ r: 0, c: column });
      if (!String(summarySheet[address]?.v || "").includes("比例")) continue;
      for (let row = 1; row <= summaryRange.e.r; row++) {
        const cell = XLSX.utils.encode_cell({ r: row, c: column });
        if (summarySheet[cell]) summarySheet[cell].z = "0.0%";
      }
    }
    XLSX.utils.book_append_sheet(workbook, summarySheet, "車種組成彙整");
    const detailSheet = XLSX.utils.json_to_sheet(detailRows);
    detailSheet["!cols"] = [10, 12, 30, 15, 18, 16, 14, 14].map(function (wch) {
      return { wch };
    });
    detailSheet["!autofilter"] = { ref: detailSheet["!ref"] || "A1:A1" };
    for (let row = 2; row <= detailRows.length + 1; row++)
      if (detailSheet["H" + row]) detailSheet["H" + row].z = "0.0%";
    XLSX.utils.book_append_sheet(workbook, detailSheet, "車種組成明細");
    XLSX.writeFile(
      workbook,
      /* 檔名不帶調查時數（各路口不一樣），只帶範圍名稱。 */
      `${activeProject?.code || "Project"}_${quarter}_${
        compositionScope === "SURVEY"
          ? "全調查時段"
          : SCOPE_LABELS[compositionScope]
      }_車種組成.xlsx`,
      { bookType: "xlsx" },
    );
    notify("車種組成 Excel 已下載。");
  }

  function exportAdvancedExcel(record: TrafficRecord) {
    /*
     * ⚠️ 與畫面**同一份**（見 advancedRecordFor 的說明）：
     *   這一頁自己的時段與車種，而且一律全部轉向。
     */
    const view = advancedRecordFor(record);
    /*
     * 這一份活頁簿的單位涵蓋算一次（2026-09-25 第六輪補）。
     * 原本兩張表都只傳統計範圍、不傳涵蓋，於是選「全日時段」時活頁簿寫
     * 「PCU/調查時段」，而畫面上的同一批數字寫「PCU/調查日」。
     * 變數名刻意與畫面那一份（`advancedCoverage`）不同：這一份的來源是
     * `advancedRecordFor(record)`（真正要匯出的那一筆），不是畫面上選到的那一筆。
     */
    const advancedExportCoverage = coverageOf(view);
    const matrix = odMatrix(view, advancedPeak);
    const matrixRows = matrix.map(function (row) {
      const output: Record<string, string | number> = {
        來源支線: row.origin,
        單位: scopeUnit(advancedPeak, "pcu", advancedExportCoverage),
      };
      record.approaches.forEach(function (approach, index) {
        output["駛入 " + approach.name] = row.values[index];
      });
      return output;
    });
    const balanceRows = branchBalance(view, advancedPeak).map(function (item) {
      return {
        支線: item.name,
        駛入流量: item.inbound,
        駛出流量: item.outbound,
        差值: item.difference,
        /* 同一個活頁簿裡 OD 矩陣已經用同一組參數；這裡寫死 PCU/hr
           會讓兩張表對同一批數字說兩種話（FULL 時差約 24 倍的語意），
           而且與畫面上的「各支線流量平衡」面板也對不起來。 */
        單位: scopeUnit(advancedPeak, "pcu", advancedExportCoverage),
      };
    });
    const sensitivityRows = peakSensitivity(record).map(function (item) {
      return {
        排名: item.rank,
        起始時間: formatMinutes(item.start),
        結束時間: formatMinutes(item.end),
        交通量: item.pcu,
        單位: "PCU/hr",
        實際車輛數: item.vehicles,
        車輛單位: "輛/hr",
      };
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(matrixRows),
      "OD轉向矩陣",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(balanceRows),
      "支線流量平衡",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(sensitivityRows),
      "尖峰敏感度",
    );
    XLSX.writeFile(
      workbook,
      /*
       * ⚠️ 檔名要帶時段。不帶的話，同一個路口在不同時段下載兩次會得到
       *   兩個同名檔，第二次直接蓋掉第一次——而兩份的數字完全不同。
       */
      record.station +
        "_" +
        record.quarter +
        "_" +
        advancedPeak +
        "_轉向進階核對.xlsx",
      { bookType: "xlsx" },
    );
    notify("轉向進階核對 Excel 已下載。");
  }

  function exportQualityExcel() {
    const rows = quarterQualitySummary(current).map(function (item) {
      return {
        季度: item.record.quarter,
        站號: item.record.station,
        路口名稱: item.record.name,
        審核狀態: item.record.review?.status || "待核對",
        AM系統總量: item.am.movement,
        AM_OD總量: item.am.routes,
        AM差值: item.am.difference,
        PM系統總量: item.pm.movement,
        PM_OD總量: item.pm.routes,
        PM差值: item.pm.difference,
        未對應流向數: item.unmapped,
        調查日期: effectiveRecordDate(item.record) || "－",
        檢核結果: item.valid ? "通過" : "需核對",
        流量單位: "PCU/hr",
      };
    });
    /*
     * ⚠️ X-49：「解決方式」要跟著進 Excel。
     *   畫面上有、檔案裡沒有的話，把檔案轉給同事的人就得回頭問一次——
     *   而這張表的用途正是「拿去給別人處理」。
     */
    const issueRows = currentIssues.map(function (issue) {
      return {
        季度: issue.quarter,
        站號: issue.station,
        類別: issue.category,
        嚴重度: issue.severity,
        說明: issue.message,
        處理類別: issue.resolution.kind,
        解決方式: issue.resolution.text,
      };
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(rows),
      "季度品質總表",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(issueRows),
      "問題明細",
    );
    XLSX.writeFile(
      workbook,
      (activeProject?.code || "Project") + "_" + quarter + "_資料品質報告.xlsx",
      { bookType: "xlsx" },
    );
    notify("季度資料品質 Excel 已下載。");
  }

  /*
   * ── 一鍵下載全部圖檔 ────────────────────────────────────────
   *
   * 使用者 2026-09-12：「每張圖都應該要有能直接提供高清晰圖片下載的功能」，
   * 並接受「每張圖旁邊一顆＋這裡一次全部下載」兩個一起做，三支同樣方式。
   *
   * ⚠️ 一次多個下載會被瀏覽器擋掉（而且**不會有錯誤**，使用者只會拿到
   *   前一兩張，以為其餘的沒有這個功能）。所以這裡包成一個 ZIP，
   *   只觸發一次下載。
   */
  const [chartPngPickDiagram, setChartPngPickDiagram] = useState(true);
  const [chartPngPickGeometry, setChartPngPickGeometry] = useState(true);
  const [chartPngPickCard, setChartPngPickCard] = useState(true);
  const [chartPngBusy, setChartPngBusy] = useState(false);

  async function exportAllChartPng() {
    const wantDiagram = chartPngPickDiagram && current.length > 0;
    const wantGeometry = chartPngPickGeometry && Boolean(selected);
    const wantCard = chartPngPickCard && Boolean(selected);
    if (!wantDiagram && !wantGeometry && !wantCard)
      return notify("請至少勾選一種圖檔。");
    setChartPngBusy(true);
    try {
      const zip = new JSZip();
      let count = 0;
      if (wantDiagram)
        for (const record of current) {
          zip.file(
            "路口轉向圖/" +
              record.station +
              "_" +
              record.surveyType +
              "_" +
              peak +
              ".png",
            await svgToPng(
              diagramMarkup(
                record,
                peak,
                "formal",
                "both",
                vehicle,
                "all",
                0,
                flowSummaryMode,
                showQuarter,
              ),
            ),
          );
          count += 1;
        }
      if (wantGeometry && selected) {
        zip.file(
          "路口幾何示意圖/" + selected.station + ".png",
          await svgToPng(buildGeometrySchematic()),
        );
        count += 1;
      }
      if (wantCard && selected) {
        zip.file(
          "交通量圖卡排版/" + selected.station + ".png",
          await svgToPng(buildGeometryCardPreview()),
        );
        count += 1;
      }
      downloadBlob(
        await zip.generateAsync({ type: "blob" }),
        (activeProject?.code || "Project") +
          "_" +
          quarter +
          "_" +
          peak +
          "_圖檔.zip",
      );
      notify("已下載 " + count + " 張高解析圖片（ZIP）。");
    } finally {
      setChartPngBusy(false);
    }
  }

  /*
   * ⚠️ 舊的 exportPngZip（「全部路口 PNG ZIP」）已併入 exportAllChartPng。
   *   留兩支的話，同一份 ZIP 會有兩條產生路徑——一條改了倍率、另一條沒改，
   *   使用者從兩顆按鈕拿到解析度不同的同名檔案，而且看不出差別。
   */

  /*
   * 批次成果包裡的 PDF／PNG 也要跟著畫面上的車種篩選走。
   * 舊寫法這裡傳的是字面 "all"，而單張匯出（exportPdf／exportPngZip）傳的是
   * vehicle：同一個路口、兩顆按鈕，產出的圖內容不同（一張是機車、單位輛/hr，
   * 一張是全車種、單位 PCU/hr），而且沒有任何地方會提醒使用者。
   */
  async function pdfBlob(rows: TrafficRecord[]) {
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
    });
    for (let index = 0; index < rows.length; index++) {
      if (index) pdf.addPage("a4", "landscape");
      const blob = await svgToPng(
        diagramMarkup(
          rows[index],
          peak,
          "formal",
          "both",
          vehicle,
          "all",
          0,
          flowSummaryMode,
          /* 圖上的季度跟著畫面的年份顯示切換走。 */
          showQuarter,
        ),
        2,
      );
      const dataUrl = await new Promise<string>(function (resolve) {
        const reader = new FileReader();
        reader.onload = function () {
          resolve(String(reader.result));
        };
        reader.readAsDataURL(blob);
      });
      pdf.addImage(dataUrl, "PNG", 10, 8, 277, 205);
    }
    return pdf.output("blob");
  }

  async function exportBatchPackage() {
    const selectedQuarters = batchQuarterKeys;
    const rows = records.filter(function (record) {
      return (
        batchProjectIds.includes(record.projectId || "") &&
        selectedQuarters.includes(record.quarter)
      );
    });
    if (!rows.length) return notify("選定的計畫與季度沒有成果資料。");
    try {
      const zip = new JSZip();
      for (const projectId of batchProjectIds) {
        const project = projects.find(function (item) {
          return item.id === projectId;
        });
        const projectRows = rows.filter(function (record) {
          return record.projectId === projectId;
        });
        if (!projectRows.length) continue;
        // 每個計畫都用「自己」勾選的匯出項目，不能全部沿用目前開著的計畫。
        const workbookResult = await createAnalysisWorkbook(
          projectRows,
          "xlsx",
          normalizeReportItems(project?.reportItems),
        );
        const folder = project?.code || projectId;
        zip.file(
          folder + "/Excel/" + workbookResult.filename,
          workbookResult.blob,
        );
        zip.file(
          folder + "/PDF/轉向圖_" + peak + ".pdf",
          await pdfBlob(projectRows),
        );
        for (const record of projectRows) {
          zip.file(
            /* 同上：不帶資料別的話，同一站的平日與假日圖會互相覆寫。 */
            folder +
              "/PNG/" +
              record.quarter +
              "_" +
              record.station +
              "_" +
              record.surveyType +
              "_" +
              peak +
              ".png",
            /* 和單張 PNG 匯出一致：跟著畫面上的車種篩選。 */
            await svgToPng(
              diagramMarkup(
                record,
                peak,
                "formal",
                "both",
                vehicle,
                "all",
                0,
                flowSummaryMode,
                /* 圖上的季度跟著畫面的年份顯示切換走。 */
                showQuarter,
              ),
              2,
            ),
          );
        }
      }
      /*
       * README 要說實話。轉向圖的單位是依「車種篩選」決定的
       * （全車種＝PCU/hr，指定單一車種＝該車種的 輛/hr），
       * 而 PDF／PNG 現在跟著畫面上的篩選走，所以不能寫死 PCU/hr。
       */
      const diagramVehicleLabel =
        vehicle === "all"
          ? "全部車種"
          : vehicleCatalog[vehicle] ||
            VEHICLE_LABELS[vehicle] ||
            CORE_VEHICLE_LABELS[vehicle] ||
            vehicle;
      /*
       * ⚠️ 不可以寫死 /hr：peak 的型別是 ScopeKey，包含 FULL（全日時段），
       * 畫面選單也真的讓使用者選得下去。圖檔本身的單位是跟著 scopeUnit(peak)
       * 走的，README 寫死 PCU/hr 就會和它附的圖對不上——而這包 ZIP 是要交給
       * 業主的成果。實測選「全日時段」時：圖上是「PCU/調查日」，
       * README 卻寫「時段：FULL 尖峰／單位 PCU/hr」。
       */
      /*
        * ⚠️ 涵蓋取**整包**（2026-09-25 第六輪補）：README 描述的是整個 ZIP，
        *   逐筆算會寫出一個只對其中一個路口成立的單位。整包混合時
        *   `coverageOf()` 回 `"mixed"`，單位落在「調查時段」——
        *   那正是使用者定的「混合就統一用調查時段」。
        */
      const diagramUnit = scopeUnit(
        peak,
        vehicle === "all" ? "pcu" : "vehicle",
        coverageOf(rows.map(viewRecord)),
      );
      zip.file(
        "README.txt",
        "Turning Traffic 批次成果包\r\n範圍：" +
          selectedQuarters.join("、") +
          "\r\n時段：" +
          SCOPE_LABELS[peak] +
          "\r\n內容：各計畫分析 Excel、多頁 PDF、各路口 PNG。" +
          "\r\n轉向圖車種：" +
          diagramVehicleLabel +
          "（單位 " +
          diagramUnit +
          "）" +
          "\r\nExcel 內各欄位的單位以該欄標題為準。\r\n",
      );
      downloadBlob(
        await zip.generateAsync({ type: "blob" }),
        "Turning-Traffic_批次成果_" +
          (selectedQuarters[0] || "無季度") +
          "_至_" +
          (selectedQuarters.at(-1) || "無季度") +
          ".zip",
      );
      notify("批次成果包已產生。");
    } catch (error) {
      // 沒有這層保護時，任何一個計畫丟出例外都會讓按鈕看起來毫無反應。
      notify(
        "批次成果包產生失敗：" +
          (error instanceof Error ? error.message : "未知錯誤"),
      );
    }
  }

  /**
   * 產生備份內容。
   *
   * `scopeProjectId` 給值就是「只備份這一個計畫」，不給就是「全部計畫」。
   *
   * 為什麼要分兩種：使用者在 A 電腦做完 A 計畫、按「下載 JSON」帶到 B 電腦，
   * 結果 B 電腦上出現的是 A 電腦裡的**每一個**計畫——包含別的委託案。
   * 舊版兩顆按鈕（完整 ZIP、JSON 純資料）內容其實一模一樣，都是整台電腦，
   * 只是壓不壓縮的差別，畫面上卻沒有講。
   *
   * 單一計畫的備份會帶 `scope: "project"`，還原時據此走「併入」而不是
   * 「整台取代」——否則把 A 計畫搬到 B 電腦就會清掉 B 電腦既有的計畫。
   */
  const backupPayload = function (scopeProjectId?: string) {
    const scoped = Boolean(scopeProjectId);
    const scopedProjects = scoped
      ? projects.filter(function (project) {
          return project.id === scopeProjectId;
        })
      : projects;
    const scopedIds = new Set(
      scopedProjects.map(function (project) {
        return project.id;
      }),
    );
    const scopedRecords = scoped
      ? records.filter(function (record) {
          return record.projectId ? scopedIds.has(record.projectId) : false;
        })
      : records;
    const scopedRecordIds = new Set(
      scopedRecords.map(function (record) {
        return record.id;
      }),
    );
    const pick = function <T>(map: Record<string, T>) {
      return scoped
        ? Object.fromEntries(
            Object.entries(map || {}).filter(function ([key]) {
              return scopedIds.has(key);
            }),
          )
        : map;
    };
    /*
     * ══════════════════════════════════════════════════════════════
     *  ⚠️ 2026-09-25 新增：鍵是「計畫id|其他」這種複合鍵的要走這一支
     * ══════════════════════════════════════════════════════════════
     *
     * pick() 比的是**整個鍵**等不等於計畫 id，所以對
     * `intersectionAliases`（鍵是 `計畫id|舊名`，見別名寫入處）
     * 完全篩不到東西。原本 intersectionAliases 就是直接整包帶走的，
     * 後果有兩個：
     *
     *   ① 匯出**單一計畫**給業主／同事時，檔案裡帶著這台電腦上
     *      **每一個委託案**的路口舊名（別名的值就是路口名稱）。
     *   ② 對方併入後這些鍵帶著來源電腦的計畫 id，永遠對不到任何計畫，
     *      成為清不掉的孤兒（刪計畫的清理只依本機 project.id 前綴篩）。
     *
     * 而同一個物件字面裡的 pceByProject／pceScopesByProject／
     * catalogByProject／reportTemplatesByProject 全部都走了 pick()，
     * 上面還寫著「一定要走 pick()——它只取這次要匯出的那幾個計畫」。
     *
     * ⚠️ 只有這一個 BACKUP payload 要篩。整機 state（TURNING_TRAFFIC_STATE）
     *   本來就該存全部，不可以一起改。
     */
    const pickPrefixed = function <T>(map: Record<string, T>) {
      if (!scoped) return map;
      return Object.fromEntries(
        Object.entries(map || {}).filter(function ([key]) {
          const cut = key.indexOf("|");
          return cut > 0 && scopedIds.has(key.slice(0, cut));
        }),
      );
    };
    return {
      kind: "TURNING_TRAFFIC_BACKUP",
      version: VERSION,
      /** "project"＝只有一個計畫，還原時併入；"all"＝整台電腦，還原時取代。 */
      scope: scoped ? "project" : "all",
      scopeProjectIds: Array.from(scopedIds),
      exportedAt: new Date().toISOString(),
      projects: scopedProjects,
      activeProjectId: scoped ? scopeProjectId : activeProjectId,
      records: scopedRecords,
      nameMap: nameMap,
      /*
       * 一定要存**每個計畫各自那一份**。
       * pce／vehicleCatalog／vehicleMappings 是 pceByProject[activeProjectId]
       * 之類的衍生值，只存它們的話，備份裡只有「匯出當下開著的那個計畫」的
       * 當量矩陣與車種設定；換一台電腦還原之後，其他計畫全部退回系統預設，
       * 而畫面只會說「還原完成」——每一張報表的數字都用預設當量算，
       * 沒有任何警示。
       * 舊欄位仍然保留，這樣新備份也能被舊版讀。
       */
      pceByProject: pick(pceByProject),
      /*
       * ⚠️ 一定要走 pick()——它只取這次要匯出的那幾個計畫。
       *   帶整份對照表出去的話，還原到另一台電腦會把別的計畫的係數
       *   一起塞進去，而使用者明確說過「計畫和計畫之間不能彼此干擾」。
       */
      pceScopesByProject: pick(pceScopesByProject),
      catalogByProject: pick(catalogByProject),
      mappingsByProject: pick(mappingsByProject),
      /*
       * 舊欄位在「單一計畫備份」時要放**那個計畫**的設定，不能放
       * 目前開著的那一個——不然從計畫清單直接匯出別的計畫時，
       * 舊版讀到的當量矩陣會是另一個案子的。
       */
      pce: scoped ? pceByProject[scopeProjectId!] || pce : pce,
      vehicleCatalog: scoped
        ? catalogByProject[scopeProjectId!] || vehicleCatalog
        : vehicleCatalog,
      vehicleMappings: scoped
        ? mappingsByProject[scopeProjectId!] || vehicleMappings
        : vehicleMappings,
      formatMemories: formatMemories,
      /* 「這個轉向存不存在」的使用者答案；換一台電腦要一起帶走。 */
      movementPresence: movementPresence,
      /*
       * 「已人工確認」的異常紀錄（2026-09-23 補）。
       *
       * ⚠️ 原本**整個沒有進備份**，兩條還原路徑也都不讀（`setAckedIssues`
       *   在還原區塊裡出現 0 次）。它是使用者**一顆一顆按出來**的裁決，
       *   與上面的 movementPresence／下面的 intersectionAliases 是同一類東西——
       *   那兩個的註解都寫著「換一台電腦要一起帶走」，只有它漏了。
       *
       * ⚠️ 症狀不是理論：`chooseSurveyDate()` 在使用者指定調查日期時
       *   **同時**寫 surveyDateOverrides 與 ackedIssues（那裡的註解自己寫著
       *   「只寫覆寫的話這一列會一直掛著」）。換電腦還原之後覆寫回來了、
       *   確認沒回來，「調查日期不只一個」整批重新變成未處理，
       *   側欄紅字、品質分數、待人工確認、需處理錯誤四個數字一起回跳，
       *   而畫面只會說「還原完成」。
       *
       * ⚠️ 走 pick()：它依計畫保存，單一計畫備份不可夾帶其他計畫的確認。
       */
      ackedIssues: pick(ackedIssues),
      /*
       * 同一份調查檔有多個日期時，使用者指定的日期要跟著備份走。
       * 這是依計畫保存的資料；單一計畫備份不可夾帶其他計畫的覆寫。
       */
      surveyDateOverrides: pick(surveyDateOverrides),
      /*
       * 「顯示調查日期」是**這台電腦這個人**的顯示偏好，不是計畫資料。
       *
       * ⚠️ 所以只放進「全部計畫」的個人備份包，**單一計畫備份不寫**
       *   （A2／A3，2026-09-21，三支統一，以交通服務水準為準）。
       *   單一計畫備份是拿去給別人、或拿別人的進來用的東西；
       *   夾帶顯示偏好的結果就是併入之後開關被別人的習慣翻掉，
       *   而且畫面上不會有任何提示。還原端也已經不讀它了。
       */
      ...(scoped ? null : { showSurveyDate: showSurveyDate }),
      /*
       * 路口名稱別名。換一台電腦沒帶走的話，那台電腦每一季匯入都會
       * 重新問「要不要併入」——正是這一版要修掉的毛病，換個地方重演。
       *
       * ⚠️ 2026-09-25：鍵是 `計畫id|舊名`，所以走 pickPrefixed() 而不是 pick()。
       *   理由見 pickPrefixed() 的說明（單一計畫匯出會夾帶別的委託案的路口清單）。
       */
      intersectionAliases: pickPrefixed(intersectionAliases),
      /*
       * 範本也要存每個計畫各自那一份，理由與上面的當量矩陣相同：
       * 只存「匯出當下開著的那個計畫」的話，換一台電腦還原之後其他計畫的
       * 範本會全部不見，而畫面只會說「還原完成」。
       */
      reportTemplatesByProject: pick(reportTemplatesByProject),
      conclusionTemplatesByProject: pick(conclusionTemplatesByProject),
      /*
       * 舊欄位在「單一計畫備份」時要放**那個計畫**的範本，
       * 不能放目前開著的那一個。
       */
      reportTemplates: scoped
        ? reportTemplatesByProject[scopeProjectId!] || []
        : reportTemplates,
      conclusionTemplates: scoped
        ? conclusionTemplatesByProject[scopeProjectId!] || []
        : conclusionTemplates,
      recordRevisions: scoped
        ? recordRevisions.filter(function (revision) {
            return scopedRecordIds.has(revision.recordId);
          })
        : recordRevisions,
    };
  };
  /** 檔名裡帶得出計畫是哪一個，B 電腦收到三個檔案時才分得清楚。 */
  const backupFileTag = function (scopeProjectId?: string) {
    const project = projects.find(function (item) {
      return item.id === scopeProjectId;
    });
    const safe = function (value: string) {
      return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    };
    return project
      ? "計畫_" + safe(project.code || "") + "_" + safe(project.name)
      : "完整備份";
  };
  /*
   * 這次開啟程式之後有沒有下載過「全部計畫」的備份。
   *
   * ⚠️ 刻意**不寫進 localStorage**：寫進去的話，三個月前備份過一次
   *   就會讓提醒永遠不再出現——而那份備份早就過期了。
   *   這個旗標要問的是「你手上有沒有一份現在的備份」，
   *   所以每次重新開啟都從頭算。
   * ⚠️ 也刻意只認**全部計畫**的備份：清除是全機的，
   *   只備份了單一計畫不足以救回來。
   */
  const [hasDownloadedBackup, setHasDownloadedBackup] = useState(false);

  async function exportBackupZip(scopeProjectId?: string) {
    if (!scopeProjectId) setHasDownloadedBackup(true);
    const zip = new JSZip();
    zip.file(
      "turning-traffic-backup.json",
      JSON.stringify(backupPayload(scopeProjectId), null, 2),
    );
    zip.file(
      "README.txt",
      (scopeProjectId
        ? "Turning Traffic 單一計畫備份\r\n只含這一個計畫的季度路口資料、當量參數與車種設定。\r\n在另一台電腦匯入時會「併入」，不會清掉那台電腦上原有的計畫。\r\n"
        : "Turning Traffic 完整備份\r\n包含所有計畫、季度路口資料、名稱映射與當量參數。\r\n在另一台電腦匯入時會「完整取代」那台電腦上的資料。\r\n") +
        "匯入位置：開啟同一個網站 →「備份、還原與版本」→ 選擇備份檔。\r\n",
    );
    downloadBlob(
      await zip.generateAsync({ type: "blob" }),
      "Turning-Traffic_" +
        backupFileTag(scopeProjectId) +
        "_" +
        new Date().toISOString().slice(0, 10) +
        ".zip",
    );
  }
  function exportBackupJson(scopeProjectId?: string) {
    if (!scopeProjectId) setHasDownloadedBackup(true);
    downloadBlob(
      new Blob([JSON.stringify(backupPayload(scopeProjectId), null, 2)], {
        type: "application/json",
      }),
      "Turning-Traffic_" +
        backupFileTag(scopeProjectId) +
        "_" +
        new Date().toISOString().slice(0, 10) +
        ".json",
    );
  }
  async function restoreBackup(file: File) {
    try {
      let text = "";
      if (file.name.toLowerCase().endsWith(".zip")) {
        const zip = await JSZip.loadAsync(file);
        const entry = zip.file("turning-traffic-backup.json");
        if (!entry) throw new Error("ZIP 內找不到 turning-traffic-backup.json");
        text = await entry.async("string");
      } else text = await file.text();
      const data = JSON.parse(text);
      if (
        data.kind !== "TURNING_TRAFFIC_BACKUP" ||
        !Array.isArray(data.records)
      )
        throw new Error("格式不符");
      const restoredProjects = Array.isArray(data.projects)
        ? data.projects
        : [
            {
              id: "P-restored",
              code: "RESTORED",
              name: "舊版還原計畫",
              client: "",
              note: "",
              createdAt: new Date().toISOString(),
            },
          ];
      /*
       * ⚠️ 計畫的 id 是**主鍵**：每一筆路口季度資料靠 projectId 掛在計畫底下，
       *   係數、車種目錄、對應表、範本也全部以 id 分組。
       *   舊版只檢查 `kind` 與 `records` 是不是陣列，projects 裡面長什麼樣子
       *   完全沒看。於是一份被改壞（或被別的工具重新輸出）的備份，只要
       *   projects 是 `[]` 或 `[{}]`：
       *     ・`[]` → 下一行取 `[0].id` 丟例外，還算擋得住（是運氣，不是設計）
       *     ・`[{}]` → fallbackId 變成 undefined，整批紀錄的 projectId 也是
       *       undefined，還原「成功」，但每一個畫面都篩不到它們——
       *       資料還在，使用者看到的是空的，而且沒有任何訊息。
       *
       *   這一段與交通服務水準的 isUsableProject 是同一個教訓（2026-09-12
       *   在那一支實測到 `{"kind":"TLM_PORTFOLIO_PACKAGE"}` 會清空全部計畫、
       *   畫面卻報「備份已載入」）。三支程式都要擋。
       */
      if (
        !restoredProjects.length ||
        !restoredProjects.every(function (project: Project) {
          return project && typeof project.id === "string" && project.id !== "";
        })
      )
        throw new Error("備份裡的計畫缺少識別碼，已中止還原");
      const fallbackId = restoredProjects[0].id;
      /*
       * 先把整份新狀態算出來，全部成功了才寫進畫面。
       *
       * 舊寫法是先 setProjects / setActiveProjectId，再去 map records——
       * 中間一旦丟例外，畫面上已經換成備份的計畫清單，但舊紀錄還掛在
       * 舊的 projectId 上，等於整批資料變成孤兒（每個畫面都看不到它們），
       * 而使用者收到的訊息是「還原失敗」，根本不會想到資料已經沒了。
       */
      const restoredRecords = synchronizeGeometryAcrossQuarters(
        data.records.map(function (record: TrafficRecord) {
          if (!record || !Array.isArray(record.approaches))
            throw new Error("備份裡有一筆紀錄缺少支線資料，已中止還原");
          return applyReferenceMovementRule({
            ...record,
            projectId: record.projectId || fallbackId,
            name: storedNameOf(record),
            approaches: record.approaches.map(function (approach) {
              return {
                ...approach,
                bearing: bearingFromAngle(approach.angle),
              };
            }),
            intersectionId:
              record.intersectionId ||
              "I-" + canonicalIntersectionKey(record.name),
          });
        }),
      );
      /*
       * ── 單一計畫備份走「併入」，不清掉這台電腦上原有的計畫 ──
       *
       * 使用者的實際情境：A 電腦做完 A 計畫、匯出、拿到 B 電腦匯入。
       * 若照舊版一律「完整取代」，B 電腦上原本的計畫會全部消失，
       * 而畫面只會說「還原完成」。
       *
       * 判斷方式：備份自己標了 scope="project"（新版單一計畫備份），
       * 或者是「只含一個計畫、而這台電腦上有別的計畫」的舊備份——
       * 後者一樣是使用者要搬一個計畫過來，不該連坐清掉其他案子。
       */
      const incomingIds = new Set(
        restoredProjects.map(function (project: Project) {
          return project.id;
        }),
      );
      const existingOtherProjects = projects.filter(function (project) {
        return !incomingIds.has(project.id);
      });
      const mergeMode =
        data.scope === "project" ||
        (restoredProjects.length === 1 && existingOtherProjects.length > 0);
      if (mergeMode) {
        const replacing = projects.filter(function (project) {
          return incomingIds.has(project.id);
        });
        if (
          projects.length &&
          !window.confirm(
            "這是一份「單一計畫備份」，會「併入」這台電腦，不會動到其他計畫。\n\n" +
              `匯入內容：${restoredProjects
                .map(function (project: Project) {
                  return project.name;
                })
                .join("、")}（${restoredRecords.length} 筆路口季度資料）\n` +
              (replacing.length
                ? `這台電腦上同名同編號的「${replacing
                    .map(function (project) {
                      return project.name;
                    })
                    .join("、")}」會被備份的內容取代。\n`
                : "這台電腦上目前沒有同一個計畫，會新增進來。\n") +
              `其餘 ${existingOtherProjects.length} 個計畫不受影響。\n\n確定要匯入嗎？`,
          )
        ) {
          notify("已取消匯入，資料沒有變動。");
          return;
        }
        const keptRecords = records.filter(function (record) {
          return !incomingIds.has(record.projectId);
        });
        const incomingRecordIds = new Set(
          restoredRecords.map(function (record) {
            return record.id;
          }),
        );
        /** 依 id 併：備份裡有的覆蓋，這台電腦上多出來的保留。 */
        const mergeById = function <T extends { id: string }>(
          mine: T[],
          theirs: unknown,
        ) {
          const list = Array.isArray(theirs) ? (theirs as T[]) : [];
          const byId = new Map(
            mine.map(function (item) {
              return [item.id, item] as const;
            }),
          );
          list.forEach(function (item) {
            if (item && item.id) byId.set(item.id, item);
          });
          return Array.from(byId.values());
        };
        setProjects([...existingOtherProjects, ...restoredProjects]);
        setActiveProjectId(data.activeProjectId || restoredProjects[0].id);
        setRecords([...keptRecords, ...restoredRecords]);
        setNameMap({ ...nameMap, ...(data.nameMap || {}) });
        setPceByProject({ ...pceByProject, ...(data.pceByProject || {}) });
        setPceScopesByProject({
          ...pceScopesByProject,
          ...(data.pceScopesByProject || {}),
        });
        setCatalogByProject({
          ...catalogByProject,
          ...(data.catalogByProject || {}),
        });
        setMappingsByProject({
          ...mappingsByProject,
          ...(data.mappingsByProject || {}),
        });
        setFormatMemories(mergeById(formatMemories, data.formatMemories));
        /*
         * ⚠️ 路口名稱別名要**跟著還原回來**。
         *
         * 使用者 2026-09-11 問「路名有別名的設定嗎? …我驗證不到」。
         * 查下去發現：匯出那邊有寫 intersectionAliases（見上面 9828 附近，
         * 註解甚至寫著「沒帶走的話那台電腦每一季匯入都會重新問」），
         * **但還原這兩條路徑都沒有把它讀回來**——等於備份帶了卻沒有用。
         * 換一台電腦還原之後別名全部消失，而畫面只說「還原完成」。
         *
         * 併入模式：本機已有的答案優先，不被外來備份蓋掉（與範本同一個原則）。
         */
        setIntersectionAliases({
          ...(data.intersectionAliases || {}),
          ...intersectionAliases,
        });
        /*
         * 併入時範本要落在**備份檔自己那些計畫**底下，不是目前開著的計畫。
         *
         * 新版備份帶著 ...ByProject，逐個計畫併；舊版備份只有一個扁平陣列，
         * 那時候範本本來就是全機共用的，所以併給這次還原進來的每一個計畫。
         * 兩種都只動被還原的那些計畫，其他計畫的範本不受影響——這是「併入」
         * 這個動作的承諾。
         */
        const mergeTemplateMap = function <T extends { id: string }>(
          existing: Record<string, T[]>,
          incomingMap: unknown,
          incomingFlat: unknown,
        ) {
          const next = { ...existing };
          const flat = Array.isArray(incomingFlat) ? (incomingFlat as T[]) : [];
          const map =
            incomingMap && typeof incomingMap === "object"
              ? (incomingMap as Record<string, T[]>)
              : null;
          for (const project of restoredProjects) {
            const incoming = map
              ? Array.isArray(map[project.id])
                ? map[project.id]
                : []
              : flat;
            if (!incoming.length && !next[project.id]) continue;
            next[project.id] = mergeById(next[project.id] || [], incoming);
          }
          return next;
        };
        setReportTemplatesByProject(
          mergeTemplateMap(
            reportTemplatesByProject,
            data.reportTemplatesByProject,
            data.reportTemplates,
          ),
        );
        setConclusionTemplatesByProject(
          mergeTemplateMap(
            conclusionTemplatesByProject,
            data.conclusionTemplatesByProject,
            data.conclusionTemplates,
          ),
        );
        if (data.movementPresence && typeof data.movementPresence === "object")
          setMovementPresence(function (existing) {
            /* 併入：本機已有的答案不被外來備份覆蓋掉 */
            return { ...data.movementPresence, ...existing };
          });
        if (
          data.surveyDateOverrides &&
          typeof data.surveyDateOverrides === "object"
        )
          setSurveyDateOverrides(function (existing) {
            /*
             * ⚠️ **要逐筆併，不可以整個計畫換掉**（A6，2026-09-21）。
             *
             *   舊寫法是 `{ ...existing, ...data.surveyDateOverrides }`——
             *   那是**淺層**合併：這份備份裡有 P-1 這個計畫，本機 P-1 底下
             *   原有的其他日期指定就被整批換成備份裡的那一份，**靜默消失**，
             *   畫面上不會有任何提示。
             *
             *   同一支程式裡「紀錄」本身是逐筆合併的（mergeById），
             *   兩個標準不一致的結果就是掉資料。規則統一成：
             *   **備份裡有的覆蓋，備份裡沒有的保留。**
             */
            const merged: Record<string, Record<string, string>> = {
              ...existing,
            };
            for (const [projectId, picks] of Object.entries(
              data.surveyDateOverrides as Record<string, Record<string, string>>,
            )) {
              if (!picks || typeof picks !== "object") continue;
              merged[projectId] = { ...(existing[projectId] || {}), ...picks };
            }
            return merged;
          });
        /*
         * 「已人工確認」的異常紀錄（2026-09-23 補）：與上面同一套逐筆合併。
         *
         * ⚠️ 兩條還原路徑原本都不讀它，而 `chooseSurveyDate()` 是
         *   **同時**寫 surveyDateOverrides 與 ackedIssues 的——只還原前者的話，
         *   覆寫回來了、確認沒回來，那幾列會整批重新掛回未處理。
         * ⚠️ 一樣是逐筆併，不可以整個計畫換掉（理由同上）。
         */
        if (data.ackedIssues && typeof data.ackedIssues === "object")
          setAckedIssues(function (existing) {
            const merged: Record<string, Record<string, { at: string }>> = {
              ...existing,
            };
            for (const [projectId, acks] of Object.entries(
              data.ackedIssues as Record<
                string,
                Record<string, { at: string }>
              >,
            )) {
              if (!acks || typeof acks !== "object") continue;
              merged[projectId] = { ...(existing[projectId] || {}), ...acks };
            }
            return merged;
          });
        /*
         * ⚠️ **「顯示調查日期」不跟著單一計畫備份走**（A2／A3，2026-09-21）。
         *
         *   它是「這台電腦這個人想不想看到那一欄」的顯示偏好，不是計畫資料。
         *   舊寫法在併入別人的單一計畫備份時會把它翻掉——使用者只是想拿
         *   一個計畫進來，開關卻被別人的習慣改掉，而且不會有任何提示。
         *   三支統一以交通服務水準的做法為準：**跟人走，不跟單一計畫備份走**。
         *   （完整的個人全部計畫包仍然會還原它，見下方 restore 那一段。）
         */
        setRecordRevisions(
          trimRevisionBatches(
            mergeById(
              recordRevisions.filter(function (revision) {
                return !incomingRecordIds.has(revision.recordId);
              }),
              data.recordRevisions,
            ),
          ),
        );
        notify(
          "已併入 " +
            restoredProjects.length +
            " 個計畫、" +
            restoredRecords.length +
            " 筆資料；其他計畫沒有變動。",
        );
        return;
      }
      /*
       * 還原是全站唯一一個會整批覆蓋的動作，一定要先問過。
       * 刪計畫、刪季度、全部清除、甚至取消預覽都有確認視窗，只有這裡沒有。
       */
      const lockedCount = records.filter(function (record) {
        return Boolean(record.resultLock);
      }).length;
      if (
        records.length &&
        !window.confirm(
          "還原會用備份的內容「完整取代」這台電腦上目前的資料。\n\n" +
            `目前有 ${projects.length} 個計畫、${records.length} 筆路口季度資料` +
            (lockedCount ? `（其中 ${lockedCount} 筆已鎖定成果）` : "") +
            "，全部會被覆蓋且無法復原。\n" +
            `備份內容為 ${restoredProjects.length} 個計畫、${restoredRecords.length} 筆資料。\n\n` +
            "建議先下載一份目前的備份再繼續。確定要還原嗎？",
        )
      ) {
        notify("已取消還原，資料沒有變動。");
        return;
      }
      setProjects(restoredProjects);
      setActiveProjectId(data.activeProjectId || fallbackId);
      setRecords(restoredRecords);
      setNameMap(data.nameMap || {});
      /*
       * ⚠️ 路口名稱別名要一起還原（理由見併入那一條的說明）。
       *   取代模式就是整份換掉，與 nameMap 同一個處理方式。
       */
      setIntersectionAliases(data.intersectionAliases || {});
      /*
       * 還原時要直接寫整份 byProject，不能用 scoped setter——
       * scoped setter 只會寫進「還原前」那個 activeProjectId 的那一格
       * （setActiveProjectId 不會改變這次 render 閉包裡的值），其他計畫的
       * 設定全部遺失；還原前沒選任何計畫時甚至完全不寫入。
       * 舊備份沒有 byProject 時，沿用載入 localStorage 的同一套遷移方式：
       * 把那一組複製給每一個還原回來的計畫。
       */
      const restoredIds = restoredProjects.map(function (project: Project) {
        return project.id;
      });
      const spreadToAll = function <T>(value: T) {
        return Object.fromEntries(
          restoredIds.map(function (id: string) {
            return [id, value];
          }),
        ) as Record<string, T>;
      };
      setPceByProject(
        data.pceByProject && typeof data.pceByProject === "object"
          ? data.pceByProject
          : spreadToAll(data.pce || DEFAULT_PCE),
      );
      /*
       * ⚠️ 取代式還原：舊備份沒有這個欄位時要留**空**，不是保留目前的覆寫。
       *   保留的話，把 A 案的備份還原上來之後，B 案殘留的覆寫會繼續生效，
       *   而畫面會宣稱那些是還原進來的設定。
       */
      setPceScopesByProject(
        data.pceScopesByProject && typeof data.pceScopesByProject === "object"
          ? data.pceScopesByProject
          : {},
      );
      setCatalogByProject(
        data.catalogByProject && typeof data.catalogByProject === "object"
          ? data.catalogByProject
          : spreadToAll({
              ...CORE_VEHICLE_LABELS,
              ...(data.vehicleCatalog || {}),
            }),
      );
      setMappingsByProject(
        data.mappingsByProject && typeof data.mappingsByProject === "object"
          ? data.mappingsByProject
          : spreadToAll(data.vehicleMappings || {}),
      );
      setFormatMemories(
        Array.isArray(data.formatMemories) ? data.formatMemories : [],
      );
      /* 舊備份的扁平清單，每個計畫各給一份（同載入時的遷移作法）。 */
      setReportTemplatesByProject(
        data.reportTemplatesByProject &&
          typeof data.reportTemplatesByProject === "object"
          ? data.reportTemplatesByProject
          : spreadToAll(
              Array.isArray(data.reportTemplates) ? data.reportTemplates : [],
            ),
      );
      setConclusionTemplatesByProject(
        data.conclusionTemplatesByProject &&
          typeof data.conclusionTemplatesByProject === "object"
          ? data.conclusionTemplatesByProject
          : spreadToAll(
              Array.isArray(data.conclusionTemplates)
                ? data.conclusionTemplates
                : [],
            ),
      );
      setMovementPresence(
        data.movementPresence && typeof data.movementPresence === "object"
          ? data.movementPresence
          : {},
      );
      setSurveyDateOverrides(
        data.surveyDateOverrides &&
          typeof data.surveyDateOverrides === "object"
          ? data.surveyDateOverrides
          : {},
      );
      /*
       * 「已人工確認」（2026-09-23 補）。這一條是**完整取代**分支，
       * 所以與上面幾個一樣直接換掉；備份沒有這一欄時給空物件。
       */
      setAckedIssues(
        data.ackedIssues && typeof data.ackedIssues === "object"
          ? (data.ackedIssues as Record<
              string,
              Record<string, { at: string }>
            >)
          : {},
      );
      setShowSurveyDate(
        typeof data.showSurveyDate === "boolean" ? data.showSurveyDate : true,
      );
      setRecordRevisions(
        trimRevisionBatches(
          Array.isArray(data.recordRevisions) ? data.recordRevisions : [],
        ),
      );
      notify("還原完成，可在這台電腦繼續使用。");
    } catch (error) {
      notify(
        "還原失敗：" + (error instanceof Error ? error.message : "檔案無效"),
      );
    }
  }

  const allRecordsEmpty = records.length === 0;
  const noProject = !activeProject;
  const renderNoData = function (title: string) {
    return (
      <Empty
        title={title}
        text={
          noProject
            ? "請先建立計畫，再匯入季度調查檔。"
            : "目前計畫尚無正式資料；系統不預載示範數值。"
        }
        action={
          <button
            className="primary empty-action"
            onClick={function () {
              setView(noProject ? "projects" : "import");
            }}
          >
            {noProject ? "建立計畫" : "前往匯入"}
          </button>
        }
      />
    );
  };

  /*
   * 讀取失敗時不進主程式。
   * 主程式一 render 就會開始存檔，那一步才是真正把使用者資料弄丟的動作；
   * 這裡先擋下來，把原始 JSON 交還給使用者，讓他至少能救回資料。
   */
  /*
   * 儲存空間用不了時，系統無法判斷本機原本有沒有資料，也無法讀出來備份；
   * 「原始資料仍完整保留」不能保證，按下載鈕也只會再拋一次同樣的例外。
   * 所以這裡分成兩種畫面，講各自該講的話。
   */
  if (loadError && storageBlocked)
    return (
      <div className="load-error">
        <div className="load-error-card">
          <h1>瀏覽器不允許這個網站儲存資料</h1>
          <p>
            這個系統把資料存在您自己的瀏覽器裡，目前瀏覽器擋住了這項功能，
            所以<b>資料讀不出來、也存不進去</b>。
            這不代表資料已損壞或不存在；在儲存權限恢復前，系統無法判斷這台電腦原本是否有資料。
          </p>
          <p className="load-error-reason">錯誤訊息：{loadError}</p>
          <p>常見原因與處理方式：</p>
          <ul className="load-error-list">
            <li>瀏覽器設定成「封鎖所有 Cookie／網站資料」——請對本網站開放。</li>
            <li>使用了會阻擋本機儲存的無痕或隱私模式——請改用一般視窗。</li>
            <li>擴充套件（隱私或廣告阻擋類）擋下了本網站——請將本站加入例外。</li>
          </ul>
          <div className="load-error-actions">
            <button
              className="primary"
              onClick={function () {
                window.location.reload();
              }}
            >
              調整設定後，重新載入
            </button>
          </div>
          <p className="load-error-note">
            在這個狀態下請不要匯入資料——畫面上看起來會成功，但關掉分頁就會全部消失。
          </p>
        </div>
      </div>
    );

  if (loadError)
    return (
      <div className="load-error">
        <div className="load-error-card">
          <h1>無法讀取這台電腦上的資料</h1>
          <p>
            儲存在瀏覽器裡的資料有一部分格式不符，系統為了避免把它覆蓋掉，
            這次<b>沒有載入、也沒有寫入任何東西</b>。您的原始資料仍然完整保留在
            瀏覽器裡。
          </p>
          <p className="load-error-reason">錯誤訊息：{loadError}</p>
          <p>
            建議先按「下載原始資料備份」把原始資料存成檔案（那是一份完整的備份），
            再把檔案提供給維護人員；確認之後可以用「備份、還原與版本」還原回來。
          </p>
          <div className="load-error-actions">
            <button
              className="primary"
              onClick={function () {
                /*
                 * 只讀、不搬遷、不清理：要救的就是這一份，
                 * 在搶救畫面上做任何寫入都可能把它弄壞。
                 */
                readRawState().then(
                  function (raw) {
                    if (!raw) {
                      window.alert(
                        "找不到可以下載的原始資料；請直接把這個畫面的錯誤訊息提供給維護人員。",
                      );
                      return;
                    }
                    downloadBlob(
                      new Blob([raw], { type: "application/json" }),
                      "turning-traffic-原始資料備份.json",
                    );
                  },
                  function (error) {
                    /* 讀得到才走得到這個畫面，但按下去時權限可能已經變了 */
                    window.alert(
                      "備份下載失敗：" +
                        (error instanceof Error
                          ? error.message
                          : String(error)),
                    );
                  },
                );
              }}
            >
              下載原始資料（先做這個）
            </button>
            <button
              className="secondary"
              onClick={function () {
                window.location.reload();
              }}
            >
              重新載入試試
            </button>
          </div>
          <p className="load-error-note">
            請勿在下載之前按「清除」或重新匯入——那會讓原始資料真的消失。
          </p>
        </div>
      </div>
    );

  return (
    <div className="app-shell">
      <aside className={mobileNav ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <span className="brand-mark">TT</span>
          <div>
            <strong>Turning Traffic</strong>
            <small>尖峰轉向交通量分析</small>
          </div>
        </div>
        <nav>
          {NAV.map(function (item) {
            return (
              <div key={item.id}>
                {/*
                 * ── 分類標題：放大，並且可以整區收合 ──────────────────
                 *
                 * 使用者 2026-09-14：「分類標題(一、二、三...)文字太小，
                 *   可以比照全日交通量那樣，並且附帶展開收合功能」
                 *
                 * ⚠️ 收合鈕包在 <p> 裡面，**不可以**把 <p> 自己改成 <button>。
                 *   側欄有八支既有守門是用 `nav > div > button` 列出大分頁的；
                 *   多一顆同層的 button 進去，那些守門會把分類標題也當成一個
                 *   分頁去點——同一個坑 2026-09-13 已經踩過一次（收合鈕的「▾」
                 *   混進分頁清單，三支守門全部絆倒）。
                 */}
                {item.group && (
                  <p className="nav-group">
                    {/*
                     * ⚠️ 這裡**刻意用 span＋role="button"**，不是真的 <button>。
                     *
                     *   第一版用了 <button>，端對端測試立刻紅：
                     *   有十幾支守門是用 `nav button` 把側欄所有按鈕列出來當成
                     *   「分頁清單」，然後逐一點過去。分類標題一旦是 button，
                     *   就會被當成一個分頁去點——而點它是「收合這一區」，
                     *   於是這一區的分頁全部消失，後面每一項都找不到
                     *  （e2e-period-month 卡在「▦建立與管理計畫」點不到）。
                     *
                     *   2026-09-13 收合鈕的「▾」也踩過同一個坑，當時是去修
                     *   那三支守門。這次影響到十幾支，逐一去加 :not() 風險更高
                     *  （漏掉一支就是一個安靜的陷阱），所以改成「讓它根本不是
                     *   button」——`nav button` 就永遠選不到它，一支守門都不用改。
                     *
                     * ⚠️ 不是 button 就要自己補鍵盤操作：tabIndex 讓它可以 Tab 到，
                     *   onKeyDown 處理 Enter 與空白鍵。role="button" 讓螢幕報讀
                     *   仍然唸成按鈕。
                     */}
                    <span
                      role="button"
                      tabIndex={0}
                      className="nav-zone-toggle"
                      data-zone-toggle={item.zone ?? ""}
                      onKeyDown={function (event) {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.currentTarget.click();
                      }}
                      aria-expanded={!zoneCollapsed.includes(item.zone ?? "")}
                      aria-label={
                        "收合或展開「" + item.group + "」這一區的分頁"
                      }
                      onClick={function () {
                        const key = item.zone ?? "";
                        setZoneCollapsed(function (previous) {
                          const next = previous.includes(key)
                            ? previous.filter(function (id) {
                                return id !== key;
                              })
                            : previous.concat(key);
                          try {
                            localStorage.setItem(
                              ZONE_COLLAPSE_KEY,
                              JSON.stringify(next),
                            );
                          } catch {
                            /* 存不進去只影響「下次還記得」，這一次照樣收合。 */
                          }
                          return next;
                        });
                      }}
                    >
                      {/*
                       * ⚠️ 同 .nav-collapse：只能用 ▼（Big5 A1B9）＋ CSS 轉角度，
                       *   \u25b8／\u25be（▸／▾）不在 Big5，某些電腦上會是空白。
                       *   也不可以寫成 \uXXXX 跳脫——字形守門掃的是原始碼裡的字元。
                       */}
                      <i
                        aria-hidden="true"
                        className={
                          zoneCollapsed.includes(item.zone ?? "")
                            ? "is-collapsed"
                            : ""
                        }
                      >
                        ▼
                      </i>
                      {item.group}
                    </span>
                  </p>
                )}
                {/*
                 * ══════════════════════════════════════════════════════
                 *  小分頁可以收合（使用者 2026-09-13，三支同步）
                 * ══════════════════════════════════════════════════════
                 *
                 * 「使用者點選了大分頁後，會展開下面的小分頁，那能否做個
                 *   **可以讓使用者把小分頁收合**的功能? ……因為**目前點選大分頁
                 *   是會有跳轉功能的**，所以……可能要想一下怎麼做」
                 *
                 * ⚠️ 衝突點是使用者自己先指出來的：那一列的點擊現在是「切到那一頁」。
                 *   改成「切換收合」會把跳轉弄丟。所以收合鈕是**獨立一顆**，
                 *   排在同一列的最右側，那一列其餘區域的行為一個字都沒改。
                 * ⚠️ 收合鈕是大分頁按鈕的**直接兄弟**，不另外包一層——
                 *   包一層的話 `nav > div > button` 這個選擇器就打不到了，
                 *   而**八支既有守門**都是那樣寫的。
                 *   兩顆並排改由 nav > div 的格線負責（見 globals.css）。
                 */}
                {/*
                 * ⚠️ 分類收起來時，這一區的大分頁按鈕就不渲染。
                 *   用 `hidden`／`display:none` 留在 DOM 裡也可以，但那樣
                 *   既有那八支用 `nav > div > button` 列分頁的守門仍然會
                 *   列到它、去點它，然後在「點了沒反應」的地方卡住。
                 *   乾脆不渲染，語意也比較誠實：收起來就是看不到。
                 */}
                {!zoneCollapsed.includes(item.zone ?? "") && (
                <button
                  className={
                    (view === item.id ? "active" : "") +
                    (item.zone ? " zone-" + item.zone : "")
                  }
                  /*
                   * ⚠️ **點大分頁＝要看那一頁，所以它底下的小分頁要展開。**
                   *
                   *   使用者 2026-09-14 在交通服務水準上回報（附圖）：
                   *   「當我點選大分頁標題(路段管理)時，它並沒有展開而是保持收合，
                   *     請修正成自動展開下面的各項小分頁」，並接著要求
                   *   「請同步確認三份程式是否都能自動展開」。
                   *
                   *   這一支是同一個毛病：收合狀態寫在 localStorage，
                   *   按過一次收合鈕之後那一頁就**永遠**是收的，
                   *   再怎麼點大分頁都不會展開。收合鈕照常可以收，
                   *   但「切過去」這個動作本身要把它展開。
                   */
                  onClick={function () {
                    setNavCollapsed(function (previous) {
                      if (!previous.includes(item.id)) return previous;
                      const next = previous.filter(function (id) {
                        return id !== item.id;
                      });
                      return next;
                    });
                    setView(item.id);
                    setFocusedBlock("");
                    setMobileNav(false);
                  }}
                >
                  {item.label}
                  {/*
                   * ⚠️ 側欄這個紅字回答的是「還有幾件事等著我處理」，
                   *   所以讀 openIssues（已確認的不算）。讀 currentIssues 的話，
                   *   使用者按完確認、其他地方都歸零了，只有這裡還亮著，
                   *   他會以為確認沒成功——2026-09-21 回報的就是這一幕。
                   */}
                  {item.id === "maintenance" && openIssues.length > 0 && (
                    <b>{openIssues.length}</b>
                  )}
                </button>
                )}
                {/*
                 * ⚠️ 只有「這一頁真的列得出小分頁」時才給收合鈕——
                 *   擺一顆按下去毫無反應的鈕，和按鈕壞掉沒有分別。
                 */}
                {/*
                 * ⚠️ 這裡**一定要**也判斷 `!zoneCollapsed.includes(item.zone)`。
                 *
                 *   2026-09-15 使用者附三張圖回報：「二 參數設定收合時，
                 *   出現空白大分頁收合狀況」。成因就是這裡——
                 *   大分頁按鈕（上面那一段）收起分類時就不渲染了，
                 *   但這一顆收合鈕只看 `view === item.id`，
                 *   於是**目前那一頁**的收合鈕會單獨留在畫面上：
                 *   一顆沒有標籤、只有一個箭頭的孤兒按鈕浮在分類標題底下。
                 *
                 * ⚠️ 下面的 `.nav-sections` 同理，兩處要一起判斷——
                 *   只改一處的話，收起分類之後小分頁還會列出來。
                 */}
                {view === item.id &&
                  !zoneCollapsed.includes(item.zone ?? "") &&
                  item.sections &&
                  navSectionsReady(item.id) && (
                    <button
                      type="button"
                      className="nav-collapse"
                      data-collapse-view={item.id}
                      aria-expanded={!navCollapsed.includes(item.id)}
                      aria-label={"收合或展開「" + item.label + "」底下的小分頁"}
                      onClick={function (event) {
                        /* ⚠️ 擋下來，不然會冒泡成換頁。 */
                        event.stopPropagation();
                        setNavCollapsed(function (previous) {
                          const next = previous.includes(item.id)
                            ? previous.filter(function (id) {
                                return id !== item.id;
                              })
                            : previous.concat(item.id);
                          /* ⚠️ 不寫進 localStorage，理由見 readNavCollapsed。 */
                          return next;
                        });
                      }}
                    >
                      {/*
                       * ⚠️ 用箭頭，不是文字。使用者 2026-09-14 先提了文字標籤，
                       *   看過全日交通量之後改口：「這樣顯眼的箭頭，也可以很好
                       *   表達可以展開收合……不用改成展開/收合的文字了」。
                       *   當初的問題是「太淺」，不是「用了箭頭」——底色與外框見 globals.css。
                       */}
                      {/*
                       * ⚠️ 只能用 ▼（U+25BC，Big5 A1B9）＋ CSS 轉角度。
                       *   原本寫的是 \u25b8／\u25be（▸／▾）——那兩個字
                       *   **不在 Big5 字集裡**，微軟正黑體畫不出來，
                       *   在某些電腦上會變成空白，看起來像這顆鈕壞掉。
                       *   使用者 2026-09-15：「這個圖示比較重要，是讓人可以
                       *     展開／收合的按鈕，所以請以**任何電腦都能看到**為前題」。
                       *
                       * ⚠️ 而且**不可以寫成 \uXXXX 跳脫**：字形守門掃的是
                       *   原始碼裡的字元，跳脫寫法它看不到——這兩顆就是這樣
                       *   躲過守門的（2026-09-15 查到，守門已一併補上跳脫的掃描）。
                       */}
                      ▼
                    </button>
                  )}
                {/*
                 * 目前這一頁底下列出它有哪幾塊，點了直接跳過去並把那一塊
                 * 用外框「點名」。作法與全日交通量的側欄一致（三支同一套）。
                 *
                 * ⚠️ 只在 view === item.id 時渲染：18 個分頁全部攤開
                 *   會變成四十幾列，反而找不到東西。
                 */}
                {view === item.id &&
                !zoneCollapsed.includes(item.zone ?? "") &&
                item.sections &&
                navSectionsReady(item.id) &&
                !navCollapsed.includes(item.id) ? (
                  <div className="nav-sections">
                    {item.sections
                      /*
                       * ⚠️ 列不出對應區塊的小分頁一律**不要列**。
                       *   列了卻點不到，使用者看到的是「這個按鈕壞了」，
                       *   而且沒有任何訊息告訴他為什麼。
                       *   守門：scripts/e2e-nav-target.mjs（用空計畫測）。
                       */
                      .filter(function (section) {
                        /* 便宜的前置過濾：明顯不可能有的就不必再量。 */
                        if (section.needs === "record" && !selected) return false;
                        if (
                          section.needs === "records" &&
                          projectRecords.length === 0
                        )
                          return false;
                        /*
                         * ⚠️ 最終由**畫面**決定（見 presentAnchors 那一段）。
                         *   不可以改回「宣告了就列」——那正是 2026-09-12
                         *   五個點不到的小分頁能活下來的原因。
                         */
                        return presentAnchors.includes(section.anchor);
                      })
                      .map(function (section) {
                      return (
                        <button
                          key={section.anchor}
                          className={
                            focusedBlock === section.anchor
                              ? "nav-section current"
                              : "nav-section"
                          }
                          data-goto-item={section.label}
                          /*
                           * ⚠️ 錨點要寫在 DOM 上（全日交通量那一支本來就有）。
                           *   盤點型的守門要比對「這一頁有哪些區塊」與
                           *   「別頁有哪些區塊」，只有中文標籤比不了——
                           *   標籤和 id 不是一對一。使用者看不到這個屬性。
                           */
                          data-anchor={section.anchor}
                          onClick={function () {
                            setFocusedBlock(section.anchor);
                            setMobileNav(false);
                            /*
                             * ⚠️ 要等下一個影格才找得到元素：點名是 React 狀態，
                             *   這一輪 render 還沒把 class 掛上去。
                             */
                            requestAnimationFrame(function () {
                              document
                                .getElementById(section.anchor)
                                ?.scrollIntoView({ block: "start" });
                            });
                          }}
                        >
                          {section.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <span>
            <i /> 本機資料自動儲存
          </span>
          <small>{VERSION} · 正式版</small>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button
            className="menu"
            onClick={function () {
              setMobileNav(!mobileNav);
            }}
          >
            ≡
          </button>
          <div>
            <span className="crumb">
              Turning Traffic /{" "}
              {
                NAV.find(function (n) {
                  return n.id === view;
                })?.label
              }
            </span>
            <strong>
              {
                NAV.find(function (n) {
                  return n.id === view;
                })?.label
              }
            </strong>
          </div>
          <div className="top-actions">
            <label>
              計畫
              <select
                value={activeProjectId}
                onChange={function (e) {
                  setActiveProjectId(e.target.value);
                }}
              >
                <option value="">尚未選擇</option>
                {projects.map(function (p) {
                  return (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              季度
              <select
                value={quarter}
                onChange={function (e) {
                  setQuarter(e.target.value);
                }}
              >
                {/*
                  「尚無季度」只在真的一季都沒有的時候才是提示；有季度時它是一顆
                  死選項——選了會把季度設成空字串，緊接著 useEffect 又把它拉回最新
                  一季，所以使用者看到的是「點了什麼事都沒發生」。全系統六個季度
                  選單，也只有這一個有它。
                */}
                {quarters.length === 0 && <option value="">尚無季度</option>}
                {quarters.map(function (q) {
                  return (
                    <option key={q} value={q}>
                      {quarterLabel(q)}
                    </option>
                  );
                })}
              </select>
            </label>
            {/*
              期別顯示切換。只換畫面上的文字，資料仍以季別分組與計算。
              一季都讀不到調查日期時停用，並在 title 說明原因，
              而不是給一顆按了沒反應的按鈕。
            */}
            <button
              type="button"
              className={
                periodDisplay === "month"
                  ? "period-display-toggle is-on"
                  : "period-display-toggle"
              }
              data-testid="period-display-toggle"
              disabled={!anySurveyDate}
              title={
                anySurveyDate
                  ? "切換期別顯示方式：季別（115Q1）／實際調查月份（115年2、3月）。只換顯示文字，不影響分組與計算。"
                  : "目前的資料沒有調查日期可用，無法顯示調查月份。重新匯入原始檔之後就會有。"
              }
              onClick={function () {
                setPeriodDisplay(
                  periodDisplay === "month" ? "quarter" : "month",
                );
              }}
            >
              期別顯示：{PERIOD_DISPLAY_LABELS[periodDisplay]}
            </button>
            {/*
              年份顯示切換。與上面那顆是兩個獨立的軸：一個換「季別／調查月份」，
              一個換「民國／西元」。合成一顆循環鈕會變成四種狀態，反而難用。
            */}
            <button
              type="button"
              className={
                yearStyle === "ad"
                  ? "period-display-toggle is-on"
                  : "period-display-toggle"
              }
              data-testid="year-style-toggle"
              title="切換年份顯示方式：民國年（115Q1）／西元年（2026Q1）。畫面與匯出的 Excel 會一起換；資料一律以民國年儲存，切換不影響分組、排序與計算。"
              onClick={function () {
                setYearStyle(yearStyle === "ad" ? "roc" : "ad");
              }}
            >
              年份顯示：{YEAR_STYLE_LABELS[yearStyle]}
            </button>
            <span className="demo-pill">
              {allRecordsEmpty ? "空白正式環境" : projects.length + " 個計畫"}
            </span>
          </div>
        </header>
        {/*
         * ── 主工具列 ────────────────────────────────────────────
         *
         * 升級前這些條件散在各頁：「時段」只出現在路口轉向圖那一頁，
         * 卻是全站共用的——在那裡切一下，另外三頁的數字就跟著換了，
         * 而那三頁上沒有任何地方顯示現在依的是哪個時段（實測 2026-09-14）。
         * 集中到這裡，才可能讓同一份資料在每一頁講同一句話。
         */}
        <MainToolbar
          filters={mainFilters}
          quarters={quarters}
          quarterLabel={quarterLabel}
          intersectionOptions={mainIntersectionOptions}
          vehicleOptions={mainVehicleOptions}
          peakDisabledReason={function (choice) {
            /*
             * 「全調查時段尖峰」要有逐時間格資料才算得出來。
             * 選項照樣列出來（不然使用者不知道有這個功能），但選不下去，
             * 並寫出為什麼——顯示 0 比顯示「－」危險得多，0 會被抄進報告。
             * ⚠️ 並列（AMPM）要 AM 與 PM 都算得出來才選得下去。
             */
            if (choice === "AMPM") {
              const reasons = (["AM", "PM"] as ScopeKey[])
                .map(function (key) {
                  return selected ? fullDayUnavailableReason(selected, key) : null;
                })
                .filter(Boolean);
              return reasons.length ? String(reasons[0]) : null;
            }
            return selected
              ? fullDayUnavailableReason(selected, choice as ScopeKey)
              : null;
          }}
          onQuarterFrom={function (value) {
            /*
             * ⚠️ 使用者自己動過之後就不再自動跟著季度清單跑，
             *   否則他每匯入一季，設好的區間就被擦掉一次。
             */
            setQuarterFromTouched(true);
            setQuarterFrom(value);
          }}
          onQuarterTo={function (value) {
            setQuarter(value);
            /*
             * ⚠️ 起比迄晚的話要把起拉回來。不擋的話會算出一段空區間，
             *   畫面一片空白而且看不出原因。
             */
            if (quarterFrom && compareQuarters(quarterFrom, value) > 0) {
              setQuarterFromTouched(true);
              setQuarterFrom(value);
            }
          }}
          onIntersections={setMainIntersections}
          onPeak={setPeakChoice}
          onPeakRule={setPeakRule}
          onFlowView={setFlowSummaryMode}
          onDay={setDayChoice}
          onVehicle={function (value) {
            setVehicle(value as VehicleKey);
          }}
          onMovement={setMovementChoice}
          onDisplay={function (value) {
            setDisplayMode(value as DisplayMode);
          }}
          detachedCount={detachedCharts.length}
          detachedItems={detachedItems}
          onGotoDetached={function (id) {
            setView(id as View);
          }}
          onResetAll={function () {
            setChartOverrides(resetAllCharts());
          }}
          /*
           * X-10：把主工具列自己的條件回到預設（使用者 2026-09-16）。
           *
           * ⚠️ 一個字都不碰 chartOverrides——那是 onResetAll 的事。
           *   兩顆合併的話，使用者只想把條件歸零，卻連自己在某一張圖上
           *   設好的條件也一起被清掉，而那是他刻意設的。
           * ⚠️ quarterFromTouched 要一起放掉，否則上面那個 useEffect 認為
           *   「使用者自己拉過區間」而不肯把起季拉回最早一季——
           *   按了之後季度那一格原封不動，看起來像按鈕壞了。
           */
          onResetMain={function () {
            setQuarterFromTouched(false);
            setQuarter(quarters[quarters.length - 1] || "");
            setQuarterFrom(quarters[0] || "");
            setMainIntersections([]);
            setPeakChoice(DEFAULT_MAIN_FILTERS.peak);
            setPeakRule(DEFAULT_MAIN_FILTERS.peakRule);
            setFlowSummaryMode(
              DEFAULT_MAIN_FILTERS.flowView as FlowSummaryMode,
            );
            setDayChoice(DEFAULT_MAIN_FILTERS.day);
            setVehicle(DEFAULT_MAIN_FILTERS.vehicle as VehicleKey);
            setMovementChoice(DEFAULT_MAIN_FILTERS.movement);
            setDisplayMode(DEFAULT_MAIN_FILTERS.display as DisplayMode);
          }}
        />
        <div className="content">
          {/*
           * ⚠️ 篩到一筆都不剩時**一定要說出來**。
           *   什麼都不畫的話，畫面和「這一季本來就沒有資料」長得一模一樣，
           *   使用者只會以為程式壞了或資料沒匯進去。
           *   只有在「本來有、被篩掉」時才出現——本來就沒有的時候，
           *   各頁原本的空狀態說明才是對的那一句。
           */}
          {/*
           * ⚠️ 只要畫面上的尖峰數字是用「各方向各自認定」算出來的，
           *   就**一定要寫明**——這是可追溯性，不是排版。
           *
           *   兩種判定方式算出來的數字本來就不同（實測差距可以到 50 倍），
           *   而且各方向各自認定的那一組**不可以相加**：各支線的尖峰不在
           *   同一小時，加起來不對應任何一個真實小時。沒有這一行的話，
           *   使用者會把它當成同一小時的合計抄進報告。
           *
           * ⚠️ 只在真的選了那個判定方式時才出現；預設那一種不講話。
           */}
          {mainFilters.peakRule === "direction" && (
            <p className="chart-inapplicable" data-testid="peak-rule-banner">
              目前的尖峰數字是<b>各方向各自認定自己的尖峰</b>算出來的：
              每一條支線各自取自己最忙的那一小時。
              <b>各方向的值不可以相加</b>——它們不在同一小時，
              相加不對應任何一個真實的小時。
              {/*
                ⚠️ 2026-09-25：「算不出來」的兩種原因要分開講。
                  舊版把全調查時段（本來就沒有尖峰視窗可挑）也算進
                  unsupported，於是橫幅把每一個調查點都指成「沒有逐格資料、
                  請重新匯入原始檔」——原因是假的，而使用者真的會照做。
              */}
              {directionPeak.notApplicable && (
                <>
                  {" "}
                  <b>
                    目前的時段是「全調查時段」，這個判定方式不適用於它
                  </b>
                  ——全調查時段是一段累計量，不是一個尖峰小時，沒有視窗可以
                  各自挑。這個時段的各支線量仍然可以相加，合計等於路口總量。
                  要看各方向各自的尖峰，請把時段切成上午尖峰、下午尖峰
                  或全調查時段尖峰。
                </>
              )}
              {!directionPeak.notApplicable &&
                directionPeak.unsupported.length > 0 && (
                  <>
                    {" "}
                    另外有 {directionPeak.unsupported.length} 個調查點算不出來
                    （{directionPeak.unsupported.slice(0, 3).join("、")}
                    {directionPeak.unsupported.length > 3 ? "…" : ""}）：
                    這些資料沒有各支線的逐格資料，或是時間格距組不成一個整小時。
                    {/*
                      * ⚠️ 2026-09-25 第六輪：這一句原本寫「按一下『重新套用計算』」，
                      *   而**全站沒有那一顆按鈕**——實際是「車種轉向當量」頁的
                      *   「用目前的設定重算（N 筆）」與當量套用範圍那一列的
                      *   「用這一組重算」。使用者照著找會找不到。
                      */}
                    v2.1.65 之後匯入的紀錄，到「車種轉向當量」按
                    「用目前的設定重算」就會補上；更早匯入的才需要重新匯入原始檔。
                    <b>它們目前顯示的仍然是「整個調查點同一時段」的數字。</b>
                  </>
                )}
            </p>
          )}
          {currentBeforeFilter.length > 0 && current.length === 0 && (
            <p className="chart-inapplicable" data-testid="filtered-to-empty">
              目前的篩選條件在這一季沒有符合的資料（這一季原本有{" "}
              {currentBeforeFilter.length} 筆）。請放寬主工具列的「路口」或
              「資料別」，或改看其他季度。
            </p>
          )}
          {view === "projects" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">PROJECT PORTFOLIO</span>
                  <h1>建立與管理計畫</h1>
                  <p>
                    每個計畫可保有自己的季度、路口、路口幾何與匯出項目勾選，並可整包移轉到另一台電腦。
                    <b>車種轉向當量、車種目錄與報表範本目前是整台電腦共用的</b>
                    ——在任何計畫改動都會影響其他計畫，交付不同委託案前請先確認係數。
                  </p>
                </div>
              </section>
              <section className="project-layout">
                <article
                  /*
                   * ⚠️ 這張卡有**兩個**理由會被點名，不可以只認一個：
                   *   (1) 正在修改某個計畫（編輯中整張卡框起來，一眼看得出在改誰）
                   *   (2) 從側欄的小分頁「建立／修改計畫」點過來
                   *
                   *   2026-09-13 只補了側欄那一項時踩到：這裡原本寫死
                   *   `editingProjectId ? "…is-focused" : "…"`，於是點側欄
                   *   完全沒有反應——守門抓到的訊息是「畫面上完全沒有任何
                   *   區塊被點名」。同一個 class 被兩種語意共用時，
                   *   一定要把兩邊 or 起來。
                   */
                  className={
                    editingProjectId || focusedBlock === "project-form"
                      ? "panel project-form is-focused"
                      : "panel project-form"
                  }
                  id="project-form"
                >
                  {/*
                   * ⚠️ 同一張表單兼做「新增」與「修改」，抬頭與按鈕要跟著換。
                   *   兩張表單各寫一份的話，以後新增一個欄位（例如備註）
                   *   一定會有一邊忘記加——而使用者是在「修改」那邊才會發現。
                   *   編輯中時整張卡片套上 is-focused，一眼看得出現在是在改哪一件事。
                   */}
                  <h2>
                    {editingProjectId
                      ? "修改計畫：" +
                        (projects.find(function (p) {
                          return p.id === editingProjectId;
                        })?.name || "")
                      : "建立新計畫"}
                  </h2>
                  <label>
                    計畫代碼
                    <input
                      value={projectForm.code}
                      placeholder="例如 115-A01"
                      maxLength={PROJECT_CODE_LIMIT}
                      onChange={function (e) {
                        setProjectForm({
                          ...projectForm,
                          /* maxLength 擋鍵盤輸入，capText 擋貼上——兩個都要。 */
                          code: capText(
                            e.target.value,
                            projectForm.code,
                            PROJECT_CODE_LIMIT,
                          ),
                        });
                      }}
                    />
                    <small className="field-note">
                      最多 {PROJECT_CODE_LIMIT} 字（目前{" "}
                      {[...projectForm.code].length} 字）。太長會蓋到計畫名稱。
                    </small>
                  </label>
                  <label>
                    計畫名稱
                    <input
                      value={projectForm.name}
                      placeholder="必填"
                      maxLength={PROJECT_NAME_LIMIT}
                      onChange={function (e) {
                        setProjectForm({
                          ...projectForm,
                          /*
                            maxLength 擋得住鍵盤輸入，但**擋不住貼上**在
                            某些瀏覽器的行為，也擋不住輸入法組字後一次送進來，
                            所以這裡再截一次。兩道都要，少一道就會漏。
                          */
                          name: capText(
                            e.target.value,
                            projectForm.name,
                            PROJECT_NAME_LIMIT,
                          ),
                        });
                      }}
                    />
                    <small className="field-note">
                      最多 {PROJECT_NAME_LIMIT} 字，太長會在清單與側欄擠不下（目前{" "}
                      {[...projectForm.name].length} 字）
                    </small>
                  </label>
                  <label>
                    委託單位
                    <input
                      value={projectForm.client}
                      onChange={function (e) {
                        setProjectForm({
                          ...projectForm,
                          client: e.target.value,
                        });
                      }}
                    />
                  </label>
                  <label>
                    備註
                    <textarea
                      value={projectForm.note}
                      onChange={function (e) {
                        setProjectForm({
                          ...projectForm,
                          note: e.target.value,
                        });
                      }}
                    />
                  </label>
                  {editingProjectId ? (
                    <div className="project-form-actions">
                      <button className="primary" onClick={saveProjectEdit}>
                        儲存修改
                      </button>
                      <button className="secondary" onClick={cancelProjectEdit}>
                        取消
                      </button>
                    </div>
                  ) : (
                    <button className="primary" onClick={addProject}>
                      ＋ 建立計畫
                    </button>
                  )}
                  {editingProjectId ? (
                    <p className="inline-note">
                      只會改這個計畫的名稱、代碼、委託單位與備註，
                      <b>季度與路口資料完全不受影響</b>。
                    </p>
                  ) : null}
                </article>
                <article className={focusClass("project-list", "panel project-list")} id="project-list">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">PROJECTS</span>
                      <h2>現有計畫</h2>
                    </div>
                    <span className="status-dot">{projects.length} 個</span>
                  </div>
                  {projects.length ? (
                    projects.map(function (project) {
                      const count = records.filter(function (r) {
                        return r.projectId === project.id;
                      }).length;
                      return (
                        <div
                          key={project.id}
                          className={
                            project.id === activeProjectId
                              ? "project-row active"
                              : "project-row"
                          }
                        >
                          <button
                            className="project-open"
                            onClick={function () {
                              setActiveProjectId(project.id);
                              setView(count ? "dashboard" : "import");
                            }}
                          >
                            <span>{project.code}</span>
                            <div>
                              <strong>{project.name}</strong>
                              <small>
                                {project.client || "未填委託單位"} · {count}{" "}
                                筆季度路口資料
                              </small>
                            </div>
                            <b>→</b>
                          </button>
                          <button
                            className="project-edit"
                            aria-label={"修改計畫 " + project.name}
                            title="修改名稱、代碼、委託單位與備註"
                            onClick={function () {
                              startProjectEdit(project);
                            }}
                          >
                            修改
                          </button>
                          <button
                            className="project-delete"
                            aria-label={"刪除計畫 " + project.name}
                            title="刪除計畫"
                            onClick={function () {
                              deleteProject(project);
                            }}
                          >
                            刪除
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <Empty
                      title="尚未建立計畫"
                      text="正式網站從空白開始，不預載任何範例數值。"
                    />
                  )}
                </article>
              </section>
            </>
          )}

          {view === "dashboard" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">QUARTERLY OVERVIEW</span>
                  <h1>
                    {activeProject?.name || "尚未選擇計畫"} ·{" "}
                    {quarter ? showQuarter(quarter) : "尚無季度"}
                  </h1>
                  {/*
                   * ⚠️ 這一句原本寫「流量值單位隨所選時段變動（目前為 …）」。
                   *   那是**舊版留下來的**：儀表板上的「最高流量路口」與
                   *   「較上季 ○○」兩張卡 2026-09-11 已經依使用者的決定移除，
                   *   現在這一頁一個流量值都沒有，只剩「匯了幾處、有幾件事
                   *   等著處理」。留著那句話等於畫面上寫著一個不存在的東西。
                   *  （2026-09-14 逐頁實測時抓到：主工具列切時段，
                   *    這一頁一個數字都不動，而頁首卻說單位會跟著變。）
                   */}
                  <p>
                    這一頁回答「現在該不該做什麼」：本季匯了幾處、有幾件事等著處理。
                    實際的流量數字請看「各路口尖峰彙總」與「各路口駛入／駛出流量」。
                  </p>
                  {/*
                   * ⚠️ 儀表板不列任何流量值，所以主工具列的那幾個條件
                   *   在這一頁上按了不會有反應——要講出來。
                   */}
                  {unusedConditionsNote(
                    [
                      "peak",
                      "peakRule",
                      "flowView",
                      "vehicle",
                      "movement",
                      "display",
                    ],
                    "這一頁只統計「匯了幾處、有幾件事等著處理」，不列任何流量值。",
                  )}
                </div>
                <div className="head-buttons">
                  <button
                    className="secondary"
                    onClick={function () {
                      /* X-61：Excel 在「批次輸出」那一頁。 */
                      setView("batch");
                    }}
                  >
                    匯出季報
                  </button>
                  <button
                    className="primary"
                    onClick={function () {
                      setView("import");
                    }}
                  >
                    ＋ 匯入季度
                  </button>
                </div>
              </section>
              {!current.length ? (
                renderNoData("本季度尚無資料")
              ) : (
                <>
                  {/*
                   * ⚠️ 這裡一度加過一個「統計範圍」選擇器（AM／PM／全調查時段
                   *   尖峰／全調查時段），因為當時的四張卡片跟著統計範圍走、
                   *   而這一頁沒有地方可以改它。
                   *
                   *   2026-09-11 稍後把「最高流量路口」與「較上季」兩張卡移除
                   *   之後，剩下的兩張（本季調查路口、待確認品質項目）
                   *   **與統計範圍無關**，這個選擇器就沒有作用了，一併拿掉。
                   *   留著一個按了什麼都不會變的控制項，比沒有更糟。
                   */}
                  <section className="kpi-grid">
                    <Kpi
                      label="本季調查路口"
                      value={String(current.length) + " 處"}
                      note={
                        String(
                          new Set(
                            current.map(function (r) {
                              return r.date;
                            }),
                          ).size,
                        ) + " 個調查日"
                      }
                    />
                    {/*
                     * ⚠️ 這裡原本還有兩張卡：「最高流量路口」與「較上季 ○○」，
                     *   2026-09-11 依使用者決定移除。
                     *
                     * (1) 「最高流量路口」——他 2026-09-09 已經為了同一個理由
                     *    砍掉「路口尖峰小時排名」與「路段排名」：
                     *   「知道該路段流量最高，好像不能代表什麼，畢竟每個計畫
                     *     規定在哪些路段做，是環境評估階段時就決定了」。
                     *    這張卡是同一個資訊的縮小版，當時漏掉了。
                     *
                     * (2) 「較上季 ○○」——他的話：「我是業主，我知道所有路段
                     *    交通總量要做什麼？知道了也不能幹嘛」。而且同一季的
                     *    比較本來就要看統計範圍、日別、方向，一張卡講不完；
                     *    真正要看結論的地方是「各路口尖峰彙總」。
                     *
                     * ⚠️ 剩下兩張的共同點是它們都回答「**我現在該不該做什麼**」
                     *   （匯了多少、有幾件事等著處理），那才是儀表板該做的事。
                     *   下面那張「本季檢核摘要」也是同一個性質，所以留著。
                     */}
                    {/*
                     * ⚠️ 這裡原本還有一張「待確認品質項目 N 項」，2026-09-11 移除。
                     *
                     *   使用者問：「本季檢核摘要和待確認品質項目 N 項，
                     *   內容性質是否重複了呢？」——去程式裡對過，**是重複的**：
                     *   那個 N 就是 currentIssues.length，而底下「本季檢核摘要」
                     *   的三行全部由同一個 N 算出來
                     *  （待人工確認＝warning、需處理錯誤＝error、品質分數＝100-N×4）。
                     *
                     *   留摘要、拿掉卡片的理由：**「5 項」不告訴你該不該緊張，
                     *  「需處理錯誤 0、待人工確認 5」才告訴你**。
                     *   同一份資訊，摘要那一塊嚴格比較多。
                     */}
                  </section>
                  <section className="dashboard-grid">
                    {/*
                      * 「路口尖峰小時排名」已移除（2026-09-09 使用者授權）。
                      *
                      * 他的判斷：「知道該路段流量最高，好像不能代表什麼，
                      * 畢竟每個計畫規定在哪些路段做，是環境評估階段時就決定了，
                      * 將這些路段比拚出誰第一，似乎沒有實際用處」——這與他先前
                      * 移除「路段排名」的理由一致。
                      *
                      * 同一批數字要查的話，「各路口尖峰彙總」那一頁有完整的表
                      *（依站號排，不排名次）。
                      */}
                    <article className="panel action-panel">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">QUALITY</span>
                          <h2>本季檢核摘要</h2>
                        </div>
                      </div>
                      <div className="quality-donut">
                        <div
                          style={
                            {
                              "--score":
                                Math.max(45, 100 - openIssues.length * 4) + "%",
                            } as React.CSSProperties
                          }
                        >
                          <strong>
                            {Math.max(45, 100 - openIssues.length * 4)}
                          </strong>
                          <small>品質分數</small>
                        </div>
                        <ul>
                          <li>
                            <span className="good" />
                            格式與欄位 <b>即時</b>
                          </li>
                          <li>
                            <span className="warn" />
                            待人工確認{" "}
                            <b>
                              {
                                openIssues.filter(function (i) {
                                  return i.severity === "warning";
                                }).length
                              }
                            </b>
                          </li>
                          <li>
                            <span className="bad" />
                            需處理錯誤{" "}
                            <b>
                              {
                                openIssues.filter(function (i) {
                                  return i.severity === "error";
                                }).length
                              }
                            </b>
                          </li>
                          {/*
                           * 已確認的不計入上面三行，但**不可以完全不提**：
                           * 使用者要看得出「不是消失了，是我按過確認」。
                           */}
                          {ackedCount > 0 && (
                            <li>
                              <span className="good" />
                              已人工確認 <b>{ackedCount}</b>
                            </li>
                          )}
                        </ul>
                      </div>
                    </article>
                  </section>
                </>
              )}
            </>
          )}

          {view === "import" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">BATCH IMPORT</span>
                  <h1>季度批次匯入與刪除</h1>
                  <p>
                    先指定調查年度與季度，再選取檔案；同計畫＋同季度＋同站號採覆蓋。
                  </p>
                </div>
              </section>
              <section className="panel import-period">
                <div>
                  <span className="step-no">01</span>
                  <div>
                    <strong>先指定這批資料的調查年度與季度</strong>
                    <p>此設定會套用到本次選取的全部路口，寫入前仍可更改。</p>
                  </div>
                </div>
                <label>
                  調查年度（民國或西元）
                  <input
                    type="number"
                    min="1"
                    max="9999"
                    placeholder="例如 115 或 2026"
                    value={importYear}
                    onChange={function (e) {
                      /*
                       * 民國與西元都收。舊版 max="999" 加上 slice(0, 3)，
                       * 打 2026 會被截成 202，而且不會有任何提示——
                       * 使用者拿到西元年標示的委託案時只能自己換算。
                       * 全日交通量的季度輸入框一直是兩種都收的。
                       */
                      setImportYear(
                        e.target.value.replace(/\D/g, "").slice(0, 4),
                      );
                    }}
                  />
                  {/*
                    寫入的季度一律是民國年寫法，打西元時當場說明會存成什麼，
                    否則使用者會以為畫面上會看到 2026Q2、找不到就重打一次，
                    同一季被匯入兩遍。
                  */}
                  {importPeriodCheck && !importPeriodCheck.ok ? (
                    <small className="from-content warning-text">
                      {surveyPeriodInputMessage(importPeriodCheck.reason)}
                    </small>
                  ) : importPeriodKey && importPeriodKey !== importPeriod ? (
                    <small className="from-content" data-period-storage-key="true">
                      將存成「{importPeriodKey}」（資料一律以民國年記錄）
                    </small>
                  ) : null}
                </label>
                <label>
                  季度
                  <select
                    value={importQuarterNo}
                    onChange={function (e) {
                      setImportQuarterNo(e.target.value);
                    }}
                  >
                    <option value="">請選擇</option>
                    <option value="1">第 1 季</option>
                    <option value="2">第 2 季</option>
                    <option value="3">第 3 季</option>
                    <option value="4">第 4 季</option>
                  </select>
                </label>
                {/*
                 * ⚠️ 這幾處顯示的是「這批資料會被**存進**哪一個季別鍵」，
                 *   不是給人讀的期別文字——所以**刻意不跟著「期別顯示／年份顯示」走**，
                 *   而且旁邊那句話自己就寫著「資料一律以民國年記錄」。
                 *   跟著切換走的話，畫面會說「將存成 115年1月」，
                 *   但實際存進去的鍵是 115Q1，反而變成另一種說謊。
                 *
                 * ⚠️ data-period-storage-key 是**明講出來的豁免**，不是萬用貼紙：
                 *   守門（e2e-period-display-everywhere）會跳過帶這個標記的元素，
                 *   同時限制它的總數，避免有人為了讓守門變綠到處亂貼。
                 */}
                <output data-period-storage-key="true">
                  {importPeriod
                    ? importYear +
                      " 年第 " +
                      importQuarterNo +
                      " 季（" +
                      importPeriodKey +
                      "）"
                    : "尚未完成設定"}
                </output>
              </section>
              {/*
               * 「調查檔格式範本」面板（三張範本卡片 ＋「已記住的實際調查版型」）
               * 在 v2.1.54 整個移除。
               *
               * 使用者的原話：「程式本身有記憶調查版型的格式就可以了，使用者不需要
               * 知道程式記憶了哪些」「不用特地為了解釋『全日路段車種表會匯入成功，
               * 但不建立路口轉向成果』而用三張卡片佔版面」。
               *
               * 而且那個折疊面板本來就有誤導：formatMemories 是**只寫不讀**的，
               * 沒有任何地方拿它去影響解析——每次匯入都是重新讀表頭判斷格式
               * （templateId 由工作表內容當場推定，見 lib/traffic.ts 的
               * inspectWorkbook）。所以「刪除格式記憶」那顆按鈕會讓人以為
               * 按了能改變辨識結果，實際上不會。
               *
               * formatMemories 的**資料本身刻意保留**（照樣累積、照樣進備份），
               * 只是不再顯示；備份格式因此完全不變，舊備份還原不受影響。
               */}
              <section className="import-layout">
                <article
                  className={focusClass(
                    "import-upload",
                    `panel upload-card${dragZone === "import" ? " drag-active" : ""}`,
                  )}
                  id="import-upload"
                  data-dropzone="import"
                  onDragEnter={function (e) {
                    e.preventDefault();
                    dragDepth(e.currentTarget, 1);
                    setDragZone("import");
                  }}
                  onDragOver={function (e) {
                    /*
                     * dragover 一定要 preventDefault，否則瀏覽器根本不會把
                     * drop 事件送過來——這是 HTML5 拖放最容易漏掉的一步。
                     */
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
                  }}
                  onDragLeave={function (e) {
                    e.preventDefault();
                    if (dragDepth(e.currentTarget, -1) === 0) setDragZone("");
                  }}
                  onDrop={function (e) {
                    e.preventDefault();
                    e.currentTarget.dataset.dragDepth = "0";
                    setDragZone("");
                    if (e.dataTransfer?.files?.length)
                      handleFiles(e.dataTransfer.files);
                  }}
                >
                  <span className="upload-icon">↑</span>
                  <h2>把 Excel 檔案拖曳到這裡</h2>
                  <p>
                    支援 .xls、.xlsx、.xlsm，多路口一次選取；照片工作表忽略。
                  </p>
                  <input
                    ref={fileRef}
                    hidden
                    type="file"
                    multiple
                    accept=".xls,.xlsx,.xlsm"
                    onChange={function (e) {
                      setPickingFiles(false);
                      handleFiles(e.target.files);
                    }}
                  />
                  <button
                    className="primary"
                    disabled={!importPeriodReady || importing}
                    onClick={function () {
                      setPickingFiles(true);
                      fileRef.current?.click();
                    }}
                  >
                    {importing
                      ? importProgress
                        ? `正在解析… ${Math.min(importProgress.done + 1, importProgress.total)}／${importProgress.total}`
                        : "正在解析…"
                      : importPeriod
                        ? "選擇檔案"
                        : "請先選年度與季度"}
                  </button>
                  {/*
                    按下去到 change 之間完全是瀏覽器在讀檔，程式插不進去，
                    提示只能從按下去那一刻開始顯示；取消時由 focus 那條退路收掉。
                  */}
                  {pickingFiles && !importing ? (
                    <p className="picking-files-hint" role="status">
                      正在讀取您選擇的檔案，請稍候…
                    </p>
                  ) : null}
                  {/*
                   * 判讀中的進度。使用者回報過「上傳大量檔案後以為沒成功」，
                   * 原因是舊版只有按鈕文字換成「正在解析…」，一動也不動。
                   * 這一行會逐檔跳動，並寫出正在讀哪一個檔名。
                   */}
                  {importing && importProgress ? (
                    <p className="import-progress" role="status">
                      正在讀取第 {Math.min(importProgress.done + 1, importProgress.total)}／
                      {importProgress.total} 份：
                      <b>{importProgress.file}</b>
                    </p>
                  ) : null}
                  <small data-period-storage-key="true">
                    {importPeriod
                      ? "本批次將寫入 " + importPeriodKey
                      : "年度與季度為必填"}
                  </small>
                </article>
                {/*
                 * 檔名規則說明。
                 *
                 * 系統確實會用檔名判斷兩件事，這本身沒有問題；有問題的是規則
                 * 只存在於程式碼裡。使用者撞到「按了確認寫入卻什麼都沒進去」
                 * 的時候，必須自己猜到問題出在檔名——所以規則要寫在上傳前
                 * 就看得到的地方，而不是只寫在手冊裡。
                 */}
                {/*
                  * 右欄：兩張說明卡片上下疊。
                  *
                  * ⚠️ 原本三張卡片是 .import-layout（兩欄 grid）的直接子元素，
                  * 於是排成「上傳區｜檔名規則」「尖峰小時計算｜（空）」——
                  * 右下角空一大塊。使用者實測回報的第 3 項就是這個。
                  * 包成一欄之後，grid 只有兩個子元素，右欄由兩張卡片填滿。
                  */}
                <div className="import-side">
                <article className={focusClass("import-filename-rules", "panel import-rules filename-rules")} id="import-filename-rules" data-nav-skip="explanation">
                  <span className="eyebrow">FILE NAMING</span>
                  <h2>檔名會決定什麼？</h2>
                  <p>
                    系統<b>優先讀取檔案內容</b>
                    ：站號讀「站號：」欄位、路口名稱讀「站名：」或「地點：」欄位。
                    這兩個欄位齊全時，檔名叫什麼都不影響匯入結果。
                    以下規則只在<b>檔案內讀不到</b>時才會用到。
                  </p>
                  <ol>
                    <li>
                      <b>純代號檔名不會被匯入</b>
                      <span>
                        整個檔名剛好是「T＋數字」而沒有其他文字時（
                        <code>T1402.xls</code>、<code>T14-02.xls</code>
                        ），會被視為承辦附的參考計算檔，只用於對帳、不寫入資料。
                        <b>
                          若這是原始調查資料，請在檔名加上路口名稱
                        </b>
                        {/*
                          ⚠️ 範例一律用**不具名**的假路口與假案號。
                            這一支會發布到 GitHub Pages（公開網頁），
                            說明文字裡的真實案號與路口名等於一併公開。
                            使用者 2026-09-10 指示：「就直接變成匿名化吧」。
                            ⚠️ 這條規則只適用於**說明文字**；
                              referenceMovementForOd() 依賴真實路口名判斷，
                              那一段**不可以**匿名化。
                        */}
                        （<code>T0102_示範一路與示範二路口.xls</code>）即可正常匯入。
                      </span>
                    </li>
                    <li>
                      <b>檔名如何推定站號</b>
                      <span>
                        有分隔符時照切：<code>T15-04</code> → T15-04。
                        沒有分隔符時<b>以最後兩碼為子編號</b>：
                        <code>06525T2503</code> → T25-03、<code>T501</code> →
                        T5-01。這條規則最不直覺，請於預覽核對。
                      </span>
                    </li>
                    <li>
                      <b>兩邊都讀不到站號時不會亂猜</b>
                      <span>
                        系統會在預覽標示「站號未判定」並請您直接填寫，
                        不會自動產生代號頂替。
                      </span>
                    </li>
                  </ol>
                  <p className="source-note">
                    建議命名：
                    <code>&lt;案號&gt;T&lt;站號&gt;_&lt;路口名稱&gt;.xlsx</code>
                    ，例如
                    <code>11500T01-02_示範一路與示範二路口.xlsx</code>。
                  </p>
                </article>
                <article className={focusClass("import-peak-rule", "panel import-rules")} id="import-peak-rule" data-nav-skip="explanation">
                  <span className="eyebrow">CALCULATION RULE</span>
                  <h2>尖峰小時計算</h2>
                  <ol>
                    <li>
                      <b>15 分鐘資料</b>
                      <span>連續 4 區間組成 60 分鐘。</span>
                    </li>
                    <li>
                      <b>AM／PM 分開搜尋</b>
                      <span>同值取較早時段。</span>
                    </li>
                    <li>
                      <b>參考檔只做驗證</b>
                      <span>不盲目照抄計算檔。</span>
                    </li>
                    <li>
                      <b>欄位映射可調整</b>
                      <span>匯入後需確認道路支線與左直右欄位。</span>
                    </li>
                  </ol>
                </article>
                </div>
              </section>
              {/*
                * ⚠️ className 一定要走 focusClass()：側欄點這一項時，
                *   這一塊要**被框起來**。2026-09-12 實測抓到它（和
                *   alias-list）只捲過去、沒有點名——使用者按了側欄卻看不出
                *   跳到哪裡，和「按鈕壞了」分不出來。
                *   守門：scripts/e2e-nav-layout.mjs（它找的就是 .is-focused）。
                */}
              <section
                className={focusClass("import-preview-panel", "panel")}
                id="import-preview-panel"
              >
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">IMPORT PREVIEW</span>
                    <h2>匯入辨識結果</h2>
                    {/*
                      * ⚠️ 兩種情況要講**不同的話**，因為後果完全不同：
                      *
                      *   混批 → 無論寫進哪一季都有一批是錯的，只能重來（紅底、擋死）
                      *   整批改了季別 → 資料會正確地進到目前選的那一季，
                      *                  只是要確認一下是不是故意的（黃底、放行）
                      *
                      *   兩種都用同一段紅字的話，使用者遇到後者會以為自己做錯了，
                      *   只好取消重選——那正是 2026-09-11 實測遇到的狀況。
                      */}
                    {importPeriodMixed && (
                      <p className="preview-period-alert">
                        ⚠️ 預覽裡<b>混了不同季別的批次</b>（
                        {importParsedPeriods.map(quarterLabel).join("、")}
                        ），而寫入是<b>整批寫進目前選的 {quarterLabel(importPeriodKey)}</b>。
                        無論寫進哪一季，都一定有一批會被寫到錯的季別，
                        而且事後看不出來。請按「取消預覽」重來，或分批寫入。
                      </p>
                    )}
                    {/*
                      * ⚠️ 預覽開著的期間路口名稱被改過 → 「名稱處理」欄可能過期。
                      *   只提示、不自動重算：自動重算會蓋掉使用者自己挑的選擇。
                      */}
                    {importNamesChanged && (
                      <p className="preview-period-shift">
                        路口名稱在這批預覽產生<b>之後</b>有變動。
                        下方「名稱處理」欄還是<b>選檔當下</b>比對的結果，
                        可能已經不是你要的了——例如改完名字之後本來該併入的路口，
                        這裡仍然寫「建立新路口」，直接寫入就會多一個重複的路口。
                        <br />
                        <button
                          className="link-button"
                          onClick={function () {
                            const next = matchRowsToIntersections(importRows);
                            setImportResolutions(function (previous) {
                              return { ...previous, ...next };
                            });
                            setImportNameSnapshot(intersectionNameSignature());
                            notify(
                              `已用目前的路口名稱重新比對這 ${importRows.length} 個檔案，請確認「名稱處理」欄。`,
                            );
                          }}
                        >
                          用目前的名稱重新比對（{importRows.length} 個檔案）
                        </button>
                      </p>
                    )}
                    {importPeriodShifted && (
                      <p className="preview-period-shift">
                        這批 <b>{importRows.length}</b> 個檔案原本是在
                        「<b>{quarterLabel(importParsedPeriods[0])}</b>」之下預覽的，
                        寫入時會整批寫進你目前選的
                        「<b>{quarterLabel(importPeriodKey)}</b>」。
                        <br />
                        如果你是選完檔才發現季別選錯、剛改好，那就是對的，
                        直接按「確認寫入」即可（按下去會再問一次）。
                      </p>
                    )}
                    {importNeedsCheck > 0 && (
                      <p className="preview-check-hint">
                        有 <b>{importNeedsCheck}</b>{" "}
                        個檔案需要您先確認（站號未判定、版面認不得，或不會被寫入的參考檔）。
                        表格裡標成黃底的就是。逐項看過之後，
                        <b>捲到表格最下方</b>按「確認寫入」。
                        {/*
                          ★ 「跳到第一筆有異常的資料」做成**按鈕**，不做成自動捲動。
                            使用者第 2 點真正想要的是「快速找到第一筆異常」，
                            而按鈕按下去才動，不會和版面高度、匯入筆數互相影響，
                            也不會誤判——自動捲動就是栽在這兩件事上。
                        */}
                        {importHasIssue > 0 && (
                        <button
                          type="button"
                          className="link-button"
                          data-goto-first-issue
                          onClick={function () {
                            const first =
                              document.querySelector("[data-has-issue]");
                            if (!first)
                              return notify(
                                "這一批沒有需要處理的異常，只有需要看一眼的欄位。",
                              );
                            first.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            });
                          }}
                        >
                          跳到第一筆有異常的資料（{importHasIssue} 筆）
                        </button>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                {importVehicleDefinitions.length > 0 && (
                  <div className="vehicle-mapping-panel">
                    <div>
                      <strong>
                        本批次辨識到 {importVehicleDefinitions.length}{" "}
                        個原始車種
                        {importNewVehicleCount > 0 && (
                          /*
                           * ⚠️ 「有幾個是新的」要寫在**標題上**。
                           *   只把新車種那一列標色還不夠——使用者看到
                           *   「辨識到 4 個原始車種」就直接往下按確認了，
                           *   根本沒有逐列看。標題是他一定會讀到的地方。
                           */
                          <em className="vehicle-new-count">
                            ，其中 {importNewVehicleCount} 個是系統沒有的新車種
                          </em>
                        )}
                      </strong>
                      <small>
                        {importNewVehicleCount > 0
                          ? "⚠️ 標成黃底的是新車種，預設「獨立分析」。請確認要獨立分析還是併入四個標準類別——併入之後會改用目標類別的當量換算，寫入後就不能在這裡改了。"
                          : "預設各自獨立分析；也可在寫入前併入四個標準類別。合併後以目標類別當量換算。"}
                      </small>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>原始車種</th>
                            <th>分析方式／歸類</th>
                            <th>左轉當量</th>
                            <th>直行當量</th>
                            <th>右轉當量</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importVehicleDefinitions.map(function (definition) {
                            const target =
                              vehicleMappings[definition.id] || definition.id;
                            const factors = pce[target] || {
                              left: 1,
                              through: 1,
                              right: 1,
                            };
                            return (
                              <tr
                                key={definition.id}
                                /*
                                 * ⚠️ 整列標色，不是只有那個小字。
                                 *
                                 * 使用者 2026-09-11 實測漏看：畫面寫「辨識到 4 個
                                 * 原始車種」，他以為就是系統內建的四大類，
                                 * 沒注意到第四個是「聯結車」而不是「特種車」——
                                 * 因為「新增車種」是灰色小字，和「標準車種」
                                 * 長得幾乎一樣。他是看到當量係數是 1 才發現的。
                                 *
                                 * 新車種是**需要他做決定**的東西（獨立分析還是
                                 * 併入哪一類），決定錯了整季的 PCU 都會不對，
                                 * 所以要讓它在一排標準車種裡跳出來。
                                 */
                                className={
                                  definition.core ? undefined : "vehicle-row-new"
                                }
                              >
                                <td>
                                  <strong>{definition.label}</strong>
                                  {definition.core ? (
                                    <small>標準車種</small>
                                  ) : (
                                    <span className="vehicle-badge-new">
                                      新增車種・請確認歸類
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <select
                                    value={target}
                                    onChange={function (event) {
                                      const nextTarget = event.target.value;
                                      setVehicleMappings({
                                        ...vehicleMappings,
                                        [definition.id]: nextTarget,
                                      });
                                      if (!pce[nextTarget])
                                        setPce({
                                          ...pce,
                                          [nextTarget]: {
                                            left: 1,
                                            through: 1,
                                            right: 1,
                                          },
                                        });
                                    }}
                                  >
                                    <option value={definition.id}>
                                      獨立分析：{definition.label}
                                    </option>
                                    {ANALYSIS_VEHICLES.filter(function (id) {
                                      return id !== definition.id;
                                    }).map(function (id) {
                                      return (
                                        <option key={id} value={id}>
                                          併入：{VEHICLE_LABELS[id]}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </td>
                                {(["left", "through", "right"] as const).map(
                                  function (movement) {
                                    return (
                                      <td key={movement}>
                                        {/* ⚠️ 受控數字框一律走 NumberField，理由見 lib/number-field.tsx。 */}
                                        <NumberField
                                          min={0}
                                          step={0.1}
                                          value={factors[movement]}
                                          onCommit={function (next) {
                                            setPce({
                                              ...pce,
                                              [target]: {
                                                ...factors,
                                                [movement]: next,
                                              },
                                            });
                                          }}
                                        />
                                      </td>
                                    );
                                  },
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {importRows.some(function (row) {
                      return (
                        row.layout === "unknown" &&
                        row.detectedVehicles.length > 0
                      );
                    }) && (
                      <p className="source-note">
                        已讀到車種但未找到轉向／OD
                        欄位的檔案，只能確認車種結構，不會在本路口轉向系統中誤建轉向資料。
                      </p>
                    )}
                  </div>
                )}
                {importRows.length > 0 &&
                  (importDateMismatches.length > 0 ||
                    importDateUnknowns.length > 0) && (
                    <div
                      className={
                        importDateMismatches.length
                          ? "period-date-alert period-date-alert-bad"
                          : "period-date-alert"
                      }
                      data-testid="period-date-alert"
                    >
                      {importDateMismatches.length > 0 && (
                        <>
                          <strong>
                            ⚠️ 有 {importDateMismatches.length}{" "}
                            份檔案的調查日期與你選的「{importPeriod}」不一致
                          </strong>
                          <ul>
                            {importDateMismatches.map(function (item) {
                              return (
                                <li key={item.file}>
                                  <b>{item.file}</b>：檔案裡是 {item.date}（屬{" "}
                                  {item.dateLabel}），你選的是{" "}
                                  {item.periodLabel}。
                                  <small>
                                    來源 {item.source}「{item.raw}」
                                  </small>
                                </li>
                              );
                            })}
                          </ul>
                          <small>
                            按「確認寫入」時會再問一次；確認無誤才會
                            <b>以你選的期別</b>寫入——系統<b>不會</b>自己改成
                            檔案日期所屬的那一季。
                          </small>
                          {/*
                            * ── 一鍵改成檔案日期的季別 ──────────────────
                            *
                            * 使用者 2026-09-11 實測後問：「系統會問我是否要幫我
                            * 寫入 114Q3 裡嗎？」——**不會**，寫入的一律是他選的
                            * 那一季。但他真正要的就是改成 114Q3，卻得自己捲回
                            * 上方的下拉去改。
                            *
                            * ⚠️ 只有「所有不一致的檔案都指向**同一季**」時才出現。
                            *   指向好幾季的話，一顆按鈕沒辦法表達要改成哪一個，
                            *   硬給一個預設值只會讓人按下去才發現改錯了。
                            */}
                          {importDateSuggestedPeriod && (
                            <button
                              className="link-button"
                              onClick={function () {
                                /*
                                 * ⚠️ 季別是由「年」與「季」兩個欄位組出來的，
                                 *   兩個都要設。只設其中一個的話畫面會停在
                                 *   半套的狀態，而且看起來像沒反應。
                                 */
                                const match =
                                  /^(\d+)Q([1-4])$/.exec(
                                    importDateSuggestedPeriod,
                                  );
                                if (!match)
                                  return notify(
                                    "讀不出檔案日期所屬的季別，請自行在上方選擇。",
                                  );
                                setImportYear(match[1]);
                                setImportQuarterNo(match[2]);
                                notify(
                                  `季別已改成 ${importDateSuggestedPeriod}。按「確認寫入」時會再問一次，確認後這批資料就會寫進 ${importDateSuggestedPeriod}。`,
                                );
                              }}
                            >
                              改用檔案日期的季別（{importDateSuggestedPeriod}）
                            </button>
                          )}
                        </>
                      )}
                      {importDateUnknowns.length > 0 && (
                        <p className="source-note">
                          {periodUnknownNotice(importDateUnknowns)}
                        </p>
                      )}
                    </div>
                  )}
                {!importRows.length ? (
                  <Empty
                    title="尚未選取檔案"
                    text="預覽階段不會更動正式資料。支援 .xls、.xlsx、.xlsm。"
                  />
                ) : (
                  /*
                    ★ 沒有任何需要確認的事情時，明細**預設收合**（2026-09-10 使用者指定）。

                    使用者的原話：「如果匯入沒有任何異常的話，異常清單也能直接
                    變成收合，顯示一個『無任何異常事項』的提醒，使用者就知道
                    可以安心按確認匯入。」

                    ⚠️ 收合的是**明細**，不是把資訊藏起來：摘要那一行仍然寫出
                       檔案數與結論，而且一按就展開。
                    ⚠️ `open` 用的是 needsCheck（要看一眼）而不是 hasIssue（有異常）：
                       站號沒判定出來雖然不算異常，卻是使用者**一定要動手補**的，
                       收起來會讓他以為沒事。寧可多展開一次，不要少展開一次。
                    ⚠️ 收合狀態**不記到下一次匯入**——每一批都重新依這一批的內容判斷。
                       上一批乾淨不代表這一批乾淨。React 的 key 帶上筆數與待確認數，
                       內容一變就重新掛載、回到該有的預設狀態。
                  */
                  <details
                    className="preview-details"
                    key={`preview-${importRows.length}-${importNeedsCheck}`}
                    open={importNeedsCheck > 0}
                  >
                    <summary>
                      {importNeedsCheck > 0 ? (
                        <>
                          <b>{importRows.length}</b> 個檔案，其中{" "}
                          <b>{importNeedsCheck}</b> 個需要您確認
                          {importHasIssue > 0 ? (
                            <>（含 <b>{importHasIssue}</b> 個不會被寫入或認不得版面）</>
                          ) : null}
                          。展開逐檔明細
                        </>
                      ) : (
                        <>
                          <span className="preview-clean">○ 本批次未發現異常事項</span>
                          ：<b>{importRows.length}</b> 個檔案都辨識正常，
                          可以直接按下方的「確認寫入」。需要核對時點此展開逐檔明細。
                        </>
                      )}
                    </summary>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>檔案</th>
                          <th>角色</th>
                          <th>版本／差異處理</th>
                          <th>站號／名稱</th>
                          <th>名稱處理</th>
                          {PEAK_KEYS.map(function (key) {
                            return (
                              <th key={key}>
                                {SCOPE_SHORT_LABELS[key]}（PCU/hr）
                              </th>
                            );
                          })}
                          <th>檢查</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {importRows.map(function (row) {
                          const liveRow = configuredImportPreview(
                            row,
                            pce,
                            vehicleMappings,
                          );
                          const resolution = importResolutions[row.file] || {
                            action: "auto-new",
                          };
                          /*
                           * 這裡的比對鍵必須與 targetId 的產生方式一致
                           *（recordIntersectionKey）。舊版這裡用
                           * intersectionId || canonical(name)，而 targetId 用
                           * recordIntersectionKey——只要紀錄有 intersectionId
                           *（匯入的紀錄都有）兩者就不同，於是：下拉選單顯示
                           *「建立新路口」卻其實會併入；使用者手動選「併入」時
                           * 又找不到目標而完全沒有作用。兩個方向都是壞的。
                           */
                          const matched = canonicalRecords.find(
                            function (record) {
                              return (
                                recordIntersectionKey(record) ===
                                resolution.targetId
                              );
                            },
                          );
                          const existingImport = records.find(
                            function (record) {
                              return (
                                record.projectId === activeProjectId &&
                                record.quarter === importPeriodKey &&
                                record.station === row.station &&
                                (record.surveyType || "待設定") ===
                                  (row.surveyType || "待設定")
                              );
                            },
                          );
                          /*
                            這一列需不需要使用者親自看一眼？
                            只列**會影響寫入結果**的三種，不要把一般提醒也算進來，
                            否則每次匯入都會被捲到某一列，反而變成干擾。
                          */
                          /*
                            ⚠️ 這兩個旗標**必須分開**（2026-09-10 定案）。
                            舊版一個 needsCheck 混著用，正是「沒有異常卻跳到
                            異常確認表」的根本原因：它涵蓋的範圍比「異常」寬。

                            hasIssue  ＝ 這一列**真的有問題**：版面認不得、
                                         不會被寫入、或解析時留下警告。
                            needsCheck＝ hasIssue，再加上「要人看一眼但仍會
                                         正常寫入」的情形（站號沒判定出來）。

                            黃底沿用 needsCheck（範圍不變，畫面不會突然少標）；
                            「跳到第一筆有異常的資料」找的是 hasIssue。
                          */
                          const hasIssue = importRowHasIssue(row);
                          const needsCheck = importRowNeedsCheck(row);
                          return (
                            <tr
                              key={row.file}
                              data-needs-check={needsCheck ? "1" : undefined}
                              data-has-issue={hasIssue ? "1" : undefined}
                              className={needsCheck ? "needs-check" : undefined}
                            >
                              <td>{row.file}</td>
                              <td>
                                <span
                                  className={
                                    "tag " +
                                    (row.role === "無法辨識"
                                      ? "red"
                                      : /*
                                         * 參考計算檔原本是藍色。藍色在這個介面
                                         * 代表中性資訊，使用者不會意識到那其實
                                         * 是「這個檔不會被寫入」，於是按下確認
                                         * 之後才發現什麼都沒進去。會導致資料
                                         * 不被寫入的狀態一律用警示色。
                                         */
                                        row.role === "參考計算檔" ||
                                          row.role === "非路口轉向"
                                        ? "amber"
                                        : "green")
                                  }
                                  title={row.roleReason || undefined}
                                >
                                  {row.role}
                                </span>
                                {row.roleReason && (
                                  <small className="role-reason">
                                    {row.roleReason}
                                  </small>
                                )}
                                {row.blockReason && (
                                  <small
                                    className="role-reason"
                                    data-testid="import-block-reason"
                                  >
                                    {row.blockReason}
                                  </small>
                                )}
                              </td>
                              <td>
                                {existingImport ? (
                                  <div className="import-conflict">
                                    <b>
                                      已存在第 {existingImport.revision || 1} 版
                                    </b>
                                    {PEAK_KEYS.map(function (key) {
                                      const window = liveRow.peakWindows?.[key];
                                      const before = recordTotal(
                                        existingImport,
                                        key,
                                      );
                                      /* 兩邊都沒有值的時段不必列出來占版面
                                         （例如不足 24 小時的檔，全日尖峰） */
                                      if (!before && !window) return null;
                                      return (
                                        <small key={key}>
                                          {SCOPE_SHORT_LABELS[key]}：
                                          {before.toLocaleString()} →{" "}
                                          {window
                                            ? Math.round(
                                                window.total,
                                              ).toLocaleString()
                                            : "—"}{" "}
                                          PCU/hr
                                        </small>
                                      );
                                    })}
                                    <select
                                      value={
                                        importConflictModes[row.file] ||
                                        "version"
                                      }
                                      onChange={function (event) {
                                        setImportConflictModes({
                                          ...importConflictModes,
                                          [row.file]: event.target
                                            .value as ImportConflictMode,
                                        });
                                      }}
                                    >
                                      {/* 兩個選項實際行為相同（都覆蓋、都留還原點），
                                          差別只在還原點的說明文字。舊版寫成
                                         「保留舊版並建立新版」，聽起來像舊資料會
                                          留著，但並不會——那是會讓人做錯決定的敘述。 */}
                                      <option value="version">
                                        覆蓋，還原點註記「改版」
                                      </option>
                                      <option value="overwrite">
                                        覆蓋，還原點註記「重新匯入」
                                      </option>
                                      <option value="skip">略過此檔</option>
                                    </select>
                                  </div>
                                ) : (
                                  <span className="tag blue">第 1 版</span>
                                )}
                              </td>
                              <td>
                                {/*
                                 * 站號優先讀檔案內的「站號：」欄位，讀不到才
                                 * 從檔名推。來源不同，可信度差很多，所以要讓
                                 * 使用者一眼看出這個站號需不需要核對。
                                 */}
                                {row.station || (
                                  <b className="station-missing">站號未判定</b>
                                )}
                                <small>{row.name}</small>
                                <small
                                  className={
                                    row.stationSource === "workbook"
                                      ? "station-source"
                                      : "station-source warn"
                                  }
                                >
                                  {row.stationSource === "workbook"
                                    ? "站號讀自檔案內的「站號：」欄位"
                                    : row.stationSource === "filename"
                                      ? "⚠️ 檔案內沒有站號欄位，此站號由檔名推定，請確認無誤"
                                      : "⚠️ 檔案與檔名都讀不到站號；請於下方填寫，或將檔名改為含 T<站號> 的格式"}
                                </small>
                                {row.stationSource === "none" && (
                                  <input
                                    className="station-input"
                                    placeholder="例如 T14-02"
                                    value={stationOverrides[row.file] || ""}
                                    onChange={function (event) {
                                      setStationOverrides({
                                        ...stationOverrides,
                                        [row.file]: event.target.value,
                                      });
                                    }}
                                  />
                                )}
                                <small>
                                  {row.date
                                    ? "調查日 " +
                                      row.date +
                                      (row.dateSource
                                        ? " · " +
                                          row.dateSource.sheet +
                                          "!" +
                                          row.dateSource.cell
                                        : "")
                                    : "日期辨識未成功（已掃描標題區）"}
                                </small>
                                <small>
                                  格式範本：
                                  {row.templateName || "一般語意轉向表"} ·{" "}
                                  {row.surveyType}
                                </small>
                              </td>
                              <td>
                                {resolution.action === "auto" ? (
                                  <span className="tag green">
                                    自動併入 · {matched?.name}
                                  </span>
                                ) : resolution.action === "auto-new" ? (
                                  <span className="tag blue">
                                    自動建立新路口
                                  </span>
                                ) : (
                                  <select
                                    value={
                                      resolution.action === "merge"
                                        ? "merge:" + (resolution.targetId || "")
                                        : resolution.action
                                    }
                                    onChange={function (e) {
                                      const value = e.target.value;
                                      setImportResolutions({
                                        ...importResolutions,
                                        [row.file]: value.startsWith("merge:")
                                          ? {
                                              action: "merge",
                                              targetId: value.slice(6),
                                            }
                                          : { action: value as "new" | "skip" },
                                      });
                                    }}
                                  >
                                    <option value="new">建立新路口</option>
                                    {canonicalRecords.map(function (record) {
                                      const id = recordIntersectionKey(record);
                                      return (
                                        <option key={id} value={"merge:" + id}>
                                          併入：{record.name}
                                        </option>
                                      );
                                    })}
                                    <option value="skip">取消建置此檔</option>
                                  </select>
                                )}
                              </td>
                              {PEAK_KEYS.map(function (key) {
                                const window = liveRow.peakWindows?.[key];
                                return (
                                  <td key={key}>
                                    {window
                                      ? formatMinutes(window.start) +
                                        "–" +
                                        formatMinutes(window.end) +
                                        " · " +
                                        Math.round(
                                          window.total,
                                        ).toLocaleString() +
                                        " PCU/hr"
                                      : /* 全日尖峰要有 24 小時資料才算得出來；
                                           不足一天時這裡就是「—」，不推估。 */
                                        "—"}
                                  </td>
                                );
                              })}
                              <td>
                                {row.warnings.map(function (warning) {
                                  return (
                                    <small
                                      className="warning-text"
                                      key={warning}
                                    >
                                      {warning}
                                    </small>
                                  );
                                })}
                              </td>
                              <td>
                                <button
                                  className="icon-danger"
                                  onClick={function () {
                                    setImportRows(
                                      importRows.filter(function (item) {
                                        return item.file !== row.file;
                                      }),
                                    );
                                  }}
                                >
                                  刪除
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  </details>
                )}
                {/*
                  ★ 動作列放在**異常確認表的正下方、靠右**（2026-09-10 使用者定案）。

                  使用者的原話：「確認匯入按鈕應該都要做在異常確認表單的右下處，
                  表示有確認過沒異常，使用者親自按確認」。

                  ⚠️ 我在這一項上搖擺過兩次，方向相反，以這一段為準：
                     (1) 我先提 sticky（方便按到）。
                     (2) 使用者說「表示有確認過沒異常，使用者親自按確認」
                        → 我整個倒向「刻意製造摩擦、不要 sticky」。**那是過度修正。**
                     (3) 使用者接著明講：「懶得看的使用者也能透過你說的 sticky
                        直接點確認（這很方便）……但**我們總不能逼迫使用者
                        非這樣做不可**。」

                     兩件事同時成立，不是二選一：
                       ・DOM 順序在異常表**之後**、靠右 → 語意上「上面看過了才按」
                       ・sticky 黏在**面板底緣** → 引導你往下看，但不擋住想直接按的人

                  ⚠️ 也**不要**在上方再放一份。DOM 順序是語意的來源，
                     放兩份等於把那個語意抵消掉。
                */}
                <div className="preview-actions">
                  {/* 預覽的用意就是「先看看有沒有問題，有問題先去修檔案」。
                      過去只能一列一列按「刪除」，整批要放棄時很麻煩，
                      也讓人不確定自己是不是已經被寫進去了。 */}
                  <button
                    className="ghost"
                    disabled={!importRows.length}
                    onClick={function () {
                      if (
                        !confirm(
                          "取消本次預覽？\n已辨識的 " +
                            importRows.length +
                            " 個檔案會從畫面清除，正式資料完全不會變動。",
                        )
                      )
                        return;
                      setImportRows([]);
                      setNoonAsked(false);
                      setImportResolutions({});
                      setImportConflictModes({});
                      // 預覽時為了讓車種歸類面板能操作，先把新車種寫進了
                      // 目錄／對應／當量矩陣。取消就要原樣還原，否則
                      //「正式資料完全不會變動」是騙人的，而且沒有任何介面
                      // 可以把多出來的車種刪掉。已經有紀錄在用的不動。
                      if (previewAddedVehicles.length) {
                        const inUse = new Set(
                          records.flatMap(function (record) {
                            return Object.keys(record.survey?.vehicle || {});
                          }),
                        );
                        const removable = previewAddedVehicles.filter(
                          function (id) {
                            return !inUse.has(id);
                          },
                        );
                        if (removable.length) {
                          setVehicleCatalog(function (existing) {
                            const next = { ...existing };
                            removable.forEach(function (id) {
                              delete next[id];
                            });
                            return next;
                          });
                          setVehicleMappings(function (existing) {
                            const next = { ...existing };
                            removable.forEach(function (id) {
                              delete next[id];
                            });
                            return next;
                          });
                          setPce(function (existing) {
                            const next = structuredClone(existing);
                            removable.forEach(function (id) {
                              delete next[id];
                            });
                            return next;
                          });
                        }
                        setPreviewAddedVehicles([]);
                      }
                      // importVehicleDefinitions 是由 importRows 推導出來的，
                      // 清空 importRows 就會跟著消失，不需要也不能另外清。
                      // 檔案輸入也要清掉：使用者修好檔案後通常會重新選同一個
                      // 檔名，不清掉的話瀏覽器可能不觸發 change。
                      if (fileRef.current) fileRef.current.value = "";
                      setImportRowPeriod({});
                      notify("已取消本次預覽，正式資料沒有變動；修正檔案後請重新選取。");
                    }}
                  >
                    取消預覽
                  </button>
                  <button
                    className="primary"
                    disabled={
                      !importRows.length ||
                      !importPeriodReady ||
                      /*
                       * ⚠️ 只有**真的混批**（預覽裡有兩種以上的解析季別）才停用。
                       *   整批同一個解析季別、只是使用者把季別改對了的情況要放行，
                       *   由 commitImport() 跳確認框再問一次。
                       */
                      importPeriodMixed
                    }
                    title={
                      importPeriodMixed
                        ? "預覽裡混了不同季別的批次，無論寫進哪一季都會有一批是錯的。請按「取消預覽」重來，或分批寫入。"
                        : importPeriodShifted
                          ? "這批檔案原本是在別的季別之下預覽的，按下去會再問一次。"
                          : undefined
                    }
                    onClick={commitImport}
                  >
                    {/*
                     * ⚠️ 這一顆和上面幾處不同：它講的是「我正要做什麼」，
                     *   是給人讀的，所以要跟著「期別顯示／年份顯示」走。
                     */}
                    確認寫入 {importPeriod ? showQuarter(importPeriod) : "未選季度"}
                  </button>
                </div>
              </section>
              {/*
                * ══════════════════════════════════════════════════════════
                *  「已匯入季度資料」整塊已於 2026-09-16 從畫面移除（X-20）
                * ══════════════════════════════════════════════════════════
                *
                * 使用者 2026-09-16：
                *   「刪除單一季功能統一位置後，"已匯入季度資料"功能就能移除掉了，
                *     一樣不需要刪除單一筆資料的功能了，不然資料一多，
                *     會顯得太長串，除非你維護會用到，那就一樣隱藏在程式碼，
                *     畫面不需要在展現」
                *
                * 那一塊原本有三件事，各自的下場：
                *   ・刪除整季 → **搬到「資料維護 → 刪除單一季度」**（同一支 deleteQuarter()）
                *   ・每個路口一顆「站號 ×」的逐筆刪除 → **整個拿掉**（使用者指名捨棄）
                *   ・「某季有幾個路口」的清單 → 併進資料維護那一格的影響說明
                *
                * ⚠️ 順序很重要：**先有新的落點、驗過，才拿掉這一塊**。
                *   反過來做的話中間會有一段「畫面上完全刪不掉任何一季」的空窗。
                * ⚠️ 逐筆刪除**沒有留在程式碼裡**——它與 deleteQuarter() 行為不對稱
                *   （逐筆會新增還原點、整季會清光還原點），留著只會讓下一個人
                *   以為那是兩條可用的路。要逐筆處理請刪整季後重新匯入。
                */}
            </>
          )}

          {view === "parameters" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">PARAMETER LIBRARY</span>
                  <h1>車種與轉向當量參數</h1>
                  <p>
                      當量用於把原始車輛數換算成
                      PCU，四個統計範圍（上午尖峰、下午尖峰、全調查時段尖峰、全調查時段）都會套用；
                      它同時是<b>挑選尖峰小時的依據</b>，因此修改係數會連帶重挑尖峰。
                    </p>
                  {/*
                   * ⚠️ 當量矩陣本身**不分時段、不分方向**：一個車種在一個轉向
                   *   只有一個係數。這一頁的表是「車種 × 轉向」，
                   *   所以車種與轉向別是它的列與欄，不是篩選條件。
                   */}
                  {unusedConditionsNote(
                    [
                      "peak",
                      "peakRule",
                      "flowView",
                      "day",
                      "display",
                      "vehicle",
                      "movement",
                    ],
                    "當量係數不分時段、不分方向：一個車種在一個轉向只有一個係數。這一頁的表本身就是「車種 × 轉向」——車種是列、轉向是欄，兩者都要全部列出來才看得到完整的係數表，所以它們在這裡不是篩選條件。",
                  )}
                </div>
                <button
                  className="secondary"
                  onClick={function () {
                    setPce({ ...pce, ...structuredClone(DEFAULT_PCE) });
                    notify(
                      "已恢復四個標準車種的講義預設值；新增車種保留原設定。",
                    );
                  }}
                >
                  恢復預設值
                </button>
              </section>
              {/*
                * ── 這一組係數要套用到哪裡？ ────────────────────
                *
                * 使用者 2026-09-10：「我可以選擇哪一季＋哪一個路段，
                * 當量係數改變了，寫入新的係數並套用然後重新計算，
                * 下面可以摘要，哪個路段在哪一季有修過當量係數。」
                *
                * ⚠️ 預設停在「全季別 × 全路口」＝改版前的行為。
                */}
              <section
                className={focusClass("param-scope", "panel factor-scope-panel")}
                id="param-scope"
                data-testid="factor-scope"
              >
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">SCOPE</span>
                    <h2>套用範圍</h2>
                  </div>
                </div>
                <div className="factor-scope-picker">
                  <label>
                    季別
                    <select
                      value={scopeQuarter}
                      onChange={function (event) {
                        setScopeQuarter(event.target.value);
                      }}
                    >
                      <option value={SCOPE_ANY}>全季別</option>
                      {scopeQuarterOptions.map(function (quarter) {
                        return (
                          <option key={quarter} value={quarter}>
                            {/*
                              * ⚠️ 一定要走 quarterLabel()，不可以直接印
                              *   record.quarter。使用者可以把年份切換成西元年，
                              *   直接印的話這個下拉會停在「115Q1」，
                              *   而同一頁其他地方寫的是「2026Q1」——
                              *   同一個季度在同一個畫面上有兩種寫法。
                              *   （e2e-year-style 實測抓到，那正是它存在的理由。）
                              */}
                            {quarterLabel(quarter)}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label>
                    路口
                    <select
                      value={scopeRoadId}
                      onChange={function (event) {
                        setScopeRoadId(event.target.value);
                      }}
                    >
                      <option value={SCOPE_ANY}>全路口</option>
                      {scopeRoadOptions.map(function (road) {
                        return (
                          <option key={road.id} value={road.id}>
                            {road.name}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <button className="primary" onClick={applyPceScope}>
                    套用到這個範圍
                  </button>
                </div>
                <p className="factor-scope-state">
                  {scopeQuarter === SCOPE_ANY && scopeRoadId === SCOPE_ANY
                    ? "目前編輯的是全計畫預設值：所有季別、所有路口都套用這一組。"
                    : ownPceScope(pceScopes, scopeQuarter, scopeRoadId)
                      ? `「${pceScopeLabel(quarterLabel(scopeQuarter), scopeRoadId, scopeRoadName, "全路口")}」有自己的專屬係數，與其他範圍不同。`
                      : `「${pceScopeLabel(quarterLabel(scopeQuarter), scopeRoadId, scopeRoadName, "全路口")}」目前沿用上層設定；下方表格顯示的是它現在生效的值，改完按「套用到這個範圍」才會變成專屬設定。`}
                </p>
                {/*
                  * ⚠️ 這一段是這支程式**特有**的，全日交通量沒有。
                  *
                  * 路口轉向的每一筆紀錄都帶著 `pceUsed` 快照，計算讀的是快照，
                  * 所以改係數**不會**自動改掉已匯入資料的數字（那是刻意的：
                  * 已經拿去寫報告的數字不該在背後被改掉）。
                  * 但使用者的原話是「寫入新的係數並套用然後**重新計算**」，
                  * 所以要給一顆明確的按鈕，而且要講清楚它會動到哪幾筆。
                  */}
                <div className="factor-scope-summary" data-testid="factor-scope-summary">
                  <strong>係數套用範圍</strong>
                  {pceScopes.length ? (
                    <>
                      <p>除了全計畫預設之外，另有 {pceScopes.length} 組專屬係數：</p>
                      <ul>
                        {pceScopes.map(function (scope) {
                          const affected = projectRecords.filter(
                            function (record) {
                              return (
                                (scope.quarter === SCOPE_ANY ||
                                  record.quarter === scope.quarter) &&
                                (scope.roadId === SCOPE_ANY ||
                                  recordIntersectionKey(record) === scope.roadId)
                              );
                            },
                          );
                          return (
                            <li key={`${scope.quarter}|${scope.roadId}`}>
                              <span>
                                {pceScopeLabel(
                                  quarterLabel(scope.quarter),
                                  scope.roadId,
                                  intersectionNameOf(scope.roadId),
                                  "全路口",
                                )}
                              </span>
                              <small>
                                {affected.length
                                  ? `涵蓋 ${affected.length} 筆已匯入資料`
                                  : "目前沒有已匯入的資料落在這個範圍"}
                              </small>
                              {affected.length > 0 && (
                                <button
                                  className="secondary"
                                  onClick={function () {
                                    if (
                                      !window.confirm(
                                        `要用「${pceScopeLabel(quarterLabel(scope.quarter), scope.roadId, intersectionNameOf(scope.roadId), "全路口")}」的係數重算這 ${affected.length} 筆資料嗎？\n\n` +
                                          "⚠️ PCU 與「尖峰時段」都會重新計算，數字會變。\n" +
                                          "系統會先建立還原點。",
                                      )
                                    )
                                      return;
                                    applyRecompute(
                                      affected,
                                      pceScopeLabel(
                                        quarterLabel(scope.quarter),
                                        scope.roadId,
                                        intersectionNameOf(scope.roadId),
                                        "全路口",
                                      ),
                                    );
                                  }}
                                >
                                  用這一組重算
                                </button>
                              )}
                              <button
                                className="secondary"
                                onClick={function () {
                                  clearPceScope(scope.quarter, scope.roadId);
                                }}
                              >
                                還原成預設
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <p>目前全部季別、全部路口都套用同一組計畫預設係數。</p>
                  )}
                  {/*
                    * ⚠️ 這一句一定要在，而且要講**實話**。
                    *
                    * 這支程式在匯入當下就把 PCU、OD 與尖峰算完存起來了，
                    * 留下的原始軌跡沒有逐車種 × 逐轉向的車輛數，
                    * 所以換一組係數之後**沒辦法**把已匯入的資料重算回來。
                    * 不講的話，使用者會以為建立覆寫就等於改掉了既有數字，
                    * 然後拿著舊係數算出來的報表去交件。
                    */}
                  <p className="factor-scope-note">
                    範圍設定會套用在<b>之後匯入</b>的資料上。已匯入的資料
                    <b>不會自動跟著改</b>（每一筆都存著自己的係數快照，
                    所以已經交出去的數字不會在背後被動掉）；
                    要讓既有資料也改用新係數，按該範圍那一列的
                    <b>「用這一組重算」</b>。
                  </p>
                  {scopeConflicts.length ? (
                    <div className="factor-scope-conflict">
                      {/*
                        * ⚠️ 看不見的優先順位，就是下一個「算出來的數字沒人解釋得了」。
                        */}
                      <strong>⚠️ 有 {scopeConflicts.length} 個範圍互相重疊</strong>
                      <ul>
                        {scopeConflicts.map(function (conflict) {
                          return (
                            <li key={`${conflict.quarter}|${conflict.roadId}`}>
                              {quarterLabel(conflict.quarter)} 的「全路口」設定 與{" "}
                              {intersectionNameOf(conflict.roadId)} 的「全季別」設定重疊，
                              目前套用 {quarterLabel(conflict.quarter)} 的值（季別優先）。
                              <button
                                className="secondary"
                                onClick={function () {
                                  setScopeQuarter(conflict.quarter);
                                  setScopeRoadId(conflict.roadId);
                                }}
                              >
                                為這一格建立明確設定
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </section>
              {/* 側欄子項目「車種轉向當量」指向這一塊。 */}
              <section
                className={focusClass("param-pce", "parameter-grid")}
                id="param-pce"
              >
                <article className="panel parameter-card">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">PCE / PCU</span>
                      <h2>各分析車種左／直／右當量</h2>
                    </div>
                  </div>
                  {/*
                    * ⚠️ 這一段一定要在，而且要講**實話**。
                    *
                    * 使用者 2026-09-11 實測：114Q2 匯入時忘了把聯結車併入特種車，
                    * 後來到這一頁想改，找不到地方改——而且也沒有任何文字告訴他
                    * 「歸類只在匯入時生效、要改請重新匯入」。他只能卡在那裡。
                    *
                    * 為什麼不能事後併（查過資料結構才這樣寫的）：
                    *   併入之後當量從 1／1／1 變成 2.5／2／2.3，PCU 會變大，
                    *   而**尖峰小時是用 PCU 挑出來的**，所以尖峰可能換一個小時。
                    *   但每一筆只留下「已選定尖峰時段內」的逐格原始值
                    *  （sourceTrace.cells 是 per peak），沒有完整的逐時逐車種資料，
                    *   **沒辦法重新挑尖峰**。硬做會變成車種明細改了、
                    *   總量與尖峰時段還是舊的——同一頁兩個數字互相矛盾且沒有提示。
                    */}
                  <p className="parameter-note">
                    這裡改「分析方式／歸類」與當量會套用在<b>之後匯入</b>的資料上。
                    已匯入的資料<b>不會自動跟著改</b>——每一筆都保存著匯入當下的
                    歸類與當量快照，所以已經交出去的數字不會在背後被動掉。
                    改完之後要讓既有資料也跟著改，按
                    <b>「用目前的設定重算」</b>。
                  </p>
                  {/*
                    * ── 重算按鈕 ──────────────────────────────────
                    *
                    * 使用者 2026-09-11：114Q2 匯入時忘了把聯結車併入特種車，
                    * 事後想改卻改不動。「改完參數要能重新套用計算」。
                    *
                    * ⚠️ 刻意做成**按鈕**而不是自動：重算會改變 PCU 與**尖峰時段**，
                    *   而那些數字可能已經寫進交出去的報告。按鈕按下去是一個
                    *   明確的決定，而且會建立還原點。
                    *
                    * ⚠️ 只有 v2.1.65 之後匯入的資料留著逐格原始資料。
                    *   舊資料按了會明白告訴你「這幾筆要重新匯入」，不會沒反應。
                    */}
                  {orphanVehicles.length > 0 && (
                    <div className="parameter-orphans">
                      <div>
                        <strong>
                          有 {orphanVehicles.length} 個車種目前沒有任何資料在使用
                        </strong>
                        <small>
                          {orphanVehicles
                            .map(function (key) {
                              return (
                                vehicleCatalog[key] ||
                                key.replace(/^custom:/, "")
                              );
                            })
                            .join("、")}
                          {" "}
                          ——多半是先前匯入後又把那幾季資料刪掉留下的。
                          清掉之後這張表會乾淨一點，
                          <b>不會影響任何已匯入資料的數字</b>；
                          下次匯入若又出現同名車種，系統會重新建立。
                          {/*
                            ⚠️ 已經設成「併入某一類」的車種**不算**在內——
                            那條對應關係要留著，下一季匯入才會自動併入。
                          */}
                        </small>
                      </div>
                      <button
                        className="secondary"
                        onClick={function () {
                          if (
                            !window.confirm(
                              `要從清單移除這 ${orphanVehicles.length} 個沒有資料使用的車種嗎？\n\n` +
                                orphanVehicles
                                  .map(function (key) {
                                    return (
                                      "・" +
                                      (vehicleCatalog[key] ||
                                        key.replace(/^custom:/, ""))
                                    );
                                  })
                                  .join("\n") +
                                "\n\n已匯入資料的數字不會有任何改變。",
                            )
                          )
                            return;
                          const removing = new Set(orphanVehicles);
                          setPce(function (existing) {
                            const next = structuredClone(existing);
                            removing.forEach(function (key) {
                              delete next[key];
                            });
                            return next;
                          });
                          setVehicleCatalog(function (existing) {
                            const next = { ...existing };
                            removing.forEach(function (key) {
                              delete next[key];
                            });
                            return next;
                          });
                          notify(
                            `已從清單移除 ${removing.size} 個沒有資料使用的車種。已匯入資料的數字沒有任何改變。`,
                          );
                        }}
                      >
                        清除沒有資料使用的車種
                      </button>
                    </div>
                  )}
                  <div className="parameter-recompute">
                    <div>
                      <strong>用目前的設定重算已匯入的資料</strong>
                      <small>
                        會用目前的車種歸類與當量設定，重新計算{" "}
                        {recomputableCount === projectRecords.length
                          ? `全部 ${projectRecords.length} 筆`
                          : `${recomputableCount} 筆`}
                        資料的 PCU、OD 與<b>尖峰時段</b>。
                        路口名稱、支線角度與流向設定都會保留。
                        {projectRecords.length - recomputableCount > 0 && (
                          <>
                            {" "}
                            另有 {projectRecords.length - recomputableCount}{" "}
                            筆是舊版匯入的、沒有留下重算需要的原始資料，
                            那幾筆要重新匯入才會改變。
                          </>
                        )}
                      </small>
                    </div>
                    <button
                      className="secondary"
                      disabled={!recomputableCount}
                      onClick={function () {
                        if (
                          !window.confirm(
                            `要用目前的歸類與當量重算 ${recomputableCount} 筆已匯入的資料嗎？\n\n` +
                              "⚠️ PCU 與「尖峰時段」都會重新計算，數字會變。\n" +
                              "系統會先建立還原點，反悔可以從「備份與還原」復原。",
                          )
                        )
                          return;
                        applyRecompute(projectRecords, "全部已匯入資料");
                      }}
                    >
                      用目前的設定重算（{recomputableCount} 筆）
                    </button>
                    {/*
                      * ── 清除重算用的原始資料 ──────────────────────
                      *
                      * 使用者 2026-09-11 要的保險：萬一瀏覽器空間吃緊，
                      * 可以只丟掉這一份而不影響任何數字。
                      *
                      * ⚠️ 實測每筆平均只多 8 KB、最大 43 KB，一般不會需要用到。
                      *   放在這裡是為了「真的遇到時有路可走」，不是日常操作，
                      *   所以做成次要按鈕並且要二次確認。
                      *
                      * ⚠️ 一定要講清楚代價：清掉之後那幾筆就**不能再重算**，
                      *   要改歸類或係數只能重新匯入。已經算好的數字完全不受影響。
                      */}
                    {recomputableCount > 0 && (
                      <button
                        className="link-button"
                        onClick={function () {
                          if (
                            !window.confirm(
                              `要清除 ${recomputableCount} 筆資料的原始資料嗎？\n\n` +
                                "⚠️ 清除之後，這幾筆「未來要重算就必須重新匯入原始檔案」。\n" +
                                "　 （例如日後調整車種轉向當量或歸類，想讓舊資料跟著改，\n" +
                                "　　 就得把那幾季的 Excel 再匯入一次。）\n\n" +
                                "・已經算好的數字完全不受影響，畫面與報表都不會變\n" +
                                "・省下的空間只有約 " +
                                Math.round((recomputableCount * 8) / 1024 * 10) / 10 +
                                " MB\n\n" +
                                "確定要清除嗎？",
                            )
                          )
                            return;
                          setRecords(function (previous) {
                            return previous.map(function (record) {
                              if (
                                record.projectId !== activeProjectId ||
                                !record.sourcePreview
                              )
                                return record;
                              const next = { ...record };
                              delete next.sourcePreview;
                              return next;
                            });
                          });
                          notify(
                            `已清除 ${recomputableCount} 筆的重算用原始資料。數字沒有任何改變；日後要改歸類或係數，請重新匯入那幾季的檔案。`,
                          );
                        }}
                      >
                        {/*
                          * ⚠️ 按鈕**短**，代價寫在旁邊的備註，詳細後果寫在確認框。
                          *
                          * 使用者 2026-09-14 的兩則：
                          *   「這個清除重算用的原始資料是什麼意思? ……
                          *     因為寫原始資料感覺**按下去後果蠻嚴重的**」
                          *   「你按鍵寫『清除後這 25 筆就不能再重算（只省 0.2 MB）』，
                          *     **這樣太長了**。按鍵可以寫**清除原始資料**就好，
                          *     按鍵旁邊括號備註**（建議多少容量以上再清除）**。
                          *     使用者如果按下，也要有個提醒視窗，告知按下去的話，
                          *     未來要重算必須重新匯入檔案，是否要清除（確定或取消）。」
                          *
                          * ⚠️ 備註要給**具體門檻**，而且把目前的量寫出來——
                          *   兩個數字擺在一起，使用者一眼就看得出差多遠、根本不用按。
                          *   （現在的瀏覽器有幾十 GB 可用，這 0.2 MB 毫無意義。）
                          */}
                        清除原始資料
                      </button>
                    )}
                    {recomputableCount > 0 && (
                      <small className="clear-source-note">
                        （目前只佔{" "}
                        {Math.round((recomputableCount * 8) / 1024 * 10) / 10} MB，
                        建議本機資料累積到 <b>1 GB</b> 以上、或瀏覽器提示空間不足時再清除）
                      </small>
                    )}
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>車種</th>
                          {/*
                            * ⚠️ 這一欄是 2026-09-11 補的。
                            *
                            * 使用者實測：114Q2 匯入時忘了把「聯結車」併入「特種車」，
                            * 後來想改，卻發現這一頁只能改當量數字、**沒有歸類**——
                            * 歸類只在匯入預覽那一頁有，寫進去就改不回來了。
                            * 那是介面上的死路：使用者找不到地方改，也不知道
                            * 「重新匯入」才是答案。
                            */}
                          <th>分析方式／歸類</th>
                          <th>左轉</th>
                          <th>直行</th>
                          <th>右轉</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(editingPce)
                          .sort(function (a, b) {
                            const ai = ANALYSIS_VEHICLES.indexOf(
                              a as (typeof ANALYSIS_VEHICLES)[number],
                            );
                            const bi = ANALYSIS_VEHICLES.indexOf(
                              b as (typeof ANALYSIS_VEHICLES)[number],
                            );
                            if (ai >= 0 || bi >= 0)
                              return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
                            return (vehicleCatalog[a] || a).localeCompare(
                              vehicleCatalog[b] || b,
                              "zh-Hant",
                            );
                          })
                          .map(function (vehicleKey) {
                            const isCore = ANALYSIS_VEHICLES.includes(
                              vehicleKey as (typeof ANALYSIS_VEHICLES)[number],
                            );
                            return (
                              <tr
                                key={vehicleKey}
                                /* 與匯入預覽同一套標示，兩邊看到的是同一件事。 */
                                className={isCore ? undefined : "vehicle-row-new"}
                              >
                                <td>
                                  <strong>
                                    {vehicleCatalog[vehicleKey] ||
                                      PCE_LABELS[
                                        vehicleKey as keyof typeof PCE_LABELS
                                      ] ||
                                      vehicleKey.replace(/^custom:/, "")}
                                  </strong>
                                  {!isCore &&
                                    (orphanVehicles.includes(vehicleKey) ? (
                                      /*
                                       * ⚠️ 沒有任何資料在用的車種要標出來。
                                       *   使用者刪掉季度資料之後，這些車種仍然留在
                                       *   清單上（車種清單是計畫層級、只增不減的），
                                       *   他會以為自己的設定沒生效——實測遇到過。
                                       */
                                      <span className="vehicle-badge-orphan">
                                        目前沒有資料使用
                                      </span>
                                    ) : (
                                      <span className="vehicle-badge-new">
                                        新增車種・請確認歸類
                                      </span>
                                    ))}
                                </td>
                                <td>
                                  {isCore ? (
                                    /*
                                     * 四個標準車種本身不能被併到別的類別裡——
                                     * 它們就是歸類的目標。
                                     */
                                    <small className="vehicle-map-fixed">
                                      標準類別
                                    </small>
                                  ) : (
                                    <select
                                      value={
                                        vehicleMappings[vehicleKey] || vehicleKey
                                      }
                                      onChange={function (event) {
                                        const nextTarget = event.target.value;
                                        setVehicleMappings({
                                          ...vehicleMappings,
                                          [vehicleKey]: nextTarget,
                                        });
                                        if (!pce[nextTarget])
                                          setPce({
                                            ...pce,
                                            [nextTarget]: {
                                              left: 1,
                                              through: 1,
                                              right: 1,
                                            },
                                          });
                                      }}
                                    >
                                      <option value={vehicleKey}>
                                        獨立分析：
                                        {vehicleCatalog[vehicleKey] ||
                                          vehicleKey.replace(/^custom:/, "")}
                                      </option>
                                      {ANALYSIS_VEHICLES.filter(function (id) {
                                        return id !== vehicleKey;
                                      }).map(function (id) {
                                        return (
                                          <option key={id} value={id}>
                                            併入：{VEHICLE_LABELS[id]}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  )}
                                </td>
                                {(["left", "through", "right"] as const).map(
                                  function (move) {
                                    /*
                                     * ⚠️ 被併入別的類別時，這一列**不可以**顯示
                                     *   自己的當量。
                                     *
                                     * 使用者 2026-09-11 實測：聯結車已經併入特種車，
                                     * 但這裡照樣顯示聯結車自己的 1／1／1——
                                     * 那個數字**根本沒有被用到**（實際換算用的是
                                     * 特種車的 2.5／2／2.3），他看到之後以為
                                     * 自己的合併設定沒有生效。
                                     *
                                     * 改成顯示**目標類別**的當量並鎖住，
                                     * 與全日交通量的做法一致（那支早就這樣做了）。
                                     */
                                    const mergedInto =
                                      vehicleMappings[vehicleKey] &&
                                      vehicleMappings[vehicleKey] !== vehicleKey
                                        ? vehicleMappings[vehicleKey]
                                        : "";
                                    if (mergedInto)
                                      return (
                                        <td key={move}>
                                          <input
                                            type="number"
                                            value={
                                              editingPce[mergedInto]?.[move] ?? 1
                                            }
                                            disabled
                                            aria-label={
                                              (vehicleCatalog[vehicleKey] ||
                                                vehicleKey) +
                                              "已併入" +
                                              (VEHICLE_LABELS[mergedInto] ||
                                                mergedInto) +
                                              "，使用其" +
                                              MOVE_LABELS[move] +
                                              "當量"
                                            }
                                          />
                                        </td>
                                      );
                                    return (
                                      <td key={move}>
                                        {/* ⚠️ 受控數字框一律走 NumberField，理由見 lib/number-field.tsx。 */}
                                        <NumberField
                                          min={0}
                                          step={0.1}
                                          value={
                                            editingPce[vehicleKey]?.[move] ?? 1
                                          }
                                          ariaLabel={
                                            (vehicleCatalog[vehicleKey] ||
                                              vehicleKey) +
                                            MOVE_LABELS[move] +
                                            "當量"
                                          }
                                          onCommit={function (committed) {
                                            const next = {
                                              ...editingPce,
                                              [vehicleKey]: {
                                                ...editingPce[vehicleKey],
                                                [move]: committed,
                                              },
                                            };
                                            /*
                                             * ⚠️ 編輯計畫預設時走**原本那條路**（setPce），
                                             *   行為與改版前完全相同；
                                             *   編輯某一個範圍時只動草稿，
                                             *   不可以碰到計畫預設。
                                             */
                                            if (scopeDraft) setScopeDraft(next);
                                            else setPce(next);
                                          }}
                                        />
                                      </td>
                                    );
                                  },
                                )}
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  <div className="source-note">
                    <b>預設值來源與版本保存</b>
                    <p>
                      機車、小型車、大型車、特種車四類的左轉／直行／右轉當量，取自使用者提供的《交通流量教育訓練1060310》簡報第
                      15
                      頁「當量參考值」；原簡報未載明引用來源，故列為可調整的專案預設。
                      <b>簡報只提供這四類的參考值</b>
                      ，因此匯入時若偵測到大貨車、大客車、聯結車等其他車種，系統不會自行推估，
                      一律先以 <b>1.0</b>{" "}
                      建立並標示為「新增車種」，請在上方表格逐一改成本計畫採用的數值。
                      修改後會套用於後續匯入的尖峰時段搜尋與 PCU/hr
                      換算；每筆路口同時保存匯入當下的係數與分類快照，Excel
                      報表與備份均可追溯。
                    </p>
                  </div>
                </article>
                <article className={focusClass("param-coverage", "panel parameter-card")} id="param-coverage">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">SCOPE</span>
                      <h2>本系統的計算範圍</h2>
                    </div>
                  </div>
                  <div className="guidance-copy">
                    <p>
                      系統以原始 15 分鐘交通量找出連續 60
                      分鐘尖峰，依可調整的車種／轉向當量換算
                      PCU/hr，並保留實際車輛數（輛/hr）。
                    </p>
                    <p>
                      本系統不加入未由本次調查取得的容量相關假設（不做號誌時制或容量計算）。
                    </p>
                  </div>
                </article>
              </section>
            </>
          )}

          {view === "composition" && (
            <>
              {!selected ? (
                renderNoData("尚無可分析的車種資料")
              ) : (
                <>
                  <section className="page-head compact">
                    <div>
                      <span className="eyebrow">VEHICLE COMPOSITION</span>
                      <h1>各路口車種組成</h1>
                      <p>
                        以原始實際車輛數統計，不套用 PCU
                        當量。「全調查時段」是這份檔案<b>實際涵蓋的時數</b>——
                        24 小時的調查才等於一整天，4 小時的調查就是那 4
                        小時；「全調查時段尖峰」是在同一段涵蓋裡找出最忙的一小時，
                        視窗不會跨越調查中間的空檔。
                      </p>
                    </div>
                    <div className="head-buttons">
                      <Segmented
                        value={compositionScope}
                        options={(
                          ["SURVEY", ...PEAK_KEYS] as CompositionScope[]
                        ).map(function (key): [CompositionScope, string] {
                          return [
                            key,
                            key === "SURVEY"
                              ? "全調查時段"
                              : SCOPE_SHORT_LABELS[key],
                          ];
                        })}
                        onChange={setCompositionScope}
                        /*
                         * 使用者 2026-09-10 實測：「車種分析分頁……因為沒有
                         * 全日尖峰，我竟然可以點進去，點了之後顯示都是 0」。
                         * 顯示 0 比顯示「－」危險得多——0 會被抄進報告。
                         * 這裡與流量核對工作台用同一個依據（有沒有挑到視窗）。
                         */
                        disabledReason={function (key) {
                          if (key === "SURVEY") return null;
                          if (!current.length) return null;
                          const usable = current.filter(function (record) {
                            return hasScopeValue(viewRecord(record), key as ScopeKey);
                          });
                          if (usable.length) return null;
                          return "這一批資料缺少逐時間格資料，算不出這個時段（顯示 0 會被誤讀成「真的沒有車」）";
                        }}
                      />
                      <button
                        className="secondary"
                        onClick={exportCompositionExcel}
                      >
                        下載 Excel
                      </button>
                    </div>
                  </section>
                  {/*
                   * 脫離中的圖要說清楚「主工具列現在是什麼」，並給一顆回歸鈕。
                   * 沒脫離時這一塊不出現（元件自己判斷）。
                   */}
                  <ChartDetachNote
                    chartId={CHART_COMPOSITION}
                    detached={isDetached(chartOverrides, CHART_COMPOSITION)}
                    mainSummary={describeMain(mainFilters, showQuarter, showVehicle)}
                    onReset={function () {
                      setChartOverrides(function (previous) {
                        return resetChart(previous, CHART_COMPOSITION);
                      });
                    }}
                  />
                  {/*
                   * ⚠️ 主工具列選「上午＋下午並列」時，這一張畫不出並列
                   *   （它是一個路口一個圓環，並列會變成兩倍的圓環擠在一起）。
                   *   不可以默默只畫上午——使用者會以為那就是並列的結果。
                   *   只在真的選了並列時才出現這一句。
                   */}
                  <InapplicableNote
                    show={compositionFilters.peak === "AMPM"}
                    text={inapplicableNote(
                      "本圖一次只呈現得了一個時段：它是一個路口一個圓環，上午與下午並列會變成兩倍的圓環擠在一起。",
                      "上午尖峰",
                    )}
                  />
                  {/*
                   * ⚠️ 轉向別對這一張不適用：車種組成是「各車種佔多少」，
                   *   不分左直右；篩了轉向別只會讓分母變成那一個轉向，
                   *   而畫面上寫的還是「車種組成」。
                   */}
                  <InapplicableNote
                    show={isFiltered(compositionFilters, "movement")}
                    text={inapplicableNote(
                      "本圖不適用轉向別篩選：車種組成統計的是各車種佔路口總量的比例，不分左轉、直行、右轉。",
                      "全部轉向",
                    )}
                  />
                  {/*
                   * ⚠️ 「車種」對這一頁不適用：這一頁整張表就是**各車種的組成**，
                   *   篩成單一車種之後只會剩下一片 100%，那不是組成。
                   */}
                  <InapplicableNote
                    show={isFiltered(compositionFilters, "vehicle")}
                    text={inapplicableNote(
                      "本頁整張表就是各車種的組成，篩成單一車種之後只會剩下一格 100%，因此不適用「車種」篩選。",
                      "全部車種（逐欄列出）",
                    )}
                  />
                  {/*
                   * ⚠️ 這一頁以**實際車輛數**統計、不套 PCU 當量（頁首就這樣寫），
                   *   所以「交通流量（PCU）」這一個選項對它不適用。
                   *   把輛數當成 PCU 印出去是謊報單位。
                   */}
                  <InapplicableNote
                    show={compositionFilters.display === "volume"}
                    text={inapplicableNote(
                      "本頁以實際調查到的車輛數統計，不套用 PCU 當量，因此沒有「交通流量（PCU）」這個欄位。",
                      "車輛數（可加百分比）",
                    )}
                  />
                  {/*
                   * ⚠️ 駛入／駛出的區分只在「全調查時段」檢視下才有
                   *  （下面那張「道路方向車種數量」表）。尖峰檢視沒有那張表，
                   *   這時切流量視角一個數字都不會變——要講出來。
                   */}
                  <InapplicableNote
                    show={
                      isFiltered(compositionFilters, "flowView") &&
                      compositionScope !== "SURVEY"
                    }
                    text={inapplicableNote(
                      "本頁的駛入／駛出區分只出現在「全調查時段」檢視的「道路方向車種數量」表；尖峰檢視統計的是整個路口的組成。",
                      "路口整體",
                    )}
                  />
                  <section className="diagram-toolbar panel">
                    <label>
                      資料季度
                      <select
                        value={quarter}
                        onChange={function (e) {
                          setQuarter(e.target.value);
                        }}
                      >
                        {quarters.map(function (q) {
                          return (
                            <option key={q} value={q}>
                              {quarterLabel(q)}（
                              {
                                projectRecords.filter(function (record) {
                                  return record.quarter === q;
                                }).length
                              }{" "}
                              路口）
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      路口
                      <select
                        value={recordIntersectionKey(selected)}
                        onChange={function (e) {
                          setSelectedIntersection(e.target.value);
                        }}
                      >
                        {currentCanonicalRecords.map(function (record) {
                          return (
                            <option
                              key={record.id}
                              value={recordIntersectionKey(record)}
                            >
                              {record.name}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    {selectedIntersectionRecords.length > 1 && (
                      <label>
                        資料別
                        <select
                          value={selected.surveyType || "待設定"}
                          onChange={function (e) {
                            setSelectedSurveyType(e.target.value);
                          }}
                        >
                          {selectedIntersectionRecords.map(function (record) {
                            return (
                              <option
                                key={record.id}
                                value={record.surveyType || "待設定"}
                              >
                                {record.surveyType || "待設定"}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    )}
                    <div className="source-note">
                      {compositionScope === "SURVEY"
                        ? selected.survey
                          ? "調查時段合計：" +
                            selected.survey.intervals +
                            " 個 " +
                            Math.round(
                              selected.survey.minutes /
                                Math.max(1, selected.survey.intervals),
                            ) +
                            " 分鐘區間（" +
                            (selected.survey.minutes / 60).toFixed(1) +
                            " 小時）"
                          : "此筆為舊版資料；重新匯入原始檔後可顯示全調查時段組成。"
                        : fullDayUnavailableReason(
                              selected,
                              compositionScope,
                            ) ||
                          SCOPE_LABELS[compositionScope] +
                            "：" +
                            scopeWindowLabel(selected, compositionScope)}
                    </div>
                  </section>
                  {/*
                   * ⚠️ 這裡的「算不算得出來」要看**這一個路口**，不是整季。
                   *   上面 Segmented 的 disabledReason 是用 current（整季）判斷的：
                   *   只要整季裡**有一個**路口有逐時間格資料，這個時段就點得進來。
                   *   但下面的數字是從 selected（就那一個路口）算的——換到一個
                   *   沒有逐時間格資料的路口，時段仍然點得進來，數字就會變成
                   *   0 與 0.0%。同一個條件下 Excel 寫的是「－」，畫面卻寫 0，
                   *   而 0 會被直接抄進報告，被讀成「真的沒有車」。
                   *   判斷依據與 exportCompositionExcel 完全一樣（hasScopeValue）。
                   */}
                  {(function () {
                    const computable =
                      compositionScope === "SURVEY" ||
                      hasScopeValue(selected, compositionScope);
                    return (
                      <>
                        {!computable && (
                          <div className="empty-inline">
                            {fullDayUnavailableReason(
                              selected,
                              compositionScope,
                            ) ||
                              "這個路口缺少逐時間格資料，算不出「" +
                                SCOPE_SHORT_LABELS[
                                  compositionScope as ScopeKey
                                ] +
                                "」。"}
                            下面一律顯示「－」，不是 0——0 會被誤讀成「真的沒有車」。
                          </div>
                        )}
                        <section className="kpi-grid composition-kpis">
                          {selectedVehicleIds.map(function (vehicleKey) {
                            const count = recordVehicleTotal(
                              selected,
                              compositionScope,
                              vehicleKey,
                            );
                            const total = selectedVehicleIds.reduce(function (
                              sum,
                              key,
                            ) {
                              return (
                                sum +
                                recordVehicleTotal(
                                  selected,
                                  compositionScope,
                                  key,
                                )
                              );
                            }, 0);
                            return (
                              <Kpi
                                key={vehicleKey}
                                label={vehicleLabel(selected, vehicleKey)}
                                value={
                                  computable
                                    ? count.toLocaleString() +
                                      " " +
                                      compositionScopeUnit(
                                        viewRecord(selected),
                                        compositionScope,
                                      )
                                    : "－"
                                }
                                note={
                                  computable
                                    ? total
                                      ? ((count / total) * 100).toFixed(1) + "%"
                                      : "0.0%"
                                    : "－"
                                }
                              />
                            );
                          })}
                        </section>
                      </>
                    );
                  })()}
                  {compositionScope === "SURVEY" ? (
                    <section className={focusClass("composition-table", "panel")} id="composition-table">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">ROAD DIRECTION</span>
                          <h2>全調查時段道路方向車種數量</h2>
                          <small>
                            依各支線的駛出／駛入 OD
                            流量統計；雙向合計等同兩個行車方向相加。單位：
                            {compositionScopeUnit(selected, "SURVEY").replace("/", "／")}（
                            {selected.survey?.minutes || 0} 分鐘）
                          </small>
                        </div>
                      </div>
                      <div className="direction-mode-grid">
                        {selected.approaches.map(function (approach) {
                          const code = approach.sourceCode || approach.id;
                          return (
                            <label key={approach.id}>
                              {approach.name}（{code}）
                              <select
                                value={
                                  selected.directionDisplay?.[code] || "split"
                                }
                                onChange={function (event) {
                                  updateSelectedGeometry(function (record) {
                                    record.directionDisplay = {
                                      ...(record.directionDisplay || {}),
                                      [code]: event.target.value as
                                        "split" | "two-way",
                                    };
                                    return record;
                                  });
                                }}
                              >
                                <option value="split">分行車方向</option>
                                <option value="two-way">雙向合計</option>
                              </select>
                            </label>
                          );
                        })}
                      </div>
                      {selected.routes?.some(function (route) {
                        return Boolean(route.survey);
                      }) ? (
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>道路支線</th>
                                <th>行車方向</th>
                                <th>與路口關係</th>
                                {selectedVehicleIds.map(function (vehicleKey) {
                                  return (
                                    <th key={vehicleKey}>
                                      {vehicleLabel(selected, vehicleKey)}
                                      （{compositionScopeUnit(selected, "SURVEY").replace("/", "／")}）
                                    </th>
                                  );
                                })}
                                <th>
                                  實際車輛合計（
                                  {compositionScopeUnit(selected, "SURVEY").replace("/", "／")}）
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {surveyDirectionRows(selected)
                                .filter(function (row) {
                                  const code =
                                    row.approach.sourceCode || row.approach.id;
                                  const display =
                                    selected.directionDisplay?.[code] ||
                                    "split";
                                  return display === "two-way"
                                    ? row.relation === "雙向合計"
                                    : row.relation !== "雙向合計";
                                })
                                /*
                                 * ⚠️ 「路口流量視角」在這一張表上是**選列**，
                                 *   不是重算：每一列本來就分成駛出路口／駛入路口
                                 *  （以及雙向合計）。只顯示駛入時就只留駛入那幾列。
                                 *   升級前這個條件在這一頁完全沒有作用（實測）。
                                 *   ⚠️ 「雙向合計」那一列**兩種視角都不留**——
                                 *     它是兩個方向相加，留著會和「只看一個方向」
                                 *     這句話互相矛盾。
                                 */
                                .filter(function (row) {
                                  if (compositionFilters.flowView === "both")
                                    return true;
                                  if (row.relation === "雙向合計") return false;
                                  return compositionFilters.flowView ===
                                    "inbound"
                                    ? row.relation === "駛入路口"
                                    : row.relation === "駛出路口";
                                })
                                .map(function (row, index) {
                                  const total = selectedVehicleIds.reduce(
                                    function (sum, vehicleKey) {
                                      return (
                                        sum +
                                        Number(row.vehicle[vehicleKey] || 0)
                                      );
                                    },
                                    0,
                                  );
                                  return (
                                    <tr
                                      key={
                                        row.approach.id +
                                        "-" +
                                        row.relation +
                                        index
                                      }
                                      className={
                                        row.relation === "雙向合計"
                                          ? "summary-row"
                                          : undefined
                                      }
                                    >
                                      <td>
                                        {row.approach.name}
                                        <br />
                                        <small>
                                          原始代碼 {row.approach.sourceCode}
                                        </small>
                                      </td>
                                      <td>{row.direction}</td>
                                      <td>{row.relation}</td>
                                      {selectedVehicleIds.map(
                                        function (vehicleKey) {
                                          return (
                                            <td key={vehicleKey}>
                                              {Number(
                                                row.vehicle[vehicleKey] || 0,
                                              ).toLocaleString()}
                                            </td>
                                          );
                                        },
                                      )}
                                      <td>{total.toLocaleString()}</td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="empty-inline">
                          此筆是舊版匯入資料，尚未保存各 OD
                          的全時段車種數；請在同計畫、同季度重新匯入原始檔，系統會覆蓋更新並保留既有路口幾何設定。
                        </div>
                      )}
                    </section>
                  ) : null}
                  {/*
                    * ⚠️ 這一塊以前**沒有 id**，所以側欄想列也列不了——
                    *   2026-09-13 盤點時才發現：車種組成分析頁畫面上有這張表，
                    *   小分頁卻一項都沒有（唯一那一項 composition-table
                    *   在多數資料下根本不會出現）。
                    *   列不出來的東西，使用者就不會知道它在哪一頁。
                    */}
                  <section
                    className={focusClass("composition-all", "panel")}
                    id="composition-all"
                  >
                    {/*
                     * ⚠️ 2026-09-18 大檢查 F-18：這一句原本寫「用本頁自己的時段設定，
                     *   不適用主工具列的尖峰時段…資料別」，但表格的列來自 current
                     *   （主工具列的資料別會篩掉列：選假日時整張表變空），時段來自
                     *   compositionFilters.peak——本頁上方那排時段鈕就是主工具列的鏡子，
                     *   主工具列切上午→下午，表格整張從 AM 值換成 PM 值。
                     *   畫面寫「不適用」、數字卻在變，是說謊。現在只保留真的不跟的四項。
                     *   使用者 2026-09-15：「請確保每個圖表都要有各自的不適用說明」。
                     */}
                    {/*
                     * 「上午＋下午並列」：這張表一次只列一個時段（與 viewRecordFor 同一個
                     * 慣例，並列時取上午），數字不會因為切到並列而變——所以要說。
                     */}
                    <InapplicableNote
                      show={compositionFilters.peak === "AMPM"}
                      text="本表一次只列一個時段：主工具列選「上午＋下午並列」時，這裡列的是上午尖峰；要看下午尖峰請把時段切到「下午」。"
                      fields={["peak"]}
                    />
                    <InapplicableNote
                      show={
                        isFiltered(mainFilters, "peakRule") ||
                        isFiltered(mainFilters, "flowView") ||
                        isFiltered(mainFilters, "vehicle") ||
                        isFiltered(mainFilters, "movement")
                      }
                      text="這一塊跨路口並排，不適用主工具列的「尖峰時段判定方式」「路口流量視角」「車種」「轉向別」：車種組成本來就要把全部車種一起列出來才看得出比例；兩種路口視角的總計相同；判定方式與轉向別是路口內各方向的拆法，整個路口的車種合計不受影響。尖峰時段與資料別則跟著主工具列走（本頁上方的時段鈕就是同一份設定）。"
                      fields={["peakRule", "flowView", "vehicle", "movement"]}
                    />
                    <div className="panel-head">
                      <div>
                        <span className="eyebrow">ALL INTERSECTIONS</span>
                        <h2>
                          {showQuarter(quarter)} 各路口{" "}
                          {compositionScope === "SURVEY"
                            ? "全調查時段"
                            : SCOPE_SHORT_LABELS[compositionScope]}{" "}
                          車種組成
                        </h2>
                      </div>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>站號／路口</th>
                            {/*
                              ⚠️ X-35：同一個站號的平日與假日是**兩列**，
                                沒有這一欄就兩列長得一模一樣、分不出誰是誰。
                              ⚠️ 只有一種資料別時**不顯示**——永遠顯示會變成噪音。
                            */}
                            {compositionDayTypes.length > 1 && <th>資料別</th>}
                            {currentVehicleIds.map(function (vehicleKey) {
                              return (
                                <th key={vehicleKey}>
                                  {vehicleLabel(selected, vehicleKey)}（
                                  {[
                                    compositionShowsValue
                                      ? compositionScopeUnit(current, compositionScope)
                                      : null,
                                    compositionShowsPercent ? "%" : null,
                                  ]
                                    .filter(Boolean)
                                    .join("｜")}
                                  ）
                                </th>
                              );
                            })}
                            <th>
                              實際車輛合計（
                              {compositionScopeUnit(current, compositionScope)}
                              ）
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {/*
                            ══════════════════════════════════════════════
                             X-35：一列 ＝ 一筆調查，**不可以靠名稱合併**
                            ══════════════════════════════════════════════

                            使用者 2026-09-16 裁示（依建議執行）。

                            ⚠️ 舊版用的是 `currentCanonicalRecords`——那是先以
                              **路口名稱**去重的結果，而名稱在比對前會把
                              括號內的字整個刪掉（為了吃掉「（三叉路口）」
                              「（修正版）」這類雜訊）。於是同一個交流道的
                              「（北向）」「（南向）」兩個**不同的調查點**
                              變成同一個 key，同站號的平日與假日也是；
                              用的是 Map，**後到的蓋掉先到的**，
                              被蓋掉那幾筆就此消失，畫面上一個字都沒提。

                            ⚠️ 這裡改用 `current`（逐筆）。一筆 ＝ 一個站號 ×
                              一個資料別（匯入時就以「季度＋站號＋資料別」
                              判定同一份調查，所以不會有重複列）。

                            ⚠️ **不可以**順手去改 `recordIntersectionKey`：
                              主工具列的路口清單正是靠它把同一個路口跨季的
                              不同站號合併成一項（X-23）。兩者用途相反——
                              清單要合併、表格要攤開。
                          */}
                          {current.map(function (record) {
                            /* 同一張表裡每一列各自判斷（整季有人算得出來，不代表這一列算得出來）。 */
                            const computable =
                              compositionScope === "SURVEY" ||
                              hasScopeValue(viewRecord(record), compositionScope);
                            const counts = currentVehicleIds.map(
                              function (vehicleKey) {
                                return recordVehicleTotal(
                                  record,
                                  compositionScope,
                                  vehicleKey,
                                );
                              },
                            );
                            const total = counts.reduce(function (sum, value) {
                              return sum + value;
                            }, 0);
                            return (
                              <tr key={record.id}>
                                <td>
                                  <strong>{record.station}</strong>
                                  <br />
                                  <small>{record.name}</small>
                                </td>
                                {compositionDayTypes.length > 1 && (
                                  <td>{record.surveyType}</td>
                                )}
                                {counts.map(function (count, index) {
                                  /*
                                   * ⚠️ 「顯示數值」在這一張表上決定寫輛數、
                                   *   寫百分比、還是兩個都寫。
                                   *   升級前一律兩個都寫，主工具列切了完全沒反應。
                                   * ⚠️ 分母是 0 時百分比寫「－」，不寫 0.0%——
                                   *   0.0% 會被讀成「真的沒有這種車」。
                                   */
                                  const share = total
                                    ? ((count / total) * 100).toFixed(1) + "%"
                                    : "－";
                                  return (
                                    <td key={currentVehicleIds[index]}>
                                      {!computable
                                        ? "－"
                                        : [
                                            compositionShowsValue
                                              ? count.toLocaleString()
                                              : null,
                                            compositionShowsPercent
                                              ? share
                                              : null,
                                          ]
                                            .filter(Boolean)
                                            .join("｜")}
                                    </td>
                                  );
                                })}
                                <td>
                                  {computable ? total.toLocaleString() : "－"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
            </>
          )}

          {view === "inbound" && (
            <>
              {!selected ? (
                renderNoData("尚無可分析的駛入流量資料")
              ) : (
                <>
                  <section className="page-head compact">
                    <div>
                      <span className="eyebrow">INBOUND BRANCH FLOW</span>
                      <h1>駛入／駛出各路口交通量</h1>
                      <p>
                        依系統已確認的道路方位與左／直／右目的支線重新計算；全日資料不足時以「－」表示，不以尖峰時段推估。
                      </p>
                    </div>
                  </section>
                  <section className="diagram-toolbar panel">
                    <label>
                      資料季度
                      <select
                        value={quarter}
                        onChange={function (event) {
                          setQuarter(event.target.value);
                        }}
                      >
                        {quarters.map(function (item) {
                          return (
                            <option key={item} value={item}>
                              {quarterLabel(item)}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      路口
                      <select
                        value={recordIntersectionKey(selected)}
                        onChange={function (event) {
                          setSelectedIntersection(event.target.value);
                        }}
                      >
                        {currentCanonicalRecords.map(function (record) {
                          return (
                            <option
                              key={record.id}
                              value={recordIntersectionKey(record)}
                            >
                              {record.name}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    {selectedIntersectionRecords.length > 1 && (
                      <label>
                        資料別
                        <select
                          value={selected.surveyType || "待設定"}
                          onChange={function (e) {
                            setSelectedSurveyType(e.target.value);
                          }}
                        >
                          {selectedIntersectionRecords.map(function (record) {
                            return (
                              <option
                                key={record.id}
                                value={record.surveyType || "待設定"}
                              >
                                {record.surveyType || "待設定"}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    )}
                    <div className="source-note">
                      {/*
                        ⚠️ v2.1.64 起「不足 24 小時」不再等於「算不出來」。
                        全調查時段就是這份調查涵蓋的時段，4 小時的調查照樣有值；
                        全調查時段尖峰也照樣算得出來。所以這一段要講的是
                        **涵蓋幾小時**（讀者判讀數字最需要的一件事），
                        而不是「不適用」。
                      */}
                      {`本筆調查涵蓋 ${
                        coversFullDay(selected.survey)
                          ? "完整 24 小時"
                          : formatSurveyHours(selected)
                      }；全調查時段與全調查時段尖峰都以這段涵蓋為準。${
                        hasDayPeak(selected)
                          ? ""
                          : "（此筆缺少逐時間格資料，全調查時段尖峰需重新匯入原始檔，欄位以「－」表示，不以尖峰推估。）"
                      }`}
                    </div>
                    {/*
                     * ── 這一頁自己的三個條件 ────────────────────────
                     * 平常是主工具列的鏡子；在這裡改就只有這一張脫離。
                     */}
                    <label>
                      路口流量視角
                      <select
                        data-testid="inbound-flow-view"
                        value={inboundFilters.flowView}
                        onChange={function (event) {
                          changeChartFilter(
                            CHART_INBOUND,
                            "flowView",
                            event.target.value as FlowView,
                          );
                        }}
                      >
                        <option value="both">駛入＋駛出並列</option>
                        <option value="inbound">只顯示駛入</option>
                        <option value="outbound">只顯示駛出</option>
                      </select>
                    </label>
                    <label>
                      車種
                      <select
                        data-testid="inbound-vehicle"
                        value={inboundVehicle}
                        onChange={function (event) {
                          changeChartFilter(
                            CHART_INBOUND,
                            "vehicle",
                            event.target.value,
                          );
                        }}
                      >
                        <option value="all">全部車種</option>
                        {mainVehicleOptions.map(function (entry) {
                          return (
                            <option key={entry[0]} value={entry[0]}>
                              {entry[1]}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      顯示數值
                      <select
                        data-testid="inbound-display"
                        value={inboundFilters.display}
                        onChange={function (event) {
                          changeChartFilter(
                            CHART_INBOUND,
                            "display",
                            event.target.value as DisplayChoice,
                          );
                        }}
                      >
                        <option value="count">車輛數</option>
                        <option value="volume">交通流量</option>
                        <option value="percent">百分比</option>
                        <option value="both">交通流量＋百分比</option>
                        <option value="countPercent">車輛數＋百分比</option>
                      </select>
                    </label>
                  </section>
                  <ChartDetachNote
                    chartId={CHART_INBOUND}
                    detached={isDetached(chartOverrides, CHART_INBOUND)}
                    mainSummary={describeMain(mainFilters, showQuarter, showVehicle)}
                    onReset={function () {
                      setChartOverrides(function (previous) {
                        return resetChart(previous, CHART_INBOUND);
                      });
                    }}
                  />
                  {/*
                   * ⚠️ 這一張表**本來就把四個統計範圍一起列出來**，
                   *   所以「尖峰時段」對它不適用——不是沒接上。
                   *   不寫這一句的話，使用者在主工具列切了時段、
                   *   這一頁一個數字都沒變，只會以為壞了。
                   */}
                  <InapplicableNote
                    show={isFiltered(inboundFilters, "peak")}
                    text={inapplicableNote(
                      "本表固定同時列出上午尖峰、下午尖峰、全調查時段尖峰與全調查時段四欄，不適用「尖峰時段」篩選。",
                      "四個統計範圍全列",
                    )}
                  />
                  {/*
                   * ⚠️ 單一車種在**沒有逐條流向**的舊紀錄上拆不出來，
                   *   那些格子會寫「－」。這一句要講清楚原因，
                   *   否則使用者會以為是這一季沒有那個車種。
                   */}
                  <InapplicableNote
                    show={
                      inboundVehicle !== "all" && !inboundRecord?.routes?.length
                    }
                    text={
                      "這一筆沒有逐條流向資料，拆不到單一車種，本表以「－」表示。" +
                      "要看單一車種請以 v2.1.67 之後的版本重新匯入原始檔。"
                    }
                  />
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <span className="eyebrow">RESULT TABLE</span>
                        <h2>
                          {selected.station} · {selected.name}
                        </h2>
                        <small>
                          {SCOPE_KEYS.map(function (scope) {
                            return `${SCOPE_SHORT_LABELS[scope]}：${scopeWindowLabel(
                              selected,
                              scope,
                            )}`;
                          }).join("；")}
                        </small>
                      </div>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            {/* 這一欄不是「目的路口」：同一列同時放了以這支
                                為終點的駛入量、與以這支為起點的駛出量，寫成
                                目的路口會讓右半邊的駛出欄位看起來方向相反。 */}
                            <th>路口支線／道路支線</th>
                            {inboundShowsPcu &&
                              SCOPE_KEYS.map(function (scope) {
                                return (
                                  <th key={"pcu-" + scope}>
                                    {SCOPE_SHORT_LABELS[scope]} {inboundFlowTitle}
                                    （{scopeUnit(scope, "pcu", inboundCoverage)}）
                                  </th>
                                );
                              })}
                            {inboundShowsCount &&
                              SCOPE_KEYS.map(function (scope) {
                                return (
                                  <th key={"veh-" + scope}>
                                    {SCOPE_SHORT_LABELS[scope]} {inboundFlowTitle}
                                    車輛數（
                                    {scopeUnit(scope, "vehicle", inboundCoverage)}）
                                  </th>
                                );
                              })}
                            {inboundShowsPercent &&
                              SCOPE_KEYS.map(function (scope) {
                                return (
                                  <th key={"pct-" + scope}>
                                    {SCOPE_SHORT_LABELS[scope]} {inboundFlowTitle}
                                    佔路口比例
                                  </th>
                                );
                              })}
                          </tr>
                        </thead>
                        <tbody>
                          {inboundRows.map(function (row) {
                            const label =
                              row.approach.sourceCode || row.approach.id;
                            const format = function (value: number | null) {
                              return value == null
                                ? "－"
                                : value.toLocaleString(undefined, {
                                    maximumFractionDigits: 1,
                                  });
                            };
                            /*
                             * ⚠️ 百分比的分母是**同一個統計範圍、同一個方向**
                             *   的全路口合計。拿別的分母（例如路口總量）
                             *   會讓駛入與駛出兩排各自加起來不等於 100%。
                             *   分母是 0 或算不出來時寫「－」，不寫 0.0%。
                             */
                            const share = function (
                              value: number | null,
                              total: number | null,
                            ) {
                              if (value == null || !total) return "－";
                              return (
                                ((value / total) * 100).toFixed(1) + "%"
                              );
                            };
                            /* 一格裡要寫哪幾行（駛入／駛出／兩者）。 */
                            const lines = function (
                              inboundValue: string,
                              outboundValue: string,
                            ) {
                              const parts = [];
                              if (inboundFilters.flowView !== "outbound")
                                parts.push("駛入 " + inboundValue);
                              if (inboundFilters.flowView !== "inbound")
                                parts.push("駛出 " + outboundValue);
                              return parts.map(function (text, index) {
                                return (
                                  <span key={text + index}>
                                    {index > 0 ? <br /> : null}
                                    {text}
                                  </span>
                                );
                              });
                            };
                            return (
                              <tr key={row.approach.id}>
                                <td>
                                  <strong>路口 {label}</strong>
                                  <br />
                                  <small>{row.approach.name}</small>
                                </td>
                                {inboundShowsPcu &&
                                  SCOPE_KEYS.map(function (scope) {
                                    return (
                                      <td key={"pcu-" + scope}>
                                        {lines(
                                          format(row.inbound[scope].pcu),
                                          format(row.outbound[scope].pcu),
                                        )}
                                      </td>
                                    );
                                  })}
                                {inboundShowsCount &&
                                  SCOPE_KEYS.map(function (scope) {
                                    return (
                                      <td key={"veh-" + scope}>
                                        {lines(
                                          format(row.inbound[scope].vehicles),
                                          format(row.outbound[scope].vehicles),
                                        )}
                                      </td>
                                    );
                                  })}
                                {inboundShowsPercent &&
                                  SCOPE_KEYS.map(function (scope) {
                                    const useCount =
                                      inboundFilters.display === "countPercent";
                                    return (
                                      <td key={"pct-" + scope}>
                                        {lines(
                                          share(
                                            useCount
                                              ? row.inbound[scope].vehicles
                                              : row.inbound[scope].pcu,
                                            useCount
                                              ? inboundTotals[scope].inboundVehicles
                                              : inboundTotals[scope].inboundPcu,
                                          ),
                                          share(
                                            useCount
                                              ? row.outbound[scope].vehicles
                                              : row.outbound[scope].pcu,
                                            useCount
                                              ? inboundTotals[scope].outboundVehicles
                                              : inboundTotals[scope].outboundPcu,
                                          ),
                                        )}
                                      </td>
                                    );
                                  })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="source-note">
                      判定原則：駛入路口X＝其他支線開往X的車；駛出路口X＝從X開往其他支線的車。同一統計範圍內，各支線的駛入合計與駛出合計應相等，也等於該路口總量；若有未分配流向，「資料維護」的資料異常檢查將提示差異，不採用外部計算表的漏算結果。
                    </div>
                  </section>
                </>
              )}
            </>
          )}

          {view === "diagram" && (
            <>
              {!selected ? (
                renderNoData("尚無可繪製路口")
              ) : (
                <>
                  <section className="page-head compact">
                    <div>
                      <span className="eyebrow">TURNING MOVEMENT DIAGRAM</span>
                      <h1>正式轉向圖</h1>
                      <p>
                        正式版：流量表搭配完整跨路口箭線；聚焦版逐一顯示左／直／右目的支線。
                      </p>
                    </div>
                    <div className="head-buttons">
                      <button className="secondary" onClick={exportSvg}>
                        SVG
                      </button>
                      <button
                        className="secondary"
                        data-chart-png="diagram"
                        onClick={exportPng}
                        title="以 3 倍解析度重新繪製後下載；圖上只有圖，不含說明文字"
                      >
                        PNG
                      </button>
                      <button
                        className="primary"
                        onClick={function () {
                          exportPdf();
                        }}
                      >
                        PDF
                      </button>
                    </div>
                  </section>
                  {/*
                   * ⚠️ 這一頁的「時段／藍框流量顯示／顯示／車種」改的是**這一張圖自己**。
                   *   改了就脫離主工具列，這一條說明會寫出主工具列現在是什麼，
                   *   並給一顆回歸鈕；沒脫離時整塊不出現（元件自己判斷）。
                   */}
                  <ChartDetachNote
                    chartId={CHART_DIAGRAM}
                    detached={isDetached(chartOverrides, CHART_DIAGRAM)}
                    mainSummary={describeMain(mainFilters, showQuarter, showVehicle)}
                    onReset={function () {
                      setChartOverrides(function (previous) {
                        return resetChart(previous, CHART_DIAGRAM);
                      });
                    }}
                  />
                  {/*
                   * ⚠️ 一張圖是一個路口、一個時段，畫不出「上午＋下午並列」。
                   *   不可以默默只畫上午——使用者會以為那就是並列的結果。
                   */}
                  <InapplicableNote
                    show={diagramFilters.peak === "AMPM"}
                    text={inapplicableNote(
                      "轉向圖一次只畫得了一個時段：它是一個路口一張圖，上午與下午並列會變成兩張圖疊在同一個版面上。",
                      "上午尖峰",
                    )}
                  />
                  {/*
                   * ⚠️ 「資料別：平日＋假日並列」同理——一張圖畫不了兩份資料。
                   *   目前畫的是主工具列選到的那一筆（平日優先），這裡明講。
                   */}
                  {/*
                   * ⚠️ 用 chose() 不是直接比值：甲案之後「並列」就是**預設值**，
                   *   直接比值等於恆真，這一句會變成每一次都掛在畫面上的噪音
                   *   ——而規則是「只在真的篩了那個條件時才出現」。
                   */}
                  <InapplicableNote
                    show={chose(diagramFilters, "day", "side-by-side")}
                    text={inapplicableNote(
                      "轉向圖一次只畫得了一筆調查資料：平日與假日並列會變成兩張圖疊在同一個版面上。",
                      "上方「資料別」選到的那一筆",
                    )}
                  />
                  {/*
                   * ⚠️ 「各方向各自認定」下，圖上各支線的量**不在同一小時**，
                   *   所以圖中央那一格總計不是各支線相加。這一點一定要寫出來，
                   *   不然使用者會拿圖上的數字自己相加、再說我們算錯。
                   */}
                  <InapplicableNote
                    show={mainFilters.peakRule === "direction"}
                    text={
                      "目前是「各方向各自認定」：圖上每一條支線畫的是它自己最忙的那一小時，" +
                      "各支線不在同一個小時，因此「不可以把各支線相加」去核對中央的總計。" +
                      "要相加請切回「整個調查點同一時段」。"
                    }
                  />
                  <section className="diagram-toolbar panel">
                    <label>
                      資料季度
                      <select
                        value={quarter}
                        onChange={function (e) {
                          setQuarter(e.target.value);
                          setFocusIndex(0);
                        }}
                      >
                        {quarters.map(function (q) {
                          return (
                            <option key={q} value={q}>
                              {quarterLabel(q)}（
                              {
                                projectRecords.filter(function (record) {
                                  return record.quarter === q;
                                }).length
                              }{" "}
                              路口）
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      路口
                      <select
                        /*
                         * ⚠️ 這個 testid 是給守門用的，**不可以拿掉**。
                         *   e2e-diagram-bounds 要挑「路口」那一個下拉，
                         *   而它原本靠「選項文字裡有沒有『路口』兩個字」去認——
                         *   結果認到旁邊的「路口流量視角」下拉
                         *  （選項是「駛出路口（以該支線為起點）」，也含「路口」）。
                         *   於是那一支從頭到尾量的都是顯示模式、不是路口，
                         *   而它照樣全綠（2026-09-15 查到）。
                         */
                        data-testid="diagram-intersection"
                        value={recordIntersectionKey(selected)}
                        onChange={function (e) {
                          setSelectedIntersection(e.target.value);
                          setFocusIndex(0);
                        }}
                      >
                        {currentCanonicalRecords.map(function (record) {
                          return (
                            <option
                              key={record.id}
                              value={recordIntersectionKey(record)}
                            >
                              {record.name}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    {selectedIntersectionRecords.length > 1 && (
                      <label>
                        資料別
                        <select
                          value={selected.surveyType || "待設定"}
                          onChange={function (e) {
                            setSelectedSurveyType(e.target.value);
                            setFocusIndex(0);
                          }}
                        >
                          {selectedIntersectionRecords.map(function (record) {
                            return (
                              <option
                                key={record.id}
                                value={record.surveyType || "待設定"}
                              >
                                {record.surveyType || "待設定"}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    )}
                    <label>
                      時段
                      <select
                        value={diagramPeak}
                        onChange={function (e) {
                          changeChartFilter(
                            CHART_DIAGRAM,
                            "peak",
                            e.target.value as ScopeKey,
                          );
                        }}
                      >
                        {SCOPE_KEYS.map(function (key) {
                          /*
                           * 某些時段算不出來時，選項照樣列出來（不然使用者
                           * 不知道有這個功能），但選不下去，並在後面寫出為什麼。
                           *
                           * ⚠️ 原本這裡寫「全日尖峰小時與全日時段要有 24 小時
                           *   的調查資料才算得出來」，用的是 v2.1.64 之前的
                           *   舊時段名，而且那條 24 小時規則早就不成立：
                           *   `fullDayUnavailableReason()` 對 FULL 只在
                           *   「沒有記錄調查時數」時才回原因，DAY 自 v2.1.64
                           *   起也不要求 24 小時。註解就貼在呼叫它的那一行上面，
                           *   照它去改會把正確的行為改回錯的。
                           *   （2026-09-25 第五輪複查更正。）
                           */
                          const reason = selected
                            ? fullDayUnavailableReason(selected, key)
                            : null;
                          return (
                            <option
                              key={key}
                              value={key}
                              disabled={Boolean(reason)}
                            >
                              {SCOPE_LABELS[key]}
                              {reason ? `（${reason}）` : ""}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      版型
                      <select
                        value={diagramStyle}
                        onChange={function (e) {
                          setDiagramStyle(e.target.value as DiagramStyle);
                        }}
                      >
                        <option value="formal">正式版</option>
                        <option value="standard">標準版</option>
                        <option value="simple">簡潔版</option>
                      </select>
                    </label>
                    <label>
                      箭線
                      <select
                        value={arrowMode}
                        onChange={function (e) {
                          setArrowMode(e.target.value as ArrowMode);
                        }}
                      >
                        <option value="all">全部方向</option>
                        <option value="focus">單一方向聚焦</option>
                      </select>
                    </label>
                    {arrowMode === "focus" && (
                      <label>
                        聚焦支線
                        <select
                          value={focusIndex}
                          onChange={function (e) {
                            setFocusIndex(Number(e.target.value));
                          }}
                        >
                          {selected.approaches.map(function (a, i) {
                            return (
                              <option key={a.id} value={i}>
                                {bearingFromAngle(a.angle)}向 · {a.name}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    )}
                    <div className="flow-summary-control">
                      <span>藍框流量顯示</span>
                      <Segmented
                        value={diagramFlow}
                        options={[
                          ["both", "駛入＋駛出"],
                          ["inbound", "只顯示駛入"],
                          ["outbound", "只顯示駛出"],
                        ]}
                        onChange={function (value: FlowSummaryMode) {
                          changeChartFilter(CHART_DIAGRAM, "flowView", value);
                        }}
                      />
                    </div>
                    <label>
                      顯示
                      <select
                        value={diagramDisplay}
                        onChange={function (e) {
                          changeChartFilter(
                            CHART_DIAGRAM,
                            "display",
                            e.target.value as DisplayMode,
                          );
                        }}
                      >
                        {/*
                          * ⚠️ 這幾個選項的單位**必須傳 coverage**，
                          *   和轉向圖抬頭（scopeUnit(diagramPeak, kind,
                          *   coverageOf(diagramRecord))）走同一個判斷。
                          *
                          *   不傳的話 coverage 是 "unknown"，於是
                          *   scope === "FULL" 時選單恆寫「PCU/調查時段」，
                          *   而同一頁的圖面對滿 24 小時的檔寫「PCU/調查日」
                          *   ——同一頁對同一批資料印出兩種單位。
                          *   規則是「單位的唯一來源是 scopeUnit()」，三處都
                          *   呼叫了同一支，但傳的參數不同，規則字面過關、
                          *   畫面仍然不一致。（2026-09-25 第五輪複查抓到。）
                          */}
                        <option value="volume">
                          交通量（{scopeUnit(diagramPeak, "pcu", coverageOf(diagramRecord))}）
                        </option>
                        <option value="count">
                          車輛數（{scopeUnit(diagramPeak, "vehicle", coverageOf(diagramRecord))}）
                        </option>
                        <option value="percent">百分比</option>
                        <option value="both">
                          {scopeUnit(diagramPeak, "pcu", coverageOf(diagramRecord))}＋百分比
                        </option>
                        <option value="countPercent">
                          {scopeUnit(diagramPeak, "vehicle", coverageOf(diagramRecord))}＋百分比
                        </option>
                      </select>
                    </label>
                    <label>
                      車種
                      <select
                        value={diagramVehicle}
                        onChange={function (e) {
                          changeChartFilter(
                            CHART_DIAGRAM,
                            "vehicle",
                            e.target.value as VehicleKey,
                          );
                        }}
                      >
                        {[
                          ["all", "全部車種"],
                          ...selectedVehicleIds.map(function (id) {
                            return [id, vehicleLabel(selected, id)];
                          }),
                        ].map(function (entry) {
                          return (
                            <option key={entry[0]} value={entry[0]}>
                              {entry[1]}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  </section>
                  <section className="diagram-layout">
                    {/*
                     * ══════════════════════════════════════════════════
                     *  「放大到原尺寸」：只在真的放不下時才出現
                     * ══════════════════════════════════════════════════
                     *
                     * 使用者 2026-09-12（附截圖）：七岔路口時畫布比容器寬，
                     * 「請讓路口轉向圖分頁中的圖案，不要依靠捲動，直接能在
                     *   畫面一眼看到成果，避免使用者以為被裁切到了」。
                     *
                     * ⚠️ 這和他 9/11 指定的「中央路口方塊不要因為支線變多
                     *   而縮小」**直接衝突**：要維持中央方塊一樣大，七岔就
                     *   必須畫得比容器寬，一定要捲動。兩者在目前的容器寬度
                     *   下沒辦法同時成立。
                     *
                     * 他選的作法：預設**整張看得到**（不捲動），另外給一顆
                     * 放大鈕；而且「平常路口不大時可以正常顯示圖，那這個
                     * 按鈕就不要顯示出來」——所以只有在**真的放不下**
                     *（diagramScale.w > 1）時才渲染這一顆。
                     */}
                    {diagramScale.w > 1.01 && (
                      <div className="diagram-zoom">
                        <button
                          type="button"
                          className={diagramZoom ? "active" : "secondary"}
                          onClick={function () {
                            setDiagramZoom(!diagramZoom);
                          }}
                        >
                          {diagramZoom ? "縮回整張看得到" : "放大到原尺寸"}
                        </button>
                        <small>
                          {/*
                            * ⚠️ 這三句都以**量到的** diagramOverflow 為準，
                            *   不可以改回用 diagramScale 推論——見它的說明。
                            */}
                          {diagramZoom
                            ? "目前是原尺寸：中央路口方塊與十字路口一樣大，但整張圖比畫面寬，要左右捲動。"
                            : diagramOverflow > 2
                              ? `⚠️ 目前這個視窗寬度放不下整張圖，超出視窗約 ${diagramOverflow} 像素，要左右捲動才看得到。把瀏覽器視窗拉寬，或按「縮回整張看得到」，就能一次看完。`
                              : "目前整張圖都看得到（沒有被裁切）。這個路口支線較多，所以中央方塊比十字路口小一些；要一樣大請按「放大到原尺寸」。"}
                        </small>
                      </div>
                    )}
                    <article
                      ref={diagramBoxRef}
                      className="panel diagram-canvas"
                      /*
                       * 顯示比例交給 CSS 變數，樣式規則只寫一次。
                       * 直接在這裡寫 inline width 的話，響應式那幾段
                       * （手機版的 min-width）會被 inline 樣式壓過去。
                       */
                      style={
                        {
                          /* 預設 1（整張看得到）；按了放大才套用原尺寸比例。 */
                          "--canvas-scale": diagramZoom ? diagramScale.w : 1,
                          "--canvas-scale-h": diagramZoom ? diagramScale.h : 1,
                          /*
                           * ⚠️ 沒有放大時**一定要把 SVG 的寬度下限拿掉**。
                           *
                           *   2026-09-13 用使用者的真實七叉檔重現到：
                           *   螢幕 1440px 以下時面板可視寬只有 838／764／678px，
                           *   而 CSS 的 `min-width: 880px` 把 SVG 釘在 880px，
                           *   右邊整排圖卡（駛入／駛出 B、C、D）直接看不到——
                           *   偏偏旁邊那一行小字還寫著「整張圖都看得到
                           *  （沒有被裁切）」，因為它只看 diagramScale，
                           *   不知道有這個下限。系統等於在講一句不實的話。
                           *
                           *   使用者 2026-09-12 指定「不要依靠捲動，直接能在
                           *   畫面一眼看到成果」，所以預設就是要放得下；
                           *   要放大看清楚是「放大到原尺寸」那顆按鈕的事，
                           *   那時候才恢復下限、也才需要左右捲動。
                           */
                          "--canvas-min-width": diagramZoom ? "" : "0px",
                        } as React.CSSProperties
                      }
                      onPointerDown={function (
                        event: ReactPointerEvent<HTMLElement>,
                      ) {
                        startCardDrag(event, diagramFlow);
                      }}
                      dangerouslySetInnerHTML={{
                        __html: diagramHtml,
                      }}
                    />
                    <aside>
                      <article className="panel summary-card">
                        <span className="eyebrow">SELECTED</span>
                        <h2>{selected.name}</h2>
                        <p>
                          資料季度 {showQuarter(selected.quarter)} · 原始站號{" "}
                          {selected.station}
                        </p>
                        <dl>
                          <div>
                            <dt>
                              {diagramPeak === "FULL" ? "調查時段" : "尖峰時段"}
                            </dt>
                            <dd>
                              {scopeWindowLabel(diagramRecord, diagramPeak)}
                            </dd>
                          </div>
                          <div>
                            <dt>
                              {diagramVehicle === "all"
                                ? "路口總流量"
                                : vehicleLabel(selected, diagramVehicle) +
                                  "流量"}
                            </dt>
                            <dd>
                              {summary.value.toLocaleString()}{" "}
                              <small>{summary.unit}</small>
                              {summary.isBase && <small>（＝100%）</small>}
                            </dd>
                          </div>
                          {diagramVehicle !== "all" && summary.share !== null && (
                            <div>
                              <dt>占路口總量</dt>
                              <dd>{summary.share.toFixed(1)}%</dd>
                            </div>
                          )}
                          {summary.breakdown.length > 0 && (
                            <div className="summary-breakdown">
                              <dt>車種組成</dt>
                              <dd>
                                <ul>
                                  {summary.breakdown.map(function (item) {
                                    return (
                                      <li key={item.id}>
                                        <span>{item.label}</span>
                                        {summary.showsValue && (
                                          <b>
                                            {item.value.toLocaleString()}{" "}
                                            {summary.unit}
                                          </b>
                                        )}
                                        <i>{item.percent.toFixed(1)}%</i>
                                      </li>
                                    );
                                  })}
                                </ul>
                                {/*
                                  ⚠️ 占比逐項各自四捨五入到小數第 1 位，所以這一串
                                    加起來不一定剛好 100%（三項各 1/3 會是
                                    33.3＋33.3＋33.3＝99.9）。這張卡會被抄進正式報告，
                                    審查時一定有人把它加起來，所以要先說。
                                    刻意不把差額塞給任何一項——塞了之後那一項的占比
                                    就對不上它自己的數值÷總量，讀者自己驗算會更困惑。
                                */}
                                <small className="summary-rounding">
                                  各項占比分別四捨五入到小數第 1
                                  位，加起來可能不等於 100%（差額不塞給任何一項，
                                  每一項都對得上它自己的數值÷總量）。
                                </small>
                              </dd>
                            </div>
                          )}
                          <div>
                            <dt>道路支線</dt>
                            <dd>{selected.approaches.length} 叉</dd>
                          </div>
                        </dl>
                        {!summary.reconciled && (
                          <p className="summary-warning">
                            ⚠️ 這一筆的車種明細對不起來：{summary.reason}。
                            單一車種的 PCU 是用匯入當時的轉向當量、依實際流向現算的；
                            對不起來時<b>請不要直接引用單一車種的數字</b>，
                            先到「流量核對工作台」確認這一筆的流向與車種資料。
                            路口總量不受影響。
                          </p>
                        )}
                        {/*
                          此處原有一句寫死的「本系統只彙整尖峰轉向流量。」已移除。
                          同一頁的時段選單就提供「全調查時段尖峰」與「全調查時段」，
                          而且上方已有一句會依該筆資料涵蓋時數變動的正確說明，
                          兩者並存會自相矛盾（滿 24 小時的資料上面說可算全日、
                          下面說只有尖峰）。系統目前也不只彙整轉向流量。
                        */}
                      </article>
                    </aside>
                  </section>
                </>
              )}
            </>
          )}

          {view === "geometry" && (
            <>
              {!geometrySelected ? (
                renderNoData("尚無道路支線資料")
              ) : (
                <>
                  <section className="page-head">
                    <div>
                      <span className="eyebrow">GEOMETRY & FLOW</span>
                      <h1>道路與流向幾何管理</h1>
                      <p>
                        道路名稱、支線角度與實體車道組成只用於正確繪製轉向圖，不進行容量相關計算。
                      </p>
                      {/*
                       * ⚠️ 這一頁設定的是路口**幾何**（支線名稱與角度），
                       *   與車種、轉向別、顯示數值無關。
                       *   下面的交通量圖卡預覽有它自己的一組條件（見那一塊）。
                       */}
                      {/*
                       * ⚠️ X-64：路口與資料別也要列進來。
                       *   這一頁是設定頁，有自己的「圖面季度」與「切換路口」；
                       *   讓主工具列的路口決定「你能不能編輯哪一個路口」是錯的規則
                       *   （勾了別季的站號就整個下拉空掉，連換都換不了）。
                       */}
                      {unusedConditionsNote(
                        ["vehicle", "movement", "display", "intersections", "day"],
                        "這一頁設定的是路口幾何（支線名稱、角度與車道組成），與車種、轉向別、顯示數值無關；要改哪一個路口請用右上角的「圖面季度」與「切換路口」，不受主工具列的「路口」與「資料別」影響。",
                      )}
                      {/*
                       * ⚠️ 「路口流量視角」在這一頁**只作用在交通量圖卡預覽**，
                       *   而那一塊預設是關起來的。不講的話，使用者在主工具列
                       *   切了視角、這一頁一個數字都沒變，只會以為壞了。
                       */}
                      {(isFiltered(mainFilters, "flowView") ||
                        isFiltered(mainFilters, "peak")) &&
                        !showGeometryCardPreview && (
                          <p
                            className="chart-inapplicable"
                            data-testid="chart-inapplicable"
                          >
                            「路口流量視角」與「尖峰時段」在這一頁只作用在下方的
                            「交通量圖卡排版預覽」，請先按「開啟圖卡排版預覽」。
                            這一頁其餘的內容是路口幾何設定（支線名稱、角度與車道組成），
                            與時段和流量方向無關。
                          </p>
                        )}
                    </div>
                    <div className="head-buttons">
                      <label>
                        圖面季度
                        <select
                          value={quarter}
                          onChange={function (e) {
                            setQuarter(e.target.value);
                          }}
                        >
                          {quarters.map(function (q) {
                            return (
                              <option key={q} value={q}>
                                {quarterLabel(q)}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <label>
                        切換路口
                        <select
                          value={recordIntersectionKey(geometrySelected)}
                          onChange={function (e) {
                            setSelectedIntersection(e.target.value);
                          }}
                        >
                          {/*
                           * ⚠️ X-64：用**不吃主工具列**的那一份（見
                           *   geometryIntersectionOptions 上方的長註解）。
                           *   用 currentCanonicalRecords 的話，主工具列勾了
                           *   別季的站號時這個下拉會整個空掉，
                           *   使用者連換一個路口都做不到。
                           */}
                          {geometryIntersectionOptions.map(function (record) {
                            return (
                              <option
                                key={record.id}
                                value={recordIntersectionKey(record)}
                              >
                                {record.name}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      {geometrySelectedRecords.length > 1 && (
                        <label>
                          資料別
                          <select
                            value={geometrySelected.surveyType || "待設定"}
                            onChange={function (e) {
                              setSelectedSurveyType(e.target.value);
                            }}
                          >
                            {geometrySelectedRecords.map(function (record) {
                              return (
                                <option
                                  key={record.id}
                                  value={record.surveyType || "待設定"}
                                >
                                  {record.surveyType || "待設定"}
                                </option>
                              );
                            })}
                          </select>
                        </label>
                      )}
                      <button
                        className="primary"
                        disabled={
                          geometrySelected.approaches.length >= MANUAL_ARM_LIMIT
                        }
                        title={
                          geometrySelected.approaches.length >= MANUAL_ARM_LIMIT
                            ? `已達手動新增的上限（${MANUAL_ARM_LIMIT} 條支線）。匯入不受這個上限限制，調查表有幾支就讀幾支。`
                            : undefined
                        }
                        onClick={function () {
                          updateSelected(function (record) {
                            const i = record.approaches.length;
                            // 序號不能直接用支線數量：新增到第 5 支、再把中間
                            // 某一支刪掉之後，數量又回到 4，下次新增就再產生一
                            // 次 -A5／人工5，跟既有那一支撞號。撞號的後果是跨季
                            // 度同步會把兩支併成一支。所以往上找第一個沒被用過
                            // 的序號。
                            const usedIds = new Set(
                              record.approaches.map(function (approach) {
                                return approach.id;
                              }),
                            );
                            const usedCodes = new Set(
                              record.approaches.map(function (approach) {
                                return approach.sourceCode;
                              }),
                            );
                            let seq = i + 1;
                            while (
                              usedIds.has(record.station + "-A" + seq) ||
                              usedCodes.has("人工" + seq)
                            )
                              seq += 1;
                            record.approaches.push({
                              ...structuredClone(record.approaches[0]),
                              id: record.station + "-A" + seq,
                              // 每條人工支線要有自己的代碼；全部叫「人工」的話，
                              // 跨季度同步是用代碼比對的，會把好幾條支線併成同一條。
                              sourceCode: "人工" + seq,
                              name: "新增支線 " + seq,
                              // 不要沿用第一條支線的交通量與版面，否則新支線會
                              // 直接頂著別人的數字、圖卡也疊在同一個位置。
                              movements: emptyScopeMovements(),
                              cardOffset: undefined,
                              cardOffsets: undefined,
                              labelOffset: undefined,
                              cardLayouts: undefined,
                              angle: -90 + (i * 360) / (i + 1),
                              bearing: bearingFromAngle(
                                -90 + (i * 360) / (i + 1),
                              ),
                              lanes: null,
                              laneType: "other",
                              laneComposition: {
                                fast: 0,
                                slow: 0,
                                motorcycle: 0,
                                other: 0,
                              },
                              saturationFlow: null,
                              effectiveGreen: null,
                              cycleLength: null,
                              capacity: null,
                            });
                            return record;
                          });
                        }}
                      >
                        ＋ 新增支線
                      </button>
                      {/*
                        * 使用者要求把上限寫在按鈕旁邊，不要等按不動了才發現。
                        * ⚠️ 文案要短——他明說「不用這麼長」。
                        * 「匯入不受此限、調查表有幾支就讀幾支」改寫進新手手冊，
                        * 不放在畫面上。
                        */}
                      <small className="field-note arm-limit-note">
                        手動最多 {MANUAL_ARM_LIMIT} 條支線（目前{" "}
                        {geometrySelected.approaches.length} 條）
                      </small>
                    </div>
                  </section>
                  <section className="geometry-layout">
                    {/*
                      * ⚠️ 這張卡的標題是路口名稱（動態的），以前沒有 id，
                      *   側欄因此列不出來——2026-09-13 逐頁盤點才發現。
                      *   小分頁的名字用固定的「支線與流向設定」，不用路口名：
                      *   側欄上的字不該隨著選了哪個路口而變。
                      */}
                    <article
                      className={focusClass("geometry-approaches", "panel")}
                      id="geometry-approaches"
                    >
                      <div className="panel-head">
                        <div>
                          <h2>{geometrySelected.name}</h2>
                          <small>
                            資料季度 {showQuarter(geometrySelected.quarter)} · 原始站號{" "}
                            {geometrySelected.station}
                          </small>
                        </div>
                        <span className="status-dot">
                          {geometrySelected.approaches.length} 叉
                        </span>
                      </div>
                      <div className="geometry-list geometry-expanded">
                        {geometrySelected.approaches.map(function (approach, index) {
                          const sourceCode =
                            approach.sourceCode ||
                            approach.id.match(/-([A-Z0-9]+)$/i)?.[1] ||
                            String(index + 1);
                          return (
                            <div key={approach.id}>
                              <b title={"原始資料代碼 " + sourceCode}>
                                {sourceCode}
                              </b>
                              <label>
                                道路支線
                                <input
                                  value={approach.name}
                                  onChange={function (e) {
                                    updateSelectedGeometry(function (record) {
                                      record.approaches[index].name =
                                        e.target.value;
                                      return record;
                                    });
                                  }}
                                />
                                <small>
                                  原始資料代碼：{sourceCode}
                                  ；修改名稱或角度不會改變資料綁定
                                </small>
                              </label>
                              <label>
                                方位
                                <output className="derived-bearing">
                                  {bearingFromAngle(approach.angle)}（自動）
                                </output>
                              </label>
                              <label>
                                角度（°）
                                {/*
                                  ⚠️ **不要改回 `<input type="number" value={數字}>`。**
                                    那個寫法在使用者把欄位按到空的那一刻，
                                    `Number("")===0` 會把 0 寫回欄位、游標被推到最前面，
                                    後面打的字全部接在 0 後面（090、045、1809）。
                                    使用者 2026-09-21 形容成「集體無法輸入除了 0 以外的數字」，
                                    而且他一開始以為是「兩個角度設成一樣」造成的保護機制——
                                    不是，那是純粹的輸入 bug。詳見 lib/number-field.tsx。
                                */}
                                <NumberField
                                  value={approach.angle}
                                  step={1}
                                  min={-180}
                                  max={360}
                                  testId={`arm-angle-${index}`}
                                  ariaLabel={`${approach.name} 角度`}
                                  onCommit={function (next) {
                                    updateSelectedGeometry(function (record) {
                                      record.approaches[index].angle = next;
                                      record.approaches[index].bearing =
                                        bearingFromAngle(
                                          record.approaches[index].angle,
                                        );
                                      return syncRouteGeometry(record);
                                    });
                                  }}
                                  /*
                                   * ⚠️ 兩條支線角度相同的提醒放在**這裡**，
                                   *   不放進「資料異常檢查」。理由：這是設定當下
                                   *   就看得見、也只有當下改得動的事，而資料異常
                                   *   檢查講的是「匯進來的資料本身有問題」。
                                   *   混在一起會讓異常清單長出一堆「其實是設定」
                                   *   的項目，使用者按確認也消不掉。
                                   */
                                  warn={function (value) {
                                    const clash = geometrySelected.approaches
                                      .filter(function (other, otherIndex) {
                                        return (
                                          otherIndex !== index &&
                                          ((Number(other.angle) % 360) + 360) % 360 ===
                                            ((value % 360) + 360) % 360
                                        );
                                      })
                                      .map(function (other) {
                                        return other.name;
                                      });
                                    return clash.length
                                      ? `與 ${clash.join("、")} 的角度相同，轉向圖上這幾條會完全疊在一起，請確認是不是還沒改。`
                                      : null;
                                  }}
                                  hint="畫面上方 -90、右方 0、下方 90、左方 180"
                                />
                              </label>
                              <div className="card-position-field">
                                <span>數據卡位置</span>
                                <span className="card-position-state">
                                  {adjustedLayoutModes(approach).length
                                    ? "已調整：" +
                                      adjustedLayoutModes(approach).join("、")
                                    : hasManualLayout(approach)
                                      ? "已手動調整"
                                      : "自動排版"}
                                </span>
                                <button
                                  className="link-button"
                                  disabled={!hasManualLayout(approach)}
                                  onClick={function () {
                                    updateSelectedGeometry(function (record) {
                                      record.approaches[index].cardOffset =
                                        undefined;
                                      record.approaches[index].cardOffsets =
                                        undefined;
                                      record.approaches[index].labelOffset =
                                        undefined;
                                      record.approaches[index].cardLayouts =
                                        undefined;
                                      return record;
                                    });
                                  }}
                                >
                                  還原這條支線
                                </button>
                              </div>
                              <button
                                className="icon-danger"
                                disabled={geometrySelected.approaches.length <= 3}
                                onClick={function () {
                                  // 刪掉支線之後，原本以這支為起點或終點的 OD
                                  // 路徑如果留著，就會變成指向不存在的支線的孤
                                  // 兒資料：合計仍算得到數字，但駛入總和與駛出
                                  // 總和從此對不起來。所以要一併清掉，並先讓使
                                  // 用者知道會連帶損失多少筆流量。
                                  const target = geometrySelected.approaches[index];
                                  const orphans = (
                                    geometrySelected.routes || []
                                  ).filter(function (route) {
                                    return (
                                      route.fromApproachId === target.id ||
                                      route.toApproachId === target.id
                                    );
                                  });
                                  if (
                                    orphans.length &&
                                    !confirm(
                                      "刪除支線「" +
                                        (target.name || target.sourceCode) +
                                        "」會一併刪除 " +
                                        orphans.length +
                                        " 筆與它相連的轉向流量，且無法復原。確定要刪除嗎？",
                                    )
                                  )
                                    return;
                                  updateSelected(function (record) {
                                    const removed = record.approaches.splice(
                                      index,
                                      1,
                                    )[0];
                                    if (removed)
                                      record.routes = (
                                        record.routes || []
                                      ).filter(function (route) {
                                        return (
                                          route.fromApproachId !== removed.id &&
                                          route.toApproachId !== removed.id
                                        );
                                      });
                                    /*
                                     * 一定要重算 approaches 的左／直／右。
                                     *
                                     * 刪掉孤兒 OD 之後，其他支線的 movements
                                     * 裡還留著「開往被刪支線」的那些量。
                                     * recordTotal() 讀的正是 movements，所以
                                     * 儀表板、排名、轉向圖與每一張 Excel 都會
                                     * 多出一筆憑空的流量（實測核對差值
                                     * 1,095.6 PCU/hr），而資料品質檢查卻報
                                     *「沒有異常」。
                                     */
                                    return syncRouteTotals(record);
                                  });
                                }}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <div className="geometry-tools">
                        <button
                          className={showGeometryCardPreview ? "primary" : ""}
                          onClick={function () {
                            setShowGeometryCardPreview(function (value) {
                              return !value;
                            });
                          }}
                        >
                          {showGeometryCardPreview
                            ? "關閉圖卡排版預覽"
                            : "開啟圖卡排版預覽"}
                        </button>
                        <button
                          onClick={function () {
                            updateSelectedGeometry(function (record) {
                              record.approaches.forEach(function (approach) {
                                approach.cardOffset = undefined;
                                approach.cardOffsets = undefined;
                                approach.labelOffset = undefined;
                                approach.cardLayouts = undefined;
                              });
                              return record;
                            });
                          }}
                        >
                          重設所有圖卡位置（全部模式）
                        </button>
                        <span>
                          圖卡與路口標籤都可直接用滑鼠拖曳，放開才會存檔；
                          <b>
                            只看駛入、只看駛出、駛入＋駛出三種畫面各自保存版面
                          </b>
                          ，調整後會同步至其他季度。
                        </span>
                      </div>
                      {collisionWarnings.length > 0 && (
                        <div className="collision-warning">
                          <b>匯出前排版預警（不影響匯出）</b>
                          {collisionWarnings.map(function (warning) {
                            return <p key={warning}>{warning}</p>;
                          })}
                        </div>
                      )}
                      {geometrySelected.routes?.length ? (
                        <details className="route-mapping">
                          <summary>
                            檢查起點 → 終點流向（{geometrySelected.routes.length} 組）
                          </summary>
                          <p>
                            七岔路依原始檔的 A→B、A→C…建立。調整 A～G
                            支線角度不會改變原始起訖流量。新多岔路先由系統依幾何提出左／直／右建議，分類方式會列在此處供確認。
                          </p>
                          {geometrySelected.movementRule === "reference-calculation" ? (
                            <p className="inline-note">
                              本路口（{geometrySelected.station} {geometrySelected.name}）的名稱與七支支線代碼
                              A～G 與內建的參考計算檔相符，因此套用該檔的既有分法（D
                              支線沒有直行流向），<b>而不是依圖面角度推算</b>。
                              調整圖面角度不會覆蓋此分類；若這不是您要的分法，
                              請在下方逐條改成正確的轉向別——改過之後會轉為「人工確認分類」，
                              日後重新整理也不會再被參考表改回去。
                            </p>
                          ) : geometrySelected.movementRule === "manual" ? (
                            <p className="inline-note">
                              本路口採人工確認分類；調整圖面角度不會覆蓋。
                            </p>
                          ) : (
                            <p className="inline-note">
                              本路口目前採系統幾何建議，請逐列確認後再使用正式成果。
                            </p>
                          )}
                          {/*
                            * ── 依起點路口分組、各自展開收合 ──────────────────
                            *
                            * 使用者 2026-09-14：
                            *   「做的很好，只是把所有路口都做在同一畫面，容易看眼花，
                            *     表單內容的格式不用變動，只需幫我做好如同全日交通量
                            *     對於『檢查起點 → 終點流向』各路口的分類，
                            *     一個路口就獨自展開收合。」
                            *
                            * 七岔路是 7×6 ＝ 42 列，攤平成一張表要一直對著「起點」
                            * 那一欄數才知道自己看到哪裡。改成一個起點一塊、各自收合，
                            * 與姊妹專案「全日交通量」的「由路口A駛出／由路口B駛出…」同一套。
                            *
                            * ⚠️ **每一列的內容、欄位與行為一個字都沒有改**（使用者指定），
                            *   只是外面多包一層分組。
                            *
                            * ⚠️ 最容易在這裡寫錯、而且錯了畫面完全正常的一點：
                            *   每一列的 onChange 改的是 `record.routes[routeIndex]`，
                            *   那個 routeIndex 必須是**在 geometrySelected.routes 裡的原始索引**。
                            *   分組後若改用組內的索引，畫面看起來一切正常，
                            *   實際上會去改到別一列的資料。所以先把原始索引一起帶著
                            *   （下面的 `entries`），分組只重排順序，不重編索引。
                            *   tests/route-group-index.test.ts 釘住這件事。
                            */}
                          {(function () {
                            const entries = geometrySelected.routes.map(
                              function (route, routeIndex) {
                                return { route, routeIndex };
                              },
                            );
                            const groups = geometrySelected.approaches
                              .map(function (approach) {
                                return {
                                  approach,
                                  items: entries.filter(function (entry) {
                                    return (
                                      entry.route.fromApproachId === approach.id
                                    );
                                  }),
                                };
                              })
                              .filter(function (group) {
                                return group.items.length > 0;
                              });
                            /*
                             * ⚠️ 保險：分組之後的總列數必須等於原本的列數。
                             *   若某一列的 fromApproachId 對不到任何一支支線，
                             *   它會**安靜地從畫面上消失**——那種資料在別處仍然參與計算，
                             *   使用者卻再也看不到、改不到它。寧可整塊退回原本的平表。
                             */
                            const grouped = groups.reduce(function (sum, group) {
                              return sum + group.items.length;
                            }, 0);
                            const rows = grouped === entries.length
                              ? groups
                              : [{ approach: null, items: entries }];
                            return rows.map(function (group) {
                              return (
                                <details
                                  key={group.approach?.id ?? "__all__"}
                                  className="route-group"
                                  /*
                                   * ⚠️ 開合狀態由「預覽起點」決定，不是各自獨立。
                                   *   使用者要的是「圖上看到顏色不對 → 馬上找到那一列」，
                                   *   所以圖上選哪個起點、這裡就開哪一塊；
                                   *   反過來點開某一塊，圖也切到那個起點。
                                   *   兩邊各記各的話，就會出現「圖上看 C、表上開著 A」。
                                   */
                                  open={
                                    group.approach
                                      ? group.approach.id ===
                                        (turnPreviewFrom ||
                                          geometrySelected.approaches[0]?.id)
                                      : true
                                  }
                                  onToggle={function (event) {
                                    if (
                                      group.approach &&
                                      (event.currentTarget as HTMLDetailsElement)
                                        .open
                                    )
                                      setTurnPreviewFrom(group.approach.id);
                                  }}
                                >
                                  <summary>
                                    {group.approach
                                      ? `由${group.approach.name}駛出`
                                      : "全部流向"}
                                    （{group.items.length} 組）
                                  </summary>
                                  <div className="table-scroll">
                                    <table>
                                      <thead>
                                        <tr>
                                          <th>起點</th>
                                          <th>終點</th>
                                          <th>轉向分類</th>
                                          <th>AM</th>
                                          <th>PM</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.items.map(function (entry) {
                                          const route = entry.route;
                                          const routeIndex = entry.routeIndex;

                                        const from = geometrySelected.approaches.find(
                                          function (item) {
                                            return item.id === route.fromApproachId;
                                          },
                                        );
                                        return (
                                          <tr key={route.id}>
                                            <td>{from?.name}</td>
                                            <td>
                                              <select
                                                value={route.toApproachId}
                                                onChange={function (e) {
                                                  updateSelectedGeometry(
                                                    function (record) {
                                                      if (record.routes)
                                                        record.routes[
                                                          routeIndex
                                                        ].toApproachId =
                                                          e.target.value;
                                                      return syncRouteGeometry(
                                                        record,
                                                      );
                                                    },
                                                  );
                                                }}
                                              >
                                                {geometrySelected.approaches
                                                  .filter(function (item) {
                                                    return (
                                                      item.id !==
                                                      route.fromApproachId
                                                    );
                                                  })
                                                  .map(function (item) {
                                                    return (
                                                      <option
                                                        key={item.id}
                                                        value={item.id}
                                                      >
                                                        {item.name}
                                                      </option>
                                                    );
                                                  })}
                                              </select>
                                            </td>
                                            <td>
                                              <select
                                                value={route.movement}
                                                onChange={function (e) {
                                                  updateSelectedGeometry(
                                                    function (record) {
                                                      if (record.routes)
                                                        record.routes[
                                                          routeIndex
                                                        ].movement = e.target
                                                          .value as
                                                          | "left"
                                                          | "through"
                                                          | "right";
                                                      record.movementRule =
                                                        "manual";
                                                      return syncRouteTotals(
                                                        record,
                                                      );
                                                    },
                                                  );
                                                }}
                                              >
                                                <option value="left">左轉</option>
                                                <option value="through">
                                                  直行
                                                </option>
                                                <option value="right">右轉</option>
                                              </select>
                                            </td>
                                            <td>
                                              {route.volumes.AM.pcu.toLocaleString()}{" "}
                                              PCU/hr
                                            </td>
                                            <td>
                                              {route.volumes.PM.pcu.toLocaleString()}{" "}
                                              PCU/hr
                                            </td>
                                          </tr>
                                        );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </details>
                              );
                            });
                          })()}
                        </details>
                      ) : null}
                    </article>
                    {/*
                      * ── 選路口 → 從顏色看轉向（使用者 2026-09-14）──────────
                      *
                      * 「我可以逐一選擇路口，直接從圖片看轉向顏色，
                      *   顏色不對的地方表示轉向錯誤，要去對應的地方調整轉向。
                      *   路口轉向則無法做到，能幫路口轉向也新增的這個功能嗎?」
                      *
                      * 依使用者同意的排版：左邊設定、右邊看圖，下面那張
                      * 「檢查起點 → 終點流向」與這裡的「預覽起點」**連動**。
                      */}
                    <article
                      className={focusClass(
                        "geometry-turn-preview",
                        "panel geometry-turn-preview",
                      )}
                      id="geometry-turn-preview"
                    >
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">TURN CHECK</span>
                          <h2>用顏色檢視轉向</h2>
                          <small>
                            選一個起點路口，圖上就用顏色畫出它的左轉／直行／右轉。
                            顏色不對＝轉向判定錯了，到「轉向明細」表改那一列。
                          </small>
                        </div>
                      </div>
                      <TurnPreview
                        record={geometrySelected}
                        fromId={turnPreviewFrom}
                        onPickFrom={setTurnPreviewFrom}
                      />
                    </article>
                    <article className={focusClass("geometry-schematic", "panel geometry-preview-wrap")} id="geometry-schematic">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">GEOMETRY PREVIEW</span>
                          <h2>路口幾何示意圖</h2>
                        </div>
                        <button
                          type="button"
                          className="ghost chart-png-button"
                          data-chart-png="geometry"
                          title="以 3 倍解析度重新繪製後下載；圖上只有圖，不含說明文字"
                          onClick={function () {
                            void svgMarkupToPng(
                              geometrySchematicHtml,
                              (geometrySelected?.station || "路口") +
                                "_路口幾何示意圖.png",
                            ).then(function () {
                              notify("已下載高解析圖片。");
                            });
                          }}
                        >
                          下載高解析圖片（PNG）
                          <small>只有圖，不含說明文字</small>
                        </button>
                      </div>
                      <div
                        className="geometry-preview"
                        dangerouslySetInnerHTML={{
                          __html: geometrySchematicHtml,
                        }}
                      />
                    </article>
                  </section>
                  {showGeometryCardPreview && (
                    <section className={focusClass("geometry-card-preview", "panel geometry-card-preview")} id="geometry-card-preview">
                      <div className="geometry-card-preview-head">
                        <div>
                          <span className="eyebrow">CARD LAYOUT PREVIEW</span>
                          <h2>交通量圖卡排版預覽</h2>
                          <p>
                            拖曳圖中的交通量數據框即可避開道路、路名或其他圖卡；不會改變任何交通量或流向。
                          </p>
                        </div>
                        <div className="geometry-preview-switches">
                          <button
                            type="button"
                            className="ghost chart-png-button"
                            data-chart-png="geometry-card"
                            title="以 3 倍解析度重新繪製後下載；圖上只有圖，不含說明文字"
                            onClick={function () {
                              void svgMarkupToPng(
                                geometryCardPreviewHtml,
                                (geometrySelected?.station || "路口") +
                                  "_交通量圖卡排版.png",
                              ).then(function () {
                                notify("已下載高解析圖片。");
                              });
                            }}
                          >
                            下載高解析圖片（PNG）
                            <small>只有圖，不含說明文字</small>
                          </button>
                          <button
                            className={
                              geometryFlow === "inbound" ? "active" : ""
                            }
                            onClick={function () {
                              changeChartFilter(
                                CHART_GEOMETRY,
                                "flowView",
                                "inbound",
                              );
                            }}
                          >
                            只看駛入
                          </button>
                          <button
                            className={
                              geometryFlow === "outbound" ? "active" : ""
                            }
                            onClick={function () {
                              changeChartFilter(
                                CHART_GEOMETRY,
                                "flowView",
                                "outbound",
                              );
                            }}
                          >
                            只看駛出
                          </button>
                          <button
                            className={
                              geometryFlow === "both" ? "active" : ""
                            }
                            onClick={function () {
                              changeChartFilter(
                                CHART_GEOMETRY,
                                "flowView",
                                "both",
                              );
                            }}
                          >
                            駛入＋駛出
                          </button>
                        </div>
                      </div>
                      {/*
                       * ⚠️ 這三顆「只看駛入／只看駛出／駛入＋駛出」改的是
                       *   **這一張圖卡自己**。升級前它們改的是全站共用的狀態，
                       *   在這裡按一下，路口轉向圖也跟著只剩駛入，
                       *   而那一頁上沒有任何字說是誰改的。
                       */}
                      <ChartDetachNote
                        chartId={CHART_GEOMETRY}
                        detached={isDetached(chartOverrides, CHART_GEOMETRY)}
                        mainSummary={describeMain(mainFilters, showQuarter, showVehicle)}
                        onReset={function () {
                          setChartOverrides(function (previous) {
                            return resetChart(previous, CHART_GEOMETRY);
                          });
                        }}
                      />
                      <InapplicableNote
                        show={geometryFilters.peak === "AMPM"}
                        text={inapplicableNote(
                          "圖卡一次只排得下一個時段：上午與下午並列會變成兩張圖卡疊在同一個版面上。",
                          "上午尖峰",
                        )}
                      />
                      <div
                        className="geometry-card-preview-canvas"
                        onPointerDown={function (
                          event: ReactPointerEvent<HTMLElement>,
                        ) {
                          startCardDrag(event, geometryFlow);
                        }}
                        dangerouslySetInnerHTML={{
                          __html: geometryCardPreviewHtml,
                        }}
                      />
                    </section>
                  )}
                </>
              )}
            </>
          )}


          {view === "trend" && (
            <TrendView
              focusedBlock={focusedBlock}
              /*
               * ⚠️ 兩塊（圖與「季度變化」）各掛一次這一句。
               *   使用者 2026-09-15：「請確保每個圖表都要有各自的不適用說明」。
               */
              /*
               * ⚠️ X-52 更正（2026-09-16）：這一句原本列著
               *   「尖峰時段」「尖峰時段判定方式」「路口流量視角」，三個都是**錯的**：
               *   ・尖峰時段 → trendPeak 來自 filtersFor（鏡子），圖上方那排
               *     AM／PM／全調查時段的選擇就是它，沒脫離時跟著主工具列走。
               *   ・尖峰時段判定方式 → trendRecordsForChart 走 viewFor，真的有套。
               *   ・路口流量視角 → flowView 傳進去會換成駛出／駛入另一條線。
               *   真正不吃的是：資料別（這一頁自己有選擇器）、顯示數值（由「指標」決定）、
               *   路口（這一頁是單一路口，用它自己的下拉）。
               */
              unusedNoteCompact={unusedConditionsNote(
                ["day", "display", "intersections"],
                "本表與左圖同一份條件（跟隨與不跟隨的完整說明見左圖）。",
              )}
              unusedNote={
                <>
                  {unusedConditionsNote(
                    ["day", "display", "intersections"],
                    /*
                     * ⚠️ 使用者 2026-09-18：「寫法只要寫 XXX 不跟隨，其餘跟隨；
                     *   或寫 XXX 跟隨，其餘不跟隨……你如果把每一項功能寫出來
                     *   誰跟隨誰不跟隨，會讓文字變得過於冗長多餘。」
                     *   跟隨的只有四項，所以用「跟隨的是這四項，其餘不跟隨」這一句。
                     */
                    "本頁只跟隨主工具列的「季度區間、尖峰時段、車種、轉向別」；其餘（路口、資料別、顯示數值等）不跟隨，由這張圖自己的選擇器決定。",
                  )}
                  {trendPeakRuleBlocked.length > 0 && (
                    <p
                      className="chart-inapplicable"
                      data-testid="chart-inapplicable"
                      data-inapplicable="peakRule"
                    >
                      「各方向各自認定」需要每一支支線都有逐時間格的原始資料才算得出來，這幾個調查點沒有，那幾季維持「整個調查點同一時段」的算法，圖上的點不會變：
                      {trendPeakRuleBlocked.slice(0, 5).join("、")}
                      {trendPeakRuleBlocked.length > 5
                        ? `等 ${trendPeakRuleBlocked.length} 個`
                        : ""}
                      。
                    </p>
                  )}
                </>
              }
              /*
               * ⚠️ 傳顯示用的那一份：判定方式選「各方向各自認定」時，
               *   趨勢圖也要跟著換算，否則同一個路口在轉向圖與趨勢圖
               *   會給出兩個不同的尖峰流量，而畫面上只寫著一種判定方式。
               */
              records={trendRecordsForChart}
              /*
               * ⚠️ 路口是**全程式共用一份**，不是每一頁各存一份。
               *
               * 使用者 2026-09-12：「我以為我篩的是A條件，結果卻是其他
               * 功能列B的條件，結果一樣嚴重」。舊版歷季趨勢比較自己存了一份
               * selectedIntersection，於是在「路口轉向圖」切到路口C、
               * 再點進「歷季趨勢比較」，看到的仍是別的路口，而畫面上沒有
               * 任何提示。這種錯不會壞掉，只會讓人看錯圖。
               */
              selectedIntersection={selectedIntersection}
              setSelectedIntersection={setSelectedIntersection}
              /* 歷季趨勢只比尖峰：全日時段是一整天的累計，
                 和尖峰的 PCU/hr 不同單位，畫在同一張折線圖會誤導。 */
              /*
               * ⚠️ X-54：傳**原始**的 trendFilters.peak，不是 trendPeak。
               *   trendPeak 會把 FULL 與 AMPM 都折成 AM，傳它進去的話
               *   這一頁的「全調查時段」與「整體」兩顆永遠選不起來。
               */
              peak={trendFilters.peak}
              setPeak={function (value: PeakChoice) {
                changeChartFilter(CHART_TREND, "peak", value);
              }}
              flowView={trendFilters.flowView}
              detachNote={
                <>
                  <ChartDetachNote
                    chartId={CHART_TREND}
                    detached={isDetached(chartOverrides, CHART_TREND)}
                    mainSummary={describeMain(mainFilters, showQuarter, showVehicle)}
                    onReset={function () {
                      setChartOverrides(function (previous) {
                        return resetChart(previous, CHART_TREND);
                      });
                    }}
                  />
                  {/*
                   * ⚠️ 「路口流量視角」在這一頁是**真的會換一條線**
                   *   （駛出總量 ⇄ 駛入總量），所以不是不適用；
                   *   畫不了的只有「並列」——一條折線只能是一個方向。
                   *   這一句只在選了並列時出現。
                   */}
                  {/*
                   * ⚠️ 「駛入＋駛出並列」是**預設值**，所以這裡不掛提示——
                   *   一句每次進來都看得到、而且沒有人問的話是噪音
                   *  （我們對「不適用說明」的規則就是只在真的篩了才出現）。
                   *   預設狀態下這一頁用它自己的「駛出總量／駛入總量」切換，
                   *   那顆切換就在圖的上方，看得見也按得到。
                   */}
                  {/*
                   * ⚠️ 「顯示數值」對這一頁不適用：這張圖畫什麼由「指標」
                   *   決定（路口總量、各車種輛數、各車種佔比…），
                   *   百分比指標本來就在那個選單裡。
                   */}
                  <InapplicableNote
                    show={isFiltered(trendFilters, "display")}
                    text={inapplicableNote(
                      "歷季趨勢圖要畫的數值由圖上方的「指標」決定（其中已含各車種佔比等百分比指標），因此不適用「顯示數值」。",
                      "「指標」選到的那一個",
                    )}
                  />
                  {/*
                   * ⚠️ X-54：這裡原本有一句「並列不適用」。
                   *   現在主工具列的「上午＋下午並列」**就是**這一頁的「整體」，
                   *   真的會換圖，所以那一句已經變成假的，移除。
                   */}
                  {trendVehicleBlocked.length > 0 && (
                    <p className="chart-inapplicable">
                      這些調查點沒有逐條流向資料，拆不到單一車種，該季的點仍是全車種：
                      {trendVehicleBlocked.join("、")}。
                    </p>
                  )}
                </>
              }
              notify={notify}
              pendingCount={pendingSurveyTypeRecords().length}
              assignPendingSurveyType={assignPendingSurveyType}
              showQuarter={showQuarter}
              quarterLabels={quarterLabels.labels}
            />
          )}

          {view === "peaks" && (
            <>
                {/*
                  * 每一頁都有一個 page-head（大標＋一句話說明），
                  * 這一頁原本漏了——側欄點進來只有工具列和表格，
                  * 排版看起來跟別頁不一樣，也少了「這一頁在做什麼」的說明。
                  */}
                <section className="page-head compact">
                  <div>
                    <span className="eyebrow">PEAK SUMMARY</span>
                    <h1>各路口尖峰彙總</h1>
                    <p>
                      把這個計畫所有路口並排在同一張表：每個路口的尖峰時段、尖峰轉向總量，以及各支線的駛出／駛入尖峰流量。想一次看完全部路口時看這一頁；只看單一路口的細節請到「各路口駛入／駛出流量」。表格依站號排序，不是排行榜。
                    </p>
                  </div>
                </section>
                <section className="diagram-toolbar panel">
                  <label>
                    資料季度
                    <select
                      value={quarter}
                      onChange={function (event) {
                        setQuarter(event.target.value);
                      }}
                    >
                      {quarters.map(function (item) {
                        return (
                          <option key={item} value={item}>
                            {quarterLabel(item)}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label>
                    路口
                    <select
                      value={peaksIntersectionValue}
                      onChange={function (event) {
                        setPeaksIntersection(event.target.value);
                      }}
                    >
                      <option value="ALL">全部路口</option>
                      {peaksIntersectionOptions.map(function (item) {
                        return (
                          <option key={item.key} value={item.key}>
                            {item.station} · {item.name}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  {/* ── 這一頁自己的兩個條件（平常是主工具列的鏡子） ── */}
                  <label>
                    路口流量視角
                    <select
                      data-testid="peaks-flow-view"
                      value={peaksFilters.flowView}
                      onChange={function (event) {
                        changeChartFilter(
                          CHART_PEAKS,
                          "flowView",
                          event.target.value as FlowView,
                        );
                      }}
                    >
                      <option value="both">駛入＋駛出並列</option>
                      <option value="inbound">只顯示駛入</option>
                      <option value="outbound">只顯示駛出</option>
                    </select>
                  </label>
                  <label>
                    車種
                    <select
                      data-testid="peaks-vehicle"
                      value={peaksFilters.vehicle}
                      onChange={function (event) {
                        changeChartFilter(
                          CHART_PEAKS,
                          "vehicle",
                          event.target.value,
                        );
                      }}
                    >
                      <option value="all">全部車種</option>
                      {mainVehicleOptions.map(function (entry) {
                        return (
                          <option key={entry[0]} value={entry[0]}>
                            {entry[1]}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                </section>
                <ChartDetachNote
                  chartId={CHART_PEAKS}
                  detached={isDetached(chartOverrides, CHART_PEAKS)}
                  mainSummary={describeMain(mainFilters, showQuarter, showVehicle)}
                  onReset={function () {
                    setChartOverrides(function (previous) {
                      return resetChart(previous, CHART_PEAKS);
                    });
                  }}
                />
                {/*
                 * ⚠️ 這一頁的表**同時列出三個尖峰**，所以「尖峰時段」
                 *   對它不適用——不是沒接上。不寫的話，使用者在主工具列
                 *   切了時段、這一頁一個數字都沒變，只會以為壞了。
                 */}
                {/*
                 * ⚠️ 這兩句原本掛在這裡（表格**外面**）。
                 *
                 * 使用者 2026-09-15：「請確保**每個圖表都要有各自的**不適用說明」。
                 * 掛在頁面上方、離表格很遠的話，看表的人不會把兩者連起來，
                 * 而且逐塊檢查時這一塊等於一句都沒有。已搬進 #peaks-branch 裡面。
                 */}
                {peaksVehicleBlocked.length > 0 && (
                  <p className="chart-inapplicable" data-testid="peaks-vehicle-blocked">
                    這些調查點沒有逐條流向資料，拆不到單一車種，數字仍是全車種：
                    {peaksVehicleBlocked.join("、")}
                    。要依車種看請以 v2.1.67 之後的版本重新匯入原始檔。
                  </p>
                )}
                <section
                  className={focusClass("peaks-branch", "panel")}
                  id="peaks-branch"
                  /*
                   * ⚠️ 2026-09-18 大檢查 F-16：這一塊每一格都走 viewFor(record, peaksFilters)，
                   *   「尖峰時段判定方式」確實套上（各方向各自認定時，時段欄換成各支線
                   *   自己的視窗、總量跟著重算；真實檔實測 1,049.7→1,071.7）。
                   *   但它需要 15 分鐘逐格資料，e2e 的種子資料沒有，守門在種子上量不到差別，
                   *   所以用 data-consumes 宣告「有算」——這個宣告與上面那句「不適用」互斥，
                   *   e2e-filter-coverage 會檢查兩者不可以同時出現。
                   */
                  data-consumes="peakRule"
                >
                  {/*
                   * ⚠️ 這一塊固定同時列出三個尖峰，所以「尖峰時段」不適用；
                   *   跨路口並排沒有共同分母，所以「顯示數值」也不適用。
                   *   兩句都**貼在表格上**（使用者 2026-09-15 指定）。
                   */}
                  <InapplicableNote
                    show={isFiltered(peaksFilters, "peak")}
                    text={inapplicableNote(
                      "本表固定同時列出上午尖峰、下午尖峰與全調查時段尖峰三欄，不適用「尖峰時段」篩選。",
                      "三個尖峰全列",
                    )}
                    fields={["peak"]}
                  />
                  <InapplicableNote
                    show={isFiltered(peaksFilters, "display")}
                    text={inapplicableNote(
                      "本表跨路口並排，沒有共同的分母可以算百分比（各路口的總量不同，加起來不對應任何真實的量），因此不適用「顯示數值」。",
                      "交通流量（PCU/hr）",
                    )}
                    fields={["display"]}
                  />
                  {/*
                   * ⚠️ 2026-09-18 大檢查 F-16：這一句原本連「尖峰時段判定方式」「轉向別」
                   *   也寫成不適用，但表格每一格都走 viewFor(record, peaksFilters)
                   *   ——判定方式與轉向別**確實會套上**（2026-09-14 那次修正就是為了
                   *   讓它們套上；實測：轉向別＝左轉時 T15-01 的 AM 轉向總量從
                   *   3,976.6 變成 1,422.8）。畫面寫「不適用」、數字卻在變，是說謊。
                   *   現在只保留真的不跟的「資料別」：這張表一列一筆調查紀錄
                   *   （同一路口的平日、假日各自一列），不依資料別篩掉任何一列。
                   */}
                  <InapplicableNote
                    show={isFiltered(peaksFilters, "day")}
                    text="本表是各路口的尖峰彙總，一列一筆調查紀錄（同一路口的平日、假日各自一列），不適用「資料別」篩選：要只看其中一種資料別，請到「路口轉向圖」或「流量核對工作台」。轉向別、車種與尖峰時段判定方式則會套用到表中每一格。"
                    fields={["day"]}
                  />
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">PEAK SUMMARY</span>
                      <h2>
                        {quarter ? showQuarter(quarter) : "尚未選擇季度"}{" "}
                        各路口尖峰彙總
                      </h2>
                    </div>
                    {/*
                      * 「顯示調查日期」開關（使用者 2026-09-20：「只需要增加
                      * 一個開關讓我可以看到調查日期就好」）。
                      *
                      * ⚠️ 預設**開**：做成預設關的話，使用者得先知道有這顆
                      *   開關才找得到這個資訊——那等於把功能藏起來。
                      * ⚠️ 關掉時那一欄仍然在、只是寫「－」，不是把整欄拿掉：
                      *   拿掉的話整張表的欄位會位移，而且與流量核對工作台
                      *   那一份對不起來。
                      */}
                    <label className="survey-date-toggle">
                      <input
                        type="checkbox"
                        data-testid="show-survey-date"
                        checked={showSurveyDate}
                        onChange={function (event) {
                          setShowSurveyDate(event.target.checked);
                        }}
                      />
                      顯示調查日期
                    </label>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>站號／路口</th>
                          {/*
                            * ── 逐筆的調查日 ────────────────────────────
                            *
                            * 使用者 2026-09-11：「請新增讓我在切換顯示調查月份時，
                            * 也能看出哪一個路口／路段是在 X 月做的這項功能。」
                            *
                            * ⚠️ 期別標籤答不了這個問題：它寫的是**整季**的合寫
                            *   （「115年4、5月」），看不出哪一筆是 4 月、哪一筆是 5 月。
                            *   所以逐筆的日期要單獨列一欄。
                            *
                            * ⚠️ 這一欄**不受期別顯示開關控制，一直都在**。
                            *   做成「切到月份才出現」的話，欄位會忽然多一格、
                            *   整張表跟著位移，而且使用者得先知道有那顆開關
                            *   才找得到這個資訊——那等於把功能藏起來。
                            *   年份寫法（民國／西元）倒是要跟著上面那顆開關走。
                            */}
                          <th>調查日</th>
                          {PEAK_KEYS.map(function (key) {
                            return (
                              <th key={"h-" + key}>
                                {SCOPE_SHORT_LABELS[key]} 時段
                              </th>
                            );
                          })}
                          {PEAK_KEYS.map(function (key) {
                            return (
                              <th key={"t-" + key}>
                                {SCOPE_SHORT_LABELS[key]} 轉向總量（
                                {scopeUnit(key, "pcu", peaksSummaryCoverage)}）
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {peaksSummaryRecords
                          /*
                           * ⚠️ 這裡刻意**依站號排序，不依流量**。
                           * 使用者：「針對路段／路口做排名沒有意義，
                           * 沒人會去關注哪條路段／路口第一名」。
                           * 依流量由大到小排等於一張排行榜；這是查詢用的
                           * 明細表，依站號排才找得到自己要看的那一個。
                           */
                          .sort(function (a, b) {
                            return String(a.station).localeCompare(
                              String(b.station),
                              "zh-Hant",
                            );
                          })
                          .map(function (record) {
                            return (
                              <tr key={record.id}>
                                <td>
                                  <strong>{record.station}</strong>
                                  <br />
                                  <small>{record.name}</small>
                                </td>
                                <td>
                                  {/*
                                    * 讀不到日期就寫清楚「原始檔沒有日期」，
                                    * 不可以留空白——空白會被當成「這裡壞了」。
                                    */}
                                  {showSurveyDate ? (
                                    surveyDateInYearStyle(
                                      effectiveRecordDate(record),
                                      yearStyle,
                                    ) || (
                                      <small className="muted-cell">
                                        原始檔讀不到日期
                                      </small>
                                    )
                                  ) : (
                                    <small className="muted-cell">－</small>
                                  )}
                                </td>
                                {PEAK_KEYS.map(function (key) {
                                  return (
                                    <td key={"h-" + key}>
                                      {scopeWindowLabel(
                                        viewFor(record, peaksFilters),
                                        key,
                                      )}
                                    </td>
                                  );
                                })}
                                {PEAK_KEYS.map(function (key) {
                                  /* 全日尖峰算不出來時寫「－」，不寫 0.0。 */
                                  /*
                                   * ⚠️ 這裡原本吃的是**原紀錄**，
                                   *   而左邊的時段欄吃的是顯示用紀錄。
                                   *   於是切「各方向各自認定」時，
                                   *   時段欄換成各支線自己的視窗、
                                   *   總量卻還是整路口同一時段算的，
                                   *   同一列上兩個欄位講不同的事。
                                   *   轉向別與車種篩選同樣完全沒有作用。
                                   *  （2026-09-14 實測抓到。）
                                   */
                                  return (
                                    <td key={"t-" + key}>
                                      {hasDayPeak(record) || key !== "DAY"
                                        ? recordTotal(
                                            viewFor(record, peaksFilters),
                                            key,
                                          ).toLocaleString()
                                        : "－"}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  <div className="compare-flow-section">
                    <div className="compare-flow-heading">
                      <div>
                        <span className="eyebrow">BRANCH FLOW DETAIL</span>
                        <h3>各支線駛入／駛出尖峰流量</h3>
                      </div>
                      <p>
                        「駛出路口X」為車流由支線 X 駛出、開進中央路口（以 X 為起點）；「駛入路口X」為車流穿越中央路口後駛入支線 X（以 X 為終點）。各支線駛出或駛入合計皆應等於路口尖峰轉向總量，單位均為{" "}
                        {/*
                          * ⚠️ 這一區**只列上午尖峰與下午尖峰**兩欄（見下面的
                          *   `branchPeakFlows(peaksView, "AM")`／`"PM"`），
                          *   兩者都是「某一小時的流率」，所以單位與主工具列
                          *   選到哪一個時段無關。
                          * ⚠️ 2026-09-25 第六輪：這裡原本寫死 `PCU/hr`。
                          *   第一版改成跟著主工具列的 `peak` 走——**那是錯的**：
                          *   選「全調查時段」時這句話會寫「PCU/調查日」，
                          *   而下面的卡片仍然是上午／下午的每小時流率。
                          *   改成明確問「AM 的單位」，既不寫死、也不會跟錯。
                          */}
                        {scopeUnit("AM", "pcu", peaksSummaryCoverage)}。
                      </p>
                    </div>
                    <div className="compare-flow-grid">
                      {peaksSummaryRecords
                        /*
                         * ⚠️ 2026-09-18 大檢查 F-17：卡片原本依「目前尖峰時段的總量」
                         *   由大到小排——主工具列切上午／下午／全調查時段，五張卡片
                         *   整個換位置（數值沒變），而頁首寫的是「表格依站號排序，
                         *   不是排行榜」。與上面的彙總表同一個排法：依站號。
                         */
                        .sort(function (a, b) {
                          return String(a.station).localeCompare(
                            String(b.station),
                            "zh-Hant",
                          );
                        })
                        .map(function (record) {
                          const project = projects.find(function (item) {
                            return item.id === record.projectId;
                          });
                          const peaksView = viewFor(record, peaksFilters);
                          const amFlows = branchPeakFlows(peaksView, "AM");
                          const pmFlows = branchPeakFlows(peaksView, "PM");
                          return (
                            <article
                              className="compare-flow-card"
                              key={record.id}
                            >
                              <header>
                                <div>
                                  <span>
                                    {project?.code || "—"} · {record.station}
                                  </span>
                                  <h3>{record.name}</h3>
                                </div>
                                <strong>
                                  AM{" "}
                                  {recordTotal(peaksView, "AM").toLocaleString()}{" "}
                                  ／ PM{" "}
                                  {recordTotal(peaksView, "PM").toLocaleString()}{" "}
                                  PCU/hr
                                </strong>
                              </header>
                              <div className="table-scroll">
                                <table className="branch-flow-table">
                                  <thead>
                                    <tr>
                                      <th rowSpan={2}>支線</th>
                                      <th colSpan={peaksFlowCols.length}>
                                        AM Peak（PCU/hr）
                                      </th>
                                      <th colSpan={peaksFlowCols.length}>
                                        PM Peak（PCU/hr）
                                      </th>
                                    </tr>
                                    <tr>
                                      {peaksFlowCols.map(function (column) {
                                        return (
                                          <th key={"am-" + column.key}>
                                            {column.label}
                                          </th>
                                        );
                                      })}
                                      {peaksFlowCols.map(function (column) {
                                        return (
                                          <th key={"pm-" + column.key}>
                                            {column.label}
                                          </th>
                                        );
                                      })}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {record.approaches.map(
                                      function (approach, index) {
                                        return (
                                          <tr key={approach.id}>
                                            <td>
                                              <b>
                                                {approach.sourceCode ||
                                                  String.fromCharCode(
                                                    65 + index,
                                                  )}
                                              </b>
                                              <small>{approach.name}</small>
                                            </td>
                                            {peaksFlowCols.map(function (
                                              column,
                                            ) {
                                              return (
                                                <td key={"am-" + column.key}>
                                                  {column
                                                    .pick(amFlows[index])
                                                    .toLocaleString()}
                                                </td>
                                              );
                                            })}
                                            {peaksFlowCols.map(function (
                                              column,
                                            ) {
                                              return (
                                                <td key={"pm-" + column.key}>
                                                  {column
                                                    .pick(pmFlows[index])
                                                    .toLocaleString()}
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        );
                                      },
                                    )}
                                  </tbody>
                                  <tfoot>
                                    <tr>
                                      <th>支線合計</th>
                                      {peaksFlowCols.map(function (column) {
                                        return (
                                          <th key={"am-sum-" + column.key}>
                                            {amFlows
                                              .reduce(function (sum, item) {
                                                return sum + column.pick(item);
                                              }, 0)
                                              .toLocaleString()}
                                          </th>
                                        );
                                      })}
                                      {peaksFlowCols.map(function (column) {
                                        return (
                                          <th key={"pm-sum-" + column.key}>
                                            {pmFlows
                                              .reduce(function (sum, item) {
                                                return sum + column.pick(item);
                                              }, 0)
                                              .toLocaleString()}
                                          </th>
                                        );
                                      })}
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </article>
                          );
                        })}
                    </div>
                  </div>
                </section>
            </>
          )}

          {view === "audit" && (
            <AuditWorkbench
              focusedBlock={focusedBlock}
              /*
               * ⚠️ 顯示用的那一份。編輯（改支線、當量）走的是別的路徑，
               *   那些仍然用原紀錄。
               */
              record={
                selected ? viewFor(selected, auditFilters) : viewRecord(selected)
              }
              peak={auditPeak}
              flowView={auditFilters.flowView}
              setPeak={function (value: ScopeKey) {
                /*
                 * ⚠️ 這一頁的「時段」改的是**這一張自己的**。
                 *   升級前它改的是全站共用的 peak，於是在核對工作台
                 *   切一下時段，車種組成、進階分析、歷季趨勢的數字
                 *   全部跟著換，而那幾頁上沒有任何字說是誰換的。
                 */
                changeChartFilter(CHART_AUDIT, "peak", value);
              }}
              detachNote={
                <>
                  <ChartDetachNote
                    chartId={CHART_AUDIT}
                    detached={isDetached(chartOverrides, CHART_AUDIT)}
                    mainSummary={describeMain(mainFilters, showQuarter, showVehicle)}
                    onReset={function () {
                      setChartOverrides(function (previous) {
                        return resetChart(previous, CHART_AUDIT);
                      });
                    }}
                  />
                  <InapplicableNote
                    show={auditFilters.peak === "AMPM"}
                    text={inapplicableNote(
                      "核對工作台一次只核對得了一個時段：它逐格對照原始調查表，上午與下午並列會變成兩張表疊在一起。",
                      "上午尖峰",
                    )}
                  />
                  <InapplicableNote
                    show={isFiltered(auditFilters, "display")}
                    text={inapplicableNote(
                      "核對工作台要拿畫面上的數字去對原始調查表，因此固定顯示實際的交通流量與車輛數，不適用「顯示數值」。",
                      "交通流量與車輛數",
                    )}
                  />
                  {auditVehicleBlocked.length > 0 && (
                    <p className="chart-inapplicable">
                      這一筆沒有逐條流向資料，拆不到單一車種，數字仍是全車種（
                      {auditVehicleBlocked.join("、")}）。
                    </p>
                  )}
                </>
              }
              quarter={quarter}
              showQuarter={showQuarter}
              quarterRecords={current}
              lockQuarter={lockCurrentQuarter}
              unlockQuarter={unlockCurrentQuarter}
              setReview={function (status, note) {
                if (!selected) return;
                setRecords(
                  records.map(function (record) {
                    return record.id === selected.id
                      ? {
                          ...record,
                          review: {
                            status,
                            note,
                            updatedAt: new Date().toISOString(),
                          },
                        }
                      : record;
                  }),
                );
              }}
              intersections={currentCanonicalRecords.map(function (record) {
                return {
                  key: recordIntersectionKey(record),
                  label: record.station + "　" + record.name,
                };
              })}
              setQuarter={setQuarter}
              quarters={quarters}
              quarterLabel={quarterLabel}
              selectedIntersection={selectedIntersection}
              setSelectedIntersection={setSelectedIntersection}
              surveyTypes={Array.from(
                new Set(
                  selectedIntersectionRecords.map(function (record) {
                    return record.surveyType || "待設定";
                  }),
                ),
              )}
              selectedSurveyType={selected?.surveyType || "待設定"}
              setSelectedSurveyType={setSelectedSurveyType}
              pendingSurveyTypeCount={pendingSurveyTypeRecords().length}
              pendingSurveyTypeLabels={pendingSurveyTypeRecords().map(
                function (record) {
                  return record.quarter + "　" + record.station;
                },
              )}
              assignPendingSurveyType={assignPendingSurveyType}
              setSurveyType={function (value) {
                if (!selected) return;
                saveRevision(selected, "更改資料別前自動保存");
                setRecords(
                  records.map(function (record) {
                    return record.id === selected.id
                      ? { ...record, surveyType: value }
                      : record;
                  }),
                );
                notify("資料別已更新為「" + value + "」。");
              }}
              /*
               * ── 指定「某一個路口」的資料別 ─────────────────────
               *
               * 使用者 2026-09-11：「如果這一季 A 和 B 路段是在平日做的，
               * C 和 D 路段是假日做的，這邊無法依照路段分別進行平日／假日的設定。」
               *
               * ⚠️ 資料別本來就是**每一筆自己一個值**，不是整季共用一個
               *   ——所以資料結構不必動。缺的是一個「一次看完、逐筆指定」
               *   的畫面：舊版只能選到哪一筆就改哪一筆，四個路口要切四次。
               *
               * ⚠️ 一定要和上面那支走同一條寫入路徑（saveRevision → setRecords），
               *   不可以另外寫一份。兩份的話「改資料別前自動保存還原點」
               *   遲早只剩一邊有做，而那是出事時唯一的退路。
               */
              setSurveyTypeFor={function (recordId, value) {
                const target = records.find(function (record) {
                  return record.id === recordId;
                });
                if (!target) return;
                saveRevision(target, "更改資料別前自動保存");
                setRecords(
                  records.map(function (record) {
                    return record.id === recordId
                      ? { ...record, surveyType: value }
                      : record;
                  }),
                );
                notify(
                  "「" + target.name + "」的資料別已更新為「" + value + "」。",
                );
              }}
            />
          )}

          {view === "advanced" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">TURNING ANALYSIS</span>
                  <h1>轉向進階分析</h1>
                  <p>
                    以已確認的原始 OD 流向計算矩陣、各支線駛入／駛出平衡與連續
                    60 分鐘尖峰候選；流量單位隨所選時段變動（目前為{" "}
                    {/* ⚠️ 這一頁的時段可以脫離，單位要照 advancedPeak 寫。
                        寫主工具列的 peak 的話，同一個畫面上會出現兩種單位：
                        這一句寫 PCU/hr，下面每一塊的單位標籤寫 PCU/調查時段。 */}
                    {scopeUnit(advancedPeak, "pcu", advancedCoverage)}）。
                  </p>
                </div>
                {selected && (
                  <button
                    className="primary"
                    onClick={function () {
                      exportAdvancedExcel(selected);
                    }}
                  >
                    下載核對 Excel
                  </button>
                )}
              </section>
              {/*
                * ★ 就地切換季度與路口。
                *
                * 使用者的原話：「我無法在這個分頁選擇要查看哪個路口或季別，
                * 必須要先到其他分頁中選擇路口或季別後，再回來……請確保都能
                * 直接原地點選季別／路段等功能」。
                *
                * ⚠️ 這裡綁的是**全站共用的** quarter 與 selectedIntersection，
                * 不是這一頁自己的複本——在哪一頁改，其他頁跟著變，這是這個
                * 系統一貫的設計。做成各頁獨立會變成七頁各選各的。
                */}
              {currentCanonicalRecords.length > 0 && (
                <section className="diagram-toolbar panel">
                  <label>
                    資料季度
                    <select
                      value={quarter}
                      onChange={function (event) {
                        setQuarter(event.target.value);
                      }}
                    >
                      {quarters.map(function (item) {
                        return (
                          <option key={item} value={item}>
                            {quarterLabel(item)}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label>
                    路口
                    <select
                      /*
                       * 端對端要能精準抓到這一顆。不可以用標籤文字找——
                       * 同一頁上的「路口流量視角」也以「路口」開頭，會抓錯。
                       */
                      data-testid="advanced-intersection"
                      value={selected ? recordIntersectionKey(selected) : ""}
                      onChange={function (event) {
                        setSelectedIntersection(event.target.value);
                      }}
                    >
                      {currentCanonicalRecords.map(function (record) {
                        return (
                          <option
                            key={record.id}
                            value={recordIntersectionKey(record)}
                          >
                            {record.station} · {record.name}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  {selectedIntersectionRecords.length > 1 && (
                    <label>
                      資料別
                      <select
                        value={selected?.surveyType || "待設定"}
                        onChange={function (event) {
                          setSelectedSurveyType(event.target.value);
                        }}
                      >
                        {selectedIntersectionRecords.map(function (record) {
                          return (
                            <option
                              key={record.id}
                              value={record.surveyType || "待設定"}
                            >
                              {record.surveyType || "待設定"}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  )}
                </section>
              )}
              {!selected
                ? renderNoData("尚無可分析路口")
                : (() => {
                    /*
                     * ⚠️ 這四個都要走 viewRecord：判定方式選「各方向各自認定」時，
                     *   OD 矩陣與支線平衡也必須換成各支線自己尖峰小時的量，
                     *   否則同一個路口在這一頁與駛入／駛出那一頁會給出兩套數字。
                     */
                    /*
                     * ⚠️ 轉向別**刻意不套**（畫面上寫著不適用，那就真的不套）；
                     *   但車種要套——「只看機車的 OD 矩陣」是算得出來的，
                     *   而升級前這一頁對車種完全沒有反應（實測）。
                     */
                    /*
                     * ⚠️ X-51：這裡**必須**用 advancedPeak 去取判定方式的改寫結果。
                     *   用主工具列的時段（舊寫法 viewRecordAllMovements）的話，
                     *   這一頁脫離成別的時段時，讀到的是沒被改寫的那一份，
                     *   「各方向各自認定」等於沒套——而畫面上照樣寫著有套。
                     */
                    /* ⚠️ 與「下載核對 Excel」走**同一支**（advancedRecordFor）——
                        兩邊各寫一份的話遲早分岔，而分岔時兩份各自都很合理。 */
                    const advancedView = advancedRecordFor(selected);
                    const matrix = odMatrix(advancedView, advancedPeak);
                    const balance = branchBalance(advancedView, advancedPeak);
                    const sensitivity = peakSensitivity(selected);
                    const conservation = conservationCheck(
                      advancedView,
                      advancedPeak,
                    );
                    /*
                     * ══════════════════════════════════════════════════
                     *  X-50：貼在**每一塊**上的不適用說明
                     * ══════════════════════════════════════════════════
                     *
                     * 這兩句原本掛在頁層。掛在頁層有兩個問題：
                     *  ① 看表的人不會把上面那一句和這張表連起來
                     *     （使用者 2026-09-15 指名「每個圖表都要有各自的說明」）；
                     *  ② 逐塊守門（e2e-filter-coverage）量不到，那兩塊就會被
                     *     判成「既沒變也沒說」——而且判得對。
                     */
                    const advancedBlockNotes = (
                      <>
                        <InapplicableNote
                          show={advancedFilters.peak === "AMPM"}
                          text={inapplicableNote(
                            "矩陣一次只排得下一個時段：上午與下午並列會變成兩張矩陣疊在同一個版面上，所以這一塊維持單一時段。",
                            "上午尖峰",
                          )}
                          fields={["peak"]}
                        />
                        {/*
                         * ⚠️ 「各方向各自認定」這一塊是**真的會套**的，
                         *   所以不可以一律標成不適用。只有在這一筆沒有逐時間格
                         *   原始資料、算不出各支線自己的尖峰時才說話——
                         *   那時數字確實一動也不動。
                         */}
                        <InapplicableNote
                          show={
                            mainFilters.peakRule === "direction" &&
                            !directionPeakFor(advancedPeak).map.has(selected.id)
                          }
                          text={
                            "「各方向各自認定」需要每一支支線都有逐時間格的原始資料才算得出來，這一筆沒有，所以這一塊維持「整個調查點同一時段」的算法，數字不會變。要用那個判定方式請重新匯入這一筆的原始檔。"
                          }
                          fields={["peakRule"]}
                        />
                      </>
                    );
                    return (
                      <>
                        <section className="panel advanced-controls">
                          {/*
                            * 使用者 2026-09-10 指定：轉向進階分析也要能看
                            * 全調查時段與全調查時段尖峰，四個畫面的時段選項一致。
                            * ⚠️ 這一頁的守恆檢查、OD 矩陣、支線平衡三張表本來就
                            *   吃 ScopeKey（不是 PeakKey），所以只要把選項補齊，
                            *   底下的計算不必改——這一點我先確認過才動手。
                            */}
                          <Segmented
                            value={advancedPeak}
                            options={SCOPE_KEYS.map(function (
                              key,
                            ): [ScopeKey, string] {
                              return [key, SCOPE_SHORT_LABELS[key]];
                            })}
                            onChange={function (value: ScopeKey) {
                              changeChartFilter(CHART_ADVANCED, "peak", value);
                            }}
                            disabledReason={function (key) {
                              return hasScopeValue(selected, key)
                                ? null
                                : "這一筆缺少逐時間格資料，算不出這個時段";
                            }}
                          />
                          <label>
                            車種
                            <select
                              data-testid="advanced-vehicle"
                              value={advancedFilters.vehicle}
                              onChange={function (event) {
                                changeChartFilter(
                                  CHART_ADVANCED,
                                  "vehicle",
                                  event.target.value,
                                );
                              }}
                            >
                              <option value="all">全部車種</option>
                              {mainVehicleOptions.map(function (entry) {
                                return (
                                  <option key={entry[0]} value={entry[0]}>
                                    {entry[1]}
                                  </option>
                                );
                              })}
                            </select>
                          </label>
                          <label>
                            顯示數值
                            <select
                              data-testid="advanced-display"
                              value={advancedFilters.display}
                              onChange={function (event) {
                                changeChartFilter(
                                  CHART_ADVANCED,
                                  "display",
                                  event.target.value as DisplayChoice,
                                );
                              }}
                            >
                              <option value="count">車輛數</option>
                              <option value="volume">交通流量</option>
                              <option value="percent">百分比</option>
                              <option value="both">交通流量＋百分比</option>
                              <option value="countPercent">
                                車輛數＋百分比
                              </option>
                            </select>
                          </label>
                          <strong>
                            {selected.station} · {selected.name}
                          </strong>
                          <span
                            className={
                              conservation.valid ? "check-ok" : "check-warn"
                            }
                          >
                            守恆差值 {conservation.difference.toLocaleString()}{" "}
                            {scopeUnit(advancedPeak, "pcu", advancedCoverage)} ·{" "}
                            {conservation.valid ? "一致" : "需核對"}
                          </span>
                        </section>
                        <ChartDetachNote
                          chartId={CHART_ADVANCED}
                          detached={isDetached(chartOverrides, CHART_ADVANCED)}
                          mainSummary={describeMain(mainFilters, showQuarter, showVehicle)}
                          onReset={function () {
                            setChartOverrides(function (previous) {
                              return resetChart(previous, CHART_ADVANCED);
                            });
                          }}
                        />
                        {/*
                         * ⚠️ X-50（2026-09-16）：這一句與下面的「轉向別」那一句
                         *   已經**逐塊各掛一份**（見 advanced-od／advanced-balance），
                         *   留在這裡等於同一句話在同一頁出現兩次。
                         *   使用者 2026-09-16：「如果常駐說明文字會變得平常
                         *   一張圖多了好多文字占版面」——所以移除頁層這一份，
                         *   保留貼在各自那一塊上的那一份（使用者 2026-09-15 的要求）。
                         */}
                        {/*
                         * ⚠️ X-50：這一句已改成貼在 advanced-od 與
                         *   advanced-balance 各自那一塊上（見下面的 advancedBlockNotes）。
                         *   掛在頁層的話逐塊守門量不到，而且看表的人
                         *   不會把上面那一句和這張表連起來。
                         */}
                        {advancedFilters.vehicle !== "all" &&
                          !canSplitByVehicle(selected) && (
                            <p className="chart-inapplicable">
                              這一筆沒有逐條流向資料，拆不到單一車種，
                              矩陣與平衡仍是全車種。
                            </p>
                          )}
                        {/*
                         * ⚠️ 「各方向各自認定」下，守恆本來就不會成立。
                         *
                         *   守恆檢核比的是「各支線駛入合計 ＝ 各支線駛出合計」，
                         *   而那個等式的前提是**大家算的是同一小時**。
                         *   各支線各自取自己最忙的一小時之後，A 的駛出算的是
                         *   A 的尖峰、B 的駛入算的是 B 的尖峰——兩邊不是同一段時間，
                         *   差值不為零是數學上必然，**不是資料有問題**。
                         *
                         *   不講的話，使用者會看到「需核對」而去翻原始檔找一個
                         *   不存在的錯誤。這一行只在真的選了那個判定方式時出現。
                         */}
                        <InapplicableNote
                          show={mainFilters.peakRule === "direction"}
                          text={
                            "守恆檢核與 OD 矩陣在「各方向各自認定」下不適用：" +
                            "守恆的前提是各支線算的是同一小時，" +
                            "而這個判定方式讓每一條支線各取自己最忙的那一小時，" +
                            "差值不為零是必然的，不代表資料有錯。" +
                            "要檢查守恆請切回「整個調查點同一時段」。"
                          }
                        />
                        <section className="advanced-grid">
                          <article className={focusClass("advanced-od", "panel advanced-wide")} id="advanced-od">
                            {/*
                             * ⚠️ 說明要**貼在這一塊上**（使用者 2026-09-15：
                             *   「請確保每個圖表都要有各自的不適用說明」）。
                             *   原本掛在兩塊外面，看表的人不會把兩者連起來。
                             */}
                            {/*
                             * ⚠️ X-50 更正（2026-09-16）：這一句原本還列著
                             *   「尖峰時段判定方式」與「尖峰時段」，那是**錯的**。
                             *   ・時段：advancedPeak 來自 filtersFor（鏡子），
                             *     沒脫離時就是跟著主工具列走。
                             *   ・判定方式：viewRecordAllMovementsFor 真的有套。
                             *   寫著「不適用」卻其實會跟著變，使用者會以為數字
                             *   不會動而不去核對——這比不寫更危險。
                             */}
                            {advancedBlockNotes}
                            <InapplicableNote
                              show={
                                isFiltered(mainFilters, "movement") ||
                                isFiltered(mainFilters, "day") ||
                                isFiltered(mainFilters, "flowView")
                              }
                              text="這一塊不適用主工具列的「轉向別」「資料別」「路口流量視角」：OD 矩陣要把左轉、直行、右轉與各支線一起列出來才看得出守恆，所以這裡一律以「全部轉向」計算；資料別（平日／假日）用的是這一頁上方自己的選擇器。（時段、尖峰時段判定方式、車種、顯示數值這四項，這一塊是真的會跟著變的。）"
                              fields={[
                                "movement",
                                "day",
                                "flowView",
                              ]}
                            />
                            <div className="panel-head">
                              <div>
                                <span className="eyebrow">OD MATRIX</span>
                                <h2>來源支線 → 目的支線</h2>
                              </div>
                              <span className="status-dot">{scopeUnit(advancedPeak, "pcu", advancedCoverage)}</span>
                            </div>
                            <div className="table-scroll">
                              <table className="od-table">
                                <thead>
                                  <tr>
                                    <th>來源＼駛入</th>
                                    {selected.approaches.map(function (a) {
                                      return <th key={a.id}>{a.name}</th>;
                                    })}
                                    <th>駛出合計</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {matrix.map(function (row) {
                                    const total = row.values.reduce(function (
                                      sum,
                                      value,
                                    ) {
                                      return sum + value;
                                    }, 0);
                                    return (
                                      <tr key={row.originId}>
                                        <th>{row.origin}</th>
                                        {row.values.map(
                                          function (value, index) {
                                            /*
                                             * ⚠️ 百分比的分母是**這一列的合計**
                                             *  （這一支駛出的車去了哪裡），
                                             *   不是全矩陣總和。用全矩陣當分母的話，
                                             *   每一列加起來不是 100%，
                                             *   而「這支的車有幾成右轉」這個問題
                                             *   就答不出來了。
                                             *   分母 0 時寫「－」，不寫 0.0%。
                                             */
                                            return (
                                              <td
                                                key={
                                                  selected.approaches[index].id
                                                }
                                              >
                                                {advancedShowsValue
                                                  ? value.toLocaleString()
                                                  : null}
                                                {advancedShowsValue &&
                                                advancedShowsPercent ? (
                                                  <br />
                                                ) : null}
                                                {advancedShowsPercent ? (
                                                  <small>
                                                    {total
                                                      ? (
                                                          (value / total) *
                                                          100
                                                        ).toFixed(1) + "%"
                                                      : "－"}
                                                  </small>
                                                ) : null}
                                              </td>
                                            );
                                          },
                                        )}
                                        <td>
                                          <b>{total.toLocaleString()}</b>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                                {/*
                                  * ── 最底下這一列：各欄加總＝「駛入合計」──────
                                  *
                                  * 使用者 2026-09-11：「這張表顯示的是『駛入』，
                                  * 但我希望也能顯示駛出……現在回頭來看這張表，
                                  * 一樣只有『駛入』，我找不到如何切換成駛出。」
                                  *
                                  * ⚠️ 這張表本來就同時含兩個方向：
                                  *   ・每一**列**＝從某支線駛出到各支線 → 列合計＝駛出合計（已經有了）
                                  *   ・每一**欄**＝各支線駛入某支線 → 欄合計＝駛入合計（**以前沒印**）
                                  * 所以缺的是這一列，不是一個切換鈕。
                                  *
                                  * ⚠️ 刻意**不做**「切換成駛出視角」的按鈕：
                                  *   轉置之後每一格數字一個都沒變，只是行列對調，
                                  *   看的人會以為是另一組資料——那才是真的會出錯的做法。
                                  *
                                  * 右下角那一格是全矩陣總和：它同時是所有列合計的和、
                                  * 也是所有欄合計的和，所以它本身就是一道對帳。
                                  */}
                                <tfoot>
                                  <tr>
                                    <th>駛入合計</th>
                                    {selected.approaches.map(function (a, index) {
                                      const columnTotal = matrix.reduce(
                                        function (sum, row) {
                                          return sum + (row.values[index] ?? 0);
                                        },
                                        0,
                                      );
                                      return (
                                        <td key={a.id}>
                                          <b>{columnTotal.toLocaleString()}</b>
                                        </td>
                                      );
                                    })}
                                    <td>
                                      <b>
                                        {matrix
                                          .reduce(function (sum, row) {
                                            return (
                                              sum +
                                              row.values.reduce(function (
                                                inner,
                                                value,
                                              ) {
                                                return inner + value;
                                              }, 0)
                                            );
                                          }, 0)
                                          .toLocaleString()}
                                      </b>
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                            <p className="od-table-note">
                              每一<b>列</b>是「這條支線駛出到各支線」，所以最右欄是
                              <b>駛出合計</b>；每一<b>欄</b>是「各支線駛入這條支線」，
                              所以最底列是<b>駛入合計</b>。右下角是全路口總量，
                              它同時等於所有列合計的和與所有欄合計的和。
                            </p>
                          </article>
                          <article className={focusClass("advanced-balance", "panel")} id="advanced-balance">
                            {/*
                             * ⚠️ 說明要**貼在這一塊上**（使用者 2026-09-15：
                             *   「請確保每個圖表都要有各自的不適用說明」）。
                             *   原本掛在兩塊外面，看表的人不會把兩者連起來。
                             */}
                            {/* ⚠️ X-50 更正：同上，時段與尖峰判定方式**有**跟著變。 */}
                            {advancedBlockNotes}
                            <InapplicableNote
                              show={
                                isFiltered(mainFilters, "movement") ||
                                isFiltered(mainFilters, "day") ||
                                isFiltered(mainFilters, "flowView") ||
                                isFiltered(mainFilters, "display")
                              }
                              text="這一塊不適用主工具列的「轉向別」「資料別」「路口流量視角」「顯示數值」：守恆檢核要把各支線的駛入與駛出放在同一小時一起看才算得出差值，單位固定是 PCU/hr。（時段、尖峰時段判定方式、車種這三項，這一塊是真的會跟著變的。）"
                              fields={[
                                "movement",
                                "day",
                                "flowView",
                                "display",
                              ]}
                            />
                            <div className="panel-head">
                              <div>
                                <span className="eyebrow">BRANCH BALANCE</span>
                                <h2>各支線流量平衡</h2>
                              </div>
                              <span className="status-dot">{scopeUnit(advancedPeak, "pcu", advancedCoverage)}</span>
                            </div>
                            <div className="table-scroll">
                              <table>
                                <thead>
                                  <tr>
                                    <th>支線</th>
                                    <th>駛入</th>
                                    <th>駛出</th>
                                    <th>差值</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {balance.map(function (item) {
                                    return (
                                      <tr key={item.id}>
                                        <td>{item.name}</td>
                                        <td>{item.inbound.toLocaleString()}</td>
                                        <td>
                                          {item.outbound.toLocaleString()}
                                        </td>
                                        <td>
                                          {item.difference.toLocaleString()}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            <p className="inline-note">
                              差值是該支線駛入與駛出的方向不平衡，不代表資料錯誤；整個路口的
                              OD 總量才應守恆。
                            </p>
                          </article>
                          <article className={focusClass("advanced-window-rank", "panel")} id="advanced-window-rank">
                            {/* peakSensitivity(record) 掃的是整段調查、固定 60 分鐘視窗。 */}
                            {alwaysIndependentNote(
                              /*
                               * ⚠️ 畫面上的字**不可以**用 Markdown 的 ** 粗體：
                               *   這一串是直接塞進 DOM 的純文字，星號會原樣印出來。
                               *   要強調就用「」。（tests/plaintext-markup.test.mjs 在守這一條）
                               */
                              "這一塊不受主工具列條件影響：它把整段調查裡「每一個」連續 60 分鐘的視窗都排一次名（固定 60 分鐘、固定 PCU/hr），用途正是「換一個時段會不會換一個尖峰」——跟著篩選走就失去意義了。",
                            )}
                            <div className="panel-head">
                              <div>
                                <span className="eyebrow">
                                  PEAK SENSITIVITY
                                </span>
                                <h2>連續 60 分鐘候選排行</h2>
                              </div>
                              {/*
                                這張表是 peakSensitivity(record) 算的，永遠是
                                60 分鐘視窗，值永遠是 PCU/hr，**不隨 peak 變動**。
                                舊版這裡寫 scopeUnit(peak)，選「全日時段」時標題
                                變成 PCU/調查日，同一張表的格子卻寫 PCU/hr，
                                面板自己跟自己矛盾。單位固定才是實話。
                              */}
                              <span className="status-dot">PCU/hr（固定 60 分鐘視窗）</span>
                            </div>
                            {sensitivity.length ? (
                              <div className="table-scroll">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>#</th>
                                      <th>時段</th>
                                      <th>交通量</th>
                                      <th>實際車輛</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sensitivity.map(function (item) {
                                      return (
                                        <tr key={item.start}>
                                          <td>{item.rank}</td>
                                          <td>
                                            {formatMinutes(item.start)}–
                                            {formatMinutes(item.end)}
                                          </td>
                                          <td>
                                            {item.pcu.toLocaleString()} PCU/hr
                                          </td>
                                          <td>
                                            {item.vehicles.toLocaleString()}{" "}
                                            輛/hr
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p>
                                此筆為舊版備份，未保存逐時段來源；重新匯入後即可比較相鄰與次高尖峰。
                              </p>
                            )}
                          </article>
                        </section>
                        {/*
                          * 兩張「尖峰形狀」的圖放在**整頁最底下、預設收合**——
                          * 使用者的定調：「優先度低，就放最底下」「平常用不上就收合」。
                          * 不適用的調查檔展開後會看到說明文字，不會畫一張假的圖。
                          */}
                        <PeakShapeCharts
                          focusedBlock={focusedBlock}
                          /* X-83：圖上要寫出季別與路名，並在多選時提醒。 */
                          quarterLabel={showQuarter(selected.quarter)}
                          selectedIntersectionCount={currentIntersectionCount}
                          selectedQuarterCount={mainQuarterCount}
                          /*
                           * ══════════════════════════════════════════════
                           *  X-50：這兩張圖原本**一句說明都沒有**
                           * ══════════════════════════════════════════════
                           * 使用者 2026-09-16 回報「轉向進階分析分頁裡面的
                           * 所有資料都不受主工具列的影響」，查下去發現這兩張
                           * 是整頁唯二完全沒有交代的——而既有的守門
                           * e2e-filter-coverage 是**整頁**判定（頁內有任何
                           * 數字變了就算過），所以一直是綠的，抓不到。
                           */
                          quarterNote={unusedConditionsNote(
                            [
                              "peakRule",
                              "flowView",
                              "day",
                              "vehicle",
                              "movement",
                              "display",
                            ],
                            "這張圖畫的是尖峰那一小時裡四格 15 分鐘的原始逐格流量，整個路口一起算、不分車種與轉向；它只跟著「尖峰時段」換一小時，其餘條件換了圖不會變。",
                          )}
                          windowNote={alwaysIndependentNote(
                            "這張圖不受主工具列任何條件影響：它畫的是一整天每一個連續 60 分鐘視窗的原始流量，用途正是「看尖峰小時挑得準不準」——跟著篩選走就失去意義了。",
                          )}
                          record={selected}
                          scope={advancedPeak}
                          scopeLabel={SCOPE_LABELS[advancedPeak]}
                          notify={notify}
                          chartStyle={CHART_SVG_STYLE}
                          exportPng={function (svgId, fileName) {
                            void svgElementToPng(svgId, fileName).then(
                              function (done) {
                                notify(
                                  done
                                    ? "已下載高解析圖片。"
                                    : "這張圖目前不在畫面上，請先展開再下載。",
                                );
                              },
                            );
                          }}
                        />
                      </>
                    );
                  })()}
            </>
          )}

          {view === "maintenance" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">DATA MAINTENANCE</span>
                  <h1>資料維護</h1>
                  <p>
                    只檢查可判定的缺值、總數一致性、尖峰時段與車種統計；實際調查到的方向流量高低不列為異常。
                  </p>
                  {/*
                   * ⚠️ 品質檢查看的是**原始資料本身**（有沒有缺值、加總對不對），
                   *   不是看某一個篩選條件下的數字。篩過之後再檢查，
                   *   被篩掉的那些問題就不會被發現——那正好是最危險的。
                   */}
                  {unusedConditionsNote(
                    ["peak", "flowView", "vehicle", "movement", "display"],
                    "品質檢查看的是原始資料本身（缺值、總數一致性、尖峰視窗、車種統計）。先篩再檢查的話，被篩掉的那些問題就永遠不會被發現。",
                  )}
                </div>
                <button className="primary" onClick={exportQualityExcel}>
                  下載季度品質 Excel
                </button>
              </section>
              {!projectRecords.length ? (
                renderNoData("尚無可檢查資料")
              ) : (
                <>
                  {/*
                   * ── X-8：刪除單一季度（三支統一的落點）─────────────
                   *
                   * 使用者 2026-09-16：「三份程式都有統一資料維護位置也都有
                   *   刪除單一季的功能……刪除單一季功能統一位置後，
                   *   "已匯入季度資料"功能就能移除掉了」
                   *
                   * ⚠️ 這裡**只換落點，不換行為**：呼叫的仍然是原本那一支
                   *   deleteQuarter()（會擋定稿、會二次確認、會連帶清還原點）。
                   *   在這裡另寫一份刪除邏輯的話，兩份遲早會分岔，
                   *   而分岔的症狀是「從某一個入口刪的沒有擋定稿」。
                   * ⚠️ 這一塊**不受主工具列條件影響**：刪的是整季的原始資料，
                   *   不是畫面上篩出來的那一份。這句話一定要寫出來。
                   */}
                  {/*
                   * ── X-85：季度改名（三支統一的落點，排在刪除上面）──────
                   *
                   * 使用者 2026-09-18：「請幫我將另外兩支也同步季度改名功能，
                   *   擺放位置可以參考全日交通量程式擺放的地方。」
                   *
                   * ⚠️ 這一塊**不受主工具列條件影響**：改的是整季的名稱，
                   *   不是畫面上篩出來的那一份。這句話一定要寫出來，
                   *   而且逐塊守門（e2e-filter-coverage）也要看得到。
                   */}
                  <section
                    className={focusClass(
                      "maintenance-rename-quarter",
                      "panel maintenance-delete",
                    )}
                    id="maintenance-rename-quarter"
                  >
                    <div className="panel-title">
                      <div>
                        <span>資料清理</span>
                        <h3>季度改名</h3>
                        <small>
                          改的是<b>整個季度</b>的名稱（這個計畫底下那一季的每一筆），
                          不是畫面上篩出來的那一份；這一塊不受主工具列條件影響。
                          改名會一併更新還原點裡記的季度。
                          <b>不會</b>把兩季合併：新名稱如果已經存在，系統會擋下來。
                        </small>
                      </div>
                    </div>
                    <p
                      className="chart-inapplicable"
                      data-testid="chart-inapplicable"
                      data-inapplicable="all"
                      data-inapplicable-always="1"
                    >
                      這一塊不受主工具列條件影響：改的是「整個季度」的名稱，不是畫面上篩出來的那一份。
                    </p>
                    <form
                      className="maintenance-delete-row"
                      onSubmit={renameQuarter}
                    >
                      <label>
                        新的季度名稱
                        <input
                          data-testid="maintenance-rename-quarter-input"
                          value={renameQuarterDraft}
                          onChange={function (event) {
                            setRenameQuarterDraft(
                              event.target.value.toUpperCase(),
                            );
                          }}
                          placeholder="例如115Q2或2026Q2"
                          required
                        />
                      </label>
                      <p className="maintenance-delete-impact">
                        {quarter
                          ? `目前要改的是「${quarterLabel(quarter)}」，共 ${
                              projectRecords.filter(function (record) {
                                return record.quarter === quarter;
                              }).length
                            } 筆。要改別季請先用主工具列切到那一季。`
                          : "目前沒有選到季度。"}
                      </p>
                      <button
                        type="submit"
                        className="primary"
                        data-testid="maintenance-rename-quarter-run"
                        disabled={!quarter || !renameQuarterDraft.trim()}
                      >
                        儲存新名稱
                      </button>
                    </form>
                  </section>
                  <section
                    className={focusClass(
                      "maintenance-delete-quarter",
                      "panel maintenance-delete",
                    )}
                    id="maintenance-delete-quarter"
                  >
                    <div className="panel-title">
                      <div>
                        <span>資料清理</span>
                        <h3>刪除單一季度</h3>
                        <small>
                          刪除的是<b>整個季度</b>的原始資料，不是畫面上篩出來的那一份；
                          這一塊不受主工具列條件影響。已定稿的季度會被擋下來，
                          請先到本頁下方把狀態改回草稿。
                        </small>
                      </div>
                    </div>
                    <div className="maintenance-delete-row">
                      <label>
                        季度
                        <select
                          data-testid="maintenance-delete-quarter-select"
                          value={deleteQuarterKey}
                          onChange={function (event) {
                            setDeleteQuarterKey(event.target.value);
                          }}
                        >
                          {quarters.map(function (q) {
                            return (
                              <option key={q} value={q}>
                                {quarterLabel(q)}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <p className="maintenance-delete-impact">
                        {deleteQuarterKey
                          ? `${quarterLabel(deleteQuarterKey)}：${
                              projectRecords.filter(function (record) {
                                return record.quarter === deleteQuarterKey;
                              }).length
                            } 個路口。刪除後可重新批次匯入。`
                          : "這個計畫目前沒有已匯入的季度。"}
                      </p>
                      <button
                        type="button"
                        className="danger-small"
                        data-testid="maintenance-delete-quarter-run"
                        disabled={!deleteQuarterKey}
                        onClick={function () {
                          if (deleteQuarterKey) deleteQuarter(deleteQuarterKey);
                        }}
                      >
                        刪除此季度
                      </button>
                    </div>
                  </section>
                  {/*
                   * ⚠️ 這四張卡**不吃任何主工具列條件**，而且要**逐塊講出來**
                   *   （不是只在頁首講一次）：e2e-filter-coverage 是逐塊看的，
                   *   頁首那一句掛在 .page-head 裡，這一塊自己讀不到。
                   *   更重要的是使用者：他捲到這裡時看到的是這一塊，不是頁首。
                   */}
                  {/*
                    ══════════════════════════════════════════════════
                     X-44：按過「執行資料異常檢查」才產生結果
                    ══════════════════════════════════════════════════

                    使用者 2026-09-16：「一個是事前預防，一個是事後檢查。」
                    匯入畫面的即時提醒擋在寫入之前；這一頁是使用者主動
                    要一份現況報告。兩者分開，看的人才分得出來。
                  */}
                  {/*
                   * ⚠️ X-59：這一塊進了側欄，外框樣式就**一定要走 focusClass**。
                   *   少了它，側欄那一項點下去雖然會捲過來，但畫面上完全不會
                   *   亮起來——使用者看不出跳到哪一塊。
                   *   （隔壁 #quality-summary 的註解記著同一個坑；這一塊
                   *     以前不在側欄裡，所以一直沒人發現。
                   *     2026-09-17 e2e-nav-layout 立刻抓到：「找不到被點名的區塊」。）
                   */}
                  <section
                    className={focusClass("quality-run", "panel maintenance-run")}
                    id="quality-run"
                  >
                    <div className="panel-title">
                      <div>
                        <span>事後檢查</span>
                        <h3>執行資料異常檢查</h3>
                        <small>
                          按下去才會產生下方的「資料異常檢查摘要」與「檢查結果」。
                          匯入時的即時提醒是另一件事（那是寫入前的預防），
                          這一頁看的是目前資料庫裡的現況。修正問題之後再按一次，
                          就能確認異常是不是真的消掉了。
                        </small>
                      </div>
                      <button
                        type="button"
                        className="primary"
                        data-testid="quality-run"
                        onClick={function () {
                          setQualityRunAt(new Date().toLocaleString("zh-TW"));
                          setQualityRunStamp(qualityDataStamp);
                          pruneOrphanAcks();
                        }}
                      >
                        執行資料異常檢查
                      </button>
                    </div>
                    <p className="maintenance-run-state" data-testid="quality-run-state">
                      {!qualityRunAt
                        ? "尚未檢查。"
                        : qualityRunStamp !== qualityDataStamp
                          ? `上次檢查：${qualityRunAt}　⚠️ 檢查之後資料又變動過了，結果已過期，請重新檢查。`
                          : /*
                             * ⚠️ 已確認的要從「需要注意」裡扣掉，否則按過確認之後
                             *   這一句仍然報同一個數字，使用者會以為確認沒有生效。
                             *   但兩個數字都要寫出來，否則看不出還有幾筆已處理。
                             */
                            ackedCount
                            ? `上次檢查：${qualityRunAt}　${currentIssues.length - ackedCount} 項需要注意、${ackedCount} 項已確認。`
                            : `上次檢查：${qualityRunAt}　共 ${currentIssues.length} 項需要注意。`}
                    </p>
                  </section>
                  {/*
                    * ⚠️ 這一塊的外框樣式一定要走 focusClass。
                    *   側欄有「資料異常檢查摘要」這一項、錨點也在，
                    *   所以點下去**會捲到這裡**——但少了 .is-focused，
                    *   畫面上完全不會亮起來，使用者看不出跳到哪一塊。
                    *   （2026-09-16 e2e-nav-layout 抓到：其餘兩塊都有，只有這一塊漏了。）
                    */}
                  <section
                    className={focusClass("quality-summary", "quality-grid")}
                    id="quality-summary"
                  >
                    {/*
                     * ⚠️ X-58（使用者 2026-09-17，附圖）：
                     *   「『資料異常檢查摘要』這個標題在欄位中沒看到，請修正」
                     *
                     *   側欄列著「資料異常檢查摘要」，點下去會捲到這裡、也會亮起來，
                     *   但這一塊**從來沒有標題**——畫面上只有一句灰字和四張卡。
                     *   使用者跳過來之後看不到自己點的那個名字，只能猜。
                     *   隔壁兩支（全日交通量、交通服務水準）都有 <h3>，這一支漏了。
                     *
                     * ⚠️ 標題文字必須與側欄那一項**逐字相同**，
                     *   否則等於換了一個名字，使用者照樣對不起來。
                     *   scripts/e2e-nav-heading.mjs 守這一條。
                     * ⚠️ 要橫跨整排（grid-column:1/-1），不然會被當成第五張卡。
                     */}
                    <div className="quality-grid-head">
                      <span>事後檢查結果</span>
                      <h3>資料異常檢查摘要</h3>
                    </div>
                    {/*
                     * ⚠️ 這句話原本寫「這一季匯入的全部資料」——**與程式不符**。
                     *   X-48 之後摘要卡數的是 currentIssues＝`issues`（全部季度），
                     *   而同一頁下面「檢查結果」那一塊的說明早就改寫成「全部季度」了。
                     *   同一頁兩句話講兩個範圍，照著讀的人會以為摘要只算當季。
                     *   （2026-09-17 自我稽核抓到；屬於「標籤與數字必須同一邊」那一類。）
                     */}
                    {alwaysIndependentNote(
                      "這四張卡不受主工具列條件影響：它們數的是這個計畫「全部季度」匯入的全部資料有幾項異常，先篩再數的話，被篩掉的地方有問題就永遠數不到。要只看某一季，請用下方「檢查結果」自己的季別下拉。",
                    )}
                    {(
                      [
                        "缺值",
                        "總數不一致",
                        "尖峰時段異常",
                        "車種統計異常",
                      ] as const
                    ).map(function (category) {
                      return (
                        <article className="panel" key={category}>
                          <span>{category}</span>
                          <strong>
                            {qualityRunAt ? (
                              <>
                                {
                                  currentIssues.filter(function (issue) {
                                    return issue.category === category;
                                  }).length
                                }{" "}
                                項
                              </>
                            ) : (
                              "—"
                            )}
                          </strong>
                          <small>
                            {category === "車種統計異常"
                              ? "僅比較同範圍的實際車輛數（輛/hr）"
                              : "依匯入規則即時檢查"}
                          </small>
                        </article>
                      );
                    })}
                  </section>
                  <section className="quality-layout">
                    <article className={focusClass("quality-reasons", "panel")} id="quality-reasons">
                      {/*
                       * ⚠️ X-48 之後檢查範圍是**全部季度**，不是主工具列選的那一季。
                       *   這句說明與下面的標題原本都還寫著「這一季」——程式改了、
                       *   畫面上的字沒跟著改，就是畫面在說謊。2026-09-16 一併更正。
                       */}
                      {alwaysIndependentNote(
                        "這一塊不受主工具列條件影響：資料異常檢查一律掃這個計畫「全部季度」匯入的全部資料，不是畫面上篩出來的那一份——否則篩掉的地方、或比較舊的那幾季有問題，就永遠檢查不到。要只看某一季，請用這一頁自己的「季別」下拉（不是主工具列的季度）。",
                      )}
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">ISSUE LIST</span>
                          <h2>檢查結果（全部季度）</h2>
                        </div>
                        {/*
                         * ⚠️ 這裡的「共 N 項」是**清單的總筆數**（含已確認），
                         *   不是「還有幾件要處理」——那一個在側欄與摘要卡。
                         *   兩者不同時，一定要把已確認的筆數寫出來，
                         *   否則使用者會以為自己按的確認沒有生效。
                         */}
                        <span className="status-dot">
                          {(issueTypeFilter.length
                            ? `顯示 ${shownIssues.length} / 共 ${currentIssues.length} 項`
                            : `${currentIssues.length} 項`) +
                            (ackedCount
                              ? `（其中 ${ackedCount} 項已確認）`
                              : "")}
                        </span>
                      </div>
                      {/*
                       * ══════════════════════════════════════════════════
                       *  類型標籤篩選
                       * ══════════════════════════════════════════════════
                       *
                       * 使用者 2026-09-13：
                       *   「我可以很直觀知道異常有幾個種類，可以**選擇最重大的
                       *     異常先挑出來看**哪幾筆，也不會因為筆數太多而沒注意到
                       *     細節……針對**需要使用者確認的表**，都可以套用這種
                       *     列表＋篩選的模式。」
                       *
                       * ⚠️ 這張清單本來就每一筆帶 category（類型），卻沒有任何
                       *   篩選——類型一多就只能整片看過去。
                       * ⚠️ 標籤的**筆數加總必須等於全列時的列數**，
                       *   否則使用者會以為某一類被吃掉了。
                       */}
                      {/*
                       * X-48：這一頁自己的季別下拉（不吃主工具列）。
                       * ⚠️ 只縮小**下方清單**，摘要卡永遠是全部季度的總數——
                       *   摘要卡回答的是「還有幾項沒處理」，縮小範圍會讓人
                       *   以為問題變少了。
                       */}
                      {currentIssues.length > 0 && (
                        <label className="issue-quarter-filter">
                          季別
                          <select
                            data-testid="issue-quarter-filter"
                            value={issueQuarterFilter}
                            onChange={function (event) {
                              setIssueQuarterFilter(event.target.value);
                            }}
                          >
                            <option value="">全部季度</option>
                            {[
                              ...new Set(
                                currentIssues.map(function (issue) {
                                  return issue.quarter;
                                }),
                              ),
                            ]
                              .sort()
                              .map(function (q) {
                                return (
                                  <option key={q} value={q}>
                                    {quarterLabel(q)}
                                  </option>
                                );
                              })}
                          </select>
                        </label>
                      )}
                      {currentIssues.length > 0 && (
                        <div className="anomaly-chips">
                          {issueTypeCounts.map(function ([type, count]) {
                            const on = issueTypeFilter.includes(type);
                            return (
                              <button
                                key={type}
                                type="button"
                                className={on ? "anomaly-chip on" : "anomaly-chip"}
                                aria-pressed={on}
                                onClick={function () {
                                  setIssueTypeFilter(function (previous) {
                                    return previous.includes(type)
                                      ? previous.filter(function (x) {
                                          return x !== type;
                                        })
                                      : [...previous, type];
                                  });
                                }}
                              >
                                {type}（{count}）
                              </button>
                            );
                          })}
                          {issueTypeFilter.length > 0 && (
                            <button
                              type="button"
                              className="anomaly-chip clear"
                              onClick={function () {
                                setIssueTypeFilter([]);
                              }}
                            >
                              清除篩選
                            </button>
                          )}
                          {/*
                           * 「顯示已確認」只在真的有已確認的項目時才出現——
                           * 一顆永遠寫著 0 的開關是噪音。
                           */}
                          {ackedCount > 0 && (
                            <button
                              type="button"
                              className={
                                showAckedIssues
                                  ? "anomaly-chip ack-toggle on"
                                  : "anomaly-chip ack-toggle"
                              }
                              aria-pressed={showAckedIssues}
                              data-testid="issue-ack-toggle"
                              onClick={function () {
                                setShowAckedIssues(!showAckedIssues);
                              }}
                            >
                              {showAckedIssues ? "隱藏已確認" : "顯示已確認"}（
                              {ackedCount}）
                            </button>
                          )}
                        </div>
                      )}
                      {!qualityRunAt ? (
                        <Empty
                          title="尚未檢查"
                          text="按上方「執行資料異常檢查」之後，這裡才會列出需要注意的項目。"
                        />
                      ) : currentIssues.length ? (
                        <div className="issue-list">
                          {shownIssues.map(function (issue) {
                            return (
                              <div
                                key={issue.id}
                                data-issue-id={issue.id}
                                className={
                                  issueAcked(issue) ? "issue-acked" : undefined
                                }
                              >
                                <span
                                  className={"severity " + issue.severity}
                                />
                                <b>{issue.category}</b>
                                <strong>{issue.station}</strong>
                                <div className="issue-body">
                                  <p>{issue.message}</p>
                                  {/*
                                   * ⚠️ X-47：原本這幾個數字只在右側「異常原因與計算方式」
                                   *   面板才看得到。使用者 2026-09-16 指名移除那一塊
                                   *  （「從檢查結果和檢查摘要中就可以完全覆蓋到所有異常原因」），
                                   *   所以先把數字搬進這一列，**再**移除那一塊——
                                   *   不是直接砍掉，那會連同資訊一起消失。
                                   */}
                                  {issue.details ? (
                                    <small className="issue-figures">
                                      左直右實際車輛合計{" "}
                                      {issue.details.turningVehicleTotal.toLocaleString()}{" "}
                                      {issue.details.unit}／各車種分類合計{" "}
                                      {issue.details.classifiedVehicleTotal.toLocaleString()}{" "}
                                      {issue.details.unit}／差異{" "}
                                      {issue.details.difference.toLocaleString()}{" "}
                                      {issue.details.unit}
                                      {issue.details.explanation
                                        ? `。${issue.details.explanation}`
                                        : ""}
                                      。若一邊是 PCU/hr、另一邊是輛/hr，系統不會比較，
                                      也不會報車種統計異常。
                                    </small>
                                  ) : (
                                    <small className="issue-figures">
                                      此項不是車種加總差異，請依上方訊息核對原始欄位。
                                    </small>
                                  )}
                                  {/*
                                   * ══════════════════════════════════════════
                                   *  X-49：解決方式（使用者 2026-09-16）
                                   * ══════════════════════════════════════════
                                   * 「我建議在檢查結果表中，新增一欄"解決方式"
                                   *  (例如重新匯入檔案、指引前往某分頁進行人工確認等)」
                                   *
                                   * ⚠️ 標籤（重新匯入／畫面修正／人工確認）是**期待管理**：
                                   *   標成「重新匯入」就是明講「一直按檢查也不會消失」，
                                   *   這正是使用者指名要的那一句。
                                   */}
                                  <div
                                    className="issue-resolution"
                                    data-testid="issue-resolution"
                                    data-kind={issue.resolution.kind}
                                  >
                                    <b
                                      className={
                                        "resolution-kind kind-" +
                                        (issue.resolution.kind === "重新匯入"
                                          ? "reimport"
                                          : issue.resolution.kind === "人工確認"
                                            ? "confirm"
                                            : "onscreen")
                                      }
                                    >
                                      {issue.resolution.kind}
                                    </b>
                                    <span>{issue.resolution.text}</span>
                                    {issue.resolution.view && (
                                      <button
                                        type="button"
                                        className="resolution-goto"
                                        onClick={function () {
                                          setView(
                                            issue.resolution.view as View,
                                          );
                                        }}
                                      >
                                        前往「{issue.resolution.viewLabel}」
                                      </button>
                                    )}
                                    {/*
                                     * 「指定調查日期」下拉（使用者 2026-09-20）。
                                     * 只有帶 choices 的異常有。
                                     *
                                     * ⚠️ 預設值刻意是空的「請指定…」，**不預選
                                     *   系統判讀的那一個**：預選的話使用者按下去
                                     *   也看不出自己到底有沒有做過選擇。
                                     */}
                                    {issue.choices?.length && issue.choiceScope ? (
                                      <label className="resolution-pick">
                                        指定調查日期
                                        <select
                                          data-testid="survey-date-pick"
                                          value={
                                            surveyDateMap[issue.choiceScope] || ""
                                          }
                                          onChange={function (event) {
                                            chooseSurveyDate(
                                              issue,
                                              event.target.value,
                                            );
                                          }}
                                        >
                                          <option value="">請指定…</option>
                                          {issue.choices.map(function (iso) {
                                            return (
                                              <option key={iso} value={iso}>
                                                {surveyDateInYearStyle(
                                                  iso,
                                                  yearStyle,
                                                ) || iso}
                                              </option>
                                            );
                                          })}
                                        </select>
                                      </label>
                                    ) : null}
                                    {issueCanAck(issue) && (
                                      <button
                                        type="button"
                                        className={
                                          issueAcked(issue)
                                            ? "resolution-ack on"
                                            : "resolution-ack"
                                        }
                                        data-testid="issue-ack"
                                        onClick={function () {
                                          toggleIssueAck(
                                            issueFingerprint(issue),
                                            !issueAcked(issue),
                                          );
                                        }}
                                      >
                                        {issueAcked(issue)
                                          ? "取消確認"
                                          : "已人工確認"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <Empty
                          title="沒有異常"
                          text="目前規則掃過全部季度，未發現需核對的項目。"
                        />
                      )}
                    </article>
                    {/* ⚠️ X-8：小分頁「異常原因與計算方式」指的就是這一塊，
                        所以 id 要掛在**這裡**。舊版把那個名字的 anchor 掛在
                        左欄的檢查結果清單上，點下去跳到的不是那個名字所指的東西。 */}
                    {/*
                     * ⚠️ X-47：這裡原本是「異常原因與計算方式」面板（#quality-detail）。
                     *   使用者 2026-09-16 指名移除：
                     *     「其實不需要異常原因與計算方式欄位，從檢查結果和檢查摘要中
                     *       就可以完全覆蓋到所有異常原因了，不用特地多這個重複性質的欄位」
                     *   面板裡才有的數字（左直右合計、各車種合計、差異、判定前提）
                     *   **已經先併進「檢查結果」每一列**，不是連同資訊一起砍掉。
                     *   ⚠️ 不要再加回來：同一份資訊出現在兩個地方，遲早會分岔。
                     */}
                  </section>
                </>
              )}
            </>
          )}

          {view === "names" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">NAME NORMALIZATION</span>
                  <h1>路口名稱管理</h1>
                  <p>
                    排除全半形、括號、站號、版本字尾與重複標點，保留道路真名；人工映射優先。
                  </p>
                </div>
              </section>
              {!canonicalRecords.length ? (
                renderNoData("尚無路口名稱")
              ) : (
                <section className="panel">
                  <div className="name-help">
                    <b>只管理「標準路口」，不是每季重改一次</b>
                    <p>
                      站號、歷次原始檔名與別名會留在系統內部協助辨識，不在此頁逐筆展開。能唯一判斷時自動新增或併入；只有無法判斷時，匯入預覽才會請您選擇「新增、併入或取消」。
                    </p>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>標準路口</th>
                          <th>標準名稱（一次修改、各季同步）</th>
                        </tr>
                      </thead>
                      <tbody>
                        {canonicalRecords.map(function (record) {
                          const key = recordIntersectionKey(record);
                          /*
                           * React key 不能用名稱衍生的 key。
                           * recordIntersectionKey 是從名稱算出來的，改名時
                           * 第一個字一打進去 key 就變了，React 會把整個 <tr>
                           * 拆掉重建——輸入框失焦，後面的字全部打不進去。
                           * 改用不會變的 intersectionId／id。
                           */
                          /*
                           * ⚠️ 記「改名前的名字」時，鍵**不可以用 key**。
                           *
                           * key 是 recordIntersectionKey(record)＝從名稱算出來的。
                           * 使用者打完字之後元件重新渲染，onBlur 那個閉包裡的 key
                           * 已經是**新名字**算出來的值——拿它去查 nameEditStart
                           * 一定查不到，別名於是永遠沒被建立（實測 aliases 是空的）。
                           *
                           * 這正是上面那段 <tr key> 註解警告過的同一個陷阱，
                           * 我在下一層又踩了一次。改用不會變的 intersectionId／id。
                           */
                          const stableKey = record.intersectionId || record.id;
                          return (
                            <tr key={stableKey}>
                              <td>{key}</td>
                              <td>
                                <input
                                  value={record.name}
                                  onFocus={function (e) {
                                    /*
                                     * ⚠️ 這一行必須放在**最前面**，在任何 return 之前。
                                     *
                                     * 我第一版把它放在這個 handler 的最後面，
                                     * 而底下「沒有任何一筆被鎖定就 return」是**最常見的路徑**
                                     * ——於是別名幾乎永遠沒被記下來。
                                     * 更糟的是另一條建立路徑（匯入時手動選併入）是好的，
                                     * 隨手測一下看起來就像正常，是守門測試逐條驗才抓到的。
                                     */
                                    nameEditStart.current[stableKey] =
                                      e.currentTarget.value;
                                    /*
                                     * 鎖定授權與還原點只做一次，在開始編輯時。
                                     * 舊版放在 onChange，等於每打一個字就跳一次
                                     * 確認視窗，鎖定的路口根本改不了名字。
                                     */
                                    const targets = records.filter(
                                      function (item) {
                                        return (
                                          item.projectId === record.projectId &&
                                          recordIntersectionKey(item) === key
                                        );
                                      },
                                    );
                                    if (
                                      !targets.some(function (item) {
                                        return Boolean(item.resultLock);
                                      })
                                    )
                                      return;
                                    if (
                                      !authorizeLockedChange(
                                        targets,
                                        "路口名稱修改",
                                      )
                                    ) {
                                      e.currentTarget.blur();
                                      return;
                                    }
                                    saveRevisions(targets, "路口名稱修改前");
                                  }}
                                  onBlur={function (e) {
                                    /*
                                     * ★ 改完名的當下建立「舊名 → 新名」別名。
                                     *
                                     * 放在 onBlur 而不是 onChange：onChange 每打一個字
                                     * 就觸發一次，會把「中山」「中山北」「中山北路」
                                     * 這些打到一半的字串全部記成別名。
                                     */
                                    const before = nameEditStart.current[stableKey];
                                    const after = e.currentTarget.value;
                                    delete nameEditStart.current[stableKey];
                                    if (!before || !after || before === after) return;
                                    const from = canonicalIntersectionKey(before);
                                    const to = canonicalIntersectionKey(after);
                                    /*
                                     * 正規化之後相同就不必記（例如只改了括號或全半形）——
                                     * 那種改名本來就比對得到。
                                     */
                                    if (!from || !to || from === to) return;
                                    setIntersectionAliases(function (existing) {
                                      const next = { ...existing };
                                      next[record.projectId + "|" + from] = to;
                                      /*
                                       * 已經指向舊名的別名要一起改指到新名。
                                       * 不然 A→B 之後再把 B 改成 C，A 會停在
                                       * 指向一個已經不存在的名字。
                                       */
                                      for (const [aliasKey, target] of Object.entries(next))
                                        if (
                                          target === from &&
                                          aliasKey.startsWith(record.projectId + "|")
                                        )
                                          next[aliasKey] = to;
                                      return next;
                                    });
                                    notify(
                                      "已記住「" +
                                        before +
                                        "」＝「" +
                                        after +
                                        "」，之後匯入同名調查表會自動併入，不會再問一次。",
                                    );
                                  }}
                                  onChange={function (e) {
                                    const value = e.target.value;
                                    // 只改「這個計畫」裡的同一個路口。這頁列出
                                    // 的本來就只有目前計畫的路口，但改名時是用
                                    // 路口鍵值比對全部記錄，別的計畫只要有同名
                                    // 路口就會一起被改掉，使用者在這個計畫改名，
                                    // 另一個計畫的名稱卻無聲跟著變。
                                    const inProject = function (
                                      item: TrafficRecord,
                                    ) {
                                      return (
                                        item.projectId === record.projectId &&
                                        recordIntersectionKey(item) === key
                                      );
                                    };
                                    setRecords(function (all) {
                                      return all.map(function (item) {
                                        return inProject(item)
                                          ? {
                                              ...item,
                                              name: value,
                                              nameEdited: true,
                                              resultLock: undefined,
                                            }
                                          : item;
                                      });
                                    });
                                  }}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {/*
                * ══════════════════════════════════════════════════════
                *  檔名別名清冊
                * ══════════════════════════════════════════════════════
                *
                * 使用者 2026-09-11：「路口轉向程式匯入檔案，針對路名有別名的
                * 設定嗎? 之前有說過三份程式都要有，這點我驗證不到」。
                *
                * ⚠️ 別名功能**本來就有**，改名的當下就會自動建立（見上面
                *   onBlur 那一段），匯入時也真的在用（matchRowsToIntersections）。
                *   問題是**畫面上完全看不到**——上面那段說明甚至明寫
                *   「別名會留在系統內部協助辨識，不在此頁逐筆展開」。
                *   使用者當然驗證不到；而且一旦記錯（例如把兩個不同路口
                *   記成同一個），也無從發現、無從刪除。
                *
                * 另外兩支程式都有可見的別名清冊（全日交通量在路段管理、
                * 交通服務水準在路段管理頁），這一支補上之後三支一致。
                */}
              <section
                className={focusClass("alias-list", "panel alias-panel")}
                id="alias-list"
              >
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">NAME ALIASES</span>
                    <h2>檔名別名清冊</h2>
                  </div>
                  <span className="status-dot">
                    {projectAliasRows.length} 筆
                  </span>
                </div>
                <p className="inline-note">
                  在路口名稱表改過名稱之後，系統會自動記住「舊名＝新名」，
                  下一季匯入同一份調查表時就直接併入，不會再問一次。
                  這裡列出目前這個計畫記住的每一筆；記錯了可以直接刪除，
                  <b>刪除不會影響任何已匯入的資料</b>。
                </p>
                {projectAliasRows.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>調查表裡的舊名稱</th>
                          <th>會併入的標準路口</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectAliasRows.map(function (row) {
                          return (
                            <tr key={row.aliasKey} data-alias-from={row.from}>
                              <td>{row.from}</td>
                              <td>{row.toLabel}</td>
                              <td>
                                <button
                                  className="danger-small"
                                  onClick={function () {
                                    if (
                                      !confirm(
                                        "要刪除「" +
                                          row.from +
                                          "」＝「" +
                                          row.toLabel +
                                          "」這筆別名嗎？\n\n已匯入的資料不會有任何改變；只是下次匯入同名調查表時會再問一次要不要併入。",
                                      )
                                    )
                                      return;
                                    setIntersectionAliases(function (existing) {
                                      const next = { ...existing };
                                      delete next[row.aliasKey];
                                      return next;
                                    });
                                    notify("已刪除別名「" + row.from + "」。");
                                  }}
                                >
                                  刪除
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="inline-note">
                    目前這個計畫還沒有任何別名。在路口名稱表改一次名稱，
                    系統就會自動建立一筆。
                  </p>
                )}
              </section>
            </>
          )}

          {view === "conclusion" && (
            <ConclusionStudio
              records={conclusionRecords}
              /*
               * ⚠️ 傳的是**取用函式**不是一份算好的資料：
               *   「各方向各自認定」要逐時段各挑一次，草稿的四個時段各要
               *   自己那一份。傳一份算好的等於四個時段共用同一個視窗——
               *   那正是 X-51 在脫離的圖上踩過的同一個坑。
               * ⚠️ 條件選「整個調查點同一時段」（預設）時回 null，
               *   toConclusionRecords 就走原路，輸出逐字不變。
               */
              peakRuleRecordFor={conclusionPeakRuleRecordFor}
              projectName={activeProject?.name || "未命名計畫"}
              templates={conclusionTemplates}
              setTemplates={setConclusionTemplates}
              notify={notify}
              condition={conclusionCondition}
              setCondition={setConclusionCondition}
              draft={conclusionDraft}
              setDraft={setConclusionDraft}
              edited={conclusionEdited}
              setEdited={setConclusionEdited}
              templateName={conclusionTemplateName}
              setTemplateName={setConclusionTemplateName}
              showQuarter={showQuarter}
              vehicleOptions={mainVehicleOptions}
              applyMainFilters={applyMainToConclusion}
            />
          )}

          {/*
           * ══════════════════════════════════════════════════════════
           *  X-61：「報表與批次輸出」拆成兩個大分頁（使用者 2026-09-17）
           * ══════════════════════════════════════════════════════════
           *
           * 使用者原話：「報告文字草稿單獨做一個右邊的畫面，名稱改為『成果交付』。
           *   然後分析數據excel、正式版多頁PDF、一件下載全部圖檔、目前路口像量圖、
           *   多計畫批次成果包，前4個都是窄的小卡形式，多計畫批次成果包是一個橫式大卡，
           *   所以4個在上，橫式在下的格式，在右邊單獨一個畫面」
           *   「我發現路口轉向程式 只有報表與批次輸出需要滾動畫面」
           *
           * ⚠️ 使用者自己先問了關鍵問題：「但我不確定報表與批次輸出下方的小分頁
           *   彼此之間是否都有關聯，不適合這樣拆分顯示?」——查證結果是**有**：
           *     「這個計畫要匯出哪些分析結果」（report-items）同時決定
           *       ① 報告文字草稿（draftSections）
           *       ② 分析數據 Excel（createAnalysisWorkbook 的預設 items）
           *       ③ 多計畫批次成果包（用每個計畫自己存的 reportItems）
           *   正式版多頁 PDF／一鍵下載全部圖檔／目前路口向量圖**不吃**它。
           *
           *   所以那排勾選留在「成果交付」，而「批次輸出」那兩張吃它的卡片上
           *   一定要把這條相依關係**寫在畫面上、而且點得過去**——
           *   否則使用者在這一頁按下 Excel，少了兩個項目，原因在他看不到的另一頁。
           *   那正是我們一路在抓的「畫面說謊」。
           */}
          {view === "delivery" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">DELIVERY</span>
                  <h1>成果交付</h1>
                  <p>
                    先勾選這個計畫要交出哪些分析結果，再產生報告文字草稿。
                    這一排勾選同時決定「批次輸出」頁的分析數據 Excel
                    與多計畫批次成果包的內容。
                  </p>
                </div>
              </section>
              <section className={focusClass("report-items", "panel report-items-panel")} id="report-items">
                <div className="report-items-head">
                  <div>
                    <span className="eyebrow">REPORT ITEMS</span>
                    <h2>這個計畫要匯出哪些分析結果</h2>
                    <p>
                      勾到的項目才會出現在 Excel 裡，一個項目一張工作表。
                      例如只要各路口駛出的尖峰流量，就只勾第一項；要車種分析加駛出流量，就勾兩項。
                      勾選會自動記在「{activeProject?.name || "目前計畫"}
                      」上，也可以另存成範本重複套用。範本專屬於這個計畫，
                      不會出現在其他計畫裡。
                    </p>
                  </div>
                  <div className="report-items-actions">
                    <button
                      className="secondary"
                      onClick={function () {
                        setActiveReportItems(
                          REPORT_ITEMS.map(function (item) {
                            return item.key;
                          }),
                        );
                      }}
                    >
                      全選
                    </button>
                    <button
                      className="secondary"
                      onClick={function () {
                        setActiveReportItems([]);
                      }}
                    >
                      全部取消
                    </button>
                  </div>
                </div>
                <div className="report-items-grid">
                  {REPORT_ITEMS.map(function (item) {
                    return (
                      <label
                        key={item.key}
                        className={
                          activeReportItems.includes(item.key) ? "selected" : ""
                        }
                      >
                        <input
                          type="checkbox"
                          aria-label={item.label}
                          checked={activeReportItems.includes(item.key)}
                          onChange={function () {
                            toggleReportItem(item.key);
                          }}
                        />
                        <span>
                          <b>{item.label}</b>
                          <small>{item.hint}</small>
                          <em>工作表：{item.sheet}</em>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="report-template-box">
                  <b>報表範本</b>
                  <div className="report-template-create">
                    <input
                      value={reportTemplateName}
                      placeholder="例如：A計畫－只要駛出尖峰流量"
                      onChange={function (e) {
                        setReportTemplateName(e.target.value);
                      }}
                    />
                    <button
                      className="secondary"
                      disabled={
                        !reportTemplateName.trim() || !activeReportItems.length
                      }
                      onClick={function () {
                        const name = reportTemplateName.trim();
                        setReportTemplates([
                          {
                            id: "RT-" + Date.now().toString(36),
                            name: name,
                            items: [...activeReportItems],
                            includeChart: activeReportItems.includes("trend"),
                            createdAt: new Date().toISOString(),
                          },
                          /*
                           * ⚠️ 同名覆寫的比對要過 typedNameKey()。
                           *   範本名稱是使用者自己打的，「季報用」與「季報 用」
                           *   在清單上分不出來；用原字串比的話不會覆寫，
                           *   而是多存一筆——之後按錯就套到舊條件
                           *  （例如還勾著去年的季度區間），而畫面看不出差別。
                           */
                          ...reportTemplates.filter(function (item) {
                            return typedNameKey(item.name) !== typedNameKey(name);
                          }),
                        ]);
                        setReportTemplateName("");
                        notify("已儲存報表範本「" + name + "」。");
                      }}
                    >
                      儲存目前勾選
                    </button>
                  </div>
                  {reportTemplates.length ? (
                    <div className="report-template-list">
                      {reportTemplates.map(function (template) {
                        return (
                          <div
                            className="report-template-row"
                            key={template.id}
                          >
                            <span>
                              <b>{template.name}</b>
                              <small>
                                {template.items
                                  .map(function (key) {
                                    return (
                                      REPORT_ITEMS.find(function (item) {
                                        return item.key === key;
                                      })?.label || key
                                    );
                                  })
                                  .join("、")}
                              </small>
                            </span>
                            <span>
                              <button
                                className="secondary"
                                onClick={function () {
                                  setActiveReportItems(
                                    normalizeReportItems(template.items),
                                  );
                                  notify(
                                    "已套用報表範本「" + template.name + "」。",
                                  );
                                }}
                              >
                                套用
                              </button>
                              <button
                                className="danger-small"
                                onClick={function () {
                                  setReportTemplates(
                                    reportTemplates.filter(function (item) {
                                      return item.id !== template.id;
                                    }),
                                  );
                                }}
                              >
                                刪除
                              </button>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="report-template-empty">
                      還沒有範本。勾好項目後輸入名稱按「儲存目前勾選」，之後換計畫按「套用」就能整組還原。
                    </p>
                  )}
                </div>
              </section>
              <section className={focusClass("report-draft", "panel report-draft-panel")} id="report-draft">
                <div className="report-items-head report-draft-head">
                  <div>
                    <span className="eyebrow">REPORT DRAFT</span>
                    <h2>報告文字草稿</h2>
                    <p>
                      <b>這一份是「這批 Excel 的說明文字」</b>：段落跟著上面勾選的匯出項目走，
                      勾了哪幾張工作表就寫哪幾段，會和 Excel 一起交出去。
                      要自己挑條件（只寫某一季、某幾個路口、只寫駛入流量…）請改用左側選單的
                      <b>「結論草稿產生器」</b>。兩邊的數字來源完全相同。
                      <br />
                      數字全部取自產生 Excel 的同一批計算，不會另外再算一次。
                      支線與車種這類不能跨路口、跨季度相加的敘述，會固定以一筆代表資料為準，並在文中寫明是哪一筆。
                    </p>
                  </div>
                  <div className="report-draft-head-actions">
                    {/*
                     * ⚠️ 小數位數要和結論草稿同一組選項（0／1／2），
                     *   否則同一批數字在兩份文件裡以不同位數出現，
                     *   而兩份都沒有一句話解釋為什麼。
                     *   草稿開頭的「統計條件」會把目前的位數寫出來。
                     */}
                    <label className="report-draft-digits">
                      小數位數
                      <select
                        data-testid="report-draft-digits"
                        value={String(reportDraftDigits)}
                        onChange={function (e) {
                          setReportDraftDigits(Number(e.target.value));
                          setReportDraftEdited(false);
                        }}
                      >
                        {[0, 1, 2].map(function (d) {
                          return (
                            <option key={d} value={d}>
                              {d} 位
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <button
                      className="secondary"
                      onClick={function () {
                        setDraftSectionOverride(null);
                      }}
                    >
                      跟著匯出勾選
                    </button>
                    <button
                      className="secondary"
                      onClick={function () {
                        setDraftSectionOverride([...DRAFT_SECTION_ORDER]);
                      }}
                    >
                      全選
                    </button>
                    <button
                      className="secondary"
                      onClick={function () {
                        setDraftSectionOverride([]);
                      }}
                    >
                      全部不勾
                    </button>
                  </div>
                </div>
                <div className="draft-section-chips">
                  {DRAFT_SECTION_ORDER.map(function (key) {
                    return (
                      <label
                        key={key}
                        className={
                          "chip-check" +
                          (draftSections.includes(key) ? " selected" : "")
                        }
                      >
                        <input
                          type="checkbox"
                          aria-label={DRAFT_SECTION_LABELS[key]}
                          checked={draftSections.includes(key)}
                          onChange={function () {
                            toggleDraftSection(key);
                          }}
                        />
                        <span>{DRAFT_SECTION_LABELS[key]}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="report-draft-box">
                  <textarea
                    aria-label="報告文字草稿"
                    value={reportDraftText}
                    placeholder="這個計畫在選定期間內還沒有可敘述的資料。"
                    onChange={function (e) {
                      setReportDraftText(e.target.value);
                      setReportDraftEdited(true);
                    }}
                  />
                  <div className="report-draft-actions">
                    <button
                      className="secondary"
                      onClick={function () {
                        setReportDraftEdited(false);
                        setReportDraftText(generatedReportDraft);
                        notify("草稿已依目前的匯出範圍重新產生。");
                      }}
                    >
                      重新產生
                    </button>
                    <button
                      className="secondary"
                      disabled={!reportDraftText.trim()}
                      onClick={function () {
                        // 沒有剪貼簿權限（http 或舊瀏覽器）時要講清楚，
                        // 不能靜靜失敗讓使用者以為複製成功了。
                        if (!navigator.clipboard?.writeText)
                          return notify(
                            "這個瀏覽器不允許程式複製，請手動選取草稿文字後複製。",
                          );
                        navigator.clipboard
                          .writeText(reportDraftText)
                          .then(function () {
                            notify("草稿全文已複製。");
                          })
                          .catch(function () {
                            notify(
                              "複製失敗，請手動選取草稿文字後複製。",
                            );
                          });
                      }}
                    >
                      複製全文
                    </button>
                    <button
                      className="secondary"
                      disabled={!reportDraftText.trim()}
                      onClick={function () {
                        downloadBlob(
                          new Blob(["﻿" + reportDraftText], {
                            type: "text/plain;charset=utf-8",
                          }),
                          (activeProject?.code || "Project") +
                            "_" +
                            (reportDraftContext?.quarterRange || "all") +
                            "_報告文字草稿.txt",
                        );
                      }}
                    >
                      下載 .txt
                    </button>
                    <span className="report-draft-note">
                      {reportDraftEdited
                        ? "已手動修改，改期間或改勾選都不會覆蓋掉；但切換計畫會重新產生，請先複製或下載。"
                        : "會隨匯出期間與勾選自動更新；只要開始手改就停止自動更新（切換計畫仍會重新產生）。"}
                    </span>
                  </div>
                </div>
              </section>
            </>
          )}
          {view === "batch" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">BATCH EXPORT</span>
                  <h1>批次輸出</h1>
                  <p>
                    Excel 保留可編輯數值、清楚欄名與單位；正式轉向圖輸出
                    PNG、SVG 或多頁 PDF。「多計畫批次成果包」可以把多個計畫一次打包。
                  </p>
                </div>
              </section>
              {selected && (
                <section
                  className={
                    "panel export-preflight " +
                    (collisionWarnings.length ? "has-warning" : "ready")
                  }
                >
                  <div>
                    <span className="eyebrow">EXPORT PREFLIGHT</span>
                    <h2>匯出前檢查 · {selected.station}</h2>
                    <p>
                      {collisionWarnings.length
                        ? collisionWarnings.join("；") +
                          "。可以到道路與流向管理拖曳圖卡位置調整；" +
                          "這只是版面提醒，四種匯出都不會被擋住。"
                        : "圖卡位置未偵測到重疊；日期、尖峰時段與單位會一併輸出。"}
                    </p>
                  </div>
                  <strong>
                    {collisionWarnings.length ? "建議調整" : "可匯出"}
                  </strong>
                </section>
              )}
              <section className="report-grid">
                <article className={focusClass("report-xlsx", "panel report-card")} id="report-xlsx">
                  <span className="file-type excel">XLS</span>
                  <h2>分析數據 Excel</h2>
                  {/*
                   * ⚠️ X-61：勾選那一排已經搬到「成果交付」那一頁了，
                   *   所以這裡**不可以**再寫「依上方勾選的…」——上方沒有那一排。
                   *   而這張卡的內容**真的**跟著它變，所以相依關係要
                   *   寫在畫面上、而且點得過去。看不到又改得動的東西最危險。
                   */}
                  <p>
                    依「成果交付」勾選的{" "}
                    <b>{activeReportItems.length}</b>{" "}
                    個項目輸出，一個項目一張工作表。
                    {activeReportItems.includes("trend")
                      ? "XLSX 另含可編輯折線圖。"
                      : "（未勾選歷季趨勢，因此不附折線圖。）"}
                  </p>
                  <button
                    type="button"
                    className="link-button report-items-link"
                    data-testid="report-xlsx-items-link"
                    onClick={function () {
                      setView("delivery");
                    }}
                  >
                    到「成果交付」調整要匯出哪些項目
                  </button>
                  <div className="report-range">
                    <label>
                      起始季度
                      <select
                        value={reportStartQuarter}
                        onChange={function (e) {
                          setReportStartQuarter(e.target.value);
                        }}
                      >
                        {quarters.map(function (item) {
                          return (
                            <option key={item} value={item}>
                              {quarterLabel(item)}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      結束季度
                      <select
                        value={reportEndQuarter}
                        onChange={function (e) {
                          setReportEndQuarter(e.target.value);
                        }}
                      >
                        {quarters.map(function (item) {
                          return (
                            <option key={item} value={item}>
                              {quarterLabel(item)}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    {/*
                     * ⚠️ 使用者 2026-09-14 對「結論草稿」與「報表」的裁示是
                     *   **維持獨立**，另加一顆「套用主工具列目前的條件」。
                     *   理由很實際：報表常常要輸出一個和畫面上不同的區間
                     *  （畫面在看最新一季、報表要出全年），
                     *   自動跟著主工具列走反而礙事。
                     *   但要一鍵對齊也得做得到——就是這一顆。
                     */}
                    <button
                      type="button"
                      className="secondary"
                      data-testid="reports-apply-main"
                      onClick={function () {
                        setReportStartQuarter(mainFilters.quarterFrom);
                        setReportEndQuarter(mainFilters.quarterTo);
                        notify(
                          "已套用主工具列的季度區間：" +
                            quarterLabel(mainFilters.quarterFrom) +
                            "～" +
                            quarterLabel(mainFilters.quarterTo) +
                            "。",
                        );
                      }}
                    >
                      套用主工具列目前的條件
                      <small>
                        {quarterLabel(mainFilters.quarterFrom)}～
                        {quarterLabel(mainFilters.quarterTo)}
                      </small>
                    </button>
                  </div>
                  <button
                    className="primary full"
                    disabled={!activeReportItems.length}
                    onClick={function () {
                      exportExcel("xlsx");
                    }}
                  >
                    下載新版 .xlsx
                  </button>
                  <button
                    className="secondary full"
                    disabled={!activeReportItems.length}
                    onClick={function () {
                      exportExcel("xls");
                    }}
                  >
                    下載舊版 .xls
                  </button>
                  {!activeReportItems.length && (
                    <p className="report-empty-hint">
                      目前一個分析項目都沒有勾選，請先在上方勾選要匯出的內容。
                    </p>
                  )}
                </article>
                <article className={focusClass("report-pdf", "panel report-card")} id="report-pdf">
                  <span className="file-type pdf">PDF</span>
                  <h2>正式版多頁 PDF</h2>
                  <p>採完整流向線版面，一頁一路口。</p>
                  <button
                    className="primary full"
                    onClick={function () {
                      exportPdf(current);
                    }}
                  >
                    產生 {current.length} 頁
                  </button>
                </article>
                <article
                  className={focusClass("report-chart-png", "panel report-card")}
                  id="report-chart-png"
                >
                  <span className="file-type png">PNG</span>
                  <h2>一鍵下載全部圖檔</h2>
                  <p>
                    每一張都是<b>白底、3 倍解析度、只有圖不含說明文字</b>
                    ——說明是簡報時用講的。
                  </p>
                  {/*
                   * ⚠️ 這裡只列得出「可以從資料直接重畫」的圖。
                   *
                   * 歷季趨勢圖與兩張尖峰形狀圖是**畫在畫面上的 JSX SVG**，
                   * 沒有開那一頁就根本不在 DOM 裡，在這裡按也抓不到。
                   * 硬做的話會變成「按了卻少幾張、而且不會說」——
                   * 少了東西比整個壞掉更危險，收到檔案的人看不出來。
                   * 所以那幾張誠實寫在下面，並且直接給一顆過去的按鈕。
                   */}
                  <label className="chart-png-pick">
                    <input
                      type="checkbox"
                      checked={chartPngPickDiagram}
                      onChange={function (e) {
                        setChartPngPickDiagram(e.target.checked);
                      }}
                    />
                    <span>
                      路口轉向圖
                      <small>本季 {current.length} 個路口，各一張</small>
                    </span>
                  </label>
                  <label className="chart-png-pick">
                    <input
                      type="checkbox"
                      checked={chartPngPickGeometry}
                      onChange={function (e) {
                        setChartPngPickGeometry(e.target.checked);
                      }}
                      disabled={!selected}
                    />
                    <span>
                      路口幾何示意圖
                      <small>
                        {selected
                          ? selected.station + "（目前選到的路口）"
                          : "尚未選到路口"}
                      </small>
                    </span>
                  </label>
                  <label className="chart-png-pick">
                    <input
                      type="checkbox"
                      checked={chartPngPickCard}
                      onChange={function (e) {
                        setChartPngPickCard(e.target.checked);
                      }}
                      disabled={!selected}
                    />
                    <span>
                      交通量圖卡排版
                      <small>
                        {selected
                          ? selected.station + "（含你拖曳過的圖卡位置）"
                          : "尚未選到路口"}
                      </small>
                    </span>
                  </label>
                  <button
                    className="primary full"
                    id="downloadAllChartPng"
                    data-chart-png="batch"
                    disabled={chartPngBusy}
                    onClick={exportAllChartPng}
                  >
                    {chartPngBusy ? "產生中…" : "下載勾選的圖檔（ZIP）"}
                  </button>
                  <p className="chart-png-elsewhere">
                    <b>歷季趨勢圖</b>與<b>尖峰形狀的兩張圖</b>
                    會跟著那一頁上選的條件（季度區間、視角、尖峰時段）變，
                    所以下載鈕就放在圖的旁邊。
                    <button
                      type="button"
                      className="ghost"
                      onClick={function () {
                        setView("trend");
                      }}
                    >
                      去歷季趨勢比較
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={function () {
                        setView("advanced");
                      }}
                    >
                      去轉向進階分析
                    </button>
                  </p>
                </article>
                <article className={focusClass("report-svg", "panel report-card")} id="report-svg">
                  <span className="file-type svg">SVG</span>
                  <h2>目前路口向量圖</h2>
                  <p>可無損縮放與排版。</p>
                  <button className="secondary full" onClick={exportSvg}>
                    下載 SVG
                  </button>
                </article>
              </section>
              {/*
                * ⚠️ 橫式大卡**單獨一列**在下面（使用者指定的版面：
                *   4 張窄卡在上、橫式在下）。它留在 .report-grid 裡面的話
                *   會被格線切成第 2 欄，跟窄卡一樣寬。
                */}
              <section className="report-grid report-grid-wide">
                <article className={focusClass("report-batch", "panel report-card batch-card")} id="report-batch">
                  <span className="file-type zip">ZIP</span>
                  <h2>多計畫批次成果包</h2>
                  <p>
                    依下方勾選的計畫與季度，將 Excel、PDF 與全部路口 PNG
                    一次打包。
                  </p>
                  {/*
                   * ⚠️ X-61：包裡每一個計畫的 Excel 用的是**那個計畫自己存的**
                   *   匯出項目（normalizeReportItems(project.reportItems)），
                   *   不是目前開著的這一個。這一句一定要寫出來——
                   *   否則使用者會以為「我剛剛勾的」會套用到全部計畫。
                   */}
                  <p className="report-card-note">
                    每個計畫用<b>它自己存的</b>匯出項目（在「成果交付」逐一設定），
                    不是目前這個計畫的勾選。
                  </p>
                  <button
                    type="button"
                    className="link-button report-items-link"
                    data-testid="report-batch-items-link"
                    onClick={function () {
                      setView("delivery");
                    }}
                  >
                    到「成果交付」調整要匯出哪些項目
                  </button>
                  <div className="batch-project-list">
                    {projects.map(function (project) {
                      return (
                        <label key={project.id}>
                          <input
                            type="checkbox"
                            checked={batchProjectIds.includes(project.id)}
                            onChange={function (e) {
                              setBatchProjectIds(function (ids) {
                                return e.target.checked
                                  ? Array.from(new Set([...ids, project.id]))
                                  : ids.filter(function (id) {
                                      return id !== project.id;
                                    });
                              });
                            }}
                          />
                          {project.code} · {project.name}
                        </label>
                      );
                    })}
                  </div>
                  <b className="batch-label">包含季度</b>
                  <div className="batch-project-list batch-quarter-list">
                    {allQuarterKeys.map(function (item) {
                      return (
                        <label key={item}>
                          <input
                            type="checkbox"
                            checked={batchQuarterKeys.includes(item)}
                            onChange={function (e) {
                              setBatchQuarterKeys(function (values) {
                                return e.target.checked
                                  ? Array.from(
                                      new Set([...values, item]),
                                    ).sort(compareQuarters)
                                  : values.filter(function (value) {
                                      return value !== item;
                                    });
                              });
                            }}
                          />
                          {showQuarter(item)}
                        </label>
                      );
                    })}
                  </div>
                  <button className="primary full" onClick={exportBatchPackage}>
                    下載批次成果 ZIP
                  </button>
                </article>
              </section>
              <section className="panel report-note">
                <b>Excel 編輯性</b>
                <p>
                  XLSX 的趨勢數據與折線圖均可在 Excel 直接修改；舊版 XLS
                  保留三類數據工作表，但不含原生圖表。轉向圖仍以 SVG／PNG／PDF
                  為正式成果。
                </p>
              </section>
            </>
          )}

          {view === "backup" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">BACKUP & RESTORE</span>
                  <h1>跨電腦備份與還原</h1>
                  <p>
                    A 電腦下載備份檔，B 電腦開啟同一個網站匯入即可接續。
                    <b>單一計畫</b>的備份匯入時是「併入」，
                    <b>全部計畫</b>的備份匯入時是「完整取代」。
                  </p>
                </div>
              </section>
              <section className="backup-grid">
                <article
                  className={focusClass("backup-one", "panel")}
                  id="backup-one"
                >
                  <span>01</span>
                  <h2>備份本計畫</h2>
                  <p>
                    {activeProject
                      ? "只含「" +
                        activeProject.name +
                        "」的季度資料、當量參數與車種設定，不會帶走其他計畫。到 B 電腦匯入時會併入，B 電腦原有的計畫不受影響。"
                      : "請先在「建立與管理計畫」選一個計畫。"}
                  </p>
                  <button
                    className="primary full"
                    disabled={!activeProject}
                    onClick={function () {
                      exportBackupJson(activeProjectId);
                    }}
                  >
                    下載本計畫 JSON
                  </button>
                  <button
                    className="secondary full"
                    disabled={!activeProject}
                    onClick={function () {
                      exportBackupZip(activeProjectId);
                    }}
                  >
                    下載本計畫 ZIP
                  </button>
                </article>
                <article
                  className={focusClass("backup-all", "panel")}
                  id="backup-all"
                >
                  <span>02</span>
                  <h2>備份全部計畫</h2>
                  <p>
                    這台電腦上的 {projects.length}{" "}
                    個計畫全部帶走，含名稱映射與各計畫的當量參數。
                    到 B 電腦匯入時會<b>完整取代</b>那台電腦上的資料。
                  </p>
                  <button
                    className="primary full"
                    onClick={function () {
                      exportBackupZip();
                    }}
                  >
                    下載 ZIP（全部計畫）
                  </button>
                  <button
                    className="secondary full"
                    onClick={function () {
                      exportBackupJson();
                    }}
                  >
                    下載 JSON（全部計畫）
                  </button>
                </article>
                <article
                  className={focusClass("backup-restore", "panel")}
                  id="backup-restore"
                >
                  <span>03</span>
                  <h2>還原計畫</h2>
                  <p>
                    ZIP 或 JSON 都可以。系統會自己判斷這是單一計畫還是全部計畫的
                    備份，並在動手前把「會併入」還是「會取代」寫清楚給您確認。
                  </p>
                  <label
                    className={`secondary full upload-label${dragZone === "restore" ? " drag-active" : ""}`}
                    data-dropzone="restore"
                    onDragEnter={function (e) {
                      e.preventDefault();
                      dragDepth(e.currentTarget, 1);
                      setDragZone("restore");
                    }}
                    onDragOver={function (e) {
                      e.preventDefault();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
                    }}
                    onDragLeave={function (e) {
                      e.preventDefault();
                      if (dragDepth(e.currentTarget, -1) === 0) setDragZone("");
                    }}
                    onDrop={function (e) {
                      e.preventDefault();
                      e.currentTarget.dataset.dragDepth = "0";
                      setDragZone("");
                      const files = e.dataTransfer?.files;
                      if (!files?.length) return;
                      /* 還原一次只處理一個檔，多拖幾個就取第一個並講清楚 */
                      if (files.length > 1)
                        notify(
                          `還原一次只收一個備份檔，已使用「${files[0].name}」。`,
                        );
                      restoreBackup(files[0]);
                    }}
                  >
                    選擇或拖曳備份檔
                    <input
                      hidden
                      type="file"
                      accept=".zip,.json"
                      onChange={function (e) {
                        if (e.target.files?.[0])
                          restoreBackup(e.target.files[0]);
                      }}
                    />
                  </label>
                </article>
              </section>
              {/*
               * ══════════════════════════════════════════════════════
               *  清除本機資料（危險區）
               * ══════════════════════════════════════════════════════
               *
               * 使用者 2026-09-12 問「這個一鍵清除本機資料是否有需要作?
               * 還是要拿掉?」——結論是**保留**，因為它清的東西和
               * 「刪計畫」「刪季度」**不一樣**：
               *   ・刪計畫 → 只清掉那個計畫的當量、車種目錄、車種對應
               *   ・刪季度 → 只清掉那一季的資料
               *   ・**跨計畫共用的東西**（站號→路口名稱對應、檔案格式記憶、
               *     報表範本）兩者都不清
               * 所以把計畫一個一個刪光，這台電腦仍然不是乾淨的。
               *
               * ⚠️ 但要講實話：**殘留的東西不會改到任何數字**。查證結果——
               *   ・formatMemories 是**只寫不讀**的（v2.1.54 起沒有任何地方
               *     拿它去影響解析，每次匯入都重讀表頭判斷格式）
               *   ・nameMap 只有「還原備份」時才會被填，日常使用不會累積
               *   ・reportTemplates 是範本，要按「套用」才生效
               *   ・當量、車種目錄、車種對應、路口別名**都是依計畫存的**，
               *     刪計畫時一起刪（別名的鍵是「計畫id｜舊名」，見 deleteProject）
               *   殘留的是範本與紀錄，占空間、也讓下一個委託案看到上一個案子的
               *   範本清單，但不會讓數字出錯。說明文字不可以寫成「會默默改到
               *   你的資料」——那是嚇人，而且不是事實。
               *
               * 同一輪加了三件事（使用者指定，三支一致）：
               *   (1) 確認視窗要寫出**代價**（幾個計畫、幾筆資料）
               *   (2) 沒下載過備份要先提醒一次
               *   (3) 說明要講清楚它和「刪計畫」差在哪
               */}
              <section
                className={focusClass("clear-local", "panel danger-zone")}
                id="clear-local"
              >
                <div>
                  <b>清除本機資料</b>
                  <p>
                    會清除所有計畫、資料與設定（含當量矩陣、車種目錄、車種對應、
                    格式範本、報表範本與版本紀錄），且不會恢復任何示範值；請先下載完整備份。
                  </p>
                  <p className="danger-zone-why">
                    <b>和「刪除計畫」差在哪？</b>
                    刪計畫會連同<b>那一個計畫</b>的當量、車種目錄、車種對應與
                    路口別名一起刪掉，所以
                    <b>不會影響你下一個計畫算出來的數字</b>。
                    {/*
                      * ⚠️ 這裡**不可以**寫「跨計畫」。
                      *   「跨計畫／多路口比較」那個功能已於 2026-09-09 依使用者
                      *   授權移除，e2e-removed-surfaces 會走過每一頁確認整站
                      *   再也看不到這三個字——2026-09-12 這段新加的說明就踩紅了它。
                      *   ⚠️ 正確的處理是**改文字**，不是放寬守門：
                      *     使用者畫面上已經沒有「跨計畫」這個概念，
                      *     寫「全部計畫共用」本來就比較好懂。
                      */}
                    留下來的是<b>全部計畫共用的範本與紀錄</b>——
                    報表範本、版本紀錄、檔案格式記憶。
                    它們不會改到任何數字，但會一直佔空間，
                    也會讓下一個委託案看到上一個案子的範本清單。
                    <br />
                    <b>什麼時候用這裡：</b>換一個委託案要從乾淨的狀態開始、
                    要把這台電腦或這個瀏覽器交給別人、
                    或想從空白狀態重現一個問題。
                  </p>
                </div>
                <button
                  onClick={function () {
                    /*
                     * (2) 沒下載過備份先提醒一次。
                     *   ⚠️ 只是提醒，不是禁止——使用者可能剛從別的機器還原，
                     *   或這台電腦上的資料本來就是可丟的測試資料。
                     *   擋住他反而會逼他去找別的方法清。
                     */
                    if (records.length && !hasDownloadedBackup) {
                      if (
                        !confirm(
                          "這次開啟程式之後還沒有下載過備份。\n\n" +
                            "清除之後沒有任何方式可以救回來。\n" +
                            "要先關掉這個視窗、去上面按「備份全部計畫」嗎？\n\n" +
                            "（按「確定」＝我知道，繼續清除；按「取消」＝先去備份）",
                        )
                      ) {
                        notify("已取消，資料沒有變動。請先下載一份完整備份。");
                        return;
                      }
                    }
                    /*
                     * (1) 確認視窗要寫出代價。
                     *   舊版只問「確定清除這台電腦內的 Turning Traffic 資料？」——
                     *   使用者按下去的那一刻，看不到自己要失去多少東西
                     *  （說明文字在卡片上，按鈕按下去時不一定還在畫面上）。
                     */
                    const lockedCount = records.filter(function (record) {
                      return Boolean(record.resultLock);
                    }).length;
                    if (
                      confirm(
                        "確定清除這台電腦內的 Turning Traffic 資料？\n\n" +
                          `將刪除 ${projects.length} 個計畫、${records.length} 筆路口季度資料` +
                          (lockedCount
                            ? `（其中 ${lockedCount} 筆已鎖定成果）`
                            : "") +
                          /* 同上：畫面與對話框都不可以再出現「跨計畫」。 */
                          "，\n以及全部計畫共用的設定：站號對到的路口名稱 " +
                          `${Object.keys(nameMap).length} 筆、路口別名 ` +
                          `${Object.keys(intersectionAliases).length} 筆、格式記憶 ` +
                          `${formatMemories.length} 筆、` +
                          `版本紀錄 ${recordRevisions.length} 筆。\n\n` +
                          "此動作無法復原。",
                      )
                    ) {
                      /*
                       * 「所有設定」就是所有設定。舊版只清了計畫與紀錄，
                       * 上一個委託案的當量係數、車種目錄與報表範本會留在
                       * 下一個案子裡繼續生效，而畫面上寫的是「已清除，
                       * 系統回到空白正式環境」。
                       */
                      setProjects([]);
                      setRecords([]);
                      setNameMap({});
                      setActiveProjectId("");
                      setQuarter("");
                      /*
                       * 一定要清整份 byProject。setPce 等是 scoped setter，
                       * 只會把預設值寫進「目前這個計畫」那一格，其他計畫的
                       * 當量矩陣、車種目錄與車種對照會原封不動留在
                       * 本機儲存裡——而按鈕上方明寫「會清除所有計畫、
                       * 資料與設定（含當量矩陣、車種目錄、車種對應…）」。
                       */
                      setPceByProject({});
                      setPceScopesByProject({});
                      setCatalogByProject({});
                      setMappingsByProject({});
                      setFormatMemories([]);
                      setReportTemplates([]);
                      setConclusionTemplates([]);
                      setRecordRevisions([]);
                      setMovementPresence({});
                      /*
                       * ⚠️ 路口名稱別名也要清。
                       *   舊版漏掉它，於是上一個委託案的「舊名→新名」對應
                       *   會留在下一個案子裡繼續生效——匯入時被默默併到
                       *   一個根本不屬於這個案子的路口上，而按鈕上方明寫
                       *   「會清除所有計畫、資料與設定」。
                       */
                      setIntersectionAliases({});
                      notify("已清除，系統回到空白正式環境。");
                    }
                  }}
                  id="clearLocalData"
                >
                  全部清除
                </button>
              </section>
            </>
          )}

          {view === "help" && (
            <>
              <section className="page-head help-head">
                <div>
                  <span className="eyebrow">BEGINNER GUIDE</span>
                  <h1>第一次使用 Turning Traffic</h1>
                  <p>
                    不需要先懂交通工程。依照下列順序操作，就能完成資料匯入、核對、轉向圖與成果輸出。
                  </p>
                </div>
                <div className="help-downloads">
                  <a
                    className="primary help-download"
                    href="./路口轉向程式手冊_v2.1.83.pdf"
                    /*
                     * ⚠️ download 一定要**帶檔名**，不可以只寫 `download`。
                     *
                     *   使用者 2026-09-14：「三份新手手冊下載下來，
                     *     檔案名稱都是『下載』」。
                     *
                     *   成因：`download` 沒有給值時，瀏覽器是**從網址推檔名**的。
                     *   正式站上 href 是 ./xxx.pdf，推得出來；但**單檔試用版**
                     *   會把手冊嵌成 data: URI，那種網址裡根本沒有檔名，
                     *   於是瀏覽器只好取預設值「下載」。
                     *
                     *   ⚠️ 我在測試裡看過這個現象（下載回報的檔名是 "download"），
                     *     卻把它當成「測試工具的假象」而放過——是錯的。
                     *     真正的使用者拿到的就是那個名字。
                     *     把檔名明確寫進 download，兩種情況都正確。
                     */
                    download="路口轉向程式手冊_v2.1.83.pdf"
                  >
                    下載新手手冊
                  </a>
                </div>
              </section>
              <section className="help-steps">
                <article className="panel">
                  <b>1</b>
                  <div>
                    <h2>建立計畫</h2>
                    <p>
                      計畫就像一個資料夾，例如「某工業區交通監測」。不同案件請分開建立，各自獨立保存，不會互相影響。
                    </p>
                    <button
                      onClick={function () {
                        setView("projects");
                      }}
                    >
                      前往建立與管理計畫
                    </button>
                  </div>
                </article>
                <article className="panel">
                  <b>2</b>
                  <div>
                    <h2>選擇年度與季度，再匯入</h2>
                    <p>
                      先指定資料屬於哪一年、哪一季，再放入
                      Excel。系統會辨識工作表、平假日、車種與路口流向。
                    </p>
                    <button
                      onClick={function () {
                        setView("import");
                      }}
                    >
                      前往季度批次匯入
                    </button>
                  </div>
                </article>
                <article className="panel">
                  <b>3</b>
                  <div>
                    <h2>先看品質檢查</h2>
                    <p>
                      確認日期、缺值、總量與未對應流向。警示不一定代表資料錯誤，但必須知道原因後再確認成果。
                    </p>
                    <button
                      onClick={function () {
                        setView("maintenance");
                      }}
                    >
                      前往資料維護
                    </button>
                  </div>
                </article>
                <article className="panel">
                  <b>4</b>
                  <div>
                    <h2>核對路口與道路方向</h2>
                    <p>
                      道路角度只決定圖怎麼畫，不會交換 A、B、C
                      的原始資料。多岔路請對照原始簡圖調整角度。
                    </p>
                    <button
                      onClick={function () {
                        setView("geometry");
                      }}
                    >
                      前往道路與流向管理
                    </button>
                  </div>
                </article>
                <article className="panel">
                  <b>5</b>
                  <div>
                    <h2>查看並整理轉向圖</h2>
                    <p>
                      可切換四種時段（上午尖峰／下午尖峰／全調查時段尖峰／全調查時段）、駛入／駛出、車種、五種顯示模式與版型。圖卡或「路口A」標籤重疊時，直接用滑鼠拖到想要的位置即可，放開才存檔。
                    </p>
                    <button
                      onClick={function () {
                        setView("diagram");
                      }}
                    >
                      前往路口轉向圖
                    </button>
                  </div>
                </article>
                <article className="panel">
                  <b>6</b>
                  <div>
                    <h2>匯出成果並備份</h2>
                    <p>
                      先在「成果交付」勾選這個計畫要的分析項目（可存成範本）並產生報告文字草稿，
                      再到「批次輸出」輸出 Excel、PDF 或圖片；最後下載完整備份 ZIP。
                    </p>
                    <button
                      onClick={function () {
                        setView("delivery");
                      }}
                    >
                      前往成果交付
                    </button>
                  </div>
                </article>
              </section>
              <section className={focusClass("help-glossary", "panel help-glossary")} id="help-glossary" data-nav-skip="explanation">
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">PLAIN LANGUAGE</span>
                    <h2>常用名詞白話說明</h2>
                  </div>
                </div>
                <div className="help-glossary-grid">
                  <article>
                    <b>PCU/hr</b>
                    <p>
                      每小時的小客車當量。不同車種乘上各自當量後，換算成可以相加比較的交通量。
                    </p>
                  </article>
                  <article>
                    <b>AM／PM Peak</b>
                    <p>上午／下午調查範圍內，連續一小時交通量最高的時段。</p>
                  </article>
                  <article>
                    <b>駛入路口</b>
                    <p>車輛穿越中央路口後，進入某一條道路支線的流量。</p>
                  </article>
                  <article>
                    <b>駛出路口</b>
                    <p>車輛從某一條道路支線出發，駛向中央路口的流量。</p>
                  </article>
                  <article>
                    <b>OD 流向</b>
                    <p>O 是從哪條支線出發，D 是最後進入哪條支線，例如 A→C。</p>
                  </article>
                  <article>
                    <b>圖卡位置</b>
                    <p>
                      用滑鼠把數據框或路口標籤拖到想要的位置，避免遮住道路或文字；完全不會改變計算結果。
                    </p>
                  </article>
                  <article>
                    <b>未對應流向</b>
                    <p>
                      系統讀到數量，但無法確定起點或終點。數量會保留並警示，不會自行猜測或刪除。
                    </p>
                  </article>
                  <article>
                    <b>成果鎖定</b>
                    <p>
                      核對完成後防止名稱、角度或當量被誤改；有需要仍可人工解除。
                    </p>
                  </article>
                </div>
              </section>
              <section className={focusClass("help-advanced", "panel help-advanced")} id="help-advanced" data-nav-skip="explanation">
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">WHEN TO USE</span>
                    <h2>進階功能什麼時候才需要？</h2>
                  </div>
                </div>
                {/*
                 * ⚠️ 這是一張**說明用的對照表**（哪個功能什麼時候才需要），
                 *   不是要使用者核對的資料——裡面沒有任何一個本計畫的數字。
                 *
                 *   守門判斷「純說明區塊」時會把表格算成「要核對的資料」，
                 *   所以這裡明講它是說明表。⚠️ 這個標記**不是萬用貼紙**：
                 *   守門仍然會檢查這一塊裡沒有按鈕／輸入／下拉，
                 *   而且標了說明表卻放進真實資料一樣看得出來（內容是寫死的）。
                 */}
                <table data-explanation-table="1">
                  <thead>
                    <tr>
                      <th>功能</th>
                      <th>用途</th>
                      <th>一般新手是否必須</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>流量核對工作台</td>
                      <td>
                        追查某個尖峰總量由哪些工作表、儲存格及 OD 流向加總而來。
                      </td>
                      <td>數值有疑問時使用</td>
                    </tr>
                    <tr>
                      <td>各路口尖峰彙總</td>
                      <td>
                        把這個計畫所有路口的尖峰時段、尖峰總量，以及各支線的駛出／駛入流量並排成表，一次看完。
                      </td>
                      <td>想一次看完所有路口時使用</td>
                    </tr>
                    <tr>
                      <td>轉向進階分析</td>
                      <td>
                        查看 OD 矩陣、駛入駛出平衡與其他可能的連續一小時尖峰；頁面最下方另有兩張尖峰形狀圖（尖峰小時內的四格
                        15 分鐘分布、整天每個連續 60
                        分鐘的流率），可以看出尖峰是「集中在某 15
                        分鐘」還是「整段都很平均」。
                      </td>
                      <td>完成基本成果後再看</td>
                    </tr>
                    <tr>
                      <td>車種轉向當量</td>
                      <td>調整各車種左轉、直行、右轉換算 PCU 的係數。</td>
                      <td>沿用既定係數時不用改</td>
                    </tr>
                    <tr>
                      <td>格式範本記憶</td>
                      <td>記住不同調查廠商的 Excel 版型，降低下次辨識錯誤。</td>
                      <td>系統自動處理</td>
                    </tr>
                    <tr>
                      <td>版本還原</td>
                      <td>重新匯入或修改後，回到先前保存的資料版本。</td>
                      <td>改錯資料時使用</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </>
          )}
        </div>
      </main>
      {/*
        * ── 套用尖峰時段設定之後跳出的說明視窗 ──────────────────
        *
        * 使用者 2026-09-12：「上、下尖峰時段的套用按鈕鍵，按確定時，
        *   可跳出需重新匯入的視窗」。
        *
        * ⚠️ 這不是禮貌性的提示，是**正確性的一部分**。
        *   按下套用之後，設定是新的、畫面上既有的數字卻仍是舊界線算出來的；
        *   不明講的話使用者會以為已經重算了，然後把兩種口徑的 AM Peak
        *   放進同一份報告比較。所以視窗裡要直接列出是哪幾筆還沒換。
        */}
      {/*
        * ══════════════════════════════════════════════════════════
        *  橫跨中午的尖峰小時：寫入前請使用者決定
        * ══════════════════════════════════════════════════════════
        *
        * 使用者 2026-09-12 指定的四個選項（編號與順序照他寫的）：
        *   1. 取消不匯入
        *   2. 忽略中間這個時段，正常以 00~12／12~24 區分上下午尖峰
        *   3. 將此時段歸類為上午尖峰
        *   4. 將此時段歸類為下午尖峰
        *
        * ⚠️ 預設停在第 2 項。預設不可以是第 3 或第 4——那等於替使用者做了
        *   會改變數字的決定；也不該預設第 1，一個手滑就變成整份不匯入。
        */}
      {noonAsked && noonQuestionRows.length > 0 && (
        /*
         * ⚠️ class 一定要用 presence-modal-backdrop，**不可以只寫
         *   modal-backdrop**——這一支程式的 .modal-backdrop 沒有任何樣式
         *  （它是另外兩支系統的 class，見 globals.css 的註解）。只寫它的話
         *   視窗會直接排進版面裡、被左側欄蓋住，按鈕點不到。
         *   瀏覽器實測抓到過：「<aside class="sidebar"> intercepts pointer events」。
         */
        <div className="modal-backdrop presence-modal-backdrop">
          <div className="modal presence-modal" role="dialog" aria-modal="true" id="noonQuestions">
            <div className="presence-head">
              <span className="eyebrow">NOON PEAK</span>
              <h3>
                有 {noonQuestionRows.length} 份調查，最忙的那一小時橫跨中午
              </h3>
              <p>
                系統把 AM Peak 定義為「中午 12:00 以前開始的那一小時」、
                PM Peak 為「12:00 以後開始的那一小時」。以下列出的調查，最忙的
                一小時<b>剛好跨過中午</b>（15 分鐘資料滾動計算時，或原始檔的
                時間格本身錯開時會發生）。它要算上午還是下午
                <b>不是程式判斷得了的事</b>，請您決定。
              </p>
            </div>
            <div className="presence-list">
              {noonQuestionRows.map(function (row) {
                const q = row.noonQuestion!;
                const current = row.noonSkip ? "skip" : (row.noonSide ?? "ignore");
                return (
                  <article key={row.file}>
                    <div className="presence-where">
                      <b>{row.name || row.station}</b>
                      <span>{row.file}</span>
                    </div>
                    <p className="noon-figures">
                      橫跨中午的一小時：<b>{q.label}</b>，{round1(q.total)} PCU
                      <br />
                      不算它的話，AM Peak 會是 {q.amLabel || "（沒有資料）"}
                      {q.amLabel ? `（${round1(q.amTotal)} PCU）` : ""}、
                      PM Peak 會是 {q.pmLabel || "（沒有資料）"}
                      {q.pmLabel ? `（${round1(q.pmTotal)} PCU）` : ""}。
                    </p>
                    <div className="noon-choices">
                      {(
                        [
                          ["skip", "1. 取消，這一份不要匯入（我要先檢查檔案）"],
                          ["ignore", "2. 忽略這個時段，照 00:00–12:00／12:00–24:00 分"],
                          ["am", "3. 這個時段算「AM Peak」"],
                          ["pm", "4. 這個時段算「PM Peak」"],
                        ] as [NoonSide | "skip", string][]
                      ).map(function (option) {
                        return (
                          <label key={option[0]}>
                            <input
                              type="radio"
                              name={`noon-${row.file}`}
                              value={option[0]}
                              checked={current === option[0]}
                              onChange={function () {
                                setNoonSide(row.file, option[0]);
                              }}
                            />
                            {option[1]}
                          </label>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                id="noonCancelAll"
                onClick={function () {
                  setNoonAsked(false);
                  setImportRows([]);
                  notify("已取消，這批資料沒有寫入。請檢查原始檔後再匯入一次。");
                }}
              >
                全部取消，都不要匯入
              </button>
              <button
                type="button"
                id="noonConfirm"
                onClick={function () {
                  commitImport();
                }}
              >
                依所選的歸屬寫入
              </button>
            </div>
          </div>
        </div>
      )}
      {presenceQuestions.length > 0 && (
        /*
         * 「這個轉向到底存不存在」的裁決視窗。
         *
         * 什麼時候跳：只有調查表**既沒有填數值、也沒有寫 `--`** 的轉向才會列進來。
         * 寫了數字（含 0）代表這個轉向存在，寫了 `--` 代表不存在，兩種都不必問。
         *
         * 為什麼一定要用視窗而不是寫在提醒裡：使用者的原話是
         * 「寫成提醒可能不會被注意到」。而這個答案會直接改變 OD 清單、
         * 轉向圖卡與各項成果，不是可有可無的訊息。
         *
         * 預設一律是「有這個轉向」（保留）——直接關掉視窗＝保留，
         * 因為保留最多是多一列 0，刪掉卻可能弄丟真實流向。
         *
         * 答案存進 movementPresence（跟著計畫存、跟著備份走），
         * 下一季匯入同一個路口就直接套用，**不會再問第二次**。
         */
        <div className="modal-backdrop presence-modal-backdrop">
          <div className="modal presence-modal" role="dialog" aria-modal="true">
            <div className="presence-head">
              <span className="eyebrow">MOVEMENT CHECK</span>
              <h3>這幾個轉向需要您確認存不存在</h3>
              <p>
                調查表用「<b>0</b>」表示「有這個轉向，只是整天沒有車」，
                用「<b>--</b>」表示「這個路口根本沒有這個轉向」。
                以下列出的 {presenceQuestions.length} 個轉向，
                系統無法自己下結論，需要您決定。
              </p>
              {presenceQuestions.some((item) => item.reason === "placeholder") && (
                <p className="presence-note">
                  其中有 <b>
                    {
                      presenceQuestions.filter(
                        (item) => item.reason === "placeholder",
                      ).length
                    }
                  </b>{" "}
                  條調查表<b>有畫橫線</b>、但橫線的數量超出這個路口的算術預期。
                  四岔以上的路口每個轉向本來都對應一個真實去向，
                  會畫橫線通常代表<b>禁止轉向或單行道</b>——那是真實的管制資訊，
                  所以不再像以前那樣直接移除不出聲。
                </p>
              )}
              <p className="presence-note">
                您的選擇會直接影響流向清單、路口轉向圖與各項成果；
                <b>同一個路口答過一次就會記住，之後每一季匯入不會再問。</b>
              </p>
            </div>
            <div className="presence-list">
              {presenceQuestions.map(function (item) {
                const answer = presenceDraft[item.key] || "yes";
                return (
                  <article key={item.key + "|" + item.routeId}>
                    <div className="presence-where">
                      <b>
                        {item.fromName} → {item.toName}（
                        {MOVE_LABELS[item.movement]}）
                      </b>
                      <small>
                        {item.station} {item.intersectionName}
                        {"　"}
                        {item.reason === "placeholder"
                          ? "調查表寫：--（有畫橫線）"
                          : "調查表寫：整欄空白（沒填）"}
                        {item.duplicatesFlowingRoute
                          ? "　⚠️ 這一組起訖另外還有一條有車流的流向，保留的話清單與轉向圖上會出現兩列"
                          : ""}
                      </small>
                      {item.basis && (
                        <small className="presence-basis">
                          系統建議「
                          {item.suggestion === "no"
                            ? "沒有這個轉向"
                            : "有這個轉向"}
                          」：{item.basis}
                        </small>
                      )}
                    </div>
                    <div className="presence-choice">
                      <label>
                        <input
                          type="radio"
                          name={"presence-" + item.key}
                          checked={answer === "yes"}
                          onChange={function () {
                            setPresenceDraft({
                              ...presenceDraft,
                              [item.key]: "yes",
                            });
                          }}
                        />
                        有這個轉向，只是量到 0
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={"presence-" + item.key}
                          checked={answer === "no"}
                          onChange={function () {
                            setPresenceDraft({
                              ...presenceDraft,
                              [item.key]: "no",
                            });
                          }}
                        />
                        沒有這個轉向，請移除
                      </label>
                    </div>
                  </article>
                );
              })}
            </div>
            <footer className="presence-actions">
              <button
                type="button"
                className="secondary"
                onClick={function () {
                  /*
                   * 「全部先保留」＝不做決定也不記住，下次匯入同一個路口還會再問。
                   * 這是刻意的：沒有表態就不要替使用者記一個答案。
                   *
                   * ⚠️ v2.1.56 的漏洞：這顆按鈕只清掉視窗，**沒有清掉流向上的
                   * presence: "unknown" 標記**，那個標記會一直留在資料與備份裡。
                   * 而組題目的那段是掃**全部**紀錄找 presence === "unknown"
                   * （不是只掃這次匯入的），所以按過一次「全部先保留」之後，
                   * 之後匯入**任何一個別的路口**，這些舊的未答項目都會被再抓出來
                   * 問一次——正是使用者抱怨過的「每次匯入都跳」那種毛病。
                   *
                   * 清掉標記不會讓系統忘記要問：重新匯入同一個路口時，
                   * recordFromPreview 會依調查表欄位重新判定成空白而再次發問。
                   */
                  setRecords(
                    records.map(function (record) {
                      if (!(record.routes ?? []).some((r) => r.presence))
                        return record;
                      return {
                        ...record,
                        routes: (record.routes ?? []).map(function (route) {
                          if (route.presence !== "unknown") return route;
                          const next = { ...route };
                          delete next.presence;
                          delete next.presenceReason;
                          delete next.presenceSuggestion;
                          delete next.presenceBasis;
                          return next;
                        }),
                      };
                    }),
                  );
                  setPresenceQuestions([]);
                  setPresenceDraft({});
                  notify(
                    "已全部保留為「有這個轉向、量到 0」。這次沒有記住答案，下次匯入同一個路口還會再問一次。",
                  );
                }}
              >
                全部先保留（不記住）
              </button>
              <button
                type="button"
                className="primary"
                onClick={function () {
                  const answers: Record<string, MovementPresence> = {};
                  const removeByRecord = new Map<string, Set<string>>();
                  for (const item of presenceQuestions) {
                    const answer = presenceDraft[item.key] || "yes";
                    answers[item.key] = answer;
                    if (answer === "no") {
                      const set =
                        removeByRecord.get(item.recordId) || new Set<string>();
                      set.add(item.routeId);
                      removeByRecord.set(item.recordId, set);
                    }
                  }
                  setMovementPresence({ ...movementPresence, ...answers });
                  const removedCount = [...removeByRecord.values()].reduce(
                    (sum, set) => sum + set.size,
                    0,
                  );
                  setRecords(
                    records.map(function (record) {
                      const remove = removeByRecord.get(record.id);
                      const cleaned = (record.routes ?? []).filter(function (
                        route,
                      ) {
                        return !(remove && remove.has(route.id));
                      });
                      return {
                        ...record,
                        routes: cleaned.map(function (route) {
                          if (route.presence !== "unknown") return route;
                          /*
                           * 待裁決期間才有的四個欄位一起清掉。
                           * 少清一個就會留在備份與匯出裡，變成永遠洗不掉的
                           * 「還沒答」痕跡。
                           */
                          const next = { ...route };
                          delete next.presence;
                          delete next.presenceReason;
                          delete next.presenceSuggestion;
                          delete next.presenceBasis;
                          return next;
                        }),
                      };
                    }),
                  );
                  setPresenceQuestions([]);
                  setPresenceDraft({});
                  notify(
                    removedCount
                      ? "已移除 " +
                          removedCount +
                          " 條「沒有這個轉向」的流向，其餘保留；答案已記住，下次匯入同一個路口不會再問。"
                      : "已全部保留為「有這個轉向、量到 0」；答案已記住，下次匯入同一個路口不會再問。",
                  );
                }}
              >
                套用並記住
              </button>
            </footer>
          </div>
        </div>
      )}
      {toast && (
        <button
          type="button"
          className={"toast" + (toast.length > 60 ? " toast-long" : "")}
          onClick={function () {
            toastTokenRef.current += 1;
            setToast("");
          }}
          title="點一下關閉"
        >
          ○ {toast}
        </button>
      )}
    </div>
  );
}

/**
 * 結論草稿產生器。
 *
 * 使用者自己勾條件（範圍／時段／路口／支線／指標／分段方式），系統照著寫。
 * 產生的文字可以直接手改，改過之後不會被自動覆蓋——只有再按一次
 *「產生草稿」才會蓋掉，而且會先問過。條件可以存成範本重複使用。
 */
/*
 * 年度是「115」這種光年份的字串，沒有 Qn，showQuarter() 認不得。
 * 借一個季度殼子換算完再把 Qn 去掉；換不成就原樣回傳。
 */
function showYearOnly(year: string, show: (value: string) => string) {
  const match = String(show(String(year) + "Q1")).match(/^(\d{2,4})Q1$/);
  return match ? match[1] : String(year);
}

function ConclusionStudio(props: {
  records: TrafficRecord[];
  projectName: string;
  templates: ConclusionTemplate[];
  setTemplates: (value: ConclusionTemplate[]) => void;
  notify: (value: string) => void;
  /*
   * 條件與草稿刻意「不」放在這個元件裡。
   *
   * 切到別的分頁時這個元件會被卸載，狀態跟著消失——使用者設好一整組條件、
   * 產生了草稿，只是去看一眼路口轉向圖再回來，文字就全部不見了。
   * 狀態放在上層元件（它整個 session 都不會卸載），切分頁才留得住。
   */
  condition: ConclusionCondition;
  setCondition: (value: ConclusionCondition) => void;
  draft: string;
  setDraft: (value: string) => void;
  edited: boolean;
  setEdited: (value: boolean) => void;
  templateName: string;
  setTemplateName: (value: string) => void;
  /*
   * 季度要顯示成民國年還是西元年。只換看到的字：下拉選單的 value、篩選、
   * 排序與分組一律走儲存的季度字串，切換不會挑到不同的資料。
   */
  showQuarter: (value: string) => string;
  /**
   * 車種下拉要列的選項（[代碼, 名稱]）。
   *
   * ⚠️ 一定要沿用主工具列那一份（mainVehicleOptions），不可以另外查一次目錄：
   *   目錄是計畫層級、只增不減的原始車種表，會列出已經被併走的車種，
   *   兩邊各查各的遲早給出不同的名字。
   */
  vehicleOptions: [string, string][];
  /*
   * 「套用主工具列目前的條件」那一顆。
   *
   * ⚠️ 使用者 2026-09-14 裁示：結論草稿與報表**維持獨立**，不自動跟著
   *   主工具列跑——這兩頁常常要出一份和畫面上不同的範圍（畫面看最新一季、
   *   報告要出全年）。但要一鍵對齊也得做得到，就是這一顆。
   *   回傳一段文字說明「套用了什麼」，由這裡 notify 出去，
   *   不可以默默改掉使用者設好的一整組條件。
   */
  applyMainFilters: () => string;
  /** 見上面 JSX 的說明；undefined ＝「整個調查點同一時段」（預設）。 */
  peakRuleRecordFor?: (
    scope: ScopeKey,
    record: TrafficRecord,
  ) => {
    record: TrafficRecord;
    windows: Record<string, { start: number; end: number } | null>;
  } | null;
}) {
  const { condition, setCondition, draft, setDraft, edited, setEdited, templateName, setTemplateName } =
    props;

  const source = useMemo(
    function () {
      return toConclusionRecords(props.records, props.peakRuleRecordFor);
    },
    [props.records, props.peakRuleRecordFor],
  );

  const quarters = useMemo(
    function () {
      return Array.from(new Set(source.map((record) => record.quarter))).sort(
        function (a, b) {
          return conclusionQuarterKey(a) - conclusionQuarterKey(b);
        },
      );
    },
    [source],
  );
  const years = useMemo(
    function () {
      return Array.from(
        new Set(source.map((record) => quarterYear(record.quarter)).filter(Boolean)),
      ).sort();
    },
    [source],
  );
  const intersections = useMemo(
    function () {
      return Array.from(
        new Map(
          source.map((record) => [
            record.intersectionKey,
            record.station + "　" + record.name,
          ]),
        ).entries(),
      );
    },
    [source],
  );
  const surveyTypes = useMemo(
    function () {
      return Array.from(new Set(source.map((record) => record.surveyType))).sort();
    },
    [source],
  );
  /*
   * 支線清單只列「目前所選路口」有的，否則選單會長到不能看。
   *
   * ⚠️ 分類鍵是**名稱的比對鍵**（typedNameKey），不是原字串、也不是代碼。
   *
   * 使用者 2026-09-11 實測：
   *   「A 和 B 路段系統都是用匯入後讀取的預設名稱『路口A』～『路口D』，
   *     那在結論草稿那邊就能正常抓到。但如果 C 路段自動讀到的是『神農路口』，
   *     那就算我手動改成『路口A』，他也不會被歸類到路口A裡面。
   *     除非我 A 和 B 路段也手動輸入一次一模一樣的『路口A』才會歸在一起。」
   *
   * 成因不是「預設的」與「手動的」被分成兩類，是**自動命名多了一個空格**：
   * inferApproachGeometry() 產生的是 `"路口 " + code`（「路口」與代碼之間
   * 有半形空格），而使用者手打的是「路口A」。`路口 A` ≠ `路口A`。
   * 正規化之後，「只要名稱相同就歸在一起」才真的成立。
   *
   * ⚠️ 一度改成用代碼分類，被使用者否決，理由是對的：
   *   「假設哪一天檔案第一條支線其實是路口D，只是這份資料不小心被挪到了
   *     第一支線的位置，原本我希望我可以自己手動去修改名稱後，
   *     讓程式把同樣名稱歸類在一起，現在反而作不到。」
   *   代碼是檔案給的位置，名稱才是使用者可以修正的事實。
   *
   * 顯示規則：平常就寫名稱本身；同一個名稱橫跨兩個以上的代碼時
   *（也就是上面那種挪位的情形）才把代碼一起標出來，讓使用者看得出來。
   */
  const branchOptions = useMemo(
    function () {
      const keys = condition.intersectionKeys;
      const byKey = new Map<
        string,
        { label: string; codes: Set<string> }
      >();
      for (const record of source) {
        if (keys.length && !keys.includes(record.intersectionKey)) continue;
        for (const peak of PEAK_KEYS)
          for (const branch of record.peaks[peak]?.branches || []) {
            const key = typedNameKey(branch.name);
            if (!key) continue;
            const entry = byKey.get(key) || {
              /* 第一個遇到的原字串當代表，畫面照樣顯示使用者熟悉的樣子 */
              label: branch.name,
              codes: new Set<string>(),
            };
            if (branch.code) entry.codes.add(branch.code);
            byKey.set(key, entry);
          }
      }
      return Array.from(byKey)
        .sort(function (a, b) {
          return a[1].label.localeCompare(b[1].label, "zh-Hant");
        })
        .map(function ([key, entry]) {
          const codes = Array.from(entry.codes).sort();
          return {
            key,
            label:
              codes.length > 1
                ? `${entry.label}（涵蓋支線 ${codes.join("、")}）`
                : entry.label,
          };
        });
    },
    [source, condition.intersectionKeys],
  );

  const matched = useMemo(
    function () {
      return selectRecords(source, condition).length;
    },
    [source, condition],
  );

  /* 草稿框在整頁最下面；按完要確認它真的在使用者眼前。 */
  const draftBoxRef = useRef<HTMLElement | null>(null);

  const patch = function (next: Partial<ConclusionCondition>) {
    setCondition({ ...condition, ...next });
  };
  const toggle = function <T,>(list: T[], value: T): T[] {
    return list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];
  };

  function generate(force = false) {
    if (edited && !force) {
      if (
        !window.confirm(
          "您已經手動修改過草稿。重新產生會覆蓋掉修改內容，確定要繼續嗎？",
        )
      )
        return;
    }
    const now = new Date();
    const stamp =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0") +
      " " +
      String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0");
    setDraft(
      buildConclusion(source, condition, {
        projectName: props.projectName,
        systemVersion: VERSION,
        generatedAt: stamp,
        /* 草稿上的季度跟著畫面的年份顯示切換走；篩選與排序仍走儲存值。 */
        showQuarter: props.showQuarter,
        /* ⚠️ 車種名稱走主工具列那一份選項，草稿不查目錄（免得兩邊名字不同）。 */
        vehicleLabel:
          !condition.vehicle || condition.vehicle === "all"
            ? "全部車種"
            : props.vehicleOptions.find(function (entry) {
                return entry[0] === condition.vehicle;
              })?.[1] || condition.vehicle,
      }),
    );
    setEdited(false);
    props.notify("結論草稿已產生。");
    /*
     * 唯一的「產生草稿」就在草稿框旁邊，所以正常情況下結果本來就在眼前，
     * revealResult() 會判斷「已經看得到」而完全不動。保留是為了少數例外
     * ——視窗特別矮、或草稿變長把框推出畫面外。
     * 等 React 把新草稿畫完再量位置，否則量到的是舊高度。
     */
    requestAnimationFrame(() => revealResult(draftBoxRef.current));
  }

  const scope = condition.scope;

  return (
    <>
      <section className="page-head">
        <div>
          <span className="eyebrow">CONCLUSION STUDIO</span>
          <h1>結論草稿產生器</h1>
          <p>
            <b>這一份是「您自己出題」</b>：自己勾選統計範圍、時段、路口、支線與要寫哪些數字，
            系統照著條件寫出結論，和 Excel 匯出無關。
            要產生「這批 Excel 的說明文字」請用「成果交付」裡的<b>報告文字草稿</b>。
            兩邊的數字來源完全相同，都取自畫面與 Excel 用的同一組計算，不會另外再算一次。
          </p>
        </div>
        {/*
         * 這裡原本另有一顆「產生草稿」，和草稿框旁邊那一顆呼叫同一個函式。
         * 使用者指出實際動線用不到它：條件與條件範本都在下方，
         *「哪怕條件沒變，為了確保資料正確，正常情況下仍會往下滑動確認條件」，
         * 所以每一條動線最後都停在草稿框旁邊。兩顆同名按鈕反而讓人以為有差別，
         * 也可能讓新手在還沒勾任何條件時就按下去，拿到一份用預設條件產生的草稿。
         */}
      </section>

      {!source.length ? (
        <Empty
          title="這個計畫還沒有調查資料"
          text="請先到「季度批次匯入」匯入調查檔，再回來產生結論草稿。"
        />
      ) : (
        <>
          <section className="panel conclusion-panel">
            <div className="conclusion-head">
              <div>
                <span className="eyebrow">CONDITIONS</span>
                <h2>條件設定</h2>
              </div>
              <div className="conclusion-head-actions">
                <button
                  type="button"
                  className="secondary"
                  data-testid="conclusion-apply-main"
                  onClick={function () {
                    props.notify(props.applyMainFilters());
                  }}
                >
                  套用主工具列目前的條件
                </button>
                <b className={matched ? "conclusion-count" : "conclusion-count zero"}>
                  符合條件 {matched} 筆
                </b>
              </div>
            </div>

            <div className="conclusion-grid">
              <fieldset className="conclusion-field">
                <legend>一、統計範圍</legend>
                <div className="conclusion-radios">
                  {(
                    [
                      ["quarter", "單一季度"],
                      ["year", "某一年度"],
                      ["range", "季度區間"],
                      ["project", "整個計畫"],
                    ] as const
                  ).map(function (entry) {
                    return (
                      <label key={entry[0]}>
                        <input
                          type="radio"
                          name="conclusion-scope"
                          checked={scope.kind === entry[0]}
                          onChange={function () {
                            if (entry[0] === "quarter")
                              patch({
                                scope: {
                                  kind: "quarter",
                                  quarter: quarters.at(-1) || "",
                                },
                              });
                            else if (entry[0] === "year")
                              patch({
                                scope: { kind: "year", year: years.at(-1) || "" },
                              });
                            else if (entry[0] === "range")
                              patch({
                                scope: {
                                  kind: "range",
                                  from: quarters[0] || "",
                                  to: quarters.at(-1) || "",
                                },
                              });
                            else patch({ scope: { kind: "project" } });
                          }}
                        />
                        {entry[1]}
                      </label>
                    );
                  })}
                </div>
                {scope.kind === "quarter" && (
                  <label className="conclusion-inline">
                    季度
                    <select
                      value={scope.quarter}
                      onChange={function (e) {
                        patch({ scope: { kind: "quarter", quarter: e.target.value } });
                      }}
                    >
                      {quarters.map((q) => (
                        <option key={q} value={q}>
                          {props.showQuarter(q)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {scope.kind === "year" && (
                  <label className="conclusion-inline">
                    年度
                    <select
                      value={scope.year}
                      onChange={function (e) {
                        patch({ scope: { kind: "year", year: e.target.value } });
                      }}
                    >
                      {years.map((y) => (
                        <option key={y} value={y}>
                          {showYearOnly(y, props.showQuarter)} 年
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {scope.kind === "range" && (
                  <div className="conclusion-inline">
                    <label>
                      起
                      <select
                        value={scope.from}
                        onChange={function (e) {
                          patch({
                            scope: { kind: "range", from: e.target.value, to: scope.to },
                          });
                        }}
                      >
                        {quarters.map((q) => (
                          <option key={q} value={q}>
                            {props.showQuarter(q)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      迄
                      <select
                        value={scope.to}
                        onChange={function (e) {
                          patch({
                            scope: {
                              kind: "range",
                              from: scope.from,
                              to: e.target.value,
                            },
                          });
                        }}
                      >
                        {quarters.map((q) => (
                          <option key={q} value={q}>
                            {props.showQuarter(q)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </fieldset>

              <fieldset className="conclusion-field">
                <legend>二、時段、資料別、轉向別與車種</legend>
                {/*
                  這裡是兩件不同的事：上排是「哪一個尖峰」，下排是「平日還是
                  假日」。以前兩排長得一模一樣又沒有小標，「待設定」看起來
                  像是第三個尖峰時段。
                */}
                <span className="conclusion-sublabel">時段</span>
                <div className="conclusion-checks">
                  {/*
                   * ⚠️⚠️ **四個核心統計範圍，一個都不能少。**
                   *
                   *   使用者 2026-09-21 定案：「上午尖峰、下午尖峰、全調查時段
                   *   和全調查時段尖峰，各有各的意義」「這 4 個名詞是我們交通
                   *   調查的 4 個核心」「正確做法應該是把全調查時段做為第 4 個
                   *   可勾選選項」。
                   *
                   *   v2.1.80 以前這裡只有三顆（上午／下午／全調查時段尖峰），
                   *   「全調查時段」是靠**四顆都不勾**這個看不見的狀態表達的。
                   *   兩個後果：
                   *     ・沒辦法同時要「上午尖峰」和「全調查時段」；
                   *     ・畫面上得放一句說明去教使用者一個看不見的狀態。
                   *   **不要把 FULL 這一顆拿掉，也不要把隱藏狀態加回來。**
                   *
                   *   順序照四個核心的講法排：上午 → 下午 → 全調查時段 →
                   *   全調查時段尖峰（「整段的量」排在「其中最大那一小時」前面）。
                   */}
                  {(
                    [
                      ["AM", "上午尖峰"],
                      ["PM", "下午尖峰"],
                      ["FULL", "全調查時段"],
                      ["DAY", "全調查時段尖峰"],
                    ] as const
                  ).map(function (entry) {
                    return (
                      <label key={entry[0]}>
                        <input
                          type="checkbox"
                          checked={condition.peaks.includes(entry[0])}
                          onChange={function () {
                            /*
                             * 四個都不勾仍然是有效的選擇 ＝「不敘述任何時段」，
                             * 只留下不分時段的項目（例如車種組成那一行）。
                             * 舊寫法在取消最後一個時把它加回去，使用者永遠
                             * 取消不掉。**但它不再代表「全調查時段」**——
                             * 全調查時段現在是上面那一顆。
                             */
                            patch({ peaks: toggle(condition.peaks, entry[0]) });
                          }}
                        />
                        {entry[1]}
                      </label>
                    );
                  })}
                </div>
                <p className="conclusion-hint">
                  四個時段各有各的意義：「全調查時段」是這份調查<b>實際涵蓋的整段時間</b>
                  的累計量（滿 24 小時標示為輛／調查日、PCU／調查日；其餘標示為
                  輛／調查時段、PCU／調查時段）；「全調查時段尖峰」是同一段
                  涵蓋裡流率最高的<b>那一小時</b>（輛/hr、PCU/hr）。兩者單位不同，
                  <b>不可以相加</b>。
                </p>
                <span className="conclusion-sublabel">資料別</span>
                <div className="conclusion-checks">
                  {surveyTypes.map(function (type) {
                    return (
                      <label key={type}>
                        <input
                          type="checkbox"
                          checked={condition.surveyTypes.includes(type)}
                          onChange={function () {
                            patch({ surveyTypes: toggle(condition.surveyTypes, type) });
                          }}
                        />
                        {type}
                      </label>
                    );
                  })}
                </div>
                <p className="conclusion-hint">
                  資料別一個都不勾＝全部都寫。
                  <b>時段兩個都不勾＝只寫全調查時段的數值</b>（記得勾「車種組成」）。
                  {surveyTypes.includes("待設定") ? (
                    <>
                      <br />
                      <b>「待設定」不是一種時段</b>，而是那幾筆資料還沒指定是平日還是假日
                      （原始檔的日期沒有寫「（平日）」「（假日）」）。
                      要更正請到「流量核對工作台」，選到該筆路口季度後在「資料別」下拉指定。
                    </>
                  ) : null}
                </p>
                {/*
                  ── 轉向別與車種（使用者 2026-09-15 指名補上）──────────
                  主工具列有這兩項，結論草稿以前完全沒有，使用者沒辦法出
                  「只看左轉」「只看大型車」這種題目。
                  兩者都是逐筆紀錄的純轉換（涵蓋四個時段），草稿本身不重算。
                */}
                <div className="conclusion-filter-row">
                <label className="conclusion-inline">
                  轉向別
                  <select
                    data-testid="conclusion-movement"
                    value={condition.movement || "all"}
                    onChange={function (e) {
                      patch({
                        movement: e.target
                          .value as NonNullable<ConclusionCondition["movement"]>,
                      });
                    }}
                  >
                    <option value="all">全部轉向</option>
                    <option value="left">左轉</option>
                    <option value="through">直行</option>
                    <option value="right">右轉</option>
                  </select>
                </label>
                <label className="conclusion-inline">
                  車種
                  <select
                    data-testid="conclusion-vehicle"
                    value={condition.vehicle || "all"}
                    onChange={function (e) {
                      patch({ vehicle: e.target.value });
                    }}
                  >
                    <option value="all">全部車種</option>
                    {props.vehicleOptions.map(function (entry) {
                      return (
                        <option key={entry[0]} value={entry[0]}>
                          {entry[1]}
                        </option>
                      );
                    })}
                  </select>
                </label>
                </div>
              </fieldset>

              <fieldset className="conclusion-field">
                <legend>三、要寫哪些路口</legend>
                <div className="conclusion-actions-row">
                  <button
                    className="ghost"
                    onClick={function () {
                      patch({ intersectionKeys: [], branchNames: [] });
                    }}
                  >
                    全部路口
                  </button>
                </div>
                <div className="conclusion-list">
                  {intersections.map(function (entry) {
                    return (
                      <label key={entry[0]}>
                        <input
                          type="checkbox"
                          checked={condition.intersectionKeys.includes(entry[0])}
                          onChange={function () {
                            patch({
                              intersectionKeys: toggle(
                                condition.intersectionKeys,
                                entry[0],
                              ),
                              branchNames: [],
                            });
                          }}
                        />
                        {entry[1]}
                      </label>
                    );
                  })}
                </div>
                <p className="conclusion-hint">
                  一個都不勾＝全部路口都寫（目前 {intersections.length} 個）。
                </p>
              </fieldset>

              <fieldset className="conclusion-field">
                <legend>四、要寫哪些支線</legend>
                <div className="conclusion-list">
                  {branchOptions.map(function (option) {
                    return (
                      <label key={option.key}>
                        <input
                          type="checkbox"
                          checked={condition.branchNames.some(function (value) {
                            return typedNameKey(value) === option.key;
                          })}
                          onChange={function () {
                            /*
                             * 存的是比對鍵。勾掉時也要用鍵比，
                             * 否則舊範本存的原字串會取消不掉。
                             */
                            const kept = condition.branchNames.filter(
                              function (value) {
                                return typedNameKey(value) !== option.key;
                              },
                            );
                            patch({
                              branchNames:
                                kept.length === condition.branchNames.length
                                  ? [...condition.branchNames, option.key]
                                  : kept,
                            });
                          }}
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
                <p className="conclusion-hint">
                  一個都不勾＝全部支線都寫。支線清單會跟著上面所選的路口變動。
                  勾的是<b>支線名稱</b>：把不同路口的支線改成同一個名稱，它們就會
                  歸在同一項（空格與全半形差異不影響比對）。同一個名稱底下如果
                  涵蓋到不同位置的支線，括號裡會標出來。
                </p>
              </fieldset>

              <fieldset className="conclusion-field conclusion-field-wide">
                <legend>五、要寫哪些數字</legend>
                <div className="conclusion-metrics">
                  {CONCLUSION_METRICS.map(function (metric) {
                    const key = metric.key as ConclusionMetricKey;
                    return (
                      <label
                        key={key}
                        className={
                          condition.metrics.includes(key) ? "selected" : ""
                        }
                      >
                        <input
                          type="checkbox"
                          checked={condition.metrics.includes(key)}
                          onChange={function () {
                            patch({ metrics: toggle(condition.metrics, key) });
                          }}
                        />
                        {metric.label}
                      </label>
                    );
                  })}
                </div>
                {/*
                  * ⚠️ 2026-09-25 第六輪：上面那些勾選框的字原本把單位寫死
                  *   （「（PCU/hr）」「（輛/調查時段）」）。可以勾「全調查時段」、
                  *   也可以一次勾多個時段，所以那個寫死的單位一定有機會是錯的，
                  *   而草稿本文寫的是對的——同一個畫面兩種答案。
                  *   單位改成在這裡講一次規則，並由草稿本文逐句寫出實際單位。
                  */}
                <p className="conclusion-hint" data-testid="conclusion-unit-note">
                  單位跟著您在上面選的<b>時段</b>走，草稿裡每一句都會自己寫出來：
                  上午／下午／全調查時段尖峰是<b>某一小時的流率</b>（
                  {scopeUnit("AM", "pcu", "unknown")}、
                  {scopeUnit("AM", "vehicle", "unknown")}）；
                  「全調查時段」是<b>整段調查的累計量</b>，滿 24 小時寫
                  {scopeUnit("FULL", "pcu", "full")}，不足 24 小時或整批混合寫
                  {scopeUnit("FULL", "pcu", "mixed")}。
                  兩者<b>不可以相加</b>，也不可以互相比較。
                </p>
                {/*
                  * 「呈現方式」只有在駛入與駛出都要寫的時候才有意義——
                  * 雙向合計是把兩個方向加起來，只寫一個方向時那個數字
                  * 是錯的。所以只勾一邊時整區收起來，不讓使用者選一個
                  * 其實不會生效的設定。
                  */}
                {condition.metrics.includes("branchCompositionIn") &&
                condition.metrics.includes("branchCompositionOut") ? (
                  <div
                    className="conclusion-submode"
                    /*
                     * ⚠️ 2026-09-23：這一頁現在有**兩個** .conclusion-submode
                     *   區塊（這一個與「尖峰時段判定方式」）。守門原本是數
                     *   `.conclusion-submode` 的個數＝0，新增之後那一條會永遠紅。
                     *   加上專屬的 testid，守門才守得到「這一個」的顯示與否，
                     *   而不是「這一頁有沒有任何子選項」。
                     */
                    data-testid="conclusion-branch-composition-mode"
                  >
                    <span className="conclusion-sublabel">
                      各支線各車種要怎麼呈現
                    </span>
                    <div className="conclusion-radios">
                      {BRANCH_COMPOSITION_MODES.map(function (mode) {
                        return (
                          <label key={mode.key}>
                            <input
                              type="radio"
                              name="conclusion-branch-composition-mode"
                              checked={
                                (condition.branchCompositionMode ||
                                  "follow") === mode.key
                              }
                              onChange={function () {
                                patch({ branchCompositionMode: mode.key });
                              }}
                            />
                            {mode.label}
                          </label>
                        );
                      })}
                    </div>
                    <p className="conclusion-hint">
                      和「車種組成分析」頁上每條支線的下拉選單同一套。選「跟著設定」時，
                      您在那一頁把某條支線改成雙向合計，草稿就會跟著寫成雙向合計。
                    </p>
                  </div>
                ) : null}
                {/*
                  * ── 尖峰時段判定方式（2026-09-23 新增）─────────────────
                  *
                  * ⚠️ 預設是「整個調查點同一時段」＝改版前的唯一行為，
                  *   升級當天草稿輸出逐字不變。
                  * ⚠️ 換成「各方向各自認定」不是換個標籤，是真的換一套數字
                  *   （實測差距可以到 50 倍），而且**各支線的量不可以相加**。
                  *   草稿會把這句警告寫進去，貼到報告裡也看得到。
                  */}
                <div
                  className="conclusion-submode"
                  data-testid="conclusion-peak-rule"
                >
                  <span className="conclusion-sublabel">尖峰時段判定方式</span>
                  <div className="conclusion-radios">
                    {(
                      [
                        [
                          "point",
                          "整個調查點同一時段（各支線可以相加）",
                        ],
                        [
                          "direction",
                          "各方向各自認定自己的尖峰（各支線不可相加）",
                        ],
                      ] as [NonNullable<ConclusionCondition["peakRule"]>, string][]
                    ).map(function (item) {
                      return (
                        <label key={item[0]}>
                          <input
                            type="radio"
                            name="conclusion-peak-rule"
                            checked={(condition.peakRule || "point") === item[0]}
                            onChange={function () {
                              patch({ peakRule: item[0] });
                            }}
                          />
                          {item[1]}
                        </label>
                      );
                    })}
                  </div>
                  <p className="conclusion-hint">
                    「整個調查點同一時段」是整個路口一起挑一個最忙的小時，各支線的量加起來
                    等於路口總量。「各方向各自認定」是逐時段替每一條支線挑它自己最忙的那一小時，
                    每條支線底下會多寫自己的時段——那些數字不是同一時刻的量，
                    請不要相加。「全調查時段」是整段涵蓋的累計量，不受這一項影響。
                    這一頁不會自動跟著上方主工具列跑，要對齊請按「套用主工具列」。
                  </p>
                </div>
              </fieldset>

              <fieldset className="conclusion-field conclusion-field-wide">
                <legend>六、敘述方式</legend>
                <div className="conclusion-radios">
                  {(
                    [
                      ["byIntersection", "依路口分段（每個路口一段）"],
                      ["byQuarter", "依季度分段（每一季一段）"],
                      ["overall", "只寫整體結論"],
                    ] as const
                  ).map(function (entry) {
                    return (
                      <label key={entry[0]}>
                        <input
                          type="radio"
                          name="conclusion-grouping"
                          checked={condition.grouping === entry[0]}
                          onChange={function () {
                            patch({ grouping: entry[0] });
                          }}
                        />
                        {entry[1]}
                      </label>
                    );
                  })}
                </div>
                <label className="conclusion-inline">
                  小數位數
                  <select
                    value={String(condition.digits)}
                    onChange={function (e) {
                      patch({ digits: Number(e.target.value) });
                    }}
                  >
                    {[0, 1, 2].map((d) => (
                      <option key={d} value={d}>
                        {d} 位
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>
            </div>

            <div className="conclusion-templates">
              <strong>條件範本</strong>
              <div className="conclusion-actions-row">
                <input
                  value={templateName}
                  placeholder="例如：季報用、年報用"
                  onChange={function (e) {
                    setTemplateName(e.target.value);
                  }}
                />
                <button
                  className="secondary"
                  onClick={function () {
                    const name = templateName.trim();
                    if (!name) return props.notify("請先輸入範本名稱。");
                    props.setTemplates([
                      {
                        id: "CT-" + Date.now(),
                        name,
                        condition,
                        savedAt: new Date().toISOString(),
                      },
                      /* 同名覆寫的比對要過 typedNameKey()，理由同報表範本。 */
                      ...props.templates.filter(function (item) {
                        return typedNameKey(item.name) !== typedNameKey(name);
                      }),
                    ]);
                    setTemplateName("");
                    props.notify("已存成範本「" + name + "」。");
                  }}
                >
                  存成範本
                </button>
              </div>
              {props.templates.length ? (
                <div className="conclusion-template-list">
                  {props.templates.map(function (template) {
                    return (
                      <span key={template.id} className="conclusion-template">
                        <button
                          className="ghost"
                          onClick={function () {
                            /*
                              * 一定要正規化：舊版存下來的範本可能缺欄位，
                              * 直接套用會在 render 期間丟 TypeError，
                              * 整個結論分頁會消失。
                              */
                            setCondition(
                              normalizeCondition(template.condition),
                            );
                            props.notify("已套用範本「" + template.name + "」。");
                          }}
                        >
                          {template.name}
                        </button>
                        <button
                          className="ghost danger"
                          aria-label={"刪除範本 " + template.name}
                          onClick={function () {
                            props.setTemplates(
                              props.templates.filter(function (item) {
                                return item.id !== template.id;
                              }),
                            );
                          }}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="conclusion-hint">
                  還沒有存過範本。存起來之後，下次直接按一下就套用同一組條件。
                </p>
              )}
            </div>
          </section>

          <section className="panel conclusion-output" ref={draftBoxRef}>
            <div className="conclusion-head">
              <div>
                <span className="eyebrow">CONCLUSION DRAFT</span>
                <h2>結論草稿</h2>
              </div>
              <div className="conclusion-actions-row">
                <button className="primary" onClick={() => generate()}>
                  產生草稿
                </button>
                <button
                  className="secondary"
                  disabled={!draft}
                  onClick={function () {
                    /*
                     * ⚠️ 2026-09-25：可選鏈會短路**整條成員鏈**。
                     *   `navigator.clipboard?.writeText(t).then(a).catch(b)`
                     *   在 clipboard 為 undefined 時回 undefined，
                     *   `then` 與 `catch` **都不會執行**（實測），
                     *   於是按下去完全沒反應、也沒有任何提示，
                     *   使用者以為複製成功了，去貼上得到舊的剪貼簿內容。
                     *   非安全內容（http 的區網網址）與舊瀏覽器都會這樣。
                     *   照 22010 那一顆的做法先明確判斷。
                     */
                    if (!navigator.clipboard?.writeText)
                      return props.notify(
                        "這個瀏覽器不允許程式複製，請手動全選草稿文字後複製。",
                      );
                    navigator.clipboard
                      .writeText(draft)
                      .then(function () {
                        props.notify("已複製到剪貼簿。");
                      })
                      .catch(function () {
                        props.notify("瀏覽器不允許複製，請手動全選複製。");
                      });
                  }}
                >
                  複製全文
                </button>
                <button
                  className="secondary"
                  disabled={!draft}
                  onClick={function () {
                    downloadBlob(
                      new Blob([draft], { type: "text/plain;charset=utf-8" }),
                      "結論草稿.txt",
                    );
                  }}
                >
                  下載 .txt
                </button>
              </div>
            </div>
            <textarea
              aria-label="結論草稿"
              value={draft}
              placeholder="條件設定完成後，按「產生草稿」。"
              onChange={function (e) {
                setDraft(e.target.value);
                setEdited(true);
              }}
            />
            <p className="conclusion-hint">
              {edited
                ? "您已手動修改過這份草稿；按「產生草稿」會先詢問再覆蓋。"
                : "這段文字可以直接修改，改過之後不會被自動覆蓋。"}
            </p>
          </section>
        </>
      )}
    </>
  );
}


/**
 * 歷季趨勢「逐項一條線」時每一條線的顏色（一個支線／轉向／車種一條）。
 *
 * ⚠️ 顏色**不是唯一的識別方式**：圖例逐條列名稱，滑鼠移上去的標籤也冠名稱。
 *   色盲讀者與把圖列印成灰階的人靠的是那個名稱。
 * ⚠️ 這 8 個色都驗過與白底的對比 ≥ 3:1（圖形物件的門檻）。
 * ⚠️ **不自動生成第 9 個顏色**：生出來的一定有對比不足、或兩條幾乎一樣的色。
 *   超過 8 項時乾脆不提供「逐項一條線」，並在畫面上講明理由（見 TrendView）。
 */
const TREND_LINE_PALETTE = [
  "#087f75",
  "#d97706",
  "#1d4ed8",
  "#8c6d31",
  "#7c3aed",
  "#b5608e",
  "#3f3f46",
  "#0f766e",
];

function TrendView(props: {
  /** 全程式共用的「目前路口」——不可以在這裡另存一份，見呼叫端的說明。 */
  selectedIntersection: string;
  setSelectedIntersection: (value: string) => void;
  records: TrafficRecord[];
  /*
   * ⚠️ v2.1.64 起放寬成 ScopeKey：歷季趨勢也要能單獨看「全調查時段」。
   *   外層的 peak 狀態本來就是 ScopeKey（四個畫面共用同一個），
   *   這裡原本窄成 PeakKey 只是因為趨勢圖以前只畫三個尖峰。
   */
  /*
   * ⚠️ X-54 起型別是 PeakChoice（含 "AMPM"），不是 ScopeKey：
   *   這一頁的「整體（四個範圍）」借用主工具列的 AMPM 表示，
   *   窄成 ScopeKey 的話那個值就傳不進來，鏡子只同步得了一半。
   */
  peak: PeakChoice;
  setPeak: (value: PeakChoice) => void;
  /** 脫離提示與「不適用」說明，由上層組好傳進來（同 AuditWorkbench）。 */
  detachNote?: ReactNode;
  /**
   * 「這一頁不吃主工具列的哪幾個條件」那一句，由外層算好傳進來。
   *
   * ⚠️ 這個元件拿不到 mainFilters，所以不能自己判斷——與 detachNote 同一種作法。
   * ⚠️ 圖與「季度變化」**各掛一次**：使用者 2026-09-15 指定
   *   「每個圖表都要有各自的不適用說明」，掛在頁面上方一次是不夠的。
   */
  unusedNote?: ReactNode;
  /*
   * X-84：右邊「季度變化」那一塊用的**短版**。
   * 兩塊都必須自己表態（逐塊守門），但同一段長句並排出現兩次會被當成 bug。
   */
  unusedNoteCompact?: ReactNode;
  /** 這一張圖目前的「路口流量視角」（主工具列或它自己脫離後的值）。 */
  flowView: FlowView;
  notify: (value: string) => void;
  /** 這個計畫裡還掛著「待設定」的紀錄筆數。 */
  pendingCount: number;
  assignPendingSurveyType: (value: string, intersectionKey?: string) => void;
  /**
   * 每一個季別在畫面上要顯示成什麼（季別或實際調查月份）。
   * 由上層統一算好傳進來，趨勢圖不自己再寫一套——同一個季別在季度下拉、
   * 摘要與 X 軸上必須是同一個字。查不到就原樣用季別。
   */
  quarterLabels: Record<string, string>;
  /**
   * 季度字串在匯出檔裡要寫成的樣子（民國年或西元年）。
   * 與上層的「年份顯示」切換同一個來源，避免畫面寫 2026Q1、匯出寫 115Q1。
   * 只換顯示的字；分組與計算仍走 record.quarter 的儲存值。
   */
  showQuarter: (value: string) => string;
  /*
   * 側欄的小分頁點到哪一塊。
   *
   * ⚠️ 這一頁的三塊（趨勢圖、季度變化、這張圖怎麼講）以前**完全沒有錨點**，
   *   所以側欄一項都列不出來——2026-09-13 逐頁盤點才發現。
   *   列不出來的東西，使用者不會知道它在哪一頁，等於做了沒人看得到。
   *   外框樣式一律由 CSS 的 .is-focused 給，和其他頁同一套。
   */
  focusedBlock?: string;
}) {
  const focusClass = (anchor: string, base: string) =>
    props.focusedBlock === anchor ? base + " is-focused" : base;
  /*
   * ⚠️ 型別由 PeakKey 放寬成 ScopeKey：使用者 2026-09-10 指定歷季趨勢
   *   也要能單獨看「全調查時段」（FULL）。
   *
   * ⚠️ 但「整體」仍然只疊 AM／PM／全調查時段尖峰三條，**不含 FULL**。
   *   三個尖峰的單位都是 PCU/hr，可以共用一條縱軸；FULL 是整段涵蓋的
   *   累計量（24 小時的檔案大約是尖峰的二十幾倍），畫在同一條軸上會把
   *   三條尖峰線壓成貼著零的直線——那正是我們先前討論過、並且已經否決
   *   的「副 Y 軸／不同單位混在一張圖」問題。
   *   使用者要的「四個同時展現」要用**兩張上下排列的圖**呈現，
   *   那需要把圖的 JSX 抽成可重複使用的元件，列在待修正事項裡另做。
   */
  /*
   * ══════════════════════════════════════════════════════════════
   *  X-54：這張圖的時段要**跟著主工具列走**
   * ══════════════════════════════════════════════════════════════
   *
   * 舊寫法是 `useState(props.peak)`——初始值抄一次，之後就再也不同步。
   * 後果：使用者在主工具列把尖峰時段改成下午，這張圖**一動也不動**，
   * 而畫面上沒有任何一個字說明為什麼。使用者 2026-09-16 回報的
   * 「歷季趨勢比較分頁也不受主工具列影響」，這就是其中一半的成因。
   *
   * 改成直接由 props.peak 推導（＝三態模型的「鏡子」），
   * 這一頁自己的那排選擇器則走 props.setPeak（＝「脫離」）。
   *
   * ⚠️ 「整體（四個範圍・上下兩張圖）」在主工具列沒有對應的值，
   *   借用主工具列的「上午＋下午並列」（AMPM）來表示：兩者要說的是
   *   同一件事——一次看多個時段。借用之後，原本那一句
   *  「並列不適用」的提示就變成假的，已一併移除。
   */
  const trendMode: ScopeKey | "ALL" =
    props.peak === "AMPM" ? "ALL" : props.peak;
  /*
   * ⚠️ 直接用 lib 的 recordIntersectionKey，不要在這裡再寫一份。
   *   舊版這裡有一個字字相同的副本——兩份實作遲早分岔，而分岔的症狀是
   *   「同一個路口在兩頁被算成兩個」，兩邊各自都看起來正常。
   */
  const intersectionKey = recordIntersectionKey;
  const intersections = Array.from(
    new Map(
      props.records.map(function (record) {
        return [intersectionKey(record), record.name];
      }),
    ).entries(),
  );
  const { selectedIntersection, setSelectedIntersection } = props;
  const activeIntersection = intersections.some(function (entry) {
    return entry[0] === selectedIntersection;
  })
    ? selectedIntersection
    : intersections[0]?.[0] || "";
  const allQuarters = Array.from(
    new Set(
      props.records.map(function (record) {
        return record.quarter;
      }),
    ),
  ).sort(compareQuarters);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  useEffect(
    function () {
      const available = Array.from(
        new Set(
          props.records.map(function (record) {
            return record.quarter;
          }),
        ),
      ).sort(compareQuarters);
      setRangeStart(available[0] || "");
      setRangeEnd(available.at(-1) || "");
    },
    [props.records],
  );
  const activeRangeStart = allQuarters.includes(rangeStart)
    ? rangeStart
    : allQuarters[0] || "";
  const activeRangeEnd = allQuarters.includes(rangeEnd)
    ? rangeEnd
    : allQuarters.at(-1) || "";
  // 同一路口的同一季可能同時有平日與假日兩筆。舊版沒有分開，兩筆會被畫成
  // 同一條折線上的兩個點、季別標籤還一樣，「較前季」也變成拿假日跟平日比。
  const surveyTypes = Array.from(
    new Set(
      props.records
        .filter(function (record) {
          return intersectionKey(record) === activeIntersection;
        })
        .map(function (record) {
          return record.surveyType || "待設定";
        }),
    ),
  ).sort();
  const [surveyTypeFilter, setSurveyTypeFilter] = useState("");
  /*
   * 「待設定」不是一種資料別，而是那幾筆在匯入當下讀不出來。所以預設要停在
   * 真正的資料別上，不要一進來就停在待設定；同時記下這個路口有幾季還沒指定，
   * 好在下方直接讓使用者補完。
   */
  const realSurveyTypes = surveyTypes.filter(function (type) {
    return type !== "待設定";
  });
  const pendingHere = props.records.filter(function (record) {
    return (
      intersectionKey(record) === activeIntersection &&
      (record.surveyType || "待設定") === "待設定"
    );
  });
  const activeSurveyType = surveyTypes.includes(surveyTypeFilter)
    ? surveyTypeFilter
    : realSurveyTypes[0] || surveyTypes[0] || "";
  const startIndex = Math.max(0, allQuarters.indexOf(activeRangeStart));
  const endIndex = Math.max(startIndex, allQuarters.indexOf(activeRangeEnd));
  const chosen = allQuarters.slice(startIndex, endIndex + 1);
  /*
   * 站號的處理交給 buildTrendSeries：站號逐年換（T13-04→T15-04）時要串成
   * 同一條線，只有「同一季同時存在兩個站號」（北向／南向並存）才需要指定
   * 站號。報表與 Excel 用的 trendSeriesRecords 也是呼叫同一支，畫面上的
   * 「較前季」才不會跟報表工作表給出兩個不同的百分比。
   */
  const [stationFilter, setStationFilter] = useState("");
  const trend = buildTrendSeries(props.records, {
    intersectionKey: activeIntersection,
    surveyType: activeSurveyType,
    quarters: chosen,
    preferStation: stationFilter || undefined,
  });
  const rows = trend.rows;
  const trendPeaks: ScopeKey[] =
    trendMode === "ALL" ? PEAK_KEYS : [trendMode];
  /*
   * 趨勢用「駛出」還是「駛入」的總量。
   *
   * 兩者是同一批 OD 流向、只是分組方式不同，資料完整時總量會完全相等；
   * 不相等就代表有流向沒有指定目的支線，差額正好是那些流向的量。
   * 讓使用者能切換，一來符合報告需求，二來一眼就看得出資料有沒有缺口。
   */
  /*
   * ⚠️ 這一個要**跟著主工具列的「路口流量視角」走**。
   *
   *   升級前它是一份獨立狀態，於是主工具列切成「只顯示駛入」時，
   *   這一頁還畫著駛出總量，而且沒有任何一個字說明——
   *   實測（probe-filter-matrix）就是這樣。
   *
   *   「駛入＋駛出並列」這一張圖畫不了（一條折線只能是一個方向），
   *   那時維持這一頁自己的選擇，並在畫面上寫明（見 detachNote）。
   */
  const [ownTrendFlow, setOwnTrendFlow] = useState<TrendFlow>("outbound");
  const trendFlow: TrendFlow =
    props.flowView === "inbound" || props.flowView === "outbound"
      ? props.flowView
      : ownTrendFlow;
  const setTrendFlow = setOwnTrendFlow;

  /*
   * ── 指標 ─────────────────────────────────────────────────────
   *
   * 預設「路口總量」＝ 舊版唯一畫得出來的那一條線，所以不選指標時的行為
   * 與舊版完全相同。其餘指標（實際車輛數、單一車種、車種佔比、單一支線、
   * 單一轉向）一律走同一支 buildMetricSeries——圖、右側摘要、講稿、PNG、
   * Excel 全部讀它的輸出，不再各自碰紀錄。
   *
   * ⚠️ 這一點是刻意的架構限制。舊版曾經發生過「點畫在駛入的高度、旁邊標的
   * 卻是駛出的數字」（點座標用 totalOf、標籤用 recordTotal），就是因為同一
   * 張圖上有兩個計算來源。收斂成一份之後，那一類錯誤在結構上不可能發生。
   */
  const [metricId, setMetricId] = useState("total");
  const metric: TrendMetricDef = trendMetricById(metricId);
  const vehicleIds = Array.from(
    new Set(rows.flatMap((record) => recordVehicleIdList(record))),
  );
  /*
   * 支線清單以「這個路口出現過的所有支線名稱」為準，跨季用名稱對應。
   *
   * ⚠️ 去重要用 typedNameKey()，不可以用原字串。
   *   自動命名是「路口 A」（中間有半形空格）、使用者手打的是「路口A」，
   *   直接丟進 Set 會出現**兩個看起來一模一樣的選項**，
   *   而選了其中一個，另一種寫法的那幾季全部畫成斷線。
   *   顯示則保留第一個遇到的原字串，畫面上仍是使用者熟悉的樣子。
   */
  const armNames = (function () {
    const seen = new Map<string, string>();
    for (const record of rows)
      for (const approach of record.approaches) {
        const label = armMatchKey(approach);
        const key = typedNameKey(label);
        if (key && !seen.has(key)) seen.set(key, label);
      }
    return Array.from(seen.values());
  })();
  const [metricKey, setMetricKey] = useState("");
  const defaultKey =
    metric.picker === "vehicle"
      ? vehicleIds[0] || ""
      : metric.picker === "arm"
        ? armNames[0] || ""
        : metric.picker === "movement"
          ? "left"
          : "";
  const optionList =
    metric.picker === "vehicle"
      ? vehicleIds
      : metric.picker === "arm"
        ? armNames
        : metric.picker === "movement"
          ? (["left", "through", "right"] as string[])
          : [];
  /*
   * ══════════════════════════════════════════════════════════════════
   *  X-34②：一張圖多條線——「全部（逐項一條線）」
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-16：
   *   「我可以單選一個路段，就能看到一路段一張圖了，目前反而缺少一張圖
   *     多條線……(這點三項程式都適用)」
   *
   * 這一支程式的「路段」對應到**支線／轉向／車種**：原本一次只挑得了一個，
   * 想比較幾個支線就得一個一個切，切完還要自己記上一個的數字。
   *
   * ⚠️ 這裡**不做任何加總**。逐項分列就是逐項，不會多出一條「全部合計」的線
   *   ——那條線已經有了，就是指標「路口總量」。
   * ⚠️ 逐項分列時**一個統計範圍一張圖**（見 charts）。
   *   把「三個尖峰 × N 個支線」疊在一張圖上，線數會變成三倍，
   *   而且同一個支線的三條線顏色不同、名稱相同，根本認不出來。
   */
  const ALL_OPTIONS_KEY = "__ALL__";
  const canSplitOptions =
    optionList.length > 1 && optionList.length <= TREND_LINE_PALETTE.length;
  const activeKey = optionList.includes(metricKey)
    ? metricKey
    : metricKey === ALL_OPTIONS_KEY && canSplitOptions
      ? ALL_OPTIONS_KEY
      : defaultKey;
  const perOption = activeKey === ALL_OPTIONS_KEY;
  const metricOption: TrendMetricOption = {
    key: perOption ? defaultKey : activeKey,
  };
  const vehicleNameOf = function (id: string) {
    return vehicleLabel(rows[0] || null, id);
  };
  /**
   * 這一筆、這個尖峰、這一個對象的指標值；算不出來一律 null。
   *
   * ⚠️ `option` 是逐項分列時一條線一個。不給就用目前選到的那一個，
   *   所以既有呼叫端的行為完全不變。
   */
  const valueOf = function (
    record: TrafficRecord,
    peak: ScopeKey,
    option: TrendMetricOption = metricOption,
  ) {
    return metricValueFor(record, peak, option);
  };
  const metricValueFor = function (
    record: TrafficRecord,
    peak: ScopeKey,
    option: TrendMetricOption = metricOption,
  ) {
    return buildMetricSeries(
      [record],
      metric,
      peak,
      option,
      trendFlow,
      vehicleNameOf,
      /*
       * ⚠️ 這裡只取 `.points[0]`（一個數值），單位用不到——但涵蓋仍然要照實傳。
       *   2026-09-25 第六輪把這個參數改成必填之後才看到這一處沒傳：
       *   今天用不到不代表明天用不到，而「今天用不到」正是當初漏掉的理由。
       */
      coverageOf([record]),
    ).points[0];
  };
  const seriesLabel = metricLabel(metric, metricOption, vehicleNameOf);

  /* 兩種視角的總量若不同，代表有流向沒有指定目的支線。 */
  const flowGap = rows.reduce(function (worst, record) {
    return trendPeaks.reduce(function (inner, peak) {
      if (!hasScopeValue(record, peak)) return inner;
      const armIds = new Set(record.approaches.map((arm) => arm.id));
      const inbound = (record.routes || [])
        .filter(function (route) {
          return armIds.has(route.toApproachId);
        })
        .reduce(function (sum, route) {
          return sum + Number(route.volumes[peak]?.pcu || 0);
        }, 0);
      const gap = round1(recordTotal(record, peak) - inbound);
      return Math.abs(gap) > Math.abs(inner) ? gap : inner;
    }, worst);
  }, 0);
  /*
   * 這一筆、這個尖峰，到底有沒有值？
   *
   * ⚠️ 只有 DAY 會「算不出來」：不足 24 小時的調查，或舊備份還沒重新匯入。
   * 那種情況 recordTotal 回的是 **0**，不是 null——趨勢圖若照 0 畫，折線會掉到
   * 零、右側摘要會寫「全日尖峰 0 PCU/hr」，看起來像「那一季流量歸零」，
   * 而事實是「這份調查根本算不出全日尖峰」。0 會被抄進報告，「－」不會。
   *
   * 換成可選指標之後又多了兩種算不出來：所選支線這一季不存在（改過名稱、
   * 或路口幾何不同）、車種佔比沒有分母。三種一律由 metricValue 回 null，
   * 判斷只有這一個地方。
   */
  const hasPeakValue = function (
    record: TrafficRecord,
    peak: ScopeKey,
    option: TrendMetricOption = metricOption,
  ) {
    return valueOf(record, peak, option).value !== null;
  };
  const totalOf = function (
    record: TrafficRecord,
    peak: ScopeKey,
    option: TrendMetricOption = metricOption,
  ) {
    return valueOf(record, peak, option).value ?? 0;
  };
  /*
   * ⚠️ 縱軸最大值**逐圖**算，不可以全圖共用一個——理由見 buildChartView。
   *   這裡刻意不留一個全域的 max，讓「共用同一條軸」在型別上就寫不出來。
   */
  /*
   * 講稿用的 series。
   *
   * 統計範圍選「整體」時圖上有三條線（AM／PM／全日尖峰），但講稿只能講
   * 一條，否則四段話會變成十二段。取第一條（AM）並在第一段講明白是哪一個
   * 尖峰——**寧可說清楚範圍，也不要含糊地把三條線講成一條**。
   */
  const scriptScope: ScopeKey = trendPeaks[0] || "AM";
  const scriptSeries = buildMetricSeries(
    rows,
    metric,
    scriptScope,
    metricOption,
    trendFlow,
    vehicleNameOf,
    /*
     * ⚠️ 一定要帶 coverageOf(rows)：圖的縱軸名稱、Excel 的單位欄
     *   都是這樣算的，講稿少了它會對同一批數字講另一種單位。
     */
    coverageOf(rows),
  );
  const scriptSections = trendScript(scriptSeries, {
    intersectionName:
      (intersections.find(function (entry) {
        return entry[0] === activeIntersection;
      })?.[1] as string) || "本路口",
    surveyType: activeSurveyType || "待設定",
    quarterLabel: function (quarter: string) {
      return props.quarterLabels[quarter] || quarter;
    },
    flowGap,
    chainedStations: trend.chainedStations ? trend.stations : undefined,
  });

  /*
   * ── X 軸要排「整段期間的每一季」，不是「有資料的那幾季」 ──────
   *
   * ⚠️ 這一段守的是「兩個點緊鄰＝相隔一季」的讀法。某個路口若只做了
   * 113Q1 與 114Q1，照 rows 排的話 X 軸只有兩格、兩個點緊鄰，看圖的人
   * 會讀成「上一季到這一季」的變化——實際上中間隔了整整一年。
   *
   * 補出來的季在 recordByQuarter 裡查不到，has 會是 false，折線在那裡
   * 斷開（斷線＝「這幾季沒調查」，不是「這幾季是 0」），和其他算不出來
   * 的季走同一條路徑。
   */
  const axisQuarters = completeQuarterRange(
    rows.map(function (record) {
      return record.quarter;
    }),
  );
  const recordByQuarter = new Map<string, TrafficRecord>();
  rows.forEach(function (record) {
    recordByQuarter.set(record.quarter, record);
  });
  const chartWidth = trendChartWidth(axisQuarters.length);
  /* X 軸標籤要間隔幾個才印一個（依實際字寬算，見 labelStride 的說明）。 */
  const xLabelStride = labelStride(
    axisQuarters.map(function (quarter) {
      return props.quarterLabels[quarter] || quarter;
    }),
    chartWidth - 170,
    9,
  );
  /*
   * 圖寬有安全上限，期間非常長時資料點會被壓縮在同一個寬度裡。折線與圓點
   * 仍保留每一季，但數值標籤必須依可用寬度抽樣，否則 100 季以上會變成一
   * 整片重疊文字。第一季與最後一季由 showXLabel 保證保留，便於辨識範圍。
   */
  /*
   * ⚠️ 這裡原本有 `trendLabelBudget`（標籤預算）與 `trendPointCount`
   *   （線數 × 有資料的季數），用來決定「標籤要不要永遠顯示」。
   *   X-46（使用者 2026-09-16）改成**一律 hover 才顯示**之後，
   *   兩個都沒人用了，直接移除——留著沒人用的門檻，
   *   下一個人很容易又拿它去把標籤放回畫面上。
   *   （抽樣間隔 `pointLabelStride` 仍然保留，hover 時要用。）
   */
  /** 目前滑鼠停在哪一個資料點（空字串＝沒有）。 */
  const [trendHover, setTrendHover] = useState("");
  const peakColors: Record<ScopeKey, string> = {
    AM: "#087f75",
    PM: "#d97706",
    DAY: "#1d4ed8",
    /* FULL 只會單獨出現（不進「整體」），顏色與三個尖峰刻意分開。 */
    FULL: "#7c3aed",
  };
  const peakLegendLabels: Record<ScopeKey, string> = {
    AM: "AM Peak",
    PM: "PM Peak",
    DAY: "全調查時段尖峰",
    FULL: "全調查時段",
  };
  /*
   * ── 一張圖 ＝ 一組統計範圍 ────────────────────────────────────
   *
   * 使用者要的「整體」是**四個統計範圍同時看得到**。但四條線不能疊在同一
   * 張圖上：AM／PM／全調查時段尖峰的單位都是 PCU/**hr**（流率），
   * 全調查時段是整段涵蓋的**累計量**（24 小時的檔案大約是尖峰的二十幾倍）。
   * 疊在一條縱軸上，三條尖峰線會被壓成貼著零的一條直線——那正是使用者
   * 已經否決過的「副 Y 軸／不同單位混一張圖」。
   *
   * 所以「整體」改成**上下兩張圖**：上圖三個尖峰，下圖全調查時段。
   *
   * ⚠️ 這支工廠存在的唯一理由，就是讓「兩張圖共用同一條縱軸」在結構上
   *   寫不出來：max 是每一份 view 自己的，外面沒有全域的 max 可以拿。
   *   共用的話下圖的累計量會把上圖的軸頂撐到二十幾倍，等於白拆。
   *   tests/trend-split.test.mjs 與 scripts/e2e-trend-split.mjs 各守一半。
   */
  type TrendChartView = {
    key: string;
    svgId: string;
    scopes: ScopeKey[];
    caption: string;
    unit: string;
    ariaLabel: string;
    max: number;
    tickDigits: number;
    showLegend: boolean;
    showStaticPointLabels: boolean;
    pointLabelStride: number;
    series: Array<{
      /** 這一條線的唯一鍵（統計範圍＋對象）。React 的 key、hover 的鍵都用它。 */
      id: string;
      /** 圖例要寫的字。 */
      label: string;
      /** 資料點旁邊那個標籤要冠的字（比圖例短，標籤寬度有限）。 */
      shortLabel: string;
      peak: ScopeKey;
      option: TrendMetricOption;
      color: string;
      points: Array<{
        quarter: string;
        x: number;
        y: number;
        value: number | null;
        record: TrafficRecord | null;
        has: boolean;
      }>;
      segments: Array<
        Array<{
          quarter: string;
          x: number;
          y: number;
          value: number | null;
          record: TrafficRecord | null;
          has: boolean;
        }>
      >;
    }>;
  };

  /**
   * 一張圖上的一條線要畫什麼。
   *
   * ⚠️ 一條線 ＝ 一個統計範圍 ×**一個對象**。舊版只有前者，所以線數固定等於
   *   統計範圍數；逐項分列之後對象也會變，兩者必須一起帶著走。
   *   只帶其中一個的話，畫出來的點與旁邊標的數字會來自不同的東西——
   *   這支程式修過一次一模一樣的毛病（點畫在駛入的高度、標著駛出的數字）。
   */
  type TrendSeriesSpec = {
    id: string;
    label: string;
    shortLabel: string;
    peak: ScopeKey;
    option: TrendMetricOption;
    color: string;
  };
  const buildChartView = function (
    specs: TrendSeriesSpec[],
    svgId: string,
    caption: string,
  ): TrendChartView {
    const scopes = Array.from(new Set(specs.map((spec) => spec.peak)));
    /* ⚠️ 只看**這一張圖自己**的值。混進另一張圖的值就等於共用縱軸。 */
    const chartValues = rows.flatMap(function (record) {
      return specs
        .map(function (spec) {
          return valueOf(record, spec.peak, spec.option).value;
        })
        .filter(function (value): value is number {
          return value !== null;
        });
    });
    /*
     * 佔比有天然上界，一律用 0～100 畫。自動縮放的話「從 12% 到 14%」
     * 會被畫成一條陡峭上升的線，看起來像災難。
     *
     * 其餘指標把「資料最大值 ×1.12」交給 niceScale 吸附到整數倍，
     * 刻度才不會印成 6,015.5／4,511.6／3,007.8 這種一排亂數。
     */
    const niceY =
      metric.unit === "%"
        ? { max: 100, digits: 0 }
        : niceAxisMax(Math.max(...chartValues, 1), 4);
    const max = niceY.max;
    const series = specs.map(function (spec) {
    const peak = spec.peak;
    const points = axisQuarters.map(function (quarter, index) {
      const record = recordByQuarter.get(quarter) || null;
      return {
        quarter,
        x:
          100 +
          (index * (chartWidth - 170)) / Math.max(1, axisQuarters.length - 1),
        /*
         * ⚠️ 這裡的 240 必須與格線的間距完全相同。
         *
         * 舊版點用 235、格線用 240（70、130、190、250、310 共五條），
         * 於是整片資料點被往下壓了 5px：值等於軸頂的點畫在 y=75，
         * 而標著那個值的格線在 y=70。誤差隨值線性放大，照著縱軸讀一個
         * 點會少讀約 2%——在 6,000 PCU 的軸上就是 120 PCU。
         * 兩個對應關係只要有一個地方不一致，圖上說的話就不是資料說的話。
         */
        y: record ? 310 - (totalOf(record, peak, spec.option) / max) * 240 : 310,
        /*
         * 機器可讀的真值，寫進 <circle data-value>。
         * ⚠️ 一定要與上面那行 y 用**同一個運算式**（totalOf）。
         * 兩邊各算一次就會分岔，那正是 v2.1.58 修過的毛病
         *（點畫在駛入的高度、旁邊標的卻是駛出的數字）。
         * 守門是拿「格線反推回來的值」與這個 data-value 比對——
         * 格線用的是另一套對應關係，所以不會變成恆真：
         * v2.1.59 那種「點用 235、格線用 240」的錯照樣抓得到。
         */
        value: record ? totalOf(record, peak, spec.option) : null,
        record,
        has: record ? hasPeakValue(record, peak, spec.option) : false,
      };
    });
    /*
     * 折線要「斷開」，不能把沒有值的季度連過去——連過去就等於宣稱中間那一季
     * 有一個介於兩端之間的值。切成一段一段連續有值的區間各畫一條。
     */
    const segments: (typeof points)[] = [];
    let current: typeof points = [];
    points.forEach(function (point) {
      if (point.has) {
        current.push(point);
      } else if (current.length) {
        segments.push(current);
        current = [];
      }
    });
    if (current.length) segments.push(current);
      return {
        id: spec.id,
        label: spec.label,
        shortLabel: spec.shortLabel,
        peak,
        option: spec.option,
        color: spec.color,
        points,
        segments,
      };
    });
    return {
      key: svgId,
      svgId,
      scopes,
      caption,
      /*
       * 單位逐圖取，而且帶著這一批資料的實際涵蓋：
       * 整批都是 24 小時才寫「/調查日」，只要有一季不足就寫「/調查時段」。
       */
      unit: metricUnit(metric, scopes[0], coverageOf(rows)),
      ariaLabel: caption + "歷季趨勢折線圖",
      series,
      max,
      tickDigits: niceY.digits,
      /* 一條線不需要圖例——標題已經說了那是什麼。 */
      showLegend: specs.length > 1,
      /*
       * ══════════════════════════════════════════════════════════════
       *  X-46：數值標籤**一律改成滑鼠移上去才顯示**（使用者 2026-09-16）
       * ══════════════════════════════════════════════════════════════
       *
       *   「又再次出現標籤重疊的問題。如果一直出現這個問題，
       *     是否統一一律改為滑鼠移上去才顯示數字呢?」
       *
       * ⚠️ 舊版是「標籤總數在預算內就永遠顯示」。門檻只是把重疊往後推——
       *   每加一條線、每多一季就會再犯一次。三支一起改成 hover 才顯示。
       * ⚠️ `trendLabelBudget` 與 `pointLabelStride` **刻意保留**：
       *   hover 時仍然要靠它們決定要不要錯開、每隔幾點標一次。
       * ⚠️ 下載的高解析 PNG 本來就會把 .point-value 整批移除（淨空版），
       *   使用者 2026-09-16 再次確認要淨空——不用改。
       */
      showStaticPointLabels: false,
      pointLabelStride: labelStride(
        axisQuarters.map(function (quarter) {
          const record = recordByQuarter.get(quarter) || null;
          if (!record) return "";
          return specs
            .map(function (spec) {
              return formatMetric(valueOf(record, spec.peak, spec.option).value, {
                unit: "",
                digits: metric.digits,
              }).trim();
            })
            .join(" ");
        }),
        chartWidth - 170,
        10,
      ),
    };
  };

  /*
   * 「整體」＝ 兩張圖；其餘每一種統計範圍都是一張圖。
   *
   * ⚠️ svgId 一定要各自不同：匯出、守門、e2e 都是靠 id 找圖，
   *   兩張圖共用一個 id 的話會永遠只匯出上面那一張。
   */
  /** 依統計範圍畫線時（＝舊行為）的線定義。 */
  const scopeSpecs = function (scopes: ScopeKey[]): TrendSeriesSpec[] {
    return scopes.map(function (peak) {
      return {
        id: peak,
        label: peakLegendLabels[peak],
        /* ⚠️ 沿用舊版的短字（AM／PM／DAY），標籤寬度是量過的，不要換長的。 */
        shortLabel: peak,
        peak,
        option: metricOption,
        color: peakColors[peak],
      };
    });
  };
  /** 逐項分列時（一個支線／轉向／車種一條線）的線定義。 */
  const optionLabelOf = function (key: string) {
    return metric.picker === "vehicle"
      ? vehicleNameOf(key)
      : metric.picker === "movement"
        ? MOVEMENT_LABELS[key as MovementKey]
        : key;
  };
  const optionSpecs = function (peak: ScopeKey): TrendSeriesSpec[] {
    /* 配色由 TREND_LINE_PALETTE 逐項對位；超過 8 項時這個模式根本不提供。 */
    return optionList.map(function (key, index) {
      return {
        id: peak + "::" + key,
        label: optionLabelOf(key),
        shortLabel: optionLabelOf(key),
        peak,
        option: { key } as TrendMetricOption,
        color: TREND_LINE_PALETTE[index],
      };
    });
  };
  const charts: TrendChartView[] = perOption
    ? /*
       * ⚠️ 逐項分列時**一個統計範圍一張圖**。
       *   疊在一起的話線數是「統計範圍數 × 對象數」，而且同一個支線會有
       *   三條同名不同色的線；更要緊的是三個尖峰是流率（PCU/hr）、
       *   全調查時段是累計量，本來就不可以共用一條縱軸（見 buildChartView）。
       */
      ((trendMode === "ALL"
        ? [...PEAK_KEYS, "FULL"]
        : [trendMode]) as ScopeKey[]).map(
        function (peak, index) {
          return buildChartView(
            optionSpecs(peak),
            index === 0 ? "trend-svg" : "trend-svg-" + peak.toLowerCase(),
            SCOPE_SHORT_LABELS[peak],
          );
        },
      )
    : trendMode === "ALL"
      ? [
          buildChartView(scopeSpecs(PEAK_KEYS), "trend-svg", "三個尖峰流率"),
          buildChartView(
            scopeSpecs(["FULL"]),
            "trend-svg-full",
            "全調查時段累計量",
          ),
        ]
      : [
          buildChartView(
            scopeSpecs([trendMode]),
            "trend-svg",
            SCOPE_SHORT_LABELS[trendMode],
          ),
        ];
  /** 非「整體」時才有唯一的單位可講（面板標題、Excel 標題用）。 */
  const seriesUnit = charts[0].unit;
  /*
   * ★ 資料點的數值：少量時直接標在圖上，量一多就改成「滑鼠移上去才顯示」。
   *
   * 使用者定案（2026-09-10）：
   *   「在資料數列少的時候做到不重疊沒有問題，但資料一多，其實還是改成
   *     滑鼠移上去才顯示數值就很夠用，這樣能一次解決標籤重疊的問題，
   *     也能解決應對大量數據時也不會有重疊問題。」
   *
   * 門檻用「線數 × 有資料的季數」而不是只看季數——「AM／PM／全日尖峰整體」
   * 一季就有三個標籤，只看季數會在 4 季時就擠成一團（他的截圖正是這個情況：
   * 4 季 × 3 條線 ＝ 12 個標籤）。
   *
   * ⚠️ 匯出的 PNG 一律沒有標籤（見 exportChart），與這裡無關；
   *    這個門檻只影響**畫面**。
   */

  async function exportChart() {
    /*
     * ⚠️ 「整體」在畫面上是**兩張**圖，匯出就必須是兩張。
     *   只抓 #trend-svg 的話，交出去的 PNG 會少掉全調查時段那一張，
     *   而收到檔案的人**看不出來少了東西**——那比整張圖壞掉更危險。
     *
     *   做法是把兩張直向接成同一個 PNG（＝畫面上看到的樣子），
     *   而不是下載兩個檔：瀏覽器對「一次下載多個檔案」會跳詢問，
     *   而且兩個檔很容易在報告裡被拆散、只貼了其中一張。
     */
    const svgs = charts
      .map(function (view) {
        return document.getElementById(view.svgId);
      })
      .filter(function (node): node is HTMLElement {
        return Boolean(node);
      });
    if (!svgs.length) return;
    const svg = svgs[0];
    /*
     * ★ 匯出的圖一律是「淨空版」：只有折線、資料點、軸、格線、圖例，
     *   **不含任何數值標籤**。
     *
     * 使用者定案（2026-09-10）：
     *   「匯出的圖檔上面都是淨空版，標記點位的數值可以讓使用者滑鼠移上去顯示
     *     又或是寫在文字說明裡（以表格形式顯示各標記點的數值）」
     *
     * 理由不是「好不好看」，是**重疊在長期趨勢圖上無解**：點越密標籤越擠，
     * 任何自動避讓在點夠多時都會失敗。而畫面上的圖還能換條件、還能放大，
     * 匯出的 PNG 交出去就是那樣，重疊等於永久錯誤。
     * 數值另有兩個更好的家：圖旁的說明文字，以及可編輯 Excel（附原生圖表）。
     *
     * ⚠️ 只動**匯出**這一條路徑，畫面上的標籤一定要保留。
     *    scripts/e2e-chart-layout.mjs 會從 SVG 量像素、反推回值、
     *    再與標籤比對——標籤是那支守門唯一的參照物，拿掉它等於拆掉守門。
     * ⚠️ 要複製一份再刪，不可以就地刪畫面上的節點。
     */
    const cleanMarkup = svgs.map(function (node) {
      const clean = node.cloneNode(true) as SVGElement;
      clean.querySelectorAll(".point-value").forEach(function (label) {
        label.remove();
      });
      return new XMLSerializer().serializeToString(clean);
    });
    void svg;
    downloadBlob(
      await svgToPng(
        cleanMarkup.length > 1
          ? stackSvgMarkup(cleanMarkup, chartWidth, 390)
          : cleanMarkup[0],
      ),
      (intersections.find(function (entry) {
        return entry[0] === activeIntersection;
      })?.[1] || "路口") +
        "_" +
        (trendMode === "ALL" ? "AM_PM_DAY_FULL" : trendMode) +
        /*
         * 檔名一定要帶**指標**。整張圖跟著指標切換走，而舊檔名只寫
         * 「駛出總量／駛入總量」——換一個指標再匯出一次，內容不同、
         * 檔名一模一樣，第二份直接蓋掉第一份。（2026-09-16 實測）
         */
        "_" +
        seriesLabel +
        /*
         * 視角只有在這個指標**真的吃視角**時才寫。
         * 佔比、單一車種、單一轉向都不吃（metricValue 直接忽略 flow），
         * 寫上去就是在檔名上宣告一件不成立的事——而 Excel 裡的
         * 「統計視角」欄自己就寫著「不分駛出駛入」，兩者互相打臉。
         */
        (metric.flowAware
          ? "_" + (trendFlow === "outbound" ? "駛出" : "駛入")
          : "") +
        "_歷季趨勢.png",
    );
    props.notify("趨勢圖已下載。");
  }
  /*
   * 匯出 Excel 要涵蓋的統計範圍。
   *
   * ⚠️ 順序就是欄位順序，改動它等同改動 C／D／E／F 欄的意義，
   *   而原生折線圖是用**欄位字母**指定數列的。要改順序就得同時檢查
   *   valueColumns、percentColumns 與 !cols 的欄寬。
   *
   * ⚠️ 單位**逐欄**取。全調查時段（FULL）是整段涵蓋的累計量，
   *   與三個尖峰的 PCU/hr 不是同一種單位；四欄共用一個 seriesUnit
   *   會讓收到 Excel 的人把累計量讀成流率。
   */
  const TREND_SCOPES: ScopeKey[] = ["AM", "PM", "FULL", "DAY"];
  const scopeUnitOf = function (key: ScopeKey) {
    return metricUnit(metric, key, coverageOf(rows));
  };
  async function exportTrendExcel() {
    if (!rows.length) return props.notify("目前範圍沒有可輸出的季度資料。");
    /*
     * ⚠️ 匯出的季度清單要與**畫面上那張圖的 X 軸完全一致**（axisQuarters），
     * 不是只列「有資料的那幾季」。
     *
     * 只列有資料的季度，Excel 裡的折線圖就會把缺季壓掉——113Q1 與 114Q1
     * 畫成相鄰兩點，看起來像相隔一季，實際隔了整整一年。畫面上已經修好，
     * 匯出卻沒有，等於交出去的那一份還是錯的（GPT 複查時指出這條路徑
     * 沒有守門，實測確實是壞的）。
     *
     * 補出來的季度整列留空（只有季度欄有字），Excel 的折線圖遇到空白
     * 儲存格會斷線，與畫面一致。
     */
    const data = axisQuarters.map(function (quarter, index) {
      const record = recordByQuarter.get(quarter) || null;
      if (!record)
        return {
          季度: props.showQuarter(quarter),
          資料別: "",
          ...Object.fromEntries(
            TREND_SCOPES.map(function (key) {
              return [`${SCOPE_SHORT_LABELS[key]}（${scopeUnitOf(key)}）`, null];
            }),
          ),
          ...Object.fromEntries(
            TREND_SCOPES.map(function (key) {
              return [`${SCOPE_SHORT_LABELS[key]} 較前季（%）`, null];
            }),
          ),
          站號: "",
          路口名稱: "",
          ...Object.fromEntries(
            TREND_SCOPES.map(function (key) {
              return [`${SCOPE_SHORT_LABELS[key]} 涵蓋時段`, ""];
            }),
          ),
          統計視角: "",
          指標: seriesLabel,
          單位: seriesUnit,
          備註: "這一季沒有調查資料",
        };
      /* 匯出要跟畫面同一個視角，否則折線圖與附表會給出兩組數字。 */
      /*
       * 匯出的值一律走 valueOf（= buildMetricSeries），與畫面上那張圖同一支。
       * 算不出來時是 null，寫進 Excel 就是空白儲存格——**不可以是 0**，
       * 0 會被 Excel 當成真實資料點，折線掉到零。
       */
      const totals = Object.fromEntries(
        TREND_SCOPES.map(function (key) {
          return [key, valueOf(record, key).value];
        }),
      ) as Record<ScopeKey, number | null>;
      /*
       * 「較前季」比的是**緊鄰的前一季**。前一季是補出來的空季時就沒有
       * 可比的對象，一律 null——拿再前面那一季來比會變成「跨了半年還叫
       * 較前季」，那個百分比會被直接抄進報告。
       */
      const priorRecord = index
        ? recordByQuarter.get(axisQuarters[index - 1]) || null
        : null;
      const prior = Object.fromEntries(
        TREND_SCOPES.map(function (key) {
          return [key, priorRecord ? valueOf(priorRecord, key).value : null];
        }),
      ) as Record<ScopeKey, number | null>;
      return {
        季度: props.showQuarter(record.quarter),
        資料別: record.surveyType || "待設定",
        /* C～F 欄＝四個統計範圍的量；G～J 欄＝各自的較前季百分比。 */
        ...Object.fromEntries(
          TREND_SCOPES.map(function (key) {
            return [
              /*
               * 欄名要跟著指標走。舊版寫死 scopeUnit(key)（永遠是 PCU/hr），
               * 換成車種或佔比之後，欄名的單位就與欄裡的數字對不起來——
               * 而收到 Excel 的人只看得到欄名。
               */
              `${SCOPE_SHORT_LABELS[key]}（${scopeUnitOf(key)}）`,
              totals[key],
            ];
          }),
        ),
        ...Object.fromEntries(
          TREND_SCOPES.map(function (key) {
            return [
              `${SCOPE_SHORT_LABELS[key]} 較前季（%）`,
              totals[key] !== null && prior[key] !== null && prior[key] !== 0
                ? totals[key] / prior[key] - 1
                : null,
            ];
          }),
        ),
        站號: record.station,
        路口名稱: record.name,
        ...Object.fromEntries(
          TREND_SCOPES.map(function (key) {
            return [
              `${SCOPE_SHORT_LABELS[key]} 涵蓋時段`,
              scopeWindowLabel(record, key),
            ];
          }),
        ),
        /*
         * 這一欄讓收到 Excel 的人看得出數字是哪一種視角算出來的。
         * 一定要放在**最後**：下面的原生折線圖是用欄位字母（C、D、E）指定
         * 數列的，百分比格式也是套在 F、G、H 欄，插在中間會讓圖表畫到別欄。
         */
        統計視角: metric.flowAware
          ? trendFlow === "outbound"
            ? "駛出總量"
            : "駛入總量"
          : "不分駛出駛入",
        /* 指標也要寫進去，否則收到檔案的人看不出這幾欄是什麼指標。 */
        指標: seriesLabel,
        單位: seriesUnit,
      };
    });
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet["!cols"] = [
      /*
       * 欄寬要與實際欄數一致（見下方那一段的欄位對照）。
       *
       * ⚠️ 「備註」一定要放在**最後一欄**。原生折線圖是用欄位字母（C、D、E）
       * 指定數列的，百分比格式套在 F、G、H 欄，插在中間會讓圖表畫到別欄。
       */
      /*
       * ⚠️ v2.1.64 起統計範圍由三個變成四個，所以值欄、百分比欄、涵蓋時段欄
       *   各多一欄，總欄數 17 → 20。欄寬少寫的話最後幾欄會擠成預設寬度，
       *   指標名稱直接被切掉。
       *   A 季度、B 資料別、C～F 四個範圍的量、G～J 較前季％、K 站號、
       *   L 路口名稱、M～P 四個涵蓋時段、Q 統計視角、R 指標、S 單位、T 備註。
       */
      12, 12, 20, 20, 20, 20, 18, 18, 18, 18, 12, 30, 18, 18, 18, 18, 14, 22,
      10, 20,
    ].map(function (wch) {
      return { wch };
    });
    sheet["!autofilter"] = { ref: sheet["!ref"] || "A1:A1" };
    /*
     * 欄位順序：A 季度、B 資料別、C～F 四個統計範圍的量、G～J 各自的較前季百分比。
     * 這裡是照欄位字母套格式，所以上面 data 的欄位順序不可以亂動。
     */
    const valueColumns = TREND_SCOPES.map(function (_, index) {
      return String.fromCharCode(67 + index);
    });
    const percentColumns = TREND_SCOPES.map(function (_, index) {
      return String.fromCharCode(67 + TREND_SCOPES.length + index);
    });
    for (let row = 2; row <= data.length + 1; row++)
      valueColumns.forEach(function (column) {
        if (sheet[column + row]) sheet[column + row].z = "#,##0.0";
      });
    for (let row = 2; row <= data.length + 1; row++)
      percentColumns.forEach(function (column) {
        if (sheet[column + row]) sheet[column + row].z = "0.0%";
      });
    XLSX.utils.book_append_sheet(workbook, sheet, "歷季趨勢比較");
    /*
     * 圖表說明放在**自己的工作表**，不印在圖上。
     *
     * 使用者的原話：「excel 裡面圖本身就是圖，文字說明可以放在 excel 其他欄位」
     * 「那些文字是要由簡報者口述的，不該出現在圖下方」。
     * 所以圖是乾淨的原生折線圖，話在這一張表裡，要用的人自己複製。
     */
    const scriptRows = scriptSections.flatMap(function (section) {
      return section.lines.map(function (line) {
        return { 段落: section.title, 內容: line };
      });
    });
    const scriptSheet = XLSX.utils.json_to_sheet(
      scriptRows.length
        ? scriptRows
        : [{ 段落: "（無）", 內容: "目前的條件下沒有可產生的說明。" }],
    );
    scriptSheet["!cols"] = [{ wch: 16 }, { wch: 110 }];
    XLSX.utils.book_append_sheet(workbook, scriptSheet, "圖表說明");
    const seriesOf = function (key: ScopeKey) {
      return {
        name: SCOPE_SHORT_LABELS[key],
        column: valueColumns[TREND_SCOPES.indexOf(key)],
        color: peakColors[key].replace("#", "").toUpperCase(),
      };
    };
    /*
     * ⚠️ Excel 裡的圖要與**畫面上那幾張圖**一一對應。
     *
     *   「整體」在畫面上是上下兩張（尖峰流率／全調查時段累計量），
     *   Excel 就要有兩張原生折線圖。舊版只放一張（三個尖峰），
     *   全調查時段的數字雖然在工作表裡，但**沒有圖**——
     *   收到檔案的人會以為那一張就是全部。
     *
     *   兩張圖的單位不同（PCU/hr vs PCU/調查時段），所以標題與縱軸
     *   名稱各自取自那一張圖自己的 view，不可以共用一個 seriesUnit。
     */
    const chartSpecs = charts.map(function (view) {
      return {
        series: view.scopes.map(seriesOf),
        /*
         * ⚠️ 只有**兩張圖**時才在標題裡加上「是哪一張」。
         *   單張圖時要維持原本的寫法——加上去的話，
         *   統計範圍在標題與面板上會各講一次（面板已經寫了），
         *   而且既有的守門是照原本那個字串比對的
         *  （e2e-chart-layout 實測紅在這裡，是對的）。
         */
        title:
          charts.length > 1
            ? `歷季${seriesLabel}趨勢・${view.caption}（單位：${view.unit}）`
            : `歷季${seriesLabel}趨勢（單位：${view.unit}）`,
        valueAxisTitle: `${seriesLabel}（${view.unit}）`,
        valueNumberFormat: metric.unit === "%" ? "0.0\\%" : "#,##0.0",
      };
    });
    await downloadEditableTrendWorkbook(
      workbook,
      "歷季趨勢比較",
      data.length + 1,
      chartSpecs,
      (intersections.find(function (entry) {
        return entry[0] === activeIntersection;
      })?.[1] || "路口") +
        "_" +
        activeRangeStart +
        "_至_" +
        activeRangeEnd +
        /* ⚠️ 同 PNG：帶指標，視角只在真的吃視角時才寫。 */
        "_" +
        seriesLabel +
        (metric.flowAware
          ? "_" + (trendFlow === "outbound" ? "駛出" : "駛入")
          : "") +
        "_歷季趨勢.xlsx",
      {
        title: `歷季${seriesLabel}趨勢（單位：${seriesUnit}）`,
        valueAxisTitle: `${seriesLabel}（${seriesUnit}）`,
        /* 佔比的資料值是 42.9（不是 0.429），所以 % 必須是文字，不可讓 Excel 再乘 100。 */
        valueNumberFormat: metric.unit === "%" ? "0.0\\%" : "#,##0.0",
      },
    );
    props.notify("趨勢 Excel 已下載，折線圖可直接編輯。");
  }
  /*
   * ══════════════════════════════════════════════════════════════
   *  X-52：貼在**每一塊**上的不適用說明
   * ══════════════════════════════════════════════════════════════
   *
   * 圖與「季度變化」各掛一份。掛在功能列裡等於沒掛：看圖的人不會把
   * 上面那一句和這張圖連起來，逐塊守門也量不到。
   */
  /*
   * ⚠️ X-84（使用者 2026-09-18，附圖）：「歷季趨勢圖說明文字重複了」。
   *
   *   圖與「季度變化」是**左右並排**的兩塊，各掛一份之後，同一段長句在
   *   同一個畫面上出現兩次，看起來就像壞掉。
   *
   * ⚠️ 但**不可以乾脆只掛一塊**：逐塊守門（e2e-filter-coverage）要求每一塊
   *   自己表態，少掛的那一塊會被判成「既沒變也沒說」——而且判得對，
   *   看右邊那一塊的人不會自動去讀左邊圖上的那一句。
   *
   *   所以改成：**圖那一塊寫完整，右邊那一塊寫一句短的並指回去**。
   *   兩塊都仍然帶著 data-inapplicable，守門照樣量得到。
   */
  const blockNotes = function (compact: boolean) {
    return (
      <>
        {compact ? null : props.unusedNote}
        {(props.flowView === "inbound" || props.flowView === "outbound") && (
          <p
            className="chart-inapplicable"
            data-testid="chart-inapplicable"
            /*
             * ⚠️ 只有「這個指標不分駛入駛出」時才算不適用；
             *   指標分得出來的時候它是真的會換一條線的，那時不可以標成不適用。
             */
            data-inapplicable={
              !metric.flowAware || flowGap === 0 ? "flowView" : undefined
            }
          >
            {compact
              ? metric.flowAware
                ? `本表與左圖同一份：已改畫${
                    props.flowView === "inbound" ? "駛入" : "駛出"
                  }總量（完整說明見左圖）。`
                : `目前的指標「${metric.label}」不分駛入與駛出（完整說明見左圖）。`
              : metric.flowAware
                ? `本圖已改畫${
                    props.flowView === "inbound" ? "駛入" : "駛出"
                  }總量。⚠️ 每一筆流向都有指定目的支線時，駛出合計與駛入合計本來就相等，這時兩條線會完全重疊——那不是沒生效，是守恆成立。`
                : `目前的指標「${metric.label}」不分駛入與駛出（同一批車換一種分組，兩個方向的數字相同），因此不適用主工具列的「路口流量視角」。要看方向差異請把指標切到「路口總量」。`}
          </p>
        )}
        {compact ? props.unusedNoteCompact ?? props.unusedNote : null}
      </>
    );
  };
  if (!props.records.length)
    return (
      <Empty title="尚無歷季資料" text="匯入同一路口至少兩季後即可比較。" />
    );
  return (
    <>
      <section className="page-head">
        <div>
          <span className="eyebrow">QUARTERLY TREND</span>
          <h1>歷季趨勢比較</h1>
          <p>
            選擇同一路口的起始與結束季度；圖中所有數值與 Y 軸名稱均標示單位。
          </p>
        </div>
        <div className="head-buttons">
          <button className="secondary" onClick={exportTrendExcel}>
            下載趨勢 Excel
          </button>
          <button
            className="primary"
            data-chart-png="trend"
            onClick={exportChart}
            title="以 3 倍解析度重新繪製後下載；圖上只有圖，不含說明文字"
          >
            下載趨勢 PNG
            <small>只有圖，不含數值標籤</small>
          </button>
        </div>
      </section>
      {props.detachNote}
      <section className="trend-controls panel">
        <label>
          路口
          <select
            data-testid="trend-intersection"
            value={activeIntersection}
            onChange={function (e) {
              setSelectedIntersection(e.target.value);
            }}
          >
            {intersections.map(function (entry) {
              return (
                <option key={entry[0]} value={entry[0]}>
                  {entry[1]}
                </option>
              );
            })}
          </select>
        </label>
        {surveyTypes.length > 1 && (
          <label>
            資料別
            <select
              value={activeSurveyType}
              onChange={function (e) {
                setSurveyTypeFilter(e.target.value);
              }}
            >
              {surveyTypes.map(function (type) {
                return (
                  <option key={type} value={type}>
                    {type}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        {trend.parallelStations && (
          <label>
            站號
            <select
              value={trend.station}
              onChange={function (e) {
                setStationFilter(e.target.value);
              }}
            >
              {trend.availableStations.map(function (station) {
                return (
                  <option key={station} value={station}>
                    {station}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        {/*
          * 指標選單。預設「路口總量」＝舊版唯一畫得出來的那一條線，
          * 所以不動這個選單時的行為與舊版完全相同。
          */}
        <label>
          指標
          <select
            id="trendMetric"
            value={metric.id}
            onChange={function (e) {
              setMetricId(e.target.value);
              /* 換指標就把上一個指標選到的對象清掉，免得沿用到不相干的鍵。 */
              setMetricKey("");
            }}
          >
            {TREND_METRICS.map(function (item) {
              return (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              );
            })}
          </select>
        </label>
        {metric.picker && optionList.length > 0 && (
          <label>
            {metric.picker === "vehicle"
              ? "車種"
              : metric.picker === "arm"
                ? "支線"
                : "轉向"}
            <select
              id="trendMetricKey"
              value={activeKey}
              onChange={function (e) {
                setMetricKey(e.target.value);
              }}
            >
              {/*
                * ⚠️ 「全部（逐項一條線）」放在**第一個**，但**不是預設值**。
                *   預設仍然是第一個實際對象，所以不動它的人看到的圖與升級前
                *   一模一樣。只有一個對象時不列這一項——一條線的「逐項」
                *   和「單選」是同一張圖，多一個選項只會讓人以為有差別。
                */}
              {canSplitOptions && (
                <option value={ALL_OPTIONS_KEY}>全部（逐項一條線）</option>
              )}
              {optionList.map(function (key) {
                return (
                  <option key={key} value={key}>
                    {metric.picker === "vehicle"
                      ? vehicleNameOf(key)
                      : metric.picker === "movement"
                        ? MOVEMENT_LABELS[key as MovementKey]
                        : key}
                  </option>
                );
              })}
            </select>
            {/*
              * ⚠️ 超過 8 項時**不提供**「逐項一條線」，而且要講明理由。
              *   不講的話，有 10 個支線的使用者只會看到那個選項不見了，
              *   以為是程式壞了。多出來的線一定得自動配色，而自動配的色
              *   不是對比不足、就是兩條幾乎一樣——那種圖比沒有還糟。
              */}
            {optionList.length > TREND_LINE_PALETTE.length && (
              <small
                className="field-hint"
                data-testid="trend-too-many-options"
              >
                目前有 {optionList.length} 項，超過 8 項就不提供「逐項一條線」
                （線太多會分不出誰是誰），請逐一選看。
              </small>
            )}
          </label>
        )}
        <Segmented
          value={trendMode}
          options={[
            /*
             * 順序刻意是「AM／PM／全調查時段／全調查時段尖峰／整體」，
             * 與使用者 2026-09-10 指定的一致；SCOPE_KEYS 本身是
             * AM、PM、DAY、FULL，所以這裡把 FULL 提到 DAY 前面。
             */
            ...(["AM", "PM", "FULL", "DAY"] as ScopeKey[]).map(function (
              key,
            ): [ScopeKey | "ALL", string] {
              return [key, SCOPE_SHORT_LABELS[key]];
            }),
            ["ALL", "整體（四個範圍・上下兩張圖）"],
          ]}
          onChange={function (value: ScopeKey | "ALL") {
            props.setPeak(value === "ALL" ? "AMPM" : value);
          }}
        />
        {/*
          * 只有會跟著駛出／駛入改變的指標才顯示這個切換。
          * 車種與轉向類指標不分駛出駛入（同一批車，分組方式不同也不會變多變少），
          * 留著一個按了沒反應的切換，使用者會以為是壞的。
          */}
        {metric.flowAware && (
          <Segmented
            value={trendFlow}
            options={[
              ["outbound", "駛出總量"],
              ["inbound", "駛入總量"],
            ]}
            onChange={setTrendFlow}
          />
        )}
        {/*
         * ⚠️ 不是每一個指標都分得出駛入與駛出。
         *   車種與轉向類指標是同一批車換一種分組，兩個方向的數字一樣；
         *   主工具列切了「只顯示駛入」卻一個數字都不變時，
         *   使用者只會以為壞了——所以這裡講出來為什麼。
         */}
        {/*
         * ⚠️ X-52：這一句原本掛在這裡（功能列裡），現在改成**貼在圖與
         *   「季度變化」各自那一塊上**（見 blockNotes）。理由有兩個：
         *   ① 使用者 2026-09-15：「請確保每個圖表都要有各自的不適用說明」；
         *   ② 掛在功能列裡的話，逐塊守門（e2e-filter-coverage）量不到它，
         *      那兩塊就會被判成「既沒變也沒說」——而且判得對，
         *      因為看圖的人根本不會把上面那一句和這張圖連起來。
         */}
        <div className="quarter-range">
          <label>
            起始季度
            <select
              value={activeRangeStart}
              onChange={function (e) {
                const next = e.target.value;
                setRangeStart(next);
                if (
                  allQuarters.indexOf(next) >
                  allQuarters.indexOf(activeRangeEnd)
                )
                  setRangeEnd(next);
              }}
            >
              {allQuarters.map(function (q) {
                return (
                  <option key={q} value={q}>
                    {props.showQuarter(q)}
                  </option>
                );
              })}
            </select>
          </label>
          <span>至</span>
          <label>
            結束季度
            <select
              value={activeRangeEnd}
              onChange={function (e) {
                const next = e.target.value;
                setRangeEnd(next);
                if (
                  allQuarters.indexOf(next) <
                  allQuarters.indexOf(activeRangeStart)
                )
                  setRangeStart(next);
              }}
            >
              {allQuarters.map(function (q) {
                return (
                  <option key={q} value={q}>
                    {props.showQuarter(q)}
                  </option>
                );
              })}
            </select>
          </label>
          <b>
            {chosen.length} 季 · 有資料 {rows.length} 季
          </b>
        </div>
        {/*
         * ⚠️ 這一行是 2026-09-14 逐頁肉眼檢查補的。
         *
         *   畫面上同時有兩組季度：主工具列寫「115Q2 ～ 115Q2」，
         *   這一塊卻寫「115Q1 ～ 115Q2」，而且中間沒有任何一個字解釋，
         *   看起來就像其中一邊壞了。實際上兩者是**先後兩道**：
         *     (1) 主工具列的季度區間先決定「這張圖看得到哪幾季」
         *        （起＝迄是預設狀態，代表不限季，歷季類的圖要看全部——
         *          和另外兩支程式同一條規則）
         *     (2) 這兩顆再從看得到的那幾季裡挑要畫的起訖
         *   歷季圖沒有辦法只用主工具列表達「畫 115Q1～115Q3 這三季」，
         *   所以這兩顆不可以拿掉；能做的是把關係講明白。
         */}
        {/*
         * ⚠️ X-84（使用者 2026-09-18）：這一句原本寫「起＝迄時不限季，
         *   歷季圖一律看全部」——那是**舊行為**。使用者 2026-09-15 已經裁示
         *   「起＝迄，是指單一季度」，程式（trendRecordsForChart）也早就照這樣做了，
         *   只有這一句說明沒跟著改，變成**畫面在說謊**：畫面上明明只有一個點，
         *   說明卻說「一律看全部」。
         */}
        <p className="trend-range-note">
          主工具列的季度區間先決定這張圖看得到哪幾季（<b>起＝迄就是單一季度</b>，這時圖上只會有一個點）；這一區自己的「起」「迄」再從其中挑要畫的起訖。
        </p>
        {rows.length > 0 && (
          <p
            className={
              flowGap ? "trend-station-note warn" : "trend-station-note"
            }
          >
            {flowGap
              ? `注意：這個路口的「駛出」與「駛入」總量不相等，最大差 ${Math.abs(flowGap).toLocaleString()} PCU/hr。` +
                "兩者是同一批流向、只是分組方式不同，總量本來應該相等；不相等代表有流向沒有指定目的支線。" +
                "請到「道路與流向管理」補齊，在補齊之前「駛入總量」會少掉這個量。"
              : "「駛出」與「駛入」總量相同：每一筆流向都有指定目的支線，兩種視角可以互相核對。" +
                "切換視角只會改變分組方式，不會改變路口總量。"}
          </p>
        )}
        {/*
          * 這個路口同時有「待設定」和真正的資料別時，趨勢線會被拆成兩條
          * ——選平日只剩 1 季、選待設定才有 4 季。這不是趨勢頁的計算問題，
          * 而是那幾季在匯入當下讀不出資料別（舊版），紀錄裡就存著待設定；
          * 資料別不會自己重讀，所以要在這裡讓使用者直接補完。
          */}
        {pendingHere.length > 0 && realSurveyTypes.length > 0 && (
          <p className="trend-station-note warn trend-pending-note">
            <span>
              這個路口有 <b>{pendingHere.length}</b> 季的資料別是「待設定」，
              另有 {realSurveyTypes.join("、")} 的資料
              ——「待設定」會被當成另一種資料別，所以趨勢線被拆成兩條
              （選「{realSurveyTypes[0]}」只看得到一部分的季度）。
              資料別是<b>匯入當下</b>判定並存進每一筆的，不會自己重讀，
              請直接指定：
            </span>
            <span className="trend-pending-list">
              尚未指定的是：
              <b>
                {pendingHere
                  .map(function (record) {
                    return record.quarter;
                  })
                  .join("、")}
              </b>
              （按下去之前會再列一次完整清單，含站號與路口名稱，讓您確認再決定）
            </span>
            <span className="trend-pending-warn">
              ⚠️ <b>這幾季如果不是同一種資料別，不要用批次。</b>
              例如其中有幾季其實是假日調查，批次會把它們一起指定成同一種。
              這種情況請到左側選單的
              <b>「流量核對工作台」</b>
              ，用上方的路口選擇器選到那一筆，再用「資料別（平日／假日）」下拉
              <b>逐筆指定</b>
              。判斷依據是原始調查檔本身（調查日期是星期幾、檔名或工作表有沒有寫）。
            </span>
            <span className="trend-pending-actions">
              {["平日", "假日"].map(function (value) {
                return (
                  <button
                    key={value}
                    className="secondary"
                    onClick={function () {
                      props.assignPendingSurveyType(value, activeIntersection);
                    }}
                  >
                    把這個路口的 {pendingHere.length} 季都指定為{value}
                  </button>
                );
              })}
              {props.pendingCount > pendingHere.length && (
                <button
                  className="ghost"
                  onClick={function () {
                    props.assignPendingSurveyType("平日");
                  }}
                >
                  整個計畫的 {props.pendingCount} 筆都指定為平日
                </button>
              )}
            </span>
          </p>
        )}
        {trend.chainedStations && (
          <p className="trend-station-note">
            本路口的站號歷年有變動（{trend.stations.join(" → ")}
            ），已依路口名稱串接為同一條趨勢線。
          </p>
        )}
        {trend.parallelStations && (
          <p className="trend-station-note">
            同一季同時有多個站號（{trend.availableStations.join("、")}
            ），趨勢僅呈現所選站號；要看另一個站請切換上方「站號」。
          </p>
        )}
      </section>
      <section className="trend-layout">
        {/*
          * data-charts 讓 CSS 知道釘住區裡有幾張圖：兩張時每張要壓到 24vh，
          * 否則釘住區會比視窗高，標題與單位又會被切掉。
          */}
        <article
          className={focusClass("trend-chart", "panel trend-chart")}
          id="trend-chart"
          data-charts={charts.length}
        >
          {/*
           * ⚠️ 歷季趨勢不吃「尖峰時段」「尖峰時段判定方式」「路口流量視角」
           *   「資料別」「顯示數值」。那一句由**外層**算好傳進來
           *   （這個元件拿不到 mainFilters，與 detachNote 同一種作法）。
           *   使用者 2026-09-15：「請確保每個圖表都要有各自的不適用說明」——
           *   兩塊各掛一次，不是掛在頁面上方一次了事。
           */}
          {blockNotes(false)}
          {/*
            * ── 釘住區（sticky）────────────────────────────────────
            *
            * 使用者 2026-09-10 實測回報三件事，三個成因不同：
            *  (1) 「圖標題和單位就消失在畫面了」
            *     → 釘住的容器**比視窗還高**。sticky 只保證上緣貼住，
            *       超出的部分被切掉，而被切掉的一定是最上面那幾行。
            *       修法：**釘住的東西要小到放得進視窗**，讓圖跟著縮
            *      （height: min(46vh, 390px)），不是讓容器溢出。
            *  (2) 「我該如何解除圖片固定的效果?」
            *     → **不需要按鈕**。sticky 只在自己的包含區塊裡黏住，
            *       捲出去就自動放開。這裡的包含區塊是 .trend-layout。
            *
            * ══════════════════════════════════════════════════════
            *  X-53：釘住區裡那組「路口／指標」已於 2026-09-16 移除
            * ══════════════════════════════════════════════════════
            *
            * 使用者 2026-09-16（附圖，兩組都圈起來了）：
            *   「歷季趨勢自身工具列，其中路口和指標與自身工具列重複了，
            *     導致無法選擇路口，請保留上方那個比較完整的自身工具列的功能」
            *
            * ⚠️ 這一組原本是**同一位使用者 2026-09-10 要的**
            *   （「想換下一個路段，我又得一直往上滑到功能列」），
            *   兩次交辦互相衝突，這裡照**新的**那一次做。
            *   移除的理由他自己講得很清楚：同一頁上下兩組一樣的下拉，
            *   分不出該動哪一個。
            *
            * ⚠️ 移除的只有這兩顆下拉，**圖照樣釘住**
            *   （.trend-layout > .trend-chart 的 sticky 規則沒有動）。
            *   捲到說明時圖仍然看得見，那是 2026-09-10 那次的主要訴求。
            */}
          <div className="panel-head">
            <h2>
              {
                intersections.find(function (entry) {
                  return entry[0] === activeIntersection;
                })?.[1]
              }{" "}
              ·{" "}
              {trendMode === "ALL"
                ? "整體（尖峰＋全調查時段，上下兩張圖）"
                : SCOPE_SHORT_LABELS[trendMode]}
            </h2>
            {/*
              * 單位跟著這張圖自己的統計範圍走，不是跟著全域的 peak。
              * ⚠️ 「整體」有**兩種**單位（PCU/hr 與 PCU/調查時段），
              *   在這裡只寫一個一定會有一半是錯的——所以改標在各圖上方。
              */}
            {charts.length === 1 ? (
              <span className="status-dot">{seriesUnit}</span>
            ) : null}
          </div>
          {/*
           * ⚠️ 門檻是**一季**，不是兩季。
           *
           * 使用者 2026-09-15：「如果歷季圖出現起＝迄，導致趨勢圖只有
           *   單筆資料，那就**只顯示單筆資料，是沒問題的**」。
           *
           * 舊版寫 `rows.length >= 2`，那是「起＝迄＝不限季」那個錯誤語意
           * 的配套：既然起＝迄會畫全部，就永遠不會只有一季，門檻寫 2 也看不出來。
           * 語意改成「起＝迄＝只有那一季」之後，使用者選單季就會落進這個分支，
           * 看到的是「至少需要兩季資料，請擴大起始與結束季度範圍」——
           * 等於**程式在勸他不要選他剛剛選的東西**。
           *
           * ⚠️ 一季畫得出來：折線的 x 座標用 `Math.max(1, count - 1)` 當分母，
           *   count=1 時點落在最左邊；X 軸標籤的 showXLabel(0, 1, stride)
           *   走「最後一個一定印」那條，標籤也印得出來。
           *   （0 季才是真的沒東西可畫，那時仍然顯示空狀態。）
           */}
          {rows.length >= 1 ? (
            charts.map(function (view) {
            return (
            <div className="trend-svg-scroll" key={view.key}>
              {charts.length > 1 ? (
                <p className="trend-chart-caption">
                  <strong>{view.caption}</strong>
                  <span className="status-dot">{view.unit}</span>
                </p>
              ) : null}
              <svg
                id={view.svgId}
                className="trend-svg"
                data-scopes={view.scopes.join(",")}
                data-axis-max={view.max}
                data-unit={view.unit}
                xmlns="http://www.w3.org/2000/svg"
                width={chartWidth}
                height="390"
                viewBox={`0 0 ${chartWidth} 390`}
                role="img"
                aria-label={view.ariaLabel}
              >
                {/*
                  * 樣式一定要內嵌，不可以只靠 globals.css。
                  * svgToPng 會把這張 SVG 序列化成獨立文件再畫進 canvas，
                  * 那份文件讀不到頁面樣式表——字級與 text-anchor 全部退回
                  * 預設值，匯出的圖會變成 16px 襯線體、而且每一段字整個
                  * 往右移半個字寬（middle→start），直接互相重疊。
                  */}
                <style>{CHART_SVG_STYLE}</style>
                <rect width={chartWidth} height="390" fill="#fff" rx="12" />
                {/*
                  * 縱軸名稱用「橫排的字整段轉 90 度」，不用 vertical-rl——
                  * 理由見 CHART_SVG_STYLE 的說明（直排前進量缺失時，
                  * 中文字會全部疊在一起）。
                  */}
                <text
                  className="y-axis-title"
                  transform="translate(20,190) rotate(-90)"
                  textAnchor="middle"
                >
                  {/*
                    * 軸名稱要跟著指標走，而且一定要帶單位——使用者的要求是
                    * 「有單位的軸，就要附上名稱和單位」。舊版寫死「尖峰小時
                    * 交通量（PCU/hr）」，換成車種或佔比之後就變成錯的。
                    */}
                  {seriesLabel}（{view.unit}）
                </text>
                {/* 橫軸也要有名稱，不然「113Q1」那一排字沒有標題。 */}
                <text
                  x={(100 + chartWidth - 70) / 2}
                  y="382"
                  className="axis-title"
                  textAnchor="middle"
                >
                  季度
                </text>
                <g className="grid-lines">
                  {[0, 1, 2, 3, 4].map(function (i) {
                    return (
                      <g key={i}>
                        <line
                          x1="84"
                          x2={chartWidth - 60}
                          y1={70 + i * 60}
                          y2={70 + i * 60}
                        />
                        {/*
                          * 刻度只寫數字，單位寫在軸名稱上。舊版每一格都補
                          * 「PCU/hr」，換成「輛」或「%」之後每一格都是錯的，
                          * 而且五格重複同一個單位本來就是多餘的。
                          */}
                        <text x="75" y={75 + i * 60}>
                          {tickText(view.max * (1 - i / 4), view.tickDigits)}
                        </text>
                      </g>
                    );
                  })}
                </g>
                {view.showLegend && (
                  /*
                   * ⚠️ 圖例要**換行**，不可以一路往右排。
                   *   逐項分列時線數由資料決定（支線可能有五、六條），
                   *   一路排下去會直接畫到圖外面，而畫面上看起來就是
                   *   「圖例不見了」。這裡照名稱長度決定一排放幾個。
                   */
                  <g className="trend-legend">
                    {(function () {
                      const slot = Math.max(
                        112,
                        Math.min(
                          220,
                          Math.max(
                            ...view.series.map(
                              (item) => item.label.length * 13 + 26,
                            ),
                          ),
                        ),
                      );
                      const perRow = Math.max(
                        1,
                        Math.floor((chartWidth - 120) / slot),
                      );
                      return view.series.map(function (item, index) {
                        const row = Math.floor(index / perRow);
                        const col = index % perRow;
                        const x = 100 + col * slot;
                        const y = 35 + row * 18;
                        return (
                          <g key={item.id}>
                            <circle cx={x} cy={y} r="5" fill={item.color} />
                            <text x={x + 11} y={y + 4}>
                              {item.label}
                            </text>
                          </g>
                        );
                      });
                    })()}
                  </g>
                )}
                {view.series.map(function (item) {
                  return (
                    <g key={item.id}>
                      {item.segments.map(function (segment, segmentIndex) {
                        return (
                          <polyline
                            key={item.id + "-seg" + segmentIndex}
                            points={segment
                              .map(function (p) {
                                return p.x + "," + p.y;
                              })
                              .join(" ")}
                            fill="none"
                            stroke={item.color}
                            strokeWidth="4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        );
                      })}
                      {item.points.filter(function (p) {
                        return p.has;
                      }).map(function (p) {
                        const pointRecord = p.record as TrafficRecord;
                        const axisIndex = axisQuarters.indexOf(p.quarter);
                        /*
                         * ⚠️ hover 的鍵要用 item.id（統計範圍＋對象），
                         *   不是 item.peak。逐項分列時同一個統計範圍上有
                         *   好幾條線，只用 peak 的話同一季所有線的鍵一樣，
                         *   滑到其中一條會讓全部一起亮起來、全部一起標數字。
                         */
                        const hoverKey = item.id + "-" + pointRecord.id;
                        const hovered = trendHover === hoverKey;
                        return (
                          <g
                            key={hoverKey}
                            onMouseEnter={function () {
                              setTrendHover(hoverKey);
                            }}
                            onMouseLeave={function () {
                              setTrendHover("");
                            }}
                          >
                            {/*
                              滑鼠的感應範圍要比看得見的點大一圈，否則很難對準。
                              透明圓不會出現在畫面上，也不影響匯出。
                            */}
                            <circle cx={p.x} cy={p.y} r="16" fill="transparent" />
                            {/*
                              ⚠️ data-value 一定要在，而且**不受標籤顯示與否影響**。
                              數值標籤改成「量多時只在滑鼠移上去才顯示」之後，
                              scripts/e2e-chart-layout.mjs 那支守門就讀不到值了
                              ——它是從 SVG 量像素、照縱軸反推回值，再與「點旁邊
                              標的數字」比對；標籤不在，比對就沒有參照物，
                              整組斷言退化成恆真（實測直接紅在前置檢查，設計正確）。
                              改成把值寫在點自己身上：看不見、不影響版面、
                              匯出時也不會印出來，但守門任何時候都讀得到。
                              而且這比讀標籤**更強**——密集情況（120 季）也驗得到，
                              那正是以前驗不到的那一段。
                            */}
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={hovered ? 9 : 7}
                              fill="#fff"
                              stroke={item.color}
                              strokeWidth="4"
                              data-value={p.value}
                              data-peak={item.peak}
                              data-series={item.label}
                              data-quarter={p.quarter}
                            />
                            {(view.showStaticPointLabels || hovered) &&
                            showXLabel(
                              axisIndex,
                              axisQuarters.length,
                              hovered ? 1 : view.pointLabelStride,
                            ) ? (
                              <text
                                x={p.x}
                                /*
                                 * ⚠️ 最左／最右那一季的標籤要改對齊方式，
                                 *   不可以一律置中。
                                 *
                                 * 繪圖區是 x ∈ [100, chartWidth-70]，縱軸刻度
                                 * 就畫在 x<100 的地方。標籤置中的話，第一季那個
                                 * 標籤有一半會跑到 x<100，**壓在縱軸刻度數字上**
                                 * ——姊妹專案（全日交通量）2026-09-11 就是這樣被
                                 * 使用者截圖抓到的（「平日 677,819」壓在 600,000 上）。
                                 * 這一支的結構一模一樣，只是還沒有人點到那張圖。
                                 *
                                 * 3px 是往內縮的餘裕，讓標籤不要剛好貼齊邊界。
                                 */
                                /*
                                 * ⚠️ 一定要用 style，不可以用 textAnchor 屬性。
                                 *   CHART_SVG_STYLE 裡的
                                 *   `.point-value{text-anchor:middle}` 是 CSS，
                                 *   而 CSS 的優先權高於 SVG 的呈現屬性——
                                 *   寫成屬性的話這一段完全不會生效，
                                 *   而且外觀看起來「好像有在做事」。
                                 */
                                style={{
                                  textAnchor:
                                    p.x <= 100.5
                                      ? "start"
                                      : p.x >= chartWidth - 70.5
                                        ? "end"
                                        : "middle",
                                }}
                                /*
                                 * ⚠️ 往內縮 6px。縱軸刻度是右對齊畫在 x=75，
                                 *   繪圖區左緣是 100——只縮 3px 的話離刻度 28px，
                                 *   看起來還可以；但姊妹專案只留 13px 就被使用者
                                 *   回報「數字有和Y軸重疊的疑慮」，兩支用同一個
                                 *   標準比較不會再出現「這支可以那支不行」。
                                 */
                                dx={
                                  p.x <= 100.5
                                    ? 6
                                    : p.x >= chartWidth - 70.5
                                      ? -6
                                      : 0
                                }
                                y={
                                  p.y +
                                  /*
                                   * 同一季有幾個標籤，就要錯開幾層。
                                   * ⚠️ 依「這張圖有幾條線」判斷，不可以再看
                                   *   trendMode——「整體」的下圖只有一條線，
                                   *   照舊寫法會被推到 +36，標籤離點很遠。
                                   */
                                  (view.scopes.length === 1
                                    ? -16
                                    : item.peak === "AM"
                                      ? -28
                                      : item.peak === "PM"
                                        ? 18
                                        : 36)
                                }
                                className="point-value"
                                /*
                                 * ⚠️ 文字顏色**不可以用系列色**。
                                 *   PM 那條線是 #d97706，白底上只有 3.1:1
                                 *   （AA 需 4.5:1）。姊妹專案同一個做法實測被
                                 *   全頁對比掃描抓到（橘色 2.62:1）。
                                 *   專案早就定過這條規則：「數值標籤一律用文字色」。
                                 *   認哪一條線靠的是標籤自己寫的 AM／PM，不是顏色。
                                 *   顏色由 .point-value 的 fill:#31505a 統一給。
                                 */
                              >
                              {view.series.length > 1
                                ? item.shortLabel + " "
                                : ""}
                              {/*
                                * 點的座標（y）與這個標籤一定要來自**同一次**
                                * 計算。舊版點用 totalOf、標籤用 recordTotal，
                                * 資料有缺口的路口切到「駛入」就會變成「點畫在
                                * 駛入的高度、旁邊標的卻是駛出的數字」——而這張
                                * 圖會被下載成 PNG 交出去。
                                * 現在兩者都走 valueOf（buildMetricSeries），
                                * 結構上不可能再分岔。
                                */}
                              {/*
                                * 點上的數字**不再重複單位**。
                                *
                                * 單位現在寫在縱軸名稱上，每一個點再標一次
                                * 「PCU/hr」是多餘的，而且會把標籤撐到 85px 寬
                                * ——24 季時相鄰兩個點的標籤直接疊在一起
                                *（實測「5,371.3」與「4,795.8 PCU/hr」相交）。
                                * 拿掉單位之後只剩 40px，100px 的間距放得下。
                                */}
                                {/*
                                  * ⚠️ 一定要帶 item.option。逐項分列時少了它，
                                  *   點畫在「這條支線」的高度、旁邊卻標著
                                  *   「目前下拉選到那一個支線」的數字——
                                  *   正是上面那一段註解講的那個舊毛病。
                                  */}
                                {formatMetric(
                                  valueOf(pointRecord, item.peak, item.option)
                                    .value,
                                  { unit: "", digits: metric.digits },
                                ).trim()}
                              </text>
                            ) : null}
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
                {axisQuarters.map(function (quarter, index) {
                  /*
                   * 季度累積下去之後，每一季都印會擠成一團——而那時候使用者
                   * 已經在簡報現場了。照實際字寬算印得下幾個，最後一季一定印
                   *（業主最在意的是「現在到哪了」）。
                   */
                  if (!showXLabel(index, axisQuarters.length, xLabelStride))
                    return null;
                  const x =
                    100 +
                    (index * (chartWidth - 170)) /
                      Math.max(1, axisQuarters.length - 1);
                  return (
                    <text key={quarter} x={x} y="355" className="x-label">
                      {props.quarterLabels[quarter] || quarter}
                    </text>
                  );
                })}
              </svg>
            </div>
            );
            })
          ) : (
            <Empty
              title="這個範圍沒有可以畫的資料"
              text={
                chosen.length > 0
                  ? `所選範圍有 ${chosen.length} 季，但這個路口在「${activeSurveyType || "此資料別"}」底下一季都沒有資料。請改選其他資料別，或確認這些季度的路口名稱是否一致（名稱不同會被當成不同路口）。`
                  : "請擴大起始與結束季度範圍。"
              }
            />
          )}
        </article>
        <article
          className={focusClass("trend-summary", "panel trend-summary")}
          id="trend-summary"
        >
          {/*
           * ⚠️ 歷季趨勢不吃「尖峰時段」「尖峰時段判定方式」「路口流量視角」
           *   「資料別」「顯示數值」。那一句由**外層**算好傳進來
           *   （這個元件拿不到 mainFilters，與 detachNote 同一種作法）。
           *   使用者 2026-09-15：「請確保每個圖表都要有各自的不適用說明」——
           *   兩塊各掛一次，不是掛在頁面上方一次了事。
           */}
          {blockNotes(true)}
          <h2>季度變化</h2>
          {rows.map(function (record, index) {
            /*
             * 右側摘要必須與左側**實際畫出的那幾條線**一對一。
             *
             * ⚠️ 逐項分列時要跟著逐項列，不可以還照 trendPeaks 列——
             *   那樣會列出「目前下拉選到那一個支線」的數字，
             *   而圖上畫的是全部支線，兩邊講的不是同一件事。
             * ⚠️ 逐項分列時只取**第一張圖**那一個統計範圍，
             *   四個範圍全列的話一季會長出「範圍數 × 支線數」行。
             *   第一段已經寫明是哪一個範圍。
             */
            const summarySeries: Array<{
              key: string;
              label: string;
              short: string;
              peak: ScopeKey;
              option: TrendMetricOption;
            }> = perOption
              ? optionSpecs(charts[0].scopes[0]).map(function (spec) {
                  return {
                    key: spec.id,
                    label: spec.label,
                    short: spec.shortLabel,
                    peak: spec.peak,
                    option: spec.option,
                  };
                })
              : trendPeaks.map(function (peak) {
                  return {
                    key: peak,
                    label: peakLegendLabels[peak],
                    /* ⚠️ 沿用舊版的短字，畫面上的字一個都不變。 */
                    short: peak,
                    peak,
                    option: metricOption,
                  };
                });
            const summaries = summarySeries.map(function (entry) {
              const current = valueOf(record, entry.peak, entry.option);
              const has = current.value !== null;
              const value = current.value ?? 0;
              /*
               * 增減率也要看「上一季有沒有值」。拿 0 當基準算出來的
               * 百分比不是任何真實的變化。
               */
              const priorResult = index
                ? valueOf(rows[index - 1], entry.peak, entry.option)
                : null;
              const priorHas = Boolean(index && priorResult?.value !== null);
              const prior = priorResult?.value ?? 0;
              return {
                peak: entry.peak,
                key: entry.key,
                label: entry.label,
                short: entry.short,
                has,
                value,
                pct: has && priorHas && prior ? (value / prior - 1) * 100 : null,
              };
            });
            const active = summaries[0];
            return (
              <div key={record.id}>
                <span>
                  {props.quarterLabels[record.quarter] || record.quarter}
                </span>
                {/*
                  * ⚠️ 判斷依據是「這一季實際有幾條線」，不是 trendMode。
                  *   逐項分列時 trendMode 可能只選了一個尖峰，但線有好幾條；
                  *   照 trendMode 判斷的話只會印出第一條支線的數字，
                  *   而畫面上一個字都不會說其餘幾條去哪了。
                  */}
                {summaries.length > 1 ? (
                  <>
                    <b className="trend-pair">
                      {summaries.map(function (item) {
                        return (
                          <span key={item.key}>
                            {item.label}{" "}
                            {item.has
                              ? formatMetric(item.value, {
                                  unit: seriesUnit,
                                  digits: metric.digits,
                                })
                              : "－"}
                          </span>
                        );
                      })}
                    </b>
                    <span className="trend-pcts">
                      {summaries.map(function (item) {
                        return (
                          <i
                            key={item.key}
                            className={
                              item.pct == null
                                ? "flat"
                                : item.pct >= 0
                                  ? "up"
                                  : "down"
                            }
                          >
                            {item.short}{" "}
                            {!item.has
                              ? "－"
                              : item.pct == null
                                ? "基準"
                                : (item.pct >= 0 ? "+" : "") +
                                  item.pct.toFixed(1) +
                                  "%"}
                          </i>
                        );
                      })}
                    </span>
                  </>
                ) : (
                  <>
                    {/* 單獨選「全日尖峰」時，算不出來的季度同樣顯示「－」。 */}
                    <b>
                      {active.has
                        ? formatMetric(active.value, {
                            unit: seriesUnit,
                            digits: metric.digits,
                          })
                        : "－"}
                    </b>
                    <i
                      className={
                        active.pct == null
                          ? "flat"
                          : active.pct >= 0
                            ? "up"
                            : "down"
                      }
                    >
                      {!active.has
                        ? "－"
                        : active.pct == null
                          ? "基準"
                          : (active.pct >= 0 ? "+" : "") +
                            active.pct.toFixed(1) +
                            "%"}
                    </i>
                  </>
                )}
              </div>
            );
          })}
        </article>
      {/*
        * ── 圖表說明欄位（簡報講稿）──────────────────────────────
        *
        * 使用者的原話：單一計畫的歷季趨勢圖「使用頻率很高，因為是要給業主
        * 的，所以資料正確性、圖表代表的意義很重要」，希望有一個欄位寫清楚
        * 「把這個圖表放到簡報時，聽眾會想知道圖表代表的意義是什麼」。
        *
        * ⚠️ 這段文字**只讀上面那一份 series**，不回頭重算。圖與講稿分岔的
        * 時候，被念出來的是講稿——那比圖畫錯更難發現。
        */}
      {rows.length >= 1 && (
        <section
          className={focusClass("trendScript", "panel trend-script")}
          id="trendScript"
          /* 見上面 NAV 那一段：純說明，不列成小分頁。 */
          data-nav-skip="explanation"
        >
          <div className="panel-head">
            <h2>這張圖怎麼講（簡報用）</h2>
            <button
              /*
               * ⚠️ 這個標記讓守門知道「這顆鈕只複製本區塊自己的文字」，
               *   所以不算可操作的控制項。守門會反過來要求：
               *   純說明區塊裡的按鈕**每一顆**都要有這個標記，
               *   否則就是標錯了——標記不可以變成萬用貼紙。
               */
              data-copy-own-text="true"
              className="ghost"
              onClick={function () {
                const text = scriptSections
                  .map(function (section) {
                    return (
                      "【" + section.title + "】\n" + section.lines.join("\n")
                    );
                  })
                  .join("\n\n");
                /* ⚠️ 2026-09-25：可選鏈短路整條鏈，連 .catch 都不會跑——
                   按下去完全沒反應。理由詳見結論草稿那一顆的註解。 */
                if (!navigator.clipboard?.writeText)
                  return props.notify(
                    "這個瀏覽器不允許程式複製，請手動選取說明文字後複製。",
                  );
                navigator.clipboard
                  .writeText(text)
                  .then(function () {
                    props.notify("說明文字已複製，可直接貼進簡報備忘稿。");
                  })
                  .catch(function () {
                    props.notify("瀏覽器不允許複製，請手動選取文字。");
                  });
              }}
            >
              複製全部說明
            </button>
          </div>
          {/*
            * ⚠️ 逐項分列時**一定要講**這一段講稿只涵蓋其中一條線。
            *   不講的話，使用者會把「路口A 支線流量從 X 到 Y」整段抄進報告，
            *   而圖上明明還有另外幾條線——講稿沒有說謊，但讀的人會以為
            *   那一段講的是整張圖。與「整體時講稿只講 AM」同一個處理。
            */}
          {perOption && (
            <p className="trend-caveat" data-testid="trend-script-one-line">
              圖上有 {charts[0].series.length} 條線（一個
              {metric.picker === "vehicle"
                ? "車種"
                : metric.picker === "movement"
                  ? "轉向"
                  : "支線"}
              一條）。以下這一段只講其中的「{optionLabelOf(defaultKey)}」，
              其餘幾條請直接看圖與「季度變化」；要單獨講某一條，
              請在上方的下拉改選那一個。
            </p>
          )}
          {scriptSections.map(function (section) {
            return (
              <div className="trend-script-item" key={section.title}>
                <h4>{section.title}</h4>
                {section.lines.map(function (line, index) {
                  return (
                    <p
                      key={index}
                      className={
                        section.title === "要先講清楚的" ? "trend-caveat" : ""
                      }
                    >
                      {line}
                    </p>
                  );
                })}
              </div>
            );
          })}
        </section>
      )}
      </section>
    </>
  );
}
