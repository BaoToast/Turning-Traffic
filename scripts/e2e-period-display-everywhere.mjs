/*
 * ══════════════════════════════════════════════════════════════════════
 *  「期別顯示」與「年份顯示」：每一個顯示期間的欄位都要跟著走
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（在交通服務水準上發現，並指定三支都要查）：
 *   「期別顯示調查月份 和西元年，但這裡的資料**只有成功變成西元年，
 *     沒有變成調查月份**。請確認月份和年的切換功能都有正常運作。」
 *   「三份程式都有，確認都有正常運作 調查月份 和 年 切換。」
 *
 * ⚠️ 既有的 e2e-period-month 驗的是「切換鈕會動、某幾個欄位會變」，
 *   **沒有逐頁掃過整個畫面**。而這兩顆鈕是兩層獨立的轉換：
 *   年份那一層到處都套上了，期別那一層只套在少數地方。
 *
 * 作法：切到「調查月份」之後掃過每一個分頁，找還有沒有殘留的季別寫法。
 * ⚠️ 四種組合都要驗——只驗一種正是這次漏掉的原因。
 * ⚠️ 前置（匯入帶日期的檔案）沿用 e2e-period-month 同一套，確保鈕不是停用的。
 */
import { chromium } from "playwright";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const problems = [];
/*
 * detail 分兩種：有些是**佐證**（成功時也該印出來看），
 * 有些是**失敗原因**（成功時印出來會讓人以為出事了）。後者包 failOnly()。
 */

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

const server = await serve(8193);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:8193/");
await page.waitForTimeout(1200);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};

await go("建立與管理計畫");
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



const okk = (label, cond, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/* ⚠️ 同一頁可能有好幾顆，一律取第一顆。 */
const periodToggle = page.locator('[data-testid="period-display-toggle"]').first();
const yearToggleBtn = page.locator('[data-testid="year-style-toggle"]').first();
const monthOn = async () => /調查月份/.test((await periodToggle.innerText()).trim());
const adOn = async () => /西元/.test((await yearToggleBtn.innerText()).trim());
const setMonth = async (want) => {
  if ((await monthOn()) !== want) {
    await periodToggle.click();
    await page.waitForTimeout(600);
  }
};
const setAd = async (want) => {
  if ((await adOn()) !== want) {
    await yearToggleBtn.click();
    await page.waitForTimeout(600);
  }
};

okk(
  "前置：這批資料有調查日期，期別鈕可以按（不能按的話整支變成恆真）",
  await periodToggle.isEnabled(),
);

const navLabels = await page.evaluate(() =>
  [...document.querySelectorAll("nav button")]
    .map((b) => (b.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean),
);

const scan = async () => {
  const out = [];
  for (const label of navLabels) {
    await page.locator(`nav button:has-text("${label}")`).first().click().catch(() => {});
    await page.waitForTimeout(450);
    const hits = await page.evaluate(() => {
      const found = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walk.nextNode())) {
        const text = (node.nodeValue || "").trim();
        /*
         * ⚠️ 「例如：115Q1」這種輸入格式範例、以及長句子裡拿季別當例子的說明，
         *   都不算漏網——那是散文，不是資料欄位。資料欄位一定很短。
         *   門檻訂得保守（40 字），寧可多幾個假警報，
         *   也不要把真正漏掉的欄位濾掉。
         */
        if (/例如/.test(text)) continue;
        if (text.length > 40) continue;
        /*
         * ⚠️ 明講出來的豁免：顯示「會存進哪一個季別鍵」的地方**刻意**不跟著切換走
         *   （那幾處旁邊自己就寫著「資料一律以民國年記錄」）。
         *   跳過帶標記的元素，但下面會限制標記的總數——
         *   不讓它變成「想讓守門變綠就貼一張」的萬用貼紙。
         */
        if (node.parentElement?.closest("[data-period-storage-key]")) continue;
        const m = text.match(/\b\d{3,4}Q[1-4]\b/);
        if (m) {
          const owner = node.parentElement;
          found.push(
            `${m[0]}（在 ${owner.tagName.toLowerCase()}${owner.id ? "#" + owner.id : ""}）`,
          );
        }
      }
      return [...new Set(found)].slice(0, 6);
    });
    if (hits.length) out.push(`${label}：${hits.join("、")}`);
  }
  return out;
};

console.log("\n── 四種組合逐一驗");
for (const [month, ad, name] of [
  [false, false, "季別 × 民國年"],
  [false, true, "季別 × 西元年"],
  [true, false, "調查月份 × 民國年"],
  [true, true, "調查月份 × 西元年"],
]) {
  await setMonth(month);
  await setAd(ad);
  const leftovers = await scan();
  if (month)
    okk(
      `${name}：畫面上不應再有任何季別寫法`,
      leftovers.length === 0,
      leftovers.length ? leftovers.slice(0, 4).join(" ｜ ") : "全部都是月份寫法",
    );
  else
    okk(
      `${name}：畫面上應該**還有**季別寫法（前置檢查，證明掃描真的掃得到）`,
      leftovers.length > 0,
      `${leftovers.length} 頁有`,
    );
}

/*
 * ⚠️ 豁免標記要有上限。沒有上限的話，下一個人只要多貼幾張就能讓這一支永遠綠。
 *   目前用到的四處都在「季度批次匯入」那一頁（三處儲存鍵說明）。
 *   數量要改，請先確認新加的那一處真的是「儲存鍵」而不是給人讀的期別。
 */
/* ⚠️ 要站在那幾處所在的分頁上數，否則量到 0 就變成恆真。 */
await page
  .locator('nav button:has-text("季度批次匯入")')
  .first()
  .click()
  .catch(() => {});
await page.waitForTimeout(600);
const exempt = await page.evaluate(
  () => document.querySelectorAll("[data-period-storage-key]").length,
);
okk(
  "豁免標記真的存在而且沒有被濫用（顯示儲存鍵的地方 1～4 處）",
  exempt >= 1 && exempt <= 4,
  `目前 ${exempt} 處`,
);

okk("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 期別與年份兩顆鈕，每一個期間欄位都跟著走");
