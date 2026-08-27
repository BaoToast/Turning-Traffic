/*
 * 結論草稿產生器的端對端檢查。
 *
 * 單元測試已經驗過組字規則，這一支要驗的是「畫面接得對不對」：
 *  ・勾選條件之後草稿有沒有真的跟著變
 *  ・草稿寫的數字，和「各路口駛入／駛出流量」頁面上同一格的數字是不是一樣
 *    （這是最重要的一項——報告寫錯數字比程式當掉嚴重）
 *  ・手改之後不會被無聲覆蓋
 *  ・條件範本存得起來、載得回來、重新整理之後還在
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "seed-wide.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(8133);
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/net::ERR_/.test(m.text())) errors.push(m.text());
});
page.on("dialog", (d) => d.accept());
/*
 * 只在「還沒有資料」時才寫入種子。addInitScript 每次導覽都會執行，
 * 無條件寫入的話 page.reload() 會把測試中途存的範本一起洗掉，
 * 看起來就像「範本沒有存進去」——那是測試自己造成的假陽性。
 */
await page.addInitScript((s) => {
  if (!localStorage.getItem("turning-traffic-state-v2"))
    localStorage.setItem("turning-traffic-state-v2", s);
}, seed);
await page.goto("http://localhost:8133/");
await page.waitForTimeout(1400);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(700);
};

/* ── 先把「各路口駛入／駛出流量」頁面上的數字抄下來當標準答案 ── */
await go("各路口駛入／駛出流量");
const pageNumbers = await page.evaluate(() => {
  const rows = [];
  for (const tr of document.querySelectorAll(".content table tbody tr")) {
    const cells = [...tr.querySelectorAll("th,td")].map((td) =>
      td.innerText.replace(/\s+/g, " ").trim(),
    );
    if (cells.length > 2) rows.push(cells);
  }
  // 標題長得像「S01-01 · 示範1－示範交流道路口」，抓站號用來對到草稿的同一段。
  const title = document.querySelector(".content h2")?.textContent || "";
  return { title, station: (title.match(/[A-Z]\d+-\d+\w*/) || [""])[0], rows };
});
console.log("── 分析頁：", pageNumbers.title, "（站號", pageNumbers.station, "）");
pageNumbers.rows.slice(0, 3).forEach((r) => console.log("  ", r.join(" | ")));

await go("結論草稿產生器");
ok("結論草稿產生器分頁打得開", (await page.locator("h1:has-text('結論草稿產生器')").count()) === 1);

const draft = page.locator('textarea[aria-label="結論草稿"]');
ok("有草稿文字框", (await draft.count()) === 1);
ok("一開始是空的，等使用者設定條件", (await draft.inputValue()) === "");

/* ── 條件：單季 115Q2、只寫 AM、只寫駛入 PCU＋輛數＋百分比 ── */
await page.locator('input[name="conclusion-scope"]').first().check();
await page.waitForTimeout(300);
await page.locator('.conclusion-field select').first().selectOption("115Q2");
await page.waitForTimeout(300);

// 時段只留 AM
const pmCheck = page.locator('.conclusion-checks label:has-text("下午尖峰") input');
if (await pmCheck.isChecked()) await pmCheck.uncheck();
await page.waitForTimeout(200);

// 指標：先全部取消，再勾要的
for (const label of await page.locator(".conclusion-metrics label").all()) {
  const box = label.locator("input");
  if (await box.isChecked()) await box.uncheck();
}
for (const want of [
  "各支線駛入流量（PCU/hr）",
  "各支線駛入車輛數（輛/hr）",
  "各支線佔駛入路口總量百分比",
  "路口總流量與總車輛數",
]) {
  await page.locator(`.conclusion-metrics label:has-text("${want}") input`).check();
}
await page.waitForTimeout(200);

const matched = await page.locator(".conclusion-count").innerText();
console.log("符合條件：", matched);
ok("符合條件筆數會即時更新", /符合條件 \d+ 筆/.test(matched) && !/ 0 筆/.test(matched), matched);

await page.locator('button:has-text("產生草稿")').first().click();
await page.waitForTimeout(700);
const text1 = await draft.inputValue();
console.log("\n── 草稿前 1200 字 ──\n" + text1.slice(0, 1200) + "\n──────────────");

ok("草稿產生出來了", text1.length > 200, `${text1.length} 字`);
ok("標頭寫明範圍是 115Q2", /【結論草稿】115Q2/.test(text1));
ok("只寫上午尖峰", /上午尖峰/.test(text1) && !/下午尖峰/.test(text1));
ok("有寫駛入 PCU/hr", /駛入 [\d,.]+ PCU\/hr/.test(text1));
ok("有寫駛入輛/hr", /駛入 [\d,]+ 輛\/hr/.test(text1));
ok("有寫百分比", /佔駛入 [\d.]+%/.test(text1));
ok("沒有寫沒勾的駛出", !/駛出 [\d,.]+ PCU/.test(text1));
ok(
  "只勾駛入佔比時不會寫出駛出佔比",
  !/佔駛出 /.test(text1),
  (text1.split("\n").find((l) => /佔駛/.test(l)) || "").slice(0, 90),
);
ok("沒有寫沒勾的車種組成", !/車種組成/.test(text1));
ok("有寫明單位不可相加的規則", /僅在同一筆紀錄內可相加/.test(text1));
ok("沒有 NaN 或 undefined", !/NaN|undefined|Infinity/.test(text1), text1.match(/NaN|undefined|Infinity/)?.[0] || "");

/* ── 對數字：草稿裡的駛入 PCU 必須出現在分析頁的同一列 ── */
/*
 * 只比對「同一個站號」那一段——分析頁一次只顯示一個路口，
 * 拿草稿第一段去比另一個路口的表格只會得到假警報。
 */
const section = (function () {
  const lines = text1.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^\\d+\\. ${pageNumbers.station}\\s`).test(line),
  );
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\d+\. /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
})();
ok(`草稿裡找得到分析頁那一個路口（${pageNumbers.station}）的段落`, section.length > 20);
const drafted = [...section.matchAll(/(\S+)：駛入 ([\d,]+\.?\d*) PCU\/hr/g)].map((m) => ({
  branch: m[1],
  value: m[2],
}));
ok("草稿確實逐支線寫出駛入流量", drafted.length >= 2, `${drafted.length} 條支線`);
const pageText = JSON.stringify(pageNumbers.rows);
const missing = drafted.filter((item) => !pageText.includes(item.value));
ok(
  "草稿的每一個駛入 PCU 數字都能在分析頁上找到同一個值",
  missing.length === 0,
  missing.map((m) => `${m.branch}=${m.value}`).join("、") +
    "｜分析頁上有：" + pageText.slice(0, 300),
);

/* ── 換條件，草稿要跟著變 ── */
/*
 * ── 佔駛出百分比（v2.1.25 起才寫得出來）────────────────────────
 *
 * 舊版只有一個「各支線佔路口總量百分比」，而且輸出是 if / else if，
 * 有駛入資料就永遠寫駛入——「佔駛出」那一支是死碼，一次都沒被寫出來過。
 */
const shareIn = page.locator(
  '.conclusion-metrics label:has-text("各支線佔駛入路口總量百分比") input',
);
const shareOut = page.locator(
  '.conclusion-metrics label:has-text("各支線佔駛出路口總量百分比") input',
);
await shareIn.uncheck();
await shareOut.check();
await page.waitForTimeout(200);
await page.locator('button:has-text("重新產生")').first().click();
await page.waitForTimeout(800);
const outShareDraft = await draft.inputValue();
ok(
  "只勾駛出佔比時，草稿寫的是佔駛出",
  /佔駛出 [\d.]+%/.test(outShareDraft) && !/佔駛入 /.test(outShareDraft),
  (outShareDraft.split("\n").find((l) => /佔駛/.test(l)) || "").slice(0, 90),
);

await shareIn.check();
await page.waitForTimeout(200);
await page.locator('button:has-text("重新產生")').first().click();
await page.waitForTimeout(800);
const bothShareDraft = await draft.inputValue();
const bothLine = bothShareDraft.split("\n").find((l) => /佔駛入 /.test(l)) || "";
ok(
  "兩個佔比都勾時兩行都寫，駛入排在駛出前面",
  /佔駛入 /.test(bothLine) &&
    /佔駛出 /.test(bothLine) &&
    bothLine.indexOf("佔駛入") < bothLine.indexOf("佔駛出"),
  bothLine.slice(0, 110),
);
/* 還原成後面幾段檢查預期的狀態 */
await shareOut.uncheck();
await page.waitForTimeout(200);

await page.locator('.conclusion-metrics label:has-text("車種組成（輛數與百分比）") input').check();
await page.locator('button:has-text("重新產生")').first().click();
await page.waitForTimeout(700);
const text2 = await draft.inputValue();
ok("加勾車種組成之後草稿有變", text2 !== text1);
ok("車種組成寫出百分比", /車種組成（.+）：.+（[\d.]+%）/.test(text2));

/* ── 手改保護 ── */
await draft.fill("我自己改的內容");
await page.waitForTimeout(200);
const hint = await page.locator(".conclusion-output .conclusion-hint").innerText();
ok("手改之後有提示會先詢問再覆蓋", /手動修改/.test(hint), hint);

/* ── 指定單一路口 ── */
await page.locator(".conclusion-field:has-text('要寫哪些路口') input[type=checkbox]").first().check();
await page.waitForTimeout(250);
await page.locator('button:has-text("重新產生")').first().click();
await page.waitForTimeout(700);
const text3 = await draft.inputValue();
const sections = (text3.match(/^\d+\. /gm) || []).length;
ok("只勾一個路口時只寫一段", sections === 1, `${sections} 段`);

/* ── 年度條件 ── */
await page.locator('.conclusion-field:has-text("統計範圍") input[type=radio]').nth(1).check();
await page.waitForTimeout(350);
await page.locator(".conclusion-field:has-text('要寫哪些路口') button:has-text('全部路口')").click();
await page.waitForTimeout(250);
await page.locator('button:has-text("重新產生")').first().click();
await page.waitForTimeout(700);
const text4 = await draft.inputValue();
ok("年度條件寫得出「N 年度」標頭", /【結論草稿】\d+ 年度/.test(text4), text4.split("\n")[0]);

/* ── 切到別的分頁再回來，條件與草稿要還在 ── */
await go("路口轉向圖");
await page.waitForTimeout(500);
await go("結論草稿產生器");
await page.waitForTimeout(600);
const afterSwitch = await draft.inputValue();
ok(
  "切到別的分頁再回來，草稿文字還在",
  afterSwitch.length > 60 && afterSwitch === text4,
  `切換前 ${text4.length} 字、切換後 ${afterSwitch.length} 字`,
);
const scopeStillYear = await page
  .locator('.conclusion-field:has-text("統計範圍") input[type=radio]')
  .nth(1)
  .isChecked();
ok("切回來之後條件也還在（仍然是「某一年度」）", scopeStillYear);

/* ── 範本存取與重新整理後仍在 ── */
await page.locator(".conclusion-templates input").fill("年報用");
await page.locator('button:has-text("存成範本")').click();
await page.waitForTimeout(400);
ok("範本存得起來", (await page.locator(".conclusion-template:has-text('年報用')").count()) === 1);

await page.reload();
await page.waitForTimeout(1400);
await go("結論草稿產生器");
ok(
  "重新整理之後範本還在",
  (await page.locator(".conclusion-template:has-text('年報用')").count()) === 1,
);
await page.locator(".conclusion-template button:has-text('年報用')").click();
await page.waitForTimeout(400);
const scopeChecked = await page
  .locator('.conclusion-field:has-text("統計範圍") input[type=radio]')
  .nth(1)
  .isChecked();
ok("套用範本會還原當時的條件（年度）", scopeChecked);

/*
 * ── 範本專屬於自己的計畫（v2.1.24）──────────────────────────────
 *
 * 舊版所有計畫共用同一份清單：在甲計畫存的範本，切到乙計畫照樣列出來。
 * 這不只是看了礙眼——條件裡存著 intersectionKeys 與 branchNames，
 * 那是該計畫專屬的識別字，套到別的計畫會篩出 0 筆而找不出原因。
 *
 * 這裡直接改儲存的 activeProjectId 再重新整理，而不是走畫面上的切換元件：
 * 要驗的是「換了計畫之後範本清單長什麼樣」，不是切換元件本身。
 */
const switchTo = async (projectId) => {
  await page.evaluate((id) => {
    const state = JSON.parse(
      localStorage.getItem("turning-traffic-state-v2") || "{}",
    );
    state.activeProjectId = id;
    localStorage.setItem("turning-traffic-state-v2", JSON.stringify(state));
  }, projectId);
  await page.reload();
  await page.waitForTimeout(1500);
  await go("結論草稿產生器");
};

const firstProjectId = await page.evaluate(() => {
  const state = JSON.parse(
    localStorage.getItem("turning-traffic-state-v2") || "{}",
  );
  return state.activeProjectId;
});
/* 種一個第二計畫，並把第一計畫的紀錄複製一份給它，讓它也產得出草稿。 */
const secondProjectId = await page.evaluate(() => {
  const key = "turning-traffic-state-v2";
  const state = JSON.parse(localStorage.getItem(key) || "{}");
  const id = "P-e2e-second";
  if (!state.projects.some((p) => p.id === id)) {
    state.projects.push({
      id,
      code: "99999",
      name: "第二計畫（e2e）",
      client: "測試",
      note: "",
      createdAt: "2026-01-04T00:00:00.000Z",
    });
    state.records = state.records.concat(
      state.records.map((r, i) => ({ ...r, id: `${r.id}-2nd${i}`, projectId: id })),
    );
    localStorage.setItem(key, JSON.stringify(state));
  }
  return id;
});

await switchTo(secondProjectId);
ok(
  "切到第二計畫時，看不到第一計畫存的範本",
  (await page.locator(".conclusion-template:has-text('年報用')").count()) === 0,
);

/* 在第二計畫存一個同名以外的範本，回到第一計畫時也不能看到它 */
await page.locator(".conclusion-templates input").fill("第二計畫專用");
await page.locator('button:has-text("存成範本")').click();
await page.waitForTimeout(400);
ok(
  "第二計畫自己存的範本看得到",
  (await page.locator(".conclusion-template:has-text('第二計畫專用')").count()) === 1,
);

await switchTo(firstProjectId);
ok(
  "回到第一計畫時，看不到第二計畫存的範本",
  (await page.locator(".conclusion-template:has-text('第二計畫專用')").count()) === 0,
);
ok(
  "回到第一計畫時，自己的範本還在",
  (await page.locator(".conclusion-template:has-text('年報用')").count()) === 1,
);

/* ── 沒有資料的條件不會給空白 ── */
await page.locator('.conclusion-field:has-text("統計範圍") input[type=radio]').first().check();
await page.waitForTimeout(300);
const quarterSelect = page.locator(".conclusion-field select").first();
await quarterSelect.selectOption((await quarterSelect.locator("option").allTextContents())[0]);
await page.locator(".conclusion-field:has-text('要寫哪些路口') input[type=checkbox]").last().check();
await page.waitForTimeout(250);
await page.locator('button:has-text("重新產生")').first().click();
await page.waitForTimeout(700);
const text5 = await draft.inputValue();
ok(
  "條件挑不到資料時給的是說明而不是空白",
  text5.length > 60,
  text5.slice(0, 80),
);

/*
 * ── 流量核對工作台：多車種格式與單位分組 ──
 *
 * 這一頁的中間各欄是「原始調查車輛數（輛/hr）」，右邊才是乘上當量後的
 * PCU/hr。兩件事要驗：
 *  1. 車種欄位是依每一筆紀錄自己的車種清單長出來的（不是寫死 4 種），
 *     否則多車種調查格式的資料會有欄位被無聲吃掉。
 *  2. 分組標題有寫清楚哪一半是輛數、哪一半是 PCU。
 */
await go("流量核對工作台");
const audit = await page.evaluate(() => {
  const table = document.querySelector(".audit-table");
  if (!table) return null;
  const groups = [...table.querySelectorAll(".audit-group-row th")].map((th) => ({
    text: th.textContent.trim(),
    span: Number(th.getAttribute("colspan") || 1),
  }));
  const heads = [...table.querySelectorAll("thead tr:last-child th")].map((th) =>
    th.innerText.replace(/\s+/g, " ").trim(),
  );
  const firstFormula =
    table.querySelector("tbody tr .audit-formula")?.textContent?.trim() ||
    [...(table.querySelector("tbody tr")?.querySelectorAll("td") || [])]
      .map((td) => td.textContent.trim())
      .find((t) => /×/.test(t)) ||
    "";
  return { groups, heads, firstFormula };
});
ok("流量核對工作台有 OD 換算表", Boolean(audit), "");
if (audit) {
  const vehicleHeads = audit.heads.filter((h) => /輛\/hr/.test(h));
  ok(
    "車種欄位依該筆紀錄自己的車種清單產生（多車種格式仍可用）",
    vehicleHeads.length === 7,
    `${vehicleHeads.length} 欄：${vehicleHeads.join("、")}`,
  );
  ok(
    "分組標題寫明左半是原始輛數",
    audit.groups.some((g) => /原始調查車輛數（輛\/hr）/.test(g.text)),
    audit.groups.map((g) => `${g.text}(${g.span})`).join(" | "),
  );
  ok(
    "分組標題寫明右半是當量後的交通流量",
    audit.groups.some((g) => /當量/.test(g.text)),
  );
  ok(
    "原始輛數的分組欄數等於車種數",
    audit.groups.some((g) => /原始調查車輛數/.test(g.text) && g.span === vehicleHeads.length),
  );
  ok(
    "換算式是「輛數 × 當量」相加，證明車種欄確實是輛數",
    /\d+×[\d.]+/.test(audit.firstFormula),
    audit.firstFormula.slice(0, 80),
  );
}

/*
 * ── 駛出／駛入視角切換 ──
 *
 * 兩者是同一批 OD 流向、只是分組方式不同，資料完整時總量必須相等。
 * 這一段同時驗「切得動」與「切了之後數字是對的」。
 */
const auditFlow = await page.evaluate(() => {
  const seg = [...document.querySelectorAll(".audit-origin")].map((el) => ({
    title: el.querySelector("summary span")?.textContent?.trim() || "",
    total: Number(
      (el.querySelector("summary strong")?.textContent || "").replace(/[^\d.]/g, ""),
    ),
  }));
  return seg;
});
ok(
  "核對工作台預設是「駛出路口」分組",
  auditFlow.length > 0 && auditFlow.every((g) => /駛出路口/.test(g.title)),
  auditFlow.map((g) => g.title).join("、").slice(0, 90),
);
const outboundSum = auditFlow.reduce((sum, g) => sum + g.total, 0);

await page
  .locator('.audit-head-actions button:has-text("駛入路口")')
  .first()
  .click();
await page.waitForTimeout(500);
const auditInbound = await page.evaluate(() =>
  [...document.querySelectorAll(".audit-origin")].map((el) => ({
    title: el.querySelector("summary span")?.textContent?.trim() || "",
    total: Number(
      (el.querySelector("summary strong")?.textContent || "").replace(/[^\d.]/g, ""),
    ),
  })),
);
ok(
  "切到「駛入路口」之後分組標題跟著換",
  auditInbound.length > 0 && auditInbound.every((g) => /駛入路口/.test(g.title)),
  auditInbound.map((g) => g.title).join("、").slice(0, 90),
);
const inboundSum = auditInbound.reduce((sum, g) => sum + g.total, 0);
ok(
  "駛出與駛入的合計相同（同一批流向、只是分組不同）",
  Math.abs(outboundSum - inboundSum) < 1.5,
  `駛出 ${outboundSum} vs 駛入 ${inboundSum}`,
);
const gapNote = await page.locator(".audit-flow-gap").innerText();
ok("有寫出兩種視角的合計關係", /駛出與駛入合計相同|差 [\d,.]+ PCU\/hr/.test(gapNote), gapNote.slice(0, 80));

/* 歷季趨勢也要能切換，且兩種視角的點數相同 */
await go("歷季趨勢比較");
await page
  .locator(".trend-controls select")
  .first()
  .selectOption({ label: "示範路－示範二路－示範三街路口" });
await page.waitForTimeout(500);
const outPoints = await page.locator("#trend-svg circle").count();
await page.locator('.trend-controls button:has-text("駛入總量")').first().click();
await page.waitForTimeout(600);
const inPoints = await page.locator("#trend-svg circle").count();
ok("歷季趨勢可以切換駛出／駛入總量", inPoints === outPoints && inPoints > 0, `${outPoints} → ${inPoints} 個點`);
const trendNote = await page.locator(".trend-station-note").first().innerText();
ok(
  "歷季趨勢有說明兩種視角的關係",
  /總量相同|總量不相等/.test(trendNote),
  trendNote.slice(0, 70),
);

/*
 * ── 「待設定」的說明與更正路徑 ──
 *
 * 「待設定」是資料別（平日／假日）沒設定，不是第三種尖峰時段。
 * 條件面板要用小標把「時段」與「資料別」分開，並說明怎麼更正；
 * 流量核對工作台要真的改得動。
 */
await go("結論草稿產生器");
await page.waitForTimeout(500);
const subLabels = await page.$$eval(
  ".conclusion-field:has-text('時段與資料別') .conclusion-sublabel",
  (els) => els.map((el) => el.textContent.trim()),
);
ok(
  "時段與資料別有各自的小標題",
  subLabels.includes("時段") && subLabels.includes("資料別"),
  subLabels.join("、"),
);

await go("流量核對工作台");
await page.waitForTimeout(600);
const surveyTypeSelect = page
  .locator(".review-panel:has-text('資料別（平日／假日）') select")
  .first();
ok("流量核對工作台有資料別下拉可以更正", (await surveyTypeSelect.count()) === 1);
if (await surveyTypeSelect.count()) {
  const before = await surveyTypeSelect.inputValue();
  const options = await surveyTypeSelect.locator("option").allTextContents();
  /*
   * 「待設定」是「原始檔沒寫」的意思，不是使用者會主動想選的值，
   * 所以只有在這一筆目前就是待設定時才列出來；平日／假日一定要有。
   */
  ok(
    "資料別下拉一定提供 平日／假日",
    ["平日", "假日"].every((v) => options.includes(v)),
    options.join("、"),
  );
  const target = before === "假日" ? "平日" : "假日";
  await surveyTypeSelect.selectOption(target);
  await page.waitForTimeout(700);
  ok("改資料別之後選單值跟著變", (await surveyTypeSelect.inputValue()) === target);
  // 換到別的分頁再回來，確認真的寫進資料而不是只改了畫面
  await go("結論草稿產生器");
  await page.waitForTimeout(600);
  const typesNow = await page.$$eval(
    ".conclusion-field:has-text('時段與資料別') .conclusion-checks:last-of-type label",
    (els) => els.map((el) => el.textContent.trim()),
  );
  ok(
    "更正後的資料別會出現在結論草稿的條件選項裡",
    typesNow.includes(target),
    typesNow.join("、"),
  );
}

/*
 * ── 車種轉向當量：改設定不會動到已匯入的資料 ──
 *
 * 「車種轉向當量」是全域設定（所有計畫共用一組），但每一筆紀錄在匯入當下就把
 * 當時的矩陣存進 pceUsed，PCU 也在那時候就算好存下來了。所以改設定只影響
 * 之後的匯入，不會回頭改已經匯入的數字——這一點必須有測試把關，否則哪天
 * 改成「即時重算」，使用者已經交出去的報告數字就會在他不知情的情況下變動。
 */
await go("流量核對工作台");
await page.waitForTimeout(700);
const totalBefore = await page
  .locator(".audit-kpis .kpi")
  .first()
  .innerText();

await go("車種轉向當量");
await page.waitForTimeout(700);
const pceInput = page.locator(".parameter-card table input").first();
const pceBefore = await pceInput.inputValue();
await pceInput.fill(String(Number(pceBefore) + 3));
await pceInput.blur();
await page.waitForTimeout(700);

await go("流量核對工作台");
await page.waitForTimeout(800);
const totalAfter = await page.locator(".audit-kpis .kpi").first().innerText();
ok(
  "改了車種轉向當量之後，已匯入資料的尖峰總量不變（pceUsed 快照生效）",
  totalBefore === totalAfter,
  `改前「${totalBefore.replace(/\n/g, " ")}」／改後「${totalAfter.replace(/\n/g, " ")}」`,
);
/* 改回去，不要影響後面的檢查 */
await go("車種轉向當量");
await page.waitForTimeout(500);
await page.locator(".parameter-card table input").first().fill(pceBefore);
await page.locator(".parameter-card table input").first().blur();
await page.waitForTimeout(500);

/* ── 核對工作台可以自己換路口 ── */
await go("流量核對工作台");
await page.waitForTimeout(700);
const picker = page.locator(".audit-picker select").first();
ok("核對工作台有路口選擇器", (await picker.count()) === 1);
if (await picker.count()) {
  const options = await picker.locator("option").allTextContents();
  ok("路口選擇器列出本季的路口", options.length >= 2, `${options.length} 個：${options.join("、").slice(0, 70)}`);
  const titleBefore = await page.locator(".panel-head h2, .audit-panel h2").first().innerText().catch(() => "");
  await picker.selectOption({ index: 1 });
  await page.waitForTimeout(800);
  const odTitle = await page
    .locator("h2")
    .filter({ hasText: "·" })
    .first()
    .innerText()
    .catch(() => "");
  ok(
    "換路口之後 OD 換算表跟著換",
    odTitle.length > 0 && odTitle !== titleBefore,
    `${titleBefore} → ${odTitle}`,
  );
  /* 資料別下拉不應該把「待設定」當成可主動選的值（除非目前就是） */
  const typeSelect = page
    .locator(".review-panel:has-text('資料別（平日／假日）') select")
    .first();
  const current = await typeSelect.inputValue();
  const typeOptions = await typeSelect.locator("option").allTextContents();
  ok(
    "資料別下拉只在目前就是「待設定」時才列出它",
    current === "待設定" || !typeOptions.includes("待設定"),
    `目前 ${current}；選項 ${typeOptions.join("、")}`,
  );
}

/*
 * ── 各支線各車種駛入／駛出 vs 車種組成分析頁 ──
 *
 * 這個指標的來源就是「車種組成分析」的『全調查時段道路方向車種數量』
 * （同一支 surveyDirectionRows），所以草稿寫的每一個數字都必須能在那張表上
 * 找到。這是這個指標最重要的一項檢查。
 */
await go("車種組成分析");
await page.waitForTimeout(900);
/*
 * 那張表只在「全調查時段」這個範圍下才會出現（AM／PM 尖峰沒有逐流向的
 * 調查明細），所以要先切過去；預設是 AM。
 */
await page.locator('.head-buttons button:has-text("全調查時段")').first().click();
await page.waitForTimeout(700);
/* 這張表是逐支線設定呈現方式的，先全部設成「分行車方向」再比對。 */
for (const select of await page.locator(".direction-mode-grid select").all()) {
  await select.selectOption("split");
}
await page.waitForTimeout(600);
const compHeading = await page
  .locator('.panel:has-text("全調查時段道路方向車種數量")')
  .count();
ok("車種組成分析頁有『全調查時段道路方向車種數量』", compHeading > 0);
const compTable = await page.evaluate(() => {
  const table = [...document.querySelectorAll("table")]
    .map((t) => t.innerText)
    .find((t) => /與路口關係/.test(t));
  return table || "";
});
const compNumbers = new Set(
  [...compTable.matchAll(/[\d,]{3,}/g)].map((m) => m[0]),
);
ok("車種組成分析頁抓得到方向車種表", compNumbers.size > 5, `${compNumbers.size} 個數值`);
/*
 * 這一頁一次只顯示「一季、一個路口」，所以要能逐字比對，草稿也得限縮到
 * 同一季、同一個路口。把分析頁目前看的是哪一筆抄下來。
 */
const compContext = await page.evaluate(() => {
  const selects = [...document.querySelectorAll(".content select")];
  const quarter = selects[0]?.value || "";
  const intersection =
    selects[1]?.options[selects[1].selectedIndex]?.text?.trim() || "";
  return { quarter, intersection };
});
console.log("── 車種組成分析頁目前看的是：", compContext.quarter, compContext.intersection);

await go("結論草稿產生器");
await page.waitForTimeout(600);
/*
 * 前面的測試會留下條件（單季 111Q3、只勾某一條支線、勾了某個資料別），
 * 這裡要重新設乾淨：同一季、同一個路口、支線與資料別全開。
 */
await page
  .locator('.conclusion-field:has-text("一、統計範圍") label:has-text("單一季度") input')
  .first()
  .check();
await page.waitForTimeout(350);
await page
  .locator('.conclusion-field:has-text("一、統計範圍") select')
  .first()
  .selectOption(compContext.quarter);
await page.waitForTimeout(300);
/*
 * 資料別全部取消＝全部都寫。時段與資料別在同一個 fieldset 裡，時段那一組
 * 「至少要留一個」，所以只能動第二組 .conclusion-checks（資料別）。
 */
for (const box of await page
  .locator('.conclusion-field:has-text("資料別") .conclusion-checks')
  .nth(1)
  .locator("input[type=checkbox]")
  .all()) {
  if (await box.isChecked()) await box.uncheck();
}
/* 只勾分析頁那一個路口 */
await page
  .locator('.conclusion-field:has-text("三、要寫哪些路口") button:has-text("全部路口")')
  .click();
await page.waitForTimeout(250);
await page
  .locator(
    `.conclusion-field:has-text("三、要寫哪些路口") .conclusion-list label:has-text("${compContext.intersection}") input`,
  )
  .first()
  .check();
await page.waitForTimeout(300);
for (const label of await page
  .locator('.conclusion-field:has-text("四、要寫哪些支線") .conclusion-list label')
  .all()) {
  const box = label.locator("input");
  if (await box.isChecked()) await box.uncheck();
}
for (const label of await page.locator(".conclusion-metrics label").all()) {
  const box = label.locator("input");
  if (await box.isChecked()) await box.uncheck();
}
/*
 * v2.1.24 起駛入與駛出是兩個獨立的勾選項。先各自單勾驗一次，
 * 再兩個都勾回來做後面的交叉比對。
 */
const branchIn = page.locator(
  '.conclusion-metrics label:has-text("各支線各車種駛入車輛數") input',
);
const branchOut = page.locator(
  '.conclusion-metrics label:has-text("各支線各車種駛出車輛數") input',
);
await branchIn.check();
await page.waitForTimeout(300);
ok(
  "只勾一個方向時，呈現方式選項不出現（雙向合計對單一方向沒有意義）",
  (await page.locator(".conclusion-submode").count()) === 0,
);
await page.locator('button:has-text("重新產生")').first().click();
await page.waitForTimeout(900);
const inOnlyDraft = await draft.inputValue();
ok(
  "只勾駛入時，草稿裡只有駛入那一段",
  /駛入各車種：/.test(inOnlyDraft) && !/駛出各車種：/.test(inOnlyDraft),
  (inOnlyDraft.split("\n").find((l) => /各車種：/.test(l)) || "").slice(0, 90),
);

await branchIn.uncheck();
await branchOut.check();
await page.waitForTimeout(300);
await page.locator('button:has-text("重新產生")').first().click();
await page.waitForTimeout(900);
const outOnlyDraft = await draft.inputValue();
ok(
  "只勾駛出時，草稿裡只有駛出那一段",
  /駛出各車種：/.test(outOnlyDraft) && !/駛入各車種：/.test(outOnlyDraft),
  (outOnlyDraft.split("\n").find((l) => /各車種：/.test(l)) || "").slice(0, 90),
);

await branchIn.check();
await page.waitForTimeout(400);
/* 呈現方式的子選項只在兩個方向都勾了之後才會出現 */
ok(
  "兩個方向都勾之後才出現呈現方式選項",
  (await page.locator(".conclusion-submode").count()) === 1,
);
await page
  .locator('.conclusion-submode label:has-text("一律分行車方向") input')
  .check();
await page.waitForTimeout(300);
await page.locator('button:has-text("重新產生")').first().click();
await page.waitForTimeout(900);
const compDraft = await draft.inputValue();
ok("草稿寫出了各支線各車種", /駛入各車種：/.test(compDraft), compDraft.slice(0, 120));
ok(
  "單位寫成 輛/調查時段，不是 輛/hr",
  /輛\/調查時段/.test(compDraft) &&
    !(compDraft.split("\n").find((l) => /駛入各車種/.test(l)) || "").includes("輛/hr"),
);
/*
 * 交叉比對的方向：以「車種組成分析」那張表為準（它才是來源），表上每一個
 * 數值都必須出現在草稿裡。反過來比不行——草稿寫的是整個計畫的所有路口，
 * 分析頁一次只顯示一個路口。
 */
const draftNumbers = new Set(
  [...compDraft.matchAll(/[\d,]{3,}/g)].map((m) => m[0]),
);
const compMissing = [...compNumbers].filter((n) => !draftNumbers.has(n));
ok(
  "車種組成分析頁上的每一個車種輛數都寫進了草稿",
  compNumbers.size > 0 && compMissing.length === 0,
  `表上 ${compNumbers.size} 個值；草稿缺 ${compMissing.length} 個${compMissing.length ? "：" + compMissing.slice(0, 6).join("、") : ""}`,
);

/* ── 呈現方式：改成雙向合計，草稿要跟著換寫法 ── */
await page
  .locator('.conclusion-submode label:has-text("一律雙向合計") input')
  .check();
await page.waitForTimeout(300);
await page.locator('button:has-text("重新產生")').first().click();
await page.waitForTimeout(900);
const twoWayDraft = await draft.inputValue();
ok(
  "選一律雙向合計時，草稿寫雙向合計、不再分寫駛入／駛出",
  /雙向合計各車種：/.test(twoWayDraft) && !/駛入各車種：/.test(twoWayDraft),
  twoWayDraft.split("\n").find((l) => /各車種：/.test(l))?.slice(0, 110) || "（沒有各車種那一行）",
);
ok(
  "標頭寫明目前的呈現方式",
  /呈現方式：一律雙向合計/.test(twoWayDraft),
);
/* 雙向合計＝駛出＋駛入，所以合計必然大於分開寫時的任一側 */
const splitSum = Number(
  (compDraft.match(/駛入各車種：[^\n]*?合計 ([\d,]+) 輛/) || [])[1]?.replace(/,/g, "") || 0,
);
const twoWaySum = Number(
  (twoWayDraft.match(/雙向合計各車種：[^\n]*?合計 ([\d,]+) 輛/) || [])[1]?.replace(/,/g, "") || 0,
);
ok(
  "雙向合計的合計大於單側（駛出＋駛入）",
  splitSum > 0 && twoWaySum > splitSum,
  `單側 ${splitSum}／雙向 ${twoWaySum}`,
);

/* ── 跟著分析頁的設定：在分析頁把支線改成雙向合計，草稿要跟著改 ── */
await go("車種組成分析");
await page.waitForTimeout(700);
const firstMode = page.locator(".direction-mode-grid select").first();
await firstMode.selectOption("two-way");
await page.waitForTimeout(600);
await go("結論草稿產生器");
await page.waitForTimeout(600);
await page
  .locator('.conclusion-submode label:has-text("跟著車種組成分析頁") input')
  .check();
await page.waitForTimeout(300);
await page.locator('button:has-text("重新產生")').first().click();
await page.waitForTimeout(900);
const followDraft = await draft.inputValue();
ok(
  "跟著設定時，改成雙向合計的那條支線寫雙向合計，其他支線仍分行車方向",
  /雙向合計各車種：/.test(followDraft) && /駛入各車種：/.test(followDraft),
  followDraft
    .split("\n")
    .filter((l) => /各車種：/.test(l))
    .slice(0, 2)
    .join(" ⏐ ")
    .slice(0, 160),
);
/* 改回去，不影響後面的檢查 */
await go("車種組成分析");
await page.waitForTimeout(600);
await page.locator(".direction-mode-grid select").first().selectOption("split");
await page.waitForTimeout(500);

console.log("\n══ 主控台錯誤 ══");
ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 4).join(" / "));

await browser.close();
server.close();

console.log(
  problems.length
    ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ")
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
