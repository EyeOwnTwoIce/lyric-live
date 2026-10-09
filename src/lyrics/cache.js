/**
 * Cache de letras en IndexedDB.
 * Permite reutilizar letras ya descargadas y verlas sin conexion.
 * Si IndexedDB no esta disponible se degrada a no-op silencioso.
 */
import { CONFIG } from '../config.js';
import { debug } from '../util/log.js';

let dbPromise = null;
let unavailable = false;

function openDb() {
  if (unavailable) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (!globalThis.indexedDB) {
      unavailable = true;
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(CONFIG.cache.dbName, CONFIG.cache.dbVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CONFIG.cache.storeLyrics)) {
          db.createObjectStore(CONFIG.cache.storeLyrics, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        debug('IndexedDB no disponible', request.error);
        unavailable = true;
        resolve(null);
      };
      request.onblocked = () => {
        unavailable = true;
        resolve(null);
      };
    } catch (err) {
      debug('IndexedDB no se pudo abrir', err);
      unavailable = true;
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(CONFIG.cache.storeLyrics, mode).objectStore(CONFIG.cache.storeLyrics);
}

export async function getCachedLyrics(key) {
  if (!key) return null;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = tx(db, 'readonly').get(key);
      request.onsuccess = () => resolve(request.result ? request.result.value : null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putCachedLyrics(key, value) {
  if (!key || !value) return false;
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const request = tx(db, 'readwrite').put({ key, value, savedAt: Date.now() });
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function countEntries() {
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const request = tx(db, 'readonly').count();
      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

export async function clearCache() {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const request = tx(db, 'readwrite').clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** Borra las entradas mas antiguas si se supera el limite. */
export async function prune(maxEntries = CONFIG.cache.maxEntries) {
  const total = await countEntries();
  if (total <= maxEntries) return 0;
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const store = tx(db, 'readwrite');
      const all = store.getAll();
      all.onsuccess = () => {
        const rows = (all.result || []).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
        const excess = rows.slice(0, rows.length - maxEntries);
        excess.forEach((row) => store.delete(row.key));
        resolve(excess.length);
      };
      all.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}
