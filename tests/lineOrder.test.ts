import { describe, expect, it } from 'vitest';
import { lineRails } from '../src/digitize/border';
import { digitizeDefaults } from '../src/digitize/digitize';
import { pointAt, cumulative } from '../src/digitize/rungs';
import type { Pt } from '../src/digitize/skeleton';
import { addShape } from '../src/model/addShape';
import { satinOf } from '../src/model/along';
import { lineStitches, resewLine } from '../src/model/line';
import { lineColumns, mirroredOrders, orderOf, ordersOf, satinLineOf, sewLineOrder, withOrder } from '../src/model/lineOrder';
import { sewObjects } from '../src/model/objects';
import { transformObjects } from '../src/model/reshape';
import { mirrorMatrix } from '../src/model/shapeOps';
import { remembered, reversedRails, sectionsOf, type Rails } from '../src/model/restitch';
import type { Pattern } from '../src/model/pattern';
import { flatten, type Mat } from '../src/shape/path';
import { parsePath } from '../src/shape/svgPath';
import { RungTool } from '../src/ui/rungTool';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const red = { r: 200, g: 30, b: 30 };
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;

/** A satin line 3 mm wide, an arc. */
const satinLine = () => addShape(empty, { form: parsePath('M0 0 C10 -10 30 -10 40 0', ID), kind: 'stroke', width: 3 }, red, null, options)!.pattern;
const take = (r: ReturnType<typeof sewLineOrder>): Pattern => r!.pattern;
const lineOf = (p: Pattern) => satinLineOf(p, sewObjects(p)[0])!;
/** Where a cut line lies along the line: a share of its left rail. */
const shareOf = (r: Rails) => r.cuts!.map(([a]) => a / cumulative(r.left).pop()!);

describe('the own order of a satin line', () => {
  it('reads back what was set on its rails, as shares along them', () => {
    const base = lineRails(flatten(parsePath('M0 0 L40 0', ID).paths[0]), false, 3);
    const edited: Rails = { ...base, cuts: [[20, 20]], plan: [{ sec: 1, flip: false, trim: false }, { sec: 0, flip: true, trim: true, mirror: true }], rungs: [[10, 12]] };
    const order = orderOf(base, edited)!;
    expect(order.cuts![0][0]).toBeCloseTo(0.5, 2);
    expect(withOrder(base, order)).toEqual({ ...edited, rungs: order.rungs!.map(([a, b]) => [a * cumulative(base.left).pop()!, b * cumulative(base.right).pop()!]), cuts: order.cuts!.map(([a, b]) => [a * cumulative(base.left).pop()!, b * cumulative(base.right).pop()!]) });
    // Nothing set: Auto.
    expect(orderOf(base, { left: base.left, right: base.right })).toBeNull();
    // Turned round in the view: sewn from the end of the line.
    expect(orderOf(base, reversedRails(base))).toEqual({ turned: true });
  });

  it('is set in the satin view and kept, without rails of its own', () => {
    const p = satinLine();
    const line = lineOf(p);
    const changes: Rails[][][] = [];
    const tool = new RungTool({ change: (c, final) => final && changes.push(c), lines: () => {}, guides: () => {}, redraw: () => {}, say: () => {}, trimMm: () => 3 });
    tool.openSatin(lineColumns(line.form, line.st).map((c) => [c]));
    tool.satin = satinOf(line.st, true);
    // A cut line across the middle of the arc.
    const c = tool.columns[0];
    const mid = (rail: Pt[]) => pointAt(rail, cumulative(rail), cumulative(rail).pop()! / 2);
    const [a, b] = [mid(c.left), mid(c.right)];
    const out = (q: Pt, from: Pt): Pt => [q[0] + (q[0] - from[0]) * 0.3, q[1] + (q[1] - from[1]) * 0.3];
    tool.setCutMode(true);
    tool.down(...out(a, b), 10);
    tool.dragTo(...out(b, a));
    tool.up();
    expect(changes.length).toBe(1);
    const sewn = take(sewLineOrder(p, 0, line, ordersOf(line.form, line.st, changes[0].map((part) => part[0])), 3));
    const known = remembered(sewn, sewObjects(sewn)[0])!;
    expect(known.columns).toBeUndefined();
    expect(known.line!.order![0]!.cuts!.length).toBe(1);
    expect(shareOf(lineColumns(known.geo!, known.line!)[0])[0]).toBeCloseTo(0.5, 1);
    // Sewn in two sections now, not as the line makes itself.
    expect(JSON.stringify(lineStitches(known.geo!, known.line!))).not.toBe(JSON.stringify(lineStitches(known.geo!, { ...known.line!, order: undefined })));
  });

  const withCut = () => {
    const p = satinLine();
    const line = lineOf(p);
    const base = lineColumns(line.form, line.st)[0];
    const at = (rail: Pt[], f: number) => cumulative(rail).pop()! * f;
    const edited = { ...base, cuts: [[at(base.left, 0.3), at(base.right, 0.3)]] as [number, number][], mirror: true };
    return take(sewLineOrder(p, 0, line, ordersOf(line.form, line.st, [edited]), 3));
  };

  it('stays at its place along the line when the line gets wider', () => {
    const p = withCut();
    const line = lineOf(p);
    const wide = resewLine(p, 0, line.form, { ...line.st, width: 6 }, 3)!.pattern;
    const known = remembered(wide, sewObjects(wide)[0])!;
    expect(known.line!.width).toBe(6);
    expect(known.line!.order).toEqual(line.st.order);
    const col = lineColumns(known.geo!, known.line!)[0];
    expect(shareOf(col)[0]).toBeCloseTo(0.3, 1);
    expect(sectionsOf(col).length).toBe(2);
  });

  it('is mirrored with the line: its sides swap', () => {
    const p = withCut();
    const before = lineOf(p).st.order!;
    const box = { minX: 0, minY: -10, maxX: 40, maxY: 0 };
    const r = transformObjects(p, [0], mirrorMatrix('y', box), 3)!;
    const known = remembered(r.pattern, sewObjects(r.pattern)[0])!;
    expect(known.line!.order).toEqual(mirroredOrders(before));
    // In sections each starts on the other rail now.
    expect(known.line!.order![0]!.plan!.map((x) => !!x.mirror)).toEqual(before[0]!.plan!.map((x) => !x.mirror));
  });

  it('goes back to Auto: the line sewn as it makes itself', () => {
    const p = withCut();
    const line = lineOf(p);
    const auto = take(sewLineOrder(p, 0, line, undefined, 3));
    const known = remembered(auto, sewObjects(auto)[0])!;
    expect(known.line!.order).toBeUndefined();
    expect(lineStitches(known.geo!, known.line!)).toEqual(lineStitches(line.form, { ...line.st, order: undefined }));
  });

  it('sews each path from where it was set to start, also when the line is sewn the other way', () => {
    const p = withCut();
    const { form, st } = lineOf(p);
    const fwd = lineStitches(form, st).flat();
    const back = lineStitches(form, st, true).flat();
    const end = flatten(form.paths[0]).pop()!;
    const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    // Forward from the start of the line; the other way round from its end, the same sections.
    expect(d(back[0], end)).toBeLessThan(d(fwd[0], end));
    expect(back.length).toBe(fwd.length);
  });
});
