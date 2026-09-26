import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("preview 轉正式紀錄時必須保留逐格 lengthMinutes", async () => {
  const source = await readFile(new URL("../app/traffic-app.tsx", import.meta.url), "utf8");
  const start = source.indexOf("sourceIntervals:");
  const end = source.indexOf("survey:", start);
  assert.ok(start >= 0 && end > start, "找不到 preview → sourceIntervals 的正式儲存路徑");
  const mapping = source.slice(start, end);
  assert.match(mapping, /lengthMinutes:\s*row\.lengthMinutes/);
});
