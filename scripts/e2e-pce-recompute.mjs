/*
 * ══════════════════════════════════════════════════════════════════════
 *  車種當量與「併入／獨立分析」改完之後，數字**真的重算，而且算對**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：
 *   「請再次確認路口轉向，各車種當量係數和新增的車種可以重新設定併入
 *     其他車種或獨立分析，並且套用重新計算後，有確實計算，
 *     因為我手上沒有錯誤的檔案可以驗證了」
 *
 * ⚠️ 「有反應」不等於「算對」。按下重算之後數字一定會變，
 *   但變成多少才是重點——這支驗的是**算術**，不是「有沒有動」。
 *
 * 作法：造一份每一格都是已知常數的調查表，於是每一個 PCU 都可以**手算**。
 *   ・四支支線、五個車種（四個標準＋自訂的「聯結車」）、三種轉向
 *   ・每一格固定 BASE[車種]，所有時段都一樣
 *     → 尖峰小時 ＝ 4 個 15 分鐘格 → 每一個（車種×轉向）＝ 4×BASE
 *     → 某一個轉向的 PCU ＝ Σ車種 4×BASE[車種] × 當量[車種][該轉向]
 *
 * 驗三件事，每一件都對到期望值（不是「大於零」「有變」這種弱斷言）：
 *   ① 匯入當下：聯結車設「獨立分析」，PCU ＝ 用聯結車自己的當量算出來的值
 *   ② 只改當量：把聯結車的直行當量換一個數字 → 重算 → 直行 PCU
 *      要**剛好**差 4×BASE[聯結車]×(新當量 − 舊當量)
 *   ③ 改成併入：聯結車併入特種車 → 重算 →
 *      ・車種明細裡不可以再有聯結車
 *      ・特種車的輛數 ＝ 原特種車 ＋ 原聯結車
 *      ・PCU ＝ 用**特種車**的當量重算（聯結車自己的當量完全不參與）
 *
 * ⚠️ 另外釘一條反面：沒有按重算之前，數字**不可以**自己變。
 *   那是刻意的設計（已經交出去的數字不該在背後被改掉），
 *   少了這一條，「自動重算」這種行為改變不會有人發現。
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

/* ── 測資：每一格都是常數，所以每一個 PCU 都算得出來 ───────────── */
const VEHICLES = ["機車", "小型車", "大型車", "特種車", "聯結車"];
const KEY_OF = {
  機車: "motorcycle",
  小型車: "car",
  大型車: "heavy",
  特種車: "special",
  聯結車: "custom:聯結車",
};
/* 刻意五個都不一樣，而且沒有倍數關係——避免「剛好也對」的巧合。 */
const BASE = { 機車: 100, 小型車: 60, 大型車: 20, 特種車: 10, 聯結車: 7 };
/** 尖峰小時裡有幾個 15 分鐘格。 */
const SLOTS_PER_HOUR = 4;
/** 聯結車匯入時要用的當量（獨立分析）——刻意不是 1，才看得出有沒有被用到。 */
const LINK_PCE = { left: 3.1, through: 3.2, right: 3.3 };
/** ② 要換成的新直行當量。 */
const LINK_NEW_THROUGH = 5;

function makeWorkbook({ station, name }) {
  const times = [];
  for (const hour of [7, 8, 17, 18])
    for (const quarter of [0, 15, 30, 45]) {
      const from = `${String(hour).padStart(2, "0")}:${String(quarter).padStart(2, "0")}`;
      const toMinutes = hour * 60 + quarter + 15;
      const to = `${String(Math.floor(toMinutes / 60)).padStart(2, "0")}:${String(toMinutes % 60).padStart(2, "0")}`;
      times.push(`${from}~${to}`);
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
    VEHICLES.forEach((vehicle, vehicleIndex) => {
      rows[4][base + 1 + vehicleIndex * 3] = vehicle;
      movements.forEach((movement, movementIndex) => {
        rows[5][base + 1 + vehicleIndex * 3 + movementIndex] = movement;
      });
    });
    times.forEach((time, rowIndex) => {
      rows[6 + rowIndex][base] = time;
      VEHICLES.forEach((vehicle, vehicleIndex) => {
        movements.forEach((_, movementIndex) => {
          /* ⚠️ 常數，不隨時段或支線變——手算才成立。 */
          rows[6 + rowIndex][base + 1 + vehicleIndex * 3 + movementIndex] =
            BASE[vehicle];
        });
      });
    });
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = Array.from({ length: 4 }).flatMap((_, approach) =>
    VEHICLES.map((__, vehicleIndex) => ({
      s: { r: 4, c: approach * stride + 1 + vehicleIndex * 3 },
      e: { r: 4, c: approach * stride + 3 + vehicleIndex * 3 },
    })),
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "平日");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const server = await serve(8147);
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
await page.goto("http://localhost:8147/");
await page.waitForTimeout(1300);

const go = async (label) => {
  await page
    .locator(`nav button:has-text("${label}"), aside button:has-text("${label}")`)
    .first()
    .click();
  await page.waitForTimeout(700);
};

/* ── 建計畫 ── */
await go("建立與管理計畫");
await page.locator(".project-form input").first().fill("PCE-01");
await page.locator(".project-form input").nth(1).fill("當量重算測試");
await page.locator('.project-form button:has-text("建立計畫")').first().click();
await page.waitForTimeout(800);

/* ── 匯入 ── */
await go("季度批次匯入");
await page.locator(".import-period input").first().fill("115");
await page.locator(".import-period select").first().selectOption("1");
await page.waitForTimeout(300);
const buffer = makeWorkbook({ station: "T90-01", name: "當量北路－當量東路口" });
/*
 * ⚠️ 用「拖曳」而不是 setInputFiles：這一頁的檔案輸入框不是唯一的
 *   input[type=file]，setInputFiles 打到的那一個不會觸發匯入流程，
 *   症狀是「跑完畫面完全沒變」，看起來像匯入失敗其實是根本沒送進去。
 */
await page.locator(".upload-card").first().evaluate((card, base64) => {
  const transfer = new DataTransfer();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  transfer.items.add(
    new File([bytes], "09999T90-01_當量測試路口.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  card.dispatchEvent(
    new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
  );
}, Buffer.from(buffer).toString("base64"));
await page.waitForTimeout(5000);

/* 前置：預覽真的認出「聯結車」是新車種，而且預設是獨立分析。 */
const previewRow = page.locator('tr:has-text("聯結車")').first();
ok(
  "前置：匯入預覽認出「聯結車」是新車種",
  (await previewRow.count()) > 0,
  (await previewRow.count()) > 0 ? "" : "預覽裡找不到聯結車那一列",
);
if (await previewRow.count()) {
  const value = await previewRow.locator("select").first().inputValue();
  ok(
    "前置：新車種預設是「獨立分析」（不是默默併進別的類別）",
    value === "custom:聯結車",
    `select 的值是 ${value}`,
  );
  /* 把聯結車的當量設成刻意不是 1 的值——才看得出它到底有沒有被用到。 */
  const inputs = previewRow.locator('input[type="number"]');
  await inputs.nth(0).fill(String(LINK_PCE.left));
  await inputs.nth(1).fill(String(LINK_PCE.through));
  await inputs.nth(2).fill(String(LINK_PCE.right));
  await page.waitForTimeout(400);
}

const commit = page.locator('button:has-text("確認寫入")');
ok("前置：有「確認寫入」可以按", (await commit.count()) > 0);
if (await commit.count()) {
  await commit.first().click();
  await page.waitForTimeout(4000);
}

/** 目前狀態裡那一筆紀錄的第一支支線、AM 尖峰的數字。 */
const snapshot = () =>
  page.evaluate(async () => {
    const data = JSON.parse((await window.__readState()) || "{}");
    const record = (data.records || [])[0];
    if (!record) return null;
    const approach = record.approaches?.[0];
    const peakKey = approach?.movements?.AM ? "AM" : "PM";
    const m = approach?.movements?.[peakKey];
    return {
      peakKey,
      pce: data.pce,
      mappings: data.vehicleMappings || {},
      left: m?.left,
      through: m?.through,
      right: m?.right,
      vehicle: m?.vehicle || {},
      revision: record.revision,
    };
  });

const first = await snapshot();
ok("前置：資料真的匯進去了", Boolean(first), first ? "" : "state 裡沒有紀錄");
if (!first) {
  await browser.close();
  await server.close?.();
  process.exit(1);
}

/*
 * 前置：尖峰小時的輛數要等於「4 個 15 分鐘格 × 3 個轉向 × BASE」。
 *
 * ⚠️ 這一條是後面所有算術的地基。它不成立的話（例如尖峰其實挑了別的窗、
 *   或格距不是 15 分鐘），底下每一條期望值都會是錯的，
 *   而它們可能剛好也對不上——那時人會以為是「算錯了」，其實是測資沒搞懂。
 */
const expectRaw = (label) => SLOTS_PER_HOUR * 3 * BASE[label];
const rawMismatch = VEHICLES.filter(
  (label) => first.vehicle[KEY_OF[label]] !== expectRaw(label),
);
ok(
  "前置：尖峰小時的各車種輛數＝4 格 × 3 轉向 × 每格固定值",
  rawMismatch.length === 0,
  VEHICLES.map(
    (label) =>
      `${label} ${first.vehicle[KEY_OF[label]]}（應 ${expectRaw(label)}）`,
  ).join("、"),
);

/** 用一組當量手算某一個轉向的 PCU。fold：把某車種折進另一車種。 */
function expectedPcu(move, pce, fold = null) {
  let sum = 0;
  for (const label of VEHICLES) {
    const key = fold && fold.from === label ? KEY_OF[fold.to] : KEY_OF[label];
    const factor = pce[key]?.[move];
    sum += SLOTS_PER_HOUR * BASE[label] * factor;
  }
  return Math.round(sum * 10) / 10;
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.05;

/* ══ ① 匯入當下：獨立分析，用聯結車自己的當量 ══════════════════ */
console.log("\n══ ① 匯入當下：聯結車獨立分析 ══");
ok(
  "前置：聯結車的當量就是剛剛在預覽裡輸入的那一組",
  near(first.pce["custom:聯結車"]?.left, LINK_PCE.left) &&
    near(first.pce["custom:聯結車"]?.through, LINK_PCE.through) &&
    near(first.pce["custom:聯結車"]?.right, LINK_PCE.right),
  JSON.stringify(first.pce["custom:聯結車"]),
);
for (const move of ["left", "through", "right"]) {
  const want = expectedPcu(move, first.pce);
  ok(
    `${move} 的 PCU 等於手算值（五個車種各用自己的當量）`,
    near(first[move], want),
    `程式 ${first[move]}｜手算 ${want}`,
  );
}

/* ══ 反面：沒有按重算之前，改當量不可以自己改掉既有數字 ═══════ */
console.log("\n══ 反面：沒按重算之前，既有數字不可以自己變 ══");
await go("車種轉向當量");
const paramRow = page.locator('tr:has-text("聯結車")').first();
ok("車種轉向當量頁上找得到聯結車那一列", (await paramRow.count()) > 0);
await paramRow.locator('input[type="number"]').nth(1).fill(String(LINK_NEW_THROUGH));
await page.waitForTimeout(900);
const beforeRecompute = await snapshot();
ok(
  "只改當量、還沒按重算時，既有資料的 PCU 一個都沒變",
  near(beforeRecompute.left, first.left) &&
    near(beforeRecompute.through, first.through) &&
    near(beforeRecompute.right, first.right),
  `改前 ${first.through}｜改後 ${beforeRecompute.through}`,
);
ok(
  "但設定本身真的存下去了（不是輸入框沒吃到）",
  near(beforeRecompute.pce["custom:聯結車"]?.through, LINK_NEW_THROUGH),
  `目前直行當量 ${beforeRecompute.pce["custom:聯結車"]?.through}`,
);

/* ══ ② 按下重算：直行 PCU 要剛好差那一筆 ══════════════════════ */
console.log("\n══ ② 只改當量 → 重算 ══");
const recomputeButton = page.locator('button:has-text("用目前的設定重算")');
ok("有「用目前的設定重算」可以按", (await recomputeButton.count()) > 0);
await recomputeButton.first().click();
await page.waitForTimeout(3500);
const afterFactor = await snapshot();

const delta =
  SLOTS_PER_HOUR * BASE["聯結車"] * (LINK_NEW_THROUGH - LINK_PCE.through);
ok(
  "重算之後直行 PCU 剛好增加「4 格 × 聯結車輛數 × 當量差」",
  near(afterFactor.through, first.through + delta),
  `重算前 ${first.through} → 重算後 ${afterFactor.through}（應 ${Math.round((first.through + delta) * 10) / 10}，差 ${delta}）`,
);
ok(
  "重算之後直行 PCU 也等於整組手算值",
  near(afterFactor.through, expectedPcu("through", afterFactor.pce)),
  `程式 ${afterFactor.through}｜手算 ${expectedPcu("through", afterFactor.pce)}`,
);
/*
 * ⚠️ 只改直行當量，左轉與右轉**不可以**跟著變。
 *   少了這一條，「重算時把三個轉向都套成同一個當量」這種錯會通過。
 */
ok(
  "只改直行當量時，左轉與右轉的 PCU 完全沒變",
  near(afterFactor.left, first.left) && near(afterFactor.right, first.right),
  `左 ${first.left}→${afterFactor.left}／右 ${first.right}→${afterFactor.right}`,
);
ok(
  "重算會留下版本號（可以還原）",
  Number(afterFactor.revision) > Number(first.revision),
  `第 ${first.revision} 版 → 第 ${afterFactor.revision} 版`,
);

/* ══ ③ 改成「併入特種車」→ 重算 ═════════════════════════════ */
console.log("\n══ ③ 聯結車併入特種車 → 重算 ══");
await paramRow.locator("select").first().selectOption("special");
await page.waitForTimeout(800);
await page.locator('button:has-text("用目前的設定重算")').first().click();
await page.waitForTimeout(3500);
const merged = await snapshot();

ok(
  "設定確實記成「併入特種車」",
  merged.mappings["custom:聯結車"] === "special",
  JSON.stringify(merged.mappings),
);
ok(
  "車種明細裡不可以再有聯結車（已經併進特種車了）",
  merged.vehicle["custom:聯結車"] === undefined,
  `聯結車 ${merged.vehicle["custom:聯結車"]}`,
);
ok(
  "特種車的輛數 ＝ 原特種車 ＋ 原聯結車",
  merged.vehicle.special === expectRaw("特種車") + expectRaw("聯結車"),
  `${merged.vehicle.special}（應 ${expectRaw("特種車") + expectRaw("聯結車")}）`,
);
/*
 * ⚠️ 這一條是整支測試的核心：併入之後，聯結車那一組當量
 *   （包含剛剛改成 5 的直行）**完全不可以再參與計算**，
 *   全部要改用特種車的當量。
 */
for (const move of ["left", "through", "right"]) {
  const want = expectedPcu(move, merged.pce, { from: "聯結車", to: "特種車" });
  ok(
    `${move} 的 PCU 改用**特種車**的當量重算（聯結車自己的當量不再參與）`,
    near(merged[move], want),
    `程式 ${merged[move]}｜手算 ${want}`,
  );
}
/*
 * 反面：如果程式其實還在用聯結車自己的當量，數字會是另一個值。
 * 明確算出那個「錯誤答案」並確認程式**不等於**它，
 * 才能排除「兩種算法剛好同值」的巧合。
 */
const wrongIfStillIndependent = expectedPcu("through", merged.pce);
ok(
  "而且不等於「還在用聯結車自己的當量」那個值（排除巧合）",
  !near(merged.through, wrongIfStillIndependent),
  `併入後 ${merged.through}｜若仍獨立分析會是 ${wrongIfStillIndependent}`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
await server.close?.();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 當量與併入設定改完之後，重算的數字與手算逐項相符");
