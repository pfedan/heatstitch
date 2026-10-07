import { describe, expect, it } from 'vitest';
import { tally } from '../src/areas/ampel/verdict';
import { REASON_BITS, type Zone } from '../src/validation/zones';
import type { ValidationResult } from '../src/validation/validate';
import type { FabricId } from '../src/validation/profiles';

/** A 10 x 3 grid of 1 mm cells with one zone: `critical` density cells in a row, then `caution` gap cells. */
function result(fabric: FabricId, critical: number, caution = 0, practice?: Zone['practice']): ValidationResult {
  const cols = 10;
  const rows = 3;
  const level = new Uint8Array(cols * rows);
  const reasons = new Uint8Array(cols * rows);
  const zoneOf = new Int32Array(cols * rows).fill(-1);
  for (let i = 0; i < critical + caution; i++) {
    const c = cols + i; // middle row
    level[c] = i < critical ? 2 : 1;
    reasons[c] = i < critical ? REASON_BITS.density : REASON_BITS.gap;
    zoneOf[c] = 0;
  }
  const n = critical + caution;
  const zones: Zone[] = n
    ? [
        {
          level: critical ? 2 : 1,
          reasons: [...(critical ? ['density' as const] : []), ...(caution ? ['gap' as const] : [])],
          cells: n,
          areaMm2: n,
          maxDensity: 0,
          maxHoles: 0,
          maxShorts: 0,
          minCover: 0,
          maxLong: 0,
          satinShare: 0,
          bbox: { minX: 0, minY: 1, maxX: n, maxY: 2 },
          ...(practice ? { practice } : {}),
        },
      ]
    : [];
  return {
    profile: { fabric, thread: '40' },
    checks: { density: true, shortStitches: true, perforation: true, coverage: true, longStitches: true },
    measurement: { cols, rows, cellMm: 1, originX: 0, originY: 0 },
    level,
    reasons,
    zoneOf,
    zones,
  } as unknown as ValidationResult;
}

describe('traffic light "Klappt das?"', () => {
  it('is red when one connected critical spot is larger than the fabric limit', () => {
    expect(tally(result('woven', 6), []).verdict.light).toBe('red');
    expect(tally(result('woven', 5), []).verdict.light).toBe('yellow');
    // Knit, jersey and terry turn red sooner.
    expect(tally(result('knit', 4), []).verdict.light).toBe('red');
    expect(tally(result('terry', 3), []).verdict.light).toBe('yellow');
  });

  it('is green when nothing counts: no findings, normal in practice, acknowledged', () => {
    expect(tally(result('woven', 0), []).verdict.light).toBe('green');
    expect(tally(result('woven', 8, 0, 'satinJoin'), []).verdict.light).toBe('green');
    const acked = tally(result('woven', 8), [{ bbox: { minX: 0, minY: 1, maxX: 8, maxY: 2 }, reason: 'manual' }]);
    expect(acked.verdict.light).toBe('green');
    expect(acked.reasons).toEqual([]);
  });

  it('names each kind with its area; gaps never count as critical', () => {
    const r = tally(result('woven', 6, 4), []);
    expect(r.reasons.map((x) => [x.type, x.level, x.areaMm2, x.targetMm2])).toEqual([
      ['density', 'critical', 6, 6],
      ['gaps', 'caution', 4, 4],
    ]);
    expect(r.target.all).toBe(10);
    expect(r.verdict.worst?.areaMm2).toBe(6);
  });
});
