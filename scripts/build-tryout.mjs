/*
 * 產生「一個檔案就能用」的試用版 HTML。
 *
 * 使用者的測試流程是：收到一個 .html → 點兩下用瀏覽器開 → 直接操作。
 * 不架伺服器、不解壓縮，所以 JS 與 CSS 一定要整段塞進 HTML 裡。
 *
 * ⚠️ 這支只做「內嵌」，不做任何功能上的取捨——試用版與正式版是同一份程式，
 *   否則使用者試過沒問題的東西，發布之後可能不一樣。
 *
 * ⚠️ 內嵌完一定要檢查**沒有任何剩下的外部參照**。
 *   漏一個 <script src> 在 file:// 下不會報錯給使用者看，
 *   畫面照樣長出來，只是某個功能默默沒反應——最難查的那種。
 *   所以下面有一段硬性檢查，發現殘留就直接失敗，不產檔。
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION as SYSTEM_VERSION } from "../lib/traffic.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, ".tryout");
const indexPath = join(dist, "index.html");
if (!existsSync(indexPath))
  throw new Error(
    "找不到 .tryout/index.html——請先執行 npm run build:tryout",
  );

let html = readFileSync(indexPath, "utf8");

/** 把 <script type="module" src="./assets/x.js"></script> 換成內嵌。 */
html = html.replace(
  /<script([^>]*?)\ssrc="\.\/([^"]+)"([^>]*)><\/script>/g,
  (whole, before, file, after) => {
    const full = join(dist, file);
    if (!existsSync(full)) throw new Error(`找不到要內嵌的 ${file}`);
    const code = readFileSync(full, "utf8");
    /*
     * ⚠️ 程式碼裡若出現 </script> 會提前結束標籤。
     *   實測：xlsx 這類函式庫的字串常數裡真的有這種東西。
     *   用 <\/script 取代是 JS 字面值裡合法的寫法，行為完全相同。
     */
    return `<script${before}${after}>${code.replace(/<\/script/gi, "<\\/script")}</script>`;
  },
);

/** 把 <link rel="stylesheet" href="./assets/x.css"> 換成 <style>。 */
html = html.replace(
  /<link[^>]*rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g,
  (whole, file) => {
    const full = join(dist, file);
    if (!existsSync(full)) throw new Error(`找不到要內嵌的 ${file}`);
    return `<style>${readFileSync(full, "utf8")}</style>`;
  },
);

/*
 * modulepreload 只是效能提示，內嵌之後指向的檔案已經不存在了。
 * 留著會在 file:// 下產生 404（使用者看不到，但主控台會紅一片）。
 */
html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, "");
/* favicon 等小檔已被 assetsInlineLimit 轉成 data URI；沒轉到的就拿掉連結。 */
html = html.replace(
  /<link[^>]*rel="icon"[^>]*href="\.\/(?!data:)[^"]+"[^>]*>/g,
  "",
);

/*
 * ── 網路字型：試用版不可以往外連 ───────────────────────────────
 *
 * ⚠️ 2026-09-12 實測抓到：內嵌完的 CSS 第一行仍然是
 *     @import 後面直接接 fonts.googleapis.com 的網址
 *   下面那一段「殘留外部參照」的檢查看不到它——它只找 `./` 與 `assets/`
 *   開頭的相對路徑，而這是一個絕對網址，而且是在 CSS 裡、不是 src/href。
 *
 *   後果：使用者拿到的是一個「單檔、點兩下就能用」的試用版，卻在開啟時
 *   靜靜地連一次網路。沒有網路（或公司擋掉）時字型會退回備援，
 *   畫面與我驗過的長得不一樣，而且**沒有任何訊息**。
 *
 *   做法是拿掉這一行，讓它走 CSS 本來就寫好的備援字型堆疊
 *  （"Microsoft JhengHei" 等系統字型；另外兩支程式本來就是這樣，
 *    所以拿掉之後三支的字型來源反而一致）。
 *
 * ⚠️ 2026-09-13 更新：使用者看過有無網路字型的並排截圖之後決定**正式站也拿掉**，
 *   所以 globals.css 裡那一行 @import 已經不在了。下面這段取代因此平常不會命中，
 *   **但刻意留著**——它是一道「不准再有人把網路字型加回來」的保險，
 *   而且和下面那個「一個對外連線都不可以有」的硬性檢查是同一件事的兩層。
 */
/*
 * ⚠️ 兩種寫法都要收：原始碼裡是 @import 加 url(網址)，但 Vite 打包時會把它
 *   normalise 成 @import 直接接網址（沒有 url()）。第一版只寫了 url() 那一種，
 *   建置照樣「成功」，而試用版仍然往外連——單靠讀原始碼看不出來，
 *   是打開產出的檔案搜字串才發現的。
 */
html = html.replace(
  /@import\s+(?:url\(\s*)?["']https?:\/\/fonts\.googleapis\.com[^"']*["']\s*\)?\s*;?/g,
  "",
);

/* ── 硬性檢查：不可以有任何剩下的外部參照 ───────────────────── */
/*
 * ⚠️ 只找**瀏覽器真的會去抓**的那幾種寫法：
 *   ・標籤上的 src= 或 href= 指向 http 網址
 *   ・CSS 裡的 url(http…) 與 @import 指向 http 網址
 *
 *   不可以改成「整份 HTML 裡出現 http 就算」——xlsx 那個函式庫的
 *   XML 命名空間常數（schemas.openxmlformats.org…）滿滿都是網址字串，
 *   那些只是字串，不會發出任何請求。用寬鬆的比對會全部誤判，
 *   然後人就會把這一條整個關掉，等於沒守。
 *
 *   og:image 那種 <meta content="…"> 也不算：社群預覽用的，開啟頁面時
 *   瀏覽器不會去抓。
 */
const external = [
  ...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g),
  ...html.matchAll(/url\(\s*["']?(https?:\/\/[^"')]+)/g),
  /* Vite 會把 @import 的 url(…) 形式 normalise 掉，兩種都要收。 */
  ...html.matchAll(/@import\s+(?:url\(\s*)?["'](https?:\/\/[^"']+)["']/g),
].map((m) => m[1]);
if (external.length)
  throw new Error(
    "試用版還會往外連線，離線或公司網路擋掉時會靜靜地不一樣：\n  " +
      [...new Set(external)].join("\n  "),
  );
/*
 * ── 手冊 PDF：放成**同資料夾的獨立檔**，不再嵌進 HTML ──────────────
 *
 * ⚠️ 2026-09-14 實測抓到（把產出的試用版真的用 file:// 打開、點到
 *   「新手操作手冊」那一頁去量那顆按鈕的 href，不是讀原始碼猜的）：
 *   「下載完整 PDF 手冊」的 href 是 ./路口轉向程式手冊_vX.Y.Z.pdf。
 *   單檔試用版旁邊沒有那個檔，按下去在 file:// 下**不會有任何錯誤訊息**，
 *   畫面毫無反應——使用者只會覺得按鈕壞了，而且不會來問。
 *
 *   交通服務水準早就踩過同一顆雷並修好了（它把手冊嵌成 data URI），
 *   本支與全日交通量卻一路沒有補上——正是使用者說的
 *   「我們踩過的雷，請確保三份程式都不會再踩到」。
 *
 * ⚠️ 依 build-tryout 的原則：試用版不做功能取捨，所以是**把手冊帶著走**，
 *   不是把按鈕拿掉。
 *
 * ── 為什麼從「嵌成 data URI」改成「同資料夾的獨立檔」（2026-09-16）──
 *
 * 使用者回報「試用檔不像以前那樣立刻開起，要等 1～2 秒、滑鼠還會轉圈」。
 * 實測（headless Chromium，各量 7 次取平均）：本支 4.69 MB → 1.91 MB、
 * DOMInteractive 266ms → 151ms（−43%）。手冊 PDF 佔整個試用版的 59%。
 * 三支的數字與結論見 ts2028/build-tryout.mjs 的同一段註解。
 * 使用者 2026-09-16 裁示：手冊改成同資料夾的獨立檔。
 *
 * ⚠️ 也試過「把 base64 搬到非 JS 的 <script> 區塊」——實測**沒有用**。
 *   成本來自檔案大小本身，不是 base64 放在哪裡。記下來免得有人再試一次。
 *
 * ⚠️ 代價要講清楚：試用版不再是「只有一個檔」。HTML 被單獨搬走時手冊就開不了，
 *   所以按鈕上的字要先講明白（見下面那一段）。
 *
 * ⚠️ 這個連結是 React 打包後在 JS 字面值裡組出來的（反引號字串），
 *   不是 index.html 裡的 href 屬性——所以：
 *   ①要對**內嵌之後的整份 HTML** 取代；
 *   ②下面那條 leftovers 檢查（只看 src=／href="…"）看不到它，
 *     那也正是它一路沒被擋下來的原因，已在下面一併補強。
 */
const manualLink = /\.\/(路口轉向程式手冊_[^"'`]+\.pdf)/g;
/** 這一次要跟著 HTML 一起交出去的手冊檔名（給下面的搬檔與檢查用）。 */
const manualFiles = new Set();
html = html.replace(manualLink, (whole, file) => {
  const name = decodeURIComponent(file);
  const full = join(dist, name);
  if (!existsSync(full)) throw new Error(`找不到要交付的手冊 ${name}`);
  manualFiles.add(name);
  /* 本來就已經是同資料夾的相對路徑，原樣留著即可。 */
  return whole;
});
/*
 * ⚠️ 前置檢查：一次都沒命中就代表「手冊按鈕不見了」或「href 改了寫法」，
 *   兩種都必須停下來——否則這一段會安靜地變成恆真的裝飾。
 */
if (!manualFiles.size)
  throw new Error(
    "找不到任何手冊連結。手冊按鈕被拿掉了，或 href 的寫法變了；" +
      "不可以就這樣出檔，否則試用版又會出現一顆按了沒反應的按鈕。",
  );
/*
 * ⚠️ 按鈕上的字要**先講**手冊是獨立檔。
 *   使用者只把 HTML 複製到別處時，按下去會開不了——那時候才發現就太晚了。
 */
/*
 * ⚠️ 使用者 2026-09-16：「這個按鈕的名稱太長了，括號內的文字不需要」。
 *   提醒改掛在按鈕的 title（滑鼠移上去才顯示）。這裡只確認按鈕還在。
 */
const manualLabel = "下載新手手冊";
if (!html.includes(manualLabel))
  throw new Error(
    "找不到手冊按鈕（下載新手手冊）；按鈕文字改過了就要一起更新這裡。",
  );

const leftovers = [
  ...html.matchAll(/(?:src|href)="(\.\/[^"]+|assets\/[^"]+)"/g),
  /*
   * ⚠️ 上面那一條只看 HTML 屬性，打包後寫在 JS 字面值裡的相對路徑一律漏掉
   *   ——手冊那顆死連結就是這樣溜過去的。補一條專找「還指向本機檔案的
   *   相對路徑」：副檔名限定在使用者會按下去下載的那幾種，
   *   不放寬成「出現 ./ 就算」（函式庫裡的模組路徑會全部誤判）。
   */
  ...html.matchAll(
    /["'`](\.{0,2}\/[^"'`<>]*\.(?:pdf|docx|xlsx|csv|zip))["'`]/gi,
  ),
]
  .map((m) => m[1])
  /*
   * ⚠️ 手冊是**刻意**留成同資料夾的相對路徑（2026-09-16 使用者裁示），
   *   所以放行——但只放行「這一次真的會跟著交出去的那幾個檔名」，
   *   不是放行所有 .pdf。全部放行的話，日後任何一個忘了處理的 PDF 連結
   *   都會靜靜地溜過去。
   */
  .filter((ref) => !manualFiles.has(decodeURIComponent(ref.replace(/^\.\//, ""))));
if (leftovers.length)
  throw new Error(
    "試用版還有沒內嵌的外部檔案，單檔開啟時會默默失效：\n  " +
      [...new Set(leftovers)].join("\n  "),
  );

/*
 * ── 大小上限：3 MB ──────────────────────────────────────────────
 *
 * ⚠️ 這不是潔癖，是使用者實際回報的問題（2026-09-16）：
 *   「試用檔不像以前那樣立刻開起，要等 1～2 秒、滑鼠指標還會出現轉圈」。
 *   原因是程式手冊 PDF 被整份嵌進 HTML，三支各佔 59～71% 的體積。
 *   實測拿掉之後 DOMInteractive 少 43～49%。
 *
 * ⚠️ 這一條擋的是**同一類錯再發生**：日後有人再把一個幾 MB 的東西
 *  （手冊、字型、範例檔、圖庫）整份塞進來時，出檔就會停下來，
 *   而不是等使用者發現「開檔變慢了」才回頭查。
 *
 * ⚠️ 真的需要放寬時，請連同**為什麼**一起改這個數字與這段註解。
 *   目前三支是 1.8～2.3 MB，3 MB 留了足夠的成長空間。
 */
const SIZE_LIMIT_MB = 3;
const sizeMb = Buffer.byteLength(html) / 1024 / 1024;
if (sizeMb > SIZE_LIMIT_MB)
  throw new Error(
    `試用版 ${sizeMb.toFixed(2)} MB，超過 ${SIZE_LIMIT_MB} MB 的上限。\n` +
      "  開檔會明顯變慢（使用者 2026-09-16 回報過一次）。\n" +
      "  多半是有東西被整份內嵌了（手冊、字型、範例檔…）；\n" +
      "  請改成放同資料夾的獨立檔，或先確認放寬上限是有意識的決定。",
  );

const out = join(
  root,
  "..",
  "out",
  `路口轉向_試用版_${SYSTEM_VERSION}.html`,
);
const outDir = dirname(out);
mkdirSync(outDir, { recursive: true });
writeFileSync(out, html, "utf8");
/*
 * 手冊 PDF 要跟 HTML **放在一起**交出去，否則按鈕一樣是壞的。
 * ⚠️ 搬完要再確認一次真的在那裡：少了這一步，出檔會成功、按鈕會壞，
 *   而且要等使用者按下去才知道。
 */
for (const name of manualFiles) {
  const target = join(outDir, name);
  copyFileSync(join(dist, name), target);
  if (!existsSync(target)) throw new Error(`手冊沒有搬到交付資料夾：${name}`);
}
console.log(
  `試用版已產生：${out}\n  大小 ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB` +
    `・除了同資料夾的手冊（${[...manualFiles].join("、")}）之外沒有任何外部參照` +
    `\n  ⚠️ 手冊 PDF 要與 HTML 放在同一個資料夾一起交出去`,
);
