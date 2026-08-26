# 部署說明

正式網址：<https://baotoast.github.io/Turning-Traffic/>

## 只有一條發布路徑

GitHub 專案 **Settings → Pages → Source** 固定為
**Deploy from a branch → `main` → `/ (root)`**。

推送 `main` 之後，由 GitHub 內建的 `pages-build-deployment` 直接把
repository 根目錄當成網站發布。`.github/workflows/pages.yml`
**只執行建置與測試，不發布**。

> 這不是風格偏好。v2.1.26 以前兩條路徑同時在跑（自訂 workflow 發布一份、
> 內建流程再發布一份），線上是哪一版取決於誰晚完成——而兩邊剛好一致時
> 完全看不出來。`tests/release-structure.test.mjs` 現在會擋住任何在 workflow
> 裡加回發布步驟的改動。

## 安裝相依套件時會連到 cdn.sheetjs.com

`package.json` 的 `xlsx` 指向
**`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`**，不是 npm registry。
這是 SheetJS 官方自 0.20 起的發布方式，也是安全警示的修正版，應該維持。

代價是 **`npm ci` 需要連得到 `cdn.sheetjs.com`**：

- GitHub Actions 的執行環境沒有問題。
- 但在受限網路、公司 Proxy、離線環境或某些沙箱裡，`npm ci` 會出現
  `403 Forbidden - GET https://cdn.sheetjs.com/...`。
- **這個錯誤與程式碼無關**，不要當成建置壞掉而去改程式。先確認該網域連得到；
  若只是要檢查程式邏輯（lint、單元測試、e2e）而不是產生正式成品，
  可以暫時改用 npm registry 上的 `xlsx` 版本，但
  **絕對不可以用那份安裝結果產生要發布的 `assets/`**——那會把 SheetJS
  降回有安全警示的版本，而且從畫面上完全看不出來。

## 更新版本時要同步改的東西

`tests/release-structure.test.mjs` 會檢查下面每一項，漏掉任何一個測試就會失敗：

1. `lib/traffic.ts` 的 `VERSION` 與 `VERSION_HISTORY`（**版號的唯一來源**）。
2. `package.json` 與 `package-lock.json` 的 `version`。
3. `scripts/manual/manual.html` 的封面戳記（版號＋日期），並新增
   「本版（vX.Y.Z）更新內容」區塊。
4. `scripts/manual/build-pdf.mjs`、`build-docx.mjs` 的輸出檔名與頁尾
   （**頁尾日期必須等於封面戳記的日期**）。
5. `app/traffic-app.tsx` 裡兩個手冊下載連結的檔名。
6. `CHANGELOG.md` 最上面那一則的版號。
7. 重新產生手冊，並**刪除** `public/` 與根目錄下舊版號的 `.pdf`／`.docx`。

備份格式若有變動，還必須提供能讀舊備份的還原處理，並在
`tests/backup-completeness.test.mjs` 補上對應檢查。

## 發布前檢查

```bash
npm ci
npm run lint
npm test          # 建置 ＋ 模組測試 ＋ TypeScript 測試
npm run e2e       # 瀏覽器端對端測試
npm run build:github
```

全部通過之後才重新產生手冊、更新版號並發布。

## 人工上傳 GitHub 時

**以點開頭的項目用網頁「拖曳上傳」會被整批濾掉，而且完全不出聲**——
它們根本不會出現在待上傳清單裡。若清單上看不到
`.github`、`.gitignore`、`.nojekyll`、`.openai`，那是正常現象，代表沒上傳成功。

- repository 裡**已經有**那些檔案 → 不用處理，沒被覆蓋的檔案不會被刪。
- 需要新增或更新 → 用 **Add file → Create new file**，在檔名欄直接輸入完整路徑
  （例如 `.github/workflows/pages.yml`），貼上內容後 commit。

另外，上傳只覆蓋同名檔案、**不會刪除**。舊版手冊與舊的
`assets/index-<舊雜湊>.js` 必須依「需刪除的舊檔清單」手動刪掉。

## `.openai/hosting.json` 不可以刪

GPT Site 已於 2026-08-24 退役，本專案不再部署，也不應恢復部署 GPT Site。
但 `vite.config.ts` 直接 `import` 這個檔案，**刪掉會讓建置失敗**。
「不部署 GPT Site」和「刪掉這個檔案」是兩件事。
若日後真的要移除，必須先改建置設定、跑完整測試，再另開一版處理。

## 確認線上是不是最新版

固定路徑（首頁、`package.json`、`app.js`）會被 CDN 與瀏覽器快取，
**不能只看它們**。請至少交叉確認兩項：

1. `https://baotoast.github.io/Turning-Traffic/?v=<版號>`
2. 帶版號的手冊：`Turning-Traffic-<版號>-新手操作手冊.pdf`
3. 只有該版才存在的雜湊資產：`assets/index-<本版雜湊>.js`
