# Turning Traffic v2.1.27 驗證報告

驗證日期：2026-08-27（Asia/Taipei）

## 驗證結論

v2.1.27 是在 v2.1.26 上進行的發布結構與可攜性強化版。本版沒有變更任何交通量、PCU、駛入／駛出、尖峰搜尋或車種組成計算規則，也沒有加入 LOS／HCM 計算。

Claude 交付包複查時發現一項遺漏：`scripts/stress-drag.mjs` 雖已移除種子檔的電腦專屬絕對路徑，卻仍要求命令列一定要傳入正式建置目錄；依交付說明直接執行會因 `ROOT` 為 `undefined` 而中止。現已補上 `github-pages-dist` 預設路徑與預設測試名稱，並增加第 9 項發布結構回歸檢查。

## 已通過項目

- 以 npm 10.9.4 執行乾淨安裝成功，實際安裝官方 SheetJS 0.20.3。
- `npm run lint`：0 錯誤、0 警告。
- 自動測試 161/161 通過：模組測試 41 項、TypeScript 測試 120 項。
- 瀏覽器端對端測試 8 支全數通過，涵蓋轉向圖、完整流向箭頭、圖卡拖曳、報表、草稿、調查型態、版面、備份還原與季度鎖定。
- 640、760、820、900、1024、1100、1180、1280、1350、1440、1680、1920 像素寬度的全部主要頁面均無橫向溢出或 JavaScript 例外。
- 七叉路口獨立壓力測試可不帶參數直接執行；14 張圖卡連續拖曳 300 步，無頁面崩潰或 JavaScript 例外。
- GitHub Pages 正式建置成功；根目錄只保留本版入口檔所引用的雜湊資產。
- 正式環境相依套件安全檢查為 0 項弱點。
- 完整相依套件檢查的 4 項中度風險均位於僅供開發建置的 drizzle-kit／esbuild 鏈，沒有進入公開網站成品；未採用可能破壞相容性的強制修復。
- v2.1.27 新手手冊 PDF 共 43 頁，逐頁轉圖檢查後未見空白頁、文字重疊或裁切；封面與頁尾皆為 `v2.1.27 ｜ 2026-08-26`。

## 發布結構守門

`tests/release-structure.test.mjs` 現有 9 項檢查：

1. 版號在程式、套件、手冊產生器與下載連結一致。
2. 更新紀錄的最新一則等於程式版號。
3. 手冊封面與頁尾版號、日期一致。
4. 本版手冊存在且舊版手冊已移除。
5. `.nojekyll`、`.gitignore`、`.github`、`.openai/hosting.json` 等點號檔案完整。
6. 自訂 workflow 只測試、不發布，維持單一 GitHub Pages 發布路徑。
7. 套件管理只使用 npm 與 `package-lock.json`。
8. 根目錄沒有上一版殘留的雜湊資產。
9. 七叉路口壓力測試未傳參數時會使用 `github-pages-dist`，不再因未定義路徑中止。

## 已知限制

- 本機未安裝 LibreOffice，因此 DOCX 未使用 LibreOffice 轉圖檢查；DOCX 與已逐頁檢查的 PDF 由同一份 `manual.html` 產生。
- `.openai/hosting.json` 仍由 `vite.config.ts` 匯入，是建置相依檔，必須保留；GPT Site 已退役，本版不部署 GPT Site。
- 線上版本判斷必須使用 `?v=2.1.27`、帶版號的手冊路徑或只存在於本版的雜湊資產，不可只依固定路徑判斷。

## 正式發布原則

- 正式網站：`https://baotoast.github.io/Turning-Traffic/?v=2.1.27`
- 發布來源：GitHub `main` 分支根目錄。
- 自訂 GitHub Actions workflow 僅負責建置與測試，不執行 Pages 發布。
- GPT Site 已退役，本版不部署 GPT Site。
