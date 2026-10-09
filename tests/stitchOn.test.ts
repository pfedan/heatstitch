import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { atThreadEnd, sewOn, stitchesTo, type ThreadEnds } from '../src/model/edit';
import { keepObjects, objectView, type HandChange } from '../src/model/handEdit';
import { STITCH, type Pattern } from '../src/model/pattern';
import { remembered } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import { addShape } from '../src/model/addShape';
import { digitizeDefaults } from '../src/digitize/digitize';
import { parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import type { Mat } from '../src/shape/path';
import { Editor, HAND_MAX } from '../src/ui/editor';
import { tagShortStitches, TIE } from '../src/validation/shortStitches';
import { Shape } from './helpers/shapes';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);
const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const SCALE = 20; // px per mm, zoomed in far enough to pick penetrations

/**
 * The editor as the app wires it in Ablauf: working on object `o` of a mutable file, every commit an
 * undo step after which the objects keep what they remember (keepObjects).
 */
function inObject(p: Pattern, o: number) {
  const state = { pattern: p, o, undo: [] as Pattern[], changes: [] as HandChange[] };
  const obj = () => objectView(state.pattern).objects[state.o];
  const editor = new Editor({
    pattern: () => state.pattern,
    range: () => ({ first: obj().first, last: obj().last }),
    ends: () => ({ first: obj().first, end: obj().last - obj().tieOff, last: obj().last }),
    commit: (next, change) => {
      const moved = keepObjects(state.pattern, next, change!);
      state.undo.push(state.pattern);
      state.changes.push(change!);
      state.o = moved.get(state.o) ?? -1;
      state.pattern = next;
    },
    redraw: () => {},
    changed: () => {},
  });
  editor.setActive(true);
  return { state, editor, obj };
}

/** A click (down and up without moving) at world mm (x, y). */
function click(editor: Editor, x: number, y: number, scale = SCALE): void {
  editor.down(x, y, x * scale, y * scale, false, scale);
  editor.up();
}

const pos = (p: Pattern, i: number): [number, number] => [p.x[i], p.y[i]];

describe('stitching on, click by click', () => {
  it('splits a stitch longer than a machine makes into even steps', () => {
    expect(stitchesTo(0, 0, 50, 0, HAND_MAX)).toEqual([[50, 0]]);
    const pts = stitchesTo(0, 0, 300, 0, HAND_MAX);
    expect(pts).toHaveLength(3);
    expect(pts[2]).toEqual([300, 0]);
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = k ? pts[k - 1] : [0, 0];
      expect(Math.hypot(pts[k][0] - ax, pts[k][1] - ay)).toBeLessThanOrEqual(HAND_MAX);
    }
  });

  it('sews new points after a record and takes the tie-off along, turned with the last stitch', () => {
    const p = new Shape().to(0, 0).to(1, 0).to(2, 0).to(2.1, 0).to(2, 0).build();
    const ends: ThreadEnds = { first: 0, end: 2, last: 4 };
    const end = atThreadEnd(p, 2, ends)!;
    expect(end.tie).toEqual([3, 4]);
    expect(atThreadEnd(p, 1, ends)).toBeNull();
    const q = sewOn(p, 2, [[30, 10]], end.tie);
    expect(Array.from(q.x)).toEqual([0, 10, 20, 30, 31, 30]);
    // The tie-off ran on along the last stitch (east); now the last stitch goes north-east, so does it.
    expect(Array.from(q.y)).toEqual([0, 0, 0, 10, 11, 10]);
  });

  it('goes on from the thread end of an object, which stays the same object', () => {
    const p = load('cat-60mm.pes');
    const o = 50; // a running stitch with a tie-off
    const { state, editor, obj } = inObject(p, o);
    const before = objectView(p).objects;
    const b = before[o];
    expect(b.tieOff).toBeGreaterThan(0);
    const endBefore = pos(p, b.last - b.tieOff);
    editor.setPen(true);
    // Nothing selected: the first click goes on from the thread end.
    const [ex, ey] = endBefore;
    click(editor, ex / 10 + 2, ey / 10 + 1);
    click(editor, ex / 10 + 3, ey / 10 - 1);
    expect(state.undo).toHaveLength(2);
    const after = objectView(state.pattern).objects;
    expect(after.map((x) => x.id)).toEqual(before.map((x) => x.id));
    expect(state.o).toBe(o);
    const a = obj();
    expect(a.stitches).toBe(b.stitches + 2);
    // The thread now ends at the last click, still locked there: the tie-off came along.
    expect(a.tieOff).toBe(b.tieOff);
    expect(pos(state.pattern, a.last - a.tieOff)).toEqual([ex + 30, ey - 10]);
    const tags = tagShortStitches(state.pattern);
    for (let i = a.last - a.tieOff + 1; i <= a.last; i++) {
      expect(tags[i]).toBe(TIE);
      expect(Math.hypot(state.pattern.x[i] - (ex + 30), state.pattern.y[i] - (ey - 10))).toBeLessThan(15);
    }
    // The new one is selected, so the next click goes on from it.
    expect([...editor.selection]).toEqual([a.last - a.tieOff]);
    expect(remembered(state.pattern, a)?.hand).toBe(2);
    // Other objects keep their stitches.
    for (const x of after) if (x.index !== o) expect(x.stitches).toBe(before[x.index].stitches);
  });

  it('puts a point in between after the selected one, and the thread goes on as before', () => {
    const p = load('cat-60mm.pes');
    const o = 45;
    const { state, editor, obj } = inObject(p, o);
    const b = obj();
    const i = b.first + 10;
    const nextBefore = pos(p, i + 1);
    editor.selection = new Set([i]);
    editor.setPen(true);
    click(editor, p.x[i] / 10 + 1.5, p.y[i] / 10);
    expect(pos(state.pattern, i + 1)).toEqual([p.x[i] + 15, p.y[i]]);
    expect(pos(state.pattern, i + 2)).toEqual(nextBefore);
    expect([...editor.selection]).toEqual([i + 1]);
    expect(obj().stitches).toBe(b.stitches + 1);
  });

  it('hits an existing hole when clicked near it, and splits a long way', () => {
    const p = load('cat-60mm.pes');
    const { state, editor } = inObject(p, 45);
    const b = objectView(p).objects[45];
    const hole = b.first + 20;
    editor.setPen(true);
    // 2 px beside the hole (zoomed in far, so no other hole is that near): exactly into it.
    click(editor, p.x[hole] / 10 + 2 / 400, p.y[hole] / 10, 400);
    const at = [...editor.selection][0];
    expect(pos(state.pattern, at)).toEqual(pos(p, hole));
    // 30 mm further on: sewn in steps no machine stitch is longer than.
    const [x, y] = pos(state.pattern, at);
    click(editor, x / 10 + 30, y / 10);
    const n = Math.ceil(300 / HAND_MAX);
    expect(state.changes[1]).toEqual({ inserted: at + 1, count: n });
    for (let k = at + 1; k <= at + n; k++) {
      expect(state.pattern.cmd[k]).toBe(STITCH);
      expect(Math.hypot(state.pattern.x[k] - state.pattern.x[k - 1], state.pattern.y[k] - state.pattern.y[k - 1])).toBeLessThanOrEqual(HAND_MAX);
    }
    expect(pos(state.pattern, at + n)).toEqual([x + 300, y]);
  });

  it('a drag moves the view and sews nothing', () => {
    const p = load('cat-60mm.pes');
    const { state, editor } = inObject(p, 45);
    editor.setPen(true);
    expect(editor.down(10, 10, 200, 200, false, SCALE)).toBe('move');
    expect(editor.dragTo(12, 10, 240, 200)).toBe(false);
    editor.up();
    expect(state.undo).toHaveLength(0);
  });

  it('takes back the last point, the thread end with its tie-off', () => {
    const p = load('cat-60mm.pes');
    const o = 50;
    const { state, editor, obj } = inObject(p, o);
    const b = obj();
    const end = b.last - b.tieOff;
    const tieBefore = Array.from({ length: b.tieOff }, (_, k) => pos(p, end + 1 + k));
    editor.setPen(true);
    click(editor, p.x[end] / 10 + 2, p.y[end] / 10);
    editor.deleteSelection();
    // The one before is current again, the tie-off back where it was.
    const a = obj();
    expect(a.stitches).toBe(b.stitches);
    expect([...editor.selection]).toEqual([end]);
    expect(Array.from({ length: a.tieOff }, (_, k) => pos(state.pattern, a.last - a.tieOff + 1 + k))).toEqual(tieBefore);
    // The end itself deleted: the tie-off goes to the one before.
    editor.deleteSelection();
    const c = obj();
    expect(c.stitches).toBe(b.stitches - 1);
    const newEnd = pos(state.pattern, c.last - c.tieOff);
    expect(newEnd).toEqual(pos(p, end - 1));
    for (let i = c.last - c.tieOff + 1; i <= c.last; i++) expect(Math.hypot(state.pattern.x[i] - newEnd[0], state.pattern.y[i] - newEnd[1])).toBeLessThan(15);
  });

  it('jumps to the start and the thread end, and steps ten at a time', () => {
    const p = load('cat-60mm.pes');
    const { editor, obj } = inObject(p, 45);
    const b = obj();
    expect(editor.toEnd('first')).toBe(b.first);
    expect(editor.toEnd('end')).toBe(b.last - b.tieOff);
    editor.toEnd('first');
    const i = editor.step(1, 10);
    let n = 0;
    for (let k = b.first + 1; k <= i; k++) if (p.cmd[k] === STITCH) n++;
    expect(n).toBe(10);
  });

  it('turns a tie-off sewn back along the last stitch with the new last stitch, so it stays hidden in it', () => {
    // A line drawn in the app: its tie-off runs back along its last stitch (lockAt).
    let p = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as unknown as Pattern;
    p = addShape(p, { form: parsePath('M0 0 L20 0', ID), kind: 'stroke', width: 0.4 }, { r: 200, g: 30, b: 30 }, null, options)!.pattern;
    const { state, editor, obj } = inObject(p, 0);
    const b = obj();
    const end = b.last - b.tieOff;
    expect(b.tieOff).toBeGreaterThan(0);
    editor.setPen(true);
    // On at a right angle: 3 mm down, then 3 mm back to the left.
    click(editor, p.x[end] / 10, p.y[end] / 10 + 3);
    click(editor, p.x[end] / 10 - 3, p.y[end] / 10 + 3);
    const a = obj();
    const q = state.pattern;
    const e = a.last - a.tieOff;
    const [ex, ey] = pos(q, e);
    expect([ex, ey]).toEqual([p.x[end] - 30, p.y[end] + 30]);
    // Every tie-off point lies on the last stitch now (going right from the end), none off it.
    for (let i = e + 1; i <= a.last; i++) {
      if (q.cmd[i] !== STITCH) continue;
      expect(Math.abs(q.y[i] - ey)).toBeLessThanOrEqual(1);
      expect(q.x[i]).toBeGreaterThanOrEqual(ex);
      expect(q.x[i]).toBeLessThanOrEqual(ex + 30);
    }
    // Taken back, the tie-off is back along the stitch before.
    editor.deleteSelection();
    const c = obj();
    const r = state.pattern;
    const [cx, cy] = pos(r, c.last - c.tieOff);
    for (let i = c.last - c.tieOff + 1; i <= c.last; i++) if (r.cmd[i] === STITCH) expect(Math.abs(r.x[i] - cx)).toBeLessThanOrEqual(1), expect(r.y[i]).toBeLessThanOrEqual(cy);
  });
});
