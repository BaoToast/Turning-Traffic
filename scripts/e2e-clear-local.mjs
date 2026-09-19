/*
 * ══════════════════════════════════════════════════════════════════════
 *  清除本機資料：問清楚代價、沒備份先攔一次、清得乾淨
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：「請三個程式都要有~刪除本機資料+補的那三件事」。
 * 那三件事是：
 *   ① 確認視窗要寫出**代價**（幾個計畫、幾筆資料），不是只問「確定嗎」
 *   ② 沒下載過完整備份要先提醒一次（提醒，不是禁止）
 *   ③ 說明要講清楚它和「刪除計畫」差在哪
 *
 * ⚠️ ③ 不是文案潔癖。使用者原本問的就是「這個一鍵清除本機資料是否有需要
 *   作? 還是要拿掉?」——會這樣問，正是因為畫面上看不出它和刪計畫差在哪。
 *   功能講不清楚，等於不存在。
 *
 * ⚠️ 而且一定要驗**真的清乾淨**。只驗「按了會問」的話，一支
 *   「問完什麼都沒做」的程式照樣全綠。
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
const server = await serve(8157);

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));

/* 逐一記下每一個對話框問了什麼，並決定要不要按確定。 */
const dialogs = [];
let acceptAll = false;
page.on("dialog", async (d) => {
  dialogs.push(d.message());
  if (acceptAll) await d.accept();
  else await d.dismiss();
});

await installStateHelpers(page);
await page.goto("http://localhost:8157/");
await page.waitForTimeout(900);
await page.evaluate(async (state) => {
  localStorage.clear();
  await window.__writeState(state);
}, seed);
await page.reload();
await page.waitForTimeout(1600);

const go = async (label) => {
  await page.locator(`nav > div > button:has-text("${label}")`).first().click();
  await page.waitForTimeout(800);
};
await go("備份與還原");

/* ── ③ 說明 ── */
console.log("\n══ ③ 說明講不講得清楚 ══");
ok(
  "有「清除本機資料」這一區",
  (await page.locator("#clear-local").count()) > 0,
);
const why = await page
  .locator("#clear-local .danger-zone-why")
  .first()
  .textContent()
  .catch(() => "");
ok(
  "③ 說明寫出它和「刪除計畫」差在哪",
  (why || "").includes("刪除計畫") || (why || "").includes("刪計畫"),
  (why || "沒有這段說明").replace(/\s+/g, " ").slice(0, 60),
);
ok(
  "③ 說明寫出什麼時候該用它",
  (why || "").includes("什麼時候"),
  (why || "").replace(/\s+/g, " ").slice(0, 60),
);
/*
 * ⚠️ 不可以寫成「刪計畫之後殘留的設定會默默改到你的資料」。
 *   查證過：當量、車種分類、路段與流向設定都是依計畫存的，刪計畫時一起刪。
 *   說得比實際嚴重，會逼使用者去做不必要的清除，也讓他不再相信其他說明。
 */
ok(
  "③ 沒有把殘留講成「會影響數字」（查證過：不會，說得比實際嚴重比不講更糟）",
  !/殘留.*數字|默默改|影響.*計算結果/.test(why || ""),
  (why || "").replace(/\s+/g, " ").slice(0, 60),
);

/* ── ② 沒備份先攔一次 ── */
console.log("\n══ ② 沒下載過備份 ══");
dialogs.length = 0;
acceptAll = false;
await page.locator("#clearLocalData").click();
await page.waitForTimeout(1200);
ok(
  "② 還沒備份過就按，會先被提醒一次",
  dialogs.length >= 1 && dialogs[0].includes("備份"),
  dialogs[0]?.replace(/\s+/g, " ").slice(0, 60) || "完全沒有問",
);
ok(
  "② 在提醒視窗按「取消」＝不清除（提醒是提醒，不是走完流程）",
  (await page.locator(".project-row, .portfolio-row").count()) > 0 ||
    dialogs.length === 1,
  `之後又問了 ${dialogs.length - 1} 次`,
);

/* ── ① 確認視窗要寫出代價 ── */
console.log("\n══ ① 確認視窗寫不寫得出代價 ══");
dialogs.length = 0;
acceptAll = false;
/* 這一次讓第一個提醒過關，看第二個視窗（真正的確認）寫了什麼。 */
page.removeAllListeners("dialog");
const seen = [];
page.on("dialog", async (d) => {
  seen.push(d.message());
  /* 第一個（備份提醒）按確定、第二個（真正的確認）按取消。 */
  if (seen.length === 1) await d.accept();
  else await d.dismiss();
});
await page.locator("#clearLocalData").click();
await page.waitForTimeout(1500);
const confirmText = seen[seen.length - 1] || "";
ok(
  "① 確認視窗寫出會刪掉幾個計畫",
  /\d+\s*個計畫/.test(confirmText),
  confirmText.replace(/\s+/g, " ").slice(0, 80) || "沒有確認視窗",
);
ok(
  "① 確認視窗寫出會刪掉幾筆資料",
  /\d+\s*筆/.test(confirmText),
  confirmText.replace(/\s+/g, " ").slice(0, 80),
);
ok(
  "① 確認視窗寫明無法復原",
  confirmText.includes("無法復原"),
  confirmText.replace(/\s+/g, " ").slice(0, 80),
);

/* ── 真的清乾淨 ── */
console.log("\n══ 真的清乾淨 ══");
page.removeAllListeners("dialog");
page.on("dialog", async (d) => {
  await d.accept();
});
/* 前一段按過「取消」，畫面還在原地；保險起見再導一次。 */
await go("備份與還原");
const before = await page.evaluate(async () => {
  const data = JSON.parse((await window.__readState()) || "{}");
  return (data.projects || []).length;
});
await page.locator("#clearLocalData").click();
await page.waitForTimeout(4000);
const after = await page.evaluate(async () => {
  const data = JSON.parse((await window.__readState()) || "{}");
  return (data.projects || []).length;
});
ok(
  "⚠️ 真的清掉了（只驗「有沒有問」的話，一支問完什麼都不做的程式也會全綠）",
  after === 0 && before > 0,
  `清除前 ${before} 個計畫、清除後 ${after} 個`,
);
const left = await page.evaluate(async () => {
  const data = JSON.parse((await window.__readState()) || "{}");
  return {
    projects: (data.projects || []).length,
    records: (data.records || []).length,
    aliases: Object.keys(data.intersectionAliases || {}).length,
  };
});
ok(
  "計畫、資料與別名全部不見了",
  left.projects === 0 && left.records === 0 && left.aliases === 0,
  `計畫 ${left.projects}、資料 ${left.records}、別名 ${left.aliases}`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
await server.close?.();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 清除本機資料：問清楚代價、沒備份先攔、清得乾淨");
