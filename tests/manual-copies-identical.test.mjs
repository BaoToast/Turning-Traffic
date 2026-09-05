/*
 * 同一版手冊在包裡的每一份副本，內容必須逐位元相同。
 *
 * ── 為什麼需要這一支 ──
 *
 * 手冊在包裡不只一份。以本包為例，同一個檔名同時存在於：
 *   ・建置來源（public/ 或 public/manuals/）——`build-pdf.mjs` 只寫這裡
 *   ・GitHub Pages 實際發布的位置（倉庫根目錄）——要另外複製過去
 *   ・建置產物（dist 與 github-pages 目錄）——建置時從來源複製
 *
 * 2026-09-03 清理手冊那一輪，實際發生的事情是：
 * 重新產生手冊只更新了 public/ 那一份，**根目錄那一份沒有跟著更新**，
 * 於是包裡同時存在新舊兩本手冊——而網站服務的是舊的那一本。
 * 當時根目錄的 PDF 還留著已經刪掉的「v2.1.0 已修正」等維護敘事，
 * 頁數也還停在清理前的數字。
 *
 * **原有的測試全部沒有抓到**：它們只確認 `public/` 底下檔案存在、
 * 檔名帶著本版版號、舊版號的檔案已刪除——每一項根目錄那份都通過，
 * 因為它的檔名一樣是本版版號，只是內容是舊的。
 * 「檔名對」不等於「內容對」，這一支補的就是這個缺口。
 *
 * ── 檢查方式 ──
 *
 * 掃出包裡所有符合本版檔名的手冊（.pdf 與 .docx），
 * 逐一比對 SHA-256。只要有兩份不一樣就紅字，並印出各自的雜湊與位置。
 *
 * 注意：PDF 內嵌產生時間，所以「同樣的 HTML 產生兩次」也會得到不同位元組。
 * 這正是要求各副本必須來自**同一次產生**（用複製，不是各自重跑）的原因；
 * 各自重跑會踩紅這一支，那是刻意的——否則就分不出「重跑」與「忘了同步」。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * 版號一律從唯一來源（lib/traffic.ts 的 VERSION）取，不要在這裡寫死。
 * 寫死的話，升版當下這一支會因為「找不到本版手冊」而紅字——雖然擋得住，
 * 但紅的是測試本身過期，不是真的漏同步，訊息會把人帶錯方向。
 */
import { VERSION } from "../lib/traffic.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["node_modules", ".git", ".next", ".turbo", ".wrangler"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("包裡每一份手冊副本都必須來自同一次產生", () => {
  const base = `Turning-Traffic-${VERSION}-新手操作手冊`;
  const files = walk(ROOT).filter((f) =>
    [`${base}.pdf`, `${base}.docx`].includes(basename(f)),
  );
  assert.ok(
    files.length > 0,
    "包裡找不到任何本版手冊——升版時可能忘了重新產生，或檔名對不上。",
  );

  const byHash = new Map();
  for (const f of files) {
    const hash = createHash("sha256").update(readFileSync(f)).digest("hex");
    const kind = f.endsWith(".pdf") ? "pdf" : "docx";
    const key = kind + ":" + hash;
    if (!byHash.has(key)) byHash.set(key, []);
    byHash.get(key).push(relative(ROOT, f));
  }

  /* 同一種副檔名只能有一個雜湊。 */
  for (const kind of ["pdf", "docx"]) {
    const groups = [...byHash.entries()].filter(([k]) => k.startsWith(kind + ":"));
    if (groups.length <= 1) continue;
    const detail = groups
      .map(([k, list]) => `  ${k.slice(kind.length + 1, kind.length + 13)}…  ${list.join("、")}`)
      .join("\n");
    assert.fail(
      `包裡有 ${groups.length} 種不同內容的 ${kind} 手冊——代表某一份沒有跟著更新，\n` +
        `而網站服務的可能正是舊的那一份（檔名一樣，所以其他測試看不出來）。\n` +
        `重新產生手冊之後，請把 public/ 產出的那一份複製到其他每一個位置。\n` +
        detail,
    );
  }
});
