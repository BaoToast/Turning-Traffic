import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const clean = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
function declarations(text, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = clean(text).match(new RegExp("(?:^|\\n)" + escaped + "\\s*\\{([^}]+)\\}"));
  assert.ok(block, `Missing rule: ${selector}`);
  return block[1];
}
function requireRail(text) {
  assert.match(declarations(text, ".segmented"), /\bflex\s*:\s*none\s*;/);
  assert.match(declarations(text, ".segmented button"), /white-space\s*:\s*nowrap\s*;/);
}
test("共用切換器的防壓縮與文字不折行規則必須實際存在，不能只寫註解", () => {
  requireRail(css);
});
test("反證：刪除共用 flex:none 後必須被拒絕，即使 advanced-controls 可換行", () => {
  const broken = css.replace(/(\.segmented\s*\{[\s\S]*?)flex:\s*none\s*;/, "$1");
  assert.notEqual(broken, css);
  assert.throws(() => requireRail(broken));
});
test("控制列 row-gap 必須在 gap 簡寫之後，避免 12px 被 18px 覆蓋", () => {
  const block = declarations(css, ".advanced-controls");
  assert.match(block, /flex-wrap\s*:\s*wrap\s*;/);
  assert.match(block, /gap\s*:\s*18px\s*;[\s\S]*row-gap\s*:\s*12px\s*;/);
});
