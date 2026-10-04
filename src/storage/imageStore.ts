/**
 * Keeps the image of the Bild mode across page reloads: its file and the user's color changes and
 * brush strokes. Like the embroidery files it goes to IndexedDB, in a database of its own; every
 * call degrades to a no-op when storage is unavailable.
 */

import type { ColorEdit, Stroke } from '../image/prepare';
import { STORAGE_NS } from './namespace';

export interface StoredImage {
  name: string;
  type: string;
  data: ArrayBuffer;
}

export interface StoredWork {
  edits: ColorEdit[];
  strokes: Stroke[];
}

const STORE = 'image';
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(`${STORAGE_NS}.image`, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = op(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Stores a newly loaded image; its earlier changes are dropped. */
export async function saveImage(image: StoredImage): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(image, 'source'));
    await run('readwrite', (s) => s.delete('work'));
  } catch (err) {
    console.warn('Could not store the image', err);
  }
}

export async function saveWork(work: StoredWork): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(work, 'work'));
  } catch (err) {
    console.warn('Could not store the image changes', err);
  }
}

export async function loadImage(): Promise<{ image: StoredImage; work: StoredWork } | null> {
  try {
    const image = (await run('readonly', (s) => s.get('source'))) as StoredImage | undefined;
    if (!image?.data) return null;
    const work = (await run('readonly', (s) => s.get('work'))) as Partial<StoredWork> | undefined;
    const edits = Array.isArray(work?.edits) ? work.edits : [];
    const strokes = Array.isArray(work?.strokes) ? work.strokes : [];
    return { image, work: { edits, strokes } };
  } catch (err) {
    console.warn('Could not read the stored image', err);
    return null;
  }
}
