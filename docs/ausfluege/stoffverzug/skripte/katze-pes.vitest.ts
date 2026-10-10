// Liest die Katze für die Rechnung aus und schreibt die korrigierten Fassungen als PES.
// Zum Ausführen nach tests/ kopieren (vitest sucht nur *.test.ts):
//   cp docs/ausfluege/stoffverzug/skripte/katze-pes.vitest.ts tests/zz-katze-pes.test.ts
//   KATZE=dump npx vitest run tests/zz-katze-pes.test.ts     (vor run.py)
//   KATZE=write npx vitest run tests/zz-katze-pes.test.ts    (nach run.py woven und run.py knit)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { parsePattern } from '../src/parsers';
import { computeBounds } from '../src/model/pattern';
import { writePattern } from '../src/writers';

const OUT = new URL('../docs/ausfluege/stoffverzug/skripte/ergebnis/', import.meta.url);
const FILE = 'cat-60mm.pes';

it('katze', () => {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const p = parsePattern(readFileSync(new URL(`../public/examples/${FILE}`, import.meta.url)), FILE);
  if (process.env.KATZE === 'dump') {
    writeFileSync(new URL('katze-stiche.json', OUT), JSON.stringify({ x: Array.from(p.x), y: Array.from(p.y), cmd: Array.from(p.cmd), colors: p.colors }));
    return;
  }
  for (const [n, label] of [['woven', 'webware'], ['knit', 'jersey']]) {
    const c = JSON.parse(readFileSync(new URL(`needle-${n}.json`, OUT), 'utf8'));
    const x = Int32Array.from(c.x);
    const y = Int32Array.from(c.y);
    const q = { ...p, name: `katze-korrigiert-${label}`, x, y, bounds: computeBounds(x, y, p.cmd) };
    writeFileSync(new URL(`katze-korrigiert-${label}.pes`, OUT), writePattern(q, 'pes'));
  }
});
