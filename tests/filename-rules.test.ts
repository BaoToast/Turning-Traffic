/*
 * ── 檔名規則：規則可以存在，但不能是隱形的 ──
 *
 * 這支系統會用檔名判斷兩件事：這個檔要不要匯入、站號是多少。
 * 規則本身有其道理（承辦附的參考計算檔確實不該被當成調查資料寫進去），
 * 問題在於舊版把規則藏在程式碼裡：預覽只顯示一個藍色標籤，按下確認寫入
 * 之後只得到一句「沒有可寫入的原始交通量檔。」，使用者完全無從得知
 * 問題出在檔名、更不會知道改個檔名就能解決。
 *
 * 這組測試鎖住三件事：
 *   1. 判定規則本身（改壞了要立刻知道）
 *   2. 判定的**原因**要一起帶出來，而且要說得出補救方式
 *   3. 站號讀不到時不可以捏造，並且要標示來源
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectWorkbook, stationFromFilename } from "../lib/traffic.ts";
import XLSX from "xlsx";

/**
 * 造一份真正的路口轉向調查表（四叉、車種標題跨欄合併、每支線一組時間序列）。
 * 結構沿用 tests/traffic.test.ts 既有的作法，確保 layout 會被判成 turning，
 * 這樣測到的才是檔名規則本身，而不是被「非路口轉向」提前攔下。
 * station 傳空字串時不寫「站號：」欄位，用來測退回檔名的路徑。
 */
function surveyFile(fileName: string, station = "11017T14-02") {
  const rows: unknown[][] = Array.from({ length: 12 }, () =>
    Array(56).fill(null),
  );
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = [
    "07:00~07:15",
    "07:15~07:30",
    "07:30~07:45",
    "07:45~08:00",
    "08:00~08:15",
  ];
  for (let approach = 0; approach < 4; approach++) {
    const base = approach * 14;
    if (station) rows[1][base] = `站號：${station}`;
    rows[1][base + 4] = "日期：115年01月26日 (平日)";
    rows[2][base] = "站名：測試路－驗證路口";
    rows[3][base] = `路口編號：路口${String.fromCharCode(65 + approach)}`;
    rows[4][base] = "時間";
    vehicles.forEach((vehicle, vehicleIndex) => {
      rows[4][base + 1 + vehicleIndex * 3] = vehicle;
      movements.forEach((movement, movementIndex) => {
        rows[5][base + 1 + vehicleIndex * 3 + movementIndex] = movement;
      });
    });
    times.forEach((time, rowIndex) => {
      rows[6 + rowIndex][base] = time;
      for (let column = 1; column <= 12; column++)
        rows[6 + rowIndex][base + column] = 10;
    });
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: 4 }).flatMap((_, approach) =>
    vehicles.map((__, vehicleIndex) => ({
      s: { r: 4, c: approach * 14 + 1 + vehicleIndex * 3 },
      e: { r: 4, c: approach * 14 + 3 + vehicleIndex * 3 },
    })),
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "平日");
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new File([buffer], fileName);
}

test("純代號檔名判成參考計算檔，並且說得出原因與補救方式", async () => {
  const preview = await inspectWorkbook(surveyFile("T1402.xlsx"));
  assert.equal(preview.role, "參考計算檔");
  const reason = preview.roleReason || "";
  /* 訊息必須說出：哪個檔、為什麼、怎麼辦 */
  assert.match(reason, /T1402\.xlsx/, "要指名是哪一個檔");
  assert.match(reason, /檔名/, "要說明是檔名造成的");
  assert.match(reason, /路口名稱/, "要說明加上路口名稱即可解決");
});

test("檔名加上路口名稱之後就能正常匯入", async () => {
  const preview = await inspectWorkbook(
    surveyFile("T1402_岡山北路育才路口.xlsx"),
  );
  assert.equal(preview.role, "原始交通量");
  assert.equal(preview.roleReason, undefined);
});

test("只有純代號才算參考計算檔，前後多一個字就不算", async () => {
  for (const name of ["T1402.xlsx", "T14-02.xlsx", "T14_02.xlsx"])
    assert.equal((await inspectWorkbook(surveyFile(name))).role, "參考計算檔");
  for (const name of [
    "11017T14-02_路口.xlsx",
    "T1402_平日.xlsx",
    "岡山北路_T1402.xlsx",
  ])
    assert.equal((await inspectWorkbook(surveyFile(name))).role, "原始交通量");
});

test("站號讀自檔案內的欄位時，來源標為 workbook，且不受檔名影響", async () => {
  const preview = await inspectWorkbook(
    surveyFile("完全沒有站號的檔名.xlsx", "11017T14-02"),
  );
  assert.equal(preview.station, "T14-02");
  assert.equal(preview.stationSource, "workbook");
});

test("檔案內沒有站號欄位時退回檔名，來源標為 filename 並提出警告", async () => {
  const preview = await inspectWorkbook(
    surveyFile("11017T14-05_測試路口.xlsx", ""),
  );
  assert.equal(preview.station, "T14-05");
  assert.equal(preview.stationSource, "filename");
  assert.ok(
    preview.warnings.some((w) => /從檔名推出來的/.test(w)),
    "由檔名推定時必須提醒使用者核對",
  );
});

test("檔案與檔名都讀不到站號時，標為 none 且不得捏造站號", async () => {
  const preview = await inspectWorkbook(surveyFile("第一季成果.xlsx", ""));
  assert.equal(preview.station, "");
  assert.equal(preview.stationSource, "none");
  assert.doesNotMatch(preview.station, /^S-/);
  assert.ok(preview.warnings.some((w) => /讀不到站號/.test(w)));
});

test("站號的「後兩碼為子編號」規則維持不變", () => {
  assert.equal(stationFromFilename("06525T2503嘉45縣168路口.xlsx"), "T25-03");
  assert.equal(stationFromFilename("120507T501縣142彰鹿路.xls"), "T5-01");
  assert.equal(stationFromFilename("T15-04"), "T15-04");
});
