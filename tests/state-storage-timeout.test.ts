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
    assert.equal(fake.openCount, 2);
    t.mock.timers.tick(8000);
    await assert.rejects(loading, (error: unknown) => {
      assert.ok(error instanceof StorageTimeoutError);
      assert.equal(error instanceof StorageBlockedError, false);
      assert.match(error.message, /自動重試一次/);
      return true;
    });
  } finally {
    fake.restore();
    t.mock.timers.reset();
  }
});
