/*
 * ══════════════════════════════════════════════════════════════════════
 *  計畫資訊可以改，而且改名稱不會動到任何一筆資料
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：「針對計畫，我們要可以手動編輯計畫名稱／計畫編號等資訊」。
 *
 * ⚠️ 使用者記得三支程式都有這個功能，但**這一支從來沒有過**——
 *   查證結果只有 addProject 與 deleteProject。這不是小功能：
 *   名稱打錯時，舊版唯一的辦法是刪掉重建，而刪除會連同那個計畫的
 *   所有季度路口資料一起消失。
 *
 * 這支釘住四件事：
 *   ① 每一列都有「修改」，按下去表單會帶入現有的值（不是空白表單）
 *   ② 改完按儲存，清單上的名稱與代碼真的變了
 *   ③ **那個計畫的路口資料筆數一筆都沒有變**——這一條才是重點
 *   ④ 取消不會改到任何東西
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages-dist");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const seed = readFileSync(join(here, "seed-state.json"), "utf8");
await new Promise((r) => server.listen(8143, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await installStateHelpers(page);
await page.goto("http://localhost:8143/");
await page.waitForTimeout(800);
await page.evaluate(async (s) => {
  localStorage.clear();
  await window.__writeState(s);
}, seed);
await page.reload();
await page.waitForTimeout(1300);

await page
  .locator('nav button:has-text("建立與管理計畫"), aside button:has-text("建立與管理計畫")')
  .first()
  .click();
await page.waitForTimeout(800);

/** 目前清單上每一列的名稱、代碼與資料筆數。 */
const rows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".project-row")].map((row) => ({
      code: row.querySelector(".project-open > span")?.textContent?.trim() || "",
      name: row.querySelector(".project-open strong")?.textContent?.trim() || "",
      note: row.querySelector(".project-open small")?.textContent?.trim() || "",
      hasEdit: Boolean(row.querySelector(".project-edit")),
    })),
  );

/** 資料庫裡真正的路口紀錄筆數，依計畫分組。 */
const recordCounts = () =>
  page.evaluate(async () => {
    const data = JSON.parse((await window.__readState()) || "{}");
    const out = {};
    for (const record of data.records || [])
      out[record.projectId] = (out[record.projectId] || 0) + 1;
    return out;
  });

const before = await rows();
const countsBefore = await recordCounts();
ok("前置：清單上有計畫可以改", before.length > 0, `${before.length} 個`);
ok(
  "① 每一列都有「修改」",
  before.length > 0 && before.every((r) => r.hasEdit),
  before.map((r) => `${r.name}${r.hasEdit ? "✓" : "✗"}`).join("、"),
);

/* ── ① 按下修改，表單要帶入現有的值 ── */
await page.locator(".project-row .project-edit").first().click();
await page.waitForTimeout(500);
const filled = await page.evaluate(() => {
  const form = document.querySelector(".project-form");
  if (!form) return null;
  const inputs = [...form.querySelectorAll("input")].map((i) => i.value);
  return {
    heading: form.querySelector("h2")?.textContent?.trim() || "",
    inputs,
    focused: form.classList.contains("is-focused"),
    hasSave: Boolean(
      [...form.querySelectorAll("button")].find((b) =>
        b.textContent.includes("儲存修改"),
      ),
    ),
  };
});
ok("前置：表單找得到", Boolean(filled));
if (filled) {
  ok(
    "① 表單帶入的是那個計畫現有的值，不是空白",
    filled.inputs[0] === before[0].code && filled.inputs[1] === before[0].name,
    `代碼「${filled.inputs[0]}」名稱「${filled.inputs[1]}」，清單上是「${before[0].code}」「${before[0].name}」`,
  );
  ok(
    "① 抬頭從「建立新計畫」換成「修改計畫」",
    filled.heading.includes("修改計畫"),
    filled.heading,
  );
  ok("① 編輯中的表單有被框起來（看得出在改哪一件事）", filled.focused);
  ok("① 按鈕變成「儲存修改」", filled.hasSave);
}

/* ── ④ 先驗取消：什麼都不該變 ── */
await page.locator('.project-form button:has-text("取消")').first().click();
await page.waitForTimeout(400);
const afterCancel = await rows();
ok(
  "④ 按取消之後，清單一個字都沒變",
  JSON.stringify(afterCancel.map((r) => [r.code, r.name])) ===
    JSON.stringify(before.map((r) => [r.code, r.name])),
  afterCancel.map((r) => `${r.code}／${r.name}`).join("、"),
);

/* ── ②③ 真的改一次 ── */
await page.locator(".project-row .project-edit").first().click();
await page.waitForTimeout(400);
const NEW_CODE = "115-Z99";
const NEW_NAME = "改過名字的計畫";
await page.locator(".project-form input").nth(0).fill(NEW_CODE);
await page.locator(".project-form input").nth(1).fill(NEW_NAME);
await page.locator('.project-form button:has-text("儲存修改")').first().click();
await page.waitForTimeout(800);

const after = await rows();
ok(
  "② 清單上的名稱與代碼真的變了",
  after.some((r) => r.name === NEW_NAME && r.code === NEW_CODE),
  after.map((r) => `${r.code}／${r.name}`).join("、"),
);
ok(
  "② 計畫數量沒有變（是修改，不是多建一個）",
  after.length === before.length,
  `${before.length} → ${after.length}`,
);
ok(
  "② 儲存之後表單回到「建立新計畫」",
  await page.evaluate(() =>
    (
      document.querySelector(".project-form h2")?.textContent || ""
    ).includes("建立新計畫"),
  ),
);

/*
 * ⚠️ 這一條是這支測試真正的理由。
 *   路口資料是靠 projectId 關聯的，改名稱不該動到任何一筆。
 *   哪天有人改成用名稱關聯，這裡就會紅——那正是我們要擋下的災難：
 *   改個名字，整個計畫的資料全部對不到。
 */
const countsAfter = await recordCounts();
ok(
  "③ 改名之後，每個計畫的路口資料筆數一筆都沒有變",
  JSON.stringify(countsBefore) === JSON.stringify(countsAfter),
  `改名前 ${JSON.stringify(countsBefore)}／改名後 ${JSON.stringify(countsAfter)}`,
);

/* 重新整理之後還在——不是只改了畫面上的 state。 */
await page.reload();
await page.waitForTimeout(1500);
await page
  .locator('nav button:has-text("建立與管理計畫"), aside button:has-text("建立與管理計畫")')
  .first()
  .click();
await page.waitForTimeout(700);
const afterReload = await rows();
ok(
  "② 重新整理之後改動還在（真的存起來了）",
  afterReload.some((r) => r.name === NEW_NAME && r.code === NEW_CODE),
  afterReload.map((r) => `${r.code}／${r.name}`).join("、"),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 計畫資訊可修改，且不影響任何一筆路口資料");
