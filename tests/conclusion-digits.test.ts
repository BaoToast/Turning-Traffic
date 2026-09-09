/*
 * 結論草稿的「小數位數」必須真的管到百分比。
 *
 * 起因（使用者在全日交通量實測回報，三支系統寫法相同、毛病也相同）：
 * 小數位數選 2 位，產生出來的百分比還是 1 位。
 * 原因是 pct() 的 digits 參數有預設值 1，而所有呼叫端都沒有傳。
 *
 * ⚠️ 假通過陷阱：只驗「digits=2 時字串裡出現兩位小數」不夠——
 *    PCU 走 num() 本來就會有兩位小數，整段字串一定會通過。
 *    所以下面只把百分比那一段抓出來比對。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONDITION,
  buildConclusion,
  type ConclusionMetricKey,
} from "../lib/conclusion.ts";
import {
  CONCLUSION_META as META,
  makeRecord,
} from "./helpers/conclusion-record.ts";

const RECORDS = [makeRecord({ quarter: "115Q2" })];

/** 只把百分比抓出來，避免被 PCU 的小數位數混淆。 */
function percentages(text: string) {
  return [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].map((match) => match[1]);
}

function decimalsOf(value: string) {
  return value.includes(".") ? value.split(".")[1].length : 0;
}

test("結論草稿的百分比要跟著「小數位數」走", () => {
  const metrics: ConclusionMetricKey[] = [
    "total",
    "shareIn",
    "shareOut",
    "composition",
  ];
  for (const digits of [0, 1, 2]) {
    const text = buildConclusion(
      RECORDS,
      { ...DEFAULT_CONDITION, digits, metrics },
      META,
    );
    const values = percentages(text);
    assert.ok(values.length > 0, `digits=${digits} 應該要有百分比可以檢查`);
    for (const value of values)
      assert.equal(
        decimalsOf(value),
        digits,
        `小數位數選 ${digits} 位，百分比卻印成 ${value}%`,
      );
  }
});

test("跨季度變動幅度的百分比也要跟著走", () => {
  const records = [
    makeRecord({ quarter: "114Q4" }),
    makeRecord({ quarter: "115Q2" }),
  ];
  for (const digits of [0, 2]) {
    const text = buildConclusion(
      records,
      {
        ...DEFAULT_CONDITION,
        digits,
        metrics: ["total", "growth"] as ConclusionMetricKey[],
      },
      META,
    );
    for (const value of percentages(text))
      assert.equal(
        decimalsOf(value),
        digits,
        `小數位數選 ${digits} 位，變動幅度卻印成 ${value}%`,
      );
  }
});
