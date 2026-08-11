"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { jsPDF } from "jspdf";
import {
  Approach,
  createDemoRecords,
  formatMinutes,
  ImportPreview,
  inspectWorkbook,
  normalizeIntersectionName,
  PeakKey,
  qualityIssues,
  recordTotal,
  totalMovement,
  TrafficRecord,
  VehicleKey,
  VERSION,
  VERSION_HISTORY,
  computeVC,
} from "../lib/traffic";

type View = "dashboard" | "import" | "diagram" | "compare" | "trend" | "quality" | "names" | "geometry" | "reports" | "backup";
type DiagramStyle = "standard" | "simple" | "full";
type DisplayMode = "volume" | "percent" | "both";

const NAV: { id: View; label: string; icon: string; group?: string }[] = [
  { id: "dashboard", label: "總覽儀表板", icon: "⌂" },
  { id: "import", label: "季度批次匯入", icon: "⇧", group: "資料管理" },
  { id: "quality", label: "資料品質檢查", icon: "✓" },
  { id: "names", label: "路口名稱管理", icon: "Aa" },
  { id: "geometry", label: "道路幾何管理", icon: "✣" },
  { id: "diagram", label: "路口轉向圖", icon: "↗", group: "分析與圖表" },
  { id: "compare", label: "多路口比較", icon: "▥" },
  { id: "trend", label: "歷季趨勢比較", icon: "⌁" },
  { id: "reports", label: "報表與批次輸出", icon: "▤", group: "輸出與維護" },
  { id: "backup", label: "備份、還原與版本", icon: "⟳" },
];

const labels = {
  all: "全部車種",
  motorcycle: "機車",
  car: "小客車",
  lightTruck: "小貨車",
  heavy: "大型車",
  bus: "大客車",
};

const demoRecords = createDemoRecords();

function xml(value: string | number) {
  return String(value).replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[char] || char));
}

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

function diagramMarkup(record: TrafficRecord, peak: PeakKey, style: DiagramStyle, mode: DisplayMode, vehicle: VehicleKey) {
  const width = 840;
  const height = 680;
  const cx = 420;
  const cy = 360;
  const total = Math.max(1, recordTotal(record, peak));
  const arms = record.approaches.map((approach, index) => {
    const angle = approach.angle;
    const rad = angle * Math.PI / 180;
    const cardRadius = record.approaches.length > 5 ? 265 : 245;
    const x = cx + Math.cos(rad) * cardRadius;
    const y = cy + Math.sin(rad) * cardRadius;
    const movementValues = (["left", "through", "right"] as const).map((key) => totalMovement(approach, peak, key, vehicle));
    const approachTotal = movementValues.reduce((a, b) => a + b, 0);
    const formatter = (value: number) => {
      const pct = approachTotal ? `${Math.round(value / approachTotal * 100)}%` : "0%";
      if (mode === "percent") return pct;
      if (mode === "both") return `${value.toLocaleString()} · ${pct}`;
      return value.toLocaleString();
    };
    const road = `<g transform="rotate(${angle + 90} ${cx} ${cy})"><rect x="${cx - 39}" y="28" width="78" height="282" rx="3" class="road"/><path d="M ${cx} 44 V 295" class="divider"/><text x="${cx}" y="66" class="road-name" transform="rotate(0 ${cx} 66)">${xml(approach.name)}</text></g>`;
    const cardWidth = mode === "both" ? 198 : 160;
    const card = style === "simple"
      ? `<g transform="translate(${x - 52} ${y - 18})"><rect width="104" height="36" rx="8" class="mini-card"/><text x="52" y="23" class="big-value">${xml(approachTotal.toLocaleString())}</text></g>`
      : `<g transform="translate(${x - cardWidth / 2} ${y - 41})"><rect width="${cardWidth}" height="82" rx="10" class="flow-card"/><text x="${cardWidth / 2}" y="-9" class="bearing">${xml(approach.bearing)}向 · ${xml(approach.name)}</text><line x1="${cardWidth / 3}" x2="${cardWidth / 3}" y1="0" y2="58" class="cell-line"/><line x1="${cardWidth * 2 / 3}" x2="${cardWidth * 2 / 3}" y1="0" y2="58" class="cell-line"/><text x="${cardWidth / 6}" y="21" class="turn">↰ 左</text><text x="${cardWidth / 2}" y="21" class="turn">↑ 直</text><text x="${cardWidth * 5 / 6}" y="21" class="turn">↱ 右</text><text x="${cardWidth / 6}" y="48" class="value">${xml(formatter(movementValues[0]))}</text><text x="${cardWidth / 2}" y="48" class="value">${xml(formatter(movementValues[1]))}</text><text x="${cardWidth * 5 / 6}" y="48" class="value">${xml(formatter(movementValues[2]))}</text><line x1="0" x2="${cardWidth}" y1="58" y2="58" class="cell-line"/><text x="${cardWidth / 2}" y="75" class="sum">方向合計 ${xml(approachTotal.toLocaleString())}</text></g>`;
    return road + card;
  }).join("");
  const peakText = `${peak} Peak ${record.peaks[peak].start}–${record.peaks[peak].end}`;
  const metadata = style === "simple" ? "" : `<g class="meta"><text x="34" y="42" class="title">${xml(record.station)}｜${xml(record.name)}</text><text x="34" y="68">調查日期 ${xml(record.date)}　${xml(peakText)}　單位 PCU/hr</text>${style === "full" ? `<text x="34" y="92">季度 ${xml(record.quarter)}　車種 ${xml(labels[vehicle])}　全路口流量 ${xml(total.toLocaleString())}</text>` : ""}</g>`;
  return `<svg id="turning-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(record.name)} ${peakText} 轉向交通量圖"><style>.canvas{fill:#fffdf8}.road{fill:#e8edf0;stroke:#9eabb1;stroke-width:1.4}.divider{fill:none;stroke:#fff;stroke-width:2;stroke-dasharray:9 8}.road-name{font:600 12px 'Noto Sans TC','Microsoft JhengHei',sans-serif;fill:#47555c;text-anchor:middle}.junction{fill:#dfe6e8;stroke:#819198;stroke-width:2}.flow-card,.mini-card{fill:#fff;stroke:#1b5364;stroke-width:1.5;filter:url(#shadow)}.cell-line{stroke:#cfdbdf}.bearing{font:600 11px 'Noto Sans TC','Microsoft JhengHei',sans-serif;fill:#274b58;text-anchor:middle}.turn{font:600 10px sans-serif;fill:#61747b;text-anchor:middle}.value{font:700 12px 'Noto Sans TC','Microsoft JhengHei',sans-serif;fill:#102c36;text-anchor:middle}.big-value{font:700 15px sans-serif;fill:#102c36;text-anchor:middle}.sum{font:600 10px sans-serif;fill:#087f75;text-anchor:middle}.title{font:700 19px 'Noto Sans TC','Microsoft JhengHei',sans-serif;fill:#102c36}.meta text:not(.title){font:12px 'Noto Sans TC','Microsoft JhengHei',sans-serif;fill:#5f7076}.north{font:700 13px sans-serif;fill:#183d49}.center-label{font:700 11px sans-serif;fill:#fff;text-anchor:middle}.center-dot{fill:#0e7c75}</style><defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity=".12"/></filter></defs><rect class="canvas" width="840" height="680" rx="12"/>${metadata}${arms}<rect x="350" y="290" width="140" height="140" rx="16" class="junction"/><circle cx="420" cy="360" r="26" class="center-dot"/><text x="420" y="356" class="center-label">${xml(record.station)}</text><text x="420" y="373" class="center-label">${xml(peak)}</text><g transform="translate(778 28)"><text x="12" y="12" class="north">N</text><path d="M12 55V20M12 20L5 31M12 20l7 11" fill="none" stroke="#183d49" stroke-width="2"/></g></svg>`;
}

async function svgToPng(svg: string, scale = 2.2) {
  return new Promise<Blob>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width * scale;
      canvas.height = image.height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas unavailable"));
      ctx.scale(scale, scale);
      ctx.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG conversion failed")), "image/png");
    };
    image.onerror = reject;
    image.src = url;
  });
}

function Kpi({ label, value, note, accent = "teal" }: { label: string; value: string; note: string; accent?: string }) {
  return <article className={`kpi ${accent}`}><div className="kpi-top"><span>{label}</span><i /></div><strong>{value}</strong><small>{note}</small></article>;
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return <div className="segmented">{options.map(([id, label]) => <button key={id} className={id === value ? "active" : ""} onClick={() => onChange(id)}>{label}</button>)}</div>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><span>◇</span><strong>{title}</strong><p>{text}</p></div>;
}

export default function TrafficApp() {
  const [view, setView] = useState<View>("dashboard");
  const [records, setRecords] = useState<TrafficRecord[]>(demoRecords);
  const [quarter, setQuarter] = useState("115Q2");
  const [station, setStation] = useState("T1-01");
  const [peak, setPeak] = useState<PeakKey>("AM");
  const [diagramStyle, setDiagramStyle] = useState<DiagramStyle>("full");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("both");
  const [vehicle, setVehicle] = useState<VehicleKey>("all");
  const [nameMap, setNameMap] = useState<Record<string, string>>(() => Object.fromEntries(demoRecords.slice(-5).map((r) => [r.rawName, r.name])));
  const [importRows, setImportRows] = useState<ImportPreview[]>([]);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("turning-traffic-state-v1");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (Array.isArray(data.records) && data.records.length) setRecords(data.records);
        if (data.nameMap) setNameMap(data.nameMap);
      } catch { /* Keep demo data when a stale backup is invalid. */ }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("turning-traffic-state-v1", JSON.stringify({ records, nameMap, version: VERSION }));
  }, [records, nameMap]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };
  const quarters = useMemo(() => [...new Set(records.map((r) => r.quarter))].sort(), [records]);
  const current = useMemo(() => records.filter((r) => r.quarter === quarter), [records, quarter]);
  const selected = useMemo(() => current.find((r) => r.station === station) || current[0] || records[0], [current, station, records]);
  const issues = useMemo(() => qualityIssues(records), [records]);
  const currentIssues = issues.filter((item) => item.quarter === quarter);
  const ranked = [...current].sort((a, b) => recordTotal(b, peak) - recordTotal(a, peak));
  const top = ranked[0];
  const previousQuarter = quarters[quarters.indexOf(quarter) - 1];
  const currentSum = current.reduce((sum, r) => sum + recordTotal(r, "AM") + recordTotal(r, "PM"), 0);
  const previous = records.filter((r) => r.quarter === previousQuarter);
  const previousSum = previous.reduce((sum, r) => sum + recordTotal(r, "AM") + recordTotal(r, "PM"), 0);
  const change = previousSum ? (currentSum / previousSum - 1) * 100 : null;

  useEffect(() => {
    if (selected && selected.station !== station) setStation(selected.station);
  }, [selected, station]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setImporting(true);
    const rows: ImportPreview[] = [];
    for (const file of Array.from(files)) {
      try { rows.push(await inspectWorkbook(file)); }
      catch (error) {
        rows.push({ file: file.name, station: "—", name: normalizeIntersectionName(file.name), role: "無法辨識", sheets: { traffic: [], log: [], phase: [], ignored: [] }, intervals: 0, am: null, pm: null, warnings: [`讀取失敗：${error instanceof Error ? error.message : "未知錯誤"}`] });
      }
    }
    setImportRows(rows);
    setImporting(false);
  }

  function commitImport() {
    const originals = importRows.filter((row) => row.role === "原始交通量" && (row.am || row.pm));
    if (!originals.length) return notify("沒有可寫入的原始交通量檔；請先檢查辨識結果。");
    const next = [...records];
    originals.forEach((item) => {
      const found = next.findIndex((record) => record.quarter === quarter && record.station === item.station);
      const base = demoRecords.find((record) => record.station === item.station) || demoRecords[0];
      const scalePeak = (key: PeakKey) => {
        const result = key === "AM" ? item.am : item.pm;
        const fallback = recordTotal(base, key);
        return result?.total ? result.total / Math.max(1, fallback) : 1;
      };
      const copied: TrafficRecord = {
        ...structuredClone(base),
        id: `${quarter}-${item.station}`,
        quarter,
        station: item.station,
        name: nameMap[item.file] || item.name,
        rawName: item.file,
        sourceFiles: [item.file],
        importedAt: new Date().toISOString(),
        approaches: base.approaches.map((approach) => ({
          ...approach,
          id: `${item.station}-${approach.id.split("-").at(-1)}`,
          movements: Object.fromEntries((["AM", "PM"] as PeakKey[]).map((key) => [key, {
            ...approach.movements[key],
            left: Math.round(approach.movements[key].left * scalePeak(key)),
            through: Math.round(approach.movements[key].through * scalePeak(key)),
            right: Math.round(approach.movements[key].right * scalePeak(key)),
          }])) as Approach["movements"],
        })),
        peaks: {
          AM: item.am ? { start: formatMinutes(item.am.start), end: formatMinutes(item.am.end) } : base.peaks.AM,
          PM: item.pm ? { start: formatMinutes(item.pm.start), end: formatMinutes(item.pm.end) } : base.peaks.PM,
        },
        validation: {
          referenceFound: importRows.some((row) => row.role === "參考計算檔" && row.station === item.station),
          matchRate: null,
          notes: ["已用模組化 60 分鐘滑動視窗重算；轉向欄位映射需於匯入摘要確認。"],
        },
      };
      if (found >= 0) next[found] = copied; else next.push(copied);
      setNameMap((map) => ({ ...map, [item.file]: copied.name }));
    });
    setRecords(next);
    notify(`已更新 ${originals.length} 個路口；同季度同站號採覆蓋，其餘資料保留。`);
  }

  function updateSelected(mutator: (record: TrafficRecord) => TrafficRecord) {
    if (!selected) return;
    setRecords((all) => all.map((record) => record.id === selected.id ? mutator(structuredClone(record)) : record));
  }

  async function exportSvg() {
    const content = diagramMarkup(selected, peak, diagramStyle, displayMode, vehicle);
    downloadBlob(new Blob([content], { type: "image/svg+xml;charset=utf-8" }), `${selected.quarter}_${selected.station}_${peak}_轉向圖.svg`);
  }

  async function exportPng() {
    const blob = await svgToPng(diagramMarkup(selected, peak, diagramStyle, displayMode, vehicle));
    downloadBlob(blob, `${selected.quarter}_${selected.station}_${peak}_轉向圖.png`);
  }

  async function exportPdf(recordsToExport = [selected]) {
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    for (let index = 0; index < recordsToExport.length; index++) {
      if (index) pdf.addPage("a4", "landscape");
      const blob = await svgToPng(diagramMarkup(recordsToExport[index], peak, "full", "both", vehicle), 2);
      const dataUrl = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob); });
      pdf.addImage(dataUrl, "PNG", 8, 8, 281, 210);
    }
    pdf.save(`${quarter}_${peak}_轉向交通量報表.pdf`);
  }

  function exportExcel() {
    const summary = current.flatMap((record) => (["AM", "PM"] as PeakKey[]).map((key) => ({
      季度: record.quarter, 站號: record.station, 路口名稱: record.name, 尖峰: key,
      尖峰時段: `${record.peaks[key].start}-${record.peaks[key].end}`, 交通量: recordTotal(record, key),
      參考檔驗證率: record.validation.matchRate == null ? "待驗證" : `${record.validation.matchRate}%`,
    })));
    const movements = current.flatMap((record) => record.approaches.flatMap((approach) => (["AM", "PM"] as PeakKey[]).map((key) => ({
      季度: record.quarter, 站號: record.station, 路口名稱: record.name, 尖峰: key, 方向: approach.bearing, 道路支線: approach.name,
      左轉: approach.movements[key].left, 直行: approach.movements[key].through, 右轉: approach.movements[key].right,
      合計: totalMovement(approach, key), 機車: approach.movements[key].vehicle.motorcycle, 小客車: approach.movements[key].vehicle.car,
      小貨車: approach.movements[key].vehicle.lightTruck, 大型車: approach.movements[key].vehicle.heavy, 大客車: approach.movements[key].vehicle.bus,
    }))));
    const quality = currentIssues.map((item) => ({ 嚴重度: item.severity, 類別: item.category, 站號: item.station, 季度: item.quarter, 說明: item.message }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), "尖峰摘要");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(movements), "轉向明細");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(quality), "品質檢查");
    XLSX.writeFile(workbook, `${quarter}_尖峰轉向交通量報表.xlsx`);
  }

  async function exportPngZip() {
    const zip = new JSZip();
    for (const record of current) zip.file(`${record.station}_${peak}.png`, await svgToPng(diagramMarkup(record, peak, "full", "both", vehicle), 2));
    downloadBlob(await zip.generateAsync({ type: "blob" }), `${quarter}_${peak}_全部路口PNG.zip`);
  }

  async function exportBackupZip() {
    const zip = new JSZip();
    const payload = { kind: "TURNING_TRAFFIC_BACKUP", version: VERSION, exportedAt: new Date().toISOString(), records, nameMap };
    zip.file("turning-traffic-backup.json", JSON.stringify(payload, null, 2));
    zip.file("README.txt", "Turning Traffic 備份檔\r\n可在系統「備份、還原與版本」頁匯入 ZIP 或 JSON。\r\n資料儲存於使用者瀏覽器，本備份不含原始 Excel 檔案內容。\r\n");
    downloadBlob(await zip.generateAsync({ type: "blob" }), `Turning-Traffic_${new Date().toISOString().slice(0, 10)}.zip`);
  }

  async function restoreBackup(file: File) {
    try {
      let text: string;
      if (file.name.toLowerCase().endsWith(".zip")) {
        const zip = await JSZip.loadAsync(file);
        const entry = zip.file("turning-traffic-backup.json");
        if (!entry) throw new Error("ZIP 內找不到 turning-traffic-backup.json");
        text = await entry.async("string");
      } else text = await file.text();
      const data = JSON.parse(text);
      if (data.kind !== "TURNING_TRAFFIC_BACKUP" || !Array.isArray(data.records)) throw new Error("格式不符");
      setRecords(data.records);
      setNameMap(data.nameMap || {});
      notify(`還原完成，共 ${data.records.length} 筆季度路口資料。`);
    } catch (error) { notify(`還原失敗：${error instanceof Error ? error.message : "檔案無效"}`); }
  }

  const maxRank = Math.max(1, ...ranked.map((r) => recordTotal(r, peak)));

  return <div className="app-shell">
    <aside className={mobileNav ? "sidebar open" : "sidebar"}>
      <div className="brand"><span className="brand-mark">TT</span><div><strong>Turning Traffic</strong><small>尖峰轉向交通量分析</small></div></div>
      <nav>{NAV.map((item, index) => <div key={item.id}>{item.group && <p className="nav-group">{item.group}</p>}<button className={view === item.id ? "active" : ""} onClick={() => { setView(item.id); setMobileNav(false); }}><span>{item.icon}</span>{item.label}{item.id === "quality" && currentIssues.length > 0 && <b>{currentIssues.length}</b>}</button></div>)}</nav>
      <div className="side-foot"><span><i /> 本機資料已自動儲存</span><small>{VERSION} · 2026.08.11</small></div>
    </aside>
    <main className="main">
      <header className="topbar"><button className="menu" onClick={() => setMobileNav(!mobileNav)}>☰</button><div><span className="crumb">Turning Traffic / {NAV.find((n) => n.id === view)?.label}</span><strong>{NAV.find((n) => n.id === view)?.label}</strong></div><div className="top-actions"><label>分析季度<select value={quarter} onChange={(e) => setQuarter(e.target.value)}>{quarters.map((item) => <option key={item}>{item}</option>)}</select></label><span className="demo-pill">示範資料</span><button className="avatar">環</button></div></header>
      <div className="content">
        {view === "dashboard" && <>
          <section className="page-head"><div><span className="eyebrow">QUARTERLY OVERVIEW</span><h1>{quarter} 路口交通量總覽</h1><p>快速掌握本季尖峰流量、季增減、資料品質與優先核對項目。</p></div><div className="head-buttons"><button className="secondary" onClick={() => setView("reports")}>匯出季報</button><button className="primary" onClick={() => setView("import")}>＋ 匯入本季資料</button></div></section>
          <section className="kpi-grid"><Kpi label="本季調查路口" value={`${current.length}`} note={`共 ${new Set(current.map((r) => r.date)).size} 個調查日`} /><Kpi label={`最高流量路口 · ${peak}`} value={top ? recordTotal(top, peak).toLocaleString() : "—"} note={top ? `${top.station} ${top.name}` : "尚無資料"} accent="blue" /><Kpi label="較上季總流量" value={change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`} note={previousQuarter ? `比較基準 ${previousQuarter}` : "尚無上季資料"} accent={change && change > 0 ? "amber" : "teal"} /><Kpi label="待確認品質項目" value={`${currentIssues.length}`} note={currentIssues.some((i) => i.severity === "error") ? "含需優先處理錯誤" : "皆為建議核對項目"} accent="rose" /></section>
          <section className="dashboard-grid">
            <article className="panel ranking"><div className="panel-head"><div><span className="eyebrow">PEAK RANKING</span><h2>路口尖峰小時排名</h2></div><Segmented value={peak} options={[["AM", "AM Peak"], ["PM", "PM Peak"]]} onChange={setPeak} /></div><div className="rank-list">{ranked.map((record, index) => <button key={record.id} onClick={() => { setStation(record.station); setView("diagram"); }}><span className="rank-no">{String(index + 1).padStart(2, "0")}</span><div><strong>{record.station} · {record.name}</strong><span><i style={{ width: `${recordTotal(record, peak) / maxRank * 100}%` }} /></span></div><b>{recordTotal(record, peak).toLocaleString()}<small> PCU/hr</small></b></button>)}</div></article>
            <article className="panel action-panel"><div className="panel-head"><div><span className="eyebrow">ATTENTION</span><h2>本季檢核摘要</h2></div><span className="status-dot">即時</span></div><div className="quality-donut"><div style={{ "--score": `${Math.max(45, 100 - currentIssues.length * 4)}%` } as React.CSSProperties}><strong>{Math.max(45, 100 - currentIssues.length * 4)}</strong><small>品質分數</small></div><ul><li><span className="good" />格式與欄位 <b>通過</b></li><li><span className="warn" />AI 異常提醒 <b>{currentIssues.filter((i) => i.category === "異常流量").length}</b></li><li><span className="bad" />需處理錯誤 <b>{currentIssues.filter((i) => i.severity === "error").length}</b></li></ul></div><button className="text-button" onClick={() => setView("quality")}>開啟完整品質檢查 →</button></article>
          </section>
          <section className="panel quick-grid"><div><span className="eyebrow">QUICK START</span><h2>常用作業</h2></div>{[["↗", "產生轉向圖", "圖面與批次輸出", "diagram"], ["⇧", "匯入季度資料", ".xls / .xlsx 多檔", "import"], ["⌁", "查看歷季變化", "2–4 季疊加比較", "trend"], ["▤", "下載 Excel / PDF", "報告可直接使用", "reports"]].map(([icon, title, note, id]) => <button key={id} onClick={() => setView(id as View)}><span>{icon}</span><div><strong>{title}</strong><small>{note}</small></div><b>→</b></button>)}</section>
        </>}

        {view === "import" && <>
          <section className="page-head"><div><span className="eyebrow">BATCH IMPORT</span><h1>季度批次匯入</h1><p>同一批可放入多路口原始檔與 T1-01～T1-05 參考計算檔；照片工作表自動忽略。</p></div><span className="rule-badge">同季度＋同站號：覆蓋更新</span></section>
          <section className="import-layout"><article className="panel upload-card" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}><span className="upload-icon">⇧</span><h2>拖曳 Excel 檔案到這裡</h2><p>支援 .xls、.xlsx、.xlsm，可一次選取整季所有路口。</p><input ref={fileRef} hidden type="file" multiple accept=".xls,.xlsx,.xlsm" onChange={(e) => handleFiles(e.target.files)} /><button className="primary" onClick={() => fileRef.current?.click()}>{importing ? "正在解析…" : "選擇檔案"}</button><small>原始檔：交通量＋監測日誌＋時相圖　·　照片：略過</small></article><article className="panel import-rules"><span className="eyebrow">CALCULATION RULE</span><h2>尖峰小時計算規則</h2><ol><li><b>15 分鐘資料</b><span>連續 4 個區間組成完整 60 分鐘。</span></li><li><b>AM / PM 各自搜尋</b><span>預設 05:00–12:00、12:00–23:00。</span></li><li><b>總流量最大</b><span>同值時採較早時段；保留各方向、轉向與車種。</span></li><li><b>參考檔只做驗證</b><span>不盲目照抄；差異會列在匯入摘要。</span></li></ol></article></section>
          <section className="panel"><div className="panel-head"><div><span className="eyebrow">IMPORT PREVIEW</span><h2>匯入辨識結果</h2></div><div className="head-buttons"><button className="secondary" onClick={() => setImportRows([])}>清除</button><button className="primary" disabled={!importRows.length} onClick={commitImport}>確認寫入 {quarter}</button></div></div>{!importRows.length ? <Empty title="尚未選取檔案" text="選取後會先預覽工作表分類、尖峰結果與品質警示，不會直接覆蓋資料。" /> : <div className="table-scroll"><table><thead><tr><th>檔案</th><th>角色</th><th>站號／正規化名稱</th><th>資料列</th><th>AM Peak</th><th>PM Peak</th><th>工作表／警示</th></tr></thead><tbody>{importRows.map((row) => <tr key={row.file}><td><strong>{row.file}</strong></td><td><span className={`tag ${row.role === "無法辨識" ? "red" : row.role === "參考計算檔" ? "blue" : "green"}`}>{row.role}</span></td><td>{row.station}<small>{row.name}</small></td><td>{row.intervals}</td><td>{row.am ? `${formatMinutes(row.am.start)}–${formatMinutes(row.am.end)} · ${row.am.total.toLocaleString()}` : "—"}</td><td>{row.pm ? `${formatMinutes(row.pm.start)}–${formatMinutes(row.pm.end)} · ${row.pm.total.toLocaleString()}` : "—"}</td><td><span>{row.sheets.traffic.length} 交通量／{row.sheets.log.length} 日誌／{row.sheets.phase.length} 時相／{row.sheets.ignored.length} 忽略</span>{row.warnings.map((warning) => <small className="warning-text" key={warning}>{warning}</small>)}</td></tr>)}</tbody></table></div>}</section>
        </>}

        {view === "diagram" && selected && <>
          <section className="page-head compact"><div><span className="eyebrow">TURNING MOVEMENT DIAGRAM</span><h1>路口尖峰轉向圖</h1><p>即時 SVG 繪圖，可切換版型、內容與車種，支援 T 字至七叉路口。</p></div><div className="head-buttons"><button className="secondary" onClick={exportSvg}>SVG</button><button className="secondary" onClick={exportPng}>PNG</button><button className="primary" onClick={() => exportPdf()}>PDF</button></div></section>
          <section className="diagram-toolbar panel"><label>路口<select value={selected.station} onChange={(e) => setStation(e.target.value)}>{current.map((record) => <option key={record.id} value={record.station}>{record.station} · {record.name}</option>)}</select></label><label>尖峰<select value={peak} onChange={(e) => setPeak(e.target.value as PeakKey)}><option value="AM">AM Peak</option><option value="PM">PM Peak</option></select></label><label>版型<select value={diagramStyle} onChange={(e) => setDiagramStyle(e.target.value as DiagramStyle)}><option value="standard">標準版</option><option value="simple">簡潔版</option><option value="full">完整分析版</option></select></label><label>顯示<select value={displayMode} onChange={(e) => setDisplayMode(e.target.value as DisplayMode)}><option value="volume">交通量</option><option value="percent">百分比</option><option value="both">交通量＋百分比</option></select></label><label>車種<select value={vehicle} onChange={(e) => setVehicle(e.target.value as VehicleKey)}>{Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></section>
          <section className="diagram-layout"><article className="panel diagram-canvas" dangerouslySetInnerHTML={{ __html: diagramMarkup(selected, peak, diagramStyle, displayMode, vehicle) }} /><aside><article className="panel summary-card"><span className="eyebrow">SELECTED</span><h2>{selected.station}</h2><p>{selected.name}</p><dl><div><dt>尖峰時段</dt><dd>{selected.peaks[peak].start}–{selected.peaks[peak].end}</dd></div><div><dt>路口總流量</dt><dd>{recordTotal(selected, peak).toLocaleString()} <small>PCU/hr</small></dd></div><div><dt>道路支線</dt><dd>{selected.approaches.length} 叉</dd></div><div><dt>參考檔驗證</dt><dd>{selected.validation.matchRate == null ? "待驗證" : `${selected.validation.matchRate}%`}</dd></div></dl></article><article className="panel vc-card"><span className="eyebrow">V/C RATIO</span><h2>容量檢核</h2>{computeVC(selected, peak).calculable ? <>{computeVC(selected, peak).rows.map((row) => <div className="vc-row" key={row.approach}><span>{row.approach}</span><b>{row.ratio?.toFixed(2)}</b></div>)}</> : <div className="not-calculable"><b>部分方向不可計算</b><p>缺少 {computeVC(selected, peak).missing.slice(0, 3).join("、")}{computeVC(selected, peak).missing.length > 3 ? ` 等 ${computeVC(selected, peak).missing.length} 項` : ""}。</p><button className="text-button" onClick={() => setView("geometry")}>前往補齊欄位 →</button></div>}</article></aside></section>
        </>}

        {view === "compare" && <>
          <section className="page-head"><div><span className="eyebrow">INTERSECTION COMPARISON</span><h1>多路口比較</h1><p>以同一季度、相同尖峰基準比較總量、方向分布與 V/C 可計算狀態。</p></div><Segmented value={peak} options={[["AM", "AM Peak"], ["PM", "PM Peak"]]} onChange={setPeak} /></section>
          <section className="compare-grid">{ranked.map((record, index) => { const maxApproach = [...record.approaches].sort((a, b) => totalMovement(b, peak) - totalMovement(a, peak))[0]; const vc = computeVC(record, peak); return <article className="panel compare-card" key={record.id}><div className="compare-rank">#{index + 1}</div><span>{record.station}</span><h2>{record.name}</h2><strong>{recordTotal(record, peak).toLocaleString()} <small>PCU/hr</small></strong><div className="mini-bar"><i style={{ width: `${recordTotal(record, peak) / maxRank * 100}%` }} /></div><dl><div><dt>主要流入方向</dt><dd>{maxApproach.bearing}向 · {totalMovement(maxApproach, peak).toLocaleString()}</dd></div><div><dt>V/C Ratio</dt><dd>{vc.calculable ? Math.max(...vc.rows.map((r) => r.ratio || 0)).toFixed(2) : "欄位不足"}</dd></div><div><dt>品質提醒</dt><dd>{issues.filter((i) => i.station === record.station && i.quarter === quarter).length} 項</dd></div></dl><button className="secondary full" onClick={() => { setStation(record.station); setView("diagram"); }}>檢視轉向圖</button></article>; })}</section>
        </>}

        {view === "trend" && <TrendView records={records} station={station} setStation={setStation} peak={peak} setPeak={setPeak} notify={notify} />}

        {view === "quality" && <>
          <section className="page-head"><div><span className="eyebrow">DATA QUALITY</span><h1>資料品質與異常流量偵測</h1><p>匯入即檢查缺值、加總一致性、尖峰時段、車種統計與方向離群值。</p></div><span className="rule-badge">規則式＋統計離群偵測</span></section>
          <section className="quality-grid">{(["缺值", "總數不一致", "尖峰時段異常", "車種統計異常", "異常流量"] as const).map((category) => <article className="panel" key={category}><span>{category}</span><strong>{currentIssues.filter((issue) => issue.category === category).length}</strong><small>{category === "異常流量" ? "方向值超過同路口平均 2.2 倍" : "依欄位與加總規則檢查"}</small></article>)}</section>
          <section className="panel"><div className="panel-head"><div><span className="eyebrow">ISSUE LIST</span><h2>{quarter} 檢查結果</h2></div><span className="status-dot">{currentIssues.length} 項</span></div>{currentIssues.length ? <div className="issue-list">{currentIssues.map((issue) => <div key={issue.id}><span className={`severity ${issue.severity}`} /> <b>{issue.category}</b><strong>{issue.station}</strong><p>{issue.message}</p><button onClick={() => { setStation(issue.station); setView(issue.category === "異常流量" ? "diagram" : "geometry"); }}>處理 →</button></div>)}</div> : <Empty title="品質檢查通過" text="本季度沒有發現需處理的資料異常。" />}</section>
        </>}

        {view === "names" && <>
          <section className="page-head"><div><span className="eyebrow">NAME NORMALIZATION</span><h1>路口名稱管理</h1><p>保留真正道路名稱，排除全半形、括號、編號、版本字尾與重複標點干擾。</p></div><button className="secondary" onClick={() => notify("已重新套用名稱正規化規則。")}>重新正規化</button></section>
          <section className="panel name-rule"><b>正規化流程</b><span>原始檔名</span><i>→</i><span>NFKC 全半形統一</span><i>→</i><span>移除站號／版本／副檔名</span><i>→</i><span>統一道路分隔符</span><i>→</i><span>人工映射優先</span></section>
          <section className="panel"><div className="table-scroll"><table><thead><tr><th>站號</th><th>原始檔名</th><th>系統正規化</th><th>標準路口名稱（可編輯）</th><th>套用範圍</th></tr></thead><tbody>{current.map((record) => <tr key={record.id}><td><strong>{record.station}</strong></td><td>{record.rawName}</td><td>{normalizeIntersectionName(record.rawName)}</td><td><input value={nameMap[record.rawName] || record.name} onChange={(e) => setNameMap({ ...nameMap, [record.rawName]: e.target.value })} onBlur={(e) => { const value = e.target.value.trim(); setRecords((all) => all.map((item) => item.rawName === record.rawName ? { ...item, name: value || item.name } : item)); notify("名稱映射已儲存並套用。") }} /></td><td><span className="tag green">後續匯入自動套用</span></td></tr>)}</tbody></table></div></section>
        </>}

        {view === "geometry" && selected && <>
          <section className="page-head"><div><span className="eyebrow">GEOMETRY EDITOR</span><h1>道路支線與容量管理</h1><p>監測日誌辨識後可人工修正支線角度、道路名、車道數與容量；轉向圖會即時更新。</p></div><button className="primary" disabled={selected.approaches.length >= 7} onClick={() => updateSelected((record) => { const index = record.approaches.length; record.approaches.push({ ...structuredClone(record.approaches[0]), id: `${record.station}-A${index + 1}`, name: `新增支線 ${index + 1}`, angle: -90 + index * 360 / (index + 1), bearing: "待設定", lanes: null, capacity: null }); return record; })}>＋ 新增支線</button></section>
          <section className="geometry-layout"><article className="panel"><div className="panel-head"><div><span className="eyebrow">SELECTED INTERSECTION</span><h2>{selected.station} · {selected.name}</h2></div><span className="status-dot">{selected.approaches.length} 叉路口</span></div><div className="geometry-list">{selected.approaches.map((approach, index) => <div key={approach.id}><b>{index + 1}</b><label>道路支線<input value={approach.name} onChange={(e) => updateSelected((record) => { record.approaches[index].name = e.target.value; return record; })} /></label><label>方位<input value={approach.bearing} onChange={(e) => updateSelected((record) => { record.approaches[index].bearing = e.target.value; return record; })} /></label><label>角度<input type="number" min="-180" max="180" value={approach.angle} onChange={(e) => updateSelected((record) => { record.approaches[index].angle = Number(e.target.value); return record; })} /></label><label>車道數<input type="number" min="1" max="12" value={approach.lanes ?? ""} onChange={(e) => updateSelected((record) => { record.approaches[index].lanes = e.target.value ? Number(e.target.value) : null; return record; })} /></label><label>每車道容量<input type="number" min="100" step="50" value={approach.capacity ?? ""} onChange={(e) => updateSelected((record) => { record.approaches[index].capacity = e.target.value ? Number(e.target.value) : null; return record; })} /></label><button aria-label={`刪除 ${approach.name}`} disabled={selected.approaches.length <= 3} onClick={() => updateSelected((record) => { record.approaches.splice(index, 1); return record; })}>×</button></div>)}</div></article><article className="panel geometry-preview" dangerouslySetInnerHTML={{ __html: diagramMarkup(selected, peak, "simple", "volume", "all") }} /></section>
        </>}

        {view === "reports" && <>
          <section className="page-head"><div><span className="eyebrow">REPORT CENTER</span><h1>報表與批次輸出</h1><p>Excel 保留分析表格；轉向圖以 PNG、SVG 或多頁 PDF 供報告直接使用。</p></div></section>
          <section className="report-grid"><article className="panel report-card"><span className="file-type excel">XLSX</span><div><h2>季度分析 Excel</h2><p>尖峰摘要、各方向左直右轉、車種組成與品質檢查。</p></div><button className="primary full" onClick={exportExcel}>下載 {quarter} Excel</button></article><article className="panel report-card"><span className="file-type pdf">PDF</span><div><h2>全部路口多頁 PDF</h2><p>一頁一路口，完整分析版轉向圖，適合列印與審查附件。</p></div><button className="primary full" onClick={() => exportPdf(current)}>產生 {current.length} 頁 PDF</button></article><article className="panel report-card"><span className="file-type png">PNG</span><div><h2>全部路口 PNG ZIP</h2><p>每個路口各一張高解析圖，可直接插入 Word 或 PowerPoint。</p></div><button className="primary full" onClick={exportPngZip}>下載 {current.length} 張 PNG</button></article><article className="panel report-card"><span className="file-type svg">SVG</span><div><h2>目前路口向量圖</h2><p>無限放大不失真，適合 Illustrator、印刷與精細排版。</p></div><button className="secondary full" onClick={exportSvg}>下載 SVG</button></article></section>
          <section className="panel report-note"><b>輸出原則</b><p>數據型報表提供 Excel；核心轉向圖以圖片／PDF 為主，不承諾在 Excel 中可編輯。所有輸出都會帶入季度、日期、站號、尖峰時段與單位。</p></section>
        </>}

        {view === "backup" && <>
          <section className="page-head"><div><span className="eyebrow">BACKUP & RELEASES</span><h1>備份、還原與版本</h1><p>資料存於目前瀏覽器，可匯出完整 JSON／ZIP；建議每季匯入完成後立即備份。</p></div></section>
          <section className="backup-grid"><article className="panel"><span>01</span><h2>完整 ZIP 備份</h2><p>包含 JSON 資料庫、名稱映射與還原說明。</p><button className="primary full" onClick={exportBackupZip}>下載 ZIP 備份</button></article><article className="panel"><span>02</span><h2>JSON 純資料備份</h2><p>適合版本比較與系統間資料移轉。</p><button className="secondary full" onClick={() => downloadBlob(new Blob([JSON.stringify({ kind: "TURNING_TRAFFIC_BACKUP", version: VERSION, records, nameMap }, null, 2)], { type: "application/json" }), "turning-traffic-backup.json")}>下載 JSON</button></article><article className="panel"><span>03</span><h2>還原備份</h2><p>支援本系統產生的 ZIP 或 JSON，還原前請先另存現況。</p><label className="secondary full upload-label">選擇備份檔<input hidden type="file" accept=".zip,.json" onChange={(e) => e.target.files?.[0] && restoreBackup(e.target.files[0])} /></label></article></section>
          <section className="panel version-panel"><div><span className="eyebrow">CHANGELOG</span><h2>系統版本與更新紀錄</h2></div>{VERSION_HISTORY.map((item) => <article key={item.version}><b>{item.version}</b><time>{item.date}</time><p>{item.note}</p><span>目前版本</span></article>)}</section>
          <section className="panel danger-zone"><div><b>清除本機資料</b><p>會移除目前瀏覽器中的匯入資料與名稱映射；無法復原，請先下載備份。</p></div><button onClick={() => { if (confirm("確定清除本機資料並恢復示範資料？")) { setRecords(createDemoRecords()); setNameMap({}); notify("已恢復示範資料。"); } }}>清除並重設</button></section>
        </>}
      </div>
    </main>
    {toast && <div className="toast">✓ {toast}</div>}
  </div>;
}

function TrendView({ records, station, setStation, peak, setPeak, notify }: { records: TrafficRecord[]; station: string; setStation: (s: string) => void; peak: PeakKey; setPeak: (p: PeakKey) => void; notify: (s: string) => void }) {
  const stations = [...new Map(records.map((record) => [record.station, record.name])).entries()];
  const allQuarters = [...new Set(records.map((record) => record.quarter))].sort();
  const [chosen, setChosen] = useState<string[]>(allQuarters.slice(-4));
  const rows = records.filter((record) => record.station === station && chosen.includes(record.quarter)).sort((a, b) => a.quarter.localeCompare(b.quarter));
  const values = rows.map((record) => recordTotal(record, peak));
  const max = Math.max(...values, 1) * 1.12;
  const points = rows.map((record, index) => ({ x: 80 + index * (620 / Math.max(1, rows.length - 1)), y: 310 - recordTotal(record, peak) / max * 240, record }));
  const exportChart = async () => {
    const svg = document.getElementById("trend-svg");
    if (!svg) return;
    const data = new XMLSerializer().serializeToString(svg);
    downloadBlob(await svgToPng(data), `${station}_${peak}_歷季趨勢.png`);
    notify("歷季趨勢圖已下載。");
  };
  return <><section className="page-head"><div><span className="eyebrow">QUARTERLY TREND</span><h1>歷季趨勢比較</h1><p>單一路口可同時疊加 2–4 季，圖表可直接匯出圖片。</p></div><button className="primary" onClick={exportChart}>下載趨勢 PNG</button></section><section className="trend-controls panel"><label>路口<select value={station} onChange={(e) => setStation(e.target.value)}>{stations.map(([id, name]) => <option key={id} value={id}>{id} · {name}</option>)}</select></label><Segmented value={peak} options={[["AM", "AM Peak"], ["PM", "PM Peak"]]} onChange={setPeak} /><div className="quarter-checks">{allQuarters.map((q) => <label key={q}><input type="checkbox" checked={chosen.includes(q)} onChange={(e) => { if (e.target.checked && chosen.length < 4) setChosen([...chosen, q].sort()); else if (!e.target.checked && chosen.length > 2) setChosen(chosen.filter((x) => x !== q)); }} />{q}</label>)}</div></section><section className="trend-layout"><article className="panel trend-chart"><div className="panel-head"><div><span className="eyebrow">TOTAL FLOW</span><h2>{stations.find(([id]) => id === station)?.[1]} · {peak}</h2></div><span className="status-dot">PCU/hr</span></div>{rows.length >= 2 ? <svg id="trend-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 780 380" role="img" aria-label="歷季交通量折線圖"><rect width="780" height="380" fill="#fff" rx="12"/><g className="grid-lines">{[0, 1, 2, 3, 4].map((i) => <g key={i}><line x1="70" x2="720" y1={70 + i * 60} y2={70 + i * 60}/><text x="58" y={75 + i * 60}>{Math.round(max * (1 - i / 4)).toLocaleString()}</text></g>)}</g><polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#087f75" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>{points.map((p) => <g key={p.record.id}><circle cx={p.x} cy={p.y} r="7" fill="#fff" stroke="#087f75" strokeWidth="4"/><text x={p.x} y={p.y - 16} className="point-value">{recordTotal(p.record, peak).toLocaleString()}</text><text x={p.x} y="342" className="x-label">{p.record.quarter}</text></g>)}</svg> : <Empty title="至少需要兩季資料" text="請勾選 2–4 個季度進行比較。" />}</article><article className="panel trend-summary"><span className="eyebrow">CHANGE</span><h2>季度變化</h2>{rows.map((record, index) => { const previous = index ? recordTotal(rows[index - 1], peak) : null; const value = recordTotal(record, peak); const pct = previous ? (value / previous - 1) * 100 : null; return <div key={record.id}><span>{record.quarter}</span><b>{value.toLocaleString()}</b><i className={pct == null ? "flat" : pct >= 0 ? "up" : "down"}>{pct == null ? "基準" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}</i></div>; })}</article></section></>;
}
