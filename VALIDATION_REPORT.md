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

發布 commit、GitHub Actions、Pages、線上 SHA-256 與舊資產 404 證據將在推送並完成線上驗證後補入本節；未完成前不得宣稱正式發布完成。
