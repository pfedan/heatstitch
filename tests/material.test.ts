import { describe, expect, it } from 'vitest';
import { FABRIC, FABRICS } from '../src/material/fabrics';
import { THREADS } from '../src/material/threads';
import { digitizeDefaults, pullFor } from '../src/digitize/digitize';
import { stableFabric } from '../src/validation/practice';
import { normalizeProfile } from '../src/validation/profiles';
import { RED_MIN_MM2 } from '../src/areas/ampel/standin';

describe('material module', () => {
  it('lists every fabric once, in picker order', () => {
    expect(FABRICS.map((f) => f.id)).toEqual(['woven', 'woven_heavy', 'cap', 'knit', 'fleece', 'terry', 'light', 'sheer', 'leather']);
    for (const f of FABRICS) expect(FABRIC[f.id]).toBe(f);
  });

  it('lists threads thinnest first', () => {
    expect(THREADS.map((t) => t.id)).toEqual(['60', '40', '30', '12']);
  });

  it('keeps the values the tables had before (pure move)', () => {
    const pull = { woven: 0.2, woven_heavy: 0.2, cap: 0.2, knit: 0.35, fleece: 0.4, terry: 0.4, light: 0.15, sheer: 0.15, leather: 0.15 };
    const red = { woven: 5, woven_heavy: 5, cap: 5, knit: 3, fleece: 3, terry: 3, light: 3, sheer: 3, leather: 3 };
    for (const f of FABRICS) {
      const d = digitizeDefaults({ fabric: f.id, thread: '40' });
      expect(d.pull, f.id).toBe(pull[f.id]);
      expect(pullFor({ fabric: f.id, thread: '40' }, 'satin').edge, f.id).toBe(Math.round((pull[f.id] / 2) * 100) / 100);
      expect(RED_MIN_MM2[f.id], f.id).toBe(red[f.id]);
      expect(stableFabric({ fabric: f.id, thread: '40' }), f.id).toBe(['woven', 'woven_heavy', 'cap'].includes(f.id));
    }
  });

  it('falls back to woven and 40 wt for unknown ids', () => {
    expect(normalizeProfile({ fabric: 'toString' as never, thread: '99' as never })).toEqual({ fabric: 'woven', thread: '40' });
  });
});
