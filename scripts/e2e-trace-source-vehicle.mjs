/**
 * ══════════════════════════════════════════════════════════════════════
 *  N-5：逐格追溯表不可以把**原始車種名**弄丟
 * ══════════════════════════════════════════════════════════════════════
 *
 * 「原始儲存格與換算來源」那張表的用途只有一個：**被質疑時逐格指出來源**。
 * 業主問「這個 1,763 PCU 怎麼算的」，這張表是唯一答得出來的東西——
 * 前提是表上的車種名要對得回**調查表上那一欄的欄名**。
 *
 * 缺陷：車種歸類之後（例如「聯結車」併入「特種車」），這張表只印歸類後的
 * 「特種車」，原始欄名就此消失。使用者翻回 Excel 找不到「特種車」那一欄，
 * 這張表就失去它唯一的用途。
 *
 * 修法：逐格資料同時留 `sourceVehicleLabel`（原始欄名）與 `vehicleLabel`
 *（計入的類型），畫面上兩者不同時兩個都印，匯出也分成兩欄。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 *
 * 一、**前置一定要先造出「被併走」的情形**，否則兩個名字本來就一樣，
 *     整支變成恆真。這裡先把一個自訂車種併入標準車種再看表。
 * 二、**只驗「表上有原始車種名」不夠**：也要驗「計入的類型還在」——
 *     只印原始名的話，使用者會不知道這一格是用哪一種當量換算的。
 * 三、**只驗畫面不夠**：核對的人實際上是拿匯出的 Excel 去對，
 *     所以匯出的欄位也要驗（這裡驗畫面上那張表，Excel 由單元測試釘住）。
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const PORT = 8303;

/*
 * ⚠️ 一定要**真的匯入一份檔案**，不可以用既有的 seed。
 *   seed 是舊版備份移轉過來的，沒有保存儲存格座標
 *  （畫面上寫著「此資料由舊版備份移轉，未保存儲存格座標」），
 *   逐格追溯表是 0 格——那樣整支會變成恆真的假綠。
 *   我第一版就是用 seed 寫的，跑出來 0 列才發現。
 *
 * ⚠️ 活頁簿裡要有一個**非標準車種**（這裡用「大客車」），
 *   後面才有東西可以併走。只有四個標準車種的話併不了，也是恆真。
 */
function makeWorkbook({ arms = 4, station, name }) {
  const vehicles = ["機車", "小型車", "大型車", "特種車", "大客車"];
  const movements = ["左轉", "直進", "右轉"];
  const width = vehicles.length * 3 + 2;
  const rows = Array.from({ length: 12 }, () => Array(arms * width).fill(null));
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
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
      vehicles.forEach((_, vehicleIndex) => {
        movements.forEach((__, movementIndex) => {
          rows[6 + rowIndex][base + 1 + vehicleIndex * 3 + movementIndex] =
            2 + ((approach + vehicleIndex + movementIndex + rowIndex) % 8);
        });
      });
    });
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: arms }).flatMap((_, approach) =>
    vehicles.map((__, vehicleIndex) => ({
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

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 950 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

/* ── 建計畫並真的匯入一份檔案（逐格追溯資料只有匯入才會產生）── */
const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(700);
};
await go("建立與管理計畫");
await page.locator(".project-form input").nth(0).fill("A00-TRC");
await page.locator(".project-form input").nth(1).fill("逐格追溯守門");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(700);
await go("季度批次匯入");
await page.locator('.content label:has-text("調查年度") input').first().fill("115");
await page
  .locator('.content label:has-text("季度") select')
  .first()
  .selectOption("2");
await page.waitForTimeout(300);
await page.evaluate(
  (payload) => {
    const zone = document.querySelector(".upload-card");
    const transfer = new DataTransfer();
    const binary = atob(payload.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    transfer.items.add(
      new File([bytes], payload.name, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    zone.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  },
  {
    name: "A00T01-01逐格追溯示範路口.xlsx",
    base64: makeWorkbook({
      station: "A00T01-01",
      name: "逐格追溯示範路口",
    }).toString("base64"),
  },
);
for (let wait = 0; wait < 60; wait += 1) {
  await page.waitForTimeout(400);
  if (await page.locator("#import-preview-panel").count()) break;
}
await page.waitForTimeout(1200);
const commit = page.locator('button:has-text("確認寫入")').first();
ok("前置：匯入預覽出得來，而且確認鈕按得下去", (await commit.count()) > 0);
if (await commit.count()) {
  await commit.click();
  await page.waitForTimeout(2500);
}

const gotoTab = async (label) => {
  const found = await page.evaluate((text) => {
    const list = [...document.querySelectorAll("aside nav button")].filter(
      (button) => !button.className.includes("nav-collapse"),
    );
    const target = list.find((button) => (button.textContent || "").includes(text));
    if (!target) return false;
    target.click();
    return true;
  }, label);
  await page.waitForTimeout(1200);
  return found;
};

/* ══ 前置：造出「有車種被併走」的情形 ══════════════════════════ */
console.log("\n══ 前置：把一個車種併入標準車種 ══");
ok("前置：切得到「車種轉向當量」", await gotoTab("車種轉向當量"));
/*
 * ⚠️ 挑一個**還沒被併走**的非標準車種來併。
 *   直接挑第一個下拉會挑到標準車種（那幾列沒有下拉），或挑到已經併走的，
 *   兩種都造不出這一支要的情形。
 */
const merged = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("tr")];
  for (const row of rows) {
    const select = row.querySelector("select");
    if (!select) continue;
    const name = row.querySelector("td strong")?.textContent?.trim() || "";
    const target = [...select.options].find((option) =>
      option.textContent.startsWith("併入："),
    );
    if (!target) continue;
    if (select.value !== select.options[0].value) continue; /* 已經併走了 */
    select.value = target.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return { name, into: target.textContent.replace("併入：", "").trim() };
  }
  return null;
});
await page.waitForTimeout(1400);
ok(
  "前置：真的把某個車種併走了（沒併的話這一支恆真）",
  Boolean(merged),
  merged ? `${merged.name} → ${merged.into}` : "找不到可以併的車種",
);

/*
 * ⚠️ 併完之後要**重新匯入同一份檔案**，這一支才驗得到東西。
 *
 *   逐格追溯資料（sourceTrace）是**匯入當下**算好存進紀錄的。
 *   第一次匯入時「大客車」還沒有任何歸類設定，所以那時存下來的
 *   vehicleLabel 本來就是「大客車」——兩個名字一樣，看不出有沒有弄丟。
 *
 *   真正會出事的是**併完之後再匯入**（使用者的實際流程：先匯一季、
 *   發現車種設定不對、改好設定、重新匯入覆蓋）。那一次 analysisVehicle
 *   已經是併入的目標，舊版就是在這裡把「大客車」這個原始欄名丟掉的。
 *
 *   ⚠️ 少了這一步，這一支會**假綠**：第一次匯入的資料本來就帶著原始名。
 */
console.log("\n══ 前置：併完之後重新匯入同一份檔案（覆蓋）══");
await go("季度批次匯入");
await page.locator('.content label:has-text("調查年度") input').first().fill("115");
await page
  .locator('.content label:has-text("季度") select')
  .first()
  .selectOption("2");
await page.waitForTimeout(300);
await page.evaluate(
  (payload) => {
    const zone = document.querySelector(".upload-card");
    const transfer = new DataTransfer();
    const binary = atob(payload.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    transfer.items.add(
      new File([bytes], payload.name, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    zone.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  },
  {
    name: "A00T01-01逐格追溯示範路口.xlsx",
    base64: makeWorkbook({
      station: "A00T01-01",
      name: "逐格追溯示範路口",
    }).toString("base64"),
  },
);
for (let wait = 0; wait < 60; wait += 1) {
  await page.waitForTimeout(400);
  if (await page.locator("#import-preview-panel").count()) break;
}
await page.waitForTimeout(1200);
const commit2 = page.locator('button:has-text("確認寫入")').first();
ok("前置：第二次匯入的確認鈕按得下去", (await commit2.count()) > 0);
if (await commit2.count()) {
  await commit2.click();
  await page.waitForTimeout(2500);
}

/* ══ 一、逐格追溯表上兩個名字都要在 ══════════════════════════ */
console.log("\n══ 一、逐格追溯要對得回原始調查表的欄名 ══");
ok("前置：切得到「流量核對工作台」", await gotoTab("流量核對工作台"));
await page.evaluate(() => {
  const node = document.getElementById("audit-trace");
  if (node) node.open = true;
});
await page.waitForTimeout(900);

const table = await page.evaluate(() => {
  const host = document.getElementById("audit-trace");
  if (!host) return null;
  const rows = [...host.querySelectorAll("tbody tr")];
  return {
    rowCount: rows.length,
    /* 第 4 欄是車種。 */
    vehicleCells: rows
      .slice(0, 40)
      .map((row) =>
        (row.children[3]?.textContent || "").replace(/\s+/g, " ").trim(),
      ),
  };
});
ok(
  "前置：這張表真的有列（0 列的話下面全部恆真）",
  Boolean(table) && table.rowCount > 0,
  table ? `${table.rowCount} 列` : "找不到表",
);
if (table && merged) {
  const withSource = table.vehicleCells.filter((text) =>
    text.includes(merged.name),
  );
  ok(
    `⚠️ ① 被併走的「${merged.name}」在表上仍然看得到**原始欄名**`,
    withSource.length > 0,
    withSource.length
      ? `${withSource.length} 列，例：${withSource[0]}`
      : `表上只剩歸類後的名字：${[...new Set(table.vehicleCells)].slice(0, 5).join("／")}`,
  );
  ok(
    `⚠️ ① 而且同一格要寫出**計入哪一個類型**（否則不知道用哪種當量換算）`,
    withSource.some((text) => text.includes("計入")),
    withSource[0] || "",
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 逐格追溯同時保留原始車種名與計入的類型");
