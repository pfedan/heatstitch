import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sewObjects } from '../src/model/objects';
import { readFromFile, type Pattern } from '../src/model/pattern';
import { withRecords } from '../src/model/edit';
import { readBorder } from '../src/model/readBorder';
import { analyze, measureFill } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { rng } from './helpers/images';
import { STEPS, Doc, pick, restitchFill, OPS, checkAllKnown, checkBorders, checkKeys, describeObjects } from './helpers/torture';

describe('borders read from a file', () => {
  /** The letters of the demo file, moved `dx` mm (other stitches: nothing known from another chain is taken over). */
  function letters(dx: number): Pattern {
    const p = parsePattern(readFileSync(new URL('../public/examples/demos/letters.pes', import.meta.url)), 'letters.pes');
    const q = withRecords(p, p.x.map((x) => x + dx * 10), p.y.slice(), p.cmd.slice());
    readFromFile(q);
    return q;
  }

  it.each(Array.from({ length: Number(process.env.TORTURE_READ_CHAINS ?? 6) }, (_, k) => k + 1))('chain %i keeps each letter and the satin along it one fill and its border', async (seed) => {
    const r = rng(seed);
    const d = new Doc();
    d.commit(letters(seed * 7));
    // Each letter takes the satin sewn along its edge in the file as its border, as the panel offers it.
    for (let k = 0; k < 4; k++) {
      const p = d.cur.p;
      const kinds = stitchKinds(p);
      const objs = sewObjects(p, kinds);
      const fill = objs.filter((o) => o.kind === 'fill')[k];
      const found = readBorder(p, objs, fill, kinds);
      expect(found, `letter ${k} has its border`).not.toBeNull();
      restitchFill(d, fill.index, { ...measureFill(p, analyze(p, fill, kinds)), border: { ...found!.border, link: `read${k}` } }, new Set());
      // Invariant: still eight objects, each letter with its one border, the satin it had.
      expect(d.objects, 'no second border').toHaveLength(8);
      checkBorders(d.cur.p);
    }
    checkAllKnown(d.cur.p);
    const log: string[] = ['take borders'];
    const ops = OPS;
    for (let step = 0; step < STEPS; step++) {
      const op = pick(r, ops);
      if (!(await op.run(d, r))) continue;
      log.push(op.name);
      if (process.env.TORTURE_TRACE) console.log(op.name, describeObjects(d.cur.p));
      try {
        // (A file read has no END record: the records are checked by the app-made chains in torture.test.ts.)
        checkKeys(d.cur.p);
        checkBorders(d.cur.p);
      } catch (e) {
        throw new Error(`seed ${seed}: ${log.join(' > ')}\n${(e as Error).message}`);
      }
    }
  }, 120000);
});
