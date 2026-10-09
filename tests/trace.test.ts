import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inheritTrace, placeTrace, readTrace, sizedTrace, storeTrace, traceFrom, traceOf, withTrace, TRACE_MAX_MM, TRACE_MIN_MM, TRACE_OPACITY, TRACE_OPACITY_MAX, TRACE_OPACITY_MIN, type Trace } from '../src/model/trace';
import { hoopFit } from '../src/model/hoop';
import { parsePattern } from '../src/parsers';
import { DEFAULTS } from '../src/settings';
import { decodeProject, encodeProject, onlyDesign, projectSettings } from '../src/storage/project';
import { writePattern } from '../src/writers';
import { chain, FIRST_SEED, STEPS } from './helpers/torture';

const data = new Uint8Array(readFileSync(new URL('../public/examples/cat-60mm.pes', import.meta.url)));
const cat = () => parsePattern(data, 'cat-60mm.pes');
const picture = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 8, 7, 6]);
const trace = (over: Partial<Trace> = {}): Trace => ({ name: 'katze', type: 'image/webp', data: picture, x: -40, y: -30, w: 80, h: 60, ...over });

describe('tracing image', () => {
  it('belongs to a version: a new one keeps it, the version before keeps its own', () => {
    const p = cat();
    const laid = withTrace(p, trace());
    expect(traceOf(p)).toBeNull();
    expect(traceOf(laid)).toEqual(trace());
    // The stitches are the very same: laying an image changes no record.
    expect(laid.x).toBe(p.x);
    expect(laid.cmd).toBe(p.cmd);
    const edited = { ...laid };
    inheritTrace(laid, edited);
    expect(traceOf(edited)).toBe(traceOf(laid));
    const gone = withTrace(edited, null);
    inheritTrace(edited, gone);
    expect(traceOf(gone)).toBeNull();
    expect(traceOf(edited)).not.toBeNull();
  });

  it('is laid in the middle, nine tenths of the hoop, else 100 mm wide', () => {
    expect(placeTrace(0.5, [10, 20], { w: 100, h: 100 })).toEqual({ x: -35, y: -2.5, w: 90, h: 45 });
    // Tall: the height decides.
    expect(placeTrace(2, [0, 0], { w: 100, h: 100 })).toEqual({ x: -22.5, y: -45, w: 45, h: 90 });
    expect(placeTrace(1, [0, 0], null)).toEqual({ x: -50, y: -50, w: 100, h: 100 });
  });

  it('sizes about its middle, keeping its aspect ratio and the limits', () => {
    const t = trace();
    const s = sizedTrace(t, 40);
    expect(s).toMatchObject({ x: -20, y: -15, w: 40, h: 30 });
    expect(sizedTrace(t, 0.1).h).toBeCloseTo(TRACE_MIN_MM);
    expect(sizedTrace(t, 1e9).w).toBeCloseTo(TRACE_MAX_MM);
    const tall = sizedTrace(trace({ w: 10, h: 100 }), 1e9);
    expect(tall.h).toBeCloseTo(TRACE_MAX_MM);
    expect(tall.h / tall.w).toBeCloseTo(10);
  });

  it('is read back only when usable', () => {
    expect(readTrace(storeTrace(trace(), { shown: false, locked: true, opacity: 0.3 }))).toEqual({ ...trace(), shown: false, locked: true, opacity: 0.3 });
    expect(readTrace({ ...trace(), w: 0 })).toBeNull();
    expect(readTrace({ ...trace(), x: Number.NaN })).toBeNull();
    expect(readTrace({ ...trace(), type: 'text/html' })).toBeNull();
    expect(readTrace({ ...trace(), data: new Uint8Array(0) })).toBeNull();
    expect(readTrace('nonsense')).toBeNull();
    // Older pages stored no view: shown and free.
    const { name, type, data: d, x, y, w, h } = trace();
    expect(readTrace({ name, type, data: d, x, y, w, h })).toMatchObject({ shown: true, locked: false, opacity: TRACE_OPACITY });
    // An opacity out of range is brought back into it.
    expect(readTrace({ ...trace(), opacity: 0 })!.opacity).toBe(TRACE_OPACITY_MIN);
    expect(readTrace({ ...trace(), opacity: 7 })!.opacity).toBe(TRACE_OPACITY_MAX);
    expect(readTrace({ ...trace(), opacity: 'dunkel' })!.opacity).toBe(TRACE_OPACITY);
  });

  it('comes back with a project, also with the design saved alone, and only with its design', async () => {
    const t = storeTrace(trace(), { shown: false, locked: true, opacity: 0.3 });
    const project = {
      files: [
        { name: 'cat-60mm.pes', data, acks: [], objects: [], trace: t },
        { name: 'plain.pes', data, acks: [], objects: [] },
      ],
      active: 0,
      image: null,
      settings: projectSettings(structuredClone(DEFAULTS)),
    };
    const back = await decodeProject(await encodeProject(project));
    expect(back.files[0].trace).toEqual(t);
    expect(back.files[1].trace).toBeUndefined();
    const alone = await decodeProject(await encodeProject(onlyDesign(project, 0)));
    expect(traceFrom(alone.files[0].trace!)).toEqual(trace());
  });

  it('is no part of the stitches: the hoop and the written file do not see it', () => {
    const p = cat();
    const huge = withTrace(p, trace({ x: -500, y: -500, w: 1000, h: 1000 }));
    expect(huge.bounds).toEqual(p.bounds);
    expect(hoopFit(huge.bounds, { w: 100, h: 100 })).toEqual(hoopFit(p.bounds, { w: 100, h: 100 }));
    expect(writePattern(huge, 'pes')).toEqual(writePattern(p, 'pes'));
  });
});

describe('torture test with a tracing image', () => {
  // Laid, moved, sized and removed between the ops: every edit, undo, redo, duplicate, mirror,
  // knockout and save and open keeps exactly the image laid last.
  const seeds = Array.from({ length: 12 }, (_, k) => FIRST_SEED + 500 + k);
  it.each(seeds)('chain %i keeps the tracing image', async (seed) => {
    await chain(seed, STEPS, { trace: true });
  });
});
