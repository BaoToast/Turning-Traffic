/*
 * ══════════════════════════════════════════════════════════════════
 *  匯入完成後：畫面停在哪裡、確認鍵在哪裡
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-10 實測 v2.1.64 試用版回報兩件事：
 *
 *   ①「資料匯入成功，也沒有任何異常，但畫面跳轉的位置卻是異常確認表的位置，
 *      而不是匯入辨識結果中，確認寫入按鍵的位置。」
 *   ②「第一筆有正確跳轉到『確認寫入』的位置。但我沒按，我繼續匯入 1 筆、
 *      2 筆、多筆資料，發現**每次都跳轉到異常確認表的位置**了。」
 *
 * 根因是**選錯捲動目標**，不是算錯間距：
 *   ① `[data-needs-check]` 的判定範圍比「異常」寬，沒有異常時照樣命中。
 *   ② 預覽改成累加之後，第二批一定找得到前一批留下的那一列。
 *
 * 使用者的原話要記牢：「如果系統只靠算間距去做跳轉，這樣容易跳錯位置」。
 * 用 scrollIntoView 不代表就安全——**選錯元素和算錯間距，使用者看到的結果一樣**。
 *
 * 定案：一律捲到「匯入辨識結果」標題；要找異常改用一顆按鈕。
 * 動作列（取消預覽／確認寫入）移到**異常確認表的正下方、靠右**，
 * 不 sticky、不在上方重複放一份——「捲過去才按得到」本身就是審閱動作。
 *
 * ── ⚠️ 這一支刻意迴避的假通過 ────────────────────────────────
 *
 * 一、只驗一次匯入不夠——②那個現象要**連續匯入三批**才重現得出來。
 * 二、只驗「捲到面板」不夠：面板很高，捲到面板底部也算「捲到面板」。
 *     要驗**面板頂端在視窗內**。
 * 三、只驗「有按鈕」不夠：要驗它在**表格之後**（DOM 順序），
 *     否則搬回上面也會過，那就把刻意的摩擦拿掉了。
 * 四、`hasIssue` 與 `needsCheck` **不可以是同一組列**——
 *     相等的話這次的缺陷會原樣復發。所以測資裡刻意放一個
 *     「站號沒判定出來、但沒有任何警告」的檔。
 * 五、不用真實調查檔（真實檔不進交付包），用同版型、數字自己編的活頁簿。
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const PORT = 8249;

/**
 * 匿名活頁簿。
 * @param station 站號；傳 null 代表**整份不寫站號**（stationSource 會是 none）
 */
function makeWorkbook({ arms = 4, station, name }) {
  const width = 14;
  const rows = Array.from({ length: 12 }, () => Array(arms * width).fill(null));
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const times = ["07:00~07:15", "07:15~07:30", "07:30~07:45", "07:45~08:00"];
  for (let approach = 0; approach < arms; approach += 1) {
    const base = approach * width;
    const code = String.fromCharCode(65 + approach);
    if (station) rows[1][base] = "站號：" + station;
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
        movements.forEach((__, movementIndex) => {
          rows[6 + rowIndex][base + 1 + vehicleIndex * 3 + movementIndex] =
            2 + ((approach + vehicleIndex + movementIndex + rowIndex) % 8);
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

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1500, height: 900 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};
await go("建立與管理計畫");
await page.locator(".project-form input").nth(0).fill("A00-IMP");
await page.locator(".project-form input").nth(1).fill("匯入定位示範計畫");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(600);
await go("季度批次匯入");
await page.locator('.content label:has-text("調查年度") input').first().fill("115");
await page.locator('.content label:has-text("季度") select').first().selectOption("2");
await page.waitForTimeout(300);

async function dropFiles(files) {
  await page.evaluate(
    (payload) => {
      const zone = document.querySelector(".upload-card");
      const transfer = new DataTransfer();
      for (const item of payload) {
        const binary = atob(item.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        transfer.items.add(
          new File([bytes], item.name, {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
        );
      }
      zone.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    },
    files.map((file) => ({ name: file.name, base64: file.buffer.toString("base64") })),
  );
  for (let wait = 0; wait < 60; wait += 1) {
    await page.waitForTimeout(400);
    if (await page.locator("#import-preview-panel").count()) break;
  }
  /* 捲動是在兩層 rAF 之後、而且是 smooth，要等它停下來才量得準。 */
  await page.waitForTimeout(1800);
}

/** 「匯入辨識結果」標題現在離視窗頂端多遠。 */
async function headingOffset() {
  return page.evaluate(() => {
    const panel = document.getElementById("import-preview-panel");
    if (!panel) return null;
    return Math.round(panel.getBoundingClientRect().top);
  });
}
/**
 * 浮在畫面上方那幾層（上方功能列 ＋ 主工具列）的總高度。
 *
 * ⚠️ 一定要**當場量**，不可以寫死一個上限。
 *   這一支原本寫「標題距視窗頂端要 ≤ 220px」——那是**主工具列還不存在時**
 *   算出來的數字。工具列 2026-09-15 起常駐在上方（而且可收合、窄視窗會換行），
 *   落點自然往下移到 267px，守門就紅了——但畫面其實是對的：
 *   標題剛好停在工具列下緣。
 *   要驗的是「標題有沒有被浮在上面的東西蓋住」，不是「離頂端幾像素」。
 */
/**
 * 畫面是不是**已經捲到最底**了。
 *
 * ⚠️ 這一件事決定了上面那個判準成不成立。
 *   scroll-margin-top 只能告訴瀏覽器「捲到位時要留多少」，
 *   它**變不出捲動空間**——面板下面沒有足夠的內容時，
 *   瀏覽器已經捲到底了，標題就停在它停得到的最高位置。
 *   那時標題其實完全看得到、也沒有被工具列蓋住，畫面是對的，
 *   但「離下緣不可以太遠」這一條會紅。
 *   2026-09-16 實測：捲到底（scrollY 1007／可捲 1007），標題落在 314px，
 *   浮層共 249px——沒有被蓋住，只是下面沒有東西可以再捲。
 */
async function atPageBottom() {
  return page.evaluate(
    () =>
      Math.round(window.scrollY + window.innerHeight) >=
      Math.round(document.documentElement.scrollHeight) - 2,
  );
}
async function floatingTop() {
  return page.evaluate(() => {
    const height = (selector) => {
      const node = document.querySelector(selector);
      return node && getComputedStyle(node).position === "sticky"
        ? node.getBoundingClientRect().height
        : 0;
    };
    return Math.round(height(".topbar") + height(".main-toolbar"));
  });
}
/** 先把畫面捲到最上面，確保「有沒有捲」量得出來。 */
async function resetScroll() {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" }));
  await page.waitForTimeout(300);
}

console.log("══ 一、連續三批乾淨的檔案，每一批都要停在「匯入辨識結果」標題 ══");
/*
 * ⚠️ 三批都要驗。使用者回報的第二個現象（「第一筆對、之後每次都跳到異常表」）
 *    只有連續匯入才重現得出來——預覽是累加的，第二批以後一定找得到前一批
 *    留下來的那一列。只驗一批的話這個缺陷會完全漏掉。
 */
for (let batch = 1; batch <= 3; batch += 1) {
  await resetScroll();
  await dropFiles(
    Array.from({ length: batch }, (_, index) => ({
      name: `A00T0${batch}-0${index + 1}乾淨路口${batch}${index}.xlsx`,
      buffer: makeWorkbook({
        station: `A00T0${batch}-0${index + 1}`,
        name: `乾淨路口${batch}${index}`,
      }),
    })),
  );
  const top = await headingOffset();
  const floating = await floatingTop();
  const bottomed = await atPageBottom();
  /* ⚠️ 視窗高度要當場量，不可以寫死 900——視窗尺寸一改就會變成恆真。 */
  const viewport = await page.evaluate(() => window.innerHeight);
  /*
   * 判準：標題要停在**浮起來那幾層的下緣**，而且不可以離太遠。
   *   ・比下緣高 → 被工具列蓋住（使用者要往上滑才看得到標題）
   *   ・離下緣太遠 → 根本沒捲到位，中間空一大段
   * 容差 40px 是留白（scroll-margin-top 本身就多留了 18px）。
   */
  /*
   * ⚠️ 捲到底時只驗「沒有被蓋住、而且在視窗內」。
   *   放寬的只有「離下緣不可以太遠」那一半，另一半（不可以被工具列蓋住）
   *   照驗——那才是使用者真的會看到的毛病。
   */
  const within = bottomed
    ? top !== null && top >= floating - 8 && top < viewport
    : top !== null && top >= floating - 8 && top <= floating + 40;
  ok(
    `第 ${batch} 批（${batch} 個檔）之後，「匯入辨識結果」標題在視窗內`,
    within,
    `標題距視窗頂端 ${top}px；浮在上面的共 ${floating}px（要落在 ${floating - 8}～${
      bottomed ? "視窗底（已捲到底，下面沒有內容可以再捲）" : floating + 40
    }）`,
  );
}

console.log("\n══ 二、動作列在異常確認表之後、靠右，而且黏在面板底緣 ══");
const layout = await page.evaluate(() => {
  const panel = document.getElementById("import-preview-panel");
  const actions = panel?.querySelector(".preview-actions");
  const table = panel?.querySelector("table");
  if (!panel || !actions || !table) return null;
  /* compareDocumentPosition：表格是否在動作列之前。 */
  const tableBeforeActions = Boolean(
    table.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  return {
    tableBeforeActions,
    position: getComputedStyle(actions).position,
    justify: getComputedStyle(actions).justifyContent,
    /* 上方不可以再放一份。 */
    count: panel.querySelectorAll(".preview-actions").length,
    commitCount: [...panel.querySelectorAll("button")].filter((b) =>
      /確認寫入/.test(b.textContent || ""),
    ).length,
  };
});
ok("前置：面板、表格、動作列都在", Boolean(layout), JSON.stringify(layout));
if (layout) {
  ok("動作列在異常確認表**之後**", layout.tableBeforeActions);
  ok("動作列靠右", layout.justify === "flex-end", layout.justify);
  /*
   * ⚠️ 這一項我寫反過一次，記在這裡免得再犯。
   *
   *   使用者要的**不是二選一**：
   *     ・DOM 順序在異常表之後、靠右 → 語意上「上面看過了才按」
   *     ・sticky 黏在面板底緣 → 「我們總不能逼迫使用者非這樣做不可」
   *   兩件事同時成立。我一度只做前者、還寫了一條「是 sticky 就要紅」的
   *   守門，那等於把使用者明講要的便利性擋掉。
   *
   *   ⚠️ 但 `fixed` 仍然要紅：fixed 是黏在**視窗**上，面板捲走了它還在，
   *      那才是真的擋路。sticky 會在包含區塊捲過去之後自動放開。
   */
  ok(
    "動作列要 sticky（引導往下看，但不擋住想直接按的人）",
    layout.position === "sticky",
    layout.position,
  );
  ok(
    "但**不可以**是 fixed（黏在視窗上，面板捲走了還賴著不走）",
    layout.position !== "fixed",
    layout.position,
  );
  ok("整個面板只有一組動作列（上方不可以再放一份）", layout.count === 1, `${layout.count} 組`);
  ok("「確認寫入」只出現一顆", layout.commitCount === 1, `${layout.commitCount} 顆`);
}

console.log("\n══ 二之二、乾淨的批次要收合成一行提醒 ══");
/*
 * 使用者：「如果匯入沒有任何異常的話，異常清單也能直接變成收合，
 *          顯示一個『無任何異常事項』的提醒，使用者就知道可以安心按確認匯入。」
 * ⚠️ 只驗「有沒有 <details>」不夠——永遠收合也會過，那會把要處理的事情藏起來。
 *    所以下面第三段會再驗「有需要確認時必須展開」。
 */
const collapsed = await page.evaluate(() => {
  const details = document.querySelector(".preview-details");
  if (!details) return null;
  return {
    open: details.open,
    summary: (details.querySelector("summary")?.innerText || "").replace(/\s+/g, " "),
  };
});
ok("前置：明細有做成可收合", Boolean(collapsed), JSON.stringify(collapsed));
if (collapsed) {
  ok("這一批全部辨識正常，明細要**收合**", collapsed.open === false, `open=${collapsed.open}`);
  ok(
    "摘要那一行要寫出「未發現異常事項」與檔案數（收合的是明細，不是資訊）",
    /未發現異常事項/.test(collapsed.summary) && /\d+ 個檔案/.test(collapsed.summary),
    collapsed.summary.slice(0, 80),
  );
}

console.log("\n══ 三、hasIssue 與 needsCheck 不可以是同一組列 ══");
/*
 * 放一個「站號整份沒寫、但解析得出來也沒有警告」的檔：
 *   needsCheck → 要（站號沒判定出來，人要看一眼並補上）
 *   hasIssue   → 不要（它會被正常寫入，不是異常）
 * 兩者若相等，這次修掉的缺陷會原樣復發。
 */
await resetScroll();
await dropFiles([
  {
    /*
     * ⚠️ 檔名裡**不可以**帶像站號的代號。系統認不到站號時會退而從檔名推，
     *   檔名叫 A00T09-01… 就會被推出站號，stationSource 變成 filename 而不是
     *   none，這一列就不會被標成 needsCheck——測資反而測不到要測的東西。
     */
    name: "沒有寫站號的示範路口.xlsx",
    buffer: makeWorkbook({ station: null, name: "沒寫站號的路口" }),
  },
]);
const flags = await page.evaluate(() => ({
  needsCheck: document.querySelectorAll("[data-needs-check]").length,
  hasIssue: document.querySelectorAll("[data-has-issue]").length,
  rows: document.querySelectorAll("#import-preview-panel tbody tr").length,
}));
console.log("   ", JSON.stringify(flags));
ok("前置：預覽裡有列", flags.rows > 0, `${flags.rows} 列`);
ok(
  "有列被標成 needsCheck（站號沒判定出來要人看一眼）",
  flags.needsCheck > 0,
  `${flags.needsCheck} 列`,
);
ok(
  "⚠️ needsCheck 的列數要多於 hasIssue（兩者相等代表旗標又混在一起了）",
  flags.needsCheck > flags.hasIssue,
  `needsCheck ${flags.needsCheck} 列／hasIssue ${flags.hasIssue} 列`,
);
/*
 * 反面：有需要確認的東西時，明細**一定要展開**。
 * ⚠️ 沒有這一項的話，「永遠收合」也會通過上一段——那會把要動手補的事情藏起來，
 *   比不收合糟得多。
 */
const expanded = await page.evaluate(
  () => document.querySelector(".preview-details")?.open ?? null,
);
ok(
  "有需要確認的檔案時，明細必須**展開**（不可以把要動手的事藏起來）",
  expanded === true,
  `open=${expanded}`,
);

console.log("\n══ 四、「跳到第一筆有異常的資料」要停在第一筆 ══");
/*
 * 到目前為止的檔案全部解析正常，所以 hasIssue 是 0、按鈕不該出現——
 * 這本身就是一項守門：**沒有異常就不要放一顆按了會說「沒有異常」的按鈕**。
 */
ok(
  "沒有任何異常時，「跳到第一筆有異常」的按鈕**不該**出現",
  (await page.locator("[data-goto-first-issue]").count()) === 0,
);
/*
 * 現在丟一個**真的有異常**的檔：檔名是純代號（T14-02.xls）的參考計算檔，
 * 系統會判成「不會被寫入」，那是 hasIssue 而不只是 needsCheck。
 */
await resetScroll();
await dropFiles([
  { name: "T14-02.xlsx", buffer: makeWorkbook({ station: "T14-02", name: "參考計算檔" }) },
]);
const withIssue = await page.evaluate(() => ({
  needsCheck: document.querySelectorAll("[data-needs-check]").length,
  hasIssue: document.querySelectorAll("[data-has-issue]").length,
}));
console.log("   ", JSON.stringify(withIssue));
ok(
  "前置：這個檔要被判成有異常（不會被寫入）",
  withIssue.hasIssue > 0,
  JSON.stringify(withIssue),
);
ok(
  "⚠️ 即使有異常，needsCheck 仍要多於 hasIssue（兩者不可以合而為一）",
  withIssue.needsCheck > withIssue.hasIssue,
  `needsCheck ${withIssue.needsCheck}／hasIssue ${withIssue.hasIssue}`,
);
const jump = page.locator("[data-goto-first-issue]");
ok("有異常時按鈕要出現", (await jump.count()) > 0);
if ((await jump.count()) && withIssue.hasIssue > 0) {
  await resetScroll();
  await jump.first().click();
  await page.waitForTimeout(1200);
  const landed = await page.evaluate(() => {
    const first = document.querySelector("[data-has-issue]");
    if (!first) return null;
    const box = first.getBoundingClientRect();
    return {
      top: Math.round(box.top),
      visible: box.top > -20 && box.bottom < window.innerHeight + 20,
      /* 停的是不是**第一筆**：目前視窗中央最接近的那一列要是它 */
      isFirst:
        document.querySelectorAll("[data-has-issue]")[0] === first,
    };
  });
  ok(
    "按下去之後第一筆有異常的列在視窗內",
    Boolean(landed?.visible),
    JSON.stringify(landed),
  );
}

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 3).join(" ｜ "));

await browser.close();
server.close();
console.log(
  problems.length
    ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}`
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
