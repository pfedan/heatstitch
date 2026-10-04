import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { autoCorrect, DEFAULT_CORRECTION } from '../src/correct/auto';
import { parsePattern } from '../src/parsers';
import { CRITICAL, SAFE, validatePattern } from '../src/validation/validate';
import type { Profile } from '../src/validation/profiles';
import { writePattern } from '../src/writers';
import { DEMOS, leatherDesign, overlapDesign, satinOverlapDesign, shortStitchDesign } from './helpers/demos';

/** Demo files for the guide. `UPDATE_DEMOS=1 npm test` rewrites them after a change to the designs or writers. */
const DIR = new URL('../public/examples/demos/', import.meta.url);

const WOVEN: Profile = { fabric: 'woven', thread: '40' };
const KNIT: Profile = { fabric: 'knit', thread: '40' };
const LEATHER: Profile = { fabric: 'leather', thread: '40' };

/** Zones that count towards the verdict. */
const counted = (p: ReturnType<typeof overlapDesign>, profile: Profile) =>
  validatePattern(p, profile).zones.filter((z) => !z.practice);
const worst = (p: ReturnType<typeof overlapDesign>, profile: Profile) =>
  Math.max(SAFE, ...counted(p, profile).map((z) => z.level));

describe('demo files', () => {
  it.each(DEMOS)('$file matches its generator', ({ file, build }) => {
    const data = writePattern(build(), file.endsWith('.dst') ? 'dst' : 'pes');
    const path = new URL(file, DIR);
    if (process.env.UPDATE_DEMOS || !existsSync(path)) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(path, data);
    }
    expect(new Uint8Array(readFileSync(path))).toEqual(data);
    expect(parsePattern(data, file).cmd.length).toBeGreaterThan(100);
  });

  it('each shows what the guide says it shows', () => {
    // Stacked fills: critical where four layers meet, the correction brings it down.
    const overlap = overlapDesign();
    expect(worst(overlap, WOVEN)).toBe(CRITICAL);
    expect(worst(autoCorrect(overlap, WOVEN, DEFAULT_CORRECTION).pattern, WOVEN)).toBeLessThan(CRITICAL);
    // Fill under satin: critical, cleared by pulling the fill back.
    const letters = satinOverlapDesign();
    expect(worst(letters, WOVEN)).toBe(CRITICAL);
    expect(worst(autoCorrect(letters, WOVEN, DEFAULT_CORRECTION).pattern, WOVEN)).toBeLessThan(CRITICAL);
    // Tiny spiral: normal on woven, critical on knits.
    const sun = shortStitchDesign();
    expect(worst(sun, WOVEN)).toBe(SAFE);
    expect(worst(sun, KNIT)).toBe(CRITICAL);
    expect(counted(sun, KNIT)[0].reasons).toContain('shortStitches');
    // Tight satin: fine on woven, perforates leather.
    const patch = leatherDesign();
    expect(worst(patch, WOVEN)).toBe(SAFE);
    expect(worst(patch, LEATHER)).toBe(CRITICAL);
    expect(counted(patch, LEATHER).flatMap((z) => z.reasons)).toContain('perforation');
  });
});
