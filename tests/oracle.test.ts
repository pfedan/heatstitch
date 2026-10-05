import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLOR_CHANGE, STITCH, TRIM } from '../src/model/pattern';
import { parsePattern } from '../src/parsers';
import { OUTPUT_FORMATS, writePattern } from '../src/writers';

/**
 * Writes every example in every save format to oracle/, with what heatstitch meant to write, for
 * scripts/oracle.py to read back with pyembroidery (an independent reader). Runs only with
 * ORACLE set, as CI does: `ORACLE=1 npx vitest run tests/oracle.test.ts && python3 scripts/oracle.py`.
 */
const on = !!process.env.ORACLE;
const EXAMPLES = ['cat-60mm.pes', 'demos/confetti.pes', 'demos/leather-patch.dst', 'demos/letters.pes', 'demos/overlap.pes', 'demos/sun.dst'];

describe.skipIf(!on)('files for the pyembroidery oracle', () => {
  it('writes each example in each format', () => {
    const out = new URL('../oracle/', import.meta.url);
    mkdirSync(out, { recursive: true });
    for (const file of EXAMPLES) {
      const p = parsePattern(new Uint8Array(readFileSync(new URL(`../public/examples/${file}`, import.meta.url))), file);
      const base = file.split('/').pop()!.replace(/\.[^.]+$/, '');
      const stitches: [number, number][] = [];
      for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === STITCH) stitches.push([p.x[i], p.y[i]]);
      const count = (c: number) => p.cmd.filter((v) => v === c).length;
      const meant = { stitches, trims: count(TRIM), colorChanges: count(COLOR_CHANGE), colors: p.colors.map((c) => [c.r, c.g, c.b]) };
      writeFileSync(new URL(`${base}.json`, out), new TextEncoder().encode(JSON.stringify(meant)));
      for (const format of OUTPUT_FORMATS) writeFileSync(new URL(`${base}.${format}`, out), writePattern(p, format));
      expect(stitches.length).toBeGreaterThan(0);
    }
  });
});
