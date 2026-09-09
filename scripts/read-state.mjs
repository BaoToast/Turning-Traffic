/*
 * 端對端腳本共用：把這個網站存在瀏覽器裡的狀態讀出來。
 *
 * v2.1.53 起資料改存 IndexedDB（見 lib/state-storage.ts）。這裡刻意
 * **兩邊都讀**，因為守門測試必須能對「未修正的舊版」跑出紅字，而舊版
 * 是寫在 localStorage 的——只讀 IndexedDB 的話，對舊版會變成
 * 「讀不到資料」而不是「讀到了、但內容不對」，紅字的原因就講不清楚。
 */
/*
 * 給頁面用的讀取器。
 *
 * v2.1.53 之後，端對端腳本裡原本寫 localStorage.getItem("turning-traffic-state-v2")
 * 的地方一律改成 `await window.__readState()`。
 * **這一步不能省**：不改的話那些斷言會讀到空字串，然後
 *   ・「存下來的東西應該長這樣」變成紅字（其實程式是對的），或更糟
 *   ・「不該留下東西」變成恆真的綠字（什麼都讀不到，當然沒有殘留）
 * 後者正是最危險的一種——測試看起來全綠，實際上什麼都沒驗到。
 *
 * 一樣是先看 IndexedDB、再退回 localStorage，這樣同一支腳本也能拿去對
 * 未修正的舊版跑出有意義的紅字。
 */
export const STATE_READER_SCRIPT = `
window.__readState = function () {
  return new Promise(function (resolve) {
    var fallback = function () {
      try {
        resolve(
          localStorage.getItem("turning-traffic-state-v2") ||
            localStorage.getItem("turning-traffic-state-v1") ||
            null,
        );
      } catch (error) {
        resolve(null);
      }
    };
    var request;
    try {
      request = indexedDB.open("turning-traffic", 1);
    } catch (error) {
      fallback();
      return;
    }
    request.onupgradeneeded = function () {
      var db = request.result;
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
    };
    request.onerror = fallback;
    request.onsuccess = function () {
      var db = request.result;
      if (!db.objectStoreNames.contains("state")) {
        db.close();
        fallback();
        return;
      }
      var get = db
        .transaction("state", "readonly")
        .objectStore("state")
        .get("turning-traffic-state-v2");
      get.onerror = function () {
        db.close();
        fallback();
      };
      get.onsuccess = function () {
        db.close();
        if (typeof get.result === "string" && get.result) resolve(get.result);
        else fallback();
      };
    };
  });
};
`;

/*
 * 給頁面用的寫入器。
 *
 * 測試中途「直接改狀態再重新載入」的地方要用它。
 * 這些地方原本寫 localStorage.setItem，改成 IndexedDB 之後如果不改：
 * 程式開機時看到 IndexedDB 已經有東西，就**不會**再去看 localStorage，
 * 那個 patch 等於沒生效，而測試多半會變成綠的（改了跟沒改一樣）。
 *
 * 注意：**第一次載入前的 addInitScript 種子不需要改**——那時 IndexedDB
 * 是空的，程式會走搬遷路徑把它讀進來，順便每一輪都驗到搬遷還能用。
 */
export const STATE_WRITER_SCRIPT = `
window.__writeState = function (text) {
  return new Promise(function (resolve, reject) {
    var request = indexedDB.open("turning-traffic", 1);
    request.onupgradeneeded = function () {
      var db = request.result;
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
    };
    request.onerror = function () {
      reject(request.error || new Error("open failed"));
    };
    request.onsuccess = function () {
      var db = request.result;
      var tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(text, "turning-traffic-state-v2");
      tx.oncomplete = function () {
        db.close();
        resolve(true);
      };
      tx.onerror = function () {
        db.close();
        reject(tx.error || new Error("write failed"));
      };
    };
  });
};
`;

/** 一次裝好讀取器與寫入器。每一支端對端腳本在 goto 之前呼叫。 */
export async function installStateHelpers(page) {
  await page.addInitScript(STATE_READER_SCRIPT);
  await page.addInitScript(STATE_WRITER_SCRIPT);
}

export async function readState(page) {
  const raw = await page.evaluate(async () => {
    const fromIdb = await new Promise((resolve) => {
      let request;
      try {
        request = indexedDB.open("turning-traffic", 1);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
      };
      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("state")) {
          db.close();
          resolve(null);
          return;
        }
        const get = db
          .transaction("state", "readonly")
          .objectStore("state")
          .get("turning-traffic-state-v2");
        get.onerror = () => {
          db.close();
          resolve(null);
        };
        get.onsuccess = () => {
          db.close();
          resolve(typeof get.result === "string" ? get.result : null);
        };
      };
    });
    if (fromIdb) return fromIdb;
    try {
      return (
        localStorage.getItem("turning-traffic-state-v2") ||
        localStorage.getItem("turning-traffic-state-v1") ||
        null
      );
    } catch {
      return null;
    }
  });
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 這一份狀態是存在哪裡的。用來驗「真的搬到 IndexedDB 了」。 */
export async function stateLocation(page) {
  return page.evaluate(async () => {
    const idb = await new Promise((resolve) => {
      let request;
      try {
        request = indexedDB.open("turning-traffic", 1);
      } catch {
        resolve(false);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
      };
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("state")) {
          db.close();
          resolve(false);
          return;
        }
        const get = db
          .transaction("state", "readonly")
          .objectStore("state")
          .get("turning-traffic-state-v2");
        get.onerror = () => {
          db.close();
          resolve(false);
        };
        get.onsuccess = () => {
          db.close();
          resolve(typeof get.result === "string" && get.result.length > 0);
        };
      };
    });
    let local = false;
    let localKeys = [];
    try {
      localKeys = Object.keys(localStorage).filter((key) =>
        key.startsWith("turning-traffic-state"),
      );
      local = localKeys.length > 0;
    } catch {
      local = false;
    }
    return { indexeddb: idb, localStorage: local, localKeys };
  });
}
