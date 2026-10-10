/**
 * Saving straight onto the stick that goes into the embroidery machine (Chromium browsers, which
 * can be given a folder). The folder is asked for once and remembered in IndexedDB.
 *
 * After writing, the leftovers of macOS are removed from that folder: `._name.pes` (the AppleDouble
 * file macOS writes next to every file on a FAT stick) carries the design's extension, so machines
 * list it as a second design that will not open; `.DS_Store` comes from the Finder. Bastidor
 * (MIT, github.com/diogobernini/bastidor, src/main/drives.js) cleans sticks the same way.
 */

import { STORAGE_NS } from './namespace';

/** The parts of the File System Access API used here (not in TypeScript's DOM types everywhere). */
interface PermissionHandle {
  queryPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
}
type Dir = FileSystemDirectoryHandle & PermissionHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };
type Picker = (o: { id: string; mode: 'readwrite'; startIn?: unknown }) => Promise<Dir>;

const picker = (): Picker | undefined => (globalThis as { showDirectoryPicker?: Picker }).showDirectoryPicker;

/** Whether this browser can write into a folder the user picks. */
export const canSaveToStick = (): boolean => typeof picker() === 'function' && typeof indexedDB !== 'undefined';

// The remembered folder ------------------------------------------------------------------------

const DB_NAME = `${STORAGE_NS}.stick`;
const STORE = 'folder';
const KEY = 'stick';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function remembered(): Promise<Dir | null> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const req = d.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as Dir | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function remember(dir: Dir): Promise<void> {
  try {
    const d = await db();
    d.transaction(STORE, 'readwrite').objectStore(STORE).put(dir, KEY);
  } catch {
    // Not remembered: the folder is asked for again next time.
  }
}

/** The name of the remembered folder, to show on the button; null before one was picked. */
export async function stickName(): Promise<string | null> {
  return (await remembered())?.name ?? null;
}

// Writing --------------------------------------------------------------------------------------

/** The macOS files that do not belong on a stick. */
export const isMacLeftover = (name: string): boolean => name === '.DS_Store' || name.startsWith('._');

/**
 * Removes macOS leftovers from `dir` and the folders in it (not from hidden folders such as
 * .Trashes, which machines do not show), at most `depth` folders deep. Returns how many went.
 */
export async function cleanStick(dir: Dir, depth = 3): Promise<number> {
  let removed = 0;
  const sub: Dir[] = [];
  try {
    for await (const [name, entry] of dir.entries()) {
      if (entry.kind === 'file' && isMacLeftover(name)) {
        try {
          await dir.removeEntry(name);
          removed++;
        } catch {
          // Gone already or not ours to remove: leave it.
        }
      } else if (entry.kind === 'directory' && !name.startsWith('.') && depth > 1) sub.push(entry as Dir);
    }
  } catch {
    return removed;
  }
  for (const d of sub) removed += await cleanStick(d, depth - 1);
  return removed;
}

async function exists(dir: Dir, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** `name.ext`, or `name-2.ext`, `name-3.ext` ... when the folder has it already: nothing on the stick is replaced. */
export async function freeName(dir: Dir, base: string, ext: string): Promise<string> {
  let name = `${base}.${ext}`;
  for (let k = 2; await exists(dir, name); k++) name = `${base}-${k}.${ext}`;
  return name;
}

async function writable(dir: Dir): Promise<boolean> {
  const mode = { mode: 'readwrite' as const };
  if ((await dir.queryPermission?.(mode)) === 'granted') return true;
  return (await dir.requestPermission?.(mode)) === 'granted';
}

export type StickResult =
  | { ok: true; folder: string; file: string; cleaned: number }
  /** The user closed the folder picker or did not allow writing: nothing to say. */
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; folder: string };

/**
 * Writes `data` as `base.ext` into the stick folder: the remembered one, or one the user picks now
 * (with `pick`, when none is remembered, or when the remembered one is gone, e.g. unplugged).
 * Must run from a click: picking and allowing need one.
 */
export async function saveToStick(data: Uint8Array, base: string, ext: string, pick = false): Promise<StickResult> {
  const choose = picker();
  if (!choose) return { ok: false, cancelled: true };
  let dir = pick ? null : await remembered();
  if (dir) {
    const allowed = await writable(dir).catch(() => null);
    if (allowed === false) return { ok: false, cancelled: true };
    if (allowed === null || !(await reachable(dir))) dir = null;
  }
  if (!dir) {
    try {
      dir = await choose({ id: 'stick', mode: 'readwrite', startIn: (await remembered()) ?? 'desktop' });
    } catch {
      return { ok: false, cancelled: true };
    }
    if (!(await writable(dir))) return { ok: false, cancelled: true };
    await remember(dir);
  }
  try {
    const file = await freeName(dir, base, ext);
    const out = await (await dir.getFileHandle(file, { create: true })).createWritable();
    await out.write(data as BlobPart);
    await out.close();
    // macOS writes the ._ file as the file is closed; a second look a moment later catches a late one.
    const cleaned = await cleanStick(dir);
    const again = dir;
    setTimeout(() => void cleanStick(again), 2000);
    return { ok: true, folder: dir.name, file, cleaned };
  } catch {
    return { ok: false, cancelled: false, folder: dir.name };
  }
}

/** Whether the folder is still there (a stick pulled out leaves a handle that leads nowhere). */
async function reachable(dir: Dir): Promise<boolean> {
  try {
    await dir.entries()[Symbol.asyncIterator]().next();
    return true;
  } catch {
    return false;
  }
}
