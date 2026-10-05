import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { addShape } from '../src/model/addShape';
import { sewObjects } from '../src/model/objects';
import { isGuessed } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import { ellipsePath, parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

describe('known or guessed', () => {
  it('objects of a file from elsewhere are guessed, shapes added here are known, also narrow ones sewn as satin', () => {
    const p = parsePattern(new Uint8Array(readFileSync(new URL('../public/examples/cat-60mm.pes', import.meta.url))), 'cat-60mm.pes');
    expect(sewObjects(p).every((o) => isGuessed(p, o))).toBe(true);
    const options = digitizeDefaults(DEFAULT_PROFILE);
    const wide = addShape(p, { form: parsePath(ellipsePath(10, 90, 12, 8), [1, 0, 0, 1, 0, 0]), kind: 'fill' }, p.colors[0], null, options)!.pattern;
    const narrow = addShape(wide, { form: parsePath(ellipsePath(40, 90, 14, 2), [1, 0, 0, 1, 0, 0]), kind: 'fill' }, p.colors[1], null, options)!.pattern;
    const objs = sewObjects(narrow);
    const added = objs.slice(-2);
    expect(added.map((o) => o.kind)).toContain('satin');
    expect(added.map((o) => isGuessed(narrow, o))).toEqual([false, false]);
    expect(objs.slice(0, -2).every((o) => isGuessed(narrow, o))).toBe(true);
  });
});
