/*
 * 用「程式自己的解析與計算」把三份真實調查檔的
 * 『全調查時段道路方向車種數量』整張表讀出來，輸出成 JSON。
 *
 * ⚠️ 刻意不自己重寫一份 parser：使用者要的是與畫面一致的數字，
 *   另寫一份只會製造「兩個版本哪個才對」的新問題。
 */
import { chromium } from "playwright";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

/*
 * 調查檔放哪裡由執行時決定：`node scripts/dump-direction-table.mjs <資料夾>`。
 * ⚠️ 這裡刻意**不寫死**任何一台機器上的路徑——寫死的話，換一台機器跑就會
 *   讀不到檔而整支中斷，而且真實檔的位置不應該留在交付出去的原始碼裡。
 */
const XLS_DIR = process.argv[2];
if (!XLS_DIR) {
  console.error("用法：node scripts/dump-direction-table.mjs <放 .xls 的資料夾>");
  process.exit(1);
}
const files = readdirSync(XLS_DIR).filter((n) => n.endsWith(".xls")).map((n) => join(XLS_DIR, n));
console.log("要匯入的檔案：\n  " + files.map((f) => f.split("/").pop()).join("\n  "));

const server = await serve(8431);
const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1750, height: 1100 }, locale: "zh-TW" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:8431/");
await page.waitForTimeout(1400);

const go = async (label) => {
  await page.locator(`nav button:has-text("${label}")`).first().click();
  await page.waitForTimeout(800);
};

await go("建立與管理計畫");
await page.locator(".project-form input").nth(0).fill("12507");
await page.locator(".project-form input").nth(1).fill("彰化打鐵厝園區");
await page.locator('button:has-text("建立計畫")').click();
await page.waitForTimeout(900);

await go("季度批次匯入");
await page.locator('.content label:has-text("調查年度") input').first().fill("115");
await page.locator('.content label:has-text("季度") select').first().selectOption("2");
await page.waitForTimeout(400);
const payload = files.map((p) => ({ name: p.split("/").pop(), base64: readFileSync(p).toString("base64") }));
await page.locator(".upload-card").first().evaluate((card, items) => {
  const transfer = new DataTransfer();
  for (const item of items) {
    const bin = atob(item.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    transfer.items.add(new File([bytes], item.name, { type: "application/vnd.ms-excel" }));
  }
  card.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
}, payload);
await page.waitForTimeout(9000);
const confirm = page.locator('button:has-text("確認寫入")');
if (await confirm.count()) { await confirm.first().click(); await page.waitForTimeout(8000); }
for (let i = 0; i < 6; i += 1) {
  const closer = page.locator('.modal-backdrop button:has-text("套用"), .modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("確認")').first();
  if (!(await closer.count())) break;
  await closer.click(); await page.waitForTimeout(1200);
}

await go("車種組成分析");
await page.waitForTimeout(1500);

/* 路口下拉：只看「看得見的」，而且選項裡要有路名（含「/」或「－」）。 */
const dump = await page.locator("select").evaluateAll((els) =>
  els.map((e, i) => ({
    i,
    visible: !!(e.offsetParent || e.getClientRects().length),
    label: (e.closest("label")?.textContent || e.parentElement?.textContent || "").trim().slice(0, 20),
    opts: [...e.options].map((o) => o.textContent.trim()).slice(0, 4),
  })),
);
console.log("可見的下拉：");
for (const d of dump) if (d.visible) console.log(`  #${d.i} [${d.label}] → ${d.opts.join(" / ")}`);
const idx = dump.findIndex((d) => d.visible && d.opts.some((t) => t.includes("路口（")));
console.log("選用 select#" + idx);
const sel = page.locator("select").nth(idx);
const options = await sel.locator("option").evaluateAll((o) => o.map((x) => ({ v: x.value, t: x.textContent.trim() })));
console.log("\n路口下拉選項：", options.map((o) => o.t).join(" ／ "));

const result = [];
for (const opt of options) {
  await sel.selectOption(opt.v);
  await page.waitForTimeout(1500);
  /* 側欄小分頁：切到「全調查時段道路方向車種數量」那一塊 */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("nav button, aside button, .side-nav button")]
      .find((n) => n.textContent.replace(/\s+/g, "").includes("全調查時段道路方向車種數量"));
    b?.click();
  });
  await page.waitForTimeout(1600);
  const block = await page.evaluate(() => {
    const tables = [...document.querySelectorAll("table")];
    const headOf = (t) => [...t.querySelectorAll("th")].map((x) => x.textContent.trim());
    const hit = tables.find((t) => headOf(t).join("|").includes("與路口關係"));
    if (!hit)
      return { head: [], rows: [], meta: `頁面上 ${tables.length} 張表：` +
        tables.map((t) => headOf(t).join("/")).join(" ◆ ").slice(0, 400) };
    const head = headOf(hit);
    const rows = [...hit.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td,th")].map((td) => td.innerText.replace(/\s+/g, " ").trim()),
    );
    const meta = ([...document.querySelectorAll("*")].map((n) => n.textContent)
      .find((t) => t && /調查時段合計：.*區間/.test(t) && t.length < 120) || "").trim();
    return { head, rows, meta };
  });
  console.log(`\n── ${opt.t} ──`);
  if (!block) { console.log("  evaluate 回傳 null"); continue; }
  if (!block.rows.length) { console.log("  " + block.meta); continue; }
  if (block.meta) console.log("  " + block.meta);
  console.log("  " + block.head.join(" | "));
  for (const r of block.rows) console.log("  " + r.join(" | "));
  result.push({ intersection: opt.t, ...block });
}

/* 輸出寫回被檢查的那個資料夾，不寫死任何一台機器上的路徑。 */
const OUT = join(XLS_DIR, "direction-table.json");
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log("\n已寫出：" + OUT);
console.log("\n錯誤：", errors.length ? errors.slice(0, 3).join(" | ") : "（沒有）");
await browser.close();
await server.close();
