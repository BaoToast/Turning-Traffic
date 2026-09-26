/*
 * ══════════════════════════════════════════════════════════════════════
 *  效能：資料變多的時候，時間要跟著「線性」變多，不可以變成平方
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-23：
 *   「請確保程式性能上不要有 Lag 情況發生，隨著程式越來越完善，
 *     性能方面也很重要，要能順暢跑每一筆資料」
 *   「如果效能上不會有延遲問題，沒做改變也是合理的」
 *   「要注意別因為改善效能，而導致其他功能不能正常使用」
 *
 * ── 這一支守什麼、不守什麼 ──────────────────────────────────
 *
 * ⚠️ **不守絕對毫秒數。** 測試跑在什麼機器上完全不受控，釘一個絕對秒數
 *   只會造成「有時候紅、重跑就綠」——那種測試最後一定會被關掉或加 retry，
 *   等於這一支從此不存在。
 *
 * ✅ **守的是成長的形狀。** 資料量乘以 R 倍時，時間也應該大約乘以 R 倍。
 *   寫成「每一筆都重掃一次全表」的話會乘以 R²——10 倍資料變成 100 倍時間。
 *   這種缺陷在小資料上**完全看不出來**，要等使用者累積了十幾季、
 *   好幾個路口才會突然變慢，而那時候很難回頭找是哪一次改動造成的。
 *
 * ⚠️ 最後那一支是**反證**：刻意寫成平方的函式必須被判紅，
 *   正常的線性寫法必須通過（免得誤殺）。沒有這兩段，門檻訂錯也沒人知道。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCLUSION_METRICS,
  DEFAULT_CONDITION,
  buildConclusion,
  type ConclusionRecord,
  type ConclusionScopeKey,
} from "../lib/conclusion.ts";
import {
  CONCLUSION_META as META,
  makeRecord,
} from "./helpers/conclusion-record.ts";

const SCOPES: ConclusionScopeKey[] = ["AM", "PM", "FULL", "DAY"];

function branch(code: string, name: string, base: number) {
  return {
    code,
    name,
    outboundByVehicleSafe: [
      { label: "機車", count: base * 2 },
      { label: "小型車", count: base },
    ],
    inflowByVehicleSafe: [
      { label: "機車", count: base * 3 },
      { label: "小型車", count: base },
    ],
    twoWayByVehicleSafe: [{ label: "機車", count: base * 5 }],
    directionDisplay: "split" as const,
    inflowPcu: base,
    outflowPcu: base + 7,
    inflowVehicles: base * 4,
    outflowVehicles: base * 4 + 7,
    inflowFullDayVehicles: base * 20,
    outflowFullDayVehicles: base * 20,
  };
}

/** 產生 n 筆「長得像真的」的紀錄：多季 × 多路口 × 四個時段 × 四條支線。 */
function corpus(n: number): ConclusionRecord[] {
  const out: ConclusionRecord[] = [];
  for (let i = 0; i < n; i += 1) {
    const year = 113 + Math.floor(i / 40);
    const record = makeRecord({
      station: `A00T00-${String(i % 10).padStart(2, "0")}`,
      name: `示範路口${i % 10}`,
      quarter: `${year}Q${(i % 4) + 1}`,
      surveyType: i % 2 ? "平日" : "假日",
    });
    for (const scope of SCOPES)
      record.peaks[scope] = {
        window: "07:00–08:00",
        totalPcu: 1000 + (i % 97),
        totalVehicles: 4000 + (i % 89),
        branches: [
          branch("A", "路口A", 100 + (i % 13)),
          branch("B", "路口B", 300 + (i % 17)),
          branch("C", "路口C", 200 + (i % 19)),
          branch("D", "路口D", 150 + (i % 23)),
        ],
      };
    record.compositionByBranch = [
      { code: "A", name: "路口A", items: [{ label: "機車", count: 1111 }] },
      { code: "B", name: "路口B", items: [{ label: "小型車", count: 2222 }] },
    ];
    out.push(record);
  }
  return out;
}

/**
 * 反證只需要一個可分組的站號，不需要建立四時段 × 四支線的完整紀錄。
 *
 * ⚠️ 2026-09-26 複查發現：原本線性反證把 `corpus(300000)` 建了七次，
 * 標準 Node 的 4 GB heap 會先耗盡，讓字面 `npm test` 失敗；這量到的是
 * 測資物件大小，不是線性演算法。維持相同筆數與迴圈，只把無關欄位拿掉。
 */
function stationCorpus(n: number): string[] {
  return Array.from({ length: n }, (_, index) => `A00T00-${index % 10}`);
}

function medianMs(run: () => unknown, times = 5) {
  run();
  run();
  const samples: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const started = process.hrtime.bigint();
    run();
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const RATIO = 10;
const ALLOWED = RATIO * 3; // 線性≈10、平方≈100；30 離兩邊都夠遠

function scaling(
  label: string,
  sizeSmall: number,
  make: (size: number) => () => unknown,
) {
  let base = sizeSmall;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const small = medianMs(make(base));
    const big = medianMs(make(base * RATIO));
    if (small >= 1) {
      const factor = big / small;
      return {
        small,
        big,
        factor,
        ok: factor <= ALLOWED,
        why:
          `${label}：${base} 筆 ${small.toFixed(1)}ms → ` +
          `${base * RATIO} 筆 ${big.toFixed(1)}ms（${factor.toFixed(1)} 倍）`,
      };
    }
    if (attempt === 2)
      return {
        small,
        big,
        factor: big / small,
        ok: true,
        why:
          `${label}：放大到 ${base} 筆仍只花 ${small.toFixed(2)}ms` +
          `（${base * RATIO} 筆 ${big.toFixed(2)}ms）——` +
          "在任何實務資料量下都不可能造成延遲",
      };
    base *= 10;
  }
  throw new Error("unreachable");
}

test("⚠️ 結論草稿（四個時段 × 全部指標）：資料 ×10 時間不可以 ×100", () => {
  const condition = {
    ...DEFAULT_CONDITION,
    scope: { kind: "project" as const },
    peaks: [...SCOPES],
    metrics: CONCLUSION_METRICS.map((metric) => metric.key),
    grouping: "byIntersection" as const,
  };
  const result = scaling("結論草稿", 40, (size) => {
    const records = corpus(size);
    return () => buildConclusion(records, condition, META);
  });
  console.log("  " + result.why);
  assert.ok(
    result.ok,
    `${result.why}\n` +
      `成長倍數超過 ${ALLOWED}——資料量一大就會卡。\n` +
      "常見成因是「對每一筆再掃一次全表」（巢狀迴圈、在迴圈裡 filter／find／indexOf）。",
  );
});

test("⚠️ 這一支真的抓得到平方成長（反證，不然門檻訂錯也沒人知道）", () => {
  const quadratic = (size: number) => {
    const stations = stationCorpus(size);
    return () => {
      let hits = 0;
      for (const station of stations)
        for (const other of stations)
          if (other === station) hits += 1;
      return hits;
    };
  };
  const bad = scaling("刻意寫壞的平方寫法", 1000, quadratic);
  console.log("  （反證）" + bad.why);
  assert.ok(
    !bad.ok,
    `平方寫法竟然通過了（${bad.factor.toFixed(1)} 倍 ≤ ${ALLOWED}）——` +
      "門檻太鬆，這一支守不到任何東西",
  );

  const linear = (size: number) => {
    const stations = stationCorpus(size);
    return () => {
      const byStation = new Map<string, number>();
      for (const station of stations)
        byStation.set(station, (byStation.get(station) || 0) + 1);
      return byStation.size;
    };
  };
  const good = scaling("正常的線性寫法", 30000, linear);
  console.log("  （反證）" + good.why);
  assert.ok(good.ok, `線性寫法被誤判成不合格：${good.why}`);
});
