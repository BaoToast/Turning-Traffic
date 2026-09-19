/*
 * ══════════════════════════════════════════════════════════════════════
 *  各支線「各自認定自己的尖峰」——黃金值是手算出來的
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 指定主工具列要有「尖峰時段判定方式」。
 * 兩種算法的數字本來就不同，所以這一支要驗的是**數字本身**，
 * 不是「有沒有回傳東西」。
 *
 * ⚠️ 測資刻意做成「A 支線早上忙、B 支線傍晚忙」。
 *   兩支剛好同一小時的話，兩種判定方式算出來會一樣，
 *   這一支就永遠是綠的——那是一支不守任何東西的測試。
 *
 * ⚠️ 期望值**手算**寫在下面，不是把程式跑一次的輸出貼回來。
 *   貼輸出等於「程式現在算什麼就是對的」，改壞了照樣全綠。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  approachPeakBreakdown,
  recordWithApproachPeaks,
  recordWithMovementFilter,
  recordWithVehicleFilter,
  canSplitByVehicle,
  peakWindowsFor,
  pceFactor,
} from "../lib/traffic.ts";

/* 只有兩個車種、兩支支線，手算得動。 */
const PCE = {
  motorcycle: { left: 0.5, through: 0.3, right: 0.4 },
  car: { left: 1.5, through: 1, right: 1.3 },
  heavy: { left: 2.3, through: 1.5, right: 2 },
  special: { left: 2.5, through: 2, right: 2.3 },
};

/*
 * 欄位：A直行機車、A直行小型車、B直行機車、B直行小型車
 * 時間：07:00 起，每 15 分鐘一格，共 12 格（07:00～10:00）
 *       另外 17:00 起 8 格（17:00～19:00）
 *
 * A 支線：早上那一段每格 10／10，傍晚每格 1／1
 * B 支線：早上每格 1／1，傍晚每格 20／20
 * → A 自己的尖峰在早上，B 自己的尖峰在傍晚。
 */
const columns = [
  { approach: "A", vehicle: "motorcycle", movement: "through" },
  { approach: "A", vehicle: "car", movement: "through" },
  { approach: "B", vehicle: "motorcycle", movement: "through" },
  { approach: "B", vehicle: "car", movement: "through" },
];
const rows = [];
for (let i = 0; i < 12; i += 1)
  rows.push({
    start: 7 * 60 + i * 15,
    label: `am-${i}`,
    values: [10, 10, 1, 1],
  });
for (let i = 0; i < 8; i += 1)
  rows.push({
    start: 17 * 60 + i * 15,
    label: `pm-${i}`,
    values: [1, 1, 20, 20],
  });
const source = { intervalMinutes: 15, columns, rows };

test("前置：測資真的讓兩支支線的尖峰錯開（否則整支恆真）", () => {
  const am = approachPeakBreakdown(source, PCE, "AM");
  const pm = approachPeakBreakdown(source, PCE, "PM");
  assert.ok(am.A.window, "A 在上午挑得到視窗");
  assert.ok(pm.B.window, "B 在下午挑得到視窗");
  /* A 上午的量遠大於 B 上午的量，反之亦然——這才叫錯開。 */
  assert.ok(am.A.vehicles > am.B.vehicles * 5);
  assert.ok(pm.B.vehicles > pm.A.vehicles * 5);
});

test("A 支線在自己的上午尖峰小時：手算 80 輛、PCU 52.0", () => {
  /*
   * 手算：上午每一格 A 是機車 10 ＋ 小型車 10。
   *   一小時 ＝ 4 格 → 機車 40、小型車 40，合計 80 輛。
   *   PCU ＝ 40 × 0.3（機車直行）＋ 40 × 1（小型車直行）
   *       ＝ 12 ＋ 40 ＝ 52.0
   */
  const result = approachPeakBreakdown(source, PCE, "AM").A;
  assert.equal(result.vehicles, 80);
  assert.equal(result.pcu, 52);
  assert.deepEqual(
    result.cells.map((cell) => [cell.vehicle, cell.count]),
    [
      ["motorcycle", 40],
      ["car", 40],
    ],
  );
});

test("B 支線在自己的下午尖峰小時：手算 160 輛、PCU 104.0", () => {
  /*
   * 手算：下午每一格 B 是機車 20 ＋ 小型車 20，一小時 4 格
   *   → 機車 80、小型車 80，合計 160 輛。
   *   PCU ＝ 80 × 0.3 ＋ 80 × 1 ＝ 24 ＋ 80 ＝ 104.0
   */
  const result = approachPeakBreakdown(source, PCE, "PM").B;
  assert.equal(result.vehicles, 160);
  assert.equal(result.pcu, 104);
});

test("兩種判定方式挑到同一小時時，數字必須一致（否則是算法本身有分岔）", () => {
  /*
   * 上午每一格全路口的組成都一樣，所以「整個路口同一時段」與
   * 「B 自己認定」會挑到同一小時 07:00–08:00。
   * 既然是同一小時，B 的量就必須相同（4 格 × (1＋1) ＝ 8 輛）。
   * ⚠️ 這一條守的是「差異只能來自視窗不同」，不能來自加總方式不同。
   */
  const point = peakWindowsFor(
    rows,
    15,
    columns.map((column) => pceFactor(PCE, column.vehicle, column.movement)),
    rows.length * 15,
  );
  const byArm = approachPeakBreakdown(source, PCE, "AM");
  assert.ok(point.AM, "前置：整路口的上午視窗算得出來");
  assert.equal(byArm.B.window.start, point.AM.start);
  assert.equal(byArm.B.vehicles, 8);
});

test("**視窗真的不同時，數字要跟著不同**——這才是讓使用者選的理由", () => {
  /*
   * 造一份上午前後半段主角不同的資料：
   *   07:00–08:00  A 每格 100，B 每格 1
   *   08:00–09:00  A 每格 1，  B 每格 50
   *
   * 手算「整個路口同一時段」：
   *   07 點那一小時全路口 ＝ (100＋1) × 4 ＝ 404 輛，
   *   08 點那一小時 ＝ (1＋50) × 4 ＝ 204 輛 → 挑 07:00–08:00。
   *   B 在那一小時只有 1 × 4 ＝ 4 輛。
   *
   * 手算「B 自己認定」：
   *   B 在 07 點那一小時 4 輛、08 點那一小時 200 輛 → 挑 08:00–09:00，200 輛。
   *
   * 4 對 200——差 50 倍。這就是為什麼兩種算法不能混著用，
   * 也是為什麼顯示的時候一定要寫明用的是哪一種。
   */
  const splitColumns = [
    { approach: "A", vehicle: "car", movement: "through" },
    { approach: "B", vehicle: "car", movement: "through" },
  ];
  const splitRows = [];
  for (let i = 0; i < 4; i += 1)
    splitRows.push({ start: 7 * 60 + i * 15, label: `a${i}`, values: [100, 1] });
  for (let i = 0; i < 4; i += 1)
    splitRows.push({ start: 8 * 60 + i * 15, label: `b${i}`, values: [1, 50] });
  const splitSource = { intervalMinutes: 15, columns: splitColumns, rows: splitRows };

  const point = peakWindowsFor(
    splitRows,
    15,
    splitColumns.map((column) => pceFactor(PCE, column.vehicle, column.movement)),
    splitRows.length * 15,
  );
  assert.equal(point.AM.start, 7 * 60, "整個路口挑到 07:00");
  /* 整路口視窗下 B 的量：第 2 欄在那一小時的合計。 */
  assert.equal(point.AM.values[1], 4);

  const byArm = approachPeakBreakdown(splitSource, PCE, "AM");
  assert.equal(byArm.B.window.start, 8 * 60, "B 自己挑到 08:00");
  assert.equal(byArm.B.vehicles, 200);
  assert.notEqual(byArm.B.vehicles, point.AM.values[1]);

  /* A 兩種方式都挑 07:00，所以 A 的數字一致——差異只出現在該出現的地方。 */
  assert.equal(byArm.A.window.start, 7 * 60);
  assert.equal(byArm.A.vehicles, 400);
  assert.equal(point.AM.values[0], 400);
});

test("資料格距組不成整小時時回 null，**不可以回 0**", () => {
  /*
   * ⚠️ 45 分鐘的格距組不成 60 分鐘。回 0 的話畫面會顯示「0 輛」，
   *   而 0 會被當成「真的沒有車」抄進報告——比顯示「算不出來」危險得多。
   */
  const odd = {
    intervalMinutes: 45,
    columns,
    rows: rows.map((row, index) => ({ ...row, start: 7 * 60 + index * 45 })),
  };
  const result = approachPeakBreakdown(odd, PCE, "AM");
  assert.equal(result.A.window, null);
  assert.equal(result.A.pcu, 0);
  assert.equal(result.A.cells.length, 0, "算不出來時不可以編出格子");
});

test("別支線的欄位不可以混進來（權重給 0，不是把欄位拿掉）", () => {
  /*
   * ⚠️ 把別支線的欄位「刪掉」會讓索引位移，best.values 就對不回原本的欄，
   *   算出來的數字會安靜地張冠李戴。這一條釘住 A 的格子只含 A 的欄。
   */
  const result = approachPeakBreakdown(source, PCE, "AM").A;
  assert.equal(result.cells.length, 2);
  assert.ok(result.cells.every((cell) => cell.count === 40));
});

/* ══════════════════════════════════════════════════════════════════════
 *  recordWithApproachPeaks：把整筆紀錄改成「各支線自己認定」的版本
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 造一筆最小的紀錄：兩支支線 A、B，各一條直行流向（A→B、B→A）。
 * 逐格資料沿用上面「A 早上忙、B 傍晚忙」那一份。
 */
function makeRecord() {
  return {
    id: "R-test",
    projectId: "P",
    intersectionId: "S1",
    station: "S1",
    name: "測試路口",
    quarter: "115Q1",
    surveyType: "平日",
    pceUsed: PCE,
    approaches: [
      { id: "a1", sourceCode: "A", name: "路口A", angle: 0, movements: {} },
      { id: "a2", sourceCode: "B", name: "路口B", angle: 180, movements: {} },
    ],
    routes: [
      {
        id: "r1",
        fromApproachId: "a1",
        toApproachId: "a2",
        movement: "through",
        volumes: {
          AM: { pcu: 999, vehicle: { car: 999 } },
          PM: { pcu: 999, vehicle: { car: 999 } },
          DAY: { pcu: 999, vehicle: { car: 999 } },
          FULL: { pcu: 999, vehicle: { car: 999 } },
        },
      },
      {
        id: "r2",
        fromApproachId: "a2",
        toApproachId: "a1",
        movement: "through",
        volumes: {
          AM: { pcu: 999, vehicle: { car: 999 } },
          PM: { pcu: 999, vehicle: { car: 999 } },
          DAY: { pcu: 999, vehicle: { car: 999 } },
          FULL: { pcu: 999, vehicle: { car: 999 } },
        },
      },
    ],
    sourceIntervals: { intervalMinutes: 15, columns, rows },
  };
}

test("改寫後 A 的上午流向 ＝ 手算的 80 輛／52.0 PCU，B 是它自己上午的 8 輛", () => {
  const result = recordWithApproachPeaks(makeRecord(), "AM");
  assert.ok(result, "有 sourceIntervals 就該算得出來");
  const [routeA, routeB] = result.record.routes;
  assert.deepEqual(routeA.volumes.AM.vehicle, { motorcycle: 40, car: 40 });
  assert.equal(routeA.volumes.AM.pcu, 52);
  /* B 上午每格 1＋1，自己的上午尖峰一小時 ＝ 機車 4、小型車 4。 */
  assert.deepEqual(routeB.volumes.AM.vehicle, { motorcycle: 4, car: 4 });
  assert.equal(routeB.volumes.AM.pcu, 5.2); // 4×0.3 + 4×1 = 5.2
});

test("⚠️ 原始紀錄一個欄位都不可以被改到（切回去要回得來）", () => {
  const original = makeRecord();
  const before = JSON.stringify(original);
  recordWithApproachPeaks(original, "AM");
  assert.equal(
    JSON.stringify(original),
    before,
    "就地改的話，使用者把判定方式切回去時數字回不來，而且會被存進本機資料",
  );
});

test("沒有 sourceIntervals 時回 null，**不是回一份全 0 的紀錄**", () => {
  const record = makeRecord();
  delete record.sourceIntervals;
  assert.equal(recordWithApproachPeaks(record, "AM"), null);
});

test("FULL（全調查時段）沒有尖峰視窗可挑，回 null", () => {
  assert.equal(recordWithApproachPeaks(makeRecord(), "FULL"), null);
});

test("下午：A 只剩自己的下午量，B 是它自己的下午尖峰", () => {
  /*
   * 手算：下午 A 每格 1＋1 → 一小時 機車 4、小型車 4 → PCU 4×0.3+4×1 = 5.2
   *       下午 B 每格 20＋20 → 一小時 機車 80、小型車 80 → PCU 24+80 = 104
   */
  const result = recordWithApproachPeaks(makeRecord(), "PM");
  const [routeA, routeB] = result.record.routes;
  assert.deepEqual(routeA.volumes.PM.vehicle, { motorcycle: 4, car: 4 });
  assert.equal(routeA.volumes.PM.pcu, 5.2);
  assert.deepEqual(routeB.volumes.PM.vehicle, { motorcycle: 80, car: 80 });
  assert.equal(routeB.volumes.PM.pcu, 104);
});

test("沒被改寫的時段（這裡是 DAY／FULL）維持原值，不可以被順手清掉", () => {
  const result = recordWithApproachPeaks(makeRecord(), "AM");
  const [routeA] = result.record.routes;
  assert.equal(routeA.volumes.FULL.pcu, 999, "FULL 不該被動到");
  assert.equal(routeA.volumes.PM.pcu, 999, "只改了 AM，PM 不該被動到");
});

/* ══════════════════════════════════════════════════════════════════════
 *  轉向別篩選
 * ══════════════════════════════════════════════════════════════════════ */

test("只看左轉時，非左轉的流向要歸零——而且**四個統計範圍都要歸零**", () => {
  const record = makeRecord();
  record.routes[0].movement = "left";
  record.routes[1].movement = "right";
  const filtered = recordWithMovementFilter(record, "left");
  assert.equal(filtered.routes[0].volumes.AM.pcu, 999, "左轉那條原封不動");
  for (const key of ["AM", "PM", "DAY", "FULL"]) {
    assert.equal(filtered.routes[1].volumes[key].pcu, 0, `${key} 要歸零`);
    assert.deepEqual(filtered.routes[1].volumes[key].vehicle, {});
  }
});

test("⚠️ 不可以把流向**刪掉**——表格結構會跟著變形", () => {
  const record = makeRecord();
  record.routes[0].movement = "left";
  record.routes[1].movement = "right";
  const filtered = recordWithMovementFilter(record, "left");
  assert.equal(
    filtered.routes.length,
    2,
    "刪掉的話，用支線找流向的地方會少掉整條，使用者看不出是被篩掉還是沒有資料",
  );
});

test("movement 為 all 時回傳**原物件**（不是複製品），既有 memo 才不會失效", () => {
  const record = makeRecord();
  assert.equal(recordWithMovementFilter(record, "all"), record);
});

test("原始紀錄不可以被改到", () => {
  const record = makeRecord();
  record.routes[1].movement = "right";
  const before = JSON.stringify(record);
  recordWithMovementFilter(record, "left");
  assert.equal(JSON.stringify(record), before);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ 轉向別篩選必須**同時**篩到 approach.movements
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-14 實測抓到的算錯：第一版只歸零 route.volumes，
 * 而 recordTotal()／totalMovement() 讀的是 approach.movements。
 * 於是「只看左轉」時同一個畫面上：
 *   逐條流向的表 ＝ 1,573.4（左轉）
 *   「路口總量」  ＝ 5,413.1（全部轉向，根本沒被篩到）
 * 兩個數字並排，都沒有任何標示。
 *
 * 下面這一組的期望值是**手算**的，不是把程式跑一次貼回來。
 */
function makeRecordWithMovements() {
  const record = makeRecord();
  /* a1 出去兩條：左轉 120（機車 100／小型車 20）、直行 80（小型車 80）。 */
  record.routes = [
    {
      id: "r1",
      fromApproachId: "a1",
      toApproachId: "a2",
      movement: "left",
      volumes: {
        AM: { pcu: 120, vehicle: { motorcycle: 100, car: 20 } },
        PM: { pcu: 120, vehicle: { motorcycle: 100, car: 20 } },
        DAY: { pcu: 120, vehicle: { motorcycle: 100, car: 20 } },
        FULL: { pcu: 120, vehicle: { motorcycle: 100, car: 20 } },
      },
    },
    {
      id: "r2",
      fromApproachId: "a1",
      toApproachId: "a2",
      movement: "through",
      volumes: {
        AM: { pcu: 80, vehicle: { car: 80 } },
        PM: { pcu: 80, vehicle: { car: 80 } },
        DAY: { pcu: 80, vehicle: { car: 80 } },
        FULL: { pcu: 80, vehicle: { car: 80 } },
      },
    },
  ];
  const row = () => ({
    left: 120,
    through: 80,
    right: 0,
    vehicle: { motorcycle: 100, car: 100 },
  });
  record.approaches[0].movements = {
    AM: row(),
    PM: row(),
    DAY: row(),
    FULL: row(),
  };
  record.approaches[1].movements = {
    AM: { left: 0, through: 0, right: 0, vehicle: {} },
    PM: { left: 0, through: 0, right: 0, vehicle: {} },
    DAY: { left: 0, through: 0, right: 0, vehicle: {} },
    FULL: { left: 0, through: 0, right: 0, vehicle: {} },
  };
  return record;
}

test("只看左轉：支線的直行／右轉 PCU 要歸零（手算 120／0／0）", () => {
  const filtered = recordWithMovementFilter(makeRecordWithMovements(), "left");
  for (const key of ["AM", "PM", "DAY", "FULL"]) {
    const row = filtered.approaches[0].movements[key];
    assert.equal(row.left, 120, `${key} 左轉要留著`);
    assert.equal(row.through, 0, `${key} 直行要歸零`);
    assert.equal(row.right, 0, `${key} 右轉要歸零`);
  }
});

test("只看左轉：逐車種輛數要重建成**只有左轉那一條**（手算 機車100／小型車20）", () => {
  const filtered = recordWithMovementFilter(makeRecordWithMovements(), "left");
  assert.deepEqual(filtered.approaches[0].movements.AM.vehicle, {
    motorcycle: 100,
    car: 20,
  });
});

test("只看直行：手算 0／80／0，車輛數只剩小型車 80", () => {
  const filtered = recordWithMovementFilter(
    makeRecordWithMovements(),
    "through",
  );
  const row = filtered.approaches[0].movements.AM;
  assert.equal(row.left, 0);
  assert.equal(row.through, 80);
  assert.deepEqual(row.vehicle, { car: 80 });
});

test("沒有任何流向符合時，整支歸零——不可以留著沒篩過的值", () => {
  const filtered = recordWithMovementFilter(makeRecordWithMovements(), "right");
  const row = filtered.approaches[0].movements.AM;
  assert.equal(row.left, 0);
  assert.equal(row.through, 0);
  assert.equal(row.right, 0);
  assert.deepEqual(row.vehicle, {});
});


/* ══════════════════════════════════════════════════════════════════════
 *  車種篩選
 * ══════════════════════════════════════════════════════════════════════
 *
 * 期望值**手算**：
 *   左轉那一條：機車 100、小型車 20
 *   直行那一條：小型車 80
 *   PCE：機車左轉 0.5、小型車左轉 1.5、小型車直行 1
 *
 *   只看機車 → 左轉 PCU ＝ 100 × 0.5 ＝ 50.0，直行 ＝ 0
 *   只看小型車 → 左轉 PCU ＝ 20 × 1.5 ＝ 30.0，直行 ＝ 80 × 1 ＝ 80.0
 */
test("只看機車：手算左轉 50.0 PCU、直行 0，車輛數只剩機車 100", () => {
  const filtered = recordWithVehicleFilter(
    makeRecordWithMovements(),
    "motorcycle",
  );
  const row = filtered.approaches[0].movements.AM;
  assert.equal(row.left, 50);
  assert.equal(row.through, 0);
  assert.deepEqual(row.vehicle, { motorcycle: 100 });
});

test("只看小型車：手算左轉 30.0、直行 80.0，車輛數 100（20＋80）", () => {
  const filtered = recordWithVehicleFilter(makeRecordWithMovements(), "car");
  const row = filtered.approaches[0].movements.AM;
  assert.equal(row.left, 30);
  assert.equal(row.through, 80);
  assert.deepEqual(row.vehicle, { car: 100 });
});

test("**四個統計範圍都要篩**——只篩目前看的那一個，換個時段就冒出沒篩過的數字", () => {
  const filtered = recordWithVehicleFilter(
    makeRecordWithMovements(),
    "motorcycle",
  );
  for (const key of ["AM", "PM", "DAY", "FULL"])
    assert.equal(filtered.approaches[0].movements[key].through, 0, key);
});

test("vehicle 為 all 時回傳**原物件**（不是複製品）", () => {
  const record = makeRecordWithMovements();
  assert.equal(recordWithVehicleFilter(record, "all"), record);
});

test("原始紀錄不可以被改到（車種篩選）", () => {
  const record = makeRecordWithMovements();
  const before = JSON.stringify(record);
  recordWithVehicleFilter(record, "motorcycle");
  assert.equal(JSON.stringify(record), before);
});

test("沒有逐條流向的舊紀錄：拆不開就**原封不動回傳**，並且說得出來", () => {
  /*
   * ⚠️ 這一條守的是「不可以偷偷用沒篩過的數字冒充篩過的」。
   *   沒有 routes 就對不起車種與轉向，任何拆法都是猜的；
   *   呼叫端要靠 canSplitByVehicle() 在畫面上講出來。
   */
  const record = makeRecordWithMovements();
  record.routes = [];
  assert.equal(canSplitByVehicle(record), false);
  assert.equal(recordWithVehicleFilter(record, "motorcycle"), record);
});
