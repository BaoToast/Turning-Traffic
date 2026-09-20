/*
 * ══════════════════════════════════════════════════════════════════════
 *  方向名稱「成不成對」：三支程式共用的判定契約
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ **這個檔案在三支程式裡逐位元相同。** 改了其中一份就要三份一起改，
 *   否則同一個名稱在三支會得到不同的結論——那比沒有這個檢查更糟，
 *   因為使用者會以為三支對不起來是資料有問題。
 *   （與 `period-input-contract.mjs` 同一種做法，那一支已經用 SHA-256 釘住。）
 *
 * 使用者 2026-09-20 定的規則：
 *   「其中『北』對應『南』，『東』對應『西』，不管方向後面 + 了什麼字」
 *
 * 呼叫端要提供一個 `judge(nameA, nameB)`，回傳
 *   { kind: "paired" | "mismatched" | "not-applicable", ... }
 */

/**
 * 契約案例表。每一列是 [方向1, 方向2, 期望的 kind, 這一列在防什麼]。
 *
 * ⚠️ 「在防什麼」不是裝飾：日後有人想放寬規則時，要先能回答
 *   「那這一列怎麼辦」。沒有理由的案例最後一定會被刪掉。
 */
export const DIRECTION_PAIR_CASES = [
  /* ── 使用者實際會打的寫法 ── */
  ["北上", "南下", "paired", "使用者原本就在用的寫法"],
  ["北行", "南行", "paired", "使用者明講也可能用「行」"],
  ["東行", "西行", "paired", "東西向同理"],
  ["往東", "往西", "paired", "前面加「往」"],
  ["東", "西", "paired", "只寫一個字"],
  ["南", "北", "paired", "順序顛倒也算成對"],
  ["東向", "西向", "paired", "「向」結尾"],

  /* ── 要報出來的那一種（使用者舉的例子） ── */
  ["北上", "西行", "mismatched", "使用者舉的例子：北對上西"],
  ["北上", "東行", "mismatched", "同上，另一個方位"],
  ["南下", "西行", "mismatched", "南對上西"],
  ["北上", "北下", "mismatched", "兩邊同一個方位，八成是複製後忘了改"],
  ["東", "東", "mismatched", "完全一樣"],

  /* ── 複合方位 ── */
  ["東北", "西南", "paired", "複合方位也要成對"],
  ["西北", "東南", "paired", "另一組複合方位"],
  [
    "東北",
    "西北",
    "mismatched",
    "⚠️ 複合方位要整組比：切成單字的話「東」對「西」會誤判成成對",
  ],
  ["東北", "西", "mismatched", "複合方位對單一方位"],

  /* ── 不表示意見（誤報一次，使用者就會開始忽略所有提醒） ── */
  ["方向1", "方向2", "not-applicable", "系統預設值，還沒命名"],
  ["往台北", "往高雄", "not-applicable", "⚠️ 地名裡有方位字，不可以誤判"],
  ["台北方向", "高雄方向", "not-applicable", "同上"],
  ["北屯路", "文心路", "not-applicable", "⚠️ 路名裡有方位字"],
  ["南投端", "彰化端", "not-applicable", "⚠️ 縣市名裡有方位字"],
  ["北上", "往竹科", "not-applicable", "一邊是方位詞、一邊不是——無從判斷誰錯"],
  ["", "", "not-applicable", "空字串"],
  ["北上", "", "not-applicable", "只有一邊有值"],

  /* ── 寫法上的雜訊 ── */
  ["北 上", "南 下", "paired", "中間有空白"],
  ["北－上", "南－下", "paired", "中間有破折號"],
  ["Ｎ", "Ｓ", "not-applicable", "全形英文字母不是中文方位字，不表示意見"],
];

/**
 * 用同一張案例表驗一個實作。
 *
 * @param judge  (a, b) => { kind }
 * @param report (label, ok, detail) 由呼叫端決定怎麼報（assert 或印出來）
 */
export function checkDirectionPairContract(judge, report) {
  /*
   * ⚠️ 前置檢查：案例表真的有內容，而且三種 kind 都有。
   *   少了這一條，案例表被清空時這一支會安靜地全部通過。
   */
  const kinds = new Set(DIRECTION_PAIR_CASES.map((row) => row[2]));
  report(
    "前置：契約案例表有內容，而且三種結論都有案例",
    DIRECTION_PAIR_CASES.length >= 20 &&
      kinds.has("paired") &&
      kinds.has("mismatched") &&
      kinds.has("not-applicable"),
    `${DIRECTION_PAIR_CASES.length} 列，kinds=${[...kinds].join("／")}`,
  );

  for (const [a, b, expected, why] of DIRECTION_PAIR_CASES) {
    const actual = judge(a, b)?.kind;
    report(
      `「${a || "(空)"}」／「${b || "(空)"}」→ ${expected}`,
      actual === expected,
      `實際是 ${actual}；這一列在防：${why}`,
    );
  }
}
