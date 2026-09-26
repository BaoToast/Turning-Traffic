/*
 * 報表文字草稿測試共用的「欄位全滿」情境。
 *
 * ⚠️ 抽到這裡的理由與 conclusion-record 一樣：兩個測試檔各捏一份遲早會漂移，
 *   而**缺一個欄位就會讓 sectionLines 直接丟例外**，看起來像功能壞了，
 *   實際上是測資不完整。全覆蓋盤點（conclusion-coverage）尤其吃這一點：
 *   它要能區分「段落接在空的地方」與「我的測資漏了欄位」。
 */
import { type ReportDraftContext } from "../../lib/report-draft.ts";

export function context(overrides: Partial<ReportDraftContext> = {}): ReportDraftContext {
  return {
    projectName: "測試計畫",
    quarterRange: "115Q1～115Q4",
    quarterCount: 4,
    intersectionCount: 2,
    recordCount: 8,
    focusLabel: "中正路口（115Q4、平日）",
    peaks: { am: "07:30–08:30", pm: "17:15–18:15" },
    siteOmitted: 0,
    routelessRecords: 0,
    siteSummaries: [
      {
        name: "中正路口 115Q4（平日）",
        peaks: [
          {
            label: "上午尖峰",
            hour: "07:30–08:30",
            total: 2900.6,
            unit: "PCU/hr",
            arms: [
              { name: "路口A", outbound: 1200.5, inbound: 1000.6 },
              { name: "路口B", outbound: 900.1, inbound: 1100 },
            ],
            vehicles: [
              { label: "機車", share: 52.1 },
              { label: "小型車", share: 39.1 },
            ],
          },
          {
            label: "下午尖峰",
            hour: "17:15–18:15",
            total: 2720.9,
            unit: "PCU/hr",
            arms: [{ name: "路口A", outbound: 1100.2, inbound: 990.9 }],
            vehicles: [],
          },
          /*
           * ⚠️ 這兩個範圍是 2026-09-23 補的，補的理由是一個真的缺陷：
           *   v2.1.82 把 siteSummaries 由 3 個尖峰擴成 4 個統計範圍，
           *   但測資只有兩個**而且都沒有 unit**，於是草稿一律走
           *   `peak.unit || "PCU/hr"` 的退路——
           *   「全調查時段」會標成 PCU/hr 這件事，測資根本碰不到。
           *   測資不含會出事的那一種資料，測試就只是在確認 happy path。
           */
          {
            label: "全調查時段",
            hour: "07:00–19:00",
            total: 28450.3,
            /* 累計量，不是流率——單位一定要和上面三個不一樣。 */
            unit: "PCU/調查時段",
            arms: [{ name: "路口A", outbound: 14500.1, inbound: 13950.2 }],
            vehicles: [
              { label: "機車", share: 50.4 },
              { label: "小型車", share: 40.2 },
            ],
          },
          {
            label: "全調查時段尖峰",
            hour: "08:00–09:00",
            total: 3010.7,
            unit: "PCU/hr",
            arms: [{ name: "路口A", outbound: 1550.3, inbound: 1460.4 }],
            vehicles: [],
          },
        ],
      },
    ],
    outbound: [
      { name: "路口A", am: 1200.5, pm: 1100.2 },
      { name: "路口B", am: 900.1, pm: 880.4 },
      { name: "路口C", am: 500, pm: 460.3 },
      { name: "路口D", am: 300, pm: 280 },
    ],
    inbound: [
      { name: "路口B", am: 1100, pm: 1050 },
      { name: "路口A", am: 1000.6, pm: 990.9 },
      { name: "路口C", am: 500, pm: 400 },
      { name: "路口D", am: 300, pm: 280 },
    ],
    totals: { am: 2900.6, pm: 2720.9 },
    flowTotals: {
      outboundAm: 2900.6,
      outboundPm: 2720.9,
      inboundAm: 2900.6,
      inboundPm: 2720.9,
    },
    vehicles: [
      { label: "機車", count: 12000, share: 52.1 },
      { label: "小型車", count: 9000, share: 39.1 },
    ],
    compositionScope: "全調查時段",
    compositionUnit: "輛/調查時段",
    trend: [
      { quarter: "115Q3", am: 2500, pm: 2400 },
      { quarter: "115Q4", am: 2900.6, pm: 2720.9 },
    ],
    trendLabel: "中正路口／平日",
    compare: [
      { name: "中正路口 115Q4（平日）", am: 2900.6, pm: 2720.9 },
      { name: "民生路口 115Q4（平日）", am: 1800, pm: 1750 },
    ],
    compareIntersections: 2,
    topFlow: {
      station: "T-01 115Q4",
      /*
       * ⚠️ 2026-09-23 起這裡放的是**顯示名稱**（畫面端傳 SCOPE_SHORT_LABELS），
       *   不是內部鍵值 "AM"／"DAY"。舊測資放鍵值，剛好掩蓋了
       *   「草稿會印出『DAY 尖峰』」這個缺陷。
       */
      peak: "AM 尖峰",
      from: "路口A",
      to: "路口C",
      pcu: 640.5,
    },
    worstBalance: {
      station: "T-01 115Q4",
      /* ⚠️ 同上：顯示名稱。 */
      peak: "AM 尖峰",
      name: "路口B",
      difference: 0,
    },
    conservation: { checked: 16, passed: 16 },
    quality: { total: 0, errors: 0, warnings: 0, topCategories: [] },
    factors: [
      { label: "機車", left: 0.5, through: 0.3, right: 0.4 },
      { label: "小型車", left: 1.5, through: 1, right: 1.3 },
    ],
    factorMatrixCount: 1,
    ...overrides,
  };
}
