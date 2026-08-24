/*
 * 由 manual.html 產生可編輯的 Word 版手冊。
 * 兩份檔案共用同一份原始內容，避免 PDF 與 Word 說明不一致。
 * 作法：用 Chromium 載入 HTML，把 DOM 轉成單純的區塊 JSON，再交給 docx-js 產檔。
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { chromiumLaunchOptions } from "../chromium.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "manual.html");
const out = join(here, "..", "..", "public", "Turning-Traffic-v2.1.20-新手操作手冊.docx");

const NAVY = "17353E";
const TEAL = "087F75";
const INK = "17353E";
const MUTED = "61777D";
const LINE = "DCE6E3";
const WASH = "EFF6F4";
const ORANGE_T = "A9660F";
const FONT = "Noto Sans CJK TC";

/* ── 1. 讀取 HTML 並轉成區塊 JSON ───────────────────────────── */
const browser = await chromium.launch(chromiumLaunchOptions());
const page = await browser.newPage();
await page.goto(pathToFileURL(src).href, { waitUntil: "load" });

const blocks = await page.evaluate(() => {
  const runsOf = (el) => {
    const runs = [];
    const walk = (node, fmt) => {
      if (node.nodeType === 3) {
        const text = node.nodeValue.replace(/\s+/g, " ");
        if (text) runs.push({ text, ...fmt });
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      if (tag === "br") {
        runs.push({ text: "", br: true });
        return;
      }
      const next = {
        bold: fmt.bold || tag === "strong" || tag === "b",
        mono: fmt.mono || tag === "code" || node.classList.contains("btn"),
      };
      node.childNodes.forEach((child) => walk(child, next));
    };
    el.childNodes.forEach((child) => walk(child, { bold: false, mono: false }));
    // 修掉頭尾多餘空白
    while (runs.length && !runs[0].br && !runs[0].text.trim()) runs.shift();
    while (runs.length && !runs.at(-1).br && !runs.at(-1).text.trim()) runs.pop();
    if (runs.length) {
      runs[0].text = runs[0].text.replace(/^\s+/, "");
      runs[runs.length - 1].text = runs.at(-1).text.replace(/\s+$/, "");
    }
    return runs;
  };
  const cellsOf = (row) => [...row.children].map((cell) => runsOf(cell));

  const result = [];
  const cover = document.querySelector(".cover");
  result.push({ type: "coverKicker", text: cover.querySelector(".kicker").textContent.trim() });
  result.push({ type: "coverTitle", text: cover.querySelector("h1").textContent.trim() });
  const sysname = cover.querySelector(".sysname");
  if (sysname) result.push({ type: "coverSysname", text: sysname.textContent.trim() });
  result.push({ type: "coverSub", text: cover.querySelector("h2").textContent.trim() });
  result.push({ type: "coverLede", text: cover.querySelector(".lede").textContent.trim() });

  const pushBox = (el) => {
    const variant = el.classList.contains("warn")
      ? "warn"
      : el.classList.contains("new")
        ? "new"
        : "info";
    result.push({
      type: "box",
      variant,
      title: el.querySelector(".t")?.textContent.trim() ?? "",
      paras: [...el.querySelectorAll("p")].map((p) => runsOf(p)),
    });
  };
  const pushTable = (el) => {
    result.push({
      type: "table",
      head: [...el.querySelectorAll("thead tr th")].map((th) => th.textContent.trim()),
      widths: [...el.querySelectorAll("thead tr th")].map((th) => th.style.width || ""),
      rows: [...el.querySelectorAll("tbody tr")].map((tr) => cellsOf(tr)),
    });
  };

  for (const el of cover.children) {
    if (el.classList.contains("box")) pushBox(el);
    if (el.tagName === "TABLE") pushTable(el);
  }
  result.push({ type: "stamp", text: cover.querySelector(".stamp").textContent.trim() });
  result.push({ type: "pageBreak" });

  for (const el of document.body.children) {
    if (el.classList?.contains("cover")) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === "h2") {
      result.push({
        type: "h2",
        num: el.querySelector(".n")?.textContent.trim() ?? "",
        text: el.textContent.replace(el.querySelector(".n")?.textContent ?? "", "").trim(),
        pageBreak: el.classList.contains("pb"),
      });
    } else if (tag === "h3") {
      result.push({ type: "h3", text: el.textContent.trim() });
    } else if (tag === "p") {
      result.push({ type: "p", runs: runsOf(el) });
    } else if (tag === "ul" || tag === "ol") {
      result.push({
        type: el.classList.contains("check") ? "check" : "ul",
        items: [...el.children].map((li) => runsOf(li)),
      });
    } else if (tag === "table") {
      pushTable(el);
    } else if (el.classList.contains("box")) {
      pushBox(el);
    } else if (el.classList.contains("step")) {
      result.push({
        type: "step",
        head: el.querySelector(".h").textContent.trim(),
        runs: runsOf(el.querySelector("p")),
      });
    }
  }
  return result;
});
await browser.close();

/* ── 2. 轉成 docx 元素 ─────────────────────────────────────── */
const toRuns = (runs, extra = {}) =>
  runs.flatMap((run) =>
    run.br
      ? [new TextRun({ break: 1 })]
      : [
          new TextRun({
            text: run.text,
            bold: Boolean(run.bold),
            font: FONT,
            color: run.bold ? NAVY : (extra.color ?? INK),
            size: extra.size ?? 21,
            shading: run.mono
              ? { type: ShadingType.CLEAR, fill: WASH, color: "auto" }
              : undefined,
            ...(extra.runProps ?? {}),
          }),
        ],
  );

const plain = (text, opts = {}) =>
  new Paragraph({
    alignment: opts.align,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 120, line: 300 },
    children: [
      new TextRun({
        text,
        font: FONT,
        bold: opts.bold,
        size: opts.size ?? 21,
        color: opts.color ?? INK,
        characterSpacing: opts.spacingChars,
      }),
    ],
  });

const boxParagraphs = (block) => {
  const accent = block.variant === "warn" ? ORANGE_T : TEAL;
  const fill = block.variant === "warn" ? "FDF4E7" : "EAF4F1";
  const children = [];
  if (block.title)
    children.push(
      new Paragraph({
        spacing: { after: 60, line: 300 },
        children: [
          new TextRun({ text: block.title, bold: true, font: FONT, size: 21, color: accent }),
        ],
      }),
    );
  block.paras.forEach((runs, index) =>
    children.push(
      new Paragraph({
        spacing: { after: index === block.paras.length - 1 ? 0 : 100, line: 300 },
        children: toRuns(runs),
      }),
    ),
  );
  // 用單格表格模擬提示框：底色＋左側粗邊
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: fill },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: fill },
      right: { style: BorderStyle.SINGLE, size: 2, color: fill },
      left: { style: BorderStyle.SINGLE, size: 18, color: accent },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 9360, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill, color: "auto" },
            margins: { top: 140, bottom: 140, left: 180, right: 180 },
            children,
          }),
        ],
      }),
    ],
  });
};

const TOTAL = 9360;
const tableElement = (block) => {
  const count = block.head.length;
  const widths = block.widths.map((w) => {
    const match = /^(\d+(?:\.\d+)?)%$/.exec(w.trim());
    return match ? Number(match[1]) / 100 : 0;
  });
  const known = widths.reduce((sum, value) => sum + value, 0);
  const blanks = widths.filter((value) => !value).length;
  const share = blanks ? Math.max(0.08, (1 - known) / blanks) : 0;
  let columnWidths = widths.map((value) => Math.round((value || share) * TOTAL));
  const drift = TOTAL - columnWidths.reduce((sum, value) => sum + value, 0);
  columnWidths[count - 1] += drift;

  const cell = (children, opts = {}) =>
    new TableCell({
      width: { size: opts.width, type: WidthType.DXA },
      shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: "auto" } : undefined,
      margins: { top: 90, bottom: 90, left: 120, right: 120 },
      children,
    });

  const headRow = new TableRow({
    tableHeader: true,
    children: block.head.map((text, index) =>
      cell(
        [
          new Paragraph({
            spacing: { after: 0, line: 280 },
            children: [
              new TextRun({ text, bold: true, font: FONT, size: 19, color: "FFFFFF" }),
            ],
          }),
        ],
        { width: columnWidths[index], fill: TEAL },
      ),
    ),
  });

  const bodyRows = block.rows.map((cells, rowIndex) =>
    new TableRow({
      children: cells.map((runs, index) =>
        cell(
          [
            new Paragraph({
              spacing: { after: 0, line: 280 },
              children: toRuns(runs, { size: 19 }),
            }),
          ],
          { width: columnWidths[index], fill: rowIndex % 2 ? "F6FAF9" : undefined },
        ),
      ),
    }),
  );

  return new Table({
    width: { size: TOTAL, type: WidthType.DXA },
    columnWidths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      left: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      right: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: LINE },
    },
    rows: [headRow, ...bodyRows],
  });
};

const children = [];
for (const block of blocks) {
  switch (block.type) {
    case "coverKicker":
      children.push(
        plain(block.text, {
          align: AlignmentType.CENTER,
          bold: true,
          size: 20,
          color: TEAL,
          spacingChars: 40,
          before: 1200,
          after: 240,
        }),
      );
      break;
    case "coverTitle":
      children.push(
        plain(block.text, { align: AlignmentType.CENTER, bold: true, size: 56, color: NAVY, after: 160 }),
      );
      break;
    case "coverSysname":
      children.push(
        plain(block.text, { align: AlignmentType.CENTER, bold: true, size: 30, color: NAVY, after: 140 }),
      );
      break;
    case "coverSub":
      children.push(
        plain(block.text, { align: AlignmentType.CENTER, bold: true, size: 32, color: TEAL, after: 200 }),
      );
      break;
    case "coverLede":
      children.push(
        plain(block.text, { align: AlignmentType.CENTER, size: 22, color: MUTED, after: 320 }),
      );
      break;
    case "stamp":
      children.push(
        plain(block.text, { align: AlignmentType.CENTER, size: 20, color: MUTED, before: 320 }),
      );
      break;
    case "pageBreak":
      children.push(new Paragraph({ children: [new PageBreak()] }));
      break;
    case "h2":
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: block.pageBreak,
          spacing: { before: 400, after: 160, line: 300 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: TEAL, space: 4 } },
          children: [
            new TextRun({ text: `${block.num} `, bold: true, font: FONT, size: 30, color: TEAL }),
            new TextRun({ text: block.text, bold: true, font: FONT, size: 30, color: NAVY }),
          ],
        }),
      );
      break;
    case "h3":
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 260, after: 100, line: 300 },
          children: [
            new TextRun({ text: block.text, bold: true, font: FONT, size: 23, color: TEAL }),
          ],
        }),
      );
      break;
    case "p":
      children.push(
        new Paragraph({ spacing: { after: 140, line: 320 }, children: toRuns(block.runs) }),
      );
      break;
    case "ul":
      block.items.forEach((runs) =>
        children.push(
          new Paragraph({
            numbering: { reference: "bullets", level: 0 },
            spacing: { after: 60, line: 320 },
            children: toRuns(runs),
          }),
        ),
      );
      break;
    case "check":
      block.items.forEach((runs) =>
        children.push(
          new Paragraph({
            spacing: { after: 60, line: 320 },
            indent: { left: 360, hanging: 260 },
            children: [
              new TextRun({ text: "☐  ", font: FONT, size: 21, color: TEAL, bold: true }),
              ...toRuns(runs),
            ],
          }),
        ),
      );
      break;
    case "step":
      children.push(
        new Paragraph({
          spacing: { before: 140, after: 20, line: 300 },
          children: [
            new TextRun({ text: block.head, bold: true, font: FONT, size: 21, color: TEAL }),
          ],
        }),
        new Paragraph({
          spacing: { after: 120, line: 320 },
          indent: { left: 340 },
          children: toRuns(block.runs),
        }),
      );
      break;
    case "box":
      children.push(boxParagraphs(block), new Paragraph({ spacing: { after: 160 }, children: [] }));
      break;
    case "table":
      children.push(tableElement(block), new Paragraph({ spacing: { after: 160 }, children: [] }));
      break;
    default:
      break;
  }
}

const doc = new Document({
  creator: "Turning Traffic",
  title: "Turning Traffic 新手操作手冊 v2.1.20",
  description: "寫給完全沒有交通背景的新手：從建立計畫、匯入調查檔、核對品質，到轉向圖、報表勾選匯出與備份。",
  styles: {
    default: {
      document: { run: { font: FONT, size: 21, color: INK } },
    },
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 220 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: { margin: { top: 1134, bottom: 1020, left: 907, right: 907 } },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { after: 0 },
              children: [
                new TextRun({
                  text: "Turning Traffic ｜ 路口尖峰轉向交通量分析 新手操作手冊",
                  font: FONT,
                  size: 15,
                  color: MUTED,
                }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0 },
              children: [
                new TextRun({
                  text: "v2.1.20 ｜ 2026-08-24 ｜ 正式成果前請先下載備份　　第 ",
                  font: FONT,
                  size: 15,
                  color: MUTED,
                }),
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 15, color: MUTED }),
                new TextRun({ text: " / ", font: FONT, size: 15, color: MUTED }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 15, color: MUTED }),
                new TextRun({ text: " 頁", font: FONT, size: 15, color: MUTED }),
              ],
            }),
          ],
        }),
      },
      children,
    },
  ],
});

writeFileSync(out, await Packer.toBuffer(doc));
console.log("Word 已產生：", out, "（區塊數", blocks.length, "）");
