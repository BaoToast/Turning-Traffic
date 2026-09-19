/*
 * ══════════════════════════════════════════════════════════════════════
 *  小分頁可以收合，而且不影響大分頁原本的換頁
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（三支同步）：
 *   「使用者點選了大分頁後，會展開下面的小分頁，那能否做個**可以讓使用者
 *     把小分頁收合**的功能? ……因為**目前點選大分頁是會有跳轉功能的**，
 *     所以如果要做可以收合小分頁的功能的話，可能要想一下怎麼做」
 *
 * ⚠️ 衝突點是使用者自己先指出來的，所以**兩邊都要驗**：
 *   ① 收合鈕按了小分頁收起來
 *   ② 大分頁的文字區按了**只換頁、不收合**
 *   只驗①的話，把整列改成「按哪裡都收合」也會過——而那會把換頁弄丟。
 *
 * ⚠️ 這一支的小分頁**需要資料才列得出來**（presentAnchors 是由畫面決定的），
 *   所以要先造一個計畫並匯入一份匿名活頁簿。沒有資料的話整支會變成恆真，
 *   下面有前置檢查擋著。
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { serve } = await import(pathToFileURL(join(HERE, "serve.mjs")).href);
const { launchOptions } = await import(
  pathToFileURL(join(HERE, "chrome-path.mjs")).href
);
const server = await serve(8262);

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

function makeWorkbook() {
  const arms = 4;
  const width = 14;
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  const rows = Array.from({ length: 12 }, () => Array(arms * width).fill(null));
  for (let approach = 0; approach < arms; approach += 1) {
    const base = approach * width;
    const code = String.fromCharCode(65 + approach);
    rows[1][base] = "站號：A00T00-21";
    rows[1][base + 4] = "日期：115年04月15日";
    rows[2][base] = "站名：收合守門用路口";
    rows[3][base] = `路口編號：路口${code}`;
    rows[4][base] = "時間";
    vehicles.forEach((vehicle, vehicleIndex) => {
      rows[4][base + 1 + vehicleIndex * 3] = vehicle;
      movements.forEach((movement, movementIndex) => {
        rows[5][base + 1 + vehicleIndex * 3 + movementIndex] = movement;
      });
    });
    times.forEach((time, rowIndex) => {
      rows[6 + rowIndex][base] = time;
      vehicles.forEach((_unused, vehicleIndex) => {
        movements.forEach((_movement, movementIndex) => {
          rows[6 + rowIndex][base + 1 + vehicleIndex * 3 + movementIndex] =
            1 + ((approach + vehicleIndex + movementIndex + rowIndex) % 7);
        });
      });
    });
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: arms }).flatMap((_unused, approach) =>
    vehicles.map((__unused, vehicleIndex) => ({
      s: { r: 4, c: approach * width + 1 + vehicleIndex * 3 },
      e: { r: 4, c: approach * width + 3 + vehicleIndex * 3 },
    })),
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "平日");
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["監測日誌"], ["監測日期", "115年04月15日"]]),
    "監測日誌",
  );
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1680, height: 1050 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto("http://127.0.0.1:8262/", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};

await go("建立與管理計畫");
await page.locator(".project-form input").nth(0).fill("A00-COL");
await page.locator(".project-form input").nth(1).fill("收合守門用計畫");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(800);

await go("季度批次匯入");
await page
  .locator('.content label:has-text("調查年度") input')
  .first()
  .fill("115");
await page
  .locator('.content label:has-text("季度") select')
  .first()
  .selectOption("1");
await page.waitForTimeout(400);
await page.evaluate(
  (payload) => {
    const zone = document.querySelector(".upload-card");
    const transfer = new DataTransfer();
    const binary = atob(payload.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    transfer.items.add(new File([bytes], payload.name));
    zone.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  },
  { name: "A00T00-21收合守門用路口.xlsx", base64: makeWorkbook().toString("base64") },
);
for (let wait = 0; wait < 90; wait += 1) {
  await page.waitForTimeout(400);
  const button = page.locator('button:has-text("確認寫入")').first();
  if ((await button.count()) && (await button.isEnabled())) break;
}
await page.locator('button:has-text("確認寫入")').first().click();
await page.waitForTimeout(6000);

/*
 * ⓪ 不可以有「看不見的空按鈕」。
 *
 * 使用者 2026-09-14 在姊妹專案（交通服務水準）回報（附圖）：
 *   「左側分頁這個隱形按鈕是什麼，按了之後也沒任何反應，且直接消失」
 * 這一支是 React 條件渲染，結構上不會有那個毛病——但照樣量一次。
 */
{
  const ghosts = await page.evaluate(() =>
    [...document.querySelectorAll(".nav-collapse")]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        const box = el.closest("div")?.querySelector(":scope > .nav-sections");
        return !box || !(el.textContent || "").trim();
      })
      .map((el) =>
        (el.closest("div")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 10),
      ),
  );
  ok("⓪ 側欄不可以有看不見的空按鈕", ghosts.length === 0, ghosts.join("、"));
}

/* 找一個**真的列得出小分頁**的大分頁。 */
const target = await page.evaluate(() => {
  /*
   * ⚠️ 收合鈕沒有另外包一層（見 traffic-app.tsx 的說明），
   *   所以這裡從**分區 div** 找：裡面同時有大分頁按鈕與 .nav-sections 的那一個。
   */
  const box = [...document.querySelectorAll("nav > div")].find((node) =>
    node.querySelector(":scope > .nav-sections"),
  );
  return box
    ? (box.querySelector(":scope > button")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
    : "";
});
ok("前置：有大分頁真的列得出小分頁（否則整支恆真）", !!target, target);
if (!target) {
  await browser.close();
  await server.close?.();
  console.error("\n❌ 沒有小分頁可驗，不當成通過");
  process.exit(1);
}

const count = () => page.locator(".nav-sections .nav-section:visible").count();
const before = await count();
ok("前置：小分頁至少兩項", before >= 2, `${before} 項`);

const toggle = page.locator("nav .nav-collapse");
ok("有小分頁的大分頁，右側看得到收合鈕", (await toggle.count()) === 1);
/*
 * ⚠️ 2026-09-15 改法：箭頭**永遠是 ▼**，收合狀態靠 **CSS 轉 -90 度**。
 *
 *   原本是展開印 ▾、收合印 ▸，而且寫成 \u25be／\u25b8 跳脫。那兩個字
 *   **不在 Big5**，微軟正黑體畫不出來，在某些電腦上是一片空白；
 *   跳脫寫法還讓字形守門看不到它們（守門已補上還原跳脫）。
 *   使用者 2026-09-15：「這個圖示比較重要，是讓人可以展開／收合的按鈕，
 *     所以請以**任何電腦都能看到**為前題去設計」。
 *
 * ⚠️ 所以這裡量的是**實際轉了幾度**，不是字元。
 *   量字元的話，一個「兩種狀態都不轉」的實作照樣全綠——
 *   而使用者看到的是箭頭永遠朝下、按了沒反應。
 */
const caretAngle = async () =>
  page.locator("nav .nav-collapse").evaluate((el) => {
    const t = getComputedStyle(el).transform;
    if (!t || t === "none") return 0;
    const m = t.match(/matrix\(([^)]+)\)/);
    if (!m) return 0;
    const [a, b] = m[1].split(",").map(Number);
    return Math.round((Math.atan2(b, a) * 180) / Math.PI);
  });
ok(
  "箭頭用的是 Big5 一定有的 ▼（不是畫不出來的 ▾／▸）",
  (await toggle.innerText()).trim() === "▼",
  (await toggle.innerText()).trim(),
);
ok(
  "展開狀態下箭頭朝下（沒有轉角度）",
  Math.abs(await caretAngle()) <= 1,
  `轉了 ${await caretAngle()} 度`,
);

await toggle.click();
await page.waitForTimeout(500);
ok("① 按收合鈕之後小分頁收起來", (await count()) === 0, `剩 ${await count()} 項`);
ok(
  "③ 大分頁本身還在（仍然是選取狀態）",
  (await page.locator("nav button.active").count()) >= 1,
);
ok(
  "收合後 aria-expanded 要是 false",
  (await page.locator("nav .nav-collapse").getAttribute("aria-expanded")) ===
    "false",
);
/*
 * ⚠️ 標籤要寫**按下去會發生什麼**，不是目前狀態。
 *   使用者 2026-09-14：「小標籤寫著『展開』……展開後文字就變成『收合』」。
 */
ok(
  "收合狀態下箭頭改成朝右（轉 -90 度；字仍然是 ▼）",
  Math.abs((await caretAngle()) + 90) <= 1 &&
    (await page.locator("nav .nav-collapse").innerText()).trim() === "▼",
  `轉了 ${await caretAngle()} 度、字是「${(await page.locator("nav .nav-collapse").innerText()).trim()}」`,
);

/*
 * ④ **點大分頁就要展開回來**（收合狀態不可以黏住）
 *
 * ⚠️ 這一條取代了舊版的「重新整理之後收合狀態還記得」。
 *
 *   舊版把小分頁的收合狀態寫進 localStorage，於是使用者 2026-09-14
 *   在交通服務水準上回報（附圖）：「當我點選大分頁標題(路段管理)時，
 *   它並沒有展開而是保持收合，請修正成自動展開下面的各項小分頁」，
 *   接著要求「請同步確認三份程式是否都能自動展開」。
 *   按過一次收合鈕之後那一頁就永遠是收的，只有再按一次收合鈕才展得開。
 *
 *   而「記住小分頁收合」在這支程式裡根本用不到：重新整理回到預設分頁，
 *   要回那一頁就得點它一下——那份記錄唯一做得到的事就是製造上面那個毛病。
 *
 * ⚠️ 分類（整區）收合是另一回事，仍然要記得住，由 e2e-nav-zone.mjs 驗。
 */
await go("資料維護");
await go(target);
ok(
  "④ 收合之後離開再點回這個大分頁，小分頁要自動展開",
  (await count()) === before,
  `${await count()} / ${before}`,
);

/* ④-2 重新整理之後也是展開的（不可以留著上一次的收合）。 */
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await go(target);
ok(
  "④-2 重新整理之後小分頁是展開的",
  (await count()) === before,
  `${await count()} / ${before}`,
);

/* 收合鈕本身還是要能用（不可以為了自動展開就把收合做死）。 */
await page.locator("nav .nav-collapse").click();
await page.waitForTimeout(500);
ok("收合鈕仍然收得起來", (await count()) === 0, `剩 ${await count()} 項`);
await page.locator("nav .nav-collapse").click();
await page.waitForTimeout(500);
const back = await count();
ok("再按一次展開回來", back === before, `${back} / ${before}`);

/* ② 切走再切回來，小分頁必須還在。 */
await go("資料維護");
await go(target);
ok(
  "② 點大分頁的文字區只換頁、不收合",
  (await count()) === before,
  `${await count()} / ${before}`,
);

/* ⑤ 沒有小分頁的大分頁不顯示收合鈕。 */
const stray = await page.evaluate(() =>
  [...document.querySelectorAll("nav > div")]
    /*
     * ⚠️ **收合中的不算**：那時候本來就沒有 .nav-sections，
     *   但收合鈕一定要留著，否則使用者展不開了。
     */
    .filter(
      (node) =>
        node.querySelector(":scope > .nav-collapse")?.getAttribute("aria-expanded") ===
          "true" &&
        !node.querySelector(":scope > .nav-sections"),
    )
    .map((node) => (node.textContent || "").trim().slice(0, 12)),
);
ok("⑤ 沒有小分頁的大分頁不可以出現收合鈕", stray.length === 0, stray.join("、"));

/* ══ ⑥ 箭頭要真的置中（使用者 2026-09-17 附圖回報）══════════════
 *
 * 使用者三支各附一張圖：路口轉向偏左、全日交通量偏右、交通服務水準偏左。
 *
 * ⚠️ 量的是**關係不是像素**：箭頭字形的水平中心要對齊按鈕的水平中心。
 *   寫死「距離左邊界幾 px」的話，改個字級或按鈕寬度就會誤紅。
 *
 * ⚠️ 用 Range 量**字形本身**的框，不是量按鈕的框。
 *   量按鈕等於拿它自己跟自己比，永遠置中——那是恆真的守門。
 *
 * 反證（實跑）：把 flex 置中與 line-height:1 拿掉，實測橫向偏移 −7.99px，
 * 正是使用者附圖上看到的「偏一邊」。
 */
const carets = await page.evaluate((selector) => {
  const out = [];
  for (const button of document.querySelectorAll(selector)) {
    if (button.hidden) continue;
    const range = document.createRange();
    range.selectNodeContents(button);
    const glyph = range.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    if (glyph.width < 1 || box.width < 1) continue;
    out.push({
      text: (button.textContent || "").trim(),
      dx: +(glyph.left + glyph.width / 2 - (box.left + box.width / 2)).toFixed(2),
      dy: +(glyph.top + glyph.height / 2 - (box.top + box.height / 2)).toFixed(2),
    });
  }
  return out;
}, ".sidebar nav .nav-collapse");
ok(
  "前置：量得到收合鈕裡的箭頭（0 顆的話下一條恆真）",
  carets.length > 0,
  `${carets.length} 顆`,
);
const offCenter = carets.filter((c) => Math.abs(c.dx) > 1 || Math.abs(c.dy) > 1.5);
ok(
  "⚠️ ⑥ 箭頭在收合鈕裡要置中（使用者回報偏一邊）",
  carets.length > 0 && offCenter.length === 0,
  offCenter.length
    ? offCenter.map((c) => `「${c.text}」橫 ${c.dx}px／縱 ${c.dy}px`).join("、")
    : `最大偏移 橫 ${Math.max(...carets.map((c) => Math.abs(c.dx)))}px／縱 ${Math.max(...carets.map((c) => Math.abs(c.dy)))}px`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
await server.close?.();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 小分頁可收合、可記住；大分頁的換頁一個字都沒改");
