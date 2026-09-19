/*
 * ══════════════════════════════════════════════════════════════════════
 *  轉向圖：畫布上的每一樣東西都要在 viewBox 裡面（不可以被裁掉）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 為什麼需要這一支 ──
 *
 * 使用者 2026-09-11 實測（T7-01 中山北路－岡山路口，七叉）：
 *   「右上角『駛出路口A』『駛出路口G』那兩張小卡被切掉右半邊。」
 *
 * ⚠️ 這個 bug 最惡劣的地方是**下載的 PNG 是完整的**——匯出走另一條路徑，
 *   依實際內容重算邊界。同一張圖，螢幕上被切、檔案裡完整，於是
 *   「照著程式碼看」與「照著匯出的檔案看」都查不出問題，
 *   只有真的用眼睛看螢幕才看得到。
 *
 * ⚠️⚠️ 2026-09-13 更正：當初寫在待修正清單裡的診斷（「被裁掉的是 SVG 內部
 *   超出 viewBox 的內容」）**是錯的**。拿使用者提供的真實七叉檔實測，
 *   SVG 內部一個元素都沒有超出 viewBox；真正的原因是 CSS 的
 *   `min-width: 880px` 把 SVG 釘在 880px，而螢幕 1440px 以下時
 *   `.diagram-canvas` 的可視寬只有 838／764／678px——**容器放不下 SVG**。
 *   我照那個錯誤診斷找了一整輪都找不到，正是因為量錯了東西。
 *   所以這一支同時守兩件事：viewBox 內（下半段）與**容器放得下**（最下面）。
 *
 * ── 這一支量什麼 ──
 *
 * 用 SVG 自己的座標系（getBBox()）逐一量每一張圖卡、每一段文字、每一條
 * 路徑，看有沒有任何一個落在 viewBox 外面。量的是**使用者座標**，
 * 不是螢幕像素——螢幕上的縮放會把「被裁掉」偽裝成「剛好貼邊」。
 *
 * 另外把圖截下來存檔，讓人可以直接用眼睛看（使用者要求：
 * 「畫面色彩、裁切要靠肉眼的方式去做判斷，不要只靠程式碼」）。
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
/*
 * ⚠️ 樣本檔的支線名稱是「路口A」這種三個字的短名，**用它量不出這個 bug**。
 *   使用者回報的是七叉 ＋ 真實路名（中山北路、岡山路…），圖卡的寬度是
 *   跟著名稱長度走的——短名的卡片本來就塞得下，畫布固定成 1200 也不會
 *   超出。我第一次量就是這樣拿到假的綠（把畫布改回舊的固定 1200×900，
 *   這一支照樣全綠）。
 *
 * 所以這裡把七叉那一筆的支線改成**長度接近真實路名**的名字再量。
 * 名稱是虛構的（真實路口名不可以進測試資料），長度才是重點。
 */
const LONG_ARM_NAMES = [
  "示範北路一段",
  "示範南路二段",
  "示範東路三段",
  "示範西路四段",
  "示範環河快速道路",
  "示範交流道匝道",
  "示範產業園區聯外道路",
];
const seedData = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
for (const record of seedData.records)
  if (record.approaches.length === LONG_ARM_NAMES.length)
    record.approaches.forEach((approach, index) => {
      approach.name = LONG_ARM_NAMES[index];
    });
const seed = JSON.stringify(seedData);
const shotDir = join(here, "..", ".probe-shots");
mkdirSync(shotDir, { recursive: true });

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(8133);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(
  (s) => localStorage.setItem("turning-traffic-state-v2", s),
  seed,
);
await installStateHelpers(page);
await page.goto("http://localhost:8133/");
await page.waitForTimeout(1200);

await page
  .locator('nav button:has-text("路口轉向圖"), aside button:has-text("路口轉向圖")')
  .first()
  .click();
await page.waitForTimeout(900);

/** 畫布上有哪幾筆路口可以選。七叉那一筆是 seed-state 的 R2。 */
const picks = await page.evaluate(() =>
  [...document.querySelectorAll("select")]
    .map((select, index) => ({
      index,
      options: [...select.options].map((o) => o.textContent || ""),
    }))
    .filter((s) => s.options.some((t) => t.includes("路口"))),
);
console.log("   下拉選單：", JSON.stringify(picks).slice(0, 300));

/**
 * 量一張圖：viewBox 的範圍，以及每一個畫出來的東西的邊界。
 *
 * ⚠️ 用 getBBox() 取的是 **SVG 使用者座標**。
 *   改用 getBoundingClientRect() 會量到螢幕像素，而 SVG 會把整張圖縮放
 *   塞進面板——被裁掉的部分在螢幕上根本不存在，量起來永遠「剛好貼邊」。
 */
async function measure(label) {
  const data = await page.evaluate(() => {
    const svg = document.querySelector(".diagram-canvas svg");
    if (!svg) return null;
    const box = svg.viewBox.baseVal;
    const out = [];
    /*
     * ⚠️ getBBox() 回的是**該元素自己的座標系**，不是根 SVG 的。
     *   圖卡都包在 <g transform="translate(...)"> 裡，直接拿 getBBox()
     *   會量到「相對於那張卡左上角」的數字（右緣 17 之類），
     *   看起來每一個都在畫布裡面——那是假的綠。
     *   要先用 CTM 換算到根座標系才有意義。
     */
    const rootInverse = svg.getScreenCTM()?.inverse();
    if (!rootInverse) return null;
    for (const el of svg.querySelectorAll(
      "rect.flow-card, text, path.movement-path, rect.junction",
    )) {
      let b;
      try {
        b = el.getBBox();
      } catch {
        continue;
      }
      if (!b.width && !b.height) continue;
      const ctm = el.getScreenCTM();
      if (!ctm) continue;
      const toRoot = rootInverse.multiply(ctm);
      const xs = [];
      const ys = [];
      for (const [px, py] of [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x, b.y + b.height],
        [b.x + b.width, b.y + b.height],
      ]) {
        const point = svg.createSVGPoint();
        point.x = px;
        point.y = py;
        const moved = point.matrixTransform(toRoot);
        xs.push(moved.x);
        ys.push(moved.y);
      }
      out.push({
        tag: el.tagName,
        cls: el.getAttribute("class") || "",
        text: (el.textContent || "").slice(0, 18),
        x: Math.round(Math.min(...xs)),
        y: Math.round(Math.min(...ys)),
        right: Math.round(Math.max(...xs)),
        bottom: Math.round(Math.max(...ys)),
      });
    }
    return {
      view: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
      items: out,
    };
  });
  if (!data) {
    ok(`${label}：畫得出轉向圖`, false, "找不到 .diagram-canvas svg");
    return;
  }
  const { view, items } = data;
  const outside = items.filter(
    (i) =>
      i.x < view.x - 0.5 ||
      i.y < view.y - 0.5 ||
      i.right > view.x + view.width + 0.5 ||
      i.bottom > view.y + view.height + 0.5,
  );
  ok(
    `⚠️ ${label}：畫布上沒有任何東西超出 viewBox（超出＝螢幕上被裁掉）`,
    outside.length === 0,
    outside.length
      ? `viewBox ${view.width}×${view.height}；超出 ${outside.length} 項，` +
        outside
          .slice(0, 5)
          .map(
            (i) =>
              `${i.cls || i.tag}「${i.text}」右緣 ${i.right}／下緣 ${i.bottom}`,
          )
          .join("；")
      : `viewBox ${view.width}×${view.height}，共量了 ${items.length} 個元素`,
  );
  return { view, items, outside };
}

/*
 * 依序看每一個路口。seed-state 裡 R1/R3 是四叉、**R2 是七叉**——
 * 七叉那一筆才是使用者回報被裁掉的那一種。
 *
 * ⚠️ 要用「路口」那一個下拉，不是季度那一個：兩個下拉的選項字串都含
 *   「路口」兩個字（季度寫成「115Q2（2 路口）」），挑錯的話會兩輪都停在
 *   同一張四叉圖上，而測試照樣全綠。改成依**選項是不是路口名稱**來認。
 */
const selector = page.locator(".diagram-canvas").first();
/*
 * ⚠️ 用 data-testid 認「路口」那一個下拉，**不可以靠選項文字**。
 *
 *   原本的寫法是「選項裡沒有季度格式，而且有選項含『路口』兩個字」。
 *   旁邊的「路口流量視角」下拉完全符合（選項是「駛出路口（以該支線為起點）」），
 *   於是這一支從頭到尾量的都是**顯示模式**，不是路口——
 *   而它照樣全綠，因為每一種顯示模式下的畫布的確都沒有東西超出 viewBox。
 *   2026-09-15 查到；那正是「守門看起來在驗某件事，其實在驗另一件事」的典型。
 */
const INTERSECTION_SELECT = '[data-testid="diagram-intersection"]';
const pickSelect = () =>
  page.evaluate((sel) => {
    const select = document.querySelector(sel);
    return select ? [...select.options].map((o) => o.value) : [];
  }, INTERSECTION_SELECT);
const names = await pickSelect();
console.log("   路口下拉的選項：", JSON.stringify(names));
/*
 * ⚠️ 下面「七叉畫布要比四叉大」那一條，**不可以靠迴圈跑完剛好停在七叉那一筆**。
 *
 *   那是 2026-09-15 踩到的：主工具列的季度預設從「本季」改成「最早～最新」之後，
 *   路口下拉多列出了前幾季才有的路口，迴圈的最後一筆變成四叉，
 *   於是那一條量到 1200×900 當場轉紅——而**畫布邏輯一個字都沒改**。
 *   依賴「最後一筆剛好是誰」的測試，遲早會被不相干的改動弄紅。
 *   所以這裡把每一個路口的支線數記下來，量之前**明確切回支線最多的那一個**。
 */
const seenArms = [];

for (const value of names.length ? names : [null]) {
  if (value !== null) {
    await page.evaluate(([v, sel]) => {
      const select = document.querySelector(sel);
      if (!select) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      ).set;
      setter.call(select, v);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, [value, INTERSECTION_SELECT]);
    await page.waitForTimeout(900);
  }
  const shown = await page.evaluate(() => ({
    cards: document.querySelectorAll(".diagram-canvas rect.flow-card").length,
    title:
      document.querySelector(".diagram-canvas text.road-name")?.textContent ||
      "",
  }));
  const arms = shown.cards;
  seenArms.push({ value, arms });
  const label = `${value || "預設"}（${arms} 張圖卡）`;
  const result = await measure(label);
  const file = join(
    shotDir,
    `diagram-${String(value || "default").replace(/[^\w-]/g, "_")}.png`,
  );
  await selector.screenshot({ path: file }).catch(() => {});
  console.log("   截圖：", file, result ? "" : "");
}

/*
 * ── 誠實聲明：上面那一條**目前抓不到使用者回報的那個症狀** ────────────
 *
 * 使用者 2026-09-11 在真實的七叉路口看到右上角兩張小卡被切掉右半邊。
 * 我用樣本檔（七叉 ＋ 加長的支線名）重現不出來：把畫布改回舊的固定
 * 1200×900，上面那一條**照樣全綠**，截圖用肉眼看也沒有被切。
 * 原因是圖卡的位置是**依畫布比例**排的，畫布縮小時卡片也跟著縮，
 * 所以「超出 viewBox」這個量法在樣本檔上永遠不會成立。
 *
 * ⚠️ 所以不可以把上面那一條當成「第 42 條已修」的證據。
 *   它守的是另一件事（真的有東西跑到畫布外時會被抓到），
 *   要證明第 42 條，需要使用者那一份真實檔案。
 *
 * 下面這一條才是**現在真的驗得動**的部分，而且改壞會紅：
 * 畫布要隨支線數變大（使用者 2026-09-11 指名的「拖曳空間不夠」），
 * 而四支線以下維持原尺寸（使用者指名「十字路口不要平白多一片空白」）。
 */
/* 明確切回支線最多的那一個路口（七叉），不依賴迴圈的順序。 */
const widest = seenArms.reduce(
  (a, b) => (b.arms > (a?.arms ?? -1) ? b : a),
  null,
);
ok(
  "前置：找得到一個支線比四叉多的路口（找不到的話下面那一條驗不了）",
  Boolean(widest) && widest.arms > 8,
  widest ? `${widest.value}（${widest.arms} 張圖卡）` : "找不到",
);
if (widest?.value) {
  await page.evaluate(([v, sel]) => {
    const select = document.querySelector(sel);
    if (!select) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    ).set;
    setter.call(select, v);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, [widest.value, INTERSECTION_SELECT]);
  await page.waitForTimeout(900);
}
const canvasSizes = await page.evaluate(() => {
  const svg = document.querySelector(".diagram-canvas svg");
  const box = svg?.viewBox.baseVal;
  return box ? { width: box.width, height: box.height } : null;
});
ok(
  "⚠️ 七叉路口的畫布比四叉大（每多一支線加一格，不是寫死一個大數字）",
  !!canvasSizes && canvasSizes.width > 1200 && canvasSizes.height > 900,
  canvasSizes ? `${canvasSizes.width}×${canvasSizes.height}` : "量不到",
);

/*
 * ── 窄一點的螢幕上，整張圖還是要放得下 ─────────────────────────────
 *
 * ⚠️ 2026-09-13 用使用者提供的**真實七叉檔**重現到的缺陷：
 *   SVG 內部沒有任何東西超出 viewBox（上面那一條全綠），但畫面上
 *   右邊整排圖卡（駛入／駛出 B、C、D）就是看不到——因為 CSS 有一條
 *   `min-width: 880px`，而螢幕 1440px 以下時面板可視寬只有 838／764／678px。
 *   **被裁掉的不是 SVG 的內容，是容器放不下 SVG。**
 *
 *   更糟的是畫面上那一行小字還寫著「目前整張圖都看得到（沒有被裁切）」，
 *   因為它只看 diagramScale、不知道有這個下限——系統在講一句不實的話。
 *
 * 使用者 2026-09-12 指定：「不要依靠捲動，直接能在畫面一眼看到成果，
 * 避免使用者以為被裁切到了」。所以**沒有按放大時**，任何常見螢幕寬度下
 * SVG 的實際寬度都不可以超過面板的可視寬度。
 *
 * ⚠️ 量的是 getBoundingClientRect().width vs clientWidth，
 *   不是 viewBox——viewBox 那條量不到這個缺陷（它一直是綠的）。
 */
console.log("\n══ 各種螢幕寬度下，整張圖都要放得下 ══");
for (const width of [1920, 1680, 1536, 1440, 1366, 1280]) {
  await page.setViewportSize({ width, height: 950 });
  await page.waitForTimeout(700);
  const fit = await page.evaluate(() => {
    const box = document.querySelector(".diagram-canvas");
    const svg = box?.querySelector("svg");
    if (!box || !svg) return null;
    return {
      svgWidth: Math.round(svg.getBoundingClientRect().width),
      visible: box.clientWidth,
      /*
       * ⚠️ 高度也要量。使用者 2026-09-13 傳來的實機截圖裡，圖最上面那兩行
       *  （站號｜路口名稱、調查日期）**看不到了**，只剩第三行的「季度…」——
       *   那是上下方向也被容器裁掉。只量寬度會漏掉這一半。
       */
      svgHeight: Math.round(svg.getBoundingClientRect().height),
      visibleHeight: box.clientHeight,
      /* 畫面上那一行小字現在是量出來的，順便把它一起驗。 */
      note: (
        document.querySelector(".diagram-zoom small")?.textContent || ""
      ).trim(),
    };
  });
  if (!fit) {
    ok(`視窗 ${width}px：找得到轉向圖`, false);
    continue;
  }
  const cut = fit.svgWidth - fit.visible;
  ok(
    `⚠️ 視窗 ${width}px：沒有按放大時整張圖放得進面板`,
    cut <= 2,
    `SVG ${fit.svgWidth}px、面板可視 ${fit.visible}px${cut > 2 ? `，右邊被切 ${cut}px` : ""}`,
  );
  const cutV = fit.svgHeight - fit.visibleHeight;
  ok(
    `⚠️ 視窗 ${width}px：上下也放得進面板（標題那兩行不可以被切掉）`,
    cutV <= 2,
    `SVG 高 ${fit.svgHeight}px、面板可視高 ${fit.visibleHeight}px${cutV > 2 ? `，下方被切 ${cutV}px` : ""}`,
  );
  /*
   * ⚠️ 反面檢查：畫面上那句話要和量到的一致。
   *   少了這一條，「放不下卻寫著沒被裁切」會再發生一次而沒有人發現。
   */
  if (fit.note)
    ok(
      `視窗 ${width}px：畫面上的說明與實際相符`,
      cut > 2
        ? fit.note.includes("放不下")
        : !fit.note.includes("放不下"),
      fit.note.slice(0, 60),
    );
}
await page.setViewportSize({ width: 1680, height: 1050 });

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 轉向圖：畫布上的每一樣東西都在 viewBox 內");
