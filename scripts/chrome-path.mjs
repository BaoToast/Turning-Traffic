/*
 * 找出這台電腦上可以用的 Chromium / Chrome / Edge。
 *
 * 為什麼需要這一支：所有端對端腳本與手冊 PDF 產生器原本都寫死
 * `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`——那是**開發容器裡的
 * 路徑**。交付包換到另一台電腦時那個檔案不存在，腳本會直接丟錯，
 * 而備份包的意義就是要能在別台電腦完整重建與驗證。
 *
 * 尋找順序（第一個存在的就用）：
 *  1. 環境變數 CHROME_PATH 或 PLAYWRIGHT_CHROMIUM_EXECUTABLE
 *     （CI 或要指定特定瀏覽器時用）
 *  2. 開發容器的固定路徑
 *  3. Windows 上常見的 Chrome / Edge 安裝位置
 *  4. macOS 上的 Chrome
 *  5. Linux 上的常見安裝位置
 *  6. 都找不到 → 回傳 undefined，交回 Playwright 用它自己安裝的瀏覽器
 *     （`npx playwright install chromium`）
 *
 * 第 3～5 點的清單來自外部複核的建議：多數使用者是在 Windows 上打開這個
 * 備份包，本機已經有 Chrome 或 Edge 時就不必再另外下載一份瀏覽器。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const CONTAINER_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

function candidates() {
  const windows = [
    [process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"],
    [process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"],
    [process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"],
    [process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"],
    [process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"],
  ]
    .filter((parts) => parts[0])
    .map((parts) => join(...parts));
  return [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    CONTAINER_CHROME,
    ...windows,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
}

export function chromePath() {
  return candidates().find((candidate) => existsSync(candidate));
}

/**
 * 直接展開成 chromium.launch() 的參數。
 * 找不到瀏覽器時**不放** executablePath 這個鍵（而不是放一個 undefined），
 * Playwright 才會用自己安裝的那一份。
 */
export function launchOptions(extra = {}) {
  const executablePath = chromePath();
  return {
    ...extra,
    ...(executablePath ? { executablePath } : {}),
    args: [...(extra.args || []), "--no-sandbox"],
    /*
     * 一定要給瀏覽器一個 UTF-8 的地區設定。
     *
     * 精簡型容器的 LANG 是空的，Chromium 會依此把下載檔名裡的非 ASCII
     * 字元全部濾掉；中文檔名濾完就變成空字串，檔案一律存成 "download"。
     * 這是**測試環境**的假象（使用者自己電腦上的 Chrome／Edge 沒這問題），
     * 但若不設定，端對端測試會誤報「程式的檔名壞掉」，或反過來讓真的
     * 壞掉的檔名被當成環境問題忽略掉。
     */
    env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", ...(extra.env || {}) },
  };
}
