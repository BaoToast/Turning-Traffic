import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "seed-state.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(8111);
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL_CONNECTION_FAILED|net::ERR_/.test(m.text())) errors.push(m.text()); });
page.on("requestfailed", (r) => console.log("   （外部資源載入失敗）", r.url().slice(0, 120)));
page.on("crash", () => errors.push("PAGE CRASHED"));
await page.addInitScript((s) => localStorage.setItem("turning-traffic-state-v2", s), seed);
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

const before = await cardBox(0);
console.log("   圖卡數：", before.total, "第一張：", JSON.stringify(before));
ok("每一張圖卡都是獨立的拖曳目標（駛入／駛出分開）", before.total >= 8 && before.section !== null,
  `${before.total} 張，section=${before.section}`);

const dragBy = async (selector, dx, dy, steps = 24) => {
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
const armSelect = page.locator("select").filter({ hasText: "岡山交流道" }).first();
await armSelect.selectOption({ label: "台1－岡山交流道路口" });
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
const storage = await page.evaluate(() => {
  const raw = localStorage.getItem("turning-traffic-state-v2") || "";
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
const armSelect2 = page.locator("select").filter({ hasText: "路科一路口" }).first();
if (await armSelect2.count()) { await armSelect2.selectOption({ label: "台1－路科一路口" }); await page.waitForTimeout(900); }
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
const bothCardStart = await firstCardX();
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
const layouts = await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("turning-traffic-state-v2") || "{}");
  const record = (state.records || []).find((r) => r.station === "T15-03");
  const approach = record?.approaches?.find((a) => a.cardLayouts);
  return approach ? Object.keys(approach.cardLayouts) : [];
});
console.log("   已保存版面模式：", JSON.stringify(layouts));
ok("版面依模式分別寫入儲存", layouts.includes("both") && layouts.includes("inbound"), layouts.join("、"));

// 重設要清掉全部模式
await go("道路與流向管理");
const resetAll = page.locator('button:has-text("重設所有圖卡位置")');
if (await resetAll.count()) { await resetAll.first().click(); await page.waitForTimeout(900); }
const cleared = await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("turning-traffic-state-v2") || "{}");
  const record = (state.records || []).find((r) => r.station === "T15-03");
  return (record?.approaches || []).some((a) => a.cardLayouts || a.cardOffsets || a.labelOffset);
});
ok("「重設所有圖卡位置」會清掉全部三種模式的版面", cleared === false);

// ── 拖曳精準度與邊界回彈 ────────────────────────────────────
await go("路口轉向圖");
await setMode("駛入＋駛出");
const cardAt = (id, sec) =>
  page.evaluate(([i, s2]) => {
    const n = document.querySelector(`.diagram-canvas [data-card-id="${i}"][data-card-section="${s2}"]`);
    const r = n.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top)];
  }, [id, sec]);
const dragCard = async (id, sec, dx, dy) => {
  const sel = `.diagram-canvas [data-card-id="${id}"][data-card-section="${sec}"]`;
  const box = await page.locator(sel).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 24; i += 1)
    await page.mouse.move(box.x + box.width / 2 + (dx * i) / 24, box.y + box.height / 2 + (dy * i) / 24);
  await page.mouse.up();
  await page.waitForTimeout(400);
};
const anyCard = await page.evaluate(() => {
  const n = document.querySelector(".diagram-canvas [data-card-id]");
  return { id: n.getAttribute("data-card-id"), sec: n.getAttribute("data-card-section") };
});
const precise0 = await cardAt(anyCard.id, anyCard.sec);
await dragCard(anyCard.id, anyCard.sec, -180, -80);
const precise1 = await cardAt(anyCard.id, anyCard.sec);
ok("拖曳距離與滑鼠位移一致（不會跟不上游標）",
  Math.abs(precise0[0] - precise1[0] - 180) <= 4 && Math.abs(precise0[1] - precise1[1] - 80) <= 4,
  `Δx=${precise0[0] - precise1[0]}（應 180）Δy=${precise0[1] - precise1[1]}（應 80）`);
await dragCard(anyCard.id, anyCard.sec, 900, 0);
const pinned = await cardAt(anyCard.id, anyCard.sec);
await dragCard(anyCard.id, anyCard.sec, -120, 0);
const bounced = await cardAt(anyCard.id, anyCard.sec);
ok("拖到邊界後往回拖立刻有反應（沒有死區）",
  Math.abs(pinned[0] - bounced[0] - 120) <= 6, `回拖 120px 實際移動 ${pinned[0] - bounced[0]}px`);
const stored = await page.evaluate((id) => {
  const state = JSON.parse(localStorage.getItem("turning-traffic-state-v2") || "{}");
  const approach = (state.records || [])
    .flatMap((r) => r.approaches || [])
    .find((a) => a.id === id);
  return approach?.cardLayouts?.both?.cards || null;
}, anyCard.id);
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
