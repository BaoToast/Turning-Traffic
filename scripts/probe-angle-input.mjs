/*
 * 重現使用者 2026-09-21 回報：
 *   「把路口A和路口B角度都設為0度，切換到另一個路口，就集體無法輸入除了0以外的數字」
 *
 * ⚠️ 這一支是探針不是守門：目的是問「到底是保護機制還是 bug」，
 *   所以每一步都把實際讀到的值印出來，不做斷言。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "seed-state.json"), "utf8");
const server = await serve(8421);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" })
).newPage();
const errors = [];
const dialogs = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
page.on("dialog", (d) => { dialogs.push(d.type() + ": " + d.message().slice(0, 120)); d.accept(); });

await page.addInitScript((s) => localStorage.setItem("turning-traffic-state-v2", s), seed);
await page.goto("http://localhost:8421/");
await page.waitForTimeout(1600);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("nav button")].find((n) => n.textContent.trim().includes("道路與流向管理"));
  b?.click();
});
await page.waitForTimeout(1500);

const angleInputs = () => page.locator("label:has-text('角度') input[type=number]");
const readAngles = async () => angleInputs().evaluateAll((els) => els.map((e) => e.value));
const all = await page.locator("select").evaluateAll((els) =>
  els.map((e, i) => {
    const lab = e.closest("label")?.textContent?.trim().slice(0, 18) || "";
    const prev = e.previousElementSibling?.textContent?.trim().slice(0, 18) || "";
    const parentTxt = e.parentElement?.textContent?.trim().slice(0, 24) || "";
    return `${i}:[${lab || prev || parentTxt}] 選項=${e.options.length} 現值=${e.options[e.selectedIndex]?.textContent?.trim().slice(0,22)}`;
  }),
);
console.log("頁面上的下拉：\n  " + all.join("\n  "));
const idx = await page.locator("select").evaluateAll((els) =>
  els.findIndex((e) => (e.parentElement?.textContent || "").includes("切換路口")),
);
console.log("切換路口 = select#" + idx);
const intersectionSelect = page.locator("select").nth(idx);

const listIntersections = async () =>
  intersectionSelect.locator("option").evaluateAll((o) => o.map((x) => x.textContent.trim()));

console.log("路口清單：", (await listIntersections()).join(" ／ "));
console.log("一開始的角度：", (await readAngles()).join(", "));

/* ── 步驟 1：把第二條支線的角度也改成 0（與第一條相同） ── */
async function setAngle(i, v) {
  const input = angleInputs().nth(i);
  await input.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(String(v));
  await page.waitForTimeout(500);
  return (await readAngles())[i];
}
console.log(`\n把第 2 條支線改成 0 → 讀回 ${await setAngle(1, 0)}`);
console.log("此時角度：", (await readAngles()).join(", "));

/* ── 步驟 2：切換到另一個路口 ── */
const options = await intersectionSelect.locator("option").evaluateAll((o) => o.map((x) => x.value));
if (options.length > 1) {
  await intersectionSelect.selectOption(options[1]);
  await page.waitForTimeout(1500);
  console.log(`\n── 切到第二個路口 ──`);
  console.log("切過來的角度：", (await readAngles()).join(", "));

  for (const target of [45, 90, 123]) {
    const got = await setAngle(0, target);
    console.log(`  想輸入 ${target} → 實際變成 ${got}  ${String(got) === String(target) ? "✅" : "❌ 進不去"}`);
  }
} else {
  console.log("\n⚠️ 這份種子只有一個路口，切不過去");
}

/* ── 步驟 3：回到第一個路口，看兩條都是 0 的狀態下能不能改 ── */
await intersectionSelect.selectOption(options[0]);
await page.waitForTimeout(1200);
console.log(`\n── 切回第一個路口（兩條支線都是 0）──`);
console.log("角度：", (await readAngles()).join(", "));
for (const target of [45, 90]) {
  const got = await setAngle(1, target);
  console.log(`  第 2 條想輸入 ${target} → 實際變成 ${got}  ${String(got) === String(target) ? "✅" : "❌ 進不去"}`);
}

/* ── 步驟 4：清空欄位會怎樣（受控 number input 的典型坑） ── */
const input0 = angleInputs().nth(0);
await input0.click();
await page.keyboard.press("Control+a");
await page.keyboard.press("Delete");
await page.waitForTimeout(400);
console.log(`\n把欄位清空之後讀回：「${(await readAngles())[0]}」`);

console.log("\n對話框：", dialogs.length ? dialogs.join(" | ") : "（沒有）");
console.log("錯誤：", errors.length ? errors.slice(0, 5).join(" | ") : "（沒有）");
await browser.close();
await server.close();
