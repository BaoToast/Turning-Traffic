/*
 * ══════════════════════════════════════════════════════════════════════
 *  路口名稱別名：看得到、刪得掉、而且備份還原之後還在
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：
 *   「路口轉向程式匯入檔案，針對路名有別名的設定嗎? 之前有說過三份程式
 *     都要有，這點我驗證不到，只能請你針對三份程式作一下驗證有別名的設定」
 *
 * 查證結果（與使用者的印象不同，如實記錄）：
 *   ・別名功能**本來就有**，改名的當下自動建立，匯入時也真的在用。
 *   ・但**畫面上完全看不到**——頁面上的說明甚至明寫「別名會留在系統內部
 *     協助辨識，不在此頁逐筆展開」。所以他驗證不到是必然的。
 *   ・而且**匯出備份有帶走、還原卻沒有讀回來**：換一台電腦還原之後
 *     別名全部消失，而畫面只說「還原完成」。這是真的 bug。
 *
 * 這支釘住四件事：
 *   ① 改名之後真的記了一筆別名，而且**在畫面上列得出來**
 *   ② 列出來的是「使用者看得懂的名字」，不是內部正規化後的鍵
 *   ③ 可以刪除，刪完清單真的少一筆
 *   ④ ⚠️ 備份 → 清空 → 還原之後，別名要**還在**（就是上面那個 bug）
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { serve } = await import(pathToFileURL(join(HERE, "serve.mjs")).href);
const { launchOptions } = await import(
  pathToFileURL(join(HERE, "chrome-path.mjs")).href
);
const { installStateHelpers } = await import(
  pathToFileURL(join(HERE, "read-state.mjs")).href
);
const seed = readFileSync(join(HERE, "seed-state.json"), "utf8");

const problems = [];
/* 有些 detail 是「失敗原因」，成功時印出來會讓人以為出事了。 */
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

const server = await serve(8149);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
const downloads = [];
page.on("download", (d) => downloads.push(d));

await installStateHelpers(page);
await page.goto("http://localhost:8149/");
await page.waitForTimeout(900);
await page.evaluate(async (s) => {
  localStorage.clear();
  await window.__writeState(s);
}, seed);
await page.reload();
await page.waitForTimeout(1500);

const go = async (label) => {
  await page
    .locator(`nav button:has-text("${label}"), aside button:has-text("${label}")`)
    .first()
    .click();
  await page.waitForTimeout(700);
};

/** 目前畫面上列出來的別名。 */
const aliasRows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#alias-list tbody tr")].map((tr) => ({
      from: tr.children[0]?.textContent?.trim() || "",
      to: tr.children[1]?.textContent?.trim() || "",
    })),
  );

/** state 裡真正存了幾筆別名。 */
const aliasCount = () =>
  page.evaluate(async () => {
    const data = JSON.parse((await window.__readState()) || "{}");
    return Object.keys(data.intersectionAliases || {}).length;
  });

await go("路口名稱管理");
ok(
  "路口名稱管理頁上有「檔名別名清冊」這一塊（以前完全看不到）",
  (await page.locator("#alias-list").count()) > 0,
  failOnly("找不到 #alias-list"),
);
const before = await aliasRows();
ok("一開始清單是空的", before.length === 0, failOnly(`已經有 ${before.length} 筆`));

/* ── ① 改名 → 應該自動記一筆別名 ── */
const firstNameInput = page
  .locator('.content table input[type="text"], .content table input:not([type])')
  .first();
ok("找得到可以改名的輸入框", (await firstNameInput.count()) > 0);
const oldName = await firstNameInput.inputValue();
const NEW_NAME = "改名測試路口";
await firstNameInput.fill(NEW_NAME);
await firstNameInput.blur();
await page.waitForTimeout(1200);

const afterRename = await aliasRows();
ok(
  "① 改名之後自動記了一筆別名，而且畫面上列得出來",
  afterRename.length === 1,
  afterRename.map((r) => `${r.from} → ${r.to}`).join("、") || "清單還是空的",
);
if (afterRename.length === 1) {
  /*
   * ⚠️ 這一條是「看得懂」那件事。
   *   別名存的是正規化後的鍵，直接印出來的話使用者看到的是一串他沒打過的字。
   *   「會併入的標準路口」那一欄一定要換回**目前的顯示名稱**。
   */
  ok(
    "② 清單上「會併入的標準路口」寫的是改完之後的名字，不是內部鍵",
    afterRename[0].to === NEW_NAME,
    `列出來的是「${afterRename[0].to}」，改成的名字是「${NEW_NAME}」`,
  );
  ok(
    "② 「調查表裡的舊名稱」看得出是原本那一個",
    afterRename[0].from.length > 0 &&
      oldName.replace(/\s/g, "").includes(afterRename[0].from.slice(0, 2)),
    `舊名欄「${afterRename[0].from}」，原本的名字是「${oldName}」`,
  );
}

/* ── ④ 備份 → 清空 → 還原，別名要還在 ── */
console.log("\n══ ④ 備份 → 清空 → 還原 ══");
const storedBefore = await aliasCount();
ok("前置：state 裡真的存了別名", storedBefore === 1, `${storedBefore} 筆`);

await go("備份與還原");
downloads.length = 0;
await page
  .locator('#backup-all button:has-text("下載 JSON（全部計畫）")')
  .first()
  .click();
await page.waitForTimeout(3000);
ok("備份檔下載得下來", downloads.length === 1, `${downloads.length} 個檔案`);
let backup = null;
if (downloads.length === 1) {
  backup = JSON.parse(readFileSync(await downloads[0].path(), "utf8"));
  /*
   * ⚠️ 先確認備份檔裡**真的有**別名。
   *   沒有的話，下面「還原之後還在」就算紅了也是匯出端的問題，
   *   而不是還原端；分不清楚會修錯地方。
   */
  ok(
    "備份檔裡有帶走別名",
    Object.keys(backup.intersectionAliases || {}).length === 1,
    JSON.stringify(backup.intersectionAliases || {}),
  );
}

/* 清空這台電腦 */
await go("備份與還原");
await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === "全部清除",
  );
  button?.click();
});
await page.waitForTimeout(1500);
ok(
  "「全部清除」也會把別名清掉（舊版漏清，會殘留到下一個委託案）",
  (await aliasCount()) === 0,
  failOnly(`清除後還有 ${await aliasCount()} 筆`),
);

/* 還原 */
if (backup) {
  await go("備份與還原");
  await page
    .locator('#backup-restore input[type="file"]')
    .setInputFiles({
      name: "還原測試.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup), "utf8"),
    });
  await page.waitForTimeout(4000);
  const restored = await aliasCount();
  /*
   * ⚠️ 這一條就是使用者問題的核心。
   *   舊版匯出有寫 intersectionAliases，**還原兩條路徑都沒有讀回來**，
   *   所以這裡量到的會是 0——換一台電腦之後每一季匯入都要重新回答
   *   「要不要併入」，而那正是別名這個功能存在的理由。
   */
  ok(
    "④ 還原之後別名還在（舊版會掉，這是這一版修掉的 bug）",
    restored === 1,
    `還原後 ${restored} 筆`,
  );
  await go("路口名稱管理");
  const rows = await aliasRows();
  ok(
    "④ 而且畫面上也列得出來",
    rows.length === 1,
    rows.map((r) => `${r.from} → ${r.to}`).join("、") || "清單是空的",
  );

  /* ── ③ 刪得掉 ── */
  console.log("\n══ ③ 刪除 ══");
  if (rows.length === 1) {
    await page.locator('#alias-list button:has-text("刪除")').first().click();
    await page.waitForTimeout(900);
    const left = await aliasRows();
    ok(
      "③ 刪除之後清單真的少一筆",
      left.length === 0,
      failOnly(`還有 ${left.length} 筆`),
    );
    ok(
      "③ state 裡也真的刪掉了（不是只改畫面）",
      (await aliasCount()) === 0,
      failOnly(`state 裡還有 ${await aliasCount()} 筆`),
    );
  }
}

ok(
  "整段沒有 JS 例外",
  errors.length === 0,
  failOnly(errors.slice(0, 3).join(" | ")),
);

await browser.close();
await server.close?.();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 別名看得到、刪得掉，而且備份還原之後還在");
