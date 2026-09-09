/*
 * 端對端：三岔路口不可以列出「重複而且一輛都沒有」的流向。
 *
 * 起因（實測，v2.1.52，用三份真實三岔調查檔）：
 *   三岔路口的調查表每一支支線一定有一欄整欄寫 `--`
 *   （A 沒有右轉、B 沒有直進、C 沒有左轉），欄位卻照樣排出來；
 *   而三岔只有兩個去向，三個轉向硬要對到兩支目的支線，
 *   movementTargetIndex 必然讓兩個轉向解到同一支。
 *   結果：9 條流向裡有 3 條「from→to 與別人重複、整份調查一輛都沒有」的空列。
 *   使用者回報的「路口A 駛往 路口B 和 路口C，重複出現一個路口」就是這個。
 *
 *   數字本身沒有被重複計算（實測路線合計＝支線合計，差 0），
 *   壞的是畫面：看起來像同一條流向被列了兩次。
 *
 * ⚠️ 假通過陷阱三個：
 *  一、只驗「流向數＝6」不夠——把流向砍成任何 6 條都會過。要同時驗
 *      **總量沒有變**（路線合計＝支線合計），否則刪錯了也看不出來。
 *  二、只驗三岔不夠——把「全零就刪」寫成無條件規則，四岔路口真的整天
 *      量到 0 的轉向也會被刪掉。所以同一支腳本一定要**同時驗四岔仍然是
 *      12 條**，而且刻意讓四岔其中一欄整欄為 0。
 *  三、這裡不用真實調查檔（真實檔不可以進交付包），用的是與真實版型
 *      相同、數字自己編的匿名活頁簿。
 *  四、v2.1.54 起判斷依據改成「調查表原本寫 `--` 還是寫 0」，不再靠
 *      「全為 0 而且起訖重複」推論。所以另外加了第三份對照檔：
 *      **三岔路口，但其中一個真的存在的轉向整天量到 0**。
 *      這一份是最容易被誤刪的形狀——它同時具備「三岔」與「全為 0」，
 *      只有看得懂 `--` 與 0 的差別才會留下它。
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { readState } from "./read-state.mjs";

const PORT = 8243;

/*
 * 與真實三岔／四岔版型相同的匿名活頁簿。
 * blanks：哪一支支線的哪一個轉向整欄寫 `--`（真實三岔檔就是這樣）。
 */
function makeWorkbook({ arms, station, name, blanks = {} }) {
  const width = 14;
  const rows = Array.from({ length: 12 }, () => Array(arms * width).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  for (let approach = 0; approach < arms; approach++) {
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

/*
 * 第三種對照組：**三岔路口，但其中一個真的存在的轉向整天量到 0**。
 * 這一份是用來釘住「不可以憑全為 0 就刪」——真實檔實測，四岔與七岔各有
 * 6～9 欄是真的整天量到 0（後昌路－宏毅二路假日 9 欄、七叉路口A 9 欄）。
 * 這裡把它壓縮成最小重現：A 沒有右轉（寫 `--`），而 B 的右轉整欄是真的 0。
 */
function makeThreeArmWithRealZero({ station, name }) {
  const width = 14;
  const arms = 3;
  const rows = Array.from({ length: 12 }, () => Array(arms * width).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  /*
   * B 缺直進、C 缺左轉（寫 `--`）；A 三個轉向**都存在**，但右轉整天是真的 0。
   *
   * A 的右轉刻意挑成「會與 A 的直進解到同一支目的支線」的那一個——
   * 也就是說它同時滿足「整份為 0」與「起訖與一條有流量的重複」。
   * 舊版（v2.1.53）用這兩個條件推論，會把它**誤刪**；
   * 看得懂 `--` 與 0 的差別才留得住它。
   */
  const blanks = { B: "直進", C: "左轉" };
  for (let approach = 0; approach < arms; approach++) {
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
          if (blanks[code] === movement) {
            rows[6 + rowIndex][column] = "--";
          } else if (code === "A" && movement === "右轉") {
            /* 真的量到 0：有量測、整天沒有車。不是 `--`。 */
            rows[6 + rowIndex][column] = 0;
          } else {
            rows[6 + rowIndex][column] =
              1 + ((approach + vehicleIndex + movementIndex + rowIndex) % 7);
          }
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

/*
 * 四岔的對照組刻意讓「路口D 的左轉」整欄是**真的 0**（不是 `--`）。
 * 這一欄有量測、只是整天沒有車，絕對不可以被當成不存在而刪掉。
 */
/*
 * 第四種對照組：三岔路口，但不存在的轉向**留空白**（既不是數字、也不是 `--`）。
 *
 * 這是唯一分不出來的情況：調查表沒填，系統無從判斷是「沒有這個轉向」
 * 還是「漏填」。實測 73 份轉向版型的調查檔裡有 1 份真的長這樣。
 * 規則是**一律保留**（保留最多只是多一列 0，刪掉卻可能弄丟真實流向），
 * 但要在匯入提醒裡講出來，讓使用者自己決定。
 */
function makeThreeArmBlank({ station, name }) {
  const width = 14;
  const arms = 3;
  const rows = Array.from({ length: 12 }, () => Array(arms * width).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  const blanks = { A: "右轉", B: "直進", C: "左轉" };
  for (let approach = 0; approach < arms; approach++) {
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
          /* 不存在的轉向這次留空白，不寫 `--` */
          rows[6 + rowIndex][column] =
            blanks[code] === movement
              ? null
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

/*
 * 第五種對照組：**四岔路口，其中一個轉向整欄畫 `--`**（禁止轉向／單行道）。
 *
 * 為什麼要有這一份：四岔的三個轉向本來就各自對應一個真實去向
 *（實測 movementTargetIndex 對 4～7 岔都是一對一，不會撞在一起），
 * 所以四岔會出現 `--` 的原因跟三岔完全不同——三岔是版面上多印的空欄，
 * 四岔則通常是**這個路口真的禁止這個轉向**，是實際的管制資訊。
 *
 * v2.1.56 的過濾是一視同仁的：只要整欄畫橫線就直接濾掉，而且是一個沒有
 * 任何提示的 `.filter()`。四岔碰到這種檔案會**安靜少掉一條流向**，
 * 使用者不會收到任何訊息。本版改成列進裁決視窗。
 *
 * ⚠️ 假通過陷阱：不可以只驗「視窗有列出它」——把所有橫線都改成發問也會過，
 *    那會讓三岔每一季匯入都跳三題（正是使用者抱怨過的每季煩擾）。
 *    所以同一支腳本必須同時驗**三岔的橫線不進視窗**。
 */
function makeFourArm({ station, name, bannedTurn = null }) {
  const width = 14;
  const arms = 4;
  const rows = Array.from({ length: 12 }, () => Array(arms * width).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  for (let approach = 0; approach < arms; approach++) {
    const base = approach * width;
    rows[1][base] = "站號：" + station;
    rows[1][base + 4] = "日期：115年04月15日";
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
      vehicles.forEach((_, vehicleIndex) => {
        movements.forEach((movement, movementIndex) => {
          const column = base + 1 + vehicleIndex * 3 + movementIndex;
          const code = String.fromCharCode(65 + approach);
          if (bannedTurn && bannedTurn.arm === code && bannedTurn.movement === movement) {
            /* 禁止轉向／單行道：調查員整欄畫橫線 */
            rows[6 + rowIndex][column] = "--";
            return;
          }
          /* 路口D（index 3）的左轉整欄是真的 0 */
          rows[6 + rowIndex][column] =
            approach === 3 && movementIndex === 0
              ? 0
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

const files = [
  {
    name: "A00T00-01三岔示範路口.xlsx",
    buffer: makeWorkbook({
      arms: 3,
      station: "A00T00-01",
      name: "三岔示範路口",
      /* 真實三岔檔就是這個組合：A 無右轉、B 無直進、C 無左轉 */
      blanks: { A: "右轉", B: "直進", C: "左轉" },
    }),
  },
  {
    name: "A00T00-02四岔示範路口.xlsx",
    buffer: makeFourArm({ station: "A00T00-02", name: "四岔示範路口" }),
  },
  {
    name: "A00T00-04三岔留空白路口.xlsx",
    buffer: makeThreeArmBlank({
      station: "A00T00-04",
      name: "三岔留空白路口",
    }),
  },
  {
    name: "A00T00-03三岔含真實零流量路口.xlsx",
    buffer: makeThreeArmWithRealZero({
      station: "A00T00-03",
      name: "三岔含真實零流量路口",
    }),
  },
  {
    name: "A00T00-05四岔禁止轉向路口.xlsx",
    buffer: makeFourArm({
      station: "A00T00-05",
      name: "四岔禁止轉向路口",
      /* 路口A 禁止左轉：四岔預期 0 個橫線，這一個就是超出預期 */
      bannedTurn: { arm: "A", movement: "左轉" },
    }),
  },
];

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};

await go("多計畫管理");
await page.locator(".project-form input").nth(0).fill("A00-ARM");
await page.locator(".project-form input").nth(1).fill("岔路數示範計畫");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(700);
await go("季度批次匯入");
await page.locator('.content label:has-text("調查年度") input').first().fill("115");
await page.locator('.content label:has-text("季度") select').first().selectOption("2");
await page.waitForTimeout(400);

/*
 * 四份一次拖進去，模擬真實的季度批次匯入（使用者本來就是一次選一整季）。
 * 一次匯入 → 一次「確認寫入」→ 裁決視窗只會跳一次。
 */
await page.evaluate((payload) => {
  const zone = document.querySelector(".upload-card");
  const transfer = new DataTransfer();
  for (const item of payload) {
    const binary = atob(item.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    transfer.items.add(
      new File([bytes], item.name, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
  }
  zone.dispatchEvent(
    new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
}, files.map((file) => ({ name: file.name, base64: file.buffer.toString("base64") })));

for (let wait = 0; wait < 90; wait += 1) {
  await page.waitForTimeout(400);
  const button = page.locator('button:has-text("確認寫入")').first();
  if ((await button.count()) && (await button.isEnabled())) break;
}
const commitButton = page.locator('button:has-text("確認寫入")').first();
ok("前置：五份解析完成後出現「確認寫入」", (await commitButton.count()) > 0);
if (await commitButton.count()) {
  await commitButton.click();
  await page.waitForTimeout(5000);
}

/*
 * ── 「分不出來」的裁決視窗 ──────────────────────────────
 * 第四份檔（三岔留空白）匯入後應該跳出視窗。這一段要驗三件事：
 *  一、視窗真的跳出來，而且只列「留空白」那 3 個轉向
 *      （寫 `--` 的、寫數字的都不該出現在裡面）
 *  二、在按下視窗之前，流向先全部保留（9 條，不是 6 條）
 *  三、選「沒有這個轉向」按下「套用並記住」之後，流向真的被移除，
 *      而且總量不變
 */
const dialog = page.locator(".presence-modal");
ok("留空白的檔案匯入後要跳出裁決視窗", (await dialog.count()) > 0);
if (await dialog.count()) {
  const rowCount = await page.locator(".presence-list article").count();
  /*
   * 應該列 4 條：三岔留空白的 3 條（分不出來），加四岔禁止左轉的 1 條
   *（畫了橫線、但橫線數超出四岔的算術預期）。
   * 三岔那三個「照預期畫的」橫線**不可以**列進來——列進去就變成每季煩擾。
   */
  ok(
    "視窗要列出 4 條：3 條整欄空白 ＋ 1 條四岔超出預期的橫線",
    rowCount === 4,
    `實際列出 ${rowCount} 個`,
  );
  const dialogText = (await dialog.innerText()).replace(/\s+/g, " ");
  ok(
    "視窗要說明兩種寫法的差別",
    /0.*整天沒有車/.test(dialogText) && /--.*根本沒有這個轉向/.test(dialogText),
    dialogText.slice(0, 80),
  );
  ok(
    "視窗要說明答過一次就記住",
    /答過一次就會記住/.test(dialogText),
  );
  /* ── A：算術核對要看得見 ── */
  ok(
    "整欄空白那幾條要附上算術依據（不能只給結論）",
    /系統建議/.test(dialogText) && /照算術應該有/.test(dialogText),
    dialogText.slice(0, 120),
  );
  /* ── B：四岔的橫線要講清楚它為什麼被拿出來問 ── */
  ok(
    "四岔的橫線要說明可能是禁止轉向或單行道",
    /禁止轉向/.test(dialogText) && /單行道/.test(dialogText),
  );
  ok(
    "四岔那一條要標明調查表上是畫了橫線，不是空白",
    /調查表寫：--（有畫橫線）/.test(dialogText),
  );
  /*
   * 預設選項：四岔那條預設「移除」＝與 v2.1.56 結果相同（本版不改變既有結果），
   * 三岔留空白那三條因為算術指得出來，預設也是「移除」。
   * 四條都預設移除，所以預設被勾起來的「沒有這個轉向」應該是 4 個。
   */
  const preselected = await page
    .locator('.presence-choice label:has-text("沒有這個轉向") input:checked')
    .count();
  ok(
    "預設選項要等於系統建議（4 條都預設「沒有這個轉向」）",
    preselected === 4,
    `實際預設勾了 ${preselected} 個`,
  );
}

/* 按視窗之前，先確認流向是「全部保留」的狀態 */
const beforeState = await readState(page);
const beforeBlank = (beforeState?.records ?? []).find(
  (record) => record.approaches.length === 3 && record.station.endsWith("00-04"),
);
ok(
  "裁決之前一律先保留（9 條，不是 6 條）",
  (beforeBlank?.routes ?? []).length === 9,
  `實際 ${(beforeBlank?.routes ?? []).length} 條`,
);
ok(
  "裁決之前這些流向要標成 presence: unknown",
  (beforeBlank?.routes ?? []).filter((route) => route.presence === "unknown")
    .length === 3,
  `標記數 ${(beforeBlank?.routes ?? []).filter((r) => r.presence === "unknown").length}`,
);

/* 三個都選「沒有這個轉向」，然後套用 */
if (await dialog.count()) {
  const noRadios = page.locator('.presence-choice label:has-text("沒有這個轉向") input');
  const total = await noRadios.count();
  for (let index = 0; index < total; index += 1) await noRadios.nth(index).check();
  await page.locator('.presence-actions button:has-text("套用並記住")').click();
  await page.waitForTimeout(3000);
}
ok("套用之後視窗要關掉", (await page.locator(".presence-modal").count()) === 0);

const state = await readState(page);
const records = state?.records ?? [];
ok("前置：五份示範檔都寫進去了", records.length === 5, `實際 ${records.length} 筆`);

const analyse = (record) => {
  const code = (id) => record.approaches.find((a) => a.id === id)?.sourceCode ?? "?";
  const pairs = new Map();
  for (const route of record.routes) {
    const key = `${code(route.fromApproachId)}→${code(route.toApproachId)}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  const scopes = ["AM", "PM", "DAY", "FULL"];
  const routeTotal = record.routes.reduce(
    (sum, route) =>
      sum +
      Object.values(route.volumes?.AM?.vehicle ?? {}).reduce(
        (a, b) => a + (Number(b) || 0),
        0,
      ),
    0,
  );
  const approachTotal = record.approaches.reduce(
    (sum, approach) => sum + (Number(approach.movements?.AM?.rawVehicleTotal) || 0),
    0,
  );
  const allZero = record.routes.filter((route) =>
    scopes.every(
      (scope) =>
        Object.values(route.volumes?.[scope]?.vehicle ?? {}).reduce(
          (a, b) => a + (Number(b) || 0),
          0,
        ) === 0,
    ),
  ).length;
  return {
    arms: record.approaches.length,
    routes: record.routes.length,
    duplicates: [...pairs].filter(([, n]) => n > 1),
    routeTotal,
    approachTotal,
    allZero,
  };
};

const three = records.find(
  (record) => record.approaches.length === 3 && record.station.endsWith("00-01"),
);
/* 站號要指名道姓：現在有兩份四岔檔，只用 approaches.length 會抓錯。 */
const four = records.find(
  (record) => record.approaches.length === 4 && record.station.endsWith("00-02"),
);
const fourBanned = records.find(
  (record) => record.approaches.length === 4 && record.station.endsWith("00-05"),
);

if (three) {
  const info = analyse(three);
  ok(
    "三岔路口只列 6 條流向（3 支 × 2 個去向），不是 9 條",
    info.routes === 6,
    `實際 ${info.routes} 條`,
  );
  ok(
    "三岔路口不可以有重複的 from→to",
    info.duplicates.length === 0,
    info.duplicates.map(([k, n]) => `${k}×${n}`).join(" ") || "沒有重複",
  );
  ok(
    "三岔路口不可以留下整份調查皆為零的流向",
    info.allZero === 0,
    `全零 ${info.allZero} 條`,
  );
  ok(
    "三岔路口：拿掉空流向之後總量不變（路線合計＝支線合計）",
    info.routeTotal === info.approachTotal && info.routeTotal > 0,
    `路線 ${info.routeTotal}／支線 ${info.approachTotal}`,
  );
} else {
  ok("前置：找得到三岔路口那一筆", false, "沒有三支支線的紀錄");
}

if (four) {
  const info = analyse(four);
  ok(
    "四岔路口仍然是 12 條流向（真的整天量到 0 的轉向不可以被刪掉）",
    info.routes === 12,
    `實際 ${info.routes} 條`,
  );
  ok(
    "四岔路口本來就不會有重複的 from→to",
    info.duplicates.length === 0,
    info.duplicates.map(([k, n]) => `${k}×${n}`).join(" ") || "沒有重複",
  );
  ok(
    "四岔路口：總量一致（路線合計＝支線合計）",
    info.routeTotal === info.approachTotal && info.routeTotal > 0,
    `路線 ${info.routeTotal}／支線 ${info.approachTotal}`,
  );
} else {
  ok("前置：找得到四岔路口那一筆", false, "沒有站號結尾 00-02 的紀錄");
}

/*
 * ── B：四岔＋禁止左轉（整欄畫 `--`）──────────────────────
 *
 * v2.1.56 會把它安靜濾掉：12 → 11 條，畫面上少一條而且完全沒有提示。
 * 本版改成先列進裁決視窗；上面那段已經把 4 條都選了「沒有這個轉向」，
 * 所以套用後結果**仍然是 11 條**——與 v2.1.56 相同。
 * 也就是說本版不改變既有結果，改變的是「這件事看不看得見」。
 *
 * ⚠️ 這一段刻意驗兩件相反的事，缺一不可：
 *   ・它必須出現在視窗裡（否則就是又安靜刪掉了）
 *   ・三岔那三個照預期畫的橫線必須**不出現**在視窗裡
 *     （否則三岔每季匯入都要跳三題，就是使用者抱怨過的每季煩擾）
 */
if (fourBanned) {
  const info = analyse(fourBanned);
  ok(
    "四岔＋禁止左轉：使用者確認「沒有這個轉向」後為 11 條",
    info.routes === 11,
    `實際 ${info.routes} 條`,
  );
  ok(
    "四岔＋禁止左轉：真的量到 0 的那一條仍然要留著",
    info.allZero === 1,
    `全零流向 ${info.allZero} 條（應為 1，就是路口D 的左轉）`,
  );
  ok(
    "四岔＋禁止左轉：總量不變（路線合計＝支線合計）",
    info.routeTotal === info.approachTotal && info.routeTotal > 0,
    `路線 ${info.routeTotal}／支線 ${info.approachTotal}`,
  );
  /*
   * 記住的答案應該剛好 4 筆＝三岔留空白的 3 條 ＋ 四岔禁止左轉的 1 條。
   * 用數量而不是用「有沒有含某個字」來驗：三份檔的支線代碼都是 A、B、C，
   * 比對代碼會抓到別份檔的答案而變成假通過。
   * 若四岔那條沒有被問，這裡只會有 3 筆。
   */
  ok(
    "答案要記住 4 筆（3 條空白 ＋ 1 條四岔橫線），下一季不會再問",
    Object.keys(state?.movementPresence ?? {}).length === 4,
    `記住的答案 ${Object.keys(state?.movementPresence ?? {}).length} 筆`,
  );
} else {
  ok("前置：找得到「四岔＋禁止轉向」那一筆", false, "沒有站號結尾 00-05 的紀錄");
}

/*
 * 三岔、但 B 的右轉是**真的量到 0**（不是 `--`）：
 * 不存在的 2 條要刪掉、真實的 0 那一條要留著 → 7 條。
 * 只憑「全為 0」判斷的話會連 B 的右轉一起刪掉，變成 6 條。
 */
const threeWithZero = records.find(
  (record) => record.approaches.length === 3 && record.station.endsWith("00-03"),
);
if (threeWithZero) {
  const info = analyse(threeWithZero);
  ok(
    "三岔＋真實零流量：只刪不存在的 2 條，留下真的量到 0 的那一條（共 7 條）",
    info.routes === 7,
    `實際 ${info.routes} 條（6 條代表把真實的 0 也刪掉了）`,
  );
  ok(
    "三岔＋真實零流量：真的量到 0 的流向要留著",
    info.allZero === 1,
    `全零流向 ${info.allZero} 條（應為 1，就是 A 的右轉）`,
  );
  ok(
    "三岔＋真實零流量：總量不變（路線合計＝支線合計）",
    info.routeTotal === info.approachTotal && info.routeTotal > 0,
    `路線 ${info.routeTotal}／支線 ${info.approachTotal}`,
  );
} else {
  ok("前置：找得到「三岔＋真實零流量」那一筆", false, "沒有站號結尾 00-03 的紀錄");
}

/*
 * 不存在的轉向留空白（不是 `--`）：分不出來，所以會跳視窗請使用者裁決。
 * 在視窗按下之前，流向一律先保留——刪掉才是危險的。
 */
const blank = records.find(
  (record) => record.approaches.length === 3 && record.station.endsWith("00-04"),
);
if (blank) {
  const info = analyse(blank);
  ok(
    "在視窗裡選「沒有這個轉向」之後，那 3 條真的被移除（9 → 6）",
    info.routes === 6,
    `實際 ${info.routes} 條`,
  );
  ok(
    "移除之後不可以留下任何 presence: unknown",
    (blank.routes ?? []).every((route) => route.presence !== "unknown"),
  );
  ok(
    "移除之後總量仍然一致（被移除的本來就是 0）",
    info.routeTotal === info.approachTotal && info.routeTotal > 0,
    `路線 ${info.routeTotal}／支線 ${info.approachTotal}`,
  );
  ok(
    "答案要記住（存進 movementPresence），下次匯入同一個路口不會再問",
    Object.values(state?.movementPresence ?? {}).filter((v) => v === "no")
      .length === 4,
    `記住 ${Object.keys(state?.movementPresence ?? {}).length} 筆（3 條空白 ＋ 1 條四岔橫線）`,
  );
} else {
  ok("前置：找得到「三岔留空白」那一筆", false, "沒有站號結尾 00-04 的紀錄");
}

/*
 * ── 記住答案：同一個路口再匯入一次，不可以再問第二次 ──────────
 * 這是使用者對另一支系統抱怨過的事（設定過了每季還是跳），
 * 所以這裡要實際再跑一次匯入來證明，不能只看程式碼。
 */
await go("季度批次匯入");
await page.locator('.content label:has-text("調查年度") input').first().fill("115");
await page.locator('.content label:has-text("季度") select').first().selectOption("3");
await page.waitForTimeout(400);
await page.evaluate((payload) => {
  const zone = document.querySelector(".upload-card");
  const transfer = new DataTransfer();
  for (const item of payload) {
    const binary = atob(item.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    transfer.items.add(new File([bytes], item.name));
  }
  zone.dispatchEvent(
    new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
}, files.map((file) => ({ name: file.name, base64: file.buffer.toString("base64") })));
for (let wait = 0; wait < 90; wait += 1) {
  await page.waitForTimeout(400);
  const button = page.locator('button:has-text("確認寫入")').first();
  if ((await button.count()) && (await button.isEnabled())) break;
}
const secondCommit = page.locator('button:has-text("確認寫入")').first();
ok("前置：第二次匯入也解析完成", (await secondCommit.count()) > 0);
if (await secondCommit.count()) {
  await secondCommit.click();
  await page.waitForTimeout(5000);
}
ok(
  "同一個路口再匯入一次，不可以再跳裁決視窗（答案已經記住）",
  (await page.locator(".presence-modal").count()) === 0,
);
const secondState = await readState(page);
const secondBlank = (secondState?.records ?? []).find(
  (record) =>
    record.quarter === "115Q3" &&
    record.approaches.length === 3 &&
    record.station.endsWith("00-04"),
);
ok(
  "第二次匯入直接套用記住的答案（6 條，不是 9 條）",
  (secondBlank?.routes ?? []).length === 6,
  `實際 ${(secondBlank?.routes ?? []).length} 條`,
);
/*
 * 四岔＋禁止左轉的那一份也要一起驗第二季：
 * 只驗「留空白」那一份會漏掉——如果 B 這條每季都重問，
 * 使用者一樣會回報「每次匯入都跳」。
 */
const secondBanned = (secondState?.records ?? []).find(
  (record) =>
    record.quarter === "115Q3" &&
    record.approaches.length === 4 &&
    record.station.endsWith("00-05"),
);
ok(
  "四岔＋禁止左轉：第二季直接套用記住的答案（11 條）",
  (secondBanned?.routes ?? []).length === 11,
  `實際 ${(secondBanned?.routes ?? []).length} 條`,
);

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
