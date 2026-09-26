/*
 * ══════════════════════════════════════════════════════════════════
 *  X-66：匯入時「重複」的東西一律要出聲
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-17：
 *   「另外兩支程式有這類問題嗎?三支程式是否都是讀取標籤，然後欄位如果有換位，
 *     都能讀到，如果有重複，也能指出異常讓使用者去確認的功能嗎?」
 *
 * 查出來這一支有三種重複是**完全安靜**的：
 *   一、兩個欄群都讀到同一個「路口編號：A」→ 兩支支線的量被加成一支，
 *       畫面上只看得到一支 A。
 *   二、同一個欄群裡兩欄完全同名 → 同一個（車種×流向）被重複計入。
 *   三、同一支支線裡同一個時距重複 → 後一列**蓋掉**前一列，
 *       而且 sourceRows 一起被蓋，逐格追溯會指到錯的列。
 *
 * 規則與交通服務水準（X-65）相同：只指出，不替使用者挑、不平均、不相加。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**每一條都要有一份「正常檔案不可以誤報」的對照**。
 *     只驗「壞檔案會叫」的話，一個「一律叫」的實作也會全綠，
 *     而那會讓使用者學會忽略所有警告——比不叫更糟。
 * 二、時距重複那一條**特別危險**：intervalMap 本來就是用「開始分鐘」當鍵，
 *     好讓同一張表的各支線欄群併成同一列。判斷範圍若寫成「這張工作表」，
 *     每一份多支線檔案都會被誤報。所以正常檔案那一份**故意做成四支支線、
 *     時距完全相同**，寫錯範圍的話它一定會紅。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectWorkbook } from "../lib/traffic.ts";
import XLSX from "xlsx";

type Tweak = {
  /** 第二個欄群也寫「路口編號：路口A」 */
  duplicateArmCode?: boolean;
  /** 第一個欄群的第二個車種欄名改成與第一個相同 */
  duplicateColumnLabel?: boolean;
  /** 第一個欄群多一列時間與第一列相同 */
  duplicateInterval?: boolean;
};

function turningFile(fileName: string, tweak: Tweak = {}) {
  const rows: unknown[][] = Array.from({ length: 14 }, () => Array(56).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00", "08:00~08:15"];
  for (let approach = 0; approach < 4; approach++) {
    const base = approach * 14;
    rows[1][base] = "站號：11017T14-02";
    rows[1][base + 4] = "日期：115年01月26日 (平日)";
    rows[2][base] = "站名：測試路－驗證路口";
    const code =
      tweak.duplicateArmCode && approach === 1
        ? "A"
        : String.fromCharCode(65 + approach);
    rows[3][base] = `路口編號：路口${code}`;
    rows[4][base] = "時間";
    vehicles.forEach((vehicle, vi) => {
      /* 第二個車種欄名改成與第一個相同＝調查表打錯字（多貼了一欄）。 */
      const label =
        tweak.duplicateColumnLabel && approach === 0 && vi === 1 ? vehicles[0] : vehicle;
      rows[4][base + 1 + vi * 3] = label;
      movements.forEach((mv, mi) => {
        rows[5][base + 1 + vi * 3 + mi] = mv;
      });
    });
    times.forEach((time, ri) => {
      rows[6 + ri][base] = time;
      for (let c = 1; c <= 12; c++) rows[6 + ri][base + c] = 10;
    });
    /* 多一列，時間與第一列相同。 */
    if (tweak.duplicateInterval && approach === 0) {
      rows[6 + times.length][base] = times[0];
      for (let c = 1; c <= 12; c++) rows[6 + times.length][base + c] = 99;
    }
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: 4 }).flatMap((_, a) =>
    vehicles.map((__, vi) => ({
      s: { r: 4, c: a * 14 + 1 + vi * 3 },
      e: { r: 4, c: a * 14 + 3 + vi * 3 },
    })),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "平日");
  return new File([XLSX.write(wb, { type: "array", bookType: "xlsx" })], fileName);
}

const find = (warnings: string[], re: RegExp) => warnings.find((w) => re.test(w));

/* ══ 前置：正常檔案一句都不可以叫 ══════════════════════════════ */
test("⚠️ 正常的四支支線檔案，三種重複警告一句都不可以出現", async () => {
  const preview = await inspectWorkbook(turningFile("正常.xlsx"));
  /*
   * 這一份刻意是**四支支線、時距完全相同**——時距重複的判斷範圍若寫成
   * 「這張工作表」而不是「這一個欄群」，這裡一定會紅。
   */
  assert.equal(
    find(preview.warnings, /出現不只一次/),
    undefined,
    `正常檔案誤報支線代碼重複：${preview.warnings.join(" ｜ ")}`,
  );
  assert.equal(
    find(preview.warnings, /完全相同的欄名/),
    undefined,
    `正常檔案誤報欄名重複：${preview.warnings.join(" ｜ ")}`,
  );
  assert.equal(
    find(preview.warnings, /時距重複/),
    undefined,
    `正常檔案誤報時距重複：${preview.warnings.join(" ｜ ")}`,
  );
  /* 前置：這份檔案真的讀得出東西，否則上面三條全部恆真。 */
  assert.ok(preview.columns.length > 0, "測試用的正常檔案根本沒讀出資料欄");
});

/*
 * 2026-09-18 使用者裁示（F-11）：三種重複一律**擋下不寫入**（不再是警告後照樣相加），
 * 而且要寫到「哪一張表、哪幾欄」。反面：把 blockReason 拿掉（回到只警告）→ 下面
 * 三條「blockReason 要有值」全紅。
 */
/* ══ 一、支線代碼撞號 ══════════════════════════════════════════ */
test("⚠️ 兩個欄群讀到同一個「路口編號：A」時要擋下，並說出是哪一張表的哪幾欄", async () => {
  const preview = await inspectWorkbook(
    turningFile("撞號.xlsx", { duplicateArmCode: true }),
  );
  assert.ok(preview.blockReason, `沒有擋下：${preview.warnings.join(" ｜ ")}`);
  assert.match(preview.blockReason!, /不會寫入/, "要明講這一份不會寫入");
  assert.match(preview.blockReason!, /「A」/, "要說出是哪一個代碼");
  assert.match(preview.blockReason!, /第 [A-Z]+～[A-Z]+ 欄 與 .*第 [A-Z]+～[A-Z]+ 欄/, "要說出兩個欄群各在哪幾欄");
  assert.match(preview.blockReason!, /路口編號/, "要指到原始檔的哪一個欄位（路口編號）");
  assert.match(preview.blockReason!, /重新匯入/, "要告訴使用者修正後怎麼做");
  /* 預覽列的警告區也要看得到同一句 */
  assert.ok(find(preview.warnings, /不會寫入/), "警告區沒有同一句");
});

/* ══ 二、同一個欄群裡兩欄同名 ══════════════════════════════════ */
test("⚠️ 同一支支線出現完全相同的欄名時要擋下，並說出是哪一欄", async () => {
  const preview = await inspectWorkbook(
    turningFile("同名欄.xlsx", { duplicateColumnLabel: true }),
  );
  assert.ok(preview.blockReason, `沒有擋下：${preview.warnings.join(" ｜ ")}`);
  assert.match(preview.blockReason!, /完全相同的欄名/);
  assert.match(preview.blockReason!, /表頭「/, "要說出是哪一個表頭");
  assert.match(preview.blockReason!, /不會相加/, "要說明系統不替調查資料做決定");
});

/* ══ 三、同一支支線裡時距重複 ══════════════════════════════════ */
test("⚠️ 同一支支線裡時距重複時要擋下，並說出是哪一格", async () => {
  const preview = await inspectWorkbook(
    turningFile("時距重複.xlsx", { duplicateInterval: true }),
  );
  assert.ok(preview.blockReason, `沒有擋下：${preview.warnings.join(" ｜ ")}`);
  assert.match(preview.blockReason!, /時距重複/);
  assert.match(preview.blockReason!, /07:00/, "要說出是哪一個時距");
  assert.match(preview.blockReason!, /時間欄/, "要指到原始檔的哪一欄");
});

test("前置：正常檔案不可以被擋下（blockReason 必須是空的）", async () => {
  const preview = await inspectWorkbook(turningFile("正常.xlsx"));
  assert.equal(preview.blockReason, undefined, preview.blockReason);
});

/*
 * ── 反證（2026-09-17 實跑）────────────────────────────────────
 * 把 lib/traffic.ts 裡三個 duplicate* 的收集與警告整組拿掉：
 *   ✔ 正常的四支支線檔案，三種重複警告一句都不可以出現
 *   ✖ 兩個欄群讀到同一個「路口編號：A」時要說出來
 *   ✖ 同一支支線出現完全相同的欄名時要說出來
 *   ✖ 同一支支線裡時距重複時要說出來
 * 三條該紅的紅、前置那條照舊綠，確定不是恆真。
 *
 * 另外單獨試過「把時距重複的判斷範圍改成整張工作表」：
 *   ✖ 正常的四支支線檔案…（誤報 07:00~07:15 等 5 個時距）
 * 證明那一份正常檔案真的擋得住這個寫法。
 */

/*
 * ══════════════════════════════════════════════════════════════════
 *  同一個轉向在畫面上只能有一個中文名字（2026-09-25 第六輪）
 * ══════════════════════════════════════════════════════════════════
 *
 * 第六輪抓到：轉向標籤在專案裡有**三份**——
 *   ・`lib/traffic.ts` 的 `MOVEMENT_LABELS`（through 寫「直進」）
 *   ・`app/traffic-app.tsx` 的 `MOVE_LABELS`（through 寫「直行」）
 *   ・`app/main-filters.ts` 的 `MOVEMENT_CHOICE_LABELS`（through 寫「直行」）
 * 三份都印在畫面上：OD 矩陣與匯出欄名寫「直行」，歷季趨勢的指標名稱
 * 與匯入盤點訊息寫「直進」。手冊六處全寫「直行」。
 * 使用者看到兩個詞，無法確定那是不是兩件不同的事。
 *
 * ⚠️ 守法用「比對每一份與 lib 那一份是否一致」，不是「禁止出現直進」：
 *   解析原始檔的樣式**必須**繼續接受「直進」（別人填的調查表兩種都有），
 *   所以不能整檔禁字。
 */
test("每一份轉向標籤表都必須與 lib 的 MOVEMENT_LABELS 一致", async () => {
  const { MOVEMENT_LABELS, MOVEMENT_KEYS } = await import("../lib/traffic.ts");
  const { MOVEMENT_CHOICE_LABELS } = await import("../app/main-filters.ts");
  for (const key of MOVEMENT_KEYS)
    assert.equal(
      MOVEMENT_CHOICE_LABELS[key],
      MOVEMENT_LABELS[key],
      `主工具列的「${key}」寫「${MOVEMENT_CHOICE_LABELS[key]}」，` +
        `而 lib 寫「${MOVEMENT_LABELS[key]}」——同一個轉向兩個名字`,
    );
  /* 前置檢查：真的比了三個鍵。 */
  assert.equal(MOVEMENT_KEYS.length, 3, "轉向鍵不是三個了？");
});

test("traffic-app 不可以再自己寫一份轉向標籤表", async () => {
  /*
   * 上一支比的是「值一致」，這一支擋的是「又多一份」。
   * 兩份即使今天一致，下一次改名還是會分岔——這就是第六輪那一件事的成因。
   */
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(
    new URL("../app/traffic-app.tsx", import.meta.url),
    "utf8",
  );
  const body = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ");
  assert.doesNotMatch(
    body,
    /const MOVE_LABELS\s*=\s*\{/,
    "traffic-app 又自己寫了一份轉向標籤表。請寫成 " +
      "`const MOVE_LABELS = MOVEMENT_LABELS;`（lib 那一份是唯一來源）",
  );
  assert.match(
    body,
    /const MOVE_LABELS\s*=\s*MOVEMENT_LABELS;/,
    "找不到 `const MOVE_LABELS = MOVEMENT_LABELS;`——這一支的前提不成立了",
  );
});
