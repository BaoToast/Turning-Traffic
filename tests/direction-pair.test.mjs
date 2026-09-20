/*
 * 方向名稱成對判定：與姊妹專案共用同一套規則。
 * ⚠️ app/direction-pair.ts 與路口轉向的 lib/direction-pair.ts **逐位元相同**，
 *   案例表 tests/direction-pair-contract.mjs 三支也逐位元相同。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  bearingOf,
  judgeDirectionPair,
  directionPairMessage,
} from "../lib/direction-pair.ts";
import { checkDirectionPairContract } from "./direction-pair-contract.mjs";

test("方向成對判定符合三支共用契約", () => {
  checkDirectionPairContract(judgeDirectionPair, (label, ok, detail) => {
    assert.ok(ok, `${label} — ${detail}`);
  });
});

test("bearingOf 只認整串像方位詞的名稱（地名不可以誤判）", () => {
  assert.equal(bearingOf("北上"), "北");
  assert.equal(bearingOf("東北"), "東北");
  assert.equal(bearingOf("往西"), "西");
  /* ⚠️ 這三條是防誤報的，拿掉的話「往台北／往高雄」會被報成異常。 */
  assert.equal(bearingOf("往台北"), null);
  assert.equal(bearingOf("北屯路"), null);
  assert.equal(bearingOf("南投端"), null);
});

test("訊息要寫出原名稱與期望的方位", () => {
  const message = directionPairMessage(
    "北上",
    "西行",
    judgeDirectionPair("北上", "西行"),
  );
  for (const needle of ["北上", "西行", "南"])
    assert.ok(message.includes(needle), `訊息少了「${needle}」：${message}`);
});
