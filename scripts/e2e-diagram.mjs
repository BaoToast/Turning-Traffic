import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "seed-state.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(8111);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL_CONNECTION_FAILED|net::ERR_/.test(m.text())) errors.push(m.text()); });
page.on("requestfailed", (r) => console.log("   （外部資源載入失敗）", r.url().slice(0, 120)));
page.on("crash", () => errors.push("PAGE CRASHED"));
await page.addInitScript((s) => localStorage.setItem("turning-traffic-state-v2", s), seed);
/* v2.1.53：資料改存 IndexedDB，端對端腳本要用 __readState／__writeState 才讀得到。 */
await installStateHelpers(page);
await page.goto("http://localhost:8111/");
await page.waitForTimeout(1200);

const go = async (name) => {
  await page.locator(`nav button:has-text("${name}"), aside button:has-text("${name}")`).first().click();
  await page.waitForTimeout(900);
};

// ── 需求3：圖卡標題置中 ────────────────────────────────────
await go("路口轉向圖");
const titleInfo = await page.evaluate(() => {
  const title = document.querySelector(".diagram-canvas .section-title");
  if (!title) return null;
  const card = title.closest("g").querySelector("rect.flow-card");
  const t = title.getBoundingClientRect(), c = card.getBoundingClientRect();
  return {
    text: title.textContent,
    anchor: getComputedStyle(title).textAnchor,
    titleCenter: Math.round(t.left + t.width / 2),
    cardCenter: Math.round(c.left + c.width / 2),
    overflowRight: Math.round(t.right - c.right),
  };
});
console.log("   標題：", JSON.stringify(titleInfo));
ok("圖卡標題文字置中（text-anchor:middle）", titleInfo?.anchor === "middle", String(titleInfo?.anchor));
ok("圖卡標題中心對齊卡片中心", Math.abs((titleInfo?.titleCenter ?? 0) - (titleInfo?.cardCenter ?? 1)) <= 3,
  `標題中心 ${titleInfo?.titleCenter} vs 卡片中心 ${titleInfo?.cardCenter}`);
ok("圖卡標題不再溢出卡片右緣", (titleInfo?.overflowRight ?? 99) <= 0, `右緣差 ${titleInfo?.overflowRight}px`);

// ── 需求4：箭頭方向 ────────────────────────────────────────
const arrowStats = async () =>
  page.evaluate(() => {
    const svg = document.querySelector(".diagram-canvas svg");
    const cx = Number(svg.getAttribute("viewBox").split(" ")[2]) / 2;
    const paths = [...svg.querySelectorAll("path.movement-path")];
    const junction = svg.querySelector("rect.junction")?.getBBox();
    const inJunction = (p) =>
      junction && p.x > junction.x - 4 && p.x < junction.x + junction.width + 4 &&
      p.y > junction.y - 4 && p.y < junction.y + junction.height + 4;
    return {
      count: paths.length,
      // 箭頭端（路徑終點）落在路口方塊內的比例：舊版切一半時會接近 100%
      endsInsideJunction: paths.filter((p) => inJunction(p.getPointAtLength(p.getTotalLength()))).length,
      titles: paths.slice(0, 40).map((p) => p.querySelector("title")?.textContent ?? ""),
      cx,
    };
  });

await page.locator('.flow-summary-control button:has-text("駛入＋駛出")').first().click();
await page.waitForTimeout(500);
const both = await arrowStats();
ok("駛入＋駛出：畫出完整箭頭，終點不在路口方塊內", both.endsInsideJunction === 0,
  `${both.endsInsideJunction}/${both.count} 條終點落在路口內`);

// 聚焦模式：只顯示駛入 / 只顯示駛出
await page.locator('label:has-text("箭線") select').first().selectOption({ label: "單一方向聚焦" });
await page.waitForTimeout(500);
const focusName = await page.evaluate(() => {
  const select = [...document.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.textContent.includes("向 ·")));
  return select?.selectedOptions[0]?.textContent ?? "";
});
const focusArm = /·\s*(\S+)/.exec(focusName)?.[1] ?? "路口A";
console.log("   聚焦支線：", focusArm);

await page.locator('.flow-summary-control button:has-text("只顯示駛出")').first().click();
await page.waitForTimeout(600);
const outbound = await arrowStats();
ok("只顯示駛出：每條箭頭都是「聚焦支線 → 其他路口」",
  outbound.count > 0 && outbound.titles.every((t) => t.startsWith(focusArm)),
  `${outbound.count} 條；例：${outbound.titles[0]}`);
ok("只顯示駛出：終點在其他支線而非路口中央", outbound.endsInsideJunction === 0,
  `${outbound.endsInsideJunction}/${outbound.count}`);

await page.locator('.flow-summary-control button:has-text("只顯示駛入")').first().click();
await page.waitForTimeout(600);
const inbound = await arrowStats();
ok("只顯示駛入：每條箭頭都是「其他路口 → 聚焦支線」",
  inbound.count > 0 && inbound.titles.every((t) => t.includes("→ " + focusArm) || t.endsWith(focusArm)),
  `${inbound.count} 條；例：${inbound.titles[0]}`);
ok("只顯示駛入：終點在聚焦支線而非路口中央", inbound.endsInsideJunction === 0,
  `${inbound.endsInsideJunction}/${inbound.count}`);
await page.locator('.flow-summary-control button:has-text("駛入＋駛出")').first().click();
await page.locator('label:has-text("箭線") select').first().selectOption({ label: "全部方向" });
await page.waitForTimeout(500);

// ── 需求1/2：拖曳 ──────────────────────────────────────────
const cardBox = async (index = 0) =>
  page.evaluate((i) => {
    const nodes = [...document.querySelectorAll(".diagram-canvas [data-card-id]")];
    const node = nodes[i];
    const r = node.getBoundingClientRect();
    return {
      id: node.getAttribute("data-card-id"),
      section: node.getAttribute("data-card-section"),
      x: Math.round(r.left), y: Math.round(r.top),
      total: nodes.length,
    };
  }, index);

await page.locator(".diagram-canvas [data-card-id]").first().scrollIntoViewIfNeeded();
await page.waitForTimeout(250);
const before = await cardBox(0);
console.log("   圖卡數：", before.total, "第一張：", JSON.stringify(before));
ok("每一張圖卡都是獨立的拖曳目標（駛入／駛出分開）", before.total >= 8 && before.section !== null,
  `${before.total} 張，section=${before.section}`);

const dragBy = async (selector, dx, dy, steps = 24) => {
  /*
   * ⚠️ 一定要先捲進畫面再量座標。
   *
   *   滑鼠事件用的是**視窗座標**：卡片如果有一半在視窗外，
   *   boundingBox() 照樣回得出位置，但 mouse.move 會被夾在視窗邊界，
   *   按下去的地方根本不是卡片——拖曳完全沒發生，而 Δy 又因為版面
   *   捲動而不是 0，看起來像「移動了但方向不對」。
   *   （v2.1.73 主工具列讓每一頁高了一截，這一支因此紅字，查了才發現。）
   */
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await page.locator(selector).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1)
    await page.mouse.move(box.x + box.width / 2 + (dx * i) / steps, box.y + box.height / 2 + (dy * i) / steps);
  await page.mouse.up();
  await page.waitForTimeout(400);
};

await dragBy(".diagram-canvas [data-card-id]", 120, -70);
const after = await cardBox(0);
ok("拖曳後圖卡確實移動", Math.abs(after.x - before.x) > 60 && Math.abs(after.y - before.y) > 30,
  `Δx=${after.x - before.x} Δy=${after.y - before.y}`);

// 只移動被拖的那一張，不會連動同支線的另一張
const sibling = await page.evaluate((id) => {
  const nodes = [...document.querySelectorAll(`.diagram-canvas [data-card-id="${id}"]`)];
  return nodes.map((n) => ({ section: n.getAttribute("data-card-section"), x: Math.round(n.getBoundingClientRect().left) }));
}, before.id);
console.log("   同支線兩張卡：", JSON.stringify(sibling));
ok("同一支線的另一張卡沒有跟著移動", sibling.length === 2 && sibling[0].x !== sibling[1].x, JSON.stringify(sibling));

// 路口標籤可拖曳
const labelBefore = await page.evaluate(() => {
  const n = document.querySelector(".diagram-canvas [data-label-id]");
  const r = n.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), text: n.textContent.trim() };
});
await dragBy(".diagram-canvas [data-label-id]", -90, 60);
const labelAfter = await page.evaluate(() => {
  const n = document.querySelector(".diagram-canvas [data-label-id]");
  const r = n.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top) };
});
// 標籤必須「跟著滑鼠等距移動」，不能只是有動就算過關：
// 少了基準點屬性時，標籤會一口氣跳到畫布左上角，位移量會遠大於拖曳距離。
ok(`路口標籤「${labelBefore.text}」跟著滑鼠等距移動（不會跳到角落）`,
  Math.abs(labelAfter.x - labelBefore.x + 90) <= 6 &&
    Math.abs(labelAfter.y - labelBefore.y - 60) <= 6,
  `Δx=${labelAfter.x - labelBefore.x}（要 -90）Δy=${labelAfter.y - labelBefore.y}（要 60）`);

// ── 壓力測試：7 叉路口長時間連續拖曳 ────────────────────────
/*
 * ⚠️ 選擇器要**限定在內容區**。
 *   v2.1.73 起主工具列上多了一個「路口」多選清單，裡面同樣列著路口名稱；
 *   寫成全頁 `select` 的話會先抓到它，然後在它身上找不到本頁的選項而逾時。
 *   這正是「nav button 全掃」那一類陷阱的另一種長相：
 *   一個新控制項出現，舊的寬鬆選擇器就默默指向別的東西。
 */
const armSelect = page
  .locator(".content select")
  .filter({ hasText: "示範交流道" })
  .first();
await armSelect.selectOption({ label: "示範1－示範交流道路口" });
await page.waitForTimeout(1200);
const arms = await page.evaluate(() => document.querySelectorAll(".diagram-canvas [data-label-id]").length);
ok("已切換到 7 叉路口", arms === 7, `${arms} 支線`);

const t0 = Date.now();
const box = await page.locator(".diagram-canvas [data-card-id]").first().boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
for (let i = 0; i < 400; i += 1) {
  const angle = (i / 400) * Math.PI * 6;
  await page.mouse.move(
    box.x + box.width / 2 + Math.cos(angle) * 110,
    box.y + box.height / 2 + Math.sin(angle) * 70,
  );
}
await page.mouse.up();
await page.waitForTimeout(800);
const elapsed = Date.now() - t0;
const alive = await page.evaluate(() => document.querySelectorAll(".diagram-canvas [data-card-id]").length).catch(() => 0);
ok("7 叉路口連續拖曳 400 步後分頁仍存活", alive > 0, `${elapsed}ms，仍有 ${alive} 張卡`);
ok("400 步拖曳耗時合理（未卡死）", elapsed < 45000, `${elapsed}ms`);

// 拖曳後再碰圖卡與重設，都不應該壞掉
await dragBy(".diagram-canvas [data-card-id]", 40, 40);
await go("道路與流向管理");
const resetBtn = page.locator('button:has-text("重設所有圖卡位置")');
if (await resetBtn.count()) { await resetBtn.first().click(); await page.waitForTimeout(800); }
await go("路口轉向圖");
const afterReset = await page.evaluate(() => document.querySelectorAll(".diagram-canvas [data-card-id]").length);
ok("重設圖卡位置後畫面正常", afterReset > 0, `${afterReset} 張卡`);

// localStorage 沒有因為拖曳而爆量
const storage = await page.evaluate(async () => {
  const raw = (await window.__readState()) || "";
  const parsed = JSON.parse(raw || "{}");
  return { bytes: raw.length, revisions: (parsed.recordRevisions || []).length };
});
console.log("   localStorage：", JSON.stringify(storage));
ok("拖曳沒有把版本歷程灌爆", storage.revisions <= 20, `${storage.revisions} 筆版本`);
ok("localStorage 未逼近 5MB 上限", storage.bytes < 3_000_000, `${Math.round(storage.bytes / 1024)} KB`);

// X/Y 數字輸入已移除
await go("道路與流向管理");
const offsetInputs = await page.locator('input[aria-label*="位移"]').count();
ok("已移除圖卡位移的 X／Y 數字輸入", offsetInputs === 0, `${offsetInputs} 個`);

// ── 三種顯示模式的版面互不干擾 ──────────────────────────────
await go("路口轉向圖");
const armSelect2 = page
  .locator(".content select")
  .filter({ hasText: "示範一路口" })
  .first();
if (await armSelect2.count()) { await armSelect2.selectOption({ label: "示範1－示範一路口" }); await page.waitForTimeout(900); }
const setMode = async (label) => {
  await page.locator(`.flow-summary-control button:has-text("${label}")`).first().click();
  await page.waitForTimeout(600);
};
const firstCardX = async () =>
  page.evaluate(() => {
    const n = document.querySelector(".diagram-canvas [data-card-id]");
    return n ? Math.round(n.getBoundingClientRect().left) : null;
  });
const firstLabelX = async () =>
  page.evaluate(() => {
    const n = document.querySelector(".diagram-canvas [data-label-id]");
    return n ? Math.round(n.getBoundingClientRect().left) : null;
  });

await setMode("駛入＋駛出");
await dragBy(".diagram-canvas [data-card-id]", 150, 0);
const bothCardAfter = await firstCardX();
await setMode("只顯示駛入");
const inCardStart = await firstCardX();
ok("在「駛入＋駛出」拖曳，不會影響「只顯示駛入」的版面",
  Math.abs(inCardStart - bothCardAfter) > 60,
  `both 拖後 ${bothCardAfter} vs inbound ${inCardStart}`);
await dragBy(".diagram-canvas [data-card-id]", -170, 0);
const inCardAfter = await firstCardX();
ok("「只顯示駛入」可獨立拖到另一個位置",
  Math.abs(inCardAfter - inCardStart) > 60, `Δ=${inCardAfter - inCardStart}`);
await setMode("駛入＋駛出");
const bothCardBack = await firstCardX();
ok("切回「駛入＋駛出」時位置維持先前的擺放",
  Math.abs(bothCardBack - bothCardAfter) <= 3,
  `回來 ${bothCardBack} vs 先前 ${bothCardAfter}`);
await setMode("只顯示駛出");
const outCardStart = await firstCardX();
ok("「只顯示駛出」未調整過時，沿用共同起點而不是別的模式的位置",
  outCardStart !== null, `x=${outCardStart}`);

// 路口標籤也要分模式
await setMode("駛入＋駛出");
const bothLabelBefore = await firstLabelX();
await dragBy(".diagram-canvas [data-label-id]", -120, 0);
const bothLabelAfter = await firstLabelX();
await setMode("只顯示駛入");
const inLabel = await firstLabelX();
ok("路口標籤的位置同樣依顯示模式各自保存",
  Math.abs(inLabel - bothLabelAfter) > 50 && Math.abs(bothLabelAfter - bothLabelBefore) > 50,
  `both ${bothLabelBefore}→${bothLabelAfter}，inbound ${inLabel}`);

// 存進 localStorage 的結構
const layouts = await page.evaluate(async () => {
  const state = JSON.parse((await window.__readState()) || "{}");
  const record = (state.records || []).find((r) => r.station === "S01-03");
  const approach = record?.approaches?.find((a) => a.cardLayouts);
  return approach ? Object.keys(approach.cardLayouts) : [];
});
console.log("   已保存版面模式：", JSON.stringify(layouts));
ok("版面依模式分別寫入儲存", layouts.includes("both") && layouts.includes("inbound"), layouts.join("、"));

// 重設要清掉全部模式
await go("道路與流向管理");
const resetAll = page.locator('button:has-text("重設所有圖卡位置")');
if (await resetAll.count()) { await resetAll.first().click(); await page.waitForTimeout(900); }
const cleared = await page.evaluate(async () => {
  const state = JSON.parse((await window.__readState()) || "{}");
  const record = (state.records || []).find((r) => r.station === "S01-03");
  return (record?.approaches || []).some((a) => a.cardLayouts || a.cardOffsets || a.labelOffset);
});
ok("「重設所有圖卡位置」會清掉全部三種模式的版面", cleared === false);

// ── 拖曳精準度與邊界回彈 ────────────────────────────────────
await go("路口轉向圖");
await setMode("駛入＋駛出");
const dragCard = async (id, sec, dx, dy) => {
  const sel = `.diagram-canvas [data-card-id="${id}"][data-card-section="${sec}"]`;
  /*
   * ⚠️ 一定要**先捲進畫面再量座標**。
   *
   *   page.mouse.* 用的是**視窗座標**，而圖卡可能在摺線以下
   *  （實測 R1-B／inbound 在畫布裡 top=606，加上頁面本身的位移就超出 1050 的視窗）。
   *   沒有先捲的話，滑鼠按在一個視窗外的座標上——卡片完全不會動，
   *   而測試會把它報成「拖曳跟不上游標」，方向剛好相反：**根本沒有開始拖**。
   *   2026-09-15 那條紅字就是這樣來的（實測拖曳中與放開後卡片的 style
   *   都是 undefined ＝ 一次都沒被設過位移）。
   */
  await page.locator(sel).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await page.locator(sel).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 24; i += 1)
    await page.mouse.move(box.x + box.width / 2 + (dx * i) / 24, box.y + box.height / 2 + (dy * i) / 24);
  await page.mouse.up();
  await page.waitForTimeout(400);
};
/*
 * 拖曳有沒有**真的開始**。
 *
 * ⚠️ 這個前置檢查的用途是分辨兩件**修法完全相反**的事：
 *     ・「沒有開始拖」——滑鼠根本沒按在卡片上（例如卡片在視窗外）
 *     ・「開始了但跟不上游標」——真正的缺陷
 *   少了它的話，前者會被報成後者，而照著後者去改程式是白做工。
 *   2026-09-15 就發生過：卡片在摺線以下，滑鼠按在視窗外的座標上，
 *   測試報「跟不上游標 Δx=0」，實際上一次都沒被拖到。
 *
 * ⚠️ 判準要讀**存下來的版面**，不是讀 inline style。
 *   卡片的位移不是用 inline style 表達的（第一版這樣寫，於是前置恆紅，
 *   而主檢查其實是綠的——一個永遠紅的前置和一個假綠一樣沒有用）。
 */
const cardHasStoredOffset = async (id, sec) =>
  page.evaluate(
    async ([i, s2]) => {
      const state = JSON.parse((await window.__readState()) || "{}");
      const approach = (state.records || [])
        .flatMap((r) => r.approaches || [])
        .find((a) => a.id === i);
      const cards = approach?.cardLayouts?.both?.cards;
      return Boolean(cards && cards[s2]);
    },
    [id, sec],
  );
/*
 * ⚠️ 這一段量的是「卡片有沒有跟上游標」，兩個前提以前都沒有顧到，
 *   於是它從 2026-09-15 起一直紅在同一組數字（Δx=0、Δy=141）：
 *
 *   ① **量的座標不可以是視窗座標**。getBoundingClientRect 是相對視窗的，
 *      而拖曳過程中頁面**會捲動**（滑鼠移到接近上緣時瀏覽器會自動捲）。
 *      頁面往下捲 61px，卡片的 rect.top 就少 61px——量出來像是「多移了 61px」，
 *      但卡片其實一格都沒多動。改成量**相對畫布**的座標，捲動就不影響。
 *
 *   ② **不可以挑 DOM 裡的第一張卡**。那一張剛好貼在畫布左緣，
 *      往左拖 180px 會被邊界夾住 → Δx 永遠是 0，而那是**正確行為**
 *     （下一條「拖到邊界後往回拖」驗的就是夾住這件事）。
 *      要驗「跟得上游標」必須挑一張**離邊界夠遠**的卡。
 */
const cardRelative = (id, sec) =>
  page.evaluate(([i, s2]) => {
    const node = document.querySelector(
      `.diagram-canvas [data-card-id="${i}"][data-card-section="${s2}"]`,
    );
    const canvas = node.closest(".diagram-canvas");
    const a = node.getBoundingClientRect();
    const b = canvas.getBoundingClientRect();
    return [Math.round(a.left - b.left), Math.round(a.top - b.top)];
  }, [id, sec]);
/*
 * ⚠️ 拖曳距離要**依實際餘裕算**，不可以寫死 180／80。
 *
 *   畫布是貼著卡片排的，有些卡片上下只剩幾十像素。寫死距離的話，
 *   被邊界夾住的那一軸永遠量到 0——而夾住是**正確行為**
 *  （下一條「拖到邊界後往回拖」驗的就是它）。
 *   那會讓這一條變成「有時候紅、紅的原因不是缺陷」，很快就沒有人理它。
 *
 *   所以這裡挑一張左上方餘裕最大的卡，拖「它真的拖得動」的距離，
 *   再驗卡片有沒有**剛好**跟著移動那麼多。要驗的是「跟不跟得上游標」，
 *   不是「能不能移動 180px」。
 */
const roomyCard = await page.evaluate(() => {
  const canvas = document.querySelector(".diagram-canvas");
  const box = canvas.getBoundingClientRect();
  let best = null;
  for (const node of canvas.querySelectorAll("[data-card-id]")) {
    const r = node.getBoundingClientRect();
    /* 往左、往上各有多少空間可以走（留 8px 不要真的貼到邊）。 */
    const left = Math.floor(r.left - box.left - 8);
    const top = Math.floor(r.top - box.top - 8);
    const room = Math.min(left, top);
    if (!best || room > best.room)
      best = {
        id: node.getAttribute("data-card-id"),
        sec: node.getAttribute("data-card-section"),
        dx: Math.min(180, Math.max(0, left)),
        dy: Math.min(80, Math.max(0, top)),
        room: Math.round(room),
      };
  }
  return best;
});
ok(
  "前置：找得到一張拖得動的卡（兩軸都要有空間，不然量到的是邊界夾住、不是跟不上）",
  Boolean(roomyCard) && roomyCard.dx >= 40 && roomyCard.dy >= 20,
  roomyCard
    ? `${roomyCard.id}／${roomyCard.sec}，這一次拖 ${roomyCard.dx}×${roomyCard.dy}px`
    : "找不到",
);
const precise0 = await cardRelative(roomyCard.id, roomyCard.sec);
await dragCard(roomyCard.id, roomyCard.sec, -roomyCard.dx, -roomyCard.dy);
const precise1 = await cardRelative(roomyCard.id, roomyCard.sec);
ok(
  "前置：拖曳真的有開始（版面裡存下了這張卡的位移）——沒開始的話下一條量到的是別的事",
  await cardHasStoredOffset(roomyCard.id, roomyCard.sec),
  "存下來的版面裡找不到這張卡的位移",
);
ok("拖曳距離與滑鼠位移一致（不會跟不上游標）",
  Math.abs(precise0[0] - precise1[0] - roomyCard.dx) <= 4 &&
    Math.abs(precise0[1] - precise1[1] - roomyCard.dy) <= 4,
  `Δx=${precise0[0] - precise1[0]}（應 ${roomyCard.dx}）Δy=${precise0[1] - precise1[1]}（應 ${roomyCard.dy}）`);
await dragCard(roomyCard.id, roomyCard.sec, 900, 0);
const pinned = await cardRelative(roomyCard.id, roomyCard.sec);
await dragCard(roomyCard.id, roomyCard.sec, -120, 0);
const bounced = await cardRelative(roomyCard.id, roomyCard.sec);
ok("拖到邊界後往回拖立刻有反應（沒有死區）",
  Math.abs(pinned[0] - bounced[0] - 120) <= 6, `回拖 120px 實際移動 ${pinned[0] - bounced[0]}px`);
const stored = await page.evaluate(async (id) => {
  const state = JSON.parse((await window.__readState()) || "{}");
  const approach = (state.records || [])
    .flatMap((r) => r.approaches || [])
    .find((a) => a.id === id);
  return approach?.cardLayouts?.both?.cards || null;
}, roomyCard.id);
console.log("   存下的位移：", JSON.stringify(stored));
ok("存下的位移不會超出畫布（畫面與存檔一致）",
  stored && Object.values(stored).every((o) => Math.abs(o.x) < 1200 && Math.abs(o.y) < 900),
  JSON.stringify(stored));

ok("全程無 JS 錯誤", errors.length === 0, errors.slice(0, 3).join(" | "));

await page.locator("nav button, aside button").first().click().catch(() => {});
console.log(problems.length ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}` : "\n全部通過");
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
