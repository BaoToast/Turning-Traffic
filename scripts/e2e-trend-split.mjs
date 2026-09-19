/*
 * ══════════════════════════════════════════════════════════════════
 *  歷季趨勢「整體」＝ 上下兩張圖（四個守門條目）
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者說「整體是指前面 4 個同時展現」。四條線不能疊在同一張圖上：
 * AM／PM／全調查時段尖峰的單位是 PCU/**hr**（流率），全調查時段是整段
 * 涵蓋的**累計量**（24 小時的檔案約為尖峰的二十幾倍）。疊在一條縱軸上，
 * 三條尖峰會被壓成貼著零的直線——那正是使用者已經否決的「副 Y 軸」。
 *
 * 四個守門條目（做的時候就寫好的，逐條對）：
 *   ① 選「整體」時畫面上要有**兩個** <svg>，各自有自己的縱軸與單位
 *   ② 上圖的縱軸單位是 PCU/hr，下圖是 PCU/調查時段（或 /調查日）
 *   ③ 反面：兩張圖**不可以**共用同一個 max
 *   ④ 匯出的 PNG／Excel 要與畫面一致（兩張圖就要兩張圖）
 *
 * ⚠️ 另加第 ⑤ 條，是這次改動**新引進**的風險：
 *   釘住（sticky）區裡本來只有一張 46vh 的圖，變成兩張就會超出視窗，
 *   標題與單位又會被切掉——那正是使用者上一輪回報過的問題。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { serve } = await import(pathToFileURL(join(HERE, "serve.mjs")).href);
const { launchOptions } = await import(
  pathToFileURL(join(HERE, "chrome-path.mjs")).href
);
const seed = readFileSync(join(HERE, "seed-wide.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(8161);
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/ERR_TUNNEL_CONNECTION_FAILED|fonts\.googleapis|Failed to load resource/.test(t))
    return;
  errors.push("console: " + t.slice(0, 200));
});
await page.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 無痕時就算了，前置檢查會紅。 */
  }
}, seed);
await page.goto("http://127.0.0.1:8161/", { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
await page.locator('aside.sidebar nav button:has-text("歷季趨勢比較")').first().click();
await page.waitForTimeout(1200);

/*
 * ⚠️ 統計範圍是 <Segmented> 按鈕列，**不是** <select>。
 *   我第一版寫成去找「有 ALL 選項的 select」——畫面上根本沒有那種 select，
 *   於是切換整個沒發生，四個守門條目全部在比同一張 AM 圖，
 *   有兩條還「通過」了（undefined !== "PCU/hr" 是 true）。
 *   假綠比沒有測試更糟，所以下面加了一條前置檢查確認切換真的生效。
 */

/** 目前畫面上每一張趨勢圖的資料。 */
const readCharts = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("svg.trend-svg")].map((svg) => ({
      id: svg.id,
      scopes: (svg.dataset.scopes || "").split(",").filter(Boolean),
      max: Number(svg.dataset.axisMax),
      unit: svg.dataset.unit || "",
      /* 縱軸名稱是畫面上真的看得到的字，與 data-unit 是兩個來源。 */
      axisTitle: (svg.querySelector(".y-axis-title")?.textContent || "").trim(),
      lines: svg.querySelectorAll("polyline").length,
      /* 刻度最上面那一格，用來反推縱軸真的用了哪個 max。 */
      topTick: (svg.querySelector(".grid-lines text")?.textContent || "").trim(),
    })),
  );

/* ── 前置：先確認單選一種範圍時只有一張圖（不然下面全是恆真） ── */
const MODE_LABELS = {
  AM: "AM Peak",
  ALL: "整體（四個範圍・上下兩張圖）",
};
const selectMode = async (value) => {
  const button = page
    .locator(`.segmented button:has-text("${MODE_LABELS[value]}")`)
    .first();
  if (!(await button.count()))
    throw new Error(`找不到統計範圍按鈕「${MODE_LABELS[value]}」`);
  await button.click();
  await page.waitForTimeout(1000);
  /* 前置：切換真的生效了嗎？沒生效的話下面每一條都在比同一張圖。 */
  const active = await page.evaluate(
    () =>
      [...document.querySelectorAll(".segmented button")]
        .filter((b) => b.getAttribute("aria-pressed") === "true" || b.classList.contains("is-active"))
        .map((b) => b.textContent.trim())
        .join("／") || "(讀不到)",
  );
  console.log(`   （切到「${MODE_LABELS[value]}」，目前選中：${active}）`);
};

await selectMode("AM");
const single = await readCharts();
ok("前置：單選一種統計範圍時只有一張圖", single.length === 1, `${single.length} 張`);
ok(
  "前置：單選時那張圖的 id 仍是 trend-svg（匯出與其他守門都靠它）",
  single[0]?.id === "trend-svg",
  single[0]?.id,
);

/* ── ① 兩個 svg ── */
await selectMode("ALL");
const charts = await readCharts();
ok("① 選「整體」時畫面上有兩張圖", charts.length === 2, `${charts.length} 張`);
ok(
  "① 兩張圖的 id 不同（相同的話匯出只會抓到上面那張）",
  charts.length === 2 && charts[0].id !== charts[1].id,
  charts.map((c) => c.id).join("／"),
);
ok(
  "① 上圖是三個尖峰、下圖是全調查時段",
  charts[0]?.scopes.join(",") === "AM,PM,DAY" && charts[1]?.scopes.join(",") === "FULL",
  charts.map((c) => c.scopes.join("+")).join("／"),
);

/* ── ② 單位各自不同，而且是對的那一種 ── */
ok(
  "② 上圖的單位是流率（/hr）",
  /\/hr$/.test(charts[0]?.unit || ""),
  charts[0]?.unit,
);
ok(
  "② 下圖的單位是累計量（/調查時段 或 /調查日），不可以是 /hr",
  /\/(調查時段|調查日)$/.test(charts[1]?.unit || ""),
  charts[1]?.unit,
);
ok(
  "② 兩張圖的單位真的不一樣",
  charts[0]?.unit !== charts[1]?.unit,
  `${charts[0]?.unit} vs ${charts[1]?.unit}`,
);
ok(
  "② 縱軸名稱上寫的單位與 data-unit 一致（畫面與內部狀態不可以分岔）",
  charts.every((c) => c.axisTitle.includes(c.unit)),
  charts.map((c) => `${c.axisTitle}｜${c.unit}`).join("／"),
);

/* ── ③ 反面：不可以共用同一個 max ── */
ok(
  "③ 兩張圖的縱軸最大值不同（共用就等於又回到同一條軸）",
  charts.length === 2 && charts[0].max !== charts[1].max,
  `上 ${charts[0]?.max}／下 ${charts[1]?.max}`,
);
/*
 * ⚠️ 只比「不相等」還不夠強：兩張圖的資料本來就可能剛好接近。
 *   真正要證明的是「下圖的量級遠大於上圖」——累計量對流率本來就該如此，
 *   如果兩者量級相同，代表下圖畫的根本不是全調查時段的累計量。
 */
ok(
  "③ 下圖（累計量）的軸頂明顯高於上圖（流率）",
  charts.length === 2 && charts[1].max > charts[0].max * 2,
  `上 ${charts[0]?.max}／下 ${charts[1]?.max}`,
);
ok(
  "③ 刻度文字也跟著各自的 max（不是只有 data 屬性對）",
  charts.length === 2 && charts[0].topTick !== charts[1].topTick,
  `上 ${charts[0]?.topTick}／下 ${charts[1]?.topTick}`,
);
ok(
  "③ 兩張圖都真的畫出線（空圖比對 max 沒有意義）",
  charts.every((c) => c.lines > 0),
  charts.map((c) => c.lines + " 段").join("／"),
);

/* ── ⑤ 釘住之後標題與單位還要看得到 ── */
const pinned = await page.evaluate(async () => {
  const panel = document.querySelector(".trend-chart");
  const script = document.getElementById("trendScript");
  script?.scrollIntoView({ block: "end" });
  await new Promise((r) => setTimeout(r, 500));
  const head = panel?.querySelector(".panel-head");
  const captions = [...(panel?.querySelectorAll(".trend-chart-caption") || [])];
  const rect = (node) => {
    const box = node?.getBoundingClientRect();
    return box ? { top: box.top, bottom: box.bottom } : null;
  };
  return {
    panelHeight: panel?.getBoundingClientRect().height ?? 0,
    viewport: window.innerHeight,
    head: rect(head),
    captions: captions.map(rect),
    captionCount: captions.length,
  };
});
ok(
  "⑤ 兩張圖時每張圖上方都有自己的小標與單位",
  pinned.captionCount === 2,
  `${pinned.captionCount} 個`,
);
ok(
  "⑤ 釘住區沒有比視窗高（比視窗高的話標題會被切掉）",
  pinned.panelHeight <= pinned.viewport,
  `面板 ${Math.round(pinned.panelHeight)}px／視窗 ${pinned.viewport}px`,
);
ok(
  "⑤ 捲到說明時，面板標題仍在畫面內",
  pinned.head !== null && pinned.head.top >= -1 && pinned.head.bottom <= pinned.viewport,
  pinned.head ? `top ${Math.round(pinned.head.top)}` : "讀不到",
);
ok(
  "⑤ 捲到說明時，兩張圖的單位標示都仍在畫面內",
  pinned.captions.every((box) => box && box.top >= -1 && box.bottom <= pinned.viewport),
  pinned.captions.map((b) => (b ? Math.round(b.top) : "?")).join("／"),
);

/* ── ④ 匯出要與畫面一致 ── */
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);

const pngDownload = page.waitForEvent("download", { timeout: 30000 });
await page.locator('button:has-text("下載趨勢 PNG")').first().click();
const png = await pngDownload;
const pngPath = await png.path();
const pngBytes = readFileSync(pngPath);
/* PNG 的寬高寫在 IHDR：8 bytes 簽章 + 4 長度 + 4 型別，之後是 4+4。 */
const pngWidth = pngBytes.readUInt32BE(16);
const pngHeight = pngBytes.readUInt32BE(20);
ok("④ 下載得到 PNG", pngBytes.length > 1000, `${pngBytes.length} bytes`);
ok(
  "④ PNG 是「兩張圖直向接起來」——高度必須大於寬度的一半以上、且明顯高於單圖",
  pngHeight > 390 * 2 * 2 * 0.9,
  `${pngWidth}×${pngHeight}`,
);

const xlsxDownload = page.waitForEvent("download", { timeout: 60000 });
await page.locator('button:has-text("下載趨勢 Excel")').first().click();
const xlsx = await xlsxDownload;
const xlsxPath = await xlsx.path();
const JSZip = (
  await import(
    pathToFileURL(
      join(HERE, "..", "node_modules", "jszip", "lib", "index.js"),
    ).href
  )
)
  .default;
const zip = await JSZip.loadAsync(readFileSync(xlsxPath));
const chartParts = Object.keys(zip.files).filter((name) =>
  /^xl\/charts\/chart\d+\.xml$/.test(name),
);
ok(
  "④ Excel 裡有兩張原生折線圖（畫面兩張，Excel 就要兩張）",
  chartParts.length === 2,
  chartParts.join("、"),
);
const contentTypes = await zip.file("[Content_Types].xml").async("string");
ok(
  "④ 每一張圖都登記了 Content_Type（漏掉 Excel 會跳修復、修復通常直接刪圖）",
  chartParts.every((name) => contentTypes.includes("/" + name)),
  chartParts.filter((n) => !contentTypes.includes("/" + n)).join("、") || "都有",
);
const drawing = await zip.file("xl/drawings/drawing1.xml").async("string");
ok(
  "④ 兩張圖各有自己的錨點（同一個位置會疊在一起）",
  (drawing.match(/<xdr:twoCellAnchor>/g) || []).length === 2,
  String((drawing.match(/<xdr:twoCellAnchor>/g) || []).length),
);
const chartXmls = await Promise.all(chartParts.map((n) => zip.file(n).async("string")));
const axIds = chartXmls.map((xml) =>
  (xml.match(/<c:axId val="(\d+)"\/>/g) || []).join(","),
);
ok(
  "④ 兩張圖的軸 id 不同（相同會讓 Excel 判定檔案損毀）",
  axIds[0] !== axIds[1],
  axIds.join(" ｜ "),
);
ok(
  "④ ⚠️ 縱軸名稱是真的被代入，不是字面的樣板文字",
  chartXmls.every((xml) => !xml.includes("esc(valueAxisTitle)")),
  "",
);
ok(
  "④ 兩張圖的縱軸名稱不同（單位不同，名稱就該不同）",
  chartXmls[0] !== chartXmls[1] &&
    chartXmls.some((xml) => xml.includes("/hr")) &&
    chartXmls.some((xml) => /調查時段|調查日/.test(xml)),
  "",
);

/*
 * 每一份 chartN.xml 都要結構完整，否則 Excel 開檔就會跳修復
 *（而修復的結果通常是直接把圖刪掉）。
 *
 * ⚠️ 這裡刻意**不引用 XML 解析套件**。第一版我 import 了 @xmldom/xmldom，
 *   被 tests/dependency-manifest.test.mjs 抓到——那個套件沒有列在
 *   package.json 裡，換一台電腦就裝不起來。為了一個附帶檢查而新增依賴
 *   不划算，改成自己數標籤：對這個用途已經夠，而且不會假綠
 *  （下面有前置檢查證明它抓得到壞掉的 XML）。
 */
const tagBalance = (xml) => {
  const opens = (xml.match(/<c:chartSpace\b/g) || []).length;
  const closes = (xml.match(/<\/c:chartSpace>/g) || []).length;
  return (
    xml.startsWith("<?xml") &&
    opens === 1 &&
    closes === 1 &&
    xml.trimEnd().endsWith("</c:chartSpace>") &&
    (xml.match(/<c:ser>/g) || []).length ===
      (xml.match(/<\/c:ser>/g) || []).length
  );
};
ok(
  "④ 前置：這條結構檢查真的抓得到壞掉的 XML（不然它是恆真的）",
  !tagBalance("<?xml?><c:chartSpace><c:ser></c:chartSpace>"),
  "",
);
ok(
  "④ 兩份 chart XML 的結構都完整",
  chartXmls.every(tagBalance),
  "",
);

console.log("\n══ 主控台錯誤 ══");
ok("整段流程沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" ｜ "));

console.log(
  problems.length
    ? `\n❌ 未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}`
    : "\n✅ 全部通過",
);
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
