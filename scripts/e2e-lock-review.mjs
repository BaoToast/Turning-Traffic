/*
 * 成果審核狀態與「鎖定成果」的關係，用真的瀏覽器驗。
 *
 * 使用者問的是：「不論成果審核狀態為何，皆可點選右上角的鎖定成果，
 * 那成果審核狀態欄位的功用是什麼呢？鎖定成果的功能有確實發揮作用嗎？」
 *
 * 這支腳本量四件事：
 *   1. 有一筆是「需修正」時，鎖定被擋下來（沒有任何一筆被鎖）。
 *   2. 全部改成「已確認」後，鎖定成功（不跳額外確認）。
 *   3. 鎖定之後，審核狀態的下拉與備註欄變成停用。
 *   4. 鎖定之後改路口名稱會跳出確認視窗（鎖定真的在擋事情）。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages-dist");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const seed = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
/* 同一季的兩筆：一筆「需修正」，一筆「已確認」。 */
const stamp = (status) => ({
  status,
  note: "",
  updatedAt: "2026-06-01T00:00:00.000Z",
});
seed.records = seed.records.map((record, index) => ({
  ...record,
  review: stamp(index === 0 ? "需修正" : "已確認"),
}));

await new Promise((r) => server.listen(8114, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
/* 確認視窗一律按「確定」，但要記下來跳過幾次。 */
const dialogs = [];
page.on("dialog", (d) => {
  dialogs.push(d.message());
  d.accept();
});

await page.goto("http://localhost:8114/");
await page.waitForTimeout(700);
await page.evaluate(
  (json) => {
    localStorage.clear();
    localStorage.setItem("turning-traffic-state-v2", json);
  },
  JSON.stringify(seed),
);
await page.reload();
await page.waitForTimeout(1000);

async function gotoAudit() {
  await page.locator('nav button:has-text("流量核對工作台")').first().click();
  await page.waitForTimeout(600);
}
const lockedCount = () =>
  page.evaluate(() => {
    const data = JSON.parse(
      localStorage.getItem("turning-traffic-state-v2") || "{}",
    );
    return (data.records || []).filter((r) => r.resultLock).length;
  });

await gotoAudit();

/* ── 1. 有「需修正」時鎖不起來 ── */
await page.locator('button:has-text("鎖定 ")').first().click();
await page.waitForTimeout(800);
ok(
  "有「需修正」的紀錄時，鎖定被擋下來",
  (await lockedCount()) === 0,
  `已鎖 ${await lockedCount()} 筆`,
);
ok(
  "擋下來時有講原因（提到「需修正」）",
  (await page.locator("body").innerText()).includes("需修正"),
);

/* ── 2. 全部改成已確認後可以鎖 ── */
await page.evaluate(() => {
  const key = "turning-traffic-state-v2";
  const data = JSON.parse(localStorage.getItem(key) || "{}");
  data.records = (data.records || []).map((r) => ({
    ...r,
    review: { status: "已確認", note: "", updatedAt: r.review?.updatedAt || "" },
  }));
  localStorage.setItem(key, JSON.stringify(data));
});
await page.reload();
await page.waitForTimeout(1000);
await gotoAudit();
await page.locator('button:has-text("鎖定 ")').first().click();
await page.waitForTimeout(900);
ok(
  "全部「已確認」後鎖定成功",
  (await lockedCount()) > 0,
  `已鎖 ${await lockedCount()} 筆`,
);

/* ── 3. 鎖定後審核欄位停用 ── */
await page.waitForTimeout(400);
ok(
  "鎖定後審核狀態下拉停用",
  await page.locator(".review-panel select").first().isDisabled(),
);
ok(
  "鎖定後審核備註欄停用",
  await page.locator(".review-panel input").first().isDisabled(),
);
ok(
  "畫面上看得到「已鎖定」狀態",
  (await page.locator(".lock-state").innerText()).includes("已鎖定"),
);

/* ── 4. 鎖定真的擋得住修改 ── */
dialogs.length = 0;
await page.locator('nav button:has-text("路口名稱管理")').first().click();
await page.waitForTimeout(700);
const rename = page.locator('input[type="text"], .panel input').first();
if (await rename.count()) {
  await rename.fill("鎖定測試改名");
  await page.waitForTimeout(400);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(600);
}
await page.locator('nav button:has-text("道路與流向管理")').first().click();
await page.waitForTimeout(800);
const angle = page.locator('.panel input[type="number"]').first();
if (await angle.count()) {
  await angle.fill("123");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(800);
}
ok(
  "鎖定期間修改幾何或流向會先跳出確認",
  dialogs.some((message) => message.includes("已鎖定")),
  dialogs.length ? dialogs[0].slice(0, 40) : "完全沒有跳出任何確認",
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" / "));
await browser.close();
server.close();
console.log(
  problems.length
    ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ")
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
