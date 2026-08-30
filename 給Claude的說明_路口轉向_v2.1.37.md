# 給 Claude 的說明：Turning Traffic v2.1.37

日期：2026-08-30

## 複查結論

你在 v2.1.36 修正的主要問題成立，而且修法正確，我已完整保留：

- 摘要車輛數改回 `row.vehicle`，與轉向圖同源。
- 單一車種 PCU 繼續用實際 OD、車種與轉向當量逐筆計算。
- 來源不一致時顯示警告與原因。
- v2.1.35 的實際 OD 拆解及曆日驗證沒有被回退。

## GPT 額外找到並修正的問題

### 1. 各車種差異會互相抵銷

v2.1.36 的車輛數對帳只比較：

```text
所有 OD 車種數總和 vs 所有 row.vehicle 車種數總和
```

這會漏掉「總數相同、車種分配不同」的狀況。例如：

| 來源 | 機車 | 小型車 | 合計 |
| --- | ---: | ---: | ---: |
| `row.vehicle` | 17 | 3 | 20 |
| OD | 10 | 10 | 20 |

若兩車種當量配置剛好使總 PCU 也相同，v2.1.36 會把 `reconciled` 判成 `true`；但同一車種的「輛數」與「PCU」其實來自不同分配，摘要仍不可靠。

v2.1.37 改為逐車種比較 `row.vehicle[id]` 與 OD 車種數，每一車種各自使用既有的 `max(5 輛, rowCount × 5%)` 容差。警告會列出車種、逐條流向數與各車種數；PCU 與車輛數若同時不一致，兩個原因會完整並列。

新增守門測試：`各車種差異互相抵銷時仍要警告，不能只核對全部車種總數`。此測試在原 v2.1.36 會失敗，修正後通過。

### 2. 乾淨環境的 Cloudflare 型別缺件

原始碼引用 `cloudflare:workers`、`Fetcher` 與 `D1Database`，但乾淨 `npm ci` 後執行 `tsc --noEmit` 會出現 3 個型別錯誤。v2.1.37：

- 加入與現有 `@cloudflare/vite-plugin 1.54.0` 相符的 `@cloudflare/workers-types 5.20260825.1`。
- `tsconfig.json` 明確載入該型別。
- 新增 `worker-configuration.d.ts`，只宣告程式實際使用的 `DB` 綁定。

這只補足原始碼驗證能力，不會改變 GitHub Pages 的執行內容或交通計算。

## 請你複查的重點

1. `pcuBreakdown()` 的 `count` 是否仍與轉向圖同讀 `row.vehicle`。
2. 單一車種 PCU 是否仍只依實際 OD 與轉向當量計算。
3. 各車種差異互相抵銷時，`reconciled` 是否確實為 `false`。
4. `row.vehicle` 完全不存在的舊備份是否仍可退回 OD 數量。
5. PCU 與車輛數同時不一致時，`reason` 是否保留兩個原因。
6. Cloudflare 型別補件是否只影響開發驗證，沒有改變靜態網站 bundle 的功能。
7. `LAST_CALC_CHANGE_VERSION` 應繼續是 `v2.1.30`。

## GPT 完成的驗證

- ESLint：0 error。
- TypeScript：0 error。
- MJS：45/45。
- TypeScript tests：173/173。
- 瀏覽器 E2E：364 項全過、0 JS 例外。
- 640–1920px 多寬度排版：全過。
- v2.1.37 Word 34 頁與 PDF 50 頁：逐頁檢查無裁切、重疊或頁尾超界。
- SheetJS：0.20.3。

本版沒有更改尖峰時段、OD、PCU、車種當量或多岔路流向分類的既定計算規則。
