import { describe, expect, it } from 'vitest';
import { fromStored, toStored } from '../src/storage/fileStore';
import { moveRecords, removeStitches } from '../src/model/edit';
import { Shape } from './helpers/shapes';

describe('working copy storage', () => {
  const original = new Shape().to(0, 0).to(5, 0).to(10, 0).to(15, 0).build();

  it('rebuilds an edited pattern on top of its original', () => {
    const edited = moveRecords(original, [1], 0, 20);
    const back = fromStored(original, structuredClone(toStored(edited)))!;
    expect([...back.x]).toEqual([...edited.x]);
    expect([...back.y]).toEqual([...edited.y]);
    expect([...back.cmd]).toEqual([...edited.cmd]);
    expect(back.bounds).toEqual(edited.bounds);
    expect(back.name).toBe(original.name);
    expect(back.format).toBe(original.format);
  });

  it('keeps a shorter working copy (stitches removed)', () => {
    const mask = new Uint8Array(original.cmd.length);
    mask[2] = 1;
    const edited = removeStitches(original, mask);
    const back = fromStored(original, structuredClone(toStored(edited)))!;
    expect(back.cmd.length).toBe(edited.cmd.length);
    expect(back.cmd.length).toBeLessThan(original.cmd.length);
  });

  it('rejects a malformed copy so the original is used', () => {
    const w = toStored(original);
    expect(fromStored(original, undefined)).toBeNull();
    expect(fromStored(original, { ...w, x: w.x.slice(1) })).toBeNull();
    expect(fromStored(original, { ...w, cmd: Uint8Array.from(w.cmd, () => 9) })).toBeNull();
    expect(fromStored(original, { ...w, colors: null as never })).toBeNull();
    expect(fromStored(original, { ...w, y: [1, 2] as never })).toBeNull();
  });
});
