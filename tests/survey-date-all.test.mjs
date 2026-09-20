/*
 * findAllSurveyDates：三支共用契約（案例表 tests/survey-date-contract.mjs 逐位元相同）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { findAllSurveyDates, findSurveyDate } from "../lib/period-date.ts";
import { checkSurveyDateContract } from "./survey-date-contract.mjs";

test("findAllSurveyDates 符合三支共用契約", () => {
  checkSurveyDateContract(findAllSurveyDates, findSurveyDate, (label, ok, detail) => {
    assert.ok(ok, `${label} — ${detail}`);
  });
});
