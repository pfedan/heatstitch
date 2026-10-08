import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bestOrder, orderInput, orderSeconds, orderStats } from '../src/model/bestOrder';
import { setTrims } from '../src/model/jumps';
import type { Pattern } from '../src/model/pattern';
import { transitions } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { DEFAULTS } from '../src/settings';
import { writePattern } from '../src/writers';
import { buildDemos } from './helpers/demoProject';
import { pingpongConfettiDesign } from './helpers/demos';

const ex = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);
/** Pingpong confetti as the app reads it from its file. */
const pingpong = () => parsePattern(readFileSync(new URL('fixtures/pingpong-confetti.pes', import.meta.url)), 'pingpong-confetti.pes');
const fixture = (f: string) => parsePattern(readFileSync(new URL(`fixtures/pyembroidery/${f}`, import.meta.url)), f);
/** "Trim from the limit" in the jumps panel. */
const cutFrom = (p: Pattern, mm: number) => setTrims(p, transitions(p).filter((j) => j.lengthMm >= mm && !j.trimmed), true);

/** The example files, the demo project and files from other programs (`ORDER_BENCH=1` prints the table). */
function corpus(): [string, Pattern][] {
  const out: [string, Pattern][] = [];
  for (const f of ['cat-60mm.pes', 'demos/confetti.pes', 'demos/leather-patch.dst', 'demos/letters.pes', 'demos/overlap.pes', 'demos/patch.pes', 'demos/sun.dst']) out.push([f, ex(f)]);
  out.push(['confetti, trimmed from 4 mm', cutFrom(ex('demos/confetti.pes'), 4)]);
  out.push(['pingpong confetti', pingpong()]);
  out.push(['pingpong, trimmed from 3 mm', cutFrom(pingpong(), DEFAULTS.trimMm)]);
  for (const f of ['sun-v6.pes', 'sun.exp', 'sun.jef', 'sun.vp3']) out.push([f, fixture(f)]);
  for (const d of buildDemos()) out.push([d.title, d.p]);
  return out;
}

describe('optimize order', () => {
  it('keeps the pingpong confetti file in sync with its generator (UPDATE_DEMOS=1 writes it)', () => {
    const file = new URL('fixtures/pingpong-confetti.pes', import.meta.url);
    const data = writePattern(pingpongConfettiDesign(), 'pes');
    if (process.env.UPDATE_DEMOS || !existsSync(file)) writeFileSync(file, data);
    expect(new Uint8Array(readFileSync(file))).toEqual(data);
  });

  it('never proposes an order with more color changes, trims or sewing time, nor longer ways without fewer stops', () => {
    const s = DEFAULTS;
    const rows: string[] = [];
    let total = [0, 0];
    for (const [name, p] of corpus()) {
      const found = bestOrder(p, orderInput(p), { ...s.order, trimMm: s.trimMm }, s);
      const next = found?.next ?? p;
      const a = orderStats(p);
      const b = orderStats(next);
      const ta = Math.round(orderSeconds(p, a, s));
      const tb = Math.round(orderSeconds(next, b, s));
      total = [total[0] + ta, total[1] + tb];
      rows.push(`${name.padEnd(28)} colors ${a.colorChanges}->${b.colorChanges} trims ${a.trims}->${b.trims} ways ${a.travelMm.toFixed(1)}->${b.travelMm.toFixed(1)} time ${ta}->${tb}s reversed ${found?.reversed.length ?? 0}`);
      expect(b.colorChanges, name).toBeLessThanOrEqual(a.colorChanges);
      expect(b.trims, name).toBeLessThanOrEqual(a.trims);
      expect(tb, name).toBeLessThanOrEqual(ta);
      if (b.colorChanges === a.colorChanges && b.trims === a.trims) expect(Math.round(b.travelMm * 10), name).toBeLessThanOrEqual(Math.round(a.travelMm * 10));
      if (found) expect(tb < ta || b.travelMm < a.travelMm || b.trims < a.trims || b.colorChanges < a.colorChanges, name).toBe(true);
    }
    if (process.env.ORDER_BENCH) console.log(`${rows.join('\n')}\ntotal time ${total[0]} -> ${total[1]} s`);
    // It still finds something: shorter ways, fewer trims and colors in the demo designs.
    expect(total[1]).toBeLessThan(total[0] - 200);
  }, 120_000);

  it('shortens the ways of confetti without a trim or second more, trimmed or not (screencast 9)', () => {
    for (const p of [cutFrom(ex('demos/confetti.pes'), 4), pingpong(), cutFrom(pingpong(), DEFAULTS.trimMm)]) {
      const found = bestOrder(p, orderInput(p), { ...DEFAULTS.order, trimMm: DEFAULTS.trimMm }, DEFAULTS);
      expect(found).not.toBeNull();
      const a = orderStats(p);
      const b = orderStats(found!.next);
      expect(b.trims).toBeLessThanOrEqual(a.trims);
      expect(Math.round(orderSeconds(found!.next, b, DEFAULTS))).toBeLessThanOrEqual(Math.round(orderSeconds(p, a, DEFAULTS)));
      expect(b.travelMm).toBeLessThan(a.travelMm * 0.85);
    }
  });
});
