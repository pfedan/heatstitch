import { describe, expect, it } from 'vitest';
import { isStroke, strokeLike } from '../src/digitize/digitize';
import { wholeArea } from '../src/model/knockout';
import { parsePath, rectPath } from '../src/shape/svgPath';
import { formFrom, storeForm, type Mat } from '../src/shape/path';

const ID: Mat = [1, 0, 0, 1, 0, 0];

/**
 * The stitch panel measures the selected shapes again after each change of their stitches; a design
 * back from a worker has the same curves as new objects, so these are looked up by content.
 */
describe('shape measurements remembered by content', () => {
  it('rasters the same curves once, also as another form object', () => {
    const f = parsePath(rectPath(0, 0, 40, 12, 0, 0), ID);
    const again = formFrom(structuredClone(storeForm(f)))!;
    expect(again).not.toBe(f);
    expect(wholeArea(again, 0.1, 0.2)).toBe(wholeArea(f, 0.1, 0.2));
    // Other curves or another growth are their own.
    expect(wholeArea(f, 0.1, 0.3)).not.toBe(wholeArea(f, 0.1, 0.2));
  });

  it('tells a stroke as isStroke does', () => {
    for (const [w, h] of [[40, 3], [40, 30]]) {
      const r = wholeArea(parsePath(rectPath(0, 0, w, h, 0, 0), ID))!;
      expect(strokeLike(r)).toBe(!!isStroke(r));
      expect(strokeLike({ ...r, mask: r.mask.slice() })).toBe(!!isStroke(r));
    }
  });
});
