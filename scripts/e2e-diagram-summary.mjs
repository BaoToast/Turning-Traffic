/*
 * 轉向圖右側摘要必須跟著「顯示 × 時段 × 車種」走（v2.1.34）。
 *
 * 使用者回報：顯示切成「車輛數」時，下方的圖正確換成了「輛/調查日」，
 * 右側摘要卻仍寫「10,469.5 PCU/hr」——同一張畫面上兩個數字、兩種單位，
 * 講的是同一件事。摘要那一格以前寫死 recordTotal() ＋文字「PCU/hr」，
 * 完全不看使用者選的顯示模式、車種，單位也不跟統計範圍走。
 *
 * 這一支量的是**兩版都有的畫面文字**：
 *   圖的抬頭「全路口流量 X 單位」  vs  右側摘要的數值與單位
 * 兩邊必須一致。對未修正的 v2.1.33 應該紅字。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const seed = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
const server = await serve(8188);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1680, height: 1100 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());

await page.goto("http://localhost:8188/");
await page.waitForTimeout(700);
await page.evaluate((json) => {
  localStorage.clear();
  localStorage.setItem("turning-traffic-state-v2", json);
}, JSON.stringify(seed));
await page.reload();
await page.waitForTimeout(1300);

await page.locator('nav button:has-text("路口轉向圖")').first().click();
await page.waitForTimeout(1000);

const pick = async (labelText, value) => {
  const sel = page
    .locator(`.content label:has-text("${labelText}") select`)
    .first();
  if (!(await sel.count())) return false;
  await sel.selectOption(value).catch(() => {});
  await page.waitForTimeout(700);
  return true;
};
/** 圖的抬頭：「… 全路口流量 10,779 輛/調查日」 */
const diagramTotal = async () =>
  page.evaluate(() => {
    const svg = document.getElementById("turning-svg");
    const text = svg ? svg.textContent.replace(/\s+/g, " ") : "";
    /* SVG 的 textContent 會把後面的文字接上來，所以單位要精確比對。 */
    const m = text.match(/全路口流量\s*([\d,.]+)\s*((?:PCU|輛)\/(?:hr|調查日))/);
    return m ? { value: m[1], unit: m[2] } : null;
  });
/** 右側摘要的第一個數值格。 */
const summaryTotal = async () =>
  page.evaluate(() => {
    const card = document.querySelector(".summary-card");
    if (!card) return null;
    const rows = [...card.querySelectorAll("dl > div")];
    const row = rows.find((r) => /流量/.test(r.querySelector("dt")?.textContent || ""));
    if (!row) return null;
    const dd = row.querySelector("dd");
    const raw = dd ? dd.textContent.replace(/\s+/g, " ").trim() : "";
    const m = raw.match(/^([\d,.]+)\s*((?:PCU|輛)\/(?:hr|調查日))/);
    return { raw, value: m ? m[1] : "", unit: m ? m[2] : "" };
  });

/* 先確認測資真的算得出全日時段（否則下面量到的都是「－」，等於白測）。 */
const scopeOk = await pick("時段", "FULL");
ok("測資可以切到全日時段", scopeOk);

for (const [mode, label] of [
  ["volume", "交通量"],
  ["count", "車輛數"],
  ["both", "交通量＋百分比"],
  ["countPercent", "車輛數＋百分比"],
]) {
  await pick("顯示", mode);
  const d = await diagramTotal();
  const s = await summaryTotal();
  ok(
    `顯示＝${label}：圖與摘要的數字一致`,
    Boolean(d && s) && d.value === s.value,
    `圖 ${d?.value ?? "?"} / 摘要 ${s?.value ?? "?"}`,
  );
  ok(
    `顯示＝${label}：圖與摘要的單位一致`,
    Boolean(d && s) && d.unit === s.unit,
    `圖 ${d?.unit ?? "?"} / 摘要 ${s?.unit ?? "?"}`,
  );
  ok(
    `顯示＝${label}：全日時段的單位是 /調查日，不是 /hr`,
    Boolean(s) && /調查日$/.test(s.unit),
    s?.unit ?? "?",
  );
}

/* 車種篩成單一車種：摘要要報那個車種，而且要給它占路口總量的百分比。 */
await pick("顯示", "count");
const vehicleOptions = await page.evaluate(() => {
  const sel = [...document.querySelectorAll(".content label")]
    .find((l) => l.textContent.trim().startsWith("車種"))
    ?.querySelector("select");
  return sel ? [...sel.options].map((o) => o.value) : [];
});
const single = vehicleOptions.find((v) => v !== "all");
ok("車種選單有單一車種可選", Boolean(single), vehicleOptions.join(","));
if (single) {
  await pick("車種", single);
  const d = await diagramTotal();
  const s = await summaryTotal();
  ok(
    "單一車種：圖與摘要的數字一致",
    Boolean(d && s) && d.value === s.value,
    `圖 ${d?.value ?? "?"} / 摘要 ${s?.value ?? "?"}`,
  );
  const hasShare = await page.evaluate(() =>
    [...document.querySelectorAll(".summary-card dt")].some((n) =>
      /占路口總量/.test(n.textContent || ""),
    ),
  );
  ok("單一車種：摘要有「占路口總量」百分比", hasShare);

  /*
   * PCU 模式更重要：圖使用實際 OD 的「車種 × 轉向」數量，摘要也必須走同一條
   * 資料路徑。若摘要拿總 PCU 比例反推，各車種當量不同時兩邊就會不同。
   */
  await pick("顯示", "volume");
  const pcuDiagram = await diagramTotal();
  const pcuSummary = await summaryTotal();
  ok(
    "單一車種＋PCU：圖與摘要的數字一致",
    Boolean(pcuDiagram && pcuSummary) && pcuDiagram.value === pcuSummary.value,
    `圖 ${pcuDiagram?.value ?? "?"} / 摘要 ${pcuSummary?.value ?? "?"}`,
  );
  ok(
    "單一車種＋PCU：圖與摘要都使用 PCU 單位",
    Boolean(pcuDiagram && pcuSummary) &&
      /^PCU\//.test(pcuDiagram.unit) &&
      pcuDiagram.unit === pcuSummary.unit,
    `圖 ${pcuDiagram?.unit ?? "?"} / 摘要 ${pcuSummary?.unit ?? "?"}`,
  );
}

/* 百分比模式：全部車種時要列出各車種組成。 */
await pick("車種", "all");
await pick("顯示", "percent");
const breakdown = await page.evaluate(() => {
  const el = document.querySelector(".summary-breakdown");
  return el ? el.innerText.replace(/\s+/g, " ").trim() : "";
});
ok("百分比＋全部車種：摘要列出各車種組成", /%/.test(breakdown), breakdown.slice(0, 120));

await pick("顯示", "countPercent");
const breakdown2 = await page.evaluate(() => {
  const el = document.querySelector(".summary-breakdown");
  return el ? el.innerText.replace(/\s+/g, " ").trim() : "";
});
ok(
  "車輛數＋百分比：組成同時列出車輛數與百分比",
  /輛\/調查日/.test(breakdown2) && /%/.test(breakdown2),
  breakdown2.slice(0, 140),
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
await server.close?.();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
