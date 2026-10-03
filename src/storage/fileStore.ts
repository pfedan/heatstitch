/**
 * Keeps loaded embroidery files across page reloads. The raw bytes go to IndexedDB, since
 * localStorage only holds a few MB of strings; which file was active goes to localStorage.
 * Every call degrades to a no-op when storage is unavailable (private mode, quota).
 *
 * An edited file keeps its working copy in the same record as the original bytes, so the two are
 * restored and removed together and the original is never overwritten.
 */

import { computeBounds, type Pattern, type ThreadColor } from '../model/pattern';

/** The records of an edited pattern; name, format and bounds come from the original. */
export interface StoredPattern {
  x: Int32Array;
  y: Int32Array;
  cmd: Uint8Array;
  colors: ThreadColor[];
}

export interface StoredFile {
  key: number;
  name: string;
  data: ArrayBuffer;
  /** Working copy of an edited file; absent while the file is unchanged. */
  working?: StoredPattern;
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

const pending = new Map<number, Promise<void>>();

/**
 * Stores the working copy of file `key`, or removes it when null (the file is back to its original).
 * Writes for one file run in order, so the last edit always wins.
 */
export function saveWorking(key: number, working: StoredPattern | null): Promise<void> {
  const prev = pending.get(key) ?? Promise.resolve();
  const next = prev.then(() => writeWorking(key, working));
  pending.set(key, next);
  void next.then(() => {
    if (pending.get(key) === next) pending.delete(key);
  });
  return next;
}

async function writeWorking(key: number, working: StoredPattern | null): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const get = store.get(key);
      get.onsuccess = () => {
        const rec = get.result as StoredFile | undefined;
        // The file was removed meanwhile; nothing to attach the copy to.
        if (!rec) return;
        if (working) rec.working = working;
        else delete rec.working;
        store.put(rec);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Could not store working copy', err);
  }
}

export function toStored(p: Pattern): StoredPattern {
  return { x: p.x, y: p.y, cmd: p.cmd, colors: p.colors };
}

/**
 * Rebuilds an edited pattern on top of its original, or returns null if the stored copy is not a
 * well-formed pattern (the caller then falls back to the original).
 */
export function fromStored(original: Pattern, w: StoredPattern | undefined): Pattern | null {
  if (!w) return null;
  const { x, y, cmd, colors } = w;
  const n = cmd instanceof Uint8Array ? cmd.length : -1;
  if (!(x instanceof Int32Array) || !(y instanceof Int32Array) || x.length !== n || y.length !== n) return null;
  if (!Array.isArray(colors) || cmd.some((c) => c > 4)) return null;
  return { ...original, x, y, cmd, colors, bounds: computeBounds(x, y, cmd) };
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
