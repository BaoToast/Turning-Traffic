/*
 * ══════════════════════════════════════════════════════════════════
 *  缺季資料的可編輯 Excel
 *  （原本還含「跨計畫趨勢的資料別拆線」，功能已於 2026-09-09 授權移除）
 * ══════════════════════════════════════════════════════════════════
 *
 * 這條路徑是 GPT 複查 v2.1.60 時點名「現行 E2E 尚未涵蓋」的：
 *   ・缺季資料的可編輯 Excel
 *
 * ⚠️ 這一支原本還驗「跨計畫趨勢的資料別拆線」，該功能已隨使用者授權移除
 *    而拿掉；**但缺季 Excel 這一段與跨計畫無關，必須留著**——兩件事寫在
 *    同一支腳本裡，整支刪掉會連帶失去缺季 Excel 的守門。
 *
 * **缺季的 Excel**。畫面上的 X 軸已經會排滿起訖之間的每一季、缺的
 *      留空斷線，但匯出的 Excel 若只列「有資料的那幾季」，Excel 裡那張
 *      折線圖就會把缺季壓掉——113Q1 與 114Q1 畫成相鄰兩點，看起來像相隔
 *      一季，實際隔了整整一年。**交出去的是 Excel，不是畫面。**
 *
 *
 * ⚠️ 這一支刻意迴避的假通過陷阱：
 *  ・驗 Excel 時只看「有下載到檔案」不夠——檔案一定下載得到，錯的是內容。
 *    要**解開 xlsx、讀工作表的儲存格**，確認缺季那幾列在、而且值是空白
 *    不是 0（0 會被 Excel 當成真實資料點，折線掉到零）。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync, mkdtempSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";
import XLSX from "xlsx";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages-dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/*
 * 測資：同一個路口，113Q1 與 114Q1 兩季（中間整整缺四季），
 * 每一季各有平日與假日一筆。
 * 缺季與兩種日別在同一份測資裡，兩件事一次驗完。
 */
const base = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
const sample = base.records.find((r) => r.station === "S01-03") || base.records[0];
/*
 * 跨計畫比較需要**兩個**計畫，所以另外造一個。
 * 只有一個計畫時那張圖畫不出線，這一段會變成「前置沒過」而不是誤判成綠。
 */
const secondProject = {
  ...base.projects[0],
  id: "P-test-2",
  code: "B0000",
  name: "示範第二計畫",
};
const seed = {
  ...base,
  projects: [...base.projects, secondProject],
  records: [base.projects[0].id, secondProject.id].flatMap((projectId, pi) =>
    ["113Q1", "114Q1"].flatMap((quarter, qi) =>
      ["平日", "假日"].map((surveyType, di) => ({
        ...JSON.parse(JSON.stringify(sample)),
        id: `CT-${pi}-${qi}-${di}`,
        projectId,
        quarter,
        surveyType,
      })),
    ),
  ),
};

await new Promise((r) => server.listen(8266, r));
const browser = await chromium.launch(launchOptions());
const downloads = mkdtempSync(join(tmpdir(), "turning-cross-"));
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1100 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());

await installStateHelpers(page);
await page.goto("http://localhost:8266/");
await page.waitForTimeout(700);
await page.evaluate(async (json) => {
  localStorage.clear();
  await window.__writeState(json);
}, JSON.stringify(seed));
await page.reload();
await page.waitForTimeout(1400);

/* ── 一、缺季的可編輯 Excel ── */
await page.locator('nav button:has-text("歷季趨勢比較")').first().click();
await page.waitForTimeout(1200);

const axis = await page.evaluate(() => {
  const svg = document.getElementById("trend-svg");
  return svg
    ? [...svg.querySelectorAll("text.x-label")].map((n) => n.textContent.trim())
    : [];
});
ok(
  "前置：畫面上的 X 軸要已經排滿五季（113Q1～114Q1）",
  axis.length === 5 && axis.includes("113Q3"),
  axis.join("、") || "（讀不到）",
);

const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 20000 }).catch(() => null),
  page.locator('button:has-text("下載趨勢 Excel")').first().click(),
]);
ok("前置：趨勢 Excel 要真的下載得到（下載不到的話下面幾項會變成恆真）", Boolean(download));
if (download) {
  const file = join(downloads, "trend.xlsx");
  await download.saveAs(file);
  const book = XLSX.read(readFileSync(file), { type: "buffer" });
  const sheet = book.Sheets["歷季趨勢比較"];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const quarters = rows.map((row) => String(row["季度"]));
  ok(
    "Excel 的季度要與畫面的 X 軸一樣排滿五季，不可以只列有資料的兩季",
    rows.length === 5,
    `${rows.length} 列：${quarters.join("、")}`,
  );
  ok(
    "中間缺的整季要在 Excel 裡佔一列（否則 Excel 的折線圖會把缺季壓掉）",
    quarters.some((q) => /113Q3/.test(q)),
    quarters.join("、"),
  );
  const valueKey = Object.keys(rows[0] || {}).find((key) => /AM Peak（/.test(key));
  ok("前置：要找得到量值欄（找不到的話下一項會變成恆真）", Boolean(valueKey), valueKey || "");
  if (valueKey) {
    const gapRow = rows.find((row) => /113Q3/.test(String(row["季度"])));
    ok(
      "缺季那一列的量值必須是空白，**不可以是 0**（0 會讓 Excel 的折線掉到零）",
      gapRow && (gapRow[valueKey] === null || gapRow[valueKey] === ""),
      gapRow ? `實際值：${JSON.stringify(gapRow[valueKey])}` : "找不到那一列",
    );
    const realRows = rows.filter((row) => !/113Q2|113Q3|113Q4/.test(String(row["季度"])));
    ok(
      "有資料的季度照樣要有數字（不可以整份都變空白）",
      realRows.every((row) => typeof row[valueKey] === "number"),
      realRows.map((row) => row[valueKey]).join("、"),
    );
    const afterGap = rows.find((row) => /114Q1/.test(String(row["季度"])));
    const pctKey = Object.keys(rows[0] || {}).find((key) => /AM Peak 較前季/.test(key));
    ok(
      "缺季之後那一季的「較前季」要留空（前一季根本沒有資料可比）",
      afterGap && pctKey && (afterGap[pctKey] === null || afterGap[pctKey] === ""),
      afterGap && pctKey ? `實際值：${JSON.stringify(afterGap[pctKey])}` : "讀不到",
    );
  }
  ok(
    "「圖表說明」工作表要在（說明文字不印在圖上，放這裡）",
    Boolean(book.Sheets["圖表說明"]),
    Object.keys(book.Sheets).join("、"),
  );
}

/*
 * ── 二、跨計畫趨勢的資料別拆線：**已隨功能移除** ──
 *
 * 使用者 2026-09-09 授權移除三支程式的跨計畫比較功能，
 * 「跨計畫歷季趨勢」（原本掛在「多建立與管理計畫」頁）與「跨計畫／多路口比較」
 * 整頁都已拿掉，所以這一段守門連同被守的功能一起移除。
 *
 * ⚠️ 這一支腳本的**第一段（缺季的可編輯 Excel）與跨計畫無關，必須保留**。
 *   兩件事寫在同一支腳本裡，整支刪掉會連帶失去缺季 Excel 的守門。
 */

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" / "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
