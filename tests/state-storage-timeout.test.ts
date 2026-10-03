import test from "node:test";
import assert from "node:assert/strict";

type Handler = (() => void) | null;

function installFakeIndexedDB(behaviors: ("hang" | "success")[]) {
  let openCount = 0;
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    close: () => {},
    transaction: () => {
      const tx: {
        oncomplete: Handler;
        onerror: Handler;
        onabort: Handler;
        error: unknown;
        objectStore: () => unknown;
      } = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore: () => ({
          get: () => {
            const request: {
              onsuccess: Handler;
              onerror: Handler;
              result: unknown;
              error: unknown;
            } = { onsuccess: null, onerror: null, result: undefined, error: null };
            queueMicrotask(() => {
              request.onsuccess?.();
              queueMicrotask(() => tx.oncomplete?.());
            });
            return request;
          },
        }),
      };
      return tx;
    },
  };
  const factory = {
    open() {
      const behavior = behaviors[openCount] ?? "hang";
      openCount += 1;
      const request: {
        onsuccess: Handler;
        onerror: Handler;
        onupgradeneeded: Handler;
        onblocked: Handler;
        result: typeof db;
        error: unknown;
      } = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
        result: db,
        error: null,
      };
      if (behavior === "success") queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };

  const originalDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "indexedDB", {
    value: factory,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: () => null, removeItem: () => {} },
    configurable: true,
  });
  return {
    get openCount() {
      return openCount;
    },
    restore() {
      if (originalDb) Object.defineProperty(globalThis, "indexedDB", originalDb);
      else delete (globalThis as Record<string, unknown>).indexedDB;
      if (originalLocal)
        Object.defineProperty(globalThis, "localStorage", originalLocal);
      else delete (globalThis as Record<string, unknown>).localStorage;
    },
  };
}

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test("⚠️ 第一次開啟逾時後會自動再試一次，第二次成功就正常載入", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fake = installFakeIndexedDB(["hang", "success"]);
  try {
    const { loadState } = await import("../lib/state-storage.ts");
    const loading = loadState();
    await flushMicrotasks();
    assert.equal(fake.openCount, 1, "前置：一開始只能有第一次 open");
    t.mock.timers.tick(8000);
    await flushMicrotasks();
    /*
     * ⚠️ 2026-09-29：第一次逾時之後**不可以立刻重試**（RETRY_DELAY_MS = 1500）。
     *   使用者 2026-09-29 在線上遇到逾時，而手動重新整理一次就好了——
     *   立刻重試等於用同一個忙碌瞬間再賭一次，自動重試形同虛設。
     *   不驗這一步的話，把 RETRY_DELAY_MS 改回 0 也不會有人發現。
     */
    /*
     * ⚠️ 只 tick(8000) 之後斷言「還是 1 次」**是恆真的**：假時鐘裡
     *   setTimeout(…, 0) 也不會在同一個 tick 裡跑完。我第一版就是這樣寫的，
     *   把 RETRY_DELAY_MS 改成 0 之後測試照樣綠——那是假的守門。
     *   所以要**再往前推到 1499ms**：延遲是 0 的話這時早就重試了（會紅），
     *   延遲是 1500 的話這時還沒到（維持 1 次），最後 tick(1) 才變 2 次。
     */
    assert.equal(fake.openCount, 1, "前置：8000ms 時還不該重試");
    t.mock.timers.tick(1499);
    await flushMicrotasks();
    assert.equal(
      fake.openCount,
      1,
      "第一次逾時之後太早重試了——中間應該要等滿 RETRY_DELAY_MS",
    );
    t.mock.timers.tick(1);
    await flushMicrotasks();
    assert.equal(fake.openCount, 2, "第一次逾時後沒有真的再呼叫 indexedDB.open");
    assert.deepEqual(await loading, { text: null, source: "empty" });
  } finally {
    fake.restore();
    t.mock.timers.reset();
  }
});

test("⚠️ 兩次都逾時要丟獨立的 StorageTimeoutError，不可冒充權限封鎖", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fake = installFakeIndexedDB(["hang", "hang"]);
  try {
    const { loadState, StorageTimeoutError, StorageBlockedError } = await import(
      "../lib/state-storage.ts"
    );
    const loading = loadState();
    /* 先掛 rejection handler，避免第二次 tick 與 assert.rejects 之間出現未處理拒絕。 */
    void loading.catch(() => {});
    await flushMicrotasks();
    t.mock.timers.tick(8000);
    await flushMicrotasks();
    /* 同上：1499ms 時還不可以重試，1500ms 才可以（見上面那段註解）。 */
    assert.equal(fake.openCount, 1, "前置：8000ms 時還不該重試");
    t.mock.timers.tick(1499);
    await flushMicrotasks();
    assert.equal(fake.openCount, 1, "第一次逾時之後太早重試了");
    t.mock.timers.tick(1);
    await flushMicrotasks();
    assert.equal(fake.openCount, 2);
    t.mock.timers.tick(8000);
    await assert.rejects(loading, (error: unknown) => {
      assert.ok(error instanceof StorageTimeoutError);
      assert.equal(error instanceof StorageBlockedError, false);
      /* 訊息要講「試了兩次」與「中間等了多久」——畫面與這裡的文案 2026-09-29 統一。 */
      assert.match(error.message, /自動試了兩次/);
      assert.match(error.message, /等 1\.5 秒再試一次/);
      return true;
    });
  } finally {
    fake.restore();
    t.mock.timers.reset();
  }
});
