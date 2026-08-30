/*
 * ── 判讀不出來時不可以自己編一個 ──
 *
 * 這組測試守住 v2.1.38 修掉的三個「安靜失敗」。三個都不會報錯，
 * 只會給一個看起來像真的的值繼續往下算，使用者永遠不知道出過事。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSurveyType, inspectWorkbook } from "../lib/traffic.ts";
import XLSX from "xlsx";

/* ── 一、資料別只認平日與假日 ── */
test("日期欄括號裡不是平日／假日時，資料別回「待設定」", () => {
  /* 調查表的日期欄常常寫別的東西，舊版會原樣當成資料別 */
  assert.equal(resolveSurveyType({ dateText: "日期：115年06月03日（晴）" }), "待設定");
  assert.equal(resolveSurveyType({ dateText: "日期：115年06月03日（第一天）" }), "待設定");
  assert.equal(resolveSurveyType({ dateText: "日期：115年06月03日（星期日）" }), "待設定");
});

test("正常的平日／假日仍然照舊讀得到（含全形括號與空白）", () => {
  assert.equal(resolveSurveyType({ dateText: "日期：115年01月26日 (平日)" }), "平日");
  assert.equal(resolveSurveyType({ dateText: "日期：115年01月26日（假日）" }), "假日");
  assert.equal(resolveSurveyType({ dateText: "日期：115.01.26 ( 平日 )" }), "平日");
});

test("「待設定」才能被重新匯入接手，假資料別會卡住補救機制", () => {
  /*
   * 這是為什麼一定要回「待設定」而不是別的字串：isSameSurvey 只允許
   * 待設定被有資料別的新匯入接手。若資料別是「晴」，重新匯入同一個檔案
   * 不會覆蓋它，只會多出一筆，趨勢線也被拆成兩條。
   */
  assert.equal(resolveSurveyType({ dateText: "（晴）" }), "待設定");
});

/* ── 二、支線代碼推定要留下記錄 ── */
function turningFile(fileName: string, withArmCode: boolean) {
  const rows: unknown[][] = Array.from({ length: 12 }, () => Array(56).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00", "08:00~08:15"];
  for (let approach = 0; approach < 4; approach++) {
    const base = approach * 14;
    rows[1][base] = "站號：11017T14-02";
    rows[1][base + 4] = "日期：115年01月26日 (平日)";
    rows[2][base] = "站名：測試路－驗證路口";
    if (withArmCode)
      rows[3][base] = `路口編號：路口${String.fromCharCode(65 + approach)}`;
    rows[4][base] = "時間";
    vehicles.forEach((vehicle, vi) => {
      rows[4][base + 1 + vi * 3] = vehicle;
      movements.forEach((mv, mi) => {
        rows[5][base + 1 + vi * 3 + mi] = mv;
      });
    });
    times.forEach((time, ri) => {
      rows[6 + ri][base] = time;
      for (let c = 1; c <= 12; c++) rows[6 + ri][base + c] = 10;
    });
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

test("表頭有路口編號時，不應出現支線代碼的推定警告", async () => {
  const preview = await inspectWorkbook(turningFile("路口_有編號.xlsx", true));
  assert.ok(
    !preview.warnings.some((w) => /依出現順序推定/.test(w)),
    "正常檔案不可以誤報，否則使用者會學會忽略這個警告",
  );
});

test("表頭沒有路口編號時，推定的支線代碼要提醒使用者", async () => {
  const preview = await inspectWorkbook(turningFile("路口_無編號.xlsx", false));
  const warning = preview.warnings.find((w) => /依出現順序推定/.test(w));
  assert.ok(warning, "支線代碼是跨季比對幾何與轉向的鍵，推定時必須說出來");
  assert.match(warning!, /路口編號/, "要說明是哪個欄位讀不到");
  assert.match(warning!, /跨季/, "要說明推定值的後果");
});

/* ── 三、有內容但不是數字的格子要說出來 ── */
test("非數值儲存格會被當成 0，但必須明白告訴使用者", async () => {
  const rows: unknown[][] = Array.from({ length: 12 }, () => Array(20).fill(null));
  rows[1][0] = "站號：11017T14-02";
  rows[1][4] = "日期：115年01月26日 (平日)";
  rows[2][0] = "站名：測試路－驗證路口";
  rows[3][0] = "路口編號：路口A";
  rows[4][0] = "時間";
  ["機車", "小型車", "大型車", "特種車"].forEach((v, vi) => {
    rows[4][1 + vi * 3] = v;
    ["左轉", "直進", "右轉"].forEach((m, mi) => {
      rows[5][1 + vi * 3 + mi] = m;
    });
  });
  ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00", "08:00~08:15"].forEach(
    (t, ri) => {
      rows[6 + ri][0] = t;
      for (let c = 1; c <= 12; c++) rows[6 + ri][c] = 10;
    },
  );
  /* 這兩格有內容但不是數字——舊版靜靜當成 0 輛 */
  rows[6][1] = "-";
  rows[7][2] = "休";
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = ["機車", "小型車", "大型車", "特種車"].map((_, vi) => ({
    s: { r: 4, c: 1 + vi * 3 },
    e: { r: 4, c: 3 + vi * 3 },
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "平日");
  const preview = await inspectWorkbook(
    new File([XLSX.write(wb, { type: "array", bookType: "xlsx" })], "路口_有非數值格.xlsx"),
  );
  const warning = preview.warnings.find((w) => /不是數字/.test(w));
  assert.ok(warning, "「0」與「沒測到」在統計上意義不同，不能默默轉換");
  assert.match(warning!, /「-」|「休」/, "要指出實際是哪些格、原文是什麼");
});

test("全部都是數字時不可以誤報非數值警告", async () => {
  const preview = await inspectWorkbook(turningFile("路口_全數字.xlsx", true));
  assert.ok(!preview.warnings.some((w) => /不是數字/.test(w)));
});


/* ── 四、判斷與寫入必須用同一個運算式 ── */
test("日期格式與布林值的儲存格要真的變成 0，不能存進 epoch 毫秒", async () => {
  /*
   * 這是最容易漏掉的一種：`cellDates: true` 讓日期格的 .v 是 Date 物件，
   * `Number(Date)` 是**有限的** epoch 毫秒，會通過 `|| 0`，一格就把
   * 1,780,444,800,000 輛塞進那個時距，然後進尖峰挑選、PCU 與全日累計。
   * Excel 對「7:00」這種輸入會自動套時間格式，承辦很容易踩到。
   * 只驗警告有沒有出現是不夠的——必須驗實際存進去的值。
   */
  const rows: unknown[][] = Array.from({ length: 12 }, () => Array(20).fill(null));
  rows[1][0] = "站號：11017T14-02";
  rows[1][4] = "日期：115年01月26日 (平日)";
  rows[2][0] = "站名：測試路－驗證路口";
  rows[3][0] = "路口編號：路口A";
  rows[4][0] = "時間";
  ["機車", "小型車", "大型車", "特種車"].forEach((v, vi) => {
    rows[4][1 + vi * 3] = v;
    ["左轉", "直進", "右轉"].forEach((m, mi) => {
      rows[5][1 + vi * 3 + mi] = m;
    });
  });
  ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00", "08:00~08:15"].forEach(
    (t, ri) => {
      rows[6 + ri][0] = t;
      for (let c = 1; c <= 12; c++) rows[6 + ri][c] = 10;
    },
  );
  rows[6][1] = new Date("2026-06-03T00:00:00Z");
  rows[7][2] = true;
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = ["機車", "小型車", "大型車", "特種車"].map((_, vi) => ({
    s: { r: 4, c: 1 + vi * 3 },
    e: { r: 4, c: 3 + vi * 3 },
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "平日");
  const preview = await inspectWorkbook(
    new File([XLSX.write(wb, { type: "array", bookType: "xlsx" })], "路口_日期格.xlsx"),
  );
  const all = preview.intervalRows!.flatMap((row) => row.values);
  const maxValue = Math.max(...all.map(Number));
  assert.ok(
    maxValue <= 1000,
    `不應該有異常大的值，實際最大為 ${maxValue}——日期格被當成 epoch 毫秒了`,
  );
  assert.equal(preview.intervalRows![0].values[0], 0, "日期格應計為 0");
  assert.equal(preview.intervalRows![1].values[1], 0, "布林值應計為 0");
  /* 訊息必須與實際行為一致 */
  const warning = preview.warnings.find((w) => /不是數字/.test(w));
  assert.ok(warning, "要提醒使用者");
  assert.match(warning!, /計為 0 輛/, "訊息說計為 0，實際就必須是 0");
});

test("整欄都是「-」時，警告要歸併同一種原文而不是逐格洗版", async () => {
  const rows: unknown[][] = Array.from({ length: 12 }, () => Array(20).fill(null));
  rows[1][0] = "站號：11017T14-02";
  rows[1][4] = "日期：115年01月26日 (平日)";
  rows[2][0] = "站名：測試路－驗證路口";
  rows[3][0] = "路口編號：路口A";
  rows[4][0] = "時間";
  ["機車", "小型車", "大型車", "特種車"].forEach((v, vi) => {
    rows[4][1 + vi * 3] = v;
    ["左轉", "直進", "右轉"].forEach((m, mi) => {
      rows[5][1 + vi * 3 + mi] = m;
    });
  });
  ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00", "08:00~08:15"].forEach(
    (t, ri) => {
      rows[6 + ri][0] = t;
      for (let c = 1; c <= 12; c++) rows[6 + ri][c] = 10;
      rows[6 + ri][1] = "-";
    },
  );
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = ["機車", "小型車", "大型車", "特種車"].map((_, vi) => ({
    s: { r: 4, c: 1 + vi * 3 },
    e: { r: 4, c: 3 + vi * 3 },
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "平日");
  const preview = await inspectWorkbook(
    new File([XLSX.write(wb, { type: "array", bookType: "xlsx" })], "路口_整欄破折號.xlsx"),
  );
  const warning = preview.warnings.find((w) => /不是數字/.test(w))!;
  assert.match(warning, /有 5 個儲存格/, "要報出真實筆數，不能被上限截斷");
  assert.match(warning, /「-」5 格/, "同一種原文要歸併計數");
});
