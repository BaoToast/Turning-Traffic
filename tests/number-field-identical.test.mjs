/*
 * NumberField 的逐位元守門（詳見 tests/number-field-contract.mjs）。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NUMBER_FIELD_SHA256 } from "./number-field-contract.mjs";

test("lib/number-field.tsx 與契約寫死的雜湊相同", async () => {
  const bytes = await readFile(
    new URL("../lib/number-field.tsx", import.meta.url),
  );
  const actual = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    actual,
    NUMBER_FIELD_SHA256,
    "共用元件被改過。兩支程式要一起改，並同步更新 tests/number-field-contract.mjs 的雜湊。",
  );
});
