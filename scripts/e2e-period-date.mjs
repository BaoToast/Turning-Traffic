/*
 * 端對端：調查日期與所選期別對不起來時，要顯眼提示並要求二次確認（v2.1.34）。
 *
 * 三種情況各驗一次，全部用真的瀏覽器走完整條路（選檔 → 預覽 → 寫入）：
 *   A. 日期落在所選季度內   → 不打擾，直接寫入
 *   B. 日期不在所選季度內   → 預覽面板紅底提示；按「確認寫入」跳確認框；
 *                             按「取消」不可以寫進去，按「確定」才寫得進去
 *   C. 表頭完全沒有日期     → **不阻擋**，只提醒使用者自行確認
 *
 * 這一支對未修正的 v2.1.33 應該紅字——量的是畫面文字與寫入結果，
 * 不是「新函式在舊版不存在」那種假證明。
 */
import { chromium } from "playwright";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/* 一份可匯入的路口轉向調查表。dateText 是這支測試唯一要變的變因。 */
function makeWorkbook({ dateText, station, name }) {
  const rows = Array.from({ length: 10 }, () => Array(56).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  for (let approach = 0; approach < 4; approach++) {
    const base = approach * 14;
    rows[1][base] = "站號：" + station;
    if (dateText) rows[1][base + 4] = dateText;
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
  XLSX.utils.book_append_sheet(book, sheet, "平日");
  /* 沒有日期的那一份，連監測日誌也不可以留下日期，否則就不是「讀不到」了。 */
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["監測日誌"], ["監測日期", dateText ? "115年01月26日" : ""]]),
    "監測日誌",
  );
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const dir = mkdtempSync(join(tmpdir(), "period-date-"));
const write = (fileName, options) => {
  const path = join(dir, fileName);
  writeFileSync(path, makeWorkbook(options));
  return path;
};

const inQuarter = write("A_115年1月_符合.xlsx", {
  dateText: "日期：115年01月26日 (平日)",
  station: "T99-01",
  name: "測試路口一",
});
const wrongQuarter = write("B_115年8月_不符合.xlsx", {
  dateText: "監測日期：115年08月05日(平日)",
  station: "T99-02",
  name: "測試路口二",
});
const noDate = write("C_沒有日期.xlsx", {
  dateText: "",
  station: "T99-03",
  name: "測試路口三",
});

const server = await serve(8162);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

/* 確認框的行為由每一段自己決定，預設一律接受（其他確認框不是這支要驗的）。 */
let dialogMode = "accept";
const dialogs = [];
page.on("dialog", async (d) => {
  dialogs.push(d.message());
  if (dialogMode === "dismiss" && /調查日期與你選擇的期別不一致/.test(d.message()))
    await d.dismiss();
  else await d.accept();
});

await page.goto("http://localhost:8162/");
await page.waitForTimeout(1200);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};

await go("多計畫管理");
await page.locator(".project-form input").nth(0).fill("115-P01");
await page.locator(".project-form input").nth(1).fill("期別檢查測試計畫");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(700);

async function preview(paths, period = { year: "115", quarter: "1" }) {
  await go("季度批次匯入");
  await page.locator('.content label:has-text("調查年度") input').first().fill(period.year);
  await page
    .locator('.content label:has-text("季度") select')
    .first()
    .selectOption(period.quarter);
  await page.waitForTimeout(400);
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
}

const alertText = async () => {
  const box = page.locator('[data-testid="period-date-alert"]');
  return (await box.count()) ? (await box.first().innerText()).replace(/\s+/g, " ") : "";
};
/*
 * 目前這一季已寫入幾個路口——讀總覽儀表板的「本季調查路口 N 處」。
 * 不去翻儲存層，量的就是使用者看得到的那個數字。
 */
const writtenCount = async () => {
  await go("總覽儀表板");
  await page.waitForTimeout(600);
  const text = (await page.locator(".content").first().innerText()).replace(/\s+/g, " ");
  const match = text.match(/本季調查路口\s*(\d+)\s*處/);
  return match ? Number(match[1]) : 0;
};

/* ── A：日期落在所選季度內，不可以有任何提示 ── */
await preview([inQuarter], { year: "115", quarter: "1" });
ok("A 日期在季度內時預覽面板沒有任何期別提示", (await alertText()) === "", await alertText());
dialogs.length = 0;
await page.locator('button:has-text("確認寫入")').first().click();
await page.waitForTimeout(3000);
ok(
  "A 日期在季度內時「確認寫入」不跳期別確認框",
  !dialogs.some((m) => /調查日期與你選擇的期別不一致/.test(m)),
  dialogs.join(" | ").slice(0, 120),
);

/* ── B：日期不在所選季度內 ── */
await preview([wrongQuarter], { year: "115", quarter: "1" });
const bAlert = await alertText();
ok("B 預覽面板顯眼標示日期與期別不一致", /不一致/.test(bAlert), bAlert.slice(0, 180));
ok("B 提示裡寫出檔案裡的日期", /2026-08-05/.test(bAlert), bAlert.slice(0, 180));
ok("B 提示裡寫出日期屬於哪一季", /115Q3/.test(bAlert), bAlert.slice(0, 180));
ok("B 提示裡寫出來源儲存格", /平日!/.test(bAlert), bAlert.slice(0, 180));

const before = await writtenCount();
await go("季度批次匯入");
dialogs.length = 0;
dialogMode = "dismiss";
await page.locator('button:has-text("確認寫入")').first().click();
await page.waitForTimeout(2500);
ok(
  "B 按「確認寫入」會跳二次確認框",
  dialogs.some((m) => /調查日期與你選擇的期別不一致/.test(m)),
  dialogs.join(" | ").slice(0, 160),
);
ok("B 二次確認按「取消」之後沒有寫進去", (await writtenCount()) === before, `${before} 筆`);

await go("季度批次匯入");
dialogs.length = 0;
dialogMode = "accept";
await page.locator('button:has-text("確認寫入")').first().click();
await page.waitForTimeout(3500);
ok("B 二次確認按「確定」之後才寫得進去", (await writtenCount()) > before, `${before} → ?`);

/* ── C：表頭讀不到日期，不可以阻擋 ── */
await preview([noDate], { year: "115", quarter: "1" });
const cAlert = await alertText();
ok(
  "C 讀不到日期時用使用者指定的字句提醒",
  /無法辨別日期，所以無法幫忙確認是否符合期別，請自行確認正確性/.test(cAlert),
  cAlert.slice(0, 200),
);
const beforeC = await writtenCount();
await go("季度批次匯入");
dialogs.length = 0;
await page.locator('button:has-text("確認寫入")').first().click();
await page.waitForTimeout(3500);
ok(
  "C 讀不到日期不跳期別確認框",
  !dialogs.some((m) => /調查日期與你選擇的期別不一致/.test(m)),
  dialogs.join(" | ").slice(0, 120),
);
ok("C 讀不到日期照樣匯得進去（不阻擋）", (await writtenCount()) > beforeC, `${beforeC} → ?`);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
await server.close?.();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
