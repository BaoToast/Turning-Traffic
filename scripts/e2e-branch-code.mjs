/*
 * ══════════════════════════════════════════════════════════════════
 *  支線分類看的是「名稱」，而且看起來一樣的名字要算同一個
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11 的兩段回報，合起來才是完整的需求：
 *
 *   ①「我把自動抓到的名字手動同步名稱（本來統一為路口A、路口B，
 *      為了等下方便辨識，故意改為 123），然後我在結論草稿產生器那邊看到
 *      『四、要寫哪些支線』，他竟然把自訂義的名稱也獨立變成一個選項了。」
 *
 *   ②「A 和 B 路段用預設名稱『路口A』就能正常抓到；C 路段自動讀到
 *      『神農路口』，**就算我手動改成『路口A』，也不會被歸類到路口A裡面**，
 *      除非我把 A、B 也手動輸入一次一模一樣的『路口A』才會歸在一起。」
 *
 * ── 真正的成因：自動命名多了一個空格 ─────────────────────────
 *
 * inferApproachGeometry() 產生的預設名稱是 `"路口 " + code`
 * ——「路口」和代碼之間**有一個半形空格**。使用者手打的是「路口A」。
 * `路口 A` ≠ `路口A`，於是同一個看起來一樣的名字被當成兩條不同的支線。
 * **不是「預設的」與「手動的」被分成兩類**，就是那個空格。
 *
 * 修法：比對前一律過 branchNameKey()（NFKC、去空白與標點、統一全半形）。
 *
 * ⚠️ 一度改成用**支線代碼**分類，被使用者否決，而且他的理由是對的：
 *   「假設哪一天檔案第一條支線其實是路口D，只是這份資料不小心被挪到了
 *     第一支線的位置，原本我希望我可以自己手動去修改名稱後，
 *     讓程式把同樣名稱歸類在一起，現在反而作不到。」
 *   代碼是檔案給的位置，名稱才是使用者可以修正的事實。
 *   所以這一支**不可以**改回去驗「改名後項目數不變」——
 *   改成新名字本來就該長出新的分類，那是功能不是 bug。
 *
 * ── ⚠️ 刻意迴避的假通過 ───────────────────────────────────────
 *
 * 一、**只驗「清單有 7 項」不算數**：改名前本來就是 7 項。
 *     一定要**真的去改名**，再看清單怎麼變。
 * 二、**只驗「改名後有新名字」不算數**：那只證明改名生效，
 *     證明不了空格差異會被吸收。空格那一段才是這次的核心。
 * 三、前置檢查：確認改名這個動作真的生效了（欄位值真的變了），
 *     不然後面每一條都是在量一個沒發生的操作。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8293;
const seed = readFileSync(join(here, "seed-wide.json"), "utf8");

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

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.addInitScript((t) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", t);
  } catch {
    /* 無痕或封鎖時就算了，下面的前置檢查會紅。 */
  }
}, seed);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const branchList = () =>
  page.evaluate(() => {
    const fs = [...document.querySelectorAll("fieldset")].find((f) =>
      (f.querySelector("legend")?.textContent || "").includes("支線"),
    );
    return fs
      ? [...fs.querySelectorAll("label")].map((l) => l.textContent.trim())
      : [];
  });

await page.locator('nav button:has-text("結論草稿產生器")').first().click();
await page.waitForTimeout(1100);
const before = await branchList();
ok(
  "前置：改名前支線清單讀得到東西",
  before.length > 0,
  failOnly("一項都讀不到——定位方式是不是變了？"),
);
console.log(`   改名前：${before.join(" / ")}`);

/* ── 走使用者做過的那條路：把某一個路口的支線改名 ─────────── */
await page.locator('nav button:has-text("道路與流向管理")').first().click();
await page.waitForTimeout(1200);
const inputs = page.locator(
  '.geometry-list input[type="text"], .geometry-list input:not([type])',
);
const renameCount = Math.min(3, await inputs.count());
for (let i = 0; i < renameCount; i += 1) {
  await inputs.nth(i).fill(String(i + 1));
  await page.waitForTimeout(250);
}
ok(
  "前置：真的改到了支線名稱",
  renameCount >= 3 &&
    (await inputs.nth(0).inputValue()) === "1" &&
    (await inputs.nth(2).inputValue()) === "3",
  failOnly(`只找到 ${await inputs.count()} 個可改的名稱欄位`),
);

await page.locator('nav button:has-text("結論草稿產生器")').first().click();
await page.waitForTimeout(1200);
const after = await branchList();
console.log(`   改名後：${after.join(" / ")}`);

/*
 * ⚠️ 這裡**不可以**驗「項目數不變」。
 *
 * 分類照名稱走，所以把某一個路口的三條支線改成 1／2／3 之後，
 * 清單多出 1、2、3 三項是**正確的**——那三個是使用者自己取的新名字，
 * 而其他路口仍然叫路口A／B／C，它們當然還在。
 * 驗「不變」等於把「用代碼分類」那個被否決的設計偷偷寫回守門裡。
 */
ok(
  "改名之後新名稱出現在清單上",
  ["1", "2", "3"].every((n) => after.some((t) => t === n)),
  failOnly(`清單：${after.join(" / ")}`),
);
ok(
  "其他路口沒改名的支線照樣在（改一個路口不會動到別人）",
  ["路口A", "路口B", "路口C"].every((n) => after.some((t) => t === n)),
  failOnly(`清單：${after.join(" / ")}`),
);
ok(
  "清單剛好多出三項（改了三條支線）",
  after.length === before.length + 3,
  `改名前 ${before.length} 項、改名後 ${after.length} 項｜${after.join(" / ")}`,
);

/* ── 使用者 2026-09-11 的第二段回報：空格造成的假分裂 ─────────
 *
 * 「就算我手動改成『路口A』，他也不會被歸類到路口A裡面。」
 * 成因是自動命名寫的是「路口 A」（中間有半形空格），手打的是「路口A」。
 * 這裡把剛剛改成 1／2／3 的那三條**再改成帶空格的寫法**，
 * 清單項目數必須仍然不變——證明空格差異不會再造出一個新分類。
 */
await page.locator('nav button:has-text("道路與流向管理")').first().click();
await page.waitForTimeout(1000);
for (let i = 0; i < renameCount; i += 1) {
  await inputs.nth(i).fill("路口 " + String.fromCharCode(65 + i));
  await page.waitForTimeout(250);
}
await page.locator('nav button:has-text("結論草稿產生器")').first().click();
await page.waitForTimeout(1200);
const spaced = await branchList();
console.log(`   改成帶空格的寫法：${spaced.join(" / ")}`);
ok(
  "「路口 A」（有空格）與「路口A」（沒空格）視為同一項，清單回到原本的項數",
  spaced.length === before.length,
  `改名前 ${before.length} 項、現在 ${spaced.length} 項｜${spaced.join(" / ")}`,
);
/*
 * ⚠️ 反面：只看項數會被「剛好也是 7 項但內容不同」騙過去。
 *   這裡直接確認沒有出現兩個看起來一樣的名字各佔一項。
 */
const normalized = spaced.map((t) =>
  t
    .replace(/（[^）]*）$/, "")
    .normalize("NFKC")
    .replace(/\s/g, ""),
);
ok(
  "清單裡沒有兩項是同一個名字（只差空白或全半形）",
  new Set(normalized).size === normalized.length,
  failOnly(`清單：${spaced.join(" / ")}`),
);

ok("過程中沒有 JS 例外", errors.length === 0, failOnly(errors.slice(0, 3).join(" / ")));

await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過`);
  process.exit(1);
}
console.log("\n✅ 全部通過");
