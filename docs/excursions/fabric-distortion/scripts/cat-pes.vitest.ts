// Reads the cat for the simulation and writes the corrected versions as PES.
// To run it, copy it to tests/ (vitest only picks up *.test.ts):
//   cp docs/excursions/fabric-distortion/scripts/cat-pes.vitest.ts tests/zz-cat-pes.test.ts
//   CAT=dump npx vitest run tests/zz-cat-pes.test.ts     (before run.py)
//   CAT=write npx vitest run tests/zz-cat-pes.test.ts    (after run.py woven and run.py knit)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { parsePattern } from '../src/parsers';
import { computeBounds } from '../src/model/pattern';
import { writePattern } from '../src/writers';

const OUT = new URL('../docs/excursions/fabric-distortion/scripts/output/', import.meta.url);
const FILE = 'cat-60mm.pes';

it('cat', () => {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const p = parsePattern(readFileSync(new URL(`../public/examples/${FILE}`, import.meta.url)), FILE);
  if (process.env.CAT === 'dump') {
    writeFileSync(new URL('cat-stitches.json', OUT), JSON.stringify({ x: Array.from(p.x), y: Array.from(p.y), cmd: Array.from(p.cmd), colors: p.colors }));
    return;
  }
  for (const n of ['woven', 'knit']) {
    const c = JSON.parse(readFileSync(new URL(`needle-${n}.json`, OUT), 'utf8'));
    const x = Int32Array.from(c.x);
    const y = Int32Array.from(c.y);
    const q = { ...p, name: `cat-corrected-${n}`, x, y, bounds: computeBounds(x, y, p.cmd) };
    writeFileSync(new URL(`cat-corrected-${n}.pes`, OUT), writePattern(q, 'pes'));
  }
});
