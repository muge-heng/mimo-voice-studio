/* IndexedDB：音频、克隆样本、音色设计与设置全部只存在本机浏览器 */

const DB_NAME = 'mimo-voice-studio', DB_VER = 1;
let _db = null;

function db() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'k' });
      if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('samples')) d.createObjectStore('samples', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('designs')) d.createObjectStore('designs', { keyPath: 'id' });
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}

export async function dbGet(store, key) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, 'readonly').objectStore(store).get(key); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
export async function dbAll(store) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, 'readonly').objectStore(store).getAll(); t.onsuccess = () => res(t.result || []); t.onerror = () => rej(t.error); }); }
export async function dbPut(store, val) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite').objectStore(store).put(val); t.onsuccess = () => res(val); t.onerror = () => rej(t.error); }); }
export async function dbDel(store, key) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite').objectStore(store).delete(key); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); }
export async function dbClear(store) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite').objectStore(store).clear(); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); }
export const getSetting = async (k, def) => { try { const r = await dbGet('settings', k); return r ? r.v : def; } catch (e) { return def; } };
export const setSetting = async (k, v) => { try { await dbPut('settings', { k, v }); } catch (e) { /* 隐私模式等场景下静默降级 */ } };
