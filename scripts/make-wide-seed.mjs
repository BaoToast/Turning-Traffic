/*
 * 產生一份「像真的」的測試資料：同一個路口有 111Q3～115Q2 共 16 季，
 * 站號中途換過兩次（T13-xx → T14-xx → T15-xx），另外再放一個同季並存的
 * 北向／南向站，用來同時驗證歷季趨勢的兩種站號情境與各頁面的排版。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(join(here, "seed-state.json"), "utf8"));
const template = base.records.find((r) => r.station === "T15-03");

const quarters = [];
for (const year of [111, 112, 113, 114, 115])
  for (const q of [1, 2, 3, 4]) {
    if (year === 111 && q < 3) continue;
    if (year === 115 && q > 2) continue;
    quarters.push(`${year}Q${q}`);
  }

function scaleRecord(source, { id, quarter, station, name, factor }) {
  const clone = structuredClone(source);
  clone.id = id;
  clone.quarter = quarter;
  clone.station = station;
  clone.intersectionId = station;
  clone.name = name;
  clone.rawName = name;
  clone.importedAt = `2026-0${1 + (quarters.indexOf(quarter) % 9)}-01T00:00:00.000Z`;
  /* 逐層往下縮放，nested 的 vehicle 物件也要一起，否則各筆數字會一模一樣。 */
  const scale = (node) => {
    if (!node || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === "number")
        node[key] = Math.round(value * factor * 10) / 10;
      else if (value && typeof value === "object") scale(value);
    }
  };
  for (const route of clone.routes) {
    scale(route.volumes);
    if (route.survey) scale(route.survey);
  }
  for (const approach of clone.approaches) scale(approach.movements);
  if (clone.survey?.vehicle) scale(clone.survey.vehicle);
  return clone;
}

const records = [];
quarters.forEach((quarter, index) => {
  const year = Number(quarter.slice(0, 3));
  const station = year <= 112 ? "T13-04" : year <= 113 ? "T14-04" : "T15-04";
  records.push(
    scaleRecord(template, {
      id: `W-${quarter}`,
      quarter,
      station,
      name: "中山路－國昌路－民強街路口",
      factor: 0.82 + index * 0.03,
    }),
  );
});

// 並存站號：同一路口名稱、同一季，北向與南向各一筆。
for (const quarter of ["114Q1", "114Q2", "114Q3", "114Q4", "115Q1", "115Q2"])
  for (const [station, factor] of [
    ["T15-09N", 1.1],
    ["T15-09S", 0.7],
  ])
    records.push(
      scaleRecord(template, {
        id: `X-${station}-${quarter}`,
        quarter,
        station,
        // 名稱完全相同、站號不同 —— 這才是「同一季並存兩個站」的情境。
        name: "台1－岡山交流道匝道口",
        factor,
      }),
    );

const state = { ...base, records: [...base.records, ...records] };
writeFileSync(
  join(here, "seed-wide.json"),
  JSON.stringify(state),
  "utf8",
);
console.log(
  `seed-wide.json：${state.records.length} 筆，季度 ${quarters[0]}～${quarters.at(-1)}（${quarters.length} 季）`,
);
