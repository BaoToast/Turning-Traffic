/*
 * 結論草稿測試共用的樣本紀錄。
 *
 * 原本只長在 conclusion.test.ts 裡；跨系統守門測試也要拿同一份形狀來跑
 * 「換年份寫法只換字」的比對，兩邊各自手捏一份遲早會漂移（少一個欄位就
 * 變成 describePeak 直接丟例外，看起來像功能壞了，其實是測資不完整）。
 * 所以抽到這裡，兩邊都從這一份取。
 */
import {
  type ConclusionMeta,
  type ConclusionRecord,
} from "../../lib/conclusion.ts";

export const CONCLUSION_META: ConclusionMeta = {
  projectName: "測試計畫",
  systemVersion: "v2.1.10",
  generatedAt: "2026-08-23 10:00",
};

export function makeRecord(over: Partial<ConclusionRecord> = {}): ConclusionRecord {
  return {
    id: over.station + "-" + over.quarter,
    intersectionKey: "K1",
    station: "T15-01",
    name: "中山北路－岡山路口",
    quarter: "115Q2",
    surveyType: "平日",
    routeless: false,
    compositionScope: "全調查時段",
    compositionUnit: "輛/調查時段",
    composition: [
      { label: "機車", count: 4131 },
      { label: "小型車", count: 1766 },
      { label: "大型車", count: 90 },
    ],
    peaks: {
      AM: {
        window: "07:15–08:15",
        totalPcu: 1000,
        totalVehicles: 6012,
        branches: [
          {
            name: "路口A",
            outboundByVehicleSafe: [
              { label: "機車", count: 3000 },
              { label: "小型車", count: 1200 },
            ],
            inflowByVehicleSafe: [
              { label: "機車", count: 3400 },
              { label: "小型車", count: 1100 },
            ],
            twoWayByVehicleSafe: [
              { label: "機車", count: 6400 },
              { label: "小型車", count: 2300 },
            ],
            directionDisplay: "split",
            inflowPcu: 400,
            outflowPcu: 380,
            inflowVehicles: 741,
            outflowVehicles: 556,
            inflowFullDayVehicles: 12000,
            outflowFullDayVehicles: 11800,
          },
          {
            name: "路口B",
            outboundByVehicleSafe: null,
            inflowByVehicleSafe: null,
            twoWayByVehicleSafe: null,
            directionDisplay: "split",
            inflowPcu: 600,
            outflowPcu: 620,
            inflowVehicles: 548,
            outflowVehicles: 1969,
            inflowFullDayVehicles: null,
            outflowFullDayVehicles: null,
          },
        ],
      },
      PM: {
        window: "17:00–18:00",
        totalPcu: 1200,
        totalVehicles: 6500,
        branches: [
          {
            name: "路口A",
            outboundByVehicleSafe: null,
            inflowByVehicleSafe: null,
            twoWayByVehicleSafe: null,
            directionDisplay: "split",
            inflowPcu: 500,
            outflowPcu: 490,
            inflowVehicles: 852,
            outflowVehicles: 853,
            inflowFullDayVehicles: null,
            outflowFullDayVehicles: null,
          },
          {
            name: "路口B",
            outboundByVehicleSafe: null,
            inflowByVehicleSafe: null,
            twoWayByVehicleSafe: null,
            directionDisplay: "split",
            inflowPcu: 700,
            outflowPcu: 710,
            inflowVehicles: 1381,
            outflowVehicles: 686,
            inflowFullDayVehicles: null,
            outflowFullDayVehicles: null,
          },
        ],
      },
    },
    ...over,
  } as ConclusionRecord;
}
