import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newLink, syncBorders } from '../src/model/border';
import { rememberObjects, sewObjects, type SewObject } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { readBorder } from '../src/model/readBorder';
import { analyze, measureFill, remember, remembered, restitch, type FillSettings } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

const points = (p: Pattern, o: SewObject) => {
  const out: string[] = [];
  for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) out.push(`${p.x[i]},${p.y[i]}`);
  return out.join(' ');
};

/** Fill `which` sewn anew with `s`, its objects remembered and its borders made, as the app does. */
function apply(p: Pattern, which: number, s: FillSettings) {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const r = restitch(p, objs, [which], { kind: 'fill', s }, kinds, 7);
  expect(r.failed).toEqual([]);
  rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
  const now = sewObjects(r.pattern);
  remember(r.pattern, now[which], r.memory[0]);
  const q = syncBorders(r.pattern, 7);
  const after = sewObjects(q);
  const link = s.border?.link;
  return { q, objs: after, borders: after.filter((o) => link && remembered(q, o)?.outline === link) };
}

describe('a border read from a file', () => {
  it('is the satin sewn along the edge of each letter', () => {
    const p = load('demos/letters.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    for (const o of objs.filter((x) => x.kind === 'fill')) {
      const b = readBorder(p, objs, o, kinds);
      expect(b, `letter ${o.index}`).not.toBeNull();
      expect(objs[b!.at].kind).toBe('satin');
      expect(b!.border.type).toBe('satin');
      expect(b!.border.width).toBeGreaterThan(1.5);
      expect(b!.border.color).toEqual(objs[b!.at].color);
    }
  });

  it('finds none where nothing is sewn along a fill', () => {
    const p = load('demos/sun.dst');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    for (const o of objs.filter((x) => x.kind === 'fill')) expect(readBorder(p, objs, o, kinds)).toBeNull();
  });

  it('stays as sewn when its fill is sewn anew, and is the one border object of the fill', () => {
    const p = load('demos/letters.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const fill = objs.find((x) => x.kind === 'fill')!;
    const found = readBorder(p, objs, fill, kinds)!;
    const m = measureFill(p, analyze(p, fill, kinds));
    const { q, objs: after, borders } = apply(p, fill.index, { ...m, spacing: m.spacing + 0.1, border: { ...found.border, link: newLink() } });
    // No second border: the satin from the file is it, with its stitches as they were.
    expect(after).toHaveLength(objs.length);
    expect(borders).toHaveLength(1);
    expect(points(q, borders[0])).toBe(points(p, objs[found.at]));
    expect(remembered(q, borders[0])?.border?.type).toBe('satin');
  });

  it('is sewn anew in its place when its settings change', () => {
    const p = load('demos/letters.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    // Another letter than above: what an object remembers goes by its stitches.
    const fill = objs.filter((x) => x.kind === 'fill')[1];
    const found = readBorder(p, objs, fill, kinds)!;
    const m = measureFill(p, analyze(p, fill, kinds));
    const { q, objs: after, borders } = apply(p, fill.index, { ...m, border: { ...found.border, type: 'run', link: newLink() } });
    expect(after).toHaveLength(objs.length);
    expect(borders).toHaveLength(1);
    expect(borders[0].kind).toBe('run');
    expect(borders[0].color).toEqual(objs[found.at].color);
    // The satin of the file is gone: the border took its place.
    expect(after.filter((o) => points(q, o) === points(p, objs[found.at]))).toHaveLength(0);
  });
});
