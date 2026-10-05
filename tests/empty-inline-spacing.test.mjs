/*
 * ══════════════════════════════════════════════════════════════════════
 *  className 寫了，樣式表卻一條規則都沒有
 * ══════════════════════════════════════════════════════════════════════
 *
 * 來源：姊妹系統全日交通量 2026-10-05 被使用者抓到（附線上截圖）——
 *   「這張截圖下方的文字"還沒有任何計畫"幾乎與邊緣方框處黏在一起了」。
 *   那一支的 .inline-note 用了五次卻一條 CSS 規則都沒有。
 *   用同一套判準回頭掃這一支，掃到 .empty-inline 兩處（v2.1.94 修掉）。
 *
 * ── 成因 ──────────────────────────────────────────────────────
 *
 * 本專案用 Tailwind preflight，沒有規則**不等於**瀏覽器預設值：preflight 會把
 * 元素的預設邊距歸零、框線寬度歸零、底色設成透明。而 .panel 自己沒有 padding
 * （內距一律由 .panel-head 這類子元素各自帶），所以一個沒有規則的區塊元素
 * 放進面板裡，左右與下方都會是 0——直接貼著邊線。
 * 用出貨的那份樣式表實測 .empty-inline：左 1.0px／右 1.0px／下 1.0px，
 * 那 1px 就是面板外框線本身。
 *
 * ⚠️ 這一類錯最惡毒的地方：**不會壞、不會報錯、不會少功能**，文字看得到、
 *   意思也對，只是版面不成樣子。任何「這句話在不在」的測試都會過。
 *
 * ⚠️ 為什麼要**靜態**檢查，既然已經有 scripts/e2e-class-coverage.mjs：
 *   那一支掃的是「當下畫得出來的畫面」，很多 class 要特定資料或特定狀態
 *   才會出現，掃不到的就等於沒驗——姊妹系統正是因為這樣，那一支在缺陷
 *   存在時仍然全綠。讀原始碼是每一個都讀得到。兩支互補，不是重複。
 *
 * ⚠️ 解析一律走 TypeScript 的語法樹，CSS 註解用**會認字串的字元掃描器**，
 *   **不用正規式**：正規式刪註解會被字串裡的註解符號騙
 *   （姊妹系統 2026-10-05 實際踩過，把 3 項測試數成 2 項）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const CSS = join(ROOT, "app", "globals.css");
const SOURCES = ["traffic-app.tsx", "main-toolbar.tsx", "peak-shape-charts.tsx", "turn-preview.tsx", "layout.tsx", "page.tsx"]
  .map((name) => join(ROOT, "app", name))
  .filter((p) => existsSync(p));

/*
 * 這幾個 class 是**故意**沒有自己的規則的，每一筆都要寫出樣式從哪裡來。
 * ⚠️ 這份清單不是垃圾桶：判準③會檢查裡面每一個名稱都還真的在用、而且確實
 *   還沒有規則，不然刪掉的 class 會一直留著，清單會慢慢變成一張免死金牌。
 */
const INTENTIONALLY_UNSTYLED = new Map([
  ["from-content", "<small>，間距來自父層 .modal label 的 grid gap（display:grid;gap:4px）"],
  ["import-conflict", "<div> 在 <td> 裡，內距來自元素選擇器 td（padding: 11px 12px）"],
  ["modal-actions", "<div> 在 .presence-modal 裡，內距來自那一條（padding: 20px 22px）＋ grid gap 14px"],
  ["field-hint", "<small> 在 section.trend-controls.panel 裡，內距來自那一條（padding: 13px 16px）"],
  ["trend-svg", "SVG 的 <svg>，尺寸與位置由 width／height／viewBox 屬性決定"],
  ["trend-legend", "SVG 的 <g>，純粹分組；看得見的在子元素"],
  ["point-value", "SVG 的 <text>，顏色與位置由 fill／x／y／dx 屬性決定（刻意不用系列色，見該處註解）"],
  ["turn-legend", "SVG 的 <g>，純粹分組"],
]);

/* ── CSS：認字串的註解掃描器（不是 regex） ───────────────────── */
function stripCssComments(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i += 1; continue; }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      out += " ";
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const css = stripCssComments(readFileSync(CSS, "utf8"));

function hasRule(cls, text) {
  /* 只掃 selector 前綴；content 字串／URL 提到名稱不代表有規則。 */
  let selectors = "";
  let prelude = "";
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; prelude += " "; continue; }
    if (c === "{") {
      if (!prelude.trim().startsWith("@")) selectors += prelude + "\n";
      prelude = "";
    } else if (c === "}" || c === ";") prelude = "";
    else prelude += c;
  }
  text = selectors;
  const needle = "." + cls;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return false;
    const next = text[at + needle.length];
    if (next === undefined || !/[A-Za-z0-9_-]/.test(next)) return true;
    from = at + 1;
  }
}

/* ── TSX：用語法樹取出每一個 className 上的 class ─────────────── */
const elements = [];
function literalsIn(node, bag) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) bag.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    bag.push(node.head.text);
    for (const span of node.templateSpans) bag.push(span.literal.text);
  }
  ts.forEachChild(node, (child) => literalsIn(child, bag));
}
for (const path of SOURCES) {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (file.parseDiagnostics?.length)
    throw new Error(`${path} 解析失敗（${file.parseDiagnostics.length} 筆）`);
  const name = path.slice(ROOT.length + 1);
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === "className" && node.initializer) {
      const bag = [];
      literalsIn(node.initializer, bag);
      const classes = [];
      for (const piece of bag)
        for (const token of piece.split(/\s+/))
          if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(token)) classes.push(token);
      if (classes.length)
        elements.push({
          where: `${name}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`,
          classes,
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

const allClasses = new Set(elements.flatMap((e) => e.classes));
const styledClasses = [...allClasses].filter((c) => hasRule(c, css));

test("前置：真的用語法樹掃到 className，而且大多數 class 在樣式表裡找得到規則", () => {
  assert.equal(hasRule("empty-inline", '.probe {content:".empty-inline";}'), false);
  assert.equal(hasRule("empty-inline", '.empty-inline-extra {padding:20px;}'), false);
  assert.equal(hasRule("empty-inline", '@media(min-width:1px){.empty-inline {padding:20px;}}'), true);
  assert.ok(
    allClasses.size >= 300,
    `只掃到 ${allClasses.size} 個 class——className 的寫法改了，還是語法樹走錯了？`,
  );
  assert.ok(
    styledClasses.length >= 250,
    `只有 ${styledClasses.length} 個 class 在 globals.css 找得到規則——` +
      "樣式表讀法壞了的話，下面兩項會變成恆紅，那和恆綠一樣沒用。",
  );
});

test("每一個元素的 className 裡至少要有一個 class 在樣式表裡有規則", () => {
  const bad = [];
  for (const el of elements) {
    if (el.classes.some((c) => hasRule(c, css))) continue;
    if (el.classes.every((c) => INTENTIONALLY_UNSTYLED.has(c))) continue;
    bad.push(`${el.where}：className="${el.classes.join(" ")}"`);
  }
  assert.deepEqual(
    bad,
    [],
    "這些元素掛的 class 在 globals.css 裡一條規則都沒有——" +
      "Tailwind preflight 會把預設邊距歸零，於是它們會貼著容器的邊線。\n" +
      "確定是刻意不給樣式的話，寫進 INTENTIONALLY_UNSTYLED 並說明樣式從哪裡來：\n  " +
      bad.join("\n  "),
  );
});

test("INTENTIONALLY_UNSTYLED 裡的每一個名稱都要還在用，而且確實沒有規則", () => {
  const stale = [];
  for (const [cls, why] of INTENTIONALLY_UNSTYLED) {
    if (!allClasses.has(cls)) stale.push(`${cls}：已經沒有人用了，從清單移掉`);
    else if (hasRule(cls, css)) stale.push(`${cls}：現在樣式表裡有規則了，從清單移掉`);
    else if (!why || why.length < 10) stale.push(`${cls}：沒有寫清楚樣式從哪裡來`);
  }
  assert.deepEqual(stale, [], "免死金牌清單要跟著現況走：\n  " + stale.join("\n  "));
});

test("面板裡的 .empty-inline 要有左右內距與下內距，而且與 .panel-head 對得齊", () => {
  const rule = css.match(/\.empty-inline\s*\{([^}]*)\}/);
  assert.ok(rule, "找不到 .empty-inline 這一條——面板裡那兩句話會貼著邊線");
  const padding = rule[1].match(/padding\s*:\s*([^;}]+)/);
  assert.ok(padding, ".empty-inline 沒有設 padding");
  const sides = padding[1].trim().split(/\s+/);
  assert.ok(sides.length >= 3 && sides.length <= 4, `padding 要分別給上下左右，現在是「${padding[1].trim()}」`);
  const px = (v) => Number.parseFloat(v) || 0;
  const right = sides[1];
  const left = sides[3] ?? sides[1];
  assert.ok(/^\d+(?:\.\d+)?px$/.test(left) && px(left) >= 12, `左內距 ${left} 太小或不是 px`);
  assert.ok(/^\d+(?:\.\d+)?px$/.test(right) && px(right) >= 12, `右內距 ${right} 太小或不是 px`);
  assert.ok(px(sides[2]) >= 12, `下內距 ${sides[2]} 太小，文字會貼著面板下緣`);
  /*
   * 與 .panel-head 的左右內距取同一個數，面板裡的東西才會切齊同一條線。
   * ⚠️ 刻意**不**抄姊妹系統全日交通量的 18px——兩支的面板內距本來就不一樣。
   */
  const head = css.match(/\.panel-head\s*\{[^}]*padding\s*:\s*([^;}]+)/);
  assert.ok(head, "缺少 .panel-head padding，不能略過對齊驗證");
  {
    const headSides = head[1].trim().split(/\s+/);
    const headX = px(headSides[1] ?? headSides[0]);
    assert.equal(
      px(left),
      headX,
      `.empty-inline 的左右內距 ${sides[1]} 與 .panel-head 的 ${headX}px 對不齊`,
    );
    assert.equal(px(right), headX, ".empty-inline 右側也要與 .panel-head 對齊");
  }
});

test("建置出來的樣式表也要有這一條（改了原始碼卻沒重建資產一樣是壞的）", () => {
  const dirs = [join(ROOT, "assets"), join(ROOT, "github-pages-dist", "assets")].filter((d) => existsSync(d));
  assert.ok(dirs.length, "沒有建置樣式表，不能宣稱產物驗證通過");
  const bad = [];
  for (const dir of dirs) {
    const names = readdirSync(dir).filter((f) => f.endsWith(".css"));
    assert.ok(names.length, `${dir} 沒有 CSS 產物`);
    for (const name of names) {
      const built = stripCssComments(readFileSync(join(dir, name), "utf8"));
      if (!hasRule("empty-inline", built)) bad.push(`${dir.slice(ROOT.length + 1)}/${name}`);
    }
  }
  assert.deepEqual(bad, [], "線上吃的是這份建置產物，不是 globals.css：\n  " + bad.join("\n  "));
});
