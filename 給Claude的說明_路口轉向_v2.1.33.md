# 給 Claude 的複查說明：Turning Traffic v2.1.33

日期：2026-08-29

## 一、本次結論

我以已發布的 v2.1.31 `main` 為乾淨基底，套入並複查你提供的 v2.1.32。
你在 v2.1.32 修正的兩項問題成立且保留：

1. 網頁歷季趨勢在無法計算全日尖峰時顯示「－」並讓折線斷開。
2. 品質異常明細標籤改為「各車種分類合計」。

複查發現同一個 DAY 可用性判斷尚未涵蓋三條輸出路徑，已修正並推進版號為 v2.1.33。

## 二、v2.1.33 額外修正

### 1. 批次分析報表的歷季趨勢 Excel

`createAnalysisWorkbook()` 原本仍直接使用 `totalOf()`，會把相容欄位中的 DAY 0
寫成真正數字，Excel 圖表因此掉到零。

### 2. 頁面「下載趨勢 Excel」

此路徑也直接輸出 DAY 0，並以該假 0 計算前期百分比。

### 3. 報告文字草稿

「各路口分項結果」會把不可用 DAY 寫成 `0.0 PCU/hr`，與網頁顯示「－」矛盾。

## 三、實作重點

- `lib/traffic.ts`
  - 新增 `scopeValueOrNull(record, scope, value)`。
  - DAY 不可用時回傳 `null`；真正的 0 保留。
  - AM／PM 不套 DAY 可用性限制，0 仍保留。
- `app/traffic-app.tsx`
  - 批次分析報表及直接下載趨勢 Excel 均改用 `scopeValueOrNull()`。
  - 無資料時不建立百分比。
  - 報告草稿的各路口 peak summary 增加 `available`。
- `lib/report-draft.ts`
  - `available === false` 時輸出 `全日尖峰小時（－）：無法計算。`，不列假總量與支線數值。
- 測試
  - `tests/trend-day-gap.test.ts` 增加不可用 DAY、有效 0、AM／PM 0 的語意守門。
  - `tests/report-draft.test.ts` 增加文字草稿不得輸出假 0 的守門。
  - `scripts/e2e-report-draft.mjs` 增加瀏覽器層檢查。

沒有修改任何交通計算規則，`LAST_CALC_CHANGE_VERSION` 仍為 v2.1.30。

## 四、驗證結果

- `npm ci`：成功，使用鎖定的 SheetJS 0.20.3。
- `npm test`：201/201 通過（45 項 `.mjs`＋156 項 `.ts`），含 lint 與建置。
- 完整既有 e2e：候選版全部通過。
- 最後增量修正後，受影響的 `e2e-report-draft` 與 `e2e-trend-day` 再次通過。
- PDF 手冊 48 頁、DOCX 手冊 32 頁均已逐頁視覺檢查，無裁切、重疊或缺字。

詳細證據見 `VALIDATION_REPORT.md`。

## 五、請你下一輪特別複查

1. `scopeValueOrNull()` 是否完整區分「DAY 不可用」與「真正算得出的 0」。
2. `createAnalysisWorkbook()` 與頁面直接下載趨勢 Excel 是否都使用同一判斷。
3. Excel 的空白值是否仍由既有 `dispBlanksAs=gap` 畫成斷線。
4. 報告草稿 `available` 的傳遞是否涵蓋所有 site summary，且不影響 AM／PM。
5. `LAST_CALC_CHANGE_VERSION` 應維持 v2.1.30，不應因本次輸出修正推進。
6. 手冊、下載連結、CHANGELOG 與程式版號是否全部為 v2.1.33。

## 六、原 v2.1.32 交付檔的雜湊差異

收到的 `TurningTraffic_Source_v2.1.32.zip` 實際 SHA-256：

`E00C329655CF2371651AAF4241C532FA58BA311D88CBFDDD63BFE5F28EA08F19`

隨附清單記載：

`CA34EE0230D5E56CC6B54773057DB54302BB03825DE99241D8F61E2B796E5D39`

兩者不一致；說明檔 ZIP 與其中 MD 則一致。v2.1.33 已重新建立新的 SHA-256 清單，
下一輪請以新清單核對，不沿用 v2.1.32 的清單值。
