/*
 * ══════════════════════════════════════════════════════════════════════
 *  原始碼不可以寫死「某一台機器上的絕對路徑」
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 為什麼需要這一支 ──
 *
 * 這個缺陷在三支上**已經發生過三次**，而且每一次都是同一種長法：
 * 有人（含 AI）為了當下方便，把自己那台機器上的路徑直接寫進腳本。
 *
 *   ・路口轉向 `scripts/stress-drag.mjs`：寫死
 *     `/home/claude/work/turning/scripts/seed-state.json`
 *     （已於 CHANGELOG 記載修過一次）
 *   ・全日交通量 `scripts/_shot.mjs`：寫死
 *     `/home/claude/work/traffic/github-pages/dist` 與 `.samples/…xlsx`
 *   ・路口轉向 `scripts/dump-direction-table.mjs`：寫死
 *     容器裡放真實調查檔的資料夾與輸出檔
 *
 * ⚠️ 後果有兩層，第二層比第一層嚴重：
 *   ① 換一台機器跑就直接讀不到檔而中斷——但這一層至少會**吵**。
 *   ② **交付出去的原始碼裡留著別人機器的目錄結構**，其中一次還是
 *      「真實調查檔放在哪裡」。那是安靜的，不會有任何東西提醒你。
 *
 * 修掉是一次性的，**沒有守門就一定會長回來**——它已經長回來過。
 *
 * ── 這一支怎麼判 ──
 *
 * 只抓「**開發者機器**的絕對路徑」，不抓正常的程式寫法：
 *   ✗ "/home/claude/work/traffic/…"、"/Users/someone/…"、"C:\\Users\\…"
 *   ✓ "/index.html"、"/assets/…"（網址路徑，不是檔案系統路徑）
 *   ✓ "/tmp/xxx.png"（臨時輸出，沒有綁到某個人的家目錄）
 *   ✓ 註解裡引用這些路徑來解釋「不要這樣寫」——**刻意排除註解**，
 *     否則警語寫得越清楚守門越容易自己變紅，最後就是有人把守門關掉。
 *
 * 判定字串刻意用組合的方式寫，這樣這一支自己的原始碼也不會踩到自己。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/* 專案根＝從本檔往上找到的第一個有 package.json 的資料夾。 */
function projectRoot(from) {
  let dir = from;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = join(dir, "..");
  }
  throw new Error("往上六層都找不到 package.json，無法決定專案根目錄");
}

const ROOT = projectRoot(dirname(fileURLToPath(import.meta.url)));
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vinext",
  ".turbo",
  ".wrangler",
  "dist",
  "github-pages-dist",
  ".tryout",
  "vendor",
  "assets",
  "manuals",
  "test-fixtures",
]);
const CODE = new Set([".mjs", ".js", ".cjs", ".ts", ".tsx", ".json"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (CODE.has(extname(entry))) out.push(full);
  }
  return out;
}

/*
 * 把註解剝掉再掃。
 * ⚠️ 只剝 /* *​/ 與整行的 //，不碰字串——剝得太乾淨反而會把真的違規也一起吃掉。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|#)/.test(line))
    .join("\n");
}

/* 家目錄底下的絕對路徑：三種作業系統各一種寫法。 */
const HOME_ROOTS = ["/home/", "/Users/", "/root/"];
const PATTERNS = [
  ...HOME_ROOTS.map((prefix) => ({
    re: new RegExp(`["'\`]${prefix}[\\w.-]+/`, "g"),
    why: `寫死了 ${prefix}… 底下的絕對路徑`,
  })),
  {
    re: /["'`][A-Za-z]:\\\\?(Users|Documents|Desktop)/g,
    why: "寫死了 Windows 使用者目錄底下的絕對路徑",
  },
];

test("原始碼裡不可以有寫死的開發者機器路徑", () => {
  const hits = [];
  for (const file of walk(ROOT)) {
    const body = stripComments(readFileSync(file, "utf8"));
    for (const { re, why } of PATTERNS) {
      re.lastIndex = 0;
      const found = body.match(re);
      if (found) hits.push(`${relative(ROOT, file)}：${why} → ${[...new Set(found)].join("、")}`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    "以下檔案寫死了某一台機器上的路徑——換一台機器就跑不動，\n" +
      "而且會把別人的目錄結構（甚至真實資料的位置）帶進交付包：\n  " +
      hits.join("\n  ") +
      "\n\n改法：用 `fileURLToPath(import.meta.url)` 推出專案根，" +
      "或改成由 `process.argv` 傳入。",
  );
});

test("這一條真的抓得到（反面檢查，不然它可能永遠是綠的）", () => {
  /*
   * ⚠️ 反例字串**用組合的**，不可以整串寫在這裡——
   *   整串寫的話，這一支會抓到自己而永遠是紅的，
   *   下一個人就會把它從測試清單裡拿掉（那正是要防的結局）。
   */
  const HOME = "/ho" + "me/";
  const bad = `const ROOT = "${HOME}someone/work/traffic/github-pages/dist";`;
  const matched = PATTERNS.some((p) => {
    p.re.lastIndex = 0;
    return p.re.test(stripComments(bad));
  });
  assert.ok(matched, "判定式寫壞了——真的違規也抓不到");

  /* 正常寫法不可以被誤判，否則這一支很快就會被關掉。 */
  for (const ok of [
    'await page.goto("/index.html");',
    'res.end(readFileSync(join(ROOT, "/assets/index.js")));',
    'await page.screenshot({ path: "/tmp/shot.png" });',
  ])
    assert.ok(
      !PATTERNS.some((p) => {
        p.re.lastIndex = 0;
        return p.re.test(stripComments(ok));
      }),
      `誤判了正常寫法：${ok}`,
    );

  /* 註解裡引用違規路徑（用來解釋「不要這樣寫」）不可以變紅。 */
  const inComment = `/* 不要寫成 ${HOME}someone/work/turning/seed.json */`;
  assert.ok(
    !PATTERNS.some((p) => {
      p.re.lastIndex = 0;
      return p.re.test(stripComments(inComment));
    }),
    "註解裡的說明被當成違規——警語寫得越清楚守門越容易自己變紅",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  文件用反引號提到的腳本／測試檔，必須真的在包裡（2026-09-25 第六輪）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 第六輪抓到三支各有一處：文件的「守門」清單或版本紀錄裡點名一支
 * **包裡不存在**的 `.mjs`。複查者照著去跑會得到「檔案不存在」，
 * 然後開始懷疑整份清單——而清單裡其餘的都是真的。
 * 這一組系統早就有一條規則：**指向一份找不到的證據比不寫更糟。**
 *
 * ⚠️ 只掃 `.mjs` 與 `.test.ts`（複查者真的會去跑的那些），
 *   不掃 `.js`／`.css`（歷史資產雜湊檔名一大堆，掃了只會製造改不動的紅字）。
 *
 * ⚠️ 允許兩種例外，而且必須在**同一行或後三行內**寫明：
 *   ① 明講它不在包裡（「不在包裡」「已經不在」「已移除」…）——歷史紀錄的正確寫法；
 *   ② 明講那是另一支系統的檔案（「路口轉向的」「姊妹系統」「另外兩支」…）。
 *   白名單是這一支唯一的漏洞來源，所以不接受「無理由的豁免清單」。
 */
test("文件提到的 .mjs／.test.ts 必須在包裡，或明文說它不在", async () => {
  const { readdirSync, statSync, existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join, basename } = await import("node:path");
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const SKIP = new Set([
    "node_modules", ".git", ".next", "dist", "github-pages-dist", "github-pages",
    ".tryout", ".wrangler", "out", "test-results", ".probe-shots", "realdata",
  ]);
  const have = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else have.add(name);
    }
  };
  walk(ROOT);
  /* 前置檢查：真的掃到一批檔名，否則這一支等於恆真。 */
  assert.ok(have.size >= 100, `只掃到 ${have.size} 個檔名——掃描範圍壞了嗎？`);

  const EXCUSED =
    /不在包裡|已經不在|已移除|已刪除|不存在|本支沒有|本專案沒有|姊妹系統|另外兩支|路口轉向的|交通服務水準的|全日交通量的/;
  const bad = [];
  for (const doc of ["README.md","VALIDATION_REPORT.md","PROJECT_HANDOFF.md","【更新說明】請先讀我.txt","CHANGELOG.md","DEPLOYMENT.md"]) {
    const path = join(ROOT, doc);
    if (!existsSync(path)) continue;
    const lines = (await (await import("node:fs/promises")).readFile(path, "utf8")).split("\n");
    lines.forEach((line, index) => {
      for (const m of line.matchAll(/`([A-Za-z0-9_./-]+\.(?:mjs|test\.ts))`/g)) {
        const name = basename(m[1]);
        if (have.has(name)) continue;
        /*
         * ⚠️ 視窗要**往前也看**：說明常常寫在上一行
         *   （例如「…並同步更新：…路口轉向的」換行之後才是檔名）。
         *   只往後看會把正確標註過的敘述抓成違規。
         */
        if (
          EXCUSED.test(lines.slice(Math.max(0, index - 2), index + 4).join("\n"))
        )
          continue;
        bad.push(`${doc}:${index + 1} → ${name}`);
      }
    });
  }
  assert.deepEqual(
    bad,
    [],
    "文件點名了這些包裡找不到的腳本／測試檔。請確認它真的還在；" +
      "若是歷史紀錄或別支系統的檔案，在同一行或後三行寫明：\n  " +
      bad.join("\n  "),
  );
});
