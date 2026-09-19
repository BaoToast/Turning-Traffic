/*
 * ══════════════════════════════════════════════════════════════════════
 *  橫跨中午的尖峰：匯入前跳出視窗，選了什麼就算什麼
 *  順便驗：匯入時讀到的逐時間格原始資料有存下來
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「匯入 > 程式一發現 > 詢問 > 確認後 > 立刻按照分類算出正確的上下午尖峰
 *     然後就固定。」四個選項：1.取消不匯入 2.忽略 3.算上午 4.算下午
 *   「讓三份程式都能把讀到的原始資料存下來……至少有新增功能時，不需要
 *     使用者把所有計畫都重新匯入一次（工作量太大）。」
 *
 * ⚠️ 單元測試守得住「算對不對」，守不住「那顆按鈕有沒有接到計算」。
 *   這一支從瀏覽器按下去，再讀狀態裡真正存下來的尖峰時段。
 *
 * 測資（15 分鐘一格，只有小型車，PCE 1，值＝PCU）：
 *   11:45 → 100；12:00/12:15/12:30 → 各 900；
 *   07:00～08:00 四格 → 各 200；17:00～18:00 四格 → 各 220；其餘 → 5
 * 手算：跨中午的 11:45–12:45 ＝ 2800（全天最忙）
 *       AM（整個視窗在 12:00 前）＝ 07:00–08:00 ＝ 800
 *       PM（整個視窗在 12:00 後）＝ 12:00–13:00 ＝ 2705
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as XLSX from "xlsx";

const HERE = dirname(fileURLToPath(import.meta.url));
const { serve } = await import(pathToFileURL(join(HERE, "serve.mjs")).href);
const { launchOptions } = await import(
  pathToFileURL(join(HERE, "chrome-path.mjs")).href
);
const { installStateHelpers } = await import(
  pathToFileURL(join(HERE, "read-state.mjs")).href
);

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const VEHICLES = ["機車", "小型車", "大型車", "特種車"];
const pad = (n) => String(n).padStart(2, "0");
const valueAt = (m) =>
  m === 11 * 60 + 45
    ? 100
    : m >= 12 * 60 && m < 12 * 60 + 45
      ? 900
      : m >= 7 * 60 && m < 8 * 60
        ? 200
        : m >= 17 * 60 && m < 18 * 60
          ? 220
          : 5;

function makeWorkbook({ station, name }) {
  const times = [];
  for (let m = 0; m < 24 * 60; m += 15) {
    const to = m + 15;
    times.push({
      label: `${pad(Math.floor(m / 60))}:${pad(m % 60)}~${pad(Math.floor(to / 60) % 24)}:${pad(to % 60)}`,
      start: m,
    });
  }
  const perApproach = 1 + VEHICLES.length * 3;
  const stride = perApproach + 2;
  const rows = Array.from({ length: 6 + times.length }, () =>
    Array(stride * 4).fill(null),
  );
  const movements = ["左轉", "直進", "右轉"];
  for (let approach = 0; approach < 4; approach += 1) {
    const base = approach * stride;
    rows[1][base] = "站號：" + station;
    rows[1][base + 4] = "監測日期：115年01月26日(平日)";
    rows[2][base] = "站名：" + name;
    rows[3][base] = `路口編號：路口${String.fromCharCode(65 + approach)}`;
    rows[4][base] = "時間";
    VEHICLES.forEach((vehicle, vi) => {
      rows[4][base + 1 + vi * 3] = vehicle;
      movements.forEach((movement, mi) => {
        rows[5][base + 1 + vi * 3 + mi] = movement;
      });
    });
    times.forEach((time, ri) => {
      rows[6 + ri][base] = time.label;
      VEHICLES.forEach((vehicle, vi) => {
        movements.forEach((_unused, mi) => {
          rows[6 + ri][base + 1 + vi * 3 + mi] =
            vehicle === "小型車" ? valueAt(time.start) : 0;
        });
      });
    });
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: 4 }).flatMap((_unused, approach) =>
    VEHICLES.map((__unused, vi) => ({
      s: { r: 4, c: approach * stride + 1 + vi * 3 },
      e: { r: 4, c: approach * stride + 3 + vi * 3 },
    })),
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "平日");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const server = await serve(8176);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await installStateHelpers(page);

const go = async (label) => {
  await page
    .locator(`nav button:has-text("${label}"), aside button:has-text("${label}")`)
    .first()
    .click();
  await page.waitForTimeout(700);
};

/** 走一次完整匯入；choice 為 null 代表只看視窗有沒有跳出來。 */
async function importWithChoice(choice, station) {
  await page.goto("http://localhost:8176/");
  await page.evaluate(async () => {
    localStorage.clear();
    for (const db of (await indexedDB.databases?.()) ?? [])
      if (db.name) indexedDB.deleteDatabase(db.name);
  });
  await page.reload();
  await page.waitForTimeout(1500);

  await go("建立與管理計畫");
  await page.locator(".project-form input").first().fill("NOON-01");
  await page.locator(".project-form input").nth(1).fill("跨中午測試");
  await page
    .locator('.project-form button:has-text("建立計畫")')
    .first()
    .click();
  await page.waitForTimeout(900);

  await go("季度批次匯入");
  await page.locator(".import-period input").first().fill("115");
  await page.locator(".import-period select").first().selectOption("1");
  await page.waitForTimeout(300);
  const buffer = makeWorkbook({ station, name: "跨中午北路－跨中午東路口" });
  await page.locator(".upload-card").first().evaluate(
    (card, payload) => {
      const transfer = new DataTransfer();
      const binary = atob(payload.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      transfer.items.add(
        new File([bytes], payload.fileName, {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      card.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
      );
    },
    {
      base64: Buffer.from(buffer).toString("base64"),
      fileName: `09999${station}_跨中午測試路口.xlsx`,
    },
  );
  await page.waitForTimeout(5200);

  const commit = page.locator('button:has-text("確認寫入")');
  if (await commit.count()) {
    await commit.first().click();
    await page.waitForTimeout(900);
  }
  const asked = (await page.locator("#noonQuestions").count()) > 0;
  if (choice === null) return { asked };
  if (asked) {
    await page
      .locator(`#noonQuestions input[type="radio"][value="${choice}"]`)
      .first()
      .check();
    await page.waitForTimeout(300);
    await page.locator("#noonConfirm").click();
    await page.waitForTimeout(4200);
  }
  const state = await page.evaluate(async (wanted) => {
    const data = JSON.parse((await window.__readState()) || "{}");
    const record = (data.records || []).find((item) => item.station === wanted);
    if (!record) return null;
    return {
      AM: record.peaks?.AM?.start || "",
      PM: record.peaks?.PM?.start || "",
      DAY: record.peaks?.DAY?.start || "",
      noonSide: record.noonSide || "",
      intervals: record.sourceIntervals?.rows?.length ?? 0,
      intervalMinutes: record.sourceIntervals?.intervalMinutes ?? 0,
      columns: record.sourceIntervals?.columns?.length ?? 0,
    };
  }, station);
  return { asked, ...state };
}

/* ── ① 會不會問、四個選項在不在 ─────────────────────────── */
console.log("\n══ ① 匯入時要跳出詢問視窗 ══");
const probe = await importWithChoice(null, "T95-01");
ok(
  "⚠️ ① 最忙的一小時橫跨中午時，寫入前會跳出詢問視窗",
  probe.asked,
  probe.asked ? "" : "完全沒有問，等於這個情況被安靜地略過了",
);
if (probe.asked) {
  const text = await page.locator("#noonQuestions").first().textContent();
  for (const option of ["取消", "忽略這個時段", "AM Peak", "PM Peak"])
    ok(
      `① 視窗上有「${option}」`,
      (text || "").includes(option),
      (text || "").replace(/\s+/g, " ").slice(0, 90),
    );
  ok(
    "⚠️ ① 有寫出「不選它的話 AM／PM 會是什麼」",
    /07:00/.test(text || "") && /12:00/.test(text || ""),
    "只給四個選項而不給數字，使用者無從判斷",
  );
  ok(
    "① 預設停在「忽略」",
    await page
      .locator('#noonQuestions input[type="radio"][value="ignore"]')
      .first()
      .isChecked(),
  );
}

/* ── ② 三種選擇各自算出什麼 ─────────────────────────────── */
console.log("\n══ ② 選「忽略」 ══");
const ignored = await importWithChoice("ignore", "T95-02");
ok("② 忽略：AM 07:00（＝改版前的行為）", ignored?.AM === "07:00", `AM=${ignored?.AM}`);
ok("② 忽略：PM 12:00", ignored?.PM === "12:00", `PM=${ignored?.PM}`);

console.log("\n══ ③ 選「算 AM」 ══");
const asAm = await importWithChoice("am", "T95-03");
ok("⚠️ ③ AM 換成 11:45", asAm?.AM === "11:45", `AM=${asAm?.AM}`);
ok(
  "⚠️ ③ PM **跳開**那一小時，變成 17:00（不可以重複計算同一批車）",
  asAm?.PM === "17:00",
  `PM=${asAm?.PM}——若還是 12:00，代表 12:00～12:45 那三格被算了兩次`,
);
ok("③ 決定有存進紀錄", asAm?.noonSide === "am", `noonSide=${asAm?.noonSide}`);

console.log("\n══ ④ 選「算 PM」 ══");
const asPm = await importWithChoice("pm", "T95-04");
ok("⚠️ ④ PM 換成 11:45", asPm?.PM === "11:45", `PM=${asPm?.PM}`);
ok("④ AM 維持 07:00", asPm?.AM === "07:00", `AM=${asPm?.AM}`);

console.log("\n══ ⑤ 全調查時段尖峰不受任何選擇影響 ══");
for (const [name, result] of [
  ["忽略", ignored],
  ["算AM", asAm],
  ["算PM", asPm],
])
  ok(`⑤ ${name}：DAY 仍是 11:45`, result?.DAY === "11:45", `DAY=${result?.DAY}`);

/* ── ⑥ 逐時間格的原始資料有存下來 ───────────────────────── */
console.log("\n══ ⑥ 原始資料有留下來（未來新增功能不必重匯） ══");
ok(
  "⚠️ ⑥ 紀錄裡存了逐時間格資料（96 格 × 15 分鐘）",
  ignored?.intervals === 96 && ignored?.intervalMinutes === 15,
  `intervals=${ignored?.intervals}, intervalMinutes=${ignored?.intervalMinutes}`,
);
ok(
  "⑥ 而且存了每一欄對應到哪一支支線／車種／轉向",
  (ignored?.columns ?? 0) >= 48,
  `columns=${ignored?.columns}（4 支線 × 4 車種 × 3 轉向 ＝ 48）`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
await server.close?.();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 橫跨中午會問、選什麼就算什麼；逐時間格原始資料有存下來");
