import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULTS, materialOf } from '../src/settings';
import { sameDesign, type LoadedFile } from '../src/ui/fileList';
import { parsePattern } from '../src/parsers';
import { toStored } from '../src/storage/fileStore';
import type { ProjectFile } from '../src/storage/project';

const data = new Uint8Array(readFileSync(new URL('../public/examples/demos/overlap.pes', import.meta.url)));

function open(edit = false): LoadedFile {
  const original = parsePattern(data, 'overlap.pes');
  const pattern = edit ? { ...original, x: original.x.slice(), y: original.y.slice(), cmd: original.cmd.slice() } : original;
  return { id: 1, fileName: 'overlap.pes', data, original, pattern, undo: [], redo: [], acks: [], material: materialOf(DEFAULTS), own: false };
}

// A saved project holds its own copy of the stitches.
function copy(p: NonNullable<LoadedFile['pattern']>) {
  const w = toStored(p);
  return { ...w, x: w.x.slice(), y: w.y.slice(), cmd: w.cmd.slice() };
}

function saved(f: LoadedFile): ProjectFile {
  return { name: f.fileName, data: data.slice(), ...(f.pattern !== f.original ? { working: copy(f.pattern!) } : {}), acks: [], objects: [] };
}

describe('opening a project that is already open', () => {
  it('knows an unchanged design', () => {
    expect(sameDesign(open(), saved(open()))).toBe(true);
  });

  it('knows an edited design with the same stitches', () => {
    const f = open(true);
    expect(sameDesign(f, saved(f))).toBe(true);
  });

  it('keeps designs apart that differ in stitches, edit state or name', () => {
    const f = open(true);
    const p = saved(f);
    f.pattern!.x[5] += 10;
    expect(sameDesign(f, p)).toBe(false);
    expect(sameDesign(open(), saved(open(true)))).toBe(false);
    expect(sameDesign(open(true), saved(open()))).toBe(false);
    expect(sameDesign({ ...open(), title: 'Mein Name' }, saved(open()))).toBe(false);
  });
});
