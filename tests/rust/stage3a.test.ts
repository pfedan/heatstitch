import { describe, expect, it } from 'vitest';
import * as rsFill from '../../src/digitize/fill';
import * as rsFlow from '../../src/digitize/flow';
import * as rsSpiral from '../../src/digitize/spiral';
import * as rsDeco from '../../src/digitize/deco';
import * as rsBorder from '../../src/digitize/border';
import * as rsEcho from '../../src/digitize/echo';
import * as rsMotif from '../../src/digitize/motif';
import * as rsRedwork from '../../src/digitize/redwork';
import { buildRegion } from '../../src/digitize/region';
import { skeleton } from '../../src/digitize/skeleton';
import { inside } from '../../src/digitize/rungs';
import type { Orientation } from '../../src/image/orientation';
import * as tsFill from './ts/fills/fill';
import * as tsFlow from './ts/fills/flow';
import * as tsSpiral from './ts/fills/spiral';
import * as tsDeco from './ts/fills/deco';
import * as tsBorder from './ts/fills/border';
import * as tsEcho from './ts/fills/echo';
import * as tsMotif from './ts/fills/motif';
import * as tsRedwork from './ts/fills/redwork';

/**
 * Stage 3a of the Rust core: the fills (tatami with all its options, crosshatch, flow and field
 * fills, contour and spiral, the decorative and open patterns), borders, echoes, motif lines and
 * redwork. The TypeScript as it was (tests/rust/ts/fills) and the Rust core run on the same areas
 * and lines and agree exactly. That needs the core's sin, cos and pow to round like Node's
 * (core/src/trig.rs): with WebAssembly's own a last bit differs for about 1% of angles, and a
 * streamline of a few hundred steps then ends a few thousandths of a millimetre apart.
 */

type Pt = [number, number];
const PX = 0.15;
const W = 200;
/** The shapes below are drawn on 40 mm and shrunk to 30 mm, which keeps this test fast. */
const S = 0.75;

function comp(f: (x: number, y: number) => boolean) {
  const map = new Int32Array(W * W);
  const labels = new Uint8Array(W * W).fill(2);
  let [minX, minY, maxX, maxY] = [W, W, 0, 0];
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (!f(((x + 0.5) * PX) / S, ((y + 0.5) * PX) / S)) continue;
      map[y * W + x] = 1;
      labels[y * W + x] = 1;
      [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
    }
  }
  return buildRegion(map, labels, W, 1, 1, { minX, minY, maxX, maxY }, W, PX, 0.3, (l) => l === 2);
}

const star = (cx: number, cy: number, size: number): Pt[] => {
  const R = size / 2 / Math.cos((18 * Math.PI) / 180);
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.382 * R : R;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt;
  });
};
const U: Pt[] = [[4, 4], [36, 4], [36, 30], [26, 30], [26, 13], [14, 13], [14, 30], [4, 30]];
const blob = (x: number, y: number) => {
  const a = Math.atan2(y - 20, x - 20);
  return Math.hypot(x - 20, y - 20) < 14 + 3 * Math.cos(3 * a) && Math.hypot(x - 24, y - 17) > 3;
};

const AREAS: [string, (x: number, y: number) => boolean][] = [
  ['star', (x, y) => inside(star(20, 20, 32), [x, y])],
  ['U', (x, y) => inside(U, [x, y])],
  ['blob with a hole', blob],
  ['dumbbell', (x, y) => Math.hypot(x - 10, y - 20) < 7 || Math.hypot(x - 30, y - 20) < 7 || (Math.abs(y - 20) < 2 && x > 10 && x < 30)],
];

/** Largest difference between two results; Infinity where their shapes differ. */
function diff(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a === b || (Number.isNaN(a) && Number.isNaN(b)) ? 0 : Math.abs(a - b) || Infinity;
  if (a === b) return 0;
  if (a == null || b == null) return Infinity;
  if (Array.isArray(a) || ArrayBuffer.isView(a)) {
    const [x, y] = [a as ArrayLike<unknown>, b as ArrayLike<unknown>];
    if (x.length !== y.length) return Infinity;
    let m = 0;
    for (let i = 0; i < x.length; i++) m = Math.max(m, diff(x[i], y[i]));
    return m;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    let m = 0;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      // The field's grid is a class in TypeScript, a plain record from the core.
      if (k === 'g') continue;
      const [va, vb] = [(a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]];
      // Open patterns had no travel list, the core gives an empty one.
      if (va === undefined && Array.isArray(vb) && !vb.length) continue;
      m = Math.max(m, diff(va, vb));
    }
    return m;
  }
  return Infinity;
}

/** What differed, collected over one test so a failure names every case. */
let off: string[] = [];
const same = (what: string, ts: unknown, rs: unknown) => {
  const d = diff(ts, rs);
  if (d > 0) off.push(`${what}: ${d}`);
};
const check = (f: () => void) => () => {
  off = [];
  f();
  expect(off).toEqual([]);
};

const BASE: tsFill.FillParams = { spacing: 0.4, stitch: 3, angle: null, pull: 0.2, underlay: true };
const FILLS: [string, Partial<tsFill.FillParams>][] = [
  ['plain', {}],
  ['at 30 degrees, crossed underlay with an edge run', { angle: 30, underCross: true, underEdge: true }],
  ['row ends along the edge, off row ends, trims saved', { angle: 10, rowEnds: 'edge', offRowEnds: true, saveTrims: true }],
  ['gradient', { angle: 60, spacingEnd: 1.2, underlay: false }],
  ['gap rows, inset by share', { angle: 90, gapRows: 2, underInsetShare: 0.2 }],
  ['embossed', { angle: 20, emboss: { motif: 'stars', size: 8, strong: true, angle: 15 } }],
  ['texture', { angle: 0, texture: { kind: 'herringbone', size: 12 } }],
  ['fading', { angle: 45, fade: 'out', underlay: false }],
  ['waves', { angle: 15, wave: { height: 1.5, length: 8 } }],
  ['ending near a point', { angle: 75, end: [35, 35], offset: 0.1 }],
];
const OPEN: rsDeco.OpenParams = { size: 2.5, stitch: 2.5, seed: 7, triple: false, angle: 20 };

describe('stage 3a: TypeScript and Rust agree', () => {
  for (const [name, f] of AREAS) {
    describe(name, () => {
      const r = comp(f);
      const start: Pt = [r.x0 * PX, r.y0 * PX];

      it('tatami fills, crosshatch, angle and underlay area', check(() => {
        for (const [what, o] of FILLS) same(`fillRegion ${what}`, tsFill.fillRegion(r, { ...BASE, ...o }, start), rsFill.fillRegion(r, { ...BASE, ...o }, start));
        // Part of a larger area that travels the whole's way.
        const p = { ...BASE, angle: 40, whole: r, travel: r };
        same('fillRegion as a part', tsFill.fillRegion(r, p, start, [45]), rsFill.fillRegion(r, p, start, [45]));
        const x = { ...BASE, angle: 10, spacing: 1.5 };
        same('crosshatchFill', tsFill.crosshatchFill(r, x, start), rsFill.crosshatchFill(r, x, start));
        same('chooseAngle', tsFill.chooseAngle(r, 0.4, [0, 90]), rsFill.chooseAngle(r, 0.4, [0, 90]));
        for (const share of [undefined, 0.15]) {
          const [a, b] = [tsFill.underlayArea(r, 0.4, share), rsFill.underlayArea(r, 0.4, share)];
          same(`underlayArea ${share}`, [a?.mask, a?.sdf], [b?.mask, b?.sdf]);
        }
      }));

      it('contour, spiral and field fills', check(() => {
        same('contourFill', tsFlow.contourFill(r, BASE, start), rsFlow.contourFill(r, BASE, start));
        same('spiralFill', tsSpiral.spiralFill(r, BASE, start), rsSpiral.spiralFill(r, BASE, start));
        const [ft, fr] = [tsFlow.contourField(r), rsFlow.contourField(r)];
        same('contourField', ft, fr);
        same('fieldFill along contours', tsFlow.fieldFill(r, ft.g, ft, BASE, start, true, 3), rsFlow.fieldFill(r, fr.g, fr, BASE, start, true, 3));
        const guide: Pt[] = [[0, 10], [15, 18], [40, 12]];
        const [gt, gr] = [tsFlow.guideField(r, [guide]), rsFlow.guideField(r, [guide])];
        same('guideField', gt, gr);
        const graded = { ...BASE, spacingEnd: 0.8 };
        same('fieldFill along a guide', tsFlow.fieldFill(r, gt.g, gt, graded, start, false, 3), rsFlow.fieldFill(r, gr.g, gr, graded, start, false, 3));
        const rows: [Pt, Pt][] = [[[5, 5], [35, 30]], [[5, 30], [35, 10]]];
        const [st, sr] = [tsFlow.stitchField(r, rows), rsFlow.stitchField(r, rows)];
        same('stitchField', st, sr);
        same('fieldFill along stitch rows', tsFlow.fieldFill(r, st.g, st, BASE, start, false, 3), rsFlow.fieldFill(r, sr.g, sr, BASE, start, false, 3));
      }));

      it('flow fill along the image', check(() => {
        // A swirling structure over the picture.
        const orient: Orientation = { width: W, height: W, c: new Float32Array(W * W), s: new Float32Array(W * W) };
        for (let y = 0; y < W; y++) {
          for (let x = 0; x < W; x++) {
            const t = Math.atan2(y - W / 2, x - W / 2) + Math.PI / 2;
            orient.c[y * W + x] = 0.8 * Math.cos(2 * t);
            orient.s[y * W + x] = 0.8 * Math.sin(2 * t);
          }
        }
        const g = skeleton(r);
        same('flowFill', tsFlow.flowFill(r, g, orient, BASE, start), rsFlow.flowFill(r, g, orient, BASE, start));
      }));

      it('decorative fields and fills', check(() => {
        const box = rsDeco.regionBox(r);
        const focus = rsDeco.atShare(box, [0.4, 0.6]);
        const fields: [string, () => unknown, () => unknown][] = [
          ['grain', () => tsDeco.grainField(r, 30, 0.6, 3), () => rsDeco.grainField(r, 30, 0.6, 3)],
          ['ray', () => tsDeco.rayField(r, focus), () => rsDeco.rayField(r, focus)],
          ['circle', () => tsDeco.circleField(r, focus), () => rsDeco.circleField(r, focus)],
          ['swirl', () => tsDeco.swirlField(r, 5), () => rsDeco.swirlField(r, 5)],
        ];
        for (const [what, ts, rs] of fields) {
          const [a, b] = [ts() as tsFlow.DirField, rs() as rsFlow.DirField];
          same(`${what}Field`, a, b);
          same(`fieldFill along ${what}`, tsFlow.fieldFill(r, a.g, a, BASE, start, true, 3), rsFlow.fieldFill(r, b.g, b, BASE, start, true, 3));
        }
        same('waveFill', tsDeco.waveFill(r, BASE, 20, 1.2, 9, start), rsDeco.waveFill(r, BASE, 20, 1.2, 9, start));
        const z = { angle: 10, height: 2, wave: [0.9, 0.3] as Pt, phase: 0.5 };
        const wide = { ...BASE, spacing: 1 };
        same('zigzagFill', tsDeco.zigzagFill(r, wide, z, start), rsDeco.zigzagFill(r, wide, z, start));
        same('meanderFill', tsDeco.meanderFill(r, OPEN, start), rsDeco.meanderFill(r, OPEN, start));
        const triple = { ...OPEN, triple: true };
        same('mazeFill', tsDeco.mazeFill(r, triple, start), rsDeco.mazeFill(r, triple, start));
        same('echoFill', tsDeco.echoFill(r, OPEN, start), rsDeco.echoFill(r, OPEN, start));
        for (const k of tsDeco.GRID_KINDS) same(`gridFill ${k}`, tsDeco.gridFill(r, OPEN, k, start), rsDeco.gridFill(r, OPEN, k, start));
        const big = { ...OPEN, size: 4 };
        for (const fig of tsDeco.FIGURES) same(`motifFill ${fig}`, tsDeco.motifFill(r, big, fig, start), rsDeco.motifFill(r, big, fig, start));
        const shifted = { ...OPEN, origin: [0.3, 0.7] as Pt };
        for (const k of tsDeco.CROSS_KINDS) same(`crossFill ${k}`, tsDeco.crossFill(r, shifted, k, start), rsDeco.crossFill(r, shifted, k, start));
      }));

      it('borders', check(() => {
        for (const by of [0, 0.8, -0.6]) same(`borderLoops ${by}`, tsBorder.borderLoops(r, by), rsBorder.borderLoops(r, by));
        const keep = (q: Pt) => q[0] > 15;
        for (const l of tsBorder.borderLoops(r)) {
          same('borderRails', tsBorder.borderRails(r, l, 2, 0.3), rsBorder.borderRails(r, l, 2, 0.3));
          same('keptRails', tsBorder.keptRails(r, l, 3, -0.5, keep), rsBorder.keptRails(r, l, 3, -0.5, keep));
          same('lineRails', tsBorder.lineRails(l, true, 1.5), rsBorder.lineRails(l, true, 1.5));
          for (const t of [1, 3, 5]) same(`borderRun ${t}`, tsBorder.borderRun(l, t), rsBorder.borderRun(l, t));
        }
      }));
    });
  }

  const LINES: [string, Pt[], boolean][] = [
    ['open curve', Array.from({ length: 60 }, (_, i) => [i * 0.5, 10 + 4 * Math.sin(i / 6)] as Pt), false],
    ['zigzag', [[0, 0], [8, 6], [14, 0], [22, 7], [30, 1]], false],
    ['closed star', [...star(20, 20, 24), star(20, 20, 24)[0]], true],
  ];

  it('echoes, motif lines, line rails', check(() => {
    for (const [name, l, closed] of LINES) {
      for (const side of tsEcho.ECHO_SIDES) {
        for (const e of [{ side, count: 3, gap: 1.5 }, { side, count: 2, gap: 0.8, reverse: true, only: [2] }, { side, count: 2, gap: 0 }]) {
          for (const returns of [false, true]) same(`echoLines ${name} ${JSON.stringify(e)}`, tsEcho.echoLines(l, closed, e, 0.2, returns), rsEcho.echoLines(l, closed, e, 0.2, returns));
        }
      }
      for (const m of tsMotif.LINE_MOTIFS) {
        for (const shift of [0, 0.3]) {
          same(`motifStitches ${name} ${m}`, tsMotif.motifStitches(l, closed, m, 3, 4, 1, shift), rsMotif.motifStitches(l, closed, m, 3, 4, 1, shift));
          same(`motifStitches ${name} ${m} layered`, tsMotif.motifStitches(l, closed, m, 2, 2.5, -1, shift, 1, 2, true), rsMotif.motifStitches(l, closed, m, 2, 2.5, -1, shift, 1, 2, true));
        }
      }
      same(`lineRails ${name}`, tsBorder.lineRails(l, closed, 2), rsBorder.lineRails(l, closed, 2));
    }
  }));

  it('redwork', check(() => {
    const lines: tsRedwork.RedworkLine[] = [
      { pts: [[0, 10], [30, 10]], closed: false },
      { pts: [[10, 0], [10, 25], [20, 25]], closed: false },
      { pts: [[20, 10.3], [20, 20]], closed: false },
      { pts: star(25, 20, 12), closed: true },
      { pts: [[40, 0], [45, 5]], closed: false },
    ];
    const stitch = (pts: Pt[]) => tsBorder.borderRun(pts, 1);
    for (const snap of [0, 0.5, 1]) {
      const g = tsRedwork.redworkGraph(lines, snap);
      same(`redworkGraph ${snap}`, g, rsRedwork.redworkGraph(lines, snap));
      same(`redworkWalks ${snap}`, tsRedwork.redworkWalks(g), rsRedwork.redworkWalks(g));
      same(`redworkWalks ${snap} from a point`, tsRedwork.redworkWalks(g, [44, 6]), rsRedwork.redworkWalks(g, [44, 6]));
      same(`redworkRuns ${snap}`, tsRedwork.redworkRuns(lines, stitch, [0, 0], snap, true), rsRedwork.redworkRuns(lines, stitch, [0, 0], snap, true));
    }
  }));
});
