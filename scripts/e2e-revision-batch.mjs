/*
 * 端對端：還原點以「一次操作」為單位，而且刪得掉、刪了不影響現有資料。
 *
 * 起因（使用者實測回報）：只匯入一季就跳「儲存空間快滿了，這次存檔只保留
 * 20 筆還原點（原本 65 筆）」，使用者問「我才剛匯入第一筆，為什麼有 65 筆？」
 * 原因是舊版**每一筆紀錄各建一個還原點**：一次批次重新匯入覆蓋 65 個路口，
 * 就一口氣長出 65 個看不出差別的項目。而且舊版淘汰用 slice(0, 300) 是逐筆切的，
 * 會把同一次操作攔腰切斷——還原回去只還原一半，比沒有還原點更危險。
 *
 * ⚠️ 假通過陷阱三個：
 *  一、只驗「畫面上只列 1 筆」不夠——單一路口的清單本來就只列自己那幾筆，
 *      舊版也是 1 筆。要驗**整份狀態裡的批次數**。
 *  二、只驗「有刪除鈕」不夠——要驗按下去之後**紀錄本身沒有變**，
 *      否則刪還原點順手刪到資料也會過。
 *  三、上限要用「批次數」驗，而且要證明同一批不會被切一半。
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { readState } from "./read-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SEED = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));

const PORT = 8245;
const FILES = 3;
/*
 * ⚠️ 與 lib/final-features.ts 的 REVISION_BATCH_LIMIT 對齊。
 *   2026-09-15 由 30 降到 8（畫面上的還原入口已移除，這份紀錄改為純維護用）。
 *   兩邊寫死同一個數字是刻意的：改了一邊沒改另一邊，這一支會當場紅。
 */
const BATCH_LIMIT = 8;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/* 匿名四岔版型，與 e2e-reimport 相同，不含任何真實調查資料。 */
function makeWorkbook({ station, name }) {
  const rows = Array.from({ length: 12 }, () => Array(56).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  for (let approach = 0; approach < 4; approach++) {
    const base = approach * 14;
    rows[1][base] = "站號：" + station;
    rows[1][base + 4] = "日期：115年04月15日";
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
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["監測日誌"], ["監測日期", "115年04月15日"]]),
    "監測日誌",
  );
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const payload = Array.from({ length: FILES }, (_, index) => {
  const station = "A00T00-" + String(index + 1).padStart(2, "0");
  const name = "還原點示範路口" + (index + 1);
  return {
    name: `${station}${name}.xlsx`,
    base64: makeWorkbook({ station, name }).toString("base64"),
  };
});

const batchCount = (state) =>
  new Set(
    (state?.recordRevisions ?? []).map((item) => item.batchId || item.id),
  ).size;

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());

/* ── 一、一次批次重新匯入 = 一個還原點 ── */
{
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1050 },
    locale: "zh-TW",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("dialog", (d) => d.accept());
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  const go = async (label) => {
    await page.locator(`nav button:has-text("${label}")`).first().click();
    await page.waitForTimeout(600);
  };
  await go("建立與管理計畫");
  await page.locator(".project-form input").nth(0).fill("A00-REV");
  await page.locator(".project-form input").nth(1).fill("還原點示範計畫");
  await page.locator('button:has-text("建立計畫")').click();
  await page.waitForTimeout(800);

  const importOnce = async () => {
    await go("季度批次匯入");
    await page.locator('.content label:has-text("調查年度") input').first().fill("115");
    await page.locator('.content label:has-text("季度") select').first().selectOption("2");
    await page.waitForTimeout(400);
    await page.evaluate(({ payload }) => {
      const zone = document.querySelector(".upload-card");
      const transfer = new DataTransfer();
      for (const item of payload) {
        const binary = atob(item.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        transfer.items.add(
          new File([bytes], item.name, {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
        );
      }
      zone.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    }, { payload });
    for (let wait = 0; wait < 50; wait += 1) {
      await page.waitForTimeout(400);
      const button = page.locator('button:has-text("確認寫入")').first();
      if ((await button.count()) && (await button.isEnabled())) break;
    }
    const button = page.locator('button:has-text("確認寫入")').first();
    if (!(await button.count())) return false;
    await button.click();
    await page.waitForTimeout(3000);
    return true;
  };

  ok("前置：第一次匯入完成", await importOnce());
  const afterFirst = await readState(page);
  /*
   * 誠實標註：這一項對未修正的 v2.1.52 也是綠的。留著是「不許改壞」的鎖——
   * 把 saveRevisions 改成無條件呼叫的話，第一次匯入就會冒出空的還原點。
   */
  ok(
    "第一次匯入（沒有覆蓋任何東西）不該產生還原點",
    batchCount(afterFirst) === 0,
    `${batchCount(afterFirst)} 個批次／${(afterFirst?.recordRevisions ?? []).length} 筆`,
  );
  ok(
    "前置：三份都寫進去了",
    (afterFirst?.records ?? []).length === FILES,
    `${(afterFirst?.records ?? []).length} 筆`,
  );

  ok("前置：第二次（覆蓋）匯入完成", await importOnce());
  const afterSecond = await readState(page);
  const revisions = afterSecond?.recordRevisions ?? [];
  ok(
    `一次覆蓋 ${FILES} 個路口只能是 1 個還原點`,
    batchCount(afterSecond) === 1,
    `${batchCount(afterSecond)} 個批次`,
  );
  /*
   * 誠實標註：這一項對未修正的 v2.1.52 也是綠的（舊版分成 3 個還原點，
   * 一樣涵蓋 3 個路口）。它是「不許改壞」的鎖，不是問題重現——
   * 重現的是上面那一項「只能是 1 個還原點」。
   */
  ok(
    "那一個還原點要涵蓋全部 3 個路口（不可以只留一部分）",
    revisions.length === FILES &&
      new Set(revisions.map((item) => item.recordId)).size === FILES,
    `${revisions.length} 筆快照，涵蓋 ${new Set(revisions.map((i) => i.recordId)).size} 個路口`,
  );
  ok(
    "還原點的說明要寫出涵蓋幾個路口",
    revisions.every((item) => /涵蓋 3 個路口/.test(item.batchLabel || "")),
    revisions[0]?.batchLabel || "（沒有 batchLabel）",
  );

  /* ── 二、畫面上**不可以**再出現還原點清單（2026-09-15 使用者要求移除）── */
  /*
   * ⚠️ 這一段原本驗的是「清單上有刪除鈕、有說明文字、刪了不動資料」。
   *   2026-09-15 使用者裁示把整塊「版本差異與還原」從畫面移除：
   *     「還原清單和還原此版本的按鈕，我是覺得使用者不會去使用，也不會去查看。
   *       寧願直接刪除該季資料，重新匯入……如果你維護會用到，那一樣放在你
   *       看的到的程式碼裡就好了，不用顯示給使用者看」
   *     「我看不懂還原點會還原些什麼事情，不敢去賭」
   *
   *   所以這幾條**不是壞掉，是過時**：它們釘住的是已經被授權移除的介面。
   *   直接刪掉會留下一個空洞（「有沒有真的移除」沒有人驗），
   *   所以改成**反過來驗**：畫面上不可以再出現那些入口。
   *
   * ⚠️ 同時要驗**資料層照常運作**——使用者要的是「不要顯示給使用者看」，
   *   不是「不要再產生還原點」。資料還在的證據就在上面第一段（還原點有建立、
   *   涵蓋 3 個路口）與下面第三段（上限 8 次、整批進出）。
   *   只驗「畫面上沒有」的話，「把還原點功能整個拿掉」也會變成綠的。
   */
  await go("流量核對工作台");
  await page.waitForTimeout(1200);
  const pageText = await page.evaluate(() =>
    document.body.innerText.replace(/\s+/g, " "),
  );
  ok(
    "畫面上不可以再有「版本差異與還原」那一塊",
    (await page.locator('[data-testid="revision-history"]').count()) === 0,
    `找到 ${await page.locator('[data-testid="revision-history"]').count()} 塊`,
  );
  ok(
    "畫面上不可以再有「刪除這個還原點」按鈕",
    (await page.locator('button:has-text("刪除這個還原點")').count()) === 0,
  );
  ok(
    "畫面上不可以再有「還原此版本」按鈕",
    (await page.locator('button:has-text("還原此版本")').count()) === 0,
  );
  ok(
    "畫面上也不可以再留下還原點清單的說明文字",
    !/刪除還原點不會影響現在畫面上的任何資料/.test(pageText),
    pageText.slice(0, 80),
  );
  /*
   * ⚠️ 前置：這一頁要真的畫出來了。
   *   整頁空白的話，上面四條「找不到」全部會變成恆真的假綠。
   */
  ok(
    "前置：流量核對工作台真的畫出來了（空白的話上面四條恆真）",
    pageText.length > 200,
    `${pageText.length} 個字`,
  );
  /*
   * ⚠️ 介面拿掉了，但**還原點資料照常產生**——這是使用者指定的：
   *   「還原點資料本身照常繼續產生與保存……拿掉的只有畫面上那一顆
   *     沒有人敢按的按鈕」。所以這裡再確認一次資料還在。
   */
  const still = await readState(page);
  ok(
    "⚠️ 介面拿掉了，但還原點資料**還在**（不是連功能一起刪掉）",
    batchCount(still) > 0,
    `${batchCount(still)} 個批次`,
  );
  ok("整段流程不可以有未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
}

/* ── 三、上限：超過 30 次操作要整批淘汰最舊的 ── */
{
  const context = await browser.newContext({ locale: "zh-TW" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("dialog", (d) => d.accept());
  /*
   * 40 次操作、每次涵蓋 2 個路口，共 80 筆快照。
   * 舊版逐筆 slice(0, 300) 會 80 筆全留（40 個批次）；
   * 新版應留 30 個批次、60 筆，而且**不可以出現只剩一半的批次**。
   */
  const seeded = structuredClone(SEED);
  seeded.recordRevisions = [];
  for (let batch = 0; batch < 40; batch += 1) {
    for (let member = 0; member < 2; member += 1) {
      const source = SEED.records[member % SEED.records.length];
      seeded.recordRevisions.push({
        id: `R-${batch}-${member}`,
        recordId: source.id,
        savedAt: new Date(Date.now() - batch * 60000).toISOString(),
        reason: "測試用還原點",
        snapshot: structuredClone(source),
        batchId: `B-${batch}`,
        batchLabel: "測試用還原點，涵蓋 2 個路口",
        batchSize: 2,
      });
    }
  }
  await page.addInitScript((text) => {
    localStorage.setItem("turning-traffic-state-v2", text);
  }, JSON.stringify(seeded));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  /* 讀取後要有一次寫入，淘汰結果才會落地 */
  await page.locator('nav button:has-text("建立與管理計畫")').first().click();
  await page.waitForTimeout(600);
  await page.locator(".project-form input").nth(0).fill("A00-TRIM");
  await page.locator(".project-form input").nth(1).fill("上限測試");
  await page.locator('button:has-text("建立計畫")').click();
  await page.waitForTimeout(2500);
  const state = await readState(page);
  const items = state?.recordRevisions ?? [];
  const groups = new Map();
  for (const item of items) {
    const key = item.batchId || item.id;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  ok(
    `還原點最多保留 ${BATCH_LIMIT} 次操作`,
    groups.size <= BATCH_LIMIT,
    `保留了 ${groups.size} 次操作、${items.length} 筆快照`,
  );
  ok(
    "留下來的每一次操作都要完整（不可以只剩一半）",
    [...groups.values()].every((count) => count === 2),
    [...groups.values()].filter((count) => count !== 2).length + " 個批次不完整",
  );
  ok(
    "留下來的要是最新的那幾次，不是最舊的",
    [...groups.keys()].includes("B-0") && ![...groups.keys()].includes("B-39"),
    [...groups.keys()].slice(0, 3).join(", "),
  );
  ok("上限情境不可以有未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
}

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
