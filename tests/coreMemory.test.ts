import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { digitizeDefaults, digitizeShapes, type ShapeInput } from '../src/digitize/digitize';
import { digitizedFile } from '../src/model/digitized';
import { sewObjects } from '../src/model/objects';
import { transformObjects } from '../src/model/reshape';
import { scaling, type Mat } from '../src/shape/path';
import { rasterize } from '../src/shape/rasterize';
import { ellipsePath, parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { core, coreMemoryBytes } from '../src/wasm/core';

/**
 * The compute core keeps its memory in bounds on a large design, and a call that traps does not
 * take the core down with it. The fly agaric of the screencast (the SVG at 400 mm wide) scaled to
 * 300 % took all 4 GB a WebAssembly module may have, after which every call failed: its areas were
 * rastered at 0.1 mm however large, a dozen fields of them were kept, and the search for the ways
 * inside an area (the tour of a fill) pushed ever more copies of its cells.
 */

describe('the compute core', () => {
  it('scales a large design to 300 % in a few hundred MB', () => {
    // The fly agaric as in tests/helpers/exampleDesigns.ts (265 mm wide), without its background.
    const svg = JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync('tests/fixtures/svg-shapes.json.gz')))) as { design: string; d: string; m: Mat }[];
    const shapes: ShapeInput[] = svg
      .filter((s) => s.design === 'fliegenpilz-quelle')
      .slice(1)
      .map((s, k) => ({ color: k % 3, kind: 'fill', form: parsePath(s.d, s.m) }));
    const threads = [
      { r: 200, g: 40, b: 50 },
      { r: 30, g: 120, b: 60 },
      { r: 240, g: 200, b: 40 },
    ];
    const d = digitizeShapes(shapes, threads, digitizeDefaults(DEFAULT_PROFILE), { w: 265, h: 265 }, false, 'fliegenpilz');
    const p = digitizedFile(d, 'fliegenpilz', 2).pattern;
    const objs = sewObjects(p);
    const r = transformObjects(p, objs.map((o) => o.index), scaling(3, 3, 0, 0), 2);
    expect(r).not.toBeNull();
    expect(sewObjects(r!.pattern).length).toBe(objs.length);
    // Memory only grows: what it holds now is the most it held.
    expect(coreMemoryBytes()).toBeLessThan(450e6);
  }, 60_000);

  it('starts afresh after a call that traps', () => {
    const circle = () => rasterize(parsePath(ellipsePath(10, 10, 5, 5), [1, 0, 0, 1, 0, 0]))!;
    const before = circle();
    // A mask shorter than its size: the core panics, which it cannot unwind from.
    expect(() => core().signedField(new Uint8Array(1), 50, 50, 0.1)).toThrow(WebAssembly.RuntimeError);
    const after = circle();
    expect(after.mask).toEqual(before.mask);
    expect(after.sdf).toEqual(before.sdf);
  });
});
