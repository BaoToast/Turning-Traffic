/*
 * ══════════════════════════════════════════════════════════════════════
 *  資料維護「檢查結果」：類型標籤篩選
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13：
 *   「我可以很直觀知道異常有幾個種類，可以**選擇最重大的異常先挑出來看**哪幾筆，
 *     也不會因為筆數太多而沒注意到細節……針對**需要使用者確認的表**，
 *     都可以套用這種列表＋篩選的模式。」
 *
 * ⚠️ 這張清單本來就每一筆帶類型（category），卻沒有任何篩選。
 *
 * 驗四件事：
 *   ① 標籤筆數加總 ＝ 全列時的列數
 *   ② 點一個標籤 → 只剩該類型
 *   ③ 可多選
 *   ④ 清除篩選 → 全部回來
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "seed-state.json"), "utf8");
const server = await serve(8198);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.addInitScript((s) => localStorage.setItem("turning-traffic-state-v2", s), seed);
await page.goto("http://localhost:8198/");
await page.waitForTimeout(1600);

const problems = [];
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) problems.push(label + (detail ? ` — ${detail}` : ""));
};

await page.locator('nav button:has-text("資料維護")').first().click();
await page.waitForTimeout(900);
/*
 * ⚠️ X-44 之後檢查結果是**按了才跑**的（事前預防與事後檢查分開，
 *   使用者 2026-09-16 定案）。不按這一顆的話清單是「尚未檢查」，
 *   這一支會拿到 0 筆而紅——紅的原因與標籤篩選無關。
 */
await page.locator('[data-testid="quality-run"]').click();
await page.waitForTimeout(1600);

const read = () =>
  page.evaluate(() => ({
    chips: [...document.querySelectorAll(".anomaly-chip")]
      .filter((el) => !el.classList.contains("clear"))
      .map((el) => {
        const text = (el.textContent || "").trim();
        const m = text.match(/^(.*)（(\d+)）$/);
        return {
          type: m ? m[1] : text,
          count: m ? Number(m[2]) : 0,
          on: el.classList.contains("on"),
        };
      }),
    rows: document.querySelectorAll(".issue-list > div").length,
    types: [...document.querySelectorAll(".issue-list > div > b")].map((b) =>
      (b.textContent || "").trim(),
    ),
    countText: (
      document.querySelector("#quality-reasons .status-dot")?.textContent || ""
    ).trim(),
  }));

const all = await read();
console.log(`\n類型：${all.chips.map((c) => `${c.type}×${c.count}`).join("、") || "(沒有標籤)"}`);
ok("前置：真的有異常可以篩（沒有的話這一支變成恆真）", all.rows > 0, `${all.rows} 筆・${all.countText}`);
ok("前置：標籤列得出來", all.chips.length > 0, `${all.chips.length} 種`);
if (!all.rows || !all.chips.length) {
  await browser.close();
  server.close();
  console.error("\n❌ 沒有可驗的資料（不當成通過）");
  process.exit(1);
}
const sum = all.chips.reduce((n, c) => n + c.count, 0);
ok("① 標籤筆數加總 ＝ 全列時的列數", sum === all.rows, `加總 ${sum}、列數 ${all.rows}`);

const first = all.chips[0];
await page.locator(".anomaly-chip").first().click();
await page.waitForTimeout(400);
const one = await read();
ok(`② 點「${first.type}」之後只剩該類型`, one.rows === first.count, `${one.rows} 筆（該類型 ${first.count}）`);
ok("② 列出來的每一筆都真的是那個類型", one.types.every((t) => t === first.type), one.types.slice(0, 3).join("、"));
ok("② 筆數文字要跟著篩選走", /顯示/.test(one.countText), one.countText);

/*
 * ⚠️ 「可多選」一定要真的驗到。
 *   測資只造得出一種類型時**不可以靜靜跳過**——那會讓這一條看起來像驗過了。
 *   寧可紅，也不要留一個沒驗到卻沒人知道的洞。
 */
ok(
  "③ 前置：測資要造得出**兩種以上**的類型，才驗得到「可多選」",
  all.chips.length >= 2,
  `目前只有 ${all.chips.length} 種（seed-state.json 要補一種不同類型的異常）`,
);
if (all.chips.length >= 2) {
  const second = all.chips[1];
  await page.locator(".anomaly-chip").nth(1).click();
  await page.waitForTimeout(400);
  const two = await read();
  ok(`③ 再點「${second.type}」之後兩類都在（可多選）`, two.rows === first.count + second.count, `${two.rows} 筆`);
}

await page.locator(".anomaly-chip.clear").first().click();
await page.waitForTimeout(400);
const back = await read();
ok("④ 清除篩選之後全部回來", back.rows === all.rows, `${back.rows} / ${all.rows}`);
ok("④ 沒有任何標籤還是按下的狀態", back.chips.every((c) => !c.on));

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 檢查結果：類型標籤可多選，筆數對得上");
