import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addFont, type Catalog, type Font } from '../src/lettering/font';
import { followText, layout, LETTERING_DEFAULTS, missingIn, type Lettering } from '../src/lettering/layout';
import { letteringObjects, placeLettering, withoutObjects } from '../src/lettering/place';
import { letteringRuns, sewLettering } from '../src/lettering/sew';
import { letteringFrom } from '../src/lettering/stored';
import { sewObjects } from '../src/model/objects';
import { COLOR_CHANGE, END, STITCH, TRIM } from '../src/model/pattern';
import { rememberedIn, restoreRemembered } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import { writePattern } from '../src/writers';

const text = (u: URL) => new TextDecoder().decode(readFileSync(u));
const font = (id: string): Font => {
  const f = JSON.parse(text(new URL(`../public/fonts/${id}.json`, import.meta.url))) as Font;
  addFont(f);
  return f;
};
const catalog = JSON.parse(text(new URL('../public/fonts/index.json', import.meta.url))) as Catalog;

const spec = (over: Partial<Lettering> = {}): Lettering => ({
  ...LETTERING_DEFAULTS,
  id: 'L1',
  text: 'Anna',
  font: 'barstitch_regular',
  x: 0,
  y: 0,
  color: { r: 200, g: 20, b: 40 },
  ...over,
});

const stitchCount = (cmd: Uint8Array) => cmd.reduce((a, c) => a + (c === STITCH ? 1 : 0), 0);

describe('font catalog', () => {
  it('lists only fonts that may be shipped, each with its file and license', () => {
    expect(catalog.fonts.length).toBeGreaterThan(30);
    for (const f of catalog.fonts) {
      expect(['OFL-1.1', 'Public Domain', 'CC-BY-4.0']).toContain(f.license);
      expect(text(new URL(`../public/fonts/licenses/${f.id}.txt`, import.meta.url)).length).toBeGreaterThan(50);
      expect(f.good[0]).toBeLessThan(f.good[1]);
    }
  });

  it('takes the rails of a satin as the font has them, not a rung across a dot', () => {
    // A round dot is two half circles with one rung across, and the rung is the longest of the
    // three; taken as a rail, it crosses the other rail and the dot is sewn as a wedge.
    const pairsOf = (a: number[]) => a.flatMap((_, k) => (k % 2 || k + 3 >= a.length ? [] : [[a[k], a[k + 1], a[k + 2], a[k + 3]]]));
    const side = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const cross = (l: number[], r: number[]) =>
      pairsOf(l).some(([ax, ay, bx, by]) =>
        pairsOf(r).some(([cx, cy, dx, dy]) => side(cx, cy, dx, dy, ax, ay) * side(cx, cy, dx, dy, bx, by) < 0 && side(ax, ay, bx, by, cx, cy) * side(ax, ay, bx, by, dx, dy) < 0),
      );
    const crossed: string[] = [];
    for (const entry of catalog.fonts) {
      const f = font(entry.id);
      for (const ch of 'i.') for (const e of f.glyphs[ch]?.e ?? []) if (e.k === 's' && cross(e.l, e.r)) crossed.push(`${entry.id} ${ch}`);
    }
    expect(crossed).toEqual([]);
  });
});

describe('layout', () => {
  const f = font('barstitch_regular');

  it('sets the capitals at the height asked for', () => {
    const lay = layout(f, spec({ text: 'H', height: 12 }));
    const [a, , c] = lay.letters[0].box;
    const g = f.glyphs.H;
    expect((g.y1 - g.y0) * lay.scale).toBeCloseTo(12, 0);
    expect(c[1] - a[1]).toBeCloseTo((g.y1 - g.y0) * lay.scale, 5);
  });

  it('starts a left aligned line at the anchor and centers a centered one', () => {
    const left = layout(f, spec({ text: 'Anna', x: 50 }));
    expect(left.minX).toBeCloseTo(50, 5);
    const mid = layout(f, spec({ text: 'Anna', x: 50, align: 'center' }));
    expect((mid.minX + mid.maxX) / 2).toBeCloseTo(50, 5);
  });

  it('puts lines below each other and spreads block lines to the same width', () => {
    const lay = layout(f, spec({ text: 'Anna und Ben\nTom', align: 'block' }));
    const l0 = lay.letters.filter((p) => p.line === 0);
    const l1 = lay.letters.filter((p) => p.line === 1);
    expect(l1[0].box[0][1]).toBeGreaterThan(l0[0].box[0][1]);
  });

  it('turns the letters on an arc', () => {
    const lay = layout(f, spec({ text: 'ABCDE', shape: 'arcUp', radius: 30, height: 8 }));
    const first = lay.letters[0];
    const last = lay.letters[lay.letters.length - 1];
    // Left letters lean left, right ones right; the middle is highest.
    expect(Math.atan2(first.m[1], first.m[0])).toBeLessThan(0);
    expect(Math.atan2(last.m[1], last.m[0])).toBeGreaterThan(0);
  });

  it('knows which letters are missing', () => {
    const tt = font('tt_masters');
    expect(missingIn(tt, 'Anna ß')).toEqual(missingIn(tt, 'ß'));
    expect(missingIn(f, 'Grüße')).toEqual([]);
  });

  it('moves letter overrides along when the text changes', () => {
    const moved = followText('Anna', 'Hanna', [{ at: 0, ch: 'A', dx: 1, dy: 0, rot: 0 }, { at: 3, ch: 'a', dx: 0, dy: 1, rot: 5 }]);
    expect(moved).toEqual([{ at: 4, ch: 'a', dx: 0, dy: 1, rot: 5 }]);
    expect(followText('Anna', 'Annas', [{ at: 1, ch: 'n', dx: 1, dy: 0, rot: 0 }])[0].at).toBe(1);
  });
});

describe('sewing', () => {
  const f = font('barstitch_regular');

  it('sews a word as stitches with locks and a trim at the end', () => {
    const s = sewLettering(f, spec({ height: 10 }), 3);
    expect(s.stitches).toBeGreaterThan(100);
    expect(s.recs[s.recs.length - 1].cmd).toBe(TRIM);
    // No needle point far from the letters.
    for (const r of s.recs) {
      expect(r.x / 10).toBeGreaterThan(s.layout.minX - 2);
      expect(r.x / 10).toBeLessThan(s.layout.maxX + 2);
    }
  });

  it('keeps the satin density at any height', () => {
    const small = sewLettering(f, spec({ text: 'I', height: 8 }), 3).stitches;
    const big = sewLettering(f, spec({ text: 'I', height: 24 }), 3).stitches;
    // Three times as tall: about three times the stitches along the column, not the same number.
    expect(big / small).toBeGreaterThan(2);
  });

  it('trims between words', () => {
    const s = sewLettering(f, spec({ text: 'A B' }), 100);
    expect(s.recs.filter((r) => r.cmd === TRIM).length).toBe(2);
    expect(s.starts.length).toBe(2);
  });

  it('ends each satin where the font goes on, so a letter needs few trims', () => {
    const roman = font('roman_ags');
    const runs = letteringRuns(roman, spec({ font: 'roman_ags', text: 'A', height: 15 }));
    const gaps = runs.slice(1).map((r, k) => Math.hypot(r.pts[0][0] - runs[k].pts[runs[k].pts.length - 1][0], r.pts[0][1] - runs[k].pts[runs[k].pts.length - 1][1]));
    expect(Math.max(...gaps)).toBeLessThan(3);
  });

  it('sews every font that is shipped', () => {
    for (const e of catalog.fonts) {
      const ff = font(e.id);
      const s = sewLettering(ff, spec({ font: e.id, text: e.cases === 'a' ? 'ab' : 'AB', height: e.cap }), 3);
      expect(s.stitches, e.id).toBeGreaterThan(20);
    }
  });
});

describe('placing', () => {
  const f = font('barstitch_regular');

  it('makes a new design of a lettering', () => {
    const l = spec();
    const placed = placeLettering(null, [], sewLettering(f, l, 3), l)!;
    expect(placed.pattern.cmd[placed.pattern.cmd.length - 1]).toBe(END);
    expect(placed.pattern.colors).toEqual([l.color]);
    expect(placed.objects.length).toBeGreaterThan(0);
    expect(letteringObjects(placed.pattern, sewObjects(placed.pattern), l.id).length).toBe(placed.objects.length);
  });

  it('is one object, also with trims between its words', () => {
    const l = spec({ text: 'Anna und Ben' });
    const placed = placeLettering(null, [], sewLettering(f, l, 3), l)!;
    expect(placed.objects.length).toBe(1);
    expect(sewObjects(placed.pattern).length).toBe(1);
  });

  it('takes the letters out again, all its jumps and trims with them', () => {
    const p = parsePattern(readFileSync(new URL('../public/examples/cat-60mm.pes', import.meta.url)), 'cat.pes');
    const l = spec({ x: 0, y: 40 });
    const a = placeLettering(p, [], sewLettering(f, l, 3), l)!;
    const b = withoutObjects(a.pattern, a.objects)!;
    expect(stitchCount(b.cmd)).toBe(stitchCount(p.cmd));
    expect(b.colors.length).toBe(p.colors.length);
    // A design of the lettering alone keeps it: nothing would be left.
    const alone = placeLettering(null, [], sewLettering(f, l, 3), l)!;
    expect(withoutObjects(alone.pattern, alone.objects)).toBeNull();
  });

  it('adds a lettering in another color as its own block and replaces it in place', () => {
    const p = parsePattern(readFileSync(new URL('../public/examples/cat-60mm.pes', import.meta.url)), 'cat.pes');
    const blocks = p.colors.length;
    const l = spec({ x: 0, y: 40 });
    const a = placeLettering(p, [], sewLettering(f, l, 3), l)!;
    expect(a.pattern.colors.length).toBe(blocks + 1);
    expect(a.pattern.cmd.filter((c) => c === COLOR_CHANGE).length).toBe(blocks);
    const before = stitchCount(p.cmd);
    expect(stitchCount(a.pattern.cmd)).toBeGreaterThan(before);
    // New text: the old letters go, the new ones come in their place.
    const l2 = { ...l, text: 'Ben' };
    const old = letteringObjects(a.pattern, sewObjects(a.pattern), l.id);
    const b = placeLettering(a.pattern, old, sewLettering(f, l2, 3), l2)!;
    expect(b.pattern.colors.length).toBe(blocks + 1);
    expect(stitchCount(b.pattern.cmd)).toBe(before + sewLettering(f, l2, 3).stitches);
    expect(letteringObjects(b.pattern, sewObjects(b.pattern), l.id).every((o) => o.block === blocks)).toBe(true);
  });

  it('survives saving: PES bytes and what the objects remember', () => {
    const l = spec({ text: 'Tom' });
    const placed = placeLettering(null, [], sewLettering(f, l, 3), l)!;
    const stored = JSON.parse(JSON.stringify(rememberedIn(placed.pattern, sewObjects(placed.pattern))));
    const back = parsePattern(writePattern(placed.pattern, 'pes'), 'x.pes');
    restoreRemembered(stored);
    const found = letteringObjects(back, sewObjects(back), l.id);
    expect(found.length).toBe(placed.objects.length);
    expect(letteringFrom(stored[0].lettering)).toEqual(l);
  });
});
