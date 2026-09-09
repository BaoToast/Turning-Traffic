/*
 * 支線數與「沒有這個轉向」的算術核對。
 *
 * 這一支釘住的是一句純算術，不是任何調查廠商的編號習慣：
 *
 *     應該不存在的轉向數 ＝ 這支支線印的轉向欄數 − 可以去的地方數
 *                        ＝ 轉向欄數 − （支線數 − 1）
 *
 * 三岔：3 − 2 ＝ 每支剛好 1 個（實測三份真實三岔檔都是這樣）
 * 四岔：3 − 3 ＝ 0 個（實測五份真實四岔檔一個橫線都沒有）
 *
 * ⚠️ 假通過陷阱（這一支刻意迴避的）：
 *  一、只驗三岔會過，不代表四岔不會被誤判——四岔真實檔有 6～9 欄是
 *      **真的整天量到 0**，如果把「全為 0」當成「不存在」就會把它們算進
 *      absent，數量立刻對不上。所以下面一定要有「四岔＋真的量到 0」這一組。
 *  二、只驗 expectedAbsent 的數字對不對太弱：把函式寫成永遠回傳 0 也會讓
 *      四岔那組過。所以三岔那組必須驗到 1，且要驗 absent 抓到的是哪一個轉向。
 *  三、blankExplainedByArithmetic 不可以「只要有空白就給建議」——
 *      數量對不上時給建議等於用猜的裝成有依據，所以要有反例。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  auditArmMovements,
  absentBeyondExpectation,
  blankExplainedByArithmetic,
  type MovementKey,
} from "../lib/traffic.ts";

type Cell = {
  approach: string;
  movement: MovementKey | null;
  numericCells: number;
  placeholderCells: number;
};

/** 一個轉向 ＝ 四個車種欄，跟真實調查表一樣。 */
function movementColumns(
  approach: string,
  movement: MovementKey,
  kind: "numbers" | "dashes" | "blank" | "realzero",
): Cell[] {
  return Array.from({ length: 4 }, () => ({
    approach,
    movement,
    /* 「真的量到 0」在解析層與有車完全一樣：都是填了數字。 */
    numericCells: kind === "numbers" || kind === "realzero" ? 52 : 0,
    placeholderCells: kind === "dashes" ? 52 : 0,
  }));
}

/** 三岔：A 沒有右轉、B 沒有直進、C 沒有左轉（三份真實檔的實際形狀）。 */
function threeArmColumns(): Cell[] {
  return [
    ...movementColumns("A", "left", "numbers"),
    ...movementColumns("A", "through", "numbers"),
    ...movementColumns("A", "right", "dashes"),
    ...movementColumns("B", "left", "numbers"),
    ...movementColumns("B", "through", "dashes"),
    ...movementColumns("B", "right", "numbers"),
    ...movementColumns("C", "left", "dashes"),
    ...movementColumns("C", "through", "numbers"),
    ...movementColumns("C", "right", "numbers"),
  ];
}

/** 四岔：一個橫線都沒有，但有幾個轉向是真的整天量到 0。 */
function fourArmColumns(): Cell[] {
  const arms = ["A", "B", "C", "D"];
  const movements: MovementKey[] = ["left", "through", "right"];
  return arms.flatMap((arm, armIndex) =>
    movements.flatMap((movement, movementIndex) =>
      movementColumns(
        arm,
        movement,
        /* 每一支挑一個轉向當成「真的量到 0」，共 4 個。 */
        armIndex === movementIndex % 4 && movementIndex === 2
          ? "realzero"
          : "numbers",
      ),
    ),
  );
}

test("三岔：每支支線應該剛好缺 1 個轉向，而且抓得出是哪一個", () => {
  const audits = auditArmMovements(threeArmColumns());
  assert.equal(audits.length, 3);
  for (const audit of audits) {
    assert.equal(audit.movementCount, 3, `路口${audit.approach} 的轉向欄數`);
    assert.equal(audit.destinationCount, 2, `路口${audit.approach} 的去向數`);
    assert.equal(audit.expectedAbsent, 1, `路口${audit.approach} 的預期缺口`);
    assert.equal(audit.absent.length, 1, `路口${audit.approach} 的實際缺口`);
  }
  /* 抓到的必須是實際畫橫線的那一個，不是隨便一個。 */
  assert.deepEqual(
    audits.map((audit) => `${audit.approach}/${audit.absent[0]}`),
    ["A/right", "B/through", "C/left"],
  );
});

test("四岔：預期 0 個缺口，而且真的量到 0 的轉向不可以被算成缺口", () => {
  const audits = auditArmMovements(fourArmColumns());
  assert.equal(audits.length, 4);
  for (const audit of audits) {
    assert.equal(audit.destinationCount, 3, `路口${audit.approach} 的去向數`);
    assert.equal(audit.expectedAbsent, 0, `路口${audit.approach} 的預期缺口`);
    assert.deepEqual(
      audit.absent,
      [],
      `路口${audit.approach} 不可以有缺口（真的量到 0 不算缺口）`,
    );
  }
});

test("三岔缺口剛好 1 個時不算超出預期（不可以每季都跳出來煩使用者）", () => {
  for (const audit of auditArmMovements(threeArmColumns()))
    assert.equal(absentBeyondExpectation(audit), false);
});

test("四岔出現橫線就是超出預期，必須讓使用者看見", () => {
  /* 例如禁止左轉或單行道：四岔的 A 支線左轉整欄畫橫線。 */
  const columns = fourArmColumns().map((cell) =>
    cell.approach === "A" && cell.movement === "left"
      ? { ...cell, numericCells: 0, placeholderCells: 52 }
      : cell,
  );
  const audits = auditArmMovements(columns);
  const armA = audits.find((audit) => audit.approach === "A");
  assert.ok(armA);
  assert.deepEqual(armA.absent, ["left"]);
  assert.equal(armA.expectedAbsent, 0);
  assert.equal(absentBeyondExpectation(armA), true);
  /* 其他三支不受影響，不可以順便一起被問。 */
  for (const audit of audits.filter((item) => item.approach !== "A"))
    assert.equal(absentBeyondExpectation(audit), false);
});

test("三岔沒畫橫線、剛好一個轉向整欄空白時，算術指得出就是它", () => {
  /* A 支線該缺 1 個，卻一個橫線都沒畫，而右轉整欄空白。 */
  const columns = threeArmColumns().map((cell) =>
    cell.approach === "A" && cell.movement === "right"
      ? { ...cell, numericCells: 0, placeholderCells: 0 }
      : cell,
  );
  const armA = auditArmMovements(columns).find(
    (audit) => audit.approach === "A",
  );
  assert.ok(armA);
  assert.deepEqual(armA.absent, []);
  assert.deepEqual(armA.blank, ["right"]);
  assert.equal(blankExplainedByArithmetic(armA), true);
});

test("空白的數量對不上時不可以給建議（不能把猜的裝成有依據）", () => {
  /* A 支線該缺 1 個，卻有兩個轉向整欄空白——分不出是哪一個。 */
  const columns = threeArmColumns().map((cell) =>
    cell.approach === "A" &&
    (cell.movement === "right" || cell.movement === "through")
      ? { ...cell, numericCells: 0, placeholderCells: 0 }
      : cell,
  );
  const armA = auditArmMovements(columns).find(
    (audit) => audit.approach === "A",
  );
  assert.ok(armA);
  assert.equal(armA.blank.length, 2);
  assert.equal(blankExplainedByArithmetic(armA), false);
});

test("已經畫滿預期數量的橫線時，多出來的空白不給「不存在」的建議", () => {
  /* A 支線已經有 1 個橫線（右轉），直進又整欄空白：缺口已經滿了。 */
  const columns = threeArmColumns().map((cell) =>
    cell.approach === "A" && cell.movement === "through"
      ? { ...cell, numericCells: 0, placeholderCells: 0 }
      : cell,
  );
  const armA = auditArmMovements(columns).find(
    (audit) => audit.approach === "A",
  );
  assert.ok(armA);
  assert.deepEqual(armA.absent, ["right"]);
  assert.deepEqual(armA.blank, ["through"]);
  assert.equal(blankExplainedByArithmetic(armA), false);
});
