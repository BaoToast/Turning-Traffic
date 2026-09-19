/*
 * 試用版（單一 .html）專用的建置設定。
 *
 * 使用者測試時拿到的是**一個檔案**：不必架伺服器、不必解壓縮，
 * 點兩下就用瀏覽器開起來。所以這一份要把所有 JS 與 CSS 都塞進 HTML 裡。
 *
 * ⚠️ 與正式發布的 vite.github.config.ts **分開**，不可以改那一份：
 *   正式網站要的是分檔＋雜湊檔名（可快取、可增量更新），單檔版剛好相反。
 *   兩種需求塞進同一份設定，遲早有一邊被改壞。
 *
 * ⚠️ outDir 也要分開（.tryout），不可以寫成 github-pages-dist——
 *   端對端測試是直接吃那個目錄的，建試用版時把它清掉的話，
 *   測試會在無關的地方紅字。
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "github",
  base: "./",
  plugins: [react()],
  publicDir: "../public",
  build: {
    outDir: "../.tryout",
    emptyOutDir: true,
    /* 樣式不要切檔，才能整段內嵌。 */
    cssCodeSplit: false,
    /* 圖示等小檔一律轉成 data URI。 */
    assetsInlineLimit: 10 * 1024 * 1024,
    rollupOptions: {
      output: {
        /*
         * ⚠️ 動態 import 的分塊要合併回主檔。
         *   不合併的話，單檔版在 file:// 下會去抓不存在的 ./assets/xxx.js，
         *   而畫面**不會報錯**——只有按到匯出 Excel 時才整個沒反應。
         */
        inlineDynamicImports: true,
      },
    },
  },
});
