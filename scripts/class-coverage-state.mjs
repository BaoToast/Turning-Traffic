/** 空狀態守門：搬遷完成後 localStorage 已刪除，必須同時查正式 IndexedDB。 */
export async function inspectEmptyState(page) {
  return page.evaluate(async () => {
    const persisted = await new Promise((resolve, reject) => {
      const request = indexedDB.open('turning-traffic', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('state')) { db.close(); reject(new Error('Missing state store')); return; }
        const tx = db.transaction('state', 'readonly');
        const get = tx.objectStore('state').get('turning-traffic-state-v2');
        get.onerror = () => { db.close(); reject(get.error); };
        get.onsuccess = () => {
          try { resolve(get.result == null ? null : JSON.parse(get.result)); }
          catch (error) { reject(error); }
          finally { db.close(); }
        };
      };
    });
    return {
      hasPanel: Boolean(document.querySelector('.panel')),
      seeded: Boolean(localStorage.getItem('turning-traffic-state-v2') || localStorage.getItem('turning-traffic-state-v1')) ||
        Boolean(persisted?.records?.length),
      records: persisted?.records?.length ?? 0,
    };
  });
}
