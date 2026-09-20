/*
 * ══════════════════════════════════════════════════════════════════════
 *  圖旁說明的第 3 級「代表什麼狀況」與第 4 級「要怎麼處理」
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ **這個檔案在三支程式裡逐位元相同。** 改了其中一份就要三份一起改，
 *   否則同一個數字在三支會被說成不同的狀況——那比沒有這一層更糟，
 *   因為使用者會把三種說法都抄進同一份報告。
 *   （與 `period-date`、`direction-pair` 同一種做法。）
 *
 * 使用者 2026-09-20 指定：
 *   「三支共通：圖旁說明文字升到第 3 級（代表什麼狀況）、第 4 級（要怎麼處理）」
 *   「第 4 級只在寫得出『要判斷 X，還需要什麼資料』時才寫——是真的寫不出
 *     具體的時候，才整段不寫，不要盲猜，而如果真的是『建議持續觀察』這種
 *     處理方式，自然就使用這種，但因為程式是罐頭用句，你可以判定一下有
 *     什麼情況可以怎麼寫，不用強制必須是『要判斷…還需要…』的句型。」
 *   「正常來說每張圖應該至少都可以寫到第 3 級（圖代表的意義是什麼狀況），對嗎?」→ 對。
 *
 * ── 四級的分工（不可以互相吃掉）──────────────────────────────
 *
 *   第 1 級「這張圖在說什麼」：這是什麼圖、軸是什麼、回答哪一個問題。
 *   第 2 級「重點變化／數字」：圖上讀得出來的**事實**。
 *   第 3 級「代表什麼狀況」  ：這個數字在工程上落在哪一個區間、意思是什麼。
 *   第 4 級「要怎麼處理」    ：接下來該做什麼、或還缺什麼資料才能下判斷。
 *
 * ── ⚠️ 三條鐵律 ─────────────────────────────────────────────
 *
 *  一、**第 3 級講狀況，不講原因。** 「尖峰集中」是狀況；
 *      「因為附近學校上下學」是猜的——系統手上沒有那份資料。
 *
 *  二、**第 4 級寫不出具體的就整段不寫。** 使用者明講「不要盲猜」。
 *      所以這裡的每一支都回 `action?: string`，回 undefined 就是不寫，
 *      呼叫端看到空的要**整段拿掉**，不可以留一個空標題。
 *
 *  三、**不冒充規範。** 這一層寫的是本系統的判讀區間，不是任何一本手冊的
 *      規定；所以句子裡不出現「依規定」「標準為」這類字眼。
 *      （使用者 2026-09-20 已取消「引用公路容量手冊三種標示」那一項，
 *        更不可以反過來在這裡暗示有手冊依據。）
 */

/** 一張圖的第 3、4 級。`action` 沒有值＝第 4 級整段不寫。 */
export type ChartLevels = {
  /** 第 3 級：代表什麼狀況。**一定要有**——寫不出來就不要呼叫這一支。 */
  state: string;
  /** 第 4 級：要怎麼處理。寫不出具體的就不要給。 */
  action?: string;
};

export const LEVEL3_TITLE = "代表什麼狀況";
export const LEVEL4_TITLE = "要怎麼處理";

/**
 * 把第 3、4 級收成「標題 → 句子」的兩段（或一段）。
 *
 * ⚠️ 第 4 級沒有內容時**整段不回**，不要回一個 lines 是空陣列的段落：
 *   空段落在畫面上是一個只有標題的區塊，看起來像壞掉。
 */
export function levelSections(levels: ChartLevels | null | undefined): Array<{
  title: string;
  lines: string[];
}> {
  if (!levels || !levels.state) return [];
  const out = [{ title: LEVEL3_TITLE, lines: [levels.state] }];
  if (levels.action) out.push({ title: LEVEL4_TITLE, lines: [levels.action] });
  return out;
}

/* ── 大車比例 ────────────────────────────────────────────────── */

/**
 * 大車（非機車、非小型車）占全部車輛的比例。
 *
 * ⚠️ 區間是**本系統的判讀級距**，用意是讓使用者知道這個數字算高還算低，
 *   不是任何規範的門檻。第 4 級只在「高到需要另外查證」時才給，
 *   比例低的時候沒有什麼具體的事要做——那時就不寫。
 */
export function heavyShareLevels(sharePercent: number): ChartLevels | null {
  if (!Number.isFinite(sharePercent) || sharePercent < 0) return null;
  if (sharePercent >= 20)
    return {
      state:
        `大車比例 ${sharePercent.toFixed(1)}%，在一般市區道路屬於偏高的一端；` +
        `這類路段的鋪面損壞、轉彎半徑與視線死角通常是要單獨處理的項目。`,
      action:
        `要判斷這個比例是不是常態，還需要：(1) 鄰近季別的同一路段資料（看是不是只有這一季這麼高）、` +
        `(2) 大車的來源（例如工程車、客運班次表），這兩項本系統都沒有。` +
        `在拿到之前，建議把這一段的大車比例單獨列出來持續觀察。`,
    };
  if (sharePercent >= 10)
    return {
      state:
        `大車比例 ${sharePercent.toFixed(1)}%，屬於一般常見的範圍，` +
        `沒有特別偏高或偏低。`,
      action: undefined,
    };
  return {
    state:
      `大車比例 ${sharePercent.toFixed(1)}%，偏低，車流以機車與小型車為主；` +
      `這一段的車流組成比較單純。`,
    action: undefined,
  };
}

/* ── 尖峰集中度 ──────────────────────────────────────────────── */

/**
 * 尖峰那一小時佔全日的比例。
 *
 * ⚠️ 只有在**涵蓋接近完整一天**時才有意義：只調查了 8 小時的話，
 *   「佔全日」的分母根本不是全日。所以呼叫端要傳 coveredHours，
 *   不足時這一支回 null（＝這張圖寫不出第 3 級，由呼叫端另外說明）。
 */
export function peakConcentrationLevels(
  sharePercent: number,
  coveredHours: number,
): ChartLevels | null {
  if (!Number.isFinite(sharePercent) || sharePercent <= 0) return null;
  if (!Number.isFinite(coveredHours) || coveredHours < 20)
    return {
      state:
        `這一份調查只涵蓋 ${Math.round(coveredHours)} 小時，不足一整天，` +
        `所以「尖峰佔全日」的分母不是真正的全日，這個比例不能當成集中度來解讀。`,
      action:
        `要判斷車流集中程度，還需要一份涵蓋完整 24 小時的調查；` +
        `本系統不會把不足的時段補成 0，也不會外推。`,
    };
  if (sharePercent >= 12)
    return {
      state:
        `尖峰小時佔全日 ${sharePercent.toFixed(1)}%，車流相當集中在一小時之內；` +
        `全日平均值會低估這一段實際最忙的時候。`,
      action:
        `凡是用「全日平均」推算的結論，在這一段都要改用尖峰小時的數字重算一次。` +
        `若要進一步判斷是否需要號誌或車道調整，還需要該路口的號誌時制與車道配置，本系統沒有這兩項。`,
    };
  if (sharePercent >= 8)
    return {
      state:
        `尖峰小時佔全日 ${sharePercent.toFixed(1)}%，屬於常見的集中程度，` +
        `一天之內有明顯但不極端的尖峰。`,
      action: undefined,
    };
  return {
    state:
      `尖峰小時佔全日 ${sharePercent.toFixed(1)}%，車流在一天之內分布相對平均，` +
      `沒有明顯的單一尖峰。`,
    action:
      `這種分布下，用單一尖峰小時代表整段的做法會失真；` +
      `報告中若要談「最忙的時候」，建議同時附上全日曲線。`,
  };
}

/* ── 平假日差異 ──────────────────────────────────────────────── */

/**
 * 假日相對平日的比值（假日 ÷ 平日）。
 *
 * ⚠️ 只有兩邊都有資料時才叫得出來；只有一天的話呼叫端不要呼叫這一支，
 *   由它自己說明「這一季只有平日（或只有假日）」。
 */
export function dayCompareLevels(ratio: number): ChartLevels | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  if (ratio >= 1.1)
    return {
      state:
        `假日高於平日（假日是平日的 ${ratio.toFixed(1)} 倍），` +
        `這一段的車流以非通勤性質為主的可能性較高。`,
      action:
        `要確認是不是常態，還需要連續數季的同一路段資料，或該路段周邊的土地使用資料；` +
        `本系統只有交通量，沒有這兩項。在那之前，報告中談尖峰時應以假日為準。`,
    };
  if (ratio >= 0.85)
    return {
      state: `平日與假日大約是同一個水準（假日是平日的 ${(ratio * 100).toFixed(0)}%），兩天的車流沒有明顯差異。`,
      action: undefined,
    };
  if (ratio >= 0.6)
    return {
      state:
        `假日低於平日（假日是平日的 ${(ratio * 100).toFixed(0)}%），` +
        `是通勤路段常見的樣子。`,
      action: undefined,
    };
  return {
    state:
      `假日明顯低於平日（假日只有平日的 ${(ratio * 100).toFixed(0)}%），` +
      `這一段的車流高度依賴平日的通勤或商業活動。`,
    action:
      `差距這麼大時，用平日資料推估全年平均會高估、用假日推估則會低估；` +
      `要談年平均還需要各月份的長期觀測資料，本系統沒有。`,
  };
}

/* ── 歷季變化 ────────────────────────────────────────────────── */

/**
 * 最新一季相對最早一季的變化百分比（正＝增加）。
 *
 * @param quarterCount 這條線實際有幾個季別的值——只有兩季時不可以說「趨勢」。
 */
export function trendChangeLevels(
  changePercent: number,
  quarterCount: number,
): ChartLevels | null {
  if (!Number.isFinite(changePercent)) return null;
  if (!Number.isFinite(quarterCount) || quarterCount < 2) return null;
  const size = Math.abs(changePercent);
  const direction = changePercent >= 0 ? "增加" : "減少";
  if (quarterCount === 2)
    return {
      state:
        `目前只有兩季，${direction} ${size.toFixed(1)}% 是「兩點之間的差」，還不構成趨勢；` +
        `單季的差可能來自天氣、連假或施工改道。`,
      action:
        `要判斷是不是真的在變，還需要第三季以後的資料。` +
        `在那之前，報告中請寫「兩季之間的變化」，不要寫「呈上升／下降趨勢」。`,
    };
  if (size >= 20)
    return {
      state:
        `${quarterCount} 季之間${direction} ${size.toFixed(1)}%，變動幅度相當大，` +
        `通常不是自然成長可以解釋的。`,
      action:
        `請先排除資料面的原因（某一季漏匯部分時段、車種歸類改過、調查點位移動），` +
        `「資料維護 → 執行資料異常檢查」會列出這幾種。確認資料無誤之後，` +
        `要解釋成因還需要該期間的道路工程或周邊開發紀錄，本系統沒有。`,
    };
  if (size >= 5)
    return {
      state: `${quarterCount} 季之間${direction} ${size.toFixed(1)}%，是一個看得出方向、但幅度溫和的變化。`,
      action: `建議持續觀察，累積到四季以上再談趨勢；單季的起伏本來就會有。`,
    };
  return {
    state: `${quarterCount} 季之間${direction} ${size.toFixed(1)}%，大致持平，沒有明顯的方向。`,
    action: undefined,
  };
}

/* ── 服務水準（交通服務水準專用，但規則寫在共用檔以免三支各寫一套）── */

/**
 * 一組服務水準等級的判讀。
 *
 * @param worst       這張圖上最差的等級（A～F 其中一個）
 * @param congestedStart 使用者自己定的「壅塞起始等級」（三段分法那一組設定）
 * @param congestedCount 落在壅塞段的筆數
 * @param total          總筆數
 */
export function losLevels(
  worst: string,
  congestedStart: string,
  congestedCount: number,
  total: number,
): ChartLevels | null {
  const GRADES = ["A", "B", "C", "D", "E", "F"];
  const worstIndex = GRADES.indexOf(String(worst || "").toUpperCase());
  if (worstIndex < 0 || !Number.isFinite(total) || total <= 0) return null;
  const share = (congestedCount / total) * 100;
  if (congestedCount > 0)
    return {
      state:
        `最差為 ${GRADES[worstIndex]} 級，${total} 筆之中有 ${congestedCount} 筆（${share.toFixed(0)}%）` +
        `落在你設定的壅塞段（${congestedStart} 級以下）；這一段在尖峰時已經出現服務水準不足的情形。`,
      action:
        `要判斷該怎麼改善，還需要該路段的號誌時制、車道配置與路口幾何，本系統沒有這三項。` +
        `本系統這一端可以先做的是：確認速限設定與判定門檻是不是這個計畫要用的（「判定標準」頁），` +
        `因為等級是由速限比算出來的，門檻一改結論就會變。`,
    };
  if (worstIndex >= 2)
    return {
      state:
        `最差為 ${GRADES[worstIndex]} 級，全部 ${total} 筆都還沒有落入你設定的壅塞段（${congestedStart} 級以下），` +
        `但已經離順暢有一段距離。`,
      action: `建議持續觀察，並在下一季比對同一路段的等級有沒有再往下掉。`,
    };
  return {
    state: `最差只到 ${GRADES[worstIndex]} 級，全部 ${total} 筆都在順暢的一端，這一段目前沒有服務水準的問題。`,
    action: undefined,
  };
}

/* ── 轉向比例（路口轉向專用，理由同上）────────────────────────── */

/**
 * 某一個轉向（左轉／直行／右轉）占該支線總量的比例。
 *
 * ⚠️ 只在**明顯偏高**時才寫第 4 級：一般的轉向比例沒有什麼具體要做的事，
 *   硬要寫就會變成「建議注意」這種等於沒說的話。
 */
export function turnShareLevels(
  turnLabel: string,
  sharePercent: number,
): ChartLevels | null {
  if (!Number.isFinite(sharePercent) || sharePercent < 0) return null;
  if (sharePercent >= 40)
    return {
      state:
        `${turnLabel}占這一支線的 ${sharePercent.toFixed(1)}%，比例相當高；` +
        `這種路口的${turnLabel}車流通常需要獨立的車道或時相才容納得下。`,
      action:
        `要判斷現況夠不夠用，還需要這個路口的車道配置與號誌時相，本系統沒有。` +
        `本系統這一端可以先確認的是：這一支線的轉向對應是不是正確的` +
        `（「支線與流向設定」頁），對應錯了整個比例就會錯。`,
    };
  if (sharePercent >= 15)
    return {
      state: `${turnLabel}占這一支線的 ${sharePercent.toFixed(1)}%，屬於一般常見的比例。`,
      action: undefined,
    };
  return {
    state: `${turnLabel}只占這一支線的 ${sharePercent.toFixed(1)}%，是少數的流向。`,
    action: undefined,
  };
}

/* ── 資料涵蓋不足 ────────────────────────────────────────────── */

/**
 * 調查涵蓋不足時的通用第 3、4 級。
 *
 * ⚠️ 這一支**一定寫得出第 4 級**：缺什麼資料是明確的，不需要猜。
 */
export function coverageLevels(coveredHours: number): ChartLevels | null {
  if (!Number.isFinite(coveredHours) || coveredHours <= 0) return null;
  if (coveredHours >= 24) return null;
  return {
    state:
      `這一份調查只涵蓋 ${Math.round(coveredHours)} 小時，不是完整的一天，` +
      `所以圖上任何以「全日」為名的數字都只是這 ${Math.round(coveredHours)} 小時的合計。`,
    action:
      `要得到真正的全日數字，需要補一份涵蓋 24 小時的調查後重新匯入。` +
      `本系統不會把沒有調查的時段補成 0，也不會由已知時段外推——那會做出一個看起來完整、實際上是編的數字。`,
  };
}
