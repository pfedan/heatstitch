import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sewObjects } from '../src/model/objects';
import { transformObjects } from '../src/model/reshape';
import { sewDesign } from '../src/model/sew';
import { scaling } from '../src/shape/path';
import { designs, hashOf } from './helpers/exampleDesigns';

/**
 * Whole designs sewn anew from their objects, as they are and scaled to 110 %, give the stitches
 * recorded in tests/fixtures/sew-hashes.json (recorded with the TypeScript before the sewing moved
 * to the Rust core, unchanged since but for svg fliegenpilz-quelle at 110 %: its 265 mm area,
 * grown past MAX_AREA_PX, is rastered in coarser pixels). A change that moves stitches on purpose
 * records them anew: SEW_HASHES_ALL=1 SEW_HASHES_OUT=<file> writes every design's hashes and times there. By default
 * a quick share of the designs; SEW_HASHES_ALL=1 takes all of public/examples (about two minutes).
 *
 * The stitches come from the core alone, whose sin, cos and pow are its own (core/src/trig.rs), so
 * the hashes are the same on every platform: with Math.sin, cos, pow and atan2 off by one ulp for
 * half the inputs, as another system's libm might give, all designs still matched.
 */

const expected = JSON.parse(readFileSync('tests/fixtures/sew-hashes.json', 'utf8')) as Record<string, { sew: string; scaled: string }>;

/** Designs sewn in a few seconds, with lines, borders, satins, appliqués, fills and files of every kind. */
const QUICK = new Set(['Blume', 'Musterkarte Offen', 'Linienstiche', 'Linien mit Parametern', 'Handstiche', 'Linieneffekte', 'Redwork', 'Satinflächen', 'Applikation', 'demos/confetti.pes', 'demos/overlap.pes', 'demos/sun.dst', 'svg kirschen', 'svg abzeichen', 'svg apfel', 'svg blumenzweig', 'svg overlapping-circles']);
const all = process.env.SEW_HASHES_ALL === '1';

describe('whole designs sewn anew', () => {
  it(
    'give the stitches they gave before, as they are and at 110 %',
    async () => {
      const list = await designs((name) => all || QUICK.has(name));
      expect(list.length).toBe(all ? Object.keys(expected).length : QUICK.size);
      const got: Record<string, { sew: string; scaled: string; sewMs: number; scaleMs: number }> = {};
      for (const { name, pattern: p } of list) {
        const objs = sewObjects(p);
        let t = performance.now();
        const sewn = sewDesign(p, 2);
        const sewMs = Math.round(performance.now() - t);
        t = performance.now();
        const minX = Math.min(...objs.map((o) => o.minX)) / 10;
        const minY = Math.min(...objs.map((o) => o.minY)) / 10;
        const r = transformObjects(p, objs.map((o) => o.index), scaling(1.1, 1.1, minX, minY), 2);
        const scaleMs = Math.round(performance.now() - t);
        got[name] = { sew: hashOf(sewn), scaled: r ? hashOf(r.pattern) : 'null', sewMs, scaleMs };
      }
      if (process.env.SEW_HASHES_OUT) writeFileSync(process.env.SEW_HASHES_OUT, JSON.stringify(got, null, 1));
      const hashes = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, { sew: v.sew, scaled: v.scaled }]));
      expect(hashes).toEqual(Object.fromEntries(Object.keys(got).map((k) => [k, expected[k]])));
    },
    600_000,
  );
});
