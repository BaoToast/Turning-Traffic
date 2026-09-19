/*
 * ══════════════════════════════════════════════════════════════════════
 *  端對端腳本不可以拿「上一次建置的畫面」來驗這一次的修改
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-15 我自己踩到：改完側欄收合箭頭（▸／▾ → ▼ 加 CSS 轉角度）之後，
 * 單獨跑 `node scripts/e2e-nav-collapse.mjs`，它紅了，說畫面上還是「▾」。
 * 但原始碼裡明明一個 ▾ 都沒有了。
 *
 * 原因：端對端腳本是起一個小 HTTP server 去服務 **github-pages-dist**
 * （已經建置好的靜態檔），不是直接讀原始碼。`npm run e2e` 的第一步會先
 * 重新建置，所以跑整串是對的；但**單獨跑一支**就會拿到上一次建置的畫面。
 *
 * 這個坑兩個方向都會害人：
 *   ・假紅：改好了卻說沒改好（我這次遇到的，還算幸運，看得出來）
 *   ・假綠：**改壞了卻說沒壞** ← 真正危險的是這個方向。
 *     舊的建置檔是綠的，於是整支報「全部通過」，而實際交付出去的是壞的。
 *
 * 所以在這裡擋：任何 `e2e-*` 腳本一啟動，先比對
 *   「原始碼裡最新被改過的檔案時間」 vs 「建置產物的時間」
 * 建置產物比較舊 → 直接中止並印出該重建哪一行指令，不要讓它跑出結論。
 *
 * ⚠️ 只對 `e2e-` 開頭的腳本生效。手冊 PDF 產生器之類的也會匯入
 *   chrome-path.mjs，但它們不看建置產物，不應該被擋。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/** 走訪資料夾，回傳最新的修改時間（毫秒）與那個檔案的路徑。 */
function newest(dir, skip, found = { ms: 0, file: "" }) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest(path, skip, found);
      continue;
    }
    const ms = statSync(path).mtimeMs;
    if (ms > found.ms) {
      found.ms = ms;
      found.file = path;
    }
  }
  return found;
}

const SKIP = new Set([
  "node_modules",
  ".next",
  ".git",
  "github-pages-dist",
  "dist",
  ".probe-shots",
  ".tryout",
]);

/**
 * @param {object} options
 * @param {string} options.root      專案根目錄
 * @param {string[]} options.sources 要看的原始碼資料夾（相對於 root）
 * @param {string} options.dist      建置產物資料夾（相對於 root）
 * @param {string} options.rebuild   要使用者重跑的指令，印在錯誤訊息裡
 */
export function assertDistFresh({ root, sources, dist, rebuild }) {
  /*
   * ⚠️ 只擋端對端腳本。用 argv[1] 判斷，不用環境變數——環境變數會被忘記設，
   *   而「檔名是不是 e2e- 開頭」是跑什麼就是什麼，不會漏。
   */
  const entry = basename(process.argv[1] || "");
  if (!entry.startsWith("e2e-")) return;

  const distDir = join(root, dist);
  if (!existsSync(distDir)) {
    console.error(`❌ 還沒有建置產物（${dist}）。請先跑：${rebuild}`);
    process.exit(1);
  }
  const built = newest(distDir, SKIP);
  let latest = { ms: 0, file: "" };
  for (const source of sources) {
    const hit = newest(join(root, source), SKIP);
    if (hit.ms > latest.ms) latest = hit;
  }
  if (latest.ms > built.ms) {
    const gap = Math.round((latest.ms - built.ms) / 1000);
    console.error("");
    console.error("❌ 這一支端對端腳本會拿到**舊的建置畫面**，驗出來的結論不算數。");
    console.error(`   原始碼最後修改：${new Date(latest.ms).toLocaleString("sv")}  ${latest.file.slice(root.length + 1)}`);
    console.error(`   建置產物時間　：${new Date(built.ms).toLocaleString("sv")}  ${dist}`);
    console.error(`   相差 ${gap} 秒。`);
    console.error("");
    console.error(`   請先重建再跑：${rebuild}`);
    console.error("");
    process.exit(1);
  }
}
