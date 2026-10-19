import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Catalog, Font } from '../../src/lettering/font';
import * as rsLayout from '../../src/lettering/layout';
import * as rsSew from '../../src/lettering/sew';
import * as tsLayout from './ts/lettering/layout';
import * as tsSew from './ts/lettering/sew';
import { v8Math } from './v8math';

/**
 * Stage 5b of the Rust core: lettering. The TypeScript as it was (tests/rust/ts/lettering) and the
 * core set and sew letterings in every bundled font, on a line, bent and turned, aligned every way,
 * sewn back and forth, with letters moved by hand and letters the font lacks, and agree exactly:
 * the same layout, the same runs (with what overlapping letters leave out) and the same records.
 */

const text = (u: URL) => new TextDecoder().decode(readFileSync(u));
const catalog = JSON.parse(text(new URL('../../public/fonts/index.json', import.meta.url))) as Catalog;
const fontOf = (id: string) => JSON.parse(text(new URL(`../../public/fonts/${id}.json`, import.meta.url))) as Font;

const base = (font: Font, over: Partial<rsLayout.Lettering>): rsLayout.Lettering => ({
  ...rsLayout.LETTERING_DEFAULTS,
  id: 'L1',
  text: 'Anna',
  font: font.id,
  x: 12.5,
  y: -3.25,
  color: { r: 1, g: 2, b: 3 },
  ...over,
});

/** A text of the font's own letters, two lines, with a letter it lacks. */
function sample(chars: string, n: number): string {
  const cs = [...chars].filter((c) => c.trim());
  const pick = (k: number) => cs[(k * 7) % cs.length];
  const word = (s: number, len: number) => Array.from({ length: len }, (_, k) => pick(s + k)).join('');
  return `${word(0, Math.min(5, n))} ${word(5, 3)}\n${word(9, Math.min(4, n))}☃`;
}

/** Variants of a lettering: shapes, alignments, spacing, overrides, density and underlay. */
function variants(font: Font, t: string): rsLayout.Lettering[] {
  const ats = [...t.normalize('NFC')];
  return [
    base(font, { text: t, height: 9 }),
    base(font, { text: t, height: 14, align: 'block', back: true, spacing: 0.4, wordSpacing: 1.5, lineSpacing: 1.2 }),
    base(font, { text: t, height: 7, align: 'right', angle: 17, density: 0.8, underlay: false }),
    base(font, { text: t, height: 11, shape: 'arcUp', radius: 35, align: 'center' }),
    base(font, { text: t, height: 8, shape: 'arcDown', radius: 28, angle: -30 }),
    base(font, { text: t, height: 6, shape: 'circle', radius: 20 }),
    base(font, { text: t, height: 10, letters: [{ at: 1, ch: ats[1], dx: 0.7, dy: -0.4, rot: 12 }, { at: 3, ch: 'x', dx: 2, dy: 2, rot: 0 }] }),
  ];
}

const json = (v: unknown) => JSON.stringify(v, (_, x) => (ArrayBuffer.isView(x) ? Array.from(x as unknown as ArrayLike<number>) : x));

describe.runIf(v8Math)('stage 5b: lettering', () => {
  it('sets every font as the TypeScript did', () => {
    const off: string[] = [];
    let n = 0;
    for (const f of catalog.fonts) {
      const font = fontOf(f.id);
      for (const l of variants(font, sample(f.chars, 6))) {
        n++;
        const a = json(tsLayout.layout(font, l));
        const b = json(rsLayout.layout(font, l));
        if (a !== b) off.push(`${f.id} ${l.shape} ${l.align}: ${a.slice(0, 160)} != ${b.slice(0, 160)}`);
      }
      for (const t of ['', '\n\n', '  ', 'Straße Ǆ ﬁ é']) {
        const l = base(font, { text: t });
        if (json(tsLayout.layout(font, l)) !== json(rsLayout.layout(font, l))) off.push(`${f.id} ${JSON.stringify(t)}`);
      }
    }
    expect(n).toBeGreaterThan(250);
    expect(off).toEqual([]);
  });

  it('sews every font as the TypeScript did', () => {
    const off: string[] = [];
    let recs = 0;
    for (const f of catalog.fonts) {
      const font = fontOf(f.id);
      const vs = variants(font, sample(f.chars, 4));
      // Every font once; the variants spread over the fonts to stay quick.
      const k = catalog.fonts.indexOf(f);
      for (const l of [vs[0], vs[1 + (k % (vs.length - 1))]]) {
        const ls = tsLayout.layout(font, l);
        const lr = rsLayout.layout(font, l);
        for (const all of [false, true]) {
          const a = json(tsSew.letteringRuns(font, l, ls, all));
          const b = json(rsSew.letteringRuns(font, l, lr, all));
          if (a !== b) off.push(`${f.id} ${l.shape} runs ${all}`);
        }
        if (json(ls) !== json(lr)) off.push(`${f.id} ${l.shape} layout after runs`);
        const ts = tsSew.sewLettering(font, l, 3);
        const rs = rsSew.sewLettering(font, l, 3);
        recs += rs.recs.length;
        if (json(ts) !== json(rs)) off.push(`${f.id} ${l.shape} records ${ts.recs.length} / ${rs.recs.length}`);
      }
    }
    expect(recs).toBeGreaterThan(20_000);
    expect(off).toEqual([]);
  }, 60_000);

  it('leaves out what overlapping letters of a script hide as the TypeScript did', () => {
    const font = fontOf('auberge_marif');
    const l = base(font, { text: 'Herzlichen Glückwunsch', height: 36 });
    const ts = tsSew.sewLettering(font, l, 3);
    const rs = rsSew.sewLettering(font, l, 3);
    expect(rs.recs.length).toBeGreaterThan(1000);
    expect(json(rs)).toBe(json(ts));
  });
});
