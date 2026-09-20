/*
 * ══════════════════════════════════════════════════════════════════════
 *  八叉路口：畫得出來、不被裁掉、圖卡彼此不重疊
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 為什麼需要這一支 ──
 *
 * 使用者 2026-09-20 指定：「路口轉向：手動新增支線上限 7 → 8（請執行）」。
 *
 * ⚠️ 把常數從 7 改成 8 是**一行**的事，真正的工作在這裡：
 *   畫布尺寸、圖卡擺放角度、圖例位置全部是跟著支線數走的，
 *   七叉排得下不代表八叉排得下。使用者 2026-09-11 已經在七叉上踩過
 *   「右上角兩張小卡被切掉右半邊」（見 e2e-diagram-bounds.mjs），
 *   那一次是改了畫布卻沒有人用八叉量過。
 *
 * ⚠️ 這一支**不是** e2e-diagram-bounds 的複製品：
 *   那一支量的是「有沒有超出 viewBox」（被裁掉），
 *   這一支多量一件它沒有量的事——**圖卡彼此有沒有疊在一起**。
 *   卡片互相疊在畫布正中央，一樣在 viewBox 裡面，那一支會全綠。
 *
 * ── 這一支量什麼 ──
 *
 *   1. 八叉那一筆真的畫出 8 張圖卡（不是畫了 7 張就停）
 *   2. 畫布上沒有任何東西超出 viewBox
 *   3. 任何兩張圖卡都沒有重疊
 *   4. 圖卡上的文字沒有跑到別張卡上
 *   5. 手動新增支線的按鈕在第 8 條時才停用（上限確實是 8 不是 7、也不是無限）
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
 * ⚠️ 支線名稱要用**長度接近真實路名**的名字。
 *   樣本檔的「路口A」是三個字，圖卡寬度跟著名稱長度走——短名的卡片本來
 *   就塞得下，量不出擠爆畫布的情形。e2e-diagram-bounds 就是因為一開始
 *   用短名而拿到假的綠。名稱是虛構的（真實路口名不可以進測試資料），
 *   長度才是重點。
 */
const LONG_ARM_NAMES = [
  "示範北路一段",
  "示範南路二段",
  "示範東路三段",
  "示範西路四段",
  "示範環河快速道路",
  "示範交流道匝道",
  "示範產業園區聯外道路",
  "示範科學園區聯絡道",
];
const ARM_COUNT = LONG_ARM_NAMES.length;
/*
 * 八叉那一筆在路口下拉上的名字。
 * ⚠️ 用名字認，**不可以用圖卡數認**：一條支線畫兩張卡，四叉路口剛好也是
 *   8 張卡，用數量認會把四叉當成八叉驗（第一版就是這樣拿到假的綠）。
 */
const EIGHT_ARM_NAME = "示範交流道路";

/*
 * 把樣本檔的七叉那一筆加成八叉。
 *
 * ⚠️ 第 8 條要**複製一條既有支線再改識別欄位**，不可以憑空捏一個空殼：
 *   movements 少一個欄位的話畫面可能整個不畫，於是這一支會因為
 *   「畫不出來」而紅，看起來像排版問題，其實是測資做壞了。
 */
const seedData = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
const target = seedData.records.find(
  (record) => record.approaches.length === ARM_COUNT - 1,
);
if (!target) {
  console.error("❌ 前置：樣本檔裡找不到七叉那一筆，這一支沒有東西可以量");
  process.exit(1);
}
const eighth = structuredClone(target.approaches[target.approaches.length - 1]);
eighth.id = `${target.id}-H`;
eighth.sourceCode = "H";
eighth.bearing = "NNE";
/*
 * ⚠️ 角度要與既有七條**都不同**：重複的角度會讓兩張卡疊在同一個位置，
 *   那是測資造成的重疊，不是程式的問題。
 */
target.approaches.push(eighth);
/*
 * ⚠️ 八條支線的角度要**平均分布**（每 45 度一條）。
 *   這是八叉路口實際的樣子，也是「這個版面排不排得下」要問的問題。
 *   兩條支線角度只差 20 度時圖卡本來就會疊在一起——那不是八叉造成的，
 *   四叉也一樣會發生，而且程式對那種情形**已經有「匯出前排版預警」**。
 *   下面第 6 項會另外用角度太近的資料驗那個預警真的會跳。
 */
target.approaches.forEach((approach, index) => {
  approach.name = LONG_ARM_NAMES[index];
  approach.angle = (index * 360) / ARM_COUNT;
  approach.cardOffset = undefined;
  approach.cardOffsets = undefined;
  approach.cardLayouts = undefined;
  approach.labelOffset = undefined;
});
const seed = JSON.stringify(seedData);

/*
 * 對照組：把第 8 條的角度挪到只差 20 度，圖卡一定會疊在一起。
 * 用它驗「匯出前排版預警」真的會跳——那是使用者唯一的安全網，
 * 預警不跳的話他會把疊在一起的圖直接交出去。
 */
const crowdedData = JSON.parse(JSON.stringify(seedData));
const crowded = crowdedData.records.find(
  (record) => record.approaches.length === ARM_COUNT,
);
crowded.approaches[ARM_COUNT - 1].angle = 20;
const crowdedSeed = JSON.stringify(crowdedData);
const shotDir = join(here, "..", ".probe-shots");
mkdirSync(shotDir, { recursive: true });

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

ok(
  "前置：測資真的是八叉，八個角度互不相同且平均分布",
  target.approaches.length === ARM_COUNT &&
    new Set(target.approaches.map((a) => a.angle)).size === ARM_COUNT,
  `${target.approaches.length} 條支線，角度 ${target.approaches
    .map((a) => a.angle)
    .join("／")}`,
);
ok(
  "前置：對照組真的把兩條支線擺得很近（角度差 20 度）",
  crowded.approaches[ARM_COUNT - 1].angle === 20 &&
    crowded.approaches.some((a, i) => i !== ARM_COUNT - 1 && Math.abs(a.angle - 20) <= 25),
  `對照組角度 ${crowded.approaches.map((a) => a.angle).join("／")}`,
);

const server = await serve(8141);
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
await page.goto("http://localhost:8141/");
await page.waitForTimeout(1200);

await page
  .locator('nav button:has-text("路口轉向圖"), aside button:has-text("路口轉向圖")')
  .first()
  .click();
await page.waitForTimeout(900);

/*
 * ⚠️ 用 data-testid 認「路口」那一個下拉，**不可以靠選項文字**——
 *   旁邊的「路口流量視角」下拉的選項也含「路口」兩個字，挑錯的話
 *   整支量的會是顯示模式，而它照樣全綠（見 e2e-diagram-bounds 的註解）。
 */
const INTERSECTION_SELECT = '[data-testid="diagram-intersection"]';
const options = await page.evaluate((sel) => {
  const select = document.querySelector(sel);
  return select
    ? [...select.options].map((o) => ({ value: o.value, label: o.textContent || "" }))
    : [];
}, INTERSECTION_SELECT);
console.log("   路口下拉：", JSON.stringify(options));
ok(
  "前置：找得到路口下拉，而且至少有一個選項",
  options.length > 0,
  `${options.length} 個選項`,
);

/**
 * 量一張圖：viewBox、每一張圖卡的矩形、每一段文字的矩形。
 *
 * ⚠️ 用 getBBox() 並經 CTM 換算到**根 SVG 的使用者座標**。
 *   直接用 getBBox() 量到的是「相對於那張卡左上角」的數字，
 *   看起來每一個都在畫布裡面——那是假的綠。
 *   改用 getBoundingClientRect() 則會量到螢幕像素，而 SVG 會整張縮放
 *   塞進面板，被裁掉的部分在螢幕上根本不存在，量起來永遠剛好貼邊。
 */
async function measureOn(target) {
  return target.evaluate(() => {
    const svg = document.querySelector(".diagram-canvas svg");
    if (!svg) return null;
    const box = svg.viewBox.baseVal;
    const rootInverse = svg.getScreenCTM()?.inverse();
    if (!rootInverse) return null;
    const rectOf = (el) => {
      let b;
      try {
        b = el.getBBox();
      } catch {
        return null;
      }
      if (!b.width && !b.height) return null;
      const ctm = el.getScreenCTM();
      if (!ctm) return null;
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
      return {
        cls: el.getAttribute("class") || "",
        text: (el.textContent || "").slice(0, 20),
        owner: (() => {
          const group = el.closest("[data-card-id]");
          return group
            ? `${group.getAttribute("data-card-id")}:${group.getAttribute("data-card-section")}`
            : "";
        })(),
        x: Math.min(...xs),
        y: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
      };
    };
    const cards = [...svg.querySelectorAll("rect.flow-card")]
      .map(rectOf)
      .filter(Boolean);
    const texts = [...svg.querySelectorAll("text")].map(rectOf).filter(Boolean);
    const everything = [
      ...cards,
      ...texts,
      ...[...svg.querySelectorAll("path.movement-path, rect.junction")]
        .map(rectOf)
        .filter(Boolean),
    ];
    return {
      view: { x: box.x, y: box.y, width: box.width, height: box.height },
      cards,
      texts,
      everything,
    };
  });
}

/**
 * 兩個矩形有沒有重疊。
 *
 * ⚠️ 用**嚴格大於**，剛好相接不算重疊：整排並排的卡片邊緣本來就會相碰，
 *   算成重疊的話這一支會永遠紅。容差 0.5 是為了避開浮點誤差。
 */
const overlaps = (a, b) =>
  a.x < b.right - 0.5 &&
  b.x < a.right - 0.5 &&
  a.y < b.bottom - 0.5 &&
  b.y < a.bottom - 0.5;

for (const { value, label: optionLabel } of options) {
  await page.selectOption(INTERSECTION_SELECT, value);
  await page.waitForTimeout(700);
  const data = await measureOn(page);
  if (!data) {
    ok(`${value}：畫得出轉向圖`, false, "找不到 .diagram-canvas svg");
    continue;
  }
  const { view, cards, texts, everything } = data;
  /*
   * ⚠️ **不可以用「圖卡數＝8」判斷這是不是八叉那一筆。**
   *   一條支線會畫兩張卡（駛入、駛出），所以四叉路口剛好也是 8 張——
   *   第一版就是這樣把四叉當成八叉驗，而且全綠。
   *   要用路口名稱認，並且另外把「圖卡數＝支線數×2」也釘住。
   */
  const isEight = optionLabel.includes(EIGHT_ARM_NAME);
  const label = `${optionLabel}（${cards.length} 張圖卡）`;

  /* 1. 八叉那一筆真的畫出 8 張卡。 */
  if (isEight)
    ok(
      `⚠️ ${label}：八條支線全部畫出來了（一條支線兩張卡：駛入、駛出）`,
      cards.length === ARM_COUNT * 2,
      `期望 ${ARM_COUNT * 2} 張，實際 ${cards.length} 張`,
    );

  /* 2. 沒有東西超出 viewBox。 */
  const outside = everything.filter(
    (i) =>
      i.x < view.x - 0.5 ||
      i.y < view.y - 0.5 ||
      i.right > view.x + view.width + 0.5 ||
      i.bottom > view.y + view.height + 0.5,
  );
  ok(
    `${label}：沒有任何東西超出 viewBox（超出＝螢幕上被裁掉）`,
    outside.length === 0,
    outside.length
      ? `viewBox ${Math.round(view.width)}×${Math.round(view.height)}；超出 ${outside.length} 項：` +
        outside
          .slice(0, 4)
          .map(
            (i) =>
              `${i.cls || "text"}「${i.text}」右緣 ${Math.round(i.right)}／下緣 ${Math.round(i.bottom)}`,
          )
          .join("；")
      : `viewBox ${Math.round(view.width)}×${Math.round(view.height)}，共量了 ${everything.length} 個元素`,
  );

  /* 3. 圖卡彼此不重疊——這是 e2e-diagram-bounds 沒有量的那一件。 */
  const cardHits = [];
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++)
      if (overlaps(cards[i], cards[j]))
        cardHits.push(
          `#${i}(${Math.round(cards[i].x)},${Math.round(cards[i].y)}–${Math.round(cards[i].right)},${Math.round(cards[i].bottom)})` +
            ` × #${j}(${Math.round(cards[j].x)},${Math.round(cards[j].y)}–${Math.round(cards[j].right)},${Math.round(cards[j].bottom)})`,
        );
  ok(
    `⚠️ ${label}：任何兩張圖卡都沒有疊在一起`,
    cardHits.length === 0,
    cardHits.length
      ? `${cardHits.length} 組重疊：${cardHits.slice(0, 4).join("、")}`
      : `${cards.length} 張卡兩兩比對過`,
  );

  /*
   * 4. 文字沒有跑到別張卡上。
   *
   * ⚠️ 只比「這段文字」與「不是它所屬的那一張卡」：文字本來就畫在自己
   *   那張卡裡面，全部比對的話每一段文字都會報重疊。判斷歸屬的方式是
   *   卡片標題刻意畫在矩形外面，所以不能用「文字完全落在矩形裡」猜歸屬；
   *   要沿 DOM 找同一個 data-card-id ＋ data-card-section。否則字型量測只要比
   *   卡片左緣多出 2px，就會把自己的卡誤報成「別張卡」。
   */
  const strayTexts = [];
  for (const t of texts) {
    const ownIndex = t.owner
      ? cards.findIndex((c) => c.owner === t.owner)
      : -1;
    cards.forEach((c, index) => {
      if (index === ownIndex) return;
      if (overlaps(t, c))
        strayTexts.push(
          `「${t.text}」(${Math.round(t.x)},${Math.round(t.y)}–${Math.round(t.right)},${Math.round(t.bottom)})` +
            ` 壓到卡片 #${index}(${Math.round(c.x)},${Math.round(c.y)}–${Math.round(c.right)},${Math.round(c.bottom)})`,
        );
    });
  }
  ok(
    `${label}：圖卡上的文字沒有壓到別張卡`,
    strayTexts.length === 0,
    strayTexts.length
      ? `${strayTexts.length} 處：${strayTexts.slice(0, 4).join("、")}`
      : `${texts.length} 段文字都在自己的卡片範圍內`,
  );

  if (isEight)
    await page.screenshot({
      path: join(shotDir, "eight-arm.png"),
      fullPage: false,
    });
}

/*
 * 5. 手動新增支線的上限確實是 8。
 *
 * ⚠️ 這一條是**反過來驗**的：上限被偷偷改回 7 的話，八叉那一筆的
 *   「新增支線」鈕在第 8 條就已經停用；改成無限的話它永遠不會停用。
 *   所以要同時確認「八條時停用」與「畫面上寫的數字是 8」。
 */
/*
 * ⚠️ 側欄上的名字是「道路與流向管理」，不是「路口幾何」——
 *   「路口幾何示意圖」是它底下的小分頁。第一版用錯名字，
 *   locator 等了 30 秒才逾時，整支測試當掉而不是紅。
 */
await page
  .locator('nav button:has-text("道路與流向管理"), aside button:has-text("道路與流向管理")')
  .first()
  .click();
await page.waitForTimeout(900);
const limitState = await page.evaluate(() => {
  const text = document.body.innerText;
  const hit = text.match(/手動最多\s*(\d+)\s*條支線/);
  const button = [...document.querySelectorAll("button")].find((b) =>
    (b.textContent || "").includes("新增支線"),
  );
  return {
    shownLimit: hit ? Number(hit[1]) : null,
    disabled: button ? button.disabled : null,
    found: Boolean(button),
  };
});
ok(
  "⚠️ 手動新增支線的上限寫的是 8（改回 7 或改成無限都要紅）",
  limitState.shownLimit === ARM_COUNT,
  `畫面上寫「手動最多 ${limitState.shownLimit ?? "？"} 條支線」`,
);
ok(
  "八條支線時「新增支線」鈕會停用（上限真的有生效）",
  limitState.found ? limitState.disabled === true : false,
  limitState.found
    ? `disabled=${limitState.disabled}`
    : "找不到「新增支線」按鈕",
);

/*
 * 6. 兩條支線角度只差 20 度時，版面一樣要排得開。
 *
 * ⚠️ 這一項與第 3 項是**一體兩面**：第 3 項守「正常的八叉排得開」，
 *   這一項守「使用者把兩條支線調到幾乎同一個方向時也排得開」。
 *   原本的外圍格位規則在這種資料下會把兩張卡疊在一起，
 *   靠的是最後那一段「真的疊在一起就推開」。只驗正常角度的話，
 *   那一段被拿掉也不會有人發現。
 *
 * ⚠️ 刻意**不**改用「看排版預警有沒有跳」來驗：預警是最後的安全網，
 *   但使用者要的是圖本身是對的。推開成功時預警本來就不該跳，
 *   拿它當通過條件會變成「越修越紅」。
 */
const crowdedPage = await ctx.newPage();
const crowdedErrors = [];
crowdedPage.on("pageerror", (e) => crowdedErrors.push(e.message));
await crowdedPage.addInitScript(
  (s) => localStorage.setItem("turning-traffic-state-v2", s),
  crowdedSeed,
);
await installStateHelpers(crowdedPage);
await crowdedPage.goto("http://localhost:8141/");
await crowdedPage.waitForTimeout(1200);
await crowdedPage
  .locator('nav button:has-text("路口轉向圖"), aside button:has-text("路口轉向圖")')
  .first()
  .click();
await crowdedPage.waitForTimeout(900);
await crowdedPage.selectOption(
  INTERSECTION_SELECT,
  options.find((o) => o.label.includes(EIGHT_ARM_NAME)).value,
);
await crowdedPage.waitForTimeout(800);
const crowdedMeasured = await measureOn(crowdedPage);
if (!crowdedMeasured) {
  ok("對照組：畫得出轉向圖", false, "找不到 .diagram-canvas svg");
} else {
  const hits = [];
  const cc = crowdedMeasured.cards;
  for (let i = 0; i < cc.length; i += 1)
    for (let j = i + 1; j < cc.length; j += 1)
      if (overlaps(cc[i], cc[j]))
        hits.push(
          `#${i}(${Math.round(cc[i].x)},${Math.round(cc[i].y)}) × #${j}(${Math.round(cc[j].x)},${Math.round(cc[j].y)})`,
        );
  ok(
    "⚠️ 對照組（兩條支線角度只差 20 度）：圖卡一樣沒有疊在一起",
    hits.length === 0,
    hits.length ? `${hits.length} 組重疊：${hits.slice(0, 4).join("、")}` : `${cc.length} 張卡兩兩比對過`,
  );
  await crowdedPage.screenshot({
    path: join(shotDir, "eight-arm-crowded.png"),
    fullPage: false,
  });
}
await crowdedPage.close();

ok(
  "過程中沒有未攔截的錯誤",
  errors.length === 0 && crowdedErrors.length === 0,
  [...errors, ...crowdedErrors].slice(0, 3).join("；"),
);

await browser.close();
await server.close();

if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過：`);
  for (const line of problems) console.error("   ・" + line);
  process.exit(1);
}
console.log("\n✅ 八叉路口版面檢查全部通過");
