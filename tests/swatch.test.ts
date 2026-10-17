import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Font } from '../src/lettering/font';
import { sewObjects } from '../src/model/objects';
import { STITCH } from '../src/model/pattern';
import { remembered } from '../src/model/restitch';
import { SWATCH_CELL, SWATCH_FONT, cellAt, swatchGrid, testSwatch } from '../src/model/swatch';
import { digitizeDefaults, pullFor } from '../src/digitize/digitize';
import { recommendedSpacing, type Profile } from '../src/validation/profiles';
import { chain } from './helpers/torture';
import { setOwn, setProfile, withOwn, applyMaterial, materialOf, DEFAULTS } from '../src/settings';

const font = JSON.parse(readFileSync(new URL(`../public/fonts/${SWATCH_FONT}.json`, import.meta.url), 'utf8')) as Font;
const fmt = (v: number, d: number) => v.toFixed(d).replace('.', ',');
const terry: Profile = { fabric: 'terry', thread: '40' };

describe('test swatch', () => {
  it('centres the spacing on the fabric default and steps the pull from none', () => {
    const g = swatchGrid({ fabric: 'woven', thread: '40' }, 'fill');
    expect(g.spacings[2]).toBe(0.36);
    expect(g.spacings[0]).toBeLessThan(g.spacings[1]);
    expect(g.pulls).toEqual([0, 0.1, 0.2, 0.3]);
    expect(swatchGrid(terry, 'fill').pulls).toEqual([0, 0.2, 0.4, 0.6]);
    // Measured values never move the grid, so a swatch stitched once keeps matching the picker.
    expect(swatchGrid({ ...terry, own: { fill: { spacing: 0.45, pull: 0.6 } } }, 'fill')).toEqual(swatchGrid(terry, 'fill'));
  });

  for (const kind of ['fill', 'satin'] as const) {
    it(`sews a ${kind} cell per value pair, labels and nominal edges, and fits a 100 mm hoop`, () => {
      const p = testSwatch(terry, kind, font, fmt, { cells: 'Felder', edge: 'Sollkante' }, 3);
      const g = swatchGrid(terry, kind);
      const objs = sewObjects(p);
      const mem = objs.map((o) => remembered(p, o));
      const cells = mem.filter((m) => (kind === 'fill' ? m?.fill : m?.line?.type === 'satin'));
      expect(cells).toHaveLength(g.spacings.length * g.pulls.length);
      expect(mem.filter((m) => m?.lettering)).toHaveLength(g.spacings.length + g.pulls.length);
      expect(mem.filter((m) => m?.line?.type === 'run')).toHaveLength(g.spacings.length * g.pulls.length * (kind === 'fill' ? 1 : 2));
      expect(p.colors).toHaveLength(2);
      const b = p.bounds;
      expect((b.maxX - b.minX) / 10).toBeLessThan(95);
      expect((b.maxY - b.minY) / 10).toBeLessThan(95);
      // Every cell's stitches stay near its cell.
      const [x0, y0] = cellAt(0, 0);
      expect(b.minX / 10).toBeLessThan(x0);
      expect(b.minY / 10).toBeLessThan(y0);
      expect(p.cmd.filter((c) => c === STITCH).length).toBeGreaterThan(1000);
      if (kind === 'satin') {
        const sat = cells.map((m) => m!.line!);
        expect(sat.map((s) => s.spacing)).toContain(g.spacings[0]);
        expect(new Set(sat.map((s) => s.pull))).toEqual(new Set(g.pulls));
      } else {
        const spacings = new Set(cells.map((m) => m!.fill!.spacing));
        expect(spacings).toEqual(new Set(g.spacings));
      }
      expect(SWATCH_CELL).toBe(12);
    });
  }

  it('makes measured values the defaults of new objects for that fabric and thread only', () => {
    const s = structuredClone(DEFAULTS);
    setProfile(s, terry);
    const before = digitizeDefaults(s.profile);
    setOwn(s, { fill: { spacing: 0.45, pull: 0.6 }, satin: { spacing: 0.4, pull: 0.2 } });
    const after = digitizeDefaults(s.profile);
    expect(after.spacing).toBe(0.45);
    expect(after.satinSpacing).toBe(0.4);
    expect(after.pull).toBe(0.6);
    expect(after.satinPull).toBe(0.2);
    expect(recommendedSpacing(s.profile)[0]).toBe(0.45);
    expect(pullFor(s.profile, 'satin').edge).toBe(0.1);
    expect(before.spacing).not.toBe(0.45);
    // Another fabric does not get them; coming back does.
    setProfile(s, { fabric: 'woven', thread: '40' });
    expect(s.profile.own).toBeUndefined();
    setProfile(s, terry);
    expect(s.profile.own?.fill?.spacing).toBe(0.45);
    // They belong to the browser: a design's material leaves them out, applying it puts them back.
    const m = materialOf(s);
    expect(m.profile.own).toBeUndefined();
    applyMaterial(s, m);
    expect(s.profile.own?.fill?.pull).toBe(0.6);
    // Forgetting them goes back to the fabric's values.
    setOwn(s, undefined);
    expect(digitizeDefaults(s.profile)).toEqual(before);
    expect(withOwn(terry, {})).toEqual(terry);
  });
});

describe('test swatch in a design', () => {
  // A swatch is plain objects (fills or satin lines, running stitch edges, lettering): it goes
  // through duplicate, mirror, knockout, undo and save and open like any design.
  it('survives a chain of edits', async () => {
    await chain(11, 12, { motif: true, motifShare: 0.3, motifOp: 'put in a test swatch' });
  }, 600_000);
});
