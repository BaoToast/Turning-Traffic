/*
 * ── v2.1.41 的守門測試 ──
 *
 * 這一輪的修正全部來自「三支系統跨系統徹查」：拿同一批真實調查表分別餵給
 * 路口轉向與全日交通量，比對兩支的判讀與數字，凡是不一致的就往下追。
 * 因此這裡的每一項都同時是「這支程式的行為對不對」與「三支之間一不一致」。
 *
 *  H1 分頁名稱前導空白 → 平假日被合併成一筆，假日量虛增
 *  H4 匯出的圖檔名不帶資料別 → 平日圖與假日圖互相覆寫
 *  M5 算不出來的統計範圍寫 0 而不是「－」
 *  M6 全形數字讀成 0（全日交通量讀成 123）
 *  M7 合法的橫線佔位符被誤報成壞資料
 *  M9 非內建車種被依欄位位置強制併入內建車種
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import {
  inspectWorkbook,
  inspectWorkbookVariants,
  isDayTypeSheetName,
} from "../lib/traffic.ts";

const REAL = new URL("../../realdata/", import.meta.url);
const hasRealData = (() => {
  try {
    readFileSync(new URL("batch2/11535T1502左楠路  後昌路口.xls", REAL));
    return true;
  } catch {
    return false;
  }
})();

/** 只有機車一個車種、值放在第一個時距的最小轉向表。 */
async function readOneCell(value: unknown) {
  const rows: unknown[][] = [
    ["OO路口 轉向交通量調查表"],
    ["站號：99999T99-01"],
    ["日期：115年05月04日(平日)"],
    ["路口編號：A"],
    ["時間", "機車", "", ""],
    ["", "左轉", "直行", "右轉"],
  ];
  for (let h = 0; h < 24; h++) {
    const a = String(h).padStart(2, "0");
    const b = String((h + 1) % 24).padStart(2, "0");
    rows.push([`${a}:00～${b}:00`, h === 0 ? value : 0, 0, 0]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "平日");
  const preview = await inspectWorkbook(
    new File(
      [XLSX.write(wb, { type: "array", bookType: "xlsx" })],
      "99999T9901_測試.xlsx",
    ),
  );
  let sum = 0;
  for (const column of preview.columns)
    for (const row of preview.intervalRows ?? [])
      sum += Math.round(Number(row.values[column.valueIndex]) || 0);
  return {
    sum,
    warned: (preview.warnings || []).some((w) => /不是數字/.test(w)),
  };
}

/* ── H1：平日／假日分頁名稱前後的空白都要容許 ── */

test("分頁名稱前後有空白時仍要判定為平日／假日資料頁", () => {
  /*
   * 舊寫法是 /^(平日|假日)\s*$/——只容許尾端空白。37 份真實檔裡有 11 份的
   * 分頁名稱帶空白，前導空白會讓判斷整組失效。全日交通量的
   * trafficSheetNamesForDay() 一直是前後都 trim 的，兩支必須一致。
   */
  for (const name of ["平日", "假日", "平日 ", " 平日", "  平日  ", "　假日　"])
    assert.equal(isDayTypeSheetName(name), true, `「${name}」應判定為資料頁`);
  for (const name of ["平日交通量", "監測日誌", "時相圖", "照片", "", "平日1"])
    assert.equal(isDayTypeSheetName(name), false, `「${name}」不應判定為資料頁`);
});

test("前導空白不得讓平日與假日被合併成一筆", { skip: !hasRealData }, async () => {
  /*
   * 這是本輪最嚴重的一項：不是少讀一天，而是**兩天被加在一起**。
   * daySheets 數不到 2 就退回單一 inspectWorkbook，它把所有資料頁依時間
   * 疊加，平日的量因此被算進假日那一筆。總量守恆，所以任何以總量為基礎的
   * 檢查都抓不到，畫面只顯示匯入成功。
   */
  const source = readFileSync(
    new URL("batch2/11535T1502左楠路  後昌路口.xls", REAL),
  );
  async function totals(rename: Record<string, string>) {
    const wb = XLSX.read(source, { type: "buffer" });
    wb.SheetNames = wb.SheetNames.map((n) => rename[n] ?? n);
    for (const [from, to] of Object.entries(rename)) {
      wb.Sheets[to] = wb.Sheets[from];
      delete wb.Sheets[from];
    }
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const previews = await inspectWorkbookVariants(
      new File([buffer], "11535T1502測試.xlsx"),
    );
    return previews.map((preview) => {
      let sum = 0;
      for (const column of preview.columns)
        for (const row of preview.intervalRows ?? [])
          sum += Math.round(Number(row.values[column.valueIndex]) || 0);
      return { day: preview.surveyType, sum };
    });
  }
  const base = await totals({});
  assert.equal(base.length, 2, "原始檔應產生平日與假日兩筆");
  const lead = await totals({ 平日: " 平日", 假日: " 假日" });
  assert.equal(
    lead.length,
    2,
    "分頁名稱前面多一個空白時，仍必須是兩筆——併成一筆會讓假日量虛增一倍以上",
  );
  assert.deepEqual(
    lead.map((x) => x.sum).sort((a, b) => a - b),
    base.map((x) => x.sum).sort((a, b) => a - b),
    "前導空白不得改變任何一天的車輛數",
  );
});

/* ── M6／M7：儲存格判讀要與全日交通量一致 ── */

test("全形數字要正確讀成數字，不可以計 0", async () => {
  /*
   * 全日交通量在 v20.37 就先做 NFKC 正規化、把「１２３」讀成 123；
   * 路口轉向沒跟上，同一格資料在兩支系統得到不同的數字。
   */
  const full = await readOneCell("１２３");
  assert.equal(full.sum, 123, "全形「１２３」要讀成 123");
  assert.equal(full.warned, false, "讀得出來就不該警告");
  const half = await readOneCell(123);
  assert.equal(half.sum, 123, "半形數字的行為不得改變");
});

test("橫線佔位符按 0 輛處理但不警告，其餘壞資料仍要警告", async () => {
  /*
   * 「--」「－」「—」「–」是調查表裡「該轉向不存在」的標準記法，
   * 全日交通量的 isUnusableCount() 明確視為合法。舊版轉向一律當成壞資料，
   * 實測 11017T1502 一份真實檔就跳出「有 192 個儲存格有內容但不是數字」——
   * 192 次誤報會讓使用者學會忽略這個警告，而它本來是要抓真正的壞資料。
   */
  for (const mark of ["-", "--", "－", "—", "–"]) {
    const result = await readOneCell(mark);
    assert.equal(result.sum, 0, `「${mark}」要按 0 輛處理`);
    assert.equal(result.warned, false, `「${mark}」是合法記號，不可誤報`);
  }
  for (const bad of ["N/A", "休", true]) {
    const result = await readOneCell(bad);
    assert.equal(result.sum, 0, `${JSON.stringify(bad)} 要按 0 輛處理`);
    assert.equal(result.warned, true, `${JSON.stringify(bad)} 是壞資料，必須警告`);
  }
});

/* ── M9：非內建車種不得被依欄位位置強制歸類 ── */

test(
  "表頭寫非內建車種時要保留原名，不可依欄位位置併入內建車種",
  { skip: !hasRealData },
  async () => {
    /*
     * 11535T1503 的四個支線區塊裡，前兩塊寫「大型車／特種車」，
     * 後兩塊寫「大貨車／大客車」。舊版依欄位位置把後者併進前者，
     * 於是「大客車」拿到特種車的當量 2.5——但大客車在工程上通常算大型車。
     * 使用者定的規則是「不認得的車種維持自訂、由使用者自行歸類」，
     * 全日交通量一直是這樣做的（vehicleCounts 裡是 custom:大貨車）。
     */
    const file = readFileSync(
      new URL("batch2/11535T1503後昌路 宏毅二路、中油大門路口.xls", REAL),
    );
    const previews = await inspectWorkbookVariants(
      new File([file], "11535T1503後昌路 宏毅二路、中油大門路口.xls"),
    );
    const weekday = previews.find((p) => p.surveyType === "平日");
    assert.ok(weekday, "應讀得到平日那一筆");
    const byVehicle: Record<string, number> = {};
    for (const column of weekday.columns) {
      let sum = 0;
      for (const row of weekday.intervalRows ?? [])
        sum += Math.round(Number(row.values[column.valueIndex]) || 0);
      const label = column.vehicleLabel || String(column.vehicle);
      byVehicle[label] = (byVehicle[label] || 0) + sum;
    }
    /* 與全日交通量 parseTrafficSheetValues 的 vehicleCounts 逐項相同 */
    assert.deepEqual(byVehicle, {
      機車: 19363,
      小型車: 8704,
      大型車: 249,
      特種車: 41,
      大貨車: 265,
      大客車: 20,
    });
    const total = Object.values(byVehicle).reduce((a, b) => a + b, 0);
    assert.equal(total, 28642, "總車輛數不得因為歸類方式而改變");
  },
);

test(
  "表頭殘留舊值、但車種名稱都是內建的四種時，仍要靠欄位位置救回來",
  { skip: !hasRealData },
  async () => {
    /*
     * 反面確認：位置推定不能因為 M9 而被整組拿掉。
     * 11017T1501 七叉路口的合併儲存格裡藏著沒清乾淨的「大型車」
     * （T5:Y5 是特種車的合併範圍，V5 卻留著舊值），表頭名稱不可信，
     * 此時依欄位群組還原才是對的。手算基準：合計 19,428 輛。
     */
    const name = "11017T1501中山北路岡山路口七叉路口.xlsx";
    const preview = await inspectWorkbook(
      new File([readFileSync(new URL("batch1/" + name, REAL))], name),
    );
    const byVehicle: Record<string, number> = {};
    for (const column of preview.columns) {
      let sum = 0;
      for (const row of preview.intervalRows ?? [])
        sum += Math.round(Number(row.values[column.valueIndex]) || 0);
      const label = column.vehicleLabel || String(column.vehicle);
      byVehicle[label] = (byVehicle[label] || 0) + sum;
    }
    assert.deepEqual(byVehicle, {
      機車: 12369,
      小型車: 6680,
      大型車: 276,
      特種車: 103,
    });
    assert.equal(
      Object.values(byVehicle).reduce((a, b) => a + b, 0),
      19428,
      "與逐格手算的基準相同",
    );
  },
);

/* ── H4／M5：匯出的原始碼守門 ── */

const appSource = readFileSync(
  new URL("../app/traffic-app.tsx", import.meta.url),
  "utf8",
);

test("匯出的圖檔名要帶資料別", () => {
  /*
   * 平日與假日是兩筆各自獨立的紀錄，但舊版 ZIP 的檔名只有站號＋時段，
   * JSZip 同名會直接覆寫——同一站只會留下一張圖，而且看不出是哪一天。
   * 過程沒有任何提示。
   */
  assert.doesNotMatch(
    appSource,
    /zip\.file\(\s*\n\s*record\.station \+ "_" \+ peak \+ "\.png"/,
    "單檔 ZIP 的檔名少了資料別",
  );
  const zipNames = [...appSource.matchAll(/zip\.file\(([\s\S]{0,400}?)\.png"/g)];
  assert.ok(zipNames.length >= 2, "應該有兩處 ZIP 圖檔命名");
  for (const [, body] of zipNames)
    assert.match(
      body,
      /record\.surveyType/,
      "每一處 ZIP 圖檔命名都要帶 record.surveyType",
    );
  for (const ext of ["svg", "png"])
    assert.match(
      appSource,
      new RegExp(`selected\\.surveyType[\\s\\S]{0,80}_轉向圖\\.${ext}`),
      `單檔 ${ext} 下載的檔名也要帶資料別`,
    );
});

test("算不出來的統計範圍要寫「－」，不可以寫 0", () => {
  /*
   * 不足 24 小時的調查沒有「全日尖峰小時」，舊版照樣產生列、數量寫 0、
   * 組成比例寫 0.0%——那些 0 會被 Excel 的加總與平均吃進去。
   * 同一支函式裡的另一張表早就寫「－」了，車種組成是唯一漏掉的。
   */
  assert.doesNotMatch(
    appSource,
    /數量: counts\[vehicleKey\],\s*\n\s*組成比例: total \? counts\[vehicleKey\] \/ total : 0,/,
    "車種組成分析表仍在寫 0",
  );
  assert.doesNotMatch(
    appSource,
    /數量: counts\[index\],\s*\n\s*組成比例: total \? counts\[index\] \/ total : 0,/,
    "車種組成明細仍在寫 0",
  );
  const computable = [...appSource.matchAll(/const computable =/g)];
  assert.equal(computable.length, 3, "三處車種組成匯出都要判斷算不算得出來");
  assert.match(appSource, /hasScopeValue\(record, scope\)/);
  assert.match(appSource, /hasScopeValue\(record, compositionScope\)/);
});

/* ── 季度：民國與西元都收，但一律存成民國年 ── */

test("季度一律以民國年寫法寫入", async () => {
  /*
   * 舊版的年度輸入框是 max="999" 加 slice(0, 3)，打 2026 會被靜靜截成 202，
   * 沒有任何提示；使用者拿到西元年標示的委託案時只能自己換算。
   * 開放西元之後，寫入的鍵必須統一成民國年，否則同一季會因為寫法不同
   * 而變成兩個不同的鍵——季度清單與歷季比較都是以這個字串分組的。
   */
  const { normalizeSurveyPeriod } = await import("../lib/period-date.ts");
  assert.equal(normalizeSurveyPeriod("2026Q1"), "115Q1");
  assert.equal(normalizeSurveyPeriod("115Q1"), "115Q1");
  assert.equal(normalizeSurveyPeriod("2025Q4"), "114Q4");
  assert.equal(normalizeSurveyPeriod("abc"), "abc");

  /* 輸入框要收得下四碼。只看真正的 JSX 屬性，註解裡提到舊值是正常的。 */
  assert.doesNotMatch(
    appSource,
    /\n\s+max="999"/,
    "年度輸入框仍限制在三碼",
  );
  assert.match(appSource, /\n\s+max="9999"/);
  assert.doesNotMatch(
    appSource,
    /e\.target\.value\.replace\(\/\\D\/g, ""\)\.slice\(0, 3\)/,
    "仍會把四碼年份截成三碼",
  );
  assert.match(appSource, /\.slice\(0, 4\)/);

  /* 消費端一律用正規化後的鍵 */
  assert.match(appSource, /const importPeriodKey = normalizeSurveyPeriod\(importPeriod\)/);
  assert.equal(
    (appSource.match(/record\.quarter === importPeriodKey/g) ?? []).length,
    2,
    "兩處「找既有紀錄」都要用正規化後的鍵",
  );
  assert.match(appSource, /const q = importPeriodKey;/);
  /* 輸入框要當場告訴使用者會存成什麼 */
  assert.match(appSource, /將存成「\{importPeriodKey\}」/);
});

/* ── 民國／西元顯示切換 ── */

test("quarterInYearStyle 兩種寫法可以互轉，且不動到認不得的字串", async () => {
  const { quarterInYearStyle } = await import("../lib/period-date.ts");
  for (const [roc, ad] of [
    ["115Q1", "2026Q1"],
    ["114Q4", "2025Q4"],
    ["100Q3", "2011Q3"],
    ["113Q2", "2024Q2"],
  ]) {
    assert.equal(quarterInYearStyle(roc, "ad"), ad, `${roc} → 西元`);
    assert.equal(quarterInYearStyle(ad, "roc"), roc, `${ad} → 民國`);
    /* 來回一趟要回到原點，否則切兩次畫面就對不上了 */
    assert.equal(quarterInYearStyle(quarterInYearStyle(roc, "ad"), "roc"), roc);
  }
  for (const odd of ["", "115", "115Q5", "115年2、3月", "abc"])
    assert.equal(quarterInYearStyle(odd, "ad"), odd, `「${odd}」不可被改寫`);
});

test("periodDisplayLabel 的月份寫法也跟著年份切換，不傳就維持舊行為", async () => {
  const { periodDisplayLabel } = await import("../lib/period-date.ts");
  const dates = ["2026-02-11", "2026-03-04"];
  assert.equal(periodDisplayLabel("115Q1", dates, "month", "roc"), "115年2、3月");
  assert.equal(periodDisplayLabel("115Q1", dates, "month", "ad"), "2026年2、3月");
  assert.equal(periodDisplayLabel("115Q1", [], "month", "ad"), "2026Q1");
  assert.equal(periodDisplayLabel("115Q1", dates, "month"), "115年2、3月");
  assert.equal(periodDisplayLabel("115Q1", [], "quarter"), "115Q1");
});

test("切換鈕存在，而且季度選單的值一律是儲存值", () => {
  assert.match(appSource, /data-testid="year-style-toggle"/, "要有年份顯示切換鈕");
  assert.match(appSource, /useState<YearStyle>\("roc"\)/, "預設是民國年");
  /*
   * showQuarter 必須是穩定的 useCallback：轉向圖與幾何示意圖的 useMemo 依賴它，
   * 每次 render 換一個新函式的話那些 memo 等於失效，每次都要重組一整張 SVG。
   */
  assert.match(appSource, /const showQuarter = useCallback\(/);
  assert.match(
    appSource,
    /const showQuarter = useCallback\([\s\S]{0,200}?\n\s*\[yearStyle\],\n\s*\);/,
    "showQuarter 的相依只能是 yearStyle",
  );
  /*
   * <option> 的 value 一定要是儲存的季度。文字換成西元年、值也跟著換的話，
   * 結論草稿的單季條件（record.quarter === scope.quarter 是直接比字串的）
   * 立刻變成「符合條件 0 筆」。所以全系統的季度選單都必須是 value={q}。
   */
  const optionsWithoutValue = appSource.match(/<option key=\{q\}(?! value=\{q\})/g);
  assert.equal(
    optionsWithoutValue,
    null,
    "有季度選單沒有明寫 value={q}，切成西元年之後篩選會落空",
  );
  /* 沒有任何一處還把季度原樣印出來（都要走 showQuarter／quarterLabel） */
  assert.doesNotMatch(
    appSource,
    /<option key=\{q\} value=\{q\}>\s*\n\s*\{q\}\s*\n/,
    "仍有季度選單直接印出儲存值，切換後與表格不一致",
  );
  /*
   * 反面也要擋：把顯示文字塞進 value 或 key 一樣會讓篩選落空。
   * 只檢查「value={q}」還不夠——寫成 value={showQuarter(q)} 就繞過去了。
   */
  assert.doesNotMatch(
    appSource,
    /<option[^>]*(?:key|value)=\{(?:props\.)?showQuarter\(/,
    "季度選單的 key／value 不可以是顯示文字",
  );
});

test("匯出的季度欄跟著切換，但識別鍵與排序不受影響", () => {
  /* 匯出欄位都走 showQuarter；沒有任何一處還在寫 record.quarter 原值 */
  assert.ok(
    (appSource.match(/季度: showQuarter\(record\.quarter\)/g) ?? []).length >= 9,
    "匯出的季度欄要全部走 showQuarter",
  );
  assert.doesNotMatch(
    appSource,
    /(?:name|\s):\s*"季度",[\s\S]{0,80}?record\.quarter[,)]/,
    "仍有匯出欄位直接寫儲存值",
  );
  /* 分組、排序與識別鍵一律走儲存值 */
  assert.match(appSource, /const importPeriodKey = normalizeSurveyPeriod\(importPeriod\)/);
  assert.match(appSource, /record\.quarter === importPeriodKey/);
});

test("結論草稿的換字是可選的，不傳就維持舊輸出；篩選仍走儲存值", async () => {
  const src = readFileSync(new URL("../lib/conclusion.ts", import.meta.url), "utf8");
  assert.match(src, /showQuarter\?: \(quarter: string\) => string;/, "showQuarter 要是可選的");
  assert.match(src, /typeof meta\.showQuarter === "function"/);
  /* 篩選與排序絕對不可以改成顯示值 */
  assert.match(src, /scope\.kind === "quarter" && record\.quarter !== scope\.quarter/);
  assert.match(src, /quarterKey\(a\.quarter\) - quarterKey\(b\.quarter\)/);

  /*
   * 實際跑一遍：同一批資料，換寫法只換字，挑到的筆數與數字完全相同。
   * 測資直接沿用 conclusion.test.ts 的產生器，免得手捏的假紀錄缺欄位。
   */
  const { buildConclusion } = await import("../lib/conclusion.ts");
  const { makeRecord, CONCLUSION_META } = await import(
    "./helpers/conclusion-record.ts"
  );
  const records = [
    makeRecord({ quarter: "115Q1" }),
    makeRecord({ quarter: "114Q4" }),
  ];
  const { DEFAULT_CONDITION } = await import("../lib/conclusion.ts");
  const show = (q: string) =>
    q === "115Q1" ? "2026Q1" : q === "114Q4" ? "2025Q4" : q;
  /*
   * 三種分段方式都要跑到。季度是從好幾條不同的路徑寫出來的
   *（scopeLabel、統計範圍、〔季度〕小標、季度分段標題、代表紀錄、季度變動），
   * 只跑預設的 byIntersection 會漏掉其中一半——漏掉的那幾條就會在畫面上
   * 出現「2026Q1 的表、115Q1 的內文」這種前後不一致。
   */
  for (const grouping of ["byIntersection", "byQuarter", "overall"] as const) {
    /* 範圍條件才會走到季度變動與 scopeLabel 的起訖寫法 */
    for (const scope of [
      { kind: "quarter" as const, quarter: "115Q1" },
      { kind: "range" as const, from: "114Q4", to: "115Q1" },
      { kind: "project" as const },
    ]) {
      const condition = {
        ...DEFAULT_CONDITION,
        grouping,
        metrics: [...DEFAULT_CONDITION.metrics, "growth"] as typeof DEFAULT_CONDITION.metrics,
        scope,
      };
      const roc = buildConclusion(records, condition, CONCLUSION_META);
      const ad = buildConclusion(records, condition, {
        ...CONCLUSION_META,
        showQuarter: show,
      });
      const where = `${grouping}／${scope.kind}`;
      assert.doesNotMatch(roc, /所選條件沒有對應的資料/, `${where}：民國年寫法要挑得到資料`);
      assert.doesNotMatch(ad, /所選條件沒有對應的資料/, `${where}：換寫法仍要挑到同一批資料`);
      assert.ok(/11[45]Q[1-4]/.test(roc), `${where}：民國年版本本來就該出現季度字樣`);
      assert.doesNotMatch(ad, /11[45]Q[1-4]/, `${where}：草稿上不應再出現民國年寫法`);
      assert.match(ad, /20(?:25|26)Q[1-4]/, `${where}：草稿上要寫西元年`);
      /* 只有季度那幾個字不同，其餘逐字相同 */
      assert.equal(
        ad.replaceAll("2026Q1", "115Q1").replaceAll("2025Q4", "114Q4"),
        roc,
        `${where}：換寫法之後除了季度字樣以外必須逐字相同（數字不可以有任何變化）`,
      );
    }
  }
});
