/*
 * 端對端：趨勢圖的版面，以及匯出成圖片之後有沒有壞掉
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者的原話：「圖片最容易出現X軸沒文字或是文字被縮減、重疊等等狀況發生，
 * 請幫我確認圖表的圖或轉變成圖片後，格式都能正確，不要有縮減或重疊情況發生，
 * 美觀易讀懂是最重要的，有單位的軸，就要附上名稱和單位」。
 *
 * ── 這一支要擋的是什麼 ────────────────────────────────────────
 *
 * 一、**匯出的 PNG 與畫面不一樣。** svgToPng 把 SVG 序列化成 blob URL 再交給
 *     <img> 畫進 canvas，而那份 blob 是**獨立文件，讀不到 globals.css**。
 *     這個系統的折線是用屬性（stroke／fill）畫的，所以線不會消失；
 *     但**文字全靠樣式表**——font-size 從 9～10px 變成瀏覽器預設的 16px，
 *     而且 `text-anchor` 從 middle／end 退回 start，**每一段字整個往右移
 *     半個字寬**，縱軸刻度從右對齊變成左對齊直接壓進繪圖區。
 *     兩件事加起來就是使用者最擔心的結果：字互相重疊、被切掉。
 *     畫面上完全正常，只有下載下來那一張壞掉——而那一張才是要貼進簡報的。
 *
 * 二、季度累積之後 X 軸標籤擠在一起（舊版每一季都印）。
 * 三、縱軸名稱寫死「尖峰小時交通量（PCU/hr）」，換成車種或佔比之後就是錯的。
 * 四、橫軸沒有名稱。
 *
 * ── ⚠️ 假通過陷阱（這一支刻意迴避的）────────────────────────
 *
 * 一、**只量畫面上的 SVG 不算數。** 畫面讀得到 globals.css，匯出那條路徑
 *     讀不到。只量畫面的話，第一項那個最嚴重的問題一項都驗不到。
 *     所以這裡把 SVG **抽出樣式之後**再量一次，模擬匯出時的處境。
 * 二、只量 getBBox 不換算 transform，旋轉過的縱軸名稱每次都會誤報出界；
 *     誤報久了就會被當雜訊忽略，真的出界時也看不到。
 * 三、只驗目前測資的季度數不算數——現在幾季不會擠，二十幾季會。
 *     所以要先塞進一份季度很多的種子。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";
import JSZip from "jszip";

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

/*
 * 種子：同一個路口一路長到 120 季。
 * 拿現成的 seed-state.json 複製那一筆紀錄，只換季度與 id——
 * 這樣紀錄的形狀一定與正式資料相同，不會因為手捏測資少一個欄位而
 * 讓某段程式提早丟例外，看起來像功能壞了。
 */
const base = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
const sample = base.records.find((r) => r.station === "S01-03") || base.records[0];
const quarters = [];
/*
 * ⚠️ 120 季（30 年）。44 季時畫布仍未碰到安全上限，驗不出上限生效後
 * 數值標籤是否重疊。120 季會確實碰到 4,800px 上限，必須保留完整折線與
 * 資料點、只抽樣文字標籤。
 */
for (let year = 86; year <= 115; year += 1)
  for (let q = 1; q <= 4; q += 1) quarters.push(`${year}Q${q}`);
const seed = {
  ...base,
  records: quarters.map((quarter, index) => ({
    ...JSON.parse(JSON.stringify(sample)),
    id: `LAY-${index}`,
    quarter,
    surveyType: "平日",
  })),
};

await new Promise((r) => server.listen(8261, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1100 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());

await installStateHelpers(page);
await page.goto("http://localhost:8261/");
await page.waitForTimeout(700);
await page.evaluate(async (json) => {
  localStorage.clear();
  await window.__writeState(json);
}, JSON.stringify(seed));
await page.reload();
await page.waitForTimeout(1400);

await page.locator('nav button:has-text("歷季趨勢比較")').first().click();
await page.waitForTimeout(1200);

ok("前置：測資要真的有 100 季以上（要碰到圖寬安全上限）", quarters.length >= 100, `${quarters.length} 季`);

/**
 * 量一張 SVG 裡每一段文字的外框。
 * stripStyle 為 true 時**先把內嵌的 <style> 拿掉再量**，模擬匯出時
 * 讀不到樣式表的處境——這是這支腳本存在的理由。
 */
async function measure(stripStyle) {
  return page.evaluate((strip) => {
    const original = document.getElementById("trend-svg");
    if (!original) return { error: "找不到趨勢圖" };
    let svg = original;
    let host = null;
    if (strip) {
      host = document.createElement("div");
      host.style.cssText =
        "position:fixed;left:0;top:0;z-index:9999;opacity:0;all:initial";
      host.innerHTML = original.outerHTML;
      const copy = host.querySelector("svg");
      copy.querySelectorAll("style").forEach((node) => node.remove());
      document.body.appendChild(host);
      svg = copy;
    }
    const box = svg.viewBox.baseVal;
    const root = svg.getScreenCTM();
    const texts = [...svg.querySelectorAll("text")].map((node) => {
      const b = node.getBBox();
      const m = node.getScreenCTM();
      const corners = [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x, b.y + b.height],
        [b.x + b.width, b.y + b.height],
      ].map(([x, y]) => {
        const point = svg.createSVGPoint();
        point.x = x;
        point.y = y;
        return point.matrixTransform(m).matrixTransform(root.inverse());
      });
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      return {
        text: node.textContent,
        cls: node.getAttribute("class") || "",
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      };
    });
    /*
     * ── 同一段文字裡的字有沒有疊在一起 ──
     *
     * ⚠️ 這一項是踩到才補的。原本只比對**不同** <text> 之間有沒有重疊，
     * 所以「同一段文字內部糊成一團」完全驗不到——getBBox 回的是整段的
     * 外框，一個框當然不會跟自己重疊。
     *
     * 實際踩到的：縱軸名稱用 writing-mode: vertical-rl（真正的直排），
     * 而直排要靠字型裡的**直排前進量**才知道下一個字往下多少。字型沒有
     * 那組度量時（無頭瀏覽器、部分 Linux／Android、匯出 PNG 時載入的替代
     * 字型），中文字的前進量會變成 0.4px——實測「路口總量（」五個字全部
     * 疊在 1.6px 裡糊成一團，只有 PCU/hr 排得開。畫面上看起來像一個汙點，
     * 而這張圖是要貼進簡報的。
     *
     * 驗法：逐字取 getExtentOfChar，相鄰兩個字必須在某一個方向上真的前進。
     * 門檻取字級的四分之一——比這個還小就一定是疊在一起。
     */
    const smudged = [];
    for (const node of svg.querySelectorAll("text")) {
      const content = node.textContent || "";
      if (content.trim().length < 2) continue;
      const size = parseFloat(getComputedStyle(node).fontSize || "10") || 10;
      const spots = [];
      for (let i = 0; i < content.length; i += 1) {
        if (!content[i].trim()) continue;
        try {
          const spot = node.getExtentOfChar(i);
          spots.push({ c: content[i], x: spot.x, y: spot.y });
        } catch {
          /* 量不到就跳過，不要因為量不到而誤報。 */
        }
      }
      for (let i = 1; i < spots.length; i += 1) {
        const move = Math.max(
          Math.abs(spots[i].x - spots[i - 1].x),
          Math.abs(spots[i].y - spots[i - 1].y),
        );
        if (move < size / 4) {
          smudged.push(
            `「${content}」的「${spots[i - 1].c}${spots[i].c}」只前進 ${move.toFixed(1)}px`,
          );
          break;
        }
      }
    }

    const overlaps = [];
    for (let i = 0; i < texts.length; i += 1)
      for (let j = i + 1; j < texts.length; j += 1) {
        const a = texts[i];
        const b = texts[j];
        if (
          a.x < b.x + b.w &&
          b.x < a.x + a.w &&
          a.y < b.y + b.h &&
          b.y < a.y + a.h
        )
          overlaps.push(`「${a.text}」與「${b.text}」`);
      }
    const outside = texts
      .filter(
        (t) =>
          t.x < -0.5 ||
          t.y < -0.5 ||
          t.x + t.w > box.width + 0.5 ||
          t.y + t.h > box.height + 0.5,
      )
      .map((t) => `「${t.text}」`);
    if (host) host.remove();
    return {
      view: [box.width, box.height],
      count: texts.length,
      smudged,
      overlaps,
      outside,
      blanks: texts.filter((t) => !String(t.text).trim()).length,
      xLabels: texts.filter((t) => t.cls === "x-label").map((t) => t.text),
      pointValues: texts.filter((t) => t.cls === "point-value").map((t) => t.text),
      /* 每個資料點都要帶 data-value（守門的參照物，與標籤顯示與否無關） */
      dataValues: [...svg.querySelectorAll("circle[data-value]")].length,
      yTitle: texts.filter((t) => t.cls === "y-axis-title").map((t) => t.text)[0] || "",
      axisTitles: texts.filter((t) => t.cls === "axis-title").map((t) => t.text),
      hasStyle: Boolean(svg.querySelector("style")),
    };
  }, stripStyle);
}

/* ── 一、畫面上的版面 ── */
const screen = await measure(false);
ok("前置：趨勢圖要畫得出來", !screen.error && screen.count > 0, screen.error || `${screen.count} 段文字`);
ok("畫面：文字不可以互相重疊", (screen.overlaps || []).length === 0, (screen.overlaps || []).slice(0, 3).join("、"));
ok("畫面：文字不可以超出畫布", (screen.outside || []).length === 0, (screen.outside || []).slice(0, 3).join("、"));
ok("畫面：不可以有空白標籤", screen.blanks === 0, `${screen.blanks} 個`);
ok(
  "畫面：同一段文字裡的字不可以疊在一起（縱軸名稱最容易發生）",
  (screen.smudged || []).length === 0,
  (screen.smudged || []).slice(0, 2).join("、"),
);
ok("畫面：X 軸一定要有標籤", (screen.xLabels || []).length >= 2, `${(screen.xLabels || []).length} 個`);
/*
 * X 軸標籤要不要間隔印，取決於畫得下幾個。120 季時會碰到 4,800px
 * 安全上限，X 軸與點數值都必須抽樣，否則匯出圖片會過大且文字相疊。
 */
ok(
  "大量季度時畫布寬度不得超過 4,800px",
  screen.view?.[0] <= 4800,
  `${screen.view?.[0]}px`,
);
/*
 * ⚠️ v2.1.64 起，資料點多的時候**數值標籤一個都不顯示**（改成滑鼠移上去才出現）。
 * 使用者的原話：「資料一多，其實還是改成滑鼠移上去才顯示數值就很夠用，
 * 這樣能一次解決標籤重疊的問題。」
 * 所以這裡不能再要求「標籤數 ≥ 2」——0 個才是這個情境下的正確行為。
 *
 * 改成守兩件事：
 *   ① X 軸標籤要抽樣（不可以 120 季印 120 個）
 *   ② 標籤數不可以等於季數（等於就是完全沒抽樣，會疊成一片）
 * 另外加一項：**每一個資料點都要有 data-value**——
 * 那是守門反推驗證的參照物，也是使用者滑鼠移上去能看到數值的前提；
 * 標籤可以不顯示，data-value 不能不在。
 */
ok(
  "大量季度時 X 軸標籤要抽樣，不可全部擠在一起",
  (screen.xLabels || []).length < quarters.length &&
    (screen.xLabels || []).length >= 2,
  `X 軸 ${(screen.xLabels || []).length} 個／共 ${quarters.length} 季`,
);
ok(
  "大量季度時數值標籤不可以每一季都印（會疊成一片）",
  (screen.pointValues || []).length < quarters.length,
  `數值標籤 ${(screen.pointValues || []).length} 個／共 ${quarters.length} 季`,
);
ok(
  "每一個資料點都要帶 data-value（標籤可以不顯示，真值不能不在）",
  (screen.dataValues || 0) >= 2,
  `${screen.dataValues} 個帶 data-value 的資料點`,
);
ok(
  "畫面：最後一季一定要印出來（業主最在意「現在到哪了」）",
  (screen.xLabels || []).includes("115Q4"),
  (screen.xLabels || []).slice(-3).join("、"),
);

/* ── 二、軸名稱與單位 ── */
ok(
  "縱軸名稱要帶單位",
  /（PCU\/hr）|（PCU）|（輛）|（%）/.test(screen.yTitle),
  screen.yTitle || "沒有縱軸名稱",
);
ok(
  "縱軸名稱要跟著指標走，不可以寫死",
  screen.yTitle.startsWith("路口總量"),
  screen.yTitle,
);
ok("橫軸要有名稱「季度」", (screen.axisTitles || []).includes("季度"), (screen.axisTitles || []).join("、"));

/* 換一個單位不同的指標，縱軸名稱與單位都要跟著變 */
await page.selectOption("#trendMetric", "vehicles");
await page.waitForTimeout(700);
const vehicleView = await measure(false);
ok(
  "換成「實際車輛數」之後，縱軸名稱與單位都要跟著變",
  vehicleView.yTitle.includes("實際車輛數") && vehicleView.yTitle.includes("輛"),
  vehicleView.yTitle,
);
const vehiclePanel = await page.evaluate(() => ({
  unit: document.querySelector(".trend-chart .status-dot")?.textContent?.trim() || "",
  /*
   * 第一個資料點的真值。讀 data-value 而不是標籤——
   * 標籤在資料點多的時候不再顯示（v2.1.64 起），讀標籤會拿到空字串，
   * 底下那項「摘要要與圖上的點一致」就變成拿空字串去比對。
   */
  firstPoint:
    document.querySelector("#trend-svg circle[data-value]")?.getAttribute("data-value") || "",
  firstSummary:
    document.querySelector(".trend-summary > div b")?.textContent?.trim() || "",
}));
ok(
  "換成實際車輛數後，圖卡單位與右側摘要都必須是輛/hr",
  vehiclePanel.unit === "輛/hr" &&
    vehiclePanel.firstSummary.includes("輛/hr") &&
    !vehiclePanel.firstSummary.includes("PCU/hr"),
  JSON.stringify(vehiclePanel),
);
{
  /*
   * 摘要是給人看的格式（有千分位、有單位），data-value 是原始數字，
   * 所以要**取出數字再比**，不可以用 startsWith——
   * 「5,456 輛/hr」不會以「5456」開頭。
   * 容差取 1，吸收顯示端的四捨五入。
   */
  const summaryNumber = Number(
    String(vehiclePanel.firstSummary).replace(/[^0-9.]/g, ""),
  );
  const pointNumber = Number(vehiclePanel.firstPoint);
  ok(
    "右側摘要的數值要與圖上同一個實際車輛數資料點一致",
    Number.isFinite(summaryNumber) &&
      Number.isFinite(pointNumber) &&
      pointNumber > 0 &&
      Math.abs(summaryNumber - pointNumber) <= 1,
    JSON.stringify({ ...vehiclePanel, summaryNumber, pointNumber }),
  );
}

/* 可編輯 Excel 內的原生圖表也必須跟著指標換標題與單位。 */
const excelDownloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "下載趨勢 Excel" }).click();
const excelDownload = await excelDownloadPromise;
const excelPath = await excelDownload.path();
let excelChartXml = "";
if (excelPath) {
  const excelZip = await JSZip.loadAsync(readFileSync(excelPath));
  excelChartXml = await excelZip.file("xl/charts/chart1.xml")?.async("string");
}
ok(
  "可編輯 Excel 的圖表標題與 Y 軸要跟著實際車輛數改成輛/hr",
  Boolean(excelChartXml) &&
    excelChartXml.includes("歷季實際車輛數趨勢（單位：輛/hr）") &&
    excelChartXml.includes("實際車輛數（輛/hr）") &&
    !excelChartXml.includes("尖峰小時交通量（PCU/hr）"),
  excelChartXml ? "圖表 XML 已核對" : "讀不到 xl/charts/chart1.xml",
);
ok(
  "可編輯 Excel 的缺值必須維持斷線顯示",
  excelChartXml.includes('<c:dispBlanksAs val="gap"/>'),
);
await page.selectOption("#trendMetric", "vehicleShare");
await page.waitForTimeout(700);
const shareView = await measure(false);
ok(
  "換成「單一車種佔比」之後，縱軸單位要是 %",
  shareView.yTitle.includes("%"),
  shareView.yTitle,
);
const sharePanel = await page.evaluate(() => ({
  unit: document.querySelector(".trend-chart .status-dot")?.textContent?.trim() || "",
  summary: document.querySelector(".trend-summary")?.textContent?.trim() || "",
}));
ok(
  "換成車種佔比後，圖卡單位與右側摘要都必須是百分比",
  sharePanel.unit === "%" &&
    sharePanel.summary.includes("%") &&
    !sharePanel.summary.includes("PCU/hr"),
  JSON.stringify(sharePanel),
);
const shareExcelDownloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "下載趨勢 Excel" }).click();
const shareExcelDownload = await shareExcelDownloadPromise;
const shareExcelPath = await shareExcelDownload.path();
let shareExcelChartXml = "";
if (shareExcelPath) {
  const shareExcelZip = await JSZip.loadAsync(readFileSync(shareExcelPath));
  shareExcelChartXml = await shareExcelZip.file("xl/charts/chart1.xml")?.async("string");
}
ok(
  "可編輯 Excel 的圖表標題、Y 軸與數字格式要跟著車種佔比改成百分比",
  Boolean(shareExcelChartXml) &&
    shareExcelChartXml.includes("歷季機車佔比趨勢（單位：%）") &&
    shareExcelChartXml.includes("機車佔比（%）") &&
    shareExcelChartXml.includes('formatCode="0.0\\%"'),
  shareExcelChartXml ? "圖表 XML 已核對" : "讀不到 xl/charts/chart1.xml",
);
ok("換指標之後版面仍然不重疊", (shareView.overlaps || []).length === 0, (shareView.overlaps || []).slice(0, 3).join("、"));
await page.selectOption("#trendMetric", "total");
await page.waitForTimeout(700);

/* ── 三、匯出成圖片時（讀不到樣式表）── */
/*
 * ⚠️ 這一段才是重點。上面全部是在畫面上量的，畫面讀得到 globals.css；
 * 匯出那條路徑讀不到。樣式沒有內嵌進 SVG 時，上面每一項都會照樣綠燈，
 * 而下載下來的圖字會放大到 16px、對齊方式退回 start，整片重疊。
 */
const exported = await measure(true);
ok(
  "前置：SVG 一定要內嵌樣式（否則匯出的圖與畫面不一樣）",
  screen.hasStyle,
  screen.hasStyle ? "" : "SVG 裡沒有 <style>",
);
ok(
  "匯出（讀不到外部樣式表）時：同一段文字裡的字不可以疊在一起",
  (exported.smudged || []).length === 0,
  (exported.smudged || []).slice(0, 2).join("、"),
);
ok(
  "匯出（讀不到外部樣式表）時：文字不可以互相重疊",
  (exported.overlaps || []).length === 0,
  (exported.overlaps || []).slice(0, 3).join("、"),
);
ok(
  "匯出（讀不到外部樣式表）時：文字不可以超出畫布",
  (exported.outside || []).length === 0,
  (exported.outside || []).slice(0, 3).join("、"),
);
ok(
  "匯出（讀不到外部樣式表）時：版面要與畫面一致",
  exported.count === screen.count && (exported.xLabels || []).length === (screen.xLabels || []).length,
  `畫面 ${screen.count} 段／${(screen.xLabels || []).length} 個 X 標籤，匯出 ${exported.count} 段／${(exported.xLabels || []).length} 個`,
);

/* ── 四、匯出的圖片只能有圖 ── */
/*
 * 使用者的原話：「下載下來的圖本來就該只有圖，不能有文字，否則貼到簡報上時，
 * 看到那些應該由簡報者說明的文字展示在上方這樣才奇怪。」
 * svgToPng 只畫 SVG 本身，不加任何文字帶——這一項把它釘住。
 */
/*
 * svgToPng 是模組內的函式，打包之後不會掛在 window 上，所以從頁面讀不到。
 * 改成直接讀原始碼——這是原始碼層級的檢查，比讀不到而變成恆真的綠字誠實。
 */
const appSource = readFileSync(join(here, "..", "app", "traffic-app.tsx"), "utf8");
const svgToPngSource =
  appSource.slice(
    appSource.indexOf("async function svgToPng"),
    appSource.indexOf("async function svgToPng") + 900,
  ) || "";
const pngShape = {
  length: svgToPngSource.length,
  noFillText: !/fillText\s*\(/.test(svgToPngSource),
  heightIsImageOnly: /canvas\.height\s*=\s*image\.height\s*\*\s*scale/.test(
    svgToPngSource,
  ),
};
ok(
  "前置：要真的讀得到 svgToPng 的程式碼",
  pngShape.length > 200,
  `讀到 ${pngShape.length} 個字元`,
);
ok("匯出的圖片不可以印上說明文字", pngShape.noFillText);
ok(
  "匯出的畫布高度只能是圖的高度（沒有多出文字帶）",
  pngShape.heightIsImageOnly,
);

/* ── 五、整季沒調查時，X 軸要留空格，折線要斷開 ── */
/*
 * ⚠️ 這一段守的是「兩個點緊鄰＝相隔一季」的讀法。
 *
 * 只做了 113Q1 與 114Q1 的路口，如果 X 軸只排「有資料的那兩季」，
 * 兩個點會緊鄰成兩格，看圖的人（業主）會讀成「上一季到這一季」的變化——
 * 實際上中間隔了整整一年。這張圖會被下載成 PNG 貼進簡報，讀錯就跟著出去。
 *
 * 假通過陷阱：只驗「有畫出折線」擋不住舊版——舊版也畫得出來，
 * 只是畫錯。所以要驗三件**舊版一定做不到**的事：
 *   ① X 軸上要出現中間那幾季的標籤（113Q3 是補出來的，資料裡沒有）。
 *   ② 兩個有值的點之間的水平距離，要是「一格」的四倍左右，不是一格。
 *   ③ 折線要斷成兩段，不可以一條直接連過去。
 */
const gapSeed = {
  ...base,
  records: ["113Q1", "114Q1"].map((quarter, index) => ({
    ...JSON.parse(JSON.stringify(sample)),
    id: `GAP-${index}`,
    quarter,
    surveyType: "平日",
  })),
};
await page.evaluate(async (json) => {
  localStorage.clear();
  await window.__writeState(json);
}, JSON.stringify(gapSeed));
await page.reload();
await page.waitForTimeout(1400);
await page.locator('nav button:has-text("歷季趨勢比較")').first().click();
await page.waitForTimeout(1200);

const gapView = await page.evaluate(() => {
  const svg = document.getElementById("trend-svg");
  if (!svg) return { error: "找不到趨勢圖" };
  const labels = Array.from(svg.querySelectorAll("text.x-label")).map((node) =>
    node.textContent.trim(),
  );
  const circles = Array.from(svg.querySelectorAll("circle"))
    .filter((node) => Number(node.getAttribute("r")) === 7)
    .map((node) => Number(node.getAttribute("cx")))
    .sort((a, b) => a - b);
  const polylines = Array.from(svg.querySelectorAll("polyline")).map(
    (node) => (node.getAttribute("points") || "").trim().split(/\s+/).length,
  );
  return { labels, circles, polylines };
});

ok("前置：缺季測資要真的畫得出趨勢圖", !gapView.error, gapView.error || "");
ok(
  "缺的整季要出現在 X 軸上（113Q3 是補出來的，資料裡沒有這一季）",
  (gapView.labels || []).includes("113Q3"),
  `X 軸標籤：${(gapView.labels || []).join("、")}`,
);
ok(
  "X 軸要排滿整段期間的五季，不是只排有資料的兩季",
  (gapView.labels || []).length === 5,
  `${(gapView.labels || []).length} 個標籤`,
);
{
  /*
   * 兩個點之間應該隔四格。畫布可用寬度是 chartWidth-170，分成
   * (季數-1)=4 段，所以兩點的距離應該等於整段可用寬度。
   * 舊版只有兩季時，兩點之間也是「整段寬度」——所以這一項單獨看會恆真，
   * 必須配合上面的標籤數一起看：標籤五個、點兩個、點之間跨四格，
   * 三件事同時成立才代表 X 軸真的是按時間排的。
   */
  const circles = gapView.circles || [];
  const span = circles.length === 2 ? circles[1] - circles[0] : 0;
  ok(
    "兩個有值的季要相隔四格（113Q1 → 114Q1 是一整年）",
    circles.length === 2 && span > 300,
    `兩點相距 ${Math.round(span)}px`,
  );
}
ok(
  "缺季處折線要斷開，不可以一條直接連過去",
  (gapView.polylines || []).every((count) => count < 2),
  `折線段的點數：${(gapView.polylines || []).join("、") || "（沒有折線）"}`,
);

/* ── 六、點畫的位置要與縱軸說的一致 ── */
/*
 * 使用者的問題：「點位落下的位置和 Y 軸不符呢？」
 *
 * 這是圖表最惡質的一種錯——圖畫得出來、線也很漂亮，但照著縱軸讀一個點
 * 會讀到錯的值，而且不會有任何錯誤訊息。舊版點的縱向對應用 235px、
 * 格線用 240px（y=70、130、190、250、310），整片資料點被往下壓 5px；
 * 誤差隨值線性放大，讀一個高點會少讀約 2%。
 *
 * 驗法：從 SVG 直接量。取兩條格線（最上與最下）建立「像素 ↔ 值」的
 * 對應，再把每一個點的 cy 反推回值，與該點旁邊標著的數字比對。
 * 標籤與點是同一份計算出來的（v2.1.58 收斂過），所以標籤＝真值。
 *
 * ⚠️ 假通過陷阱：只驗「最下面那條格線＝0，點在 0 也畫在那裡」會恆真——
 * 兩種算法在 0 的地方本來就重合，誤差是從 0 往上長的。所以要驗**最高**
 * 的那個點，並且容差要小於一格格線的高度。
 */
await page.evaluate(async (json) => {
  localStorage.clear();
  await window.__writeState(json);
}, JSON.stringify(seed));
await page.reload();
await page.waitForTimeout(1400);
await page.locator('nav button:has-text("歷季趨勢比較")').first().click();
await page.waitForTimeout(1200);

const axisCheck = await page.evaluate(() => {
  const svg = document.getElementById("trend-svg");
  if (!svg) return { error: "找不到趨勢圖" };
  const lines = [...svg.querySelectorAll("g.grid-lines line")].map((n) =>
    Number(n.getAttribute("y1")),
  );
  const tickValues = [...svg.querySelectorAll("g.grid-lines text")].map((n) =>
    Number(String(n.textContent).replace(/,/g, "")),
  );
  if (lines.length < 2) return { error: "格線不足兩條" };
  /* 兩條格線就決定了「像素 → 值」這條直線。 */
  const yTop = lines[0];
  const yBottom = lines[lines.length - 1];
  const vTop = tickValues[0];
  const vBottom = tickValues[tickValues.length - 1];
  const valueAt = (y) =>
    vBottom + ((yBottom - y) / (yBottom - yTop)) * (vTop - vBottom);
  /*
   * ⚠️ 真值一律讀資料點自己的 `data-value`，**不要讀畫面上的數值標籤**。
   *
   * v2.1.64 起，數值標籤在資料點多的時候不再永遠顯示（改成滑鼠移上去才出現，
   * 使用者要求的，因為標籤在長期趨勢圖上必然互相重疊）。
   * 舊寫法是抓 `text.point-value` 當參照物——標籤不在，這一整組斷言就
   * 退化成「0 個點、誤差 0.0」的恆真狀態。**實測就是這樣紅在前置檢查的**，
   * 那個前置檢查寫對了。
   *
   * 改讀 data-value 之後**比以前更強**：120 季那種密集情況以前根本驗不到
   *（標籤被抽樣掉了），現在每一個點都驗得到。
   *
   * 這不會變成恆真：data-value 與圓點的 cy 是同一個運算式算出來的沒錯，
   * 但這裡的 fromAxis 是**照格線反推**的，走的是另一套對應關係。
   * v2.1.59 那種「點用 235、格線用 240」的錯照樣會讓兩者對不起來。
   */
  const dots = [...svg.querySelectorAll("circle[data-value]")];
  const rows = dots.map((dot) => ({
    labelled: Number(dot.getAttribute("data-value")),
    fromAxis: valueAt(Number(dot.getAttribute("cy"))),
  }));
  const gap = Math.abs(lines[1] - lines[0]);
  return { rows, tickValues, gridGap: gap, span: vTop - vBottom };
});

ok("前置：要讀得到格線與資料點（讀不到的話下一項會變成恆真）",
  !axisCheck.error && (axisCheck.rows || []).length > 0,
  axisCheck.error || `${(axisCheck.rows || []).length} 個點`);
{
  const rows = (axisCheck.rows || []).filter(
    (r) => Number.isFinite(r.labelled) && Number.isFinite(r.fromAxis),
  );
  /* 容差取「整個縱軸跨距的 0.5%」——舊版的誤差是 2%，這條線分得開。 */
  const tolerance = Math.abs(axisCheck.span || 1) * 0.005;
  const worst = rows.reduce(
    (acc, r) => Math.max(acc, Math.abs(r.labelled - r.fromAxis)),
    0,
  );
  const highest = rows.reduce(
    (acc, r) => (r.labelled > (acc?.labelled ?? -Infinity) ? r : acc),
    null,
  );
  ok(
    "前置：測資要有一個夠高的點（都貼著 0 的話這一項會變成恆真）",
    !!highest && highest.labelled > Math.abs(axisCheck.span || 1) * 0.3,
    highest ? `最高點標著 ${highest.labelled}` : "沒有點",
  );
  ok(
    "照縱軸把點的高度反推回來，要等於那個點旁邊標的數字",
    rows.length > 0 && worst <= tolerance,
    `最大誤差 ${worst.toFixed(1)}（容差 ${tolerance.toFixed(1)}）`,
  );
}

/* ── 七、縱軸刻度要落在好看的整數上 ── */
/*
 * 舊版的軸頂是「資料最大值 ×1.12」，直接均分四格，刻度就變成
 * 6,015.5／4,511.6／3,007.8／1,503.9／0 這種一排亂數——看圖的人得先在
 * 心裡換算才知道某一點大概是多少。
 *
 * ⚠️ 假通過陷阱：只驗「刻度沒有小數點」擋不住舊版——資料剛好大一點時
 * 四捨五入後也可能都是整數（例如 6,016／4,512／3,008），一樣不好讀。
 * 要驗的是**間距本身**是不是 1／2／2.5／5 的 10 的次方倍。
 */
{
  const ticks = (axisCheck.tickValues || []).filter(Number.isFinite);
  const steps = [];
  for (let i = 1; i < ticks.length; i += 1)
    steps.push(Math.abs(ticks[i - 1] - ticks[i]));
  const step = steps[0] ?? 0;
  const power = step > 0 ? Math.pow(10, Math.floor(Math.log10(step))) : 1;
  const scaled = step > 0 ? Number((step / power).toFixed(6)) : 0;
  ok(
    "前置：要真的讀到五個刻度（讀不到的話下一項會變成恆真）",
    ticks.length === 5,
    `${ticks.length} 個：${ticks.join("、")}`,
  );
  /*
   * 允許的間距與程式裡的 NICE_STEPS 一致：1／1.5／2／2.5／3／4／5／6／8／10
   * 的 10 的次方倍。這幾個乘上任何一個 10 的次方，讀起來都是一眼就知道
   * 多少的數；1,750 或 1,504 這種就不是。
   */
  ok(
    "縱軸每一格的間距要是好讀的整數（1／1.5／2／2.5／3／4／5／6／8 的 10 的次方倍）",
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].includes(scaled),
    `刻度：${ticks.join("、")}｜間距 ${step}`,
  );
  ok(
    "同一條縱軸上每一格的間距要相同",
    steps.every((v) => Math.abs(v - step) < step * 0.001),
    steps.join("、"),
  );
}

/* ════════════════════════════════════════════════════════════════
 * 圖說的第 3 級「代表什麼狀況」與第 4 級「要怎麼處理」
 * ════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-20（三支同步）：
 *   「三支共通：圖旁說明文字升到第 3 級（代表什麼狀況）、第 4 級（要怎麼處理）」
 *   「第 4 級只在寫得出具體的時候才寫……不要盲猜」
 *   「文字不要超出標框或重疊等，以前踩過的雷不要再次發生」
 *
 * ⚠️ 單元測試（tests/chart-levels.test.ts）只驗得到「函式回得出句子」。
 *   句子有沒有真的畫到畫面上、有沒有撐破框，只有真的開瀏覽器量得出來。
 * ⚠️ 「沒有第 4 級」**不是缺陷**：使用者明講寫不出具體的就整段不寫。
 */
console.log("\n══ 圖說第 3、4 級 ══");
const levelReport = await page.evaluate(() => {
  const items = [...document.querySelectorAll(".trend-script-item")];
  return items.map((item) => {
    const box = item.getBoundingClientRect();
    return {
      title: (item.querySelector("h4")?.textContent || "").trim(),
      text: [...item.querySelectorAll("p")]
        .map((p) => (p.textContent || "").trim())
        .join(""),
      width: Math.round(box.width),
      spilled: [...item.querySelectorAll("p, h4")]
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            text: (el.textContent || "").slice(0, 24),
            over: Math.max(
              0,
              Math.round(rect.right - box.right),
              Math.round(box.left - rect.left),
            ),
          };
        })
        .filter((entry) => entry.over > 1),
      scrollOverflow: item.scrollWidth - item.clientWidth,
    };
  });
});
ok(
  "前置：量得到講稿段落（沒有的話下面每一條都變成恆真）",
  levelReport.length > 0,
  `${levelReport.length} 段`,
);
const state = levelReport.filter((item) => item.title === "代表什麼狀況");
ok(
  "⚠️ 講稿有第 3 級「代表什麼狀況」",
  state.length > 0,
  `${state.length} 段`,
);
ok(
  "⚠️ 第 3 級帶得出數字，不是「本圖顯示各項數值之分布」這種空話",
  state.every((item) => item.text.length >= 20 && /\d/.test(item.text)),
  state.map((item) => item.text.slice(0, 40)).join("／"),
);
const action = levelReport.filter((item) => item.title === "要怎麼處理");
ok(
  "有第 4 級時它不是空標題（沒有第 4 級本來就允許）",
  action.every((item) => item.text.length >= 20),
  `${action.length} 段`,
);
const spilled = levelReport.filter((item) => item.spilled.length);
ok(
  "⚠️ 沒有任何一段文字撐出說明框外",
  spilled.length === 0,
  spilled.length
    ? spilled
        .slice(0, 3)
        .map(
          (item) =>
            `框寬 ${item.width}px，「${item.spilled[0].text}」超出 ${item.spilled[0].over}px`,
        )
        .join("；")
    : `${levelReport.length} 段都在框內`,
);
const scrolled = levelReport.filter((item) => item.scrollOverflow > 1);
ok(
  "說明框沒有水平捲軸（有的話字會被切掉）",
  scrolled.length === 0,
  scrolled.length
    ? `最多超出 ${Math.max(...scrolled.map((item) => item.scrollOverflow))}px`
    : "",
);
/*
 * ⚠️ 讀說明的時候圖要一直看得見。
 *   這條規則寫在 ≥1400px 的 @media 裡，新加的 CSS 一旦蓋掉它，
 *   版面守門不會紅（它量的是版面不是字數）。
 */
const stickyChart = await page.evaluate(() => {
  const chart = document.querySelector(".trend-layout > .trend-chart");
  return chart ? getComputedStyle(chart).position : null;
});
ok(
  "⚠️ 寬視窗下，圖仍然釘在畫面上（讀說明時看得見圖）",
  stickyChart === "sticky",
  `實際 position=${stickyChart}`,
);

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" / "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
