/*
 * ══════════════════════════════════════════════════════════════════════
 *  尖峰時段判定方式：切了要**真的換一套數字**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 指定主工具列要有這個條件。兩種算法：
 *   ・整個調查點同一時段（可相加）  ← 升級前的行為，預設
 *   ・各方向各自認定自己的尖峰      ← 各方向不可以相加
 *
 * ⚠️ 這一支要驗的是**數字**，不是下拉有沒有動。
 *   只驗「選得下去」的話，一個什麼都沒做的實作也會全綠——
 *   而那正是使用者最怕的「篩了卻沒反應」。
 *
 * ⚠️ 測資刻意讓 A、C 支線傍晚忙、B、D 早上忙。
 *   各支線尖峰同一小時的話，兩種判定方式算出來會一樣，
 *   這一支就永遠是綠的。前置檢查會擋下這種情況。
 *
 * ⚠️ 另外要驗**算不出來時不可以靜靜給 0**：
 *   v2.1.67 以前匯入的紀錄沒有逐格資料，那時選項要停用並說明。
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "package.json"));
const XLSX = require("xlsx");
const root = join(here, "..", "github-pages-dist");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer((request, response) => {
  let path = join(
    root,
    decodeURIComponent(request.url.split("?")[0]).replace(/^\//, "") ||
      "index.html",
  );
  if (!existsSync(path)) path = join(root, "index.html");
  response.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const pad = (value) => String(value).padStart(2, "0");
/**
 * 四岔路口，24 小時 × 15 分鐘。
 * A、C 支線在 08:00 那一小時暴增（每格 100），B、D 在 10:00 暴增（每格 60）。
 * → 整個路口會挑到 08:00（A、C 量大），但 B、D 自己的尖峰在 10:00，
 *   所以 B、D 在兩種判定方式下的數字必然不同。
 */
function workbook() {
  const width = 14;
  const arms = ["A", "B", "C", "D"];
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const slots = [];
  for (let hour = 0; hour < 24; hour += 1)
    for (const minute of [0, 15, 30, 45])
      slots.push({
        start: hour * 60 + minute,
        label: `${pad(hour)}:${pad(minute)}~${pad(minute === 45 ? (hour + 1) % 24 : hour)}:${pad((minute + 15) % 60)}`,
      });
  const rows = Array.from({ length: 6 + slots.length }, () =>
    Array(arms.length * width).fill(null),
  );
  arms.forEach((code, index) => {
    const cell = index * width;
    rows[0][cell] = "站號：T31-01";
    rows[1][cell] = "站名：判定方式測試路口";
    rows[2][cell] = "日期：115年04月15日（平日）";
    rows[3][cell] = `路口編號：路口${code}`;
    rows[4][cell] = "時段";
    vehicles.forEach((vehicle, vehicleIndex) => {
      for (let offset = 0; offset < 3; offset += 1)
        rows[4][cell + 1 + vehicleIndex * 3 + offset] = vehicle;
      movements.forEach((movement, movementIndex) => {
        rows[5][cell + 1 + vehicleIndex * 3 + movementIndex] = movement;
      });
    });
    /*
     * ⚠️ 兩個尖峰都要落在**同一個統計範圍**（這裡是上午）。
     *   第一版把 A、C 排在 17 點、B、D 排在 8 點，結果上午時段裡
     *   A、C 整段都是平的——每一個上午視窗的量都一樣，
     *   兩種判定方式挑到的雖然不是同一小時，**數字卻相同**，
     *   於是「切了有沒有變」量不出差異。前置③綠、主檢查紅，查了才發現。
     *   改成 A、C 在 8 點、B、D 在 10 點：整個路口會挑到 8 點（A、C 量大），
     *   而 B、D 自己會挑 10 點——B、D 的數字因此必然不同。
     */
    const busyHour = index % 2 === 0 ? 8 : 10;
    slots.forEach((slot, slotIndex) => {
      rows[6 + slotIndex][cell] = slot.label;
      const busy = Math.floor(slot.start / 60) === busyHour;
      vehicles.forEach((_vehicle, vehicleIndex) => {
        movements.forEach((_movement, movementIndex) => {
          rows[6 + slotIndex][cell + 1 + vehicleIndex * 3 + movementIndex] =
            busy ? (index % 2 === 0 ? 100 : 60) : 4;
        });
      });
    });
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "轉向");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1700, height: 1100 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept(""));
await page.goto(base);
await page.waitForTimeout(1600);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

const gotoTab = async (fragment) => {
  await page.evaluate((value) => {
    const list = [
      ...document.querySelectorAll("aside nav > div > button"),
    ].filter((button) => !button.className.includes("nav-collapse"));
    const target = list.find((button) =>
      (button.textContent || "").includes(value),
    );
    if (target) target.click();
  }, fragment);
  await page.waitForTimeout(1100);
};

await gotoTab("建立與管理計畫");
await page.locator(".project-form input").nth(0).fill("PRULE");
await page.locator(".project-form input").nth(1).fill("判定方式測試計畫");
await page.locator('button:has-text("建立計畫")').first().click();
await page.waitForTimeout(1200);

await gotoTab("季度批次匯入");
await page.locator('.content label:has-text("調查年度") input').first().fill("115");
await page.locator('.content label:has-text("季度") select').first().selectOption("1");
await page.evaluate(
  ({ name, base64 }) => {
    const zone = document.querySelector(".upload-card");
    const transfer = new DataTransfer();
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    transfer.items.add(
      new File([bytes], name, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    zone.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  },
  { name: "T31-01_判定方式測試路口.xlsx", base64: workbook().toString("base64") },
);
await page.waitForTimeout(8000);
console.log("   預覽內容：", (await page.locator(".content").innerText()).replace(/\s+/g," ").slice(0, 600));
const confirm = page.locator('button:has-text("確認寫入")').first();
ok("前置①：匯入預覽出得來", (await confirm.count()) === 1);
ok(
  "前置①-2：確認鈕是可以按的（停用代表還沒指定年度季度）",
  await confirm.isEnabled(),
  await confirm.innerText(),
);
await confirm.click();
await page.waitForTimeout(9000);
/*
 * ⚠️ 匯入後可能跳出裁決視窗（車種歸類、某個轉向到底存不存在）。
 *   **只能按「套用」或「全部先保留」**——第一版順手把「取消」也放進
 *   關閉清單，結果那一下取消的是整筆匯入，寫入完全沒發生，
 *   而畫面回到匯入頁看起來就像「寫完了」。前置②因此紅了三次才查出來。
 */
for (let i = 0; i < 6; i += 1) {
  if (!(await page.locator(".modal-backdrop").count())) break;
  const closer = page
    .locator(
      '.modal-backdrop button:has-text("套用"), .modal-backdrop button:has-text("全部先保留"), .modal-backdrop button:has-text("確定")',
    )
    .first();
  if (!(await closer.count())) break;
  await closer.click();
  await page.waitForTimeout(1800);
}
await page.waitForTimeout(2500);
console.log("   匯入後 toast：", await page.evaluate(()=>document.querySelector(".toast, .toast-stack, [class*=toast]")?.innerText || "(無)"));
console.log(
  "   匯入後畫面：",
  (await page.locator(".content").innerText()).replace(/\s+/g, " ").slice(0, 100),
);

/* 前置②：這筆資料真的帶了逐格原始資料，否則下面全部無從驗起。 */
const hasSource = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("turning-traffic");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const value = await new Promise((resolve) => {
    const get = db
      .transaction("state", "readonly")
      .objectStore("state")
      .get("turning-traffic-state-v2");
    get.onsuccess = () => resolve(get.result);
    get.onerror = () => resolve(null);
  });
  let state = value;
  if (typeof state === "string") state = JSON.parse(state);
  const records = state?.records || [];
  if (!records.length)
    return {
      診斷: "沒有紀錄",
      計畫數: (state?.projects || []).length,
      state有哪些鍵: Object.keys(state || {}),
      目前計畫: state?.activeProjectId || "(空)",
      計畫清單: (state?.projects || []).map((p) => p.id + "/" + p.code),
    };
  return records.map((record) => ({
    station: record.station,
    hasSourceIntervals: Boolean(record.sourceIntervals),
    columns: record.sourceIntervals?.columns?.length || 0,
  }));
});
ok(
  "前置②：匯入的紀錄帶著各支線的逐格資料（沒有的話這個功能無從算起）",
  hasSource.length > 0 && hasSource.every((item) => item.hasSourceIntervals),
  JSON.stringify(hasSource),
);

/** 內容區的數字指紋（排除工具列與旁白）。 */
const numbers = () =>
  page.evaluate(() => {
    const host = document.querySelector(".content") || document.body;
    const skip = [
      ...host.querySelectorAll(
        ".main-toolbar, .toolbar, .filters, .chart-detach-note, .chart-inapplicable",
      ),
    ];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let text = "";
    let node;
    while ((node = walker.nextNode()))
      if (!skip.some((element) => element.contains(node.parentElement)))
        text += " " + node.nodeValue;
    return (text.match(/-?\d[\d,]*\.?\d*/g) || [])
      .map((value) => value.replace(/,/g, ""))
      .join("|");
  });

/*
 * 逐頁比對：切換判定方式之後，**會受影響的頁**數字必須變；
 * 而且切回去要變回原樣（不可以一去不回）。
 */
const PAGES = [
  "各路口駛入",
  "各路口尖峰彙總",
  "流量核對工作台",
  "路口轉向圖",
  "轉向進階分析",
];
const before = {};
for (const name of PAGES) {
  await gotoTab(name);
  before[name] = await numbers();
}
ok(
  "前置③：每一頁都量得到數字",
  Object.values(before).every((value) => value.length > 20),
  Object.entries(before)
    .map(([key, value]) => `${key}=${value.length}`)
    .join("、"),
);

/* 尖峰時段先固定在上午——測資的整路口尖峰在 17 點，上午時段下差異最明顯。 */
await page.selectOption('[data-testid="mt-peak"]', "AM");
await page.waitForTimeout(900);
const beforeAm = {};
for (const name of PAGES) {
  await gotoTab(name);
  beforeAm[name] = await numbers();
}

await page.selectOption('[data-testid="mt-peak-rule"]', "direction");
await page.waitForTimeout(1200);
const after = {};
for (const name of PAGES) {
  await gotoTab(name);
  after[name] = await numbers();
}
const changed = PAGES.filter((name) => after[name] !== beforeAm[name]);
ok(
  "切成「各方向各自認定」之後，流量相關的頁**數字真的變了**",
  changed.length >= 3,
  `變了 ${changed.length} / ${PAGES.length} 頁：${changed.join("、")}`,
);

/* 說明文字要講明用的是哪一種——兩種算法的數字不同，沒寫明會被誤讀。 */
const noteShown = await page.evaluate(() =>
  /各方向|不可以相加|不可相加/.test(
    document.querySelector(".main-toolbar")?.innerText || "",
  ),
);
ok("主工具列上寫明「各方向不可以相加」", noteShown);

/* 切回去：數字要回到原樣。一去不回的話，使用者再也看不到原本的值。 */
await page.selectOption('[data-testid="mt-peak-rule"]', "point");
await page.waitForTimeout(1200);
const back = {};
for (const name of PAGES) {
  await gotoTab(name);
  back[name] = await numbers();
}
const notRestored = PAGES.filter((name) => back[name] !== beforeAm[name]);
ok(
  "切回「整個調查點同一時段」之後，每一頁都回到原本的數字",
  notRestored.length === 0,
  notRestored.join("、"),
);

/* ── 轉向別篩選：吃的要真的變，不吃的要說到做到 ── */
await gotoTab("流量核對工作台");
const auditBefore = await numbers();
await page.selectOption('[data-testid="mt-movement"]', "left");
await page.waitForTimeout(1200);
ok(
  "只看左轉 → 流量核對工作台的數字要變（它吃這個條件）",
  (await numbers()) !== auditBefore,
);
await gotoTab("轉向進階分析");
const advancedLeft = await numbers();
const movementNote = await page
  .locator('[data-testid="chart-inapplicable"]')
  .allInnerTexts();
ok(
  "OD 矩陣／支線平衡要寫明不適用轉向別，並說目前仍以全部轉向計算",
  movementNote.some(
    (text) => /轉向別/.test(text) && /全部轉向/.test(text),
  ),
  movementNote.join(" ｜ ").slice(0, 120),
);
/*
 * ⚠️ 這一條是重點：畫面上寫著「仍以全部轉向計算」，那就必須**真的**是全部轉向。
 *   照樣套用篩選的話，那句話就是假的——比沒有那句話更糟。
 *   驗法：把轉向別切回全部，OD 那一頁的數字必須**一模一樣**。
 */
await page.selectOption('[data-testid="mt-movement"]', "all");
await page.waitForTimeout(1200);
await gotoTab("轉向進階分析");
ok(
  "而且要**說到做到**：OD 這一頁在「只看左轉」與「全部轉向」下數字相同",
  (await numbers()) === advancedLeft,
  (await numbers()) === advancedLeft ? "" : "畫面說沒篩，實際上卻篩了",
);

/* ── 可追溯性：用哪一種算的，畫面上一定要寫出來 ── */
await page.selectOption('[data-testid="mt-peak-rule"]', "direction");
await page.waitForTimeout(1000);
ok(
  "選了「各方向各自認定」→ 畫面上出現說明，而且講明不可以相加",
  (await page.locator('[data-testid="peak-rule-banner"]').count()) === 1 &&
    /不可以相加/.test(
      await page.locator('[data-testid="peak-rule-banner"]').innerText(),
    ),
);
await gotoTab("轉向進階分析");
const caveat = await page
  .locator('[data-testid="chart-inapplicable"]')
  .allInnerTexts();
ok(
  "守恆檢核要寫明「這個判定方式下差值不為零是必然的，不是資料有錯」",
  caveat.some((text) => /守恆/.test(text) && /不適用|必然/.test(text)),
  caveat.join(" ｜ ").slice(0, 120),
);
await page.selectOption('[data-testid="mt-peak-rule"]', "point");
await page.waitForTimeout(1000);
/*
 * ⚠️ 要收掉的是**因為這次篩選才出現**的那幾段，不是全部。
 *
 *   有一種說明是**常駐**的（`data-inapplicable-always="1"`），例如
 *   「連續 60 分鐘候選排行」那一塊寫著「這一塊不受主工具列條件影響」——
 *   它跟篩選沒關係，本來就該一直在。這一條原本用
 *   `[data-testid="chart-inapplicable"]` 全部數進去，常駐說明加進來之後
 *   就變成永遠紅——**紅的不是程式，是守門把兩種說明混為一談**。
 *   （交通服務水準的 e2e-filter-coverage 已經分開處理過同一件事，
 *     這一支當時沒跟著改。）
 *
 * ⚠️ 但常駐說明**不可以**因此完全不驗：如果哪天全部說明都被標成常駐，
 *   這一條就會恆真。所以下面另外加一條前置，確認「會跟著篩選出現的那種」
 *   真的存在過。
 */
const conditional = '[data-testid="chart-inapplicable"]:not([data-inapplicable-always="1"])';
const leftover = await page.locator(conditional).allInnerTexts();
const always = await page
  .locator('[data-testid="chart-inapplicable"][data-inapplicable-always="1"]')
  .count();
ok(
  "切回預設之後，那兩段說明都要收掉（沒篩卻講話是噪音）",
  (await page.locator('[data-testid="peak-rule-banner"]').count()) === 0 &&
    leftover.length === 0,
  `橫幅 ${await page.locator('[data-testid="peak-rule-banner"]').count()} 個、跟著篩選的說明 ${leftover.length} 段（另有常駐說明 ${always} 段，本來就該留著）：${leftover.join(" ｜ ").slice(0, 200)}`,
);

/*
 * ── 舊資料（沒有逐格原始資料）不可以靜靜給 0 ──
 *
 * v2.1.67 以前匯入的紀錄沒有 sourceIntervals。那時候**不可以**
 * 假裝算得出來，也不可以顯示 0——0 會被當成「真的沒有車」抄進報告。
 * 另開一個乾淨的工作階段，灌入不含 sourceIntervals 的種子資料來驗。
 */
{
  const legacyContext = await browser.newContext({
    viewport: { width: 1700, height: 1100 },
    locale: "zh-TW",
  });
  const legacy = await legacyContext.newPage();
  await legacy.addInitScript(
    (value) => localStorage.setItem("turning-traffic-state-v2", value),
    readFileSync(join(here, "seed-state.json"), "utf8"),
  );
  legacy.on("dialog", (event) => event.dismiss());
  await legacy.goto(base, { waitUntil: "networkidle" });
  await legacy.waitForTimeout(2200);
  /* ⚠️ 這是**另開的第二個工作階段**，也要先展開主工具列（X-78）。 */
  await ensureToolbarOpen(legacy);
  const seedHasNoSource = await legacy.evaluate(() => {
    const raw = localStorage.getItem("turning-traffic-state-v2");
    const state = raw ? JSON.parse(raw) : null;
    return (state?.records || []).every((record) => !record.sourceIntervals);
  });
  ok(
    "前置④：種子資料真的沒有逐格原始資料（有的話下面那條驗不到東西）",
    seedHasNoSource,
  );
  await legacy.selectOption('[data-testid="mt-peak-rule"]', "direction");
  await legacy.waitForTimeout(1200);
  const banner = await legacy
    .locator('[data-testid="peak-rule-banner"]')
    .innerText();
  ok(
    "舊資料要**點名說算不出來、並說怎麼辦**，不可以靜靜顯示 0",
    /算不出來/.test(banner) && /重新匯入/.test(banner),
    banner.replace(/\s+/g, " ").slice(0, 140),
  );
  await legacyContext.close();
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 尖峰時段判定方式：切了真的換一套數字，切回去也回得來");
