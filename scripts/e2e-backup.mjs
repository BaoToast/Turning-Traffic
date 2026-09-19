/*
 * 備份／還原的端對端驗證。
 *
 * 使用者回報的兩件事都在這裡用真的瀏覽器量：
 *   1. 「匯出 A 計畫的 JSON」實際上帶出了這台電腦上的**全部**計畫。
 *   2. 在另一台電腦匯入之後，原本「已確認」的成果審核狀態變回「待核對」。
 *
 * 這支腳本先種一份兩個計畫、每筆都是「已確認」的狀態，然後：
 *   ・按「下載本計畫 JSON」→ 檢查裡面只有一個計畫、審核狀態還在
 *   ・按「下載 JSON（全部計畫）」→ 檢查兩個計畫都在
 *   ・清成空白後匯入單一計畫備份 → 檢查計畫回來了、審核狀態仍是「已確認」
 *   ・再匯入另一份單一計畫備份 → 檢查是**併入**，不是把前一個蓋掉
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
  ".pdf": "application/pdf",
  ".docx": "application/octet-stream",
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
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/* ── 種兩個計畫、每筆都「已確認」 ── */
const seed = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
const CONFIRMED = {
  status: "已確認",
  note: "端對端測試",
  updatedAt: "2026-06-01T00:00:00.000Z",
};
const projectA = seed.projects[0];
const projectB = {
  id: "P-test-2",
  code: "22222",
  name: "第二個計畫（不應該被帶走）",
  client: "",
  note: "",
  createdAt: "2026-02-02T00:00:00.000Z",
};
const recordsA = seed.records.map((r) => ({ ...r, review: { ...CONFIRMED } }));
const recordsB = seed.records.slice(0, 1).map((r) => ({
  ...structuredClone(r),
  id: r.id + "-B",
  projectId: projectB.id,
  review: { ...CONFIRMED },
}));
const state = {
  ...seed,
  projects: [projectA, projectB],
  activeProjectId: projectA.id,
  records: [...recordsA, ...recordsB],
  pceByProject: { [projectA.id]: seed.pce, [projectB.id]: seed.pce },
  catalogByProject: {
    [projectA.id]: seed.vehicleCatalog,
    [projectB.id]: seed.vehicleCatalog,
  },
  mappingsByProject: { [projectA.id]: {}, [projectB.id]: {} },
};

await new Promise((r) => server.listen(8113, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1050 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());

/* v2.1.53：資料改存 IndexedDB，端對端腳本要用 __readState／__writeState 才讀得到。 */
await installStateHelpers(page);

async function seedAndReload(value) {
  await page.goto("http://localhost:8113/");
  /* 等第一次載入的存檔 effect 跑完，否則它會蓋掉下面種進去的狀態。 */
  await page.waitForTimeout(700);
  await page.evaluate(
    async ([json]) => {
      localStorage.clear();
      /*
       * v2.1.53：狀態存在 IndexedDB，種子也要寫到那裡。
       * 只寫 localStorage 的話，程式開機看到 IndexedDB 已經有東西就不會理它，
       * 這個種子等於沒生效，而測試多半仍然會綠——那是最糟的一種假通過。
       */
      await window.__writeState(json || "");
    },
    [value ? JSON.stringify(value) : ""],
  );
  await page.reload();
  await page.waitForTimeout(900);
}

async function gotoBackup() {
  await page.locator('nav button:has-text("備份與還原")').first().click();
  await page.waitForTimeout(500);
}

/** 按下一顆會觸發下載的按鈕，把檔案內容讀回來。 */
async function grabDownload(locator) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    locator.click(),
  ]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: readFileSync(path, "utf8") };
}

/*
 * ── 0. 全新的瀏覽器必須存得下東西 ──
 *
 * 這一項在使用者回報之外，是查備份問題時翻出來的：載入 effect 遇到
 * 「這台電腦還沒有資料」時直接 return，`loaded` 永遠是 false，而存檔
 * effect 第一行就是 `if (!loaded) return;`。結果是全新瀏覽器**從頭到尾
 * 不存任何東西**：建立計畫、匯入一整季、核對、鎖定，重新整理全部消失。
 * B 電腦是空白的，正好每次都踩到。
 */
await seedAndReload(null);
await page.locator('nav button:has-text("建立與管理計畫")').first().click();
await page.waitForTimeout(600);
{
  const inputs = page.locator(".panel input");
  await inputs.nth(0).fill("NEWPC");
  await inputs.nth(1).fill("全新電腦上的計畫");
  await page.locator('button:has-text("＋ 建立計畫")').first().click();
  await page.waitForTimeout(800);
  const saved = await page.evaluate(async () =>
    JSON.parse((await window.__readState()) || "null"),
  );
  ok(
    "全新瀏覽器建立計畫後真的有存檔",
    Boolean(saved) && (saved.projects || []).length === 1,
    saved ? `存了 ${(saved.projects || []).length} 個計畫` : "localStorage 完全沒有寫入",
  );
  await page.reload();
  await page.waitForTimeout(900);
  ok(
    "重新整理後計畫還在",
    (await page.locator("body").innerText()).includes("全新電腦上的計畫"),
  );
}

await seedAndReload(state);
await gotoBackup();

/* ── 1. 單一計畫匯出 ── */
const single = page.locator('button:has-text("下載本計畫 JSON")');
ok("備份頁有「下載本計畫 JSON」（單一計畫備份）", (await single.count()) > 0);
let singleJson = null;
if (await single.count()) {
  const file = await grabDownload(single.first());
  singleJson = JSON.parse(file.text);
  ok(
    "單一計畫備份只含目前這一個計畫",
    Array.isArray(singleJson.projects) && singleJson.projects.length === 1,
    `含 ${singleJson.projects?.length} 個計畫`,
  );
  ok(
    "單一計畫備份只含這個計畫的紀錄",
    (singleJson.records || []).every((r) => r.projectId === projectA.id),
    `${(singleJson.records || []).filter((r) => r.projectId !== projectA.id).length} 筆屬於別的計畫`,
  );
  ok(
    "單一計畫備份保留成果審核狀態",
    (singleJson.records || []).every((r) => r.review?.status === "已確認"),
  );
  ok(
    "單一計畫備份的檔名帶得出計畫名稱",
    file.name.includes(projectA.code) || file.name.includes(projectA.name),
    file.name,
  );
}

/* ── 2. 全部計畫匯出 ── */
const all = page.locator('button:has-text("下載 JSON（全部計畫）")');
ok("備份頁有「下載 JSON（全部計畫）」", (await all.count()) > 0);
if (await all.count()) {
  const file = await grabDownload(all.first());
  const json = JSON.parse(file.text);
  ok(
    "全部計畫備份含兩個計畫",
    json.projects?.length === 2,
    `含 ${json.projects?.length} 個計畫`,
  );
}

/* ── 3. 空白電腦匯入單一計畫備份 ── */
if (singleJson) {
  await seedAndReload(null);
  await gotoBackup();
  await page
    .locator(".backup-grid input[type=file]")
    .first()
    .setInputFiles({
      name: "A計畫備份.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(singleJson)),
    });
  await page.waitForTimeout(1200);
  const after = await page.evaluate(async () =>
    JSON.parse((await window.__readState()) || "{}"),
  );
  ok(
    "空白電腦匯入單一計畫備份後計畫回來了",
    after.projects?.length === 1,
    `目前 ${after.projects?.length} 個計畫`,
  );
  ok(
    "匯入後成果審核狀態仍是「已確認」",
    (after.records || []).length > 0 &&
      (after.records || []).every((r) => r.review?.status === "已確認"),
    (after.records || []).map((r) => r.review?.status || "無").join("／"),
  );

  /* ── 4. 再匯入第二份單一計畫備份，應該是併入而不是覆蓋 ── */
  const secondBackup = {
    ...singleJson,
    projects: [projectB],
    activeProjectId: projectB.id,
    records: recordsB,
    pceByProject: { [projectB.id]: seed.pce },
    catalogByProject: { [projectB.id]: seed.vehicleCatalog },
    mappingsByProject: { [projectB.id]: {} },
  };
  await page
    .locator(".backup-grid input[type=file]")
    .first()
    .setInputFiles({
      name: "B計畫備份.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(secondBackup)),
    });
  await page.waitForTimeout(1400);
  const merged = await page.evaluate(async () =>
    JSON.parse((await window.__readState()) || "{}"),
  );
  ok(
    "第二份單一計畫備份是「併入」，前一個計畫還在",
    merged.projects?.length === 2,
    `目前 ${merged.projects?.length} 個計畫：` +
      (merged.projects || []).map((p) => p.name).join("、"),
  );
  ok(
    "併入後兩個計畫的審核狀態都保留",
    (merged.records || []).every((r) => r.review?.status === "已確認"),
  );

  /*
   * ── 5. 計畫缺少識別碼的備份要被擋下，而且不可以動到現有資料 ──
   *
   * ⚠️ 計畫的 id 是主鍵：每一筆路口季度資料靠 projectId 掛在計畫底下。
   *   舊版只檢查 kind 與 records 是不是陣列，projects 裡面長什麼樣完全沒看：
   *     ・`projects: [{}]` → fallbackId 是 undefined，整批紀錄的 projectId
   *       也變成 undefined，還原「成功」，但每一個畫面都篩不到它們——
   *       資料還在，使用者看到的是空的，而且沒有任何訊息。
   *   這是 2026-09-12 在交通服務水準那一支實測到的同一顆雷（那邊是
   *   `{"kind":"TLM_PORTFOLIO_PACKAGE"}` 會清空全部計畫卻報「備份已載入」），
   *   三支程式都要擋。
   */
  const before = merged;
  for (const [label, broken] of [
    ["計畫沒有識別碼", { ...singleJson, projects: [{ name: "沒有 id 的計畫" }] }],
    ["計畫識別碼是空字串", { ...singleJson, projects: [{ id: "", name: "空 id" }] }],
    ["計畫清單是空陣列", { ...singleJson, projects: [] }],
  ]) {
    await page
      .locator(".backup-grid input[type=file]")
      .first()
      .setInputFiles({
        name: "壞掉的備份.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(broken)),
      });
    await page.waitForTimeout(1200);
    const after2 = await page.evaluate(async () =>
      JSON.parse((await window.__readState()) || "{}"),
    );
    ok(
      `⚠️ ${label}的備份被擋下，原有資料完全沒變`,
      (after2.projects || []).length === (before.projects || []).length &&
        (after2.records || []).length === (before.records || []).length &&
        (after2.records || []).every((r) => r.projectId),
      `計畫 ${(after2.projects || []).length}／${(before.projects || []).length}、` +
        `紀錄 ${(after2.records || []).length}／${(before.records || []).length}、` +
        `沒有 projectId 的紀錄 ${(after2.records || []).filter((r) => !r.projectId).length} 筆`,
    );
  }
}

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" / "));

await browser.close();
server.close();
console.log(
  problems.length
    ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ")
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
