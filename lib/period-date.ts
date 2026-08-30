/*
 * ── 調查日期 × 期別 一致性檢查 ───────────────────────────────────────
 *
 * 目的：使用者匯入前輸入的期別（例：115Q1），與檔案表頭寫的調查日期，
 *       如果對不起來就在寫入前顯眼提示、要求二次確認再匯入。
 *
 * 這一段是「路口轉向」「全日交通量」「交通服務水準」三支程式**行為完全相同**
 * 的共用邏輯（交通服務水準沒有打包工具，是同一份程式的 ES5 版）。
 * 三支各有一份 period-date 測試，**測試表逐字相同**——那份表就是防漂移的憑據。
 * 要改就三支一起改。
 *
 * 邊界（不要越線）：
 *   本檔只讀「表頭文字」與「使用者輸入的期別字串」，回傳一個判斷結果物件。
 *   它不參與任何加總、當量、尖峰挑選、四捨五入、排序或匯出的數值路徑，
 *   也不會修改任何一筆紀錄。判斷不出來一律回 "unknown"，**永遠不阻擋匯入**。
 */

export type PeriodKind = "Q" | "M";

export type ParsedPeriod = { adYear: number; kind: PeriodKind; num: number };

export type FoundSurveyDate = {
  iso: string;
  raw: string;
  sheet: string;
  cell: string;
  labelled: boolean;
};

export type PeriodDateStatus = "match" | "mismatch" | "unknown";

export type PeriodDateCheck = {
  file: string;
  status: PeriodDateStatus;
  periodInput: string;
  periodLabel: string;
  date: string;
  dateLabel: string;
  labelled: boolean;
  source: string;
  raw: string;
  headline: string;
  detail: string;
};

/** 不依賴 Date 對 0～99 年的特殊處理，直接驗證實際曆日（含閏年）。 */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || !Number.isInteger(day))
    return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

/** 期別字串 → { 西元年, 季或月, 數字 }。認不得回 null。 */
export function parseSurveyPeriod(input: string): ParsedPeriod | null {
  const text = String(input ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "");
  if (!text) return null;
  /*
   * 民國 90～200 才轉西元；純西元四碼原樣留著。
   * 不用「小於 1911 就加 1911」：打錯的 "5Q1" 會被當成民國 5 年變 1916Q1，
   * 看起來像個正常結果，反而比認不得更危險。
   */
  const toAd = (n: number) => (n >= 90 && n <= 200 ? n + 1911 : n);
  const month = (year: number, num: number): ParsedPeriod | null =>
    num >= 1 && num <= 12 ? { adYear: year, kind: "M", num } : null;
  let m: RegExpMatchArray | null;
  /* 115Q1 / 2026Q1 / 115q1 */
  m = text.match(/^(\d{2,4})Q([1-4])$/i);
  if (m) return { adYear: toAd(Number(m[1])), kind: "Q", num: Number(m[2]) };
  /* 115年1月 / 115年01月 */
  m = text.match(/^(\d{2,4})年(\d{1,2})月?$/);
  if (m) return month(toAd(Number(m[1])), Number(m[2]));
  /* 115-01 / 115/1 / 115.01 / 2026-01 */
  m = text.match(/^(\d{2,4})[-/.](\d{1,2})$/);
  if (m) return month(toAd(Number(m[1])), Number(m[2]));
  /* 115M1 / 115m01 */
  m = text.match(/^(\d{2,4})M(\d{1,2})$/i);
  if (m) return month(toAd(Number(m[1])), Number(m[2]));
  /* 11501 ＝ 民國115年1月（三碼年＋兩碼月） */
  m = text.match(/^(\d{3})(\d{2})$/);
  if (m) return month(toAd(Number(m[1])), Number(m[2]));
  /* 202601 ＝ 西元2026年1月（四碼年＋兩碼月） */
  m = text.match(/^(\d{4})(\d{2})$/);
  if (m) return month(Number(m[1]), Number(m[2]));
  return null;
}

/** ISO 日期（YYYY-MM-DD）落在哪一個季／月。 */
export function periodOfDate(iso: string, kind: PeriodKind): ParsedPeriod | null {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidCalendarDate(year, month, day)) return null;
  return kind === "M"
    ? { adYear: year, kind: "M", num: month }
    : { adYear: year, kind: "Q", num: Math.ceil(month / 3) };
}

/** 給人看的期別字串。民國年優先，因為畫面上的輸入框寫的就是民國年。 */
export function formatPeriod(period: ParsedPeriod | null): string {
  if (!period) return "";
  const roc = period.adYear - 1911;
  const year = roc >= 90 && roc <= 200 ? String(roc) : String(period.adYear);
  return period.kind === "M"
    ? year + "年" + String(period.num).padStart(2, "0") + "月"
    : year + "Q" + period.num;
}

export function samePeriod(a: ParsedPeriod | null, b: ParsedPeriod | null): boolean {
  return Boolean(a && b && a.adYear === b.adYear && a.kind === b.kind && a.num === b.num);
}

/*
 * 表頭上的「日期」標示。實際檔案看過的寫法：
 *   「日期：115.01.26 (平日)」「監測日期：115年01月25日(假日)」
 *   「日　　期：115年01月26日(平日)」（中間夾空白，比對前已 NFKC ＋去空白）
 * 沒有這個標示、只是剛好長得像日期的儲存格屬於「推測」，訊息裡會註明。
 */
const SURVEY_DATE_LABEL = /(?:調查|監測|施測|檢測|觀測|測量|作業)?日期[:：]/;
/** 這些不是調查日期，不可以拿來比對期別。 */
const NON_SURVEY_DATE_LABEL =
  /(?:製表|列印|印製|報告|出圖|填表|核定|審查|校核|繪製|修正|更新)日期/;

const flatten = (text: string) =>
  String(text ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "");

export function isLabelledSurveyDateText(text: string): boolean {
  const flat = flatten(text);
  if (NON_SURVEY_DATE_LABEL.test(flat)) return false;
  return SURVEY_DATE_LABEL.test(flat);
}

/** 從一段文字讀出 ISO 日期；讀不到回空字串。民國年自動加 1911。 */
export function parseSurveyDateText(text: string): string {
  const match = String(text ?? "")
    .normalize("NFKC")
    .match(/(\d{2,4})\s*(?:年\s*|[./-]\s*)(\d{1,2})\s*(?:月\s*|[./-]\s*)(\d{1,2})\s*(?:日)?/);
  if (!match) return "";
  const sourceYear = Number(match[1]);
  const year = sourceYear >= 90 && sourceYear <= 200 ? sourceYear + 1911 : sourceYear;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) return "";
  return (
    year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0")
  );
}

/*
 * 從表頭儲存格清單挑出調查日期。cells 只要傳表頭那幾列。
 * 兩層：① 有「日期：」標示的優先；② 都沒有才退而用第一個長得像日期的，
 * 並在訊息註明是推測，讓使用者知道要自己看一眼。
 */
export function findSurveyDate(
  cells: Array<{ text: string; sheet?: string; cell?: string }>,
): FoundSurveyDate | null {
  const list = Array.isArray(cells) ? cells : [];
  let loose: FoundSurveyDate | null = null;
  for (const item of list) {
    const text = String(item?.text ?? "");
    if (NON_SURVEY_DATE_LABEL.test(flatten(text))) continue;
    const iso = parseSurveyDateText(text);
    if (!iso) continue;
    const hit: FoundSurveyDate = {
      iso,
      raw: text.trim(),
      sheet: String(item?.sheet ?? ""),
      cell: String(item?.cell ?? ""),
      labelled: isLabelledSurveyDateText(text),
    };
    if (hit.labelled) return hit;
    loose = loose || hit;
  }
  return loose;
}

export function surveyDateSourceLabel(found: FoundSurveyDate | null): string {
  if (!found) return "";
  const sheet = found.sheet ? found.sheet.trim() : "";
  return sheet ? sheet + "!" + found.cell : found.cell;
}

export function readableDate(iso: string): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso ?? "");
  const roc = Number(m[1]) - 1911;
  const year = roc >= 90 && roc <= 200 ? "民國" + roc : m[1];
  return year + "年" + m[2] + "月" + m[3] + "日";
}

/*
 * 比對結果。三種：
 *   match     相符（若日期是推測來的，detail 會註明）
 *   mismatch  對不起來 → 呼叫端顯眼提示並要求二次確認
 *   unknown   讀不到日期 → **不阻擋**，只提醒使用者自行確認
 */
export function checkPeriodAgainstDate(
  periodInput: string,
  found: FoundSurveyDate | null,
  fileLabel: string,
): PeriodDateCheck {
  const label = String(fileLabel ?? "");
  const period = parseSurveyPeriod(periodInput);
  const base = {
    file: label,
    periodInput: String(periodInput ?? ""),
    periodLabel: period ? formatPeriod(period) : String(periodInput ?? ""),
    date: "",
    dateLabel: "",
    labelled: false,
    source: "",
    raw: "",
  };
  if (!found || !found.iso || !period)
    return {
      ...base,
      status: "unknown",
      headline: "無法辨別調查日期",
      detail:
        (label ? "「" + label + "」：" : "") +
        "本次資料無法辨別日期，所以無法幫忙確認是否符合期別，請自行確認正確性。",
    };
  const datePeriod = periodOfDate(found.iso, period.kind);
  const info = {
    ...base,
    date: found.iso,
    dateLabel: datePeriod ? formatPeriod(datePeriod) : "",
    labelled: Boolean(found.labelled),
    source: surveyDateSourceLabel(found),
    raw: found.raw || "",
  };
  const human = readableDate(found.iso);
  const guess = found.labelled
    ? ""
    : "（這一格沒有「日期」標示，是系統從表頭推測的，請一併確認）";
  if (samePeriod(datePeriod, period))
    return {
      ...info,
      status: "match",
      headline: "調查日期與所選期別相符",
      detail:
        (label ? "「" + label + "」：" : "") +
        "調查日期 " + human + "（來源 " + info.source + "）屬於 " +
        info.periodLabel + "，與你選的期別相符。" + guess,
    };
  return {
    ...info,
    status: "mismatch",
    headline: "調查日期與所選期別不一致",
    detail:
      (label ? "「" + label + "」\n" : "") +
      "　檔案裡的調查日期：" + human + "（屬於 " + info.dateLabel + "）\n" +
      "　你選擇的期別：　　" + info.periodLabel + "\n" +
      "　日期來源：" + info.source + "「" + info.raw + "」" +
      (guess ? "\n　" + guess : ""),
  };
}

/**
 * 把一批檔案的檢查結果整理成二次確認文字。
 * 沒有 mismatch 就回空字串——呼叫端不必跳確認框。
 */
export function periodMismatchPrompt(checks: PeriodDateCheck[]): string {
  const bad = (Array.isArray(checks) ? checks : []).filter(
    (item) => item && item.status === "mismatch",
  );
  if (!bad.length) return "";
  return (
    "⚠️ 調查日期與你選擇的期別不一致（" + bad.length + " 份）\n\n" +
    bad.map((item) => item.detail).join("\n\n") +
    "\n\n請確認是不是選錯期別、或拿錯檔案。\n" +
    "按「確定」＝我確認無誤，仍要以這個期別匯入；按「取消」＝先不要匯入。"
  );
}

/** 讀不到日期的那幾份整理成一句提醒（不阻擋匯入）。 */
export function periodUnknownNotice(checks: PeriodDateCheck[]): string {
  const unknown = (Array.isArray(checks) ? checks : []).filter(
    (item) => item && item.status === "unknown",
  );
  if (!unknown.length) return "";
  return (
    "有 " + unknown.length +
    " 份資料無法辨別日期，所以無法幫忙確認是否符合期別，請自行確認正確性：" +
    unknown.map((item) => item.file || "（未命名）").join("、")
  );
}

/* ══════════════════════════════════════════════════════════════════
 * 期別顯示：季別 ⇄ 實際調查月份
 *
 * 使用者要的是「平常顯示 115Q1，按一下可以看到這一季實際是幾月做的」。
 * 這裡**只換顯示的文字**——資料的分組、排序、鍵值、計算與匯出的數值
 * 一律仍以季別為準，切換顯示不會動到任何一個數字。
 *
 * 同一季有多個月份（例如 2 月做兩站、3 月做三站）就一起列出：「115年2、3月」。
 * 完全沒有日期可用時原樣回傳季別——不編、也不留空白。
 * ════════════════════════════════════════════════════════════════ */

/** 期別要顯示成季別還是實際調查月份。 */
export type PeriodDisplayMode = "quarter" | "month";

/**
 * quarter：資料實際掛的季別字串（例："115Q1"），永遠是分組與鍵值的依據。
 * isoDates：這一季底下每一筆的調查日期（YYYY-MM-DD），沒有的就別放進來。
 */
export function periodDisplayLabel(
  quarter: string,
  isoDates: string[],
  mode: PeriodDisplayMode,
): string {
  const label = String(quarter ?? "");
  if (mode !== "month") return label;
  const months: string[] = [];
  for (const iso of Array.isArray(isoDates) ? isoDates : []) {
    const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (!m) continue;
    const key = m[1] + "-" + m[2];
    if (!months.includes(key)) months.push(key);
  }
  if (!months.length) return label;
  months.sort();
  const years: string[] = [];
  for (const key of months) {
    const year = key.slice(0, 4);
    if (!years.includes(year)) years.push(year);
  }
  const rocOf = (year: string) => {
    const roc = Number(year) - 1911;
    return roc >= 90 && roc <= 200 ? String(roc) : year;
  };
  /*
   * 同一年就寫「115年2、3月」；跨年（12 月與隔年 1 月同一季不會發生，
   * 但資料掛錯季時會）就逐個寫完整的「114年12月、115年1月」，不省略年份。
   */
  if (years.length === 1)
    return (
      rocOf(years[0]) +
      "年" +
      months
        .map(function (key) {
          return String(Number(key.slice(5, 7)));
        })
        .join("、") +
      "月"
    );
  return months
    .map(function (key) {
      return rocOf(key.slice(0, 4)) + "年" + Number(key.slice(5, 7)) + "月";
    })
    .join("、");
}

/** 切換鈕上的文字，三支程式共用。 */
export const PERIOD_DISPLAY_LABELS: Record<PeriodDisplayMode, string> = {
  quarter: "季別",
  month: "調查月份",
};
