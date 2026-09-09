/*
 * 本機儲存層：路口轉向的資料從 localStorage 搬到 IndexedDB。
 *
 * 為什麼要搬（都是實測數字，不是估計）：
 *  ・localStorage 每個網站的硬上限實測是 4.94 MB，而且是**整個網站共用**。
 *  ・路口轉向是三支裡唯一把全部資料都放在 localStorage 的
 *    （全日交通量只放當量設定、交通服務水準完全不放）。
 *  ・單一個路口的快照實測平均 14.2 KB、最大 38.7 KB（七叉路口那一份），
 *    再加上還原點，一季的資料就可能把 4.94 MB 用掉。使用者實際回報的
 *    「儲存空間快滿」就是這樣來的。
 *  ・對照組：全日交通量使用者自己的備份檔裡，還原點佔了整份 67.1 MB 的
 *    94%（10 個還原點 62.8 MB，單一個最大 9.11 MB），它完全不會滿——
 *    差別只在於它存在 IndexedDB。
 *
 * 刻意**不**保留 localStorage 當備援（使用者定案）：兩邊都寫就會有
 * 「哪一份才是最新」的問題，那種不同步的錯最難查，也最容易讓使用者
 * 拿到舊資料還以為是新的。搬完就只用 IndexedDB，保險靠匯出備份。
 *
 * 舊資料怎麼辦：第一次啟動時若 IndexedDB 是空的、而 localStorage 有東西，
 * 就搬過去；**寫入後一定重新讀回來比對字串完全相同，才會刪掉 localStorage**。
 * 比對不過就保留 localStorage 原封不動，寧可下次再搬一次。
 */

export const DB_NAME = "turning-traffic";
export const DB_VERSION = 1;
export const STORE_NAME = "state";
export const STATE_KEY = "turning-traffic-state-v2";
/** 舊版 localStorage 鍵值，只在搬遷時讀取。新的一律不寫回去。 */
export const LEGACY_KEYS = [
  "turning-traffic-state-v2",
  "turning-traffic-state-v1",
];

/**
 * 儲存空間被瀏覽器封鎖時丟這個。
 *
 * 要跟「資料格式壞掉」分得開：格式壞掉時原始資料還完整躺在瀏覽器裡，
 * 可以叫使用者下載出來；被封鎖時根本沒有資料可下載，畫面上不能出現
 * 下載鈕，也不能沿用「原始資料仍然完整保留」那句話。
 */
export class StorageBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageBlockedError";
  }
}

/*
 * open() 有可能既不 success 也不 error：另一個分頁held 著舊版資料庫時會
 * 觸發 blocked，然後就這樣停著。停著等於畫面永遠卡在載入中，比報錯更糟，
 * 所以加逾時。
 */
const OPEN_TIMEOUT_MS = 8000;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise(function (resolve, reject) {
    let factory: IDBFactory | undefined;
    try {
      /* 封鎖設定下連讀這個屬性都可能拋 SecurityError。 */
      factory = globalThis.indexedDB;
    } catch (error) {
      reject(
        new StorageBlockedError(
          error instanceof Error
            ? "瀏覽器不允許這個網站使用本機儲存空間（" + error.message + "）"
            : "瀏覽器不允許這個網站使用本機儲存空間",
        ),
      );
      return;
    }
    if (!factory) {
      reject(
        new StorageBlockedError("這個瀏覽器沒有可用的本機儲存空間（IndexedDB）"),
      );
      return;
    }
    let settled = false;
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(
        new StorageBlockedError(
          "開啟本機資料庫逾時；如果同一個網站還有別的分頁開著，請先關掉再重新載入",
        ),
      );
    }, OPEN_TIMEOUT_MS);
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch (error) {
      clearTimeout(timer);
      settled = true;
      reject(
        new StorageBlockedError(
          error instanceof Error
            ? "瀏覽器不允許這個網站使用本機儲存空間（" + error.message + "）"
            : "瀏覽器不允許這個網站使用本機儲存空間",
        ),
      );
      return;
    }
    request.onupgradeneeded = function () {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = function () {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = function () {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new StorageBlockedError(
          "瀏覽器不允許這個網站使用本機儲存空間（" +
            (request.error?.message || "IndexedDB 已被停用") +
            "）",
        ),
      );
    };
    request.onblocked = function () {
      /* 交給逾時處理，訊息裡已經寫了該怎麼辦。 */
    };
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(function (db) {
    return new Promise<T>(function (resolve, reject) {
      let request: IDBRequest<T>;
      let requestDone = false;
      let requestResult: T;
      let settled = false;
      const fail = function (error: unknown) {
        if (settled) return;
        settled = true;
        reject(error);
      };
      try {
        const tx = db.transaction(STORE_NAME, mode);
        request = run(tx.objectStore(STORE_NAME));
        tx.oncomplete = function () {
          if (settled) return;
          if (!requestDone) {
            fail(new Error("儲存交易已完成，但操作結果尚未回報"));
            return;
          }
          settled = true;
          resolve(requestResult);
        };
        tx.onerror = function () {
          fail(tx.error || new Error("儲存交易失敗"));
        };
        tx.onabort = function () {
          fail(tx.error || new Error("儲存交易被中止"));
        };
      } catch (error) {
        db.close();
        fail(error);
        return;
      }
      request.onsuccess = function () {
        requestResult = request.result;
        requestDone = true;
      };
      request.onerror = function () {
        fail(request.error || new Error("儲存操作失敗"));
      };
    }).finally(function () {
      db.close();
    });
  });
}

function readLegacyText(): string | null {
  try {
    for (const key of LEGACY_KEYS) {
      const value = localStorage.getItem(key);
      if (value) return value;
    }
  } catch {
    /*
     * localStorage 讀不到不算失敗：我們已經不靠它了。
     * 真正的封鎖會在 IndexedDB 那一關被抓到並丟 StorageBlockedError。
     */
  }
  return null;
}

function dropLegacy() {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    /* 刪不掉就算了，反正不會再讀它。 */
  }
}

export type LoadResult = {
  text: string | null;
  /** 這一份是從哪裡讀到的，畫面要據此決定要不要說「已搬家」。 */
  source: "indexeddb" | "migrated" | "empty";
};

/**
 * 讀取狀態，必要時把 localStorage 的舊資料搬進 IndexedDB。
 *
 * 儲存空間被封鎖時丟 StorageBlockedError。
 */
export async function loadState(): Promise<LoadResult> {
  const stored = await withStore<string | undefined>("readonly", function (
    store,
  ) {
    return store.get(STATE_KEY) as IDBRequest<string | undefined>;
  });
  if (typeof stored === "string" && stored) {
    /*
     * IndexedDB 已經有資料了，就不要再看 localStorage。
     * 舊鍵值如果還在（上次搬遷時比對失敗而保留），這時可以安心清掉。
     */
    dropLegacy();
    return { text: stored, source: "indexeddb" };
  }
  const legacy = readLegacyText();
  if (!legacy) return { text: null, source: "empty" };
  /* 搬遷的寫入也要排進同一條鏈，否則它可能和啟動後的第一次存檔互相蓋掉。 */
  await enqueueWrite(function () {
    return withStore("readwrite", function (store) {
      return store.put(legacy, STATE_KEY);
    });
  });
  /*
   * 一定要讀回來逐字比對再刪舊的。
   * 「寫入沒有丟例外」不等於「寫進去了」——這是這次搬遷唯一不能省的一步，
   * 比對不過就把 localStorage 原封不動留著，下次啟動再搬一次。
   */
  const verify = await withStore<string | undefined>("readonly", function (
    store,
  ) {
    return store.get(STATE_KEY) as IDBRequest<string | undefined>;
  });
  if (verify === legacy) dropLegacy();
  return { text: legacy, source: "migrated" };
}

/**
 * 純讀取，不搬遷、不刪除任何東西。
 *
 * 「無法讀取這台電腦上的資料」那個搶救畫面用。那時資料的格式已經有問題，
 * 這一步只負責原封不動把它拿出來讓使用者存成檔案，絕不可以順手做搬遷
 * 或清理——搶救畫面上做的任何寫入動作都可能把要救的東西弄壞。
 */
export async function readRawState(): Promise<string> {
  try {
    const stored = await withStore<string | undefined>("readonly", function (
      store,
    ) {
      return store.get(STATE_KEY) as IDBRequest<string | undefined>;
    });
    if (typeof stored === "string" && stored) return stored;
  } catch {
    /* 讀不到就退回去看 localStorage，還有沒搬完的舊資料 */
  }
  return readLegacyText() || "";
}

/*
 * ── 所有寫入排成一條鏈（GPT 複查提出的「儲存競態」）──────────────
 *
 * 這是一個**真的會掉資料**、而且畫面上完全看不出來的缺陷。
 *
 * withStore() 每次都自己 openDatabase() 一次，而 open() 是非同步的，
 * 兩次寫入誰的 open 先回來**沒有保證**。使用者連續改兩次時：
 *   ・第一次存「舊資料」、第二次存「新資料」
 *   ・第一次的 open 若比第二次晚回來，第一次的 put 就會**後**落地
 *   ・資料庫裡最後留下的是**舊資料**
 * 重新整理之後，剛剛改的東西不見了，沒有錯誤訊息、沒有任何徵兆。
 *
 * ⚠️ traffic-app.tsx 的 saveTokenRef 擋不住這一種：那個序號只決定
 *    「哪一次的結果可以更新畫面與 toast」，不會取消已經送出去的寫入。
 *
 * 修法就是這條鏈：前一次寫完才開始下一次，順序由**呼叫順序**決定，
 * 與 open() 的回應時間無關。
 *
 * 為什麼不「跳過被後來者取代的那一次」（只寫最後一次）：
 * 那樣先呼叫的那一次會拿到「成功」卻其實沒寫，而如果最後那一次因為
 * 配額不足失敗，就變成兩次都沒進去。寧可多寫一次。
 *
 * 讀取不排隊：讀只發生在啟動與搶救畫面，而且讀到舊值不會造成資料遺失。
 *
 * 由 tests/state-storage-race.test.ts 釘住（把這條鏈拿掉即紅）。
 */
let writeChain: Promise<void> = Promise.resolve();

function enqueueWrite(run: () => Promise<unknown>): Promise<void> {
  /* 前一次失敗也要繼續排下一次，所以成功與失敗都接上同一個 run。 */
  const next = writeChain.then(
    function () {
      return run().then(function () {});
    },
    function () {
      return run().then(function () {});
    },
  );
  writeChain = next.then(
    function () {},
    function () {},
  );
  return next;
}

/** 寫入狀態。儲存空間被封鎖或寫不進去時丟例外，由呼叫端決定怎麼降級。 */
export function saveState(text: string): Promise<void> {
  return enqueueWrite(function () {
    return withStore("readwrite", function (store) {
      return store.put(text, STATE_KEY);
    });
  });
}

/** 清空這個網站在本機留下的全部資料（「全部清除」按鈕用）。 */
export function clearState(): Promise<void> {
  return enqueueWrite(function () {
    return withStore("readwrite", function (store) {
      return store.delete(STATE_KEY);
    });
  }).then(function () {
    dropLegacy();
  });
}
