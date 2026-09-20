/*
 * ══════════════════════════════════════════════════════════════════════
 *  圖說第 3、4 級：三支程式共用的判定契約
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ **這個檔案在三支程式裡逐位元相同。** 改了其中一份就要三份一起改，
 *   否則同一個數字在三支會被說成不同的狀況——使用者會把三種說法都抄進
 *   同一份報告。（與 `period-input-contract`、`direction-pair-contract` 同一種做法。）
 *
 * 使用者 2026-09-20 定的規則：
 *   ・每張圖至少要寫得出第 3 級（代表什麼狀況）。
 *   ・第 4 級（要怎麼處理）**只在寫得出具體的時候才寫**，寫不出來整段不寫，
 *     不要盲猜；「建議持續觀察」這種如果真的是對的處理方式就用它。
 *
 * 呼叫端要提供 `levels`：那一支程式的 ChartLevels 模組。
 */

/**
 * 每一列：[標題, () => 實際回傳值, 期望, 這一列在防什麼]
 *
 * 期望的寫法：
 *   { state: true, action: true }  → 兩級都要有
 *   { state: true, action: false } → 只有第 3 級，第 4 級**必須沒有**
 *   null                            → 整個回 null（這張圖這一項寫不出來）
 */
export function chartLevelCases(levels) {
  const {
    heavyShareLevels,
    peakConcentrationLevels,
    dayCompareLevels,
    trendChangeLevels,
    losLevels,
    turnShareLevels,
    coverageLevels,
  } = levels;
  return [
    /* ── 大車比例 ── */
    ["大車比例偏高 → 兩級都寫得出來", () => heavyShareLevels(25), { state: true, action: true },
      "偏高時要講得出還缺什麼資料才能判斷是不是常態"],
    ["大車比例一般 → 只寫第 3 級", () => heavyShareLevels(15), { state: true, action: false },
      "⚠️ 一般範圍沒有具體要做的事，硬寫就會變成『建議注意』這種等於沒說的話"],
    ["大車比例偏低 → 只寫第 3 級", () => heavyShareLevels(3), { state: true, action: false }, "同上"],
    ["大車比例是負數 → 整個不寫", () => heavyShareLevels(-1), null, "防呆：算錯的輸入不可以生出一段話"],
    ["大車比例不是數字 → 整個不寫", () => heavyShareLevels(Number.NaN), null, "同上"],

    /* ── 尖峰集中度 ── */
    ["尖峰很集中（24 小時）→ 兩級都有", () => peakConcentrationLevels(15, 24), { state: true, action: true },
      "集中時要提醒『用全日平均推的結論要重算』"],
    ["尖峰集中度一般 → 只寫第 3 級", () => peakConcentrationLevels(10, 24), { state: true, action: false },
      "⚠️ 常見的集中程度沒有具體要做的事"],
    ["分布很平均 → 兩級都有", () => peakConcentrationLevels(5, 24), { state: true, action: true },
      "太平均時『拿單一尖峰代表整段』會失真，那是具體的提醒"],
    ["涵蓋不足 24 小時 → 兩級都有，而且要說分母不是全日", () => peakConcentrationLevels(15, 8), { state: true, action: true },
      "⚠️ 分母不是全日時這個比例根本不能當集中度解讀，不可以照常講"],
    ["尖峰佔比是 0 → 整個不寫", () => peakConcentrationLevels(0, 24), null, "防呆"],

    /* ── 平假日 ── */
    ["假日高於平日 → 兩級都有", () => dayCompareLevels(1.3), { state: true, action: true }, "非通勤性質要講得出還缺什麼"],
    ["平假日差不多 → 只寫第 3 級", () => dayCompareLevels(0.95), { state: true, action: false }, "⚠️ 沒差異就沒有要做的事"],
    ["假日略低 → 只寫第 3 級", () => dayCompareLevels(0.7), { state: true, action: false }, "通勤路段的常態"],
    ["假日明顯偏低 → 兩級都有", () => dayCompareLevels(0.4), { state: true, action: true }, "差距大時推估年平均會偏，要講"],
    ["比值是 0 → 整個不寫", () => dayCompareLevels(0), null, "防呆"],

    /* ── 歷季變化 ── */
    ["只有兩季 → 兩級都有，而且要講明不構成趨勢", () => trendChangeLevels(30, 2), { state: true, action: true },
      "⚠️ 兩點之間的差不是趨勢，寫成趨勢是這一類圖最常見的誤讀"],
    ["變動很大（多季）→ 兩級都有", () => trendChangeLevels(30, 5), { state: true, action: true },
      "要先排除資料面的原因，那是具體可做的事"],
    ["溫和變化 → 兩級都有（建議持續觀察）", () => trendChangeLevels(8, 5), { state: true, action: true },
      "使用者明講：『建議持續觀察』如果是對的處理方式就用它"],
    ["大致持平 → 只寫第 3 級", () => trendChangeLevels(2, 5), { state: true, action: false }, "⚠️ 沒變就沒有要做的事"],
    ["只有一季 → 整個不寫", () => trendChangeLevels(10, 1), null, "一個點算不出變化"],

    /* ── 服務水準 ── */
    ["有落在壅塞段 → 兩級都有", () => losLevels("F", "E", 3, 10), { state: true, action: true },
      "要講得出還缺號誌時制與車道配置，而且本系統這一端可以先確認什麼"],
    ["最差 C、沒有壅塞 → 兩級都有（持續觀察）", () => losLevels("C", "E", 0, 10), { state: true, action: true },
      "離順暢有距離時，下一季比對是具體可做的事"],
    ["最差 B、全部順暢 → 只寫第 3 級", () => losLevels("B", "E", 0, 10), { state: true, action: false },
      "⚠️ 沒有問題時不可以硬湊一段處理方式"],
    ["等級認不得 → 整個不寫", () => losLevels("Z", "E", 0, 10), null, "防呆"],
    ["筆數是 0 → 整個不寫", () => losLevels("C", "E", 0, 0), null, "防呆：除以 0"],

    /* ── 轉向比例 ── */
    ["某一轉向比例很高 → 兩級都有", () => turnShareLevels("左轉", 45), { state: true, action: true },
      "高比例要講得出還缺什麼，以及先確認轉向對應"],
    ["轉向比例一般 → 只寫第 3 級", () => turnShareLevels("直行", 25), { state: true, action: false }, "⚠️ 一般比例沒有要做的事"],
    ["轉向比例很低 → 只寫第 3 級", () => turnShareLevels("右轉", 5), { state: true, action: false }, "同上"],

    /* ── 涵蓋 ── */
    ["涵蓋不足一天 → 兩級都有", () => coverageLevels(8), { state: true, action: true },
      "缺什麼資料是明確的，一定寫得出第 4 級"],
    ["涵蓋滿 24 小時 → 整個不寫", () => coverageLevels(24), null, "⚠️ 沒問題時不可以冒出一段話"],
    ["涵蓋是 0 → 整個不寫", () => coverageLevels(0), null, "防呆"],
  ];
}

export function checkChartLevelsContract(levels, report) {
  const cases = chartLevelCases(levels);
  /*
   * ⚠️ 前置檢查：案例表真的有內容，而且三種結果都有
   *   （兩級都有／只有第 3 級／整個不寫）。
   *   少了這一條，案例表被清空或規則被改成「一律回 null」時，
   *   這一支會安靜地全部通過。
   */
  const shapes = new Set(
    cases.map(([, , expected]) =>
      expected === null ? "none" : expected.action ? "both" : "state-only",
    ),
  );
  report(
    "前置：契約案例表有內容，而且三種結果都有案例",
    cases.length >= 25 &&
      shapes.has("none") &&
      shapes.has("both") &&
      shapes.has("state-only"),
    `${cases.length} 列，結果種類=${[...shapes].join("／")}`,
  );

  for (const [title, run, expected, why] of cases) {
    const actual = run();
    if (expected === null) {
      report(title, actual === null, `期望整個不寫，實際 ${JSON.stringify(actual)}；這一列在防：${why}`);
      continue;
    }
    const hasState = Boolean(actual && actual.state);
    const hasAction = Boolean(actual && actual.action);
    report(
      title,
      hasState === expected.state && hasAction === expected.action,
      `期望 第3級=${expected.state}／第4級=${expected.action}，` +
        `實際 第3級=${hasState}／第4級=${hasAction}；這一列在防：${why}`,
    );
  }

  /*
   * ⚠️ 最重要的一條：**第 3 級一定要有內容，而且不可以是空話。**
   *   「本圖顯示各項數值之分布」這種句子比不寫還糟，因為它看起來像寫了。
   *   所以每一段第 3 級都要**帶著那個數字**——帶不帶得出數字，
   *   就是「真的判讀了」與「湊字數」的分界。
   */
  for (const [title, run, expected] of cases) {
    if (expected === null) continue;
    const actual = run();
    const state = String(actual?.state ?? "");
    report(
      `${title}：第 3 級帶得出數字，不是空話`,
      state.length >= 20 && /\d/.test(state),
      `實際：「${state}」`,
    );
  }

  /*
   * ⚠️ 第 4 級只要有寫，就必須是**具體的**：要嘛說出還缺哪一份資料、
   *   要嘛說出一件現在就做得到的事。所以不接受只有「建議注意」四個字的句子。
   */
  for (const [title, run, expected] of cases) {
    if (expected === null || !expected.action) continue;
    const action = String(run()?.action ?? "");
    report(
      `${title}：第 4 級是具體的`,
      action.length >= 20 &&
        /*
         * ⚠️ 白名單刻意列**具體的動作詞**，不可以只寫「建議」兩個字：
         *   「建議注意」「建議參考」也會通過，那正是這一條要擋的空話。
         */
        /還需要|請先|建議持續觀察|建議同時附上|要改用|重算|重新匯入|單獨列出|確認/.test(
          action,
        ),
      `實際：「${action}」`,
    );
  }

  /*
   * ⚠️ 不可以冒充規範。使用者已取消「引用公路容量手冊三種標示」，
   *   更不可以反過來在這一層暗示有手冊依據。
   */
  for (const [title, run, expected] of cases) {
    if (expected === null) continue;
    const actual = run();
    const text = String(actual?.state ?? "") + String(actual?.action ?? "");
    const bad = ["依規定", "標準為", "規範規定", "手冊規定", "法規"].filter((w) =>
      text.includes(w),
    );
    report(`${title}：沒有冒充規範`, bad.length === 0, `出現了：${bad.join("、")}`);
  }
}
