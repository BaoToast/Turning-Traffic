/* 用「真實的鍵盤動作」重測角度欄位：點進去 → 退格刪掉 → 打新數字。 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "seed-state.json"), "utf8");
const server = await serve(8422);
const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: "zh-TW" })).newPage();
await page.addInitScript((s) => localStorage.setItem("turning-traffic-state-v2", s), seed);
await page.goto("http://localhost:8422/");
await page.waitForTimeout(1600);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("nav button")].find((n) => n.textContent.trim().includes("道路與流向管理"));
  b?.click();
});
await page.waitForTimeout(1500);
const angles = page.locator("label:has-text('角度') input[type=number]");
const read = async () => angles.evaluateAll((e) => e.map((x) => x.value));

async function humanType(i, digits, { clearFirst = true } = {}) {
  const input = angles.nth(i);
  await input.click();
  await page.keyboard.press("End");
  if (clearFirst)
    for (let k = 0; k < 6; k += 1) { await page.keyboard.press("Backspace"); await page.waitForTimeout(90); }
  const steps = [];
  for (const ch of String(digits)) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(220);
    steps.push(`打「${ch}」→ 欄位=${(await read())[i]}`);
  }
  return steps;
}

console.log("起始角度：", (await read()).join(", "));
console.log("\n【情境一】退格刪乾淨再打 90（第 2 條支線，原本 90）");
for (const s of await humanType(1, 90)) console.log("   " + s);
console.log("   結果：", (await read()).join(", "));

console.log("\n【情境二】先把第 1、2 條都設成 0");
await humanType(0, 0); await humanType(1, 0);
console.log("   現在：", (await read()).join(", "));

console.log("\n【情境三】兩條都是 0 的狀態下，想把第 2 條改成 45");
for (const s of await humanType(1, 45)) console.log("   " + s);
console.log("   結果：", (await read()).join(", "));

console.log("\n【情境四】不先刪，直接在 0 後面打 9（很多人會這樣）");
for (const s of await humanType(2, 9, { clearFirst: false })) console.log("   " + s);
console.log("   結果：", (await read()).join(", "));

console.log("\n【情境五】退格刪乾淨之後**先不打字**，看欄位變成什麼");
const inp = angles.nth(3);
await inp.click(); await page.keyboard.press("End");
for (let k = 0; k < 6; k += 1) { await page.keyboard.press("Backspace"); await page.waitForTimeout(120); }
console.log("   刪乾淨之後欄位顯示：「" + (await read())[3] + "」");
console.log("   游標位置：", await inp.evaluate((e) => `selectionStart=${e.selectionStart}`).catch(() => "（number input 讀不到）"));
await browser.close();
await server.close();
