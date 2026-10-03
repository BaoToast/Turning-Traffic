import test from "node:test";
import assert from "node:assert/strict";
import { findSurveyReplacement, plannedSurveyOverwrites } from "../lib/import-overwrite.ts";

const context = { projectId: "P", quarter: "115Q2" };
const record = (surveyType: string, id: string) => ({ ...context, station: "T0-01", surveyType, id });
test("日期/鎖定把關只計真正寫入的對象，略過不列入", () => {
  const records = [record("平日", "old")];
  const items = [{ station: "T0-01", surveyType: "平日" }];
  assert.deepEqual(plannedSurveyOverwrites(records, items, context, () => "skip"), []);
  assert.equal(plannedSurveyOverwrites(records, items, context, () => "version")[0].record, records[0]);
});
test("exact 優先，不能把旁邊待設定舊紀錄也說成會被覆蓋", () => {
  const records = [record("待設定", "pending"), record("平日", "weekday")];
  const items = [{ station: "T0-01", surveyType: "平日" }];
  assert.equal(findSurveyReplacement(records, items[0], context), 1);
  assert.deepEqual(plannedSurveyOverwrites(records, items, context, () => "overwrite").map((pair) => pair.record.id), ["weekday"]);
});
test("模擬批次順序：待設定只能被第一份有資料別的檔案接手，不改原資料", () => {
  const records = [record("待設定", "pending")];
  const before = JSON.stringify(records);
  const items = [{ station: "T0-01", surveyType: "平日" }, { station: "T0-01", surveyType: "假日" }];
  const plan = plannedSurveyOverwrites(records, items, context, () => "overwrite");
  assert.equal(plan.length, 1);
  assert.equal(plan[0].incoming, items[0]);
  assert.equal(JSON.stringify(records), before);
});
test("不同計畫/季度/資料別與未存在紀錄不覆蓋；未知資料別不能倒蓋平日", () => {
  const item = { station: "T0-01", surveyType: "待設定" };
  const records = [record("平日", "known"), { ...record("待設定", "other"), quarter: "115Q1" }];
  assert.equal(findSurveyReplacement(records, item, context), -1);
  assert.deepEqual(plannedSurveyOverwrites(records, [item], context, () => "overwrite"), []);
});
