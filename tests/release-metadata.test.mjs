/*
 * 發布中繼資料的一致性檢查。
 *
 * 起因：外部檢查發現同一個發布包裡有三種版本號——package.json 寫 2.1.8、
 * package-lock.json 寫 2.0.1、程式畫面顯示 v2.1.18。版本號是判斷「使用者
 * 手上是哪一版」的唯一依據，不一致會讓回報的問題對不到程式碼。
 *
 * 這一支把三者釘在一起：只要有人改了其中一個而忘了另外兩個，測試就會失敗。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { VERSION, VERSION_HISTORY } from "../lib/traffic.ts";

const readJson = async (name) =>
  JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), "utf8"));

test("package.json 與 package-lock.json 的版本號和程式顯示的一致", async () => {
  const expected = VERSION.replace(/^v/, "");
  const pkg = await readJson("package.json");
  const lock = await readJson("package-lock.json");
  assert.equal(pkg.version, expected, "package.json 版本號和程式不一致");
  assert.equal(lock.version, expected, "package-lock.json 版本號和程式不一致");
  assert.equal(
    lock.packages?.[""]?.version,
    expected,
    "package-lock.json 的 packages[''] 版本號和程式不一致",
  );
});

test("版本號格式正確，且更新紀錄的第一筆就是目前版本", () => {
  assert.match(VERSION, /^v\d+\.\d+\.\d+$/, VERSION);
  assert.equal(
    VERSION_HISTORY[0].version,
    VERSION,
    "更新紀錄第一筆必須是目前版本，否則使用者看到的說明不是這一版的",
  );
});

test("更新紀錄沒有重複或倒序的版本號", () => {
  const seen = new Set();
  for (const entry of VERSION_HISTORY) {
    assert.ok(!seen.has(entry.version), `更新紀錄有重複的版本：${entry.version}`);
    seen.add(entry.version);
    assert.match(entry.version, /^v\d+\.\d+\.\d+$/, entry.version);
    /*
     * 欄位名一定要是 note。畫面上是用 item.note 渲染的，寫成 notes 的那一筆
     * （v1.7.2 原本就是）會整段空白顯示——使用者看到一個有版號、沒有內容的
     * 更新紀錄，卻不知道自己少看了什麼。
     */
    assert.ok(
      !("notes" in entry),
      `${entry.version} 用的是 notes 而不是 note，畫面上會是空白`,
    );
    assert.ok(entry.note && entry.note.length > 10, `${entry.version} 沒有說明`);
  }
});

test("畫面上的手冊連結檔名帶著目前版本", async () => {
  const source = await readFile(new URL("../app/traffic-app.tsx", import.meta.url), "utf8");
  assert.ok(
    source.includes(`路口轉向程式手冊_${VERSION}.pdf`),
    "手冊 PDF 連結沒有跟著版本更新",
  );
  /* 手冊自 v2.1.64 起只出 PDF，畫面上不可以再有 Word 連結。 */
  assert.doesNotMatch(source, /新手操作手冊\.docx/, "畫面上又出現 Word 手冊連結");
});

/*
 * 「部署完成後請確認」段落必須跟著版本走。
 *
 * 這一支是踩到坑才補的：那一段從 v2.1.30 起就沒再改過，之後每一次發布
 * 都照原樣交出去。照那份說明操作的人會拿**錯的版號**去確認部署有沒有
 * 成功——網址、手冊檔名、封面戳記三項全部對不上，而檢查清單自己不會說。
 */
test("更新說明的部署確認清單沒有殘留舊版號", async () => {
  const notes = await readFile(
    new URL("../【更新說明】請先讀我.txt", import.meta.url),
    "utf8",
  );
  const start = notes.indexOf("部署完成後請確認：");
  assert.notEqual(start, -1, "找不到「部署完成後請確認」段落");
  const section = notes.slice(start);
  const versions = [
    ...new Set([...section.matchAll(/v?(\d+\.\d+\.\d+)/g)].map((m) => "v" + m[1])),
  ];
  assert.deepEqual(
    versions.filter((v) => v !== VERSION),
    [],
    "部署確認清單殘留了舊版號",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  驗證報告寫的手冊頁數／字元數，在有 pdftotext 的環境裡當場重算
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 2026-09-25 第六輪新增（三支同一條）。姊妹系統交通服務水準的報告曾經寫過一個
 *   **用任何一種算法都重現不出來**的字數，而讀的人會拿它當
 *   「我手上這一本是不是你說的那一本」的依據。沒有人能重算的數字等於沒寫。
 *
 * ⚠️ 這一條**不可以在沒有 pdftotext 的環境裡變紅**：複查者的機器不一定有
 *   poppler-utils，而「在正確的包上變紅」比沒有守門更糟。
 *   缺工具時跳過並**印出為什麼跳過**——不是安靜過去。
 */
test("驗證報告寫的手冊頁數與字元數要與 PDF 相符（缺工具時跳過並說明）", async () => {
  const { execFileSync } = await import("node:child_process");
  const { readdirSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const report = await readFile(
    new URL("../VALIDATION_REPORT.md", import.meta.url),
    "utf8",
  );
  const claim = report.match(/\*\*(\d+) 頁 \/ ([\d,]+) 字元\*\*/);
  assert.ok(
    claim,
    "驗證報告裡找不到「**N 頁 / M 字元**」——寫法改了就要同步改這一支，" +
      "不可以讓它安靜地變成恆真",
  );
  const root = fileURLToPath(new URL("../", import.meta.url));
  const pdf = readdirSync(root).find(
    (name) => name.startsWith("路口轉向程式手冊") && name.endsWith(".pdf"),
  );
  assert.ok(pdf, "根目錄找不到手冊 PDF");
  const path = root + pdf;

  let pages = null;
  let chars = null;
  try {
    pages = Number(
      execFileSync("pdfinfo", [path], { encoding: "utf8" }).match(
        /^Pages:\s+(\d+)/m,
      )?.[1],
    );
    const text = execFileSync("pdftotext", ["-enc", "UTF-8", path, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    chars = [...text.normalize("NFKC")].length;
  } catch {
    console.log(
      "  ℹ️ 這台機器沒有 pdfinfo／pdftotext（poppler-utils），" +
        "跳過手冊頁數與字元數的重算比對——這不是失敗，是這個環境算不了。",
    );
    return;
  }
  assert.equal(pages, Number(claim[1]), `報告寫 ${claim[1]} 頁，實際 ${pages} 頁`);
  assert.equal(
    chars,
    Number(claim[2].replace(/,/g, "")),
    `報告寫 ${claim[2]} 字元，實際 ${chars}（NFKC 後、含空白，算法見報告裡的指令）`,
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  文件寫「某支測試 N 條／項」時，N 必須等於那支檔案裡 test() 的數量
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 2026-09-25 第六輪新增（三支同一條）。姊妹系統交通服務水準的兩份文件都寫
 *   「issue-ack-stability.test.mjs（8 條）」而實際 10 條；這一支自己也有好幾處。
 *   這種數字沒有人會回去數，但它是讀者判斷「守門夠不夠」的依據。
 *   既然數得出來，就不可以用手打。
 *
 * ⚠️ 兩種寫法都認：
 *   ・`xxx.test.mjs`（N 條）                → N 必須是**現在**的數量
 *   ・`xxx.test.mjs`（當時 N 條，現為 M 條） → **M** 必須是現在的數量
 *   第二種是刻意保留的：歷史段落寫的是「那一版新增時有幾條」，
 *   把它改成今天的數字等於**偽造當時的紀錄**。
 *   （第六輪的第一版只認第一種，於是我把兩處歷史數字改成了今天的值——
 *   那是竄改紀錄，已還原成第二種寫法。）
 */
test("文件寫的測試條數必須等於那支檔案裡 test() 的數量", async () => {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { readFile: rf } = await import("node:fs/promises");
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const CJK = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const bad = [];
  let seen = 0;
  for (const doc of ["README.md","VALIDATION_REPORT.md","PROJECT_HANDOFF.md","【更新說明】請先讀我.txt","CHANGELOG.md"]) {
    const path = join(ROOT, doc);
    if (!existsSync(path)) continue;
    const text = await rf(path, "utf8");
    for (const m of text.matchAll(
      /([A-Za-z0-9-]+\.test\.(?:mjs|ts))`?）?（(?:當時\s*[0-9一二三四五六七八九十]+\s*[條項支][，,]\s*現為\s*)?([0-9一二三四五六七八九十]+)\s*[條項支]/g,
    )) {
      const [, file, raw] = m;
      const full = join(ROOT, "tests", file);
      if (!existsSync(full)) continue; /* 檔案不在包裡由另一支守門管 */
      seen += 1;
      const body = (await rf(full, "utf8"))
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^[ \t]*\/\/[^\n]*$/gm, " ");
      const real = (body.match(/^\s*test\(/gm) || []).length;
      const claimed = CJK[raw] ?? Number(raw);
      if (claimed !== real)
        bad.push(`${doc}：${file} 寫 ${raw}，實際 ${real}`);
    }
  }
  /* 前置檢查：真的掃到句子，格式改掉之後不可以安靜地變成恆真。 */
  assert.ok(seen >= 3, `只抓到 ${seen} 句「某支 .test.* （N 條）」——寫法改了嗎？`);
  assert.deepEqual(
    bad,
    [],
    "這些數字與實際條數不符。若那是歷史紀錄，請寫成「（當時 N 條，現為 M 條）」" +
      "而不是改掉原本的數字：\n  " +
      bad.join("\n  "),
  );
});
