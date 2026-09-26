"use client";
/*
 * ══════════════════════════════════════════════════════════════════════
 *  NumberField — 三支程式共用的數字輸入框（**逐位元相同**）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 這個檔案在三支程式裡必須**一字不差**：
 *   路口轉向       lib/number-field.tsx
 *   全日交通量     app/number-field.tsx
 * 各專案的 tests/number-field-contract.mjs 會比對雜湊值。
 * （交通服務水準是原生 JS 的非受控輸入，沒有這個毛病，也沒有這個檔案。）
 *
 * ── 這一支在修什麼（使用者 2026-09-21 回報）─────────────────────────
 *
 * 使用者原話：
 *   「我不小心把路口a和路口b角度都設為0度，然後就切換到B路段……
 *     就集體無法輸入除了0以外的數字了」
 *
 * 他形容的「集體無法輸入」是**真的**，而且與兩個角度相同**無關**——
 * 那是 React 受控數字輸入框的經典陷阱：
 *
 *     value={approach.angle}                       // 一個 number
 *     onChange={(e) => set(Number(e.target.value))} // Number("") === 0
 *
 * 使用者把欄位按到空的那一刻，`e.target.value` 是 `""`，`Number("")` 是 **0**，
 * 於是 state 變成 0，React 立刻把 `"0"` 寫回輸入框，**游標被推到第 0 位**。
 * 接著他打 9，得到的是 `"90"` 不是 `"9"`；打 45 得到 `"045"`；
 * 打 1809 得到 `"1809"`——看起來就像「除了 0 以外什麼都打不進去」。
 * 已用 Playwright 逐鍵重現：`090`、`045`、`1809` 三組都復現。
 *
 * ⚠️ 用 Ctrl+A 全選再打**不會**重現（選取範圍讓那一個 0 被蓋掉），
 *   所以第一次寫的探針全綠。真實使用者是按 Backspace 的。
 *   **任何守門測試都必須逐鍵輸入，不可以用 fill() 或 Ctrl+A。**
 *
 * ── 這一支怎麼修 ───────────────────────────────────────────────────
 *
 * 聚焦期間**以使用者打的字串為準**，不把 state 的數字寫回去；
 * 只有在字串真的解析得出數字時才往上送。離開欄位時字串是空的或看不懂，
 * 就退回上一個有效值——**不是 0**。0 是一個會被存進檔案、會被抄進報告的
 * 真實數值，不可以拿它當「沒有輸入」的替身。
 *
 * ⚠️ 不要「順手」改回 value={number}：那一行就是 bug 本身。
 */
import { useState, type ReactNode } from "react";

export type NumberFieldProps = {
  /**
   * 目前存著的值。
   *
   * null 或 NaN ＝「這一格沒有值」，畫面顯示空白**而不是 0 或 NaN**。
   * （會用到的例子：車種當量的「跟隨計畫預設」狀態。）
   */
  value: number | null;
  /** 使用者打出一個看得懂的數字時呼叫。空白與看不懂的字**不會**呼叫。 */
  onCommit: (value: number) => void;
  /** 允許的範圍（含端點）。超出時不擋輸入，改為在欄位下方寫出提醒。 */
  min?: number;
  max?: number;
  step?: number | string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** 測試用識別字。 */
  testId?: string;
  /**
   * 範圍以外時要說的話。回傳 null ＝沒問題。
   *
   * ⚠️ 預設**不擋、不改值**，只提醒。使用者 2026-09-21 的角度欄位就是例子：
   *   1809 度在數學上等於 9 度（系統一律取模 360），不會算錯，
   *   但它顯然是打錯的，存進去會一路帶到備份與報告裡。
   *   自動改成 9 也不行——那是替使用者做決定，而且他不會發現。
   */
  warn?: (value: number) => string | null;
  /** 欄位底下的附加說明（例如「東北方（自動）」）。 */
  hint?: ReactNode;
};

export function NumberField(props: NumberFieldProps) {
  /*
   * null ＝沒有在編輯，畫面顯示 props.value；
   * 字串 ＝正在編輯，畫面顯示使用者打的那一串（含空字串）。
   */
  const [draft, setDraft] = useState<string | null>(null);
  /*
   * ⚠️ **外面把值換掉時，正在編輯的字串要丟掉**（2026-09-23 由 e2e 抓到）。
   *
   *   情境：使用者在當量表格上打了 9，**沒有點別的地方**就去換「係數套用範圍」
   *   的下拉。表格應該換成新範圍的值，但這一格仍然顯示 9——
   *   看起來就像新範圍的係數是 9。使用者會照著它做決定。
   *
   *   做法：記住「我自己送出去的那個值」。props.value 與它一致＝這是我自己
   *   造成的更新，草稿留著（不然邊打邊被自己清掉）；不一致＝值是**外面**換的，
   *   草稿作廢。
   *
   *   ⚠️ 不要改用 useEffect：那會多一次 render，使用者打字時看得到閃動。
   *     在 render 期間同步同一個元件的狀態是 React 官方認可的寫法。
   */
  const [synced, setSynced] = useState<number | null>(props.value);
  if (props.value !== synced) {
    setSynced(props.value);
    if (draft !== null) setDraft(null);
  }
  /*
   * ⚠️ `String(value)` 會把 NaN 印成字串 "NaN" 給使用者看。
   *   沒有值的時候一律是空字串。
   */
  const settled =
    props.value === null || props.value === undefined || Number.isNaN(props.value)
      ? ""
      : String(props.value);
  const shown = draft === null ? settled : draft;
  const parsed = Number(shown);
  const usable = shown.trim() !== "" && Number.isFinite(parsed);
  const warning = usable && props.warn ? props.warn(parsed) : null;
  const outOfRange =
    usable &&
    ((props.min !== undefined && parsed < props.min) ||
      (props.max !== undefined && parsed > props.max));
  return (
    <>
      <input
        type="number"
        step={props.step}
        /*
         * ⚠️ min／max 只寫在屬性上是**擋不住**的：使用者用鍵盤打進去照樣進得來
         *   （瀏覽器只在按上下箭頭與表單送出時才管），所以下面另外寫提醒。
         */
        min={props.min}
        max={props.max}
        disabled={props.disabled}
        className={props.className}
        aria-label={props.ariaLabel}
        data-testid={props.testId}
        value={shown}
        onFocus={function () {
          if (draft === null) setDraft(settled);
        }}
        onChange={function (event) {
          const text = event.target.value;
          setDraft(text);
          /*
           * ⚠️ 空字串**不送**。送出去就等於 Number("")===0，
           *   0 會被寫回 value、游標被推到最前面——那正是這支要修的 bug。
           */
          if (text.trim() === "") return;
          const next = Number(text);
          if (!Number.isFinite(next)) return;
          /*
           * 先記下「我送出去的是哪一個值」，上面那段比對才分得出
           * 「這次更新是我造成的」與「值是外面換掉的」。
           */
          setSynced(next);
          props.onCommit(next);
        }}
        onBlur={function () {
          /*
           * 離開時字串是空的或看不懂 → 退回上一個有效值（畫面會自己顯示
           * props.value），**不是 0**。
           */
          setDraft(null);
        }}
      />
      {props.hint ? <small>{props.hint}</small> : null}
      {outOfRange ? (
        <small className="warning-text" data-testid="number-field-range">
          {`超出允許範圍（${props.min ?? "不限"}～${props.max ?? "不限"}），請確認是不是打錯了。`}
        </small>
      ) : null}
      {warning ? (
        <small className="warning-text" data-testid="number-field-warning">
          {warning}
        </small>
      ) : null}
    </>
  );
}
