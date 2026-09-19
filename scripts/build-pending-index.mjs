/*
 * 待修正事項清單的「逐條走過清冊」產生器。
 *
 * 使用者 2026-09-11：
 *   「交通服務水準要修正的事項目前累積下來應該很多，
 *     有確實記錄到時才能全面都作修正而不遺漏嗎？還是大檢查到時會逐一確認？」
 *
 * 老實說：光靠「大檢查時逐條確認」這條規則**不夠**，那只是紀律。
 * 2026-09-11 當天我自己就犯過一次——那天新增的 8 條寫成 `### 一、…`，
 * 逐條走過時認的是 `## ☐`，那 8 條會被整批跳過，而且檔案看起來好好的。
 *
 * 所以把「有哪幾條」做成檔案開頭一份**自動產生的清冊**，
 * 再由 tests/pending-index.test.mjs 釘住「清冊與內文一致」。
 * 清冊過期 → 測試紅字 → 有人漏記或格式寫錯就會當場被發現。
 *
 * 用法：node scripts/build-pending-index.mjs        （改寫檔案）
 *      node scripts/build-pending-index.mjs --check （只檢查，不改；不一致時離開碼 1）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
export const LISTS = [
  "待修正事項_交通服務水準.md",
  "待修正事項_路口轉向.md",
  "待修正事項_全日交通量.md",
];

const BEGIN = "<!-- 逐條清冊：自動產生，請勿手改（node scripts/build-pending-index.mjs） -->";
const END = "<!-- 逐條清冊結束 -->";

/**
 * 掃出檔案裡所有待辦項目。
 *
 * ⚠️ 三種記號都要收，**包含 ✗（使用者決定不做）**。
 *   只收 ☐ 與 ☑ 的話，被否決的項目會整條從清冊消失——
 *   下次只走清冊的人會看到編號跳號（1、2、4…），
 *   以為有一條被弄丟了，然後花時間去找一個本來就不該做的東西。
 *   「決定不做」也是一個結論，要看得見。
 */
export function collectItems(text) {
  const items = [];
  text.split("\n").forEach((line, index) => {
    const m = line.match(/^## ([☐☑✗])\s*(.+?)\s*$/);
    if (m) items.push({ mark: m[1], title: m[2], line: index + 1 });
  });
  return items;
}

/** 產生清冊區塊的完整文字。`offset` 會加到每一條的行號上（見 applyIndex）。 */
export function renderIndex(items, offset = 0) {
  const open = items.filter((i) => i.mark === "☐").length;
  const done = items.filter((i) => i.mark === "☑").length;
  const dropped = items.filter((i) => i.mark === "✗").length;
  const lines = [
    BEGIN,
    "",
    `## 逐條清冊（未完成 ${open} 條／已完成 ${done} 條／決定不做 ${dropped} 條）`,
    "",
    "> 這一段是自動產生的。大檢查時**從這裡逐條走過**：",
    "> 每一條都要回答「這個功能現在是什麼狀態？我怎麼證明？」",
    ">",
    "> ✗ ＝ 使用者決定不做。它也列在這裡，這樣編號不會跳號，",
    "> 也不會有人以為某一條被弄丟了而去找一個本來就不該做的東西。",
    "",
    ...items.map(
      (item, index) =>
        `${index + 1}. ${item.mark} ${item.title}（第 ${item.line + offset} 行）`,
    ),
    "",
    END,
  ];
  return lines.join("\n");
}

/**
 * 把清冊寫回（或插入）檔案內容，回傳新的全文。
 *
 * ⚠️ 行號要「插入之後」的，不是「插入之前」的。
 *
 * 第一版就是在這裡寫錯：先在拿掉清冊的文字上數行號，再把清冊插進去——
 * 清冊本身佔掉十幾行，於是列出來的每一個行號都**固定短少一個清冊高度**
 * （實測三份分別差 51、40、56 行）。跳過去會落在完全不相干的段落，
 * 而清冊本身看起來好好的、測試也是綠的（因為產生與比對用的是同一套錯算法）。
 *
 * 所以這裡跑兩趟：先算出清冊佔幾行，再用那個位移重新產生一次。
 * 位移不會改變清冊的**行數**（只有數字的位數變），所以兩趟就夠。
 */
export function applyIndex(text) {
  /* 清冊本身不可以被算成項目，所以先把舊的整塊拿掉再掃。 */
  const stripped = stripIndex(text);
  const items = collectItems(stripped);
  const lines = stripped.split("\n");
  /*
   * 插在第一個 `## ` 之前。檔案開頭通常有標題與前言，
   * 清冊放在那之後、第一條項目之前，打開檔案第一眼就看得到。
   */
  const at = lines.findIndex((line) => line.startsWith("## "));
  if (at < 0) {
    /* 沒有任何 `## ` 標題時清冊擺最後，項目行號不受影響。 */
    return `${stripped.replace(/\s*$/, "")}\n\n${renderIndex(items)}\n`;
  }
  /* 清冊佔掉的行數 ＝ 區塊本身的行數 ＋ 它後面那一行空行。 */
  const offset = renderIndex(items).split("\n").length + 1;
  const block = renderIndex(items, offset);
  return [...lines.slice(0, at), block, "", ...lines.slice(at)].join("\n");
}

/** 拿掉既有的清冊區塊。 */
export function stripIndex(text) {
  const start = text.indexOf(BEGIN);
  if (start < 0) return text;
  const end = text.indexOf(END, start);
  if (end < 0) return text;
  return (
    text.slice(0, start).replace(/\n*$/, "\n\n") +
    text.slice(end + END.length).replace(/^\n+/, "")
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");
  let stale = 0;
  for (const name of LISTS) {
    const path = join(ROOT, name);
    if (!existsSync(path)) {
      console.log(`（找不到 ${name}，略過）`);
      continue;
    }
    const before = readFileSync(path, "utf8");
    const after = applyIndex(before);
    const items = collectItems(stripIndex(before));
    const open = items.filter((i) => i.mark === "☐").length;
    if (before === after) {
      console.log(`✅ ${name}：清冊是最新的（未完成 ${open} 條／共 ${items.length} 條）`);
      continue;
    }
    stale += 1;
    if (checkOnly) {
      console.error(`❌ ${name}：清冊與內文不一致，請執行 node scripts/build-pending-index.mjs`);
      continue;
    }
    writeFileSync(path, after);
    console.log(`✏️  ${name}：清冊已更新（未完成 ${open} 條／共 ${items.length} 條）`);
  }
  if (checkOnly && stale) process.exit(1);
}
