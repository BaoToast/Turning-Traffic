# Turning Traffic v2.1.80 驗證報告

## GPT 風險導向獨立複查（2026-09-20，Asia/Taipei）

### 風險與輸入身分

- 完整專案 ZIP SHA-256：`36446FFBDE4DAEAE3A7C3F76E0B3F5337DE5F0F64F5253D75221CA2D3DB1F467`，與 Claude 說明相符。
- 因修改涵蓋 parser 日期候選、IndexedDB／跨電腦備份、UI、圖說、轉向圖版面與匯出資料流，GPT 將 Claude 所稱「中風險」上調為**高風險**，依全專案範圍複查。
- `LAST_CALC_CHANGE_VERSION` 維持 v2.1.64；本版沒有改動交通量、PCU、尖峰挑選或流向判定。

### GPT 額外找到並修正

1. **指定調查日期與日期欄顯示開關沒有進入跨電腦備份。** Claude 已把 `surveyDateOverrides`／`showSurveyDate` 存入 IndexedDB，但 JSON／ZIP 備份 payload 與兩條還原路徑漏掉。現已補入單一計畫 pick、全部計畫、併入及完整取代還原，並以 `backup-completeness.test.mjs` 與 `e2e-backup.mjs` 同時守門。
2. **八叉 E2E 在乾淨 Windows 字型環境會誤報。** 卡片標題依設計位於卡片矩形上方；舊測試用「文字矩形是否完全落在卡片矩形內」判定擁有者，會把自己的標題誤認成別張卡。現改用 DOM `data-card-id`／`data-card-section` 判斷文字所屬。這是測試缺陷，不是正式 UI 缺陷。
3. **多日期資料流缺少瀏覽器端到端證據。** 擴充 `e2e-period-date.mjs`，確認匯入、異常檢查、使用者指定、尖峰彙總、重新整理持久化、轉向圖與下載 SVG 全部使用同一有效日期。測試尊重既有「同幾何路口合併」規則，不再錯誤要求下拉顯示原始檔站名。
4. **全新工作區無法建立單檔試用版。** `scripts/build-tryout.mjs` 直接寫入上層 `out/`，卻沒有建立資料夾；Claude 的暫存環境因 `out/` 已存在而未暴露。現已在輸出前遞迴建立資料夾，並新增發布結構守門；正式 Repository 刪除既有 `out/` 的前提下重跑 `build:tryout` 與 `e2e-tryout-smoke.mjs` 全綠。

### 最終驗證結果

| 項目 | 結果 |
| --- | --- |
| 乾淨安裝 | `npm ci` 成功；509 packages added、510 audited |
| 一般驗證 | lint、glyph guard、TypeScript、vinext production build 全部通過 |
| `.mjs` tests | 200 項：199 通過、1 條件式略過、0 失敗 |
| TypeScript tests | 295 項：292 通過、3 條件式略過、0 失敗 |
| 完整 E2E | 82 支瀏覽器測試＋2 支種子資料產生器，共 84 個執行步驟，全數成功 |
| 變更後目標重跑 | `e2e-backup.mjs`、`e2e-period-date.mjs` 均全數成功 |
| 版面 | sticky 1120–1600px／1420–1421 邊界 131 點通過；八叉 16 卡、文字、裁切、碰撞與 20° 壓力案例通過 |
| 手冊 | v2.1.80 PDF 19 頁完整點陣化檢視，未見截字、重疊、黑塊或表格溢出 |
| 依賴警示 | 完整 audit 10 項（4 moderate、6 high），均在開發／建置工具鏈；未執行破壞性的 `audit fix --force` |

精確計數：Repository 共有 83 支 `e2e-*.mjs`，`npm run e2e` 內有 82 支瀏覽器測試；另有 2 支種子資料產生器。不得把 84 個執行步驟稱為「84 支瀏覽器 E2E」。

### 證據界線

- 3 個需要特定真實附件的自動測試依既定條件略過，未描述為通過。
- 本輪新增的是合成多日期活頁簿的完整資料流驗證；不是三個特定真實附件的替代品。
- v2.1.80 手冊 PDF 已完成點陣化目視檢查；本輪未另以 Microsoft Excel／桌面 PDF 閱讀器重做 Excel／匯出 PDF 的人工開啟。v2.1.79 的 Microsoft Excel／Foxit 結果只保留為歷史證據，不描述成這次重新驗證。
- 功能／發布 commit：`937c306baa572ced640d6885ae553ed5a5ab86c9`。GitHub「建置與測試」run `35516856347` 與 `pages build and deployment` run `35516855416` 均成功。
- 帶版號首頁回應 HTTP 200；線上主 JS `assets/index-Dimc0N1p.js` 與本機 SHA-256 均為 `1BD37BED7B3E4A8A46F8FDFD2F43E4FE599ED61849E7207FE8CF567FD2A04D24`；線上／本機 v2.1.80 手冊均為 `AAB15A9AD22114F104A29347088C33BE2B866E824015EE0C6C120BAA888B6E44`。舊 v2.1.79 主資產 `assets/index-D2lY7Qv1.js` 與 `路口轉向程式手冊_v2.1.79.pdf` 均為 HTTP 404。

## v2.1.80（2026-09-20）Claude 二次複查 ＋ 大檢查

### 一、對 GPT 交回的 v2.1.79 的核對（全部實跑，不是讀報告）

- **身分**：7 個上傳檔 ＋ 驗證證據 xlsx 的 SHA-256 與 `SHA256SUMS.txt` **逐項相符**。
- **逐檔 diff（我的 v2.1.79 ↔ GPT 交回的 v2.1.79）**：
  `app/`、`lib/` **一行都沒動**。實際差異只有 16 支 e2e 腳本 ＋ 1 支單元測試的
  Windows 路徑可攜性（`pathToFileURL`／`fileURLToPath`／共用 `chrome-path.mjs`），
  與 GPT 的說明相符。CHANGELOG／VALIDATION／新增 PROJECT_HANDOFF 為文件變更。
- **GPT 未申報的兩項異動**（我另外查出來的，兩件都合理但報告沒寫）：
  - 刪除 `scripts/_m.mjs`（我留下的臨時探針，無人引用，而且寫死 Linux Chromium 路徑）
  - 新增 `examples/import-sample.csv`（`examples/README.md` 本來就提到它、但檔案不存在）
- **試用版**：GPT 交回的試用版 HTML 與我交付的那一份**逐位元相同**（`cmp` 通過）。
- **`npm ci`**：成功（added 516 packages）。GPT 報 509，差異來自 npm 版本與平台
  optional dependency，不是缺陷。

### 二、本次找到並修正的兩項缺陷

#### (1) 路口幾何示意圖被「用顏色檢視轉向」整片蓋住

使用者 2026-09-20 回報：「路口幾何示意圖我看不到，似乎和顏色檢視轉向重疊」。

`app/globals.css` 兩個斷點各寫各的：

| 規則 | 生效條件 |
| --- | --- |
| `.geometry-layout` 收成單欄 | `@media (max-width: 1420px)` |
| `.geometry-turn-preview` 取消 `position: sticky` | `@media (max-width: 1100px)` ← 錯 |

於是 **1101～1420px** 這一段「已經是單欄、卻還釘著」。單欄時它的正下方就是
「路口幾何示意圖」，往下捲它釘在畫面上緣不動；sticky 是定位元素、下面那塊是
一般元素，依 CSS 繪製順序定位元素在上，整塊幾何示意圖被不透明的面板底色
**整片蓋掉**——不是沒畫出來，是被蓋住。側欄跳轉與 `.is-focused` 外框都正常，
所以看起來像「圖沒畫出來」。

**改法不是把 1100 改成 1420**：那等於把正確性押在兩個數字永遠手動同步上，
而這次就是這樣壞的。改成**預設不釘、只有兩欄版面（`min-width: 1421px`）才釘**，
漏掉的那一邊是安全的那一邊。

守門 `scripts/e2e-sticky-cover.mjs`：掃寬度 1120～1600（每 60px，外加斷點兩側
1420／1421），逐一點側欄項目、等它捲到定位後，對被點名那一塊的
12%／35%／60%／85% 高度做 `document.elementFromPoint`，看到的必須就是那一塊。

刻意迴避的三種假通過：**只測 1366／1536 不算數**（這個坑就是兩個 media query
中間的空窗）、**停在頁首截圖不算數**（sticky 要捲過它上緣才會釘起來）、
**用矩形相交判斷不算數**（兩欄版面裡同列相鄰的兩塊本來就重疊，而且相交不等於
被蓋住，要看的是誰畫在上面）。`position: fixed` 的浮動層另外計數略過。

**反證（實跑）**：改回無條件 sticky →

```
❌ 1120px ❌ 1180px ❌ 1240px ❌ 1300px ❌ 1360px ❌ 1420px（共 7 項紅）
   被 #geometry-turn-preview（position:sticky）蓋住
✅ 1421 / 1480 / 1540 / 1600 維持綠；取樣點數維持 131 點
```

⚠️ **GPT 本輪「1536×864、1366×768 各 18 頁逐頁檢查未見重疊」這句不成立。**
1366 就在出事區間內；漏掉的原因是只在捲到頁首時截圖。

#### (2) 交付包「更新說明」寫了一個不存在的資產檔名

v2.1.79 交付包的 `【更新說明】請先讀我.txt` 寫著
`assets/index-C0pvj8lC.js`（SHA-256 `3478…`），但那一包的 `assets/` 裡**沒有
這個檔案**，實際是 `index-D2lY7Qv1.js`（SHA-256 `6084…`）。
升版重建之後忘了回頭改，而且**沒有任何檢查在看它**。

這一段不是裝飾：GPT 與使用者就是照它去核對「線上那一份是不是這一包」。

守門加進 `tests/release-structure.test.mjs`：照檔名**真的算一次 SHA-256** 再比。

**反證（實跑，三個都紅）**：檔名寫錯 → 紅並列出實際有哪些檔案；
雜湊只錯一個字元 → 紅；整段被改寫掉 → 紅（不可以安靜變成恆真）。

### 二-b、使用者 2026-09-20 授權的四件事（本支承接的部分）

#### 1. 手動新增支線上限 7 → 8：抓到兩個真缺陷

常數改一行之後寫了 `scripts/e2e-eight-arm.mjs` 實測（**不是讀程式碼推論**）：

| 缺陷 | 實測證據 |
|---|---|
| 外圍格位不夠時補出來的位置會疊在既有格位上 | 兩張卡實測座標 (16,254–232,370) 與 (10,282–226,398) |
| 卡片上方那一行標題畫在矩形外面，分離時漏算 | 「來源 C · 示範東路三段」等 3 處壓到隔壁卡 |

- 外圍原本 14 個格位（上 4＋右 3＋下 4＋左 3），八叉在「駛入＋駛出並列」時是
  **16 張卡**，多出來的兩張走舊的「往下再長一圈」規則就會撞上左側那一排。
- 修法：**只在格位真的不夠時**加寬成 5＋4＋5＋4；四叉～七叉一個像素都不動
  （`e2e-diagram`／`e2e-diagram-scale`／`e2e-diagram-bounds`／`e2e-diagram-detach`／
  `e2e-chart-layout`／`e2e-three-arm` 六支重跑全綠，證明沒有動到既有版面）。
- ⚠️ **中途走過一條錯路**：試過用 `textLength` 把標題壓進卡寬，結果更糟——
  它會把**短標題也撐成滿寬**，重疊從 2 處變成 3 處。已還原。這一條記在這裡，
  是因為它是個反直覺的坑。
- ⚠️ **這一支測試第一版是假的綠**：一條支線畫兩張卡，四叉剛好也是 8 張卡，
  用「圖卡數＝8」認八叉會驗到四叉而全綠。改成用路口名稱認，
  並另外把「圖卡數＝支線數×2」釘住。

#### 2. 調查日期

- 候選一律**全表掃描**，只看交通量工作表；系統**實際採用**的那一個仍以標題區優先
  （`findSurveyDate(scopedDateCells) || findSurveyDate(cells)` 那一行**沒有動**）。
- 候選清單的**第一個一定是系統實際採用的那一個**——直接用 `findAllSurveyDates`
  的順序會出問題（那是對全表排的，實際採用的是標題區優先挑出來的）。
- 異常檢查新增「調查日期不只一個」，那一列多一顆「指定調查日期」下拉。
- ⚠️ 訊息裡**不可以**寫「目前採用的是 X」：這一支的確認指紋是 `[id, message]`，
  使用者一指定 X 就變了，他剛按下去的確認會當場失效。會變的字全部留在畫面層。
- ⚠️ 轉向圖上那一行「調查日期 …」也換成使用者指定的那一個——
  不換的話畫面寫他指定的日期、**匯出的圖卻寫系統判讀的那一個**。

#### 3. 圖說第 3、4 級

`lib/chart-levels.ts` 與全日交通量 `app/chart-levels.ts` **逐位元相同**
（SHA-256 `0f9a62f5…`，由 `tests/chart-levels.test.ts` 釘住）；
契約 `tests/chart-levels-contract.mjs` 三支逐位元相同（30 列案例）。

#### 4. 「已人工確認」不再只進不出

`pruneOrphanAcks()`：只在按下「執行資料異常檢查」之後清，只清孤兒，
白名單用 `currentIssues`（這一次檢查真的跑出來的全部項目）而**不是畫面上篩過的那一份**——
用篩過的會把「只是被篩掉」的確認當成孤兒清掉。

#### 本次新增守門與反證（全部實跑）

| 守門 | 反證方式 | 結果 |
|---|---|---|
| `tests/survey-date-pick.test.mjs`（15 項） | 候選只掃標題區 | 14 pass / 1 fail |
| 同上 | message 寫「目前採用的是 X」 | 14 pass / 1 fail |
| 同上 | 覆寫不檢查是否在候選內 | 14 pass / 1 fail |
| 同上 | 圖上不換日期 | 14 pass / 1 fail |
| 同上 | 存檔不收覆寫 | 14 pass / 1 fail |
| `tests/orphan-ack-prune.test.mjs`（5 項） | — | 釘住「只清孤兒、沒有孤兒不寫存檔」 |
| `tests/chart-levels.test.ts`（2 項） | — | 契約 30 列全過 ＋ SHA-256 釘住共用模組 |
| `scripts/e2e-eight-arm.mjs`（14 項） | 上限改回 7／拿掉加寬規則 | 轉紅 |
| `scripts/e2e-chart-layout.mjs` 末段 | — | 量實際座標：第 3 級在、不是空話、沒撐出框、圖仍然 sticky |

還原之後全部回到全綠。

### 三、本版測試結果

- `npm test`：`.mjs` **173 pass／0 fail／1 skip**；`.ts` **290 pass／0 fail／3 skip**
  （新增 1 支守門）。lint、glyph guard、TypeScript、production build 全過。
- `npm run e2e`：**83 個流程步驟全綠**（新增 `e2e-sticky-cover.mjs`）。
  ⚠️ 第一次跑到第 40 支左右掛掉（`e2e-factor-scope` 點擊逾時）——查證是**環境問題**：
  這個容器只有 2 顆 CPU，當時同時在跑另外兩支程式的 Chromium 測試，
  違反「`npm run e2e` 不可以並行」。單獨重跑才是上面這個結果，
  第一次那個紅字**不採計、也不隱瞞**。
- 手冊 PDF 已重新產生（v2.1.80 ｜ 2026-09-20），根目錄資產已重新建置並同步。

### 四、三支聯合驗算（本支相關部分）

- **跨系統總車輛數**：五份真實路口檔餵給本支與全日交通量，兩支各自獨立的 parser
  得到 **19,428／16,553／13,488／15,801／18,038**，完全相同，
  且與 2026-09-18 那一輪記錄的數字一模一樣。
- **調查日期**：兩支對五份檔都讀到 2026-05-04（平日），來源都是表頭
  「日期：115年05月04日(平日)」。
- **共用檔逐位元相同**：`vendor/xlsx-0.20.3.tgz`（`8dc73fc3…`，與規則檔記錄一致）、
  `tests/period-input-contract.mjs`、`lib/period-date.ts`（與全日交通量的
  `app/period-date.ts` 同為 `572d663a…`）。

### 五、證據界線（沒驗到的要講）

- 這個容器連不到 `baotoast.github.io`，**無法逐位元比對線上原始檔**；
  線上狀態只能引用 GPT 的報告與使用者的畫面截圖（截圖顯示 v2.1.79 正式版）。
- 沒有 Microsoft Excel／Foxit，**無法複驗** GPT 的「10 張工作表由真 Excel 開啟」
  與「5 頁匯出 PDF ＋ 19 頁手冊逐頁檢視」。這兩項只能採信其報告。
- 3 條需要特定真實附件的自動測試仍為條件式略過。

---

# Turning Traffic v2.1.79 風險導向複查報告

驗證日期：2026-09-20（Asia/Taipei）

輸入：Claude 提供的 `路口轉向_完整專案_v2.1.79.zip`、`路口轉向_試用版_v2.1.79.html`、`路口轉向程式手冊_v2.1.79.pdf` 與「給 GPT 的說明」。所有輸入檔均先依交付 `SHA256SUMS.txt` 核對成功。

## 風險判定與複查範圍

本版從正式 v2.1.63 跨越多輪 Claude／使用者試用修正，涉及 parser 重複資料阻擋、尖峰判定說明、主工具列與多頁篩選、跨頁報表、IndexedDB、Excel/PDF 匯出、手冊與發布結構，依固定規則判定為高風險，採全專案與完整資料流複查。

Claude 說明所稱 v2.1.78 → v2.1.79 沒有新增計算變更是正確的；但正式 Repository 是由 v2.1.63 升級，因此整體差異包含 v2.1.64 的「全調查時段尖峰不再要求 24 小時」計算口徑變更。`LAST_CALC_CHANGE_VERSION` 正確維持 v2.1.64，不能把整段正式升級誤述為完全沒有計算變更。

## GPT 獨立修正

正式應用程式的計算與 UI 程式碼沒有因複查而另行改寫。GPT 修正的是 Windows 上會讓測試／E2E 無法正確啟動的 17 支測試腳本：

- 動態載入本機 `.mjs` 時改用 `pathToFileURL(...).href`，避免 Windows 磁碟機代號被當成不支援的 ESM URL scheme。
- `tests/wording.test.mjs` 以真實檔案路徑排除 `lib/traffic.ts` 的歷史版本敘述，避免反斜線路徑造成誤判。
- `scripts/e2e-text-wrap.mjs` 改用共用 `chrome-path.mjs` 探測瀏覽器，不再寫死 Linux Chromium 路徑。

上述修正只改善測試可攜性，不變更正式頁面、parser、計算、儲存或匯出結果。

## 自動化驗證

| 項目 | 結果 |
|---|---|
| 乾淨安裝 | `npm ci` 成功；509 packages added、510 audited |
| ESLint | 0 errors、0 warnings |
| 字形守門 | 通過 |
| TypeScript | `tsc --noEmit` 通過 |
| Production build | 通過 |
| `.mjs` tests | 172 通過、0 失敗、1 條件式略過 |
| TypeScript tests | 290 通過、0 失敗、3 條件式略過 |
| GitHub Pages build | 通過；根目錄發布資產已由新建置同步 |
| E2E | 82 個流程步驟全部成功：80 支瀏覽器測試＋2 支種子資料產生器 |
| 單檔試用版 smoke | `file://` 開啟並通過；與 Claude 試用版 SHA-256 相同 |
| Production dependency audit | 0 已知漏洞 |
| 完整 dependency audit | 10 項開發／建置工具鏈警示：4 moderate、6 high；未強制升級 |

`npm run e2e` 不得描述成「82 支瀏覽器 E2E」。Repository 共有 81 支 `e2e-*.mjs`；其中 80 支列在 `npm run e2e`，`e2e-tryout-smoke.mjs` 是另外執行的單檔試用版 smoke。

第一次在正式 Repository 執行 `npm test` 時，發布結構守門正確抓到忽略目錄 `github-pages-dist` 的舊 v2.1.63 DOCX 與根目錄舊資產。重新執行 `build:github` 清空輸出並同步新版資產後，完整 `npm test` 全綠。這是建置產物更新，不是放寬測試。

## 真實資料與人工驗證

### 真實 T15-01

- 使用者提供的 `11017T15-01-中山北路-岡山路口七叉路口.xlsx` 有 168 個逐格來源欄。
- 真實附件別名測試完整通過。
- 在主工具列切換「尖峰時段判定方式」後，5 個相關頁面的數字均改變；切回後全部恢復。
- 「各路口尖峰彙總」的數字會跟著判定方式改變，頁面沒有誤寫「不適用判定方式」。

自動測試仍有 3 條需要特定真實附件的條件式略過。T15-01 的額外實測不能被擴張描述為另外兩個附件也已通過。

### 1536×864 與 1366×768

- 兩種尺寸各檢查 18 個功能頁，共 36 張畫面。
- 程式化檢查根層橫向溢出、未保護表格溢出、轉向圖裁切與工具列／面板碰撞：0 異常。
- 36 張畫面整理為 contact sheet 後逐頁肉眼檢查：未見文字重疊、表格溢出或轉向圖被截斷。

### Microsoft Excel 與 PDF 閱讀器

- 從正式應用程式勾選全部 10 個可選成果並匯出 Excel；以真正的 Microsoft Excel 開啟，無修復／毀損提示。
- 10 個工作表名稱完整可見；第一張工作表的資料表、原生折線圖、圖例、座標軸與資料點可辨識，第二張工作表亦可正常切換。
- 匯出的 PDF 由 Foxit PDF Editor 正常開啟並辨識為 5 頁，無修復／毀損提示。
- 5 頁匯出 PDF 全部點陣化檢視，表格、道路圖、轉向箭頭與文字未見截斷。
- v2.1.79 使用手冊 19 頁全部點陣化檢視，版號、頁尾、表格與章節版面正常。

## 已知警示與界線

- Vite 提示未來 native config loader 對 JSON import attributes 與 extensionless import 的相容性警告；目前建置成功，列為後續受控依賴維護，不在本次順手改動。
- 主 bundle 超過 500 kB，建置會提出 code-splitting 建議；目前不影響正確性或離線運作。
- 10 項 audit 警示都屬開發／建置工具鏈；production dependencies 為 0。不得直接執行可能造成破壞性升級的 `npm audit fix --force`。
- v2.1.64 起正式手冊只提供 PDF，v2.1.79 沒有 DOCX，因此不存在本版 LibreOffice DOCX 視覺驗證項目。

## 發布證據

- 功能／發布 commit：`3a401d03d5e6bc8832733bbb5a3d744087269fad`（`Release Turning Traffic v2.1.79`）。
- GitHub「建置與測試」run `35477494692`：success。
- GitHub `pages build and deployment` run `35477493555`：success。
- 帶版號首頁 <https://baotoast.github.io/Turning-Traffic/?v=2.1.79> 回應 200，引用 `assets/index-D2lY7Qv1.js` 與 `assets/index-ChnT-NVq.css`。
- 線上／本機主 JS SHA-256 均為 `6084FFC16B7F55AF7326A6B8D7041C9B60DBCD235C5708CA22F2A172B4EBE422`。
- 線上／本機 v2.1.79 PDF SHA-256 均為 `5D614A00F00A39E57C36D903093524B86AD0593F58697FFCCC1999B6B6C02343`。
- 舊主資產 `assets/index-DSVt1yFb.js`、舊 v2.1.63 PDF 與 DOCX 線上均為 HTTP 404。
