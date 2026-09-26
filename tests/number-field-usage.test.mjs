/*
 * ══════════════════════════════════════════════════════════════════════
 *  受控數字輸入框的守門（A12）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-21 回報：「就集體無法輸入除了 0 以外的數字了」。
 * 成因是 React 受控數字框的經典陷阱：
 *
 *     value={數字}  ＋  onChange={(e) => set(Number(e.target.value))}
 *
 * 欄位被按到空的那一刻 Number("") 是 0，0 被寫回欄位、游標推到第 0 位，
 * 之後打的字全部接在 0 後面。詳見 lib/number-field.tsx。
 *
 * ⚠️ 這支測試擋的是**整個類別**，不是使用者踩到的那一個欄位。
 *   當初 A12 只寫了「角度欄位」，實際盤下去才發現同一個檔案裡
 *   每一個受控數字框都是同一種寫法——這正是這個專案反覆犯的那個毛病：
 *   「該列 N 樣的清單裡只放了 1 樣」。所以這裡用掃描，不用逐一列舉。
 *
 * ⚠️ 判定的關鍵是 **onChange 裡有沒有把輸入丟進 Number()／parseFloat()**，
 *   不是「有沒有 type="number"」。存字串的欄位（例如調查年度用
 *   `e.target.value.replace(/\D/g, "")`）沒有這個問題，不該被誤報。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const raw = await readFile(
  new URL("../app/traffic-app.tsx", import.meta.url),
  "utf8",
);

/*
 * 先把註解拿掉。不拿掉的話，這個檔案自己為了解釋 bug 而寫的那一行示範碼
 * 會被自己抓出來當違規——守門測試誤報比漏報更容易被人「順手」關掉。
 */
function stripComments(text) {
  /*
   * ⚠️ 只拿掉 /* … *\/ 這一種。**不要**另外寫一條「{ … }」的 JSX 註解規則：
   *   `\{\s*\/\*[\s\S]*?\*\/\s*\}` 的非貪婪比對會一路找到**下一個**
   *   「*\/ 後面剛好接 }」的位置，中間整段真正的程式碼被一起吃掉——
   *   實測在這個檔案上吃掉了 60%（956KB → 353KB），連帶讓上面的掃描
   *   看不到違規而變綠。JSX 註解 `{/* … *\/}` 的內層本來就是 /* … *\/，
   *   拿掉之後剩下一對空的大括號，對掃描無害。
   */
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * 抓出每一個 `<input … />` 的完整標籤。
 *
 * ⚠️ 不可以用 `/<input[^>]*>/`：箭頭函式的 `=>` 裡就有一個 `>`，
 *   標籤會在 onChange 中間被切斷，後面的 Number() 就看不到了。
 * ⚠️ 也不要自己數大括號：字串與樣板字面值裡的括號會讓深度算錯，
 *   一旦算錯，掃描會整段跳過而且**安靜地變綠**——第一版就是這樣
 *   在未修正的舊碼上通過的（只找到 5 個標籤，實際上有二十幾個）。
 *   這個專案的守門一律要能在舊碼上變紅，做不到就是假的綠。
 *
 * 本檔的 `<input>` 全部是自閉合的，所以從 `<input` 掃到第一個 `/>` 即可。
 * 下面另有一支測試比對「掃到的數量」與「純字串計數」，掃描壞掉時會變紅。
 */
function inputTags(text) {
  const tags = [];
  let index = text.indexOf("<input");
  while (index !== -1) {
    const end = text.indexOf("/>", index);
    if (end === -1) break;
    tags.push(text.slice(index, end + 2));
    index = text.indexOf("<input", end);
  }
  return tags;
}

const source = stripComments(raw);

test("畫面上沒有任何『受控數字框 ＋ Number(e.target.value)』的寫法", () => {
  const offenders = inputTags(source).filter((tag) => {
    if (!/type="number"/.test(tag)) return false;
    /* 唯讀／鎖住的欄位打不進字，不受這個 bug 影響。 */
    if (/\bdisabled\b/.test(tag)) return false;
    if (!/onChange/.test(tag)) return false;
    const handler = tag.slice(tag.indexOf("onChange"));
    return /\b(?:Number|parseFloat|parseInt)\s*\(/.test(handler);
  });
  assert.deepEqual(
    offenders.map((tag) => tag.split("\n").slice(0, 3).join(" ").trim()),
    [],
    "還有受控數字輸入框沒有改用 <NumberField />",
  );
});

test("掃描器本身沒有壞掉（掃到的數字欄位數＝純字串計數）", () => {
  /*
   * ⚠️ 這一支存在的唯一理由：上面那支是「找不到違規就綠」。
   *   掃描器一旦解析壞掉、只掃到一小段，它會在幾乎什麼都沒檢查的情況下變綠。
   *   實際發生過：第一版用數大括號的寫法，在**未修正的舊碼**上照樣全綠。
   */
  const scanned = inputTags(source).filter((tag) =>
    /type="number"/.test(tag),
  ).length;
  const counted = (source.match(/type="number"/g) || []).length;
  assert.equal(
    scanned,
    counted,
    "掃描器漏掉了數字欄位——上面那支測試的綠是假的",
  );
  assert.ok(counted >= 2, "連 type=\"number\" 都找不到，來源檔可能搬走了");
});

test("三個會被改壞的欄位確實已經改用 NumberField", () => {
  /*
   * 反面守門：上面那一支是「找不到違規就綠」，萬一哪天整段 JSX 被搬走，
   * 它會在什麼都沒檢查的情況下變綠。這一支釘住「該有的東西還在」。
   */
  assert.equal(
    (source.match(/<NumberField\b/g) || []).length,
    3,
    "受控數字欄位的數量變了——新增欄位時請一併確認是不是走 NumberField",
  );
  assert.match(source, /testId=\{`arm-angle-\$\{index\}`\}/, "支線角度欄位不見了");
});

test('NumberField 本身不可以把空字串送出去（那就等於 Number("") === 0）', async () => {
  const field = await readFile(
    new URL("../lib/number-field.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    field,
    /if \(text\.trim\(\) === ""\) return;/,
    "空字串的短路被拿掉了——欄位一按空就會黏 0",
  );
  assert.doesNotMatch(
    field,
    /value=\{props\.value\}/,
    "value 直接綁回數字，等於把 bug 改回去",
  );
});

test("NumberField 離開欄位時不可以把值改成 0", async () => {
  const field = await readFile(
    new URL("../lib/number-field.tsx", import.meta.url),
    "utf8",
  );
  const blur = field.slice(field.indexOf("onBlur="));
  assert.doesNotMatch(
    blur,
    /onCommit\(0\)/,
    "onBlur 把看不懂的輸入當成 0 送出去——0 是會被寫進檔案、被抄進報告的真實數值",
  );
});

test("⚠️ 外面把值換掉時，正在編輯的字串要丟掉", async () => {
  /*
   * 2026-09-23 由 `scripts/e2e-factor-scope.mjs` 抓到的真實情境：
   *
   *   使用者在當量表格上打了 9，**沒有點別的地方**就去換「係數套用範圍」
   *   的下拉。表格換成了新範圍的值，但他碰過的那一格仍然顯示 9——
   *   看起來就像新範圍的係數是 9，而他會照著它做決定。
   *
   * ⚠️ 判斷「這次更新是不是我自己造成的」要靠 setSynced(next)：
   *   少了它，使用者每打一個字都會被自己清掉草稿（打不了字）；
   *   少了比對，外面換值時草稿會一直黏著。兩邊都要在。
   */
  const field = await readFile(
    new URL("../lib/number-field.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    field,
    /if \(props\.value !== synced\) \{[\s\S]*?setSynced\(props\.value\);[\s\S]*?setDraft\(null\);/,
    "外面換值時沒有把草稿丟掉——使用者會看到上一個範圍的數字",
  );
  assert.match(
    field,
    /setSynced\(next\);\s*\n\s*props\.onCommit\(next\);/,
    "送出前沒有記下自己送的值——使用者打字時會被自己清掉草稿",
  );
});
