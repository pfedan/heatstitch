import { readFileSync } from 'node:fs';
import type { Pattern } from '../../src/model/pattern';
import { parsePattern } from '../../src/parsers';
import type { Profile } from '../../src/validation/profiles';
import { buildDemos } from './demoProject';

/**
 * The fixed test set for the correction engine (plans/korrektur-engine-review.md): the designs of
 * the demo project (own objects, sewn from their shapes), the bundled example files (foreign
 * stitches, shapes recognized) and the cat. Each on woven and knit, own designs also on their own
 * fabric.
 */
export interface Case {
  name: string;
  pattern: Pattern;
  profile: Profile;
}

const WOVEN: Profile = { fabric: 'woven', thread: '40' };
const KNIT: Profile = { fabric: 'knit', thread: '40' };
const FOREIGN = ['cat-60mm.pes', 'demos/overlap.pes', 'demos/letters.pes', 'demos/patch.pes', 'demos/sun.dst', 'demos/confetti.pes', 'demos/leather-patch.dst'];

/** Builds the corpus. Own designs first: building them clears the object memory. */
export function corpus(): Case[] {
  const out: Case[] = [];
  for (const d of buildDemos()) {
    const profiles = [d.profile, WOVEN, KNIT].filter((p, i, a) => a.findIndex((q) => q.fabric === p.fabric && q.thread === p.thread) === i);
    for (const profile of profiles) out.push({ name: `${d.title} (${profile.fabric})`, pattern: d.p, profile });
  }
  for (const f of FOREIGN) {
    const p = parsePattern(readFileSync(new URL(`../../public/examples/${f}`, import.meta.url)), f);
    const profiles = f.includes('leather') ? [{ fabric: 'leather', thread: '40' } as Profile, WOVEN] : [WOVEN, KNIT];
    for (const profile of profiles) out.push({ name: `${f} (${profile.fabric})`, pattern: p, profile });
  }
  return out;
}
