/**
 * 依 ECMA-376（OOXML）規格檢查匯出的 .xlsx 會不會讓 Excel 跳出
 * 「我們發現…部分內容有問題。您要我們盡可能嘗試復原嗎？」。
 *
 * Excel 開檔時會把每個 part 對照 XSD 驗證，只要子元素「順序」或「內容」
 * 不合規格就會判定檔案損毀，接著把整個圖表 part 丟掉——使用者看到的現象
 * 就是「跳出修復提示」以及「修復後圖表全部不見」。LibreOffice 相對寬鬆，
 * 能開起來不代表 Excel 能開，所以這裡自己按規格檢查。
 *
 * 匯出給三支程式共用：傳入 xlsx 的 bytes 即可。
 */

/** 各元素的子元素順序（xsd:sequence）。未列出的元素不檢查順序。 */
const SEQUENCES = {
  "c:chartSpace": [
    "c:date1904", "c:lang", "c:roundedCorners", "c:style", "c:clrMapOvr",
    "c:pivotSource", "c:protection", "c:chart", "c:spPr", "c:txPr",
    "c:externalData", "c:printSettings", "c:userShapes", "c:extLst",
  ],
  "c:chart": [
    "c:title", "c:autoTitleDeleted", "c:pivotFmts", "c:view3D", "c:floor",
    "c:sideWall", "c:backWall", "c:plotArea", "c:legend", "c:plotVisOnly",
    "c:dispBlanksAs", "c:showDLblsOverMax", "c:extLst",
  ],
  "c:barChart": [
    "c:barDir", "c:grouping", "c:varyColors", "c:ser", "c:dLbls",
    "c:gapWidth", "c:overlap", "c:serLines", "c:axId", "c:extLst",
  ],
  "c:lineChart": [
    "c:grouping", "c:varyColors", "c:ser", "c:dLbls", "c:dropLines",
    "c:hiLowLines", "c:upDownBars", "c:marker", "c:smooth", "c:axId",
    "c:extLst",
  ],
  "c:pieChart": [
    "c:varyColors", "c:ser", "c:dLbls", "c:firstSliceAng", "c:extLst",
  ],
  // CT_DoughnutChart：firstSliceAng 一定要排在 holeSize 之前
  "c:doughnutChart": [
    "c:varyColors", "c:ser", "c:dLbls", "c:firstSliceAng", "c:holeSize",
    "c:extLst",
  ],
  "c:dLbls": [
    "c:dLbl", "c:delete", "c:numFmt", "c:spPr", "c:txPr", "c:dLblPos",
    "c:showLegendKey", "c:showVal", "c:showCatName", "c:showSerName",
    "c:showPercent", "c:showBubbleSize", "c:separator", "c:showLeaderLines",
    "c:leaderLines", "c:extLst",
  ],
  "c:dPt": [
    "c:idx", "c:invertIfNegative", "c:marker", "c:bubble3D", "c:explosion",
    "c:spPr", "c:pictureOptions", "c:extLst",
  ],
  "c:scaling": ["c:logBase", "c:orientation", "c:max", "c:min", "c:extLst"],
  "c:catAx": [
    "c:axId", "c:scaling", "c:delete", "c:axPos", "c:majorGridlines",
    "c:minorGridlines", "c:title", "c:numFmt", "c:majorTickMark",
    "c:minorTickMark", "c:tickLblPos", "c:spPr", "c:txPr", "c:crossAx",
    "c:crosses", "c:crossesAt", "c:auto", "c:lblAlgn", "c:lblOffset",
    "c:tickLblSkip", "c:tickMarkSkip", "c:noMultiLvlLbl", "c:extLst",
  ],
  "c:valAx": [
    "c:axId", "c:scaling", "c:delete", "c:axPos", "c:majorGridlines",
    "c:minorGridlines", "c:title", "c:numFmt", "c:majorTickMark",
    "c:minorTickMark", "c:tickLblPos", "c:spPr", "c:txPr", "c:crossAx",
    "c:crosses", "c:crossesAt", "c:crossBetween", "c:majorUnit",
    "c:minorUnit", "c:dispUnits", "c:extLst",
  ],
  // 注意：c:plotArea 內的座標軸（valAx／catAx／dateAx／serAx）在規格裡是
  // xsd:choice maxOccurs="unbounded"，彼此之間沒有順序要求，因此不列入檢查；
  // 只檢查 layout → 圖表群組 → dTable/spPr 這幾段的相對順序。
  "c:plotArea": [
    "c:layout", "c:areaChart", "c:area3DChart", "c:lineChart",
    "c:line3DChart", "c:stockChart", "c:radarChart", "c:scatterChart",
    "c:pieChart", "c:pie3DChart", "c:doughnutChart", "c:barChart",
    "c:bar3DChart", "c:ofPieChart", "c:surfaceChart", "c:surface3DChart",
    "c:bubbleChart", "c:dTable", "c:spPr", "c:extLst",
  ],
  "c:printSettings": [
    "c:headerFooter", "c:pageMargins", "c:pageSetup", "c:legacyDrawingHF",
  ],
  "c:title": ["c:tx", "c:layout", "c:overlay", "c:spPr", "c:txPr", "c:extLst"],
  "c:legend": [
    "c:legendPos", "c:legendEntry", "c:layout", "c:overlay", "c:spPr",
    "c:txPr", "c:extLst",
  ],
  "xdr:graphicFrame": [
    "xdr:nvGraphicFramePr", "xdr:xfrm", "a:graphic",
  ],
  "xdr:twoCellAnchor": [
    "xdr:from", "xdr:to", "xdr:sp", "xdr:grpSp", "xdr:graphicFrame",
    "xdr:cxnSp", "xdr:pic", "xdr:contentPart", "xdr:clientData",
  ],
};

/**
 * 每一種資料數列的子元素順序。c:ser 在不同圖表類型下規則不同，
 * 所以要看它的父元素。
 */
const SER_SEQUENCES = {
  "c:barChart": [
    "c:idx", "c:order", "c:tx", "c:spPr", "c:invertIfNegative",
    "c:pictureOptions", "c:dPt", "c:dLbls", "c:trendline", "c:errBars",
    "c:cat", "c:val", "c:shape", "c:extLst",
  ],
  "c:lineChart": [
    "c:idx", "c:order", "c:tx", "c:spPr", "c:marker", "c:dPt", "c:dLbls",
    "c:trendline", "c:errBars", "c:cat", "c:val", "c:smooth", "c:extLst",
  ],
  "c:pieChart": [
    "c:idx", "c:order", "c:tx", "c:spPr", "c:explosion", "c:dPt", "c:dLbls",
    "c:cat", "c:val", "c:extLst",
  ],
  "c:doughnutChart": [
    "c:idx", "c:order", "c:tx", "c:spPr", "c:explosion", "c:dPt", "c:dLbls",
    "c:cat", "c:val", "c:extLst",
  ],
};

/**
 * Excel 的額外規則（XSD 過得了、Excel 仍判定損毀）。
 * 甜甜圈圖不接受 c:dLblPos，這是最常見的「開檔要求修復」原因。
 */
const FORBIDDEN = [
  {
    parent: "c:doughnutChart",
    element: "c:dLblPos",
    why: "Excel 不接受甜甜圈圖的 c:dLblPos，會判定檔案損毀並要求修復",
  },
  {
    parent: "c:pieChart",
    element: "c:dLblPos",
    valuesNotAllowed: ["l", "r", "t", "b", "inBase"],
    why: "圓餅圖的 c:dLblPos 只接受 bestFit／ctr／inEnd／outEnd",
  },
];

/** 極簡 XML 走訪：回傳 [{path, name, parent, attrs}]，夠用來檢查順序。 */
function walk(xml) {
  const nodes = [];
  const stack = [];
  const re = /<([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<\/([a-zA-Z][\w:.-]*)\s*>/g;
  let match;
  while ((match = re.exec(xml))) {
    if (match[4]) {
      stack.pop();
      continue;
    }
    const name = match[1];
    const attrs = {};
    for (const a of match[2].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g))
      attrs[a[1]] = a[2];
    nodes.push({ name, attrs, parent: stack[stack.length - 1] ?? null });
    if (!match[3]) stack.push(name);
  }
  return nodes;
}

/** 依父元素把子元素分組，保持出現順序。 */
function childrenByParent(xml) {
  const groups = new Map();
  const stack = [];
  const re = /<([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<\/([a-zA-Z][\w:.-]*)\s*>/g;
  let match;
  let counter = 0;
  while ((match = re.exec(xml))) {
    if (match[4]) {
      stack.pop();
      continue;
    }
    const name = match[1];
    const attrs = {};
    for (const a of match[2].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g))
      attrs[a[1]] = a[2];
    const parent = stack[stack.length - 1];
    if (parent) {
      if (!groups.has(parent.key)) groups.set(parent.key, []);
      groups.get(parent.key).push({ name, attrs, parentName: parent.name });
    }
    if (!match[3]) stack.push({ name, key: `${name}#${(counter += 1)}` });
  }
  return groups;
}

export function checkChartXml(name, xml) {
  const issues = [];
  const groups = childrenByParent(xml);
  for (const [key, children] of groups) {
    const parentName = key.split("#")[0];
    const order =
      parentName === "c:ser"
        ? SER_SEQUENCES[children[0]?.parentName] // 由父圖表決定，稍後補
        : SEQUENCES[parentName];
    if (!order) continue;
    let cursor = -1;
    for (const child of children) {
      const index = order.indexOf(child.name);
      if (index === -1) continue; // 規格外的元素交給 XML 檢查
      if (index < cursor)
        issues.push(
          `${name}：<${parentName}> 內的 <${child.name}> 排在 <${order[cursor]}> 之後，` +
            `規格要求的順序是 ${order.filter((e) => children.some((c) => c.name === e)).join(" → ")}`,
        );
      else cursor = index;
    }
  }
  // c:ser 需要知道所屬圖表類型，另外處理
  for (const chartType of Object.keys(SER_SEQUENCES)) {
    const blocks = xml.split(`<${chartType}>`).slice(1);
    for (const block of blocks) {
      for (const serBlock of block.split("<c:ser>").slice(1)) {
        const body = serBlock.split("</c:ser>")[0];
        const order = SER_SEQUENCES[chartType];
        let cursor = -1;
        // 只看 c:ser 的「直接」子元素：進入子樹後要等它收合才繼續比對，
        // 否則 c:dPt 內的 c:idx／c:spPr 會被誤判成 c:ser 自己的子元素。
        let depth = 0;
        const re = /<([a-zA-Z][\w:.-]*)(?:\s+[^>]*?)?(\/?)>|<\/([a-zA-Z][\w:.-]*)>/g;
        let m;
        while ((m = re.exec(body))) {
          if (m[3]) {
            depth -= 1;
            continue;
          }
          const tag = m[1];
          const selfClosing = m[2] === "/";
          if (depth === 0) {
            const index = order.indexOf(tag);
            if (index !== -1) {
              if (index < cursor)
                issues.push(
                  `${name}：${chartType} 的 <c:ser> 內，<${tag}> 排在 <${order[cursor]}> 之後`,
                );
              else cursor = index;
            }
          }
          if (!selfClosing) depth += 1;
        }
      }
    }
  }
  // Excel 額外規則
  for (const rule of FORBIDDEN) {
    const blocks = xml.split(`<${rule.parent}>`).slice(1);
    for (const block of blocks) {
      const body = block.split(`</${rule.parent}>`)[0];
      for (const hit of body.matchAll(
        new RegExp(`<${rule.element}(?:\\s+val="([^"]*)")?`, "g"),
      )) {
        if (rule.valuesNotAllowed && !rule.valuesNotAllowed.includes(hit[1]))
          continue;
        issues.push(`${name}：${rule.why}（找到 <${rule.element}${hit[1] ? ` val="${hit[1]}"` : ""}>）`);
      }
    }
  }
  return issues;
}

/** 檢查整個 .xlsx（bytes）。回傳問題清單，空陣列代表 Excel 應可直接開啟。 */
export async function checkWorkbook(bytes) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const issues = [];
  const texts = {};
  for (const name of names)
    if (/\.(xml|rels)$/i.test(name))
      texts[name] = await zip.file(name).async("string");

  // 1) 每個 XML 都要是合法 XML（標籤要成對）
  for (const [name, text] of Object.entries(texts)) {
    const stack = [];
    const re = /<([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<\/([a-zA-Z][\w:.-]*)\s*>/g;
    let match;
    while ((match = re.exec(text))) {
      if (match[4]) {
        if (stack.pop() !== match[4]) {
          issues.push(`${name}：XML 標籤沒有成對（</${match[4]}>）`);
          break;
        }
      } else if (!match[3]) stack.push(match[1]);
    }
    if (stack.length) issues.push(`${name}：XML 有未關閉的標籤 <${stack.at(-1)}>`);
  }

  // 2) [Content_Types].xml 必須涵蓋每一個 part
  const ct = texts["[Content_Types].xml"] ?? "";
  const defaults = [...ct.matchAll(/<Default Extension="([^"]+)"/g)].map((m) =>
    m[1].toLowerCase(),
  );
  const overrides = new Set(
    [...ct.matchAll(/<Override PartName="([^"]+)"/g)].map((m) => m[1]),
  );
  for (const name of names) {
    if (name === "[Content_Types].xml") continue;
    if (overrides.has("/" + name)) continue;
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    if (!defaults.includes(ext))
      issues.push(`[Content_Types].xml 沒有涵蓋 ${name}`);
  }

  // 3) .rels 指到的 part 必須存在
  const partSet = new Set(names);
  for (const [name, text] of Object.entries(texts)) {
    if (!name.endsWith(".rels")) continue;
    const base = name.split("/").slice(0, -2).join("/");
    for (const rel of text.matchAll(
      /<Relationship\b[^>]*Target="([^"]+)"[^>]*\/?>/g,
    )) {
      if (/TargetMode="External"/.test(rel[0]) || /^https?:/.test(rel[1]))
        continue;
      const parts = (base ? base.split("/") : []).concat(rel[1].split("/"));
      const out = [];
      for (const part of parts) {
        if (part === "." || part === "") continue;
        if (part === "..") out.pop();
        else out.push(part);
      }
      const resolved = out.join("/");
      if (!partSet.has(resolved))
        issues.push(`${name} 指到不存在的 part：${rel[1]}`);
    }
  }

  // 4) r:id 必須在對應的 .rels 裡找得到
  for (const [name, text] of Object.entries(texts)) {
    if (!/^xl\/(drawings|charts|worksheets)\//.test(name)) continue;
    if (name.includes("/_rels/")) continue;
    const relName = name.replace(/([^/]+)$/, "_rels/$1.rels");
    const known = new Set(
      [...(texts[relName] ?? "").matchAll(/Id="([^"]+)"/g)].map((m) => m[1]),
    );
    for (const hit of text.matchAll(/r:(?:id|embed)="([^"]+)"/g))
      if (!known.has(hit[1]))
        issues.push(`${name} 用了對不到 relationship 的 ${hit[1]}`);
  }

  // 5) 圖表 XML 的元素順序與 Excel 額外規則
  for (const name of names.filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n)))
    issues.push(...checkChartXml(name, texts[name]));
  for (const name of names.filter((n) => /^xl\/drawings\/drawing\d+\.xml$/.test(n)))
    issues.push(...checkChartXml(name, texts[name]));

  // 6) 儲存格不可以寫入 NaN／Infinity
  // 這兩個值不是合法的 XML Schema 數字。Excel 開檔時會判定內容損毀，
  // 一律跳「發現部分內容有問題」，修復後把整張工作表的公式與圖表清掉。
  for (const [name, text] of Object.entries(texts)) {
    if (!/^xl\/(worksheets|charts)\//.test(name)) continue;
    for (const hit of text.matchAll(/<(?:v|c:v)>([^<]*)<\/(?:v|c:v)>/g)) {
      const value = hit[1].trim();
      if (/^(-?NaN|-?Infinity|undefined|null)$/i.test(value))
        issues.push(`${name} 有非法的數值儲存格：${value}`);
    }
  }

  // 7) 資料驗證（下拉選單）的長度與字元限制
  // Excel 對「直接列舉清單」的公式有 255 字元上限，超過就開不了檔；
  // 清單本身以逗號分隔、用雙引號包起來，所以項目內不能出現半形逗號或
  // 雙引號，否則選項會被切錯或整段驗證失效。
  for (const [name, text] of Object.entries(texts)) {
    if (!/^xl\/worksheets\//.test(name)) continue;
    for (const hit of text.matchAll(
      /<dataValidation\b[^>]*>[\s\S]*?<\/dataValidation>|<dataValidation\b[^>]*\/>/g,
    )) {
      const formula = hit[0].match(/<formula1>([\s\S]*?)<\/formula1>/)?.[1] ?? "";
      const decoded = formula
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
      if (!decoded.startsWith('"')) continue; // 指到儲存格範圍的不受此限
      if (decoded.length > 255)
        issues.push(`${name} 的下拉選單清單超過 255 字元（${decoded.length}）`);
      const items = decoded.slice(1, -1).split(",");
      for (const item of items)
        if (/["]/.test(item))
          issues.push(`${name} 的下拉選單項目含有雙引號：${item}`);
    }
  }

  return { issues, parts: names, charts: names.filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n)) };
}

export { walk };
