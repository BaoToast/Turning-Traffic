/*
 * ══════════════════════════════════════════════════════════════════
 *  匯出前排版預警：報的必須是圖上真正的重疊
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-10 回報（附兩張截圖）：
 *   「我確認過路口轉向卡彼此沒重疊，不知為什麼仍舊跳有這個警示視窗。
 *     這個警示視窗會阻止我匯出嗎？」
 *
 * 原因（v2.1.63 以前）：diagramCollisionWarnings 自己**估**位置，
 * 假設每個支線的數據框排在半徑 390 的圓周上。但繪圖端在支線
 * **超過 4 個**時根本不是那樣排——它改用外圍固定格位（上排 4、右側 3、
 * 下排 4、左側 3），再用最近距離配位。七叉路口的實際版面與圓周估算
 * 是兩個座標系，必然對不上，所以畫面明明沒重疊卻一直報。
 * 而且「駛入＋駛出」模式每個支線畫**兩張卡**，估算只算一個點。
 *
 * ⚠️ 誤報只是吵人，同一個錯誤反過來會**漏報真正重疊的**——那才危險。
 *
 * ── 這一支刻意迴避的假通過陷阱 ────────────────────────────────
 *
 * 一、只驗「七叉路口不再跳警示」不夠：把這個功能整個拿掉也會過，
 *     而那會讓真正的重疊完全沒有人擋。所以一定要**同時驗刻意疊在
 *     一起的兩張卡會被報出來**，而且報的名字要對。
 * 二、只驗「有沒有報」不夠：報得對不對要看它用的座標是不是圖上的。
 *     所以這裡另外從**畫面上真正的 <g transform>** 把每張卡的矩形讀
 *     出來自己算一次，跟畫面顯示的警示比對——兩者不一致就是紅字。
 * 三、還要證明「這一支腳本抓得到那個舊缺陷」：腳本裡照抄一份 v2.1.63
 *     的圓周估算公式，用同一份七叉資料跑，**它必須報出警示**。
 *     舊公式不報的話，代表這份測資根本重現不了問題，這支腳本就是假的。
 * 四、使用者問的是「會不會擋住匯出」。答案是不會，而這件事要釘住：
 *     有警示時四個匯出鍵仍然全部可按。
 * 五、不用真實調查檔（真實檔不進交付包），用同版型、數字自己編的活頁簿。
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers, readState } from "./read-state.mjs";

const PORT = 8247;

/** 七叉路口的匿名活頁簿：支線數是這個缺陷的觸發條件（> 4 才走外圍格位）。 */
function makeWorkbook({ arms, station, name }) {
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
        movements.forEach((__, movementIndex) => {
          rows[6 + rowIndex][base + 1 + vehicleIndex * 3 + movementIndex] =
            3 + ((approach * 5 + vehicleIndex * 3 + movementIndex + rowIndex) % 9);
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
 * v2.1.63 的估算公式，原封不動抄過來當**對照組**。
 * 它在這份七叉資料上必須報出警示——否則就代表這支腳本重現不了缺陷。
 */
function legacyEstimateWarnings(approaches) {
  const points = approaches.map((approach) => {
    const rad = (approach.angle * Math.PI) / 180;
    const offset =
      approach.cardOffsets?.inbound ||
      approach.cardOffsets?.outbound ||
      approach.cardOffset || { x: 0, y: 0 };
    return {
      name: approach.name,
      x: Math.cos(rad) * 390 + (offset.x || 0),
      y: Math.sin(rad) * 390 + (offset.y || 0),
    };
  });
  const warnings = [];
  for (let left = 0; left < points.length; left += 1)
    for (let right = left + 1; right < points.length; right += 1)
      if (
        Math.abs(points[left].x - points[right].x) < 230 &&
        Math.abs(points[left].y - points[right].y) < 125
      )
        warnings.push(points[left].name + " 與 " + points[right].name);
  return warnings;
}

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await installStateHelpers(page);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(700);
};

await go("建立與管理計畫");
await page.locator(".project-form input").nth(0).fill("A00-PRE");
await page.locator(".project-form input").nth(1).fill("排版預警示範計畫");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(700);
await go("季度批次匯入");
await page.locator('.content label:has-text("調查年度") input').first().fill("115");
await page.locator('.content label:has-text("季度") select').first().selectOption("2");
await page.waitForTimeout(400);

const files = [
  {
    name: "A00T00-07七叉示範路口.xlsx",
    buffer: makeWorkbook({ arms: 7, station: "A00T00-07", name: "七叉示範路口" }),
  },
];
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
for (let wait = 0; wait < 90; wait += 1) {
  await page.waitForTimeout(400);
  const button = page.locator('button:has-text("確認寫入")').first();
  if ((await button.count()) && (await button.isEnabled())) break;
}
const commit = page.locator('button:has-text("確認寫入")').first();
ok("前置：七叉檔解析完成後出現「確認寫入」", (await commit.count()) > 0);
if (await commit.count()) {
  await commit.click();
  await page.waitForTimeout(4000);
}
for (let i = 0; i < 6 && (await page.locator(".presence-modal").count()); i += 1) {
  const closer = page
    .locator('.presence-modal button:has-text("套用並記住"), .presence-modal button:has-text("關閉")')
    .first();
  if (!(await closer.count())) break;
  await closer.click();
  await page.waitForTimeout(700);
}

const state = await readState(page);
console.log(
  "   （診斷）狀態裡的站號：",
  (state?.records || []).map((r) => `${r.station}/${r.approaches?.length}支`).join("、") || "無",
);
const record = (state?.records || []).find((item) => item.approaches?.length === 7);
ok("前置：七叉資料真的進去了", Boolean(record), record ? `${record.approaches.length} 支線` : "找不到");

/*
 * ── 對照組 ────────────────────────────────────────────────────
 * 這一段要證明的不是「舊公式在這一份資料上剛好會誤報」——那要看角度湊不湊巧，
 * 釘住它只會得到一支脆弱的測試。要釘住的是**缺陷本身**：
 * 舊公式算出來的位置，與圖上真正畫出來的位置，根本是兩個座標系。
 * 只要這件事成立，誤報與漏報都是遲早的事，差別只在哪一組角度先中獎。
 * （紅字證明另外用「兩支支線夾角很小」的真實情形做，在腳本最後。）
 */

/* ── 一、七叉的自動版面：畫面上沒有重疊，就不可以報 ───────────── */
/* 可拖曳的數據框畫在「路口轉向圖」這一頁；排版預警顯示在「道路與流向管理」。 */
await go("路口轉向圖");
await page.waitForTimeout(2000);

/**
 * 從**畫面上真正畫出來的 SVG** 把每張數據框的矩形讀出來。
 * 這是這一支的核心：檢查器說的，要跟畫出來的對得起來。
 */
async function drawnCards() {
  return page.evaluate(() => {
    const svg = document.querySelector("#turning-svg");
    if (!svg) return null;
    return [...svg.querySelectorAll("g[data-card-id]")].map((group) => {
      const transform = group.getAttribute("transform") || "";
      const hit = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(transform);
      const rect = group.querySelector("rect.flow-card");
      return {
        id: group.getAttribute("data-card-id"),
        section: group.getAttribute("data-card-section"),
        x: hit ? Number(hit[1]) : NaN,
        y: hit ? Number(hit[2]) : NaN,
        w: Number(rect?.getAttribute("width") || 0),
        h: Number(rect?.getAttribute("height") || 0),
      };
    });
  });
}
/** 用畫面上的矩形自己算一次真正的相交數。 */
function overlapPairs(cards) {
  const pairs = [];
  for (let a = 0; a < cards.length; a += 1)
    for (let b = a + 1; b < cards.length; b += 1) {
      const left = cards[a];
      const right = cards[b];
      if (
        left.x + left.w - 1 > right.x &&
        right.x + right.w - 1 > left.x &&
        left.y + left.h - 1 > right.y &&
        right.y + right.h - 1 > left.y
      )
        pairs.push([left, right]);
    }
  return pairs;
}

const cards = await drawnCards();
ok(
  "前置：畫面上讀得到 14 張數據框（7 支線 × 駛入駛出）",
  Array.isArray(cards) && cards.length === 14,
  `讀到 ${cards?.length ?? 0} 張`,
);
ok(
  /* ⚠️ 空陣列的 every() 恆為 true，會變成假通過，所以先要求張數 > 0。 */
  "前置：每張卡的座標與尺寸都讀得出來（讀不到就不可以拿去做判斷）",
  Array.isArray(cards) &&
    cards.length > 0 &&
    cards.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && c.w > 0 && c.h > 0),
  `${cards?.length ?? 0} 張`,
);
/*
 * 保留區（右下角圖例、中央標籤）的常數必須與畫面上真正畫出來的位置對得上，
 * 否則「蓋住圖例」那一條就會變成另一個估算式的誤報。這裡直接量 DOM。
 */
const reservedOnScreen = await page.evaluate(() => {
  const svg = document.querySelector("#turning-svg");
  if (!svg) return null;
  const legend = svg.querySelector("g.legend");
  const centre = svg.querySelector("rect.junction");
  const rect = (node) => {
    if (!node) return null;
    const box = node.getBBox();
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  };
  return { legend: rect(legend), centre: rect(centre) };
});
console.log("   （診斷）畫面上的保留區：", JSON.stringify(reservedOnScreen));
console.log(
  "   （診斷）每張卡：",
  (cards || [])
    .map((c) => `${c.id.slice(-4)}/${c.section} (${c.x},${c.y},${c.w}×${c.h})`)
    .join(" "),
);
const drawnOverlaps = overlapPairs(cards || []);
ok(
  "自動排版的七叉路口，畫面上本來就沒有任何兩張卡重疊",
  drawnOverlaps.length === 0,
  drawnOverlaps.map(([a, b]) => `${a.id}/${a.section}×${b.id}/${b.section}`).join("、"),
);
/*
 * 舊公式 vs 畫面實測：同一支支線，兩者差多遠。
 * 舊公式的絕對座標是 cx + cos(角度)×390、cy + sin(角度)×390。
 */
const spaceGap = (cards || []).length
  ? record.approaches.map((approach) => {
      const rad = (approach.angle * Math.PI) / 180;
      const guess = { x: 600 + Math.cos(rad) * 390, y: 470 + Math.sin(rad) * 390 };
      const mine = cards.filter((c) => c.id === approach.id);
      const near = Math.min(
        ...mine.map((c) =>
          Math.hypot(c.x + c.w / 2 - guess.x, c.y + c.h / 2 - guess.y),
        ),
      );
      return { name: approach.name, gap: Math.round(near) };
    })
  : [];
/*
 * ⚠️ 不可以寫成「每一支都差很遠」——圓周上總有幾支剛好落在外圍格位附近
 *   （這一份就有兩支只差 47px）。那正是誤報時好時壞、難以重現的原因。
 *   要釘的是「兩者對不起來」：最遠的那一支差很多，而且平均就已經偏掉。
 */
const worstGap = Math.max(...spaceGap.map((g) => g.gap));
const meanGap = spaceGap.reduce((sum, g) => sum + g.gap, 0) / (spaceGap.length || 1);
ok(
  "對照組：舊公式估的位置與圖上實際位置對不起來（這才是缺陷本身）",
  spaceGap.length > 0 && worstGap > 150 && meanGap > 90,
  `最遠 ${worstGap}px、平均 ${Math.round(meanGap)}px｜` +
    spaceGap.map((g) => `${g.name}:${g.gap}px`).join("、"),
);

await go("道路與流向管理");
await page.waitForTimeout(1200);
const warningPanel = page.locator(".collision-warning");
ok(
  "畫面沒有重疊時，道路與流向管理不可以跳排版預警（使用者回報的那一項）",
  (await warningPanel.count()) === 0,
  (await warningPanel.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 100),
);

await go("批次輸出");
await page.waitForTimeout(900);
const preflight = page.locator(".export-preflight");
ok("前置：匯出前檢查面板在", (await preflight.count()) > 0);
ok(
  "沒有重疊時徽章要寫「可匯出」",
  (await preflight.locator("strong").innerText()).trim() === "可匯出",
  (await preflight.locator("strong").innerText()).trim(),
);

/* ── 二、匯出鍵在任何狀態下都不可以被這個警示擋住 ─────────────── */
const EXPORT_BUTTONS = ["下載批次成果 ZIP", "產生", "下載 SVG"];
async function exportButtonStates() {
  return Promise.all(
    EXPORT_BUTTONS.map(async (label) => {
      const button = page.locator(`button:has-text("${label}")`).first();
      if (!(await button.count())) return { label, present: false, enabled: false };
      return { label, present: true, enabled: await button.isEnabled() };
    }),
  );
}
const beforeStates = await exportButtonStates();
ok(
  "前置：三個匯出鍵都在畫面上",
  beforeStates.every((s) => s.present),
  beforeStates.map((s) => `${s.label}:${s.present ? "有" : "沒有"}`).join("／"),
);

/* ── 三、刻意把兩張卡疊在一起：一定要報，而且要報對是哪兩張 ───── */
await go("路口轉向圖");
await page.waitForTimeout(1500);
const before = await drawnCards();
/*
 * 直接把第二張卡拖到第一張卡的位置上。
 * ⚠️ 用滑鼠拖曳而不是改狀態：改狀態只驗到判斷式，驗不到「使用者真的把
 *    卡拖到一起時系統會不會講」，而後者才是這個功能存在的理由。
 */
const box = await page.locator("#turning-svg").boundingBox();
const svgWidth = await page.evaluate(
  () => Number(document.querySelector("#turning-svg")?.getAttribute("width") || 0),
);
const scale = box && svgWidth ? box.width / svgWidth : 1;
const target = before[0];
const mover = before[1];
const toScreen = (x, y) => ({ x: box.x + x * scale, y: box.y + y * scale });
const from = toScreen(mover.x + mover.w / 2, mover.y + mover.h / 2);
const to = toScreen(target.x + target.w / 2 + 12, target.y + target.h / 2 + 8);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
await page.mouse.move(to.x, to.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(1500);

const after = await drawnCards();
const afterOverlaps = overlapPairs(after || []);
ok(
  "前置：拖曳之後畫面上真的有兩張卡疊在一起了",
  afterOverlaps.length > 0,
  `${afterOverlaps.length} 組`,
);
await go("道路與流向管理");
await page.waitForTimeout(1200);
const warnText = (await page.locator(".collision-warning").innerText().catch(() => "")).replace(/\s+/g, " ");
ok(
  "真的疊在一起時**一定**要報（不可以為了消掉誤報就把功能拿掉）",
  warnText.length > 0,
  warnText.slice(0, 120),
);
ok(
  "警示要寫明不影響匯出",
  /不影響匯出/.test(warnText),
  warnText.slice(0, 120),
);
/*
 * 報的名字要對：疊在一起的那兩張卡屬於哪兩支支線，警示裡就要出現那兩個名字。
 * 只驗「有報」會被「無條件報第一組」騙過去。
 */
if (afterOverlaps.length && record) {
  const nameOf = (id) => record.approaches.find((a) => a.id === id)?.name || "";
  const expected = [nameOf(afterOverlaps[0][0].id), nameOf(afterOverlaps[0][1].id)];
  ok(
    "報出來的名字要是真正疊在一起的那兩支",
    expected.every((name) => name && warnText.includes(name)),
    `畫面上疊的是「${expected.join("」與「")}」；警示寫：${warnText.slice(0, 90)}`,
  );
}

await go("批次輸出");
await page.waitForTimeout(900);
const badge = (await preflight.locator("strong").innerText()).trim();
ok("有警示時徽章寫「建議調整」，不是「需調整」", badge === "建議調整", badge);
const preflightText = (await preflight.innerText()).replace(/\s+/g, " ");
ok(
  "匯出前檢查要直接告訴使用者「不會被擋住」",
  /不會被擋住|不影響匯出/.test(preflightText),
  preflightText.slice(0, 140),
);
const afterStates = await exportButtonStates();
ok(
  "⚠️ 有警示時四個匯出鍵仍然全部可以按（使用者問的就是這一題）",
  afterStates.every((s) => s.present && s.enabled),
  afterStates.map((s) => `${s.label}:${s.enabled ? "可按" : "被鎖"}`).join("／"),
);

/* ── 四、紅字證明：舊公式真的會在合理的版面上誤報 ───────────────
 *
 * 真實的七叉路口不會剛好等分 360°，常常有兩支夾角很小（例如岔出來的側巷）。
 * 這裡把支線角度改成不平均、且有一組夾角 15°，其他都不動：
 *   ・舊公式：那兩支在半徑 390 的圓周上只差 13px／101px → **報重疊**
 *   ・畫面實際：外圍格位一支一格，兩張卡分得開 → **不該報**
 * 這一組就是使用者遇到的情形的最小重現。
 */
const UNEVEN = [0, 15, 62, 128, 186, 244, 300];
await page.evaluate(
  async (payload) => {
    const raw = await window.__readState();
    const state = JSON.parse(raw);
    for (const item of state.records)
      if (item.approaches?.length === 7)
        item.approaches.forEach((approach, index) => {
          approach.angle = payload[index];
          /* 順手把剛才拖出來的位移清掉，確保這一輪看的是自動版面。 */
          approach.cardOffsets = undefined;
          approach.cardLayouts = undefined;
          approach.cardOffset = undefined;
        });
    await window.__writeState(JSON.stringify(state));
  },
  UNEVEN,
);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2200);

const unevenLegacy = legacyEstimateWarnings(
  record.approaches.map((approach, index) => ({
    ...approach,
    angle: UNEVEN[index],
    cardOffsets: undefined,
    cardOffset: undefined,
  })),
);
ok(
  "紅字證明：同一組角度下，舊公式會報出重疊（這就是使用者看到的那個假警示）",
  unevenLegacy.length > 0,
  unevenLegacy.join("、") || "舊公式沒報 → 這組角度重現不了問題",
);

await go("路口轉向圖");
await page.waitForTimeout(2000);
const unevenCards = await drawnCards();
const unevenOverlaps = overlapPairs(unevenCards || []);
ok(
  "同一組角度下，畫面上其實沒有任何兩張卡重疊",
  (unevenCards || []).length === 14 && unevenOverlaps.length === 0,
  `${unevenCards?.length ?? 0} 張／重疊 ${unevenOverlaps.length} 組`,
);
await go("道路與流向管理");
await page.waitForTimeout(1200);
ok(
  "⚠️ 本版在同一組角度下不可以再報（舊版紅、新版綠，就差在這一項）",
  (await page.locator(".collision-warning").count()) === 0,
  (await page.locator(".collision-warning").innerText().catch(() => ""))
    .replace(/\s+/g, " ")
    .slice(0, 120),
);

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 3).join(" ｜ "));

await browser.close();
server.close();
console.log(
  problems.length
    ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}`
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
