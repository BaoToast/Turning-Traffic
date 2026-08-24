"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { jsPDF } from "jspdf";
import {
  Approach,
  bearingFromAngle,
  canonicalIntersectionKey,
  CORE_VEHICLE_LABELS,
  DEFAULT_PCE,
  FlowLayoutMode,
  formatMinutes,
  ImportPreview,
  IMPORT_FORMAT_TEMPLATES,
  inspectWorkbookVariants,
  Movement,
  normalizeIntersectionName,
  PceMatrix,
  pceFactor,
  PeakKey,
  Project,
  qualityIssues,
  referenceMovementForOd,
  recordTotal,
  rollingPeak,
  RouteFlow,
  totalMovement,
  TrafficRecord,
  VehicleKey,
  VERSION,
  VERSION_HISTORY,
  isSameSurvey,
} from "../lib/traffic";
import {
  branchBalance,
  conservationCheck,
  diagramCollisionWarnings,
  odMatrix,
  peakSensitivity,
  quarterQualitySummary,
  RecordRevision,
  compareQuarters,
  recordIntersectionKey,
  REPORT_ITEMS,
  ReportItemKey,
  ReportTemplate,
  normalizeReportItems,
  trendSeriesRecords,
  buildTrendSeries,
  VehicleScheme,
} from "../lib/final-features";
import {
  DRAFT_ONLY_SECTIONS,
  DRAFT_SECTION_LABELS,
  DRAFT_SECTION_ORDER,
  buildReportDraft,
  type DraftSectionKey,
  type ReportDraftContext,
} from "../lib/report-draft";
import {
  BRANCH_COMPOSITION_MODES,
  CONCLUSION_METRICS,
  DEFAULT_CONDITION,
  buildConclusion,
  normalizeCondition,
  quarterKey as conclusionQuarterKey,
  quarterYear,
  selectRecords,
  type ConclusionCondition,
  type ConclusionMetricKey,
  type ConclusionRecord,
  type ConclusionTemplate,
} from "../lib/conclusion";

type View =
  | "dashboard"
  | "projects"
  | "import"
  | "parameters"
  | "composition"
  | "inbound"
  | "diagram"
  | "compare"
  | "trend"
  | "audit"
  | "advanced"
  | "conclusion"
  | "quality"
  | "names"
  | "geometry"
  | "reports"
  | "backup"
  | "help";
type DiagramStyle = "formal" | "standard" | "simple";
type DisplayMode = "volume" | "percent" | "both";
type ArrowMode = "all" | "focus";
// 顯示模式同時也是版面保存的單位，直接沿用 lib 的型別避免兩邊定義漂移
type FlowSummaryMode = FlowLayoutMode;
type CompositionScope = PeakKey | "SURVEY";
type ImportResolution = {
  action: "auto" | "auto-new" | "new" | "merge" | "skip";
  targetId?: string;
};
type FormatMemory = {
  id: string;
  templateId: string;
  templateName: string;
  sheetPattern: string;
  columnCount: number;
  sampleFile: string;
  uses: number;
  lastUsedAt: string;
};
type VehicleMappingTable = Record<string, string>;
type ImportConflictMode = "overwrite" | "version" | "skip";

const NAV: { id: View; label: string; icon: string; group?: string }[] = [
  { id: "dashboard", label: "總覽儀表板", icon: "⌂" },
  { id: "projects", label: "多計畫管理", icon: "▦", group: "資料管理" },
  { id: "import", label: "季度批次匯入", icon: "⇧" },
  { id: "quality", label: "資料品質檢查", icon: "✓" },
  { id: "names", label: "路口名稱管理", icon: "Aa" },
  { id: "parameters", label: "車種轉向當量", icon: "ƒ" },
  { id: "geometry", label: "道路與流向管理", icon: "✣" },
  { id: "diagram", label: "路口轉向圖", icon: "↗", group: "分析與圖表" },
  { id: "composition", label: "車種組成分析", icon: "◔" },
  { id: "inbound", label: "各路口駛入／駛出流量", icon: "⇄" },
  { id: "compare", label: "跨計畫／多路口比較", icon: "▥" },
  { id: "trend", label: "歷季趨勢比較", icon: "⌁" },
  { id: "audit", label: "流量核對工作台", icon: "≋" },
  { id: "advanced", label: "轉向進階分析", icon: "▦" },
  { id: "conclusion", label: "結論草稿產生器", icon: "✎", group: "輸出與維護" },
  { id: "reports", label: "報表與批次輸出", icon: "▤" },
  { id: "backup", label: "備份、還原與版本", icon: "⟳" },
  { id: "help", label: "新手操作手冊", icon: "?" },
];

const VEHICLE_LABELS: Record<string, string> = {
  all: "全部車種",
  motorcycle: "機車",
  car: "小型車",
  heavy: "大型／大客車",
  special: "特種／聯結車",
};
const PCE_LABELS = {
  special: "特種／聯結車",
  heavy: "大型／大客車",
  car: "小型車",
  motorcycle: "機車",
};
const MOVE_LABELS = { left: "左轉", through: "直行", right: "右轉" };
const ANALYSIS_VEHICLES = ["motorcycle", "car", "heavy", "special"] as const;

function recordVehicleIds(record: TrafficRecord) {
  const ids = new Set<string>();
  Object.keys(record.vehicleLabels || {}).forEach(function (id) {
    ids.add(id);
  });
  Object.keys(record.survey?.vehicle || {}).forEach(function (id) {
    ids.add(id);
  });
  record.approaches.forEach(function (approach) {
    (["AM", "PM"] as PeakKey[]).forEach(function (peak) {
      Object.keys(approach.movements[peak].vehicle || {}).forEach(
        function (id) {
          ids.add(id);
        },
      );
    });
  });
  const ordered = ANALYSIS_VEHICLES.filter(function (id) {
    return ids.has(id);
  }) as string[];
  return ordered.concat(
    [...ids]
      .filter(function (id) {
        return !ordered.includes(id);
      })
      .sort(function (a, b) {
        return vehicleLabel(record, a).localeCompare(
          vehicleLabel(record, b),
          "zh-Hant",
        );
      }),
  );
}

function vehicleLabel(record: TrafficRecord | null | undefined, id: string) {
  return (
    record?.vehicleLabels?.[id] ||
    VEHICLE_LABELS[id] ||
    CORE_VEHICLE_LABELS[id] ||
    id.replace(/^custom:/, "")
  );
}

function recordVehicleTotal(
  record: TrafficRecord,
  scope: CompositionScope,
  vehicle: string,
) {
  if (scope === "SURVEY") return Number(record.survey?.vehicle[vehicle] || 0);
  return record.approaches.reduce(function (sum, approach) {
    return sum + Number(approach.movements[scope].vehicle[vehicle] || 0);
  }, 0);
}

function surveyDirectionRows(record: TrafficRecord) {
  const emptyVehicle = function () {
    return Object.fromEntries(
      recordVehicleIds(record).map(function (id) {
        return [id, 0];
      }),
    ) as Record<string, number>;
  };
  const analysisVehicles = recordVehicleIds(record);
  return record.approaches.flatMap(function (approach) {
    // 用詞定義（與全站一致）：
    //   駛出路口X ＝ 車輛「從支線 X 駛出」開進路口，也就是以 X 為起點（fromApproachId）。
    //   駛入路口X ＝ 車輛「從其他支線駛入 X」，也就是以 X 為終點（toApproachId）。
    const departing = emptyVehicle(); // 以本支線為起點
    const arriving = emptyVehicle(); // 以本支線為終點
    (record.routes || []).forEach(function (route) {
      if (!route.survey) return;
      if (route.fromApproachId === approach.id)
        analysisVehicles.forEach(function (vehicle) {
          departing[vehicle] += Number(route.survey?.vehicle[vehicle] || 0);
        });
      if (route.toApproachId === approach.id)
        analysisVehicles.forEach(function (vehicle) {
          arriving[vehicle] += Number(route.survey?.vehicle[vehicle] || 0);
        });
    });
    const bidirectional = emptyVehicle();
    analysisVehicles.forEach(function (vehicle) {
      bidirectional[vehicle] = departing[vehicle] + arriving[vehicle];
    });
    return [
      {
        approach,
        // 由該支線開往路口中心
        direction: bearingFromAngle(approach.angle + 180),
        relation: "駛出路口",
        vehicle: departing,
      },
      {
        approach,
        // 由路口中心開往該支線
        direction: bearingFromAngle(approach.angle),
        relation: "駛入路口",
        vehicle: arriving,
      },
      {
        approach,
        direction: "雙向",
        relation: "雙向合計",
        vehicle: bidirectional,
      },
    ];
  });
}

function esc(value: string | number) {
  return String(value).replace(/[<>&"']/g, function (char) {
    return (
      (
        {
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
          "'": "&apos;",
        } as Record<string, string>
      )[char] || char
    );
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  /*
   * 連結一定要先掛進頁面再按。
   * 沒掛進頁面的 <a> 在部分瀏覽器（含 Chromium 的部分版本與無頭模式）
   * 會忽略 download 屬性，檔案就存成沒有副檔名的 "download"——
   * 使用者一次匯出三個計畫的備份，收到三個都叫 download 的檔案，
   * 分不出哪個是哪個。實測 Chromium 無頭模式即為此症狀。
   */
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(function () {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 1500);
}

async function editableTrendWorkbookBlob(
  workbook: XLSX.WorkBook,
  sheetName: string,
  lastRow: number,
  series: Array<{ name: string; column: string; color: string }>,
) {
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const zip = await JSZip.loadAsync(bytes);
  const worksheetPath = "xl/worksheets/sheet1.xml";
  const worksheetFile = zip.file(worksheetPath);
  if (!worksheetFile) throw new Error("找不到趨勢資料工作表。");
  let worksheetXml = await worksheetFile.async("string");
  if (!/xmlns:r=/.test(worksheetXml))
    worksheetXml = worksheetXml.replace(
      /<worksheet\b/,
      '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    );
  worksheetXml = worksheetXml.replace(
    "</worksheet>",
    '<drawing r:id="rId1"/></worksheet>',
  );
  zip.file(worksheetPath, worksheetXml);

  zip.file(
    "xl/worksheets/_rels/sheet1.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "xl/drawings/drawing1.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      `<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${lastRow + 2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
      `<xdr:to><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${lastRow + 24}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
      '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="歷季趨勢圖"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic>' +
      "</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>",
  );
  zip.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>' +
      "</Relationships>",
  );
  const quotedSheet = "'" + sheetName.replace(/'/g, "''") + "'";
  const seriesXml = series
    .map(function (item, index) {
      return (
        `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>` +
        `<c:tx><c:strRef><c:f>${quotedSheet}!$${item.column}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(item.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
        `<c:spPr><a:ln w="38100" cap="rnd"><a:solidFill><a:srgbClr val="${item.color}"/></a:solidFill></a:ln></c:spPr>` +
        `<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="${item.color}"/></a:solidFill></a:ln></c:spPr></c:marker>` +
        `<c:cat><c:strRef><c:f>${quotedSheet}!$A$2:$A$${lastRow}</c:f></c:strRef></c:cat>` +
        `<c:val><c:numRef><c:f>${quotedSheet}!$${item.column}$2:$${item.column}$${lastRow}</c:f></c:numRef></c:val>` +
        "</c:ser>"
      );
    })
    .join("");
  zip.file(
    "xl/charts/chart1.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:style val="10"/>' +
      '<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-TW" sz="1500" b="1"><a:solidFill><a:srgbClr val="17333B"/></a:solidFill></a:rPr><a:t>歷季尖峰交通量趨勢（單位：PCU/hr）</a:t></a:r></a:p></c:rich></c:tx><c:layout/>' +
      '<c:overlay val="0"/></c:title><c:plotArea><c:layout/><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' +
      seriesXml +
      // CT_LineChart 的順序：grouping → varyColors → ser* → … → marker → smooth → axId。
      // c:smooth 一定要排在 c:ser 之後、c:axId 之前。
      '<c:marker val="1"/><c:smooth val="0"/><c:axId val="48650112"/><c:axId val="48672768"/></c:lineChart>' +
      '<c:catAx><c:axId val="48650112"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-TW" sz="1000"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:rPr><a:t>調查季度</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title><c:tickLblPos val="nextTo"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr/><a:defRPr sz="900"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:defRPr></a:p></c:txPr><c:crossAx val="48672768"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>' +
      '<c:valAx><c:axId val="48672768"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="DDE6E3"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:title><c:tx><c:rich><a:bodyPr rot="-5400000"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-TW" sz="1000"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:rPr><a:t>尖峰小時交通量（PCU/hr）</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title><c:numFmt formatCode="#,##0.0" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr/><a:defRPr sz="900"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:defRPr></a:p></c:txPr><c:crossAx val="48650112"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>' +
      '</c:plotArea><c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr/><a:defRPr sz="900"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:defRPr></a:p></c:txPr></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="DDE6E3"/></a:solidFill></a:ln></c:spPr></c:chartSpace>',
  );
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) throw new Error("Excel 格式缺少內容型別設定。");
  let contentTypes = await contentTypesFile.async("string");
  contentTypes = contentTypes.replace(
    "</Types>",
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
      '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
      "</Types>",
  );
  zip.file("[Content_Types].xml", contentTypes);
  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function downloadEditableTrendWorkbook(
  workbook: XLSX.WorkBook,
  sheetName: string,
  lastRow: number,
  series: Array<{ name: string; column: string; color: string }>,
  filename: string,
) {
  downloadBlob(
    await editableTrendWorkbookBlob(workbook, sheetName, lastRow, series),
    filename,
  );
}

function circularDistance(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function nameSimilarity(a: string, b: string) {
  const left = canonicalIntersectionKey(a),
    right = canonicalIntersectionKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const pairs = function (value: string) {
    return new Set(
      Array.from(
        { length: Math.max(1, value.length - 1) },
        function (_, index) {
          return value.slice(index, index + 2);
        },
      ),
    );
  };
  const leftPairs = pairs(left),
    rightPairs = pairs(right);
  const shared = [...leftPairs].filter(function (pair) {
    return rightPairs.has(pair);
  }).length;
  return (2 * shared) / Math.max(1, leftPairs.size + rightPairs.size);
}

function resultSignature(record: TrafficRecord) {
  const value = JSON.stringify({
    station: record.station,
    name: record.name,
    quarter: record.quarter,
    pceUsed: record.pceUsed,
    peaks: record.peaks,
    approaches: record.approaches,
    routes: record.routes,
  });
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function lockConflict(record: TrafficRecord) {
  if (!record.resultLock) return "";
  const reasons: string[] = [];
  if (record.resultLock.version !== VERSION)
    reasons.push("鎖定版本與目前系統版本不同");
  if (record.resultLock.signature !== resultSignature(record))
    reasons.push("鎖定後的資料內容已變更");
  return reasons.join("；");
}

function closestDestination(
  approaches: Approach[],
  sourceIndex: number,
  targetAngle: number,
) {
  return approaches
    .map(function (approach, index) {
      return {
        index: index,
        distance:
          index === sourceIndex
            ? 999
            : circularDistance(approach.angle, targetAngle),
      };
    })
    .sort(function (a, b) {
      return a.distance - b.distance;
    })[0].index;
}

function movementTargetIndex(
  approaches: Approach[],
  sourceIndex: number,
  movement: "left" | "through" | "right",
) {
  const source = approaches[sourceIndex];
  if (!source) return -1;
  const targetAngle =
    movement === "left"
      ? source.angle + 90
      : movement === "right"
        ? source.angle - 90
        : source.angle + 180;
  return closestDestination(approaches, sourceIndex, targetAngle);
}

function roundedPcu(value: number) {
  return Math.round(value * 10) / 10;
}

function destinationFlowTotal(
  record: TrafficRecord,
  peak: PeakKey,
  destinationIndex: number,
  vehicle: VehicleKey,
) {
  if (vehicle !== "all") {
    const destination = record.approaches[destinationIndex];
    if (record.routes?.length)
      return record.routes
        .filter(function (route) {
          return route.toApproachId === destination?.id;
        })
        .reduce(function (sum, route) {
          return sum + Number(route.volumes[peak].vehicle[vehicle] || 0);
        }, 0);
    // 舊版備份沒有 routes，這時要跟「全部車種」一樣改用幾何推導，
    // 否則駛入卡每一格都有數字、合計卻是 0，百分比也會全部變成 0%。
    return Math.round(
      record.approaches.reduce(function (sum, source, sourceIndex) {
        return (
          sum +
          (["left", "through", "right"] as const).reduce(function (
            movementSum,
            movement,
          ) {
            return movementTargetIndex(
              record.approaches,
              sourceIndex,
              movement,
            ) === destinationIndex
              ? movementSum +
                  totalMovement(source, peak, movement, vehicle, record.routes)
              : movementSum;
          }, 0)
        );
      }, 0),
    );
  }
  if (record.routes?.length) {
    const destination = record.approaches[destinationIndex];
    return roundedPcu(
      (record.routes || [])
        .filter(function (route) {
          return route.toApproachId === destination?.id;
        })
        .reduce(function (sum, route) {
          return sum + Number(route.volumes[peak].pcu || 0);
        }, 0),
    );
  }
  return roundedPcu(
    record.approaches.reduce(function (sum, source, sourceIndex) {
      return (
        sum +
        (["left", "through", "right"] as const).reduce(function (
          movementSum,
          movement,
        ) {
          return movementTargetIndex(
            record.approaches,
            sourceIndex,
            movement,
          ) === destinationIndex
            ? movementSum + source.movements[peak][movement]
            : movementSum;
        }, 0)
      );
    }, 0),
  );
}

function sourceFlowTotal(
  record: TrafficRecord,
  peak: PeakKey,
  sourceIndex: number,
) {
  const source = record.approaches[sourceIndex];
  if (!source) return 0;
  if (record.routes?.length)
    return roundedPcu(
      record.routes
        .filter(function (route) {
          return route.fromApproachId === source.id;
        })
        .reduce(function (sum, route) {
          return sum + Number(route.volumes[peak].pcu || 0);
        }, 0),
    );
  return roundedPcu(totalMovement(source, peak));
}

function branchPeakFlows(record: TrafficRecord, peak: PeakKey) {
  return record.approaches.map(function (approach, index) {
    return {
      approach,
      enteringIntersection: sourceFlowTotal(record, peak, index),
      leavingIntersection: destinationFlowTotal(record, peak, index, "all"),
    };
  });
}

function movementFromGeometry(
  source: Approach,
  destination: Approach,
): "left" | "through" | "right" {
  const incomingHeading = source.angle + 180;
  const delta = ((destination.angle - incomingHeading + 540) % 360) - 180;
  if (Math.abs(delta) <= 45) return "through";
  return delta < 0 ? "left" : "right";
}

function syncRouteTotals(record: TrafficRecord) {
  if (!record.routes?.length) return record;
  const pce = record.pceUsed || DEFAULT_PCE;
  record.routes.forEach(function (route) {
    (["AM", "PM"] as PeakKey[]).forEach(function (key) {
      route.volumes[key].pcu = roundedPcu(
        (
          Object.keys(route.volumes[key].vehicle) as Array<
            keyof typeof route.volumes.AM.vehicle
          >
        ).reduce(function (sum, vehicle) {
          return (
            sum +
            Number(route.volumes[key].vehicle[vehicle] || 0) *
              pceFactor(pce, vehicle, route.movement)
          );
        }, 0),
      );
    });
  });
  record.approaches.forEach(function (approach) {
    (["AM", "PM"] as PeakKey[]).forEach(function (key) {
      const totals = { left: 0, through: 0, right: 0 };
      record.routes
        ?.filter(function (route) {
          return route.fromApproachId === approach.id;
        })
        .forEach(function (route) {
          totals[route.movement] += route.volumes[key].pcu;
        });
      approach.movements[key].left = roundedPcu(totals.left);
      approach.movements[key].through = roundedPcu(totals.through);
      approach.movements[key].right = roundedPcu(totals.right);
    });
  });
  return record;
}

function applyReferenceMovementRule(record: TrafficRecord) {
  /*
   * 使用者自己確認過的轉向分類，任何情況下都不能被覆蓋。
   *
   * 這支函式在每次開啟網頁、每次還原備份時都會跑一遍。舊版沒有這一道檢查，
   * 於是使用者在「檢查起點→終點流向」手動改好的分類，重新整理之後就被
   * 內建的參考表改回去了——而畫面上明明寫著「本路口採人工確認分類；調整
   * 圖面角度不會覆蓋」。
   */
  if (record.movementRule === "manual") return syncRouteTotals(record);
  let applied = false;
  const armCodes = (record.approaches || []).map(function (approach) {
    return approach.sourceCode || "";
  });
  (record.routes || []).forEach(function (route) {
    const source = record.approaches.find(function (approach) {
      return approach.id === route.fromApproachId;
    });
    const destination = record.approaches.find(function (approach) {
      return approach.id === route.toApproachId;
    });
    const movement = referenceMovementForOd(
      record.name,
      source?.sourceCode || "",
      destination?.sourceCode || "",
      armCodes,
    );
    if (movement) {
      route.movement = movement;
      applied = true;
    }
  });
  if (applied) record.movementRule = "reference-calculation";
  return syncRouteTotals(record);
}

function syncRouteGeometry(record: TrafficRecord) {
  record.approaches.forEach(function (approach) {
    approach.bearing = bearingFromAngle(approach.angle);
  });
  if (!record.routes?.length) return record;
  if (
    record.movementRule === "reference-calculation" ||
    record.movementRule === "manual"
  )
    return syncRouteTotals(record);
  record.routes.forEach(function (route) {
    const source = record.approaches.find(function (approach) {
      return approach.id === route.fromApproachId;
    });
    const destination = record.approaches.find(function (approach) {
      return approach.id === route.toApproachId;
    });
    if (source && destination)
      route.movement = movementFromGeometry(source, destination);
  });
  record.movementRule = "geometry-suggested";
  return syncRouteTotals(record);
}

function inheritRecordGeometry(
  record: TrafficRecord,
  geometrySource: TrafficRecord,
) {
  const sourceByCode = new Map(
    geometrySource.approaches.map(function (approach) {
      return [approach.sourceCode || approach.id, approach] as const;
    }),
  );
  record.approaches.forEach(function (approach) {
    const source = sourceByCode.get(approach.sourceCode || approach.id);
    if (!source) return;
    approach.name = source.name;
    approach.angle = source.angle;
    approach.bearing = bearingFromAngle(source.angle);
  });
  const movementByCode = new Map<string, RouteFlow["movement"]>();
  (geometrySource.routes || []).forEach(function (route) {
    const from = geometrySource.approaches.find(function (approach) {
      return approach.id === route.fromApproachId;
    });
    const to = geometrySource.approaches.find(function (approach) {
      return approach.id === route.toApproachId;
    });
    if (from && to)
      movementByCode.set(
        (from.sourceCode || from.id) + "→" + (to.sourceCode || to.id),
        route.movement,
      );
  });
  (record.routes || []).forEach(function (route) {
    const from = record.approaches.find(function (approach) {
      return approach.id === route.fromApproachId;
    });
    const to = record.approaches.find(function (approach) {
      return approach.id === route.toApproachId;
    });
    const movement = movementByCode.get(
      (from?.sourceCode || from?.id || "") +
        "→" +
        (to?.sourceCode || to?.id || ""),
    );
    if (movement) route.movement = movement;
  });
  record.movementRule = geometrySource.movementRule;
  record.directionDisplay = structuredClone(
    geometrySource.directionDisplay || {},
  );
  return syncRouteTotals(record);
}

function synchronizeGeometryAcrossQuarters(records: TrafficRecord[]) {
  const latest = new Map<string, TrafficRecord>();
  records.forEach(function (record) {
    const key = (record.projectId || "") + "|" + recordIntersectionKey(record);
    const current = latest.get(key);
    if (!current || compareQuarters(current.quarter, record.quarter) < 0)
      latest.set(key, record);
  });
  return records.map(function (record) {
    const source = latest.get(
      (record.projectId || "") + "|" + recordIntersectionKey(record),
    );
    return source && source.id !== record.id
      ? inheritRecordGeometry(structuredClone(record), source)
      : record;
  });
}

/**
 * 取出某條支線在「目前這個顯示模式」下的圖卡位移。
 * 這個模式還沒被調整過時，沿用 v2.1.0 的 cardOffsets、再退回更舊的 cardOffset，
 * 讓既有資料在三種模式下都維持原本位置，直到使用者真的在該模式拖過為止。
 */
export function approachCardOffset(
  approach: Approach,
  mode: FlowLayoutMode,
  section: "inbound" | "outbound",
) {
  return (
    approach.cardLayouts?.[mode]?.cards?.[section] ??
    approach.cardOffsets?.[section] ??
    approach.cardOffset ?? { x: 0, y: 0 }
  );
}

/** 同上，但取的是路口標籤（例如「路口A」）的位移。 */
export function approachLabelOffset(approach: Approach, mode: FlowLayoutMode) {
  return (
    approach.cardLayouts?.[mode]?.label ??
    approach.labelOffset ?? { x: 0, y: 0 }
  );
}

/** 這條支線是否有任何手動調整過的版面（用於顯示狀態與停用還原鈕）。 */
export function hasManualLayout(approach: Approach) {
  return Boolean(
    approach.cardOffset ||
    approach.cardOffsets?.inbound ||
    approach.cardOffsets?.outbound ||
    approach.labelOffset ||
    Object.values(approach.cardLayouts || {}).some(function (layout) {
      return Boolean(
        layout?.label || layout?.cards?.inbound || layout?.cards?.outbound,
      );
    }),
  );
}

/** 已經調整過版面的模式清單，顯示成「駛入＋駛出、只看駛入」這種提示。 */
export function adjustedLayoutModes(approach: Approach) {
  const labels: Record<FlowLayoutMode, string> = {
    both: "駛入＋駛出",
    inbound: "只看駛入",
    outbound: "只看駛出",
  };
  const modes = (["both", "inbound", "outbound"] as FlowLayoutMode[]).filter(
    function (mode) {
      const layout = approach.cardLayouts?.[mode];
      return Boolean(
        layout?.label || layout?.cards?.inbound || layout?.cards?.outbound,
      );
    },
  );
  return modes.map(function (mode) {
    return labels[mode];
  });
}

export function diagramMarkup(
  record: TrafficRecord,
  peak: PeakKey,
  style: DiagramStyle,
  mode: DisplayMode,
  vehicle: VehicleKey,
  arrowMode: ArrowMode,
  focusIndex: number,
  flowSummaryMode: FlowSummaryMode = "both",
) {
  const n = record.approaches.length;
  const expandedCanvas = style === "formal" || (style === "standard" && n > 4);
  const width = expandedCanvas ? 1200 : 1000,
    height = expandedCanvas ? 900 : 820,
    cx = width / 2,
    cy = expandedCanvas ? 470 : 430;
  const unit = vehicle === "all" ? "PCU/hr" : "輛/hr";
  const total = Math.max(
    1,
    record.approaches.reduce(function (sum, approach) {
      return sum + totalMovement(approach, peak, undefined, vehicle);
    }, 0),
  );
  const point = function (angle: number, radius: number) {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + Math.cos(rad) * radius, y: cy + Math.sin(rad) * radius };
  };
  const roadParts: string[] = [];
  const pathParts: string[] = [];
  const cardParts: string[] = [];
  const pendingCards: Array<{
    markup: string;
    handle: string;
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
    preferred: { x: number; y: number };
    manualOffset: { x: number; y: number };
    width: number;
    height: number;
  }> = [];
  const names = ["left", "through", "right"] as const;
  const offsets = [-12, 0, 12];
  const colors = { left: "#d64ba7", through: "#2166d1", right: "#e24538" };
  /*
   * 箭頭一律畫「起點支線 → 目的支線」的完整曲線，箭頭落在目的支線那一端。
   * 舊版在只看駛入／只看駛出時把貝茲曲線從中點切一半，結果箭頭停在路口中央，
   * 看起來像是車開到路口就消失，方向也讀不出來。要限制方向請改用聚焦支線
   * （見下方 keepRoute）：只看駛出＝從該支線畫出去，只看駛入＝各支線畫進來。
   */
  const routePath = function (
    start: { x: number; y: number },
    control: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    return (
      "M " +
      start.x.toFixed(1) +
      " " +
      start.y.toFixed(1) +
      " Q " +
      control.x.toFixed(1) +
      " " +
      control.y.toFixed(1) +
      " " +
      end.x.toFixed(1) +
      " " +
      end.y.toFixed(1)
    );
  };
  /*
   * 聚焦模式下要留哪些箭頭：
   *   只看駛出 → 起點是聚焦支線的（從聚焦支線指向其他每個路口）
   *   只看駛入 → 目的地是聚焦支線的（其他每個路口指向聚焦支線）
   *   駛入＋駛出 → 兩者都留
   */
  const keepRoute = function (sourceIndex: number, destinationIndex: number) {
    if (arrowMode !== "focus") return true;
    if (flowSummaryMode === "inbound") return destinationIndex === focusIndex;
    if (flowSummaryMode === "outbound") return sourceIndex === focusIndex;
    return sourceIndex === focusIndex || destinationIndex === focusIndex;
  };

  record.approaches.forEach(function (approach, index) {
    const p = point(approach.angle, 205);
    const roadWidth = n > 5 ? 62 : 90;
    roadParts.push(
      '<g transform="rotate(' +
        (approach.angle + 90) +
        " " +
        cx +
        " " +
        cy +
        ')">' +
        '<rect x="' +
        (cx - roadWidth / 2) +
        '" y="85" width="' +
        roadWidth +
        '" height="300" rx="3" class="road"/>' +
        '<path d="M ' +
        cx +
        ' 98 V 374" class="divider"/></g>' +
        '<g class="road-label" data-label-id="' +
        esc(approach.id) +
        // 標籤也要標示自動基準點與可放置範圍，拖曳時才知道要從哪裡起算。
        // 少了這些屬性會被當成基準點 (0,0)，一拖就整個跳到畫面左上角。
        '" data-base-x="' +
        p.x.toFixed(1) +
        '" data-base-y="' +
        p.y.toFixed(1) +
        '" data-min-x="85" data-max-x="' +
        (width - 85).toFixed(1) +
        '" data-min-y="20" data-max-y="' +
        (height - 20).toFixed(1) +
        '" transform="translate(' +
        Math.max(
          85,
          Math.min(
            width - 85,
            p.x + Number(approachLabelOffset(approach, flowSummaryMode).x || 0),
          ),
        ).toFixed(1) +
        " " +
        Math.max(
          20,
          Math.min(
            height - 20,
            p.y + Number(approachLabelOffset(approach, flowSummaryMode).y || 0),
          ),
        ).toFixed(1) +
        ')"><rect x="-77" y="-14" width="154" height="28" rx="14" class="road-label-bg"/>' +
        '<text class="road-name" x="0" y="5">' +
        esc(approach.name) +
        "</text></g>",
    );

    const values = names.map(function (key) {
      return totalMovement(approach, peak, key, vehicle, record.routes);
    });
    const approachTotal = values.reduce(function (a, b) {
      return a + b;
    }, 0);
    const destinations = names.map(function (movement) {
      return movementTargetIndex(record.approaches, index, movement);
    });
    const explicitRoutes = (record.routes || []).filter(function (route) {
      return route.fromApproachId === approach.id;
    });
    const incomingRoutes = (record.routes || []).filter(function (route) {
      return route.toApproachId === approach.id;
    });
    if (explicitRoutes.length) {
      explicitRoutes.forEach(function (route, routeIndex) {
        const destinationIndex = record.approaches.findIndex(function (item) {
          return item.id === route.toApproachId;
        });
        if (destinationIndex < 0) return;
        if (!keepRoute(index, destinationIndex)) return;
        const destination = record.approaches[destinationIndex];
        const routeValue =
          vehicle === "all"
            ? route.volumes[peak].pcu
            : Number(route.volumes[peak].vehicle[vehicle] || 0);
        const laneOffset = (routeIndex - (explicitRoutes.length - 1) / 2) * 1.6;
        const start = point(approach.angle + laneOffset, 145);
        const end = point(destination.angle - laneOffset, 158);
        const klass =
          arrowMode === "focus"
            ? "movement-path focus " +
              route.movement +
              (routeValue ? "" : " zero")
            : "movement-path " + route.movement + (routeValue ? "" : " zero");
        pathParts.push(
          '<path class="' +
            klass +
            " summary-" +
            flowSummaryMode +
            '" d="' +
            routePath(start, { x: cx, y: cy }, end) +
            '" marker-end="url(#arrow-' +
            route.movement +
            ')"><title>' +
            esc(approach.name) +
            " → " +
            esc(destination.name) +
            "：" +
            routeValue.toLocaleString() +
            " " +
            unit +
            "</title></path>",
        );
      });
    } else {
      names.forEach(function (key, moveIndex) {
        if (!keepRoute(index, destinations[moveIndex])) return;
        const start = point(approach.angle, 145 + offsets[moveIndex]);
        const destination = record.approaches[destinations[moveIndex]];
        const end = point(destination.angle, 158 + offsets[moveIndex]);
        const sourceRad = (approach.angle * Math.PI) / 180;
        const normalX = -Math.sin(sourceRad) * offsets[moveIndex];
        const normalY = Math.cos(sourceRad) * offsets[moveIndex];
        const c1x = cx + normalX * 2.2,
          c1y = cy + normalY * 2.2;
        const klass =
          arrowMode === "focus"
            ? "movement-path focus " + key
            : "movement-path " + key;
        pathParts.push(
          '<path class="' +
            klass +
            " summary-" +
            flowSummaryMode +
            '" d="' +
            routePath(start, { x: c1x, y: c1y }, end) +
            '" marker-end="url(#arrow-' +
            key +
            ')"><title>' +
            esc(approach.name) +
            " " +
            MOVE_LABELS[key] +
            " → " +
            esc(destination.name) +
            "</title></path>",
        );
      });
    }

    if (style === "simple") return;
    const cardWidth =
      flowSummaryMode === "both"
        ? style === "formal"
          ? 216
          : 198
        : style === "formal"
          ? 246
          : n > 4
            ? 210
            : 230;
    const cardHeight = 116;
    const approachRad = (approach.angle * Math.PI) / 180;
    const radialCardExtent =
      Math.abs(Math.cos(approachRad)) * (cardWidth / 2) +
      Math.abs(Math.sin(approachRad)) * (cardHeight / 2);
    const radialLabelExtent =
      Math.abs(Math.cos(approachRad)) * 77 +
      Math.abs(Math.sin(approachRad)) * 14;
    const minimumCardRadius = 205 + radialLabelExtent + radialCardExtent + 20;
    const baseCardP = point(
      approach.angle,
      Math.max(n > 4 ? 355 : 315, minimumCardRadius),
    );
    // 位移改由 pushCard 依「駛入／駛出」各自套用，這裡只保留自動算出的基準位置。
    const cardP = { x: baseCardP.x, y: baseCardP.y };
    const cell = cardWidth / 3;
    const formatter = function (value: number, sectionTotal: number) {
      const pct = sectionTotal
        ? Math.round((value / sectionTotal) * 100) + "%"
        : "0%";
      if (mode === "percent") return pct;
      if (mode === "volume") return value.toLocaleString() + " " + unit;
      return value.toLocaleString() + " " + unit + " | " + pct;
    };
    const destinationLabels = names.map(function (key, movementIndex) {
      const explicit = explicitRoutes
        .filter(function (route) {
          return route.movement === key;
        })
        .map(function (route) {
          return (
            record.approaches
              .find(function (item) {
                return item.id === route.toApproachId;
              })
              ?.name.replace(/^路口\s*/, "") || ""
          );
        })
        .filter(Boolean);
      return explicit.length
        ? explicit.join("、")
        : record.approaches[destinations[movementIndex]].name;
    });
    const destinationTotal = destinationFlowTotal(record, peak, index, vehicle);
    const sourceCode = approach.sourceCode || String.fromCharCode(65 + index);
    const incomingValues = names.map(function (movement) {
      if (incomingRoutes.length)
        return roundedPcu(
          incomingRoutes
            .filter(function (route) {
              return route.movement === movement;
            })
            .reduce(function (sum, route) {
              return (
                sum +
                (vehicle === "all"
                  ? Number(route.volumes[peak].pcu || 0)
                  : Number(route.volumes[peak].vehicle[vehicle] || 0))
              );
            }, 0),
        );
      return roundedPcu(
        record.approaches.reduce(function (sum, source, sourceIndex) {
          return (
            sum +
            names.reduce(function (movementSum, sourceMovement) {
              if (
                sourceMovement !== movement ||
                movementTargetIndex(
                  record.approaches,
                  sourceIndex,
                  sourceMovement,
                ) !== index
              )
                return movementSum;
              return (
                movementSum +
                totalMovement(
                  source,
                  peak,
                  sourceMovement,
                  vehicle,
                  record.routes,
                )
              );
            }, 0)
          );
        }, 0),
      );
    });
    const incomingSources = names.map(function (movement) {
      if (incomingRoutes.length)
        return incomingRoutes
          .filter(function (route) {
            return route.movement === movement;
          })
          .map(function (route) {
            return (
              record.approaches.find(function (item) {
                return item.id === route.fromApproachId;
              })?.sourceCode || ""
            );
          })
          .filter(Boolean)
          .join("、");
      return record.approaches
        .map(function (source, sourceIndex) {
          return movementTargetIndex(
            record.approaches,
            sourceIndex,
            movement,
          ) === index
            ? source.sourceCode || source.name
            : "";
        })
        .filter(Boolean)
        .join("、");
    });
    const cardSection = function (
      section: "inbound" | "outbound",
      sectionValues: number[],
      sectionTotal: number,
      labels: string[],
    ) {
      const title = section === "inbound" ? "駛入路口" : "駛出路口";
      return (
        '<text x="' +
        cardWidth / 2 +
        '" y="14" class="section-title ' +
        section +
        '">' +
        title +
        esc(sourceCode) +
        "</text>" +
        '<line x1="0" x2="' +
        cardWidth +
        '" y1="22" y2="22" class="cell-line"/>' +
        '<line x1="' +
        cell +
        '" x2="' +
        cell +
        '" y1="22" y2="82" class="cell-line"/>' +
        '<line x1="' +
        cell * 2 +
        '" x2="' +
        cell * 2 +
        '" y1="22" y2="82" class="cell-line"/>' +
        names
          .map(function (key, moveIndex) {
            const percentage = sectionTotal
              ? Math.round((sectionValues[moveIndex] / sectionTotal) * 100) +
                "%"
              : "0%";
            const directionLabel =
              section === "inbound"
                ? "←" + (labels[moveIndex] || "－")
                : "→" + (labels[moveIndex] || "－");
            const valueMarkup =
              mode === "both"
                ? '<text x="' +
                  cell * (moveIndex + 0.5) +
                  '" y="65" class="value">' +
                  esc(sectionValues[moveIndex].toLocaleString() + " " + unit) +
                  '</text><text x="' +
                  cell * (moveIndex + 0.5) +
                  '" y="78" class="percent">' +
                  percentage +
                  "</text>"
                : '<text x="' +
                  cell * (moveIndex + 0.5) +
                  '" y="71" class="value">' +
                  esc(formatter(sectionValues[moveIndex], sectionTotal)) +
                  "</text>";
            return (
              '<text x="' +
              cell * (moveIndex + 0.5) +
              '" y="38" class="turn ' +
              key +
              '">' +
              MOVE_LABELS[key] +
              '</text><text x="' +
              cell * (moveIndex + 0.5) +
              '" y="52" class="destination">' +
              esc(directionLabel.slice(0, 9)) +
              "</text>" +
              valueMarkup
            );
          })
          .join("") +
        '<text x="' +
        cardWidth / 2 +
        '" y="96" class="' +
        (section === "inbound" ? "destination-sum" : "sum") +
        '">' +
        title +
        esc(sourceCode) +
        "合計 " +
        sectionTotal.toLocaleString() +
        " " +
        unit +
        "</text>"
      );
    };
    const pushCard = function (
      section: "inbound" | "outbound",
      centerPoint: { x: number; y: number },
    ) {
      const bounds = {
        minX: 8,
        maxX: width - cardWidth - 8,
        minY: 112,
        maxY: height - cardHeight - 8,
      };
      const clampX = function (value: number) {
        return Math.max(bounds.minX, Math.min(bounds.maxX, value));
      };
      const clampY = function (value: number) {
        return Math.max(bounds.minY, Math.min(bounds.maxY, value));
      };
      const x = clampX(centerPoint.x - cardWidth / 2);
      const y = clampY(centerPoint.y - cardHeight / 2);
      const sectionMarkup =
        section === "inbound"
          ? cardSection(
              "inbound",
              incomingValues,
              destinationTotal,
              incomingSources,
            )
          : cardSection("outbound", values, approachTotal, destinationLabels);
      const markup =
        '<g class="flow-card-group ' +
        section +
        '">' +
        '<rect width="' +
        cardWidth +
        '" height="' +
        cardHeight +
        '" rx="9" class="flow-card"/>' +
        '<text x="' +
        cardWidth / 2 +
        '" y="-9" class="bearing">' +
        (section === "outbound" ? "來源 " : "目的 ") +
        esc(sourceCode) +
        " · " +
        esc(approach.name) +
        "</text>" +
        sectionMarkup +
        "</g>";
      // 駛入卡與駛出卡各自記自己的位移，而且是「這個顯示模式」專屬的一組。
      const manualOffset = approachCardOffset(
        approach,
        flowSummaryMode,
        section,
      );
      /*
       * 把「自動排版的基準座標」與「可放置範圍」一起輸出到 DOM。
       * 拖曳時如果只用「原位移＋滑鼠位移」回存，一旦位置被邊界夾住，
       * 存下來的數字就會超出畫布，下次要往回拖時得先把超出的量拖回來，
       * 使用者會覺得卡片黏住不動、或是在不同顯示模式之間亂跳。
       * 有了基準與範圍，拖曳可以先夾好再換算成位移，畫面與存檔永遠一致。
       */
      const handle =
        ' data-card-id="' +
        esc(approach.id) +
        '" data-card-section="' +
        section +
        '"';
      const geometryAttrs = function (baseX: number, baseY: number) {
        return (
          ' data-base-x="' +
          baseX.toFixed(1) +
          '" data-base-y="' +
          baseY.toFixed(1) +
          '" data-min-x="' +
          bounds.minX +
          '" data-max-x="' +
          bounds.maxX.toFixed(1) +
          '" data-min-y="' +
          bounds.minY +
          '" data-max-y="' +
          bounds.maxY.toFixed(1) +
          '"'
        );
      };
      if (n > 4) {
        pendingCards.push({
          markup,
          handle,
          bounds,
          preferred: { x: x + cardWidth / 2, y: y + cardHeight / 2 },
          manualOffset: {
            x: Number(manualOffset.x || 0),
            y: Number(manualOffset.y || 0),
          },
          width: cardWidth,
          height: cardHeight,
        });
      } else {
        cardParts.push(
          "<g" +
            handle +
            geometryAttrs(x, y) +
            ' transform="translate(' +
            clampX(x + Number(manualOffset.x || 0)).toFixed(1) +
            " " +
            clampY(y + Number(manualOffset.y || 0)).toFixed(1) +
            ')">' +
            markup +
            "</g>",
        );
      }
    };
    if (flowSummaryMode === "both") {
      const tangent = { x: -Math.sin(approachRad), y: Math.cos(approachRad) };
      const splitOffset = cardWidth / 2 + roadWidth / 2 + 10;
      pushCard("outbound", {
        x: cardP.x + tangent.x * splitOffset,
        y: cardP.y + tangent.y * splitOffset,
      });
      pushCard("inbound", {
        x: cardP.x - tangent.x * splitOffset,
        y: cardP.y - tangent.y * splitOffset,
      });
    } else {
      pushCard(flowSummaryMode, cardP);
    }
  });

  if (pendingCards.length) {
    const cardWidth = Math.max.apply(
      null,
      pendingCards.map(function (card) {
        return card.width;
      }),
    );
    const cardHeight = Math.max.apply(
      null,
      pendingCards.map(function (card) {
        return card.height;
      }),
    );
    const horizontalCenters = Array.from({ length: 4 }, function (_, index) {
      const left = 16;
      const usable = width - left * 2 - cardWidth;
      return left + cardWidth / 2 + (usable * index) / 3;
    });
    const topCenterY = 184;
    const bottomCenterY = height - cardHeight / 2 - 10;
    const sideCenterX = cardWidth / 2 + 10;
    const sideCentersY = [340, 490, 640];
    const perimeterSlots = horizontalCenters
      .map(function (x) {
        return { x, y: topCenterY };
      })
      .concat(
        sideCentersY.map(function (y) {
          return { x: width - sideCenterX, y };
        }),
        horizontalCenters
          .slice()
          .reverse()
          .map(function (x) {
            return { x, y: bottomCenterY };
          }),
        sideCentersY
          .slice()
          .reverse()
          .map(function (y) {
            return { x: sideCenterX, y };
          }),
      );
    /*
     * 舊版用「位元遮罩 + 遞迴」窮舉所有卡片與外圍格位的配對，複雜度是
     * O(格位數 × 2^格位數 × 卡片數)：7 叉路口有 14 張卡、14 個格位時，光是一次
     * 重繪就要跑上百萬次遞迴，而這個函式在每次 render 會被呼叫兩三次——拖曳時
     * 每秒重繪數十次，分頁就會直接卡死。卡片多於格位時還會 throw，而它是在
     * render 當中被呼叫的，一 throw 整個畫面就變成空白錯誤頁。
     *
     * 改成「先貪婪配對最近的格位，再做幾輪兩兩交換」：結果與窮舉幾乎一樣好，
     * 但複雜度降到 O(卡片數 × 格位數)，而且格位不足時會自動補位而不是丟例外。
     */
    // 卡片比外圍格位多時往下再長一圈。
    // 原本的取模寫法 (len % len) 恆為 0，會一直複製第一個格位，
    // 而且 ring 對 14～27 都算出同一個值，結果補出來的格位互相重疊。
    const baseSlotCount = perimeterSlots.length;
    while (perimeterSlots.length < pendingCards.length && baseSlotCount > 0) {
      const index = perimeterSlots.length - baseSlotCount;
      const source = perimeterSlots[index % baseSlotCount];
      const ring = Math.floor(index / baseSlotCount) + 1;
      perimeterSlots.push({
        x: source.x,
        y: source.y + ring * (cardHeight + 12),
      });
    }
    const distance = function (cardIndex: number, slotIndex: number) {
      const dx =
        pendingCards[cardIndex].preferred.x - perimeterSlots[slotIndex].x;
      const dy =
        pendingCards[cardIndex].preferred.y - perimeterSlots[slotIndex].y;
      return dx * dx + dy * dy;
    };
    const pairs: Array<{ card: number; slot: number; cost: number }> = [];
    pendingCards.forEach(function (_, cardIndex) {
      perimeterSlots.forEach(function (__, slotIndex) {
        pairs.push({
          card: cardIndex,
          slot: slotIndex,
          cost: distance(cardIndex, slotIndex),
        });
      });
    });
    pairs.sort(function (a, b) {
      return a.cost - b.cost;
    });
    const assignedSlots = new Array<number>(pendingCards.length).fill(-1);
    const takenSlots = new Set<number>();
    pairs.forEach(function (pair) {
      if (assignedSlots[pair.card] >= 0 || takenSlots.has(pair.slot)) return;
      assignedSlots[pair.card] = pair.slot;
      takenSlots.add(pair.slot);
    });
    // 補上貪婪階段沒配到的卡片（理論上不會發生，但絕不讓它在 render 裡爆掉）
    assignedSlots.forEach(function (slot, cardIndex) {
      if (slot >= 0) return;
      const free = perimeterSlots.findIndex(function (_, slotIndex) {
        return !takenSlots.has(slotIndex);
      });
      assignedSlots[cardIndex] = free >= 0 ? free : 0;
      takenSlots.add(assignedSlots[cardIndex]);
    });
    // 兩兩交換：只要換過去總距離更短就換，跑幾輪就會收斂
    for (let pass = 0; pass < 4; pass += 1) {
      let improved = false;
      for (let a = 0; a < assignedSlots.length; a += 1)
        for (let b = a + 1; b < assignedSlots.length; b += 1) {
          const before =
            distance(a, assignedSlots[a]) + distance(b, assignedSlots[b]);
          const after =
            distance(a, assignedSlots[b]) + distance(b, assignedSlots[a]);
          if (after < before - 0.5) {
            const swap = assignedSlots[a];
            assignedSlots[a] = assignedSlots[b];
            assignedSlots[b] = swap;
            improved = true;
          }
        }
      if (!improved) break;
    }
    pendingCards.forEach(function (card, cardIndex) {
      const slot = perimeterSlots[assignedSlots[cardIndex]];
      const bounds = card.bounds;
      const baseX = Math.max(
        bounds.minX,
        Math.min(bounds.maxX, slot.x - card.width / 2),
      );
      const baseY = Math.max(
        bounds.minY,
        Math.min(bounds.maxY, slot.y - card.height / 2),
      );
      const x = Math.max(
        bounds.minX,
        Math.min(bounds.maxX, baseX + card.manualOffset.x),
      );
      const y = Math.max(
        bounds.minY,
        Math.min(bounds.maxY, baseY + card.manualOffset.y),
      );
      cardParts.push(
        "<g" +
          card.handle +
          ' data-base-x="' +
          baseX.toFixed(1) +
          '" data-base-y="' +
          baseY.toFixed(1) +
          '" data-min-x="' +
          bounds.minX +
          '" data-max-x="' +
          bounds.maxX.toFixed(1) +
          '" data-min-y="' +
          bounds.minY +
          '" data-max-y="' +
          bounds.maxY.toFixed(1) +
          '" transform="translate(' +
          x.toFixed(1) +
          " " +
          y.toFixed(1) +
          ')" class="multi-arm-card">' +
          card.markup +
          "</g>",
      );
    });
  }

  const peakText =
    peak + " Peak " + record.peaks[peak].start + "–" + record.peaks[peak].end;
  const meta =
    style === "simple"
      ? ""
      : '<g class="meta"><text x="30" y="38" class="title">' +
        esc(record.station) +
        "｜" +
        esc(record.name) +
        "</text>" +
        '<text x="30" y="64">調查日期 ' +
        esc(record.date || "未填") +
        "　" +
        esc(peakText) +
        "　單位：" +
        unit +
        "</text>" +
        '<text x="30" y="86">季度 ' +
        esc(record.quarter) +
        "　車種 " +
        esc(vehicle === "all" ? "全部車種" : vehicleLabel(record, vehicle)) +
        "　全路口流量 " +
        total.toLocaleString() +
        " " +
        unit +
        "</text></g>";
  const focusNote =
    arrowMode === "focus" && record.approaches[focusIndex]
      ? '<g transform="translate(30 775)"><text class="legend-title">聚焦：' +
        esc(record.approaches[focusIndex].name) +
        "</text></g>"
      : "";

  return (
    '<svg id="turning-svg" xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    width +
    " " +
    height +
    '" role="img" aria-label="' +
    esc(record.name) +
    " " +
    esc(peakText) +
    ' 轉向圖">' +
    "<style>.canvas{fill:#fffdf8}.road{fill:#e8edf0;stroke:#9eabb1;stroke-width:1.4}.divider{fill:none;stroke:#fff;stroke-width:2;stroke-dasharray:9 8}.road-label-bg{fill:#fffdf8;stroke:#d5dddf}.road-name{font:600 12px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#334d56;text-anchor:middle}.junction{fill:#dfe6e8;stroke:#819198;stroke-width:2}.flow-card{fill:#fff;stroke:#1b5364;stroke-width:1.5;filter:url(#shadow)}.cell-line{stroke:#cfdbdf}.bearing{font:600 11px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#274b58;text-anchor:middle}.turn{font:700 10px sans-serif;text-anchor:middle}.turn.left{fill:#b82d89}.turn.through{fill:#1656b4}.turn.right{fill:#c6352a}.destination{font:8px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#718188;text-anchor:middle}.value{font:700 8px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#102c36;text-anchor:middle}.percent{font:700 8px sans-serif;fill:#60747b;text-anchor:middle}.sum{font:600 9px sans-serif;fill:#087f75;text-anchor:middle}.title{font:700 19px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#102c36}.meta text:not(.title){font:11px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#5f7076}.north{font:700 13px sans-serif;fill:#183d49}.center-label{font:700 12px sans-serif;fill:#fff;text-anchor:middle}.center-dot{fill:#0e7c75}.movement-path{fill:none;stroke-width:2;opacity:.54}.movement-path.left{stroke:" +
    colors.left +
    "}.destination-sum{font:600 9px sans-serif;fill:#8a5d16;text-anchor:middle}.movement-path.zero{opacity:.18;stroke-dasharray:5 4}.movement-path.through{stroke:" +
    colors.through +
    "}.movement-path.right{stroke:" +
    colors.right +
    "}.movement-path.focus{stroke-width:5;opacity:.98}.legend text{font:700 10px Noto Sans TC,sans-serif;fill:#415961}.legend-title{font:700 11px Noto Sans TC,sans-serif;fill:#173d49}" +
    // 圖卡標題（駛入路口A／駛出路口A）：原本沒有任何樣式，text-anchor 預設是 start，
    // 所以文字從卡片正中央往右排、看起來靠右甚至溢出卡片。補上置中與字級。
    ".section-title{font:700 13px Noto Sans TC,Microsoft JhengHei,sans-serif;text-anchor:middle;dominant-baseline:middle}.section-title.inbound{fill:#0e5f74}.section-title.outbound{fill:#8a4b12}" +
    "[data-card-id],[data-label-id]{cursor:grab}[data-card-id]:active,[data-label-id]:active{cursor:grabbing}" +
    "</style>" +
    '<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity=".12"/></filter>' +
    '<marker id="arrow-left" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="' +
    colors.left +
    '"/></marker>' +
    '<marker id="arrow-through" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="' +
    colors.through +
    '"/></marker>' +
    '<marker id="arrow-right" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="' +
    colors.right +
    '"/></marker></defs>' +
    '<rect class="canvas" width="' +
    width +
    '" height="' +
    height +
    '" rx="12"/>' +
    meta +
    roadParts.join("") +
    '<rect x="' +
    (cx - 82) +
    '" y="' +
    (cy - 82) +
    '" width="164" height="164" rx="18" class="junction"/>' +
    pathParts.join("") +
    '<circle cx="' +
    cx +
    '" cy="' +
    cy +
    '" r="31" class="center-dot"/><text x="' +
    cx +
    '" y="' +
    (cy - 3) +
    '" class="center-label">' +
    esc(record.station) +
    '</text><text x="' +
    cx +
    '" y="' +
    (cy + 15) +
    '" class="center-label">' +
    peak +
    "</text>" +
    cardParts.join("") +
    '<g class="legend" transform="translate(' +
    (width - 280) +
    " " +
    (height - 26) +
    // 這是流向箭頭的顏色圖例。舊版三個項目都寫成同樣的「●」而沒有上色，
    // 三個黑點看起來毫無意義；現在改成畫出與圖上箭頭同色的短線加箭頭。
    ')">' +
    (["left", "through", "right"] as const)
      .map(
        (movement, index) =>
          '<g transform="translate(' +
          index * 78 +
          ' 0)"><path d="M0 -4H22" stroke="' +
          colors[movement] +
          '" stroke-width="3" stroke-linecap="round" marker-end="url(#arrow-' +
          movement +
          ')"/><text x="30" y="0">' +
          MOVE_LABELS[movement] +
          "</text></g>",
      )
      .join("") +
    "</g>" +
    focusNote +
    '<g transform="translate(' +
    (width - 52) +
    ' 26)"><text x="12" y="12" class="north">N</text><path d="M12 56V21M12 21L5 32M12 21l7 11" fill="none" stroke="#183d49" stroke-width="2"/></g></svg>'
  );
}

async function svgToPng(svg: string, scale = 2) {
  return new Promise<Blob>(function (resolve, reject) {
    const image = new Image();
    const url = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    );
    image.onload = function () {
      const canvas = document.createElement("canvas");
      canvas.width = image.width * scale;
      canvas.height = image.height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas unavailable"));
      ctx.scale(scale, scale);
      ctx.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob) {
        return blob
          ? resolve(blob)
          : reject(new Error("PNG conversion failed"));
      }, "image/png");
    };
    image.onerror = reject;
    image.src = url;
  });
}

/*
 * 欄位對應不到支線時的空白轉向量。
 *
 * 舊版是把 values 依 index*3 切三格當成左／直／右直接存進去，有兩個致命問題：
 * 1. values 的順序是「車種 × 轉向」（機車左/機車直/機車右/小型車左…），
 *    不是「支線 × 轉向」，所以切出來的三格根本不是那一支支線的量。
 * 2. 完全沒有乘當量係數，卻存進 left/through/right 這三個「PCU 欄位」——
 *    實測 400 輛機車左轉（＝200 PCU/hr）被記成 400 PCU/hr，剛好兩倍，
 *    而且預覽畫面顯示 200、寫入之後變成 400，同一次匯入兩個數字。
 * 對應不到就是對應不到，寧可留白讓使用者去修檔案或設定車種對應，
 * 也不要給一個兩倍且單位錯誤的數字。
 */
function emptyMovement() {
  return {
    left: 0,
    through: 0,
    right: 0,
    vehicle: {} as Record<string, number>,
    rawVehicleTotal: null,
  };
}

function mappedMovement(
  item: ImportPreview,
  peak: PeakKey,
  approachName: string,
  pce: PceMatrix,
  vehicleMappings: VehicleMappingTable,
) {
  const values = peak === "AM" ? item.am?.values : item.pm?.values;
  const vehicle: Record<string, number> = {};
  const raw = { left: 0, through: 0, right: 0 };
  const pcu = { left: 0, through: 0, right: 0 };
  item.columns
    .filter(function (column) {
      return column.approach === approachName;
    })
    .forEach(function (column) {
      const count = Number(values?.[column.valueIndex]) || 0;
      const movement = column.movement || "through";
      const analysisVehicle = vehicleMappings[column.vehicle] || column.vehicle;
      vehicle[analysisVehicle] = Number(vehicle[analysisVehicle] || 0) + count;
      raw[movement] += count;
      pcu[movement] += count * pceFactor(pce, analysisVehicle, movement);
    });
  return {
    left: roundedPcu(pcu.left),
    through: roundedPcu(pcu.through),
    right: roundedPcu(pcu.right),
    vehicle: vehicle,
    rawVehicleTotal: raw.left + raw.through + raw.right,
  };
}

function inferApproachGeometry(
  item: ImportPreview,
  mappedNames: string[],
  movements: Array<{ AM: Movement; PM: Movement }>,
) {
  const count = mappedNames.length;
  const angles = Array.from({ length: count }, function (_, index) {
    return -90 + (index * 360) / Math.max(1, count);
  });
  let tSideIndex = -1;
  if (count === 3) {
    const throughTotals = movements.map(function (row) {
      return row.AM.through + row.PM.through;
    });
    tSideIndex = throughTotals.indexOf(Math.min(...throughTotals));
    const before = (tSideIndex + count - 1) % count;
    const after = (tSideIndex + 1) % count;
    const westEvidence =
      movements[before].AM.left +
      movements[before].PM.left +
      movements[after].AM.right +
      movements[after].PM.right;
    const eastEvidence =
      movements[before].AM.right +
      movements[before].PM.right +
      movements[after].AM.left +
      movements[after].PM.left;
    angles[before] = 90;
    angles[after] = -90;
    angles[tSideIndex] = westEvidence >= eastEvidence ? 180 : 0;
  }
  const roadParts = item.name
    .replace(/口$/u, "")
    .split(/[－/／]/u)
    .map(function (part) {
      return part.trim();
    })
    .filter(Boolean);
  const mainRoad = roadParts[0] || "主線";
  const sideRoad = roadParts[1] || "支線";
  const names = mappedNames.map(function (code, index) {
    if (count !== 3 || tSideIndex < 0) return "路口 " + code;
    if (index === tSideIndex)
      return sideRoad + (angles[index] === 180 ? "西側" : "東側");
    return mainRoad + (angles[index] === -90 ? "北側" : "南側");
  });
  return { angles, names, inferredT: count === 3 && tSideIndex >= 0 };
}

function recordFromPreview(
  item: ImportPreview,
  projectId: string,
  quarter: string,
  pce: PceMatrix,
  vehicleMappings: VehicleMappingTable,
): TrafficRecord {
  const appliedPce = item.pceUsed || pce;
  const length = Math.max(
    item.am?.values.length || 0,
    item.pm?.values.length || 0,
  );
  const mappedNames = item.approaches.length
    ? item.approaches
    : Array.from(
        new Set(
          item.columns.map(function (column) {
            return column.approach;
          }),
        ),
      );
  const useMapping =
    item.mappingConfidence !== "low" &&
    mappedNames.length >= 3 &&
    mappedNames.length <= 7;
  const armCount = useMapping
    ? mappedNames.length
    : length >= 9 && length <= 21 && length % 3 === 0
      ? length / 3
      : 4;
  const mappedMovements = mappedNames.map(function (name) {
    return {
      AM: mappedMovement(item, "AM", name, appliedPce, vehicleMappings),
      PM: mappedMovement(item, "PM", name, appliedPce, vehicleMappings),
    };
  });
  const geometry = inferApproachGeometry(item, mappedNames, mappedMovements);
  const approaches: Approach[] = Array.from(
    { length: armCount },
    function (_, index) {
      const approachName = useMapping
        ? geometry.names[index]
        : "支線 " + (index + 1);
      const approachAngle = useMapping
        ? geometry.angles[index]
        : -90 + (index * 360) / armCount;
      return {
        id: item.station + "-" + (mappedNames[index] || "A" + (index + 1)),
        sourceCode: mappedNames[index] || "A" + (index + 1),
        name: approachName,
        bearing: bearingFromAngle(approachAngle),
        angle: approachAngle,
        lanes: null,
        laneType: "other",
        laneComposition: { fast: 0, slow: 0, motorcycle: 0, other: 0 },
        saturationFlow: null,
        effectiveGreen: null,
        cycleLength: null,
        capacity: null,
        movements: {
          /*
           * 只要這一支支線在原始檔裡有對應的欄位，就用 mappedMovement 算
           *（它會依每一欄自己的車種與轉向別套用當量係數，是正確的算法）。
           * 完全對應不到才留白。
           */
          AM: mappedMovements[index]
            ? mappedMovements[index].AM
            : emptyMovement(),
          PM: mappedMovements[index]
            ? mappedMovements[index].PM
            : emptyMovement(),
        },
      };
    },
  );
  const routeKeys = new Map<
    string,
    { from: string; to: string; movement: "left" | "through" | "right" }
  >();
  const destinationForColumn = function (
    column: ImportPreview["columns"][number],
  ) {
    if (column.destination) return column.destination;
    const sourceIndex = mappedNames.indexOf(column.approach);
    const targetIndex = movementTargetIndex(
      approaches,
      sourceIndex,
      column.movement || "through",
    );
    return (
      approaches[targetIndex]?.sourceCode || mappedNames[targetIndex] || ""
    );
  };
  /*
   * key 一定要含轉向別。
   *
   * 三叉路口（T 字）上，movementTargetIndex 對「左轉」與「直行」會解出
   * 同一支目的支線（兩個候選與直行目標等距，取到同一個）。舊寫法只用
   * from→to 當 key，後來的那一欄就把前面的覆蓋掉：左轉整批消失，
   * 它的流量被併進直行、用直行的當量換算，而且每次重新整理
   * syncRouteTotals 會用這批殘缺的流向回寫 approaches，路口總量因此
   * 一次比一次少（實測 2,328 → 2,264 PCU/hr，使用者完全沒有編輯過）。
   */
  item.columns.forEach(function (column) {
    const movement = column.movement || "through";
    const destination = destinationForColumn(column);
    if (destination)
      routeKeys.set(column.approach + "→" + destination + "→" + movement, {
        from: column.approach,
        to: destination,
        movement,
      });
  });
  const routes = [...routeKeys.values()]
    .map(function (route, index) {
      const volumes = Object.fromEntries(
        (["AM", "PM"] as PeakKey[]).map(function (key) {
          const values = key === "AM" ? item.am?.values : item.pm?.values;
          const vehicle: Record<string, number> = {};
          let routePcu = 0;
          item.columns
            .filter(function (column) {
              const destination = destinationForColumn(column);
              // 轉向別也要比對，否則同一個 from→to 的左轉與直行兩條流向
              // 會各自把對方的欄位也加進來，流量變成兩倍。
              return (
                column.approach === route.from &&
                destination === route.to &&
                (column.movement || "through") === route.movement
              );
            })
            .forEach(function (column) {
              const count = Number(values?.[column.valueIndex]) || 0;
              const movement = column.movement || route.movement;
              const analysisVehicle =
                vehicleMappings[column.vehicle] || column.vehicle;
              vehicle[analysisVehicle] =
                Number(vehicle[analysisVehicle] || 0) + count;
              routePcu +=
                count * pceFactor(appliedPce, analysisVehicle, movement);
            });
          return [key, { pcu: roundedPcu(routePcu), vehicle }];
        }),
      ) as RouteFlow["volumes"];
      const surveyVehicle: Record<string, number> = {};
      item.columns
        .filter(function (column) {
          const destination = destinationForColumn(column);
          // 與上面的尖峰值一樣，轉向別也要比對；三叉路口的左轉與直行
          // 共用同一個 from→to，不比對會互相把對方的量也加進來。
          return (
            column.approach === route.from &&
            destination === route.to &&
            (column.movement || "through") === route.movement
          );
        })
        .forEach(function (column) {
          const analysisVehicle =
            vehicleMappings[column.vehicle] || column.vehicle;
          surveyVehicle[analysisVehicle] =
            Number(surveyVehicle[analysisVehicle] || 0) +
            (Number(item.survey?.values[column.valueIndex]) || 0);
        });
      return {
        id: item.station + "-R" + (index + 1),
        fromApproachId: approaches[mappedNames.indexOf(route.from)]?.id || "",
        toApproachId: approaches[mappedNames.indexOf(route.to)]?.id || "",
        movement: route.movement,
        volumes,
        survey: { vehicle: surveyVehicle },
      };
    })
    .filter(function (route) {
      return route.fromApproachId && route.toApproachId;
    });
  const surveyVehicle: Record<string, number> = {};
  item.columns.forEach(function (column) {
    const analysisVehicle = vehicleMappings[column.vehicle] || column.vehicle;
    surveyVehicle[analysisVehicle] =
      Number(surveyVehicle[analysisVehicle] || 0) +
      (Number(item.survey?.values[column.valueIndex]) || 0);
  });
  const traceCells = (["AM", "PM"] as PeakKey[]).flatMap(function (tracePeak) {
    const window = tracePeak === "AM" ? item.am : item.pm;
    if (!window) return [];
    return (item.intervalRows || [])
      .filter(function (row) {
        return row.start >= window.start && row.start < window.end;
      })
      .flatMap(function (row) {
        return item.columns.map(function (column) {
          const analysisVehicle =
            vehicleMappings[column.vehicle] || column.vehicle;
          const movement = column.movement || "through";
          const rawCount = Number(row.values[column.valueIndex]) || 0;
          const factor = pceFactor(appliedPce, analysisVehicle, movement);
          const sourceRow = row.sourceRows?.[column.sheet];
          return {
            peak: tracePeak,
            sheet: column.sheet,
            cell: sourceRow
              ? XLSX.utils.encode_cell({
                  r: sourceRow - 1,
                  c: column.sourceColumn,
                })
              : XLSX.utils.encode_col(column.sourceColumn) + "?",
            time: row.label,
            approach: column.approach,
            destination: column.destination,
            movement: column.movement,
            vehicle: analysisVehicle,
            vehicleLabel:
              CORE_VEHICLE_LABELS[analysisVehicle] || column.vehicleLabel,
            rawCount,
            factor,
            pcu: roundedPcu(rawCount * factor),
          };
        });
      });
  });
  const traceIntervals = (item.intervalRows || []).map(function (row) {
    let pcu = 0;
    let vehicles = 0;
    item.columns.forEach(function (column) {
      const count = Number(row.values[column.valueIndex]) || 0;
      const analysisVehicle = vehicleMappings[column.vehicle] || column.vehicle;
      pcu +=
        count *
        pceFactor(appliedPce, analysisVehicle, column.movement || "through");
      vehicles += count;
    });
    return {
      start: row.start,
      end: row.start + Number(item.intervalMinutes || 15),
      pcu: roundedPcu(pcu),
      vehicles,
    };
  });
  return {
    id:
      projectId +
      "-" +
      quarter +
      "-" +
      item.station +
      (item.surveyType && item.surveyType !== "待設定"
        ? "-" + item.surveyType
        : ""),
    projectId: projectId,
    station: item.station,
    name:
      item.surveyType && item.surveyType !== "待設定"
        ? item.name + "（" + item.surveyType + "）"
        : item.name,
    rawName: item.file,
    quarter: quarter,
    date: item.date,
    surveyType: item.surveyType,
    pceUsed: structuredClone(appliedPce),
    pceVersion: "匯入快照 " + new Date().toISOString(),
    revision: 1,
    review: { status: "待核對", updatedAt: new Date().toISOString(), note: "" },
    sourceTrace: {
      templateId: item.templateId || "semantic-turning-v1",
      templateName: item.templateName || "一般語意轉向表",
      dateSource: item.dateSource,
      cells: traceCells,
      intervals: traceIntervals,
    },
    vehicleLabels: Object.fromEntries(
      item.detectedVehicles.map(function (definition) {
        const target = vehicleMappings[definition.id] || definition.id;
        return [target, CORE_VEHICLE_LABELS[target] || definition.label];
      }),
    ),
    vehicleMapping: Object.fromEntries(
      item.detectedVehicles.map(function (definition) {
        return [definition.id, vehicleMappings[definition.id] || definition.id];
      }),
    ),
    peaks: {
      AM: item.am
        ? {
            start: formatMinutes(item.am.start),
            end: formatMinutes(item.am.end),
          }
        : { start: "", end: "" },
      PM: item.pm
        ? {
            start: formatMinutes(item.pm.start),
            end: formatMinutes(item.pm.end),
          }
        : { start: "", end: "" },
    },
    survey: item.survey
      ? {
          intervals: item.survey.intervals,
          minutes: item.survey.minutes,
          vehicle: surveyVehicle,
        }
      : undefined,
    approaches: approaches,
    routes: routes,
    movementRule: referenceMovementForOd(
      item.name,
      "A",
      "E",
      approaches.map(function (approach) {
        return approach.sourceCode || "";
      }),
    )
      ? "reference-calculation"
      : "geometry-suggested",
    sourceFiles: [item.file],
    importedAt: new Date().toISOString(),
    validation: {
      referenceFound: false,
      matchRate: null,
      notes: [
        useMapping
          ? item.layout === "od"
            ? "已依原始表保留每一組起點→終點與四車種流量。"
            : "已依各入口區塊辨識左直右與四車種並套用當量。"
          : "欄位語意辨識不足，只保留尖峰數列；不執行車種合計一致性判定。",
        geometry.inferredT
          ? "道路幾何：已依三支線直行缺口推定 T 字主線與側路；方位仍可在道路與流向管理人工校正。"
          : armCount > 4
            ? "道路幾何未確認：多岔路不得將等角配置視為正式幾何，匯出前請依監測日誌校正支線角度。"
            : "道路幾何：四岔路採方位模板，仍可人工校正。",
        item.dateSource
          ? "調查日期來源：" +
            item.dateSource.sheet +
            "!" +
            item.dateSource.cell +
            "（" +
            item.dateSource.raw +
            "）"
          : "日期辨識未成功：已掃描交通量工作表標題區（" +
            (item.sheets.traffic.join("、") || "無可辨識工作表") +
            "），未找到可解析的民國／西元日期；不代表原始檔一定空白。",
      ],
    },
  };
}

function Kpi(props: {
  label: string;
  value: string;
  note: string;
  accent?: string;
}) {
  return (
    <article className={"kpi " + (props.accent || "")}>
      <div className="kpi-top">
        <span>{props.label}</span>
        <i />
      </div>
      <strong>{props.value}</strong>
      <small>{props.note}</small>
    </article>
  );
}
function Empty(props: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>◇</span>
      <strong>{props.title}</strong>
      <p>{props.text}</p>
      {props.action}
    </div>
  );
}
function Segmented<T extends string>(props: {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {props.options.map(function (option) {
        return (
          <button
            key={option[0]}
            className={option[0] === props.value ? "active" : ""}
            onClick={function () {
              props.onChange(option[0]);
            }}
          >
            {option[1]}
          </button>
        );
      })}
    </div>
  );
}

function configuredImportPreview(
  item: ImportPreview,
  pce: PceMatrix,
  vehicleMappings: VehicleMappingTable,
) {
  if (!item.intervalRows?.length || !item.intervalMinutes) return item;
  const weights = item.columns.map(function (column) {
    const target = vehicleMappings[column.vehicle] || column.vehicle;
    return pceFactor(pce, target, column.movement || "through");
  });
  return {
    ...item,
    am: rollingPeak(
      item.intervalRows,
      [5 * 60, 12 * 60],
      item.intervalMinutes,
      weights,
    ),
    pm: rollingPeak(
      item.intervalRows,
      [12 * 60, 23 * 60],
      item.intervalMinutes,
      weights,
    ),
    pceUsed: structuredClone(pce),
  };
}

function destinationVehicleTotal(
  record: TrafficRecord,
  peak: PeakKey,
  destinationIndex: number,
) {
  const destination = record.approaches[destinationIndex];
  if (!destination || !record.routes?.length) return null;
  return record.routes
    .filter(function (route) {
      return route.toApproachId === destination.id;
    })
    .reduce(function (sum, route) {
      return (
        sum +
        recordVehicleIds(record).reduce(function (vehicleSum, vehicle) {
          return vehicleSum + Number(route.volumes[peak].vehicle[vehicle] || 0);
        }, 0)
      );
    }, 0);
}

function surveyDestinationTotals(
  record: TrafficRecord,
  destinationIndex: number,
) {
  const destination = record.approaches[destinationIndex];
  if (
    !record.survey ||
    record.survey.minutes < 24 * 60 ||
    !destination ||
    !record.routes?.length
  )
    return { pcu: null, vehicles: null };
  const pce = record.pceUsed || DEFAULT_PCE;
  let pcu = 0;
  let vehicles = 0;
  record.routes
    .filter(function (route) {
      return route.toApproachId === destination.id && Boolean(route.survey);
    })
    .forEach(function (route) {
      recordVehicleIds(record).forEach(function (vehicle) {
        const count = Number(route.survey?.vehicle[vehicle] || 0);
        vehicles += count;
        pcu += count * pceFactor(pce, vehicle, route.movement);
      });
    });
  return { pcu: roundedPcu(pcu), vehicles };
}

function surveySourceTotals(record: TrafficRecord, sourceIndex: number) {
  const source = record.approaches[sourceIndex];
  if (
    !record.survey ||
    record.survey.minutes < 24 * 60 ||
    !source ||
    !record.routes?.length
  )
    return { pcu: null, vehicles: null };
  const pce = record.pceUsed || DEFAULT_PCE;
  let pcu = 0;
  let vehicles = 0;
  record.routes
    .filter(function (route) {
      return route.fromApproachId === source.id && Boolean(route.survey);
    })
    .forEach(function (route) {
      recordVehicleIds(record).forEach(function (vehicle) {
        const count = Number(route.survey?.vehicle[vehicle] || 0);
        vehicles += count;
        pcu += count * pceFactor(pce, vehicle, route.movement);
      });
    });
  return { pcu: roundedPcu(pcu), vehicles };
}

function sourceVehicleTotal(
  record: TrafficRecord,
  peak: PeakKey,
  sourceIndex: number,
) {
  const source = record.approaches[sourceIndex];
  if (!source) return null;
  if (record.routes?.length)
    return record.routes
      .filter(function (route) {
        return route.fromApproachId === source.id;
      })
      .reduce(function (sum, route) {
        return (
          sum +
          recordVehicleIds(record).reduce(function (vehicleSum, vehicle) {
            return (
              vehicleSum + Number(route.volumes[peak].vehicle[vehicle] || 0)
            );
          }, 0)
        );
      }, 0);
  return source.movements[peak].rawVehicleTotal ?? null;
}

/**
 * 讀檔／還原備份時再正規化一次路口名稱。
 * normalizeIntersectionName 會把所有括號拿掉，而匯入時會在名稱後面補上
 * 「（平日）」「（假日）」來區分同一路口的兩種資料別；直接再跑一次的話，
 * 重新整理後兩筆的名稱會變成「…平日」「…假日」，被當成兩個不同路口，
 * 資料別下拉、幾何同步與歷季比較都會跟著錯。這裡把括號內容原樣保留。
 */
function renormalizeStoredName(input: string) {
  const name = String(input ?? "");
  const matched = /^(.*)（([^（）]*)）$/.exec(name);
  if (matched)
    return normalizeIntersectionName(matched[1]) + "（" + matched[2] + "）";
  return normalizeIntersectionName(name);
}
/** 使用者自己打過的名稱不再正規化，其餘沿用舊行為。 */
function storedNameOf(record: TrafficRecord) {
  return record.nameEdited ? record.name : renormalizeStoredName(record.name);
}

function inboundAnalysisRows(record: TrafficRecord) {
  return record.approaches.map(function (approach, index) {
    const inboundSurvey = surveyDestinationTotals(record, index);
    const outboundSurvey = surveySourceTotals(record, index);
    return {
      approach,
      inboundFullDayPcu: inboundSurvey.pcu,
      inboundAmPcu: destinationFlowTotal(record, "AM", index, "all"),
      inboundPmPcu: destinationFlowTotal(record, "PM", index, "all"),
      inboundFullDayVehicles: inboundSurvey.vehicles,
      inboundAmVehicles: destinationVehicleTotal(record, "AM", index),
      inboundPmVehicles: destinationVehicleTotal(record, "PM", index),
      outboundFullDayPcu: outboundSurvey.pcu,
      outboundAmPcu: sourceFlowTotal(record, "AM", index),
      outboundPmPcu: sourceFlowTotal(record, "PM", index),
      outboundFullDayVehicles: outboundSurvey.vehicles,
      outboundAmVehicles: sourceVehicleTotal(record, "AM", index),
      outboundPmVehicles: sourceVehicleTotal(record, "PM", index),
    };
  });
}

/**
 * 把畫面用的 TrafficRecord 換成結論產生器要的資料。
 *
 * 這一步是刻意分開的：lib/conclusion.ts 只負責組字，數字全部在這裡取，
 * 而且取的是**畫面與 Excel 用的同一組函式**（inboundAnalysisRows、
 * recordTotal、recordVehicleTotal）。只要這裡不另外算，草稿寫的數字就
 * 不可能和成果表對不起來。
 */
function toConclusionRecords(records: TrafficRecord[]): ConclusionRecord[] {
  return records.map(function (record) {
    const rows = inboundAnalysisRows(record);
    const vehicleIds = recordVehicleIds(record);
    /*
     * 各支線的逐車種輛數（全調查時段），取自「車種組成分析」那張
     * 『全調查時段道路方向車種數量』用的同一支 surveyDirectionRows，
     * 兩邊的數字因此必然相同。沒有逐流向調查明細時給 null，不是 0。
     */
    const hasSurveyDetail = (record.routes || []).some(function (route) {
      return Boolean(route.survey);
    });
    const directionRows = hasSurveyDetail ? surveyDirectionRows(record) : [];
    const byArm = new Map<
      string,
      {
        outbound: { label: string; count: number }[];
        inbound: { label: string; count: number }[];
        twoWay: { label: string; count: number }[];
        display: "split" | "two-way";
      }
    >();
    for (const row of directionRows) {
      const code = row.approach.sourceCode || row.approach.id;
      const entry = byArm.get(row.approach.id) || {
        outbound: [],
        inbound: [],
        twoWay: [],
        /*
         * 這條支線在「車種組成分析」頁上目前選的呈現方式，直接沿用同一份
         * record.directionDisplay，使用者在那一頁改成雙向合計，草稿也會跟著改。
         */
        display: (record.directionDisplay?.[code] || "split") as
          | "split"
          | "two-way",
      };
      const list = vehicleIds.map(function (id) {
        return {
          label: record.vehicleLabels?.[id] || VEHICLE_LABELS[id] || id,
          count: Number(row.vehicle[id] || 0),
        };
      });
      if (row.relation === "駛出路口") entry.outbound = list;
      else if (row.relation === "駛入路口") entry.inbound = list;
      else entry.twoWay = list;
      byArm.set(row.approach.id, entry);
    }
    const surveyTotal = vehicleIds.reduce(function (sum, id) {
      return sum + recordVehicleTotal(record, "SURVEY", id);
    }, 0);
    /* 車種組成：整份調查有資料就用它，否則退回 AM 尖峰（與分析頁一致）。 */
    const scope: CompositionScope = surveyTotal > 0 ? "SURVEY" : "AM";
    const peakData = function (peak: PeakKey) {
      const window = record.peaks?.[peak];
      const totalVehicles = rows.reduce(function (sum, row) {
        const value = peak === "AM" ? row.inboundAmVehicles : row.inboundPmVehicles;
        return value === null ? sum : sum + value;
      }, 0);
      const hasVehicles = rows.some(function (row) {
        return (peak === "AM" ? row.inboundAmVehicles : row.inboundPmVehicles) !== null;
      });
      return {
        window: window ? window.start + "–" + window.end : "",
        totalPcu: recordTotal(record, peak),
        totalVehicles: hasVehicles ? totalVehicles : null,
        branches: rows.map(function (row) {
          const composition = byArm.get(row.approach.id);
          return {
            name: row.approach.name,
            outboundByVehicleSafe: composition ? composition.outbound : null,
            inflowByVehicleSafe: composition ? composition.inbound : null,
            twoWayByVehicleSafe: composition ? composition.twoWay : null,
            directionDisplay: composition ? composition.display : "split",
            inflowPcu: peak === "AM" ? row.inboundAmPcu : row.inboundPmPcu,
            outflowPcu: peak === "AM" ? row.outboundAmPcu : row.outboundPmPcu,
            inflowVehicles:
              peak === "AM" ? row.inboundAmVehicles : row.inboundPmVehicles,
            outflowVehicles:
              peak === "AM" ? row.outboundAmVehicles : row.outboundPmVehicles,
            inflowFullDayVehicles: row.inboundFullDayVehicles,
            outflowFullDayVehicles: row.outboundFullDayVehicles,
          };
        }),
      };
    };
    return {
      id: record.id,
      intersectionKey: recordIntersectionKey(record),
      station: record.station,
      name: record.name,
      quarter: record.quarter,
      surveyType: record.surveyType || "待設定",
      routeless: !record.routes?.length,
      compositionScope: scope === "SURVEY" ? "全調查時段" : "上午尖峰小時",
      compositionUnit: scope === "SURVEY" ? "輛/調查時段" : "輛/hr",
      composition: vehicleIds.map(function (id) {
        return {
          label: record.vehicleLabels?.[id] || VEHICLE_LABELS[id] || id,
          count: recordVehicleTotal(record, scope, id),
        };
      }),
      peaks: { AM: peakData("AM"), PM: peakData("PM") },
    };
  });
}

/**
 * 「各路口分項結果」最多逐筆敘述幾筆。
 * 每一筆會寫成一個標題加兩行（含全部支線與車種），4 季 × 10 路口 × 平假日
 * 就是 240 行，整段貼進報告反而沒人看得完；超過的部分在段末說明還有幾筆。
 */
const SITE_SUMMARY_LIMIT = 30;

function AuditWorkbench(props: {
  record: TrafficRecord | null;
  peak: PeakKey;
  setPeak: (peak: PeakKey) => void;
  quarter: string;
  quarterRecords: TrafficRecord[];
  lockQuarter: () => void;
  unlockQuarter: () => void;
  revisions: RecordRevision[];
  setReview: (
    status: "待核對" | "已核對" | "已確認" | "需修正",
    note: string,
  ) => void;
  restoreRevision: (revision: RecordRevision) => void;
  setSurveyType: (value: string) => void;
  /* 這一頁自己要能換路口，不必先跑去別的分頁挑好再回來。 */
  intersections: { key: string; label: string }[];
  selectedIntersection: string;
  setSelectedIntersection: (value: string) => void;
  surveyTypes: string[];
  selectedSurveyType: string;
  setSelectedSurveyType: (value: string) => void;
  /* 整個計畫還掛著「待設定」的筆數，以及一次補完的入口。 */
  pendingSurveyTypeCount: number;
  /** 那幾筆是哪些（季度＋站號＋路口名），讓使用者看得到才敢按。 */
  pendingSurveyTypeLabels: string[];
  assignPendingSurveyType: (value: string) => void;
}) {
  const record = props.record;
  /*
   * 核對視角：依「來源」分組＝駛出路口，依「目的」分組＝駛入路口。
   * 兩者是同一批 OD 流向、只是分組方式不同，所以整個路口的總量應該相等；
   * 不相等就代表有流向沒有指定目的支線，那個差額正好是資料的問題所在。
   */
  const [flowView, setFlowView] = useState<"outbound" | "inbound">("outbound");
  const lockedCount = props.quarterRecords.filter(function (item) {
    return Boolean(item.resultLock);
  }).length;
  const conflicts = props.quarterRecords.map(lockConflict).filter(Boolean);
  if (!record)
    return (
      <Empty title="尚無可核對資料" text="請先選擇有匯入資料的計畫與季度。" />
    );
  /** 目前這一筆的鎖定狀況，下面的審核欄位與鎖定狀態卡都要用。 */
  const recordLock = record.resultLock;
  const recordConflict = lockConflict(record);
  const approachById = new Map(
    record.approaches.map(function (approach) {
      return [approach.id, approach] as const;
    }),
  );
  const routes = record.routes || [];
  const routeTotal = routes.reduce(function (sum, route) {
    return sum + Number(route.volumes[props.peak].pcu || 0);
  }, 0);
  const peakTotal = recordTotal(record, props.peak);
  const difference = Math.round((peakTotal - routeTotal) * 10) / 10;
  const pceMatrix = record.pceUsed || DEFAULT_PCE;
  const downloadAuditWorkbook = function () {
    const workbook = XLSX.utils.book_new();
    const routeRows = routes.map(function (route) {
      const origin = approachById.get(route.fromApproachId);
      const destination = approachById.get(route.toApproachId);
      const row: Record<string, string | number> = {
        尖峰: props.peak + " Peak",
        起點: origin?.name || route.fromApproachId,
        終點: destination?.name || route.toApproachId,
        轉向: MOVE_LABELS[route.movement],
        流量: route.volumes[props.peak].pcu,
        流量單位: "PCU/hr",
      };
      recordVehicleIds(record).forEach(function (vehicleKey) {
        row[vehicleLabel(record, vehicleKey) + "（輛/hr）"] = Number(
          route.volumes[props.peak].vehicle[vehicleKey] || 0,
        );
      });
      return row;
    });
    const traceRows = (record.sourceTrace?.cells || [])
      .filter(function (cell) {
        return cell.peak === props.peak;
      })
      .map(function (cell) {
        return {
          工作表: cell.sheet,
          儲存格: cell.cell,
          時段: cell.time,
          來源: cell.approach,
          目的: cell.destination || "－",
          轉向: cell.movement ? MOVE_LABELS[cell.movement] : "－",
          車種: cell.vehicleLabel,
          原始車輛數: cell.rawCount,
          車輛單位: "輛",
          當量: cell.factor,
          換算PCU: cell.pcu,
        };
      });
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(routeRows),
      "OD核對",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(traceRows),
      "原始儲存格追溯",
    );
    XLSX.writeFile(
      workbook,
      record.station +
        "_" +
        record.quarter +
        "_" +
        props.peak +
        "_流量核對.xlsx",
      { bookType: "xlsx" },
    );
  };
  return (
    <>
      <section className="page-head audit-head">
        <div>
          <span className="eyebrow">FLOW AUDIT</span>
          <h1>流量核對工作台</h1>
          <p>
            逐筆展開尖峰總量的 OD 來源、車種數與 PCU
            換算式，不改變既有計算結果。
          </p>
        </div>
        <div className="audit-actions">
          <Segmented
            value={props.peak}
            options={[
              ["AM", "AM Peak"],
              ["PM", "PM Peak"],
            ]}
            onChange={props.setPeak}
          />
          <button onClick={downloadAuditWorkbook}>下載核對 Excel</button>
          {lockedCount === props.quarterRecords.length && lockedCount > 0 ? (
            <button className="danger-outline" onClick={props.unlockQuarter}>
              解除 {props.quarter} 鎖定
            </button>
          ) : (
            <button className="primary" onClick={props.lockQuarter}>
              鎖定 {props.quarter} 成果
            </button>
          )}
        </div>
      </section>
      <section
        className={"panel lock-banner " + (conflicts.length ? "conflict" : "")}
      >
        <div>
          <b>
            {lockedCount
              ? "本季已鎖定 " +
                lockedCount +
                "／" +
                props.quarterRecords.length +
                " 個路口"
              : "本季成果尚未鎖定"}
          </b>
          <p>
            {lockedCount
              ? "鎖定後若修改名稱、角度、流向或覆蓋匯入，系統會先詢問並解除受影響成果。"
              : "完成逐筆核對後可手動鎖定；日後仍可手動解除。"}
          </p>
        </div>
        {conflicts.length > 0 && (
          <strong>
            偵測到鎖定衝突：{Array.from(new Set(conflicts)).join("；")}
          </strong>
        )}
      </section>
      <section className="panel review-panel">
        <div>
          <b>成果審核狀態</b>
          {/*
            這一段要說清楚這個欄位在做什麼，否則使用者看到「不論選哪一個都
            鎖得起來」，只會覺得它沒有用途。它管三件事：
            「需修正」擋住鎖定、「待核對」鎖定前會再問一次、鎖定之後就改不動。
          */}
          <p>
            審核狀態不會改變任何計算，但它決定這一季能不能鎖定：
            <b>需修正</b>會擋下鎖定，<b>待核對</b>鎖定前會再問一次，
            <b>已核對／已確認</b>可直接鎖定。
            {recordLock ? "本筆已鎖定，要改審核狀態請先解除鎖定。" : ""}
          </p>
        </div>
        <select
          value={record.review?.status || "待核對"}
          disabled={Boolean(recordLock)}
          title={recordLock ? "本筆成果已鎖定，請先解除鎖定" : ""}
          onChange={function (event) {
            props.setReview(
              event.target.value as "待核對" | "已核對" | "已確認" | "需修正",
              record.review?.note || "",
            );
          }}
        >
          <option>待核對</option>
          <option>已核對</option>
          <option>已確認</option>
          <option>需修正</option>
        </select>
        <input
          value={record.review?.note || ""}
          placeholder="審核備註"
          disabled={Boolean(recordLock)}
          onChange={function (event) {
            props.setReview(
              record.review?.status || "待核對",
              event.target.value,
            );
          }}
        />
      </section>
      {/*
        鎖定到底有沒有作用，要看得見才算數。
        舊版只有頂端一行「本季已鎖定 N／M 個路口」，使用者無從判斷
        目前這一筆是不是鎖著的、什麼時候鎖的、鎖了以後資料有沒有被動過。
      */}
      <section className={"panel review-panel lock-state" + (recordLock ? "" : " unlocked")}>
        <div>
          <b>本筆成果鎖定狀態</b>
          {recordLock ? (
            <p>
              已於 {new Date(recordLock.lockedAt).toLocaleString("zh-TW")} 鎖定
              （鎖定當時版本 {recordLock.version}）。
              {recordConflict
                ? "　⚠ " + recordConflict + "。"
                : "　鎖定後內容未被更動。"}
              {" "}
              鎖定期間修改名稱、角度、流向、批次指定資料別、重新匯入或刪除季度，
              系統都會先跳出確認並要求解除鎖定才會動手。
            </p>
          ) : (
            <p>
              尚未鎖定。這一筆目前可以被改名、調整角度與流向，或被重新匯入覆蓋，
              而且不會有任何確認視窗。
            </p>
          )}
        </div>
        <span className={recordLock ? "status-dot locked" : "status-dot"}>
          {recordLock ? "🔒 已鎖定" : "未鎖定"}
        </span>
      </section>
      {/*
        資料別（平日／假日）。
        匯入時是從原始檔的日期字樣「115年5月4日（平日）」或工作表名稱判斷的；
        原始檔沒寫就會是「待設定」。以前沒有地方可以補，於是這筆資料在
        歷季趨勢、報表與結論草稿裡永遠都掛著「待設定」，也沒辦法跟同一路口的
        另一種資料別分開比較。這裡讓使用者直接指定。
      */}
      <section className="panel review-panel">
        <div>
          <b>資料別（平日／假日）</b>
          <p>
            {record.surveyType && record.surveyType !== "待設定"
              ? "這一筆已經從原始檔的日期字樣或工作表名稱判讀出來了；判讀錯誤時可在此更正。下拉一定同時提供「平日」與「假日」供更正，**不代表這個計畫有假日資料**。"
              : "「待設定」是指**這一筆**匯入時讀不出資料別——原始檔的日期沒有寫「（平日）」「（假日）」，交通量工作表也不叫「平日」或「假日」。不是整個計畫都沒讀到。資料別是**匯入當下**判定並存在這一筆上的，之後不會自己重讀；在這裡指定，或用原檔重新匯入同一季（新讀到的資料別會直接接手這一筆，不會多出第二筆）都可以補。設定之後，歷季趨勢與報表才能把平日與假日分開比較。"}
          </p>
        </div>
        <select
          value={record.surveyType || "待設定"}
          onChange={function (event) {
            props.setSurveyType(event.target.value);
          }}
        >
          {/*
            「待設定」代表「原始檔沒寫」，不是一個使用者會主動想選的值，
            所以只有在這一筆目前真的是待設定時才列出來。
          */}
          {Array.from(
            new Set(
              [record.surveyType || "待設定", "平日", "假日"].filter(Boolean),
            ),
          ).map(function (value) {
            return <option key={value}>{value}</option>;
          })}
        </select>
        {/*
          一筆一筆改要切換路口與季度，很容易漏掉——而漏掉的後果是歷季趨勢被
          拆成兩條線（選「平日」只看得到一部分的季度）。所以這裡直接給批次入口。
        */}
        {props.pendingSurveyTypeCount > 0 && (
          <div className="review-batch">
            <small>
              這個計畫還有 <b>{props.pendingSurveyTypeCount}</b>{" "}
              筆是「待設定」：{props.pendingSurveyTypeLabels.join("、")}
              。可以一次補完（只動待設定的，已經是平日／假日的不會被改到，
              每一筆都會先自動保存還原點）。
              <b>如果這幾筆不是同一種資料別，不要用批次</b>
              ——請用這一頁上方的「路口」選擇器選到那一筆，再用上面的
              「資料別（平日／假日）」下拉逐筆指定。
              判斷依據是原始調查檔本身（調查日期是星期幾、檔名或工作表有沒有寫）。
            </small>
            <div className="head-buttons">
              {["平日", "假日"].map(function (value) {
                return (
                  <button
                    key={value}
                    className="secondary"
                    onClick={function () {
                      props.assignPendingSurveyType(value);
                    }}
                  >
                    全部指定為{value}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>
      <section className="panel audit-picker">
        <label>
          路口
          <select
            value={props.selectedIntersection}
            onChange={function (event) {
              props.setSelectedIntersection(event.target.value);
            }}
          >
            {props.intersections.map(function (entry) {
              return (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              );
            })}
          </select>
        </label>
        {props.surveyTypes.length > 1 && (
          <label>
            資料別
            <select
              value={props.selectedSurveyType}
              onChange={function (event) {
                props.setSelectedSurveyType(event.target.value);
              }}
            >
              {props.surveyTypes.map(function (type) {
                return (
                  <option key={type} value={type}>
                    {type}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        <span>
          本季共 {props.intersections.length} 個路口
          {props.surveyTypes.length > 1
            ? `；此路口有 ${props.surveyTypes.length} 種資料別`
            : ""}
        </span>
      </section>
      <section className="audit-kpis">
        <Kpi
          label="系統尖峰總量"
          value={peakTotal.toLocaleString() + " PCU/hr"}
          note={
            record.peaks[props.peak].start + "–" + record.peaks[props.peak].end
          }
        />
        <Kpi
          label="OD 逐筆加總"
          value={routeTotal.toLocaleString() + " PCU/hr"}
          note={routes.length + " 筆 OD 流向"}
        />
        <Kpi
          label="核對差值"
          value={difference.toLocaleString() + " PCU/hr"}
          note={Math.abs(difference) < 0.11 ? "兩者一致" : "請展開下表追查"}
          accent={Math.abs(difference) < 0.11 ? "" : "warn"}
        />
      </section>
      <section className="panel audit-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">OD TRACE</span>
            <h2>
              {record.station} · {record.name}
            </h2>
            <p className="audit-unit-note">
              這一頁是核對<b>換算過程</b>用的：中間各車種欄位是原始的
              <b>調查車輛數（輛/hr）</b>，乘上該車種在該轉向的當量係數（見「換算式」），
              才得到最右邊的<b>交通流量（PCU/hr）</b>。
              車種欄若標成 PCU 就沒有東西可以核對了。
            </p>
          </div>
          <div className="audit-head-actions">
            <Segmented
              value={flowView}
              options={[
                ["outbound", "駛出路口（依來源分組）"],
                ["inbound", "駛入路口（依目的分組）"],
              ]}
              onChange={setFlowView}
            />
            <span className="status-dot">車種欄＝調查輛數；流量欄＝當量 PCU/hr</span>
          </div>
        </div>
        {/*
          兩種視角是同一批 OD 流向、只是分組方式不同，所以總量必須相等。
          不相等就是有流向沒有指定目的支線——這裡直接把差額寫出來，
          否則使用者只會看到「駛入怎麼比較少」卻不知道原因。
        */}
        {(function () {
          const outbound = routes.reduce(function (sum, route) {
            return sum + Number(route.volumes[props.peak]?.pcu || 0);
          }, 0);
          const inbound = routes
            .filter(function (route) {
              return record.approaches.some(function (arm) {
                return arm.id === route.toApproachId;
              });
            })
            .reduce(function (sum, route) {
              return sum + Number(route.volumes[props.peak]?.pcu || 0);
            }, 0);
          const gap = Math.round((outbound - inbound) * 10) / 10;
          return (
            <p className={gap ? "audit-flow-gap warn" : "audit-flow-gap"}>
              {gap
                ? `駛出合計 ${outbound.toLocaleString()} PCU/hr、駛入合計 ${inbound.toLocaleString()} PCU/hr，差 ${gap.toLocaleString()} PCU/hr。這代表有流向沒有指定目的支線，請到「道路與流向管理」補齊；在補齊之前，「駛入」視角會少掉這個量。`
                : `駛出與駛入合計相同（${outbound.toLocaleString()} PCU/hr）：每一筆流向都有指定目的支線，兩種視角可以互相核對。`}
            </p>
          );
        })()}
        {record.approaches.map(function (arm) {
          const armRoutes = routes.filter(function (route) {
            return flowView === "outbound"
              ? route.fromApproachId === arm.id
              : route.toApproachId === arm.id;
          });
          if (!armRoutes.length) return null;
          const armTotal = armRoutes.reduce(function (sum, route) {
            return sum + route.volumes[props.peak].pcu;
          }, 0);
          return (
            <details className="audit-origin" key={arm.id} open>
              <summary>
                <span>
                  {flowView === "outbound" ? "駛出路口" : "駛入路口"}{" "}
                  {arm.sourceCode || arm.name} · {arm.name}
                </span>
                <strong>{armTotal.toLocaleString()} PCU/hr</strong>
              </summary>
              <div className="table-scroll">
                <table className="audit-table">
                  <thead>
                    {/*
                      這一張表是「核對換算過程」用的，所以左半邊一定要是
                      原始調查車輛數（輛/hr），右半邊才是乘上當量後的 PCU/hr。
                      沒有分組標題時，很容易誤以為中間那幾欄也應該是 PCU。
                    */}
                    <tr className="audit-group-row">
                      <th colSpan={2} />
                      <th colSpan={recordVehicleIds(record).length}>
                        ① 原始調查車輛數（輛/hr）
                      </th>
                      <th colSpan={2}>② 乘上車種轉向當量後的交通流量</th>
                    </tr>
                    <tr>
                      <th>OD 流向</th>
                      <th>轉向</th>
                      {recordVehicleIds(record).map(function (vehicleKey) {
                        return (
                          <th key={vehicleKey}>
                            {vehicleLabel(record, vehicleKey)}
                            <br />
                            輛/hr
                          </th>
                        );
                      })}
                      <th>換算式</th>
                      <th>
                        流量
                        <br />
                        PCU/hr
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {armRoutes.map(function (route) {
                      /*
                       * OD 流向欄要寫這一筆流向自己的起訖，不能沿用分組用的
                       * 那一支支線——切到「駛入」視角時分組的是目的地，
                       * 沿用的話每一列的起點都會被寫成目的地。
                       */
                      const origin = approachById.get(route.fromApproachId);
                      const destination = approachById.get(route.toApproachId);
                      const counts = route.volumes[props.peak].vehicle;
                      const formula = recordVehicleIds(record)
                        .map(function (vehicleKey) {
                          return (
                            Number(counts[vehicleKey] || 0) +
                            "×" +
                            pceFactor(pceMatrix, vehicleKey, route.movement)
                          );
                        })
                        .join(" + ");
                      return (
                        <tr key={route.id}>
                          <td>
                            {origin?.sourceCode || origin?.name || "未設定"} →{" "}
                            {destination?.sourceCode ||
                              destination?.name ||
                              "未設定"}
                          </td>
                          <td>{MOVE_LABELS[route.movement]}</td>
                          {recordVehicleIds(record).map(function (vehicleKey) {
                            return (
                              <td key={vehicleKey}>
                                {Number(
                                  counts[vehicleKey] || 0,
                                ).toLocaleString()}
                              </td>
                            );
                          })}
                          <td className="audit-formula">{formula}</td>
                          <td>
                            <b>
                              {route.volumes[props.peak].pcu.toLocaleString()}
                            </b>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </section>
      <section className="panel audit-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">SOURCE CELLS</span>
            <h2>原始儲存格與換算來源</h2>
          </div>
          <span className="status-dot">
            {record.sourceTrace?.cells.filter(function (cell) {
              return cell.peak === props.peak;
            }).length || 0}{" "}
            格
          </span>
        </div>
        {record.sourceTrace?.cells.length ? (
          <div className="table-scroll">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>工作表／儲存格</th>
                  <th>時段</th>
                  <th>來源→目的</th>
                  <th>車種</th>
                  <th>原始輛數</th>
                  <th>當量</th>
                  <th>PCU</th>
                </tr>
              </thead>
              <tbody>
                {record.sourceTrace.cells
                  .filter(function (cell) {
                    return cell.peak === props.peak;
                  })
                  .map(function (cell, index) {
                    return (
                      <tr key={cell.sheet + cell.cell + index}>
                        <td>
                          {cell.sheet}!{cell.cell}
                        </td>
                        <td>{cell.time}</td>
                        <td>
                          {cell.approach} →{" "}
                          {cell.destination ||
                            MOVE_LABELS[cell.movement || "through"]}
                        </td>
                        <td>{cell.vehicleLabel}</td>
                        <td>{cell.rawCount.toLocaleString()} 輛</td>
                        <td>{cell.factor}</td>
                        <td>{cell.pcu.toLocaleString()} PCU</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            此資料由舊版備份移轉，未保存儲存格座標；重新匯入即可建立追溯資料。
          </p>
        )}
      </section>
      <section className="panel audit-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">REVISION HISTORY</span>
            <h2>版本差異與還原</h2>
          </div>
          <span className="status-dot">目前第 {record.revision || 1} 版</span>
        </div>
        {props.revisions.length ? (
          <div className="revision-list">
            {props.revisions.map(function (revision) {
              return (
                <article key={revision.id}>
                  <div>
                    <b>{new Date(revision.savedAt).toLocaleString("zh-TW")}</b>
                    <small>
                      {revision.reason} · 第 {revision.snapshot.revision || 1}{" "}
                      版
                    </small>
                  </div>
                  <button
                    onClick={function () {
                      props.restoreRevision(revision);
                    }}
                  >
                    還原此版本
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <p>尚無舊版本；重新匯入或人工修改前會自動建立還原點。</p>
        )}
      </section>
    </>
  );
}

export default function TrafficApp() {
  const [view, setView] = useState<View>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [records, setRecords] = useState<TrafficRecord[]>([]);
  const [quarter, setQuarter] = useState("");
  const [importYear, setImportYear] = useState("");
  const [importQuarterNo, setImportQuarterNo] = useState("");
  const [selectedIntersection, setSelectedIntersection] = useState("");
  const [selectedSurveyType, setSelectedSurveyType] = useState("");
  const [peak, setPeak] = useState<PeakKey>("AM");
  const [compositionScope, setCompositionScope] =
    useState<CompositionScope>("AM");
  const [diagramStyle, setDiagramStyle] = useState<DiagramStyle>("formal");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("both");
  const [arrowMode, setArrowMode] = useState<ArrowMode>("all");
  const [flowSummaryMode, setFlowSummaryMode] =
    useState<FlowSummaryMode>("both");
  const [showGeometryCardPreview, setShowGeometryCardPreview] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [vehicle, setVehicle] = useState<VehicleKey>("all");
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  /*
   * ── 車種轉向當量、車種目錄與車種對照：依計畫各存一份 ──
   *
   * v2.1.13 以前這三樣是全域共用的。已匯入的資料不會被影響（每一筆紀錄在
   * 匯入當下就把矩陣存進 pceUsed、PCU 也在那時算好），但畫面上永遠只看得到
   * 「最後一次設定」——切到 A 計畫卻顯示 B 計畫的係數，而且在 A 重新匯入
   * 某一季時會用到 B 的係數，同一個計畫裡的季度就對不起來了。
   * 車種目錄也一樣：某個計畫匯入過大客車，之後每個計畫都會看到大客車。
   *
   * 現在改成以計畫 id 為鍵各存一份，計畫之間完全不互相影響。
   * 下面三個 pce / vehicleCatalog / vehicleMappings 是「目前計畫的那一份」，
   * setter 也維持原本的用法（可傳物件或 updater），呼叫端不必改。
   */
  const [pceByProject, setPceByProject] = useState<Record<string, PceMatrix>>(
    {},
  );
  const [catalogByProject, setCatalogByProject] = useState<
    Record<string, Record<string, string>>
  >({});
  const [mappingsByProject, setMappingsByProject] = useState<
    Record<string, VehicleMappingTable>
  >({});
  const pce = pceByProject[activeProjectId] || DEFAULT_PCE;
  const vehicleCatalog =
    catalogByProject[activeProjectId] || CORE_VEHICLE_LABELS;
  const vehicleMappings = mappingsByProject[activeProjectId] || {};
  /** 把「整體設定」的 setter 包成「只改目前計畫那一份」。 */
  function scopedSetter<T>(
    setMap: (updater: (previous: Record<string, T>) => Record<string, T>) => void,
    fallback: T,
  ) {
    return function (value: T | ((previous: T) => T)) {
      setMap(function (previous) {
        // 沒有選計畫時不要寫進 ""，那會變成一份誰也看不到的孤兒設定。
        if (!activeProjectId) return previous;
        const current = previous[activeProjectId] ?? fallback;
        const next =
          typeof value === "function"
            ? (value as (previous: T) => T)(current)
            : value;
        return { ...previous, [activeProjectId]: next };
      });
    };
  }
  const setPce = scopedSetter<PceMatrix>(setPceByProject, DEFAULT_PCE);
  const setVehicleCatalog = scopedSetter<Record<string, string>>(
    setCatalogByProject,
    CORE_VEHICLE_LABELS,
  );
  const setVehicleMappings = scopedSetter<VehicleMappingTable>(
    setMappingsByProject,
    {},
  );
  const [importRows, setImportRows] = useState<ImportPreview[]>([]);
  const [formatMemories, setFormatMemories] = useState<FormatMemory[]>([]);
  const [vehicleSchemes, setVehicleSchemes] = useState<VehicleScheme[]>([]);
  // 報表匯出項目：每個計畫記住自己要的組合，另可存成可重複套用的範本
  const [reportTemplates, setReportTemplates] = useState<ReportTemplate[]>([]);
  const [conclusionTemplates, setConclusionTemplates] = useState<
    ConclusionTemplate[]
  >([]);
  /*
   * 結論草稿的條件與內容放在這一層，切換分頁才不會被卸載清空。
   * 換計畫時才重設——換了計畫，原本挑的路口與支線都不存在了。
   */
  const [conclusionCondition, setConclusionCondition] =
    useState<ConclusionCondition>(DEFAULT_CONDITION);
  const [conclusionDraft, setConclusionDraft] = useState("");
  const [conclusionEdited, setConclusionEdited] = useState(false);
  const [conclusionTemplateName, setConclusionTemplateName] = useState("");
  /*
   * 換計畫時把條件與草稿重設。不重設的話，A 計畫挑的路口與支線會被帶到
   * B 計畫，篩出 0 筆卻看不出原因；草稿也會留著別的案子的數字。
   */
  const conclusionOwner = useRef(activeProjectId);
  useEffect(
    function () {
      if (conclusionOwner.current === activeProjectId) return;
      conclusionOwner.current = activeProjectId;
      setConclusionCondition(DEFAULT_CONDITION);
      setConclusionDraft("");
      setConclusionEdited(false);
    },
    [activeProjectId],
  );
  const [reportTemplateName, setReportTemplateName] = useState("");
  const [recordRevisions, setRecordRevisions] = useState<RecordRevision[]>([]);
  const [importConflictModes, setImportConflictModes] = useState<
    Record<string, ImportConflictMode>
  >({});
  const [importResolutions, setImportResolutions] = useState<
    Record<string, ImportResolution>
  >({});
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState("");
  /*
   * loaded：本機資料讀完了沒有。存檔 effect 在這之前一律不動作，
   * 避免「開啟網頁時先用空白蓋掉使用者的資料」。
   * loadError：讀取失敗的原因。有值時整個畫面換成搶救指引，不進主程式——
   * 因為主程式一旦 render 就會開始存檔，那才是真正把資料弄丟的那一步。
   */
  /** 這次預覽新增了哪些車種（取消預覽時要原樣還原）。 */
  const [previewAddedVehicles, setPreviewAddedVehicles] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [projectForm, setProjectForm] = useState({
    code: "",
    name: "",
    client: "",
    note: "",
  });
  const [compareProjects, setCompareProjects] = useState<string[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [reportStartQuarter, setReportStartQuarter] = useState("");
  const [reportEndQuarter, setReportEndQuarter] = useState("");
  /*
   * 報告文字草稿。
   * draftSectionOverride 為 null 代表「跟著匯出勾選走」，使用者自己動過之後
   * 才變成一份獨立的清單；換計畫時會還原成跟著走。
   * reportDraftEdited 為 true 代表使用者已經手改過草稿，這時不再自動覆蓋，
   * 否則改到一半按個篩選就整段被蓋掉。
   */
  const [draftSectionOverride, setDraftSectionOverride] = useState<
    DraftSectionKey[] | null
  >(null);
  const [reportDraftText, setReportDraftText] = useState("");
  const [reportDraftEdited, setReportDraftEdited] = useState(false);
  const [batchProjectIds, setBatchProjectIds] = useState<string[]>([]);
  const [batchQuarterKeys, setBatchQuarterKeys] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);


  useEffect(function () {
    const saved =
      localStorage.getItem("turning-traffic-state-v2") ||
      localStorage.getItem("turning-traffic-state-v1");
    /*
     * 這台電腦還沒有任何資料 —— 一樣要解鎖存檔。
     *
     * 舊寫法是直接 return，`loaded` 永遠留在 false，而下面那個存檔 effect
     * 第一行就是 `if (!loaded) return;`。結果是：**全新的瀏覽器從頭到尾
     * 不會存下任何東西**。使用者建立計畫、匯入一整季的調查檔、核對、鎖定，
     * 畫面上一切正常，只要重新整理或關掉分頁，全部消失，而且沒有任何訊息。
     * 在另一台空白電腦還原備份也一樣——還原完看起來成功了，重開就沒了。
     * 實測：全新瀏覽器建立計畫後 localStorage 完全沒有寫入，重新整理後
     * 計畫不見。
     *
     * 只有「讀取失敗」才可以不解鎖（那時不寫入是為了保住原始資料）。
     * 「沒有資料可讀」跟「讀不出來」是兩回事。
     */
    if (!saved) {
      setLoaded(true);
      return;
    }
    try {
      const data = JSON.parse(saved);
      const oldDemo =
        data.version === "v1.0.0" &&
        Array.isArray(data.records) &&
        data.records.length === 20 &&
        data.records.every(function (r: TrafficRecord) {
          return r.importedAt === "2026-08-11T09:00:00+08:00";
        });
      if (!oldDemo && Array.isArray(data.records)) {
        if (Array.isArray(data.projects) && data.projects.length) {
          setRecords(
            synchronizeGeometryAcrossQuarters(
              data.records.map(function (record: TrafficRecord) {
                return applyReferenceMovementRule({
                  ...record,
                  name: storedNameOf(record),
                  approaches: record.approaches.map(function (approach) {
                    return {
                      ...approach,
                      bearing: bearingFromAngle(approach.angle),
                    };
                  }),
                  intersectionId:
                    record.intersectionId ||
                    "I-" + canonicalIntersectionKey(record.name),
                });
              }),
            ),
          );
          setProjects(data.projects);
          setActiveProjectId(data.activeProjectId || data.projects[0].id);
        } else if (data.records.length) {
          const migratedId = "P-migrated-v1";
          setProjects([
            {
              id: migratedId,
              code: "MIGRATED",
              name: "舊版資料移轉",
              client: "",
              note: "由 v1.0 本機資料自動移轉；請重新核對匯入欄位。",
              createdAt: new Date().toISOString(),
            },
          ]);
          setActiveProjectId(migratedId);
          setRecords(
            synchronizeGeometryAcrossQuarters(
              data.records.map(function (record: TrafficRecord) {
                return applyReferenceMovementRule({
                  ...record,
                  projectId: migratedId,
                  name: storedNameOf(record),
                  approaches: record.approaches.map(function (approach) {
                    return {
                      ...approach,
                      bearing: bearingFromAngle(approach.angle),
                    };
                  }),
                  intersectionId:
                    record.intersectionId ||
                    "I-" + canonicalIntersectionKey(record.name),
                });
              }),
            ),
          );
        }
      }
      if (data.nameMap) setNameMap(data.nameMap);
      /*
       * 車種設定：新版是「依計畫各存一份」，舊版是全域一份。
       * 讀到舊版資料時把那一份複製給每一個現有計畫，使用者原本看到的數字
       * 完全不變；之後各計畫才會各走各的。
       */
      const projectIds = (data.projects || []).map(function (project: Project) {
        return project.id;
      });
      const spread = function <T>(value: T) {
        return Object.fromEntries(projectIds.map((id: string) => [id, value]));
      };
      setPceByProject(
        data.pceByProject && typeof data.pceByProject === "object"
          ? data.pceByProject
          : spread(data.pce || DEFAULT_PCE),
      );
      setCatalogByProject(
        data.catalogByProject && typeof data.catalogByProject === "object"
          ? data.catalogByProject
          : spread({ ...CORE_VEHICLE_LABELS, ...(data.vehicleCatalog || {}) }),
      );
      setMappingsByProject(
        data.mappingsByProject && typeof data.mappingsByProject === "object"
          ? data.mappingsByProject
          : spread(data.vehicleMappings || {}),
      );
      if (Array.isArray(data.formatMemories))
        setFormatMemories(data.formatMemories);
      if (Array.isArray(data.vehicleSchemes))
        setVehicleSchemes(data.vehicleSchemes);
      if (Array.isArray(data.reportTemplates))
        setReportTemplates(data.reportTemplates);
      if (Array.isArray(data.conclusionTemplates))
        setConclusionTemplates(data.conclusionTemplates);
      if (Array.isArray(data.recordRevisions))
        setRecordRevisions(data.recordRevisions);
    } catch (error) {
      /*
       * 讀取失敗絕對不能靜靜吞掉。
       *
       * 舊版在這裡什麼都不做，而下面的存檔 effect 又會在同一次 commit 就把
       * 「還是空的」state 寫回去——只要儲存的資料裡有一筆格式不對（少一個
       * 欄位就夠），使用者的全部計畫會在開啟網頁的瞬間被空白覆蓋掉，
       * 畫面上沒有任何訊息。現在改成：讀取失敗就不解鎖存檔，原始資料
       * 原封不動留在瀏覽器裡，並明確告訴使用者發生什麼事、該怎麼救。
       */
      setLoadError(
        error instanceof Error ? error.message : "資料格式無法解析",
      );
      return;
    }
    setLoaded(true);
  }, []);

  useEffect(
    function () {
      /*
       * 讀取完成之前一律不寫入。
       *
       * 這兩個 effect 屬於同一次 commit，存檔這一個的閉包裡抓到的是「還沒
       * 載入、全部是空的」那一份 state，所以每次開啟網頁都會先把空白寫回
       * 儲存、下一個 tick 才寫回真實資料。中間只要出任何差錯，資料就沒了。
       */
      if (!loaded) return;
      const base = {
        kind: "TURNING_TRAFFIC_STATE",
        version: VERSION,
        projects: projects,
        activeProjectId: activeProjectId,
        records: records,
        nameMap: nameMap,
        pceByProject: pceByProject,
        catalogByProject: catalogByProject,
        mappingsByProject: mappingsByProject,
        /* 舊版欄位仍然寫出目前計畫的那一份，萬一退版也還讀得到東西。 */
        pce: pce,
        vehicleCatalog: vehicleCatalog,
        vehicleMappings: vehicleMappings,
        formatMemories: formatMemories,
        vehicleSchemes: vehicleSchemes,
        reportTemplates: reportTemplates,
        conclusionTemplates: conclusionTemplates,
      };
      // 儲存空間有上限（約 5MB）。寫入失敗時若讓例外從 effect 逃出去，
      // React 會整棵樹卸載，畫面就變成空白的「This page couldn't load」。
      // 這裡改成先丟掉最占空間的還原點，再不行就只保留最近 20 筆版本，
      // 最後才放棄並提醒使用者匯出備份——但畫面一定不會壞。
      const attempts = [
        { ...base, recordRevisions: recordRevisions },
        { ...base, recordRevisions: recordRevisions.slice(0, 20) },
        { ...base, recordRevisions: [] },
      ];
      for (let index = 0; index < attempts.length; index += 1) {
        try {
          localStorage.setItem(
            "turning-traffic-state-v2",
            JSON.stringify(attempts[index]),
          );
          /*
           * 降級存檔一定要講出來。
           * 丟掉還原點之後，畫面上的「版本差異與還原」清單讀的是記憶體裡的
           * state，仍然完整顯示 N 筆——但那些已經沒有存進去了，重新整理就
           * 全部消失，而那正是使用者要靠還原點救資料的時候。
           * 使用者依據一個已經不存在的救援選項做決定，比存不進去更危險。
           */
          if (index > 0) {
            const kept = attempts[index].recordRevisions.length;
            setToast(
              "瀏覽器儲存空間快滿了，這次存檔只保留 " +
                kept +
                " 筆還原點（原本 " +
                recordRevisions.length +
                " 筆）。畫面上仍會列出全部，但重新整理之後只會剩下有存到的那些。" +
                "請盡快到「備份、還原與版本」下載備份。",
            );
          }
          return;
        } catch {
          /* 換下一種較精簡的內容再試一次 */
        }
      }
      setToast(
        "瀏覽器儲存空間已滿，本次變更沒有存檔。請先到「備份、還原與版本」下載備份，再清理舊資料。",
      );
    },
    [
      projects,
      activeProjectId,
      records,
      nameMap,
      pce,
      vehicleCatalog,
      vehicleMappings,
      formatMemories,
      vehicleSchemes,
      reportTemplates,
      conclusionTemplates,
      recordRevisions,
      loaded,
    ],
  );

  const notify = function (message: string) {
    setToast(message);
    setTimeout(function () {
      setToast("");
    }, 2800);
  };
  const activeProject = projects.find(function (project) {
    return project.id === activeProjectId;
  });
  /* 目前計畫要匯出哪些分析項目；沒設定過就用預設組合。 */
  const activeReportItems = useMemo(
    function () {
      return normalizeReportItems(activeProject?.reportItems);
    },
    [activeProject],
  );
  function setActiveReportItems(next: ReportItemKey[]) {
    if (!activeProjectId) return;
    setProjects(function (all) {
      return all.map(function (project) {
        return project.id === activeProjectId
          ? { ...project, reportItems: next }
          : project;
      });
    });
  }
  function toggleReportItem(key: ReportItemKey) {
    setActiveReportItems(
      activeReportItems.includes(key)
        ? activeReportItems.filter(function (item) {
            return item !== key;
          })
        : REPORT_ITEMS.map(function (item) {
            return item.key;
          }).filter(function (item) {
            return item === key || activeReportItems.includes(item);
          }),
    );
  }
  const projectRecords = useMemo(
    function () {
      return records.filter(function (record) {
        return record.projectId === activeProjectId;
      });
    },
    [records, activeProjectId],
  );
  const quarters = useMemo(
    function () {
      return Array.from(
        new Set(
          projectRecords.map(function (record) {
            return record.quarter;
          }),
        ),
      ).sort(compareQuarters);
    },
    [projectRecords],
  );
  useEffect(
    function () {
      if (!quarter || !quarters.includes(quarter))
        setQuarter(quarters.at(-1) || "");
    },
    [quarters, quarter],
  );
  const allQuarterKeys = useMemo(
    function () {
      return Array.from(
        new Set(
          records.map(function (record) {
            return record.quarter;
          }),
        ),
      ).sort(compareQuarters);
    },
    [records],
  );
  useEffect(
    function () {
      setBatchQuarterKeys(function (value) {
        const valid = value.filter(function (item) {
          return allQuarterKeys.includes(item);
        });
        return valid.length ? valid : allQuarterKeys;
      });
    },
    [allQuarterKeys],
  );
  useEffect(
    function () {
      setReportStartQuarter(function (value) {
        return quarters.includes(value) ? value : quarters[0] || "";
      });
      setReportEndQuarter(function (value) {
        return quarters.includes(value) ? value : quarters.at(-1) || "";
      });
    },
    [quarters],
  );
  useEffect(
    function () {
      setBatchProjectIds(function (value) {
        const valid = value.filter(function (id) {
          return projects.some(function (project) {
            return project.id === id;
          });
        });
        return valid.length ? valid : activeProjectId ? [activeProjectId] : [];
      });
    },
    [projects, activeProjectId],
  );
  const current = projectRecords.filter(function (record) {
    return record.quarter === quarter;
  });
  const currentCanonicalRecords = [
    ...new Map(
      current.map(function (record) {
        return [recordIntersectionKey(record), record];
      }),
    ).values(),
  ];
  const canonicalRecords = useMemo(
    function () {
      return [
        ...new Map(
          projectRecords.map(function (record) {
            return [recordIntersectionKey(record), record];
          }),
        ).values(),
      ];
    },
    [projectRecords],
  );
  const selectedIntersectionRecords = current.filter(function (record) {
    const activeKey =
      selectedIntersection ||
      (current[0] ? recordIntersectionKey(current[0]) : "");
    return recordIntersectionKey(record) === activeKey;
  });
  const selected =
    selectedIntersectionRecords.find(function (record) {
      return record.surveyType === selectedSurveyType;
    }) ||
    selectedIntersectionRecords[0] ||
    current[0] ||
    projectRecords[0] ||
    null;
  useEffect(
    function () {
      if (selected && recordIntersectionKey(selected) !== selectedIntersection)
        setSelectedIntersection(recordIntersectionKey(selected));
    },
    [selected, selectedIntersection],
  );
  useEffect(
    function () {
      if (selected && selected.surveyType !== selectedSurveyType)
        setSelectedSurveyType(selected.surveyType || "待設定");
    },
    [selected, selectedSurveyType],
  );
  /*
   * 聚焦支線的索引要跟著路口走。刪掉支線或換到支線比較少的路口之後，
   * 舊索引會指向不存在的支線，聚焦模式就會一條箭線都畫不出來，
   * 而下拉選單看起來卻是選在第一條，畫面與狀態不一致。
   */
  useEffect(
    function () {
      const count = selected?.approaches.length ?? 0;
      if (count && focusIndex >= count) setFocusIndex(0);
    },
    [selected, focusIndex],
  );
  const issues = useMemo(
    function () {
      return qualityIssues(projectRecords);
    },
    [projectRecords],
  );
  /*
   * 報表匯出的季度範圍與資料筆數。
   *
   * Excel 匯出與報告文字草稿都要用「完全同一批紀錄」，否則草稿寫的數字會
   * 跟附表對不起來。所以這段只算一次，兩邊共用。
   * 起訖季度反過來選（例如起 115Q4、訖 115Q1）時取兩者之間，不當成空範圍。
   */
  const reportExportScope = useMemo(
    function () {
      const requestedStartIndex = Math.max(
        0,
        quarters.indexOf(reportStartQuarter),
      );
      const requestedEndIndex = Math.max(0, quarters.indexOf(reportEndQuarter));
      const startIndex = Math.min(requestedStartIndex, requestedEndIndex);
      const endIndex = Math.max(requestedStartIndex, requestedEndIndex);
      const selectedQuarters = quarters.slice(startIndex, endIndex + 1);
      return {
        quarters: selectedQuarters,
        records: projectRecords.filter(function (record) {
          return selectedQuarters.includes(record.quarter);
        }),
      };
    },
    [quarters, reportStartQuarter, reportEndQuarter, projectRecords],
  );
  /*
   * 報告文字草稿要用的數字。
   *
   * 三個原則：
   * 1. 全部沿用產生 Excel 的同一批函式（recordTotal、inboundAnalysisRows、
   *    odMatrix、branchBalance、conservationCheck、qualityIssues…），
   *    草稿不自己另算一次。
   * 2. 尖峰小時流量不能跨路口或跨季度相加，所以支線、車種這類敘述固定以
   *    一筆「代表資料」為準（目前選定路口在範圍內的最新一季），並在草稿裡
   *    寫明是哪一筆。
   * 3. 取最大值、計數、逐季列出這類不牽涉相加的敘述才涵蓋整個匯出範圍。
   */
  const reportDraftContext = useMemo(
    function (): ReportDraftContext | null {
      const exportRecords = reportExportScope.records;
      if (!exportRecords.length) return null;
      const quarterKeys = Array.from(
        new Set(
          exportRecords.map(function (record) {
            return record.quarter;
          }),
        ),
      ).sort(compareQuarters);
      const quarterRange =
        quarterKeys.length > 1
          ? quarterKeys[0] + "～" + quarterKeys[quarterKeys.length - 1]
          : quarterKeys[0] || "";
      const intersectionKeys = Array.from(
        new Set(exportRecords.map(recordIntersectionKey)),
      );
      /*
       * 每個「路口 × 資料別」在範圍內的最新一季。
       *
       * 一定要把資料別也放進 key：recordIntersectionKey 會把平日與假日
       * 正規化成同一個 key，只用它分組的話，同一個路口的平日與假日會互相
       * 覆蓋，「各路口比較」就會少掉一半的列，代表資料也可能挑到使用者
       * 沒有在看的那一種日別。
       */
      const latestBySeries = new Map<string, TrafficRecord>();
      const seriesKeyOf = function (record: TrafficRecord) {
        // 站號一起放進 key。recordIntersectionKey 會把同一個交流道的北向與
        // 南向站正規化成同一個名稱，只用它分組會讓其中一站整個消失，
        // 而 Excel 的跨計畫多路口比較兩站都會列——兩份成果對不起來。
        return [
          recordIntersectionKey(record),
          record.station,
          record.surveyType || "待設定",
        ].join("|");
      };
      exportRecords.forEach(function (record) {
        const key = seriesKeyOf(record);
        const kept = latestBySeries.get(key);
        if (!kept || compareQuarters(record.quarter, kept.quarter) > 0)
          latestBySeries.set(key, record);
      });
      /*
       * 全篇統一的一筆資料標示法。舊版 topFlow／worstBalance 只寫「站號 季度」，
       * 同一站同一季同時有平日與假日時無法分辨，也對不上其他段落的寫法。
       */
      const siteLabelOf = function (record: TrafficRecord) {
        return `${record.name || record.station} ${record.quarter}（${
          record.surveyType || "待設定"
        }）`;
      };
      /*
       * 代表資料：優先取「使用者目前選的路口＋目前選的資料別」的最新一季；
       * 該資料別在範圍內沒有資料時才退回同一路口的其他資料別。
       */
      const focus =
        (selected && latestBySeries.get(seriesKeyOf(selected))) ||
        (selected &&
          [...latestBySeries.values()].find(function (record) {
            return (
              recordIntersectionKey(record) === recordIntersectionKey(selected)
            );
          })) ||
        latestBySeries.values().next().value ||
        exportRecords[0];
      const focusLabel = siteLabelOf(focus);
      const peakLabel = function (peakKey: PeakKey) {
        const own =
          focus.peaks[peakKey].start + "–" + focus.peaks[peakKey].end;
        const others = new Set(
          exportRecords.map(function (record) {
            return record.peaks[peakKey].start + "–" + record.peaks[peakKey].end;
          }),
        );
        others.delete(own);
        return own + (others.size ? `（其餘資料另有 ${others.size} 種時段）` : "");
      };
      const focusRows = inboundAnalysisRows(focus);
      const armFlows = function (direction: "inbound" | "outbound") {
        return focusRows
          .map(function (row) {
            return {
              name: row.approach.name,
              am: direction === "inbound" ? row.inboundAmPcu : row.outboundAmPcu,
              pm: direction === "inbound" ? row.inboundPmPcu : row.outboundPmPcu,
            };
          })
          .sort(function (a, b) {
            return b.am - a.am || b.pm - a.pm;
          });
      };
      const sumBy = function (
        rows: { am: number; pm: number }[],
        peak: "am" | "pm",
      ) {
        return (
          Math.round(
            rows.reduce(function (sum, row) {
              return sum + row[peak];
            }, 0) * 10,
          ) / 10
        );
      };
      const outbound = armFlows("outbound");
      const inbound = armFlows("inbound");
      /* 車種組成：全調查時段有資料就用它，否則退回 AM 尖峰。 */
      const focusVehicleIds = recordVehicleIds(focus);
      const surveyTotal = focusVehicleIds.reduce(function (sum, id) {
        return sum + recordVehicleTotal(focus, "SURVEY", id);
      }, 0);
      const compositionKey: CompositionScope = surveyTotal > 0 ? "SURVEY" : "AM";
      const compositionCounts = focusVehicleIds.map(function (id) {
        return {
          label: vehicleLabel(focus, id),
          count: recordVehicleTotal(focus, compositionKey, id),
        };
      });
      const compositionTotal = compositionCounts.reduce(function (sum, item) {
        return sum + item.count;
      }, 0);
      /* OD 矩陣中最大的一筆：取最大值不牽涉相加，可以跨整個範圍找。 */
      let topFlow: ReportDraftContext["topFlow"] = null;
      let worstBalance: ReportDraftContext["worstBalance"] = null;
      let conservationChecked = 0;
      let conservationPassed = 0;
      exportRecords.forEach(function (record) {
        (["AM", "PM"] as PeakKey[]).forEach(function (peakKey) {
          odMatrix(record, peakKey).forEach(function (row) {
            row.values.forEach(function (value, destinationIndex) {
              const destination = record.approaches[destinationIndex];
              if (!destination || destination.id === row.originId) return;
              // value > 0 是必要的：舊版匯入的紀錄沒有 routes，整個矩陣都是 0，
              // 只判斷 !topFlow 會寫出「流量最高的一筆為 … 0.0 PCU/hr」，
              // 正確的表現是讓這一段落回到「沒有可敘述的資料」。
              if (value > 0 && (!topFlow || value > topFlow.pcu))
                topFlow = {
                  station: siteLabelOf(record),
                  peak: peakKey,
                  from: row.origin,
                  to: destination.name,
                  pcu: value,
                };
            });
          });
          branchBalance(record, peakKey).forEach(function (row) {
            // Number.isFinite 不能省：資料含非數值欄位時 difference 會是 NaN，
            // 而 `x > NaN` 永遠是 false，之後每一列都比不過它——真正最大的
            // 失衡就永遠不會被報出來，畫面上只看到一個「—」。
            if (
              Number.isFinite(row.difference) &&
              (!worstBalance ||
                Math.abs(row.difference) > Math.abs(worstBalance.difference))
            )
              worstBalance = {
                station: siteLabelOf(record),
                peak: peakKey,
                name: row.name,
                difference: row.difference,
              };
          });
          /*
           * 沒有 routes 的舊版紀錄不算進守恆檢核。
           * conservationCheck 對這種紀錄會讓 routePeakTotal 直接退回
           * recordPeakTotal，於是必定「通過」——那不是檢查結果，是同義反覆。
           * 一整批舊資料會得到「共檢查 N 組，通過 N 組」的假保證。
           */
          if (record.routes?.length) {
            const check = conservationCheck(record, peakKey);
            conservationChecked += 1;
            if (check.valid) conservationPassed += 1;
          }
        });
      });
      const draftIssues = qualityIssues(exportRecords);
      const categoryCounts = new Map<string, number>();
      draftIssues.forEach(function (issue) {
        categoryCounts.set(
          issue.category,
          (categoryCounts.get(issue.category) || 0) + 1,
        );
      });
      /* 當量矩陣：與「車種轉向當量」工作表同樣看 pceUsed，不是畫面上的設定。 */
      const matrixSignatures = new Set(
        exportRecords.map(function (record) {
          return JSON.stringify(record.pceUsed || DEFAULT_PCE);
        }),
      );
      const focusMatrix = focus.pceUsed || DEFAULT_PCE;
      const trendRecords = trendSeriesRecords(exportRecords, selected);
      return {
        projectName: activeProject?.name || "",
        quarterRange,
        quarterCount: quarterKeys.length,
        intersectionCount: intersectionKeys.length,
        recordCount: exportRecords.length,
        focusLabel,
        /*
         * 尖峰時段一定要報「代表資料自己的」時段。
         * 舊寫法取全範圍的眾數，但下面的支線、車種、路口總量全部來自 focus，
         * 讀者會把 focus 的數字掛在別筆的時段上。時段不只一種時另外註明。
         */
        peaks: {
          am: peakLabel("AM"),
          pm: peakLabel("PM"),
        },
        /*
         * 各路口分項結果。整體總結回答「這個範圍加起來多少」，但報告通常還要
         * 逐個路口交代「A 路口上午尖峰多少、下午尖峰多少」。
         * 每一筆用自己的尖峰時段與自己的支線，所以這一段可以涵蓋整個匯出
         * 範圍，不需要像整體總結那樣挑一筆代表資料。
         */
        siteSummaries: exportRecords
          .slice()
          // 逐筆敘述會很長（每筆兩行、每行含全部支線），超過 30 筆時先截斷，
          // 並在段末說明還有幾筆——整段塞進文字框反而沒人看得完。
          /*
           * 由新到舊排序，截斷時留下的才是最新的資料。
           * 舊寫法是由舊到新再 .slice(0, 30)，4 季 × 10 路口 × 平假日的案子
           * 會剛好把最新一季整個切掉，而草稿其他段落講的都是最新一季——
           * 使用者拿到的分項結果與前後文完全對不上。
           */
          .sort(function (a, b) {
            return (
              compareQuarters(b.quarter, a.quarter) ||
              (a.name || a.station).localeCompare(b.name || b.station, "zh-Hant")
            );
          })
          .slice(0, SITE_SUMMARY_LIMIT)
          .map(function (record) {
            const rows = inboundAnalysisRows(record);
            const vehicleIds = recordVehicleIds(record);
            return {
              name: siteLabelOf(record),
              peaks: (["AM", "PM"] as PeakKey[]).map(function (peakKey) {
                const vehicleSum = vehicleIds.reduce(function (sum, id) {
                  return sum + recordVehicleTotal(record, peakKey, id);
                }, 0);
                return {
                  label: peakKey === "AM" ? "上午尖峰" : "下午尖峰",
                  hour:
                    record.peaks[peakKey].start +
                    "–" +
                    record.peaks[peakKey].end,
                  total: recordTotal(record, peakKey),
                  arms: rows.map(function (row) {
                    return {
                      name: row.approach.name,
                      outbound:
                        peakKey === "AM" ? row.outboundAmPcu : row.outboundPmPcu,
                      inbound:
                        peakKey === "AM" ? row.inboundAmPcu : row.inboundPmPcu,
                    };
                  }),
                  vehicles: vehicleSum
                    ? vehicleIds
                        .map(function (id) {
                          return {
                            label: vehicleLabel(record, id),
                            share:
                              (recordVehicleTotal(record, peakKey, id) /
                                vehicleSum) *
                              100,
                          };
                        })
                        .filter(function (item) {
                          return item.share > 0;
                        })
                        .sort(function (a, b) {
                          return b.share - a.share;
                        })
                    : [],
                };
              }),
            };
          }),
        siteOmitted: Math.max(0, exportRecords.length - SITE_SUMMARY_LIMIT),
        routelessRecords: exportRecords.filter(function (record) {
          return !record.routes?.length;
        }).length,
        compareIntersections: new Set(
          [...latestBySeries.values()].map(recordIntersectionKey),
        ).size,
        outbound,
        inbound,
        totals: {
          am: recordTotal(focus, "AM"),
          pm: recordTotal(focus, "PM"),
        },
        flowTotals: {
          outboundAm: sumBy(outbound, "am"),
          outboundPm: sumBy(outbound, "pm"),
          inboundAm: sumBy(inbound, "am"),
          inboundPm: sumBy(inbound, "pm"),
        },
        vehicles: compositionCounts.map(function (item) {
          return {
            label: item.label,
            count: item.count,
            share: compositionTotal ? (item.count / compositionTotal) * 100 : 0,
          };
        }),
        compositionScope:
          compositionKey === "SURVEY" ? "全調查時段" : "上午尖峰小時",
        compositionUnit: compositionKey === "SURVEY" ? "輛/調查時段" : "輛/hr",
        trend: trendRecords.map(function (record) {
          return {
            quarter: record.quarter,
            am: recordTotal(record, "AM"),
            pm: recordTotal(record, "PM"),
          };
        }),
        // 標籤一定要取自趨勢序列自己的第一筆，不能拿 focus 來標：
        // 兩者的挑選規則不同（趨勢取範圍內第一筆、focus 取最新一季），
        // 同一路口同時有平日與假日時會標成另一種資料別，數字與說明對不起來。
        trendLabel: trendRecords.length
          ? `${trendRecords[0].name || trendRecords[0].station}／${
              trendRecords[0].surveyType || "待設定"
            }`
          : "—",
        compare: Array.from(latestBySeries.values())
          .map(function (record) {
            return {
              name: siteLabelOf(record),
              am: recordTotal(record, "AM"),
              pm: recordTotal(record, "PM"),
            };
          })
          .sort(function (a, b) {
            return b.am - a.am || b.pm - a.pm;
          }),
        topFlow,
        worstBalance,
        conservation: {
          checked: conservationChecked,
          passed: conservationPassed,
        },
        quality: {
          total: draftIssues.length,
          errors: draftIssues.filter(function (issue) {
            return issue.severity === "error";
          }).length,
          warnings: draftIssues.filter(function (issue) {
            return issue.severity === "warning";
          }).length,
          topCategories: Array.from(categoryCounts.entries())
            .sort(function (a, b) {
              return b[1] - a[1];
            })
            .slice(0, 2)
            .map(function (entry) {
              return `${entry[0]} ${entry[1]} 項`;
            }),
        },
        factors: Object.keys(focusMatrix)
          .sort()
          .map(function (id) {
            return {
              label:
                vehicleCatalog[id] ||
                VEHICLE_LABELS[id] ||
                CORE_VEHICLE_LABELS[id] ||
                id,
              left: focusMatrix[id].left,
              through: focusMatrix[id].through,
              right: focusMatrix[id].right,
            };
          }),
        factorMatrixCount: matrixSignatures.size,
      };
    },
    [reportExportScope, selected, activeProject, vehicleCatalog],
  );
  const draftSections = useMemo(
    function (): DraftSectionKey[] {
      if (draftSectionOverride) return draftSectionOverride;
      return (
        DRAFT_ONLY_SECTIONS.map(function (item) {
          return item.key as DraftSectionKey;
        }) as DraftSectionKey[]
      ).concat(activeReportItems);
    },
    [draftSectionOverride, activeReportItems],
  );
  const generatedReportDraft = useMemo(
    function () {
      return reportDraftContext
        ? buildReportDraft(reportDraftContext, draftSections)
        : "";
    },
    [reportDraftContext, draftSections],
  );
  useEffect(
    function () {
      if (!reportDraftEdited) setReportDraftText(generatedReportDraft);
    },
    [generatedReportDraft, reportDraftEdited],
  );
  /* 換計畫時草稿要重新開始，不然會把上一個計畫的文字留在畫面上。 */
  useEffect(
    function () {
      setDraftSectionOverride(null);
      setReportDraftEdited(false);
    },
    [activeProjectId],
  );
  function toggleDraftSection(key: DraftSectionKey) {
    const next = draftSections.includes(key)
      ? draftSections.filter(function (item) {
          return item !== key;
        })
      : DRAFT_SECTION_ORDER.filter(function (item) {
          return item === key || draftSections.includes(item);
        });
    setDraftSectionOverride(next);
  }
  const currentIssues = issues.filter(function (issue) {
    return issue.quarter === quarter;
  });
  const selectedIssue =
    currentIssues.find(function (issue) {
      return issue.id === selectedIssueId;
    }) || null;
  const ranked = [...current].sort(function (a, b) {
    return recordTotal(b, peak) - recordTotal(a, peak);
  });
  const top = ranked[0];
  const previousQuarter = quarters[quarters.indexOf(quarter) - 1];
  const previous = projectRecords.filter(function (record) {
    return record.quarter === previousQuarter;
  });
  /*
   * 「較上季」只能比「兩季都有調查的同一個路口、同一種資料別、同一個尖峰」。
   *
   * 舊寫法把整季所有路口的 AM 與 PM 全部相加再相除，有三個問題：
   * 1. PCU/hr 是某一小時的率，不同路口、不同時段相加沒有意義；
   * 2. AM 與 PM 是兩個不同的小時，加在一起也沒有意義；
   * 3. 兩季調查的路口數不同時（本季多測一個路口），分子分母的基準就不同，
   *    實測出現「本季 +354.4%」而其實每個路口都沒什麼變化，
   *    或「-50%」而唯一可比的路口其實成長一倍。
   * 現在改成逐一配對後才加總，並在下面標示實際比較了幾個路口。
   */
  const changeSeriesKey = function (record: TrafficRecord) {
    return [
      recordIntersectionKey(record),
      record.station,
      record.surveyType || "待設定",
    ].join("|");
  };
  const previousByKey = new Map(
    previous.map(function (record) {
      return [changeSeriesKey(record), record] as const;
    }),
  );
  const comparablePairs = current
    .map(function (record) {
      const before = previousByKey.get(changeSeriesKey(record));
      return before ? { now: record, before } : null;
    })
    .filter(Boolean) as { now: TrafficRecord; before: TrafficRecord }[];
  const pairedChange = function (peakKey: PeakKey) {
    const now = comparablePairs.reduce(function (sum, pair) {
      return sum + recordTotal(pair.now, peakKey);
    }, 0);
    const before = comparablePairs.reduce(function (sum, pair) {
      return sum + recordTotal(pair.before, peakKey);
    }, 0);
    return before ? (now / before - 1) * 100 : null;
  };
  // AM 與 PM 分開報，不相加。畫面上顯示目前選定的尖峰。
  const change = comparablePairs.length ? pairedChange(peak) : null;
  const maxRank = Math.max(
    1,
    ...ranked.map(function (record) {
      return recordTotal(record, peak);
    }),
  );
  const importPeriod =
    importYear && importQuarterNo ? importYear + "Q" + importQuarterNo : "";
  const importVehicleDefinitions = [
    ...new Map(
      importRows
        .flatMap(function (row) {
          return row.detectedVehicles;
        })
        .map(function (definition) {
          return [definition.id, definition] as const;
        }),
    ).values(),
  ];
  const selectedVehicleIds = selected ? recordVehicleIds(selected) : [];
  const currentVehicleIds = [
    ...new Set(
      currentCanonicalRecords.flatMap(function (record) {
        return recordVehicleIds(record);
      }),
    ),
  ];

  /*
   * 一次把這個計畫裡還掛著「待設定」的紀錄補上資料別。
   *
   * 為什麼需要這顆按鈕：資料別是**匯入當下**判定並存進每一筆紀錄的，之後不會
   * 重讀，程式改版也不會回頭改既有資料。所以舊版匯入時讀不到、存成待設定的
   * 那幾季，即使現在的版本讀得出來了，畫面上仍然掛著待設定——而且因為
   * 「待設定」和「平日」被當成兩種資料別，同一個路口的趨勢線會被拆成兩條
   * （選平日只剩 1 季、選待設定才有 4 季）。
   *
   * 一筆一筆改要切換路口與季度，很容易漏掉，所以提供這個批次入口。
   * 它只動「目前是待設定」的紀錄，已經是平日／假日的一律不碰，
   * 而且每一筆都會先存還原點。
   */
  function pendingSurveyTypeRecords(intersectionKey?: string) {
    return projectRecords.filter(function (record) {
      if ((record.surveyType || "待設定") !== "待設定") return false;
      if (!intersectionKey) return true;
      return recordIntersectionKey(record) === intersectionKey;
    });
  }

  function assignPendingSurveyType(value: string, intersectionKey?: string) {
    const targets = pendingSurveyTypeRecords(intersectionKey);
    if (!targets.length) return notify("目前沒有『待設定』的紀錄。");
    if (!authorizeLockedChange(targets, "批次指定資料別")) return;
    /*
     * 一定要把「是哪幾筆」列出來。
     * 這個計畫可能真的同時做過平日與假日調查，只是其中幾筆讀不出來；
     * 只寫「N 筆」的話，使用者無從判斷全部指定為平日對不對。
     */
    const listed = targets
      .map(function (record) {
        return "・" + record.quarter + "　" + record.station + "　" + record.name;
      })
      .join("\n");
    if (
      !confirm(
        "要把以下 " +
          targets.length +
          " 筆「待設定」指定為「" +
          value +
          "」嗎？\n\n" +
          listed +
          "\n\n" +
          "只會更動上列這幾筆，已經是平日／假日的不會被改到。\n" +
          "如果其中有的其實是假日，請按取消，改到「流量核對工作台」逐筆指定。\n" +
          "每一筆都會先自動保存還原點，之後可以在「版本差異與還原」還原。",
      )
    )
      return;
    const ids = new Set(targets.map((record) => record.id));
    targets.forEach(function (record) {
      saveRevision(record, "批次指定資料別前自動保存");
    });
    setRecords(
      records.map(function (record) {
        return ids.has(record.id) ? { ...record, surveyType: value } : record;
      }),
    );
    notify(
      "已把 " + targets.length + " 筆「待設定」指定為「" + value + "」。",
    );
  }

  function saveRevision(record: TrafficRecord, reason: string) {
    const revision: RecordRevision = {
      id: record.id + "-R-" + Date.now().toString(36),
      recordId: record.id,
      savedAt: new Date().toISOString(),
      reason,
      snapshot: structuredClone(record),
    };
    setRecordRevisions(function (items) {
      return [revision, ...items].slice(0, 300);
    });
  }

  function authorizeLockedChange(targets: TrafficRecord[], action: string) {
    const locked = targets.filter(function (record) {
      return Boolean(record.resultLock);
    });
    if (!locked.length) return true;
    const conflicts = locked.map(lockConflict).filter(Boolean);
    return confirm(
      action +
        "會修改 " +
        locked.length +
        " 筆已鎖定成果。" +
        (conflicts.length
          ? "\n另偵測到：" + Array.from(new Set(conflicts)).join("；")
          : "") +
        "\n是否解除相關成果鎖定並繼續？",
    );
  }

  function lockCurrentQuarter() {
    if (!current.length) return notify("目前季度沒有可鎖定的成果。");
    /*
     * ── 審核狀態要真的管到鎖定 ──
     *
     * 使用者問得很直接：不論審核狀態是「待核對」「已核對」「已確認」還是
     * 「需修正」，右上角的「鎖定成果」都按得下去，那這個欄位到底在幹嘛？
     * 舊版的答案是「什麼都沒幹」——它只是一個備註欄，鎖定完全不看它。
     *
     * 現在把兩者接起來：
     *   ・有任何一筆標成「需修正」→ 直接擋下來。那是使用者自己標的
     *     「這筆有問題」，鎖定的意思卻是「這批成果定案了」，兩件事互相矛盾。
     *   ・還有「待核對」→ 問一次，並把是哪幾個路口列出來。
     *   ・全部「已核對」或「已確認」→ 直接鎖。
     * 鎖定之後審核狀態就不能再改（見核對工作台），要改得先解除鎖定。
     */
    const labelOf = function (record: TrafficRecord) {
      return record.station + " " + record.name;
    };
    const needsFix = current.filter(function (record) {
      return record.review?.status === "需修正";
    });
    if (needsFix.length)
      return notify(
        "有 " +
          needsFix.length +
          " 筆的成果審核狀態是「需修正」，不能鎖定：" +
          needsFix.map(labelOf).join("、") +
          "。請先處理並改成「已核對」或「已確認」。",
      );
    const unchecked = current.filter(function (record) {
      return (record.review?.status || "待核對") === "待核對";
    });
    if (
      unchecked.length &&
      !confirm(
        "有 " +
          unchecked.length +
          "／" +
          current.length +
          " 筆還是「待核對」，尚未有人核對過：\n" +
          unchecked.map(labelOf).join("\n") +
          "\n\n鎖定的意思是這一季的成果定案，之後要改名稱、角度、流向或重新匯入都會先跳出確認。\n仍要現在鎖定嗎？",
      )
    )
      return;
    const now = new Date().toISOString();
    setRecords(function (all) {
      return all.map(function (record) {
        if (record.projectId !== activeProjectId || record.quarter !== quarter)
          return record;
        return {
          ...record,
          resultLock: {
            lockedAt: now,
            version: VERSION,
            signature: resultSignature(record),
          },
        };
      });
    });
    notify(quarter + " 成果已鎖定。");
  }

  function unlockCurrentQuarter() {
    const locked = current.filter(function (record) {
      return record.resultLock;
    });
    if (!locked.length) return;
    if (
      !confirm(
        "確定解除 " +
          quarter +
          " 的成果鎖定？解除後名稱、角度、流向與資料可再次修改。",
      )
    )
      return;
    setRecords(function (all) {
      return all.map(function (record) {
        return record.projectId === activeProjectId &&
          record.quarter === quarter
          ? { ...record, resultLock: undefined }
          : record;
      });
    });
    notify(quarter + " 已解除鎖定。");
  }

  useEffect(
    function () {
      if (view !== "import" || importYear || importQuarterNo) return;
      const match = quarter.match(/^(\d{2,4})Q([1-4])$/i);
      if (match) {
        setImportYear(match[1]);
        setImportQuarterNo(match[2]);
      }
    },
    [view, quarter, importYear, importQuarterNo],
  );

  function addProject() {
    if (!projectForm.name.trim()) return notify("請先輸入計畫名稱。");
    const id = "P-" + Date.now().toString(36);
    const project: Project = {
      id: id,
      code: projectForm.code.trim() || "P" + (projects.length + 1),
      name: projectForm.name.trim(),
      client: projectForm.client.trim(),
      note: projectForm.note.trim(),
      createdAt: new Date().toISOString(),
    };
    setProjects([...projects, project]);
    setActiveProjectId(id);
    setCompareProjects(function (all) {
      return [...all, id].slice(-4);
    });
    setProjectForm({ code: "", name: "", client: "", note: "" });
    notify("計畫已建立，現在可匯入第一季資料。");
  }

  function deleteProject(project: Project) {
    const projectRows = records.filter(function (record) {
      return record.projectId === project.id;
    });
    const projectQuarters = new Set(
      projectRows.map(function (record) {
        return record.quarter;
      }),
    ).size;
    const confirmed = confirm(
      "確定刪除計畫「" +
        project.code +
        " · " +
        project.name +
        "」？\n將一併刪除 " +
        projectRows.length +
        " 筆路口資料、" +
        projectQuarters +
        " 個季度。此動作無法復原，建議先匯出備份。",
    );
    if (!confirmed) return;
    const remainingProjects = projects.filter(function (item) {
      return item.id !== project.id;
    });
    setProjects(remainingProjects);
    setRecords(
      records.filter(function (record) {
        return record.projectId !== project.id;
      }),
    );
    setCompareProjects(
      compareProjects.filter(function (id) {
        return id !== project.id;
      }),
    );
    /*
     * 這個計畫的每一份設定與還原點也要跟著刪掉，否則會留下孤兒資料，
     * 一直吃 localStorage 的空間（空間不足時的降級寫入正是先丟還原點），
     * 而且下次若出現同 id 的計畫會撿到上一個計畫的當量矩陣。
     */
    const dropProject = function <T>(map: Record<string, T>) {
      const next = { ...map };
      delete next[project.id];
      return next;
    };
    setPceByProject(dropProject(pceByProject));
    setCatalogByProject(dropProject(catalogByProject));
    setMappingsByProject(dropProject(mappingsByProject));
    const removedIds = new Set(
      records
        .filter(function (record) {
          return record.projectId === project.id;
        })
        .map(function (record) {
          return record.id;
        }),
    );
    setRecordRevisions(
      recordRevisions.filter(function (revision) {
        return !removedIds.has(revision.recordId);
      }),
    );
    if (activeProjectId === project.id) {
      setActiveProjectId(remainingProjects[0]?.id || "");
      setQuarter("");
      setSelectedIntersection("");
      setImportRows([]);
      setImportResolutions({});
      setView("projects");
    }
    notify("已刪除計畫「" + project.name + "」。");
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    if (!importPeriod) return notify("請先選擇調查年度與季度，再選取檔案。");
    setImporting(true);
    const rows: ImportPreview[] = [];
    for (const file of Array.from(files)) {
      try {
        rows.push(...(await inspectWorkbookVariants(file, pce)));
      } catch (error) {
        rows.push({
          file: file.name,
          station: "—",
          name: normalizeIntersectionName(file.name),
          role: "無法辨識",
          sheets: { traffic: [], log: [], phase: [], ignored: [] },
          intervals: 0,
          am: null,
          pm: null,
          date: "",
          dateSource: null,
          surveyType: "待設定",
          layout: "unknown",
          approaches: [],
          columns: [],
          detectedVehicles: [],
          mappingConfidence: "low",
          warnings: [
            "讀取失敗：" +
              (error instanceof Error ? error.message : "未知錯誤"),
          ],
          pceUsed: structuredClone(pce),
        });
      }
    }
    const detectedDefinitions = new Map<
      string,
      { id: string; label: string }
    >();
    rows.forEach(function (row) {
      row.detectedVehicles.forEach(function (definition) {
        detectedDefinitions.set(definition.id, definition);
      });
    });
    const conflicts: Record<string, ImportConflictMode> = {};
    rows.forEach(function (row) {
      const existing = records.find(function (record) {
        return (
          record.projectId === activeProjectId &&
          record.quarter === importPeriod &&
          record.station === row.station &&
          (record.surveyType || "待設定") === (row.surveyType || "待設定")
        );
      });
      if (existing) conflicts[row.file] = "version";
    });
    setImportConflictModes(conflicts);
    /*
     * 預覽階段就把新車種寫進車種目錄／對應／當量矩陣，是為了讓下面的
     * 「車種歸類」面板馬上能操作。但那會讓「取消預覽」的承諾（正式資料
     * 完全不會變動）變成假的——實測取消之後，當量矩陣永遠多出一列，
     * 而畫面上沒有任何地方可以把它刪掉。
     * 所以這裡記下「這次預覽新增了哪些」，取消時原樣還原。
     */
    const addedNow: string[] = [];
    detectedDefinitions.forEach(function (definition) {
      if (!vehicleCatalog[definition.id] && !CORE_VEHICLE_LABELS[definition.id])
        addedNow.push(definition.id);
    });
    setPreviewAddedVehicles(addedNow);
    setVehicleCatalog(function (existing) {
      const next = { ...CORE_VEHICLE_LABELS, ...existing };
      detectedDefinitions.forEach(function (definition) {
        next[definition.id] = definition.label;
      });
      return next;
    });
    setVehicleMappings(function (existing) {
      const next = { ...existing };
      detectedDefinitions.forEach(function (definition) {
        if (!next[definition.id]) next[definition.id] = definition.id;
      });
      return next;
    });
    setPce(function (existing) {
      const next = structuredClone(existing);
      detectedDefinitions.forEach(function (definition) {
        if (!next[definition.id])
          next[definition.id] = { left: 1, through: 1, right: 1 };
      });
      return next;
    });
    const known = new Map<string, TrafficRecord>();
    projectRecords.forEach(function (record) {
      known.set(recordIntersectionKey(record), record);
    });
    const resolutions: Record<string, ImportResolution> = {};
    rows.forEach(function (row) {
      const key = canonicalIntersectionKey(row.name);
      const existing = [...known.values()].find(function (record) {
        return canonicalIntersectionKey(record.name) === key;
      });
      if (existing) {
        resolutions[row.file] = {
          action: "auto",
          targetId: recordIntersectionKey(existing),
        };
        return;
      }
      const possible = [...known.values()]
        .map(function (record) {
          return { record, score: nameSimilarity(row.name, record.name) };
        })
        .sort(function (a, b) {
          return b.score - a.score;
        })[0];
      resolutions[row.file] =
        possible && possible.score >= 0.58
          ? {
              action: "merge",
              targetId: recordIntersectionKey(possible.record),
            }
          : { action: "auto-new" };
    });
    setFormatMemories(function (existing) {
      const next = [...existing];
      rows
        .filter(function (row) {
          return Boolean(row.templateId);
        })
        .forEach(function (row) {
          const sheetPattern = row.sheets.traffic
            .map(function (name) {
              return name.normalize("NFKC").replace(/\d+/g, "#");
            })
            .sort()
            .join("｜");
          const id = [row.templateId, sheetPattern, row.columns.length].join(
            "::",
          );
          const found = next.findIndex(function (memory) {
            return memory.id === id;
          });
          const value: FormatMemory = {
            id,
            templateId: row.templateId || "semantic-turning-v1",
            templateName: row.templateName || "一般語意轉向表",
            sheetPattern,
            columnCount: row.columns.length,
            sampleFile: row.file,
            uses: found >= 0 ? next[found].uses + 1 : 1,
            lastUsedAt: new Date().toISOString(),
          };
          if (found >= 0) next[found] = value;
          else next.push(value);
        });
      return next
        .sort(function (a, b) {
          return b.lastUsedAt.localeCompare(a.lastUsedAt);
        })
        .slice(0, 50);
    });
    setImportRows(rows);
    setImportResolutions(resolutions);
    setImporting(false);
  }

  function commitImport() {
    if (!activeProjectId) return notify("請先建立並選擇計畫。");
    const q = importPeriod;
    if (!q) return notify("請先選擇調查年度與季度。");
    const originals = importRows.filter(function (row) {
      return (
        row.role === "原始交通量" &&
        Boolean(row.am || row.pm) &&
        row.layout !== "unknown" &&
        row.columns.length > 0 &&
        importResolutions[row.file]?.action !== "skip"
      );
    });
    if (!originals.length) return notify("沒有可寫入的原始交通量檔。");
    /* 比對規則見 lib/traffic.ts 的 isSameSurvey（含「待設定」為何要特別處理）。 */
    const sameSurvey = function (
      record: TrafficRecord,
      item: { station: string; surveyType: string },
    ) {
      return isSameSurvey(record, item, { projectId: activeProjectId, quarter: q });
    };
    const overwriteTargets = records.filter(function (record) {
      return originals.some(function (item) {
        return sameSurvey(record, item);
      });
    });
    /*
     * 同一批次裡撞號要先擋下來。
     * forEach 是對 next 做 findIndex，所以第二份同站號同資料別的檔案會找到
     * 第一份剛 push 進去的那筆並直接覆蓋——第一份的解析結果無聲消失，
     * 完成訊息卻說「已寫入 2 個路口」。使用者事後看不出少了哪一份。
     * 另外兩支程式都有擋（speed 會算出 owners 碰撞、traffic 的 validateImport
     * 會警告「匯入檔內有 N 組重複鍵值」），turning 這裡補上。
     */
    const seen = new Map<string, string[]>();
    for (const item of originals) {
      const key = item.station + "｜" + (item.surveyType || "待設定");
      const bucket = seen.get(key);
      if (bucket) bucket.push(item.file);
      else seen.set(key, [item.file]);
    }
    const collisions = [...seen.entries()].filter(function (entry) {
      return entry[1].length > 1;
    });
    if (collisions.length) {
      notify(
        "這批檔案裡有 " +
          collisions.length +
          " 組會互相覆蓋，已停止寫入：" +
          collisions
            .map(function (entry) {
              return entry[0] + "（" + entry[1].join("、") + "）";
            })
            .join("；") +
          "。它們被判定為同一個站號與資料別，一次匯入只會留下最後一份。" +
          "請在預覽列表用「刪除」留下要用的那一份，或分批匯入。",
      );
      return;
    }
    if (!authorizeLockedChange(overwriteTargets, "重新匯入")) return;
    const next = [...records];
    /* 有幾筆原本是「待設定」、這次被讀出的資料別補上了 */
    let upgraded = 0;
    /* 實際寫入與依使用者選擇略過的筆數——完成訊息要說實話。 */
    let written = 0;
    let skipped = 0;
    originals.forEach(function (item) {
      /*
       * 先找資料別完全相同的那一筆；找不到才退而找同站號的「待設定」，
       * 讓這次讀出來的平日／假日去補上它（見上面 sameSurvey 的說明）。
       * 兩段分開找而不是直接用 sameSurvey，是因為一個檔案同時有平日與假日
       * 兩張工作表時會產生兩筆，必須讓各自「完全相同」的那筆優先對到，
       * 不能讓先跑到的那一筆把待設定搶走。
       */
      const exact = next.findIndex(function (record) {
        return (
          record.projectId === activeProjectId &&
          record.quarter === q &&
          record.station === item.station &&
          (record.surveyType || "待設定") === (item.surveyType || "待設定")
        );
      });
      const found =
        exact >= 0
          ? exact
          : next.findIndex(function (record) {
              return sameSurvey(record, item);
            });
      const configuredItem = configuredImportPreview(
        item,
        pce,
        vehicleMappings,
      );
      const conflictMode = importConflictModes[item.file] || "overwrite";
      if (found >= 0 && conflictMode === "skip") {
        skipped += 1;
        return;
      }
      const created = recordFromPreview(
        configuredItem,
        activeProjectId,
        q,
        pce,
        vehicleMappings,
      );
      const resolution = importResolutions[item.file] || { action: "new" };
      const mergeTarget = resolution.targetId
        ? projectRecords.find(function (record) {
            return recordIntersectionKey(record) === resolution.targetId;
          })
        : undefined;
      created.intersectionId =
        mergeTarget?.intersectionId ||
        resolution.targetId ||
        "I-" + canonicalIntersectionKey(created.name);
      created.name = mergeTarget?.name || nameMap[item.file] || created.name;
      const geometrySource = found >= 0 ? next[found] : mergeTarget;
      if (geometrySource) inheritRecordGeometry(created, geometrySource);
      if (found >= 0) {
        if ((next[found].surveyType || "待設定") === "待設定" && exact < 0)
          upgraded += 1;
        saveRevision(
          next[found],
          conflictMode === "version" ? "重新匯入並建立新版本" : "重新匯入覆蓋",
        );
        created.revision = Number(next[found].revision || 1) + 1;
      }
      created.validation.referenceFound = importRows.some(function (row) {
        return row.role === "參考計算檔" && row.station === item.station;
      });
      if (found >= 0) next[found] = created;
      else next.push(created);
      written += 1;
    });
    setRecords(next);
    setQuarter(q);
    setImportRows([]);
    setImportResolutions({});
    setImportConflictModes({});
    /*
     * 檔案選取框也要清掉。
     * 使用者修好原始檔之後通常會再選同一個檔名，瀏覽器判斷 value 沒變就
     * 不會觸發 change，於是「重新選檔 → 什麼都沒發生」，沒有預覽也沒有訊息。
     *「取消預覽」早就有清，這裡漏掉了。
     */
    if (fileRef.current) fileRef.current.value = "";
    setPreviewAddedVehicles([]);
    notify(
      "已寫入 " +
        written +
        " 個路口" +
        (skipped ? "（另有 " + skipped + " 個依您的選擇略過）" : "") +
        "；同計畫、同季度、同站號採覆蓋更新。" +
        (upgraded
          ? "其中 " +
            upgraded +
            " 筆原本是「待設定」，已由這次讀到的資料別（平日／假日）補上，不會再多出一筆。"
          : ""),
    );
  }

  function updateSelected(mutator: (record: TrafficRecord) => TrafficRecord) {
    if (!selected) return;
    if (!authorizeLockedChange([selected], "此項修改")) return;
    saveRevision(selected, "人工修改前自動保存");
    setRecords(function (all) {
      return all.map(function (record) {
        if (record.id !== selected.id) return record;
        const changed = mutator(structuredClone(record));
        changed.resultLock = undefined;
        return changed;
      });
    });
  }

  function updateSelectedGeometry(
    mutator: (record: TrafficRecord) => TrafficRecord,
  ) {
    if (!selected) return;
    const selectedKey = recordIntersectionKey(selected);
    const affected = records.filter(function (record) {
      return (
        record.projectId === selected.projectId &&
        recordIntersectionKey(record) === selectedKey
      );
    });
    if (!authorizeLockedChange(affected, "道路幾何或流向修改")) return;
    saveRevision(selected, "道路幾何或圖面排位修改前自動保存");
    const updated = mutator(structuredClone(selected));
    updated.resultLock = undefined;
    /*
     * 跨季度同步是靠支線代碼比對的。人工新增的支線舊版一律叫「人工」，
     * 同一個路口若有兩條以上，Map 只會留下最後一條，另一季的兩條支線就會
     * 被寫成同一份資料（名稱、角度、版面全部一樣）。
     * 這裡對重複出現的代碼加上出現序號，讓每一條都能對到自己的那一條。
     */
    const codeKey = function (approaches: Approach[]) {
      const seen = new Map<string, number>();
      return approaches.map(function (approach) {
        const code = approach.sourceCode || approach.id;
        const index = seen.get(code) ?? 0;
        seen.set(code, index + 1);
        return index ? code + "#" + index : code;
      });
    };
    const updatedKeys = codeKey(updated.approaches);
    const geometryByCode = new Map(
      updated.approaches.map(function (approach, index) {
        return [updatedKeys[index], approach] as const;
      }),
    );
    const movementByCode = new Map<string, RouteFlow["movement"]>();
    (updated.routes || []).forEach(function (route) {
      const from = updated.approaches.find(function (approach) {
        return approach.id === route.fromApproachId;
      });
      const to = updated.approaches.find(function (approach) {
        return approach.id === route.toApproachId;
      });
      if (from && to)
        movementByCode.set(
          (from.sourceCode || from.id) + "→" + (to.sourceCode || to.id),
          route.movement,
        );
    });
    setRecords(function (all) {
      return all.map(function (record) {
        if (
          record.projectId !== selected.projectId ||
          recordIntersectionKey(record) !== selectedKey
        )
          return record;
        if (record.id === selected.id) return updated;
        const copy = structuredClone(record);
        const copyKeys = codeKey(copy.approaches);
        copy.approaches.forEach(function (approach, approachIndex) {
          const geometry = geometryByCode.get(copyKeys[approachIndex]);
          if (!geometry) return;
          approach.name = geometry.name;
          approach.angle = geometry.angle;
          approach.bearing = bearingFromAngle(geometry.angle);
          approach.cardOffset = geometry.cardOffset
            ? { ...geometry.cardOffset }
            : undefined;
          approach.cardOffsets = geometry.cardOffsets
            ? structuredClone(geometry.cardOffsets)
            : undefined;
          approach.labelOffset = geometry.labelOffset
            ? { ...geometry.labelOffset }
            : undefined;
          approach.cardLayouts = geometry.cardLayouts
            ? structuredClone(geometry.cardLayouts)
            : undefined;
        });
        (copy.routes || []).forEach(function (route) {
          const from = copy.approaches.find(function (approach) {
            return approach.id === route.fromApproachId;
          });
          const to = copy.approaches.find(function (approach) {
            return approach.id === route.toApproachId;
          });
          const movement = movementByCode.get(
            (from?.sourceCode || from?.id || "") +
              "→" +
              (to?.sourceCode || to?.id || ""),
          );
          if (movement) route.movement = movement;
        });
        copy.movementRule = updated.movementRule;
        copy.directionDisplay = structuredClone(updated.directionDisplay || {});
        copy.resultLock = undefined;
        return syncRouteTotals(copy);
      });
    });
  }

  /* eslint-disable react-hooks/preserve-manual-memoization --
   * React Compiler 會提醒「手動 memo 無法保留」，因為 selected 是從 records 推導出來的
   * 物件、它判斷可能被就地修改。本專案的建置流程並沒有啟用 React Compiler
   * （vite.config.ts 沒有掛 babel-plugin-react-compiler），所以這裡的 useMemo 是實際
   * 生效的最佳化；若日後導入 Compiler，可以把這三個 useMemo 直接拿掉改由它自動處理。
   */
  /*
   * 三份轉向圖 SVG 都很大（7 叉路口有 14 張卡、上百條路徑），舊版直接寫在 JSX 裡，
   * 任何一次 render（包含輸入框打字、切換分頁）都會重新組三次字串並讓瀏覽器
   * 重新解析整段 SVG。改成依實際輸入 memo，只有真的改到圖形參數才重算；
   * 沒在該分頁時直接給空字串，完全不做事。
   */
  const diagramHtml = useMemo(
    function () {
      if (view !== "diagram" || !selected) return "";
      return diagramMarkup(
        selected,
        peak,
        diagramStyle,
        displayMode,
        vehicle,
        arrowMode,
        focusIndex,
        flowSummaryMode,
      );
    },
    [
      view,
      selected,
      peak,
      diagramStyle,
      displayMode,
      vehicle,
      arrowMode,
      focusIndex,
      flowSummaryMode,
    ],
  );
  const geometrySchematicHtml = useMemo(
    function () {
      if (view !== "geometry" || !selected) return "";
      return diagramMarkup(
        selected,
        peak,
        "simple",
        "volume",
        "all",
        "focus",
        0,
      );
    },
    [view, selected, peak],
  );
  const geometryCardPreviewHtml = useMemo(
    function () {
      if (view !== "geometry" || !selected || !showGeometryCardPreview)
        return "";
      return diagramMarkup(
        selected,
        peak,
        "formal",
        "both",
        "all",
        "focus",
        focusIndex,
        flowSummaryMode,
      );
    },
    [
      view,
      selected,
      showGeometryCardPreview,
      peak,
      focusIndex,
      flowSummaryMode,
    ],
  );

  /* eslint-enable react-hooks/preserve-manual-memoization */

  /*
   * 拖曳圖卡與路口標籤。
   *
   * 舊版在每一個 pointermove 都呼叫 updateSelectedGeometry：那會 structuredClone
   * 整筆紀錄、把快照塞進 300 筆的版本歷程、再把整包狀態 JSON.stringify 寫進
   * localStorage，接著整個畫面連同兩三份 SVG 重新產生。滑鼠每秒送 60～120 個事件，
   * 這些工作全部堆在主執行緒上，拖沒幾秒分頁就會被瀏覽器判定沒有回應而顯示
   * 「This page couldn't load」；一旦 localStorage 被寫爆（QuotaExceededError），
   * 之後只要再碰圖卡就會再爆一次。
   *
   * 現在改成：拖曳過程完全不碰 React 狀態，只用 requestAnimationFrame 直接改
   * 那一個 <g> 的 transform（最多每幀一次）；放開滑鼠才寫入一次狀態。
   * 拖曳中不存檔、不寫版本歷程，效能與資料量都跟拖多久無關。
   */
  function startCardDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!selected) return;
    const node = (event.target as Element).closest<SVGGElement>(
      "[data-card-id],[data-label-id]",
    );
    if (!node) return;
    const approachId =
      node.getAttribute("data-card-id") || node.getAttribute("data-label-id");
    const section = node.getAttribute("data-card-section") as
      "inbound" | "outbound" | null;
    const isLabel = !node.getAttribute("data-card-id");
    const approach = selected.approaches.find(function (item) {
      return item.id === approachId;
    });
    const svg = event.currentTarget.querySelector("svg");
    if (!approach || !approachId || !svg) return;
    event.preventDefault();

    /*
     * 螢幕像素 → SVG 座標的換算。
     * 舊版用 viewBox 寬 ÷ 元素寬，但 .diagram-canvas 的 SVG 有 max-height，
     * 一旦高度被夾住，preserveAspectRatio 會在左右留白：元素比實際畫面寬，
     * 橫向比例就會偏小，卡片跟不上游標（寬螢幕上誤差可達 15%）。
     * getScreenCTM() 取的是真正套用到內容上的縮放，兩軸都準。
     */
    const ctm = svg.getScreenCTM();
    const box = svg.getBoundingClientRect();
    const scaleX =
      ctm && ctm.a
        ? 1 / ctm.a
        : Number(svg.viewBox.baseVal.width || 1200) / Math.max(1, box.width);
    const scaleY =
      ctm && ctm.d
        ? 1 / ctm.d
        : Number(svg.viewBox.baseVal.height || 900) / Math.max(1, box.height);
    const startX = event.clientX;
    const startY = event.clientY;
    const number = function (name: string, fallback: number) {
      // 注意 Number(null) === 0：屬性不存在時一定要走 fallback，
      // 否則基準點與邊界會被當成 0，一拖就跳到畫面左上角。
      const raw = node.getAttribute(name);
      if (raw === null || raw === "") return fallback;
      const value = Number(raw);
      return Number.isFinite(value) ? value : fallback;
    };
    const currentTransform = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(
      node.getAttribute("transform") || "",
    );
    const renderedX = Number(currentTransform?.[1] ?? 0);
    const renderedY = Number(currentTransform?.[2] ?? 0);
    // 自動排版的基準點與可放置範圍（圖卡才有；路口標籤不設限）
    const baseX = number("data-base-x", renderedX);
    const baseY = number("data-base-y", renderedY);
    const limit = {
      minX: number("data-min-x", -Infinity),
      maxX: number("data-max-x", Infinity),
      minY: number("data-min-y", -Infinity),
      maxY: number("data-max-y", Infinity),
    };
    const clampX = function (value: number) {
      return Math.max(limit.minX, Math.min(limit.maxX, value));
    };
    const clampY = function (value: number) {
      return Math.max(limit.minY, Math.min(limit.maxY, value));
    };
    const layoutMode: FlowLayoutMode = flowSummaryMode;
    const original = isLabel
      ? approachLabelOffset(approach, layoutMode)
      : approachCardOffset(approach, layoutMode, section || "inbound");
    const startOffsetX = Number(original.x || 0);
    const startOffsetY = Number(original.y || 0);
    // 位移一律以「自動基準點」為原點，並先夾在畫布內，
    // 存下來的值就等於畫出來的值，往回拖不會出現拖了沒反應的死區。
    const offsetAt = function (dx: number, dy: number) {
      return {
        x: Math.round(clampX(baseX + startOffsetX + dx) - baseX),
        y: Math.round(clampY(baseY + startOffsetY + dy) - baseY),
      };
    };

    let frame = 0;
    let latest = { dx: 0, dy: 0 };
    const paint = function () {
      frame = 0;
      if (!node.isConnected) return;
      const offset = offsetAt(latest.dx, latest.dy);
      node.setAttribute(
        "transform",
        "translate(" +
          (baseX + offset.x).toFixed(1) +
          " " +
          (baseY + offset.y).toFixed(1) +
          ")",
      );
    };
    const move = function (pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== event.pointerId) return;
      latest = {
        dx: (pointerEvent.clientX - startX) * scaleX,
        dy: (pointerEvent.clientY - startY) * scaleY,
      };
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const finish = function (pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== event.pointerId) return;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      if (frame) cancelAnimationFrame(frame);
      const next = offsetAt(
        (pointerEvent.clientX - startX) * scaleX,
        (pointerEvent.clientY - startY) * scaleY,
      );
      if (
        next.x === Math.round(startOffsetX) &&
        next.y === Math.round(startOffsetY)
      )
        return;
      // 拖曳途中若畫面重繪（例如切換顯示模式），被拖的節點會被換掉、
      // 使用者其實什麼都沒看到移動，這時就不要把位置寫進去。
      if (!node.isConnected) return;
      updateSelectedGeometry(function (record) {
        const item = record.approaches.find(function (candidate) {
          return candidate.id === approachId;
        });
        if (!item) return record;
        // 位置存在「目前這個顯示模式」底下：只看駛入、只看駛出、駛入＋駛出
        // 三種畫面各有自己的一組，互不干擾。
        const layouts = { ...(item.cardLayouts || {}) };
        const layout = { ...(layouts[layoutMode] || {}) };
        if (isLabel) layout.label = next;
        else {
          const cards = { ...(layout.cards || {}) };
          if (section) cards[section] = next;
          else {
            cards.inbound = next;
            cards.outbound = next;
          }
          layout.cards = cards;
        }
        layouts[layoutMode] = layout;
        item.cardLayouts = layouts;
        return record;
      });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    // 抓住這個指標，滑鼠移出視窗或多點觸控時才不會把事件送到別的元素
    if (node.setPointerCapture)
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        /* 舊瀏覽器不支援時忽略即可 */
      }
  }

  function deleteQuarter(q: string) {
    const targets = records.filter(function (record) {
      return record.projectId === activeProjectId && record.quarter === q;
    });
    if (!authorizeLockedChange(targets, "刪除季度")) return;
    if (!confirm("確定刪除「" + q + "」全部路口資料？建議先下載備份。")) return;
    setRecords(function (all) {
      return all.filter(function (record) {
        return !(record.projectId === activeProjectId && record.quarter === q);
      });
    });
    notify("已刪除季度 " + q + "。");
  }

  async function exportSvg() {
    // 靜靜結束會讓按鈕看起來壞掉。旁邊的 xlsx／PDF／PNG 都有提示，這裡漏了。
    if (!selected) return notify("目前沒有選定的路口，無法輸出 SVG。");
    downloadBlob(
      new Blob(
        [
          diagramMarkup(
            selected,
            peak,
            diagramStyle,
            displayMode,
            vehicle,
            arrowMode,
            focusIndex,
            flowSummaryMode,
          ),
        ],
        { type: "image/svg+xml;charset=utf-8" },
      ),
      selected.quarter + "_" + selected.station + "_" + peak + "_轉向圖.svg",
    );
  }
  async function exportPng() {
    if (!selected) return;
    downloadBlob(
      await svgToPng(
        diagramMarkup(
          selected,
          peak,
          diagramStyle,
          displayMode,
          vehicle,
          arrowMode,
          focusIndex,
          flowSummaryMode,
        ),
      ),
      selected.quarter + "_" + selected.station + "_" + peak + "_轉向圖.png",
    );
  }
  async function exportPdf(rows = selected ? [selected] : []) {
    if (!rows.length) return notify("沒有可輸出的路口資料。");
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
    });
    for (let index = 0; index < rows.length; index++) {
      if (index) pdf.addPage("a4", "landscape");
      const blob = await svgToPng(
        diagramMarkup(
          rows[index],
          peak,
          "formal",
          "both",
          vehicle,
          "all",
          0,
          flowSummaryMode,
        ),
        2,
      );
      const dataUrl = await new Promise<string>(function (resolve) {
        const reader = new FileReader();
        reader.onload = function () {
          resolve(String(reader.result));
        };
        reader.readAsDataURL(blob);
      });
      pdf.addImage(dataUrl, "PNG", 10, 8, 277, 205);
    }
    pdf.save(
      (activeProject?.code || "Project") +
        "_" +
        (quarter || "all") +
        "_" +
        peak +
        "_轉向交通量報表.pdf",
    );
  }

  async function createAnalysisWorkbook(
    exportRecords: TrafficRecord[],
    format: "xlsx" | "xls" = "xlsx",
    items: ReportItemKey[] = activeReportItems,
  ) {
    if (!exportRecords.length) throw new Error("選定期間沒有可輸出的資料。");
    const wanted = new Set(items);
    if (!wanted.size) throw new Error("請至少勾選一個要匯出的分析項目。");
    // 挑選規則與報告文字草稿共用同一個函式，兩邊的數字才不會分岔。
    const trendRows = trendSeriesRecords(exportRecords, selected).map(
      function (record) {
        return {
          季度: record.quarter,
          資料別: record.surveyType || "待設定",
          "AM Peak（PCU/hr）": recordTotal(record, "AM"),
          "PM Peak（PCU/hr）": recordTotal(record, "PM"),
          站號: record.station,
          路口名稱: record.name,
          "AM 尖峰時段": record.peaks.AM.start + "–" + record.peaks.AM.end,
          "PM 尖峰時段": record.peaks.PM.start + "–" + record.peaks.PM.end,
        };
      });
    const vehicleComposition = exportRecords.flatMap(function (record) {
      return (["SURVEY", "AM", "PM"] as CompositionScope[]).flatMap(
        function (scope) {
          const analysisVehicles = recordVehicleIds(record);
          const counts = Object.fromEntries(
            analysisVehicles.map(function (vehicleKey) {
              return [
                vehicleKey,
                recordVehicleTotal(record, scope, vehicleKey),
              ];
            }),
          ) as Record<string, number>;
          const total = analysisVehicles.reduce(function (sum, vehicleKey) {
            return sum + counts[vehicleKey];
          }, 0);
          return analysisVehicles.map(function (vehicleKey) {
            const recordProject = projects.find(function (project) {
              return project.id === record.projectId;
            });
            return {
              計畫: recordProject?.name || activeProject?.name || "",
              季度: record.quarter,
              站號: record.station,
              路口名稱: record.name,
              分析範圍: scope === "SURVEY" ? "全調查時段" : scope + " Peak",
              時段:
                scope === "SURVEY"
                  ? `${record.survey?.intervals || 0} 個 ${Math.round(
                      (record.survey?.minutes || 0) /
                        Math.max(1, record.survey?.intervals || 1),
                    )} 分鐘區間（${((record.survey?.minutes || 0) / 60).toFixed(
                      1,
                    )} 小時）`
                  : record.peaks[scope].start + "-" + record.peaks[scope].end,
              車種: vehicleLabel(record, vehicleKey),
              單位: scope === "SURVEY" ? "輛/調查時段" : "輛/hr",
              數量: counts[vehicleKey],
              組成比例: total ? counts[vehicleKey] / total : 0,
            };
          });
        },
      );
    });
    const inboundRows = exportRecords.flatMap(function (record) {
      return inboundAnalysisRows(record).map(function (row) {
        const recordProject = projects.find(function (project) {
          return project.id === record.projectId;
        });
        return {
          計畫: recordProject?.name || activeProject?.name || "",
          季度: record.quarter,
          站號: record.station,
          路口名稱: record.name,
          目的支線代碼: row.approach.sourceCode || row.approach.id,
          目的支線名稱: row.approach.name,
          "全日駛入量（PCU/調查日）":
            row.inboundFullDayPcu == null ? "－" : row.inboundFullDayPcu,
          "全日駛出量（PCU/調查日）":
            row.outboundFullDayPcu == null ? "－" : row.outboundFullDayPcu,
          "AM Peak 時段": record.peaks.AM.start + "–" + record.peaks.AM.end,
          "AM Peak 駛入量（PCU/hr）": row.inboundAmPcu,
          "AM Peak 駛出量（PCU/hr）": row.outboundAmPcu,
          "PM Peak 時段": record.peaks.PM.start + "–" + record.peaks.PM.end,
          "PM Peak 駛入量（PCU/hr）": row.inboundPmPcu,
          "PM Peak 駛出量（PCU/hr）": row.outboundPmPcu,
          "全日駛入實際車輛數（輛/調查日）":
            row.inboundFullDayVehicles == null
              ? "－"
              : row.inboundFullDayVehicles,
          "全日駛出實際車輛數（輛/調查日）":
            row.outboundFullDayVehicles == null
              ? "－"
              : row.outboundFullDayVehicles,
          "AM Peak 駛入實際車輛數（輛/hr）":
            row.inboundAmVehicles == null ? "－" : row.inboundAmVehicles,
          "AM Peak 駛出實際車輛數（輛/hr）":
            row.outboundAmVehicles == null ? "－" : row.outboundAmVehicles,
          "PM Peak 駛入實際車輛數（輛/hr）":
            row.inboundPmVehicles == null ? "－" : row.inboundPmVehicles,
          "PM Peak 駛出實際車輛數（輛/hr）":
            row.outboundPmVehicles == null ? "－" : row.outboundPmVehicles,
        };
      });
    });
    const exportRecordIds = new Set(
      exportRecords.map(function (record) {
        return record.id;
      }),
    );
    const comparisonRows = records
      .filter(function (record) {
        return exportRecordIds.has(record.id);
      })
      .sort(function (a, b) {
        return recordTotal(b, "AM") - recordTotal(a, "AM");
      })
      .flatMap(function (record) {
        const project = projects.find(function (item) {
          return item.id === record.projectId;
        });
        const amFlows = branchPeakFlows(record, "AM");
        const pmFlows = branchPeakFlows(record, "PM");
        return record.approaches.map(function (approach, index) {
          return {
            計畫代碼: project?.code || "",
            計畫名稱: project?.name || "",
            季度: record.quarter,
            站號: record.station,
            路口名稱: record.name,
            支線代碼: approach.sourceCode || String.fromCharCode(65 + index),
            支線名稱: approach.name,
            "AM 尖峰時段": record.peaks.AM.start + "–" + record.peaks.AM.end,
            "AM 路口轉向總量（PCU/hr）": recordTotal(record, "AM"),
            "AM 駛出路口（該支線→路口中心，PCU/hr）":
              amFlows[index].enteringIntersection,
            "AM 駛入路口（路口中心→該支線，PCU/hr）":
              amFlows[index].leavingIntersection,
            "PM 尖峰時段": record.peaks.PM.start + "–" + record.peaks.PM.end,
            "PM 路口轉向總量（PCU/hr）": recordTotal(record, "PM"),
            "PM 駛出路口（該支線→路口中心，PCU/hr）":
              pmFlows[index].enteringIntersection,
            "PM 駛入路口（路口中心→該支線，PCU/hr）":
              pmFlows[index].leavingIntersection,
          };
        });
      });
    const workbook = XLSX.utils.book_new();
    const trendSheet = XLSX.utils.json_to_sheet(trendRows);
    trendSheet["!cols"] = [12, 12, 20, 20, 12, 30, 18, 18].map(function (wch) {
      return { wch };
    });
    trendSheet["!autofilter"] = { ref: trendSheet["!ref"] || "A1:A1" };
    // 加了「資料別」欄之後，AM／PM 兩欄從 B、C 往後移到 C、D，
    // 數字格式與圖表系列都必須跟著改，否則圖表會指到文字欄。
    for (let row = 2; row <= trendRows.length + 1; row++)
      ["C", "D"].forEach(function (column) {
        if (trendSheet[column + row]) trendSheet[column + row].z = "#,##0.0";
      });
    if (wanted.has("trend"))
      XLSX.utils.book_append_sheet(workbook, trendSheet, "歷季趨勢比較");
    const compositionSheet = XLSX.utils.json_to_sheet(vehicleComposition);
    compositionSheet["!cols"] = [20, 10, 10, 30, 15, 26, 18, 16, 16, 14].map(
      function (wch) {
        return { wch };
      },
    );
    compositionSheet["!autofilter"] = {
      ref: compositionSheet["!ref"] || "A1:A1",
    };
    if (wanted.has("composition"))
      XLSX.utils.book_append_sheet(workbook, compositionSheet, "車種組成分析");
    for (let row = 2; row <= vehicleComposition.length + 1; row++) {
      if (compositionSheet["J" + row]) compositionSheet["J" + row].z = "0.0%";
    }
    const inboundSheet = XLSX.utils.json_to_sheet(inboundRows);
    inboundSheet["!cols"] = [
      22, 10, 12, 28, 14, 24, 28, 18, 24, 18, 24, 30, 28, 28,
    ].map(function (wch) {
      return { wch };
    });
    inboundSheet["!autofilter"] = {
      ref: inboundSheet["!ref"] || "A1:A1",
    };
    if (wanted.has("inboundOutbound"))
      XLSX.utils.book_append_sheet(
        workbook,
        inboundSheet,
        "駛入駛出各路口流量",
      );
    // 只要「駛入」或只要「駛出」的計畫，各自出一張精簡的尖峰流量表
    (["inbound", "outbound"] as const).forEach(function (direction) {
      const key = direction === "inbound" ? "inboundPeak" : "outboundPeak";
      if (!wanted.has(key)) return;
      const label = direction === "inbound" ? "駛入" : "駛出";
      const rows = exportRecords.flatMap(function (record) {
        return inboundAnalysisRows(record).map(function (row) {
          const pcuAm =
            direction === "inbound" ? row.inboundAmPcu : row.outboundAmPcu;
          const pcuPm =
            direction === "inbound" ? row.inboundPmPcu : row.outboundPmPcu;
          const vehAm =
            direction === "inbound"
              ? row.inboundAmVehicles
              : row.outboundAmVehicles;
          const vehPm =
            direction === "inbound"
              ? row.inboundPmVehicles
              : row.outboundPmVehicles;
          const full =
            direction === "inbound"
              ? row.inboundFullDayPcu
              : row.outboundFullDayPcu;
          return {
            計畫:
              projects.find(function (project) {
                return project.id === record.projectId;
              })?.name ||
              activeProject?.name ||
              "",
            季度: record.quarter,
            站號: record.station,
            路口名稱: record.name,
            支線代碼: row.approach.sourceCode || row.approach.id,
            支線名稱: row.approach.name,
            "AM 尖峰時段": record.peaks.AM.start + "–" + record.peaks.AM.end,
            ["AM Peak " + label + "量（PCU/hr）"]: pcuAm,
            ["AM Peak " + label + "實際車輛數（輛/hr）"]:
              vehAm == null ? "－" : vehAm,
            "PM 尖峰時段": record.peaks.PM.start + "–" + record.peaks.PM.end,
            ["PM Peak " + label + "量（PCU/hr）"]: pcuPm,
            ["PM Peak " + label + "實際車輛數（輛/hr）"]:
              vehPm == null ? "－" : vehPm,
            ["全日" + label + "量（PCU/調查日）"]: full == null ? "－" : full,
          };
        });
      });
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [22, 10, 12, 28, 12, 22, 18, 24, 28, 18, 24, 28, 26].map(
        function (wch) {
          return { wch };
        },
      );
      sheet["!autofilter"] = { ref: sheet["!ref"] || "A1:A1" };
      XLSX.utils.book_append_sheet(
        workbook,
        sheet,
        "各路口" + label + "尖峰流量",
      );
    });
    const comparisonSheet = XLSX.utils.json_to_sheet(comparisonRows);
    comparisonSheet["!cols"] = [
      14, 26, 10, 12, 30, 12, 24, 18, 22, 28, 30, 18, 22, 28, 30,
    ].map(function (wch) {
      return { wch };
    });
    comparisonSheet["!autofilter"] = {
      ref: comparisonSheet["!ref"] || "A1:A1",
    };
    for (let row = 2; row <= comparisonRows.length + 1; row++)
      ["I", "J", "K", "M", "N", "O"].forEach(function (column) {
        if (comparisonSheet[column + row])
          comparisonSheet[column + row].z = "#,##0.0";
      });
    if (wanted.has("compare"))
      XLSX.utils.book_append_sheet(
        workbook,
        comparisonSheet,
        "跨計畫多路口比較",
      );
    if (wanted.has("odMatrix")) {
      const rows = exportRecords.flatMap(function (record) {
        return (["AM", "PM"] as PeakKey[]).flatMap(function (peakKey) {
          return odMatrix(record, peakKey).flatMap(function (row) {
            return row.values
              .map(function (value, destinationIndex) {
                const destination = record.approaches[destinationIndex];
                if (!destination || destination.id === row.originId)
                  return null;
                return {
                  季度: record.quarter,
                  站號: record.station,
                  路口名稱: record.name,
                  時段: peakKey + " Peak",
                  起點支線: row.origin,
                  目的支線: destination.name,
                  "流量（PCU/hr）": value,
                };
              })
              .filter(Boolean) as Array<Record<string, string | number>>;
          });
        });
      });
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [10, 12, 28, 14, 20, 20, 20].map(function (wch) {
        return { wch };
      });
      sheet["!autofilter"] = { ref: sheet["!ref"] || "A1:A1" };
      XLSX.utils.book_append_sheet(workbook, sheet, "OD轉向矩陣");
    }
    if (wanted.has("branchBalance")) {
      const rows = exportRecords.flatMap(function (record) {
        return (["AM", "PM"] as PeakKey[]).flatMap(function (peakKey) {
          return branchBalance(record, peakKey).map(function (row) {
            return {
              季度: record.quarter,
              站號: record.station,
              路口名稱: record.name,
              時段: peakKey + " Peak",
              支線: row.name,
              "駛出（PCU/hr）": row.outbound,
              "駛入（PCU/hr）": row.inbound,
              "差值（PCU/hr）": row.difference,
            };
          });
        });
      });
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [10, 12, 28, 14, 20, 20, 20, 20].map(function (wch) {
        return { wch };
      });
      sheet["!autofilter"] = { ref: sheet["!ref"] || "A1:A1" };
      XLSX.utils.book_append_sheet(workbook, sheet, "支線流量平衡");
    }
    if (wanted.has("quality")) {
      const rows = qualityIssues(exportRecords).map(function (issue) {
        return {
          季度: issue.quarter,
          站號: issue.station,
          類別: issue.category,
          嚴重度:
            issue.severity === "error"
              ? "錯誤"
              : issue.severity === "warning"
                ? "警示"
                : "提示",
          說明: issue.message,
        };
      });
      const sheet = XLSX.utils.json_to_sheet(
        rows.length
          ? rows
          : [
              {
                季度: "－",
                站號: "－",
                類別: "－",
                嚴重度: "－",
                說明: "本次匯出範圍未發現品質問題。",
              },
            ],
      );
      sheet["!cols"] = [10, 12, 16, 10, 70].map(function (wch) {
        return { wch };
      });
      XLSX.utils.book_append_sheet(workbook, sheet, "資料品質檢核");
    }
    if (wanted.has("pce")) {
      // 這張表要寫的是「這些資料實際換算時用的當量」，不是畫面上目前的設定。
      // 每筆記錄在匯入當下就把當時的矩陣存進 pceUsed，之後使用者若在設定頁
      // 改過係數，畫面上的 pce 和資料實際用的就不一樣了。舊版直接輸出畫面
      // 上的 pce，等於在報表裡宣稱一組沒有被用來算過任何一個數字的係數。
      const usedMatrices: { label: string; matrix: PceMatrix }[] = [];
      exportRecords.forEach(function (record) {
        const matrix = record.pceUsed || DEFAULT_PCE;
        const signature = JSON.stringify(matrix);
        const found = usedMatrices.find(function (item) {
          return JSON.stringify(item.matrix) === signature;
        });
        const label = record.station + " " + record.quarter;
        if (found) found.label += "、" + label;
        else usedMatrices.push({ label, matrix });
      });
      if (!usedMatrices.length)
        usedMatrices.push({ label: "目前設定", matrix: pce });
      const pceRow = function (
        scopeLabel: string,
        vehicleId: string,
        factors: { left: number; through: number; right: number },
        sourceNote: string,
      ) {
        return {
          適用資料: scopeLabel,
          車種代碼: vehicleId,
          車種名稱:
            vehicleCatalog[vehicleId] ||
            VEHICLE_LABELS[vehicleId as keyof typeof VEHICLE_LABELS] ||
            vehicleId,
          類別: CORE_VEHICLE_LABELS[vehicleId] ? "標準車種" : "新增車種",
          左轉當量: factors.left,
          直行當量: factors.through,
          右轉當量: factors.right,
          來源:
            sourceNote ||
            (CORE_VEHICLE_LABELS[vehicleId]
              ? "交通流量教育訓練簡報第 15 頁「當量參考值」"
              : "簡報未提供參考值，系統預設 1.0，由使用者確認"),
        };
      };
      const rows = usedMatrices.flatMap(function (entry) {
        return Object.keys(entry.matrix)
          .sort()
          .map(function (vehicleId) {
            return pceRow(
              usedMatrices.length > 1 ? entry.label : "本次匯出全部資料",
              vehicleId,
              entry.matrix[vehicleId],
              "",
            );
          });
      });
      // 使用者可能在匯入之後才新增車種或改係數。那些設定沒有被用來換算本次
      // 匯出的任何一筆資料，但仍要列出來，否則參數表看起來像「這個車種不見了」。
      const appliedIds = new Set(
        usedMatrices.flatMap(function (entry) {
          return Object.keys(entry.matrix);
        }),
      );
      Object.keys(pce)
        .sort()
        .forEach(function (vehicleId) {
          if (appliedIds.has(vehicleId)) return;
          rows.push(
            pceRow(
              "目前設定（未套用於本次匯出資料）",
              vehicleId,
              pce[vehicleId],
              CORE_VEHICLE_LABELS[vehicleId]
                ? "交通流量教育訓練簡報第 15 頁「當量參考值」；本次匯出的資料匯入時尚未使用此車種"
                : "簡報未提供參考值，系統預設 1.0，由使用者確認；本次匯出的資料匯入時尚未使用此車種",
            ),
          );
        });
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [28, 18, 18, 12, 12, 12, 12, 52].map(function (wch) {
        return { wch };
      });
      XLSX.utils.book_append_sheet(workbook, sheet, "車種轉向當量");
    }
    if (!workbook.SheetNames.length)
      throw new Error("勾選的分析項目在目前範圍內沒有資料可輸出。");
    const exportQuarters = Array.from(
      new Set(
        exportRecords.map(function (record) {
          return record.quarter;
        }),
      ),
    ).sort(compareQuarters);
    const includedProjectCodes = Array.from(
      new Set(
        exportRecords.map(function (record) {
          return (
            projects.find(function (project) {
              return project.id === record.projectId;
            })?.code || "Project"
          );
        }),
      ),
    );
    const baseName =
      (includedProjectCodes.length === 1 ? includedProjectCodes[0] : "多計畫") +
      "_" +
      (exportQuarters.length === 1
        ? exportQuarters[0]
        : exportQuarters[0] + "_至_" + exportQuarters.at(-1)) +
      "_分析圖表報表";
    if (format === "xls") {
      return {
        blob: new Blob(
          [XLSX.write(workbook, { bookType: "biff8", type: "array" })],
          {
            type: "application/vnd.ms-excel",
          },
        ),
        filename: baseName + ".xls",
      };
    } else {
      // 沒有勾「歷季趨勢比較」時就沒有圖表要掛的資料表，直接輸出一般 xlsx，
      // 否則注入的圖表會指向不存在的工作表，Excel 開檔會跳修復。
      const bytes = workbook.SheetNames.includes("歷季趨勢比較")
        ? await editableTrendWorkbookBlob(
            workbook,
            "歷季趨勢比較",
            trendRows.length + 1,
            [
              { name: "AM Peak", column: "C", color: "087F75" },
              { name: "PM Peak", column: "D", color: "D97706" },
            ],
          )
        : new Blob(
            [XLSX.write(workbook, { bookType: "xlsx", type: "array" })],
            {
              type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
          );
      return {
        blob: bytes,
        filename: baseName + ".xlsx",
      };
    }
  }

  async function exportExcel(format: "xlsx" | "xls" = "xlsx") {
    // 與報告文字草稿共用同一個範圍計算，兩邊涵蓋的紀錄必定一致。
    const exportRecords = reportExportScope.records;
    if (!exportRecords.length) return notify("選定期間沒有可輸出的資料。");
    if (!activeReportItems.length)
      return notify("請至少勾選一個要匯出的分析項目。");
    try {
      const result = await createAnalysisWorkbook(exportRecords, format);
      downloadBlob(result.blob, result.filename);
      notify(
        format === "xls"
          ? "指定期間的舊版 Excel 已下載（" +
              activeReportItems.length +
              " 個項目）。"
          : "指定期間 Excel 已下載（" +
              activeReportItems.length +
              " 個項目）。",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Excel 匯出失敗。");
    }
  }

  function exportCompositionExcel() {
    if (!current.length) return notify("本季度沒有可輸出的車種組成資料。");
    const unit = compositionScope === "SURVEY" ? "輛/調查時段" : "輛/hr";
    const scopeLabel =
      compositionScope === "SURVEY" ? "全調查時段" : compositionScope + " Peak";
    const summaryRows = current.map(function (record) {
      const analysisVehicles = recordVehicleIds(record);
      const counts = Object.fromEntries(
        analysisVehicles.map(function (vehicleKey) {
          return [
            vehicleKey,
            recordVehicleTotal(record, compositionScope, vehicleKey),
          ];
        }),
      ) as Record<string, number>;
      const total = analysisVehicles.reduce(function (sum, vehicleKey) {
        return sum + counts[vehicleKey];
      }, 0);
      const row: Record<string, string | number> = {
        計畫代碼: activeProject?.code || "",
        計畫名稱: activeProject?.name || "",
        季度: record.quarter,
        站號: record.station,
        路口名稱: record.name,
        分析範圍: scopeLabel,
        時段:
          compositionScope === "SURVEY"
            ? `${record.survey?.minutes || 0} 分鐘`
            : record.peaks[compositionScope].start +
              "–" +
              record.peaks[compositionScope].end,
        單位: unit,
        實際車輛合計: total,
      };
      analysisVehicles.forEach(function (vehicleKey) {
        const label = vehicleLabel(record, vehicleKey);
        row[label] = counts[vehicleKey];
        row[label + "比例（%）"] = total ? counts[vehicleKey] / total : 0;
      });
      return row;
    });
    const detailRows = current.flatMap(function (record) {
      const analysisVehicles = recordVehicleIds(record);
      const counts = analysisVehicles.map(function (vehicleKey) {
        return recordVehicleTotal(record, compositionScope, vehicleKey);
      });
      const total = counts.reduce(function (sum, count) {
        return sum + count;
      }, 0);
      return analysisVehicles.map(function (vehicleKey, index) {
        return {
          季度: record.quarter,
          站號: record.station,
          路口名稱: record.name,
          分析範圍: scopeLabel,
          車種: vehicleLabel(record, vehicleKey),
          單位: unit,
          數量: counts[index],
          組成比例: total ? counts[index] / total : 0,
        };
      });
    });
    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    summarySheet["!cols"] = [
      14, 24, 10, 12, 30, 15, 20, 16, 14, 16, 14, 16, 18, 20, 18, 20, 18,
    ].map(function (wch) {
      return { wch };
    });
    summarySheet["!autofilter"] = { ref: summarySheet["!ref"] || "A1:A1" };
    const summaryRange = XLSX.utils.decode_range(
      summarySheet["!ref"] || "A1:A1",
    );
    for (let column = summaryRange.s.c; column <= summaryRange.e.c; column++) {
      const address = XLSX.utils.encode_cell({ r: 0, c: column });
      if (!String(summarySheet[address]?.v || "").includes("比例")) continue;
      for (let row = 1; row <= summaryRange.e.r; row++) {
        const cell = XLSX.utils.encode_cell({ r: row, c: column });
        if (summarySheet[cell]) summarySheet[cell].z = "0.0%";
      }
    }
    XLSX.utils.book_append_sheet(workbook, summarySheet, "車種組成彙整");
    const detailSheet = XLSX.utils.json_to_sheet(detailRows);
    detailSheet["!cols"] = [10, 12, 30, 15, 18, 16, 14, 14].map(function (wch) {
      return { wch };
    });
    detailSheet["!autofilter"] = { ref: detailSheet["!ref"] || "A1:A1" };
    for (let row = 2; row <= detailRows.length + 1; row++)
      if (detailSheet["H" + row]) detailSheet["H" + row].z = "0.0%";
    XLSX.utils.book_append_sheet(workbook, detailSheet, "車種組成明細");
    XLSX.writeFile(
      workbook,
      `${activeProject?.code || "Project"}_${quarter}_${scopeLabel}_車種組成.xlsx`,
      { bookType: "xlsx" },
    );
    notify("車種組成 Excel 已下載。");
  }

  function exportAdvancedExcel(record: TrafficRecord) {
    const matrix = odMatrix(record, peak);
    const matrixRows = matrix.map(function (row) {
      const output: Record<string, string | number> = {
        來源支線: row.origin,
        單位: "PCU/hr",
      };
      record.approaches.forEach(function (approach, index) {
        output["駛入 " + approach.name] = row.values[index];
      });
      return output;
    });
    const balanceRows = branchBalance(record, peak).map(function (item) {
      return {
        支線: item.name,
        駛入流量: item.inbound,
        駛出流量: item.outbound,
        差值: item.difference,
        單位: "PCU/hr",
      };
    });
    const sensitivityRows = peakSensitivity(record).map(function (item) {
      return {
        排名: item.rank,
        起始時間: formatMinutes(item.start),
        結束時間: formatMinutes(item.end),
        交通量: item.pcu,
        單位: "PCU/hr",
        實際車輛數: item.vehicles,
        車輛單位: "輛/hr",
      };
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(matrixRows),
      "OD轉向矩陣",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(balanceRows),
      "支線流量平衡",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(sensitivityRows),
      "尖峰敏感度",
    );
    XLSX.writeFile(
      workbook,
      record.station + "_" + record.quarter + "_轉向進階核對.xlsx",
      { bookType: "xlsx" },
    );
    notify("轉向進階核對 Excel 已下載。");
  }

  function exportQualityExcel() {
    const rows = quarterQualitySummary(current).map(function (item) {
      return {
        季度: item.record.quarter,
        站號: item.record.station,
        路口名稱: item.record.name,
        審核狀態: item.record.review?.status || "待核對",
        AM系統總量: item.am.movement,
        AM_OD總量: item.am.routes,
        AM差值: item.am.difference,
        PM系統總量: item.pm.movement,
        PM_OD總量: item.pm.routes,
        PM差值: item.pm.difference,
        未對應流向數: item.unmapped,
        調查日期: item.record.date || "－",
        檢核結果: item.valid ? "通過" : "需核對",
        流量單位: "PCU/hr",
      };
    });
    const issueRows = currentIssues.map(function (issue) {
      return {
        季度: issue.quarter,
        站號: issue.station,
        類別: issue.category,
        嚴重度: issue.severity,
        說明: issue.message,
      };
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(rows),
      "季度品質總表",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(issueRows),
      "問題明細",
    );
    XLSX.writeFile(
      workbook,
      (activeProject?.code || "Project") + "_" + quarter + "_資料品質報告.xlsx",
      { bookType: "xlsx" },
    );
    notify("季度資料品質 Excel 已下載。");
  }

  async function exportPngZip() {
    if (!current.length) return notify("本季度沒有可輸出的路口資料。");
    const zip = new JSZip();
    for (const record of current)
      zip.file(
        record.station + "_" + peak + ".png",
        await svgToPng(
          diagramMarkup(
            record,
            peak,
            "formal",
            "both",
            vehicle,
            "all",
            0,
            flowSummaryMode,
          ),
          2,
        ),
      );
    downloadBlob(
      await zip.generateAsync({ type: "blob" }),
      (activeProject?.code || "Project") +
        "_" +
        quarter +
        "_" +
        peak +
        "_全部路口PNG.zip",
    );
  }

  /*
   * 批次成果包裡的 PDF／PNG 也要跟著畫面上的車種篩選走。
   * 舊寫法這裡傳的是字面 "all"，而單張匯出（exportPdf／exportPngZip）傳的是
   * vehicle：同一個路口、兩顆按鈕，產出的圖內容不同（一張是機車、單位輛/hr，
   * 一張是全車種、單位 PCU/hr），而且沒有任何地方會提醒使用者。
   */
  async function pdfBlob(rows: TrafficRecord[]) {
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
    });
    for (let index = 0; index < rows.length; index++) {
      if (index) pdf.addPage("a4", "landscape");
      const blob = await svgToPng(
        diagramMarkup(
          rows[index],
          peak,
          "formal",
          "both",
          vehicle,
          "all",
          0,
          flowSummaryMode,
        ),
        2,
      );
      const dataUrl = await new Promise<string>(function (resolve) {
        const reader = new FileReader();
        reader.onload = function () {
          resolve(String(reader.result));
        };
        reader.readAsDataURL(blob);
      });
      pdf.addImage(dataUrl, "PNG", 10, 8, 277, 205);
    }
    return pdf.output("blob");
  }

  async function exportBatchPackage() {
    const selectedQuarters = batchQuarterKeys;
    const rows = records.filter(function (record) {
      return (
        batchProjectIds.includes(record.projectId || "") &&
        selectedQuarters.includes(record.quarter)
      );
    });
    if (!rows.length) return notify("選定的計畫與季度沒有成果資料。");
    try {
      const zip = new JSZip();
      for (const projectId of batchProjectIds) {
        const project = projects.find(function (item) {
          return item.id === projectId;
        });
        const projectRows = rows.filter(function (record) {
          return record.projectId === projectId;
        });
        if (!projectRows.length) continue;
        // 每個計畫都用「自己」勾選的匯出項目，不能全部沿用目前開著的計畫。
        const workbookResult = await createAnalysisWorkbook(
          projectRows,
          "xlsx",
          normalizeReportItems(project?.reportItems),
        );
        const folder = project?.code || projectId;
        zip.file(
          folder + "/Excel/" + workbookResult.filename,
          workbookResult.blob,
        );
        zip.file(
          folder + "/PDF/轉向圖_" + peak + ".pdf",
          await pdfBlob(projectRows),
        );
        for (const record of projectRows) {
          zip.file(
            folder +
              "/PNG/" +
              record.quarter +
              "_" +
              record.station +
              "_" +
              peak +
              ".png",
            /* 和單張 PNG 匯出一致：跟著畫面上的車種篩選。 */
            await svgToPng(
              diagramMarkup(
                record,
                peak,
                "formal",
                "both",
                vehicle,
                "all",
                0,
                flowSummaryMode,
              ),
              2,
            ),
          );
        }
      }
      /*
       * README 要說實話。轉向圖的單位是依「車種篩選」決定的
       * （全車種＝PCU/hr，指定單一車種＝該車種的 輛/hr），
       * 而 PDF／PNG 現在跟著畫面上的篩選走，所以不能寫死 PCU/hr。
       */
      const diagramVehicleLabel =
        vehicle === "all"
          ? "全部車種"
          : vehicleCatalog[vehicle] ||
            VEHICLE_LABELS[vehicle] ||
            CORE_VEHICLE_LABELS[vehicle] ||
            vehicle;
      const diagramUnit = vehicle === "all" ? "PCU/hr" : "輛/hr";
      zip.file(
        "README.txt",
        "Turning Traffic 批次成果包\r\n範圍：" +
          selectedQuarters.join("、") +
          "\r\n時段：" +
          peak +
          " 尖峰" +
          "\r\n內容：各計畫分析 Excel、多頁 PDF、各路口 PNG。" +
          "\r\n轉向圖車種：" +
          diagramVehicleLabel +
          "（單位 " +
          diagramUnit +
          "）" +
          "\r\nExcel 內各欄位的單位以該欄標題為準。\r\n",
      );
      downloadBlob(
        await zip.generateAsync({ type: "blob" }),
        "Turning-Traffic_批次成果_" +
          (selectedQuarters[0] || "無季度") +
          "_至_" +
          (selectedQuarters.at(-1) || "無季度") +
          ".zip",
      );
      notify("批次成果包已產生。");
    } catch (error) {
      // 沒有這層保護時，任何一個計畫丟出例外都會讓按鈕看起來毫無反應。
      notify(
        "批次成果包產生失敗：" +
          (error instanceof Error ? error.message : "未知錯誤"),
      );
    }
  }

  /**
   * 產生備份內容。
   *
   * `scopeProjectId` 給值就是「只備份這一個計畫」，不給就是「全部計畫」。
   *
   * 為什麼要分兩種：使用者在 A 電腦做完 A 計畫、按「下載 JSON」帶到 B 電腦，
   * 結果 B 電腦上出現的是 A 電腦裡的**每一個**計畫——包含別的委託案。
   * 舊版兩顆按鈕（完整 ZIP、JSON 純資料）內容其實一模一樣，都是整台電腦，
   * 只是壓不壓縮的差別，畫面上卻沒有講。
   *
   * 單一計畫的備份會帶 `scope: "project"`，還原時據此走「併入」而不是
   * 「整台取代」——否則把 A 計畫搬到 B 電腦就會清掉 B 電腦既有的計畫。
   */
  const backupPayload = function (scopeProjectId?: string) {
    const scoped = Boolean(scopeProjectId);
    const scopedProjects = scoped
      ? projects.filter(function (project) {
          return project.id === scopeProjectId;
        })
      : projects;
    const scopedIds = new Set(
      scopedProjects.map(function (project) {
        return project.id;
      }),
    );
    const scopedRecords = scoped
      ? records.filter(function (record) {
          return scopedIds.has(record.projectId);
        })
      : records;
    const scopedRecordIds = new Set(
      scopedRecords.map(function (record) {
        return record.id;
      }),
    );
    const pick = function <T>(map: Record<string, T>) {
      return scoped
        ? Object.fromEntries(
            Object.entries(map || {}).filter(function ([key]) {
              return scopedIds.has(key);
            }),
          )
        : map;
    };
    return {
      kind: "TURNING_TRAFFIC_BACKUP",
      version: VERSION,
      /** "project"＝只有一個計畫，還原時併入；"all"＝整台電腦，還原時取代。 */
      scope: scoped ? "project" : "all",
      scopeProjectIds: Array.from(scopedIds),
      exportedAt: new Date().toISOString(),
      projects: scopedProjects,
      activeProjectId: scoped ? scopeProjectId : activeProjectId,
      records: scopedRecords,
      nameMap: nameMap,
      /*
       * 一定要存**每個計畫各自那一份**。
       * pce／vehicleCatalog／vehicleMappings 是 pceByProject[activeProjectId]
       * 之類的衍生值，只存它們的話，備份裡只有「匯出當下開著的那個計畫」的
       * 當量矩陣與車種設定；換一台電腦還原之後，其他計畫全部退回系統預設，
       * 而畫面只會說「還原完成」——每一張報表的數字都用預設當量算，
       * 沒有任何警示。
       * 舊欄位仍然保留，這樣新備份也能被舊版讀。
       */
      pceByProject: pick(pceByProject),
      catalogByProject: pick(catalogByProject),
      mappingsByProject: pick(mappingsByProject),
      /*
       * 舊欄位在「單一計畫備份」時要放**那個計畫**的設定，不能放
       * 目前開著的那一個——不然從計畫清單直接匯出別的計畫時，
       * 舊版讀到的當量矩陣會是另一個案子的。
       */
      pce: scoped ? pceByProject[scopeProjectId!] || pce : pce,
      vehicleCatalog: scoped
        ? catalogByProject[scopeProjectId!] || vehicleCatalog
        : vehicleCatalog,
      vehicleMappings: scoped
        ? mappingsByProject[scopeProjectId!] || vehicleMappings
        : vehicleMappings,
      formatMemories: formatMemories,
      vehicleSchemes: vehicleSchemes,
      reportTemplates: reportTemplates,
      conclusionTemplates: conclusionTemplates,
      recordRevisions: scoped
        ? recordRevisions.filter(function (revision) {
            return scopedRecordIds.has(revision.recordId);
          })
        : recordRevisions,
    };
  };
  /** 檔名裡帶得出計畫是哪一個，B 電腦收到三個檔案時才分得清楚。 */
  const backupFileTag = function (scopeProjectId?: string) {
    const project = projects.find(function (item) {
      return item.id === scopeProjectId;
    });
    const safe = function (value: string) {
      return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    };
    return project
      ? "計畫_" + safe(project.code || "") + "_" + safe(project.name)
      : "完整備份";
  };
  async function exportBackupZip(scopeProjectId?: string) {
    const zip = new JSZip();
    zip.file(
      "turning-traffic-backup.json",
      JSON.stringify(backupPayload(scopeProjectId), null, 2),
    );
    zip.file(
      "README.txt",
      (scopeProjectId
        ? "Turning Traffic 單一計畫備份\r\n只含這一個計畫的季度路口資料、當量參數與車種設定。\r\n在另一台電腦匯入時會「併入」，不會清掉那台電腦上原有的計畫。\r\n"
        : "Turning Traffic 完整備份\r\n包含所有計畫、季度路口資料、名稱映射與當量參數。\r\n在另一台電腦匯入時會「完整取代」那台電腦上的資料。\r\n") +
        "匯入位置：開啟同一個網站 →「備份、還原與版本」→ 選擇備份檔。\r\n",
    );
    downloadBlob(
      await zip.generateAsync({ type: "blob" }),
      "Turning-Traffic_" +
        backupFileTag(scopeProjectId) +
        "_" +
        new Date().toISOString().slice(0, 10) +
        ".zip",
    );
  }
  function exportBackupJson(scopeProjectId?: string) {
    downloadBlob(
      new Blob([JSON.stringify(backupPayload(scopeProjectId), null, 2)], {
        type: "application/json",
      }),
      "Turning-Traffic_" +
        backupFileTag(scopeProjectId) +
        "_" +
        new Date().toISOString().slice(0, 10) +
        ".json",
    );
  }
  async function restoreBackup(file: File) {
    try {
      let text = "";
      if (file.name.toLowerCase().endsWith(".zip")) {
        const zip = await JSZip.loadAsync(file);
        const entry = zip.file("turning-traffic-backup.json");
        if (!entry) throw new Error("ZIP 內找不到 turning-traffic-backup.json");
        text = await entry.async("string");
      } else text = await file.text();
      const data = JSON.parse(text);
      if (
        data.kind !== "TURNING_TRAFFIC_BACKUP" ||
        !Array.isArray(data.records)
      )
        throw new Error("格式不符");
      const restoredProjects = Array.isArray(data.projects)
        ? data.projects
        : [
            {
              id: "P-restored",
              code: "RESTORED",
              name: "舊版還原計畫",
              client: "",
              note: "",
              createdAt: new Date().toISOString(),
            },
          ];
      const fallbackId = restoredProjects[0].id;
      /*
       * 先把整份新狀態算出來，全部成功了才寫進畫面。
       *
       * 舊寫法是先 setProjects / setActiveProjectId，再去 map records——
       * 中間一旦丟例外，畫面上已經換成備份的計畫清單，但舊紀錄還掛在
       * 舊的 projectId 上，等於整批資料變成孤兒（每個畫面都看不到它們），
       * 而使用者收到的訊息是「還原失敗」，根本不會想到資料已經沒了。
       */
      const restoredRecords = synchronizeGeometryAcrossQuarters(
        data.records.map(function (record: TrafficRecord) {
          if (!record || !Array.isArray(record.approaches))
            throw new Error("備份裡有一筆紀錄缺少支線資料，已中止還原");
          return applyReferenceMovementRule({
            ...record,
            projectId: record.projectId || fallbackId,
            name: storedNameOf(record),
            approaches: record.approaches.map(function (approach) {
              return {
                ...approach,
                bearing: bearingFromAngle(approach.angle),
              };
            }),
            intersectionId:
              record.intersectionId ||
              "I-" + canonicalIntersectionKey(record.name),
          });
        }),
      );
      /*
       * ── 單一計畫備份走「併入」，不清掉這台電腦上原有的計畫 ──
       *
       * 使用者的實際情境：A 電腦做完 A 計畫、匯出、拿到 B 電腦匯入。
       * 若照舊版一律「完整取代」，B 電腦上原本的計畫會全部消失，
       * 而畫面只會說「還原完成」。
       *
       * 判斷方式：備份自己標了 scope="project"（新版單一計畫備份），
       * 或者是「只含一個計畫、而這台電腦上有別的計畫」的舊備份——
       * 後者一樣是使用者要搬一個計畫過來，不該連坐清掉其他案子。
       */
      const incomingIds = new Set(
        restoredProjects.map(function (project: Project) {
          return project.id;
        }),
      );
      const existingOtherProjects = projects.filter(function (project) {
        return !incomingIds.has(project.id);
      });
      const mergeMode =
        data.scope === "project" ||
        (restoredProjects.length === 1 && existingOtherProjects.length > 0);
      if (mergeMode) {
        const replacing = projects.filter(function (project) {
          return incomingIds.has(project.id);
        });
        if (
          projects.length &&
          !window.confirm(
            "這是一份「單一計畫備份」，會**併入**這台電腦，不會動到其他計畫。\n\n" +
              `匯入內容：${restoredProjects
                .map(function (project: Project) {
                  return project.name;
                })
                .join("、")}（${restoredRecords.length} 筆路口季度資料）\n` +
              (replacing.length
                ? `這台電腦上同名同編號的「${replacing
                    .map(function (project) {
                      return project.name;
                    })
                    .join("、")}」會被備份的內容取代。\n`
                : "這台電腦上目前沒有同一個計畫，會新增進來。\n") +
              `其餘 ${existingOtherProjects.length} 個計畫不受影響。\n\n確定要匯入嗎？`,
          )
        ) {
          notify("已取消匯入，資料沒有變動。");
          return;
        }
        const keptRecords = records.filter(function (record) {
          return !incomingIds.has(record.projectId);
        });
        const incomingRecordIds = new Set(
          restoredRecords.map(function (record) {
            return record.id;
          }),
        );
        /** 依 id 併：備份裡有的覆蓋，這台電腦上多出來的保留。 */
        const mergeById = function <T extends { id: string }>(
          mine: T[],
          theirs: unknown,
        ) {
          const list = Array.isArray(theirs) ? (theirs as T[]) : [];
          const byId = new Map(
            mine.map(function (item) {
              return [item.id, item] as const;
            }),
          );
          list.forEach(function (item) {
            if (item && item.id) byId.set(item.id, item);
          });
          return Array.from(byId.values());
        };
        setProjects([...existingOtherProjects, ...restoredProjects]);
        setActiveProjectId(data.activeProjectId || restoredProjects[0].id);
        setRecords([...keptRecords, ...restoredRecords]);
        setNameMap({ ...nameMap, ...(data.nameMap || {}) });
        setPceByProject({ ...pceByProject, ...(data.pceByProject || {}) });
        setCatalogByProject({
          ...catalogByProject,
          ...(data.catalogByProject || {}),
        });
        setMappingsByProject({
          ...mappingsByProject,
          ...(data.mappingsByProject || {}),
        });
        setFormatMemories(mergeById(formatMemories, data.formatMemories));
        setVehicleSchemes(mergeById(vehicleSchemes, data.vehicleSchemes));
        setReportTemplates(mergeById(reportTemplates, data.reportTemplates));
        setConclusionTemplates(
          mergeById(conclusionTemplates, data.conclusionTemplates),
        );
        setRecordRevisions(
          mergeById(
            recordRevisions.filter(function (revision) {
              return !incomingRecordIds.has(revision.recordId);
            }),
            data.recordRevisions,
          ),
        );
        notify(
          "已併入 " +
            restoredProjects.length +
            " 個計畫、" +
            restoredRecords.length +
            " 筆資料；其他計畫沒有變動。",
        );
        return;
      }
      /*
       * 還原是全站唯一一個會整批覆蓋的動作，一定要先問過。
       * 刪計畫、刪季度、全部清除、甚至取消預覽都有確認視窗，只有這裡沒有。
       */
      const lockedCount = records.filter(function (record) {
        return Boolean(record.resultLock);
      }).length;
      if (
        records.length &&
        !window.confirm(
          "還原會用備份的內容「完整取代」這台電腦上目前的資料。\n\n" +
            `目前有 ${projects.length} 個計畫、${records.length} 筆路口季度資料` +
            (lockedCount ? `（其中 ${lockedCount} 筆已鎖定成果）` : "") +
            "，全部會被覆蓋且無法復原。\n" +
            `備份內容為 ${restoredProjects.length} 個計畫、${restoredRecords.length} 筆資料。\n\n` +
            "建議先下載一份目前的備份再繼續。確定要還原嗎？",
        )
      ) {
        notify("已取消還原，資料沒有變動。");
        return;
      }
      setProjects(restoredProjects);
      setActiveProjectId(data.activeProjectId || fallbackId);
      setRecords(restoredRecords);
      setNameMap(data.nameMap || {});
      /*
       * 還原時要直接寫整份 byProject，不能用 scoped setter——
       * scoped setter 只會寫進「還原前」那個 activeProjectId 的那一格
       * （setActiveProjectId 不會改變這次 render 閉包裡的值），其他計畫的
       * 設定全部遺失；還原前沒選任何計畫時甚至完全不寫入。
       * 舊備份沒有 byProject 時，沿用載入 localStorage 的同一套遷移方式：
       * 把那一組複製給每一個還原回來的計畫。
       */
      const restoredIds = restoredProjects.map(function (project: Project) {
        return project.id;
      });
      const spreadToAll = function <T>(value: T) {
        return Object.fromEntries(
          restoredIds.map(function (id: string) {
            return [id, value];
          }),
        ) as Record<string, T>;
      };
      setPceByProject(
        data.pceByProject && typeof data.pceByProject === "object"
          ? data.pceByProject
          : spreadToAll(data.pce || DEFAULT_PCE),
      );
      setCatalogByProject(
        data.catalogByProject && typeof data.catalogByProject === "object"
          ? data.catalogByProject
          : spreadToAll({
              ...CORE_VEHICLE_LABELS,
              ...(data.vehicleCatalog || {}),
            }),
      );
      setMappingsByProject(
        data.mappingsByProject && typeof data.mappingsByProject === "object"
          ? data.mappingsByProject
          : spreadToAll(data.vehicleMappings || {}),
      );
      setFormatMemories(
        Array.isArray(data.formatMemories) ? data.formatMemories : [],
      );
      setVehicleSchemes(
        Array.isArray(data.vehicleSchemes) ? data.vehicleSchemes : [],
      );
      setReportTemplates(
        Array.isArray(data.reportTemplates) ? data.reportTemplates : [],
      );
      setConclusionTemplates(
        Array.isArray(data.conclusionTemplates) ? data.conclusionTemplates : [],
      );
      setRecordRevisions(
        Array.isArray(data.recordRevisions) ? data.recordRevisions : [],
      );
      notify("還原完成，可在這台電腦繼續使用。");
    } catch (error) {
      notify(
        "還原失敗：" + (error instanceof Error ? error.message : "檔案無效"),
      );
    }
  }

  const allRecordsEmpty = records.length === 0;
  const noProject = !activeProject;
  const renderNoData = function (title: string) {
    return (
      <Empty
        title={title}
        text={
          noProject
            ? "請先建立計畫，再匯入季度調查檔。"
            : "目前計畫尚無正式資料；系統不預載示範數值。"
        }
        action={
          <button
            className="primary empty-action"
            onClick={function () {
              setView(noProject ? "projects" : "import");
            }}
          >
            {noProject ? "建立計畫" : "前往匯入"}
          </button>
        }
      />
    );
  };

  /*
   * 讀取失敗時不進主程式。
   * 主程式一 render 就會開始存檔，那一步才是真正把使用者資料弄丟的動作；
   * 這裡先擋下來，把原始 JSON 交還給使用者，讓他至少能救回資料。
   */
  if (loadError)
    return (
      <div className="load-error">
        <div className="load-error-card">
          <h1>無法讀取這台電腦上的資料</h1>
          <p>
            儲存在瀏覽器裡的資料有一部分格式不符，系統為了避免把它覆蓋掉，
            這次<b>沒有載入、也沒有寫入任何東西</b>。您的原始資料仍然完整保留在
            瀏覽器裡。
          </p>
          <p className="load-error-reason">錯誤訊息：{loadError}</p>
          <p>
            建議先按下面的按鈕把原始資料存成檔案（那是一份完整的備份），
            再把檔案提供給維護人員；確認之後可以用「備份、還原與版本」還原回來。
          </p>
          <div className="load-error-actions">
            <button
              className="primary"
              onClick={function () {
                const raw =
                  localStorage.getItem("turning-traffic-state-v2") ||
                  localStorage.getItem("turning-traffic-state-v1") ||
                  "";
                downloadBlob(
                  new Blob([raw], { type: "application/json" }),
                  "turning-traffic-原始資料備份.json",
                );
              }}
            >
              下載原始資料（先做這個）
            </button>
            <button
              className="secondary"
              onClick={function () {
                window.location.reload();
              }}
            >
              重新載入試試
            </button>
          </div>
          <p className="load-error-note">
            請勿在下載之前按「清除」或重新匯入——那會讓原始資料真的消失。
          </p>
        </div>
      </div>
    );

  return (
    <div className="app-shell">
      <aside className={mobileNav ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <span className="brand-mark">TT</span>
          <div>
            <strong>Turning Traffic</strong>
            <small>尖峰轉向交通量分析</small>
          </div>
        </div>
        <nav>
          {NAV.map(function (item) {
            return (
              <div key={item.id}>
                {item.group && <p className="nav-group">{item.group}</p>}
                <button
                  className={view === item.id ? "active" : ""}
                  onClick={function () {
                    setView(item.id);
                    setMobileNav(false);
                  }}
                >
                  <span>{item.icon}</span>
                  {item.label}
                  {item.id === "quality" && currentIssues.length > 0 && (
                    <b>{currentIssues.length}</b>
                  )}
                </button>
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <span>
            <i /> 本機資料自動儲存
          </span>
          <small>{VERSION} · 正式版</small>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button
            className="menu"
            onClick={function () {
              setMobileNav(!mobileNav);
            }}
          >
            ☰
          </button>
          <div>
            <span className="crumb">
              Turning Traffic /{" "}
              {
                NAV.find(function (n) {
                  return n.id === view;
                })?.label
              }
            </span>
            <strong>
              {
                NAV.find(function (n) {
                  return n.id === view;
                })?.label
              }
            </strong>
          </div>
          <div className="top-actions">
            <label>
              計畫
              <select
                value={activeProjectId}
                onChange={function (e) {
                  setActiveProjectId(e.target.value);
                }}
              >
                <option value="">尚未選擇</option>
                {projects.map(function (p) {
                  return (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              季度
              <select
                value={quarter}
                onChange={function (e) {
                  setQuarter(e.target.value);
                }}
              >
                <option value="">尚無季度</option>
                {quarters.map(function (q) {
                  return <option key={q}>{q}</option>;
                })}
              </select>
            </label>
            <span className="demo-pill">
              {allRecordsEmpty ? "空白正式環境" : projects.length + " 個計畫"}
            </span>
          </div>
        </header>
        <div className="content">
          {view === "projects" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">PROJECT PORTFOLIO</span>
                  <h1>多計畫監測管理</h1>
                  <p>
                    每個計畫可保有自己的季度、路口、路口幾何與匯出項目勾選，並可跨計畫比較與整包移轉。
                    <b>車種轉向當量、車種目錄與報表範本目前是整台電腦共用的</b>
                    ——在任何計畫改動都會影響其他計畫，交付不同委託案前請先確認係數。
                  </p>
                </div>
              </section>
              <section className="project-layout">
                <article className="panel project-form">
                  <h2>建立新計畫</h2>
                  <label>
                    計畫代碼
                    <input
                      value={projectForm.code}
                      placeholder="例如 115-A01"
                      onChange={function (e) {
                        setProjectForm({
                          ...projectForm,
                          code: e.target.value,
                        });
                      }}
                    />
                  </label>
                  <label>
                    計畫名稱
                    <input
                      value={projectForm.name}
                      placeholder="必填"
                      onChange={function (e) {
                        setProjectForm({
                          ...projectForm,
                          name: e.target.value,
                        });
                      }}
                    />
                  </label>
                  <label>
                    委託單位
                    <input
                      value={projectForm.client}
                      onChange={function (e) {
                        setProjectForm({
                          ...projectForm,
                          client: e.target.value,
                        });
                      }}
                    />
                  </label>
                  <label>
                    備註
                    <textarea
                      value={projectForm.note}
                      onChange={function (e) {
                        setProjectForm({
                          ...projectForm,
                          note: e.target.value,
                        });
                      }}
                    />
                  </label>
                  <button className="primary" onClick={addProject}>
                    ＋ 建立計畫
                  </button>
                </article>
                <article className="panel project-list">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">PROJECTS</span>
                      <h2>現有計畫</h2>
                    </div>
                    <span className="status-dot">{projects.length} 個</span>
                  </div>
                  {projects.length ? (
                    projects.map(function (project) {
                      const count = records.filter(function (r) {
                        return r.projectId === project.id;
                      }).length;
                      return (
                        <div
                          key={project.id}
                          className={
                            project.id === activeProjectId
                              ? "project-row active"
                              : "project-row"
                          }
                        >
                          <button
                            className="project-open"
                            onClick={function () {
                              setActiveProjectId(project.id);
                              setView(count ? "dashboard" : "import");
                            }}
                          >
                            <span>{project.code}</span>
                            <div>
                              <strong>{project.name}</strong>
                              <small>
                                {project.client || "未填委託單位"} · {count}{" "}
                                筆季度路口資料
                              </small>
                            </div>
                            <b>→</b>
                          </button>
                          <button
                            className="project-delete"
                            aria-label={"刪除計畫 " + project.name}
                            title="刪除計畫"
                            onClick={function () {
                              deleteProject(project);
                            }}
                          >
                            刪除
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <Empty
                      title="尚未建立計畫"
                      text="正式網站從空白開始，不預載任何範例數值。"
                    />
                  )}
                </article>
              </section>
            </>
          )}

          {view === "dashboard" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">QUARTERLY OVERVIEW</span>
                  <h1>
                    {activeProject?.name || "尚未選擇計畫"} ·{" "}
                    {quarter || "尚無季度"}
                  </h1>
                  <p>所有流量值均標示為 PCU/hr；百分比為相對變化或方向組成。</p>
                </div>
                <div className="head-buttons">
                  <button
                    className="secondary"
                    onClick={function () {
                      setView("reports");
                    }}
                  >
                    匯出季報
                  </button>
                  <button
                    className="primary"
                    onClick={function () {
                      setView("import");
                    }}
                  >
                    ＋ 匯入季度
                  </button>
                </div>
              </section>
              {!current.length ? (
                renderNoData("本季度尚無資料")
              ) : (
                <>
                  <section className="kpi-grid">
                    <Kpi
                      label="本季調查路口"
                      value={String(current.length) + " 處"}
                      note={
                        String(
                          new Set(
                            current.map(function (r) {
                              return r.date;
                            }),
                          ).size,
                        ) + " 個調查日"
                      }
                    />
                    <Kpi
                      label={"最高流量路口 · " + peak}
                      value={
                        top
                          ? recordTotal(top, peak).toLocaleString() + " PCU/hr"
                          : "—"
                      }
                      note={top ? top.station + " " + top.name : "尚無資料"}
                      accent="blue"
                    />
                    <Kpi
                      label={`較上季 ${peak} 尖峰`}
                      value={
                        change == null
                          ? "—"
                          : (change >= 0 ? "+" : "") + change.toFixed(1) + "%"
                      }
                      note={
                        !previousQuarter
                          ? "尚無上季資料"
                          : comparablePairs.length
                            ? `比較基準 ${previousQuarter}，兩季都有的 ${comparablePairs.length} 筆`
                            : `${previousQuarter} 沒有可對應的同一路口資料`
                      }
                      accent="amber"
                    />
                    <Kpi
                      label="待確認品質項目"
                      value={String(currentIssues.length) + " 項"}
                      note="匯入即時檢查"
                      accent="rose"
                    />
                  </section>
                  <section className="dashboard-grid">
                    <article className="panel ranking">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">PEAK RANKING</span>
                          <h2>路口尖峰小時排名</h2>
                        </div>
                        <Segmented
                          value={peak}
                          options={[
                            ["AM", "AM Peak"],
                            ["PM", "PM Peak"],
                          ]}
                          onChange={setPeak}
                        />
                      </div>
                      <div className="rank-list">
                        {ranked.map(function (record, index) {
                          return (
                            <button
                              key={record.id}
                              onClick={function () {
                                setSelectedIntersection(
                                  recordIntersectionKey(record),
                                );
                                setView("diagram");
                              }}
                            >
                              <span className="rank-no">
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <div>
                                <strong>
                                  {record.station} · {record.name}
                                </strong>
                                <span>
                                  <i
                                    style={{
                                      width:
                                        (recordTotal(record, peak) / maxRank) *
                                          100 +
                                        "%",
                                    }}
                                  />
                                </span>
                              </div>
                              <b>
                                {recordTotal(record, peak).toLocaleString()}
                                <small> PCU/hr</small>
                              </b>
                            </button>
                          );
                        })}
                      </div>
                    </article>
                    <article className="panel action-panel">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">QUALITY</span>
                          <h2>本季檢核摘要</h2>
                        </div>
                      </div>
                      <div className="quality-donut">
                        <div
                          style={
                            {
                              "--score":
                                Math.max(45, 100 - currentIssues.length * 4) +
                                "%",
                            } as React.CSSProperties
                          }
                        >
                          <strong>
                            {Math.max(45, 100 - currentIssues.length * 4)}
                          </strong>
                          <small>品質分數</small>
                        </div>
                        <ul>
                          <li>
                            <span className="good" />
                            格式與欄位 <b>即時</b>
                          </li>
                          <li>
                            <span className="warn" />
                            待人工確認{" "}
                            <b>
                              {
                                currentIssues.filter(function (i) {
                                  return i.severity === "warning";
                                }).length
                              }
                            </b>
                          </li>
                          <li>
                            <span className="bad" />
                            需處理錯誤{" "}
                            <b>
                              {
                                currentIssues.filter(function (i) {
                                  return i.severity === "error";
                                }).length
                              }
                            </b>
                          </li>
                        </ul>
                      </div>
                    </article>
                  </section>
                </>
              )}
            </>
          )}

          {view === "import" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">BATCH IMPORT</span>
                  <h1>季度批次匯入與刪除</h1>
                  <p>
                    先指定調查年度與季度，再選取檔案；同計畫＋同季度＋同站號採覆蓋。
                  </p>
                </div>
              </section>
              <section className="panel import-period">
                <div>
                  <span className="step-no">01</span>
                  <div>
                    <strong>先指定這批資料的調查年度與季度</strong>
                    <p>此設定會套用到本次選取的全部路口，寫入前仍可更改。</p>
                  </div>
                </div>
                <label>
                  調查年度（民國年）
                  <input
                    type="number"
                    min="1"
                    max="999"
                    placeholder="例如 115"
                    value={importYear}
                    onChange={function (e) {
                      setImportYear(
                        e.target.value.replace(/\D/g, "").slice(0, 3),
                      );
                    }}
                  />
                </label>
                <label>
                  季度
                  <select
                    value={importQuarterNo}
                    onChange={function (e) {
                      setImportQuarterNo(e.target.value);
                    }}
                  >
                    <option value="">請選擇</option>
                    <option value="1">第 1 季</option>
                    <option value="2">第 2 季</option>
                    <option value="3">第 3 季</option>
                    <option value="4">第 4 季</option>
                  </select>
                </label>
                <output>
                  {importPeriod
                    ? importYear +
                      " 年第 " +
                      importQuarterNo +
                      " 季（" +
                      importPeriod +
                      "）"
                    : "尚未完成設定"}
                </output>
              </section>
              <section className="panel format-template-panel">
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">IMPORT TEMPLATES</span>
                    <h2>調查檔格式範本</h2>
                  </div>
                </div>
                <div className="format-template-grid">
                  {IMPORT_FORMAT_TEMPLATES.map(function (template) {
                    return (
                      <article key={template.id}>
                        <b>{template.name}</b>
                        <p>{template.description}</p>
                        <small>
                          時距：
                          {template.intervalMinutes === "auto"
                            ? "自動辨識"
                            : template.intervalMinutes + " 分鐘"}
                        </small>
                      </article>
                    );
                  })}
                </div>
                <details
                  className="format-memory"
                  open={formatMemories.length > 0}
                >
                  <summary>
                    已記住的實際調查版型（{formatMemories.length} 種）
                  </summary>
                  {formatMemories.length ? (
                    <div className="format-memory-list">
                      {formatMemories.slice(0, 8).map(function (memory) {
                        return (
                          <article key={memory.id}>
                            <input
                              value={memory.templateName}
                              aria-label="格式範本名稱"
                              onChange={function (event) {
                                setFormatMemories(
                                  formatMemories.map(function (item) {
                                    return item.id === memory.id
                                      ? {
                                          ...item,
                                          templateName: event.target.value,
                                        }
                                      : item;
                                  }),
                                );
                              }}
                            />
                            <span>
                              {memory.sheetPattern || "一般工作表"} ·{" "}
                              {memory.columnCount} 個辨識欄位
                            </span>
                            <small>
                              範例：{memory.sampleFile} · 已使用 {memory.uses}{" "}
                              次
                            </small>
                            <button
                              className="danger-small"
                              onClick={function () {
                                if (
                                  confirm(
                                    "刪除此格式記憶？不會刪除已匯入資料。",
                                  )
                                )
                                  setFormatMemories(
                                    formatMemories.filter(function (item) {
                                      return item.id !== memory.id;
                                    }),
                                  );
                              }}
                            >
                              刪除格式記憶
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p>
                      成功預覽調查檔後，系統會記住工作表組合、辨識欄位數與適用範本；備份還原時也會一併帶走。
                    </p>
                  )}
                </details>
              </section>
              <section className="import-layout">
                <article
                  className="panel upload-card"
                  onDragOver={function (e) {
                    e.preventDefault();
                  }}
                  onDrop={function (e) {
                    e.preventDefault();
                    handleFiles(e.dataTransfer.files);
                  }}
                >
                  <span className="upload-icon">⇧</span>
                  <h2>再拖曳 Excel 檔案到這裡</h2>
                  <p>
                    支援 .xls、.xlsx、.xlsm，多路口一次選取；照片工作表忽略。
                  </p>
                  <input
                    ref={fileRef}
                    hidden
                    type="file"
                    multiple
                    accept=".xls,.xlsx,.xlsm"
                    onChange={function (e) {
                      handleFiles(e.target.files);
                    }}
                  />
                  <button
                    className="primary"
                    disabled={!importPeriod}
                    onClick={function () {
                      fileRef.current?.click();
                    }}
                  >
                    {importing
                      ? "正在解析…"
                      : importPeriod
                        ? "選擇檔案"
                        : "請先選年度與季度"}
                  </button>
                  <small>
                    {importPeriod
                      ? "本批次將寫入 " + importPeriod
                      : "年度與季度為必填"}
                  </small>
                </article>
                <article className="panel import-rules">
                  <span className="eyebrow">CALCULATION RULE</span>
                  <h2>尖峰小時計算</h2>
                  <ol>
                    <li>
                      <b>15 分鐘資料</b>
                      <span>連續 4 區間組成 60 分鐘。</span>
                    </li>
                    <li>
                      <b>AM／PM 分開搜尋</b>
                      <span>同值取較早時段。</span>
                    </li>
                    <li>
                      <b>參考檔只做驗證</b>
                      <span>不盲目照抄計算檔。</span>
                    </li>
                    <li>
                      <b>欄位映射可調整</b>
                      <span>匯入後需確認道路支線與左直右欄位。</span>
                    </li>
                  </ol>
                </article>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">IMPORT PREVIEW</span>
                    <h2>匯入辨識結果</h2>
                  </div>
                  <div className="preview-actions">
                    {/* 預覽的用意就是「先看看有沒有問題，有問題先去修檔案」。
                        過去只能一列一列按「刪除」，整批要放棄時很麻煩，
                        也讓人不確定自己是不是已經被寫進去了。 */}
                    <button
                      className="ghost"
                      disabled={!importRows.length}
                      onClick={function () {
                        if (
                          !confirm(
                            "取消本次預覽？\n已辨識的 " +
                              importRows.length +
                              " 個檔案會從畫面清除，正式資料完全不會變動。",
                          )
                        )
                          return;
                        setImportRows([]);
                        setImportResolutions({});
                        setImportConflictModes({});
                        // 預覽時為了讓車種歸類面板能操作，先把新車種寫進了
                        // 目錄／對應／當量矩陣。取消就要原樣還原，否則
                        //「正式資料完全不會變動」是騙人的，而且沒有任何介面
                        // 可以把多出來的車種刪掉。已經有紀錄在用的不動。
                        if (previewAddedVehicles.length) {
                          const inUse = new Set(
                            records.flatMap(function (record) {
                              return Object.keys(record.survey?.vehicle || {});
                            }),
                          );
                          const removable = previewAddedVehicles.filter(
                            function (id) {
                              return !inUse.has(id);
                            },
                          );
                          if (removable.length) {
                            setVehicleCatalog(function (existing) {
                              const next = { ...existing };
                              removable.forEach(function (id) {
                                delete next[id];
                              });
                              return next;
                            });
                            setVehicleMappings(function (existing) {
                              const next = { ...existing };
                              removable.forEach(function (id) {
                                delete next[id];
                              });
                              return next;
                            });
                            setPce(function (existing) {
                              const next = structuredClone(existing);
                              removable.forEach(function (id) {
                                delete next[id];
                              });
                              return next;
                            });
                          }
                          setPreviewAddedVehicles([]);
                        }
                        // importVehicleDefinitions 是由 importRows 推導出來的，
                        // 清空 importRows 就會跟著消失，不需要也不能另外清。
                        // 檔案輸入也要清掉：使用者修好檔案後通常會重新選同一個
                        // 檔名，不清掉的話瀏覽器可能不觸發 change。
                        if (fileRef.current) fileRef.current.value = "";
                        notify("已取消本次預覽，正式資料沒有變動；修正檔案後請重新選取。");
                      }}
                    >
                      取消預覽
                    </button>
                    <button
                      className="primary"
                      disabled={!importRows.length || !importPeriod}
                      onClick={commitImport}
                    >
                      確認寫入 {importPeriod || "未選季度"}
                    </button>
                  </div>
                </div>
                {importVehicleDefinitions.length > 0 && (
                  <div className="vehicle-mapping-panel">
                    <div>
                      <strong>
                        本批次辨識到 {importVehicleDefinitions.length}{" "}
                        個原始車種
                      </strong>
                      <small>
                        預設各自獨立分析；也可在寫入前併入四個標準類別。合併後以目標類別當量換算。
                      </small>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>原始車種</th>
                            <th>分析方式／歸類</th>
                            <th>左轉當量</th>
                            <th>直行當量</th>
                            <th>右轉當量</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importVehicleDefinitions.map(function (definition) {
                            const target =
                              vehicleMappings[definition.id] || definition.id;
                            const factors = pce[target] || {
                              left: 1,
                              through: 1,
                              right: 1,
                            };
                            return (
                              <tr key={definition.id}>
                                <td>
                                  <strong>{definition.label}</strong>
                                  <small>
                                    {definition.core ? "標準車種" : "新增車種"}
                                  </small>
                                </td>
                                <td>
                                  <select
                                    value={target}
                                    onChange={function (event) {
                                      const nextTarget = event.target.value;
                                      setVehicleMappings({
                                        ...vehicleMappings,
                                        [definition.id]: nextTarget,
                                      });
                                      if (!pce[nextTarget])
                                        setPce({
                                          ...pce,
                                          [nextTarget]: {
                                            left: 1,
                                            through: 1,
                                            right: 1,
                                          },
                                        });
                                    }}
                                  >
                                    <option value={definition.id}>
                                      獨立分析：{definition.label}
                                    </option>
                                    {ANALYSIS_VEHICLES.filter(function (id) {
                                      return id !== definition.id;
                                    }).map(function (id) {
                                      return (
                                        <option key={id} value={id}>
                                          併入：{VEHICLE_LABELS[id]}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </td>
                                {(["left", "through", "right"] as const).map(
                                  function (movement) {
                                    return (
                                      <td key={movement}>
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.1"
                                          value={factors[movement]}
                                          onChange={function (event) {
                                            setPce({
                                              ...pce,
                                              [target]: {
                                                ...factors,
                                                [movement]: Number(
                                                  event.target.value,
                                                ),
                                              },
                                            });
                                          }}
                                        />
                                      </td>
                                    );
                                  },
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {importRows.some(function (row) {
                      return (
                        row.layout === "unknown" &&
                        row.detectedVehicles.length > 0
                      );
                    }) && (
                      <p className="source-note">
                        已讀到車種但未找到轉向／OD
                        欄位的檔案，只能確認車種結構，不會在本路口轉向系統中誤建轉向資料。
                      </p>
                    )}
                  </div>
                )}
                {!importRows.length ? (
                  <Empty
                    title="尚未選取檔案"
                    text="預覽階段不會更動正式資料。支援 .xls、.xlsx、.xlsm。"
                  />
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>檔案</th>
                          <th>角色</th>
                          <th>版本／差異處理</th>
                          <th>站號／名稱</th>
                          <th>名稱處理</th>
                          <th>AM Peak（PCU/hr）</th>
                          <th>PM Peak（PCU/hr）</th>
                          <th>檢查</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {importRows.map(function (row) {
                          const liveRow = configuredImportPreview(
                            row,
                            pce,
                            vehicleMappings,
                          );
                          const resolution = importResolutions[row.file] || {
                            action: "auto-new",
                          };
                          /*
                           * 這裡的比對鍵必須與 targetId 的產生方式一致
                           *（recordIntersectionKey）。舊版這裡用
                           * intersectionId || canonical(name)，而 targetId 用
                           * recordIntersectionKey——只要紀錄有 intersectionId
                           *（匯入的紀錄都有）兩者就不同，於是：下拉選單顯示
                           *「建立新路口」卻其實會併入；使用者手動選「併入」時
                           * 又找不到目標而完全沒有作用。兩個方向都是壞的。
                           */
                          const matched = canonicalRecords.find(
                            function (record) {
                              return (
                                recordIntersectionKey(record) ===
                                resolution.targetId
                              );
                            },
                          );
                          const existingImport = records.find(
                            function (record) {
                              return (
                                record.projectId === activeProjectId &&
                                record.quarter === importPeriod &&
                                record.station === row.station &&
                                (record.surveyType || "待設定") ===
                                  (row.surveyType || "待設定")
                              );
                            },
                          );
                          return (
                            <tr key={row.file}>
                              <td>{row.file}</td>
                              <td>
                                <span
                                  className={
                                    "tag " +
                                    (row.role === "無法辨識"
                                      ? "red"
                                      : row.role === "參考計算檔"
                                        ? "blue"
                                        : row.role === "非路口轉向"
                                          ? "amber"
                                          : "green")
                                  }
                                >
                                  {row.role}
                                </span>
                              </td>
                              <td>
                                {existingImport ? (
                                  <div className="import-conflict">
                                    <b>
                                      已存在第 {existingImport.revision || 1} 版
                                    </b>
                                    <small>
                                      AM：
                                      {recordTotal(
                                        existingImport,
                                        "AM",
                                      ).toLocaleString()}{" "}
                                      →{" "}
                                      {Math.round(
                                        liveRow.am?.total || 0,
                                      ).toLocaleString()}{" "}
                                      PCU/hr
                                    </small>
                                    <small>
                                      PM：
                                      {recordTotal(
                                        existingImport,
                                        "PM",
                                      ).toLocaleString()}{" "}
                                      →{" "}
                                      {Math.round(
                                        liveRow.pm?.total || 0,
                                      ).toLocaleString()}{" "}
                                      PCU/hr
                                    </small>
                                    <select
                                      value={
                                        importConflictModes[row.file] ||
                                        "version"
                                      }
                                      onChange={function (event) {
                                        setImportConflictModes({
                                          ...importConflictModes,
                                          [row.file]: event.target
                                            .value as ImportConflictMode,
                                        });
                                      }}
                                    >
                                      {/* 兩個選項實際行為相同（都覆蓋、都留還原點），
                                          差別只在還原點的說明文字。舊版寫成
                                         「保留舊版並建立新版」，聽起來像舊資料會
                                          留著，但並不會——那是會讓人做錯決定的敘述。 */}
                                      <option value="version">
                                        覆蓋，還原點註記「改版」
                                      </option>
                                      <option value="overwrite">
                                        覆蓋，還原點註記「重新匯入」
                                      </option>
                                      <option value="skip">略過此檔</option>
                                    </select>
                                  </div>
                                ) : (
                                  <span className="tag blue">第 1 版</span>
                                )}
                              </td>
                              <td>
                                {row.station}
                                <small>{row.name}</small>
                                <small>
                                  {row.date
                                    ? "調查日 " +
                                      row.date +
                                      (row.dateSource
                                        ? " · " +
                                          row.dateSource.sheet +
                                          "!" +
                                          row.dateSource.cell
                                        : "")
                                    : "日期辨識未成功（已掃描標題區）"}
                                </small>
                                <small>
                                  格式範本：
                                  {row.templateName || "一般語意轉向表"} ·{" "}
                                  {row.surveyType}
                                </small>
                              </td>
                              <td>
                                {resolution.action === "auto" ? (
                                  <span className="tag green">
                                    自動併入 · {matched?.name}
                                  </span>
                                ) : resolution.action === "auto-new" ? (
                                  <span className="tag blue">
                                    自動建立新路口
                                  </span>
                                ) : (
                                  <select
                                    value={
                                      resolution.action === "merge"
                                        ? "merge:" + (resolution.targetId || "")
                                        : resolution.action
                                    }
                                    onChange={function (e) {
                                      const value = e.target.value;
                                      setImportResolutions({
                                        ...importResolutions,
                                        [row.file]: value.startsWith("merge:")
                                          ? {
                                              action: "merge",
                                              targetId: value.slice(6),
                                            }
                                          : { action: value as "new" | "skip" },
                                      });
                                    }}
                                  >
                                    <option value="new">建立新路口</option>
                                    {canonicalRecords.map(function (record) {
                                      const id = recordIntersectionKey(record);
                                      return (
                                        <option key={id} value={"merge:" + id}>
                                          併入：{record.name}
                                        </option>
                                      );
                                    })}
                                    <option value="skip">取消建置此檔</option>
                                  </select>
                                )}
                              </td>
                              <td>
                                {liveRow.am
                                  ? formatMinutes(liveRow.am.start) +
                                    "–" +
                                    formatMinutes(liveRow.am.end) +
                                    " · " +
                                    Math.round(
                                      liveRow.am.total,
                                    ).toLocaleString() +
                                    " PCU/hr"
                                  : "—"}
                              </td>
                              <td>
                                {liveRow.pm
                                  ? formatMinutes(liveRow.pm.start) +
                                    "–" +
                                    formatMinutes(liveRow.pm.end) +
                                    " · " +
                                    Math.round(
                                      liveRow.pm.total,
                                    ).toLocaleString() +
                                    " PCU/hr"
                                  : "—"}
                              </td>
                              <td>
                                {row.warnings.map(function (warning) {
                                  return (
                                    <small
                                      className="warning-text"
                                      key={warning}
                                    >
                                      {warning}
                                    </small>
                                  );
                                })}
                              </td>
                              <td>
                                <button
                                  className="icon-danger"
                                  onClick={function () {
                                    setImportRows(
                                      importRows.filter(function (item) {
                                        return item.file !== row.file;
                                      }),
                                    );
                                  }}
                                >
                                  刪除
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="panel imported-data">
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">IMPORTED DATA</span>
                    <h2>已匯入季度資料</h2>
                  </div>
                </div>
                {quarters.length ? (
                  quarters.map(function (q) {
                    const rows = projectRecords.filter(function (r) {
                      return r.quarter === q;
                    });
                    return (
                      <div className="imported-quarter" key={q}>
                        <div>
                          <strong>{q}</strong>
                          <span>{rows.length} 個路口</span>
                        </div>
                        <div>
                          {rows.map(function (record) {
                            return (
                              <button
                                key={record.id}
                                onClick={function () {
                                  // 已鎖定的成果要走與「刪除整季」同一道授權，
                                  // 否則旁邊的按鈕擋得住、這一顆卻擋不住。
                                  if (
                                    record.resultLock &&
                                    !authorizeLockedChange(
                                      [record],
                                      "刪除這筆資料",
                                    )
                                  )
                                    return;
                                  if (
                                    confirm(
                                      "刪除 " +
                                        record.station +
                                        " " +
                                        record.name +
                                        "？",
                                    )
                                  ) {
                                    saveRevision(record, "刪除前自動建立還原點");
                                    setRecords(
                                      records.filter(function (r) {
                                        return r.id !== record.id;
                                      }),
                                    );
                                  }
                                }}
                              >
                                {record.station} ×
                              </button>
                            );
                          })}
                        </div>
                        <button
                          className="danger-small"
                          onClick={function () {
                            deleteQuarter(q);
                          }}
                        >
                          刪除整季
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <Empty
                    title="尚無已匯入資料"
                    text="正式環境保持空白，等待使用者建置。"
                  />
                )}
              </section>
            </>
          )}

          {view === "parameters" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">PARAMETER LIBRARY</span>
                  <h1>車種與轉向當量參數</h1>
                  <p>當量只用於將原始車輛數換算成尖峰轉向 PCU。</p>
                </div>
                <button
                  className="secondary"
                  onClick={function () {
                    setPce({ ...pce, ...structuredClone(DEFAULT_PCE) });
                    notify(
                      "已恢復四個標準車種的講義預設值；新增車種保留原設定。",
                    );
                  }}
                >
                  恢復預設值
                </button>
              </section>
              <section className="parameter-grid">
                <article className="panel parameter-card">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">PCE / PCU</span>
                      <h2>各分析車種左／直／右當量</h2>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>車種</th>
                          <th>左轉</th>
                          <th>直行</th>
                          <th>右轉</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(pce)
                          .sort(function (a, b) {
                            const ai = ANALYSIS_VEHICLES.indexOf(
                              a as (typeof ANALYSIS_VEHICLES)[number],
                            );
                            const bi = ANALYSIS_VEHICLES.indexOf(
                              b as (typeof ANALYSIS_VEHICLES)[number],
                            );
                            if (ai >= 0 || bi >= 0)
                              return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
                            return (vehicleCatalog[a] || a).localeCompare(
                              vehicleCatalog[b] || b,
                              "zh-Hant",
                            );
                          })
                          .map(function (vehicleKey) {
                            return (
                              <tr key={vehicleKey}>
                                <td>
                                  <strong>
                                    {vehicleCatalog[vehicleKey] ||
                                      PCE_LABELS[
                                        vehicleKey as keyof typeof PCE_LABELS
                                      ] ||
                                      vehicleKey.replace(/^custom:/, "")}
                                  </strong>
                                  {!ANALYSIS_VEHICLES.includes(
                                    vehicleKey as (typeof ANALYSIS_VEHICLES)[number],
                                  ) && <small>新增車種</small>}
                                </td>
                                {(["left", "through", "right"] as const).map(
                                  function (move) {
                                    return (
                                      <td key={move}>
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.1"
                                          value={pce[vehicleKey][move]}
                                          aria-label={
                                            (vehicleCatalog[vehicleKey] ||
                                              vehicleKey) +
                                            MOVE_LABELS[move] +
                                            "當量"
                                          }
                                          onChange={function (e) {
                                            setPce({
                                              ...pce,
                                              [vehicleKey]: {
                                                ...pce[vehicleKey],
                                                [move]: Number(e.target.value),
                                              },
                                            });
                                          }}
                                        />
                                      </td>
                                    );
                                  },
                                )}
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  <div className="source-note">
                    <b>預設值來源與版本保存</b>
                    <p>
                      機車、小型車、大型車、特種車四類的左轉／直行／右轉當量，取自使用者提供的《交通流量教育訓練1060310》簡報第
                      15
                      頁「當量參考值」；原簡報未載明引用來源，故列為可調整的專案預設。
                      <b>簡報只提供這四類的參考值</b>
                      ，因此匯入時若偵測到大貨車、大客車、聯結車等其他車種，系統不會自行推估，
                      一律先以 <b>1.0</b>{" "}
                      建立並標示為「新增車種」，請在上方表格逐一改成本計畫採用的數值。
                      修改後會套用於後續匯入的尖峰時段搜尋與 PCU/hr
                      換算；每筆路口同時保存匯入當下的係數與分類快照，Excel
                      報表與備份均可追溯。
                    </p>
                  </div>
                </article>
                <article className="panel parameter-card">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">SCOPE</span>
                      <h2>本系統的計算範圍</h2>
                    </div>
                  </div>
                  <div className="guidance-copy">
                    <p>
                      系統以原始 15 分鐘交通量找出連續 60
                      分鐘尖峰，依可調整的車種／轉向當量換算
                      PCU/hr，並保留實際車輛數（輛/hr）。
                    </p>
                    <p>
                      本系統專注尖峰轉向流量彙整，不加入未由本次調查取得的容量相關假設。
                    </p>
                  </div>
                </article>
                <article className="panel parameter-card">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">VEHICLE SCHEMES</span>
                      <h2>車種歸類方案</h2>
                    </div>
                    <button
                      className="secondary"
                      onClick={function () {
                        const name =
                          prompt("請輸入方案名稱，例如：五車種獨立分析");
                        if (!name?.trim()) return;
                        setVehicleSchemes([
                          {
                            id: "VS-" + Date.now().toString(36),
                            name: name.trim(),
                            mappings: structuredClone(vehicleMappings),
                            createdAt: new Date().toISOString(),
                          },
                          ...vehicleSchemes,
                        ]);
                        notify("已保存車種歸類方案。");
                      }}
                    >
                      保存目前方案
                    </button>
                  </div>
                  {vehicleSchemes.length ? (
                    <div className="format-memory-list">
                      {vehicleSchemes.map(function (scheme) {
                        return (
                          <article key={scheme.id}>
                            <b>{scheme.name}</b>
                            <small>
                              {Object.keys(scheme.mappings).length}{" "}
                              個來源車種設定
                            </small>
                            <div className="head-buttons">
                              <button
                                onClick={function () {
                                  setVehicleMappings(
                                    structuredClone(scheme.mappings),
                                  );
                                  notify(
                                    "已套用「" +
                                      scheme.name +
                                      "」。下次匯入時生效。",
                                  );
                                }}
                              >
                                套用
                              </button>
                              <button
                                className="danger-small"
                                onClick={function () {
                                  setVehicleSchemes(
                                    vehicleSchemes.filter(function (item) {
                                      return item.id !== scheme.id;
                                    }),
                                  );
                                }}
                              >
                                刪除
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p>
                      可將目前「獨立分析／併入標準車種」設定保存，下次匯入相同廠商資料時直接套用。
                    </p>
                  )}
                </article>
              </section>
            </>
          )}

          {view === "composition" && (
            <>
              {!selected ? (
                renderNoData("尚無可分析的車種資料")
              ) : (
                <>
                  <section className="page-head compact">
                    <div>
                      <span className="eyebrow">VEHICLE COMPOSITION</span>
                      <h1>各路口車種組成</h1>
                      <p>
                        以原始實際車輛數統計，不套用 PCU
                        當量；可切換全調查時段、AM 尖峰或 PM 尖峰。
                      </p>
                    </div>
                    <div className="head-buttons">
                      <Segmented
                        value={compositionScope}
                        options={[
                          ["SURVEY", "全調查時段"],
                          ["AM", "AM Peak"],
                          ["PM", "PM Peak"],
                        ]}
                        onChange={setCompositionScope}
                      />
                      <button
                        className="secondary"
                        onClick={exportCompositionExcel}
                      >
                        下載 Excel
                      </button>
                    </div>
                  </section>
                  <section className="diagram-toolbar panel">
                    <label>
                      資料季度
                      <select
                        value={quarter}
                        onChange={function (e) {
                          setQuarter(e.target.value);
                        }}
                      >
                        {quarters.map(function (q) {
                          return (
                            <option key={q} value={q}>
                              {q}（
                              {
                                projectRecords.filter(function (record) {
                                  return record.quarter === q;
                                }).length
                              }{" "}
                              路口）
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      路口
                      <select
                        value={recordIntersectionKey(selected)}
                        onChange={function (e) {
                          setSelectedIntersection(e.target.value);
                        }}
                      >
                        {currentCanonicalRecords.map(function (record) {
                          return (
                            <option
                              key={record.id}
                              value={recordIntersectionKey(record)}
                            >
                              {record.name}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    {selectedIntersectionRecords.length > 1 && (
                      <label>
                        資料別
                        <select
                          value={selected.surveyType || "待設定"}
                          onChange={function (e) {
                            setSelectedSurveyType(e.target.value);
                          }}
                        >
                          {selectedIntersectionRecords.map(function (record) {
                            return (
                              <option
                                key={record.id}
                                value={record.surveyType || "待設定"}
                              >
                                {record.surveyType || "待設定"}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    )}
                    <div className="source-note">
                      {compositionScope === "SURVEY"
                        ? selected.survey
                          ? "調查時段合計：" +
                            selected.survey.intervals +
                            " 個 " +
                            Math.round(
                              selected.survey.minutes /
                                Math.max(1, selected.survey.intervals),
                            ) +
                            " 分鐘區間（" +
                            (selected.survey.minutes / 60).toFixed(1) +
                            " 小時）"
                          : "此筆為舊版資料；重新匯入原始檔後可顯示全調查時段組成。"
                        : "尖峰時段：" +
                          selected.peaks[compositionScope].start +
                          "–" +
                          selected.peaks[compositionScope].end}
                    </div>
                  </section>
                  <section className="kpi-grid composition-kpis">
                    {selectedVehicleIds.map(function (vehicleKey) {
                      const count = recordVehicleTotal(
                        selected,
                        compositionScope,
                        vehicleKey,
                      );
                      const total = selectedVehicleIds.reduce(function (
                        sum,
                        key,
                      ) {
                        return (
                          sum +
                          recordVehicleTotal(selected, compositionScope, key)
                        );
                      }, 0);
                      return (
                        <Kpi
                          key={vehicleKey}
                          label={vehicleLabel(selected, vehicleKey)}
                          value={
                            count.toLocaleString() +
                            (compositionScope === "SURVEY"
                              ? " 輛/調查時段"
                              : " 輛/hr")
                          }
                          note={
                            total
                              ? ((count / total) * 100).toFixed(1) + "%"
                              : "0.0%"
                          }
                        />
                      );
                    })}
                  </section>
                  {compositionScope === "SURVEY" ? (
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">ROAD DIRECTION</span>
                          <h2>全調查時段道路方向車種數量</h2>
                          <small>
                            依各支線的駛出／駛入 OD
                            流量統計；雙向合計等同兩個行車方向相加。單位：輛／調查時段（
                            {selected.survey?.minutes || 0} 分鐘）
                          </small>
                        </div>
                      </div>
                      <div className="direction-mode-grid">
                        {selected.approaches.map(function (approach) {
                          const code = approach.sourceCode || approach.id;
                          return (
                            <label key={approach.id}>
                              {approach.name}（{code}）
                              <select
                                value={
                                  selected.directionDisplay?.[code] || "split"
                                }
                                onChange={function (event) {
                                  updateSelectedGeometry(function (record) {
                                    record.directionDisplay = {
                                      ...(record.directionDisplay || {}),
                                      [code]: event.target.value as
                                        "split" | "two-way",
                                    };
                                    return record;
                                  });
                                }}
                              >
                                <option value="split">分行車方向</option>
                                <option value="two-way">雙向合計</option>
                              </select>
                            </label>
                          );
                        })}
                      </div>
                      {selected.routes?.some(function (route) {
                        return Boolean(route.survey);
                      }) ? (
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>道路支線</th>
                                <th>行車方向</th>
                                <th>與路口關係</th>
                                {selectedVehicleIds.map(function (vehicleKey) {
                                  return (
                                    <th key={vehicleKey}>
                                      {vehicleLabel(selected, vehicleKey)}
                                      （輛／調查時段）
                                    </th>
                                  );
                                })}
                                <th>實際車輛合計（輛／調查時段）</th>
                              </tr>
                            </thead>
                            <tbody>
                              {surveyDirectionRows(selected)
                                .filter(function (row) {
                                  const code =
                                    row.approach.sourceCode || row.approach.id;
                                  const display =
                                    selected.directionDisplay?.[code] ||
                                    "split";
                                  return display === "two-way"
                                    ? row.relation === "雙向合計"
                                    : row.relation !== "雙向合計";
                                })
                                .map(function (row, index) {
                                  const total = selectedVehicleIds.reduce(
                                    function (sum, vehicleKey) {
                                      return (
                                        sum +
                                        Number(row.vehicle[vehicleKey] || 0)
                                      );
                                    },
                                    0,
                                  );
                                  return (
                                    <tr
                                      key={
                                        row.approach.id +
                                        "-" +
                                        row.relation +
                                        index
                                      }
                                      className={
                                        row.relation === "雙向合計"
                                          ? "summary-row"
                                          : undefined
                                      }
                                    >
                                      <td>
                                        {row.approach.name}
                                        <br />
                                        <small>
                                          原始代碼 {row.approach.sourceCode}
                                        </small>
                                      </td>
                                      <td>{row.direction}</td>
                                      <td>{row.relation}</td>
                                      {selectedVehicleIds.map(
                                        function (vehicleKey) {
                                          return (
                                            <td key={vehicleKey}>
                                              {Number(
                                                row.vehicle[vehicleKey] || 0,
                                              ).toLocaleString()}
                                            </td>
                                          );
                                        },
                                      )}
                                      <td>{total.toLocaleString()}</td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="empty-inline">
                          此筆是舊版匯入資料，尚未保存各 OD
                          的全時段車種數；請在同計畫、同季度重新匯入原始檔，系統會覆蓋更新並保留既有路口幾何設定。
                        </div>
                      )}
                    </section>
                  ) : null}
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <span className="eyebrow">ALL INTERSECTIONS</span>
                        <h2>
                          {quarter} 各路口{" "}
                          {compositionScope === "SURVEY"
                            ? "全調查時段"
                            : compositionScope + " Peak"}{" "}
                          車種組成
                        </h2>
                      </div>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>站號／路口</th>
                            {currentVehicleIds.map(function (vehicleKey) {
                              return (
                                <th key={vehicleKey}>
                                  {vehicleLabel(selected, vehicleKey)}（
                                  {compositionScope === "SURVEY"
                                    ? "輛/調查時段"
                                    : "輛/hr"}
                                  ｜%）
                                </th>
                              );
                            })}
                            <th>
                              實際車輛合計（
                              {compositionScope === "SURVEY"
                                ? "輛/調查時段"
                                : "輛/hr"}
                              ）
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentCanonicalRecords.map(function (record) {
                            const counts = currentVehicleIds.map(
                              function (vehicleKey) {
                                return recordVehicleTotal(
                                  record,
                                  compositionScope,
                                  vehicleKey,
                                );
                              },
                            );
                            const total = counts.reduce(function (sum, value) {
                              return sum + value;
                            }, 0);
                            return (
                              <tr key={record.id}>
                                <td>
                                  <strong>{record.station}</strong>
                                  <br />
                                  <small>{record.name}</small>
                                </td>
                                {counts.map(function (count, index) {
                                  return (
                                    <td key={currentVehicleIds[index]}>
                                      {count.toLocaleString()}｜
                                      {total
                                        ? ((count / total) * 100).toFixed(1)
                                        : "0.0"}
                                      %
                                    </td>
                                  );
                                })}
                                <td>{total.toLocaleString()}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
            </>
          )}

          {view === "inbound" && (
            <>
              {!selected ? (
                renderNoData("尚無可分析的駛入流量資料")
              ) : (
                <>
                  <section className="page-head compact">
                    <div>
                      <span className="eyebrow">INBOUND BRANCH FLOW</span>
                      <h1>駛入／駛出各路口交通量</h1>
                      <p>
                        依系統已確認的道路方位與左／直／右目的支線重新計算；全日資料不足時以「－」表示，不以尖峰時段推估。
                      </p>
                    </div>
                  </section>
                  <section className="diagram-toolbar panel">
                    <label>
                      資料季度
                      <select
                        value={quarter}
                        onChange={function (event) {
                          setQuarter(event.target.value);
                        }}
                      >
                        {quarters.map(function (item) {
                          return (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      路口
                      <select
                        value={recordIntersectionKey(selected)}
                        onChange={function (event) {
                          setSelectedIntersection(event.target.value);
                        }}
                      >
                        {currentCanonicalRecords.map(function (record) {
                          return (
                            <option
                              key={record.id}
                              value={recordIntersectionKey(record)}
                            >
                              {record.name}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    {selectedIntersectionRecords.length > 1 && (
                      <label>
                        資料別
                        <select
                          value={selected.surveyType || "待設定"}
                          onChange={function (e) {
                            setSelectedSurveyType(e.target.value);
                          }}
                        >
                          {selectedIntersectionRecords.map(function (record) {
                            return (
                              <option
                                key={record.id}
                                value={record.surveyType || "待設定"}
                              >
                                {record.surveyType || "待設定"}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    )}
                    <div className="source-note">
                      {selected.survey && selected.survey.minutes >= 24 * 60
                        ? `完整24小時調查資料：${selected.survey.minutes / 60} 小時；可計算全日欄位。`
                        : "此格式未提供完整24小時資料；全日欄位不適用。"}
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <span className="eyebrow">RESULT TABLE</span>
                        <h2>
                          {selected.station} · {selected.name}
                        </h2>
                        <small>
                          AM Peak：{selected.peaks.AM.start}–
                          {selected.peaks.AM.end}；PM Peak：
                          {selected.peaks.PM.start}–{selected.peaks.PM.end}
                        </small>
                      </div>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            {/* 這一欄不是「目的路口」：同一列同時放了以這支
                                為終點的駛入量、與以這支為起點的駛出量，寫成
                                目的路口會讓右半邊的駛出欄位看起來方向相反。 */}
                            <th>路口支線／道路支線</th>
                            <th>全日駛入／駛出（PCU/調查日）</th>
                            <th>AM Peak 駛入／駛出（PCU/hr）</th>
                            <th>PM Peak 駛入／駛出（PCU/hr）</th>
                            <th>全日駛入／駛出車輛數（輛/調查日）</th>
                            <th>AM Peak 駛入／駛出車輛數（輛/hr）</th>
                            <th>PM Peak 駛入／駛出車輛數（輛/hr）</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inboundAnalysisRows(selected).map(function (row) {
                            const label =
                              row.approach.sourceCode || row.approach.id;
                            const format = function (value: number | null) {
                              return value == null
                                ? "－"
                                : value.toLocaleString(undefined, {
                                    maximumFractionDigits: 1,
                                  });
                            };
                            return (
                              <tr key={row.approach.id}>
                                <td>
                                  <strong>路口 {label}</strong>
                                  <br />
                                  <small>{row.approach.name}</small>
                                </td>
                                <td>
                                  駛入 {format(row.inboundFullDayPcu)}
                                  <br />
                                  駛出 {format(row.outboundFullDayPcu)}
                                </td>
                                <td>
                                  駛入 {format(row.inboundAmPcu)}
                                  <br />
                                  駛出 {format(row.outboundAmPcu)}
                                </td>
                                <td>
                                  駛入 {format(row.inboundPmPcu)}
                                  <br />
                                  駛出 {format(row.outboundPmPcu)}
                                </td>
                                <td>
                                  駛入 {format(row.inboundFullDayVehicles)}
                                  <br />
                                  駛出 {format(row.outboundFullDayVehicles)}
                                </td>
                                <td>
                                  駛入 {format(row.inboundAmVehicles)}
                                  <br />
                                  駛出 {format(row.outboundAmVehicles)}
                                </td>
                                <td>
                                  駛入 {format(row.inboundPmVehicles)}
                                  <br />
                                  駛出 {format(row.outboundPmVehicles)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="source-note">
                      判定原則：駛入路口X＝其他支線開往X的車；駛出路口X＝從X開往其他支線的車。同一統計範圍內，各支線的駛入合計與駛出合計應相等，也等於該路口總量；若有未分配流向，資料品質檢查將提示差異，不採用外部計算表的漏算結果。
                    </div>
                  </section>
                </>
              )}
            </>
          )}

          {view === "diagram" && (
            <>
              {!selected ? (
                renderNoData("尚無可繪製路口")
              ) : (
                <>
                  <section className="page-head compact">
                    <div>
                      <span className="eyebrow">TURNING MOVEMENT DIAGRAM</span>
                      <h1>正式轉向圖</h1>
                      <p>
                        正式版：流量表搭配完整跨路口箭線；聚焦版逐一顯示左／直／右目的支線。
                      </p>
                    </div>
                    <div className="head-buttons">
                      <button className="secondary" onClick={exportSvg}>
                        SVG
                      </button>
                      <button className="secondary" onClick={exportPng}>
                        PNG
                      </button>
                      <button
                        className="primary"
                        onClick={function () {
                          exportPdf();
                        }}
                      >
                        PDF
                      </button>
                    </div>
                  </section>
                  <section className="diagram-toolbar panel">
                    <label>
                      資料季度
                      <select
                        value={quarter}
                        onChange={function (e) {
                          setQuarter(e.target.value);
                          setFocusIndex(0);
                        }}
                      >
                        {quarters.map(function (q) {
                          return (
                            <option key={q} value={q}>
                              {q}（
                              {
                                projectRecords.filter(function (record) {
                                  return record.quarter === q;
                                }).length
                              }{" "}
                              路口）
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      路口
                      <select
                        value={recordIntersectionKey(selected)}
                        onChange={function (e) {
                          setSelectedIntersection(e.target.value);
                          setFocusIndex(0);
                        }}
                      >
                        {currentCanonicalRecords.map(function (record) {
                          return (
                            <option
                              key={record.id}
                              value={recordIntersectionKey(record)}
                            >
                              {record.name}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    {selectedIntersectionRecords.length > 1 && (
                      <label>
                        資料別
                        <select
                          value={selected.surveyType || "待設定"}
                          onChange={function (e) {
                            setSelectedSurveyType(e.target.value);
                            setFocusIndex(0);
                          }}
                        >
                          {selectedIntersectionRecords.map(function (record) {
                            return (
                              <option
                                key={record.id}
                                value={record.surveyType || "待設定"}
                              >
                                {record.surveyType || "待設定"}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    )}
                    <label>
                      尖峰
                      <select
                        value={peak}
                        onChange={function (e) {
                          setPeak(e.target.value as PeakKey);
                        }}
                      >
                        <option value="AM">AM Peak</option>
                        <option value="PM">PM Peak</option>
                      </select>
                    </label>
                    <label>
                      版型
                      <select
                        value={diagramStyle}
                        onChange={function (e) {
                          setDiagramStyle(e.target.value as DiagramStyle);
                        }}
                      >
                        <option value="formal">正式版</option>
                        <option value="standard">標準版</option>
                        <option value="simple">簡潔版</option>
                      </select>
                    </label>
                    <label>
                      箭線
                      <select
                        value={arrowMode}
                        onChange={function (e) {
                          setArrowMode(e.target.value as ArrowMode);
                        }}
                      >
                        <option value="all">全部方向</option>
                        <option value="focus">單一方向聚焦</option>
                      </select>
                    </label>
                    {arrowMode === "focus" && (
                      <label>
                        聚焦支線
                        <select
                          value={focusIndex}
                          onChange={function (e) {
                            setFocusIndex(Number(e.target.value));
                          }}
                        >
                          {selected.approaches.map(function (a, i) {
                            return (
                              <option key={a.id} value={i}>
                                {bearingFromAngle(a.angle)}向 · {a.name}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    )}
                    <div className="flow-summary-control">
                      <span>藍框流量顯示</span>
                      <Segmented
                        value={flowSummaryMode}
                        options={[
                          ["both", "駛入＋駛出"],
                          ["inbound", "只顯示駛入"],
                          ["outbound", "只顯示駛出"],
                        ]}
                        onChange={setFlowSummaryMode}
                      />
                    </div>
                    <label>
                      顯示
                      <select
                        value={displayMode}
                        onChange={function (e) {
                          setDisplayMode(e.target.value as DisplayMode);
                        }}
                      >
                        <option value="volume">交通量</option>
                        <option value="percent">百分比</option>
                        <option value="both">PCU/hr＋百分比</option>
                      </select>
                    </label>
                    <label>
                      車種
                      <select
                        value={vehicle}
                        onChange={function (e) {
                          setVehicle(e.target.value as VehicleKey);
                        }}
                      >
                        {[
                          ["all", "全部車種"],
                          ...selectedVehicleIds.map(function (id) {
                            return [id, vehicleLabel(selected, id)];
                          }),
                        ].map(function (entry) {
                          return (
                            <option key={entry[0]} value={entry[0]}>
                              {entry[1]}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  </section>
                  <section className="diagram-layout">
                    <article
                      className="panel diagram-canvas"
                      onPointerDown={startCardDrag}
                      dangerouslySetInnerHTML={{
                        __html: diagramHtml,
                      }}
                    />
                    <aside>
                      <article className="panel summary-card">
                        <span className="eyebrow">SELECTED</span>
                        <h2>{selected.name}</h2>
                        <p>
                          資料季度 {selected.quarter} · 原始站號{" "}
                          {selected.station}
                        </p>
                        <dl>
                          <div>
                            <dt>尖峰時段</dt>
                            <dd>
                              {selected.peaks[peak].start}–
                              {selected.peaks[peak].end}
                            </dd>
                          </div>
                          <div>
                            <dt>路口總流量</dt>
                            <dd>
                              {recordTotal(selected, peak).toLocaleString()}{" "}
                              <small>PCU/hr</small>
                            </dd>
                          </div>
                          <div>
                            <dt>道路支線</dt>
                            <dd>{selected.approaches.length} 叉</dd>
                          </div>
                        </dl>
                        <p className="source-note">
                          本系統只彙整尖峰轉向流量。
                        </p>
                      </article>
                    </aside>
                  </section>
                </>
              )}
            </>
          )}

          {view === "geometry" && (
            <>
              {!selected ? (
                renderNoData("尚無道路支線資料")
              ) : (
                <>
                  <section className="page-head">
                    <div>
                      <span className="eyebrow">GEOMETRY & FLOW</span>
                      <h1>道路與流向幾何管理</h1>
                      <p>
                        道路名稱、支線角度與實體車道組成只用於正確繪製轉向圖，不進行容量相關計算。
                      </p>
                    </div>
                    <div className="head-buttons">
                      <label>
                        圖面季度
                        <select
                          value={quarter}
                          onChange={function (e) {
                            setQuarter(e.target.value);
                          }}
                        >
                          {quarters.map(function (q) {
                            return (
                              <option key={q} value={q}>
                                {q}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <label>
                        切換路口
                        <select
                          value={recordIntersectionKey(selected)}
                          onChange={function (e) {
                            setSelectedIntersection(e.target.value);
                          }}
                        >
                          {currentCanonicalRecords.map(function (record) {
                            return (
                              <option
                                key={record.id}
                                value={recordIntersectionKey(record)}
                              >
                                {record.name}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      {selectedIntersectionRecords.length > 1 && (
                        <label>
                          資料別
                          <select
                            value={selected.surveyType || "待設定"}
                            onChange={function (e) {
                              setSelectedSurveyType(e.target.value);
                            }}
                          >
                            {selectedIntersectionRecords.map(function (record) {
                              return (
                                <option
                                  key={record.id}
                                  value={record.surveyType || "待設定"}
                                >
                                  {record.surveyType || "待設定"}
                                </option>
                              );
                            })}
                          </select>
                        </label>
                      )}
                      <button
                        className="primary"
                        disabled={selected.approaches.length >= 7}
                        onClick={function () {
                          updateSelected(function (record) {
                            const i = record.approaches.length;
                            // 序號不能直接用支線數量：新增到第 5 支、再把中間
                            // 某一支刪掉之後，數量又回到 4，下次新增就再產生一
                            // 次 -A5／人工5，跟既有那一支撞號。撞號的後果是跨季
                            // 度同步會把兩支併成一支。所以往上找第一個沒被用過
                            // 的序號。
                            const usedIds = new Set(
                              record.approaches.map(function (approach) {
                                return approach.id;
                              }),
                            );
                            const usedCodes = new Set(
                              record.approaches.map(function (approach) {
                                return approach.sourceCode;
                              }),
                            );
                            let seq = i + 1;
                            while (
                              usedIds.has(record.station + "-A" + seq) ||
                              usedCodes.has("人工" + seq)
                            )
                              seq += 1;
                            record.approaches.push({
                              ...structuredClone(record.approaches[0]),
                              id: record.station + "-A" + seq,
                              // 每條人工支線要有自己的代碼；全部叫「人工」的話，
                              // 跨季度同步是用代碼比對的，會把好幾條支線併成同一條。
                              sourceCode: "人工" + seq,
                              name: "新增支線 " + seq,
                              // 不要沿用第一條支線的交通量與版面，否則新支線會
                              // 直接頂著別人的數字、圖卡也疊在同一個位置。
                              movements: {
                                AM: {
                                  left: 0,
                                  through: 0,
                                  right: 0,
                                  vehicle: {},
                                  rawVehicleTotal: null,
                                },
                                PM: {
                                  left: 0,
                                  through: 0,
                                  right: 0,
                                  vehicle: {},
                                  rawVehicleTotal: null,
                                },
                              },
                              cardOffset: undefined,
                              cardOffsets: undefined,
                              labelOffset: undefined,
                              cardLayouts: undefined,
                              angle: -90 + (i * 360) / (i + 1),
                              bearing: bearingFromAngle(
                                -90 + (i * 360) / (i + 1),
                              ),
                              lanes: null,
                              laneType: "other",
                              laneComposition: {
                                fast: 0,
                                slow: 0,
                                motorcycle: 0,
                                other: 0,
                              },
                              saturationFlow: null,
                              effectiveGreen: null,
                              cycleLength: null,
                              capacity: null,
                            });
                            return record;
                          });
                        }}
                      >
                        ＋ 新增支線
                      </button>
                    </div>
                  </section>
                  <section className="geometry-layout">
                    <article className="panel">
                      <div className="panel-head">
                        <div>
                          <h2>{selected.name}</h2>
                          <small>
                            資料季度 {selected.quarter} · 原始站號{" "}
                            {selected.station}
                          </small>
                        </div>
                        <span className="status-dot">
                          {selected.approaches.length} 叉
                        </span>
                      </div>
                      <div className="geometry-list geometry-expanded">
                        {selected.approaches.map(function (approach, index) {
                          const sourceCode =
                            approach.sourceCode ||
                            approach.id.match(/-([A-Z0-9]+)$/i)?.[1] ||
                            String(index + 1);
                          return (
                            <div key={approach.id}>
                              <b title={"原始資料代碼 " + sourceCode}>
                                {sourceCode}
                              </b>
                              <label>
                                道路支線
                                <input
                                  value={approach.name}
                                  onChange={function (e) {
                                    updateSelectedGeometry(function (record) {
                                      record.approaches[index].name =
                                        e.target.value;
                                      return record;
                                    });
                                  }}
                                />
                                <small>
                                  原始資料代碼：{sourceCode}
                                  ；修改名稱或角度不會改變資料綁定
                                </small>
                              </label>
                              <label>
                                方位
                                <output className="derived-bearing">
                                  {bearingFromAngle(approach.angle)}（自動）
                                </output>
                              </label>
                              <label>
                                角度（°）
                                <input
                                  type="number"
                                  value={approach.angle}
                                  onChange={function (e) {
                                    updateSelectedGeometry(function (record) {
                                      record.approaches[index].angle = Number(
                                        e.target.value,
                                      );
                                      record.approaches[index].bearing =
                                        bearingFromAngle(
                                          record.approaches[index].angle,
                                        );
                                      return syncRouteGeometry(record);
                                    });
                                  }}
                                />
                                <small>
                                  畫面上方 −90、右方 0、下方 90、左方 180
                                </small>
                              </label>
                              <div className="card-position-field">
                                <span>數據卡位置</span>
                                <span className="card-position-state">
                                  {adjustedLayoutModes(approach).length
                                    ? "已調整：" +
                                      adjustedLayoutModes(approach).join("、")
                                    : hasManualLayout(approach)
                                      ? "已手動調整"
                                      : "自動排版"}
                                </span>
                                <button
                                  className="link-button"
                                  disabled={!hasManualLayout(approach)}
                                  onClick={function () {
                                    updateSelectedGeometry(function (record) {
                                      record.approaches[index].cardOffset =
                                        undefined;
                                      record.approaches[index].cardOffsets =
                                        undefined;
                                      record.approaches[index].labelOffset =
                                        undefined;
                                      record.approaches[index].cardLayouts =
                                        undefined;
                                      return record;
                                    });
                                  }}
                                >
                                  還原這條支線
                                </button>
                              </div>
                              <button
                                className="icon-danger"
                                disabled={selected.approaches.length <= 3}
                                onClick={function () {
                                  // 刪掉支線之後，原本以這支為起點或終點的 OD
                                  // 路徑如果留著，就會變成指向不存在的支線的孤
                                  // 兒資料：合計仍算得到數字，但駛入總和與駛出
                                  // 總和從此對不起來。所以要一併清掉，並先讓使
                                  // 用者知道會連帶損失多少筆流量。
                                  const target = selected.approaches[index];
                                  const orphans = (
                                    selected.routes || []
                                  ).filter(function (route) {
                                    return (
                                      route.fromApproachId === target.id ||
                                      route.toApproachId === target.id
                                    );
                                  });
                                  if (
                                    orphans.length &&
                                    !confirm(
                                      "刪除支線「" +
                                        (target.name || target.sourceCode) +
                                        "」會一併刪除 " +
                                        orphans.length +
                                        " 筆與它相連的轉向流量，且無法復原。確定要刪除嗎？",
                                    )
                                  )
                                    return;
                                  updateSelected(function (record) {
                                    const removed = record.approaches.splice(
                                      index,
                                      1,
                                    )[0];
                                    if (removed)
                                      record.routes = (
                                        record.routes || []
                                      ).filter(function (route) {
                                        return (
                                          route.fromApproachId !== removed.id &&
                                          route.toApproachId !== removed.id
                                        );
                                      });
                                    /*
                                     * 一定要重算 approaches 的左／直／右。
                                     *
                                     * 刪掉孤兒 OD 之後，其他支線的 movements
                                     * 裡還留著「開往被刪支線」的那些量。
                                     * recordTotal() 讀的正是 movements，所以
                                     * 儀表板、排名、轉向圖與每一張 Excel 都會
                                     * 多出一筆憑空的流量（實測核對差值
                                     * 1,095.6 PCU/hr），而資料品質檢查卻報
                                     *「沒有異常」。
                                     */
                                    return syncRouteTotals(record);
                                  });
                                }}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <div className="geometry-tools">
                        <button
                          className={showGeometryCardPreview ? "primary" : ""}
                          onClick={function () {
                            setShowGeometryCardPreview(function (value) {
                              return !value;
                            });
                          }}
                        >
                          {showGeometryCardPreview
                            ? "關閉圖卡排版預覽"
                            : "開啟圖卡排版預覽"}
                        </button>
                        <button
                          onClick={function () {
                            updateSelectedGeometry(function (record) {
                              record.approaches.forEach(function (approach) {
                                approach.cardOffset = undefined;
                                approach.cardOffsets = undefined;
                                approach.labelOffset = undefined;
                                approach.cardLayouts = undefined;
                              });
                              return record;
                            });
                          }}
                        >
                          重設所有圖卡位置（全部模式）
                        </button>
                        <span>
                          圖卡與路口標籤都可直接用滑鼠拖曳，放開才會存檔；
                          <b>
                            只看駛入、只看駛出、駛入＋駛出三種畫面各自保存版面
                          </b>
                          ，調整後會同步至其他季度。
                        </span>
                      </div>
                      {diagramCollisionWarnings(selected, flowSummaryMode, diagramStyle)
                        .length > 0 && (
                        <div className="collision-warning">
                          <b>匯出前排版預警</b>
                          {diagramCollisionWarnings(
                            selected,
                            flowSummaryMode,
                            diagramStyle,
                          ).map(function (warning) {
                            return <p key={warning}>{warning}</p>;
                          })}
                        </div>
                      )}
                      {selected.routes?.length ? (
                        <details className="route-mapping">
                          <summary>
                            檢查起點 → 終點流向（{selected.routes.length} 組）
                          </summary>
                          <p>
                            七岔路依原始檔的 A→B、A→C…建立。調整 A～G
                            支線角度不會改變原始起訖流量。新多岔路先由系統依幾何提出左／直／右建議，分類方式會列在此處供確認。
                          </p>
                          {selected.movementRule === "reference-calculation" ? (
                            <p className="inline-note">
                              本路口（{selected.station} {selected.name}）的名稱與七支支線代碼
                              A～G 與內建的參考計算檔相符，因此套用該檔的既有分法（D
                              支線沒有直行流向），<b>而不是依圖面角度推算</b>。
                              調整圖面角度不會覆蓋此分類；若這不是您要的分法，
                              請在下方逐條改成正確的轉向別——改過之後會轉為「人工確認分類」，
                              日後重新整理也不會再被參考表改回去。
                            </p>
                          ) : selected.movementRule === "manual" ? (
                            <p className="inline-note">
                              本路口採人工確認分類；調整圖面角度不會覆蓋。
                            </p>
                          ) : (
                            <p className="inline-note">
                              本路口目前採系統幾何建議，請逐列確認後再使用正式成果。
                            </p>
                          )}
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>起點</th>
                                  <th>終點</th>
                                  <th>轉向分類</th>
                                  <th>AM</th>
                                  <th>PM</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selected.routes.map(
                                  function (route, routeIndex) {
                                    const from = selected.approaches.find(
                                      function (item) {
                                        return item.id === route.fromApproachId;
                                      },
                                    );
                                    return (
                                      <tr key={route.id}>
                                        <td>{from?.name}</td>
                                        <td>
                                          <select
                                            value={route.toApproachId}
                                            onChange={function (e) {
                                              updateSelectedGeometry(
                                                function (record) {
                                                  if (record.routes)
                                                    record.routes[
                                                      routeIndex
                                                    ].toApproachId =
                                                      e.target.value;
                                                  return syncRouteGeometry(
                                                    record,
                                                  );
                                                },
                                              );
                                            }}
                                          >
                                            {selected.approaches
                                              .filter(function (item) {
                                                return (
                                                  item.id !==
                                                  route.fromApproachId
                                                );
                                              })
                                              .map(function (item) {
                                                return (
                                                  <option
                                                    key={item.id}
                                                    value={item.id}
                                                  >
                                                    {item.name}
                                                  </option>
                                                );
                                              })}
                                          </select>
                                        </td>
                                        <td>
                                          <select
                                            value={route.movement}
                                            onChange={function (e) {
                                              updateSelectedGeometry(
                                                function (record) {
                                                  if (record.routes)
                                                    record.routes[
                                                      routeIndex
                                                    ].movement = e.target
                                                      .value as
                                                      | "left"
                                                      | "through"
                                                      | "right";
                                                  record.movementRule =
                                                    "manual";
                                                  return syncRouteTotals(
                                                    record,
                                                  );
                                                },
                                              );
                                            }}
                                          >
                                            <option value="left">左轉</option>
                                            <option value="through">
                                              直行
                                            </option>
                                            <option value="right">右轉</option>
                                          </select>
                                        </td>
                                        <td>
                                          {route.volumes.AM.pcu.toLocaleString()}{" "}
                                          PCU/hr
                                        </td>
                                        <td>
                                          {route.volumes.PM.pcu.toLocaleString()}{" "}
                                          PCU/hr
                                        </td>
                                      </tr>
                                    );
                                  },
                                )}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      ) : null}
                    </article>
                    <article
                      className="panel geometry-preview"
                      dangerouslySetInnerHTML={{
                        __html: geometrySchematicHtml,
                      }}
                    />
                  </section>
                  {showGeometryCardPreview && (
                    <section className="panel geometry-card-preview">
                      <div className="geometry-card-preview-head">
                        <div>
                          <span className="eyebrow">CARD LAYOUT PREVIEW</span>
                          <h2>交通量圖卡排版預覽</h2>
                          <p>
                            拖曳圖中的交通量數據框即可避開道路、路名或其他圖卡；不會改變任何交通量或流向。
                          </p>
                        </div>
                        <div className="geometry-preview-switches">
                          <button
                            className={
                              flowSummaryMode === "inbound" ? "active" : ""
                            }
                            onClick={function () {
                              setFlowSummaryMode("inbound");
                            }}
                          >
                            只看駛入
                          </button>
                          <button
                            className={
                              flowSummaryMode === "outbound" ? "active" : ""
                            }
                            onClick={function () {
                              setFlowSummaryMode("outbound");
                            }}
                          >
                            只看駛出
                          </button>
                          <button
                            className={
                              flowSummaryMode === "both" ? "active" : ""
                            }
                            onClick={function () {
                              setFlowSummaryMode("both");
                            }}
                          >
                            駛入＋駛出
                          </button>
                        </div>
                      </div>
                      <div
                        className="geometry-card-preview-canvas"
                        onPointerDown={startCardDrag}
                        dangerouslySetInnerHTML={{
                          __html: geometryCardPreviewHtml,
                        }}
                      />
                    </section>
                  )}
                </>
              )}
            </>
          )}

          {view === "compare" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">CROSS-PROJECT COMPARISON</span>
                  <h1>跨計畫與多路口比較</h1>
                  <p>
                    最多選 4 個計畫；所有摘要卡與排行均使用右上方所選季度，
                    尖峰總量單位為 PCU/hr。
                  </p>
                </div>
              </section>
              <section className="panel project-checks">
                <label>
                  比較季度
                  <select
                    value={quarter}
                    onChange={function (e) {
                      setQuarter(e.target.value);
                    }}
                  >
                    {quarters.map(function (q) {
                      return (
                        <option key={q} value={q}>
                          {q}
                        </option>
                      );
                    })}
                  </select>
                </label>
                {projects.map(function (project) {
                  return (
                    <label key={project.id}>
                      <input
                        type="checkbox"
                        checked={compareProjects.includes(project.id)}
                        onChange={function (e) {
                          if (e.target.checked && compareProjects.length < 4)
                            setCompareProjects([
                              ...compareProjects,
                              project.id,
                            ]);
                          else if (!e.target.checked)
                            setCompareProjects(
                              compareProjects.filter(function (id) {
                                return id !== project.id;
                              }),
                            );
                        }}
                      />
                      {project.code} · {project.name}
                    </label>
                  );
                })}
              </section>
              <section className="compare-grid">
                {projects
                  .filter(function (project) {
                    return compareProjects.includes(project.id);
                  })
                  .map(function (project) {
                    const rows = records.filter(function (record) {
                      return record.projectId === project.id;
                    });
                    const selectedQuarterRows = rows.filter(function (r) {
                      return r.quarter === quarter;
                    });
                    /*
                     * 這裡**不可以**把各路口的尖峰流量相加。
                     *
                     * PCU/hr 是「某一個特定小時」的流率，而每個路口的尖峰小時
                     * 是各自搜出來的（A 路口 07:15–08:15、B 路口 08:00–09:00）。
                     * 相加得到的數字不對應任何一個真實存在的小時，卻會被讀成
                     * 「這個計畫的尖峰總量」。同一頁下方的比較表就是正確做法
                     * ——逐筆列出各自的尖峰時段與總量。
                     * 所以這張卡改成寫「最高的那一個路口」與「平均」。
                     */
                    const peakStat = function (peak: PeakKey) {
                      const values = selectedQuarterRows.map(function (r) {
                        return { value: recordTotal(r, peak), record: r };
                      });
                      if (!values.length) return null;
                      const top = values.reduce(function (best, item) {
                        return item.value > best.value ? item : best;
                      });
                      const mean =
                        values.reduce(function (sum, item) {
                          return sum + item.value;
                        }, 0) / values.length;
                      return { top, mean };
                    };
                    const am = peakStat("AM");
                    const pm = peakStat("PM");
                    return (
                      <article className="panel compare-card" key={project.id}>
                        <span>{project.code}</span>
                        <h2>{project.name}</h2>
                        <strong>
                          {quarter || "尚未選擇季度"}
                          {quarter && !selectedQuarterRows.length
                            ? " · 該季無資料"
                            : ""}
                        </strong>
                        <dl>
                          <div>
                            <dt>路口數</dt>
                            <dd>{selectedQuarterRows.length} 處</dd>
                          </div>
                          <div>
                            <dt>AM Peak 最高路口</dt>
                            <dd>
                              {am
                                ? am.top.value.toLocaleString() +
                                  " PCU/hr（" +
                                  am.top.record.station +
                                  "）"
                                : "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>AM Peak 平均</dt>
                            <dd>
                              {am
                                ? am.mean.toLocaleString(undefined, {
                                    maximumFractionDigits: 1,
                                  }) + " PCU/hr"
                                : "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>PM Peak 最高路口</dt>
                            <dd>
                              {pm
                                ? pm.top.value.toLocaleString() +
                                  " PCU/hr（" +
                                  pm.top.record.station +
                                  "）"
                                : "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>PM Peak 平均</dt>
                            <dd>
                              {pm
                                ? pm.mean.toLocaleString(undefined, {
                                    maximumFractionDigits: 1,
                                  }) + " PCU/hr"
                                : "—"}
                            </dd>
                          </div>
                        </dl>
                        <p className="compare-note">
                          各路口的尖峰小時不一定相同，PCU/hr 是「某一個特定小時」
                          的流率，相加不對應任何一個真實存在的小時，因此這裡
                          只做比較與平均，不做加總。
                        </p>
                        <button
                          className="secondary full"
                          onClick={function () {
                            setActiveProjectId(project.id);
                            setView("dashboard");
                          }}
                        >
                          開啟計畫
                        </button>
                      </article>
                    );
                  })}
              </section>
              {!!compareProjects.length && (
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">INTERSECTION COMPARISON</span>
                      <h2>{quarter || "尚未選擇季度"} 跨計畫路口尖峰比較</h2>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>計畫</th>
                          <th>站號／路口</th>
                          <th>AM 尖峰時段</th>
                          <th>AM 尖峰轉向總量（PCU/hr）</th>
                          <th>PM 尖峰時段</th>
                          <th>PM 尖峰轉向總量（PCU/hr）</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records
                          .filter(function (record) {
                            return (
                              compareProjects.includes(
                                record.projectId || "",
                              ) && record.quarter === quarter
                            );
                          })
                          .sort(function (a, b) {
                            return recordTotal(b, peak) - recordTotal(a, peak);
                          })
                          .map(function (record) {
                            const project = projects.find(function (item) {
                              return item.id === record.projectId;
                            });
                            return (
                              <tr key={record.id}>
                                <td>
                                  {project?.code || "—"} ·{" "}
                                  {project?.name || "—"}
                                </td>
                                <td>
                                  <strong>{record.station}</strong>
                                  <br />
                                  <small>{record.name}</small>
                                </td>
                                <td>
                                  {record.peaks.AM.start}–{record.peaks.AM.end}
                                </td>
                                <td>
                                  {recordTotal(record, "AM").toLocaleString()}
                                </td>
                                <td>
                                  {record.peaks.PM.start}–{record.peaks.PM.end}
                                </td>
                                <td>
                                  {recordTotal(record, "PM").toLocaleString()}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  <div className="compare-flow-section">
                    <div className="compare-flow-heading">
                      <div>
                        <span className="eyebrow">BRANCH FLOW DETAIL</span>
                        <h3>各支線駛入／駛出尖峰流量</h3>
                      </div>
                      <p>
                        「駛出路口X」為車流由支線 X 駛出、開進中央路口（以 X 為起點）；「駛入路口X」為車流穿越中央路口後駛入支線 X（以 X 為終點）。各支線駛出或駛入合計皆應等於路口尖峰轉向總量，單位均為
                        PCU/hr。
                      </p>
                    </div>
                    <div className="compare-flow-grid">
                      {records
                        .filter(function (record) {
                          return (
                            compareProjects.includes(record.projectId || "") &&
                            record.quarter === quarter
                          );
                        })
                        .sort(function (a, b) {
                          return recordTotal(b, peak) - recordTotal(a, peak);
                        })
                        .map(function (record) {
                          const project = projects.find(function (item) {
                            return item.id === record.projectId;
                          });
                          const amFlows = branchPeakFlows(record, "AM");
                          const pmFlows = branchPeakFlows(record, "PM");
                          return (
                            <article
                              className="compare-flow-card"
                              key={record.id}
                            >
                              <header>
                                <div>
                                  <span>
                                    {project?.code || "—"} · {record.station}
                                  </span>
                                  <h3>{record.name}</h3>
                                </div>
                                <strong>
                                  AM{" "}
                                  {recordTotal(record, "AM").toLocaleString()}{" "}
                                  ／ PM{" "}
                                  {recordTotal(record, "PM").toLocaleString()}{" "}
                                  PCU/hr
                                </strong>
                              </header>
                              <div className="table-scroll">
                                <table className="branch-flow-table">
                                  <thead>
                                    <tr>
                                      <th rowSpan={2}>支線</th>
                                      <th colSpan={2}>AM Peak（PCU/hr）</th>
                                      <th colSpan={2}>PM Peak（PCU/hr）</th>
                                    </tr>
                                    <tr>
                                      <th>駛出路口</th>
                                      <th>駛入路口</th>
                                      <th>駛出路口</th>
                                      <th>駛入路口</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {record.approaches.map(
                                      function (approach, index) {
                                        return (
                                          <tr key={approach.id}>
                                            <td>
                                              <b>
                                                {approach.sourceCode ||
                                                  String.fromCharCode(
                                                    65 + index,
                                                  )}
                                              </b>
                                              <small>{approach.name}</small>
                                            </td>
                                            <td>
                                              {amFlows[
                                                index
                                              ].enteringIntersection.toLocaleString()}
                                            </td>
                                            <td>
                                              {amFlows[
                                                index
                                              ].leavingIntersection.toLocaleString()}
                                            </td>
                                            <td>
                                              {pmFlows[
                                                index
                                              ].enteringIntersection.toLocaleString()}
                                            </td>
                                            <td>
                                              {pmFlows[
                                                index
                                              ].leavingIntersection.toLocaleString()}
                                            </td>
                                          </tr>
                                        );
                                      },
                                    )}
                                  </tbody>
                                  <tfoot>
                                    <tr>
                                      <th>支線合計</th>
                                      <th>
                                        {amFlows
                                          .reduce(function (sum, item) {
                                            return (
                                              sum + item.enteringIntersection
                                            );
                                          }, 0)
                                          .toLocaleString()}
                                      </th>
                                      <th>
                                        {amFlows
                                          .reduce(function (sum, item) {
                                            return (
                                              sum + item.leavingIntersection
                                            );
                                          }, 0)
                                          .toLocaleString()}
                                      </th>
                                      <th>
                                        {pmFlows
                                          .reduce(function (sum, item) {
                                            return (
                                              sum + item.enteringIntersection
                                            );
                                          }, 0)
                                          .toLocaleString()}
                                      </th>
                                      <th>
                                        {pmFlows
                                          .reduce(function (sum, item) {
                                            return (
                                              sum + item.leavingIntersection
                                            );
                                          }, 0)
                                          .toLocaleString()}
                                      </th>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </article>
                          );
                        })}
                    </div>
                  </div>
                </section>
              )}
              {!compareProjects.length && (
                <Empty title="請選擇比較計畫" text="可同時勾選 2–4 個計畫。" />
              )}
              {activeProject && current.length > 0 && (
                <>
                  <section className="page-head compare-subhead">
                    <div>
                      <h2>
                        {activeProject.name} · {quarter} 多路口排名
                      </h2>
                    </div>
                    <Segmented
                      value={peak}
                      options={[
                        ["AM", "AM"],
                        ["PM", "PM"],
                      ]}
                      onChange={setPeak}
                    />
                  </section>
                  <section className="compare-grid">
                    {ranked.map(function (record, index) {
                      return (
                        <article className="panel compare-card" key={record.id}>
                          <div className="compare-rank">#{index + 1}</div>
                          <span>{record.station}</span>
                          <h2>{record.name}</h2>
                          <strong>
                            {recordTotal(record, peak).toLocaleString()}{" "}
                            <small>PCU/hr</small>
                          </strong>
                          <div className="mini-bar">
                            <i
                              style={{
                                width:
                                  (recordTotal(record, peak) / maxRank) * 100 +
                                  "%",
                              }}
                            />
                          </div>
                        </article>
                      );
                    })}
                  </section>
                </>
              )}
            </>
          )}

          {view === "trend" && (
            <TrendView
              records={projectRecords}
              peak={peak}
              setPeak={setPeak}
              notify={notify}
              pendingCount={pendingSurveyTypeRecords().length}
              assignPendingSurveyType={assignPendingSurveyType}
            />
          )}

          {view === "audit" && (
            <AuditWorkbench
              record={selected}
              peak={peak}
              setPeak={setPeak}
              quarter={quarter}
              quarterRecords={current}
              lockQuarter={lockCurrentQuarter}
              unlockQuarter={unlockCurrentQuarter}
              revisions={recordRevisions.filter(function (revision) {
                return revision.recordId === selected?.id;
              })}
              setReview={function (status, note) {
                if (!selected) return;
                setRecords(
                  records.map(function (record) {
                    return record.id === selected.id
                      ? {
                          ...record,
                          review: {
                            status,
                            note,
                            updatedAt: new Date().toISOString(),
                          },
                        }
                      : record;
                  }),
                );
              }}
              intersections={currentCanonicalRecords.map(function (record) {
                return {
                  key: recordIntersectionKey(record),
                  label: record.station + "　" + record.name,
                };
              })}
              selectedIntersection={selectedIntersection}
              setSelectedIntersection={setSelectedIntersection}
              surveyTypes={Array.from(
                new Set(
                  selectedIntersectionRecords.map(function (record) {
                    return record.surveyType || "待設定";
                  }),
                ),
              )}
              selectedSurveyType={selected?.surveyType || "待設定"}
              setSelectedSurveyType={setSelectedSurveyType}
              pendingSurveyTypeCount={pendingSurveyTypeRecords().length}
              pendingSurveyTypeLabels={pendingSurveyTypeRecords().map(
                function (record) {
                  return record.quarter + "　" + record.station;
                },
              )}
              assignPendingSurveyType={assignPendingSurveyType}
              setSurveyType={function (value) {
                if (!selected) return;
                saveRevision(selected, "更改資料別前自動保存");
                setRecords(
                  records.map(function (record) {
                    return record.id === selected.id
                      ? { ...record, surveyType: value }
                      : record;
                  }),
                );
                notify("資料別已更新為「" + value + "」。");
              }}
              restoreRevision={function (revision) {
                if (
                  !selected ||
                  !confirm("確定還原此版本？目前版本也會先保存為還原點。")
                )
                  return;
                saveRevision(selected, "還原前自動保存");
                setRecords(
                  records.map(function (record) {
                    return record.id === selected.id
                      ? {
                          ...structuredClone(revision.snapshot),
                          resultLock: undefined,
                        }
                      : record;
                  }),
                );
                notify("已還原指定版本，請重新核對後再鎖定。");
              }}
            />
          )}

          {view === "advanced" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">TURNING ANALYSIS</span>
                  <h1>轉向進階分析</h1>
                  <p>
                    以已確認的原始 OD 流向計算矩陣、各支線駛入／駛出平衡與連續
                    60 分鐘尖峰候選；所有流量均標示 PCU/hr。
                  </p>
                </div>
                {selected && (
                  <button
                    className="primary"
                    onClick={function () {
                      exportAdvancedExcel(selected);
                    }}
                  >
                    下載核對 Excel
                  </button>
                )}
              </section>
              {!selected
                ? renderNoData("尚無可分析路口")
                : (() => {
                    const matrix = odMatrix(selected, peak);
                    const balance = branchBalance(selected, peak);
                    const sensitivity = peakSensitivity(selected);
                    const conservation = conservationCheck(selected, peak);
                    return (
                      <>
                        <section className="panel advanced-controls">
                          <Segmented
                            value={peak}
                            options={[
                              ["AM", "AM Peak"],
                              ["PM", "PM Peak"],
                            ]}
                            onChange={setPeak}
                          />
                          <strong>
                            {selected.station} · {selected.name}
                          </strong>
                          <span
                            className={
                              conservation.valid ? "check-ok" : "check-warn"
                            }
                          >
                            守恆差值 {conservation.difference.toLocaleString()}{" "}
                            PCU/hr · {conservation.valid ? "一致" : "需核對"}
                          </span>
                        </section>
                        <section className="advanced-grid">
                          <article className="panel advanced-wide">
                            <div className="panel-head">
                              <div>
                                <span className="eyebrow">OD MATRIX</span>
                                <h2>來源支線 → 目的支線</h2>
                              </div>
                              <span className="status-dot">PCU/hr</span>
                            </div>
                            <div className="table-scroll">
                              <table className="od-table">
                                <thead>
                                  <tr>
                                    <th>來源＼駛入</th>
                                    {selected.approaches.map(function (a) {
                                      return <th key={a.id}>{a.name}</th>;
                                    })}
                                    <th>駛出合計</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {matrix.map(function (row) {
                                    const total = row.values.reduce(function (
                                      sum,
                                      value,
                                    ) {
                                      return sum + value;
                                    }, 0);
                                    return (
                                      <tr key={row.originId}>
                                        <th>{row.origin}</th>
                                        {row.values.map(
                                          function (value, index) {
                                            return (
                                              <td
                                                key={
                                                  selected.approaches[index].id
                                                }
                                              >
                                                {value.toLocaleString()}
                                              </td>
                                            );
                                          },
                                        )}
                                        <td>
                                          <b>{total.toLocaleString()}</b>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </article>
                          <article className="panel">
                            <div className="panel-head">
                              <div>
                                <span className="eyebrow">BRANCH BALANCE</span>
                                <h2>各支線流量平衡</h2>
                              </div>
                              <span className="status-dot">PCU/hr</span>
                            </div>
                            <div className="table-scroll">
                              <table>
                                <thead>
                                  <tr>
                                    <th>支線</th>
                                    <th>駛入</th>
                                    <th>駛出</th>
                                    <th>差值</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {balance.map(function (item) {
                                    return (
                                      <tr key={item.id}>
                                        <td>{item.name}</td>
                                        <td>{item.inbound.toLocaleString()}</td>
                                        <td>
                                          {item.outbound.toLocaleString()}
                                        </td>
                                        <td>
                                          {item.difference.toLocaleString()}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            <p className="inline-note">
                              差值是該支線駛入與駛出的方向不平衡，不代表資料錯誤；整個路口的
                              OD 總量才應守恆。
                            </p>
                          </article>
                          <article className="panel">
                            <div className="panel-head">
                              <div>
                                <span className="eyebrow">
                                  PEAK SENSITIVITY
                                </span>
                                <h2>連續 60 分鐘候選排行</h2>
                              </div>
                              <span className="status-dot">PCU/hr</span>
                            </div>
                            {sensitivity.length ? (
                              <div className="table-scroll">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>#</th>
                                      <th>時段</th>
                                      <th>交通量</th>
                                      <th>實際車輛</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sensitivity.map(function (item) {
                                      return (
                                        <tr key={item.start}>
                                          <td>{item.rank}</td>
                                          <td>
                                            {formatMinutes(item.start)}–
                                            {formatMinutes(item.end)}
                                          </td>
                                          <td>
                                            {item.pcu.toLocaleString()} PCU/hr
                                          </td>
                                          <td>
                                            {item.vehicles.toLocaleString()}{" "}
                                            輛/hr
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p>
                                此筆為舊版備份，未保存逐時段來源；重新匯入後即可比較相鄰與次高尖峰。
                              </p>
                            )}
                          </article>
                        </section>
                      </>
                    );
                  })()}
            </>
          )}

          {view === "quality" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">DATA QUALITY</span>
                  <h1>資料品質檢查</h1>
                  <p>
                    只檢查可判定的缺值、總數一致性、尖峰時段與車種統計；實際調查到的方向流量高低不列為異常。
                  </p>
                </div>
                <button className="primary" onClick={exportQualityExcel}>
                  下載季度品質 Excel
                </button>
              </section>
              {!projectRecords.length ? (
                renderNoData("尚無可檢查資料")
              ) : (
                <>
                  <section className="quality-grid">
                    {(
                      [
                        "缺值",
                        "總數不一致",
                        "尖峰時段異常",
                        "車種統計異常",
                      ] as const
                    ).map(function (category) {
                      return (
                        <article className="panel" key={category}>
                          <span>{category}</span>
                          <strong>
                            {
                              currentIssues.filter(function (issue) {
                                return issue.category === category;
                              }).length
                            }{" "}
                            項
                          </strong>
                          <small>
                            {category === "車種統計異常"
                              ? "僅比較同範圍的實際車輛數（輛/hr）"
                              : "依匯入規則即時檢查"}
                          </small>
                        </article>
                      );
                    })}
                  </section>
                  <section className="quality-layout">
                    <article className="panel">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">ISSUE LIST</span>
                          <h2>{quarter} 檢查結果</h2>
                        </div>
                        <span className="status-dot">
                          {currentIssues.length} 項
                        </span>
                      </div>
                      {currentIssues.length ? (
                        <div className="issue-list">
                          {currentIssues.map(function (issue) {
                            return (
                              <div
                                className={
                                  selectedIssueId === issue.id ? "selected" : ""
                                }
                                key={issue.id}
                              >
                                <span
                                  className={"severity " + issue.severity}
                                />
                                <b>{issue.category}</b>
                                <strong>{issue.station}</strong>
                                <p>{issue.message}</p>
                                <button
                                  onClick={function () {
                                    setSelectedIssueId(issue.id);
                                  }}
                                >
                                  查看原因
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <Empty
                          title="本季沒有異常"
                          text="目前規則未發現需核對項目。"
                        />
                      )}
                    </article>
                    <aside className="panel issue-detail">
                      {selectedIssue ? (
                        <>
                          <span className="eyebrow">WHY FLAGGED</span>
                          <h2>異常原因與計算方式</h2>
                          <b>
                            {selectedIssue.category} · {selectedIssue.station}
                          </b>
                          <p>{selectedIssue.message}</p>
                          {selectedIssue.details ? (
                            <dl>
                              <div>
                                <dt>左直右實際車輛合計</dt>
                                <dd>
                                  {selectedIssue.details.turningVehicleTotal.toLocaleString()}{" "}
                                  {selectedIssue.details.unit}
                                </dd>
                              </div>
                              <div>
                                <dt>四車種分類合計</dt>
                                <dd>
                                  {selectedIssue.details.classifiedVehicleTotal.toLocaleString()}{" "}
                                  {selectedIssue.details.unit}
                                </dd>
                              </div>
                              <div>
                                <dt>差異</dt>
                                <dd>
                                  {selectedIssue.details.difference.toLocaleString()}{" "}
                                  {selectedIssue.details.unit}
                                </dd>
                              </div>
                            </dl>
                          ) : (
                            <div className="issue-explain">
                              此項不是車種加總差異，請依訊息核對原始欄位。
                            </div>
                          )}
                          <div className="issue-explain">
                            <b>判定前提</b>
                            <p>
                              {selectedIssue.details?.explanation ||
                                "系統依同一季度路口的資料品質規則判定。"}
                            </p>
                            <p>
                              若一邊是
                              PCU/hr、另一邊是輛/hr，系統不會比較，也不會報車種統計異常。
                            </p>
                          </div>
                          <button
                            className="primary full"
                            onClick={function () {
                              setView("import");
                            }}
                          >
                            重新匯入並核對欄位
                          </button>
                        </>
                      ) : (
                        <Empty
                          title="選擇一筆異常"
                          text="點「查看原因」可看到數值、單位、公式與處理方向。"
                        />
                      )}
                    </aside>
                  </section>
                </>
              )}
            </>
          )}

          {view === "names" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">NAME NORMALIZATION</span>
                  <h1>路口名稱管理</h1>
                  <p>
                    排除全半形、括號、站號、版本字尾與重複標點，保留道路真名；人工映射優先。
                  </p>
                </div>
              </section>
              {!canonicalRecords.length ? (
                renderNoData("尚無路口名稱")
              ) : (
                <section className="panel">
                  <div className="name-help">
                    <b>只管理「標準路口」，不是每季重改一次</b>
                    <p>
                      站號、歷次原始檔名與別名會留在系統內部協助辨識，不在此頁逐筆展開。能唯一判斷時自動新增或併入；只有無法判斷時，匯入預覽才會請您選擇「新增、併入或取消」。
                    </p>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>標準路口</th>
                          <th>標準名稱（一次修改、各季同步）</th>
                        </tr>
                      </thead>
                      <tbody>
                        {canonicalRecords.map(function (record) {
                          const key = recordIntersectionKey(record);
                          /*
                           * React key 不能用名稱衍生的 key。
                           * recordIntersectionKey 是從名稱算出來的，改名時
                           * 第一個字一打進去 key 就變了，React 會把整個 <tr>
                           * 拆掉重建——輸入框失焦，後面的字全部打不進去。
                           * 改用不會變的 intersectionId／id。
                           */
                          return (
                            <tr key={record.intersectionId || record.id}>
                              <td>{key}</td>
                              <td>
                                <input
                                  value={record.name}
                                  onFocus={function (e) {
                                    /*
                                     * 鎖定授權與還原點只做一次，在開始編輯時。
                                     * 舊版放在 onChange，等於每打一個字就跳一次
                                     * 確認視窗，鎖定的路口根本改不了名字。
                                     */
                                    const targets = records.filter(
                                      function (item) {
                                        return (
                                          item.projectId === record.projectId &&
                                          recordIntersectionKey(item) === key
                                        );
                                      },
                                    );
                                    if (
                                      !targets.some(function (item) {
                                        return Boolean(item.resultLock);
                                      })
                                    )
                                      return;
                                    if (
                                      !authorizeLockedChange(
                                        targets,
                                        "路口名稱修改",
                                      )
                                    ) {
                                      e.currentTarget.blur();
                                      return;
                                    }
                                    targets.forEach(function (item) {
                                      saveRevision(item, "路口名稱修改前");
                                    });
                                  }}
                                  onChange={function (e) {
                                    const value = e.target.value;
                                    // 只改「這個計畫」裡的同一個路口。這頁列出
                                    // 的本來就只有目前計畫的路口，但改名時是用
                                    // 路口鍵值比對全部記錄，別的計畫只要有同名
                                    // 路口就會一起被改掉，使用者在這個計畫改名，
                                    // 另一個計畫的名稱卻無聲跟著變。
                                    const inProject = function (
                                      item: TrafficRecord,
                                    ) {
                                      return (
                                        item.projectId === record.projectId &&
                                        recordIntersectionKey(item) === key
                                      );
                                    };
                                    setRecords(function (all) {
                                      return all.map(function (item) {
                                        return inProject(item)
                                          ? {
                                              ...item,
                                              name: value,
                                              nameEdited: true,
                                              resultLock: undefined,
                                            }
                                          : item;
                                      });
                                    });
                                  }}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}

          {view === "conclusion" && (
            <ConclusionStudio
              records={projectRecords}
              projectName={activeProject?.name || "未命名計畫"}
              templates={conclusionTemplates}
              setTemplates={setConclusionTemplates}
              notify={notify}
              condition={conclusionCondition}
              setCondition={setConclusionCondition}
              draft={conclusionDraft}
              setDraft={setConclusionDraft}
              edited={conclusionEdited}
              setEdited={setConclusionEdited}
              templateName={conclusionTemplateName}
              setTemplateName={setConclusionTemplateName}
            />
          )}

          {view === "reports" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">REPORT CENTER</span>
                  <h1>報表與批次輸出</h1>
                  <p>
                    Excel 保留可編輯數值、清楚欄名與單位；正式轉向圖輸出
                    PNG、SVG 或多頁 PDF。
                  </p>
                </div>
              </section>
              {selected && (
                <section
                  className={
                    "panel export-preflight " +
                    (diagramCollisionWarnings(selected, flowSummaryMode, diagramStyle).length
                      ? "has-warning"
                      : "ready")
                  }
                >
                  <div>
                    <span className="eyebrow">EXPORT PREFLIGHT</span>
                    <h2>匯出前檢查 · {selected.station}</h2>
                    <p>
                      {diagramCollisionWarnings(selected, flowSummaryMode, diagramStyle)
                        .length
                        ? diagramCollisionWarnings(
                            selected,
                            flowSummaryMode,
                            diagramStyle,
                          ).join("；") + "。請先到道路與流向管理拖曳圖卡位置。"
                        : "圖卡位置未偵測到重疊；日期、尖峰時段與單位會一併輸出。"}
                    </p>
                  </div>
                  <strong>
                    {diagramCollisionWarnings(selected, flowSummaryMode, diagramStyle).length
                      ? "需調整"
                      : "可匯出"}
                  </strong>
                </section>
              )}
              <section className="panel report-items-panel">
                <div className="report-items-head">
                  <div>
                    <span className="eyebrow">REPORT ITEMS</span>
                    <h2>這個計畫要匯出哪些分析結果</h2>
                    <p>
                      勾到的項目才會出現在 Excel 裡，一個項目一張工作表。
                      例如只要各路口駛出的尖峰流量，就只勾第一項；要車種分析加駛出流量，就勾兩項。
                      勾選會自動記在「{activeProject?.name || "目前計畫"}
                      」上，也可以另存成範本套用到其他計畫。
                    </p>
                  </div>
                  <div className="report-items-actions">
                    <button
                      className="secondary"
                      onClick={function () {
                        setActiveReportItems(
                          REPORT_ITEMS.map(function (item) {
                            return item.key;
                          }),
                        );
                      }}
                    >
                      全選
                    </button>
                    <button
                      className="secondary"
                      onClick={function () {
                        setActiveReportItems([]);
                      }}
                    >
                      全部取消
                    </button>
                  </div>
                </div>
                <div className="report-items-grid">
                  {REPORT_ITEMS.map(function (item) {
                    return (
                      <label
                        key={item.key}
                        className={
                          activeReportItems.includes(item.key) ? "selected" : ""
                        }
                      >
                        <input
                          type="checkbox"
                          aria-label={item.label}
                          checked={activeReportItems.includes(item.key)}
                          onChange={function () {
                            toggleReportItem(item.key);
                          }}
                        />
                        <span>
                          <b>{item.label}</b>
                          <small>{item.hint}</small>
                          <em>工作表：{item.sheet}</em>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="report-template-box">
                  <b>報表範本</b>
                  <div className="report-template-create">
                    <input
                      value={reportTemplateName}
                      placeholder="例如：A計畫－只要駛出尖峰流量"
                      onChange={function (e) {
                        setReportTemplateName(e.target.value);
                      }}
                    />
                    <button
                      className="secondary"
                      disabled={
                        !reportTemplateName.trim() || !activeReportItems.length
                      }
                      onClick={function () {
                        const name = reportTemplateName.trim();
                        setReportTemplates([
                          {
                            id: "RT-" + Date.now().toString(36),
                            name: name,
                            items: [...activeReportItems],
                            includeChart: activeReportItems.includes("trend"),
                            createdAt: new Date().toISOString(),
                          },
                          ...reportTemplates.filter(function (item) {
                            return item.name !== name;
                          }),
                        ]);
                        setReportTemplateName("");
                        notify("已儲存報表範本「" + name + "」。");
                      }}
                    >
                      儲存目前勾選
                    </button>
                  </div>
                  {reportTemplates.length ? (
                    <div className="report-template-list">
                      {reportTemplates.map(function (template) {
                        return (
                          <div
                            className="report-template-row"
                            key={template.id}
                          >
                            <span>
                              <b>{template.name}</b>
                              <small>
                                {template.items
                                  .map(function (key) {
                                    return (
                                      REPORT_ITEMS.find(function (item) {
                                        return item.key === key;
                                      })?.label || key
                                    );
                                  })
                                  .join("、")}
                              </small>
                            </span>
                            <span>
                              <button
                                className="secondary"
                                onClick={function () {
                                  setActiveReportItems(
                                    normalizeReportItems(template.items),
                                  );
                                  notify(
                                    "已套用報表範本「" + template.name + "」。",
                                  );
                                }}
                              >
                                套用
                              </button>
                              <button
                                className="danger-small"
                                onClick={function () {
                                  setReportTemplates(
                                    reportTemplates.filter(function (item) {
                                      return item.id !== template.id;
                                    }),
                                  );
                                }}
                              >
                                刪除
                              </button>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="report-template-empty">
                      還沒有範本。勾好項目後輸入名稱按「儲存目前勾選」，之後換計畫按「套用」就能整組還原。
                    </p>
                  )}
                </div>
              </section>
              <section className="panel report-draft-panel">
                <div className="report-items-head report-draft-head">
                  <div>
                    <span className="eyebrow">REPORT DRAFT</span>
                    <h2>報告文字草稿</h2>
                    <p>
                      <b>這一份是「這批 Excel 的說明文字」</b>：段落跟著上面勾選的匯出項目走，
                      勾了哪幾張工作表就寫哪幾段，會和 Excel 一起交出去。
                      要自己挑條件（只寫某一季、某幾個路口、只寫駛入流量⋯）請改用左側選單的
                      <b>「結論草稿產生器」</b>。兩邊的數字來源完全相同。
                      <br />
                      數字全部取自產生 Excel 的同一批計算，不會另外再算一次。
                      支線與車種這類不能跨路口、跨季度相加的敘述，會固定以一筆代表資料為準，並在文中寫明是哪一筆。
                    </p>
                  </div>
                  <div className="report-draft-head-actions">
                    <button
                      className="secondary"
                      onClick={function () {
                        setDraftSectionOverride(null);
                      }}
                    >
                      跟著匯出勾選
                    </button>
                    <button
                      className="secondary"
                      onClick={function () {
                        setDraftSectionOverride([...DRAFT_SECTION_ORDER]);
                      }}
                    >
                      全選
                    </button>
                    <button
                      className="secondary"
                      onClick={function () {
                        setDraftSectionOverride([]);
                      }}
                    >
                      全部不勾
                    </button>
                  </div>
                </div>
                <div className="draft-section-chips">
                  {DRAFT_SECTION_ORDER.map(function (key) {
                    return (
                      <label
                        key={key}
                        className={
                          "chip-check" +
                          (draftSections.includes(key) ? " selected" : "")
                        }
                      >
                        <input
                          type="checkbox"
                          aria-label={DRAFT_SECTION_LABELS[key]}
                          checked={draftSections.includes(key)}
                          onChange={function () {
                            toggleDraftSection(key);
                          }}
                        />
                        <span>{DRAFT_SECTION_LABELS[key]}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="report-draft-box">
                  <textarea
                    aria-label="報告文字草稿"
                    value={reportDraftText}
                    placeholder="這個計畫在選定期間內還沒有可敘述的資料。"
                    onChange={function (e) {
                      setReportDraftText(e.target.value);
                      setReportDraftEdited(true);
                    }}
                  />
                  <div className="report-draft-actions">
                    <button
                      className="secondary"
                      onClick={function () {
                        setReportDraftEdited(false);
                        setReportDraftText(generatedReportDraft);
                        notify("草稿已依目前的匯出範圍重新產生。");
                      }}
                    >
                      重新產生
                    </button>
                    <button
                      className="secondary"
                      disabled={!reportDraftText.trim()}
                      onClick={function () {
                        // 沒有剪貼簿權限（http 或舊瀏覽器）時要講清楚，
                        // 不能靜靜失敗讓使用者以為複製成功了。
                        if (!navigator.clipboard?.writeText)
                          return notify(
                            "這個瀏覽器不允許程式複製，請手動選取草稿文字後複製。",
                          );
                        navigator.clipboard
                          .writeText(reportDraftText)
                          .then(function () {
                            notify("草稿全文已複製。");
                          })
                          .catch(function () {
                            notify(
                              "複製失敗，請手動選取草稿文字後複製。",
                            );
                          });
                      }}
                    >
                      複製全文
                    </button>
                    <button
                      className="secondary"
                      disabled={!reportDraftText.trim()}
                      onClick={function () {
                        downloadBlob(
                          new Blob(["﻿" + reportDraftText], {
                            type: "text/plain;charset=utf-8",
                          }),
                          (activeProject?.code || "Project") +
                            "_" +
                            (reportDraftContext?.quarterRange || "all") +
                            "_報告文字草稿.txt",
                        );
                      }}
                    >
                      下載 .txt
                    </button>
                    <span className="report-draft-note">
                      {reportDraftEdited
                        ? "已手動修改，改期間或改勾選都不會覆蓋掉；但切換計畫會重新產生，請先複製或下載。"
                        : "會隨匯出期間與勾選自動更新；只要開始手改就停止自動更新（切換計畫仍會重新產生）。"}
                    </span>
                  </div>
                </div>
              </section>
              <section className="report-grid">
                <article className="panel report-card">
                  <span className="file-type excel">XLS</span>
                  <h2>分析數據 Excel</h2>
                  <p>
                    依上方勾選的
                    <b>{activeReportItems.length}</b>{" "}
                    個項目輸出，一個項目一張工作表。
                    {activeReportItems.includes("trend")
                      ? "XLSX 另含可編輯折線圖。"
                      : "（未勾選歷季趨勢，因此不附折線圖。）"}
                  </p>
                  <div className="report-range">
                    <label>
                      起始季度
                      <select
                        value={reportStartQuarter}
                        onChange={function (e) {
                          setReportStartQuarter(e.target.value);
                        }}
                      >
                        {quarters.map(function (item) {
                          return <option key={item}>{item}</option>;
                        })}
                      </select>
                    </label>
                    <label>
                      結束季度
                      <select
                        value={reportEndQuarter}
                        onChange={function (e) {
                          setReportEndQuarter(e.target.value);
                        }}
                      >
                        {quarters.map(function (item) {
                          return <option key={item}>{item}</option>;
                        })}
                      </select>
                    </label>
                  </div>
                  <button
                    className="primary full"
                    disabled={!activeReportItems.length}
                    onClick={function () {
                      exportExcel("xlsx");
                    }}
                  >
                    下載新版 .xlsx
                  </button>
                  <button
                    className="secondary full"
                    disabled={!activeReportItems.length}
                    onClick={function () {
                      exportExcel("xls");
                    }}
                  >
                    下載舊版 .xls
                  </button>
                  {!activeReportItems.length && (
                    <p className="report-empty-hint">
                      目前一個分析項目都沒有勾選，請先在上方勾選要匯出的內容。
                    </p>
                  )}
                </article>
                <article className="panel report-card batch-card">
                  <span className="file-type zip">ZIP</span>
                  <h2>多計畫批次成果包</h2>
                  <p>
                    依下方勾選的計畫與季度，將 Excel、PDF 與全部路口 PNG
                    一次打包。
                  </p>
                  <div className="batch-project-list">
                    {projects.map(function (project) {
                      return (
                        <label key={project.id}>
                          <input
                            type="checkbox"
                            checked={batchProjectIds.includes(project.id)}
                            onChange={function (e) {
                              setBatchProjectIds(function (ids) {
                                return e.target.checked
                                  ? Array.from(new Set([...ids, project.id]))
                                  : ids.filter(function (id) {
                                      return id !== project.id;
                                    });
                              });
                            }}
                          />
                          {project.code} · {project.name}
                        </label>
                      );
                    })}
                  </div>
                  <b className="batch-label">包含季度</b>
                  <div className="batch-project-list batch-quarter-list">
                    {allQuarterKeys.map(function (item) {
                      return (
                        <label key={item}>
                          <input
                            type="checkbox"
                            checked={batchQuarterKeys.includes(item)}
                            onChange={function (e) {
                              setBatchQuarterKeys(function (values) {
                                return e.target.checked
                                  ? Array.from(
                                      new Set([...values, item]),
                                    ).sort(compareQuarters)
                                  : values.filter(function (value) {
                                      return value !== item;
                                    });
                              });
                            }}
                          />
                          {item}
                        </label>
                      );
                    })}
                  </div>
                  <button className="primary full" onClick={exportBatchPackage}>
                    下載批次成果 ZIP
                  </button>
                </article>
                <article className="panel report-card">
                  <span className="file-type pdf">PDF</span>
                  <h2>正式版多頁 PDF</h2>
                  <p>採完整流向線版面，一頁一路口。</p>
                  <button
                    className="primary full"
                    onClick={function () {
                      exportPdf(current);
                    }}
                  >
                    產生 {current.length} 頁
                  </button>
                </article>
                <article className="panel report-card">
                  <span className="file-type png">PNG</span>
                  <h2>全部路口 PNG ZIP</h2>
                  <p>每路口一張高解析圖片，文字保持正向。</p>
                  <button className="primary full" onClick={exportPngZip}>
                    下載 {current.length} 張
                  </button>
                </article>
                <article className="panel report-card">
                  <span className="file-type svg">SVG</span>
                  <h2>目前路口向量圖</h2>
                  <p>可無損縮放與排版。</p>
                  <button className="secondary full" onClick={exportSvg}>
                    下載 SVG
                  </button>
                </article>
              </section>
              <section className="panel report-note">
                <b>Excel 編輯性</b>
                <p>
                  XLSX 的趨勢數據與折線圖均可在 Excel 直接修改；舊版 XLS
                  保留三類數據工作表，但不含原生圖表。轉向圖仍以 SVG／PNG／PDF
                  為正式成果。
                </p>
              </section>
            </>
          )}

          {view === "backup" && (
            <>
              <section className="page-head">
                <div>
                  <span className="eyebrow">BACKUP & RESTORE</span>
                  <h1>跨電腦備份、還原與版本</h1>
                  <p>
                    A 電腦下載備份檔，B 電腦開啟同一個網站匯入即可接續。
                    <b>單一計畫</b>的備份匯入時是「併入」，
                    <b>全部計畫</b>的備份匯入時是「完整取代」。
                  </p>
                </div>
              </section>
              <section className="backup-grid">
                <article className="panel">
                  <span>01</span>
                  <h2>只備份目前這個計畫</h2>
                  <p>
                    {activeProject
                      ? "只含「" +
                        activeProject.name +
                        "」的季度資料、當量參數與車種設定，不會帶走其他計畫。到 B 電腦匯入時會併入，B 電腦原有的計畫不受影響。"
                      : "請先在「多計畫管理」選一個計畫。"}
                  </p>
                  <button
                    className="primary full"
                    disabled={!activeProject}
                    onClick={function () {
                      exportBackupJson(activeProjectId);
                    }}
                  >
                    下載本計畫 JSON
                  </button>
                  <button
                    className="secondary full"
                    disabled={!activeProject}
                    onClick={function () {
                      exportBackupZip(activeProjectId);
                    }}
                  >
                    下載本計畫 ZIP
                  </button>
                </article>
                <article className="panel">
                  <span>02</span>
                  <h2>備份全部計畫</h2>
                  <p>
                    這台電腦上的 {projects.length}{" "}
                    個計畫全部帶走，含名稱映射與各計畫的當量參數。
                    到 B 電腦匯入時會<b>完整取代</b>那台電腦上的資料。
                  </p>
                  <button
                    className="primary full"
                    onClick={function () {
                      exportBackupZip();
                    }}
                  >
                    下載 ZIP（全部計畫）
                  </button>
                  <button
                    className="secondary full"
                    onClick={function () {
                      exportBackupJson();
                    }}
                  >
                    下載 JSON（全部計畫）
                  </button>
                </article>
                <article className="panel">
                  <span>03</span>
                  <h2>在另一台電腦匯入</h2>
                  <p>
                    ZIP 或 JSON 都可以。系統會自己判斷這是單一計畫還是全部計畫的
                    備份，並在動手前把「會併入」還是「會取代」寫清楚給您確認。
                  </p>
                  <label className="secondary full upload-label">
                    選擇備份檔
                    <input
                      hidden
                      type="file"
                      accept=".zip,.json"
                      onChange={function (e) {
                        if (e.target.files?.[0])
                          restoreBackup(e.target.files[0]);
                      }}
                    />
                  </label>
                </article>
              </section>
              <section className="panel version-panel">
                <div>
                  <span className="eyebrow">CHANGELOG</span>
                  <h2>系統版本與更新紀錄</h2>
                </div>
                {VERSION_HISTORY.map(function (item, index) {
                  return (
                    <article key={item.version}>
                      <b>{item.version}</b>
                      <time>{item.date}</time>
                      <p>{item.note}</p>
                      <span>{index === 0 ? "目前版本" : "歷史版本"}</span>
                    </article>
                  );
                })}
              </section>
              <section className="panel danger-zone">
                <div>
                  <b>清除本機資料</b>
                  <p>
                    會清除所有計畫、資料與設定（含當量矩陣、車種目錄、車種對應、
                    格式範本、報表範本與版本紀錄），且不會恢復任何示範值；請先下載完整備份。
                  </p>
                </div>
                <button
                  onClick={function () {
                    if (
                      confirm("確定清除這台電腦內的 Turning Traffic 資料？")
                    ) {
                      /*
                       * 「所有設定」就是所有設定。舊版只清了計畫與紀錄，
                       * 上一個委託案的當量係數、車種目錄與報表範本會留在
                       * 下一個案子裡繼續生效，而畫面上寫的是「已清除，
                       * 系統回到空白正式環境」。
                       */
                      setProjects([]);
                      setRecords([]);
                      setNameMap({});
                      setActiveProjectId("");
                      setQuarter("");
                      /*
                       * 一定要清整份 byProject。setPce 等是 scoped setter，
                       * 只會把預設值寫進「目前這個計畫」那一格，其他計畫的
                       * 當量矩陣、車種目錄與車種對照會原封不動留在
                       * localStorage 裡——而按鈕上方明寫「會清除所有計畫、
                       * 資料與設定（含當量矩陣、車種目錄、車種對應…）」。
                       */
                      setPceByProject({});
                      setCatalogByProject({});
                      setMappingsByProject({});
                      setFormatMemories([]);
                      setVehicleSchemes([]);
                      setReportTemplates([]);
                      setConclusionTemplates([]);
                      setRecordRevisions([]);
                      notify("已清除，系統回到空白正式環境。");
                    }
                  }}
                >
                  全部清除
                </button>
              </section>
            </>
          )}

          {view === "help" && (
            <>
              <section className="page-head help-head">
                <div>
                  <span className="eyebrow">BEGINNER GUIDE</span>
                  <h1>第一次使用 Turning Traffic</h1>
                  <p>
                    不需要先懂交通工程。依照下列順序操作，就能完成資料匯入、核對、轉向圖與成果輸出。
                  </p>
                </div>
                <div className="help-downloads">
                  <a
                    className="primary help-download"
                    href="./Turning-Traffic-v2.1.22-新手操作手冊.pdf"
                    download
                  >
                    下載完整 PDF 手冊
                  </a>
                  <a
                    className="secondary help-download"
                    href="./Turning-Traffic-v2.1.22-新手操作手冊.docx"
                    download
                    title="可編輯的 Word 版本"
                  >
                    Word 版
                  </a>
                </div>
              </section>
              <section className="help-steps">
                <article className="panel">
                  <b>1</b>
                  <div>
                    <h2>建立計畫</h2>
                    <p>
                      計畫就像一個資料夾，例如「某工業區交通監測」。不同案件請分開建立，之後仍可跨計畫比較。
                    </p>
                    <button
                      onClick={function () {
                        setView("projects");
                      }}
                    >
                      前往多計畫管理
                    </button>
                  </div>
                </article>
                <article className="panel">
                  <b>2</b>
                  <div>
                    <h2>選擇年度與季度，再匯入</h2>
                    <p>
                      先指定資料屬於哪一年、哪一季，再放入
                      Excel。系統會辨識工作表、平假日、車種與路口流向。
                    </p>
                    <button
                      onClick={function () {
                        setView("import");
                      }}
                    >
                      前往季度批次匯入
                    </button>
                  </div>
                </article>
                <article className="panel">
                  <b>3</b>
                  <div>
                    <h2>先看品質檢查</h2>
                    <p>
                      確認日期、缺值、總量與未對應流向。警示不一定代表資料錯誤，但必須知道原因後再確認成果。
                    </p>
                    <button
                      onClick={function () {
                        setView("quality");
                      }}
                    >
                      前往資料品質檢查
                    </button>
                  </div>
                </article>
                <article className="panel">
                  <b>4</b>
                  <div>
                    <h2>核對路口與道路方向</h2>
                    <p>
                      道路角度只決定圖怎麼畫，不會交換 A、B、C
                      的原始資料。多岔路請對照原始簡圖調整角度。
                    </p>
                    <button
                      onClick={function () {
                        setView("geometry");
                      }}
                    >
                      前往道路與流向管理
                    </button>
                  </div>
                </article>
                <article className="panel">
                  <b>5</b>
                  <div>
                    <h2>查看並整理轉向圖</h2>
                    <p>
                      可切換
                      AM／PM、駛入／駛出、車種及版型。圖卡或「路口A」標籤重疊時，直接用滑鼠拖到想要的位置即可，放開才存檔。
                    </p>
                    <button
                      onClick={function () {
                        setView("diagram");
                      }}
                    >
                      前往路口轉向圖
                    </button>
                  </div>
                </article>
                <article className="panel">
                  <b>6</b>
                  <div>
                    <h2>匯出成果並備份</h2>
                    <p>
                      先在「報表與批次輸出」勾選這個計畫要的分析項目（可存成範本），再輸出
                      Excel、PDF 或圖片；最後下載完整備份 ZIP。
                    </p>
                    <button
                      onClick={function () {
                        setView("reports");
                      }}
                    >
                      前往報表與批次輸出
                    </button>
                  </div>
                </article>
              </section>
              <section className="panel help-glossary">
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">PLAIN LANGUAGE</span>
                    <h2>常用名詞白話說明</h2>
                  </div>
                </div>
                <div className="help-glossary-grid">
                  <article>
                    <b>PCU/hr</b>
                    <p>
                      每小時的小客車當量。不同車種乘上各自當量後，換算成可以相加比較的交通量。
                    </p>
                  </article>
                  <article>
                    <b>AM／PM Peak</b>
                    <p>上午／下午調查範圍內，連續一小時交通量最高的時段。</p>
                  </article>
                  <article>
                    <b>駛入路口</b>
                    <p>車輛穿越中央路口後，進入某一條道路支線的流量。</p>
                  </article>
                  <article>
                    <b>駛出路口</b>
                    <p>車輛從某一條道路支線出發，駛向中央路口的流量。</p>
                  </article>
                  <article>
                    <b>OD 流向</b>
                    <p>O 是從哪條支線出發，D 是最後進入哪條支線，例如 A→C。</p>
                  </article>
                  <article>
                    <b>圖卡位置</b>
                    <p>
                      用滑鼠把數據框或路口標籤拖到想要的位置，避免遮住道路或文字；完全不會改變計算結果。
                    </p>
                  </article>
                  <article>
                    <b>未對應流向</b>
                    <p>
                      系統讀到數量，但無法確定起點或終點。數量會保留並警示，不會自行猜測或刪除。
                    </p>
                  </article>
                  <article>
                    <b>成果鎖定</b>
                    <p>
                      核對完成後防止名稱、角度或當量被誤改；有需要仍可人工解除。
                    </p>
                  </article>
                </div>
              </section>
              <section className="panel help-advanced">
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">WHEN TO USE</span>
                    <h2>進階功能什麼時候才需要？</h2>
                  </div>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>功能</th>
                      <th>用途</th>
                      <th>一般新手是否必須</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>流量核對工作台</td>
                      <td>
                        追查某個尖峰總量由哪些工作表、儲存格及 OD 流向加總而來。
                      </td>
                      <td>數值有疑問時使用</td>
                    </tr>
                    <tr>
                      <td>轉向進階分析</td>
                      <td>
                        查看 OD 矩陣、駛入駛出平衡與其他可能的連續一小時尖峰。
                      </td>
                      <td>完成基本成果後再看</td>
                    </tr>
                    <tr>
                      <td>車種轉向當量</td>
                      <td>調整各車種左轉、直行、右轉換算 PCU 的係數。</td>
                      <td>沿用既定係數時不用改</td>
                    </tr>
                    <tr>
                      <td>格式範本記憶</td>
                      <td>記住不同調查廠商的 Excel 版型，降低下次辨識錯誤。</td>
                      <td>系統自動處理</td>
                    </tr>
                    <tr>
                      <td>版本還原</td>
                      <td>重新匯入或修改後，回到先前保存的資料版本。</td>
                      <td>改錯資料時使用</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </>
          )}
        </div>
      </main>
      {toast && <div className="toast">✓ {toast}</div>}
    </div>
  );
}

/**
 * 結論草稿產生器。
 *
 * 使用者自己勾條件（範圍／時段／路口／支線／指標／分段方式），系統照著寫。
 * 產生的文字可以直接手改，改過之後不會被自動覆蓋——只有按「重新產生」
 * 才會蓋掉，而且會先問過。條件可以存成範本重複使用。
 */
function ConclusionStudio(props: {
  records: TrafficRecord[];
  projectName: string;
  templates: ConclusionTemplate[];
  setTemplates: (value: ConclusionTemplate[]) => void;
  notify: (value: string) => void;
  /*
   * 條件與草稿刻意「不」放在這個元件裡。
   *
   * 切到別的分頁時這個元件會被卸載，狀態跟著消失——使用者設好一整組條件、
   * 產生了草稿，只是去看一眼路口轉向圖再回來，文字就全部不見了。
   * 狀態放在上層元件（它整個 session 都不會卸載），切分頁才留得住。
   */
  condition: ConclusionCondition;
  setCondition: (value: ConclusionCondition) => void;
  draft: string;
  setDraft: (value: string) => void;
  edited: boolean;
  setEdited: (value: boolean) => void;
  templateName: string;
  setTemplateName: (value: string) => void;
}) {
  const { condition, setCondition, draft, setDraft, edited, setEdited, templateName, setTemplateName } =
    props;

  const source = useMemo(
    function () {
      return toConclusionRecords(props.records);
    },
    [props.records],
  );

  const quarters = useMemo(
    function () {
      return Array.from(new Set(source.map((record) => record.quarter))).sort(
        function (a, b) {
          return conclusionQuarterKey(a) - conclusionQuarterKey(b);
        },
      );
    },
    [source],
  );
  const years = useMemo(
    function () {
      return Array.from(
        new Set(source.map((record) => quarterYear(record.quarter)).filter(Boolean)),
      ).sort();
    },
    [source],
  );
  const intersections = useMemo(
    function () {
      return Array.from(
        new Map(
          source.map((record) => [
            record.intersectionKey,
            record.station + "　" + record.name,
          ]),
        ).entries(),
      );
    },
    [source],
  );
  const surveyTypes = useMemo(
    function () {
      return Array.from(new Set(source.map((record) => record.surveyType))).sort();
    },
    [source],
  );
  /* 支線清單只列「目前所選路口」有的，否則選單會長到不能看。 */
  const branchNames = useMemo(
    function () {
      const keys = condition.intersectionKeys;
      const names = new Set<string>();
      for (const record of source) {
        if (keys.length && !keys.includes(record.intersectionKey)) continue;
        for (const peak of ["AM", "PM"] as PeakKey[])
          for (const branch of record.peaks[peak]?.branches || [])
            names.add(branch.name);
      }
      return Array.from(names).sort();
    },
    [source, condition.intersectionKeys],
  );

  const matched = useMemo(
    function () {
      return selectRecords(source, condition).length;
    },
    [source, condition],
  );

  const patch = function (next: Partial<ConclusionCondition>) {
    setCondition({ ...condition, ...next });
  };
  const toggle = function <T,>(list: T[], value: T): T[] {
    return list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];
  };

  function generate(force = false) {
    if (edited && !force) {
      if (
        !window.confirm(
          "您已經手動修改過草稿。重新產生會覆蓋掉修改內容，確定要繼續嗎？",
        )
      )
        return;
    }
    const now = new Date();
    const stamp =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0") +
      " " +
      String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0");
    setDraft(
      buildConclusion(source, condition, {
        projectName: props.projectName,
        systemVersion: VERSION,
        generatedAt: stamp,
      }),
    );
    setEdited(false);
    props.notify("結論草稿已產生。");
  }

  const scope = condition.scope;

  return (
    <>
      <section className="page-head">
        <div>
          <span className="eyebrow">CONCLUSION STUDIO</span>
          <h1>結論草稿產生器</h1>
          <p>
            <b>這一份是「您自己出題」</b>：自己勾選統計範圍、時段、路口、支線與要寫哪些數字，
            系統照著條件寫出結論，和 Excel 匯出無關。
            要產生「這批 Excel 的說明文字」請用「報表與批次輸出」裡的<b>報告文字草稿</b>。
            兩邊的數字來源完全相同，都取自畫面與 Excel 用的同一組計算，不會另外再算一次。
          </p>
        </div>
        <button className="primary" onClick={() => generate()}>
          產生草稿
        </button>
      </section>

      {!source.length ? (
        <Empty
          title="這個計畫還沒有調查資料"
          text="請先到「季度批次匯入」匯入調查檔，再回來產生結論草稿。"
        />
      ) : (
        <>
          <section className="panel conclusion-panel">
            <div className="conclusion-head">
              <div>
                <span className="eyebrow">CONDITIONS</span>
                <h2>條件設定</h2>
              </div>
              <b className={matched ? "conclusion-count" : "conclusion-count zero"}>
                符合條件 {matched} 筆
              </b>
            </div>

            <div className="conclusion-grid">
              <fieldset className="conclusion-field">
                <legend>一、統計範圍</legend>
                <div className="conclusion-radios">
                  {(
                    [
                      ["quarter", "單一季度"],
                      ["year", "某一年度"],
                      ["range", "季度區間"],
                      ["project", "整個計畫"],
                    ] as const
                  ).map(function (entry) {
                    return (
                      <label key={entry[0]}>
                        <input
                          type="radio"
                          name="conclusion-scope"
                          checked={scope.kind === entry[0]}
                          onChange={function () {
                            if (entry[0] === "quarter")
                              patch({
                                scope: {
                                  kind: "quarter",
                                  quarter: quarters.at(-1) || "",
                                },
                              });
                            else if (entry[0] === "year")
                              patch({
                                scope: { kind: "year", year: years.at(-1) || "" },
                              });
                            else if (entry[0] === "range")
                              patch({
                                scope: {
                                  kind: "range",
                                  from: quarters[0] || "",
                                  to: quarters.at(-1) || "",
                                },
                              });
                            else patch({ scope: { kind: "project" } });
                          }}
                        />
                        {entry[1]}
                      </label>
                    );
                  })}
                </div>
                {scope.kind === "quarter" && (
                  <label className="conclusion-inline">
                    季度
                    <select
                      value={scope.quarter}
                      onChange={function (e) {
                        patch({ scope: { kind: "quarter", quarter: e.target.value } });
                      }}
                    >
                      {quarters.map((q) => (
                        <option key={q} value={q}>
                          {q}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {scope.kind === "year" && (
                  <label className="conclusion-inline">
                    年度
                    <select
                      value={scope.year}
                      onChange={function (e) {
                        patch({ scope: { kind: "year", year: e.target.value } });
                      }}
                    >
                      {years.map((y) => (
                        <option key={y} value={y}>
                          {y} 年
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {scope.kind === "range" && (
                  <div className="conclusion-inline">
                    <label>
                      起
                      <select
                        value={scope.from}
                        onChange={function (e) {
                          patch({
                            scope: { kind: "range", from: e.target.value, to: scope.to },
                          });
                        }}
                      >
                        {quarters.map((q) => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      迄
                      <select
                        value={scope.to}
                        onChange={function (e) {
                          patch({
                            scope: {
                              kind: "range",
                              from: scope.from,
                              to: e.target.value,
                            },
                          });
                        }}
                      >
                        {quarters.map((q) => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </fieldset>

              <fieldset className="conclusion-field">
                <legend>二、時段與資料別</legend>
                {/*
                  這裡是兩件不同的事：上排是「哪一個尖峰」，下排是「平日還是
                  假日」。以前兩排長得一模一樣又沒有小標，「待設定」看起來
                  像是第三個尖峰時段。
                */}
                <span className="conclusion-sublabel">時段</span>
                <div className="conclusion-checks">
                  {(
                    [
                      ["AM", "上午尖峰"],
                      ["PM", "下午尖峰"],
                    ] as const
                  ).map(function (entry) {
                    return (
                      <label key={entry[0]}>
                        <input
                          type="checkbox"
                          checked={condition.peaks.includes(entry[0])}
                          onChange={function () {
                            const next = toggle(condition.peaks, entry[0]);
                            patch({ peaks: next.length ? next : condition.peaks });
                          }}
                        />
                        {entry[1]}
                      </label>
                    );
                  })}
                </div>
                <span className="conclusion-sublabel">資料別</span>
                <div className="conclusion-checks">
                  {surveyTypes.map(function (type) {
                    return (
                      <label key={type}>
                        <input
                          type="checkbox"
                          checked={condition.surveyTypes.includes(type)}
                          onChange={function () {
                            patch({ surveyTypes: toggle(condition.surveyTypes, type) });
                          }}
                        />
                        {type}
                      </label>
                    );
                  })}
                </div>
                <p className="conclusion-hint">
                  資料別一個都不勾＝全部都寫。時段至少要留一個。
                  {surveyTypes.includes("待設定") ? (
                    <>
                      <br />
                      <b>「待設定」不是一種時段</b>，而是那幾筆資料還沒指定是平日還是假日
                      （原始檔的日期沒有寫「（平日）」「（假日）」）。
                      要更正請到「流量核對工作台」，選到該筆路口季度後在「資料別」下拉指定。
                    </>
                  ) : null}
                </p>
              </fieldset>

              <fieldset className="conclusion-field">
                <legend>三、要寫哪些路口</legend>
                <div className="conclusion-actions-row">
                  <button
                    className="ghost"
                    onClick={function () {
                      patch({ intersectionKeys: [], branchNames: [] });
                    }}
                  >
                    全部路口
                  </button>
                </div>
                <div className="conclusion-list">
                  {intersections.map(function (entry) {
                    return (
                      <label key={entry[0]}>
                        <input
                          type="checkbox"
                          checked={condition.intersectionKeys.includes(entry[0])}
                          onChange={function () {
                            patch({
                              intersectionKeys: toggle(
                                condition.intersectionKeys,
                                entry[0],
                              ),
                              branchNames: [],
                            });
                          }}
                        />
                        {entry[1]}
                      </label>
                    );
                  })}
                </div>
                <p className="conclusion-hint">
                  一個都不勾＝全部路口都寫（目前 {intersections.length} 個）。
                </p>
              </fieldset>

              <fieldset className="conclusion-field">
                <legend>四、要寫哪些支線</legend>
                <div className="conclusion-list">
                  {branchNames.map(function (name) {
                    return (
                      <label key={name}>
                        <input
                          type="checkbox"
                          checked={condition.branchNames.includes(name)}
                          onChange={function () {
                            patch({ branchNames: toggle(condition.branchNames, name) });
                          }}
                        />
                        {name}
                      </label>
                    );
                  })}
                </div>
                <p className="conclusion-hint">
                  一個都不勾＝全部支線都寫。支線清單會跟著上面所選的路口變動。
                </p>
              </fieldset>

              <fieldset className="conclusion-field conclusion-field-wide">
                <legend>五、要寫哪些數字</legend>
                <div className="conclusion-metrics">
                  {CONCLUSION_METRICS.map(function (metric) {
                    const key = metric.key as ConclusionMetricKey;
                    return (
                      <label
                        key={key}
                        className={
                          condition.metrics.includes(key) ? "selected" : ""
                        }
                      >
                        <input
                          type="checkbox"
                          checked={condition.metrics.includes(key)}
                          onChange={function () {
                            patch({ metrics: toggle(condition.metrics, key) });
                          }}
                        />
                        {metric.label}
                      </label>
                    );
                  })}
                </div>
                {condition.metrics.includes("branchComposition") ? (
                  <div className="conclusion-submode">
                    <span className="conclusion-sublabel">
                      各支線各車種要怎麼呈現
                    </span>
                    <div className="conclusion-radios">
                      {BRANCH_COMPOSITION_MODES.map(function (mode) {
                        return (
                          <label key={mode.key}>
                            <input
                              type="radio"
                              name="conclusion-branch-composition-mode"
                              checked={
                                (condition.branchCompositionMode ||
                                  "follow") === mode.key
                              }
                              onChange={function () {
                                patch({ branchCompositionMode: mode.key });
                              }}
                            />
                            {mode.label}
                          </label>
                        );
                      })}
                    </div>
                    <p className="conclusion-hint">
                      和「車種組成分析」頁上每條支線的下拉選單同一套。選「跟著設定」時，
                      您在那一頁把某條支線改成雙向合計，草稿就會跟著寫成雙向合計。
                    </p>
                  </div>
                ) : null}
              </fieldset>

              <fieldset className="conclusion-field conclusion-field-wide">
                <legend>六、敘述方式</legend>
                <div className="conclusion-radios">
                  {(
                    [
                      ["byIntersection", "依路口分段（每個路口一段）"],
                      ["byQuarter", "依季度分段（每一季一段）"],
                      ["overall", "只寫整體結論"],
                    ] as const
                  ).map(function (entry) {
                    return (
                      <label key={entry[0]}>
                        <input
                          type="radio"
                          name="conclusion-grouping"
                          checked={condition.grouping === entry[0]}
                          onChange={function () {
                            patch({ grouping: entry[0] });
                          }}
                        />
                        {entry[1]}
                      </label>
                    );
                  })}
                </div>
                <label className="conclusion-inline">
                  小數位數
                  <select
                    value={String(condition.digits)}
                    onChange={function (e) {
                      patch({ digits: Number(e.target.value) });
                    }}
                  >
                    {[0, 1, 2].map((d) => (
                      <option key={d} value={d}>
                        {d} 位
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>
            </div>

            <div className="conclusion-templates">
              <strong>條件範本</strong>
              <div className="conclusion-actions-row">
                <input
                  value={templateName}
                  placeholder="例如：季報用、年報用"
                  onChange={function (e) {
                    setTemplateName(e.target.value);
                  }}
                />
                <button
                  className="secondary"
                  onClick={function () {
                    const name = templateName.trim();
                    if (!name) return props.notify("請先輸入範本名稱。");
                    props.setTemplates([
                      {
                        id: "CT-" + Date.now(),
                        name,
                        condition,
                        savedAt: new Date().toISOString(),
                      },
                      ...props.templates.filter(function (item) {
                        return item.name !== name;
                      }),
                    ]);
                    setTemplateName("");
                    props.notify("已存成範本「" + name + "」。");
                  }}
                >
                  存成範本
                </button>
              </div>
              {props.templates.length ? (
                <div className="conclusion-template-list">
                  {props.templates.map(function (template) {
                    return (
                      <span key={template.id} className="conclusion-template">
                        <button
                          className="ghost"
                          onClick={function () {
                            /*
                              * 一定要正規化：舊版存下來的範本可能缺欄位，
                              * 直接套用會在 render 期間丟 TypeError，
                              * 整個結論分頁會消失。
                              */
                            setCondition(
                              normalizeCondition(template.condition),
                            );
                            props.notify("已套用範本「" + template.name + "」。");
                          }}
                        >
                          {template.name}
                        </button>
                        <button
                          className="ghost danger"
                          aria-label={"刪除範本 " + template.name}
                          onClick={function () {
                            props.setTemplates(
                              props.templates.filter(function (item) {
                                return item.id !== template.id;
                              }),
                            );
                          }}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="conclusion-hint">
                  還沒有存過範本。存起來之後，下次直接按一下就套用同一組條件。
                </p>
              )}
            </div>
          </section>

          <section className="panel conclusion-output">
            <div className="conclusion-head">
              <div>
                <span className="eyebrow">CONCLUSION DRAFT</span>
                <h2>結論草稿</h2>
              </div>
              <div className="conclusion-actions-row">
                <button className="secondary" onClick={() => generate()}>
                  重新產生
                </button>
                <button
                  className="secondary"
                  disabled={!draft}
                  onClick={function () {
                    navigator.clipboard
                      ?.writeText(draft)
                      .then(function () {
                        props.notify("已複製到剪貼簿。");
                      })
                      .catch(function () {
                        props.notify("瀏覽器不允許複製，請手動全選複製。");
                      });
                  }}
                >
                  複製全文
                </button>
                <button
                  className="secondary"
                  disabled={!draft}
                  onClick={function () {
                    downloadBlob(
                      new Blob([draft], { type: "text/plain;charset=utf-8" }),
                      "結論草稿.txt",
                    );
                  }}
                >
                  下載 .txt
                </button>
              </div>
            </div>
            <textarea
              aria-label="結論草稿"
              value={draft}
              placeholder="設定好上面的條件後，按「產生草稿」。"
              onChange={function (e) {
                setDraft(e.target.value);
                setEdited(true);
              }}
            />
            <p className="conclusion-hint">
              {edited
                ? "您已手動修改過這份草稿；按「重新產生」會先詢問再覆蓋。"
                : "這段文字可以直接修改，改過之後不會被自動覆蓋。"}
            </p>
          </section>
        </>
      )}
    </>
  );
}

function TrendView(props: {
  records: TrafficRecord[];
  peak: PeakKey;
  setPeak: (value: PeakKey) => void;
  notify: (value: string) => void;
  /** 這個計畫裡還掛著「待設定」的紀錄筆數。 */
  pendingCount: number;
  assignPendingSurveyType: (value: string, intersectionKey?: string) => void;
}) {
  const [trendMode, setTrendMode] = useState<PeakKey | "ALL">(props.peak);
  const intersectionKey = function (record: TrafficRecord) {
    return (
      canonicalIntersectionKey(record.name) ||
      record.intersectionId ||
      record.station
    );
  };
  const intersections = Array.from(
    new Map(
      props.records.map(function (record) {
        return [intersectionKey(record), record.name];
      }),
    ).entries(),
  );
  const [selectedIntersection, setSelectedIntersection] = useState("");
  const activeIntersection = intersections.some(function (entry) {
    return entry[0] === selectedIntersection;
  })
    ? selectedIntersection
    : intersections[0]?.[0] || "";
  const allQuarters = Array.from(
    new Set(
      props.records.map(function (record) {
        return record.quarter;
      }),
    ),
  ).sort(compareQuarters);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  useEffect(
    function () {
      const available = Array.from(
        new Set(
          props.records.map(function (record) {
            return record.quarter;
          }),
        ),
      ).sort(compareQuarters);
      setRangeStart(available[0] || "");
      setRangeEnd(available.at(-1) || "");
    },
    [props.records],
  );
  const activeRangeStart = allQuarters.includes(rangeStart)
    ? rangeStart
    : allQuarters[0] || "";
  const activeRangeEnd = allQuarters.includes(rangeEnd)
    ? rangeEnd
    : allQuarters.at(-1) || "";
  // 同一路口的同一季可能同時有平日與假日兩筆。舊版沒有分開，兩筆會被畫成
  // 同一條折線上的兩個點、季別標籤還一樣，「較前季」也變成拿假日跟平日比。
  const surveyTypes = Array.from(
    new Set(
      props.records
        .filter(function (record) {
          return intersectionKey(record) === activeIntersection;
        })
        .map(function (record) {
          return record.surveyType || "待設定";
        }),
    ),
  ).sort();
  const [surveyTypeFilter, setSurveyTypeFilter] = useState("");
  /*
   * 「待設定」不是一種資料別，而是那幾筆在匯入當下讀不出來。所以預設要停在
   * 真正的資料別上，不要一進來就停在待設定；同時記下這個路口有幾季還沒指定，
   * 好在下方直接讓使用者補完。
   */
  const realSurveyTypes = surveyTypes.filter(function (type) {
    return type !== "待設定";
  });
  const pendingHere = props.records.filter(function (record) {
    return (
      intersectionKey(record) === activeIntersection &&
      (record.surveyType || "待設定") === "待設定"
    );
  });
  const activeSurveyType = surveyTypes.includes(surveyTypeFilter)
    ? surveyTypeFilter
    : realSurveyTypes[0] || surveyTypes[0] || "";
  const startIndex = Math.max(0, allQuarters.indexOf(activeRangeStart));
  const endIndex = Math.max(startIndex, allQuarters.indexOf(activeRangeEnd));
  const chosen = allQuarters.slice(startIndex, endIndex + 1);
  /*
   * 站號的處理交給 buildTrendSeries：站號逐年換（T13-04→T15-04）時要串成
   * 同一條線，只有「同一季同時存在兩個站號」（北向／南向並存）才需要指定
   * 站號。報表與 Excel 用的 trendSeriesRecords 也是呼叫同一支，畫面上的
   * 「較前季」才不會跟報表工作表給出兩個不同的百分比。
   */
  const [stationFilter, setStationFilter] = useState("");
  const trend = buildTrendSeries(props.records, {
    intersectionKey: activeIntersection,
    surveyType: activeSurveyType,
    quarters: chosen,
    preferStation: stationFilter || undefined,
  });
  const rows = trend.rows;
  const trendPeaks: PeakKey[] =
    trendMode === "ALL" ? ["AM", "PM"] : [trendMode];
  /*
   * 趨勢用「駛出」還是「駛入」的總量。
   *
   * 兩者是同一批 OD 流向、只是分組方式不同，資料完整時總量會完全相等；
   * 不相等就代表有流向沒有指定目的支線，差額正好是那些流向的量。
   * 讓使用者能切換，一來符合報告需求，二來一眼就看得出資料有沒有缺口。
   */
  const [trendFlow, setTrendFlow] = useState<"outbound" | "inbound">("outbound");
  const totalOf = function (record: TrafficRecord, peak: PeakKey) {
    if (trendFlow === "outbound") return recordTotal(record, peak);
    const armIds = new Set(record.approaches.map((arm) => arm.id));
    const inbound = (record.routes || [])
      .filter(function (route) {
        return armIds.has(route.toApproachId);
      })
      .reduce(function (sum, route) {
        return sum + Number(route.volumes[peak]?.pcu || 0);
      }, 0);
    return Math.round(inbound * 10) / 10;
  };
  /* 兩種視角的總量若不同，代表有流向沒有指定目的支線。 */
  const flowGap = rows.reduce(function (worst, record) {
    return trendPeaks.reduce(function (inner, peak) {
      const gap =
        Math.round((recordTotal(record, peak) - totalOf(record, peak)) * 10) / 10;
      return Math.abs(gap) > Math.abs(inner) ? gap : inner;
    }, worst);
  }, 0);
  const values = rows.flatMap(function (record) {
    return trendPeaks.map(function (peak) {
      return totalOf(record, peak);
    });
  });
  const max = Math.max(...values, 1) * 1.12;
  const chartWidth = Math.max(780, 180 + rows.length * 100);
  const series = trendPeaks.map(function (peak) {
    return {
      peak,
      color: peak === "AM" ? "#087f75" : "#d97706",
      points: rows.map(function (record, index) {
        return {
          x: 100 + (index * (chartWidth - 170)) / Math.max(1, rows.length - 1),
          y: 310 - (totalOf(record, peak) / max) * 235,
          record,
        };
      }),
    };
  });
  async function exportChart() {
    const svg = document.getElementById("trend-svg");
    if (!svg) return;
    downloadBlob(
      await svgToPng(new XMLSerializer().serializeToString(svg)),
      (intersections.find(function (entry) {
        return entry[0] === activeIntersection;
      })?.[1] || "路口") +
        "_" +
        (trendMode === "ALL" ? "AM_PM" : trendMode) +
        /*
         * 檔名一定要帶視角。整張圖（折線、點標籤、右側摘要）都跟著
         * 駛出／駛入切換走，兩種視角各匯出一次會得到內容不同、
         * 檔名卻一模一樣的兩份交付物。
         */
        "_" +
        (trendFlow === "outbound" ? "駛出總量" : "駛入總量") +
        "_歷季趨勢.png",
    );
    props.notify("趨勢圖已下載。");
  }
  async function exportTrendExcel() {
    if (!rows.length) return props.notify("目前範圍沒有可輸出的季度資料。");
    const data = rows.map(function (record, index) {
      /* 匯出要跟畫面同一個視角，否則折線圖與附表會給出兩組數字。 */
      const am = totalOf(record, "AM");
      const pm = totalOf(record, "PM");
      const priorAm = index ? totalOf(rows[index - 1], "AM") : 0;
      const priorPm = index ? totalOf(rows[index - 1], "PM") : 0;
      return {
        季度: record.quarter,
        資料別: record.surveyType || "待設定",
        "AM Peak（PCU/hr）": am,
        "PM Peak（PCU/hr）": pm,
        "AM 較前季（%）": priorAm ? am / priorAm - 1 : null,
        "PM 較前季（%）": priorPm ? pm / priorPm - 1 : null,
        站號: record.station,
        路口名稱: record.name,
        "AM 尖峰時段": record.peaks.AM.start + "–" + record.peaks.AM.end,
        "PM 尖峰時段": record.peaks.PM.start + "–" + record.peaks.PM.end,
        /*
         * 這一欄讓收到 Excel 的人看得出數字是哪一種視角算出來的。
         * 一定要放在**最後**：下面的原生折線圖是用欄位字母（C、D）指定
         * 數列的，百分比格式也是套在 E、F 欄，插在中間會讓圖表畫到別欄。
         */
        統計視角: trendFlow === "outbound" ? "駛出總量" : "駛入總量",
      };
    });
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet["!cols"] = [12, 12, 20, 20, 18, 18, 12, 30, 18, 18, 14].map(
      function (wch) {
        return { wch };
      },
    );
    sheet["!autofilter"] = { ref: sheet["!ref"] || "A1:A1" };
    // 欄位多了「資料別」，數值欄整體右移一欄。
    for (let row = 2; row <= data.length + 1; row++)
      ["C", "D"].forEach(function (column) {
        if (sheet[column + row]) sheet[column + row].z = "#,##0.0";
      });
    for (let row = 2; row <= data.length + 1; row++)
      ["E", "F"].forEach(function (column) {
        if (sheet[column + row]) sheet[column + row].z = "0.0%";
      });
    XLSX.utils.book_append_sheet(workbook, sheet, "歷季趨勢比較");
    const chartSeries =
      trendMode === "AM"
        ? [{ name: "AM Peak", column: "C", color: "087F75" }]
        : trendMode === "PM"
          ? [{ name: "PM Peak", column: "D", color: "D97706" }]
          : [
              { name: "AM Peak", column: "C", color: "087F75" },
              { name: "PM Peak", column: "D", color: "D97706" },
            ];
    await downloadEditableTrendWorkbook(
      workbook,
      "歷季趨勢比較",
      data.length + 1,
      chartSeries,
      (intersections.find(function (entry) {
        return entry[0] === activeIntersection;
      })?.[1] || "路口") +
        "_" +
        activeRangeStart +
        "_至_" +
        activeRangeEnd +
        "_" +
        (trendFlow === "outbound" ? "駛出總量" : "駛入總量") +
        "_歷季趨勢.xlsx",
    );
    props.notify("趨勢 Excel 已下載，折線圖可直接編輯。");
  }
  if (!props.records.length)
    return (
      <Empty title="尚無歷季資料" text="匯入同一路口至少兩季後即可比較。" />
    );
  return (
    <>
      <section className="page-head">
        <div>
          <span className="eyebrow">QUARTERLY TREND</span>
          <h1>歷季趨勢比較</h1>
          <p>
            選擇同一路口的起始與結束季度；圖中所有數值與 Y 軸名稱均標示單位。
          </p>
        </div>
        <div className="head-buttons">
          <button className="secondary" onClick={exportTrendExcel}>
            下載趨勢 Excel
          </button>
          <button className="primary" onClick={exportChart}>
            下載趨勢 PNG
          </button>
        </div>
      </section>
      <section className="trend-controls panel">
        <label>
          路口
          <select
            value={activeIntersection}
            onChange={function (e) {
              setSelectedIntersection(e.target.value);
            }}
          >
            {intersections.map(function (entry) {
              return (
                <option key={entry[0]} value={entry[0]}>
                  {entry[1]}
                </option>
              );
            })}
          </select>
        </label>
        {surveyTypes.length > 1 && (
          <label>
            資料別
            <select
              value={activeSurveyType}
              onChange={function (e) {
                setSurveyTypeFilter(e.target.value);
              }}
            >
              {surveyTypes.map(function (type) {
                return (
                  <option key={type} value={type}>
                    {type}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        {trend.parallelStations && (
          <label>
            站號
            <select
              value={trend.station}
              onChange={function (e) {
                setStationFilter(e.target.value);
              }}
            >
              {trend.availableStations.map(function (station) {
                return (
                  <option key={station} value={station}>
                    {station}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        <Segmented
          value={trendMode}
          options={[
            ["AM", "AM Peak"],
            ["PM", "PM Peak"],
            ["ALL", "整體"],
          ]}
          onChange={function (value) {
            setTrendMode(value);
            if (value !== "ALL") props.setPeak(value);
          }}
        />
        <Segmented
          value={trendFlow}
          options={[
            ["outbound", "駛出總量"],
            ["inbound", "駛入總量"],
          ]}
          onChange={setTrendFlow}
        />
        <div className="quarter-range">
          <label>
            起始季度
            <select
              value={activeRangeStart}
              onChange={function (e) {
                const next = e.target.value;
                setRangeStart(next);
                if (
                  allQuarters.indexOf(next) >
                  allQuarters.indexOf(activeRangeEnd)
                )
                  setRangeEnd(next);
              }}
            >
              {allQuarters.map(function (q) {
                return (
                  <option key={q} value={q}>
                    {q}
                  </option>
                );
              })}
            </select>
          </label>
          <span>至</span>
          <label>
            結束季度
            <select
              value={activeRangeEnd}
              onChange={function (e) {
                const next = e.target.value;
                setRangeEnd(next);
                if (
                  allQuarters.indexOf(next) <
                  allQuarters.indexOf(activeRangeStart)
                )
                  setRangeStart(next);
              }}
            >
              {allQuarters.map(function (q) {
                return (
                  <option key={q} value={q}>
                    {q}
                  </option>
                );
              })}
            </select>
          </label>
          <b>
            {chosen.length} 季 · 有資料 {rows.length} 季
          </b>
        </div>
        {rows.length > 0 && (
          <p
            className={
              flowGap ? "trend-station-note warn" : "trend-station-note"
            }
          >
            {flowGap
              ? `注意：這個路口的「駛出」與「駛入」總量不相等，最大差 ${Math.abs(flowGap).toLocaleString()} PCU/hr。` +
                "兩者是同一批流向、只是分組方式不同，總量本來應該相等；不相等代表有流向沒有指定目的支線。" +
                "請到「道路與流向管理」補齊，在補齊之前「駛入總量」會少掉這個量。"
              : "「駛出」與「駛入」總量相同：每一筆流向都有指定目的支線，兩種視角可以互相核對。" +
                "切換視角只會改變分組方式，不會改變路口總量。"}
          </p>
        )}
        {/*
          * 這個路口同時有「待設定」和真正的資料別時，趨勢線會被拆成兩條
          * ——選平日只剩 1 季、選待設定才有 4 季。這不是趨勢頁的計算問題，
          * 而是那幾季在匯入當下讀不出資料別（舊版），紀錄裡就存著待設定；
          * 資料別不會自己重讀，所以要在這裡讓使用者直接補完。
          */}
        {pendingHere.length > 0 && realSurveyTypes.length > 0 && (
          <p className="trend-station-note warn trend-pending-note">
            <span>
              這個路口有 <b>{pendingHere.length}</b> 季的資料別是「待設定」，
              另有 {realSurveyTypes.join("、")} 的資料
              ——「待設定」會被當成另一種資料別，所以趨勢線被拆成兩條
              （選「{realSurveyTypes[0]}」只看得到一部分的季度）。
              資料別是<b>匯入當下</b>判定並存進每一筆的，不會自己重讀，
              請直接指定：
            </span>
            <span className="trend-pending-list">
              尚未指定的是：
              <b>
                {pendingHere
                  .map(function (record) {
                    return record.quarter;
                  })
                  .join("、")}
              </b>
              （按下去之前會再列一次完整清單，含站號與路口名稱，讓您確認再決定）
            </span>
            <span className="trend-pending-warn">
              ⚠ <b>這幾季如果不是同一種資料別，不要用批次。</b>
              例如其中有幾季其實是假日調查，批次會把它們一起指定成同一種。
              這種情況請到左側選單的
              <b>「流量核對工作台」</b>
              ，用上方的路口選擇器選到那一筆，再用「資料別（平日／假日）」下拉
              <b>逐筆指定</b>
              。判斷依據是原始調查檔本身（調查日期是星期幾、檔名或工作表有沒有寫）。
            </span>
            <span className="trend-pending-actions">
              {["平日", "假日"].map(function (value) {
                return (
                  <button
                    key={value}
                    className="secondary"
                    onClick={function () {
                      props.assignPendingSurveyType(value, activeIntersection);
                    }}
                  >
                    把這個路口的 {pendingHere.length} 季都指定為{value}
                  </button>
                );
              })}
              {props.pendingCount > pendingHere.length && (
                <button
                  className="ghost"
                  onClick={function () {
                    props.assignPendingSurveyType("平日");
                  }}
                >
                  整個計畫的 {props.pendingCount} 筆都指定為平日
                </button>
              )}
            </span>
          </p>
        )}
        {trend.chainedStations && (
          <p className="trend-station-note">
            本路口的站號歷年有變動（{trend.stations.join(" → ")}
            ），已依路口名稱串接為同一條趨勢線。
          </p>
        )}
        {trend.parallelStations && (
          <p className="trend-station-note">
            同一季同時有多個站號（{trend.availableStations.join("、")}
            ），趨勢僅呈現所選站號；要看另一個站請切換上方「站號」。
          </p>
        )}
      </section>
      <section className="trend-layout">
        <article className="panel trend-chart">
          <div className="panel-head">
            <h2>
              {
                intersections.find(function (entry) {
                  return entry[0] === activeIntersection;
                })?.[1]
              }{" "}
              · {trendMode === "ALL" ? "AM／PM 整體" : trendMode}
            </h2>
            <span className="status-dot">PCU/hr</span>
          </div>
          {rows.length >= 2 ? (
            <div className="trend-svg-scroll">
              <svg
                id="trend-svg"
                xmlns="http://www.w3.org/2000/svg"
                width={chartWidth}
                height="390"
                viewBox={`0 0 ${chartWidth} 390`}
                role="img"
                aria-label="歷季尖峰小時交通量折線圖"
              >
                <rect width={chartWidth} height="390" fill="#fff" rx="12" />
                <text
                  x="22"
                  y="70"
                  className="y-axis-title"
                  writingMode="vertical-rl"
                >
                  尖峰小時交通量（PCU/hr）
                </text>
                <g className="grid-lines">
                  {[0, 1, 2, 3, 4].map(function (i) {
                    return (
                      <g key={i}>
                        <line
                          x1="84"
                          x2={chartWidth - 60}
                          y1={70 + i * 60}
                          y2={70 + i * 60}
                        />
                        <text x="75" y={75 + i * 60}>
                          {Math.round(max * (1 - i / 4)).toLocaleString()}{" "}
                          PCU/hr
                        </text>
                      </g>
                    );
                  })}
                </g>
                {trendMode === "ALL" && (
                  <g className="trend-legend">
                    <circle
                      cx={chartWidth - 205}
                      cy="35"
                      r="5"
                      fill="#087f75"
                    />
                    <text x={chartWidth - 194} y="39">
                      AM Peak
                    </text>
                    <circle
                      cx={chartWidth - 115}
                      cy="35"
                      r="5"
                      fill="#d97706"
                    />
                    <text x={chartWidth - 104} y="39">
                      PM Peak
                    </text>
                  </g>
                )}
                {series.map(function (item) {
                  return (
                    <g key={item.peak}>
                      <polyline
                        points={item.points
                          .map(function (p) {
                            return p.x + "," + p.y;
                          })
                          .join(" ")}
                        fill="none"
                        stroke={item.color}
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {item.points.map(function (p) {
                        return (
                          <g key={item.peak + "-" + p.record.id}>
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r="7"
                              fill="#fff"
                              stroke={item.color}
                              strokeWidth="4"
                            />
                            <text
                              x={p.x}
                              y={
                                p.y +
                                (trendMode === "ALL" && item.peak === "PM"
                                  ? 23
                                  : -16)
                              }
                              className="point-value"
                              fill={item.color}
                            >
                              {trendMode === "ALL" ? item.peak + " " : ""}
                              {/*
                                * 一定要用 totalOf，不能用 recordTotal。
                                * 點的座標（y）是用 totalOf 算的，會跟著駛出／駛入
                                * 視角變；recordTotal 永遠是駛出總量。兩者混用時，
                                * 資料有缺口（有流向沒指定目的支線）的路口切到
                                * 「駛入總量」，就會變成「點畫在駛入的高度、旁邊
                                * 標的卻是駛出的數字」，而且這張圖會被下載成 PNG
                                * 交出去。
                                */}
                              {totalOf(
                                p.record,
                                item.peak,
                              ).toLocaleString()}{" "}
                              PCU/hr
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
                {rows.map(function (record, index) {
                  const x =
                    100 +
                    (index * (chartWidth - 170)) / Math.max(1, rows.length - 1);
                  return (
                    <text key={record.id} x={x} y="355" className="x-label">
                      {record.quarter}
                    </text>
                  );
                })}
              </svg>
            </div>
          ) : (
            <Empty
              title="至少需要兩季資料"
              text={
                chosen.length > 1
                  ? `所選範圍有 ${chosen.length} 季，但這個路口在「${activeSurveyType || "此資料別"}」底下只有 ${rows.length} 季有資料。請改選其他資料別，或確認這些季度的路口名稱是否一致（名稱不同會被當成不同路口）。`
                  : "請擴大起始與結束季度範圍。"
              }
            />
          )}
        </article>
        <article className="panel trend-summary">
          <h2>季度變化</h2>
          {rows.map(function (record, index) {
            const activePeak: PeakKey = trendMode === "ALL" ? "AM" : trendMode;
            /* 同上：右側摘要也要跟著視角走，否則和左邊的折線圖互相矛盾。 */
            const value = totalOf(record, activePeak);
            const prior = index ? totalOf(rows[index - 1], activePeak) : 0;
            const pct = prior ? (value / prior - 1) * 100 : null;
            const pmValue = totalOf(record, "PM");
            const pmPrior = index ? totalOf(rows[index - 1], "PM") : 0;
            const pmPct = pmPrior ? (pmValue / pmPrior - 1) * 100 : null;
            return (
              <div key={record.id}>
                <span>{record.quarter}</span>
                {trendMode === "ALL" ? (
                  <>
                    <b className="trend-pair">
                      <span>AM {value.toLocaleString()} PCU/hr</span>
                      <span>PM {pmValue.toLocaleString()} PCU/hr</span>
                    </b>
                    <span className="trend-pcts">
                      <i
                        className={
                          pct == null ? "flat" : pct >= 0 ? "up" : "down"
                        }
                      >
                        AM{" "}
                        {pct == null
                          ? "基準"
                          : (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"}
                      </i>
                      <i
                        className={
                          pmPct == null ? "flat" : pmPct >= 0 ? "up" : "down"
                        }
                      >
                        PM{" "}
                        {pmPct == null
                          ? "基準"
                          : (pmPct >= 0 ? "+" : "") + pmPct.toFixed(1) + "%"}
                      </i>
                    </span>
                  </>
                ) : (
                  <>
                    <b>{value.toLocaleString()} PCU/hr</b>
                    <i
                      className={
                        pct == null ? "flat" : pct >= 0 ? "up" : "down"
                      }
                    >
                      {pct == null
                        ? "基準"
                        : (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"}
                    </i>
                  </>
                )}
              </div>
            );
          })}
        </article>
      </section>
    </>
  );
}
