import { chromium } from "playwright";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "seed-state.json"), "utf8");
const downloads = mkdtempSync(join(tmpdir(), "tt-dl-"));

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(8113);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW", acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_/.test(m.text())) errors.push(m.text()); });
await page.addInitScript((s) => localStorage.setItem("turning-traffic-state-v2", s), seed);
await page.goto("http://localhost:8113/");
await page.waitForTimeout(1200);

const go = async (name) => {
  await page.locator(`nav button:has-text("${name}"), aside button:has-text("${name}")`).first().click();
  await page.waitForTimeout(800);
};

// ── 需求6：新車種當量預設 1，且可自行修正 ────────────────────
await go("車種轉向當量");
const pceRows = await page.evaluate(() =>
  [...document.querySelectorAll("table tbody tr")].map((tr) => ({
    name: tr.querySelector("td")?.innerText.replace(/\n/g, " ").trim(),
    values: [...tr.querySelectorAll("input")].map((i) => ({ v: i.value, disabled: i.disabled })),
  })).filter((r) => r.values.length === 3),
);
console.log("   當量表：", JSON.stringify(pceRows.map((r) => [r.name, r.values.map((v) => v.v).join("/")])));
const core = pceRows.filter((r) => /機車|小型車|大型車|特種車/.test(r.name) && !/新增/.test(r.name));
const extra = pceRows.filter((r) => /新增車種/.test(r.name));
ok("四大類沿用簡報第15頁的參考值",
  pceRows.some((r) => r.name.includes("機車") && r.values.map((v) => Number(v.v)).join(",") === "0.5,0.3,0.4") &&
    pceRows.some((r) => r.name.includes("特種") && r.values.map((v) => Number(v.v)).join(",") === "2.5,2,2.3"),
  core.map((r) => `${r.name}=${r.values.map((v) => v.v).join("/")}`).join(" "));
ok("簡報未提供參考值的新增車種預設為 1",
  extra.length === 3 && extra.every((r) => r.values.every((v) => Number(v.v) === 1)),
  extra.map((r) => r.name).join("、"));
ok("新增車種的當量欄位可以自行修改", extra.every((r) => r.values.every((v) => !v.disabled)));

// 實際改一個值並確認寫入
const truckRow = page.locator("table tbody tr").filter({ hasText: "大貨車" }).first();
await truckRow.locator("input").first().fill("1.8");
await truckRow.locator("input").first().blur();
await page.waitForTimeout(500);
const savedFactor = await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("turning-traffic-state-v2") || "{}");
  return state.pce?.["custom:大貨車"]?.left;
});
ok("修改後的當量有寫入儲存", Number(savedFactor) === 1.8, String(savedFactor));

// ── 需求5：報表匯出項目自選 ────────────────────────────────
await go("報表與批次輸出");
const itemCount = await page.locator(".report-items-grid label").count();
ok("匯出項目清單有列出可分析項目", itemCount >= 8, `${itemCount} 項`);

const pick = async (labels) => {
  // 先全部取消，再勾指定項目
  await page.locator('.report-items-actions button:has-text("全部取消")').click();
  await page.waitForTimeout(300);
  for (const label of labels) {
    await page.locator(".report-items-grid label").filter({ hasText: label }).first().locator("input").check();
    await page.waitForTimeout(120);
  }
};
const download = async () => {
  const wait = page.waitForEvent("download");
  await page.locator('button:has-text("下載新版 .xlsx")').first().click();
  const dl = await wait;
  const file = join(downloads, dl.suggestedFilename());
  await dl.saveAs(file);
  await page.waitForTimeout(300);
  return XLSX.read(readFileSync(file), { type: "buffer" });
};

// A 計畫：只要各路口駛出的尖峰流量
await pick(["各路口駛出尖峰流量"]);
const bookA = await download();
console.log("   A計畫工作表：", bookA.SheetNames.join(" / "));
ok("A計畫：只匯出「各路口駛出尖峰流量」一張表",
  bookA.SheetNames.length === 1 && bookA.SheetNames[0] === "各路口駛出尖峰流量",
  bookA.SheetNames.join("、"));
const headA = XLSX.utils.sheet_to_json(bookA.Sheets["各路口駛出尖峰流量"], { header: 1 })[0];
console.log("   欄位：", JSON.stringify(headA));
ok("駛出表欄位只含駛出量，不含駛入量",
  headA.some((h) => String(h).includes("駛出量")) && !headA.some((h) => String(h).includes("駛入")),
  headA.join(","));

// 存成範本
await page.locator(".report-template-create input").fill("A計畫－只要駛出尖峰流量");
await page.locator('.report-template-create button:has-text("儲存目前勾選")').click();
await page.waitForTimeout(500);
ok("勾選可存成報表範本",
  (await page.locator('.report-template-row:has-text("A計畫－只要駛出尖峰流量")').count()) === 1);

// B 計畫：只要各路口駛入的尖峰流量
await pick(["各路口駛入尖峰流量"]);
const bookB = await download();
ok("B計畫：只匯出「各路口駛入尖峰流量」一張表",
  bookB.SheetNames.length === 1 && bookB.SheetNames[0] === "各路口駛入尖峰流量",
  bookB.SheetNames.join("、"));

// C 計畫：路口車種分析 + 各路口駛出流量
await pick(["路口車種組成分析", "各路口駛出尖峰流量"]);
const bookC = await download();
console.log("   C計畫工作表：", bookC.SheetNames.join(" / "));
ok("C計畫：匯出車種組成＋駛出尖峰流量兩張表",
  bookC.SheetNames.length === 2 &&
    bookC.SheetNames.includes("車種組成分析") &&
    bookC.SheetNames.includes("各路口駛出尖峰流量"),
  bookC.SheetNames.join("、"));

// 全選：所有項目都要有對應工作表
await page.locator('.report-items-actions button:has-text("全選")').click();
await page.waitForTimeout(400);
const bookAll = await download();
console.log("   全選工作表：", bookAll.SheetNames.join(" / "));
ok("全選時每個項目都產生對應工作表", bookAll.SheetNames.length >= 9, `${bookAll.SheetNames.length} 張`);
ok("全選含車種轉向當量參數表", bookAll.SheetNames.includes("車種轉向當量"));
const pceSheet = XLSX.utils.sheet_to_json(bookAll.Sheets["車種轉向當量"]);
const truck = pceSheet.find((r) => String(r["車種名稱"]).includes("大貨車"));
console.log("   當量表列：", JSON.stringify(truck));
ok("當量工作表標示新增車種的來源說明",
  truck && String(truck["類別"]) === "新增車種" && String(truck["來源"]).includes("預設 1.0"),
  JSON.stringify(truck?.["來源"]));

// 套用範本 → 勾選整組還原
await page.locator('.report-template-row:has-text("A計畫") button:has-text("套用")').click();
await page.waitForTimeout(500);
const restored = await page.evaluate(() =>
  [...document.querySelectorAll(".report-items-grid label")]
    .filter((l) => l.querySelector("input").checked)
    .map((l) => l.querySelector("b").innerText),
);
ok("套用範本後勾選完整還原",
  restored.length === 1 && restored[0] === "各路口駛出尖峰流量", restored.join("、"));

// 勾選記在計畫上：切到別的頁面再回來仍在
await go("總覽儀表板");
await go("報表與批次輸出");
const persisted = await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("turning-traffic-state-v2") || "{}");
  return { onProject: state.projects?.[0]?.reportItems, templates: (state.reportTemplates || []).length };
});
console.log("   已保存：", JSON.stringify(persisted));
ok("勾選記在計畫上並寫入儲存",
  Array.isArray(persisted.onProject) && persisted.onProject.join() === "outboundPeak", JSON.stringify(persisted.onProject));
ok("報表範本已寫入儲存", persisted.templates === 1, `${persisted.templates} 個`);

// 全部取消時要擋下並說明
await page.locator('.report-items-actions button:has-text("全部取消")').click();
await page.waitForTimeout(300);
const disabled = await page.locator('button:has-text("下載新版 .xlsx")').first().isDisabled().catch(() => false);
await page.locator('button:has-text("下載新版 .xlsx")').first().click().catch(() => {});
await page.waitForTimeout(700);
const toast = await page.locator(".toast, [class*=toast]").first().innerText().catch(() => "");
ok("一項都沒勾時會提示而不是輸出空檔",
  disabled || /至少勾選/.test(toast), disabled ? "按鈕停用" : toast.slice(0, 60));

ok("全程無 JS 錯誤", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(problems.length ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}` : "\n全部通過");
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
