/*
 * ══════════════════════════════════════════════════════════════════════
 *  端對端共用：把主工具列展開
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ X-78（使用者 2026-09-17）之後，主工具列**一開機是收合的**。
 *   收合時那一排條件是隱藏的，Playwright 的 selectOption／fill 會一直等它
 *   變成可見，最後逾時——**那不是程式壞了，是測試還停在「預設展開」的世界**。
 *   凡是要動主工具列欄位的端對端，載入之後先呼叫這一支。
 *
 * ⚠️ 不可以改成「直接把隱藏屬性拿掉」之類的繞道：那樣量到的就不是使用者
 *   按得到的狀態了。這裡走的是**跟使用者一樣的那顆鈕**。
 * ⚠️ 也不可以無條件點一下就走：已經展開時點下去會**收合**，
 *   後面整支反而全部逾時。所以先讀 aria-expanded。
 */
export async function ensureToolbarOpen(page) {
  const toggle = page.locator('[data-testid="mt-toggle"]');
  if (!(await toggle.count())) return false;
  if ((await toggle.first().getAttribute("aria-expanded")) === "true")
    return true;
  await toggle.first().click();
  await page.waitForTimeout(350);
  return (await toggle.first().getAttribute("aria-expanded")) === "true";
}
