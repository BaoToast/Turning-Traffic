"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { jsPDF } from "jspdf";
import {
  Approach,
  computeVC,
  DEFAULT_PCE,
  formatMinutes,
  ImportPreview,
  inspectWorkbook,
  LANE_GUIDANCE,
  LaneType,
  normalizeIntersectionName,
  PceMatrix,
  PeakKey,
  Project,
  qualityIssues,
  recordTotal,
  totalMovement,
  TrafficRecord,
  VehicleKey,
  VERSION,
  VERSION_HISTORY,
} from "../lib/traffic";

type View = "dashboard" | "projects" | "import" | "parameters" | "diagram" | "compare" | "trend" | "quality" | "names" | "geometry" | "reports" | "backup";
type DiagramStyle = "formal" | "standard" | "simple";
type DisplayMode = "volume" | "percent" | "both";
type ArrowMode = "all" | "focus";

const NAV: { id: View; label: string; icon: string; group?: string }[] = [
  { id: "dashboard", label: "總覽儀表板", icon: "⌂" },
  { id: "projects", label: "多計畫管理", icon: "▦", group: "資料管理" },
  { id: "import", label: "季度批次匯入", icon: "⇧" },
  { id: "quality", label: "資料品質檢查", icon: "✓" },
  { id: "names", label: "路口名稱管理", icon: "Aa" },
  { id: "parameters", label: "當量與容量參數", icon: "ƒ" },
  { id: "geometry", label: "道路與號誌管理", icon: "✣" },
  { id: "diagram", label: "路口轉向圖", icon: "↗", group: "分析與圖表" },
  { id: "compare", label: "跨計畫／多路口比較", icon: "▥" },
  { id: "trend", label: "歷季趨勢比較", icon: "⌁" },
  { id: "reports", label: "報表與批次輸出", icon: "▤", group: "輸出與維護" },
  { id: "backup", label: "備份、還原與版本", icon: "⟳" },
];

const VEHICLE_LABELS: Record<VehicleKey, string> = {
  all: "全部車種", motorcycle: "機車", car: "小客車", lightTruck: "小貨車", heavy: "大型車", bus: "大客車",
};
const PCE_LABELS = { special: "特種車", heavy: "大型車", car: "小客車", motorcycle: "機車" };
const MOVE_LABELS = { left: "左轉", through: "直行", right: "右轉" };

function esc(value: string | number) {
  return String(value).replace(/[<>&"']/g, function (char) {
    return ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" } as Record<string, string>)[char] || char;
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(function () { URL.revokeObjectURL(link.href); }, 1500);
}

function circularDistance(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function closestDestination(approaches: Approach[], sourceIndex: number, targetAngle: number) {
  return approaches.map(function (approach, index) {
    return { index: index, distance: index === sourceIndex ? 999 : circularDistance(approach.angle, targetAngle) };
  }).sort(function (a, b) { return a.distance - b.distance; })[0].index;
}

function diagramMarkup(record: TrafficRecord, peak: PeakKey, style: DiagramStyle, mode: DisplayMode, vehicle: VehicleKey, arrowMode: ArrowMode, focusIndex: number) {
  const width = 1000, height = 820, cx = 500, cy = 430;
  const n = record.approaches.length;
  const total = Math.max(1, recordTotal(record, peak));
  const point = function (angle: number, radius: number) {
    const rad = angle * Math.PI / 180;
    return { x: cx + Math.cos(rad) * radius, y: cy + Math.sin(rad) * radius };
  };
  const roadParts: string[] = [];
  const pathParts: string[] = [];
  const cardParts: string[] = [];
  const names = ["left", "through", "right"] as const;
  const offsets = [-12, 0, 12];
  const colors = { left: "#d64ba7", through: "#2166d1", right: "#e24538" };

  record.approaches.forEach(function (approach, index) {
    const p = point(approach.angle, 205);
    const cardP = point(approach.angle, n > 4 ? 320 : 300);
    const roadWidth = n > 5 ? 62 : 90;
    roadParts.push(
      '<g transform="rotate(' + (approach.angle + 90) + ' ' + cx + ' ' + cy + ')">' +
      '<rect x="' + (cx - roadWidth / 2) + '" y="85" width="' + roadWidth + '" height="300" rx="3" class="road"/>' +
      '<path d="M ' + cx + ' 98 V 374" class="divider"/></g>' +
      '<g transform="translate(' + p.x + ' ' + p.y + ')"><rect x="-77" y="-14" width="154" height="28" rx="14" class="road-label-bg"/>' +
      '<text class="road-name" x="0" y="5">' + esc(approach.name) + '</text></g>'
    );

    const values = names.map(function (key) { return totalMovement(approach, peak, key, vehicle); });
    const approachTotal = values.reduce(function (a, b) { return a + b; }, 0);
    const destinations = [
      closestDestination(record.approaches, index, approach.angle + 90),
      closestDestination(record.approaches, index, approach.angle + 180),
      closestDestination(record.approaches, index, approach.angle - 90),
    ];

    names.forEach(function (key, moveIndex) {
      if (arrowMode === "focus" && index !== focusIndex) return;
      const start = point(approach.angle, 145 + offsets[moveIndex]);
      const destination = record.approaches[destinations[moveIndex]];
      const end = point(destination.angle, 158 + offsets[moveIndex]);
      const sourceRad = approach.angle * Math.PI / 180;
      const normalX = -Math.sin(sourceRad) * offsets[moveIndex];
      const normalY = Math.cos(sourceRad) * offsets[moveIndex];
      const c1x = cx + normalX * 2.2, c1y = cy + normalY * 2.2;
      const klass = arrowMode === "focus" ? "movement-path focus " + key : "movement-path " + key;
      pathParts.push(
        '<path class="' + klass + '" d="M ' + start.x.toFixed(1) + ' ' + start.y.toFixed(1) +
        ' Q ' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + end.x.toFixed(1) + ' ' + end.y.toFixed(1) +
        '" marker-end="url(#arrow-' + key + ')"><title>' + esc(approach.name) + ' ' + MOVE_LABELS[key] + ' → ' + esc(destination.name) + '</title></path>'
      );
    });

    if (style === "simple") return;
    const cardWidth = n > 4 ? 174 : 230;
    const x = Math.max(8, Math.min(width - cardWidth - 8, cardP.x - cardWidth / 2));
    const y = Math.max(112, Math.min(height - 112, cardP.y - 48));
    const cell = cardWidth / 3;
    const formatter = function (value: number) {
      const pct = approachTotal ? Math.round(value / approachTotal * 100) + "%" : "0%";
      if (mode === "percent") return pct;
      if (mode === "volume") return value.toLocaleString() + " PCU/hr";
      return value.toLocaleString() + " PCU/hr | " + pct;
    };
    const destinationLabels = destinations.map(function (dest) { return record.approaches[dest].name; });
    cardParts.push(
      '<g transform="translate(' + x + ' ' + y + ')"><rect width="' + cardWidth + '" height="96" rx="9" class="flow-card"/>' +
      '<text x="' + (cardWidth / 2) + '" y="-9" class="bearing">' + esc(approach.bearing) + '向 · ' + esc(approach.name) + '</text>' +
      '<line x1="' + cell + '" x2="' + cell + '" y1="0" y2="70" class="cell-line"/><line x1="' + (cell * 2) + '" x2="' + (cell * 2) + '" y1="0" y2="70" class="cell-line"/>' +
      names.map(function (key, moveIndex) {
        return '<text x="' + (cell * (moveIndex + 0.5)) + '" y="18" class="turn ' + key + '">' + MOVE_LABELS[key] + '</text>' +
          '<text x="' + (cell * (moveIndex + 0.5)) + '" y="36" class="destination">→' + esc(destinationLabels[moveIndex].slice(0, 8)) + '</text>' +
          '<text x="' + (cell * (moveIndex + 0.5)) + '" y="58" class="value">' + esc(formatter(values[moveIndex])) + '</text>';
      }).join("") +
      '<line x1="0" x2="' + cardWidth + '" y1="70" y2="70" class="cell-line"/><text x="' + (cardWidth / 2) + '" y="88" class="sum">方向合計 ' + approachTotal.toLocaleString() + ' PCU/hr</text></g>'
    );
  });

  const peakText = peak + " Peak " + record.peaks[peak].start + "–" + record.peaks[peak].end;
  const meta = style === "simple" ? "" :
    '<g class="meta"><text x="30" y="38" class="title">' + esc(record.station) + '｜' + esc(record.name) + '</text>' +
    '<text x="30" y="64">調查日期 ' + esc(record.date || "未填") + '　' + esc(peakText) + '　單位：PCU/hr</text>' +
    '<text x="30" y="86">季度 ' + esc(record.quarter) + '　車種 ' + esc(VEHICLE_LABELS[vehicle]) + '　全路口流量 ' + total.toLocaleString() + ' PCU/hr</text></g>';
  const focusNote = arrowMode === "focus" && record.approaches[focusIndex]
    ? '<g transform="translate(30 775)"><text class="legend-title">聚焦：' + esc(record.approaches[focusIndex].name) + '</text></g>' : "";

  return '<svg id="turning-svg" xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc(record.name) + ' ' + esc(peakText) + ' 轉向圖">' +
    '<style>.canvas{fill:#fffdf8}.road{fill:#e8edf0;stroke:#9eabb1;stroke-width:1.4}.divider{fill:none;stroke:#fff;stroke-width:2;stroke-dasharray:9 8}.road-label-bg{fill:#fffdf8;stroke:#d5dddf}.road-name{font:600 12px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#334d56;text-anchor:middle}.junction{fill:#dfe6e8;stroke:#819198;stroke-width:2}.flow-card{fill:#fff;stroke:#1b5364;stroke-width:1.5;filter:url(#shadow)}.cell-line{stroke:#cfdbdf}.bearing{font:600 11px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#274b58;text-anchor:middle}.turn{font:700 10px sans-serif;text-anchor:middle}.turn.left{fill:#b82d89}.turn.through{fill:#1656b4}.turn.right{fill:#c6352a}.destination{font:8px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#718188;text-anchor:middle}.value{font:700 9px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#102c36;text-anchor:middle}.sum{font:600 9px sans-serif;fill:#087f75;text-anchor:middle}.title{font:700 19px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#102c36}.meta text:not(.title){font:11px Noto Sans TC,Microsoft JhengHei,sans-serif;fill:#5f7076}.north{font:700 13px sans-serif;fill:#183d49}.center-label{font:700 12px sans-serif;fill:#fff;text-anchor:middle}.center-dot{fill:#0e7c75}.movement-path{fill:none;stroke-width:2;opacity:.54}.movement-path.left{stroke:' + colors.left + '}.movement-path.through{stroke:' + colors.through + '}.movement-path.right{stroke:' + colors.right + '}.movement-path.focus{stroke-width:5;opacity:.98}.legend text{font:700 10px Noto Sans TC,sans-serif;fill:#415961}.legend-title{font:700 11px Noto Sans TC,sans-serif;fill:#173d49}</style>' +
    '<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity=".12"/></filter>' +
    '<marker id="arrow-left" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="' + colors.left + '"/></marker>' +
    '<marker id="arrow-through" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="' + colors.through + '"/></marker>' +
    '<marker id="arrow-right" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="' + colors.right + '"/></marker></defs>' +
    '<rect class="canvas" width="' + width + '" height="' + height + '" rx="12"/>' + meta + roadParts.join("") +
    '<rect x="' + (cx - 82) + '" y="' + (cy - 82) + '" width="164" height="164" rx="18" class="junction"/>' + pathParts.join("") +
    '<circle cx="' + cx + '" cy="' + cy + '" r="31" class="center-dot"/><text x="' + cx + '" y="' + (cy - 3) + '" class="center-label">' + esc(record.station) + '</text><text x="' + cx + '" y="' + (cy + 15) + '" class="center-label">' + peak + '</text>' +
    cardParts.join("") + '<g class="legend" transform="translate(720 785)"><text x="0">● 左轉</text><text x="70">● 直行</text><text x="140">● 右轉</text></g>' + focusNote +
    '<g transform="translate(948 26)"><text x="12" y="12" class="north">N</text><path d="M12 56V21M12 21L5 32M12 21l7 11" fill="none" stroke="#183d49" stroke-width="2"/></g></svg>';
}

async function svgToPng(svg: string, scale = 2) {
  return new Promise<Blob>(function (resolve, reject) {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    image.onload = function () {
      const canvas = document.createElement("canvas");
      canvas.width = image.width * scale;
      canvas.height = image.height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas unavailable"));
      ctx.scale(scale, scale);
      ctx.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob) { return blob ? resolve(blob) : reject(new Error("PNG conversion failed")); }, "image/png");
    };
    image.onerror = reject;
    image.src = url;
  });
}

function emptyMovement(values: number[] | undefined, index: number) {
  const left = Number(values?.[index * 3]) || 0;
  const through = Number(values?.[index * 3 + 1]) || 0;
  const right = Number(values?.[index * 3 + 2]) || 0;
  const total = left + through + right;
  return {
    left: left, through: through, right: right,
    vehicle: { motorcycle: 0, car: total, lightTruck: 0, heavy: 0, bus: 0 },
  };
}

function recordFromPreview(item: ImportPreview, projectId: string, quarter: string): TrafficRecord {
  const length = Math.max(item.am?.values.length || 0, item.pm?.values.length || 0);
  const armCount = length >= 9 && length <= 21 && length % 3 === 0 ? length / 3 : 4;
  const bearings = armCount === 3 ? ["北", "東", "南"] : ["北", "東", "南", "西", "東北", "東南", "西南"];
  const approaches: Approach[] = Array.from({ length: armCount }, function (_, index) {
    return {
      id: item.station + "-A" + (index + 1), name: "支線 " + (index + 1), bearing: bearings[index] || "支線",
      angle: -90 + index * 360 / armCount, lanes: null, laneType: "custom", saturationFlow: null,
      effectiveGreen: null, cycleLength: null, capacity: null,
      movements: { AM: emptyMovement(item.am?.values, index), PM: emptyMovement(item.pm?.values, index) },
    };
  });
  return {
    id: projectId + "-" + quarter + "-" + item.station, projectId: projectId, station: item.station, name: item.name,
    rawName: item.file, quarter: quarter, date: "", surveyType: "待設定",
    peaks: {
      AM: item.am ? { start: formatMinutes(item.am.start), end: formatMinutes(item.am.end) } : { start: "", end: "" },
      PM: item.pm ? { start: formatMinutes(item.pm.start), end: formatMinutes(item.pm.end) } : { start: "", end: "" },
    },
    approaches: approaches, sourceFiles: [item.file], importedAt: new Date().toISOString(),
    validation: { referenceFound: false, matchRate: null, notes: ["已使用連續 4 個 15 分鐘區間重算；欄位與支線對應需人工確認。"] },
  };
}

function Kpi(props: { label: string; value: string; note: string; accent?: string }) {
  return <article className={"kpi " + (props.accent || "")}><div className="kpi-top"><span>{props.label}</span><i /></div><strong>{props.value}</strong><small>{props.note}</small></article>;
}
function Empty(props: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span>◇</span><strong>{props.title}</strong><p>{props.text}</p>{props.action}</div>;
}
function Segmented<T extends string>(props: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return <div className="segmented">{props.options.map(function (option) { return <button key={option[0]} className={option[0] === props.value ? "active" : ""} onClick={function () { props.onChange(option[0]); }}>{option[1]}</button>; })}</div>;
}

export default function TrafficApp() {
  const [view, setView] = useState<View>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [records, setRecords] = useState<TrafficRecord[]>([]);
  const [quarter, setQuarter] = useState("");
  const [station, setStation] = useState("");
  const [peak, setPeak] = useState<PeakKey>("AM");
  const [diagramStyle, setDiagramStyle] = useState<DiagramStyle>("formal");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("both");
  const [arrowMode, setArrowMode] = useState<ArrowMode>("all");
  const [focusIndex, setFocusIndex] = useState(0);
  const [vehicle, setVehicle] = useState<VehicleKey>("all");
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [pce, setPce] = useState<PceMatrix>(DEFAULT_PCE);
  const [importRows, setImportRows] = useState<ImportPreview[]>([]);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [projectForm, setProjectForm] = useState({ code: "", name: "", client: "", note: "" });
  const [compareProjects, setCompareProjects] = useState<string[]>([]);
  const [calc, setCalc] = useState({ count: "", seconds: "", green: "", yellow: "", lost: "", cycle: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(function () {
    const saved = localStorage.getItem("turning-traffic-state-v2") || localStorage.getItem("turning-traffic-state-v1");
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      const oldDemo = data.version === "v1.0.0" && Array.isArray(data.records) && data.records.length === 20 && data.records.every(function (r: TrafficRecord) { return r.importedAt === "2026-08-11T09:00:00+08:00"; });
      if (!oldDemo && Array.isArray(data.records)) setRecords(data.records);
      if (Array.isArray(data.projects)) { setProjects(data.projects); setActiveProjectId(data.activeProjectId || data.projects[0]?.id || ""); }
      if (data.nameMap) setNameMap(data.nameMap);
      if (data.pce) setPce(data.pce);
    } catch { /* Invalid stale local data is ignored. */ }
  }, []);

  useEffect(function () {
    localStorage.setItem("turning-traffic-state-v2", JSON.stringify({ kind: "TURNING_TRAFFIC_STATE", version: VERSION, projects: projects, activeProjectId: activeProjectId, records: records, nameMap: nameMap, pce: pce }));
  }, [projects, activeProjectId, records, nameMap, pce]);

  const notify = function (message: string) { setToast(message); setTimeout(function () { setToast(""); }, 2800); };
  const activeProject = projects.find(function (project) { return project.id === activeProjectId; });
  const projectRecords = useMemo(function () { return records.filter(function (record) { return record.projectId === activeProjectId; }); }, [records, activeProjectId]);
  const quarters = useMemo(function () { return Array.from(new Set(projectRecords.map(function (record) { return record.quarter; }))).sort(); }, [projectRecords]);
  useEffect(function () { if (!quarter || !quarters.includes(quarter)) setQuarter(quarters.at(-1) || ""); }, [quarters, quarter]);
  const current = projectRecords.filter(function (record) { return record.quarter === quarter; });
  const selected = current.find(function (record) { return record.station === station; }) || current[0] || projectRecords[0] || null;
  useEffect(function () { if (selected && selected.station !== station) setStation(selected.station); }, [selected, station]);
  const issues = useMemo(function () { return qualityIssues(projectRecords); }, [projectRecords]);
  const currentIssues = issues.filter(function (issue) { return issue.quarter === quarter; });
  const ranked = [...current].sort(function (a, b) { return recordTotal(b, peak) - recordTotal(a, peak); });
  const top = ranked[0];
  const previousQuarter = quarters[quarters.indexOf(quarter) - 1];
  const currentSum = current.reduce(function (sum, record) { return sum + recordTotal(record, "AM") + recordTotal(record, "PM"); }, 0);
  const previous = projectRecords.filter(function (record) { return record.quarter === previousQuarter; });
  const previousSum = previous.reduce(function (sum, record) { return sum + recordTotal(record, "AM") + recordTotal(record, "PM"); }, 0);
  const change = previousSum ? (currentSum / previousSum - 1) * 100 : null;
  const maxRank = Math.max(1, ...ranked.map(function (record) { return recordTotal(record, peak); }));

  function addProject() {
    if (!projectForm.name.trim()) return notify("請先輸入計畫名稱。");
    const id = "P-" + Date.now().toString(36);
    const project: Project = { id: id, code: projectForm.code.trim() || "P" + (projects.length + 1), name: projectForm.name.trim(), client: projectForm.client.trim(), note: projectForm.note.trim(), createdAt: new Date().toISOString() };
    setProjects([...projects, project]);
    setActiveProjectId(id);
    setCompareProjects(function (all) { return [...all, id].slice(-4); });
    setProjectForm({ code: "", name: "", client: "", note: "" });
    notify("計畫已建立，現在可匯入第一季資料。");
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setImporting(true);
    const rows: ImportPreview[] = [];
    for (const file of Array.from(files)) {
      try { rows.push(await inspectWorkbook(file)); }
      catch (error) {
        rows.push({ file: file.name, station: "—", name: normalizeIntersectionName(file.name), role: "無法辨識", sheets: { traffic: [], log: [], phase: [], ignored: [] }, intervals: 0, am: null, pm: null, warnings: ["讀取失敗：" + (error instanceof Error ? error.message : "未知錯誤")] });
      }
    }
    setImportRows(rows);
    setImporting(false);
  }

  function commitImport() {
    if (!activeProjectId) return notify("請先建立並選擇計畫。");
    const q = quarter || window.prompt("請輸入季度，例如 115Q3", "")?.trim() || "";
    if (!q) return notify("尚未填入季度。");
    const originals = importRows.filter(function (row) { return row.role === "原始交通量" && Boolean(row.am || row.pm); });
    if (!originals.length) return notify("沒有可寫入的原始交通量檔。");
    const next = [...records];
    originals.forEach(function (item) {
      const found = next.findIndex(function (record) { return record.projectId === activeProjectId && record.quarter === q && record.station === item.station; });
      const created = recordFromPreview(item, activeProjectId, q);
      created.name = nameMap[item.file] || created.name;
      created.validation.referenceFound = importRows.some(function (row) { return row.role === "參考計算檔" && row.station === item.station; });
      if (found >= 0) next[found] = created; else next.push(created);
    });
    setRecords(next);
    setQuarter(q);
    setImportRows([]);
    notify("已寫入 " + originals.length + " 個路口；同計畫、同季度、同站號採覆蓋更新。");
  }

  function updateSelected(mutator: (record: TrafficRecord) => TrafficRecord) {
    if (!selected) return;
    setRecords(function (all) { return all.map(function (record) { return record.id === selected.id ? mutator(structuredClone(record)) : record; }); });
  }

  function deleteQuarter(q: string) {
    if (!confirm("確定刪除「" + q + "」全部路口資料？建議先下載備份。")) return;
    setRecords(function (all) { return all.filter(function (record) { return !(record.projectId === activeProjectId && record.quarter === q); }); });
    notify("已刪除季度 " + q + "。");
  }

  async function exportSvg() {
    if (!selected) return;
    downloadBlob(new Blob([diagramMarkup(selected, peak, diagramStyle, displayMode, vehicle, arrowMode, focusIndex)], { type: "image/svg+xml;charset=utf-8" }), selected.quarter + "_" + selected.station + "_" + peak + "_轉向圖.svg");
  }
  async function exportPng() {
    if (!selected) return;
    downloadBlob(await svgToPng(diagramMarkup(selected, peak, diagramStyle, displayMode, vehicle, arrowMode, focusIndex)), selected.quarter + "_" + selected.station + "_" + peak + "_轉向圖.png");
  }
  async function exportPdf(rows = selected ? [selected] : []) {
    if (!rows.length) return notify("沒有可輸出的路口資料。");
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    for (let index = 0; index < rows.length; index++) {
      if (index) pdf.addPage("a4", "landscape");
      const blob = await svgToPng(diagramMarkup(rows[index], peak, "formal", "both", vehicle, "all", 0), 2);
      const dataUrl = await new Promise<string>(function (resolve) { const reader = new FileReader(); reader.onload = function () { resolve(String(reader.result)); }; reader.readAsDataURL(blob); });
      pdf.addImage(dataUrl, "PNG", 10, 8, 277, 205);
    }
    pdf.save((activeProject?.code || "Project") + "_" + (quarter || "all") + "_" + peak + "_轉向交通量報表.pdf");
  }

  function exportExcel() {
    if (!current.length) return notify("本季度沒有可輸出的資料。");
    const summary = current.flatMap(function (record) { return (["AM", "PM"] as PeakKey[]).map(function (key) { return {
      計畫代碼: activeProject?.code, 計畫名稱: activeProject?.name, 季度: record.quarter, 站號: record.station, 路口名稱: record.name,
      尖峰: key, 尖峰時段: record.peaks[key].start + "-" + record.peaks[key].end, "尖峰小時交通量（PCU/hr）": recordTotal(record, key),
      參考檔驗證率: record.validation.matchRate == null ? "待驗證" : record.validation.matchRate / 100,
    }; }); });
    const movements = current.flatMap(function (record) { return record.approaches.flatMap(function (approach) { return (["AM", "PM"] as PeakKey[]).map(function (key) { return {
      計畫: activeProject?.name, 季度: record.quarter, 站號: record.station, 路口名稱: record.name, 尖峰: key, 方向: approach.bearing, 道路支線: approach.name,
      "左轉（PCU/hr）": approach.movements[key].left, "直行（PCU/hr）": approach.movements[key].through, "右轉（PCU/hr）": approach.movements[key].right,
      "合計（PCU/hr）": totalMovement(approach, key), 車道類型: approach.laneType ? LANE_GUIDANCE[approach.laneType].label : "未填",
      車道數: approach.lanes, "飽和流率（PCU/有效綠燈小時/車道）": approach.saturationFlow ?? approach.capacity,
      "有效綠燈（秒）": approach.effectiveGreen, "週期（秒）": approach.cycleLength,
      "容量（PCU/hr）": computeVC(record, key).rows.find(function (row) { return row.approach === approach.name; })?.capacity,
    }; }); }); });
    const trend = projectRecords.flatMap(function (record) { return (["AM", "PM"] as PeakKey[]).map(function (key) { return { 季度: record.quarter, 站號: record.station, 路口名稱: record.name, 尖峰: key, "尖峰小時交通量（PCU/hr）": recordTotal(record, key) }; }); });
    const quality = currentIssues.map(function (issue) { return { 嚴重度: issue.severity, 類別: issue.category, 站號: issue.station, 季度: issue.quarter, 說明: issue.message }; });
    const workbook = XLSX.utils.book_new();
    const add = function (rows: object[], name: string, widths: number[]) {
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = widths.map(function (wch) { return { wch: wch }; });
      sheet["!autofilter"] = { ref: sheet["!ref"] || "A1:A1" };
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    };
    add(summary, "尖峰摘要", [12, 24, 10, 10, 28, 10, 18, 24, 16]);
    add(movements, "轉向與容量明細", [20, 10, 10, 25, 8, 8, 22, 16, 16, 16, 16, 18, 10, 24, 16, 12, 18]);
    add(trend, "歷季趨勢可編輯資料", [10, 10, 28, 10, 25]);
    add(quality, "品質檢查", [10, 18, 10, 10, 55]);
    XLSX.writeFile(workbook, (activeProject?.code || "Project") + "_" + quarter + "_尖峰轉向交通量報表.xlsx");
  }

  async function exportPngZip() {
    if (!current.length) return notify("本季度沒有可輸出的路口資料。");
    const zip = new JSZip();
    for (const record of current) zip.file(record.station + "_" + peak + ".png", await svgToPng(diagramMarkup(record, peak, "formal", "both", vehicle, "all", 0), 2));
    downloadBlob(await zip.generateAsync({ type: "blob" }), (activeProject?.code || "Project") + "_" + quarter + "_" + peak + "_全部路口PNG.zip");
  }

  const backupPayload = function () { return { kind: "TURNING_TRAFFIC_BACKUP", version: VERSION, exportedAt: new Date().toISOString(), projects: projects, activeProjectId: activeProjectId, records: records, nameMap: nameMap, pce: pce }; };
  async function exportBackupZip() {
    const zip = new JSZip();
    zip.file("turning-traffic-backup.json", JSON.stringify(backupPayload(), null, 2));
    zip.file("README.txt", "Turning Traffic 完整備份\r\n在另一台電腦開啟系統後，到「備份、還原與版本」匯入本 ZIP。\r\n包含所有計畫、季度路口資料、名稱映射與當量參數。\r\n");
    downloadBlob(await zip.generateAsync({ type: "blob" }), "Turning-Traffic_完整備份_" + new Date().toISOString().slice(0, 10) + ".zip");
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
      if (data.kind !== "TURNING_TRAFFIC_BACKUP" || !Array.isArray(data.records)) throw new Error("格式不符");
      const restoredProjects = Array.isArray(data.projects) ? data.projects : [{ id: "P-restored", code: "RESTORED", name: "舊版還原計畫", client: "", note: "", createdAt: new Date().toISOString() }];
      const fallbackId = restoredProjects[0].id;
      setProjects(restoredProjects);
      setActiveProjectId(data.activeProjectId || fallbackId);
      setRecords(data.records.map(function (record: TrafficRecord) { return { ...record, projectId: record.projectId || fallbackId }; }));
      setNameMap(data.nameMap || {});
      setPce(data.pce || DEFAULT_PCE);
      notify("還原完成，可在這台電腦繼續使用。");
    } catch (error) { notify("還原失敗：" + (error instanceof Error ? error.message : "檔案無效")); }
  }

  const allRecordsEmpty = records.length === 0;
  const noProject = !activeProject;
  const renderNoData = function (title: string) {
    return <Empty title={title} text={noProject ? "請先建立計畫，再匯入季度調查檔。" : "目前計畫尚無正式資料；系統不預載示範數值。"} action={<button className="primary empty-action" onClick={function () { setView(noProject ? "projects" : "import"); }}>{noProject ? "建立計畫" : "前往匯入"}</button>} />;
  };

  return <div className="app-shell">
    <aside className={mobileNav ? "sidebar open" : "sidebar"}>
      <div className="brand"><span className="brand-mark">TT</span><div><strong>Turning Traffic</strong><small>尖峰轉向交通量分析</small></div></div>
      <nav>{NAV.map(function (item) { return <div key={item.id}>{item.group && <p className="nav-group">{item.group}</p>}<button className={view === item.id ? "active" : ""} onClick={function () { setView(item.id); setMobileNav(false); }}><span>{item.icon}</span>{item.label}{item.id === "quality" && currentIssues.length > 0 && <b>{currentIssues.length}</b>}</button></div>; })}</nav>
      <div className="side-foot"><span><i /> 本機資料自動儲存</span><small>{VERSION} · 僅本機／GPT Site</small></div>
    </aside>
    <main className="main">
      <header className="topbar"><button className="menu" onClick={function () { setMobileNav(!mobileNav); }}>☰</button><div><span className="crumb">Turning Traffic / {NAV.find(function (n) { return n.id === view; })?.label}</span><strong>{NAV.find(function (n) { return n.id === view; })?.label}</strong></div><div className="top-actions"><label>計畫<select value={activeProjectId} onChange={function (e) { setActiveProjectId(e.target.value); }}><option value="">尚未選擇</option>{projects.map(function (p) { return <option key={p.id} value={p.id}>{p.code} · {p.name}</option>; })}</select></label><label>季度<select value={quarter} onChange={function (e) { setQuarter(e.target.value); }}><option value="">尚無季度</option>{quarters.map(function (q) { return <option key={q}>{q}</option>; })}</select></label><span className="demo-pill">{allRecordsEmpty ? "空白正式環境" : projects.length + " 個計畫"}</span></div></header>
      <div className="content">
        {view === "projects" && <>
          <section className="page-head"><div><span className="eyebrow">PROJECT PORTFOLIO</span><h1>多計畫監測管理</h1><p>每個計畫可保有自己的季度、路口與參數，並可跨計畫比較與整包移轉。</p></div></section>
          <section className="project-layout"><article className="panel project-form"><h2>建立新計畫</h2><label>計畫代碼<input value={projectForm.code} placeholder="例如 115-A01" onChange={function (e) { setProjectForm({ ...projectForm, code: e.target.value }); }} /></label><label>計畫名稱<input value={projectForm.name} placeholder="必填" onChange={function (e) { setProjectForm({ ...projectForm, name: e.target.value }); }} /></label><label>委託單位<input value={projectForm.client} onChange={function (e) { setProjectForm({ ...projectForm, client: e.target.value }); }} /></label><label>備註<textarea value={projectForm.note} onChange={function (e) { setProjectForm({ ...projectForm, note: e.target.value }); }} /></label><button className="primary" onClick={addProject}>＋ 建立計畫</button></article>
            <article className="panel project-list"><div className="panel-head"><div><span className="eyebrow">PROJECTS</span><h2>現有計畫</h2></div><span className="status-dot">{projects.length} 個</span></div>{projects.length ? projects.map(function (project) { const count = records.filter(function (r) { return r.projectId === project.id; }).length; return <button key={project.id} className={project.id === activeProjectId ? "project-row active" : "project-row"} onClick={function () { setActiveProjectId(project.id); setView(count ? "dashboard" : "import"); }}><span>{project.code}</span><div><strong>{project.name}</strong><small>{project.client || "未填委託單位"} · {count} 筆季度路口資料</small></div><b>→</b></button>; }) : <Empty title="尚未建立計畫" text="正式網站從空白開始，不預載任何範例數值。" />}</article></section>
        </>}

        {view === "dashboard" && <>
          <section className="page-head"><div><span className="eyebrow">QUARTERLY OVERVIEW</span><h1>{activeProject?.name || "尚未選擇計畫"} · {quarter || "尚無季度"}</h1><p>所有流量值均標示為 PCU/hr；百分比為相對變化或方向組成。</p></div><div className="head-buttons"><button className="secondary" onClick={function () { setView("reports"); }}>匯出季報</button><button className="primary" onClick={function () { setView("import"); }}>＋ 匯入季度</button></div></section>
          {!current.length ? renderNoData("本季度尚無資料") : <><section className="kpi-grid"><Kpi label="本季調查路口" value={String(current.length) + " 處"} note={String(new Set(current.map(function (r) { return r.date; })).size) + " 個調查日"} /><Kpi label={"最高流量路口 · " + peak} value={top ? recordTotal(top, peak).toLocaleString() + " PCU/hr" : "—"} note={top ? top.station + " " + top.name : "尚無資料"} accent="blue" /><Kpi label="較上季總流量" value={change == null ? "—" : (change >= 0 ? "+" : "") + change.toFixed(1) + "%"} note={previousQuarter ? "比較基準 " + previousQuarter : "尚無上季資料"} accent="amber" /><Kpi label="待確認品質項目" value={String(currentIssues.length) + " 項"} note="匯入即時檢查" accent="rose" /></section>
            <section className="dashboard-grid"><article className="panel ranking"><div className="panel-head"><div><span className="eyebrow">PEAK RANKING</span><h2>路口尖峰小時排名</h2></div><Segmented value={peak} options={[["AM", "AM Peak"], ["PM", "PM Peak"]]} onChange={setPeak} /></div><div className="rank-list">{ranked.map(function (record, index) { return <button key={record.id} onClick={function () { setStation(record.station); setView("diagram"); }}><span className="rank-no">{String(index + 1).padStart(2, "0")}</span><div><strong>{record.station} · {record.name}</strong><span><i style={{ width: recordTotal(record, peak) / maxRank * 100 + "%" }} /></span></div><b>{recordTotal(record, peak).toLocaleString()}<small> PCU/hr</small></b></button>; })}</div></article><article className="panel action-panel"><div className="panel-head"><div><span className="eyebrow">QUALITY</span><h2>本季檢核摘要</h2></div></div><div className="quality-donut"><div style={{ "--score": Math.max(45, 100 - currentIssues.length * 4) + "%" } as React.CSSProperties}><strong>{Math.max(45, 100 - currentIssues.length * 4)}</strong><small>品質分數</small></div><ul><li><span className="good" />格式與欄位 <b>即時</b></li><li><span className="warn" />AI 異常提醒 <b>{currentIssues.filter(function (i) { return i.category === "異常流量"; }).length}</b></li><li><span className="bad" />需處理錯誤 <b>{currentIssues.filter(function (i) { return i.severity === "error"; }).length}</b></li></ul></div></article></section></>}
        </>}

        {view === "import" && <>
          <section className="page-head"><div><span className="eyebrow">BATCH IMPORT</span><h1>季度批次匯入與刪除</h1><p>先預覽再寫入；同計畫＋同季度＋同站號採覆蓋，錯誤資料可單筆或整季刪除。</p></div><label className="quarter-entry">本次季度<input value={quarter} placeholder="例如 115Q3" onChange={function (e) { setQuarter(e.target.value.toUpperCase()); }} /></label></section>
          <section className="import-layout"><article className="panel upload-card" onDragOver={function (e) { e.preventDefault(); }} onDrop={function (e) { e.preventDefault(); handleFiles(e.dataTransfer.files); }}><span className="upload-icon">⇧</span><h2>拖曳 Excel 檔案到這裡</h2><p>支援 .xls、.xlsx、.xlsm，多路口一次選取；照片工作表忽略。</p><input ref={fileRef} hidden type="file" multiple accept=".xls,.xlsx,.xlsm" onChange={function (e) { handleFiles(e.target.files); }} /><button className="primary" onClick={function () { fileRef.current?.click(); }}>{importing ? "正在解析…" : "選擇檔案"}</button></article><article className="panel import-rules"><span className="eyebrow">CALCULATION RULE</span><h2>尖峰小時計算</h2><ol><li><b>15 分鐘資料</b><span>連續 4 區間組成 60 分鐘。</span></li><li><b>AM／PM 分開搜尋</b><span>同值取較早時段。</span></li><li><b>參考檔只做驗證</b><span>不盲目照抄計算檔。</span></li><li><b>欄位映射可調整</b><span>匯入後需確認道路支線與左直右欄位。</span></li></ol></article></section>
          <section className="panel"><div className="panel-head"><div><span className="eyebrow">IMPORT PREVIEW</span><h2>匯入辨識結果</h2></div><button className="primary" disabled={!importRows.length} onClick={commitImport}>確認寫入</button></div>{!importRows.length ? <Empty title="尚未選取檔案" text="預覽階段不會更動正式資料。" /> : <div className="table-scroll"><table><thead><tr><th>檔案</th><th>角色</th><th>站號／名稱</th><th>AM Peak（PCU/hr）</th><th>PM Peak（PCU/hr）</th><th>檢查</th><th></th></tr></thead><tbody>{importRows.map(function (row) { return <tr key={row.file}><td>{row.file}</td><td><span className={"tag " + (row.role === "無法辨識" ? "red" : row.role === "參考計算檔" ? "blue" : "green")}>{row.role}</span></td><td>{row.station}<small>{row.name}</small></td><td>{row.am ? formatMinutes(row.am.start) + "–" + formatMinutes(row.am.end) + " · " + row.am.total.toLocaleString() + " PCU/hr" : "—"}</td><td>{row.pm ? formatMinutes(row.pm.start) + "–" + formatMinutes(row.pm.end) + " · " + row.pm.total.toLocaleString() + " PCU/hr" : "—"}</td><td>{row.warnings.map(function (warning) { return <small className="warning-text" key={warning}>{warning}</small>; })}</td><td><button className="icon-danger" onClick={function () { setImportRows(importRows.filter(function (item) { return item.file !== row.file; })); }}>刪除</button></td></tr>; })}</tbody></table></div>}</section>
          <section className="panel imported-data"><div className="panel-head"><div><span className="eyebrow">IMPORTED DATA</span><h2>已匯入季度資料</h2></div></div>{quarters.length ? quarters.map(function (q) { const rows = projectRecords.filter(function (r) { return r.quarter === q; }); return <div className="imported-quarter" key={q}><div><strong>{q}</strong><span>{rows.length} 個路口</span></div><div>{rows.map(function (record) { return <button key={record.id} onClick={function () { if (confirm("刪除 " + record.station + " " + record.name + "？")) setRecords(records.filter(function (r) { return r.id !== record.id; })); }}>{record.station} ×</button>; })}</div><button className="danger-small" onClick={function () { deleteQuarter(q); }}>刪除整季</button></div>; }) : <Empty title="尚無已匯入資料" text="正式環境保持空白，等待使用者建置。" />}</section>
        </>}

        {view === "parameters" && <>
          <section className="page-head"><div><span className="eyebrow">PARAMETER LIBRARY</span><h1>轉向當量與容量參數</h1><p>所有數值可依計畫手動修改；來源、適用範圍與限制會一併保留。</p></div><button className="secondary" onClick={function () { setPce(structuredClone(DEFAULT_PCE)); notify("已恢復講義預設值。"); }}>恢復預設值</button></section>
          <section className="parameter-grid"><article className="panel parameter-card"><div className="panel-head"><div><span className="eyebrow">PCE / PCU</span><h2>四車種左／直／右當量</h2></div></div><div className="table-scroll"><table><thead><tr><th>車種</th><th>左轉</th><th>直行</th><th>右轉</th></tr></thead><tbody>{(Object.keys(PCE_LABELS) as (keyof typeof PCE_LABELS)[]).map(function (vehicleKey) { return <tr key={vehicleKey}><td><strong>{PCE_LABELS[vehicleKey]}</strong></td>{(["left", "through", "right"] as const).map(function (move) { return <td key={move}><input type="number" min="0" step="0.1" value={pce[vehicleKey][move]} aria-label={PCE_LABELS[vehicleKey] + MOVE_LABELS[move] + "當量"} onChange={function (e) { setPce({ ...pce, [vehicleKey]: { ...pce[vehicleKey], [move]: Number(e.target.value) } }); }} /></td>; })}</tr>; })}</tbody></table></div><div className="source-note"><b>預設值來源</b><p>使用者提供《交通流量教育訓練1060310》簡報第 15 頁；原簡報未載明引用來源，故列為「可調整的舊版專案預設」，不是 2022 手冊的通用官方表。</p></div></article>
            <article className="panel parameter-card"><div className="panel-head"><div><span className="eyebrow">OFFICIAL CONTEXT</span><h2>2022 手冊適用提醒</h2></div></div><div className="guidance-copy"><p>2022《臺灣公路容量手冊》依設施類型、車道層級、車種組成、幾何與號誌條件估算容量，查無可直接套用所有號誌路口的四車種 × 三轉向通用表。</p><p>官方 FAQ 也要求號誌路口採分車道交通量，V/C 的 V 是需求流率，不等同於單純觀測通過量，且 V/C 不能直接當成服務水準。</p><a href="https://www.iot.gov.tw/zh_tw/archive/pub/reports/-73633039" target="_blank" rel="noreferrer">交通部運研所：2022 臺灣公路容量手冊</a><a href="https://thcs.iot.gov.tw/FAQ.aspx" target="_blank" rel="noreferrer">THCS 官方常見問題</a></div></article></section>
          <section className="panel capacity-guide"><div className="panel-head"><div><span className="eyebrow">SCREENING GUIDE</span><h2>每車道飽和流率初篩建議</h2></div><span className="rule-badge">非固定容量</span></div><div className="capacity-cards">{(Object.keys(LANE_GUIDANCE) as LaneType[]).filter(function (key) { return key !== "custom"; }).map(function (key) { const item = LANE_GUIDANCE[key]; return <article key={key}><strong>{item.label}</strong><b>{item.min.toLocaleString()}–{item.max.toLocaleString()}</b><span>PCU／有效綠燈小時／車道</span><p>建議起始值：{item.recommended.toLocaleString()}</p><small>{item.note}</small></article>; })}</div><div className="formula-note"><b>重要：</b>1400、700 若未附綠燈比，只能視為初篩飽和流率或經驗數，不能直接稱為車道容量。實際容量 = 飽和流率 S × 車道數 × 有效綠燈 Ge ÷ 週期 C。</div></section>
          <section className="calculator-grid"><article className="panel calculator"><h2>現地飽和流率換算</h2><p>只取排隊車流已穩定疏解的區段；在單一車道觀測 N 輛、耗時 t 秒。</p><label>通過量 N（PCU）<input type="number" value={calc.count} onChange={function (e) { setCalc({ ...calc, count: e.target.value }); }} /></label><label>觀測時間 t（秒）<input type="number" value={calc.seconds} onChange={function (e) { setCalc({ ...calc, seconds: e.target.value }); }} /></label><output>S = {Number(calc.seconds) > 0 ? Math.round(3600 * Number(calc.count) / Number(calc.seconds)).toLocaleString() : "—"} PCU／有效綠燈小時／車道</output><small>不是「尖峰流量的幾％」；若沒有飽和排隊，這個方法不適用。</small></article>
            <article className="panel calculator"><h2>有效綠燈與容量換算</h2><p>有效綠燈 Ge ≈ 顯示綠燈 + 可利用黃燈 − 起步與清空損失。週期 C 是同一燈色開始到下一次同燈色開始。</p><label>顯示綠燈（秒）<input type="number" value={calc.green} onChange={function (e) { setCalc({ ...calc, green: e.target.value }); }} /></label><label>可利用黃燈（秒）<input type="number" value={calc.yellow} onChange={function (e) { setCalc({ ...calc, yellow: e.target.value }); }} /></label><label>總損失（秒）<input type="number" value={calc.lost} onChange={function (e) { setCalc({ ...calc, lost: e.target.value }); }} /></label><label>週期 C（秒）<input type="number" value={calc.cycle} onChange={function (e) { setCalc({ ...calc, cycle: e.target.value }); }} /></label><output>Ge = {Math.max(0, Number(calc.green) + Number(calc.yellow) - Number(calc.lost)) || "—"} 秒；綠燈比 = {Number(calc.cycle) > 0 ? (Math.max(0, Number(calc.green) + Number(calc.yellow) - Number(calc.lost)) / Number(calc.cycle) * 100).toFixed(1) + "%" : "—"}</output><small>無現地資料時可先以「顯示綠燈」作低信心初估；都市週期 60–120 秒僅為常見初篩範圍，仍應以時相圖或秒錶實測。</small></article></section>
        </>}

        {view === "diagram" && <>{!selected ? renderNoData("尚無可繪製路口") : <>
          <section className="page-head compact"><div><span className="eyebrow">TURNING MOVEMENT DIAGRAM</span><h1>正式轉向圖</h1><p>正式版依 3.jpg：流量表搭配完整跨路口箭線；聚焦版依手繪圖逐一顯示左／直／右目的支線。</p></div><div className="head-buttons"><button className="secondary" onClick={exportSvg}>SVG</button><button className="secondary" onClick={exportPng}>PNG</button><button className="primary" onClick={function () { exportPdf(); }}>PDF</button></div></section>
          <section className="diagram-toolbar panel"><label>路口<select value={selected.station} onChange={function (e) { setStation(e.target.value); setFocusIndex(0); }}>{current.map(function (record) { return <option key={record.id} value={record.station}>{record.station} · {record.name}</option>; })}</select></label><label>尖峰<select value={peak} onChange={function (e) { setPeak(e.target.value as PeakKey); }}><option value="AM">AM Peak</option><option value="PM">PM Peak</option></select></label><label>版型<select value={diagramStyle} onChange={function (e) { setDiagramStyle(e.target.value as DiagramStyle); }}><option value="formal">正式版（3.jpg）</option><option value="standard">標準版</option><option value="simple">簡潔版</option></select></label><label>箭線<select value={arrowMode} onChange={function (e) { setArrowMode(e.target.value as ArrowMode); }}><option value="all">全部方向</option><option value="focus">單一方向聚焦</option></select></label>{arrowMode === "focus" && <label>聚焦支線<select value={focusIndex} onChange={function (e) { setFocusIndex(Number(e.target.value)); }}>{selected.approaches.map(function (a, i) { return <option key={a.id} value={i}>{a.bearing}向 · {a.name}</option>; })}</select></label>}<label>顯示<select value={displayMode} onChange={function (e) { setDisplayMode(e.target.value as DisplayMode); }}><option value="volume">交通量</option><option value="percent">百分比</option><option value="both">PCU/hr＋百分比</option></select></label><label>車種<select value={vehicle} onChange={function (e) { setVehicle(e.target.value as VehicleKey); }}>{Object.entries(VEHICLE_LABELS).map(function (entry) { return <option key={entry[0]} value={entry[0]}>{entry[1]}</option>; })}</select></label></section>
          <section className="diagram-layout"><article className="panel diagram-canvas" dangerouslySetInnerHTML={{ __html: diagramMarkup(selected, peak, diagramStyle, displayMode, vehicle, arrowMode, focusIndex) }} /><aside><article className="panel summary-card"><span className="eyebrow">SELECTED</span><h2>{selected.station}</h2><p>{selected.name}</p><dl><div><dt>尖峰時段</dt><dd>{selected.peaks[peak].start}–{selected.peaks[peak].end}</dd></div><div><dt>路口總流量</dt><dd>{recordTotal(selected, peak).toLocaleString()} <small>PCU/hr</small></dd></div><div><dt>道路支線</dt><dd>{selected.approaches.length} 叉</dd></div></dl></article><article className="panel vc-card"><span className="eyebrow">V/C RATIO</span><h2>容量檢核</h2>{computeVC(selected, peak).calculable ? computeVC(selected, peak).rows.map(function (row) { return <div className="vc-row" key={row.approach}><span>{row.approach}<small>{row.capacity?.toFixed(0)} PCU/hr</small></span><b>{row.ratio?.toFixed(2)}</b></div>; }) : <div className="not-calculable"><b>資料不足，不計算 V/C</b><p>缺少 {computeVC(selected, peak).missing.slice(0, 4).join("、")}。</p><button className="text-button" onClick={function () { setView("geometry"); }}>前往補齊 →</button></div>}</article></aside></section>
        </>}</>}

        {view === "geometry" && <>{!selected ? renderNoData("尚無道路支線資料") : <>
          <section className="page-head"><div><span className="eyebrow">GEOMETRY & SIGNAL</span><h1>道路、車道與號誌管理</h1><p>每支線設定角度、車道類型、飽和流率、有效綠燈與週期；V/C 才會啟用。</p></div><button className="primary" disabled={selected.approaches.length >= 7} onClick={function () { updateSelected(function (record) { const i = record.approaches.length; record.approaches.push({ ...structuredClone(record.approaches[0]), id: record.station + "-A" + (i + 1), name: "新增支線 " + (i + 1), angle: -90 + i * 360 / (i + 1), bearing: "待設定", lanes: null, laneType: "custom", saturationFlow: null, effectiveGreen: null, cycleLength: null, capacity: null }); return record; }); }}>＋ 新增支線</button></section>
          <section className="geometry-layout"><article className="panel"><div className="panel-head"><h2>{selected.station} · {selected.name}</h2><span className="status-dot">{selected.approaches.length} 叉</span></div><div className="geometry-list geometry-expanded">{selected.approaches.map(function (approach, index) { const laneType = approach.laneType || "custom"; const guide = LANE_GUIDANCE[laneType]; return <div key={approach.id}><b>{index + 1}</b><label>道路支線<input value={approach.name} onChange={function (e) { updateSelected(function (record) { record.approaches[index].name = e.target.value; return record; }); }} /></label><label>方位<input value={approach.bearing} onChange={function (e) { updateSelected(function (record) { record.approaches[index].bearing = e.target.value; return record; }); }} /></label><label>角度（°）<input type="number" value={approach.angle} onChange={function (e) { updateSelected(function (record) { record.approaches[index].angle = Number(e.target.value); return record; }); }} /></label><label>車道類型<select value={laneType} onChange={function (e) { updateSelected(function (record) { const type = e.target.value as LaneType; record.approaches[index].laneType = type; return record; }); }}>{(Object.keys(LANE_GUIDANCE) as LaneType[]).map(function (key) { return <option key={key} value={key}>{LANE_GUIDANCE[key].label}</option>; })}</select><small>建議 {guide.min}–{guide.max}；起始 {guide.recommended}</small></label><label>車道數（車道）<input type="number" min="1" value={approach.lanes ?? ""} onChange={function (e) { updateSelected(function (record) { record.approaches[index].lanes = e.target.value ? Number(e.target.value) : null; return record; }); }} /></label><label>飽和流率 S<input type="number" placeholder={String(guide.recommended)} value={approach.saturationFlow ?? approach.capacity ?? ""} onChange={function (e) { updateSelected(function (record) { record.approaches[index].saturationFlow = e.target.value ? Number(e.target.value) : null; record.approaches[index].capacity = null; return record; }); }} /><small>PCU／有效綠燈小時／車道 <button onClick={function () { updateSelected(function (record) { record.approaches[index].saturationFlow = guide.recommended; return record; }); }}>帶入建議</button></small></label><label>有效綠燈 Ge（秒）<input type="number" value={approach.effectiveGreen ?? ""} onChange={function (e) { updateSelected(function (record) { record.approaches[index].effectiveGreen = e.target.value ? Number(e.target.value) : null; return record; }); }} /><small>綠燈＋可利用黃燈－損失時間</small></label><label>週期 C（秒）<input type="number" value={approach.cycleLength ?? ""} onChange={function (e) { updateSelected(function (record) { record.approaches[index].cycleLength = e.target.value ? Number(e.target.value) : null; return record; }); }} /><small>同一燈色開始到下次開始</small></label><button className="icon-danger" disabled={selected.approaches.length <= 3} onClick={function () { updateSelected(function (record) { record.approaches.splice(index, 1); return record; }); }}>×</button></div>; })}</div></article><article className="panel geometry-preview" dangerouslySetInnerHTML={{ __html: diagramMarkup(selected, peak, "simple", "volume", "all", "focus", 0) }} /></section>
        </>}</>}

        {view === "compare" && <>
          <section className="page-head"><div><span className="eyebrow">CROSS-PROJECT COMPARISON</span><h1>跨計畫與多路口比較</h1><p>最多選 4 個計畫；同時顯示各計畫最新季度的 AM／PM 尖峰總量，單位 PCU/hr。</p></div></section>
          <section className="panel project-checks">{projects.map(function (project) { return <label key={project.id}><input type="checkbox" checked={compareProjects.includes(project.id)} onChange={function (e) { if (e.target.checked && compareProjects.length < 4) setCompareProjects([...compareProjects, project.id]); else if (!e.target.checked) setCompareProjects(compareProjects.filter(function (id) { return id !== project.id; })); }} />{project.code} · {project.name}</label>; })}</section>
          <section className="compare-grid">{projects.filter(function (project) { return compareProjects.includes(project.id); }).map(function (project) { const rows = records.filter(function (record) { return record.projectId === project.id; }); const latest = Array.from(new Set(rows.map(function (r) { return r.quarter; }))).sort().at(-1); const latestRows = rows.filter(function (r) { return r.quarter === latest; }); const am = latestRows.reduce(function (sum, r) { return sum + recordTotal(r, "AM"); }, 0); const pm = latestRows.reduce(function (sum, r) { return sum + recordTotal(r, "PM"); }, 0); return <article className="panel compare-card" key={project.id}><span>{project.code}</span><h2>{project.name}</h2><strong>{latest || "尚無季度"}</strong><dl><div><dt>路口數</dt><dd>{latestRows.length} 處</dd></div><div><dt>AM Peak 合計</dt><dd>{am.toLocaleString()} PCU/hr</dd></div><div><dt>PM Peak 合計</dt><dd>{pm.toLocaleString()} PCU/hr</dd></div></dl><button className="secondary full" onClick={function () { setActiveProjectId(project.id); setView("dashboard"); }}>開啟計畫</button></article>; })}</section>
          {!compareProjects.length && <Empty title="請選擇比較計畫" text="可同時勾選 2–4 個計畫。" />}
          {activeProject && current.length > 0 && <><section className="page-head compare-subhead"><div><h2>{activeProject.name} · {quarter} 多路口排名</h2></div><Segmented value={peak} options={[["AM", "AM"], ["PM", "PM"]]} onChange={setPeak} /></section><section className="compare-grid">{ranked.map(function (record, index) { return <article className="panel compare-card" key={record.id}><div className="compare-rank">#{index + 1}</div><span>{record.station}</span><h2>{record.name}</h2><strong>{recordTotal(record, peak).toLocaleString()} <small>PCU/hr</small></strong><div className="mini-bar"><i style={{ width: recordTotal(record, peak) / maxRank * 100 + "%" }} /></div></article>; })}</section></>}
        </>}

        {view === "trend" && <TrendView records={projectRecords} station={station} setStation={setStation} peak={peak} setPeak={setPeak} notify={notify} />}

        {view === "quality" && <>
          <section className="page-head"><div><span className="eyebrow">DATA QUALITY</span><h1>資料品質與異常流量偵測</h1><p>缺值、總數不一致、尖峰時段、車種統計與方向離群值，單位隨訊息標示。</p></div></section>
          {!projectRecords.length ? renderNoData("尚無可檢查資料") : <><section className="quality-grid">{(["缺值", "總數不一致", "尖峰時段異常", "車種統計異常", "異常流量"] as const).map(function (category) { return <article className="panel" key={category}><span>{category}</span><strong>{currentIssues.filter(function (issue) { return issue.category === category; }).length} 項</strong><small>依匯入規則即時檢查</small></article>; })}</section><section className="panel"><div className="issue-list">{currentIssues.map(function (issue) { return <div key={issue.id}><span className={"severity " + issue.severity} /><b>{issue.category}</b><strong>{issue.station}</strong><p>{issue.message}</p></div>; })}</div></section></>}
        </>}

        {view === "names" && <>
          <section className="page-head"><div><span className="eyebrow">NAME NORMALIZATION</span><h1>路口名稱管理</h1><p>排除全半形、括號、站號、版本字尾與重複標點，保留道路真名；人工映射優先。</p></div></section>
          {!current.length ? renderNoData("尚無路口名稱") : <section className="panel"><div className="table-scroll"><table><thead><tr><th>站號</th><th>原始檔名</th><th>系統正規化</th><th>標準名稱（可編輯）</th></tr></thead><tbody>{current.map(function (record) { return <tr key={record.id}><td>{record.station}</td><td>{record.rawName}</td><td>{normalizeIntersectionName(record.rawName)}</td><td><input value={nameMap[record.rawName] || record.name} onChange={function (e) { setNameMap({ ...nameMap, [record.rawName]: e.target.value }); }} onBlur={function (e) { const value = e.target.value.trim(); setRecords(records.map(function (item) { return item.rawName === record.rawName ? { ...item, name: value || item.name } : item; })); }} /></td></tr>; })}</tbody></table></div></section>}
        </>}

        {view === "reports" && <>
          <section className="page-head"><div><span className="eyebrow">REPORT CENTER</span><h1>報表與批次輸出</h1><p>Excel 保留可編輯數值、清楚欄名與單位；正式轉向圖輸出 PNG、SVG 或多頁 PDF。</p></div></section>
          <section className="report-grid"><article className="panel report-card"><span className="file-type excel">XLSX</span><h2>可編輯季度 Excel</h2><p>欄名含單位、適當欄寬、自動篩選、歷季趨勢資料工作表。</p><button className="primary full" onClick={exportExcel}>下載 Excel</button></article><article className="panel report-card"><span className="file-type pdf">PDF</span><h2>正式版多頁 PDF</h2><p>採 3.jpg 的完整流向線版面，一頁一路口。</p><button className="primary full" onClick={function () { exportPdf(current); }}>產生 {current.length} 頁</button></article><article className="panel report-card"><span className="file-type png">PNG</span><h2>全部路口 PNG ZIP</h2><p>每路口一張高解析圖片，文字保持正向。</p><button className="primary full" onClick={exportPngZip}>下載 {current.length} 張</button></article><article className="panel report-card"><span className="file-type svg">SVG</span><h2>目前路口向量圖</h2><p>可無損縮放與排版。</p><button className="secondary full" onClick={exportSvg}>下載 SVG</button></article></section>
          <section className="panel report-note"><b>Excel 編輯性</b><p>數值、欄名、容量欄位與趨勢來源資料均為原生儲存格，可在 Excel 直接修改；轉向圖本體仍以 SVG／PNG／PDF 為正式成果。</p></section>
        </>}

        {view === "backup" && <>
          <section className="page-head"><div><span className="eyebrow">BACKUP & RESTORE</span><h1>跨電腦備份、還原與版本</h1><p>A 電腦下載 ZIP／JSON，B 電腦開啟同網站匯入，即可接續全部計畫與設定。</p></div></section>
          <section className="backup-grid"><article className="panel"><span>01</span><h2>完整 ZIP</h2><p>所有計畫、季度、名稱映射與當量參數。</p><button className="primary full" onClick={exportBackupZip}>下載 ZIP</button></article><article className="panel"><span>02</span><h2>JSON 純資料</h2><p>適合版本比較與長期封存。</p><button className="secondary full" onClick={function () { downloadBlob(new Blob([JSON.stringify(backupPayload(), null, 2)], { type: "application/json" }), "turning-traffic-backup.json"); }}>下載 JSON</button></article><article className="panel"><span>03</span><h2>在另一台電腦還原</h2><p>匯入 ZIP 或 JSON 後會恢復完整狀態。</p><label className="secondary full upload-label">選擇備份檔<input hidden type="file" accept=".zip,.json" onChange={function (e) { if (e.target.files?.[0]) restoreBackup(e.target.files[0]); }} /></label></article></section>
          <section className="panel version-panel"><div><span className="eyebrow">CHANGELOG</span><h2>系統版本與更新紀錄</h2></div>{VERSION_HISTORY.map(function (item, index) { return <article key={item.version}><b>{item.version}</b><time>{item.date}</time><p>{item.note}</p><span>{index === 0 ? "目前版本" : "歷史版本"}</span></article>; })}</section>
          <section className="panel danger-zone"><div><b>清除本機資料</b><p>會清除所有計畫與設定，且不會恢復任何示範值；請先下載完整備份。</p></div><button onClick={function () { if (confirm("確定清除這台電腦內的 Turning Traffic 資料？")) { setProjects([]); setRecords([]); setNameMap({}); setActiveProjectId(""); setQuarter(""); notify("已清除，系統回到空白正式環境。"); } }}>全部清除</button></section>
        </>}
      </div>
    </main>
    {toast && <div className="toast">✓ {toast}</div>}
  </div>;
}

function TrendView(props: { records: TrafficRecord[]; station: string; setStation: (value: string) => void; peak: PeakKey; setPeak: (value: PeakKey) => void; notify: (value: string) => void }) {
  const stations = Array.from(new Map(props.records.map(function (record) { return [record.station, record.name]; })).entries());
  const allQuarters = Array.from(new Set(props.records.map(function (record) { return record.quarter; }))).sort();
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(function () { setChosen(allQuarters.slice(-4)); }, [props.records.length]);
  const rows = props.records.filter(function (record) { return record.station === props.station && chosen.includes(record.quarter); }).sort(function (a, b) { return a.quarter.localeCompare(b.quarter); });
  const values = rows.map(function (record) { return recordTotal(record, props.peak); });
  const max = Math.max(...values, 1) * 1.12;
  const points = rows.map(function (record, index) { return { x: 100 + index * 610 / Math.max(1, rows.length - 1), y: 310 - recordTotal(record, props.peak) / max * 235, record: record }; });
  async function exportChart() {
    const svg = document.getElementById("trend-svg");
    if (!svg) return;
    downloadBlob(await svgToPng(new XMLSerializer().serializeToString(svg)), props.station + "_" + props.peak + "_歷季趨勢.png");
    props.notify("趨勢圖已下載。");
  }
  if (!props.records.length) return <Empty title="尚無歷季資料" text="匯入同一路口至少兩季後即可比較。" />;
  return <><section className="page-head"><div><span className="eyebrow">QUARTERLY TREND</span><h1>歷季趨勢比較</h1><p>同一路口選 2–4 季；圖中所有數值與 Y 軸名稱均標示單位。</p></div><button className="primary" onClick={exportChart}>下載趨勢 PNG</button></section><section className="trend-controls panel"><label>路口<select value={props.station} onChange={function (e) { props.setStation(e.target.value); }}>{stations.map(function (entry) { return <option key={entry[0]} value={entry[0]}>{entry[0]} · {entry[1]}</option>; })}</select></label><Segmented value={props.peak} options={[["AM", "AM Peak"], ["PM", "PM Peak"]]} onChange={props.setPeak} /><div className="quarter-checks">{allQuarters.map(function (q) { return <label key={q}><input type="checkbox" checked={chosen.includes(q)} onChange={function (e) { if (e.target.checked && chosen.length < 4) setChosen([...chosen, q].sort()); else if (!e.target.checked) setChosen(chosen.filter(function (x) { return x !== q; })); }} />{q}</label>; })}</div></section><section className="trend-layout"><article className="panel trend-chart"><div className="panel-head"><h2>{stations.find(function (entry) { return entry[0] === props.station; })?.[1]} · {props.peak}</h2><span className="status-dot">PCU/hr</span></div>{rows.length >= 2 ? <svg id="trend-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 780 390" role="img" aria-label="歷季尖峰小時交通量折線圖"><rect width="780" height="390" fill="#fff" rx="12"/><text x="22" y="70" className="y-axis-title" writingMode="vertical-rl">尖峰小時交通量（PCU/hr）</text><g className="grid-lines">{[0, 1, 2, 3, 4].map(function (i) { return <g key={i}><line x1="84" x2="720" y1={70 + i * 60} y2={70 + i * 60}/><text x="75" y={75 + i * 60}>{Math.round(max * (1 - i / 4)).toLocaleString()} PCU/hr</text></g>; })}</g><polyline points={points.map(function (p) { return p.x + "," + p.y; }).join(" ")} fill="none" stroke="#087f75" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>{points.map(function (p) { return <g key={p.record.id}><circle cx={p.x} cy={p.y} r="7" fill="#fff" stroke="#087f75" strokeWidth="4"/><text x={p.x} y={p.y - 16} className="point-value">{recordTotal(p.record, props.peak).toLocaleString()} PCU/hr</text><text x={p.x} y="355" className="x-label">{p.record.quarter}</text></g>; })}</svg> : <Empty title="至少需要兩季資料" text="請勾選 2–4 個季度。" />}</article><article className="panel trend-summary"><h2>季度變化</h2>{rows.map(function (record, index) { const value = recordTotal(record, props.peak); const prior = index ? recordTotal(rows[index - 1], props.peak) : 0; const pct = prior ? (value / prior - 1) * 100 : null; return <div key={record.id}><span>{record.quarter}</span><b>{value.toLocaleString()} PCU/hr</b><i className={pct == null ? "flat" : pct >= 0 ? "up" : "down"}>{pct == null ? "基準" : (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"}</i></div>; })}</article></section></>;
}
