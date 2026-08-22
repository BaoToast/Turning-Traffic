/*
 * 產生一份可直接塞進 localStorage("turning-traffic-state-v2") 的測試狀態，
 * 讓 Playwright 不必跑完整匯入流程就能操作路口轉向圖。
 * 兩個路口：4 叉（T15-03）與 7 叉（T15-01），車種含四大類＋3 個新增車種。
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const CORE = { motorcycle: "機車", car: "小型車", heavy: "大型車", special: "特種車" };
const EXTRA = { "custom:大貨車": "大貨車", "custom:大客車": "大客車", "custom:聯結車": "聯結車" };
const VEHICLES = { ...CORE, ...EXTRA };
const MOVES = ["left", "through", "right"];

function seeded(n) {
  let x = n * 9301 + 49297;
  return () => ((x = (x * 9301 + 49297) % 233280), x / 233280);
}

function vehicleSplit(total, rnd) {
  const weights = { motorcycle: 0.5, car: 0.34, heavy: 0.06, special: 0.02, "custom:大貨車": 0.04, "custom:大客車": 0.03, "custom:聯結車": 0.01 };
  const out = {};
  for (const [key, weight] of Object.entries(weights))
    out[key] = Math.round(total * weight * (0.85 + rnd() * 0.3));
  return out;
}

function buildRecord({ id, station, name, arms, quarter, projectId, seed }) {
  const rnd = seeded(seed);
  const approaches = arms.map((code, index) => ({
    id: `${id}-${code}`,
    sourceCode: code,
    name: `路口${code}`,
    bearing: ["N", "E", "S", "W", "NE", "SE", "SW"][index] ?? "N",
    angle: Math.round((360 / arms.length) * index),
    lanes: 2,
    laneType: "mixed",
    capacity: 1800,
    movements: {
      AM: { left: 0, through: 0, right: 0, vehicle: {} },
      PM: { left: 0, through: 0, right: 0, vehicle: {} },
    },
  }));

  const routes = [];
  for (const from of approaches)
    for (const to of approaches) {
      if (from.id === to.id) continue;
      const movement = MOVES[(approaches.indexOf(to) - approaches.indexOf(from) + arms.length) % arms.length % 3];
      const volumes = {};
      for (const peak of ["AM", "PM"]) {
        const pcu = Math.round((60 + rnd() * 900) * (peak === "AM" ? 1 : 0.85) * 10) / 10;
        volumes[peak] = { pcu, vehicle: vehicleSplit(pcu, rnd) };
      }
      routes.push({
        id: `${from.id}->${to.id}`,
        fromApproachId: from.id,
        toApproachId: to.id,
        movement,
        volumes,
        survey: { vehicle: vehicleSplit(volumes.AM.pcu * 9, rnd) },
      });
    }

  // 把 routes 彙總回 approach.movements，讓卡片有數字
  for (const route of routes)
    for (const peak of ["AM", "PM"]) {
      const source = approaches.find((item) => item.id === route.fromApproachId);
      source.movements[peak][route.movement] += route.volumes[peak].pcu;
      for (const [key, value] of Object.entries(route.volumes[peak].vehicle))
        source.movements[peak].vehicle[key] = (source.movements[peak].vehicle[key] ?? 0) + value;
    }
  for (const approach of approaches)
    for (const peak of ["AM", "PM"]) {
      const move = approach.movements[peak];
      move.left = Math.round(move.left * 10) / 10;
      move.through = Math.round(move.through * 10) / 10;
      move.right = Math.round(move.right * 10) / 10;
      move.rawVehicleTotal = Object.values(move.vehicle).reduce((sum, value) => sum + value, 0);
    }

  return {
    id,
    projectId,
    intersectionId: station,
    station,
    name,
    rawName: name,
    quarter,
    date: "2026-05-04",
    surveyType: "路口轉向",
    pceVersion: "training-1060310",
    peaks: { AM: { start: "07:15", end: "08:15" }, PM: { start: "17:30", end: "18:30" } },
    survey: { intervals: 96, minutes: 15, vehicle: vehicleSplit(38000, rnd) },
    vehicleLabels: VEHICLES,
    vehicleMapping: Object.fromEntries(Object.keys(VEHICLES).map((key) => [key, key])),
    approaches,
    routes,
    movementRule: "reference-calculation",
    revision: 1,
    sourceFiles: [`${station}_${quarter}.xlsx`],
    importedAt: "2026-05-10T02:00:00.000Z",
    validation: { referenceFound: true, matchRate: 1, notes: [] },
  };
}

const projectId = "P-test-1";
const state = {
  kind: "TURNING_TRAFFIC_STATE",
  version: 2,
  projects: [
    {
      id: projectId,
      code: "11017",
      name: "高捷岡山路竹延伸線RKC02標",
      client: "測試單位",
      note: "",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  activeProjectId: projectId,
  records: [
    buildRecord({ id: "R1", station: "T15-03", name: "台1－路科一路口", arms: ["A", "B", "C", "D"], quarter: "115Q2", projectId, seed: 7 }),
    buildRecord({ id: "R2", station: "T15-01", name: "台1－岡山交流道路口", arms: ["A", "B", "C", "D", "E", "F", "G"], quarter: "115Q2", projectId, seed: 11 }),
    buildRecord({ id: "R3", station: "T15-03", name: "台1－路科一路口", arms: ["A", "B", "C", "D"], quarter: "115Q1", projectId, seed: 13 }),
  ],
  nameMap: {},
  pce: {
    special: { left: 2.5, through: 2, right: 2.3 },
    heavy: { left: 2.3, through: 1.5, right: 2 },
    car: { left: 1.5, through: 1, right: 1.3 },
    motorcycle: { left: 0.5, through: 0.3, right: 0.4 },
    "custom:大貨車": { left: 1, through: 1, right: 1 },
    "custom:大客車": { left: 1, through: 1, right: 1 },
    "custom:聯結車": { left: 1, through: 1, right: 1 },
  },
  vehicleCatalog: VEHICLES,
  vehicleMappings: {},
  formatMemories: [],
  vehicleSchemes: [],
  recordRevisions: [],
};

writeFileSync(join(here, "seed-state.json"), JSON.stringify(state));
console.log(
  "已產生 seed-state.json：",
  state.records.length,
  "筆紀錄；車種",
  Object.keys(VEHICLES).length,
  "種",
);
