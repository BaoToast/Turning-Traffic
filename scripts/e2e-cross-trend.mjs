/*
 * ══════════════════════════════════════════════════════════════════
 *  跨計畫趨勢的資料別拆線，與缺季資料的可編輯 Excel
 * ══════════════════════════════════════════════════════════════════
 *
 * 這兩條路徑是 GPT 複查 v2.1.60 時點名「現行 E2E 尚未涵蓋」的：
 *   ・缺季資料的可編輯 Excel
 *   ・跨計畫趨勢的資料別拆線
 *
 * 兩者都不是小事：
 *
 *  一、**缺季的 Excel**。畫面上的 X 軸已經會排滿起訖之間的每一季、缺的
 *      留空斷線，但匯出的 Excel 若只列「有資料的那幾季」，Excel 裡那張
 *      折線圖就會把缺季壓掉——113Q1 與 114Q1 畫成相鄰兩點，看起來像相隔
 *      一季，實際隔了整整一年。**交出去的是 Excel，不是畫面。**
 *
 *  二、**跨計畫的資料別拆線**（v2.1.59 修的）。同一個路口同一季通常有平日
 *      與假日兩筆，混在一起平均會得到一個不對應任何一天的數字，而且 N
 *      會變成筆數不是路口數。修好了卻沒有端對端守門，等於沒有保險。
 *
 * ⚠️ 這一支刻意迴避的假通過陷阱：
 *  ・驗 Excel 時只看「有下載到檔案」不夠——檔案一定下載得到，錯的是內容。
 *    要**解開 xlsx、讀工作表的儲存格**，確認缺季那幾列在、而且值是空白
 *    不是 0（0 會被 Excel 當成真實資料點，折線掉到零）。
 *  ・驗拆線時只看「線變多了」不夠——要驗**平日那條線的值，與單獨選平日
 *    時完全相同**，才能證明沒有被假日汙染。
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

/* ── 二、跨計畫趨勢的資料別拆線 ── */
/*
 * ⚠️ 「跨計畫歷季趨勢」那張圖在**「多計畫管理」**頁，不是「跨計畫／多路口
 * 比較」頁——後者是單一季度的摘要卡與排行。第一次寫這支腳本時點錯頁，
 * 前置檢查擋下來了（畫面上找不到任何一條線），沒有變成假綠。
 */
await page.locator('nav button:has-text("多計畫管理")').first().click();
await page.waitForTimeout(1200);
/*
 * 資料別選「全部（分開顯示）」——這正是 v2.1.59 修的那條路徑：
 * 一個計畫拆成平日一條、假日一條，**同時顯示、不加總**。
 */
const pickSurveyType = async (label) =>
  page.evaluate((wanted) => {
    const selects = [...document.querySelectorAll("select")];
    for (const select of selects) {
      const option = [...select.options].find((item) =>
        item.textContent.includes(wanted),
      );
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return option.textContent.trim();
      }
    }
    return "";
  }, label);
const readLines = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".trend-series-label")].map((node) => ({
      text: node.textContent.trim(),
      y: Number(node.getAttribute("y")),
    })),
  );
/** 講稿裡某一條線那一段的數字（與圖同源，而且是會被念出去的那一份）。 */
const scriptNumbersFor = (name) =>
  page.evaluate((wanted) => {
    const text = document.getElementById("crossTrendScript")?.innerText || "";
    const row = text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith(wanted + "："));
    return row ? (row.match(/[\d,]+\.?\d*/g) || []).join("|") : "";
  }, name);

const pickedAll = await pickSurveyType("全部");
await page.waitForTimeout(700);
const bothLines = await readLines();
const weekdayInBoth = await scriptNumbersFor("示範第二計畫（平日）");
const pickedWeekday = await pickSurveyType("平日");
await page.waitForTimeout(700);
const weekdayLines = await readLines();
const weekdayAloneText = await scriptNumbersFor("示範第二計畫");
const cross = { labels: bothLines.map((item) => item.text), pickedAll, pickedWeekday };
ok(
  "跨計畫比較頁要畫得出線（畫不出來的話下面幾項會變成恆真）",
  bothLines.length > 0,
  cross.labels.join(" ／ ") || "（沒有線）",
);
ok(
  "前置：資料別要真的切得到（切不到的話下面幾項驗的是同一種狀態）",
  Boolean(pickedAll) && Boolean(pickedWeekday),
  `全部＝「${pickedAll}」／平日＝「${pickedWeekday}」`,
);
ok(
  "選「全部（分開顯示）」時，一個計畫要拆成平日、假日兩條線",
  weekdayLines.length > 0 && bothLines.length === weekdayLines.length * 2,
  `全部 ${bothLines.length} 條、只選平日 ${weekdayLines.length} 條`,
);
ok(
  "拆開後的線名要帶出是哪一種資料別",
  bothLines.some((item) => /平日/.test(item.text)) &&
    bothLines.some((item) => /假日/.test(item.text)),
  bothLines.map((item) => item.text).join(" ／ "),
);
{
  /*
   * ⚠️ 最關鍵的一項：平日那條線的**值**必須與單獨選平日時完全相同。
   * 只驗「線變多了」擋不住舊版——舊版把兩種日別平均在一起時，
   * 線的條數也可能是對的，錯的是值。
   *
   * ⚠️ 不可以拿線尾標籤的 y 當值。那些標籤為了不互相重疊會被「排開」，
   * 四條線時排開的幅度與兩條線時不同，量到的差異是排版造成的，不是資料。
   * 第一次就是這樣量出一個假紅字。改讀**講稿裡的數字**——講稿與圖同源
   *（都讀 buildCrossProjectTrend 的輸出），而且它就是會被念出去的那一份。
   */
  const numbersOf = (text, name) => {
    const line = text
      .split("\n")
      .map((row) => row.trim())
      .find((row) => row.startsWith(name + "："));
    return line ? (line.match(/[\d,]+\.?\d*/g) || []).join("|") : "";
  };
  ok(
    "「平日」那條線的值要與單獨選平日時完全相同（沒有被假日汙染）",
    Boolean(weekdayInBoth) && weekdayInBoth === weekdayAloneText,
    `合併時「${weekdayInBoth}」｜單獨「${weekdayAloneText}」`,
  );
  void numbersOf;
}

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" / "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
