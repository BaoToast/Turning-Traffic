/*
 * ══════════════════════════════════════════════════════════════════
 *  純文字介面裡不可以出現 Markdown 記號
 * ══════════════════════════════════════════════════════════════════
 *
 * 這一支在守什麼：
 *
 *   window.confirm() / alert() / toast 訊息 / title 提示，這四種地方吃的是
 *   **純文字**，瀏覽器不會把 `**重點**` 變成粗體——它會原封不動把星號印出來。
 *   使用者看到的是：
 *
 *       ⚠️ PCU 與**尖峰時段**都會重新計算，數字會變。
 *
 *   我自己在 2026-09-11 就寫出了 10 處這種字（JSX 裡也犯過一次同類型的：
 *   JSX 不是 markdown，`**x**` 一樣是原樣印出來）。這不是打錯字，是
 *   「寫說明的時候在腦子裡用 markdown」的慣性，所以會一犯再犯——
 *   那就該由測試擋，不該靠記得。
 *
 * ⚠️ 例外只有一種：真的有一個把 `**` 轉成 <strong> 的算繪器時。
 *   全日交通量有 boldParts()，那支的 chart-notes 用 `**` 是對的；
 *   這一支（路口轉向）沒有那個算繪器，所以一律不可以出現。
 *   哪天這支也加了算繪器，要改的是這段註解與白名單，不是把測試刪掉。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const appSource = readFileSync(
  new URL("../app/traffic-app.tsx", import.meta.url),
  "utf8",
);

/**
 * 2026-09-18 大檢查（F-09）：原本只掃 traffic-app.tsx，結果 lib/traffic.ts 的
 * 匯入警告（X-66 那兩句）、lib/conclusion.ts 與 lib/report-draft.ts 的草稿、
 * app/main-filters.ts 的 peakRuleNote 都帶著星號——那些都是純文字去處
 * （匯入辨識結果面板、草稿 textarea／剪貼簿）。現在掃 app/ 與 lib/ 底下全部
 * .ts／.tsx。
 *
 * ⚠️ 唯一的例外：lib/traffic.ts 的 VERSION_HISTORY 陣列。v2.1.62 起版本歷程
 *   不再渲染到畫面上（note 只給發布流程與測試讀），裡面的 ** 是給人讀原始碼的
 *   排版，不是使用者會看到的字。這裡把那一段整塊切掉再掃——切法是從
 *   `export const VERSION_HISTORY = [` 到它之後第一個行首 `];`；
 *   下面有一則前置測試確認這一段真的切得到、而且切掉的範圍沒有吞到別的東西。
 */
const SOURCE_DIRS = ["app", "lib"];
const SOURCE_FILES = SOURCE_DIRS.flatMap((dir) =>
  readdirSync(new URL(`../${dir}/`, import.meta.url))
    .filter((name) => /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts"))
    .map((name) => `${dir}/${name}`),
);
function readSource(rel) {
  const text = readFileSync(new URL("../" + rel, import.meta.url), "utf8");
  if (rel !== "lib/traffic.ts") return text;
  return withoutVersionHistory(text);
}
function withoutVersionHistory(text) {
  const start = text.indexOf("export const VERSION_HISTORY = [");
  if (start < 0) return text;
  const end = text.indexOf("\n];", start);
  if (end < 0) return text;
  return text.slice(0, start) + text.slice(end + 3);
}

/**
 * 把註解拿掉之後，找出字串字面值裡的 `**`。
 *
 * 刻意不寫成完整的 JS 剖析器——只要做到「註解不算、字串算」就夠了，
 * 而且看得懂比看起來聰明重要。
 */
function markupInStrings(source) {
  /* 1. 去掉 /* … *\/ 與 // … 兩種註解（註解裡用 markdown 是刻意的，要放行） */
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  /* 2. 在剩下的程式碼裡，挑出單行字串字面值（"…" / '…' / `…`）含有 ** 的 */
  const hits = [];
  const patterns = [/"([^"\\\n]|\\.)*"/g, /'([^'\\\n]|\\.)*'/g, /`([^`\\]|\\.)*`/g];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(stripped))) if (m[0].includes("**")) hits.push(m[0]);
  }
  return hits;
}

test("前置：這個掃描器真的抓得到違規字串（抓不到的話下一項會恆綠）", () => {
  const fake = [
    'notify("⚠️ 這裡會**變粗體**吧？");',
    "const t = `數字會**變**`;",
    "const u = '請按**確認**';",
  ].join("\n");
  const hits = markupInStrings(fake);
  assert.equal(hits.length, 3, `三種引號都要抓到，實際抓到 ${hits.length} 個`);

  /* 反面：註解裡的 markdown 不可以被誤判成違規 */
  const comment = [
    "/* 這是註解，裡面寫 **重點** 是刻意的 */",
    "// 這行也是註解，**不算**",
  ].join("\n");
  assert.deepEqual(markupInStrings(comment), []);
});

test("介面文字（confirm／toast／title）不可以留下 Markdown 粗體記號", () => {
  const hits = markupInStrings(appSource);
  assert.deepEqual(
    hits,
    [],
    "這些字串會原樣把星號印在畫面上，請改用「」：\n" +
      hits.map((h) => "  " + h).join("\n"),
  );
});

test("前置：VERSION_HISTORY 的切除只切那一段（切不到或切過頭都不行）", () => {
  const raw = readFileSync(new URL("../lib/traffic.ts", import.meta.url), "utf8");
  const cut = withoutVersionHistory(raw);
  assert.ok(cut.length < raw.length, "沒有切到 VERSION_HISTORY");
  assert.ok(!cut.includes("export const VERSION_HISTORY"), "VERSION_HISTORY 還在");
  /* 陣列後面的程式（匯入警告那一段）一定要留著，不然這一則守門就掃不到它 */
  assert.ok(cut.includes("duplicateApproachCodes"), "切過頭了：匯入警告那一段被一起切掉");
  assert.ok(cut.includes("export function"), "切過頭了：函式都不見了");
  /* 而且版本歷程確實不再渲染到畫面（這是放行它的前提） */
  assert.ok(
    !/VERSION_HISTORY\.map\(/.test(appSource),
    "traffic-app.tsx 又把 VERSION_HISTORY 渲染到畫面上了，note 裡的 ** 會變成星號，白名單前提沒了",
  );
});

test("app/ 與 lib/ 全部原始檔的字串都不可以留下 Markdown 粗體記號", () => {
  assert.ok(SOURCE_FILES.includes("lib/traffic.ts") && SOURCE_FILES.includes("lib/conclusion.ts"));
  assert.ok(SOURCE_FILES.length >= 15, `只掃到 ${SOURCE_FILES.length} 個檔`);
  const bad = [];
  for (const file of SOURCE_FILES)
    for (const hit of markupInStrings(readSource(file))) bad.push(`${file}｜${hit.slice(0, 120)}`);
  assert.deepEqual(
    bad,
    [],
    "這些字串是純文字去處（面板、草稿、剪貼簿），星號會原樣印出來，請改用「」：\n" +
      bad.map((b) => "  " + b).join("\n"),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════
 *  倍率／百分比的句子一定要有主詞
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：
 *   「『大約剩下原來的 65%』，『原來的』是什麼？正確說明應該是
 *     『假日是平日的 65%』……這類調查報告應該沒有所謂的原來值，
 *     除非是區分施工前、施工後，但最好還是要有主詞……
 *     『A 是 B 的幾 %』主詞要明確，不然會看不懂，是跟誰比才有這倍率。」
 *
 * 這種句子會被**整段複製進報告**，讀的人手上沒有畫面可以對照，
 * 主詞一定要自己帶著。
 *
 * ⚠️ 真正的保證是型別：describeChange() 的 labels 參數是**必填**，
 *   少給就編譯不過。這一支守的是另一件事：**不要有人在別處又寫一句
 *   「大約是原來的 N 倍」**——那種句子長得和正常的一模一樣，只是少了主詞。
 */
import { readFileSync as readFileSyncRatio } from "node:fs";

function readRatio(rel) {
  return readFileSyncRatio(new URL("../" + rel, import.meta.url), "utf8");
}

test("倍率句不可以寫成「原來的 N 倍／N%」（沒有主詞）", () => {
  const files = [
    "lib/trend-metrics.ts",
    "lib/conclusion.ts",
    "app/traffic-app.tsx",
  ];
  const bad = [];
  for (const file of files) {
    let source;
    try {
      source = readRatio(file);
    } catch {
      continue;
    }
    /* 註解裡引用舊寫法是刻意的（說明為什麼改掉），所以要先去掉註解 */
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    for (const m of stripped.matchAll(/[^\n]{0,40}原來的[^\n]{0,40}/g))
      bad.push(`${file}｜${m[0].trim()}`);
  }
  assert.deepEqual(
    bad,
    [],
    "這些句子沒有主詞，讀的人不知道是跟誰比：\n" +
      bad.map((b) => "  " + b).join("\n"),
  );
});

test("前置：這條掃描抓得到沒有主詞的寫法（不然它是恆真的）", () => {
  const fake = "const t = `整體上升 100 輛，大約是原來的 2 倍`;";
  assert.ok(
    [...fake.matchAll(/原來的/g)].length === 1,
    "掃描抓不到「原來的」，上面那條等於沒做",
  );
});


/*
 * ══════════════════════════════════════════════════════════════════
 *  沒有主詞的比較基準用語，一律不准出現
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：
 *   「A 比 B 降低／增加 X% 或 X 倍之類，不要寫『比原來』『比以前』
 *     之類不客觀的用詞，會分不清誰跟誰作比較。」
 *
 * 上面那一條只擋了「原來的」。這一條把同一類的說法一起擋掉：
 * 「以前」「先前」「原先」「原本」當**比較基準**時，讀的人手上沒有畫面，
 * 不知道那個基準是哪一季、哪一個路段、還是施工前——句子等於沒有意義。
 *
 * ⚠️ 真正的保證仍然是型別（describeChange()／timesText() 的標籤參數必填）。
 *   這一條守的是「有人在別處又手寫一句」——那種句子長得和正常的一模一樣，
 *   只是少了主詞，程式不會有任何抱怨。
 *
 * ⚠️ 註解裡引用舊寫法是刻意的（說明為什麼改掉），所以要先去掉註解再掃。
 */
const SUBJECTLESS = [
  "原來的",
  "以前的",
  "先前的",
  "原先的",
  "比以前",
  "比先前",
  "比原本",
  "較以前",
  "較先前",
  "較原本",
];

test("比較基準一定要有主詞（不可以寫「比以前」「比原來」這類）", () => {
  const files = [
    "lib/trend-metrics.ts",
    "lib/conclusion.ts",
    "app/traffic-app.tsx",];
  const bad = [];
  for (const file of files) {
    let source;
    try {
      source = readRatio(file);
    } catch {
      continue;
    }
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    for (const word of SUBJECTLESS)
      for (const m of stripped.matchAll(
        new RegExp(`[^\n]{0,40}${word}[^\n]{0,40}`, "g"),
      ))
        bad.push(`${file}｜${word}｜${m[0].trim()}`);
  }
  assert.deepEqual(
    bad,
    [],
    "這些句子沒有主詞，讀的人不知道是跟誰比：\n" + bad.map((b) => "  " + b).join("\n"),
  );
});

test("前置：這條掃描抓得到沒有主詞的寫法（不然它是恆真的）", () => {
  const fake = "const t = `本季比以前少了 12%`;";
  assert.ok(
    SUBJECTLESS.some((word) => fake.includes(word)),
    "掃描字串抓不到「比以前」，上面那條等於沒做",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  畫面上不可以出現「佔位字樣」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-15 我自己製造的錯：修字形問題時，把「複製說明文字」按鈕上的
 * 圖示字元「⧉」(U+29C9，不在 Big5) 換成了字面的「（重複）」，
 * 於是按鈕上真的印出「（重複） 複製說明文字」——使用者會以為按了會重複貼上。
 *
 * ⚠️ 上面那支 markupInStrings 抓不到它：那個字樣是 **JSX 的文字節點**，
 *   不是字串字面值。所以這一條改成掃「去掉註解之後的整份原始碼」——
 *   這幾個字樣不管出現在哪裡都是錯的（註解裡討論它才合法）。
 *
 * ⚠️ 名單要保持短。塞進「範例」「測試」這種正常會用到的詞，
 *   守門就會開始亂叫，最後被人整條註解掉——那比沒有還糟。
 */
const PLACEHOLDER_MARKERS = [
  "（重複）",
  "(重複)",
  "（待補）",
  "（暫定）",
  "（未完成）",
  "[object Object]",
];

/** 去掉註解之後，找出出現在程式碼裡的佔位字樣。 */
function placeholdersIn(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    /* JSX 註解 {/* … *\/} 已被上面那條吃掉，這裡再清掉殘留的大括號 */
    .replace(/\{\s*\}/g, " ");
  return PLACEHOLDER_MARKERS.filter((marker) => stripped.includes(marker));
}

test("前置：佔位字樣的掃描器真的抓得到（抓不到的話下一項會恆綠）", () => {
  assert.deepEqual(
    placeholdersIn('<button>（重複） 複製說明文字</button>'),
    ["（重複）"],
  );
  /* 註解裡討論它要放行，否則這一段說明自己就會讓測試紅。 */
  assert.deepEqual(placeholdersIn("/* 不可以印出（重複） */"), []);
});

test("畫面文字不可以留下佔位字樣（例如「（重複）」）", () => {
  const files = [
    "../app/traffic-app.tsx",
    "../app/peak-shape-charts.tsx",
    "../app/main-toolbar.tsx",
  ];
  const bad = [];
  for (const file of files) {
    let source;
    try {
      source = readFileSync(new URL(file, import.meta.url), "utf8");
    } catch {
      continue; /* 檔案搬家了就跳過，不要因此紅 */
    }
    for (const marker of placeholdersIn(source)) bad.push(`${file}：${marker}`);
  }
  assert.deepEqual(bad, [], "畫面上出現了佔位字樣：\n" + bad.join("\n"));
});

/*
 * ══════════════════════════════════════════════════════════════════
 *  X-49：異常的「解決方式」也是純文字，一樣不可以有 Markdown 記號
 * ══════════════════════════════════════════════════════════════════
 *
 * 這一段文字寫在 `lib/traffic.ts` 的 `qualityIssues()` 裡，
 * 直接塞進 `<span>` 與 Excel 的欄位——兩邊都不會把 `**x**` 變成粗體。
 *
 * ⚠️ **不可以**整個 lib/traffic.ts 一起掃：那個檔案裡的版本紀錄
 *   （RELEASE_NOTES 之類）是**刻意**用 Markdown 寫的，有算繪器負責。
 *   所以這裡只掃 qualityIssues() 這一段函式的範圍。
 *
 * ⚠️ 也要驗「每一筆異常都有 resolution」——漏掉一個類型的話，
 *   畫面上那一列的解決方式會是 undefined，執行期直接爆掉。
 *   靜態掃不出「每一次 push 都有」，所以這裡數的是
 *   `issues.push(` 與 `resolution: {` 的次數要一樣多。
 */
const libSource = readFileSync(
  new URL("../lib/traffic.ts", import.meta.url),
  "utf8",
);
function qualityIssuesBody(source) {
  const start = source.indexOf("export function qualityIssues");
  const end = source.indexOf("export type IntervalRow");
  if (start < 0 || end < 0 || end <= start)
    throw new Error("找不到 qualityIssues() 的範圍——這支測試要跟著改，不是刪掉");
  return source.slice(start, end);
}

test("前置：qualityIssues() 的範圍真的切得出來，而且不是空的", () => {
  const body = qualityIssuesBody(libSource);
  assert.ok(body.length > 2000, `切出來只有 ${body.length} 字，範圍抓錯了`);
  assert.ok(body.includes("resolution:"), "切出來的範圍裡沒有 resolution，抓錯了");
});

test("X-49：解決方式的文字不可以留下 Markdown 粗體記號", () => {
  assert.deepEqual(
    markupInStrings(qualityIssuesBody(libSource)),
    [],
    "這些字會原樣把星號印在檢查結果與 Excel 裡，請改用「」",
  );
});

test("X-49：每一筆異常都要有「解決方式」，一個都不可以漏", () => {
  const body = qualityIssuesBody(libSource);
  const pushes = body.match(/issues\.push\(\{/g) || [];
  const resolutions = body.match(/\n\s+resolution: \{/g) || [];
  assert.equal(
    resolutions.length,
    pushes.length,
    `有 ${pushes.length} 種異常，卻只有 ${resolutions.length} 個解決方式——` +
      "漏掉的那一種在畫面上會是空白，而使用者就不知道那一筆該怎麼辦",
  );
  assert.ok(pushes.length >= 7, `只找到 ${pushes.length} 種異常，掃描寫壞了`);
});

test("X-49：解決方式不可以共用一句通用句（每一種異常各寫各的）", () => {
  const body = qualityIssuesBody(libSource);
  const texts = [...body.matchAll(/\n\s+text:\s*("(?:[^"\\]|\\.)*")/g)].map(
    (m) => m[1],
  );
  assert.ok(texts.length >= 7, `只抓到 ${texts.length} 句解決方式`);
  assert.equal(
    new Set(texts).size,
    texts.length,
    "有兩種以上的異常共用同一句解決方式——那等於沒寫",
  );
  for (const text of texts)
    assert.ok(
      text.length > 40,
      `這一句太短、講不出使用者實際要做什麼：${text}`,
    );
});
