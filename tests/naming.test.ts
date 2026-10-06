import { describe, expect, it } from 'vitest';
import { DEFAULTS, materialOf } from '../src/settings';
import { FileList, type LoadedFile } from '../src/ui/fileList';
import type { Pattern } from '../src/model/pattern';

const pattern = (): Pattern => ({ name: '', format: 'pes', x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } });

function file(fileName: string, extra: Partial<LoadedFile> = {}): LoadedFile {
  const p = pattern();
  return { id: 1, fileName, pattern: p, original: p, undo: [], redo: [], acks: [], material: materialOf(structuredClone(DEFAULTS)), own: false, ...extra };
}

describe('design names', () => {
  it('shows loaded embroidery files with their extension, designs made in the app without', () => {
    expect(FileList.displayName(file('katze.pes'))).toBe('katze.pes');
    expect(FileList.displayName(file('Neues Stickmuster.pes', { own: true }))).toBe('Neues Stickmuster');
  });

  it('shows a given name, keeping the extension of a loaded file', () => {
    expect(FileList.displayName(file('katze.dst', { title: 'Katze rot' }))).toBe('Katze rot.dst');
    expect(FileList.displayName(file('Neues Stickmuster.pes', { own: true, title: 'Herz 1.5' }))).toBe('Herz 1.5');
  });

  it('offers the given name for saving, "-corrected" only for an edited file that kept its file name', () => {
    const edited = (f: LoadedFile) => ({ ...f, pattern: { ...f.pattern! } });
    expect(FileList.saveName(file('katze.pes'))).toBe('katze');
    expect(FileList.saveName(edited(file('katze.pes')))).toBe('katze-corrected');
    expect(FileList.saveName(edited(file('katze.pes', { title: 'Katze rot' })))).toBe('Katze rot');
    expect(FileList.saveName(edited(file('Logo.pes', { own: true })))).toBe('Logo');
    expect(FileList.saveName(file('x.pes', { own: true, title: 'Herz 1.5' }))).toBe('Herz 1.5');
  });
});
