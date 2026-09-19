/*
 * ══════════════════════════════════════════════════════════════════
 *  尖峰形狀的兩張圖（放在「轉向進階分析」，預設收合）
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者的定調：
 *   ・這兩張「優先度低，就放最底下」「平常用不上就收合」
 *   ・「不適用的調查檔，展開欄位時會看到不適用的說明文字」
 *   ・「圖上面不用放文字……反正目前有文字解說了」
 *   ・說明文字要「複製」鍵，而且鍵要放在**展開後**的地方
 *
 * 兩張圖問的**不是同一件事**，不要合併：
 *   (1) 四格 15 分鐘柱狀圖：**選定的那一小時裡面**，車流平均還是集中？
 *   (2) 連續 60 分鐘折線圖：**一整天裡**，尖峰是尖銳的峰還是平坦的高原？
 *
 * ⚠️ (2) 的橫軸一定是**時間**，不是名次。
 *    依名次排會畫出一條由高到低的斜線，看不出一天的形狀，而且那又變成
 *    一張排行榜——使用者已明確表示路口／時段的排名沒有意義。
 *
 * ⚠️ 兩張都**不自己算交通量**，只讀 sourceTrace.intervals（匯入時就算好、
 *    已被既有測試釘住的值）。新圖不得產生新的算法。
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  peakQuarterHours,
  peakWindowSeries,
} from "../lib/final-features.ts";
import { formatMinutes, type TrafficRecord } from "../lib/traffic.ts";

type Scope = "AM" | "PM" | "DAY" | "FULL";

/** 每一格只允許 1／1.5／2／2.5／3／4／5／6／8／10 的 10 的次方倍（與主程式同一套規則）。 */
const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceMax(hi: number, count: number) {
  const top = hi > 0 ? hi : 1;
  const rough = top / Math.max(1, count);
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const pick = NICE.find((v) => rough / power <= v + 1e-9) ?? 10;
  const gap = pick * power;
  return { max: Number((gap * count).toFixed(4)), gap };
}

function CopyNote(props: { title: string; lines: string[]; notify: (v: string) => void }) {
  return (
    <div className="peak-shape-note">
      {props.lines.map(function (line, index) {
        return <p key={index}>{line}</p>;
      })}
      {/*
        「複製說明文字」鍵放在**展開後**的說明底部——使用者指定的位置：
        「複製文字的功能鍵要放在文字展開後的地方，收合的話功能鍵就一起被收起來」。
      */}
      <div className="peak-shape-copy">
        <button
          type="button"
          className="ghost"
          onClick={function () {
            const text = props.title + "\n\n" + props.lines.join("\n");
            navigator.clipboard
              ?.writeText(text)
              .then(function () {
                props.notify("說明文字已複製，可直接貼進報告。");
              })
              .catch(function () {
                props.notify("瀏覽器不允許複製，請手動選取文字。");
              });
          }}
        >
          {/*
            ⚠️ 這裡**不要放圖示字元**。原本是「⧉」(U+29C9)，那個字不在 Big5，
              微軟正黑體畫不出來，在某些電腦上會變成空白。
              2026-09-15 修字形時我把它換成了字面的「（重複）」——那更糟，
              畫面上真的印出「（重複） 複製說明文字」，使用者會以為按了會重複貼上。
              按鈕上的四個字本身就說得夠清楚，不需要圖示。
          */}
          複製說明文字
        </button>
      </div>
    </div>
  );
}

/** 不適用時顯示的說明——**寫出為什麼**，不要只說「無資料」。 */
const REASON_TEXT: Record<string, string> = {
  "no-intervals":
    "這一筆是舊版匯入的資料，沒有保留逐格的原始調查值，所以畫不出這張圖。重新匯入原始 Excel 之後就會有。",
  "no-window":
    "這個統計範圍沒有算得出來的尖峰小時（調查涵蓋湊不出一個完整小時，或原始檔的時間格距組不成整小時），所以沒有「那一小時」可以拆開來看。",
  "no-cells":
    "尖峰視窗內找不到對應的逐格資料，可能是原始檔的時間欄位與尖峰視窗對不起來。",
  "not-quarter":
    "這一份調查檔並不是以 15 分鐘為一格（例如整點一格），所以拆不出四格。這張圖只適用 15 分鐘一格的調查檔。",
};

export function PeakShapeCharts(props: {
  record: TrafficRecord;
  scope: Scope;
  scopeLabel: string;
  notify: (value: string) => void;
  /*
   * ══════════════════════════════════════════════════════════════
   *  X-83：這兩張圖到底畫的是誰
   * ══════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-17：「在點選多個調查點位時，仍只有一張圖，
   *   這是加總的圖還是整體綜合平均圖嗎?」
   *
   * ⚠️ 查證結果：**兩者都不是**。這兩張圖畫的是 props.record 那**一筆**——
   *   也就是一季 × 一個路口 × 一種資料別（current 先濾掉別季，
   *   selected 再挑一個路口與一種資料別）。整頁本來就是這個設計。
   *   真正的缺陷是：圖上**沒有寫是哪一個路口、哪一季**，主工具列選了
   *   三個路口時使用者無從判斷它在畫誰——看起來就像「三個路口只給一張圖」。
   *
   * ⚠️ 使用者 2026-09-18 指定：標題寫**季別＋路名**，不要站號；
   *   而且「如果使用者選擇了多點位，那就出現文字說明做提醒」。
   *   所以下面兩個 prop：一個是標題要顯示的字，一個是「目前選了幾個」。
   */
  /** 標題要顯示的季別（已格式化，例如「115Q3」或「115年第3季」）。 */
  quarterLabel: string;
  /** 主工具列目前選到幾個路口（用來決定要不要出現提醒）。 */
  selectedIntersectionCount: number;
  /** 主工具列目前的季度區間涵蓋幾季（同上）。 */
  selectedQuarterCount: number;
  /*
   * ⚠️ 這兩個是「下載高解析圖片」用的，**一定要由主程式傳進來**。
   *
   * chartStyle：圖表樣式一定要**內嵌在 SVG 裡**。匯出是把 SVG 序列化成
   *   獨立文件再畫進 canvas，那份文件讀不到 globals.css——字級會從 9～10px
   *   跳成瀏覽器預設的 16px、text-anchor 從 end 退回 start，縱軸刻度整片
   *   壓進繪圖區。畫面上完全正常，只有下載下來那一張壞掉（v2.1.30 踩過）。
   * exportPng：共用同一支匯出程式（白底、3 倍解析度、檔名洗過），
   *   在這裡另寫一份的話，三支程式的圖檔遲早長得不一樣。
   */
  chartStyle: string;
  exportPng: (svgId: string, fileName: string) => void;
  /*
   * 側欄點名到哪一塊（見 NAV 的 sections）。
   *
   * 使用者 2026-09-12：「左側欄位『轉向進階分析』分頁，少了尖峰小時4格15分鐘
   *   分布、連續60分鐘流率分析圖的分頁，雖然這兩張圖平常是收合，但使用者點
   *   左側分頁時，也應該要展開並顯眼提示，這樣才會被注意到有這張圖存在，
   *   是否使用則看使用者。」
   *
   * ⚠️ 收著的東西，使用者不會知道它存在。側欄列出來只是第一步，點下去
   *   如果只捲過來、沒有展開，看到的仍然是一行收合的標題——那和沒列一樣。
   */
  focusedBlock?: string;
  /*
   * ══════════════════════════════════════════════════════════════
   *  X-50：這兩張圖「跟不跟主工具列走」的說明（由主程式傳進來）
   * ══════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-16：
   *   「完全不跟的 可以直接寫不受主工具列影響；
   *     部分不跟的，就在使用者使用了特定的篩選條件時，再跳出文字就好。
   *     如果常駐說明文字會變得平常一張圖多了好多文字占版面」
   *
   * 所以兩張圖的待遇**不一樣**，因為它們本來就不一樣：
   *   ・四格 15 分鐘分布 → **只跟「尖峰時段」走**（peakQuarterHours 吃 scope），
   *     屬「部分不跟」→ 條件式，篩到了才說話。
   *   ・連續 60 分鐘流率 → peakWindowSeries(record) **一個條件都不吃**，
   *     屬「完全不跟」→ 常駐一句。
   *
   * ⚠️ 判斷的依據是這兩支函式實際吃什麼參數，不是「它們長得像」。
   *   一起掛同一句的話，四格那張會變成謊報（它真的會跟著時段變）。
   */
  quarterNote?: ReactNode;
  windowNote?: ReactNode;
}) {
  const [openQuarter, setOpenQuarter] = useState(false);
  const [openWindow, setOpenWindow] = useState(false);
  /*
   * 展開與否有兩個來源：使用者自己點 <summary>，以及側欄點名。
   * 側欄點名時強制展開（而不是只捲過去），理由見上面的註解。
   *
   * ⚠️ 用「或」而不是把 focusedBlock 寫進 state：寫進 state 的話，
   *   使用者點了側欄、再自己收起來，focusedBlock 仍然指著這一塊，
   *   下一次 render 又會把它彈開，變成收不起來。
   */
  const quarterFocused = props.focusedBlock === "advanced-peak-quarter";
  const windowFocused = props.focusedBlock === "advanced-peak-window";
  const [quarterDismissed, setQuarterDismissed] = useState(false);
  const [windowDismissed, setWindowDismissed] = useState(false);
  /* 換了點名對象就把「使用者手動收起來過」忘掉，下次點側欄才會再展開。 */
  useEffect(
    function () {
      if (quarterFocused) setQuarterDismissed(false);
      if (windowFocused) setWindowDismissed(false);
    },
    [quarterFocused, windowFocused],
  );
  const quarterOpen = openQuarter || (quarterFocused && !quarterDismissed);
  const windowOpen = openWindow || (windowFocused && !windowDismissed);
  const quarterResult = peakQuarterHours(props.record, props.scope);
  const windows = peakWindowSeries(props.record);

  /* ── (1) 四格 15 分鐘柱狀圖 ───────────────────────────────── */
  const cells = quarterResult.cells;
  const qTop = niceMax(Math.max(...cells.map((c) => c.pcu), 1), 4);
  const qWidth = 1000, qHeight = 330, qLeft = 78, qRight = 24, qTopPad = 20, qBottom = 52;
  const qPlot = qWidth - qLeft - qRight;
  const qPlotH = qHeight - qTopPad - qBottom;
  const barW = Math.min(90, (qPlot / Math.max(1, cells.length)) * 0.55);
  const share = cells.length
    ? cells.map((c) => (c.pcu / cells.reduce((s, x) => s + x.pcu, 0)) * 100)
    : [];
  const maxShare = share.length ? Math.max(...share) : 0;
  const minShare = share.length ? Math.min(...share) : 0;

  /* ── (2) 連續 60 分鐘折線圖 ──────────────────────────────── */
  const wTop = niceMax(Math.max(...windows.map((w) => w.pcu), 1), 4);
  /*
   * ⚠️ wRight 從 24 加大到 48。
   * 最後一個 X 軸標籤畫在繪圖區的右端，文字置中就會有一半跑到繪圖區外面；
   * 使用者實測看到最後一個標籤被切成「18:」。加大右邊留白，
   * 再配合「第一個靠左對齊、最後一個靠右對齊」（見下方 anchorOf），
   * 標籤才不可能超出 viewBox。
   */
  const wWidth = 1000, wHeight = 330, wLeft = 78, wRight = 48, wTopPad = 20, wBottom = 52;
  const wPlot = wWidth - wLeft - wRight;
  const wPlotH = wHeight - wTopPad - wBottom;
  const best = windows.length
    ? windows.reduce((a, b) => (b.pcu > a.pcu ? b : a))
    : null;
  const second = windows.length > 1
    ? [...windows].sort((a, b) => b.pcu - a.pcu)[1]
    : null;
  const gapPercent =
    best && second && best.pcu ? ((best.pcu - second.pcu) / best.pcu) * 100 : null;

  /*
   * ★ 折線一定要在「這一段沒有調查資料」的地方斷開。
   *
   * 使用者實測（只做上午 07–08、下午 17–18 兩段的調查檔）畫出來的是
   * **一條從上午直直拉到下午的斜線**——那條線宣稱中午有交通量，
   * 而中午根本沒有調查。這與歷季趨勢圖「缺季要斷線、不可以連過去」
   * 是同一條原則：連過去等於宣稱中間有一個介於兩端之間的值。
   *
   * 判準：相鄰兩個視窗的起始時間差超過「常見間距的兩倍」就算斷開。
   * 常見間距取眾數（多數調查是 15 或 60 分鐘一格），不寫死，
   * 因為兩種格距的檔案都存在。
   */
  const stepCounts = new Map<number, number>();
  for (let i = 1; i < windows.length; i += 1) {
    const gap = windows[i].start - windows[i - 1].start;
    stepCounts.set(gap, (stepCounts.get(gap) ?? 0) + 1);
  }
  const commonStep =
    [...stepCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 15;
  const segments: (typeof windows)[] = [];
  for (const w of windows) {
    const last = segments[segments.length - 1];
    const prev = last?.[last.length - 1];
    if (!prev || w.start - prev.start > commonStep * 2) segments.push([w]);
    else last.push(w);
  }
  /** 資料是分成好幾段的（中間有沒調查的時段）嗎？ */
  const hasGap = segments.length > 1;

  /*
   * X-83：這兩張圖畫的是**一季 × 一個路口**。
   * 標題直接寫出來，主工具列選了不只一個時再補一句提醒。
   * ⚠️ 標題只寫路名，不寫站號（使用者 2026-09-18 指定）——站號會換
   *   （T1-01 → T5-01），而且對讀圖的人沒有意義。
   */
  const figureTitle = `${props.quarterLabel}・${props.record.name}`;
  const multiSelected =
    props.selectedIntersectionCount > 1 || props.selectedQuarterCount > 1;
  /*
   * ⚠️ 這一句**不可以**寫「這兩張圖」。三支共用的用詞守門（wording-three）
   *   擋掉用張數或位置代稱區塊：張數會隨篩選變，而且讀的人不知道是哪兩張。
   *   所以由呼叫端把自己那一塊的名字傳進來。
   */
  const scopeReminder = (blockName: string) =>
    multiSelected ? (
      <p className="peak-shape-scope" data-testid="peak-shape-scope">
        「{blockName}」<b>一次只看一季、一個路口</b>：目前畫的是「{figureTitle}」。
        主工具列目前選了 {props.selectedQuarterCount} 季、
        {props.selectedIntersectionCount} 個路口，其餘的沒有畫在這裡——
        要看別的，請用上方的「路口」下拉切換。
      </p>
    ) : null;

  return (
    <>
      <details
        className={
          "panel peak-shape" + (quarterFocused ? " is-focused" : "")
        }
        id="advanced-peak-quarter"
        open={quarterOpen}
        onToggle={function (event) {
          const next = (event.target as HTMLDetailsElement).open;
          setOpenQuarter(next);
          if (!next && quarterFocused) setQuarterDismissed(true);
        }}
      >
        <summary>
          尖峰小時內四格 15 分鐘分布
          <small>{"\u3000"}平常用不到就收著；要看「這一小時裡車流集不集中」再展開</small>
        </summary>
        {/* ⚠️ 說明放在 .panel-body **外面**：那一塊的版面靠「底下剛好兩個
            直接子元素」（圖 + 講解）撐起來，多塞一個進去會把講解擠掉。 */}
        {props.quarterNote}
        {scopeReminder("尖峰小時內四格 15 分鐘分布")}
        <div className="panel-body">
          {quarterResult.reason !== "ok" ? (
            <p className="peak-shape-empty">
              {REASON_TEXT[quarterResult.reason] || "這張圖目前不適用。"}
            </p>
          ) : (
            <>
              {/*
                ⚠️ 圖與下載鍵包成一塊（.peak-shape-figure），說明是它的**兄弟**。
                  圖在左、說明在右、圖 sticky 的版面（globals.css 的
                  .peak-shape .panel-body）靠的就是「底下剛好兩個直接子元素」；
                  把說明包進來會讓它跟著圖一起釘住，等於整塊黏在畫面上。
              */}
              <div className="peak-shape-figure">
              {/* X-83：圖上要寫出這是哪一季、哪一個路口。 */}
              <p className="peak-shape-title" data-testid="peak-quarter-title">
                {figureTitle}
              </p>
              <svg
                id="peak-quarter-svg"
                viewBox={`0 0 ${qWidth} ${qHeight}`}
                width="100%"
                role="img"
                aria-label={`${props.scopeLabel}尖峰小時內四格 15 分鐘交通量`}
              >
                <style>{props.chartStyle}</style>
                <g className="grid-lines">
                  {[0, 1, 2, 3, 4].map(function (i) {
                    const value = (qTop.max / 4) * (4 - i);
                    const y = qTopPad + (qPlotH / 4) * i;
                    return (
                      <g key={i}>
                        <line x1={qLeft} y1={y} x2={qWidth - qRight} y2={y} />
                        {/* 縱軸數值靠右對齊，否則會往右伸進繪圖區壓到柱子 */}
                        <text x={qLeft - 8} y={y + 3} textAnchor="end">
                          {value.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}
                        </text>
                      </g>
                    );
                  })}
                </g>
                <text
                  className="y-axis-title"
                  transform={`translate(14 ${qTopPad + qPlotH / 2}) rotate(-90)`}
                  textAnchor="middle"
                >
                  交通量（PCU）
                </text>
                {cells.map(function (cell, index) {
                  const h = (cell.pcu / qTop.max) * qPlotH;
                  const x =
                    qLeft + (qPlot / cells.length) * (index + 0.5) - barW / 2;
                  return (
                    <g key={cell.start}>
                      <rect
                        x={x}
                        y={qTopPad + qPlotH - h}
                        width={barW}
                        height={Math.max(1, h)}
                        rx="4"
                        fill="#1f7f7e"
                      />
                      {/*
                        ⚠️ +24 不是隨手挑的：+18 時最左邊那個時間標籤會和縱軸
                          最下面那一格刻度（「0」）在畫面上重疊
                         （2026-09-15 由 e2e-sidebyside-labels 量到）。
                          兩個都在座標軸交會的那個角落，字級一放大就會疊。
                      */}
                      <text
                        className="x-label"
                        x={x + barW / 2}
                        y={qHeight - qBottom + 24}
                        textAnchor="middle"
                      >
                        {formatMinutes(cell.start)}
                      </text>
                    </g>
                  );
                })}
                <text className="axis-title" x={qWidth / 2} y={qHeight - 8} textAnchor="middle">
                  15 分鐘起始時間
                </text>
              </svg>
              {/*
                * ⚠️ 這個外框以前也叫 .peak-shape-copy，和「複製說明文字」那個
                *   同名——**它們是兩件不同的事**（這一個是下載 PNG）。
                *   2026-09-12 實測踩到：e2e-removed-surfaces 用
                *   `.peak-shape-copy button` 數「複製說明文字」的顆數，
                *   結果連下載鍵一起數進去（量到 4 顆、圖只有 2 張）；
                *   「收合時複製鍵不可以露出來」那一條抓到的第一顆其實也是
                *   下載鍵——**兩條守門量的都不是它們宣稱在量的東西**。
                *   樣式相同（靠右），所以 CSS 兩個類別並列。
                */}
              <div className="peak-shape-download">
                <button
                  type="button"
                  className="ghost chart-png-button"
                  data-chart-png="peak-quarter"
                  title="以 3 倍解析度重新繪製後下載；圖上只有圖，不含說明文字"
                  onClick={function () {
                    props.exportPng(
                      "peak-quarter-svg",
                      `${props.record.station}_${props.scopeLabel}_尖峰小時內四格15分鐘分布.png`,
                    );
                  }}
                >
                  下載高解析圖片（PNG）
                  <small>只有圖，不含說明文字</small>
                </button>
              </div>
              </div>
              <CopyNote
                notify={props.notify}
                title={`${props.scopeLabel}尖峰小時內四格 15 分鐘分布`}
                lines={[
                  `這張圖在回答一個問題：${props.scopeLabel}那一小時裡面，車是平均來的，還是全擠在其中十五分鐘？`,
                  "怎麼看：四根柱子就是那一小時的四個 15 分鐘。四根一樣高＝車流平均；有一根特別高＝那一刻才是真正最塞的時候。四根加起來就是那一小時的總量。",
                  `這一份資料：最高的一段佔 ${maxShare.toFixed(1)}%、最低的一段佔 ${minShare.toFixed(1)}%（如果完全平均，每段應該是 25%）。`,
                  maxShare - minShare < 5
                    ? "四段差不到 5 個百分點，算是相當平均。用「整小時的平均量」來描述這個路口不會失真。"
                    : "四段差距明顯，車集中在其中一段。這代表用「整小時的平均量」會低估最塞那 15 分鐘的實際狀況——需要談壅塞或號誌時制時，要拿最高的那一段來看。",
                  "要注意：這張圖只適用「15 分鐘記一次」的調查檔。整點記一次的檔拆不出四段，會直接寫出原因而不畫圖。另外柱子的高度是 PCU（把各種車換算成小客車之後的量），不是實際車輛數。",
                ]}
              />
            </>
          )}
        </div>
      </details>

      <details
        className={"panel peak-shape" + (windowFocused ? " is-focused" : "")}
        id="advanced-peak-window"
        open={windowOpen}
        onToggle={function (event) {
          const next = (event.target as HTMLDetailsElement).open;
          setOpenWindow(next);
          if (!next && windowFocused) setWindowDismissed(true);
        }}
      >
        <summary>
          連續 60 分鐘流率（依時間）
          <small>{"\u3000"}用來判斷「尖峰小時挑得準不準」；平常收著</small>
        </summary>
        {/* ⚠️ 同上：說明是 .panel-body 的兄弟，不可以放進去。 */}
        {props.windowNote}
        {scopeReminder("連續 60 分鐘流率（依時間）")}
        <div className="panel-body">
          {!windows.length ? (
            <p className="peak-shape-empty">
              {REASON_TEXT["no-intervals"]}
            </p>
          ) : (
            <>
              {/* ⚠️ 同上：圖與下載鍵一塊、說明是兄弟。見上一張圖的說明。 */}
              <div className="peak-shape-figure">
              {/* X-83：同上，圖上要寫出這是哪一季、哪一個路口。 */}
              <p className="peak-shape-title" data-testid="peak-window-title">
                {figureTitle}
              </p>
              <svg
                id="peak-window-svg"
                viewBox={`0 0 ${wWidth} ${wHeight}`}
                width="100%"
                role="img"
                aria-label="一整天每一個連續 60 分鐘視窗的交通量"
              >
                <style>{props.chartStyle}</style>
                <g className="grid-lines">
                  {[0, 1, 2, 3, 4].map(function (i) {
                    const value = (wTop.max / 4) * (4 - i);
                    const y = wTopPad + (wPlotH / 4) * i;
                    return (
                      <g key={i}>
                        <line x1={wLeft} y1={y} x2={wWidth - wRight} y2={y} />
                        {/*
                          ⚠️ 縱軸數值一定要 textAnchor="end"。
                          SVG <text> 的預設是 start，於是「6,000」是從 x=wLeft-8
                          **往右**排，整串數字壓進繪圖區、蓋到折線與橘色的尖峰圈——
                          使用者實測回報的「XY 軸與圖上標記有重疊」就是這個。
                        */}
                        <text x={wLeft - 8} y={y + 3} textAnchor="end">
                          {value.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}
                        </text>
                      </g>
                    );
                  })}
                </g>
                <text
                  className="y-axis-title"
                  transform={`translate(14 ${wTopPad + wPlotH / 2}) rotate(-90)`}
                  textAnchor="middle"
                >
                  交通量（PCU/hr）
                </text>
                {(() => {
                  const first = windows[0].start;
                  const last = windows[windows.length - 1].start;
                  const span = Math.max(1, last - first);
                  const px = (m: number) => wLeft + ((m - first) / span) * wPlot;
                  const py = (v: number) =>
                    wTopPad + wPlotH - (v / wTop.max) * wPlotH;
                  /*
                   * ★ 逐段畫，段與段之間不連線。
                   * 一段只有一個點時畫不出線，補一個小圓點，
                   * 否則那一段的資料在圖上完全看不見。
                   */
                  const paths = segments.map((seg) =>
                    seg
                      .map((w, i) => `${i ? "L" : "M"}${px(w.start).toFixed(1)} ${py(w.pcu).toFixed(1)}`)
                      .join(" "),
                  );
                  /*
                   * X 軸標籤。
                   * ⚠️ 只印整點還不夠——實測 24 個整點在 1000 寬的圖上仍然
                   * 疊成「00:01:02:03…」一整片。依可用寬度算得下幾個，
                   * 再等間隔抽樣；第一個與最後一個一定保留，才看得出範圍。
                   *
                   * ⚠️ 候選只取整點時，遇到「只做 07:15–08:15 這種非整點時段」
                   * 的調查檔會一個標籤都印不出來。所以整點候選不足 2 個時，
                   * 退回用全部視窗當候選——寧可標籤不是整點，也不能沒有橫軸。
                   */
                  const hourly = windows.filter((w) => w.start % 60 === 0);
                  const source = hourly.length >= 2 ? hourly : windows;
                  const fits = Math.max(2, Math.floor(wPlot / 52));
                  const stride = Math.max(1, Math.ceil(source.length / fits));
                  /*
                   * ⚠️ 「最後一個一定印」不能無條件——實測印出「22:0023:0」，
                   * 倒數第二個與最後一個只差一格就疊在一起。
                   * 與主程式 showXLabel() 同一套規則：門檻取整個 stride，
                   * 不是一半。
                   */
                  const ticks = source.filter(function (w, i) {
                    if (i === source.length - 1) return true;
                    if (i % stride !== 0) return false;
                    return stride === 1 || source.length - 1 - i >= stride;
                  });
                  /*
                   * ⚠️ 第一個與最後一個標籤要靠內對齊，不可以置中。
                   * 置中時有一半的字會落在繪圖區外面，實測被容器切成「18:」。
                   */
                  const anchorOf = (m: number) =>
                    m === first ? "start" : m === last ? "end" : "middle";
                  return (
                    <>
                      {paths.map((d, i) => (
                        <path key={i} d={d} fill="none" stroke="#1f7f7e" strokeWidth="2" />
                      ))}
                      {segments
                        .filter((seg) => seg.length === 1)
                        .map((seg) => (
                          <circle
                            key={"dot-" + seg[0].start}
                            cx={px(seg[0].start)}
                            cy={py(seg[0].pcu)}
                            r="3"
                            fill="#1f7f7e"
                          />
                        ))}
                      {best && (
                        <circle
                          cx={px(best.start)}
                          cy={py(best.pcu)}
                          r="6"
                          fill="#fff"
                          stroke="#c4611c"
                          strokeWidth="3"
                        />
                      )}
                      {ticks.map(function (w) {
                        return (
                          /* ⚠️ +24：理由同上一張圖（+18 會和縱軸的「0」疊）。 */
                          <text
                            key={w.start}
                            className="x-label"
                            x={px(w.start)}
                            y={wHeight - wBottom + 24}
                            textAnchor={anchorOf(w.start)}
                          >
                            {formatMinutes(w.start)}
                          </text>
                        );
                      })}
                    </>
                  );
                })()}
                <text className="axis-title" x={wWidth / 2} y={wHeight - 8} textAnchor="middle">
                  60 分鐘視窗的起始時間
                </text>
              </svg>
              {/*
                * ⚠️ 這個外框以前也叫 .peak-shape-copy，和「複製說明文字」那個
                *   同名——**它們是兩件不同的事**（這一個是下載 PNG）。
                *   2026-09-12 實測踩到：e2e-removed-surfaces 用
                *   `.peak-shape-copy button` 數「複製說明文字」的顆數，
                *   結果連下載鍵一起數進去（量到 4 顆、圖只有 2 張）；
                *   「收合時複製鍵不可以露出來」那一條抓到的第一顆其實也是
                *   下載鍵——**兩條守門量的都不是它們宣稱在量的東西**。
                *   樣式相同（靠右），所以 CSS 兩個類別並列。
                */}
              <div className="peak-shape-download">
                <button
                  type="button"
                  className="ghost chart-png-button"
                  data-chart-png="peak-window"
                  title="以 3 倍解析度重新繪製後下載；圖上只有圖，不含說明文字"
                  onClick={function () {
                    props.exportPng(
                      "peak-window-svg",
                      `${props.record.station}_連續60分鐘流率.png`,
                    );
                  }}
                >
                  下載高解析圖片（PNG）
                  <small>只有圖，不含說明文字</small>
                </button>
              </div>
              </div>
              <CopyNote
                notify={props.notify}
                title="連續 60 分鐘流率（依時間）"
                lines={[
                  "這張圖在回答一個問題：系統挑出來的那一個「最忙的一小時」，是真的特別忙，還是前後一小時其實差不多？",
                  "怎麼算出來的：從調查的第一格開始，每往後移一格就重算一次「這一小時總共多少車」。例如 07:00–08:00 算一次、07:15–08:15 再算一次……把每一次的結果依時間畫成這條線。橘色圈起來的那一點就是全部裡面最高的，也就是系統採用的尖峰小時。",
                  "所以：線很尖 → 那一小時確實特別忙；線很平 → 附近幾個小時都差不多忙，挑哪一個當尖峰其實差別不大。",
                  best
                    ? `這一份資料：最忙的是 ${formatMinutes(best.start)}–${formatMinutes(best.end)}，${best.pcu.toLocaleString()} PCU/hr。`
                    : "",
                  gapPercent === null
                    ? "可以比較的時段不夠多，看不出尖峰明不明顯。"
                    : gapPercent < 3
                      ? `第一名只比第二名多 ${gapPercent.toFixed(1)}%，兩者幾乎一樣——這一段時間是「一路都很忙」，不是某一小時特別忙。報告裡寫尖峰小時時，建議順帶說明一句，免得讀的人以為只有那一小時塞。`
                      : `第一名比第二名多 ${gapPercent.toFixed(1)}%，差距明顯——那一小時確實是這一天最忙的時候，尖峰小時挑得很穩，換個起點也不會變。`,
                  hasGap
                    ? `這一份調查分成 ${segments.length} 個時段（${segments
                        .map((seg) => `${formatMinutes(seg[0].start)}–${formatMinutes(seg[seg.length - 1].end)}`)
                        .join("、")}），中間沒有調查資料，所以折線在那裡斷開。斷開的地方不是「交通量是 0」，是「那一段沒有量」。`
                    : "",
                  "要注意：只有「資料完整湊得滿一小時」的時段才會畫上去。中間少一格的就整段跳過，不會拿 45 分鐘的量當成一小時（那會低估）。所以線斷掉的地方，意思是「那裡湊不出完整的一小時」，不是「那裡沒有車」。",
                ].filter(Boolean)}
              />
            </>
          )}
        </div>
      </details>
    </>
  );
}
