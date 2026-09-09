/*
 * ══════════════════════════════════════════════════════════════════
 *  連續存檔的順序（GPT 複查提出的「儲存競態」）
 * ══════════════════════════════════════════════════════════════════
 *
 * GPT 複查 v2.1.60 時列的風險之一是「儲存競態」。實際查下去，這是一個
 * **真的會掉資料**的缺陷，而且畫面上完全看不出來：
 *
 *   saveState() 每一次呼叫都自己 indexedDB.open() 一次，然後才建立交易。
 *   open() 是非同步的，兩次存檔的 open 誰先回來**沒有保證**。
 *   使用者連續改兩次時：
 *     ・第一次存「舊資料」，第二次存「新資料」
 *     ・如果第一次的 open 比第二次晚回來，第一次的 put 就會**後**寫入
 *     ・資料庫裡最後留下的是**舊資料**
 *   重新整理之後，使用者剛剛改的東西不見了，而且沒有任何錯誤訊息。
 *
 * ⚠️ traffic-app.tsx 裡的 saveTokenRef **擋不住這一種**。
 *    那個序號只決定「哪一次的結果可以更新畫面與 toast」，
 *    它不會取消已經送出去的 IndexedDB 寫入。
 *
 * 修法：在 lib/state-storage.ts 內把所有寫入串成一條鏈，前一次寫完才
 * 開始下一次。順序由呼叫順序決定，跟 open() 誰先回來無關。
 *
 * ── 這支測試怎麼證明 ──────────────────────────────────────
 *
 * 用一個假的 indexedDB，讓 open() 的回應時間**故意顛倒**：
 * 第一次呼叫等 40ms，第二次等 0ms。修好之前，第二次會先寫、第一次後寫，
 * 資料庫裡剩下第一次的舊值；修好之後，寫入被串起來，結果一定是新值。
 *
 * ★ 紅字證明（2026-09-09 實跑）：把 saveState 還原成沒有排隊的版本
 *   （直接 withStore("readwrite", …)），這支測試立刻紅：
 *     AssertionError: 最後留在資料庫裡的應該是最後一次存的內容
 *     + actual   - expected
 *     + '第一次（舊）'
 *     - '第三次（新）'
 */
import test from "node:test";
import assert from "node:assert/strict";

type Handler = (() => void) | null;

/** 極簡的假 IndexedDB：只支援這一支用到的 open / transaction / put / get。 */
function installFakeIndexedDB(openDelays: number[], commitDelays: number[] = []) {
  const data = new Map<string, unknown>();
  /** 每一次 put 實際落地的順序，測試要看的就是這個。 */
  const writeOrder: string[] = [];
  let openCount = 0;
  let transactionCount = 0;

  type FakeTransaction = {
    objectStore: () => unknown;
    oncomplete: Handler;
    onerror: Handler;
    onabort: Handler;
    error: unknown;
  };
  const storeFor = function (tx: FakeTransaction, commitDelay: number) {
    const finish = function (work: () => void, request: { onsuccess: Handler }) {
      queueMicrotask(function () {
        work();
        request.onsuccess?.();
        setTimeout(function () {
          tx.oncomplete?.();
        }, commitDelay);
      });
    };
    return {
      put(value: unknown, key: string) {
      const request: { onsuccess: Handler; onerror: Handler; result: unknown; error: unknown } =
        { onsuccess: null, onerror: null, result: undefined, error: null };
      finish(function () {
        data.set(key, value);
        writeOrder.push(String(value));
      }, request);
      return request;
      },
      get(key: string) {
      const request: { onsuccess: Handler; onerror: Handler; result: unknown; error: unknown } =
        { onsuccess: null, onerror: null, result: undefined, error: null };
      finish(function () {
        request.result = data.get(key);
      }, request);
      return request;
      },
      delete(key: string) {
      const request: { onsuccess: Handler; onerror: Handler; result: unknown; error: unknown } =
        { onsuccess: null, onerror: null, result: undefined, error: null };
      finish(function () {
        data.delete(key);
      }, request);
      return request;
      },
    };
  };

  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    transaction: () => {
      const index = transactionCount++;
      const tx: FakeTransaction = {
        objectStore: () => storeFor(tx, commitDelays[index] ?? 0),
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
      };
      return tx;
    },
    close: () => {},
  };

  const factory = {
    open() {
      const index = openCount;
      openCount += 1;
      const request: {
        onsuccess: Handler;
        onerror: Handler;
        onupgradeneeded: Handler;
        onblocked: Handler;
        result: unknown;
        error: unknown;
      } = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
        result: db,
        error: null,
      };
      /*
       * ★ 這裡就是重點：**故意讓先呼叫的後回來**。
       *   真實瀏覽器裡 open() 的完成順序本來就沒有保證，
       *   這只是把「偶爾會發生」變成「一定會發生」，好讓測試穩定。
       */
      setTimeout(function () {
        request.onsuccess?.();
      }, openDelays[index] ?? 0);
      return request;
    },
  };

  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    value: factory,
    configurable: true,
    writable: true,
  });
  /* state-storage 在搬遷路徑會碰 localStorage，給它一個空的就好。 */
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {},
    },
    configurable: true,
    writable: true,
  });

  return {
    data,
    writeOrder,
    restore() {
      if (original) Object.defineProperty(globalThis, "indexedDB", original);
      else delete (globalThis as Record<string, unknown>).indexedDB;
      if (originalLocal)
        Object.defineProperty(globalThis, "localStorage", originalLocal);
      else delete (globalThis as Record<string, unknown>).localStorage;
    },
  };
}

test("連續三次存檔，最後留在資料庫裡的是最後一次的內容（即使 open 的回應順序顛倒）", async function () {
  /* 第一次 open 等 40ms、第二次 20ms、第三次 0ms——完全顛倒。 */
  const fake = installFakeIndexedDB([40, 20, 0]);
  try {
    const { saveState, STATE_KEY } = await import("../lib/state-storage.ts");
    await Promise.all([
      saveState("第一次（舊）"),
      saveState("第二次（中）"),
      saveState("第三次（新）"),
    ]);
    assert.equal(
      fake.data.get(STATE_KEY),
      "第三次（新）",
      "最後留在資料庫裡的應該是最後一次存的內容",
    );
    assert.deepEqual(
      fake.writeOrder,
      ["第一次（舊）", "第二次（中）", "第三次（新）"],
      "寫入順序必須等於呼叫順序，不可以被 open() 的回應時間打亂",
    );
  } finally {
    fake.restore();
  }
});

test("存檔與清除交錯時也照呼叫順序執行", async function () {
  const fake = installFakeIndexedDB([30, 0, 0]);
  try {
    const { saveState, clearState, STATE_KEY } = await import(
      "../lib/state-storage.ts"
    );
    await Promise.all([
      saveState("要被清掉的"),
      clearState(),
      saveState("清掉之後又存的"),
    ]);
    assert.equal(
      fake.data.get(STATE_KEY),
      "清掉之後又存的",
      "清除排在中間時，最後一次存檔仍然要留下來",
    );
  } finally {
    fake.restore();
  }
});

test("saveState 要等 IndexedDB 交易真正完成後才回報成功", async function () {
  const fake = installFakeIndexedDB([0], [40]);
  try {
    const { saveState, STATE_KEY } = await import("../lib/state-storage.ts");
    let resolved = false;
    const saving = saveState("交易完成後才成功").then(function () {
      resolved = true;
    });
    await new Promise(function (resolve) {
      setTimeout(resolve, 5);
    });
    assert.equal(resolved, false, "交易尚未完成時，不可以先向畫面回報存檔成功");
    await saving;
    assert.equal(resolved, true);
    assert.equal(fake.data.get(STATE_KEY), "交易完成後才成功");
  } finally {
    fake.restore();
  }
});
