/*
 * 備份必須收齊使用者自己設定的每一樣東西，而且**依計畫分開收**。
 *
 * 起因是姊妹專案（全日交通量、交通服務水準）踩到的坑：結論草稿的條件範本
 * 存在本機，但匯出的備份沒有收，換一台電腦匯入之後範本一個都不剩，
 * 而畫面只會說匯入成功。功能測試完全驗不出這種事——匯出成功、匯入成功、
 * 每一支測試都是綠的，少收一樣東西不會讓任何斷言失敗。
 *
 * 本程式後來又發現第二層：範本雖然有收，但**沒有依計畫分開**，
 * 所有計畫共用同一份清單（v2.1.24 修正）。這一支同時把兩件事釘住。
 *
 * 作法是「清單比對」：把屬於使用者設定的鍵列出來，逐一確認
 * 存檔、備份匯出、還原三個地方都有它。日後新增設定卻忘了收進備份，
 * 這裡就會失敗。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../app/traffic-app.tsx", import.meta.url),
  "utf8",
);

/**
 * 使用者會自己調整、換電腦時應該一起帶走的東西。
 * 純衍生資料（可由 records 重算的）不列在這裡。
 */
const MUST_TRAVEL = [
  "projects",
  "records",
  "nameMap",
  "pceByProject",
  "catalogByProject",
  "mappingsByProject",
  "formatMemories",
  "vehicleSchemes",
  "reportTemplatesByProject",
  "conclusionTemplatesByProject",
  "recordRevisions",
];

/** 每一項都必須是「每個計畫各自一份」，不可以是全機共用的一份。 */
const MUST_BE_PER_PROJECT = [
  "pceByProject",
  "catalogByProject",
  "mappingsByProject",
  "reportTemplatesByProject",
  "conclusionTemplatesByProject",
];

function block(startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `traffic-app.tsx 裡找不到 ${label} 的起點`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label} 之後找不到 ${endMarker}`);
  return source.slice(start, end);
}

test("存進瀏覽器的內容收齊了使用者的設定", () => {
  const saved = block(
    'kind: "TURNING_TRAFFIC_STATE"',
    "localStorage.setItem",
    "存檔內容",
  );
  for (const key of MUST_TRAVEL)
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(saved),
      `存檔沒有收 ${key}——重新整理之後這一項會消失`,
    );
});

test("備份檔收齊了使用者的設定", () => {
  const backup = block(
    'kind: "TURNING_TRAFFIC_BACKUP"',
    "backupFileTag",
    "備份內容",
  );
  for (const key of MUST_TRAVEL)
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(backup),
      `備份沒有收 ${key}——換一台電腦還原之後這一項會消失`,
    );
});

test("每一項依計畫的設定，備份時都要用 pick() 篩出該計畫那一份", () => {
  /*
   * 單一計畫備份時，pick() 負責只帶走那個計畫的設定。
   * 少包一層 pick()，把 A 計畫的備份帶到 B 電腦就會連別的委託案的
   * 當量矩陣與範本一起搬過去。
   */
  const backup = block(
    'kind: "TURNING_TRAFFIC_BACKUP"',
    "backupFileTag",
    "備份內容",
  );
  for (const key of MUST_BE_PER_PROJECT)
    assert.match(
      backup,
      new RegExp(`${key}:\\s*pick\\(`),
      `備份裡的 ${key} 沒有經過 pick()`,
    );
});

test("兩種範本都是依計畫分開存，不是全機共用一份", () => {
  /*
   * v2.1.24 之前兩者都是扁平陣列：在甲計畫存的範本，切到乙計畫照樣列出來。
   * 結論條件裡存著 intersectionKeys 與 branchNames，那是該計畫專屬的識別字，
   * 套到別的計畫會篩出 0 筆而找不出原因。
   */
  for (const key of ["reportTemplates", "conclusionTemplates"]) {
    assert.match(
      source,
      new RegExp(
        `const \\[${key}ByProject, set${key[0].toUpperCase()}${key.slice(1)}ByProject\\] =?\\s*\\n?\\s*useState`,
      ),
      `${key} 沒有改成依計畫分開的 ${key}ByProject`,
    );
    assert.match(
      source,
      new RegExp(`const ${key} =\\s*\\n?\\s*${key}ByProject\\[activeProjectId\\]`),
      `${key} 沒有從目前計畫取值`,
    );
  }
});

test("舊版備份的扁平範本清單，還原時每個計畫各給一份", () => {
  /*
   * 這是使用者選定的遷移方式：什麼都不會不見。全部歸給某一個計畫的話，
   * 其他計畫就再也找不到過去存的範本了。
   */
  for (const key of ["reportTemplates", "conclusionTemplates"]) {
    assert.match(
      source,
      new RegExp(`${key}ByProject[\\s\\S]{0,200}?spread\\(`),
      `載入時沒有把舊版的 ${key} 分給每個計畫`,
    );
    assert.match(
      source,
      new RegExp(`${key}ByProject[\\s\\S]{0,200}?spreadToAll\\(`),
      `還原備份時沒有把舊版的 ${key} 分給每個計畫`,
    );
  }
});

test("存檔仍然寫出舊欄位，讓退版之後還讀得到東西", () => {
  const saved = block(
    'kind: "TURNING_TRAFFIC_STATE"',
    "localStorage.setItem",
    "存檔內容",
  );
  for (const key of ["reportTemplates", "conclusionTemplates"])
    assert.match(
      saved,
      new RegExp(`\\n\\s*${key}: ${key},`),
      `存檔沒有保留舊欄位 ${key}`,
    );
});
