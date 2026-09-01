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
  for (const ext of ["pdf", "docx"])
    assert.ok(
      source.includes(`Turning-Traffic-${VERSION}-新手操作手冊.${ext}`),
      `手冊 ${ext} 連結沒有跟著版本更新`,
    );
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
