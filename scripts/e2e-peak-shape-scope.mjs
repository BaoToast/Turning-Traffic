/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-83：尖峰形狀那兩張圖到底畫的是誰
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-17：「路口轉向程式中，『尖峰小時內4格15分鐘分布圖』和
 *   『連續60分鐘流率(依時間)圖』，在點選多個調查點位時，仍只有一張圖，
 *   這是加總的圖還是整體綜合平均圖嗎?」
 *
 * 查證結果：**兩者都不是**——那兩張畫的是一季 × 一個路口 × 一種資料別。
 * 真正的缺陷是圖上沒寫是哪一季哪一個路口，多選時使用者無從判斷。
 *
 * 使用者 2026-09-18 指定的修法：
 *   「圖的標題上不需要寫出站號，只要寫出路口就好……那圖標標題就寫出
 *     季別和 路名，並提醒一次只能 一季+一調查點位」
 *
 * ── ⚠️ 刻意迴避的假通過 ──────────────────────────────────────────
 * 一、**不可以只驗「標題有字」**。要驗它**真的寫著目前那一季與那一個路口**，
 *     而且**不可以寫站號**（使用者明講不要）。
 * 二、提醒只在多選時出現：**單選時不可以有**，否則那是常駐噪音
 *     （這條反面不驗的話，「永遠顯示」也會全綠）。
 * 三、切到另一個路口時標題**要真的跟著換**，不是寫死第一個。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

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
    return res.end();
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] || "application/octet-stream",
  });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};
const stop = (why) => {
  console.error(`\n❌ ${why}——後面的條件會變成恆真，直接停。`);
  problems.push(why);
};

/*
 * ⚠️ 這兩張圖只適用「15 分鐘一格」的調查檔，所以一定要用 seed-15min。
 *   用一般測資的話兩張圖都會顯示「不適用」，整支恆真
 *  （2026-09-12 踩過一模一樣的坑，見 e2e-removed-surfaces 的註解）。
 */
const seed = JSON.parse(readFileSync(join(here, "seed-15min.json"), "utf8"));
const template = seed.records[0];
/* 同一季兩個路口：才問得出「多選時要提醒」與「切換時標題要跟著換」。 */
seed.records = [
  {
    ...template,
    id: "PS1",
    quarter: "115Q1",
    station: "T1-01",
    name: "中山北路－岡山路口",
  },
  {
    ...template,
    id: "PS2",
    quarter: "115Q1",
    station: "T1-02",
    name: "岡山北路－育才路口",
  },
];

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1700, height: 1100 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.addInitScript(
  (value) => localStorage.setItem("turning-traffic-state-v2", value),
  JSON.stringify(seed),
);
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2200);
await ensureToolbarOpen(page);

await page.evaluate(() => {
  const button = [...document.querySelectorAll("aside nav button")].find(
    (node) => (node.textContent || "").includes("轉向進階分析"),
  );
  button?.click();
});
await page.waitForTimeout(1600);
const openBoth = async () => {
  await page.evaluate(() => {
    for (const id of ["advanced-peak-quarter", "advanced-peak-window"]) {
      const node = document.getElementById(id);
      if (node) node.open = true;
    }
  });
  await page.waitForTimeout(900);
};
await openBoth();

const titles = () =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="peak-quarter-title"], [data-testid="peak-window-title"]',
      ),
    ].map((el) => (el.textContent || "").trim()),
  );
const scopeNotes = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="peak-shape-scope"]')].map(
      (el) => (el.textContent || "").replace(/\s+/g, " ").trim(),
    ),
  );

/* ══ ① 兩個路口都在畫面上時：標題要寫清楚，而且要提醒 ══════ */
console.log("\n══ ① 主工具列有兩個路口 ══");
const multi = await titles();
ok(
  "前置：兩張圖都畫得出來（不適用的話下面全部恆真）",
  multi.length === 2,
  `${multi.length} 個標題`,
);
if (multi.length !== 2) stop("兩張圖沒有畫出來");
ok(
  "⚠️ ① 標題寫出**季別**（不寫的話多季時看不出是哪一季）",
  multi.every((t) => /115Q1/.test(t)),
  multi.join(" ／ "),
);
ok(
  "⚠️ ① 標題寫出**路口名稱**",
  multi.every((t) => /路口/.test(t)),
  multi.join(" ／ "),
);
ok(
  "⚠️ ① 標題**不可以**寫站號（使用者明講不要：站號會換季換代碼，對讀圖的人沒有意義）",
  multi.every((t) => !/T\d+-\d+/.test(t)),
  multi.join(" ／ "),
);
const notes = await scopeNotes();
ok(
  "⚠️ ① 多選路口時要提醒「一次只看一季、一個路口」",
  notes.length === 2 && notes.every((t) => /一次只看一季、一個路口/.test(t)),
  notes[0]?.slice(0, 60) || "（沒有提醒）",
);
ok(
  "⚠️ ① 提醒裡要點名是哪一塊（不可以寫「這兩張圖」這種代稱）",
  notes.some((t) => t.includes("尖峰小時內四格 15 分鐘分布")) &&
    notes.some((t) => t.includes("連續 60 分鐘流率")),
  notes.map((t) => t.slice(0, 24)).join(" ／ "),
);

/* ══ ② 切到另一個路口，標題要跟著換 ════════════════════════ */
console.log("\n══ ② 換一個路口 ══");
/*
 * ⚠️ 要用 Playwright 的 selectOption，不可以自己 select.value = ... 再 dispatch：
 *   React 的受控元件會追蹤自己寫進去的值，手動賦值有機會被它視為沒變、
 *   直接把畫面扳回去——那時這一條會紅，而紅的原因是測試的作法，不是程式。
 */
/* ⚠️ 不可以用標籤文字找：「路口流量視角」也以「路口」開頭，會抓錯一顆
   （第一版就抓到它，量到的三個選項是駛出／駛入／並列）。用 testid。 */
const intersectionSelect = page
  .locator('[data-testid="advanced-intersection"]')
  .first();
const options = await intersectionSelect
  .locator("option")
  .allTextContents()
  .catch(() => []);
const values = await intersectionSelect.evaluate((el) =>
  [...el.options].map((o) => o.value),
);
const nowValue = await intersectionSelect.inputValue();
const other = values.find((v) => v !== nowValue);
ok(
  "前置：這一頁的「路口」下拉有兩個選項可以換（只有一個的話下一條恆真）",
  Boolean(other),
  options.join("／"),
);
if (other) await intersectionSelect.selectOption(other);
const switched = other;
await page.waitForTimeout(1400);
await openBoth();
const after = await titles();
ok(
  "⚠️ ② 換了路口之後標題真的跟著換（寫死第一個的話這條會紅）",
  Boolean(switched) && after.length === 2 && after[0] !== multi[0],
  `${multi[0]} → ${after[0]}`,
);

/* ══ ③ 只剩一個路口時：提醒不可以還在（常駐＝噪音）════════ */
console.log("\n══ ③ 主工具列只留一個路口 ══");
const narrowed = await page.evaluate(() => {
  /* 主工具列的「路口」多選：只勾目前這一個。 */
  const button = [...document.querySelectorAll(".multi-picker-btn")].find((b) =>
    (b.getAttribute("aria-label") || "").startsWith("路口"),
  );
  if (!button) return 0;
  if (button.getAttribute("aria-expanded") !== "true") button.click();
  return 1;
});
await page.waitForTimeout(500);
const picked = await page.evaluate(() => {
  const boxes = [
    ...document.querySelectorAll(
      '.multi-picker-panel .multi-picker-list input[type="checkbox"]',
    ),
  ];
  if (!boxes.length) return 0;
  boxes.forEach((box, index) => {
    if ((index === 0) !== box.checked) box.click();
  });
  return 1;
});
await page.evaluate(() => {
  const button = [...document.querySelectorAll(".multi-picker-btn")].find((b) =>
    (b.getAttribute("aria-label") || "").startsWith("路口"),
  );
  if (button && button.getAttribute("aria-expanded") === "true") button.click();
});
await page.waitForTimeout(1500);
await openBoth();
const oneNotes = await scopeNotes();
const oneTitles = await titles();
ok(
  "前置：確實縮到一個路口了（沒縮的話下一條恆真）",
  narrowed === 1 && picked === 1 && oneTitles.length === 2,
  `${oneTitles.length} 個標題`,
);
ok(
  "⚠️ ③ 只有一個路口時**不可以**再出現那句提醒（常駐就是噪音）",
  oneNotes.length === 0,
  oneNotes[0]?.slice(0, 50) || "沒有提醒，正確",
);
ok(
  "③ 但標題仍然要在（標題是常駐的，提醒才是條件式的）",
  oneTitles.every((t) => /115Q1/.test(t) && /路口/.test(t)),
  oneTitles.join(" ／ "),
);

ok("沒有任何 JavaScript 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 尖峰形狀兩張圖：標題寫出季別與路名、多選時提醒、單選時不吵");
