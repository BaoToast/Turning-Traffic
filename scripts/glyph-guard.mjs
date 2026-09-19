/*
 * ══════════════════════════════════════════════════════════════════════
 *  字形把關：畫面上的符號只能用「微軟正黑體一定有」的那一組
 * ══════════════════════════════════════════════════════════════════════
 *
 * 為什麼有這支：
 *
 * 使用者 2026-09-11 回報「匯出備份(直接下載) 名字旁邊的向下箭頭已經看不到，
 * 會展開視窗的向右箭頭也看不到」。查下去才發現，程式碼寫的是
 * 「⤓」(U+2913) 與「▸」(U+25B8)——這兩個字**不在 Big5 字集裡**。
 * 網頁的字型是 "Microsoft JhengHei"（微軟正黑體），它的符號涵蓋範圍
 * 基本上就是 Big5 那一組；缺字的時候瀏覽器不見得找得到替補字型，
 * 畫出來就是**一片空白**（不是豆腐框），所以看起來像「記號根本沒做」。
 *
 * ⚠️ 這種錯誤三支程式都測不出來：
 *   ・單元測試看的是字串內容，內容是對的。
 *   ・e2e 量得到元素存在、寬高不是 0（空白也有寬度），一樣過關。
 *   ・截圖要有人用肉眼看才看得出來。
 * 所以只能在**原始碼層**擋：符號一律走白名單。
 *
 * 白名單的依據是 Big5 的符號區（A1xx–A2xx）。這不是「保守起見」，
 * 是實測結論：使用者看得到 ▼、→、…，看不到 ⤓、▸。
 *
 * ── 怎麼加新符號 ────────────────────────────────────────────────
 * 不要因為「應該會有吧」就往 SAFE 裡加。先確認它在 Big5 符號區，
 * 或在實機（Windows + Chrome + 微軟正黑體）上親眼看過才加，
 * 並在下面註明是哪一種。
 *
 * ── 為什麼 emoji 放行 ──────────────────────────────────────────
 * 帶 U+FE0F 變體選擇子的 emoji（例如 ⚠️）走的是 Segoe UI Emoji，
 * 不吃正黑體的涵蓋範圍，實機上看得到，所以不在管制範圍。
 */
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Big5 符號區裡確定有、而且我們實際會用到的符號。 */
const SAFE = new Set([
  "—", // U+2014 EM DASH（Big5 A156）
  "–", // U+2013 EN DASH（Big5 A157）
  "…", // U+2026 HORIZONTAL ELLIPSIS（Big5 A14C）
  "※", // U+203B REFERENCE MARK（Big5 A1B1）
  "←", // U+2190（Big5 A1F6）
  "↑", // U+2191（Big5 A1F7）
  "→", // U+2192（Big5 A1F8）
  "↓", // U+2193（Big5 A1F9）
  "○", // U+25CB（Big5 A1B3）
  "●", // U+25CF（Big5 A1B4）
  "△", // U+25B3（Big5 A1B6）
  "▲", // U+25B2（Big5 A1B7）
  "▽", // U+25BD（Big5 A1B8）
  "▼", // U+25BC（Big5 A1B9）
  "□", // U+25A1（Big5 A1BC）
  "■", // U+25A0（Big5 A1BD）
  "◇", // U+25C7（Big5 A1BE）
  "◆", // U+25C6（Big5 A1BF）
  "℃", // U+2103（Big5 A24A）
  /*
   * ⚠️ 大小於等於用**全形**的 ≧ ≦（Big5 A1D3／A1D4），不是 ≥ ≤（U+2265／U+2264）。
   *   後面那兩個不在 Big5，微軟正黑體不一定有。中文句子裡用全形的本來也比較搭。
   */
  /* 漢堡選單鈕用 ≡（Big5 A1E3）——☰（U+2630）不在 Big5。 */
  "≡", // U+2261（Big5 A1E3）
  "≧", // U+2267（Big5 A1D3）
  "≦", // U+2266（Big5 A1D4）
  "±", // U+00B1
  "×", // U+00D7
  "÷", // U+00F7
]);

/** 要檢查的字碼範圍：一般標點、箭頭、數學符號、方塊元素、幾何圖形、雜項符號、Emoji。 */
function isSymbol(code) {
  return (
    (code >= 0x2000 && code <= 0x2bff) ||
    (code >= 0x1f000 && code <= 0x1faff) ||
    (code >= 0x2e00 && code <= 0x2e7f)
  );
}

/**
 * 去掉註解。
 *
 * ⚠️ 只掃「會被畫出來的字」。註解裡寫 ⚠️、寫 ▸ 來說明「這個字不能用」
 * 都是正常的——把註解一起掃進去的話，這支檢查會擋掉自己的說明文字。
 */
function stripComments(source) {
  return (
    source
      /*
       * ⚠️ 區塊註解要**換成同樣多的換行**，不可以直接刪掉。
       *   直接刪會把後面所有行的行號往前推，於是報出來的
       *   「lib/traffic.ts:647」根本不是那一行——照著去看會看到別的東西，
       *   而看的人第一個反應是「這支守門在亂講」。
       *   （2026-09-15 實測：報 647 行，實際在 1000 多行。）
       */
      .replace(/\/\*[\s\S]*?\*\//g, (block) =>
        "\n".repeat((block.match(/\n/g) || []).length),
      )
      .replace(/^[ \t]*\/\/.*$/gm, "")
  );
}

/**
 * 去掉正規表示式字面值。
 *
 * ⚠️ 這一段**不能省**。三支程式都有「把各種破折號正規化成同一個」這類寫法：
 *
 *     .replace(/[-‐‑‒–—―－~～〜]+/g, "－")
 *
 * 那些字**永遠不會被畫到畫面上**——它們是要被換掉的東西，不是要顯示的東西。
 * 把它們一起報出來的話，光交通服務水準就會多出十幾條改不動的紅字，
 * 而一支老是紅、又改不動的守門，下一個人會直接把它從 npm test 裡拿掉。
 *
 * 判斷「這個 / 是不是正規表示式的開頭」用的是標準啟發式：
 * 看它前一個非空白字元。運算式位置（( [ , = : ! & | ? { } ; 或行首、
 * 或 return／typeof 之類的關鍵字後面）才可能是正規表示式；
 * 否則那是除號或路徑。字元類別 [...] 裡的 / 不算結尾。
 */
function stripRegexLiterals(source) {
  let out = "";
  let i = 0;
  let prev = "";
  while (i < source.length) {
    const ch = source[i];
    /* 字串：原樣保留（畫面文字就住在這裡），但不要在裡面找正規表示式。 */
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") j += 2;
        else if (source[j] === quote) break;
        else j += 1;
      }
      out += source.slice(i, j + 1);
      prev = quote;
      i = j + 1;
      continue;
    }
    if (ch === "/" && /[([,=:!&|?{};+\-*%\n\r]|^$/.test(prev || "\n")) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < source.length) {
        const c = source[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === "\n") break;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
          closed = true;
          break;
        }
        j += 1;
      }
      if (closed) {
        /* 換成同樣長度的空白，行號才不會跑掉。 */
        out += " ".repeat(j - i + 1);
        i = j + 1;
        continue;
      }
    }
    out += ch;
    if (!/\s/.test(ch)) prev = ch;
    i += 1;
  }
  return out;
}

/*
 * ⚠️ 不要掃這些目錄。
 *
 *   vendor／dist／github-pages 是**別人寫的或建出來的**東西，不是我們的畫面文字；
 *   把它們掃進來會產生一堆改不動的紅字，而改不動的紅字很快就會被整支關掉。
 *   manuals／test-fixtures／examples 同理（手冊是 PDF 來源、測資是假資料）。
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "out",
  "dist",
  "vendor",
  "manuals",
  "manual-src",
  "test-fixtures",
  "examples",
  "github-pages",
  "github-pages-dist",
  "backup",
  "public",
  "assets",
  "db",
  "drizzle",
  "worker",
]);

/**
 * 把 `\uXXXX` 與 `\u{XXXXX}` 跳脫還原成真正的字元。
 *
 * ⚠️ 這一段是 2026-09-15 補的，因為守門被繞過了一次：
 *   路口轉向側欄的兩顆收合鈕寫的是 `"\u25b8"` 與 `"\u25be"`
 *  （▸／▾，兩個都不在 Big5），而它們**畫在畫面上**。
 *   守門掃的是原始碼裡的字元，看不到跳脫寫法，所以一路全綠——
 *   直到使用者自己在畫面上看到那顆空白的鈕。
 *
 * ⚠️ 還原之後**長度會變**，所以行號可能偏移。
 *   這裡只還原**同一行內**的跳脫（不跨行），並用同樣長度的空白補回去，
 *   讓行號與欄位仍然對得上——報錯時指到別的地方，看的人會以為守門在亂講。
 */
function expandEscapes(source) {
  return source.replace(
    /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g,
    (whole, braced, plain) => {
      const code = Number.parseInt(braced ?? plain, 16);
      if (!Number.isFinite(code)) return whole;
      let char;
      try {
        char = String.fromCodePoint(code);
      } catch {
        return whole;
      }
      /* 補空白讓總長度不變，行號與欄位才不會跑掉。 */
      return char + " ".repeat(Math.max(0, whole.length - char.length));
    },
  );
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css|js|html)$/.test(full)) out.push(full);
  }
  return out;
}

/*
 * ⚠️ 三支程式的檔案佈局不同，但這一支要**逐位元相同**（有測試在守）。
 *   ・Next.js 的兩支（全日交通量、路口轉向）程式碼在 app／lib
 *   ・交通服務水準是單檔式的，app.js／styles.css／index.html 就攤在根目錄
 *   所以找不到 app／lib 時就掃整個目錄，由 SKIP_DIRS 擋掉不該掃的地方。
 */
const roots = ["app", "lib", "components"].filter((d) => {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
});
if (!roots.length) roots.push(".");

const offences = [];
for (const file of roots.flatMap((d) => walk(d))) {
  const lines = expandEscapes(
    stripRegexLiterals(stripComments(readFileSync(file, "utf8"))),
  ).split("\n");
  lines.forEach((line, index) => {
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const code = line.codePointAt(i);
      if (!isSymbol(code)) continue;
      /* 變體選擇子跟著 emoji 走，跳過；emoji 本身也放行。 */
      if (code === 0xfe0f || code === 0xfe0e) continue;
      if (line[i + 1] === "️") continue;
      if (code >= 0x1f000) continue;
      if (SAFE.has(ch)) continue;
      offences.push(
        `${file}:${index + 1}  U+${code.toString(16).toUpperCase().padStart(4, "0")} 「${ch}」\n    ${line.trim().slice(0, 110)}`,
      );
    }
  });
}

if (offences.length) {
  console.error(
    "\n畫面上用到微軟正黑體不一定有的符號——實機會顯示成空白：\n",
  );
  for (const line of offences) console.error("  " + line + "\n");
  console.error(
    `共 ${offences.length} 處。請改用 scripts/glyph-guard.mjs 裡 SAFE 名單中的符號，` +
      "或改用文字／CSS transform（例如收合箭頭用 ▼ 轉 90 度）。\n",
  );
  process.exit(1);
}

console.log(`字形把關通過：畫面符號全部在 Big5 安全名單內。`);
