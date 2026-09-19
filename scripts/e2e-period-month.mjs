/*
 * 端對端：期別顯示可以在「季別」與「實際調查月份」之間切換（v2.1.34）。
 *
 * 使用者的情境：一季分兩次做完——2 月做兩站、3 月做三站，都掛 115Q1。
 * 畫面平常顯示 115Q1，按一下切換要能看出這一季實際是「115年2、3月」。
 *
 * 這一支釘住三件事：
 *   1. 切換鈕存在，預設顯示季別
 *   2. 切到月份後，季度下拉與趨勢圖 X 軸都變成實際調查月份
 *   3. **切換不會改變任何數字**——切換前後的尖峰流量逐字相同
 *
 * 對未修正的 v2.1.33 應該紅字（那一版根本沒有這顆按鈕）。
 */
import { chromium } from "playwright";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const problems = [];
/*
 * detail 分兩種：有些是**佐證**（成功時也該印出來看），
 * 有些是**失敗原因**（成功時印出來會讓人以為出事了）。後者包 failOnly()。
 */
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

function makeWorkbook({ dateText, station, name, seed }) {
  const rows = Array.from({ length: 10 }, () => Array(56).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  for (let approach = 0; approach < 4; approach++) {
    const base = approach * 14;
    rows[1][base] = "站號：" + station;
    rows[1][base + 4] = dateText;
    rows[2][base] = "站名：" + name;
    rows[3][base] = `路口編號：路口${String.fromCharCode(65 + approach)}`;
    rows[4][base] = "時間";
    vehicles.forEach((vehicle, vehicleIndex) => {
      rows[4][base + 1 + vehicleIndex * 3] = vehicle;
      movements.forEach((movement, movementIndex) => {
        rows[5][base + 1 + vehicleIndex * 3 + movementIndex] = movement;
      });
    });
    times.forEach((time, rowIndex) => {
      rows[6 + rowIndex][base] = time;
      for (let column = 1; column <= 12; column++)
        rows[6 + rowIndex][base + column] =
          1 + ((approach + column + rowIndex + seed) % 7);
    });
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: 4 }).flatMap((_, approach) =>
    vehicles.map((__, vehicleIndex) => ({
      s: { r: 4, c: approach * 14 + 1 + vehicleIndex * 3 },
      e: { r: 4, c: approach * 14 + 3 + vehicleIndex * 3 },
    })),
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "平日");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["時相圖"]]), "時相圖");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const dir = mkdtempSync(join(tmpdir(), "period-month-"));
const write = (fileName, options) => {
  const path = join(dir, fileName);
  writeFileSync(path, makeWorkbook(options));
  return path;
};
/* 2 月兩站、3 月三站，全部掛 115Q1——使用者實際會遇到的情形。 */
const feb = [1, 2].map((n) =>
  write(`2月_站${n}.xlsx`, {
    dateText: "調查日期：115年02月1" + n + "日 (平日)",
    station: "T88-0" + n,
    name: "二月路口" + n,
    seed: n,
  }),
);
const mar = [3, 4, 5].map((n) =>
  write(`3月_站${n}.xlsx`, {
    dateText: "調查日期：115年03月0" + n + "日 (平日)",
    station: "T88-0" + n,
    name: "三月路口" + n,
    seed: n,
  }),
);

const server = await serve(8171);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:8171/");
await page.waitForTimeout(1200);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};

await go("建立與管理計畫");
await page.locator(".project-form input").nth(0).fill("115-P02");
await page.locator(".project-form input").nth(1).fill("月份顯示測試計畫");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(700);

async function importBatch(paths) {
  await go("季度批次匯入");
  await page.locator('.content label:has-text("調查年度") input').first().fill("115");
  await page.locator('.content label:has-text("季度") select').first().selectOption("1");
  await page.waitForTimeout(400);
  const payload = paths.map((path) => ({
    name: path.split("/").pop(),
    base64: readFileSync(path).toString("base64"),
  }));
  await page.locator(".upload-card").first().evaluate((card, items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      transfer.items.add(
        new File([bytes], item.name, {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
    }
    card.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
  }, payload);
  await page.waitForTimeout(4500);
  await page.locator('button:has-text("確認寫入")').first().click();
  await page.waitForTimeout(3500);
}

/* 分兩批匯入同一季——這正是使用者問的「可以分兩次嗎」。 */
await importBatch(feb);
await importBatch(mar);

const headerQuarterText = async () =>
  (await page.locator("header label:has-text('季度') select").first().innerText())
    .replace(/\s+/g, " ")
    .trim();
const dashboardText = async () => {
  await go("總覽儀表板");
  await page.waitForTimeout(500);
  return (await page.locator(".content").first().innerText()).replace(/\s+/g, " ");
};

const before = await dashboardText();
const written = before.match(/本季調查路口\s*(\d+)\s*處/)?.[1];
ok("分兩批匯入同一季，5 站全部留著（沒有互相覆蓋）", written === "5", `本季調查路口 ${written} 處`);

const toggle = page.locator('[data-testid="period-display-toggle"]');
ok("有期別顯示切換鈕", (await toggle.count()) > 0);
const toggleText = async () =>
  (await toggle.count()) ? (await toggle.first().innerText()).trim() : "（沒有這顆按鈕）";
ok("預設顯示季別", /期別顯示：季別/.test(await toggleText()), await toggleText());
ok("季別模式下季度下拉顯示 115Q1", /115Q1/.test(await headerQuarterText()), await headerQuarterText());

/*
 * 沒有這顆按鈕的舊版也要能跑完，否則下面兩條「畫面上看不看得到月份」的
 * 檢查就量不到——那兩條是兩版都成立的行為證據，不是「新函式不存在」。
 */
if (await toggle.count()) {
  await toggle.first().click();
  await page.waitForTimeout(600);
}
ok("切到「調查月份」", /期別顯示：調查月份/.test(await toggleText()), await toggleText());
const monthText = await headerQuarterText();
ok("季度下拉改成實際調查月份「115年2、3月」", /115年2、3月/.test(monthText), monthText);

/*
 * ── 使用者 2026-09-11 直接問的那一題 ───────────────────────────
 *
 * 「如果我這一季 115Q2 有 4 月和 5 月的調查，原本兩個同時在 115Q2 裡，
 *   我調整成顯示月份後，資料會正常顯示出 4 月和 5 月的調查路段名稱嗎？」
 *
 * 這份測資就是那個情形（2 月兩站、3 月三站，全部掛 115Q1）。
 *
 * ⚠️ 上面那條「切換前後數字完全相同」雖然間接涵蓋了，但**它證明的是
 *   『沒有變』，不是『本來就看得到』**——如果兩個月的路口從頭到尾都沒出現，
 *   那一條照樣全綠。所以這裡直接點名兩個月份的路口名稱都要在畫面上。
 *
 * ⚠️ 同時釘住另一件事：切到月份**不會**把一季拆成兩個期別。
 *   下拉裡只會有一個「115年2、3月」，不會冒出「115年2月」與「115年3月」兩項。
 */
/*
 * ⚠️ 要在**列得出路口名稱的那一頁**量，不能在總覽儀表板量。
 *   2026-09-11 依使用者授權，總覽只留兩張卡（本季調查 N 處、待確認品質項目），
 *   路口名稱已經不在那一頁上了——在總覽量會得到 0 處，
 *   看起來像「切換之後路口不見了」，其實是量錯地方。
 */
await go("各路口尖峰彙總");
const listedIntersections = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    feb: (text.match(/二月路口\d/g) || []).length,
    mar: (text.match(/三月路口\d/g) || []).length,
    splitOptions: [...document.querySelectorAll("option")]
      .map((o) => o.textContent.trim())
      .filter((t) => /^115年[23]月$/.test(t)),
  };
});
ok(
  "切到調查月份之後，2 月與 3 月做的路口名稱都還在畫面上",
  listedIntersections.feb > 0 && listedIntersections.mar > 0,
  `二月路口 ${listedIntersections.feb} 處、三月路口 ${listedIntersections.mar} 處`,
);
/*
 * ── 逐筆的「調查日」欄（v2.1.65）────────────────────────────────
 *
 * 使用者 2026-09-11：「請新增讓我在切換顯示調查月份時，
 *   也能看出哪一個路口／路段是在 X 月做的這項功能。」
 *
 * 期別標籤寫的是整季的合寫（「115年2、3月」），答不了「哪一筆是哪個月」。
 * 這份測資正好是 2 月兩站、3 月三站，所以這一欄必須**同時**出現兩個月份。
 *
 * ⚠️ 只驗「有這一欄」不算數：整欄空白也會過。要驗它真的寫出兩個月份，
 *   而且 2 月與 3 月的筆數與測資相符（2 站與 3 站）。
 */
const surveyDates = await page.evaluate(() => {
  const table = document.querySelector(".table-scroll table");
  if (!table) return { error: "找不到彙總表" };
  const head = [...table.querySelectorAll("thead th")].map((h) =>
    h.textContent.trim(),
  );
  const index = head.indexOf("調查日");
  if (index < 0) return { error: "表頭沒有「調查日」這一欄", head };
  return {
    values: [...table.querySelectorAll("tbody tr")].map((tr) =>
      (tr.children[index]?.textContent || "").trim(),
    ),
  };
});
ok(
  "各路口尖峰彙總有「調查日」這一欄",
  !surveyDates.error,
  failOnly(surveyDates.error + (surveyDates.head ? `（表頭：${surveyDates.head.join("、")}）` : "")),
);
if (!surveyDates.error) {
  const feb = surveyDates.values.filter((t) => /115年2月/.test(t)).length;
  const mar = surveyDates.values.filter((t) => /115年3月/.test(t)).length;
  ok(
    "調查日逐筆寫出實際月份：2 月兩站、3 月三站",
    feb === 2 && mar === 3,
    `2 月 ${feb} 站、3 月 ${mar} 站｜實際值：${surveyDates.values.join(" ／ ")}`,
  );
}

ok(
  "一季不會被拆成兩個期別（下拉裡沒有單獨的「115年2月」「115年3月」）",
  listedIntersections.splitOptions.length === 0,
  failOnly("多出來的選項：" + listedIntersections.splitOptions.join("、")),
);

/* 最重要的一條：切換只換文字，數字一個都不可以動。 */
const after = await dashboardText();
const strip = (text) => text.replace(/115Q1/g, "§").replace(/115年2、3月/g, "§");
ok(
  "切換前後畫面上的數字完全相同（只有期別文字變了）",
  strip(before) === strip(after),
  "差異：" +
    strip(before)
      .split(" ")
      .filter((word, i) => word !== strip(after).split(" ")[i])
      .slice(0, 4)
      .join(" "),
);

/* ── 民國年 ⇄ 西元年顯示切換（v2.1.42） ────────────────────
 *
 * 和期別顯示是兩個獨立的開關：期別切「季別／調查月份」，年份切「民國／西元」。
 * 兩個都只換文字。這裡把年份切到西元之後再量一次同一份畫面：
 * 除了年份那幾個字，每一個數字都必須逐字相同。
 */
const yearToggle = page.locator('[data-testid="year-style-toggle"]');
ok("有年份顯示切換鈕", (await yearToggle.count()) > 0);
const yearToggleText = async () =>
  (await yearToggle.count()) ? (await yearToggle.first().innerText()).trim() : "（沒有這顆按鈕）";
ok("預設顯示民國年", /年份顯示：民國年/.test(await yearToggleText()), await yearToggleText());

/* 先切回季別，才量得到「季度字串本身」換了年份寫法。 */
if (await toggle.count()) {
  await toggle.first().click();
  await page.waitForTimeout(600);
}
const rocText = await dashboardText();
const rocQuarter = await headerQuarterText();
ok("民國年模式下季度下拉是 115Q1", /115Q1/.test(rocQuarter), rocQuarter);

if (await yearToggle.count()) {
  await yearToggle.first().click();
  await page.waitForTimeout(600);
}
ok("切到「西元年」", /年份顯示：西元年/.test(await yearToggleText()), await yearToggleText());
const adQuarter = await headerQuarterText();
ok(
  "季度下拉改成 2026Q1，而且不再出現民國年寫法",
  /2026Q1/.test(adQuarter) && !/115Q1/.test(adQuarter),
  adQuarter,
);
const adText = await dashboardText();
ok(
  "切換年份寫法前後畫面上的數字完全相同（只有年份文字變了）",
  rocText.replaceAll("115Q1", "§") === adText.replaceAll("2026Q1", "§"),
  (() => {
    const a = rocText.replaceAll("115Q1", "§").split(" ");
    const b = adText.replaceAll("2026Q1", "§").split(" ");
    for (let i = 0; i < Math.max(a.length, b.length); i += 1)
      if (a[i] !== b[i]) return `第 ${i + 1} 個詞 ${a[i]} → ${b[i]}`;
    return "完全相同";
  })(),
);
/*
 * ⚠️ 門檻 2026-09-11 由 200 字降到 80 字，而且改成**同時**要求招牌字在裡面。
 *
 * 原因：總覽儀表板依使用者授權從五張卡減成兩張（拿掉最高流量路口、較上季、
 * 待確認品質項目），這一頁的字數實測從 200 多字掉到 155 字，
 * 於是這條「不是拿空白畫面當通過」的前置檢查變成紅的——**功能沒壞，是門檻過期**。
 *
 * 但不可以只把數字改小了事：這條存在的理由是「上面那兩條比對不可以拿兩張
 * 空白畫面比出相同」。所以改成字數＋招牌字兩個條件，
 * 空白畫面仍然過不了，而且以後再減卡片也不會誤紅。
 */
ok(
  "量到的畫面確實有內容（不是拿空白畫面當通過）",
  rocText.length > 80 && /本季調查路口/.test(rocText),
  `${rocText.length} 字${/本季調查路口/.test(rocText) ? "、含招牌字" : "、**沒有**招牌字"}`,
);

/*
 * 全分頁掃一遍。
 *
 * 只量儀表板是不夠的：這一輪就是這樣，儀表板過了，實際上還有五處
 *（頁首標題、各路口組成、跨計畫比較、多路口排名、計畫卡片）沒跟著切換，
 * 畫面上同時出現 2026Q1 與 115Q1。所以切到西元年之後，
 * **任何一個分頁都不可以再看到民國年寫法的季度**。
 */
const NAV_LABELS = await page.evaluate(() =>
  [...document.querySelectorAll("nav button")].map((b) => b.textContent.trim()),
);
ok("抓得到分頁清單（不是掃了 0 個分頁）", NAV_LABELS.length >= 5, NAV_LABELS.join("、"));
const ROC_QUARTER = /(?:^|[^0-9])(\d{2,3})Q[1-4](?![0-9])/;
/*
 * 兩處**刻意**維持民國年寫法，掃描時要先拿掉，否則會永遠紅字：
 *  ・匯入頁的「將存成『115Q1』」——它講的就是「會存成什麼」，
 *    那個值本來就是民國年，跟著顯示切換走反而是錯的。
 *  ・更新說明裡解釋儲存規則的那段文字，本身就在舉「115Q1 與 2026Q1」的例。
 */
const INTENTIONAL_ROC = [
  /將存成「[^」]*」/g,
  /\d{2,3}\s*年第\s*[1-4]\s*季（\d{2,3}Q[1-4]）/g,
  /本批次將寫入 \d{2,3}Q[1-4]/g,
  /確認寫入 \d{2,3}Q[1-4]/g,
];
/*
 * 這兩頁整頁都是說明文字（更新說明、操作手冊），內文本來就在舉
 *「115Q1 與 2026Q1」當例子解釋儲存規則，不是資料顯示，整頁跳過。
 */
const DOC_PAGES = ["備份", "手冊"];
const leftovers = [];
for (const label of NAV_LABELS) {
  if (DOC_PAGES.some((word) => label.includes(word))) continue;
  await go(label);
  let text = (await page.locator(".content").first().innerText()).replace(/\s+/g, " ");
  for (const pattern of INTENTIONAL_ROC) text = text.replace(pattern, "〔說明文字〕");
  const hit = text.match(ROC_QUARTER);
  if (hit) leftovers.push(`${label}：…${text.slice(Math.max(0, hit.index - 20), hit.index + 20)}…`);
}
ok(
  "切成西元年之後，每一個分頁都看不到民國年寫法的季度",
  leftovers.length === 0,
  leftovers.slice(0, 3).join("  ｜  "),
);
/* 掃描本身要有效：至少要真的掃過大部分分頁，不能因為條件寫錯而全部跳過。 */
ok(
  "掃描確實跑過大部分分頁",
  NAV_LABELS.filter((label) => !DOC_PAGES.some((w) => label.includes(w))).length >= 10,
);
await go("總覽儀表板");

/* 兩個開關可以同時開：西元年 + 調查月份 */
if (await toggle.count()) {
  await toggle.first().click();
  await page.waitForTimeout(600);
}
const bothText = await headerQuarterText();
ok(
  "西元年 + 調查月份會顯示「2026年2、3月」",
  /2026年2、3月/.test(bothText),
  bothText,
);

/* 切回民國年，畫面要完全回到原樣 */
if (await yearToggle.count()) {
  await yearToggle.first().click();
  await page.waitForTimeout(600);
}
if (await toggle.count()) {
  await toggle.first().click();
  await page.waitForTimeout(600);
}
ok(
  "兩個開關都切回原位後，畫面與一開始逐字相同",
  (await dashboardText()) === rocText,
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
await server.close?.();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
