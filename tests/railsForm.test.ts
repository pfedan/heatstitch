import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sewObjects } from '../src/model/objects';
import { movedRails, railsForm, reshapeRails } from '../src/model/railsForm';
import { keepShape } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { transformForm, translation, type Form } from '../src/shape/path';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

function satinOf(f: string) {
  const p = load(f);
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const o = objs.find((x) => railsForm(p, x, kinds));
  return { p, kinds, objs, o: o! };
}

/** The form with path `k` moved by (dx, dy). */
const movePath = (f: Form, k: number, dx: number, dy: number): Form => ({ paths: f.paths.map((p, i) => (i === k ? transformForm({ paths: [p] }, translation(dx, dy)).paths[0] : p)) });

describe('satin of a file as rails on the level Form', () => {
  it('shows a satin of a PES file as two lines per column with few nodes', () => {
    const { p, kinds, o } = satinOf('demos/letters.pes');
    expect(o).toBeDefined();
    const f = railsForm(p, o, kinds)!;
    const cols = keepShape(p, o, kinds).columns!.flat();
    expect(f.paths.length).toBe(2 * cols.length);
    for (let k = 0; k < cols.length; k++) expect(f.paths[2 * k].nodes.length).toBeLessThan(cols[k].left.length);
  });

  it('leaves the rails as they are when nothing moved, and moves the penetrations of a dragged rail with it', () => {
    const { p, kinds, o } = satinOf('demos/letters.pes');
    const f = railsForm(p, o, kinds)!;
    const cols = keepShape(p, o, kinds).columns!;
    const same = movedRails(cols, f, f)!;
    expect(same[0][0].left).toEqual(cols[0][0].left);
    const moved = movedRails(cols, f, movePath(f, 0, 0, -1))![0][0];
    moved.left.forEach((q, i) => {
      expect(q[0]).toBeCloseTo(cols[0][0].left[i][0], 6);
      expect(q[1]).toBeCloseTo(cols[0][0].left[i][1] - 1, 6);
    });
    expect(moved.right).toEqual(cols[0][0].right);
    // As many penetrations as before: the pairs stay.
    expect(moved.left.length).toBe(cols[0][0].left.length);
  });

  it('sews the satin anew along the dragged rail, as one object', () => {
    const { p, kinds, objs, o } = satinOf('demos/letters.pes');
    const f = railsForm(p, o, kinds)!;
    const r = reshapeRails(p, objs, o, kinds, movePath(f, 0, -0.8, -0.8), 7)!;
    expect(r).not.toBeNull();
    expect(r.starts.length).toBe(1);
    expect(sewObjects(r.pattern).length).toBe(objs.length);
    // What the new stitches remember: the dragged rail, the other one as it was.
    const before = keepShape(p, o, kinds).columns![0][0];
    const after = r.memory[0].columns![0][0];
    expect(after.left[0][0]).toBeCloseTo(before.left[0][0] - 0.8, 6);
    expect(after.left[0][1]).toBeCloseTo(before.left[0][1] - 0.8, 6);
    expect(after.right).toEqual(before.right);
  });
});
