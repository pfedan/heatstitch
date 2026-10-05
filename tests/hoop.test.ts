import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { biggerHoop, hoopFit, normalizeHoop } from '../src/model/hoop';
import type { Bounds } from '../src/model/pattern';
import { parsePattern } from '../src/parsers';
import { hoopRect } from '../src/render/hoop';
import { DEFAULTS, materialOf, normalizeMaterial } from '../src/settings';
import { decodeProject, encodeProject, projectSettings } from '../src/storage/project';
import { writePattern } from '../src/writers';
import { jefHoopCode } from '../src/writers/jef';
import { fileHoopOffer } from '../src/ui/hoopPanel';

/** Bounds of a design w x h mm (0.1 mm units). */
const box = (w: number, h: number, x = 0, y = 0): Bounds => ({ minX: x, minY: y, maxX: x + w * 10, maxY: y + h * 10 });
const bytesOf = (f: string) => new Uint8Array(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)));

describe('hoop fit', () => {
  it('fits, fits only turned, or sticks out by how much', () => {
    expect(hoopFit(box(120, 170), { w: 130, h: 180 })).toMatchObject({ fits: true, turned: false });
    expect(hoopFit(box(170, 120), { w: 130, h: 180 })).toMatchObject({ fits: false, turned: true });
    expect(hoopFit(box(144, 190), { w: 130, h: 180 })).toEqual({ fits: false, turned: false, overW: 14, overH: 10 });
  });

  it('suggests the smallest listed hoop that takes the design', () => {
    expect(biggerHoop(box(144, 190), { w: 130, h: 180 })).toEqual({ w: 160, h: 260 });
    expect(biggerHoop(box(400, 400), { w: 130, h: 180 })).toBeNull();
  });

  it('centers the field on the design and turns it when the design only fits that way', () => {
    expect(hoopRect(box(20, 10, 100, 200), { w: 100, h: 100 })).toEqual({ x: -30, y: -25, w: 100, h: 100, fits: true });
    expect(hoopRect(box(170, 120), { w: 130, h: 180 })).toMatchObject({ w: 180, h: 130, fits: true });
  });

  it('accepts own sizes within limits only', () => {
    expect(normalizeHoop({ w: 150.4, h: 99.6 })).toEqual({ w: 150, h: 100 });
    expect(normalizeHoop({ w: 5, h: 100 })).toBeNull();
    expect(normalizeHoop('130x180')).toBeNull();
  });
});

describe('material per design', () => {
  const fallback = materialOf(DEFAULTS);

  it('fills what is missing from the fallback and checks what is there', () => {
    const m = normalizeMaterial({ hoop: { w: 200, h: 200 }, background: 'nope' }, fallback);
    expect(m.hoop).toEqual({ w: 200, h: 200 });
    expect(m.background).toBeNull();
    expect(m.profile).toEqual(fallback.profile);
    expect(normalizeMaterial(null, fallback)).toEqual(fallback);
  });

  it('travels with each file in the project', async () => {
    const material = { ...fallback, hoop: { w: 140, h: 200 } };
    const bytes = await encodeProject({
      files: [{ name: 'cat-60mm.pes', data: bytesOf('cat-60mm.pes'), acks: [], objects: [], material }],
      active: 0,
      image: null,
      settings: projectSettings(DEFAULTS),
    });
    const back = await decodeProject(bytes);
    expect(normalizeMaterial(back.files[0].material, fallback)).toEqual(material);
  });
});

describe('hoop in saved files', () => {
  const p = parsePattern(bytesOf('cat-60mm.pes'), 'cat-60mm.pes');
  const pesHoopFlag = (data: Uint8Array) => new DataView(data.buffer).getUint16(14, true);

  it('PES names the 100 x 100 hoop for small fields, else 130 x 180', () => {
    expect(pesHoopFlag(writePattern(p, 'pes'))).toBe(1);
    expect(pesHoopFlag(writePattern(p, 'pes', { hoop: { w: 100, h: 100 } }))).toBe(0);
    expect(pesHoopFlag(writePattern(p, 'pes', { hoop: { w: 200, h: 300 } }))).toBe(1);
    expect(parsePattern(writePattern(p, 'pes', { hoop: { w: 100, h: 100 } }), 'out.pes').cmd.length).toBe(p.cmd.length);
  });

  it('JEF writes the chosen Janome hoop', () => {
    const code = (hoop: { w: number; h: number } | null) => new DataView(writePattern(p, 'jef', { hoop }).buffer).getUint32(32, true);
    expect(code({ w: 200, h: 200 })).toBe(jefHoopCode({ w: 200, h: 200 }));
    expect(code({ w: 140, h: 200 })).toBe(2);
    expect(code({ w: 130, h: 180 })).toBe(code(null)); // no Janome hoop of that size
  });
});

describe('hoop named in read files', () => {
  const fixture = (f: string) => new Uint8Array(readFileSync(new URL(`./fixtures/pyembroidery/${f}`, import.meta.url)));

  it('PES 6 and JEF name their hoop, PES 1 and DST do not', () => {
    expect(parsePattern(fixture('sun-v6.pes'), 'sun-v6.pes').hoop).toEqual({ w: 100, h: 100 });
    expect(parsePattern(fixture('sun.jef'), 'sun.jef').hoop).toEqual({ w: 50, h: 50 });
    const cat = parsePattern(bytesOf('cat-60mm.pes'), 'cat-60mm.pes');
    expect(parsePattern(writePattern(cat, 'pes'), 'out.pes').hoop).toBeUndefined();
    expect(parsePattern(bytesOf('demos/sun.dst'), 'sun.dst').hoop).toBeUndefined();
  });

  it('a JEF written for a hoop reads back with it', () => {
    const p = parsePattern(bytesOf('cat-60mm.pes'), 'cat-60mm.pes');
    expect(parsePattern(writePattern(p, 'jef', { hoop: { w: 140, h: 200 } }), 'out.jef').hoop).toEqual({ w: 140, h: 200 });
  });

  it('offers the file hoop only when it differs and the design fits it', () => {
    const b = box(60, 60);
    expect(fileHoopOffer(b, null, { w: 100, h: 100 })).toEqual({ w: 100, h: 100 });
    expect(fileHoopOffer(b, { w: 100, h: 100 }, { w: 100, h: 100 })).toBeNull();
    expect(fileHoopOffer(b, null, { w: 50, h: 50 })).toBeNull(); // a fixed size some software writes
  });
});
