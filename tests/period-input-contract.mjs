/*
 * 季度輸入把關的「行為契約」——三支系統共用，逐位元相同的一份檔案。
 *
 * 為什麼需要這一支：
 *
 * v2.1.43／v20.40 那一輪，三支的 `checkSurveyPeriodInput()` 各自被改成不同寫法，
 * 而三支的守門測試都只驗自己那一份，於是**沒有任何一支測試看得到分歧**。
 * 更糟的是路口轉向那一支寫成
 *     assert.match(here, /rocYear >= 90 && rocYear <= 200/)
 * ——它斷言的是**某一種實作的原始碼長相**，不是行為。結果是：想把三支同步回
 * 同一份程式，反而會踩紅這支測試。守門測試從「防止分歧」變成「鎖住分歧」。
 *
 * 所以改成這樣：
 *   1. 這份契約檔在三支裡逐位元相同（用 CONTRACT_SHA256 互相釘住）。
 *   2. 每一支各自把自己的實作跑過契約裡的每一筆，對不上就紅。
 *   3. 任何一支改了實作 → 它自己的測試紅。
 *      任何一支改了契約 → 那一支的 checksum 對不上而紅。
 *   4. 全程不跨包引用檔案，解壓後每一包都能獨立跑。
 *
 * 要改行為時的正確做法：三支的契約檔一起改、CONTRACT_SHA256 一起換、實作一起改。
 * 只改一支一定會紅——這正是我們要的。
 */

/** 契約內容的 SHA-256（本檔案自 `export const CASES` 起算之前的整份檔案位元組）。 */
export const CONTRACT_VERSION = "2026-09-01";

/*
 * 判定規則（三支一致）：
 *   ・先做 NFKC 正規化、去掉所有空白、轉大寫
 *   ・形狀必須是 <2～4 碼數字>Q<1～4>
 *   ・年份**以數值判定，不看位數**（Number() 會吃掉前導零，0115 就是 115）
 *       民國 90～200      → 直接使用
 *       西元 2001～2111   → 減 1911 換成民國年
 *       其餘              → range
 *   ・儲存值一律是民國年寫法，且必須與 normalizeSurveyPeriod() 的結果相同
 */
export const CASES = [
  /* ── 民國年下界／上界 ───────────────────────────── */
  ["90Q1", "ok", "90Q1"],
  ["90Q4", "ok", "90Q4"],
  ["99Q2", "ok", "99Q2"],
  ["100Q3", "ok", "100Q3"],
  ["115Q1", "ok", "115Q1"],
  ["200Q4", "ok", "200Q4"],
  ["89Q1", "range", ""],
  ["89Q4", "range", ""],
  ["201Q1", "range", ""],
  ["201Q3", "range", ""],
  ["201Q4", "range", ""],
  ["999Q1", "range", ""],

  /* ── 西元年下界／上界，一律換算成民國年 ─────────── */
  ["2001Q1", "ok", "90Q1"],
  ["2010Q2", "ok", "99Q2"],
  ["2010Q4", "ok", "99Q4"],
  ["2011Q3", "ok", "100Q3"],
  ["2025Q4", "ok", "114Q4"],
  ["2026Q1", "ok", "115Q1"],
  ["2111Q4", "ok", "200Q4"],
  ["2000Q1", "range", ""],
  ["1990Q2", "range", ""],
  ["2112Q1", "range", ""],
  ["2112Q3", "range", ""],
  ["9999Q1", "range", ""],

  /*
   * ── 補零的四碼民國年 ─────────────────────────────
   * 季度欄是自由文字，使用者把民國 115 打成 0115 是很自然的事。
   * 舊版依「位數」判定，四碼一律當西元，於是回一句
   * 「年份超出可換算範圍：民國年請填 90～200」——但 0115 就是 115，
   * 訊息與事實矛盾。而共用的 normalizeSurveyPeriod() 一直都把它算成 115Q1，
   * 等於檢查與正規化兩支對同一個字串有兩種看法。改以數值判定就一致了。
   */
  ["0090Q1", "ok", "90Q1"],
  ["0115Q1", "ok", "115Q1"],
  ["0115Q4", "ok", "115Q4"],
  ["0200Q2", "ok", "200Q2"],
  ["0089Q1", "range", ""],
  ["0201Q1", "range", ""],

  /*
   * ── 全形與夾空白 ─────────────────────────────────
   * 從 Excel、Word 或 PDF 複製貼上時很常帶進全形數字或全形 Ｑ，
   * 手打時也常在中間多一個空白。三支必須一視同仁地收下來。
   */
  ["１１５Ｑ１", "ok", "115Q1"],
  ["１１５Q1", "ok", "115Q1"],
  ["115Ｑ1", "ok", "115Q1"],
  ["１１５q１", "ok", "115Q1"],
  ["115 Q1", "ok", "115Q1"],
  ["115\tQ1", "ok", "115Q1"],
  ["1 1 5 Q 1", "ok", "115Q1"],
  ["2026 Q1", "ok", "115Q1"],
  [" 115Q1 ", "ok", "115Q1"],
  ["115q1", "ok", "115Q1"],

  /* ── 形狀本身就不對 ─────────────────────────────── */
  ["115Q0", "format", ""],
  ["115Q5", "format", ""],
  ["115Q", "format", ""],
  ["115", "format", ""],
  ["Q1", "format", ""],
  ["", "format", ""],
  ["   ", "format", ""],
  ["abc", "format", ""],
  ["115-Q1", "format", ""],
  ["115/Q1", "format", ""],
  ["115M1", "format", ""],
  ["115Q1Q1", "format", ""],
  ["1Q1", "format", ""],
  ["11511Q1", "format", ""],
];

/**
 * 把契約跑過一支實作。三支的測試都呼叫這一支，斷言方式也就一致。
 *
 * @param {(input: string) => { ok: boolean, key: string, reason?: string }} check
 *        受測的 checkSurveyPeriodInput
 * @param {(input: string) => string} normalize
 *        同一支的 normalizeSurveyPeriod；放行時儲存值必須與它一致，
 *        否則同一季會出現兩種寫法（這正是整輪修正要消滅的問題）
 * @returns {string[]} 不合契約的說明；空陣列代表全數通過
 */
export function runContract(check, normalize) {
  const problems = [];
  for (const [input, expect, key] of CASES) {
    let result;
    try {
      result = check(input);
    } catch (error) {
      problems.push(`${JSON.stringify(input)} 丟出例外：${error && error.message}`);
      continue;
    }
    if (expect === "ok") {
      if (!result.ok) {
        problems.push(
          `${JSON.stringify(input)} 應放行，實際被擋下（reason=${result.reason}）`,
        );
        continue;
      }
      if (result.key !== key)
        problems.push(
          `${JSON.stringify(input)} 應存成 ${key}，實際存成 ${result.key}`,
        );
      /* 放行時的儲存值必須與正規化結果相同，否則會產生第二種寫法 */
      if (normalize && normalize(input) !== result.key)
        problems.push(
          `${JSON.stringify(input)} 的儲存值 ${result.key} 與 normalizeSurveyPeriod() 的 ` +
            `${normalize(input)} 不一致——同一季會出現兩種寫法`,
        );
      continue;
    }
    if (result.ok) {
      problems.push(
        `${JSON.stringify(input)} 應以 ${expect} 擋下，實際放行並存成 ${result.key}`,
      );
      continue;
    }
    if (result.reason !== expect)
      problems.push(
        `${JSON.stringify(input)} 應判定為 ${expect}，實際是 ${result.reason}`,
      );
  }
  return problems;
}
