/*
 * ══════════════════════════════════════════════════════════════════
 *  不足 24 小時的調查，「全調查時段」與「全調查時段尖峰」都要有值
 * ══════════════════════════════════════════════════════════════════
 *
 * ── 為什麼需要這一支 ──────────────────────────────────────────
 *
 * v2.1.64 把這兩個時段從「全日時段／全日尖峰小時」改名成
 * 「全調查時段／全調查時段尖峰」，而且說明文字、算不出來的理由、
 * 尖峰視窗的挑選（peakWindowsFor）全都跟著改了——
 * **只有資料那一條沒改**：`scopeValues()`、`syncRouteTotals()` 與
 * `scopeFlowFor()` 仍然卡著 `coversFullDay()`（≥ 24 小時）。
 *
 * 使用者 2026-09-11 實測回報：
 *   「路口轉向程式，各路口駛入／駛出流量，目前已經改成全調查時段，
 *     為什麼仍就沒有全調查時段尖峰、全調查時段的數值呢？」
 *
 * 他的畫面上，抬頭誠實寫著「全調查時段：4 小時」，
 * 底下那兩整欄卻是「駛入 －／駛出 －」——**同一頁自相矛盾**。
 *
 * ⚠️ 當時的單元測試全部通過。原因是它們只驗到**預覽**那一層
 *   （preview.peakWindows.DAY 算不算得出來），沒有人驗到
 *   「寫成 TrafficRecord 之後畫面上有沒有數字」。
 *   這一支補的就是那一段：真的匯入、真的看畫面。
 *
 * ── 刻意迴避的假通過 ────────────────────────────────────────
 *
 * ・不可以只驗「表格有那兩欄」——欄位一直都在，裡面是「－」。
 * ・不可以只驗「不是 －」——要同時確認這份調查**真的**不足 24 小時
 *   （前置項），否則哪天樣本檔變成 24 小時，這支就變成恆真。
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/**
 * 造一份**4 小時**的四叉路口調查表：07:00–09:00 與 17:00–19:00 兩段，
 * 15 分鐘一格，共 16 格 × 15 分 = 4 小時。
 *
 * ⚠️ 中間 09:00–17:00 刻意完全沒有格子。全調查時段尖峰的視窗
 *   **不可以**橫跨那八小時的空隙——那是 rollingPeak 要守的事，
 *   這裡順便給它一個真的會踩到的樣本。
 */
function makeFourHourWorkbook({ station, name }) {
  const times = [];
  for (const hour of [7, 8, 17, 18])
    for (const quarter of [0, 15, 30, 45]) {
      const from = `${String(hour).padStart(2, "0")}:${String(quarter).padStart(2, "0")}`;
      const toMinutes = hour * 60 + quarter + 15;
      const to = `${String(Math.floor(toMinutes / 60)).padStart(2, "0")}:${String(toMinutes % 60).padStart(2, "0")}`;
      times.push(`${from}~${to}`);
    }
  const rows = Array.from({ length: 6 + times.length }, () => Array(56).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  for (let approach = 0; approach < 4; approach++) {
    const base = approach * 14;
    rows[1][base] = "站號：" + station;
    rows[1][base + 4] = "監測日期：115年01月26日(平日)";
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
          2 + ((approach + column + rowIndex) % 9);
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
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const server = await serve(8127);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:8127/");
await page.waitForTimeout(1200);

const go = async (label) => {
  await page
    .locator(`nav button:has-text("${label}"), aside button:has-text("${label}")`)
    .first()
    .click();
  await page.waitForTimeout(700);
};

/* ── 建計畫 ── */
await go("建立與管理計畫");
await page.locator('.project-form input').first().fill("PS-01");
await page.locator('.project-form input').nth(1).fill("部分時段測試");
await page.locator('.project-form button:has-text("建立計畫")').first().click();
await page.waitForTimeout(700);

/* ── 匯入那份 4 小時的調查表 ── */
await go("季度批次匯入");
await page.locator(".import-period input").first().fill("115");
await page.locator(".import-period select").first().selectOption("1");
await page.waitForTimeout(300);
const buffer = makeFourHourWorkbook({
  station: "T99-01",
  name: "測試北路－測試東路口",
});
/*
 * ⚠️ 用「拖曳」而不是 setInputFiles。
 *   這一頁的檔案輸入框藏在 .upload-card 裡、而且不是唯一的
 *   input[type=file]，setInputFiles 打到的那一個不會觸發匯入流程——
 *   症狀是「跑完之後畫面完全沒變」，看起來像匯入失敗，其實是根本沒送進去。
 *   其他 E2E（e2e-period-date）早就改用拖曳了，這裡沿用同一招。
 */
await page.locator(".upload-card").first().evaluate((card, base64) => {
  const transfer = new DataTransfer();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  transfer.items.add(
    new File([bytes], "09999T99-01_四小時測試路口.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  card.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
}, Buffer.from(buffer).toString("base64"));
await page.waitForTimeout(4500);
const commit = page.locator('button:has-text("確認寫入")');
if (await commit.count()) {
  await commit.first().click();
  await page.waitForTimeout(3500);
}

/* ── 看「各路口駛入／駛出流量」 ── */
await go("各路口駛入／駛出流量");
await page.waitForTimeout(900);

const snapshot = await page.evaluate(() => {
  const headline =
    document.querySelector(".content h2")?.parentElement?.innerText ?? "";
  const headers = [...document.querySelectorAll(".content table thead th")].map(
    (th) => th.innerText.replace(/\s+/g, " ").trim(),
  );
  const rows = [...document.querySelectorAll(".content table tbody tr")].map(
    (tr) =>
      [...tr.querySelectorAll("th,td")].map((td) =>
        td.innerText.replace(/\s+/g, " ").trim(),
      ),
  );
  return { headline: headline.replace(/\s+/g, " ").trim(), headers, rows };
});

/*
 * 前置一：這份調查真的**不足 24 小時**。
 * 沒有這一項的話，樣本哪天變成 24 小時，下面每一條都會自動變綠。
 */
ok(
  "前置：這是一份不足 24 小時的調查（抬頭要寫出實際涵蓋時數）",
  /全調查時段：\s*4\s*小時/.test(snapshot.headline),
  snapshot.headline.slice(0, 160),
);

const columnOf = (needle) =>
  snapshot.headers.findIndex((h) => h.includes(needle));
const fullColumn = columnOf("全調查時段 駛入");
const dayColumn = columnOf("全調查時段尖峰 駛入");

/* 前置二：那兩欄真的在表格裡（找不到的話下面會量到 undefined 而恆真） */
ok(
  "前置：表格裡找得到「全調查時段」與「全調查時段尖峰」兩欄",
  fullColumn >= 0 && dayColumn >= 0,
  `全調查時段欄=${fullColumn}、尖峰欄=${dayColumn}｜表頭：${snapshot.headers.join(" / ")}`,
);

/*
 * ⚠️ 這一段的斷言在寫的當下改過一次，理由很重要：
 *
 *   我原本只驗「那一欄不是整排『－』」。用舊版程式跑一次去證明它會紅，
 *   結果**它照樣是綠的**——因為舊版那一欄印的是「駛入 0 駛出 0」，
 *   不是「－」。0 和「－」對使用者是同一件事（都沒有資訊），
 *   但對一個只認「－」的斷言來說是天差地遠，那條守門等於沒有。
 *
 *   現在改成守一條**真正的不變量**：
 *   4 小時的總量，一定比它裡面任何一個小時的尖峰量**大**。
 *   0 不可能通過，而且這條規則本身就是對的，不會因為換樣本而失效。
 */
const cellNumber = (text, which) => {
  const match = new RegExp(which + "\\s*([\\d,.]+)").exec(text ?? "");
  return match ? Number(match[1].replace(/,/g, "")) : NaN;
};
const amColumn = columnOf("AM Peak 駛入／駛出（PCU/hr）");
ok(
  "前置：找得到 AM Peak 那一欄（要拿它當比較基準）",
  amColumn >= 0,
  `欄位=${amColumn}`,
);
if (fullColumn >= 0 && amColumn >= 0 && snapshot.rows.length) {
  const compared = snapshot.rows.map((row) => ({
    full: cellNumber(row[fullColumn], "駛入"),
    am: cellNumber(row[amColumn], "駛入"),
  }));
  ok(
    "「全調查時段」駛入量要大於同一支線的 AM Peak（4 小時的總量必然大於其中任何一小時）",
    compared.every((item) => item.full > item.am && item.am > 0),
    compared
      .slice(0, 4)
      .map((item) => `全${item.full} vs AM${item.am}`)
      .join(" ｜ "),
  );
}
if (dayColumn >= 0 && snapshot.rows.length) {
  ok(
    "「全調查時段尖峰」駛入量要大於 0（4 小時的調查照樣挑得出一小時）",
    snapshot.rows.every((row) => cellNumber(row[dayColumn], "駛入") > 0),
    snapshot.rows
      .slice(0, 3)
      .map((row) => row[dayColumn])
      .join(" ｜ "),
  );
}

/*
 * 抬頭那一行也要寫出全調查時段尖峰**是哪一個小時**。
 * 只有數字沒有時段的話，讀者不知道那一小時是幾點——
 * 而且那正是使用者截圖裡「全調查時段尖峰：－」最先看到的地方。
 */
ok(
  "抬頭要寫出全調查時段尖峰落在哪一個小時",
  /全調查時段尖峰：\s*\d{2}:\d{2}–\d{2}:\d{2}/.test(snapshot.headline),
  snapshot.headline.slice(0, 160),
);
/*
 * ⚠️ 那個視窗不可以落在 09:00–17:00——中間那八小時一格資料都沒有，
 *   任何落在那裡的視窗都是橫跨空隙算出來的假尖峰。
 */
const window = /全調查時段尖峰：\s*(\d{2}):(\d{2})–(\d{2}):(\d{2})/.exec(
  snapshot.headline,
);
if (window) {
  const startMinutes = Number(window[1]) * 60 + Number(window[2]);
  const endMinutes = Number(window[3]) * 60 + Number(window[4]);
  const inside = (m) =>
    (m >= 7 * 60 && m <= 9 * 60) || (m >= 17 * 60 && m <= 19 * 60);
  ok(
    "全調查時段尖峰的視窗沒有橫跨 09:00–17:00 的調查空隙",
    inside(startMinutes) && inside(endMinutes),
    `${window[0]}`,
  );
}

ok("整段流程沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" ｜ "));

await browser.close();
await server.close?.();
console.log(
  problems.length
    ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}`
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
