import { afterEach, describe, expect, it } from 'vitest';
import { cleanStick, freeName, isMacLeftover, saveToStick } from '../src/storage/stick';

/** A folder as the File System Access API hands it out, in memory. */
class FakeDir {
  kind = 'directory' as const;
  files = new Map<string, Uint8Array>();
  dirs = new Map<string, FakeDir>();
  /** Files macOS adds when one is closed (its AppleDouble file on a FAT stick). */
  macOS = false;
  constructor(public name: string) {}
  async *entries(): AsyncIterable<[string, { kind: string }]> {
    for (const n of [...this.files.keys()]) yield [n, { kind: 'file' }];
    for (const [n, d] of [...this.dirs]) yield [n, d];
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) throw new Error('NotFoundError');
  }
  async getFileHandle(name: string, o?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!o?.create) throw new Error('NotFoundError');
      this.files.set(name, new Uint8Array());
    }
    return {
      createWritable: async () => {
        let data: Uint8Array = new Uint8Array();
        return {
          write: async (d: Uint8Array) => void (data = d),
          close: async () => {
            this.files.set(name, data);
            if (this.macOS) this.files.set(`._${name}`, new Uint8Array(4096));
          },
        };
      },
    };
  }
  async queryPermission() {
    return 'granted' as const;
  }
}

const asDir = (d: FakeDir) => d as unknown as Parameters<typeof cleanStick>[0];

afterEach(() => {
  delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe('saving to the stick', () => {
  it('knows the files macOS leaves', () => {
    expect(isMacLeftover('._katze.pes')).toBe(true);
    expect(isMacLeftover('.DS_Store')).toBe(true);
    expect(isMacLeftover('katze.pes')).toBe(false);
    expect(isMacLeftover('.Trashes')).toBe(false);
  });

  it('removes them from the folder and its folders, never designs or hidden folders', async () => {
    const root = new FakeDir('STICK');
    for (const n of ['katze.pes', '._katze.pes', '.DS_Store', 'herz.dst']) root.files.set(n, new Uint8Array());
    const sub = new FakeDir('Blumen');
    for (const n of ['rose.jef', '._rose.jef']) sub.files.set(n, new Uint8Array());
    const trash = new FakeDir('.Trashes');
    trash.files.set('._alt.pes', new Uint8Array());
    root.dirs.set('Blumen', sub);
    root.dirs.set('.Trashes', trash);
    expect(await cleanStick(asDir(root))).toBe(3);
    expect([...root.files.keys()]).toEqual(['katze.pes', 'herz.dst']);
    expect([...sub.files.keys()]).toEqual(['rose.jef']);
    expect(trash.files.size).toBe(1);
  });

  it('never replaces a design already on the stick', async () => {
    const root = new FakeDir('STICK');
    root.files.set('katze.pes', new Uint8Array());
    root.files.set('katze-2.pes', new Uint8Array());
    expect(await freeName(asDir(root), 'katze', 'pes')).toBe('katze-3.pes');
    expect(await freeName(asDir(root), 'herz', 'pes')).toBe('herz.pes');
  });

  it('writes into the picked folder and takes away the ._ file macOS adds', async () => {
    const root = new FakeDir('STICK');
    root.macOS = true;
    root.files.set('katze.pes', new Uint8Array([9]));
    (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => root;
    const data = new Uint8Array([1, 2, 3]);
    const r = await saveToStick(data, 'katze', 'pes');
    expect(r).toEqual({ ok: true, folder: 'STICK', file: 'katze-2.pes', cleaned: 1 });
    expect(root.files.get('katze-2.pes')).toEqual(data);
    expect(root.files.get('katze.pes')).toEqual(new Uint8Array([9]));
    expect([...root.files.keys()].some(isMacLeftover)).toBe(false);
  });

  it('does nothing when the folder picker is closed', async () => {
    (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => {
      throw new DOMException('aborted', 'AbortError');
    };
    expect(await saveToStick(new Uint8Array([1]), 'katze', 'pes')).toEqual({ ok: false, cancelled: true });
  });
});
