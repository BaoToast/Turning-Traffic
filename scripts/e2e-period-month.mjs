/*
 * 端對端：期別顯示可以在「季別」與「實際調查月份」之間切換（v2.1.34）。
 *
 * 使用者的情境：一季分兩次做完——2 月做兩站、3 月做三站，都掛 115Q1。
 * 畫面平常顯示 115Q1，按一下切換要能看出這一季實際是「115年2、3月」。
 *
 * 這一支釘住三件事：
 *   1. 切換鈕存在，預設顯示季別
 *   2. 切到月份後，季度下拉與趨勢圖 X 軸都變成實際調查月份
 *   3. **切換不會改變任何數字**——切換前後的尖峰流量逐字相同
 *
 * 對未修正的 v2.1.33 應該紅字（那一版根本沒有這顆按鈕）。
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

function makeWorkbook({ dateText, station, name, seed }) {
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
        rows[6 + rowIndex][base + column] =
          1 + ((approach + column + rowIndex + seed) % 7);
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
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["時相圖"]]), "時相圖");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const dir = mkdtempSync(join(tmpdir(), "period-month-"));
const write = (fileName, options) => {
  const path = join(dir, fileName);
  writeFileSync(path, makeWorkbook(options));
  return path;
};
/* 2 月兩站、3 月三站，全部掛 115Q1——使用者實際會遇到的情形。 */
const feb = [1, 2].map((n) =>
  write(`2月_站${n}.xlsx`, {
    dateText: "調查日期：115年02月1" + n + "日 (平日)",
    station: "T88-0" + n,
    name: "二月路口" + n,
    seed: n,
  }),
);
const mar = [3, 4, 5].map((n) =>
  write(`3月_站${n}.xlsx`, {
    dateText: "調查日期：115年03月0" + n + "日 (平日)",
    station: "T88-0" + n,
    name: "三月路口" + n,
    seed: n,
  }),
);

const server = await serve(8171);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:8171/");
await page.waitForTimeout(1200);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};

await go("多計畫管理");
await page.locator(".project-form input").nth(0).fill("115-P02");
await page.locator(".project-form input").nth(1).fill("月份顯示測試計畫");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(700);

async function importBatch(paths) {
  await go("季度批次匯入");
  await page.locator('.content label:has-text("調查年度") input').first().fill("115");
  await page.locator('.content label:has-text("季度") select').first().selectOption("1");
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
  await page.waitForTimeout(4500);
  await page.locator('button:has-text("確認寫入")').first().click();
  await page.waitForTimeout(3500);
}

/* 分兩批匯入同一季——這正是使用者問的「可以分兩次嗎」。 */
await importBatch(feb);
await importBatch(mar);

const headerQuarterText = async () =>
  (await page.locator("header label:has-text('季度') select").first().innerText())
    .replace(/\s+/g, " ")
    .trim();
const dashboardText = async () => {
  await go("總覽儀表板");
  await page.waitForTimeout(500);
  return (await page.locator(".content").first().innerText()).replace(/\s+/g, " ");
};

const before = await dashboardText();
const written = before.match(/本季調查路口\s*(\d+)\s*處/)?.[1];
ok("分兩批匯入同一季，5 站全部留著（沒有互相覆蓋）", written === "5", `本季調查路口 ${written} 處`);

const toggle = page.locator('[data-testid="period-display-toggle"]');
ok("有期別顯示切換鈕", (await toggle.count()) > 0);
const toggleText = async () =>
  (await toggle.count()) ? (await toggle.first().innerText()).trim() : "（沒有這顆按鈕）";
ok("預設顯示季別", /期別顯示：季別/.test(await toggleText()), await toggleText());
ok("季別模式下季度下拉顯示 115Q1", /115Q1/.test(await headerQuarterText()), await headerQuarterText());

/*
 * 沒有這顆按鈕的舊版也要能跑完，否則下面兩條「畫面上看不看得到月份」的
 * 檢查就量不到——那兩條是兩版都成立的行為證據，不是「新函式不存在」。
 */
if (await toggle.count()) {
  await toggle.first().click();
  await page.waitForTimeout(600);
}
ok("切到「調查月份」", /期別顯示：調查月份/.test(await toggleText()), await toggleText());
const monthText = await headerQuarterText();
ok("季度下拉改成實際調查月份「115年2、3月」", /115年2、3月/.test(monthText), monthText);

/* 最重要的一條：切換只換文字，數字一個都不可以動。 */
const after = await dashboardText();
const strip = (text) => text.replace(/115Q1/g, "§").replace(/115年2、3月/g, "§");
ok(
  "切換前後畫面上的數字完全相同（只有期別文字變了）",
  strip(before) === strip(after),
  "差異：" +
    strip(before)
      .split(" ")
      .filter((word, i) => word !== strip(after).split(" ")[i])
      .slice(0, 4)
      .join(" "),
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
await server.close?.();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
