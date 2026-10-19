import { describe, expect, it } from 'vitest';
import * as rsAuto from '../../src/correct/auto';
import { solveMip as rsMip } from '../../src/correct/engine/mip';
import { planFix as rsPlanFix } from '../../src/correct/engine/solve';
import * as rsNudge from '../../src/correct/nudge';
import * as rsPlan from '../../src/correct/plan';
import * as rsPullback from '../../src/correct/pullback';
import * as rsRespace from '../../src/correct/respace';
import * as rsSatinShort from '../../src/correct/satinShort';
import * as rsShorts from '../../src/correct/shorts';
import * as rsStructure from '../../src/correct/structure';
import * as rsThin from '../../src/correct/thin';
import * as rsThinHand from '../../src/correct/thinHand';
import type { Pattern } from '../../src/model/pattern';
import { corpus, type Case } from '../helpers/korrekturCorpus';
import * as tsAuto from './ts/correct/auto';
import { solveMip as tsMip } from './ts/correct/engine/mip';
import { planFix as tsPlanFix } from './ts/correct/engine/solve';
import * as tsNudge from './ts/correct/nudge';
import * as tsPlan from './ts/correct/plan';
import * as tsPullback from './ts/correct/pullback';
import * as tsRespace from './ts/correct/respace';
import * as tsSatinShort from './ts/correct/satinShort';
import * as tsShorts from './ts/correct/shorts';
import * as tsStructure from './ts/correct/structure';
import * as tsThin from './ts/correct/thin';
import * as tsThinHand from './ts/correct/thinHand';

/**
 * Stage 5a of the Rust core: the corrections on stitches alone (thinning, merging, pulling back,
 * re-spacing, nudging, cropping) and the correction engine's field and search. The TypeScript as
 * it was (tests/rust/ts/correct) and the core work on the designs of the correction test set and
 * agree exactly: the same records, counts and masks, and the engine the same fix.
 */

let off: string[] = [];
let cases = 0;
const records = (p: Pattern) => ({ x: Array.from(p.x), y: Array.from(p.y), cmd: Array.from(p.cmd) });
const same = (what: string, ts: unknown, rs: unknown) => {
  cases++;
  const a = JSON.stringify(ts);
  const b = JSON.stringify(rs);
  if (a !== b) off.push(`${what}: ${a.slice(0, 120)} != ${b.slice(0, 120)}`);
};
const samePattern = (what: string, ts: Pattern, rs: Pattern) => same(what, records(ts), records(rs));

const all = corpus();
/** Each design once, with the profile of its first case. */
const designs: Case[] = all.filter((c, i) => all.findIndex((d) => d.pattern === c.pattern) === i);

/** Needs that change across the design, as the corrections get them from the check. */
const patchy = (p: Pattern) => (i: number) => ((((p.x[i] >> 4) * 7 + (p.y[i] >> 4) * 13) % 10) < 6 ? 0.5 : 0);
const flat = () => 0.4;
const half = (p: Pattern) => (i: number) => (((p.x[i] >> 5) + (p.y[i] >> 5)) & 1) === 0;

describe('stage 5a: corrections on stitches', () => {
  it(
    'thins, merges, pulls back, re-spaces and nudges as the TypeScript did',
    () => {
      off = [];
      cases = 0;
      for (const { name, pattern: p } of designs) {
        for (const [nn, needAt] of [
          ['flat', flat],
          ['patchy', patchy(p)],
        ] as const) {
          for (const strict of [false, true]) {
            const t = tsThin.thinSweeps(p, { needAt, strict });
            const r = rsThin.thinSweeps(p, { needAt, strict });
            same(`${name} thin ${nn} ${strict}`, [t.removed, t.cycles], [r.removed, r.cycles]);
            samePattern(`${name} thin ${nn} ${strict}`, t.pattern, r.pattern);
          }
          const th = tsThinHand.thinByHand(p, { needAt });
          const rh = rsThinHand.thinByHand(p, { needAt });
          same(`${name} hand ${nn}`, [th.removed, Array.from(th.mask)], [rh.removed, Array.from(rh.mask)]);
          samePattern(`${name} hand ${nn}`, th.pattern, rh.pattern);
          for (const maxSpacing of [5, 8]) {
            const tf = tsRespace.respaceFills(p, { needAt, maxSpacing });
            const rf = rsRespace.respaceFills(p, { needAt, maxSpacing });
            same(`${name} respace fills ${nn} ${maxSpacing}`, [tf.sweeps, tf.rows], [rf.sweeps, rf.rows]);
            samePattern(`${name} respace fills ${nn} ${maxSpacing}`, tf.pattern, rf.pattern);
            const cols = tsStructure.satinColumns(p);
            same(`${name} satin columns`, cols, rsStructure.satinColumns(p));
            const ts = tsRespace.respaceSatins(p, { needAt, maxSpacing }, cols);
            const rs = rsRespace.respaceSatins(p, { needAt, maxSpacing }, cols);
            same(`${name} respace satins ${nn} ${maxSpacing}`, [ts.sweeps, ts.rows], [rs.sweeps, rs.rows]);
            samePattern(`${name} respace satins ${nn} ${maxSpacing}`, ts.pattern, rs.pattern);
          }
        }
        for (const [wn, wanted] of [
          ['all', () => true],
          ['half', half(p)],
        ] as const) {
          for (const f of ['removeZeroLength', 'mergeShortStitches'] as const) {
            const t = tsShorts[f](p, wanted);
            const r = rsShorts[f](p, wanted);
            same(`${name} ${f} ${wn}`, t.removed, r.removed);
            samePattern(`${name} ${f} ${wn}`, t.pattern, r.pattern);
          }
          const ts = tsSatinShort.shortenSatinCurves(p, { wanted });
          const rs = rsSatinShort.shortenSatinCurves(p, { wanted });
          same(`${name} satin short ${wn}`, ts.moved, rs.moved);
          samePattern(`${name} satin short ${wn}`, ts.pattern, rs.pattern);
          const tp = tsPullback.pullBackFills(p, { wanted });
          const rp = rsPullback.pullBackFills(p, { wanted });
          same(`${name} pullback ${wn}`, [tp.moved, tp.removed], [rp.moved, rp.removed]);
          samePattern(`${name} pullback ${wn}`, tp.pattern, rp.pattern);
          const tn = tsNudge.nudgePenetrations(p, { movable: wanted, radius: 3, maxShift: 2 });
          const rn = rsNudge.nudgePenetrations(p, { movable: wanted, radius: 3, maxShift: 2 });
          same(`${name} nudge ${wn}`, tn.moved, rn.moved);
          samePattern(`${name} nudge ${wn}`, tn.pattern, rn.pattern);
        }
        same(`${name} same hole`, Array.from(tsNudge.sameHoleStitches(p)), Array.from(rsNudge.sameHoleStitches(p)));
        same(`${name} hidden`, Array.from(tsAuto.hiddenStitches(p)), Array.from(rsAuto.hiddenStitches(p)));
        const b = p.bounds;
        const box = { minX: (b.minX * 2 + b.maxX) / 3, minY: (b.minY * 2 + b.maxY) / 3, maxX: (b.minX + b.maxX * 2) / 3, maxY: (b.minY + b.maxY * 2) / 3 };
        const skip = Uint8Array.from(p.cmd, (_, i) => +(i % 7 === 0));
        for (const s of [undefined, skip]) {
          const t = tsPlan.crop(p, box, s);
          const r = rsPlan.crop(p, box, s);
          samePattern(`${name} crop ${!!s}`, t.pattern, r.pattern);
          same(`${name} crop skip ${!!s}`, t.skip && Array.from(t.skip), r.skip && Array.from(r.skip));
        }
      }
      expect(cases).toBeGreaterThan(500);
      expect(off).toEqual([]);
    },
    60_000,
  );

  it(
    'corrects whole designs as the TypeScript did',
    () => {
      off = [];
      for (const c of all.filter((_, i) => i % 4 === 0)) {
        for (const goal of ['critical', 'caution'] as const) {
          const t = tsAuto.autoCorrect(c.pattern, c.profile, { goal, focus: 'both' });
          const r = rsAuto.autoCorrect(c.pattern, c.profile, { goal, focus: 'both' });
          samePattern(`${c.name} auto ${goal}`, t.pattern, r.pattern);
          same(`${c.name} auto ${goal} report`, t.report, r.report);
        }
      }
      expect(off).toEqual([]);
    },
    60_000,
  );
});

describe('stage 5a: the correction engine', () => {
  const picked = ['demos/overlap.pes (knit)', 'demos/letters.pes (knit)', 'demos/sun.dst (knit)', 'demos/leather-patch.dst (leather)'];
  for (const name of picked) {
    it(
      `finds the same fix for ${name}`,
      async () => {
        off = [];
        const c = all.find((x) => x.name === name)!;
        expect(c).toBeDefined();
        const logT: string[] = [];
        const logR: string[] = [];
        const keep = (to: string[]) => (s: string) => {
          // Times differ from run to run; the search's notes do not.
          if (!/t=|ms /.test(s)) to.push(s);
        };
        const t = await tsPlanFix(c.pattern, c.profile, 'all', { trimMm: 3, log: keep(logT) });
        const r = await rsPlanFix(c.pattern, c.profile, 'all', { trimMm: 3, log: keep(logR) });
        expect(t.before).toBeGreaterThan(0);
        same(`${name} counts`, [t.before, t.after], [r.before, r.after]);
        same(`${name} objects`, t.objects, r.objects);
        samePattern(`${name} pattern`, t.pattern, r.pattern);
        same(`${name} rounds`, logT.filter((s) => s.startsWith('round')), logR.filter((s) => s.startsWith('round')));
        expect(off).toEqual([]);
      },
      60_000,
    );
  }

  it('builds the same exact program', async () => {
    off = [];
    const c = all.find((x) => x.name === 'demos/overlap.pes (woven)')!;
    const t = await tsPlanFix(c.pattern, c.profile, 'density', { trimMm: 3, solver: 'mip', exact: tsMip });
    const r = await rsPlanFix(c.pattern, c.profile, 'density', { trimMm: 3, solver: 'mip', exact: rsMip });
    same('mip counts', [t.before, t.after], [r.before, r.after]);
    same('mip objects', t.objects, r.objects);
    samePattern('mip pattern', t.pattern, r.pattern);
    expect(off).toEqual([]);
  }, 60_000);
});
