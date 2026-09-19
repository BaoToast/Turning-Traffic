/*
 * ══════════════════════════════════════════════════════════════════════
 *  橫跨中午的尖峰小時：程式不自己決定，問使用者
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12（他一度要求上午／下午可自行設定，討論後自己收回）：
 *   「回歸以前作法，不確定時，就是跳出視窗詢問使用者。」
 *   「如果有15分鐘滾動去計算1小時的當量時，其實也會遇到，真的有這個類型的
 *     時段發生時(11:15~12:15之類)，就跳出詢問視窗。」
 *   四個選項：1.取消不匯入 2.忽略這個時段 3.算上午 4.算下午
 *
 * 與全日交通量是**同一套語意**，兩支程式的測資與期望值刻意造成一樣的形狀，
 * 日後任何一支改了口徑，另一支的測試會立刻看得出差異。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  NOON_MINUTES,
  PEAK_RANGES,
  noonStraddle,
  peakWindowsFor,
} from "../lib/traffic.ts";

/*
 * 15 分鐘一格的一整天。每格的值（只有一欄，權重 1，所以值就是 PCU）：
 *   11:45            → 100
 *   12:00/12:15/12:30 → 各 900
 *   07:00～08:00 四格 → 各 200
 *   17:00～18:00 四格 → 各 220
 *   其餘             → 5
 * 手算：
 *   跨中午的 11:45–12:45 ＝ 100＋900×3 ＝ 2800（全天最忙）
 *   AM（整個視窗在 12:00 以前）最忙 ＝ 07:00–08:00 ＝ 800
 *     （11:00–12:00 只有 5＋5＋5＋100 ＝ 115）
 *   PM（整個視窗在 12:00 以後）最忙 ＝ 12:00–13:00 ＝ 900×3＋5 ＝ 2705
 */
const valueAt = (minutes: number) => {
  if (minutes === 11 * 60 + 45) return 100;
  if (minutes >= 12 * 60 && minutes < 12 * 60 + 45) return 900;
  if (minutes >= 7 * 60 && minutes < 8 * 60) return 200;
  if (minutes >= 17 * 60 && minutes < 18 * 60) return 220;
  return 5;
};
const pad = (n: number) => String(n).padStart(2, "0");
const rows = Array.from({ length: (24 * 60) / 15 }, (_unused, index) => {
  const start = index * 15;
  return {
    start,
    label: `${pad(Math.floor(start / 60))}:${pad(start % 60)}`,
    values: [valueAt(start)],
  };
});

test("① 分界固定在 12:00，而且與既有的 PEAK_RANGES 一致", () => {
  assert.equal(NOON_MINUTES, 720);
  assert.deepEqual(PEAK_RANGES.AM, [0, 720]);
  assert.deepEqual(PEAK_RANGES.PM, [720, 1440]);
});

test("⚠️ ② 跨中午而且是全天最忙的一小時，要被挑出來問", () => {
  const info = noonStraddle(rows, 15);
  assert.ok(info, "沒有挑出來——這個情況會被安靜地略過");
  assert.equal(info.window.start, 11 * 60 + 45);
  assert.equal(info.window.end, 12 * 60 + 45);
  // 手算：100＋900＋900＋900 ＝ 2800
  assert.equal(info.window.total, 2800);
  // 不算它的話 AM 是 07:00–08:00（800）、PM 是 12:00–13:00（2705）
  assert.equal(info.amBest?.start, 7 * 60);
  assert.equal(info.amBest?.total, 800);
  assert.equal(info.pmBest?.start, 12 * 60);
  assert.equal(info.pmBest?.total, 2705);
});

test("⚠️ ③ 沒有決定時，結果與 v2.1.67 以前逐格相同", () => {
  const windows = peakWindowsFor(rows, 15, undefined, 24 * 60);
  assert.equal(windows.AM?.start, 7 * 60);
  assert.equal(windows.AM?.total, 800);
  assert.equal(windows.PM?.start, 12 * 60);
  assert.equal(windows.PM?.total, 2705);
  /*
   * 全調查時段尖峰**本來就抓得到**那一小時（它沒有上午／下午的限制），
   * 所以是 2800。三個數字並排時 AM 800／PM 2705／DAY 2800 就很奇怪——
   * 那正是「AM 少報了」最容易被看穿的地方。
   */
  assert.equal(windows.DAY?.total, 2800);
});

test("⚠️ ③ 選「忽略」與沒有決定完全相同", () => {
  const ignored = peakWindowsFor(rows, 15, undefined, 24 * 60, "ignore");
  const none = peakWindowsFor(rows, 15, undefined, 24 * 60);
  assert.deepEqual(ignored, none);
});

test("⚠️ ④ 選「算上午」：AM 換成那一小時，而且 PM 要跳開它", () => {
  const windows = peakWindowsFor(rows, 15, undefined, 24 * 60, "am");
  assert.equal(windows.AM?.start, 11 * 60 + 45);
  assert.equal(windows.AM?.total, 2800);
  /*
   * ⚠️ 這一條是整個功能最重要的：PM 不可以再挑 12:00–13:00。
   *   12:00～12:45 那三格的車已經算進 AM 了，再挑一次就是同一批車出現在
   *   兩個尖峰裡——兩個數字各自看都對，放在一起是重複計算。
   *   手算：12:45 之後最忙的一小時是 17:00–18:00 ＝ 220×4 ＝ 880。
   */
  assert.equal(windows.PM?.start, 17 * 60);
  assert.equal(windows.PM?.total, 880);
});

test("⚠️ ④ 選「算下午」：PM 換成那一小時，AM 維持 07:00–08:00", () => {
  const windows = peakWindowsFor(rows, 15, undefined, 24 * 60, "pm");
  assert.equal(windows.PM?.start, 11 * 60 + 45);
  assert.equal(windows.PM?.total, 2800);
  assert.equal(windows.AM?.start, 7 * 60);
  assert.equal(windows.AM?.total, 800);
});

test("⑤ 全調查時段尖峰完全不受決定影響", () => {
  const none = peakWindowsFor(rows, 15, undefined, 24 * 60);
  for (const side of ["am", "pm", "ignore"] as const)
    assert.deepEqual(
      peakWindowsFor(rows, 15, undefined, 24 * 60, side).DAY,
      none.DAY,
    );
});

test("⚠️ ⑤ 跨中午但不是全天最忙 → 不要問（問了也不會改變任何數字）", () => {
  const quiet = rows.map((row) =>
    row.start >= 11 * 60 + 45 && row.start < 12 * 60 + 45
      ? { ...row, values: [50] }
      : row,
  );
  assert.equal(noonStraddle(quiet, 15), null);
});

test("⑤ 每小時一格、整點對齊的資料不會問（這是絕大多數真實檔）", () => {
  const hourly = Array.from({ length: 24 }, (_unused, hour) => ({
    start: hour * 60,
    label: `${pad(hour)}:00`,
    values: [hour === 8 ? 900 : hour === 17 ? 1000 : 50],
  }));
  /*
   * 每小時一格時 rollingPeak 走「取最大的那一格」那條路（見它的 intervalMinutes
   * >= windowMinutes 分支），視窗永遠與格子同起訖，不可能跨中午。
   */
  assert.equal(noonStraddle(hourly, 60), null);
  const windows = peakWindowsFor(hourly, 60, undefined, 24 * 60);
  assert.equal(windows.AM?.start, 8 * 60);
  assert.equal(windows.PM?.start, 17 * 60);
});
