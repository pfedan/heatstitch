import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sewObjects } from '../../src/model/objects';
import { transformObjects } from '../../src/model/reshape';
import { sewDesign } from '../../src/model/sew';
import { scaling } from '../../src/shape/path';
import { designs, hashOf } from './designs';

/**
 * Stage 4 of the Rust core: whole designs sewn anew from their objects, as they are and scaled to
 * 110 %, give the very stitches they gave before the sewing moved to the core (hashes recorded
 * with the TypeScript, tests/rust/fixtures/stage4-hashes.json). By default a quick share of the
 * designs; STAGE4_ALL=1 takes all of public/examples (about two minutes), STAGE4_OUT=<file>
 * writes each design's hashes and times there.
 */

const expected = JSON.parse(readFileSync('tests/rust/fixtures/stage4-hashes.json', 'utf8')) as Record<string, { sew: string; scaled: string }>;

/** Designs sewn in a few seconds, with lines, borders, satins, appliqués, fills and files of every kind. */
const QUICK = new Set(['Blume', 'Musterkarte Offen', 'Linienstiche', 'Linien mit Parametern', 'Handstiche', 'Linieneffekte', 'Redwork', 'Satinflächen', 'Applikation', 'demos/confetti.pes', 'demos/overlap.pes', 'demos/sun.dst', 'svg kirschen', 'svg abzeichen', 'svg apfel', 'svg blumenzweig', 'svg overlapping-circles']);
const all = process.env.STAGE4_ALL === '1';

describe('stage 4: whole designs sewn anew', () => {
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
      if (process.env.STAGE4_OUT) writeFileSync(process.env.STAGE4_OUT, JSON.stringify(got, null, 1));
      const hashes = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, { sew: v.sew, scaled: v.scaled }]));
      expect(hashes).toEqual(Object.fromEntries(Object.keys(got).map((k) => [k, expected[k]])));
    },
    600_000,
  );
});
