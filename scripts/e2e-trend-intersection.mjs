/*
 * ══════════════════════════════════════════════════════════════════
 *  X-60：「歷季趨勢比較」自己的路口下拉，不可以被主工具列鎖住
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-17（附圖）：
 *   「歷季趨勢比較圖說明中有寫，路段不受主工具列影響。但我實測後，
 *     當我選擇A路段後，跳出了不受主工具列影響的提醒文字，但自身的工具列，
 *     想點選B路段，會變成無法選擇……只有我把主工具列的路段解除篩選後，
 *     歷季趨勢圖自己的工具列才能正常使用」
 *   「主工具列不論路口怎麼選，都不影響歷季趨勢圖，這才是本頁不適用主工具列
 *     的『路口』，然後只有自身的工具列選擇單一路口，趨勢圖跟著變動，
 *     才是正常的。」
 *
 * 成因見 traffic-app.tsx 裡那個同步用的 useEffect（X-60 的長註解）。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**不可以只驗「下拉裡看得到 B」**。原本的錯不是選項不見了，
 *     是選下去之後被扳回 A——所以一定要選、等、再讀回值。
 * 二、**不可以只驗值**。值對了但圖沒換，等於下拉是裝飾品；
 *     所以要連圖上的點一起比，而且先確認 A 與 B 的點**真的不一樣**
 *     （一樣的話這一條恆真）。
 * 三、**要在主工具列真的只留一個路口的狀態下測**。不篩的話，
 *     舊程式也會過——那正是使用者說的「把主工具列解除篩選後就正常」。
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

const server = await serve(8188);
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
await page.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 無痕時就算了，前置檢查會紅。 */
  }
}, seed);
await page.goto("http://127.0.0.1:8188/", { waitUntil: "networkidle" });
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

/** 圖上每一個點的值，串成一條字串——換路口的話這一串一定要變。 */
const pointSignature = () =>
  page.evaluate(() => {
    const svg = document.querySelector("#trend-svg");
    if (!svg) return "";
    return [...svg.querySelectorAll("[data-value]")]
      .map((node) => node.getAttribute("data-value"))
      .join("|");
  });

await gotoTab("歷季趨勢比較");

/* ══ 前置：這一頁的路口下拉至少要有兩個路口 ══ */
const picker = page.locator('[data-testid="trend-intersection"]');
if ((await picker.count()) === 0) stop("找不到歷季趨勢比較自己的路口下拉");
const own = await page.evaluate(() =>
  [
    ...document.querySelectorAll('[data-testid="trend-intersection"] option'),
  ].map((node) => ({
    value: node.value,
    text: (node.textContent || "").trim(),
  })),
);
ok(
  "前置：這一頁自己的路口下拉列得出兩個以上的路口",
  own.length >= 2,
  own.map((item) => item.text).join("／") || "一個都沒有",
);
if (own.length < 2) stop("只有一個路口，換不了路口，整支恆真");

const [first, second] = own;

/* 先在**沒有篩**的情況下記下兩個路口各自的圖，確認它們真的不一樣。 */
await picker.selectOption(first.value);
await page.waitForTimeout(1200);
const sigA = await pointSignature();
await picker.selectOption(second.value);
await page.waitForTimeout(1200);
const sigB = await pointSignature();
ok(
  "前置：兩個路口畫出來的圖真的不一樣（一樣的話下面比不出東西）",
  sigA !== "" && sigB !== "" && sigA !== sigB,
  `${first.text}=${sigA.slice(0, 40)}… vs ${second.text}=${sigB.slice(0, 40)}…`,
);
if (!sigA || !sigB || sigA === sigB) stop("兩個路口的圖分不出來");

/* ══ 一、在主工具列把路口縮到只剩第一個 ══════════════════════ */
console.log("\n══ 一、主工具列只留一個路口 ══");
await picker.selectOption(first.value);
await page.waitForTimeout(900);
await page.locator('[data-testid="mt-intersections"]').click();
await page.waitForTimeout(500);
/*
 * ⚠️ 主工具列那份清單的 value **不是** recordIntersectionKey
 *   （它是正規化過的路口名），所以不可以拿這一頁下拉的 value 去對。
 *   兩邊唯一共通的是**看得到的名字**——使用者也是照名字勾的。
 */
const wantedText = first.text.replace(/\s+/g, "");
const picked = await page.evaluate((wanted) => {
  const panel = document.querySelector(".multi-picker-panel");
  if (!panel) return null;
  const labels = [...panel.querySelectorAll("label")];
  const hit = labels.find((node) =>
    (node.textContent || "").replace(/\s+/g, "").includes(wanted),
  );
  if (!hit)
    return {
      miss: labels.map((node) => (node.textContent || "").replace(/\s+/g, "")),
    };
  hit.querySelector("input")?.click();
  return (hit.textContent || "").replace(/\s+/g, "");
}, wantedText);
ok(
  "前置：主工具列勾得到第一個路口",
  typeof picked === "string",
  typeof picked === "string"
    ? picked
    : `找不到「${wantedText}」，面板裡是：${(picked?.miss || []).join("／")}`,
);
await page.keyboard.press("Escape");
await page.waitForTimeout(1200);
const toolbarSummary = await page
  .locator('[data-testid="mt-summary"]')
  .first()
  .innerText()
  .catch(() => "");
ok(
  "前置：主工具列真的縮成 1 個路口了（沒縮的話舊程式也會過）",
  /1\s*個路口/.test(toolbarSummary.replace(/\s+/g, " ")),
  toolbarSummary.replace(/\s+/g, " ").slice(0, 80),
);

/* ══ 二、這一頁自己的下拉仍然選得動 ════════════════════════════ */
console.log("\n══ 二、自己的下拉選得動 ══");
const stillListed = await page.evaluate(
  (wanted) =>
    [
      ...document.querySelectorAll('[data-testid="trend-intersection"] option'),
    ].some((node) => node.value === wanted),
  second.value,
);
ok(
  "② 被主工具列篩掉的那個路口，仍然留在這一頁自己的下拉裡",
  stillListed === true,
  stillListed ? "" : `「${second.text}」不見了`,
);

await picker.selectOption(second.value);
await page.waitForTimeout(1400);
const afterValue = await picker.inputValue();
ok(
  "⚠️ ② 選下去之後**留得住**（舊版會被同步用的 effect 立刻扳回主工具列那一個）",
  afterValue === second.value,
  afterValue === first.value
    ? `被扳回「${first.text}」了`
    : `目前是「${afterValue}」`,
);

const afterSig = await pointSignature();
ok(
  "⚠️ ② 而且圖真的換成那個路口（值對但圖沒換＝下拉是裝飾品）",
  afterSig === sigB,
  afterSig === sigA ? "圖還是主工具列那一個路口的" : afterSig.slice(0, 60),
);

/* ══ 三、換回來也要換得回去 ══════════════════════════════════ */
console.log("\n══ 三、換得回去 ══");
await picker.selectOption(first.value);
await page.waitForTimeout(1400);
ok(
  "③ 再切回第一個路口，圖也跟著回去",
  (await picker.inputValue()) === first.value &&
    (await pointSignature()) === sigA,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 歷季趨勢比較自己的路口下拉，不受主工具列的路口影響");
