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
} from "../lib/traffic";
import {
  branchBalance,
  conservationCheck,
  diagramCollisionWarnings,
  odMatrix,
  peakSensitivity,
  quarterQualitySummary,
  RecordRevision,
  REPORT_ITEMS,
  ReportItemKey,
  ReportTemplate,
  normalizeReportItems,
  VehicleScheme,
} from "../lib/final-features";

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
  { id: "reports", label: "報表與批次輸出", icon: "▤", group: "輸出與維護" },
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
    const inbound = emptyVehicle();
    const outbound = emptyVehicle();
    (record.routes || []).forEach(function (route) {
      if (!route.survey) return;
      if (route.fromApproachId === approach.id)
        analysisVehicles.forEach(function (vehicle) {
          inbound[vehicle] += Number(route.survey?.vehicle[vehicle] || 0);
        });
      if (route.toApproachId === approach.id)
        analysisVehicles.forEach(function (vehicle) {
          outbound[vehicle] += Number(route.survey?.vehicle[vehicle] || 0);
        });
    });
    const bidirectional = emptyVehicle();
    analysisVehicles.forEach(function (vehicle) {
      bidirectional[vehicle] = inbound[vehicle] + outbound[vehicle];
    });
    return [
      {
        approach,
        direction: bearingFromAngle(approach.angle + 180),
        relation: "駛入路口",
        vehicle: inbound,
      },
      {
        approach,
        direction: bearingFromAngle(approach.angle),
        relation: "駛離路口",
        vehicle: outbound,
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
  link.click();
  setTimeout(function () {
    URL.revokeObjectURL(link.href);
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
      '<c:overlay val="0"/></c:title><c:plotArea><c:layout/><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/><c:smooth val="0"/>' +
      seriesXml +
      '<c:axId val="48650112"/><c:axId val="48672768"/></c:lineChart>' +
      '<c:catAx><c:axId val="48650112"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-TW" sz="1000"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:rPr><a:t>調查季度</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title><c:tickLblPos val="nextTo"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr/><a:defRPr sz="900"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:defRPr></a:p></c:txPr><c:crossAx val="48672768"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>' +
      '<c:valAx><c:axId val="48672768"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:title><c:tx><c:rich><a:bodyPr rot="-5400000"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-TW" sz="1000"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:rPr><a:t>尖峰小時交通量（PCU/hr）</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title><c:numFmt formatCode="#,##0.0" sourceLinked="0"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="DDE6E3"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:tickLblPos val="nextTo"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr/><a:defRPr sz="900"><a:solidFill><a:srgbClr val="52666D"/></a:solidFill></a:defRPr></a:p></c:txPr><c:crossAx val="48650112"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>' +
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

function recordIntersectionKey(record: TrafficRecord) {
  return (
    canonicalIntersectionKey(record.name) ||
    record.intersectionId ||
    record.station
  );
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
  let applied = false;
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
    if (!current || current.quarter.localeCompare(record.quarter) < 0)
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
    ')"><text x="0">● 左轉</text><text x="70">● 直行</text><text x="140">● 右轉</text></g>' +
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

function emptyMovement(values: number[] | undefined, index: number) {
  const left = Number(values?.[index * 3]) || 0;
  const through = Number(values?.[index * 3 + 1]) || 0;
  const right = Number(values?.[index * 3 + 2]) || 0;
  return {
    left: left,
    through: through,
    right: right,
    vehicle: { motorcycle: 0, car: 0, heavy: 0, special: 0 },
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
          AM: useMapping
            ? mappedMovements[index].AM
            : emptyMovement(item.am?.values, index),
          PM: useMapping
            ? mappedMovements[index].PM
            : emptyMovement(item.pm?.values, index),
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
  item.columns.forEach(function (column) {
    const movement = column.movement || "through";
    const destination = destinationForColumn(column);
    if (destination)
      routeKeys.set(column.approach + "→" + destination, {
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
              return column.approach === route.from && destination === route.to;
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
          return column.approach === route.from && destination === route.to;
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
    movementRule: referenceMovementForOd(item.name, "A", "E")
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
}) {
  const record = props.record;
  const lockedCount = props.quarterRecords.filter(function (item) {
    return Boolean(item.resultLock);
  }).length;
  const conflicts = props.quarterRecords.map(lockConflict).filter(Boolean);
  if (!record)
    return (
      <Empty title="尚無可核對資料" text="請先選擇有匯入資料的計畫與季度。" />
    );
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
          <p>審核狀態不會改變計算；確認完成後可再鎖定季度。</p>
        </div>
        <select
          value={record.review?.status || "待核對"}
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
          onChange={function (event) {
            props.setReview(
              record.review?.status || "待核對",
              event.target.value,
            );
          }}
        />
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
          </div>
          <span className="status-dot">單位：PCU/hr；車種為輛/hr</span>
        </div>
        {record.approaches.map(function (origin) {
          const originRoutes = routes.filter(function (route) {
            return route.fromApproachId === origin.id;
          });
          if (!originRoutes.length) return null;
          const originTotal = originRoutes.reduce(function (sum, route) {
            return sum + route.volumes[props.peak].pcu;
          }, 0);
          return (
            <details className="audit-origin" key={origin.id} open>
              <summary>
                <span>
                  來源 {origin.sourceCode || origin.name} · {origin.name}
                </span>
                <strong>{originTotal.toLocaleString()} PCU/hr</strong>
              </summary>
              <div className="table-scroll">
                <table className="audit-table">
                  <thead>
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
                    {originRoutes.map(function (route) {
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
                            {origin.sourceCode || origin.name} →{" "}
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
  const [pce, setPce] = useState<PceMatrix>(DEFAULT_PCE);
  const [vehicleCatalog, setVehicleCatalog] =
    useState<Record<string, string>>(CORE_VEHICLE_LABELS);
  const [vehicleMappings, setVehicleMappings] = useState<VehicleMappingTable>(
    {},
  );
  const [importRows, setImportRows] = useState<ImportPreview[]>([]);
  const [formatMemories, setFormatMemories] = useState<FormatMemory[]>([]);
  const [vehicleSchemes, setVehicleSchemes] = useState<VehicleScheme[]>([]);
  // 報表匯出項目：每個計畫記住自己要的組合，另可存成可重複套用的範本
  const [reportTemplates, setReportTemplates] = useState<ReportTemplate[]>([]);
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
  const [batchProjectIds, setBatchProjectIds] = useState<string[]>([]);
  const [batchQuarterKeys, setBatchQuarterKeys] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * 讀檔／還原備份時再正規化一次路口名稱。
   * normalizeIntersectionName 會把所有括號拿掉，而匯入時會在名稱後面補上
   * 「（平日）」「（假日）」來區分同一路口的兩種資料別；直接再跑一次的話，
   * 重新整理後兩筆的名稱會變成「…平日」「…假日」，被當成兩個不同路口，
   * 資料別下拉、幾何同步與歷季比較都會跟著錯。這裡把括號內容原樣保留。
   */
  const renormalizeStoredName = function (input: string) {
    const name = String(input ?? "");
    const matched = /^(.*)（([^（）]*)）$/.exec(name);
    if (matched)
      return normalizeIntersectionName(matched[1]) + "（" + matched[2] + "）";
    return normalizeIntersectionName(name);
  };

  useEffect(function () {
    const saved =
      localStorage.getItem("turning-traffic-state-v2") ||
      localStorage.getItem("turning-traffic-state-v1");
    if (!saved) return;
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
                  name: renormalizeStoredName(record.name),
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
                  name: renormalizeStoredName(record.name),
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
      if (data.pce) setPce(data.pce);
      if (data.vehicleCatalog)
        setVehicleCatalog({ ...CORE_VEHICLE_LABELS, ...data.vehicleCatalog });
      if (data.vehicleMappings) setVehicleMappings(data.vehicleMappings);
      if (Array.isArray(data.formatMemories))
        setFormatMemories(data.formatMemories);
      if (Array.isArray(data.vehicleSchemes))
        setVehicleSchemes(data.vehicleSchemes);
      if (Array.isArray(data.reportTemplates))
        setReportTemplates(data.reportTemplates);
      if (Array.isArray(data.recordRevisions))
        setRecordRevisions(data.recordRevisions);
    } catch {
      /* Invalid stale local data is ignored. */
    }
  }, []);

  useEffect(
    function () {
      const base = {
        kind: "TURNING_TRAFFIC_STATE",
        version: VERSION,
        projects: projects,
        activeProjectId: activeProjectId,
        records: records,
        nameMap: nameMap,
        pce: pce,
        vehicleCatalog: vehicleCatalog,
        vehicleMappings: vehicleMappings,
        formatMemories: formatMemories,
        vehicleSchemes: vehicleSchemes,
        reportTemplates: reportTemplates,
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
      recordRevisions,
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
      ).sort();
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
      ).sort();
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
  const currentSum = current.reduce(function (sum, record) {
    return sum + recordTotal(record, "AM") + recordTotal(record, "PM");
  }, 0);
  const previous = projectRecords.filter(function (record) {
    return record.quarter === previousQuarter;
  });
  const previousSum = previous.reduce(function (sum, record) {
    return sum + recordTotal(record, "AM") + recordTotal(record, "PM");
  }, 0);
  const change = previousSum ? (currentSum / previousSum - 1) * 100 : null;
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
    const overwriteTargets = records.filter(function (record) {
      return (
        record.projectId === activeProjectId &&
        record.quarter === q &&
        originals.some(function (item) {
          return (
            record.station === item.station &&
            (record.surveyType || "") === (item.surveyType || "")
          );
        })
      );
    });
    if (!authorizeLockedChange(overwriteTargets, "重新匯入")) return;
    const next = [...records];
    originals.forEach(function (item) {
      const found = next.findIndex(function (record) {
        return (
          record.projectId === activeProjectId &&
          record.quarter === q &&
          record.station === item.station &&
          (record.surveyType || "待設定") === (item.surveyType || "待設定")
        );
      });
      const configuredItem = configuredImportPreview(
        item,
        pce,
        vehicleMappings,
      );
      const conflictMode = importConflictModes[item.file] || "overwrite";
      if (found >= 0 && conflictMode === "skip") return;
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
    });
    setRecords(next);
    setQuarter(q);
    setImportRows([]);
    setImportResolutions({});
    setImportConflictModes({});
    notify(
      "已寫入 " +
        originals.length +
        " 個路口；同計畫、同季度、同站號採覆蓋更新。",
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
    if (!selected) return;
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
    const trendTarget =
      exportRecords.find(function (record) {
        return (
          selected &&
          recordIntersectionKey(record) === recordIntersectionKey(selected)
        );
      }) || exportRecords[0];
    const trendKey = recordIntersectionKey(trendTarget);
    const trendRows = exportRecords
      .filter(function (record) {
        return recordIntersectionKey(record) === trendKey;
      })
      .sort(function (a, b) {
        return a.quarter.localeCompare(b.quarter);
      })
      .map(function (record) {
        return {
          季度: record.quarter,
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
            "AM 由支線駛入中央路口（PCU/hr）":
              amFlows[index].enteringIntersection,
            "AM 由中央路口駛出至支線（PCU/hr）":
              amFlows[index].leavingIntersection,
            "PM 尖峰時段": record.peaks.PM.start + "–" + record.peaks.PM.end,
            "PM 路口轉向總量（PCU/hr）": recordTotal(record, "PM"),
            "PM 由支線駛入中央路口（PCU/hr）":
              pmFlows[index].enteringIntersection,
            "PM 由中央路口駛出至支線（PCU/hr）":
              pmFlows[index].leavingIntersection,
          };
        });
      });
    const workbook = XLSX.utils.book_new();
    const trendSheet = XLSX.utils.json_to_sheet(trendRows);
    trendSheet["!cols"] = [12, 20, 20, 12, 30, 18, 18].map(function (wch) {
      return { wch };
    });
    trendSheet["!autofilter"] = { ref: trendSheet["!ref"] || "A1:A1" };
    for (let row = 2; row <= trendRows.length + 1; row++)
      ["B", "C"].forEach(function (column) {
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
      const rows = Object.keys(pce)
        .sort()
        .map(function (vehicleId) {
          return {
            車種代碼: vehicleId,
            車種名稱:
              vehicleCatalog[vehicleId] ||
              VEHICLE_LABELS[vehicleId as keyof typeof VEHICLE_LABELS] ||
              vehicleId,
            類別: CORE_VEHICLE_LABELS[vehicleId] ? "標準車種" : "新增車種",
            左轉當量: pce[vehicleId].left,
            直行當量: pce[vehicleId].through,
            右轉當量: pce[vehicleId].right,
            來源: CORE_VEHICLE_LABELS[vehicleId]
              ? "交通流量教育訓練簡報第 15 頁「當量參考值」"
              : "簡報未提供參考值，系統預設 1.0，由使用者確認",
          };
        });
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [18, 18, 12, 12, 12, 12, 52].map(function (wch) {
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
    ).sort();
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
              { name: "AM Peak", column: "B", color: "087F75" },
              { name: "PM Peak", column: "C", color: "D97706" },
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
    const requestedStartIndex = Math.max(
      0,
      quarters.indexOf(reportStartQuarter),
    );
    const requestedEndIndex = Math.max(0, quarters.indexOf(reportEndQuarter));
    const startIndex = Math.min(requestedStartIndex, requestedEndIndex);
    const endIndex = Math.max(requestedStartIndex, requestedEndIndex);
    const selectedQuarters = quarters.slice(startIndex, endIndex + 1);
    const exportRecords = projectRecords.filter(function (record) {
      return selectedQuarters.includes(record.quarter);
    });
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
          "all",
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
            await svgToPng(
              diagramMarkup(
                record,
                peak,
                "formal",
                "both",
                "all",
                "all",
                0,
                flowSummaryMode,
              ),
              2,
            ),
          );
        }
      }
      zip.file(
        "README.txt",
        "Turning Traffic 批次成果包\r\n範圍：" +
          selectedQuarters.join("、") +
          "\r\n內容：各計畫分析 Excel、多頁 PDF、各路口 PNG。\r\n單位：PCU/hr。\r\n",
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

  const backupPayload = function () {
    return {
      kind: "TURNING_TRAFFIC_BACKUP",
      version: VERSION,
      exportedAt: new Date().toISOString(),
      projects: projects,
      activeProjectId: activeProjectId,
      records: records,
      nameMap: nameMap,
      pce: pce,
      vehicleCatalog: vehicleCatalog,
      vehicleMappings: vehicleMappings,
      formatMemories: formatMemories,
      vehicleSchemes: vehicleSchemes,
      reportTemplates: reportTemplates,
      recordRevisions: recordRevisions,
    };
  };
  async function exportBackupZip() {
    const zip = new JSZip();
    zip.file(
      "turning-traffic-backup.json",
      JSON.stringify(backupPayload(), null, 2),
    );
    zip.file(
      "README.txt",
      "Turning Traffic 完整備份\r\n在另一台電腦開啟系統後，到「備份、還原與版本」匯入本 ZIP。\r\n包含所有計畫、季度路口資料、名稱映射與當量參數。\r\n",
    );
    downloadBlob(
      await zip.generateAsync({ type: "blob" }),
      "Turning-Traffic_完整備份_" +
        new Date().toISOString().slice(0, 10) +
        ".zip",
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
      setProjects(restoredProjects);
      setActiveProjectId(data.activeProjectId || fallbackId);
      setRecords(
        synchronizeGeometryAcrossQuarters(
          data.records.map(function (record: TrafficRecord) {
            return applyReferenceMovementRule({
              ...record,
              projectId: record.projectId || fallbackId,
              name: renormalizeStoredName(record.name),
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
      setNameMap(data.nameMap || {});
      setPce(data.pce || DEFAULT_PCE);
      setVehicleCatalog({
        ...CORE_VEHICLE_LABELS,
        ...(data.vehicleCatalog || {}),
      });
      setVehicleMappings(data.vehicleMappings || {});
      setFormatMemories(
        Array.isArray(data.formatMemories) ? data.formatMemories : [],
      );
      setVehicleSchemes(
        Array.isArray(data.vehicleSchemes) ? data.vehicleSchemes : [],
      );
      setReportTemplates(
        Array.isArray(data.reportTemplates) ? data.reportTemplates : [],
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
                    每個計畫可保有自己的季度、路口與參數，並可跨計畫比較與整包移轉。
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
                      label="較上季總流量"
                      value={
                        change == null
                          ? "—"
                          : (change >= 0 ? "+" : "") + change.toFixed(1) + "%"
                      }
                      note={
                        previousQuarter
                          ? "比較基準 " + previousQuarter
                          : "尚無上季資料"
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
                  <button
                    className="primary"
                    disabled={!importRows.length || !importPeriod}
                    onClick={commitImport}
                  >
                    確認寫入 {importPeriod || "未選季度"}
                  </button>
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
                          const matched = canonicalRecords.find(
                            function (record) {
                              return (
                                (record.intersectionId ||
                                  canonicalIntersectionKey(record.name)) ===
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
                                      <option value="version">
                                        保留舊版並建立新版
                                      </option>
                                      <option value="overwrite">
                                        覆蓋目前版（仍留還原點）
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
                                      const id =
                                        record.intersectionId ||
                                        canonicalIntersectionKey(record.name);
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
                                  if (
                                    confirm(
                                      "刪除 " +
                                        record.station +
                                        " " +
                                        record.name +
                                        "？",
                                    )
                                  )
                                    setRecords(
                                      records.filter(function (r) {
                                        return r.id !== record.id;
                                      }),
                                    );
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
                            依各支線的駛入／駛離 OD
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
                            <th>目的路口／道路支線</th>
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
                      判定原則：各目的路口加總應等於同一統計範圍的路口總量；若有未分配流向，資料品質檢查將提示差異，不採用外部計算表的漏算結果。
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
                            record.approaches.push({
                              ...structuredClone(record.approaches[0]),
                              id: record.station + "-A" + (i + 1),
                              // 每條人工支線要有自己的代碼；全部叫「人工」的話，
                              // 跨季度同步是用代碼比對的，會把好幾條支線併成同一條。
                              sourceCode: "人工" + (i + 1),
                              name: "新增支線 " + (i + 1),
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
                                <small>
                                  直接在圖上拖曳圖卡或「{approach.name}
                                  」標籤即可調整位置；
                                  只看駛入、只看駛出、駛入＋駛出三種畫面各自記住自己的位置。
                                </small>
                              </div>
                              <button
                                className="icon-danger"
                                disabled={selected.approaches.length <= 3}
                                onClick={function () {
                                  updateSelected(function (record) {
                                    record.approaches.splice(index, 1);
                                    return record;
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
                      {diagramCollisionWarnings(selected, flowSummaryMode)
                        .length > 0 && (
                        <div className="collision-warning">
                          <b>匯出前排版預警</b>
                          {diagramCollisionWarnings(
                            selected,
                            flowSummaryMode,
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
                              本路口採 T15-01 參考計算檔的既有分法；D
                              支線沒有直行流向。調整圖面角度不會覆蓋此分類。
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
                    const am = selectedQuarterRows.reduce(function (sum, r) {
                      return sum + recordTotal(r, "AM");
                    }, 0);
                    const pm = selectedQuarterRows.reduce(function (sum, r) {
                      return sum + recordTotal(r, "PM");
                    }, 0);
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
                            <dt>AM Peak 合計</dt>
                            <dd>{am.toLocaleString()} PCU/hr</dd>
                          </div>
                          <div>
                            <dt>PM Peak 合計</dt>
                            <dd>{pm.toLocaleString()} PCU/hr</dd>
                          </div>
                        </dl>
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
                        「駛入」為車流由支線進入中央路口；「駛出」為車流由中央路口進入該支線。各支線駛入或駛出合計皆應等於路口尖峰轉向總量，單位均為
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
                                      <th>駛入路口</th>
                                      <th>駛出至支線</th>
                                      <th>駛入路口</th>
                                      <th>駛出至支線</th>
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
                          return (
                            <tr key={key}>
                              <td>{key}</td>
                              <td>
                                <input
                                  value={record.name}
                                  onChange={function (e) {
                                    const value = e.target.value;
                                    const targets = records.filter(
                                      function (item) {
                                        return (
                                          recordIntersectionKey(item) === key
                                        );
                                      },
                                    );
                                    if (
                                      !authorizeLockedChange(
                                        targets,
                                        "路口名稱修改",
                                      )
                                    )
                                      return;
                                    setRecords(function (all) {
                                      return all.map(function (item) {
                                        return recordIntersectionKey(item) ===
                                          key
                                          ? {
                                              ...item,
                                              name: value,
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
                    (diagramCollisionWarnings(selected, flowSummaryMode).length
                      ? "has-warning"
                      : "ready")
                  }
                >
                  <div>
                    <span className="eyebrow">EXPORT PREFLIGHT</span>
                    <h2>匯出前檢查 · {selected.station}</h2>
                    <p>
                      {diagramCollisionWarnings(selected, flowSummaryMode)
                        .length
                        ? diagramCollisionWarnings(
                            selected,
                            flowSummaryMode,
                          ).join("；") + "。請先到道路與流向管理拖曳圖卡位置。"
                        : "圖卡位置未偵測到重疊；日期、尖峰時段與單位會一併輸出。"}
                    </p>
                  </div>
                  <strong>
                    {diagramCollisionWarnings(selected, flowSummaryMode).length
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
                                    ).sort()
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
                    A 電腦下載 ZIP／JSON，B
                    電腦開啟同網站匯入，即可接續全部計畫與設定。
                  </p>
                </div>
              </section>
              <section className="backup-grid">
                <article className="panel">
                  <span>01</span>
                  <h2>完整 ZIP</h2>
                  <p>所有計畫、季度、名稱映射與當量參數。</p>
                  <button className="primary full" onClick={exportBackupZip}>
                    下載 ZIP
                  </button>
                </article>
                <article className="panel">
                  <span>02</span>
                  <h2>JSON 純資料</h2>
                  <p>適合版本比較與長期封存。</p>
                  <button
                    className="secondary full"
                    onClick={function () {
                      downloadBlob(
                        new Blob([JSON.stringify(backupPayload(), null, 2)], {
                          type: "application/json",
                        }),
                        "turning-traffic-backup.json",
                      );
                    }}
                  >
                    下載 JSON
                  </button>
                </article>
                <article className="panel">
                  <span>03</span>
                  <h2>在另一台電腦還原</h2>
                  <p>匯入 ZIP 或 JSON 後會恢復完整狀態。</p>
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
                    會清除所有計畫與設定，且不會恢復任何示範值；請先下載完整備份。
                  </p>
                </div>
                <button
                  onClick={function () {
                    if (
                      confirm("確定清除這台電腦內的 Turning Traffic 資料？")
                    ) {
                      setProjects([]);
                      setRecords([]);
                      setNameMap({});
                      setActiveProjectId("");
                      setQuarter("");
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
                    href="./Turning-Traffic-v2.1.1-新手操作手冊.pdf"
                    download
                  >
                    下載完整 PDF 手冊
                  </a>
                  <a
                    className="secondary help-download"
                    href="./Turning-Traffic-v2.1.1-新手操作手冊.docx"
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

function TrendView(props: {
  records: TrafficRecord[];
  peak: PeakKey;
  setPeak: (value: PeakKey) => void;
  notify: (value: string) => void;
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
  ).sort();
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
      ).sort();
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
  const startIndex = Math.max(0, allQuarters.indexOf(activeRangeStart));
  const endIndex = Math.max(startIndex, allQuarters.indexOf(activeRangeEnd));
  const chosen = allQuarters.slice(startIndex, endIndex + 1);
  const rows = props.records
    .filter(function (record) {
      return (
        intersectionKey(record) === activeIntersection &&
        chosen.includes(record.quarter)
      );
    })
    .sort(function (a, b) {
      return a.quarter.localeCompare(b.quarter);
    });
  const trendPeaks: PeakKey[] =
    trendMode === "ALL" ? ["AM", "PM"] : [trendMode];
  const values = rows.flatMap(function (record) {
    return trendPeaks.map(function (peak) {
      return recordTotal(record, peak);
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
          y: 310 - (recordTotal(record, peak) / max) * 235,
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
        "_歷季趨勢.png",
    );
    props.notify("趨勢圖已下載。");
  }
  async function exportTrendExcel() {
    if (!rows.length) return props.notify("目前範圍沒有可輸出的季度資料。");
    const data = rows.map(function (record, index) {
      const am = recordTotal(record, "AM");
      const pm = recordTotal(record, "PM");
      const priorAm = index ? recordTotal(rows[index - 1], "AM") : 0;
      const priorPm = index ? recordTotal(rows[index - 1], "PM") : 0;
      return {
        季度: record.quarter,
        "AM Peak（PCU/hr）": am,
        "PM Peak（PCU/hr）": pm,
        "AM 較前季（%）": priorAm ? am / priorAm - 1 : null,
        "PM 較前季（%）": priorPm ? pm / priorPm - 1 : null,
        站號: record.station,
        路口名稱: record.name,
        "AM 尖峰時段": record.peaks.AM.start + "–" + record.peaks.AM.end,
        "PM 尖峰時段": record.peaks.PM.start + "–" + record.peaks.PM.end,
      };
    });
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet["!cols"] = [12, 20, 20, 18, 18, 12, 30, 18, 18].map(function (wch) {
      return { wch };
    });
    sheet["!autofilter"] = { ref: sheet["!ref"] || "A1:A1" };
    for (let row = 2; row <= data.length + 1; row++)
      ["B", "C"].forEach(function (column) {
        if (sheet[column + row]) sheet[column + row].z = "#,##0.0";
      });
    for (let row = 2; row <= data.length + 1; row++)
      ["D", "E"].forEach(function (column) {
        if (sheet[column + row]) sheet[column + row].z = "0.0%";
      });
    XLSX.utils.book_append_sheet(workbook, sheet, "歷季趨勢比較");
    const chartSeries =
      trendMode === "AM"
        ? [{ name: "AM Peak", column: "B", color: "087F75" }]
        : trendMode === "PM"
          ? [{ name: "PM Peak", column: "C", color: "D97706" }]
          : [
              { name: "AM Peak", column: "B", color: "087F75" },
              { name: "PM Peak", column: "C", color: "D97706" },
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
          <b>{chosen.length} 季</b>
        </div>
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
                              {recordTotal(
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
            <Empty title="至少需要兩季資料" text="請擴大起始與結束季度範圍。" />
          )}
        </article>
        <article className="panel trend-summary">
          <h2>季度變化</h2>
          {rows.map(function (record, index) {
            const activePeak: PeakKey = trendMode === "ALL" ? "AM" : trendMode;
            const value = recordTotal(record, activePeak);
            const prior = index ? recordTotal(rows[index - 1], activePeak) : 0;
            const pct = prior ? (value / prior - 1) * 100 : null;
            const pmValue = recordTotal(record, "PM");
            const pmPrior = index ? recordTotal(rows[index - 1], "PM") : 0;
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
