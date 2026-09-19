/**
 * ══════════════════════════════════════════════════════════════════════
 *  L-2：「回歸全部」旁邊的浮動小卡——看得到是哪幾張，點了會跳過去並關掉
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「主工具列跳出全部回歸鈕時，上面會寫目前共 N 項要回歸，你覺得要提供
 *     使用者選擇哪幾個回歸嗎？還是為了主工具列簡化目的，一次性全部回歸
 *     才是最實用的方式？」
 *   → 定案：維持一次性全部回歸，但 N 要**看得到是哪幾張**。
 *
 *   「做成浮動小卡，不占版面很棒，但你提供了點一下清單裡的名稱，畫面會
 *     跳轉過去，那就要記得**浮動小卡也要跟著關掉**」
 *   「我怕展開時候，整個主工具列會被擠的超大」
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 *
 * 一、**「不佔版面」要真的量。** 只驗「有 position:absolute」不夠——
 *     可能被別的規則蓋過。這裡量**工具列在開小卡前後的高度**，必須一樣。
 * 二、**「點了會關掉」要真的點。** 而且要驗跳轉**也真的發生了**：
 *     只驗「小卡關掉了」的話，一顆什麼都不做的按鈕也會過。
 * 三、**名稱要是使用者看得懂的區塊名**，不是內部代號。
 * 四、**前置要先真的讓某一張脫離**，否則整支恆真。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { launchOptions } from "./chrome-path.mjs";
import { installStateHelpers } from "./read-state.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8299;
const seed = readFileSync(join(here, "seed-wide.json"), "utf8");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const server = await serve(PORT);
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 950 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await installStateHelpers(page);
await page.addInitScript((text) => {
  try {
    localStorage.setItem("turning-traffic-state-v2", text);
  } catch {
    /* 無痕或封鎖時就算了，下面的前置檢查會紅。 */
  }
}, seed);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

const gotoTab = async (label) => {
  const found = await page.evaluate((text) => {
    const list = [...document.querySelectorAll("aside nav button")].filter(
      (button) => !button.className.includes("nav-collapse"),
    );
    const target = list.find((button) => (button.textContent || "").includes(text));
    if (!target) return false;
    target.click();
    return true;
  }, label);
  await page.waitForTimeout(1200);
  return found;
};

/* ══ 前置：讓某一張脫離 ══════════════════════════════════════ */
console.log("\n══ 前置：讓一張圖脫離主工具列 ══");
ok("前置：切得到「車種組成」", await gotoTab("車種組成"));
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll(".page-head .head-buttons button")];
  const target = buttons.find((button) =>
    (button.textContent || "").includes("全調查時段"),
  );
  if (target) target.click();
});
await page.waitForTimeout(1200);
ok(
  "前置：真的有一張脫離了（0 張的話整支恆真）",
  (await page.locator('[data-testid="chart-detach-note"]').count()) >= 1,
  `${await page.locator('[data-testid="chart-detach-note"]').count()} 張`,
);
ok(
  "前置：「回歸全部」那一顆出現了",
  (await page.locator('[data-testid="mt-reset-all"]').count()) === 1,
);

/* ══ 一、小卡不佔版面 ══════════════════════════════════════════ */
console.log("\n══ 一、開小卡不可以把工具列撐大 ══");
const barBefore = await page.evaluate(() =>
  Math.round(
    document.querySelector(".main-toolbar").getBoundingClientRect().height,
  ),
);
await page.locator('[data-testid="mt-detached-toggle"]').click();
await page.waitForTimeout(400);
const afterOpen = await page.evaluate(() => {
  const bar = document.querySelector(".main-toolbar");
  const pop = document.querySelector('[data-testid="mt-detached-pop"]');
  return {
    barHeight: Math.round(bar.getBoundingClientRect().height),
    popVisible: Boolean(pop) && !pop.hidden,
    popPosition: pop ? getComputedStyle(pop).position : "",
    popHeight: pop ? Math.round(pop.getBoundingClientRect().height) : -1,
    items: pop ? pop.querySelectorAll("[data-detached-goto]").length : -1,
    labels: pop
      ? [...pop.querySelectorAll("[data-detached-goto]")].map((node) =>
          node.textContent.trim(),
        )
      : [],
  };
});
ok(
  "① 小卡打得開",
  afterOpen.popVisible && afterOpen.popHeight > 40,
  `高 ${afterOpen.popHeight}px`,
);
ok(
  "① 小卡是**浮起來**的（position: absolute）",
  afterOpen.popPosition === "absolute",
  afterOpen.popPosition,
);
ok(
  "⚠️ ① 開了小卡之後，主工具列的高度**完全不變**（使用者怕的就是被擠大）",
  afterOpen.barHeight === barBefore,
  `開之前 ${barBefore}px → 開之後 ${afterOpen.barHeight}px`,
);
ok(
  "② 清單列得出項目",
  afterOpen.items >= 1,
  `列了 ${afterOpen.items} 項：${afterOpen.labels.join("、")}`,
);
/*
 * ⚠️ 名稱必須是**使用者看得懂的區塊名**，不是內部代號。
 *   判準：要含中文，而且不可以整串長得像代號（全小寫英數與連字號）。
 */
ok(
  "② 列出來的是區塊名稱，不是內部代號",
  afterOpen.labels.length > 0 &&
    afterOpen.labels.every(
      (label) => /[一-鿿]/.test(label) && !/^[a-z0-9-]+$/.test(label),
    ),
  afterOpen.labels.join("、"),
);

/* ══ 二、點名稱：跳過去，而且小卡要關掉 ══════════════════════ */
console.log("\n══ 二、點名稱之後小卡要跟著關掉（使用者指名的那一條）══");
const firstLabel = afterOpen.labels[0];
await page.locator("[data-detached-goto]").first().click();
await page.waitForTimeout(900);
const afterJump = await page.evaluate(() => {
  const pop = document.querySelector('[data-testid="mt-detached-pop"]');
  const toggle = document.querySelector('[data-testid="mt-detached-toggle"]');
  const active = [...document.querySelectorAll("aside nav button")].find(
    (button) => button.className.includes("active"),
  );
  return {
    popVisible: Boolean(pop) && !pop.hidden,
    ariaExpanded: toggle ? toggle.getAttribute("aria-expanded") : "(沒有鈕)",
    activePage: active ? (active.textContent || "").trim() : "",
    /* 那一頁真的有一張在用自己的條件——說明還掛著就是證據。 */
    noteOnPage: document.querySelectorAll("[data-detached-chart]").length,
  };
});
ok(
  "⚠️ ③ 點了名稱之後，浮動小卡要**跟著關掉**（使用者指名要做的）",
  !afterJump.popVisible && afterJump.ariaExpanded === "false",
  `小卡還開著：${afterJump.popVisible}、aria-expanded=${afterJump.ariaExpanded}`,
);
/*
 * ⚠️ 只驗「關掉了」不夠——一顆什麼都不做、只負責關小卡的按鈕也會過。
 *   所以一起驗「真的換到那一頁了」：目前這一頁的名稱要等於點下去的名稱。
 *
 * ⚠️ 這一支的脫離是**以分頁為單位**（說明掛在整頁上方，一頁一份），
 *   所以「跳過去」＝換頁，不是捲到某一塊。
 */
ok(
  "③ 而且**真的跳過去了**：換到了那一頁",
  afterJump.activePage === firstLabel,
  `目前在「${afterJump.activePage}」，點的是「${firstLabel}」`,
);
ok(
  "③ 換過去之後那一頁確實掛著「用自己的條件」的說明",
  afterJump.noteOnPage >= 1,
  `${afterJump.noteOnPage} 條`,
);

/* ══ 三、其他關閉方式 ══════════════════════════════════════════ */
console.log("\n══ 三、按 Esc、點外面、按回歸全部，都要關掉 ══");
const reopen = async () => {
  await page.locator('[data-testid="mt-detached-toggle"]').click();
  await page.waitForTimeout(350);
  return page.evaluate(
    () => !document.querySelector('[data-testid="mt-detached-pop"]').hidden,
  );
};
const isOpen = () =>
  page.evaluate(() => {
    const pop = document.querySelector('[data-testid="mt-detached-pop"]');
    return Boolean(pop) && !pop.hidden;
  });

ok("前置：小卡再打得開（打不開的話下面三條恆真）", await reopen());
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok("④ 按 Esc 要關掉", !(await isOpen()));

ok("前置：小卡再打得開", await reopen());
await page.mouse.click(20, 500);
await page.waitForTimeout(300);
ok("④ 點小卡以外的地方要關掉", !(await isOpen()));

ok("前置：小卡再打得開", await reopen());
await page.locator('[data-testid="mt-reset-all"]').click();
await page.waitForTimeout(900);
ok("④ 按「回歸全部」之後要關掉（清單本身已經沒有意義了）", !(await isOpen()));
ok(
  "④ 而且真的全部回歸了（「回歸全部」那一顆要消失）",
  (await page.locator('[data-testid="mt-reset-all"]').count()) === 0,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 浮動小卡：不佔版面、列得出區塊名稱、點了跳過去並關掉");
