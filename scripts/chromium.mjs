import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 尋找本機可用的 Chromium/Chrome/Edge。
 * CI 可用 PLAYWRIGHT_CHROMIUM_EXECUTABLE 指定，開發者電腦則依常見位置尋找；
 * 都找不到時交回 Playwright 使用自己的瀏覽器安裝。
 */
export function chromiumLaunchOptions(extra = {}) {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : "",
    process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe")
      : "",
    process.env["PROGRAMFILES(X86)"]
      ? join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe")
      : "",
    process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe")
      : "",
  ].filter(Boolean);
  const executablePath = candidates.find((candidate) => existsSync(candidate));
  return {
    ...extra,
    ...(executablePath ? { executablePath } : {}),
    args: [...(extra.args || []), "--no-sandbox"],
  };
}
