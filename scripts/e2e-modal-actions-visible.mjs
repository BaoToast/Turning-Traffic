/*
 * ══════════════════════════════════════════════════════════════════════
 *  每一個視窗的「取消／確認／關閉」都要始終看得見
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（三支同步）：
 *   「畫面右下角的**取消／關閉功能，請保持始終可見**，不要像這張圖片視窗一樣，
 *     我必須把內容滑到最底部，才能看到取消／關閉的功能鍵。」
 *   「請**確實檢視每個有「取消、確認、關閉」的功能鍵**。」
 *
 * ── 這一支系統的作法與另外兩支不同，要講清楚 ────────────────────
 *
 * 全日交通量是「視窗整個可以捲、動作列 sticky 黏在底緣」；
 * 這一支不是——`.presence-modal` 是 `grid-template-rows: auto minmax(0,1fr) auto`
 * 的三列格線：**只有中間那一列（清單）會捲**，動作列本來就永遠在最後一列。
 * 那個寫法就是為了這件事做的（樣式表裡有當時的紀錄：只寫 max-height 時
 * footer 會被擠出視窗，Playwright 報 element is outside of the viewport）。
 *
 * ⚠️ 所以這一支**不是驗 sticky**，是驗那個格線結構有效，而且：
 *   ① 三列格線仍在（被改掉就紅）
 *   ② 視窗的子元素**剛好三個**——多一個就會多一列 auto，
 *      動作列會被擠到第四列而回到舊毛病
 *   ③ 中間那一列真的可以捲（否則下面的量測恆真）
 *   ④ 捲到**最上面**時，動作列裡**每一顆**按鈕都在畫面內
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8261;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/* ── 原始碼層：視窗數與動作列 ───────────────────────────────────── */
const source = readFileSync(join(here, "..", "app", "traffic-app.tsx"), "utf8");
const dialogs = (source.match(/className="modal presence-modal"/g) ?? []).length;
ok("前置：原始碼裡找得到視窗（否則整支恆真）", dialogs >= 2, `${dialogs} 個`);
const css = readFileSync(join(here, "..", "app", "globals.css"), "utf8");
ok(
  "視窗仍是「表頭／可捲清單／動作列」三列格線",
  /\.presence-modal\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/.test(
    css,
  ),
);

/* ── 造一份會跳裁決視窗的匿名活頁簿（與 e2e-presence-keep 同一套） ── */
function makeWorkbook({ arms, station, name, blankMovement = {} }) {
  const width = 14;
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  const rows = Array.from({ length: 12 }, () => Array(arms * width).fill(null));
  for (let approach = 0; approach < arms; approach += 1) {
    const base = approach * width;
    const code = String.fromCharCode(65 + approach);
    rows[1][base] = "站號：" + station;
    rows[1][base + 4] = "日期：115年04月15日";
    rows[2][base] = "站名：" + name;
    rows[3][base] = `路口編號：路口${code}`;
    rows[4][base] = "時間";
    vehicles.forEach((vehicle, vehicleIndex) => {
      rows[4][base + 1 + vehicleIndex * 3] = vehicle;
      movements.forEach((movement, movementIndex) => {
        rows[5][base + 1 + vehicleIndex * 3 + movementIndex] = movement;
      });
    });
    times.forEach((time, rowIndex) => {
      rows[6 + rowIndex][base] = time;
      vehicles.forEach((_unused, vehicleIndex) => {
        movements.forEach((movement, movementIndex) => {
          const column = base + 1 + vehicleIndex * 3 + movementIndex;
          rows[6 + rowIndex][column] =
            blankMovement[code] === movement
              ? null
              : 1 + ((approach + vehicleIndex + movementIndex + rowIndex) % 7);
        });
      });
    });
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: arms }).flatMap((_unused, approach) =>
    vehicles.map((__unused, vehicleIndex) => ({
      s: { r: 4, c: approach * width + 1 + vehicleIndex * 3 },
      e: { r: 4, c: approach * width + 3 + vehicleIndex * 3 },
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

/*
 * ⚠️ 刻意造**四個**三岔路口、每個都有一題，讓清單長到必須捲。
 *   只造一題的話視窗捲不動，第 ④ 項就恆真——那正是要避開的假通過。
 */
const files = [11, 12, 13, 14].map((serial, index) => ({
  name: `A00T00-${serial}三岔留空白路口${index + 1}.xlsx`,
  buffer: makeWorkbook({
    arms: 3,
    station: `A00T00-${serial}`,
    name: `三岔留空白路口${index + 1}`,
    blankMovement: { A: "右轉", B: "直進", C: "左轉" },
  }),
}));

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    /* ⚠️ 視窗刻意矮，才逼得出「內容比視窗長」。 */
    viewport: { width: 1440, height: 700 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};

await go("建立與管理計畫");
await page.locator(".project-form input").nth(0).fill("A00-MODAL");
await page.locator(".project-form input").nth(1).fill("動作列守門用計畫");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(800);

await go("季度批次匯入");
await page
  .locator('.content label:has-text("調查年度") input')
  .first()
  .fill("115");
await page
  .locator('.content label:has-text("季度") select')
  .first()
  .selectOption("1");
await page.waitForTimeout(400);
await page.evaluate(
  (payload) => {
    const zone = document.querySelector(".upload-card");
    const transfer = new DataTransfer();
    for (const item of payload) {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
      transfer.items.add(new File([bytes], item.name));
    }
    zone.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  },
  files.map((file) => ({
    name: file.name,
    base64: file.buffer.toString("base64"),
  })),
);
for (let wait = 0; wait < 90; wait += 1) {
  await page.waitForTimeout(400);
  const button = page.locator('button:has-text("確認寫入")').first();
  if ((await button.count()) && (await button.isEnabled())) break;
}
await page.locator('button:has-text("確認寫入")').first().click();
await page.waitForTimeout(6000);

ok(
  "前置：裁決視窗有跳出來（沒跳的話下面全部量不到）",
  (await page.locator(".presence-modal").count()) > 0,
);
if (!(await page.locator(".presence-modal").count())) {
  await browser.close();
  await server.close?.();
  console.error("\n❌ 視窗沒跳，不當成通過");
  process.exit(1);
}

const measured = await page.evaluate(() => {
  const modal = document.querySelector(".presence-modal");
  const list = modal.querySelector(".presence-list");
  if (list) list.scrollTop = 0;
  const bar =
    modal.querySelector(":scope > footer") ??
    modal.querySelector(":scope > .modal-actions");
  return {
    children: modal.children.length,
    rows: getComputedStyle(modal).gridTemplateRows.split(" ").length,
    listScrollable: list ? list.scrollHeight - list.clientHeight : -1,
    viewport: window.innerHeight,
    hasBar: !!bar,
    buttons: bar
      ? [...bar.querySelectorAll("button")].map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            text: (button.textContent || "").replace(/\s+/g, " ").trim(),
            bottom: Math.round(rect.bottom),
            width: Math.round(rect.width),
          };
        })
      : [],
  };
});

ok("視窗的子元素剛好三個（多一個就會把動作列擠到第四列）", measured.children === 3, `${measured.children} 個`);
ok("動作列存在", measured.hasBar);
ok(
  "前置：中間那一列真的長到需要捲（否則下面的量測恆真）",
  measured.listScrollable > 40,
  `可捲 ${measured.listScrollable}px`,
);
const offscreen = measured.buttons.filter(
  (button) => button.bottom > measured.viewport || button.width === 0,
);
ok(
  `捲到最上面時，動作列裡的每一顆按鈕都在畫面內（共 ${measured.buttons.length} 顆）`,
  measured.buttons.length > 0 && offscreen.length === 0,
  offscreen.length
    ? offscreen
        .map((button) => `${button.text}(底=${button.bottom}>${measured.viewport})`)
        .join("、")
    : measured.buttons.map((button) => button.text).join("｜"),
);
ok(
  "動作列裡確實有取消／確認／關閉類的按鈕",
  measured.buttons.some((button) =>
    ["取消", "確認", "關閉", "保留", "套用"].some((word) =>
      button.text.includes(word),
    ),
  ),
  measured.buttons.map((button) => button.text).join("｜"),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
await server.close?.();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 視窗的取消／確認／關閉在捲到最上面時都看得見");
