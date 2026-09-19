/*
 * 端對端：資料存在 IndexedDB，而且舊的 localStorage 資料會自動搬過去。
 *
 * 起因（使用者實測回報，v2.1.51 線上版）：只匯入一季路口轉向資料，
 * 右下角就跳「瀏覽器儲存空間快滿了，這次存檔只保留 20 筆還原點
 * （原本 65 筆）」。實測量到的數字：
 *   ・localStorage 每個網站硬上限 4.94 MB，整個網站共用
 *   ・路口轉向是三支裡唯一把全部資料放 localStorage 的
 *   ・單一路口快照平均 14.2 KB、最大 38.7 KB（七叉路口）
 *   ・對照：全日交通量使用者備份 67.1 MB，其中還原點 62.8 MB（94%），
 *     它完全不會滿——差別只在於它存在 IndexedDB
 *
 * ⚠️ 假通過陷阱三個：
 *  一、只驗「IndexedDB 裡有東西」不夠——兩邊都寫也會過，而兩邊都寫正是
 *      使用者定案時明確排除的做法（會有「哪一份才是最新」的問題）。
 *      所以要同時驗 **localStorage 裡不可以再留下狀態鍵值**。
 *  二、搬遷只驗「沒有報錯」不夠——要驗**內容真的讀出來了**（筆數、名稱），
 *      否則把舊資料直接丟掉也會過。
 *  三、要驗「超過 localStorage 上限的資料讀得回來」，否則只是換個地方
 *      存一樣小的東西，問題根本沒解決。
 */
import { chromium } from "playwright";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { readState, stateLocation } from "./read-state.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/*
 * 用 seed-state.json 當底稿，不自己手捏狀態。
 * 手捏的狀態少一個欄位，畫面就會丟未捕捉例外——那時紅字的原因會變成
 * 「我的測試資料不合法」而不是「程式有問題」，紅字就不能當證據了。
 */
const SEED = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
const SEED_PROJECT = SEED.projects[0].name;

const PORT = 8244;
const server = await serve(PORT);
const base = `http://127.0.0.1:${PORT}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/*
 * 以 seed-state.json 為底，把紀錄複製到指定份數，做出一份合法但很大的狀態。
 * 每一筆紀錄約 9.5 KB，複製 700 份就會超過 localStorage 實測的 4.94 MB 上限。
 */
function seedState(copies) {
  const records = [];
  for (let index = 0; index < copies; index += 1) {
    const source = SEED.records[index % SEED.records.length];
    records.push({
      ...structuredClone(source),
      id: source.id + "-C" + index,
      station: source.station,
    });
  }
  return { ...structuredClone(SEED), records };
}

const browser = await chromium.launch(launchOptions());

/* ── 一、全新瀏覽器：資料只能寫進 IndexedDB ── */
{
  const context = await browser.newContext({ locale: "zh-TW" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("dialog", (d) => d.accept());
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  await page.locator('nav button:has-text("建立與管理計畫")').first().click();
  await page.waitForTimeout(600);
  await page.locator(".project-form input").nth(0).fill("A00-IDB");
  await page.locator(".project-form input").nth(1).fill("儲存位置示範計畫");
  await page.locator('button:has-text("建立計畫")').click();
  await page.waitForTimeout(1500);

  const where = await stateLocation(page);
  ok("新資料要寫進 IndexedDB", where.indexeddb, JSON.stringify(where));
  ok(
    "localStorage 不可以再留下狀態鍵值（不做雙寫）",
    !where.localStorage,
    where.localKeys.join(", ") || "沒有殘留",
  );

  /* 關掉再開，資料要還在——這是使用者最在意的一句「重開會不會不見」。 */
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const reloaded = await readState(page);
  ok(
    "關掉重開之後計畫還在",
    (reloaded?.projects ?? []).some((p) => p.code === "A00-IDB"),
    `讀到 ${(reloaded?.projects ?? []).length} 個計畫`,
  );
  ok("正常情境不可以有未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
}

/* ── 二、舊的 localStorage 資料要自動搬到 IndexedDB ── */
{
  const context = await browser.newContext({ locale: "zh-TW" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("dialog", (d) => d.accept());
  /* 小一點，因為要塞得進 localStorage 才模擬得出「舊版留下的資料」 */
  const legacy = seedState(3);
  await page.addInitScript((text) => {
    localStorage.setItem("turning-traffic-state-v2", text);
  }, JSON.stringify(legacy));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const migrated = await readState(page);
  ok(
    "舊資料的內容要真的讀出來（不是搬完就丟掉）",
    (migrated?.records ?? []).length === 3 &&
      (migrated?.projects ?? []).some((p) => p.name === SEED_PROJECT),
    `讀到 ${(migrated?.records ?? []).length} 筆紀錄`,
  );
  const where = await stateLocation(page);
  ok("搬遷後資料在 IndexedDB", where.indexeddb, JSON.stringify(where));
  ok(
    "搬遷後 localStorage 的舊鍵值要清掉",
    !where.localStorage,
    where.localKeys.join(", ") || "已清除",
  );
  const text = await page.evaluate(() =>
    document.body.innerText.replace(/\s+/g, " "),
  );
  ok(
    "搬家要告訴使用者一聲",
    /搬到容量大得多的 IndexedDB/.test(text),
    text.slice(0, 80),
  );
  ok("搬遷情境不可以有未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
}

/* ── 三、超過 localStorage 上限的資料要讀得回來 ── */
{
  const context = await browser.newContext({ locale: "zh-TW" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("dialog", (d) => d.accept());
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  /* 8 MB：確定超過實測的 localStorage 上限 4.94 MB */
  const huge = JSON.stringify(seedState(700));
  ok(
    "前置：測試資料確實超過 localStorage 的 4.94 MB 上限",
    huge.length > 4.94 * 1024 * 1024,
    `${(huge.length / 1024 / 1024).toFixed(2)} MB`,
  );
  const seeded = await page.evaluate(async (text) => {
    return new Promise((resolve) => {
      const request = indexedDB.open("turning-traffic", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
      };
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("state", "readwrite");
        tx.objectStore("state").put(text, "turning-traffic-state-v2");
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          db.close();
          resolve(false);
        };
      };
    });
  }, huge);
  ok("前置：8 MB 的狀態寫得進 IndexedDB", seeded);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  /*
   * ⚠️ 這裡**不可以**只用 readState() 去看 IndexedDB 裡有沒有 700 筆——
   *    那一份是這支腳本自己塞進去的，程式有沒有讀它完全不影響結果，
   *    是恆真的假檢查（第一版就是這樣寫的，對未修正的 v2.1.52 也會綠）。
   *    要驗的是「**程式真的把它讀出來並顯示**」，所以看畫面上的計畫名稱，
   *    再做一次寫入、確認 700 筆連同新資料一起被寫回去。
   */
  await page.locator('nav button:has-text("建立與管理計畫")').first().click();
  await page.waitForTimeout(1200);
  const shown = await page.evaluate(() =>
    document.body.innerText.replace(/\s+/g, " "),
  );
  ok(
    "超過 localStorage 上限的資料，程式要真的讀出來並顯示",
    shown.includes(SEED_PROJECT),
    shown.includes(SEED_PROJECT) ? "畫面上看得到計畫" : "畫面上找不到計畫名稱",
  );
  await page.locator(".project-form input").nth(0).fill("A00-HUGE");
  await page.locator(".project-form input").nth(1).fill("大量資料後續寫入");
  await page.locator('button:has-text("建立計畫")').click();
  await page.waitForTimeout(2500);
  const loaded = await readState(page);
  ok(
    "大量資料下的後續寫入不可以把原本 700 筆弄丟",
    (loaded?.records ?? []).length === 700 &&
      (loaded?.projects ?? []).some((p) => p.code === "A00-HUGE"),
    `讀到 ${(loaded?.records ?? []).length} 筆、${(loaded?.projects ?? []).length} 個計畫`,
  );
  const text = await page.evaluate(() =>
    document.body.innerText.replace(/\s+/g, " "),
  );
  ok(
    "這種大小不可以再跳「儲存空間快滿」",
    !/儲存空間快滿|儲存空間已滿/.test(text),
    text.match(/儲存空間[^。]*/)?.[0] ?? "沒有出現",
  );
  ok("大量資料情境不可以有未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
}

/* ── 四、IndexedDB 被封鎖時，畫面不可以整頁空白 ── */
{
  const context = await browser.newContext({ locale: "zh-TW" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new DOMException("IndexedDB 已被停用", "SecurityError");
      },
    });
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("localStorage 已被停用", "SecurityError");
      },
    });
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const view = await page.evaluate(() =>
    document.body.innerText.replace(/\s+/g, " ").trim(),
  );
  ok("封鎖儲存空間時畫面不可以空白", view.length > 30, `${view.length} 個字`);
  ok(
    "要明講是「瀏覽器不允許儲存」",
    /瀏覽器不允許這個網站儲存資料/.test(view),
    view.slice(0, 70) || "（空白）",
  );
  ok(
    "這個畫面不可以有「下載原始資料」（按下去一定失敗）",
    !/下載原始資料/.test(view),
  );
  ok("封鎖情境不可以有未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
}

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
