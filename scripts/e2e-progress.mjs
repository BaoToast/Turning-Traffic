/*
 * 判讀進度提示的端對端檢查（路口轉向）。
 *
 * 使用者回報：「上傳了大量的檔案後，因為沒有『讀取中』等提示文字，
 * 會誤以為沒上傳成功。」
 *
 * 本系統原本判讀中只有按鈕文字換成「正在解析…」，一動也不動——
 * 檔案一多、跑上十幾秒，使用者分不出「還在跑」和「當掉了」。
 *
 * 這一支驗的是：
 *  ・判讀中，上傳卡片上要看得到會跳動的「第幾／共幾份」與檔名
 *  ・進度中途要被抓到至少兩個不同的數字（證明畫面真的在重畫，
 *    不是整批卡到最後才一次跳完）
 *  ・讀完之後進度要收掉，按鈕要回到可以再選檔的狀態
 */
import { chromium } from "playwright";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

/* 與 e2e-survey-type.mjs 相同的匿名版型，不含任何真實調查資料。 */
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

const TOTAL = 12;
const dir = mkdtempSync(join(tmpdir(), "progress-"));
const payload = [];
for (let i = 1; i <= TOTAL; i += 1) {
  const fileName = `120507T5${String(i).padStart(2, "0")}進度測試路口${i}0415_平日.xlsx`;
  const path = join(dir, fileName);
  writeFileSync(
    path,
    makeWorkbook({
      sheetName: "平日",
      dateText: "日期：115年04月15日",
      station: `12507T5-${String(i).padStart(2, "0")}`,
      name: `進度測試路口${i}`,
    }),
  );
  payload.push({
    name: fileName,
    base64: readFileSync(path).toString("base64"),
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(8172);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:8172/");
await page.waitForTimeout(1500);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};

await go("多計畫管理");
await page.locator(".project-form input").nth(0).fill("115-PROG");
await page.locator(".project-form input").nth(1).fill("進度提示測試計畫");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(700);

await go("季度批次匯入");
await page.locator('.content label:has-text("調查年度") input').first().fill("115");
await page.locator('.content label:has-text("季度") select').first().selectOption("2");
await page.waitForTimeout(400);

const idleButton = await page.evaluate(
  () =>
    [...document.querySelectorAll(".upload-card button")]
      .map((b) => b.textContent.trim())
      .join("｜"),
);
ok(
  "前置：還沒開始讀時，按鈕是「選擇檔案」",
  idleButton.includes("選擇檔案"),
  `按鈕「${idleButton}」`,
);
ok(
  "前置：還沒開始讀時，畫面上沒有進度列",
  (await page.locator(".import-progress").count()) === 0,
);

/*
 * 一邊丟檔一邊取樣。取樣要靠瀏覽器排程，
 * 能取到多個不同的進度數字，就證明畫面真的在重畫。
 */
const trace = await page.evaluate(
  async ({ payload }) => {
    const seen = [];
    const snap = () => {
      const button = document.querySelector(".upload-card button");
      const progress = document.querySelector(".import-progress");
      const entry = {
        button: button ? button.textContent.trim() : "",
        progress: progress ? progress.textContent.trim() : "",
      };
      const last = seen[seen.length - 1];
      if (!last || last.button !== entry.button || last.progress !== entry.progress)
        seen.push(entry);
    };
    /*
     * ⚠️ 這裡原本只用 setInterval 每 10ms 取樣。
     *
     * 問題是：序號與檔名對不上的那一格畫面只存在一個 setTimeout(0) 的時間
     * （遠短於 10ms），取樣幾乎一定會跳過它。實測把 v2.1.47 的錯位寫法改回去，
     * 這一支仍然 3/3 全綠——等於守門測試抓不到它要抓的那個 bug。
     *
     * 改用 MutationObserver：畫面**每一次**變動都記一筆，短命的錯誤畫面
     * 也逃不掉。setInterval 保留做為保險（有些變動不經過 DOM mutation）。
     */
    const observer = new MutationObserver(() => snap());
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    const timer = setInterval(snap, 10);
    snap();
    const zone = document.querySelector(".upload-card");
    const transfer = new DataTransfer();
    for (const item of payload) {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      transfer.items.add(new File([bytes], item.name, { type: item.type }));
    }
    zone.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    await new Promise((r) => setTimeout(r, 20000));
    clearInterval(timer);
    observer.disconnect();
    snap();
    return seen;
  },
  { payload },
);

const progressTexts = trace.map((s) => s.progress).filter((t) => /正在讀取/.test(t));
ok(
  "判讀中，上傳卡片上看得到進度列",
  progressTexts.length > 0,
  progressTexts[0] ? `例：「${progressTexts[0]}」` : "整段判讀都沒有出現進度列",
);
ok(
  "而且進度是會跳的（畫面真的在重畫，不是最後才一次跳完）",
  new Set(progressTexts).size >= 3,
  `抓到 ${new Set(progressTexts).size} 種不同的進度文字`,
);
ok(
  "進度有標出總份數，使用者知道還剩多少",
  progressTexts.some((t) => t.includes(`／${TOTAL}`)),
  `共 ${TOTAL} 份；例：「${progressTexts[0] || ""}」`,
);
ok(
  "進度有寫出正在讀哪一個檔名",
  progressTexts.some((t) => /進度測試路口/.test(t)),
  progressTexts[1] ? `例：「${progressTexts[1]}」` : "",
);

const progressPairs = progressTexts
  .map((text) => text.match(/第\s*(\d+)／(\d+)\s*份：.*T5(\d{2})進度測試路口/))
  .filter(Boolean)
  .map((match) => ({ current: Number(match[1]), total: Number(match[2]), file: Number(match[3]) }));
ok(
  "進度序號與正在讀取的檔名一致，而且不會超過總份數",
  progressPairs.length > 0 &&
    progressPairs.every(
      (item) => item.current === item.file && item.current >= 1 && item.current <= item.total,
    ),
  progressPairs.slice(0, 5).map((item) => `${item.current}/${item.total}→檔${item.file}`).join("、"),
);

const buttonTexts = [...new Set(trace.map((s) => s.button))];
ok(
  "按鈕文字也會跟著跳",
  buttonTexts.filter((t) => /正在解析/.test(t)).length >= 2,
  `按鈕出現過：${buttonTexts.join("｜")}`,
);

const last = trace[trace.length - 1];
ok(
  "讀完之後進度列要收掉",
  last.progress === "",
  `結束時進度列「${last.progress}」`,
);
ok(
  "讀完之後按鈕要回到可以再選檔",
  last.button.includes("選擇檔案"),
  `結束時按鈕「${last.button}」`,
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
