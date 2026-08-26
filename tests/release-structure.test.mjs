/*
 * 發布結構的守門檢查。
 *
 * ── 為什麼要有這一支 ───────────────────────────────────────────────
 * 這個專案出過的問題，有一半以上**不在程式裡**，而在「發布出去的那一包
 * 長什麼樣子」。這些問題的共同點是：功能測試全綠、畫面看起來正常，
 * 錯誤只有在使用者手上才會顯現。實際發生過的：
 *
 *   1. 兩條部署路徑同時在跑（自訂 workflow 發布一份、GitHub 內建的
 *      pages-build-deployment 再發布一份），線上是哪一版取決於誰晚收工。
 *      兩邊剛好一致時完全看不出來。（v2.1.26 修正）
 *   2. 以點開頭的檔案（.github／.gitignore／.nojekyll／.openai）用網頁
 *      拖曳上傳時會被**靜默濾掉**，待上傳清單裡根本不會出現它們。
 *   3. vite 的檔名帶內容雜湊，上傳只覆蓋同名檔案，所以舊版的
 *      assets/index-<舊雜湊>.js 會**永遠留在 repository 裡**。它不影響
 *      網站，但寫著上一版的手冊檔名，會讓日後的檢查與人工判讀出錯。
 *   4. 程式版號升了、手冊沒重新產生，線上的手冊下載連結直接 404。
 *   5. 手冊封面戳記寫一個日期、每一頁頁尾印另一個日期（姊妹系統
 *      交通服務水準 v2.20.3 實際發生）。成因是版號與日期在三個檔案裡
 *      各寫一次，用字串取代升版時漏掉其中一處，而**沒有任何檢查在看日期**。
 *   6. 一個專案同時存在 npm 與 pnpm 兩份鎖定檔，兩份會慢慢漂移，
 *      用不同工具安裝就會裝到不同版本的套件。（v2.1.26 移除）
 *
 * 上面每一件事都是「發生過、修好了，但沒有任何東西擋著它再發生一次」。
 * 這一支就是那個擋著的東西。姊妹系統全日交通量的
 * tests/dependency-manifest.test.mjs 是同一個用途。
 *
 * ── 這一支刻意不做的事 ─────────────────────────────────────────────
 * 不檢查交通量、PCU 或任何計算——那些有各自的測試。這裡只看結構。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");
const has = (relative) => existsSync(join(root, relative));

/**
 * 版號的唯一來源是 lib/traffic.ts 的 VERSION。
 *
 * 這裡刻意用讀檔＋正規表示式而不是 import：這一支要驗的正是「那個檔案裡
 * 寫的字面值」，用 import 的話，萬一有人把它改成從別處算出來的值，
 * 這個檢查就失去意義了。
 */
function version() {
  const match = read("lib/traffic.ts").match(
    /export const VERSION = "(v[\d.]+)"/,
  );
  assert.ok(match, "lib/traffic.ts 裡找不到 VERSION");
  return match[1];
}

/** 手冊封面戳記上的更新日期，是日期的唯一來源。 */
function manualDate() {
  const match = read("scripts/manual/manual.html").match(
    /系統版本：v[\d.]+\s*更新日期：(\d{4}-\d{2}-\d{2})/,
  );
  assert.ok(
    match,
    "manual.html 找不到「系統版本：vX　更新日期：YYYY-MM-DD」封面戳記",
  );
  return match[1];
}

test("版號在每一個寫著它的檔案裡都一致", () => {
  const v = version();
  const bare = v.replace(/^v/, "");

  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.version, bare, "package.json 版號和 lib/traffic.ts 不一致");

  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.version, bare, "package-lock.json 版號不一致");
  assert.equal(
    lock.packages?.[""]?.version,
    bare,
    "package-lock.json 的 packages[\"\"] 版號不一致",
  );

  /*
   * 手冊產生程式與畫面連結都把版號寫進檔名，這是最容易漏改的一處——
   * 漏改的後果是線上「下載手冊」直接 404（v2.1.21 實際發生過）。
   */
  const targets = [
    ["scripts/manual/manual.html", read("scripts/manual/manual.html")],
    ["scripts/manual/build-pdf.mjs", read("scripts/manual/build-pdf.mjs")],
    ["scripts/manual/build-docx.mjs", read("scripts/manual/build-docx.mjs")],
    ["app/traffic-app.tsx", read("app/traffic-app.tsx")],
  ];
  for (const [name, text] of targets) {
    const others = [...text.matchAll(/Turning-Traffic-(v[\d.]+)-新手操作手冊/g)]
      .map((match) => match[1])
      .filter((found) => found !== v);
    assert.deepEqual(
      others,
      [],
      `${name} 還連著別版的手冊檔名（目前應為 ${v}）`,
    );
  }
  for (const ext of ["pdf", "docx"])
    assert.ok(
      read("app/traffic-app.tsx").includes(
        `Turning-Traffic-${v}-新手操作手冊.${ext}`,
      ),
      `畫面上的 ${ext} 手冊連結沒有跟著版本更新`,
    );
});

test("更新紀錄的最新一則就是目前版本", () => {
  /*
   * CHANGELOG.md 曾經漏掉 v2.1.5～v2.1.25 共 21 個版本而沒有人發現。
   * 同一份歷史有兩個來源（這裡與 lib/traffic.ts 的 VERSION_HISTORY）就一定會
   * 漂移，而漂移的那一份看起來仍然是一份正常的更新紀錄——沒有任何跡象。
   * 現在 CHANGELOG 只留重點版本、並以 VERSION_HISTORY 為唯一來源，
   * 但至少「最新一則」必須跟得上，否則交付說明會寫著上一版的內容。
   */
  const v = version();
  const first = read("CHANGELOG.md").match(/^## (v[\d.]+)/m);
  assert.ok(first, "CHANGELOG.md 裡找不到任何「## vX.Y.Z」的版本標題");
  assert.equal(
    first[1],
    v,
    `CHANGELOG.md 最新一則是 ${first[1]}，但程式版號是 ${v}——升版時漏了更新紀錄`,
  );
});

test("手冊的版號與日期只有一個來源，封面與頁尾不會對不上", () => {
  const v = version();
  const date = manualDate();

  const stamp = read("scripts/manual/manual.html").match(
    /系統版本：(v[\d.]+)/,
  )[1];
  assert.equal(stamp, v, "manual.html 封面戳記的版號和程式不一致");

  /*
   * 這一條是姊妹系統踩過的坑：封面寫 08-25、每一頁頁尾印 08-24，
   * 內容都對，只是兩處日期不同——而當時沒有任何檢查在看日期，
   * 版號檢查照樣全綠。
   */
  for (const script of [
    "scripts/manual/build-pdf.mjs",
    "scripts/manual/build-docx.mjs",
  ]) {
    const text = read(script);
    const footers = [...text.matchAll(/(v[\d.]+)\s*｜\s*(\d{4}-\d{2}-\d{2})/g)];
    assert.ok(footers.length, `${script} 找不到頁尾的「版號 ｜ 日期」字樣`);
    for (const [, foundVersion, foundDate] of footers) {
      assert.equal(foundVersion, v, `${script} 頁尾版號與程式不一致`);
      assert.equal(
        foundDate,
        date,
        `${script} 頁尾日期與手冊封面戳記不一致（封面 ${date}）`,
      );
    }
  }
});

test("手冊裡有本版的更新說明，而且沒有留著舊版的手冊檔", () => {
  const v = version();
  assert.ok(
    read("scripts/manual/manual.html").includes(`本版（${v}）更新內容`),
    `manual.html 裡找不到「本版（${v}）更新內容」——` +
      `升版時可能只改了版號、忘了寫這一版做了什麼，` +
      `或是字串取代沒有生效（姊妹系統連續三版都這樣漏掉）。`,
  );

  for (const ext of ["pdf", "docx"])
    assert.ok(
      has(`public/Turning-Traffic-${v}-新手操作手冊.${ext}`),
      `public/ 裡沒有 ${v} 的 ${ext} 手冊——程式連得到、檔案卻不存在，線上會 404`,
    );

  /* 上傳只覆蓋同名檔案、不會刪除，所以舊版手冊一定要手動清掉。 */
  for (const folder of ["public", "."]) {
    if (!has(folder)) continue;
    const stale = readdirSync(join(root, folder)).filter(
      (name) =>
        /^Turning-Traffic-v[\d.]+-新手操作手冊\.(pdf|docx)$/.test(name) &&
        !name.includes(v),
    );
    assert.deepEqual(
      stale,
      [],
      `${folder}/ 還留著舊版手冊，請先刪除：${stale.join("、")}`,
    );
  }
});

test("以點開頭的檔案都在——它們最容易在網頁上傳時被靜默濾掉", () => {
  for (const name of [
    ".nojekyll",
    ".gitignore",
    ".github/workflows/pages.yml",
    ".openai/hosting.json",
  ])
    assert.ok(
      has(name),
      `${name} 不見了。以點開頭的項目用 GitHub 網頁「拖曳上傳」會被整批濾掉` +
        `而且完全不出聲，請改用 Add file → Create new file 直接輸入完整路徑。`,
    );

  /*
   * .openai/hosting.json 看起來像「已經不用的 GPT Site 設定」，很容易被
   * 當成垃圾刪掉——但 vite.config.ts 直接 import 它，刪掉會讓建置失敗。
   * 這裡把「為什麼不能刪」釘在測試裡，比寫在文件裡可靠。
   */
  assert.ok(
    read("vite.config.ts").includes(".openai/hosting.json"),
    "vite.config.ts 不再匯入 .openai/hosting.json——" +
      "若確定要移除該檔，請連同這一條檢查一起改，不要只刪檔案。",
  );
});

test("只能有一條發布路徑：workflow 只做建置與測試，不做發布", () => {
  const dir = join(root, ".github/workflows");
  const files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));
  assert.ok(files.length, ".github/workflows 裡沒有任何 workflow");

  /*
   * 正式網站由 GitHub 內建的 pages-build-deployment 從 main 分支根目錄發布。
   * 自訂 workflow 一旦也發布，兩份內容會互相覆蓋，線上是哪一版取決於
   * 誰晚完成——而兩邊剛好一致時完全看不出來。
   */
  const forbidden = [
    "actions/deploy-pages",
    "upload-pages-artifact",
    "configure-pages",
    "actions-gh-pages",
    "pages: write",
    "JamesIves/github-pages-deploy-action",
  ];
  for (const name of files) {
    const text = readFileSync(join(dir, name), "utf8");
    for (const marker of forbidden)
      assert.ok(
        !text.includes(marker),
        `.github/workflows/${name} 含有「${marker}」——` +
          `那會讓自訂流程也去發布 Pages，形成兩條互相競爭的部署路徑。` +
          `發布請交給 GitHub 內建的 pages-build-deployment（main／根目錄）。`,
      );
  }
});

test("套件管理只有 npm 一套", () => {
  /*
   * 第二份套件版本紀錄不是無害的：它會和 npm 那一份慢慢漂移，
   * 哪天有人用另一個工具安裝就會裝到不同版本，而且不會有人發現。
   */
  for (const name of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock"])
    assert.ok(!has(name), `${name} 不該存在，本專案一律使用 npm`);
  assert.ok(has("package-lock.json"), "package-lock.json 不見了");
});

test("根目錄的建置產物沒有殘留上一版的檔案", () => {
  /*
   * repository 同時放原始碼與建置後的網站。vite 的檔名帶內容雜湊，
   * 上傳只覆蓋同名檔案，所以舊版的 assets/index-<舊雜湊>.js
   * **永遠不會被覆蓋掉**，會一直躺在 repository 裡。
   *
   * 作法：從 index.html 出發，把「被引用到的檔名」遞迴展開
   *（動態載入的分塊，其檔名寫在進入點 JS 裡），再確認 assets/ 底下
   * 每一個檔案都在這個集合中。
   */
  if (!has("assets")) return; // 只有原始碼的包沒有這一層，略過
  const indexHtml = read("index.html");
  const present = readdirSync(join(root, "assets"));

  const reachable = new Set(
    [...indexHtml.matchAll(/assets\/([A-Za-z0-9._-]+)/g)].map(
      (match) => match[1],
    ),
  );
  assert.ok(reachable.size, "index.html 沒有引用任何 assets/ 檔案");

  const queue = [...reachable];
  while (queue.length) {
    const name = queue.shift();
    if (!name.endsWith(".js")) continue;
    const path = join(root, "assets", name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const candidate of present)
      if (!reachable.has(candidate) && text.includes(candidate)) {
        reachable.add(candidate);
        queue.push(candidate);
      }
  }

  for (const name of reachable)
    assert.ok(
      present.includes(name),
      `index.html 或進入點 JS 連到 assets/${name}，但檔案不在包裡`,
    );

  const stale = present.filter((name) => !reachable.has(name));
  assert.deepEqual(
    stale,
    [],
    `assets/ 裡有沒被任何檔案引用到的殘留檔（上一版的建置產物），` +
      `請一併刪除：${stale.join("、")}`,
  );

  const entries = [...indexHtml.matchAll(/src="\.\/assets\/([^"]+)"/g)];
  assert.equal(
    entries.length,
    1,
    `index.html 應該只有一個進入點 script，實際有 ${entries.length} 個`,
  );
});

test("七叉路口壓力測試不帶參數也能找到正式建置目錄", () => {
  const script = read("scripts/stress-drag.mjs");
  assert.ok(
    !script.includes("const ROOT = process.argv[2];"),
    "stress-drag.mjs 仍要求一定要傳入根目錄；直接依文件執行會收到 undefined 並中止",
  );
  assert.match(
    script,
    /process\.argv\[2\]\s*\?\?\s*join\(here,\s*"\.\.",\s*"github-pages-dist"\)/,
    "stress-drag.mjs 沒有把 github-pages-dist 設為預設根目錄",
  );
});
