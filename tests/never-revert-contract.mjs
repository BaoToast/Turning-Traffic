/*
 * ══════════════════════════════════════════════════════════════════════
 *  不可回頭清單（三支程式共用，**逐位元相同**）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-21 指示：
 *   「請確保日後不論哪個 AI 做維護……都能清楚知道這 4 個名詞，
 *     以及維護上所有大大小小踩過的雷，不要把修對的事情改回錯的」
 *
 * 這個檔案在三支程式裡必須**一字不差**：
 *   路口轉向       tests/never-revert-contract.mjs
 *   全日交通量     tests/never-revert-contract.mjs
 *   交通服務水準   never-revert-contract.mjs
 * 各專案的 never-revert.test.mjs 會比對 SHA-256。
 *
 * ── 這份清單在防什麼 ─────────────────────────────────────────────────
 *
 * 這個系統由多個 AI 輪流維護（Claude 修 → GPT 複查發布 → Claude 二次複查）。
 * 反覆發生的事故不是「改壞了新功能」，而是**把已經修對的事情改回錯的**：
 * 註解過期、某一支的規則被「順手統一」成另一支的、使用者明確取消過的
 * 功能又冒出來。這些都不會有人報錯，只會在下一份報告裡出現錯的數字。
 *
 * ⚠️ 每一列**盡量**要有「錯誤說法的關鍵字」（`banned`），掃描守門才抓得到；
 *   關鍵字寫的是**錯的那一版**會出現的字樣，不是對的那一版。
 *   ⚠️ 但很多條**沒有辦法用字串掃**（例如「某個值要跟著備份走」——
 *   錯的那一版的特徵是「少了一行」，而少了什麼字是掃不到的）。
 *   那幾條 `banned` 是空陣列，由各自專屬的守門測試負責，
 *   `never-revert.test.mjs` 對它們不做任何事。
 *   **不要為了讓每一列都有關鍵字而編一個出來**：編出來的關鍵字要不是
 *   永遠命不中（等於沒有），就是會誤傷正常用語（於是有人把守門關掉）。
 * ⚠️ `banned` 的字樣要與程式裡實際會出現的**一字不差**，異體字也算數。
 *   2026-09-23 實際踩到：第 7 條寫「級以下路段占比」（占 U+5360），
 *   而程式與畫面一律用「佔」（U+4F54），於是那一條**永遠不可能命中**，
 *   而清單看起來有在守。新增 banned 字樣時請貼上程式裡真正的那一段。
 * ⚠️ scope 指的是「這一條適用於哪幾支程式」。不適用的程式會略過該列，
 *   但**仍然要保留這個檔案的完整內容**——三份逐位元相同是刻意的，
 *   讓任何一支的維護者都看得到另外兩支踩過的雷。
 */

/** 三支程式的代號。 */
export const PROGRAMS = ["turning", "daily", "los"];

/**
 * @typedef {object} NeverRevertEntry
 * @property {number} id
 * @property {string} fact      已經定案的事實
 * @property {string} decided   定案時間
 * @property {string[]} scope   適用的程式代號
 * @property {string[]} banned  **錯誤說法**的關鍵字（掃描原始碼用；空陣列＝無法以字串掃描）
 * @property {string} damage    改回去會怎樣
 */

/** @type {NeverRevertEntry[]} */
export const NEVER_REVERT = [
  {
    id: 1,
    fact: "四個統計範圍：上午尖峰／下午尖峰／全調查時段／全調查時段尖峰，各有各的意義",
    decided: "2026-09-10（改名）",
    scope: ["turning", "daily", "los"],
    banned: ["全日尖峰小時"],
    damage: "使用者的核心術語被混淆；「全調查時段」與「全調查時段尖峰」是兩件事",
  },
  {
    id: 2,
    fact: "「全調查時段尖峰」不要求 24 小時——是在調查涵蓋的時段內挑最大一小時",
    decided: "v2.1.64",
    scope: ["turning", "daily"],
    banned: ["只有 24 小時的調查檔", "不足 24 小時時整組留空"],
    damage: "4 小時的調查檔會失去一個本來就有值的統計範圍",
  },
  {
    id: 3,
    fact: "全日交通量支援不足 24 小時：all 與 allPeak 都不設 24 小時門檻",
    decided: "—",
    scope: ["daily"],
    banned: [],
    damage: "部分時段案件的整組數值會消失",
  },
  {
    id: 23,
    fact: "全日交通量的時段鍵是 allPeak（v20.82 由 peak24 改名），讀取端的 peak24 遷移不可以拿掉",
    decided: "2026-09-23",
    scope: ["daily"],
    banned: [],
    damage: "既有的結論草稿範本套用之後，「全調查時段尖峰」那一項會安靜地消失",
  },
  {
    id: 4,
    fact: "側欄的「24小時PCU」刻意不隨資料浮動",
    decided: "—",
    scope: ["daily"],
    banned: [],
    damage: "同一支程式在不同計畫長出不同側欄，更難找",
  },
  {
    id: 5,
    fact: "路口轉向的 DAY 是歷史鍵名，在存檔結構裡，不改名",
    decided: "2026-09-21",
    scope: ["turning"],
    banned: [],
    damage: "所有既有備份都需要資料遷移",
  },
  {
    id: 6,
    fact: "「大車」＝所有非機車、非小型車（含未歸類的自訂車種）；與車種「大型車」是兩件事",
    decided: "2026-09-15",
    scope: ["daily"],
    banned: ["大車只算大型車與特種車"],
    damage: "同一批資料會算出 23.8% 而不是 42.7%",
  },
  {
    id: 7,
    fact:
      "使用者 2026-09-20 取消的是「讓 X 級以下路段占比**變成一個可選項**」" +
      "那次改動（已逐位元復原），**不是那個指標本身**——" +
      "指標名稱本來就跟著「判定標準 → 三段分法」的分界動（分界設 E 就叫" +
      "「E 級以下路段佔比」），那是原本就有、現在也還在的行為，不要當成殘留刪掉",
    decided: "2026-09-20",
    scope: ["los"],
    /*
     * ⚠️ 這一條**沒有**可掃的關鍵字，原因寫在檔頭：
     *   原本寫的是「級以下路段占比」（占），而程式裡一律是「佔」，
     *   永遠命不中；而且就算改成「佔」，那是**正常功能**的字樣，
     *   掃到反而會把對的程式判成錯的。
     *   真正在守這件事的是「趨勢圖指標名稱要跟著分界動」的既有測試。
     */
    banned: [],
    damage:
      "把還在用的指標當成殘留刪掉，或把「可選」那一版又加回來；" +
      "兩個方向都違背使用者 2026-09-20 的裁示",
  },
  {
    id: 8,
    fact: "全日交通量的站號守門不可改鬆或移除（三支刻意不一致）",
    decided: "—",
    scope: ["daily"],
    banned: ["三支統一站號守門"],
    damage: "委託案的實際站號會混進原始碼",
  },
  {
    id: 9,
    fact: "路口轉向不做方向成對檢查（它的支線不是一條路的兩個相反方向）",
    decided: "2026-09-20",
    scope: ["turning"],
    banned: ["checkArmBearingNames"],
    damage: "角度是使用者自己打的、不是方位詞，會整批誤報",
  },
  {
    id: 10,
    fact: "上下排版面時釘圖刻意關閉",
    decided: "2026-09-21",
    scope: ["turning", "daily", "los"],
    banned: [],
    damage: "重演 2026-09-10「圖蓋住文字」",
  },
  {
    id: 11,
    fact: "真實調查檔不得放進任何交付包",
    decided: "—",
    scope: ["turning", "daily", "los"],
    banned: [],
    damage: "業主資料外流",
  },
  {
    id: 12,
    fact: "不做 Git 歷史改寫、不重建 repository",
    decided: "—",
    scope: ["turning", "daily", "los"],
    banned: [],
    damage: "發布歷史毀損",
  },
  {
    id: 13,
    fact: "結論草稿「時段一個都不勾」是有效選擇，不可以被補回預設",
    decided: "—",
    scope: ["turning", "daily"],
    banned: [],
    damage: "使用者只要車種組成時，草稿一定夾帶不要的尖峰段落",
  },
  {
    id: 14,
    fact: "不同調查點的交通量不可相加",
    decided: "2026-09-18（X-28）",
    scope: ["daily"],
    banned: [],
    damage: "那個總和不對應任何一條路的實際流量",
  },
  {
    id: 15,
    fact: "駛出合計＝駛入合計，兩者不可相加；四條支線的「雙向合計」相加也是兩倍",
    decided: "2026-09-21",
    scope: ["turning"],
    banned: [],
    damage: "報告上的路口總量會變成兩倍",
  },
  {
    id: 16,
    fact: "跨計畫比較三支都已移除，不要加回",
    decided: "2026-09-09",
    scope: ["turning", "daily", "los"],
    banned: [],
    damage: "使用者明確說三支都不需要",
  },
  {
    id: 17,
    fact: "全日交通量的「路段排名」已移除",
    decided: "2026-09-09",
    scope: ["daily"],
    banned: [],
    damage: "使用者明確授權移除的唯一一項",
  },
  {
    id: 18,
    fact: "PCU 覆寫優先順序三支同一套（季度×調查點 → 季度×全點 → 全季度×調查點 → 全計畫預設）",
    decided: "—",
    scope: ["turning", "daily", "los"],
    banned: [],
    damage: "三支會算出不同的 PCU",
  },
  {
    id: 19,
    fact: "三段分法預設 順暢 A、B／尚可 C、D／壅塞 E、F，可依計畫／季別／路段覆寫",
    decided: "—",
    scope: ["los"],
    banned: [],
    damage: "既有報告的分段標準被換掉",
  },
  {
    id: 20,
    fact: "受控數字輸入框一律走 NumberField；不可以寫 value={數字} ＋ Number(e.target.value)",
    decided: "2026-09-23",
    scope: ["turning", "daily"],
    banned: [],
    damage: "欄位被按空時黏一個 0，使用者形容成「集體無法輸入除了 0 以外的數字」",
  },
  {
    id: 21,
    fact: "與某個維度無關的異常提醒，任何選擇都要列出來（欄位是空的就不參與該項篩選）",
    decided: "2026-09-23",
    scope: ["daily", "los"],
    banned: [],
    damage: "類型標籤說有 N 筆、表格只列得出 M 筆，使用者以為資料被吃掉",
  },
  {
    id: 22,
    fact: "「顯示調查日期」跟人走（瀏覽器儲存／個人全部計畫包），不跟單一計畫備份走",
    decided: "2026-09-21",
    scope: ["turning", "daily", "los"],
    banned: [],
    damage: "併入別人的單一計畫備份會靜默翻掉使用者自己的開關",
  },
];

/** 這一支程式要檢查的條目。 */
export function entriesFor(program) {
  if (!PROGRAMS.includes(program))
    throw new Error(`未知的程式代號：${program}`);
  return NEVER_REVERT.filter((entry) => entry.scope.includes(program));
}
