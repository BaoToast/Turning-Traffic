"use client";

/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列（路口轉向）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 逐項指定要放哪些條件；模型與三態見 app/main-filters.ts。
 *
 * ⚠️ 這一條列在**每一頁**都看得到。升級前這些條件散在各頁：
 *   「時段」只出現在路口轉向圖那一頁，但它是全站共用的——在那裡切一下，
 *   流量核對工作台、轉向進階分析、歷季趨勢比較的數字就跟著換了，
 *   而那三頁上沒有任何地方顯示現在依的是哪個時段（實測，2026-09-14）。
 *   集中到這裡就是為了讓同一份資料在每一頁講同一句話。
 *
 * ⚠️ 「回歸全部」**只有在真的有圖脫離時才出現**。
 *   沒有人脫離時擺一顆按下去毫無反應的鈕＝壞掉的鈕，這是我們踩過的雷。
 *   而且字要寫出**有幾張**——使用者才知道按下去會影響多少東西。
 */
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_MAIN_FILTERS,
  describeMain,
  PEAK_CHOICE_LABELS,
  PEAK_RULE_LABELS,
  FLOW_VIEW_LABELS,
  DAY_LABELS,
  MOVEMENT_CHOICE_LABELS,
  DISPLAY_LABELS,
} from "./main-filters";
import type {
  MainFilters,
  PeakChoice,
  PeakRule,
  FlowView,
  DayChoice,
  MovementChoice,
  DisplayChoice,
} from "./main-filters";

/**
 * 多選下拉（與全日交通量同一種格式）。
 *
 * 使用者 2026-09-15：「請將交通服務水準程式和路口轉向程式主工具列的
 * 路段/路口，變成跟全日交通量格式（下拉式）一樣」。
 *
 * ⚠️ 為什麼不用 `<select multiple>`：那個東西在主工具列上有三個實際的毛病——
 *   ① 它一定要撐開好幾列才看得到選項，主工具列的高度整條被它決定；
 *   ② 多選要按住 Ctrl，沒有人看得出來，也沒有「全選／全部」可按；
 *   ③ 選了什麼只能靠反白看，關掉視窗之後看不出「已選幾個」。
 *   下拉式一列就夠，按鈕上直接寫「已選 N 個」，面板裡有核取方塊與全選。
 *
 * ⚠️ 一個都不勾＝全部，不是全部排除。面板底下那一行就是在講這件事，
 *   不可以拿掉——這是使用者實際誤會過的地方。
 */
function MultiPicker(props: {
  label: string;
  allLabel: string;
  options: [string, string][];
  value: string[];
  onChange: (next: string[]) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(
    function () {
      if (!open) return;
      const close = (event: MouseEvent) => {
        if (boxRef.current && !boxRef.current.contains(event.target as Node))
          setOpen(false);
      };
      const esc = (event: KeyboardEvent) => {
        if (event.key === "Escape") setOpen(false);
      };
      document.addEventListener("mousedown", close);
      document.addEventListener("keydown", esc);
      return function () {
        document.removeEventListener("mousedown", close);
        document.removeEventListener("keydown", esc);
      };
    },
    [open],
  );
  const picked = props.value;
  const summary =
    picked.length === 0
      ? props.allLabel
      : picked.length === 1
        ? (props.options.find(([id]) => id === picked[0])?.[1] ?? picked[0])
        : `已選 ${picked.length} 個`;
  return (
    <div className="multi-picker" ref={boxRef}>
      <button
        type="button"
        className={picked.length ? "multi-picker-btn on" : "multi-picker-btn"}
        onClick={function () {
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-label={`${props.label}：${summary}`}
        data-testid={props.testId}
        /* 可選項目數：端對端測試要在不打開面板的情況下數得出來。 */
        data-count={props.options.length}
      >
        <span>{summary}</span>
        <i aria-hidden="true">▼</i>
      </button>
      {open && (
        <div className="multi-picker-panel">
          <div className="multi-picker-head">
            <button
              type="button"
              onClick={function () {
                props.onChange([]);
              }}
            >
              {props.allLabel}
            </button>
            <button
              type="button"
              onClick={function () {
                props.onChange(props.options.map(([id]) => id));
              }}
            >
              全選
            </button>
          </div>
          <div className="multi-picker-list">
            {props.options.length ? (
              props.options.map(([id, name]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    /* ⚠️ 帶上 value：守門要在不讀 React 狀態的情況下
                       確認「這一項的值是哪幾個站號」（X-23）。 */
                    value={id}
                    checked={picked.includes(id)}
                    onChange={function () {
                      props.onChange(
                        picked.includes(id)
                          ? picked.filter((item) => item !== id)
                          : [...picked, id],
                      );
                    }}
                  />
                  <span>{name}</span>
                </label>
              ))
            ) : (
              <p className="multi-picker-empty">沒有可選的項目</p>
            )}
          </div>
          <div className="multi-picker-foot">一個都不勾＝{props.allLabel}</div>
        </div>
      )}
    </div>
  );
}

export type MainToolbarProps = {
  filters: MainFilters;
  quarters: string[];
  quarterLabel: (quarter: string) => string;
  /** [站號, 顯示名稱] */
  intersectionOptions: [string, string][];
  /** [鍵值, 顯示名稱]；不含「全部」，那一項由這裡自己加。 */
  vehicleOptions: [string, string][];
  /** 某一個尖峰選項算不出來時的原因；回傳 null 代表可以選。 */
  peakDisabledReason?: (choice: PeakChoice) => string | null;
  onQuarterFrom: (value: string) => void;
  onQuarterTo: (value: string) => void;
  onIntersections: (value: string[]) => void;
  onPeak: (value: PeakChoice) => void;
  onPeakRule: (value: PeakRule) => void;
  onFlowView: (value: FlowView) => void;
  onDay: (value: DayChoice) => void;
  onVehicle: (value: string) => void;
  onMovement: (value: MovementChoice) => void;
  onDisplay: (value: DisplayChoice) => void;
  /** 目前有幾張圖在用自己的條件。0＝那顆鈕不出現。 */
  detachedCount: number;
  /**
   * 是**哪幾張**（浮動小卡要列的名稱）。
   * ⚠️ 由呼叫端餵進來，不要在這裡從 DOM 猜：這一支的脫離是以**分頁**為單位，
   *   說明掛在 .content 上，往上找只會找到一個沒有 id 的容器。
   */
  detachedItems?: DetachedItem[];
  /** 點小卡裡的名稱時要換到哪一頁。 */
  onGotoDetached?: (id: string) => void;
  onResetAll: () => void;
  /**
   * X-10：把**主工具列自己**的條件全部回到預設（使用者 2026-09-16）。
   *
   * ⚠️ 與 onResetAll 是兩件事：這一顆改主工具列的值，
   *   onResetAll 是把**脫離的圖**拉回來跟隨主工具列。兩顆不可以合併。
   */
  onResetMain: () => void;
};

const PEAK_ORDER: PeakChoice[] = ["AM", "PM", "DAY", "FULL", "AMPM"];
/*
 * ⚠️ **沒有「全部資料別」**（使用者 2026-09-17 裁示）——它與「平日＋假日並列」
 *   行為完全相同，理由寫在 main-filters.ts 的 DayChoice。
 *   型別上仍然有 "all"（舊存檔讀得懂），只是選單不列。
 */
const DAY_ORDER: DayChoice[] = ["weekday", "holiday", "side-by-side"];
const FLOW_ORDER: FlowView[] = ["outbound", "inbound", "both"];
const MOVEMENT_ORDER: MovementChoice[] = ["all", "left", "through", "right"];
const DISPLAY_ORDER: DisplayChoice[] = [
  "count",
  "volume",
  "percent",
  "both",
  "countPercent",
];
const RULE_ORDER: PeakRule[] = ["point", "direction"];

/*
 * ══════════════════════════════════════════════════════════════════════
 *  L-2：「回歸全部」旁邊的浮動小卡——看得到是哪幾張圖正在用自己的條件
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「主工具列跳出全部回歸鈕時，上面會寫目前共 N 項要回歸，你覺得要提供
 *     使用者選擇哪幾個回歸嗎？還是為了主工具列簡化目的，一次性全部回歸
 *     才是最實用的方式？」
 *   → 定案：維持一次性全部回歸，但 N 要**看得到是哪幾張**。
 *   「做成浮動小卡，不占版面很棒，但你提供了點一下清單裡的名稱，畫面會
 *     跳轉過去，那就要記得**浮動小卡也要跟著關掉**」
 *   「我怕展開時候，整個主工具列會被擠的超大」
 *
 * ⚠️ 名稱與落點**不寫死成一張對照表**，而是開的時候從畫面上長出來：
 *   每一張脫離的圖本來就掛著 `[data-detached-chart]` 那條說明，往上找到
 *   它所屬的面板、讀那個面板的標題，就是使用者看到的名字。
 *   寫死對照表的話，改一次標題就要記得改兩個地方——「同一件事寫在兩個
 *   地方就會漂移」是這個專案踩過好幾次的坑。
 *
 * ⚠️ 清單**只看、不勾選**。要單獨回歸某一張，那一張自己旁邊就有
 *   「回到主工具列條件」——比在這裡找一個勾選清單直覺得多。
 */
/*
 * ⚠️ 這一支程式的「脫離」是**以分頁為單位**，不是以面板為單位。
 *
 *   `[data-detached-chart]` 那條說明掛在 .content 的最上面（整頁共用一份），
 *   所以不能像交通服務水準那樣「往上找面板、讀面板標題」——
 *   在這裡往上找只會找到 .content，它沒有 id、也沒有像樣的標題。
 *  （我第一版就是照抄那邊的作法，實測拿到的名稱是頁面中段某個 H2、
 *    落點是空字串，點了什麼都不會動。）
 *
 *   所以名稱與落點由 traffic-app.tsx 直接餵進來：它本來就有分頁清單
 *   （NAV）與換頁函式（setView），那是唯一的真相來源。
 */
export type DetachedItem = { id: string; label: string };

function DetachedPopover(props: {
  count: number;
  items: DetachedItem[];
  onGoto: (id: string) => void;
  onResetAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement | null>(null);
  /*
   * ⚠️ 點外面與按 Esc 都要關掉。監聽器只在開著的時候掛，
   *   收起來就拆掉——否則每開一次就多留一個在文件上。
   */
  useEffect(
    function () {
      if (!open) return;
      const onDocumentClick = function (event: MouseEvent) {
        if (boxRef.current && boxRef.current.contains(event.target as Node)) return;
        setOpen(false);
      };
      const onKey = function (event: KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
      };
      document.addEventListener("click", onDocumentClick);
      document.addEventListener("keydown", onKey);
      return function () {
        document.removeEventListener("click", onDocumentClick);
        document.removeEventListener("keydown", onKey);
      };
    },
    [open],
  );
  return (
    <span className="mt-detached" ref={boxRef}>
      <button
        type="button"
        className="mt-reset-all"
        data-testid="mt-reset-all"
        onClick={function () {
          /* 回歸全部之後清單本身就沒有意義了，順手關掉。 */
          setOpen(false);
          props.onResetAll();
        }}
      >
        回歸全部（{props.count} 張圖正在用自己的條件）
      </button>
      <button
        type="button"
        className="mt-detached-toggle"
        data-testid="mt-detached-toggle"
        aria-expanded={open}
        onClick={function () {
          setOpen(!open);
        }}
      >
        看是哪幾張
        {/* ⚠️ 箭頭只能用 ▼（U+25BC，Big5 A1B9）＋ CSS 轉角度；▸／▾ 不在 Big5。 */}
        <i aria-hidden="true">▼</i>
      </button>
      <div className="mt-detached-pop" data-testid="mt-detached-pop" hidden={!open}>
        <p className="mt-detached-lead">
          這幾張正在用自己的條件。點名稱可以跳過去看；要單獨回歸，用那一張自己的「回到主工具列條件」。
        </p>
        <ul className="mt-detached-list">
          {props.items.map(function (item) {
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="mt-detached-item"
                  data-detached-goto={item.id}
                  onClick={function () {
                    /*
                     * ⚠️ 使用者 2026-09-15：「點一下清單裡的名稱，畫面會跳轉過去，
                     *   那就要記得**浮動小卡也要跟著關掉**」。
                     *   先關再跳：換頁會重畫，順序反過來的話小卡會被重新畫出來。
                     */
                    setOpen(false);
                    props.onGoto(item.id);
                  }}
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </span>
  );
}

export function MainToolbar(props: MainToolbarProps) {
  const {
    filters,
    quarters,
    quarterLabel,
    intersectionOptions,
    vehicleOptions,
    peakDisabledReason,
  } = props;
  /*
   * 主工具列現在是不是**完全等於預設**？（決定「恢復預設條件」要不要出現）
   *
   * ⚠️ 季度的預設值不在 DEFAULT_MAIN_FILTERS 裡（那裡是空字串）：
   *   這一支的預設是**起＝最早一季、迄＝最新一季**，所以拿 quarters 兩端來比。
   * ⚠️ 沒有季度可選時季度那兩格本來就不算數，不可以因此判成「不是預設」——
   *   那會讓空計畫上永遠掛著一顆按了沒事的鈕。
   */
  const quartersAtDefault =
    quarters.length === 0 ||
    (filters.quarterFrom === quarters[0] &&
      filters.quarterTo === quarters[quarters.length - 1]);
  const mainAtDefault =
    quartersAtDefault &&
    filters.intersections.length === 0 &&
    filters.peak === DEFAULT_MAIN_FILTERS.peak &&
    filters.peakRule === DEFAULT_MAIN_FILTERS.peakRule &&
    filters.flowView === DEFAULT_MAIN_FILTERS.flowView &&
    filters.day === DEFAULT_MAIN_FILTERS.day &&
    filters.vehicle === DEFAULT_MAIN_FILTERS.vehicle &&
    filters.movement === DEFAULT_MAIN_FILTERS.movement &&
    filters.display === DEFAULT_MAIN_FILTERS.display;
  /*
   * ── 收合 ──────────────────────────────────────────────────
   *
   * 使用者 2026-09-15：「你當初是說會將主工具列固定在上方隨時可見，
   * 只是會做著展開的按鈕，避免版面佔用過大」。
   *
   * ⚠️ 收起來的時候**不可以什麼都看不到**。條件是全站在用的，
   *   收合之後只留一顆按鈕的話，使用者要確認「現在是依什麼在算」就得先展開，
   *   那比佔版面更糟。所以收合列上永遠寫著目前的條件（describeMain），
   *   而且「回歸全部」也留在收合列上——那一顆的用途正是
   *   「有圖脫離了、而它可能捲在很下面看不到」。
   *
   * ⚠️ X-78（使用者 2026-09-17）：**預設收合**，而且**不記住**。
   *
   *   使用者的原話是「重新載入或第一次開網頁時，主工具列是否能預設為
   *   收合狀態。下方版面比較清楚」——他要的是**每一次開啟**都收合，
   *   所以記住狀態反而做不到他要的事：只要展開過一次，下一次開啟就不是
   *   收合的了。因此這裡不再讀 localStorage，那個鍵也一併清掉
   *  （留著只寫不讀是死碼，下一個人會以為它還有作用）。
   *
   *   舊註解寫「預設收合的話第一次使用的人看不到有哪些條件可以調」——
   *   那個顧慮由收合列上的 describeMain 解決：收起來也永遠寫著目前的條件，
   *   而且那一顆展開鈕就在旁邊。三支同步。
   */
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(function () {
    setReady(true);
  }, []);
  /*
   * ══════════════════════════════════════════════════════════════════
   *  把主工具列的**實際高度**寫進 CSS 變數 --main-toolbar-h
   * ══════════════════════════════════════════════════════════════════
   *
   * 為什麼一定要量、不能寫死：
   *   ・主工具列可以收合（收合約 44px、展開會高很多）
   *   ・視窗窄的時候欄位會換行，高度再往上長
   *   ・「回歸全部（N 張）」那一顆有時候在、有時候不在
   *
   * ⚠️ 2026-09-15 查到的既有缺陷：這一支所有吸頂的東西
   *   （歷季趨勢圖、轉向預覽圖、品質總覽右欄）的 top 都是**主工具列
   *   還沒加進來之前**算的數字，所以捲動時上緣會被工具列切掉——
   *   與使用者先前回報的「圖標題和單位就消失在畫面了」同一個症狀。
   *
   * ⚠️ 量不到（很舊的瀏覽器沒有 ResizeObserver）時**不可以整支壞掉**：
   *   維持 0px，吸頂位置只是略高，不影響任何資料。
   */
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(
    function () {
      const node = barRef.current;
      if (!node) return;
      const write = function () {
        document.documentElement.style.setProperty(
          "--main-toolbar-h",
          `${Math.round(node.getBoundingClientRect().height)}px`,
        );
      };
      write();
      let observer: ResizeObserver | null = null;
      try {
        observer = new ResizeObserver(write);
        observer.observe(node);
      } catch {
        /* 沒有 ResizeObserver 就只靠 resize 事件，總比整支壞掉好。 */
      }
      globalThis.addEventListener("resize", write);
      return function () {
        observer?.disconnect();
        globalThis.removeEventListener("resize", write);
      };
      /*
       * ⚠️ 相依陣列要有 open：收合／展開會換掉 DOM 內容，
       *   ResizeObserver 雖然也會收到，但它是**非同步**的；
       *   這裡同步量一次，讓「剛切換完」那一瞬間的值也是對的。
       */
    },
    [open],
  );
  /* ⚠️ X-78：不再寫 localStorage——每一次開啟都要是收合的（見上面的說明）。 */
  const toggle = function () {
    setOpen(function (previous) {
      return !previous;
    });
  };
  return (
    <div
      /*
       * ⚠️ 這個 ref 是吸頂元素（歷季趨勢圖、轉向預覽圖、品質總覽右欄）
       *   讓開多少的唯一來源，不可以拿掉。
       */
      ref={barRef}
      className={open ? "main-toolbar" : "main-toolbar is-collapsed"}
      data-testid="main-toolbar"
      data-open={ready ? String(open) : "true"}
    >
      <div className="main-toolbar-bar">
        <button
          type="button"
          className="mt-toggle"
          data-testid="mt-toggle"
          aria-expanded={open}
          onClick={toggle}
        >
          {/*
           * ⚠️ 收合箭頭只能用 ▼（U+25BC，Big5 A1B9），靠 CSS 轉 90 度
           *   表示「收合」。**不可以用 ▾（U+25BE）或 ▸（U+25B8）**：
           *   那兩個字不在 Big5 字集裡，而網頁字型是微軟正黑體，
           *   它沒有那兩個字的字形，實機上畫出來是**空白**（不是豆腐框），
           *   看起來像「箭頭根本沒做」。
           *   使用者 2026-09-11 就回報過同一個坑（匯出備份旁邊的箭頭看不到）。
           *   scripts/glyph-guard.mjs 會擋下再用到罕見字的情況。
           */}
          <i aria-hidden="true" className={open ? "" : "is-collapsed"}>
            ▼
          </i>
          主工具列收合
        </button>
        <span className="mt-summary" data-testid="mt-summary">
          {/* ⚠️ 收合起來時這一句是使用者唯一看得到的條件，季度寫法要跟全頁一致
              （民國／西元、季別／調查月份）——所以走 quarterLabel，不可以印原始鍵值。
              ⚠️ 車種同理：main.vehicle 是內部代號（custom:電動機車…），
                 一定要走 vehicleOptions 翻成畫面上的名字。 */}
          {describeMain(filters, quarterLabel, function (id) {
            const hit = props.vehicleOptions.find(function (entry) {
              return entry[0] === id;
            });
            return hit ? hit[1] : id.replace(/^custom:/, "");
          })}
        </span>
        {/*
         * X-10「恢復預設條件」（使用者 2026-09-16）。
         * ⚠️ 條件已是預設值時整顆不出現——按了不會有任何事的按鈕是噪音，
         *   而主工具列要簡潔（使用者原則：「能不要就不要」）。
         * ⚠️ 它**不會**動到脫離中的圖，那是「回歸全部」的事。
         */}
        {!mainAtDefault && (
          <button
            type="button"
            className="mt-reset-main"
            data-testid="mt-reset-main"
            title="把季度、路口、尖峰時段、判定方式、流量視角、資料別、車種、轉向別與顯示數值通通回到預設；不會動到正在用自己條件的圖"
            onClick={props.onResetMain}
          >
            恢復預設條件
          </button>
        )}
        {props.detachedCount > 0 && (
          <DetachedPopover
            count={props.detachedCount}
            items={props.detachedItems ?? []}
            onGoto={props.onGotoDetached ?? function () {}}
            onResetAll={props.onResetAll}
          />
        )}
      </div>
      <div className="main-toolbar-row" hidden={!open}>
        {/*
         * ⚠️ 季度是**起訖區間**，預設起＝迄＝最新一季（＝單季）。
         *   使用者 2026-09-14：「當起和迄是同一時間的話 就等於單季……
         *   因為歷季趨勢圖我可能要找某一期間內的趨勢變化，
         *   不一定是從第一期看到最後一期」。
         */}
        <label className="mt-field">
          <span>季度（起）</span>
          <select
            data-testid="mt-quarter-from"
            value={filters.quarterFrom}
            onChange={(event) => props.onQuarterFrom(event.target.value)}
          >
            {quarters.map((quarter) => (
              <option key={quarter} value={quarter}>
                {quarterLabel(quarter)}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-field">
          <span>季度（迄）</span>
          <select
            data-testid="mt-quarter-to"
            value={filters.quarterTo}
            onChange={(event) => props.onQuarterTo(event.target.value)}
          >
            {quarters.map((quarter) => (
              <option key={quarter} value={quarter}>
                {quarterLabel(quarter)}
              </option>
            ))}
          </select>
        </label>
        {/*
         * ⚠️ 這裡**刻意不放**「區間已拉開…」那句說明。
         *   使用者 2026-09-15（附圖，紅框圈出那一句）：
         *   「這段說明文字因為在不會顯示的圖表，已經會有相同的提示了，
         *     在主工具列就不用這些提示，主工具列主要就是要簡潔」。
         *   真正需要提醒的是**那張圖自己**（「這張圖畫的是區間內的季度」），
         *   那一句仍然掛在各區塊上，不是被拿掉。
         */}
        {/*
          ⚠️ 這一格用 <div> 不用 <label>：裡面是自訂的下拉（按鈕＋面板），
          不是原生控制項，用 <label> 會被 a11y 規則判為「標籤沒有關聯到控制項」，
          而且點標題會意外觸發按鈕。標題改用 .mt-field-label。
        */}
        <div className="mt-field">
          <span className="mt-field-label">路口</span>
          <MultiPicker
            label="路口"
            allLabel="全部路口"
            testId="mt-intersections"
            options={intersectionOptions}
            value={filters.intersections}
            onChange={props.onIntersections}
          />
        </div>

        <label className="mt-field">
          <span>尖峰時段</span>
          <select
            data-testid="mt-peak"
            value={filters.peak}
            onChange={(event) =>
              props.onPeak(event.target.value as PeakChoice)
            }
          >
            {PEAK_ORDER.map((choice) => {
              const reason = peakDisabledReason
                ? peakDisabledReason(choice)
                : null;
              return (
                <option key={choice} value={choice} disabled={Boolean(reason)}>
                  {PEAK_CHOICE_LABELS[choice]}
                  {reason ? `（${reason}）` : ""}
                </option>
              );
            })}
          </select>
        </label>

        {/*
         * ⚠️ 尖峰時段判定方式**會改變數字**，不是排版選項。
         *   「各方向各自認定」算出來的一定 ≥「同一時段」，而且各方向不可以相加。
         *   所以下面那一行說明是跟著選項變的，不是固定文案。
         */}
        <label className="mt-field">
          <span>尖峰時段判定方式</span>
          <select
            data-testid="mt-peak-rule"
            value={filters.peakRule}
            onChange={(event) =>
              props.onPeakRule(event.target.value as PeakRule)
            }
          >
            {RULE_ORDER.map((rule) => (
              <option key={rule} value={rule}>
                {PEAK_RULE_LABELS[rule]}
              </option>
            ))}
          </select>
          <small className="mt-note" data-testid="mt-peak-rule-note">
            {filters.peakRule === "direction"
              ? "各方向的尖峰不在同一小時，各方向的值不可以相加。"
              : "整個調查點取同一時段，各方向可以相加。"}
          </small>
        </label>

        <label className="mt-field">
          <span>路口流量視角</span>
          <select
            data-testid="mt-flow-view"
            value={filters.flowView}
            onChange={(event) =>
              props.onFlowView(event.target.value as FlowView)
            }
          >
            {FLOW_ORDER.map((view) => (
              <option key={view} value={view}>
                {FLOW_VIEW_LABELS[view]}
              </option>
            ))}
          </select>
          <small className="mt-note">
            兩種視角的總計相同、各支線分佈不同。
          </small>
        </label>
        <label className="mt-field">
          <span>資料別</span>
          <select
            data-testid="mt-day"
            value={filters.day}
            onChange={(event) => props.onDay(event.target.value as DayChoice)}
          >
            {DAY_ORDER.map((day) => (
              <option key={day} value={day}>
                {DAY_LABELS[day]}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-field">
          <span>車種</span>
          <select
            data-testid="mt-vehicle"
            value={filters.vehicle}
            onChange={(event) => props.onVehicle(event.target.value)}
          >
            <option value="all">全部車種</option>
            {vehicleOptions.map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-field">
          <span>轉向別</span>
          <select
            data-testid="mt-movement"
            value={filters.movement}
            onChange={(event) =>
              props.onMovement(event.target.value as MovementChoice)
            }
          >
            {MOVEMENT_ORDER.map((movement) => (
              <option key={movement} value={movement}>
                {MOVEMENT_CHOICE_LABELS[movement]}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-field">
          <span>顯示數值</span>
          <select
            data-testid="mt-display"
            value={filters.display}
            onChange={(event) =>
              props.onDisplay(event.target.value as DisplayChoice)
            }
          >
            {DISPLAY_ORDER.map((display) => (
              <option key={display} value={display}>
                {DISPLAY_LABELS[display]}
              </option>
            ))}
          </select>
        </label>

      </div>
    </div>
  );
}

/**
 * 脫離中的圖要掛的那一條說明＋回歸鈕。
 *
 * ⚠️ 一定要寫出**主工具列現在是什麼**。只寫「本圖使用自訂條件」的話，
 *   使用者得自己捲回去對照才知道差在哪。
 */
export function ChartDetachNote(props: {
  chartId: string;
  detached: boolean;
  mainSummary: string;
  onReset: () => void;
}) {
  if (!props.detached) return null;
  return (
    <p
      className="chart-detach-note"
      data-detached-chart={props.chartId}
      data-testid="chart-detach-note"
    >
      <span>目前用本圖自己的條件（主工具列：{props.mainSummary}）</span>
      <button
        type="button"
        className="chart-detach-reset"
        data-testid="chart-detach-reset"
        onClick={props.onReset}
      >
        回到主工具列條件
      </button>
    </p>
  );
}

/**
 * 某一個條件對這張圖不適用時掛的那一句。
 *
 * ⚠️ 「不適用」**不可以只是不做事**——使用者會以為篩選壞掉。
 *   而且只在真的篩了那個條件時才掛（呼叫端用 isFiltered 判斷），
 *   沒篩時講一句沒有人問的話是另一種噪音。
 */
export function InapplicableNote(props: {
  show: boolean;
  text: string;
  /**
   * 這一句**交代了哪幾個條件**。給守門看的（使用者看不到）。
   *
   * ⚠️ 少了它，這一塊在那個條件上仍然會被判成「既沒變也沒說」。
   *   使用者 2026-09-15：「偶爾會出現某張圖有出現提醒文字，卻對某一個
   *   篩選條件卻沒出現不受影響的提醒文字」——只驗「有沒有說明」會假綠。
   */
  fields?: string[];
}) {
  if (!props.show) return null;
  return (
    <p
      className="chart-inapplicable"
      data-testid="chart-inapplicable"
      data-inapplicable={props.fields?.join(" ") || undefined}
    >
      {props.text}
    </p>
  );
}
