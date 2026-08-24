/*
 * 端對端：資料別（平日／假日）到底有沒有讀進去。
 *
 * 用的是使用者實際遇到問題的那三個檔案的特徵：
 *   ・日期欄寫「日期：115年04月15日」——**沒有括號**
 *   ・交通量工作表就叫「平日」
 * 舊版只從日期的括號讀資料別，工作表名稱又只在「同時有平日與假日兩張」時
 * 才會採用，所以這種檔案會被判成「待設定」。
 *
 * 這一支從瀏覽器整條路徑走一次（選檔 → 預覽 → 寫入 → 看畫面），
 * 確認顯示的是「平日」。第二段驗重新匯入：先做出一筆待設定，再用有資料別的
 * 檔案匯入同一季，那筆待設定必須被**接手**，而不是變成兩筆。
 */
import { chromium } from "playwright";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { serve } from "./serve.mjs";
import { chromiumLaunchOptions } from "./chromium.mjs";

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/*
 * 做一份可匯入的路口轉向調查表（四個路口編號橫向並排的傳統版型，
 * 和使用者手上那三個檔案同一種）。
 * sheetName 與 dateText 是這支測試真正要驗的兩個變因。
 */
function makeWorkbook({ sheetName, dateText, station, name }) {
  const rows = Array.from({ length: 10 }, () => Array(56).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  for (let approach = 0; approach < 4; approach++) {
    const base = approach * 14;
    rows[1][base] = "站號：" + station;
    rows[1][base + 4] = dateText;
    rows[2][base] = "站名：" + name;
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
        rows[6 + rowIndex][base + column] = 1 + ((approach + column + rowIndex) % 7);
    });
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: 4 }).flatMap((_, approach) =>
    vehicles.map((__, vehicleIndex) => ({
      s: { r: 4, c: approach * 14 + 1 + vehicleIndex * 3 },
      e: { r: 4, c: approach * 14 + 3 + vehicleIndex * 3 },
    })),
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["監測日誌"], ["監測日期", "115年04月15日"]]),
    "監測日誌",
  );
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["時相圖"]]), "時相圖");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const dir = mkdtempSync(join(tmpdir(), "survey-type-"));
const write = (fileName, options) => {
  const path = join(dir, fileName);
  writeFileSync(path, makeWorkbook(options));
  return path;
};

/* (A) 工作表叫「平日」、日期沒有括號 —— 使用者那三個檔案的情形 */
const sheetOnly = write("120507T501縣142彰鹿路與彰27東昇路0415.xlsx", {
  sheetName: "平日",
  dateText: "日期：115年04月15日",
  station: "12507T5-01",
  name: "縣142彰鹿路與彰27東昇路",
});
/* (B) 兩者都沒有 —— 這一份**應該**是待設定，用來驗接手 */
const neither = write("120507T502彰18鹿東路與彰27東昇路0415.xlsx", {
  sheetName: "調查表",
  dateText: "日期：115年04月15日",
  station: "12507T5-02",
  name: "彰18鹿東路與彰27東昇路",
});
/* (C) 和 (B) 同站號，但工作表叫「平日」 —— 重新匯入要接手 (B) 那一筆 */
const fixesB = write("120507T502彰18鹿東路與彰27東昇路0415_平日.xlsx", {
  sheetName: "平日",
  dateText: "日期：115年04月15日",
  station: "12507T5-02",
  name: "彰18鹿東路與彰27東昇路",
});

const server = await serve(8155);
const browser = await chromium.launch(chromiumLaunchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:8155/");
await page.waitForTimeout(1200);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};

/* 建立計畫 */
await go("多計畫管理");
await page.locator('.project-form input').nth(0).fill("115-A01");
await page.locator('.project-form input').nth(1).fill("測試計畫");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(700);

async function importFiles(paths, period = { year: "115", quarter: "2" }) {
  await go("季度批次匯入");
  /*
   * 年度與季度是必填，**而且要先填**——沒填之前檔案選取是停用的
   * （畫面上寫「請先選年度與季度」）。
   * 只找匯入面板裡的那兩個欄位，上方工具列也有一個「季度」下拉。
   */
  await page.locator('.content label:has-text("調查年度") input').first().fill(period.year);
  await page.locator('.content label:has-text("季度") select').first().selectOption(period.quarter);
  await page.waitForTimeout(400);
  /*
   * 那個 <input type="file"> 帶著 hidden 屬性（畫面上按的是「選擇檔案」按鈕），
   * 先把 hidden 拿掉再塞檔案，Playwright 才餵得進去。
   */
  /*
   * 真正的 <input type="file"> 帶著 hidden 屬性，Playwright 餵不進去；
   * 這一頁本來就支援把檔案拖進上傳卡片，所以改走 drop——同一支 handleFiles，
   * 走的是使用者確實會用的那條路。
   */
  const payload = paths.map((path) => ({
    name: path.split("/").pop(),
    base64: readFileSync(path).toString("base64"),
  }));
  await page.locator(".upload-card").first().evaluate((card, items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      transfer.items.add(
        new File([bytes], item.name, {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
    }
    card.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
  }, payload);
  await page.waitForTimeout(4000);
  await page.locator('button:has-text("確認寫入")').first().click();
  /* 寫入是防抖存檔，等久一點再讀 localStorage */
  await page.waitForTimeout(3500);
}

/*
 * 資料存在 IndexedDB，不是 localStorage，所以這裡一律從**畫面上**驗證
 * ——那也才是使用者真正看到的東西。
 * 「結論草稿產生器」的「二、時段與資料別」會列出這個計畫目前有哪幾種資料別，
 * 是最直接的一面鏡子。
 */
async function surveyTypesOnScreen() {
  await go("結論草稿產生器");
  await page.waitForTimeout(800);
  return (
    await page
      .locator('.conclusion-field:has-text("資料別") .conclusion-checks')
      .nth(1)
      .locator("label")
      .allTextContents()
  ).map((text) => text.trim());
}

/* 每一個路口目前的資料別，從「流量核對工作台」的資料別下拉讀 */
async function surveyTypeByIntersection() {
  await go("流量核對工作台");
  await page.waitForTimeout(900);
  const picker = page.locator(".audit-picker select").first();
  const count = await picker.locator("option").count();
  const result = [];
  for (let index = 0; index < count; index++) {
    await picker.selectOption({ index });
    await page.waitForTimeout(700);
    const label = (await picker.locator("option").nth(index).textContent())?.trim() || "";
    const type = await page
      .locator(".review-panel:has-text('資料別（平日／假日）') select")
      .first()
      .inputValue();
    result.push(`${label}=${type}`);
  }
  return result;
}

/* ── 第一段：工作表叫「平日」、日期沒括號 ── */
await importFiles([sheetOnly, neither]);

const types1 = await surveyTypesOnScreen();
const byIntersection1 = await surveyTypeByIntersection();
console.log("── 匯入後的資料別：", types1.join("、"), "｜逐路口：", byIntersection1.join("、"));

ok(
  "工作表叫「平日」、日期沒括號 → 讀成平日",
  byIntersection1.some((entry) => /T5-01/.test(entry) && /=平日$/.test(entry)),
  byIntersection1.join("、"),
);
ok(
  "兩處都讀不到 → 才是待設定",
  byIntersection1.some((entry) => /T5-02/.test(entry) && /=待設定$/.test(entry)),
  byIntersection1.join("、"),
);

/* ── 第二段：重新匯入要接手那筆待設定，不能變成兩筆 ── */
await importFiles([fixesB]);

const types2 = await surveyTypesOnScreen();
const byIntersection2 = await surveyTypeByIntersection();
console.log("── 重新匯入後的資料別：", types2.join("、"), "｜逐路口：", byIntersection2.join("、"));

ok(
  "重新匯入之後「待設定」不見了（被接手，不是多出一筆）",
  !types2.includes("待設定"),
  types2.join("、") || "(沒有列出任何資料別)",
);
ok(
  "那一筆的資料別已經補成平日",
  byIntersection2.some((entry) => /T5-02/.test(entry) && /=平日$/.test(entry)),
  byIntersection2.join("、"),
);
ok(
  "路口數沒有增加（不是變成兩筆）",
  byIntersection2.length === byIntersection1.length,
  `匯入前 ${byIntersection1.length} 個、匯入後 ${byIntersection2.length} 個`,
);

/*
 * ── 歷季趨勢被「待設定」拆成兩條線，要能一鍵補完 ──
 *
 * 使用者實際遇到的情形（截圖）：同一個路口，資料別下拉同時有「平日」和
 * 「待設定」；選平日只有 1 季畫不出趨勢，選待設定才有 4 季。
 * 原因是舊版匯入的那幾季在紀錄裡存著待設定，而資料別不會自己重讀。
 */

/* 先做出「同一路口、同一種資料別各佔幾季」的情境：T5-03 兩季，一季讀得到、一季讀不到 */
const trendPending = write("120507T503彰18鹿東路與打鐵巷路口_無日別.xlsx", {
  sheetName: "調查表",
  dateText: "日期：115年01月15日",
  station: "12507T5-03",
  name: "彰18鹿東路與打鐵巷路口",
});
const trendKnown = write("120507T503彰18鹿東路與打鐵巷路口_平日.xlsx", {
  sheetName: "平日",
  dateText: "日期：115年04月15日",
  station: "12507T5-03",
  name: "彰18鹿東路與打鐵巷路口",
});
await importFiles([trendPending], { year: "115", quarter: "1" });
await importFiles([trendKnown], { year: "115", quarter: "2" });

await go("歷季趨勢比較");
await page.waitForTimeout(1000);
/* 切到那個路口 */
const trendPicker = page.locator('.content label:has-text("路口") select').first();
const trendOptions = await trendPicker.locator("option").allTextContents();
const target = trendOptions.findIndex((text) => /打鐵巷/.test(text));
if (target >= 0) await trendPicker.selectOption({ index: target });
await page.waitForTimeout(900);

const trendTypes = await page
  .locator('.content label:has-text("資料別") select option')
  .allTextContents();
console.log("── 歷季趨勢的資料別選項：", trendTypes.join("、"));
ok(
  "重現：待設定和平日同時出現在歷季趨勢的資料別",
  trendTypes.includes("待設定") && trendTypes.includes("平日"),
  trendTypes.join("、"),
);
ok(
  "預設停在真正的資料別，不是停在「待設定」",
  (await page.locator('.content label:has-text("資料別") select').first().inputValue()) !==
    "待設定",
  await page.locator('.content label:has-text("資料別") select').first().inputValue(),
);
ok(
  "趨勢頁會明講被拆成兩條線，並給出補完的按鈕",
  (await page.locator(".trend-pending-note").count()) === 1,
  (await page.locator(".trend-pending-note").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 150),
);

/* 按下去補完 */
await page
  .locator('.trend-pending-actions button:has-text("都指定為平日")')
  .first()
  .click();
await page.waitForTimeout(1500);

await page.waitForTimeout(1200);
const typesAfter = await page
  .locator('.content label:has-text("資料別") select option')
  .allTextContents();
console.log("── 補完後的資料別選項：", typesAfter.join("、"));
/*
 * 只剩一種資料別時，趨勢頁本來就不顯示那個下拉（沒得選就不佔版面），
 * 所以這裡的判準是「不再看得到待設定」，不是「下拉裡有平日」。
 */
ok(
  "補完之後「待設定」從歷季趨勢消失",
  !typesAfter.includes("待設定"),
  typesAfter.length ? typesAfter.join("、") : "（只剩一種資料別，下拉已收起）",
);
ok("補完之後提示也跟著收起來", (await page.locator(".trend-pending-note").count()) === 0);
const pointCount = await page.locator("#trend-svg circle").count();
ok(
  "兩季合成同一條趨勢線（不再被拆開）",
  pointCount >= 2,
  `${pointCount} 個資料點`,
);

console.log("\n══ 主控台錯誤 ══");
ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" / "));

await browser.close();
server.close();
console.log(
  problems.length ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ") : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
