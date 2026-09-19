/*
 * 端對端：按過「全部先保留（不記住）」之後，匯入**別的路口**不可以把舊的
 * 未答項目再抓出來問一次。
 *
 * ── 這支腳本在守什麼 ────────────────────────────────────────
 * 裁決視窗有兩顆按鈕：
 *   「套用並記住」    → 記下答案，之後不再問（這條路徑早就有守門）
 *   「全部先保留（不記住）」→ 這次先保留、不記答案，下次匯入同一個路口再問
 *
 * v2.1.56 的第二顆按鈕只做了 setPresenceQuestions([])，**沒有清掉流向上的
 * presence: "unknown" 標記**，那個標記會一路存進資料與備份。
 * 而組題目的那段是掃**全部紀錄**找 presence === "unknown"：
 *
 *     const questions = next.flatMap(function (record) { ...
 *       return (record.routes ?? []).filter((route) => route.presence === "unknown")
 *
 * 不是只掃這次匯入的那幾筆。所以按過一次「全部先保留」之後，
 * 之後匯入**任何一個完全無關的路口**，那些舊的未答項目都會被再抓出來問一次，
 * 而且每匯入一次就問一次——正是使用者在另一支系統抱怨過的
 *「設定過了每一季還是跳出來」那種毛病。
 *
 * ⚠️ 假通過陷阱（這支刻意迴避的）：
 *  一、只驗「第二次匯入不跳視窗」不夠——把視窗改成永遠不跳也會過。
 *      所以第一輪一定要先驗**它有跳**。
 *  二、清掉標記不可以順便把「該問的還是要問」一起弄丟：
 *      重新匯入**同一個**留空白的路口時，系統要依調查表欄位重新判定、
 *      再問一次。所以第三輪要驗它**又跳出來了**。
 *  三、不用真實調查檔（真實檔不得進交付包），用匿名活頁簿。
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { readState } from "./read-state.mjs";

const PORT = 8247;

/**
 * 匿名三岔／四岔活頁簿。
 * blankMovement：哪一個轉向整欄**留空白**（既不是數字也不是 `--`）——
 * 這是唯一分不出來、會跳裁決視窗的情況。
 */
function makeWorkbook({ arms, station, name, blanks = {}, blankMovement = {} }) {
  const width = 14;
  const rows = Array.from({ length: 12 }, () => Array(arms * width).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  for (let approach = 0; approach < arms; approach += 1) {
    const base = approach * width;
    const code = String.fromCharCode(65 + approach);
    rows[1][base] = "站號：" + station;
    rows[1][base + 4] = "日期：115年04月15日";
    rows[2][base] = "站名：" + name;
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
      vehicles.forEach((_, vehicleIndex) => {
        movements.forEach((movement, movementIndex) => {
          const column = base + 1 + vehicleIndex * 3 + movementIndex;
          if (blankMovement[code] === movement) {
            rows[6 + rowIndex][column] = null;
            return;
          }
          rows[6 + rowIndex][column] =
            blanks[code] === movement
              ? "--"
              : 1 + ((approach + vehicleIndex + movementIndex + rowIndex) % 7);
        });
      });
    });
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: arms }).flatMap((_, approach) =>
    vehicles.map((__, vehicleIndex) => ({
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

/* 三岔、三個不存在的轉向都**留空白** → 匯入後會跳三題。 */
const blankFile = {
  name: "A00T00-11三岔留空白路口.xlsx",
  buffer: makeWorkbook({
    arms: 3,
    station: "A00T00-11",
    name: "三岔留空白路口",
    blankMovement: { A: "右轉", B: "直進", C: "左轉" },
  }),
};
/* 四岔、完全正常（沒有橫線也沒有空白）→ 這一份自己絕對不該引發任何提問。 */
const cleanFile = {
  name: "A00T00-12四岔正常路口.xlsx",
  buffer: makeWorkbook({
    arms: 4,
    station: "A00T00-12",
    name: "四岔正常路口",
  }),
};

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(PORT);
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
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};

await go("建立與管理計畫");
await page.locator(".project-form input").nth(0).fill("A00-KEEP");
await page.locator(".project-form input").nth(1).fill("先保留示範計畫");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(700);

async function importFiles(quarterOption, payloadFiles) {
  await go("季度批次匯入");
  await page
    .locator('.content label:has-text("調查年度") input')
    .first()
    .fill("115");
  await page
    .locator('.content label:has-text("季度") select')
    .first()
    .selectOption(quarterOption);
  await page.waitForTimeout(400);
  await page.evaluate(
    (payload) => {
      const zone = document.querySelector(".upload-card");
      const transfer = new DataTransfer();
      for (const item of payload) {
        const binary = atob(item.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1)
          bytes[i] = binary.charCodeAt(i);
        transfer.items.add(new File([bytes], item.name));
      }
      zone.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    },
    payloadFiles.map((file) => ({
      name: file.name,
      base64: file.buffer.toString("base64"),
    })),
  );
  for (let wait = 0; wait < 90; wait += 1) {
    await page.waitForTimeout(400);
    const button = page.locator('button:has-text("確認寫入")').first();
    if ((await button.count()) && (await button.isEnabled())) break;
  }
  const commit = page.locator('button:has-text("確認寫入")').first();
  if (!(await commit.count())) return false;
  await commit.click();
  await page.waitForTimeout(5000);
  return true;
}

/* ── 第一輪：留空白的檔案進來，視窗要跳，然後按「全部先保留」 ── */
ok("前置：第一輪匯入完成", await importFiles("1", [blankFile]));
ok(
  "第一輪：留空白的檔案要跳出裁決視窗",
  (await page.locator(".presence-modal").count()) > 0,
);
const keepButton = page.locator(
  '.presence-actions button:has-text("全部先保留")',
);
ok("第一輪：視窗上有「全部先保留（不記住）」可以按", (await keepButton.count()) > 0);
if (await keepButton.count()) {
  await keepButton.first().click();
  await page.waitForTimeout(2500);
}
ok(
  "第一輪：按下之後視窗要關掉",
  (await page.locator(".presence-modal").count()) === 0,
);

const afterKeep = await readState(page);
const keptRecord = (afterKeep?.records ?? []).find((record) =>
  record.station.endsWith("00-11"),
);
ok(
  "第一輪：三條流向都要保留下來（9 條，不是 6 條）",
  (keptRecord?.routes ?? []).length === 9,
  `實際 ${(keptRecord?.routes ?? []).length} 條`,
);
ok(
  "第一輪：不記住答案（movementPresence 要是空的）",
  Object.keys(afterKeep?.movementPresence ?? {}).length === 0,
  `記住 ${Object.keys(afterKeep?.movementPresence ?? {}).length} 筆`,
);
/*
 * 這一項是本支腳本的核心：按下「全部先保留」之後，
 * 流向上不可以留著 presence: "unknown" 的殘留標記。
 */
ok(
  "第一輪：按下「全部先保留」之後不可以留下 presence: unknown 殘留",
  (keptRecord?.routes ?? []).every((route) => !route.presence),
  `殘留 ${(keptRecord?.routes ?? []).filter((route) => route.presence).length} 條`,
);

/* ── 第二輪：匯入一個完全無關、本身毫無疑問的四岔路口 ── */
ok("前置：第二輪匯入完成", await importFiles("2", [cleanFile]));
ok(
  "第二輪：匯入一個無關的正常路口，不可以把上一輪的未答項目再抓出來問",
  (await page.locator(".presence-modal").count()) === 0,
  "視窗又跳出來了＝舊的 unknown 殘留被重新抓進題目",
);
if (await page.locator(".presence-modal").count()) {
  /* 跳出來的話要收掉，否則後面的操作會被擋住。 */
  await page
    .locator('.presence-actions button:has-text("全部先保留")')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(1500);
}
const afterClean = await readState(page);
const cleanRecord = (afterClean?.records ?? []).find((record) =>
  record.station.endsWith("00-12"),
);
ok(
  "第二輪：正常四岔路口本來就是 12 條流向",
  (cleanRecord?.routes ?? []).length === 12,
  `實際 ${(cleanRecord?.routes ?? []).length} 條`,
);

/* ── 第三輪：再匯入**同一個**留空白的路口，這次必須要再問一次 ── */
ok("前置：第三輪匯入完成", await importFiles("3", [blankFile]));
ok(
  "第三輪：重新匯入同一個留空白的路口，仍然要再問一次（不可以改成永遠不問）",
  (await page.locator(".presence-modal").count()) > 0,
  "沒有跳＝把該問的也一起弄丟了",
);

ok(
  "整段流程不可以留下未捕捉的例外",
  errors.length === 0,
  errors.slice(0, 2).join(" | "),
);

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
