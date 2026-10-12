/**
 * Writing the embroidery file straight onto a USB stick, or onto a machine that shows up as a drive
 * when it is plugged in by cable (many Brother, Janome and Bernina machines do). Uses the File System
 * Access API (Chrome and Edge on the desktop). The chosen folder is remembered in IndexedDB, so the
 * next time one click is enough; the browser asks again for permission once per visit.
 *
 * WebUSB cannot do this: mass storage is a protected interface class there.
 */

import type { OutputFormat } from '../writers';
import { STORAGE_NS } from '../storage/namespace';

/** The part of the File System Access API used here (not in every TypeScript DOM library yet). */
interface DirHandle {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(d: BlobPart): Promise<void>; close(): Promise<void> }> }>;
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
}
export type StickHandle = DirHandle;

type PickerWindow = { showDirectoryPicker?: (o?: { id?: string; mode?: 'readwrite'; startIn?: string }) => Promise<DirHandle> };

/** Whether this browser can write onto a stick directly. */
export function stickSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as PickerWindow).showDirectoryPicker === 'function';
}

/**
 * A file name every machine reads: Brother takes only A to Z, digits, "-" and "_", and older
 * machines show the first characters only. Umlauts are spelled out, other accents dropped.
 */
export function stickFileName(name: string, format: OutputFormat): string {
  const base = name
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s.]+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 32);
  return `${base || 'design'}.${format.toUpperCase()}`;
}

/**
 * Where on the stick the file goes: the root, which every machine reads. A Janome machine makes
 * EMB/Embf on its stick and some models (MB-4) read only there, so a JEF goes there when it exists.
 * Nothing is created: an unknown stick stays as it is.
 */
export async function stickFolder(root: DirHandle, format: OutputFormat): Promise<{ dir: DirHandle; path: string[] }> {
  if (format === 'jef') {
    try {
      const emb = await root.getDirectoryHandle('EMB');
      return { dir: await emb.getDirectoryHandle('Embf'), path: ['EMB', 'Embf'] };
    } catch {
      // No Janome folders: the root.
    }
  }
  return { dir: root, path: [] };
}

/** Whether a file of that name is there already (it is then replaced). */
async function exists(dir: DirHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

export interface StickWritten {
  name: string;
  /** Folders below the stick's root; empty for the root. */
  path: string[];
  replaced: boolean;
}

/** Writes the file onto the stick. Throws when permission is refused or the stick is gone. */
export async function writeToStick(root: DirHandle, format: OutputFormat, name: string, data: Uint8Array): Promise<StickWritten> {
  if (root.queryPermission && (await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if (!root.requestPermission || (await root.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new StickError('denied');
  }
  const { dir, path } = await stickFolder(root, format);
  const fileName = stickFileName(name, format);
  const replaced = await exists(dir, fileName);
  const file = await dir.getFileHandle(fileName, { create: true });
  const w = await file.createWritable();
  await w.write(data as BlobPart);
  await w.close();
  return { name: fileName, path, replaced };
}

export class StickError extends Error {
  constructor(readonly code: 'denied' | 'cancelled') {
    super(code);
  }
}

/** Lets the user pick the stick (or the machine's drive). Rejects with StickError('cancelled') when closed. */
export async function pickStick(): Promise<DirHandle> {
  const pick = (window as unknown as PickerWindow).showDirectoryPicker!;
  try {
    const dir = await pick({ id: 'heatstitch-stick', mode: 'readwrite' });
    void rememberStick(dir);
    return dir;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new StickError('cancelled');
    throw err;
  }
}

// The remembered stick ---------------------------------------------------------------------------

const STORE = 'handles';
const KEY = 'stick';
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(`${STORAGE_NS}.send`, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function rememberStick(dir: DirHandle): Promise<void> {
  try {
    const db = await open();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(dir, KEY);
  } catch {
    // Not remembered: the stick is picked again next time.
  }
}

/** The stick chosen last time, if the browser kept it. */
export async function rememberedStick(): Promise<DirHandle | null> {
  if (!stickSupported()) return null;
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as DirHandle | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
