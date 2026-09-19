/*
 * ══════════════════════════════════════════════════════════════════
 *  X-64：「道路與流向管理」是設定頁，不吃主工具列的路口與資料別
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-17（附圖，而且自己還原了重現步驟）：
 *   「我先故意勾選主工具列任意兩個路段，然後再去資料匯入新資料，
 *     再回到道路與流向管理分頁……路段變成不可選」
 *
 * 重現的關鍵是**站號逐季會變**（這一支已知 T1-01 → T5-01）。
 * 主工具列的路口篩選照站號比對，所以勾了舊季的兩個路口之後匯入新一季，
 * 那兩個站號在新一季不存在 → 這一頁的「切換路口」整個空掉，
 * **連換一個路口都做不到**；而下面的幾何卡還停在上一次那一季，
 * 畫面上同時出現「圖面季度 113Q1」與「資料季度 111Q3」，自己打自己。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**不可以只驗「下拉有選項」**。真正壞掉的是「主工具列篩掉之後就空了」，
 *     所以一定要在**篩到一個這一季沒有的路口**的狀態下驗。
 * 二、**要連下面那張卡一起驗**。下拉有東西、卡片卻停在別季，
 *     使用者改到的仍然是錯的那一筆。
 * 三、**要驗它真的換得動**：選第二個路口，卡片要跟著換。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureToolbarOpen } from "./_toolbar.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { serve } = await import(pathToFileURL(join(HERE, "serve.mjs")).href);
const { launchOptions } = await import(
  pathToFileURL(join(HERE, "chrome-path.mjs")).href
);
const seed = readFileSync(join(HERE, "seed-wide.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};
const stop = (why) => {
  console.error(`\n❌ ${why}——後面的條件會變成恆真，直接停。`);
  problems.push(why);
};

const server = await serve(8190);
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
page.on("dialog", (d) => d.accept());
await page.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 無痕時就算了，前置檢查會紅。 */
  }
}, seed);
await page.goto("http://127.0.0.1:8190/", { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

const gotoTab = async (name) => {
  await page
    .locator(`aside.sidebar nav button:has-text("${name}")`)
    .first()
    .click();
  await page.waitForTimeout(1000);
};

/** 這一頁上「切換路口」下拉的選項，以及下面那張幾何卡的季度。 */
const survey = () =>
  page.evaluate(() => {
    const labels = [...document.querySelectorAll(".head-buttons label")];
    const pick = (name) =>
      labels.find((node) => (node.textContent || "").includes(name));
    const quarterSelect = pick("圖面季度")?.querySelector("select");
    const intersectionSelect = pick("切換路口")?.querySelector("select");
    /* 卡片抬頭寫著「資料季度 115Q3 · 原始站號 T16-01」。 */
    const caption = (
      document.querySelector("#geometry-approaches .panel-head small")
        ?.textContent || ""
    )
      .replace(/\s+/g, " ")
      .trim();
    const cardName = (
      document.querySelector("#geometry-approaches .panel-head h2")
        ?.textContent || ""
    ).trim();
    return {
      quarter: quarterSelect?.value || "",
      options: [...(intersectionSelect?.options ?? [])].map((o) => ({
        value: o.value,
        text: (o.textContent || "").trim(),
      })),
      picked: intersectionSelect?.value || "",
      caption,
      cardName,
    };
  });

await gotoTab("道路與流向管理");

/* ══ 一、沒篩的時候本來就該正常（前置，不然下面比不出差別）══ */
console.log("\n══ 一、沒篩的時候 ══");
const clean = await survey();
ok(
  "前置：這一頁的「切換路口」列得出兩個以上的路口",
  clean.options.length >= 2,
  clean.options.map((o) => o.text).join("／") || "一個都沒有",
);
if (clean.options.length < 2) stop("只有一個路口，換不了路口，整支恆真");
ok(
  "前置：卡片上寫得出「資料季度」（寫不出來的話下面第三條驗不到）",
  /資料季度/.test(clean.caption),
  clean.caption || "找不到那一行",
);

/* ══ 二、主工具列篩到「這一季沒有的路口」════════════════════ */
console.log("\n══ 二、主工具列篩掉之後 ══");
/*
 * ⚠️ 直接改 state 就好：這一支要驗的是**篩到一個這一季沒有的站號**時
 *   這一頁還能不能用，不是主工具列本身怎麼操作（那是 e2e-main-toolbar 的事）。
 *   用一個一定不存在的站號，等同於使用者「勾了舊季的兩個路口再匯入新一季」。
 */
await page.locator('[data-testid="mt-intersections"]').click();
await page.waitForTimeout(500);
const pickedName = await page.evaluate(() => {
  const panel = document.querySelector(".multi-picker-panel");
  if (!panel) return null;
  const labels = [...panel.querySelectorAll("label")];
  /* 挑最後一個，讓它與下拉的第一項不同。 */
  const hit = labels[labels.length - 1];
  if (!hit) return null;
  hit.querySelector("input")?.click();
  return (hit.textContent || "").replace(/\s+/g, "");
});
ok("前置：主工具列勾得到一個路口", Boolean(pickedName), pickedName || "面板是空的");
await page.keyboard.press("Escape");
await page.waitForTimeout(1200);
/* 再把圖面季度切到**那個路口沒有資料**的一季（若有的話）。 */
const quarters = await page.evaluate(() => {
  const labels = [...document.querySelectorAll(".head-buttons label")];
  const select = labels
    .find((node) => (node.textContent || "").includes("圖面季度"))
    ?.querySelector("select");
  return [...(select?.options ?? [])].map((o) => o.value);
});
for (const q of quarters) {
  await page.evaluate((value) => {
    const labels = [...document.querySelectorAll(".head-buttons label")];
    const select = labels
      .find((node) => (node.textContent || "").includes("圖面季度"))
      ?.querySelector("select");
    if (!select) return;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, q);
  await page.waitForTimeout(1200);
  const now = await survey();
  ok(
    `⚠️ ② 圖面季度 ${q}：主工具列篩掉之後，「切換路口」仍然列得出這一季的路口`,
    now.options.length >= 1,
    `${now.options.length} 項：${now.options.map((o) => o.text).join("／")}`,
  );
  ok(
    `⚠️ ② 圖面季度 ${q}：卡片上的「資料季度」就是圖面季度（不可以停在別季）`,
    now.caption.includes(q),
    now.caption || "找不到那一行",
  );
}

/* ══ 三、而且真的換得動 ══════════════════════════════════════ */
console.log("\n══ 三、換得動 ══");
const before = await survey();
const other = before.options.find((o) => o.value !== before.picked);
ok(
  "前置：有第二個路口可以換過去",
  Boolean(other),
  before.options.map((o) => o.text).join("／"),
);
if (other) {
  await page.evaluate((value) => {
    const labels = [...document.querySelectorAll(".head-buttons label")];
    const select = labels
      .find((node) => (node.textContent || "").includes("切換路口"))
      ?.querySelector("select");
    if (!select) return;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, other.value);
  await page.waitForTimeout(1300);
  const after = await survey();
  ok(
    "⚠️ ③ 換過去之後真的換了（選了留得住，卡片也跟著換）",
    after.picked === other.value && after.cardName !== before.cardName,
    `目前 ${after.picked}／卡片「${after.cardName}」（原本「${before.cardName}」）`,
  );
}

/*
 * ⚠️ 畫面上要**明講**它不吃主工具列的路口與資料別。
 *   只把行為改對、畫面不講的話，使用者在別頁篩了路口、切過來看到全部，
 *   會以為篩選壞了——與「先篩再檢查」那一整類是同一條規則。
 */
const note = await page.evaluate(() =>
  [...document.querySelectorAll(".chart-inapplicable")]
    .map((node) => (node.textContent || "").replace(/\s+/g, ""))
    .join(" ｜ "),
);
ok(
  "⚠️ ④ 這一頁寫明「不受主工具列的路口與資料別影響」",
  note.includes("不受主工具列") &&
    note.includes("路口") &&
    note.includes("資料別"),
  note.slice(0, 120) || "一句都沒有",
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 道路與流向管理不受主工具列的路口與資料別影響，而且換得動");
