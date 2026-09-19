/*
 * ══════════════════════════════════════════════════════════════════════
 *  「檢查起點 → 終點流向」分組之後，改到的必須還是**那一列**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「路口轉向程式，檢查起點 → 終點流向，做的很好，只是把所有路口都做在
 *     同一畫面，容易看眼花，表單內容的格式不用變動，只需幫我做好如同
 *     全日交通量對於『檢查起點 → 終點流向』各路口的分類，
 *     一個路口就獨自展開收合。」
 *
 * ── 這一支要擋的是什麼 ─────────────────────────────────────
 *
 * 分組本身是排版，改壞了一眼就看得出來。真正危險的是**索引**：
 * 每一列的 onChange 改的是 `record.routes[routeIndex]`，而那個
 * routeIndex 必須是「在 selected.routes 裡的原始索引」。
 * 分組之後若改用**組內**的索引（`group.items.map((route, i) => …)`
 * 是最自然、也最容易寫出來的寫法），畫面上**完全正常**：
 * 選單顯示對的值、下拉打得開、看起來也存得下去——
 * 但你在「由 C 駛出」改的那一格，實際上改到的是「由 A 駛出」的某一列。
 *
 * ⚠️ 這正是使用者最在意的那一類錯：**篩選錯誤和計算錯誤一樣嚴重**，
 *   而且它不會報錯、不會變色，要等到出報表對不上才會被發現。
 *
 * 所以這一支不驗「有沒有分組」（那是排版，肉眼就看得到），
 * 而是**真的去改一格，再把資料讀回來，確認改到的是那一列、而且只有那一列**。
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";

/* ⚠️ 沒有種子資料的話畫面上一個路口都沒有，整支會「檢查了 0 個東西」然後全綠。 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "github-pages-dist");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
});
const page = await context.newPage();
const seed = readFileSync(join(here, "seed-state.json"), "utf8");
await page.addInitScript(
  (value) => localStorage.setItem("turning-traffic-state-v2", value),
  seed,
);
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.dismiss());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

/* 用種子資料建出一個多岔路口（seed-state 已經造好了多岔的示範資料）。 */
await page.evaluate(() => {
  const button = [...document.querySelectorAll("nav button")].find((element) =>
    (element.textContent || "").includes("道路與流向管理"),
  );
  if (button) button.click();
});
await page.waitForTimeout(700);

/* 把「檢查起點 → 終點流向」那一塊展開。 */
const opened = await page.evaluate(() => {
  const details = [...document.querySelectorAll("details.route-mapping")];
  for (const item of details) item.open = true;
  return details.length;
});
ok("前置①：找得到「檢查起點 → 終點流向」那一塊", opened > 0, `${opened} 塊`);
await page.waitForTimeout(400);

const groups = await page.evaluate(() =>
  [...document.querySelectorAll("details.route-group")].map((element) => ({
    title: (element.querySelector("summary")?.textContent || "").trim(),
  })),
);

/*
 * ⚠️ 前置②：真的分成**兩組以上**。只有一組的話，組內索引和原始索引
 *   剛好相同，這一支的比對會恆真——那時它就不再守著任何東西。
 */
ok(
  "前置②：真的分成兩組以上（只有一組的話組內索引＝原始索引，整支恆真）",
  groups.length >= 2,
  groups.map((group) => group.title).join("、"),
);

/* 全部展開，才點得到後面那幾組的下拉。 */
await page.evaluate(() => {
  for (const element of document.querySelectorAll("details.route-group"))
    element.open = true;
});
await page.waitForTimeout(400);

/** 把畫面上每一列讀成 [起點, 終點, 轉向] 的字串，當作比對基準。 */
const readRows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("details.route-group tbody tr")].map(
      (row) => {
        const cells = row.querySelectorAll("td");
        const selects = row.querySelectorAll("select");
        return [
          (cells[0]?.textContent || "").trim(),
          selects[0]?.selectedOptions[0]?.textContent?.trim() || "",
          selects[1]?.value || "",
        ].join("｜");
      },
    ),
  );

const before = await readRows();
ok("前置③：讀得到列（讀到 0 列就是恆真）", before.length >= 6, `${before.length} 列`);

/*
 * 挑**最後一組裡的第一列**下手——那是原始索引與組內索引差最多的位置，
 * 寫錯索引時偏移最大、最容易現形。
 */
const target = await page.evaluate(() => {
  const groupList = [...document.querySelectorAll("details.route-group")];
  const last = groupList[groupList.length - 1];
  const row = last?.querySelector("tbody tr");
  if (!row) return null;
  const all = [...document.querySelectorAll("details.route-group tbody tr")];
  const select = row.querySelectorAll("select")[1];
  const options = [...select.options].map((option) => option.value);
  const next = options.find((value) => value !== select.value);
  return { index: all.indexOf(row), from: select.value, to: next };
});
ok("前置④：找得到可以改的那一格", !!target && !!target.to);

if (target && target.to) {
  await page.evaluate((info) => {
    const all = [...document.querySelectorAll("details.route-group tbody tr")];
    const select = all[info.index].querySelectorAll("select")[1];
    select.value = info.to;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, target);
  await page.waitForTimeout(700);

  const after = await readRows();
  ok(
    "改完之後列數沒有變（不可以有列憑空消失或多出來）",
    after.length === before.length,
    `${before.length} → ${after.length}`,
  );

  const changed = [];
  for (let i = 0; i < Math.min(before.length, after.length); i += 1)
    if (before[i] !== after[i]) changed.push(i);

  ok(
    "**只有我改的那一列變了**（改到別列＝畫面正常但資料錯）",
    changed.length === 1 && changed[0] === target.index,
    `我改第 ${target.index} 列，實際變動的是第 [${changed.join(", ")}] 列`,
  );

  ok(
    "而且那一列真的變成我選的值",
    (after[target.index] || "").endsWith(`｜${target.to}`),
    `${after[target.index]}（預期結尾 ｜${target.to}）`,
  );

  /* 重新整理之後要還在——改到記憶體裡但沒存下去也是一種「看起來正常」。 */
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("nav button")].find((element) =>
      (element.textContent || "").includes("道路與流向管理"),
    );
    if (button) button.click();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    for (const item of document.querySelectorAll("details.route-mapping"))
      item.open = true;
    for (const item of document.querySelectorAll("details.route-group"))
      item.open = true;
  });
  await page.waitForTimeout(400);
  const reloaded = await readRows();
  ok(
    "重新整理之後那一列的改動還在",
    (reloaded[target.index] || "").endsWith(`｜${target.to}`),
    reloaded[target.index] || "(讀不到)",
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 分組之後改到的還是那一列，而且只有那一列");
