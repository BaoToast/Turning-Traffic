/*
 * ══════════════════════════════════════════════════════════════════
 *  係數「依季別 × 路口」分別設定（路口轉向）
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-10：
 *   「是否能改成**預設全部路段都套用同一個係數**，然後在轉向係數管理分頁裡，
 *     可以指定不同路段，手動設定不同轉向係數？」
 *   「初始的預設自然是設定一次，套用**全季度＋全路段**。」
 *   「**計畫和計畫之間不能彼此干擾，路段和路段之間，季別和季別之間
 *     都不能互相干擾**，且**這份設定要能被存檔匯出和匯入**。」
 *
 * ⚠️ 這支程式與全日交通量有一個關鍵差異，這一支要把它驗清楚：
 *   路口轉向的每一筆紀錄都帶著 `record.pceUsed` **快照**，計算讀的是快照。
 *   所以建立覆寫**不會**改掉已匯入資料的數字——那是刻意的（已經拿去寫報告
 *   的數字不該在背後被改掉），但畫面上一定要講清楚，否則使用者會以為
 *   自己已經改掉了既有數字。
 *
 * 守門條目：
 *   ① 預設停在「全季別 × 全路口」——不碰它就等於改版前
 *   ② 選了具體範圍之後**編輯表格不可以動到計畫預設**（沒有草稿的話會動到）
 *   ③ 套用之後摘要要列出「哪一個路口在哪一季改過」，而且能還原
 *   ④ ⚠️ 已匯入資料的數字**不可以**改變，而且畫面要明講這件事
 *   ⑤ 重新整理之後設定還在（真的存進去了）
 *   ⑥ 覆寫要能跟著備份匯出／匯入
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { serve } = await import(pathToFileURL(join(HERE, "serve.mjs")).href);
const { launchOptions } = await import(
  pathToFileURL(join(HERE, "chrome-path.mjs")).href
);
const seed = readFileSync(join(HERE, "seed-wide.json"), "utf8");

const problems = [];
const failOnly = (text) => ({ failOnly: text });
const ok = (label, condition, detail = "") => {
  const text =
    detail && typeof detail === "object"
      ? condition
        ? ""
        : detail.failOnly
      : detail;
  console.log(`${condition ? "✅" : "❌"} ${label}${text ? ` — ${text}` : ""}`);
  if (!condition) problems.push(label + (text ? ` — ${text}` : ""));
};

const server = await serve(8168);
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/ERR_TUNNEL_CONNECTION_FAILED|fonts\.googleapis|Failed to load resource/.test(t))
    return;
  errors.push("console: " + t.slice(0, 200));
});
page.on("dialog", (d) => d.accept());
await page.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 無痕時就算了，前置檢查會紅。 */
  }
}, seed);
await page.goto("http://127.0.0.1:8168/", { waitUntil: "networkidle" });
await page.waitForTimeout(1800);

const gotoParameters = async () => {
  await page
    .locator('aside.sidebar nav button:has-text("車種轉向當量")')
    .first()
    .click();
  await page.waitForTimeout(900);
};

/** 目前表格上的所有當量值。 */
const tableValues = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".parameter-card input[type=number]")].map(
      (input) => input.value,
    ),
  );

/** 已匯入資料的關鍵數字（總覽儀表板 + 各路口尖峰彙總）。 */
const importedNumbers = async () => {
  const out = {};
  for (const [key, label] of [
    ["dash", "總覽儀表板"],
    ["peaks", "各路口尖峰彙總"],
    ["audit", "流量核對工作台"],
  ]) {
    await page
      .locator(`aside.sidebar nav button:has-text("${label}")`)
      .first()
      .click();
    await page.waitForTimeout(800);
    out[key] = await page.evaluate(
      () => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " "),
    );
  }
  return out;
};

await gotoParameters();
ok(
  "前置：參數頁上找得到範圍選擇器",
  (await page.locator('[data-testid="factor-scope"]').count()) === 1,
);

/* ── ① 預設 ── */
const defaults = await page.evaluate(() =>
  [
    ...document.querySelectorAll('[data-testid="factor-scope"] select'),
  ].map((s) => s.value),
);
ok(
  "① 預設停在「全季別 × 全路口」（不碰它就等於改版前）",
  defaults.length === 2 && defaults.every((value) => value === "*"),
  defaults.join("／"),
);
ok(
  "① 摘要一開始寫「全部套用同一組」",
  (
    await page.locator('[data-testid="factor-scope-summary"]').innerText()
  ).includes("全部季別、全部路口都套用同一組"),
);
ok(
  "① ⚠️ 摘要一定要說明「已匯入資料不會跟著改」",
  (await page.locator('[data-testid="factor-scope-summary"]').innerText()).includes(
    "之後匯入",
  ),
);

const beforeNumbers = await importedNumbers();
await gotoParameters();
const defaultTable = await tableValues();
ok("前置：表格上讀得到當量欄位", defaultTable.length >= 12, `${defaultTable.length} 格`);

/* ── ② 選具體範圍之後，編輯不可以動到計畫預設 ── */
const quarterOptions = await page.evaluate(() =>
  [
    ...document.querySelectorAll('[data-testid="factor-scope"] select')[0]
      .options,
  ].map((o) => o.value),
);
ok(
  "前置：季別下拉列出實際有資料的季別",
  quarterOptions.length >= 3 && quarterOptions[0] === "*",
  quarterOptions.slice(0, 5).join("、"),
);
const targetQuarter = quarterOptions.find((value) => value !== "*");

await page.evaluate((value) => {
  const select = document.querySelectorAll('[data-testid="factor-scope"] select')[0];
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}, targetQuarter);
await page.waitForTimeout(700);
ok(
  "② 選了具體季別之後，畫面要說明這一格目前是沿用上層設定",
  (await page.locator(".factor-scope-state").innerText()).includes("沿用上層設定"),
);

/* 改第一個當量欄位。 */
await page.evaluate(() => {
  const input = document.querySelector(".parameter-card input[type=number]");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(input, "9");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(500);

/* 切回全季別：計畫預設必須完全沒被動到。 */
await page.evaluate(() => {
  const select = document.querySelectorAll('[data-testid="factor-scope"] select')[0];
  select.value = "*";
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(700);
const afterEditTable = await tableValues();
ok(
  "② ⚠️ 在某個範圍上改係數，**不可以**動到計畫預設（沒有草稿的話會動到）",
  JSON.stringify(afterEditTable) === JSON.stringify(defaultTable),
  failOnly(
    `預設值被改掉了：${defaultTable.slice(0, 3).join("／")} → ${afterEditTable.slice(0, 3).join("／")}`,
  ),
);

/* ── ③ 套用並檢查摘要 ── */
await page.evaluate((value) => {
  const select = document.querySelectorAll('[data-testid="factor-scope"] select')[0];
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}, targetQuarter);
await page.waitForTimeout(700);
await page.evaluate(() => {
  const input = document.querySelector(".parameter-card input[type=number]");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(input, "9");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(400);
await page.locator('button:has-text("套用到這個範圍")').click();
await page.waitForTimeout(1000);

const summary = await page
  .locator('[data-testid="factor-scope-summary"]')
  .innerText();
ok("③ 摘要列出這一組專屬係數", summary.includes("1 組專屬係數"), summary.slice(0, 100));
ok(
  "③ 摘要寫得出哪一季、哪一個路口",
  summary.includes(targetQuarter) && summary.includes("全路口"),
  summary.slice(0, 140),
);
ok(
  "③ 有「還原成預設」",
  (await page.locator('[data-testid="factor-scope-summary"] button:has-text("還原成預設")').count()) === 1,
);
ok(
  "③ ⚠️ 範圍面板裡**沒有**「重新套用到已匯入資料」這顆按鈕",
  /*
   * ⚠️ 選擇器一定要限定在範圍面板內。第一版用全頁搜尋，
   *   抓到畫面別處同名的按鈕，紅在一個根本不相關的東西上。
   */
  (await page
    .locator('[data-testid="factor-scope"] button:has-text("重新套用")')
    .count()) === 0,
  failOnly(
    "這支程式沒辦法正確重算已匯入資料（原始軌跡沒有逐車種×逐轉向的車輛數），有這顆按鈕就是半套的功能",
  ),
);

/* ── ④ 已匯入資料不可以變 ── */
const afterNumbers = await importedNumbers();
for (const key of Object.keys(beforeNumbers))
  ok(
    `④ ⚠️ 建立覆寫之後，已匯入資料的畫面（${key}）必須逐字不變`,
    beforeNumbers[key] === afterNumbers[key],
    failOnly("已匯入資料的數字在背後被改掉了"),
  );

/* ── ⑤ 重新整理 ── */
await page.reload();
await page.waitForTimeout(2400);
await gotoParameters();
ok(
  "⑤ ⚠️ 重新整理之後設定還在（真的存進去了，不是只在畫面上）",
  (await page.locator('[data-testid="factor-scope-summary"]').innerText()).includes(
    "1 組專屬係數",
  ),
);
const reloadTable = await tableValues();
ok(
  "⑤ 重新整理之後，計畫預設仍然沒被動到",
  JSON.stringify(reloadTable) === JSON.stringify(defaultTable),
  failOnly("重新整理後計畫預設變了"),
);

/* ── ⑥ 備份帶得走 ── */
/*
 * ── ⑥ 覆寫要跟著**備份**走 ──────────────────────────────────
 *
 * 使用者明講「這份設定要能被存檔匯出和匯入」。
 *
 * ⚠️ 這裡刻意去按**真正的下載按鈕**，讀下載下來的那個檔案，
 *   而不是去翻瀏覽器儲存的內部結構。使用者拿到手的是這個檔，
 *   翻內部結構只能證明「存起來了」，證明不了「帶得走」。
 *  （第一版我去讀 localStorage，讀到 null——這支程式的狀態根本
 *    不在那裡。紅在測試自己身上，不是程式。）
 */
await page
  .locator('aside.sidebar nav button:has-text("備份與還原")')
  .first()
  .click();
await page.waitForTimeout(900);
const download = page.waitForEvent("download", { timeout: 30000 });
await page.locator('button:has-text("下載本計畫 JSON")').first().click();
const file = await download;
const backup = JSON.parse(readFileSync(await file.path(), "utf8"));
const scopeList = Object.values(backup?.pceScopesByProject || {}).flat();
ok(
  "⑥ 備份檔裡帶著這一組覆寫",
  scopeList.length === 1,
  `${scopeList.length} 組`,
);
ok(
  "⑥ 覆寫的範圍與係數都完整帶出去",
  scopeList[0]?.quarter === targetQuarter &&
    scopeList[0]?.roadId === "*" &&
    scopeList[0]?.factors &&
    Object.keys(scopeList[0].factors).length > 0,
  JSON.stringify(scopeList[0]).slice(0, 120),
);
ok(
  "⑥ ⚠️ 舊欄位（全季別×全路口）照舊寫出，舊版讀得到",
  Boolean(backup?.pceByProject) && Boolean(backup?.pce),
  failOnly("pceByProject／pce 不見了，退版之後會讀不到係數"),
);
ok(
  "⑥ ⚠️ 只備份一個計畫時，不可以把別的計畫的覆寫也帶出去",
  Object.keys(backup?.pceScopesByProject || {}).length <= 1,
  Object.keys(backup?.pceScopesByProject || {}).join("、"),
);

await page
  .locator('aside.sidebar nav button:has-text("車種轉向當量")')
  .first()
  .click();
await page.waitForTimeout(900);

/* ── 還原 ── */
await page
  .locator('[data-testid="factor-scope-summary"] button:has-text("還原成預設")')
  .first()
  .click();
await page.waitForTimeout(900);
ok(
  "③ 還原之後摘要回到「全部套用同一組」",
  (
    await page.locator('[data-testid="factor-scope-summary"]').innerText()
  ).includes("全部季別、全部路口都套用同一組"),
);

console.log("\n══ 主控台錯誤 ══");
ok("整段流程沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" ｜ "));

console.log(
  problems.length
    ? `\n❌ 未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}`
    : "\n✅ 全部通過",
);
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
