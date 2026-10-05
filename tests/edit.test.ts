import { describe, expect, it } from 'vitest';
import { objectsInRect } from '../src/model/edit';
import { computeBounds, JUMP, STITCH, type Pattern } from '../src/model/pattern';

/** Two objects: stitches 0..2 near the origin, a jump, then stitches 4..6 further right. */
function twoObjects(): Pattern {
  const x = Int32Array.from([0, 50, 100, 300, 300, 350, 400]);
  const y = Int32Array.from([0, 50, 0, 0, 0, 50, 0]);
  const cmd = Uint8Array.from([STITCH, STITCH, STITCH, JUMP, STITCH, STITCH, STITCH]);
  return { x, y, cmd, colors: [], bounds: computeBounds(x, y, cmd) } as unknown as Pattern;
}

describe('objectsInRect', () => {
  const p = twoObjects();
  const objs = [
    { first: 0, last: 2 },
    { first: 3, last: 6 },
  ];

  it('takes only objects lying wholly inside the band, drawn either way', () => {
    expect(objectsInRect(p, objs, -10, -10, 120, 60)).toEqual([objs[0]]);
    expect(objectsInRect(p, objs, 120, 60, -10, -10)).toEqual([objs[0]]);
    // Cutting through the second object leaves it out; the jump before it does not count.
    expect(objectsInRect(p, objs, -10, -10, 360, 60)).toEqual([objs[0]]);
    expect(objectsInRect(p, objs, 200, -10, 410, 60)).toEqual([objs[1]]);
    expect(objectsInRect(p, objs, -10, -10, 410, 60)).toEqual(objs);
  });

  it('leaves out hidden objects', () => {
    expect(objectsInRect(p, objs, -10, -10, 410, 60, (o) => o.first > 0)).toEqual([objs[1]]);
  });
});
