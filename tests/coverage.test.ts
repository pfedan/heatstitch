import { describe, expect, it } from 'vitest';
import { classify, measurePattern, type ValidationResult } from '../src/validation/validate';
import type { Profile, FabricId } from '../src/validation/profiles';
import { Shape } from './helpers/shapes';

const on = (fabric: FabricId): Profile => ({ fabric, thread: '40' });
const reasons = (v: ValidationResult) => new Set(v.zones.flatMap((z) => z.reasons));

describe('lower limits', () => {
  it('flags a fill so open that the fabric shows, not one in the recommended range', () => {
    const open = measurePattern(new Shape().fill(10, 10, 20, 20, 'h', 0.7).build());
    const good = measurePattern(new Shape().fill(10, 10, 20, 20, 'h', 0.42).build());
    expect(reasons(classify(open, on('woven')))).toContain('sparse');
    expect(reasons(classify(good, on('woven')))).not.toContain('sparse');
    // Fabric showing through is only ever Caution.
    expect(classify(open, on('woven')).criticalCells).toBe(0);
  });

  it('accepts an open fill on fabric that wants it open', () => {
    const open = measurePattern(new Shape().fill(10, 10, 20, 20, 'h', 0.62).build());
    expect(reasons(classify(open, on('woven')))).toContain('sparse');
    expect(reasons(classify(open, on('light')))).not.toContain('sparse');
  });

  it('leaves out fills marked as open on purpose', () => {
    const p = new Shape().fill(10, 10, 20, 20, 'h', 0.7).build();
    const all = new Uint8Array(p.cmd.length).fill(1);
    expect(reasons(classify(measurePattern(p, all), on('woven')))).not.toContain('sparse');
  });

  it('finds the gap that opens where rows end on another fill without overlap, more on knits', () => {
    // Two fills side by side, rows running towards the joint: they pull back from it.
    const p = new Shape().fill(10, 10, 30, 12, 'h', 0.4).fill(40, 10, 30, 12, 'h', 0.4).build();
    const m = measurePattern(p);
    expect(reasons(classify(m, on('knit')))).toContain('gap');
    // With 1 mm of overlap nothing opens.
    const q = new Shape().fill(10, 10, 30.5, 12, 'h', 0.4).fill(39.5, 10, 30.5, 12, 'h', 0.4).build();
    expect(reasons(classify(measurePattern(q), on('knit')))).not.toContain('gap');
  });

  it('does not call fabric left free between two shapes a gap', () => {
    const p = new Shape().fill(10, 10, 30, 12, 'h', 0.4).fill(41.5, 10, 30, 12, 'h', 0.4).build();
    expect(reasons(classify(measurePattern(p), on('knit')))).not.toContain('gap');
  });

  it('flags satin stitches longer than the fabric carries', () => {
    const wide = measurePattern(new Shape().satin(10, 10, 20, 9, 0.4).build());
    expect(reasons(classify(wide, on('knit')))).toContain('long');
    expect(reasons(classify(wide, on('woven')))).not.toContain('long');
  });

  it('can switch the lower limits off', () => {
    const open = measurePattern(new Shape().fill(10, 10, 20, 20, 'h', 0.7).build());
    const v = classify(open, on('woven'), { density: true, shortStitches: true, perforation: true, coverage: false, longStitches: false });
    expect(reasons(v)).not.toContain('sparse');
  });
});
