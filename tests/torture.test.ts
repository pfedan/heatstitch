import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { addShape } from '../src/model/addShape';
import { syncBorders } from '../src/model/border';
import { refreshKnockouts, setKnockout } from '../src/model/knockout';
import { rememberObjects, sewObjects } from '../src/model/objects';
import { COLOR_CHANGE, END, STITCH, type Pattern, type ThreadColor } from '../src/model/pattern';
import { sameColor } from '../src/model/recolor';
import { transformSewObject } from '../src/model/reshape';
import { backToVersion, forgetAll, keepVersion, remember, remembered, rememberedIn, restitch, restoreRemembered, type FillSettings, type StoredObject } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { deleteObjects, duplicateObject, mirrorMatrix, recolorObjects, subtractTop } from '../src/model/shapeOps';
import { stitchesBefore } from '../src/model/transform';
import { parsePattern } from '../src/parsers';
import { rotation, translation, type Mat } from '../src/shape/path';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { fromStored, toStored } from '../src/storage/fileStore';
import { decodeProject, encodeProject, projectSettings } from '../src/storage/project';
import { DEFAULTS } from '../src/settings';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { writePattern } from '../src/writers';
import { rng } from './helpers/images';

/**
 * The torture test: random chains of the operations the app offers on objects (add, duplicate,
 * move, turn, mirror, scale, delete, cut out, recolor, leave out, border in its own thread, undo,
 * redo, save and open the project, export), done the way the app does them, with the design's
 * invariants checked after every step. A failing chain names its seed and steps, so it can be
 * replayed and turned into a fixed regression test.
 *
 * TORTURE_CHAINS and TORTURE_STEPS run more of them (e.g. TORTURE_CHAINS=10000 for a long run).
 */

const CHAINS = Number(process.env.TORTURE_CHAINS ?? 24);
const STEPS = Number(process.env.TORTURE_STEPS ?? 14);
const FIRST_SEED = Number(process.env.TORTURE_SEED ?? 1);

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const T = options.trimMm;
const COLORS: ThreadColor[] = [
  { r: 200, g: 30, b: 30 },
  { r: 30, g: 60, b: 200 },
  { r: 30, g: 160, b: 60 },
];
const empty = { name: 'torture', format: 'dst', x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } } as unknown as Pattern;

/** What the app stores about the objects of a version (files.setObjects). */
const knowledge = (p: Pattern): StoredObject[] => rememberedIn(p, sewObjects(p));

interface Version {
  p: Pattern;
  known: StoredObject[];
}

/** One design as the app holds it: the current version, undo and redo. */
class Doc {
  undo: Version[] = [];
  redo: Version[] = [];
  cur: Version = { p: empty, known: [] };
  /** A new undo step (applyEdit). */
  commit(p: Pattern): void {
    if (p === this.cur.p) return;
    if (this.cur.p !== empty) this.undo.push(this.cur);
    this.redo = [];
    keepVersion(p);
    this.cur = { p, known: knowledge(p) };
  }
  /** The same undo step, changed (followKnockouts: record false). */
  amend(p: Pattern): void {
    keepVersion(p);
    this.cur = { p, known: knowledge(p) };
  }
  get objects() {
    return this.cur.p === empty ? [] : sewObjects(this.cur.p);
  }
}

type Rand = () => number;
const pick = <X>(r: Rand, list: readonly X[]): X => list[Math.floor(r() * list.length)];
const between = (r: Rand, a: number, b: number) => Math.round((a + r() * (b - a)) * 10) / 10;

/** After shapes changed, the app sews anew what leaves out the shapes on top, in the same step. */
function follow(d: Doc): void {
  const r = refreshKnockouts(d.cur.p, T);
  if (r) d.amend(r.pattern);
}

/** The app's takeShapes: a new version, then the knockouts follow. */
function shapes(d: Doc, next: Pattern | null | undefined): boolean {
  if (!next) return false;
  d.commit(next);
  follow(d);
  return true;
}

/** The app's commitTransform for the objects `sel`. */
function transform(d: Doc, sel: number[], m: Mat): boolean {
  let cur = d.cur.p;
  for (const o of [...sel].sort((a, b) => b - a)) {
    const kinds = stitchKinds(cur);
    const objs = sewObjects(cur, kinds);
    const r = objs[o] && transformSewObject(cur, objs, objs[o], kinds, m, T);
    if (!r) return false;
    cur = r.pattern;
  }
  return shapes(d, syncBorders(cur, T));
}

/** The app's applyRestitched for one fill with new settings (here: its border). */
function restitchFill(d: Doc, o: number, s: FillSettings, drop: Set<string>): boolean {
  const p = d.cur.p;
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const r = restitch(p, objs, [o], { kind: 'fill', s }, kinds, T);
  if (!r.starts.length) return false;
  r.starts.forEach((a, k) => rememberObjects(r.pattern, [a], r.ends[k]));
  const now = sewObjects(r.pattern);
  r.starts.forEach((a, k) => {
    const pieces = now.filter((x) => {
      const n = stitchesBefore(r.pattern, x.first);
      return n >= a && n < r.ends[k];
    });
    if (pieces.length === 1) remember(r.pattern, pieces[0], r.memory[k]);
  });
  return shapes(d, syncBorders(r.pattern, T, drop));
}

function boxOf(d: Doc, sel: number[]) {
  const objs = d.objects;
  return {
    minX: Math.min(...sel.map((o) => objs[o].minX)) / 10,
    minY: Math.min(...sel.map((o) => objs[o].minY)) / 10,
    maxX: Math.max(...sel.map((o) => objs[o].maxX)) / 10,
    maxY: Math.max(...sel.map((o) => objs[o].maxY)) / 10,
  };
}

/** Saved as a project and opened again on a fresh page; the knowledge must come back whole. */
async function saveAndOpen(d: Doc): Promise<void> {
  const data = writePattern(d.cur.p, 'dst');
  const original = parsePattern(data, 'torture.dst');
  const bytes = await encodeProject({
    files: [{ name: 'torture.dst', data, working: toStored(d.cur.p), acks: [], objects: knowledge(d.cur.p) }],
    active: 0,
    image: null,
    settings: projectSettings(structuredClone(DEFAULTS)),
  });
  forgetAll();
  const back = await decodeProject(bytes);
  const p = fromStored(original, back.files[0].working);
  expect(p, 'project opens').toBeTruthy();
  restoreRemembered(back.files[0].objects);
  // A fresh page has no undo history.
  d.undo = [];
  d.redo = [];
  keepVersion(p!);
  d.cur = { p: p!, known: d.cur.known };
}

type Op = { name: string; run: (d: Doc, r: Rand) => boolean | Promise<boolean> };

const OPS: Op[] = [
  {
    name: 'add fill',
    run: (d, r) => {
      const x = between(r, 0, 50);
      const y = between(r, 0, 50);
      const w = between(r, 6, 22);
      const h = between(r, 6, 22);
      const path = r() < 0.5 ? rectPath(x, y, w, h, 0, 0) : ellipsePath(x + w / 2, y + h / 2, w / 2, h / 2);
      const objs = d.objects;
      const after = objs.length && r() < 0.5 ? pick(r, objs).index : null;
      const a = addShape(d.cur.p, { form: parsePath(path, ID), kind: 'fill' }, pick(r, COLORS), after, options);
      return shapes(d, a?.pattern);
    },
  },
  {
    name: 'add line',
    run: (d, r) => {
      const pts = [0, 1, 2].map(() => `${between(r, 0, 60)} ${between(r, 0, 60)}`);
      const a = addShape(d.cur.p, { form: parsePath(`M${pts[0]} L${pts[1]} L${pts[2]}`, ID), kind: 'stroke', width: pick(r, [0, 2]) }, pick(r, COLORS), null, options);
      return shapes(d, a?.pattern);
    },
  },
  { name: 'duplicate', run: (d, r) => d.objects.length > 0 && shapes(d, duplicateObject(d.cur.p, pick(r, d.objects).index, T)?.pattern) },
  { name: 'move', run: (d, r) => d.objects.length > 0 && transform(d, [pick(r, d.objects).index], translation(between(r, -8, 8), between(r, -8, 8))) },
  {
    name: 'turn',
    run: (d, r) => {
      if (!d.objects.length) return false;
      const sel = [pick(r, d.objects).index];
      const b = boxOf(d, sel);
      return transform(d, sel, rotation(pick(r, [90, 45, -30]), (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2));
    },
  },
  {
    name: 'mirror',
    run: (d, r) => {
      if (!d.objects.length) return false;
      const sel = [...new Set([pick(r, d.objects).index, pick(r, d.objects).index])];
      return transform(d, sel, mirrorMatrix(pick(r, ['x', 'y'] as const), boxOf(d, sel)));
    },
  },
  {
    name: 'scale',
    run: (d, r) => {
      if (!d.objects.length) return false;
      const sel = [pick(r, d.objects).index];
      const b = boxOf(d, sel);
      const s = pick(r, [0.8, 1.25]);
      return transform(d, sel, [s, 0, 0, s, b.minX * (1 - s), b.minY * (1 - s)]);
    },
  },
  {
    name: 'delete',
    run: (d, r) => {
      if (d.objects.length < 2) return false;
      const o = pick(r, d.objects).index;
      if (process.env.TORTURE_TRACE) console.log('delete', o);
      return shapes(d, deleteObjects(d.cur.p, [o], T));
    },
  },
  {
    name: 'cut out',
    run: (d, r) => {
      if (d.objects.length < 2) return false;
      const a = pick(r, d.objects).index;
      const b = pick(r, d.objects).index;
      return a !== b && shapes(d, subtractTop(d.cur.p, [a, b], T)?.pattern);
    },
  },
  {
    name: 'recolor',
    run: (d, r) => {
      if (!d.objects.length) return false;
      // As the app: takeShapes, so what leaves out the shapes on top follows the new order.
      const o = pick(r, d.objects).index;
      const c = pick(r, COLORS);
      if (process.env.TORTURE_TRACE) console.log('recolor', o, c);
      return shapes(d, recolorObjects(d.cur.p, [o], c, T));
    },
  },
  {
    name: 'knockout',
    run: (d, r) => {
      const fills = d.objects.filter((o) => remembered(d.cur.p, o)?.form);
      if (!fills.length) return false;
      const o = pick(r, fills);
      const k = setKnockout(d.cur.p, [o.index], !remembered(d.cur.p, o)!.knockout, T);
      if (!k) return false;
      d.commit(k.pattern);
      return true;
    },
  },
  {
    name: 'border',
    run: (d, r) => {
      const fills = d.objects.filter((o) => remembered(d.cur.p, o)?.fill && !remembered(d.cur.p, o)?.asLine);
      if (!fills.length) return false;
      const o = pick(r, fills);
      const fill = remembered(d.cur.p, o)!.fill!;
      const old = fill.border?.link;
      if (old && r() < 0.4) return restitchFill(d, o.index, { ...fill, border: undefined }, new Set([old]));
      const border = { type: pick(r, ['run', 'satin'] as const), width: 2, length: 2.5, tolerance: 0.15, color: pick(r, COLORS), link: old ?? `l${Math.floor(r() * 1e9).toString(36)}` };
      return restitchFill(d, o.index, { ...fill, border }, new Set());
    },
  },
  {
    name: 'undo',
    run: (d) => {
      const prev = d.undo.pop();
      if (!prev) return false;
      d.redo.push(d.cur);
      d.cur = prev;
      backToVersion(prev.p);
      return true;
    },
  },
  {
    name: 'redo',
    run: (d) => {
      const next = d.redo.pop();
      if (!next) return false;
      d.undo.push(d.cur);
      d.cur = next;
      backToVersion(next.p);
      return true;
    },
  },
  { name: 'save and open', run: async (d) => d.cur.p !== empty && (await saveAndOpen(d), true) },
];

/** The records are a pattern the writers and the app can work with. */
function checkWellFormed(p: Pattern): void {
  const n = p.cmd.length;
  expect(p.x.length, 'x per record').toBe(n);
  expect(p.y.length, 'y per record').toBe(n);
  expect(p.cmd[n - 1], 'ends with END').toBe(END);
  expect(p.cmd.slice(0, n - 1).includes(END), 'one END').toBe(false);
  const changes = p.cmd.reduce((k, c) => k + (c === COLOR_CHANGE ? 1 : 0), 0);
  expect(p.colors.length, 'a color per block').toBe(changes + 1);
  for (let i = 0; i < n; i++) if (!Number.isFinite(p.x[i]) || !Number.isFinite(p.y[i])) throw new Error(`record ${i} not finite`);
}

/** Every object was made here, so every one remembers what it is: nothing is guessed from stitches. */
function checkAllKnown(p: Pattern): void {
  const unknown = sewObjects(p).filter((o) => !remembered(p, o)).map((o) => `${o.index} (${o.kind})`);
  expect(unknown, 'objects that forgot what they are').toEqual([]);
}

/** Each fill's border in its own thread is one object of that thread, and every border has its fill. */
function checkBorders(p: Pattern): void {
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  const problems: string[] = [];
  const fills = new Map<string, number>();
  mem.forEach((m, k) => {
    const b = m?.fill?.border;
    if (!b?.color || !b.link) return;
    if (fills.has(b.link)) problems.push(`fills ${fills.get(b.link)} and ${k} share border link ${b.link}`);
    fills.set(b.link, k);
  });
  const borders = new Map<string, number>();
  mem.forEach((m, k) => {
    if (!m?.outline) return;
    if (borders.has(m.outline)) problems.push(`objects ${borders.get(m.outline)} and ${k} are the border ${m.outline}`);
    borders.set(m.outline, k);
    const f = fills.get(m.outline);
    if (f === undefined) problems.push(`border ${k} has no fill`);
    else if (!sameColor(objs[k].color, mem[f]!.fill!.border!.color)) problems.push(`border ${k} not in its thread`);
  });
  for (const [link, k] of fills) if (!borders.has(link)) problems.push(`fill ${k} lost its border`);
  expect(problems.join('; '), 'border links').toBe('');
}

/** What leaves out the shapes on top fits the shapes on top now. */
function checkKnockouts(p: Pattern): void {
  expect(refreshKnockouts(p, T)?.changed ?? [], 'fills whose left-out parts are out of date').toEqual([]);
}

/** Exported and read back, the stitches are the same. */
function checkExport(p: Pattern): void {
  const stitches = (q: Pattern) => {
    const out: string[] = [];
    for (let i = 0; i < q.cmd.length; i++) if (q.cmd[i] === STITCH) out.push(`${q.x[i]},${q.y[i]}`);
    return out.filter((s, i) => s !== out[i - 1]);
  };
  const back = parsePattern(writePattern(p, 'pes'), 'torture.pes');
  const a = stitches(p);
  const b = stitches(back);
  const ox = Number(b[0]?.split(',')[0]) - Number(a[0]?.split(',')[0]);
  const oy = Number(b[0]?.split(',')[1]) - Number(a[0]?.split(',')[1]);
  const moved = a.map((s) => s.split(',').map(Number)).map(([x, y]) => `${x + ox},${y + oy}`);
  expect(b, 'stitches read back from PES').toEqual(moved);
}

/** The objects of `p` in a line each, to follow a chain (TORTURE_TRACE=1). */
function describeObjects(p: Pattern): string {
  return sewObjects(p)
    .map((o) => {
      const m = remembered(p, o);
      const what = !m ? 'UNKNOWN' : [m.form && 'form', m.fill && 'fill', m.path && 'line', m.knockout && 'knockout', m.fill?.border?.link && `border->${m.fill.border.link}`, m.outline && `outline=${m.outline}`].filter(Boolean).join(' ');
      return `\n  ${o.index} ${o.kind} block ${o.block} rgb(${o.color.r},${o.color.g},${o.color.b}) ${what}`;
    })
    .join('');
}

async function chain(seed: number, steps = STEPS): Promise<void> {
  forgetAll();
  const r = rng(seed);
  const d = new Doc();
  const log: string[] = [];
  const at = () => `seed ${seed}: ${log.join(' > ')}`;
  for (let step = 0; step < steps; step++) {
    const op = d.cur.p === empty ? OPS[0] : pick(r, OPS);
    let done: boolean;
    try {
      done = await op.run(d, r);
    } catch (e) {
      throw new Error(`${at()} > ${op.name} threw: ${(e as Error).stack}`);
    }
    if (!done) continue;
    log.push(op.name);
    const p = d.cur.p;
    if (process.env.TORTURE_TRACE) console.log(op.name, describeObjects(p));
    try {
      checkWellFormed(p);
      expect(knowledge(p), 'knowledge as stored with this version').toEqual(d.cur.known);
      checkAllKnown(p);
      checkBorders(p);
      checkKnockouts(p);
      if (op.name === 'save and open' || step === steps - 1) checkExport(p);
    } catch (e) {
      throw new Error(`${at()}\n${(e as Error).message}`);
    }
  }
}

describe('torture test', () => {
  const seeds = Array.from({ length: CHAINS }, (_, k) => FIRST_SEED + k);
  it.each(seeds)('chain %i keeps the design consistent', async (seed) => {
    await chain(seed);
  });
});

/** A square with a running border in a thread of its own, made as the app makes it. */
function borderedSquare(): Doc {
  forgetAll();
  const d = new Doc();
  shapes(d, addShape(empty, { form: parsePath(rectPath(0, 0, 20, 20, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
  shapes(d, addShape(d.cur.p, { form: parsePath(ellipsePath(40, 10, 6, 6), ID), kind: 'fill' }, COLORS[0], 0, options)!.pattern);
  const fill = remembered(d.cur.p, d.objects[0])!.fill!;
  restitchFill(d, 0, { ...fill, border: { type: 'run', width: 2, length: 2.5, tolerance: 0.15, color: COLORS[1], link: 'sq' } }, new Set());
  return d;
}

const borderOf = (d: Doc) => d.objects.findIndex((o) => remembered(d.cur.p, o)?.outline === 'sq');
const squareOf = (d: Doc) => d.objects.find((o) => remembered(d.cur.p, o)?.fill?.border?.link === 'sq');

describe('found by the torture test', () => {
  it('deleting a border leaves its fill without one, and undo brings both back', () => {
    const d = borderedSquare();
    const before = d.cur;
    expect(borderOf(d)).toBeGreaterThan(0);
    shapes(d, deleteObjects(d.cur.p, [borderOf(d)], T));
    expect(borderOf(d)).toBe(-1);
    expect(d.objects.every((o) => !remembered(d.cur.p, o)?.fill?.border)).toBe(true);
    checkBorders(d.cur.p);
    // The square's stitches did not change, yet the version before still knows its border.
    backToVersion(before.p);
    expect(knowledge(before.p)).toEqual(before.known);
    expect(squareOf({ cur: before, objects: sewObjects(before.p) } as unknown as Doc)).toBeTruthy();
  });

  it('deleting a fill takes its border along', () => {
    const d = borderedSquare();
    shapes(d, deleteObjects(d.cur.p, [squareOf(d)!.index], T));
    expect(borderOf(d)).toBe(-1);
    expect(d.objects).toHaveLength(1);
  });

  it('a border neither cuts nor is cut', () => {
    const d = borderedSquare();
    expect(subtractTop(d.cur.p, [0, borderOf(d)], T)).toBeNull();
    checkBorders(d.cur.p);
  });

  it('recoloring a border gives its fill that border thread', () => {
    const d = borderedSquare();
    shapes(d, recolorObjects(d.cur.p, [borderOf(d)], COLORS[2], T));
    expect(sameColor(squareOf(d)!.color, COLORS[0])).toBe(true);
    expect(sameColor(remembered(d.cur.p, squareOf(d)!)!.fill!.border!.color, COLORS[2])).toBe(true);
    checkBorders(d.cur.p);
  });

  // Chains that failed once (borders on delete, cut out and recolor; knockouts after reopening a
  // project whose curves were stored rounded): replayed with every run.
  it.each([3, 4, 9, 11, 12, 16, 18, 24])('chain %i still holds', async (seed) => {
    await chain(seed, 14);
  });
  // From the first long run (20 steps): a narrow added shape sewn as satin forgot what it was;
  // neighbours of one thread became one object after a delete or recolor between them; a copy
  // (or its border) landing on another object shared its memory; leaving out depended on what was
  // left out before.
  it.each([270, 387, 383, 130, 139, 315, 1124])('long chain %i still holds', async (seed) => {
    await chain(seed, 20);
  }, 60_000);
});

describe('versions keep what they knew', () => {
  /** A pattern of one stitch at (i, i): something else to remember. */
  const other = (i: number): Pattern => ({ ...empty, x: Int32Array.of(i, i), y: Int32Array.of(i, i), cmd: Uint8Array.of(STITCH, END), colors: [COLORS[0]] });

  it('undo brings back what memory had to forget meanwhile', () => {
    forgetAll();
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath(rectPath(0, 0, 20, 20, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
    const first = d.cur;
    // A long session: far more objects remembered than memory holds.
    for (let i = 1; i <= 1000; i++) {
      const q = other(i);
      remember(q, sewObjects(q)[0], { region: null });
    }
    expect(remembered(first.p, sewObjects(first.p)[0])).toBeUndefined();
    expect(backToVersion(first.p)).toBe(true);
    expect(knowledge(first.p)).toEqual(first.known);
  });

  it('a later version with the same stitches does not change what an earlier one knew', () => {
    forgetAll();
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath(rectPath(0, 0, 20, 20, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
    const first = d.cur;
    const o = sewObjects(first.p)[0];
    const m = remembered(first.p, o)!;
    // Same stitches, other settings (as a setting changed without new stitches).
    const same = { ...first.p };
    remember(same, o, { ...m, lock: true });
    d.commit(same);
    expect(remembered(first.p, o)?.lock).toBe(true);
    backToVersion(first.p);
    expect(remembered(first.p, o)?.lock).toBeUndefined();
    backToVersion(same);
    expect(remembered(same, o)?.lock).toBe(true);
  });
});
