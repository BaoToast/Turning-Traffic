import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
const patched = (version) => {
  const parts = version.split(".").map(Number);
  assert.ok(parts.length === 3 && parts.every(Number.isInteger), "Invalid version");
  assert.ok(parts[0] > 3 || (parts[0] === 3 && (parts[1] > 4 || (parts[1] === 4 && parts[2] >= 16))),
    "DOMPurify must include GHSA-p98j-92pf-mc4p patch");
};
test("DOMPurify 鎖定版本、實際安裝與送往瀏覽器的資產必須一致且已修補", () => {
  const dependency = lock.packages["node_modules/dompurify"];
  patched(dependency.version);
  const installed = JSON.parse(readFileSync(new URL("node_modules/dompurify/package.json", root), "utf8"));
  assert.equal(installed.version, dependency.version);
  const assets = readdirSync(new URL("assets/", root)).filter((name) => /^purify\.es-.*\.js$/.test(name));
  assert.equal(assets.length, 1);
  const bundled = readFileSync(new URL("assets/" + assets[0], root), "utf8");
  assert.ok(bundled.includes(dependency.version), "Root Pages asset must match patched dependency");
  assert.ok(!bundled.includes("3.4.14"), "Old vulnerable asset must not remain");
});
test("反證：原有 3.4.14 與公告範圍末端 3.4.15 都不能被當成修補版", () => {
  assert.throws(() => patched("3.4.14"));
  assert.throws(() => patched("3.4.15"));
  patched("3.4.16");
});
