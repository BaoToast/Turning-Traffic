/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列每一個條件 × 每一頁：**要嘛真的算，要嘛寫明不適用**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「確保圖表在主工具列每種篩選條件下，能計算或繪製的話，
 *     都要確實去計算或繪製圖形，不要有遺漏。
 *     這方面我無法做檢查，只能靠你謹慎對待。」
 *   「當主工具列某個篩選條件不適用該圖表時，記得顯示提醒文字。」
 *
 * ── 這一支在守什麼 ───────────────────────────────────────────
 *
 * 對每一個條件、每一個**有資料的分頁**，切下去之後只有兩種結果算合格：
 *   ① 那一頁的數字真的變了（＝有算）
 *   ② 那一頁掛出「不適用」的說明（＝有講）
 * 兩者都沒有就是「有遺漏」——使用者按了一個看起來有用的下拉，
 * 畫面一動也不動，而且沒有任何一個字告訴他為什麼。
 *
 * ⚠️ 沒有資料的操作頁（手冊、建立計畫、匯入、名稱管理、備份）不在名單裡：
 *   它們本來就沒有數字可以篩，掛一句「不適用」反而是噪音。
 *
 * ⚠️ 結論草稿產生器、成果交付與批次輸出也不在名單裡（X-61 之前是同一頁「報表與批次輸出」）：
 *   使用者 2026-09-14 明確裁示這兩頁**維持獨立**，
 *   改用一顆「套用主工具列目前的條件」（守門在 e2e-apply-main.mjs）。
 *
 * ⚠️ 指紋要**排除主工具列與不適用說明自己**。
 *   那幾塊裡面也有數字（「115Q2」「2 張圖」），一併算進去的話，
 *   「數字變了」會因為旁白變了而假通過。
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./_toolbar.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "github-pages-dist");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer((request, response) => {
  let path = join(
    root,
    decodeURIComponent(request.url.split("?")[0]).replace(/^\//, "") ||
      "index.html",
  );
  if (!existsSync(path)) path = join(root, "index.html");
  response.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  response.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/** 有數字、要接主工具列的分頁（用分頁名稱的片段比對）。 */
const DATA_PAGES = [
  "總覽儀表板",
  "資料維護",
  "道路與流向管理",
  "車種轉向當量",
  "各路口駛入",
  "各路口尖峰彙總",
  "流量核對工作台",
  "路口轉向圖",
  "車種組成分析",
  "轉向進階分析",
  "歷季趨勢比較",
];

/*
 * ⚠️ 「改回去」的那個值一律從 DEFAULT_MAIN_FILTERS 取，不可以寫死。
 *
 *   這裡原本把資料別的還原值寫死成 "all"。甲案（2026-09-16）把「全部」
 *   從選單上拿掉之後，那個 option 根本不存在，selectOption 會一路重試到逾時，
 *   整支腳本被例外中斷——而**中斷不是紅字**，它是在其他守門之前就炸掉，
 *   看起來像「還沒跑到」。日後再改預設值也不會重演。
 */
const { DEFAULT_MAIN_FILTERS: D } = await import("../app/main-filters.ts");
const CASES = [
  ["C 尖峰時段", "mt-peak", "PM", D.peak, "peak"],
  ["C2 上午＋下午並列", "mt-peak", "AMPM", D.peak, "peak"],
  ["D 尖峰時段判定方式", "mt-peak-rule", "direction", D.peakRule, "peakRule"],
  ["E 路口流量視角", "mt-flow-view", "inbound", D.flowView, "flowView"],
  ["F 資料別", "mt-day", "weekday", D.day, "day"],
  ["G 車種", "mt-vehicle", null, D.vehicle, "vehicle"],
  ["H 轉向別", "mt-movement", "left", D.movement, "movement"],
  ["I 顯示數值", "mt-display", "percent", D.display, "display"],
];

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1700, height: 1100 },
  locale: "zh-TW",
});
const page = await context.newPage();
await page.addInitScript(
  (value) => localStorage.setItem("turning-traffic-state-v2", value),
  readFileSync(join(here, "seed-wide.json"), "utf8"),
);
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.dismiss());
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2400);
/* ⚠️ X-78：主工具列預設收合，這一支要動它的欄位，先用那顆鈕展開。 */
await ensureToolbarOpen(page);

const tabs = await page.evaluate(() =>
  [...document.querySelectorAll("aside nav > div > button")]
    .filter((button) => !button.className.includes("nav-collapse"))
    .map((button) => (button.textContent || "").replace(/\s+/g, "").trim()),
);
const targets = DATA_PAGES.map((name) => ({
  name,
  tab: tabs.find((tab) => tab.includes(name)),
}));
const missingTabs = targets.filter((entry) => !entry.tab).map((e) => e.name);
ok("前置：名單上的分頁都找得到", missingTabs.length === 0, missingTabs.join("、"));

const gotoTab = async (tab) => {
  await page.evaluate((wanted) => {
    const list = [
      ...document.querySelectorAll("aside nav > div > button"),
    ].filter((button) => !button.className.includes("nav-collapse"));
    const target = list.find(
      (button) =>
        (button.textContent || "").replace(/\s+/g, "").trim() === wanted,
    );
    if (target) target.click();
  }, tab);
  await page.waitForTimeout(850);
};

const snapshot = () =>
  page.evaluate(() => {
    const host = document.querySelector(".content") || document.body;
    const skip = [
      ...host.querySelectorAll(
        ".main-toolbar, .chart-detach-note, .chart-inapplicable",
      ),
    ];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let text = "";
    let node;
    while ((node = walker.nextNode()))
      if (!skip.some((element) => element.contains(node.parentElement)))
        text += " " + node.nodeValue;
    return {
      numbers: (text.match(/-?\d[\d,]*\.?\d*/g) || [])
        .map((value) => value.replace(/,/g, ""))
        .join("|"),
      /*
       * ⚠️ 常駐的那幾句（data-inapplicable-always）不算——它們本來就一直在
       *   （例如「這一塊是設定，不受任何條件影響」）。
       *   這一條反面守門要抓的是「**沒篩卻跳出條件式的說明**」。
       */
      notes: host.querySelectorAll(
        ".chart-inapplicable:not([data-inapplicable-always])",
      ).length,
    };
  });

/*
 * ══════════════════════════════════════════════════════════════════════
 *  逐「塊」量，不是逐「頁」量
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：「偶爾會出現某張圖有出現提醒文字，卻對某一個篩選條件
 *   卻沒出現不受影響的提醒文字，因為我不能確實找出這類問題出來」。
 *
 * ⚠️ 上面的 snapshot() 是**整頁**一起量的，而一頁上有好幾塊。
 *   只要其中一塊的數字變了，整頁就算「有交代」——**另一塊既沒變也沒說**
 *   會被整個蓋過去。使用者看到的正是這個。
 *
 * 塊的 id 與側欄小分頁的 anchor 是同一組（見 traffic-app.tsx 的 PAGES）。
 */
const blockSnapshot = () =>
  page.evaluate(() => {
    const host = document.querySelector(".content") || document.body;
    const candidates = [...host.querySelectorAll("[id]")].filter(
      (el) =>
        el.id &&
        /*
         * ⚠️ 圖（<svg>）本身不算一「塊」——說明要掛在**包著它的面板**上，
         *   不是掛在圖裡面。把 svg 當成一塊的話，外面那個面板會因為
         *   「包含了另一個候選」而被排除，於是說明掛在哪裡都不對。
         */
        el.tagName !== "svg" &&
        el.tagName !== "SVG" &&
        /^(peaks|audit|composition|advanced|trend|report|backup|overview|quality|roads|vehicle)-/.test(
          el.id,
        ) &&
        el.getBoundingClientRect().height >= 20,
    );
    const out = {};
    for (const el of candidates) {
      if (candidates.some((other) => other !== el && el.contains(other)))
        continue;
      /*
       * ⚠️ 收起來的 <details> 要跳過：內容根本沒有渲染，數字當然不會變——
       *   那是「量不到」，不是「程式沒算」。把它算進來會逼人去替一個
       *   看不見的區塊掛說明。
       */
      if (el.tagName === "DETAILS" && !el.open) continue;
      if (el.closest("details:not([open])")) continue;
      const skip = [
        ...el.querySelectorAll(
          ".main-toolbar, .chart-detach-note, .chart-inapplicable",
        ),
      ];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let text = "";
      let node;
      while ((node = walker.nextNode()))
        if (!skip.some((element) => element.contains(node.parentElement)))
          text += " " + node.nodeValue;
      /*
       * ⚠️ 只讀「看得見的文字裡的數字」會漏掉圖。
       *
       *   X-46 之後折線圖的數值標籤改成**滑鼠移上去才顯示**，
       *   平常根本不在 DOM 裡。於是一張圖的可見文字只剩縱軸刻度與季別——
       *   換一個時段之後刻度剛好吸附到同一組整數時，這一支就會判成
       *   「既沒變也沒說」，而圖其實**已經換了一整組資料**。
       *
       *   所以把圖形本身的座標一起算進指紋：資料點的位置會跟著值移動，
       *   值變了座標就一定變。這不是放寬，是把量不到的那一半補回來。
       */
      /*
       * ⚠️ 2026-09-18 大檢查：座標要**取到小數第 2 位**再比。
       *   同一個值走不同的算式會留下浮點尾巴（118.168 vs 118.16800000000003），
       *   像素上完全相同，卻會被判成「圖變了」——反向那一半（寫不適用卻變了）
       *   就會對一張其實沒動的圖報假錯（實測：歷季趨勢圖切駛入／駛出、
       *   兩者總量相等時就是這樣）。
       */
      const geometry = [
        ...el.querySelectorAll(
          "svg circle[cy], svg polyline[points], svg rect[height], svg path[d]",
        ),
      ]
        .slice(0, 400)
        .map((node) =>
          [
            node.getAttribute("cy"),
            node.getAttribute("points"),
            node.getAttribute("height"),
            node.getAttribute("d"),
          ]
            .filter(Boolean)
            .join(",")
            .replace(/-?\d+\.\d+/g, (value) => Number(value).toFixed(2)),
        )
        .join("|");
      out[el.id] = {
        /*
         * ⚠️ 兩半都空的時候要回**空字串**，不可以回 "##"。
         *   下面的比對靠 `if (!was.numbers) continue;` 跳過「量不到東西」
         *   的區塊（例如審核狀態那種純文字的塊）。回 "##" 的話那些塊
         *   會突然全部被納入判定，而且永遠是「沒變也沒說」——
         *   那是守門自己製造的紅字，與要驗的事情無關（實測踩到）。
         */
        numbers: [
          (text.match(/-?\d[\d,]*\.?\d*/g) || [])
            .map((value) => value.replace(/,/g, ""))
            .join("|"),
          geometry,
        ]
          .filter(Boolean)
          .join("##"),
        covered: [
          ...new Set(
            [...el.querySelectorAll("[data-inapplicable]")].flatMap((n) =>
              (n.getAttribute("data-inapplicable") || "").split(/\s+/),
            ),
          ),
        ].filter(Boolean),
        /*
         * ⚠️ 2026-09-18 大檢查：反向那一半要用的清單——只算**此刻真的顯示著**、
         *   而且不是常駐資訊句（data-inapplicable-always）的「不適用」宣告。
         *   隱藏中的說明沒有對使用者講話，不算它在說謊。
         */
        declared: [
          ...new Set(
            [...el.querySelectorAll("[data-inapplicable]:not([data-inapplicable-always])")]
              .filter((n) => n.offsetParent !== null || n.getClientRects().length > 0)
              .flatMap((n) => (n.getAttribute("data-inapplicable") || "").split(/\s+/)),
          ),
        ].filter(Boolean),
        detached: el.querySelectorAll(".chart-detach-note").length > 0,
        /*
         * ⚠️ 2026-09-18 大檢查：`data-consumes` ＝ 這一塊**確實把該條件算進去**，
         *   只是種子資料上看不出差別（例如「各方向各自認定」需要 15 分鐘逐格
         *   資料，seed-wide.json 沒有；真實檔上 2026-09-18 實測數字會變）。
         *   這不是放行——反向那一半照樣量它：它宣告 consumes 的欄位一旦
         *   又同時宣告 inapplicable，就是自相矛盾（下面有檢查）。
         */
        consumes: (el.getAttribute("data-consumes") || "").split(/\s+/).filter(Boolean),
        title: (el.querySelector("h2, h3, b")?.textContent || el.id)
          .replace(/\s+/g, "")
          .slice(0, 22),
      };
    }
    return out;
  });

for (const [label, testid, value, backTo, field] of CASES) {
  let target = value;
  if (!target) {
    const options = await page.evaluate(
      (id) =>
        [...document.querySelectorAll(`[data-testid="${id}"] option`)].map(
          (option) => option.value,
        ),
      testid,
    );
    target = options.find((option) => option !== "all");
  }
  if (!target) {
    ok(`${label}：選得到一個非預設值`, false, "沒有可選的值，這一條驗不了");
    continue;
  }
  const before = {};
  const beforeBlocks = {};
  for (const entry of targets) {
    if (!entry.tab) continue;
    await gotoTab(entry.tab);
    before[entry.tab] = (await snapshot()).numbers;
    beforeBlocks[entry.tab] = await blockSnapshot();
  }
  await page.selectOption(`[data-testid="${testid}"]`, target);
  await page.waitForTimeout(900);
  const silent = [];
  const silentBlocks = [];
  const lyingBlocks = [];
  for (const entry of targets) {
    if (!entry.tab) continue;
    await gotoTab(entry.tab);
    const after = await snapshot();
    if (after.numbers === before[entry.tab] && after.notes === 0)
      silent.push(entry.name);
    const afterBlocks = await blockSnapshot();
    for (const [id, now] of Object.entries(afterBlocks)) {
      const was = beforeBlocks[entry.tab][id];
      if (!was || !was.numbers) continue;
      /*
       * ⚠️ 2026-09-18 大檢查（F-16／F-18 的教訓）：反向那一半。
       *   一塊**寫著**「不適用 X」、數字卻因為 X 變了——那句說明在說謊，
       *   比沒說更糟（使用者會照著說明去解讀一個已經被篩過的數字）。
       *   脫離中的塊不算（它的數字本來就不跟主工具列走）。
       */
      if (
        now.numbers !== was.numbers &&
        !now.detached &&
        now.declared.includes(field)
      )
        lyingBlocks.push(`${now.title}（${id}）`);
      if (now.consumes.includes(field) && now.declared.includes(field))
        lyingBlocks.push(`${now.title}（${id}）：同時宣告 consumes 與不適用`);
      if (now.numbers !== was.numbers) continue;
      if (now.detached) continue;
      if (now.covered.includes("all")) continue;
      if (now.covered.includes(field)) continue;
      if (now.consumes.includes(field)) continue;
      silentBlocks.push(`${now.title}（${id}）`);
    }
  }
  ok(
    `⚠️ ${label} → ${target}：寫著「不適用」的塊，數字不可以跟著變（說明不可以說謊）`,
    lyingBlocks.length === 0,
    lyingBlocks.length
      ? `這幾塊**寫不適用卻變了**：${[...new Set(lyingBlocks)].join("、")}`
      : "沒有說謊的說明",
  );
  ok(
    `${label} → ${target}：每一頁不是真的算了，就是寫明不適用`,
    silent.length === 0,
    silent.length
      ? `這幾頁**既沒變也沒說**：${silent.join("、")}`
      : "全部有交代",
  );
  ok(
    `⚠️ ${label} → ${target}：逐**塊**看，每一塊不是真的算了，就是寫明不適用`,
    silentBlocks.length === 0,
    silentBlocks.length
      ? `這幾塊**既沒變也沒說**：${[...new Set(silentBlocks)].join("、")}`
      : "全部有交代",
  );
  await page.selectOption(`[data-testid="${testid}"]`, backTo);
  await page.waitForTimeout(900);
}

/*
 * ⚠️ 反面守門：全部回到預設之後，**不可以還留著任何一句「不適用」**。
 *   沒篩卻講一句沒有人問的話，是我們自己訂下的另一種錯。
 */
const leftovers = [];
for (const entry of targets) {
  if (!entry.tab) continue;
  await gotoTab(entry.tab);
  if ((await snapshot()).notes > 0) leftovers.push(entry.name);
}
ok(
  "回到預設之後，不適用說明要全部收掉（沒篩卻講話是噪音）",
  leftovers.length === 0,
  leftovers.join("、"),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 每一個條件在每一頁上，不是真的算了就是寫明不適用");
