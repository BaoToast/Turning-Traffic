/*
 * 拖曳上傳的端對端檢查（路口轉向）。
 *
 * v2.1.46 之前上傳卡片就已經接得到 drop 了，但畫面上**沒有任何變化**：
 * 使用者拖到一半看不出來「丟這裡對不對」，只能賭一把放開。
 * 備份還原那一張卡則完全不吃拖曳，只能按按鈕選檔。
 * 而且檔案一旦掉在放置區外面，瀏覽器會直接開啟那個檔案、把使用者
 * 踢出系統畫面。這一支就是釘住這三件事。
 *
 * ⚠️ 寫法上刻意不用 Playwright 的 setInputFiles()——那是直接塞給
 * <input>，根本不會經過 drop 事件，等於沒驗到拖曳。這裡自己組
 * DataTransfer 再送真正的 dragenter/dragover/drop，跟使用者的動作一致。
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

const dir = mkdtempSync(join(tmpdir(), "drop-"));
const samplePath = join(dir, "120507T501拖曳測試路口0415_平日.xlsx");
writeFileSync(
  samplePath,
  makeWorkbook({
    sheetName: "平日",
    dateText: "日期：115年04月15日",
    station: "12507T5-01",
    name: "拖曳測試路口",
  }),
);

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(8171);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:8171/");
await page.waitForTimeout(1500);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};

/* 因為要在事件之間量畫面狀態，拆成三次 evaluate。 */
async function fireDrag(selector, type, payload) {
  return page.evaluate(
    ({ selector, type, payload }) => {
      const zone = document.querySelector(selector);
      if (!zone) return { missing: true };
      if (!window.__dropProbe || window.__dropProbeFor !== selector) {
        const transfer = new DataTransfer();
        for (const item of payload) {
          const binary = atob(item.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          transfer.items.add(new File([bytes], item.name, { type: item.type || "" }));
        }
        window.__dropProbe = transfer;
        window.__dropProbeFor = selector;
      }
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: window.__dropProbe,
      });
      zone.dispatchEvent(event);
      return {
        prevented: event.defaultPrevented,
        active: zone.classList.contains("drag-active"),
        effect: event.dataTransfer ? event.dataTransfer.dropEffect : "",
      };
    },
    { selector, type, payload },
  );
}

/* ── 準備一個計畫，並進到匯入頁 ── */
await go("多計畫管理");
await page.locator(".project-form input").nth(0).fill("115-DROP");
await page.locator(".project-form input").nth(1).fill("拖曳測試計畫");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(700);

await go("季度批次匯入");
await page.locator('.content label:has-text("調查年度") input').first().fill("115");
await page.locator('.content label:has-text("季度") select').first().selectOption("2");
await page.waitForTimeout(400);

const excelPayload = [
  {
    name: "120507T501拖曳測試路口0415_平日.xlsx",
    base64: readFileSync(samplePath).toString("base64"),
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
];

/* ── 一、匯入卡片：拖曳經過要看得出來 ── */
const beforeEnter = await page.evaluate(
  () => document.querySelector(".upload-card")?.classList.contains("drag-active") ?? null,
);
ok("前置：還沒開始拖時，匯入卡片沒有高亮", beforeEnter === false);

await fireDrag(".upload-card", "dragenter", excelPayload);
const onOver = await fireDrag(".upload-card", "dragover", excelPayload);
await page.waitForTimeout(200);
const activeWhileOver = await page.evaluate(() =>
  document.querySelector(".upload-card").classList.contains("drag-active"),
);
ok(
  "拖曳經過匯入卡片時會亮起來",
  activeWhileOver === true,
  `dragover 之後 drag-active=${activeWhileOver}`,
);
ok(
  "匯入卡片有接住 dragover（沒接住的話瀏覽器不會給 drop）",
  onOver.prevented === true,
);
/*
 * 這裡本來還想驗「游標顯示可以放（dropEffect === "copy"）」，
 * 但合成的 DragEvent 上 dropEffect 量不到真實值（一律回 "none"），
 * 驗了只會變成一條永遠紅或永遠綠的假檢查。真正決定瀏覽器會不會
 * 把 drop 送過來的是上面那個 defaultPrevented，那一項是量得準的。
 */

await fireDrag(".upload-card", "drop", excelPayload);
await page.waitForTimeout(300);
const activeAfterDrop = await page.evaluate(() =>
  document.querySelector(".upload-card").classList.contains("drag-active"),
);
ok("放開之後高亮要收掉", activeAfterDrop === false);

/* ── 二、拖進來的檔案真的被解析（不是只吃掉事件） ── */
await page.waitForTimeout(4000);
/*
 * 「確認寫入」只有在 importRows.length 且年度季度都填妥時才會解除停用，
 * 所以它由停用轉成可按，就代表拖進來的檔案真的被解析出內容了
 * ——不是只把事件吃掉、也不是只把檔名記下來。
 */
const parsed = await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((b) =>
    b.textContent.includes("確認寫入"),
  );
  return {
    found: !!button,
    enabled: button ? !button.disabled : false,
    heading: [...document.querySelectorAll("h2")].some(
      (h) => h.textContent.trim() === "匯入辨識結果",
    ),
  };
});
ok(
  "拖進來的 Excel 真的讀出內容（辨識結果出現，且可以確認寫入）",
  parsed.heading && parsed.enabled,
  `辨識結果面板=${parsed.heading}、確認寫入可按=${parsed.enabled}`,
);

/* ── 三、拖曳離開要把高亮收掉（不能一直亮著） ── */
await fireDrag(".upload-card", "dragenter", excelPayload);
await page.waitForTimeout(150);
await fireDrag(".upload-card", "dragleave", excelPayload);
await page.waitForTimeout(200);
const afterLeave = await page.evaluate(() =>
  document.querySelector(".upload-card").classList.contains("drag-active"),
);
ok("拖出去之後高亮要收掉", afterLeave === false);

/* ── 四、檔案掉在放置區外面，不可以把使用者帶離頁面 ── */
const urlBefore = page.url();
const stray = await page.evaluate(() => {
  const transfer = new DataTransfer();
  transfer.items.add(new File(["x"], "亂丟的檔案.xlsx"));
  const target = document.querySelector("nav") || document.body;
  const over = new DragEvent("dragover", {
    bubbles: true,
    cancelable: true,
    dataTransfer: transfer,
  });
  target.dispatchEvent(over);
  const drop = new DragEvent("drop", {
    bubbles: true,
    cancelable: true,
    dataTransfer: transfer,
  });
  target.dispatchEvent(drop);
  return { over: over.defaultPrevented, drop: drop.defaultPrevented };
});
await page.waitForTimeout(300);
ok(
  "檔案掉在放置區外面時，瀏覽器的預設開檔行為被擋掉",
  stray.over === true && stray.drop === true,
  `dragover 擋下=${stray.over}、drop 擋下=${stray.drop}`,
);
ok("沒有因此離開系統頁面", page.url() === urlBefore);

/* ── 五、備份還原也要吃拖曳 ── */
await go("備份、還原與版本");
await page.waitForTimeout(500);
const restoreZoneCount = await page.evaluate(
  () => document.querySelectorAll(".upload-label").length,
);
ok("備份還原的放置區找得到", restoreZoneCount >= 1, `${restoreZoneCount} 個`);

/*
 * 用系統自己匯出的備份檔來測，不要自己捏一份 JSON。
 * 捏出來的東西只會走到「格式不符」那條錯誤路徑，
 * 那樣就只驗到「drop 有被接到」，沒驗到「拖曳還原真的會還原」。
 */
const download = await Promise.all([
  page.waitForEvent("download"),
  page.locator('button:has-text("下載 JSON（全部計畫）")').first().click(),
]).then(([d]) => d);
const backupPayload = readFileSync(await download.path()).toString("base64");
await fireDrag(".upload-label", "dragenter", [
  { name: "拖曳備份.json", base64: backupPayload, type: "application/json" },
]);
const restoreOver = await fireDrag(".upload-label", "dragover", [
  { name: "拖曳備份.json", base64: backupPayload, type: "application/json" },
]);
await page.waitForTimeout(200);
const restoreActive = await page.evaluate(() =>
  document.querySelector(".upload-label").classList.contains("drag-active"),
);
ok(
  "拖曳經過備份還原卡片時會亮起來",
  restoreActive === true,
  `dragover 之後 drag-active=${restoreActive}`,
);
ok("備份還原卡片有接住 dragover", restoreOver.prevented === true);

await fireDrag(".upload-label", "drop", [
  { name: "拖曳備份.json", base64: backupPayload, type: "application/json" },
]);
await page.waitForTimeout(2500);
const restoreOutcome = await page.evaluate(() => ({
  toast: document.querySelector(".toast")?.textContent?.trim() || "",
  modal: document.querySelectorAll(".modal").length,
}));
ok(
  "拖進來的備份真的被當成備份讀進去（不是掉到格式不符）",
  !/格式不符|不是有效|讀取失敗/.test(restoreOutcome.toast) &&
    (restoreOutcome.toast !== "" || restoreOutcome.modal > 0),
  `提示「${restoreOutcome.toast}」、對話框 ${restoreOutcome.modal} 個`,
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
