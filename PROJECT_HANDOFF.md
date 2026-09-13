# Turning Traffic 長期工程交接基準

最後更新：2026-09-13

適用系統：**Turning Traffic 路口尖峰轉向交通量分析系統**

文件用途：主要 GPT 開發對話換代、Claude 修改後的 GPT 獨立複查、修正、測試、發布與 Claude 第二次複查。

> 本文件不是聊天摘要。後續維護必須同時閱讀本文件與目前實際 Repository；若兩者衝突，以可驗證的程式碼、Git 狀態與可重現測試為準，並明確記錄差異。

## 1. Repository 身分與正式基準

### 1.1 唯一正確的交通程式

- 正式名稱：Turning Traffic 路口尖峰轉向交通量分析系統
- Repository 根資料夾名稱：`turning-traffic-v2147-review`
- 2026-09-13 實際核對的本機完整路徑：`D:\Users\95108\Documents\Codex\2026-08-27\3\tmp\turning-traffic-v2147-review`
- GitHub Repository：`BaoToast/Turning-Traffic`
- GitHub URL：<https://github.com/BaoToast/Turning-Traffic>
- Git origin：`https://github.com/BaoToast/Turning-Traffic.git`
- 正式 GitHub Pages：<https://baotoast.github.io/Turning-Traffic/>
- 帶版號的正式驗證網址：<https://baotoast.github.io/Turning-Traffic/?v=2.1.63>
- 正式 branch：`main`
- 目前正式程式版本：`v2.1.63`
- 交接文件建立前的 `HEAD`／已發布文件基準：`a4f93f29c25242a0faddcdf562a38b16f1012ceb`（`Document v2.1.63 release verification`）
- v2.1.63 功能發布 commit：`ef5e56e028dbbba87b4529b87b0ae40341dd66fe`
- 2026-09-13 核對結果：建立本文件前 `HEAD` 與 `origin/main` 完全相同，工作區乾淨。

本文件提交後 Git `HEAD` 必然成為新的文件提交；不要企圖把該提交自己的雜湊硬寫回同一個提交，否則會形成無限自我參照。新 GPT 接手時必須以 `git rev-parse HEAD` 取得當下最新 HEAD，並把上列 `a4f93f...` 視為 v2.1.63 應用程式與發布驗證基準。

### 1.2 不得混用的其他系統

使用者另有兩套獨立程式：「全日交通量及車種組成」與「旅行速率與服務水準」。本 Repository 只負責路口尖峰轉向交通量。不得把另外兩套的程式、公式、版本、部署規則或交付檔案直接套進本專案。三套系統目前維持獨立，使用者已決定現階段不要為未來整合而重構、改寫或整併本系統。

## 2. 專案用途、完成程度與實際使用情境

本系統是瀏覽器式、單機優先的路口轉向交通量分析工具，用於每季、多計畫、多路口交通調查。它讀取調查廠商提供的 Excel，辨識路口支線、OD 或左直右、車種、時間與調查日別，計算 AM／PM／全日尖峰與全日時段成果，提供核對、圖表、趨勢、比較、報告、Excel/PDF/PNG/SVG/ZIP 匯出及 JSON/ZIP 備份。

截至 v2.1.63，主體與已要求功能均已完成並正式發布；目前維護重點是使用者回饋、錯誤修正、新格式相容與計算結果驗證。沒有已知會阻擋使用的未解程式錯誤，但「沒有已知問題」不等於未來輸入格式皆已驗證。

資料預設只保存在使用者瀏覽器的 IndexedDB；原始調查檔不會自動上傳。清除網站資料、換瀏覽器或換電腦前，必須先匯出備份。

## 3. 技術架構與主要責任

### 3.1 技術環境

- Node.js：`>=22.13.0`，正式 CI 使用 Node 22。
- package manager：**npm only**；鎖定檔是 `package-lock.json`。不得加入 `pnpm-lock.yaml`、`pnpm-workspace.yaml` 或改用 pnpm。
- TypeScript 5.9、React 19、vinext/Vite、ESLint、Playwright。
- Excel：包內 `vendor/xlsx-0.20.3.tgz` 的 SheetJS 0.20.3；版本與 SHA-256 由發布結構測試鎖定，不得降回 npm registry 的 0.18.5。
- 文件／匯出：`docx`、`jspdf`、`jszip`。
- 正式網站是 GitHub Pages。`.github/workflows/pages.yml` **只測試、不部署**；Pages 設定為 `main` branch 的 repository root。
- `.openai/hosting.json` 雖不再代表現行正式部署，但 `vite.config.ts` 仍直接 import；不可直接刪除。若要移除，需另版修改建置設定並跑完整回歸。

### 3.2 主要檔案

- `app/traffic-app.tsx`：主要 UI 與應用流程；計畫／季度狀態、匯入確認、車種映射、流向同步、SVG 轉向圖、報表與批次匯出、備份還原均在此整合。檔案很大，修改前必須先辨識受影響的資料流，不能只做文字搜尋式局部替換。
- `app/globals.css`：整體視覺、響應式版面、列印與圖卡配置。
- `lib/traffic.ts`：核心資料型別、版本、PCE、範圍／單位、尖峰視窗、Excel parser、日期／日別／站號與車種辨識、品質檢查、流量與 PCU 核心工具。交通計算的主要事實來源。
- `lib/trend-metrics.ts`：歷季與跨計畫趨勢指標、單位、資料點、講稿、完整季度軸與 4,800px 圖寬上限。
- `lib/state-storage.ts`：IndexedDB 讀寫、舊 localStorage 遷移、原始狀態搶救、所有寫入序列化。
- `lib/final-features.ts`：趨勢選取、匯入 revisions、審核／品質、OD 矩陣、支線平衡、尖峰敏感度、圖卡碰撞預警與報表項目。
- `lib/period-date.ts`：民國／西元季度與月份、日期辨識、期別與調查日期核對。
- `lib/conclusion.ts`：依選定條件產生結論文字；不得自行創造不存在的數據。
- `lib/report-draft.ts`：把報表項目與資料轉成草稿段落；段落與匯出項目須一一對應。
- `github/`、`vite.github.config.ts`：GitHub Pages 的 Vite 入口與建置設定。
- `github-pages-dist/`：`npm run build:github` 的輸出；正式發布前須把其 `index.html` 與 `assets/` 同步到 repository root。
- 根目錄 `index.html`、`assets/`、`.nojekyll`：GitHub Pages 實際發布內容。
- `scripts/`：手冊產製、2 支種子資料產生器（`seed-state.mjs`、`make-wide-seed.mjs`）及 25 支 `e2e-*.mjs` 瀏覽器測試。`npm run e2e` 建置後合計執行 27 個 Node 流程步驟；不得把全部 27 個流程步驟都稱為瀏覽器 E2E。
- `tests/`：計算、parser、資料契約、備份、發布結構、文件與 regression tests。
- `CHANGELOG.md`：重點版次；完整版本歷史的唯一來源是 `lib/traffic.ts` 的 `VERSION_HISTORY`。
- `DEPLOYMENT.md`：正式部署與版本同步清單。
- `VALIDATION_REPORT.md`：最近一次 v2.1.63 風險導向複查與發布證據。

## 4. 完整資料流程

1. **原始輸入**：使用者選擇 `.xls`、`.xlsx` 或 `.xlsm`。同一檔可包含平日／假日工作表。照片、監測日誌與時相／號誌表會分類而非當交通量解析。
2. **安全讀取**：`inspectWorkbookVariants()`／`inspectWorkbook()` 以固定安全選項讀取，不讀公式、HTML、VBA；解析前後檢查 `Object.prototype`，若發現污染會移除新增屬性、中止匯入並顯示檔名。
3. **工作表與格式辨識**：依工作表名稱、時間欄、語意表頭、來源支線、目的支線或左直右及車種辨識，不依賴單一固定欄號。平／假日多 sheet 會拆成不同 `ImportPreview`。
4. **欄位與車種解析**：建立每一個「來源支線 × 目的支線／轉向 × 車種」欄；已知與未知車種都可保留。車種可維持獨立分析或映射到四個標準類別。
5. **原始值正規化**：合法數值先依使用者決策四捨五入為整輛，再參與所有加總與 PCU；全形數字先 NFKC。非數字且非合法橫線會警告並以 0 進現行流程；不能把「沒測到」無聲宣稱為真實 0。`--`／各種長短橫線代表不存在轉向，不等於實際量到 0。
6. **預覽與驗證**：顯示站號來源、日別、調查日期、期別、格式、支線、車種、時間格、警告與尖峰預覽。站號讀不到時才由檔名推定；推定值必須提示確認。調查日期與期別使用同一個日期選擇器。
7. **係數與映射套用**：使用者確認車種歸類及每車種左／直／右 PCE；修改 PCE 後必須用同一個 `peakWindowsFor()` 重新挑尖峰，不能只重算中選時段的 PCU。
8. **建立資料結構**：存成 `TrafficRecord`，內含計畫、路口、站號、季度、日期、日別、PCE 快照、車種映射、支線、OD routes、AM/PM/DAY 視窗、全日調查資訊、來源追溯、審核與鎖定資料。
9. **流向與合計同步**：`syncRouteTotals()` 由 routes 計算 PCU 與支線合計；全日時段 `FULL` 每次從 `route.survey` 現算，避免兩份來源漂移。沒有 24 小時資料時全日相關成果不可偽裝成 0。
10. **儲存**：應用狀態序列化後存 IndexedDB。連續寫入、搬遷寫入與清除全部排入同一條鏈，前一次交易真正完成後才執行下一次。
11. **UI 與核對**：品質頁、各支線駛入／駛出、來源儲存格、OD 矩陣、平衡與敏感度、轉向圖、車種組成、趨勢與跨計畫比較都讀同一份正規化紀錄。
12. **匯出**：畫面選定資料與報表項目後產生 Excel、PDF、PNG、SVG 或批次 ZIP。Excel 圖表、右側摘要與畫面指標的數值／單位必須一致；缺季保留空白並斷線，不可補 0。

## 5. 核心資料結構與方向語意

### 5.1 `TrafficRecord`

重要欄位：`projectId`、`station`、`name`／`rawName`、`quarter`、`date`、`surveyType`、`pceUsed`、`peaks`、`survey`、`vehicleLabels`、`vehicleMapping`、`approaches`、`routes`、`movementRule`、`directionDisplay`、`resultLock`、`review`、`revision`、`sourceTrace`、`sourceFiles`、`validation`。

### 5.2 路線與方向

- `RouteFlow.fromApproachId`：車輛從這條支線離開，進入中央路口；畫面慣用短名稱「駛出路口 A」。
- `RouteFlow.toApproachId`：車輛離開中央路口後進入這條支線；畫面慣用短名稱「駛入路口 A」。
- 方向文字容易產生語意混淆；修改任何駛入／駛出標籤前，必須同時核對 `fromApproachId`／`toApproachId`、箭頭方向、支線合計與匯出欄名，不能只改顯示文字。
- 整個路口的所有「來源支線駛出」總和與所有「目的支線駛入」總和理論上應相等（封閉 OD 集的守恆核對）。不要把兩者再相加當成「路口總量」，否則每輛車會被計兩次。

### 5.3 路口幾何

- 原始 A～G `sourceCode` 與繪圖角度獨立；跨季繼承以標準路口與支線代碼為鍵。
- 角度定義：0° 東、90° 南、180° 西、270°／-90° 北；八方位由 `bearingFromAngle()` 自動產生，方位不可另行人工輸入。
- 幾何建議的轉向：以來源車流進入路口的 heading（來源角度 + 180°）與目的支線角度差判斷；絕對差 ≤45° 為直行，負值左轉，正值右轉。
- 使用者手動確認的 `movementRule: "manual"` 不得在重整、還原或幾何同步時被覆蓋。
- 七叉「中山北路－岡山路口」參考規則只可在支線代碼確為 A～G 七支時套用，不能只靠名稱硬套。

## 6. 不可任意改變的交通工程規則

### 6.1 車種與 PCE/PCU

- 四個標準車種：機車 `motorcycle`、小型車 `car`、大型車 `heavy`、特種車 `special`。
- 預設可編輯 PCE 矩陣（左／直／右）：

| 車種 | 左轉 | 直行 | 右轉 |
|---|---:|---:|---:|
| 機車 | 0.5 | 0.3 | 0.4 |
| 小型車 | 1.5 | 1.0 | 1.3 |
| 大型車 | 2.3 | 1.5 | 2.0 |
| 特種車 | 2.5 | 2.0 | 2.3 |

- 上述係數是既有專案預設且可由使用者依計畫依據修改；不要重新宣稱為法規或通用固定值。
- 任意新車種可獨立保留，預設係數 1.0，由使用者填入；也可映射到四標準類別。大貨車、大客車、聯結車不可僅按欄位位置擅自歸類。
- 每次匯入必須保存 `pceUsed`、`pceVersion`、`vehicleMapping` 與 label 快照；日後改目前計畫設定不得偷偷回寫舊紀錄。
- 單一路線／車種／轉向：`PCU = 整數車輛數 × 該車種該轉向 PCE`。
- 路線 PCU 先以 `roundedPcu()` 留一位小數，支線合計再留一位小數。PCU 顯示與匯出均以一位小數為準。
- 車種組成是實際車輛數，不是 PCU。單一車種 PCU 必須由實際 OD × 同一 PCE 現算；不可按總 PCU 比例反推。
- `pcuBreakdown()` 對帳容差：PCU 為 `max(0.5, 已存 PCU × 1%)`；逐車種車輛數為 `max(5 輛, 該車種 5%)`。對不上時要明確顯示不可靠原因，不能靜默選一邊。

### 6.2 尖峰時段

- `AM` 搜尋範圍 `[00:00, 12:00)`；`PM` `[12:00, 24:00)`；`DAY` `[00:00, 24:00)`。
- 尖峰固定是**完整且連續的 60 分鐘**。15、20、30、60 分格可精確組成；45、120 分格不能冒充 PCU/hr，必須回報資料不足。
- 視窗起點與終點都必須落在搜尋範圍內；不可讓 AM 跨入 PM。
- 每一候選視窗必須逐格連續，中間缺格不可使用。
- 以所有已辨識流量欄的 PCU 加總選最大視窗。PCE 或車種映射改變時，尖峰視窗也必須重算。
- 同值只在 `total > best.total` 時更新，所以自然保留較早的候選視窗；此為既定同值規則。
- `DAY` 只在調查涵蓋至少 1,440 分鐘時提供。混合時間格目前是**只警告、不改既有挑選邏輯**，未經使用者明確決策不得順手改掉。

### 6.3 統計範圍、單位與缺值

- `AM`、`PM`、`DAY` 都是 60 分鐘流率：PCU/hr 或 輛/hr。
- `FULL` 是完整調查日累計：PCU/調查日或 輛/調查日。
- 全日時段與全日尖峰都要求至少 24 小時。只有 AM／PM 的原格式檔案，其 DAY/FULL 應顯示「－」與原因，不是 0。
- 單位的唯一來源是 `scopeUnit()`；不得在 UI、圖表或 Excel 另寫一套判斷。
- 真實 0 必須保留；無資料／不可計算必須是 `null`、空白或「－」。缺季折線必須斷開，不能用 0 連線。
- `FULL` 唯一來源是每條 route 的 `survey.vehicle`；每次由 `syncRouteTotals()` 現算，不另存第二套全日合計。

### 6.4 原始數值與轉向存在性

- 原始交通量儲存格依 Excel 畫面整數決策，讀取時即四捨五入；下游不得重複或改用另一種 rounding。
- `0` 表示該轉向存在且量到 0；`--`、`—`、`–`、`－` 表示不存在轉向；全欄空白則無法判定。
- 三岔路口依支線／目的地算術可安靜移除符合預期的幽靈列；超出算術預期的橫線或整欄空白須要求使用者裁決。無法確定時寧可保留並標 `presence: "unknown"`，不可無聲刪真實流向。
- 流向存在性答案依標準路口與 OD 保存，跨季可重用；任何自動建議都不能取代使用者裁決。

### 6.5 計算口徑版本界線

- `lib/traffic.ts` 的 `VERSION` 是版號唯一來源。
- `LAST_CALC_CHANGE_VERSION` 必須維持 `v2.1.30`，除非本次確實經使用者同意修改 PCU、尖峰、流向、車種歸類或其他計算口徑。
- 純 UI、說明、儲存可靠度或圖表排版修正不得假裝成計算口徑變更。
- 已鎖定成果若版本早於最後計算口徑版本，要提示可能衝突；使用者可人工解鎖，但不得靜默修改。

## 7. Parser、輸入格式與陷阱

### 7.1 現有格式範本

`IMPORT_FORMAT_TEMPLATES` 目前包含：

1. `hourly-weekday-holiday-turning-v1`：同一 workbook 的平日／假日全日整點轉向表，分日別匯入，60 分鐘格。
2. `semantic-turning-v1`：一般語意轉向表；以時間欄、來源支線、左直右或 OD 目的地及車種欄名辨識，格距自動。
3. `full-day-road-vehicle-v1`：全日路段車種表但沒有轉向；可辨識但標為非路口轉向，不建立假的路口成果。

### 7.2 Parser 長期規則

- 交通 sheet、日誌、時相與照片分桶；不要把「看起來有數字」當成交通量的唯一條件。
- 時間欄至少有四個可解析時間，並有時間表頭或至少四個字串時間。
- 表頭向上最多八列組成語意；欄位必須能證明有轉向／目的地後，未知文字才可收為自訂車種，避免把合計、備註當車種重複加總。
- 只有四個內建車種且欄群結構吻合時才容許位置式救援；有自訂車種即以表頭為準。
- 站號優先 workbook 的「站號」，其次檔名；讀不到不可捏造。推定支線代碼 A1、A2 時要警告，因其會影響跨季幾何與 OD 鍵。
- 日期必須排除製表日期、報告日期等非調查日期；同一筆紀錄與期別檢查要使用同一來源儲存格。
- 平日／假日是 `surveyType`，不是兩個正式路口名稱。畫面可帶括號區分資料列，但標準路口識別、幾何同步與趨勢需維持同一正式路口。
- `.xls` BIFF8 相容不可因只測 `.xlsx` 而移除；`.xlsm` 只讀值，不執行巨集。
- Parser 或匯入架構修改屬高風險，必須驗證輸入 → 解析 → 計算 → UI → 匯出與舊備份相容。

### 7.3 已驗證的實檔範圍

README 記錄已用使用者提供的 115Q2 T15-01～05 `.xlsx` 驗證：T15-01 七支、168 個 OD×車種欄；T15-02 三支、36 個左直右×車種欄；T15-03～05 各四支、48 欄；五檔均讀到 16 個 15 分鐘區間與 2026-05-04 調查日。另有 BIFF8 記憶體轉檔回歸。

v2.1.63 全套測試有三項真實附件條件式略過：`11535T1502...xls`、`11535T1503...xls`、`11017T1501...xlsx` 不在正式交付包內。這三項是「未執行」，不是「通過」。日後拿到原檔應補跑，但不可用匿名合成測資宣稱取代實檔驗證。

## 8. 已確認 UI/UX 與功能決策

- 介面分為開始、資料匯入、參數設定、資料檢視、圖表與比較、產出與維護；View id 不可因重排而更名，避免狀態與 E2E 失效。
- 主要功能頁：總覽、新手手冊、季度批次匯入、品質檢查、名稱、道路與流向、車種轉向當量、駛入／駛出、核對工作台、轉向圖、車種組成、進階分析、趨勢、跨計畫、多計畫、結論草稿、報表與批次輸出、備份還原。
- 轉向圖可選只顯示駛入、只顯示駛出或兩者；箭頭方向與數據卡內容必須同步。兩者同時顯示時分成兩卡，不應合成遮擋路口的大卡。
- 圖卡與路口標籤可在全幅排版預覽拖曳或輸入 X/Y；三種顯示模式分別保存位置，舊 `cardOffset` 只作備份相容。3–7 岔均須防遮擋；匯出前檢查卡片、中央路口、圖例碰撞。
- 道路與流向管理右側維持簡潔道路預覽；排版調整另開全幅預覽，不能把管理頁塞成難懂的技術面板。
- 同一實體道路可由使用者選擇分方向或雙向合計；此為呈現／彙整選擇，不得強迫所有道路使用同一模式。
- 平日、假日與其他實際資料別必須分開，可切換；跨計畫「全部」是各資料別分線，不是混成一條。
- 歷季趨勢可選 AM/PM/DAY/FULL 與不同指標；畫面、摘要、講稿、PNG、可編輯 Excel 圖表必須同源同單位。期間中缺季要保留空位與斷線。
- 長期趨勢圖寬度上限 4,800px；資料點及折線完整，只有文字標籤可依密度抽樣。
- Excel 報表依專案選定項目輸出。核心已要求包含車種組成、歷季趨勢可編輯圖、跨計畫／多路口比較；後續已加入 OD、平衡、品質與當量等自選項目。不得擅自把未選項目塞入。
- 新手手冊是正式功能；版本、日期、檔名、UI 下載連結、`public/` 與根目錄副本必須同步。
- 成果審核狀態與季度成果鎖定分離；鎖定／解鎖由使用者決定，版本衝突需提示。
- 容量相關分析不是本系統範圍；保留舊備份相容欄位，但不要重新把車道容量輸入或容量判定加回主流程。

## 9. 儲存、備份與資料邊界

- 正式儲存是 IndexedDB：DB `turning-traffic`、store `state`、key `turning-traffic-state-v2`。
- 舊 localStorage 只在首次遷移讀取。只有寫入 IndexedDB 後重新讀回且字串完全相同才可刪舊值；正式新資料不雙寫兩邊。
- 所有寫入（含遷移與全部清除）必須串行，且 Promise 只在 transaction `oncomplete` 後成功；`request.onsuccess` 不代表交易已提交。
- `saveTokenRef` 只能防 UI 回報順序，不能取代資料庫寫入序列化。
- 儲存被封鎖、容量不足、格式損壞是不同情況，錯誤文字不可武斷宣稱「電腦沒有資料」。搶救原始狀態時只讀，不做搬遷或清理。
- 備份格式變更必須可讀舊備份，並更新 `tests/backup-completeness.test.mjs`。
- 多計畫資料、PCE、車種 catalog/mapping、格式範本、圖卡 layout、revision、審核與鎖定都要維持計畫隔離；不可用目前計畫設定覆蓋其他計畫或批次 ZIP。

## 10. 重要技術決策、歷史缺陷與 Regression 風險

以下為新 GPT 最容易重犯、且已由實測或歷史修正證明的重要項目：

1. **兩條部署路徑互搶**：v2.1.26 前自訂 workflow 與 branch Pages 同時部署，完成順序不定。現在 workflow 只測試，Pages 只用 `main` root；`release-structure` 會擋部署步驟回歸。
2. **根目錄網站仍是舊資產**：只更新版號／手冊但未把 `github-pages-dist` 複製回 root，線上實際 JS 沒變。發布必須同步 `index.html`、整個 `assets/` 並刪舊雜湊資產。
3. **固定 URL 快取誤判**：首頁、`package.json` 等固定路徑可能被 CDN 快取。只可用 `?v=<版本>`、帶版號手冊與只有該版存在的資產雜湊判斷。
4. **遺漏隱藏檔**：GitHub 網頁拖曳會忽略 `.github/`、`.nojekyll`、`.gitignore`、`.openai`。正式維護優先使用 Git；人工上傳要逐項確認。
5. **npm-only 被污染**：先前測試曾生成 pnpm lock/workspace。這些不是交付內容，會使依賴解析與正式 npm 路徑漂移；必須刪除並保持 npm-only。
6. **IndexedDB 寫入競態**：多次 `open()` 回應順序可顛倒，使舊資料最後落地；用全域寫入鏈修正。不可拿掉，也不可只靠 UI token。
7. **交易尚未完成就回成功**：`request.onsuccess` 早於 transaction commit；v2.1.63 改為等待 `tx.oncomplete`。後續測試要保留「未 commit 不得 resolve」。
8. **localStorage 容量不足與雙來源**：舊作法約 4.94 MB 上限且還原點巨大。已搬 IndexedDB，刻意不雙寫，避免新舊來源分岔。
9. **趨勢圖 235/240 像素錯位**：資料點與格線使用不同高度，讀值約差 2%。現行兩者必須同一座標尺度；E2E 直接從 SVG 反推值。
10. **直排中文字糊成一團**：`writing-mode: vertical-rl` 在無頭／替代字型缺直排度量。已改成橫排文字整段旋轉 -90°；不可恢復舊法。
11. **缺季壓縮或補 0**：畫面與 Excel 都要用完整季度軸；缺季空白且折線斷開，缺季後的「較前季」也空白。
12. **跨計畫資料別混線**：不能只假設平／假日，也不能把全部日別加在一起；依實際 `surveyType` 各自分線。
13. **車種數量與 PCU 混用**：車種組成是實際輛數，PCU 依 OD × PCE；單位不可固定成 PCU/hr，也不可按總 PCU 比例分攤車種。
14. **全日與尖峰單位混淆**：FULL 不是 PCU/hr；不足 24 小時不是 0。所有頁面與匯出統一用 `scopeUnit()`、`hasScopeValue()`／`scopeValueOrNull()`。
15. **刪支線留下孤兒 OD**：刪除支線需提示影響並同時移除指向該支線的 routes；新增代碼取未占用最小序號，避免撞號。
16. **路口改名跨計畫污染**：改名只影響目前計畫；使用者手動名稱以 `nameEdited` 保存，不再重整時正規化吃掉。
17. **平／假日被拆成兩路口**：資料別是同一標準路口的不同資料列；名稱正規化需保留括號語意並由 canonical key 合併。
18. **七叉參考表套錯**：不得只因名稱含中山北路／岡山路就套用，必須確為 A～G 七支。
19. **禁止轉向被當真實 0 或反之**：不可用總值 0 判定不存在；必須看 numeric/placeholder/blank 證據及算術盤點。
20. **Excel 修復警告／圖表遮資料**：原生圖表的 XML、欄位字母、資料範圍與空白處理需用 OOXML 測試；圖移到資料表下方且有標題、圖例、X/Y 軸與單位。
21. **過大 canvas**：120 季等長期資料不能無上限倍增畫布；4,800px 是現行安全上限，匯出仍保留全部資料點。
22. **萬用檔案複製假設**：Windows/PowerShell 對 wildcard、缺少目的資料夾與跨 shell 刪除可能表現不同。發布檔同步後要用 SHA 與檔名清單實際核對，不可只相信複製命令無錯。
23. **存檔註解與實作漂移**：`app/traffic-app.tsx` 的存檔註解仍描述兩次寫入同時執行、以 `saveTokenRef` 處理「後發先至」；現行 `lib/state-storage.ts` 已把所有寫入排入同一條序列鏈，`saveTokenRef` 只決定哪一次結果可更新 UI／toast，不取消或取代資料庫寫入。實際序列化機制是正確的既有保護，不得因舊註解而改回並行寫入；註解更新列為後續低風險文件維護。

完整逐版細節請查 `lib/traffic.ts` 的 `VERSION_HISTORY`，重點原因與紅字證明查 `CHANGELOG.md`。若此摘要與現行程式衝突，應先調查差異而非照摘要改程式。

## 11. 已放棄、暫緩或禁止順手進行的事項

- **三系統整併**：使用者評估後決定目前三套系統分開使用。不得為假想整合平台重構本系統；只要避免新增不必要硬編碼並保持解析／計算模組可移植。
- **雲端多人版**：待各系統與實際使用穩定後再評估；目前資料是瀏覽器單機，不得自行加入帳號、同步或伺服器資料庫。
- **GPT Site**：已退役，不是正式發布目標。除非使用者日後明確重建，維護只報告 GitHub/GitHub Pages；但 `.openai/hosting.json` 暫時因建置依賴保留。
- **混合時間格挑選**：現階段只警告，不改計算。
- **容量分析**：明確不在本系統範圍，不重新加入。
- **開發依賴強制升級**：v2.1.63 完整 audit 尚有工具鏈警示；未使用 `npm audit fix --force`，因可能引入破壞性升級。應另開受控版本處理並完整回歸。
- **未獲授權修改已確認公式**：任何計算口徑變更都要先有使用者明確決策、版本界線、黃金值與完整資料流驗證。

## 12. 測試、Build 與發布程序

### 12.1 本機必要指令

```powershell
npm ci
npm run lint
npm test
npm run e2e
npm run build:github
```

`npm test` 會依序執行 lint、vinext production build、`.mjs` tests 與 TypeScript tests。另可單獨執行 `npm run test:engine`，但正式發布不能只跑子集。若風險涉及型別，明確執行 `npx tsc --noEmit` 並記錄結果。

核心驗證至少包括：

- 計算黃金值、arm arithmetic、PCU breakdown、full-day scope、traffic parser。
- 日期／期別、檔名規則、跨系統 guards、silent-failure guards。
- 備份完整性、儲存 race、匯入 revision／鎖定／審核。
- trend metrics、缺季、資料別拆線、長期間圖寬與單位。
- release metadata、release structure、manual version/copies、rendered HTML、dependency manifest。
- `npm run e2e` 流程：25 支 `e2e-*.mjs` 瀏覽器測試，涵蓋轉向圖、名稱、報表、結論、拖放／顯示、重匯、日別、版面、備份、鎖定、趨勢、日期、XLSX 修復、儲存阻擋／IndexedDB、三岔、存在性裁決、revision batch、圖表版面與跨計畫趨勢等；另有 2 支種子資料產生器，合計 27 個 Node 流程步驟。報告時必須分開描述，不能稱為「27 支瀏覽器 E2E」。

涉及交通工程或 Parser 時，必須額外逐層核對：**輸入 → 解析 → 驗證 → 資料結構 → 計算 → UI → 匯出**，並比較同一值在核對頁、轉向圖、摘要、趨勢與 Excel/PDF 中是否一致。

### 12.2 v2.1.63 最後一次已實際完成的驗證

以下是 `VALIDATION_REPORT.md` 對 v2.1.63／功能 commit `ef5e56e...` 的已執行證據，不是本交接任務重新測得：

- 乾淨 `npm ci` 成功，518 packages。
- ESLint：0 errors。
- TypeScript `tsc --noEmit`：通過。
- vinext production build 與 GitHub Pages build：通過。
- 結構／發布：53/53 通過。
- 運算／解析／資料契約：250 通過、0 失敗、3 條件式略過。
- 固定計算黃金值：通過，既有逐車種車輛數與尖峰 PCU 未變。
- `npm run e2e` 的 27 個 Node 流程步驟全部通過；精確組成是 25 支 `e2e-*.mjs` 瀏覽器測試與 2 支種子資料產生器，不是 27 支瀏覽器 E2E。
- Excel OOXML：18 parts、1 native chart，結構合規。
- 18 個功能頁於 640–1920px：無橫向溢出；大量季度測資涵蓋 44 季，另有 120 季安全檢查。
- PDF 手冊 31 頁逐頁視覺檢查：通過；DOCX 結構與副本一致性：通過。因當時缺獨立 LibreOffice 環境，DOCX 未另做點陣化視覺渲染。
- Production dependency audit：0 已知漏洞；包含 dev/build 工具時為 10 項（4 moderate、6 high），已明確暫緩強制升級。

GitHub 證據：

- 功能 commit 的「建置與測試」run `34337416104` 成功；Pages run `34337415540` 成功。
- 文件驗證 commit `a4f93f2...` 的「建置與測試」run `34337779680` 成功；Pages run `34337779004` 成功。
- v2.1.63 主資產：`assets/index-DSVt1yFb.js`，線上／本機 SHA-256 `4F673FEDC82559FC025EE04CB39386DF4B31453D021E0851B11F8DD2FCA560B5`。
- v2.1.63 PDF：`7006CD1D4E9263F8EB33034D6D489CEEA20BC7116F94A4AFECCD1FDFE25F23C7`。
- v2.1.63 DOCX：`9DA92D7184ED0EEE31D9CE8B77AA7AA8398272033DDA6C549E4D3C80B6EAEB7F`。
- 舊 v2.1.62／v2.1.51 主資產與 v2.1.62 PDF 經驗證為 HTTP 404。

### 12.3 2026-09-13 新 GPT 交接驗收的本機重現範圍

本次交接驗收針對當時的 `main`／`08b330edf2c35ef4a8885208cde2f7bf72c1324d`，使用工作區既有 `node_modules` 與 bundled Node.js 24.19.0 進行獨立核對；這不是重新發布，也不是完整乾淨安裝驗證：

- ESLint：通過。
- TypeScript `tsc --noEmit`：通過。
- vinext production build 與 GitHub Pages build：通過。
- 結構／發布 `.mjs` tests：53/53 通過。
- 運算／解析／資料契約 TypeScript tests：250 通過、0 失敗、3 條件式略過。
- `npm run e2e` 所列 27 個 Node 流程步驟全部成功；精確組成為 25 支 `e2e-*.mjs` 瀏覽器測試與 2 支種子資料產生器。
- 3 個需真實附件的條件式測試未執行；不得描述為通過。
- DOCX 沒有在本次補做獨立 LibreOffice 點陣化視覺驗證。
- 本次環境沒有 `npm`，因此未重新執行乾淨 `npm ci`、字面上的 `npm test` 或最新 `npm audit`。各子項是以可用的 Node 執行環境分別重現；不得把第 12.2 節的歷史驗證證據描述成本次重新驗證結果，也不得把本次結果擴張成完整乾淨 npm 驗證。

### 12.4 正式發布

1. 先完成本節全部必要驗證。
2. 若升版，依 `DEPLOYMENT.md` 同步：`VERSION`／`VERSION_HISTORY`、package/lock、手冊 HTML/產製檔名/頁尾、UI 連結、CHANGELOG、PDF/DOCX；刪除所有舊版手冊。
3. 執行 `npm run build:github`。
4. 把 `github-pages-dist/index.html` 與整個 `github-pages-dist/assets/` 同步至根目錄；刪除舊雜湊資產。不可只覆蓋同名檔。
5. 檢查 `git diff`、發布結構、根目錄資產與建置資產 SHA。
6. commit、push `origin main`。
7. 等待 GitHub「建置與測試」及內建 `pages build and deployment` 成功。
8. 用帶版號首頁、該版唯一雜湊資產、帶版號 PDF/DOCX 驗證 live/local SHA；再確認指定舊資產 404。
9. 未完成上述證據不得回報「已正式發布」。

## 13. 固定 Claude ↔ GPT 開發流程

Claude 修改／修復

→ Claude 提供完整檔案與修改說明

→ GPT 獨立進行風險導向複查

→ GPT 發現問題時直接修正

→ 執行必要及完整 Regression／Test／TypeScript／lint／Build

→ 全部必要驗證通過後發布 GitHub／GitHub Pages

→ GPT 提供完整修改、版本、commit、測試結果及高風險資訊

→ Claude Opus High 再進行第二次獨立複查。

GPT 不得因 Claude 表示「已完成」「已測試」或只列某些檔案，就省略獨立驗證。Claude 的說明是複查入口，不是通過證據。

## 14. 完整風險導向複查規則

### 14.1 風險分級

**低風險**：針對本次修改、直接影響範圍及必要的間接影響進行增量複查。

**中風險**：複查所有受影響模組，並追蹤完整相關資料流及跨檔案依賴。

**高風險**：進行全專案層級複查。核心交通工程公式、共用資料結構、Parser／匯入架構、核心計算流程、大型重構、重大跨模組修改，以及可能廣泛影響既有結果的共用邏輯，原則上列為高風險。

### 14.2 所有風險等級共同要求

1. GPT 不受 Claude 宣稱的修改範圍限制。
2. 必須先理解 Claude 本次修改目的與修改說明。
3. 優先檢查本次修改、直接影響、間接影響及跨檔案依賴。
4. 發現可疑邏輯、既有 Bug、Regression、edge case 或其他非預期影響時，主動擴大複查範圍。
5. Claude 的「已修正／已測試／正常」只能作為資訊，不能作為驗證證據；GPT 必須獨立確認。
6. 必須驗證必要完整資料流：輸入 → Parser → 驗證 → 資料結構 → 計算 → UI → 匯出。
7. 執行專案現有的完整 automated tests／regression／E2E／TypeScript／lint／production build 等必要驗證。
8. 發現缺陷時直接修正。
9. 修正後重新執行相關測試及必要的完整 Regression。
10. 所有必要驗證通過後才能發布。
11. 發布後提供 Claude 第二次複查所需完整資訊：Claude 原始修改、GPT 發現問題、Root cause、GPT 額外修正、測試／Build 結果、正式版本、commit、高風險或需 Claude 特別複查項目。

不得因對話變長或更換 GPT 而簡化。使用者在本專案說「複查」或同義指令，除非另有指定，均代表執行以上完整流程；如規則有衝突或記憶不完整，先詢問，不自行降級。

## 15. AI 對話換代交接規則

### 15.1 舊 GPT

1. 以完整重要對話歷史與實際 Repository 更新**同一份** `PROJECT_HANDOFF.md`。
2. 刪除／修正過時資訊，補入本代新增的技術決策、Bug、Regression、功能、測試、版本、部署、已知問題與待辦。
3. 假設新 GPT 完全看不到舊對話，執行交接完整性自我驗收。
4. 實際核對 Repository 身分、remote、branch、HEAD 與工作區，commit 並 push 文件。
5. 回報當下實際核對的本機完整路徑，不能只照抄本文件的舊路徑。

### 15.2 新 GPT

1. 先用使用者提供的完整路徑確認 Repository 身分與三套系統邊界。
2. 完整閱讀 `PROJECT_HANDOFF.md`，再核對程式、Git、測試、Build、Actions 與部署現況。
3. 向使用者完成正式交接驗收回報。
4. 未經使用者明確確認「交接確認完成」，不得修改程式、commit、push、發布或開始待辦。
5. 未來只更新 `PROJECT_HANDOFF.md`；不建立 `_2`、`_3` 等新文件，歷史由 Git 保存。

## 16. 事實來源與證據規則

當舊聊天、本文、README、其他文件、程式碼、Git 或測試結果衝突時：

1. 主動指出差異。
2. 以目前可驗證的 Repository、程式碼、Git 狀態與可重現測試為最終來源。
3. 計算規則先看現行核心程式與黃金值，再查版本歷史及使用者決策；不得只依 UI 文案。
4. 無法確認的資訊標為「待確認」，不猜測、不把理論正常寫成測試通過。
5. 測試略過、缺附件、未進行視覺檢查都要精確回報，不可計入通過數。
6. 線上版本只以帶版號 URL、該版專屬雜湊資產與 live/local SHA 證明，固定路徑不構成證據。

## 17. 正式工程資料與使用者交付檔案分流規則

本節是本專案所有後續 GPT Work 對話都必須遵守的永久工程規則。核心原則是：**正式工程／交接資料保存在正式 Repository 與 GitHub；供使用者取得、檢查或轉交的交換成果另提供為可下載交付檔案。兩者用途不同，不得互相取代。**

### 17.1 正式工程與交接基準的保存位置

1. 正式 Repository 維持在 `D:\Users\95108\Documents\Codex\2026-08-27\3\tmp\turning-traffic-v2147-review`，除非使用者日後明確要求，不得自行搬遷或改用其他交通程式資料夾。
2. 正式 Repository、`PROJECT_HANDOFF.md`、Git metadata、正式原始碼、測試、工程交接資料，以及任何新舊 GPT 換代時需要長期保存、工程追溯、版本控制或作為正式基準的資料，必須保存在正式 Repository／正式工作區，並依其性質納入適當的 Git 版本控制及 GitHub；不得把 Downloads 當作唯一或長期保存位置。
3. 使用者會定期整理 Downloads。任何未來 GPT 接手或工程追溯所必需的資料若只存在 Downloads，均視為保存方式不合格；必須另有正式 Repository／GitHub 中的正式版本。
4. 新舊 GPT 對話換代時，`PROJECT_HANDOFF.md` 仍是唯一正式工程交接基準。必須更新同一份檔案並由 Git 保存歷史，不建立 `PROJECT_HANDOFF_2.md`、`PROJECT_HANDOFF_3.md` 或其他平行交接文件。

### 17.2 Downloads 的定位與使用者交付義務

1. Downloads 是「使用者交換／交付區」，不是正式 Repository，也不是工程基準的長期保存位置。
2. 每次完成程式修改、複查、修正或發布後，若既有工作流程要求交付完整程式包、ZIP、Claude 二次複查包、修改後檔案、修改說明、測試／驗證報告、SHA-256 清單或其他供使用者下載、檢查、備份或轉交 Claude 的成果，GPT 仍必須正常製作並提供為使用者可下載的交付檔案，讓使用者可在 Downloads 中直接取得。
3. 不得因正式 Repository 位於 `Documents\Codex`，就把一般使用者交付成果只留在 Repository 深層資料夾而不另行提供，造成使用者難以取得。
4. 使用者交付檔案可以保存在 Downloads，因其屬於可定期整理的交換成果；但其中任何項目若同時也是正式工程基準或未來 GPT 接手必需資料，正式版本必須另外保存在 Repository，並納入適當的 Git 版本控制，不能只依賴 Downloads 副本。
5. 若未來需要交付完整程式、GitHub Pages 更新包、驗證報告、SHA-256 與 Claude 說明，沿用：

   `D:\Users\95108\Downloads\交通系統交付_YYYYMMDD\路口轉向交通量_<version>\`

6. 同一天不同版本各自建立版本資料夾；同一天同版號再次修正，建立 `_第2次`、`_第3次`，不得覆蓋前一份。
7. 不自動刪除使用者舊交付；使用者備份後會自行刪除。
8. SHA 清單要涵蓋實際交付檔，Claude 說明需列原始修改、GPT 修正、測試、commit 與高風險點。

### 17.3 後續 GPT 必須維持的固定分流

- **正式工程／交接資料 → 正式 Repository + GitHub**：作為長期保存、工程追溯、版本控制與 GPT 換代的正式來源。
- **使用者取得的成果／交換檔 → 可下載交付檔案／Downloads**：供使用者下載、檢查、備份或轉交 Claude，可由使用者定期整理。
- 同一份資訊若兼具兩種用途，必須同時具備 Repository 中的正式版本與 Downloads 中便於使用者取得的交付版本；不得把兩種保存用途混為一談，也不得用其中一處取代另一處。

## 18. 已知界線、待確認與下一步

### 已知界線

- 三個真實附件測試在 v2.1.63 是條件式略過；若處理那些格式，需取回原檔實測。
- DOCX 在 v2.1.63 未用獨立 LibreOffice 點陣化渲染；只驗證 OOXML、版號與副本一致性。PDF 已逐頁檢查。
- 2026-09-13 本次交接驗收同樣未執行上述三個真實附件測試，也未補做 DOCX 的獨立 LibreOffice 點陣化視覺驗證。
- 2026-09-13 本次環境沒有 `npm`，未重跑乾淨 `npm ci`、字面 `npm test` 或最新 `npm audit`；本次可重現子項與第 12.2 節歷史發布證據必須明確分開。
- 完整依賴 audit 有 10 項開發／建置工具鏈警示；production dependencies 為 0。
- 本文件只保存可由 Repository、Git、驗證報告及高價值對話決策交叉支持的內容。無法從現行證據可靠重建的早期聊天細節未寫成事實。

### 已知文件差異與待確認事項

- `README.md` 的 Excel 說明只描述三類成果，現行 UI／匯出實作實際已有 10 個可選工作表。這是後續文件維護事項，不代表目前只支援三張，也不得在本次交接補強中順手修改 README。
- `README.md` 的尖峰說明只描述連續四個 15 分鐘格；現行核心除 15 分鐘格外也支援 20、30、60 分鐘格。這是後續文件維護事項，不得據舊文字縮減核心能力或在本次修改 README。
- `app/traffic-app.tsx` 的存檔註解與 `lib/state-storage.ts` 現行序列化寫入機制不一致；依第 10 節第 23 點處理，僅列為後續低風險文件／註解維護，不修改程式行為。
- `VALIDATION_REPORT.md` 記載驗證日期為 2026-09-10，但該檔所在 commit `a4f93f29c25242a0faddcdf562a38b16f1012ceb` 的 Git author／commit 日期均為 2026-09-09 17:59:27（Asia/Taipei）。目前證據不足以確認是跨日驗證、補記或日期誤植；只記錄差異，未經進一步證據不得自行改日期。

### 後續維護待辦

- 截至 v2.1.63 正式驗證後，沒有已知尚未修正的功能 Bug。
- 經使用者另行授權後，可用低風險文件維護處理 README 的 Excel 工作表／時間格描述，以及 `traffic-app.tsx` 的存檔註解；仍須核對實作、相關測試與完整資料流，不可藉文件維護變更計算或儲存機制。
- `VALIDATION_REPORT.md` 日期差異需先取得可驗證證據或使用者決策；目前不是可自行修正的待辦。
- 未來待辦由新的使用者回饋、實際新格式或 Claude 新版修改觸發；不得自行把暫緩的三系統整併、雲端多人或依賴大升級當成下一個工作。

### 新 GPT 接手後最合理的下一步

先只做交接驗收：核對本機路徑、origin/main、當下 HEAD、`VERSION`、工作區、`VALIDATION_REPORT.md`、GitHub Actions 與帶版號 live 資產，向使用者回報後等待「交接確認完成」。在取得確認前不要修改、發布或開始新功能。

## 19. 交接完整性自我驗收清單

舊 GPT 每次更新本文件後必須逐項確認：

- [ ] 可唯一辨識本系統，不會誤選全日交通量或交通服務水準 Repository。
- [ ] 已記錄當下實際本機路徑、origin、branch、版本與應用基準 commit。
- [ ] 新 GPT 可追出 Excel → parser → validation → record/routes → calculation → UI → export。
- [ ] PCE、尖峰範圍、60 分連續格、DAY/FULL、單位、rounding、方向與缺值規則完整。
- [ ] Parser 格式、未知車種、平假日、橫線／空白、日期與站號陷阱完整。
- [ ] 儲存競態、部署雙路徑、舊資產、快取、缺季、圖軸、車種／PCU等歷史 regression 已保留。
- [ ] 完整風險導向複查規則及 Claude ↔ GPT 流程未被摘要或簡化。
- [ ] 測試結果有版本／commit，通過、略過與未驗證清楚分開。
- [ ] 已知界線與暫緩事項不會被誤當成完成或下一步。
- [ ] 新 GPT 知道未獲使用者「交接確認完成」前不得修改或發布。
- [ ] `git diff` 只有本次有意的交接文件變更，且文件已 commit/push。

完成以上項目後，本文件與當下 Repository 應足以讓看不到舊對話的新 GPT 安全承接下一次 Claude 修改、判定風險、獨立複查、修正、完整回歸、Build、GitHub Pages 發布與 Claude 第二次複查。
