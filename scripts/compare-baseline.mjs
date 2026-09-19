/*
 * 逐格比對兩份數字基準（見 capture-baseline.mjs 的說明）。
 *
 * ⚠️ 這一支要能**同時抓到三種**變化，少一種就會放行錯誤：
 *   ① 某一格的數字變了
 *   ② 某一格整格不見了（或多出來）
 *   ③ 數字沒變但**換了位置**（兩欄對調）——只比「一串數字」是抓不到的
 *
 * 用法：node scripts/compare-baseline.mjs 升級前 升級後
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "..", "baseline");
const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error("用法：node scripts/compare-baseline.mjs <基準A> <基準B>");
  process.exit(2);
}
const load = (tag) => {
  const file = join(dir, `g2164-${tag}.json`);
  if (!existsSync(file)) {
    console.error(`找不到 ${file}`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(file, "utf8"));
};
const before = load(a);
const after = load(b);

const problems = [];
const pages = new Set([
  ...Object.keys(before.pages),
  ...Object.keys(after.pages),
]);
let compared = 0;
for (const page of [...pages].sort()) {
  const left = before.pages[page];
  const right = after.pages[page];
  if (!left || !right) {
    problems.push(`【${page}】整頁只出現在其中一份基準裡`);
    continue;
  }
  /* 以「位置」為鍵比對，位置換了也抓得到。 */
  const map = (list) => {
    const out = new Map();
    for (const cell of list) {
      const key = cell.at;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(cell);
    }
    return out;
  };
  const L = map(left);
  const R = map(right);
  const keys = new Set([...L.keys(), ...R.keys()]);
  for (const key of keys) {
    const lc = (L.get(key) || []).map((c) => c.numbers.join(",")).join(" / ");
    const rc = (R.get(key) || []).map((c) => c.numbers.join(",")).join(" / ");
    compared += 1;
    if (lc === rc) continue;
    const sample = (L.get(key) || R.get(key) || [])[0];
    problems.push(
      `【${page}】${key}\n      前：${lc || "(沒有這一格)"}\n      後：${rc || "(沒有這一格)"}\n      文字：${(sample?.text || "").slice(0, 60)}`,
    );
  }
}

const count = (snap) =>
  Object.values(snap.pages).reduce(
    (sum, list) => sum + list.reduce((n, cell) => n + cell.numbers.length, 0),
    0,
  );
console.log(`比對 ${pages.size} 頁、${compared} 格（前 ${count(before)} 個數字／後 ${count(after)} 個）`);
if (!problems.length) {
  console.log("\n✅ 每一格都一樣——沒有任何既有數字被改到");
  process.exit(0);
}
console.error(`\n❌ ${problems.length} 格不同：`);
for (const problem of problems.slice(0, 40)) console.error("  ・" + problem);
if (problems.length > 40) console.error(`  …還有 ${problems.length - 40} 格`);
process.exit(1);
