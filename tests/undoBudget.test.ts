import { describe, expect, it } from 'vitest';
import { trimUndo } from '../src/ui/fileList';
import type { Pattern } from '../src/model/pattern';

/** A design of `n` records; `like` lends it its x and y (an edit that left them alone). */
function version(n: number, like?: Pattern): Pattern {
  return {
    name: 'test',
    format: 'dst',
    x: like?.x ?? new Int32Array(n),
    y: like?.y ?? new Int32Array(n),
    cmd: new Uint8Array(n),
    colors: [],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
}

describe('undo history budget', () => {
  it('keeps 50 steps of a small design', () => {
    const undo = Array.from({ length: 60 }, () => version(1000));
    const oldest = undo[10];
    trimUndo(undo, version(1000));
    expect(undo).toHaveLength(50);
    expect(undo[0]).toBe(oldest);
  });

  it('keeps fewer steps of a large design, the newest ones', () => {
    // 300 000 records are 2.7 MB per version: 64 MiB hold the current one and 23 steps.
    const undo = Array.from({ length: 40 }, () => version(300_000));
    const newest = undo[39];
    trimUndo(undo, version(300_000));
    expect(undo).toHaveLength(23);
    expect(undo[22]).toBe(newest);
  });

  it('keeps ten steps however large the design is', () => {
    const undo = Array.from({ length: 12 }, () => version(4_000_000));
    trimUndo(undo, version(4_000_000));
    expect(undo).toHaveLength(10);
  });

  it('counts records that versions share once', () => {
    // Recoloring keeps x and y: each step adds only its 1 MB of commands.
    const base = version(1_000_000);
    const undo = [base];
    for (let k = 0; k < 40; k++) undo.push(version(1_000_000, base));
    trimUndo(undo, version(1_000_000, base));
    expect(undo).toHaveLength(41);
  });
});
