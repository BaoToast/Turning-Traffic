/*
 * ══════════════════════════════════════════════════════════════════════
 *  每一張圖都要能下載高解析 PNG（路口轉向）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：「每張圖都應該要有能直接提供高清晰圖片下載的功能……
 * 我希望三個程式都同樣方式作處理。」
 *
 * 這一支程式原本只有兩張圖有下載鈕（路口轉向圖、歷季趨勢圖）；
 * 路口幾何示意圖、交通量圖卡排版、尖峰小時內四格 15 分鐘分布、
 * 連續 60 分鐘流率這四張都沒有。
 *
 * 釘五件事：
 *   ① 六張圖旁邊都有下載鈕
 *   ② 按下去真的下載得到，而且真的是 PNG
 *   ③ ⚠️ 白底。透明底貼到深色投影片上字會整片看不見——而畫面上完全
 *      看不出來（畫面本來就是白底卡片），只有交出去的那一張壞掉。
 *      舊版 svgToPng 沒有填白底，趨勢圖與尖峰分布圖都會是透明的。
 *   ④ ⚠️ 解析度是 3 倍（和全日交通量同一個數字）。
 *   ⑤ 「一鍵下載全部圖檔」按下去拿到 ZIP，而且卡片上有寫清楚
 *      哪幾張圖不在這裡（少了東西而使用者不知道，比整個壞掉更危險）
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
const seed = readFileSync(join(HERE, "seed-15min.json"), "utf8");

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

function pngSize(buffer) {
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const server = await serve(8155);
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
await page.goto("http://localhost:8155/");
await page.waitForTimeout(900);
await page.evaluate(async (s) => {
  localStorage.clear();
  await window.__writeState(s);
}, seed);
await page.reload();
await page.waitForTimeout(1800);

const go = async (label) => {
  await page.locator(`nav > div > button:has-text("${label}")`).first().click();
  await page.waitForTimeout(900);
};

/** 這一頁上有哪幾顆下載鈕。 */
const buttonsOn = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-chart-png]")]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => el.getAttribute("data-chart-png")),
  );

/**
 * 按下一顆，把下載到的 PNG 驗過（PNG 檔頭、白底、3 倍）。
 * 白底是讀四個角落的像素——只看色彩型態不夠，RGBA 也可以整片不透明。
 */
async function checkButton(id, expectScaleOf) {
  downloads.length = 0;
  await page.locator(`[data-chart-png="${id}"]`).first().click();
  await page.waitForTimeout(3000);
  ok(`② ${id}：按下去真的下載得到檔案`, downloads.length === 1, `${downloads.length} 個`);
  if (downloads.length !== 1) return;
  const bytes = readFileSync(await downloads[0].path());
  const size = pngSize(bytes);
  ok(
    `② ${id}：下載的是真的 PNG（不是空檔或壞檔）`,
    Boolean(size) && bytes.length > 3000,
    `${bytes.length} bytes、${size ? `${size.width}×${size.height}` : "不是 PNG"}`,
  );
  if (!size) return;
  const corners = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const at = (x, y) => [...context.getImageData(x, y, 1, 1).data];
    return [
      at(2, 2),
      at(image.width - 3, 2),
      at(2, image.height - 3),
      at(image.width - 3, image.height - 3),
    ];
  }, "data:image/png;base64," + bytes.toString("base64"));
  ok(
    `③ ${id}：四個角落都是不透明的白（透明底貼進深色投影片會看不到字）`,
    corners.every(([r, g, b, a]) => a === 255 && r > 245 && g > 245 && b > 245),
    corners.map((c) => c.join(",")).join(" ｜ "),
  );
  if (expectScaleOf)
    ok(
      `④ ${id}：解析度是版面的 3 倍（不是把畫面放大）`,
      size.width === expectScaleOf * 3,
      `寬 ${size.width}px（版面 ${expectScaleOf}px → 期望 ${expectScaleOf * 3}px）`,
    );
}

const found = new Set();

/* ── 路口轉向圖 ── */
console.log("\n══ 路口轉向圖 ══");
await go("路口轉向圖");
(await buttonsOn()).forEach((id) => found.add(id));
await checkButton("diagram", 0);

/* ── 道路與流向管理：幾何示意圖 ＋ 圖卡排版 ── */
console.log("\n══ 道路與流向管理 ══");
await go("道路與流向管理");
(await buttonsOn()).forEach((id) => found.add(id));
await checkButton("geometry", 0);
/* 圖卡排版預覽是可以收合的，先確定它展開了。 */
if (!(await page.locator('[data-chart-png="geometry-card"]').count())) {
  await page
    .locator('button:has-text("圖卡排版")')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(800);
  (await buttonsOn()).forEach((id) => found.add(id));
}
if (await page.locator('[data-chart-png="geometry-card"]').count())
  await checkButton("geometry-card", 0);
else ok("① 交通量圖卡排版有下載鈕", false, "找不到 geometry-card");

/* ── 歷季趨勢比較 ── */
console.log("\n══ 歷季趨勢比較 ══");
await go("歷季趨勢比較");
(await buttonsOn()).forEach((id) => found.add(id));
await checkButton("trend", 0);

/* ── 轉向進階分析：兩張尖峰形狀圖（預設收合） ── */
console.log("\n══ 轉向進階分析 ══");
await go("轉向進階分析");
const summaries = await page
  .locator(".peak-shape > summary")
  .count()
  .catch(() => 0);
ok("前置：找得到兩張尖峰形狀圖的收合區", summaries === 2, `${summaries} 個`);
for (let i = 0; i < summaries; i += 1) {
  await page.locator(".peak-shape > summary").nth(i).click();
  await page.waitForTimeout(600);
}
(await buttonsOn()).forEach((id) => found.add(id));
for (const id of ["peak-quarter", "peak-window"]) {
  if (await page.locator(`[data-chart-png="${id}"]`).count())
    await checkButton(id, 1000);
  else ok(`① ${id} 有下載鈕`, false, "展開之後仍然找不到");
}

/* ── ① 六張圖都有 ── */
console.log("\n══ ① 清點 ══");
const EXPECTED = [
  "diagram",
  "geometry",
  "geometry-card",
  "trend",
  "peak-quarter",
  "peak-window",
];
for (const id of EXPECTED)
  ok(`① ${id} 這張圖旁邊有下載鈕`, found.has(id), failOnly("整支程式都找不到"));

/* ── ⑤ 一鍵下載全部圖檔 ── */
console.log("\n══ ⑤ 一鍵下載全部圖檔 ══");
await go("批次輸出");
ok(
  "⑤ 有「一鍵下載全部圖檔」這一張卡",
  (await page.locator("#report-chart-png").count()) > 0,
  failOnly("找不到 #report-chart-png"),
);
/*
 * ⚠️ 卡片上一定要寫清楚哪幾張圖**不在**這裡。
 *   少了幾張而使用者不知道，比整個功能壞掉更危險——
 *   收到 ZIP 的人不會發現少了東西。
 */
const elsewhere = await page
  .locator(".chart-png-elsewhere")
  .first()
  .textContent()
  .catch(() => "");
ok(
  "⑤ 卡片上寫明歷季趨勢與尖峰形狀那幾張要去它們自己的頁面下載",
  (elsewhere || "").includes("歷季趨勢") && (elsewhere || "").includes("尖峰"),
  elsewhere ? elsewhere.replace(/\s+/g, " ").slice(0, 70) : "沒有這段說明",
);
downloads.length = 0;
await page.locator("#downloadAllChartPng").click();
await page.waitForTimeout(6000);
ok("⑤ 按下去拿得到一個 ZIP（不是一次觸發好幾個下載）", downloads.length === 1, `${downloads.length} 個`);
if (downloads.length === 1) {
  const bytes = readFileSync(await downloads[0].path());
  ok(
    "⑤ ZIP 不是空的",
    bytes.length > 5000 && bytes.subarray(0, 2).toString() === "PK",
    `${bytes.length} bytes`,
  );
}

ok("整段沒有 JS 例外", errors.length === 0, failOnly(errors.slice(0, 3).join(" | ")));

await browser.close();
await server.close?.();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 每一張圖都下載得到高解析 PNG");
