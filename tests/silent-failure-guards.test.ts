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
import { readFileSync } from "node:fs";

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

/* ── 混合時間格只提醒真正重複出現的第二種規律 ── */
function turningFileWithStarts(fileName: string, starts: number[]) {
  const rows: unknown[][] = Array.from({ length: starts.length + 8 }, () =>
    Array(56).fill(null),
  );
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const clock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  for (let approach = 0; approach < 4; approach += 1) {
    const base = approach * 14;
    rows[1][base] = "站號：11017T14-02";
    rows[1][base + 4] = "日期：115年01月26日 (平日)";
    rows[2][base] = "站名：測試路－驗證路口";
    rows[3][base] = `路口編號：路口${String.fromCharCode(65 + approach)}`;
    rows[4][base] = "時間";
    vehicles.forEach((vehicle, vi) => {
      rows[4][base + 1 + vi * 3] = vehicle;
      movements.forEach((movement, mi) => {
        rows[5][base + 1 + vi * 3 + mi] = movement;
      });
    });
    starts.forEach((start, ri) => {
      rows[6 + ri][base] = `${clock(start)}~${clock(start + 15)}`;
      for (let column = 1; column <= 12; column += 1)
        rows[6 + ri][base + column] = 10;
    });
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: 4 }).flatMap((_, approach) =>
    vehicles.map((__, vi) => ({
      s: { r: 4, c: approach * 14 + 1 + vi * 3 },
      e: { r: 4, c: approach * 14 + 3 + vi * 3 },
    })),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "平日");
  return new File([XLSX.write(wb, { type: "array", bookType: "xlsx" })], fileName);
}

test("真正重複的 15／60 分鐘格距會提出人工核對警告", async () => {
  const preview = await inspectWorkbook(
    turningFileWithStarts("路口_混合時間格.xlsx", [420, 435, 450, 510, 570, 585, 645]),
  );
  assert.ok(preview.warnings.some((warning) => /混用了不同長度的時間格/.test(warning)));
});

test("短時段資料只漏一列時，不誤稱為混合時間格", async () => {
  const preview = await inspectWorkbook(
    turningFileWithStarts("路口_單一漏列.xlsx", [420, 435, 450, 480, 495]),
  );
  assert.ok(!preview.warnings.some((warning) => /混用了不同長度的時間格/.test(warning)));
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

test("整欄都是同一種壞資料時，警告要歸併同一種原文而不是逐格洗版", async () => {
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
      /*
       * v2.1.41 起「-」「－」「—」「–」是「該轉向不存在」的合法佔位記號，
       * 與全日交通量一致，不再誤報成壞資料（見本檔最後一個測試）。
       * 這個測試要驗的是「同一種原文歸併計數」，所以改用真正的壞資料。
       */
      rows[6 + ri][1] = "休";
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
  /*
   * 比對字串要挑得夠精確。v2.1.55 新增了「整欄空白」的提醒，
   * 它原本也含有「不是數字」四個字，於是這裡的 find() 抓到了那一則
   * 而不是壞資料那一則——測試紅了，但程式是對的。
   * 改成認「個儲存格有內容但不是數字」這個完整片語。
   */
  const warning = preview.warnings.find((w) =>
    /個儲存格有內容但不是數字/.test(w),
  )!;
  assert.match(warning, /有 5 個儲存格/, "要報出真實筆數，不能被上限截斷");
  assert.match(warning, /「休」5 格/, "同一種原文要歸併計數");
});

/* ── 「製表日期」不可以被當成調查日期 ── */
test("非調查日期、普通日期與無效日期排在前面時，仍要取明確標示的有效調查日期", async () => {
  /*
   * 舊寫法取「第一個看起來像日期的儲存格」，於是 date 記成製表日，
   * 而 resolveSurveyType() 讀同一格的括號 → 資料別被記成「假日」。
   * 資料別是 isSameSurvey 的識別鍵，判錯會讓重新匯入不接手、靜靜多出一筆。
   * 三支共用的 period-date 早就有這份排除清單，只是這條路徑沒套用。
   */
  const rows: unknown[][] = Array.from({ length: 14 }, () => Array(20).fill(null));
  rows[0][0] = "彙整日期：115年03月01日(假日)";
  rows[0][1] = "輸出日期：115年03月02日(假日)";
  rows[0][2] = "115年02月15日";
  rows[0][3] = "製表日期：115年03月03日(假日)";
  rows[0][4] = "日期：115年02月29日(假日)";
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
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = ["機車", "小型車", "大型車", "特種車"].map((_, vi) => ({
    s: { r: 4, c: 1 + vi * 3 },
    e: { r: 4, c: 3 + vi * 3 },
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "平日");
  const preview = await inspectWorkbook(
    new File([XLSX.write(wb, { type: "array", bookType: "xlsx" })], "路口_製表日期.xlsx"),
  );
  assert.equal(preview.date, "2026-01-26", "應取真正的調查日期，不是製表日");
  assert.equal(preview.surveyType, "平日", "資料別不可以被製表日期的括號帶偏");
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  剪貼簿：可選鏈會短路**整條成員鏈**（2026-09-25 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * `navigator.clipboard?.writeText(t).then(a).catch(b)` 在 clipboard 為
 * undefined 時回傳 undefined，而且 **then 與 catch 都不會執行**——
 * 已實測：`({}).clipboard?.writeText("x").then(a).catch(b)` 回 undefined，
 * 兩個 callback 一個都沒跑。
 *
 * 後果：在非安全內容（http 的區網網址）或舊瀏覽器上按「複製」，
 * 沒有複製、沒有 toast、也不會走 .catch 的提示——使用者以為複製成功了，
 * 去貼上得到舊的剪貼簿內容。
 *
 * 原本四個複製按鈕裡只有一個（報表草稿的「複製全文」）有明確判斷，
 * 另外三個沒有，而那一個的註解就寫著「不能靜靜失敗讓使用者以為複製成功了」。
 */
test("⚠️ 每一個用到 navigator.clipboard 的地方都要先明確判斷，不可以只靠可選鏈", () => {
  /* 先把「可選鏈短路連 catch 都不跑」這件事釘成可執行的事實。 */
  let ran = false;
  const fake = {} as { clipboard?: { writeText(t: string): Promise<void> } };
  const returned = fake.clipboard
    ?.writeText("x")
    .then(function () {
      ran = true;
    })
    .catch(function () {
      ran = true;
    });
  assert.equal(returned, undefined, "可選鏈應該短路成 undefined");
  assert.equal(
    ran,
    false,
    "then 與 catch 都不應該執行——這就是「按了完全沒反應」的機制",
  );

  const FILES = ["../app/traffic-app.tsx", "../app/peak-shape-charts.tsx"];
  const offenders: string[] = [];
  for (const rel of FILES) {
    const text = readFileSync(new URL(rel, import.meta.url), "utf8");
    const lines = text.split("\n");
    lines.forEach(function (line, index) {
      /* 只看「拿 clipboard 去寫」的那些行，不看純粹的存在性判斷。 */
      if (!/navigator\.clipboard/.test(line)) return;
      if (/if \(!navigator\.clipboard\?\.writeText\)/.test(line)) return;
      /*
       * ⚠️ 跳過註解行。修這個缺陷時我在註解裡舉了舊寫法當例子，
       *   結果被自己這一條抓成違規——那會逼人把說明刪掉，很不合理。
       */
      const trimmed = line.trim();
      if (
        trimmed.startsWith("*") ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*")
      )
        return;
      /*
       * 合法的兩種寫法：
       *   ① 先 `if (!navigator.clipboard?.writeText) return notify(...)`，
       *      再 `navigator.clipboard.writeText(...)`（不帶 ?.）
       *   ② try { await navigator.clipboard.writeText(...) } catch {}
       * 不合法的：`navigator.clipboard?.writeText(...)` 直接接 .then/.catch
       */
      if (/navigator\.clipboard\s*$/.test(line)) {
        /* 鏈的開頭，看下一行是不是 `?.writeText` */
        const next = lines[index + 1] || "";
        if (/^\s*\?\.writeText/.test(next))
          offenders.push(`${rel}:${index + 1} 用了可選鏈直接接 .then/.catch`);
        return;
      }
      if (/navigator\.clipboard\?\.writeText\(/.test(line))
        offenders.push(`${rel}:${index + 1} 用了可選鏈直接呼叫`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "下面這些複製按鈕在沒有剪貼簿權限時會完全靜默（連 .catch 都不會跑）：\n  " +
      offenders.join("\n  "),
  );
});

test("⚠️ 前置：確實有四個以上的複製按鈕被這一條守著（0 個的話上一條恆真）", () => {
  let count = 0;
  for (const rel of ["../app/traffic-app.tsx", "../app/peak-shape-charts.tsx"]) {
    const text = readFileSync(new URL(rel, import.meta.url), "utf8");
    count += (text.match(/if \(!navigator\.clipboard\?\.writeText\)/g) || [])
      .length;
  }
  assert.ok(
    count >= 4,
    `只找到 ${count} 個明確判斷——應該至少 4 個` +
      `（結論草稿、報表草稿、趨勢說明、尖峰形狀說明）`,
  );
});
