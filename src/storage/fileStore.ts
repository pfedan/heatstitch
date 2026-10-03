/**
 * Keeps loaded embroidery files across page reloads. The raw bytes go to IndexedDB, since
 * localStorage only holds a few MB of strings; which file was active goes to localStorage.
 * Every call degrades to a no-op when storage is unavailable (private mode, quota).
 */

export interface StoredFile {
  key: number;
  name: string;
  data: ArrayBuffer;
}

const DB_NAME = 'heatstitch';
const STORE = 'files';
const ACTIVE_KEY = 'heatstitch.activeFile';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = op(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Stores a file and returns its key, or null if storage failed. */
export async function putFile(name: string, data: ArrayBuffer): Promise<number | null> {
  try {
    return (await run('readwrite', (s) => s.add({ name, data }))) as number;
  } catch (err) {
    console.warn('Could not store file', err);
    return null;
  }
}

export async function deleteFile(key: number): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(key));
  } catch (err) {
    console.warn('Could not delete stored file', err);
  }
}

/** All stored files in the order they were added. */
export async function listFiles(): Promise<StoredFile[]> {
  try {
    return await run('readonly', (s) => s.getAll() as IDBRequest<StoredFile[]>);
  } catch (err) {
    console.warn('Could not read stored files', err);
    return [];
  }
}

export function loadActiveKey(): number | null {
  try {
    const v = Number(localStorage.getItem(ACTIVE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveActiveKey(key: number | null): void {
  try {
    if (key == null) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, String(key));
  } catch {
    // Storage unavailable; the first file is activated after a reload.
  }
}
