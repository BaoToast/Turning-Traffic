/*
 * 端對端：使用者以為沒匯入成功、又把同一批檔案匯一次，系統要擋得住。
 *
 * 起因是使用者的顧慮（原話）：
 *   「我怕如果使用者誤以為沒匯入到資料，然後重複匯入相同資料，
 *     系統卻沒有阻止，這樣才是異常。」
 *
 * 所以這一支不驗畫面漂不漂亮，只驗三件事：
 *
 *  一、匯入期間按鈕與檔案欄要真的停用。
 *      注意：主執行緒被解析佔住時，使用者的點擊會排隊，**解析結束後才送達**。
 *      如果那時候按鈕已經恢復可按，那一下就會真的觸發第二次匯入。
 *      所以要模擬「解析中連點」，而不是只看 disabled 屬性。
 *
 *  二、同一批檔案匯第二次，路口數與紀錄數**不可以翻倍**。
 *      這是最關鍵的一項：翻倍代表同一份調查被算了兩次，
 *      而總量守恆的檢查抓不到（兩份都是合法資料）。
 *
 *  三、第二次匯入時，畫面要**明講**這批是既有資料。
 *      靜靜覆蓋跟靜靜重複一樣糟——使用者無從得知自己按對了還是按錯了。
 */
import { chromium } from "playwright";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";



/* 與 e2e-progress.mjs 相同的匿名版型，不含任何真實調查資料。 */
function makeWorkbook({ sheetName, dateText, station, name }) {
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
        rows[6 + rowIndex][base + column] = 1 + ((approach + column + rowIndex) % 7);
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
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["監測日誌"], ["監測日期", "115年04月15日"]]),
    "監測日誌",
  );
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["時相圖"]]), "時相圖");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

/*
 * 份數要夠多，解析才會佔住主執行緒夠久，讓「解析中送出真實點擊」這件事
 * 真的發生在解析期間。3 份小檔只忙約 60ms，點擊幾乎一定落在解析之後，
 * 那一項就變成沒有意義的檢查。
 */
const TOTAL = 12;
const dir = mkdtempSync(join(tmpdir(), "reimport-"));
const payload = [];
for (let i = 1; i <= TOTAL; i += 1) {
  const fileName = `120507T5${String(i).padStart(2, "0")}重匯測試路口${i}0415_平日.xlsx`;
  const path = join(dir, fileName);
  writeFileSync(
    path,
    makeWorkbook({
      sheetName: "平日",
      dateText: "日期：115年04月15日",
      station: `12507T5-${String(i).padStart(2, "0")}`,
      name: `重匯測試路口${i}`,
    }),
  );
  payload.push({
    name: fileName,
    base64: readFileSync(path).toString("base64"),
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(8176);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
/* v2.1.53：資料改存 IndexedDB，端對端腳本要用 __readState／__writeState 才讀得到。 */
await installStateHelpers(page);
await page.goto("http://localhost:8176/");
await page.waitForTimeout(1500);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};

await go("建立與管理計畫");
await page.locator(".project-form input").nth(0).fill("115-REIMPORT");
await page.locator(".project-form input").nth(1).fill("重複匯入測試計畫");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(700);

await go("季度批次匯入");
await page.locator('.content label:has-text("調查年度") input').first().fill("115");
await page.locator('.content label:has-text("季度") select').first().selectOption("2");
await page.waitForTimeout(400);

/*
 * 把一批檔案丟進上傳卡片。刻意**不**在同一個 evaluate 裡等它跑完——
 * 要在解析進行中從外面送真實滑鼠點擊，evaluate 一路 block 就沒機會了。
 */
const startDrop = async () => {
  await page.evaluate(
    ({ payload }) => {
      const zone = document.querySelector(".upload-card");
      const transfer = new DataTransfer();
      for (const item of payload) {
        const binary = atob(item.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        transfer.items.add(new File([bytes], item.name, { type: item.type }));
      }
      window.__probe = { samples: 0, disabled: 0 };
      window.__timer = setInterval(() => {
        const button = document.querySelector(".upload-card button");
        if (!button) return;
        window.__probe.samples += 1;
        if (button.disabled) window.__probe.disabled += 1;
      }, 10);
      zone.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    },
    { payload },
  );
};
const finishDrop = async () => {
  await page.waitForTimeout(9000);
  return page.evaluate(() => {
    clearInterval(window.__timer);
    return window.__probe;
  });
};

/*
 * ⚠️ 這一段原本寫成「解析中對按鈕呼叫 click()，驗證觸發次數為 0」。
 *    那是**恆真的假檢查**：依 HTML 規範，停用中的表單控制項呼叫 click()
 *    本來就不會派送事件，量到 0 跟程式寫得對不對完全無關。
 *    實測佐證：對一顆與本系統無關的空白按鈕做同樣的事，停用時 0 次、
 *    啟用時 5 次——原本那三項斷言只是把「曾經觀察到 disabled」講了三遍。
 *
 *    改成送**真正的滑鼠點擊**（走瀏覽器的輸入佇列，跟使用者按下去同一條路），
 *    再看檔案對話框有沒有被叫出來：按鈕真的停用 → 不會有對話框；
 *    有人把 disabled 拿掉 → 對話框會冒出來，這一項就會紅。
 */
const clickWhileBusy = async () => {
  /* 先等到真的觀察到按鈕停用，再送點擊——否則點擊可能落在解析開始前或結束後 */
  let sawDisabled = false;
  for (let i = 0; i < 400; i += 1) {
    sawDisabled = await page
      .evaluate(() => {
        const b = document.querySelector(".upload-card button");
        return Boolean(b && b.disabled);
      })
      .catch(() => false);
    if (sawDisabled) break;
    await page.waitForTimeout(25);
  }
  const box = await page
    .locator(".upload-card button")
    .first()
    .boundingBox()
    .catch(() => null);
  if (!box) return { located: false, sawDisabled, chooser: false };
  let chooser = false;
  const onChooser = (fc) => {
    chooser = true;
    fc.setFiles([]).catch(() => {});
  };
  page.on("filechooser", onChooser);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(2500);
  page.off("filechooser", onChooser);
  return { located: true, sawDisabled, chooser };
};

/* ── 第一次匯入 ── */
await startDrop();
/* 解析進行中就送出真實點擊 */
const busyClick = await clickWhileBusy();
const firstDrop = await finishDrop();
ok(
  "解析期間按鈕確實停用（不是只有文字變）",
  firstDrop.disabled > 0,
  `取樣 ${firstDrop.samples} 次、停用 ${firstDrop.disabled} 次`,
);
ok(
  "前置：點擊確實送在「按鈕停用中」的那段時間裡",
  busyClick.located && busyClick.sawDisabled,
  busyClick.sawDisabled
    ? "已在停用期間送出真實滑鼠點擊"
    : "整段都沒觀察到停用，下一項會變成沒有意義的檢查",
);
ok(
  "解析中用真實滑鼠點按鈕，不會叫出檔案對話框（＝無法開始第二次匯入）",
  busyClick.located && !busyClick.chooser,
  busyClick.chooser ? "對話框被叫出來了" : "沒有對話框",
);

/*
 * 預覽表格沒有專屬 class，用「表格列裡出現測試檔名」來數才不會誤判。
 * 前置也要驗：數不到就代表選擇器壞了，而不是程式沒跑出預覽。
 */
const previewCount = await page.evaluate(() =>
  [...document.querySelectorAll(".content table tbody tr")].filter((tr) =>
    /重匯測試路口/.test(tr.textContent || ""),
  ).length,
);
ok("第一次匯入有跑出預覽", previewCount === TOTAL, `預覽 ${previewCount} 列／共 ${TOTAL} 份`);

/* 寫入第一批 */
await page.locator('button:has-text("確認寫入"), button:has-text("寫入")').first().click();
await page.waitForTimeout(2500);

const countState = async () =>
  page.evaluate(async () => {
    try {
      const raw = await window.__readState();
      if (!raw) return { records: 0, stations: 0 };
      const state = JSON.parse(raw);
      const records = Array.isArray(state.records) ? state.records : [];
      return {
        records: records.length,
        stations: new Set(records.map((r) => r.station || r.stationId || "")).size,
      };
    } catch (error) {
      return { records: -1, stations: -1, error: String(error) };
    }
  });

const afterFirst = await countState();
ok(
  "第一次寫入之後確實有資料",
  afterFirst.records > 0,
  `紀錄 ${afterFirst.records} 筆、站數 ${afterFirst.stations}`,
);

/* ── 第二次：一模一樣的檔案再匯一次 ── */
await go("季度批次匯入");
await page.locator('.content label:has-text("調查年度") input').first().fill("115");
await page.locator('.content label:has-text("季度") select').first().selectOption("2");
await page.waitForTimeout(400);
await startDrop();
await finishDrop();

/* 第二次的預覽畫面上，要看得到「這批已經有了」這件事 */
const previewText = await page.evaluate(() => document.querySelector(".content")?.innerText || "");
ok(
  "第二次匯入時，畫面有明講這批是既有資料（覆蓋／已存在／新版本）",
  /覆蓋|已存在|既有|重複|新版本|沿用/.test(previewText),
  previewText
    .split("\n")
    .filter((line) => /覆蓋|已存在|既有|重複|新版本|沿用/.test(line))
    .slice(0, 3)
    .join(" ｜ ") || "預覽畫面完全沒有提到",
);

await page.locator('button:has-text("確認寫入"), button:has-text("寫入")').first().click();
await page.waitForTimeout(2500);

const afterSecond = await countState();
ok(
  "同一批檔案匯第二次，紀錄數不可以翻倍",
  afterSecond.records <= afterFirst.records,
  `第一次 ${afterFirst.records} 筆 → 第二次 ${afterSecond.records} 筆`,
);
ok(
  "同一批檔案匯第二次，路口數不可以增加",
  afterSecond.stations <= afterFirst.stations,
  `第一次 ${afterFirst.stations} 個 → 第二次 ${afterSecond.stations} 個`,
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
await server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
